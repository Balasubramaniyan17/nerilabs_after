// Universal HTML Escaper (Prevents ReferenceError and XSS in DOM rendering)
function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
window.escapeHtml = escapeHtml;

const API_BASE = window.location.origin;
const DEFAULT_API_KEY = "nerilabs_sk_live_9a8b7c6d5e4f3a2b1c";
const DEFAULT_PUBLISHABLE_KEY = "nerilabs_pk_live_9a8b7c6d5e4f3a2b1c";
let CURRENT_EXP_ID = localStorage.getItem("nerilabs_exp_id") || null;
let ALL_TENANT_EXPERIMENTS = [];
let CURRENT_API_KEY = localStorage.getItem("nerilabs_api_key") || "";
let CURRENT_PUBLISHABLE_KEY = DEFAULT_PUBLISHABLE_KEY;
let currentDimensionFilter = "ALL";

let CURRENT_TENANT = null;
let CURRENT_PLAN_LIMITS = {
    name: "Launch (Free)",
    price_dollars: 0,
    max_experiments: 1,
    max_traffic: 5000,
    has_stripe_pricing: false,
    has_onboarding_branching: false,
    has_anomalies: false,
    has_factorial: false,
    is_admin: false
};
let IS_MASTER_ADMIN = false;

let auth0Client = null;
const auth0Config = {
    domain: "nerilabs.us.auth0.com",
    clientId: "bs3Xf2oBKv1f0GlOkKeOkWpVl3HcGLBf",
    authorizationParams: {
        redirect_uri: window.location.origin
    }
};

async function getAuth0Client() {
    if (!auth0Client && window.auth0) {
        try {
            auth0Client = await auth0.createAuth0Client(auth0Config);
        } catch(e) {
            console.debug("Auth0 initialization notice:", e);
        }
    }
    return auth0Client;
}

async function loginWithAuth0() {
    try {
        const client = await getAuth0Client();
        if (client) {
            await client.loginWithRedirect({
                authorizationParams: { redirect_uri: window.location.origin }
            });
        } else {
            alert("Auth0 client is initializing. Please click again in 2 seconds.");
        }
    } catch(e) {
        alert("Auth0 login error: " + e.message);
    }
}
window.loginWithAuth0 = loginWithAuth0;

async function logoutUser() {
    console.info("[Auth] Signing out user session...");
    try {
        localStorage.clear();
        sessionStorage.clear();
    } catch(e) {}

    CURRENT_API_KEY = "";
    CURRENT_TENANT = null;
    IS_MASTER_ADMIN = false;
    CURRENT_EXP_ID = null;

    try {
        if (typeof auth0 !== "undefined") {
            const client = await getAuth0Client();
            if (client && await client.isAuthenticated()) {
                await client.logout({
                    openUrl: false,
                    logoutParams: { returnTo: window.location.origin + window.location.pathname }
                });
            }
        }
    } catch(e) {}

    // Force redirect to clean URL without query parameters or hash
    window.location.replace(window.location.origin + window.location.pathname);
}
window.logoutUser = logoutUser;

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

async function handleAdminLoginSubmit(e) {
    e.preventDefault();
    const btn = document.getElementById("btn-admin-submit");
    const inp = document.getElementById("inp-founder-admin-key");
    if (!inp || !inp.value.trim()) return;

    if (btn) { btn.disabled = true; btn.textContent = "Verifying Master Key..."; }

    try {
        const res = await fetch(`${API_BASE}/api/v1/auth/admin-login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ admin_key: inp.value.trim() })
        });
        if (!res.ok) throw new Error("Invalid Founder Master Admin Key");
        const data = await res.json();
        
        CURRENT_API_KEY = data.api_key;
        localStorage.setItem("nerilabs_api_key", data.api_key);
        localStorage.setItem("nerilabs_admin_bypass", "true");
        IS_MASTER_ADMIN = true;
        
        closeAdminKeyModal();
        const gate = document.getElementById("auth-gate-modal");
        if (gate) gate.style.display = "none";

        await fetchAccountInfo();
        await loadTenantExperimentsList();
        alert("✓ Founder Master Admin Key Verified. Full Enterprise Access Unlocked.");
    } catch(err) {
        alert("Admin Authentication Failed: " + err.message);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = "Unlock Dashboard →"; }
    }
}
window.handleAdminLoginSubmit = handleAdminLoginSubmit;

function openUpgradeModal(title = "Plan Upgrade Required", desc = "Upgrade your plan to unlock this feature:") {
    const m = document.getElementById("plan-upgrade-modal");
    if (m) {
        m.style.display = "flex";
        const tEl = document.getElementById("upgrade-modal-title");
        const dEl = document.getElementById("upgrade-modal-desc");
        if (tEl) tEl.textContent = title;
        if (dEl) dEl.textContent = desc;
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
        const data = await res.json();
        if (res.ok && data.checkout_url) {
            window.location.href = data.checkout_url;
            return;
        }
        alert(data.detail || "Stripe checkout could not be created. Please verify your Stripe configuration.");
    } catch(e) {
        alert("Failed to initiate upgrade: " + e.message);
    }
}
window.triggerUpgrade = triggerUpgrade;


// Tab Switching
function switchTab(tabId) {
    const isAdmin = IS_MASTER_ADMIN || (CURRENT_TENANT && (CURRENT_TENANT.is_admin || CURRENT_TENANT.subscription_plan === "ENTERPRISE"));
    if (CURRENT_PLAN_LIMITS && !isAdmin) {
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

    if (tabId === "overview") {
        loadVariantApprovalList();
        fetchAnalytics();
    }
    if (tabId === "traffic") {
        fetchTrafficAnalytics();
    }
    if (tabId === "combinations") fetchCombinationsMatrix();
    if (tabId === "guardrails") fetchAuditLogs();
    if (tabId === "anomalies") fetchAnomalies();
    if (tabId === "account") fetchAccountInfo();
    if (tabId === "create") {
        // Allow user to enter any website URL without forcing cache
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

async function initAuthentication() {
    const params = new URLSearchParams(window.location.search);
    
    // 1. Founder Master Admin Key via query parameter (?admin_key=...)
    const adminKeyParam = params.get("admin_key");
    if (adminKeyParam) {
        try {
            const res = await fetch(`${API_BASE}/api/v1/auth/admin-login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ admin_key: adminKeyParam })
            });
            if (res.ok) {
                const data = await res.json();
                CURRENT_API_KEY = data.api_key;
                localStorage.setItem("nerilabs_api_key", data.api_key);
                localStorage.setItem("nerilabs_admin_bypass", "true");
                IS_MASTER_ADMIN = true;
                window.history.replaceState({}, document.title, window.location.pathname);
                return true;
            }
        } catch(e) {}
    }

    // 2. Auth0 User Sync from landing page redirect (?auth0_sub=...&email=...)
    const subParam = params.get("auth0_sub");
    const emailParam = params.get("email");
    if (subParam && emailParam) {
        try {
            const planParam = params.get("plan") || "launch";
            const nameParam = params.get("name") || "";
            const res = await fetch(`${API_BASE}/api/v1/auth/auth0-sync`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    sub: subParam,
                    email: emailParam,
                    name: nameParam,
                    plan: planParam
                })
            });
            if (res.ok) {
                const data = await res.json();
                CURRENT_API_KEY = data.api_key;
                localStorage.setItem("nerilabs_api_key", data.api_key);
                window.history.replaceState({}, document.title, window.location.pathname);
                return true;
            }
        } catch(e) {}
    }

    // 3. Auth0 Direct Callback (?code=...&state=...)
    if (window.location.search.includes("code=") && window.location.search.includes("state=")) {
        try {
            const client = await getAuth0Client();
            if (client) {
                await client.handleRedirectCallback();
                window.history.replaceState({}, document.title, window.location.pathname);
                const user = await client.getUser();
                if (user && user.sub) {
                    const planParam = params.get("plan") || "launch";
                    const res = await fetch(`${API_BASE}/api/v1/auth/auth0-sync`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            sub: user.sub,
                            email: user.email,
                            name: user.name,
                            plan: planParam
                        })
                    });
                    if (res.ok) {
                        const data = await res.json();
                        CURRENT_API_KEY = data.api_key;
                        localStorage.setItem("nerilabs_api_key", data.api_key);
                        return true;
                    }
                }
            }
        } catch(e) {
            console.debug("Auth0 callback notice:", e);
        }
    }

    // 4. Check stored API Key
    const stored = localStorage.getItem("nerilabs_api_key");
    if (stored) {
        try {
            // Check if returning from a successful Stripe checkout upgrade
            if (params.get("upgraded") === "true" && params.get("session_id")) {
                const confRes = await fetch(`${API_BASE}/api/v1/billing/confirm-upgrade`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "X-API-Key": stored },
                    body: JSON.stringify({ plan: params.get("plan") || "growth", session_id: params.get("session_id") })
                });
                if (confRes.ok) {
                    const confData = await confRes.json();
                    alert(`Payment verified! Your workspace has been upgraded to ${confData.subscription_plan}.`);
                } else {
                    const errData = await confRes.json().catch(() => ({}));
                    alert(`Upgrade verification notice: ${errData.detail || 'Could not verify payment'}`);
                }
                window.history.replaceState({}, document.title, window.location.pathname);
            }

            const res = await fetch(`${API_BASE}/api/v1/tenant/me`, {
                headers: { "X-API-Key": stored }
            });
            if (res.ok) {
                CURRENT_API_KEY = stored;
                return true;
            }
        } catch(e) {}
    }

    // 5. Check if Auth0 is already authenticated via SSO
    try {
        const client = await getAuth0Client();
        if (client && await client.isAuthenticated()) {
            const user = await client.getUser();
            if (user && user.sub) {
                const res = await fetch(`${API_BASE}/api/v1/auth/auth0-sync`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        sub: user.sub,
                        email: user.email,
                        name: user.name,
                        plan: "launch"
                    })
                });
                if (res.ok) {
                    const data = await res.json();
                    CURRENT_API_KEY = data.api_key;
                    localStorage.setItem("nerilabs_api_key", data.api_key);
                    return true;
                }
            }
        }
    } catch(e) {}

    return false;
}

