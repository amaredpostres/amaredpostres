const API_URL = "https://amared-orders.amaredpostres.workers.dev/";
const HUB_SS_KEY = "AMARED_HUB_SESSION_V1";
const HUB_LS_KEY = "AMARED_HUB_REMEMBER_V1";
const PROFILES_SS_KEY = "AMARED_PROFILES_SESSION_V1";
const COSTS_SS_KEY = "AMARED_COSTS_SESSION_V1";
const HUB_PROFILES_CACHE_KEY = "AMARED_HUB_PROFILES_CACHE_V1";
const HUB_PROFILES_CACHE_TTL = 5 * 60 * 1000;

const MODULES = [
  { key:"kitchen", title:"Cocina", desc:"Gestiona la preparación y el avance de los pedidos.", href:"kitchen.html", icon:"🍰", allow:["kitchen","admin"] },
  { key:"payments", title:"Pagos", desc:"Confirma pagos y revisa pedidos pendientes.", href:"admin.html", icon:"💳", allow:["payments","pago","admin"] },
  { key:"delivery", title:"Envíos", desc:"Revisa pedidos listos y confirma entregas.", href:"delivery.html", icon:"📦", allow:["delivery","admin"] },
  { key:"costs", title:"Compras y Recetas", desc:"Consulta compras, costos y recetas del día.", href:"costs.html", icon:"🧾", allow:["costs","purchases","admin"] },
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

function renderProfiles(list){
  const rows = Array.isArray(list) ? list : [];
  const opts = ['<option value="">Seleccionar…</option>'];
  for(const p of rows){
    const id = String(p.id || p.profile_id || "").trim();
    const label = String(p.label || id).trim();
    if(!id || !label) continue;
    opts.push(`<option value="${escapeHtml(id)}">${escapeHtml(label)}</option>`);
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

async function loadProfiles(force=false){
  const cached = !force ? getCachedProfiles() : null;
  if(cached && cached.length){
    state.profiles = cached.filter(p => normalizeCats(p.categories).length > 0);
    renderProfiles(state.profiles);
  }
  if(cached && !force) return;
  showLoading("Cargando perfiles…", "Buscando perfiles disponibles.");
  try{
    const out = await api({ action:"profiles_public_list" });
    const list = Array.isArray(out.profiles) ? out.profiles : [];
    state.profiles = list.filter(p => normalizeCats(p.categories).length > 0);
    setCachedProfiles(state.profiles);
    renderProfiles(state.profiles);
  } finally {
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
  showLoading(`Abriendo ${mod.title}…`, 'Preparando acceso a la página seleccionada.');
  try{
    if(hubGrid){
      hubGrid.style.pointerEvents = 'none';
      hubGrid.style.opacity = '.92';
    }
  }catch(_e){}
  window.setTimeout(()=>{
    window.location.href = `${mod.href}?hub=1`;
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
document.getElementById('btnHubReload')?.addEventListener('click', ()=> renderModules());
document.getElementById('btnHubLogout')?.addEventListener('click', ()=>{ clearHubSession(); if(hubPassword) hubPassword.value = ''; setShell('login'); syncMobileBar(); });
document.getElementById('btnHubMobileRefresh')?.addEventListener('click', ()=> renderModules());
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
  const restored = await restoreSession();
  if(!restored){
    await loadProfiles();
    setShell('login');
  } else {
    loadProfiles(true).catch(()=>{});
  }
  resetHubBusyState();
})();
