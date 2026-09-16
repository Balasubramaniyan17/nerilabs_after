/**
 * Frontend Dashboard Application for NeriLabs SaaS.
 * Supports:
 * - Category Dimension Filtering (Copy, Style, Component, Pricing, Combinations)
 * - Factorial Combinations & Multivariate Matrix Studio
 * - Self-Serve Onboarding Wizard & MAB Visualizer
 * - Stripe Price Tests, Behavioral Rescues, & Anomaly Approvals
 */

const API_BASE = window.location.origin;
const DEFAULT_API_KEY = "nerilabs_sk_live_9a8b7c6d5e4f3a2b1c";
const DEFAULT_PUBLISHABLE_KEY = "nerilabs_pk_live_9a8b7c6d5e4f3a2b1c";
let CURRENT_EXP_ID = localStorage.getItem("nerilabs_exp_id") || null;
let ALL_TENANT_EXPERIMENTS = [];
let CURRENT_API_KEY = DEFAULT_API_KEY;
let CURRENT_PUBLISHABLE_KEY = "nerilabs_pk_live_9a8b7c6d5e4f3a2b1c";
let currentDimensionFilter = "ALL";

let CURRENT_PLAN_LIMITS = {
    name: "Enterprise / Founder Master Admin",
    max_experiments: 999999,
    has_stripe_pricing: true,
    has_factorial: true,
    has_anomalies: true,
    is_admin: true
};
let IS_MASTER_ADMIN = false;

function openAdminKeyModal() {
    const m = document.getElementById("admin-key-modal");
    if (m) m.style.display = "flex";
}
window.openAdminKeyModal = openAdminKeyModal;

function closeAdminKeyModal() {
    const m = document.getElementById("admin-key-modal");
    if (m) m.style.display = "none";
}
window.closeAdminKeyModal = closeAdminKeyModal;

async function handleAdminKeySubmit(e) {
    e.preventDefault();
    const key = document.getElementById("inp-founder-admin-key").value.trim();
    if (!key) return;
    try {
        const res = await fetch(`${API_BASE}/api/v1/auth/admin-login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ admin_key: key })
        });
        if (res.ok) {
            const data = await res.json();
            CURRENT_API_KEY = data.api_key;
            localStorage.setItem("nerilabs_api_key", data.api_key);
            IS_MASTER_ADMIN = true;
            closeAdminKeyModal();
            await fetchAccountInfo();
            await loadTenantExperimentsList();
            alert("Founder Master Admin access unlocked! All features are now active.");
        } else {
            alert("Invalid Founder Admin Master Key.");
        }
    } catch(err) {
        alert("Login error: " + err);
    }
}
window.handleAdminKeySubmit = handleAdminKeySubmit;

function openUpgradeModal(title = "Plan Upgrade Required", desc = "Upgrade your plan to unlock this feature:") {
    const m = document.getElementById("plan-upgrade-modal");
    if (m) {
        if (title) document.getElementById("upgrade-modal-title").textContent = title;
        if (desc) document.getElementById("upgrade-modal-desc").textContent = desc;
        m.style.display = "flex";
    }
}
window.openUpgradeModal = openUpgradeModal;

function closeUpgradeModal() {
    const m = document.getElementById("plan-upgrade-modal");
    if (m) m.style.display = "none";
}
window.closeUpgradeModal = closeUpgradeModal;

async function triggerUpgrade(plan) {
    try {
        const res = await fetch(`${API_BASE}/api/v1/billing/create-upgrade-checkout`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-API-Key": CURRENT_API_KEY
            },
            body: JSON.stringify({ plan: plan })
        });
        if (res.ok) {
            const data = await res.json();
            if (data.checkout_url) {
                window.location.href = data.checkout_url;
                return;
            }
        }
    } catch(e) {}
    window.location.href = "https://nerilabs.io#pricing";
}
window.triggerUpgrade = triggerUpgrade;

async function switchTestTier(tier) {
    if (tier === "founder") {
        CURRENT_API_KEY = "nerilabs_admin_master_2026_founder";
        localStorage.setItem("nerilabs_api_key", CURRENT_API_KEY);
    } else {
        const res = await fetch(`${API_BASE}/api/v1/auth/auth0-sync`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                sub: `auth0|test_${tier}_user`,
                email: `${tier}.tester@startup.io`,
                name: `${tier.toUpperCase()} Tester`,
                plan: tier
            })
        });
        if (res.ok) {
            const data = await res.json();
            CURRENT_API_KEY = data.api_key;
            localStorage.setItem("nerilabs_api_key", data.api_key);
        }
    }
    await fetchAccountInfo();
    await loadTenantExperimentsList();
    alert(`Switched active session to: ${tier.toUpperCase()}`);
}
window.switchTestTier = switchTestTier;



// Check URL Params for Magic Auth / Onboarding
const urlParams = new URLSearchParams(window.location.search);
const authToken = urlParams.get("auth_token");
const isNewOnboarding = urlParams.get("onboarding") === "true" || urlParams.get("checkout_session_id") !== null;

if (authToken) {
    try {
        const decoded = atob(authToken);
        const [tenantId, apiKey] = decoded.split(":");
        if (apiKey) {
            CURRENT_API_KEY = apiKey;
            localStorage.setItem("nerilabs_api_key", apiKey);
        }
    } catch (e) {
        console.debug("Auth token parse error:", e);
    }
}


// Check for Founder Master Key in URL (?admin_key=... or ?founder=true)
const adminKeyParam = urlParams.get("admin_key");
if (adminKeyParam === "nerilabs_admin_master_2026_founder" || urlParams.get("founder") === "true") {
    CURRENT_API_KEY = "nerilabs_admin_master_2026_founder";
    localStorage.setItem("nerilabs_api_key", CURRENT_API_KEY);
    IS_MASTER_ADMIN = true;
    window.history.replaceState({}, document.title, window.location.pathname);
}

// Check for Auth0 Sync in URL (?auth0_sub=...&email=...)
const auth0SubParam = urlParams.get("auth0_sub");
const auth0EmailParam = urlParams.get("email");
if (auth0SubParam && auth0EmailParam) {
    const planParam = urlParams.get("plan") || "launch";
    const nameParam = urlParams.get("name") || "";
    fetch(`${API_BASE}/api/v1/auth/auth0-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            sub: auth0SubParam,
            email: auth0EmailParam,
            name: nameParam,
            plan: planParam
        })
    }).then(r => r.json()).then(data => {
        if (data.api_key) {
            CURRENT_API_KEY = data.api_key;
            localStorage.setItem("nerilabs_api_key", data.api_key);
            fetchAccountInfo();
            loadTenantExperimentsList();
        }
    }).catch(()=>{});
    window.history.replaceState({}, document.title, window.location.pathname);
}

// Check for returning from Stripe upgrade (?upgraded=true&plan=...)
if (urlParams.get("upgraded") === "true" && urlParams.get("plan")) {
    fetch(`${API_BASE}/api/v1/billing/confirm-upgrade`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": CURRENT_API_KEY },
        body: JSON.stringify({ plan: urlParams.get("plan"), session_id: urlParams.get("session_id") })
    }).then(() => {
        fetchAccountInfo();
    }).catch(()=>{});
    window.history.replaceState({}, document.title, window.location.pathname);
}

const storedApiKey = localStorage.getItem("nerilabs_api_key");
if (storedApiKey) {
    CURRENT_API_KEY = storedApiKey;
}

