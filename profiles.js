// =================== CONFIG ===================
const API_URL = "https://amared-orders.amaredpostres.workers.dev/";

// =================== STATE ===================
let PROFILES_SECRET = null;
let PROFILES_CACHE = [];
let LOGIN_PROFILES = [];
const LS_PROFILES_PIN_KEY = "AMARED_PROFILES_ADMIN_PIN";
const LS_PROFILES_PROFILE_KEY = "AMARED_PROFILES_PROFILE";
const LS_PROFILES_REMEMBER_KEY = "AMARED_PROFILES_REMEMBER";
const SS_PROFILES_SESSION_KEY = "AMARED_PROFILES_SESSION_V1";
let PROFILE_SESSION = { id: null, label: null, password: null, categories: [] };
const HUB_URL = "hub.html";
const HUB_SESSION_KEY = "AMARED_HUB_SESSION_V1";
const HUB_REMEMBER_KEY = "AMARED_HUB_REMEMBER_V1";
const PROFILES_LOGIN_CACHE_KEY = "AMARED_PAGECACHE_PROFILES_LOGIN_V1";
const PROFILES_DATA_CACHE_KEY = "AMARED_PAGECACHE_PROFILES_DATA_V1";
const FROM_HUB = (() => { try { return new URLSearchParams(window.location.search).get("hub") === "1"; } catch { return false; } })();
function hasHubAccess_(){
  try{ return FROM_HUB || !!sessionStorage.getItem(HUB_SESSION_KEY) || !!localStorage.getItem(HUB_REMEMBER_KEY); }catch(_e){ return FROM_HUB; }
}
function revealHubBoot_(){
  try{ document.documentElement.classList.remove("hubBoot"); document.documentElement.classList.add("hubReady"); }catch(_e){}
}
function goHubFromProfiles_(){
  try{
    const ref = String(document.referrer || '');
    if((FROM_HUB || /(^|\/)hub\.html(?:\?|$)/i.test(ref)) && history.length > 1){
      history.back();
      return;
    }
  }catch(_e){}
  location.href = HUB_URL;
}

// =================== DOM ===================
const btnBack = document.getElementById("btnBack");
const btnGateBack = document.getElementById("btnGateBack");

const gateCard = document.getElementById("gateCard");
const statusCard = document.getElementById("statusCard");
const mgrCard = document.getElementById("mgrCard");

const loginProfile = document.getElementById("loginProfile");
const inpSecret = document.getElementById("inpSecret");
const btnTogglePin = document.getElementById("btnTogglePin");
const chkRememberProfiles = document.getElementById("chkRememberProfiles");
const btnUnlock = document.getElementById("btnUnlock");
const gateErr = document.getElementById("gateErr");

const pillState = document.getElementById("pillState");
const btnLogout = document.getElementById("btnLogout");
const profilesTopbar = document.getElementById("profilesTopbar");
const profilesHero = document.getElementById("profilesHero");

const pillCount = document.getElementById("pillCount");
const btnReload = document.getElementById("btnReload");
const profilesMobileBar = document.getElementById("profilesMobileBar");
const btnMobileReload = document.getElementById("btnMobileReload");
const btnMobileBack = document.getElementById("btnMobileBack");
const btnMobileLock = document.getElementById("btnMobileLock");
const tbody = document.getElementById("tbody");
const profilesMobileList = document.getElementById("profilesMobileList");
const listMsg = document.getElementById("listMsg");

const inpName = document.getElementById("inpName");
const inpId = document.getElementById("inpId");
const inpPassword = document.getElementById("inpPassword");
const inpPassword2 = document.getElementById("inpPassword2");
const btnAdd = document.getElementById("btnAdd");
const mgrErr = document.getElementById("mgrErr");

const loading = document.getElementById("loading");
const loadingTitle = document.getElementById("loadingTitle");
const loadingMsg = document.getElementById("loadingMsg");

function syncProfilesHubChrome(){
  const hubMode = FROM_HUB;
  try{ document.body.classList.toggle("is-hub-flow", hubMode); }catch(_e){}
  if(btnBack){
    btnBack.textContent = hubMode ? "Panel" : "Volver";
    btnBack.setAttribute("aria-label", hubMode ? "Volver al panel" : "Volver");
  }
  if(btnGateBack){
    btnGateBack.textContent = hubMode ? "Volver al panel" : "Volver atrás";
  }
  if(btnLogout){
    btnLogout.style.display = hubMode ? "none" : "";
    if(hubMode) btnLogout.disabled = true;
  }
  if(btnMobileBack){
    const backLabel = hubMode ? "Panel" : "Volver";
    btnMobileBack.setAttribute("aria-label", hubMode ? "Volver al panel" : "Volver");
    const ico = btnMobileBack.querySelector('.ico');
    const txt = btnMobileBack.querySelector('.txt');
    if(ico) ico.textContent = hubMode ? '⌂' : '↩';
    if(txt) txt.textContent = backLabel;
    if(!txt) btnMobileBack.textContent = backLabel;
  }
  if(btnMobileLock){
    btnMobileLock.style.display = hubMode ? "none" : "";
    btnMobileLock.disabled = !!hubMode;
    btnMobileLock.setAttribute("aria-label", hubMode ? "Volver al panel" : "Salir");
    const ico = btnMobileLock.querySelector('.ico');
    const txt = btnMobileLock.querySelector('.txt');
    if(ico) ico.textContent = hubMode ? '⌂' : '⎋';
    if(txt) txt.textContent = hubMode ? 'Panel' : 'Salir';
  }
  if(profilesMobileBar) profilesMobileBar.classList.toggle("isHubMode", hubMode);
}


