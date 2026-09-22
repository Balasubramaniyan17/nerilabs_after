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
            const cascade = [
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
        .then(res => {
            if (!res.ok) console.debug("[NeriLabs Telemetry] Beacon notice:", res.status);
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

                // 1. Mutate Price Display text on target and matching selectors
                if (formatted) {
                    el.innerText = formatted;
                    el.textContent = formatted;
                    el.setAttribute("data-neri-price", formatted);

                    if (pp.price_selector && pp.price_selector !== assignment.target_selector) {
                        try {
                            const pEls = document.querySelectorAll(pp.price_selector);
                            pEls.forEach(pEl => {
                                pEl.innerText = formatted;
                                pEl.textContent = formatted;
                                pEl.setAttribute("data-neri-price", formatted);
                            });
                        } catch(e) {}
                    }
                }

                // 2. Synchronize CTA button (Stripe Payment Link or data-stripe-price attribute)
                const btnSelector = pp.button_selector || assignment.button_selector || ".btn, .plan-cta, a.btn-primary, [data-plan]";
                try {
                    let btnEls = [];
                    if (el.querySelectorAll) {
                        const localBtns = Array.from(el.querySelectorAll(btnSelector));
                        if (localBtns.length > 0) btnEls = localBtns;
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
