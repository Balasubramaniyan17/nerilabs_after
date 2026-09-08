"""
Production Multi-Tenant SaaS Server for Autonomous Experimentation (FastAPI).
Provides isolated endpoints for:
- Self-serve onboarding wizard & instant script-tag provisioning.
- Public client SDK variant assignment & batched telemetry ingestion.
- Founder-privileged experiment management & guardrail override control.
- Stripe Connect pricing elasticity & server-side checkout resolution.
- Behavioral promotional rescue policy configuration & simulation.
- Autonomous anomaly detection inbox & 1-click founder approvals.
- Factorial combinations & category dimension analytics.
"""

import os
import time
from typing import List, Dict, Optional, Any
from fastapi import FastAPI, HTTPException, Header, Query, Request, Response
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from saas_platform.config import Config
from saas_platform.models.schemas import (
    Tenant,
    Experiment,
    ExperimentType,
    GenerationMode,
    BrandGuidelines,
    DOMElement,
    Variant,
    VariantType,
    VariantStatus,
    AssignVariantReq,
    TelemetryEventDTO,
    SignedTokenResponse,
    TelemetryBatchReq,
    OverrideAuditReq,
    AnomalyProposal,
    OnboardingSetupReq,
    OnboardingSetupResponse,
    PricingPlanInput,
    CreatePricingTestReq,
    PricingTestResponse,
    CreateCheckoutSessionReq,
    BehavioralRescueConfig,
    PricingDisclosureAuditRecord,
    DimensionSummary,
    DimensionAnalyticsResponse,
    SynthesizeCombinationsReq,
    CombinationSynthesisResponse,
)
from saas_platform.models.database import db
from saas_platform.security.token_service import TokenService
from saas_platform.agents.orchestrator import AgentOrchestrator
from saas_platform.guardrails.engine import GuardrailEngine
from saas_platform.guardrails.audit_logger import AuditLogger
from saas_platform.bandit.thompson_sampling import MABEngine
from saas_platform.billing.stripe_service import StripeBillingService
from saas_platform.behavior.friction_engine import FrictionEngine
from saas_platform.autonomous.anomaly_engine import AnomalyDetectionEngine

app = FastAPI(
    title="NeriLabs SaaS — Autonomous Experimentation Platform",
    version="2.1.0",
    docs_url="/api/docs",
    redoc_url=None
)

# Dynamic Origin-Reflecting CORS for cross-origin telemetry & sendBeacon
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r".*",
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"]
)

# Mount Dashboard Static Files
STATIC_DIR = os.path.join(os.path.dirname(__file__), "dashboard", "static")
TEMPLATES_DIR = os.path.join(os.path.dirname(__file__), "dashboard", "templates")
if os.path.exists(STATIC_DIR):
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

MAB_ENGINES: Dict[str, MABEngine] = {}

