from saas_platform.server import MAB_ENGINES, get_or_create_mab
import uuid
"""
Comprehensive Test Suite for the Multi-Tenant Production SaaS Platform.
Covers:
- Self-Serve Stripe Checkout & Webhook Auto-Provisioning
- 3-Minute Instant Onboarding Wizard
- Token Security & Hard Commit Boundary Locking
- Multi-Layer Guardrail Interdiction & Audit Trail Overrides
- Multi-Armed Bandit (Thompson Sampling + 10% Exploration Floor)
- Stripe Dynamic Pricing & Webhook Verification
- Customer Backend Middleware & Synthetic Backfill Integrity
- Autonomous Anomaly Detection & Hypothesis Proposals
- Full FastAPI REST Endpoints & UI Serving
"""

import unittest
import time
from fastapi.testclient import TestClient

from saas_platform.models.schemas import (
    Experiment,
    ExperimentType,
    Variant,
    VariantType,
    VariantStatus,
    BrandGuidelines,
    DOMElement,
    TelemetryEventDTO,
    EventType,
    BehavioralRescueConfig,
    AnomalyProposal,
)
from saas_platform.models.database import db
from saas_platform.security.token_service import TokenService
from saas_platform.agents.orchestrator import AgentOrchestrator
from saas_platform.guardrails.engine import GuardrailEngine
from saas_platform.guardrails.audit_logger import AuditLogger
from saas_platform.bandit.thompson_sampling import MABEngine
from saas_platform.billing.stripe_service import StripeBillingService
from saas_platform.customer_sdk.middleware import ExperimentationMiddleware
from saas_platform.autonomous.anomaly_engine import AnomalyDetectionEngine
from saas_platform.behavior.friction_engine import FrictionEngine
from saas_platform.server import app


class TestTokenSecurity(unittest.TestCase):
    def setUp(self):
        self.variant = Variant(
            variant_id="var_tok_01",
            opaque_id="opq_variant_abc",
            experiment_id="exp_tok_test",
            tenant_id="tenant_startup_01",
            name="Test Variant",
            variant_type=VariantType.COPY,
            hypothesis="Testing token security"
        )
        db.save_variant(self.variant)

    def test_signed_token_lifecycle(self):
        signed, payload = TokenService.issue_new_token(
            tenant_id="tenant_startup_01",
            experiment_id="exp_tok_test",
            session_id="sess_123",
            visitor_id="vis_123",
            variant=self.variant
        )
        self.assertIsNotNone(signed)
        self.assertEqual(payload.opaque_variant_id, "opq_variant_abc")

        is_valid, decoded, msg = TokenService.verify_token(signed)
        self.assertTrue(is_valid)
        self.assertEqual(decoded.token_id, payload.token_id)

    def test_tampered_token_fails(self):
        signed, _ = TokenService.issue_new_token(
            tenant_id="tenant_startup_01",
            experiment_id="exp_tok_test",
            session_id="sess_123",
            visitor_id="vis_123",
            variant=self.variant
        )
        parts = signed.split(".")
        tampered_signed = f"{parts[0]}.eyRhbW91bnRfY2VudHMiOiAxMDAwfQ.{parts[2]}"
        is_valid, _, msg = TokenService.verify_token(tampered_signed)
        self.assertFalse(is_valid)

    def test_in_place_reassignment_and_commit_locking(self):
        signed, payload = TokenService.issue_new_token(
            tenant_id="tenant_startup_01",
            experiment_id="exp_tok_test",
            session_id="sess_456",
            visitor_id="vis_456",
            variant=self.variant
        )

        new_variant = Variant(
            variant_id="var_tok_02",
            opaque_id="opq_variant_xyz",
            experiment_id="exp_tok_test",
            tenant_id="tenant_startup_01",
            name="Escalated Variant",
            variant_type=VariantType.PRICING,
            hypothesis="Escalation test"
        )
        db.save_variant(new_variant)

        # In-place escalation
        success, new_signed, updated_payload, _ = TokenService.reassign_token_in_place(
            existing_signed_token=signed,
            new_variant=new_variant,
            reassignment_reason="Dwell friction"
        )
        self.assertTrue(success)
        self.assertEqual(updated_payload.token_id, payload.token_id)
        self.assertEqual(updated_payload.opaque_variant_id, "opq_variant_xyz")
        self.assertTrue(updated_payload.is_reassigned)

        # Lock hard commit boundary
        TokenService.lock_commit_boundary(payload.token_id, commit_type="STRIPE_PAYMENT_INTENT")

        # Subsequent reassignment MUST fail
        success2, _, _, msg = TokenService.reassign_token_in_place(
            existing_signed_token=new_signed,
            new_variant=self.variant
        )
        self.assertFalse(success2)
        self.assertIn("locked", msg.lower())


class TestGuardrailInterdiction(unittest.TestCase):
    def setUp(self):
        self.exp = Experiment(
            experiment_id="exp_guard_test",
            tenant_id="tenant_startup_01",
            title="Guardrail Test",
            url="https://test.io",
            target_selector="#btn",
            brand_guidelines=BrandGuidelines(prohibited_words=["scam", "cheap"])
        )
        db.save_experiment(self.exp)

    def test_security_xss_blocked(self):
        v = Variant(
            variant_id="var_xss_bad",
            experiment_id=self.exp.experiment_id,
            tenant_id=self.exp.tenant_id,
            name="XSS Injected",
            variant_type=VariantType.COMPONENT,
            hypothesis="Malicious XSS",
            component_payload={"replacement_html": "<button onclick='eval(x)'>Click <script>steal()</script></button>"}
        )
        report = GuardrailEngine.validate_variant(v, self.exp)
        self.assertFalse(report.is_safe)
        self.assertEqual(v.status, VariantStatus.REJECTED)

    def test_wcag_contrast_and_occlusion_blocked(self):
        v = Variant(
            variant_id="var_bad_css",
            experiment_id=self.exp.experiment_id,
            tenant_id=self.exp.tenant_id,
            name="Bad Contrast & Hidden",
            variant_type=VariantType.STYLE,
            hypothesis="Testing contrast & occlusion",
            style_payload={"css_rules": {"background-color": "#ffffff", "color": "#ffff00", "display": "none"}}
        )
        report = GuardrailEngine.validate_variant(v, self.exp)
        self.assertFalse(report.is_safe)
        self.assertEqual(v.status, VariantStatus.REJECTED)

    def test_founder_manual_override(self):
        v = Variant(
            variant_id="var_borderline",
            experiment_id=self.exp.experiment_id,
            tenant_id=self.exp.tenant_id,
            name="Borderline Copy",
            variant_type=VariantType.COPY,
            hypothesis="Testing override",
            copy_payload={"selector": "#btn", "original_text": "Click", "new_text": "Super cheap deals", "trigger": "URGENCY"}
        )
        report = GuardrailEngine.validate_variant(v, self.exp)
        self.assertFalse(report.is_safe)

        audit_id = report.audit_records[0].audit_id
        override_success = AuditLogger.founder_override_decision(
            experiment_id=self.exp.experiment_id,
            audit_id=audit_id,
            override_approve=True,
            reason="Founder risk acceptance for promo campaign"
        )
        self.assertTrue(override_success)


class TestStripeBillingService(unittest.TestCase):
    def setUp(self):
        self.exp = Experiment(
            experiment_id="exp_billing_test",
            tenant_id="tenant_startup_01",
            title="Pricing Experiment",
            url="https://pricing.io",
            target_selector="#pricing-table"
        )
        db.save_experiment(self.exp)
        self.variants = StripeBillingService.create_pricing_test_variants(
            self.exp, [("Tier A ($49)", 4900), ("Tier B ($79)", 7900)]
        )

    def test_price_resolution_and_webhook_verification(self):
        signed_token, _ = TokenService.issue_new_token(
            tenant_id=self.exp.tenant_id,
            experiment_id=self.exp.experiment_id,
            session_id="sess_stripe_1",
            visitor_id="vis_stripe_1",
            variant=self.variants[1]
        )

        success, checkout_data, _ = StripeBillingService.resolve_price_for_checkout(signed_token)
        self.assertTrue(success)
        self.assertEqual(checkout_data["amount_cents"], 7900)
        price_id = checkout_data["stripe_price_id"]

        ok, msg, provision = StripeBillingService.handle_stripe_webhook_idempotent(
            event_id="evt_stripe_test_001",
            event_type="checkout.session.completed",
            customer_id="cus_abc",
            subscription_id="sub_xyz",
            stripe_price_id_paid=price_id,
            signed_token=signed_token
        )
        self.assertTrue(ok)
        self.assertEqual(provision["amount_cents"], 7900)

        ok_dup, msg_dup, _ = StripeBillingService.handle_stripe_webhook_idempotent(
            event_id="evt_stripe_test_001",
            event_type="checkout.session.completed",
            customer_id="cus_abc",
            subscription_id="sub_xyz",
            stripe_price_id_paid=price_id,
            signed_token=signed_token
        )
        self.assertTrue(ok_dup)
        self.assertIn("Idempotent", msg_dup)


class TestCustomerBackendMiddleware(unittest.TestCase):
    def setUp(self):
        self.tenant = db.get_tenant("tenant_startup_01")
        self.middleware = ExperimentationMiddleware(
            tenant_id=self.tenant.tenant_id,
            token_signing_secret=self.tenant.token_signing_secret,
            platform_api_url="http://localhost:8000"
        )
        self.schema_variant = Variant(
            variant_id="var_onboard_schema_01",
            opaque_id="opq_schema_123",
            experiment_id="exp_onboard_test",
            tenant_id="tenant_startup_01",
            name="Relaxed Onboarding",
            variant_type=VariantType.ONBOARDING_SCHEMA,
            hypothesis="Relaxed form fields",
            onboarding_payload={
                "step_id": "step_1",
                "required_fields": ["email", "password"],
                "relaxed_fields": ["company_size", "role_title"],
                "synthetic_backfills": {
                    "company_size": "1-10 [synthetic]",
                    "role_title": "Evaluator [synthetic]"
                }
            }
        )
        db.save_variant(self.schema_variant)

    def test_schema_relaxation_and_synthetic_tagging(self):
        signed_token, _ = TokenService.issue_new_token(
            tenant_id="tenant_startup_01",
            experiment_id="exp_onboard_test",
            session_id="sess_onboard_1",
            visitor_id="vis_onboard_1",
            variant=self.schema_variant
        )

        headers = {"X-Experiment-Token": signed_token}
        user_input = {"email": "founder@startup.io", "password": "securepassword123"}

        valid, enriched, err = self.middleware.process_incoming_request(headers, user_input)
        self.assertTrue(valid)
        self.assertEqual(enriched["company_size"], "1-10 [synthetic]")
        self.assertTrue(enriched["_experiment_metadata"]["is_synthetic"])