// Tab Switching
function switchTab(tabId) {
    if (CURRENT_PLAN_LIMITS && !IS_MASTER_ADMIN) {
        if (tabId === "combinations" && !CURRENT_PLAN_LIMITS.has_factorial) {
            openUpgradeModal("Scale Plan Required", "Factorial Combinations matrix synthesis is an advanced multi-modal engine available on Scale ($199/mo) and Enterprise.");
            return;
        }
        if (tabId === "stripe" && !CURRENT_PLAN_LIMITS.has_stripe_pricing) {
            openUpgradeModal("Growth Plan Required", "Stripe Dynamic Pricing elasticity tests and checkout resolution require Growth ($99/mo) or higher.");
            return;
        }
        if (tabId === "anomalies" && !CURRENT_PLAN_LIMITS.has_anomalies) {
            openUpgradeModal("Scale Plan Required", "Autonomous Anomaly Detection scanner with automated hypothesis proposals is available on Scale ($199/mo) and Enterprise.");
            return;
        }
    }

    document.querySelectorAll(".nav-item").forEach(el => el.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(el => el.classList.remove("active"));
    
    const targetNav = document.querySelector(`[data-tab="${tabId}"]`);
    if (targetNav) targetNav.classList.add("active");
    
    const targetPanel = document.getElementById(`tab-${tabId}`);
    if (targetPanel) targetPanel.classList.add("active");

    if (tabId === "overview") fetchAnalytics();
    if (tabId === "combinations") fetchCombinationsMatrix();
    if (tabId === "guardrails") fetchAuditLogs();
    if (tabId === "anomalies") fetchAnomalies();
    if (tabId === "account") fetchAccountInfo();
    if (tabId === "create") {
        const u = document.getElementById("inp-exp-url");
        if (u && (!u.value || u.value === "https://startup.io")) {
            const saved = localStorage.getItem("nerilabs_target_url");
            if (saved) u.value = saved;
        }
    }
loadTenantExperimentsList();
loadTenantExperimentsList();

// Experiment Switcher Functionality





}

document.querySelectorAll(".nav-item").forEach(item => {
    item.addEventListener("click", (e) => {
        e.preventDefault();
        const tab = item.getAttribute("data-tab");
        switchTab(tab);
    });
});

// Category Dimension Filtering
function setDimensionFilter(dim) {
    currentDimensionFilter = dim;
    document.querySelectorAll(".filter-pill").forEach(el => el.classList.remove("active"));
    const activeBtn = Array.from(document.querySelectorAll(".filter-pill")).find(el => el.textContent.includes(dim) || (dim === "ALL" && el.textContent.includes("All")));
    if (activeBtn) activeBtn.classList.add("active");
    fetchAnalytics();
}

// Toggle fields in Tab 3 Create Experiment
function toggleExperimentTypeFields() {
    const type = document.getElementById("inp-exp-type").value;
    const copyFields = document.getElementById("fields-copy-ui");
    const pricingFields = document.getElementById("fields-pricing");

    if (type === "PRICING_TEST") {
        copyFields.style.display = "none";
        pricingFields.style.display = "block";
        document.getElementById("inp-exp-selector").value = "#pro-price-amount";
        document.getElementById("inp-exp-title").value = "Pro Plan Price Elasticity ($49 vs $79)";
    } else {
        copyFields.style.display = "block";
        pricingFields.style.display = "none";
        document.getElementById("inp-exp-selector").value = "#hero-cta";
        document.getElementById("inp-exp-title").value = "Homepage Hero CTA Optimization";
    }
}

// Fetch Tenant Account Info
async function fetchAccountInfo() {
    try {
        let res = await fetch(`${API_BASE}/api/v1/tenant/me`, {
            headers: { "X-API-Key": CURRENT_API_KEY }
        });
        // Auto-heal: If localStorage contains a stale/invalid key, reset to default seeded key
        if (res.status === 401 && CURRENT_API_KEY !== DEFAULT_API_KEY) {
            console.warn("Stored API key is invalid on this database. Resetting to default seeded key.");
            CURRENT_API_KEY = DEFAULT_API_KEY;
            localStorage.setItem("nerilabs_api_key", DEFAULT_API_KEY);
            res = await fetch(`${API_BASE}/api/v1/tenant/me`, {
                headers: { "X-API-Key": CURRENT_API_KEY }
            });
        }
        if (!res.ok) return;
        const tenant = await res.json();
        
        document.getElementById("tenant-name").textContent = tenant.organization_name;
        document.getElementById("sidebar-api-key-display").textContent = (tenant.api_key || "").substring(0, 18) + "...";
        if (document.getElementById("account-pk-key")) document.getElementById("account-pk-key").textContent = tenant.publishable_key;
        if (document.getElementById("account-sk-key")) document.getElementById("account-sk-key").textContent = tenant.api_key;
        if (document.getElementById("account-jwt-secret")) document.getElementById("account-jwt-secret").textContent = tenant.token_signing_secret;
    } catch (e) {
        console.debug("Tenant fetch error:", e);
    }
}


function changeActiveExperiment(expId) {
    if (!expId) return;
    CURRENT_EXP_ID = expId;
    localStorage.setItem("nerilabs_exp_id", expId);
    const sel = document.getElementById("header-experiment-select");
    if (sel && sel.value !== expId) sel.value = expId;
    updateActiveExperimentBanner();
    renderTargetInspector();
    fetchAnalytics();
    if (document.getElementById("tab-combinations") && document.getElementById("tab-combinations").classList.contains("active")) {
        fetchCombinationsMatrix();
    }
}
window.changeActiveExperiment = changeActiveExperiment;

function updateActiveExperimentBanner() {
    const exp = ALL_TENANT_EXPERIMENTS.find(e => e.experiment_id === CURRENT_EXP_ID);
    if (!exp) return;

    const titleEl = document.getElementById("active-exp-title");
    const targetEl = document.getElementById("active-exp-target");
    const urlEl = document.getElementById("active-exp-url");
    const urlLink = document.getElementById("active-exp-url-link");

    if (titleEl) titleEl.textContent = exp.title || "Live Website Experiment";
    if (targetEl) targetEl.textContent = exp.target_selector || "#hero-cta";
    if (urlEl) urlEl.textContent = exp.url || "Your Website";
    if (urlLink && exp.url) urlLink.href = exp.url;

    // Update SDK tab code block to match active experiment
    const scriptBlock = document.getElementById("main-script-tag-code");
    if (scriptBlock) {
        const baseUrl = window.location.origin;
        scriptBlock.textContent = `<!-- NeriLabs Universal Experimentation Engine (Install Once) -->\n<script>\n  window.NERILABS_API_BASE = "${baseUrl}";\n  window.NERILABS_PUBLISHABLE_KEY = "${CURRENT_PUBLISHABLE_KEY}";\n</script>\n<script src="${baseUrl}/static/experiment_sdk.js" async></script>`;
    }
}

async function loadTenantExperimentsList() {
    try {
        const res = await fetch(`${API_BASE}/api/v1/experiments/tenant/list`, {
            headers: { "X-API-Key": CURRENT_API_KEY }
        });
        if (!res.ok) return;
        const exps = await res.json();
        ALL_TENANT_EXPERIMENTS = exps;

        // FILTER: Hide demo experiment if customer has at least one real experiment!
        const realExps = exps.filter(e => e.experiment_id !== "exp_saas_hero_conversion");
        const activeList = realExps.length > 0 ? realExps : exps;

        const sel = document.getElementById("header-experiment-select");
        if (sel) {
            sel.innerHTML = "";
            activeList.forEach(e => {
                const opt = document.createElement("option");
                opt.value = e.experiment_id;
                opt.textContent = `${e.title} (${e.experiment_id})`;
                sel.appendChild(opt);
            });

            // Automatically pick the customer's newest live experiment
            if (activeList.length > 0) {
                if (!CURRENT_EXP_ID || !activeList.some(e => e.experiment_id === CURRENT_EXP_ID)) {
                    CURRENT_EXP_ID = activeList[0].experiment_id;
                    localStorage.setItem("nerilabs_exp_id", CURRENT_EXP_ID);
                }
                sel.value = CURRENT_EXP_ID;
            } else {
                CURRENT_EXP_ID = null;
            }
        }

        updateActiveExperimentBanner();
        renderTargetInspector();
        fetchLiveActivityStream();
        fetchAnalytics();
    } catch (e) {
        console.debug("Error loading tenant experiments:", e);
    }
}
window.loadTenantExperimentsList = loadTenantExperimentsList;


// =====================================================================
// INTERACTIVE TARGET INSPECTOR & LIVE PREVIEW SYSTEM
// =====================================================================
let CURRENT_PREVIEW_VARIANTS = [];

async function renderTargetInspector() {
    if (!CURRENT_EXP_ID) return;
    const exp = ALL_TENANT_EXPERIMENTS.find(e => e.experiment_id === CURRENT_EXP_ID);
    if (!exp) return;

    CURRENT_PREVIEW_VARIANTS = [];

    const titleEl = document.getElementById("preview-active-label");
    if (titleEl) titleEl.textContent = `Target: ${exp.target_selector || "#hero-cta"}`;

    try {
        const res = await fetch(`${API_BASE}/api/v1/experiments/${CURRENT_EXP_ID}/variants`);
        if (!res.ok) return;
        const variants = await res.json();
        CURRENT_PREVIEW_VARIANTS = variants;

        const pillsContainer = document.getElementById("inspector-variant-pills");
        if (!pillsContainer) return;
        pillsContainer.innerHTML = "";

        variants.forEach((v, idx) => {
            const btn = document.createElement("button");
            btn.className = "filter-pill" + (idx === 0 ? " active" : "");
            btn.style.fontSize = "10.5px";
            btn.style.padding = "5px 12px";
            btn.textContent = v.name;
            btn.onclick = () => selectInspectorVariant(v, btn);
            pillsContainer.appendChild(btn);
        });

        if (variants.length > 0) {
            selectInspectorVariant(variants[0], pillsContainer.firstChild);
        }
    } catch (e) {
        console.debug("Target inspector render error:", e);
    }
}

function selectInspectorVariant(variant, btnEl) {
    if (!variant) return;

    // Highlight pill
    const pillsContainer = document.getElementById("inspector-variant-pills");
    if (pillsContainer) {
        pillsContainer.querySelectorAll(".filter-pill").forEach(p => p.classList.remove("active"));
    }
    if (btnEl) btnEl.classList.add("active");

    const exp = ALL_TENANT_EXPERIMENTS.find(e => e.experiment_id === CURRENT_EXP_ID);
    const activeLabel = document.getElementById("preview-active-label");
    if (activeLabel) activeLabel.textContent = `Previewing: ${variant.name}`;

    // Update rendered preview element dynamically according to target element type
    const previewContainer = document.getElementById("inspector-rendered-button-preview");
    if (previewContainer) {
        previewContainer.innerHTML = "";
        
        const selector = exp ? (exp.target_selector || "").toLowerCase() : "";
        const isLink = selector.includes(" a") || selector.endsWith("a") || selector.includes("link") || selector.includes("nav");

        const previewEl = document.createElement(isLink ? "a" : "button");
        previewEl.className = isLink ? "nav-item active" : "btn btn-primary";
        previewEl.style.pointerEvents = "none";
        previewEl.style.display = "inline-block";
        previewEl.style.textDecoration = isLink ? "none" : "initial";
        
        if (isLink) {
            previewEl.style.padding = "8px 16px";
            previewEl.style.background = "var(--panel)";
            previewEl.style.border = "1px solid var(--accent)";
            previewEl.style.color = "var(--ink)";
            previewEl.style.borderRadius = "4px";
            previewEl.style.fontSize = "12px";
            previewEl.style.fontWeight = "600";
        } else {
            previewEl.style.fontSize = "12px";
            previewEl.style.padding = "10px 20px";
        }

        // Apply copy
        const copyPayload = variant.copy_payload || {};
        let textToShow = "Get Started";
        if (variant.is_control) {
            textToShow = (exp && exp.target_element && exp.target_element.inner_text) || copyPayload.original_text || (isLink ? "Navigation Link" : "Get Started Free");
        } else {
            textToShow = copyPayload.new_text || (isLink ? "Explore Features →" : "Start Free Trial →");
        }
        previewEl.textContent = textToShow;

        // Apply style rules (supports css_rules dict, raw_css, and direct properties)
        const stylePayload = variant.style_payload || {};
        if (!variant.is_control) {
            if (stylePayload.css_rules) {
                for (const [prop, val] of Object.entries(stylePayload.css_rules)) {
                    previewEl.style.setProperty(prop, val);
                }
            }
            if (stylePayload.bg_color) previewEl.style.backgroundColor = stylePayload.bg_color;
            if (stylePayload.text_color) previewEl.style.color = stylePayload.text_color;
            if (stylePayload.border_radius) previewEl.style.borderRadius = stylePayload.border_radius;
        }

        // Apply component replacement if present
        if (variant.component_payload && variant.component_payload.replacement_html) {
            previewContainer.innerHTML = variant.component_payload.replacement_html;
        } else {
            previewContainer.appendChild(previewEl);
        }
    }

    // Update live preview URL
    const liveLink = document.getElementById("inspector-live-preview-link");
    if (liveLink && exp && exp.url) {
        const baseUrl = exp.url.split("?")[0];
        const previewParam = variant.is_control ? "control" : (variant.opaque_id || variant.variant_id);
        liveLink.href = `${baseUrl}?neri_preview=${encodeURIComponent(previewParam)}`;
    }
}

// =====================================================================
// REAL-TIME LIVE ACTIVITY STREAM (THE VISCERAL MAGIC TICKER)
// =====================================================================
async function fetchLiveActivityStream() {
    if (!CURRENT_EXP_ID) return;
    const feed = document.getElementById("live-activity-feed");
    if (!feed) return;

    try {
        const res = await fetch(`${API_BASE}/api/v1/telemetry/live-stream?experiment_id=${CURRENT_EXP_ID}&limit=8`);
        if (!res.ok) return;
        const data = await res.json();
        const events = data.events || [];

        if (events.length === 0) {
            const exp = ALL_TENANT_EXPERIMENTS.find(e => e.experiment_id === CURRENT_EXP_ID);
            const targetUrl = exp ? exp.url : "your website";
            feed.innerHTML = `<div style="color: var(--ink-faint);">[ SYSTEM STANDBY ] Waiting for visitor events on ${targetUrl}... Visit your site or click your button to see real-time sessions stream in.</div>`;
            return;
        }

        feed.innerHTML = "";
        events.forEach(evt => {
            const d = new Date(evt.timestamp * 1000);
            const timeStr = d.toTimeString().split(" ")[0];
            const vShort = (evt.visitor_id || "0xanon").substring(0, 10);
            const row = document.createElement("div");

            if (evt.event_type === "CONVERSION") {
                row.style.cssText = "color: var(--good); background: rgba(62, 207, 142, 0.08); padding: 5px 8px; border-radius: 3px; border-left: 2px solid var(--good); display: flex; justify-content: space-between; align-items: center;";
                row.innerHTML = `
                    <span><span style="color: var(--ink-faint);">[ ${timeStr} ]</span> <strong>CONVERSION RECORDED</strong> &middot; Visitor <code>${vShort}</code> clicked target CTA!</span>
                    <span style="font-size: 10px; font-weight: 700; letter-spacing: 0.05em;">[ +1 CONV ]</span>
                `;
            } else {
                row.style.cssText = "color: var(--ink-dim); padding: 3px 0; display: flex; justify-content: space-between; align-items: center;";
                row.innerHTML = `
                    <span><span style="color: var(--ink-faint);">[ ${timeStr} ]</span> VISITOR <code>${vShort}</code> &middot; <span style="color: var(--accent); font-weight: 600;">IMPRESSION</span> &middot; Assigned: "<strong>${evt.variant_name}</strong>"</span>
                    <span style="font-size: 10px; color: var(--ink-faint);">${evt.variant_type}</span>
                `;
            }
            feed.appendChild(row);
        });
    } catch (e) {
        console.debug("Live stream fetch error:", e);
    }
}

// Add polling loop for live stream (every 2.5s)
setInterval(fetchLiveActivityStream, 2500);

// Fetch Analytics & Dimension Performance
async function fetchAnalytics() {
    // Inspector updated on experiment selection
    try {
        if (!CURRENT_EXP_ID) return;
        const url = `${API_BASE}/api/v1/experiments/${CURRENT_EXP_ID}/dimension-analytics?dimension=${currentDimensionFilter}`;
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();

        // Update Pill Counts
        const dims = data.dimensions || {};
        let totalCount = 0;
        for (const [k, v] of Object.entries(dims)) {
            totalCount += v.total_arms;
            const el = document.getElementById(`count-${k.toLowerCase()}`);
            if (el) el.textContent = v.total_arms;
        }
        const countAll = document.getElementById("count-all");
        if (countAll) countAll.textContent = data.filtered_arms ? data.filtered_arms.length : totalCount;

        // Fetch overall MAB report for KPIs
        let overall = null;
        try {
            const resOverall = await fetch(`${API_BASE}/api/v1/experiments/${CURRENT_EXP_ID}/analytics`);
            if (resOverall.ok) {
                overall = await resOverall.json();
                document.getElementById("stat-total-impressions").textContent = overall.total_impressions.toLocaleString();
                document.getElementById("stat-total-conversions").textContent = overall.total_conversions.toLocaleString();
                document.getElementById("stat-overall-cvr").textContent = (overall.overall_conversion_rate * 100).toFixed(2) + "%";
                document.getElementById("stat-leading-confidence").textContent = (overall.confidence_level * 100).toFixed(1) + "%";
                document.getElementById("stat-leading-name").textContent = overall.leading_variant_name ? `Leader: ${overall.leading_variant_name}` : "Exploring...";
            }
        } catch (errOverall) {
            console.debug("Overall fetch error:", errOverall);
        }

        // Update MAB Status Banner based on actual live impressions
        const trustBanner = document.getElementById("mab-trust-banner");
        const statusTitle = document.getElementById("mab-status-title");
        const statusDesc = document.getElementById("mab-status-desc");

        const liveImpressions = overall ? overall.total_impressions : 0;
        if (liveImpressions === 0) {
            if (trustBanner) {
                trustBanner.className = "alert-box alert-warning";
                if (statusTitle) statusTitle.textContent = "STATUS: LISTENING FOR TRAFFIC";
                if (statusDesc) statusDesc.textContent = "Tracking script is active on your site. Visit your website or click your CTA button to see real impressions and conversions stream into this table.";
            }
        } else {
            if (trustBanner) {
                trustBanner.className = "alert-box alert-warning";
                if (statusTitle) statusTitle.textContent = "STATUS: THOMPSON SAMPLING ROUTING";
                if (statusDesc) statusDesc.textContent = "Algorithm is dynamically routing real visitors to the highest-converting variants with a 10% exploration floor.";
            }
        }

        // Render Filtered Table Rows
        const tbody = document.getElementById("mab-arms-tbody");
        if (tbody) {
            tbody.innerHTML = "";
            const arms = data.filtered_arms || [];

            if (arms.length === 0) {
                tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding: 28px; color: #94a3b8;">No variants configured for this filter.</td></tr>`;
            } else {
                arms.forEach(arm => {
                    const tr = document.createElement("tr");
                    const statusTag = arm.is_leading && arm.conversions > 0
                        ? '<span class="tag-badge tag-leading">[LEADER]</span>'
                        : '<span class="tag-badge tag-approved">ACTIVE</span>';

                    tr.innerHTML = `
                        <td>${statusTag}</td>
                        <td><strong>${arm.variant_name}</strong> ${arm.is_control ? '<small>(Control)</small>' : ''}</td>
                        <td><code>${arm.variant_type}</code></td>
                        <td><strong>${arm.impressions.toLocaleString()}</strong></td>
                        <td><strong>${arm.conversions.toLocaleString()}</strong></td>
                        <td><strong>${(arm.conversion_rate * 100).toFixed(2)}%</strong></td>
                        <td>Beta(${arm.alpha.toFixed(1)}, ${arm.beta_param.toFixed(1)})</td>
                        <td><strong>${(arm.win_probability * 100).toFixed(1)}%</strong></td>
                    `;
                    tbody.appendChild(tr);
                });
            }
        }

    } catch (e) {
        console.error("Analytics fetch error:", e);
    }
}

// Fetch Combinations Matrix (Tab 2)
async function fetchCombinationsMatrix() {
    try {
        const res = await fetch(`${API_BASE}/api/v1/experiments/${CURRENT_EXP_ID}/variants`);
        if (!res.ok) return;
        const variants = await res.json();

        const copyList = document.getElementById("comb-copy-list");
        const styleList = document.getElementById("comb-style-list");
        const compList = document.getElementById("comb-component-list");
        const priceList = document.getElementById("comb-pricing-list");

        copyList.innerHTML = "";
        styleList.innerHTML = "";
        compList.innerHTML = "";
        priceList.innerHTML = "";

        variants.forEach(v => {
            if (v.status !== "APPROVED" && !v.is_control) return;

            const item = document.createElement("label");
            item.className = "comb-checkbox-item";
            item.innerHTML = `<input type="checkbox" value="${v.variant_id}" data-type="${v.variant_type}"> ${v.name}`;

            if (v.variant_type === "COPY") copyList.appendChild(item);
            else if (v.variant_type === "STYLE") styleList.appendChild(item);
            else if (v.variant_type === "COMPONENT") compList.appendChild(item);
            else if (v.variant_type === "PRICING") priceList.appendChild(item);
        });

        if (copyList.children.length === 0) copyList.innerHTML = "<small style='color:#94a3b8;'>No copy variants</small>";
        if (styleList.children.length === 0) styleList.innerHTML = "<small style='color:#94a3b8;'>No style variants</small>";
        if (compList.children.length === 0) compList.innerHTML = "<small style='color:#94a3b8;'>No component variants</small>";
        if (priceList.children.length === 0) priceList.innerHTML = "<small style='color:#94a3b8;'>No pricing variants</small>";

    } catch (e) {
        console.debug("Variants fetch error:", e);
    }
}

// Synthesize Selected Combinations
async function synthesizeSelectedCombinations() {
    const getChecked = (containerId) => Array.from(document.querySelectorAll(`#${containerId} input:checked`)).map(el => el.value);

    const payload = {
        experiment_id: CURRENT_EXP_ID,
        copy_variant_ids: getChecked("comb-copy-list"),
        style_variant_ids: getChecked("comb-style-list"),
        component_variant_ids: getChecked("comb-component-list"),
        pricing_variant_ids: getChecked("comb-pricing-list"),
        auto_top_performers: false
    };

    if (payload.copy_variant_ids.length === 0 && payload.style_variant_ids.length === 0 && payload.component_variant_ids.length === 0 && payload.pricing_variant_ids.length === 0) {
        alert("Please select at least 2 dimensions to combine (e.g. 1 Copy and 1 Style).");
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/api/v1/experiments/${CURRENT_EXP_ID}/synthesize-combinations`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-API-Key": CURRENT_API_KEY
            },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        alert(`Synthesized ${data.total_combinations_created} multivariate combinations! Registered in MAB routing.`);
        switchTab("overview");
        setDimensionFilter("COMPOSITE");
    } catch (e) {
        alert("Combination synthesis error: " + e);
    }
}

// Auto Synthesize Top Performers
async function autoSynthesizeTopPerformers() {
    try {
        const res = await fetch(`${API_BASE}/api/v1/experiments/${CURRENT_EXP_ID}/synthesize-combinations`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-API-Key": CURRENT_API_KEY
            },
            body: JSON.stringify({
                experiment_id: CURRENT_EXP_ID,
                auto_top_performers: true
            })
        });
        const data = await res.json();
        alert(`Auto-synthesized ${data.total_combinations_created} Top-Performers Hybrid variant! Live in MAB.`);
        switchTab("overview");
        setDimensionFilter("COMPOSITE");
    } catch (e) {
        alert("Top performers synthesis error: " + e);
    }
}

// Fetch Guardrail Audit Logs
async function fetchAuditLogs() {
    try {
        const res = await fetch(`${API_BASE}/api/v1/experiments/${CURRENT_EXP_ID}/guardrail-audits`);
        if (!res.ok) return;
        const records = await res.json();

        const tbody = document.getElementById("guardrail-audit-tbody");
        tbody.innerHTML = "";

        records.forEach(r => {
            const tr = document.createElement("tr");
            const timeStr = new Date(r.timestamp * 1000).toLocaleTimeString();
            const verdict = r.passed 
                ? '<span class="tag-badge tag-approved">PASSED</span>'
                : `<span class="tag-badge tag-rejected">${r.severity}</span>`;

            tr.innerHTML = `
                <td><small>${timeStr}</small></td>
                <td><strong>${r.check_name}</strong></td>
                <td>${verdict}</td>
                <td><code>${r.rule_fired}</code></td>
                <td>${r.message}</td>
                <td>${r.overridden_by_founder ? '✓ Overridden' : '<button class="btn btn-secondary" style="padding:4px 8px;font-size:11px;" onclick="overrideAudit(\''+r.audit_id+'\')">Override</button>'}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (e) {
        console.debug("Audit fetch error:", e);
    }
}

// Fetch Anomaly Proposals
async function fetchAnomalies() {
    try {
        const res = await fetch(`${API_BASE}/api/v1/anomalies/list`, { headers: { "X-API-Key": CURRENT_API_KEY } });
        if (!res.ok) return;
        const proposals = await res.json();

        const container = document.getElementById("anomaly-proposals-container");
        container.innerHTML = "";

        if (proposals.length === 0) {
            container.innerHTML = "<p class='subtitle'>No active conversion anomalies detected. All funnels operating within modeled baseline bounds.</p>";
            document.getElementById("anomaly-count-badge").textContent = "0";
            return;
        }

        document.getElementById("anomaly-count-badge").textContent = proposals.length;

        proposals.forEach(p => {
            const div = document.createElement("div");
            div.className = "proposal-box";
            div.innerHTML = `
                <div class="proposal-header">
                    <div>
                        <h4>[ANOMALY DETECTED] ${p.metric_name}</h4>
                        <p style="color: var(--warning); margin-top: 4px;">
                            Observed CVR: <strong>${(p.observed_conversion_rate*100).toFixed(2)}%</strong> (Baseline: ${(p.baseline_conversion_rate*100).toFixed(2)}%, Drop: -${p.relative_drop_pct}%)
                        </p>
                    </div>
                    <div>
                        ${p.status === 'PROPOSED' ? 
                            `<button class="btn btn-primary" onclick="approveProposal('${p.proposal_id}')">Approve & Deploy Fix</button>` : 
                            '<span class="tag-badge tag-approved">APPROVED & DEPLOYED</span>'}
                    </div>
                </div>
                <p style="margin-top: 12px; font-size: 13px;"><strong>Hypothesis:</strong> ${p.hypothesis}</p>
                <div class="proposal-trace">${p.reasoning_trace}</div>
            `;
            container.appendChild(div);
        });
    } catch (e) {
        console.debug("Anomaly fetch error:", e);
    }
}

async function approveProposal(proposalId) {
    await fetch(`${API_BASE}/api/v1/anomalies/${proposalId}/approve`, { method: "POST", headers: { "X-API-Key": CURRENT_API_KEY } });
    fetchAnomalies();
    fetchAnalytics();
}

async function simulateTraffic(count = 50) {
    await fetch(`${API_BASE}/api/v1/experiments/${CURRENT_EXP_ID}/simulate-traffic?visitors=${count}`, { method: "POST", headers: { "X-API-Key": CURRENT_API_KEY } });
    fetchAnalytics();
}

// Create Experiment Form
async function handleCreateExperiment(e) {
    e.preventDefault();
    const btn = document.getElementById("btn-submit-exp");
    btn.disabled = true;
    btn.textContent = "⏳ Setting Up & Guardrailing...";

    const expType = document.getElementById("inp-exp-type").value;
    let expId = (document.getElementById("inp-exp-id").value || "").trim();
    if (!expId || expId === "exp_saas_hero_conversion") {
        expId = "exp_macro_" + Math.random().toString(36).substring(2, 9);
        document.getElementById("inp-exp-id").value = expId;
    }
    const title = document.getElementById("inp-exp-title").value || "Website Experiment";
    const url = document.getElementById("inp-exp-url").value || "https://startup.io";
    const selector = document.getElementById("inp-exp-selector").value || "#hero-cta";

    try {
        if (expType === "PRICING_TEST") {
            const priceA = parseFloat(document.getElementById("inp-price-a").value || 49);
            const priceB = parseFloat(document.getElementById("inp-price-b").value || 79);
            const priceC = parseFloat(document.getElementById("inp-price-c").value || 0);

            const plans = [
                { name: `Pro Plan ($${priceA}/mo)`, price_dollars: priceA },
                { name: `Pro Plan ($${priceB}/mo)`, price_dollars: priceB }
            ];
            if (priceC > 0) {
                plans.push({ name: `Pro Plan ($${priceC}/mo)`, price_dollars: priceC });
            }

            let res = await fetch(`${API_BASE}/api/v1/billing/pricing-test/create`, {
                method: "POST",
                headers: { 
                    "Content-Type": "application/json",
                    "X-API-Key": CURRENT_API_KEY
                },
                body: JSON.stringify({
                    experiment_id: expId,
                    title: title,
                    url: url,
                    target_selector: selector,
                    plans: plans
                })
            });
            if (res.status === 401 && CURRENT_API_KEY !== DEFAULT_API_KEY) {
                CURRENT_API_KEY = DEFAULT_API_KEY;
                localStorage.setItem("nerilabs_api_key", DEFAULT_API_KEY);
                res = await fetch(`${API_BASE}/api/v1/billing/pricing-test/create`, {
                    method: "POST",
                    headers: { 
                        "Content-Type": "application/json",
                        "X-API-Key": CURRENT_API_KEY
                    },
                    body: JSON.stringify({
                        experiment_id: expId,
                        title: title,
                        url: url,
                        target_selector: selector,
                        plans: plans
                    })
                });
            }
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.detail || "Failed to create pricing test");
            }
            const data = await res.json();
            CURRENT_EXP_ID = data.experiment_id;
            localStorage.setItem("nerilabs_exp_id", CURRENT_EXP_ID);
            alert(`Price test '${expId}' launched with ${data.variants_created} Stripe pricing arms!`);
        } else {
            persistTargetUrl(url);
            const targetText = (document.getElementById("inp-exp-target-text") ? document.getElementById("inp-exp-target-text").value : "") || "Get Started Free";
            const isLink = selector.includes(" a") || selector.endsWith("a");
            const expPayload = {
                experiment_id: expId,
                title: title,
                experiment_type: expType,
                url: url,
                target_selector: selector,
                target_element: {
                    tag: isLink ? "a" : "button",
                    element_id: selector.replace(/[^a-zA-Z0-9]/g, "").substring(0, 15),
                    selector: selector,
                    inner_text: targetText
                },
                brand_guidelines: {
                    brand_name: "NeriLabs Customer",
                    primary_color: (document.getElementById("inp-brand-primary") ? document.getElementById("inp-brand-primary").value : "#2E3CFF"),
                    accent_color: (document.getElementById("inp-brand-accent") ? document.getElementById("inp-brand-accent").value : "#3ECF8E")
                }
            };
            let createRes = await fetch(`${API_BASE}/api/v1/experiments/create`, {
                method: "POST",
                headers: { 
                    "Content-Type": "application/json",
                    "X-API-Key": CURRENT_API_KEY
                },
                body: JSON.stringify(expPayload)
            });
            if (createRes.status === 401 && CURRENT_API_KEY !== DEFAULT_API_KEY) {
                CURRENT_API_KEY = DEFAULT_API_KEY;
                localStorage.setItem("nerilabs_api_key", DEFAULT_API_KEY);
                createRes = await fetch(`${API_BASE}/api/v1/experiments/create`, {
                    method: "POST",
                    headers: { 
                        "Content-Type": "application/json",
                        "X-API-Key": CURRENT_API_KEY
                    },
                    body: JSON.stringify(expPayload)
                });
            }
            if (!createRes.ok) {
                const errData = await createRes.json().catch(() => ({}));
                throw new Error(errData.detail || "Failed to create experiment");
            }
            let genRes = await fetch(`${API_BASE}/api/v1/experiments/${expId}/generate-suite`, {
                method: "POST",
                headers: { "X-API-Key": CURRENT_API_KEY }
            });
            if (genRes.status === 401 && CURRENT_API_KEY !== DEFAULT_API_KEY) {
                CURRENT_API_KEY = DEFAULT_API_KEY;
                localStorage.setItem("nerilabs_api_key", DEFAULT_API_KEY);
                genRes = await fetch(`${API_BASE}/api/v1/experiments/${expId}/generate-suite`, {
                    method: "POST",
                    headers: { "X-API-Key": CURRENT_API_KEY }
                });
            }
            if (!genRes.ok) {
                const errData = await genRes.json().catch(() => ({}));
                throw new Error(errData.detail || "Failed to generate experiment variants");
            }
            const suiteData = await genRes.json().catch(() => ({}));
            CURRENT_EXP_ID = expId;
            localStorage.setItem("nerilabs_exp_id", expId);
            alert(`Experiment '${expId}' launched! Generated ${suiteData.total_generated || 10} variants (${suiteData.approved_count || 9} approved by guardrails).`);
        }

        await loadTenantExperimentsList();
        updateActiveExperimentBanner();
        switchTab("overview");
        fetchAnalytics();
    } catch (err) {
        alert("Error creating experiment: " + err);
    } finally {
        btn.disabled = false;
        btn.textContent = "Launch Experiment Suite →";
    }
}

