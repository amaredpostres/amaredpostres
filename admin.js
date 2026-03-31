// =================== CONFIG ===================
const API_URL = "https://amared-orders.amaredpostres.workers.dev/";

// Catálogo (mismo de tu web pública)
const PRODUCT_CATALOG = [
  { id: "mousse_maracuya", name: "Mousse de Maracuyá", unit_price: 10000 },
  { id: "cheesecake_cafe_panela", name: "Cheesecake de café con panela", unit_price: 12500 },
];
const PRODUCT_PRICES_STORAGE_KEY = "AMARED_PRODUCT_PRICES_V1";
const DEFAULT_PRODUCT_CATALOG = PRODUCT_CATALOG.map(item => ({ ...item }));
let _adminCatalogSyncInFlight = null;
function readProductPriceOverrides_(){
  try{ return JSON.parse(localStorage.getItem(PRODUCT_PRICES_STORAGE_KEY) || "{}") || {}; }catch(_e){ return {}; }
}
function writeProductPriceOverrides_(map){
  try{ localStorage.setItem(PRODUCT_PRICES_STORAGE_KEY, JSON.stringify(map || {})); }catch(_e){}
}
function clearProductPriceOverrides_(){
  try{ localStorage.removeItem(PRODUCT_PRICES_STORAGE_KEY); }catch(_e){}
}
function applyProductPriceOverrides_(){
  const map = readProductPriceOverrides_();
  PRODUCT_CATALOG.forEach((item, idx)=>{
    const fallback = Number(DEFAULT_PRODUCT_CATALOG[idx]?.unit_price || item.unit_price || 0);
    const next = Number(map?.[item.id]);
    item.unit_price = Number.isFinite(next) && next > 0 ? Math.round(next) : fallback;
  });
}
function buildProductPriceMapFromItems_(items){
  const map = {};
  (Array.isArray(items) ? items : []).forEach(item => {
    const id = String(item?.id || item?.dessert_id || item?.product_id || "").trim();
    const price = Number(item?.price ?? item?.public_price ?? item?.unit_price ?? 0);
    if(id && Number.isFinite(price) && price > 0) map[id] = Math.round(price);
  });
  return map;
}
function applyProductPriceMap_(map){
  PRODUCT_CATALOG.forEach((item, idx)=>{
    const fallback = Number(DEFAULT_PRODUCT_CATALOG[idx]?.unit_price || item.unit_price || 0);
    const next = Number(map?.[item.id]);
    item.unit_price = Number.isFinite(next) && next > 0 ? Math.round(next) : fallback;
  });
}
async function syncAdminIndexCatalogFromBackend_(force = false){
  if(!force && _adminCatalogSyncInFlight) return _adminCatalogSyncInFlight;
  _adminCatalogSyncInFlight = (async ()=>{
    try{
      const out = await api({ action: "products_catalog_public" });
      const items = Array.isArray(out?.items) ? out.items : [];
      const map = buildProductPriceMapFromItems_(items);
      if(Object.keys(map).length){
        writeProductPriceOverrides_(map);
        applyProductPriceMap_(map);
      }else{
        applyProductPriceOverrides_();
      }
      renderAdminIndexTools();
    }catch(_e){
      applyProductPriceOverrides_();
      renderAdminIndexTools();
    }finally{
      _adminCatalogSyncInFlight = null;
    }
  })();
  return _adminCatalogSyncInFlight;
}
applyProductPriceOverrides_();

// =================== SESSION / STATE ===================
let SESSION = { operator: null, operatorId: null, pin: null };
let LOGIN_PROFILES = [];
let REQUEST_IN_FLIGHT = false;

let pendingOrdersCache = [];
let HIST_CACHE = null;  // { paid:[], canceled:[] }
let HIST_CACHE_TIME = 0;
const HIST_TTL = 60 * 1000;
let histFilter = "ALL";

let modalOrder = null;

// timers
let payCountdownInt = null;
let cancelCountdownInt = null;
let payTimerStarted = false;
let cancelTimerStarted = false;

// Loading overlay counter
let LOADING_COUNT = 0;
const SS_KEY = "AMARED_ADMIN";
const LS_KEY = "AMARED_ADMIN_REMEMBER_V1";
const HUB_URL = "hub.html";
const HUB_SESSION_KEY = "AMARED_HUB_SESSION_V1";
const HUB_REMEMBER_KEY = "AMARED_HUB_REMEMBER_V1";
const ADMIN_LOGIN_CACHE_KEY = "AMARED_PAGECACHE_ADMIN_LOGIN_V1";
const ADMIN_DATA_CACHE_KEY = "AMARED_PAGECACHE_ADMIN_DATA_V1";
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


// =================== DOM ===================
const loginView = document.getElementById("loginView");
const panelView = document.getElementById("panelView");

const loginOperator = document.getElementById("loginOperator");
const loginPin = document.getElementById("loginPin");
const btnLogin = document.getElementById("btnLogin");
const btnTogglePin = document.getElementById("btnTogglePin");
const loginRemember = document.getElementById("loginRemember");
const loginError = document.getElementById("loginError");

const operatorName = document.getElementById("operatorName");
const btnHeaderLogout = document.getElementById("btnHeaderLogout");
const btnHeaderRefresh = document.getElementById("btnHeaderRefresh");
const btnHeaderHistory = document.getElementById("btnHeaderHistory");
const adminHeaderActions = document.getElementById("adminHeaderActions");
const adminMobileBar = document.getElementById("adminMobileBar");
const btnMobileRefresh = document.getElementById("btnMobileRefresh");
const btnMobileHistory = document.getElementById("btnMobileHistory");
const btnMobileLogout = document.getElementById("btnMobileLogout");

/* Compatibilidad con la lógica existente del panel */
const btnLogout = btnHeaderLogout;
const btnRefresh = btnHeaderRefresh;
const btnHistory = btnHeaderHistory;

const statusEl = document.getElementById("status");
const listEl = document.getElementById("list");
const adminIndexPriceRows = document.getElementById("adminIndexPriceRows");
const btnAdminIndexSavePrices = document.getElementById("btnAdminIndexSavePrices");
const btnAdminIndexResetPrices = document.getElementById("btnAdminIndexResetPrices");
const btnAdminOpenIndexPage = document.getElementById("btnAdminOpenIndexPage");
const adminIndexToolsStatus = document.getElementById("adminIndexToolsStatus");

// Drawer historial
const drawerOverlay = document.getElementById("drawerOverlay");
const drawer = document.getElementById("drawer");
const btnCloseDrawer = document.getElementById("btnCloseDrawer");
const histStatusEl = document.getElementById("histStatus");
const histListEl = document.getElementById("histList");
const btnHistRefresh = document.getElementById("btnHistRefresh");
const chips = Array.from(document.querySelectorAll(".chip"));

// Loading overlay
const loadingOverlay = document.getElementById("loadingOverlay");
const loadingText = document.getElementById("loadingText");
const loadingDesc = document.getElementById("loadingDesc");
const adminLoginTopbar = document.getElementById("adminLoginTopbar");

// Modal pago
const payModal = document.getElementById("payModal");
const payTitle = document.getElementById("payTitle");
const payText = document.getElementById("payText");
const payMethod = document.getElementById("payMethod");
const payOtherWrap = document.getElementById("payOtherWrap");
const payOtherText = document.getElementById("payOtherText");
const payRef = document.getElementById("payRef");
const payRefWrap = payRef?.closest?.(".field") || null;
const payTimer = document.getElementById("payTimer");
const btnPayBack = document.getElementById("btnPayBack");
const btnPayConfirm = document.getElementById("btnPayConfirm");

