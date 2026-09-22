"""
Unified Runtime Interdiction & Guardrail Engine.
Runs security, brand, and visual accessibility checks, updates variant status,
and produces a consolidated ValidationReport.
"""

from typing import List
from saas_platform.models.schemas import (
    Variant,
    Experiment,
    ValidationReport,
    GuardrailAuditRecord,
    VariantStatus,
    CheckSeverity,
)
from saas_platform.guardrails.security_checker import SecurityChecker
from saas_platform.guardrails.brand_checker import BrandChecker
from saas_platform.guardrails.visual_checker import VisualChecker
from saas_platform.guardrails.audit_logger import AuditLogger
from saas_platform.models.database import db


class GuardrailEngine:
    @classmethod
    def validate_variant(cls, variant: Variant, experiment: Experiment) -> ValidationReport:
        if variant.is_control:
            record = AuditLogger.log_record(
                variant_id=variant.variant_id,
                experiment_id=variant.experiment_id,
                tenant_id=variant.tenant_id,
                check_name="Control Baseline Verification",
                passed=True,
                severity=CheckSeverity.INFO,
                rule_fired="RULE_CONTROL_PASS",
                message="Control variant baseline unchanged."
            )
            return ValidationReport(
                variant_id=variant.variant_id,
                is_safe=True,
                score=1.0,
                audit_records=[record]
            )

        records: List[GuardrailAuditRecord] = []

        # 1. Security & XSS
        records.extend(SecurityChecker.check(variant))

        # 2. Brand & Content Safety
        records.extend(BrandChecker.check(variant, experiment))

        # 3. Visual & Element Survival
        records.extend(VisualChecker.check(variant, experiment))

        # Determine safety
        has_critical = any(not r.passed and r.severity == CheckSeverity.CRITICAL for r in records)
        warning_count = sum(1 for r in records if not r.passed and r.severity == CheckSeverity.WARNING)

        is_safe = not has_critical
        score = 0.0 if has_critical else max(0.2, 1.0 - (warning_count * 0.15))
        blocked_reasons = [f"[{r.check_name}] {r.message}" for r in records if not r.passed and r.severity == CheckSeverity.CRITICAL]

        if is_safe:
            variant.status = VariantStatus.APPROVED
        else:
            variant.status = VariantStatus.REJECTED

        db.save_variant(variant)

        return ValidationReport(
            variant_id=variant.variant_id,
            is_safe=is_safe,
            score=round(score, 3),
            audit_records=records,
            blocked_reasons=blocked_reasons
        )