# Disable static caching during development / preview to prevent stale scripts
@app.middleware("http")
async def add_no_cache_headers(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/static/") or request.url.path in ["/", "/landing"]:
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

@app.on_event("startup")
def startup_event():
    # Production startup: ensure clean database state with zero simulation
    try:
        db.clean_all_simulated_metrics()
        print("[Startup] Production ready. Zero simulated metrics. Authentic traffic monitoring active.")
    except Exception as e:
        print(f"[Startup] Startup note: {e}")
    except Exception as e:
        print(f"[Startup] Init notice: {e}")



def get_or_create_mab(experiment_id: str, tenant_id: str) -> MABEngine:
    if experiment_id not in MAB_ENGINES:
        MAB_ENGINES[experiment_id] = MABEngine(
            experiment_id=experiment_id,
            tenant_id=tenant_id,
            exploration_floor=Config.MAB_DEFAULT_EXPLORATION_FLOOR,
            min_sample_threshold=Config.MAB_MIN_SAMPLE_THRESHOLD
        )
    return MAB_ENGINES[experiment_id]


def authenticate_tenant(x_api_key: Optional[str]) -> Tenant:
    if not x_api_key or not x_api_key.strip():
        raise HTTPException(
            status_code=401,
            detail="Unauthorized: Missing X-API-Key header. Secret admin API key required."
        )
    tenant = db.get_tenant_by_api_key(x_api_key.strip())
    if not tenant:
        raise HTTPException(
            status_code=401,
            detail="Unauthorized: Invalid Secret API Key."
        )
    return tenant


# =====================================================================

def get_effective_base_url(request: Request) -> str:
    """Resolves effective public base URL, respecting APP_BASE_URL config or reverse-proxy headers."""
    if Config.APP_BASE_URL and Config.APP_BASE_URL.strip():
        return Config.APP_BASE_URL.strip().rstrip("/")
    return str(request.base_url).rstrip("/")


# =====================================================================
# 0. HEALTH CHECK & SYSTEM MONITORING (AWS ALB / APPRUNNER / ECS)
# =====================================================================

@app.get("/health", response_class=JSONResponse)
@app.get("/healthz", response_class=JSONResponse)
def health_check():
    """Lightweight healthcheck endpoint for load balancers and container orchestrators."""
    return JSONResponse(
        status_code=200,
        content={
            "status": "healthy",
            "service": "nerilabs-saas-platform",
            "version": "2.1.0",
            "timestamp": time.time()
        }
    )

# 1. DASHBOARD & LANDING HTML ROUTES
# =====================================================================

@app.get("/", response_class=HTMLResponse)
def serve_dashboard():
    index_file = os.path.join(TEMPLATES_DIR, "index.html")
    if os.path.exists(index_file):
        with open(index_file, "r") as f:
            return HTMLResponse(content=f.read())
    return HTMLResponse("<h1>NeriLabs SaaS Platform Dashboard</h1>")


@app.get("/landing", response_class=HTMLResponse)
def serve_landing():
    landing_file = os.path.join(TEMPLATES_DIR, "landing.html")
    if os.path.exists(landing_file):
        with open(landing_file, "r") as f:
            return HTMLResponse(content=f.read())
    return HTMLResponse("<h1>NeriLabs SaaS Landing</h1>")


@app.get("/api/v1/tenant/me", response_model=Tenant)
def get_current_tenant(x_api_key: Optional[str] = Header(None, alias="X-API-Key")):
    return authenticate_tenant(x_api_key)


# =====================================================================
# 2. INSTANT ONBOARDING WIZARD & SCRIPT PROVISIONING
# =====================================================================

@app.post("/api/v1/onboarding/setup", response_model=OnboardingSetupResponse)
def handle_onboarding_setup(
    req: OnboardingSetupReq,
    request: Request,
    x_api_key: Optional[str] = Header(None, alias="X-API-Key")
):
    tenant = authenticate_tenant(x_api_key)

    tenant.target_website_url = req.website_url
    if req.stripe_restricted_key:
        tenant.stripe_customer_id = f"cus_rk_{req.stripe_restricted_key[:8]}"
    tenant.onboarding_completed = True
    db.update_tenant(tenant)

    exp_id = f"exp_{tenant.tenant_id[:8]}_hero"
    existing_exp = db.get_experiment(exp_id)
    if not existing_exp:
        exp = Experiment(
            experiment_id=exp_id,
            tenant_id=tenant.tenant_id,
            title="Homepage CTA Conversion Optimization",
            experiment_type=ExperimentType.COPY_UI,
            generation_mode=GenerationMode.FOUNDER_DIRECTED,
            url=req.website_url,
            target_selector=req.target_selector,
            target_element=DOMElement(
                tag="button",
                element_id=req.target_selector.replace("#", ""),
                selector=req.target_selector,
                inner_text=req.target_element_text or "Get Started"
            ),
            brand_guidelines=BrandGuidelines(
                brand_name=tenant.organization_name,
                primary_color=req.brand_primary_color or "#2563eb",
                accent_color=req.brand_accent_color or "#f59e0b"
            )
        )
        db.save_experiment(exp)
    else:
        exp = existing_exp

    raw_variants = AgentOrchestrator.generate_and_cache_experiment_suite(exp)
    approved_count = 0
    mab = get_or_create_mab(exp.experiment_id, tenant.tenant_id)

    for v in raw_variants:
        report = GuardrailEngine.validate_variant(v, exp)
        if report.is_safe:
            db.save_variant(v)
            mab.register_variant(v)
            approved_count += 1

    base_url = get_effective_base_url(request)
    script_tag = f"""<!-- NeriLabs Autonomous Experimentation SDK (Public Safe) -->
<script>
  window.AI_EXPERIMENT_API_BASE = "{base_url}";
  window.AI_EXPERIMENT_PUBLISHABLE_KEY = "{tenant.publishable_key}";
  window.AI_EXPERIMENT_ID = "{exp.experiment_id}";
  window.AI_EXPERIMENT_TARGET_SELECTOR = "{exp.target_selector}";
</script>
<script src="{base_url}/static/experiment_sdk.js" async></script>"""

    return OnboardingSetupResponse(
        status="success",
        tenant_id=tenant.tenant_id,
        publishable_key=tenant.publishable_key,
        secret_api_key=tenant.api_key,
        experiment_id=exp.experiment_id,
        variants_generated=len(raw_variants),
        variants_approved=approved_count,
        script_tag_html=script_tag,
        client_api_base=base_url,
        dashboard_url=f"{base_url}/"
    )


# =====================================================================
# 3. EXPERIMENT MANAGEMENT (FOUNDER AUTHENTICATED)
# =====================================================================


@app.get("/api/v1/experiments/tenant/list", response_model=List[Experiment])
def list_tenant_experiments(
    x_api_key: Optional[str] = Header(None, alias="X-API-Key")
):
    tenant = authenticate_tenant(x_api_key)
    return db.list_experiments_for_tenant(tenant.tenant_id)

@app.post("/api/v1/experiments/create", response_model=Experiment)
def create_experiment(
    exp: Experiment,
    x_api_key: Optional[str] = Header(None, alias="X-API-Key")
):
    tenant = authenticate_tenant(x_api_key)
    exp.tenant_id = tenant.tenant_id
    db.save_experiment(exp)
    return exp


@app.post("/api/v1/experiments/{experiment_id}/generate-suite")
def generate_experiment_suite(
    experiment_id: str,
    x_api_key: Optional[str] = Header(None, alias="X-API-Key")
):
    tenant = authenticate_tenant(x_api_key)
    exp = db.get_experiment(experiment_id)
    if not exp or exp.tenant_id != tenant.tenant_id:
        raise HTTPException(status_code=404, detail="Experiment not found")

    raw_variants = AgentOrchestrator.generate_and_cache_experiment_suite(exp)
    approved_variants = []
    rejected_variants = []
    mab = get_or_create_mab(experiment_id, exp.tenant_id)

    for v in raw_variants:
        report = GuardrailEngine.validate_variant(v, exp)
        if report.is_safe:
            db.save_variant(v)
            mab.register_variant(v)
            approved_variants.append(v)
        else:
            rejected_variants.append({
                "variant_id": v.variant_id,
                "name": v.name,
                "reasons": report.blocked_reasons
            })

    return {
        "status": "success",
        "experiment_id": experiment_id,
        "total_generated": len(raw_variants),
        "approved_count": len(approved_variants),
        "rejected_count": len(rejected_variants),
        "approved_variants": approved_variants,
        "rejected_details": rejected_variants
    }


@app.get("/api/v1/experiments/{experiment_id}/variants", response_model=List[Variant])
def list_variants(experiment_id: str):
    return db.list_variants_for_experiment(experiment_id)


@app.get("/api/v1/experiments/{experiment_id}/guardrail-audits")
def get_guardrail_audits(experiment_id: str):
    return db.get_audit_logs(experiment_id)


@app.post("/api/v1/experiments/{experiment_id}/guardrail-audits/{audit_id}/override")
def override_guardrail_audit(
    experiment_id: str,
    audit_id: str,
    req: OverrideAuditReq,
    x_api_key: Optional[str] = Header(None, alias="X-API-Key")
):
    tenant = authenticate_tenant(x_api_key)
    exp = db.get_experiment(experiment_id)
    if not exp or exp.tenant_id != tenant.tenant_id:
        raise HTTPException(status_code=404, detail="Experiment not found")

    success = AuditLogger.founder_override_decision(
        experiment_id=experiment_id,
        audit_id=audit_id,
        override_approve=req.override_approve,
        reason=req.reason
    )
    if not success:
        raise HTTPException(status_code=404, detail="Audit record not found")
    return {"status": "success", "audit_id": audit_id, "overridden": True}


# =====================================================================
# 4. PUBLIC CLIENT SDK ASSIGNMENT & TELEMETRY BEACONS
# =====================================================================

@app.post("/api/v1/experiments/{experiment_id}/assign", response_model=SignedTokenResponse)
def assign_variant_and_issue_token(
    experiment_id: str,
    req: AssignVariantReq,
    x_publishable_key: Optional[str] = Header(None, alias="X-Publishable-Key")
):
    exp = db.get_experiment(experiment_id)
    if not exp or not exp.is_active:
        raise HTTPException(status_code=404, detail="Active experiment not found")

    mab = get_or_create_mab(exp.experiment_id, exp.tenant_id)
    sess_id = req.session_id or f"sess_{req.visitor_id}"

    try:
        chosen_variant, algorithm, win_prob = mab.select_variant_for_visitor(req.visitor_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    signed_token, payload = TokenService.issue_new_token(
        tenant_id=exp.tenant_id,
        experiment_id=exp.experiment_id,
        session_id=sess_id,
        visitor_id=req.visitor_id,
        variant=chosen_variant
    )

    client_payload = {}
    if chosen_variant.copy_payload:
        client_payload["copy_payload"] = chosen_variant.copy_payload
    if chosen_variant.style_payload:
        client_payload["style_payload"] = chosen_variant.style_payload
    if chosen_variant.component_payload:
        client_payload["component_payload"] = chosen_variant.component_payload
    if chosen_variant.pricing_payload:
        client_payload["pricing_payload"] = chosen_variant.pricing_payload.dict() if hasattr(chosen_variant.pricing_payload, "dict") else chosen_variant.pricing_payload.model_dump()
    if chosen_variant.variant_type.value == "COMPOSITE":
        client_payload["is_composite"] = True

    return SignedTokenResponse(
        signed_token=signed_token,
        opaque_variant_id=chosen_variant.opaque_id,
        experiment_id=exp.experiment_id,
        is_control=chosen_variant.is_control,
        client_action=algorithm,
        payload=client_payload,
        expires_at=payload.expires_at
    )


@app.post("/api/v1/telemetry/beacon")
def ingest_telemetry_batch(
    req: TelemetryBatchReq,
    x_publishable_key: Optional[str] = Header(None, alias="X-Publishable-Key")
):
    recorded_count = 0
    duplicate_count = 0

    for event in req.events:
        is_new = db.record_telemetry_event(event)
        if is_new:
            recorded_count += 1
            mab = get_or_create_mab(event.experiment_id, event.tenant_id)
            mab.record_telemetry(event)

            # Evaluate behavioral rescue triggers
            FrictionEngine.evaluate_behavioral_event(event)
        else:
            duplicate_count += 1

    return {
        "status": "success",
        "recorded_events": recorded_count,
        "deduplicated_events": duplicate_count
    }


# =====================================================================
# 5. STRIPE CONNECT & PRICING ELASTICITY
# =====================================================================

@app.post("/api/v1/billing/pricing-test/create", response_model=PricingTestResponse)
def create_pricing_experiment(
    req: CreatePricingTestReq,
    x_api_key: Optional[str] = Header(None, alias="X-API-Key")
):
    tenant = authenticate_tenant(x_api_key)

    exp = Experiment(
        experiment_id=req.experiment_id,
        tenant_id=tenant.tenant_id,
        title=req.title,
        experiment_type=ExperimentType.PRICING_TEST,
        generation_mode=GenerationMode.FOUNDER_DIRECTED,
        url=req.url or tenant.target_website_url or "https://startup.io",
        target_selector=req.target_selector or "#pricing-table",
        goal_event="STRIPE_CHECKOUT"
    )
    db.save_experiment(exp)

    plans_data = [(p.name, int(p.price_dollars * 100)) for p in req.plans]
    pricing_variants = StripeBillingService.create_pricing_test_variants(exp, plans_data)

    mab = get_or_create_mab(exp.experiment_id, tenant.tenant_id)
    for v in pricing_variants:
        mab.register_variant(v)

    return PricingTestResponse(
        status="success",
        experiment_id=exp.experiment_id,
        variants_created=len(pricing_variants),
        plans=pricing_variants
    )


@app.post("/api/v1/billing/checkout/resolve")
def resolve_checkout_pricing(
    x_experiment_token: Optional[str] = Header(None, alias="X-Experiment-Token")
):
    if not x_experiment_token:
        raise HTTPException(status_code=400, detail="Missing X-Experiment-Token header")

    success, checkout_data, msg = StripeBillingService.resolve_price_for_checkout(x_experiment_token)
    if not success or not checkout_data:
        raise HTTPException(status_code=400, detail=msg)

    return checkout_data


@app.post("/api/v1/billing/stripe/webhook")
def handle_stripe_webhook(payload: Dict[str, Any], request: Request):
    sig = request.headers.get("Stripe-Signature")
    success, msg, tenant, magic_url = StripeBillingService.handle_saas_subscription_webhook(payload, sig)
    return {"status": "success", "message": msg, "tenant_id": tenant.tenant_id if tenant else None}


# =====================================================================
# 6. BEHAVIORAL RESCUE PRICING & DISCLOSURES
# =====================================================================

@app.post("/api/v1/billing/behavioral-rescue/configure")
def configure_behavioral_rescue(
    cfg: BehavioralRescueConfig,
    x_api_key: Optional[str] = Header(None, alias="X-API-Key")
):
    tenant = authenticate_tenant(x_api_key)
    db.save_behavioral_rescue_config(tenant.tenant_id, cfg)
    return {"status": "success", "tenant_id": tenant.tenant_id, "config": cfg}


@app.post("/api/v1/behavior/trigger-rescue-simulation")
def simulate_behavioral_rescue(
    experiment_id: str,
    dwell_seconds: float = 10.0,
    x_api_key: Optional[str] = Header(None, alias="X-API-Key")
):
    tenant = authenticate_tenant(x_api_key)
    exp = db.get_experiment(experiment_id)
    if not exp or exp.tenant_id != tenant.tenant_id:
        raise HTTPException(status_code=404, detail="Experiment not found")

    mab = get_or_create_mab(experiment_id, tenant.tenant_id)
    approved_vars = [v for v in db.list_variants_for_experiment(experiment_id) if v.status == "APPROVED" or v.is_control]
    base_var = approved_vars[0] if approved_vars else Variant(variant_id="v_mock", opaque_id="opq_mock", experiment_id=experiment_id, tenant_id=tenant.tenant_id, name="Control", variant_type=VariantType.PRICING, hypothesis="h")

    signed_tok, payload = TokenService.issue_new_token(
        tenant_id=tenant.tenant_id,
        experiment_id=experiment_id,
        session_id=f"sess_sim_{int(time.time())}",
        visitor_id=f"vis_sim_{int(time.time())}",
        variant=base_var
    )

    dwell_evt = TelemetryEventDTO(
        event_type="DWELL",
        tenant_id=tenant.tenant_id,
        experiment_id=experiment_id,
        opaque_variant_id=base_var.opaque_id,
        visitor_id=payload.visitor_id,
        session_id=payload.session_id,
        signed_token=signed_tok,
        metadata={"dwell_duration": dwell_seconds, "hovered_element": "Pro Tier"}
    )
    triggered, escalated_token, rescue_payload, msg = FrictionEngine.evaluate_behavioral_event(dwell_evt)

    return {
        "friction_triggered": triggered,
        "escalated_token": escalated_token,
        "promotional_rescue_payload": rescue_payload,
        "message": msg
    }


# =====================================================================
# 7. ANOMALY DETECTION INBOX & FOUNDER APPROVAL (FOUNDER AUTHENTICATED)
# =====================================================================

@app.post("/api/v1/anomalies/scan")
def trigger_anomaly_scan(
    experiment_id: str,
    x_api_key: Optional[str] = Header(None, alias="X-API-Key")
):
    tenant = authenticate_tenant(x_api_key)
    exp = db.get_experiment(experiment_id)
    if not exp or exp.tenant_id != tenant.tenant_id:
        raise HTTPException(status_code=404, detail="Experiment not found")

    proposal = AnomalyDetectionEngine.scan_for_anomalies(tenant.tenant_id, experiment_id)
    return {"status": "scanned", "anomaly_found": proposal is not None, "proposal": proposal}


@app.get("/api/v1/anomalies/list", response_model=List[AnomalyProposal])
def list_anomaly_proposals(
    x_api_key: Optional[str] = Header(None, alias="X-API-Key")
):
    tenant = authenticate_tenant(x_api_key)
    return db.list_anomaly_proposals(tenant.tenant_id)


@app.post("/api/v1/anomalies/{proposal_id}/approve")
def approve_anomaly_proposal(
    proposal_id: str,
    x_api_key: Optional[str] = Header(None, alias="X-API-Key")
):
    tenant = authenticate_tenant(x_api_key)
    proposal = db.get_anomaly_proposal(proposal_id)
    if not proposal or proposal.tenant_id != tenant.tenant_id:
        raise HTTPException(status_code=404, detail="Proposal not found for this tenant")

    success = AnomalyDetectionEngine.approve_proposal(proposal_id, reviewer_name=tenant.organization_name)
    if not success:
        raise HTTPException(status_code=404, detail="Proposal not found or already processed")
    return {"status": "approved_and_deployed", "proposal_id": proposal_id}


# =====================================================================
# 8. TRAFFIC SIMULATOR (FOUNDER AUTHENTICATED)
# =====================================================================

@app.post("/api/v1/experiments/{experiment_id}/simulate-traffic")
def simulate_traffic(
    experiment_id: str,
    visitors: int = 50,
    x_api_key: Optional[str] = Header(None, alias="X-API-Key")
):
    tenant = authenticate_tenant(x_api_key)
    exp = db.get_experiment(experiment_id)
    if not exp or exp.tenant_id != tenant.tenant_id:
        raise HTTPException(status_code=404, detail="Experiment not found")

    mab = get_or_create_mab(experiment_id, exp.tenant_id)
    approved_vars = [v for v in db.list_variants_for_experiment(experiment_id) if v.status == "APPROVED" or v.is_control]
    if not approved_vars:
        return {"status": "error", "message": "No approved variants"}

    for i in range(visitors):
        vid = f"vis_sim_{int(time.time())}_{i}"
        sid = f"sess_sim_{int(time.time())}_{i}"
        chosen_var, algo, _ = mab.select_variant_for_visitor(vid)

        signed_tok, _ = TokenService.issue_new_token(
            tenant_id=tenant.tenant_id,
            experiment_id=experiment_id,
            session_id=sid,
            visitor_id=vid,
            variant=chosen_var
        )

        impr_evt = TelemetryEventDTO(
            event_type="IMPRESSION",
            tenant_id=tenant.tenant_id,
            experiment_id=experiment_id,
            opaque_variant_id=chosen_var.opaque_id,
            visitor_id=vid,
            session_id=sid,
            signed_token=signed_tok
        )
        db.record_telemetry_event(impr_evt)
        mab.record_telemetry(impr_evt)

        # Baseline conversion simulation
        p_conv = 0.045
        if "Social Proof" in chosen_var.name or "Composite" in chosen_var.name:
            p_conv = 0.18
        elif "Form" in chosen_var.name or "Capture" in chosen_var.name:
            p_conv = 0.14

        import random
        if random.random() < p_conv:
            conv_evt = TelemetryEventDTO(
                event_type="CONVERSION",
                tenant_id=tenant.tenant_id,
                experiment_id=experiment_id,
                opaque_variant_id=chosen_var.opaque_id,
                visitor_id=vid,
                session_id=sid,
                signed_token=signed_tok,
                reward_value=1.0
            )
            db.record_telemetry_event(conv_evt)
            mab.record_telemetry(conv_evt)

    return {"status": "success", "simulated_visitors": visitors}


# =====================================================================
# 9. DIMENSION ANALYTICS & FACTORIAL SYNTHESIS
# =====================================================================

@app.get("/api/v1/experiments/{experiment_id}/analytics")
def get_experiment_analytics(experiment_id: str):
    exp = db.get_experiment(experiment_id)
    tenant_id = exp.tenant_id if exp else "tenant_startup_01"
    mab = get_or_create_mab(experiment_id, tenant_id)
    return mab.compute_analytics()


@app.get("/api/v1/experiments/{experiment_id}/dimension-analytics", response_model=DimensionAnalyticsResponse)
def get_dimension_analytics(
    experiment_id: str,
    dimension: Optional[str] = Query("ALL", description="Filter by COPY, STYLE, COMPONENT, PRICING, COMPOSITE, or ALL")
):
    exp = db.get_experiment(experiment_id)
    tenant_id = exp.tenant_id if exp else "tenant_startup_01"
    mab = get_or_create_mab(experiment_id, tenant_id)
    analytics = mab.compute_analytics()

    control_arm = next((a for a in analytics.arms if a.is_control), None)
    control_cvr = control_arm.conversion_rate if control_arm and control_arm.impressions > 0 else 0.045

    dimension_groups: Dict[str, List[Any]] = {
        "COPY": [],
        "STYLE": [],
        "COMPONENT": [],
        "PRICING": [],
        "COMPOSITE": []
    }

    for arm in analytics.arms:
        vtype = arm.variant_type.value if hasattr(arm.variant_type, "value") else str(arm.variant_type)
        if vtype in dimension_groups:
            dimension_groups[vtype].append(arm)

    dimension_summaries: Dict[str, DimensionSummary] = {}
    for dim_name, arm_list in dimension_groups.items():
        total_impr = sum(a.impressions for a in arm_list)
        total_conv = sum(a.conversions for a in arm_list)
        blended_cvr = total_conv / max(1, total_impr)

        best_arm = max(arm_list, key=lambda a: (a.conversion_rate, a.impressions)) if arm_list else None
        best_cvr = best_arm.conversion_rate if best_arm else 0.0
        lift = ((best_cvr - control_cvr) / max(0.001, control_cvr)) * 100.0 if best_arm else 0.0

        dimension_summaries[dim_name] = DimensionSummary(
            dimension_name=dim_name,
            total_arms=len(arm_list),
            total_impressions=total_impr,
            total_conversions=total_conv,
            blended_cvr=round(blended_cvr, 4),
            best_arm_id=best_arm.variant_id if best_arm else None,
            best_arm_name=best_arm.variant_name if best_arm else None,
            best_arm_cvr=round(best_cvr, 4),
            lift_over_control_pct=round(lift, 1)
        )

    target_dim = dimension.upper() if dimension else "ALL"
    filtered_arms = dimension_groups[target_dim] if target_dim in dimension_groups and target_dim != "ALL" else analytics.arms

    return DimensionAnalyticsResponse(
        experiment_id=experiment_id,
        tenant_id=tenant_id,
        control_cvr=round(control_cvr, 4),
        active_dimension_filter=target_dim,
        dimensions=dimension_summaries,
        filtered_arms=filtered_arms
    )


@app.post("/api/v1/experiments/{experiment_id}/synthesize-combinations", response_model=CombinationSynthesisResponse)
def synthesize_combinations(
    experiment_id: str,
    req: SynthesizeCombinationsReq,
    x_api_key: Optional[str] = Header(None, alias="X-API-Key")
):
    tenant = authenticate_tenant(x_api_key)
    exp = db.get_experiment(experiment_id)
    if not exp or exp.tenant_id != tenant.tenant_id:
        raise HTTPException(status_code=404, detail="Experiment not found")

    from saas_platform.agents.combinatorial_agent import CombinatorialAgent

    mab = get_or_create_mab(experiment_id, tenant.tenant_id)
    analytics = mab.compute_analytics()

    if req.auto_top_performers:
        composites = CombinatorialAgent.auto_synthesize_top_performers(exp, analytics.arms)
    else:
        all_exp_variants = db.list_variants_for_experiment(experiment_id)
        vmap = {v.variant_id: v for v in all_exp_variants}

        copy_vars = [vmap[vid] for vid in req.copy_variant_ids if vid in vmap]
        style_vars = [vmap[vid] for vid in req.style_variant_ids if vid in vmap]
        comp_vars = [vmap[vid] for vid in req.component_variant_ids if vid in vmap]
        price_vars = [vmap[vid] for vid in req.pricing_variant_ids if vid in vmap]

        composites = CombinatorialAgent.synthesize_custom_combinations(
            experiment=exp,
            copy_variants=copy_vars,
            style_variants=style_vars,
            component_variants=comp_vars,
            pricing_variants=price_vars
        )

    approved_composites = []
    for comp in composites:
        report = GuardrailEngine.validate_variant(comp, exp)
        if report.is_safe:
            db.save_variant(comp)
            mab.register_variant(comp)
            approved_composites.append(comp)

    return CombinationSynthesisResponse(
        status="success",
        experiment_id=experiment_id,
        total_combinations_created=len(composites),
        composite_variants=approved_composites,
        registered_mab_arms=len(approved_composites)
    )


@app.post("/api/v1/billing/checkout/create-session")
def create_saas_checkout_session(req: CreateCheckoutSessionReq, request: Request):
    base_url = get_effective_base_url(request)
    session = StripeBillingService.create_saas_checkout_session(
        plan_id=req.plan_id,
        customer_email=req.customer_email,
        customer_name=req.customer_name,
        success_url=req.success_url,
        cancel_url=req.cancel_url,
        base_url=base_url
    )
    return session


@app.post("/api/v1/behavior/generate-creative-offer-preview")
def preview_ai_creative_offers(
    experiment_id: str,
    hovered_element: Optional[str] = "Pro Plan ($79/mo)",
    x_api_key: Optional[str] = Header(None, alias="X-API-Key")
):
    tenant = authenticate_tenant(x_api_key)
    exp = db.get_experiment(experiment_id)
    if not exp or exp.tenant_id != tenant.tenant_id:
        raise HTTPException(status_code=404, detail="Experiment not found")

    from saas_platform.agents.behavioral_offer_agent import BehavioralOfferAgent
    friction_context = {
        "dwell_seconds": 12.5,
        "hovered_element": hovered_element,
        "referrer": "Product Hunt",
        "device_type": "desktop"
    }

    offers = BehavioralOfferAgent.generate_personalized_offers(
        experiment=exp,
        friction_context=friction_context,
        max_discount_pct=25
    )

    return {
        "status": "success",
        "experiment_id": experiment_id,
        "hovered_element": hovered_element,
        "ai_generated_offers": offers
    }


@app.post("/api/v1/billing/create-checkout-session")
def create_saas_checkout_session_alias(req: CreateCheckoutSessionReq, request: Request):
    base_url = get_effective_base_url(request)
    session = StripeBillingService.create_saas_checkout_session(
        plan_id=req.plan_id,
        customer_email=req.customer_email,
        customer_name=req.customer_name,
        success_url=req.success_url,
        cancel_url=req.cancel_url,
        base_url=base_url
    )
    return {
        "status": "success",
        "checkout_session_id": session["id"],
        "checkout_url": session["url"],
        "plan_name": session["plan_name"],
        "amount_cents": session["amount_cents"]
    }


@app.post("/api/v1/billing/saas-checkout-webhook")
def handle_saas_checkout_webhook(payload: Dict[str, Any], request: Request):
    sig = request.headers.get("Stripe-Signature")
    success, msg, tenant, magic_url = StripeBillingService.handle_saas_subscription_webhook(payload, sig)
    return {
        "status": "provisioned" if tenant else "ignored",
        "message": msg,
        "tenant_id": tenant.tenant_id if tenant else None,
        "magic_login_url": magic_url
    }
