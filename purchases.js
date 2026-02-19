/* Purchases - Compras & Inventario (AMARED) */
const WORKER_URL = "https://amared-orders.amaredpostres.workers.dev/";
const STORAGE_KEY = "AMARED_PURCHASES_COSTS_SECRET";
const WINDOW_HOURS = 36;

let UNLOCKED_SECRET = "";
let NEEDS = {};      // ingrediente -> necesario (u base)
let INV = {};        // ingrediente -> inventario (u base)
let UNIT = {};       // ingrediente -> unidad (g/ml/unidad)
let COST_U = {};     // ingrediente -> costo por unidad base (COP)
let USED_ORDERS = 0; // pedidos usados en cálculo
let LOCK_EXPIRES_AT = 0;

const $ = (id) => document.getElementById(id);

const appWrap = $("appWrap");
// IDs reales del HTML
const meta = $("metaText");
const rows = $("rows");

const btnUnlock = $("btnUnlock");           // en header (logout)
const btnReload = $("btnReload");
const btnRegister = $("btnRegister");

const unlockBack = $("unlockBack");         // login modal
const secretInput = $("secretInput");
const btnCancelUnlock = $("btnCancelUnlock");
const btnDoUnlock = $("btnDoUnlock");
const unlockMsg = $("unlockMsg");

const loadingBack = $("loadingBack");
const loadingTitle = $("loadingTitle");
const loadingMsg = $("loadingSub");

function setLoading(on, title = "Cargando…", msg = "Procesando…") {
  loadingBack.hidden = !on;
  if (!on) return;
  if (loadingTitle) loadingTitle.textContent = title;
  if (loadingMsg) loadingMsg.textContent = msg;
}

function setMeta(text) {
  if (!meta) return;
  meta.textContent = text || "—";
}

function setUnlockMsg(text) {
  unlockMsg.textContent = text || "";
}

function fmtInt(n) {
  const x = Number(n || 0);
  return x.toLocaleString("es-CO");
}

function showLogin() {
  appWrap.hidden = true;
  unlockBack.hidden = false;
  setMeta("Desbloquea con tu clave de Costos para iniciar.");
}

function showApp() {
  unlockBack.hidden = true;
  appWrap.hidden = false;
  btnUnlock.textContent = "Salir";
}

