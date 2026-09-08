"""
Pydantic Schemas & DTOs for the Multi-Tenant Experimentation Platform.
Includes Self-Serve Subscription, Automatic Tenant Provisioning & Onboarding Models.
"""

from enum import Enum
from typing import Dict, List, Optional, Any, Tuple
from pydantic import BaseModel, Field
import time
import uuid


class GenerationMode(str, Enum):
    FOUNDER_DIRECTED = "FOUNDER_DIRECTED"   # Macro tests (Copy, UI, Pricing, Onboarding)
    BEHAVIOR_TRIGGERED = "BEHAVIOR_TRIGGERED" # Micro interventions / friction triggers
    AUTONOMOUS = "AUTONOMOUS"               # Scheduled anomaly scanner proposals


class ExperimentType(str, Enum):
    COPY_UI = "COPY_UI"
    PRICING_TEST = "PRICING_TEST"
    ONBOARDING_FUNNEL = "ONBOARDING_FUNNEL"


class VariantType(str, Enum):
    COPY = "COPY"
    STYLE = "STYLE"
    COMPONENT = "COMPONENT"
    PRICING = "PRICING"
    ONBOARDING_SCHEMA = "ONBOARDING_SCHEMA"
    COMPOSITE = "COMPOSITE"


class VariantStatus(str, Enum):
    DRAFT = "DRAFT"
    VALIDATING = "VALIDATING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    ACTIVE = "ACTIVE"
    PAUSED = "PAUSED"


class PsychologicalTrigger(str, Enum):
    URGENCY = "URGENCY"
    SOCIAL_PROOF = "SOCIAL_PROOF"
    VALUE_PROPOSITION = "VALUE_PROPOSITION"
    LOSS_AVERSION = "LOSS_AVERSION"
    CLARITY = "CLARITY"
    FRICTION_REDUCTION = "FRICTION_REDUCTION"
    DEFAULT = "DEFAULT"


class EventType(str, Enum):
    IMPRESSION = "IMPRESSION"
    DWELL = "DWELL"
    SCROLL_PAST = "SCROLL_PAST"
    CLICK = "CLICK"
    CONVERSION = "CONVERSION"
    PAYMENT_INTENT_CREATED = "PAYMENT_INTENT_CREATED"
    ONBOARDING_STEP_PERSISTED = "ONBOARDING_STEP_PERSISTED"
    DISCLOSURE_ACKNOWLEDGED = "DISCLOSURE_ACKNOWLEDGED"


class CheckSeverity(str, Enum):
    INFO = "INFO"
    WARNING = "WARNING"
    CRITICAL = "CRITICAL"


class AnomalyProposalStatus(str, Enum):
    PROPOSED = "PROPOSED"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


class SubscriptionPlan(str, Enum):
    STARTER = "price_starter_49"  # $49/mo (up to 50k visits)
    GROWTH = "price_growth_99"    # $99/mo (up to 250k visits + anomaly detection)
    SCALE = "price_scale_199"     # $199/mo (unlimited + custom guardrails)


class Tenant(BaseModel):
    tenant_id: str = ""
    organization_name: str
    contact_email: Optional[str] = None
    api_key: str  # Secret Admin Key (sk_live_...) - NEVER shared in browser
    publishable_key: str = ""  # Public Client Key (pk_live_...) - Safe for browser script tags
    token_signing_secret: str = ""  # Per-Tenant HMAC-SHA256 JWT Secret
    created_at: float = Field(default_factory=time.time)
    subscription_plan: str = "GROWTH"
    subscription_status: str = "ACTIVE"
    stripe_customer_id: Optional[str] = None
    stripe_subscription_id: Optional[str] = None
    stripe_connect_account_id: Optional[str] = None
    target_website_url: Optional[str] = None
    pricing_disclosure_policy_enabled: bool = True
    onboarding_completed: bool = False


