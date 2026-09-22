"""
Guardrail Audit Logger.
Maintains versioned, timestamped records of every accept/reject safety decision
and provides a manual founder override mechanism (Section 3.5 & 6.1).
"""

from typing import List, Optional
from saas_platform.models.schemas import GuardrailAuditRecord, CheckSeverity
from saas_platform.models.database import db


class AuditLogger:
    @classmethod
    def log_record(
        cls,
        variant_id: str,
        experiment_id: str,
        tenant_id: str,
        check_name: str,
        passed: bool,
        severity: CheckSeverity,
        rule_fired: str,
        message: str,
        details: Optional[dict] = None
    ) -> GuardrailAuditRecord:
        record = GuardrailAuditRecord(
            variant_id=variant_id,
            experiment_id=experiment_id,
            tenant_id=tenant_id,
            check_name=check_name,
            passed=passed,
            severity=severity,
            rule_fired=rule_fired,
            message=message,
            details=details or {}
        )
        db.log_audit_records(experiment_id, [record])
        return record

    @classmethod
    def founder_override_decision(
        cls,
        experiment_id: str,
        audit_id: str,
        override_approve: bool,
        reason: str
    ) -> bool:
        records = db.get_audit_logs(experiment_id)
        for r in records:
            if r.audit_id == audit_id:
                r.overridden_by_founder = True
                r.override_reason = reason
                if override_approve:
                    r.passed = True
                return True
        return False