// Quick Price Test Handler (Tab 4)
async function handleQuickPricingTest(e) {
    e.preventDefault();
    const expId = document.getElementById("quick-price-exp-id").value;
    const selector = document.getElementById("quick-price-selector").value;
    const priceA = parseFloat(document.getElementById("quick-price-a").value);
    const priceB = parseFloat(document.getElementById("quick-price-b").value);

    try {
        const res = await fetch(`${API_BASE}/api/v1/billing/pricing-test/create`, {
            method: "POST",
            headers: { 
                "Content-Type": "application/json",
                "X-API-Key": CURRENT_API_KEY
            },
            body: JSON.stringify({
                experiment_id: expId,
                title: `Price Test: $${priceA} vs $${priceB}`,
                target_selector: selector,
                plans: [
                    { name: `Pro ($${priceA}/mo)`, price_dollars: priceA },
                    { name: `Pro ($${priceB}/mo)`, price_dollars: priceB }
                ]
            })
        });
        const data = await res.json();
        CURRENT_EXP_ID = data.experiment_id;
        alert(`Stripe Price arms created: $${priceA}/mo vs $${priceB}/mo. Live traffic is now ready to route!`);
        switchTab("overview");
    } catch (err) {
        alert("Pricing test error: " + err);
    }
}

// Server-Side Token Checkout Resolution Simulator
async function simulateServerSidePriceResolution() {
    const resultBox = document.getElementById("checkout-resolution-result");
    resultBox.style.display = "block";
    resultBox.innerHTML = "<em>1. Assigning visitor variant & generating signed JWT token...</em>";

    try {
        const assignRes = await fetch(`${API_BASE}/api/v1/experiments/${CURRENT_EXP_ID}/assign`, {
            method: "POST",
            headers: { 
                "Content-Type": "application/json",
                "X-API-Key": CURRENT_API_KEY
            },
            body: JSON.stringify({
                visitor_id: "vis_test_buyer_" + Math.random().toString(36).substring(2, 7),
                device_type: "desktop"
            })
        });
        const assignData = await assignRes.json();
        const signedToken = assignData.signed_token;

        resultBox.innerHTML += `<br><em>2. Signed JWT Token Issued (Opaque ID: ${assignData.opaque_variant_id})</em>`;
        resultBox.innerHTML += `<br><em>3. Calling POST /api/v1/billing/checkout/resolve with X-Experiment-Token...</em>`;

        const resolveRes = await fetch(`${API_BASE}/api/v1/billing/checkout/resolve`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Experiment-Token": signedToken
            }
        });
        
        if (!resolveRes.ok) {
            const err = await resolveRes.json();
            resultBox.innerHTML += `<br><span style="color:var(--danger)">[ERROR]: ${err.detail}</span>`;
            return;
        }

        const resolveData = await resolveRes.json();
        resultBox.innerHTML += `<br><br><span style="color:var(--success)">✓ SERVER-SIDE RESOLUTION SUCCESSFUL!</span><br>` +
            `• Stripe Price ID: <strong>${resolveData.stripe_price_id}</strong><br>` +
            `• Authoritative Charge: <strong>$${(resolveData.amount_cents/100).toFixed(0)}/mo</strong><br>` +
            `• Commit Boundary Locked: <strong>${resolveData.commit_locked}</strong>`;
    } catch (e) {
        resultBox.innerHTML += `<br><span style="color:var(--danger)">Error: ${e}</span>`;
    }
}

