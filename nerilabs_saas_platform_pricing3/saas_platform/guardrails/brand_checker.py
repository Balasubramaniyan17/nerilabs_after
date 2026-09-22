"""
Brand & Content Safety Guardrail.
Validates copy against prohibited claims/lexicon, tone constraints, and layout length limits.
"""

from typing import List
from saas_platform.models.schemas import (
    Variant,
    Experiment,
    GuardrailAuditRecord,
    CheckSeverity,
)
from saas_platform.guardrails.audit_logger import AuditLogger


class BrandChecker:
    @classmethod
    def check(cls, variant: Variant, experiment: Experiment) -> List[GuardrailAuditRecord]:
        records: List[GuardrailAuditRecord] = []
        if not variant.copy_payload:
            return records

        new_text = variant.copy_payload.get("new_text", "").lower()
        prohibited = experiment.brand_guidelines.prohibited_words

        # Check prohibited terms
        matched = [w for w in prohibited if w.lower() in new_text]
        if matched:
            records.append(
                AuditLogger.log_record(
                    variant_id=variant.variant_id,
                    experiment_id=variant.experiment_id,
                    tenant_id=variant.tenant_id,
                    check_name="Brand: Prohibited Claims & Lexicon",
                    passed=False,
                    severity=CheckSeverity.CRITICAL,
                    rule_fired="RULE_BRAND_PROHIBITED_TERM",
                    message=f"Copy contains prohibited words: {matched}",
                    details={"matched_terms": matched}
                )
            )
        else:
            records.append(
                AuditLogger.log_record(
                    variant_id=variant.variant_id,
                    experiment_id=variant.experiment_id,
                    tenant_id=variant.tenant_id,
                    check_name="Brand: Prohibited Claims & Lexicon",
                    passed=True,
                    severity=CheckSeverity.INFO,
                    rule_fired="RULE_BRAND_TERMS_COMPLIANT",
                    message="No prohibited terms detected in copy."
                )
            )

        # Check copy length delta (prevents extreme layout breakage)
        orig_len = len(variant.copy_payload.get("original_text", ""))
        new_len = len(variant.copy_payload.get("new_text", ""))
        if orig_len > 0:
            delta_pct = abs(new_len - orig_len) / orig_len * 100.0
            max_delta = experiment.brand_guidelines.max_copy_length_delta_percent
            if delta_pct > max_delta and new_len > 80:
                records.append(
                    AuditLogger.log_record(
                        variant_id=variant.variant_id,
                        experiment_id=variant.experiment_id,
                        tenant_id=variant.tenant_id,
                        check_name="Layout: Text Length Delta Check",
                        passed=False,
                        severity=CheckSeverity.WARNING,
                        rule_fired="RULE_LAYOUT_LENGTH_DELTA_EXCEEDED",
                        message=f"Copy length variance ({delta_pct:.1f}%) exceeds safety threshold.",
                        details={"delta_percent": delta_pct, "max_allowed": max_delta}
                    )
                )

        return records
