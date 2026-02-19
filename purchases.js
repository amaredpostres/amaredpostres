/* AMARED Purchases (single-page) */

const API_URL = "https://amared-orders.amaredpostres.workers.dev/";
const STORAGE_KEY = "AMARED_COSTS_SECRET";

let UNLOCKED_SECRET = "";
let STATE = {
  costsByKey: new Map(),
  inventoryByKey: new Map(),
  needsByKey: new Map(),
  meta: null,
};

const $ = (id) => document.getElementById(id);

function showLoading(title, sub) {
  const back = $("loadingBack");
  if (!back) return;
  $("loadingTitle").textContent = title || "Cargando…";
  $("loadingSub").textContent = sub || "Un momento.";
  back.hidden = false;
}

function hideLoading() {
  const back = $("loadingBack");
  if (!back) return;
  back.hidden = true;
}

function setLoginMsg(msg) {
  const el = $("unlockMsg");
  if (el) el.textContent = msg || "";
}

function fmtInt(n) {
  const x = Number(n || 0);
  return x.toLocaleString("es-CO");
}

function fmtQty(n) {
  const x = Number(n || 0);
  // hasta 3 decimales, sin ceros a la derecha
  const s = (Math.round(x * 1000) / 1000).toString();
  return s;
}

async function api(payload, secretOverride) {
  const secret = typeof secretOverride === "string" ? secretOverride : UNLOCKED_SECRET;
  const body = {
    ...payload,
    ...(secret ? { costs_secret: secret } : {}),
  };

  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  let json = null;
  try {
    json = await res.json();
  } catch {
    // ignore
  }

  if (!res.ok) {
    const msg = (json && (json.error || json.message)) ? (json.error || json.message) : `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.json = json;
    throw err;
  }

  if (json && json.ok === false) {
    const err = new Error(json.error || "Error" );
    err.json = json;
    throw err;
  }

  return json;
}

function showLoginScreen() {
  $("app").hidden = true;
  $("unlockBack").hidden = false;
  $("btnReload").disabled = true;
  $("btnRegister").disabled = true;
}

function showAppScreen() {
  $("unlockBack").hidden = true;
  $("app").hidden = false;
  $("btnReload").disabled = false;
  $("btnRegister").disabled = false;
}

function clearTable() {
  $("rows").innerHTML = "";
  $("metaText").textContent = "";
}

async function validateSecret(secret) {
  // Validación rápida: si la clave es correcta, costs_list responde OK.
  await api({ action: "costs_list", limit: 1 }, secret);
}

async function loadAll() {
  const [costs, inv, ordersNeeds] = await Promise.all([
    api({ action: "costs_list" }),
    api({ action: "inventory_get" }),
    api({ action: "costs_orders_for_purchases", window_hours: 36 }),
  ]);

  // costs
  STATE.costsByKey = new Map();
  const items = (costs && costs.items) ? costs.items : [];
  for (const it of items) {
    const k = it.ingredient_key || it.key || it.ingredient || it.name;
    if (!k) continue;
    STATE.costsByKey.set(k, it);
  }

  // inventory
  STATE.inventoryByKey = new Map();
  const invObj = (inv && inv.inventory) ? inv.inventory : {};
  for (const [k, v] of Object.entries(invObj)) {
    STATE.inventoryByKey.set(k, v);
  }

  // needs
  STATE.needsByKey = new Map();
  const needsObj = (ordersNeeds && ordersNeeds.needs) ? ordersNeeds.needs : {};
  for (const [k, v] of Object.entries(needsObj)) {
    STATE.needsByKey.set(k, Number(v || 0));
  }

  STATE.meta = (ordersNeeds && ordersNeeds.meta) ? ordersNeeds.meta : null;

  render();
}

function render() {
  const keys = new Set();
  for (const k of STATE.costsByKey.keys()) keys.add(k);
  for (const k of STATE.inventoryByKey.keys()) keys.add(k);
  for (const k of STATE.needsByKey.keys()) keys.add(k);

  const sorted = Array.from(keys).sort((a, b) => a.localeCompare(b, "es"));

  const tbody = $("rows");
  tbody.innerHTML = "";

  for (const key of sorted) {
    const c = STATE.costsByKey.get(key) || {};
    const inv = STATE.inventoryByKey.get(key) || {};

    const name = c.display_name || c.ingredient_name || c.ingredient || key;
    const unit = c.unit || inv.unit || "";

    const needed = Number(STATE.needsByKey.get(key) || 0);
    const inStock = Number(inv.qty || 0);
    const missing = Math.max(0, needed - inStock);
    const cop = Number(c.cop_per_unit || 0);

    const tr = document.createElement("tr");
    tr.dataset.key = key;
    tr.innerHTML = `
      <td class="name">${escapeHtml(name)}</td>
      <td class="num">${fmtQty(needed)}</td>
      <td class="num">${fmtQty(inStock)}</td>
      <td class="num"><b>${fmtQty(missing)}</b></td>
      <td>${escapeHtml(unit)}</td>
      <td class="num">${cop ? fmtInt(cop) : "—"}</td>
      <td class="num"><input class="inp inpNum" inputmode="decimal" placeholder="0" value="${missing ? fmtQty(missing) : ""}" /></td>
      <td><label class="chk"><input type="checkbox" checked /> Incluir</label></td>
    `;
    tbody.appendChild(tr);
  }

  // meta
  const meta = STATE.meta || {};
  const used = meta.used_orders ?? 0;
  const total = meta.total_orders ?? 0;
  const hrs = meta.window_hours ?? 36;
  $("metaText").textContent = `Pedidos usados: ${used}/${total} · Ventana: ${hrs}h`;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getRowEntries() {
  const out = [];
  for (const tr of $("rows").querySelectorAll("tr")) {
    const key = tr.dataset.key;
    const c = STATE.costsByKey.get(key) || {};
    const unit = c.unit || (STATE.inventoryByKey.get(key) || {}).unit || "";
    const cop = Number(c.cop_per_unit || 0) || null;

    const qtyInp = tr.querySelector("input.inpNum");
    const chk = tr.querySelector("input[type=checkbox]");

    const qty = Number((qtyInp?.value || "").toString().replace(",", "."));
    if (!chk?.checked) continue;
    if (!qty || qty <= 0) continue;

    out.push({ ingredient_key: key, qty, unit, cop_per_unit: cop });
  }
  return out;
}

async function doUnlock() {
  const btn = $("btnUnlockOk");
  const input = $("secretInput");

  const secret = (input?.value || "").trim();
  if (!secret) {
    setLoginMsg("Ingresa la clave.");
    return;
  }

  btn.disabled = true;
  input.disabled = true;
  setLoginMsg("");

  try {
    showLoading("Validando…", "Un momento.");
    await validateSecret(secret);

    UNLOCKED_SECRET = secret;
    // Guardamos para que NO tengas que volver a pegarla, pero NO intentamos auto-desbloquear.
    try {
      sessionStorage.setItem(STORAGE_KEY, secret);
    } catch {}

    showLoading("Cargando…", "Leyendo inventario y necesidades.");
    await loadAll();

    hideLoading();
    showAppScreen();
  } catch (e) {
    console.error("[Purchases] unlock error:", e);

    hideLoading();
    UNLOCKED_SECRET = "";

    if (e && e.status === 401) {
      setLoginMsg("Clave inválida o sin permisos.");
    } else {
      setLoginMsg(`Error: ${e?.message || e}`);
    }

    showLoginScreen();
  } finally {
    btn.disabled = false;
    input.disabled = false;
  }
}

async function reloadAll() {
  try {
    showLoading("Cargando…", "Actualizando datos.");
    await loadAll();
  } catch (e) {
    console.error("[Purchases] reload error:", e);
    alert(`Error cargando datos: ${e?.message || e}`);
  } finally {
    hideLoading();
  }
}

async function registerPurchases() {
  const items = getRowEntries();
  if (!items.length) {
    alert("No hay compras para registrar.");
    return;
  }

  try {
    showLoading("Registrando…", "Guardando compras en inventario.");
    await api({ action: "inventory_add_purchase_batch", items });
    await loadAll();
  } catch (e) {
    console.error("[Purchases] register error:", e);
    alert(`Error registrando compras: ${e?.message || e}`);
  } finally {
    hideLoading();
  }
}

function logout() {
  UNLOCKED_SECRET = "";
  try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
  clearTable();
  setLoginMsg("Ingresa tu clave de Costs para iniciar.");
  showLoginScreen();
}

function boot() {
  // Estado inicial
  showLoginScreen();
  clearTable();
  setLoginMsg("Ingresa tu clave de Costs para iniciar.");

  // Prefill (sin auto-validar)
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY) || "";
    if (saved) $("secretInput").value = saved;
  } catch {}

  // Eventos login
  $("btnUnlockOk").addEventListener("click", doUnlock);
  $("btnClear").addEventListener("click", () => {
    $("secretInput").value = "";
    setLoginMsg("");
    try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
  });
  $("secretInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") doUnlock();
  });

  // Eventos app
  $("btnReload").addEventListener("click", reloadAll);
  $("btnRegister").addEventListener("click", registerPurchases);
  $("btnLogout").addEventListener("click", logout);
}

document.addEventListener("DOMContentLoaded", boot);
