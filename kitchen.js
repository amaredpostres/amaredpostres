
/* AMARED Cocina — Kitchen.js (fix: login + gestionar perfiles) 
   - Mantiene UI existente de kitchen.html
   - Perfiles persistentes en Sheets vía Worker + Webhook
   - Gestión de perfiles protegida por PROFILES_SECRET (validada en Worker)
*/

const API_URL = "https://amared-orders.amaredpostres.workers.dev/";
const TZ = "America/Bogota";

// ---------- Utils ----------
function $(id){ return document.getElementById(id); }
function esc(s){ return String(s||"").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

function normalizeProfileId(label){
  const s = String(label||"").trim().toLowerCase();
  // quitar acentos
  const noAcc = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  // letras/numeros/espacios/_/-
  const cleaned = noAcc.replace(/[^a-z0-9 _-]/g, "");
  const underscored = cleaned.replace(/\s+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g,"");
  return underscored || "";
}

async function api(payload){
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify(payload)
  });
  const txt = await res.text();
  let data;
  try{ data = JSON.parse(txt); } catch { data = { ok:false, error:"Invalid JSON from API", raw: txt }; }
  if(!res.ok) {
    const msg = data?.error || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function showLoading(title="Cargando…", desc=""){
  const el = $("loading");
  if(!el) return;
  $("loadingTitle").textContent = title;
  $("loadingDesc").textContent = desc;
  el.classList.remove("hidden");
}
function hideLoading(){
  const el = $("loading");
  if(!el) return;
  el.classList.add("hidden");
}

// ---------- DOM refs ----------
const selOperator = $("selOperator");
const inpPin = $("inpPin");
const btnLogin = $("btnLogin");
const btnManageProfiles = $("btnManageProfiles");
const loginErr = $("loginErr");

// Profiles modal
const profilesModal = $("profilesModal");
const btnCloseProfiles = $("btnCloseProfiles");
const profilesGate = $("profilesGate");
const inpProfilesSecret = $("inpProfilesSecret");
const btnProfilesUnlock = $("btnProfilesUnlock");
const profilesGateErr = $("profilesGateErr");
const profilesEditor = $("profilesEditor");
const profilesListEl = $("profilesList");
const inpNewProfile = $("inpNewProfile");
const btnAddProfile = $("btnAddProfile");

// View containers
const loginView = $("loginView");
const appView = $("appView");

// ---------- State ----------
let PROFILES = Array.isArray(window.AMARED_KITCHEN_PROFILES) ? window.AMARED_KITCHEN_PROFILES.slice() : [
  { id:"esperanza", label:"Esperanza" },
  { id:"cristian", label:"Cristian" },
];
let profilesUnlocked = false;
let cachedProfilesSecret = "";

// ---------- Profiles: load/render ----------
async function fetchProfilesPublic(){
  // público (solo lectura)
  const out = await api({ action:"profiles_list" });
  if(out?.ok && Array.isArray(out.profiles)) return out.profiles;
  return [];
}

function renderProfilesSelect(list){
  selOperator.innerHTML = "";
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = "Seleccionar…";
  selOperator.appendChild(opt0);

  list.forEach(p=>{
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.label;
    selOperator.appendChild(opt);
  });

  // intentar restaurar selección previa
  const prev = sessionStorage.getItem("amared_operator") || "";
  if(prev) selOperator.value = prev;
}

function openModal(modalEl){
  if(!modalEl) return;
  modalEl.setAttribute("aria-hidden","false");
  modalEl.style.display = "flex";
}
function closeModal(modalEl){
  if(!modalEl) return;
  modalEl.setAttribute("aria-hidden","true");
  modalEl.style.display = "none";
}

async function validateProfilesSecret(secret){
  // Worker tiene validate_secret (no se reenvía al Apps Script)
  const out = await api({ action:"validate_secret", type:"profiles", secret });
  if(!out?.ok) throw new Error("Clave inválida");
  return true;
}

function setProfilesGateError(msg){
  profilesGateErr.textContent = msg || "";
}

function renderProfilesManagerList(list){
  profilesListEl.innerHTML = "";
  if(!list.length){
    const div = document.createElement("div");
    div.className = "muted small";
    div.textContent = "No hay perfiles activos en la hoja PERFILES.";
    profilesListEl.appendChild(div);
    return;
  }

  list.forEach(p=>{
    const row = document.createElement("div");
    row.className = "oRow";
    row.innerHTML = `
      <div class="oRowLeft">
        <div class="oTitle">${esc(p.label)}</div>
        <div class="oMeta muted small">${esc(p.id)}</div>
      </div>
      <div class="oRowRight">
        <button class="btn secondary btnDelProfile" data-id="${esc(p.id)}" type="button">Eliminar</button>
      </div>
    `;
    profilesListEl.appendChild(row);
  });

  // bind deletes
  profilesListEl.querySelectorAll(".btnDelProfile").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const id = btn.getAttribute("data-id") || "";
      if(!id) return;
      const ok = confirm(`¿Eliminar el perfil "${id}"?`);
      if(!ok) return;
      try{
        showLoading("Eliminando…","Actualizando perfiles.");
        await api({ action:"profiles_delete", profiles_secret: cachedProfilesSecret, profile_id: id });
        await reloadProfilesEverywhere();
      }catch(e){
        alert(`No se pudo eliminar: ${e.message}`);
      }finally{
        hideLoading();
      }
    });
  });
}