// --- Edit modal DOM ---
const editBack = document.getElementById("editBack");
const btnEditClose = document.getElementById("btnEditClose");
const btnEditSave = document.getElementById("btnEditSave");
const editName = document.getElementById("editName");
const editId = document.getElementById("editId");
const editCatsWrap = document.getElementById("editCats");
const editPassword = document.getElementById("editPassword");
const editPassword2 = document.getElementById("editPassword2");
const editAdminPinConfirm = document.getElementById("editAdminPinConfirm");
const editErr = document.getElementById("editErr");

let EDITING_ID = null;

function normalizeCategoryAlias(v){
  return String(v || "")
    .trim()
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function normCatsAny(v){
  if(Array.isArray(v)) return v.map(x=>String(x||"").trim().toLowerCase()).filter(Boolean);
  return String(v||"").split(",").map(s=>s.trim().toLowerCase()).filter(Boolean);
}

function openEditModal(profile){
  if(!editBack) return;
  editErr.textContent = "";
  EDITING_ID = normalizeId(profile);
  editId.value = EDITING_ID;
  editName.value = String(profile.label || "").trim();
  if(editPassword) editPassword.value = "";
  if(editPassword2) editPassword2.value = "";
  if(editAdminPinConfirm) editAdminPinConfirm.value = "";

  const cats = normCatsAny(profile.categories);
  const checks = Array.from(editCatsWrap?.querySelectorAll('input[type="checkbox"]') || []);
  for(const c of checks){
    const val = String(c.value||"").trim().toLowerCase();
    c.checked = cats.includes(val);
  }

  editBack.style.display = "flex";
  editBack.setAttribute("aria-hidden","false");
  try{ editBack.scrollTop = 0; editBack.querySelector('.loadingCard')?.scrollTo?.({ top: 0, behavior: 'auto' }); }catch(_e){}
  syncProfilesMobileBar();
  setTimeout(()=>{ try{ editName.focus(); }catch(_e){} }, 0);
}

function closeEditModal(){
  if(!editBack) return;
  EDITING_ID = null;
  if(editPassword) editPassword.value = "";
  if(editPassword2) editPassword2.value = "";
  if(editAdminPinConfirm) editAdminPinConfirm.value = "";
  editBack.style.display = "none";
  editBack.setAttribute("aria-hidden","true");
  syncProfilesMobileBar();
}

function getEditSelectedCategories(){
  const checks = Array.from(editCatsWrap?.querySelectorAll('input[type="checkbox"]') || []);
  return checks.filter(c=>c.checked).map(c=>String(c.value||"").trim()).filter(Boolean);
}


function profileHasCategory(profile, wanted){
  const cats = new Set(normCatsAny(profile?.categories).map(normalizeCategoryAlias).filter(Boolean));
  const w = normalizeCategoryAlias(wanted);
  const aliasesMap = {
    admin: ["admin","administracion"],
    profiles: ["profiles","perfil","perfiles"],
  };
  const aliases = (aliasesMap[w] || [w]).map(normalizeCategoryAlias);
  return aliases.some(a => cats.has(a));
}

// =================== HELPERS ===================
function showLoading(title, msg){
  if(!loading) return;
  loadingTitle.textContent = title || "Cargando…";
  loadingMsg.textContent = msg || "Procesando…";
  loading.style.zIndex = "120000";
  loading.style.display = "flex";
  loading.setAttribute("aria-hidden","false");
  syncProfilesMobileBar();
}
function hideLoading(){
  if(!loading) return;
  loading.style.display = "none";
  loading.setAttribute("aria-hidden","true");
  syncProfilesMobileBar();
}

function escapeHtml(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function slugifyNameToId(name){
  const s = String(name || "")
    .trim()
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s_-]/g, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return s || "";
}

function getSelectedCategories(){
  const checks = Array.from(document.querySelectorAll(".chips input[type=checkbox]"));
  return checks.filter(c=>c.checked).map(c=>String(c.value||"").trim()).filter(Boolean);
}

function syncPinToggleState_(){
  if(!inpSecret || !btnTogglePin) return;
  const hidden = inpSecret.type !== "text";
  btnTogglePin.textContent = hidden ? "👁" : "🙈";
  btnTogglePin.setAttribute("aria-label", hidden ? "Mostrar contraseña" : "Ocultar contraseña");
}

function saveProfilesRemember_(){
  try{
    if(chkRememberProfiles?.checked && PROFILE_SESSION?.id && PROFILE_SESSION?.password){
      localStorage.setItem(LS_PROFILES_PIN_KEY, String(PROFILE_SESSION.password || ""));
      localStorage.setItem(LS_PROFILES_PROFILE_KEY, String(PROFILE_SESSION.id || ""));
      localStorage.setItem(LS_PROFILES_REMEMBER_KEY, "1");
    }else{
      localStorage.removeItem(LS_PROFILES_PIN_KEY);
      localStorage.removeItem(LS_PROFILES_PROFILE_KEY);
      localStorage.removeItem(LS_PROFILES_REMEMBER_KEY);
    }
  }catch(_e){}
}

function clearProfilesRemember_(){
  try{
    localStorage.removeItem(LS_PROFILES_PIN_KEY);
    localStorage.removeItem(LS_PROFILES_PROFILE_KEY);
    localStorage.removeItem(LS_PROFILES_REMEMBER_KEY);
  }catch(_e){}
}

function loadPortalProfilesSession_(){
  try{
    const raw = sessionStorage.getItem(SS_PROFILES_SESSION_KEY);
    const data = raw ? JSON.parse(raw) : null;
    if(data?.id && data?.password) return data;
  }catch(_e){}
  return null;
}
function clearPortalProfilesSession_(){
  try{ sessionStorage.removeItem(SS_PROFILES_SESSION_KEY); }catch(_e){}
}
function getProfilesCacheScope_(scope){
  return String(scope || PROFILE_SESSION?.id || "").trim().toLowerCase();
}
function loadProfilesLoginCache_(){
  try{
    const raw = sessionStorage.getItem(PROFILES_LOGIN_CACHE_KEY);
    const data = raw ? JSON.parse(raw) : null;
    return Array.isArray(data?.items) ? data.items : null;
  }catch(_e){ return null; }
}
function saveProfilesLoginCache_(items){
  try{ sessionStorage.setItem(PROFILES_LOGIN_CACHE_KEY, JSON.stringify({ items: Array.isArray(items) ? items : [] })); }catch(_e){}
}
function loadProfilesDataCache_(scope){
  try{
    const raw = sessionStorage.getItem(PROFILES_DATA_CACHE_KEY);
    const data = raw ? JSON.parse(raw) : null;
    const wanted = getProfilesCacheScope_(scope);
    if(!data || !wanted || String(data.scope || "") !== wanted) return null;
    return data;
  }catch(_e){ return null; }
}
function saveProfilesDataCache_(){
  try{
    const scope = getProfilesCacheScope_();
    if(!scope) return;
    sessionStorage.setItem(PROFILES_DATA_CACHE_KEY, JSON.stringify({
      scope,
      profiles: Array.isArray(PROFILES_CACHE) ? PROFILES_CACHE : [],
      sessionLabel: String(PROFILE_SESSION?.label || ""),
      sessionCategories: Array.isArray(PROFILE_SESSION?.categories) ? PROFILE_SESSION.categories : [],
      ts: Date.now()
    }));
  }catch(_e){}
}
function clearProfilesDataCache_(){
  try{ sessionStorage.removeItem(PROFILES_DATA_CACHE_KEY); }catch(_e){}
}

async function fetchProfilesPublic_(category){
  const out = await api({ action: "profiles_public_list", category });
  return Array.isArray(out.profiles) ? out.profiles : [];
}

function renderLoginProfiles_(rows){
  if(!loginProfile) return;
  const list = Array.isArray(rows) ? rows : [];
  const saved = String(localStorage.getItem(LS_PROFILES_PROFILE_KEY) || "").trim();
  const opts = ['<option value="">Seleccionar…</option>'];
  for(const p of list){
    const id = normalizeId(p);
    const label = String(p.label || id).trim();
    const selected = saved && saved === id ? ' selected' : '';
    opts.push(`<option value="${escapeHtml(id)}"${selected}>${escapeHtml(label)}</option>`);
  }
  if(!list.length) opts.push('<option value="">Sin perfiles habilitados</option>');
  loginProfile.innerHTML = opts.join("");
}

async function populateLoginProfiles_(force = false){
  const cached = !force ? loadProfilesLoginCache_() : null;
  if(cached && cached.length){
    LOGIN_PROFILES = cached;
    renderLoginProfiles_(LOGIN_PROFILES);
    return;
  }
  let rows = [];
  try{ rows = await fetchProfilesPublic_("profiles"); }catch(_e){}
  if(!rows.length){
    try{ rows = await fetchProfilesPublic_("admin"); }catch(_e){}
  }
  LOGIN_PROFILES = Array.isArray(rows) ? rows : [];
  saveProfilesLoginCache_(LOGIN_PROFILES);
  renderLoginProfiles_(LOGIN_PROFILES);
}

async function api(payload){
  const body = Object.assign({}, payload || {});
  if (
    PROFILE_SESSION?.id &&
    PROFILE_SESSION?.password &&
    body.action !== "profiles_auth" &&
    body.action !== "validate_admin_pin" &&
    body.action !== "profiles_public_list" &&
    !body.auth_profile_id
  ) {
    body.auth_profile_id = String(PROFILE_SESSION.id || "").trim();
    body.auth_profile_password = String(PROFILE_SESSION.password || "").trim();
    body.auth_page = "profiles";
  }
  delete body.profiles_secret;
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(()=> ({}));
  if(!res.ok || data.ok===false){
    const msg = data.error || data.message || `HTTP ${res.status}`;
    const err = new Error(msg);
    err._raw = data;
    err._status = res.status;
    throw err;
  }
  return data;
}


function syncProfilesMobileBar(){
  if(!profilesMobileBar) return;
  const mobile = window.matchMedia("(max-width: 720px)").matches;
  const unlocked = !!mgrCard && mgrCard.style.display !== "none";
  const gateVisible = !!gateCard && gateCard.style.display !== "none";
  const hasOverlay = (editBack && editBack.style.display === "flex") || (loading && loading.style.display === "flex");
  profilesMobileBar.classList.toggle("isVisible", mobile && unlocked && !gateVisible && !hasOverlay);
  profilesMobileBar.classList.toggle("isHubMode", FROM_HUB);
}

function setLockedUI(locked){
  try{
    document.body.classList.remove("is-login","is-app");
    document.body.classList.add(locked ? "is-login" : "is-app");
  }catch(_e){}
  if(locked){
    if(btnLogout) btnLogout.disabled = true;
    if(mgrCard) mgrCard.style.display = "none";
    if(statusCard) statusCard.style.display = "none";
    if(gateCard) gateCard.style.display = "";
    if(profilesTopbar) profilesTopbar.classList.add("profilesTopbarHidden");
    if(profilesHero) profilesHero.classList.add("hidden");
    syncProfilesMobileBar();
  }else{
    if(btnLogout) btnLogout.disabled = !!FROM_HUB;
    if(mgrCard) mgrCard.style.display = "block";
    if(statusCard) statusCard.style.display = "none";
    if(gateCard) gateCard.style.display = "none";
    if(profilesTopbar) profilesTopbar.classList.remove("profilesTopbarHidden");
    if(profilesHero) profilesHero.classList.add("hidden");
    syncProfilesMobileBar();
  }
}



// =================== CONFIRM MODAL (2s) ===================
function ensureConfirmModal(){
  if(document.getElementById("confirmModal")) return;

  const style = document.createElement("style");
  style.id = "confirmModalStyles";
  style.textContent = `
    .cmOverlay{
      position: fixed; inset: 0;
      display: none;
      align-items: center; justify-content: center;
      background: rgba(0,0,0,.28);
      z-index: 9999;
      padding: 16px;
    }
    .cmBox{
      width: min(520px, 100%);
      background: rgba(255,255,255,.92);
      border: 1px solid rgba(0,0,0,.06);
      border-radius: 18px;
      box-shadow: 0 18px 45px rgba(0,0,0,.18);
      padding: 18px;
    }
    .cmTitle{
      font-weight: 800;
      font-size: 20px;
      color: #3b1a0d;
      margin: 0 0 6px 0;
    }
    .cmMsg{
      margin: 0 0 14px 0;
      color: rgba(59,26,13,.85);
      line-height: 1.35;
    }
    .cmRow{
      display:flex; gap:10px; justify-content:flex-end; flex-wrap:wrap;
    }
    .cmBtn{
      border: 0;
      border-radius: 14px;
      padding: 10px 14px;
      font-weight: 800;
      cursor: pointer;
    }
    .cmBtn:disabled{ opacity:.55; cursor:not-allowed; }
    .cmCancel{
      background: #f1e7df;
      color: #3b1a0d;
    }
    .cmDanger{
      background: linear-gradient(90deg, #ff6aa1, #ff9a5b);
      color: white;
      min-width: 160px;
    }
    .cmTimer{
      display:flex; align-items:center; justify-content:space-between;
      gap:10px;
      margin: 10px 0 14px 0;
      color: rgba(59,26,13,.8);
      font-weight: 700;
      font-size: 13px;
    }
    .cmBar{
      flex:1;
      height: 8px;
      border-radius: 999px;
      background: rgba(0,0,0,.08);
      overflow:hidden;
    }
    .cmBar > div{
      height: 100%;
      width: 0%;
      background: rgba(255,106,161,.75);
      transition: width .15s linear;
    }
  `;
  document.head.appendChild(style);

  const overlay = document.createElement("div");
  overlay.id = "confirmModal";
  overlay.className = "cmOverlay";
  overlay.setAttribute("aria-hidden","true");
  overlay.innerHTML = `
    <div class="cmBox" role="dialog" aria-modal="true" aria-labelledby="cmTitle">
      <div class="cmTitle" id="cmTitle">Confirmar acción</div>
      <p class="cmMsg" id="cmMsg"></p>

      <div class="cmTimer">
        <span id="cmCountdownText">Verificación…</span>
        <div class="cmBar"><div id="cmBarFill"></div></div>
      </div>

      <div class="cmRow">
        <button class="cmBtn cmCancel" id="cmCancelBtn" type="button">Cancelar</button>
        <button class="cmBtn cmDanger" id="cmOkBtn" type="button" disabled>Eliminar (2s)</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

function confirmWithTimer({title, message, okLabel="Eliminar", seconds=2}){
  ensureConfirmModal();
  const overlay = document.getElementById("confirmModal");
  const elTitle = document.getElementById("cmTitle");
  const elMsg = document.getElementById("cmMsg");
  const btnCancel = document.getElementById("cmCancelBtn");
  const btnOk = document.getElementById("cmOkBtn");
  const txt = document.getElementById("cmCountdownText");
  const bar = document.getElementById("cmBarFill");

  let resolveFn;
  const p = new Promise(res=> resolveFn = res);

  elTitle.textContent = title || "Confirmar acción";
  elMsg.textContent = message || "";
  overlay.style.display = "flex";
  overlay.setAttribute("aria-hidden","false");

  // timer lock
  const totalMs = Math.max(0, Number(seconds||0))*1000;
  const start = performance.now();
  btnOk.disabled = true;

  const setBtnText = (leftMs)=>{
    const left = Math.max(0, Math.ceil(leftMs/1000));
    btnOk.textContent = `${okLabel} (${left}s)`;
  };
  setBtnText(totalMs);

  let rafId = 0;
  const tick = ()=>{
    const now = performance.now();
    const elapsed = now - start;
    const left = totalMs - elapsed;
    const pct = totalMs<=0 ? 100 : Math.min(100, (elapsed/totalMs)*100);
    bar.style.width = `${pct}%`;
    if(left > 0){
      txt.textContent = "Espera para confirmar…";
      setBtnText(left);
      rafId = requestAnimationFrame(tick);
    }else{
      txt.textContent = "Listo para confirmar.";
      bar.style.width = "100%";
      btnOk.disabled = false;
      btnOk.textContent = okLabel;
    }
  };
  rafId = requestAnimationFrame(tick);

  const cleanup = ()=>{
    cancelAnimationFrame(rafId);
    overlay.style.display = "none";
    overlay.setAttribute("aria-hidden","true");
    btnCancel.onclick = null;
    btnOk.onclick = null;
    overlay.onclick = null;
    document.removeEventListener("keydown", onKey);
  };

  const done = (val)=>{
    cleanup();
    resolveFn(val);
  };

  const onKey = (e)=>{
    if(e.key === "Escape") done(false);
  };
  document.addEventListener("keydown", onKey);

  overlay.onclick = (e)=>{
    if(e.target === overlay) done(false);
  };
  btnCancel.onclick = ()=> done(false);
  btnOk.onclick = ()=> done(true);

  return p;
}

// =================== RENDER ===================
function categoriesBadgesHtml(profile){
  return String(profile?.categories || "")
    .split(",")
    .map(s=>s.trim())
    .filter(Boolean)
    .map(c=>`<span class="badge">${escapeHtml(c)}</span>`)
    .join(" ");
}

function passStateHtml(profile){
  return profile?.has_password
    ? `<span class="badge" style="background:rgba(246,186,96,.18); border-color:rgba(246,186,96,.35);">Configurada</span>`
    : `<span class="badge" style="background:rgba(242,91,143,.10); border-color:rgba(242,91,143,.25);">Pendiente</span>`;
}

function renderMobileProfiles(rows){
  if(!profilesMobileList) return;
  const active = (rows||[]).filter(isActive);
  if(active.length===0){
    profilesMobileList.innerHTML = `<div class="muted small" style="padding:12px 4px;">Sin datos.</div>`;
    return;
  }

  profilesMobileList.innerHTML = active.map((p, idx)=>{
    const pid = normalizeId(p);
    const cats = categoriesBadgesHtml(p);
    const passState = passStateHtml(p);
    const open = idx === 0 ? ' open' : '';
    return `
      <details class="profilesAccCard" data-id="${escapeHtml(pid)}"${open}>
        <summary>
          <div style="min-width:0;">
            <div class="profilesAccName">${escapeHtml(p.label||pid||"Perfil")}</div>
            <div class="profilesAccMeta">Toca para ver ID, rangos, clave y acciones</div>
          </div>
          <div class="profilesAccChevron" aria-hidden="true">▾</div>
        </summary>
        <div class="profilesAccBody">
          <div class="profilesAccRow">
            <div class="profilesAccLabel">ID</div>
            <div class="profilesAccValue"><code>${escapeHtml(pid)}</code></div>
          </div>
          <div class="profilesAccRow">
            <div class="profilesAccLabel">Categorías</div>
            <div class="profilesAccValue">${cats || `<span class="muted small">—</span>`}</div>
          </div>
          <div class="profilesAccRow">
            <div class="profilesAccLabel">Clave</div>
            <div class="profilesAccValue">${passState}</div>
          </div>
          <div class="profilesAccActions">
            <button class="btn secondary btnEdit" data-id="${escapeHtml(pid)}" type="button">Editar</button>
            <button class="btn secondary btnDel" data-id="${escapeHtml(pid)}" type="button">Eliminar</button>
          </div>
        </div>
      </details>
    `;
  }).join("");
}

function normalizeId(p){
  return String(p?.profile_id ?? p?.id ?? p?.profileId ?? "").trim();
}

function isActive(p){
  const v = p?.is_active;
  if(typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toLowerCase();
  if(s === "false" || s === "0" || s === "no") return false;
  return true; // por defecto activo
}

function renderTable(rows){
  if(tbody) tbody.innerHTML = "";
  if(profilesMobileList) profilesMobileList.innerHTML = "";
  const active = (rows||[]).filter(isActive);
  if(pillCount) pillCount.textContent = `${active.length} perfiles`;

  if(active.length===0){
    if(tbody) tbody.innerHTML = `<tr><td colspan="5" class="muted small">Sin datos.</td></tr>`;
    if(profilesMobileList) profilesMobileList.innerHTML = `<div class="muted small" style="padding:12px 4px;">Sin datos.</div>`;
    return;
  }

  for(const p of active){
    const pid = normalizeId(p);
    const cats = categoriesBadgesHtml(p);
    const passState = passStateHtml(p);

    if(tbody){
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><code>${escapeHtml(pid)}</code></td>
        <td>${escapeHtml(p.label||"")}</td>
        <td>${cats || `<span class="muted small">—</span>`}</td>
        <td>${passState}</td>
        <td style="display:flex; gap:8px; flex-wrap:wrap;"><button class="btn secondary btnEdit" data-id="${escapeHtml(pid)}" type="button">Editar</button><button class="btn secondary btnDel" data-id="${escapeHtml(pid)}" type="button">Eliminar</button></td>
      `;
      tbody.appendChild(tr);
    }
  }

  renderMobileProfiles(active);
}