async function api(body) {
  // Adjunta secret automáticamente si ya está desbloqueado (y no lo mandan explícito)
  const payload = { ...(body || {}) };
  if (UNLOCKED_SECRET && payload.costs_secret == null) payload.costs_secret = UNLOCKED_SECRET;

  const res = await fetch(WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const txt = await res.text();
  let data = null;
  try { data = JSON.parse(txt); } catch (_) {}

  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || txt.slice(0, 180) || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  if (data && data.ok === false) {
    throw new Error(data.error || "Error desconocido");
  }
  return data ?? { ok: true, raw: txt };
}

async function validateSecret(secret) {
  // Validamos usando una llamada real protegida (igual que Costos).
  // Si la clave es incorrecta, el Worker debe responder 401/ok:false.
  await api({ action: "costs_list", costs_secret: secret });
  return true;
}

function clearData() {
  NEEDS = {};
  INV = {};
  UNIT = {};
  COST_U = {};
  USED_ORDERS = 0;
  LOCK_EXPIRES_AT = 0;
  rows.innerHTML = "";
}

function buildRows() {
  const keys = Array.from(new Set([...Object.keys(NEEDS), ...Object.keys(INV), ...Object.keys(COST_U)])).sort((a, b) => a.localeCompare(b, "es"));
  return keys.map((k) => {
    const need = Number(NEEDS[k] || 0);
    const inv = Number(INV[k] || 0);
    const falt = Math.max(0, need - inv);
    const unit = UNIT[k] || "u";
    const costu = Number(COST_U[k] || 0);
    return { k, need, inv, falt, unit, costu };
  });
}

function render() {
  const list = buildRows();
  rows.innerHTML = "";

  for (const it of list) {
    const tr = document.createElement("tr");

    const tdName = document.createElement("td");
    tdName.textContent = it.k;
    tr.appendChild(tdName);

    const tdNeed = document.createElement("td");
    tdNeed.className = "num";
    tdNeed.textContent = fmtInt(it.need);
    tr.appendChild(tdNeed);

    const tdInv = document.createElement("td");
    tdInv.className = "num";
    tdInv.textContent = fmtInt(it.inv);
    tr.appendChild(tdInv);

    const tdF = document.createElement("td");
    tdF.className = "num";
    tdF.textContent = fmtInt(it.falt);
    tr.appendChild(tdF);

    const tdU = document.createElement("td");
    tdU.textContent = it.unit;
    tr.appendChild(tdU);

    const tdC = document.createElement("td");
    tdC.className = "num";
    tdC.textContent = it.costu ? fmtInt(Math.round(it.costu)) : "—";
    tr.appendChild(tdC);

    const tdBuy = document.createElement("td");
    tdBuy.className = "num";
    const inp = document.createElement("input");
    inp.className = "inp small num";
    inp.inputMode = "numeric";
    inp.placeholder = "0";
    inp.dataset.ing = it.k;
    tdBuy.appendChild(inp);
    tr.appendChild(tdBuy);

    const tdIn = document.createElement("td");
    tdIn.className = "num";
    tdIn.textContent = "0";
    tr.appendChild(tdIn);

    rows.appendChild(tr);
  }
}

async function loadAll() {
  if (!UNLOCKED_SECRET) return;

  setLoading(true, "Cargando…", "Leyendo inventario, costos y necesidades…");
  try {
    const [invRes, costsRes, needsRes] = await Promise.all([
      api({ action: "inventory_get" }),
      api({ action: "costs_list" }),
      api({ action: "costs_orders_for_purchases", window_hours: WINDOW_HOURS }),
    ]);

    // inventory_get
    INV = (invRes && invRes.inventory) || {};
    UNIT = (invRes && invRes.unit) || UNIT;

    // costs_list
    COST_U = (costsRes && costsRes.cost_u) || (costsRes && costsRes.costs_u) || {};
    UNIT = (costsRes && costsRes.unit) || UNIT;

    // needs from orders
    NEEDS = (needsRes && (needsRes.needs || needsRes.need || needsRes.needed)) || {};
    USED_ORDERS = Number(needsRes && (needsRes.used_orders || needsRes.used || needsRes.count)) || 0;
    LOCK_EXPIRES_AT = Number(needsRes && needsRes.lock_expires_at) || 0;

    render();
    const usedTxt = `Pedidos usados: ${USED_ORDERS}/0 · Ventana: ${WINDOW_HOURS}h`;
    setMeta(`Desbloqueado. ${usedTxt}`);
  } catch (err) {
    console.error("[Purchases] loadAll error", err);
    setMeta(`Error cargando datos: ${err.message || err}`);
  } finally {
    setLoading(false);
  }
}

async function registerPurchases() {
  if (!UNLOCKED_SECRET) return;

  const inputs = rows.querySelectorAll("input[data-ing]");
  const buys = [];
  for (const inp of inputs) {
    const ing = inp.dataset.ing;
    const val = Number(String(inp.value || "").replace(",", "."));
    if (!val || val <= 0) continue;
    buys.push({ ing, qty: val });
  }

  if (!buys.length) {
    alert("No hay cantidades para registrar.");
    return;
  }

  setLoading(true, "Registrando…", "Actualizando inventario en la base de datos…");
  try {
    await api({ action: "inventory_add_purchase_batch", purchases: buys });
    // Limpia inputs
    for (const inp of inputs) inp.value = "";
    await loadAll();
    alert("Compras registradas ✅");
  } catch (err) {
    console.error("[Purchases] registerPurchases error", err);
    alert(`Error registrando compras: ${err.message || err}`);
  } finally {
    setLoading(false);
  }
}

async function doUnlock(opts = {}) {
  const secret = (opts.secretOverride ?? secretInput.value ?? "").trim();
  if (!secret) {
    setUnlockMsg("Ingresa tu clave.");
    return;
  }

  btnDoUnlock.disabled = true;
  setUnlockMsg("Validando clave…");

  try {
    await validateSecret(secret);

    UNLOCKED_SECRET = secret;
    localStorage.setItem(STORAGE_KEY, secret);

    setUnlockMsg("");
    showApp();

    // Carga sin “volver a bloquear” si algo falla aquí
    await loadAll();
  } catch (err) {
    console.error("[Purchases] unlock error", err);
    UNLOCKED_SECRET = "";
    localStorage.removeItem(STORAGE_KEY);
    clearData();
    showLogin();

    setUnlockMsg(err.message || "Clave inválida.");
    secretInput.focus();
    secretInput.select();
  } finally {
    btnDoUnlock.disabled = false;
  }
}

function logout() {
  UNLOCKED_SECRET = "";
  localStorage.removeItem(STORAGE_KEY);
  clearData();
  showLogin();
  setUnlockMsg("");
  secretInput.value = "";
  secretInput.focus();
}

function boot() {
  // En este modo, SIEMPRE arrancamos bloqueados (login visible, app oculta)
  showLogin();

  // Eventos
  btnUnlock.addEventListener("click", logout);
  btnReload.addEventListener("click", loadAll);
  btnRegister.addEventListener("click", registerPurchases);

  btnDoUnlock.addEventListener("click", () => doUnlock());
  secretInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doUnlock();
  });

  // Cancel no cierra el login (para que no se vea info sin clave)
  if (btnCancelUnlock) {
    btnCancelUnlock.addEventListener("click", () => {
      secretInput.value = "";
      setUnlockMsg("");
      secretInput.focus();
    });
  }

  // Auto-login si hay clave guardada
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    secretInput.value = saved;
    doUnlock({ secretOverride: saved, silent: true });
  } else {
    secretInput.focus();
  }
}

document.addEventListener("DOMContentLoaded", boot);
