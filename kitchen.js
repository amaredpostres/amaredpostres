// kitchen.js — AMARED Cocina (estable)
// - Carga perfiles (Sheets) + gestión protegida
// - Carga pedidos del día (admin_pin) y muestra resumen por postre
// - Costos SOLO lectura (costs_public_list)
// - Paso a paso con overlay interno (sin alert del navegador)

const ORDER_API_URL = "https://amared-orders.amaredpostres.workers.dev/";

// ===================== Helpers DOM =====================
const $ = (id) => document.getElementById(id);
const show = (el) => { if (el) el.classList.remove("hidden"); };
const hide = (el) => { if (el) el.classList.add("hidden"); };

function openModal(modalEl) {
  if (!modalEl) return;
  modalEl.classList.remove("hidden");
  modalEl.setAttribute("aria-hidden", "false");
}
function closeModal(modalEl) {
  if (!modalEl) return;
  modalEl.classList.add("hidden");
  modalEl.setAttribute("aria-hidden", "true");
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

// ===================== Storage =====================
const S = {
  get operatorId(){ return sessionStorage.getItem("amared_operator_id") || ""; },
  set operatorId(v){ sessionStorage.setItem("amared_operator_id", v || ""); },

  get operatorLabel(){ return sessionStorage.getItem("amared_operator_label") || ""; },
  set operatorLabel(v){ sessionStorage.setItem("amared_operator_label", v || ""); },

  get adminPin(){ return sessionStorage.getItem("amared_admin_pin") || ""; },
  set adminPin(v){ sessionStorage.setItem("amared_admin_pin", v || ""); },

  get profilesSecret(){ return sessionStorage.getItem("amared_profiles_secret") || ""; },
  set profilesSecret(v){ sessionStorage.setItem("amared_profiles_secret", v || ""); },
};

// ===================== API =====================
async function apiPost(body) {
  const res = await fetch(ORDER_API_URL, {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify(body || {})
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { ok:false, error:"Bad JSON", raw:text }; }
  if (!res.ok || data?.ok === false) {
    const msg = data?.error || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// ===================== Time (Bogotá) =====================
function bogotaYMD(dateLike) {
  const d = (dateLike instanceof Date) ? dateLike : new Date(dateLike);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone:"America/Bogota", year:"numeric", month:"2-digit", day:"2-digit"
  }).formatToParts(d);
  const y = parts.find(p=>p.type==="year")?.value;
  const m = parts.find(p=>p.type==="month")?.value;
  const da = parts.find(p=>p.type==="day")?.value;
  return `${y}-${m}-${da}`;
}
function isSameBogotaDay(a, b) {
  return bogotaYMD(a) === bogotaYMD(b);
}

// Soporta "YYYY-MM-DD HH:mm:ss"
function parseBogotaDateTime(str) {
  if (!str) return null;
  const s = String(str).trim();
  const iso = Date.parse(s);
  if (!Number.isNaN(iso)) return new Date(iso);

  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const [, Y, M, D, h, mi, se] = m;
  // Bogotá UTC-5
  const utcMs = Date.UTC(+Y, +M-1, +D, +h+5, +mi, +(se||0));
  return new Date(utcMs);
}

function bogotaHM(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone:"America/Bogota", hour:"2-digit", minute:"2-digit", hour12:false
  }).formatToParts(date);
  const hh = parseInt(parts.find(p=>p.type==="hour")?.value || "0", 10);
  const mm = parseInt(parts.find(p=>p.type==="minute")?.value || "0", 10);
  return { hh, mm };
}

