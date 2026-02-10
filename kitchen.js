const API_URL = "https://amared-orders.amaredpostres.workers.dev/";
const TZ = "America/Bogota";
const CUTOFF_HOUR = 15;
const BASE_FRIDGE_MINUTES = 30;

// ✅ Ya NO hay claves en el frontend
async function validateSecretWithWorker(type, secret) {
  const out = await api({ action:"validate_secret", type, secret });
  if (!out?.ok) throw new Error("Clave inválida");
  return true;
}

const LS_PROFILES_KEY = "AMARED_KITCHEN_PROFILES_LOCAL";
const LS_COSTS_KEY = "AMARED_INGREDIENT_PRICES_LOCAL";

const DEFAULT_PROFILES = (window.AMARED_KITCHEN_PROFILES && Array.isArray(window.AMARED_KITCHEN_PROFILES))
  ? window.AMARED_KITCHEN_PROFILES
  : [{ id:"esperanza", label:"Esperanza" }, { id:"cristian", label:"Cristian" }];

function safeJsonParse(s){ try { return JSON.parse(s); } catch { return null; } }

function loadProfiles(){
  const raw = localStorage.getItem(LS_PROFILES_KEY);
  const local = raw ? safeJsonParse(raw) : null;
  const merged = [...DEFAULT_PROFILES];
  if(Array.isArray(local)){
    for(const p of local){
      if(!p?.id || !p?.label) continue;
      if(!merged.some(x => x.id === p.id)) merged.push(p);
    }
  }
  return merged;
}
function saveProfilesLocal(list){
  localStorage.setItem(LS_PROFILES_KEY, JSON.stringify(list || []));
}
function makeIdFromLabel(label){
  return String(label||"").trim().toLowerCase()
    .replace(/[^a-z0-9áéíóúñ]+/gi, "_")
    .replace(/_+/g,"_")
    .replace(/^_|_$/g,"");
}

const DEFAULT_PRICES = (window.AMARED_INGREDIENT_PRICES && typeof window.AMARED_INGREDIENT_PRICES === "object")
  ? window.AMARED_INGREDIENT_PRICES
  : {};

function loadPrices(){
  const raw = localStorage.getItem(LS_COSTS_KEY);
  const local = raw ? safeJsonParse(raw) : null;
  return { ...DEFAULT_PRICES, ...(local && typeof local==="object" ? local : {}) };
}
function savePrices(prices){
  localStorage.setItem(LS_COSTS_KEY, JSON.stringify(prices || {}));
}

const PRODUCTS = [
  { id: "mousse_maracuya", name: "Mousse de Maracuyá" },
  { id: "cheesecake_cafe_panela", name: "Cheesecake de café con panela" },
  { id: "arroz_con_leche", name: "Arroz con leche (no activo)" },
];

const RECIPE_UNIT = {
  mousse_maracuya: {
    unitIngredients: [
      { key:"Pulpa maracuyá (ml)", qty:21.4 },
      { key:"Leche condensada (ml)", qty:42.8 },
      { key:"Crema de leche (ml)", qty:42.8 },
      { key:"Leche entera (ml)", qty:42.8 },
      { key:"Gelatina sin sabor (g)", qty:1.25 },
      { key:"Agua gelatina (ml)", qty:8.3 },
      { key:"Vainilla (ml, opcional)", qty:0.33 },
      { key:"Galletas trituradas (g)", qty:25 },
      { key:"Mantequilla (g)", qty:11.7 },
      { key:"Chocorramo (topping)", qty:1 },
      { key:"Chocolate en polvo (logo, decorativo)", qty:1 },
    ],
    steps: [
      { type:"batch_ingredients" },
      { type:"normal", text:"Tritura las galletas (textura arenosa).", img:"assets/steps/mousse/step01.webp" },
      { type:"normal", text:"Mezcla galleta + mantequilla derretida hasta que compacte.", img:"assets/steps/mousse/step02.webp" },
      { type:"normal", text:"Porciona y compacta 25 g de base en cada vasito.", img:"assets/steps/mousse/step03.webp" },
      { type:"timer_base", text:"Ingresa los vasitos con la base a la nevera (30 min). Presiona “Iniciar temporizador” cuando ya estén adentro.", img:"assets/steps/mousse/step04.webp" },
      { type:"normal", text:"En licuadora mezcla TODO junto: pulpa, leche condensada, crema, leche entera y vainilla (opcional).", img:"assets/steps/mousse/step05.webp" },
      { type:"normal", text:"En olla: calienta agua hasta tibia (sin hervir).", img:"assets/steps/mousse/step06.webp" },
      { type:"normal", text:"Agrega gelatina sin sabor y revuelve hasta disolver homogéneo.", img:"assets/steps/mousse/step07.webp" },
      { type:"normal", text:"Con la licuadora encendida, integra la gelatina disuelta lentamente.", img:"assets/steps/mousse/step08.webp" },
      { type:"normal", text:"Sirve la mezcla en los vasitos sobre la base.", img:"assets/steps/mousse/step09.webp" },
      { type:"normal", text:"Refrigera mínimo 8 horas o toda la noche.", img:"assets/steps/mousse/step10.webp" },
      { type:"normal", text:"Agregar chocorramo (20 g por postre).", img:"assets/steps/mousse/step11.webp" },
      { type:"normal", text:"Espolvorea chocolate con la forma del logo.", img:"assets/steps/mousse/step12.webp" },
    ],
  },

  cheesecake_cafe_panela: {
    unitIngredients: [
      { key:"Galletas trituradas (g)", qty:25 },
      { key:"Mantequilla (g)", qty:10 },
      { key:"Queso crema (g)", qty:75 },
      { key:"Crema de leche (ml)", qty:41.7 },
      { key:"Leche condensada (g)", qty:25 },
      { key:"Café preparado (ml)", qty:10 },
      { key:"Panela (g)", qty:3.33 },
      { key:"Gelatina sin sabor (g)", qty:1.67 },
      { key:"Agua gelatina (ml)", qty:7.5 },
      { key:"Vainilla (ml)", qty:0.33 },
      { key:"Decoración: harina galleta de leche (g)", qty:1 },
    ],
    steps: [
      { type:"batch_ingredients" },
      { type:"normal", text:"Tritura galletas (textura arenosa).", img:"assets/steps/cheesecake/step01.webp" },
      { type:"normal", text:"Mezcla galleta + mantequilla derretida.", img:"assets/steps/cheesecake/step02.webp" },
      { type:"normal", text:"Porciona y compacta 25 g de base en cada vasito.", img:"assets/steps/cheesecake/step03.webp" },
      { type:"timer_base", text:"Ingresa los vasitos con la base a la nevera (30 min). Presiona “Iniciar temporizador” cuando ya estén adentro.", img:"assets/steps/cheesecake/step04.webp" },
      { type:"normal", text:"Mezcla queso crema + crema + leche condensada + vainilla hasta homogéneo.", img:"assets/steps/cheesecake/step06.webp" },
      { type:"normal", text:"En olla: calienta agua tibia (sin hervir).", img:"assets/steps/cheesecake/step07.webp" },
      { type:"normal", text:"Agrega gelatina y revuelve hasta disolver homogéneo.", img:"assets/steps/cheesecake/step08.webp" },
      { type:"normal", text:"Integra la gelatina disuelta lentamente mientras mezclas.", img:"assets/steps/cheesecake/step09.webp" },
      { type:"normal", text:"Sirve sobre la base y refrigera.", img:"assets/steps/cheesecake/step10.webp" },
      { type:"normal", text:"Decora espolvoreando harina de la galleta de leche (decoración).", img:"assets/steps/cheesecake/step11.webp" },
    ],
  },

  arroz_con_leche: {
    unitIngredients: [
      { key:"Arroz (g)", qty:25 },
      { key:"Agua (ml)", qty:83.3 },
      { key:"Leche entera (ml)", qty:166.7 },
      { key:"Azúcar (g)", qty:10 },
      { key:"Leche condensada (g)", qty:25 },
      { key:"Canela (aprox)", qty:1 },
      { key:"Sal (aprox)", qty:1 },
    ],
    steps: [
      { type:"batch_ingredients" },
      { type:"normal", text:"Lava el arroz 2–3 veces.", img:"assets/steps/arroz/step01.webp" },
      { type:"normal", text:"Hierve agua con canela.", img:"assets/steps/arroz/step02.webp" },
      { type:"normal", text:"Agrega el arroz y cocina hasta que el agua casi se consuma.", img:"assets/steps/arroz/step03.webp" },
      { type:"normal", text:"Agrega leche, sal y azúcar.", img:"assets/steps/arroz/step04.webp" },
      { type:"normal", text:"Cocina y revuelve cada 3–4 min.", img:"assets/steps/arroz/step05.webp" },
      { type:"normal", text:"Agrega leche condensada cuando esté cremoso y cocina 5 min más.", img:"assets/steps/arroz/step06.webp" },
      { type:"normal", text:"Retira canela, reposa 10 min y sirve.", img:"assets/steps/arroz/step07.webp" },
      { type:"normal", text:"Refrigera 2–3 horas. Queso solo al servir.", img:"assets/steps/arroz/step08.webp" },
    ],
  },
};

