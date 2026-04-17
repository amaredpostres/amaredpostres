/* AMARED Compras & Costos - Unificado v7
   ✅ Misma lógica de cálculo (Pagado + No iniciar)
   ✅ Ventana: ayer 3pm → hoy 3pm + sección de pedidos tarde
   ✅ UI tipo tarjetas + acordeones (mobile-first)
   ✅ Switch Comprar + empaques/cantidad + Auto
   ✅ Modal para editar COSTOS_INGREDIENTES
   ✅ Pestaña Costos (listado + edición + catálogos)
   ✅ Total estimado + confirmación antes de registrar
*/
"use strict";

const API_URL = "https://amared-orders.amaredpostres.workers.dev/";
const LS_SECRET_KEY = "AMARED_COSTS_SECRET";
const LS_REMEMBER_KEY = "AMARED_COSTS_REMEMBER_V1";
const LS_PROFILE_KEY = "AMARED_COSTS_PROFILE_ID";
const LS_DELETED_DESSERTS_KEY = "AMARED_DELETED_DESSERTS_V1";
const SS_COSTS_SESSION_KEY = "AMARED_COSTS_SESSION_V1";
const HUB_URL = "hub.html";
const HUB_SESSION_KEY = "AMARED_HUB_SESSION_V1";
const HUB_REMEMBER_KEY = "AMARED_HUB_REMEMBER_V1";
const COSTS_LOGIN_CACHE_KEY = "AMARED_PAGECACHE_COSTS_LOGIN_V1";
const COSTS_DATA_CACHE_KEY = "AMARED_PAGECACHE_COSTS_DATA_V1";
const FROM_HUB = (() => { try { return new URLSearchParams(window.location.search).get("hub") === "1"; } catch { return false; } })();
function hasHubAccess_(){
  return FROM_HUB;
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


let UNLOCKED_SECRET = "";
let UNLOCKED_PROFILE = { id:"", label:"", categories:[] };
let LOGIN_PROFILES = [];
let state = {
  items: [],
  costsByKey: {},
  inventory: {},
  needs: {},
  meta: {},
  ordersByDessert: {},
  late: {},
  stores: [],
  brands: [],
  buyPlan: {},
  window_h: 36,
  view: "purchases",
  ui: {
    q: "",
    onlyMissing: true,
    onlySelected: false,
    cost_q: "",
  }
};

// --- RECETAS (desde hoja RECETAS) ---
state.recipesByDessert = null; // {dessert_id: [{ingredient_key, qty_per_unit, unit}]}
state.recipesSource = "embedded"; // "sheet" | "embedded"
state.recipesPinUnlocked = false;
state.recipesPin = "";
state.desserts = [];
state.recipesLoadedAt = 0;
let RECIPES_FETCH_PROMISE = null;
let RECIPES_WARM_TIMER = 0;

function getCostsCacheScope_(scope){
  return String(scope || UNLOCKED_PROFILE?.id || "").trim().toLowerCase();
}
function loadCostsLoginCache_(){
  try{
    const raw = sessionStorage.getItem(COSTS_LOGIN_CACHE_KEY);
    const data = raw ? JSON.parse(raw) : null;
    return Array.isArray(data?.items) ? data.items : null;
  }catch(_e){ return null; }
}
function saveCostsLoginCache_(items){
  try{ sessionStorage.setItem(COSTS_LOGIN_CACHE_KEY, JSON.stringify({ items: Array.isArray(items) ? items : [] })); }catch(_e){}
}
function loadCostsDataCache_(scope){
  try{
    const raw = sessionStorage.getItem(COSTS_DATA_CACHE_KEY);
    const data = raw ? JSON.parse(raw) : null;
    const wanted = getCostsCacheScope_(scope);
    if(!data || !wanted || String(data.scope || "") !== wanted) return null;
    return data;
  }catch(_e){ return null; }
}
function saveCostsDataCache_(){
  try{
    const scope = getCostsCacheScope_();
    if(!scope) return;
    sessionStorage.setItem(COSTS_DATA_CACHE_KEY, JSON.stringify({
      scope,
      profileLabel: String(UNLOCKED_PROFILE?.label || ""),
      profileCategories: Array.isArray(UNLOCKED_PROFILE?.categories) ? UNLOCKED_PROFILE.categories : [],
      inventory: state.inventory || {},
      needs: state.needs || {},
      meta: state.meta || {},
      ordersByDessert: state.ordersByDessert || {},
      late: state.late || {},
      items: state.items || [],
      stores: state.stores || [],
      brands: state.brands || [],
      desserts: state.desserts || [],
      recipesByDessert: state.recipesByDessert || null,
      recipesSource: state.recipesSource || "embedded",
      recipesLoadedAt: Number(state.recipesLoadedAt || 0) || 0,
      buyPlan: state.buyPlan || {},
      ts: Date.now()
    }));
  }catch(_e){}
}
function clearCostsDataCache_(){
  try{ sessionStorage.removeItem(COSTS_DATA_CACHE_KEY); }catch(_e){}
}
function hydrateCostsDataFromCache_(cache){
  state.inventory = cache?.inventory || {};
  state.needs = cache?.needs || {};
  state.meta = cache?.meta || {};
  state.ordersByDessert = cache?.ordersByDessert || {};
  state.late = cache?.late || {};
  state.items = cache?.items || [];
  state.stores = Array.isArray(cache?.stores) ? cache.stores : [];
  state.brands = Array.isArray(cache?.brands) ? cache.brands : [];
  state.desserts = Array.isArray(cache?.desserts) ? cache.desserts : [];
  state.recipesByDessert = cache?.recipesByDessert || state.recipesByDessert;
  state.recipesSource = cache?.recipesSource || state.recipesSource;
  state.recipesLoadedAt = Number(cache?.recipesLoadedAt || 0) || state.recipesLoadedAt || 0;
  state.buyPlan = cache?.buyPlan || state.buyPlan || {};
  state.needs = mergeLateNeedsInto_(state.needs || {}, state.late || {});
  indexCosts(state.items);
  updateMetaLine();
  renderDesserts();
  renderUnitCosts();
  renderLate();
  renderGroups();
  renderCostGroupsIfOpen_();
  refreshBottom();
  saveCostsDataCache_();
  scheduleRecipesWarmup_();
}

// ====== Costo unitario por postre (recetas canónicas) ======
const AMARED_RECIPES_PER_UNIT = {
  "mousse_maracuya": [
    [
      "Pulpa de maracuyá",
      21.4
    ],
    [
      "Leche condensada",
      42.8
    ],
    [
      "Crema de leche",
      42.8
    ],
    [
      "Leche entera",
      42.8
    ],
    [
      "Gelatina sin sabor",
      1.25
    ],
    [
      "Agua",
      8.3
    ],
    [
      "Vainilla",
      0.33
    ],
    [
      "Galletas saladas",
      25.0
    ],
    [
      "Mantequilla sin sal",
      11.7
    ],
    [
      "Chocorramo",
      20.0
    ],
    [
      "Chocolate en polvo",
      20.0
    ],
    [
      "Envase plástico",
      1.0
    ],
    [
      "Cuchara plástica",
      1.0
    ]
  ],
  "cheesecake_cafe_panela": [
    [
      "Galletas saladas",
      25.0
    ],
    [
      "Mantequilla sin sal",
      10.0
    ],
    [
      "Queso crema",
      75.0
    ],
    [
      "Crema de leche",
      41.7
    ],
    [
      "Leche condensada",
      25.0
    ],
    [
      "Café",
      10.0
    ],
    [
      "Panela",
      3.33
    ],
    [
      "Gelatina sin sabor",
      1.67
    ],
    [
      "Agua",
      7.5
    ],
    [
      "Vainilla",
      0.33
    ],
    [
      "Galleta de leche",
      25.0
    ],
    [
      "Envase plástico",
      1.0
    ],
    [
      "Cuchara plástica",
      1.0
    ]
  ]
};



// =============== DOM helpers ===============
const el = (id) => document.getElementById(id);
const FRONT_OVERLAY_IDS = [
  "unlockBack",
  "recipesUnlockBack",
  "costModalBack",
  "dessertModalBack",
  "ingModalBack",
  "ingConfirmBack",
  "catModalBack",
  "confirmBack",
  "loadingBack",
  "dessertDeleteBack"
];

function isFrontOverlayOpen_(){
  for(const id of FRONT_OVERLAY_IDS){
    const node = el(id);
    if(!node) continue;
    const isHiddenClass = node.classList.contains("hidden");
    const isHiddenAttr = node.hidden === true;
    const displayNone = node.style && node.style.display === "none";
    if(!isHiddenClass && !isHiddenAttr && !displayNone) return true;
  }
  return false;
}

let COSTS_SCROLL_LOCK_Y = null;

function setBodyScrollLock_(locked){
  try{
    const body = document.body;
    if(!body) return;
    if(locked){
      if(COSTS_SCROLL_LOCK_Y === null){
        COSTS_SCROLL_LOCK_Y = window.scrollY || window.pageYOffset || 0;
        body.style.position = "fixed";
        body.style.top = `-${COSTS_SCROLL_LOCK_Y}px`;
        body.style.left = "0";
        body.style.right = "0";
        body.style.width = "100%";
      }
    }else if(COSTS_SCROLL_LOCK_Y !== null){
      const y = COSTS_SCROLL_LOCK_Y;
      COSTS_SCROLL_LOCK_Y = null;
      body.style.position = "";
      body.style.top = "";
      body.style.left = "";
      body.style.right = "";
      body.style.width = "";
      window.scrollTo(0, y);
    }
  }catch(_e){}
}

function syncFrontLayer_(){
  try{
    const locked = isFrontOverlayOpen_();
    document.body.classList.toggle("hasFrontOverlay", locked);
    setBodyScrollLock_(locked);
  }catch(_e){}
}

const show = (node) => { if(node){ node.classList.remove("hidden"); node.hidden = false; node.style.display = ""; } syncFrontLayer_(); };
const hide = (node) => { if(node){ node.classList.add("hidden"); node.hidden = true; node.style.display = "none"; } syncFrontLayer_(); };

// =============== Mobile nav ===============
function updateMobileNavLabel_(){
  const btnPurch = el("mNavGoPurchases");
  const btnRec = el("mNavGoRecipes");
  const isRecipes = (state.view === "recipes");

  if(btnPurch){
    btnPurch.classList.toggle("isActive", !isRecipes);
    btnPurch.setAttribute("aria-selected", isRecipes ? "false" : "true");
    btnPurch.setAttribute("tabindex", isRecipes ? "-1" : "0");
  }
  if(btnRec){
    btnRec.classList.toggle("isActive", isRecipes);
    btnRec.setAttribute("aria-selected", isRecipes ? "true" : "false");
    btnRec.setAttribute("tabindex", isRecipes ? "0" : "-1");
  }
}
function openMobileNavSheet_(){ updateMobileNavLabel_(); }
function closeMobileNavSheet_(){}


function ensureCostsHubReturnUI(){
  if(!hasHubAccess_()) return null;
  const desktopWrap = document.querySelector('.pTopBtns');
  let btn = document.getElementById('btnCostsHub');
  if(desktopWrap && !btn){
    btn = document.createElement('button');
    btn.id = 'btnCostsHub';
    btn.type = 'button';
    btn.className = 'btn secondary';
    btn.textContent = 'Panel';
    btn.addEventListener('click', goHub_);
    desktopWrap.insertBefore(btn, el('btnExit') || null);
  }
  const chip = document.getElementById('costsHubChip');
  if(chip) chip.remove();
  return { btn };
}

function syncCostsMobileReturnAction_(){
  const btn = el('mNavExit');
  if(!btn) return;
  const fromHub = hasHubAccess_();
  btn.setAttribute('aria-label', fromHub ? 'Volver al panel' : 'Salir');
  btn.textContent = fromHub ? '⌂' : '⎋';
}

function syncCostsResponsiveSections_(){
  const isDesktop = (()=>{ try{ return window.innerWidth >= 861; }catch(_e){ return true; } })();
  document.querySelectorAll('.unitDesktopOnly').forEach(node=>{
    node.hidden = !isDesktop;
    node.setAttribute('aria-hidden', isDesktop ? 'false' : 'true');
    node.style.display = isDesktop ? '' : 'none';
  });
  document.querySelectorAll('.unitMobileOnly').forEach(node=>{
    node.hidden = isDesktop;
    node.setAttribute('aria-hidden', isDesktop ? 'true' : 'false');
    if(isDesktop){
      node.style.display = 'none';
    }else{
      node.style.display = node.classList.contains('unitMobileList') ? 'grid' : '';
    }
  });
}

function setCostsShellMode_(mode){
  const isApp = mode === 'app';
  document.body.classList.remove('is-login','is-app');
  document.body.classList.add(isApp ? 'is-app' : 'is-login');
  const loginTopbar = el('costsLoginTopbar');
  if(loginTopbar) loginTopbar.style.display = isApp ? 'none' : '';
}


function syncMobileNavForViewport_(){
  const nav = el("mobileNav");
  const app = el("appRoot");
  const unlock = el("unlockBack");
  syncCostsResponsiveSections_();
  if(!nav) return;

  const appVisible = !!app && !app.classList.contains("hidden") && app.hidden !== true && (app.style.display !== "none");
  const unlockVisible = !!unlock && !unlock.classList.contains("hidden") && unlock.hidden !== true && (unlock.style.display !== "none");
  const isMobile = (()=>{ try{ return window.innerWidth <= 560; }catch(_e){ return false; } })();

  const hubUi = ensureCostsHubReturnUI();
  if(hubUi?.btn) hubUi.btn.style.display = (appVisible && !isMobile) ? "inline-flex" : "none";
  const btnExit = el("btnExit");
  if(btnExit) btnExit.style.display = (appVisible && !isMobile && !hasHubAccess_()) ? "inline-flex" : "none";
  syncCostsMobileReturnAction_();

  if(isMobile && appVisible && !unlockVisible){
    show(nav);
    try{ updateMobileNavLabel_(); }catch(_e){}
    return;
  }

  hide(nav);
}

function bindFastTap_(id, handler){
  const node = el(id);
  if(!node || node.dataset.fastTapBound === "1") return;
  node.dataset.fastTapBound = "1";

  let handledAt = 0;
  const fire = (ev)=>{
    const now = Date.now();
    if(now - handledAt < 320) return;
    handledAt = now;
    try{ ev.preventDefault(); }catch(_e){}
    try{ ev.stopPropagation(); }catch(_e){}
    handler(ev);
  };

  node.addEventListener("pointerup", (ev)=>{
    if(ev.button != null && ev.button !== 0) return;
    fire(ev);
  }, { passive:false });

  node.addEventListener("click", (ev)=>{
    const now = Date.now();
    if(now - handledAt < 320){
      try{ ev.preventDefault(); }catch(_e){}
      return;
    }
    fire(ev);
  }, { passive:false });
}


let globalMsgTimer_ = null;

function setGlobalMsg(msg, isErr=false){
  const g = el("globalMsg");
  if(!g) return;
  try{ if(globalMsgTimer_) clearTimeout(globalMsgTimer_); }catch(_e){}
  globalMsgTimer_ = null;
  const t = String(msg||"").trim();
  if(!t){
    g.textContent = "";
    g.classList.remove("show","err");
    return;
  }
  g.textContent = t;
  g.classList.toggle("err", !!isErr);
  try{
    g.style.zIndex = "100120";
    g.style.position = "fixed";
  }catch(_e){}
  g.classList.add("show");
  const ttl = isErr ? 3600 : 2400;
  globalMsgTimer_ = setTimeout(()=>{
    try{
      g.classList.remove("show","err");
      setTimeout(()=>{ try{ if(!g.classList.contains("show")) g.textContent = ""; }catch(_e){} }, 220);
    }catch(_e){}
  }, ttl);
}

function moneyCOP(n){
  const v = Math.max(0, Math.round(Number(n||0)));
  return "$" + v.toLocaleString("es-CO");
}

function uniqSorted(arr){
  const uniq = Array.from(new Set((arr||[]).map(v=>String(v||"").trim()).filter(Boolean)));
  uniq.sort((a,b)=>a.localeCompare(b,"es"));
  return uniq;
}
function renderSelect(id, arr, selected){
  const sel = el(id);
  if(!sel) return;
  const list = Array.isArray(arr) ? arr.map(v=>String(v||"").trim()).filter(Boolean) : [];
  const selVal = String(selected||"").trim();
  const hasSel = selVal && list.some(v => v.toLowerCase() === selVal.toLowerCase());
  const opts = [];
  // empty option first
  opts.push(`<option value="">—</option>`);
  // preserve existing value if it's not in catalog (so user can see what was saved)
  if(selVal && !hasSel){
    opts.push(`<option value="${escapeHtml(selVal)}">⚠️ ${escapeHtml(selVal)} (no está en catálogo)</option>`);
  }
  for(const v of list){
    const vv = String(v);
    const isSel = selVal && vv.toLowerCase() === selVal.toLowerCase();
    opts.push(`<option value="${escapeHtml(vv)}" ${isSel ? "selected" : ""}>${escapeHtml(vv)}</option>`);
  }
  sel.innerHTML = opts.join("");
}
function applyCatalogs(out){
  const cat = out?.catalog || {};
  const stores = (cat.stores || []).map(x=>x?.value ?? x).filter(Boolean);
  const brands = (cat.brands || []).map(x=>x?.value ?? x).filter(Boolean);
  state.stores = uniqSorted(stores);
  state.brands = uniqSorted(brands);
  // selects are rendered when opening modal
  // selects are rendered when opening modal
}

function fmtNum(n){
  if(n === null || n === undefined || Number.isNaN(n)) return "—";
  const v = Number(n);
  if(!isFinite(v)) return "—";
  return new Intl.NumberFormat("es-CO", { maximumFractionDigits: 3 }).format(v);
}


function parseNumFlex_(v){
  if(v == null) return 0;
  if(typeof v === "number") return isFinite(v) ? v : 0;
  const s = String(v).trim();
  if(!s) return 0;
  // soporta coma decimal
  const n = parseFloat(s.replace(",", "."));
  return isFinite(n) ? n : 0;
}

function normKey_(s){
  let x = String(s||"").trim().toLowerCase();
  if(!x) return "";
  // quita acentos
  try{ x = x.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }catch(_e){}
  // normaliza espacios
  x = x.replace(/\s+/g, " ").trim();
  return x;
}


function escapeHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));
}