class BrandGuidelines(BaseModel):
    brand_name: str = "Default Brand"
    primary_color: str = "#2563eb"
    secondary_color: str = "#1e40af"
    accent_color: str = "#f59e0b"
    background_color: str = "#ffffff"
    text_color: str = "#1f2937"
    allowed_font_families: List[str] = Field(
        default_factory=lambda: ["Inter", "system-ui", "sans-serif", "Arial", "Roboto", "Helvetica"]
    )
    tone_of_voice: str = "professional, trustworthy, high-converting"
    prohibited_words: List[str] = Field(
        default_factory=lambda: ["scam", "cheap", "guarantee 100%", "hack", "miracle", "foolproof", "free money"]
    )
    max_copy_length_delta_percent: float = 50.0


class DOMElement(BaseModel):
    tag: str
    element_id: Optional[str] = None
    classes: List[str] = Field(default_factory=list)
    selector: str
    inner_text: str = ""
    inner_html: str = ""
    attributes: Dict[str, str] = Field(default_factory=dict)


class PricingPlan(BaseModel):
    plan_name: str
    price_amount_cents: int  # e.g. 4900 = $49.00
    currency: str = "usd"
    interval: str = "month"  # "month", "year"
    stripe_price_id: Optional[str] = None


class OnboardingSchemaDef(BaseModel):
    step_id: str
    required_fields: List[str] = Field(default_factory=list)
    optional_fields: List[str] = Field(default_factory=list)
    relaxed_fields: List[str] = Field(default_factory=list)
    synthetic_backfills: Dict[str, Any] = Field(default_factory=dict)


class Variant(BaseModel):
    variant_id: str
    opaque_id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12])
    experiment_id: str
    tenant_id: str
    name: str
    variant_type: VariantType
    generation_mode: GenerationMode = GenerationMode.FOUNDER_DIRECTED
    hypothesis: str
    
    copy_payload: Optional[Dict[str, Any]] = None
    style_payload: Optional[Dict[str, Any]] = None
    component_payload: Optional[Dict[str, Any]] = None
    pricing_payload: Optional[PricingPlan] = None
    onboarding_payload: Optional[OnboardingSchemaDef] = None
    
    is_control: bool = False
    status: VariantStatus = VariantStatus.DRAFT
    created_at: float = Field(default_factory=time.time)


class Experiment(BaseModel):
    experiment_id: str
    tenant_id: str = ""
    title: str
    experiment_type: ExperimentType = ExperimentType.COPY_UI
    generation_mode: GenerationMode = GenerationMode.FOUNDER_DIRECTED
    url: str
    target_selector: str
    target_element: Optional[DOMElement] = None
    brand_guidelines: BrandGuidelines = Field(default_factory=BrandGuidelines)
    goal_event: str = "CONVERSION"
    is_active: bool = True
    exploration_floor: float = 0.10
    created_at: float = Field(default_factory=time.time)


class GuardrailAuditRecord(BaseModel):
    audit_id: str = Field(default_factory=lambda: f"audit_{uuid.uuid4().hex[:8]}")
    variant_id: str
    experiment_id: str
    tenant_id: str
    check_name: str
    passed: bool
    severity: CheckSeverity
    rule_fired: str
    message: str
    details: Dict[str, Any] = Field(default_factory=dict)
    timestamp: float = Field(default_factory=time.time)
    overridden_by_founder: bool = False
    override_reason: Optional[str] = None


class ValidationReport(BaseModel):
    variant_id: str
    is_safe: bool
    score: float = 1.0
    audit_records: List[GuardrailAuditRecord] = Field(default_factory=list)
    blocked_reasons: List[str] = Field(default_factory=list)
    timestamp: float = Field(default_factory=time.time)


