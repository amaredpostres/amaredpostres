/* =========================
   AMARED · Gestión de perfiles
   ========================= */

const API_BASE = "https://amared-orders.amaredpostres.workers.dev/"; // ✅ Worker real (NO GitHub Pages)

const $ = (id) => document.getElementById(id);

const btnBack = $("btnBack");

const inpSecret = $("inpSecret");
const btnUnlock = $("btnUnlock");
const gateErr = $("gateErr");

const pillState = $("pillState");
const btnLogout = $("btnLogout");

const mgrCard = $("mgrCard");
const btnReload = $("btnReload");
const pillCount = $("pillCount");
const tbody = $("tbody");
const listMsg = $("listMsg");

const inpName = $("inpName");
const inpId = $("inpId");
const btnAdd = $("btnAdd");
const mgrErr = $("mgrErr");

const loading = $("loading");
const loadingTitle = $("loadingTitle");
const loadingMsg = $("loadingMsg");

let PROFILES_SECRET = sessionStorage.getItem("amared_profiles_secret") || "";
let UNLOCKED = false;

// ---------- UI helpers ----------
function showLoading(title, msg){
  loadingTitle.textContent = title || "Cargando…";
  loadingMsg.textContent = msg || "Procesando";
  loading.style.display = "flex";
  loading.setAttribute("aria-hidden","false");
}
function hideLoading(){
  loading.style.display = "none";
  loading.setAttribute("aria-hidden","true");
}
function setGateError(msg){ gateErr.textContent = msg || ""; }
function setMgrError(msg){ mgrErr.textContent = msg || ""; }
function setListMsg(msg, color){
  listMsg.textContent = msg || "";
  listMsg.style.color = color || "";
}
function esc(s){
  return String(s||"").replace(/[&<>"']/g, (c)=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

function setState(unlocked){
  UNLOCKED = !!unlocked;
  pillState.textContent = UNLOCKED ? "🔓 Desbloqueado" : "🔒 Bloqueado";
  btnLogout.disabled = !UNLOCKED;
  btnAdd.disabled = !UNLOCKED;
  btnAdd.style.opacity = UNLOCKED ? "1" : ".65";
}

// ---------- API ----------
async function api(action, payload){
  const res = await fetch(API_BASE, {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify({ action, ...(payload||{}) })
  });

  let data;
  try{
    data = await res.json();
  }catch(e){
    console.error("❌ Apps Script no devolvió JSON válido");
    throw new Error("Apps Script returned non-JSON");
  }

  if(!res.ok || data?.ok === false){
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.data = data; // 👈 guardamos respuesta completa del Worker
    console.error("❌ Error Worker:", err);
    console.error("📦 Detalle completo:", data);
    console.error("


// ---------- ID automático ----------
function slugifyId(label){
  return String(label||"")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")   // quitar tildes
    .replace(/[^a-z0-9]+/g, "_")        // no permitido -> _
    .replace(/^_+|_+$/g, "");
}

function getSelectedCategories(){
  const arr = Array.from(document.querySelectorAll('.chips input[type="checkbox"]:checked'))
    .map(i => String(i.value||"").trim().toLowerCase())
    .filter(Boolean);

  const seen = {};
  return arr.filter(x => (seen[x] ? false : (seen[x]=1)));
}

// ---------- Render ----------
function renderList(profiles){
  const list = Array.isArray(profiles) ? profiles : [];

  pillCount.textContent = `${list.length} perfil${list.length === 1 ? "" : "es"}`;

  if(!list.length){
    tbody.innerHTML = `<tr><td colspan="4" class="muted small" style="padding:12px;">No hay perfiles activos.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(p => {
    const id = esc(p.id);
    const label = esc(p.label);
    const cats = Array.isArray(p.categories) ? p.categories : [];
    const catTxt = cats.length ? esc(cats.join(", ")) : "—";

    const delDisabled = UNLOCKED ? "" : "disabled";
    const delStyle = UNLOCKED ? "" : "opacity:.55; cursor:not-allowed;";

    return `
      <tr>
        <td><span class="badge">${id}</span></td>
        <td>${label}</td>
        <td>${catTxt}</td>
        <td>
          <button class="btn secondary" type="button"
            data-del="${id}"
            ${delDisabled}
            style="padding:10px 12px; border-radius: 14px; background: linear-gradient(180deg, rgba(242,91,143,.12), rgba(242,91,143,.06)); border-color: rgba(242,91,143,.25); ${delStyle}"
          >Eliminar</button>
        </td>
      </tr>
    `;
  }).join("");
}

async function refresh(){
  setListMsg("", "");
  showLoading("Cargando…","Leyendo perfiles desde la base de datos.");
  try{
    const out = await api("profiles_list", {});
    renderList(out.profiles || []);
    setListMsg("Lista actualizada.", "rgba(64,17,2,.7)");
  }catch(e){
    setListMsg(e.message || String(e), "#b00020");
  }finally{
    hideLoading();
  }
}

// ---------- Login / Logout ----------
async function unlock(){
  setGateError("");
  setMgrError("");
  setListMsg("");

  const secret = String(inpSecret.value||"").trim();
  if(!secret){
    setGateError("Ingresa la clave.");
    return;
  }

  showLoading("Ingresando…","Validando clave de perfiles.");
  try{
    // ✅ type:"profiles" (así lo exige tu Worker)
    await api("validate_secret", { type:"profiles", secret });

    PROFILES_SECRET = secret;
    sessionStorage.setItem("amared_profiles_secret", secret);

    setState(true);
    mgrCard.style.display = "block";
    await refresh();
  }catch(e){
    setState(false);
    mgrCard.style.display = "none";
    setGateError("Clave incorrecta o no autorizada.");
  }finally{
    hideLoading();
  }
}

function logout(){
  PROFILES_SECRET = "";
  sessionStorage.removeItem("amared_profiles_secret");
  inpSecret.value = "";
  setState(false);
  mgrCard.style.display = "none";
  setGateError("Sesión bloqueada.");
}

// ---------- Add / Delete ----------
async function addProfile(){
  setMgrError("");
  if(!UNLOCKED || !PROFILES_SECRET){
    setMgrError("Primero debes ingresar la clave.");
    return;
  }

  const name = String(inpName.value||"").trim();
  const id = slugifyId(name);
  const cats = getSelectedCategories();

  if(!name){
    setMgrError("Escribe el nombre del perfil.");
    return;
  }
  if(!id){
    setMgrError("No se pudo generar el ID. Cambia el nombre.");
    return;
  }
  if(!cats.length){
    setMgrError("Selecciona al menos una categoría.");
    return;
  }

  showLoading("Guardando…","Creando/actualizando perfil.");
  try{
    await api("profiles_add", {
      profiles_secret: PROFILES_SECRET,
      profile_id: id,
      label: name,
      categories: cats.join(","), // string
      created_by: "PROFILES_PAGE",
      is_active: true
    });

    inpName.value = "";
    inpId.value = "";
    await refresh();
  }catch(e){
    setMgrError(e.message || String(e));
  }finally{
    hideLoading();
  }
}

async function deleteProfile(id){
  setMgrError("");
  if(!UNLOCKED || !PROFILES_SECRET) return;

  const ok = confirm(`¿Eliminar el perfil "${id}"?`);
  if(!ok) return;

  showLoading("Eliminando…","Actualizando en la base de datos.");
  try{
    // Soft delete: marca is_active=false
    await api("profiles_delete", {
      profiles_secret: PROFILES_SECRET,
      profile_id: String(id)
    });
    await refresh();
  }catch(e){
    setMgrError(e.message || String(e));
  }finally{
    hideLoading();
  }
}

// ---------- Events ----------
btnBack.addEventListener("click", ()=> history.back());

btnUnlock.addEventListener("click", unlock);
inpSecret.addEventListener("keydown", (e)=>{ if(e.key === "Enter") unlock(); });

btnLogout.addEventListener("click", logout);
btnReload.addEventListener("click", refresh);

inpName.addEventListener("input", ()=>{
  inpId.value = slugifyId(inpName.value);
});

btnAdd.addEventListener("click", addProfile);

document.addEventListener("click", (e)=>{
  const del = e.target?.getAttribute?.("data-del");
  if(del) deleteProfile(del);
});

// Bootstrap
setState(false);
if(PROFILES_SECRET){
  inpSecret.value = PROFILES_SECRET;
  unlock(); // auto-login
}