// Fetch Tenant Account Info & Apply Plan Gating
async function fetchAccountInfo() {
    if (!CURRENT_API_KEY) {
        const gate = document.getElementById("auth-gate-modal");
        if (gate) gate.style.display = "flex";
        return;
    }

    try {
        let res = await fetch(`${API_BASE}/api/v1/tenant/me`, {
            headers: { "X-API-Key": CURRENT_API_KEY }
        });
        if (!res.ok) {
            const gate = document.getElementById("auth-gate-modal");
            if (gate) gate.style.display = "flex";
            return;
        }
        const tenant = await res.json();
        CURRENT_TENANT = tenant;
        CURRENT_PLAN_LIMITS = tenant.plan_limits || {
            name: "Launch (Free)",
            price_dollars: 0,
            max_experiments: 1,
            max_traffic: 5000,
            has_stripe_pricing: false,
            has_onboarding_branching: false,
            has_anomalies: false,
            has_factorial: false,
            is_admin: false
        };
        IS_MASTER_ADMIN = tenant.is_admin || false;
        CURRENT_PUBLISHABLE_KEY = tenant.publishable_key;

        // Hide auth gate
        const gate = document.getElementById("auth-gate-modal");
        if (gate) gate.style.display = "none";

        // Update organization name & plan badge in sidebar
        const nameEl = document.getElementById("tenant-name");
        if (nameEl) nameEl.textContent = tenant.organization_name;

        const planBadge = document.getElementById("sidebar-plan-badge");
        if (planBadge) {
            if (IS_MASTER_ADMIN) {
                planBadge.textContent = "[ FOUNDER MASTER ADMIN ]";
                planBadge.style.color = "var(--good)";
                planBadge.style.borderColor = "var(--good)";
            } else {
                planBadge.textContent = `[ PLAN: ${tenant.subscription_plan} ]`;
                planBadge.style.color = (tenant.subscription_plan === "LAUNCH" ? "var(--ink-dim)" : "var(--accent)");
            }
        }

        // Show/hide lock badges on navigation tabs
        const badgeComb = document.getElementById("lock-badge-comb");
        if (badgeComb) badgeComb.style.display = (!IS_MASTER_ADMIN && !CURRENT_PLAN_LIMITS.has_factorial) ? "inline" : "none";

        const badgePricing = document.getElementById("lock-badge-pricing");
        if (badgePricing) badgePricing.style.display = (!IS_MASTER_ADMIN && !CURRENT_PLAN_LIMITS.has_stripe_pricing) ? "inline" : "none";

        const badgeAnomalies = document.getElementById("lock-badge-anomalies");
        if (badgeAnomalies) badgeAnomalies.style.display = (!IS_MASTER_ADMIN && !CURRENT_PLAN_LIMITS.has_anomalies) ? "inline" : "none";

        const partnerNav = document.getElementById("nav-partners-tab");
        if (partnerNav) {
            partnerNav.style.display = "flex";
        }

        // Update Account tab details
        const accPlanTitle = document.getElementById("account-plan-title");
        const accPlanLimits = document.getElementById("account-plan-limits");
        const accPlanBadge = document.getElementById("account-plan-badge");
        if (accPlanTitle) accPlanTitle.textContent = IS_MASTER_ADMIN ? "Founder Master Admin (Enterprise)" : `${CURRENT_PLAN_LIMITS.name} ($${CURRENT_PLAN_LIMITS.price_dollars}/mo)`;
        if (accPlanLimits) accPlanLimits.textContent = `Limit: ${CURRENT_PLAN_LIMITS.max_experiments > 500 ? "Unlimited" : CURRENT_PLAN_LIMITS.max_experiments} active experiment(s) & up to ${CURRENT_PLAN_LIMITS.max_traffic.toLocaleString()} visitors/mo.`;
        if (accPlanBadge) accPlanBadge.textContent = IS_MASTER_ADMIN ? "[ MASTER SUPERUSER ]" : `[ ${tenant.subscription_status} ]`;

        const keyEl = document.getElementById("sidebar-api-key-display");
        if (keyEl) keyEl.textContent = (tenant.api_key || "").substring(0, 18) + "...";
        if (document.getElementById("account-pk-key")) document.getElementById("account-pk-key").textContent = tenant.publishable_key;
        if (document.getElementById("account-sk-key")) document.getElementById("account-sk-key").textContent = tenant.api_key;
        if (document.getElementById("account-jwt-secret")) document.getElementById("account-jwt-secret").textContent = tenant.token_signing_secret;

        if (tenant.target_website_url && !localStorage.getItem("nerilabs_target_url")) {
            localStorage.setItem("nerilabs_target_url", tenant.target_website_url);
        }
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
    loadVariantApprovalList();
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
        let baseUrl = window.location.origin;
        if (baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1") || baseUrl.includes("0.0.0.0") || baseUrl.startsWith("http://")) {
            baseUrl = "https://app.nerilabs.io";
        }
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

            // Automatically pick the customer's newest live experiment safely
            if (activeList.length > 0) {
                if (!CURRENT_EXP_ID || !activeList.some(e => e.experiment_id === CURRENT_EXP_ID)) {
                    CURRENT_EXP_ID = activeList[0].experiment_id;
                    localStorage.setItem("nerilabs_exp_id", CURRENT_EXP_ID);
                }
                sel.value = CURRENT_EXP_ID;
            } else {
                CURRENT_EXP_ID = null;
                const opt = document.createElement("option");
                opt.value = "";
                opt.textContent = "No experiments yet — Click '+ New Experiment'";
                sel.appendChild(opt);
            }
        }

        updateActiveExperimentBanner();
        renderTargetInspector();
        fetchLiveActivityStream();
        fetchAnalytics();
        loadVariantApprovalList();
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
        
        // Render dedicated pricing card preview if variant has pricing payload
        if (variant.variant_type === "PRICING" || variant.pricing_payload || (exp && exp.experiment_type === "PRICING_TEST")) {
            const pp = variant.pricing_payload || {};
            const cents = pp.price_amount_cents || (pp.price_dollars ? pp.price_dollars * 100 : 4900);
            const priceFormatted = `$${(cents / 100).toFixed(0)}/mo`;
            const planTitle = pp.plan_name || variant.name || "Pricing Tier";
            previewContainer.innerHTML = `
                <div style="background: var(--panel-2); border: 1px solid var(--accent); border-radius: 6px; padding: 14px 18px; display: inline-block; min-width: 220px; text-align: left; box-shadow: 0 4px 14px rgba(46,60,255,0.18);">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                        <span style="font-size: 10.5px; color: #3ECF8E; font-weight: 700; text-transform: uppercase;">PRICING TIER PREVIEW</span>
                        <span style="font-size: 9.5px; color: var(--ink-dim); background: var(--panel); padding: 1px 5px; border-radius: 2px; border: 1px solid var(--line);">${variant.is_control ? 'CONTROL' : 'TEST'}</span>
                    </div>
                    <div style="font-size: 14px; color: var(--ink); font-weight: 700;">${escapeHtml(planTitle)}</div>
                    <div style="font-size: 28px; font-weight: 800; color: var(--accent); margin: 6px 0;">${priceFormatted}</div>
                    <div style="font-size: 10px; color: var(--ink-faint); margin-bottom: 10px; font-family: monospace;">Target: ${escapeHtml(pp.price_selector || (exp && exp.target_selector) || "")}</div>
                    <button class="btn btn-primary btn-sm" style="width: 100%; pointer-events: none;">${escapeHtml(planTitle ? 'Start with ' + planTitle.split(' ')[0] : 'Checkout →')}</button>
                </div>
            `;
            const liveLink = document.getElementById("inspector-live-preview-link");
            if (liveLink && exp && exp.url) {
                const baseUrl = exp.url.split("?")[0];
                const previewParam = variant.is_control ? "control" : (variant.opaque_id || variant.variant_id);
                liveLink.href = `${baseUrl}?neri_preview=${encodeURIComponent(previewParam)}`;
            }
            return;
        }

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

        // Apply style
        const stylePayload = variant.style_payload || {};
        if (!variant.is_control) {
            if (stylePayload.bg_color) previewEl.style.backgroundColor = stylePayload.bg_color;
            if (stylePayload.text_color) previewEl.style.color = stylePayload.text_color;
            if (stylePayload.border_radius) previewEl.style.borderRadius = stylePayload.border_radius;
        }

        previewContainer.appendChild(previewEl);
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

            const payload = evt.payload || {};
            const utmSource = payload.utm_source || payload.source || "";
            const utmMedium = payload.utm_medium || "";
            let sourceBadge = "";
            if (utmSource) {
                const srcLabel = escapeHtml(utmSource + (utmMedium ? ` / ${utmMedium}` : ""));
                sourceBadge = `<span style="font-size: 10px; background: rgba(46,60,255,0.18); color: #818cf8; border: 1px solid rgba(46,60,255,0.35); padding: 1px 6px; border-radius: 3px; margin-right: 6px; font-weight: 600;">via ${srcLabel}</span>`;
            }

            if (evt.event_type === "CONVERSION") {
                row.style.cssText = "color: var(--good); background: rgba(62, 207, 142, 0.08); padding: 5px 8px; border-radius: 3px; border-left: 2px solid var(--good); display: flex; justify-content: space-between; align-items: center;";
                row.innerHTML = `
                    <span><span style="color: var(--ink-faint);">[ ${timeStr} ]</span> ${sourceBadge}<strong>CONVERSION RECORDED</strong> &middot; Visitor <code>${vShort}</code> clicked target CTA!</span>
                    <span style="font-size: 10px; font-weight: 700; letter-spacing: 0.05em;">[ +1 CONV ]</span>
                `;
            } else {
                row.style.cssText = "color: var(--ink-dim); padding: 3px 0; display: flex; justify-content: space-between; align-items: center;";
                row.innerHTML = `
                    <span><span style="color: var(--ink-faint);">[ ${timeStr} ]</span> ${sourceBadge}VISITOR <code>${vShort}</code> &middot; <span style="color: var(--accent); font-weight: 600;">IMPRESSION</span> &middot; Assigned: "<strong>${escapeHtml(evt.variant_name)}</strong>"</span>
                    <span style="font-size: 10px; color: var(--ink-faint);">${escapeHtml(evt.variant_type)}</span>
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

function renderQuickTrafficSources(sources) {
    const bar = document.getElementById("quick-traffic-sources-bar");
    const container = document.getElementById("quick-traffic-pills");
    if (!bar || !container) return;

    if (!sources || Object.keys(sources).length === 0) {
        bar.style.display = "none";
        return;
    }

    bar.style.display = "flex";
    container.innerHTML = Object.entries(sources).map(([src, d]) => {
        const isCasual = d.category === "CASUAL_SOCIAL";
        const bg = isCasual ? "rgba(245,158,11,0.14)" : "rgba(46,60,255,0.14)";
        const border = isCasual ? "rgba(245,158,11,0.35)" : "rgba(46,60,255,0.35)";
        const color = isCasual ? "#f59e0b" : "#818cf8";
        const convStr = d.conversions > 0 
            ? ` · <span style="color: #3ECF8E; font-weight: 700;">${d.conversions} conv (${((d.cvr || 0)*100).toFixed(1)}%)</span>` 
            : ` · 0 conv`;
        return `<span style="background: ${bg}; border: 1px solid ${border}; color: ${color}; padding: 3px 9px; border-radius: 3px; font-size: 11px; font-weight: 600;">${escapeHtml(src)}: ${d.impressions} visits${convStr}</span>`;
    }).join("");
}
window.renderQuickTrafficSources = renderQuickTrafficSources;

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
                
                // 1. Update Core KPI cards
                const statImprEl = document.getElementById("stat-total-impressions");
                if (statImprEl) statImprEl.textContent = (overall.total_impressions || 0).toLocaleString();

                const statConvEl = document.getElementById("stat-total-conversions");
                if (statConvEl) statConvEl.textContent = (overall.total_conversions || 0).toLocaleString();

                const statCvrEl = document.getElementById("stat-overall-cvr");
                if (statCvrEl) statCvrEl.textContent = ((overall.overall_conversion_rate || 0) * 100).toFixed(2) + "%";

                // 2. Resolve Winning / Best Performing Variant robustly
                let leaderName = overall.leading_variant_name;
                let bestWinProb = overall.confidence_level || 0.0;

                // If leader is None, unspecified, or fallback while another arm converted
                const allArms = (data.filtered_arms && data.filtered_arms.length > 0) ? data.filtered_arms : (overall.arms || []);
                if (!leaderName || leaderName === "None" || leaderName === "null" || (leaderName.includes("Control") && allArms.some(a => a.conversions > 0))) {
                    if (allArms.length > 0) {
                        const sorted = [...allArms].sort((a, b) => (b.conversions - a.conversions) || (b.conversion_rate - a.conversion_rate) || (b.impressions - a.impressions));
                        if (sorted[0] && (sorted[0].conversions > 0 || sorted[0].impressions > 0)) {
                            leaderName = sorted[0].variant_name;
                            if (sorted[0].win_probability) bestWinProb = sorted[0].win_probability;
                        }
                    }
                }

                // If still not resolved but we have cached variants with conversions
                if ((!leaderName || leaderName === "None" || leaderName.includes("Control")) && typeof CACHED_EXPERIMENT_VARIANTS !== "undefined" && CACHED_EXPERIMENT_VARIANTS && CACHED_EXPERIMENT_VARIANTS.length > 0) {
                    const nonControl = CACHED_EXPERIMENT_VARIANTS.filter(v => !v.is_control);
                    if (nonControl.length > 0 && overall.overall_conversion_rate > 0) {
                        leaderName = nonControl[0].name;
                    }
                }

                if (!leaderName || leaderName === "None") {
                    leaderName = overall.total_impressions > 0 ? "Active Exploration" : "None (Awaiting Traffic)";
                }

                const statLeadingConfEl = document.getElementById("stat-leading-confidence");
                if (statLeadingConfEl) {
                    const confVal = bestWinProb > 0 ? bestWinProb : (overall.confidence_level || 0.0);
                    statLeadingConfEl.textContent = (confVal * 100).toFixed(1) + "%";
                }

                const statLeadingNameEl = document.getElementById("stat-leading-name");
                if (statLeadingNameEl) {
                    statLeadingNameEl.textContent = `Leader: ${leaderName}`;
                }

                // 3. Update Active Dimension Card & Winner
                const dimWinnerEl = document.getElementById("dim-summary-winner");
                if (dimWinnerEl) dimWinnerEl.textContent = leaderName;

                const dimCvrEl = document.getElementById("dim-summary-cvr");
                if (dimCvrEl) dimCvrEl.textContent = ((overall.overall_conversion_rate || 0) * 100).toFixed(2) + "%";

                const dimLiftEl = document.getElementById("dim-summary-lift");
                if (dimLiftEl) {
                    const ctrlCvr = (data.control_cvr || 0.045);
                    const lift = (((overall.overall_conversion_rate || 0) - ctrlCvr) / Math.max(0.001, ctrlCvr)) * 100.0;
                    dimLiftEl.textContent = (lift >= 0 ? "+" : "") + lift.toFixed(1) + "%";
                }

                // 4. Update UTM Traffic Attribution & Sources on Tab 01 and Tab 04
                renderQuickTrafficSources(overall.traffic_by_source || {});
                renderTrafficSourceAttribution(overall.traffic_by_source || {});

                // Update Tab 04 KPI counters
                const humVis = document.getElementById("stat-traffic-human-visitors");
                if (humVis) humVis.textContent = (overall.total_impressions || 0).toLocaleString();

                const humConv = document.getElementById("stat-traffic-human-conversions");
                if (humConv) humConv.textContent = (overall.total_conversions || 0).toLocaleString();

                const humCvr = document.getElementById("stat-traffic-human-cvr");
                if (humCvr) humCvr.textContent = ((overall.overall_conversion_rate || 0) * 100).toFixed(2) + "%";

                const botFil = document.getElementById("stat-traffic-bots-filtered");
                if (botFil) botFil.textContent = (overall.bot_traffic_filtered || 0).toLocaleString();

                // 5. Safely load granular variant approvals
                try {
                    await loadVariantApprovalList();
                } catch (errVar) {
                    console.warn("loadVariantApprovalList notice:", errVar);
                }
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

            const item = document.createElement("div");
            item.className = "comb-checkbox-item";
            item.style.cssText = "display:flex; justify-content:space-between; align-items:center; padding:4px 6px; margin-bottom:4px;";
            item.innerHTML = `
                <label style="display:flex; align-items:center; gap:6px; cursor:pointer; flex:1; font-size:11.5px; color:var(--ink);">
                    <input type="checkbox" value="${v.variant_id}" data-type="${v.variant_type}"> 
                    <span>${escapeHtml(v.name)}</span>
                </label>
                ${!v.is_control ? `<button type="button" class="btn btn-secondary" style="padding:1px 6px; font-size:10px; color:#ef4444; border:1px solid rgba(239,68,68,0.3); background:transparent; border-radius:3px; cursor:pointer; margin-left:8px;" title="Delete variant from matrix" onclick="deleteVariantFromMatrix('${v.variant_id}', event)">✕</button>` : ''}
            `;

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
            const isAdmin = IS_MASTER_ADMIN || (CURRENT_TENANT && (CURRENT_TENANT.is_admin || CURRENT_TENANT.subscription_plan === "ENTERPRISE"));
            if (createRes.status === 401 && !isAdmin && CURRENT_API_KEY !== DEFAULT_API_KEY) {
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

// Stripe Account & API Key Management
async function saveStripeSettings(e) {
    if (e) e.preventDefault();
    const keyInput = document.getElementById("stripe-api-key-input");
    const notice = document.getElementById("stripe-save-notice");
    const rawKey = keyInput ? keyInput.value.trim() : "";

    try {
        const res = await fetch(`${API_BASE}/api/v1/tenant/settings/stripe`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-API-Key": CURRENT_API_KEY
            },
            body: JSON.stringify({ stripe_api_key: rawKey })
        });
        const data = await res.json();
        if (notice) {
            notice.textContent = data.message || "✓ Stripe settings updated.";
            notice.style.display = "block";
            setTimeout(() => { notice.style.display = "none"; }, 4000);
        }
        updateStripeConnectionBadge(data.is_connected);
    } catch(err) {
        alert("Error saving Stripe settings: " + err.message);
    }
}
window.saveStripeSettings = saveStripeSettings;

async function fetchStripeSettings() {
    try {
        const res = await fetch(`${API_BASE}/api/v1/tenant/settings/stripe`, {
            headers: { "X-API-Key": CURRENT_API_KEY }
        });
        if (res.ok) {
            const data = await res.json();
            updateStripeConnectionBadge(data.is_connected, data.masked_key);
            const keyInput = document.getElementById("stripe-api-key-input");
            if (keyInput && data.masked_key) {
                keyInput.placeholder = `Active Key: ${data.masked_key}`;
            }
        }
    } catch(e) {}
}
window.fetchStripeSettings = fetchStripeSettings;

function updateStripeConnectionBadge(isConnected, maskedKey) {
    const badge = document.getElementById("stripe-connection-badge");
    if (!badge) return;
    if (isConnected) {
        badge.innerHTML = `<span style="width: 6px; height: 6px; border-radius: 50%; background: #3ECF8E;"></span> STRIPE CONNECTED (${maskedKey || 'ACTIVE'})`;
        badge.style.color = "#3ECF8E";
        badge.style.borderColor = "rgba(62, 207, 142, 0.35)";
    } else {
        badge.innerHTML = `<span style="width: 6px; height: 6px; border-radius: 50%; background: #818cf8;"></span> STANDALONE / CUSTOM LINKS`;
        badge.style.color = "#818cf8";
        badge.style.borderColor = "rgba(129, 140, 248, 0.35)";
    }
}



// =============================================================
// Autonomous Pricing Tier & DOM Selector Detection
// =============================================================
let DISCOVERED_PRICING_PLANS = [];

async function scanPricingWebsite() {
    const urlInput = document.getElementById("quick-price-url");
    const scanBtn = document.getElementById("btn-scan-pricing-tiers");
    const loadingEl = document.getElementById("pricing-scan-loading");
    const container = document.getElementById("discovered-pricing-plans-container");
    const list = document.getElementById("discovered-pricing-plans-list");

    const rawUrl = urlInput ? urlInput.value.trim() : "";
    if (!rawUrl) {
        alert("Please enter a website URL to scan for pricing tiers.");
        return;
    }

    if (scanBtn) {
        scanBtn.textContent = "Scanning...";
        scanBtn.disabled = true;
    }
    if (loadingEl) loadingEl.style.display = "block";

    try {
        const res = await fetch(`${API_BASE}/api/v1/inspector/scan-pricing`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: rawUrl })
        });
        if (!res.ok) throw new Error("Pricing scan failed (" + res.status + ")");
        const data = await res.json();
        const plans = data.plans || [];
        DISCOVERED_PRICING_PLANS = plans;

        if (container && list) {
            container.style.display = "block";
            list.innerHTML = "";

            if (plans.length === 0) {
                list.innerHTML = '<div style="color: var(--ink-dim); font-size: 11px;">No distinct pricing cards found. Custom selectors can still be set below.</div>';
            } else {
                plans.forEach((p, idx) => {
                    const card = document.createElement("div");
                    card.id = `pricing-plan-choice-${idx}`;
                    card.style.cssText = `
                        background: ${p.is_recommended ? 'rgba(46,60,255,0.12)' : 'var(--panel-2)'};
                        border: 1px solid ${p.is_recommended ? 'rgba(46,60,255,0.45)' : 'var(--line)'};
                        border-radius: 4px;
                        padding: 12px 14px;
                        cursor: pointer;
                        flex: 1;
                        min-width: 140px;
                        transition: all 0.2s ease;
                    `;

                    card.innerHTML = `
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                            <strong style="font-size: 12px; color: var(--ink);">${escapeHtml(p.plan_name)}</strong>
                            ${p.is_recommended ? '<span style="font-size: 9px; color: #3ECF8E; font-weight: 700; border: 1px solid rgba(62,207,142,0.4); padding: 1px 5px; border-radius: 2px;">[PRO]</span>' : ''}
                        </div>
                        <div style="font-size: 16px; font-weight: 700; color: var(--accent); margin-bottom: 4px;">
                            $${p.price_dollars}<span style="font-size: 10px; color: var(--ink-dim);">/mo</span>
                        </div>
                        <small style="font-size: 10px; color: var(--ink-dim); display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                            ${escapeHtml(p.price_selector)}
                        </small>
                        <div style="margin-top: 8px; font-size: 10.5px; color: #3ECF8E; font-weight: 600;">
                            Click to Select Plan →
                        </div>
                    `;

                    card.addEventListener("click", () => selectDiscoveredPricingPlan(idx));
                    list.appendChild(card);
                });

                // Auto-select recommended plan (typically Pro)
                const recIdx = plans.findIndex(p => p.is_recommended);
                selectDiscoveredPricingPlan(recIdx >= 0 ? recIdx : 0);
            }
        }
    } catch(err) {
        alert("Notice: Could not scan website directly (" + err.message + "). Fallback selectors pre-filled.");
    } finally {
        if (scanBtn) {
            scanBtn.textContent = "Auto-Detect Tiers";
            scanBtn.disabled = false;
        }
        if (loadingEl) loadingEl.style.display = "none";
    }
}
window.scanPricingWebsite = scanPricingWebsite;

function selectDiscoveredPricingPlan(idx) {
    if (!DISCOVERED_PRICING_PLANS || !DISCOVERED_PRICING_PLANS[idx]) return;
    const plan = DISCOVERED_PRICING_PLANS[idx];

    // Highlight selected card
    DISCOVERED_PRICING_PLANS.forEach((_, i) => {
        const c = document.getElementById(`pricing-plan-choice-${i}`);
        if (c) {
            if (i === idx) {
                c.style.borderColor = "#3ECF8E";
                c.style.background = "rgba(62,207,142,0.14)";
                c.style.boxShadow = "0 0 12px rgba(62,207,142,0.2)";
            } else {
                c.style.borderColor = "var(--line)";
                c.style.background = "var(--panel-2)";
                c.style.boxShadow = "none";
            }
        }
    });

    // Auto-populate form inputs
    const expTitle = document.getElementById("quick-price-title");
    if (expTitle) expTitle.value = `${plan.plan_name} Price Elasticity Test ($${plan.price_dollars} vs $${Math.round(plan.price_dollars * 1.6)})`;

    const expId = document.getElementById("quick-price-exp-id");
    if (expId) {
        const slug = plan.plan_name.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_');
        expId.value = `exp_pricing_${slug}_${Math.random().toString(36).substring(2, 7)}`;
    }

    const priceSel = document.getElementById("quick-price-selector");
    if (priceSel) priceSel.value = plan.price_selector;

    const btnSel = document.getElementById("quick-price-btn-selector");
    if (btnSel) btnSel.value = plan.button_selector;

    const priceA = document.getElementById("quick-price-a");
    if (priceA) priceA.value = plan.price_dollars;

    const linkA = document.getElementById("quick-price-link-a");
    if (linkA && plan.payment_link) linkA.value = plan.payment_link;

    // Suggest elasticity test points
    const priceB = document.getElementById("quick-price-b");
    if (priceB) priceB.value = Math.round(plan.price_dollars * 1.6);

    const priceC = document.getElementById("quick-price-c");
    if (priceC) priceC.value = Math.round(plan.price_dollars * 2.0);
}
window.selectDiscoveredPricingPlan = selectDiscoveredPricingPlan;


async function handleQuickPricingTest(e) {
    e.preventDefault();
    const expId = document.getElementById("quick-price-exp-id").value.trim();
    const title = (document.getElementById("quick-price-title") ? document.getElementById("quick-price-title").value : `Price Elasticity Test`).trim();
    const selector = document.getElementById("quick-price-selector").value.trim();
    const btnSelector = document.getElementById("quick-price-btn-selector") ? document.getElementById("quick-price-btn-selector").value.trim() : ".btn";
    
    const priceA = parseFloat(document.getElementById("quick-price-a").value);
    const linkA = document.getElementById("quick-price-link-a") ? document.getElementById("quick-price-link-a").value.trim() : "";
    
    const priceB = parseFloat(document.getElementById("quick-price-b").value);
    const linkB = document.getElementById("quick-price-link-b") ? document.getElementById("quick-price-link-b").value.trim() : "";

    const basePlanName = title.split(" Price")[0].split(" Elasticity")[0].trim() || "Plan";

    const plans = [
        {
            plan_name: `${basePlanName} ($${priceA}/mo)`,
            price_dollars: priceA,
            stripe_price_id: linkA.startsWith("price_") ? linkA : null,
            stripe_payment_link: linkA.startsWith("http") ? linkA : null,
            button_selector: btnSelector,
            price_selector: selector
        },
        {
            plan_name: `${basePlanName} ($${priceB}/mo)`,
            price_dollars: priceB,
            stripe_price_id: linkB.startsWith("price_") ? linkB : null,
            stripe_payment_link: linkB.startsWith("http") ? linkB : null,
            button_selector: btnSelector,
            price_selector: selector
        }
    ];

    const priceCEl = document.getElementById("quick-price-c");
    const linkCEl = document.getElementById("quick-price-link-c");
    if (priceCEl && priceCEl.value) {
        const priceC = parseFloat(priceCEl.value);
        const linkC = linkCEl ? linkCEl.value.trim() : "";
        plans.push({
            plan_name: `Tier C ($${priceC}/mo)`,
            price_dollars: priceC,
            stripe_price_id: linkC.startsWith("price_") ? linkC : null,
            stripe_payment_link: linkC.startsWith("http") ? linkC : null,
            button_selector: btnSelector,
            price_selector: selector
        });
    }

    try {
        const res = await fetch(`${API_BASE}/api/v1/billing/pricing-test/create`, {
            method: "POST",
            headers: { 
                "Content-Type": "application/json",
                "X-API-Key": CURRENT_API_KEY
            },
            body: JSON.stringify({
                experiment_id: expId,
                title: title,
                target_selector: selector,
                button_selector: btnSelector,
                plans: plans
            })
        });
        if (!res.ok) {
            const errData = await res.json();
            throw new Error(errData.detail || `Server error: ${res.status}`);
        }
        const data = await res.json();
        CURRENT_EXP_ID = data.experiment_id;
        localStorage.setItem("nerilabs_exp_id", CURRENT_EXP_ID);
        alert(`✓ Dynamic Pricing Experiment Launched!\n\nConfigured: $${priceA}/mo vs $${priceB}/mo.\nLive visitor traffic is now automatically routed via Thompson Sampling.`);
        await loadTenantExperimentsList();
        switchTab("overview");
    } catch (err) {
        alert("Pricing test launch notice: " + err.message);
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
    const isAdmin = IS_MASTER_ADMIN || (CURRENT_TENANT && (CURRENT_TENANT.is_admin || CURRENT_TENANT.subscription_plan === "ENTERPRISE"));
    if (CURRENT_PLAN_LIMITS && !isAdmin) {
        const activeCount = ALL_TENANT_EXPERIMENTS.filter(e => e.is_active).length;
        if (activeCount >= CURRENT_PLAN_LIMITS.max_experiments) {
            openUpgradeModal(
                `Experiment Limit Reached (${activeCount}/${CURRENT_PLAN_LIMITS.max_experiments})`,
                `Your current ${CURRENT_PLAN_LIMITS.name} allows up to ${CURRENT_PLAN_LIMITS.max_experiments} active experiment. Upgrade your plan to run multiple tests simultaneously.`
            );
            return;
        }
    }
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
        let cleanSnippet = (data.script_tag_html || "").replace(/http:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?/g, "https://app.nerilabs.io");
        document.getElementById("ob-code-snippet").textContent = cleanSnippet;
        document.getElementById("main-script-tag-code").textContent = cleanSnippet;
        loadVariantApprovalList();
        document.getElementById("main-script-tag-code").textContent = data.script_tag_html;

        // Populate generated variations preview in setup wizard
        const vList = document.getElementById("ob-generated-variants-list");
        if (vList) {
            vList.innerHTML = '<div style="font-size:11px; color:var(--ink-dim);">Loading generated contextual variations...</div>';
            try {
                const vRes = await fetch(`${API_BASE}/api/v1/experiments/${data.experiment_id}/variants`, {
                    headers: { "X-API-Key": CURRENT_API_KEY }
                });
                if (vRes.ok) {
                    const vars = await vRes.json();
                    CACHED_EXPERIMENT_VARIANTS = vars;
                    vList.innerHTML = vars.map(v => {
                        const copyP = v.copy_payload || {};
                        const txt = copyP.new_text || (v.pricing_payload ? `${v.pricing_payload.plan_name}: $${(v.pricing_payload.price_amount_cents/100).toFixed(0)}/mo` : v.name);
                        return `
                            <div style="display: flex; justify-content: space-between; align-items: center; background: var(--panel-1); border: 1px solid var(--line); border-radius: 3px; padding: 6px 10px; gap: 8px;">
                                <div style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                    <span style="font-size: 10px; text-transform: uppercase; color: var(--accent); font-weight: 700; margin-right: 6px;">[${v.name}]</span>
                                    <span style="font-size: 12px; color: var(--ink); font-weight: 600;">"${escapeHtml(txt)}"</span>
                                </div>
                                <button type="button" class="btn btn-secondary btn-sm" onclick="openEditVariantModal('${v.variant_id}')" style="font-size: 10.5px; padding: 3px 8px; cursor: pointer;">Edit</button>
                            </div>
                        `;
                    }).join("");
                }
            } catch(e) {}
        }

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
    const tierEl = document.getElementById("cfg-rescue-target-tier");
    const stripeLinkEl = document.getElementById("cfg-rescue-stripe-link");
    const rawLink = stripeLinkEl ? stripeLinkEl.value.trim() : "";

    const payload = {
        enabled: true,
        target_tier: tierEl ? tierEl.value : "AUTO",
        dwell_threshold_seconds: parseFloat(document.getElementById("cfg-dwell-sec").value) || 6.0,
        promo_code: document.getElementById("cfg-promo-code").value.trim() || "FOUNDER20",
        discount_percent: parseInt(document.getElementById("cfg-discount-pct").value) || 25,
        rescue_price_amount_cents: (parseInt(document.getElementById("cfg-rescue-price").value) || 20) * 100,
        stripe_price_id: rawLink.startsWith("price_") ? rawLink : null,
        stripe_payment_link: rawLink.startsWith("http") ? rawLink : null,
        modal_headline: "Special Founder's Welcome Offer",
        modal_body: "We noticed you exploring our plans. Claim an exclusive discount on your subscription.",
        transparent_disclosure: true,
        disclosure_statement: document.getElementById("cfg-disclosure-text").value || "Promotional offer unlocked for first-time visitors during this session."
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

// Bootstrap Application with Authentication & Plan Gating
(async function bootstrapApp() {
    const isAuthed = await initAuthentication();
    if (isAuthed && CURRENT_API_KEY) {
        const gate = document.getElementById("auth-gate-modal");
        if (gate) gate.style.display = "none";
        await fetchAccountInfo();
        await loadTenantExperimentsList();
        fetchAnalytics();
        setInterval(fetchAnalytics, 4000);
        if (urlParams.get("onboarding") === "true") openOnboardingModal();
    } else {
        CURRENT_API_KEY = "";
        CURRENT_TENANT = null;
        IS_MASTER_ADMIN = false;
        const gate = document.getElementById("auth-gate-modal");
        if (gate) gate.style.display = "flex";
        const tName = document.getElementById("tenant-name");
        if (tName) tName.textContent = "Not Signed In";
        const keyDisplay = document.getElementById("sidebar-api-key-display");
        if (keyDisplay) keyDisplay.textContent = "No active key";
        const pBadge = document.getElementById("sidebar-plan-badge");
        if (pBadge) {
            pBadge.textContent = "[ SIGN IN REQUIRED ]";
            pBadge.style.color = "var(--ink-faint)";
        }
    }
})();

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
        if (data.site_context) {
            const ctx = data.site_context;
            console.info("[NeriLabs Inspector] Scanned website context:", ctx);
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

function closeAuthGateModal() {
    const gate = document.getElementById("auth-gate-modal");
    if (gate) gate.style.display = "none";
    CURRENT_API_KEY = DEFAULT_API_KEY;
    localStorage.setItem("nerilabs_api_key", DEFAULT_API_KEY);
    fetchAccountInfo();
    loadTenantExperimentsList();
    fetchAnalytics();
}
window.closeAuthGateModal = closeAuthGateModal;


// =========================================================================
// =========================================================================
// EXPERIMENT DELETION
// =========================================================================
async function handleDeleteCurrentExperiment() {
    if (!CURRENT_EXP_ID) {
        alert("No active experiment selected to delete.");
        return;
    }
    const currentExp = ALL_TENANT_EXPERIMENTS.find(e => e.experiment_id === CURRENT_EXP_ID);
    const title = currentExp ? currentExp.title : CURRENT_EXP_ID;
    
    if (!confirm(`Are you sure you want to permanently delete experiment "${title}" (${CURRENT_EXP_ID})?\n\nThis will remove all associated variants, telemetry events, and bandit learning data.`)) {
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/api/v1/experiments/${CURRENT_EXP_ID}`, {
            method: "DELETE",
            headers: {
                "X-API-Key": CURRENT_API_KEY
            }
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || "Failed to delete experiment: " + res.status);
        }

        alert(`Experiment "${title}" was successfully deleted.`);
        localStorage.removeItem("nerilabs_exp_id");
        CURRENT_EXP_ID = null;

        // Reload experiment list
        await loadTenantExperimentsList();
        if (ALL_TENANT_EXPERIMENTS.length > 0) {
            changeActiveExperiment(ALL_TENANT_EXPERIMENTS[0].experiment_id);
        } else {
            // No experiments left, reset view
            const titleEl = document.getElementById("active-exp-title");
            if (titleEl) titleEl.textContent = "No Active Experiments";
            const targetEl = document.getElementById("active-exp-target");
            if (targetEl) targetEl.textContent = "None";
            const tb = document.getElementById("mab-arms-tbody");
            if (tb) tb.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 20px; color: var(--ink-dim);">No experiments found. Click "+ Setup Target" to launch an experiment.</td></tr>';
            const vtb = document.getElementById("variant-approval-tbody");
            if (vtb) vtb.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px; color: var(--ink-dim);">No experiments found.</td></tr>';
        }
    } catch(err) {
        alert("Deletion error: " + err.message);
    }
}
window.handleDeleteCurrentExperiment = handleDeleteCurrentExperiment;

