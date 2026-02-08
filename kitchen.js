/* =========================
   AMARED - Cocina (Producción diaria)
   - Corta pedidos a las 3:00 pm (America/Bogota)
   - Regla fin de semana:
     * Viernes después de 3pm => Producción Lunes
     * Sábado / Domingo => Producción Lunes
   - Pantalla principal: solo totales por producto
   - Acordeón: ingredientes + costo estimado
   - Iniciar: paso a paso (Paso 1 muestra ingredientes totales del lote)
   - Temporizador base: inicia con botón “Ya está en la nevera”
   - Finalizar lote: confirm 3s + kitchen_status="Listo" en bulk
   - Pedidos del día: modal con tab histórico
   - Operadores: perfiles predefinidos (no se escribe nombre)
========================= */

const API_URL = "https://amared-orders.amaredpostres.workers.dev/";
const TZ = "America/Bogota";
const CUTOFF_HOUR = 15; // 3:00 pm
const BASE_FRIDGE_MINUTES = 30;

// ✅ Perfiles aprobados (edita aquí)
const OPERATOR_PROFILES = [
  { id: "cocina_1", label: "Cocina 1" },
  { id: "cocina_2", label: "Cocina 2" },
  { id: "produccion", label: "Producción" },
];

// Productos del sistema (IDs deben coincidir con items_json.id)
const PRODUCTS = [
  { id: "mousse_maracuya", name: "Mousse de Maracuyá" },
  { id: "cheesecake_cafe_panela", name: "Cheesecake de café con panela" },
  { id: "arroz_con_leche", name: "Arroz con leche (no activo)" },
];

// Recetas por UNIDAD (tu conversión 6 → 1)
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

      // Decoración: siempre chocorramo + logo con polvo
      // (Como no diste gramos exactos para el polvo, lo dejamos como “decorativo”)
      { key:"Chocorramo (topping)", qty:1, costPerUnit:0 }, // ajusta costo por unidad de chocorramo
      { key:"Chocolate en polvo (logo, decorativo)", qty:1, costPerUnit:0 }, // costo por “uso decorativo”
    ],
    steps: [
      { type:"batch_ingredients" }, // Paso 1 especial: ingredientes totales lote
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
      { type:"normal", text:"Decora SIEMPRE con Chocorramo.", img:"assets/steps/mousse/step11.webp" },
      { type:"normal", text:"Decora el logo con una pequeña cantidad de chocolate en polvo (solo decorativo).", img:"assets/steps/mousse/step12.webp" },
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
let lastBaseFridgeStartedIso = null;

let confirmTimer = null;
let confirmOnGo = null;

let ordersTab = "today";

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
  btnRefresh.disabled = disabled;
  btnOrders.disabled = disabled;
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
   -> productionDayKey: YYYY-MM-DD (Bogotá)
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
  // YYYY-MM-DD -> Date UTC safe, then add days, then reformat in Bogota
  const [Y,M,D] = yyyy_mm_dd.split("-").map(Number);
  const dt = new Date(Date.UTC(Y, M-1, D, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + days);
  return getBogotaParts(dt).key;
}

function getWeekdayBogota(date){
  // 0 Sun ... 6 Sat, in Bogota
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday:"short" }).formatToParts(date);
  const wd = parts.find(p=>p.type==="weekday")?.value || "";
  const map = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };
  return map[wd] ?? 0;
}

// Calcula el productionDayKey según created_at (Bogotá) + reglas
function computeProductionDayKeyForOrder(createdAt){
  const dt = new Date(createdAt);
  if (Number.isNaN(dt.getTime())) return null;

  const p = getBogotaParts(dt);
  const orderDayKey = p.key;

  // weekday del orderDay (en Bogota)
  const weekday = getWeekdayBogota(dt); // 0=Dom, 6=Sab

  // Si es sábado o domingo -> producción lunes
  if (weekday === 6) { // Sat
    // lunes siguiente: +2 días
    return addDaysBogotaKey(orderDayKey, 2);
  }
  if (weekday === 0) { // Sun
    // lunes siguiente: +1 día
    return addDaysBogotaKey(orderDayKey, 1);
  }

  // Si es viernes y pasó 3pm -> producción lunes
  if (weekday === 5 && p.hh >= CUTOFF_HOUR) {
    return addDaysBogotaKey(orderDayKey, 3); // viernes -> lunes
  }

  // Para lunes-jueves:
  // - antes de 3pm => producción hoy
  // - después de 3pm => producción mañana
  if (p.hh >= CUTOFF_HOUR) return addDaysBogotaKey(orderDayKey, 1);
  return orderDayKey;
}