class TestMABEngine(unittest.TestCase):
    def test_thompson_sampling_with_exploration_floor(self):
        mab = MABEngine(
            experiment_id="exp_mab_unit",
            tenant_id="tenant_startup_01",
            exploration_floor=0.10,
            min_sample_threshold=20
        )
        v1 = Variant(variant_id="v_c", opaque_id="opq_c", experiment_id="exp_mab_unit", tenant_id="t1", name="Control", variant_type=VariantType.COPY, is_control=True, status="APPROVED", hypothesis="h")
        v2 = Variant(variant_id="v_w", opaque_id="opq_w", experiment_id="exp_mab_unit", tenant_id="t1", name="Winner", variant_type=VariantType.COPY, status="APPROVED", hypothesis="h")
        mab.register_variant(v1)
        mab.register_variant(v2)

        analytics_early = mab.compute_analytics()
        self.assertFalse(analytics_early.has_sufficient_data)

        for i in range(30):
            mab.record_telemetry(TelemetryEventDTO(event_type=EventType.IMPRESSION, tenant_id="t1", experiment_id="exp_mab_unit", opaque_variant_id="opq_c", visitor_id=f"vc_{i}"))
            mab.record_telemetry(TelemetryEventDTO(event_type=EventType.IMPRESSION, tenant_id="t1", experiment_id="exp_mab_unit", opaque_variant_id="opq_w", visitor_id=f"vw_{i}"))
            if i == 0:
                mab.record_telemetry(TelemetryEventDTO(event_type=EventType.CONVERSION, tenant_id="t1", experiment_id="exp_mab_unit", opaque_variant_id="opq_c", visitor_id=f"vc_{i}"))
            if i % 2 == 0:
                mab.record_telemetry(TelemetryEventDTO(event_type=EventType.CONVERSION, tenant_id="t1", experiment_id="exp_mab_unit", opaque_variant_id="opq_w", visitor_id=f"vw_{i}"))

        analytics_final = mab.compute_analytics()
        self.assertTrue(analytics_final.has_sufficient_data)
        self.assertEqual(analytics_final.leading_variant_id, "v_w")
        self.assertGreater(analytics_final.confidence_level, 0.90)


class TestAutonomousAnomalyEngine(unittest.TestCase):
    def test_anomaly_detection_and_approval(self):
        with db._get_connection() as conn:
            conn.execute("DELETE FROM telemetry_events WHERE experiment_id = 'exp_anomaly_test'")
        exp = Experiment(
            experiment_id="exp_anomaly_test",
            tenant_id="tenant_startup_01",
            title="Anomaly Test Funnel",
            url="https://app.io",
            target_selector="#cta"
        )
        db.save_experiment(exp)
        now = time.time()

        # 1. Historical baseline: 100 visits at 10% CVR
        for i in range(100):
            db.record_telemetry_event(TelemetryEventDTO(
                event_type=EventType.IMPRESSION,
                tenant_id=exp.tenant_id,
                experiment_id=exp.experiment_id,
                opaque_variant_id="opq_base",
                visitor_id=f"vis_h_{i}",
                timestamp=now - 7200
            ))
            if i < 10:
                db.record_telemetry_event(TelemetryEventDTO(
                    event_type=EventType.CONVERSION,
                    tenant_id=exp.tenant_id,
                    experiment_id=exp.experiment_id,
                    opaque_variant_id="opq_base",
                    visitor_id=f"vis_h_{i}",
                    timestamp=now - 7200
                ))

        # 2. Recent observation window: 40 visits at 0% CVR (statistically significant drop, Z < -2.0)
        for i in range(40):
            db.record_telemetry_event(TelemetryEventDTO(
                event_type=EventType.IMPRESSION,
                tenant_id=exp.tenant_id,
                experiment_id=exp.experiment_id,
                opaque_variant_id="opq_base",
                visitor_id=f"vis_r_{i}",
                timestamp=now - 60
            ))

        proposal = AnomalyDetectionEngine.scan_for_anomalies(exp.tenant_id, exp.experiment_id, window_hours=1.0)
        self.assertIsNotNone(proposal)
        self.assertEqual(proposal.status.value, "PROPOSED")
        self.assertIn("Empirical Data Baseline", proposal.reasoning_trace)
        self.assertIn("Z-Score", proposal.reasoning_trace)

        approved = AnomalyDetectionEngine.approve_proposal(proposal.proposal_id, reviewer_name="Founder")
        self.assertTrue(approved)


