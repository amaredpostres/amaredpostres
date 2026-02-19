/* AMARED Purchases - client */
"use strict";

const API_URL = "https://amared-orders.amaredpostres.workers.dev/";
const LS_SECRET_KEY = "AMARED_COSTS_SECRET";

let UNLOCKED_SECRET = "";
let state = {
  items: [],
  inventory: {},
  needs: {},
  orders_used: 0,
  orders_limit: 11,
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

  // Si el worker devuelve no-2xx
  if(!res.ok){
    throw new Error(out?.error || out?.message || `HTTP ${res.status}`);
  }

  if(!out || out.ok !== true){
    throw new Error(out?.error || "Error");
  }
  return out;
}

async function validateSecret(secret){
  // Usamos un endpoint que ya funciona en Costs (evita acciones inexistentes)
  await api({ action: "costs_list", costs_secret: secret }, {timeoutMs: 30000});
  return true;
}

function fmtNum(n){
  if(n === null || n === undefined || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("es-CO").format(n);
}

function getUnitFor(name){
  // En costs_list viene unidad por item; si no, cae a g
  const it = state.items.find(x => (x?.name||"") === name);
  return (it && it.unit) ? it.unit : "g";
}

function getCostPerUnit(name){
  const it = state.items.find(x => (x?.name||"") === name);
  const v = it?.cost_per_unit;
  return (typeof v === "number" && isFinite(v)) ? v : null;
}

function computeRow(name){
  const need = Number(state.needs?.[name] || 0);
  const inv  = Number(state.inventory?.[name] || 0);
  const missing = Math.max(0, need - inv);
  const unit = getUnitFor(name);
  const cpu = getCostPerUnit(name);
  return {name, need, inv, missing, unit, cpu};
}

function renderTable(){
  const tbody = el("rows");
  if(!tbody) return;
  tbody.innerHTML = "";

  const names = state.items.map(x => x.name).filter(Boolean);
  names.sort((a,b)=>a.localeCompare(b, "es"));

  for(const name of names){
    const r = computeRow(name);
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${escapeHtml(r.name)}</td>
      <td class="num">${fmtNum(r.need)}</td>
      <td class="num">${fmtNum(r.inv)}</td>
      <td class="num">${fmtNum(r.missing)}</td>
      <td>${escapeHtml(r.unit)}</td>
      <td class="num">${r.cpu === null ? "—" : fmtNum(Math.round(r.cpu))}</td>
      <td class="num"><input class="inp inpSm" data-buy="${escapeAttr(r.name)}" type="number" min="0" step="any" placeholder="0"/></td>
      <td class="num"><button class="btn" data-add="${escapeAttr(r.name)}">+</button></td>
    `;

    tbody.appendChild(tr);
  }

  // listeners para sumar al inventario local
  tbody.querySelectorAll("button[data-add]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const name = btn.getAttribute("data-add") || "";
      const inp = tbody.querySelector(`input[data-buy="${cssEscape(name)}"]`);
      const val = inp ? Number(inp.value || 0) : 0;
      if(!val || val <= 0) return;
      state.inventory[name] = Number(state.inventory[name] || 0) + val;
      if(inp) inp.value = "";
      renderTable();
    });
  });
}

function escapeHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));
}

function escapeAttr(s){
  // para data-* (seguimos escapando)
  return escapeHtml(s);
}

function cssEscape(s){
  // escape mínimo para querySelector
  return String(s).replace(/\\/g,"\\\\").replace(/"/g,'\\"');
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
  state.orders_used = Number(needsOut.orders_used || 0);
  state.orders_limit = Number(needsOut.orders_limit || 11);
  state.items = costsOut.items || [];

  setMeta(`Pedidos usados: ${state.orders_used}/${state.orders_limit} · Ventana: ${state.window_h}h`);
  renderTable();
}

async function doUnlock(isAuto=false){
  const inp = el("secretInput");
  const secret = String(inp?.value || "").trim();

  if(!secret){
    if(el("unlockMsg")) el("unlockMsg").textContent = "Ingresa la clave.";
    return;
  }

  // Validar
  showLoading("Validando…", "Un momento.");
  try{
    await validateSecret(secret);

    // guardar
    UNLOCKED_SECRET = secret;
    localStorage.setItem(LS_SECRET_KEY, secret);

    // Mostrar app, ocultar login, y cargar todo
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

async function boot(){
  // botones
  if(el("btnReload")) el("btnReload").addEventListener("click", async()=>{
    if(!UNLOCKED_SECRET){ openUnlock("Desbloquea con tu clave de Costos para iniciar."); return; }
    showLoading("Cargando…", "Actualizando.");
    try{ await loadAll(); } finally { hideLoading(); }
  });

  if(el("btnUnlockTop")) el("btnUnlockTop").addEventListener("click", ()=>openUnlock());
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
    // intenta desbloquear sin mostrar error "ruidoso" si falla
    setTimeout(()=>doUnlock(true), 100);
  }
}

document.addEventListener("DOMContentLoaded", boot);
