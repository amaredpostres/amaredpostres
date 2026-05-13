;
// delivery.js — AMARED Envíos (v4 UX + Historial + Opt-in fix)
"use strict";

console.log("AMARED delivery v21 · Rutas Maps con parada manual limpia");

const API_URL = "https://amared-orders.amaredpostres.workers.dev/";
const AMARED_ROUTE_ORIGIN_LABEL = "Edificio Kiwana";
const AMARED_ROUTE_ORIGIN_ADDRESS = "Edificio Kiwana, Cl. 53 #6A-21, Ibagué, Tolima";
const AMARED_ROUTE_UNKNOWN = {
  id: "por_asignar",
  label: "Ruta por asignar",
  short: "Por asignar",
  description: "Revisar manualmente el barrio o la ubicación del cliente.",
  score: 50
};
const AMARED_ROUTE_DEFINITIONS = {
  occidente: {
    id: "occidente",
    label: "Ruta 1 · Comunas 1, 2, 3, 4, 10, 11, 12 y 13",
    short: "Ruta 1",
    description: "Zona centro/base y sectores hacia centro, occidente y sur de Ibagué.",
    score: 30
  },
  oriente: {
    id: "oriente",
    label: "Ruta 2 · Comunas 5, 6, 7, 8 y 9",
    short: "Ruta 2",
    description: "Sectores hacia Jordán, Vergel, Mirolindo, Picaleña, Salado y aeropuerto.",
    score: 70
  },
  por_asignar: AMARED_ROUTE_UNKNOWN
};
const AMARED_NEIGHBORHOOD_ROUTES = Array.isArray(window.AMARED_IBAGUE_NEIGHBORHOODS) && window.AMARED_IBAGUE_NEIGHBORHOODS.length
  ? window.AMARED_IBAGUE_NEIGHBORHOODS
  : [
      { name:"Edificio Kiwana", aliases:["kiwana", "edificio kiwana", "calle 53", "cl 53"], route:"occidente", score:1 },
      { name:"Centro", aliases:["centro", "la pola", "belén", "belen", "interlaken"], route:"occidente", score:4 },
      { name:"Jordán", aliases:["jordan", "jordán", "jordan 1", "jordán 1"], route:"oriente", score:5 },
      { name:"Mirolindo", aliases:["mirolindo", "avenida mirolindo"], route:"oriente", score:7 },
      { name:"El Salado", aliases:["salado", "el salado", "aeropuerto", "perales"], route:"oriente", score:10 }
    ];
const ROUTE_SORT_MODE_KEY = "AMARED_DELIVERY_ROUTE_SORT_MODE_V1";
function loadRouteSortMode(){
  try{
    const saved = String(localStorage.getItem(ROUTE_SORT_MODE_KEY) || "near");
    return saved === "far" || saved === "manual" ? saved : "near";
  }catch(_e){ return "near"; }
}
function saveRouteSortMode(){
  try{ localStorage.setItem(ROUTE_SORT_MODE_KEY, ROUTE_SORT_MODE); }catch(_e){}
}
let ROUTE_SORT_MODE = loadRouteSortMode();
const ROUTE_COLLAPSED_KEY = "AMARED_DELIVERY_ROUTE_COLLAPSED_V1";
function loadRouteCollapsedState(){
  try{
    const raw = JSON.parse(localStorage.getItem(ROUTE_COLLAPSED_KEY) || "[]");
    return new Set(Array.isArray(raw) ? raw.map(String) : []);
  }catch(_e){
    return new Set();
  }
}
function saveRouteCollapsedState(){
  try{ localStorage.setItem(ROUTE_COLLAPSED_KEY, JSON.stringify(Array.from(ROUTE_COLLAPSED || []))); }catch(_e){}
}
let ROUTE_COLLAPSED = loadRouteCollapsedState();
const ROUTE_MANUAL_ORDER_KEY = "AMARED_DELIVERY_ROUTE_MANUAL_ORDER_V1";
function loadRouteManualOrderState(){
  try{
    const raw = JSON.parse(localStorage.getItem(ROUTE_MANUAL_ORDER_KEY) || "{}");
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  }catch(_e){
    return {};
  }
}
function saveRouteManualOrderState(){
  try{ localStorage.setItem(ROUTE_MANUAL_ORDER_KEY, JSON.stringify(ROUTE_MANUAL_ORDER || {})); }catch(_e){}
}
let ROUTE_MANUAL_ORDER = loadRouteManualOrderState();

const ROUTE_CARD_EXPANDED_KEY = "AMARED_DELIVERY_ROUTE_CARD_EXPANDED_V1";
function loadRouteCardExpandedState(){
  try{
    const raw = JSON.parse(localStorage.getItem(ROUTE_CARD_EXPANDED_KEY) || "[]");
    return new Set(Array.isArray(raw) ? raw.map(String) : []);
  }catch(_e){
    return new Set();
  }
}
function saveRouteCardExpandedState(){
  try{ localStorage.setItem(ROUTE_CARD_EXPANDED_KEY, JSON.stringify(Array.from(ROUTE_CARD_EXPANDED || []))); }catch(_e){}
}
let ROUTE_CARD_EXPANDED = loadRouteCardExpandedState();
let ROUTE_DRAG_STATE = null;
const COORDS_RESOLVE_IN_FLIGHT = new Set();
const SS_KEY = "AMARED_DELIVERY_SESSION_V4";
const LS_KEY = "AMARED_DELIVERY_REMEMBER_V1";
const HUB_URL = "hub.html";
const HUB_SESSION_KEY = "AMARED_HUB_SESSION_V1";
const HUB_REMEMBER_KEY = "AMARED_HUB_REMEMBER_V1";
const DELIVERY_LOGIN_CACHE_KEY = "AMARED_PAGECACHE_DELIVERY_LOGIN_V1";
const DELIVERY_DATA_CACHE_KEY = "AMARED_PAGECACHE_DELIVERY_DATA_V1";
const FROM_HUB = (() => { try { return new URLSearchParams(window.location.search).get("hub") === "1"; } catch { return false; } })();
function hasHubAccess_(){
  try{ return FROM_HUB || !!sessionStorage.getItem(HUB_SESSION_KEY) || !!localStorage.getItem(HUB_REMEMBER_KEY); }catch(_e){ return FROM_HUB; }
}
function revealHubBoot_(){
  try{ document.documentElement.classList.remove("hubBoot"); document.documentElement.classList.add("hubReady"); }catch(_e){}
}
function ensureApiWarmup_(){
  try{
    if(document.getElementById("amApiWarmupLink")) return;
    const u = new URL(API_URL);
    const pre = document.createElement("link");
    pre.id = "amApiWarmupLink";
    pre.rel = "preconnect";
    pre.href = u.origin;
    pre.crossOrigin = "anonymous";
    document.head.appendChild(pre);
    const dns = document.createElement("link");
    dns.rel = "dns-prefetch";
    dns.href = u.origin;
    document.head.appendChild(dns);
  }catch(_e){}
}

function goHub_(){
  try{
    const ref = String(document.referrer || '');
    if((FROM_HUB || /(^|\/)hub\.html(?:\?|$)/i.test(ref)) && window.history.length > 1){
      window.history.back();
      return;
    }
  }catch(_e){}
  window.location.href = HUB_URL;
}
function ensureHubReturnStyles_(){
  if(document.getElementById("amHubReturnStyles")) return;
  const st = document.createElement("style");
  st.id = "amHubReturnStyles";
  st.textContent = `
    .amHubReturnChip{position:fixed; top:calc(env(safe-area-inset-top, 0px) + 88px); right:14px; bottom:auto; z-index:9499; display:none; align-items:center; justify-content:center; min-height:40px; padding:0 15px; border-radius:999px; border:1px solid rgba(255,255,255,.96); background:linear-gradient(180deg, rgba(246,186,96,.97), rgba(242,91,143,.88)); box-shadow:0 12px 24px rgba(64,17,2,.18); font-weight:900; color:#401102; backdrop-filter: blur(8px);}
    .amHubReturnChip.isVisible{display:inline-flex;}
    @media (min-width: 721px){ .amHubReturnChip{ display:none !important; } }
  `;
  document.head.appendChild(st);
}


let SESSION = { operator: null, pin: null };
let ORDERS = [];
let HIST = [];
let SEND_ORDER = null;
let SEND_CONTEXT = "pending"; // "pending" | "history"
let DELIVERY_VIEW_FILTER = "delivery"; // delivery | pickup
let DELIVERY_FILTER_TOUCHED = false;

let deliveryMobileBar = null;
let deliveryBarObserverStarted = false;
let deliverySyncQueued = false;

function setDisplayIfChanged(el, value){
  if(!el) return;
  if(el.style.display !== value) el.style.display = value;
}
function setAriaHiddenIfChanged(el, value){
  if(!el) return;
  const next = value ? "true" : "false";
  if(el.getAttribute("aria-hidden") !== next) el.setAttribute("aria-hidden", next);
}
function toggleClassIfChanged(el, cls, force){
  if(!el) return;
  const has = el.classList.contains(cls);
  if(has !== !!force) el.classList.toggle(cls, !!force);
}
function scheduleDeliveryBarsSync(){
  if(deliverySyncQueued) return;
  deliverySyncQueued = true;
  const run = ()=>{
    deliverySyncQueued = false;
    try{ syncDeliveryActionBars(); }catch(_e){}
  };
  if(typeof window !== "undefined" && typeof window.requestAnimationFrame === "function"){
    window.requestAnimationFrame(run);
  }else{
    setTimeout(run, 0);
  }
}

function isMobileViewport(){
  try{ return window.matchMedia('(max-width: 720px)').matches; }catch(_e){ return window.innerWidth <= 720; }
}
function isVisibleEl(el){
  if(!el) return false;
  const cs = window.getComputedStyle ? getComputedStyle(el) : null;
  if(cs && (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0)) return false;
  if(el.getAttribute && el.getAttribute('aria-hidden') === 'true') return false;
  return true;
}
function hasDeliveryOverlayOpen(){
  return [histBack, sendBack, confirmBack, loading].some(isVisibleEl);
}
function ensureDeliveryMobileBar(){
  if(deliveryMobileBar && document.body.contains(deliveryMobileBar)) return deliveryMobileBar;
  let bar = document.getElementById('amDeliveryMobileBar');
  if(!bar){
    bar = document.createElement('div');
    bar.id = 'amDeliveryMobileBar';
    bar.className = 'amDeliveryMobileBar isHidden';
    bar.innerHTML = `
      <button id="dMBtnRefresh" class="amDeliveryMobileAction isWarm" type="button" aria-label="Recargar">
        <span class="ico">↻</span><span class="txt">Recargar</span>
      </button>
      <div class="amDeliveryMobileCenter" role="group" aria-label="Filtros de envíos">
        <button id="dMBtnDelivery" class="amDeliveryMobileSeg isActive" type="button"><span class="txt">Domicilio</span></button>
        <button id="dMBtnPickup" class="amDeliveryMobileSeg" type="button"><span class="txt">Recoger</span></button>
        <button id="dMBtnHistory" class="amDeliveryMobileSeg" type="button" aria-label="Historial"><span class="txt">Historial</span></button>
      </div>
      <button id="dMBtnLogout" class="amDeliveryMobileAction isNeutral" type="button" aria-label="Salir">
        <span class="ico">🚪</span><span class="txt">Salir</span>
      </button>`;
    document.body.appendChild(bar);
  }
  deliveryMobileBar = bar;
  return bar;
}

function ensureDeliveryHubReturnUI(){
  if(!hasHubAccess_()) return null;
  ensureHubReturnStyles_();
  const desktopWrap = document.querySelector('.deliveryHeaderActions');
  let btn = document.getElementById('btnDeliveryHub');
  if(desktopWrap && !btn){
    btn = document.createElement('button');
    btn.id = 'btnDeliveryHub';
    btn.type = 'button';
    btn.className = 'btn secondary';
    btn.textContent = 'Panel';
    btn.addEventListener('click', goHub_);
    desktopWrap.insertBefore(btn, btnLogoutTop || null);
  }
  const chip = document.getElementById('deliveryHubChip');
  if(chip) chip.remove();
  return { btn };
}

function syncDeliveryMobileReturnAction(){
  const btn = document.getElementById('dMBtnLogout');
  if(!btn) return;
  const fromHub = hasHubAccess_();
  const ico = btn.querySelector('.ico');
  const txt = btn.querySelector('.txt');
  btn.setAttribute('aria-label', fromHub ? 'Volver al panel' : 'Salir');
  if(ico) ico.textContent = fromHub ? '⌂' : '🚪';
  if(txt) txt.textContent = fromHub ? 'Panel' : 'Salir';
}

