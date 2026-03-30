const API_URL = "https://amared-orders.amaredpostres.workers.dev/";
const HUB_SS_KEY = "AMARED_HUB_SESSION_V1";
const HUB_LS_KEY = "AMARED_HUB_REMEMBER_V1";
const PROFILES_SS_KEY = "AMARED_PROFILES_SESSION_V1";
const COSTS_SS_KEY = "AMARED_COSTS_SESSION_V1";
const HUB_PROFILES_CACHE_KEY = "AMARED_HUB_PROFILES_CACHE_V1";
const HUB_PROFILES_CACHE_TTL = 5 * 60 * 1000;
const HUB_PAGE_CACHE_PREFIX = "AMARED_PAGECACHE_";
const HUB_PREFETCHED = new Set();
const HUB_BOOT_MIN_MS = 850;
const HUB_REFRESH_MIN_MS = 650;
const HUB_SHARED_PREFETCH = [
  { href:"styles.css", as:"style" },
  { href:"assets/Logo-Amared.svg", as:"image" },
  { href:"assets/Logo-Isotipo-Amared.svg", as:"image" },
  { href:"assets/favicon.ico", as:"image" },
];
const HUB_MODULE_PREFETCH = {
  kitchen: [
    { href:"kitchen.html", as:"document" },
    { href:"kitchen.js?v=20260329-async-sections-v4", as:"script" },
    { href:"kitchen-costs.js?v=20260302-fix7u", as:"script" },
  ],
  payments: [
    { href:"admin.html", as:"document" },
    { href:"admin.js?v=20260324-admin-mobile-hub-v2", as:"script" },
  ],
  delivery: [
    { href:"delivery.html", as:"document" },
    { href:"delivery.css", as:"style" },
    { href:"delivery.js?v=20260324-02", as:"script" },
  ],
  costs: [
    { href:"costs.html", as:"document" },
    { href:"costs.css?v=20260330-bgfix-v31", as:"style" },
    { href:"kitchen-costs.js?v=20260328-costs-loading-badge-v8", as:"script" },
    { href:"costs.js?v=20260328-costs-loading-badge-v8", as:"script" },
  ],
  profiles: [
    { href:"profiles.html", as:"document" },
    { href:"profiles.js?v=20260329-async-sections-v4", as:"script" },
  ],
  index_admin: [
    { href:"index.html?admin=1", as:"document" },
    { href:"app.js?v=20260330-index-admin-v4", as:"script" },
  ],
};

const MODULES = [
  { key:"payments", title:"Pagos", desc:"Confirma pagos y revisa pedidos pendientes.", href:"admin.html", icon:"💳", allow:["payments","pago","admin"] },
  { key:"costs", title:"Compras y Recetas", desc:"Consulta compras, costos y recetas del día.", href:"costs.html", icon:"🧾", allow:["costs","purchases","admin"] },
  { key:"kitchen", title:"Cocina", desc:"Gestiona la preparación y el avance de los pedidos.", href:"kitchen.html", icon:"🍰", allow:["kitchen","admin"] },
  { key:"delivery", title:"Envíos", desc:"Revisa pedidos listos y confirma entregas.", href:"delivery.html", icon:"📦", allow:["delivery","admin"] },
  { key:"index_admin", title:"Página de pedidos", desc:"Responde opiniones y ajusta los precios visibles del catálogo web.", href:"index.html?admin=1", icon:"🛍️", allow:["index_admin","indexadmin","pedidosweb","weborders","admin"] },
  { key:"profiles", title:"Gestión de perfiles", desc:"Administra perfiles, permisos y contraseñas.", href:"profiles.html", icon:"👤", allow:["profiles","admin"] },
];

const state = { session:null, profiles:[] };

