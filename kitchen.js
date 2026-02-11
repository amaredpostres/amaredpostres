/* kitchen.js (REFactor V4) — AMARED Cocina
   V4 (lo que pediste):
   ✅ En pasos con temporizador: se REEMPLAZA “Siguiente →” por “Iniciar temporizador”
      y NO deja avanzar hasta iniciarlo.
   ✅ Widget de temporizador global (overlay fijo) mostrando tiempo restante en vivo.
   ✅ Último paso: botones “Finalizar postre” y “Finalizar lote”.
      - Finalizar postre: marca el producto como hecho (local) y lo mueve a “Finalizados” en UI
        (NO cambia kitchen_status a Listo; queda En proceso hasta el lote).
      - Finalizar lote: confirma con cuenta regresiva de 2s y hace bulk update a “Listo”.
   ✅ Si cierras el paso a paso SIN finalizar: revierte pedidos a “no iniciado”
      (patch kitchen_status vacío) para que no quede trazabilidad errónea.
   ✅ Confirmaciones con cuenta regresiva 2s para finalizar postre / finalizar lote / revertir.
   ✅ Costos: usa action "costs_public_list" (hoja Costos_Ingredientes en backend).
      (Si el backend no soporta, se muestra “—” sin romper la UI).
   ✅ Trazabilidad: intenta registrar en hoja cocina_lotes mediante action "kitchen_lot_log"
      (best-effort, si no existe no falla).

   Nota: NO modifica Worker ni Apps Script; solo hace llamadas opcionales (best-effort).
*/