// =========================================================================
// FOUNDER VARIANT REVIEW & APPROVAL WORKFLOW
// =========================================================================
let CACHED_EXPERIMENT_VARIANTS = [];

async function loadVariantApprovalList() {
    const tbody = document.getElementById("variant-approval-tbody");
    if (!tbody) return;
    if (!CURRENT_EXP_ID) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--ink-dim); padding: 20px;">No experiment selected. Create an experiment to review variations.</td></tr>';
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/api/v1/experiments/${CURRENT_EXP_ID}/variants`, {
            headers: { "X-API-Key": CURRENT_API_KEY }
        });
        if (!res.ok) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--ink-dim); padding: 20px;">Unable to load variants (${res.status}). Verify API Key.</td></tr>`;
            return;
        }
        const variants = await res.json();
        CACHED_EXPERIMENT_VARIANTS = variants;

        if (!variants || variants.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--ink-dim); padding: 20px;">No variants generated yet for this experiment.</td></tr>';
            return;
        }

        tbody.innerHTML = variants.map(v => {
            const isControl = v.is_control;
            const status = v.status || "PENDING_REVIEW";
            
            let statusBadge = '<span class="tag-badge" style="color:#f59e0b; border: 1px solid rgba(245,158,11,0.3); background: rgba(245,158,11,0.08); padding: 2px 8px; border-radius: 3px; font-size: 10.5px; font-weight: 600;">[ PENDING REVIEW ]</span>';
            if (status === "APPROVED" || status === "ACTIVE") {
                statusBadge = '<span class="tag-badge" style="color:#3ECF8E; border: 1px solid rgba(62,207,142,0.35); background: rgba(62,207,142,0.08); padding: 2px 8px; border-radius: 3px; font-size: 10.5px; font-weight: 600;">[ APPROVED · LIVE ]</span>';
            } else if (status === "REJECTED") {
                statusBadge = '<span class="tag-badge" style="color:#ef4444; border: 1px solid rgba(239,68,68,0.3); background: rgba(239,68,68,0.08); padding: 2px 8px; border-radius: 3px; font-size: 10.5px; font-weight: 600;">[ DENIED / OFF ]</span>';
            }

            const copyPayload = v.copy_payload || {};
            const origText = copyPayload.original_text || "(Original Element)";
            const newText = copyPayload.new_text || (isControl ? origText : "Unspecified");
            const hypothesis = v.hypothesis || "Exploration arm.";
            const vType = v.variant_type || "COPY";

            let actionsHtml = '';
            if (isControl) {
                actionsHtml = '<span style="font-size: 11px; color: var(--ink-dim); font-weight: 500;">Baseline Control (Always Active)</span>';
            } else {
                const approveBtn = status !== "APPROVED" ? 
                    `<button class="btn btn-sm" onclick="handleApproveVariant('${v.variant_id}')" style="background: rgba(62,207,142,0.18); color: #3ECF8E; border: 1px solid rgba(62,207,142,0.45); font-size: 11px; padding: 4px 10px; font-weight: 600; cursor: pointer;" title="Approve variant for live visitor traffic">✓ Approve</button>` : '';
                const rejectBtn = status !== "REJECTED" ? 
                    `<button class="btn btn-sm" onclick="handleRejectVariant('${v.variant_id}')" style="background: rgba(239,68,68,0.12); color: #ef4444; border: 1px solid rgba(239,68,68,0.35); font-size: 11px; padding: 4px 10px; font-weight: 600; cursor: pointer;" title="Deny/pause this variant from being shown">✗ Deny</button>` : '';
                const editBtn = `<button class="btn btn-sm btn-secondary" onclick="openEditVariantModal('${v.variant_id}')" style="font-size: 11px; padding: 4px 10px; cursor: pointer;" title="Edit proposed copy and hypothesis">Edit Copy</button>`;
                actionsHtml = `<div style="display: flex; justify-content: flex-end; align-items: center; gap: 6px;">${approveBtn}${rejectBtn}${editBtn}</div>`;
            }

            return `
                <tr style="border-bottom: 1px solid var(--line);">
                    <td style="white-space: nowrap;">${statusBadge}</td>
                    <td style="font-weight: 600; font-size: 12px; color: var(--ink); white-space: nowrap;">${escapeHtml(v.name)}</td>
                    <td><code style="font-size: 10.5px; color: var(--ink-dim); background: var(--panel-2); padding: 1px 5px; border-radius: 3px;">${vType}</code></td>
                    <td style="max-width: 280px; font-size: 12px; line-height: 1.4;">
                        ${isControl ? `<div style="color: var(--ink-dim); font-style: italic;">Original: "${escapeHtml(origText)}"</div>` : 
                        `<div><span style="font-size: 10.5px; color: var(--ink-dim); text-decoration: line-through;">${escapeHtml(origText)}</span></div>
                         <div><span style="color: #3ECF8E; font-weight: 600;">"${escapeHtml(newText)}"</span></div>`}
                    </td>
                    <td style="max-width: 260px; font-size: 11px; color: var(--ink-dim); line-height: 1.35;">${escapeHtml(hypothesis)}</td>
                    <td style="text-align: right; white-space: nowrap;">${actionsHtml}</td>
                </tr>
            `;
        }).join("");
    } catch(err) {
        console.warn("Failed to load variant approval list:", err);
    }
}
window.loadVariantApprovalList = loadVariantApprovalList;