// Modal cancelar
const cancelModal = document.getElementById("cancelModal");
const cancelTitle = document.getElementById("cancelTitle");
const cancelText = document.getElementById("cancelText");
const cancelReason = document.getElementById("cancelReason");
const cancelOtherWrap = document.getElementById("cancelOtherWrap");
const cancelOtherText = document.getElementById("cancelOtherText");
const cancelTimer = document.getElementById("cancelTimer");
const btnCancelBack = document.getElementById("btnCancelBack");
const btnCancelConfirm = document.getElementById("btnCancelConfirm");

// =================== UTILS ===================
function setStatus(msg) { if (statusEl) statusEl.textContent = msg || ""; }
function setHistStatus(msg) { if (histStatusEl) histStatusEl.textContent = msg || ""; }

function money(n) {
  return Math.round(Number(n || 0)).toLocaleString("es-CO");
}
function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}
function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function formatDate(v) {
  if (!v) return "";
  const d = new Date(v);

  // Si no es una fecha válida, devuelve el texto tal cual
  if (Number.isNaN(d.getTime())) return String(v);

  // Mostrar en hora de Colombia (Ibagué): America/Bogota (UTC-5)
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(d);
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function setAdminIndexStatus(msg, isError=false){
  if(!adminIndexToolsStatus) return;
  adminIndexToolsStatus.textContent = String(msg || "");
  adminIndexToolsStatus.style.color = isError ? "#b00020" : "rgba(64,17,2,.72)";
}
function renderAdminIndexTools(){
  applyProductPriceOverrides_();
  if(btnAdminOpenIndexPage){
    btnAdminOpenIndexPage.href = FROM_HUB ? "index.html?admin=1&hub=1" : "index.html?admin=1";
  }
  if(!adminIndexPriceRows) return;
  adminIndexPriceRows.innerHTML = PRODUCT_CATALOG.map(item => `
    <div class="adminIndexPriceRow">
      <div>
        <div class="adminIndexPriceName">${escapeHtml(item.name)}</div>
        <div class="adminIndexPriceHint">Precio visible actualmente: $${money(item.unit_price)}</div>
      </div>
      <label>
        <input class="input" type="number" min="0" step="100" data-admin-price-id="${escapeHtml(item.id)}" value="${Number(item.unit_price || 0)}" />
      </label>
    </div>
  `).join("");
}
async function saveAdminIndexPrices(){
  if(!adminIndexPriceRows) return;
  const inputs = Array.from(adminIndexPriceRows.querySelectorAll("[data-admin-price-id]"));
  const map = {};
  const items = [];
  for(const input of inputs){
    const id = String(input.getAttribute("data-admin-price-id") || "").trim();
    const value = Number(input.value || 0);
    if(!id || !Number.isFinite(value) || value <= 0){
      setAdminIndexStatus("Todos los precios deben ser mayores a 0.", true);
      input.focus();
      return;
    }
    map[id] = Math.round(value);
    const product = PRODUCT_CATALOG.find(p => p.id === id) || DEFAULT_PRODUCT_CATALOG.find(p => p.id === id) || {};
    items.push({ dessert_id: id, dessert_name: String(product.name || "").trim(), public_price: Math.round(value) });
  }
  showLoading("Guardando precios...", "Actualizando el catálogo público para todos los clientes.");
  try{
    const out = await api({ action: "products_catalog_save", items });
    hideLoading();
    if(!out?.ok){
      setAdminIndexStatus(out?.error || "No se pudieron guardar los precios.", true);
      return;
    }
    writeProductPriceOverrides_(map);
    applyProductPriceMap_(map);
    renderAdminIndexTools();
    setAdminIndexStatus("Precios globales guardados correctamente.");
    window.dispatchEvent(new CustomEvent("amared:catalog-updated", { detail: { source: "admin" } }));
  }catch(e){
    hideLoading();
    setAdminIndexStatus(String(e?.message || e || "No se pudieron guardar los precios."), true);
  }
}
function resetAdminIndexPrices(){
  const defaults = {};
  const items = DEFAULT_PRODUCT_CATALOG.map(product => {
    const price = Math.round(Number(product.unit_price || 0));
    defaults[product.id] = price;
    return { dessert_id: product.id, dessert_name: String(product.name || "").trim(), public_price: price };
  });
  showLoading("Restableciendo precios...", "Volviendo a los precios base del catálogo público.");
  api({ action: "products_catalog_save", items })
    .then(out => {
      hideLoading();
      if(!out?.ok){
        setAdminIndexStatus(out?.error || "No se pudieron restablecer los precios.", true);
        return;
      }
      writeProductPriceOverrides_(defaults);
      applyProductPriceMap_(defaults);
      renderAdminIndexTools();
      setAdminIndexStatus("Se restablecieron los precios globales.");
      window.dispatchEvent(new CustomEvent("amared:catalog-updated", { detail: { source: "admin" } }));
    })
    .catch(e => {
      hideLoading();
      setAdminIndexStatus(String(e?.message || e || "No se pudieron restablecer los precios."), true);
    });
}

// =================== LOADING (UX) ===================
function showLoading(text = "Cargando...", desc = "Por favor espera.") {
  LOADING_COUNT++;
  if (loadingText) loadingText.textContent = text;
  if (loadingDesc) loadingDesc.textContent = desc;
  if (loadingOverlay) loadingOverlay.classList.add("show");
  try { syncAdminActionBars(); } catch(_e) {}
}
function hideLoading() {
  LOADING_COUNT = Math.max(0, LOADING_COUNT - 1);
  if (LOADING_COUNT === 0 && loadingOverlay) loadingOverlay.classList.remove("show");
  try {
    syncAdminActionBars();
    window.requestAnimationFrame(() => { try { syncAdminActionBars(); } catch(_e){} });
  } catch(_e) {}
}
function buildInlineLoadMarkup_(title, sub){
  return `<div class="amInlineLoad"><div class="amInlineLoadSpin"></div><div class="amInlineLoadBody"><div class="amInlineLoadTitle">${escapeHtml(title || "Cargando…")}</div><div class="amInlineLoadSub">${escapeHtml(sub || "Un momento.")}</div></div></div>`;
}
function setInlineLoading_(container, title, sub){
  if (container) container.innerHTML = buildInlineLoadMarkup_(title, sub);
}
function scheduleAdminBackgroundRefresh_(reason){
  window.setTimeout(()=>{
    loadPendientes(true, { silent:true, reason: reason || "Actualizando pagos en segundo plano…" }).catch(err=>{
      const msg = String(err?.message || err || "");
      if(/unauthorized/i.test(msg)){
        SESSION = { operator: null, operatorId: null, pin: null };
        clearSavedAdminSession();
        showLogin();
      }
    });
  }, 60);
}

function syncPinToggleState() {
  if (!loginPin || !btnTogglePin) return;
  const hidden = loginPin.type !== "text";
  btnTogglePin.textContent = hidden ? "👁" : "🙈";
  btnTogglePin.setAttribute("aria-label", hidden ? "Mostrar contraseña" : "Ocultar contraseña");
}

function saveAdminSession(remember = false) {
  try { sessionStorage.setItem(SS_KEY, JSON.stringify(SESSION)); } catch {}
  try {
    if (remember) localStorage.setItem(LS_KEY, JSON.stringify(SESSION));
    else localStorage.removeItem(LS_KEY);
  } catch {}
}

function loadSavedAdminSession() {
  try {
    const rawLocal = localStorage.getItem(LS_KEY);
    const sLocal = rawLocal ? JSON.parse(rawLocal) : null;
    if (sLocal?.pin && sLocal?.operator) return { data: sLocal, remembered: true };
  } catch {}
  try {
    const raw = sessionStorage.getItem(SS_KEY);
    const s = raw ? JSON.parse(raw) : null;
    if (s?.pin && s?.operator) return { data: s, remembered: false };
  } catch {}
  return null;
}

function clearSavedAdminSession() {
  try { sessionStorage.removeItem(SS_KEY); } catch {}
  try { localStorage.removeItem(LS_KEY); } catch {}
  clearAdminDataCache_();
}

function getAdminCacheScope_(){
  return String(SESSION?.operatorId || SESSION?.operator || "").trim().toLowerCase();
}
function loadAdminLoginProfilesCache_(){
  try{
    const raw = sessionStorage.getItem(ADMIN_LOGIN_CACHE_KEY);
    const data = raw ? JSON.parse(raw) : null;
    return Array.isArray(data?.items) ? data.items : null;
  }catch(_e){ return null; }
}
function saveAdminLoginProfilesCache_(items){
  try{ sessionStorage.setItem(ADMIN_LOGIN_CACHE_KEY, JSON.stringify({ items: Array.isArray(items) ? items : [] })); }catch(_e){}
}
function loadAdminDataCache_(){
  try{
    const raw = sessionStorage.getItem(ADMIN_DATA_CACHE_KEY);
    const data = raw ? JSON.parse(raw) : null;
    const scope = getAdminCacheScope_();
    if(!data || !scope || String(data.scope || "") !== scope) return null;
    return data;
  }catch(_e){ return null; }
}
function saveAdminDataCache_(){
  try{
    const scope = getAdminCacheScope_();
    if(!scope) return;
    sessionStorage.setItem(ADMIN_DATA_CACHE_KEY, JSON.stringify({
      scope,
      pending: Array.isArray(pendingOrdersCache) ? pendingOrdersCache : [],
      hist: HIST_CACHE || null,
      histTime: Number(HIST_CACHE_TIME || 0) || 0,
      ts: Date.now()
    }));
  }catch(_e){}
}
function clearAdminDataCache_(){
  try{ sessionStorage.removeItem(ADMIN_DATA_CACHE_KEY); }catch(_e){}
}
function hydrateAdminFromCache_(cache){
  pendingOrdersCache = Array.isArray(cache?.pending) ? cache.pending : [];
  HIST_CACHE = cache?.hist || null;
  HIST_CACHE_TIME = Number(cache?.histTime || 0) || 0;
  renderOrdersList(listEl, pendingOrdersCache, { mode: "PENDIENTES" });
  setStatus(`${pendingOrdersCache.length} pedidos pendientes (caché de la sesión).`);
}

btnTogglePin?.addEventListener("click", () => {
  if (!loginPin) return;
  loginPin.type = loginPin.type === "password" ? "text" : "password";
  syncPinToggleState();
});
syncPinToggleState();

// =================== API (logs + retry 429) ===================
async function api(body, retries = 2) {
  try{ ensureApiWarmup_(); }catch(_e){}
  const payload = Object.assign({}, body || {});
  if (
    SESSION?.operatorId &&
    SESSION?.pin &&
    payload.action !== "profiles_auth" &&
    payload.action !== "validate_admin_pin" &&
    payload.action !== "profiles_public_list" &&
    !payload.auth_profile_id
  ) {
    payload.auth_profile_id = String(SESSION.operatorId || "").trim();
    payload.auth_profile_password = String(SESSION.pin || "").trim();
    payload.auth_page = "admin";
  }

  console.log("➡️ API request:", payload);

  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  console.log("⬅️ API status:", res.status);

  if (res.status === 429 && retries > 0) {
    await sleep(650 * (3 - retries));
    return api(body, retries - 1);
  }

  const out = await res.json().catch(async () => ({ ok:false, error: await res.text().catch(() => "") }));
  console.log("⬅️ API response:", out);

  if (!out.ok) throw new Error(out.error || "Error");
  return out;
}

// =================== PROFILES (login) ===================
async function fetchProfilesPublic(category) {
  const out = await api({ action: "profiles_public_list", category });
  const list = Array.isArray(out.profiles) ? out.profiles : (Array.isArray(out.items) ? out.items : []);
  // Normaliza: {id,label,pin?}
  return list
    .map(p => ({
      id: String(p.id || p.profile_id || ""),
      label: String(p.label || p.name || p.display_name || "").trim(),
      is_active: (p.is_active !== false),
    }))
    .filter(p => p.id && p.label && p.is_active);
}

function renderLoginProfiles(profiles) {
  if (!loginOperator) return;
  loginOperator.innerHTML = "";
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = profiles.length ? "Seleccionar..." : "No hay perfiles activos para esta página";
  loginOperator.appendChild(opt0);

  for (const p of profiles) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.label;
    loginOperator.appendChild(opt);
  }
}