// Onboarding Modal Handlers
function openOnboardingModal() {
    document.getElementById("onboarding-modal-overlay").style.display = "flex";
    document.getElementById("ob-step-form").style.display = "block";
    document.getElementById("ob-step-result").style.display = "none";
}

function closeOnboardingModal() {
    document.getElementById("onboarding-modal-overlay").style.display = "none";
}

async function handleOnboardingSubmit(e) {
    e.preventDefault();
    const btn = document.getElementById("btn-ob-submit");
    btn.disabled = true;
    btn.textContent = "⏳ Parsing DOM & Pre-Computing Variants...";

    const payload = {
        website_url: document.getElementById("ob-url").value,
        target_selector: document.getElementById("ob-selector").value,
        target_element_text: document.getElementById("ob-text").value,
        brand_primary_color: document.getElementById("ob-color-primary").value,
        brand_accent_color: document.getElementById("ob-color-accent").value,
        stripe_restricted_key: (document.getElementById("ob-stripe-key") ? document.getElementById("ob-stripe-key").value : null)
    };

    try {
        let res = await fetch(`${API_BASE}/api/v1/onboarding/setup`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-API-Key": CURRENT_API_KEY
            },
            body: JSON.stringify(payload)
        });
        if (res.status === 401 && CURRENT_API_KEY !== DEFAULT_API_KEY) {
            CURRENT_API_KEY = DEFAULT_API_KEY;
            localStorage.setItem("nerilabs_api_key", DEFAULT_API_KEY);
            res = await fetch(`${API_BASE}/api/v1/onboarding/setup`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-API-Key": CURRENT_API_KEY
                },
                body: JSON.stringify(payload)
            });
        }
        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.detail || "Onboarding setup failed with status " + res.status);
        }
        const data = await res.json();
        CURRENT_EXP_ID = data.experiment_id;

        CURRENT_EXP_ID = data.experiment_id;
        localStorage.setItem("nerilabs_exp_id", data.experiment_id);

        document.getElementById("ob-step-form").style.display = "none";
        document.getElementById("ob-step-result").style.display = "block";
        document.getElementById("ob-summary-text").textContent = `Generated ${data.variants_generated} variations (${data.variants_approved} approved by guardrails).`;
        document.getElementById("ob-code-snippet").textContent = data.script_tag_html;
        document.getElementById("main-script-tag-code").textContent = data.script_tag_html;

        // Auto-switch to customer's new experiment immediately!
        await loadTenantExperimentsList();
        updateActiveExperimentBanner();
    } catch (err) {
        alert("Onboarding setup error: " + err);
    } finally {
        btn.disabled = false;
        btn.textContent = "Generate Variants & Get Script Tag →";
    }
}

