"""
Assignment Token Service.
Issues and verifies cryptographically signed JWT tokens containing opaque variant IDs.
Enforces PER-TENANT HMAC-SHA256 signing secrets to prevent cross-tenant forgery,
supports in-place token re-signing for mid-session behavioral escalation, and
enforces hard commit boundary locking.
"""

import hmac
import hashlib
import base64
import json
import time
from typing import Dict, Optional, Tuple, Any
from saas_platform.config import Config
from saas_platform.models.schemas import (
    AssignmentTokenPayload,
    Variant,
    VariantType,
)
from saas_platform.models.database import db


def _dump_model(m) -> dict:
    return m.dict() if hasattr(m, "dict") else m.model_dump()


class TokenService:
    @classmethod
    def _base64url_encode(cls, data: bytes) -> str:
        return base64.urlsafe_b64encode(data).decode("utf-8").rstrip("=")

    @classmethod
    def _base64url_decode(cls, s: str) -> bytes:
        padding = "=" * ((4 - len(s) % 4) % 4)
        return base64.urlsafe_b64decode(s + padding)

    @classmethod
    def _get_tenant_signing_secret(cls, tenant_id: str, custom_secret: Optional[str] = None) -> bytes:
        if custom_secret:
            return custom_secret.encode("utf-8")
        tenant = db.get_tenant(tenant_id)
        if tenant and tenant.token_signing_secret:
            return tenant.token_signing_secret.encode("utf-8")
        return Config.JWT_SECRET.encode("utf-8")

    @classmethod
    def sign_token(cls, payload: AssignmentTokenPayload, custom_secret: Optional[str] = None) -> str:
        """
        Encodes and signs the token payload using the tenant's individual HMAC-SHA256 secret.
        """
        header = {"alg": "HS256", "typ": "JWT"}
        header_b64 = cls._base64url_encode(json.dumps(header, separators=(",", ":")).encode("utf-8"))
        
        payload_dict = _dump_model(payload)
        payload_b64 = cls._base64url_encode(json.dumps(payload_dict, separators=(",", ":")).encode("utf-8"))
        
        signing_input = f"{header_b64}.{payload_b64}".encode("utf-8")
        secret = cls._get_tenant_signing_secret(payload.tenant_id, custom_secret)
        signature = hmac.new(secret, signing_input, hashlib.sha256).digest()
        signature_b64 = cls._base64url_encode(signature)
        
        return f"{header_b64}.{payload_b64}.{signature_b64}"

    @classmethod
    def verify_token(
        cls, signed_token: str, expected_secret: Optional[str] = None
    ) -> Tuple[bool, Optional[AssignmentTokenPayload], str]:
        """
        Cryptographically verifies token signature against the tenant's specific signing secret.
        """
        try:
            parts = signed_token.split(".")
            if len(parts) != 3:
                return False, None, "Malformed token: expected 3 parts"

            header_b64, payload_b64, signature_b64 = parts
            signing_input = f"{header_b64}.{payload_b64}".encode("utf-8")

            # Decode payload first to identify tenant
            payload_json = cls._base64url_decode(payload_b64).decode("utf-8")
            payload_data = json.loads(payload_json)
            payload = AssignmentTokenPayload(**payload_data)

            # Retrieve tenant-specific secret
            secret = cls._get_tenant_signing_secret(payload.tenant_id, expected_secret)
            expected_sig = hmac.new(secret, signing_input, hashlib.sha256).digest()
            provided_sig = cls._base64url_decode(signature_b64)

            if not hmac.compare_digest(expected_sig, provided_sig):
                return False, None, "Invalid cryptographic signature (Tenant secret mismatch)"

            # Check expiration
            if time.time() > payload.expires_at:
                return False, payload, "Token has expired"

            return True, payload, "Valid"
        except Exception as e:
            return False, None, f"Token verification error: {str(e)}"

    @classmethod
    def issue_new_token(
        cls,
        tenant_id: str,
        experiment_id: str,
        session_id: str,
        visitor_id: str,
        variant: Variant,
        ttl_seconds: Optional[int] = None
    ) -> Tuple[str, AssignmentTokenPayload]:
        ttl = ttl_seconds or Config.TOKEN_EXPIRATION_SECONDS
        now = time.time()
        payload = AssignmentTokenPayload(
            tenant_id=tenant_id,
            experiment_id=experiment_id,
            session_id=session_id,
            visitor_id=visitor_id,
            opaque_variant_id=variant.opaque_id,
            variant_type=variant.variant_type,
            issued_at=now,
            expires_at=now + ttl,
            is_reassigned=False,
            commit_locked=False
        )
        db.save_token(payload)
        signed = cls.sign_token(payload)
        return signed, payload

    @classmethod
    def reassign_token_in_place(
        cls,
        existing_signed_token: str,
        new_variant: Variant,
        reassignment_reason: str = "behavioral_friction_trigger"
    ) -> Tuple[bool, Optional[str], Optional[AssignmentTokenPayload], str]:
        is_valid, payload, msg = cls.verify_token(existing_signed_token)
        if not is_valid or not payload:
            return False, None, None, f"Cannot reassign invalid token: {msg}"

        # Hard commit boundary check
        db_token = db.get_token(payload.token_id)
        if (db_token and db_token.commit_locked) or payload.commit_locked:
            commit_type = db_token.commit_type if db_token else payload.commit_type
            return False, None, payload, f"Commit boundary locked ({commit_type}). In-flight reassignment forbidden."

        # Update claims in place on the same token ID
        payload.opaque_variant_id = new_variant.opaque_id
        payload.variant_type = new_variant.variant_type
        payload.is_reassigned = True
        payload.reassignment_reason = reassignment_reason
        payload.issued_at = time.time()
        
        db.save_token(payload)
        new_signed_token = cls.sign_token(payload)
        return True, new_signed_token, payload, "Token successfully reassigned in-place"

    @classmethod
    def lock_commit_boundary(cls, token_id: str, commit_type: str) -> bool:
        token = db.get_token(token_id)
        if not token:
            return False
        token.commit_locked = True
        token.commit_type = commit_type
        db.save_token(token)
        return True
