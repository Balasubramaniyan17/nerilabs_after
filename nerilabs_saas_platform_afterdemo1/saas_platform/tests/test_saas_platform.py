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
