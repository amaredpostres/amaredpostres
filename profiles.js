/* =========================
   AMARED - Profiles Manager
   ========================= */

const API_BASE = (typeof window.API_BASE === "string" && window.API_BASE)
  ? window.API_BASE
  : "REEMPLAZA_POR_TU_URL_DEL_WORKER";

const $ = (id) => document.getElementById(id);

const inpSecret = $("inpSecret");
const btnUnlock = $("btnUnlock");
const btnLock   = $("btnLock");
const gateErr   = $("gateErr");

const mgr    = $("mgr");
const listEl = $("list");
const mgrErr = $("mgrErr");

const inpName = $("inpName");
const inpId   = $("inpId");
const btnAdd  = $("btnAdd");

let PROFILES_SECRET = sessionStorage.getItem("amared_profiles_secret") || "";

// ---------- Helpers ----------
function showLoading(title, msg){
  $("loadingTitle").textContent = title || "Cargando…";
  $("loadingMsg").textContent = msg || "Procesando";
  $("loading").style.display = "flex";
}
function hideLoading(){
  $("loading").style.display = "none";
}
function setGateError(msg){ gateErr.textContent = msg || ""; }
function setMgrError(msg){ mgrErr.textContent = msg || ""; }

function esc(s){
  return String(s||"").replace(/[&<>"']/g, (c)=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

async function api(action, payload){
  const res = await fetch(API_BASE, {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify({ action, ...(payload||{}) })
  });
  const data = await res.json().catch(()=> ({}));
  if(!res.ok || data?.ok === false){
    const msg = data?.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

// Slug para ID automático
function slugifyId(label){
  return String(label||"")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function getSelectedCategories(){
  const arr = Array.from(document.querySelectorAll('.chipGroup input[type="checkbox"]:checked'))
    .map(i => String(i.value||"").trim().toLowerCase())
    .filter(Boolean);
  // uniq
  const seen = {};
  return arr.filter(x => (seen[x] ? false : (seen[x]=1)));
}

// ---------- Render ----------
function renderList(profiles){
  listEl.innerHTML = "";

  if(!profiles.length){
    listEl.innerHTML = `<div class="muted small" style="text-align:center; padding:12px;">No hay perfiles activos.</div>`;
    return;
  }

  profiles.forEach(p => {
    const cats = Array.isArray(p.categories) ? p.categories : [];
    const catTxt = cats.length ? cats.join(", ") : "—";

    const row = document.createElement("div");
    row.className = "oRow";
    row.innerHTML = `
      <div class="oRowLeft">
        <div class="oTitle">${esc(p.label)}</div>
        <div class="oMeta muted small">${esc(p.id)} · <span class="pill">${esc(catTxt)}</span></div>
      </div>
      <div class="oRowRight">
        <button class="btn secondary btnDel" data-id="${esc(p.id)}" type="button">Eliminar</button>
      </div>
    `;

    row.querySelector(".btnDel").addEventListener("click", async ()=>{
      setMgrError("");
      if(!PROFILES_SECRET){
        setMgrError("Primero debes ingresar la clave.");
        return;
      }
      const ok = confirm(`¿Eliminar el perfil "${p.label}"?`);
      if(!ok) return;

      try{
        showLoading("Eliminando…","Actualizando en la base de datos.");
        await api("profiles_delete", { profiles_secret: PROFILES_SECRET, profile_id: p.id });
        const out = await api("profiles_list", {});
        renderList(out.profiles || []);
      }catch(e){
        setMgrError(e.message);
      }finally{
        hideLoading();
      }
    });

    listEl.appendChild(row);
  });
}

// ---------- Flow ----------
async function unlock(){
  setGateError("");
  setMgrError("");

  const secret = String(inpSecret.value||"").trim();
  if(!secret){
    setGateError("Ingresa la clave.");
    return;
  }

  try{
    showLoading("Ingresando…","Validando clave.");
    await api("validate_secret", { type:"profiles", secret }); // ✅ tipo correcto según Worker :contentReference[oaicite:6]{index=6}
    PROFILES_SECRET = secret;
    sessionStorage.setItem("amared_profiles_secret", secret);

    const out = await api("profiles_list", {});
    renderList(out.profiles || []);
    mgr.style.display = "block";
    setGateError("");
  }catch(e){
    setGateError("Clave incorrecta o no autorizada.");
  }finally{
    hideLoading();
  }
}

function lock(){
  PROFILES_SECRET = "";
  sessionStorage.removeItem("amared_profiles_secret");
  inpSecret.value = "";
  mgr.style.display = "none";
  setGateError("Bloqueado.");
}

// Auto ID preview
inpName.addEventListener("input", ()=>{
  inpId.value = slugifyId(inpName.value);
});

// Add profile
btnAdd.addEventListener("click", async ()=>{
  setMgrError("");
  if(!PROFILES_SECRET){
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

  try{
    showLoading("Guardando…","Creando/actualizando perfil.");
    await api("profiles_add", {
      profiles_secret: PROFILES_SECRET,
      profile_id: id,
      label: name,
      categories: cats.join(","),
      created_by: "PROFILES_PAGE",
      is_active: true
    });

    inpName.value = "";
    inpId.value = "";

    const out = await api("profiles_list", {});
    renderList(out.profiles || []);
  }catch(e){
    setMgrError(e.message);
  }finally{
    hideLoading();
  }
});

// Buttons
btnUnlock.addEventListener("click", unlock);
btnLock.addEventListener("click", lock);

// Bootstrap
(async function boot(){
  // si había clave en sessionStorage, intenta auto abrir
  if(PROFILES_SECRET){
    inpSecret.value = PROFILES_SECRET;
    await unlock();
  }
})();