// Delegación de eventos: Editar / Eliminar (tabla y acordeones móviles)
async function handleProfilesListClick(ev){
  const btnE = ev.target?.closest?.(".btnEdit");
  if(btnE){
    const id = String(btnE.getAttribute("data-id")||"").trim();
    const p = (PROFILES_CACHE || []).find(x => normalizeId(x) === id);
    if(p) openEditModal(p);
    return;
  }

  const btn = ev.target?.closest?.(".btnDel");
  if(!btn) return;
  const id = String(btn.getAttribute("data-id")||"").trim();
  if(!id) return;

  const ok = await confirmWithTimer({
    title: "Eliminar perfil",
    message: `¿Seguro que deseas eliminar el perfil "${id}"? Se marcará como inactivo en la base de datos.`,
    okLabel: "Eliminar",
    seconds: 2
  });
  if(!ok) return;

  mgrErr.textContent = "";
  try{
    showLoading("Eliminando…", "Actualizando base de datos…");
    await api({
      action: "profiles_delete",
      profile_id: id
    });
    await loadProfiles(true);
  }catch(e){
    mgrErr.textContent = e.message || "Error eliminando.";
    console.error("delete error:", e, e._raw);
  }finally{
    hideLoading();
    revealHubBoot_();
  }
}

tbody?.addEventListener("click", handleProfilesListClick);
profilesMobileList?.addEventListener("click", handleProfilesListClick);


