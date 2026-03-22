// =================== CONFIG ===================
const API_URL = "https://amared-orders.amaredpostres.workers.dev/";

// =================== STATE ===================
let PROFILES_SECRET = null;
let PROFILES_CACHE = [];
let LOGIN_PROFILES = [];
const LS_PROFILES_PIN_KEY = "AMARED_PROFILES_ADMIN_PIN";
const LS_PROFILES_PROFILE_KEY = "AMARED_PROFILES_PROFILE";
const LS_PROFILES_REMEMBER_KEY = "AMARED_PROFILES_REMEMBER";

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
const listMsg = document.getElementById("listMsg");

const inpName = document.getElementById("inpName");
const inpId = document.getElementById("inpId");
const btnAdd = document.getElementById("btnAdd");
const mgrErr = document.getElementById("mgrErr");

const loading = document.getElementById("loading");
const loadingTitle = document.getElementById("loadingTitle");
const loadingMsg = document.getElementById("loadingMsg");


// --- Edit modal DOM ---
const editBack = document.getElementById("editBack");
const btnEditClose = document.getElementById("btnEditClose");
const btnEditSave = document.getElementById("btnEditSave");
const editName = document.getElementById("editName");
const editId = document.getElementById("editId");
const editCatsWrap = document.getElementById("editCats");
const editErr = document.getElementById("editErr");

let EDITING_ID = null;

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

  const cats = normCatsAny(profile.categories);
  const checks = Array.from(editCatsWrap?.querySelectorAll('input[type="checkbox"]') || []);
  for(const c of checks){
    const val = String(c.value||"").trim().toLowerCase();
    c.checked = cats.includes(val);
  }

  editBack.style.display = "flex";
  editBack.setAttribute("aria-hidden","false");
  syncProfilesMobileBar();
  setTimeout(()=>{ try{ editName.focus(); }catch(_e){} }, 0);
}

function closeEditModal(){
  if(!editBack) return;
  EDITING_ID = null;
  editBack.style.display = "none";
  editBack.setAttribute("aria-hidden","true");
  syncProfilesMobileBar();
}

function getEditSelectedCategories(){
  const checks = Array.from(editCatsWrap?.querySelectorAll('input[type="checkbox"]') || []);
  return checks.filter(c=>c.checked).map(c=>String(c.value||"").trim()).filter(Boolean);
}


// =================== HELPERS ===================
function showLoading(title, msg){
  if(!loading) return;
  loadingTitle.textContent = title || "Cargando…";
  loadingMsg.textContent = msg || "Procesando…";
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
  btnTogglePin.setAttribute("aria-label", hidden ? "Mostrar PIN" : "Ocultar PIN");
}

