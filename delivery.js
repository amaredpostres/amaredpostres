;
// delivery.js — AMARED Envíos (v4 UX + Historial + Opt-in fix)
"use strict";

console.log("AMARED delivery v14");

const API_URL = "https://amared-orders.amaredpostres.workers.dev/";
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
function ensureDeliverySyncBadge_(){
  let badge = document.getElementById("deliverySyncBadge");
  if(badge) return badge;
  badge = document.createElement("div");
  badge.id = "deliverySyncBadge";
  badge.className = "deliverySyncBadge";
  badge.setAttribute("aria-live", "polite");
  badge.setAttribute("aria-atomic", "true");
  badge.innerHTML = `<div class="deliverySyncBadgeSpin"></div><div class="deliverySyncBadgeBody"><div class="deliverySyncBadgeTitle" id="deliverySyncBadgeTitle">Actualizando envíos…</div><div class="deliverySyncBadgeSub" id="deliverySyncBadgeSub">Puedes seguir usando la página mientras sincronizamos la información.</div></div>`;
  document.body.appendChild(badge);
  return badge;
}
function showDeliverySyncBadge_(title, sub){
  const badge = ensureDeliverySyncBadge_();
  const titleEl = badge.querySelector("#deliverySyncBadgeTitle");
  const subEl = badge.querySelector("#deliverySyncBadgeSub");
  if(titleEl) titleEl.textContent = title || "Actualizando envíos…";
  if(subEl) subEl.textContent = sub || "Puedes seguir usando la página mientras sincronizamos la información.";
  badge.classList.add("isVisible");
}
function hideDeliverySyncBadge_(){
  const badge = document.getElementById("deliverySyncBadge");
  if(!badge) return;
  badge.classList.remove("isVisible");
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
  setStatus("");
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
  const hasBoth = counts.delivery > 0 && counts.pickup > 0;
  if(deliveryFilterWrap) setDisplayIfChanged(deliveryFilterWrap, hasBoth ? "flex" : "none");
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
  if(!counts.delivery && counts.pickup) DELIVERY_VIEW_FILTER = 'pickup';
  else if(!counts.pickup && counts.delivery) DELIVERY_VIEW_FILTER = 'delivery';
  syncDeliveryFilterUi();

  if(!listEl) return;
  const filtered = getFilteredPendingOrders(ORDERS);
  const title = DELIVERY_VIEW_FILTER === 'pickup' ? 'Pedidos para recoger' : 'Pedidos para domicilio';
  const subtitleCount = `${filtered.length} pedido${filtered.length === 1 ? '' : 's'}`;

  if(filtered.length === 0){
    listEl.innerHTML = `
      <div>
        <div class="deliveryGroupTitle">${title}</div>
        <div class="deliveryGroupCount">${subtitleCount}</div>
        <div class="muted small" style="margin-top:8px;">No hay pedidos pendientes en esta vista.</div>
      </div>`;
    return;
  }

  const cards = filtered.map(o=>{
    const items = normalizeItemsFromAnyOrder(o);
    const summary = itemsSummary(items) || (o.items || "");
    const units = calcUnits(o);
    const canWa = isOptIn(o.wa_opt_in);
    const type = classifyDeliveryType(o);
    const typeLabel = type === 'pickup' ? 'Recoger' : 'Domicilio';
    const typeClass = type === 'pickup' ? 'isPickupType' : 'isDeliveryType';

    return `
      <div class="orderCard">
        <div class="orderHead">
          <div>
            <div class="orderId">${escapeHtml(o.order_id || "")}</div>
            <div class="orderMeta">${escapeHtml(o.customer_name || "")} · ${escapeHtml(formatDate(o.created_at))}</div>
          </div>
          <div class="row" style="gap:10px; flex-wrap:wrap; justify-content:flex-end;">
            <span class="pill ${typeClass}">${type === 'pickup' ? '🛍️' : '🛵'} ${typeLabel}</span>
            <span class="pill">🧁 ${escapeHtml(String(units))} u</span>
            <span class="pill">💰 $${escapeHtml(money(o.subtotal||0))}</span>
            ${canWa ? "" : '<span class="pill">📵 Sin WhatsApp</span>'}
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

          <div class="btnRow">
            <button class="btn secondary btnSend" data-id="${escapeHtml(o.order_id)}">Ver mensaje</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  listEl.innerHTML = `
    <div>
      <div class="deliveryGroupTitle">${title}</div>
      <div class="deliveryGroupCount">${subtitleCount}</div>
    </div>
    ${cards}`;
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
    showDeliverySyncBadge_(String(opts.reason || "Actualizando envíos…"), "Puedes seguir usando la página mientras sincronizamos la información.");
    if(listEl && !String(listEl.innerHTML || "").trim()) setInlineLoading_(listEl, "Cargando pedidos…", "Estamos trayendo los pedidos listos para envío.");
  }else{
    hideDeliverySyncBadge_();
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
    if(silent){
      window.setTimeout(()=>{ hideDeliverySyncBadge_(); }, 180);
      if(!(statusEl && String(statusEl.textContent || "").trim())) setStatus("");
    }
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

listEl?.addEventListener("click", (ev)=>{
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
