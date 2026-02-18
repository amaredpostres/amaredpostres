/**
 * AMARED Cloudflare Worker — FULL (Compat: Service Worker syntax)
 * Fix: "Unexpected token 'async'" by avoiding module-only syntax issues.
 *
 * ✅ Supports both variable names:
 *   - APPS_SCRIPT_URL (or WEBHOOK_URL)
 *   - APPS_SCRIPT_KEY (key param expected by Apps Script)
 *
 * ✅ Public actions (no PIN in frontend):
 *   - profiles_public_list  -> forwards to Apps Script profiles_list with PROFILES_SECRET
 *   - costs_public_list     -> forwards to Apps Script costs_public_list with COSTS_SECRET
 *
 * ✅ Admin validation:
 *   - validate_admin_pin
 *
 * ✅ Proxies existing actions to Apps Script (requires admin_pin for admin actions on Apps Script side)
 *
 * REQUIRED SECRETS / VARS in Cloudflare Worker:
 *   - APPS_SCRIPT_URL  (Text)  OR WEBHOOK_URL (Text)
 *   - APPS_SCRIPT_KEY  (Secret)  (the same as SECRET_KEY in Apps Script)
 *   - ADMIN_PIN        (Secret)
 *   - PROFILES_SECRET  (Secret)
 *   - COSTS_SECRET     (Secret)
 * Optional:
 *   - ALLOWED_ORIGINS  (Text) CSV, e.g. "https://amaredpostres.github.io,https://...".
 *   - RATE_LIMIT_KV    (KV binding)  // If you have it; otherwise rate-limit is skipped.
 */

// ---------- Entry ----------
addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event.request));
});

// ---------- Helpers ----------
function jsonResponse(obj, status, corsHeaders) {
  const body = JSON.stringify(obj ?? {});
  return new Response(body, {
    status: status || 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders,
    },
  });
}

function textResponse(text, status, corsHeaders) {
  return new Response(text || "", {
    status: status || 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders,
    },
  });
}