const hubProfile = document.getElementById("hubProfile");
const hubPassword = document.getElementById("hubPassword");
const hubRemember = document.getElementById("hubRemember");
const hubLoginMsg = document.getElementById("hubLoginMsg");
const btnHubLogin = document.getElementById("btnHubLogin");
const btnHubTogglePass = document.getElementById("btnHubTogglePass");
const hubLoginView = document.getElementById("hubLoginView");
const hubAppView = document.getElementById("hubAppView");
const hubTopbar = document.getElementById("hubTopbar");
const hubLoginTopbar = document.getElementById("hubLoginTopbar");
const hubWelcomeTitle = document.getElementById("hubWelcomeTitle");
const hubProfilePill = document.getElementById("hubProfilePill");
const hubCountPill = document.getElementById("hubCountPill");
const hubGrid = document.getElementById("hubGrid");
const hubEmpty = document.getElementById("hubEmpty");
const hubMobileBar = document.getElementById("hubMobileBar");
const hubLoading = document.getElementById("hubLoading");
const hubLoadingTitle = document.getElementById("hubLoadingTitle");
const hubLoadingMsg = document.getElementById("hubLoadingMsg");

function revealHubBoot_(){
  try{ document.documentElement.classList.remove("hubBoot"); document.documentElement.classList.add("hubReady"); }catch(_e){}
}
function wait(ms){ return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms||0)))); }

