/* =========================
   AMARED - Cocina (Producción diaria)
   Ajustes:
   - Topbar oculta en Login
   - Perfiles desde kitchen-profiles.js
   - Acordeón con botón (abrir/cerrar)
   - Loading overlay por encima de confirm
   - Paso 1 ingredientes en tabla visual
   - Confirm 3s al iniciar receta (marca En proceso)
   - Timer solo en paso timer_base
   - Finalización por postre y por lote
   - Actualiza: kitchen_started_at/by y kitchen_done_at/by
   - Escribe hoja: COCINA_LOTES (upsert por producción)
========================= */

const API_URL = "https://amared-orders.amaredpostres.workers.dev/";
const TZ = "America/Bogota";
const CUTOFF_HOUR = 15; // 3:00 pm
const BASE_FRIDGE_MINUTES = 30;

const OPERATOR_PROFILES = (window.AMARED_KITCHEN_PROFILES && Array.isArray(window.AMARED_KITCHEN_PROFILES))
  ? window.AMARED_KITCHEN_PROFILES
  : [{ id:"esperanza", label:"Esperanza" }, { id:"cristian", label:"Cristian" }];

// Productos del sistema (IDs deben coincidir con items_json.id)
const PRODUCTS = [
  { id: "mousse_maracuya", name: "Mousse de Maracuyá" },
  { id: "cheesecake_cafe_panela", name: "Cheesecake de café con panela" },
  { id: "arroz_con_leche", name: "Arroz con leche (no activo)" },
];

