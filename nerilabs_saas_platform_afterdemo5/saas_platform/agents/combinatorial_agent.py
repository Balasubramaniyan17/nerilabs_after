"""
Combinatorial & Factorial Variant Synthesis Agent.
Combines isolated Copy, Style/UI, Component, and Pricing variations into unified
Multivariate / Composite variants to test interaction effects and identify high-performing hybrids.
"""

import uuid
import itertools
from typing import List, Dict, Optional, Any, Tuple
from saas_platform.models.schemas import (
    Experiment,
    Variant,
    VariantType,
    VariantStatus,
    GenerationMode,
    PricingPlan,
)
from saas_platform.models.database import db
from saas_platform.guardrails.engine import GuardrailEngine


class CombinatorialAgent:
    @classmethod
    def synthesize_custom_combinations(
        cls,
        experiment: Experiment,
        copy_variants: List[Variant],
        style_variants: List[Variant],
        component_variants: List[Variant],
        pricing_variants: List[Variant]
    ) -> List[Variant]:
        """
        Generates composite variants from the provided lists of single-dimension variants.
        """
        c_list = copy_variants if copy_variants else [None]
        s_list = style_variants if style_variants else [None]
        cmp_list = component_variants if component_variants else [None]
        p_list = pricing_variants if pricing_variants else [None]

        composites: List[Variant] = []

        for copy_var, style_var, comp_var, price_var in itertools.product(c_list, s_list, cmp_list, p_list):
            present_count = sum(1 for x in [copy_var, style_var, comp_var, price_var] if x is not None)
            if present_count < 2:
                continue

            names = []
            hypotheses = []
            copy_payload = None
            style_payload = None
            comp_payload = None
            pricing_payload = None

            if copy_var:
                names.append(copy_var.name.replace("Copy: ", ""))
                text = copy_var.copy_payload.get('new_text', '') if isinstance(copy_var.copy_payload, dict) else ''
                hypotheses.append(f"copy framing '{text}'")
                copy_payload = copy_var.copy_payload

            if style_var:
                names.append(style_var.name.replace("UI: ", "").replace("Style: ", ""))
                hypotheses.append(f"visual styling '{style_var.name}'")
                style_payload = style_var.style_payload

            if comp_var:
                names.append(comp_var.name.replace("Component: ", ""))
                hypotheses.append(f"component structure '{comp_var.name}'")
                comp_payload = comp_var.component_payload

            if price_var and price_var.pricing_payload:
                if isinstance(price_var.pricing_payload, dict):
                    cents = price_var.pricing_payload.get("price_amount_cents", 4900)
                    pricing_payload = PricingPlan(**price_var.pricing_payload)
                else:
                    cents = price_var.pricing_payload.price_amount_cents
                    pricing_payload = price_var.pricing_payload

                names.append(f"${cents/100:.0f}/mo")
                hypotheses.append(f"pricing point ${cents/100:.0f}/mo")

            composite_name = " + ".join(names)
            combined_hypothesis = f"Multivariate interaction effect: Combining {' with '.join(hypotheses)} produces reinforcing conversion lift."

            var_id = f"var_composite_{uuid.uuid4().hex[:6]}"
            opaque_id = f"opq_comp_{uuid.uuid4().hex[:6]}"

            composite_variant = Variant(
                variant_id=var_id,
                opaque_id=opaque_id,
                experiment_id=experiment.experiment_id,
                tenant_id=experiment.tenant_id,
                name=f"🔀 Composite: {composite_name}",
                variant_type=VariantType.COMPOSITE,
                generation_mode=experiment.generation_mode,
                hypothesis=combined_hypothesis,
                copy_payload=copy_payload,
                style_payload=style_payload,
                component_payload=comp_payload,
                pricing_payload=pricing_payload,
                status=VariantStatus.DRAFT
            )
            composites.append(composite_variant)

        return composites

    @classmethod
    def auto_synthesize_top_performers(
        cls,
        experiment: Experiment,
        arm_stats_list: List[Any]
    ) -> List[Variant]:
        variants = db.list_variants_for_experiment(experiment.experiment_id)
        variant_map = {v.variant_id: v for v in variants}

        best_copy = None
        best_style = None
        best_comp = None
        best_pricing = None

        qualified_arms = [a for a in arm_stats_list if not a.is_control and a.impressions >= 1]
        sorted_arms = sorted(qualified_arms, key=lambda a: (a.conversion_rate, a.impressions), reverse=True)

        for arm in sorted_arms:
            v = variant_map.get(arm.variant_id)
            if not v:
                continue
            if v.variant_type == VariantType.COPY and not best_copy:
                best_copy = v
            elif v.variant_type == VariantType.STYLE and not best_style:
                best_style = v
            elif v.variant_type == VariantType.COMPONENT and not best_comp:
                best_comp = v
            elif v.variant_type == VariantType.PRICING and not best_pricing:
                best_pricing = v

        if not best_copy:
            best_copy = next((v for v in variants if v.variant_type == VariantType.COPY and not v.is_control and v.status == "APPROVED"), None)
        if not best_style:
            best_style = next((v for v in variants if v.variant_type == VariantType.STYLE and v.status == "APPROVED"), None)
        if not best_comp:
            best_comp = next((v for v in variants if v.variant_type == VariantType.COMPONENT and v.status == "APPROVED"), None)
        if not best_pricing:
            best_pricing = next((v for v in variants if v.variant_type == VariantType.PRICING and v.status == "APPROVED"), None)

        selected_elements = [x for x in [best_copy, best_style, best_comp, best_pricing] if x is not None]
        if len(selected_elements) < 2:
            return []

        return cls.synthesize_custom_combinations(
            experiment=experiment,
            copy_variants=[best_copy] if best_copy else [],
            style_variants=[best_style] if best_style else [],
            component_variants=[best_comp] if best_comp else [],
            pricing_variants=[best_pricing] if best_pricing else []
        )