// DOM
const loginView = document.getElementById("loginView");
const appView = document.getElementById("appView");
const topActions = document.getElementById("topActions");
const selOperator = document.getElementById("selOperator");
const inpPin = document.getElementById("inpPin");
const btnLogin = document.getElementById("btnLogin");
const btnManageProfiles = document.getElementById("btnManageProfiles");
const loginErr = document.getElementById("loginErr");
const btnRefresh = document.getElementById("btnRefresh");
const btnLogout = document.getElementById("btnLogout");
const btnOrders = document.getElementById("btnOrders");
const btnCosts = document.getElementById("btnCosts");
const prodDateText = document.getElementById("prodDateText");
const prodRuleText = document.getElementById("prodRuleText");
const prodPill = document.getElementById("prodPill");
const productCards = document.getElementById("productCards");
const doneSection = document.getElementById("doneSection");
const doneCards = document.getElementById("doneCards");
const doneCount = document.getElementById("doneCount");
const loading = document.getElementById("loading");
const loadingTitle = document.getElementById("loadingTitle");
const loadingDesc = document.getElementById("loadingDesc");
const ordersModal = document.getElementById("ordersModal");
const btnCloseOrders = document.getElementById("btnCloseOrders");
const ordersModalSub = document.getElementById("ordersModalSub");
const tabToday = document.getElementById("tabToday");
const tabHistory = document.getElementById("tabHistory");
const ordersList = document.getElementById("ordersList");
const recipeOverlay = document.getElementById("recipeOverlay");
const btnRecipeClose = document.getElementById("btnRecipeClose");
const recipeTitle = document.getElementById("recipeTitle");
const recipeSub = document.getElementById("recipeSub");
const stepCounter = document.getElementById("stepCounter");
const stepText = document.getElementById("stepText");
const stepHint = document.getElementById("stepHint");
const stepImg = document.getElementById("stepImg");
const btnPrev = document.getElementById("btnPrev");
const btnNext = document.getElementById("btnNext");
const timerFloat = document.getElementById("timerFloat");
const timerFloatTime = document.getElementById("timerFloatTime");
const confirmOverlay = document.getElementById("confirmOverlay");
const confirmTitle = document.getElementById("confirmTitle");
const confirmText = document.getElementById("confirmText");
const confirmCountdown = document.getElementById("confirmCountdown");
const btnConfirmBack = document.getElementById("btnConfirmBack");
const btnConfirmGo = document.getElementById("btnConfirmGo");

// Profiles modal
const profilesModal = document.getElementById("profilesModal");
const btnCloseProfiles = document.getElementById("btnCloseProfiles");
const profilesGate = document.getElementById("profilesGate");
const profilesEditor = document.getElementById("profilesEditor");
const inpProfilesSecret = document.getElementById("inpProfilesSecret");
const btnProfilesUnlock = document.getElementById("btnProfilesUnlock");
const profilesGateErr = document.getElementById("profilesGateErr");
const profilesList = document.getElementById("profilesList");
const inpNewProfile = document.getElementById("inpNewProfile");
const btnAddProfile = document.getElementById("btnAddProfile");