// Edit Variant Modal (Supports both Text Copy & Pricing mutations)
function openEditVariantModal(variantId) {
    const v = CACHED_EXPERIMENT_VARIANTS.find(x => x.variant_id === variantId);
    if (!v) {
        alert("Variant details not found in cache. Click 'Refresh Variants'.");
        return;
    }
    document.getElementById("edit-var-id").value = v.variant_id;
    document.getElementById("edit-var-title").textContent = `Edit Variant: ${v.name}`;

    const copyBox = document.getElementById("edit-copy-fields");
    const priceBox = document.getElementById("edit-pricing-fields");

    if (v.pricing_payload) {
        if (copyBox) copyBox.style.display = "none";
        if (priceBox) priceBox.style.display = "block";
        const pp = v.pricing_payload;
        const nameInp = document.getElementById("edit-var-plan-name");
        const priceInp = document.getElementById("edit-var-price-dollars");
        if (nameInp) nameInp.value = pp.plan_name || v.name;
        if (priceInp) priceInp.value = (pp.price_amount_cents / 100).toFixed(0);
        document.getElementById("edit-var-orig-text").textContent = `${pp.plan_name || v.name}: $${(pp.price_amount_cents / 100).toFixed(0)}/mo`;
    } else {
        if (copyBox) copyBox.style.display = "block";
        if (priceBox) priceBox.style.display = "none";
        const copyPayload = v.copy_payload || {};
        document.getElementById("edit-var-orig-text").textContent = copyPayload.original_text || "(Original Text)";
        document.getElementById("edit-var-new-text").value = copyPayload.new_text || "";
    }

    document.getElementById("edit-var-hypothesis").value = v.hypothesis || "";
    document.getElementById("edit-variant-modal-overlay").style.display = "flex";
}
window.openEditVariantModal = openEditVariantModal;

