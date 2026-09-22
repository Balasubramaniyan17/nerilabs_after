/**
 * NeriLabs Universal Autonomous Experimentation Client SDK (v3.3 Production)
 * - Single-install 1-time script tag (Universal Multi-Element Engine)
 * - Precision Element Filtering: Solves multi-link selectors (.nav-links a) by matching exact target text
 * - Authentic Conversion Boundary: Tracks clicks to checkout/pricing/plan selection, preventing false clicks on nav links
 * - Balanced 50/50 Control vs Variant distribution across visitors
 * - Zero-flicker element mutation for variants; untouched original DOM for Control
 * - Real-time reliable telemetry beacon streaming for impressions & conversions
 * - Asynchronous DOM observation (MutationObserver) for React, Next.js, Webflow & Vue
 * - Query-parameter live preview (?neri_preview=...)
 */
(function() {
    'use strict';

    const CONFIG = {
        apiBase: window.NERILABS_API_BASE || window.AI_EXPERIMENT_API_BASE || "https://app.nerilabs.io",
        publishableKey: window.NERILABS_PUBLISHABLE_KEY || window.AI_EXPERIMENT_PUBLISHABLE_KEY || "nerilabs_pk_live_9a8b7c6d5e4f3a2b1c",
        experimentId: window.AI_EXPERIMENT_ID || "",
        targetSelector: window.AI_EXPERIMENT_TARGET_SELECTOR || ""
    };

    let currentTenantId = window.NERILABS_TENANT_ID || "";
    let activeAssignments = [];

    // Check for forced live preview parameter in URL (?neri_preview=...)
    const urlParams = new URLSearchParams(window.location.search);
    const previewParam = urlParams.get("neri_preview") || urlParams.get("neri_variant");

    // Visitor & Session Identity
    function getCookie(name) {
        const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
        return match ? match[2] : null;
    }

    function setCookie(name, val, days) {
        const d = new Date();
        d.setTime(d.getTime() + (days * 24 * 60 * 60 * 1000));
        document.cookie = `${name}=${val};path=/;expires=${d.toUTCString()};SameSite=Lax`;
    }

    let visitorId = getCookie("neri_vid") || localStorage.getItem("neri_vid");
    if (!visitorId) {
        visitorId = "vis_" + Math.random().toString(36).substring(2, 12);
        setCookie("neri_vid", visitorId, 365);
        try { localStorage.setItem("neri_vid", visitorId); } catch(e) {}
    }

    let sessionId = sessionStorage.getItem("neri_sid");
    if (!sessionId) {
        sessionId = "sess_" + Math.random().toString(36).substring(2, 12);
        try { sessionStorage.setItem("neri_sid", sessionId); } catch(e) {}
    }

    // Precise target element discovery with text disambiguation
    function resolveTargetElements(assignment) {
        let els = [];
        const selector = assignment.target_selector;
        if (selector) {
            try {
                els = Array.from(document.querySelectorAll(selector));
            } catch(e) {}
        }

        if (els.length === 0) {
            const isPricingExp = assignment.payload && assignment.payload.pricing_payload;
            const cascade = isPricingExp ? [
                ".price-card .price-amount",
                ".pricing-grid .price-amount",
                ".price-amount",
                "#pricing .price-amount",
                ".cost",
                ".price"
            ] : [
                "#primary-cta",
                "#hero-cta",
                ".hero-ctas .btn-primary",
                ".hero-ctas .btn",
                ".price-card.entry .btn",
                ".price-card .btn",
                ".btn-primary",
                "#navActionBtn"
            ];
            for (const sel of cascade) {
                try {
                    const cands = Array.from(document.querySelectorAll(sel));
                    if (cands.length > 0) {
                        els = cands;
                        break;
                    }
                } catch(err) {}
            }
        }

        const expectedText = (assignment.target_text || 
                             (assignment.payload && assignment.payload.copy_payload && assignment.payload.copy_payload.original_text) || 
                             "").trim().toLowerCase();

        // Disambiguate when a selector matches multiple elements (e.g. .nav-links a)
        if (els.length > 1) {
            if (expectedText) {
                const matched = els.filter(el => {
                    const elText = (el.innerText || el.textContent || "").trim().toLowerCase();
                    return elText === expectedText || elText.includes(expectedText) || expectedText.includes(elText);
                });
                if (matched.length > 0) {
                    return [matched[0]]; // Target only the intended link (e.g. Pricing), leaving other links untouched!
                }
            }
            return [els[0]]; // Default to first element to prevent mutating all navigation items
        }

        return els;
    }

    
    // 1. Bot & Automated Crawler Detection (Isolate non-human traffic)
    function isBotTraffic() {
        if (navigator.webdriver) return true;
        const ua = (navigator.userAgent || "").toLowerCase();
        const botPatterns = [
            "bot", "crawler", "spider", "crawling", "googlebot", "bingbot",
            "slurp", "duckduckbot", "baiduspider", "yandexbot", "sogou",
            "exabot", "facebot", "facebookexternalhit", "ia_archiver",
            "bytespider", "claudebot", "gptbot", "chatgpt", "anthropic",
            "perplexity", "headlesschrome", "lighthouse", "pingdom",
            "phantomjs", "selenium", "puppeteer", "playwright"
        ];
        for (let i = 0; i < botPatterns.length; i++) {
            if (ua.indexOf(botPatterns[i]) !== -1) return true;
        }
        if (window._phantom || window.__nightmare || window.callPhantom) return true;
        if (window.outerWidth === 0 && window.outerHeight === 0) return true;
        return false;
    }

    // 2. Traffic Source & UTM Attribution Capture
    function getTrafficSourceInfo() {
        let params = new URLSearchParams(window.location.search);
        let utmSource = params.get("utm_source") || "";
        let utmMedium = params.get("utm_medium") || "";
        let utmCampaign = params.get("utm_campaign") || "";
        let utmTerm = params.get("utm_term") || "";
        let utmContent = params.get("utm_content") || "";

        let referrer = document.referrer || "";
        let source = utmSource;
        if (!source && referrer) {
            try {
                let refHost = new URL(referrer).hostname.toLowerCase();
                if (refHost.includes("google")) source = "Google";
                else if (refHost.includes("instagram")) source = "Instagram";
                else if (refHost.includes("facebook") || refHost.includes("fb.com")) source = "Facebook";
                else if (refHost.includes("linkedin")) source = "LinkedIn";
                else if (refHost.includes("twitter") || refHost.includes("t.co") || refHost.includes("x.com")) source = "X/Twitter";
                else if (refHost.includes("tiktok")) source = "TikTok";
                else if (refHost.includes("reddit")) source = "Reddit";
                else if (refHost.includes("youtube")) source = "YouTube";
                else source = refHost;
            } catch(e) {
                source = "Referral";
            }
        }
        if (!source) source = "Direct";

        return {
            source: source,
            utm_source: utmSource || source,
            utm_medium: utmMedium,
            utm_campaign: utmCampaign,
            utm_term: utmTerm,
            utm_content: utmContent,
            referrer: referrer,
            source_category: (source.toLowerCase().includes("instagram") || source.toLowerCase().includes("tiktok") || source.toLowerCase().includes("facebook")) ? "CASUAL_SOCIAL" : (source.toLowerCase().includes("google") || source.toLowerCase().includes("linkedin")) ? "HIGH_INTENT" : "DIRECT_OR_ORGANIC"
        };
    }

// Event Ingestion Queue
    const eventQueue = [];

    function queueEvent(expId, token, opaqueId, type, payload = {}, tenantId = "") {
        eventQueue.push({
            event_id: "evt_" + Math.random().toString(36).substring(2, 10),
            event_type: type,
            experiment_id: expId,
            tenant_id: tenantId || currentTenantId || "",
            opaque_variant_id: opaqueId || "unknown",
            visitor_id: visitorId,
            session_id: sessionId,
            signed_token: token || "untokenized",
            timestamp: Date.now() / 1000,
            metadata: Object.assign({}, payload || {}, getTrafficSourceInfo(), {
                is_bot: isBotTraffic()
            })
        });
    }

    
    // -------------------------------------------------------------
    // Behavioral Rescue & Live Promotional Concession Engine
    // -------------------------------------------------------------
    let rescueModalRendered = false;

    function handlePromotionalRescueAction(action, newToken) {
        if (!action || rescueModalRendered || sessionStorage.getItem("neri_rescue_shown")) return;
        rescueModalRendered = true;
        sessionStorage.setItem("neri_rescue_shown", "true");

        // 1. In-place Token Escalation
        if (newToken) {
            sessionStorage.setItem(`neri_token_${action.experiment_id || ""}`, newToken);
        }

        // 2. Reduce the Price Live in the Page DOM (Strictly scoped to the target plan under test)
        if (action.discounted_price_formatted) {
            const targetAssign = (activeAssignments && activeAssignments.length > 0) ? (activeAssignments.find(a => a.payload && a.payload.pricing_payload) || activeAssignments[0]) : null;
            if (targetAssign) {
                const isButtonOrLink = (node) => {
                    if (!node || !node.tagName) return false;
                    const tag = node.tagName.toLowerCase();
                    if (tag === "button" || tag === "a" || tag === "input") return true;
                    const cls = (node.className || "").toLowerCase();
                    return cls.includes("btn") || cls.includes("button") || cls.includes("cta");
                };

                const pSel = (targetAssign.payload && targetAssign.payload.pricing_payload && targetAssign.payload.pricing_payload.price_selector) || ".price-card.mid .price-amount, .price-card .price-amount, .price-amount";
                let targetEls = Array.from(document.querySelectorAll(pSel)).filter(m => !isButtonOrLink(m));
                if (targetEls.length === 0) {
                    targetEls = resolveTargetElements(targetAssign).filter(m => !isButtonOrLink(m));
                }

                targetEls.forEach(el => {
                    const oldPrice = el.getAttribute("data-neri-price") || el.innerText.replace(/\/mo.*/, "").trim() || "$99";
                    el.innerHTML = `<span style="text-decoration: line-through; opacity: 0.5; font-size: 0.85em; margin-right: 6px;">${oldPrice}</span><span style="color: #3ECF8E; font-weight: 700;">${action.discounted_price_formatted}</span><span style="font-size:0.4em; opacity:0.75;">/mo</span>`;
                    el.setAttribute("data-neri-discounted", "true");
                });

                // Update only the targeted button's checkout attributes, preserving its label text
                const btnSelector = (targetAssign.payload && targetAssign.payload.pricing_payload && targetAssign.payload.pricing_payload.button_selector) || ".btn";
                try {
                    const cardContainer = targetEls.length > 0 ? targetEls[0].closest(".price-card, .card, [class*='tier'], [class*='plan']") : null;
                    const btnEls = cardContainer ? Array.from(cardContainer.querySelectorAll(btnSelector)) : Array.from(document.querySelectorAll(btnSelector));
                    btnEls.forEach(btn => {
                        btn.setAttribute("data-neri-discounted-price", action.discounted_price_formatted);
                        if (action.promo_code) btn.setAttribute("data-promo-code", action.promo_code);
                        if (action.stripe_price_id) btn.setAttribute("data-stripe-price", action.stripe_price_id);
                    });
                } catch(e) {}
            }
        }

        // 3. Render Sleek Modal
        const overlay = document.createElement("div");
        overlay.id = "neri-promotional-rescue-modal";
        overlay.style.cssText = "position: fixed; inset: 0; background: rgba(5,5,5,0.85); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; z-index: 9999999; animation: neriFadeIn 0.3s ease-out;";

        overlay.innerHTML = `
            <div style="background: #0d0f12; border: 1px solid rgba(62,207,142,0.45); box-shadow: 0 20px 50px rgba(0,0,0,0.8), 0 0 30px rgba(62,207,142,0.15); border-radius: 8px; max-width: 440px; width: 90%; padding: 28px 24px; text-align: center; color: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; position: relative;">
                <button id="neri-close-rescue" style="position: absolute; top: 12px; right: 14px; background: none; border: none; color: #64748b; font-size: 18px; cursor: pointer; padding: 4px;">✕</button>
                <div style="display: inline-block; padding: 4px 12px; background: rgba(62,207,142,0.12); border: 1px solid rgba(62,207,142,0.35); border-radius: 20px; color: #3ECF8E; font-size: 11px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 12px;">
                    ⭐ Special Founder Grant Applied
                </div>
                <h3 style="font-size: 20px; font-weight: 700; margin: 0 0 10px; color: #f8fafc; line-height: 1.3;">
                    ${action.modal_headline || "Claim Exclusive Promotional Grant"}
                </h3>
                <p style="font-size: 13.5px; color: #94a3b8; line-height: 1.5; margin: 0 0 18px;">
                    ${action.modal_body || "We noticed you exploring our tiers! Activate your personalized grant for an instant discount."}
                </p>
                <div style="background: #161a22; border: 1px dashed rgba(62,207,142,0.4); border-radius: 6px; padding: 12px; margin-bottom: 20px; display: flex; justify-content: space-around; align-items: center;">
                    <div>
                        <span style="font-size: 10.5px; color: #64748b; display: block; text-transform: uppercase;">Promo Code</span>
                        <code style="font-size: 15px; font-weight: 700; color: #3ECF8E; font-family: monospace;">${action.promo_code || "FOUNDER20"}</code>
                    </div>
                    <div style="border-left: 1px solid #334155; height: 28px;"></div>
                    <div>
                        <span style="font-size: 10.5px; color: #64748b; display: block; text-transform: uppercase;">Your Price</span>
                        <strong style="font-size: 17px; color: #fff;">${action.discounted_price_formatted || "25% OFF"}</strong>
                    </div>
                </div>
                <button id="neri-claim-rescue-btn" style="width: 100%; padding: 13px 20px; background: #3ECF8E; color: #042f1a; border: none; border-radius: 6px; font-size: 14px; font-weight: 700; cursor: pointer; box-shadow: 0 4px 14px rgba(62,207,142,0.35); transition: transform 0.15s ease;">
                    ${action.cta_text || "Claim Offer & Checkout →"}
                </button>
                ${action.disclosure_statement ? `<p style="font-size: 10px; color: #475569; margin-top: 14px; margin-bottom: 0;">${action.disclosure_statement}</p>` : ''}
            </div>
        `;

        document.body.appendChild(overlay);

        document.getElementById("neri-close-rescue").addEventListener("click", () => {
            overlay.remove();
        });

        document.getElementById("neri-claim-rescue-btn").addEventListener("click", () => {
            overlay.remove();
            if (activeAssignments && activeAssignments.length > 0) {
                recordConversion(activeAssignments[0]);
            }
            // Trigger primary checkout action
            const primaryCTA = document.querySelector(".btn-primary, .plan-cta, .price-card .btn, #hero-cta");
            if (primaryCTA) primaryCTA.click();
        });
    }

    // Monitor live dwell hesitation & exit intent
    function setupBehavioralFrictionMonitors() {
        let dwellSeconds = 0;
        const dwellInterval = setInterval(() => {
            dwellSeconds += 2;
            if (dwellSeconds >= 8 && activeAssignments.length > 0 && !sessionStorage.getItem("neri_rescue_shown")) {
                clearInterval(dwellInterval);
                queueEvent(
                    activeAssignments[0].experiment_id,
                    activeAssignments[0].signed_token,
                    activeAssignments[0].opaque_variant_id,
                    "DWELL",
                    { dwell_duration: dwellSeconds, hovered_element: "Pricing Table" },
                    activeAssignments[0].tenant_id
                );
                flushBeacon();
            }
        }, 2000);

        // Exit intent detection (cursor leaving window)
        document.addEventListener("mouseleave", function(e) {
            if (e.clientY <= 0 && activeAssignments.length > 0 && !sessionStorage.getItem("neri_rescue_shown")) {
                queueEvent(
                    activeAssignments[0].experiment_id,
                    activeAssignments[0].signed_token,
                    activeAssignments[0].opaque_variant_id,
                    "DWELL",
                    { is_exit_intent: true, dwell_duration: dwellSeconds },
                    activeAssignments[0].tenant_id
                );
                flushBeacon();
            }
        });
    }

function flushBeacon() {
        if (eventQueue.length === 0) return;
        const batch = eventQueue.splice(0, eventQueue.length);
        const endpoint = `${CONFIG.apiBase}/api/v1/telemetry/beacon`;
        const payloadStr = JSON.stringify({ 
            tenant_id: currentTenantId || "",
            events: batch 
        });

        fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Publishable-Key": CONFIG.publishableKey
            },
            credentials: "omit",
            body: payloadStr,
            keepalive: true
        })
        .then(res => res.json())
        .then(data => {
            if (data && data.rescue_action) {
                handlePromotionalRescueAction(data.rescue_action, data.new_token);
            }
        })
        .catch(() => {
            if (navigator.sendBeacon) {
                try {
                    const blob = new Blob([payloadStr], { type: "application/json" });
                    navigator.sendBeacon(endpoint, blob);
                } catch(e) {}
            }
        });
    }

    // Conversion Triggering Helper
    function recordConversion(assignment, clickedEl) {
        queueEvent(
            assignment.experiment_id,
            assignment.signed_token,
            assignment.opaque_variant_id,
            "CONVERSION",
            {
                clicked_tag: clickedEl ? clickedEl.tagName : "BUTTON",
                clicked_text: clickedEl ? (clickedEl.innerText || clickedEl.textContent || "").substring(0, 40).trim() : "Checkout Click",
                selector: assignment.target_selector
            },
            assignment.tenant_id
        );
        flushBeacon();
        console.info(`[NeriLabs Telemetry] Conversion recorded for "${assignment.experiment_id}" on "${assignment.variant_name}"`);
    }

    // Check if clicked element represents an actual checkout / plan selection action
    function isCheckoutConversionAction(el) {
        if (!el) return false;
        if (el.hasAttribute("data-neri-convert") || el.hasAttribute("data-plan")) return true;
        if (el.classList.contains("plan-cta")) return true;
        if (el.closest(".price-card")) return true;

        const href = (el.getAttribute("href") || "").toLowerCase();
        if (href.includes("checkout") || href.includes("stripe") || href.includes("signup") || href.includes("subscribe")) return true;

        const text = (el.innerText || el.textContent || el.value || "").trim().toLowerCase();
        const keywords = [
            "start with", "launch your", "start your", "start test", "get started",
            "free trial", "subscribe", "checkout", "buy now", "upgrade", "purchase",
            "sign up free", "create account"
        ];
        for (const kw of keywords) {
            if (text.includes(kw)) return true;
        }

        return false;
    }

    // Apply Variant Mutations to Target Element
    function applySingleAssignment(assignment, el) {
        if (!el) return;
        if (assignment.tenant_id) currentTenantId = assignment.tenant_id;

        const payload = assignment.payload || {};

        if (assignment.is_control) {
            console.info(`[NeriLabs Universal Engine] Visitor routed to Control (Baseline) for "${assignment.target_selector}"`);
        } else {
            // Apply copy mutation
            if (payload.copy_payload && payload.copy_payload.new_text) {
                el.innerText = payload.copy_payload.new_text;
                el.textContent = payload.copy_payload.new_text;
            }

            // Apply style mutation with !important priority
            if (payload.style_payload) {
                if (payload.style_payload.bg_color) {
                    el.style.setProperty("background-color", payload.style_payload.bg_color, "important");
                    el.style.setProperty("background", payload.style_payload.bg_color, "important");
                }
                if (payload.style_payload.text_color) {
                    el.style.setProperty("color", payload.style_payload.text_color, "important");
                }
                if (payload.style_payload.border_radius) {
                    el.style.setProperty("border-radius", payload.style_payload.border_radius, "important");
                }
            }

            // Apply pricing mutation (Visual Display + Checkout Link Synchronization)
            if (payload.pricing_payload) {
                const pp = payload.pricing_payload;
                const cents = pp.price_amount_cents || pp.amount_cents;
                const formatted = cents ? `$${(cents / 100).toFixed(0)}` : (pp.formatted_price || "");

                const isButtonOrLink = (node) => {
                    if (!node || !node.tagName) return false;
                    const tag = node.tagName.toLowerCase();
                    if (tag === "button" || tag === "a" || tag === "input") return true;
                    const cls = (node.className || "").toLowerCase();
                    return cls.includes("btn") || cls.includes("button") || cls.includes("cta");
                };

                // Identify price elements
                let priceElements = [];
                const priceSelectors = [pp.price_selector, assignment.target_selector].filter(Boolean);
                for (const pSel of priceSelectors) {
                    try {
                        const matches = Array.from(document.querySelectorAll(pSel)).filter(m => !isButtonOrLink(m));
                        if (matches.length > 0) {
                            priceElements = matches;
                            break;
                        }
                    } catch(e) {}
                }

                if (priceElements.length === 0 && !isButtonOrLink(el)) {
                    priceElements = [el];
                }

                // 1. Mutate Price Display text ONLY on price elements (NEVER on buttons!)
                if (formatted && priceElements.length > 0) {
                    priceElements.forEach(pEl => {
                        if (isButtonOrLink(pEl)) return;
                        const subSpan = pEl.querySelector("span");
                        const periodText = subSpan ? (subSpan.innerText || subSpan.textContent) : "/mo";
                        pEl.innerHTML = `${formatted}<span style="font-size: 0.4em; color: inherit; opacity: 0.75;">${periodText.startsWith('/') ? periodText : '/' + periodText}</span>`;
                        pEl.setAttribute("data-neri-price", formatted);
                    });
                }

                // 2. Synchronize CTA button: update checkout link and attributes, but PRESERVE the button text!
                const btnSelector = pp.button_selector || assignment.button_selector || ".btn, a.btn-primary, [data-plan]";
                try {
                    let btnEls = [];
                    // Look for button within the same tier card container first
                    const cardContainer = priceElements.length > 0 ? priceElements[0].closest(".price-card, .card, [class*='tier'], [class*='plan']") : null;
                    if (cardContainer) {
                        const cardBtns = Array.from(cardContainer.querySelectorAll(btnSelector));
                        if (cardBtns.length > 0) btnEls = cardBtns;
                    }
                    if (btnEls.length === 0 && isButtonOrLink(el)) {
                        btnEls = [el];
                    }
                    if (btnEls.length === 0) {
                        btnEls = Array.from(document.querySelectorAll(btnSelector));
                    }

                    btnEls.forEach(btn => {
                        if (pp.stripe_payment_link) {
                            if (btn.tagName === "A") {
                                btn.href = pp.stripe_payment_link;
                            } else {
                                btn.setAttribute("onclick", `window.location.href='${pp.stripe_payment_link}'`);
                            }
                        }
                        if (pp.stripe_price_id) {
                            btn.setAttribute("data-stripe-price", pp.stripe_price_id);
                            btn.setAttribute("data-price-id", pp.stripe_price_id);
                        }
                        if (formatted) btn.setAttribute("data-neri-price", formatted);
                    });
                } catch(e) {}
            }
            console.info(`[NeriLabs Universal Engine] Applied "${assignment.variant_name}" to "${assignment.target_selector}"`);
        }

        // Cache session state
        sessionStorage.setItem(`neri_token_${assignment.experiment_id}`, assignment.signed_token);
        sessionStorage.setItem(`neri_opaque_${assignment.experiment_id}`, assignment.opaque_variant_id);

        // Immediate impression flush for this experiment
        queueEvent(
            assignment.experiment_id,
            assignment.signed_token,
            assignment.opaque_variant_id,
            "IMPRESSION",
            {
                algorithm: assignment.client_action,
                selector: assignment.target_selector
            },
            assignment.tenant_id
        );
        flushBeacon();

        // If the mutated element IS a checkout button, track its clicks as conversions
        el.addEventListener("click", function() {
            if (isCheckoutConversionAction(el)) {
                recordConversion(assignment, el);
            }
        }, { capture: true });
    }

    // Observe DOM until target element mounts
    function observeAndApply(assignment, maxWaitMs = 4000) {
        let applied = false;
        function tryApply() {
            if (applied) return true;
            const elements = resolveTargetElements(assignment);
            if (elements.length > 0) {
                applied = true;
                elements.forEach(el => applySingleAssignment(assignment, el));
                return true;
            }
            return false;
        }

        if (tryApply()) return;

        const startTime = Date.now();
        const pollInterval = setInterval(() => {
            if (tryApply() || (Date.now() - startTime > maxWaitMs)) {
                clearInterval(pollInterval);
            }
        }, 50);

        if (window.MutationObserver) {
            const observer = new MutationObserver(() => {
                if (tryApply()) {
                    observer.disconnect();
                    clearInterval(pollInterval);
                }
            });
            const root = document.body || document.documentElement;
            if (root) {
                observer.observe(root, { childList: true, subtree: true });
                setTimeout(() => observer.disconnect(), maxWaitMs);
            }
        }
    }

    // Global Conversion Delegation:
    // Captures checkout / plan selection clicks across the entire page!
    document.addEventListener("click", function(ev) {
        const target = ev.target.closest("button, a, input[type='submit'], [data-plan], .plan-cta, .price-card .btn, [data-tag='Start a test']");
        if (!target) return;

        if (isCheckoutConversionAction(target) && activeAssignments.length > 0) {
            activeAssignments.forEach(assign => {
                recordConversion(assign, target);
            });
        }
    }, { capture: true });

    // Render Preview Badge if viewing in forced preview mode
    function renderPreviewBadge(count) {
        const b = document.createElement("div");
        b.style.cssText = "position:fixed;bottom:16px;right:16px;z-index:99999;background:#101010;color:#EDEDED;border:1px solid #2E3CFF;padding:8px 14px;border-radius:4px;font-family:monospace;font-size:11px;box-shadow:0 4px 20px rgba(0,0,0,0.6);display:flex;align-items:center;gap:8px;";
        b.innerHTML = `<span style="width:6px;height:6px;border-radius:50%;background:#3ECF8E;"></span><span>[NERILABS ENGINE] Active (${count} test${count>1?'s':''})</span> <a href="${window.location.pathname}" style="color:#2E3CFF;margin-left:6px;text-decoration:underline;">Reset</a>`;
        document.body.appendChild(b);
    }

    // Initialize Universal Multi-Element Engine
    function init() {
        if (isBotTraffic()) {
            console.info("[NeriLabs SDK] Automated bot/crawler detected. Serving baseline Control without optimization telemetry.");
            return;
        }
        const universalUrl = `${CONFIG.apiBase}/api/v1/experiments/universal-assign`;
        const reqBody = {
            visitor_id: visitorId,
            session_id: sessionId,
            device_type: /Mobile|Android/i.test(navigator.userAgent) ? "mobile" : "desktop",
            url: window.location.href,
            referrer: document.referrer || null,
            preview_variant: previewParam || null
        };

        fetch(universalUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Publishable-Key": CONFIG.publishableKey
            },
            credentials: "omit",
            body: JSON.stringify(reqBody)
        })
        .then(res => {
            if (!res.ok) throw new Error("Universal assignment failed: " + res.status);
            return res.json();
        })
        .then(data => {
            const assignments = data.assignments || [];
            activeAssignments = assignments;
            window.__NERILABS_ASSIGNMENTS__ = assignments;

            if (assignments.length === 0) {
                console.info("[NeriLabs Universal SDK] Connected. Waiting for active tests.");
                return;
            }

            function runMutations() {
                assignments.forEach(assign => observeAndApply(assign));
                if (previewParam) renderPreviewBadge(assignments.length);
            }

            if (document.readyState === "loading") {
                document.addEventListener("DOMContentLoaded", runMutations);
            } else {
                runMutations();
                setupBehavioralFrictionMonitors();
            }
        })
        .catch(err => {
            console.warn("[NeriLabs Universal SDK] Notice:", err.message);
        });

        setInterval(flushBeacon, 2000);
        window.addEventListener("beforeunload", flushBeacon);
        document.addEventListener("visibilitychange", function() {
            if (document.visibilityState === "hidden") flushBeacon();
        });
    }

    init();
})();
