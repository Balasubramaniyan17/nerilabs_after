/**
 * Production-Grade Autonomous Experimentation Client SDK (Vanilla JS).
 * - Surgical Element-Level Anti-Flicker Cloak (Zero Impact on Core Web Vitals).
 * - MutationObserver dynamic DOM injection supporting single & composite variants (Copy + Style + Component + Pricing).
 * - Signed assignment token attached to window scope.
 * - Batched HTTP beacon telemetry (scroll depth, dwell time, CTA clicks, exit-intent).
 * - Behavioral Promotional Rescue Modal for hesitating visitors.
 */

(function(window, document) {
    "use strict";

    const CONFIG = {
        apiBase: window.AI_EXPERIMENT_API_BASE || "http://localhost:8000",
        publishableKey: window.AI_EXPERIMENT_PUBLISHABLE_KEY || "nerilabs_pk_live_9a8b7c6d5e4f3a2b1c",
        experimentId: window.AI_EXPERIMENT_ID || "exp_homepage_macro",
        targetSelector: window.AI_EXPERIMENT_TARGET_SELECTOR || null,
        timeoutMs: 120,
        beaconIntervalMs: 2000
    };

    // 1. Surgical Element-Level Anti-Flicker Cloak
    // Cloaks ONLY the target element being tested; the rest of the website loads at 100% speed with 0ms delay!
    const cloakId = "ai-opt-cloak-" + CONFIG.experimentId;
    if (CONFIG.targetSelector) {
        const styleEl = document.createElement("style");
        styleEl.id = cloakId;
        styleEl.innerHTML = `${CONFIG.targetSelector} { visibility: hidden !important; }`;
        (document.head || document.documentElement).appendChild(styleEl);
    }

    let isRevealed = false;
    function revealElement() {
        if (isRevealed) return;
        isRevealed = true;
        const cloak = document.getElementById(cloakId);
        if (cloak) cloak.remove();
        if (CONFIG.targetSelector) {
            const els = document.querySelectorAll(CONFIG.targetSelector);
            els.forEach(el => {
                if (el.style.visibility === "hidden") el.style.removeProperty("visibility");
            });
        }
        if (document.body && document.body.style.opacity === "0") {
            document.body.style.removeProperty("opacity");
            document.body.style.opacity = "";
        }
    }

    // Safety timeout: Guaranteed release in 120ms max under all network conditions
    setTimeout(revealElement, CONFIG.timeoutMs);

    // 2. Persistent Visitor & Session IDs
    function getStorage(key, genFn) {
        let v = localStorage.getItem(key);
        if (!v) {
            v = genFn();
            localStorage.setItem(key, v);
        }
        return v;
    }

    const visitorId = getStorage("ai_opt_vid", () => "vis_" + Math.random().toString(36).substring(2, 11));
    const sessionId = getStorage("ai_opt_sid", () => "sess_" + Math.random().toString(36).substring(2, 11) + "_" + Date.now());

    // Telemetry Buffer
    const eventBuffer = [];

    function queueEvent(eventType, metadata = {}) {
        eventBuffer.push({
            event_id: "evt_" + Math.random().toString(36).substring(2, 11) + "_" + Date.now(),
            event_type: eventType,
            tenant_id: "tenant_startup_01",
            experiment_id: CONFIG.experimentId,
            opaque_variant_id: window.AI_EXPERIMENT_OPAQUE_ID || "control",
            visitor_id: visitorId,
            session_id: sessionId,
            signed_token: window.AI_EXPERIMENT_TOKEN || null,
            timestamp: Date.now() / 1000,
            reward_value: eventType === "CONVERSION" ? 1.0 : 0.0,
            metadata: metadata
        });
    }

    function flushBeacon() {
        if (eventBuffer.length === 0) return;
        const batch = eventBuffer.splice(0, eventBuffer.length);
        const payloadStr = JSON.stringify({ tenant_id: "tenant_startup_01", events: batch });

        if (navigator.sendBeacon) {
            const blob = new Blob([payloadStr], { type: "application/json" });
            navigator.sendBeacon(`${CONFIG.apiBase}/api/v1/telemetry/beacon`, blob);
        } else {
            fetch(`${CONFIG.apiBase}/api/v1/telemetry/beacon`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-Publishable-Key": CONFIG.publishableKey },
            credentials: "omit",
                body: payloadStr,
                keepalive: true
            }).catch(err => console.debug("Beacon sync error:", err));
        }
    }

    setInterval(flushBeacon, CONFIG.beaconIntervalMs);
    window.addEventListener("beforeunload", flushBeacon);

    // 3. Request Variant Assignment & Signed Token
    fetch(`${CONFIG.apiBase}/api/v1/experiments/${CONFIG.experimentId}/assign`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Publishable-Key": CONFIG.publishableKey
        },
        body: JSON.stringify({
            visitor_id: visitorId,
            session_id: sessionId,
            device_type: window.innerWidth < 768 ? "mobile" : "desktop",
            viewport_width: window.innerWidth,
            viewport_height: window.innerHeight,
            referrer: document.referrer || null
        })
    })
    .then(res => {
        if (!res.ok) throw new Error("Assignment failed: " + res.status);
        return res.json();
    })
    .then(data => {
        window.AI_EXPERIMENT_TOKEN = data.signed_token;
        window.AI_EXPERIMENT_OPAQUE_ID = data.opaque_variant_id;

        queueEvent("IMPRESSION", { algorithm: data.client_action, is_composite: data.payload.is_composite || false });
        flushBeacon();

        if (data.is_control) {
            revealElement();
            setupTelemetryListeners();
            return;
        }

        const payload = data.payload;

        function applyPatch(targetNode) {
            if (!targetNode) return;

            // 1. Component Mutation (if present, swaps structure)
            if (payload.component_payload && payload.component_payload.replacement_html) {
                targetNode.outerHTML = payload.component_payload.replacement_html;
                revealElement();
                setupTelemetryListeners();
                return;
            }

            // 2. Copy Mutation
            if (payload.copy_payload && payload.copy_payload.new_text) {
                targetNode.textContent = payload.copy_payload.new_text;
            }

            // 3. Style Mutation (Applies CSS rules)
            if (payload.style_payload && payload.style_payload.css_rules) {
                for (const [k, v] of Object.entries(payload.style_payload.css_rules)) {
                    targetNode.style.setProperty(k, v, "important");
                }
            }

            // 4. Dynamic Pricing rendering (if dedicated price element)
            if (payload.pricing_payload) {
                const priceTarget = document.querySelector(".ai-dynamic-price, #pro-price-amount, .price-display");
                if (priceTarget) {
                    priceTarget.textContent = `$${(payload.pricing_payload.price_amount_cents / 100).toFixed(0)}/mo`;
                } else if (payload.variant_type === "PRICING") {
                    targetNode.textContent = `$${(payload.pricing_payload.price_amount_cents / 100).toFixed(0)}/mo`;
                }
            }

            revealElement();
            setupTelemetryListeners();
        }

        const selector = payload.selector || 
                         (payload.copy_payload && payload.copy_payload.selector) || 
                         (payload.style_payload && payload.style_payload.selector) || 
                         (payload.component_payload && payload.component_payload.selector) || 
                         CONFIG.targetSelector || 
                         "#hero-cta";

        const existing = document.querySelector(selector);
        if (existing) {
            applyPatch(existing);
        } else {
            revealElement();
            setupTelemetryListeners();
            const observer = new MutationObserver((mutations, obs) => {
                const el = document.querySelector(selector);
                if (el) {
                    applyPatch(el);
                    obs.disconnect();
                }
            });
            observer.observe(document.documentElement, { childList: true, subtree: true });
            setTimeout(() => {
                try { observer.disconnect(); } catch(e) {}
            }, 4000);
        }
    })
    .catch(err => {
        console.warn("AI Experimentation SDK fallback:", err);
        revealElement();
        setupTelemetryListeners();
    });

    // 4. Telemetry Observers & Promotional Rescue Modal
    function setupTelemetryListeners() {
        let dwellSeconds = 0;
        const dwellInterval = setInterval(() => {
            dwellSeconds += 2;
            queueEvent("DWELL", { dwell_duration: 2 });
        }, 2000);

        document.addEventListener("click", function(e) {
            const target = e.target.closest("button, a, .btn, [role='button'], input[type='submit']");
            if (target) {
                queueEvent("CONVERSION", {
                    clicked_tag: target.tagName,
                    clicked_text: (target.innerText || "").substring(0, 30)
                });
                flushBeacon();
            }
        });

        let maxScrollPercent = 0;
        window.addEventListener("scroll", function() {
            const scrollPos = window.scrollY + window.innerHeight;
            const docHeight = document.documentElement.scrollHeight;
            const scrollPct = Math.floor((scrollPos / docHeight) * 100);
            if (scrollPct > maxScrollPercent) {
                maxScrollPercent = scrollPct;
                if (maxScrollPercent >= 50) {
                    queueEvent("SCROLL_PAST", { scroll_percent: maxScrollPercent });
                }
            }
        }, { passive: true });

        document.addEventListener("mouseleave", function(e) {
            if (e.clientY <= 0) {
                queueEvent("DWELL", { is_exit_intent: true });
                flushBeacon();
            }
        });
    }

    window.showPromotionalRescueModal = function(rescueData, newSignedToken) {
        if (newSignedToken) {
            window.AI_EXPERIMENT_TOKEN = newSignedToken;
        }

        const modalDiv = document.createElement("div");
        modalDiv.id = "ai-opt-rescue-modal";
        modalDiv.style.cssText = "position:fixed;bottom:24px;right:24px;max-width:380px;background:#1e293b;color:#fff;padding:20px;border-radius:12px;box-shadow:0 20px 25px -5px rgba(0,0,0,0.5);border:1px solid #3b82f6;z-index:99999;font-family:sans-serif;";
        
        modalDiv.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                <strong style="font-size:15px;color:#f8fafc;">${rescueData.modal_headline || "🎁 Special Founder Offer"}</strong>
                <button onclick="document.getElementById('ai-opt-rescue-modal').remove()" style="background:transparent;border:none;color:#94a3b8;cursor:pointer;font-size:16px;">✕</button>
            </div>
            <p style="font-size:13px;color:#cbd5e1;margin-bottom:12px;">${rescueData.modal_body || "Claim an exclusive 20% discount on your first 3 months."}</p>
            <div style="background:#0f172a;padding:8px 12px;border-radius:6px;font-family:monospace;font-size:13px;color:#38bdf8;margin-bottom:12px;text-align:center;">
                Promo Code: <strong>${rescueData.promo_code || "FOUNDER20"}</strong> (${rescueData.discounted_price_formatted || "$49/mo"})
            </div>
            <button id="ai-opt-claim-btn" style="width:100%;background:#3b82f6;color:#fff;border:none;padding:10px;border-radius:6px;font-weight:bold;cursor:pointer;">${rescueData.cta_text || "Claim Discount & Checkout →"}</button>
            ${rescueData.disclosure_statement ? `<small style="display:block;color:#64748b;font-size:10px;margin-top:8px;text-align:center;">${rescueData.disclosure_statement}</small>` : ''}
        `;
        document.body.appendChild(modalDiv);

        document.getElementById("ai-opt-claim-btn").addEventListener("click", function() {
            const priceEl = document.querySelector(".ai-dynamic-price, #pro-price-amount, .price-display");
            if (priceEl && rescueData.discounted_price_formatted) {
                priceEl.textContent = rescueData.discounted_price_formatted;
            }
            modalDiv.remove();
            queueEvent("CONVERSION", { claimed_promo: rescueData.promo_code });
            flushBeacon();
        });
    };

})(window, document);