async function seedDefaultProfilesIfEmpty(list){
  if(list.length) return;
  // sembrar defaults en Sheets para que sean persistentes
  const defaults = (Array.isArray(window.AMARED_KITCHEN_PROFILES) && window.AMARED_KITCHEN_PROFILES.length)
    ? window.AMARED_KITCHEN_PROFILES
    : PROFILES;

  for(const p of defaults){
    await api({
      action:"profiles_add",
      profiles_secret: cachedProfilesSecret,
      profile_id: p.id,
      label: p.label,
      created_by: "KITCHEN_UI"
    });
  }
}

async function reloadProfilesEverywhere(){
  const list = await fetchProfilesPublic();
  PROFILES = list.length ? list : (Array.isArray(window.AMARED_KITCHEN_PROFILES) ? window.AMARED_KITCHEN_PROFILES.slice() : PROFILES);
  renderProfilesSelect(PROFILES);
  if(profilesUnlocked){
    const live = await fetchProfilesPublic();
    await seedDefaultProfilesIfEmpty(live);
    const finalList = await fetchProfilesPublic();
    renderProfilesManagerList(finalList);
  }
}

// ---------- Login ----------
function setLoginError(msg){
  loginErr.textContent = msg || "";
}

function showLogin(){
  appView.classList.add("hidden");
  loginView.classList.remove("hidden");
  // limpiar pin
  inpPin.value = "";
}

function showApp(){
  loginView.classList.add("hidden");
  appView.classList.remove("hidden");
}

function handleLogout(){
  sessionStorage.removeItem("amared_operator");
  sessionStorage.removeItem("amared_pin");
  showLogin();
}

// ---------- Wire events ----------
btnManageProfiles.addEventListener("click", ()=>{
  // reset gate/editor view
  profilesUnlocked = false;
  cachedProfilesSecret = "";
  profilesGate.classList.remove("hidden");
  profilesEditor.classList.add("hidden");
  inpProfilesSecret.value = "";
  inpNewProfile.value = "";
  setProfilesGateError("");
  openModal(profilesModal);
});

btnCloseProfiles.addEventListener("click", ()=>{
  closeModal(profilesModal);
});

btnProfilesUnlock.addEventListener("click", async ()=>{
  const secret = String(inpProfilesSecret.value||"").trim();
  setProfilesGateError("");
  if(!secret){
    setProfilesGateError("Ingresa la clave secreta.");
    return;
  }
  try{
    showLoading("Verificando…","Validando clave de perfiles.");
    await validateProfilesSecret(secret);
    profilesUnlocked = true;
    cachedProfilesSecret = secret;
    profilesGate.classList.add("hidden");
    profilesEditor.classList.remove("hidden");

    // cargar lista de perfiles desde Sheets
    let list = await fetchProfilesPublic();
    await seedDefaultProfilesIfEmpty(list);
    list = await fetchProfilesPublic();
    renderProfilesManagerList(list);
  }catch(e){
    setProfilesGateError("Clave inválida.");
  }finally{
    hideLoading();
  }
});

btnAddProfile.addEventListener("click", async ()=>{
  if(!profilesUnlocked){
    setProfilesGateError("Primero verifica la clave secreta.");
    return;
  }
  const label = String(inpNewProfile.value||"").trim();
  if(!label){
    alert("Escribe el nombre del perfil.");
    return;
  }
  const id = normalizeProfileId(label);
  if(!id){
    alert("Nombre inválido. Prueba con otro.");
    return;
  }
  try{
    showLoading("Agregando…","Guardando en Sheets.");
    await api({
      action:"profiles_add",
      profiles_secret: cachedProfilesSecret,
      profile_id: id,
      label,
      created_by: "KITCHEN_UI"
    });
    inpNewProfile.value = "";
    await reloadProfilesEverywhere();
    // mantener editor actualizado
    const list = await fetchProfilesPublic();
    renderProfilesManagerList(list);
  }catch(e){
    alert(`No se pudo agregar: ${e.message}`);
  }finally{
    hideLoading();
  }
});