// Costs modal
const costsModal = document.getElementById("costsModal");
const btnCloseCosts = document.getElementById("btnCloseCosts");
const costsGate = document.getElementById("costsGate");
const costsEditor = document.getElementById("costsEditor");
const inpCostsSecret = document.getElementById("inpCostsSecret");
const btnCostsUnlock = document.getElementById("btnCostsUnlock");
const costsGateErr = document.getElementById("costsGateErr");
const costsList = document.getElementById("costsList");
const btnSaveCosts = document.getElementById("btnSaveCosts");

let SESSION = { operatorId:null, operatorLabel:null, pin:null };
let PROFILES_UNLOCKED_SECRET = null;
let COSTS_PUBLIC_LAST_UPDATED = null;
let profiles = [];
let prices = {};
let paidOrders = [];
let todayAllOrders = [];
let todayProductionOrders = [];
let todayDoneOrders = [];
let historyOrders = [];
let currentProductId = null;
let currentBatchOrderIds = [];
let currentSteps = [];
let currentStepIdx = 0;
let baseTimerInterval = null;
let baseTimerEndMs = null;
let confirmTimer = null;
let confirmOnGo = null;
let ordersTab = "today";

// Utils UI
function showLoading(title, desc){
  loadingTitle.textContent = title || "Cargando...";
  loadingDesc.textContent = desc || "Por favor espera.";
  loading.classList.add("show");
  loading.setAttribute("aria-hidden","false");
}
function hideLoading(){
  loading.classList.remove("show");
  loading.setAttribute("aria-hidden","true");
}
function disableUIWhileLoading(disabled){
  if (btnRefresh) btnRefresh.disabled = disabled;
  if (btnOrders) btnOrders.disabled = disabled;
  if (btnCosts) btnCosts.disabled = disabled;
  if (btnLogin) btnLogin.disabled = disabled;
}
function showLogin(){
  loginView.classList.remove("hidden");
  appView.classList.add("hidden");
  topActions.classList.add("hidden");
}
function showApp(){
  loginView.classList.add("hidden");
  appView.classList.remove("hidden");
  topActions.classList.remove("hidden");
}
function fmtDateTimeCO(d){
  return new Intl.DateTimeFormat("es-CO", { timeZone: TZ, dateStyle:"short", timeStyle:"short" }).format(d);
}
function money(n){
  return Math.round(Number(n||0)).toLocaleString("es-CO");
}
function formatQty(q){
  const rounded = Math.round(q*10)/10;
  return rounded.toLocaleString("es-CO");
}

// API
async function api(payload){
  const res = await fetch(API_URL, {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify(payload),
  });
  const out = await res.json().catch(async () => ({ ok:false, error: await res.text().catch(()=> "Error") }));
  if(!out.ok) throw new Error(out.error || "Error");
  return out;
}


// =================== PERFIL + COSTOS desde Sheets (solo lectura en Cocina) ===================
function normalizeIngredientKey(s){
  return String(s||"")
    .replace(/\([^\)]*\)/g,"")  // quitar ( ... )
    .replace(/\s{2,}/g," ")
    .trim();
}

async function fetchProfilesPublic(){
  try{
    const out = await api({ action:"profiles_list" });
    if(out?.ok && Array.isArray(out.profiles) && out.profiles.length){
      return out.profiles;
    }
  }catch(e){
    console.warn("No se pudieron cargar perfiles:", e);
  }
  // Fallback: perfiles base del frontend
  return DEFAULT_PROFILES;
}

async function fetchCostsPublic(){
  // Devuelve { map: {ingredient_key_normalizado: cop_per_unit}, lastUpdated }
  try{
    const out = await api({ action:"costs_public_list" });
    const items = out.items || out.costs || [];
    const map = {};
    let lastUpdated = null;

    for(const row of items){
      const key = normalizeIngredientKey(row.ingredient_key || row.key || "");
      if(!key) continue;
      const v = Number(row.cop_per_unit ?? row.copPerUnit ?? row.value ?? 0);
      map[key] = Number.isFinite(v) ? v : 0;

      const u = row.updated_at || row.updatedAt || null;
      if(u && (!lastUpdated || String(u) > String(lastUpdated))) lastUpdated = u;
    }
    return { map, lastUpdated };
  }catch(e){
    console.warn("No se pudieron cargar costos públicos:", e);
    return { map:{}, lastUpdated:null };
  }
}


// Time rules
function getBogotaParts(date){
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year:"numeric", month:"2-digit", day:"2-digit",
    hour:"2-digit", minute:"2-digit", second:"2-digit",
    hour12:false
  });
  const parts = fmt.formatToParts(date);
  const get = (t) => parts.find(p => p.type === t)?.value;
  return { hh: Number(get("hour")), key: `${get("year")}-${get("month")}-${get("day")}` };
}
function addDaysBogotaKey(yyyy_mm_dd, days){
  const [Y,M,D] = yyyy_mm_dd.split("-").map(Number);
  const dt = new Date(Date.UTC(Y, M-1, D, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + days);
  return getBogotaParts(dt).key;
}
function getWeekdayBogota(date){
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday:"short" }).formatToParts(date);
  const wd = parts.find(p=>p.type==="weekday")?.value || "";
  const map = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };
  return map[wd] ?? 0;
}
function computeProductionDayKeyForOrder(createdAt){
  const dt = new Date(createdAt);
  if (Number.isNaN(dt.getTime())) return null;
  const p = getBogotaParts(dt);
  const orderDayKey = p.key;
  const weekday = getWeekdayBogota(dt);

  if (weekday === 6) return addDaysBogotaKey(orderDayKey, 2);
  if (weekday === 0) return addDaysBogotaKey(orderDayKey, 1);
  if (weekday === 5 && p.hh >= CUTOFF_HOUR) return addDaysBogotaKey(orderDayKey, 3);
  if (p.hh >= CUTOFF_HOUR) return addDaysBogotaKey(orderDayKey, 1);
  return orderDayKey;
}
function getTodayProductionDayKey(){
  const now = new Date();
  const p = getBogotaParts(now);
  const weekday = getWeekdayBogota(now);

  if (weekday === 6) return addDaysBogotaKey(p.key, 2);
  if (weekday === 0) return addDaysBogotaKey(p.key, 1);
  if (weekday === 5 && p.hh >= CUTOFF_HOUR) return addDaysBogotaKey(p.key, 3);
  return p.key;
}
function productionRuleText(todayKey){
  return `Regla: pedidos del día hasta las 3:00 pm → se producen HOY (${todayKey}) para entregar mañana 3:30–4:00 pm. Pedidos después de 3:00 pm pasan al siguiente día hábil (viernes > 3pm → lunes).`;
}