// =================== DATA ===================
async function loadProfiles(force = false){
  if(!PROFILE_SESSION?.id || !PROFILE_SESSION?.password) throw new Error("No autorizado.");
  listMsg.textContent = "";
  mgrErr.textContent = "";

  if(!force){
    const cached = loadProfilesDataCache_();
    if(cached){
      PROFILES_CACHE = Array.isArray(cached.profiles) ? cached.profiles : [];
      renderTable(PROFILES_CACHE);
      listMsg.textContent = `Mostrando caché de la sesión (${new Date(Number(cached.ts || Date.now())).toLocaleString("es-CO")})`;
      return;
    }
  }

  showLoading("Cargando…", "Leyendo perfiles…");
  try{
    const out = await api({ action: "profiles_list" });
    PROFILES_CACHE = Array.isArray(out.profiles) ? out.profiles : [];
    saveProfilesDataCache_();
    renderTable(PROFILES_CACHE);
    listMsg.textContent = `Actualizado: ${new Date().toLocaleString("es-CO")}`;
  }finally{
    hideLoading();
  }
}

// =================== EVENTS ===================

function goBackFromProfiles_(){
  if(FROM_HUB){
    goHubFromProfiles_();
    return;
  }
  if(history.length > 1) history.back();
  else location.href = "index.html";
}

