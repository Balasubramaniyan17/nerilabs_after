"""
AI Behavioral Offer Agent.
Synthesizes creative, personalized promotional offers and dynamic single-session coupon codes
tailored to specific visitor friction signals (element hovered, dwell duration, traffic source, stage)
while strictly adhering to brand voice and maximum discount caps.
"""

import uuid
import secrets
import time
from typing import List, Dict, Any, Optional
from saas_platform.models.schemas import (
    Experiment,
    Variant,
    VariantType,
    PricingPlan,
    BrandGuidelines,
)
from saas_platform.agents.llm_client import LLMClient


class BehavioralOfferAgent:
    SYSTEM_PROMPT = """You are an AI Behavioral Pricing & Promotional Strategy Agent.
A website visitor is hesitating or abandoning the checkout/pricing page.
Synthesize creative, highly personalized, and non-generic promotional rescue offers.

Rules:
1. Do NOT generate generic "20% off" text. Create a unique, compelling value framing:
   - "Early Stage Founder Grant" (for startups/bootstrappers)
   - "Extended 30-Day Zero-Risk Sandbox" (for risk-averse developers)
   - "Feature Accelerator Pass" (highlighting high-value features)
   - "Annual Migration Credit" (offsetting switching costs)
2. Generate a unique, memorable single-session promo code format (e.g. SEED-GROWTH-8X, AI-SCALE-24, FOUNDER-ALPHA-99).
3. Adhere strictly to the brand voice and maximum discount cap.

Return JSON schema:
{
  "offers": [
    {
      "angle": "FOUNDER_GRANT",
      "promo_code": "FOUNDER-GRANT-2026",
      "headline": "🎁 Early Stage Founder Grant Unlocked",
      "body": "We noticed you exploring our growth tools. Apply our founder grant code for 25% off your first 3 months.",
      "discount_percent": 25,
      "cta_text": "Claim Founder Grant & Checkout →"
    }
  ]
}
"""

    @classmethod
    def generate_personalized_offers(
        cls,
        experiment: Experiment,
        friction_context: Dict[str, Any],
        max_discount_pct: int = 30
    ) -> List[Dict[str, Any]]:
        """
        Uses LLM to synthesize personalized behavioral rescue offers tailored to the visitor's friction signals.
        """
        brand = experiment.brand_guidelines
        target_el = experiment.target_element.inner_text if experiment.target_element else "Pricing Plan"

        dwell_time = friction_context.get("dwell_seconds", 10.0)
        hovered_item = friction_context.get("hovered_element", "Pro Pricing Tier")
        referrer = friction_context.get("referrer", "Direct Traffic")
        device = friction_context.get("device_type", "desktop")

        user_prompt = f"""
Target Element / Plan: "{target_el}"
Visitor Friction Signal: Dwelling on "{hovered_item}" for {dwell_time:.1f}s without clicking.
Traffic Source: {referrer} | Device: {device}
Brand Name: {brand.brand_name}
Brand Tone: {brand.tone_of_voice}
Max Discount Cap: {max_discount_pct}%
"""

        # 1. Attempt LLM Generation
        llm_response = LLMClient.call_structured_llm(
            system_prompt=cls.SYSTEM_PROMPT,
            user_prompt=user_prompt,
            temperature=0.75
        )

        offers = []
        if llm_response and "offers" in llm_response and isinstance(llm_response["offers"], list) and len(llm_response["offers"]) > 0:
            for item in llm_response["offers"]:
                discount = min(max_discount_pct, int(item.get("discount_percent", 20)))
                # Generate unique session code
                code_suffix = secrets.token_hex(2).upper()
                base_code = item.get("promo_code", "FOUNDER").split("-")[0]
                unique_code = f"{base_code}-{code_suffix}"

                offers.append({
                    "angle": item.get("angle", "PERSONALIZED_RESCUE"),
                    "promo_code": unique_code,
                    "headline": item.get("headline", "🎁 Exclusive Session Offer"),
                    "body": item.get("body", "Special promotional discount unlocked for your session."),
                    "discount_percent": discount,
                    "cta_text": item.get("cta_text", "Apply Discount & Continue →")
                })

        # 2. Fallback Creative Angles if LLM unavailable
        if not offers:
            offers = cls._generate_fallback_creative_offers(brand, max_discount_pct)

        return offers

    @classmethod
    def _generate_fallback_creative_offers(
        cls, brand: BrandGuidelines, max_discount_pct: int
    ) -> List[Dict[str, Any]]:
        code_rand = secrets.token_hex(2).upper()
        return [
            {
                "angle": "FOUNDER_GRANT",
                "promo_code": f"FOUNDER-GRANT-{code_rand}",
                "headline": "🚀 Early-Stage Founder Acceleration Grant",
                "body": f"Building from scratch? Claim our early-stage founder grant for {max_discount_pct}% off your first 3 months with {brand.brand_name}.",
                "discount_percent": min(max_discount_pct, 25),
                "cta_text": "Claim Founder Grant & Checkout →"
            },
            {
                "angle": "RISK_REVERSAL_EXTENDED",
                "promo_code": f"ZERO-RISK-{code_rand}",
                "headline": "🛡️ Extended 30-Day Zero-Risk Sandbox",
                "body": "Need more time to evaluate? Unlock a double 30-day trial plus 20% billing credit upon activation.",
                "discount_percent": 20,
                "cta_text": "Unlock 30-Day Sandbox →"
            },
            {
                "angle": "FEATURE_ACCELERATOR",
                "promo_code": f"SCALE-PASS-{code_rand}",
                "headline": "⚡ Priority AI Pipeline Accelerator Pass",
                "body": "Get instant access to our advanced guardrail interdiction and autonomous anomaly scanner with 20% off.",
                "discount_percent": 20,
                "cta_text": "Apply Accelerator Code →"
            }
        ]
