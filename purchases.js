/* AMARED Purchases - client (patched)
   Objetivo:
   - Cargar correctamente INVENTARIO + NECESIDADES (pedidos pagados + no iniciar en últimas N horas)
   - Mostrar faltantes por ingrediente usando el mismo ingredient_key del backend
   - Permitir "Comprar (u)" + registrar compras para actualizar INVENTARIO (Sheets) vía inventory_add_purchase_batch
*/
"use strict";

const API_URL = "https://amared-orders.amaredpostres.workers.dev/";
const LS_SECRET_KEY = "AMARED_COSTS_SECRET";

let UNLOCKED_SECRET = "";
let state = {
  items: [],          // costos_list (rows)
  costsByKey: {},     // ingredient_key -> item
  inventory: {},      // inventory_get (map)
  needs: {},          // costs_orders_for_purchases (map)
  meta: {},           // costs_orders_for_purchases.meta
  ordersByDessert: {},// costs_orders_for_purchases.orders_by_dessert (map)
  late: {},           // costs_orders_for_purchases.late
  pending: {},        // compras pendientes: ingredient_key -> qty
  window_h: 36,
};

function el(id){ return document.getElementById(id); }

function show(elm, display="flex"){
  if(!elm) return;
  elm.hidden = false;
  elm.style.display = display;
}
function hide(elm){
  if(!elm) return;
  elm.hidden = true;
  elm.style.display = "none";
}

function showApp(){
  const app = el("appRoot");
  if(!app) return;
  app.hidden = false;
  app.style.display = "block";
}
function hideApp(){
  const app = el("appRoot");
  if(!app) return;
  app.hidden = true;
  app.style.display = "none";
}

function showLoading(title, sub){
  if(el("loadingTitle")) el("loadingTitle").textContent = title || "Cargando…";
  if(el("loadingSub")) el("loadingSub").textContent = sub || "";
  show(el("loadingBack"), "flex");
}
function hideLoading(){ hide(el("loadingBack")); }

function openUnlock(message){
  hideApp();
  if(el("unlockMsg")) el("unlockMsg").textContent = message || "";
  show(el("unlockBack"), "flex");
  const inp = el("secretInput");
  if(inp) inp.focus();
}
function closeUnlock(){
  hide(el("unlockBack"));
  if(el("unlockMsg")) el("unlockMsg").textContent = "";
}

function setMeta(msg){
  const m = el("meta");
  if(m) m.textContent = msg;
}