class AssignmentTokenPayload(BaseModel):
    token_id: str = Field(default_factory=lambda: f"tok_{uuid.uuid4().hex}")
    tenant_id: str
    experiment_id: str
    session_id: str
    visitor_id: str
    opaque_variant_id: str
    variant_type: VariantType
    issued_at: float = Field(default_factory=time.time)
    expires_at: float
    is_reassigned: bool = False
    reassignment_reason: Optional[str] = None
    commit_locked: bool = False
    commit_type: Optional[str] = None


class SignedTokenResponse(BaseModel):
    signed_token: str
    opaque_variant_id: str
    experiment_id: str
    is_control: bool
    payload: Dict[str, Any]
    client_action: str = "APPLY_DOM_PATCH"
    expires_at: float


class TelemetryEventDTO(BaseModel):
    event_id: str = Field(default_factory=lambda: f"evt_{uuid.uuid4().hex}")
    event_type: EventType
    tenant_id: str
    experiment_id: str
    opaque_variant_id: str
    visitor_id: str
    session_id: Optional[str] = None
    signed_token: Optional[str] = None
    timestamp: float = Field(default_factory=time.time)
    reward_value: float = 1.0
    metadata: Dict[str, Any] = Field(default_factory=dict)


class TelemetryBatchRequest(BaseModel):
    tenant_id: str
    events: List[TelemetryEventDTO]


class ArmStatistics(BaseModel):
    variant_id: str
    opaque_id: str
    variant_name: str
    variant_type: VariantType
    is_control: bool = False
    impressions: int = 0
    conversions: int = 0
    conversion_rate: float = 0.0
    alpha: float = 1.0
    beta_param: float = 1.0
    win_probability: float = 0.0
    expected_reward: float = 0.0
    is_leading: bool = False


class MABAnalyticsReport(BaseModel):
    experiment_id: str
    tenant_id: str
    total_impressions: int = 0
    total_conversions: int = 0
    overall_conversion_rate: float = 0.0
    exploration_floor: float = 0.10
    has_sufficient_data: bool = False
    status_message: str = "Collecting baseline traffic..."
    arms: List[ArmStatistics] = Field(default_factory=list)
    leading_variant_id: Optional[str] = None
    leading_variant_name: Optional[str] = None
    confidence_level: float = 0.0
    estimated_cumulative_regret: float = 0.0


class AnomalyProposal(BaseModel):
    proposal_id: str = Field(default_factory=lambda: f"prop_{uuid.uuid4().hex[:8]}")
    tenant_id: str
    experiment_id: Optional[str] = None
    metric_name: str
    detected_at: float = Field(default_factory=time.time)
    baseline_conversion_rate: float
    observed_conversion_rate: float
    relative_drop_pct: float
    confounders_checked: Dict[str, Any] = Field(
        default_factory=lambda: {
            "traffic_source_shift": "Checked (Stable organic/paid mix)",
            "day_of_week_seasonality": "Checked (Adjusted for weekend slump)",
            "ad_campaign_changes": "Checked (No new active budget shifts)"
        }
    )
    hypothesis: str
    reasoning_trace: str
    proposed_variant: Variant
    status: AnomalyProposalStatus = AnomalyProposalStatus.PROPOSED
    reviewed_at: Optional[float] = None
    reviewed_by: Optional[str] = None


# --- Self-Serve Onboarding & Stripe DTOs ---

class CreateCheckoutSessionReq(BaseModel):
    plan_id: str = "price_growth_99"  # "price_starter_49", "price_growth_99", "price_scale_199"
    customer_email: Optional[str] = None
    customer_name: Optional[str] = "Startup Founder"
    success_url: Optional[str] = None
    cancel_url: Optional[str] = None


class OnboardingSetupReq(BaseModel):
    website_url: str
    target_selector: str = "#primary-cta"
    target_element_text: Optional[str] = "Get Started Free"
    optimization_goal: Optional[str] = "Increase landing page trial conversions"
    brand_primary_color: Optional[str] = "#2563eb"
    brand_accent_color: Optional[str] = "#f59e0b"
    stripe_restricted_key: Optional[str] = None