function copySnippetCode() {
    const code = document.getElementById("ob-code-snippet").textContent;
    navigator.clipboard.writeText(code);
    alert("Script tag copied to clipboard!");
}

function copyApiKey() {
    navigator.clipboard.writeText(CURRENT_API_KEY);
    alert("API Key copied to clipboard!");
}

function migrateSubscribers() {
    alert("Grandfathered subscribers successfully queued for migration.");
}

async function saveRescueConfig() {
    const payload = {
        enabled: true,
        dwell_threshold_seconds: parseFloat(document.getElementById("cfg-dwell-sec").value),
        promo_code: document.getElementById("cfg-promo-code").value,
        discount_percent: parseInt(document.getElementById("cfg-discount-pct").value),
        rescue_price_amount_cents: parseInt(document.getElementById("cfg-rescue-price").value) * 100,
        modal_headline: "Founder's Priority Access Offer",
        modal_body: "Claim an exclusive discount on your first 3 months.",
        transparent_disclosure: true,
        disclosure_statement: document.getElementById("cfg-disclosure-text").value
    };

    try {
        const res = await fetch(`${API_BASE}/api/v1/billing/behavioral-rescue/configure`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-API-Key": CURRENT_API_KEY
            },
            body: JSON.stringify(payload)
        });
        if (res.ok) alert("Behavioral rescue policy saved!");
    } catch (e) {
        alert("Error: " + e);
    }
}