// Items
function normalizeItemsFromOrder(order){
  const raw = order.items_json;
  if (raw) {
    const parsed = typeof raw === "string" ? safeJsonParse(raw) : raw;
    if (Array.isArray(parsed)) {
      return parsed.map(it => ({
        id: String(it.id || ""),
        name: String(it.name || ""),
        qty: Number(it.qty || 0),
      })).filter(it => it.id && it.qty > 0);
    }
  }
  return [];
}
function aggregateByProduct(orders){
  const map = new Map();
  let totalUnits = 0;
  for(const o of orders){
    const items = normalizeItemsFromOrder(o);
    for(const it of items){
      map.set(it.id, (map.get(it.id) || 0) + it.qty);
      totalUnits += it.qty;
    }
  }
  return { byProduct: map, totalUnits };
}

// Costs calc
function calcBatchIngredients(productId, units){
  const recipe = RECIPE_UNIT[productId];
  if (!recipe) return { lines:[], totalCost:0 };
  let totalCost = 0;

  const lines = recipe.unitIngredients.map(ing => {
    const totalQty = (Number(ing.qty || 0) * Number(units || 0));
    const pricePerUnit = Number(prices[ing.key] || 0);
    const cost = totalQty * pricePerUnit;
    totalCost += cost;
    return { key: ing.key, qty: totalQty, pricePerUnit, cost };
  });

  return { lines, totalCost };
}

// Session
function saveSession(){ sessionStorage.setItem("AMARED_KITCHEN_SESSION", JSON.stringify(SESSION)); }
function loadSession(){
  const raw = sessionStorage.getItem("AMARED_KITCHEN_SESSION");
  if(!raw) return false;
  const s = safeJsonParse(raw);
  if(s?.operatorId && s?.operatorLabel && s?.pin){ SESSION = s; return true; }
  return false;
}
function clearSession(){
  sessionStorage.removeItem("AMARED_KITCHEN_SESSION");
  SESSION = { operatorId:null, operatorLabel:null, pin:null };
}

// Lot done state
function lotKey(){ return `AMARED_LOT_DONE_${getTodayProductionDayKey()}`; }
function getLotDone(){
  const raw = localStorage.getItem(lotKey());
  const obj = raw ? safeJsonParse(raw) : null;
  if(!obj || typeof obj !== "object") return {};
  // ✅ Migración: versiones viejas guardaban true/false
  const out = {};
  for(const [k,v] of Object.entries(obj)){
    if(v === true) out[k] = 0; // migración: antes era boolean, ahora se recalcula
    else if(v === false || v == null) out[k] = 0;
    else {
      const n = Number(v);
      out[k] = Number.isFinite(n) && n > 0 ? n : 0;
    }
  }
  return out;
}
function setLotDone(obj){ localStorage.setItem(lotKey(), JSON.stringify(obj || {})); }

// Profiles UI
function renderOperatorProfiles(){
  selOperator.innerHTML = profiles.map(p => `<option value="${p.id}">${p.label}</option>`).join("");
}
function openProfilesModal(){
  profilesGate.classList.remove("hidden");
  profilesEditor.classList.add("hidden");
  profilesGateErr.textContent = "";
  inpProfilesSecret.value = "";
  profilesModal.classList.add("show");
  profilesModal.setAttribute("aria-hidden","false");
}
function closeProfilesModal(){
  profilesModal.classList.remove("show");
  profilesModal.setAttribute("aria-hidden","true");
}

function renderProfilesList(){
  const list = Array.isArray(profiles) ? profiles : [];
  profilesList.innerHTML = list.map(p => {
    const isBase = ["esperanza","cristian"].includes(String(p.id));
    const canDelete = !isBase;
    return `
      <div class="oItem">
        <div class="rowBetween">
          <div>
            <div style="font-weight:950;">${p.label}</div>
            <div class="muted small">${p.id}</div>
          </div>
          <div class="pill">${isBase ? "Base" : "Guardado"}</div>
        </div>
        ${canDelete ? `<button class="btn secondary" data-del="${p.id}" type="button" style="margin-top:10px;">Eliminar</button>` : ``}
      </div>
    `;
  }).join("") || `<div class="muted small" style="text-align:center; padding:14px;">No hay perfiles.</div>`;

  profilesList.onclick = async (e) => {
    const btn = e.target.closest("button[data-del]");
    if(!btn) return;
    const id = btn.dataset.del;
    if(!PROFILES_UNLOCKED_SECRET){
      alert("Primero debes desbloquear con la clave secreta.");
      return;
    }
    if(!confirm("¿Eliminar este perfil?")) return;

    try{
      showLoading("Eliminando…","Actualizando perfiles en la base de datos.");
      await api({ action:"profiles_delete", profiles_secret: PROFILES_UNLOCKED_SECRET, id });
      profiles = await fetchProfilesPublic();
      renderOperatorProfiles();
      renderProfilesList();
    }catch(err){
      alert(err?.message || "No se pudo eliminar.");
    }finally{
      hideLoading();
    }
  };
}

