// =================== CONFIG ===================
const API_URL = "https://amared-orders.amaredpostres.workers.dev/";

// =================== STATE ===================
let PROFILES_SECRET = null;
let PROFILES_CACHE = [];

// =================== DOM ===================
const btnBack = document.getElementById("btnBack");

const gateCard = document.getElementById("gateCard");
const statusCard = document.getElementById("statusCard");
const mgrCard = document.getElementById("mgrCard");

const inpSecret = document.getElementById("inpSecret");
const btnUnlock = document.getElementById("btnUnlock");
const gateErr = document.getElementById("gateErr");

const pillState = document.getElementById("pillState");
const btnLogout = document.getElementById("btnLogout");

const pillCount = document.getElementById("pillCount");
const btnReload = document.getElementById("btnReload");
const tbody = document.getElementById("tbody");
const listMsg = document.getElementById("listMsg");

const inpName = document.getElementById("inpName");
const inpId = document.getElementById("inpId");
const btnAdd = document.getElementById("btnAdd");
const mgrErr = document.getElementById("mgrErr");

const loading = document.getElementById("loading");
const loadingTitle = document.getElementById("loadingTitle");
const loadingMsg = document.getElementById("loadingMsg");

// =================== HELPERS ===================
function showLoading(title, msg){
  if(!loading) return;
  loadingTitle.textContent = title || "Cargando…";
  loadingMsg.textContent = msg || "Procesando…";
  loading.style.display = "flex";
  loading.setAttribute("aria-hidden","false");
}
function hideLoading(){
  if(!loading) return;
  loading.style.display = "none";
  loading.setAttribute("aria-hidden","true");
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

async function api(payload){
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify(payload || {})
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

function setLockedUI(locked){
  if(locked){
    pillState.textContent = "🔒 Bloqueado";
    btnLogout.disabled = true;
    if(mgrCard) mgrCard.style.display = "none";
    if(statusCard) statusCard.style.opacity = "1";
  }else{
    pillState.textContent = "🔓 Desbloqueado";
    btnLogout.disabled = false;
    if(mgrCard) mgrCard.style.display = "block";
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
      <td><button class="btn secondary btnDel" data-id="${escapeHtml(pid)}">Eliminar</button></td>
    `;
    tbody.appendChild(tr);
  }
}

// Delegación de eventos: el botón Eliminar siempre funciona aunque la tabla se re-renderice
tbody?.addEventListener("click", async (ev)=>{
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
      costs_secret: PROFILES_SECRET,
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
      costs_secret: PROFILES_SECRET
    });
    PROFILES_CACHE = Array.isArray(out.profiles) ? out.profiles : [];
    renderTable(PROFILES_CACHE);
    listMsg.textContent = `Actualizado: ${new Date().toLocaleString("es-CO")}`;
  }finally{
    hideLoading();
  }
}

// =================== EVENTS ===================
btnBack?.addEventListener("click", ()=>{
  if(history.length > 1) history.back();
  else location.href = "index.html";
});

inpName?.addEventListener("input", ()=>{
  inpId.value = slugifyNameToId(inpName.value);
});

btnUnlock?.addEventListener("click", async ()=>{
  gateErr.textContent = "";
  const secret = String(inpSecret.value||"").trim();
  if(!secret){
    gateErr.textContent = "Ingresa la clave.";
    return;
  }

  try{
    showLoading("Validando…", "Comprobando acceso…");
    // 1) Validar clave contra el Worker (no toca Apps Script)
    const v = await api({ action: "validate_costs_secret", costs_secret: secret });
    if(v.valid !== true) throw new Error("Clave incorrecta o no autorizada.");

    // 2) Cargar perfiles
    const out = await api({
      action: "profiles_list",
      costs_secret: secret
    });

    PROFILES_SECRET = secret;
    setLockedUI(false);

    PROFILES_CACHE = Array.isArray(out.profiles) ? out.profiles : [];
    renderTable(PROFILES_CACHE);
    listMsg.textContent = "Acceso concedido.";
    gateErr.textContent = "";
  }catch(e){
    PROFILES_SECRET = null;
    setLockedUI(true);
    gateErr.textContent = "Clave incorrecta o no autorizada.";
    console.error("unlock error:", e, e._raw);
  }finally{
    hideLoading();
  }
});

btnLogout?.addEventListener("click", ()=>{
  PROFILES_SECRET = null;
  inpSecret.value = "";
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
      costs_secret: PROFILES_SECRET,
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

// init UI locked
setLockedUI(true);