// Recetas por UNIDAD
const RECIPE_UNIT = {
  mousse_maracuya: {
    unitIngredients: [
      { key:"Pulpa maracuyá (ml)", qty:21.4, costPerUnit:0 },
      { key:"Leche condensada (ml)", qty:42.8, costPerUnit:0 },
      { key:"Crema de leche (ml)", qty:42.8, costPerUnit:0 },
      { key:"Leche entera (ml)", qty:42.8, costPerUnit:0 },
      { key:"Gelatina sin sabor (g)", qty:1.25, costPerUnit:0 },
      { key:"Agua gelatina (ml)", qty:8.3, costPerUnit:0 },
      { key:"Vainilla (ml, opcional)", qty:0.33, costPerUnit:0 },
      { key:"Galletas trituradas (g)", qty:25, costPerUnit:0 },
      { key:"Mantequilla (g)", qty:11.7, costPerUnit:0 },
      { key:"Chocorramo (topping)", qty:1, costPerUnit:0 },
      { key:"Chocolate en polvo (logo, decorativo)", qty:1, costPerUnit:0 },
    ],
    steps: [
      { type:"batch_ingredients" },
      { type:"normal", text:"Tritura las galletas (textura arenosa).", img:"assets/steps/mousse/step01.webp" },
      { type:"normal", text:"Mezcla galleta + mantequilla derretida hasta que compacte.", img:"assets/steps/mousse/step02.webp" },
      { type:"normal", text:"Porciona y compacta 25 g de base en cada vasito.", img:"assets/steps/mousse/step03.webp" },
      { type:"timer_base", text:"Ingresa los vasitos con la base a la nevera (30 min). Cuando ya estén adentro, presiona el botón.", img:"assets/steps/mousse/step04.webp" },
      { type:"normal", text:"En licuadora mezcla TODO junto: pulpa, leche condensada, crema, leche entera y vainilla (opcional).", img:"assets/steps/mousse/step05.webp" },
      { type:"normal", text:"En olla: calienta agua hasta tibia (sin hervir).", img:"assets/steps/mousse/step06.webp" },
      { type:"normal", text:"Agrega gelatina sin sabor y revuelve hasta disolver homogéneo.", img:"assets/steps/mousse/step07.webp" },
      { type:"normal", text:"Con la licuadora encendida, integra la gelatina disuelta lentamente.", img:"assets/steps/mousse/step08.webp" },
      { type:"normal", text:"Sirve la mezcla en los vasitos sobre la base.", img:"assets/steps/mousse/step09.webp" },
      { type:"normal", text:"Refrigera mínimo 8 horas o toda la noche.", img:"assets/steps/mousse/step10.webp" },
      { type:"normal", text:"Agregar el chocorramo (1 por postre).", img:"assets/steps/mousse/step11.webp" },
      { type:"normal", text:"Espolvorea chocolate con la forma del logo.", img:"assets/steps/mousse/step12.webp" },
    ],
  },

  cheesecake_cafe_panela: {
    unitIngredients: [
      { key:"Galletas trituradas (g)", qty:25, costPerUnit:0 },
      { key:"Mantequilla (g)", qty:10, costPerUnit:0 },
      { key:"Queso crema (g)", qty:75, costPerUnit:0 },
      { key:"Crema de leche (ml)", qty:41.7, costPerUnit:0 },
      { key:"Leche condensada (g)", qty:25, costPerUnit:0 },
      { key:"Café preparado (ml)", qty:10, costPerUnit:0 },
      { key:"Panela (g)", qty:3.33, costPerUnit:0 },
      { key:"Gelatina sin sabor (g)", qty:1.67, costPerUnit:0 },
      { key:"Agua gelatina (ml)", qty:7.5, costPerUnit:0 },
      { key:"Vainilla (ml)", qty:0.33, costPerUnit:0 },
    ],
    steps: [
      { type:"batch_ingredients" },
      { type:"normal", text:"Tritura galletas (textura arenosa).", img:"assets/steps/cheesecake/step01.webp" },
      { type:"normal", text:"Mezcla galleta + mantequilla derretida.", img:"assets/steps/cheesecake/step02.webp" },
      { type:"normal", text:"Porciona y compacta 25 g de base en cada vasito.", img:"assets/steps/cheesecake/step03.webp" },
      { type:"timer_base", text:"Ingresa los vasitos con la base a la nevera (30 min). Cuando ya estén adentro, presiona el botón.", img:"assets/steps/cheesecake/step04.webp" },
      { type:"normal", text:"Mezcla queso crema + crema + leche condensada + vainilla hasta homogéneo.", img:"assets/steps/cheesecake/step06.webp" },
      { type:"normal", text:"En olla: calienta agua tibia (sin hervir).", img:"assets/steps/cheesecake/step07.webp" },
      { type:"normal", text:"Agrega gelatina y revuelve hasta disolver homogéneo.", img:"assets/steps/cheesecake/step08.webp" },
      { type:"normal", text:"Integra la gelatina disuelta lentamente mientras mezclas.", img:"assets/steps/cheesecake/step09.webp" },
      { type:"normal", text:"Sirve sobre la base y refrigera.", img:"assets/steps/cheesecake/step10.webp" },
    ],
  },

  arroz_con_leche: {
    unitIngredients: [
      { key:"Arroz (g)", qty:25, costPerUnit:0 },
      { key:"Agua (ml)", qty:83.3, costPerUnit:0 },
      { key:"Leche entera (ml)", qty:166.7, costPerUnit:0 },
      { key:"Azúcar (g)", qty:10, costPerUnit:0 },
      { key:"Leche condensada (g)", qty:25, costPerUnit:0 },
      { key:"Canela (aprox)", qty:1, costPerUnit:0 },
      { key:"Sal (aprox)", qty:1, costPerUnit:0 },
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

/* =======================
   DOM
======================= */
const loginView = document.getElementById("loginView");
const appView = document.getElementById("appView");
const topActions = document.getElementById("topActions");

const selOperator = document.getElementById("selOperator");
const inpPin = document.getElementById("inpPin");
const btnLogin = document.getElementById("btnLogin");
const loginErr = document.getElementById("loginErr");

const btnRefresh = document.getElementById("btnRefresh");
const btnLogout = document.getElementById("btnLogout");
const btnOrders = document.getElementById("btnOrders");

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

const btnStartBatch = document.getElementById("btnStartBatch");
const btnFinishBatch = document.getElementById("btnFinishBatch");

const timerBox = document.getElementById("timerBox");
const btnFridgeStart = document.getElementById("btnFridgeStart");
const timerTime = document.getElementById("timerTime");

const confirmOverlay = document.getElementById("confirmOverlay");
const confirmTitle = document.getElementById("confirmTitle");
const confirmText = document.getElementById("confirmText");
const confirmCountdown = document.getElementById("confirmCountdown");
const btnConfirmBack = document.getElementById("btnConfirmBack");
const btnConfirmGo = document.getElementById("btnConfirmGo");

/* =======================
   STATE
======================= */
let SESSION = { operatorId:null, operatorLabel:null, pin:null };

let paidOrders = [];
let todayProductionOrders = [];
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

/* ========== Lote UI state (local) ========== */
function lotKey(){
  return `AMARED_LOT_DONE_${getTodayProductionDayKey()}`;
}
function getLotDone(){
  const raw = localStorage.getItem(lotKey());
  const obj = raw ? safeJsonParse(raw) : null;
  return obj && typeof obj === "object" ? obj : {};
}
function setLotDone(obj){
  localStorage.setItem(lotKey(), JSON.stringify(obj || {}));
}

/* =======================
   UTIL
======================= */
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

function safeJsonParse(s){
  try { return JSON.parse(s); } catch { return null; }
}

function fmtDateCO(d){
  return new Intl.DateTimeFormat("es-CO", { timeZone: TZ, dateStyle: "full" }).format(d);
}
function fmtDateTimeCO(d){
  return new Intl.DateTimeFormat("es-CO", { timeZone: TZ, dateStyle:"short", timeStyle:"short" }).format(d);
}
function money(n){
  return Math.round(Number(n||0)).toLocaleString("es-CO");
}

function disableUIWhileLoading(disabled){
  if (btnRefresh) btnRefresh.disabled = disabled;
  if (btnOrders) btnOrders.disabled = disabled;
  if (btnLogin) btnLogin.disabled = disabled;
}

/* =======================
   API
======================= */
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

/* =======================
   TIME RULES (cutoff + weekend)
======================= */
function getBogotaParts(date){
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year:"numeric", month:"2-digit", day:"2-digit",
    hour:"2-digit", minute:"2-digit", second:"2-digit",
    hour12:false
  });
  const parts = fmt.formatToParts(date);
  const get = (t) => parts.find(p => p.type === t)?.value;
  return {
    y: get("year"),
    m: get("month"),
    d: get("day"),
    hh: Number(get("hour")),
    mm: Number(get("minute")),
    ss: Number(get("second")),
    key: `${get("year")}-${get("month")}-${get("day")}`
  };
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

  if (weekday === 6) return addDaysBogotaKey(orderDayKey, 2); // Sat -> Mon
  if (weekday === 0) return addDaysBogotaKey(orderDayKey, 1); // Sun -> Mon

  if (weekday === 5 && p.hh >= CUTOFF_HOUR) return addDaysBogotaKey(orderDayKey, 3); // Fri after 3pm -> Mon

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

/* =======================
   ITEMS & AGGREGATION
======================= */
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

  if (order.items) {
    const lines = String(order.items).split("\n").map(s=>s.trim()).filter(Boolean);
    const out = [];
    for(const ln of lines){
      const m = ln.replace(/^-+\s*/, "").match(/^(.+?)\s*:\s*(\d+)/);
      if(!m) continue;
      const name = m[1].trim();
      const qty = Number(m[2]);
      const found = PRODUCTS.find(p => p.name.toLowerCase() === name.toLowerCase());
      out.push({ id: found?.id || name.toLowerCase().replace(/\s+/g,"_"), name, qty });
    }
    return out.filter(it=>it.qty>0);
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

function calcBatchIngredients(productId, units){
  const recipe = RECIPE_UNIT[productId];
  if (!recipe) return { lines:[], totalCost:0 };

  let totalCost = 0;

  const lines = recipe.unitIngredients.map(ing => {
    const totalQty = (Number(ing.qty || 0) * Number(units || 0));
    const cost = (Number(ing.costPerUnit || 0) * Number(units || 0));
    totalCost += cost;

    return { key: ing.key, qty: totalQty, cost };
  });

  return { lines, totalCost };
}

/* =======================
   SESSION
======================= */
function saveSession(){
  sessionStorage.setItem("AMARED_KITCHEN_SESSION", JSON.stringify(SESSION));
}
function loadSession(){
  const raw = sessionStorage.getItem("AMARED_KITCHEN_SESSION");
  if(!raw) return false;
  const s = safeJsonParse(raw);
  if(s?.operatorId && s?.operatorLabel && s?.pin){
    SESSION = s;
    return true;
  }
  return false;
}
function clearSession(){
  sessionStorage.removeItem("AMARED_KITCHEN_SESSION");
  SESSION = { operatorId:null, operatorLabel:null, pin:null };
}

/* =======================
   UI VIEW
======================= */
function renderOperatorProfiles(){
  selOperator.innerHTML = OPERATOR_PROFILES
    .map(p => `<option value="${p.id}">${p.label}</option>`)
    .join("");
}

function showLogin(){
  loginView.classList.remove("hidden");
  appView.classList.add("hidden");
  topActions.classList.add("hidden"); // ✅ oculta acciones
}
function showApp(){
  loginView.classList.add("hidden");
  appView.classList.remove("hidden");
  topActions.classList.remove("hidden"); // ✅ muestra acciones
}

/* =======================
   ORDERS MODAL
======================= */
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

/* =======================
   CONFIRM 3s modal
======================= */
function openConfirm(){
  confirmOverlay.classList.add("show");
  confirmOverlay.setAttribute("aria-hidden","false");
}
function closeConfirm(){
  confirmOverlay.classList.remove("show");
  confirmOverlay.setAttribute("aria-hidden","true");
}
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
      try{
        await confirmOnGo?.();
      } catch (e){
        alert(String(e.message || e));
      } finally {
        confirmOnGo = null;
        closeConfirm();
        resolve(true);
      }
    };
  });
}