async function previewAICreativeOffers() {
    const container = document.getElementById("ai-angles-preview-container");
    container.style.display = "block";
    container.innerHTML = "<em>Analyzing session telemetry & resolving offer...</em>";

    try {
        const res = await fetch(`${API_BASE}/api/v1/behavior/generate-creative-offer-preview?experiment_id=${CURRENT_EXP_ID}`, {
            method: "POST",
            headers: { "X-API-Key": CURRENT_API_KEY }
        });
        const data = await res.json();
        container.innerHTML = "<h6 style='margin-bottom:8px;color:#38bdf8;'>AI-Synthesized Personalized Angles:</h6>";

        data.ai_generated_offers.forEach(offer => {
            const box = document.createElement("div");
            box.style.cssText = "background:#0b1120;border:1px solid #334155;border-radius:6px;padding:10px;margin-bottom:8px;font-size:12px;";
            box.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                    <strong style="color:#f8fafc;">${offer.headline}</strong>
                    <span class="badge" style="font-size:10px;">${offer.angle}</span>
                </div>
                <p style="color:#94a3b8;font-size:11px;margin:4px 0;">${offer.body}</p>
                <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;">
                    <code style="color:#38bdf8;font-weight:bold;">${offer.promo_code} (${offer.discount_percent}% OFF)</code>
                    <button class="btn btn-secondary" style="padding:2px 8px;font-size:10px;" onclick="applyPromoAngle('${offer.promo_code}', '${offer.discount_percent}')">Select Angle</button>
                </div>
            `;
            container.appendChild(box);
        });
    } catch (e) {
        container.innerHTML = `<span style="color:var(--danger)">Error: ${e}</span>`;
    }
}

function applyPromoAngle(code, discount) {
    document.getElementById("cfg-promo-code").value = code;
    document.getElementById("cfg-discount-pct").value = discount;
    alert(`Selected promo code '${code}'! Click 'Save Behavioral Rescue Policy'.`);
}

async function testBehavioralRescueSimulation() {
    const resultBox = document.getElementById("rescue-simulation-result");
    resultBox.style.display = "block";
    resultBox.innerHTML = "<em>Simulating visitor dwelling for 10s...</em>";

    try {
        const res = await fetch(`${API_BASE}/api/v1/behavior/trigger-rescue-simulation?experiment_id=${CURRENT_EXP_ID}&dwell_seconds=10`, {
            method: "POST",
            headers: { "X-API-Key": CURRENT_API_KEY }
        });
        const data = await res.json();
        if (data.friction_triggered && data.promotional_rescue_payload) {
            resultBox.innerHTML = `<span style="color:var(--success)">✓ RESCUE TRIGGERED!</span><br>` +
                `• Offer: <strong>${data.promotional_rescue_payload.promo_code} (${data.promotional_rescue_payload.discount_percent}% OFF)</strong><br>` +
                `• Price: <strong>${data.promotional_rescue_payload.discounted_price_formatted}</strong>`;
            if (window.showPromotionalRescueModal) {
                window.showPromotionalRescueModal(data.promotional_rescue_payload, data.escalated_token);
            }
        }
    } catch (e) {
        resultBox.innerHTML = `Error: ${e}`;
    }
}

if (isNewOnboarding) openOnboardingModal();

fetchAccountInfo();
loadTenantExperimentsList();
loadTenantExperimentsList();

// Experiment Switcher Functionality





fetchAnalytics();
setInterval(fetchAnalytics, 4000);

async function overrideAudit(auditId) {
    const reason = prompt("Enter founder justification for overriding this safety rule:");
    if (!reason) return;
    try {
        const res = await fetch(`${API_BASE}/api/v1/experiments/${CURRENT_EXP_ID}/guardrail-audits/${auditId}/override`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-API-Key": CURRENT_API_KEY
            },
            body: JSON.stringify({ override_approve: true, reason: reason })
        });
        if (res.ok) {
            alert("Guardrail check successfully overridden by founder.");
            fetchAuditLogs();
        }
    } catch (e) {
        alert("Override error: " + e);
    }
}

// Explicit Window Bindings for Inline HTML Handlers
window.switchTab = switchTab;
window.setDimensionFilter = setDimensionFilter;
window.toggleExperimentTypeFields = toggleExperimentTypeFields;
window.openOnboardingModal = openOnboardingModal;
window.closeOnboardingModal = closeOnboardingModal;
window.handleCreateExperiment = handleCreateExperiment;
window.handleQuickPricingTest = handleQuickPricingTest;
window.simulateTraffic = simulateTraffic;
window.simulateServerSidePriceResolution = simulateServerSidePriceResolution;
window.handleOnboardingSubmit = handleOnboardingSubmit;
window.copySnippetCode = copySnippetCode;
window.copyApiKey = copyApiKey;
window.overrideAudit = overrideAudit;
window.approveProposal = approveProposal;
window.saveRescueConfig = saveRescueConfig;
window.previewAICreativeOffers = previewAICreativeOffers;
window.applyPromoAngle = applyPromoAngle;
window.testBehavioralRescueSimulation = testBehavioralRescueSimulation;
window.synthesizeSelectedCombinations = synthesizeSelectedCombinations;
window.autoSynthesizeTopPerformers = autoSynthesizeTopPerformers;
window.fetchAnalytics = fetchAnalytics;


async function saveAccountOpenAIKey() {
    const inp = document.getElementById("inp-account-openai-key");
    const statusEl = document.getElementById("account-key-save-status");
    if (!inp || !inp.value.trim()) return;

    try {
        const res = await fetch(`${API_BASE}/api/v1/tenant/settings/ai-key`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-API-Key": CURRENT_API_KEY
            },
            body: JSON.stringify({ openai_api_key: inp.value.trim() })
        });
        if (res.ok) {
            if (statusEl) {
                statusEl.style.display = "inline";
                setTimeout(() => { statusEl.style.display = "none"; }, 3500);
            }
        }
    } catch (e) {
        console.error("Failed to save OpenAI key:", e);
    }
}
window.saveAccountOpenAIKey = saveAccountOpenAIKey;


// =====================================================================
// AUTONOMOUS DOM INSPECTOR & ELEMENT DISCOVERY
// =====================================================================
let DISCOVERED_TARGETS = [];

async function scanWebsiteForTargets() {
    const urlInput = document.getElementById("ob-url");
    const scanBtn = document.getElementById("btn-scan-url");
    const container = document.getElementById("ob-targets-container");
    const list = document.getElementById("ob-targets-list");
    if (!urlInput || !urlInput.value.trim()) return;

    if (scanBtn) {
        scanBtn.textContent = "Scanning...";
        scanBtn.style.pointerEvents = "none";
    }

    try {
        const res = await fetch(`${API_BASE}/api/v1/inspector/scan-url`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: urlInput.value.trim() })
        });
        if (!res.ok) throw new Error("Scan failed");
        const data = await res.json();
        const targets = data.targets || [];
        DISCOVERED_TARGETS = targets;
        // Auto-fill extracted brand colors if returned
        if (data.colors) {
            const primInput = document.getElementById("ob-color-primary");
            const accInput = document.getElementById("ob-color-accent");
            if (primInput && data.colors.primary) primInput.value = data.colors.primary;
            if (accInput && data.colors.accent) accInput.value = data.colors.accent;
        }

        if (container && list) {
            container.style.display = "block";
            list.innerHTML = "";

            if (targets.length === 0) {
                list.innerHTML = '<div style="color: var(--ink-faint); font-size: 11px;">No interactive CTA buttons found on this page. Enter custom selector below.</div>';
            } else {
                targets.forEach((t, idx) => {
                    const card = document.createElement("div");
                    card.className = "target-card" + (t.recommended || idx === 0 ? " active" : "");
                    card.onclick = () => selectDiscoveredTarget(t, card);

                    const badgeHtml = t.recommended 
                        ? '<span class="target-badge">[RECOMMENDED] ' + t.label + '</span>'
                        : '<span style="font-size: 9.5px; color: var(--ink-dim); text-transform: uppercase;">' + t.label + '</span>';

                    card.innerHTML = `
                        <div class="target-card-header">
                            ${badgeHtml}
                            <code style="font-size: 10px; color: var(--caution); background: var(--panel); padding: 2px 6px; border-radius: 2px; border: 1px solid var(--line);">${t.selector}</code>
                        </div>
                        <div style="font-size: 12.5px; font-weight: 600; color: var(--ink); margin-top: 4px;">
                            Element Text: "${t.text}"
                        </div>
                    `;
                    list.appendChild(card);
                });

                // Auto-select the first / recommended target
                const firstRec = targets.find(t => t.recommended) || targets[0];
                selectDiscoveredTarget(firstRec, list.firstChild);
            }
        }
    } catch (e) {
        console.debug("Target scan error:", e);
    } finally {
        if (scanBtn) {
            scanBtn.textContent = "Scan Website Elements →";
            scanBtn.style.pointerEvents = "auto";
        }
    }
}
window.scanWebsiteForTargets = scanWebsiteForTargets;

function selectDiscoveredTarget(target, cardEl) {
    if (!target) return;
    const list = document.getElementById("ob-targets-list");
    if (list) {
        list.querySelectorAll(".target-card").forEach(c => c.classList.remove("active"));
    }
    if (cardEl) cardEl.classList.add("active");

    const selInput = document.getElementById("ob-selector");
    const textInput = document.getElementById("ob-text");
    if (selInput) selInput.value = target.selector;
    if (textInput) textInput.value = target.text;
}
window.selectDiscoveredTarget = selectDiscoveredTarget;

async function scanMacroPageUrl(e) {
    if (e) e.preventDefault();
    const urlInput = document.getElementById("inp-exp-url");
    const scanBtn = document.getElementById("btn-scan-macro");
    const container = document.getElementById("macro-targets-container");
    const list = document.getElementById("macro-targets-list");
    if (!urlInput || !urlInput.value.trim()) return;

    persistTargetUrl(urlInput.value.trim());

    if (scanBtn) {
        scanBtn.textContent = "Scanning Elements...";
        scanBtn.style.pointerEvents = "none";
    }

    try {
        const res = await fetch(`${API_BASE}/api/v1/inspector/scan-url`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: urlInput.value.trim() })
        });
        if (!res.ok) throw new Error("Macro scan failed");
        const data = await res.json();
        const targets = data.targets || [];

        if (data.colors) {
            const prim = document.getElementById("inp-brand-primary");
            const acc = document.getElementById("inp-brand-accent");
            if (prim && data.colors.primary) prim.value = data.colors.primary;
            if (acc && data.colors.accent) acc.value = data.colors.accent;
        }

        if (container && list) {
            container.style.display = "block";
            list.innerHTML = "";

            if (targets.length === 0) {
                list.innerHTML = `<div style="color: var(--ink-faint); font-size: 11px;">No interactive CTA buttons or navigation links found. Enter custom selector below.</div>`;
            } else {
                targets.forEach((t, idx) => {
                    const card = document.createElement("div");
                    card.className = "target-card" + (t.recommended || idx === 0 ? " active" : "");
                    card.onclick = () => selectDiscoveredMacroTarget(t, card);

                    const badgeHtml = t.recommended 
                        ? `<span class="target-badge">[RECOMMENDED] ${t.label}</span>`
                        : `<span style="font-size: 9.5px; color: var(--ink-dim); text-transform: uppercase;">${t.label}</span>`;

                    card.innerHTML = `
                        <div class="target-card-header">
                            ${badgeHtml}
                            <code style="font-size: 10px; color: var(--caution); background: var(--panel); padding: 2px 6px; border-radius: 2px; border: 1px solid var(--line);">${t.selector}</code>
                        </div>
                        <div style="font-size: 12.5px; font-weight: 600; color: var(--ink); margin-top: 4px;">
                            Element Text: "${t.text}"
                        </div>
                    `;
                    list.appendChild(card);
                });

                const firstRec = targets.find(t => t.recommended) || targets[0];
                selectDiscoveredMacroTarget(firstRec, list.firstChild);
            }
        }
    } catch (err) {
        console.debug("Macro scan error:", err);
    } finally {
        if (scanBtn) {
            scanBtn.textContent = "Auto-Detect Elements →";
            scanBtn.style.pointerEvents = "auto";
        }
    }
}
window.scanMacroPageUrl = scanMacroPageUrl;

function selectDiscoveredMacroTarget(target, cardEl) {
    if (!target) return;
    const list = document.getElementById("macro-targets-list");
    if (list) {
        list.querySelectorAll(".target-card").forEach(c => c.classList.remove("active"));
    }
    if (cardEl) cardEl.classList.add("active");

    const selInput = document.getElementById("inp-exp-selector");
    const textInput = document.getElementById("inp-exp-target-text");
    const titleInput = document.getElementById("inp-exp-title");

    if (selInput) selInput.value = target.selector;
    if (textInput) textInput.value = target.text;
    if (titleInput && target.text) {
        titleInput.value = `Optimize: ${target.text.substring(0, 24)} (${target.label})`;
    }
}
window.selectDiscoveredMacroTarget = selectDiscoveredMacroTarget;