function escapeHtmlAttr(s){
  return escapeHtml(s).replace(/"/g,"&quot;");
}



function syncSecretToggleState_(){
  const inp = el("secretInput");
  const btn = el("btnToggleSecret");
  if(!inp || !btn) return;
  const hidden = inp.type !== "text";
  btn.textContent = hidden ? "◉" : "◎";
  btn.setAttribute("aria-label", hidden ? "Mostrar contraseña" : "Ocultar contraseña");
}

function ensureSelectValueOption_(sel, value, label){
  if(!sel) return;
  const id = String(value || "").trim();
  if(!id) return;
  const wanted = id.toLowerCase();
  const existing = Array.from(sel.options || []).find(opt => String(opt.value || "").trim().toLowerCase() === wanted);
  if(!existing){
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = String(label || id).trim() || id;
    sel.appendChild(opt);
  }
  try{ sel.value = id; }catch(_e){}
}

function loadPortalCostsSession_(){
  try{
    const raw = sessionStorage.getItem(SS_COSTS_SESSION_KEY);
    const data = raw ? JSON.parse(raw) : null;
    if(data?.id && data?.password) return data;
  }catch(_e){}
  return null;
}
function clearPortalCostsSession_(){
  try{ sessionStorage.removeItem(SS_COSTS_SESSION_KEY); }catch(_e){}
}

async function fetchProfilesPublic_(category){
  const out = await api({ action:"profiles_public_list", category });
  return Array.isArray(out.profiles) ? out.profiles : [];
}

async function populateLoginProfiles_(force = false){
  const cached = !force ? loadCostsLoginCache_() : null;
  if(cached && cached.length){
    LOGIN_PROFILES = cached;
    const sel = el("loginProfile");
    if(sel){
      const saved = String(localStorage.getItem(LS_PROFILE_KEY) || "").trim();
      const opts = ['<option value="">Seleccionar…</option>'];
      for(const p of LOGIN_PROFILES){
        const id = String(p.id || p.profile_id || "").trim();
        const label = String(p.label || id).trim();
        const selected = saved && saved === id ? ' selected' : '';
        opts.push(`<option value="${escapeHtmlAttr(id)}"${selected}>${escapeHtml(label)}</option>`);
      }
      sel.innerHTML = opts.join("");
    }
    return;
  }
  showLoading("Cargando perfiles…", "Buscando perfiles de compras y recetas.");
  try{
    let rows = [];
    try{ rows = await fetchProfilesPublic_("costs"); }catch(_e){}
    if(!rows.length){
      try{ rows = await fetchProfilesPublic_("admin"); }catch(_e){}
    }
    LOGIN_PROFILES = Array.isArray(rows) ? rows : [];
    saveCostsLoginCache_(LOGIN_PROFILES);
    const sel = el("loginProfile");
    if(!sel) return;
    const saved = String(localStorage.getItem(LS_PROFILE_KEY) || "").trim();
    const opts = ['<option value="">Seleccionar…</option>'];
    for(const p of LOGIN_PROFILES){
      const id = String(p.id || p.profile_id || "").trim();
      const label = String(p.label || id).trim();
      const selected = saved && saved === id ? ' selected' : '';
      opts.push(`<option value="${escapeHtmlAttr(id)}"${selected}>${escapeHtml(label)}</option>`);
    }
    if(!LOGIN_PROFILES.length) opts.push('<option value="">Sin perfiles habilitados</option>');
    sel.innerHTML = opts.join("");
  } finally {
    hideLoading();
  }
}


// =============== Loading ===============
function showLoading(title, sub){
  if(el("loadingTitle")) el("loadingTitle").textContent = title || "Cargando…";
  if(el("loadingSub")) el("loadingSub").textContent = sub || "Un momento.";

  const lb = el("loadingBack");
  if(lb){
    // ✅ Siempre al frente de TODO (incluye modales de confirmación)
    lb.style.zIndex = "99999";
    lb.style.position = "fixed";
    lb.style.inset = "0";
  }
  show(lb);
}
function hideLoading(){
  const lb = el("loadingBack");
  if(lb){
    // Limpieza opcional
    // lb.style.zIndex = "";
  }
  hide(lb);
}

function inlineLoadHtml(title, sub, soft=false){
  return `<div class="amInlineLoad${soft ? ' isSoft' : ''}"><div class="amInlineLoadSpin"></div><div class="amInlineLoadBody"><div class="amInlineLoadTitle">${escapeHtml(title || "Cargando…")}</div><div class="amInlineLoadSub">${escapeHtml(sub || "Un momento.")}</div></div></div>`;
}

function ensureCostsSyncBadge_(){
  let badge = el("costsSyncBadge");
  if(badge) return badge;
  badge = document.createElement("div");
  badge.id = "costsSyncBadge";
  badge.className = "costsSyncBadge";
  badge.setAttribute("aria-live", "polite");
  badge.setAttribute("aria-atomic", "true");
  badge.innerHTML = `<div class="costsSyncBadgeSpin"></div><div class="costsSyncBadgeBody"><div class="costsSyncBadgeTitle" id="costsSyncBadgeTitle">Cargando información…</div><div class="costsSyncBadgeSub" id="costsSyncBadgeSub">Puedes seguir usando la página mientras actualizamos los datos.</div></div>`;
  document.body.appendChild(badge);
  return badge;
}
function showCostsSyncBadge_(title, sub){
  const badge = ensureCostsSyncBadge_();
  try{
    badge.style.zIndex = "100100";
    badge.style.position = "fixed";
  }catch(_e){}
  const titleEl = badge.querySelector("#costsSyncBadgeTitle");
  const subEl = badge.querySelector("#costsSyncBadgeSub");
  if(titleEl) titleEl.textContent = title || "Cargando información…";
  if(subEl) subEl.textContent = sub || "Puedes seguir usando la página mientras actualizamos los datos.";
  badge.classList.add("isVisible");
}
function hideCostsSyncBadge_(){
  const badge = el("costsSyncBadge");
  if(!badge) return;
  badge.classList.remove("isVisible");
}

// =============== Tabs ===============
function setView(view){
  const prev = state.view || "purchases";
  const v = (view === "recipes") ? "recipes" : "purchases";

  // ✅ Recordar vista previa (para volver al cancelar el PIN de Recetas)
  if(v === "recipes" && prev !== "recipes"){
    state.prevViewBeforeRecipes = prev;
  }

  state.view = v;

  try{ updateMobileNavLabel_(); }catch(_e){}

  const vp = el("viewPurchases");
  const vc = el("viewCosts");
  const vr = el("viewRecipes");
  const bb = el("bottomBar");

  const tp = el("btnTabPurchases");
  const tr = el("btnTabRecipes");

  if(tp){ tp.classList.remove("isActive"); tp.setAttribute("aria-selected","false"); }
  if(tr){ tr.classList.remove("isActive"); tr.setAttribute("aria-selected","false"); }

  show(vp); hide(vc); hide(vr);
  if(bb) bb.style.display = "";

  if(v === "recipes"){
    hide(vp); hide(vc); show(vr);
    if(bb) bb.style.display = "none";
    if(tr){ tr.classList.add("isActive"); tr.setAttribute("aria-selected","true"); }
    ensureRecipesUnlocked_();
    scheduleRecipesWarmup_(true);
    return;
  }

  show(vp); hide(vc); hide(vr);
  if(tp){ tp.classList.add("isActive"); tp.setAttribute("aria-selected","true"); }
  renderGroups();
  renderCostGroupsIfOpen_();
  renderUnitCosts();
  refreshBottom();
}

function setCostsMeta(msg){
  const c = el("costsMeta");
  if(c) c.textContent = msg || "";
}

// =============== API ===============
async function api(body, {timeoutMs=30000} = {}){
  try{ ensureApiWarmup_(); }catch(_e){}
  const payload = Object.assign({}, body || {});
  if(payload && payload.costs_secret) delete payload.costs_secret;
  if(
    UNLOCKED_PROFILE?.id &&
    UNLOCKED_SECRET &&
    payload.action !== "profiles_auth" &&
    payload.action !== "profiles_public_list" &&
    payload.action !== "validate_admin_pin" &&
    payload.action !== "validate_profiles_secret" &&
    !payload.auth_profile_id
  ){
    payload.auth_profile_id = String(UNLOCKED_PROFILE.id || "").trim();
    payload.auth_profile_password = String(UNLOCKED_SECRET || "").trim();
    payload.auth_page = "costs";
  }
  const controller = new AbortController();
  const t = setTimeout(()=>controller.abort(), timeoutMs);
  let res;
  try{
    res = await fetch(API_URL, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally { clearTimeout(t); }

  const raw = await res.text().catch(()=>"");
  let out;
  try{ out = raw ? JSON.parse(raw) : {ok:false, error:`HTTP ${res.status}`}; }
  catch{ out = {ok:false, error: raw || `HTTP ${res.status}`}; }

  if(!res.ok) throw new Error(out?.error || out?.message || `HTTP ${res.status}`);
  if(!out || out.ok !== true) throw new Error(out?.error || "Error");
  return out;
}

async function validateSecret(secret, profileId){
  const out = await api({ action:"profiles_auth", profile_id: profileId, password_plain: secret }, {timeoutMs: 30000});
  const cats = Array.isArray(out?.profile?.categories)
    ? out.profile.categories.map(v => String(v || "").trim().toLowerCase())
    : [];
  const allowed = cats.includes("admin") || cats.includes("costs") || cats.includes("purchases");
  if(out.valid !== true || !allowed) throw new Error(out?.error || "Contraseña incorrecta o no autorizada.");
  return out.profile || { id: profileId, label: profileId, categories: cats };
}

// =============== RECETAS (desde hoja RECETAS) ===============
function normText_(s){
  return String(s||"")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/\s+/g," ")
    .trim();
}
const DESSERT_NAME_TO_ID_ = {
  "mousse de maracuya": "mousse_maracuya",
  "mousse de maracuya ": "mousse_maracuya",
  "mousse de maracuyá": "mousse_maracuya",
  "cheesecake de cafe con panela": "cheesecake_cafe_panela",
  "cheesecake de café con panela": "cheesecake_cafe_panela",
  "arroz con leche": "arroz_con_leche"
};

function normRecipeUnit_(u){
  const t = String(u||"").trim().toLowerCase();
  if(!t) return "";
  if(t === "u" || t === "und" || t === "unidad" || t === "unidades") return "unidad";
  if(t === "g" || t === "gr" || t === "gramo" || t === "gramos") return "g";
  if(t === "ml" || t === "mililitro" || t === "mililitros") return "ml";
  if(t === "m" || t === "mt" || t === "mts" || t === "metro" || t === "metros") return "m";
  return t;
}

function buildRecipesIndex_(items){
  const out = {};
  const rows = Array.isArray(items) ? items : [];
  for(const r of rows){
    const didRaw = String(r?.dessert_id || r?.dessertId || "").trim();
    const dname = String(r?.dessert_name || r?.dessertName || "").trim();
    const did = didRaw || (DESSERT_NAME_TO_ID_[normText_(dname)] || "");
    if(!did) continue;

    const ing = String(r?.ingredient_key || r?.ingredientKey || r?.key || "").trim();
    if(!ing) continue;

    const qty = parseNumFlex_(r?.qty_per_unit ?? r?.qtyPerUnit ?? r?.qty ?? 0);
    if(!(qty > 0)) continue;

    const unit = normRecipeUnit_(r?.unit);
    if(!unit) continue;

    if(!out[did]) out[did] = [];
    out[did].push({ ingredient_key: ing, qty_per_unit: qty, unit });
  }

  // ordenar por nombre ingrediente para consistencia visual
  for(const k of Object.keys(out)){
    out[k].sort((a,b)=> String(a.ingredient_key||"").localeCompare(String(b.ingredient_key||""),"es"));
  }
  return out;
}

async function loadRecipesFromSheet_(opts={}){
  const preserveCurrent = opts.preserveCurrent !== false;
  const prevRecipes = state.recipesByDessert;
  const prevSource = state.recipesSource;
  if(!preserveCurrent){
    state.recipesByDessert = null;
    state.recipesSource = "embedded";
  }
  try{
    const out = await api({ action:"recipes_list", costs_secret: UNLOCKED_SECRET }, {timeoutMs: 45000});
    const idx = buildRecipesIndex_(out.items || []);
    if(Object.keys(idx).length){
      state.recipesByDessert = idx;
      state.recipesSource = "sheet";
      state.recipesLoadedAt = Date.now();
      return true;
    }
    if(!preserveCurrent || !prevRecipes){
      state.recipesByDessert = null;
      state.recipesSource = "embedded";
      state.recipesLoadedAt = 0;
    }
    return false;
  }catch(_e){
    if(!preserveCurrent || !prevRecipes){
      state.recipesByDessert = null;
      state.recipesSource = "embedded";
      state.recipesLoadedAt = 0;
    }else{
      state.recipesByDessert = prevRecipes;
      state.recipesSource = prevSource;
    }
    return false;
  }
}
function renderCostGroupsIfOpen_(){
  const admin = el("adminListDetails");
  if(admin && !admin.open) return;
  renderCostsGroups();
}
function afterRecipesRefresh_(){
  try{
    if(state.view === "recipes" && state.recipesPinUnlocked) renderRecipesView_();
    else renderUnitCosts();
  }catch(_e){}
  try{ saveCostsDataCache_(); }catch(_e){}
}
function scheduleRecipesWarmup_(force=false){
  if(!UNLOCKED_SECRET) return;
  if(!force && state.recipesSource === "sheet" && state.recipesByDessert && Object.keys(state.recipesByDessert||{}).length) return;
  try{ if(RECIPES_WARM_TIMER) window.clearTimeout(RECIPES_WARM_TIMER); }catch(_e){}
  const runner = ()=>{ ensureRecipesLoaded_({ force, background:true }).catch(()=>{}); };
  try{
    if(typeof window.requestIdleCallback === "function"){
      RECIPES_WARM_TIMER = window.requestIdleCallback(runner, { timeout: 1800 });
      return;
    }
  }catch(_e){}
  RECIPES_WARM_TIMER = window.setTimeout(runner, 240);
}
async function ensureRecipesLoaded_(opts={}){
  const force = !!opts.force;
  const background = !!opts.background;
  if(!UNLOCKED_SECRET) return false;
  if(!force && state.recipesSource === "sheet" && state.recipesByDessert && Object.keys(state.recipesByDessert||{}).length) return true;
  if(RECIPES_FETCH_PROMISE) return RECIPES_FETCH_PROMISE;
  RECIPES_FETCH_PROMISE = (async ()=>{
    const loaded = await loadRecipesFromSheet_({ preserveCurrent: background || !!state.recipesByDessert });
    if(loaded) afterRecipesRefresh_();
    return loaded;
  })().finally(()=>{ RECIPES_FETCH_PROMISE = null; });
  return RECIPES_FETCH_PROMISE;
}


// =============== Costos helpers ===============
function indexCosts(items){
  const map = {};
  for(const it of (items||[])){
    const k = String(it?.ingredient_key ?? it?.key ?? it?.name ?? "").trim();
    if(!k) continue;
    map[k] = it;
  }
  state.costsByKey = map;
}

function getInvEntryRaw(key){
  const v = state.inventory?.[key];
  if(v && typeof v === "object") return { qty: Number(v.qty || 0), unit: String(v.unit || "").trim() };
  if(typeof v === "number") return { qty: Number(v || 0), unit: "" };
  const n = Number(v || 0);
  return { qty: isFinite(n) ? n : 0, unit: "" };
}

function baseFromSpec(spec){
  const unit_type = String(spec?.unit_type || "").trim().toLowerCase();
  const pack_qty = Number(spec?.pack_qty || 0);
  const pack_price = Number(spec?.pack_price || 0);
  const cpuStored = Number(spec?.cop_per_unit || 0);
  const unit_item_qty = Number(spec?.unit_item_qty || 0);
  const unit_item_type = String(spec?.unit_item_qty_type || "").trim().toLowerCase();
  const brand = String(spec?.brand || "").trim();
  const store = String(spec?.store || "").trim();

  const cpuOr = ((pack_qty>0 && pack_price>0) ? (pack_price/pack_qty) : ((cpuStored>0 && isFinite(cpuStored)) ? cpuStored : null));

  if(unit_type === "g" || unit_type === "ml" || unit_type === "m"){
    return { base_unit: unit_type, cpu: cpuOr, pack_qty, pack_price, brand, store, unit_item_qty, unit_item_type, unit_type };
  }

  if(unit_type === "unidad"){
    if(unit_item_qty>0 && (unit_item_type === "g" || unit_item_type === "ml" || unit_item_type === "m")){
      const basePackQty = pack_qty * unit_item_qty;
      const cpu = (basePackQty>0 && pack_price>0) ? (pack_price/basePackQty) : null;
      return { base_unit: unit_item_type, cpu, pack_qty: basePackQty, pack_price, brand, store, unit_item_qty, unit_item_type, unit_type };
    }
    return { base_unit: "unidad", cpu: cpuOr, pack_qty, pack_price, brand, store, unit_item_qty, unit_item_type, unit_type };
  }

  return { base_unit: "", cpu: null, pack_qty: 0, pack_price: 0, brand:"", store:"", unit_item_qty:0, unit_item_type:"", unit_type:"" };
}

function normalizeInvToBase(key){
  const raw = getInvEntryRaw(key);
  const spec = state.costsByKey?.[key] || null;
  const base = baseFromSpec(spec);

  let unit = raw.unit || "";
  let qty = Number(raw.qty || 0);

  if(!unit){
    return { qty, unit: base.base_unit || "g", raw };
  }

  if(base.base_unit && unit === base.base_unit){
    return { qty, unit, raw };
  }

  if(unit === "unidad" && (base.base_unit === "g" || base.base_unit === "ml" || base.base_unit === "m") && base.unit_item_qty>0 && base.unit_item_type === base.base_unit){
    return { qty: qty * base.unit_item_qty, unit: base.base_unit, raw };
  }

  return { qty, unit, raw };
}

function getUnitFor(key){
  const spec = state.costsByKey?.[key] || null;
  const base = baseFromSpec(spec);
  if(base.base_unit) return base.base_unit;
  const inv = normalizeInvToBase(key);
  if(inv.unit) return inv.unit;
  return "g";
}

function getCostPerUnit(key){
  const spec = state.costsByKey?.[key] || null;
  const base = baseFromSpec(spec);
  if(base.cpu !== null && isFinite(base.cpu)) return base.cpu;
  return null;
}

// =============== Keys & groups ===============
function collectAllKeys(){
  const seen = new Set();
  const out = [];
  for(const k of Object.keys(state.needs || {})){
    if(!k) continue;
    if(!seen.has(k)){ seen.add(k); out.push(k); }
  }
  for(const k of Object.keys(state.inventory || {})){
    if(!k) continue;
    if(!seen.has(k)){ seen.add(k); out.push(k); }
  }
  return out;
}

function groupKeys(keys){
  const groups = Array.isArray(window.AMARED_COSTS_SECTIONS) ? window.AMARED_COSTS_SECTIONS : null;
  const used = new Set();
  const out = [];

  // 🔶 Asignación manual por sección (desde COSTOS_INGREDIENTES.section_title)
  const titleToGroup = {};

  // Primero: ubicar ingredientes con sección fija
  for(const k of (keys||[])){
    const kk = String(k||"").trim();
    if(!kk) continue;
    const spec = state.costsByKey?.[kk];
    const sec = String(spec?.section_title || spec?.section || "").trim();
    if(!sec) continue;

    // crear grupo si no existe
    let grp = out.find(x=>String(x.title||"")===sec);
    if(!grp){
      grp = { title: sec, keys: [] };
      out.push(grp);
    }
    // evitar duplicados
    if(!used.has(kk)){
      grp.keys.push(kk);
      used.add(kk);
    }
  }

  if(groups){
    for(const g of groups){
      const t = String(g?.title||"").trim();
      if(t) titleToGroup[t] = g;
    }
  }

  // índice por canonicalKey para tolerar tildes, comas, etc.
  const keyByCanon = {};
  for(const k of (keys||[])){
    const kk = String(k||"").trim();
    if(!kk) continue;
    const c = canonicalKey(kk);
    if(c && !keyByCanon[c]) keyByCanon[c] = kk;
  }


  // Primero: ubicar ingredientes con sección fija
  for(const k of (keys||[])){
    const kk = String(k||"").trim();
    if(!kk) continue;
    const spec = state.costsByKey?.[kk];
    const sec = String(spec?.section_title || spec?.section || "").trim();
    if(!sec) continue;

    // crear grupo si no existe
    let grp = out.find(x=>String(x.title||"")===sec);
    if(!grp){
      grp = { title: sec, keys: [] };
      out.push(grp);
    }
    // evitar duplicados
    if(!used.has(kk)){
      grp.keys.push(kk);
      used.add(kk);
    }
  }

  if(groups){
    for(const g of groups){
      const title = String(g?.title || "").trim();
      const gkeys = [];
      for(const raw of (g?.keys || [])){
        const wantedRaw = String(raw||"").trim();
        if(!wantedRaw) continue;
        const hit = keyByCanon[canonicalKey(wantedRaw)] || null;
        if(hit && !used.has(hit)){
          gkeys.push(hit);
          used.add(hit);
        }
      }
      if(gkeys.length) out.push({ title, keys: gkeys });
    }
  }

  // ✅ No crear sección "Otros". Si queda algo por fuera, lo anexamos a la primera sección.
  const other = (keys||[]).filter(k => k && !used.has(k));
  other.sort((a,b)=>String(a).localeCompare(String(b),"es"));
  if(other.length){
    if(out.length){
      out[0].keys = out[0].keys.concat(other);
    }else{
      out.push({ title: "Ingredientes", keys: other });
    }
  }

  return out;
}

function groupAccent_(idx){
  const palette = ["var(--caramel)","var(--pink)","var(--beige)","rgba(64,17,2,.35)","rgba(242,91,143,.45)","rgba(246,186,96,.45)"];
  const i = Math.abs(Number(idx||0)) % palette.length;
  return palette[i];
}


// =============== Plan de compra ===============
function getPlan(key){
  if(!state.buyPlan) state.buyPlan = {};
  const cur = state.buyPlan[key];
  if(cur && typeof cur === "object") return cur;
  const p = { selected:false, packs:0, qty_manual:0, autoInfo:null };
  state.buyPlan[key] = p;
  return p;
}

function computePlannedQty(key){
  const plan = getPlan(key);
  if(!plan.selected) return 0;

  const spec = state.costsByKey?.[key] || null;
  const base = baseFromSpec(spec);

  const packs = Number(plan.packs || 0);
  if(base.pack_qty > 0 && packs > 0) return packs * base.pack_qty;

  const q = Number(plan.qty_manual || 0);
  if(q > 0) return q;

  return 0;
}

function computeRow(key){
  const need = Number(state.needs?.[key] || 0) || 0;
  const invN = normalizeInvToBase(key);
  const invBase = Number(invN.qty || 0);
  const planned = computePlannedQty(key);

  // ✅ Falta base (sin considerar plan): así no desaparece al usar Auto
  const missing0 = Math.max(0, need - invBase);

  // Info útil (sí considera plan)
  const invShown = invBase + planned;
  const missingAfterPlan = Math.max(0, need - invShown);

  const unit = getUnitFor(key);
  const cpu = getCostPerUnit(key);
  const spec = state.costsByKey?.[key] || null;
  const base = baseFromSpec(spec);
  return { key, need, invBase, planned, invShown, missing0, missingAfterPlan, unit, cpu, base };
}


function prettyDessertName(id){
  const did = String(id||"").trim();
  if(!did) return "";
  // Prefer nombre desde hoja POSTRES (si existe)
  try{
    const arr = (state.dessertsRaw || state.desserts || []);
    const hit = arr.find(d=>String(d.dessert_id || d.id || "").trim() === did);
    const name = String(hit?.dessert_name || hit?.dessertName || hit?.name || "").trim();
    if(name) return name;
  }catch(_e){}
  // Fallback: mapa conocido + formateo
  const map = {
    mousse_maracuya: "Mousse de maracuyá",
    cheesecake_cafe_panela: "Cheesecake de café con panela",
    arroz_con_leche: "Arroz con leche",
  };
  return map[did] || did.replaceAll("_"," ");
}

const HARD_DISABLED_DESSERT_IDS_ = new Set(["arroz_con_leche"]);

function isDessertHardDisabled_(id){
  const key = String(id||"").trim().toLowerCase();
  return !!key && HARD_DISABLED_DESSERT_IDS_.has(key);
}

function isDessertInactive_(id){
  const key = String(id||"").trim().toLowerCase();
  if(!key) return false;
  const s = state.inactiveDessertsSet;
  if(s && typeof s.has === "function") return s.has(key);
  // fallback: revisar dessertsRaw
  try{
    const arr = (state.dessertsRaw || []);
    const hit = arr.find(d=>String(d.dessert_id||d.id||"").trim().toLowerCase()===key);
    if(hit){
      const a = String(hit.active ?? "1").trim().toLowerCase();
      return (a === "0" || a === "false");
    }
  }catch(_e){}
  return false;
}


// =============== Render: summaries ===============

function canonicalKey(s){
  return String(s||"")
    .trim()
    .replace(/,+$/g,"")
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g," ")
    .replace(/\s+/g," ")
    .trim();
}


function ensurePackagingSection(){
  state.sections = state.sections || [];
  if(!state.sections.length) return;
  const sec0 = state.sections[0];
  sec0.keys = Array.isArray(sec0.keys) ? sec0.keys : [];
  for(const k of ["Envase plástico", "Cuchara plástica"]){
    if(!sec0.keys.includes(k)) sec0.keys.push(k);
  }
}

function ensurePackagingEntries(){
  state.costsByKey = state.costsByKey || {};
  state.needs = state.needs || {};

  for(const k of ["Envase plástico", "Cuchara plástica"]){
    if(!(k in state.needs)) state.needs[k] = 0;
    if(!state.costsByKey[k]){
      state.costsByKey[k] = {
        ingredient_key: k,
        unit_type: "u",
        pack_qty: 0,
        pack_price: 0,
        cop_per_unit: null,
        brand: "",
        store: "",
        updated_at: "",
        updated_by: ""
      };
    }
  }

  const by = state.ordersByDessert || {};
  let total = 0;
  for(const v of Object.values(by)) total += Number(v||0)||0;
  if(total>0){
    for(const k of ["Envase plástico", "Cuchara plástica"]){
      state.needs[k] = Math.max(Number(state.needs[k]||0)||0, total);
    }
  }
}

function buildCostAliasMap(){
  const map = {};
  for(const k of Object.keys(state.costsByKey||{})) map[canonicalKey(k)] = k;
  state._costAlias = map;
}

function cpuFor(key){
  const k0 = String(key||"").trim();
  const alias = state._costAlias?.[canonicalKey(k0)];
  const k = alias || k0;
  return getCostPerUnit(k);
}

function resolveCostForRecipe_(ingredientKey, recipeUnit){
  const ik0 = String(ingredientKey||"").trim();
  const alias = state._costAlias?.[canonicalKey(ik0)];
  const ik = alias || ik0;

  const spec = state.costsByKey?.[ik] || null;
  const base = baseFromSpec(spec);

  const want = normRecipeUnit_(recipeUnit);
  const have = normRecipeUnit_(base.base_unit);

  if(base.cpu === null || base.cpu === undefined || !(Number(base.cpu) > 0)) {
    return { ok:false, reason:"missing_cost", ingredient_key: ik0 };
  }

  let note = "";
  // Si la receta especifica unidad, validar compatibilidad
  if(want && have && want !== have){
    const bothMassVol = ((want==="g"||want==="ml") && (have==="g"||have==="ml"));
    if(bothMassVol){
      // ✅ Para visualización de costos, permitimos g↔ml asumiendo 1:1 (aprox)
      note = "approx_g_ml";
    }else{
      return { ok:false, reason:`unit_mismatch:${want}:${have}`, ingredient_key: ik0 };
    }
  }

  return { ok:true, ingredient_key: ik, cpu: Number(base.cpu), base_unit: have || base.base_unit || "", note };
}


function moneyCOP2(n){
  const v = Number(n||0);
  const frac = Math.abs(v - Math.round(v)) > 1e-9;
  return "$" + v.toLocaleString("es-CO", { maximumFractionDigits: frac ? 2 : 0 });
}

function dessertUnitBreakdown_(dessertId, lotQty){
  const bySheet = state.recipesByDessert?.[dessertId] || null;

  let lines = [];
  let missing = [];
  let sum = 0;
  let source = "embedded";

  if(bySheet && bySheet.length){
    source = "sheet";
    for(const r of bySheet){
      const ik = String(r.ingredient_key||"").trim();
      const qty = Number(r.qty_per_unit||0) || 0;
      const unit = normRecipeUnit_(r.unit);
      if(!ik || !(qty>0) || !unit) continue;

      const rc = resolveCostForRecipe_(ik, unit);
      if(!rc.ok){
        missing.push(ik);
        continue;
      }
      const sub = qty * rc.cpu;
      sum += sub;
      lines.push({ ingredient_key: rc.ingredient_key, qty, unit, cpu: rc.cpu, cpu_unit: rc.base_unit || unit, note: rc.note || "", subtotal: sub });
    }
  } else {
    // fallback: recetas embebidas (compat)
    const rec = AMARED_RECIPES_PER_UNIT[dessertId] || [];
    for(const pair of rec){
      const ik = String(pair?.[0]||"").trim();
      const qty = Number(pair?.[1]||0) || 0;
      if(!ik || !(qty>0)) continue;
      const cpu = cpuFor(ik);
      if(cpu===null || cpu===undefined){ missing.push(ik); continue; }
      const sub = qty * Number(cpu||0);
      sum += sub;
      lines.push({ ingredient_key: ik, qty, unit: "", cpu: Number(cpu||0), cpu_unit: "", subtotal: sub });
    }
  }

  // ordenar por subtotal desc para lectura rápida
  lines.sort((a,b)=> (b.subtotal||0) - (a.subtotal||0));

  const lot = (lotQty && sum) ? (sum * lotQty) : null;
  return { dessertId, source, lines, missing, sum, lotQty: Number(lotQty||0)||0, lot };
}

function unitBreakdownHtml_(b){
  const lotQty = b.lotQty || 0;
  const missing = Array.isArray(b.missing) ? b.missing : [];
  const hasMiss = missing.length > 0;

  const header = `<div class="hint" style="margin-bottom:8px;">Ingredientes por <b>1 unidad</b>${b.source==="sheet" ? " (RECETAS)" : ""}</div>`;

  const list = b.lines.length ? b.lines.map(x=>`
    <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start;">
      <div style="min-width:0;">
        <div style="font-weight:950;">${escapeHtml(x.ingredient_key)}</div>
        <div style="opacity:.75; font-weight:850; font-size:12.5px; margin-top:2px;">
          ${fmtNum(x.qty)} ${escapeHtml(x.unit || "")}${x.note ? ` <span style="opacity:.7;">(≈)</span>` : ""}
          ${x.cpu ? (` · ${moneyCOP2(x.cpu)}/${escapeHtml(x.cpu_unit || x.unit || "")}`) : ""}
        </div>
      </div>
      <div style="font-weight:950; white-space:nowrap;">${moneyCOP2(x.subtotal)}</div>
    </div>
  `).join(`<div style="height:8px;"></div>`) : `<div class="hint">No hay ingredientes en la receta.</div>`;

  const total = `<div style="border-top:1px solid rgba(64,17,2,.10); padding-top:10px; margin-top:10px; display:flex; justify-content:space-between;">
      <div style="font-weight:950;">Total unitario</div>
      <div style="font-weight:950; white-space:nowrap;">${moneyCOP2(b.sum)}</div>
    </div>`;

  const lot = (lotQty>0) ? `<div style="opacity:.85; font-weight:850; margin-top:6px; display:flex; justify-content:space-between;">
      <div>Total lote (${fmtNum(lotQty)} u)</div>
      <div style="white-space:nowrap;">${b.lot!==null ? moneyCOP2(b.lot) : "$—"}</div>
    </div>` : "";

  const miss = hasMiss ? `<div class="hint" style="margin-top:10px; color:#b32020; font-weight:950;">
      Faltan costos o unidades compatibles para: ${escapeHtml(missing.slice(0,10).join(", "))}${missing.length>10?"…":""}
    </div>` : "";

  return `<div style="padding:10px 12px;">${header}${list}${total}${lot}${miss}</div>`;
}



function unitBreakdownMobileHtml_(row){
  const b = row.breakdown || { lines: [], missing: [], sum: 0, lotQty: 0, lot: null, source: 'embedded' };
  const sourceLabel = (b.source === 'sheet') ? 'RECETAS' : 'receta base';
  const metric = (label, value)=>`<div class="unitMetric"><div class="unitMetricLabel">${label}</div><div class="unitMetricValue">${value}</div></div>`;
  const metrics = `
    <div class="unitMetricGrid">
      ${metric('Costo unitario', row.unit!==null ? moneyCOP2(row.unit) : '$—')}
      ${metric('Precio 60%', row.unit!==null ? moneyCOP2(row.unit/0.40) : '$—')}
      ${metric('Costo lote', row.lote!==null ? moneyCOP2(row.lote) : '$—')}
    </div>`;

  const ingredients = b.lines && b.lines.length ? `
    <div class="unitIngWrap">
      <div class="unitIngTitle">Ingredientes por unidad</div>
      <div class="unitIngList">
        ${b.lines.map(x=>`
          <div class="unitIngItem">
            <div style="min-width:0;">
              <div class="unitIngName">${escapeHtml(x.ingredient_key)}</div>
              <div class="unitIngMeta">
                ${fmtNum(x.qty)} ${escapeHtml(x.unit || '')}${x.note ? ` <span style="opacity:.7;">(≈)</span>` : ''}
                ${x.cpu ? (` · ${moneyCOP2(x.cpu)}/${escapeHtml(x.cpu_unit || x.unit || '')}`) : ''}
              </div>
            </div>
            <div class="unitIngCost">${moneyCOP2(x.subtotal)}</div>
          </div>`).join('')}
      </div>
    </div>` : `<div class="hint" style="margin-top:12px;">No hay ingredientes registrados para este postre.</div>`;

  const missing = Array.isArray(b.missing) && b.missing.length
    ? `<div class="hint" style="margin-top:12px; color:#b32020; font-weight:950;">Faltan costos o unidades compatibles para: ${escapeHtml(b.missing.slice(0,10).join(', '))}${b.missing.length>10?'…':''}</div>`
    : '';

  return `
    <details class="unitMobileCard">
      <summary>
        <div class="unitMobileHead">
          <div class="unitMobileTitle">${escapeHtml(prettyDessertName(row.id))}</div>
          <div class="unitMobileSub">${escapeHtml(sourceLabel)} · toca para ver costos e ingredientes</div>
          <div class="unitMobilePreview">
            <span class="unitMobileChip">$/u: ${row.unit!==null ? moneyCOP2(row.unit) : '$—'}</span>
            <span class="unitMobileChip">Lote: ${row.lote!==null ? moneyCOP2(row.lote) : '$—'}</span>
          </div>
        </div>
        <div class="unitMobileChevron" aria-hidden="true">▾</div>
      </summary>
      <div class="unitMobileBody">
        ${metrics}
        ${ingredients}
        ${missing}
      </div>
    </details>`;
}

function dessertUnitCost(dessertId){
  const b = dessertUnitBreakdown_(dessertId, 0);
  return { sum: b.sum, missing: b.missing };
}


function getDessertIdsForUi_(){
  const set = new Set();

  // 1) POSTRES (activos) si existen
  try{
    const arr = (state.dessertsRaw || state.desserts || []);
    for(const d of arr){
      const id = String(d?.dessert_id || d?.id || '').trim();
      if(id) set.add(id);
    }
  }catch(_e){}

  // 2) RECETAS existentes
  try{ Object.keys(state.recipesByDessert||{}).forEach(id=>{ if(id) set.add(id); }); }catch(_e){}

  // 3) Pedidos (por si hay postres nuevos en pedidos)
  try{ Object.keys(state.ordersByDessert||{}).forEach(id=>{ if(id) set.add(id); }); }catch(_e){}
  try{
    const late = state.late?.orders_by_dessert || state.late?.ordersByDessert || {};
    Object.keys(late||{}).forEach(id=>{ if(id) set.add(id); });
  }catch(_e){}

  // 4) Base conocida (compat)
  ['mousse_maracuya','cheesecake_cafe_panela'].forEach(id=>set.add(id));

  const out = [];
  for(const id0 of set){
    const id = String(id0||'').trim();
    if(!id) continue;
    if(isDessertHardDisabled_(id)) continue;
    if(isDessertInactive_(id)) continue;
    if(isDessertLocallyDeleted_(id)) continue;
    out.push(id);
  }

  out.sort((a,b)=> prettyDessertName(a).localeCompare(prettyDessertName(b),'es'));
  return out;
}


function renderUnitCosts(){
  const tbody = el("unitCostRows");
  const mobileList = el("unitCostMobileList");
  const meta = el("unitCostMeta");
  if(!tbody && !mobileList) return;

  ensurePackagingEntries();
  buildCostAliasMap();

  state.ui.unitOpen = state.ui.unitOpen || {};

  const by = state.ordersByDessert || {};
  const all = getDessertIdsForUi_();

  const rows = [];
  const missCosts = new Set();
  const noRecipe = [];

  for(const id of all){
    const qty = Number(by[id]||0)||0;
    const b = dessertUnitBreakdown_(id, qty);
    const hasRecipe = (b.lines && b.lines.length) || (b.source === 'embedded' && (AMARED_RECIPES_PER_UNIT[id]||[]).length);
    if(!hasRecipe) noRecipe.push(prettyDessertName(id));

    b.missing.forEach(x=>missCosts.add(x));

    const unit = (!hasRecipe || b.missing.length) ? null : b.sum;
    const lote = (unit!==null) ? (unit*qty) : null;

    rows.push({ id, qty, unit, lote, open: !!state.ui.unitOpen[id], breakdown: b, hasRecipe });
  }

  if(tbody){
    tbody.innerHTML = rows.map(r=>`
      <tr>
        <td>${escapeHtml(prettyDessertName(r.id))}</td>
        <td class="num">${r.unit!==null ? moneyCOP2(r.unit) : "$—"}</td>
        <td class="num">${r.unit!==null ? moneyCOP2(r.unit/0.40) : "$—"}</td>
        <td class="num">${r.lote!==null ? moneyCOP2(r.lote) : "$—"}</td>
      </tr>
    `).join("");
  }

  if(mobileList){
    mobileList.innerHTML = rows.length
      ? rows.map(r => unitBreakdownMobileHtml_(r)).join('')
      : `<div class="hint">No hay postres disponibles para calcular costos en este momento.</div>`;
  }

  const src = (state.recipesSource === "sheet") ? "RECETAS" : "receta embebida";
  const parts = [];
  if(missCosts.size){
    parts.push(`(${src}) Faltan costos de: ` + Array.from(missCosts).slice(0,8).join(", ") + (missCosts.size>8?"…":""));
  } else {
    parts.push(`OK (${src}) · Precio 60% = costo / 0.40`);
  }
  if(noRecipe.length){
    parts.push(`Sin receta: ` + noRecipe.slice(0,6).join(", ") + (noRecipe.length>6?"…":""));
  }

  if(meta) meta.textContent = parts.join(" · ");
}



function renderDesserts(){
  const tbody = el("dessertRows");
  const meta = el("dessertsMeta");
  if(!tbody) return;

  const by = state.ordersByDessert || {};
  const ids = getDessertIdsForUi_();

  const all = ids.map(id => ({ id, qty: Number(by[id]||0) || 0 }));

  tbody.innerHTML = all.map(r=>`
    <tr>
      <td>${escapeHtml(prettyDessertName(r.id))}</td>
      <td class="num">${fmtNum(r.qty)}</td>
    </tr>
  `).join("");

  const used = Number(state.meta?.orders_used || 0);
  const lim  = Number(state.meta?.orders_limit || 0);
  const scopeLabel = String(state.meta?.scope_label || "").trim();
  const w0   = String(state.meta?.window_start || "").trim();
  const w1   = String(state.meta?.window_end || "").trim();
  const ordersText = lim ? `Pedidos: ${used}/${lim}` : `Pedidos: ${used}`;
  const scopeText = scopeLabel ? ` · ${scopeLabel}` : ((w0&&w1)?(" · Ventana: "+w0+" → "+w1):"");
  if(meta) meta.textContent = `${ordersText}${scopeText}`;
  renderDessertSummaryMobile_();
}

function renderDessertSummaryMobile_(){
  const host = el("summaryMobileList");
  if(!host) return;
  const ids = getDessertIdsForUi_();
  const today = ids
    .map(id => ({ id, qty: Number((state.ordersByDessert || {})[id] || 0) || 0 }))
    .filter(r => r.qty > 0);
  const late = ids
    .map(id => ({ id, qty: Number((state.late?.orders_by_dessert || state.late?.ordersByDessert || {})[id] || 0) || 0 }))
    .filter(r => r.qty > 0);

  const blockHtml = (title, hint, rows, tone)=>`
    <section class="summaryMobileBlock ${tone}">
      <div class="summaryMobileHead">
        <div>
          <div class="summaryMobileTitle">${escapeHtml(title)}</div>
          <div class="summaryMobileHint">${escapeHtml(hint)}</div>
        </div>
        <div class="summaryMobileCount">${fmtNum(rows.reduce((acc, item)=>acc + Number(item.qty||0), 0))}</div>
      </div>
      <div class="summaryMobileRows">
        ${rows.length ? rows.map(r=>`<div class="summaryMobileRow"><span>${escapeHtml(prettyDessertName(r.id))}</span><strong>${fmtNum(r.qty)}</strong></div>`).join("") : `<div class="summaryMobileEmpty">Sin postres en este bloque.</div>`}
      </div>
    </section>`;

  host.innerHTML = [
    blockHtml("Producción prioritaria", "Pedidos confirmados dentro de la ventana principal de producción.", today, "isToday"),
    blockHtml("Después de las 3:00 p. m.", "Referencia rápida de pedidos recientes posteriores al corte.", late, "isLate")
  ].join("");
}

function recipeRowsForNeeds_(dessertId){
  const did = String(dessertId||"").trim();
  if(!did) return [];

  const bySheet = Array.isArray(state.recipesByDessert?.[did]) ? state.recipesByDessert[did] : null;
  if(bySheet && bySheet.length){
    return bySheet
      .map(r => ({
        ingredient_key: String(r?.ingredient_key || "").trim(),
        qty_per_unit: Number(r?.qty_per_unit || 0) || 0,
        unit: normRecipeUnit_(r?.unit)
      }))
      .filter(r => r.ingredient_key && r.qty_per_unit > 0 && !!r.unit);
  }

  const embedded = Array.isArray(AMARED_RECIPES_PER_UNIT[did]) ? AMARED_RECIPES_PER_UNIT[did] : [];
  return embedded
    .map(pair => ({
      ingredient_key: String(pair?.[0] || "").trim(),
      qty_per_unit: Number(pair?.[1] || 0) || 0,
      unit: ""
    }))
    .filter(r => r.ingredient_key && r.qty_per_unit > 0);
}

function addDessertNeeds_(needsMap, dessertId, qty){
  const q = Number(qty || 0) || 0;
  if(!(q > 0)) return;
  const rows = recipeRowsForNeeds_(dessertId);
  if(!rows.length) return;
  for(const row of rows){
    const key = String(row.ingredient_key || "").trim();
    const per = Number(row.qty_per_unit || 0) || 0;
    if(!key || !(per > 0)) continue;
    needsMap[key] = (Number(needsMap[key] || 0) || 0) + (per * q);
  }
}

function mergeLateNeedsInto_(baseNeeds, lateObj){
  const merged = Object.assign({}, baseNeeds || {});
  const lateByDessert = lateObj?.orders_by_dessert || lateObj?.ordersByDessert || {};
  for(const [dessertId, qty] of Object.entries(lateByDessert || {})){
    addDessertNeeds_(merged, dessertId, qty);
  }
  return merged;
}

function renderLate(){
  const tbody = el("lateRows");
  const meta = el("lateMeta");
  if(!tbody) return;

  const by = state.late?.orders_by_dessert || state.late?.ordersByDessert || {};
  const ids = getDessertIdsForUi_();

  const all = ids.map(id => ({ id, qty: Number(by[id]||0) || 0 }));

  tbody.innerHTML = all.map(r=>`
    <tr>
      <td>${escapeHtml(prettyDessertName(r.id))}</td>
      <td class="num">${fmtNum(r.qty)}</td>
    </tr>
  `).join("");

  const used = Number(state.late?.orders_used || 0);
  const w0 = String(state.late?.window_start || state.meta?.late_window_start || "").trim();
  const w1 = String(state.late?.window_end || state.meta?.late_window_end || "").trim();
  if(meta) meta.textContent = `Pedidos: ${used}${(w0&&w1)?(" · Ventana: "+w0+" → "+w1):""}`;
  renderDessertSummaryMobile_();
}

// =============== Render: ingredients ===============
function rowPassesFilters(row){
  const q = String(state.ui.q||"").trim().toLowerCase();
  const onlyMissing = !!state.ui.onlyMissing;
  const onlySelected = !!state.ui.onlySelected;
  const plan = getPlan(row.key);

  if(q && !row.key.toLowerCase().includes(q)) return false;
  if(onlyMissing && !(row.missing0 > 0)) return false;
  if(onlySelected && !plan.selected) return false;
  return true;
}

function groupMetaText(keys){
  let missingCount = 0;
  let needCount = 0;
  for(const k of keys){
    const r = computeRow(k);
    if(r.missing0 > 0) missingCount++;
    if(r.need > 0) needCount++;
  }
  return `${needCount} con receta · ${missingCount} con faltante`;
}

function renderGroups(){
  const host = el("groups");
  if(!host) return;

  const allKeys = collectAllKeys();
  const groups = groupCostsKeysAuto_(allKeys);

  host.innerHTML = groups.map((g, idx)=>{
    const keys = (g.keys||[]).filter(k => rowPassesFilters(computeRow(k)));
    if(!keys.length) return "";

    const meta = groupMetaText(keys);
    const gid = `groups:${normKey_(g.title || "Sección")}`;
    const og = state.ui.openGroups || {};
    const openAttr = (og[gid] || false) ? "open" : "";
    const accent = groupAccent_(idx);

    const itemsHtml = keys.map(k => renderItemCard(computeRow(k))).join("");

    return `
      <details class="pGroup" data-gid="${escapeHtmlAttr(gid)}" ${openAttr} style="--gacc:${accent}; border-left:6px solid var(--gacc);">
        <summary style="padding-left:10px;">
          <div>
            <div class="pGroupTitle">${escapeHtml(g.title || "Sección")}</div>
            <div class="pGroupMeta">${escapeHtml(meta)}</div>
          </div>
          <div class="pGroupMeta">Toca para abrir</div>
        </summary>
        <div class="pGroupBody">
          ${itemsHtml}
        </div>
      </details>
    `;
  }).join("");
}


// =============== Listado administrativo (integrado en Compras) ===============
function costKeyPasses(k){
  const q = String(state.ui?.cost_q || "").trim().toLowerCase();
  if(!q) return true;
  return String(k||"").toLowerCase().includes(q);
}

function renderCostItemCard(key){
  const spec = state.costsByKey?.[key] || null;
  const b = baseFromSpec(spec);
  const unit = b.base_unit || (String(spec?.unit_type||"").trim() || "—");
  const pack_qty = Number(spec?.pack_qty || 0);
  const pack_price = Number(spec?.pack_price || 0);
  const cpu = getCostPerUnit(key);

  const metaA = (pack_qty>0 && pack_price>0)
    ? `Empaque: ${fmtNum(pack_qty)} ${unit} · ${moneyCOP(pack_price)} · ${cpu!==null?moneyCOP2(cpu):"—"} / ${unit}`
    : "Sin empaque (edita con ⚙️)";

  const brand = String(spec?.brand || "").trim();
  const store = String(spec?.store || "").trim();
  const metaB = [brand, store].filter(Boolean).join(" · ") || "—";

  return `
    <div class="pItem cItem" data-k="${escapeHtml(key)}" style="border-left:6px solid var(--gacc, rgba(64,17,2,.14));">
      <div class="pItemTop">
        <div>
          <div class="pName">${escapeHtml(key)}</div>
          <div class="pSubLine">${escapeHtml(metaA)}</div>
          <div class="pSubLine" style="margin-top:4px;">Marca/Tienda: ${escapeHtml(metaB)}</div>
        </div>
        <div class="pRight">
          <span class="pPill">${escapeHtml(unit)}</span>
          <button class="pGear" data-act="edit" title="Editar costo">⚙️</button>
        </div>
      </div>
    </div>
  `;
}


// ==============================
// ✅ Auto-secciones de Costos (desde POSTRES + RECETAS)
// - Agrupa ingredientes por los postres que los usan (RECETAS).
// - Si un ingrediente está en TODOS los postres activos => "Ingredientes que comparten todos los postres"
// - Si está en 2+ postres => "Ingredientes que comparten A y B ..."
// - Si está en 1 => "Ingredientes para A"
// - Si no está en ninguna receta => "Ingredientes sin receta"
// ==============================
function normActiveFlag_(v){
  const s = String(v ?? "1").trim().toLowerCase();
  return !(s === "0" || s === "false" || s === "no");
}
function activeDesserts_(){
  const list = Array.isArray(state.desserts) ? state.desserts : [];
  return list
    .map(d => ({
      id: String(d.dessert_id || d.id || "").trim(),
      name: String(d.dessert_name || d.name || d.label || "").trim(),
      active: normActiveFlag_(d.active)
    }))
    .filter(d => d.id && d.active && !isDessertHardDisabled_(d.id));
}
function dessertNameById_(){
  const m = {};
  for(const d of activeDesserts_()){
    m[d.id] = d.name || d.id;
  }
  return m;
}
function joinNamesHuman_(names){
  const arr = (names||[]).filter(Boolean);
  if(arr.length <= 1) return arr[0] || "";
  if(arr.length === 2) return `${arr[0]} y ${arr[1]}`;
  return `${arr.slice(0,-1).join(", ")} y ${arr[arr.length-1]}`;
}
function groupCostsKeysAuto_(keys){
  // fallback si no tenemos recetas o postres
  const active = activeDesserts_();
  const activeIds = active.map(d=>d.id);
  const activeSet = new Set(activeIds);
  const allCount = activeIds.length;

  const recipes = state.recipesByDessert && typeof state.recipesByDessert === "object" ? state.recipesByDessert : null;
  if(!recipes || !allCount){
    return groupKeys(keys);
  }

  const nameById = dessertNameById_();

  // ingredientCanon -> Set(dessert_id)
  const ingToDess = {};
  for(const did of Object.keys(recipes)){
    if(!activeSet.has(did)) continue;
    const rows = Array.isArray(recipes[did]) ? recipes[did] : [];
    for(const it of rows){
      const k = String(it?.ingredient_key || "").trim();
      if(!k) continue;
      const ck = canonicalKey(k);
      if(!ck) continue;
      if(!ingToDess[ck]) ingToDess[ck] = new Set();
      ingToDess[ck].add(did);
    }
  }

  // signature -> {title, keys, _meta}
  const gmap = {};
  function pushTo(title, key, meta){
    const id = title;
    if(!gmap[id]) gmap[id] = { title, keys: [], _meta: meta || {} };
    gmap[id].keys.push(key);
  }

  for(const k0 of (keys||[])){
    const k = String(k0||"").trim();
    if(!k) continue;
    const ck = canonicalKey(k);
    const set = ingToDess[ck] ? Array.from(ingToDess[ck]) : [];
    set.sort((a,b)=>String(nameById[a]||a).localeCompare(String(nameById[b]||b),"es"));

    if(!set.length){
      pushTo("Ingredientes sin receta", k, {prio: 30});
      continue;
    }

    if(set.length === allCount){
      pushTo("Ingredientes que comparten todos los postres", k, {prio: 0});
      continue;
    }

    if(set.length === 1){
      const nm = nameById[set[0]] || set[0];
      pushTo(`Ingredientes para ${nm}`, k, {prio: 20});
      continue;
    }

    const names = set.map(id => nameById[id] || id);
    const title = `Ingredientes que comparten ${joinNamesHuman_(names)}`;
    pushTo(title, k, {prio: 10, n:set.length});
  }

  // build ordered list
  const out = Object.values(gmap);
  for(const g of out){
    g.keys = uniqSorted(g.keys);
  }
  out.sort((a,b)=>{
    const pa = a._meta?.prio ?? 99;
    const pb = b._meta?.prio ?? 99;
    if(pa !== pb) return pa - pb;
    // secondary: more shared first
    const na = a._meta?.n ?? 0;
    const nb = b._meta?.n ?? 0;
    if(na !== nb) return nb - na;
    return String(a.title||"").localeCompare(String(b.title||""),"es");
  });
  // clean meta
  out.forEach(g=>{ try{ delete g._meta; }catch(_e){} });
  return out;
}

function renderCostsGroups(){
  const host = el("costGroups");
  if(!host) return;

  const keysAll = Object.keys(state.costsByKey || {});
  keysAll.sort((a,b)=>a.localeCompare(b,"es"));

  const keys = keysAll.filter(costKeyPasses);
  const groups = groupCostsKeysAuto_(keys);

  setCostsMeta(`Ingredientes: ${keysAll.length} · Mostrando: ${keys.length} · Tiendas: ${state.stores.length} · Marcas: ${state.brands.length}`);

  host.innerHTML = groups.map((g, idx)=>{
    const gkeys = (g.keys||[]).filter(k => keys.includes(k));
    if(!gkeys.length) return "";

    const meta = `${gkeys.length} ingrediente(s)`;
    const gid = `costGroups:${normKey_(g.title || "Sección")}`;
    const og = state.ui.openGroups || {};
    const openAttr = (og[gid] || false) ? "open" : "";
    const accent = groupAccent_(idx);
    const itemsHtml = gkeys.map(k => renderCostItemCard(k)).join("");

    return `
      <details class="pGroup" data-gid="${escapeHtmlAttr(gid)}" ${openAttr} style="--gacc:${accent}; border-left:6px solid var(--gacc);">
        <summary style="padding-left:10px;">
          <div>
            <div class="pGroupTitle">${escapeHtml(g.title || "Sección")}</div>
            <div class="pGroupMeta">${escapeHtml(meta)}</div>
          </div>
          <div class="pGroupMeta">Toca para abrir</div>
        </summary>
        <div class="pGroupBody">
          ${itemsHtml}
        </div>
      </details>
    `;
  }).join("");
}


function lastSpecLine(row){
  const b = row.base;
  const parts = [];
  if(b.brand) parts.push(b.brand);
  if(b.store) parts.push(b.store);

  let packInfo = "";
  if(b.pack_qty > 0 && b.pack_price > 0){
    packInfo = `Empaque: ${fmtNum(b.pack_qty)} ${b.base_unit || row.unit} · ${moneyCOP(b.pack_price)}`;
  }

  return [parts.join(" · "), packInfo].filter(Boolean).join(" · ") || "Sin detalle de empaque (puedes definirlo con ⚙️)";
}


function applyRecommendedBuyPlan_(key){
  const row = computeRow(key);
  const plan = getPlan(key);
  plan.selected = true;
  const needBuy = Math.max(0, (row.need - row.invBase));
  if(row.base.pack_qty > 0){
    plan.packs = needBuy > 0 ? Math.ceil(needBuy / row.base.pack_qty) : 0;
    plan.qty_manual = 0;
  } else {
    plan.qty_manual = needBuy > 0 ? needBuy : 0;
    plan.packs = 0;
  }
  const bought = (row.base.pack_qty > 0 && plan.packs > 0) ? (plan.packs * row.base.pack_qty) : (plan.qty_manual || 0);
  const sobra = Math.max(0, bought - needBuy);
  plan.autoInfo = { bought, sobra, ts: Date.now() };
  return { row, plan, needBuy, bought, sobra };
}

function renderItemCard(row){
  const plan = getPlan(row.key);

  const needCls = row.need>0 ? "" : "";
  const invCls = row.invBase>=row.need && row.need>0 ? "ok" : "";
  const missCls = row.missing0>0 ? "warn" : (row.need>0?"ok":"");

  // Input mode
  const hasPack = row.base.pack_qty > 0;
  const packLabel = hasPack ? "Empaques" : `Cantidad (${row.unit})`;
  const packHint  = hasPack ? `1 empaque = ${fmtNum(row.base.pack_qty)} ${row.unit}` : "";

  const plannedQty = row.planned;
  const est = (row.cpu!==null && plannedQty>0) ? (plannedQty * row.cpu) : null;

  return `
    <div class="pItem" data-k="${escapeHtml(row.key)}" style="border-left:6px solid var(--gacc, rgba(64,17,2,.14));">
      <div class="pItemTop">
        <div>
          <div class="pName">${escapeHtml(row.key)}</div>
          <div class="pSubLine">${escapeHtml(lastSpecLine(row))}</div>
        </div>
        <div class="pRight">
          <span class="pPill">${escapeHtml(row.unit)}</span>
          <button class="pGear" data-act="edit" title="Editar presentación">⚙️</button>
        </div>
      </div>

      <div class="pNums">
        <div class="pNum ${needCls}">
          <div class="lbl">Necesario</div>
          <div class="val">${fmtNum(row.need)}</div>
        </div>
        <div class="pNum ${invCls}">
          <div class="lbl">Inventario</div>
          <div class="val">${fmtNum(row.invBase)}</div>
        </div>
        <div class="pNum ${missCls}">
          <div class="lbl">Falta</div>
          <div class="val">${fmtNum(row.missing0)}</div>
        </div>
      </div>

      <div class="pBuyRow">
        <div class="pSwitch">
          <label class="switch" title="Marcar para comprar">
            <input type="checkbox" data-act="toggle" ${plan.selected?"checked":""} />
            <span class="slider"></span>
          </label>
          <div class="lblBuy">Comprar</div>
        </div>

        <div class="pBuyInputs">
          <input class="input" data-act="packs" type="number" step="any" min="0" placeholder="${escapeHtml(packLabel)}" value="${plan.selected && hasPack && plan.packs?escapeHtml(String(plan.packs)):""}" ${plan.selected?"":"disabled"} />
          <input class="input" data-act="manual" type="number" step="any" min="0" placeholder="Cantidad (${escapeHtml(row.unit)})" value="${plan.selected && (!hasPack) && plan.qty_manual?escapeHtml(String(plan.qty_manual)):""}" ${plan.selected?"":"disabled"} ${hasPack?"style=\"display:none\"":""} />
          <button class="pTinyBtn" data-act="auto" ${plan.selected?"":"disabled"} title="Rellenar con lo que falta">Auto</button>
        </div>

        <div class="pBuyMeta">
          ${(() => {
            const out = [];
            try{
              if(packHint) out.push(`<span class="mi mi-pack">${escapeHtml(packHint)}</span>`);
              out.push(`<span class="mi mi-plan">Planeado: <b>${fmtNum(plannedQty)}</b> ${escapeHtml(row.unit)}</span>`);

              if(plan.selected){
                const bought = plannedQty;
                if(bought > 0){
                  const needBuy0 = Math.max(0, (row.need - row.invBase));
                  const sobra = Math.max(0, bought - needBuy0);
                  const unit = escapeHtml(row.unit);

                  if(row.base.pack_qty>0 && plan.packs>0){
                    const packsTxt = `${fmtNum(plan.packs)} empaque(s)`;
                    out.push(`<span class="mi mi-buy">Comprado: <b>${fmtNum(bought)}</b> ${unit} <span class="miSub">(${packsTxt})</span></span>`);
                  }else{
                    out.push(`<span class="mi mi-buy">Comprado: <b>${fmtNum(bought)}</b> ${unit}</span>`);
                  }

                  if(sobra > 0){
                    out.push(`<span class="mi mi-left">Sobra: <b>${fmtNum(sobra)}</b> ${unit}</span>`);
                  }
                }
              }

              if(row.cpu!==null) out.push(`<span class="mi mi-cpu">Costo/u: <b>${moneyCOP2(row.cpu)}</b></span>`);
              if(est!==null) out.push(`<span class="mi mi-est">Est: <b>${moneyCOP(est)}</b></span>`);
            }catch(_e){}
            return out.join("");
          })()}
        </div>
      </div>
    </div>
  `;
}

// =============== Totals & confirm ===============
function selectedKeys(){
  return Object.keys(state.buyPlan || {}).filter(k => state.buyPlan[k]?.selected);
}

function totalEstimated(){
  let total = 0;
  let any = false;
  for(const k of selectedKeys()){
    const qty = computePlannedQty(k);
    if(!(qty>0)) continue;
    const cpu = getCostPerUnit(k);
    if(cpu === null) continue;
    total += qty * cpu;
    any = true;
  }
  return { total, any };
}

function refreshBottom(){
  const keys = selectedKeys();
  const n = keys.length;
  const est = totalEstimated();

  if(el("totalCop")) el("totalCop").textContent = est.any ? moneyCOP(est.total) : "$—";
  if(el("totalHint")) el("totalHint").textContent = `${n} ingrediente(s) marcados`;

  const btn = el("btnRegister");
  if(btn) btn.disabled = (n === 0);
}

function openConfirm(){
  const back = el("confirmBack");
  const list = el("confirmList");
  const totalEl = el("confirmTotal");

  const keys = selectedKeys();
  const rows = [];

  for(const k of keys){
    const qty = computePlannedQty(k);
    if(!(qty>0)) continue;
    const unit = getUnitFor(k);
    const cpu = getCostPerUnit(k);
    const est = (cpu!==null) ? (qty * cpu) : null;
    rows.push({ k, qty, unit, cpu, est });
  }

  const sum = rows.reduce((s,r)=> s + (r.est||0), 0);
  if(totalEl) totalEl.textContent = rows.some(r=>r.est!==null) ? moneyCOP(sum) : "$—";

  if(list){
    list.innerHTML = rows.length ? rows.map(r=>`
      <div class="pConfirmItem">
        <div class="pConfirmItemTop">
          <div class="pConfirmItemName">${escapeHtml(r.k)}</div>
          <div style="font-weight:950;">${r.est!==null ? moneyCOP(r.est) : "$—"}</div>
        </div>
        <div class="pConfirmItemMeta">
          Cantidad: <b>${fmtNum(r.qty)}</b> ${escapeHtml(r.unit)}
          ${r.cpu!==null ? (` · Costo/u: ${moneyCOP(r.cpu)}`) : ""}
        </div>
      </div>
    `).join("") : `<div class="hint">No hay cantidades planeadas (revisa empaques/cantidad).</div>`;
  }

  show(back);
}

function closeConfirm(){ hide(el("confirmBack")); }

// =============== Register purchases ===============
function buildPurchaseBatch(){
  const entries = [];
  for(const k of selectedKeys()){
    const qty = computePlannedQty(k);
    if(!(qty>0)) continue;
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
    openUnlock("Ingresa tu clave para continuar.");
    return;
  }

  const items = buildPurchaseBatch();
  if(items.length === 0){
    setMeta("No hay ingredientes con cantidad planeada.");
    return;
  }

  showLoading("Registrando compras…", "Actualizando inventario en la base de datos.");
  try{
    await api({
      action: "inventory_add_purchase_batch",
      costs_secret: UNLOCKED_SECRET,
      updated_by: "PURCHASES_UI",
      source: "PURCHASES_UI",
      items
    }, {timeoutMs: 60000});

    state.buyPlan = {};
    await loadAll({ loadRecipesNow:false });
    setMeta("✅ Compras registradas y inventario actualizado.");
  } catch(err){
    setMeta(`❌ Error registrando compras: ${(err && err.message) ? err.message : "Error"}`);
  } finally {
    hideLoading();
  }
}

// =============== Meta ===============
function setMeta(msg){
  const m = el("meta");
  if(m) m.textContent = msg || "";
}

function updateMetaLine(){
  const used = Number(state.meta?.orders_used || 0);
  const lim  = Number(state.meta?.orders_limit || 0);
  const scopeLabel = String(state.meta?.scope_label || "").trim();
  const w0   = String(state.meta?.window_start || "").trim();
  const w1   = String(state.meta?.window_end || "").trim();
  const scopeText = scopeLabel || ((w0&&w1) ? `${w0} → ${w1}` : `${Number(state.meta?.window_hours || state.window_h)}h`);
  const scopePrefix = scopeLabel ? "Alcance" : "Ventana";
  const ordersText = lim ? `Pedidos: ${used}/${lim}` : `Pedidos: ${used}`;

  const selected = selectedKeys().length;
  setMeta(`${scopePrefix}: ${scopeText} · ${ordersText} · Marcados: ${selected}`);
}

// =============== Data load ===============
async function loadAll(opts={}){
  if(!UNLOCKED_SECRET) throw new Error("Sin clave.");
  const loadRecipesNow = !!opts.loadRecipesNow || state.view === "recipes";

  updateMetaLine();

  const [invOut, needsOut, costsOut, catOut, dessertsOut] = await Promise.all([
    api({ action:"inventory_get", costs_secret: UNLOCKED_SECRET }),
    api({ action:"costs_orders_for_purchases", costs_secret: UNLOCKED_SECRET, window_h: state.window_h }),
    api({ action:"costs_list", costs_secret: UNLOCKED_SECRET }),
    api({ action:"catalog_list", costs_secret: UNLOCKED_SECRET }),
    api({ action:"desserts_public_list", costs_secret: UNLOCKED_SECRET }),
  ]);

  state.inventory = invOut.inventory || {};
  state.meta = needsOut.meta || {};
  applyCatalogs(catOut);

  // Postres activos desde POSTRES (para Compras/Costos)
  try{
    state.desserts = Array.isArray(dessertsOut?.items) ? dessertsOut.items : [];
  }catch(_e){ state.desserts = state.desserts || []; }


  state.ordersByDessert = needsOut.orders_by_dessert || needsOut.ordersByDessert || {};
  state.late = needsOut.late || {};
  state.needs = mergeLateNeedsInto_(needsOut.needs || {}, state.late);
  state.items = costsOut.items || [];
  indexCosts(state.items);

  // Recetas desde hoja RECETAS (para costo unitario)
  if(loadRecipesNow) await ensureRecipesLoaded_({ force:true, background:false });
  else scheduleRecipesWarmup_(false);

  updateMetaLine();
  renderDesserts();
  renderUnitCosts();
  renderLate();
  renderGroups();
  renderCostGroupsIfOpen_();
  refreshBottom();
  saveCostsDataCache_();
  hideCostsSyncBadge_();
}

function renderCostsBootLoadingState_(msg){
  try{
    showCostsSyncBadge_(msg || "Cargando información…", "Puedes seguir usando la página mientras se actualizan las secciones.");
    const meta = el("meta");
    if(meta) meta.textContent = String(msg || "Cargando información…");
    const dessertsMeta = el("dessertsMeta");
    if(dessertsMeta) dessertsMeta.textContent = "Consultando pedidos confirmados…";
    const lateMeta = el("lateMeta");
    if(lateMeta) lateMeta.textContent = "Consultando pedidos posteriores al corte…";
    const unitRows = el("unitCostRows");
    if(unitRows && !String(unitRows.innerHTML||"").trim()) unitRows.innerHTML = `<tr><td colspan="2">${inlineLoadHtml("Cargando costos por unidad…", "Estamos consultando recetas e ingredientes para el cálculo.", true)}</td></tr>`;
    const dessertRows = el("dessertRows");
    if(dessertRows && !String(dessertRows.innerHTML||"").trim()) dessertRows.innerHTML = `<tr><td colspan="2">${inlineLoadHtml("Cargando postres confirmados…", "Estamos reuniendo los pedidos que entran en la ventana de producción.", true)}</td></tr>`;
    const lateRows = el("lateRows");
    if(lateRows && !String(lateRows.innerHTML||"").trim()) lateRows.innerHTML = `<tr><td colspan="2">${inlineLoadHtml("Cargando pedidos recientes…", "Estamos consultando los pedidos posteriores al corte de las 3:00 p. m.", true)}</td></tr>`;
    const groups = el("groups");
    if(groups && !String(groups.innerHTML||"").trim()) groups.innerHTML = inlineLoadHtml("Cargando ingredientes para compras…", "Estamos calculando faltantes, inventario y cantidades mínimas sugeridas.");
    const costGroups = el("costGroups");
    if(costGroups && !String(costGroups.innerHTML||"").trim()) costGroups.innerHTML = inlineLoadHtml("Cargando listado administrativo…", "Estamos organizando ingredientes, marcas, tiendas y costos unitarios.");
  }catch(_e){}
}

function primeCostsShell_(profile, fastCache){
  try{
    UNLOCKED_PROFILE = {
      id: String(profile?.id || "").trim(),
      label: String(profile?.label || profile?.id || "").trim(),
      categories: Array.isArray(profile?.categories) ? profile.categories : []
    };
    closeUnlock();
    setCostsShellMode_("app");
    show(el("appRoot"));
    show(el("mobileNav"));
    setView("purchases");
    if(fastCache) hydrateCostsDataFromCache_(fastCache);
    else renderCostsBootLoadingState_("Actualizando información de compras…");
  }catch(_e){}
}

// =============== Unlock / logout ===============

function isRememberDeviceEnabled_(){
  try{ return String(localStorage.getItem(LS_REMEMBER_KEY)||"") === "1"; }catch(_e){ return false; }
}
function setRememberDeviceEnabled_(v){
  try{
    if(v) localStorage.setItem(LS_REMEMBER_KEY, "1");
    else localStorage.removeItem(LS_REMEMBER_KEY);
  }catch(_e){}
}
function getRememberCheckbox_(){
  return el("chkRememberDevice");
}


// ===== Deleted desserts (hide from Recetas) =====
const KNOWN_BASE_DESSERT_IDS_ = new Set(["mousse_maracuya","cheesecake_cafe_panela"]);

function loadDeletedDesserts_(){
  // Tombstones de postres eliminados para ocultarlos aunque existan en pedidos viejos.
  // Formato v2: {"postre_id": 1710000000000, ...} (timestamp ms)
  // Compat v1: ["postre_id", ...]
  try{
    const raw = localStorage.getItem(LS_DELETED_DESSERTS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const map = {};

    if(Array.isArray(parsed)){
      parsed.forEach(x=>{
        const id = String(x||"").trim().toLowerCase();
        if(id) map[id] = 0;
      });
    }else if(parsed && typeof parsed === "object"){
      for(const k in parsed){
        const id = String(k||"").trim().toLowerCase();
        const ts = Number(parsed[k] || 0);
        if(id) map[id] = isFinite(ts) ? ts : 0;
      }
    }

    state.ui = state.ui || {};
    state.ui.deletedDessertsMap = map;
  }catch(_e){
    state.ui = state.ui || {};
    state.ui.deletedDessertsMap = {};
  }
}

function saveDeletedDesserts_(){
  try{
    const map = (state.ui && state.ui.deletedDessertsMap) ? state.ui.deletedDessertsMap : {};
    localStorage.setItem(LS_DELETED_DESSERTS_KEY, JSON.stringify(map || {}));
  }catch(_e){}
}

function markDessertDeleted_(id){
  const did = String(id||"").trim().toLowerCase();
  if(!did) return;
  state.ui = state.ui || {};
  state.ui.deletedDessertsMap = state.ui.deletedDessertsMap || {};
  // timestamp ms para permitir "des-tombstone" si se restaura luego
  state.ui.deletedDessertsMap[did] = Date.now();
  saveDeletedDesserts_();
}

function unmarkDessertDeleted_(id){
  const did = String(id||"").trim().toLowerCase();
  if(!did) return;
  state.ui = state.ui || {};
  state.ui.deletedDessertsMap = state.ui.deletedDessertsMap || {};
  delete state.ui.deletedDessertsMap[did];
  saveDeletedDesserts_();
}

function isDessertLocallyDeleted_(id){
  const did = String(id||"").trim().toLowerCase();
  if(!did) return false;
  const map = (state.ui && state.ui.deletedDessertsMap) ? state.ui.deletedDessertsMap : null;
  return !!map && Object.prototype.hasOwnProperty.call(map, did);
}

function openUnlock(msg){
  if(el("unlockMsg")) el("unlockMsg").textContent = msg || "";
  setCostsShellMode_("login");
  show(el("unlockBack"));
  hide(el("appRoot"));
  // ✅ En login no mostramos el menú inferior móvil
  hide(el("mobileNav"));
  hide(el("mNavSheetBack"));
  try{ const b = el("mNavMenu"); if(b){ b.setAttribute("aria-expanded","false"); } }catch(_e){}
  // ✅ checkbox "Recuérdame"
  const chk = getRememberCheckbox_();
  if(chk){
    const saved = String(localStorage.getItem(LS_SECRET_KEY) || "").trim();
    chk.checked = !!saved && isRememberDeviceEnabled_();
  }
  try{
    const savedProfile = String(localStorage.getItem(LS_PROFILE_KEY) || "").trim();
    if(savedProfile && el("loginProfile")) ensureSelectValueOption_(el("loginProfile"), savedProfile, savedProfile);
  }catch(_e){}
  syncSecretToggleState_();
  syncMobileNavForViewport_();
  if(el("secretInput")) el("secretInput").focus();
}

function closeUnlock(){
  if(el("unlockMsg")) el("unlockMsg").textContent = "";
  hide(el("unlockBack"));
}

async function doUnlock(isAuto=false, opts={}){
  const profileId = String((opts && opts.profileId) ?? (el("loginProfile")?.value || "")).trim();
  const secret = String((opts && opts.secret) ?? (el("secretInput")?.value || "")).trim();
  const profileLabel = String((opts && opts.profileLabel) || profileId || "").trim();
  const fromPortal = !!opts.fromPortal;
  const silent = !!opts.silent;
  const skipOverlay = !!opts.skipOverlay;
  const backgroundLoad = !!opts.backgroundLoad;
  const skipShell = !!opts.skipShell;
  const rememberOverride = (typeof opts.remember === "boolean") ? opts.remember : null;

  if(!profileId){
    if(!isAuto && !silent && el("unlockMsg")) el("unlockMsg").textContent = "Selecciona un perfil.";
    return;
  }
  if(!secret){
    if(!isAuto && !silent && el("unlockMsg")) el("unlockMsg").textContent = "Escribe la contraseña.";
    return;
  }

  if(!skipOverlay) showLoading("Validando…", "Verificando el acceso en el servidor.");
  try{
    const authProfile = await validateSecret(secret, profileId);
    UNLOCKED_SECRET = secret;
    UNLOCKED_PROFILE = {
      id: String(authProfile?.id || profileId || "").trim(),
      label: String(authProfile?.label || profileLabel || profileId || "").trim(),
      categories: Array.isArray(authProfile?.categories) ? authProfile.categories : []
    };
    const chk = getRememberCheckbox_();
    const remember = (rememberOverride !== null) ? rememberOverride : !!(chk && chk.checked);
    if(remember){
      try{ localStorage.setItem(LS_SECRET_KEY, secret); }catch(_e){}
      try{ localStorage.setItem(LS_PROFILE_KEY, profileId); }catch(_e){}
      setRememberDeviceEnabled_(true);
    }else{
      try{ localStorage.removeItem(LS_SECRET_KEY); }catch(_e){}
      try{ localStorage.removeItem(LS_PROFILE_KEY); }catch(_e){}
      setRememberDeviceEnabled_(false);
    }
    if(!skipShell){
      closeUnlock();
      setCostsShellMode_("app");
      show(el("appRoot"));
      show(el("mobileNav"));
      setView("purchases");
      syncMobileNavForViewport_();
    }
    if(backgroundLoad){
      renderCostsBootLoadingState_("Actualizando información de compras…");
      void loadAll().catch(err=>{
        console.error("costs background load error:", err);
        hideCostsSyncBadge_();
        if(!silent && el("unlockMsg")) el("unlockMsg").textContent = (err && err.message) ? err.message : "No se pudieron cargar los datos.";
      });
    }else{
      await loadAll();
    }
    syncMobileNavForViewport_();
  } catch(err){
    hideCostsSyncBadge_();
    UNLOCKED_SECRET = "";
    UNLOCKED_PROFILE = { id:"", label:"", categories:[] };
    if(!silent && el("unlockMsg")) el("unlockMsg").textContent = (err && err.message) ? err.message : "No autorizado";
    if(isAuto || fromPortal){
      try{ localStorage.removeItem(LS_SECRET_KEY); }catch(_e){}
      try{ localStorage.removeItem(LS_PROFILE_KEY); }catch(_e){}
      setRememberDeviceEnabled_(false);
      clearPortalCostsSession_();
    }
  } finally {
    hideLoading();
  }
}

function logout(){
  hideCostsSyncBadge_();
  UNLOCKED_SECRET = "";
  UNLOCKED_PROFILE = { id:"", label:"", categories:[] };
  clearCostsDataCache_();
  try{ resetRecipesAuth_(); }catch(_e){}
  try{ localStorage.removeItem(LS_SECRET_KEY); }catch(_e){}
  try{ localStorage.removeItem(LS_PROFILE_KEY); }catch(_e){}
  setRememberDeviceEnabled_(false);
  state.buyPlan = {};
  state.ui.openGroups = {};
  // reset UI
  if(el("secretInput")) el("secretInput").value = "";
  const chk = getRememberCheckbox_();
  if(chk) chk.checked = false;
  hide(el("mobileNav"));
  hide(el("mNavSheetBack"));
  clearPortalCostsSession_();
  openUnlock("Sesión cerrada.");
}

// =============== Cost modal (edit) ===============
let CM = { key:null };

function cmEls(){
  return {
    back: el("costModalBack"),
    title: el("costModalTitle"),
    sub: el("costModalSub"),
    unitType: el("cmUnitType"),
    packQty: el("cmPackQty"),
    packPrice: el("cmPackPrice"),
    unitExtra: el("cmUnitExtra"),
    unitItemQty: el("cmUnitItemQty"),
    unitItemType: el("cmUnitItemType"),
    brand: el("cmBrand"),
    store: el("cmStore"),
    computed: el("cmComputed"),
    err: el("cmErr"),
    save: el("cmSave"),
  };
}

function cmComputePreview(){
  const e = cmEls();
  const unit_type = String(e.unitType?.value||"").trim();
  const pack_qty = Number(e.packQty?.value||0);
  const pack_price = Number(e.packPrice?.value||0);
  const unit_item_qty = Number(e.unitItemQty?.value||0);
  const unit_item_type = String(e.unitItemType?.value||"").trim();

  let base_unit = unit_type;
  let base_pack_qty = pack_qty;
  let cpu = null;

  if(unit_type === "unidad" && unit_item_qty>0 && (unit_item_type==="g" || unit_item_type==="ml" || unit_item_type==="m")){
    base_unit = unit_item_type;
    base_pack_qty = pack_qty * unit_item_qty;
  }

  if(base_pack_qty>0 && pack_price>0) cpu = pack_price / base_pack_qty;

  if(e.unitExtra) e.unitExtra.style.display = (unit_type === "unidad") ? "block" : "none";
  if(e.computed){
    e.computed.textContent = `Se guardará como: ${base_pack_qty ? fmtNum(base_pack_qty) : "—"} ${base_unit || "—"} por empaque · Costo/u: ${cpu?moneyCOP2(cpu):"—"}`;
  }
}

function openCostModal(key){
  const e = cmEls();
  CM.key = key;
  if(e.err) e.err.textContent = "";

  const spec = state.costsByKey?.[key] || null;
  const unit_type = String(spec?.unit_type || "").trim().toLowerCase() || "g";

  if(e.title) e.title.textContent = `Detalle: ${key}`;

  if(e.unitType) e.unitType.value = (unit_type==="g"||unit_type==="ml"||unit_type==="m"||unit_type==="unidad") ? unit_type : "g";
  if(e.packQty) e.packQty.value = spec?.pack_qty ? String(spec.pack_qty) : "";
  if(e.packPrice) e.packPrice.value = spec?.pack_price ? String(spec.pack_price) : "";

  if(e.unitItemQty) e.unitItemQty.value = spec?.unit_item_qty ? String(spec.unit_item_qty) : "";
  if(e.unitItemType) e.unitItemType.value = String(spec?.unit_item_qty_type || "").trim().toLowerCase();

  renderSelect("cmBrand", state.brands || [], String(spec?.brand || ""));
  renderSelect("cmStore", state.stores || [], String(spec?.store || ""));

  cmComputePreview();
  show(e.back);
}

function closeCostModal(){
  hide(el("costModalBack"));
  CM.key = null;
}

function refreshCostModalCatalogSelects_(opts={}){
  const back = el("costModalBack");
  if(!back || back.classList.contains("hidden")) return;
  const currentBrand = Object.prototype.hasOwnProperty.call(opts, "brand")
    ? String(opts.brand || "").trim()
    : String(el("cmBrand")?.value || "").trim();
  const currentStore = Object.prototype.hasOwnProperty.call(opts, "store")
    ? String(opts.store || "").trim()
    : String(el("cmStore")?.value || "").trim();
  renderSelect("cmBrand", state.brands || [], currentBrand);
  renderSelect("cmStore", state.stores || [], currentStore);
}

function patchCostSpecInState_(ingredient_key, patch, opts={}){
  const removeIfMissing = !!opts.removeIfMissing;
  const prevByKey = state.costsByKey || {};
  const prevSpec = prevByKey[ingredient_key] ? { ...prevByKey[ingredient_key] } : null;
  const prevIdx = Array.isArray(state.items)
    ? state.items.findIndex(it => String(it?.ingredient_key ?? it?.key ?? it?.name ?? "").trim() === ingredient_key)
    : -1;
  const prevItem = (prevIdx >= 0 && Array.isArray(state.items)) ? { ...state.items[prevIdx] } : null;

  if(!patch && removeIfMissing){
    try{ delete prevByKey[ingredient_key]; }catch(_e){}
    if(prevIdx >= 0) state.items.splice(prevIdx, 1);
  }else if(patch){
    const next = {
      ...(prevSpec || {}),
      ingredient_key,
      key: prevSpec?.key || ingredient_key,
      name: prevSpec?.name || ingredient_key,
      ...patch,
    };
    state.costsByKey = state.costsByKey || {};
    state.costsByKey[ingredient_key] = next;
    if(Array.isArray(state.items)){
      if(prevIdx >= 0) state.items[prevIdx] = { ...(state.items[prevIdx] || {}), ...next };
      else state.items.push(next);
    }
  }

  try{
    renderUnitCosts();
    renderGroups();
    renderCostGroupsIfOpen_();
    refreshBottom();
    saveCostsDataCache_();
  }catch(_e){}

  return { prevSpec, prevItem, prevIdx };
}

async function saveCostModal(){
  const e = cmEls();
  if(!CM.key) return;
  if(e.err) e.err.textContent = "";

  const ingredient_key = CM.key;
  const unit_type = String(e.unitType?.value||"").trim();
  const pack_qty0 = Number(e.packQty?.value||0);
  const pack_price = Number(e.packPrice?.value||0);
  const brand = String(e.brand?.value||"").trim();
  const store = String(e.store?.value||"").trim();

  const unit_item_qty = Number(e.unitItemQty?.value||0);
  const unit_item_qty_type = String(e.unitItemType?.value||"").trim();

  if(!unit_type){ if(e.err) e.err.textContent = "Selecciona unidad."; return; }
  if(!(pack_qty0>0)){ if(e.err) e.err.textContent = "Cantidad de empaque inválida."; return; }
  if(!(pack_price>0)){ if(e.err) e.err.textContent = "Precio de empaque inválido."; return; }

  let save_unit_type = unit_type;
  let save_pack_qty = pack_qty0;
  if(unit_type === "unidad" && unit_item_qty>0 && (unit_item_qty_type==="g" || unit_item_qty_type==="ml" || unit_item_qty_type==="m")){
    save_unit_type = unit_item_qty_type;
    save_pack_qty = pack_qty0 * unit_item_qty;
  }

  const cop_per_unit = pack_price / save_pack_qty;
  const payload = {
    unit_type: save_unit_type,
    pack_qty: save_pack_qty,
    pack_price,
    cop_per_unit,
    brand,
    store,
    unit_item_qty: (unit_item_qty>0 ? unit_item_qty : ""),
    unit_item_qty_type: unit_item_qty_type || "",
  };

  const snapshot = patchCostSpecInState_(ingredient_key, payload);
  closeCostModal();
  setGlobalMsg("", false);
  setMeta(`⏳ Guardando ${ingredient_key} en segundo plano…`);
  showCostsSyncBadge_("Guardando cambios…", "Puedes seguir usando la página mientras actualizamos COSTOS_INGREDIENTES.");

  void api({
    action:"costs_upsert",
    costs_secret: UNLOCKED_SECRET,
    ingredient_key,
    unit_type: save_unit_type,
    pack_qty: save_pack_qty,
    pack_price,
    cop_per_unit,
    brand,
    store,
    unit_item_qty: (unit_item_qty>0 ? unit_item_qty : ""),
    unit_item_qty_type: unit_item_qty_type || "",
    updated_by: "PURCHASES_UI"
  }, {timeoutMs: 60000})
    .then(async()=>{
      setMeta("✅ Costos actualizados.");
      showCostsSyncBadge_("Costos actualizados", "Sincronizando la información más reciente sin interrumpir tu trabajo.");
      try{
        await loadAll();
      }catch(_e){}
      setGlobalMsg("", false);
      setTimeout(()=>{ try{ hideCostsSyncBadge_(); }catch(_e){} }, 1200);
    })
    .catch((err)=>{
      const stateCosts = state.costsByKey || {};
      if(snapshot.prevSpec){
        stateCosts[ingredient_key] = snapshot.prevSpec;
        if(Array.isArray(state.items) && snapshot.prevIdx >= 0 && snapshot.prevItem){
          state.items[snapshot.prevIdx] = snapshot.prevItem;
        }
      }else{
        try{ delete stateCosts[ingredient_key]; }catch(_e){}
        if(Array.isArray(state.items) && snapshot.prevIdx >= 0){
          state.items.splice(snapshot.prevIdx, 1);
        }
      }
      try{
        renderUnitCosts();
        renderGroups();
        renderCostGroupsIfOpen_();
        refreshBottom();
        saveCostsDataCache_();
      }catch(_e){}
      hideCostsSyncBadge_();
      setMeta("❌ No se pudo guardar el costo.");
      setGlobalMsg((err && err.message) ? err.message : "Error guardando el costo.", true);
    });
}

// =============== Catalog manager (Tiendas/Marcas) ===============
async function refreshCatalogs(){
  const out = await api({ action:"catalog_list", costs_secret: UNLOCKED_SECRET });
  applyCatalogs(out);
}

function fillSimpleSelect(selId, arr){
  const s = el(selId);
  if(!s) return;
  const list = Array.isArray(arr) ? arr.map(v=>String(v||"").trim()).filter(Boolean) : [];
  if(list.length === 0){
    s.innerHTML = `<option value="">(vacío)</option>`;
    return;
  }
  s.innerHTML = list.map(v=>`<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
}

function openCatalogModal(){
  if(!UNLOCKED_SECRET){
    openUnlock("Ingresa tu clave para continuar.");
    return;
  }
  if(el("catErr")) el("catErr").textContent = "";
  fillSimpleSelect("catStores", state.stores);
  fillSimpleSelect("catBrands", state.brands);
  show(el("catModalBack"));
}

function closeCatalogModal(){ hide(el("catModalBack")); }



let ingDeleteTimer = null;
let ingDeleteCountdown = 0;
let ingDeletePendingKey = "";

function openIngredientsModal(){
  if(!UNLOCKED_SECRET){
    openUnlock("Ingresa tu clave para continuar.");
    return;
  }
  if(el("ingAddMsg")) el("ingAddMsg").textContent = "";
  if(el("ingDelMsg")) el("ingDelMsg").textContent = "";
  // Secciones disponibles (desde kitchen-costs.js)
  const secSel = el("ingNewSection");
  if(secSel){
    const base = Array.isArray(window.AMARED_COSTS_SECTIONS) ? window.AMARED_COSTS_SECTIONS.map(s=>String(s.title||"").trim()).filter(Boolean) : [];
    // incluir secciones personalizadas que ya existan en COSTOS_INGREDIENTES
    const extra = [];
    for(const k of Object.keys(state.costsByKey||{})){
      const t = String(state.costsByKey?.[k]?.section_title || state.costsByKey?.[k]?.section || "").trim();
      if(t) extra.push(t);
    }
    const uniq = Array.from(new Set(["(Sin asignar)"].concat(base).concat(extra)));
    secSel.innerHTML = uniq.map(t=>{
      const val = (t==="(Sin asignar)") ? "" : t;
      return `<option value="${escapeHtmlAttr(val)}">${escapeHtml(t)}</option>`;
    }).join("");
  }

  // llenar select con ingredientes actuales (agrupado automático)
  refreshIngredientSelect_();
  show(el("ingModalBack"));
}
function closeIngredientsModal(){ hide(el("ingModalBack")); }

function refreshIngredientSelect_(){
  const sel = el("ingSelect");
  if(!sel) return;

  const keysAll = Object.keys(state.costsByKey||{}).sort((a,b)=>a.localeCompare(b,"es"));
  const current = String(sel.value||"").trim();

  // Agrupar por secciones automáticas (según POSTRES + RECETAS).
  // Si no hay datos suficientes, groupCostsKeysAuto_ cae a groupKeys().
  const groups = groupCostsKeysAuto_(keysAll);

  const used = new Set();
  let html = "";

  for(const g of (groups||[])){
    const label = String(g?.title || "Sección").trim() || "Sección";
    const raw = Array.isArray(g?.keys) ? g.keys : [];
    const uniq = [];
    for(const k0 of raw){
      const k = String(k0||"").trim();
      if(!k) continue;
      if(used.has(k)) continue;
      if(!keysAll.includes(k)) continue;
      used.add(k);
      uniq.push(k);
    }
    if(!uniq.length) continue;

    html += `<optgroup label="${escapeHtmlAttr(label)}">` + uniq.map(k=>`<option value="${escapeHtmlAttr(k)}">${escapeHtml(k)}</option>`).join("") + `</optgroup>`;
  }

  const rest = keysAll.filter(k => !used.has(k));
  if(rest.length){
    html += `<optgroup label="(Sin sección)">` + rest.map(k=>`<option value="${escapeHtmlAttr(k)}">${escapeHtml(k)}</option>`).join("") + `</optgroup>`;
  }

  sel.innerHTML = html;

  if(current && keysAll.includes(current)) sel.value = current;
  else if(keysAll.length) sel.value = keysAll[0];
}





function refreshIngredientSectionsSelect_(){
  const secSel = el("ingNewSection");
  if(!secSel) return;
  const base = Array.isArray(window.AMARED_COSTS_SECTIONS) ? window.AMARED_COSTS_SECTIONS.map(s=>String(s.title||"").trim()).filter(Boolean) : [];
  const extra = [];
  for(const k of Object.keys(state.costsByKey||{})){
    const t = String(state.costsByKey?.[k]?.section_title || state.costsByKey?.[k]?.section || "").trim();
    if(t) extra.push(t);
  }
  const uniq = Array.from(new Set(["(Sin asignar)"].concat(base).concat(extra)));
  secSel.innerHTML = uniq.map(t=>{
    const val = (t==="(Sin asignar)") ? "" : t;
    return `<option value="${escapeHtmlAttr(val)}">${escapeHtml(t)}</option>`;
  }).join("");
}
function openIngConfirm(key){
  ingDeletePendingKey = String(key||"").trim();
  if(el("ingConfirmName")) el("ingConfirmName").textContent = ingDeletePendingKey || "—";
  if(el("ingConfirmCountdown")) el("ingConfirmCountdown").textContent = "";
  ingDeleteCountdown = 2;

  const btn = el("ingConfirmGo");
  if(btn){
    btn.disabled = true;
    btn.textContent = `Eliminar (${ingDeleteCountdown})`;
  }
  show(el("ingConfirmBack"));

  if(ingDeleteTimer) clearInterval(ingDeleteTimer);
  ingDeleteTimer = setInterval(()=>{
    ingDeleteCountdown -= 1;
    const b = el("ingConfirmGo");
    if(!b) return;
    if(ingDeleteCountdown > 0){
      b.disabled = true;
      b.textContent = `Eliminar (${ingDeleteCountdown})`;
    }else{
      b.disabled = false;
      b.textContent = "Eliminar";
      clearInterval(ingDeleteTimer);
      ingDeleteTimer = null;
    }
  }, 1000);
}

function closeIngConfirm(){
  if(ingDeleteTimer) clearInterval(ingDeleteTimer);
  ingDeleteTimer = null;
  ingDeleteCountdown = 0;
  ingDeletePendingKey = "";
  hide(el("ingConfirmBack"));
}
function normalizeUnitType_(u){
  const t = String(u||"").trim().toLowerCase();
  if(t==="g"||t==="gr"||t==="gramo"||t==="gramos") return "g";
  if(t==="ml"||t==="mililitro"||t==="mililitros") return "ml";
  if(t==="m"||t==="mt"||t==="mts"||t==="metro"||t==="metros") return "m";
  if(t==="u"||t==="und"||t==="unidad"||t==="unidades") return "unidad";
  return t;
}

async function addIngredient(){
  if(state.ingBusy) return;
  state.ingBusy = true;
  const btn = el("btnAddIng"); if(btn) btn.disabled = true;
  showLoading("Publicando ingrediente…","Guardando en COSTOS_INGREDIENTES e INVENTARIO.");

  const key = String(el("ingNewKey")?.value||"").trim();
  const unit_type = normalizeUnitType_(el("ingNewUnit")?.value||"");
  const section_title = String(el("ingNewSection")?.value||"").trim();
  const unit_item_qty_raw = String(el("ingUnitItemQty")?.value||"").trim();
  const unit_item_qty = unit_item_qty_raw ? Number(unit_item_qty_raw.replace(",", ".")) : null;
  const unit_item_qty_type = normalizeUnitType_(el("ingUnitItemQtyType")?.value||"");

  if(!key) throw new Error("Escribe el nombre del ingrediente.");
  if(!unit_type || !["g","ml","m","unidad"].includes(unit_type)) throw new Error("Selecciona un tipo válido (g/ml/m/unidad).");
  if(unit_item_qty_raw && !(unit_item_qty>0)) throw new Error("Cantidad por unidad inválida.");
  if(unit_item_qty_raw && !["g","ml","m"].includes(unit_item_qty_type)) throw new Error("Selecciona g, ml o m en “Cantidad por unidad”.");

  try{
  await api({
    action:"ingredient_add",
    costs_secret: UNLOCKED_SECRET,
    ingredient_key: key,
    unit_type,
    section_title,
    unit_item_qty: unit_item_qty_raw ? unit_item_qty : "",
    unit_item_qty_type: unit_item_qty_raw ? unit_item_qty_type : ""
  });

  // refrescar costos/inventario para que aparezca de inmediato
  await loadAll();
  // ✅ si el modal de ingredientes está abierto, actualiza el select al instante
  const back = el("ingModalBack");
  if(back && !back.classList.contains("hidden")) { refreshIngredientSelect_(); refreshIngredientSectionsSelect_(); }
  // ✅ si hay un postre activo en Recetas, re-render para incluir el nuevo ingrediente
  if(state.view==="recipes" && state.ui && state.ui.activeDessert) renderDessertPanel_(state.ui.activeDessert);

  } finally {
    hideLoading();
    state.ingBusy = false;
    const btn2 = el("btnAddIng"); if(btn2) btn2.disabled = false;
  }
  if(el("ingNewKey")) el("ingNewKey").value = "";
  if(el("ingUnitItemQty")) el("ingUnitItemQty").value = "";
  if(el("ingUnitItemQtyType")) el("ingUnitItemQtyType").value = "";
  if(el("ingAddMsg")) el("ingAddMsg").textContent = "Ingrediente agregado con éxito.";
  setGlobalMsg("✅ Ingrediente agregado.", false);
}

async function deleteIngredientByKey_(key){
  const k = String(key||"").trim();
  if(!k) throw new Error("Selecciona un ingrediente.");
  await api({ action:"ingredient_delete", costs_secret: UNLOCKED_SECRET, ingredient_key: k });
  await loadAll();
  const back = el("ingModalBack");
  if(back && !back.classList.contains("hidden")) { refreshIngredientSelect_(); refreshIngredientSectionsSelect_(); }
  if(state.view==="recipes" && state.ui && state.ui.activeDessert) renderDessertPanel_(state.ui.activeDessert);
}

async function deleteIngredient(){
  if(state.ingBusy) return;
  state.ingBusy = true;
  const btn = el("btnDelIng"); if(btn) btn.disabled = true;
  showLoading("Eliminando ingrediente…","Actualizando base de datos.");
      await new Promise(r=>setTimeout(r, 60));

  const key = String(el("ingSelect")?.value||"").trim();
  if(!key) throw new Error("Selecciona un ingrediente.");
  // Confirmación se maneja en el modal (openIngConfirm)
  try{
  await deleteIngredientByKey_(key);
  } finally {
    hideLoading();
    state.ingBusy = false;
    const btn2 = el("btnDelIng"); if(btn2) btn2.disabled = false;
  }
  if(el("ingDelMsg")) el("ingDelMsg").textContent = "Ingrediente eliminado.";
  setGlobalMsg("✅ Ingrediente eliminado.", false);
}
function normalizeCatalogType_(type){
  const t = String(type||"").trim().toLowerCase();
  if(t === "stores" || t === "store" || t === "tiendas") return "store";
  if(t === "brands" || t === "brand" || t === "marcas") return "brand";
  return t;
}

async function addCatalogValue(type, value){
  const v = String(value||"").trim();
  if(!v) throw new Error("Valor vacío.");
  const t = normalizeCatalogType_(type);
  await api({ action:"catalog_add", costs_secret: UNLOCKED_SECRET, type: t, value: v });
  await refreshCatalogs();
}

async function deleteCatalogValue(type, value){
  const v = String(value||"").trim();
  if(!v) throw new Error("Selecciona un valor.");
  const t = normalizeCatalogType_(type);
  await api({ action:"catalog_delete", costs_secret: UNLOCKED_SECRET, type: t, value: v });
  await refreshCatalogs();
}


function resetRecipesAuth_(){
  state.recipesPinUnlocked = false;
  state.recipesPin = "";
  state.desserts = [];
  // (no se guarda el código entre recargas)
}

// =============== Recetas (admin) ===============
function getStoredRecipesPin_(){
  try{ return String(localStorage.getItem("amared_recipes_pin")||""); }catch(_e){ return ""; }
}
function storeRecipesPin_(pin){
  try{ localStorage.setItem("amared_recipes_pin", String(pin||"")); }catch(_e){}
}

async function validateRecipesPin_(pin){
  const p = String(pin||"").trim();
  if(!p) return false;
  try{
    const out = await api({ action:"recipes_pin_check", costs_secret: UNLOCKED_SECRET, recipes_pin: p }, {timeoutMs: 15000});
    return !!out.valid;
  }catch(_e){
    return false;
  }
}

function openRecipesUnlock_(msg){
  if(el("recipesUnlockMsg")) el("recipesUnlockMsg").textContent = msg || "";
  if(el("recipesPinInput")) el("recipesPinInput").value = "";
  show(el("recipesUnlockBack"));
  setTimeout(()=>{ el("recipesPinInput")?.focus(); }, 60);
}
function closeRecipesUnlock_(){ hide(el("recipesUnlockBack")); }

async function doRecipesUnlock_(silent=false){
  if(!UNLOCKED_SECRET){
    openUnlock("Ingresa tu COSTS_SECRET para validar el código de Recetas.");
    return false;
  }

  const pin = String(el("recipesPinInput")?.value || "").trim();
  if(!pin){
    openRecipesUnlock_("Escribe el código de Recetas.");
    return false;
  }

  const btn = el("btnDoRecipesUnlock");
  if(btn){ btn.disabled = true; btn.textContent = "Validando…"; }

  showLoading("Validando…","Verificando código de Recetas.");
  try{
    const ok = await validateRecipesPin_(pin);
    if(!ok){
      if(el("recipesUnlockMsg")) el("recipesUnlockMsg").textContent = "Código inválido.";
      el("recipesPinInput")?.focus();
      return false;
    }

    state.recipesPinUnlocked = true;
    state.recipesPin = pin;

    // Cargar datos base y RECETAS
    try{ await loadAll(); }catch(_e){}
    try{ await loadDessertsFromSheet_(); }catch(_e){}

    closeRecipesUnlock_();
    show(el("viewRecipes"));
    renderRecipesView_();
    return true;
  } finally {
    hideLoading();
    if(btn){ btn.disabled = false; btn.textContent = "Entrar"; }
  }
}

async function ensureRecipesUnlocked_(){
  // Requiere COSTS_SECRET (base)
  if(!UNLOCKED_SECRET){
    openUnlock("Ingresa tu COSTS_SECRET para acceder a Recetas.");
    setView("purchases");
    return;
  }

  // ✅ Si ya se validó el código en esta sesión, NO volver a pedirlo
  if(state.recipesPinUnlocked && state.recipesPin){
    try{
      show(el("viewRecipes"));
      renderRecipesView_();
    }catch(_e){}
    return;
  }

  // Preparar UI mínima (evita pantalla vacía)
  try{
    setRecipesMeta_("Bloqueado: ingresa el código de Recetas.");
    if(el("dessertList")) el("dessertList").innerHTML = `<div class="hint">Ingresa el código para ver postres.</div>`;
    if(el("recipeEditor")) el("recipeEditor").innerHTML = ``;
    if(el("btnRecipeSave")) el("btnRecipeSave").disabled = true;
    if(el("recipeEditorTitle")) el("recipeEditorTitle").textContent = "Acceso protegido";
    if(el("recipeEditorSub")) el("recipeEditorSub").textContent = "Ingresa el código de Recetas para continuar.";
  }catch(_e){}

  // Ocultar vista hasta validar y mostrar modal
  hide(el("viewRecipes"));
  openRecipesUnlock_("");
}

function collectDessertIds_(){
  const set = new Set();

  // 1) Desde POSTRES (sheet)
  ((state.dessertsRaw||state.desserts)||[]).forEach(d=>{
    const id = String(d.dessert_id || d.id || "").trim();
    if(id) set.add(id);
  });

  // 2) Desde RECETAS existentes
  Object.keys(state.recipesByDessert||{}).forEach(id=>set.add(id));

  // 3) Desde pedidos (por si llega un postre nuevo)
  Object.keys(state.ordersByDessert||{}).forEach(id=>set.add(id));
  const late = state.late?.orders_by_dessert || state.late?.ordersByDessert || {};
  Object.keys(late||{}).forEach(id=>set.add(id));

  return Array.from(set).filter(Boolean);
}

function getDraftMap_(dessertId){
  state.ui.recipeDraftByDessert = state.ui.recipeDraftByDessert || {};
  if(!state.ui.recipeDraftByDessert[dessertId]){
    const seed = {};
    const rows = state.recipesByDessert?.[dessertId] || [];
    for(const r of rows){
      const kRaw = String(r.ingredient_key||"").trim();
      const nk = normKey_(kRaw);
      if(!nk) continue;
      seed[nk] = { use:true, qty: parseNumFlex_(r.qty_per_unit||0), unit: String(r.unit||"").trim(), rawKey: kRaw };
    }
    state.ui.recipeDraftByDessert[dessertId] = seed;
  }
  return state.ui.recipeDraftByDessert[dessertId];
}


async function loadDessertsFromSheet_(){
  if(!UNLOCKED_SECRET) return;
  try{
    const out = await api({ action:"desserts_list", costs_secret: UNLOCKED_SECRET, recipes_pin: state.recipesPin }, {timeoutMs: 20000});
    // Guardamos RAW (incluye activos/inactivos)
    state.dessertsRaw = Array.isArray(out.items) ? out.items : [];

    // Sync: si está inactivo en POSTRES -> ocultarlo siempre en Recetas
    try{
      state.ui = state.ui || {};
      state.ui.deletedDessertsMap = state.ui.deletedDessertsMap || {};
      const map = state.ui.deletedDessertsMap;

      for(const d of state.dessertsRaw){
        const id = String(d.dessert_id || d.id || "").trim();
        if(!id) continue;
        const key = id.toLowerCase();
        const a = String(d.active ?? "1").trim().toLowerCase();
        const isActive = !(a === "0" || a === "false");

        if(!isActive){
          if(!Object.prototype.hasOwnProperty.call(map, key)){
            map[key] = Date.now();
          }
          continue;
        }

        // Si está activo, solo quitamos el tombstone si fue restaurado después del borrado.
        if(Object.prototype.hasOwnProperty.call(map, key)){
          const ts = Number(map[key] || 0);
          const upd = Date.parse(String(d.updated_at || d.updatedAt || "").trim());
          if(isFinite(upd) && isFinite(ts) && upd > ts){
            delete map[key];
          }
        }
      }

      state.ui.deletedDessertsMap = map;
      saveDeletedDesserts_();
    }catch(_e){}

    // Lista para UI: SOLO activos
    state.desserts = (state.dessertsRaw||[]).filter(d=>{
      const id = String(d.dessert_id || d.id || "").trim();
      const a = String(d.active ?? "1").trim().toLowerCase();
      return !(a === "0" || a === "false") && !isDessertHardDisabled_(id);
    });

    // Cache set de inactivos para filtrar "extras" (p.ej. postres viejos en pedidos)
    try{
      const s = new Set();
      for(const d of (state.dessertsRaw||[])){
        const id0 = String(d.dessert_id || d.id || "").trim().toLowerCase();
        if(!id0) continue;
        const a0 = String(d.active ?? "1").trim().toLowerCase();
        const isActive0 = !(a0 === "0" || a0 === "false");
        if(!isActive0 || isDessertHardDisabled_(id0)) s.add(id0);
      }
      state.inactiveDessertsSet = s;
    }catch(_e){
      state.inactiveDessertsSet = state.inactiveDessertsSet || new Set();
    }
  }catch(_e){
    state.dessertsRaw = state.dessertsRaw || state.desserts || [];
    state.desserts = (state.desserts||[]);
  }
}


function slugifyDessertId_(name){
  let s = String(name||"").trim().toLowerCase();
  s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); // quita acentos
  s = s.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g,"");
  if(!s) s = "postre";
  return s;
}

function openDessertModal_(){
  if(el("dessertCreateMsg")) el("dessertCreateMsg").textContent = "";
  if(el("dessertNameInput")) el("dessertNameInput").value = "";
  if(el("dessertIdInput")) el("dessertIdInput").value = "";
  show(el("dessertModalBack"));
  setTimeout(()=> el("dessertNameInput")?.focus(), 50);
}
function closeDessertModal_(){
  hide(el("dessertModalBack"));
}

// ✅ Compat: si existe modal/botón de eliminar postre en tu versión, evitamos ReferenceError
let DESSERT_DELETE_ID = null;
let DESSERT_DELETE_INT = null;
let DESSERT_DELETE_LEFT = 0;

function ensureDessertDeleteDom_(){
  if(el("dessertDeleteBack")) return;
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div class="modalOverlay hidden" id="dessertDeleteBack">
      <div class="modal" style="width:min(520px, 92vw);">
        <div class="modalHeader">
          <div>
            <div class="modalTitle" style="font-weight:950;">⚠️ Confirmar eliminación</div>
            <div class="modalSub" style="margin-top:4px;">Esto desactivará el postre y eliminará su receta en <b>RECETAS</b>.</div>
          </div>
        </div>
        <div class="modalBody">
          <div class="pCatBox" style="margin:0;">
            <div class="k" style="font-weight:950;">Postre</div>
            <div id="dessertConfirmName" style="margin-top:6px; font-weight:900;"></div>
            <div class="hint confirmHint" style="margin-top:8px;">Espera 3 segundos para habilitar “Eliminar”.</div>
            <div class="pSmallMeta" id="dessertConfirmCountdown" style="margin-top:10px; color:#7a2b00;"></div>
            <div class="pSmallMeta" id="dessertConfirmErr" style="margin-top:8px; color:#7a2b00;"></div>
            <div class="confirmBtns" style="margin-top:12px; display:flex; gap:10px; justify-content:flex-end; flex-wrap:wrap;">
              <button class="btn secondary" id="dessertConfirmCancel">Cancelar</button>
              <button class="btn" disabled id="dessertConfirmGo" style="background:rgba(242,91,143,.15); border-color:rgba(242,91,143,.35);">Eliminar</button>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(wrap.firstElementChild);
}

function openDessertDeleteModal_(dessertId){
  ensureDessertDeleteDom_();
  const did = String(dessertId || state.ui.activeDessert || "").trim();
  if(!did) return;

  DESSERT_DELETE_ID = did;
  if(el("dessertConfirmName")) el("dessertConfirmName").textContent = prettyDessertName(did);
  if(el("dessertConfirmErr")) el("dessertConfirmErr").textContent = "";

  const back = el("dessertDeleteBack");
  const btnGo = el("dessertConfirmGo");
  const cd = el("dessertConfirmCountdown");
  if(btnGo) btnGo.disabled = true;

  DESSERT_DELETE_LEFT = 3;
  if(cd) cd.textContent = `Puedes eliminar en ${DESSERT_DELETE_LEFT}s…`;

  show(back);

  if(DESSERT_DELETE_INT) clearInterval(DESSERT_DELETE_INT);
  DESSERT_DELETE_INT = setInterval(()=>{
    DESSERT_DELETE_LEFT = Math.max(0, (DESSERT_DELETE_LEFT||0) - 1);
    if(cd) cd.textContent = DESSERT_DELETE_LEFT ? `Puedes eliminar en ${DESSERT_DELETE_LEFT}s…` : "Listo. Ya puedes eliminar.";
    if(!DESSERT_DELETE_LEFT){
      if(btnGo) btnGo.disabled = false;
      clearInterval(DESSERT_DELETE_INT);
      DESSERT_DELETE_INT = null;
    }
  }, 1000);
}

function closeDessertDeleteModal_(){
  if(DESSERT_DELETE_INT) clearInterval(DESSERT_DELETE_INT);
  DESSERT_DELETE_INT = null;
  DESSERT_DELETE_LEFT = 0;
  DESSERT_DELETE_ID = null;
  hide(el("dessertDeleteBack"));
}

function dropDessertFromState_(dessertId){
  const did = String(dessertId||"").trim();
  if(!did) return;

  // Remove from desserts arrays
  try{
    state.dessertsRaw = (state.dessertsRaw||[]).filter(d=>String(d.dessert_id||d.id||"").trim() !== did);
  }catch(_e){}
  try{
    state.desserts = (state.desserts||[]).filter(d=>String(d.dessert_id||d.id||"").trim() !== did);
  }catch(_e){}

  // Remove recipes
  try{
    if(state.recipesByDessert && state.recipesByDessert[did]) delete state.recipesByDessert[did];
  }catch(_e){}

  // Remove drafts
  try{
    if(state.ui && state.ui.recipeDraftByDessert && state.ui.recipeDraftByDessert[did]) delete state.ui.recipeDraftByDessert[did];
  }catch(_e){}

  // Remove from orders (so it doesn't “revive” in UI) — case-insensitive
  try{
    const target = did.toLowerCase();
    if(state.ordersByDessert){
      for(const k of Object.keys(state.ordersByDessert||{})){
        if(String(k||"").toLowerCase() === target) delete state.ordersByDessert[k];
      }
    }
  }catch(_e){}
  try{
    const target = did.toLowerCase();
    const late = state.late?.orders_by_dessert || state.late?.ordersByDessert;
    if(late){
      for(const k of Object.keys(late||{})){
        if(String(k||"").toLowerCase() === target) delete late[k];
      }
    }
  }catch(_e){}
}


async function confirmDessertDelete_(){
  const did = String(DESSERT_DELETE_ID || "").trim();
  if(!did) return;

  const btnGo = el("dessertConfirmGo");
  if(btnGo) btnGo.disabled = true;

  showLoading("Eliminando…","Actualizando base de datos.");
  try{
    const out = await api({
      action: "dessert_delete",
      costs_secret: UNLOCKED_SECRET,
      recipes_pin: state.recipesPin,
      dessert_id: did,
      updated_by: "RECIPES_UI"
    }, {timeoutMs: 45000});

    if(!out?.ok){
      throw new Error(out?.error || "No se pudo eliminar el postre.");
    }

    // Verificar que el servidor dejó el postre INACTIVO en POSTRES (para que no reaparezca en otros dispositivos)
    try{ await loadDessertsFromSheet_(); }catch(_e){}
    const raw = (state.dessertsRaw||[]).find(d=>String(d.dessert_id||d.id||"").trim().toLowerCase()===String(did).trim().toLowerCase());
    const a = String(raw?.active ?? "1").trim().toLowerCase();
    const inactive = (!raw) ? true : (a === "0" || a === "false");
    if(!inactive){ throw new Error("No se pudo desactivar en la base de datos. Revisa que Webhook/Worker estén desplegados."); }

    closeDessertDeleteModal_();
    dropDessertFromState_(did);
    // refrescar recetas + UI
    try{ await loadRecipesFromSheet_(); }catch(_e){}
    state.ui.activeDessert = "";
    state.ui.ingredient_q = "";
    renderRecipesView_();

    // refrescar compras/costos para que deje de aparecer en tablas
    try{ await refreshAll(); }catch(_e){}
  }catch(e){
    if(el("dessertConfirmErr")) el("dessertConfirmErr").textContent = String(e.message||e);
  }finally{
    hideLoading();
    if(btnGo) btnGo.disabled = false;
  }
}

async function createDessert_(){
  const name = String(el("dessertNameInput")?.value||"").trim();
  let id = String(el("dessertIdInput")?.value||"").trim();
  if(!name) throw new Error("Escribe el nombre del postre.");
  if(!id) id = slugifyDessertId_(name);
  id = slugifyDessertId_(id);

  showLoading("Creando…","Guardando postre.");
  try{
    const out = await api({
      action:"dessert_add",
      costs_secret: UNLOCKED_SECRET,
      recipes_pin: state.recipesPin,
      dessert_id: id,
      dessert_name: name
    }, {timeoutMs: 30000});

    if(!out?.ok){
      // Si estaba eliminado en servidor, intenta restaurar (depende de Webhook actualizado)
      const msg = String(out?.error || out?.marker || "No se pudo crear el postre.");
      throw new Error(msg);
    }


    // si estaba marcado como eliminado, lo restauramos en UI
    unmarkDessertDeleted_(id);

    await loadDessertsFromSheet_();
    // seleccionar el nuevo postre
    state.ui.activeDessert = id;
    // reset draft
    state.ui.recipeDraftByDessert = state.ui.recipeDraftByDessert || {};
    delete state.ui.recipeDraftByDessert[id];

    closeDessertModal_();
    renderRecipesView_();
    try{ await refreshAll(); }catch(_e){}
  } finally {
    hideLoading();
  }
}
function renderDessertList_(){
  const box = el("dessertList");
  if(!box) return;
  const q = String(state.ui.dessert_q||"").trim().toLowerCase();
  const ids = collectDessertIds_();

  // estado (active) desde hoja POSTRES (case-insensitive) + tombstones locales
  const activeMap = {};
  ((state.dessertsRaw||state.desserts)||[]).forEach(d=>{
    const id = String(d.dessert_id || d.id || "").trim();
    if(!id) return;
    const a = String(d.active ?? "1").trim().toLowerCase();
    activeMap[id.toLowerCase()] = !(a === "0" || a === "false");
  });

  const rows = ids
    .map(id=>{
      const name = prettyDessertName(id);
      const cnt = (state.recipesByDessert?.[id]||[]).length;
      const key = String(id||"").trim().toLowerCase();
      const isActive = (activeMap[key] !== false) && !isDessertLocallyDeleted_(key); // ocultar si está inactivo o eliminado
      return { id, name, cnt, isActive };
    })
    .filter(x=>x.isActive)
    .filter(x=> !q || x.name.toLowerCase().includes(q) || x.id.toLowerCase().includes(q))
    .sort((a,b)=>{
      if(a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      return a.name.localeCompare(b.name,"es");
    });

  box.innerHTML = rows.map(r=>{
    const open = (String(state.ui.activeDessert||"") === r.id);
    const subBase = r.cnt ? `${r.cnt} ingrediente(s) configurado(s)` : `sin receta aún`;
    const sub = r.isActive ? subBase : (`INACTIVO · ` + subBase);
    const chev = open ? "▾" : "▸";
    return `
      <div class="pDessertCard ${open?"isOpen":""} ${r.isActive?"":"isInactive"}" data-did="${escapeHtmlAttr(r.id)}">
        <div class="pDessertHead" role="button" tabindex="0">
          <div class="pDessertStripe"></div>
          <div class="pDessertTitle">
            <div class="name">${escapeHtml(r.name)}</div>
            <div class="sub">${escapeHtml(sub)}</div>
          </div>
          <div class="pDessertMeta">
            <div class="pDessertCount">${r.cnt || 0}</div>
            <div class="pDessertChevron" aria-hidden="true">${chev}</div>
          </div>
        </div>

        <div class="pDessertPanel ${open?"":"hidden"}" id="dessertPanel_${escapeHtmlAttr(r.id)}">
          ${open ? renderDessertPanelShell_(r.id) : ""}
        </div>
      </div>`;
  }).join("") || `<div class="hint">Sin postres.</div>`;

  const did = String(state.ui.activeDessert||"").trim();
  if(did){
    renderDessertPanel_(did);
  }
}


function renderDessertPanelShell_(dessertId){
  const name = prettyDessertName(dessertId);
  return `
    <div class="pDessertPanelTop">
      <div>
        <div class="cardTitle" style="margin:0;">Editar receta: ${escapeHtml(name)}</div>
        <div class="hint">Activa ingredientes (switch) y define cantidades por unidad.</div>
      </div>
      <div style="display:flex; gap:10px; flex-wrap:wrap; justify-content:flex-end;"><button class="btn secondary" data-act="delete_dessert" style="background:rgba(242,91,143,.12); border-color:rgba(242,91,143,.35);">Eliminar</button><button class="btn primary" data-act="save_recipe">Guardar receta</button></div>
    </div>

    <div class="pDessertPanelControls" style="margin-top:10px;">
      <input class="input" data-act="ing_search" placeholder="Buscar ingrediente…" />
    </div>

    <div class="pDessertPanelScroll">
      <div class="pGroups" data-act="recipe_editor" style="margin-top:12px;"></div>
    </div>
  `;
}

function bindInlineRecipeEditor_(panel, dessertId){
  if(!panel || panel.__bound) return;
  panel.__bound = true;

  const getEditor = ()=> panel.querySelector('[data-act="recipe_editor"]');

  // Guardar receta / eliminar postre
  panel.addEventListener('click', (e)=>{
    const del = e.target.closest('[data-act="delete_dessert"]');
    if(del){
      openDessertDeleteModal_(dessertId);
      return;
    }
    const btn = e.target.closest('[data-act="save_recipe"]');
    if(!btn) return;
    saveRecipe_().catch(err=> setRecipesMeta_(String(err?.message||err)));
  });

  // Buscar ingrediente + editar cantidad
  panel.addEventListener('input', (e)=>{
    const search = e.target.closest('[data-act="ing_search"]');
    if(search){
      state.ui.ingredient_q = String(search.value||'');
      renderRecipeEditor_(getEditor());
      return;
    }

    const qtyInp = e.target.closest('[data-act="r_qty"]');
    if(qtyInp){
      const row = qtyInp.closest('.pRecipeRow');
      if(!row) return;
      const nk = String(row.getAttribute('data-nk')||'');
      const kRaw = String(row.getAttribute('data-kraw')||'');
      if(!nk || !kRaw) return;

      const did = String(state.ui.activeDessert||'');
      if(!did) return;

      const draft = getDraftMap_(did);
      draft[nk] = draft[nk] || { use:false, qty:'', unit:getUnitFor(kRaw), rawKey:kRaw };
      draft[nk].rawKey = kRaw;
      draft[nk].qty = String(qtyInp.value||'').replace(',', '.');
      return;
    }
  });

  // Toggle ingrediente
  panel.addEventListener('change', (e)=>{
    const toggle = e.target.closest('[data-act="r_toggle"]');
    if(!toggle) return;

    const row = toggle.closest('.pRecipeRow');
    if(!row) return;

    const nk = String(row.getAttribute('data-nk')||'');
    const kRaw = String(row.getAttribute('data-kraw')||'');
    if(!nk || !kRaw) return;

    const did = String(state.ui.activeDessert||'');
    if(!did) return;

    const draft = getDraftMap_(did);
    draft[nk] = draft[nk] || { use:false, qty:'', unit:getUnitFor(kRaw), rawKey:kRaw };
    draft[nk].rawKey = kRaw;
    draft[nk].use = !!toggle.checked;

    row.classList.toggle('isOn', draft[nk].use);
    row.classList.toggle('isOff', !draft[nk].use);

    const sw = row.querySelector('.switchWrap');
    if(sw){
      sw.classList.toggle('isOn', draft[nk].use);
      sw.classList.toggle('isOff', !draft[nk].use);
      const meta = sw.querySelector('.meta');
      if(meta) meta.textContent = draft[nk].use ? 'Incluido' : 'No';
    }

    const qty = row.querySelector('input.qty');
    if(qty) qty.disabled = !draft[nk].use;

    if(draft[nk].use){
      const qn = parseNumFlex_(draft[nk].qty);
      if(!(qn>0)){
        draft[nk].qty = 1;
        if(qty) qty.value = '1';
      }
    }
  });
}

function getActiveRecipeEditorEl_(){
  const did = String(state.ui.activeDessert||"").trim();
  if(did){
    const p = el('dessertPanel_' + did);
    const box = (p && p.querySelector) ? p.querySelector('[data-act="recipe_editor"]') : null;
    if(box) return box;
  }
  return null;
}

function renderDessertPanel_(dessertId){
  const panel = el('dessertPanel_' + dessertId);
  if(!panel) return;

  // mount shell if needed
  if(!panel.querySelector('[data-act="recipe_editor"]')){
    panel.innerHTML = renderDessertPanelShell_(dessertId);
  }

  // seed search input
  const search = panel.querySelector('[data-act="ing_search"]');
  if(search) search.value = String(state.ui.ingredient_q||'');

  bindInlineRecipeEditor_(panel, dessertId);

  const ed = panel.querySelector('[data-act="recipe_editor"]');
  renderRecipeEditor_(ed);
}

function renderRecipeEditor_(editorEl){
  const did = String(state.ui.activeDessert||"").trim();
  const editor = editorEl || getActiveRecipeEditorEl_() || el("recipeEditor");

  if(!did){
    if(editor) editor.innerHTML = "";
    return;
  }

  const draft = getDraftMap_(did);
  const q = String(state.ui.ingredient_q||"").trim().toLowerCase();

  const keys = Object.keys(state.costsByKey||{}).sort((a,b)=>a.localeCompare(b,"es"));
  const filtered = keys.filter(k => !q || k.toLowerCase().includes(q));

  const rows = filtered.map(kRaw=>{
    const nk = normKey_(kRaw);
    const d = draft[nk] || { use:false, qty:"", unit:getUnitFor(kRaw), rawKey:kRaw };
    if(!d.rawKey) d.rawKey = kRaw;

    const unit = String(d.unit || getUnitFor(kRaw) || "g");
    const checked = !!d.use;
    const qtyVal = (d.qty!=="" && d.qty!=null) ? String(d.qty).replace(".", ",") : "";

    return `
      <div class="pRecipeRow ${checked?"isOn":"isOff"}" data-nk="${escapeHtmlAttr(nk)}" data-kraw="${escapeHtmlAttr(kRaw)}">
        <label class="switchWrap ${checked?"isOn":"isOff"}">
          <input class="switchInput" type="checkbox" data-act="r_toggle" ${checked?"checked":""} />
          <span class="switch" aria-hidden="true"></span>
          <span class="meta">${checked ? "Incluido" : "No"}</span>
        </label>

        <div class="name">
          ${escapeHtml(kRaw)}
          <div class="meta">Unidad: <b>${escapeHtml(unit)}</b></div>
        </div>

        <input class="input qty" data-act="r_qty" type="text" inputmode="decimal" placeholder="Cantidad" value="${escapeHtmlAttr(qtyVal)}" ${checked?"":"disabled"} />
      </div>`;
  }).join("");

  if(editor) editor.innerHTML = rows || `<div class="hint">No hay ingredientes.</div>`;
}

function setRecipesMeta_(txt){
  const m = el("recipesMeta");
  if(m) m.textContent = txt || "";
}

function renderRecipesView_(){
  setRecipesMeta_(state.recipesSource === "sheet" ? "Fuente: RECETAS (hoja)" : "Fuente: receta embebida (fallback)");
  renderDessertList_();
  renderRecipeEditor_();
}

async function saveRecipe_(){
  const did = String(state.ui.activeDessert||"").trim();
  if(!did) return;
  const draft = getDraftMap_(did);

  const items = [];
  for(const [nk,v] of Object.entries(draft)){
    if(!v || !v.use) continue;
    const qty = parseNumFlex_(v.qty);
    if(!(qty>0)) continue;
    const unit = String(v.unit || "").trim().toLowerCase();
    const kRaw = String(v.rawKey || "").trim();
    if(!kRaw || !unit) continue;
    items.push({ ingredient_key: kRaw, qty_per_unit: qty, unit });
  }

  showLoading("Guardando…","Actualizando RECETAS.");
  try{
    await api({ action: "recipes_set", costs_secret: UNLOCKED_SECRET, recipes_pin: state.recipesPin, dessert_id: did, dessert_name: prettyDessertName(did), items }, {timeoutMs: 45000});
    await loadRecipesFromSheet_();
    // Clasificar secciones automáticamente (sin botón manual)
    try{ await autoClassifyCostsSections_(); }catch(_e){}
    setRecipesMeta_("Receta guardada con éxito.");
  } finally { hideLoading(); }
}

function joinNames_(names){
  const arr = (names||[]).filter(Boolean);
  if(arr.length<=1) return arr[0]||"";
  if(arr.length===2) return `${arr[0]} y ${arr[1]}`;
  return arr.slice(0,-1).join(", ") + " y " + arr[arr.length-1];
}

function computeAutoSections_(){
  const dessertIds = collectDessertIds_();
  const names = dessertIds.map(id=>prettyDessertName(id));
  const n = dessertIds.length;
  const fullMask = (1<<n) - 1;

  const mem = {};
  dessertIds.forEach((did, idx)=>{
    const rows = state.recipesByDessert?.[did] || [];
    for(const r of rows){
      const k = String(r.ingredient_key||"").trim();
      if(!k) continue;
      mem[k] = (mem[k] || 0) | (1<<idx);
    }
  });

  const out = [];
  for(const k of Object.keys(mem)){
    const mask = mem[k];
    const inIdx = [];
    for(let i=0;i<n;i++){ if(mask & (1<<i)) inIdx.push(i); }
    const inNames = inIdx.map(i=>names[i]);

    let title = "";
    if(mask === fullMask) title = "Ingredientes que comparten todos los postres";
    else if(inIdx.length > 1) title = "Ingredientes que comparten " + joinNames_(inNames);
    else title = "Ingredientes para " + (inNames[0] || "Postre");

    out.push({ ingredient_key: k, section_title: title });
  }
  return out;
}

async function autoClassifyCostsSections_(){
  showLoading("Clasificando…","Actualizando secciones en COSTOS_INGREDIENTES.");
  try{
    const items = computeAutoSections_();
    await api({ action:"costs_sections_set", costs_secret: UNLOCKED_SECRET, recipes_pin: state.recipesPin, items }, {timeoutMs: 45000});
    await loadAll();
    setRecipesMeta_("Secciones actualizadas con éxito.");
  } finally { hideLoading(); }
}

// =============== Events ===============
function captureOpenGroupsFromDOM_(){
  state.ui.openGroups = state.ui.openGroups || {};
  const captureFrom = (cid)=>{
    const root = el(cid);
    if(!root) return;
    const dets = Array.from(root.querySelectorAll('details.pGroup[data-gid]'));
    for(const d of dets){
      const gid = String(d.getAttribute("data-gid")||"").trim();
      if(!gid) continue;
      state.ui.openGroups[gid] = !!d.open;
    }
  };
  captureFrom("groups");
  captureFrom("costGroups");
}

function forceCloseDetailsOnLoad_(){
  try{
    state.ui.openGroups = {};
    const admin = el("adminListDetails");
    if(admin) admin.open = false;
    const roots = ["groups","costGroups"];
    for(const id of roots){
      const root = el(id);
      if(!root) continue;
      const dets = root.querySelectorAll('details.pGroup[data-gid]');
      dets.forEach(d => { d.open = false; });
    }
  }catch(_e){}
}


function bind(){
  // Buttons
  el("btnExit")?.addEventListener("click", logout);
  el("btnReload")?.addEventListener("click", async ()=>{
  showLoading("Actualizando…","Leyendo datos.");
  try{
    await loadAll();
    // si estás en Recetas y ya validaste PIN, refresca también el listado de postres
    if(state.view==="recipes" && state.recipesPinUnlocked){
      try{ await loadDessertsFromSheet_(); }catch(_e){}
      try{ renderRecipesView_(); }catch(_e){}
    }
  }finally{ hideLoading(); }
});
// Unit-cost breakdown (toggle solo móvil; en escritorio se mantiene tabla limpia)
  el("unitCostRows")?.addEventListener("click", (_ev)=>{});

  // Tabs
  el("btnTabPurchases")?.addEventListener("click", ()=> setView("purchases"));
  el("btnTabRecipes")?.addEventListener("click", ()=> setView("recipes"));

  // Mobile nav (solo móvil)
  bindFastTap_("mNavReload", ()=> el("btnReload")?.click());
  bindFastTap_("mNavExit", ()=> { if(hasHubAccess_()) goHub_(); else el("btnExit")?.click(); });
  bindFastTap_("mNavGoPurchases", ()=>{
    if(state.view === "purchases"){
      updateMobileNavLabel_();
      return;
    }
    setView("purchases");
  });
  bindFastTap_("mNavGoRecipes", ()=>{
    if(state.view === "recipes"){
      updateMobileNavLabel_();
      return;
    }
    setView("recipes");
  });

  // Compras (admin integrado)
  el("btnCatalogs")?.addEventListener("click", ()=> openCatalogModal());
  el("btnIngredients")?.addEventListener("click", ()=> openIngredientsModal());
  el("inpDessertSearch")?.addEventListener("input", (e)=>{ state.ui.dessert_q = String(e.target.value||""); renderDessertList_(); });
  el("dessertList")?.addEventListener("click", (e)=>{
    const head = e.target.closest('.pDessertHead');
    if(!head) return;
    const card = head.closest('.pDessertCard');
    if(!card) return;
    const did = String(card.getAttribute('data-did')||'');
    if(!did) return;

    if(String(state.ui.activeDessert||"") === did){
      state.ui.activeDessert = "";
      state.ui.ingredient_q = "";
      renderDessertList_();
      return;
    }

    state.ui.recipeDraftByDessert = state.ui.recipeDraftByDessert || {};
    delete state.ui.recipeDraftByDessert[did];
    state.ui.activeDessert = did;
    state.ui.ingredient_q = "";
    renderDessertList_();

    setTimeout(()=>{
      const p = el('dessertPanel_' + did);
      if(p && window.innerWidth <= 860){
        p.scrollIntoView({behavior:'smooth', block:'start'});
      }
    }, 50);
  });
  // Recetas: interacción con switches y cantidades (delegación)
  el("dessertList")?.addEventListener("input", (e)=>{
    const act = e.target?.getAttribute?.("data-act") || "";
    if(act !== "r_qty") return;

    const row = e.target.closest(".pRecipeRow");
    if(!row) return;
    const nk = String(row.getAttribute("data-nk")||"");
    const kRaw = String(row.getAttribute("data-kraw")||"");
    if(!nk) return;
    const did = String(state.ui.activeDessert||"");
    if(!did) return;

    const draft = getDraftMap_(did);
    draft[nk] = draft[nk] || { use:false, qty:"", unit:getUnitFor(kRaw), rawKey:kRaw };
    draft[nk].qty = String(e.target.value||"").replace(",", ".");
    draft[nk].rawKey = kRaw;
  });

  el("dessertList")?.addEventListener("change", (e)=>{
    const act = e.target?.getAttribute?.("data-act") || "";
    if(act !== "r_toggle") return;

    const row = e.target.closest(".pRecipeRow");
    if(!row) return;
    const nk = String(row.getAttribute("data-nk")||"");
    const kRaw = String(row.getAttribute("data-kraw")||"");
    if(!nk) return;
    const did = String(state.ui.activeDessert||"");
    if(!did) return;

    const draft = getDraftMap_(did);
    draft[nk] = draft[nk] || { use:false, qty:"", unit:getUnitFor(kRaw), rawKey:kRaw };
    draft[nk].use = !!e.target.checked;
    draft[nk].rawKey = kRaw;

    // UI
    row.classList.toggle("isOn", draft[nk].use);
    row.classList.toggle("isOff", !draft[nk].use);

    const sw = row.querySelector(".switchWrap");
    if(sw){
      sw.classList.toggle("isOn", draft[nk].use);
      sw.classList.toggle("isOff", !draft[nk].use);
      const meta = sw.querySelector(".meta");
      if(meta) meta.textContent = draft[nk].use ? "Incluido" : "No";
    }

    const qtyInp = row.querySelector("input.qty");
    if(qtyInp) qtyInp.disabled = !draft[nk].use;

    // default qty = 1
    if(draft[nk].use){
      const cur = parseNumFlex_(draft[nk].qty);
      if(!(cur > 0)){
        draft[nk].qty = 1;
        if(qtyInp) qtyInp.value = "1";
      }
    }
  });

  el("btnRecipesRefresh")?.addEventListener("click", ()=>{ showLoading("Refrescando…","Leyendo datos."); loadAll({ loadRecipesNow:true }).finally(hideLoading); });


  // Unlock
  el("btnDoUnlock")?.addEventListener("click", ()=>doUnlock(false));
  el("btnToggleSecret")?.addEventListener("click", ()=>{
    const inp = el("secretInput");
    if(!inp) return;
    inp.type = (inp.type === "password") ? "text" : "password";
    syncSecretToggleState_();
  });
  el("btnClear")?.addEventListener("click", ()=>{
    if(el("secretInput")) el("secretInput").value = "";
    if(el("loginProfile")) el("loginProfile").value = "";
    if(el("unlockMsg")) el("unlockMsg").textContent = "";
    const chk = getRememberCheckbox_();
    if(chk) chk.checked = false;
    try{ localStorage.removeItem(LS_SECRET_KEY); }catch(_e){}
    try{ localStorage.removeItem(LS_PROFILE_KEY); }catch(_e){}
    setRememberDeviceEnabled_(false);
    syncSecretToggleState_();
    el("secretInput")?.focus();
  });
  el("secretInput")?.addEventListener("keydown", (e)=>{ if(e.key === "Enter") doUnlock(false); });

  // Recipes unlock
  el("btnDoRecipesUnlock")?.addEventListener("click", ()=>doRecipesUnlock_(false));
  el("btnRecipesClear")?.addEventListener("click", ()=>{ if(el("recipesPinInput")) el("recipesPinInput").value=""; if(el("recipesUnlockMsg")) el("recipesUnlockMsg").textContent=""; el("recipesPinInput")?.focus(); });
  el("btnRecipesCancel")?.addEventListener("click", ()=>{ closeRecipesUnlock_(); setView(state.prevViewBeforeRecipes || "purchases"); });
  el("recipesUnlockCloseX")?.addEventListener("click", ()=>{ closeRecipesUnlock_(); setView(state.prevViewBeforeRecipes || "purchases"); });
  el("recipesPinInput")?.addEventListener("keydown", (e)=>{ if(e.key==="Enter") doRecipesUnlock_(false); });
  el("recipesUnlockBack")?.addEventListener("click", (e)=>{ /* ✅ No cerrar al hacer click fuera: solo cancelar */ });
// Controls
  el("inpSearch")?.addEventListener("input", (e)=>{ state.ui.q = String(e.target.value||""); state.ui.cost_q = state.ui.q; renderGroups(); renderCostGroupsIfOpen_(); refreshBottom(); updateMetaLine(); });
  el("chkOnlyMissing")?.addEventListener("change", (e)=>{ state.ui.onlyMissing = !!e.target.checked; renderGroups(); refreshBottom(); updateMetaLine(); });
  el("chkOnlySelected")?.addEventListener("change", (e)=>{ state.ui.onlySelected = !!e.target.checked; renderGroups(); refreshBottom(); updateMetaLine(); });

  el("adminListDetails")?.addEventListener("toggle", ()=>{ if(el("adminListDetails")?.open) renderCostsGroups(); });

  // Listado administrativo: interacciones
  el("costGroups")?.addEventListener("click", (e)=>{
    const btn = e.target.closest("button");
    if(!btn) return;
    const card = e.target.closest(".pItem");
    const key = card ? String(card.getAttribute("data-k")||"") : "";
    if(!key) return;
    const act = btn.getAttribute("data-act") || "";
    if(act === "edit") openCostModal(key);
  });

  // Group interactions (event delegation)
  el("groups")?.addEventListener("click", (e)=>{
    const btn = e.target.closest("button");
    if(!btn) return;
    const card = e.target.closest(".pItem");
    const key = card ? String(card.getAttribute("data-k")||"") : "";
    if(!key) return;

    const act = btn.getAttribute("data-act") || "";
    if(act === "edit"){
      openCostModal(key);
      return;
    }
    if(act === "auto"){
      captureOpenGroupsFromDOM_();
      applyRecommendedBuyPlan_(key);
      renderGroups();
      refreshBottom();
      updateMetaLine();
    }
  });

  // Inputs & switches (delegation)
  el("groups")?.addEventListener("change", (e)=>{
    const card = e.target.closest(".pItem");
    const key = card ? String(card.getAttribute("data-k")||"") : "";
    if(!key) return;

    const act = e.target.getAttribute("data-act") || "";
    const plan = getPlan(key);

    if(act === "toggle"){
      captureOpenGroupsFromDOM_();
      const isOn = !!e.target.checked;
      if(isOn){
        applyRecommendedBuyPlan_(key);
      }else{
        plan.selected = false;
        plan.packs = 0;
        plan.qty_manual = 0;
        plan.autoInfo = null;
      }
      renderGroups();
      refreshBottom();
      updateMetaLine();
      return;
    }

    if(act === "packs"){
      captureOpenGroupsFromDOM_();
      plan.packs = Number(e.target.value||0);
      plan.selected = true;
      plan.autoInfo = null;
      renderGroups();
      refreshBottom();
      updateMetaLine();
      return;
    }

    if(act === "manual"){
      captureOpenGroupsFromDOM_();
      plan.qty_manual = Number(e.target.value||0);
      plan.selected = true;
      plan.autoInfo = null;
      renderGroups();
      refreshBottom();
      updateMetaLine();
      return;
    }
  });

  // Bottom bar
  el("btnRegister")?.addEventListener("click", ()=>{ openConfirm(); });

  // Confirm modal
  el("btnConfirmClose")?.addEventListener("click", closeConfirm);
  el("btnConfirmCancel")?.addEventListener("click", closeConfirm);
  el("btnConfirmGo")?.addEventListener("click", async ()=>{
    closeConfirm();
    await registerPurchases();
    renderGroups();
    refreshBottom();
  });

  // Cost modal
  el("cmCancelX")?.addEventListener("click", closeCostModal);
  el("cmSave")?.addEventListener("click", saveCostModal);
  el("cmOpenCatalogs")?.addEventListener("click", ()=> openCatalogModal());
  ["cmUnitType","cmPackQty","cmPackPrice","cmUnitItemQty","cmUnitItemType"].forEach(id=>{
    el(id)?.addEventListener("input", cmComputePreview);
    el(id)?.addEventListener("change", cmComputePreview);
  });

  // Catalog modal
  el("catCloseX")?.addEventListener("click", closeCatalogModal);
  el("ingCloseX")?.addEventListener("click", closeIngredientsModal);
  el("btnAddIng")?.addEventListener("click", async()=>{ try{ if(el("ingAddMsg")) el("ingAddMsg").textContent=""; await addIngredient(); }catch(e){ try{ hideLoading(); }catch(_e){} if(el("ingAddMsg")) el("ingAddMsg").textContent=String(e.message||e); } });
  el("btnDelIng")?.addEventListener("click", ()=>{
    try{
      if(el("ingDelMsg")) el("ingDelMsg").textContent="";
      const key = String(el("ingSelect")?.value||"").trim();
      if(!key) throw new Error("Selecciona un ingrediente.");
      openIngConfirm(key);
    }catch(e){ if(el("ingDelMsg")) el("ingDelMsg").textContent=String(e.message||e); }
  });
el("ingModalBack")?.addEventListener("click", (e)=>{ if(e.target && e.target.id==="ingModalBack") closeIngredientsModal(); });
  el("btnAddStore")?.addEventListener("click", async ()=>{
    try{
      if(el("catErr")) el("catErr").textContent = "";
      const nextStore = String(el("catStoreNew")?.value || "").trim();
      showLoading("Guardando…","Agregando tienda.");
      await addCatalogValue("stores", nextStore);
      if(el("catStoreNew")) el("catStoreNew").value = "";
      fillSimpleSelect("catStores", state.stores);
      fillSimpleSelect("catBrands", state.brands);
      refreshCostModalCatalogSelects_({ store: nextStore });
      setGlobalMsg("✅ Tienda agregada.");
    }catch(err){
      if(el("catErr")) el("catErr").textContent = err?.message || "Error";
    }finally{ hideLoading(); }
  });
  el("btnDelStore")?.addEventListener("click", async ()=>{
    try{
      if(el("catErr")) el("catErr").textContent = "";
      const v = String(el("catStores")?.value || "").trim();
      const currentStore = String(el("cmStore")?.value || "").trim();
      showLoading("Guardando…","Eliminando tienda.");
      await deleteCatalogValue("stores", v);
      fillSimpleSelect("catStores", state.stores);
      fillSimpleSelect("catBrands", state.brands);
      refreshCostModalCatalogSelects_({ store: currentStore && currentStore.toLowerCase() !== v.toLowerCase() ? currentStore : "" });
      setGlobalMsg("✅ Tienda eliminada.");
    }catch(err){
      if(el("catErr")) el("catErr").textContent = err?.message || "Error";
    }finally{ hideLoading(); }
  });
  el("btnAddBrand")?.addEventListener("click", async ()=>{
    try{
      if(el("catErr")) el("catErr").textContent = "";
      const nextBrand = String(el("catBrandNew")?.value || "").trim();
      showLoading("Guardando…","Agregando marca.");
      await addCatalogValue("brands", nextBrand);
      if(el("catBrandNew")) el("catBrandNew").value = "";
      fillSimpleSelect("catBrands", state.brands);
      fillSimpleSelect("catStores", state.stores);
      refreshCostModalCatalogSelects_({ brand: nextBrand });
      setGlobalMsg("✅ Marca agregada.");
    }catch(err){
      if(el("catErr")) el("catErr").textContent = err?.message || "Error";
    }finally{ hideLoading(); }
  });
  el("btnDelBrand")?.addEventListener("click", async ()=>{
    try{
      if(el("catErr")) el("catErr").textContent = "";
      const v = String(el("catBrands")?.value || "").trim();
      const currentBrand = String(el("cmBrand")?.value || "").trim();
      showLoading("Guardando…","Eliminando marca.");
      await deleteCatalogValue("brands", v);
      fillSimpleSelect("catBrands", state.brands);
      fillSimpleSelect("catStores", state.stores);
      refreshCostModalCatalogSelects_({ brand: currentBrand && currentBrand.toLowerCase() !== v.toLowerCase() ? currentBrand : "" });
      setGlobalMsg("✅ Marca eliminada.");
    }catch(err){
      if(el("catErr")) el("catErr").textContent = err?.message || "Error";
    }finally{ hideLoading(); }
  });

  // Close modal by clicking outside
  el("costModalBack")?.addEventListener("click", (e)=>{ if(e.target === el("costModalBack")) closeCostModal(); });
  el("confirmBack")?.addEventListener("click", (e)=>{ if(e.target === el("confirmBack")) closeConfirm(); });
  el("catModalBack")?.addEventListener("click", (e)=>{ if(e.target === el("catModalBack")) closeCatalogModal(); });


  // Confirm delete modal
  el("ingConfirmCancel")?.addEventListener("click", closeIngConfirm);
  el("ingConfirmBack")?.addEventListener("click", (e)=>{ if(e.target && e.target.id==="ingConfirmBack") closeIngConfirm(); });

    el("ingConfirmGo")?.addEventListener("click", async ()=>{
    if(ingDeleteCountdown > 0) return; // aún bloqueado

    const btnGo = el("ingConfirmGo");
    try{
      if(el("ingConfirmCountdown")) el("ingConfirmCountdown").textContent = "";
      const key = String(ingDeletePendingKey || el("ingSelect")?.value || "").trim();
      if(!key) throw new Error("Selecciona un ingrediente.");

      if(btnGo) btnGo.disabled = true;
      showLoading("Eliminando ingrediente…","Actualizando base de datos.");
      await new Promise(r=>setTimeout(r, 60));
      await deleteIngredientByKey_(key);

      closeIngConfirm();
      refreshIngredientSelect_();
      if(el("ingDelMsg")) el("ingDelMsg").textContent = "Ingrediente eliminado.";
      setGlobalMsg("✅ Ingrediente eliminado.", false);
    }catch(e){
      if(el("ingConfirmCountdown")) el("ingConfirmCountdown").textContent = String(e.message||e);
    }finally{
      hideLoading();
      if(btnGo) btnGo.disabled = false;
    }
  });

  // ESC para cancelar
  document.addEventListener("keydown", (e)=>{
    if(e.key !== "Escape") return;
    const back = el("ingConfirmBack");
    if(back && !back.classList.contains("hidden")) closeIngConfirm();
  });

    // Modal eliminar postre (confirmación 3s)
  try{
    ensureDessertDeleteDom_();
    el("dessertConfirmCancel")?.addEventListener("click", closeDessertDeleteModal_);
    el("dessertConfirmGo")?.addEventListener("click", ()=>{ confirmDessertDelete_().catch(()=>{}); });
  }catch(_e){}

// Recetas: crear postre / crear ingrediente
  el("btnDessertAdd")?.addEventListener("click", ()=> openDessertModal_());
  el("btnRecipesAddIngredient")?.addEventListener("click", ()=> openIngredientsModal());
  el("dessertNameInput")?.addEventListener("input", (e)=>{ 
    const name = String(e.target.value||"");
    if(el("dessertIdInput")) el("dessertIdInput").value = slugifyDessertId_(name);
  });
  el("btnDessertCancel")?.addEventListener("click", closeDessertModal_);
  el("dessertModalBack")?.addEventListener("click", (e)=>{ if(e.target && e.target.id==="dessertModalBack") closeDessertModal_(); });
  el("btnDessertCreate")?.addEventListener("click", async()=>{
    try{
      if(el("dessertCreateMsg")) el("dessertCreateMsg").textContent="";
      await createDessert_();
    }catch(e){
      if(el("dessertCreateMsg")) el("dessertCreateMsg").textContent = String(e.message||e);
    }
  });
}

// =============== Boot ===============
(async function init(){
  bind();
  loadDeletedDesserts_();
  syncSecretToggleState_();

  const saved = String(localStorage.getItem(LS_SECRET_KEY) || "").trim();
  const savedProfile = String(localStorage.getItem(LS_PROFILE_KEY) || "").trim();
  const remembered = isRememberDeviceEnabled_();
  const portal = loadPortalCostsSession_();

  const chk = getRememberCheckbox_();
  if(chk) chk.checked = !!saved && remembered;

  if(savedProfile && el("loginProfile")) ensureSelectValueOption_(el("loginProfile"), savedProfile, savedProfile);

  let bootHandled = false;
  try{
    const bootSession = (portal?.id && portal?.password)
      ? { id:String(portal.id || "").trim(), label:String(portal.label || portal.id || "").trim(), secret:String(portal.password || "").trim(), remember: !!portal.remember, fromPortal:true }
      : ((saved && remembered && savedProfile)
          ? { id:savedProfile, label:savedProfile, secret:saved, remember:true, fromPortal:false }
          : null);

    if(bootSession){
      if(el("loginProfile")) ensureSelectValueOption_(el("loginProfile"), bootSession.id, bootSession.label || bootSession.id);
      if(el("secretInput")) el("secretInput").value = bootSession.secret;
      if(chk) chk.checked = !!bootSession.remember;

      const fastCache = loadCostsDataCache_(bootSession.id);
      UNLOCKED_SECRET = bootSession.secret;
      primeCostsShell_({
        id: bootSession.id,
        label: String((fastCache && fastCache.profileLabel) || bootSession.label || bootSession.id),
        categories: Array.isArray(fastCache?.profileCategories) ? fastCache.profileCategories : []
      }, fastCache || null);

      revealHubBoot_();
      syncMobileNavForViewport_();
      bootHandled = true;

      void populateLoginProfiles_().catch(_e=>{});
      void doUnlock(false, {
        fromPortal: !!bootSession.fromPortal,
        silent: true,
        remember: !!bootSession.remember,
        profileId: bootSession.id,
        profileLabel: bootSession.label,
        secret: bootSession.secret,
        skipOverlay: true,
        backgroundLoad: true,
        skipShell: true
      });
      return;
    }

    try{ await populateLoginProfiles_(); }catch(_e){}

    if(saved && !remembered){
      try{ localStorage.removeItem(LS_SECRET_KEY); }catch(_e){}
      try{ localStorage.removeItem(LS_PROFILE_KEY); }catch(_e){}
    }
    openUnlock("");
  } finally {
    if(!bootHandled){
      revealHubBoot_();
      syncMobileNavForViewport_();
    }
  }
})();


// Keep mobile nav in sync on resize
try{ window.addEventListener("resize", ()=>{ try{ syncMobileNavForViewport_(); }catch(_e){} }); }catch(_e){}