function addDays(date, days) {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function nextBusinessDayBogota(date) {
  // date is a Date; we use Bogotá weekday by formatting
  let d = new Date(date.getTime());
  while (true) {
    const wd = new Intl.DateTimeFormat("en-US", { timeZone:"America/Bogota", weekday:"short" }).format(d);
    if (wd !== "Sat" && wd !== "Sun") return d;
    d = addDays(d, 1);
  }
}

// ===================== Products / Recipes =====================
const PRODUCTS = [
  { id:"mousse_maracuya", label:"Mousse de Maracuyá", price:10000 },
  { id:"cheesecake_cafe_panela", label:"Cheesecake café con panela", price:12500 },
  { id:"arroz_con_leche", label:"Arroz con leche", price:0, kitchenOnly:true },
];

const RECIPES = {
  mousse_maracuya: {
    title: "Mousse de Maracuyá",
    steps: [
      { text:"Lava manos, desinfecta estación y alista utensilios.", hint:"Higiene primero." },
      { text:"Mide ingredientes y prepara mezcla base.", hint:"Usa báscula / medidor." },
      { text:"Mezcla hasta homogeneizar.", hint:"Evita grumos." },
      { text:"Vierte en recipientes y lleva a nevera (30 min).", hint:"Inicia temporizador.", timerMin:30 },
      { text:"Decora y marca como LISTO.", hint:"Verifica consistencia." },
    ]
  },
  cheesecake_cafe_panela: {
    title:"Cheesecake café con panela",
    steps: [
      { text:"Organiza estación y utensilios.", hint:"Mise en place." },
      { text:"Prepara mezcla según receta.", hint:"Mide con precisión." },
      { text:"Porciona y refrigera (30 min).", hint:"Inicia temporizador.", timerMin:30 },
      { text:"Decora y marca como LISTO.", hint:"Mantén presentación." },
    ]
  },
  arroz_con_leche: {
    title:"Arroz con leche",
    steps: [
      { text:"Preparación de ingredientes y cocción.", hint:"Mantén fuego controlado." },
      { text:"Porciona, enfría y refrigera (30 min).", hint:"Inicia temporizador.", timerMin:30 },
    ]
  }
};

// ===================== UI State =====================
let PROFILES = [];
let ORDERS = [];
let currentRecipeProductId = null;
let currentStepIndex = 0;
let recipeMode = "start"; // start|steps
let countdownTimer = null;

// ===================== Elements =====================
const els = {
  btnCosts: $("btnCosts"),
  btnRefresh: $("btnRefresh"),
  btnLogout: $("btnLogout"),

  loginView: $("loginView"),
  selOperator: $("selOperator"),
  inpPin: $("inpPin"),
  btnLogin: $("btnLogin"),
  btnManageProfiles: $("btnManageProfiles"),
  loginErr: $("loginErr"),

  appView: $("appView"),
  loading: $("loading"),
  loadingTitle: $("loadingTitle"),
  loadingDesc: $("loadingDesc"),

  productCards: $("productCards"),

  costsModal: $("costsModal"),
  btnCloseCosts: $("btnCloseCosts"),
  costsList: $("costsList"),
  btnSaveCosts: $("btnSaveCosts"),

  recipeOverlay: $("recipeOverlay"),
  recipeTitle: $("recipeTitle"),
  recipeSub: $("recipeSub"),
  btnRecipeClose: $("btnRecipeClose"),
  stepCounter: $("stepCounter"),
  stepText: $("stepText"),
  stepHint: $("stepHint"),
  confirmCountdown: $("confirmCountdown"),
  btnConfirmBack: $("btnConfirmBack"),
  btnConfirmGo: $("btnConfirmGo"),

  profilesModal: $("profilesModal"),
  btnCloseProfiles: $("btnCloseProfiles"),
  profilesGate: $("profilesGate"),
  inpProfilesSecret: $("inpProfilesSecret"),
  btnProfilesUnlock: $("btnProfilesUnlock"),
  profilesGateErr: $("profilesGateErr"),
  profilesEditor: $("profilesEditor"),
  profilesList: $("profilesList"),
  inpNewProfile: $("inpNewProfile"),
  btnAddProfile: $("btnAddProfile"),
};

// ===================== Loading =====================
function setLoading(on, title="Cargando…", desc="") {
  if (!els.loading) return;
  if (on) {
    if (els.loadingTitle) els.loadingTitle.textContent = title;
    if (els.loadingDesc) els.loadingDesc.textContent = desc;
    els.loading.classList.remove("hidden");
  } else {
    els.loading.classList.add("hidden");
  }
}

// ===================== Profiles =====================
async function fetchProfilesPublic() {
  const data = await apiPost({ action:"profiles_list" });
  return Array.isArray(data.profiles) ? data.profiles : [];
}

function renderProfilesDropdown() {
  const sel = els.selOperator;
  if (!sel) return;
  sel.innerHTML = "";
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = "Selecciona un perfil…";
  sel.appendChild(opt0);

  for (const p of PROFILES) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.label;
    sel.appendChild(opt);
  }
  if (S.operatorId) sel.value = S.operatorId;
}