function syncDeliveryActionBars(){
  if(typeof document === "undefined" || !document.body) return;
  const mobile = isMobileViewport();
  const appVisible = isVisibleEl(panelView);
  const overlay = hasDeliveryOverlayOpen();
  const desktopDisplay = (appVisible && !mobile) ? 'inline-flex' : 'none';
  const desktopLogoutDisplay = (appVisible && !mobile && !hasHubAccess_()) ? 'inline-flex' : 'none';

  setDisplayIfChanged(btnRefreshTop, desktopDisplay);
  setDisplayIfChanged(btnHistory, desktopDisplay);
  setDisplayIfChanged(btnLogoutTop, desktopLogoutDisplay);

  const hubUi = ensureDeliveryHubReturnUI();
  if(hubUi?.btn) setDisplayIfChanged(hubUi.btn, desktopDisplay);

  const bar = ensureDeliveryMobileBar();
  syncDeliveryMobileReturnAction();
  toggleClassIfChanged(bar, 'isHidden', !appVisible || !mobile || overlay);
  toggleClassIfChanged(document.body, 'deliveryOverlayOpen', !!overlay);
  syncDeliveryFilterUi();
}
function wireDeliveryMobileBar(){
  ensureDeliveryMobileBar();
  const bRefresh = document.getElementById('dMBtnRefresh');
  const bHistory = document.getElementById('dMBtnHistory');
  const bDelivery = document.getElementById('dMBtnDelivery');
  const bPickup = document.getElementById('dMBtnPickup');
  const bLogout = document.getElementById('dMBtnLogout');
  if(bRefresh && !bRefresh.dataset.wired){ bRefresh.dataset.wired='1'; bRefresh.addEventListener('click', ()=> btnRefreshTop?.click()); }
  if(bHistory && !bHistory.dataset.wired){ bHistory.dataset.wired='1'; bHistory.addEventListener('click', ()=> btnHistory?.click()); }
  if(bDelivery && !bDelivery.dataset.wired){ bDelivery.dataset.wired='1'; bDelivery.addEventListener('click', ()=> setDeliveryViewFilter('delivery')); }
  if(bPickup && !bPickup.dataset.wired){ bPickup.dataset.wired='1'; bPickup.addEventListener('click', ()=> setDeliveryViewFilter('pickup')); }
  if(bLogout && !bLogout.dataset.wired){ bLogout.dataset.wired='1'; bLogout.addEventListener('click', ()=> { if(hasHubAccess_()) goHub_(); else btnLogoutTop?.click(); }); }
  scheduleDeliveryBarsSync();
}
function watchDeliveryBarState(){
  if(deliveryBarObserverStarted) return;
  const onSync = ()=> scheduleDeliveryBarsSync();
  window.addEventListener('resize', onSync, { passive:true });
  window.addEventListener('orientationchange', onSync, { passive:true });
  window.addEventListener('pageshow', onSync);
  document.addEventListener('visibilitychange', onSync, { passive:true });
  deliveryBarObserverStarted = true;
}


const loginView = document.getElementById("loginView");
const panelView = document.getElementById("panelView");

const selOperator = document.getElementById("selOperator");
const inpPin = document.getElementById("inpPin");
const btnTogglePin = document.getElementById("btnTogglePin");
const chkRemember = document.getElementById("chkRemember");
const btnLogin = document.getElementById("btnLogin");
const loginErr = document.getElementById("loginErr");

const btnRefresh = document.getElementById("btnRefresh");
const btnLogout = document.getElementById("btnLogout");
const btnHistory = document.getElementById("btnHistory");
const btnRefreshTop = document.getElementById("btnRefreshTop");
const btnLogoutTop = document.getElementById("btnLogoutTop");
const deliveryFilterWrap = document.getElementById("deliveryFilterWrap");
const btnFilterDelivery = document.getElementById("btnFilterDelivery");
const btnFilterPickup = document.getElementById("btnFilterPickup");
const routePlannerWrap = document.getElementById("routePlannerWrap");
const routeSortMode = document.getElementById("routeSortMode");
if(routeSortMode) routeSortMode.value = ROUTE_SORT_MODE;

const metaLine = document.getElementById("metaLine");
const statusEl = document.getElementById("status");
const listEl = document.getElementById("list");

// History modal
const histBack = document.getElementById("histBack");
const btnHistClose = document.getElementById("btnHistClose");
const btnHistReload = document.getElementById("btnHistReload");
const histMetaLine = document.getElementById("histMetaLine");
const histStatus = document.getElementById("histStatus");
const histList = document.getElementById("histList");

const loading = document.getElementById("loading");
const loadingTitle = document.getElementById("loadingTitle");
const loadingMsg = document.getElementById("loadingMsg");

const sendBack = document.getElementById("sendBack");
const btnSendClose = document.getElementById("btnSendClose");
const sendSubtitle = document.getElementById("sendSubtitle");
const inpEta = document.getElementById("inpEta");
const selTemplate = document.getElementById("selTemplate");
const txtMsg = document.getElementById("txtMsg");
const btnCopy = document.getElementById("btnCopy");
const btnAskWhatsApp = document.getElementById("btnAskWhatsApp");
const btnMarkSent = document.getElementById("btnMarkSent");
const sendErr = document.getElementById("sendErr");

// Confirm overlay
const confirmBack = document.getElementById("confirmBack");
const confirmTitle = document.getElementById("confirmTitle");
const confirmDesc = document.getElementById("confirmDesc");
const confirmTimer = document.getElementById("confirmTimer");
const confirmOrder = document.getElementById("confirmOrder");
const btnConfirmCancel = document.getElementById("btnConfirmCancel");
const btnConfirmGo = document.getElementById("btnConfirmGo");
const confirmErr = document.getElementById("confirmErr");

let CONFIRM_INT = null;
let CONFIRM_LEFT = 0;
let CONFIRM_MODE = "wa"; // "wa" | "manual"

function showLoading(t="Cargando…", m="Por favor espera."){
  // ✅ Siempre encima de confirm/modales
  try{ if(loading) loading.style.zIndex = "20000"; }catch(_e){}
  if(!loading) return;
  if(loadingTitle) loadingTitle.textContent = t;
  if(loadingMsg) loadingMsg.textContent = m;
  setDisplayIfChanged(loading, "flex");
  setAriaHiddenIfChanged(loading, false);
  scheduleDeliveryBarsSync();
}
function hideLoading(){
  if(!loading) return;
  setDisplayIfChanged(loading, "none");
  setAriaHiddenIfChanged(loading, true);
  scheduleDeliveryBarsSync();
}
function buildInlineLoadMarkup_(title, sub){
  return `<div class="amInlineLoad"><div class="amInlineLoadSpin"></div><div class="amInlineLoadBody"><div class="amInlineLoadTitle">${escapeHtml(title || "Cargando…")}</div><div class="amInlineLoadSub">${escapeHtml(sub || "Un momento.")}</div></div></div>`;
}
function setInlineLoading_(container, title, sub){
  if(container) container.innerHTML = buildInlineLoadMarkup_(title, sub);
}
function scheduleDeliveryBackgroundRefresh_(reason){
  window.setTimeout(()=>{
    loadOrders(true, { silent:true, reason: reason || "Actualizando envíos en segundo plano…" }).catch(()=>{});
  }, 60);
}
function scheduleDeliveryHistoryRefresh_(){
  window.setTimeout(()=>{
    if(histBack && histBack.style.display === "flex") loadHistory(true, { silent:true }).catch(()=>{});
  }, 120);
}
function setStatus(msg){ if(statusEl) statusEl.textContent = msg || ""; }

