#!/usr/bin/env python3
"""
Interactive Multi-Tenant SaaS Platform Demonstration.
Demonstrates:
- Phase v1: Founder-directed macro experimentation, signed tokens, and Thompson Sampling MAB.
- Phase v1: Stripe dynamic pricing test, server-side price resolution, and idempotent webhook verification.
- Phase v2: Behavior-triggered personalized rescue offers & regulatory compliance logging.
- Phase v3: Autonomous anomaly detection with confounder adjustments.
- Factorial Combinations & Dimension Analytics: Multi-variable synthesis of top-performing Copy, Style, Component, and Pricing arms.
"""

import time
import random
from typing import Dict, Any

from saas_platform.models.schemas import (
    Tenant,
    Experiment,
    ExperimentType,
    GenerationMode,
    BrandGuidelines,
    DOMElement,
    TelemetryEventDTO,
    EventType,
    VariantType,
)
from saas_platform.models.database import db
from saas_platform.security.token_service import TokenService
from saas_platform.agents.orchestrator import AgentOrchestrator
from saas_platform.agents.combinatorial_agent import CombinatorialAgent
from saas_platform.guardrails.engine import GuardrailEngine
from saas_platform.bandit.thompson_sampling import MABEngine
from saas_platform.billing.stripe_service import StripeBillingService
from saas_platform.behavior.friction_engine import FrictionEngine
from saas_platform.autonomous.anomaly_engine import AnomalyDetectionEngine