/* =======================
   Batch actions (bulk)
======================= */
function getBatchOrderIdsForProduct(productId){
  const ids = [];
  for(const o of todayProductionOrders){
    const items = normalizeItemsFromOrder(o);
    if(items.some(it => it.id === productId && it.qty>0)){
      ids.push(String(o.order_id));
    }
  }
  return ids;
}

function getTotalUnitsForProductInTodayBatch(productId){
  let total = 0;
  for(const o of todayProductionOrders){
    const items = normalizeItemsFromOrder(o);
    for(const it of items){
      if(it.id === productId) total += it.qty;
    }
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

function allProductsDone(){
  const needed = getProductsNeededToday();
  const done = getLotDone();
  return needed.length > 0 && needed.every(pid => done[pid] === true);
}

async function bulkUpdate(orderIds, patch){
  if(!orderIds.length) return;

  showLoading("Actualizando...", "Aplicando cambios sin duplicar peticiones.");
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

/* =======================
   Recipe overlay
======================= */
let currentStepsTotal = 0;

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

  stopBaseTimer();
  timerBox.classList.remove("show");
  timerTime.textContent = "No iniciado";

  renderRecipeStep();
  refreshFinishButtonLabel();
}

function closeRecipe(){
  recipeOverlay.classList.remove("show");
  recipeOverlay.setAttribute("aria-hidden","true");

  currentProductId = null;
  currentBatchOrderIds = [];
  currentSteps = [];
  currentStepIdx = 0;

  stopBaseTimer();
  timerBox.classList.remove("show");
  timerTime.textContent = "No iniciado";
}

function formatQty(q){
  const rounded = Math.round(q*10)/10;
  return rounded.toLocaleString("es-CO");
}

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
      <div class="muted small" style="margin-top:6px;">Verifica estos insumos antes de iniciar para evitar interrupciones.</div>
      ${rows || `<div class="muted small" style="margin-top:10px;">Sin receta configurada.</div>`}
    </div>
  `;
}

function renderRecipeStep(){
  stepCounter.textContent = `Paso ${Math.min(currentStepIdx+1,currentStepsTotal)} de ${currentStepsTotal}`;

  const step = currentSteps[currentStepIdx] || { type:"normal", text:"—", img:"assets/Logo-Isotipo-Amared.svg" };

  // Timer solo si estamos en ese paso
  if(step.type === "timer_base"){
    timerBox.classList.add("show");
  } else {
    timerBox.classList.remove("show");
  }

  if(step.type === "batch_ingredients"){
    stepText.innerHTML = renderBatchIngredientsHTML(currentProductId);
    stepHint.textContent = "Recuerda: al iniciar se marca el postre como En proceso.";
    stepImg.src = "assets/Logo-Isotipo-Amared.svg";
  } else {
    stepText.textContent = step.text || "—";
    stepHint.textContent = (step.type === "timer_base")
      ? "Cuando la base ya esté dentro de la nevera, presiona “Ya está en la nevera” para iniciar 30 min."
      : "";
    stepImg.src = step.img || "assets/Logo-Isotipo-Amared.svg";
  }

  btnPrev.disabled = currentStepIdx === 0;
  btnNext.textContent = (currentStepIdx >= currentStepsTotal-1) ? "Terminar" : "Siguiente";
  refreshFinishButtonLabel();
}

function refreshFinishButtonLabel(){
  // Botón de finalizar cambia según si es el último postre pendiente del día
  const needed = getProductsNeededToday();
  const done = getLotDone();
  const remaining = needed.filter(pid => !done[pid]);

  const isLastProduct = (remaining.length === 1 && remaining[0] === currentProductId);

  // Solo mostramos "Finalizar" en el último paso (para evitar confusiones)
  const atLastStep = currentStepIdx >= currentStepsTotal - 1;

  btnFinishBatch.disabled = !atLastStep;

  if(isLastProduct){
    btnFinishBatch.textContent = "Finalizar lote";
  } else {
    btnFinishBatch.textContent = "Finalizar preparación (este postre)";
  }

  // Iniciar elaboración: solo útil al inicio (Paso 1 o Paso 2)
  const atBeginning = currentStepIdx <= 1;
  btnStartBatch.style.display = atBeginning ? "inline-flex" : "none";
}

/* =======================
   Timer base
======================= */
btnFridgeStart.addEventListener("click", async () => {
  if(!currentBatchOrderIds.length) return;

  const iso = new Date().toISOString();

  await confirm3s(
    "Iniciar temporizador (base en nevera)",
    "Confirma que la base ya está dentro de la nevera. Se guardará el inicio y se contará 30 min.",
    async () => {
      await bulkUpdate(currentBatchOrderIds, { base_fridge_started_at: iso, kitchen_status:"En proceso" });
      startBaseTimer(iso);
    }
  );
});

function startBaseTimer(startIso){
  stopBaseTimer();
  const startMs = new Date(startIso).getTime();
  if(Number.isNaN(startMs)) return;

  baseTimerEndMs = startMs + BASE_FRIDGE_MINUTES * 60 * 1000;
  tickBaseTimer();
  baseTimerInterval = setInterval(tickBaseTimer, 250);
}

function stopBaseTimer(){
  if(baseTimerInterval) clearInterval(baseTimerInterval);
  baseTimerInterval = null;
  baseTimerEndMs = null;
}

function tickBaseTimer(){
  if(!baseTimerEndMs){
    timerTime.textContent = "No iniciado";
    return;
  }
  const left = baseTimerEndMs - Date.now();
  if(left <= 0){
    timerTime.textContent = "✅ Base lista";
    stopBaseTimer();
    alert("✅ Base lista. Puedes continuar.");
    return;
  }
  const sec = Math.ceil(left/1000);
  const mm = Math.floor(sec/60);
  const ss = sec%60;
  timerTime.textContent = `${String(mm).padStart(2,"0")}:${String(ss).padStart(2,"0")} restantes`;
}

/* =======================
   Buttons in recipe
======================= */
btnPrev.addEventListener("click", () => {
  if(currentStepIdx > 0){
    currentStepIdx--;
    renderRecipeStep();
  }
});

btnNext.addEventListener("click", () => {
  if(currentStepIdx >= currentStepsTotal-1){
    closeRecipe();
    return;
  }
  currentStepIdx++;
  renderRecipeStep();
});

btnRecipeClose.addEventListener("click", closeRecipe);

/* Iniciar elaboración:
   - confirm 3s
   - marca En proceso en backend
   - registra lote en COCINA_LOTES
*/
btnStartBatch.addEventListener("click", async () => {
  if(!currentProductId) return;
  if(!currentBatchOrderIds.length) return;

  const name = PRODUCTS.find(p=>p.id===currentProductId)?.name || currentProductId;

  await confirm3s(
    "Iniciar elaboración",
    `¿Confirmas iniciar la elaboración de: ${name}? (Se marcará como “En proceso”)`,
    async () => {
      await bulkUpdate(currentBatchOrderIds, { kitchen_status:"En proceso" });
      await upsertKitchenLot("in_progress");
      // se queda en receta
    }
  );
});

/* Finalizar:
   - si NO es último producto pendiente: marca este producto como listo (orders) + guarda en lotDone
   - si ES el último: marca listo + finaliza lote (COCINA_LOTES) y vuelve
*/
btnFinishBatch.addEventListener("click", async () => {
  if(!currentProductId) return;
  if(!currentBatchOrderIds.length) return;

  const needed = getProductsNeededToday();
  const done = getLotDone();
  const remaining = needed.filter(pid => !done[pid]);
  const isLastProduct = (remaining.length === 1 && remaining[0] === currentProductId);

  const productName = PRODUCTS.find(p=>p.id===currentProductId)?.name || currentProductId;

  if(isLastProduct){
    await confirm3s(
      "Finalizar lote",
      "Esto marcará como “Listo” el último postre del día y cerrará el lote.",
      async () => {
        await bulkUpdate(currentBatchOrderIds, { kitchen_status:"Listo" });

        const d = getLotDone();
        d[currentProductId] = true;
        setLotDone(d);

        await upsertKitchenLot("done");
        closeRecipe();
      }
    );
  } else {
    await confirm3s(
      "Finalizar preparación",
      `Esto marcará como “Listo” el postre: ${productName}.`,
      async () => {
        await bulkUpdate(currentBatchOrderIds, { kitchen_status:"Listo" });

        const d = getLotDone();
        d[currentProductId] = true;
        setLotDone(d);

        await upsertKitchenLot("in_progress");
        closeRecipe();
      }
    );
  }
});

/* =======================
   COCINA_LOTES (server)
======================= */
async function upsertKitchenLot(status){
  // Guardamos trazabilidad por día (no bloquea si falla)
  try{
    const todayKey = getTodayProductionDayKey();
    const needed = getProductsNeededToday();
    const done = getLotDone();
    const doneCountLocal = needed.filter(pid => done[pid]).length;

    const payload = {
      action: "kitchen_lot_upsert",
      admin_pin: SESSION.pin,
      operator: SESSION.operatorLabel,
      production_day: todayKey,
      status: status || "in_progress",
      products_json: JSON.stringify({ needed, done, doneCount: doneCountLocal })
    };

    await api(payload);
  } catch (_) {}
}

/* =======================
   MAIN RENDER
======================= */
function renderMain(todayKey){
  prodDateText.textContent = `Producción: ${todayKey}`;
  prodRuleText.textContent = productionRuleText(todayKey);

  const { byProduct, totalUnits } = aggregateByProduct(todayProductionOrders);
  prodPill.textContent = `${totalUnits} unidades`;

  const doneMap = getLotDone();

  // Cards pendientes
  const cards = [];
  // Cards terminadas
  const doneCardsHtml = [];

  for(const p of PRODUCTS){
    const qty = byProduct.get(p.id) || 0;
    if(qty <= 0) continue;

    const isDone = doneMap[p.id] === true;

    const { lines, totalCost } = calcBatchIngredients(p.id, qty);
    const costText = totalCost > 0 ? `$${money(totalCost)}` : "—";

    const ingHtml = lines.map(li => {
      const q = formatQty(li.qty);
      // ✅ sin “—” extra
      return `<div class="line"><span>${li.key}</span><div>${q}</div></div>`;
    }).join("");

    const content = `
      <div class="accGrid">
        <div class="rowBetween">
          <div class="muted small">Ingredientes totales (lote)</div>
          <div class="pill">Costo estimado: ${costText}</div>
        </div>
        ${ingHtml || `<div class="muted small">Sin receta configurada.</div>`}

        <div class="rowBetween" style="margin-top:8px;">
          <button class="btn secondary" data-act="start" data-pid="${p.id}" ${isDone ? "disabled" : ""}>Iniciar</button>
          <button class="btn secondary" data-act="viewOrders" data-pid="${p.id}">Ver pedidos del día</button>
        </div>
      </div>
    `;

    const cardHtml = `
      <div class="pCard ${isDone ? "" : ""}" data-pid="${p.id}">
        <div class="rowBetween">
          <div>
            <div class="muted small">${p.name}</div>
            <div class="bigNum">${qty}</div>
          </div>

          <!-- ✅ botón grande abre/cierra -->
          <button class="btn secondary" type="button" data-act="toggle" data-pid="${p.id}">
            ${"Insumos + receta"}
          </button>
        </div>

        <div class="accBody">
          <div class="rowBetween" style="margin-bottom:10px;">
            <div class="pill">Insumos</div>
            <button class="btn secondary" type="button" data-act="toggle" data-pid="${p.id}">Cerrar</button>
          </div>
          ${content}
        </div>
      </div>
    `;

    if(isDone){
      doneCardsHtml.push(cardHtml.replace("Iniciar", "Iniciar"));
    } else {
      cards.push(cardHtml);
    }
  }

  productCards.innerHTML = cards.length ? cards.join("") : `
    <div class="card2" style="grid-column:1/-1;">
      <div style="font-weight:950; font-size:18px;">No hay producción pendiente</div>
      <div class="muted small">No existen postres pendientes por preparar para ${todayKey}.</div>
    </div>
  `;

  // Sección “Preparados”
  if(doneCardsHtml.length){
    doneSection.classList.remove("hidden");
    doneCount.textContent = `${doneCardsHtml.length}`;
    doneCards.innerHTML = doneCardsHtml.join("");
  } else {
    doneSection.classList.add("hidden");
  }

  // Delegación de eventos
  productCards.onclick = async (e) => {
    const btn = e.target.closest("button[data-act]");
    if(!btn) return;
    const act = btn.dataset.act;
    const pid = btn.dataset.pid;
    const card = btn.closest(".pCard");

    if(act === "toggle"){
      card.classList.toggle("open");
      return;
    }

    if(act === "viewOrders"){
      openOrdersModal("today");
      return;
    }

    if(act === "start"){
      // confirm 3s antes de abrir receta + marcar En proceso
      const pname = PRODUCTS.find(p=>p.id===pid)?.name || pid;
      const orderIds = getBatchOrderIdsForProduct(pid);
      if(!orderIds.length){
        alert("No hay pedidos para este postre hoy.");
        return;
      }

      await confirm3s(
        "Iniciar elaboración",
        `¿Iniciar la elaboración de ${pname}? Esto marcará los pedidos como “En proceso”.`,
        async () => {
          await bulkUpdate(orderIds, { kitchen_status:"En proceso" });
          await upsertKitchenLot("in_progress");
          openRecipe(pid);
        }
      );
      return;
    }
  };
}

/* =======================
   LOAD + FILTER by Production day
======================= */
async function loadKitchenData(fromRefresh){
  const todayKey = getTodayProductionDayKey();

  showLoading(fromRefresh ? "Actualizando..." : "Cargando cocina...", "Obteniendo pedidos pagados y calculando producción del día.");
  disableUIWhileLoading(true);

  try{
    const out = await api({
      action:"list_orders",
      admin_pin: SESSION.pin,
      payment_status:"Pagado"
    });

    paidOrders = (out.orders || []).map(o => {
      let created = o.created_at;
      let dt = new Date(created);
      if(Number.isNaN(dt.getTime())){
        const m = String(created||"").match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
        if(m) created = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}-05:00`;
      }
      o.__created_iso = created;
      o.__prod_day = computeProductionDayKeyForOrder(created);
      return o;
    });

    todayProductionOrders = paidOrders
      .filter(o => o.__prod_day === todayKey)
      .filter(o => String(o.kitchen_status || "No iniciar") !== "Listo");

    historyOrders = paidOrders
      .filter(o => String(o.kitchen_status || "") === "Listo")
      .sort((a,b) => new Date(b.__created_iso).getTime() - new Date(a.__created_iso).getTime())
      .slice(0, 200);

    renderMain(todayKey);
  } finally {
    disableUIWhileLoading(false);
    hideLoading();
  }
}