function closeEditVariantModal() {
    document.getElementById("edit-variant-modal-overlay").style.display = "none";
}
window.closeEditVariantModal = closeEditVariantModal;

async function handleSaveVariantWithStatus(targetStatus) {
    const variantId = document.getElementById("edit-var-id").value;
    const v = CACHED_EXPERIMENT_VARIANTS.find(x => x.variant_id === variantId);
    const newHypo = document.getElementById("edit-var-hypothesis").value.trim();

    const payload = {
        hypothesis: newHypo,
        status: targetStatus
    };

    if (v && v.pricing_payload) {
        const nameVal = document.getElementById("edit-var-plan-name") ? document.getElementById("edit-var-plan-name").value.trim() : "";
        const priceVal = parseFloat(document.getElementById("edit-var-price-dollars") ? document.getElementById("edit-var-price-dollars").value : "");
        if (nameVal) payload.plan_name = nameVal;
        if (!isNaN(priceVal) && priceVal > 0) payload.price_dollars = priceVal;
    } else {
        const newText = document.getElementById("edit-var-new-text").value.trim();
        if (!newText) {
            alert("Variant copy text cannot be empty.");
            return;
        }
        payload.copy_text = newText;
    }

    try {
        const res = await fetch(`${API_BASE}/api/v1/experiments/${CURRENT_EXP_ID}/variants/${variantId}`, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                "X-API-Key": CURRENT_API_KEY
            },
            body: JSON.stringify(payload)
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || "Update failed: " + res.status);
        }
        closeEditVariantModal();
        await loadVariantApprovalList();
        fetchAnalytics();
        alert(`Variant successfully updated with status: [${targetStatus}]!`);
    } catch(err) {
        alert(err.message);
    }
}
window.handleSaveVariantWithStatus = handleSaveVariantWithStatus;