btnBack?.addEventListener("click", goBackFromProfiles_);
btnGateBack?.addEventListener("click", goBackFromProfiles_);

inpName?.addEventListener("input", ()=>{
  inpId.value = slugifyNameToId(inpName.value);
});

btnUnlock?.addEventListener("click", async ()=>{
  gateErr.textContent = "";
  const profileId = String(loginProfile?.value || "").trim();
  const secret = String(inpSecret.value||"").trim();
  if(!profileId){
    gateErr.textContent = "Selecciona un perfil.";
    revealHubBoot_();
    return;
  }
  if(!secret){
    gateErr.textContent = "Ingresa la contraseña.";
    revealHubBoot_();
    return;
  }

  try{
    showLoading("Validando…", "Comprobando acceso…");
    const auth = await api({ action: "profiles_auth", profile_id: profileId, password_plain: secret });
    const allowed = profileHasCategory(auth?.profile || {}, "admin") || profileHasCategory(auth?.profile || {}, "profiles");
    if(auth.valid !== true || !allowed) throw new Error(auth?.error || "Perfil sin permisos para gestionar perfiles.");

    PROFILE_SESSION = {
      id: profileId,
      label: auth?.profile?.label || (LOGIN_PROFILES.find(p => normalizeId(p) === profileId)?.label || profileId),
      password: secret,
      categories: auth?.profile?.categories || []
    };
    saveProfilesRemember_();
    setLockedUI(false);
    await loadProfiles(true);
    listMsg.textContent = "Acceso concedido.";
    gateErr.textContent = "";
  }catch(e){
    PROFILE_SESSION = { id:null, label:null, password:null, categories:[] };
    clearProfilesRemember_();
    setLockedUI(true);
    gateErr.textContent = e?.message || "Contraseña incorrecta o no autorizada.";
    console.error("unlock error:", e, e._raw);
  }finally{
    hideLoading();
    revealHubBoot_();
  }
});

