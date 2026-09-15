/**
 * NeriLabs Universal Autonomous Experimentation Client SDK (v3.0 Production)
 * - Single-install 1-time script tag (Universal Multi-Element Engine)
 * - Concurrently executes and optimizes ALL active experiments on the website
 * - Zero-flicker targeted element mutation with !important override
 * - Smart CTA element cascade discovery
 * - Query-parameter live preview (?neri_preview=...)
 * - Asynchronous telemetry beacon streaming per experiment
 */
(function() {
    'use strict';

    const CONFIG = {
        apiBase: window.NERILABS_API_BASE || window.AI_EXPERIMENT_API_BASE || "https://app.nerilabs.io",
        publishableKey: window.NERILABS_PUBLISHABLE_KEY || window.AI_EXPERIMENT_PUBLISHABLE_KEY || "nerilabs_pk_live_9a8b7c6d5e4f3a2b1c",
        experimentId: window.AI_EXPERIMENT_ID || "",
        targetSelector: window.AI_EXPERIMENT_TARGET_SELECTOR || "",
        timeoutMs: window.AI_EXPERIMENT_TIMEOUT_MS || 800
    };

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

    // Smart element discovery
    function resolveElement(selector) {
        let el = null;
        if (selector) {
            try { el = document.querySelector(selector); } catch(e) {}
        }
        if (!el) {
            const cascade = [
                "#primary-cta",
                "#hero-cta",
                ".hero-ctas .btn-primary",
                ".hero-ctas .btn",
                ".price-card.entry .btn",
                ".price-card .btn",
                ".hero-ctas a",
                ".hero-ctas button",
                ".btn-primary",
                "[data-tag='Start a test']",
                "#navActionBtn",
                ".hero h1",
                "h1"
            ];
            for (const sel of cascade) {
                try {
                    const cand = document.querySelector(sel);
                    if (cand) {
                        el = cand;
                        break;
                    }
                } catch(err) {}
            }
        }
        return el;
    }

    // Event Ingestion Queue
    const eventQueue = [];
    let flushInterval = null;

    function queueEvent(expId, token, opaqueId, type, payload = {}) {
        const event = {
            event_id: "evt_" + Math.random().toString(36).substring(2, 10),
            event_type: type,
            experiment_id: expId,
            tenant_id: "tenant_startup_01",
            opaque_variant_id: opaqueId || "unknown",
            visitor_id: visitorId,
            session_id: sessionId,
            signed_token: token || "untokenized",
            timestamp: Date.now() / 1000,
            metadata: payload
        };
        eventQueue.push(event);
    }

    function flushBeacon() {
        if (eventQueue.length === 0) return;
        const batch = [...eventQueue];
        eventQueue.length = 0;

        const endpoint = `${CONFIG.apiBase}/api/v1/telemetry/beacon`;
        const payloadStr = JSON.stringify({ events: batch });

        if (navigator.sendBeacon) {
            const blob = new Blob([payloadStr], { type: "application/json" });
            const ok = navigator.sendBeacon(endpoint, blob);
            if (!ok) fallbackFetch(endpoint, payloadStr);
        } else {
            fallbackFetch(endpoint, payloadStr);
        }
    }

    function fallbackFetch(endpoint, payloadStr) {
        fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Publishable-Key": CONFIG.publishableKey
            },
            credentials: "omit",
            body: payloadStr,
            keepalive: true
        }).catch(err => console.debug("Telemetry error:", err));
    }

    // Apply Variant Mutations to an Element
    function applySingleAssignment(assignment) {
        const el = resolveElement(assignment.target_selector);
        if (!el) {
            console.warn("NeriLabs Universal SDK: Element not found for selector:", assignment.target_selector);
            return;
        }

        const payload = assignment.payload || {};

        // 1. Copy mutation
        if (payload.copy_payload && payload.copy_payload.new_text) {
            el.innerText = payload.copy_payload.new_text;
            el.textContent = payload.copy_payload.new_text;
        }

        // 2. Style / UI mutation with !important priority
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

        // 3. Pricing mutation
        if (payload.pricing_payload && payload.pricing_payload.amount_cents) {
            const formatted = `$${(payload.pricing_payload.amount_cents / 100).toFixed(0)}`;
            el.setAttribute("data-neri-price", formatted);
            if (payload.pricing_payload.price_selector) {
                const pEl = document.querySelector(payload.pricing_payload.price_selector);
                if (pEl) pEl.textContent = formatted;
            }
        }

        // Cache session state
        sessionStorage.setItem(`neri_token_${assignment.experiment_id}`, assignment.signed_token);
        sessionStorage.setItem(`neri_opaque_${assignment.experiment_id}`, assignment.opaque_variant_id);

        console.info(`[NeriLabs Universal Engine] Applied "${assignment.variant_name}" to "${assignment.target_selector}"`);

        // Immediate impression flush for this experiment
        queueEvent(
            assignment.experiment_id,
            assignment.signed_token,
            assignment.opaque_variant_id,
            "IMPRESSION",
            {
                algorithm: assignment.client_action,
                is_composite: payload.is_composite || false,
                selector: assignment.target_selector
            }
        );
        flushBeacon();

        // Conversion tracking on this element
        el.addEventListener("click", function() {
            queueEvent(
                assignment.experiment_id,
                assignment.signed_token,
                assignment.opaque_variant_id,
                "CONVERSION",
                {
                    clicked_tag: el.tagName,
                    clicked_text: (el.innerText || "").substring(0, 40)
                }
            );
            flushBeacon();
        });
    }

    // Render Preview Badge if viewing in forced preview mode
    function renderPreviewBadge(count) {
        const b = document.createElement("div");
        b.style.cssText = "position:fixed;bottom:16px;right:16px;z-index:99999;background:#101010;color:#EDEDED;border:1px solid #2E3CFF;padding:8px 14px;border-radius:4px;font-family:monospace;font-size:11px;box-shadow:0 4px 20px rgba(0,0,0,0.6);display:flex;align-items:center;gap:8px;";
        b.innerHTML = `<span style="width:6px;height:6px;border-radius:50%;background:#3ECF8E;"></span><span>[NERILABS UNIVERSAL ENGINE] Active (${count} test${count>1?'s':''})</span> <a href="${window.location.pathname}" style="color:#2E3CFF;margin-left:6px;text-decoration:underline;">Reset</a>`;
        document.body.appendChild(b);
    }

    // Initialize Universal Multi-Element Engine
    function init() {
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
            if (assignments.length === 0) {
                console.info("[NeriLabs Universal SDK] Connected. Waiting for active tests.");
                return;
            }

            function runMutations() {
                assignments.forEach(assign => applySingleAssignment(assign));
                if (previewParam) renderPreviewBadge(assignments.length);
            }

            if (document.readyState === "loading") {
                document.addEventListener("DOMContentLoaded", runMutations);
            } else {
                runMutations();
            }
        })
        .catch(err => {
            console.warn("NeriLabs Universal SDK notice:", err.message);
        });

        flushInterval = setInterval(flushBeacon, 2000);
        window.addEventListener("beforeunload", flushBeacon);
    }

    init();
})();