class OnboardingSetupResponse(BaseModel):
    status: str = "success"
    tenant_id: str
    publishable_key: str
    secret_api_key: str
    experiment_id: str
    variants_generated: int
    variants_approved: int
    script_tag_html: str
    client_api_base: str
    dashboard_url: str

class PricingPlanInput(BaseModel):
    plan_name: str
    price_dollars: float = 49.0
    interval: str = "month"

# --- Behavioral Rescue & Pricing Disclosure Schemas ---

class BehavioralRescueConfig(BaseModel):
    enabled: bool = True
    dwell_threshold_seconds: float = 8.0
    scroll_past_count: int = 2
    exit_intent_enabled: bool = True
    promo_code: str = "FOUNDER20"
    discount_percent: int = 20
    rescue_price_amount_cents: int = 4900
    modal_headline: str = "Special Founder's Welcome Offer"
    modal_body: str = "We noticed you exploring our plans. Claim an exclusive 20% discount on your first 3 months."
    transparent_disclosure: bool = True
    disclosure_statement: str = "Promotional offer unlocked for first-time visitors during this session."


class PricingDisclosureAuditRecord(BaseModel):
    disclosure_id: str = Field(default_factory=lambda: f"disc_{uuid.uuid4().hex[:8]}")
    tenant_id: str
    experiment_id: str
    session_id: str
    visitor_id: str
    original_price_cents: int
    offered_price_cents: int
    discount_percent: int
    promo_code_applied: str
    trigger_reason: str
    timestamp: float = Field(default_factory=time.time)
    compliance_standard: str = "FTC_EU_OMNIBUS_COMPLIANT"


# --- Dimension Analytics & Combinatorial Synthesis DTOs ---

class DimensionSummary(BaseModel):
    dimension_name: str
    total_arms: int = 0
    total_impressions: int = 0
    total_conversions: int = 0
    blended_cvr: float = 0.0
    best_arm_id: Optional[str] = None
    best_arm_name: Optional[str] = None
    best_arm_cvr: float = 0.0
    lift_over_control_pct: float = 0.0


class DimensionAnalyticsResponse(BaseModel):
    experiment_id: str
    tenant_id: str
    control_cvr: float = 0.0
    active_dimension_filter: str = "ALL"
    dimensions: Dict[str, DimensionSummary] = Field(default_factory=dict)
    filtered_arms: List[ArmStatistics] = Field(default_factory=list)


class SynthesizeCombinationsReq(BaseModel):
    experiment_id: str
    copy_variant_ids: List[str] = Field(default_factory=list)
    style_variant_ids: List[str] = Field(default_factory=list)
    component_variant_ids: List[str] = Field(default_factory=list)
    pricing_variant_ids: List[str] = Field(default_factory=list)
    auto_top_performers: bool = False  # If True, automatically combines the #1 Copy + #1 Style + #1 Component + #1 Pricing


class CombinationSynthesisResponse(BaseModel):
    status: str = "success"
    experiment_id: str
    total_combinations_created: int
    composite_variants: List[Variant]
    registered_mab_arms: int


class AssignVariantReq(BaseModel):
    visitor_id: str
    session_id: Optional[str] = None
    device_type: Optional[str] = "desktop"
    viewport_width: Optional[int] = None
    viewport_height: Optional[int] = None
    referrer: Optional[str] = None


class OverrideAuditReq(BaseModel):
    override_approve: bool = True
    reason: str = "Founder verified safe manually"


class CreatePricingTestReq(BaseModel):
    experiment_id: str
    title: str
    url: Optional[str] = None
    target_selector: Optional[str] = None
    plans: List[PricingPlanInput]


class PricingTestResponse(BaseModel):
    status: str = "success"
    experiment_id: str
    variants_created: int
    plans: List[Variant]


TelemetryBatchReq = TelemetryBatchRequest
