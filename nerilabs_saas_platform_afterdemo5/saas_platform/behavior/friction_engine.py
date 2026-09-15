"""
Behavior-Triggered Friction & Personalized AI Offer Engine (Phase v2).
Monitors live visitor telemetry, triggers the BehavioralOfferAgent to synthesize
creative, personalized promotional rescue offers, escalates assignment tokens in-place,
and generates regulatory compliance audit logs (Section 3.11 & 6.2).
"""

import time
import secrets
from typing import Dict, Optional, Tuple, Any, List
from saas_platform.models.schemas import (
    TelemetryEventDTO,
    EventType,
    Variant,
    VariantType,
    BehavioralRescueConfig,
    PricingDisclosureAuditRecord,
    PricingPlan,
)
from saas_platform.security.token_service import TokenService
from saas_platform.agents.behavioral_offer_agent import BehavioralOfferAgent
from saas_platform.models.database import db


class FrictionEngine:
    _SESSION_TELEMETRY: Dict[str, Dict[str, Any]] = {}

    @classmethod
    def get_or_default_config(cls, tenant_id: str) -> BehavioralRescueConfig:
        cfg = db.get_behavioral_rescue_config(tenant_id)
        if not cfg:
            cfg = BehavioralRescueConfig(
                enabled=True,
                dwell_threshold_seconds=8.0,
                scroll_past_count=2,
                promo_code="FOUNDER20",
                discount_percent=25,
                rescue_price_amount_cents=4900,
                modal_headline="🎁 Early-Stage Founder Acceleration Grant",
                modal_body="We noticed you exploring our plans! Claim an exclusive promotional grant for 25% off your first 3 months.",
                transparent_disclosure=True,
                disclosure_statement="Personalized promotional grant generated for your session based on evaluation activity."
            )
            db.save_behavioral_rescue_config(tenant_id, cfg)
        return cfg

    @classmethod
    def evaluate_behavioral_event(
        cls, event: TelemetryEventDTO
    ) -> Tuple[bool, Optional[str], Optional[Dict[str, Any]], str]:
        """
        Evaluates incoming telemetry beacons for hesitation / abandonment friction.
        When friction threshold is reached, invokes BehavioralOfferAgent to synthesize
        a creative, personalized promotional offer and re-signs the assignment token in place.
        """
        config = cls.get_or_default_config(event.tenant_id)
        if not config.enabled:
            return False, None, None, "Behavioral rescue disabled"

        sess_id = event.session_id or event.visitor_id
        if sess_id not in cls._SESSION_TELEMETRY:
            cls._SESSION_TELEMETRY[sess_id] = {
                "dwell_seconds": 0.0,
                "scroll_past_count": 0,
                "escalated": False
            }

        state = cls._SESSION_TELEMETRY[sess_id]

        if event.event_type == EventType.DWELL:
            state["dwell_seconds"] += float(event.metadata.get("dwell_duration", 1.0))
        elif event.event_type == EventType.SCROLL_PAST:
            state["scroll_past_count"] += 1

        if state["escalated"]:
            return False, None, None, "Session already escalated"

        # Check friction conditions
        friction_detected = False
        reason = ""

        if state["dwell_seconds"] >= config.dwell_threshold_seconds:
            friction_detected = True
            reason = f"Dwell hesitation ({state['dwell_seconds']:.1f}s on pricing table)"
        elif state["scroll_past_count"] >= config.scroll_past_count:
            friction_detected = True
            reason = f"Multiple scroll-past actions ({state['scroll_past_count']} times without click)"
        elif event.metadata.get("is_exit_intent") and config.exit_intent_enabled:
            friction_detected = True
            reason = "Exit intent detected (cursor left viewport)"

        if not friction_detected or not event.signed_token:
            return False, None, None, "No friction threshold met"

        # 1. Retrieve Experiment & Context
        experiment = db.get_experiment(event.experiment_id)
        if not experiment:
            return False, None, None, "Experiment not found"

        friction_context = {
            "dwell_seconds": state["dwell_seconds"],
            "hovered_element": event.metadata.get("hovered_element", "Pro Plan"),
            "referrer": event.metadata.get("referrer", "Organic Search"),
            "device_type": event.metadata.get("device_type", "desktop")
        }

        # 2. Invoke BehavioralOfferAgent to synthesize creative personalized offers
        offers = BehavioralOfferAgent.generate_personalized_offers(
            experiment=experiment,
            friction_context=friction_context,
            max_discount_pct=config.discount_percent
        )
        selected_offer = offers[0] if offers else {
            "promo_code": config.promo_code,
            "headline": config.modal_headline,
            "body": config.modal_body,
            "discount_percent": config.discount_percent,
            "cta_text": "Claim Discount & Checkout →"
        }

        discount_pct = selected_offer.get("discount_percent", 20)
        promo_code = selected_offer.get("promo_code", f"PROMO-{secrets.token_hex(2).upper()}")
        
        # Calculate dynamic discounted price (e.g. $79 - 25% = $59 or configured rescue price)
        baseline_price_cents = 7900
        discounted_price_cents = int(baseline_price_cents * (1.0 - (discount_pct / 100.0)))
        if config.rescue_price_amount_cents > 0:
            discounted_price_cents = config.rescue_price_amount_cents

        # 3. Create or resolve dynamic Stripe Price arm
        stripe_price_id = f"price_stripe_{event.tenant_id[:6]}_{discounted_price_cents}_{promo_code.replace('-', '_').lower()}"
        personalized_variant = Variant(
            variant_id=f"var_ai_offer_{discounted_price_cents}_{secrets.token_hex(3)}",
            opaque_id=f"opq_offer_{secrets.token_hex(4)}",
            experiment_id=event.experiment_id,
            tenant_id=event.tenant_id,
            name=f"AI Offer: {promo_code} ({discount_pct}% OFF)",
            variant_type=VariantType.PRICING,
            hypothesis=f"Personalized offer '{selected_offer.get('headline')}' converts hesitating visitor.",
            pricing_payload=PricingPlan(
                plan_name=f"Personalized Plan ({promo_code})",
                price_amount_cents=discounted_price_cents,
                currency="usd",
                interval="month",
                stripe_price_id=stripe_price_id
            ),
            status="APPROVED"
        )
        db.save_variant(personalized_variant)

        # 4. In-Place Token Escalation
        success, new_signed_token, updated_payload, msg = TokenService.reassign_token_in_place(
            existing_signed_token=event.signed_token,
            new_variant=personalized_variant,
            reassignment_reason=reason
        )

        if success:
            state["escalated"] = True

            # 5. Log Regulatory Compliance Pricing Disclosure Record (Section 6.2)
            disclosure_record = PricingDisclosureAuditRecord(
                tenant_id=event.tenant_id,
                experiment_id=event.experiment_id,
                session_id=sess_id,
                visitor_id=event.visitor_id,
                original_price_cents=baseline_price_cents,
                offered_price_cents=discounted_price_cents,
                discount_percent=discount_pct,
                promo_code_applied=promo_code,
                trigger_reason=f"AI Behavioral Synthesis: {reason}"
            )
            db.log_pricing_disclosure(disclosure_record)

            # 6. Deliver rich personalized payload to Client SDK
            payload_data = {
                "action": "SHOW_PROMOTIONAL_RESCUE",
                "variant_id": personalized_variant.variant_id,
                "opaque_variant_id": personalized_variant.opaque_id,
                "variant_name": personalized_variant.name,
                "promo_code": promo_code,
                "discount_percent": discount_pct,
                "discounted_price_formatted": f"${discounted_price_cents/100:.0f}/mo",
                "modal_headline": selected_offer.get("headline", config.modal_headline),
                "modal_body": selected_offer.get("body", config.modal_body),
                "cta_text": selected_offer.get("cta_text", "Claim Offer & Checkout →"),
                "disclosure_statement": config.disclosure_statement if config.transparent_disclosure else None,
                "reason": reason,
                "is_ai_personalized": True
            }
            return True, new_signed_token, payload_data, f"AI personalized offer deployed: {reason}"

        return False, None, None, msg