class TestSelfServeOnboardingAndAPIRoutes(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.api_key = "nerilabs_sk_live_9a8b7c6d5e4f3a2b1c"

    def test_self_serve_checkout_and_webhook_flow(self):
        # 1. Create Checkout Session
        res_cs = self.client.post("/api/v1/billing/create-checkout-session", json={
            "plan_id": "price_growth_99",
            "customer_email": "jane@techcorp.io",
            "customer_name": "Jane Doe"
        })
        self.assertEqual(res_cs.status_code, 200)
        self.assertIn("checkout_url", res_cs.json())

        # 2. Simulate Stripe Webhook auto-provisioning
        res_wh = self.client.post("/api/v1/billing/saas-checkout-webhook", json={
            "id": "evt_sub_test_0099",
            "type": "checkout.session.completed",
            "data": {
                "object": {
                    "customer_email": "jane@techcorp.io",
                    "customer_details": {"name": "Jane Tech", "email": "jane@techcorp.io"},
                    "plan_id": "price_growth_99"
                }
            }
        })
        self.assertEqual(res_wh.status_code, 200)
        wh_data = res_wh.json()
        self.assertEqual(wh_data["status"], "provisioned")
        self.assertIn("magic_login_url", wh_data)

    def test_instant_onboarding_wizard_endpoint(self):
        # Onboarding wizard setup
        res_ob = self.client.post("/api/v1/onboarding/setup", json={
            "website_url": "https://coolstartup.com",
            "target_selector": "#signup-button",
            "target_element_text": "Join Free Today",
            "brand_primary_color": "#10b981",
            "brand_accent_color": "#f59e0b"
        }, headers={"X-API-Key": self.api_key})

        self.assertEqual(res_ob.status_code, 200)
        data = res_ob.json()
        self.assertEqual(data["status"], "success")
        self.assertGreater(data["variants_approved"], 0)
        self.assertIn("script_tag_html", data)
        self.assertIn("experiment_sdk.js", data["script_tag_html"])

    def test_get_current_tenant_profile(self):
        res_tenant = self.client.get("/api/v1/tenant/me", headers={"X-API-Key": self.api_key})
        self.assertEqual(res_tenant.status_code, 200)
        data = res_tenant.json()
        self.assertEqual(data["tenant_id"], "tenant_startup_01")
        self.assertEqual(data["subscription_status"], "ACTIVE")

    def test_ui_and_landing_page_routes(self):
        res_dash = self.client.get("/")
        self.assertEqual(res_dash.status_code, 200)

        res_landing = self.client.get("/landing")
        self.assertEqual(res_landing.status_code, 200)
        self.assertIn("NeriLabs", res_landing.text)

        res_sdk = self.client.get("/static/experiment_sdk.js")
        self.assertEqual(res_sdk.status_code, 200)


if __name__ == "__main__":
    unittest.main()


class TestBehavioralPricingRescueAndCompliance(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.api_key = "nerilabs_live_sk_rescue_test_123"
        self.tenant = db.create_tenant(
            organization_name="Rescue Test Tenant",
            api_key="nerilabs_live_sk_rescue_test_123"
        )
        db.save_behavioral_rescue_config(self.tenant.tenant_id, BehavioralRescueConfig(rescue_price_amount_cents=4900, promo_code="FOUNDER20", discount_percent=25))
        self.exp = Experiment(
            experiment_id="exp_rescue_test_01",
            tenant_id=self.tenant.tenant_id,
            title="Pricing Rescue Test",
            experiment_type=ExperimentType.PRICING_TEST,
            url="https://pricing.io",
            target_selector="#pro-price"
        )
        db.save_experiment(self.exp)
        # Create baseline pricing arms ($79 vs $49)
        self.variants = StripeBillingService.create_pricing_test_variants(
            self.exp, [("Pro Tier ($79/mo)", 7900), ("Pro Promo ($49/mo)", 4900)]
        )

    def test_behavioral_rescue_trigger_and_token_escalation(self):
        # 1. Issue initial baseline token ($79 tier)
        signed_tok, payload = TokenService.issue_new_token(
            tenant_id=self.exp.tenant_id,
            experiment_id=self.exp.experiment_id,
            session_id="sess_rescue_test",
            visitor_id="vis_hesitant_buyer",
            variant=self.variants[0]
        )

        # 2. Simulate 10 seconds dwell hesitation
        dwell_evt = TelemetryEventDTO(
            event_type=EventType.DWELL,
            tenant_id=self.exp.tenant_id,
            experiment_id=self.exp.experiment_id,
            opaque_variant_id=self.variants[0].opaque_id,
            visitor_id="vis_hesitant_buyer",
            session_id="sess_rescue_test",
            signed_token=signed_tok,
            metadata={"dwell_duration": 10.0}
        )

        triggered, escalated_token, payload_info, msg = FrictionEngine.evaluate_behavioral_event(dwell_evt)
        self.assertTrue(triggered)
        self.assertIsNotNone(escalated_token)
        self.assertTrue("FOUNDER" in payload_info["promo_code"] or len(payload_info["promo_code"]) > 0)
        self.assertGreaterEqual(payload_info["discount_percent"], 20)

        # 3. Verify in-place token resolves discounted price server-side
        ok, checkout_data, _ = StripeBillingService.resolve_price_for_checkout(escalated_token)
        self.assertTrue(ok)
        self.assertEqual(checkout_data["amount_cents"], 4900)
        self.assertTrue(checkout_data["commit_locked"])

        # 4. Verify Regulatory Pricing Disclosure was logged (FTC/EU Omnibus compliance)
        disclosures = db.list_pricing_disclosures(self.exp.tenant_id)
        self.assertGreater(len(disclosures), 0)
        recent_disc = disclosures[0]
        self.assertTrue(len(recent_disc.promo_code_applied) > 0)
        self.assertEqual(recent_disc.offered_price_cents, 4900)

    def test_behavioral_rescue_api_endpoints(self):
        # Configure rescue policy
        res_cfg = self.client.post("/api/v1/billing/behavioral-rescue/configure", json={
            "enabled": True,
            "dwell_threshold_seconds": 6.0,
            "promo_code": "STARTUP30",
            "discount_percent": 30,
            "rescue_price_amount_cents": 3900,
            "transparent_disclosure": True
        }, headers={"X-API-Key": self.api_key})
        self.assertEqual(res_cfg.status_code, 200)

        # Trigger simulation endpoint
        res_sim = self.client.post(
            f"/api/v1/behavior/trigger-rescue-simulation?experiment_id={self.exp.experiment_id}&dwell_seconds=8.0",
            headers={"X-API-Key": self.tenant.api_key}
        )
        self.assertEqual(res_sim.status_code, 200)
        sim_data = res_sim.json()
        self.assertTrue(sim_data["friction_triggered"])
        self.assertIn("promotional_rescue_payload", sim_data)


class TestBehavioralOfferAgent(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.exp = Experiment(
            experiment_id="exp_ai_offer_test",
            tenant_id="tenant_startup_01",
            title="AI Creative Offer Test",
            url="https://saas.io/pricing",
            target_selector="#pro-pricing"
        )
        db.save_experiment(self.exp)

    def test_behavioral_offer_agent_creative_synthesis(self):
        from saas_platform.agents.behavioral_offer_agent import BehavioralOfferAgent
        friction_context = {
            "dwell_seconds": 15.0,
            "hovered_element": "Enterprise Security Tier",
            "referrer": "Hacker News",
            "device_type": "desktop"
        }
        offers = BehavioralOfferAgent.generate_personalized_offers(
            experiment=self.exp,
            friction_context=friction_context,
            max_discount_pct=30
        )
        self.assertGreater(len(offers), 0)
        first_offer = offers[0]
        self.assertIn("promo_code", first_offer)
        self.assertIn("headline", first_offer)
        self.assertLessEqual(first_offer["discount_percent"], 30)

    def test_preview_creative_offers_endpoint(self):
        db.save_experiment(self.exp)
        res = self.client.post(
            f"/api/v1/behavior/generate-creative-offer-preview?experiment_id={self.exp.experiment_id}&hovered_element=Pro%20Plan",
            headers={"X-API-Key": "nerilabs_sk_live_9a8b7c6d5e4f3a2b1c"}
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("ai_generated_offers", data)
        self.assertGreater(len(data["ai_generated_offers"]), 0)


class TestFactorialCombinationsAndDimensionAnalytics(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.tenant = db.create_tenant(
            organization_name="Combinatorial Test Org",
            api_key="nerilabs_live_sk_comb_test_999"
        )
        self.exp = Experiment(
            experiment_id="exp_comb_test_01",
            tenant_id=self.tenant.tenant_id,
            title="Factorial Interaction Experiment",
            experiment_type=ExperimentType.COPY_UI,
            url="https://saas.io",
            target_selector="#cta-btn"
        )
        db.save_experiment(self.exp)

        # 1. Create Copy Variant
        self.copy_v = Variant(
            variant_id="var_c_social",
            opaque_id="opq_c_soc",
            experiment_id=self.exp.experiment_id,
            tenant_id=self.tenant.tenant_id,
            name="Copy: Social Proof",
            variant_type=VariantType.COPY,
            hypothesis="Social proof test",
            copy_payload={"selector": "#cta-btn", "new_text": "Join 2,500+ Founders", "trigger": "SOCIAL_PROOF"},
            status=VariantStatus.APPROVED
        )
        db.save_variant(self.copy_v)

        # 2. Create Style Variant
        self.style_v = Variant(
            variant_id="var_s_pill",
            opaque_id="opq_s_pill",
            experiment_id=self.exp.experiment_id,
            tenant_id=self.tenant.tenant_id,
            name="UI: Rounded Pill Geometry",
            variant_type=VariantType.STYLE,
            hypothesis="Pill geometry test",
            style_payload={"selector": "#cta-btn", "css_rules": {"border-radius": "9999px", "background-color": "#2563eb", "color": "#ffffff"}},
            status=VariantStatus.APPROVED
        )
        db.save_variant(self.style_v)

        # 3. Create Pricing Variant
        self.price_v = Variant(
            variant_id="var_p_49",
            opaque_id="opq_p_49",
            experiment_id=self.exp.experiment_id,
            tenant_id=self.tenant.tenant_id,
            name="Pricing: $49/mo",
            variant_type=VariantType.PRICING,
            hypothesis="Price elasticity test",
            pricing_payload={"plan_name": "Pro Tier", "price_amount_cents": 4900, "currency": "usd", "interval": "month", "stripe_price_id": "price_49"},
            status=VariantStatus.APPROVED
        )
        db.save_variant(self.price_v)

    def test_combinatorial_agent_merging(self):
        from saas_platform.agents.combinatorial_agent import CombinatorialAgent

        composites = CombinatorialAgent.synthesize_custom_combinations(
            experiment=self.exp,
            copy_variants=[self.copy_v],
            style_variants=[self.style_v],
            component_variants=[],
            pricing_variants=[self.price_v]
        )
        self.assertEqual(len(composites), 1)
        comp = composites[0]
        self.assertEqual(comp.variant_type, VariantType.COMPOSITE)
        self.assertIn("Social Proof", comp.name)
        self.assertIn("Rounded Pill", comp.name)
        self.assertIsNotNone(comp.copy_payload)
        self.assertIsNotNone(comp.style_payload)
        self.assertIsNotNone(comp.pricing_payload)

    def test_dimension_analytics_filtering_endpoint(self):
        from saas_platform.server import get_or_create_mab
        mab = get_or_create_mab(self.exp.experiment_id, self.tenant.tenant_id)
        mab.register_variant(self.copy_v)
        mab.register_variant(self.style_v)
        mab.register_variant(self.price_v)

        # Ingest telemetry
        mab.record_telemetry(TelemetryEventDTO(event_type=EventType.IMPRESSION, tenant_id=self.tenant.tenant_id, experiment_id=self.exp.experiment_id, opaque_variant_id=self.copy_v.opaque_id, visitor_id="v1"))
        mab.record_telemetry(TelemetryEventDTO(event_type=EventType.CONVERSION, tenant_id=self.tenant.tenant_id, experiment_id=self.exp.experiment_id, opaque_variant_id=self.copy_v.opaque_id, visitor_id="v1"))

        # Query Dimension Analytics
        res = self.client.get(f"/api/v1/experiments/{self.exp.experiment_id}/dimension-analytics?dimension=COPY")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["active_dimension_filter"], "COPY")
        self.assertIn("COPY", data["dimensions"])
        copy_summary = data["dimensions"]["COPY"]
        self.assertEqual(copy_summary["total_arms"], 1)
        self.assertGreater(copy_summary["blended_cvr"], 0.0)

    def test_synthesize_combinations_endpoint(self):
        res = self.client.post(
            f"/api/v1/experiments/{self.exp.experiment_id}/synthesize-combinations",
            json={
                "experiment_id": self.exp.experiment_id,
                "copy_variant_ids": [self.copy_v.variant_id],
                "style_variant_ids": [self.style_v.variant_id],
                "pricing_variant_ids": [self.price_v.variant_id],
                "auto_top_performers": False
            },
            headers={"X-API-Key": self.tenant.api_key}
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "success")
        self.assertGreater(data["total_combinations_created"], 0)
        self.assertGreater(data["registered_mab_arms"], 0)


class TestSecurityHardeningAndMultiTenancy(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.tenant_a = db.create_tenant(
            organization_name="Tenant A Security Test",
            api_key="nerilabs_sk_live_tenant_a_123",
            publishable_key="nerilabs_pk_live_tenant_a_123",
            token_signing_secret="secret_signing_key_tenant_a_xyz"
        )
        self.tenant_b = db.create_tenant(
            organization_name="Tenant B Security Test",
            api_key="nerilabs_sk_live_tenant_b_456",
            publishable_key="nerilabs_pk_live_tenant_b_456",
            token_signing_secret="secret_signing_key_tenant_b_uvw"
        )

    def test_missing_api_key_returns_401_unauthorized(self):
        # Calling privileged admin endpoint without X-API-Key MUST return 401
        res = self.client.post("/api/v1/experiments/create", json={
            "experiment_id": "exp_unauth_test",
            "tenant_id": self.tenant_a.tenant_id,
            "title": "Unauth Test",
            "experiment_type": "COPY_UI",
            "generation_mode": "FOUNDER_DIRECTED",
            "url": "https://test.io",
            "target_selector": "#cta"
        })
        self.assertEqual(res.status_code, 401)
        self.assertIn("Missing X-API-Key", res.json()["detail"])

    def test_publishable_key_cannot_access_admin_endpoints(self):
        # Passing a public client key (pk_live_...) to an admin endpoint MUST return 401
        res = self.client.post("/api/v1/experiments/create", json={
            "experiment_id": "exp_unauth_test",
            "tenant_id": self.tenant_a.tenant_id,
            "title": "Unauth Test",
            "experiment_type": "COPY_UI",
            "generation_mode": "FOUNDER_DIRECTED",
            "url": "https://test.io",
            "target_selector": "#cta"
        }, headers={"X-API-Key": self.tenant_a.publishable_key})
        self.assertEqual(res.status_code, 401)

    def test_per_tenant_jwt_signing_secret_prevents_cross_tenant_forgery(self):
        # 1. Issue a token for Tenant A using Tenant A's secret
        v_a = Variant(
            variant_id="var_ten_a",
            opaque_id="opq_ten_a",
            experiment_id="exp_ten_a",
            tenant_id=self.tenant_a.tenant_id,
            name="Variant A",
            variant_type=VariantType.COPY,
            hypothesis="h"
        )
        signed_tok_a, payload_a = TokenService.issue_new_token(
            tenant_id=self.tenant_a.tenant_id,
            experiment_id="exp_ten_a",
            session_id="sess_a",
            visitor_id="vis_a",
            variant=v_a
        )

        # 2. Tenant B's middleware attempts to verify Tenant A's token with Tenant B's secret
        mw_b = ExperimentationMiddleware(
            tenant_id=self.tenant_b.tenant_id,
            token_signing_secret=self.tenant_b.token_signing_secret
        )
        valid_b, _, err_b = mw_b.process_incoming_request({"X-Experiment-Token": signed_tok_a}, {})
        self.assertFalse(valid_b)
        self.assertIn("Invalid experiment token", err_b)

    def test_stripe_connect_account_id_correctly_used(self):
        self.tenant_a.stripe_connect_account_id = "acct_connected_stripe_real_789"
        self.tenant_a.stripe_customer_id = "cus_platform_billing_different_123"
        db.update_tenant(self.tenant_a)

        exp_pricing = Experiment(
            experiment_id="exp_pricing_connect_test",
            tenant_id=self.tenant_a.tenant_id,
            title="Connect Test",
            url="https://test.io",
            target_selector="#price"
        )
        db.save_experiment(exp_pricing)

        variants = StripeBillingService.create_pricing_test_variants(exp_pricing, [("Tier 1", 5000)])
        signed_tok, _ = TokenService.issue_new_token(
            tenant_id=self.tenant_a.tenant_id,
            experiment_id=exp_pricing.experiment_id,
            session_id="sess_conn",
            visitor_id="vis_conn",
            variant=variants[0]
        )

        ok, checkout_data, _ = StripeBillingService.resolve_price_for_checkout(signed_tok)
        self.assertTrue(ok)
        # MUST match stripe_connect_account_id, NEVER stripe_customer_id
        self.assertEqual(checkout_data["stripe_connect_account_id"], "acct_connected_stripe_real_789")

    def test_guardrail_override_and_anomaly_approve_strictly_require_auth(self):
        # 1. Unauthenticated override attempt MUST return 401
        res_ov = self.client.post(
            f"/api/v1/experiments/exp_mock/guardrail-audits/aud_mock/override",
            json={"override_approve": True, "reason": "test"}
        )
        self.assertEqual(res_ov.status_code, 401)

        # 2. Unauthenticated anomaly approve attempt MUST return 401
        res_anom = self.client.post(
            f"/api/v1/anomalies/prop_mock/approve"
        )
        self.assertEqual(res_anom.status_code, 401)

    def test_cross_tenant_isolation_on_anomaly_approval(self):
        # Create anomaly proposal belonging to Tenant A
        prop_a = AnomalyProposal(
            tenant_id=self.tenant_a.tenant_id,
            experiment_id="exp_a",
            metric_name="CVR",
            baseline_conversion_rate=0.10,
            observed_conversion_rate=0.02,
            relative_drop_pct=80.0,
            hypothesis="h",
            reasoning_trace="trace",
            proposed_variant=Variant(
                variant_id="var_prop_a",
                experiment_id="exp_a",
                tenant_id=self.tenant_a.tenant_id,
                name="Fix A",
                variant_type=VariantType.COPY,
                hypothesis="h"
            )
        )
        db.save_anomaly_proposal(prop_a)

        # Tenant B attempts to approve Tenant A's proposal -> MUST return 404 (isolated)
        res = self.client.post(
            f"/api/v1/anomalies/{prop_a.proposal_id}/approve",
            headers={"X-API-Key": self.tenant_b.api_key}
        )
        self.assertEqual(res.status_code, 404)

    def test_aws_healthcheck_endpoints(self):
        res = self.client.get("/health")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "healthy")
        self.assertEqual(data["service"], "nerilabs-saas-platform")

        res_z = self.client.get("/healthz")
        self.assertEqual(res_z.status_code, 200)
        self.assertEqual(res_z.json()["status"], "healthy")


class TestDOMScanner(unittest.TestCase):
    def test_dom_scanner_parsing(self):
        from saas_platform.inspector.dom_scanner import DOMScanner
        sample_html = '''
        <html>
            <body>
                <div class="hero">
                    <h1>Same Visitors. More Customers</h1>
                    <div class="hero-ctas">
                        <a href="#pricing" class="btn btn-primary" id="primary-cta">Start your first test</a>
                        <a href="#how" class="btn">See how it works</a>
                    </div>
                </div>
                <div class="price-card">
                    <button class="btn btn-primary">Launch test</button>
                </div>
            </body>
        </html>
        '''
        targets = DOMScanner.parse_html_for_targets(sample_html)
        self.assertGreaterEqual(len(targets), 2)
        
        # Verify primary CTA button was identified
        hero_target = next((t for t in targets if t["type"] == "BUTTON"), None)
        self.assertIsNotNone(hero_target)
        self.assertEqual(hero_target["selector"], "#primary-cta")
        self.assertIn("Start your first test", hero_target["text"])
        self.assertTrue(hero_target["recommended"])

        # Verify H1 headline was identified
        h1_target = next((t for t in targets if t["type"] == "HEADLINE"), None)
        self.assertIsNotNone(h1_target)
        self.assertIn("Same Visitors", h1_target["text"])


class TestUniversalMultiElementAssignment(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_universal_assignment_multi_elements(self):
        # 1. Setup Hero button test
        res1 = self.client.post('/api/v1/onboarding/setup', json={
            'website_url': 'https://startup.io',
            'target_selector': '.hero-ctas .btn-primary',
            'target_element_text': 'Start Free Trial'
        })
        self.assertEqual(res1.status_code, 200)

        # 2. Setup Pricing button test
        res2 = self.client.post('/api/v1/onboarding/setup', json={
            'website_url': 'https://startup.io',
            'target_selector': '.price-card .btn',
            'target_element_text': 'Choose Plan'
        })
        self.assertEqual(res2.status_code, 200)

        # 3. Call universal assign with single visitor
        res_univ = self.client.post('/api/v1/experiments/universal-assign', json={
            'visitor_id': 'vis_univ_test_unit'
        })
        self.assertEqual(res_univ.status_code, 200)
        data = res_univ.json()
        self.assertGreaterEqual(data['total_active_experiments'], 2)
        selectors = [a['target_selector'] for a in data['assignments']]
        self.assertIn('.hero-ctas .btn-primary', selectors)
        self.assertIn('.price-card .btn', selectors)


class TestPilotRequirementsApprovalDeletionBotShieldUTM(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.tenant = db.create_tenant(
            organization_name="Pilot Unit Test Org",
            api_key=f"sk_pilot_{uuid.uuid4().hex[:8]}",
            subscription_plan="GROWTH"
        )
        self.exp_id = f"exp_pilot_{uuid.uuid4().hex[:6]}"
        self.exp_payload = {
            "experiment_id": self.exp_id,
            "title": "Pilot Feedback Experiment",
            "experiment_type": "COPY_UI",
            "url": "https://pilot-customer.com",
            "target_selector": "#hero-cta",
            "target_element": {
                "tag": "button",
                "element_id": "hero_cta",
                "selector": "#hero-cta",
                "inner_text": "Start Free"
            }
        }
        res = self.client.post("/api/v1/experiments/create", json=self.exp_payload, headers={"X-API-Key": self.tenant.api_key})
        self.assertEqual(res.status_code, 200)

    def tearDown(self):
        db.delete_experiment(self.exp_id)
        MAB_ENGINES.pop(self.exp_id, None)

    def test_variant_approval_workflow(self):
        # 1. Fetch variants: verify AI variants start in PENDING_REVIEW and Control is APPROVED
        r_vars = self.client.get(f"/api/v1/experiments/{self.exp_id}/variants", headers={"X-API-Key": self.tenant.api_key})
        self.assertEqual(r_vars.status_code, 200)
        vars_list = r_vars.json()
        control_v = next(v for v in vars_list if v["is_control"])
        self.assertEqual(control_v["status"], "APPROVED")

        pending_vars = [v for v in vars_list if not v["is_control"] and v["status"] == "PENDING_REVIEW"]
        self.assertGreater(len(pending_vars), 0)

        # 2. Verify MAB only serves Control when other variants are unapproved
        mab = get_or_create_mab(self.exp_id, self.tenant.tenant_id)
        chosen_var, algo, prob = mab.select_variant_for_visitor("vis_unit_01")
        self.assertTrue(chosen_var.is_control)

        # 3. Founder Approves a Variant
        target_v = pending_vars[0]
        r_app = self.client.post(f"/api/v1/experiments/{self.exp_id}/variants/{target_v['variant_id']}/approve", headers={"X-API-Key": self.tenant.api_key})
        self.assertEqual(r_app.status_code, 200)
        self.assertEqual(r_app.json()["status"], "APPROVED")

        # 4. Founder Edits Variant Content with Guardrail Check
        r_edit = self.client.put(
            f"/api/v1/experiments/{self.exp_id}/variants/{target_v['variant_id']}",
            json={"copy_text": "Get Started in 60 Seconds"},
            headers={"X-API-Key": self.tenant.api_key}
        )
        self.assertEqual(r_edit.status_code, 200)
        self.assertEqual(r_edit.json()["copy_payload"]["new_text"], "Get Started in 60 Seconds")

        # 5. Founder Denies/Rejects a Variant
        r_rej = self.client.post(f"/api/v1/experiments/{self.exp_id}/variants/{pending_vars[1]['variant_id']}/reject", headers={"X-API-Key": self.tenant.api_key})
        self.assertEqual(r_rej.status_code, 200)
        self.assertEqual(r_rej.json()["status"], "REJECTED")

        # 6. Founder Approves All Pending
        r_app_all = self.client.post(f"/api/v1/experiments/{self.exp_id}/variants/approve-all", headers={"X-API-Key": self.tenant.api_key})
        self.assertEqual(r_app_all.status_code, 200)

    def test_bot_shield_and_utm_attribution(self):
        r_vars = self.client.get(f"/api/v1/experiments/{self.exp_id}/variants", headers={"X-API-Key": self.tenant.api_key})
        opq_id = r_vars.json()[0]["opaque_id"]

        # Bot Telemetry Event (should be isolated from MAB arm updates)
        bot_evt = {
            "event_type": "IMPRESSION",
            "experiment_id": self.exp_id,
            "opaque_variant_id": opq_id,
            "visitor_id": "vis_bot_crawler_unit",
            "metadata": {"is_bot": True, "utm_source": "googlebot", "source": "Googlebot"}
        }
        r_bot = self.client.post("/api/v1/telemetry/beacon", json={"tenant_id": self.tenant.tenant_id, "events": [bot_evt]})
        self.assertEqual(r_bot.status_code, 200)

        # Human Telemetry with UTM Sources
        human_events = [
            {
                "event_type": "IMPRESSION",
                "experiment_id": self.exp_id,
                "opaque_variant_id": opq_id,
                "visitor_id": "vis_insta_01",
                "metadata": {"is_bot": False, "utm_source": "instagram", "source": "Instagram", "source_category": "CASUAL_SOCIAL"}
            },
            {
                "event_type": "IMPRESSION",
                "experiment_id": self.exp_id,
                "opaque_variant_id": opq_id,
                "visitor_id": "vis_google_01",
                "metadata": {"is_bot": False, "utm_source": "google", "source": "Google", "source_category": "HIGH_INTENT"}
            },
            {
                "event_type": "CONVERSION",
                "experiment_id": self.exp_id,
                "opaque_variant_id": opq_id,
                "visitor_id": "vis_google_01",
                "metadata": {"is_bot": False, "utm_source": "google", "source": "Google"}
            }
        ]
        r_human = self.client.post("/api/v1/telemetry/beacon", json={"tenant_id": self.tenant.tenant_id, "events": human_events})
        self.assertEqual(r_human.status_code, 200)

        r_ana = self.client.get(f"/api/v1/experiments/{self.exp_id}/analytics")
        self.assertEqual(r_ana.status_code, 200)
        ana = r_ana.json()
        self.assertEqual(ana["bot_traffic_filtered"], 1)
        self.assertIn("Google", ana["traffic_by_source"])
        self.assertIn("Instagram", ana["traffic_by_source"])

    def test_experiment_deletion_and_authorization(self):
        # Other tenant cannot delete
        other_tenant = db.create_tenant(organization_name="Other", api_key="sk_other_unauthorized")
        r_unauth = self.client.delete(f"/api/v1/experiments/{self.exp_id}", headers={"X-API-Key": other_tenant.api_key})
        self.assertEqual(r_unauth.status_code, 403)

        # Owner can delete
        r_del = self.client.delete(f"/api/v1/experiments/{self.exp_id}", headers={"X-API-Key": self.tenant.api_key})
        self.assertEqual(r_del.status_code, 200)
        self.assertIsNone(db.get_experiment(self.exp_id))
        self.assertEqual(len(db.list_variants_for_experiment(self.exp_id)), 0)
        self.assertNotIn(self.exp_id, MAB_ENGINES)


    def test_custom_price_ids_and_payment_links(self):
        from saas_platform.models.schemas import PricingPlanInput
        from saas_platform.billing.stripe_service import StripeBillingService
        plans = [
            PricingPlanInput(
                plan_name="Tier A",
                price_dollars=49.0,
                stripe_price_id="price_custom_49",
                stripe_payment_link="https://buy.stripe.com/test_49",
                button_selector=".buy-btn"
            ),
            PricingPlanInput(
                plan_name="Tier B",
                price_dollars=79.0,
                stripe_price_id="price_custom_79",
                stripe_payment_link="https://buy.stripe.com/test_79",
                button_selector=".buy-btn"
            )
        ]
        from saas_platform.models.database import db
        exp = db.get_experiment(self.exp_id)
        variants = StripeBillingService.create_pricing_test_variants(exp, plans, default_button_selector=".buy-btn")
        self.assertEqual(len(variants), 2)
        self.assertEqual(variants[0].pricing_payload.stripe_price_id, "price_custom_49")
        self.assertEqual(variants[0].pricing_payload.stripe_payment_link, "https://buy.stripe.com/test_49")
        self.assertEqual(variants[1].pricing_payload.stripe_price_id, "price_custom_79")
        self.assertEqual(variants[1].pricing_payload.stripe_payment_link, "https://buy.stripe.com/test_79")

    def test_stripe_settings_endpoints(self):
        from fastapi.testclient import TestClient
        from saas_platform.server import app
        from saas_platform.config import Config
        client = TestClient(app)
        
        # 1. Update stripe settings
        res = client.post(
            "/api/v1/tenant/settings/stripe",
            json={"stripe_api_key": "rk_test_secret_123456789"},
            headers={"X-API-Key": Config.DEFAULT_API_KEY}
        )
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json()["is_connected"])
        
        # 2. Get stripe settings
        res2 = client.get(
            "/api/v1/tenant/settings/stripe",
            headers={"X-API-Key": Config.DEFAULT_API_KEY}
        )
        self.assertEqual(res2.status_code, 200)
        self.assertTrue(res2.json()["is_connected"])
        self.assertIn("rk_test", res2.json()["masked_key"])



class TestPricingScannerDifferentWebsitesAndPrices(unittest.TestCase):
    def setUp(self):
        from saas_platform.inspector.dom_scanner import DOMScanner
        self.scanner = DOMScanner
        self.client = TestClient(app)

    def test_scan_pricing_nerilabs_standard_tiers(self):
        """Tests standard 3-tier SaaS pricing table ($49, $99, $199)."""
        html = """
        <div class="pricing-grid">
            <div class="price-card">
                <h3 class="plan-name">Starter Plan</h3>
                <div class="price-amount">$49</div>
                <button class="btn btn-primary">Start Free Trial</button>
            </div>
            <div class="price-card featured">
                <h3 class="plan-name">Growth Plan</h3>
                <div class="price-amount">$99</div>
                <button class="btn btn-primary">Scale Conversions</button>
            </div>
            <div class="price-card">
                <h3 class="plan-name">Scale Plan</h3>
                <div class="price-amount">$199</div>
                <button class="btn btn-primary">Enterprise Access</button>
            </div>
        </div>
        """
        plans = self.scanner.scan_pricing_plans(url="https://test-startup.io", html=html)
        self.assertEqual(len(plans), 3)
        self.assertEqual(plans[0]["plan_name"], "Starter Plan")
        self.assertEqual(plans[0]["price_dollars"], 49)
        self.assertEqual(plans[1]["plan_name"], "Growth Plan")
        self.assertEqual(plans[1]["price_dollars"], 99)
        self.assertTrue(plans[1]["is_recommended"])
        self.assertEqual(plans[2]["plan_name"], "Scale Plan")
        self.assertEqual(plans[2]["price_dollars"], 199)

    def test_scan_pricing_tailwind_utility_classes(self):
        """Tests modern Tailwind website with 3 different tiers ($24, $79, $199) and Stripe payment links."""
        html = """
        <div id="pricing" class="max-w-7xl mx-auto py-12 px-4">
            <div class="grid grid-cols-3 gap-6">
                <div class="rounded-lg shadow border p-6">
                    <h2 class="text-xl font-bold">Freelancer</h2>
                    <div class="mt-4 text-3xl font-extrabold text-gray-900">$24<span class="text-sm">/mo</span></div>
                    <a href="https://buy.stripe.com/freelancer_123" class="mt-6 block rounded bg-blue-600 px-4 py-2 text-white">Get Started</a>
                </div>
                <div class="rounded-lg shadow border border-blue-500 p-6">
                    <h2 class="text-xl font-bold">Pro Developer</h2>
                    <div class="mt-4 text-3xl font-extrabold text-gray-900">$79<span class="text-sm">/mo</span></div>
                    <a href="https://buy.stripe.com/pro_456" class="mt-6 block rounded bg-blue-600 px-4 py-2 text-white">Get Started</a>
                </div>
                <div class="rounded-lg shadow border p-6">
                    <h2 class="text-xl font-bold">Agency Studio</h2>
                    <div class="mt-4 text-3xl font-extrabold text-gray-900">$199<span class="text-sm">/mo</span></div>
                    <a href="https://buy.stripe.com/agency_789" class="mt-6 block rounded bg-blue-600 px-4 py-2 text-white">Get Started</a>
                </div>
            </div>
        </div>
        """
        plans = self.scanner.scan_pricing_plans(url="https://tailwind-saas.com", html=html)
        self.assertEqual(len(plans), 3)
        self.assertEqual(plans[0]["plan_name"], "Freelancer")
        self.assertEqual(plans[0]["price_dollars"], 24)
        self.assertEqual(plans[0]["payment_link"], "https://buy.stripe.com/freelancer_123")
        
        self.assertEqual(plans[1]["plan_name"], "Pro Developer")
        self.assertEqual(plans[1]["price_dollars"], 79)
        self.assertEqual(plans[1]["payment_link"], "https://buy.stripe.com/pro_456")
        self.assertTrue(plans[1]["is_recommended"])

        self.assertEqual(plans[2]["plan_name"], "Agency Studio")
        self.assertEqual(plans[2]["price_dollars"], 199)
        self.assertEqual(plans[2]["payment_link"], "https://buy.stripe.com/agency_789")

    def test_scan_pricing_lean_startup_two_tiers(self):
        """Tests 2-tier startup ($9.99, $39.99) with decimal pricing & custom button IDs."""
        html = """
        <section class="pricing-table">
            <article class="plan-card">
                <span class="tier-title">Solo Hacker</span>
                <p class="cost">$9.99/month</p>
                <button id="btn-solo" class="action-btn">Sign Up</button>
            </article>
            <article class="plan-card highlight">
                <span class="tier-title">Team Pro</span>
                <p class="cost">$39.99/month</p>
                <button id="btn-team" class="action-btn">Upgrade</button>
            </article>
        </section>
        """
        plans = self.scanner.scan_pricing_plans(url="https://lean-startup.app", html=html)
        self.assertEqual(len(plans), 2)
        self.assertEqual(plans[0]["plan_name"], "Solo Hacker")
        self.assertEqual(plans[0]["price_dollars"], 9.99)
        self.assertEqual(plans[0]["button_selector"], "#btn-solo")

        self.assertEqual(plans[1]["plan_name"], "Team Pro")
        self.assertEqual(plans[1]["price_dollars"], 39.99)
        self.assertEqual(plans[1]["button_selector"], "#btn-team")
        self.assertTrue(plans[1]["is_recommended"])

    def test_scan_pricing_enterprise_four_tiers(self):
        """Tests 4-tier platform ($15, $45, $120, $350) with direct element IDs."""
        html = """
        <div id="pricing-section">
            <div class="pricing-tier" id="tier-basic">
                <h4>Micro</h4>
                <div class="price" id="price-micro">$15</div>
                <a class="cta-link" id="link-micro" href="https://buy.stripe.com/micro">Subscribe</a>
            </div>
            <div class="pricing-tier" id="tier-standard">
                <h4>Standard</h4>
                <div class="price" id="price-std">$45</div>
                <a class="cta-link" id="link-std" href="https://buy.stripe.com/std">Subscribe</a>
            </div>
            <div class="pricing-tier" id="tier-plus">
                <h4>Business Plus</h4>
                <div class="price" id="price-plus">$120</div>
                <a class="cta-link" id="link-plus" href="https://buy.stripe.com/plus">Subscribe</a>
            </div>
            <div class="pricing-tier" id="tier-enterprise">
                <h4>Scale Giant</h4>
                <div class="price" id="price-scale">$350</div>
                <a class="cta-link" id="link-scale" href="https://buy.stripe.com/scale">Subscribe</a>
            </div>
        </div>
        """
        plans = self.scanner.scan_pricing_plans(url="https://enterprise-suite.io", html=html)
        self.assertEqual(len(plans), 4)
        self.assertEqual([p["price_dollars"] for p in plans], [15, 45, 120, 350])
        self.assertEqual(plans[0]["price_selector"], "#price-micro")
        self.assertEqual(plans[0]["button_selector"], "#link-micro")
        self.assertEqual(plans[3]["price_selector"], "#price-scale")
        self.assertEqual(plans[3]["button_selector"], "#link-scale")

    def test_scan_pricing_currency_symbols(self):
        """Tests websites pricing in Euros and British Pounds."""
        euro_html = """
        <div class="pricing-plans">
            <div class="plan-box">
                <h3>Starter DE</h3>
                <span class="price-tag">€29 / Monat</span>
                <button class="btn-order">Jetzt Bestellen</button>
            </div>
            <div class="plan-box featured">
                <h3>Profi DE</h3>
                <span class="price-tag">€89 / Monat</span>
                <button class="btn-order">Jetzt Bestellen</button>
            </div>
        </div>
        """
        euro_plans = self.scanner.scan_pricing_plans(url="https://european-saas.de", html=euro_html)
        self.assertEqual(len(euro_plans), 2)
        self.assertEqual(euro_plans[0]["price_dollars"], 29)
        self.assertEqual(euro_plans[1]["price_dollars"], 89)

        gbp_html = """
        <div class="pricing-plans">
            <div class="plan-box">
                <h3>Starter UK</h3>
                <span class="price-tag">£35 / month</span>
                <button class="btn-order">Choose Plan</button>
            </div>
            <div class="plan-box">
                <h3>Growth UK</h3>
                <span class="price-tag">£75 / month</span>
                <button class="btn-order">Choose Plan</button>
            </div>
        </div>
        """
        gbp_plans = self.scanner.scan_pricing_plans(url="https://uk-saas.co.uk", html=gbp_html)
        self.assertEqual(len(gbp_plans), 2)
        self.assertEqual(gbp_plans[0]["price_dollars"], 35)
        self.assertEqual(gbp_plans[1]["price_dollars"], 75)

    def test_scan_pricing_api_endpoint_pre_deployment(self):
        """Tests POST /api/v1/inspector/scan-pricing with raw HTML for testing before deploying."""
        payload = {
            "url": "https://my-unreleased-startup.com/pricing",
            "html": """
            <div id="pricing" class="container">
                <div class="pricing-card">
                    <h4>Early Bird</h4>
                    <span class="amount">$19</span>
                    <button class="btn">Claim Offer</button>
                </div>
                <div class="pricing-card">
                    <h4>Founding Member</h4>
                    <span class="amount">$49</span>
                    <button class="btn">Join Now</button>
                </div>
            </div>
            """
        }
        res = self.client.post("/api/v1/inspector/scan-pricing", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "success")
        self.assertEqual(len(data["plans"]), 2)
        self.assertEqual(data["plans"][0]["plan_name"], "Early Bird")
        self.assertEqual(data["plans"][0]["price_dollars"], 19)
        self.assertEqual(data["plans"][1]["plan_name"], "Founding Member")
        self.assertEqual(data["plans"][1]["price_dollars"], 49)

    def test_scan_pricing_offline_fallback(self):
        """Tests scanner resilience when given an unreachable URL without HTML."""
        res = self.client.post("/api/v1/inspector/scan-pricing", json={"url": "https://offline-nonexistent-domain.xyz"})
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "success")
        self.assertGreaterEqual(len(data["plans"]), 2)
        # Should return safe default mock tiers
        self.assertIn("Starter Plan", [p["plan_name"] for p in data["plans"]])

    def test_e2e_scanned_pricing_plans_to_mab_variants(self):
        """End-to-End: scan custom website pricing tiers and convert them to live experiment variants."""
        from saas_platform.billing.stripe_service import StripeBillingService
        from saas_platform.models.schemas import PricingPlanInput
        from saas_platform.models.database import db

        html = """
        <div id="pricing">
            <div class="plan-box">
                <h3>Starter</h3>
                <span class="cost">$25</span>
                <a id="btn-p1" href="https://buy.stripe.com/p1">Buy</a>
            </div>
            <div class="plan-box">
                <h3>Professional</h3>
                <span class="cost">$85</span>
                <a id="btn-p2" href="https://buy.stripe.com/p2">Buy</a>
            </div>
        </div>
        """
        scanned = self.scanner.scan_pricing_plans(url="https://test-saas.com", html=html)
        self.assertEqual(len(scanned), 2)

        # Convert scanned output into PricingPlanInput models
        plan_inputs = [
            PricingPlanInput(
                plan_name=p["plan_name"],
                price_dollars=float(p["price_dollars"]),
                price_selector=p["price_selector"],
                button_selector=p["button_selector"],
                stripe_payment_link=p["payment_link"],
                stripe_price_id=f"price_{int(p['price_dollars'])}"
            )
            for p in scanned
        ]

        tenant = db.create_tenant(organization_name="Pricing Test Org", api_key=f"sk_price_{uuid.uuid4().hex[:6]}")
        res_exp = self.client.post("/api/v1/experiments/create", json={
            "experiment_id": f"exp_price_{uuid.uuid4().hex[:6]}",
            "title": "Pricing Elasticity Test",
            "url": "https://test-saas.com",
            "target_selector": plan_inputs[0].button_selector,
            "target_element": {
                "tag": "a",
                "element_id": "btn_p1",
                "selector": plan_inputs[0].button_selector,
                "inner_text": "Buy"
            },
            "experiment_type": "PRICING_TEST"
        }, headers={"X-API-Key": tenant.api_key})
        self.assertEqual(res_exp.status_code, 200)

        created_exp = db.get_experiment(res_exp.json()["experiment_id"])
        variants = StripeBillingService.create_pricing_test_variants(
            created_exp, plan_inputs, default_button_selector=plan_inputs[0].button_selector
        )
        self.assertEqual(len(variants), 2)
        self.assertEqual(variants[0].pricing_payload.price_amount_cents, 2500)
        self.assertEqual(variants[1].pricing_payload.price_amount_cents, 8500)



class TestFounderDiscountCascadeAndVariantDeletion(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.tenant = db.create_tenant(
            organization_name="Cascade Delete Test Org",
            api_key=f"sk_cascade_{uuid.uuid4().hex[:8]}",
            subscription_plan="GROWTH"
        )
        self.exp_id = f"exp_cascade_{uuid.uuid4().hex[:6]}"
        res = self.client.post("/api/v1/experiments/create", json={
            "experiment_id": self.exp_id,
            "title": "Pricing Elasticity Test",
            "experiment_type": "PRICING_TEST",
            "url": "https://startup.io/pricing",
            "target_selector": ".price-card:nth-child(2) .price-amount",
            "target_element": {
                "tag": "div",
                "element_id": "price_starter",
                "selector": ".price-card:nth-child(2) .price-amount",
                "inner_text": "$49"
            }
        }, headers={"X-API-Key": self.tenant.api_key})
        self.assertEqual(res.status_code, 200)

    def test_cascade_delete_founder_discount_on_experiment_delete(self):
        # 1. Founder creates a rescue discount during or alongside experiment
        rescue_cfg = BehavioralRescueConfig(
            enabled=True,
            promo_code="FOUNDER25",
            discount_percent=25,
            rescue_price_amount_cents=3900,
            modal_headline="Founder Special Discount",
            modal_body="Claim 25% off your growth plan."
        )
        db.save_behavioral_rescue_config(self.tenant.tenant_id, rescue_cfg)
        self.assertIsNotNone(db.get_behavioral_rescue_config(self.tenant.tenant_id))

        # 2. Founder deletes the pricing experiment
        r_del = self.client.delete(f"/api/v1/experiments/{self.exp_id}", headers={"X-API-Key": self.tenant.api_key})
        self.assertEqual(r_del.status_code, 200)

        # 3. Verify founder discount / rescue policy was cascade-deleted
        self.assertIsNone(db.get_behavioral_rescue_config(self.tenant.tenant_id))
        from saas_platform.behavior.friction_engine import FrictionEngine
        default_cfg = FrictionEngine.get_or_default_config(self.tenant.tenant_id)
        self.assertFalse(default_cfg.enabled)

    def test_explicit_delete_behavioral_rescue_endpoint(self):
        # 1. Save rescue policy
        rescue_cfg = BehavioralRescueConfig(enabled=True, promo_code="SPECIAL20")
        db.save_behavioral_rescue_config(self.tenant.tenant_id, rescue_cfg)

        # 2. Call DELETE /api/v1/billing/behavioral-rescue
        res = self.client.delete("/api/v1/billing/behavioral-rescue", headers={"X-API-Key": self.tenant.api_key})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["status"], "success")

        # 3. Verify it is deleted
        self.assertIsNone(db.get_behavioral_rescue_config(self.tenant.tenant_id))

    def test_delete_single_variant_from_combinations_matrix(self):
        # 1. List variants
        r_vars = self.client.get(f"/api/v1/experiments/{self.exp_id}/variants", headers={"X-API-Key": self.tenant.api_key})
        self.assertEqual(r_vars.status_code, 200)
        vars_list = r_vars.json()
        non_control = [v for v in vars_list if not v["is_control"]]
        control = [v for v in vars_list if v["is_control"]][0]
        self.assertGreater(len(non_control), 0)

        # 2. Delete non-control variant
        target_var_id = non_control[0]["variant_id"]
        r_del = self.client.delete(f"/api/v1/experiments/{self.exp_id}/variants/{target_var_id}", headers={"X-API-Key": self.tenant.api_key})
        self.assertEqual(r_del.status_code, 200)
        self.assertEqual(r_del.json()["deleted_variant_id"], target_var_id)

        # 3. Verify removed from DB
        remaining_vars = db.list_variants_for_experiment(self.exp_id)
        self.assertNotIn(target_var_id, [v.variant_id for v in remaining_vars])

        # 4. Verify cannot delete control baseline
        r_del_ctrl = self.client.delete(f"/api/v1/experiments/{self.exp_id}/variants/{control['variant_id']}", headers={"X-API-Key": self.tenant.api_key})
        self.assertEqual(r_del_ctrl.status_code, 400)

    def test_pricing_variant_targeting_exact_chosen_tier(self):
        from saas_platform.models.schemas import PricingPlanInput

        # Founder launches dynamic pricing test targeting Starter ($49) tier specifically
        p_res = self.client.post("/api/v1/billing/pricing-test/create", json={
            "experiment_id": f"exp_starter_test_{uuid.uuid4().hex[:6]}",
            "title": "Starter Plan Elasticity Test",
            "target_selector": ".pricing-grid > :nth-child(2) .price-amount",
            "button_selector": ".pricing-grid > :nth-child(2) .btn",
            "plans": [
                {
                    "plan_name": "Starter Plan ($49/mo)",
                    "price_dollars": 49.0,
                    "price_selector": ".pricing-grid > :nth-child(2) .price-amount",
                    "button_selector": ".pricing-grid > :nth-child(2) .btn"
                },
                {
                    "plan_name": "Starter Plan ($79/mo)",
                    "price_dollars": 79.0,
                    "price_selector": ".pricing-grid > :nth-child(2) .price-amount",
                    "button_selector": ".pricing-grid > :nth-child(2) .btn"
                }
            ]
        }, headers={"X-API-Key": self.tenant.api_key})
        self.assertEqual(p_res.status_code, 200)
        p_exp_id = p_res.json()["experiment_id"]

        # Test universal assign routes visitor to the chosen Starter selector
        res_assign = self.client.post("/api/v1/experiments/universal-assign", json={"visitor_id": "vis_starter_pick"}, headers={"X-Publishable-Key": self.tenant.publishable_key})
        self.assertEqual(res_assign.status_code, 200)
        assignments = res_assign.json()["assignments"]
        matching = next(a for a in assignments if a["experiment_id"] == p_exp_id)
        self.assertEqual(matching["target_selector"], ".pricing-grid > :nth-child(2) .price-amount")



class TestMultiTierPricingAndBehavioralRescueTargeting(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.tenant = db.create_tenant(
            organization_name="Multi-Tier Test Org",
            api_key=f"sk_mt_{uuid.uuid4().hex[:8]}",
            subscription_plan="SCALE"
        )
        self.exp_starter = self.client.post("/api/v1/billing/pricing-test/create", json={
            "experiment_id": f"exp_starter_{uuid.uuid4().hex[:6]}",
            "title": "Starter Plan Elasticity",
            "target_selector": ".pricing-grid > :nth-child(1) .plan-price",
            "button_selector": ".pricing-grid > :nth-child(1) .btn",
            "plans": [
                {"plan_name": "Starter Plan ($49)", "price_dollars": 49.0, "price_selector": ".pricing-grid > :nth-child(1) .plan-price"},
                {"plan_name": "Starter Plan ($29)", "price_dollars": 29.0, "price_selector": ".pricing-grid > :nth-child(1) .plan-price"}
            ]
        }, headers={"X-API-Key": self.tenant.api_key}).json()["experiment_id"]

    def test_concurrent_multi_tier_pricing_experiments_remain_active(self):
        # 1. Launch a second experiment targeting Growth ($99 vs $79)
        r_growth = self.client.post("/api/v1/billing/pricing-test/create", json={
            "experiment_id": f"exp_growth_{uuid.uuid4().hex[:6]}",
            "title": "Growth Plan Elasticity",
            "target_selector": ".pricing-grid > :nth-child(2) .plan-price",
            "button_selector": ".pricing-grid > :nth-child(2) .btn",
            "plans": [
                {"plan_name": "Growth Plan ($99)", "price_dollars": 99.0, "price_selector": ".pricing-grid > :nth-child(2) .plan-price"},
                {"plan_name": "Growth Plan ($79)", "price_dollars": 79.0, "price_selector": ".pricing-grid > :nth-child(2) .plan-price"}
            ]
        }, headers={"X-API-Key": self.tenant.api_key})
        self.assertEqual(r_growth.status_code, 200)
        exp_growth = r_growth.json()["experiment_id"]

        # 2. Verify BOTH experiments are active
        e_starter = db.get_experiment(self.exp_starter)
        e_growth = db.get_experiment(exp_growth)
        self.assertTrue(e_starter.is_active)
        self.assertTrue(e_growth.is_active)

        # 3. Verify universal assign serves both tiers to visitors
        res = self.client.post("/api/v1/experiments/universal-assign", json={"visitor_id": "vis_multi_tier"}, headers={"X-Publishable-Key": self.tenant.publishable_key})
        self.assertEqual(res.status_code, 200)
        assigns = res.json()["assignments"]
        e_ids = [a["experiment_id"] for a in assigns]
        self.assertIn(self.exp_starter, e_ids)
        self.assertIn(exp_growth, e_ids)

    def test_rescue_policy_does_not_pollute_mab_arms(self):
        # Configure rescue policy
        self.client.post("/api/v1/billing/behavioral-rescue/configure", json={
            "enabled": True,
            "target_tier": "STARTER",
            "dwell_threshold_seconds": 4.0,
            "rescue_price_amount_cents": 2000,
            "promo_code": "RESCUE20"
        }, headers={"X-API-Key": self.tenant.api_key})

        # Trigger dwell friction
        dwell_event = {
            "event_id": f"evt_{uuid.uuid4().hex[:6]}",
            "event_type": "DWELL",
            "experiment_id": self.exp_starter,
            "tenant_id": self.tenant.tenant_id,
            "visitor_id": "vis_hesitant_buyer",
            "opaque_variant_id": "opq_unknown",
            "signed_token": "untokenized",
            "metadata": {"dwell_duration": 6.0}
        }
        res_beacon = self.client.post("/api/v1/telemetry/beacon", json={
            "tenant_id": self.tenant.tenant_id,
            "events": [dwell_event]
        }, headers={"X-Publishable-Key": self.tenant.publishable_key})
        self.assertEqual(res_beacon.status_code, 200)
        data = res_beacon.json()
        self.assertIsNotNone(data["rescue_action"])
        self.assertEqual(data["rescue_action"]["discounted_price_formatted"], "$20/mo")

        # Verify created concession variant is RESCUE_ONLY
        concession_var = db.get_variant(data["rescue_action"]["variant_id"])
        self.assertEqual(concession_var.status, "RESCUE_ONLY")

        # Verify MAB does NOT serve the $20 rescue offer to normal incoming visitors
        mab = get_or_create_mab(self.exp_starter, self.tenant.tenant_id)
        for i in range(15):
            chosen_v, algo, _ = mab.select_variant_for_visitor(f"cold_visitor_{i}")
            self.assertNotEqual(chosen_v.status, "RESCUE_ONLY")
            self.assertNotEqual(chosen_v.pricing_payload.price_amount_cents, 2000)

    def test_rescue_target_tier_selection(self):
        # Configure rescue policy targeting SCALE tier
        self.client.post("/api/v1/billing/behavioral-rescue/configure", json={
            "enabled": True,
            "target_tier": "SCALE",
            "dwell_threshold_seconds": 4.0,
            "rescue_price_amount_cents": 12000,
            "promo_code": "SCALE-DEAL"
        }, headers={"X-API-Key": self.tenant.api_key})

        from saas_platform.behavior.friction_engine import FrictionEngine
        evt = TelemetryEventDTO(
            event_id=f"evt_scale_{uuid.uuid4().hex[:6]}",
            event_type=EventType.DWELL,
            experiment_id=self.exp_starter,
            tenant_id=self.tenant.tenant_id,
            visitor_id="vis_scale_hesitant",
            opaque_variant_id="opq_scale",
            signed_token="untokenized",
            metadata={"dwell_duration": 6.0},
            timestamp=time.time()
        )
        triggered, token, payload, msg = FrictionEngine.evaluate_behavioral_event(evt)
        self.assertTrue(triggered)
        self.assertEqual(payload["plan_name"], "Scale Plan")
        self.assertIn(":nth-child(3)", payload["target_selector"])
        self.assertEqual(payload["original_price_formatted"], "$199/mo")
        self.assertEqual(payload["discounted_price_formatted"], "$120/mo")

from saas_platform.agents.copy_agent import CopyAgent
class TestContextualScanningAndMultiPricingNonPollution(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.tenant = db.create_tenant(
            organization_name="Contextual Multi-Test Org",
            api_key=f"sk_ctx_{uuid.uuid4().hex[:8]}",
            subscription_plan="ENTERPRISE"
        )

    def test_contextual_copy_generation_non_ab_site(self):
        """Verify that copy generated for a non-A/B testing website is fully contextual and contains no static generic copy."""
        exp = Experiment(
            experiment_id=f"exp_coffee_{uuid.uuid4().hex[:6]}",
            tenant_id=self.tenant.tenant_id,
            title="Artisan Coffee Roaster Hero Test",
            url="https://blueheroncoffee.com",
            target_selector="h1",
            target_element=DOMElement(
                tag="h1",
                element_id="coffee-h1",
                selector="h1",
                inner_text="Fresh Roasted Single-Origin Specialty Coffee"
            ),
            brand_guidelines=BrandGuidelines(brand_name="Blue Heron Coffee")
        )
        db.save_experiment(exp)

        variants = CopyAgent.generate_variants(exp)
        self.assertEqual(len(variants), 6)

        for v in variants:
            text = v.copy_payload["new_text"]
            # Must NOT contain the old static generic copy
            self.assertNotIn("automate your testing workflow", text.lower())
            self.assertNotIn("2,500+ fast-growing startups", text.lower())
            self.assertNotIn("unoptimized landing pages", text.lower())
            # Must be contextual to the actual coffee topic
            self.assertTrue(
                "coffee" in text.lower() or "fresh" in text.lower() or "blue heron" in text.lower() or "specialty" in text.lower(),
                f"Generated variant '{text}' is not contextual to the scanned website"
            )

    def test_rescue_variant_does_not_pollute_pricing_experiment_variants(self):
        """Verify that when behavioral rescue triggers, the concession is NOT added to the pricing experiment's variants list."""
        exp_id = f"exp_scale_clean_{uuid.uuid4().hex[:6]}"
        plans = [
            {"plan_name": "Scale Control", "price_dollars": 199, "price_selector": ".pricing-grid > :nth-child(3) .plan-price"},
            {"plan_name": "Scale Test", "price_dollars": 249, "price_selector": ".pricing-grid > :nth-child(3) .plan-price"}
        ]
        res_create = self.client.post("/api/v1/billing/pricing-test/create", json={
            "experiment_id": exp_id,
            "title": "Scale Pricing Clean Test",
            "target_selector": ".pricing-grid > :nth-child(3) .plan-price",
            "plans": plans
        }, headers={"X-API-Key": self.tenant.api_key})
        self.assertEqual(res_create.status_code, 200)

        # Baseline variants should be exactly 2
        orig_variants = db.list_variants_for_experiment(exp_id)
        self.assertEqual(len(orig_variants), 2)

        # Configure rescue policy with $20 discount
        self.client.post("/api/v1/billing/behavioral-rescue/configure", json={
            "enabled": True,
            "target_tier": "SCALE",
            "dwell_threshold_seconds": 3.0,
            "rescue_price_amount_cents": 2000,
            "promo_code": "RESCUE20"
        }, headers={"X-API-Key": self.tenant.api_key})

        # Trigger rescue beacon
        evt = {
            "event_id": f"evt_dwell_{uuid.uuid4().hex[:6]}",
            "event_type": "DWELL",
            "experiment_id": exp_id,
            "tenant_id": self.tenant.tenant_id,
            "visitor_id": "vis_hesitant_founder",
            "opaque_variant_id": orig_variants[0].opaque_id,
            "signed_token": "untokenized",
            "metadata": {"dwell_duration": 5.0}
        }
        res_beacon = self.client.post("/api/v1/telemetry/beacon", json={
            "tenant_id": self.tenant.tenant_id,
            "events": [evt]
        }, headers={"X-Publishable-Key": self.tenant.publishable_key})
        self.assertEqual(res_beacon.status_code, 200)
        data = res_beacon.json()
        self.assertIsNotNone(data["rescue_action"])

        # CRITICAL ASSERTION: The pricing experiment's variants list must STILL have exactly 2 variants!
        # The $20 rescue offer must NOT be added as one of the experiment's variants!
        exp_variants_after = db.list_variants_for_experiment(exp_id)
        self.assertEqual(len(exp_variants_after), 2)

        res_api_vars = self.client.get(f"/api/v1/experiments/{exp_id}/variants")
        self.assertEqual(res_api_vars.status_code, 200)
        api_vars = res_api_vars.json()
        self.assertEqual(len(api_vars), 2)
        for v in api_vars:
            self.assertNotEqual(v["status"], "RESCUE_ONLY")
            self.assertNotIn("Rescue Concession", v["name"])

    def test_multiple_concurrent_pricing_experiments(self):
        """Verify that creating another pricing experiment keeps previous experiments active and running concurrently."""
        exp_starter = f"exp_starter_{uuid.uuid4().hex[:6]}"
        exp_growth = f"exp_growth_{uuid.uuid4().hex[:6]}"

        # Create Starter test
        res1 = self.client.post("/api/v1/billing/pricing-test/create", json={
            "experiment_id": exp_starter,
            "title": "Starter Elasticity",
            "target_selector": ".pricing-grid > :nth-child(1) .plan-price",
            "plans": [
                {"plan_name": "Starter A", "price_dollars": 49},
                {"plan_name": "Starter B", "price_dollars": 39}
            ]
        }, headers={"X-API-Key": self.tenant.api_key})
        self.assertEqual(res1.status_code, 200)

        # Create Growth test
        res2 = self.client.post("/api/v1/billing/pricing-test/create", json={
            "experiment_id": exp_growth,
            "title": "Growth Elasticity",
            "target_selector": ".pricing-grid > :nth-child(2) .plan-price",
            "plans": [
                {"plan_name": "Growth A", "price_dollars": 99},
                {"plan_name": "Growth B", "price_dollars": 79}
            ]
        }, headers={"X-API-Key": self.tenant.api_key})
        self.assertEqual(res2.status_code, 200)

        # Both must remain active
        e1 = db.get_experiment(exp_starter)
        e2 = db.get_experiment(exp_growth)
        self.assertTrue(e1.is_active)
        self.assertTrue(e2.is_active)

        # Universal assign must return both active experiments
        res_univ = self.client.post("/api/v1/experiments/universal-assign", json={
            "visitor_id": "vis_concurrent_shopper"
        }, headers={"X-Publishable-Key": self.tenant.publishable_key})
        self.assertEqual(res_univ.status_code, 200)
        assignments = res_univ.json()["assignments"]
        exp_ids = [a["experiment_id"] for a in assignments]
        self.assertIn(exp_starter, exp_ids)
        self.assertIn(exp_growth, exp_ids)

    def test_variant_edit_pricing_and_copy(self):
        """Verify founders can update copy text, hypothesis, and pricing parameters via PUT endpoint."""
        exp_id = f"exp_edit_{uuid.uuid4().hex[:6]}"
        self.client.post("/api/v1/billing/pricing-test/create", json={
            "experiment_id": exp_id,
            "title": "Editable Test",
            "target_selector": ".plan-price",
            "plans": [{"plan_name": "Plan 1", "price_dollars": 50}]
        }, headers={"X-API-Key": self.tenant.api_key})

        variants = db.list_variants_for_experiment(exp_id)
        var = variants[0]

        # Update pricing variant price and plan name
        res_put = self.client.put(f"/api/v1/experiments/{exp_id}/variants/{var.variant_id}", json={
            "plan_name": "Updated Custom Plan",
            "price_dollars": 65.0,
            "hypothesis": "Adjusted hypothesis for founder review"
        }, headers={"X-API-Key": self.tenant.api_key})
        self.assertEqual(res_put.status_code, 200)

        updated_var = db.get_variant(var.variant_id)
        self.assertEqual(updated_var.pricing_payload.plan_name, "Updated Custom Plan")
        self.assertEqual(updated_var.pricing_payload.price_amount_cents, 6500)
        self.assertEqual(updated_var.hypothesis, "Adjusted hypothesis for founder review")

class TestDesignPartnerKeys(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_all_ten_design_partner_keys_authorized_as_admin(self):
        """Verify that all 10 design partner keys have full Enterprise access just like the master admin key."""
        for i in range(1, 11):
            key = f"nerilabs_design_partner_{i}"

            # 1. Verify is_admin_key returns True
            from saas_platform.server import is_admin_key
            self.assertTrue(is_admin_key(key), f"Key {key} failed admin check")

            # 2. Verify admin login endpoint accepts the key
            res_login = self.client.post("/api/v1/auth/admin-login", json={"admin_key": key})
            self.assertEqual(res_login.status_code, 200, f"Login failed for {key}: {res_login.text}")
            data = res_login.json()
            self.assertTrue(data["is_admin"])
            self.assertEqual(data["subscription_plan"], "ENTERPRISE")
            self.assertGreaterEqual(data["plan_limits"]["max_experiments"], 9999)
            self.assertTrue(data["plan_limits"]["has_stripe_pricing"])
            self.assertTrue(data["plan_limits"]["has_anomalies"])

            # 3. Verify API calls with X-API-Key have Enterprise permissions
            res_tenant = self.client.get("/api/v1/tenant/me", headers={"X-API-Key": key})
            self.assertEqual(res_tenant.status_code, 200)
            t_data = res_tenant.json()
            self.assertEqual(t_data["subscription_plan"], "ENTERPRISE")

            # 4. Verify script tag assignment with X-Publishable-Key works seamlessly
            res_assign = self.client.post("/api/v1/experiments/universal-assign", json={
                "visitor_id": f"vis_partner_test_{i}"
            }, headers={"X-Publishable-Key": key})
            self.assertEqual(res_assign.status_code, 200)