btnLogout?.addEventListener("click", ()=>{
  PROFILE_SESSION = { id:null, label:null, password:null, categories:[] };
  clearProfilesDataCache_();
  if(inpSecret) inpSecret.value = "";
  if(loginProfile) loginProfile.value = "";
  clearProfilesRemember_();
  clearPortalProfilesSession_();
  setLockedUI(true);
});

btnReload?.addEventListener("click", async ()=>{
  try{
    await loadProfiles(true);
  }catch(e){
    mgrErr.textContent = e.message || "Error cargando perfiles.";
  }
});

btnAdd?.addEventListener("click", async ()=>{
  mgrErr.textContent = "";
  const name = String(inpName.value||"").trim();
  const id = String(inpId.value||"").trim();
  const password = String(inpPassword?.value||"").trim();
  const password2 = String(inpPassword2?.value||"").trim();
  const cats = getSelectedCategories();

  if(!PROFILE_SESSION?.id || !PROFILE_SESSION?.password){
    mgrErr.textContent = "Primero inicia sesión.";
    return;
  }
  if(!name){
    mgrErr.textContent = "Ingresa el nombre.";
    return;
  }
  if(!id){
    mgrErr.textContent = "ID inválido.";
    return;
  }
  if(cats.length===0){
    mgrErr.textContent = "Selecciona al menos una categoría.";
    return;
  }
  if(!password){
    mgrErr.textContent = "Ingresa una contraseña inicial para el perfil.";
    return;
  }
  if(password.length < 4){
    mgrErr.textContent = "La contraseña debe tener al menos 4 caracteres.";
    return;
  }
  if(password !== password2){
    mgrErr.textContent = "Las contraseñas no coinciden.";
    return;
  }

  try{
    showLoading("Guardando…", "Creando perfil…");
    await api({
      action: "profiles_add",
      profile_id: id,
      label: name,
      categories: cats.join(","),
      password_plain: password
    });

    inpName.value = "";
    inpId.value = "";
    if(inpPassword) inpPassword.value = "";
    if(inpPassword2) inpPassword2.value = "";
    await loadProfiles(true);
  }catch(e){
    mgrErr.textContent = e.message || "Error agregando perfil.";
    console.error("add error:", e, e._raw);
  }finally{
    hideLoading();
  }
});