function saveProfilesRemember_(){
  try{
    if(chkRememberProfiles?.checked && PROFILES_SECRET){
      localStorage.setItem(LS_PROFILES_PIN_KEY, PROFILES_SECRET);
      localStorage.setItem(LS_PROFILES_PROFILE_KEY, String(loginProfile?.value || "").trim());
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

async function populateLoginProfiles_(){
  let rows = [];
  try{ rows = await fetchProfilesPublic_("profiles"); }catch(_e){}
  if(!rows.length){
    try{ rows = await fetchProfilesPublic_("admin"); }catch(_e){}
  }
  LOGIN_PROFILES = Array.isArray(rows) ? rows : [];
  renderLoginProfiles_(LOGIN_PROFILES);
}

async function api(payload){
  const body = Object.assign({}, payload || {});
  if(PROFILES_SECRET && !body.admin_pin){
    body.admin_pin = PROFILES_SECRET;
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
    if(btnLogout) btnLogout.disabled = false;
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
  tbody.innerHTML = "";
  const active = (rows||[]).filter(isActive);
  pillCount.textContent = `${active.length} perfiles`;

  if(active.length===0){
    tbody.innerHTML = `<tr><td colspan="4" class="muted small">Sin datos.</td></tr>`;
    return;
  }

  for(const p of active){
    const pid = normalizeId(p);
    const cats = String(p.categories||"")
      .split(",")
      .map(s=>s.trim())
      .filter(Boolean)
      .map(c=>`<span class="badge">${escapeHtml(c)}</span>`)
      .join(" ");

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><code>${escapeHtml(pid)}</code></td>
      <td>${escapeHtml(p.label||"")}</td>
      <td>${cats || `<span class="muted small">—</span>`}</td>
      <td style="display:flex; gap:8px; flex-wrap:wrap;"><button class="btn secondary btnEdit" data-id="${escapeHtml(pid)}">Editar</button><button class="btn secondary btnDel" data-id="${escapeHtml(pid)}">Eliminar</button></td>
    `;
    tbody.appendChild(tr);
  }
}

// Delegación de eventos: el botón Eliminar siempre funciona aunque la tabla se re-renderice

// Delegación de eventos: Editar / Eliminar (funciona aunque la tabla se re-renderice)
tbody?.addEventListener("click", async (ev)=>{
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
      admin_pin: PROFILES_SECRET,
      profile_id: id
    });
    await loadProfiles();
  }catch(e){
    mgrErr.textContent = e.message || "Error eliminando.";
    console.error("delete error:", e, e._raw);
  }finally{
    hideLoading();
  }
});


// =================== DATA ===================
async function loadProfiles(){
  if(!PROFILES_SECRET) throw new Error("No autorizado.");
  listMsg.textContent = "";
  mgrErr.textContent = "";

  showLoading("Cargando…", "Leyendo perfiles…");
  try{
    const out = await api({
      action: "profiles_list",
      admin_pin: PROFILES_SECRET
    });
    PROFILES_CACHE = Array.isArray(out.profiles) ? out.profiles : [];
    renderTable(PROFILES_CACHE);
    listMsg.textContent = `Actualizado: ${new Date().toLocaleString("es-CO")}`;
  }finally{
    hideLoading();
  }
}

// =================== EVENTS ===================
function goBackFromProfiles_(){
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
    return;
  }
  if(!secret){
    gateErr.textContent = "Ingresa el PIN.";
    return;
  }

  try{
    showLoading("Validando…", "Comprobando acceso…");
    const v = await api({ action: "validate_admin_pin", admin_pin: secret });
    if(v.valid !== true) throw new Error("PIN incorrecto o no autorizado.");

    const out = await api({
      action: "profiles_list",
      admin_pin: secret
    });

    PROFILES_SECRET = secret;
    saveProfilesRemember_();
    setLockedUI(false);

    PROFILES_CACHE = Array.isArray(out.profiles) ? out.profiles : [];
    renderTable(PROFILES_CACHE);
    listMsg.textContent = "Acceso concedido.";
    gateErr.textContent = "";
  }catch(e){
    PROFILES_SECRET = null;
    clearProfilesRemember_();
    setLockedUI(true);
    gateErr.textContent = "PIN incorrecto o no autorizado.";
    console.error("unlock error:", e, e._raw);
  }finally{
    hideLoading();
  }
});

btnLogout?.addEventListener("click", ()=>{
  PROFILES_SECRET = null;
  if(inpSecret) inpSecret.value = "";
  if(loginProfile) loginProfile.value = "";
  clearProfilesRemember_();
  setLockedUI(true);
});

btnReload?.addEventListener("click", async ()=>{
  try{
    await loadProfiles();
  }catch(e){
    mgrErr.textContent = e.message || "Error cargando perfiles.";
  }
});

btnAdd?.addEventListener("click", async ()=>{
  mgrErr.textContent = "";
  const name = String(inpName.value||"").trim();
  const id = String(inpId.value||"").trim();
  const cats = getSelectedCategories();

  if(!PROFILES_SECRET){
    mgrErr.textContent = "Primero ingresa la clave.";
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

  try{
    showLoading("Guardando…", "Creando perfil…");
    await api({
      action: "profiles_add",
      admin_pin: PROFILES_SECRET,
      profile_id: id,
      label: name,
      categories: cats.join(",")
    });

    inpName.value = "";
    inpId.value = "";
    await loadProfiles();
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

  if(!PROFILES_SECRET){
    editErr.textContent = "Primero ingresa la clave.";
    return;
  }
  const id = String(EDITING_ID || editId.value || "").trim();
  const name = String(editName.value||"").trim();
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

  try{
    showLoading("Guardando…", "Actualizando perfil…");
    await api({
      action: "profiles_add", // ✅ upsert en backend
      admin_pin: PROFILES_SECRET,
      profile_id: id,
      label: name,
      categories: cats.join(","),
      updated_by: "PROFILES_UI"
    });
    closeEditModal();
    await loadProfiles();
  }catch(e){
    editErr.textContent = e.message || "Error guardando.";
    console.error("edit error:", e, e._raw);
  }finally{
    hideLoading();
  }
});


// init UI locked
setLockedUI(true);


btnTogglePin?.addEventListener("click", ()=>{
  if(!inpSecret) return;
  inpSecret.type = (inpSecret.type === "password") ? "text" : "password";
  syncPinToggleState_();
});
inpSecret?.addEventListener("keydown", (e)=>{ if(e.key === "Enter") btnUnlock?.click(); });

(async function bootProfilesLogin_(){
  let shouldAutoUnlock = false;
  try{
    syncPinToggleState_();
    showLoading("Cargando perfiles…", "Buscando perfiles de perfiles.");
    await populateLoginProfiles_();
    const remembered = localStorage.getItem(LS_PROFILES_REMEMBER_KEY) === "1";
    const savedPin = String(localStorage.getItem(LS_PROFILES_PIN_KEY) || "").trim();
    const savedProfile = String(localStorage.getItem(LS_PROFILES_PROFILE_KEY) || "").trim();
    if(chkRememberProfiles) chkRememberProfiles.checked = remembered;
    if(savedProfile && loginProfile) loginProfile.value = savedProfile;
    if(savedPin && remembered && savedProfile){
      if(inpSecret) inpSecret.value = savedPin;
      shouldAutoUnlock = true;
    }else{
      setLockedUI(true);
    }
  }catch(_e){
    setLockedUI(true);
  }finally{
    hideLoading();
  }
  if(shouldAutoUnlock) btnUnlock?.click();
})();

btnMobileReload?.addEventListener("click", ()=> btnReload?.click());
btnMobileBack?.addEventListener("click", ()=> btnBack?.click());
btnMobileLock?.addEventListener("click", ()=> btnLogout?.click());
window.addEventListener("resize", syncProfilesMobileBar);
setTimeout(syncProfilesMobileBar, 0);