// Production day de HOY (según hora actual en Bogotá)
function getTodayProductionDayKey(){
  const now = new Date();
  const p = getBogotaParts(now);
  const weekday = getWeekdayBogota(now);

  // Sábado o domingo: producción lunes (aunque estés abriendo la página)
  if (weekday === 6) return addDaysBogotaKey(p.key, 2);
  if (weekday === 0) return addDaysBogotaKey(p.key, 1);

  // Si hoy es viernes y hora >= 3pm => producción lunes
  if (weekday === 5 && p.hh >= CUTOFF_HOUR) return addDaysBogotaKey(p.key, 3);

  // En días hábiles: producción “hoy”
  return p.key;
}

function productionRuleText(todayKey){
  return `Regla: pedidos del día hasta las 3:00 pm → se producen HOY (${todayKey}) para entregar mañana 3:30–4:00 pm. Pedidos después de 3:00 pm pasan al siguiente día hábil (viernes > 3pm → lunes).`;
}

/* =======================
   ITEMS & AGGREGATION
======================= */
function normalizeItemsFromOrder(order){
  // Preferimos items_json (string JSON)
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

  // Fallback: parse del texto items (si es posible)
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
  const map = new Map(); // productId -> qty
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

    return {
      key: ing.key,
      qty: totalQty,
      unitCost: ing.costPerUnit || 0,
      cost,
    };
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
   UI RENDER
======================= */
function renderOperatorProfiles(){
  selOperator.innerHTML = OPERATOR_PROFILES
    .map(p => `<option value="${p.id}">${p.label}</option>`)
    .join("");
}

function showLogin(){
  loginView.classList.remove("hidden");
  appView.classList.add("hidden");
}
function showApp(){
  loginView.classList.add("hidden");
  appView.classList.remove("hidden");
}

function renderMain(todayKey){
  const nice = fmtDateCO(new Date());
  prodDateText.textContent = `Producción: ${todayKey}`;
  prodRuleText.textContent = productionRuleText(todayKey);

  const { byProduct, totalUnits } = aggregateByProduct(todayProductionOrders);
  prodPill.textContent = `${totalUnits} unidades`;

  // cards por producto (solo los que tengan qty > 0)
  const cards = [];
  for(const p of PRODUCTS){
    const qty = byProduct.get(p.id) || 0;
    if(qty <= 0) continue;

    const { lines, totalCost } = calcBatchIngredients(p.id, qty);

    const ingHtml = lines.map(li => {
      const q = (Math.round(li.qty*10)/10).toLocaleString("es-CO");
      const c = (li.cost && li.cost > 0) ? `$${money(li.cost)}` : "—";
      return `<div class="line"><span>${li.key}</span><div>${q} · ${c}</div></div>`;
    }).join("");

    const costText = totalCost > 0 ? `$${money(totalCost)}` : "Configura costos en kitchen.js";

    cards.push(`
      <div class="pCard" data-pid="${p.id}">
        <div class="pHead rowBetween">
          <div>
            <div class="muted small">${p.name}</div>
            <div class="bigNum">${qty}</div>
          </div>
          <div class="pill">Insumos + receta</div>
        </div>

        <div class="accBody">
          <div class="accGrid">
            <div class="rowBetween">
              <div class="muted small">Ingredientes totales (lote)</div>
              <div class="pill">Costo estimado: ${costText}</div>
            </div>
            ${ingHtml || `<div class="muted small">Sin receta configurada.</div>`}

            <div class="rowBetween" style="margin-top:8px;">
              <button class="btn secondary" data-act="start" data-pid="${p.id}">Iniciar</button>
              <button class="btn secondary" data-act="viewOrders" data-pid="${p.id}">Ver pedidos del día</button>
            </div>
          </div>
        </div>
      </div>
    `);
  }

  productCards.innerHTML = cards.length ? cards.join("") : `
    <div class="card2" style="grid-column:1/-1;">
      <div style="font-weight:950; font-size:18px;">No hay producción para hoy</div>
      <div class="muted small">No existen pedidos pagados que correspondan a la producción de ${todayKey}.</div>
    </div>
  `;

  // accordion toggle
  productCards.querySelectorAll(".pCard .pHead").forEach(head => {
    head.addEventListener("click", () => {
      const card = head.closest(".pCard");
      card.classList.toggle("open");
    });
  });

  // buttons
  productCards.querySelectorAll("button[data-act='start']").forEach(b => {
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      const pid = b.dataset.pid;
      openRecipe(pid);
    });
  });

  productCards.querySelectorAll("button[data-act='viewOrders']").forEach(b => {
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      openOrdersModal("today");
    });
  });
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

  // orden por created_at (asc)
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
   RECIPE OVERLAY (batch mode)