async function api(body, {timeoutMs=30000} = {}){
  const controller = new AbortController();
  const t = setTimeout(()=>controller.abort(), timeoutMs);
  let res;
  try{
    res = await fetch(API_URL, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(t);
  }

  const raw = await res.text().catch(()=>"");
  let out;
  try{ out = raw ? JSON.parse(raw) : {ok:false, error:`HTTP ${res.status}`}; }
  catch{ out = {ok:false, error: raw || `HTTP ${res.status}`}; }

  if(!res.ok){
    throw new Error(out?.error || out?.message || `HTTP ${res.status}`);
  }
  if(!out || out.ok !== true){
    throw new Error(out?.error || "Error");
  }
  return out;
}

async function validateSecret(secret){
  // Reutiliza el mismo "ping" que Costs
  await api({ action: "costs_list", costs_secret: secret }, {timeoutMs: 30000});
  return true;
}

// =================== helpers ===================
function fmtNum(n){
  if(n === null || n === undefined || Number.isNaN(n)) return "—";
  // soporta decimales sin perderlos
  const v = Number(n);
  if(!isFinite(v)) return "—";
  return new Intl.NumberFormat("es-CO", { maximumFractionDigits: 3 }).format(v);
}

function escapeHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));
}
function escapeAttr(s){ return escapeHtml(s); }
function cssEscape(s){
  // escape mínimo para querySelector
  return String(s).replace(/\\/g,"\\\\").replace(/"/g,'\\"');
}

function getInvEntry(key){
  const v = state.inventory?.[key];
  if(v && typeof v === "object"){
    return { qty: Number(v.qty || 0), unit: String(v.unit || "").trim() };
  }
  if(typeof v === "number"){
    return { qty: Number(v || 0), unit: "" };
  }
  const n = Number(v || 0);
  return { qty: isFinite(n) ? n : 0, unit: "" };
}

function getCostItem(key){
  return state.costsByKey?.[key] || null;
}

function getUnitFor(key){
  const it = getCostItem(key);
  const u1 = String(it?.unit || "").trim();
  if(u1) return u1;
  const inv = getInvEntry(key);
  if(inv.unit) return inv.unit;
  return "g";
}

function getCostPerUnit(key){
  const it = getCostItem(key);
  const v = it?.cop_per_unit ?? it?.cost_per_unit;
  const n = Number(v);
  return (typeof n === "number" && isFinite(n)) ? n : null;
}

function collectAllKeys(){
  const keys = new Set();

  for(const it of (state.items || [])){
    const k = String(it?.ingredient_key ?? it?.key ?? it?.name ?? "").trim();
    if(k) keys.add(k);
  }
  for(const k of Object.keys(state.needs || {})) keys.add(k);
  for(const k of Object.keys(state.inventory || {})) keys.add(k);

  return Array.from(keys).filter(Boolean);
}

function buildCanon(allKeys){
  const groups = Array.isArray(window.AMARED_COSTS_SECTIONS) ? window.AMARED_COSTS_SECTIONS : null;
  const seen = new Set();
  const canon = [];

  if(groups){
    for(const g of groups){
      for(const raw of (g?.keys || [])){
        const k = String(raw || "").trim();
        if(k && !seen.has(k)){
          canon.push(k);
          seen.add(k);
        }
      }
    }
  }

  for(const k of (allKeys || [])){
    if(k && !seen.has(k)){
      canon.push(k);
      seen.add(k);
    }
  }

  // fallback: si no hay orden canónico, alfabético
  if(!groups){
    canon.sort((a,b)=>a.localeCompare(b,"es"));
  }
  return canon;
}

function computeRow(key){
  const need = Number(state.needs?.[key] || 0) || 0;

  const invBase = getInvEntry(key).qty;
  const pending = Number(state.pending?.[key] || 0) || 0;
  const invShown = invBase + pending;

  const missing = Math.max(0, need - invShown);

  const unit = getUnitFor(key);
  const cpu = getCostPerUnit(key);

  return { key, name: key, need, invBase, pending, invShown, missing, unit, cpu };
}

// =================== UI ===================
function renderTable(){
  const tbody = el("rows");
  if(!tbody) return;
  tbody.innerHTML = "";

  // keys a mostrar (union)
  const allKeys = collectAllKeys();
  const keys = buildCanon(allKeys);

  for(const key of keys){
    const r = computeRow(key);

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(r.name)}</td>
      <td class="num">${fmtNum(r.need)}</td>
      <td class="num">${fmtNum(r.invShown)}</td>
      <td class="num">${fmtNum(r.missing)}</td>
      <td>${escapeHtml(r.unit)}</td>
      <td class="num">${r.cpu === null ? "—" : fmtNum(Math.round(r.cpu))}</td>
      <td class="num"><input class="inp inpSm" data-buy="${escapeAttr(r.key)}" type="number" min="0" step="any" placeholder="0"/></td>
      <td class="num"><button class="btn" data-add="${escapeAttr(r.key)}">+</button></td>
    `;
    tbody.appendChild(tr);
  }

  // listeners: sumar a "pendientes"
  tbody.querySelectorAll("button[data-add]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const key = btn.getAttribute("data-add") || "";
      const inp = tbody.querySelector(`input[data-buy="${cssEscape(key)}"]`);
      const val = inp ? Number(inp.value || 0) : 0;
      if(!val || val <= 0) return;

      state.pending[key] = Number(state.pending?.[key] || 0) + val;
      if(inp) inp.value = "";

      renderTable();
      const totalItems = Object.keys(state.pending).filter(k => Number(state.pending[k]||0)>0).length;
      if(totalItems>0){
        setMeta(`✅ Pendientes: ${totalItems} ingrediente(s) · Pedidos usados: ${Number(state.meta?.orders_used||0)}/${Number(state.meta?.orders_limit||0)} · Ventana: ${Number(state.meta?.window_hours||state.window_h)}h`);
      }
    });
  });
}

function prettyDessertName(id){
  const s = String(id||"").trim();
  if(!s) return "";
  // casos comunes
  const map = {
    "mousse_maracuya":"Mousse de maracuyá",
    "mousse":"Mousse de maracuyá",
    "cheesecake_cafe":"Cheesecake de café con panela",
    "cheesecake_cafe_panela":"Cheesecake de café con panela",
    "cheesecake":"Cheesecake de café con panela",
    "arroz_con_leche":"Arroz con leche",
    "arroz":"Arroz con leche",
  };
  if(map[s]) return map[s];
  return s.replace(/[_-]+/g," ").replace(/\w/g, c=>c.toUpperCase());
}

function renderLateSection(){
  const card = el("lateCard");
  const tbody = el("lateRows");
  const meta = el("lateMeta");
  if(!card || !tbody) return;

  const by = state.late?.byDessert || {};
  const keys = Object.keys(by).filter(k => Number(by[k]||0) > 0);
  if(keys.length === 0){
    hide(card);
    if(tbody) tbody.innerHTML = "";
    if(meta) meta.textContent = "";
    return;
  }

  // ordenar por cantidad desc
  keys.sort((a,b)=>Number(by[b]||0)-Number(by[a]||0));

  tbody.innerHTML = keys.map(k=>{
    const qty = Number(by[k]||0);
    return `<tr>
      <td>${escapeHtml(prettyDessertName(k))}</td>
      <td class="num">${fmtNum(qty)}</td>
    </tr>`;
  }).join("");

  const used = Number(state.late?.orders_used || 0);
  const w0 = String(state.meta?.late_window_start || "").trim();
  const w1 = String(state.meta?.late_window_end || "").trim();
  if(meta){
    meta.textContent = `Pedidos: ${used}${(w0&&w1)?(" · Ventana: "+w0+" → "+w1):""}`;
  }

  show(card, "block");
}



// =================== data ===================
function indexCosts(items){
  const map = {};
  for(const it of (items || [])){
    const k = String(it?.ingredient_key ?? it?.key ?? it?.name ?? "").trim();
    if(!k) continue;
    map[k] = it;
  }
  state.costsByKey = map;
}

async function loadAll(){
  if(!UNLOCKED_SECRET) throw new Error("Sin clave.");

  setMeta("Cargando inventario, necesidades y costos…");

  const [invOut, needsOut, costsOut] = await Promise.all([
    api({ action: "inventory_get", costs_secret: UNLOCKED_SECRET }),
    api({ action: "costs_orders_for_purchases", costs_secret: UNLOCKED_SECRET, window_h: state.window_h }),
    api({ action: "costs_list", costs_secret: UNLOCKED_SECRET }),
  ]);

  state.inventory = invOut.inventory || {};
  state.needs = needsOut.needs || {};
  state.meta = needsOut.meta || {};
  state.ordersByDessert = needsOut.orders_by_dessert || needsOut.ordersByDessert || {};
  state.late = needsOut.late || {};
  state.items = costsOut.items || [];
  indexCosts(state.items);

  // no borramos pendientes (si estabas digitando), pero los recalculamos en pantalla
  const used = Number(state.meta?.orders_used || 0);
  const lim  = Number(state.meta?.orders_limit || 0);
  const w0   = String(state.meta?.window_start || "").trim();
  const w1   = String(state.meta?.window_end || "").trim();
  const wh   = Number(state.meta?.window_hours || state.window_h);

  const winText = (w0 && w1) ? `${w0} → ${w1}` : `${wh}h`;
  const ordersText = lim ? `Pedidos: ${used}/${lim}` : `Pedidos: ${used}`;
  setMeta(`Ventana: ${winText} · ${ordersText}`);

  renderTable();
  renderLateSection();
}

// =================== compras -> inventario (Sheets) ===================
function buildPurchaseBatch(){
  const entries = [];
  for(const [k,v] of Object.entries(state.pending || {})){
    const qty = Number(v || 0);
    if(!qty || qty <= 0) continue;

    const unit = getUnitFor(k);
    const cpu = getCostPerUnit(k);
    const row = { ingredient_key: k, qty, unit };
    if(cpu !== null) row.cop_per_unit = cpu;
    entries.push(row);
  }
  return entries;
}

async function registerPurchases(){
  if(!UNLOCKED_SECRET){
    openUnlock("Desbloquea con tu clave de Costos para iniciar.");
    return;
  }

  const items = buildPurchaseBatch();
  if(items.length === 0){
    setMeta("No hay compras pendientes para registrar.");
    return;
  }

  showLoading("Registrando compras…", "Actualizando inventario en la base de datos.");
  try{
    const out = await api({
      action: "inventory_add_purchase_batch",
      costs_secret: UNLOCKED_SECRET,
      items
    }, {timeoutMs: 60000});

    // backend devuelve inventory actualizado
    state.inventory = out.inventory || state.inventory;
    state.pending = {};

    // refresca para recalcular "Falta" con inventario real
    await loadAll();

    setMeta("✅ Compras registradas y inventario actualizado.");
  } catch(err){
    setMeta(`❌ Error registrando compras: ${(err && err.message) ? err.message : "Error"}`);
  } finally {
    hideLoading();
  }
}

// =================== auth ===================
async function doUnlock(isAuto=false){
  const inp = el("secretInput");
  const secret = String(inp?.value || "").trim();

  if(!secret){
    if(el("unlockMsg")) el("unlockMsg").textContent = "Ingresa la clave.";
    return;
  }

  showLoading("Validando…", "Un momento.");
  try{
    await validateSecret(secret);

    UNLOCKED_SECRET = secret;
    localStorage.setItem(LS_SECRET_KEY, secret);

    closeUnlock();
    showApp();

    showLoading("Cargando…", "Leyendo inventario y calculando necesidades.");
    await loadAll();

    hideLoading();
  } catch(err){
    hideLoading();
    UNLOCKED_SECRET = "";
    if(!isAuto) localStorage.removeItem(LS_SECRET_KEY);
    openUnlock();
    if(el("unlockMsg")) el("unlockMsg").textContent = (err && err.message) ? err.message : "Clave inválida o sin permisos.";
  }
}

function clearSecret(){
  UNLOCKED_SECRET = "";
  localStorage.removeItem(LS_SECRET_KEY);
  const inp = el("secretInput");
  if(inp) inp.value = "";
  openUnlock();
}

// =================== boot ===================
async function boot(){
  if(el("btnReload")) el("btnReload").addEventListener("click", async()=>{
    if(!UNLOCKED_SECRET){ openUnlock("Desbloquea con tu clave de Costos para iniciar."); return; }
    showLoading("Cargando…", "Actualizando.");
    try{ await loadAll(); } finally { hideLoading(); }
  });

  if(el("btnRegister")) el("btnRegister").addEventListener("click", registerPurchases);
  if(el("btnExit")) el("btnExit").addEventListener("click", ()=>{ window.location.href = "index.html"; });

  if(el("btnDoUnlock")) el("btnDoUnlock").addEventListener("click", ()=>doUnlock(false));
  if(el("btnClear")) el("btnClear").addEventListener("click", clearSecret);

  const inp = el("secretInput");
  if(inp){
    inp.addEventListener("keydown", (e)=>{
      if(e.key === "Enter") doUnlock(false);
    });
  }

  // Arranque: bloqueado
  hideApp();
  openUnlock("Ingresa tu clave de Costos para iniciar.");

  // Auto-validación si existe clave guardada
  const saved = String(localStorage.getItem(LS_SECRET_KEY) || "").trim();
  if(saved && saved !== "null" && saved !== "undefined"){
    if(inp) inp.value = saved;
    setTimeout(()=>doUnlock(true), 100);
  }
}

document.addEventListener("DOMContentLoaded", boot);
