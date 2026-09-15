/**
 * NeriLabs Autonomous Experimentation Client SDK (v2.5 Production)
 * - Zero-flicker targeted element mutation
 * - Smart CTA element cascade discovery
 * - Query-parameter live preview (?neri_preview=...)
 * - Asynchronous telemetry beacon streaming
 */
(function() {
    'use strict';

    const CONFIG = {
        apiBase: window.AI_EXPERIMENT_API_BASE || "https://app.nerilabs.io",
        publishableKey: window.AI_EXPERIMENT_PUBLISHABLE_KEY || "",
        experimentId: window.AI_EXPERIMENT_ID || "",
        targetSelector: window.AI_EXPERIMENT_TARGET_SELECTOR || "#primary-cta",
        timeoutMs: window.AI_EXPERIMENT_TIMEOUT_MS || 800
    };

    if (!CONFIG.experimentId) {
        console.warn("NeriLabs SDK: window.AI_EXPERIMENT_ID is required.");
        return;
    }

    // Check for forced live preview parameter in URL
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

    // Smart element discovery: tries targetSelector first, then intelligent fallbacks
    function findTargetElement() {
        let el = null;
        if (CONFIG.targetSelector) {
            try { el = document.querySelector(CONFIG.targetSelector); } catch(e) {}
        }
        if (!el) {
            const cascade = [
                "#primary-cta",
                "#hero-cta",
                ".hero-ctas .btn-primary",
                ".hero-ctas a",
                ".hero-ctas button",
                ".btn-primary",
                "[data-tag='Start a test']",
                "#navActionBtn",
                "a.btn-primary"
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

    // Targeted Element Cloak (anti-flicker on CTA only, never blank screen)
    const cloakStyle = document.createElement("style");
    cloakStyle.id = "neri-cloak";
    cloakStyle.innerHTML = `${CONFIG.targetSelector}, #primary-cta, #hero-cta, .hero-ctas .btn-primary { opacity: 0 !important; transition: opacity 0.15s ease-in !important; }`;
    (document.head || document.documentElement).appendChild(cloakStyle);

    function uncloak() {
        const el = document.getElementById("neri-cloak");
        if (el) el.remove();
        const target = findTargetElement();
        if (target) target.style.opacity = "1";
    }

    const cloakTimer = setTimeout(uncloak, CONFIG.timeoutMs);

    // Event Ingestion Queue
    const eventQueue = [];
    let flushInterval = null;

    function queueEvent(type, payload = {}) {
        const token = sessionStorage.getItem(`neri_token_${CONFIG.experimentId}`);
        const opaqueVariant = sessionStorage.getItem(`neri_opaque_${CONFIG.experimentId}`);
        const event = {
            event_id: "evt_" + Math.random().toString(36).substring(2, 10),
            event_type: type,
            experiment_id: CONFIG.experimentId,
            tenant_id: "tenant_startup_01",
            opaque_variant_id: opaqueVariant || "unknown",
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

    // Apply Variant Mutations to DOM
    function applyVariant(data) {
        const el = findTargetElement();
        if (!el) {
            console.warn("NeriLabs SDK: Target CTA element could not be resolved.");
            uncloak();
            return;
        }

        const payload = data.payload || {};

        // 1. Copy mutation
        if (payload.copy_payload && payload.copy_payload.new_text) {
            el.textContent = payload.copy_payload.new_text;
        }

        // 2. Style / UI mutation
        if (payload.style_payload) {
            if (payload.style_payload.bg_color) el.style.backgroundColor = payload.style_payload.bg_color;
            if (payload.style_payload.text_color) el.style.color = payload.style_payload.text_color;
            if (payload.style_payload.border_radius) el.style.borderRadius = payload.style_payload.border_radius;
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

        // 4. Component mutation
        if (payload.component_payload && payload.component_payload.html_content) {
            const wrapper = document.createElement("div");
            wrapper.className = "neri-component-arm";
            wrapper.innerHTML = payload.component_payload.html_content;
            el.parentNode.insertBefore(wrapper, el.nextSibling);
        }

        // Cache assigned state in session
        sessionStorage.setItem(`neri_token_${CONFIG.experimentId}`, data.signed_token);
        sessionStorage.setItem(`neri_opaque_${CONFIG.experimentId}`, data.opaque_variant_id);

        uncloak();

        // Render preview badge if viewing in preview mode
        if (previewParam) {
            renderPreviewBadge(data.client_action, payload.copy_payload ? payload.copy_payload.new_text : "Control");
        }

        // Immediate impression flush
        queueEvent("IMPRESSION", {
            algorithm: data.client_action,
            is_composite: payload.is_composite || false,
            matched_element: el.tagName + (el.id ? "#" + el.id : "") + (el.className ? "." + el.className.split(" ")[0] : "")
        });
        flushBeacon();
    }

    function renderPreviewBadge(action, text) {
        const b = document.createElement("div");
        b.style.cssText = "position:fixed;bottom:16px;right:16px;z-index:99999;background:#101010;color:#EDEDED;border:1px solid #2E3CFF;padding:8px 14px;border-radius:4px;font-family:monospace;font-size:11px;box-shadow:0 4px 20px rgba(0,0,0,0.6);display:flex;align-items:center;gap:8px;";
        b.innerHTML = `<span style="width:6px;height:6px;border-radius:50%;background:#3ECF8E;"></span><span>[PREVIEW MODE] Active: <strong>${text}</strong></span> <a href="${window.location.pathname}" style="color:#2E3CFF;margin-left:6px;text-decoration:underline;">Exit</a>`;
        document.body.appendChild(b);
    }

    // Initialize Telemetry & Assignment
    function init() {
        const assignUrl = `${CONFIG.apiBase}/api/v1/experiments/${CONFIG.experimentId}/assign`;
        const reqBody = {
            visitor_id: visitorId,
            session_id: sessionId,
            device_type: /Mobile|Android/i.test(navigator.userAgent) ? "mobile" : "desktop",
            viewport_width: window.innerWidth,
            viewport_height: window.innerHeight,
            referrer: document.referrer || null,
            preview_variant: previewParam || null
        };

        fetch(assignUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Publishable-Key": CONFIG.publishableKey
            },
            credentials: "omit",
            body: JSON.stringify(reqBody)
        })
        .then(res => {
            if (!res.ok) throw new Error("Assignment failed: " + res.status);
            return res.json();
        })
        .then(data => {
            if (document.readyState === "loading") {
                document.addEventListener("DOMContentLoaded", () => applyVariant(data));
            } else {
                applyVariant(data);
            }
        })
        .catch(err => {
            console.warn("NeriLabs SDK fallback to baseline:", err.message);
            uncloak();
        });

        // Conversion tracking on any primary interactive element
        document.addEventListener("click", function(e) {
            const target = e.target.closest("button, a, .btn, [role='button'], input[type='submit']");
            if (target) {
                queueEvent("CONVERSION", {
                    clicked_tag: target.tagName,
                    clicked_text: (target.innerText || "").substring(0, 30),
                    clicked_href: target.getAttribute("href") || null
                });
                flushBeacon();
            }
        });

        flushInterval = setInterval(flushBeacon, 2000);
        window.addEventListener("beforeunload", flushBeacon);
    }

    init();
})();
