"""
UI & Layout Generation Agent.
Uses Code-Generation LLMs to synthesize structured JSON CSS token diffs
and component layout modifications adhering strictly to brand design systems.
"""

import uuid
from typing import List, Dict, Any
from saas_platform.models.schemas import (
    Experiment,
    Variant,
    VariantType,
    VariantStatus,
)
from saas_platform.agents.llm_client import LLMClient


class UIAgent:
    UI_SYSTEM_PROMPT = """You are a Principal UI/UX Design Systems Code-Generation Agent.
Given a target web element and brand palette guidelines, generate modern CSS modifications.

Rules:
1. Do NOT generate open-ended or dangerous CSS. Use only valid CSS declarations.
2. Ensure high contrast and WCAG 2.1 AA accessibility.
3. Align with brand primary and accent colors.
4. Output JSON with a "variants" array:
{
  "variants": [
    {
      "name": "High-Contrast Accent Elevation",
      "hypothesis": "Increasing visual hierarchy through accent color and shadow draws user focus.",
      "css_rules": {
        "background-color": "#f59e0b",
        "color": "#ffffff",
        "font-weight": "700",
        "box-shadow": "0 10px 15px -3px rgba(0, 0, 0, 0.12)",
        "border": "none"
      }
    }
  ]
}
"""

    @classmethod
    def generate_variants(cls, experiment: Experiment) -> List[Variant]:
        brand = experiment.brand_guidelines
        target_selector = experiment.target_selector

        user_prompt = f"""
Target CSS Selector: {target_selector}
Target Element Tag: {experiment.target_element.tag if experiment.target_element else 'button'}
Brand Primary Color: {brand.primary_color}
Brand Secondary Color: {brand.secondary_color}
Brand Accent Color: {brand.accent_color}
Brand Text Color: {brand.text_color}
Brand Background: {brand.background_color}
"""

        # 1. Attempt LLM Generation
        llm_response = LLMClient.call_structured_llm(
            system_prompt=cls.UI_SYSTEM_PROMPT,
            user_prompt=user_prompt,
            temperature=0.6
        )

        variants: List[Variant] = []

        if llm_response and "variants" in llm_response and isinstance(llm_response["variants"], list) and len(llm_response["variants"]) > 0:
            for item in llm_response["variants"]:
                name = item.get("name", "UI Style Variation")
                hypothesis = item.get("hypothesis", "Optimizing visual hierarchy and contrast.")
                css_rules = item.get("css_rules", {})

                if not css_rules:
                    continue

                raw_css = f"{target_selector} {{ {'; '.join(f'{k}: {v}' for k, v in css_rules.items())}; }}"

                var = Variant(
                    variant_id=f"var_style_llm_{uuid.uuid4().hex[:6]}",
                    experiment_id=experiment.experiment_id,
                    tenant_id=experiment.tenant_id,
                    name=f"UI: {name}",
                    variant_type=VariantType.STYLE,
                    generation_mode=experiment.generation_mode,
                    hypothesis=hypothesis,
                    style_payload={
                        "selector": target_selector,
                        "css_rules": css_rules,
                        "raw_css": raw_css
                    },
                    status=VariantStatus.DRAFT
                )
                variants.append(var)

        # 2. Fallback UI & Component Variations
        if not variants:
            variants = cls._generate_fallback_variants(experiment)

        return variants

    @classmethod
    def _generate_fallback_variants(cls, experiment: Experiment) -> List[Variant]:
        variants = []
        target_selector = experiment.target_selector
        brand = experiment.brand_guidelines

        # High Contrast Accent
        high_contrast_css = {
            "background-color": brand.accent_color or "#f59e0b",
            "color": "#ffffff",
            "font-weight": "700",
            "box-shadow": "0 10px 15px -3px rgba(0, 0, 0, 0.12), 0 4px 6px -2px rgba(0, 0, 0, 0.05)",
            "border": "none",
            "transform": "scale(1.02)",
            "transition": "all 0.2s ease-in-out"
        }
        variants.append(
            Variant(
                variant_id=f"var_style_contrast_{uuid.uuid4().hex[:6]}",
                experiment_id=experiment.experiment_id,
                tenant_id=experiment.tenant_id,
                name="UI: High-Contrast Accent Elevation",
                variant_type=VariantType.STYLE,
                generation_mode=experiment.generation_mode,
                hypothesis="Enhancing visual hierarchy through accent color and shadow elevation guides user attention directly to the CTA.",
                style_payload={
                    "selector": target_selector,
                    "css_rules": high_contrast_css,
                    "raw_css": f"{target_selector} {{ {'; '.join(f'{k}: {v}' for k, v in high_contrast_css.items())}; }}"
                },
                status=VariantStatus.DRAFT
            )
        )

        # Modern Rounded Pill Geometry
        pill_css = {
            "background-color": brand.primary_color or "#2563eb",
            "color": "#ffffff",
            "border-radius": "9999px",
            "padding": "14px 32px",
            "font-weight": "600",
            "box-shadow": "0 4px 6px -1px rgba(37, 99, 235, 0.25)",
            "border": "none"
        }
        variants.append(
            Variant(
                variant_id=f"var_style_pill_{uuid.uuid4().hex[:6]}",
                experiment_id=experiment.experiment_id,
                tenant_id=experiment.tenant_id,
                name="UI: Modern Rounded Pill Geometry",
                variant_type=VariantType.STYLE,
                generation_mode=experiment.generation_mode,
                hypothesis="A modern pill geometry with soft brand elevation creates an approachable, lower-friction click target.",
                style_payload={
                    "selector": target_selector,
                    "css_rules": pill_css,
                    "raw_css": f"{target_selector} {{ {'; '.join(f'{k}: {v}' for k, v in pill_css.items())}; }}"
                },
                status=VariantStatus.DRAFT
            )
        )

        # Component Fast-Capture
        target_text = experiment.target_element.inner_text if experiment.target_element else "Get Started"
        component_html = f"""
<div class="ai-opt-component-wrapper" style="display: flex; gap: 8px; max-width: 480px; margin: 12px 0;">
    <input type="email" placeholder="Enter your work email" style="flex: 1; padding: 12px 16px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 15px;" required />
    <button class="ai-opt-submit-btn" style="background-color: {brand.primary_color}; color: #ffffff; padding: 12px 20px; border-radius: 8px; font-weight: 600; border: none; cursor: pointer;">
        {target_text}
    </button>
</div>
        """.strip()

        variants.append(
            Variant(
                variant_id=f"var_comp_leadform_{uuid.uuid4().hex[:6]}",
                experiment_id=experiment.experiment_id,
                tenant_id=experiment.tenant_id,
                name="Component: Inline Fast-Capture Form",
                variant_type=VariantType.COMPONENT,
                generation_mode=experiment.generation_mode,
                hypothesis="Embedding the email capture field directly into the hero section reduces click-through friction.",
                component_payload={
                    "selector": target_selector,
                    "component_name": "InlineFastCapture",
                    "replacement_html": component_html,
                    "props": {"placeholder": "Enter your work email", "cta_text": target_text}
                },
                status=VariantStatus.DRAFT
            )
        )

        return variants