function escapeHtml(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function safeJsonParse(v){
  try{
    if(v == null) return null;
    if(typeof v === "object") return v;
    const s = String(v).trim();
    if(!s) return null;
    return JSON.parse(s);
  }catch{ return null; }
}

function normalizeCatsAny(v){
  if(Array.isArray(v)) return v.map(x=>String(x||"").trim().toLowerCase()).filter(Boolean);
  return String(v||"")
    .split(",")
    .map(s=>s.trim().toLowerCase())
    .filter(Boolean);
}

function isActiveAny(v){
  const s = String(v ?? "true").trim().toLowerCase();
  return !(s === "false" || s === "0" || s === "no");
}

// ✅ FIX opt-in: soporta TRUE/VERDADERO/SI/ON y boolean
function isOptIn(v){
  if(v === true) return true;
  if(v === false) return false;
  const s = String(v ?? "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "si" || s === "sí" || s === "yes" || s === "on" || s === "verdadero";
}

// Category matching (supports synonyms)
function hasCategory(profile, wanted){
  const cats = normalizeCatsAny(profile?.categories);
  const w = String(wanted||"").toLowerCase();
  const map = {
    delivery: ["delivery","envios","envíos","envio","envío","envíos","reparto","domicilio"],
    admin: ["admin","administracion","administración"],
    payments: ["payments","pago","pagos"],
    kitchen: ["kitchen","cocina"],
  };
  const aliases = map[w] || [w];
  return aliases.some(a => cats.includes(a));
}

async function api(payload){
  try{ ensureApiWarmup_(); }catch(_e){}
  const body = Object.assign({}, payload || {});
  const action = String(body.action || "").trim();
  const publicActions = new Set([
    "profiles_public_list",
    "profiles_auth",
    "validate_admin_pin",
    "validate_profiles_secret",
    "validate_costs_secret",
    "recipes_pin_check"
  ]);

  if(!publicActions.has(action) && SESSION?.operator?.id && SESSION?.pin){
    body.auth_profile_id = String(SESSION.operator.id || "").trim();
    body.auth_profile_password = String(SESSION.pin || "").trim();
    body.auth_page = "delivery";
  }

  const res = await fetch(API_URL, {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify(body)
  });
  const out = await res.json().catch(async()=>({ ok:false, error: await res.text().catch(()=> "") }));
  if(!out || out.ok === false) throw new Error(out?.error || out?.message || "Error");
  return out;
}

// ---- Profiles (public list) ----
async function fetchProfilesPublic(){
  const out = await api({ action: "profiles_public_list" });
  return out.profiles || [];
}

function renderProfilesSelect(list){
  if(!selOperator) return;
  const opts = ['<option value="">Seleccionar…</option>'];
  for(const p of (list||[])){
    opts.push(`<option value="${escapeHtml(p.id)}">${escapeHtml(p.label)}</option>`);
  }
  selOperator.innerHTML = opts.join("");
}

function syncPinToggleState(){
  if(!inpPin || !btnTogglePin) return;
  const show = inpPin.type === "text";
  btnTogglePin.textContent = show ? "🙈" : "👁";
  btnTogglePin.setAttribute("aria-label", show ? "Ocultar contraseña" : "Mostrar contraseña");
}

function saveDeliverySession(remember = false){
  try{ sessionStorage.setItem(SS_KEY, JSON.stringify(SESSION)); }catch(_e){}
  try{
    if(remember) localStorage.setItem(LS_KEY, JSON.stringify(SESSION));
    else localStorage.removeItem(LS_KEY);
  }catch(_e){}
}

function loadSavedDeliverySession(){
  try{
    const rawLocal = localStorage.getItem(LS_KEY);
    const sLocal = rawLocal ? JSON.parse(rawLocal) : null;
    if(sLocal?.pin && sLocal?.operator) return { data:sLocal, remembered:true };
  }catch(_e){}
  try{
    const raw = sessionStorage.getItem(SS_KEY);
    const s = raw ? JSON.parse(raw) : null;
    if(s?.pin && s?.operator) return { data:s, remembered:false };
  }catch(_e){}
  return null;
}

function clearSavedDeliverySession(){
  try{ sessionStorage.removeItem(SS_KEY); }catch(_e){}
  try{ localStorage.removeItem(LS_KEY); }catch(_e){}
  clearDeliveryDataCache_();
}
function getDeliveryCacheScope_(scope){
  return String(scope || SESSION?.operator?.id || "").trim().toLowerCase();
}
function loadDeliveryLoginCache_(){
  try{
    const raw = sessionStorage.getItem(DELIVERY_LOGIN_CACHE_KEY);
    const data = raw ? JSON.parse(raw) : null;
    return Array.isArray(data?.items) ? data.items : null;
  }catch(_e){ return null; }
}
function saveDeliveryLoginCache_(items){
  try{ sessionStorage.setItem(DELIVERY_LOGIN_CACHE_KEY, JSON.stringify({ items: Array.isArray(items) ? items : [] })); }catch(_e){}
}
function loadDeliveryDataCache_(scope){
  try{
    const raw = sessionStorage.getItem(DELIVERY_DATA_CACHE_KEY);
    const data = raw ? JSON.parse(raw) : null;
    const wanted = getDeliveryCacheScope_(scope);
    if(!data || !wanted || String(data.scope || "") !== wanted) return null;
    return data;
  }catch(_e){ return null; }
}
function saveDeliveryDataCache_(){
  try{
    const scope = getDeliveryCacheScope_();
    if(!scope) return;
    sessionStorage.setItem(DELIVERY_DATA_CACHE_KEY, JSON.stringify({
      scope,
      orders: Array.isArray(ORDERS) ? ORDERS : [],
      history: Array.isArray(HIST) ? HIST : [],
      ts: Date.now()
    }));
  }catch(_e){}
}
function clearDeliveryDataCache_(){
  try{ sessionStorage.removeItem(DELIVERY_DATA_CACHE_KEY); }catch(_e){}
}
function hydrateDeliveryOrdersFromCache_(cache){
  ORDERS = Array.isArray(cache?.orders) ? cache.orders : [];
  renderOrders(ORDERS);
  setStatus(`${ORDERS.length} pedidos listos para envío (caché de la sesión).`);
}
function hydrateDeliveryHistoryFromCache_(cache){
  HIST = Array.isArray(cache?.history) ? cache.history : [];
  renderHistory(HIST);
  if(histStatus) histStatus.textContent = HIST.length ? "Mostrando historial guardado en la sesión." : "";
}


function loadHubSessionCandidate(){
  try{
    const rawLocal = localStorage.getItem(HUB_REMEMBER_KEY);
    const sLocal = rawLocal ? JSON.parse(rawLocal) : null;
    if(sLocal?.id && sLocal?.password) return { data:sLocal, remembered:true };
  }catch(_e){}
  try{
    const raw = sessionStorage.getItem(HUB_SESSION_KEY);
    const s = raw ? JSON.parse(raw) : null;
    if(s?.id && s?.password) return { data:s, remembered:false };
  }catch(_e){}
  return null;
}


btnTogglePin?.addEventListener('click', ()=>{
  if(!inpPin) return;
  inpPin.type = inpPin.type === 'password' ? 'text' : 'password';
  syncPinToggleState();
});
syncPinToggleState();

async function loadProfilesOnStart(force = false){
  const cachedProfiles = !force ? loadDeliveryLoginCache_() : null;
  if(cachedProfiles && cachedProfiles.length){
    renderProfilesSelect(cachedProfiles);
    const saved = loadSavedDeliverySession();
    if(saved?.data?.operator?.id && selOperator && !selOperator.value){
      selOperator.value = String(saved.data.operator.id);
      if(inpPin && !inpPin.value) inpPin.value = String(saved.data.pin || saved.data.password || '');
      if(chkRemember) chkRemember.checked = !!saved.remembered;
    }
    return;
  }
  renderProfilesSelect([]);
  loginErr.textContent = !force ? "Cargando perfiles de envíos…" : "";
  try{
    const all = await fetchProfilesPublic();
    const list = (all||[])
      .filter(p => p && p.id && p.label)
      .filter(p => isActiveAny(p.is_active ?? p.active ?? true))
      .filter(p => hasCategory(p,"delivery") || hasCategory(p,"admin"));

    saveDeliveryLoginCache_(list);
    renderProfilesSelect(list);
    const saved = loadSavedDeliverySession();
    if(saved?.data?.operator?.id && selOperator && !selOperator.value){
      selOperator.value = String(saved.data.operator.id);
      if(inpPin && !inpPin.value) inpPin.value = String(saved.data.pin || saved.data.password || '');
      if(chkRemember) chkRemember.checked = !!saved.remembered;
    }
    if(list.length === 0){
      loginErr.textContent = "No hay perfiles con categoría delivery/admin. Ve a “Gestionar perfiles” y asigna la categoría.";
    }else if(loginErr.textContent === "Cargando perfiles de envíos…"){
      loginErr.textContent = "";
    }
  }catch(e){
    renderProfilesSelect([]);
    loginErr.textContent = (e?.message || "No se pudieron cargar perfiles.")
      + " (Revisa profiles_public_list en Worker)";
  }
}

// ---- Login ----
async function doLogin(){
  loginErr.textContent = "";
  const id = String(selOperator?.value || "").trim();
  const password = String(inpPin?.value || "").trim();
  if(!id){ loginErr.textContent = "Selecciona un perfil."; return; }
  if(!password){ loginErr.textContent = "Ingresa la contraseña."; return; }

  showLoading("Validando…","Comprobando acceso…");
  try{
    const auth = await api({ action:"profiles_auth", profile_id: id, password_plain: password });
    const allowed = hasCategory(auth?.profile, "admin") || hasCategory(auth?.profile, "delivery");
    if(auth.valid !== true || !allowed){
      throw new Error(auth?.error || "Perfil sin permisos para envíos.");
    }
    SESSION = { operator: { id, label: auth?.profile?.label || id }, pin: password };
    saveDeliverySession(!!chkRemember?.checked);
    showPanel();
    const cached = loadDeliveryDataCache_(String(id || ""));
    if(cached) hydrateDeliveryOrdersFromCache_(cached);
    else setInlineLoading_(listEl, "Cargando pedidos…", "Estamos trayendo los pedidos listos para envío.");
    scheduleDeliveryBackgroundRefresh_("Actualizando envíos en segundo plano…");
    if(loginErr) loginErr.textContent = '';
  }catch(e){
    loginErr.textContent = e?.message || "No se pudo validar.";
  }finally{
    if(!silent) hideLoading();
  }
}

async function validateCurrentSession_(){
  const id = String(SESSION?.operator?.id || "").trim();
  const password = String(SESSION?.pin || SESSION?.password || "").trim();
  if(!id || !password) return false;
  try{
    const auth = await api({ action:"profiles_auth", profile_id:id, password_plain:password });
    const allowed = hasCategory(auth?.profile, "admin") || hasCategory(auth?.profile, "delivery");
    if(auth?.valid !== true || !allowed) return false;
    SESSION = { operator:{ id, label: auth?.profile?.label || SESSION?.operator?.label || id }, pin: password };
    return true;
  }catch(_e){
    return false;
  }
}

function setDeliveryShellMode(mode){
  try{
    document.body.classList.remove("is-login","is-app");
    document.body.classList.add(mode === "app" ? "is-app" : "is-login");
  }catch(_e){}
}

function showPanel(){
  setDeliveryShellMode("app");
  setDisplayIfChanged(loginView, "none");
  setDisplayIfChanged(panelView, "block");
  scheduleDeliveryBarsSync();
}
function showLogin(){
  setDeliveryShellMode("login");
  setDisplayIfChanged(panelView, "none");
  setDisplayIfChanged(loginView, "block");
  scheduleDeliveryBarsSync();
}

function logout(){
  SESSION = { operator:null, pin:null };
  clearSavedDeliverySession();
  clearDeliveryDataCache_();
  if(inpPin) inpPin.value = "";
  if(selOperator) selOperator.value = "";
  closeHistory();
  closeSendModal();
  closeConfirm();
  showLogin();
  loadProfilesOnStart().catch(()=>{});
}

// ---- Orders ----
function normStatus(s){ return String(s||"").trim().toLowerCase(); }

function normalizeItemsFromAnyOrder(order){
  if(!order) return [];
  const raw = order.items_json ?? order.itemsJson ?? order.itemsJSON;
  if(raw){
    const parsed = (typeof raw === "string") ? safeJsonParse(raw) : raw;
    if(Array.isArray(parsed)){
      return parsed.map(it=>({
        id: String(it.id || it.product_id || ""),
        name: String(it.name || ""),
        qty: Number(it.qty || it.units || 0) || 0,
      })).filter(it=>it.name && it.qty>0);
    }
  }
  const txt = String(order.items || order.items_text || "").trim();
  if(txt){
    const lines = txt.split("\n").map(s=>s.trim()).filter(Boolean);
    const out=[];
    for(const line0 of lines){
      const line = line0.replace(/^-+\s*/, "");
      const m = line.match(/^(.+?)\s*:\s*(\d+(?:[\.,]\d+)?)$/);
      if(!m) continue;
      const name = m[1].trim();
      const qty = Number(String(m[2]).replace(",", ".")) || 0;
      if(qty>0) out.push({ id: name.toLowerCase().replace(/\s+/g,"_"), name, qty });
    }
    return out;
  }
  return [];
}

function itemsSummary(items){
  return (items||[]).map(it => `${it.name} x${it.qty}`).join(", ");
}

function firstName(full){
  const s = String(full||"").trim();
  if(!s) return "hola";
  return s.split(/\s+/)[0];
}

function formatDate(v){
  if(!v) return "";
  const d = new Date(v);
  if(Number.isNaN(d.getTime())) return String(v);
  return new Intl.DateTimeFormat("es-CO", {
    timeZone:"America/Bogota",
    year:"numeric", month:"2-digit", day:"2-digit",
    hour:"2-digit", minute:"2-digit", hour12:false
  }).format(d);
}

function calcUnits(order){
  const items = normalizeItemsFromAnyOrder(order);
  return Number(order.total_units||0) || items.reduce((s,it)=>s+it.qty,0) || 0;
}

function money(n){
  return Math.round(Number(n||0)).toLocaleString("es-CO");
}


function normalizeRouteText(value){
  return String(value || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[#.,;:()\[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function inferAmaredRouteInfo(input){
  const text = normalizeRouteText(input);
  if(!text){
    return { ...AMARED_ROUTE_UNKNOWN, neighborhood:"", detected:false, score:AMARED_ROUTE_UNKNOWN.score };
  }
  let best = null;
  AMARED_NEIGHBORHOOD_ROUTES.forEach(item => {
    const aliases = [item.name].concat(item.aliases || []);
    aliases.forEach(alias => {
      const n = normalizeRouteText(alias);
      if(!n) return;
      const hit = text === n || text.includes(n) || n.includes(text);
      if(!hit) return;
      const weight = n.length + (text === n ? 100 : 0);
      if(!best || weight > best.weight) best = { item, weight };
    });
  });
  if(!best){
    return { ...AMARED_ROUTE_UNKNOWN, neighborhood:"", detected:false, score:AMARED_ROUTE_UNKNOWN.score };
  }
  const def = AMARED_ROUTE_DEFINITIONS[best.item.route] || AMARED_ROUTE_UNKNOWN;
  return { ...def, neighborhood:best.item.name, detected:true, score:Number(best.item.score || def.score || 50) };
}
function getOrderNeighborhood(order){
  return String(order?.neighborhood_text || order?.barrio || order?.neighborhood || "").trim();
}
function getOrderRouteInfo(order){
  const storedId = String(order?.route_zone || "").trim().toLowerCase();
  const storedLabel = String(order?.route_label || "").trim();
  const storedScore = Number(order?.route_order_score || 0) || 0;
  const inferred = inferAmaredRouteInfo(`${getOrderNeighborhood(order)} ${order?.address_text || ""}`);
  const hasKnownStoredRoute = !!AMARED_ROUTE_DEFINITIONS[storedId];
  const def = AMARED_ROUTE_DEFINITIONS[storedId] || inferred || AMARED_ROUTE_UNKNOWN;
  return {
    ...def,
    id: (hasKnownStoredRoute ? storedId : inferred.id) || "por_asignar",
    label: hasKnownStoredRoute ? def.label : (storedLabel || def.label || inferred.label || AMARED_ROUTE_UNKNOWN.label),
    short: def.short || inferred.short || AMARED_ROUTE_UNKNOWN.short,
    description: def.description || inferred.description || AMARED_ROUTE_UNKNOWN.description,
    neighborhood: getOrderNeighborhood(order) || String(order?.route_detected_neighborhood || inferred.neighborhood || "").trim(),
    detected: storedId ? storedId !== "por_asignar" : !!inferred.detected,
    score: storedScore || Number(inferred.score || def.score || 50)
  };
}
function normalizeManualOrderList(routeKey, ids){
  const currentIds = new Set((Array.isArray(ids) ? ids : []).map(String));
  const stored = Array.isArray(ROUTE_MANUAL_ORDER?.[routeKey]) ? ROUTE_MANUAL_ORDER[routeKey].map(String) : [];
  const clean = stored.filter(id => currentIds.has(id));
  ids.forEach(id => { if(!clean.includes(String(id))) clean.push(String(id)); });
  ROUTE_MANUAL_ORDER[routeKey] = clean;
  return clean;
}
function sortRouteItems(routeKey, items){
  const list = Array.isArray(items) ? items : [];
  const ids = list.map(item => String(item?.order?.order_id || "")).filter(Boolean);
  const manualOrder = normalizeManualOrderList(routeKey, ids);
  if(ROUTE_SORT_MODE === "manual"){
    const pos = new Map(manualOrder.map((id, idx) => [id, idx]));
    list.sort((a,b) => {
      const ia = pos.has(String(a?.order?.order_id || "")) ? pos.get(String(a.order.order_id)) : 9999;
      const ib = pos.has(String(b?.order?.order_id || "")) ? pos.get(String(b.order.order_id)) : 9999;
      if(ia !== ib) return ia - ib;
      return Number(a.routeInfo.score || 50) - Number(b.routeInfo.score || 50);
    });
    return;
  }
  list.sort((a,b) => {
    const da = Number(a.routeInfo.score || 50);
    const db = Number(b.routeInfo.score || 50);
    if(ROUTE_SORT_MODE === "far") return db - da;
    return da - db;
  });
}
function moveOrderInRoute(routeKey, orderId, direction){
  const groups = groupOrdersByRoute(getFilteredPendingOrders(ORDERS));
  const group = groups[routeKey];
  if(!group || !group.orders.length) return false;
  const visibleIds = group.orders.map(item => String(item?.order?.order_id || "")).filter(Boolean);
  const order = normalizeManualOrderList(routeKey, visibleIds);
  const id = String(orderId || "").trim();
  const idx = order.indexOf(id);
  if(idx < 0) return false;
  const nextIdx = direction === "up" ? idx - 1 : idx + 1;
  if(nextIdx < 0 || nextIdx >= order.length) return false;
  const tmp = order[idx];
  order[idx] = order[nextIdx];
  order[nextIdx] = tmp;
  ROUTE_MANUAL_ORDER[routeKey] = order;
  ROUTE_SORT_MODE = "manual";
  if(routeSortMode) routeSortMode.value = "manual";
  saveRouteSortMode();
  saveRouteManualOrderState();
  return true;
}
function setRouteManualOrderFromIds(routeKey, ids){
  const clean = (Array.isArray(ids) ? ids : []).map(String).filter(Boolean);
  if(!routeKey || clean.length < 1) return false;
  ROUTE_MANUAL_ORDER[routeKey] = clean;
  ROUTE_SORT_MODE = "manual";
  if(routeSortMode) routeSortMode.value = "manual";
  saveRouteSortMode();
  saveRouteManualOrderState();
  return true;
}
function isRouteCardExpanded(orderId){
  const id = String(orderId || "").trim();
  return !!id && ROUTE_CARD_EXPANDED.has(id);
}
function toggleRouteCardExpanded(orderId){
  const id = String(orderId || "").trim();
  if(!id) return false;
  if(ROUTE_CARD_EXPANDED.has(id)) ROUTE_CARD_EXPANDED.delete(id);
  else ROUTE_CARD_EXPANDED.add(id);
  saveRouteCardExpandedState();
  return true;
}
function routeCardDomIds(container){
  return Array.from(container?.querySelectorAll?.(".orderCard.isRouteCard") || [])
    .map(card => String(card.getAttribute("data-id") || "").trim())
    .filter(Boolean);
}
function ensureRouteManualFromDom(routeKey, container){
  const ids = routeCardDomIds(container);
  return setRouteManualOrderFromIds(routeKey, ids);
}
function groupOrdersByRoute(orders){
  const groups = {
    occidente: { ...AMARED_ROUTE_DEFINITIONS.occidente, orders: [] },
    oriente: { ...AMARED_ROUTE_DEFINITIONS.oriente, orders: [] },
    por_asignar: { ...AMARED_ROUTE_DEFINITIONS.por_asignar, orders: [] }
  };
  (Array.isArray(orders) ? orders : []).forEach(order => {
    const info = getOrderRouteInfo(order);
    const key = groups[info.id] ? info.id : "por_asignar";
    groups[key].orders.push({ order, routeInfo: info });
  });
  Object.entries(groups).forEach(([routeKey, group]) => sortRouteItems(routeKey, group.orders));
  return groups;
}
function cleanOrderStopText(value){
  return String(value || "").replace(/\s+/g, " ").trim();
}
function isExternalMapLink(value){
  const s = String(value || "").trim().toLowerCase();
  if(!s) return false;
  if(s === "whatsapp" || s === "ubicacion_por_whatsapp" || s === "recogida_presencial") return false;
  return /^https?:\/\//.test(s);
}
function looksLikeLocationLink(value){
  const s = String(value || "").trim().toLowerCase();
  if(!/^https?:\/\//.test(s)) return false;
  return s.includes("maps") || s.includes("goo.gl") || s.includes("wa.me") || s.includes("google") || s.includes("q=");
}
function safeDecodeLocationText(value){
  let s = String(value || "").trim();
  for(let i = 0; i < 4; i += 1){
    try{
      const next = decodeURIComponent(s);
      if(next === s) break;
      s = next;
    }catch(_e){
      break;
    }
  }
  return s;
}
function isValidLatLngPair(lat, lng){
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}
function parseCoordinateNumber(value){
  if(value === null || value === undefined) return NaN;
  const text = String(value).trim();
  if(!text) return NaN;
  return Number(text);
}
function normalizeLatLng(lat, lng){
  lat = parseCoordinateNumber(lat);
  lng = parseCoordinateNumber(lng);
  if(!isValidLatLngPair(lat, lng)) return null;
  // Evita que campos vacíos guardados en la hoja se interpreten como 0,0.
  // Para AMARED esta coordenada no es válida y genera rutas erróneas.
  if(Math.abs(lat) < 0.0000001 && Math.abs(lng) < 0.0000001) return null;
  const query = `${Number(lat.toFixed(7))},${Number(lng.toFixed(7))}`;
  return { lat, lng, query };
}
function extractLatLngFromText(value){
  const decoded = safeDecodeLocationText(value);
  if(!decoded) return null;
  const variants = [decoded, decoded.replace(/\\u003d/g, "=").replace(/\\u0026/g, "&")];
  const patterns = [
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/i,
    /!2d(-?\d+(?:\.\d+)?)!3d(-?\d+(?:\.\d+)?)/i, // lng,lat in some Google data URLs
    /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)(?:[,z\/]|$)/i,
    /[?&#](?:q|query|ll|center|destination|daddr|saddr)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i,
    /[?&#](?:q|query|ll|center|destination|daddr|saddr)=loc:(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i,
    /(?:^|[^0-9-])(-?\d{1,2}\.\d{4,})\s*,\s*(-?\d{1,3}\.\d{4,})(?:[^0-9]|$)/i
  ];
  for(const text of variants){
    for(const pattern of patterns){
      const m = text.match(pattern);
      if(!m) continue;
      if(pattern.source.startsWith("!2d")){
        const lng = Number(m[1]);
        const lat = Number(m[2]);
        const normalized = normalizeLatLng(lat, lng);
        if(normalized) return normalized;
      }else{
        const lat = Number(m[1]);
        const lng = Number(m[2]);
        const normalized = normalizeLatLng(lat, lng);
        if(normalized) return normalized;
      }
    }
  }
  return null;
}
function getOrderSavedCoords(order){
  const lat = Number(order?.maps_lat ?? order?.map_lat ?? order?.location_lat ?? order?.lat);
  const lng = Number(order?.maps_lng ?? order?.map_lng ?? order?.location_lng ?? order?.lng);
  const normalized = normalizeLatLng(lat, lng);
  if(normalized) return normalized;
  const storedQuery = String(order?.maps_query || order?.location_query || "").trim();
  const fromStoredQuery = extractLatLngFromText(storedQuery);
  if(fromStoredQuery) return fromStoredQuery;
  return extractLatLngFromText(order?.maps_link || "");
}
function setOrderExactLocationFields(order, rawLink, coords){
  if(!order) return;
  order.maps_link = String(rawLink || "").trim();
  if(coords?.query){
    order.maps_lat = coords.lat;
    order.maps_lng = coords.lng;
    order.maps_query = coords.query;
  }else{
    order.maps_lat = "";
    order.maps_lng = "";
    order.maps_query = "";
  }
}
function getOrderAddressQuery(order){
  const parts = [order?.address_text, getOrderNeighborhood(order), "Ibagué, Tolima"].map(cleanOrderStopText).filter(Boolean);
  return parts.join(", ");
}
function getOrderPrimaryMapsLink(order){
  const maps = String(order?.maps_link || "").trim();
  return isExternalMapLink(maps) ? maps : "";
}
function isRouteStopLink(value){
  return isExternalMapLink(value) || looksLikeLocationLink(value);
}
function getOrderManualRouteStop(order){
  const raw = cleanOrderStopText(order?.route_stop_query || order?.route_stop || order?.manual_route_stop || "");
  if(!raw) return "";
  const coords = extractLatLngFromText(raw);
  if(coords?.query) return coords.query;
  // Para la ruta con varias paradas no usamos links completos como parada.
  // Si el usuario pega un link aquí, solo se aprovecha si trae coordenadas visibles;
  // de lo contrario se usa la dirección escrita como respaldo.
  if(isRouteStopLink(raw)) return "";
  return raw;
}
function setOrderManualRouteStop(order, value){
  if(!order) return;
  order.route_stop_query = cleanOrderStopText(value || "");
}
function getOrderLinkCoords(order){
  const maps = getOrderPrimaryMapsLink(order);
  return maps ? extractLatLngFromText(maps) : null;
}
function getOrderRouteStopInfo(order){
  const manualStop = getOrderManualRouteStop(order);
  if(manualStop){
    const manualCoords = extractLatLngFromText(manualStop);
    return { query: manualCoords?.query || manualStop, source: manualCoords?.query ? "coords" : "manual" };
  }

  const saved = getOrderSavedCoords(order);
  if(saved?.query) return { query:saved.query, source:"coords" };

  const maps = getOrderPrimaryMapsLink(order);
  const linkCoords = maps ? extractLatLngFromText(maps) : null;
  if(linkCoords?.query) return { query:linkCoords.query, source:"coords" };

  // Importante: para rutas con varias paradas Google Maps no debe recibir el link
  // compartido como parada, porque termina mostrándolo como texto. Si no hay
  // coordenadas disponibles, usamos la dirección escrita como respaldo limpio.
  const addressQuery = getOrderAddressQuery(order);
  return { query:addressQuery, source:addressQuery ? "address" : "empty" };
}
function getOrderRouteStopQuery(order){
  return getOrderRouteStopInfo(order).query || "";
}
function getOrderStopQuery(order){
  return getOrderRouteStopQuery(order);
}
function getOrderLocationPrecisionLabel(order){
  const manual = getOrderManualRouteStop(order);
  if(manual) return "Parada limpia para ruta guardada";
  const maps = getOrderPrimaryMapsLink(order);
  if(maps) return "Link de Google Maps guardado";
  return "Dirección escrita";
}
async function resolveOrderCoordinates(order, opts = {}){
  if(!order) return null;
  const existing = getOrderSavedCoords(order);
  if(existing?.query && !opts.force) return existing;

  const link = getOrderPrimaryMapsLink(order);
  const localCoords = link ? extractLatLngFromText(link) : null;
  if(localCoords?.query){
    setOrderExactLocationFields(order, link, localCoords);
    return localCoords;
  }

  const id = String(order?.order_id || "").trim();
  if(!id || !link || COORDS_RESOLVE_IN_FLIGHT.has(id)) return existing || null;

  COORDS_RESOLVE_IN_FLIGHT.add(id);
  try{
    const out = await api({
      action:"delivery_update_location",
      order_id:id,
      maps_link:link,
      updated_by: SESSION?.operator?.label || "DELIVERY"
    });
    const coords = normalizeLatLng(out?.maps_lat, out?.maps_lng) || extractLatLngFromText(out?.maps_query || "");
    if(coords?.query){
      setOrderExactLocationFields(order, link, coords);
      return coords;
    }
  }catch(e){
    console.warn("No se pudieron resolver coordenadas para", id, e);
  }finally{
    COORDS_RESOLVE_IN_FLIGHT.delete(id);
  }
  return existing || null;
}
async function resolveCoordinatesForRouteItems(routeOrders){
  const items = Array.isArray(routeOrders) ? routeOrders : [];
  let changed = false;
  for(const item of items){
    const order = item?.order || item;
    if(!order || classifyDeliveryType(order) !== "delivery" || getOrderManualRouteStop(order)) continue;
    const before = getOrderSavedCoords(order);
    const after = await resolveOrderCoordinates(order);
    if(!before?.query && after?.query) changed = true;
  }
  return changed;
}
function getGoogleMapsRouteStopStats(routeOrders){
  const stats = { total:0, coords:0, manual:0, address:0, empty:0 };
  (Array.isArray(routeOrders) ? routeOrders : []).forEach(item => {
    const info = getOrderRouteStopInfo(item?.order || item);
    if(!info.query){
      stats.empty += 1;
      return;
    }
    stats.total += 1;
    if(info.source === "coords") stats.coords += 1;
    else if(info.source === "manual") stats.manual += 1;
    else stats.address += 1;
  });
  return stats;
}
function buildGoogleMapsRouteUrl(routeOrders){
  const stops = (Array.isArray(routeOrders) ? routeOrders : [])
    .map(x => getOrderRouteStopInfo(x.order || x))
    .filter(info => info.query)
    .slice(0, 10)
    .map(info => info.query);
  const base = "https://www.google.com/maps/dir/?api=1";
  const origin = encodeURIComponent(AMARED_ROUTE_ORIGIN_ADDRESS);
  if(!stops.length){
    return `${base}&origin=${origin}&destination=${origin}&travelmode=driving`;
  }
  const destination = encodeURIComponent(stops[stops.length - 1]);
  const waypoints = stops.slice(0, -1).map(encodeURIComponent).join("%7C");
  return `${base}&origin=${origin}&destination=${destination}${waypoints ? `&waypoints=${waypoints}` : ""}&travelmode=driving`;
}
function buildGoogleMapsSingleUrl(order){
  const maps = getOrderPrimaryMapsLink(order);
  // En pedidos individuales se abre exactamente el link guardado por el cliente.
  // Así evitamos que coordenadas calculadas o guardadas previamente cambien el punto real.
  if(maps) return maps;
  const q = getOrderAddressQuery(order);
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q || AMARED_ROUTE_ORIGIN_ADDRESS)}`;
}
function shouldResolveOrderCoords(order){
  if(!order || getOrderSavedCoords(order) || getOrderManualRouteStop(order)) return false;
  const link = String(order?.maps_link || "").trim();
  return isExternalMapLink(link) && looksLikeLocationLink(link);
}
async function resolveMissingCoordinatesInBackground(orders){
  const targets = (Array.isArray(orders) ? orders : [])
    .filter(o => classifyDeliveryType(o) === "delivery")
    .filter(shouldResolveOrderCoords)
    .slice(0, 8);
  if(!targets.length) return;
  let changed = false;
  for(const order of targets){
    const before = getOrderSavedCoords(order);
    const after = await resolveOrderCoordinates(order);
    if(!before?.query && after?.query) changed = true;
  }
  if(changed){
    renderOrders(ORDERS);
    saveDeliveryDataCache_();
    setStatus("Ubicaciones actualizadas para mejorar la ruta en Google Maps.");
  }
}
function routeSummaryText(group){
  const rows = (group?.orders || []).map((item, idx) => {
    const o = item.order;
    const nb = item.routeInfo.neighborhood || getOrderNeighborhood(o) || "Barrio por revisar";
    return `${idx+1}. ${o.customer_name || "Cliente"} · ${nb} · ${o.address_text || "Sin dirección"} · Tel: ${o.phone || "—"}`;
  });
  return `${group.label}\nSalida: ${AMARED_ROUTE_ORIGIN_LABEL} · ${AMARED_ROUTE_ORIGIN_ADDRESS}\nPedidos: ${rows.length}\n\n${rows.join("\n")}`;
}
async function copyTextToClipboard(text){
  try{
    await navigator.clipboard.writeText(String(text || ""));
    return true;
  }catch(_e){
    const ta = document.createElement("textarea");
    ta.value = String(text || "");
    document.body.appendChild(ta);
    ta.select();
    try{ document.execCommand("copy"); return true; }catch(_e2){ return false; }
    finally{ document.body.removeChild(ta); }
  }
}
function openRouteUrl(url){
  if(!url) return;
  window.open(url, "_blank", "noopener,noreferrer");
}
function classifyDeliveryType(order){
  const method = String(order?.location_method || "").trim().toLowerCase();
  const address = String(order?.address_text || "").trim().toLowerCase();
  const maps = String(order?.maps_link || "").trim().toLowerCase();
  if(method === "pickup" || address === "recogida presencial" || maps === "recogida_presencial") return "pickup";
  return "delivery";
}

function getPendingCounts(orders){
  const rows = Array.isArray(orders) ? orders : [];
  let delivery = 0, pickup = 0;
  rows.forEach(order => {
    if(classifyDeliveryType(order) === "pickup") pickup += 1;
    else delivery += 1;
  });
  return { delivery, pickup };
}

function getFilteredPendingOrders(orders){
  const rows = Array.isArray(orders) ? orders : [];
  return rows.filter(order => classifyDeliveryType(order) === DELIVERY_VIEW_FILTER);
}

function syncDeliveryFilterUi(){
  const counts = getPendingCounts(ORDERS);
  const activeLabel = DELIVERY_VIEW_FILTER === "pickup" ? "Recoger" : "Domicilio";
  if(metaLine){
    metaLine.textContent = `Operador: ${SESSION?.operator?.label || "—"} · Domicilio: ${counts.delivery} · Recoger: ${counts.pickup} · Mostrando: ${activeLabel}`;
  }
  if(deliveryFilterWrap) setDisplayIfChanged(deliveryFilterWrap, "flex");
  toggleClassIfChanged(btnFilterDelivery, 'isActive', DELIVERY_VIEW_FILTER === 'delivery');
  toggleClassIfChanged(btnFilterPickup, 'isActive', DELIVERY_VIEW_FILTER === 'pickup');
  const bDelivery = document.getElementById('dMBtnDelivery');
  const bPickup = document.getElementById('dMBtnPickup');
  const bHistory = document.getElementById('dMBtnHistory');
  toggleClassIfChanged(bDelivery, 'isActive', DELIVERY_VIEW_FILTER === 'delivery');
  toggleClassIfChanged(bPickup, 'isActive', DELIVERY_VIEW_FILTER === 'pickup');
  toggleClassIfChanged(bHistory, 'isActive', isVisibleEl(histBack));
}

function setDeliveryViewFilter(next){
  DELIVERY_FILTER_TOUCHED = true;
  DELIVERY_VIEW_FILTER = (next === 'pickup') ? 'pickup' : 'delivery';
  renderOrders(ORDERS);
  syncDeliveryFilterUi();
  scheduleDeliveryBarsSync();
}

function pickupLocationLine(){
  return 'Parque La Toscana, entre Mercacentro 4 y Acqua';
}

function renderOrders(orders){
  ORDERS = Array.isArray(orders) ? orders : [];
  const counts = getPendingCounts(ORDERS);
  if(!DELIVERY_FILTER_TOUCHED){
    if(!counts.delivery && counts.pickup) DELIVERY_VIEW_FILTER = 'pickup';
    else if(!counts.pickup && counts.delivery) DELIVERY_VIEW_FILTER = 'delivery';
  }
  syncDeliveryFilterUi();

  if(!listEl) return;
  const filtered = getFilteredPendingOrders(ORDERS);
  const title = DELIVERY_VIEW_FILTER === 'pickup' ? 'Pedidos para recoger' : 'Pedidos para domicilio';
  const subtitleCount = `${filtered.length} pedido${filtered.length === 1 ? '' : 's'}`;
  if(routePlannerWrap) setDisplayIfChanged(routePlannerWrap, DELIVERY_VIEW_FILTER === 'delivery' ? "" : "none");

  if(filtered.length === 0){
    listEl.innerHTML = `
      <div>
        <div class="deliveryGroupTitle">${title}</div>
        <div class="deliveryGroupCount">${subtitleCount}</div>
        <div class="muted small" style="margin-top:8px;">No hay pedidos pendientes en esta vista.</div>
        <div class="muted small" style="margin-top:6px;">Puedes cambiar entre Domicilio y Recoger o usar Recargar para confirmar si entró un pedido nuevo.</div>
      </div>`;
    return;
  }

  function renderOrderCard(o, extra={}){
    const items = normalizeItemsFromAnyOrder(o);
    const summary = itemsSummary(items) || (o.items || "");
    const units = calcUnits(o);
    const canWa = isOptIn(o.wa_opt_in);
    const type = classifyDeliveryType(o);
    const typeLabel = type === 'pickup' ? 'Recoger' : 'Domicilio';
    const typeClass = type === 'pickup' ? 'isPickupType' : 'isDeliveryType';
    const routeInfo = type === 'pickup' ? null : getOrderRouteInfo(o);
    const neighborhood = routeInfo?.neighborhood || getOrderNeighborhood(o) || "Por revisar";
    const orderId = String(o.order_id || "");
    const isRouteCard = !!extra.routeKey;
    const expanded = !isRouteCard || isRouteCardExpanded(orderId);
    const compactAddress = type === 'pickup' ? pickupLocationLine() : (o.address_text || "Sin dirección");
    const precision = type === 'pickup' ? "" : getOrderLocationPrecisionLabel(o);

    return `
      <div class="orderCard ${extra.routeClass || ''} ${isRouteCard && !expanded ? 'isOrderCollapsed' : ''}" ${isRouteCard ? `data-route="${escapeHtml(extra.routeKey)}" data-id="${escapeHtml(orderId)}"` : ''}>
        <div class="orderHead">
          ${isRouteCard ? `
            <button class="routeDragHandle" data-route="${escapeHtml(extra.routeKey)}" data-id="${escapeHtml(orderId)}" type="button" aria-label="Mantén presionado para mover este pedido" title="Mantén presionado y arrastra para ordenar">
              <span aria-hidden="true"></span>
            </button>` : ''}
          <div class="orderHeadMain">
            <div class="orderId">${extra.index ? `<span class="routeStopNumber">${escapeHtml(String(extra.index))}</span>` : ''}${escapeHtml(orderId)}</div>
            <div class="orderMeta">${escapeHtml(o.customer_name || "")} · ${escapeHtml(formatDate(o.created_at))}</div>
            ${isRouteCard ? `<div class="routeCardCompact">${escapeHtml(neighborhood)} · ${escapeHtml(compactAddress)}${precision ? ` · ${escapeHtml(precision)}` : ''}</div>` : ''}
          </div>
          <div class="orderHeadActions">
            <div class="row orderPillRow" style="gap:10px; flex-wrap:wrap; justify-content:flex-end;">
              <span class="pill ${typeClass}">${type === 'pickup' ? '🛍️' : '🛵'} ${typeLabel}</span>
              ${routeInfo ? `<span class="pill routePill">🧭 ${escapeHtml(routeInfo.short || 'Ruta')}</span>` : ''}
              <span class="pill">🧁 ${escapeHtml(String(units))} u</span>
              <span class="pill">💰 $${escapeHtml(money(o.subtotal||0))}</span>
              ${canWa ? "" : '<span class="pill">📵 Sin WhatsApp</span>'}
            </div>
            ${isRouteCard ? `
              <button class="btn secondary btnRouteCardToggle" data-id="${escapeHtml(orderId)}" type="button" aria-expanded="${expanded ? 'true' : 'false'}">
                <span class="routeCardToggleIcon" aria-hidden="true"></span>
                <span>${expanded ? 'Ocultar detalle' : 'Ver detalle'}</span>
              </button>` : ''}
          </div>
        </div>

        <div class="orderBody">
          <div class="kv">
            <label>Ítems</label>
            <div class="itemsBox">${escapeHtml(summary || "—")}</div>
          </div>

          <div class="grid2">
            <div class="kv">
              <label>${type === 'pickup' ? 'Punto de entrega' : 'Dirección'}</label>
              <div class="v">${escapeHtml(type === 'pickup' ? pickupLocationLine() : (o.address_text || "—"))}</div>
            </div>
            <div class="kv">
              <label>Teléfono</label>
              <div class="v">${escapeHtml(o.phone || "—")}</div>
            </div>
          </div>

          ${type === 'pickup' ? '' : `
          <div class="grid2">
            <div class="kv">
              <label>Barrio / sector</label>
              <div class="v">${escapeHtml(neighborhood)}</div>
            </div>
            <div class="kv">
              <label>Ruta sugerida</label>
              <div class="v">${escapeHtml(routeInfo?.label || 'Por asignar')}</div>
            </div>
          </div>`}

          ${type === 'pickup' ? '' : `
          <div class="routeExactBox">
            <label for="exactLoc-${escapeHtml(orderId)}">Link exacto de Google Maps</label>
            <div class="routeExactRow">
              <input id="exactLoc-${escapeHtml(orderId)}" class="input routeExactInput" data-id="${escapeHtml(orderId)}" type="url" placeholder="Pega aquí el link de Google Maps o ubicación de WhatsApp" value="${escapeHtml(isExternalMapLink(o.maps_link) ? o.maps_link : '')}" />
              <button class="btn secondary btnSaveExactLocation" data-id="${escapeHtml(orderId)}" type="button">Guardar ubicación</button>
            </div>
            <label class="routeStopLabel" for="routeStop-${escapeHtml(orderId)}">Parada usada para crear rutas</label>
            <div class="routeExactRow routeStopRow">
              <input id="routeStop-${escapeHtml(orderId)}" class="input routeStopInput" data-id="${escapeHtml(orderId)}" type="text" placeholder="Coordenadas lat,lng o dirección limpia para Google Maps" value="${escapeHtml(o.route_stop_query || '')}" />
              <button class="btn secondary btnUseAddressStop" data-id="${escapeHtml(orderId)}" type="button">Usar dirección</button>
            </div>
            <div class="routeExactHint">Maps individual abre el link exacto. La ruta con varias paradas usa la parada limpia; si está vacía, se usa la dirección escrita del pedido.</div>
            <div class="routePrecisionHint">${escapeHtml(getOrderLocationPrecisionLabel(o))}</div>
          </div>`}

          <div class="btnRow">
            ${type === 'pickup' ? '' : `
              <button class="btn secondary btnOrderMaps" data-id="${escapeHtml(orderId)}" type="button">Abrir Maps</button>
              <button class="btn secondary btnCopyLocation" data-id="${escapeHtml(orderId)}" type="button">Copiar ubicación</button>
            `}
            <button class="btn secondary btnSend" data-id="${escapeHtml(orderId)}" type="button">Ver mensaje</button>
          </div>
        </div>
      </div>
    `;
  }

  if(DELIVERY_VIEW_FILTER !== 'delivery'){
    const cards = filtered.map(o => renderOrderCard(o)).join('');
    listEl.innerHTML = `
      <div>
        <div class="deliveryGroupTitle">${title}</div>
        <div class="deliveryGroupCount">${subtitleCount}</div>
      </div>
      ${cards}`;
    return;
  }

  const groups = groupOrdersByRoute(filtered);
  const routeOrder = ['occidente','oriente','por_asignar'];
  const sections = routeOrder.map(key => {
    const group = groups[key];
    if(!group || !group.orders.length) return '';
    const collapsed = ROUTE_COLLAPSED.has(key);
    return `
      <section class="routeGroup ${collapsed ? 'isCollapsed' : ''}" data-route="${escapeHtml(key)}">
        <div class="routeGroupHead">
          <div>
            <div class="deliveryGroupTitle">${escapeHtml(group.label)}</div>
            <div class="deliveryGroupCount">${group.orders.length} pedido${group.orders.length === 1 ? '' : 's'} · ${escapeHtml(group.description || '')}</div>
          </div>
          <div class="routeActions">
            <button class="btn secondary btnRouteToggle" data-route="${escapeHtml(key)}" type="button" aria-expanded="${collapsed ? 'false' : 'true'}">
              <span class="routeToggleIcon" aria-hidden="true"></span>
              <span>${collapsed ? 'Mostrar pedidos' : 'Ocultar pedidos'}</span>
            </button>
            <button class="btn secondary btnRouteMaps" data-route="${escapeHtml(key)}" type="button">Abrir ruta en Google Maps</button>
            <button class="btn secondary btnCopyRouteSummary" data-route="${escapeHtml(key)}" type="button">Copiar resumen</button>
          </div>
        </div>
        <div class="routeCollapsible">
          <div class="routeMapHint">Orden actual: ${ROUTE_SORT_MODE === 'manual' ? 'personalizado' : ROUTE_SORT_MODE === 'far' ? 'lejanos primero' : 'cercanos primero'} · Salida desde ${escapeHtml(AMARED_ROUTE_ORIGIN_LABEL)}. La navegación se realiza desde Google Maps.</div>
          <div class="routeCards">
            ${group.orders.map((item, idx) => renderOrderCard(item.order, { index: idx + 1, routeClass:'isRouteCard', routeKey:key, routeIndex:idx, routeCount:group.orders.length })).join('')}
          </div>
        </div>
      </section>`;
  }).join('');

  listEl.innerHTML = `
    <div>
      <div class="deliveryGroupTitle">${title}</div>
      <div class="deliveryGroupCount">${subtitleCount} organizados por ruta</div>
    </div>
    ${sections}`;
}

async function loadOrders(force = false, opts = {}){
  const silent = !!opts.silent;
  if(!force){
    const cached = loadDeliveryDataCache_();
    if(cached){
      hydrateDeliveryOrdersFromCache_(cached);
      return;
    }
  }
  setStatus("");
  if(silent){
    setStatus(String(opts.reason || "Actualizando envíos en segundo plano…"));
    if(listEl && !String(listEl.innerHTML || "").trim()) setInlineLoading_(listEl, "Cargando pedidos…", "Estamos trayendo los pedidos listos para envío.");
  }else{
    showLoading("Cargando pedidos…","Buscando Pagado + Listo + delivery Pendiente…");
  }
  try{
    let out = await api({ action:"delivery_list", hours: 72, view:"pending" });
    let orders = out.orders || [];

    // fallback: list_orders + client-side filter
    if(orders.length === 0){
      const out2 = await api({ action:"list_orders", payment_status:"Pagado" });
      const all = out2.orders || [];
      orders = all.filter(o=>{
        const kit = normStatus(o.kitchen_status);
        const del = normStatus(o.delivery_status || "pendiente");
        const pay = normStatus(o.payment_status);
        return pay === "pagado" && kit === "listo" && (del === "pendiente" || del === "");
      });
    }

    renderOrders(orders);
    saveDeliveryDataCache_();
    }catch(e){
    console.error("loadOrders error:", e);
    const msg = e?.message || "Error cargando pedidos.";
    if(/unauthorized/i.test(String(msg))){
      clearSavedDeliverySession();
      SESSION = { operator:null, pin:null };
      if(listEl) listEl.innerHTML = "";
      showLogin();
      setStatus("");
      loginErr.textContent = "Tu sesión no es válida para Envíos. Inicia sesión nuevamente.";
      loadProfilesOnStart().catch(()=>{});
    }else{
      showPanel();
      setStatus(msg);
      if(listEl) listEl.innerHTML = '<div class="muted small">No se pudieron cargar los pedidos. Usa “Recargar” o vuelve a iniciar sesión.</div>';
    }
  }finally{
    hideLoading();
  }
}


function historyTimeValue(order){
  const raw = order?.delivery_sent_at || order?.sent_at || order?.last_updated_at || order?.created_at || "";
  const t = raw ? new Date(raw).getTime() : 0;
  return Number.isFinite(t) ? t : 0;
}

function normalizeHistoryOrders(rows){
  return (Array.isArray(rows) ? rows : [])
    .filter(o => {
      const pay = normStatus(o?.payment_status);
      const del = normStatus(o?.delivery_status);
      const sentAt = String(o?.delivery_sent_at || "").trim();
      return pay === 'pagado' && (del === 'enviado' || !!sentAt);
    })
    .sort((a,b) => historyTimeValue(b) - historyTimeValue(a));
}

// ---- History ----
function openHistory(){
  if(!histBack) return;
  if(histStatus) histStatus.textContent = "";
  setDisplayIfChanged(histBack, "flex");
  setAriaHiddenIfChanged(histBack, false);
  scheduleDeliveryBarsSync();
  loadHistory(false, { silent:false });
  syncDeliveryFilterUi();
}
function closeHistory(){
  if(!histBack) return;
  setDisplayIfChanged(histBack, "none");
  setAriaHiddenIfChanged(histBack, true);
  scheduleDeliveryBarsSync();
  syncDeliveryFilterUi();
}
function renderHistory(orders){
  HIST = orders || [];
  if(histMetaLine){
    histMetaLine.textContent = `Enviados: ${HIST.length} · Operador: ${SESSION?.operator?.label || "—"}`;
  }
  if(!histList) return;
  if(HIST.length === 0){
    histList.innerHTML = `<div class="muted small">No hay pedidos marcados como enviados en el rango.</div>`;
    return;
  }

  const html = HIST.map(o=>{
    const items = normalizeItemsFromAnyOrder(o);
    const summary = itemsSummary(items) || (o.items || "");
    const units = calcUnits(o);
    const st = String(o.delivery_status || "Enviado").trim() || "Enviado";
    const sentAt = String(o.delivery_sent_at || "").trim();
    const who = String(o.delivery_sent_by || "").trim();
    const canWa = isOptIn(o.wa_opt_in);

    return `
      <div class="orderCard">
        <div class="orderHead">
          <div>
            <div class="orderId">${escapeHtml(o.order_id || "")}</div>
            <div class="orderMeta">${escapeHtml(o.customer_name || "")} · ${escapeHtml(sentAt ? sentAt : formatDate(o.created_at))}${who ? " · " + escapeHtml(who) : ""}</div>
          </div>
          <div class="row" style="gap:10px; flex-wrap:wrap; justify-content:flex-end;">
            <span class="pill">✅ ${escapeHtml(st)}</span>
            <span class="pill">🧁 ${escapeHtml(String(units))} u</span>
            ${canWa ? "" : '<span class="pill">📵 Sin WhatsApp</span>'}
          </div>
        </div>

        <div class="orderBody">
          <div class="kv">
            <label>Ítems</label>
            <div class="itemsBox">${escapeHtml(summary || "—")}</div>
          </div>

          <div class="btnRow">
            <button class="btn secondary btnHistView" data-id="${escapeHtml(o.order_id)}">Ver detalle</button>
          </div>
        </div>
      </div>
    `;
  }).join("");

  histList.innerHTML = html;
}

async function loadHistory(force = false, opts = {}){
  const silent = !!opts.silent;
  if(!force){
    const cached = loadDeliveryDataCache_();
    if(cached){
      hydrateDeliveryHistoryFromCache_(cached);
      scheduleDeliveryHistoryRefresh_();
      return;
    }
  }
  if(histStatus) histStatus.textContent = "";
  showLoading("Cargando historial…","Buscando pedidos enviados…");
  try{
    let orders = [];

    try{
      const out = await api({ action:"delivery_list", hours: 240, view:"history" });
      orders = normalizeHistoryOrders(out.orders || []);
    }catch(errHistory){
      console.warn("delivery history fallback:", errHistory);
    }

    if(!orders.length){
      const out2 = await api({ action:"list_orders", payment_status:"Pagado" });
      orders = normalizeHistoryOrders(out2.orders || []);
    }

    renderHistory(orders);
  }catch(e){
    if(histStatus) histStatus.textContent = e?.message || "Error cargando historial.";
    if(histList) histList.innerHTML = "";
  }finally{
    hideLoading();
  }
}

// ---- Send flow ----
const TEMPLATES = [
  {
    id:"t1",
    label:"Cercano (✨🚗)",
    build: ({name, items, eta}) =>
      `Hola ${name} 👋✨\nTu pedido (${items}) ya va en camino 🚗💨\nLlega aprox. en ${eta} min ⏱️\n¡Gracias por elegir AMARED! 😋🍰`
  },
  {
    id:"t2",
    label:"Corto (😊🧁)",
    build: ({name, units, eta}) =>
      `¡Hola ${name}! 😊\nYa salió tu pedido 🧁🚚 (son ${units} postres).\nTiempo estimado: ${eta} min ⏱️\n¡Que lo disfrutes mucho! 💖`
  },
  {
    id:"t3",
    label:"Con energía (🚀💛)",
    build: ({name, eta}) =>
      `Hola ${name} 🙌\nTu pedido está listo y va en ruta 🚀\nEstimado: ${eta} min ⏱️\n¡Disfrútalo! 💛`
  },
];

function openSendModal(order, opts={}){
  SEND_ORDER = order;
  SEND_CONTEXT = opts?.fromHistory ? "history" : "pending";
  sendErr.textContent = "";
  if(!sendBack) return;

  sendSubtitle.textContent = `${order.order_id} · ${order.customer_name || ""}`;
  inpEta.value = "5";

  selTemplate.innerHTML = TEMPLATES.map(t=>`<option value="${t.id}">${t.label}</option>`).join("");
  selTemplate.value = "t1";

  txtMsg.value = buildMessage(order, Number(inpEta.value||5)||5, "t1");

  const canWa = isOptIn(order.wa_opt_in);
if(btnAskWhatsApp){
  btnAskWhatsApp.disabled = !canWa;
  btnAskWhatsApp.style.opacity = canWa ? "" : "0.55";
  btnAskWhatsApp.title = canWa ? "Abrir WhatsApp" : "El cliente no autorizó WhatsApp";
}
if(btnMarkSent){
  btnMarkSent.disabled = false;
  btnMarkSent.style.opacity = "";
  btnMarkSent.title = "Marcar Enviado";
}
if(!canWa){
  sendErr.textContent = "Este cliente NO autorizó recibir mensajes por WhatsApp. Puedes copiar el mensaje y luego usar “Marcar Enviado”.";
}

  applyContextButtons(order);

  setDisplayIfChanged(sendBack, "flex");
  setAriaHiddenIfChanged(sendBack, false);
  scheduleDeliveryBarsSync();
}

function closeSendModal(){
  SEND_ORDER = null;
  if(!sendBack) return;
  setDisplayIfChanged(sendBack, "none");
  setAriaHiddenIfChanged(sendBack, true);
  scheduleDeliveryBarsSync();
}

function buildMessage(order, etaMinutes, templateId){
  const itemsArr = normalizeItemsFromAnyOrder(order);
  const itemsTxt = itemsSummary(itemsArr) || (order.items || "tu pedido");
  const units = calcUnits(order);

  const name = firstName(order.customer_name);
  const eta = Math.max(1, Math.round(Number(etaMinutes||0) || 0));
  const isPickup = classifyDeliveryType(order) === 'pickup';

  if(isPickup){
    return `Hola ${name} 👋
Tu pedido (${itemsTxt}) ya va en camino al punto de entrega presencial.
Nos vemos en ${pickupLocationLine()} en aprox. ${eta} min ⏱️
¡Gracias por elegir AMARED! 💖`;
  }

  const t = TEMPLATES.find(x=>x.id===templateId) || TEMPLATES[0];
  return t.build({ name, items: itemsTxt, units, eta });
}

function applyContextButtons(order){
  const canWa = isOptIn(order?.wa_opt_in);
  const isHist = (SEND_CONTEXT === "history");

  if(isHist){
    setDisplayIfChanged(btnMarkSent, "none");
    if(btnAskWhatsApp){
      setDisplayIfChanged(btnAskWhatsApp, "");
      btnAskWhatsApp.disabled = false;
      btnAskWhatsApp.style.opacity = "";
      btnAskWhatsApp.title = "Abrir chat (sin mensaje)";
      btnAskWhatsApp.textContent = "Ver chat";
    }
    if(sendErr) sendErr.textContent = "";
    scheduleDeliveryBarsSync();
    return;
  }

  if(canWa){
    if(btnAskWhatsApp){
      setDisplayIfChanged(btnAskWhatsApp, "");
      btnAskWhatsApp.disabled = false;
      btnAskWhatsApp.style.opacity = "";
      btnAskWhatsApp.title = "Abrir WhatsApp (con mensaje)";
      btnAskWhatsApp.textContent = "Abrir WhatsApp";
    }
    setDisplayIfChanged(btnMarkSent, "none");
    if(sendErr) sendErr.textContent = "";
  }else{
    setDisplayIfChanged(btnAskWhatsApp, "none");
    if(btnMarkSent){
      setDisplayIfChanged(btnMarkSent, "");
      btnMarkSent.disabled = false;
      btnMarkSent.style.opacity = "";
      btnMarkSent.title = "Marcar Enviado";
    }
    if(sendErr) sendErr.textContent = "Este cliente NO autorizó WhatsApp. Usa “Marcar Enviado”.";
  }
  scheduleDeliveryBarsSync();
}


function normalizePhoneToWa(phone){
  const digits = String(phone||"").replace(/\D+/g,"");
  if(!digits) return "";
  if(digits.length >= 11) return digits;
  if(digits.length === 10) return "57" + digits; // Colombia
  return digits;
}

function isMobileUA(){
  const ua = navigator.userAgent || "";
  return /Android|iPhone|iPad|iPod|Mobi/i.test(ua);
}
function buildWhatsAppUrlWithText(phoneDigits, message){
  const enc = encodeURIComponent(String(message || ""));
  if(!isMobileUA()){
    return `https://api.whatsapp.com/send?phone=${phoneDigits}&text=${enc}`;
  }
  return `https://wa.me/${phoneDigits}?text=${enc}`;
}
function buildWhatsAppChatOnlyUrl(phoneDigits){
  if(!isMobileUA()){
    return `https://api.whatsapp.com/send?phone=${phoneDigits}`;
  }
  return `https://wa.me/${phoneDigits}`;
}
function openWhatsAppUrl(url){
  if(isMobileUA()){
    window.location.href = url;
  }else{
    window.open(url, "_blank", "noopener,noreferrer");
  }
}


// --- Confirm (2s delay) ---
function openConfirm(orderId, mode){
  CONFIRM_MODE = (mode === "chat") ? "chat" : ((mode === "manual") ? "manual" : "wa");

  if(confirmTitle) confirmTitle.textContent = (CONFIRM_MODE === "manual") ? "¿Marcar como enviado?" : "¿Abrir WhatsApp?";
  if(confirmDesc){
    confirmDesc.innerHTML = (CONFIRM_MODE === "manual")
      ? "Se marcará el pedido como <b>Enviado</b> (para trazabilidad), sin abrir WhatsApp."
      : "Se marcará el pedido como <b>Enviado</b> y se abrirá WhatsApp con el mensaje listo.";
  }

  confirmErr.textContent = "";
  if(!confirmBack) return;
  setDisplayIfChanged(confirmBack, "flex");
  setAriaHiddenIfChanged(confirmBack, false);
  scheduleDeliveryBarsSync();

  confirmOrder.textContent = orderId || "—";
  CONFIRM_LEFT = 2;
  btnConfirmGo.disabled = true;
  confirmTimer.textContent = `Espera ${CONFIRM_LEFT}s…`;

  if(CONFIRM_INT) clearInterval(CONFIRM_INT);
  CONFIRM_INT = setInterval(()=>{
    CONFIRM_LEFT = Math.max(0, CONFIRM_LEFT - 1);
    if(CONFIRM_LEFT <= 0){
      confirmTimer.textContent = "Listo ✅";
      btnConfirmGo.disabled = false;
      clearInterval(CONFIRM_INT);
      CONFIRM_INT = null;
      return;
    }
    confirmTimer.textContent = `Espera ${CONFIRM_LEFT}s…`;
  }, 1000);
}

function closeConfirm(){
  if(CONFIRM_INT) clearInterval(CONFIRM_INT);
  CONFIRM_INT = null;
  if(!confirmBack) return;
  setDisplayIfChanged(confirmBack, "none");
  setAriaHiddenIfChanged(confirmBack, true);
  scheduleDeliveryBarsSync();
}

async function markSentOnly(){
  confirmErr.textContent = "";
  if(!SEND_ORDER) return;

  // eta opcional
  const eta = Number(inpEta.value || 0) || 0;

  showLoading("Actualizando…","Marcando pedido como Enviado…");
  try{
    await api({
      action:"delivery_mark_sent",
      order_id: SEND_ORDER.order_id,
      eta_minutes: (eta > 0 ? Math.round(eta) : 0),
      sent_by: SESSION?.operator?.label || "DELIVERY",
      delivery_status: "Enviado"
    });

    closeConfirm();
    closeSendModal();
    await loadOrders(true);
    if(histBack && histBack.style.display === "flex") await loadHistory(true);
  }catch(e){
    confirmErr.textContent = e?.message || "Error actualizando.";
  }finally{
    hideLoading();
  }
}


async function openChatOnly(){
  confirmErr.textContent = "";
  if(!SEND_ORDER) return;

  const wa = normalizePhoneToWa(SEND_ORDER.phone);
  if(!wa){
    confirmErr.textContent = "El pedido no tiene teléfono.";
    return;
  }

  const url = buildWhatsAppChatOnlyUrl(wa);
  closeConfirm();
  openWhatsAppUrl(url);
}

async function markSentAndOpenWhatsApp(){
  confirmErr.textContent = "";
  if(!SEND_ORDER) return;

  if(!isOptIn(SEND_ORDER.wa_opt_in)){
    confirmErr.textContent = "Este cliente no autorizó recibir mensajes por WhatsApp.";
    return;
  }

  const eta = Number(inpEta.value || 0) || 0;
  if(!(eta > 0)){
    confirmErr.textContent = "Ingresa los minutos (mayor a 0).";
    return;
  }
  const tpl = String(selTemplate.value || "t1");
  const msg = buildMessage(SEND_ORDER, eta, tpl);
  txtMsg.value = msg;

  const wa = normalizePhoneToWa(SEND_ORDER.phone);
  if(!wa){
    confirmErr.textContent = "El pedido no tiene teléfono. Copia el mensaje y envíalo manualmente.";
    return;
  }

  showLoading("Actualizando…","Marcando pedido como Enviado…");
  try{
    await api({
      action:"delivery_mark_sent",
      order_id: SEND_ORDER.order_id,
      eta_minutes: Math.round(eta),
      sent_by: SESSION?.operator?.label || "DELIVERY",
      delivery_status: "Enviado"
    });

    const waUrl = buildWhatsAppUrlWithText(wa, msg);
    closeConfirm();
    closeSendModal();
    openWhatsAppUrl(waUrl);
    await loadOrders(true);
    if(histBack && histBack.style.display === "flex") await loadHistory(true);
  }catch(e){
    confirmErr.textContent = e?.message || "Error actualizando.";
  }finally{
    hideLoading();
  }
}

async function doConfirmAction(){
  if(CONFIRM_MODE === "manual") return markSentOnly();
  if(CONFIRM_MODE === "chat") return openChatOnly();
  return markSentAndOpenWhatsApp();
}

async function copyMsg(){
  try{
    await navigator.clipboard.writeText(txtMsg.value || "");
  }catch{
    const ta = document.createElement("textarea");
    ta.value = txtMsg.value || "";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
}

// ---- Events ----
btnLogin?.addEventListener("click", doLogin);
btnRefresh?.addEventListener("click", ()=> loadOrders(true));
btnLogout?.addEventListener("click", logout);
btnHistory?.addEventListener("click", openHistory);
btnRefreshTop?.addEventListener("click", ()=> loadOrders(true));
btnLogoutTop?.addEventListener("click", logout);
btnFilterDelivery?.addEventListener("click", ()=> setDeliveryViewFilter('delivery'));
btnFilterPickup?.addEventListener("click", ()=> setDeliveryViewFilter('pickup'));
function cleanupRouteDragState(commit = false){
  const st = ROUTE_DRAG_STATE;
  if(!st) return;
  const { card, placeholder, routeKey, container } = st;
  if(commit && placeholder && card){
    placeholder.parentNode?.insertBefore(card, placeholder);
  }
  if(card){
    card.classList.remove("isDragging", "isDragReady");
    card.style.position = "";
    card.style.left = "";
    card.style.top = "";
    card.style.width = "";
    card.style.zIndex = "";
    card.style.pointerEvents = "";
    card.style.transform = "";
  }
  placeholder?.remove?.();
  document.body.classList.remove("routeDraggingActive");
  if(commit && routeKey && container){
    ensureRouteManualFromDom(routeKey, container);
    setStatus("Orden de ruta actualizado manualmente.");
    renderOrders(ORDERS);
  }
  ROUTE_DRAG_STATE = null;
}
function startRouteCardDrag(ev, handle){
  const card = handle?.closest?.(".orderCard.isRouteCard");
  const container = card?.closest?.(".routeCards");
  const routeKey = String(card?.getAttribute("data-route") || handle?.getAttribute("data-route") || "").trim();
  const orderId = String(card?.getAttribute("data-id") || handle?.getAttribute("data-id") || "").trim();
  if(!card || !container || !routeKey || !orderId) return;
  ev.preventDefault();
  const rect = card.getBoundingClientRect();
  const placeholder = document.createElement("div");
  placeholder.className = "routeDragPlaceholder";
  placeholder.style.height = `${Math.max(54, rect.height)}px`;
  card.parentNode.insertBefore(placeholder, card);
  card.classList.add("isDragging");
  document.body.classList.add("routeDraggingActive");
  card.style.position = "fixed";
  card.style.left = `${rect.left}px`;
  card.style.top = `${rect.top}px`;
  card.style.width = `${rect.width}px`;
  card.style.zIndex = "9999";
  card.style.pointerEvents = "none";
  handle.setPointerCapture?.(ev.pointerId);
  ROUTE_DRAG_STATE = {
    pointerId: ev.pointerId,
    routeKey,
    orderId,
    card,
    container,
    placeholder,
    offsetX: ev.clientX - rect.left,
    offsetY: ev.clientY - rect.top,
    startY: ev.clientY,
    moved: false
  };
}
function onRouteCardDragMove(ev){
  const st = ROUTE_DRAG_STATE;
  if(!st || ev.pointerId !== st.pointerId) return;
  ev.preventDefault();
  const y = ev.clientY - st.offsetY;
  st.card.style.top = `${y}px`;
  st.card.style.left = `${ev.clientX - st.offsetX}px`;
  st.card.style.transform = "scale(1.015) rotate(-.4deg)";
  if(Math.abs(ev.clientY - st.startY) > 4) st.moved = true;
  const siblings = Array.from(st.container.querySelectorAll(".orderCard.isRouteCard:not(.isDragging)"));
  let placed = false;
  for(const target of siblings){
    const rect = target.getBoundingClientRect();
    const before = ev.clientY < rect.top + rect.height / 2;
    if(before){
      st.container.insertBefore(st.placeholder, target);
      placed = true;
      break;
    }
  }
  if(!placed) st.container.appendChild(st.placeholder);
}
function onRouteCardDragEnd(ev){
  const st = ROUTE_DRAG_STATE;
  if(!st || ev.pointerId !== st.pointerId) return;
  ev.preventDefault();
  cleanupRouteDragState(true);
}
function onRouteCardDragCancel(){
  cleanupRouteDragState(false);
}

routeSortMode?.addEventListener("change", ()=>{
  const val = String(routeSortMode.value || "near");
  ROUTE_SORT_MODE = val === "far" ? "far" : val === "manual" ? "manual" : "near";
  saveRouteSortMode();
  renderOrders(ORDERS);
});


listEl?.addEventListener("pointerdown", (ev)=>{
  const handle = ev.target?.closest?.(".routeDragHandle");
  if(handle) startRouteCardDrag(ev, handle);
});
document.addEventListener("pointermove", onRouteCardDragMove, { passive:false });
document.addEventListener("pointerup", onRouteCardDragEnd, { passive:false });
document.addEventListener("pointercancel", onRouteCardDragCancel, { passive:true });

listEl?.addEventListener("click", async (ev)=>{
  const btnRouteToggle = ev.target?.closest?.(".btnRouteToggle");
  if(btnRouteToggle){
    const key = String(btnRouteToggle.getAttribute("data-route") || "").trim();
    if(key){
      if(ROUTE_COLLAPSED.has(key)) ROUTE_COLLAPSED.delete(key);
      else ROUTE_COLLAPSED.add(key);
      saveRouteCollapsedState();
      renderOrders(ORDERS);
    }
    return;
  }

  const btnRouteCardToggle = ev.target?.closest?.(".btnRouteCardToggle");
  if(btnRouteCardToggle){
    const id = String(btnRouteCardToggle.getAttribute("data-id") || "").trim();
    if(id && toggleRouteCardExpanded(id)) renderOrders(ORDERS);
    return;
  }

  const btnRouteMove = ev.target?.closest?.(".btnRouteMove");
  if(btnRouteMove){
    const key = String(btnRouteMove.getAttribute("data-route") || "").trim();
    const id = String(btnRouteMove.getAttribute("data-id") || "").trim();
    const dir = String(btnRouteMove.getAttribute("data-dir") || "").trim();
    if(key && id && moveOrderInRoute(key, id, dir)){
      setStatus("Orden de ruta actualizado manualmente.");
      renderOrders(ORDERS);
    }
    return;
  }

  const btnRouteMaps = ev.target?.closest?.(".btnRouteMaps");
  if(btnRouteMaps){
    const key = String(btnRouteMaps.getAttribute("data-route") || "").trim();
    const groups = groupOrdersByRoute(getFilteredPendingOrders(ORDERS));
    const group = groups[key];
    if(group){
      showLoading("Preparando ruta…", "Validando coordenadas y direcciones antes de abrir Google Maps.");
      try{
        const changed = await resolveCoordinatesForRouteItems(group.orders);
        const stats = getGoogleMapsRouteStopStats(group.orders);
        openRouteUrl(buildGoogleMapsRouteUrl(group.orders));
        if(changed) renderOrders(ORDERS);
        if(stats.address > 0 || stats.manual > 0){
          setStatus(`Ruta abierta en Google Maps. ${stats.coords} parada(s) usan coordenadas, ${stats.manual} parada(s) usan parada manual y ${stats.address} parada(s) usan dirección escrita.`);
        }else{
          setStatus("Ruta abierta en Google Maps con paradas basadas en coordenadas disponibles.");
        }
      }catch(e){
        console.warn("No se pudo preparar la ruta", e);
        openRouteUrl(buildGoogleMapsRouteUrl(group.orders));
        setStatus("Ruta abierta en Google Maps con la información disponible.");
      }finally{
        hideLoading();
      }
    }
    return;
  }


  const btnCopyRouteSummary = ev.target?.closest?.(".btnCopyRouteSummary");
  if(btnCopyRouteSummary){
    const key = String(btnCopyRouteSummary.getAttribute("data-route") || "").trim();
    const groups = groupOrdersByRoute(getFilteredPendingOrders(ORDERS));
    const group = groups[key];
    if(group){
      await copyTextToClipboard(routeSummaryText(group));
      setStatus("Resumen de ruta copiado.");
    }
    return;
  }

  const btnUseAddressStop = ev.target?.closest?.(".btnUseAddressStop");
  if(btnUseAddressStop){
    const id = String(btnUseAddressStop.getAttribute("data-id")||"").trim();
    const o = ORDERS.find(x => String(x.order_id) === id);
    const input = Array.from(listEl.querySelectorAll(".routeStopInput")).find(el => String(el.getAttribute("data-id") || "") === id);
    if(o && input){
      input.value = getOrderAddressQuery(o);
      setStatus("Parada de ruta preparada con la dirección escrita. Presiona “Guardar ubicación” para dejarla guardada.");
    }
    return;
  }

  const btnSaveExactLocation = ev.target?.closest?.(".btnSaveExactLocation");
  if(btnSaveExactLocation){
    const id = String(btnSaveExactLocation.getAttribute("data-id")||"").trim();
    const input = Array.from(listEl.querySelectorAll(".routeExactInput")).find(el => String(el.getAttribute("data-id") || "") === id);
    const stopInput = Array.from(listEl.querySelectorAll(".routeStopInput")).find(el => String(el.getAttribute("data-id") || "") === id);
    const raw = String(input?.value || "").trim();
    let routeStop = cleanOrderStopText(stopInput?.value || "");
    if(!id) return;
    if(!raw && !routeStop){
      setStatus("Pega el link exacto o escribe una parada limpia para la ruta.");
      return;
    }
    if(raw && !looksLikeLocationLink(raw)){
      setStatus("El enlace no parece ser una ubicación válida. Pega un link de Google Maps o ubicación compartida por WhatsApp.");
      return;
    }
    const localCoords = raw ? extractLatLngFromText(raw) : null;
    if(!routeStop && localCoords?.query) routeStop = localCoords.query;

    showLoading("Guardando ubicación…", "Actualizando el link exacto y la parada limpia para rutas.");
    try{
      const payload = {
        action:"delivery_update_location",
        order_id:id,
        updated_by: SESSION?.operator?.label || "DELIVERY",
        route_stop_query: routeStop
      };
      if(raw) payload.maps_link = raw;
      if(localCoords?.query){
        payload.maps_lat = localCoords.lat;
        payload.maps_lng = localCoords.lng;
        payload.maps_query = localCoords.query;
      }
      const out = await api(payload);
      const o = ORDERS.find(x => String(x.order_id) === id);
      const resolvedCoords = normalizeLatLng(out?.maps_lat, out?.maps_lng) || extractLatLngFromText(out?.maps_query || raw);
      const finalStop = cleanOrderStopText(out?.route_stop_query || routeStop || resolvedCoords?.query || "");
      if(o){
        if(raw) setOrderExactLocationFields(o, raw, resolvedCoords);
        setOrderManualRouteStop(o, finalStop);
      }
      renderOrders(ORDERS);
      setStatus(finalStop
        ? "Ubicación guardada. La ruta general usará la parada limpia guardada."
        : "Ubicación exacta guardada. Maps individual abrirá el link original; la ruta general usará la dirección escrita como respaldo.");
    }catch(e){
      setStatus(e?.message || "No se pudo guardar la ubicación exacta.");
    }finally{
      hideLoading();
    }
    return;
  }

  const btnOrderMaps = ev.target?.closest?.(".btnOrderMaps");
  if(btnOrderMaps){
    const id = String(btnOrderMaps.getAttribute("data-id")||"").trim();
    const o = ORDERS.find(x => String(x.order_id) === id);
    if(o) openRouteUrl(buildGoogleMapsSingleUrl(o));
    return;
  }


  const btnCopyLocation = ev.target?.closest?.(".btnCopyLocation");
  if(btnCopyLocation){
    const id = String(btnCopyLocation.getAttribute("data-id")||"").trim();
    const o = ORDERS.find(x => String(x.order_id) === id);
    if(o){
      const txt = `${o.customer_name || "Cliente"}
Barrio/sector: ${getOrderNeighborhood(o) || "Por revisar"}
Dirección: ${o.address_text || "—"}
Ubicación guardada: ${isExternalMapLink(o.maps_link) ? o.maps_link : "—"}
Punto usado para ruta: ${getOrderRouteStopQuery(o) || "—"}
Tel: ${o.phone || "—"}`;
      await copyTextToClipboard(txt);
      setStatus("Ubicación copiada.");
    }
    return;
  }

  const btnSend = ev.target?.closest?.(".btnSend");
  if(!btnSend) return;

  const id = String(btnSend.getAttribute("data-id")||"").trim();
  const o = ORDERS.find(x => String(x.order_id) === id);
  if(!o) return;

  openSendModal(o);
});

histList?.addEventListener("click", (ev)=>{
  const btn = ev.target?.closest?.(".btnHistView");
  if(!btn) return;
  const id = String(btn.getAttribute("data-id")||"").trim();
  const o = HIST.find(x => String(x.order_id) === id);
  if(!o) return;

  closeHistory();
  openSendModal(o, { fromHistory:true });
});

btnSendClose?.addEventListener("click", closeSendModal);
sendBack?.addEventListener("click", (ev)=>{ if(ev.target === sendBack) closeSendModal(); });

inpEta?.addEventListener("input", ()=>{
  if(!SEND_ORDER) return;
  const eta = Number(inpEta.value||0) || 0;
  txtMsg.value = buildMessage(SEND_ORDER, eta, selTemplate.value);
});
selTemplate?.addEventListener("change", ()=>{
  if(!SEND_ORDER) return;
  const eta = Number(inpEta.value||0) || 0;
  txtMsg.value = buildMessage(SEND_ORDER, eta, selTemplate.value);
});

btnCopy?.addEventListener("click", copyMsg);

btnAskWhatsApp?.addEventListener("click", ()=>{
  if(!SEND_ORDER) return;

  if(SEND_CONTEXT === "history"){
    // ✅ Historial: abrir directo (sin confirmación) y SIN texto
    const wa = normalizePhoneToWa(SEND_ORDER.phone);
    if(!wa){
      if(sendErr) sendErr.textContent = "El pedido no tiene teléfono.";
      return;
    }
    const url = buildWhatsAppChatOnlyUrl(wa);
    openWhatsAppUrl(url);
    return;
  }

  if(!isOptIn(SEND_ORDER.wa_opt_in)){
    if(sendErr) sendErr.textContent = "Este cliente no autorizó WhatsApp. Usa “Marcar Enviado”.";
    return;
  }
  openConfirm(SEND_ORDER.order_id, "wa");
});

btnMarkSent?.addEventListener("click", ()=>{
  if(!SEND_ORDER) return;
  openConfirm(SEND_ORDER.order_id, "manual");
});

btnConfirmCancel?.addEventListener("click", closeConfirm);
confirmBack?.addEventListener("click", (ev)=>{ if(ev.target === confirmBack) closeConfirm(); });
btnConfirmGo?.addEventListener("click", doConfirmAction);

// History events
btnHistClose?.addEventListener("click", closeHistory);
btnHistReload?.addEventListener("click", ()=> loadHistory(true, { silent:false }));
histBack?.addEventListener("click", (ev)=>{ if(ev.target === histBack) closeHistory(); });

// ---- Init ----
(async function init(){
  wireDeliveryMobileBar();
  watchDeliveryBarState();
  syncDeliveryActionBars();

  try{
    const saved = loadSavedDeliverySession();
    const hubSaved = loadHubSessionCandidate();
    const shouldShowProfilesBoot = !FROM_HUB && !saved && !(hubSaved?.data?.id && hubSaved?.data?.password);
    if(shouldShowProfilesBoot){
      showLoading("Cargando perfiles…","Buscando perfiles de envíos.");
      await loadProfilesOnStart();
    }else{
      loadProfilesOnStart().catch(()=>{});
    }

    if((saved?.data?.pin || saved?.data?.password) && saved?.data?.operator){
      if(chkRemember) chkRemember.checked = !!saved.remembered;
      SESSION = Object.assign({}, saved.data, { pin: String(saved?.data?.pin || saved?.data?.password || "") });
      if(inpPin) inpPin.value = String(saved.data.pin || saved.data.password || '');

      const cached = loadDeliveryDataCache_(String(saved.data.operator?.id || ""));
      showPanel();
      if(cached){
        hydrateDeliveryOrdersFromCache_(cached);
      }else{
        setInlineLoading_(listEl, "Cargando pedidos…", "Estamos trayendo los pedidos listos para envío.");
      }
      scheduleDeliveryBackgroundRefresh_("Actualizando envíos en segundo plano…");

    }else if(hubSaved?.data?.id && hubSaved?.data?.password){
      const cats = normalizeCatsAny(hubSaved.data.categories || []);
      const allowed = cats.some(c => hasCategory({categories:[c]}, 'delivery') || hasCategory({categories:[c]}, 'admin'));

      if(allowed){
        SESSION = {
          operator: { id: String(hubSaved.data.id), label: String(hubSaved.data.label || hubSaved.data.id) },
          pin: String(hubSaved.data.password)
        };
        saveDeliverySession(!!hubSaved.remembered);
        const cached = loadDeliveryDataCache_(String(hubSaved.data.id || ""));
        showPanel();
        if(cached){
          hydrateDeliveryOrdersFromCache_(cached);
        }else{
          setInlineLoading_(listEl, "Cargando pedidos…", "Estamos trayendo los pedidos listos para envío.");
        }
        scheduleDeliveryBackgroundRefresh_("Actualizando envíos en segundo plano…");
      }else{
        showLogin();
      }

    }else{
      showLogin();
    }
  }catch(err){
    console.error('delivery init error:', err);
    showLogin();
    loadProfilesOnStart().catch(()=>{});
  }finally{
    hideLoading();
    revealHubBoot_();
    scheduleDeliveryBarsSync();
  }
})();