function getAllowedOrigins() {
  try {
    const raw = ((typeof ALLOWED_ORIGINS !== "undefined" && ALLOWED_ORIGINS) ? ALLOWED_ORIGINS : ((typeof ALLOWED_ORIGIN !== "undefined" && ALLOWED_ORIGIN) ? ALLOWED_ORIGIN : "")) || "";
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch (_e) {
    return [];
  }
}

function normalizeOrigin(o) {
  return (o || "").trim().replace(/\/$/, "").toLowerCase();
}

function buildCorsHeaders(request) {
  const originRaw = request.headers.get("Origin") || "";
  const origin = normalizeOrigin(originRaw);
  const allowList = getAllowedOrigins().map(normalizeOrigin).filter(Boolean);

  // If no allowlist configured, allow all (use with caution).
  let allowOrigin = "*";
  if (allowList.length > 0) {
    allowOrigin = allowList.includes(origin) ? originRaw.replace(/\/$/, "") : "null";
  }

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function mustHaveBinding(name) {
  // In service-worker syntax, secrets/vars are global bindings
  // We can check via typeof
  try {
    return typeof self[name] !== "undefined" && self[name] !== null && String(self[name]).length > 0;
  } catch (_e) {
    return false;
  }
}

function getAppScriptBaseUrl() {
  const url = (typeof WEBHOOK_URL !== "undefined" && WEBHOOK_URL) ? WEBHOOK_URL
            : (typeof APPS_SCRIPT_URL !== "undefined" && APPS_SCRIPT_URL) ? APPS_SCRIPT_URL
            : "";
  return String(url || "").trim();
}

function getAppScriptKey() {
  const key = ((typeof APPS_SCRIPT_KEY !== "undefined" && APPS_SCRIPT_KEY) ? APPS_SCRIPT_KEY : ((typeof AMARED_KEY !== "undefined" && AMARED_KEY) ? AMARED_KEY : ""));
  return String(key || "").trim();
}

function getWebhookUrlWithKey() {
  const base = getAppScriptBaseUrl();
  const key = getAppScriptKey();
  if (!base) return { ok: false, error: "Missing APPS_SCRIPT_URL (or WEBHOOK_URL)" };
  if (!key) return { ok: false, error: "Missing APPS_SCRIPT_KEY (o AMARED_KEY)" };

  const hasQ = base.includes("?");
  const full = base + (hasQ ? "&" : "?") + "key=" + encodeURIComponent(key);
  return { ok: true, url: full };
}

async function readJsonSafe(request) {
  try {
    const text = await request.text();
    if (!text) return {};
    return JSON.parse(text);
  } catch (_e) {
    return {};
  }
}

// ---------- Rate limit (optional KV) ----------
async function rateLimit(request, action) {
  // If no KV binding, skip
  if (typeof RATE_LIMIT_KV === "undefined" || !RATE_LIMIT_KV) return;

  const ip =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For") ||
    "0.0.0.0";

  const key = `rl:${action}:${ip}`;
  const now = Date.now();

  // Simple window: 10 req / 10s per action+IP
  const windowMs = 10_000;
  const limit = 10;

  const raw = await RATE_LIMIT_KV.get(key);
  let data = raw ? JSON.parse(raw) : { count: 0, start: now };

  if (now - data.start > windowMs) {
    data = { count: 0, start: now };
  }

  data.count += 1;

  await RATE_LIMIT_KV.put(key, JSON.stringify(data), { expirationTtl: 20 });

  if (data.count > limit) {
    throw new Error("Rate limit exceeded");
  }
}

// ---------- Apps Script forward ----------
async function forwardToAppsScript(payload, corsHeaders) {
  const w = getWebhookUrlWithKey();
  if (!w.ok) return jsonResponse({ ok: false, error: w.error }, 500, corsHeaders);

  try {
    const res = await fetch(w.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    });

    const contentType = res.headers.get("Content-Type") || "";
    let out;

    if (contentType.includes("application/json")) {
      out = await res.json();
    } else {
      const t = await res.text();
      out = { ok: false, error: t || "Non-JSON response from Apps Script" };
    }

    // Always return JSON to frontend
    return jsonResponse(out, res.status || 200, corsHeaders);
  } catch (e) {
    return jsonResponse({ ok: false, error: String(e?.message || e) }, 502, corsHeaders);
  }
}

function isValidAdminPin(pin) {
  const admin = (typeof ADMIN_PIN !== "undefined" && ADMIN_PIN) ? String(ADMIN_PIN) : "";
  return admin && String(pin || "") === admin;
}

// ---------- Main handler ----------
async function handleRequest(request) {
  const corsHeaders = buildCorsHeaders(request);

  if (request.method === "OPTIONS") {
    return new Response("", { status: 204, headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed" }, 405, corsHeaders);
  }

  // Critical required bindings (except optional ALLOWED_ORIGINS, RATE_LIMIT_KV)
  if (!getAppScriptBaseUrl()) return jsonResponse({ ok: false, error: "Missing APPS_SCRIPT_URL (or WEBHOOK_URL)" }, 500, corsHeaders);
  if (!getAppScriptKey()) return jsonResponse({ ok: false, error: "Missing APPS_SCRIPT_KEY (o AMARED_KEY)" }, 500, corsHeaders);

  const body = await readJsonSafe(request);
  const action = String(body.action || "").trim();

  if (!action) {
    return jsonResponse({ ok: false, error: "Missing action" }, 400, corsHeaders);
  }

  // Rate limit per action (if KV configured)
  try {
    await rateLimit(request, action);
  } catch (e) {
    return jsonResponse({ ok: false, error: "Too Many Requests" }, 429, corsHeaders);
  }

  // ---- Public actions (no PIN, no secrets from frontend) ----
  if (action === "profiles_public_list") {
    if (!mustHaveBinding("PROFILES_SECRET")) {
      return jsonResponse({ ok: false, error: "Missing PROFILES_SECRET" }, 500, corsHeaders);
    }
    const category = String(body.category || "kitchen").trim().toLowerCase();
    const payload = {
      action: "profiles_list",
      category,
      profiles_secret: String(PROFILES_SECRET),
    };
    return forwardToAppsScript(payload, corsHeaders);
  }

  if (action === "costs_public_list") {
    if (!mustHaveBinding("COSTS_SECRET")) {
      return jsonResponse({ ok: false, error: "Missing COSTS_SECRET" }, 500, corsHeaders);
    }
    const payload = {
      action: "costs_public_list",
      costs_secret: String(COSTS_SECRET),
    };
    return forwardToAppsScript(payload, corsHeaders);
  }

  // ---- Validation action (frontend uses to validate PIN) ----
  if (action === "validate_admin_pin") {
    const ok = isValidAdminPin(body.admin_pin);
    return jsonResponse({ ok: true, valid: ok }, 200, corsHeaders);
  }

  // ---- Compras (shopping_*) ----
  // Estas acciones deben poder ejecutarse desde la página de Costos usando la clave
  // de costos (COSTS_SECRET) sin requerir el PIN admin.
  // Permitimos: COSTS_SECRET **o** ADMIN_PIN.
  const SHOPPING_ACTIONS = new Set(["shopping_get","shopping_save","shopping_reset","costs_orders_for_purchases","inventory_get","inventory_add_purchase","inventory_add_purchase_batch","inventory_reset_ingredient"]);

  // Compras: permitir acceso con la clave de Costos (COSTS_SECRET) o con el PIN admin
  // Si entra por PIN, el Worker inyecta COSTS_SECRET al Apps Script (el frontend nunca lo ve).
  if (SHOPPING_ACTIONS.has(action)) {
    const hasCosts = typeof body.costs_secret === "string" && body.costs_secret.length > 0;
    const costsOk = hasCosts && String(body.costs_secret) === String(COSTS_SECRET);
    const pinOk = isValidAdminPin(body.admin_pin);

    if (!costsOk && !pinOk) {
      return jsonResponse({ ok: false, error: "Unauthorized admin" }, 401, corsHeaders);
    }

    // Si se autenticó con PIN, inyectamos el secret real para que Apps Script autorice.
    if (pinOk && !costsOk) {
      body.costs_secret = String(COSTS_SECRET);
    }

    return await forwardToAppsScript(body, corsHeaders);
  }

  // ---- Protected admin-ish actions (require correct PIN at Worker layer) ----
  const PIN_REQUIRED_ACTIONS = new Set([
    "list_orders",
    "update_order",
    "kitchen_bulk_update",
    "catalog_delete",
  ]);

  if (PIN_REQUIRED_ACTIONS.has(action)) {
    if (!isValidAdminPin(body.admin_pin)) {
      return jsonResponse({ ok: false, error: "Unauthorized admin" }, 401, corsHeaders);
    }
    // Forward as-is (Apps Script will also validate key, and other secrets if required)
    return forwardToAppsScript(body, corsHeaders);
  }

  // ---- Public-ish actions (no PIN) ----
  // create_order etc (Apps Script will validate key and handle)
  return forwardToAppsScript(body, corsHeaders);
}
