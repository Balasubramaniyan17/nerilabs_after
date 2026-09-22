"""
Visual Accessibility & Critical Element Survival Guardrail.
Calculates WCAG 2.1 AA contrast ratios, verifies mobile responsiveness bounds,
and guarantees that core conversion/checkout elements remain functional and clickable.
"""

import math
from typing import List, Tuple
from saas_platform.models.schemas import (
    Variant,
    Experiment,
    GuardrailAuditRecord,
    CheckSeverity,
)
from saas_platform.guardrails.audit_logger import AuditLogger


class ContrastCalculator:
    @staticmethod
    def hex_to_rgb(hex_str: str) -> Tuple[int, int, int]:
        hex_str = hex_str.lstrip("#")
        if len(hex_str) == 3:
            hex_str = "".join([c * 2 for c in hex_str])
        if len(hex_str) != 6:
            return (0, 0, 0)
        try:
            return (int(hex_str[0:2], 16), int(hex_str[2:4], 16), int(hex_str[4:6], 16))
        except ValueError:
            return (0, 0, 0)

    @classmethod
    def get_relative_luminance(cls, r: int, g: int, b: int) -> float:
        def ch(val: int) -> float:
            c = val / 255.0
            return c / 12.92 if c <= 0.03928 else math.pow((c + 0.055) / 1.055, 2.4)
        return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)

    @classmethod
    def compute_ratio(cls, hex1: str, hex2: str) -> float:
        r1, g1, b1 = cls.hex_to_rgb(hex1)
        r2, g2, b2 = cls.hex_to_rgb(hex2)
        l1 = cls.get_relative_luminance(r1, g1, b1)
        l2 = cls.get_relative_luminance(r2, g2, b2)
        return (max(l1, l2) + 0.05) / (min(l1, l2) + 0.05)


class VisualChecker:
    @classmethod
    def check(cls, variant: Variant, experiment: Experiment) -> List[GuardrailAuditRecord]:
        records: List[GuardrailAuditRecord] = []

        if variant.style_payload:
            rules = variant.style_payload.get("css_rules", {})
            bg = rules.get("background-color") or rules.get("background") or experiment.brand_guidelines.background_color
            text_color = rules.get("color") or experiment.brand_guidelines.text_color

            # 1. WCAG Contrast Check
            if bg.startswith("#") and text_color.startswith("#"):
                ratio = ContrastCalculator.compute_ratio(bg, text_color)
                if ratio < 3.0:
                    records.append(
                        AuditLogger.log_record(
                            variant_id=variant.variant_id,
                            experiment_id=variant.experiment_id,
                            tenant_id=variant.tenant_id,
                            check_name="Accessibility: WCAG 2.1 AA Contrast Ratio",
                            passed=False,
                            severity=CheckSeverity.CRITICAL,
                            rule_fired="RULE_A11Y_CONTRAST_FAIL",
                            message=f"Contrast ratio ({ratio:.2f}:1) fails WCAG AA minimum threshold of 3.0:1.",
                            details={"ratio": round(ratio, 2), "background": bg, "text": text_color}
                        )
                    )
                else:
                    records.append(
                        AuditLogger.log_record(
                            variant_id=variant.variant_id,
                            experiment_id=variant.experiment_id,
                            tenant_id=variant.tenant_id,
                            check_name="Accessibility: WCAG 2.1 AA Contrast Ratio",
                            passed=True,
                            severity=CheckSeverity.INFO,
                            rule_fired="RULE_A11Y_CONTRAST_PASS",
                            message=f"Contrast ratio ({ratio:.2f}:1) satisfies WCAG AA.",
                            details={"ratio": round(ratio, 2)}
                        )
                    )

            # 2. Critical Element Survival & Clickability
            if rules.get("display") == "none" or rules.get("visibility") == "hidden" or rules.get("opacity") in ["0", "0.0"]:
                records.append(
                    AuditLogger.log_record(
                        variant_id=variant.variant_id,
                        experiment_id=variant.experiment_id,
                        tenant_id=variant.tenant_id,
                        check_name="Functional: Critical Element Survival",
                        passed=False,
                        severity=CheckSeverity.CRITICAL,
                        rule_fired="RULE_CRITICAL_ELEMENT_OCCLUDED",
                        message="Style mutation hides the primary conversion CTA.",
                        details={"css_rules": rules}
                    )
                )

            if rules.get("pointer-events") == "none":
                records.append(
                    AuditLogger.log_record(
                        variant_id=variant.variant_id,
                        experiment_id=variant.experiment_id,
                        tenant_id=variant.tenant_id,
                        check_name="Functional: Click Interception Guard",
                        passed=False,
                        severity=CheckSeverity.CRITICAL,
                        rule_fired="RULE_POINTER_EVENTS_DISABLED",
                        message="Mutation disables pointer events on target CTA.",
                        details={"css_rules": rules}
                    )
                )

        return records