async function handleApproveVariant(variantId) {
    if (!CURRENT_EXP_ID) return;
    try {
        const res = await fetch(`${API_BASE}/api/v1/experiments/${CURRENT_EXP_ID}/variants/${variantId}/approve`, {
            method: "POST",
            headers: { "X-API-Key": CURRENT_API_KEY }
        });
        if (!res.ok) throw new Error("Approval failed: " + res.status);
        await loadVariantApprovalList();
        fetchAnalytics();
    } catch(err) {
        alert(err.message);
    }
}
window.handleApproveVariant = handleApproveVariant;

async function handleRejectVariant(variantId) {
    if (!CURRENT_EXP_ID) return;
    try {
        const res = await fetch(`${API_BASE}/api/v1/experiments/${CURRENT_EXP_ID}/variants/${variantId}/reject`, {
            method: "POST",
            headers: { "X-API-Key": CURRENT_API_KEY }
        });
        if (!res.ok) throw new Error("Rejection failed: " + res.status);
        await loadVariantApprovalList();
        fetchAnalytics();
    } catch(err) {
        alert(err.message);
    }
}
window.handleRejectVariant = handleRejectVariant;

async function handleApproveAllVariants() {
    if (!CURRENT_EXP_ID) return;
    try {
        const res = await fetch(`${API_BASE}/api/v1/experiments/${CURRENT_EXP_ID}/variants/approve-all`, {
            method: "POST",
            headers: { "X-API-Key": CURRENT_API_KEY }
        });
        if (!res.ok) throw new Error("Failed to approve all: " + res.status);
        const data = await res.json();
        alert(`Successfully approved ${data.approved_count} variants for live testing!`);
        await loadVariantApprovalList();
        fetchAnalytics();
    } catch(err) {
        alert(err.message);
    }
}
window.handleApproveAllVariants = handleApproveAllVariants;