function getSelectedProfile() {
  const id = String(loginOperator?.value || "").trim();
  if (!id) return null;
  return LOGIN_PROFILES.find(p => p.id === id) || null;
}

async function loadPaymentProfiles(force = false) {
  const cachedProfiles = !force ? loadAdminLoginProfilesCache_() : null;
  if(cachedProfiles && cachedProfiles.length){
    LOGIN_PROFILES = cachedProfiles;
    renderLoginProfiles(LOGIN_PROFILES);
    const saved = loadSavedAdminSession();
    if (saved?.data?.operatorId && loginOperator && !loginOperator.value) {
      loginOperator.value = String(saved.data.operatorId);
      if (loginPin && !loginPin.value) loginPin.value = String(saved.data.pin || "");
      if (loginRemember) loginRemember.checked = !!saved.remembered;
      syncPinToggleState();
    }
    return;
  }
  if (loginOperator) loginOperator.disabled = true;
  if (loginPin) loginPin.disabled = true;
  if (btnLogin) btnLogin.disabled = true;
  if (loginError && !force) loginError.textContent = "Cargando perfiles de pagos…";
  try {
    const buckets = await Promise.allSettled([
      fetchProfilesPublic("payments"),
      fetchProfilesPublic("pago"),
      fetchProfilesPublic("admin"),
    ]);
    const merged = [];
    const seen = new Set();
    for (const bucket of buckets) {
      const items = bucket?.status === "fulfilled" && Array.isArray(bucket.value) ? bucket.value : [];
      items.forEach(item => {
        const key = String(item?.id || "");
        if (!key || seen.has(key)) return;
        seen.add(key);
        merged.push(item);
      });
    }
    LOGIN_PROFILES = merged;
    saveAdminLoginProfilesCache_(LOGIN_PROFILES);
    renderLoginProfiles(LOGIN_PROFILES);
    const saved = loadSavedAdminSession();
    if (saved?.data?.operatorId && loginOperator && !loginOperator.value) {
      loginOperator.value = String(saved.data.operatorId);
      if (loginPin && !loginPin.value) loginPin.value = String(saved.data.pin || "");
      if (loginRemember) loginRemember.checked = !!saved.remembered;
      syncPinToggleState();
    }
    if (loginError && loginError.textContent === "Cargando perfiles de pagos…") loginError.textContent = "";
  } catch (e) {
    LOGIN_PROFILES = [];
    renderLoginProfiles([]);
    if (loginError) loginError.textContent = `No se pudieron cargar perfiles. ${String(e.message || e)}`;
  } finally {
    if (loginOperator) loginOperator.disabled = false;
    if (loginPin) loginPin.disabled = false;
    if (btnLogin) btnLogin.disabled = false;
  }
}