======================= */
function openRecipe(productId){
  currentProductId = productId;
  currentSteps = RECIPE_UNIT[productId]?.steps || [];
  currentStepIdx = 0;

  // ids de pedidos del lote (producción de hoy) que contienen ese producto
  currentBatchOrderIds = getBatchOrderIdsForProduct(productId);

  const productName = PRODUCTS.find(p=>p.id===productId)?.name || productId;
  const todayKey = getTodayProductionDayKey();

  recipeTitle.textContent = `Receta · ${productName}`;
  recipeSub.textContent = `Lote de producción ${todayKey} · ${currentBatchOrderIds.length} pedido(s) involucrados`;

  recipeOverlay.classList.add("show");
  recipeOverlay.setAttribute("aria-hidden","false");

  renderRecipeStep();
  resetTimerUI();
}

function closeRecipe(){
  recipeOverlay.classList.remove("show");
  recipeOverlay.setAttribute("aria-hidden","true");

  currentProductId = null;
  currentBatchOrderIds = [];
  currentSteps = [];
  currentStepIdx = 0;

  stopBaseTimer();
  resetTimerUI();
}

function renderRecipeStep(){
  const totalSteps = currentSteps.length || 1;
  stepCounter.textContent = `Paso ${Math.min(currentStepIdx+1,totalSteps)} de ${totalSteps}`;

  const step = currentSteps[currentStepIdx] || { type:"normal", text:"—", img:"assets/Logo-Isotipo-Amared.svg" };

  // Paso 1 especial: ingredientes totales del lote
  if(step.type === "batch_ingredients"){
    const qty = getTotalUnitsForProductInTodayBatch(currentProductId);
    const { lines, totalCost } = calcBatchIngredients(currentProductId, qty);

    const listText = lines.map(li => {
      const q = (Math.round(li.qty*10)/10).toLocaleString("es-CO");
      const c = (li.cost && li.cost > 0) ? ` · $${money(li.cost)}` : "";
      return `• ${li.key}: ${q}${c}`;
    }).join("\n");

    stepText.textContent = `Ingredientes para el lote (${qty} unidades):\n\n${listText || "Sin receta configurada."}\n\nCosto estimado: ${totalCost>0 ? "$"+money(totalCost) : "Configura costos en kitchen.js"}`;
    stepHint.textContent = "Verifica los insumos antes de iniciar para evitar interrupciones.";

    stepImg.src = "assets/Logo-Isotipo-Amared.svg";
  } else {
    stepText.textContent = step.text || "—";
    stepHint.textContent = (step.type === "timer_base")
      ? "Cuando la base ya esté dentro de la nevera, presiona “Ya está en la nevera” para iniciar 30 min."
      : "";

    stepImg.src = step.img || "assets/Logo-Isotipo-Amared.svg";
  }

  btnPrev.disabled = currentStepIdx === 0;
  btnNext.textContent = (currentStepIdx >= totalSteps-1) ? "Finalizar receta" : "Siguiente";
}

btnPrev.addEventListener("click", () => {
  if(currentStepIdx > 0){
    currentStepIdx--;
    renderRecipeStep();
  }
});