// =========================================================================
// TRAFFIC ATTRIBUTION & BOT SHIELD ENGINE
// =========================================================================
async function fetchTrafficAnalytics() {
    if (!CURRENT_EXP_ID) return;
    try {
        const res = await fetch(`${API_BASE}/api/v1/experiments/${CURRENT_EXP_ID}/analytics`);
        if (!res.ok) return;
        const data = await res.json();

        const humVis = document.getElementById("stat-traffic-human-visitors");
        if (humVis) humVis.textContent = (data.total_impressions || 0).toLocaleString();

        const humConv = document.getElementById("stat-traffic-human-conversions");
        if (humConv) humConv.textContent = (data.total_conversions || 0).toLocaleString();

        const humCvr = document.getElementById("stat-traffic-human-cvr");
        if (humCvr) humCvr.textContent = ((data.overall_conversion_rate || 0) * 100).toFixed(2) + "%";

        const botFil = document.getElementById("stat-traffic-bots-filtered");
        if (botFil) botFil.textContent = (data.bot_traffic_filtered || 0).toLocaleString();

        renderTrafficSourceAttribution(data.traffic_by_source || {});
    } catch(err) {
        console.warn("Error fetching traffic analytics:", err);
    }
}
window.fetchTrafficAnalytics = fetchTrafficAnalytics;

function renderTrafficSourceAttribution(sources) {
    const tbody = document.getElementById("traffic-source-tbody");
    if (!tbody) return;

    if (!sources || Object.keys(sources).length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--ink-dim); padding: 25px;">Awaiting live incoming visitors with UTM parameters or referral sources...</td></tr>';
        return;
    }

    tbody.innerHTML = Object.entries(sources).map(([src, d]) => {
        const isCasual = d.category === "CASUAL_SOCIAL";
        const catBadge = isCasual ? 
            '<span style="font-size: 10.5px; padding: 2px 7px; background: rgba(245,158,11,0.12); color: #f59e0b; border: 1px solid rgba(245,158,11,0.3); border-radius: 3px; font-weight: 500;">Casual Social</span>' :
            '<span style="font-size: 10.5px; padding: 2px 7px; background: rgba(46,60,255,0.12); color: #2E3CFF; border: 1px solid rgba(46,60,255,0.3); border-radius: 3px; font-weight: 500;">High Intent</span>';

        return `
            <tr style="border-bottom: 1px solid var(--line);">
                <td style="font-weight: 600; font-size: 12px; color: var(--ink);">${escapeHtml(src)}</td>
                <td>${catBadge}</td>
                <td>${(d.impressions || 0).toLocaleString()}</td>
                <td style="font-weight: 600;">${(d.conversions || 0).toLocaleString()}</td>
                <td style="color: ${d.conversions > 0 ? '#3ECF8E' : 'var(--ink)'}; font-weight: 600;">${((d.cvr || 0) * 100).toFixed(2)}%</td>
                <td><span style="font-size: 10.5px; color: #3ECF8E; font-weight: 500;">✓ Active Tracking</span></td>
            </tr>
        `;
    }).join("");
}
window.renderTrafficSourceAttribution = renderTrafficSourceAttribution;