btnLogin.addEventListener("click", async ()=>{
  setLoginError("");
  const operator = String(selOperator.value||"").trim();
  const pin = String(inpPin.value||"").trim();

  if(!operator){
    setLoginError("Selecciona un perfil.");
    return;
  }
  if(!pin){
    setLoginError("Ingresa el PIN.");
    return;
  }

  // Validar PIN con Worker (sin exponer ADMIN_PIN)
  try{
    showLoading("Ingresando…","Validando PIN.");
    const out = await api({ action:"validate_secret", type:"admin_pin", secret: pin });
    if(!out?.ok) throw new Error("PIN inválido");
    sessionStorage.setItem("amared_operator", operator);
    sessionStorage.setItem("amared_pin", pin);
    showApp();
  }catch(e){
    setLoginError("PIN inválido.");
  }finally{
    hideLoading();
  }
});

// Logout button exists in topbar
const btnLogout = $("btnLogout");
if(btnLogout) btnLogout.addEventListener("click", handleLogout);

// ---------- Bootstrap ----------
(async function boot(){
  try{
    showLoading("Cargando…","Obteniendo perfiles.");
    const list = await fetchProfilesPublic();
    if(list.length) PROFILES = list;
    renderProfilesSelect(PROFILES);
  }catch(e){
    // fallback a perfiles locales
    renderProfilesSelect(PROFILES);
  }finally{
    hideLoading();
  }

  // auto-login si ya había sesión
  const prevOp = sessionStorage.getItem("amared_operator");
  const prevPin = sessionStorage.getItem("amared_pin");
  if(prevOp && prevPin){
    selOperator.value = prevOp;
    inpPin.value = prevPin;
    // no auto-validamos pin aquí para no forzar llamadas; usuario puede ingresar
  }
})();

/* === HOTFIX: asegurar que "Gestionar perfiles" siempre abra el modal === */
(function(){
  const $ = (id) => document.getElementById(id);

  function openModal(modalEl){
    if(!modalEl) return;
    modalEl.setAttribute("aria-hidden","false");
    modalEl.style.display = "flex";
  }
  function closeModal(modalEl){
    if(!modalEl) return;
    modalEl.setAttribute("aria-hidden","true");
    modalEl.style.display = "none";
  }

  document.addEventListener("click", (e)=>{
    const manageBtn = e.target.closest("#btnManageProfiles");
    const closeBtn  = e.target.closest("#btnCloseProfiles");

    if (manageBtn){
      const modal = $("profilesModal");
      if(!modal){
        console.warn("[profiles] No existe #profilesModal en kitchen.html");
        return;
      }
      console.log("[profiles] Abrir modal gestionar perfiles");
      openModal(modal);
      return;
    }

    if (closeBtn){
      const modal = $("profilesModal");
      console.log("[profiles] Cerrar modal gestionar perfiles");
      closeModal(modal);
      return;
    }
  }, true);
})();

/* === HOTFIX VISUAL: asegurar que profilesModal sea visible encima === */
(function(){
  const modal = document.getElementById("profilesModal");
  if(!modal) return;

  // Estilos mínimos solo para visibilidad (no cambia tu contenido interno)
  function applyVisibleStyle(el){
    el.style.display = "flex";
    el.style.position = "fixed";
    el.style.inset = "0";
    el.style.zIndex = "9999";
    el.style.alignItems = "center";
    el.style.justifyContent = "center";
    // Fondo semitransparente (puedes ajustar luego)
    el.style.background = "rgba(0,0,0,0.55)";
  }

  // Intercepta cada vez que se “abra”
  const originalSetAttribute = modal.setAttribute.bind(modal);
  modal.setAttribute = function(name, value){
    originalSetAttribute(name, value);
    if(name === "aria-hidden" && value === "false"){
      applyVisibleStyle(modal);
    }
  };

  // Por si ya quedó en estado abierto
  if(modal.getAttribute("aria-hidden") === "false"){
    applyVisibleStyle(modal);
  }
})();

