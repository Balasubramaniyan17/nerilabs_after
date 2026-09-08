"""
Copy Generation Agent.
Uses Foundation LLMs (GPT-4o / Claude 3.5 Sonnet) prompted with Brand Voice,
Behavioral Psychology frameworks, and strict Guardrail constraints to generate
high-converting copy variants with structured JSON output.
"""

import uuid
from typing import List, Dict, Any, Optional
from saas_platform.models.schemas import (
    Experiment,
    Variant,
    VariantType,
    VariantStatus,
    PsychologicalTrigger,
)
from saas_platform.agents.llm_client import LLMClient


class CopyAgent:
    SYSTEM_PROMPT = """You are a Principal Conversion Rate Optimization (CRO) Copywriting Agent.
Your objective is to generate high-converting copy variations for a target web element (button, hero headline, or subheader).

Guidelines:
1. Ground each variation in behavioral psychology triggers:
   - VALUE_PROPOSITION: Quantifiable benefits, speed, and business outcomes.
   - SOCIAL_PROOF: Trust badges, active users, customer validation.
   - URGENCY: Time-sensitive motivations without sounding deceptive.
   - LOSS_AVERSION: Pain point mitigation and eliminating conversion leaks.
   - CLARITY: Direct, clear, frictionless instructions.
   - FRICTION_REDUCTION: Emphasize zero commitments, instant setup, no credit card required.
2. Adhere strictly to the brand voice and NEVER use prohibited words.
3. Keep copy concise and proportional to the original element length.

Output Schema:
You MUST return a JSON object with a "variants" array:
{
  "variants": [
    {
      "trigger": "SOCIAL_PROOF",
      "headline": "Join 2,500+ fast-growing startups",
      "hypothesis": "Providing peer validation reduces conversion hesitation."
    }
  ]
}
"""

    FALLBACK_PATTERNS = {
        PsychologicalTrigger.VALUE_PROPOSITION: "Automate your testing workflow with zero engineering overhead",
        PsychologicalTrigger.SOCIAL_PROOF: "Join 2,500+ fast-growing startups scaling conversion rates",
        PsychologicalTrigger.URGENCY: "Start optimizing today — deploy your first test in 2 minutes",
        PsychologicalTrigger.LOSS_AVERSION: "Stop losing 80% of your paid traffic to unoptimized landing pages",
        PsychologicalTrigger.CLARITY: "Get Started Free — No Credit Card Required",
        PsychologicalTrigger.FRICTION_REDUCTION: "Instant 1-Click Setup • No Developers Needed",
    }

    @classmethod
    def generate_variants(cls, experiment: Experiment) -> List[Variant]:
        target_text = experiment.target_element.inner_text if experiment.target_element else "Get Started"
        brand = experiment.brand_guidelines

        user_prompt = f"""
Target Element Text: "{target_text}"
CSS Selector: {experiment.target_selector}
Target Page URL: {experiment.url}
Brand Name: {brand.brand_name}
Brand Voice & Tone: {brand.tone_of_voice}
Prohibited Words (CRITICAL - DO NOT USE): {', '.join(brand.prohibited_words)}
Original Length: {len(target_text)} characters
"""

        # 1. Attempt LLM Generation
        llm_response = LLMClient.call_structured_llm(
            system_prompt=cls.SYSTEM_PROMPT,
            user_prompt=user_prompt,
            temperature=0.7
        )

        variants: List[Variant] = []

        if llm_response and "variants" in llm_response and isinstance(llm_response["variants"], list) and len(llm_response["variants"]) > 0:
            for item in llm_response["variants"]:
                trigger_name = item.get("trigger", "DEFAULT").upper()
                headline = item.get("headline", "").strip()
                hypothesis = item.get("hypothesis", "Optimizing copy based on behavioral triggers.")
                
                if not headline:
                    continue

                var = Variant(
                    variant_id=f"var_copy_{trigger_name.lower()}_{uuid.uuid4().hex[:6]}",
                    experiment_id=experiment.experiment_id,
                    tenant_id=experiment.tenant_id,
                    name=f"Copy: {trigger_name.replace('_', ' ').title()}",
                    variant_type=VariantType.COPY,
                    generation_mode=experiment.generation_mode,
                    hypothesis=hypothesis,
                    copy_payload={
                        "selector": experiment.target_selector,
                        "original_text": target_text,
                        "new_text": headline,
                        "trigger": trigger_name
                    },
                    status=VariantStatus.DRAFT
                )
                variants.append(var)

        # 2. Fallback Generation if LLM was unavailable or returned empty
        if not variants:
            variants = cls._generate_fallback_variants(experiment, target_text)

        return variants

    @classmethod
    def _generate_fallback_variants(cls, experiment: Experiment, target_text: str) -> List[Variant]:
        variants = []
        is_button = len(target_text.split()) <= 3

        triggers = [
            PsychologicalTrigger.VALUE_PROPOSITION,
            PsychologicalTrigger.SOCIAL_PROOF,
            PsychologicalTrigger.URGENCY,
            PsychologicalTrigger.LOSS_AVERSION,
            PsychologicalTrigger.CLARITY,
            PsychologicalTrigger.FRICTION_REDUCTION,
        ]

        button_templates = {
            PsychologicalTrigger.VALUE_PROPOSITION: "Start Converting Traffic",
            PsychologicalTrigger.SOCIAL_PROOF: "Join 2,500+ Founders",
            PsychologicalTrigger.URGENCY: "Get Started Today",
            PsychologicalTrigger.LOSS_AVERSION: "Stop Losing Leads",
            PsychologicalTrigger.CLARITY: "Try It Free Now",
            PsychologicalTrigger.FRICTION_REDUCTION: "Start Free (No Card Needed)",
        }

        for trigger in triggers:
            new_text = button_templates[trigger] if is_button else cls.FALLBACK_PATTERNS[trigger]
            var = Variant(
                variant_id=f"var_copy_{trigger.value.lower()}_{uuid.uuid4().hex[:6]}",
                experiment_id=experiment.experiment_id,
                tenant_id=experiment.tenant_id,
                name=f"Copy: {trigger.value.replace('_', ' ').title()}",
                variant_type=VariantType.COPY,
                generation_mode=experiment.generation_mode,
                hypothesis=f"Applying a {trigger.value.replace('_', ' ').title()} framing will motivate action.",
                copy_payload={
                    "selector": experiment.target_selector,
                    "original_text": target_text,
                    "new_text": new_text,
                    "trigger": trigger.value
                },
                status=VariantStatus.DRAFT
            )
            variants.append(var)

        return variants