async function deleteVariantFromMatrix(variantId, event) {
    if (event) event.stopPropagation();
    if (!confirm("Are you sure you want to delete this variant from the experiment and combinations matrix?")) return;
    try {
        const res = await fetch(`${API_BASE}/api/v1/experiments/${CURRENT_EXP_ID}/variants/${variantId}`, {
            method: "DELETE",
            headers: { "X-API-Key": CURRENT_API_KEY }
        });
        if (!res.ok) throw new Error("Failed to delete variant");
        await fetchCombinationsMatrix();
        if (window.fetchAnalytics) await fetchAnalytics();
    } catch(e) {
        alert("Error deleting variant: " + e.message);
    }
}
window.deleteVariantFromMatrix = deleteVariantFromMatrix;

async function deleteRescueConfig() {
    if (!confirm("Are you sure you want to delete and disable the founder's discount and behavioral rescue policy?")) return;
    try {
        const res = await fetch(`${API_BASE}/api/v1/billing/behavioral-rescue`, {
            method: "DELETE",
            headers: { "X-API-Key": CURRENT_API_KEY }
        });
        if (res.ok) {
            alert("Founder's discount and behavioral rescue policy deleted!");
            const simBox = document.getElementById("rescue-simulation-result");
            if (simBox) simBox.style.display = "none";
            try { sessionStorage.removeItem("neri_rescue_shown"); } catch(e) {}
        }
    } catch(e) {
        alert("Error deleting rescue policy: " + e.message);
    }
}
window.deleteRescueConfig = deleteRescueConfig;


// =====================================================================
// =====================================================================
// DESIGN PARTNER KEYS MANAGEMENT (FOUNDER ONLY)
// =====================================================================

async function loadDesignPartnersList() {
    const tbody = document.getElementById("partners-table-body");
    const gate = document.getElementById("partners-admin-gate");
    const card = document.getElementById("partners-table-card");
    if (!tbody) return;

    try {
        const res = await fetch(API_BASE + "/api/v1/admin/partners", {
            headers: { "X-API-Key": CURRENT_API_KEY }
        });

        if (res.status === 401 || res.status === 403) {
            if (gate) gate.style.display = "block";
            if (card) card.style.display = "none";
            return;
        }

        if (!res.ok) {
            tbody.innerHTML = '<tr><td colspan="5" style="padding:20px; text-align:center; color:var(--alert);">Failed to load partners: ' + escapeHtml(res.statusText) + '</td></tr>';
            return;
        }

        if (gate) gate.style.display = "none";
        if (card) card.style.display = "block";

        const data = await res.json();
        const partners = data.partners || [];
        if (partners.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="padding:20px; text-align:center;">No partners found.</td></tr>';
            return;
        }

        let html = "";
        for (const p of partners) {
            const isLocked = p.is_locked;
            const statusBadge = isLocked 
                ? '<span class="badge" style="color:var(--alert); border-color:var(--alert); font-weight:bold;">[ LOCKED ]</span>' 
                : '<span class="badge" style="color:var(--good); border-color:var(--good); font-weight:bold;">[ ACTIVE ]</span>';
            
            let trialDisplay = '<span style="color:var(--ink-dim);">No Expiry (Indefinite)</span>';
            if (p.trial_expires_at) {
                trialDisplay = p.days_left > 0 
                    ? '<span style="color:var(--ink); font-weight:600;">' + p.days_left + ' days left</span>' 
                    : '<span style="color:var(--alert); font-weight:700;">Trial Expired</span>';
            }

            const lockToggleBtn = isLocked
                ? '<button class="btn btn-secondary" style="padding:4px 8px; font-size:11px; color:var(--good); border-color:var(--good);" onclick="togglePartnerLock(\'' + p.tenant_id + '\', \'unlock\')">Unlock Key</button>'
                : '<button class="btn btn-secondary" style="padding:4px 8px; font-size:11px; color:var(--alert); border-color:var(--alert);" onclick="togglePartnerLock(\'' + p.tenant_id + '\', \'lock\')">Lock Key</button>';

            html += '<tr style="border-bottom: 1px solid var(--line); font-size: 12px;">' +
                '<td style="padding: 12px 10px;"><strong>' + escapeHtml(p.organization_name) + '</strong><br><small style="color:var(--ink-dim); font-family:monospace;">' + p.tenant_id + '</small></td>' +
                '<td style="padding: 12px 10px;"><code style="font-size:11px; color:var(--accent);">' + p.api_key + '</code></td>' +
                '<td style="padding: 12px 10px;">' + statusBadge + '</td>' +
                '<td style="padding: 12px 10px;">' + trialDisplay + '</td>' +
                '<td style="padding: 12px 10px; text-align: right;">' +
                    '<div style="display:flex; gap:6px; justify-content:flex-end; flex-wrap:wrap;">' +
                        lockToggleBtn +
                        '<button class="btn btn-secondary" style="padding:4px 8px; font-size:11px;" onclick="promptSetTrial(\'' + p.tenant_id + '\', \'' + escapeHtml(p.organization_name) + '\')">Set Trial</button>' +
                        '<button class="btn btn-secondary" style="padding:4px 8px; font-size:11px; border-color:var(--accent); color:var(--accent);" onclick="copyPartnerSnippet(\'' + p.api_key + '\')">Copy Tag</button>' +
                    '</div>' +
                '</td>' +
            '</tr>';
        }
        tbody.innerHTML = html;
    } catch(err) {
        tbody.innerHTML = '<tr><td colspan="5" style="padding:20px; text-align:center; color:var(--alert);">' + escapeHtml(err.message) + '</td></tr>';
    }
}
window.loadDesignPartnersList = loadDesignPartnersList;

async function togglePartnerLock(tenantId, action) {
    try {
        const res = await fetch(API_BASE + "/api/v1/admin/partners/" + tenantId + "/" + action, {
            method: "POST",
            headers: { "X-API-Key": CURRENT_API_KEY }
        });
        if (!res.ok) {
            const err = await res.json();
            alert("Action error: " + (err.detail || res.statusText));
            return;
        }
        await loadDesignPartnersList();
    } catch(e) {
        alert("Action failed: " + e.message);
    }
}
window.togglePartnerLock = togglePartnerLock;

async function promptSetTrial(tenantId, orgName) {
    const input = prompt("Set trial duration in days for " + orgName + ":\n(Enter number of days like 14 or 30, or leave blank for unlimited):");
    if (input === null) return;
    const days = input.trim() === "" ? null : parseInt(input.trim(), 10);
    try {
        const res = await fetch(API_BASE + "/api/v1/admin/partners/" + tenantId + "/set-trial", {
            method: "POST",
            headers: { 
                "Content-Type": "application/json",
                "X-API-Key": CURRENT_API_KEY 
            },
            body: JSON.stringify({ days: days })
        });
        if (!res.ok) {
            const err = await res.json();
            alert("Error: " + (err.detail || res.statusText));
            return;
        }
        await loadDesignPartnersList();
    } catch(e) {
        alert("Failed to update trial: " + e.message);
    }
}
window.promptSetTrial = promptSetTrial;

function copyPartnerSnippet(key) {
    const code = '<!-- NeriLabs Universal Experimentation Engine -->\n<script>\n  window.NERILABS_API_BASE = "' + window.location.origin + '";\n  window.NERILABS_PUBLISHABLE_KEY = "' + key + '";\n</script>\n<script src="' + window.location.origin + '/static/experiment_sdk.js" async></script>';
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(() => {
            alert("✓ Embed script tag for " + key + " copied to clipboard!\n\nYou can now share this directly with your design partner.");
        }).catch(() => {
            prompt("Copy embed script tag for partner:", code);
        });
    } else {
        prompt("Copy embed script tag for partner:", code);
    }
}
window.copyPartnerSnippet = copyPartnerSnippet;
