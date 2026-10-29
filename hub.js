const API_URL = window.AMARED_CONFIG.apiUrl;
const HUB_SS_KEY = "AMARED_HUB_SESSION_V1";
const HUB_LS_KEY = "AMARED_HUB_REMEMBER_V1";
const PROFILES_SS_KEY = "AMARED_PROFILES_SESSION_V1";
const COSTS_SS_KEY = "AMARED_COSTS_SESSION_V1";
const HUB_PROFILES_CACHE_KEY = "AMARED_HUB_PROFILES_CACHE_V1";
const HUB_PROFILES_CACHE_TTL = 5 * 60 * 1000;
const HUB_PAGE_CACHE_PREFIX = "AMARED_PAGECACHE_";
const HUB_PREFETCHED = new Set();
const HUB_BOOT_MIN_MS = 0;
const HUB_REFRESH_MIN_MS = 0;
const HUB_SHARED_PREFETCH = [
  { href:"styles.css", as:"style" },
  { href:"assets/Logo-Amared.svg", as:"image" },
  { href:"assets/Logo-Isotipo-Amared.svg", as:"image" },
  { href:"assets/favicon.ico", as:"image" },
];
const HUB_MODULE_PREFETCH = {
  kitchen: [
    { href:"kitchen.html", as:"document" },
    { href:"kitchen.js?v=20260919-ux22", as:"script" },
    { href:"kitchen-costs.js?v=20261029-admin7", as:"script" },
  ],
  payments: [
    { href:"admin.html", as:"document" },
    { href:"admin.js?v=20261029-admin7", as:"script" },
  ],
  delivery: [
    { href:"delivery.html", as:"document" },
    { href:"delivery.css", as:"style" },
    { href:"delivery.js?v=20261029-admin7", as:"script" },
  ],
  costs: [
    { href:"costs.html", as:"document" },
    { href:"costs.css?v=20260919-ux22", as:"style" },
    { href:"kitchen-costs.js?v=20261029-admin7", as:"script" },
    { href:"costs.js?v=20261029-admin7", as:"script" },
  ],
  profiles: [
    { href:"profiles.html", as:"document" },
    { href:"profiles.js?v=20260919-ux22", as:"script" },
  ],
  index_admin: [
    { href:"index.html?admin=1", as:"document" },
    { href:"app.js?v=20261029-admin7", as:"script" },
  ],
};

const MODULES = [
  { key:"payments", title:"Pedidos y pagos", desc:"Revisa pedidos, corrige sus datos y confirma los pagos.", href:"admin.html", icon:"💳", allow:["payments","pago","admin"] },
  { key:"kitchen", title:"Cocina", desc:"Gestiona la preparación y el avance de los pedidos.", href:"kitchen.html", icon:"🍰", allow:["kitchen","admin"] },
  { key:"delivery", title:"Envíos", desc:"Revisa pedidos listos y confirma entregas.", href:"delivery.html", icon:"📦", allow:["delivery","admin"] },
  { key:"costs", title:"Compras y recetas", desc:"Planea las compras, revisa existencias y controla tus costos.", href:"costs.html", icon:"🧾", allow:["costs","purchases","admin"] },
  { key:"index_admin", title:"Catálogo y opiniones", desc:"Responde opiniones y ajusta los precios visibles del catálogo web.", href:"index.html?admin=1", icon:"🛍️", allow:["index_admin","indexadmin","pedidosweb","weborders","admin"] },
  { key:"profiles", title:"Perfiles", desc:"Administra perfiles, permisos y contraseñas.", href:"profiles.html", icon:"👤", allow:["profiles","admin"] },
];