/* =======================
   EVENTS: Login + toolbar + modal
======================= */
btnLogin.addEventListener("click", async () => {
  loginErr.textContent = "";

  const opId = selOperator.value;
  const opLabel = OPERATOR_PROFILES.find(p=>p.id===opId)?.label || "";
  const pin = (inpPin.value || "").trim();

  if(!opId || !opLabel || !pin){
    loginErr.textContent = "Selecciona un perfil y escribe el PIN.";
    return;
  }

  SESSION = { operatorId: opId, operatorLabel: opLabel, pin };
  saveSession();

  showApp();
  await loadKitchenData(false);
});

btnRefresh.addEventListener("click", async () => {
  await loadKitchenData(true);
});

btnLogout.addEventListener("click", () => {
  clearSession();
  closeOrdersModal();
  closeRecipe();
  showLogin();
});

btnOrders.addEventListener("click", () => openOrdersModal("today"));
btnCloseOrders.addEventListener("click", closeOrdersModal);

tabToday.addEventListener("click", () => setActiveTab("today"));
tabHistory.addEventListener("click", () => setActiveTab("history"));

/* =======================
   INIT
======================= */
(function init(){
  renderOperatorProfiles();

  if(loadSession()){
    showApp();
    loadKitchenData(false).catch(() => {
      clearSession();
      showLogin();
    });
  } else {
    showLogin();
  }
})();