async function loadProfiles() {
  try {
    setLoading(true, "Cargando perfiles…", "Conectando con Google Sheets.");
    const remote = await fetchProfilesPublic();
    PROFILES = remote.length ? remote : (window.AMARED_KITCHEN_PROFILES || []);
  } catch (e) {
    PROFILES = (window.AMARED_KITCHEN_PROFILES || []);
  } finally {
    renderProfilesDropdown();
    setLoading(false);
  }
}

function openProfilesModal() {
  openModal(els.profilesModal);
  show(els.profilesGate);
  hide(els.profilesEditor);
  if (els.profilesGateErr) els.profilesGateErr.textContent = "";
  if (els.inpProfilesSecret) els.inpProfilesSecret.value = "";
}

async function validateProfilesSecret(secret) {
  const data = await apiPost({ action:"validate_secret", type:"profiles", secret });
  return !!data.ok;
}

function slugifyProfileLabel(label) {
  return String(label || "")
    .trim()
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32) || "perfil";
}

async function renderProfilesEditor() {
  const list = els.profilesList;
  if (!list) return;
  list.innerHTML = "";
  const data = await fetchProfilesPublic();
  PROFILES = data.length ? data : (window.AMARED_KITCHEN_PROFILES || []);
  renderProfilesDropdown();

  for (const p of PROFILES) {
    const row = document.createElement("div");
    row.className = "oItem";
    row.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:2px;">
        <div style="font-weight:900;">${escapeHtml(p.label)}</div>
        <div class="muted small">${escapeHtml(p.id)}</div>
      </div>
      <button class="btn secondary" type="button" data-del="${escapeHtml(p.id)}">Eliminar</button>
    `;
    list.appendChild(row);
  }

  list.querySelectorAll("button[data-del]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const pid = btn.getAttribute("data-del");
      if (!pid) return;
      const ok = await confirmInOverlay(`Eliminar perfil "${pid}"?`, 2);
      if (!ok) return;
      try {
        setLoading(true, "Eliminando perfil…", "");
        await apiPost({
          action:"profiles_delete",
          profile_id: pid,
          profiles_secret: S.profilesSecret,
          updated_by: S.operatorLabel || "COCINA"
        });
        await renderProfilesEditor();
      } catch (e) {
        alert(`No se pudo eliminar: ${e.message}`);
      } finally {
        setLoading(false);
      }
    });
  });
}

async function addProfileFromUI() {
  const label = (els.inpNewProfile?.value || "").trim();
  if (!label) return;
  const id = slugifyProfileLabel(label);
  const ok = await confirmInOverlay(`Agregar perfil "${label}"?`, 2);
  if (!ok) return;
  try {
    setLoading(true, "Agregando perfil…", "");
    await apiPost({
      action:"profiles_add",
      profile_id: id,
      label,
      profiles_secret: S.profilesSecret,
      created_by: S.operatorLabel || "COCINA"
    });
    if (els.inpNewProfile) els.inpNewProfile.value = "";
    await renderProfilesEditor();
  } catch (e) {
    alert(`No se pudo agregar: ${e.message}`);
  } finally {
    setLoading(false);
  }
}

// ===================== Login =====================
function showLogin() {
  show(els.loginView);
  hide(els.appView);
}
function showApp() {
  hide(els.loginView);
  show(els.appView);
}

function getSelectedOperator() {
  const id = els.selOperator?.value || "";
  const label = PROFILES.find(p=>p.id===id)?.label || "";
  return { id, label };
}

async function onLogin() {
  if (els.loginErr) els.loginErr.textContent = "";
  const op = getSelectedOperator();
  const pin = (els.inpPin?.value || "").trim();

  if (!op.id) {
    if (els.loginErr) els.loginErr.textContent = "Selecciona un perfil.";
    return;
  }
  if (!pin) {
    if (els.loginErr) els.loginErr.textContent = "Ingresa el PIN.";
    return;
  }

  S.operatorId = op.id;
  S.operatorLabel = op.label;
  S.adminPin = pin;

  showApp();
  await loadKitchenData();
}

// ===================== Orders / Kitchen =====================
function normalizeItems(items) {
  if (!items) return [];
  if (Array.isArray(items)) return items;
  try {
    const parsed = JSON.parse(items);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function orderCreatedAt(order) {
  const raw = order.created_at || order.createdAt || order.timestamp || order.created_time || order.date || "";
  const d = parseBogotaDateTime(raw) || new Date(raw);
  return (d && !Number.isNaN(d.getTime())) ? d : new Date();
}

function productionDayForOrder(order) {
  const created = orderCreatedAt(order);
  const { hh, mm } = bogotaHM(created);
  const after3pm = (hh > 15) || (hh === 15 && mm > 0);

  // Base: next day always (producción al día siguiente)
  let prod = addDays(created, 1);

  // Si pedido después 3pm, pasa a siguiente día hábil
  if (after3pm) prod = addDays(created, 1);

  // Si cae en fin de semana, empuja a lunes
  prod = nextBusinessDayBogota(prod);
  return prod;
}

function todayBogotaDate() {
  return new Date();
}

async function fetchOrders() {
  if (!S.adminPin) throw new Error("Missing admin pin");
  const data = await apiPost({ action:"list_orders", admin_pin:S.adminPin });
  return Array.isArray(data.orders) ? data.orders : [];
}

function aggregateForDay(orders, targetDate) {
  const totals = new Map(); // product_id -> qty
  for (const p of PRODUCTS) totals.set(p.id, 0);

  for (const o of orders) {
    const prodDay = productionDayForOrder(o);
    if (!isSameBogotaDay(prodDay, targetDate)) continue;

    const items = normalizeItems(o.items);
    for (const it of items) {
      const key = it.product_id || it.id || it.key || "";
      const qty = Number(it.qty || it.quantity || 0);
      if (!key || !Number.isFinite(qty)) continue;

      // Map possible names
      const mapped =
        key === "mousse" ? "mousse_maracuya" :
        key === "cheesecake" ? "cheesecake_cafe_panela" :
        key === "arroz" ? "arroz_con_leche" :
        key;

      if (!totals.has(mapped)) continue;
      totals.set(mapped, totals.get(mapped) + qty);
    }
  }
  return totals;
}

function renderProductCards(totals) {
  const host = els.productCards;
  if (!host) return;
  host.innerHTML = "";

  for (const p of PRODUCTS) {
    const qty = totals.get(p.id) || 0;
    const card = document.createElement("div");
    card.className = "card2";
    card.innerHTML = `
      <div class="rowBetween">
        <div>
          <div style="font-weight:950; font-size:18px;">${escapeHtml(p.label)}</div>
          <div class="muted small">Cantidad total: <b>${qty}</b></div>
        </div>
        <button class="btn primary" type="button" data-recipe="${escapeHtml(p.id)}">Insumos + receta</button>
      </div>
    `;
    host.appendChild(card);
  }

  host.querySelectorAll("button[data-recipe]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const pid = btn.getAttribute("data-recipe");
      openRecipe(pid);
    });
  });
}

async function loadKitchenData() {
  try {
    setLoading(true, "Cargando pedidos…", "Consultando Google Sheets.");
    ORDERS = await fetchOrders();
    const target = todayBogotaDate();
    const totals = aggregateForDay(ORDERS, target);
    renderProductCards(totals);
  } catch (e) {
    alert(`No se pudieron cargar los pedidos: ${e.message}`);
  } finally {
    setLoading(false);
  }
}

// ===================== Costs (Solo lectura) =====================
async function fetchCostsPublic() {
  const data = await apiPost({ action:"costs_public_list" });
  // Apps Script: costsPublicList_ devuelve { ok:true, items:[...] }? o { costs:[] } según versión.
  const items = data.items || data.costs || data.rows || [];
  return Array.isArray(items) ? items : [];
}

function openCostsModal() {
  openModal(els.costsModal);
  loadCostsIntoModal().catch(err=>{
    alert(`No se pudieron cargar costos: ${err.message}`);
  });
}

async function loadCostsIntoModal() {
  if (!els.costsList) return;
  els.costsList.innerHTML = "";
  try {
    setLoading(true, "Cargando costos…", "Solo lectura.");
    const items = await fetchCostsPublic();

    // Build map ingredient_key -> cop_per_unit
    const map = new Map();
    for (const r of items) {
      const k = String(r.ingredient_key || r.key || r.ingredient || "").trim();
      const cpu = Number(r.cop_per_unit || r.copPerUnit || r.cop || r.price || 0);
      if (k) map.set(k, cpu);
    }

    // Sections if available
    const sections = window.AMARED_COSTS_SECTIONS || [];
    if (Array.isArray(sections) && sections.length) {
      for (const sec of sections) {
        const box = document.createElement("div");
        box.className = "oGroup";
        box.innerHTML = `<div class="muted small" style="font-weight:900; margin:6px 0;">${escapeHtml(sec.title)}</div>`;
        const list = document.createElement("div");
        list.className = "oList";
        for (const key of (sec.keys || [])) {
          const v = map.get(key);
          const row = document.createElement("div");
          row.className = "oItem";
          row.innerHTML = `
            <div style="font-weight:900;">${escapeHtml(key)}</div>
            <div class="muted small">${Number.isFinite(v) ? v.toLocaleString("es-CO") : "—"} COP / unidad</div>
          `;
          list.appendChild(row);
        }
        box.appendChild(list);
        els.costsList.appendChild(box);
      }
    } else {
      // Fallback plain list
      for (const [k,v] of map.entries()) {
        const row = document.createElement("div");
        row.className = "oItem";
        row.innerHTML = `
          <div style="font-weight:900;">${escapeHtml(k)}</div>
          <div class="muted small">${Number.isFinite(v) ? v.toLocaleString("es-CO") : "—"} COP / unidad</div>
        `;
        els.costsList.appendChild(row);
      }
    }

    // Hide save button in cocina
    if (els.btnSaveCosts) {
      els.btnSaveCosts.disabled = true;
      els.btnSaveCosts.classList.add("hidden");
    }
  } finally {
    setLoading(false);
  }
}

// ===================== Recipe overlay + confirm =====================
function openRecipe(productId) {
  const rec = RECIPES[productId] || { title:"Receta", steps:[{ text:"Receta no configurada aún.", hint:"" }] };
  currentRecipeProductId = productId;
  currentStepIndex = 0;
  recipeMode = "start";

  if (els.recipeTitle) els.recipeTitle.textContent = rec.title;
  if (els.recipeSub) els.recipeSub.textContent = "Iniciando paso a paso…";

  openModal(els.recipeOverlay);

  // Prepare countdown start screen
  if (els.stepCounter) els.stepCounter.textContent = "—";
  if (els.stepText) els.stepText.textContent = "Se iniciará en:";
  if (els.stepHint) els.stepHint.textContent = "Prepárate para comenzar.";
  if (els.confirmCountdown) els.confirmCountdown.textContent = "3";

  if (els.btnConfirmBack) els.btnConfirmBack.textContent = "Volver";
  if (els.btnConfirmGo) {
    els.btnConfirmGo.textContent = "Iniciar";
    els.btnConfirmGo.disabled = true;
  }

  startCountdown(3);
}

function closeRecipe() {
  stopCountdown();
  closeModal(els.recipeOverlay);
  currentRecipeProductId = null;
  currentStepIndex = 0;
  recipeMode = "start";
}

function startCountdown(seconds) {
  stopCountdown();
  let s = seconds;
  if (els.confirmCountdown) els.confirmCountdown.textContent = String(s);
  countdownTimer = setInterval(()=>{
    s -= 1;
    if (els.confirmCountdown) els.confirmCountdown.textContent = String(Math.max(s,0));
    if (s <= 0) {
      stopCountdown();
      if (els.btnConfirmGo) els.btnConfirmGo.disabled = false;
    }
  }, 1000);
}

function stopCountdown() {
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = null;
}

function renderRecipeStep() {
  const rec = RECIPES[currentRecipeProductId];
  const steps = rec?.steps || [];
  const step = steps[currentStepIndex] || { text:"—", hint:"" };

  recipeMode = "steps";
  if (els.recipeSub) els.recipeSub.textContent = `Paso ${currentStepIndex+1} de ${steps.length}`;
  if (els.stepCounter) els.stepCounter.textContent = `${currentStepIndex+1} de ${steps.length}`;
  if (els.stepText) els.stepText.textContent = step.text || "—";
  if (els.stepHint) els.stepHint.textContent = step.hint || "";

  if (els.btnConfirmBack) els.btnConfirmBack.textContent = (currentStepIndex === 0) ? "Cerrar" : "Atrás";
  if (els.btnConfirmGo) els.btnConfirmGo.textContent = (currentStepIndex >= steps.length-1) ? "Finalizar" : "Siguiente";

  // If timer hint exists, show floating timer if present in HTML (optional)
  if (step.timerMin) {
    const tf = $("timerFloat");
    const tft = $("timerFloatTime");
    if (tf && tft) {
      tf.classList.remove("hidden");
      startTimerFloat(step.timerMin * 60);
    }
  }
}

let timerFloatInterval = null;
function startTimerFloat(seconds) {
  const tf = $("timerFloat");
  const tft = $("timerFloatTime");
  if (!tf || !tft) return;
  if (timerFloatInterval) clearInterval(timerFloatInterval);

  let s = seconds;
  tft.textContent = formatMMSS(s);
  timerFloatInterval = setInterval(()=>{
    s -= 1;
    tft.textContent = formatMMSS(Math.max(s,0));
    if (s <= 0) {
      clearInterval(timerFloatInterval);
      timerFloatInterval = null;
    }
  }, 1000);
}
function formatMMSS(s) {
  const mm = String(Math.floor(s/60)).padStart(2,"0");
  const ss = String(Math.floor(s%60)).padStart(2,"0");
  return `${mm}:${ss}`;
}

async function confirmInOverlay(message, seconds=2) {
  // Use recipe overlay countdown widgets as generic confirm, without breaking.
  return window.confirm(message);
}

// ===================== Events =====================
function bindEvents() {
  els.btnLogin?.addEventListener("click", onLogin);
  els.btnLogout?.addEventListener("click", ()=>{
    S.adminPin = "";
    S.operatorId = "";
    S.operatorLabel = "";
    showLogin();
  });
  els.btnRefresh?.addEventListener("click", loadKitchenData);

  els.btnManageProfiles?.addEventListener("click", openProfilesModal);
  els.btnCloseProfiles?.addEventListener("click", ()=> closeModal(els.profilesModal));

  els.btnProfilesUnlock?.addEventListener("click", async ()=>{
    const secret = (els.inpProfilesSecret?.value || "").trim();
    if (els.profilesGateErr) els.profilesGateErr.textContent = "";
    if (!secret) {
      if (els.profilesGateErr) els.profilesGateErr.textContent = "Ingresa la clave de perfiles.";
      return;
    }
    try {
      setLoading(true, "Validando clave…", "");
      const ok = await validateProfilesSecret(secret);
      if (!ok) throw new Error("Clave incorrecta");
      S.profilesSecret = secret;
      hide(els.profilesGate);
      show(els.profilesEditor);
      await renderProfilesEditor();
    } catch (e) {
      if (els.profilesGateErr) els.profilesGateErr.textContent = e.message || "No se pudo validar.";
    } finally {
      setLoading(false);
    }
  });

  // Add profile button is inside modal; query by text? It's the only primary in that row.
  // kitchen.html doesn't include an id; we locate the add button in profilesEditor container.
  const addBtn = els.profilesEditor?.querySelector("button.btn.primary");
  if (addBtn) addBtn.addEventListener("click", addProfileFromUI);

  els.btnCosts?.addEventListener("click", openCostsModal);
  els.btnCloseCosts?.addEventListener("click", ()=> closeModal(els.costsModal));

  els.btnRecipeClose?.addEventListener("click", closeRecipe);
  els.btnConfirmBack?.addEventListener("click", ()=>{
    if (recipeMode === "start") return closeRecipe();
    if (currentStepIndex === 0) return closeRecipe();
    currentStepIndex = Math.max(0, currentStepIndex - 1);
    renderRecipeStep();
  });
  els.btnConfirmGo?.addEventListener("click", ()=>{
    if (recipeMode === "start") {
      renderRecipeStep();
      return;
    }
    const rec = RECIPES[currentRecipeProductId];
    const steps = rec?.steps || [];
    if (currentStepIndex >= steps.length - 1) {
      closeRecipe();
      return;
    }
    currentStepIndex += 1;
    renderRecipeStep();
  });
}

// ===================== Init =====================
async function init() {
  bindEvents();
  await loadProfiles();

  if (S.adminPin && S.operatorId) {
    showApp();
    await loadKitchenData();
  } else {
    showLogin();
  }
}

document.addEventListener("DOMContentLoaded", init);