(() => {
  "use strict";

  // =========================
  // Config
  // =========================
  const API_URL = "https://amared-orders.amaredpostres.workers.dev/";
  const TZ = "America/Bogota";
  const CUTOFF_HOUR = 15; // 3pm
  const BASE_FRIDGE_MINUTES = 30;

  const SS_KEY = "AMARED_KITCHEN_SESSION_V4";
  const LS_TIMER_KEY = "AMARED_KITCHEN_TIMERS_V1";
  const LS_DONE_KEY  = "AMARED_KITCHEN_DONE_V1";

  const DEFAULT_PROFILES = (window.AMARED_KITCHEN_PROFILES && Array.isArray(window.AMARED_KITCHEN_PROFILES))
    ? window.AMARED_KITCHEN_PROFILES
    : [{ id: "esperanza", label: "Esperanza" }, { id: "cristian", label: "Cristian" }];

  const COSTS_SECTIONS = (window.AMARED_COSTS_SECTIONS && Array.isArray(window.AMARED_COSTS_SECTIONS))
    ? window.AMARED_COSTS_SECTIONS
    : [];

  // =========================
  // Products + Recipes
  // =========================
  const PRODUCTS = [
    { id: "mousse_maracuya", name: "Mousse de Maracuyá" },
    { id: "cheesecake_cafe_panela", name: "Cheesecake de café con panela" },
    { id: "arroz_con_leche", name: "Arroz con leche (no activo)" },
  ];

  const HERO_IMG = {
    mousse_maracuya: "assets/mousse.webp",
    cheesecake_cafe_panela: "assets/cheesecake.webp",
    arroz_con_leche: "assets/arroz.webp",
  };

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
        { type:"timer_base", text:"Ingresa los vasitos con la base a la nevera (30 min). Debes iniciar el temporizador para continuar.", img:"assets/steps/mousse/step04.webp" },
        { type:"normal", text:"En licuadora mezcla TODO junto: pulpa, leche condensada, crema, leche entera y vainilla (opcional).", img:"assets/steps/mousse/step05.webp" },
        { type:"normal", text:"En olla: calienta agua hasta tibia (sin hervir).", img:"assets/steps/mousse/step06.webp" },
        { type:"normal", text:"Agrega gelatina sin sabor y revuelve hasta disolver homogéneo.", img:"assets/steps/mousse/step07.webp" },
        { type:"normal", text:"Con la licuadora encendida, integra la gelatina disuelta lentamente.", img:"assets/steps/mousse/step08.webp" },
        { type:"normal", text:"Sirve la mezcla en los vasitos sobre la base.", img:"assets/steps/mousse/step09.webp" },
        { type:"normal", text:"Refrigera mínimo 8 horas o toda la noche.", img:"assets/steps/mousse/step10.webp" },
        { type:"normal", text:"Agregar chocorramo (20 g por postre).", img:"assets/steps/mousse/step11.webp" },
        { type:"normal", text:"Espolvorea chocolate con la forma del logo.", img:"assets/steps/mousse/step12.webp" },
        { type:"final", text:"¡Listo! Verifica presentación y limpieza del área.", img:"assets/steps/mousse/step13.webp" },
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
        { type:"timer_base", text:"Ingresa los vasitos con la base a la nevera (30 min). Debes iniciar el temporizador para continuar.", img:"assets/steps/cheesecake/step04.webp" },
        { type:"normal", text:"Mezcla queso crema + crema + leche condensada + vainilla hasta homogéneo.", img:"assets/steps/cheesecake/step06.webp" },
        { type:"normal", text:"En olla: calienta agua tibia (sin hervir).", img:"assets/steps/cheesecake/step07.webp" },
        { type:"normal", text:"Agrega gelatina y revuelve hasta disolver homogéneo.", img:"assets/steps/cheesecake/step08.webp" },
        { type:"normal", text:"Integra la gelatina disuelta lentamente mientras mezclas.", img:"assets/steps/cheesecake/step09.webp" },
        { type:"normal", text:"Sirve sobre la base y refrigera.", img:"assets/steps/cheesecake/step10.webp" },
        { type:"normal", text:"Decora espolvoreando harina de galleta de leche.", img:"assets/steps/cheesecake/step11.webp" },
        { type:"final", text:"¡Listo! Verifica presentación y limpieza del área.", img:"assets/steps/cheesecake/step12.webp" },
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
        { type:"final", text:"¡Listo! Enfría y refrigera. Queso solo al servir.", img:"assets/steps/arroz/step08.webp" },
      ],
    },
  };

  // =========================
  // DOM
  // =========================
  const $ = (id) => document.getElementById(id);

  const loginBox = $("loginBox");
  const app = $("app");

  const selOperator = $("selOperator");
  const inpPin = $("inpPin");
  const btnLogin = $("btnLogin");
  const btnLogout = $("btnLogout");
  const btnRefresh = $("btnRefresh");
  const loginErr = $("loginErr");

  const todayWrap = $("todayWrap");
  const tomorrowWrap = $("tomorrowWrap");
  const inProgressWrap = $("inProgressWrap");
  const doneWrap = $("doneWrap");

  const loading = $("loading");
  const loadingTitle = $("loadingTitle");
  const loadingMsg = $("loadingMsg");
  const loadingSpin = $("loadingSpin"); // opcional si lo agregaste en HTML

  const costsModal = $("costsModal");
  const btnCloseCosts = $("btnCloseCosts");
  const costsEditor = $("costsEditor");
  const costsGateErr = $("costsGateErr");

  // =========================
  // State
  // =========================
  const state = {
    session: { operatorId: null, operatorLabel: null, pin: null },
    profiles: [],
    pricesMap: {},
    costsLastUpdated: null,

    paidOrders: [],
    todayKey: null,
    nextKey: null,

    buckets: { today: [], infoTomorrow: [], inProgress: [], done: [] },

    recipe: {
      open:false, productId:null, orderIds:[], units:0, stepIdx:0,
      timerStarted: false,
      startedAtIso: null,
    },

    widgetTick: null,
    refreshNonce: 0,
    lastTimerProductId: null,
  };

  // =========================
  // Utils
  // =========================
  function safeJsonParse(s){ try { return JSON.parse(s); } catch { return null; } }

  function showLoading(title, msg){
    if(!loading) return;
    if(loadingSpin) loadingSpin.style.display = "inline-block";
    loadingTitle.textContent = title || "Cargando…";
    loadingMsg.textContent = msg || "Procesando";
    loading.style.display = "flex";
    loading.setAttribute("aria-hidden","false");
  }
  function hideLoading(){
    if(!loading) return;
    loading.style.display = "none";
    loading.setAttribute("aria-hidden","true");
  }

  function money(n){ return Math.round(Number(n||0)).toLocaleString("es-CO"); }
  function fmtQty(q){
    const v = Math.round(Number(q||0) * 10) / 10;
    return v.toLocaleString("es-CO");
  }
  function escapeHtml(s){
    return String(s ?? "")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  async function api(payload){
    const res = await fetch(API_URL, {
      method:"POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify(payload || {}),
    });

    const out = await res.json().catch(async () => ({
      ok:false,
      error: await res.text().catch(() => "Error"),
    }));

    if(!out || out.ok !== true) throw new Error(out?.error || "Error");
    return out;
  }
  async function apiTry(payload){
    try { return await api(payload); } catch(e){ return { ok:false, error:String(e?.message||e) }; }
  }

  // =========================
  // Normalización costos
  // =========================
  function stripAccents(s){
    return String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }
  function normalizeKey1(s){
    return String(s||"").replace(/\([^\)]*\)/g,"").replace(/\s{2,}/g," ").trim();
  }
  function normalizeKey2(s){
    const base = stripAccents(normalizeKey1(s)).toLowerCase();
    const cleaned = base.replace(/[^a-z0-9\s]/g," ").replace(/\s{2,}/g," ").trim();
    const tokens = cleaned.split(" ").filter(t => t && !["de","del","la","el","sin","con","para","y","opcional","logo","decorativo","topping","harina"].includes(t));
    return tokens.join(" ");
  }
  const COST_ALIASES = {
    "pulpa maracuya": ["pulpa de maracuya","pulpa maracuya"],
    "galletas trituradas": ["galletas saladas","galletas","galletas trituradas"],
    "mantequilla": ["mantequilla sin sal","mantequilla"],
    "leche condensada": ["leche condensada"],
    "crema de leche": ["crema de leche"],
    "gelatina sin sabor": ["gelatina sin sabor"],
    "agua gelatina": ["agua gelatina","agua"],
    "chocolate en polvo": ["chocolate en polvo","chocolate"],
    "chocorramo": ["chocorramo"],
    "queso crema": ["queso crema"],
    "cafe preparado": ["cafe preparado","cafe"],
    "panela": ["panela"],
    "azucar": ["azucar"],
    "arroz": ["arroz blanco","arroz"],
    "sal": ["sal"],
    "canela": ["canela"],
    "vainilla": ["vainilla"],
  };
  function priceLookup(recipeKey){
    const k2 = normalizeKey2(recipeKey);
    if(state.pricesMap[k2] != null) return Number(state.pricesMap[k2] || 0);

    for(const [needle, alts] of Object.entries(COST_ALIASES)){
      if(k2.includes(needle) || needle.includes(k2)){
        for(const a of alts){
          const a2 = normalizeKey2(a);
          if(state.pricesMap[a2] != null) return Number(state.pricesMap[a2] || 0);
        }
      }
    }
    const keys = Object.keys(state.pricesMap || {});
    const hit = keys.find(k => k && (k.includes(k2) || k2.includes(k)));
    if(hit) return Number(state.pricesMap[hit] || 0);
    return 0;
  }

  // =========================
  // Time helpers
  // =========================
  function getBogotaParts(date){
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ, year:"numeric", month:"2-digit", day:"2-digit",
      hour:"2-digit", minute:"2-digit", second:"2-digit", hour12:false
    });
    const parts = fmt.formatToParts(date);
    const get = (t) => parts.find(p => p.type === t)?.value;
    return { hh: Number(get("hour")), key: `${get("year")}-${get("month")}-${get("day")}` };
  }
  function getWeekdayBogota(date){
    const wd = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday:"short" }).format(date);
    const map = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };
    return map[wd] ?? 0;
  }
  function addDaysBogotaKey(yyyy_mm_dd, days){
    const [Y,M,D] = yyyy_mm_dd.split("-").map(Number);
    const dt = new Date(Date.UTC(Y, M-1, D, 12, 0, 0));
    dt.setUTCDate(dt.getUTCDate() + days);
    return getBogotaParts(dt).key;
  }
  function computeProductionDayKeyForOrder(createdAt){
    const dt = new Date(createdAt);
    if (Number.isNaN(dt.getTime())) return null;

    const p = getBogotaParts(dt);
    const weekday = getWeekdayBogota(dt);
    const orderDayKey = p.key;

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
    return p.key;
  }
  function getNextProductionDayKey(todayKey){
    const [Y,M,D] = todayKey.split("-").map(Number);
    const dt = new Date(Date.UTC(Y, M-1, D, 12, 0, 0));
    const wd = getWeekdayBogota(dt);
    if (wd === 5) return addDaysBogotaKey(todayKey, 3);
    if (wd === 6) return addDaysBogotaKey(todayKey, 2);
    if (wd === 0) return addDaysBogotaKey(todayKey, 1);
    return addDaysBogotaKey(todayKey, 1);
  }
  function isSameBogotaDay(date, yyyy_mm_dd){
    return getBogotaParts(date).key === yyyy_mm_dd;
  }

  // =========================
  // Orders helpers
  // =========================
  function normalizeItemsFromOrder(order){
    const raw = order?.items_json;
    if (raw) {
      const parsed = (typeof raw === "string") ? safeJsonParse(raw) : raw;
      if (Array.isArray(parsed)) {
        return parsed
          .map(it => ({ id: String(it.id || ""), name: String(it.name || ""), qty: Number(it.qty || 0) }))
          .filter(it => it.id && it.qty > 0);
      }
    }
    return [];
  }
  function aggregateByProduct(orders){
    const map = new Map();
    for(const o of (orders || [])){
      const items = normalizeItemsFromOrder(o);
      for(const it of items){
        map.set(it.id, (map.get(it.id) || 0) + it.qty);
      }
    }
    return { byProduct: map };
  }
  function getOrderIdsThatContainProduct(orders, productId){
    const ids = [];
    for(const o of (orders || [])){
      const items = normalizeItemsFromOrder(o);
      if(items.some(it => it.id === productId && it.qty > 0)) ids.push(String(o.order_id));
    }
    return ids;
  }

  // =========================
  // Costs fetch (Costos_Ingredientes via backend)
  // =========================
  async function fetchCostsPublic(){
    const pin = state.session.pin || "";
    let out = await apiTry({ action:"costs_public_list", admin_pin: pin });
    if(out.ok === true) return parseCosts(out);

    out = await apiTry({ action:"costs_public_list" });
    if(out.ok === true) return parseCosts(out);

    return { map:{}, lastUpdated:null };
  }
  function parseCosts(out){
    const items = out.items || out.costs || [];
    const map = {};
    let lastUpdated = null;

    for(const row of items){
      const k = row.ingredient_key || row.key || row.ingredient || "";
      if(!k) continue;

      const k2 = normalizeKey2(k);
      const v = Number(row.cop_per_unit ?? row.copPerUnit ?? row.value ?? 0);
      map[k2] = Number.isFinite(v) ? v : 0;

      const u = row.updated_at || row.updatedAt || null;
      if(u && (!lastUpdated || String(u) > String(lastUpdated))) lastUpdated = u;
    }
    return { map, lastUpdated };
  }

  // =========================
  // Profiles fetch (kitchen only)
  // =========================
  async function fetchKitchenProfiles(){
    const pin = state.session.pin || "";

    let out = await apiTry({ action:"profiles_list", category:"kitchen" });
    if(out.ok === true) return parseProfiles(out);

    out = await apiTry({ action:"profiles_list", category:"kitchen", admin_pin: pin });
    if(out.ok === true) return parseProfiles(out);

    return DEFAULT_PROFILES.slice();
  }
  function parseProfiles(out){
    const arr = out.profiles || out.items || [];
    if(!Array.isArray(arr) || !arr.length) return DEFAULT_PROFILES.slice();
    return arr
      .filter(p => p && (p.id || p.profile_id) && p.label)
      .map(p => ({ id: String(p.id || p.profile_id), label: String(p.label) }));
  }
  function renderProfilesSelect(selectedId){
    const list = (Array.isArray(state.profiles) && state.profiles.length) ? state.profiles : DEFAULT_PROFILES;
    selOperator.innerHTML = `<option value="">Seleccionar…</option>` +
      list.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.label)}</option>`).join("");
    if(selectedId) selOperator.value = selectedId;
  }

  // =========================
  // Session
  // =========================
  function saveSession(){ sessionStorage.setItem(SS_KEY, JSON.stringify(state.session)); }
  function loadSession(){
    const raw = sessionStorage.getItem(SS_KEY);
    const s = raw ? safeJsonParse(raw) : null;
    if(s?.operatorId && s?.operatorLabel && s?.pin){ state.session = s; return true; }
    return false;
  }
  function clearSession(){
    sessionStorage.removeItem(SS_KEY);
    state.session = { operatorId:null, operatorLabel:null, pin:null };
  }
  function showLogin(){
    if(loginBox) loginBox.style.display = "block";
    if(app) app.style.display = "none";
    if(btnLogout) btnLogout.style.display = "none";
    if(btnRefresh) btnRefresh.style.display = "none";
  }
  function showApp(){
    if(loginBox) loginBox.style.display = "none";
    if(app) app.style.display = "block";
    if(btnLogout) btnLogout.style.display = "inline-flex";
    if(btnRefresh) btnRefresh.style.display = "inline-flex";
  }

  async function validatePinBestEffort(pin){
    const out = await apiTry({ action:"validate_admin_pin", admin_pin: pin });
    if(out.ok === true) return true;
    if(String(out.error||"").toLowerCase().includes("unknown action")) return true;
    throw new Error("PIN inválido o no autorizado.");
  }

  // =========================
  // Local done + timers
  // =========================
  function getDoneMap(){
    const raw = localStorage.getItem(LS_DONE_KEY);
    const obj = raw ? safeJsonParse(raw) : null;
    return (obj && typeof obj === "object") ? obj : {};
  }
  function setDoneMap(obj){ localStorage.setItem(LS_DONE_KEY, JSON.stringify(obj || {})); }
  function isProductDone(dayKey, productId){
    const m = getDoneMap(); return !!(m?.[dayKey]?.[productId]);
  }
  function markProductDone(dayKey, productId, val){
    const m = getDoneMap();
    if(!m[dayKey]) m[dayKey] = {};
    m[dayKey][productId] = !!val;
    setDoneMap(m);
  }

  function getTimersMap(){
    const raw = localStorage.getItem(LS_TIMER_KEY);
    const obj = raw ? safeJsonParse(raw) : null;
    return (obj && typeof obj === "object") ? obj : {};
  }
  function setTimersMap(obj){ localStorage.setItem(LS_TIMER_KEY, JSON.stringify(obj || {})); }
  function setTimerEnd(dayKey, productId, endMs){
    const m = getTimersMap(); if(!m[dayKey]) m[dayKey] = {};
    m[dayKey][productId] = Number(endMs || 0);
    setTimersMap(m);
  }
  function getTimerEnd(dayKey, productId){
    const m = getTimersMap(); return Number(m?.[dayKey]?.[productId] || 0);
  }
  function clearTimer(dayKey, productId){
    const m = getTimersMap();
    if(m?.[dayKey]){ delete m[dayKey][productId]; setTimersMap(m); }
  }

  // =========================
  // Trazabilidad (best-effort) — cocina_lotes
  // =========================
  async function logLotEvent(eventType, extra){
    const payload = {
      action: "kitchen_lot_log",
      admin_pin: state.session.pin || "",
      operator: state.session.operatorLabel || "COCINA",
      day_key: state.todayKey || "",
      event: eventType || "",
      product_id: state.recipe.productId || "",
      order_ids: (state.recipe.orderIds || []).map(String),
      extra: extra || {},
    };
    await apiTry(payload);
  }

  // =========================
  // Bulk update
  // =========================
  async function kitchenBulkUpdate(orderIds, patch){
    if(!Array.isArray(orderIds) || orderIds.length === 0) return;
    await api({
      action: "kitchen_bulk_update",
      admin_pin: state.session.pin || "",
      operator: state.session.operatorLabel || "COCINA",
      order_ids: orderIds.map(String),
      patch: patch || {},
    });
  }

  // =========================
  // Costs calculation
  // =========================
  function calcBatchIngredients(productId, units){
    const recipe = RECIPE_UNIT[productId];
    if (!recipe) return { lines:[], totalCost:0 };

    let totalCost = 0;
    const lines = (recipe.unitIngredients || []).map(ing => {
      const totalQty = Number(ing.qty || 0) * Number(units || 0);
      const pricePerUnit = priceLookup(ing.key);
      const cost = totalQty * pricePerUnit;
      totalCost += cost;
      return { key: ing.key, qty: totalQty, pricePerUnit, cost };
    });

    return { lines, totalCost };
  }

  // =========================
  // Data load
  // =========================
  async function loadData(myNonce){
    if(!state.session.pin) throw new Error("Unauthorized admin");

    state.todayKey = getTodayProductionDayKey();
    state.nextKey = getNextProductionDayKey(state.todayKey);

    showLoading("Cargando cocina…", "Obteniendo pedidos…");

    const out = await api({
      action: "list_orders",
      payment_status: "Pagado",
      admin_pin: state.session.pin,
    });

    if(myNonce !== state.refreshNonce) return;

    const paid = (out.orders || []).map(o => {
      o.__prod_day = computeProductionDayKeyForOrder(o.created_at);
      return o;
    });

    state.paidOrders = paid;

    const todayAll = paid.filter(o => o.__prod_day === state.todayKey);

    const lateToday = paid.filter(o => {
      const d = new Date(o.created_at);
      if(Number.isNaN(d.getTime())) return false;
      if(!isSameBogotaDay(d, state.todayKey)) return false;
      return getBogotaParts(d).hh >= CUTOFF_HOUR;
    });

    const inProg = todayAll.filter(o => String(o.kitchen_status || "") === "En proceso");
    const done = todayAll.filter(o => String(o.kitchen_status || "") === "Listo");
    const pending = todayAll.filter(o => {
      const ks = String(o.kitchen_status || "");
      return ks !== "En proceso" && ks !== "Listo";
    });

    state.buckets.today = pending;
    state.buckets.infoTomorrow = lateToday;
    state.buckets.inProgress = inProg;
    state.buckets.done = done;
  }

  // =========================
  // Confirm modal con cuenta regresiva (2s)
  // =========================
  function ensureConfirmOverlay(){
    if(document.getElementById("amConfirmOverlay")) return;

    const el = document.createElement("div");
    el.innerHTML = `
      <div id="amConfirmOverlay" class="modalOverlay" style="display:none;" aria-hidden="true">
        <div class="modalBox" style="max-width:520px;">
          <div style="font-weight:950; font-size:18px;" id="amConfTitle">Confirmar</div>
          <div class="muted small" id="amConfMsg" style="margin-top:8px;"></div>

          <div class="pill" id="amConfCountdown" style="margin-top:12px; display:inline-flex;">2</div>

          <div class="rowBetween" style="margin-top:14px;">
            <button id="amConfCancel" class="btn secondary" type="button">Cancelar</button>
            <button id="amConfOk" class="btn primary" type="button" disabled>Confirmar</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(el);
  }

  function confirmWithDelay({ title, message, seconds=2, okText="Confirmar" }){
    ensureConfirmOverlay();

    const ov = document.getElementById("amConfirmOverlay");
    const t = document.getElementById("amConfTitle");
    const m = document.getElementById("amConfMsg");
    const cd = document.getElementById("amConfCountdown");
    const bCancel = document.getElementById("amConfCancel");
    const bOk = document.getElementById("amConfOk");

    t.textContent = title || "Confirmar";
    m.textContent = message || "";
    bOk.textContent = okText || "Confirmar";

    ov.style.display = "flex";
    ov.setAttribute("aria-hidden","false");

    let remaining = Math.max(0, Number(seconds||0));
    cd.textContent = String(remaining);
    bOk.disabled = true;

    let interval = null;

    const close = (val) => {
      if(interval) clearInterval(interval);
      ov.style.display = "none";
      ov.setAttribute("aria-hidden","true");
      bCancel.onclick = null;
      bOk.onclick = null;
      resolve(val);
    };

    let resolve;
    const p = new Promise((res) => { resolve = res; });

    bCancel.onclick = () => close(false);
    bOk.onclick = () => close(true);

    interval = setInterval(() => {
      remaining -= 1;
      cd.textContent = String(Math.max(0, remaining));
      if(remaining <= 0){
        bOk.disabled = false;
        clearInterval(interval);
        interval = null;
        cd.textContent = "Listo";
      }
    }, 1000);

    return p;
  }

  // =========================
  // UI: acordeón por producto
  // =========================
  function renderProductAccordions(container, orders, opts){
    if(!container) return;
    const { titlePill, showActions, showInformative } = opts || {};

    const agg = aggregateByProduct(orders);
    const cards = [];

    for(const p of PRODUCTS){
      const qty = agg.byProduct.get(p.id) || 0;
      if(qty <= 0) continue;

      const doneLocal = isProductDone(state.todayKey, p.id);
      const orderIds = getOrderIdsThatContainProduct(orders, p.id);
      const hero = HERO_IMG[p.id] || "";

      cards.push(`
        <div class="pCard ${doneLocal ? "open" : ""}" data-pid="${escapeHtml(p.id)}" data-units="${qty}">
          <div class="pHead" style="cursor:pointer;">
            <div style="display:flex; gap:12px; align-items:center; min-width:0;">
              ${hero ? `<img src="${escapeHtml(hero)}" alt="" style="width:56px;height:56px;object-fit:cover;border-radius:14px;border:1px solid rgba(64,17,2,.10);" />` : ""}
              <div style="min-width:0;">
                <div class="muted small">${escapeHtml(p.name)}</div>
                <div class="bigNum">${qty}</div>
                ${titlePill ? `<div class="pill" style="margin-top:8px;">${escapeHtml(titlePill)}</div>` : ""}
              </div>
            </div>

            <div class="row" style="gap:10px; align-items:center;">
              ${doneLocal ? `<div class="pill">✅ Hecho</div>` : ``}
              <div class="pill">Ver</div>
            </div>
          </div>

          <div class="accBody" data-loaded="0">
            <div class="muted small">Cargando ingredientes…</div>
          </div>

          ${showActions ? `
            <div class="rowBetween" style="margin-top:10px;">
              <button class="btn secondary" type="button" data-act="start" ${doneLocal ? "disabled" : ""}>Iniciar paso a paso</button>
              <div class="row" style="gap:10px;">
                <button class="btn secondary" type="button" data-act="timer">⏱️ 30 min</button>
                <button class="btn secondary" type="button" data-act="done" ${doneLocal ? "disabled" : ""}>Finalizar postre</button>
              </div>
            </div>
            <div class="muted small" style="margin-top:8px;">
              Pedido(s) asociados: <b>${orderIds.length}</b>
            </div>
          ` : ``}

          ${showInformative ? `<div class="muted small" style="margin-top:10px;">* Informativo: no se inicia producción en esta vista.</div>` : ``}
        </div>
      `);
    }

    if(cards.length === 0){
      container.innerHTML = `<div class="muted small" style="padding:8px 0;">Sin datos.</div>`;
      return;
    }

    container.innerHTML = cards.join("");

    container.onclick = async (e) => {
      const card = e.target.closest(".pCard");
      if(!card) return;

      const pid = card.getAttribute("data-pid");
      const units = Number(card.getAttribute("data-units") || 0);

      const btn = e.target.closest("button[data-act]");
      if(btn){
        const act = btn.getAttribute("data-act");
        if(act === "start"){ await startRecipeFlow(pid, orders); return; }
        if(act === "timer"){ startBaseTimer(pid); return; }
        if(act === "done"){ await finalizePostre(pid, orders); return; }
      }

      const head = e.target.closest(".pHead");
      if(!head) return;

      card.classList.toggle("open");
      const body = card.querySelector(".accBody");
      if(card.classList.contains("open") && body && body.getAttribute("data-loaded") !== "1"){
        body.setAttribute("data-loaded","1");

        const { lines, totalCost } = calcBatchIngredients(pid, units);
        const costText = totalCost > 0 ? `$${money(totalCost)}` : "—";

        const ingHtml = (lines || []).map(li => `
          <div class="line">
            <span>${escapeHtml(li.key)}</span>
            <div>
              ${fmtQty(li.qty)}
              ${li.pricePerUnit ? `<span class="muted small" style="margin-left:8px;">($${money(li.pricePerUnit)}/u)</span>` : `<span class="muted small" style="margin-left:8px;">(sin costo)</span>`}
            </div>
          </div>
        `).join("");

        body.innerHTML = `
          <div class="rowBetween" style="margin-bottom:10px;">
            <div class="pill">Ingredientes (lote)</div>
            <div class="pill">Costo estimado: ${costText}</div>
          </div>
          ${ingHtml || `<div class="muted small">Sin receta configurada.</div>`}
        `;
      }
    };
  }

  function renderAll(){
    renderProductAccordions(todayWrap, state.buckets.today, {
      titlePill: `Producción ${state.todayKey}`,
      showActions: true,
      showInformative: false,
    });

    renderProductAccordions(tomorrowWrap, state.buckets.infoTomorrow, {
      titlePill: `Informativo (${state.nextKey})`,
      showActions: false,
      showInformative: true,
    });

    renderProductAccordions(inProgressWrap, state.buckets.inProgress, {
      titlePill: "En proceso",
      showActions: true,
      showInformative: false,
    });

    renderProductAccordions(doneWrap, state.buckets.done, {
      titlePill: "Finalizados (DB)",
      showActions: false,
      showInformative: false,
    });

    renderFinalizeLotButton();
  }

  // =========================
  // Overlay: Receta UX mejorada + Timer lock
  // =========================
  function injectRecipeStyles(){
    if(document.getElementById("amRecipeStylesV4")) return;
    const st = document.createElement("style");
    st.id = "amRecipeStylesV4";
    st.textContent = `
      .amRecipeGrid{ display:grid; grid-template-columns: 1.1fr .9fr; gap:14px; margin-top:12px; }
      .amRecipeCard{ background: rgba(255,255,255,.88); border:1px solid rgba(64,17,2,.12); border-radius: 18px; padding:14px; }
      .amProgress{ height:8px; border-radius:999px; background: rgba(64,17,2,.08); overflow:hidden; margin-top:10px; }
      .amProgress > div{ height:100%; width:0%; background: rgba(245,110,150,.9); border-radius:999px; }
      .amStepTitle{ font-weight: 950; font-size: 18px; }
      .amStepText{ margin-top:10px; font-weight: 900; font-size: 16px; }
      .amStepHint{ margin-top:8px; }
      .amRecipeImg{ width:100%; height:auto; border-radius: 16px; border:1px solid rgba(64,17,2,.10); display:none; }
      .amStickyTimer{ position: fixed; right: 18px; top: 78px; z-index: 99997; display:none; }
      .amStickyTimer .pill{ box-shadow: var(--shadow); display:flex; gap:10px; align-items:center; }
      .amStickyTimer .tbig{ font-weight: 950; font-size: 14px; }
      @media (max-width: 900px){
        .amRecipeGrid{ grid-template-columns: 1fr; }
        .amStickyTimer{ top: 68px; }
      }
    `;
    document.head.appendChild(st);
  }

  function ensureRecipeOverlay(){
    injectRecipeStyles();

    if(document.getElementById("amaredRecipeOverlay")) return;

    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div id="amaredRecipeOverlay" class="modalOverlay" aria-hidden="true" style="display:none;">
        <div class="modalBox" style="max-width:980px;">
          <div class="rowBetween">
            <div>
              <div class="amStepTitle" id="amRecipeTitle">Receta</div>
              <div class="muted small" id="amRecipeSub" style="margin-top:6px;"></div>
              <div class="amProgress"><div id="amProgBar"></div></div>
            </div>
            <button id="amRecipeClose" class="btn secondary" type="button">Cerrar</button>
          </div>

          <div class="amRecipeGrid">
            <div class="amRecipeCard">
              <div class="rowBetween">
                <div class="pill" id="amStepCounter">Paso</div>
                <div class="pill" id="amTimerInline" style="display:none;">⏱️ <span id="amTimerTxt"></span></div>
              </div>

              <div id="amStepText" class="amStepText"></div>
              <div id="amStepHint" class="muted small amStepHint"></div>

              <div class="rowBetween" style="margin-top:14px;">
                <button id="amPrev" class="btn secondary" type="button">← Anterior</button>
                <div class="row" style="gap:10px;">
                  <button id="amNextOrTimer" class="btn primary" type="button">Siguiente →</button>
                </div>
              </div>
            </div>

            <div class="amRecipeCard">
              <img id="amStepImg" class="amRecipeImg" alt="" />
              <div id="amImgFallback" class="muted small" style="display:none;">Sin imagen para este paso.</div>

              <div id="amFinalActions" style="display:none; margin-top:14px;">
                <div class="rowBetween">
                  <button id="amFinishPostre" class="btn secondary" type="button">Finalizar postre</button>
                  <button id="amFinishLote" class="btn primary" type="button">Finalizar lote</button>
                </div>
                <div class="muted small" style="margin-top:10px;">
                  * “Finalizar postre” lo marca como hecho (UI). “Finalizar lote” actualiza la base de datos a <b>Listo</b>.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div id="amaredToast" class="pill" style="position:fixed; left:50%; transform:translateX(-50%); bottom:18px; z-index:99999; display:none;"></div>

      <div id="amStickyTimer" class="amStickyTimer">
        <div class="pill">
          <span>⏱️</span>
          <div style="display:flex; flex-direction:column; line-height:1.15;">
            <span class="tbig" id="amStickyLabel">Temporizador</span>
            <span class="muted small" id="amStickyTime">00:00</span>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);

    document.getElementById("amRecipeClose").onclick = onRecipeClose;
    document.getElementById("amPrev").onclick = () => stepMove(-1);
    document.getElementById("amNextOrTimer").onclick = onNextOrTimer;
    document.getElementById("amFinishPostre").onclick = () => finalizePostreFromOverlay();
    document.getElementById("amFinishLote").onclick = () => finalizeLoteFromOverlay();
  }

  function toast(msg){
    const el = document.getElementById("amaredToast");
    if(!el) return;
    el.textContent = msg;
    el.style.display = "inline-flex";
    clearTimeout(el.__t);
    el.__t = setTimeout(() => { el.style.display = "none"; }, 2200);
  }

  function openRecipe(productId, orderIds, units){
    ensureRecipeOverlay();
    const overlay = document.getElementById("amaredRecipeOverlay");
    overlay.style.display = "flex";
    overlay.setAttribute("aria-hidden","false");

    state.recipe.open = true;
    state.recipe.productId = productId;
    state.recipe.orderIds = orderIds || [];
    state.recipe.units = Number(units || 0);
    state.recipe.stepIdx = 0;
    state.recipe.timerStarted = false;
    state.recipe.startedAtIso = new Date().toISOString();

    renderRecipeStep();
  }

  function closeRecipe(){
    const overlay = document.getElementById("amaredRecipeOverlay");
    if(overlay){
      overlay.style.display = "none";
      overlay.setAttribute("aria-hidden","true");
    }
    state.recipe.open = false;
    state.recipe.productId = null;
    state.recipe.orderIds = [];
    state.recipe.units = 0;
    state.recipe.stepIdx = 0;
    state.recipe.timerStarted = false;
    state.recipe.startedAtIso = null;
  }

  function stepMove(delta){
    const pid = state.recipe.productId;
    if(!pid) return;

    const steps = RECIPE_UNIT[pid]?.steps || [];
    const next = Math.max(0, Math.min(steps.length - 1, state.recipe.stepIdx + delta));
    state.recipe.stepIdx = next;

    state.recipe.timerStarted = false;
    renderRecipeStep();
  }

  function onNextOrTimer(){
    const pid = state.recipe.productId;
    if(!pid) return;

    const steps = RECIPE_UNIT[pid]?.steps || [];
    const st = steps[state.recipe.stepIdx] || null;

    if(st?.type === "timer_base"){
      if(!state.recipe.timerStarted){
        startBaseTimer(pid);
        state.recipe.timerStarted = true;
        toast("⏱️ Temporizador iniciado. Ya puedes continuar.");
        renderRecipeStep();
        return;
      }
    }

    stepMove(1);
  }

  function renderRecipeStep(){
    const pid = state.recipe.productId;
    if(!pid) return;

    const prod = PRODUCTS.find(p => p.id === pid);
    const steps = RECIPE_UNIT[pid]?.steps || [];
    const st = steps[state.recipe.stepIdx] || null;

    const title = document.getElementById("amRecipeTitle");
    const sub = document.getElementById("amRecipeSub");
    const counter = document.getElementById("amStepCounter");
    const text = document.getElementById("amStepText");
    const hint = document.getElementById("amStepHint");
    const img = document.getElementById("amStepImg");
    const imgFallback = document.getElementById("amImgFallback");
    const btn = document.getElementById("amNextOrTimer");
    const finalActions = document.getElementById("amFinalActions");

    title.textContent = `Receta · ${prod ? prod.name : pid}`;
    sub.textContent = `Lote: ${state.recipe.units} unidades · Operador: ${state.session.operatorLabel || "—"}`;

    counter.textContent = `Paso ${state.recipe.stepIdx + 1} / ${steps.length}`;

    const prog = document.getElementById("amProgBar");
    if(prog){
      const pct = Math.round(((state.recipe.stepIdx + 1) / Math.max(1, steps.length)) * 100);
      prog.style.width = pct + "%";
    }

    if(finalActions){
      finalActions.style.display = (st?.type === "final") ? "block" : "none";
    }

    renderInlineTimer(pid);

    if(st && st.type === "batch_ingredients"){
      const { lines, totalCost } = calcBatchIngredients(pid, state.recipe.units);
      const costText = totalCost > 0 ? `$${money(totalCost)}` : "—";

      text.textContent = "Ingredientes totales del lote";
      hint.innerHTML = `
        <div class="pill" style="margin:10px 0;">Costo estimado: ${costText}</div>
        ${(lines||[]).map(li => `
          <div class="line">
            <span>${escapeHtml(li.key)}</span>
            <div>
              ${fmtQty(li.qty)}
              ${li.pricePerUnit ? `<span class="muted small" style="margin-left:8px;">($${money(li.pricePerUnit)}/u)</span>` : `<span class="muted small" style="margin-left:8px;">(sin costo)</span>`}
            </div>
          </div>
        `).join("")}
      `;

      setRecipeImage("", img, imgFallback);
      btn.style.display = "inline-flex";
      btn.disabled = false;
      btn.textContent = "Siguiente →";
      return;
    }

    text.textContent = st?.text || "";

    if(st?.type === "timer_base"){
      if(!state.recipe.timerStarted){
        btn.textContent = "Iniciar temporizador";
        btn.disabled = false;
      }else{
        btn.textContent = "Siguiente →";
        btn.disabled = false;
      }
      hint.textContent = "Este paso exige temporizador. Inícialo para poder continuar.";
    } else if(st?.type === "final"){
      btn.textContent = "Siguiente →";
      btn.disabled = true;
      hint.textContent = "Finaliza el postre o el lote con los botones de la derecha.";
    } else {
      btn.textContent = "Siguiente →";
      btn.disabled = false;
      hint.textContent = "";
    }

    setRecipeImage(st?.img || HERO_IMG[pid] || "", img, imgFallback);
  }

  function setRecipeImage(src, imgEl, fallbackEl){
    if(!imgEl) return;
    imgEl.onerror = () => {
      imgEl.style.display = "none";
      if(fallbackEl) fallbackEl.style.display = "block";
      imgEl.src = "";
    };
    if(src){
      imgEl.src = src;
      imgEl.style.display = "block";
      if(fallbackEl) fallbackEl.style.display = "none";
    }else{
      imgEl.style.display = "none";
      if(fallbackEl) fallbackEl.style.display = "block";
      imgEl.src = "";
    }
  }

  // =========================
  // Timer + global widget
  // =========================
  function msToMMSS(ms){
    const s = Math.max(0, Math.floor(ms / 1000));
    const mm = String(Math.floor(s / 60)).padStart(2,"0");
    const ss = String(s % 60).padStart(2,"0");
    return `${mm}:${ss}`;
  }

  function startBaseTimer(productId){
    const existing = getTimerEnd(state.todayKey, productId);
    const now = Date.now();
    if(existing && existing > now){
      toast("⏱️ Ya hay un temporizador activo para este postre.");
      startWidgetTicker();
      return;
    }

    const end = Date.now() + BASE_FRIDGE_MINUTES * 60 * 1000;
    setTimerEnd(state.todayKey, productId, end);
    state.lastTimerProductId = productId;
    toast(`⏱️ Temporizador iniciado: ${BASE_FRIDGE_MINUTES} min`);

    startWidgetTicker();
  }

  function renderInlineTimer(productId){
    const pill = document.getElementById("amTimerInline");
    const txt = document.getElementById("amTimerTxt");
    if(!pill || !txt) return;

    const end = getTimerEnd(state.todayKey, productId);
    const now = Date.now();

    if(end && end > now){
      pill.style.display = "inline-flex";
      txt.textContent = msToMMSS(end - now);
    }else{
      pill.style.display = "none";
      txt.textContent = "";
    }
  }

  function startWidgetTicker(){
    const widget = document.getElementById("amStickyTimer");
    const label = document.getElementById("amStickyLabel");
    const time = document.getElementById("amStickyTime");
    if(!widget || !label || !time) return;

    if(state.widgetTick) return;

    state.widgetTick = setInterval(() => {
      const now = Date.now();
      const m = getTimersMap();
      const day = m?.[state.todayKey] || {};
      const entries = Object.entries(day)
        .map(([pid, end]) => ({ pid, end: Number(end||0) }))
        .filter(x => x.end > now)
        .sort((a,b) => a.end - b.end);

      if(entries.length === 0){
        widget.style.display = "none";
        clearInterval(state.widgetTick);
        state.widgetTick = null;
        return;
      }

      const top = entries[0];
      const prod = PRODUCTS.find(p => p.id === top.pid);
      label.textContent = prod ? prod.name : "Temporizador";
      time.textContent = msToMMSS(top.end - now);
      widget.style.display = "block";

      if(state.recipe.open && state.recipe.productId){
        renderInlineTimer(state.recipe.productId);
      }
    }, 250);
  }

  // =========================
  // Close behavior (revert if not finalized)
  // =========================
  async function onRecipeClose(){
    const pid = state.recipe.productId;
    const ids = (state.recipe.orderIds || []).slice();

    if(!pid || ids.length === 0){
      closeRecipe();
      return;
    }

    if(isProductDone(state.todayKey, pid)){
      closeRecipe();
      return;
    }

    const ok = await confirmWithDelay({
      title: "Salir del paso a paso",
      message: "Esto revertirá el estado para que no aparezca como iniciado. ¿Deseas salir?",
      seconds: 2,
      okText: "Salir y revertir"
    });

    if(!ok) return;

    showLoading("Revirtiendo…", "Sincronizando estado.");
    try{
      await kitchenBulkUpdate(ids, { kitchen_status: "" });
      await logLotEvent("cancel_step_by_step", { product_id: pid });
      await refresh();
      closeRecipe();
      toast("Revertido: no iniciado.");
    } catch(e){
      alert(e?.message || String(e));
    } finally {
      hideLoading();
    }
  }

  // =========================
  // Start flow
  // =========================
  async function startRecipeFlow(productId, baseOrders){
    const orders = baseOrders || [];
    const agg = aggregateByProduct(orders);
    const units = agg.byProduct.get(productId) || 0;
    const orderIds = getOrderIdsThatContainProduct(orders, productId);

    if(orderIds.length === 0){ toast("No hay pedidos para este producto."); return; }

    showLoading("Iniciando…", "Marcando pedidos en proceso…");
    try{
      await kitchenBulkUpdate(orderIds, { kitchen_status:"En proceso" });
      await logLotEvent("start_product", { product_id: productId, units });
      await refresh();
      openRecipe(productId, orderIds, units);
    } catch(e){
      alert(e?.message || String(e));
    } finally {
      hideLoading();
    }
  }

  // =========================
  // Finalizar postre (UI local) / Finalizar lote (DB)
  // =========================
  async function finalizePostre(productId, baseOrders){
    const orders = baseOrders || [];
    const ids = getOrderIdsThatContainProduct(orders, productId);
    if(ids.length === 0){ toast("No hay pedidos para este producto."); return; }

    const ok = await confirmWithDelay({
      title: "Finalizar postre",
      message: "Esto marcará este postre como HECHO en la vista. (El lote se finaliza al final).",
      seconds: 2,
      okText: "Finalizar postre"
    });
    if(!ok) return;

    markProductDone(state.todayKey, productId, true);
    clearTimer(state.todayKey, productId);
    await logLotEvent("finish_product", { product_id: productId });
    toast("✅ Postre marcado como hecho.");
    renderAll();
    renderFinalizeLotButton();
  }

  async function finalizePostreFromOverlay(){
    const pid = state.recipe.productId;
    if(!pid) return;

    const ok = await confirmWithDelay({
      title: "Finalizar postre",
      message: "Marcarás este postre como HECHO en la vista. (El lote se finaliza al final).",
      seconds: 2,
      okText: "Finalizar postre"
    });
    if(!ok) return;

    markProductDone(state.todayKey, pid, true);
    clearTimer(state.todayKey, pid);
    await logLotEvent("finish_product", { product_id: pid });

    toast("✅ Postre marcado como hecho.");
    closeRecipe();
    renderAll();
    renderFinalizeLotButton();
  }

  function allProductsDoneForToday(){
    const todayOrdersAll = state.paidOrders.filter(o => o.__prod_day === state.todayKey);
    const agg = aggregateByProduct(todayOrdersAll);
    const needed = PRODUCTS.map(p => p.id).filter(pid => (agg.byProduct.get(pid) || 0) > 0);
    if(needed.length === 0) return false;
    return needed.every(pid => isProductDone(state.todayKey, pid));
  }

  function getTodayOrderIds(){
    const todayAll = state.paidOrders.filter(o => o.__prod_day === state.todayKey);
    return todayAll.map(o => String(o.order_id));
  }

  function renderFinalizeLotButton(){
    const existing = document.getElementById("amFinalizeLot");
    if(existing) existing.remove();

    if(!allProductsDoneForToday()) return;

    const btn = document.createElement("button");
    btn.id = "amFinalizeLot";
    btn.className = "btn primary";
    btn.type = "button";
    btn.textContent = "✅ Finalizar lote";
    btn.style.position = "fixed";
    btn.style.right = "18px";
    btn.style.bottom = "18px";
    btn.style.zIndex = "99998";
    btn.style.boxShadow = "var(--shadow)";

    btn.onclick = async () => {
      await finalizeLote();
    };

    document.body.appendChild(btn);
  }

  async function finalizeLoteFromOverlay(){
    await finalizeLote();
  }

  async function finalizeLote(){
    const ids = getTodayOrderIds();
    if(ids.length === 0){ toast("No hay pedidos para finalizar."); return; }

    const ok = await confirmWithDelay({
      title: "Finalizar lote",
      message: "Esto actualizará la base de datos y pasará los pedidos de En proceso a Listo.",
      seconds: 2,
      okText: "Finalizar lote"
    });
    if(!ok) return;

    showLoading("Finalizando lote…", "Actualizando base de datos.");
    try{
      await kitchenBulkUpdate(ids, { kitchen_status:"Listo" });
      await logLotEvent("finish_lot", { day_key: state.todayKey });
      toast("✅ Lote finalizado. Base de datos actualizada.");
      closeRecipe();
      await refresh();
    } catch(e){
      alert(e?.message || String(e));
    } finally {
      hideLoading();
    }
  }

  // =========================
  // Costs modal (read-only)
  // =========================
  function ensureCostsButton(){
    if(document.getElementById("btnCostsRO")) return;
    const headerBtns = btnRefresh?.parentElement;
    if(!headerBtns) return;

    const btn = document.createElement("button");
    btn.id = "btnCostsRO";
    btn.className = "btn secondary";
    btn.type = "button";
    btn.textContent = "Costos";
    btn.style.display = "none";
    btn.onclick = openCostsModal;

    headerBtns.insertBefore(btn, btnRefresh);
    if(btnCloseCosts) btnCloseCosts.onclick = closeCostsModal;
  }
  function openCostsModal(){
    if(!costsModal) return;
    costsGateErr.textContent = "";
    costsModal.style.display = "flex";
    costsModal.setAttribute("aria-hidden","false");
    renderCostsReadOnly();
  }
  function closeCostsModal(){
    if(!costsModal) return;
    costsModal.style.display = "none";
    costsModal.setAttribute("aria-hidden","true");
  }
  function renderCostsReadOnly(){
    if(!costsEditor) return;

    const keys = Object.keys(state.pricesMap || {}).sort((a,b)=>a.localeCompare(b,"es"));
    const list = keys.map(k => ({ k, v: Number(state.pricesMap[k]||0) }))
      .sort((a,b)=> (b.v-a.v) || a.k.localeCompare(b.k,"es"));

    const htmlList = list.map(it => `
      <div class="line">
        <span>${escapeHtml(it.k)}</span>
        <div>$${money(it.v)}</div>
      </div>
    `).join("");

    const meta = state.costsLastUpdated
      ? `<div class="muted small" style="margin-bottom:10px;">Última actualización: ${escapeHtml(state.costsLastUpdated)}</div>`
      : `<div class="muted small" style="margin-bottom:10px;">Costos en modo solo lectura.</div>`;

    costsEditor.innerHTML = meta + `
      <div class="pCard open">
        <div class="rowBetween">
          <div style="font-weight:950;">Costos por unidad</div>
          <div class="pill">${keys.length} items</div>
        </div>
        <div class="accBody" style="margin-top:10px; max-height:55vh; overflow:auto;">
          ${htmlList || `<div class="muted small">Sin datos.</div>`}
        </div>
      </div>
    `;
  }

  // =========================
  // Refresh
  // =========================
  async function refresh(){
    const myNonce = state.refreshNonce;
    try{
      await loadData(myNonce);
      if(myNonce !== state.refreshNonce) return;
      renderAll();
    } finally {
      hideLoading();
    }
  }

  // =========================
  // Login / Logout
  // =========================
  async function onLogin(){
    loginErr.textContent = "";

    const selectedId = selOperator.value;
    const pin = String(inpPin.value || "").trim();

    if(!selectedId || !pin){
      loginErr.textContent = "Selecciona un perfil e ingresa el PIN.";
      return;
    }

    showLoading("Validando…", "Verificando acceso…");
    try{
      await validatePinBestEffort(pin);

      const labelFallback = (state.profiles.find(p => p.id === selectedId)?.label) || selectedId;
      state.session = { operatorId: selectedId, operatorLabel: labelFallback, pin };
      saveSession();

      showApp();
      ensureCostsButton();

      state.profiles = await fetchKitchenProfiles();
      renderProfilesSelect(state.session.operatorId);

      const realLabel = state.profiles.find(p => p.id === state.session.operatorId)?.label;
      if(realLabel){
        state.session.operatorLabel = realLabel;
        saveSession();
      }

      const c = await fetchCostsPublic();
      state.pricesMap = c.map || {};
      state.costsLastUpdated = c.lastUpdated || null;

      const btnCostsRO = document.getElementById("btnCostsRO");
      if(btnCostsRO) btnCostsRO.style.display = "inline-flex";

      await refresh();
      startWidgetTicker();

    } catch(e){
      clearSession();
      showLogin();
      loginErr.textContent = "PIN inválido o no autorizado.";
    } finally {
      hideLoading();
    }
  }

  function onLogout(){
    state.refreshNonce++;
    clearSession();
    closeRecipe();
    closeCostsModal();

    if(loginErr) loginErr.textContent = "";
    if(inpPin) inpPin.value = "";
    if(selOperator) selOperator.value = "";

    showLogin();

    const btnCostsRO = document.getElementById("btnCostsRO");
    if(btnCostsRO) btnCostsRO.style.display = "none";
  }

  // =========================
  // Init
  // =========================
  async function init(){
    ensureRecipeOverlay();
    ensureConfirmOverlay();
    ensureCostsButton();

    state.profiles = DEFAULT_PROFILES.slice();
    renderProfilesSelect();
    showLogin();

    if(loadSession()){
      renderProfilesSelect(state.session.operatorId);
      inpPin.value = state.session.pin || "";

      showApp();
      const btnCostsRO = document.getElementById("btnCostsRO");
      if(btnCostsRO) btnCostsRO.style.display = "inline-flex";

      try{
        state.profiles = await fetchKitchenProfiles();
        renderProfilesSelect(state.session.operatorId);

        const realLabel = state.profiles.find(p => p.id === state.session.operatorId)?.label;
        if(realLabel){
          state.session.operatorLabel = realLabel;
          saveSession();
        }

        const c = await fetchCostsPublic();
        state.pricesMap = c.map || {};
        state.costsLastUpdated = c.lastUpdated || null;

        await refresh();
        startWidgetTicker();
      } catch(_e){
        onLogout();
      }
    }

    if(btnLogin) btnLogin.onclick = onLogin;
    if(btnRefresh) btnRefresh.onclick = () => refresh().catch(e => alert(e?.message || String(e)));
    if(btnLogout) btnLogout.onclick = onLogout;

    if(inpPin){
      inpPin.addEventListener("keydown", (e) => { if(e.key === "Enter") onLogin(); });
    }
    if(btnCloseCosts) btnCloseCosts.onclick = closeCostsModal;
  }

  init().catch(err => {
    console.error(err);
    alert("Error inicializando cocina: " + (err?.message || String(err)));
  });

})();