function ensureAdminHubReturnUI(){
  if(!FROM_HUB) return null;
  ensureHubReturnStyles_();
  let btn = document.getElementById("btnHeaderHub");
  if(adminHeaderActions && !btn){
    btn = document.createElement("button");
    btn.id = "btnHeaderHub";
    btn.type = "button";
    btn.className = "btn amBtnSoft";
    btn.textContent = "Panel";
    btn.addEventListener("click", goHub_);
    adminHeaderActions.insertBefore(btn, btnHeaderLogout || null);
  }
  const chip = document.getElementById("adminHubChip");
  if(chip) chip.remove();
  return { btn };
}

function syncAdminMobileReturnAction(){
  if(!btnMobileLogout) return;
  const fromHub = FROM_HUB;
  const ico = btnMobileLogout.querySelector('.ico');
  const txt = btnMobileLogout.querySelector('.txt');
  btnMobileLogout.setAttribute('aria-label', fromHub ? 'Volver al panel' : 'Salir');
  if(ico) ico.textContent = fromHub ? '⌂' : '⎋';
  if(txt) txt.textContent = fromHub ? 'Panel' : 'Salir';
}


function syncAdminActionBars() {
  const panelOpen = !!panelView && !panelView.classList.contains("hidden");
  const hasOverlay =
    (drawerOverlay && drawerOverlay.classList.contains("show")) ||
    (payModal && payModal.classList.contains("show")) ||
    (cancelModal && cancelModal.classList.contains("show")) ||
    (loadingOverlay && loadingOverlay.classList.contains("show"));

  if (adminHeaderActions) {
    const desktop = window.matchMedia("(min-width: 881px)").matches;
    adminHeaderActions.classList.toggle("isVisible", panelOpen && desktop);
  }
  const mobile = window.matchMedia("(max-width: 880px)").matches;
  syncAdminMobileReturnAction();
  if (adminMobileBar) {
    adminMobileBar.classList.toggle("isVisible", panelOpen && mobile && !hasOverlay);
  }
  if (btnHeaderLogout) {
    btnHeaderLogout.style.display = FROM_HUB ? "none" : "inline-flex";
    btnHeaderLogout.disabled = !!FROM_HUB;
  }
  const hubUi = ensureAdminHubReturnUI();
  if (hubUi?.btn) hubUi.btn.style.display = (panelOpen && !mobile) ? "inline-flex" : "none";
}

// =================== NAV (login/panel) ===================
function showPanel() {
  document.body.classList.remove("is-login");
  document.body.classList.add("is-app");
  if (loginView) loginView.classList.add("hidden");
  if (adminLoginTopbar) adminLoginTopbar.classList.add("hidden");
  const topbar = document.getElementById("adminTopbar");
  if (topbar) topbar.classList.remove("hidden");
  if (panelView) panelView.classList.remove("hidden");
  if (operatorName) operatorName.textContent = SESSION.operator || "";
  renderAdminIndexTools();
  syncAdminIndexCatalogFromBackend_(true).catch(()=>{});
  syncAdminActionBars();
}
function showLogin() {
  document.body.classList.remove("is-app");
  document.body.classList.add("is-login");
  if (panelView) panelView.classList.add("hidden");
  if (adminLoginTopbar) adminLoginTopbar.classList.remove("hidden");
  const topbar = document.getElementById("adminTopbar");
  if (topbar) topbar.classList.add("hidden");
  if (loginView) loginView.classList.remove("hidden");
  syncAdminActionBars();
}

// =================== Drawer ===================
function openDrawer() {
  if (drawerOverlay) drawerOverlay.classList.add("show");
  if (drawer) drawer.setAttribute("aria-hidden", "false");
  syncAdminActionBars();
}
function closeDrawer() {
  if (drawerOverlay) drawerOverlay.classList.remove("show");
  if (drawer) drawer.setAttribute("aria-hidden", "true");
  syncAdminActionBars();
}

// =================== MODALS ===================
function openModal(el) {
  if (!el) return;
  el.classList.add("show");
  el.setAttribute("aria-hidden", "false");
  syncAdminActionBars();
}
function closeModal(el) {
  if (!el) return;
  el.classList.remove("show");
  el.setAttribute("aria-hidden", "true");
  syncAdminActionBars();
}

// =================== ITEMS HELPERS ===================
function normalizeItemsFromOrder(order) {
  if (order.items_json) {
    const parsed = safeJsonParse(order.items_json);
    if (Array.isArray(parsed)) {
      return parsed.map(it => ({
        id: String(it.id || ""),
        name: String(it.name || ""),
        qty: Number(it.qty || 0),
        unit_price: Number(it.unit_price || it.price || 0),
      })).filter(it => it.name);
    }
  }

  if (order.items) {
    const lines = String(order.items).split("\n").map(s => s.trim()).filter(Boolean);
    const out = [];
    for (const line of lines) {
      const m = line.replace(/^-+\s*/, "").match(/^(.+?)\s*:\s*(\d+)/);
      if (!m) continue;
      const name = m[1].trim();
      const qty = Number(m[2]);
      const cat = PRODUCT_CATALOG.find(p => p.name.toLowerCase() === name.toLowerCase());
      out.push({
        id: cat?.id || name.toLowerCase().replace(/\s+/g, "_"),
        name,
        qty,
        unit_price: cat?.unit_price || 0
      });
    }
    return out.filter(it => it.name);
  }
  return [];
}

function buildEditableItems(order) {
  const current = normalizeItemsFromOrder(order);
  const map = new Map(current.map(it => [it.id, it]));

  const base = PRODUCT_CATALOG.map(p => ({
    id: p.id,
    name: p.name,
    qty: map.get(p.id)?.qty ?? 0,
    unit_price: p.unit_price
  }));

  current.forEach(it => {
    if (!base.some(b => b.id === it.id)) {
      base.push({
        id: it.id,
        name: it.name,
        qty: it.qty ?? 0,
        unit_price: it.unit_price ?? 0
      });
    }
  });

  return base;
}

function calcTotals(items) {
  const total_units = items.reduce((s, it) => s + Number(it.qty || 0), 0);
  const subtotal = items.reduce((s, it) => s + Number(it.qty || 0) * Number(it.unit_price || 0), 0);
  return { total_units, subtotal };
}

// =================== LOGIN ===================
btnLogin?.addEventListener("click", async () => {
  loginError.textContent = "";
  const prof = getSelectedProfile();
  const password = (loginPin?.value || "").trim();

  if (!prof || !password) {
    loginError.textContent = "Selecciona un perfil y escribe la contraseña.";
    return;
  }

  try {
    showLoading("Validando...", "Comprobando acceso...");
    const auth = await api({
      action: "profiles_auth",
      profile_id: prof.id,
      password_plain: password
    });
    const cats = Array.isArray(auth?.profile?.categories) ? auth.profile.categories.map(v => String(v || "").toLowerCase()) : [];
    const allowed = cats.includes("admin") || cats.includes("payments") || cats.includes("pago");
    if (auth.valid !== true || !allowed) {
      throw new Error(auth?.error || "Perfil sin permisos para esta página.");
    }

    SESSION = { operator: auth.profile.label || prof.label, operatorId: prof.id, pin: password };
    saveAdminSession(!!loginRemember?.checked);

    showPanel();
    const cached = loadAdminDataCache_();
    if (cached) hydrateAdminFromCache_(cached);
    else setInlineLoading_(listEl, "Cargando pedidos…", "Estamos trayendo los pedidos pendientes desde la base de datos.");
    scheduleAdminBackgroundRefresh_("Actualizando pagos en segundo plano…");
  } catch (e) {
    SESSION = { operator: null, operatorId: null, pin: null };
    clearSavedAdminSession();
    showLogin();
    loginError.textContent = `Error: ${String(e.message || e)}`;
  } finally {
    hideLoading();
  }
});