// Costs UI
function openCostsModal(){
  costsGate.classList.remove("hidden");
  costsEditor.classList.add("hidden");
  costsGateErr.textContent = "";
  inpCostsSecret.value = "";
  costsModal.classList.add("show");
  costsModal.setAttribute("aria-hidden","false");
}
function closeCostsModal(){
  costsModal.classList.remove("show");
  costsModal.setAttribute("aria-hidden","true");
}
function getAllIngredientKeys(){
  const set = new Set();
  for(const pid of Object.keys(RECIPE_UNIT)){
    for(const ing of (RECIPE_UNIT[pid].unitIngredients || [])) set.add(ing.key);
  }
  return Array.from(set).sort((a,b)=>a.localeCompare(b,"es"));
}
function renderCostsEditor(){
  const keys = getAllIngredientKeys();
  costsList.innerHTML = keys.map(k => {
    const v = Number(prices[k] || 0);
    return `
      <div class="priceRow">
        <div class="k">${k}</div>
        <input data-key="${k}" type="number" min="0" step="1" value="${v}">
      </div>
    `;
  }).join("");
}

// Orders modal
function setActiveTab(which){
  ordersTab = which;
  tabToday.classList.toggle("active", which==="today");
  tabHistory.classList.toggle("active", which==="history");
  renderOrdersModalList();
}
function openOrdersModal(which){
  setActiveTab(which || "today");
  ordersModal.classList.add("show");
  ordersModal.setAttribute("aria-hidden","false");
  const todayKey = getTodayProductionDayKey();
  ordersModalSub.textContent = which==="today"
    ? `Pedidos que se producen hoy (${todayKey})`
    : `Pedidos anteriores marcados como “Listo”`;
}
function closeOrdersModal(){
  ordersModal.classList.remove("show");
  ordersModal.setAttribute("aria-hidden","true");
}
function renderOrdersModalList(){
  const list = (ordersTab==="today") ? todayProductionOrders : historyOrders;
  if(!list.length){
    ordersList.innerHTML = `<div class="muted small" style="text-align:center; padding:14px;">No hay pedidos para mostrar.</div>`;
    return;
  }
  const sorted = [...list].sort((a,b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  ordersList.innerHTML = sorted.map(o => {
    const items = normalizeItemsFromOrder(o);
    const units = items.reduce((s,it)=>s+it.qty,0);
    return `
      <div class="oItem">
        <div class="rowBetween">
          <div style="font-weight:950;">${o.order_id}</div>
          <div class="pill">${units} u</div>
        </div>
        <div class="oMeta">${o.customer_name || ""} · ${fmtDateTimeCO(new Date(o.created_at))}</div>
        <div class="oMeta" style="margin-top:6px;">${items.map(it => `${it.name} x${it.qty}`).join(" · ")}</div>
      </div>
    `;
  }).join("");
}

// Confirm 3s (cierra aviso y deja loader)
function openConfirm(){ confirmOverlay.classList.add("show"); confirmOverlay.setAttribute("aria-hidden","false"); }
function closeConfirm(){ confirmOverlay.classList.remove("show"); confirmOverlay.setAttribute("aria-hidden","true"); }

function confirm3s(title, text, onGo){
  return new Promise((resolve) => {
    if(confirmTimer) clearInterval(confirmTimer);
    btnConfirmGo.disabled = true;

    confirmTitle.textContent = title || "Confirmar";
    confirmText.textContent = text || "";
    confirmCountdown.textContent = "3";
    confirmOnGo = onGo;

    openConfirm();

    let t = 3;
    confirmTimer = setInterval(() => {
      t--;
      confirmCountdown.textContent = String(t);
      if(t <= 0){
        clearInterval(confirmTimer);
        confirmTimer = null;
        btnConfirmGo.disabled = false;
        confirmCountdown.textContent = "✓";
      }
    }, 1000);

    btnConfirmBack.onclick = () => {
      if(confirmTimer) clearInterval(confirmTimer);
      confirmTimer = null;
      confirmOnGo = null;
      closeConfirm();
      resolve(false);
    };

    btnConfirmGo.onclick = async () => {
      if(btnConfirmGo.disabled) return;
      btnConfirmGo.disabled = true;
      closeConfirm(); // ✅ se cierra el aviso al confirmar
      try{ await confirmOnGo?.(); resolve(true); }
      catch(e){ alert(String(e.message||e)); resolve(false); }
      finally{ confirmOnGo = null; }
    };
  });
}

// Batch helpers
function getBatchOrderIdsForProduct(productId){
  const ids = [];
  for(const o of todayProductionOrders){
    const items = normalizeItemsFromOrder(o);
    if(items.some(it => it.id === productId && it.qty>0)) ids.push(String(o.order_id));
  }
  return ids;
}
function getTotalUnitsForProductInTodayBatch(productId){
  let total = 0;
  for(const o of todayProductionOrders){
    const items = normalizeItemsFromOrder(o);
    for(const it of items) if(it.id === productId) total += it.qty;
  }
  return total;
}
function getProductsNeededToday(){
  const { byProduct } = aggregateByProduct(todayProductionOrders);
  const needed = [];
  for(const p of PRODUCTS){
    const q = byProduct.get(p.id) || 0;
    if(q > 0) needed.push(p.id);
  }
  return needed;
}

// Bulk update
async function bulkUpdate(orderIds, patch){
  if(!orderIds.length) return;
  showLoading("Actualizando...", "Aplicando cambios.");
  disableUIWhileLoading(true);
  try{
    await api({
      action: "kitchen_bulk_update",
      admin_pin: SESSION.pin,
      operator: SESSION.operatorLabel,
      order_ids: orderIds,
      patch
    });
    await loadKitchenData(true);
  } finally {
    disableUIWhileLoading(false);
    hideLoading();
  }
}

// Recipe overlay
let currentStepsTotal = 0;

function renderBatchIngredientsHTML(productId){
  const qty = getTotalUnitsForProductInTodayBatch(productId);
  const { lines, totalCost } = calcBatchIngredients(productId, qty);
  const costText = totalCost > 0 ? `$${money(totalCost)}` : "—";

  const rows = lines.map(li => `
    <div class="batchRow">
      <div class="k">${li.key}</div>
      <div>${formatQty(li.qty)}</div>
    </div>
  `).join("");

  return `
    <div class="batchBox">
      <div class="batchTop">
        <div style="font-weight:950;">Ingredientes del lote</div>
        <div class="pill">Unidades: ${qty} · Costo: ${costText}</div>
      </div>
      <div class="muted small" style="margin-top:6px;">Verifica insumos antes de continuar.</div>
      ${rows || `<div class="muted small" style="margin-top:10px;">Sin receta configurada.</div>`}
    </div>
  `;
}

// Timer float
function showTimerFloat(){ timerFloat.classList.add("show"); timerFloat.setAttribute("aria-hidden","false"); }
function stopBaseTimer(){
  if(baseTimerInterval) clearInterval(baseTimerInterval);
  baseTimerInterval = null;
  baseTimerEndMs = null;
}
function tickBaseTimer(){
  if(!baseTimerEndMs){ timerFloatTime.textContent = "No iniciado"; return; }
  const left = baseTimerEndMs - Date.now();
  if(left <= 0){
    timerFloatTime.textContent = "✅ Base lista";
    stopBaseTimer();
    return;
  }
  const sec = Math.ceil(left/1000);
  const mm = Math.floor(sec/60);
  const ss = sec%60;
  timerFloatTime.textContent = `${String(mm).padStart(2,"0")}:${String(ss).padStart(2,"0")}`;
}
function startBaseTimer(startIso){
  stopBaseTimer();
  const startMs = new Date(startIso).getTime();
  if(Number.isNaN(startMs)) return;
  baseTimerEndMs = startMs + BASE_FRIDGE_MINUTES * 60 * 1000;
  showTimerFloat();
  tickBaseTimer();
  baseTimerInterval = setInterval(tickBaseTimer, 250);
}

function openRecipe(productId){
  currentProductId = productId;
  currentSteps = RECIPE_UNIT[productId]?.steps || [];
  currentStepsTotal = currentSteps.length || 1;
  currentStepIdx = 0;
  currentBatchOrderIds = getBatchOrderIdsForProduct(productId);

  const productName = PRODUCTS.find(p=>p.id===productId)?.name || productId;
  const todayKey = getTodayProductionDayKey();
  recipeTitle.textContent = `Receta · ${productName}`;
  recipeSub.textContent = `Producción ${todayKey} · ${currentBatchOrderIds.length} pedido(s)`;

  recipeOverlay.classList.add("show");
  recipeOverlay.setAttribute("aria-hidden","false");

  renderRecipeStep();
  hideLoading(); // ✅ loader se quita cuando ya se ve la receta
}
function closeRecipeRaw(){
  recipeOverlay.classList.remove("show");
  recipeOverlay.setAttribute("aria-hidden","true");
  currentProductId = null;
  currentBatchOrderIds = [];
  currentSteps = [];
  currentStepIdx = 0;
  currentStepsTotal = 0;
}
async function closeRecipeWithGuard(){
  if(!currentProductId) return;
  const pname = PRODUCTS.find(p=>p.id===currentProductId)?.name || currentProductId;

  await confirm3s(
    "Salir del proceso",
    `¿Deseas salir de la elaboración de "${pname}"? Esto devolverá el estado a "No iniciar".`,
    async () => {
      showLoading("Revirtiendo...", "Dejando el postre como No iniciar.");
      await api({
        action: "kitchen_bulk_update",
        admin_pin: SESSION.pin,
        operator: SESSION.operatorLabel,
        order_ids: currentBatchOrderIds,
        patch: { kitchen_status: "No iniciar" }
      });
      closeRecipeRaw();
      await loadKitchenData(true);
      hideLoading();
    }
  );
}
btnRecipeClose.addEventListener("click", async () => {
  if(!currentProductId) return closeRecipeRaw();
  await closeRecipeWithGuard();
});

function getNeededAndRemaining(){
  const needed = getProductsNeededToday();
  const done = getLotDone();
  const remaining = needed.filter(pid => !done[pid]);
  return { needed, done, remaining };
}

function renderRecipeStep(){
  const step = currentSteps[currentStepIdx] || { type:"normal", text:"—", img:"assets/Logo-Isotipo-Amared.svg" };
  stepCounter.textContent = `Paso ${Math.min(currentStepIdx+1,currentStepsTotal)} de ${currentStepsTotal}`;

  if(step.type === "batch_ingredients"){
    stepText.innerHTML = renderBatchIngredientsHTML(currentProductId);
    stepHint.textContent = "Al iniciar este paso a paso, el estado queda en “En proceso”.";
    stepImg.src = "assets/Logo-Isotipo-Amared.svg";
  } else {
    stepText.textContent = step.text || "—";
    stepHint.textContent = (step.type === "timer_base")
      ? "Para continuar debes iniciar el temporizador (confirmando que ya entró a la nevera)."
      : "";
    stepImg.src = step.img || "assets/Logo-Isotipo-Amared.svg";
  }

  btnPrev.disabled = currentStepIdx === 0;

  const atLastStep = currentStepIdx >= currentStepsTotal - 1;
  const { remaining } = getNeededAndRemaining();
  const isLastProduct = (remaining.length === 1 && remaining[0] === currentProductId);

  if(step.type === "timer_base"){
    btnNext.textContent = "Iniciar temporizador";
  } else if(atLastStep){
    btnNext.textContent = isLastProduct ? "Finalizar lote" : "Finalizar este postre";
  } else {
    btnNext.textContent = "Siguiente";
  }
}

btnPrev.addEventListener("click", () => {
  if(currentStepIdx > 0){
    currentStepIdx--;
    renderRecipeStep();
  }
});

btnNext.addEventListener("click", async () => {
  const step = currentSteps[currentStepIdx] || { type:"normal" };
  const atLastStep = currentStepIdx >= currentStepsTotal - 1;

  if(step.type === "timer_base"){
    await confirm3s(
      "Iniciar temporizador (base en nevera)",
      "Confirma que la base ya está dentro del refrigerador. Se iniciará el conteo de 30 min.",
      async () => {
        showLoading("Iniciando temporizador...", "Guardando inicio y activando contador.");
        const iso = new Date().toISOString();
        await api({
          action: "kitchen_bulk_update",
          admin_pin: SESSION.pin,
          operator: SESSION.operatorLabel,
          order_ids: currentBatchOrderIds,
          patch: { base_fridge_started_at: iso, kitchen_status:"En proceso" }
        });
        startBaseTimer(iso);
        currentStepIdx++;
        renderRecipeStep();
        hideLoading();
      }
    );
    return;
  }

  if(atLastStep){
    const { remaining } = getNeededAndRemaining();
    const isLastProduct = (remaining.length === 1 && remaining[0] === currentProductId);

    if(isLastProduct){
      await confirm3s(
        "Finalizar lote",
        "Esto marcará el último postre como “Listo” y actualizará la producción del día.",
        async () => {
          showLoading("Finalizando lote...", "Guardando estado y actualizando vista.");
          await api({
            action: "kitchen_bulk_update",
            admin_pin: SESSION.pin,
            operator: SESSION.operatorLabel,
            order_ids: currentBatchOrderIds,
            patch: { kitchen_status:"Listo" }
          });
          closeRecipeRaw();
          await loadKitchenData(true);
          hideLoading();
          location.reload(); // ✅ refresca al finalizar lote
        }
      );
    } else {
      await confirm3s(
        "Finalizar este postre",
        "Esto guardará este postre como preparado en la vista del lote (sin cerrar el lote completo).",
        async () => {
          showLoading("Finalizando...", "Marcando pedidos como Listo.");
          await api({
            action: "kitchen_bulk_update",
            admin_pin: SESSION.pin,
            operator: SESSION.operatorLabel,
            order_ids: currentBatchOrderIds,
            patch: { kitchen_status:"Listo" }
          });
          closeRecipeRaw();
          await loadKitchenData(true);
          hideLoading();
        }
      );
    }
    return;
  }

  currentStepIdx++;
  renderRecipeStep();
});

// Main render
function renderMain(todayKey){
  prodDateText.textContent = `Producción: ${todayKey}`;
  prodRuleText.textContent = productionRuleText(todayKey);

  const aggAll = aggregateByProduct(todayAllOrders);
  const aggPending = aggregateByProduct(todayProductionOrders);
  const aggDone = aggregateByProduct(todayDoneOrders);

  prodPill.textContent = `${aggPending.totalUnits} unidades`;

  const cards = [];
  const doneCardsHtml = [];

  for(const p of PRODUCTS){
    const qtyAll = aggAll.byProduct.get(p.id) || 0;
    if(qtyAll <= 0) continue;

    const doneQty = aggDone.byProduct.get(p.id) || 0;
    const pendingQty = aggPending.byProduct.get(p.id) || 0;

    function buildCard(displayQty, isDoneSection){
      const { lines, totalCost } = calcBatchIngredients(p.id, displayQty);
      const costText = totalCost > 0 ? `$${money(totalCost)}` : "—";
      const ingHtml = lines.map(li =>
        `<div class="line"><span>${li.key}</span><div>${formatQty(li.qty)}</div></div>`
      ).join("");

      return `
        <div class="pCard" data-pid="${p.id}">
          <div class="rowBetween">
            <div>
              <div class="muted small">${p.name}${isDoneSection ? " · Preparados" : ""}</div>
              <div class="bigNum">${displayQty}</div>
            </div>
            <button class="btn secondary" type="button" data-act="toggle" data-pid="${p.id}">Insumos + receta</button>
          </div>

          <div class="accBody">
            <div class="rowBetween" style="margin-bottom:10px;">
              <div class="pill">Insumos</div>
              <button class="btn secondary" type="button" data-act="toggle" data-pid="${p.id}">Cerrar</button>
            </div>

            <div class="accGrid">
              <div class="rowBetween">
                <div class="muted small">Ingredientes totales (lote)</div>
                <div class="pill">Costo estimado: ${costText}</div>
              </div>

              ${ingHtml || `<div class="muted small">Sin receta configurada.</div>`}

              <div class="rowBetween" style="margin-top:8px;">
                <button class="btn secondary" data-act="start" data-pid="${p.id}" ${isDoneSection ? "disabled" : ""}>Iniciar</button>
                <button class="btn secondary" data-act="viewOrders" data-pid="${p.id}">Ver pedidos del día</button>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    // ✅ Si entran pedidos nuevos después, solo la diferencia queda como pendiente
    if(pendingQty > 0) cards.push(buildCard(pendingQty, false));
    if(doneQty > 0) doneCardsHtml.push(buildCard(doneQty, true));
  }

  productCards.innerHTML = cards.length ? cards.join("") : `
    <div class="card2" style="grid-column:1/-1;">
      <div style="font-weight:950; font-size:18px;">No hay producción pendiente</div>
      <div class="muted small">No existen postres pendientes por preparar para ${todayKey}.</div>
    </div>
  `;

  if(doneCardsHtml.length){
    doneSection.classList.remove("hidden");
    doneCount.textContent = `${doneCardsHtml.length}`;
    doneCards.innerHTML = doneCardsHtml.join("");
  } else {
    doneSection.classList.add("hidden");
  }

  function bindCardsClick(container){
  if(!container) return;
  container.onclick = async (e) => {
    const btn = e.target.closest("button[data-act]");
    if(!btn) return;
    const act = btn.dataset.act;
    const pid = btn.dataset.pid;
    const card = btn.closest(".pCard");

    if(act === "toggle"){ 
      if(card) card.classList.toggle("open"); 
      return; 
    }
    if(act === "viewOrders"){ 
      openOrdersModal("today"); 
      return; 
    }

    if(act === "start"){
      const pname = PRODUCTS.find(p=>p.id===pid)?.name || pid;
      const orderIds = getBatchOrderIdsForProduct(pid);
      if(!orderIds.length){ alert("No hay pedidos para este postre hoy."); return; }

      await confirm3s(
        "Iniciar paso a paso",
        `¿Iniciar la elaboración de ${pname}? Esto marcará los pedidos como “En proceso”.`,
        async () => {
          showLoading("Iniciando...", "Cargando receta y marcando estado en proceso.");
          await api({
            action: "kitchen_bulk_update",
            admin_pin: SESSION.pin,
            operator: SESSION.operatorLabel,
            order_ids: orderIds,
            patch: { kitchen_status:"En proceso" }
          });
          openRecipe(pid);
        }
      );
    }
  };
}

  // ⬇️ Delegación de eventos en AMBAS columnas
  bindCardsClick(productCards);
  bindCardsClick(doneCards);
}

 // Load + filter
async function loadKitchenData(fromRefresh){
  const todayKey = getTodayProductionDayKey();
  showLoading(fromRefresh ? "Actualizando..." : "Cargando cocina...", "Obteniendo pedidos pagados y calculando producción del día.");
  disableUIWhileLoading(true);
  try{
    const out = await api({ action:"list_orders", admin_pin: SESSION.pin, payment_status:"Pagado" });

    paidOrders = (out.orders || []).map(o => {
      o.__prod_day = computeProductionDayKeyForOrder(o.created_at);
      return o;
    });

    todayAllOrders = paidOrders.filter(o => o.__prod_day === todayKey);

    todayProductionOrders = todayAllOrders
      .filter(o => String(o.kitchen_status || "No iniciar") !== "Listo");

    todayDoneOrders = todayAllOrders
      .filter(o => String(o.kitchen_status || "") === "Listo");

    historyOrders = paidOrders
      .filter(o => String(o.kitchen_status || "") === "Listo")
      .sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 200);

    renderMain(todayKey);
  } finally {
    disableUIWhileLoading(false);
    hideLoading();
  }
}

// Events
tabToday.addEventListener("click", () => setActiveTab("today"));
tabHistory.addEventListener("click", () => setActiveTab("history"));
btnCloseOrders.addEventListener("click", closeOrdersModal);
btnOrders.addEventListener("click", () => openOrdersModal("today"));

// Login
btnLogin.addEventListener("click", async () => {
  loginErr.textContent = "";
  const opId = selOperator.value;
  const opLabel = profiles.find(p => p.id===opId)?.label || "";
  const pin = (inpPin.value || "").trim();
  if(!opId || !opLabel || !pin){ loginErr.textContent = "Selecciona un perfil y escribe el PIN."; return; }
  SESSION = { operatorId: opId, operatorLabel: opLabel, pin };
  saveSession();
  showApp();
  await loadKitchenData(false);
});
btnRefresh.addEventListener("click", async () => { await loadKitchenData(true); });
btnLogout.addEventListener("click", () => {
  clearSession();
  closeOrdersModal();
  closeRecipeRaw();
  showLogin();
});

// Profiles management (secure)
btnManageProfiles.addEventListener("click", openProfilesModal);
btnCloseProfiles.addEventListener("click", closeProfilesModal);

btnProfilesUnlock.addEventListener("click", async () => {
  profilesGateErr.textContent = "";
  const code = (inpProfilesSecret.value||"").trim();
  try{
    showLoading("Verificando…", "Validando clave con el servidor.");
    await validateSecretWithWorker("profiles", code);
    PROFILES_UNLOCKED_SECRET = code;
    profilesGate.classList.add("hidden");
    profilesEditor.classList.remove("hidden");
    // refrescar perfiles desde Sheets
    profiles = await fetchProfilesPublic();
    renderOperatorProfiles();
    renderProfilesList();
  } catch(e){
    PROFILES_UNLOCKED_SECRET = null;
    profilesGateErr.textContent = "Clave secreta incorrecta.";
  } finally {
    hideLoading();
  }
});

btnAddProfile.addEventListener("click", async () => {
  const name = (inpNewProfile.value||"").trim();
  if(!name) return;
  const id = makeIdFromLabel(name);
  if(!id) return;

  if(!PROFILES_UNLOCKED_SECRET){
    alert("Primero debes desbloquear con la clave secreta.");
    return;
  }

  // evitar duplicados en UI actual
  if((profiles||[]).some(p => p.id === id)){
    alert("Ya existe un perfil con ese nombre.");
    return;
  }

  try{
    showLoading("Guardando…","Creando el perfil en la base de datos.");
    await api({ action:"profiles_add", profiles_secret: PROFILES_UNLOCKED_SECRET, id, label: name });
    profiles = await fetchProfilesPublic();
    renderOperatorProfiles();
    renderProfilesList();
    inpNewProfile.value = "";
  }catch(err){
    alert(err?.message || "No se pudo agregar el perfil.");
  }finally{
    hideLoading();
  }
});

// Costs management (secure)
btnCosts.addEventListener("click", openCostsModal);
btnCloseCosts.addEventListener("click", closeCostsModal);

btnCostsUnlock.addEventListener("click", async () => {
  costsGateErr.textContent = "";
  const code = (inpCostsSecret.value||"").trim();
  try{
    showLoading("Verificando...", "Validando clave con el servidor.");
    await validateSecretWithWorker("costs", code);
    costsGate.classList.add("hidden");
    costsEditor.classList.remove("hidden");
    renderCostsEditor();
  } catch(e){
    costsGateErr.textContent = "Clave secreta incorrecta.";
  } finally {
    hideLoading();
  }
});

btnSaveCosts.addEventListener("click", () => {
  const inputs = costsList.querySelectorAll("input[data-key]");
  const next = { ...prices };
  inputs.forEach(inp => {
    const k = inp.dataset.key;
    const v = Number(inp.value || 0);
    next[k] = Number.isFinite(v) ? Math.max(0, v) : 0;
  });
  prices = next;
  savePrices(prices);
  closeCostsModal();
  renderMain(getTodayProductionDayKey());
});

// INIT
(async function init(){
  // Cargar perfiles y costos (solo lectura) desde Sheets vía Worker.
  showLoading("Cargando…", "Preparando perfiles y costos.");
  try{
    profiles = await fetchProfilesPublic();

    const c = await fetchCostsPublic();
    COSTS_PUBLIC_LAST_UPDATED = c.lastUpdated || null;

    // Mantener compatibilidad: prices usa llaves normalizadas
    const baseLocal = loadPrices();
    prices = { ...baseLocal };
    for(const k of Object.keys(c.map || {})){
      prices[k] = c.map[k];
    }

    renderOperatorProfiles();
  }catch(e){
    console.warn(e);
    profiles = loadProfiles();
    prices = loadPrices();
    renderOperatorProfiles();
  }finally{
    hideLoading();
  }

  if(loadSession()){
    showApp();
    loadKitchenData(false).catch(() => { clearSession(); showLogin(); });
  } else {
    showLogin();
  }
})();