// --- Edit modal events ---
btnEditClose?.addEventListener("click", closeEditModal);
editBack?.addEventListener("click", (ev)=>{
  if(ev.target === editBack) closeEditModal();
});

btnEditSave?.addEventListener("click", async ()=>{
  editErr.textContent = "";

  if(!PROFILE_SESSION?.id || !PROFILE_SESSION?.password){
    editErr.textContent = "Primero inicia sesión.";
    return;
  }
  const id = String(EDITING_ID || editId.value || "").trim();
  const name = String(editName.value||"").trim();
  const newPassword = String(editPassword?.value||"").trim();
  const newPassword2 = String(editPassword2?.value||"").trim();
  const confirmPin = String(editAdminPinConfirm?.value||"").trim();
  const cats = getEditSelectedCategories();

  if(!id){
    editErr.textContent = "ID inválido.";
    return;
  }
  if(!name){
    editErr.textContent = "Ingresa el nombre.";
    return;
  }
  if(cats.length===0){
    editErr.textContent = "Selecciona al menos una categoría.";
    return;
  }
  if(newPassword || newPassword2){
    if(newPassword.length < 4){
      editErr.textContent = "La nueva contraseña debe tener al menos 4 caracteres.";
      return;
    }
    if(newPassword !== newPassword2){
      editErr.textContent = "Las nuevas contraseñas no coinciden.";
      return;
    }
    if(!confirmPin){
      editErr.textContent = "Ingresa el código admin para confirmar el cambio de contraseña.";
      return;
    }
    const validCode = await api({ action: "validate_admin_pin", admin_pin: confirmPin });
    if(validCode.valid !== true){
      editErr.textContent = "El código admin de confirmación no es válido.";
      return;
    }
  }

  try{
    showLoading("Guardando…", "Actualizando perfil…");
    await api({
      action: "profiles_add", // ✅ upsert en backend
      profile_id: id,
      label: name,
      categories: cats.join(","),
      password_plain: newPassword || undefined,
      updated_by: "PROFILES_UI"
    });
    closeEditModal();
    await loadProfiles(true);
  }catch(e){
    editErr.textContent = e.message || "Error guardando.";
    console.error("edit error:", e, e._raw);
  }finally{
    hideLoading();
  }
});


