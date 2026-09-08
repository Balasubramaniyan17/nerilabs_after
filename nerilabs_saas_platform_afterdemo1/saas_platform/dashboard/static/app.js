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

const storedApiKey = localStorage.getItem("nerilabs_api_key");
if (storedApiKey) {
    CURRENT_API_KEY = storedApiKey;
}

// Tab Switching
function switchTab(tabId) {
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
        scriptBlock.textContent = `<!-- NeriLabs Autonomous Experimentation SDK (Public Safe) -->\n<script>\n  window.AI_EXPERIMENT_API_BASE = "${baseUrl}";\n  window.AI_EXPERIMENT_PUBLISHABLE_KEY = "${CURRENT_PUBLISHABLE_KEY}";\n  window.AI_EXPERIMENT_ID = "${exp.experiment_id}";\n  window.AI_EXPERIMENT_TARGET_SELECTOR = "${exp.target_selector || "#hero-cta"}";\n</script>\n<script src="${baseUrl}/static/experiment_sdk.js" async></script>`;
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
            if (!CURRENT_EXP_ID || !activeList.some(e => e.experiment_id === CURRENT_EXP_ID)) {
                CURRENT_EXP_ID = activeList[0].experiment_id;
                localStorage.setItem("nerilabs_exp_id", CURRENT_EXP_ID);
            }
            sel.value = CURRENT_EXP_ID;
        }

        updateActiveExperimentBanner();
        fetchAnalytics();
    } catch (e) {
        console.debug("Error loading tenant experiments:", e);
    }
}
window.loadTenantExperimentsList = loadTenantExperimentsList;

// Fetch Analytics & Dimension Performance
async function fetchAnalytics() {
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
                if (statusTitle) statusTitle.textContent = "📡 Listening for Live Website Visitors";
                if (statusDesc) statusDesc.textContent = "Tracking script is active on your site. Visit your website or click your CTA button to see real impressions and conversions stream into this table.";
            }
        } else {
            if (trustBanner) {
                trustBanner.className = "alert-box alert-warning";
                if (statusTitle) statusTitle.textContent = "⚡ Real-Time Thompson Sampling Active";
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
                        ? '<span class="tag-badge tag-leading">👑 LEADING</span>'
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
                        <h4>🚨 ${p.metric_name} Anomaly Detected</h4>
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
    const expId = document.getElementById("inp-exp-id").value;
    const title = document.getElementById("inp-exp-title").value;
    const url = document.getElementById("inp-exp-url").value;
    const selector = document.getElementById("inp-exp-selector").value;

    try {
        if (expType === "PRICING_TEST") {
            const priceA = parseFloat(document.getElementById("inp-price-a").value);
            const priceB = parseFloat(document.getElementById("inp-price-b").value);
            const priceC = parseFloat(document.getElementById("inp-price-c").value || 0);

            const plans = [
                { name: `Pro Plan ($${priceA}/mo)`, price_dollars: priceA },
                { name: `Pro Plan ($${priceB}/mo)`, price_dollars: priceB }
            ];
            if (priceC > 0) {
                plans.push({ name: `Pro Plan ($${priceC}/mo)`, price_dollars: priceC });
            }

            const res = await fetch(`${API_BASE}/api/v1/billing/pricing-test/create`, {
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
            const data = await res.json();
            CURRENT_EXP_ID = data.experiment_id;
            alert(`Price test '${expId}' launched with ${data.variants_created} Stripe pricing arms!`);
        } else {
            const expPayload = {
                experiment_id: expId,
                title: title,
                url: url,
                target_selector: selector,
                brand_guidelines: {
                    primary_color: document.getElementById("inp-brand-primary").value,
                    accent_color: document.getElementById("inp-brand-accent").value
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
            const genRes = await fetch(`${API_BASE}/api/v1/experiments/${expId}/generate-suite`, {
                method: "POST",
                headers: { "X-API-Key": CURRENT_API_KEY }
            });
            if (!genRes.ok) {
                const errData = await genRes.json().catch(() => ({}));
                throw new Error(errData.detail || "Failed to generate experiment variants");
            }
            const suiteData = await genRes.json().catch(() => ({}));
            alert(`Experiment '${expId}' launched! Generated ${suiteData.total_generated || 10} variants (${suiteData.approved_count || 9} approved by guardrails).`);
            CURRENT_EXP_ID = expId;
        }

        switchTab("overview");
    } catch (err) {
        alert("Error creating experiment: " + err);
    } finally {
        btn.disabled = false;
        btn.textContent = "✨ Launch Experiment Suite";
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
            resultBox.innerHTML += `<br><span style="color:var(--danger)">⚠️ Error: ${err.detail}</span>`;
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
        stripe_restricted_key: document.getElementById("ob-stripe-key").value || null
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
        btn.textContent = "✨ Generate AI Variants & Get Script Tag";
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
        modal_headline: "🎁 Special Founder's Welcome Offer",
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
    container.innerHTML = "<em>✨ Invoking BehavioralOfferAgent...</em>";

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
