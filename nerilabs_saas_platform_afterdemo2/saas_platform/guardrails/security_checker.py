"""
Security & XSS Sanitization Guardrail.
Blocks malicious markup, inline handlers, and CSS injection vectors.
"""

import re
from typing import List
from saas_platform.models.schemas import Variant, GuardrailAuditRecord, CheckSeverity
from saas_platform.guardrails.audit_logger import AuditLogger


class SecurityChecker:
    DANGEROUS_HTML = [
        (r"<script\b", "SCRIPT_TAG_INJECTION"),
        (r"javascript:", "JAVASCRIPT_URI_SCHEME"),
        (r"\bon\w+\s*=", "INLINE_EVENT_HANDLER"),
        (r"<iframe\b", "IFRAME_INJECTION"),
        (r"<embed\b", "EMBED_TAG_INJECTION"),
        (r"<object\b", "OBJECT_TAG_INJECTION"),
    ]

    DANGEROUS_CSS = [
        (r"expression\(", "IE_CSS_EXPRESSION"),
        (r"javascript:", "CSS_JAVASCRIPT_URI"),
        (r"@import", "CSS_EXTERNAL_IMPORT"),
        (r"behavior:", "CSS_BEHAVIOR_PROPERTY"),
    ]

    @classmethod
    def check(cls, variant: Variant) -> List[GuardrailAuditRecord]:
        records: List[GuardrailAuditRecord] = []

        # Check HTML/Component markup
        html = ""
        if variant.component_payload and "replacement_html" in variant.component_payload:
            html += variant.component_payload["replacement_html"]

        if html:
            found = []
            for pat, rule_id in cls.DANGEROUS_HTML:
                if re.search(pat, html, re.IGNORECASE):
                    found.append((rule_id, pat))

            if found:
                records.append(
                    AuditLogger.log_record(
                        variant_id=variant.variant_id,
                        experiment_id=variant.experiment_id,
                        tenant_id=variant.tenant_id,
                        check_name="Security: Markup Sanitization & XSS",
                        passed=False,
                        severity=CheckSeverity.CRITICAL,
                        rule_fired="RULE_SEC_XSS_DETECTED",
                        message=f"Insecure HTML patterns detected: {[f[0] for f in found]}",
                        details={"matches": [f[0] for f in found]}
                    )
                )
            else:
                records.append(
                    AuditLogger.log_record(
                        variant_id=variant.variant_id,
                        experiment_id=variant.experiment_id,
                        tenant_id=variant.tenant_id,
                        check_name="Security: Markup Sanitization & XSS",
                        passed=True,
                        severity=CheckSeverity.INFO,
                        rule_fired="RULE_SEC_CLEAN",
                        message="HTML passed security inspection."
                    )
                )

        # Check CSS rules
        css = ""
        if variant.style_payload and "raw_css" in variant.style_payload:
            css += variant.style_payload["raw_css"]

        if css:
            found_css = []
            for pat, rule_id in cls.DANGEROUS_CSS:
                if re.search(pat, css, re.IGNORECASE):
                    found_css.append((rule_id, pat))

            if found_css:
                records.append(
                    AuditLogger.log_record(
                        variant_id=variant.variant_id,
                        experiment_id=variant.experiment_id,
                        tenant_id=variant.tenant_id,
                        check_name="Security: CSS Injection Guard",
                        passed=False,
                        severity=CheckSeverity.CRITICAL,
                        rule_fired="RULE_SEC_CSS_DANGEROUS",
                        message=f"Dangerous CSS properties detected: {[f[0] for f in found_css]}",
                        details={"matches": [f[0] for f in found_css]}
                    )
                )
            else:
                records.append(
                    AuditLogger.log_record(
                        variant_id=variant.variant_id,
                        experiment_id=variant.experiment_id,
                        tenant_id=variant.tenant_id,
                        check_name="Security: CSS Injection Guard",
                        passed=True,
                        severity=CheckSeverity.INFO,
                        rule_fired="RULE_SEC_CSS_CLEAN",
                        message="CSS styles passed security inspection."
                    )
                )

        return records
