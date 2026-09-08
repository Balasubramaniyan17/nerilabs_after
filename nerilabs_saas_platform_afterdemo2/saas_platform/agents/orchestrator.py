"""
Generation Orchestrator & Pre-computation Engine.
Coordinates multi-modal generation agents ahead of time to ensure zero LLM latency
on the live user critical path (Constraint 5.1).
"""

import uuid
from typing import List
from saas_platform.models.schemas import (
    Experiment,
    Variant,
    VariantType,
    VariantStatus,
    GenerationMode,
)
from saas_platform.agents.copy_agent import CopyAgent
from saas_platform.agents.ui_agent import UIAgent
from saas_platform.agents.schema_agent import SchemaAgent
from saas_platform.models.database import db


class AgentOrchestrator:
    @classmethod
    def generate_and_cache_experiment_suite(cls, experiment: Experiment) -> List[Variant]:
        suite: List[Variant] = []

        # 1. Baseline Control Arm
        target_text = experiment.target_element.inner_text if experiment.target_element else "Get Started"
        control_variant = Variant(
            variant_id=f"var_control_{uuid.uuid4().hex[:6]}",
            experiment_id=experiment.experiment_id,
            tenant_id=experiment.tenant_id,
            name="Control (Baseline)",
            variant_type=VariantType.COPY,
            generation_mode=experiment.generation_mode,
            hypothesis="Baseline unchanged user experience.",
            is_control=True,
            copy_payload={
                "selector": experiment.target_selector,
                "original_text": target_text,
                "new_text": target_text,
                "trigger": "DEFAULT"
            },
            status=VariantStatus.APPROVED  # Baseline is pre-approved
        )
        suite.append(control_variant)

        # 2. Generate Copy Variants
        copy_variants = CopyAgent.generate_variants(experiment)
        suite.extend(copy_variants)

        # 3. Generate UI / Style / Component Variants
        ui_variants = UIAgent.generate_variants(experiment)
        suite.extend(ui_variants)

        # 4. Generate Schema/Onboarding Variants if applicable
        if experiment.experiment_type.value == "ONBOARDING_FUNNEL":
            schema_variants = SchemaAgent.generate_onboarding_variants(
                experiment,
                all_fields=["email", "password", "company_name", "company_size", "role_title", "phone_number"]
            )
            suite.extend(schema_variants)

        # Persist all generated variants in database
        for v in suite:
            db.save_variant(v)

        return suite
