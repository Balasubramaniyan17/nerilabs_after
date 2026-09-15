"""
Schema & Onboarding Funnel Agent.
Uses LLMs to analyze customer form schemas, identify high-friction inputs,
and generate relaxed multi-step vs 1-step form variants with explicit synthetic
backfill defaults to preserve database NOT NULL constraints without corrupting CRM analytics.
"""

import uuid
from typing import List, Dict, Any
from saas_platform.models.schemas import (
    Experiment,
    Variant,
    VariantType,
    VariantStatus,
    OnboardingSchemaDef,
)
from saas_platform.agents.llm_client import LLMClient


class SchemaAgent:
    SCHEMA_SYSTEM_PROMPT = """You are a Principal Growth & Product Onboarding Engineer.
Given a list of database fields required during user signup, identify non-critical friction fields
that can be relaxed or deferred, and provide synthetic backfill defaults for database integrity.

Output Schema:
{
  "variants": [
    {
      "name": "Frictionless Minimal Signup",
      "hypothesis": "Deferring secondary company profile fields increases initial registration completion.",
      "required_fields": ["email", "password"],
      "relaxed_fields": ["company_size", "role_title", "phone_number"],
      "synthetic_backfills": {
        "company_size": "1-10 [synthetic]",
        "role_title": "Evaluator [synthetic]",
        "phone_number": "+10000000000 [synthetic]"
      }
    }
  ]
}
"""

    @classmethod
    def generate_onboarding_variants(
        cls, experiment: Experiment, all_fields: List[str]
    ) -> List[Variant]:
        user_prompt = f"""
Signup Form Database Fields: {', '.join(all_fields)}
Target URL: {experiment.url}
Goal: Reduce signup drop-off while preserving database constraints.
"""

        # 1. Attempt LLM Generation
        llm_response = LLMClient.call_structured_llm(
            system_prompt=cls.SCHEMA_SYSTEM_PROMPT,
            user_prompt=user_prompt,
            temperature=0.5
        )

        variants: List[Variant] = []

        if llm_response and "variants" in llm_response and isinstance(llm_response["variants"], list) and len(llm_response["variants"]) > 0:
            for item in llm_response["variants"]:
                name = item.get("name", "Relaxed Onboarding Form")
                hypothesis = item.get("hypothesis", "Relaxing secondary form inputs increases completion velocity.")
                req_fields = item.get("required_fields", ["email", "password"])
                relaxed_fields = item.get("relaxed_fields", [])
                backfills = item.get("synthetic_backfills", {})

                schema_def = OnboardingSchemaDef(
                    step_id="step_signup_llm",
                    required_fields=req_fields,
                    optional_fields=[],
                    relaxed_fields=relaxed_fields,
                    synthetic_backfills=backfills
                )

                var = Variant(
                    variant_id=f"var_schema_llm_{uuid.uuid4().hex[:6]}",
                    experiment_id=experiment.experiment_id,
                    tenant_id=experiment.tenant_id,
                    name=f"Funnel: {name}",
                    variant_type=VariantType.ONBOARDING_SCHEMA,
                    generation_mode=experiment.generation_mode,
                    hypothesis=hypothesis,
                    onboarding_payload=schema_def,
                    status=VariantStatus.DRAFT
                )
                variants.append(var)

        # 2. Fallback Generation
        if not variants:
            variants = cls._generate_fallback_variants(experiment, all_fields)

        return variants

    @classmethod
    def _generate_fallback_variants(cls, experiment: Experiment, all_fields: List[str]) -> List[Variant]:
        relaxed = [f for f in all_fields if f not in ["email", "password"]]
        backfills = {}
        for f in relaxed:
            if f == "company_name":
                backfills[f] = "Default Workspace [synthetic]"
            elif f == "company_size":
                backfills[f] = "1-10 [synthetic]"
            elif f == "phone_number":
                backfills[f] = "+10000000000 [synthetic]"
            elif f == "role_title":
                backfills[f] = "Evaluator [synthetic]"
            else:
                backfills[f] = "N/A [synthetic]"

        schema_def = OnboardingSchemaDef(
            step_id="step_signup_minimal",
            required_fields=["email", "password"],
            optional_fields=[],
            relaxed_fields=relaxed,
            synthetic_backfills=backfills
        )

        var = Variant(
            variant_id=f"var_schema_minimal_{uuid.uuid4().hex[:6]}",
            experiment_id=experiment.experiment_id,
            tenant_id=experiment.tenant_id,
            name="Funnel: Frictionless Minimal Signup (2 Fields)",
            variant_type=VariantType.ONBOARDING_SCHEMA,
            generation_mode=experiment.generation_mode,
            hypothesis="Removing secondary form fields at initial signup increases completion rate without dropping account activation.",
            onboarding_payload=schema_def,
            status=VariantStatus.DRAFT
        )
        return [var]
