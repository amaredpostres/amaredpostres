/* Purchases (login + load) */
const API_URL = "https://amared-orders.amaredpostres.workers.dev/";
const LS_KEY = "AMARED_PURCHASES_COSTS_SECRET";

const $ = (id) => document.getElementById(id);

function asString(v) {
  if (typeof v === "string") return v;
  if (v == null) return "";
  if (typeof v === "object") {
    if (typeof v.value === "string") return v.value;
    if (typeof v.secret === "string") return v.secret;
  }
  try { return String(v); } catch { return ""; }
}

function setText(id, text) {
  const el = $(id);
  if (el) el.textContent = text ?? "";
}

function showLoading(title, sub) {
  setText("loadingTitle", title);
  setText("loadingSub", sub);
  $("loadingBack").hidden = false;
}
function hideLoading() { $("loadingBack").hidden = true; }

function showLogin(msg = "") {
  $("appRoot").hidden = true;
  $("unlockBack").hidden = false;
  setText("unlockMsg", msg);
  setTimeout(() => { try { $("secretInput").focus(); } catch {} }, 0);
}
function hideLogin() { $("unlockBack").hidden = true; }
function showApp() { $("appRoot").hidden = false; }

async function api(body, { timeoutMs = 20000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  let res, text;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
      signal: ctrl.signal,
    });
    text = await res.text();
  } catch (err) {
    clearTimeout(t);
    throw new Error(err?.name === "AbortError"
      ? "Tiempo de espera agotado (API)."
      : ("Error de red: " + (err?.message || String(err))));
  } finally {
    clearTimeout(t);
  }

  let json;
  try { json = JSON.parse(text); }
  catch { json = { ok: false, error: "Respuesta no-JSON del servidor.", raw: text }; }

  if (!res.ok && typeof json.ok !== "boolean") json.ok = false;
  if (!res.ok && !json.error) json.error = `HTTP ${res.status}`;
  return json;
}

let COSTS_SECRET = "";
let unlocked = false;

function formatNum(n) {
  if (!isFinite(n)) return "—";
  return Math.round(n).toLocaleString("es-CO");
}
function safeUnit(u) { return (u || "").toString().trim() || "u"; }
function rowKey(name) { return (name || "").toString().trim().toLowerCase(); }

function setButtonsEnabled(enabled) {
  $("btnReload").disabled = !enabled;
  $("btnRegister").disabled = !enabled;
}