/* === FIX DEFINITIVO: forzar visibilidad del modal de perfiles (independiente del CSS) === */
(function () {
  const btn = document.getElementById("btnManageProfiles");
  const modal = document.getElementById("profilesModal");
  const btnClose = document.getElementById("btnCloseProfiles");

  if (!btn || !modal) {
    console.warn("[profiles] No se encontró btnManageProfiles o profilesModal");
    return;
  }

  function showModal() {
    console.log("[profiles] MOSTRAR modal (forzado)");

    // Estado accesible
    modal.setAttribute("aria-hidden", "false");

    // Clase por si tu CSS depende de .show
    modal.classList.add("show");

    // Forzar visibilidad aunque el CSS lo oculte
    modal.style.display = "flex";
    modal.style.opacity = "1";
    modal.style.pointerEvents = "auto";
    modal.style.visibility = "visible";

    // Asegurar que quede encima
    modal.style.position = "fixed";
    modal.style.inset = "0";
    modal.style.zIndex = "9999";

    // Fondo overlay por si el CSS lo deja transparente
    if (!modal.style.background) modal.style.background = "rgba(0,0,0,0.55)";
  }

  function hideModal() {
    console.log("[profiles] OCULTAR modal");
    modal.setAttribute("aria-hidden", "true");
    modal.classList.remove("show");
    modal.style.display = "none";
    modal.style.pointerEvents = "none";
  }

  // Abrir
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    showModal();
  });

  // Cerrar (botón)
  if (btnClose) {
    btnClose.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      hideModal();
    });
  }

  // Cerrar al hacer clic fuera (overlay)
  modal.addEventListener("click", (e) => {
    if (e.target === modal) hideModal();
  });
})();

/* === GESTIÓN DE PERFILES LIMPIA (usa el modal original del HTML) === */
(function () {

  const API_BASE =
    window.API_BASE ||
    window.API_URL ||
    window.WORKER_URL ||
    "https://amared-orders.amaredpostres.workers.dev";

  const $ = (id) => document.getElementById(id);

  const btnManage = $("btnManageProfiles");
  const modal = $("profilesModal");
  const btnClose = $("btnCloseProfiles");
  const btnVerify = $("btnVerifyProfiles") || $("btnUnlockProfiles");
  const secretInput = $("profilesSecretInput") || $("profilesSecret");
  const editor = $("profilesEditor");
  const listEl = $("profilesList");
  const btnAdd = $("btnAddProfile");
  const newLabel = $("newProfileLabel");
  const statusEl = $("profilesStatus");

  function showModal() {
    modal.style.display = "flex";
    modal.setAttribute("aria-hidden", "false");
  }

  function hideModal() {
    modal.style.display = "none";
    modal.setAttribute("aria-hidden", "true");
  }

  function showStatus(msg, isError = false) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.style.color = isError ? "#b91c1c" : "#6b7280";
  }

  async function post(action, payload) {
    const res = await fetch(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...payload }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "Error servidor");
    return data;
  }

  function slugify(label) {
    return label
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  async function refreshProfiles(secret) {
    const out = await post("profiles_list", {});
    const profiles = out.profiles || [];
    listEl.innerHTML = "";

    profiles.forEach(p => {
      const row = document.createElement("div");
      row.className = "profileRow";
      row.innerHTML = `
        <span>${p.label}</span>
        <button class="btn secondary">Eliminar</button>
      `;
      const btnDel = row.querySelector("button");
      btnDel.onclick = async () => {
        showStatus("Eliminando...");
        await post("profiles_delete", {
          profiles_secret: secret,
          profile_id: p.id
        });
        showStatus("Perfil eliminado.");
        refreshProfiles(secret);
        if (typeof window.loadProfiles === "function") window.loadProfiles();
      };
      listEl.appendChild(row);
    });
  }

  btnManage?.addEventListener("click", () => {
    showModal();
    showStatus("Ingresa la clave para continuar.");
  });

  btnClose?.addEventListener("click", hideModal);

  btnVerify?.addEventListener("click", async () => {
    const secret = secretInput.value.trim();
    if (!secret) return showStatus("Ingresa la clave.", true);

    try {
      showStatus("Validando clave...");
      await post("validate_secret", { type: "profiles", secret });
      showStatus("Clave correcta.");
      editor.style.display = "block";
      await refreshProfiles(secret);

      btnAdd.onclick = async () => {
        const label = newLabel.value.trim();
        if (!label) return showStatus("Escribe un nombre.", true);
        showStatus("Guardando...");
        await post("profiles_add", {
          profiles_secret: secret,
          profile_id: slugify(label),
          label,
          created_at: new Date().toISOString(),
          created_by: "kitchen",
          is_active: true
        });
        newLabel.value = "";
        showStatus("Perfil guardado correctamente.");
        await refreshProfiles(secret);
        if (typeof window.loadProfiles === "function") window.loadProfiles();
      };

    } catch (err) {
      showStatus("Clave incorrecta.", true);
    }
  });

})();