btnLogout?.addEventListener("click", () => {
  SESSION = { operator: null, operatorId: null, pin: null };
  clearSavedAdminSession();
  closeDrawer();
  showLogin();
});

// =================== PENDIENTES ===================
btnRefresh?.addEventListener("click", async () => loadPendientes(true));

async function loadPendientes(fromRefresh = false, opts = {}) {
  if (REQUEST_IN_FLIGHT) return;
  const silent = !!opts.silent;
  if (!fromRefresh) {
    const cached = loadAdminDataCache_();
    if (cached) {
      hydrateAdminFromCache_(cached);
      return;
    }
  }
  REQUEST_IN_FLIGHT = true;

  try {
    if (silent) {
      setStatus(String(opts.reason || "Actualizando pedidos en segundo plano…"));
      if (!pendingOrdersCache.length) setInlineLoading_(listEl, "Cargando pedidos…", "Estamos trayendo los pedidos pendientes desde la base de datos.");
    } else {
      showLoading(fromRefresh ? "Actualizando pedidos..." : "Cargando pedidos...");
      setStatus("Cargando pendientes...");
    }

    const out = await api({
      action: "list_orders",
      admin_pin: SESSION.pin,
      payment_status: "Pendiente"
    });

    pendingOrdersCache = out.orders || [];
    renderOrdersList(listEl, pendingOrdersCache, { mode: "PENDIENTES" });
    setStatus(`${pendingOrdersCache.length} pedidos pendientes.`);
    saveAdminDataCache_();
  } catch (e) {
    setStatus("❌ " + String(e.message || e));
    throw e;
  } finally {
    if (!silent) hideLoading();
    REQUEST_IN_FLIGHT = false;
  }
}

async function softRefreshPendientes() {
  await sleep(700);
  try { await loadPendientes(true); } catch {}
}

// =================== HISTORIAL ===================
btnHistory?.addEventListener("click", async () => {
  openDrawer();
  await loadHist(false, { silent:true });
});

drawerOverlay?.addEventListener("click", closeDrawer);
btnCloseDrawer?.addEventListener("click", closeDrawer);
btnHistRefresh?.addEventListener("click", async () => loadHist(true, { silent:true }));

chips.forEach(ch => {
  ch.addEventListener("click", async () => {
    chips.forEach(c => c.classList.remove("active"));
    ch.classList.add("active");
    histFilter = ch.dataset.filter;
    await loadHist(false);
  });
});

async function loadHist(forceFetch, opts = {}) {
  const silent = !!opts.silent;
  const now = Date.now();
  if (!forceFetch) {
    const persisted = loadAdminDataCache_();
    if (persisted?.hist) {
      HIST_CACHE = persisted.hist;
      HIST_CACHE_TIME = Number(persisted.histTime || now) || now;
    }
  }
  try {
    const useCache = HIST_CACHE && (now - HIST_CACHE_TIME) < HIST_TTL;
    if(!forceFetch && useCache){
      let all = [...(HIST_CACHE.paid || []), ...(HIST_CACHE.canceled || [])];
      all.sort((a, b) => (Date.parse(b.created_at || "") || 0) - (Date.parse(a.created_at || "") || 0));
      if (histFilter !== "ALL") all = all.filter(o => String(o.payment_status) === histFilter);
      renderOrdersList(histListEl, all, { mode: "HIST" });
      setHistStatus(`${all.length} pedidos (filtro: ${histFilter === "ALL" ? "Todos" : histFilter}) · caché de la sesión.`);
      return;
    }

    if (silent) {
      setHistStatus("Cargando historial…");
      if (histListEl && !String(histListEl.innerHTML || "").trim()) {
        setInlineLoading_(histListEl, "Cargando historial…", "Estamos consultando los pedidos pagados y cancelados.");
      }
    } else {
      showLoading("Cargando historial...");
      setHistStatus("Cargando...");
      if (histListEl) histListEl.innerHTML = "";
    }

    if (forceFetch || !useCache) {
      const [paid, canceled] = await Promise.all([
        api({ action: "list_orders", admin_pin: SESSION.pin, payment_status: "Pagado" }),
        api({ action: "list_orders", admin_pin: SESSION.pin, payment_status: "Cancelado" }),
      ]);
      HIST_CACHE = { paid: (paid.orders || []), canceled: (canceled.orders || []) };
      HIST_CACHE_TIME = now;
      saveAdminDataCache_();
    }

    let all = [...(HIST_CACHE.paid || []), ...(HIST_CACHE.canceled || [])];
    all.sort((a, b) => (Date.parse(b.created_at || "") || 0) - (Date.parse(a.created_at || "") || 0));

    if (histFilter !== "ALL") {
      all = all.filter(o => String(o.payment_status) === histFilter);
    }

    renderOrdersList(histListEl, all, { mode: "HIST" });
    setHistStatus(`${all.length} pedidos (filtro: ${histFilter === "ALL" ? "Todos" : histFilter}).`);
  } catch (e) {
    const msg = String(e.message || "");
    if (msg.toLowerCase().includes("too many") || msg.includes("429")) {
      setHistStatus("⚠️ Muchas solicitudes seguidas. Espera 2–3 segundos y presiona Refrescar.");
    } else {
      setHistStatus("❌ " + msg);
    }
  } finally {
    if (!silent) hideLoading();
  }
}

// =================== RENDER ===================
function renderOrdersList(container, orders, { mode }) {
  if (!container) return;
  container.innerHTML = "";

  if (!orders || orders.length === 0) {
    container.innerHTML = `<div class="mutedSmall" style="text-align:center; padding:14px;">No hay pedidos.</div>`;
    return;
  }

  for (const order of orders) {
    const card = document.createElement("div");
    card.className = "orderItem";

    const head = document.createElement("div");
    head.className = "orderHead";

    const statusBadge = (mode === "HIST")
      ? `<span class="badge">${escapeHtml(order.payment_status || "")}</span>`
      : "";

    head.innerHTML = `
      <div style="min-width:0;">
        <div class="orderId">
          ${escapeHtml(order.order_id || "")}
          <span class="badge">$${money(order.subtotal || 0)}</span>
          ${statusBadge}
        </div>
        <div class="orderMeta">${escapeHtml(order.customer_name || "")} • ${escapeHtml(formatDate(order.created_at || ""))}</div>
      </div>
      <div class="chev">›</div>
    `;

    const body = document.createElement("div");
    body.className = "orderBody";
    body.style.display = "none";

    head.addEventListener("click", () => {
      const open = body.style.display !== "none";
      body.style.display = open ? "none" : "block";
      card.classList.toggle("open", !open);
    });

    if (mode === "PENDIENTES") body.appendChild(renderPendingBody(order));
    else body.appendChild(renderHistBody(order));

    card.appendChild(head);
    card.appendChild(body);
    container.appendChild(card);
  }
}

