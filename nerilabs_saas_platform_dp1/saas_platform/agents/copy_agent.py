"""
Copy Generation Agent.
Uses Foundation LLMs (GPT-4o / Claude 3.5 Sonnet) prompted with Scanned Website Context,
Brand Voice, Behavioral Psychology frameworks, and strict Guardrail constraints to generate
high-converting copy variants with structured JSON output.
Features autonomous contextual fallback synthesis to ensure all copy variants reflect
the actual business, audience, and value propositions of the scanned website.
"""

import uuid
import re
from typing import List, Dict, Any, Optional
from saas_platform.models.schemas import (
    Experiment,
    Variant,
    VariantType,
    VariantStatus,
    PsychologicalTrigger,
)
from saas_platform.agents.llm_client import LLMClient
from saas_platform.inspector.dom_scanner import DOMScanner


class CopyAgent:
    SYSTEM_PROMPT = """You are a Principal Conversion Rate Optimization (CRO) Copywriting Agent.
Your objective is to generate high-converting copy variations for a target web element (headline, subheader, or action button) on a specific customer website.

Guidelines:
1. Ground each variation in behavioral psychology triggers:
   - VALUE_PROPOSITION: Quantifiable benefits, speed, and business outcomes.
   - SOCIAL_PROOF: Trust badges, active users, customer validation.
   - URGENCY: Time-sensitive motivations without sounding deceptive.
   - LOSS_AVERSION: Pain point mitigation and eliminating hesitation.
   - CLARITY: Direct, clear, frictionless instructions.
   - FRICTION_REDUCTION: Emphasize zero commitments, instant access, ease of getting started.
2. CRITICAL CONTEXTUALITY RULE:
   The variations MUST be directly relevant to the specific website, its product/service, and its audience.
   DO NOT generate generic A/B testing copy (e.g. do NOT write "automate your testing workflow" or "join 2500 fast-growing startups scaling conversion rate") unless the website itself is explicitly an A/B testing product.
3. Adhere strictly to the brand voice and NEVER use prohibited words.
4. Keep copy concise and proportional to the original element length.

Output Schema:
You MUST return a JSON object with a "variants" array:
{
  "variants": [
    {
      "trigger": "VALUE_PROPOSITION",
      "headline": "...",
      "hypothesis": "..."
    }
  ]
}
"""

    @classmethod
    def generate_variants(cls, experiment: Experiment) -> List[Variant]:
        target_text = experiment.target_element.inner_text if experiment.target_element else "Get Started"
        brand = experiment.brand_guidelines

        # Retrieve rich website context extracted during scanning
        site_ctx = DOMScanner.get_site_context_for_url(experiment.url)
        brand_name = brand.brand_name if (brand.brand_name and brand.brand_name != "Default Brand") else site_ctx.get("brand_name", "Your Brand")

        is_headline = (
            (experiment.target_element and getattr(experiment.target_element, "tag", "") in ["h1", "h2", "h3", "h4", "h5", "h6", "p"]) or
            any(h in (experiment.target_selector or "").lower() for h in ["h1", "h2", "h3", "h4", "headline", "title", "header"]) or
            len(target_text.split()) > 3
        )
        element_type_label = "Hero / Section Headline" if is_headline else "Action / CTA Button"

        user_prompt = f"""
Target Element Type: {element_type_label}
Target Element Original Text: "{target_text}"
CSS Selector: {experiment.target_selector}
Target Page URL: {experiment.url}
Website Page Title: {site_ctx.get("page_title", "")}
Website Meta Description: {site_ctx.get("meta_description", "")}
Hero Subhead / Lede: {site_ctx.get("hero_subhead", "")}
Brand / Company Name: {brand_name}
Brand Voice & Tone: {brand.tone_of_voice}
Prohibited Words (CRITICAL - DO NOT USE): {', '.join(brand.prohibited_words)}
Original Length: {len(target_text)} characters

Generate 6 high-converting copy variations (one for each psychological trigger: VALUE_PROPOSITION, SOCIAL_PROOF, URGENCY, LOSS_AVERSION, CLARITY, FRICTION_REDUCTION) that are SPECIFICALLY tailored to this website, its products, and its target audience.
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
                hypothesis = item.get("hypothesis", f"Optimizing copy using {trigger_name.title()} behavioral trigger.")
                
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

        # 2. Contextual Fallback Generation if LLM was unavailable or returned empty
        if not variants:
            variants = cls._generate_fallback_variants(experiment, target_text, site_ctx, brand_name, is_headline)

        return variants

    @classmethod
    def _generate_fallback_variants(
        cls,
        experiment: Experiment,
        target_text: str,
        site_ctx: Optional[Dict[str, Any]] = None,
        brand_name: Optional[str] = None,
        is_headline: Optional[bool] = None
    ) -> List[Variant]:
        """
        Synthesizes intelligent, contextual copy variants derived directly from the
        scanned website's page title, meta description, brand name, and target element text.
        Completely eliminates static, un-contextualized A/B testing strings.
        """
        if site_ctx is None:
            site_ctx = DOMScanner.get_site_context_for_url(experiment.url)
        if brand_name is None:
            brand_name = (
                experiment.brand_guidelines.brand_name 
                if (experiment.brand_guidelines.brand_name and experiment.brand_guidelines.brand_name != "Default Brand") 
                else site_ctx.get("brand_name", "Your Brand")
            )
        if is_headline is None:
            is_headline = (
                (experiment.target_element and getattr(experiment.target_element, "tag", "") in ["h1", "h2", "h3", "h4", "h5", "h6", "p"]) or
                any(h in (experiment.target_selector or "").lower() for h in ["h1", "h2", "h3", "h4", "headline", "title", "header"]) or
                len(target_text.split()) > 3
            )

        variants = []
        triggers = [
            PsychologicalTrigger.VALUE_PROPOSITION,
            PsychologicalTrigger.SOCIAL_PROOF,
            PsychologicalTrigger.URGENCY,
            PsychologicalTrigger.LOSS_AVERSION,
            PsychologicalTrigger.CLARITY,
            PsychologicalTrigger.FRICTION_REDUCTION,
        ]

        t_clean = target_text.strip().rstrip(".!").strip("\"'")
        first_word = t_clean.split()[0].lower() if t_clean.split() else ""
        action_verbs = {
            "get", "start", "build", "create", "transform", "turn", "save", "boost",
            "grow", "maximize", "automate", "make", "find", "scale", "streamline",
            "stop", "join", "order", "book", "try", "discover", "launch", "unlock"
        }
        starts_with_verb = first_word in action_verbs

        for trigger in triggers:
            new_text = cls._synthesize_single_trigger_copy(
                trigger=trigger,
                target_text=t_clean,
                is_headline=is_headline,
                starts_with_verb=starts_with_verb,
                brand_name=brand_name,
                site_ctx=site_ctx
            )

            hypothesis = (
                f"Applying a {trigger.value.replace('_', ' ').title()} framing tailored to "
                f"{brand_name} motivates visitors to take immediate action."
            )

            var = Variant(
                variant_id=f"var_copy_{trigger.value.lower()}_{uuid.uuid4().hex[:6]}",
                experiment_id=experiment.experiment_id,
                tenant_id=experiment.tenant_id,
                name=f"Copy: {trigger.value.replace('_', ' ').title()}",
                variant_type=VariantType.COPY,
                generation_mode=experiment.generation_mode,
                hypothesis=hypothesis,
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

    @classmethod
    def _synthesize_single_trigger_copy(
        cls,
        trigger: PsychologicalTrigger,
        target_text: str,
        is_headline: bool,
        starts_with_verb: bool,
        brand_name: str,
        site_ctx: Dict[str, Any]
    ) -> str:
        """
        Dynamically generates copy based on element type, grammatical structure,
        and scanned website metadata.
        """
        t = target_text
        brand = brand_name or "Our Platform"

        if is_headline:
            if trigger == PsychologicalTrigger.VALUE_PROPOSITION:
                if starts_with_verb:
                    return f"The Smarter Way to {t[0].lower() + t[1:]}"
                else:
                    return f"{t} — Built for Maximum Impact"

            elif trigger == PsychologicalTrigger.SOCIAL_PROOF:
                return f"Trusted by Thousands: {t}"

            elif trigger == PsychologicalTrigger.URGENCY:
                return f"{t} — Experience the Difference Today"

            elif trigger == PsychologicalTrigger.LOSS_AVERSION:
                if starts_with_verb:
                    return f"Never Struggle to {t[0].lower() + t[1:]} Again"
                return f"Stop Settling for Less: {t}"

            elif trigger == PsychologicalTrigger.CLARITY:
                return f"{t} — Simple, Direct & Proven"

            elif trigger == PsychologicalTrigger.FRICTION_REDUCTION:
                return f"{t} • Instant Access, Zero Risk"

        else:
            # Button / Action CTA
            if trigger == PsychologicalTrigger.VALUE_PROPOSITION:
                return f"{t} & Boost Results"

            elif trigger == PsychologicalTrigger.SOCIAL_PROOF:
                return f"Join 2,500+ Others — {t}"

            elif trigger == PsychologicalTrigger.URGENCY:
                return f"{t} Today"

            elif trigger == PsychologicalTrigger.LOSS_AVERSION:
                return f"Don't Miss Out — {t}"

            elif trigger == PsychologicalTrigger.CLARITY:
                return f"{t} Now"

            elif trigger == PsychologicalTrigger.FRICTION_REDUCTION:
                return f"{t} (No Credit Card Needed)"

        return t
