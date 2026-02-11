// profiles.js
// ✅ Usa el mismo Worker (API_URL) que ya usas en kitchen.js
// IMPORTANTE: pega aquí tu URL real del Worker si no es la misma.
const API_URL = window.AMARED_API_URL || "https://amared-orders.amaredpostres.workers.dev/";

const $ = (id) => document.getElementById(id);

const loader = $("loader");
const loaderTitle = $("loaderTitle");
const loaderText = $("loaderText");

const inpSecret = $("inpSecret");
const secretMsg = $("secretMsg");
const btnValidate = $("btnValidate");
const btnLock = $("btnLock");

const statePill = $("statePill");
const tbody = $("tbody");
const listMsg = $("listMsg");

const inpId = $("inpId");
const inpLabel = $("inpLabel");
const btnAdd = $("btnAdd");
const addMsg = $("addMsg");

const btnReload = $("btnReload");

let UNLOCKED = false;
let SECRET = "";

// ---------- helpers ----------
function showLoading(title="Cargando…", text="Por favor espera."){
  loaderTitle.textContent = title;
  loaderText.textContent = text;
  loader.classList.add("show");
  loader.setAttribute("aria-hidden","false");
}
function hideLoading(){
  loader.classList.remove("show");
  loader.setAttribute("aria-hidden","true");
}
async function api(payload){
  const res = await fetch(API_URL, {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify(payload),
  });
  const out = await res.json().catch(async () => ({
    ok:false,
    error: await res.text().catch(()=> "Error")
  }));
  if(!out.ok) throw new Error(out.error || "Error");
  return out;
}

function setState(unlocked){
  UNLOCKED = !!unlocked;
  statePill.textContent = UNLOCKED ? "🔓 Desbloqueado" : "🔒 Bloqueado";
  btnAdd.disabled = !UNLOCKED;
  btnAdd.style.opacity = UNLOCKED ? "1" : ".6";
  addMsg.textContent = UNLOCKED ? "" : "Desbloquea para agregar o eliminar.";
}

function normalizeId(s){
  return String(s||"")
    .trim()
    .toLowerCase()
    .replace(/\s+/g,"-")
    .replace(/[^a-z0-9-_]/g,"");
}

function renderRows(profiles){
  const list = Array.isArray(profiles) ? profiles : [];
  if(!list.length){
    tbody.innerHTML = `<tr><td colspan="3" class="muted">No hay perfiles.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(p => {
    const id = String(p.id||"").trim();
    const label = String(p.label||"").trim();
    const canDelete = UNLOCKED; // si quieres bloquear algunos ids base, aquí lo haces
    return `
      <tr>
        <td><span class="pill">${id}</span></td>
        <td>${label}</td>
        <td>
          <button class="btn danger" type="button"
            data-del="${id}"
            ${canDelete ? "" : "disabled"}
            style="padding:8px 10px;border-radius:12px;${canDelete ? "" : "opacity:.5;cursor:not-allowed"}"
          >Eliminar</button>
        </td>
      </tr>
    `;
  }).join("");
}

// ---------- data ----------
async function fetchProfiles(){
  const out = await api({ action:"profiles_list" });
  return out.profiles || [];
}

async function refresh(){
  showLoading("Cargando…","Leyendo perfiles desde la base de datos.");
  listMsg.textContent = "";
  try{
    const profiles = await fetchProfiles();
    renderRows(profiles);
    listMsg.textContent = `Total: ${profiles.length}`;
  }catch(e){
    listMsg.textContent = "";
    tbody.innerHTML = `<tr><td colspan="3" class="err">${e.message || String(e)}</td></tr>`;
  }finally{
    hideLoading();
  }
}

// ---------- unlock ----------
async function validateSecret(){
  secretMsg.textContent = "";
  const s = String(inpSecret.value||"").trim();
  if(!s){
    secretMsg.className = "err";
    secretMsg.textContent = "Ingresa la clave.";
    return;
  }

  showLoading("Verificando…","Validando clave de perfiles.");
  try{
    // ✅ Worker soporta validate_secret con type="profiles"
    await api({ action:"validate_secret", type:"profiles", secret:s });
    SECRET = s;
    setState(true);
    secretMsg.className = "ok";
    secretMsg.textContent = "Clave válida. Edición desbloqueada.";
  }catch(e){
    setState(false);
    secretMsg.className = "err";
    secretMsg.textContent = e.message || String(e);
  }finally{
    hideLoading();
  }
}

function lock(){
  SECRET = "";
  inpSecret.value = "";
  secretMsg.className = "muted";
  secretMsg.textContent = "";
  setState(false);
}

// ---------- actions ----------
async function addProfile(){
  addMsg.textContent = "";
  if(!UNLOCKED || !SECRET){
    addMsg.className = "err";
    addMsg.textContent = "Primero desbloquea con la clave.";
    return;
  }

  const id = normalizeId(inpId.value);
  const label = String(inpLabel.value||"").trim();

  if(!id || !label){
    addMsg.className = "err";
    addMsg.textContent = "Completa ID y Nombre.";
    return;
  }

  showLoading("Guardando…","Agregando perfil.");
  try{
    await api({
      action:"profiles_add",
      profiles_secret: SECRET,
      profile: { id, label }
    });
    inpId.value = "";
    inpLabel.value = "";
    addMsg.className = "ok";
    addMsg.textContent = "Perfil agregado.";
    await refresh();
  }catch(e){
    addMsg.className = "err";
    addMsg.textContent = e.message || String(e);
  }finally{
    hideLoading();
  }
}

async function deleteProfile(id){
  if(!UNLOCKED || !SECRET) return;

  const ok = confirm(`¿Eliminar el perfil "${id}"?`);
  if(!ok) return;

  showLoading("Guardando…","Eliminando perfil.");
  try{
    await api({
      action:"profiles_delete",
      profiles_secret: SECRET,
      id: String(id)
    });
    await refresh();
  }catch(e){
    alert(e.message || String(e));
  }finally{
    hideLoading();
  }
}

// ---------- events ----------
btnValidate.addEventListener("click", validateSecret);
btnLock.addEventListener("click", lock);
btnAdd.addEventListener("click", addProfile);
btnReload.addEventListener("click", refresh);

document.addEventListener("click", (e) => {
  const del = e.target?.getAttribute?.("data-del");
  if(del) deleteProfile(del);
});

setState(false);
refresh();