function renderHistBody(order) {
  const wrap = document.createElement("div");

  const items = normalizeItemsFromOrder(order);
  const lines = items.length
    ? items.map(it => `<div class="mutedSmall">• ${escapeHtml(it.name)} x${Number(it.qty || 0)}</div>`).join("")
    : `<div class="mutedSmall">Sin items</div>`;

  wrap.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:8px;">
      <div><strong>Dirección:</strong> ${escapeHtml(order.address_text || "")}</div>
      <div><strong>Ubicación:</strong> ${escapeHtml(order.maps_link || "")}</div>
      <div><strong>Tel:</strong> ${escapeHtml(order.phone || "")}</div>
      <div><strong>Notas:</strong> ${escapeHtml(order.notes || "")}</div>
      <div><strong>Items:</strong><div style="margin-top:6px;">${lines}</div></div>
      ${order.payment_status === "Pagado" ? `
        <div class="mutedSmall"><strong>Método:</strong> ${escapeHtml(order.payment_method || "")} • <strong>Ref:</strong> ${escapeHtml(order.payment_ref || "")}</div>
      ` : ""}
      ${order.payment_status === "Cancelado" ? `
        <div class="mutedSmall"><strong>Razón:</strong> ${escapeHtml(order.cancel_reason || "")}</div>
      ` : ""}
    </div>
  `;
  return wrap;
}


function renderPendingBody(order) {
  const wrap = document.createElement("div");
  let editMode = false;

  // Copia editable inicial (para poder cancelar edición)
  const initialFields = {
    customer_name: String(order.customer_name || ""),
    phone: String(order.phone || ""),
    address_text: String(order.address_text || ""),
    maps_link: String(order.maps_link || ""),
    notes: String(order.notes || ""),
    email: String(order.email || ""),
    wa_opt_in: Boolean(order.wa_opt_in),
  };

  let fields = { ...initialFields };

  let items = buildEditableItems(order);
  let totals = calcTotals(items);

  function render() {
    const itemsLines = items.map((it, idx) => `
      <div class="rowBetween" style="gap:10px;">
        <div style="flex:1;">
          <div style="font-weight:900;">${escapeHtml(it.name)}</div>
          <div class="mutedSmall">$${money(it.unit_price)} c/u</div>
        </div>
        <div style="min-width:120px; text-align:right;">
          ${editMode
            ? `<input class="input itemQty" type="number" min="0" step="1" value="${Number(it.qty || 0)}" data-idx="${idx}" style="width:110px; text-align:right;" />`
            : `<div style="font-weight:900;">x${Number(it.qty || 0)}</div>`
          }
        </div>
      </div>
    `).join("");

    wrap.innerHTML = `
      <div style="margin-top:10px; display:flex; flex-direction:column; gap:10px;">

        ${!editMode ? `
          <div><strong>Nombre:</strong> ${escapeHtml(fields.customer_name)}</div>
          <div><strong>Tel:</strong> ${escapeHtml(fields.phone)}</div>
          <div><strong>Dirección:</strong> ${escapeHtml(fields.address_text)}</div>
          <div><strong>Ubicación:</strong> ${escapeHtml(fields.maps_link)}</div>
          <div><strong>Email:</strong> ${escapeHtml(fields.email)}</div>
          <div><strong>Opt-in WhatsApp:</strong> ${fields.wa_opt_in ? "Sí" : "No"}</div>
          <div><strong>Notas:</strong> ${escapeHtml(fields.notes)}</div>
        ` : `
          <div>
            <div class="mutedSmall" style="font-weight:900;">Nombre</div>
            <input id="ed_name" class="input" type="text" value="${escapeHtml(fields.customer_name)}" />
          </div>

          <div>
            <div class="mutedSmall" style="font-weight:900;">Teléfono</div>
            <input id="ed_phone" class="input" type="text" value="${escapeHtml(fields.phone)}" />
            <div class="mutedSmall">Tip: déjalo como texto para no perder ceros.</div>
          </div>

          <div>
            <div class="mutedSmall" style="font-weight:900;">Dirección</div>
            <input id="ed_addr" class="input" type="text" value="${escapeHtml(fields.address_text)}" />
          </div>

          <div>
            <div class="mutedSmall" style="font-weight:900;">Ubicación (Maps/WhatsApp)</div>
            <input id="ed_maps" class="input" type="text" value="${escapeHtml(fields.maps_link)}" />
          </div>

          <div>
            <div class="mutedSmall" style="font-weight:900;">Email (opcional)</div>
            <input id="ed_email" class="input" type="email" value="${escapeHtml(fields.email)}" />
          </div>

          <div style="display:flex; align-items:center; gap:10px;">
            <input id="ed_optin" type="checkbox" ${fields.wa_opt_in ? "checked" : ""} />
            <label for="ed_optin"><strong>Opt-in WhatsApp</strong></label>
          </div>

          <div>
            <div class="mutedSmall" style="font-weight:900;">Notas</div>
            <textarea id="ed_notes" class="input" rows="3" style="resize:vertical;">${escapeHtml(fields.notes)}</textarea>
          </div>
        `}
      </div>

      <div style="margin-top:12px;">
        <div class="mutedSmall" style="font-weight:900;">Items</div>
        <div style="display:flex; flex-direction:column; gap:10px; margin-top:8px;">${itemsLines}</div>
      </div>

      <div class="rowBetween" style="margin-top:12px;">
        <div class="mutedSmall">Unidades</div>
        <div class="t_units" style="font-weight:950;">${Number(totals.total_units)}</div>
      </div>
      <div class="rowBetween">
        <div class="mutedSmall">Subtotal</div>
        <div class="t_subtotal" style="font-weight:950;">$${money(totals.subtotal)}</div>
      </div>

      <div style="margin-top:12px; display:flex; gap:10px; flex-wrap:wrap;">
        ${!editMode ? `<button class="btn secondary btnEdit" type="button">Editar pedido</button>` : ""}
        ${editMode ? `<button class="btn secondary btnSave" type="button">Guardar cambios</button>` : ""}
        ${editMode ? `<button class="btn secondary btnCancelEdit" type="button">Cancelar edición</button>` : ""}

        <button class="btn btnDanger btnCancel" type="button">Cancelar Pedido</button>
        <button class="btn primary btnPay" type="button">Confirmar pago</button>
      </div>
    `;

    // ====== En modo edición: listeners para items ======
    if (editMode) {
      wrap.querySelectorAll(".itemQty").forEach(inp => {
        inp.addEventListener("input", () => {
          const idx = Number(inp.dataset.idx);
          items[idx].qty = Number(inp.value || 0);
          totals = calcTotals(items);
          wrap.querySelector(".t_units").textContent = String(totals.total_units);
          wrap.querySelector(".t_subtotal").textContent = `$${money(totals.subtotal)}`;
        });
      });

      // ====== listeners para campos ======
      const ed_name = wrap.querySelector("#ed_name");
      const ed_phone = wrap.querySelector("#ed_phone");
      const ed_addr = wrap.querySelector("#ed_addr");
      const ed_maps = wrap.querySelector("#ed_maps");
      const ed_email = wrap.querySelector("#ed_email");
      const ed_notes = wrap.querySelector("#ed_notes");
      const ed_optin = wrap.querySelector("#ed_optin");

      const syncFields = () => {
        fields.customer_name = (ed_name?.value || "").trim();
        fields.phone = (ed_phone?.value || "").trim();
        fields.address_text = (ed_addr?.value || "").trim();
        fields.maps_link = (ed_maps?.value || "").trim();
        fields.email = (ed_email?.value || "").trim();
        fields.notes = (ed_notes?.value || "").trim();
        fields.wa_opt_in = !!ed_optin?.checked;
      };

      [ed_name, ed_phone, ed_addr, ed_maps, ed_email, ed_notes].forEach(el => {
        el?.addEventListener("input", syncFields);
      });
      ed_optin?.addEventListener("change", syncFields);
    }

    // ====== Botones ======
    wrap.querySelector(".btnEdit")?.addEventListener("click", () => {
      editMode = true;
      render();
    });

    wrap.querySelector(".btnCancelEdit")?.addEventListener("click", () => {
      editMode = false;
      fields = { ...initialFields };
      items = buildEditableItems(order);
      totals = calcTotals(items);
      render();
    });

    wrap.querySelector(".btnSave")?.addEventListener("click", async () => {
      try {
        showLoading("Guardando cambios...");
        setStatus("Guardando cambios del pedido...");

        // Validaciones mínimas (antes de enviar)
        if (!fields.customer_name.trim()) {
          alert("El nombre no puede quedar vacío.");
          return;
        }
        if (!fields.phone.trim()) {
          alert("El teléfono no puede quedar vacío.");
          return;
        }
        if (!fields.address_text.trim()) {
          alert("La dirección no puede quedar vacía.");
          return;
        }

        const updatedItems = items
          .map(it => ({
            id: it.id,
            name: it.name,
            qty: Number(it.qty || 0),
            price: Number(it.unit_price || 0)
          }))
          .filter(it => it.qty > 0);

        await api({
          action: "update_order",
          admin_pin: SESSION.pin,
          operator: SESSION.operator,
          order_id: order.order_id,

          // ✅ campos completos editables
          customer_name: fields.customer_name,
          phone: fields.phone,
          address_text: fields.address_text,
          maps_link: fields.maps_link,
          notes: fields.notes,
          email: fields.email,
          wa_opt_in: fields.wa_opt_in,

          // ✅ items (recalcula subtotal/unidades en backend)
          items: updatedItems
        });

        // Actualiza el objeto local para que al cerrar edición se vea lo nuevo
        order.customer_name = fields.customer_name;
        order.phone = fields.phone;
        order.address_text = fields.address_text;
        order.maps_link = fields.maps_link;
        order.notes = fields.notes;
        order.email = fields.email;
        order.wa_opt_in = fields.wa_opt_in;

        order.items_json = JSON.stringify(updatedItems.map(it => ({
          id: it.id, name: it.name, qty: it.qty, unit_price: it.price
        })));

        // refrescar totals local
        items = buildEditableItems(order);
        totals = calcTotals(items);

        // cerrar edición
        editMode = false;

        // actualiza snapshot “inicial” para futuras ediciones
        initialFields.customer_name = fields.customer_name;
        initialFields.phone = fields.phone;
        initialFields.address_text = fields.address_text;
        initialFields.maps_link = fields.maps_link;
        initialFields.notes = fields.notes;
        initialFields.email = fields.email;
        initialFields.wa_opt_in = fields.wa_opt_in;

        setStatus("✅ Pedido actualizado (solo permitido si estaba Pendiente).");
        HIST_CACHE = null; HIST_CACHE_TIME = 0;

        render();
        await softRefreshPendientes();

      } catch (e) {
        const msg = String(e.message || e);
        // Si intentan editar después de pagado/cancelado, el backend responde Locked
        if (msg.toLowerCase().includes("locked")) {
          alert("Este pedido ya no está Pendiente. No se puede editar después de confirmar/cancelar.");
        }
        setStatus("❌ " + msg);
      } finally {
        hideLoading();
      }
    });

    wrap.querySelector(".btnPay")?.addEventListener("click", () => openPayModal(order));
    wrap.querySelector(".btnCancel")?.addEventListener("click", () => openCancelModal(order));
  }

  render();
  return wrap;
}

// =================== PAGO ===================
payMethod?.addEventListener("change", () => {
  syncPayMethodUI();
  resetPayTimerIfNeeded();
  maybeStartPayTimer();
});
payOtherText?.addEventListener("input", () => { syncPayMethodUI(); resetPayTimerIfNeeded(); maybeStartPayTimer(); });
payRef?.addEventListener("input", () => { resetPayTimerIfNeeded(); maybeStartPayTimer(); });

btnPayBack?.addEventListener("click", closePayModal);

function openPayModal(order) {
  modalOrder = order;

  payMethod.value = "";
  payRef.value = "";
  payOtherText.value = "";
  payOtherWrap.classList.add("hidden");
  syncPayMethodUI();

  btnPayConfirm.disabled = true;
  payTimer.textContent = "Completa los datos para iniciar la confirmación.";
  payTimerStarted = false;

  payTitle.textContent = "Confirmar pago";
  payText.textContent = `Confirma el pago del pedido ${order.order_id} por $${money(order.subtotal)}.`;

  openModal(payModal);
}

function closePayModal() {
  stopPayCountdown();
  closeModal(payModal);
  modalOrder = null;
}

function paymentMethodNeedsReference(methodValue) {
  const value = String(methodValue || "").trim().toLowerCase();
  if (!value) return false;
  return value !== "efectivo";
}

function syncPayMethodUI() {
  const methodValue = String(payMethod?.value || "");
  const isOther = methodValue === "Otro";
  payOtherWrap?.classList.toggle("hidden", !isOther);

  const finalMethod = isOther ? String(payOtherText?.value || "").trim() : methodValue;
  const needsRef = paymentMethodNeedsReference(finalMethod);

  if (payRefWrap) payRefWrap.classList.toggle("hidden", !needsRef);
  if (payRef) {
    payRef.disabled = !needsRef;
    payRef.placeholder = needsRef ? "Referencia / últimos dígitos" : "No aplica para efectivo";
    if (!needsRef) payRef.value = "";
  }
}

function isPayValid() {
  if (!payMethod.value) return false;
  if (payMethod.value === "Otro" && !payOtherText.value.trim()) return false;
  const finalMethod = (payMethod.value === "Otro") ? payOtherText.value.trim() : payMethod.value;
  if (paymentMethodNeedsReference(finalMethod) && !payRef.value.trim()) return false;
  return true;
}

function maybeStartPayTimer() {
  if (payTimerStarted) return;
  if (!isPayValid()) {
    btnPayConfirm.disabled = true;
    payTimer.textContent = "Completa los datos para iniciar la confirmación.";
    return;
  }
  startPayCountdown(3);
}

function resetPayTimerIfNeeded() {
  if (!payTimerStarted) return;
  stopPayCountdown();
  btnPayConfirm.disabled = true;
  payTimer.textContent = "Completa los datos para iniciar la confirmación.";
  payTimerStarted = false;
}

function startPayCountdown(seconds) {
  stopPayCountdown();
  payTimerStarted = true;

  let t = seconds;
  btnPayConfirm.disabled = true;
  payTimer.textContent = `Espera ${t}s para habilitar...`;

  payCountdownInt = setInterval(() => {
    t--;
    if (t <= 0) {
      stopPayCountdown(false);
      payTimer.textContent = "Listo. Puedes confirmar ahora.";
      btnPayConfirm.disabled = false;
    } else {
      payTimer.textContent = `Espera ${t}s para habilitar...`;
    }
  }, 1000);
}

function stopPayCountdown(resetStarted = true) {
  if (payCountdownInt) clearInterval(payCountdownInt);
  payCountdownInt = null;
  if (resetStarted) payTimerStarted = false;
}

btnPayConfirm?.addEventListener("click", async () => {
  if (!modalOrder) return;
  if (!isPayValid()) return;

  const finalMethod = (payMethod.value === "Otro") ? payOtherText.value.trim() : payMethod.value;
  const finalRef = paymentMethodNeedsReference(finalMethod) ? payRef.value.trim() : "";

  const orderId = modalOrder.order_id;

  try {
    // ✅ UI optimista: remover YA del listado
    pendingOrdersCache = pendingOrdersCache.filter(o => o.order_id !== orderId);
    renderOrdersList(listEl, pendingOrdersCache, { mode: "PENDIENTES" });
    setStatus("Procesando confirmación de pago...");
    HIST_CACHE = null; HIST_CACHE_TIME = 0;
    saveAdminDataCache_();

    closePayModal();
    showLoading("Confirmando pago...");

    await api({
      action: "mark_paid",
      admin_pin: SESSION.pin,
      operator: SESSION.operator,
      order_id: orderId,
      payment_method: finalMethod,
      payment_ref: finalRef
    });

    setStatus("✅ Pago confirmado. Removido de Pendientes.");
    HIST_CACHE = null; HIST_CACHE_TIME = 0;

    await softRefreshPendientes();
  } catch (e) {
    const msg = String(e.message || "");
    if (msg.toLowerCase().includes("too many") || msg.includes("429")) {
      setStatus("⚠️ Confirmado, pero hay muchas solicitudes. Refresca en unos segundos si no ves el cambio.");
    } else {
      setStatus("❌ " + msg);
    }
    await softRefreshPendientes();
  } finally {
    hideLoading();
  }
});

// =================== CANCELAR ===================
cancelReason?.addEventListener("change", () => {
  cancelOtherWrap?.classList.toggle("hidden", cancelReason.value !== "Otro");
  resetCancelTimerIfNeeded();
  maybeStartCancelTimer();
});
cancelOtherText?.addEventListener("input", () => { resetCancelTimerIfNeeded(); maybeStartCancelTimer(); });

btnCancelBack?.addEventListener("click", closeCancelModal);

function openCancelModal(order) {
  modalOrder = order;

  cancelReason.value = "";
  cancelOtherText.value = "";
  cancelOtherWrap.classList.add("hidden");

  btnCancelConfirm.disabled = true;
  cancelTimer.textContent = "Selecciona una razón para habilitar la cancelación.";
  cancelTimerStarted = false;

  cancelTitle.textContent = "Cancelar pedido";
  cancelText.textContent = `Vas a cancelar el pedido ${order.order_id} por $${money(order.subtotal)}.`;

  openModal(cancelModal);
}

function closeCancelModal() {
  stopCancelCountdown();
  closeModal(cancelModal);
  modalOrder = null;
}

function isCancelValid() {
  if (!cancelReason.value) return false;
  if (cancelReason.value === "Otro" && !cancelOtherText.value.trim()) return false;
  return true;
}

function maybeStartCancelTimer() {
  if (cancelTimerStarted) return;
  if (!isCancelValid()) {
    btnCancelConfirm.disabled = true;
    cancelTimer.textContent = "Selecciona una razón para habilitar la cancelación.";
    return;
  }
  startCancelCountdown(3);
}

function resetCancelTimerIfNeeded() {
  if (!cancelTimerStarted) return;
  stopCancelCountdown();
  btnCancelConfirm.disabled = true;
  cancelTimer.textContent = "Selecciona una razón para habilitar la cancelación.";
  cancelTimerStarted = false;
}

function startCancelCountdown(seconds) {
  stopCancelCountdown();
  cancelTimerStarted = true;

  let t = seconds;
  btnCancelConfirm.disabled = true;
  cancelTimer.textContent = `Espera ${t}s para habilitar...`;

  cancelCountdownInt = setInterval(() => {
    t--;
    if (t <= 0) {
      stopCancelCountdown(false);
      cancelTimer.textContent = "Listo. Puedes cancelar ahora.";
      btnCancelConfirm.disabled = false;
    } else {
      cancelTimer.textContent = `Espera ${t}s para habilitar...`;
    }
  }, 1000);
}

function stopCancelCountdown(resetStarted = true) {
  if (cancelCountdownInt) clearInterval(cancelCountdownInt);
  cancelCountdownInt = null;
  if (resetStarted) cancelTimerStarted = false;
}

btnCancelConfirm?.addEventListener("click", async () => {
  if (!modalOrder) return;
  if (!isCancelValid()) return;

  const reason = (cancelReason.value === "Otro") ? cancelOtherText.value.trim() : cancelReason.value;
  const orderId = modalOrder.order_id;

  try {
    // ✅ UI optimista: remover YA del listado
    pendingOrdersCache = pendingOrdersCache.filter(o => o.order_id !== orderId);
    renderOrdersList(listEl, pendingOrdersCache, { mode: "PENDIENTES" });
    setStatus("Procesando cancelación...");
    HIST_CACHE = null; HIST_CACHE_TIME = 0;
    saveAdminDataCache_();

    closeCancelModal();
    showLoading("Cancelando pedido...");

    await api({
      action: "cancel_order",
      admin_pin: SESSION.pin,
      operator: SESSION.operator,
      order_id: orderId,
      cancel_reason: reason
    });

    setStatus("✅ Pedido cancelado. Removido de Pendientes.");
    HIST_CACHE = null; HIST_CACHE_TIME = 0;

    await softRefreshPendientes();
  } catch (e) {
    const msg = String(e.message || "");
    if (msg.toLowerCase().includes("too many") || msg.includes("429")) {
      setStatus("⚠️ Cancelado, pero hay muchas solicitudes. Refresca en unos segundos si no ves el cambio.");
    } else {
      setStatus("❌ " + msg);
    }
    await softRefreshPendientes();
  } finally {
    hideLoading();
  }
});

// =================== INIT ===================
(async function init() {
  try {
    const savedWrap = loadSavedAdminSession();
    const saved = savedWrap?.data || null;
    const shouldShowProfilesBoot = !FROM_HUB && !saved;
    if (shouldShowProfilesBoot) {
      showLoading("Cargando perfiles…", "Buscando perfiles de pagos.");
      await loadPaymentProfiles();
    } else {
      loadPaymentProfiles().catch(()=>{});
    }

    if (saved) {
      try {
        const s = saved;
        if (loginRemember) loginRemember.checked = !!savedWrap?.remembered;
        if (s?.pin || s?.password) {
          if (s.operatorId && loginOperator) loginOperator.value = String(s.operatorId);
          if (loginPin) loginPin.value = String(s.pin || s.password || "");
          const prof = s.operatorId ? (LOGIN_PROFILES.find(p => p.id === String(s.operatorId)) || null) : null;
          SESSION = { operator: prof?.label || String(s.operator || ""), operatorId: prof?.id || String(s.operatorId || ""), pin: String(s.pin || s.password || "") };

          if (SESSION.operator && SESSION.pin) {
            showPanel();
            const cached = loadAdminDataCache_();
            if (cached) {
              hydrateAdminFromCache_(cached);
            } else {
              setInlineLoading_(listEl, "Cargando pedidos…", "Estamos trayendo los pedidos pendientes desde la base de datos.");
            }
            scheduleAdminBackgroundRefresh_("Actualizando pagos en segundo plano…");
          } else {
            showLogin();
          }
        } else {
          showLogin();
        }
      } catch {
        showLogin();
      }
    } else {
      showLogin();
    }
  } finally {
    hideLoading();
    revealHubBoot_();
    syncAdminActionBars();
  }
})();



[btnMobileRefresh].forEach(btn => btn?.addEventListener("click", ()=> btnHeaderRefresh?.click()));
[btnMobileHistory].forEach(btn => btn?.addEventListener("click", ()=> btnHeaderHistory?.click()));
[btnMobileLogout].forEach(btn => btn?.addEventListener("click", ()=> { if(FROM_HUB) goHub_(); else btnHeaderLogout?.click(); }));
btnAdminIndexSavePrices?.addEventListener("click", saveAdminIndexPrices);
btnAdminIndexResetPrices?.addEventListener("click", resetAdminIndexPrices);
btnAdminOpenIndexPage?.addEventListener("click", ()=>{ try{ setAdminIndexStatus(""); }catch(_e){} });
window.addEventListener("resize", syncAdminActionBars);
setTimeout(syncAdminActionBars, 0);