function normalizeCats(v){
  if(Array.isArray(v)) return v.map(x => String(x || "").trim().toLowerCase()).filter(Boolean);
  return String(v || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
}
function escapeHtml(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}
function showLoading(title, msg){
  if(!hubLoading) return;
  hubLoadingTitle.textContent = title || "Cargando…";
  hubLoadingMsg.textContent = msg || "Procesando";
  hubLoading.style.display = "flex";
}
function hideLoading(){ if(hubLoading) hubLoading.style.display = "none"; syncMobileBar(); }

async function api(payload){
  try{ ensureHubPreconnect_(); }catch(_e){}
  const res = await fetch(API_URL, {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify(payload || {})
  });
  const data = await res.json().catch(()=>({}));
  if(!res.ok || data.ok === false){
    throw new Error(data.error || data.message || `HTTP ${res.status}`);
  }
  return data;
}

function saveHubSession(remember){
  try{ sessionStorage.setItem(HUB_SS_KEY, JSON.stringify(state.session)); }catch(_e){}
  try{
    if(remember) localStorage.setItem(HUB_LS_KEY, JSON.stringify(state.session));
    else localStorage.removeItem(HUB_LS_KEY);
  }catch(_e){}
}
function loadHubSession(){
  try{
    const raw = localStorage.getItem(HUB_LS_KEY);
    const s = raw ? JSON.parse(raw) : null;
    if(s?.id && s?.password) return { session:s, remembered:true };
  }catch(_e){}
  try{
    const raw = sessionStorage.getItem(HUB_SS_KEY);
    const s = raw ? JSON.parse(raw) : null;
    if(s?.id && s?.password) return { session:s, remembered:false };
  }catch(_e){}
  return null;
}
function clearHubSession(){
  try{ sessionStorage.removeItem(HUB_SS_KEY); }catch(_e){}
  try{ localStorage.removeItem(HUB_LS_KEY); }catch(_e){}
  clearAllPageSessions();
  state.session = null;
}

function clearAllPageSessions(){
  const keys = [
    "AMARED_ADMIN", "AMARED_ADMIN_REMEMBER_V1",
    "AMARED_DELIVERY_SESSION_V4", "AMARED_DELIVERY_REMEMBER_V1",
    "AMARED_KITCHEN_SESSION_V6", "amared_kitchen_session",
    PROFILES_SS_KEY,
    "AMARED_PROFILES_ADMIN_PIN", "AMARED_PROFILES_PROFILE", "AMARED_PROFILES_REMEMBER",
    COSTS_SS_KEY,
    "AMARED_COSTS_SECRET", "AMARED_COSTS_PROFILE_ID", "AMARED_COSTS_REMEMBER_V1"
  ];
  for(const key of keys){
    try{ sessionStorage.removeItem(key); }catch(_e){}
    try{ localStorage.removeItem(key); }catch(_e){}
  }
  try{
    const ssKeys = [];
    for(let i=0; i<sessionStorage.length; i++) ssKeys.push(sessionStorage.key(i));
    ssKeys.forEach(key=>{ if(String(key||"").startsWith(HUB_PAGE_CACHE_PREFIX)) sessionStorage.removeItem(key); });
  }catch(_e){}
}

function syncPassToggle(){
  if(!hubPassword || !btnHubTogglePass) return;
  const hidden = hubPassword.type !== "text";
  btnHubTogglePass.textContent = hidden ? "👁" : "🙈";
  btnHubTogglePass.setAttribute("aria-label", hidden ? "Mostrar contraseña" : "Ocultar contraseña");
}

function allowedModules(categories){
  const cats = new Set(normalizeCats(categories));
  return MODULES.filter(mod => mod.allow.some(tag => cats.has(tag)));
}

function runWhenIdle_(fn, timeout=1200){
  try{
    if(typeof window.requestIdleCallback === "function"){
      window.requestIdleCallback(()=>{ try{ fn(); }catch(_e){} }, { timeout });
      return;
    }
  }catch(_e){}
  window.setTimeout(()=>{ try{ fn(); }catch(_e){} }, Math.min(400, timeout));
}
function ensureHubPreconnect_(){
  try{
    if(document.getElementById("amHubPreconnectApi")) return;
    const u = new URL(API_URL);
    const link = document.createElement("link");
    link.id = "amHubPreconnectApi";
    link.rel = "preconnect";
    link.href = u.origin;
    link.crossOrigin = "anonymous";
    document.head.appendChild(link);
  }catch(_e){}
}
function prefetchResource_(href, as="fetch"){
  const clean = String(href || "").trim();
  if(!clean) return;
  const key = `${as}:${clean}`;
  if(HUB_PREFETCHED.has(key)) return;
  HUB_PREFETCHED.add(key);
  try{
    const link = document.createElement("link");
    link.rel = "prefetch";
    link.as = as || "fetch";
    link.href = clean;
    if(as === "fetch") link.crossOrigin = "anonymous";
    document.head.appendChild(link);
  }catch(_e){}
}
function prefetchModuleBundle_(mod){
  if(!mod) return;
  const entries = [...HUB_SHARED_PREFETCH, ...(HUB_MODULE_PREFETCH[mod.key] || [{ href: mod.href, as:"document" }])];
  entries.forEach(item => prefetchResource_(item.href, item.as));
}
function prefetchAllowedModules_(){
  const mods = allowedModules(state.session?.categories || []);
  runWhenIdle_(()=>{
    ensureHubPreconnect_();
    mods.forEach(mod => prefetchModuleBundle_(mod));
  }, 1500);
}
function renderProfiles(list){
  const rows = Array.isArray(list) ? list : [];
  const currentValue = String(hubProfile?.value || state.session?.id || "").trim();
  const opts = ['<option value="">Seleccionar…</option>'];
  for(const p of rows){
    const id = String(p.id || p.profile_id || "").trim();
    const label = String(p.label || id).trim();
    if(!id || !label) continue;
    const selected = currentValue && currentValue === id ? ' selected' : '';
    opts.push(`<option value="${escapeHtml(id)}"${selected}>${escapeHtml(label)}</option>`);
  }
  if(!rows.length) opts.push('<option value="">Sin perfiles disponibles</option>');
  hubProfile.innerHTML = opts.join("");
}


function getCachedProfiles(){
  try{
    const raw = sessionStorage.getItem(HUB_PROFILES_CACHE_KEY);
    const data = raw ? JSON.parse(raw) : null;
    if(!data || !Array.isArray(data.items)) return null;
    if((Date.now() - Number(data.ts || 0)) > HUB_PROFILES_CACHE_TTL) return null;
    return data.items;
  }catch(_e){ return null; }
}
function setCachedProfiles(items){
  try{ sessionStorage.setItem(HUB_PROFILES_CACHE_KEY, JSON.stringify({ ts: Date.now(), items: Array.isArray(items) ? items : [] })); }catch(_e){}
}
function resetHubBusyState(){
  try{ if(hubLoading) hubLoading.style.display = 'none'; }catch(_e){}
  try{
    if(hubGrid){
      hubGrid.style.pointerEvents = '';
      hubGrid.style.opacity = '';
    }
  }catch(_e){}
  syncMobileBar();
}

async function loadProfiles(force=false, opts={}){
  const useOverlay = opts.overlay !== false;
  const cached = !force ? getCachedProfiles() : null;
  if(cached && cached.length){
    state.profiles = cached.filter(p => normalizeCats(p.categories).length > 0);
    renderProfiles(state.profiles);
  }
  if(cached && !force) return state.profiles;
  if(useOverlay) showLoading("Cargando perfiles…", "Buscando perfiles disponibles.");
  try{
    const out = await api({ action:"profiles_public_list" });
    const list = Array.isArray(out.profiles) ? out.profiles : [];
    state.profiles = list.filter(p => normalizeCats(p.categories).length > 0);
    setCachedProfiles(state.profiles);
    renderProfiles(state.profiles);
    return state.profiles;
  } finally {
    if(useOverlay) hideLoading();
  }
}

function setHubGridBusy(isBusy){
  try{
    if(!hubGrid) return;
    hubGrid.style.pointerEvents = isBusy ? 'none' : '';
    hubGrid.style.opacity = isBusy ? '.92' : '';
  }catch(_e){}
}

async function refreshHubPortal(forceProfiles=false){
  const startedAt = Date.now();
  showLoading(forceProfiles ? 'Actualizando…' : 'Cargando…', forceProfiles ? 'Buscando perfiles y módulos disponibles.' : 'Preparando tu espacio.');
  setHubGridBusy(true);
  try{
    await loadProfiles(!!forceProfiles, { overlay:false });
    if(state.session?.id && state.session?.password){
      const auth = await api({ action:'profiles_auth', profile_id:state.session.id, password_plain:state.session.password });
      if(auth.valid !== true) throw new Error(auth?.error || 'Sesión no válida.');
      state.session = {
        id: state.session.id,
        label: auth?.profile?.label || state.session.label || state.session.id,
        password: state.session.password,
        categories: normalizeCats(auth?.profile?.categories || state.session.categories || []),
        remember: !!state.session.remember
      };
      saveHubSession(!!state.session.remember);
      setShell('app');
      renderModules();
    } else {
      setShell('login');
    }
  } catch (e) {
    console.error('hub refresh error:', e);
    if(state.session?.id){
      clearHubSession();
      setShell('login');
      if(hubLoginMsg) hubLoginMsg.textContent = e?.message || 'No se pudo actualizar el espacio.';
    } else if(hubLoginMsg) {
      hubLoginMsg.textContent = e?.message || 'No se pudieron cargar los perfiles.';
    }
  } finally {
    const elapsed = Date.now() - startedAt;
    if(elapsed < HUB_REFRESH_MIN_MS) await wait(HUB_REFRESH_MIN_MS - elapsed);
    setHubGridBusy(false);
    hideLoading();
  }
}

function setShell(mode){
  const isApp = mode === "app";
  document.body.classList.remove("is-login","is-app");
  document.body.classList.add(isApp ? "is-app" : "is-login");
  hubLoginView.style.display = isApp ? "none" : "block";
  hubAppView.style.display = isApp ? "block" : "none";
  hubTopbar.style.display = isApp ? "block" : "none";
  hubLoginTopbar.style.display = isApp ? "none" : "block";
  resetHubBusyState();
}

function syncMobileBar(){
  if(!hubMobileBar) return;
  const mobile = window.matchMedia('(max-width: 720px)').matches;
  const appVisible = hubAppView && hubAppView.style.display !== 'none';
  const overlay = hubLoading && hubLoading.style.display === 'flex';
  hubMobileBar.classList.toggle('isVisible', mobile && appVisible && !overlay);
}

function renderModules(){
  const session = state.session;
  const mods = allowedModules(session?.categories || []);
  hubWelcomeTitle.textContent = `Hola, ${session?.label || session?.id || ""}`;
  hubProfilePill.textContent = `Perfil: ${session?.label || session?.id || ""}`;
  hubCountPill.textContent = `${mods.length} ${mods.length === 1 ? "página" : "páginas"}`;

  resetHubBusyState();

  if(!mods.length){
    hubGrid.innerHTML = "";
    hubEmpty.style.display = "block";
    return;
  }

  hubEmpty.style.display = "none";
  hubGrid.innerHTML = mods.map(mod => `
    <button class="hubCard" type="button" data-key="${escapeHtml(mod.key)}">
      <div class="hubCardTop">
        <div>
          <h2 class="hubCardTitle">${escapeHtml(mod.title)}</h2>
          <p class="hubCardDesc">${escapeHtml(mod.desc)}</p>
        </div>
        <div class="hubEmoji">${mod.icon}</div>
      </div>
      <span class="btn primary hubCardBtn">Abrir</span>
    </button>
  `).join("");
  try{
    Array.from(hubGrid.querySelectorAll('.hubCard[data-key]')).forEach(btn => {
      const key = String(btn.getAttribute('data-key') || '').trim();
      const mod = MODULES.find(m => m.key === key);
      if(!mod) return;
      const prefetch = ()=>prefetchModuleBundle_(mod);
      btn.addEventListener('mouseenter', prefetch, { passive:true });
      btn.addEventListener('focus', prefetch, { passive:true });
      btn.addEventListener('touchstart', prefetch, { passive:true, once:true });
    });
  }catch(_e){}
  prefetchAllowedModules_();
}

function setModuleSession(mod){
  const s = state.session;
  const remember = !!s?.remember;
  if(!s?.id || !s?.password) return;

  if(mod.key === 'payments'){
    const adminSession = { operator: s.label, operatorId: s.id, pin: s.password };
    try{ sessionStorage.setItem('AMARED_ADMIN', JSON.stringify(adminSession)); }catch(_e){}
    try{ if(remember) localStorage.setItem('AMARED_ADMIN_REMEMBER_V1', JSON.stringify(adminSession)); else localStorage.removeItem('AMARED_ADMIN_REMEMBER_V1'); }catch(_e){}
    return;
  }

  if(mod.key === 'delivery'){
    const deliverySession = { operator: { id:s.id, label:s.label }, pin:s.password };
    try{ sessionStorage.setItem('AMARED_DELIVERY_SESSION_V4', JSON.stringify(deliverySession)); }catch(_e){}
    try{ if(remember) localStorage.setItem('AMARED_DELIVERY_REMEMBER_V1', JSON.stringify(deliverySession)); else localStorage.removeItem('AMARED_DELIVERY_REMEMBER_V1'); }catch(_e){}
    return;
  }

  if(mod.key === 'kitchen'){
    const kitchenSession = { operatorId:s.id, operatorLabel:s.label, pin:s.password, categories:s.categories || [] };
    try{ sessionStorage.setItem('AMARED_KITCHEN_SESSION_V6', JSON.stringify(kitchenSession)); }catch(_e){}
    try{ if(remember) localStorage.setItem('amared_kitchen_session', JSON.stringify(kitchenSession)); else localStorage.removeItem('amared_kitchen_session'); }catch(_e){}
    return;
  }

  if(mod.key === 'profiles'){
    const profileSession = { id:s.id, label:s.label, password:s.password, categories:s.categories || [], remember };
    try{ sessionStorage.setItem(PROFILES_SS_KEY, JSON.stringify(profileSession)); }catch(_e){}
    try{
      if(remember){
        localStorage.setItem('AMARED_PROFILES_ADMIN_PIN', String(s.password || ''));
        localStorage.setItem('AMARED_PROFILES_PROFILE', String(s.id || ''));
        localStorage.setItem('AMARED_PROFILES_REMEMBER', '1');
      }else{
        localStorage.removeItem('AMARED_PROFILES_ADMIN_PIN');
        localStorage.removeItem('AMARED_PROFILES_PROFILE');
        localStorage.removeItem('AMARED_PROFILES_REMEMBER');
      }
    }catch(_e){}
    return;
  }

  if(mod.key === 'costs'){
    const costsSession = { id:s.id, label:s.label, password:s.password, categories:s.categories || [], remember };
    try{ sessionStorage.setItem(COSTS_SS_KEY, JSON.stringify(costsSession)); }catch(_e){}
    try{
      localStorage.removeItem('AMARED_COSTS_SECRET');
      localStorage.removeItem('AMARED_COSTS_PROFILE_ID');
      if(remember) localStorage.setItem('AMARED_COSTS_REMEMBER_V1', '1');
      else localStorage.removeItem('AMARED_COSTS_REMEMBER_V1');
    }catch(_e){}
  }
}

function openModule(key){
  const mod = MODULES.find(m => m.key === key);
  if(!mod) return;
  setModuleSession(mod);
  showLoading('Abriendo página…', `${mod.title}`);
  setHubGridBusy(true);
  window.setTimeout(()=>{
    const sep = String(mod.href || '').includes('?') ? '&' : '?';
    window.location.href = `${mod.href}${sep}hub=1`;
  }, 90);
}

async function login(){
  hubLoginMsg.textContent = '';
  const id = String(hubProfile?.value || '').trim();
  const password = String(hubPassword?.value || '').trim();
  if(!id){ hubLoginMsg.textContent = 'Selecciona un perfil.'; return; }
  if(!password){ hubLoginMsg.textContent = 'Ingresa la contraseña.'; return; }

  showLoading('Validando…', 'Comprobando acceso al espacio.');
  try{
    const auth = await api({ action:'profiles_auth', profile_id:id, password_plain:password });
    if(auth.valid !== true) throw new Error(auth?.error || 'Contraseña incorrecta.');
    const profile = auth.profile || {};
    const categories = normalizeCats(profile.categories);
    state.session = { id, label: profile.label || (state.profiles.find(p => String(p.id || p.profile_id || '') === id)?.label || id), password, categories, remember: !!hubRemember?.checked };
    saveHubSession(!!hubRemember?.checked);
    setShell('app');
    renderModules();
  } catch (e) {
    state.session = null;
    clearHubSession();
    setShell('login');
    hubLoginMsg.textContent = e?.message || 'No se pudo iniciar sesión.';
  } finally {
    hideLoading();
  }
}

async function restoreSession(){
  const saved = loadHubSession();
  if(!saved?.session) return false;
  showLoading('Validando…', 'Restaurando tu espacio.');
  try{
    const auth = await api({ action:'profiles_auth', profile_id:saved.session.id, password_plain:saved.session.password });
    if(auth.valid !== true) throw new Error(auth?.error || 'Sesión no válida.');
    state.session = {
      id: saved.session.id,
      label: auth?.profile?.label || saved.session.label || saved.session.id,
      password: saved.session.password,
      categories: normalizeCats(auth?.profile?.categories || saved.session.categories || []),
      remember: !!saved.remembered
    };
    if(hubRemember) hubRemember.checked = !!saved.remembered;
    setShell('app');
    renderModules();
    return true;
  } catch(_e){
    clearHubSession();
    setShell('login');
    return false;
  } finally {
    hideLoading();
  }
}

btnHubTogglePass?.addEventListener('click', ()=>{
  if(!hubPassword) return;
  hubPassword.type = hubPassword.type === 'password' ? 'text' : 'password';
  syncPassToggle();
});
btnHubLogin?.addEventListener('click', login);
hubPassword?.addEventListener('keydown', (e)=>{ if(e.key === 'Enter') login(); });
document.getElementById('btnHubReload')?.addEventListener('click', ()=> refreshHubPortal(true));
document.getElementById('btnHubLogout')?.addEventListener('click', ()=>{ clearHubSession(); if(hubPassword) hubPassword.value = ''; setShell('login'); syncMobileBar(); });
document.getElementById('btnHubMobileRefresh')?.addEventListener('click', ()=> refreshHubPortal(true));
document.getElementById('btnHubMobileLogout')?.addEventListener('click', ()=>{ clearHubSession(); if(hubPassword) hubPassword.value = ''; setShell('login'); syncMobileBar(); });
hubGrid?.addEventListener('click', (ev)=>{
  const card = ev.target?.closest?.('[data-key]');
  if(!card) return;
  openModule(String(card.getAttribute('data-key') || '').trim());
});
window.addEventListener('resize', syncMobileBar);
window.addEventListener('pageshow', ()=>{
  resetHubBusyState();
  if(state.session){ setShell('app'); renderModules(); }
  else syncMobileBar();
});


(async function boot(){
  syncPassToggle();
  const startedAt = Date.now();
  let restored = false;
  try{
    restored = await restoreSession();
    await loadProfiles(true, { overlay:false });
    if(!restored){
      setShell('login');
    }else{
      setShell('app');
      renderModules();
    }
  }catch(err){
    console.error('hub boot error:', err);
    if(!restored){
      setShell('login');
      if(hubLoginMsg && !String(hubLoginMsg.textContent || '').trim()){
        hubLoginMsg.textContent = 'No se pudieron cargar los perfiles. Intenta recargar.';
      }
    }
  }finally{
    const elapsed = Date.now() - startedAt;
    if(elapsed < HUB_BOOT_MIN_MS) await wait(HUB_BOOT_MIN_MS - elapsed);
    resetHubBusyState();
    revealHubBoot_();
  }
})();
