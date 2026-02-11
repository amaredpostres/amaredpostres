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

/* === FIX DEFINITIVO: Modal "Gestionar perfiles" visible + loading + fuera de contenedores ocultos === */
(function () {
  const API_BASE =
    window.API_BASE ||
    window.API_URL ||
    window.WORKER_URL ||
    "https://amared-orders.amaredpostres.workers.dev";

  const $ = (id) => document.getElementById(id);

  function forceAttachToBody(el) {
    if (!el) return;
    if (el.parentElement !== document.body) {
      document.body.appendChild(el); // ✅ evita que un padre con display:none lo oculte
    }
  }

  function forceOverlayVisible(el) {
    // overlay full-screen, encima de todo
    el.style.display = "flex";
    el.style.position = "fixed";
    el.style.left = "0";
    el.style.top = "0";
    el.style.width = "100vw";
    el.style.height = "100vh";
    el.style.zIndex = "99999";
    el.style.alignItems = "center";
    el.style.justifyContent = "center";
    el.style.background = "rgba(0,0,0,0.55)";
    el.style.opacity = "1";
    el.style.visibility = "visible";
    el.style.pointerEvents = "auto";
    el.setAttribute("aria-hidden", "false");
    el.classList.add("show");
  }

  function forceOverlayHidden(el) {
    el.setAttribute("aria-hidden", "true");
    el.classList.remove("show");
    el.style.display = "none";
    el.style.pointerEvents = "none";
  }

  function ensureInnerCard(modal) {
    // Si el modal no tiene contenido visible, creamos un "card" mínimo respetando tu UI
    let card = modal.querySelector(".modalCard");
    if (!card) {
      card = document.createElement("div");
      card.className = "modalCard";
      card.style.width = "min(520px, 92vw)";
      card.style.borderRadius = "18px";
      card.style.background = "#fff";
      card.style.boxShadow = "0 14px 40px rgba(0,0,0,.25)";
      card.style.padding = "18px";
      card.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
          <div style="font-weight:800; font-size:18px;">Gestionar perfiles</div>
          <button id="btnCloseProfiles" class="btn secondary" style="padding:10px 12px; border-radius:12px;">Cerrar</button>
        </div>

        <div id="profilesStatus" style="margin-top:10px; font-size:14px; color:#6b7280;">
          Cargando...
        </div>

        <div style="margin-top:12px;">
          <label style="display:block; font-size:12px; color:#6b7280; margin-bottom:6px;">Clave de perfiles</label>
          <input id="profilesSecretInput" type="password" placeholder="Ingresa la clave" style="width:100%; padding:12px; border-radius:12px; border:1px solid #e5e7eb;" />
          <button id="btnUnlockProfiles" class="btn primary" style="margin-top:10px; width:100%; padding:12px; border-radius:14px;">Desbloquear</button>
        </div>

        <div id="profilesEditor" style="display:none; margin-top:14px;">
          <div style="font-weight:700; margin-bottom:10px;">Perfiles activos</div>
          <div id="profilesList" style="display:flex; flex-direction:column; gap:10px;"></div>

          <div style="margin-top:14px; padding-top:14px; border-top:1px solid #eee;">
            <div style="font-weight:700; margin-bottom:8px;">Agregar perfil</div>
            <input id="newProfileLabel" type="text" placeholder="Nombre (ej: Juan)" style="width:100%; padding:12px; border-radius:12px; border:1px solid #e5e7eb;" />
            <button id="btnAddProfile" class="btn primary" style="margin-top:10px; width:100%; padding:12px; border-radius:14px;">Agregar</button>
          </div>
        </div>
      `;
      modal.appendChild(card);
    }
    return card;
  }

  async function post(action, payload) {
    const res = await fetch(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...payload }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error || `HTTP ${res.status}`;
      const err = new Error(msg);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function slugifyId(label) {
    return String(label || "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function renderProfiles(listEl, profiles, secret) {
    listEl.innerHTML = "";
    profiles.forEach((p) => {
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.alignItems = "center";
      row.style.justifyContent = "space-between";
      row.style.gap = "10px";
      row.style.padding = "12px";
      row.style.border = "1px solid #eee";
      row.style.borderRadius = "14px";
      row.innerHTML = `
        <div style="display:flex; flex-direction:column;">
          <div style="font-weight:700;">${p.label}</div>
          <div style="font-size:12px; color:#6b7280;">${p.id}</div>
        </div>
        <button class="btn secondary" style="padding:10px 12px; border-radius:12px;">Eliminar</button>
      `;
      const btnDel = row.querySelector("button");
      btnDel.addEventListener("click", async () => {
        if (!confirm(`¿Eliminar el perfil "${p.label}"?`)) return;
        btnDel.disabled = true;
        try {
          await post("profiles_delete", { profiles_secret: secret, profile_id: p.id });
          // Recargar lista
          const out = await post("profiles_list", {});
          renderProfiles(listEl, out.profiles || [], secret);
          // Actualizar selector del login si existe
          if (typeof window.loadProfiles === "function") window.loadProfiles();
        } catch (e) {
          alert("No se pudo eliminar: " + e.message);
        } finally {
          btnDel.disabled = false;
        }
      });
      listEl.appendChild(row);
    });
  }

  async function openProfilesManager() {
    let modal = $("profilesModal");

    // Si no existe, lo creamos desde cero
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "profilesModal";
      modal.className = "modalOverlay";
      modal.setAttribute("aria-hidden", "true");
      document.body.appendChild(modal);
    }

    // ✅ Lo sacamos de cualquier contenedor oculto
    forceAttachToBody(modal);
    ensureInnerCard(modal);
    forceOverlayVisible(modal);

    // Validación de tamaño real (tu caso era 0x0)
    const rect = modal.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      // fuerza otra vez (por si un CSS lo pisa)
      forceOverlayVisible(modal);
    }

    const statusEl = $("profilesStatus");
    const btnClose = $("btnCloseProfiles");
    const btnUnlock = $("btnUnlockProfiles");
    const secretInput = $("profilesSecretInput");
    const editor = $("profilesEditor");
    const listEl = $("profilesList");
    const newLabel = $("newProfileLabel");
    const btnAdd = $("btnAddProfile");

    if (statusEl) statusEl.textContent = "Cargando perfiles...";
    try {
      const out = await post("profiles_list", {});
      const profiles = out.profiles || [];
      if (statusEl) statusEl.textContent = profiles.length ? "Listo. Desbloquea para editar." : "No hay perfiles activos. Desbloquea para crear.";
    } catch (e) {
      if (statusEl) statusEl.textContent = "No se pudo cargar. Revisa conexión.";
    }

    if (btnClose) {
      btnClose.onclick = () => forceOverlayHidden(modal);
    }

    if (btnUnlock) {
      btnUnlock.onclick = async () => {
        const secret = String(secretInput?.value || "").trim();
        if (!secret) return alert("Ingresa la clave de perfiles");

        btnUnlock.disabled = true;
        if (statusEl) statusEl.textContent = "Validando clave...";
        try {
          await post("validate_secret", { type: "profiles", secret });
          if (statusEl) statusEl.textContent = "Clave correcta. Puedes editar.";
          if (editor) editor.style.display = "block";

          // cargar lista
          const out = await post("profiles_list", {});
          renderProfiles(listEl, out.profiles || [], secret);

          // Agregar
          btnAdd.onclick = async () => {
            const label = String(newLabel?.value || "").trim();
            if (!label) return alert("Escribe un nombre de perfil");
            const profile_id = slugifyId(label);
            btnAdd.disabled = true;
            try {
              await post("profiles_add", {
                profiles_secret: secret,
                profile_id,
                label,
                created_at: nowIso(),
                created_by: "kitchen",
                is_active: true
              });
              newLabel.value = "";
              const out2 = await post("profiles_list", {});
              renderProfiles(listEl, out2.profiles || [], secret);
              if (typeof window.loadProfiles === "function") window.loadProfiles();
            } catch (e) {
              alert("No se pudo agregar: " + e.message);
            } finally {
              btnAdd.disabled = false;
            }
          };
        } catch (e) {
          if (statusEl) statusEl.textContent = "Clave incorrecta.";
          alert("Clave incorrecta o no autorizada.");
        } finally {
          btnUnlock.disabled = false;
        }
      };
    }
  }

  // ✅ Conectar botón (por delegación, por si cambia el DOM)
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("#btnManageProfiles");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    console.log("[profiles] abrir gestor (modal + loading)");
    openProfilesManager();
  }, true);
})();