const state = { session:null, profiles:[] };
let dashboardCache=null, dashboardFlight=null;
const dashboardKey = () => JSON.stringify([state.session?.id,state.session?.password,state.session?.categories]);
function paintDashboard(){
  const cache=dashboardCache?.key===dashboardKey() ? dashboardCache : null;
  const counts=cache?.counts;
  document.querySelectorAll('[data-pending]').forEach(badge=>{
    const key=badge.dataset.pending, item=counts?.[key];
    const n=item?.pending;
    badge.className='hubPending '+key;
    if(cache?.error) { badge.textContent='Sin actualizar';badge.classList.add('isUnavailable'); }
    else if(!Number.isInteger(n)) {badge.textContent='Consultando…';badge.classList.add('isUnavailable');}
    else {
      badge.textContent=n===0 ? 'Sin pendientes' : key==='payments' ? `${n} ${n===1?'pendiente de pago':'pendientes de pago'}` : key==='kitchen' ? `${n} por preparar` : `${n} ${n===1?'listo para entregar':'listos para entregar'}`;
      if(key==='kitchen' && item.in_progress) badge.textContent+=` · ${item.in_progress} en preparación`;
      if(key==='delivery' && Number.isInteger(item.delivery) && Number.isInteger(item.pickup)){const detail=document.createElement('small');detail.className='hubDeliverySplit';detail.textContent=`Domicilio ${item.delivery} · Recogida ${item.pickup}`;badge.append(detail);}
      badge.classList.toggle('isClear',n===0 && !item.in_progress);
    }
  });
  const status=document.getElementById('hubActivityStatus');
  if(status) status.textContent=cache?.error ? 'No pudimos consultar los pendientes. Usa Actualizar para reintentar.' : counts ? 'Pendientes de todos los días · Actualizado '+new Date(cache.at).toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'}) : 'Consultando actividades pendientes…';
}
async function refreshDashboard(force=false){
  if(!state.session) return;
  const key=dashboardKey();
  if(dashboardFlight?.key===key) return dashboardFlight.promise;
  if(!force && dashboardCache?.key===key && Date.now()-dashboardCache.at<30000){paintDashboard();return;}
  const session=state.session;
  const promise=(async()=>{
    try {
      const out=await api({action:'dashboard_summary',auth_profile_id:session.id,auth_profile_password:session.password,auth_page:'hub'});
      if(key!==dashboardKey() || !state.session) return;
      const expected=allowedModules(session.categories).filter(m=>['payments','kitchen','delivery'].includes(m.key));
      if(expected.some(m=>!Number.isInteger(out.counts?.[m.key]?.pending))) throw new Error('Resumen incompleto');
      if(expected.some(m=>m.key==='delivery') && (!Number.isInteger(out.counts.delivery.delivery)||!Number.isInteger(out.counts.delivery.pickup)||out.counts.delivery.delivery+out.counts.delivery.pickup!==out.counts.delivery.pending))throw Error('Desglose incompleto');
      dashboardCache={key,counts:out.counts,at:Date.now()};
    }catch {
      if(key!==dashboardKey() || !state.session) return;
      dashboardCache={key,error:true,at:Date.now()};
    }finally {
      if(dashboardFlight?.key===key) dashboardFlight=null;
      paintDashboard();
    }
  })();
  dashboardFlight={key,promise};return promise;
}

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
  const res = await window.amaredRequest(API_URL, {
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
  dashboardCache=null; dashboardFlight=null; state.session=null;
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
      dashboardCache=null;
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
  const mobile = window.matchMedia('(max-width: 860px)').matches;
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

  document.getElementById("hubDesktopGuidance").hidden=mods.some(m=>["payments","kitchen","delivery"].includes(m.key));
  hubEmpty.style.display = "none";
  hubGrid.innerHTML = mods.map(mod => `
    <button class="hubCard ${["payments","kitchen","delivery"].includes(mod.key)?"hubOperational":"hubDirectory"}" type="button" data-key="${escapeHtml(mod.key)}">
      <div class="hubCardTop">
        <div>
          <h2 class="hubCardTitle">${escapeHtml(mod.title)}</h2>
          <p class="hubCardDesc">${escapeHtml(mod.desc)}</p>
        </div>
        <div class="hubEmoji">${mod.icon}</div>
      </div>
      <div class="hubCardFoot">${["payments","kitchen","delivery"].includes(mod.key) ? `<span class="hubPending" data-pending="${mod.key}">Consultando…</span>` : ""}<span class="btn primary hubCardBtn">${mod.key==="payments"?"Revisar pagos":mod.key==="kitchen"?"Ver producción":mod.key==="delivery"?"Organizar entregas":"Abrir"}</span></div>
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
  paintDashboard(); refreshDashboard();
  // Fetch module assets when the user focuses or points at a module.
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
  if(state.session){ dashboardCache=null; setShell('app'); renderModules(); }
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