function buildRow(ing, needed, inv, unit, costPerUnit) {
  const missing = Math.max(0, needed - inv);
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td>${ing}</td>
    <td class="num">${formatNum(needed)}</td>
    <td class="num">${formatNum(inv)}</td>
    <td class="num">${formatNum(missing)}</td>
    <td>${unit}</td>
    <td class="num">${costPerUnit > 0 ? formatNum(costPerUnit) : "—"}</td>
    <td class="num"><input class="inp small num" data-ingredient="${ing}" data-unit="${unit}" value="0" inputmode="decimal" /></td>
    <td>
      <label class="chk">
        <input type="checkbox" data-include="${ing}" checked />
        <span>✔</span>
      </label>
    </td>
  `;
  return tr;
}

function collectPurchasesFromTable() {
  const inputs = Array.from(document.querySelectorAll('input[data-ingredient]'));
  const checks = new Map(
    Array.from(document.querySelectorAll('input[type="checkbox"][data-include]'))
      .map(ch => [ch.getAttribute("data-include"), ch.checked])
  );
  const items = [];
  for (const inp of inputs) {
    const ing = inp.getAttribute("data-ingredient");
    const unit = inp.getAttribute("data-unit") || "u";
    const include = checks.get(ing) !== false;
    const qty = Number(String(inp.value).replace(",", "."));
    if (!include) continue;
    if (!isFinite(qty) || qty <= 0) continue;
    items.push({ ingredient: ing, qty, unit });
  }
  return items;
}

async function loadAll(secret) {
  const [ordersRes, costsRes, invRes] = await Promise.all([
    api({ action: "costs_orders_for_purchases", costs_secret: secret }),
    api({ action: "costs_list", costs_secret: secret }),
    api({ action: "inventory_get", costs_secret: secret }),
  ]);

  if (!ordersRes?.ok) throw new Error(ordersRes?.error || "No se pudieron leer necesidades.");
  if (!costsRes?.ok) throw new Error(costsRes?.error || "No se pudieron leer costos.");
  if (!invRes?.ok) throw new Error(invRes?.error || "No se pudo leer inventario.");

  const used = Number(ordersRes.ordersUsed || 0);
  const limit = Number(ordersRes.ordersLimit || 0);
  const winH = Number(ordersRes.windowH || 36);
  setText("metaText", `Desbloqueado. Pedidos usados: ${used}/${limit}. Ventana: ${winH}h`);

  const costsMap = new Map();
  const rows = Array.isArray(costsRes.rows) ? costsRes.rows : [];
  for (const r of rows) {
    const ing = (r.ingredient || r.name || "").toString().trim();
    if (!ing) continue;
    const unit = safeUnit(r.unit || r.unidad);
    const cpu = Number(r.cost_per_unit || r.costPerUnit || r.cost_u || r.costo_u || 0);
    costsMap.set(rowKey(ing), { unit, cpu: isFinite(cpu) ? cpu : 0, label: ing });
  }

  const invMap = new Map();
  const invRows = Array.isArray(invRes.rows) ? invRes.rows : [];
  for (const r of invRows) {
    const ing = (r.ingredient || r.name || "").toString().trim();
    if (!ing) continue;
    const qty = Number(r.qty || r.quantity || r.stock || 0);
    invMap.set(rowKey(ing), isFinite(qty) ? qty : 0);
  }

  const needMap = new Map();
  const byIng = ordersRes.byIngredient && typeof ordersRes.byIngredient === "object" ? ordersRes.byIngredient : {};
  for (const [ing, obj] of Object.entries(byIng)) {
    const needed = Number(obj?.needed || obj?.qty || obj || 0);
    needMap.set(rowKey(ing), isFinite(needed) ? needed : 0);
  }

  const keys = new Set([...needMap.keys(), ...invMap.keys(), ...costsMap.keys()]);
  const sorted = Array.from(keys).sort((a, b) => a.localeCompare(b, "es"));

  const tbody = $("rows");
  tbody.innerHTML = "";
  for (const k of sorted) {
    const label = costsMap.get(k)?.label || k;
    const needed = needMap.get(k) ?? 0;
    const inv = invMap.get(k) ?? 0;
    const unit = costsMap.get(k)?.unit || "u";
    const cpu = costsMap.get(k)?.cpu || 0;
    tbody.appendChild(buildRow(label, needed, inv, unit, cpu));
  }

  setButtonsEnabled(true);
}

async function doUnlock({ silent = false } = {}) {
  const secret = asString($("secretInput")?.value || COSTS_SECRET).trim();
  if (!secret) {
    if (!silent) setText("unlockMsg", "Ingresa la clave.");
    throw new Error("Ingresa la clave.");
  }

  showLoading("Validando…", "Verificando clave en el servidor.");
  setText("unlockMsg", "");

  const test = await api({ action: "costs_list", costs_secret: secret }, { timeoutMs: 20000 });
  if (!test?.ok) {
    hideLoading();
    if (!silent) setText("unlockMsg", test?.error || "Clave inválida o sin permisos.");
    throw new Error(test?.error || "Clave inválida o sin permisos.");
  }

  COSTS_SECRET = secret;
  try { localStorage.setItem(LS_KEY, secret); } catch {}

  showLoading("Cargando…", "Leyendo necesidades, costos e inventario.");
  await loadAll(secret);

  unlocked = true;
  hideLoading();
  hideLogin();
  showApp();
}

function logout() {
  unlocked = false;
  COSTS_SECRET = "";
  try { localStorage.removeItem(LS_KEY); } catch {}
  setButtonsEnabled(false);
  $("rows").innerHTML = "";
  setText("metaText", "Desbloquea con tu clave de Costos para iniciar.");
  showLogin("");
}

async function boot() {
  $("btnDoUnlock").addEventListener("click", async () => { try { await doUnlock({ silent: false }); } catch {} });
  $("btnClearSecret").addEventListener("click", () => {
    $("secretInput").value = "";
    setText("unlockMsg", "");
    try { localStorage.removeItem(LS_KEY); } catch {}
  });
  $("secretInput").addEventListener("keydown", async (ev) => {
    if (ev.key === "Enter") { ev.preventDefault(); try { await doUnlock({ silent: false }); } catch {} }
  });

  $("btnLogout").addEventListener("click", () => logout());

  $("btnReload").addEventListener("click", async () => {
    if (!unlocked) return;
    try {
      showLoading("Cargando…", "Actualizando información.");
      await loadAll(COSTS_SECRET);
    } catch (e) {
      console.error("[Purchases] reload error:", e);
      setText("metaText", "Error recargando: " + (e?.message || String(e)));
    } finally {
      hideLoading();
    }
  });

  $("btnRegister").addEventListener("click", async () => {
    if (!unlocked) return;
    const items = collectPurchasesFromTable();
    if (!items.length) { setText("metaText", "No hay compras para registrar."); return; }

    try {
      showLoading("Registrando…", "Enviando compras al servidor.");
      const res = await api({ action: "inventory_add_purchase_batch", costs_secret: COSTS_SECRET, items }, { timeoutMs: 30000 });
      if (!res?.ok) throw new Error(res?.error || "No se pudo registrar.");
      setText("metaText", "Compras registradas. Actualizando…");
      await loadAll(COSTS_SECRET);
    } catch (e) {
      console.error("[Purchases] register error:", e);
      setText("metaText", "Error registrando: " + (e?.message || String(e)));
    } finally {
      hideLoading();
    }
  });

  showLogin("Ingresa tu clave de Costos para iniciar.");
  setButtonsEnabled(false);
  setText("metaText", "Desbloquea con tu clave de Costos para iniciar.");

  let saved = "";
  try { saved = asString(localStorage.getItem(LS_KEY)); } catch {}
  saved = asString(saved).trim();

  if (saved) {
    COSTS_SECRET = saved;
    $("secretInput").value = saved;
    try { await doUnlock({ silent: true }); }
    catch (e) {
      console.warn("[Purchases] auto-unlock failed:", e);
      try { localStorage.removeItem(LS_KEY); } catch {}
      COSTS_SECRET = "";
      hideLoading();
      showLogin("Clave guardada inválida o expirada. Ingresa nuevamente.");
    }
  }
}

document.addEventListener("DOMContentLoaded", boot);