// init UI locked
setLockedUI(true);
syncProfilesHubChrome();


btnTogglePin?.addEventListener("click", ()=>{
  if(!inpSecret) return;
  inpSecret.type = (inpSecret.type === "password") ? "text" : "password";
  syncPinToggleState_();
});
inpSecret?.addEventListener("keydown", (e)=>{ if(e.key === "Enter") btnUnlock?.click(); });

(async function bootProfilesLogin_(){
  const hubBootFailsafe = setTimeout(()=>{
    revealHubBoot_();
  }, 3500);
  let shouldAutoUnlock = false;
  try{
    syncPinToggleState_();
    showLoading("Cargando perfiles…", "Buscando perfiles de perfiles.");
    await populateLoginProfiles_();

    const portalSession = loadPortalProfilesSession_();
    const remembered = localStorage.getItem(LS_PROFILES_REMEMBER_KEY) === "1";
    const savedPin = String(localStorage.getItem(LS_PROFILES_PIN_KEY) || "").trim();
    const savedProfile = String(localStorage.getItem(LS_PROFILES_PROFILE_KEY) || "").trim();

    if(portalSession?.id && portalSession?.password){
      if(chkRememberProfiles) chkRememberProfiles.checked = !!portalSession.remember;
      if(loginProfile) loginProfile.value = String(portalSession.id || "").trim();
      if(inpSecret) inpSecret.value = String(portalSession.password || "").trim();
      const fastCache = loadProfilesDataCache_(String(portalSession.id || "").trim());
      if(fastCache){
        PROFILE_SESSION = {
          id: String(portalSession.id || "").trim(),
          label: String(portalSession.label || fastCache.sessionLabel || portalSession.id || "").trim(),
          password: String(portalSession.password || "").trim(),
          categories: Array.isArray(fastCache.sessionCategories) ? fastCache.sessionCategories : []
        };
        setLockedUI(false);
        await loadProfiles(false);
      }else{
        shouldAutoUnlock = true;
      }
    }else if(savedPin && remembered && savedProfile){
      if(chkRememberProfiles) chkRememberProfiles.checked = remembered;
      if(loginProfile) loginProfile.value = savedProfile;
      if(inpSecret) inpSecret.value = savedPin;
      const fastCache = loadProfilesDataCache_(savedProfile);
      if(fastCache){
        PROFILE_SESSION = {
          id: savedProfile,
          label: String(fastCache.sessionLabel || savedProfile),
          password: savedPin,
          categories: Array.isArray(fastCache.sessionCategories) ? fastCache.sessionCategories : []
        };
        setLockedUI(false);
        await loadProfiles(false);
      }else{
        shouldAutoUnlock = true;
      }
    }else{
      if(chkRememberProfiles) chkRememberProfiles.checked = false;
      setLockedUI(true);
    }
  }catch(_e){
    setLockedUI(true);
  }finally{
    hideLoading();
    if(!shouldAutoUnlock) revealHubBoot_();
    clearTimeout(hubBootFailsafe);
  }
  if(shouldAutoUnlock) btnUnlock?.click();
})();

syncProfilesHubChrome();
btnMobileReload?.addEventListener("click", ()=> btnReload?.click());
btnMobileBack?.addEventListener("click", ()=> {
  if(FROM_HUB) goHubFromProfiles_();
  else btnBack?.click();
});
btnMobileLock?.addEventListener("click", ()=> {
  if(FROM_HUB) goHubFromProfiles_();
  else btnLogout?.click();
});
window.addEventListener("resize", ()=>{ syncProfilesHubChrome(); syncProfilesMobileBar(); });
setTimeout(()=>{ syncProfilesHubChrome(); syncProfilesMobileBar(); }, 0);