btnNext.addEventListener("click", () => {
  const totalSteps = currentSteps.length || 1;
  if(currentStepIdx >= totalSteps-1){
    // cerrar receta
    closeRecipe();
    return;
  }
  currentStepIdx++;
  renderRecipeStep();
});

btnRecipeClose.addEventListener("click", closeRecipe);

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

async function bulkUpdate(patch){
  if(!currentBatchOrderIds.length) return;

  showLoading("Actualizando lote...", "Aplicando cambios en bloque para evitar múltiples peticiones.");
  disableUIWhileLoading(true);

  try{
    await api({
      action: "kitchen_bulk_update",
      admin_pin: SESSION.pin,
      operator: SESSION.operatorLabel,
      order_ids: currentBatchOrderIds,
      patch
    });

    // refrescar data
    await loadKitchenData(true);
  } finally {
    disableUIWhileLoading(false);
    hideLoading();
  }
}

// Marcar lote en proceso
btnStartBatch.addEventListener("click", async () => {
  await confirm3s(
    "Marcar lote como “En proceso”",
    `Esto marcará ${currentBatchOrderIds.length} pedido(s) como “En proceso”.`,
    async () => bulkUpdate({ kitchen_status:"En proceso" })
  );
});

// Finalizar lote
btnFinishBatch.addEventListener("click", async () => {
  await confirm3s(
    "Finalizar lote",
    `Esto marcará ${currentBatchOrderIds.length} pedido(s) como “Listo”.`,
    async () => bulkUpdate({ kitchen_status:"Listo" })
  );
});

/* =======================
   Base fridge timer (bulk)
   - Guardamos solo base_fridge_started_at (server)
   - UI calcula el resto
======================= */
btnFridgeStart.addEventListener("click", async () => {
  if(!currentBatchOrderIds.length) return;

  const iso = new Date().toISOString();
  lastBaseFridgeStartedIso = iso;

  await confirm3s(
    "Iniciar temporizador (base en nevera)",
    "Confirma que la base ya está dentro de la nevera. Se guardará el inicio y se contará 30 min.",
    async () => {
      await bulkUpdate({ base_fridge_started_at: iso, kitchen_status:"En proceso" });
      startBaseTimer(iso);
    }
  );
});

function resetTimerUI(){
  timerTime.textContent = "No iniciado";
}

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
      // Asegurar fecha usable: created_at a veces viene como "yyyy-MM-dd HH:mm:ss"
      // Lo convertimos a ISO aproximado local si no parsea; fallback.
      let created = o.created_at;
      let dt = new Date(created);
      if(Number.isNaN(dt.getTime())){
        // intentar parse "YYYY-MM-DD HH:mm:ss"
        const m = String(created||"").match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
        if(m){
          // construimos como hora local de Bogotá (aprox) => convertimos a Date (sin tz real)
          // Para lógica de día usamos Intl con TZ, pero Date necesita algo parseable:
          // usamos ISO "YYYY-MM-DDTHH:mm:ss-05:00"
          created = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}-05:00`;
        }
      }
      o.__created_iso = created;
      o.__prod_day = computeProductionDayKeyForOrder(created);
      return o;
    });

    // pedidos del día (producción hoyKey) y que NO estén Listo
    todayProductionOrders = paidOrders
      .filter(o => o.__prod_day === todayKey)
      .filter(o => String(o.kitchen_status || "No iniciar") !== "Listo");

    // histórico: pagados y kitchen_status Listo (sin limitar fechas)
    historyOrders = paidOrders
      .filter(o => String(o.kitchen_status || "") === "Listo")
      .sort((a,b) => new Date(b.__created_iso).getTime() - new Date(a.__created_iso).getTime())
      .slice(0, 200); // límite visual

    // UI main
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
    // sesión previa
    showApp();
    loadKitchenData(false).catch(() => {
      clearSession();
      showLogin();
    });
  } else {
    showLogin();
  }

  // delegación para acordeón y acciones
  productCards.addEventListener("click", (e) => {
    const card = e.target.closest(".pCard");
    if(!card) return;

    // si clic en botón no hace toggle (ya lo maneja el stopPropagation en HTML? aquí no hace falta)
    if(e.target.closest("button")) return;

    card.classList.toggle("open");
  });
})();