def run_saas_simulation():
    print("=" * 95)
    print(" NERILABS SAAS — AUTONOMOUS EXPERIMENTATION & FACTORIAL OPTIMIZATION PLATFORM")
    print("=" * 95)

    # -------------------------------------------------------------
    # 1. Multi-Tenant Onboarding
    # -------------------------------------------------------------
    print("\n[Step 1] Multi-Tenant SaaS Tenant Initialization...")
    tenant = db.get_tenant_by_api_key("nerilabs_sk_live_9a8b7c6d5e4f3a2b1c")
    print(f"  ✓ Tenant Loaded: '{tenant.organization_name}' (ID: {tenant.tenant_id})")
    print(f"  ✓ API Key: {tenant.api_key}")
    print(f"  ✓ Pricing Disclosure Policy: {'Enforced' if tenant.pricing_disclosure_policy_enabled else 'Disabled'}")

    # -------------------------------------------------------------
    # 2. Phase v1: Founder-Directed Macro Test Creation & Guardrails
    # -------------------------------------------------------------
    print("\n[Step 2] Launching Phase v1: Multi-Modal Experiment Suite...")
    exp = Experiment(
        experiment_id="exp_saas_scale_macro",
        tenant_id=tenant.tenant_id,
        title="Homepage Hero Value Proposition & Trial CTA",
        experiment_type=ExperimentType.COPY_UI,
        generation_mode=GenerationMode.FOUNDER_DIRECTED,
        url="https://nerilabs.com",
        target_selector="#hero-cta",
        target_element=DOMElement(
            tag="button",
            element_id="hero-cta",
            selector="#hero-cta",
            inner_text="Get Started Free"
        ),
        brand_guidelines=BrandGuidelines(
            brand_name="NeriLabs",
            primary_color="#2563eb",
            accent_color="#f59e0b",
            prohibited_words=["scam", "cheap", "guarantee 100%", "hack", "miracle", "free money"]
        ),
        exploration_floor=0.10
    )
    db.save_experiment(exp)

    # Pre-computation caching
    print("  ↳ Pre-computing multi-modal variant suite (Copy, UI, Component)...")
    variants = AgentOrchestrator.generate_and_cache_experiment_suite(exp)
    print(f"  ✓ Generated {len(variants)} candidate variations.")

    # Guardrail Interdiction
    print("  ↳ Running Runtime Interdiction & Guardrail Suite (Security, Brand, WCAG AA, Clickability)...")
    mab = MABEngine(experiment_id=exp.experiment_id, tenant_id=tenant.tenant_id, exploration_floor=0.10)
    approved_count = 0
    rejected_count = 0

    for v in variants:
        report = GuardrailEngine.validate_variant(v, exp)
        if report.is_safe:
            mab.register_variant(v)
            approved_count += 1
            print(f"    ✓ [APPROVED] {v.name:44s} (Score: {report.score:.2f}, Checks: {len(report.audit_records)})")
        else:
            rejected_count += 1
            print(f"    ✗ [REJECTED] {v.name:44s} (Score: {report.score:.2f})")
            for reason in report.blocked_reasons:
                print(f"        ↳ Block Reason: {reason}")

    # -------------------------------------------------------------
    # 3. Dynamic Traffic Routing Simulation
    # -------------------------------------------------------------
    print(f"\n[Step 3] Routing Live Traffic via Thompson Sampling ({approved_count} Approved Arms + 10% Floor)...")
    
    true_cvr = {}
    for v in variants:
        if v.is_control:
            true_cvr[v.variant_id] = 0.045
        elif "Social Proof" in v.name:
            true_cvr[v.variant_id] = 0.135
        elif "Form" in v.name or "Capture" in v.name:
            true_cvr[v.variant_id] = 0.148
        elif "Pill" in v.name:
            true_cvr[v.variant_id] = 0.092
        elif "Contrast" in v.name:
            true_cvr[v.variant_id] = 0.120
        else:
            true_cvr[v.variant_id] = 0.065

    total_visitors = 800
    for i in range(1, total_visitors + 1):
        vid = f"vis_{i:04d}"
        sid = f"sess_{i:04d}"

        chosen_var, algorithm, sample_val = mab.select_variant_for_visitor(vid)
        signed_tok, _ = TokenService.issue_new_token(
            tenant_id=tenant.tenant_id,
            experiment_id=exp.experiment_id,
            session_id=sid,
            visitor_id=vid,
            variant=chosen_var
        )

        evt_impr = TelemetryEventDTO(event_type=EventType.IMPRESSION, tenant_id=tenant.tenant_id, experiment_id=exp.experiment_id, opaque_variant_id=chosen_var.opaque_id, visitor_id=vid, session_id=sid, signed_token=signed_tok)
        db.record_telemetry_event(evt_impr)
        mab.record_telemetry(evt_impr)

        p = true_cvr.get(chosen_var.variant_id, 0.05)
        if random.random() < p:
            evt_conv = TelemetryEventDTO(event_type=EventType.CONVERSION, tenant_id=tenant.tenant_id, experiment_id=exp.experiment_id, opaque_variant_id=chosen_var.opaque_id, visitor_id=vid, session_id=sid, signed_token=signed_tok, reward_value=1.0)
            db.record_telemetry_event(evt_conv)
            mab.record_telemetry(evt_conv)

    analytics = mab.compute_analytics()
    print(f"  ✓ Initial Traffic Run: {analytics.total_impressions} visits | {analytics.total_conversions} conversions | Blended CVR: {analytics.overall_conversion_rate*100:.2f}%")

    # -------------------------------------------------------------
    # 4. Dimension Analytics & Category Breakdown
    # -------------------------------------------------------------
    print("\n[Step 4] Category Dimension Breakdown & Performance Analysis...")
    dim_groups = {"COPY": [], "STYLE": [], "COMPONENT": []}
    for arm in analytics.arms:
        if arm.variant_type.value in dim_groups:
            dim_groups[arm.variant_type.value].append(arm)

    print(f"{'Category':<12} | {'Arms':<5} | {'Blended CVR':<12} | {'Top Winner':<36} | {'Lift vs Control'}")
    print("-" * 90)
    for dim_name, arm_list in dim_groups.items():
        t_impr = sum(a.impressions for a in arm_list)
        t_conv = sum(a.conversions for a in arm_list)
        cvr = t_conv / max(1, t_impr)
        best = max(arm_list, key=lambda a: (a.conversion_rate, a.impressions)) if arm_list else None
        lift = ((best.conversion_rate - 0.045) / 0.045) * 100.0 if best else 0.0
        print(f"{dim_name:<12} | {len(arm_list):<5} | {cvr*100:5.2f}%       | {best.variant_name[:34]:<36} | +{lift:5.1f}%")

    # -------------------------------------------------------------
    # 5. Factorial Combinations & Multivariate Hybrid Synthesis
    # -------------------------------------------------------------
    print("\n[Step 5] Synthesizing Factorial Combinations & Top-Performers Super-Hybrid...")
    composites = CombinatorialAgent.auto_synthesize_top_performers(exp, analytics.arms)
    print(f"  ✓ Auto-Synthesized {len(composites)} Top-Performers Super-Hybrid Arm:")
    for comp in composites:
        report = GuardrailEngine.validate_variant(comp, exp)
        if report.is_safe:
            db.save_variant(comp)
            mab.register_variant(comp)
            true_cvr[comp.variant_id] = 0.195 # High interaction lift!
            print(f"    ✓ [APPROVED COMPOSITE] {comp.name}")
            print(f"      ↳ Combined Hypothesis: {comp.hypothesis[:85]}...")

    # Route 400 additional visitors including the composite super-hybrid
    print("\n  ↳ Routing 400 additional visitors with composite arm active...")
    for i in range(total_visitors + 1, total_visitors + 401):
        vid = f"vis_{i:04d}"
        sid = f"sess_{i:04d}"
        chosen_var, _, _ = mab.select_variant_for_visitor(vid)
        
        evt_impr = TelemetryEventDTO(event_type=EventType.IMPRESSION, tenant_id=tenant.tenant_id, experiment_id=exp.experiment_id, opaque_variant_id=chosen_var.opaque_id, visitor_id=vid, session_id=sid)
        db.record_telemetry_event(evt_impr)
        mab.record_telemetry(evt_impr)

        p = true_cvr.get(chosen_var.variant_id, 0.05)
        if random.random() < p:
            evt_conv = TelemetryEventDTO(event_type=EventType.CONVERSION, tenant_id=tenant.tenant_id, experiment_id=exp.experiment_id, opaque_variant_id=chosen_var.opaque_id, visitor_id=vid, session_id=sid, reward_value=1.0)
            db.record_telemetry_event(evt_conv)
            mab.record_telemetry(evt_conv)

    final_analytics = mab.compute_analytics()

    # -------------------------------------------------------------
    # Final Multi-Armed Bandit Allocation Table
    # -------------------------------------------------------------
    print("\n" + "=" * 95)
    print(" FINAL MULTI-ARMED BANDIT ALLOCATION & CONVERGENCE REPORT")
    print("=" * 95)
    print(f"{'Variant Name':<46} | {'Type':<11} | {'Impr.':<7} | {'Conv.':<6} | {'CVR':<7} | {'Win Prob':<9}")
    print("-" * 95)
    for arm in sorted(final_analytics.arms, key=lambda a: a.impressions, reverse=True):
        mark = "👑 " if arm.is_leading else "   "
        print(f"{mark}{arm.variant_name:<43} | {arm.variant_type.value:<11} | {arm.impressions:<7} | {arm.conversions:<6} | {arm.conversion_rate*100:5.2f}% | {arm.win_probability*100:7.2f}%")

    print("\n✓ Factorial Experimentation & Dimension Analytics Simulation Complete!")


if __name__ == "__main__":
    run_saas_simulation()
