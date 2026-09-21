"""
Customer-Side Backend SDK & ASGI Middleware (Python / FastAPI).
Installed in customer backends to validate assignment tokens using their individual
tenant token_signing_secret, apply relaxed form schemas, safely backfill omitted database fields
with explicit 'is_synthetic: True' flags, and enforce server-side commit boundary locks.
"""

from typing import Dict, Any, Optional, Tuple, Callable
from saas_platform.security.token_service import TokenService
from saas_platform.models.database import db


class ExperimentationMiddleware:
    def __init__(
        self,
        tenant_id: str,
        token_signing_secret: str,
        platform_api_url: str = "http://localhost:8000"
    ):
        self.tenant_id = tenant_id
        self.token_signing_secret = token_signing_secret
        self.platform_api_url = platform_api_url

    def process_incoming_request(
        self, headers: Dict[str, str], payload_data: Dict[str, Any]
    ) -> Tuple[bool, Dict[str, Any], Optional[str]]:
        token = headers.get("X-Experiment-Token") or headers.get("x-experiment-token")
        if not token:
            auth = headers.get("Authorization", "")
            if auth.startswith("Bearer "):
                token = auth.split(" ")[1]

        if not token:
            return True, payload_data, None

        # Verify token using this customer's private token_signing_secret
        is_valid, token_payload, err = TokenService.verify_token(
            signed_token=token,
            expected_secret=self.token_signing_secret
        )
        if not is_valid or not token_payload:
            return False, payload_data, f"Invalid experiment token: {err}"

        # Ensure token belongs to this customer's tenant
        if token_payload.tenant_id != self.tenant_id:
            return False, payload_data, "Cross-tenant token mismatch rejected."

        # Resolve variant
        variant = db.get_variant_by_opaque_id(token_payload.opaque_variant_id)
        if not variant:
            return True, payload_data, None

        enriched_data = dict(payload_data)

        # Apply schema relaxation & synthetic backfills
        if variant.variant_type.value == "ONBOARDING_SCHEMA" and variant.onboarding_payload:
            schema_def = variant.onboarding_payload
            backfills = schema_def.synthetic_backfills

            synthetic_fields_added = {}
            for field_name, default_val in backfills.items():
                if field_name not in enriched_data or enriched_data[field_name] is None:
                    enriched_data[field_name] = default_val
                    synthetic_fields_added[field_name] = default_val

            enriched_data["_experiment_metadata"] = {
                "experiment_id": token_payload.experiment_id,
                "opaque_variant_id": token_payload.opaque_variant_id,
                "is_synthetic": len(synthetic_fields_added) > 0,
                "synthetic_fields": synthetic_fields_added
            }

        return True, enriched_data, None

    def commit_state_transition(self, token: str, step_name: str) -> bool:
        is_valid, token_payload, _ = TokenService.verify_token(token, expected_secret=self.token_signing_secret)
        if is_valid and token_payload:
            return TokenService.lock_commit_boundary(token_payload.token_id, commit_type=f"STATE_PERSISTED_{step_name.upper()}")
        return False
