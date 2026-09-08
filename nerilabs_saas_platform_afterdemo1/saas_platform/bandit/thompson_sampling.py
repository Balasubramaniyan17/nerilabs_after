"""
Production Multi-Armed Bandit (MAB) Engine.
Implements Bayesian Thompson Sampling with a mandatory 10% exploration floor,
sample threshold gates ("not enough data" trust commitment), continuous time-delta decay
(never decaying on auxiliary dwell/scroll telemetry), and persistent state across restarts.
"""

import numpy as np
import random
import math
import time
from typing import Dict, List, Tuple, Optional, Any
from saas_platform.config import Config
from saas_platform.models.schemas import (
    Variant,
    TelemetryEventDTO,
    EventType,
    ArmStatistics,
    MABAnalyticsReport,
)
from saas_platform.models.database import db


class MABEngine:
    def __init__(
        self,
        experiment_id: str,
        tenant_id: str,
        exploration_floor: float = Config.MAB_DEFAULT_EXPLORATION_FLOOR,
        min_sample_threshold: int = Config.MAB_MIN_SAMPLE_THRESHOLD,
        decay_half_life_hours: float = 168.0,  # 7-day half-life for non-stationary drift
    ):
        self.experiment_id = experiment_id
        self.tenant_id = tenant_id
        self.exploration_floor = exploration_floor
        self.min_sample_threshold = min_sample_threshold
        # Decay lambda: e^(-lambda * dt_hours)
        self.decay_lambda = math.log(2) / max(1.0, decay_half_life_hours)

        # Map variant_id -> arm dict
        self.arms: Dict[str, Dict[str, Any]] = {}
        self._load_arms()

    def _load_arms(self):
        # Load from database first
        persisted_states = db.load_bandit_arms(self.experiment_id)
        variants = db.list_variants_for_experiment(self.experiment_id)

        for v in variants:
            if v.status == "APPROVED" or v.is_control:
                p_state = persisted_states.get(v.variant_id)
                if p_state:
                    self.arms[v.variant_id] = {
                        "variant": v,
                        "opaque_id": v.opaque_id,
                        "alpha": p_state["alpha"],
                        "beta_param": p_state["beta_param"],
                        "impressions": p_state["impressions"],
                        "conversions": p_state["conversions"],
                        "reassignments": 0,
                        "last_updated": p_state["last_updated"]
                    }
                else:
                    self.register_variant(v)

    def register_variant(self, variant: Variant):
        if variant.variant_id not in self.arms:
            now = time.time()
            self.arms[variant.variant_id] = {
                "variant": variant,
                "opaque_id": variant.opaque_id,
                "alpha": 1.0,
                "beta_param": 1.0,
                "impressions": 0,
                "conversions": 0,
                "reassignments": 0,
                "last_updated": now
            }
            db.save_bandit_arm_state(
                experiment_id=self.experiment_id,
                variant_id=variant.variant_id,
                alpha=1.0,
                beta_param=1.0,
                impressions=0,
                conversions=0,
                last_updated=now
            )

    def _apply_time_decay(self, arm: Dict[str, Any], current_time: float):
        """
        Continuous exponential decay based on actual elapsed wall-clock hours (never event count).
        """
        elapsed_hours = (current_time - arm["last_updated"]) / 3600.0
        if elapsed_hours > 0.05:  # Apply if > 3 minutes elapsed
            decay_factor = math.exp(-self.decay_lambda * elapsed_hours)
            arm["alpha"] = 1.0 + (arm["alpha"] - 1.0) * decay_factor
            arm["beta_param"] = 1.0 + (arm["beta_param"] - 1.0) * decay_factor
            arm["last_updated"] = current_time

    def select_variant_for_visitor(self, visitor_id: str) -> Tuple[Variant, str, float]:
        # Cross-process synchronization: Refresh latest arm state from database
        persisted_states = db.load_bandit_arms(self.experiment_id)
        for vid, p_state in persisted_states.items():
            if vid in self.arms:
                self.arms[vid]["alpha"] = p_state["alpha"]
                self.arms[vid]["beta_param"] = p_state["beta_param"]
                self.arms[vid]["impressions"] = p_state["impressions"]
                self.arms[vid]["conversions"] = p_state["conversions"]
                self.arms[vid]["last_updated"] = p_state["last_updated"]

        active_arms = list(self.arms.values())
        if not active_arms:
            raise ValueError(f"No active approved variants for experiment {self.experiment_id}")

        now = time.time()
        for arm in active_arms:
            self._apply_time_decay(arm, now)

        # 1. Warm-up phase: Ensure all arms get baseline traffic
        under_explored = [a for a in active_arms if a["impressions"] < 10]
        if under_explored:
            chosen = min(under_explored, key=lambda a: a["impressions"])
            return chosen["variant"], "uniform_warmup", 0.5

        # 2. Exploration Floor (10% uniform exploration prevents premature convergence)
        if random.random() < self.exploration_floor:
            chosen = random.choice(active_arms)
            return chosen["variant"], "exploration_floor", 0.5

        # 3. Thompson Sampling: Draw Beta(alpha, beta) samples
        samples = {}
        for arm in active_arms:
            drawn_theta = np.random.beta(arm["alpha"], arm["beta_param"])
            samples[arm["variant"].variant_id] = (drawn_theta, arm["variant"])

        best_var_id, (best_sample, best_var) = max(samples.items(), key=lambda x: x[1][0])
        return best_var, "thompson_sampling", float(best_sample)

    def record_telemetry(self, event: TelemetryEventDTO):
        """
        Updates Bayesian Beta posteriors strictly on IMPRESSION and CONVERSION events.
        Auxiliary telemetry (DWELL, SCROLL_PAST) is intentionally ignored here to prevent skew.
        """
        # Find arm matching variant_id or opaque_id
        target_arm = None
        for arm in self.arms.values():
            if arm["variant"].variant_id == event.opaque_variant_id or arm["opaque_id"] == event.opaque_variant_id:
                target_arm = arm
                break

        if not target_arm:
            return

        now = event.timestamp or time.time()

        if event.event_type == EventType.IMPRESSION:
            self._apply_time_decay(target_arm, now)
            target_arm["impressions"] += 1
            target_arm["beta_param"] += 1.0
            target_arm["last_updated"] = now
            self._persist_arm(target_arm)

        elif event.event_type == EventType.CONVERSION:
            target_arm["conversions"] += 1
            target_arm["alpha"] += 1.0
            if target_arm["beta_param"] > 1.0:
                target_arm["beta_param"] -= 1.0
            target_arm["last_updated"] = now
            self._persist_arm(target_arm)

        elif event.metadata.get("is_reassignment"):
            target_arm["reassignments"] += 1

    def _persist_arm(self, arm: Dict[str, Any]):
        db.save_bandit_arm_state(
            experiment_id=self.experiment_id,
            variant_id=arm["variant"].variant_id,
            alpha=arm["alpha"],
            beta_param=arm["beta_param"],
            impressions=arm["impressions"],
            conversions=arm["conversions"],
            last_updated=arm["last_updated"]
        )

    def compute_analytics(self) -> MABAnalyticsReport:
        active_arms = list(self.arms.values())
        total_impressions = sum(a["impressions"] for a in active_arms)
        total_conversions = sum(a["conversions"] for a in active_arms)
        overall_cvr = total_conversions / max(1, total_impressions)

        has_sufficient_data = total_impressions >= self.min_sample_threshold

        # Monte Carlo simulations for posterior win probability
        num_sims = 2000
        sim_draws = np.zeros((num_sims, len(active_arms)))
        for idx, arm in enumerate(active_arms):
            sim_draws[:, idx] = np.random.beta(arm["alpha"], arm["beta_param"], size=num_sims)

        winning_indices = np.argmax(sim_draws, axis=1)
        win_counts = np.bincount(winning_indices, minlength=len(active_arms))
        win_probs = win_counts / num_sims

        arm_stats: List[ArmStatistics] = []
        leading_var_id = None
        best_expected_cvr = -1.0

        for idx, arm in enumerate(active_arms):
            cvr = arm["conversions"] / max(1, arm["impressions"])
            exp_reward = arm["alpha"] / (arm["alpha"] + arm["beta_param"])
            if exp_reward > best_expected_cvr:
                best_expected_cvr = exp_reward
                leading_var_id = arm["variant"].variant_id

            arm_stat = ArmStatistics(
                variant_id=arm["variant"].variant_id,
                opaque_id=arm["opaque_id"],
                variant_name=arm["variant"].name,
                variant_type=arm["variant"].variant_type,
                is_control=arm["variant"].is_control,
                impressions=arm["impressions"],
                conversions=arm["conversions"],
                conversion_rate=round(cvr, 4),
                alpha=round(arm["alpha"], 2),
                beta_param=round(arm["beta_param"], 2),
                win_probability=round(float(win_probs[idx]), 4),
                expected_reward=round(float(exp_reward), 4),
                is_leading=(arm["variant"].variant_id == leading_var_id)
            )
            arm_stats.append(arm_stat)

        estimated_regret = sum(
            arm["impressions"] * (best_expected_cvr - (arm["alpha"] / (arm["alpha"] + arm["beta_param"])))
            for arm in active_arms
        )

        leading_name = None
        for a in active_arms:
            if a["variant"].variant_id == leading_var_id:
                leading_name = a["variant"].name

        confidence = float(np.max(win_probs)) if len(win_probs) > 0 else 0.0

        if not has_sufficient_data:
            status_msg = f"Insufficient sample size ({total_impressions}/{self.min_sample_threshold} visits). Gathering exploratory traffic."
        elif confidence >= 0.95:
            status_msg = f"Statistically confident winner found: '{leading_name}' ({confidence*100:.1f}% confidence)."
        else:
            status_msg = f"Active exploration in progress. Leading candidate: '{leading_name}'."

        return MABAnalyticsReport(
            experiment_id=self.experiment_id,
            tenant_id=self.tenant_id,
            total_impressions=total_impressions,
            total_conversions=total_conversions,
            overall_conversion_rate=round(overall_cvr, 4),
            exploration_floor=self.exploration_floor,
            has_sufficient_data=has_sufficient_data,
            status_message=status_msg,
            arms=arm_stats,
            leading_variant_id=leading_var_id,
            leading_variant_name=leading_name,
            confidence_level=round(confidence, 4),
            estimated_cumulative_regret=round(estimated_regret, 2)
        )
