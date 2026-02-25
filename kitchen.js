

  // Safe JSON parse (returns fallback on error)
  function safeJsonParse(v, fallback){
    try{
      if(v == null) return fallback;
      if(typeof v === "object") return v;
      const s = String(v).trim();
      if(!s) return fallback;
      return JSON.parse(s);
    }catch(_e){
      return fallback;
    }
  }


  // Items parser (works with Apps Script rows: items_json + items text)
  function normalizeItemsFromAnyOrder(order){
    if(!order) return [];
    // 1) prefer items_json
    const raw = order.items_json ?? order.itemsJson ?? order.itemsJSON;
    if(raw){
      const parsed = (typeof raw === "string") ? safeJsonParse(raw) : raw;
      if(Array.isArray(parsed)){
        return parsed.map(it=>({
          id: String(it.id || it.product_id || ""),
          name: String(it.name || ""),
          qty: Number(it.qty || it.units || 0) || 0,
          unit_price: Number(it.unit_price ?? it.price ?? 0) || 0,
        })).filter(it=>it.id && it.qty>0);
      }
    }

    // 2) fallback: items text like "- Nombre: 2"
    const txt = String(order.items || "").trim();
    if(txt){
      const lines = txt.split("\n").map(s=>s.trim()).filter(Boolean);
      const out = [];
      for(const line0 of lines){
        const line = line0.replace(/^-+\s*/, "");
        const m = line.match(/^(.+?)\s*:\s*(\d+(?:[\.,]\d+)?)$/);
        if(!m) continue;
        const name = m[1].trim();
        const qty = Number(String(m[2]).replace(",",".")) || 0;
        if(!(qty>0)) continue;
        // try map name -> product id
        const p = PRODUCTS.find(x => String(x.name||"").toLowerCase() === name.toLowerCase());
        out.push({ id: p?.id || name.toLowerCase().replace(/\s+/g,"_"), name, qty, unit_price: Number(p?.unit_price||0) });
      }
      return out;
    }
    return [];
  }
/* kitchen.js (REFactor V6) — AMARED Cocina
   Objetivos V6 (según tu último mensaje):
   1) Perfiles se cargan al iniciar la página (SIN pedir PIN) ✅ pero requiere que el Worker exponga un action público.
      - Este JS primero intenta: action:"profiles_public_list" (recomendado, seguro, sin exponer secretos en frontend)
      - Si no existe, mostrará un mensaje indicando que falta habilitarlo en el Worker.
   2) Temporizador más bonito: widget flotante mejorado (pill + barra) ✅
   3) Finalizar postre mueve ese postre al bloque "Finalizados" (local) y lo oculta de arriba ✅
      - "Finalizar lote" SOLO aparece cuando es el ÚLTIMO postre pendiente ✅
   4) Cards de postres como "cuadraditos" clicables con acordeón abrir/cerrar ✅
   5) Costos: usar hoja Costos_Ingredientes (read-only) desde botón Costos ✅
      - Este JS intenta: action:"costs_public_list" (recomendado, seguro)
   6) Responsive móvil: botones top se vuelven pequeños (icon-only) ✅ con CSS inyectado
   Importante: NO se toca Apps Script aquí. Para que perfiles/costos carguen sin PIN/secret en frontend,
   debes agregar 2 acciones públicas en el Worker (te dejo el patch al final del mensaje).
*/
(() => {
  "use strict";

  // ========= CONFIG =========
  const API_URL = "https://amared-orders.amaredpostres.workers.dev/";
  const TZ = "America/Bogota";
  const CUTOFF_HOUR = 15;
  const BASE_FRIDGE_MINUTES = 30;

  const SS_KEY = "AMARED_KITCHEN_SESSION_V6";
  const LS_TIMER_KEY = "AMARED_KITCHEN_TIMERS_V1";
  const LS_DONE_KEY  = "AMARED_KITCHEN_DONE_V1";

  // ========= PRODUCTOS =========
  const PRODUCTS = [
    { id: "mousse_maracuya", name: "Mousse de Maracuyá" },
    { id: "cheesecake_cafe_panela", name: "Cheesecake de café con panela" },
    { id: "arroz_con_leche", name: "Arroz con leche" },
  ];

  // ========= RECETAS (unitarias) =========
  // Puedes sobreescribir desde otro archivo definiendo window.AMARED_RECIPES antes de kitchen.js
  const RECIPE_UNIT = window.AMARED_RECIPES || {};
  if(!RECIPE_UNIT.mousse_maracuya){
    RECIPE_UNIT.mousse_maracuya = {
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
        { type:"normal", text:"Sirve la mezcla en los vasitos sobre la base (150 ml por vasito).", img:"assets/steps/mousse/step09.webp" },
        { type:"normal", text:"Refrigera mínimo 8 horas o toda la noche.", img:"assets/steps/mousse/step10.webp" },
        { type:"normal", text:"Agregar chocorramo (20 g por postre).", img:"assets/steps/mousse/step11.webp" },
        { type:"normal", text:"¡Listo! Verifica presentación y limpieza del área.", img:"assets/steps/mousse/step13.webp" },
        { type:"final", text:"Espolvorea chocolate con la forma del logo.", img:"assets/steps/mousse/step12.webp" },
      ],
    };
  }
  if(!RECIPE_UNIT.cheesecake_cafe_panela){
        RECIPE_UNIT.cheesecake_cafe_panela = {
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
        { type:"batch_ingredients" }, // Paso 1 (sin imagen)
        { type:"normal", text:"Tritura galletas (textura arenosa).", img:"assets/steps/cheesecake/step01.webp" }, // Paso 2
        { type:"normal", text:"Mezcla galleta + mantequilla derretida.", img:"assets/steps/cheesecake/step02.webp" }, // Paso 3
        { type:"normal", text:"Porciona y compacta 25 g de base en cada vasito.", img:"assets/steps/cheesecake/step03.webp" }, // Paso 4
        { type:"timer_base", text:"Ingresa los vasitos con la base a la nevera (30 min). Debes iniciar el temporizador para continuar.", img:"assets/steps/cheesecake/step04.webp" }, // Paso 5
        { type:"normal", text:"Mezcla queso crema + crema + leche condensada + vainilla hasta homogéneo.", img:"assets/steps/cheesecake/step05.webp" }, // Paso 6
        { type:"normal", text:"En olla: calienta agua tibia (sin hervir).", img:"assets/steps/cheesecake/step06.webp" }, // Paso 7
        { type:"normal", text:"Agrega gelatina y revuelve hasta disolver homogéneo.", img:"assets/steps/cheesecake/step07.webp" }, // Paso 8
        { type:"normal", text:"Integra la gelatina disuelta lentamente mientras mezclas.", img:"assets/steps/cheesecake/step08.webp" }, // Paso 9
        { type:"normal", text:"Agrega la mezcla sobre la base (150 ml por vasito).", img:"assets/steps/cheesecake/step09.webp" }, // Paso 10 (nuevo)
        { type:"normal", text:"Refrigera mínimo 8 horas o toda la noche.", img:"assets/steps/cheesecake/step10.webp" }, // Paso 11
        { type:"final", text:"Decora espolvoreando harina de galleta de leche con la forma del logo.", img:"assets/steps/cheesecake/step11.webp" }, // Paso 12
      ],
    };
  }
  if(!RECIPE_UNIT.arroz_con_leche){
    RECIPE_UNIT.arroz_con_leche = { unitIngredients: [], steps: [{ type:"batch_ingredients" }, { type:"final", text:"Receta no activa." }] };
  }

  // ========= HELPERS =========
  const $ = (id) => document.getElementById(id);
  const safeJsonParse = (s)=>{ try{return JSON.parse(s);}catch{return null;} };
  const escapeHtml = (s)=> String(s??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
  const money = (n)=> Math.round(Number(n||0)).toLocaleString("es-CO");
  const fmtQty = (q)=> (Math.round(Number(q||0)*10)/10).toLocaleString("es-CO");
  const sleep = (ms)=> new Promise(r=>setTimeout(r,ms));

  // ========= DOM (debe existir en kitchen.html) =========
  const loginBox = $("loginBox");
  const app = $("app");

  const selOperator = $("selOperator");
  const inpPin = $("inpPin");
  const btnLogin = $("btnLogin");
  const loginErr = $("loginErr");

  const btnLogout = $("btnLogout");
  const btnRefresh = $("btnRefresh");
  let btnShopping = $("btnShopping"); // se crea si no existe
  let btnCosts = $("btnCosts"); // si no existe, se crea

  const todayWrap = $("todayWrap");
  const tomorrowWrap = $("tomorrowWrap");
  const inProgressWrap = $("inProgressWrap");
  const doneWrap = $("doneWrap");

  const loading = $("loading");
  const loadingTitle = $("loadingTitle");
  const loadingMsg = $("loadingMsg");

  const costsModal = $("costsModal");
  const btnCloseCosts = $("btnCloseCosts");
  const costsEditor = $("costsEditor");
  const costsGateErr = $("costsGateErr");

  // ========= STATE =========
  const state = {
    session: { operatorId:null, operatorLabel:null, pin:null },
    profiles: null,
    activeOverlay: null, // { pid, orderIds, units }
    profilesLoaded: false,
    pricesMap: {},
    costsLoaded: false,
    costsLastUpdated: null,
    paidOrders: [],
    todayKey: null,
    nextKey: null,
    buckets: { today: [], infoTomorrow: [], inProgress: [], doneDb: [] },
    recipe: { open:false, productId:null, orderIds:[], units:0, stepIdx:0, timerStarted:false },
    refreshNonce: 0,
    widgetTick: null,
  };


  function getSessionPin(){
    // Fuente única para acciones protegidas por ADMIN_PIN
    if(state && state.session && state.session.pin) return String(state.session.pin);
    try{
      const raw = localStorage.getItem("amared_kitchen_session");
      if(raw){
        const s = JSON.parse(raw);
        if(s && s.pin) return String(s.pin);
      }
    }catch(_){}
    return "";
  }
  // ========= LOADING UI =========
  function showLoading(title,msg){
    if(!loading) return;
    loadingTitle.textContent = title || "Cargando…";
    loadingMsg.textContent = msg || "Procesando";
    // asegurar que el loader quede por encima de cualquier modal
    loading.style.position="fixed";
    loading.style.inset="0";
    loading.style.zIndex="999999";
    loading.style.display="flex";
    loading.setAttribute("aria-hidden","false");
  }
  function hideLoading(){
    if(!loading) return;
    loading.style.display="none";
    loading.setAttribute("aria-hidden","true");
  }

  // ========= API =========
  async function api(payload){
    const res = await fetch(API_URL,{
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify(payload||{})
    });
    const out = await res.json().catch(async()=>({ok:false,error: await res.text().catch(()=> "Error")}));
    if(!out || out.ok !== true) throw new Error(out?.error || "Error");
    return out;
  }

// Alias de compatibilidad (algunas funciones aún llaman apiPost)
const apiPost = (payload) => api(payload);

  async function apiTry(payload){
    try { return await api(payload); }
    catch(e){ return {ok:false,error:String(e?.message||e)}; }
  }

  // ========= TIME (Bogotá) =========
  function getBogotaParts(date){
    const fmt = new Intl.DateTimeFormat("en-CA",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false});
    const parts = fmt.formatToParts(date);
    const get = (t)=> parts.find(p=>p.type===t)?.value;
    return { hh:Number(get("hour")), key:`${get("year")}-${get("month")}-${get("day")}` };
  }

  // Devuelve fecha/hora legible en hora Colombia
  function formatBogotaDT(iso){
    try{
      const d = new Date(iso);
      if(Number.isNaN(d.getTime())) return String(iso||"");
      return new Intl.DateTimeFormat("es-CO",{
        timeZone: TZ,
        year:"numeric",month:"2-digit",day:"2-digit",
        hour:"2-digit",minute:"2-digit",
        hour12:true
      }).format(d);
    }catch(_e){
      return String(iso||"");
    }
  }

  function getWeekdayBogota(date){
    const wd = new Intl.DateTimeFormat("en-US",{timeZone:TZ,weekday:"short"}).format(date);
    const map={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6};
    return map[wd]??0;
  }
  function addDaysBogotaKey(key,days){
    const [Y,M,D]=key.split("-").map(Number);
    const dt=new Date(Date.UTC(Y,M-1,D,12,0,0));
    dt.setUTCDate(dt.getUTCDate()+days);
    return getBogotaParts(dt).key;
  }
  function computeProductionDayKeyForOrder(createdAt){
    const dt=new Date(createdAt);
    if(Number.isNaN(dt.getTime())) return null;
    const p=getBogotaParts(dt);
    const weekday=getWeekdayBogota(dt);
    const dayKey=p.key;
    if(weekday===6) return addDaysBogotaKey(dayKey,2);
    if(weekday===0) return addDaysBogotaKey(dayKey,1);
    if(weekday===5 && p.hh>=CUTOFF_HOUR) return addDaysBogotaKey(dayKey,3);
    if(p.hh>=CUTOFF_HOUR) return addDaysBogotaKey(dayKey,1);
    return dayKey;
  }
  function getTodayProductionDayKey(){
    const now=new Date();
    const p=getBogotaParts(now);
    const wd=getWeekdayBogota(now);
    if(wd===6) return addDaysBogotaKey(p.key,2);
    if(wd===0) return addDaysBogotaKey(p.key,1);
    return p.key;
  }
  function getNextProductionDayKey(todayKey){
    const [Y,M,D]=todayKey.split("-").map(Number);
    const dt=new Date(Date.UTC(Y,M-1,D,12,0,0));
    const wd=getWeekdayBogota(dt);
    if(wd===5) return addDaysBogotaKey(todayKey,3);
    if(wd===6) return addDaysBogotaKey(todayKey,2);
    if(wd===0) return addDaysBogotaKey(todayKey,1);
    return addDaysBogotaKey(todayKey,1);
  }

  // ========= ORDERS =========
  function normalizeItemsFromOrder(order){
    const raw=order?.items_json;
    const parsed = raw ? (typeof raw==="string"? safeJsonParse(raw):raw) : null;
    if(Array.isArray(parsed)){
      return parsed.map(it=>({id:String(it.id||""),name:String(it.name||""),qty:Number(it.qty||0)})).filter(it=>it.id && it.qty>0);
    }
    return [];
  }
  function aggregateByProduct(orders){
    const map=new Map();
    for(const o of (orders||[])){
      for(const it of normalizeItemsFromOrder(o)){
        map.set(it.id,(map.get(it.id)||0)+it.qty);
      }
    }
    return map;
  }
  function getOrderIdsThatContainProduct(orders,pid){
    const ids=[];
    for(const o of (orders||[])){
      if(normalizeItemsFromOrder(o).some(it=>it.id===pid && it.qty>0)) ids.push(String(o.order_id));
    }
    return ids;
  }

  // ========= DONE / TIMERS (LOCAL) =========
  const getDoneMap=()=>{ const r=localStorage.getItem(LS_DONE_KEY); const o=r?safeJsonParse(r):null; return (o&&typeof o==="object")?o:{}; };
  const setDoneMap=(o)=> localStorage.setItem(LS_DONE_KEY, JSON.stringify(o||{}));
  const isProductDone=(day,pid)=> !!(getDoneMap()?.[day]?.[pid]);
  function markProductDone(day,pid,val){
    const m=getDoneMap(); if(!m[day]) m[day]={}; m[day][pid]=!!val; setDoneMap(m);
  }

  const getTimersMap=()=>{ const r=localStorage.getItem(LS_TIMER_KEY); const o=r?safeJsonParse(r):null; return (o&&typeof o==="object")?o:{}; };
  const setTimersMap=(o)=> localStorage.setItem(LS_TIMER_KEY, JSON.stringify(o||{}));
  const setTimerEnd=(day,pid,end)=>{ const m=getTimersMap(); if(!m[day]) m[day]={}; m[day][pid]=Number(end||0); setTimersMap(m); };
  const getTimerEnd=(day,pid)=> Number(getTimersMap()?.[day]?.[pid]||0);
  const clearTimer=(day,pid)=>{ const m=getTimersMap(); if(m?.[day]){ delete m[day][pid]; setTimersMap(m); } };

  // ========= COSTOS (normalización) =========
  const stripAccents=(s)=> String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  const normalizeKey1=(s)=> String(s||"").replace(/\([^\)]*\)/g,"").replace(/\s{2,}/g," ").trim();
  function normalizeKey2(s){
    const base=stripAccents(normalizeKey1(s)).toLowerCase();
    const cleaned=base.replace(/[^a-z0-9\s]/g," ").replace(/\s{2,}/g," ").trim();
    const stop=new Set(["de","del","la","el","sin","con","para","y","opcional","logo","decorativo","topping","harina"]);
    return cleaned.split(" ").filter(t=>t && !stop.has(t)).join(" ");
  }
  function priceLookup(recipeKey){
    const k2=normalizeKey2(recipeKey);
    if(state.pricesMap[k2]!=null) return Number(state.pricesMap[k2]||0);
    const keys=Object.keys(state.pricesMap||{});
    const hit=keys.find(k=>k && (k.includes(k2)||k2.includes(k)));
    return hit? Number(state.pricesMap[hit]||0):0;
  }

  // ========= AUTH/UI =========
  function showLogin(){
    if(loginBox) loginBox.style.display="block";
    if(app) app.style.display="none";
    if(btnLogout) btnLogout.style.display="none";
    if(btnRefresh) btnRefresh.style.display="none";
    if(btnShopping) btnShopping.style.display="none";
    if(btnCosts) btnCosts.style.display="none";
    if(btnHistory) btnHistory.style.display="none";
  }
  function showApp(){
    if(loginBox) loginBox.style.display="none";
    if(app) app.style.display="block";
    if(btnLogout) btnLogout.style.display="inline-flex";
    if(btnRefresh) btnRefresh.style.display="inline-flex";
    if(btnShopping) btnShopping.style.display="none";
    if(btnCosts) btnCosts.style.display="inline-flex";
    if(btnHistory) btnHistory.style.display="inline-flex";
  }
  function saveSession(){ sessionStorage.setItem(SS_KEY, JSON.stringify(state.session)); }
  function loadSession(){
    const raw=sessionStorage.getItem(SS_KEY);
    const s=raw? safeJsonParse(raw):null;
    if(s?.operatorId && s?.operatorLabel && s?.pin){ state.session=s; return true; }
    return false;
  }
  function clearSession(){ sessionStorage.removeItem(SS_KEY); state.session={operatorId:null, operatorLabel:null, pin:null}; }

  async function validatePinBestEffort(pin){
    const out = await apiTry({action:"validate_admin_pin", admin_pin: pin});
    if(out.ok===true) return true;
    if(String(out.error||"").toLowerCase().includes("unknown action")) return true;
    throw new Error("PIN inválido o no autorizado.");
  }

  // ========= WORKER PUBLIC ACTIONS (requeridas) =========
  async function fetchProfilesPublic(){
    // Recomendado: Worker inyecta PROFILES_SECRET y consulta Apps Script.
    const out = await apiTry({action:"profiles_public_list", category:"kitchen"});
    if(out.ok!==true) throw new Error(out.error||"Falta habilitar profiles_public_list en el Worker.");
    const arr = out.profiles || out.items || [];
    const list = (Array.isArray(arr)?arr:[])
      .filter(p=>p && (p.id||p.profile_id) && p.label && (p.is_active===undefined || String(p.is_active)!=="false"))
      .map(p=>({id:String(p.id||p.profile_id), label:String(p.label)}));
    if(list.length===0) throw new Error("No hay perfiles activos en categoría cocina.");
    return list;
  }
  async function fetchCostsPublic(){
    // Recomendado: Worker inyecta COSTS_SECRET y lee Costos_Ingredientes vía Apps Script.
    const out = await apiTry({action:"costs_public_list"}); // hoja Costos_Ingredientes
    if(out.ok!==true) throw new Error(out.error||"Falta habilitar costs_public_list en el Worker.");
    const items = out.items || out.costs || [];
    const map={}; let last=null;
    for(const r of (Array.isArray(items)?items:[])){
      const k = r.ingredient_key || r.key || r.ingredient || "";
      if(!k) continue;
      map[normalizeKey2(k)] = Number(r.cop_per_unit ?? r.copPerUnit ?? r.value ?? 0) || 0;
      const u = r.updated_at || r.updatedAt || null;
      if(u && (!last || String(u)>String(last))) last=u;
    }
    state.pricesMap=map;
    state.costsLastUpdated=last;
    state.costsLoaded=true;
  }

  // ========= RECETA / COSTOS LOTE =========
  function calcBatchIngredients(pid, units){
    const recipe=RECIPE_UNIT[pid];
    if(!recipe) return {lines:[], totalCost:0};
    let totalCost=0;
    const lines=(recipe.unitIngredients||[]).map(ing=>{
      const qty=Number(ing.qty||0)*Number(units||0);
      const ppu=priceLookup(ing.key);
      const cost=qty*ppu;
      totalCost+=cost;
      return {key:ing.key, qty, pricePerUnit: ppu, cost};
    });
    return {lines, totalCost};
  }

  // ========= DATA LOAD =========
  async function loadData(myNonce){
    if(!state.session.pin) throw new Error("Unauthorized admin");
    state.todayKey=getTodayProductionDayKey();
    state.nextKey=getNextProductionDayKey(state.todayKey);

    showLoading("Cargando cocina…","Obteniendo pedidos…");
    const outPaid = await api({action:"list_orders", payment_status:"Pagado", admin_pin: state.session.pin});
    // Cocina SOLO debe mostrar pedidos confirmados/pagados
    const out = { ok:true, orders: [...(outPaid.orders||[])] };
    if(myNonce!==state.refreshNonce) return;

    const merged=(out.orders||[]);
    const seen=new Set();
    const paid=merged.filter(o=>{ const id=String(o.order_id||""); if(!id||seen.has(id)) return false; seen.add(id); return true; })
      .map(o=>{ o.__prod_day=computeProductionDayKeyForOrder(o.created_at) || state.todayKey; return o; });
    state.paidOrders=paid;

    const todayAll = paid.filter(o=>o.__prod_day===state.todayKey);
    const normStatus = (v)=>String(v||"").trim().toLowerCase();
    const inProgDb = todayAll.filter(o=>normStatus(o.kitchen_status)==="en proceso");
    const doneDb = todayAll.filter(o=>normStatus(o.kitchen_status)==="listo");
    const pending = todayAll.filter(o=>{ const ks=normStatus(o.kitchen_status); return ks!=="en proceso" && ks!=="listo"; });

    // Informativo mañana (pedidos creados hoy >= 3pm)
    const lateToday = paid.filter(o=>{
      const d=new Date(o.created_at); if(Number.isNaN(d.getTime())) return false;
      const p=getBogotaParts(d); const wd=getWeekdayBogota(d);
      const nowKey=getBogotaParts(new Date()).key;
      if(p.key!==nowKey) return false;
      if(wd===6||wd===0) return false;
      return p.hh>=CUTOFF_HOUR;
    });

    state.buckets.today=pending;
    state.buckets.infoTomorrow=lateToday;
    state.buckets.inProgress=inProgDb;
    state.buckets.doneDb=doneDb;

    // Pendientes pagados de días anteriores (evita que se olviden)
    const backlog = paid.filter(o=>{
      const ks=normStatus(o.kitchen_status);
      if(ks==="en proceso" || ks==="listo") return false;
      return String(o.__prod_day||"") < String(state.todayKey||"");
    });
    state.buckets.backlog = backlog;
  }

  // ========= UI: estilos extras (cards + móvil + timer widget) =========
  function injectStylesV6(){
    if(document.getElementById("amStylesV6")) return;
    const st=document.createElement("style");
    st.id="amStylesV6";
    st.textContent=`
      /* Cards como "cuadraditos" */
      .amCard{
        background: rgba(255,255,255,.88);
        border: 1px solid rgba(64,17,2,.12);
        border-radius: 18px;
        padding: 14px;
        box-shadow: var(--shadow);
        margin-bottom: 12px;
      }
      .amHead{
        display:flex;
        justify-content:space-between;
        align-items:center;
        gap:12px;
        cursor:pointer;
        user-select:none;
      }
      .amName{
        font-weight: 950;
        font-size: 20px;
        line-height: 1.15;
      }
      .amQty{
        font-weight: 950;
        font-size: 34px;
        line-height: 1;
      }
      .amPill{
        display:inline-flex;
        align-items:center;
        gap:8px;
        padding: 8px 12px;
        border-radius: 999px;
        background: rgba(64,17,2,.06);
        border: 1px solid rgba(64,17,2,.10);
        font-weight: 900;
      }
      .amBody{
        display:none;
        margin-top: 12px;
      }
      .amCard.open .amBody{ display:block; }

      /* Ingredientes: layout más atractivo */
      .amIngRow{
        display:flex;
        justify-content:space-between;
        gap:12px;
        padding:10px 0;
        border-bottom:1px dashed rgba(64,17,2,.12);
      }
      .amIngRow:last-child{ border-bottom:none; }
      .amIngName{ font-weight:900; }
      .amIngRight{ text-align:right; min-width: 120px; }
      .amIngQty{ font-weight:900; }
      .amIngCost{
        margin-top:2px;
        font-size:12px;
        color: rgba(64,17,2,.55);
      }
      .amIngCost.hasCost{
        color: rgba(64,17,2,.78);
        font-weight:800;
      }


      /* Botón grande de acción */
      .amActionRow{ display:flex; justify-content:flex-end; margin-top: 12px; }
      .amActionRow .btn{ width: 100%; justify-content:center; }

      /* Timer widget bonito */
      .amStickyTimer{
        position:fixed;
        right: 16px;
        top: 78px;
        z-index: 99997;
        display:none;
        width: 220px;
      }
      .amStickyTimer .box{
        background: rgba(255,255,255,.92);
        border: 1px solid rgba(64,17,2,.14);
        border-radius: 18px;
        box-shadow: var(--shadow);
        padding: 12px;
        backdrop-filter: blur(8px);
      }
      .amStickyTimer .tTitle{ font-weight:950; font-size:13px; }
      .amStickyTimer .tTime{ font-weight:950; font-size:22px; margin-top:4px; }
      .amStickyTimer .bar{
        height: 8px; border-radius: 999px; overflow:hidden;
        background: rgba(64,17,2,.08);
        margin-top: 10px;
      }
      .amStickyTimer .bar > div{
        height:100%;
        width: 0%;
        background: rgba(245,110,150,.9);
        border-radius: 999px;
      }

      /* Móvil: botones de header icon-only */
      @media (max-width: 520px){
        .header-actions .btn{
          padding: 10px 10px;
          border-radius: 999px;
          min-width: 44px;
        }
        .header-actions .btn span.txt{ display:none !important; }
        .header-actions .btn span.ico{ display:inline !important; font-size: 18px; }
      }
    
      /* Historial modal */
      .histList{display:flex; flex-direction:column; gap:10px; margin-top:10px;}
      .histDay{background: rgba(255,255,255,.82); border:1px solid rgba(64,17,2,.12); border-radius:16px; padding:12px;}
      .histDay summary{cursor:pointer; font-weight:950; list-style:none; display:flex; align-items:center; justify-content:space-between; gap:10px;}
      .histDay summary::-webkit-details-marker{display:none;}
      .histRows{margin-top:10px; display:flex; flex-direction:column; gap:8px;}
      .histRow{display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px 12px; border-radius:14px; background: rgba(255,255,255,.75); border:1px solid rgba(64,17,2,.08);}
      .histRow .n{font-weight:950;}
      .histRow .q{font-weight:950; font-size:22px; line-height:1;}
      .histMeta{margin-top:8px; font-size:12px; opacity:.7;}
`;
    document.head.appendChild(st);
  }

  // ========= UI: perfiles =========
  

  // ===== Money formatter =====
  function fmtMoney(v){
    const n = Number(v || 0) || 0;
    try{
      return new Intl.NumberFormat("es-CO", {
        style: "currency",
        currency: "COP",
        maximumFractionDigits: 0
      }).format(n);
    }catch(e){
      return "$" + Math.round(n).toLocaleString("es-CO");
    }
  }
function renderProfilesSelect(list, selectedId){
    const arr=Array.isArray(list)?list:[];
    selOperator.innerHTML = `<option value="">Seleccionar…</option>` + arr.map(p=>`<option value="${escapeHtml(p.id)}">${escapeHtml(p.label)}</option>`).join("");
    if(selectedId) selOperator.value=selectedId;
  }

  async function loadProfilesOnStart(){
    state.profilesLoaded=false;
    renderProfilesSelect([], "");
    showLoading("Cargando perfiles…","Buscando perfiles de cocina.");
    loginErr.textContent="";
    try{
      const list = await fetchProfilesPublic();
      state.profiles = list;
      state.profilesLoaded = true;
      renderProfilesSelect(list, "");
      loginErr.textContent="";
    }catch(e){
      state.profilesLoaded=false;
      state.profiles=null;
      renderProfilesSelect([], "");
      loginErr.textContent = (e?.message || "No se pudieron cargar perfiles.")
        + " (Necesitas habilitar profiles_public_list en el Worker)";
    }finally{
      hideLoading();
    }
  }

  // ========= UI: acordeones postres =========
  function renderProductCards(container, orders, opts){
    if(!container) return;
    injectStylesV6();

    const { badgeText, showAction } = opts||{};
    const byProd = aggregateByProduct(orders);
    const todayKey = state.todayKey;

    // Decide qué mostrar en cada bloque: ocultar los hechos (local) arriba
    const cards=[];
    for(const p of PRODUCTS){
      const qty=byProd.get(p.id)||0;
      if(qty<=0) continue;

      const doneLocal = isProductDone(todayKey, p.id);
      if(showAction && doneLocal) continue; // ocultar arriba si ya finalizó postre

      cards.push(`
        <div class="amCard" data-pid="${escapeHtml(p.id)}" data-units="${qty}">
          <div class="amHead" role="button" tabindex="0" aria-expanded="false">
            <div style="min-width:0;">
              <div class="amName">${escapeHtml(p.name)}</div>
              <div class="muted small" style="margin-top:8px;">${escapeHtml(badgeText||"")}</div>
            </div>
            <div style="display:flex; flex-direction:column; align-items:flex-end; gap:10px;">
              <div class="amQty">${qty}</div>
              <div class="amPill">${doneLocal?"✅ Hecho":"Ver"} <span aria-hidden="true">▾</span></div>
            </div>
          </div>
          <div class="amBody" data-loaded="0"><div class="muted small">Cargando ingredientes…</div></div>
          ${showAction?`
            <div class="amActionRow">
              <button class="btn primary" type="button" data-act="start">Iniciar paso a paso</button>
            </div>`:""}
        </div>
      `);
    }

    if(cards.length===0){
      container.innerHTML=`<div class="muted small" style="padding:8px 0;">Sin datos.</div>`;
      return;
    }
    container.innerHTML=cards.join("");

    async function toggleCard(card){
      const head=card.querySelector(".amHead");
      const expanded=card.classList.toggle("open");
      if(head) head.setAttribute("aria-expanded", expanded?"true":"false");
      const body=card.querySelector(".amBody");
      if(expanded && body && body.getAttribute("data-loaded")!=="1"){
        body.setAttribute("data-loaded","1");
        const pid=card.getAttribute("data-pid");
        const units=Number(card.getAttribute("data-units")||0);
        const {lines,totalCost}=calcBatchIngredients(pid,units);
        const costText= totalCost>0?`$${money(totalCost)}`:"—";
        const unitCost = (units>0 && totalCost>0) ? (totalCost/units) : 0;
        const unitText = unitCost>0?`$${money(unitCost)}`:"—";
        const ingHtml=(lines||[]).map(li=>`
          <div class="line">
            <span>${escapeHtml(li.key)}</span>
            <div>
              ${fmtQty(li.qty)}
              ${li.pricePerUnit?`<span class="muted small" style="margin-left:8px;">($${money(li.pricePerUnit)}/u)</span>`:`<span class="muted small" style="margin-left:8px;">(sin costo)</span>`}
            </div>
          </div>`).join("");
        body.innerHTML=`
          <div class="rowBetween" style="margin-bottom:10px;">
            <div class="pill">Ingredientes (lote)</div>
            <div style="display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end;">
              <div class="pill">Unitario: ${unitText}</div>
              <div class="pill">Lote: ${costText}</div>
            </div>
          </div>
          ${ingHtml||`<div class="muted small">Sin receta configurada.</div>`}
        `;
      }
    }

    container.onclick=async(e)=>{
      const card=e.target.closest(".amCard"); if(!card) return;
      const btn=e.target.closest("button[data-act]");
      if(btn){
        if(btn.getAttribute("data-act")==="start"){
          const pid=card.getAttribute("data-pid");
          await startRecipeFlow(pid, orders);
        }
        return;
      }
      const head=e.target.closest(".amHead");
      if(head) await toggleCard(card);
    };

    container.addEventListener("keydown", async(e)=>{
      if(e.key!=="Enter" && e.key!==" ") return;
      const head=e.target.closest(".amHead"); if(!head) return;
      const card=head.closest(".amCard"); if(!card) return;
      e.preventDefault();
      await toggleCard(card);
    });
  }

  // ========= Confirm overlay 2s =========
  function ensureConfirmOverlay(){
    if(document.getElementById("amConfirmOverlay")) return;
    const el=document.createElement("div");
    el.innerHTML = `
      <div id="amConfirmOverlay" class="modalOverlay" style="display:none; position:fixed; inset:0; z-index: 999999;" aria-hidden="true">
        <div class="modalBox" style="max-width:520px; position:relative; z-index: 1000000;">
          <div style="font-weight:950; font-size:18px;" id="amConfTitle">Confirmar</div>
          <div class="muted small" id="amConfMsg" style="margin-top:8px;"></div>
          <div class="pill" id="amConfCountdown" style="margin-top:12px; display:inline-flex;">2</div>
          <div class="rowBetween" style="margin-top:14px;">
            <button id="amConfCancel" class="btn secondary" type="button">Cancelar</button>
            <button id="amConfOk" class="btn primary" type="button" disabled>Confirmar</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(el);
  }
  function confirmWithDelay({title,message,seconds=2,okText="Confirmar"}){
    ensureConfirmOverlay();
    const ov=$("amConfirmOverlay");
    const t=$("amConfTitle"); const m=$("amConfMsg"); const cd=$("amConfCountdown");
    const bCancel=$("amConfCancel"); const bOk=$("amConfOk");
    t.textContent=title||"Confirmar"; m.textContent=message||""; bOk.textContent=okText||"Confirmar";
    ov.style.display="flex"; ov.setAttribute("aria-hidden","false");
    let remaining=Math.max(0,Number(seconds||0));
    cd.textContent=String(remaining); bOk.disabled=true;
    let interval=null; let resolve;
    const p=new Promise(res=>resolve=res);
    const close=(val)=>{ if(interval) clearInterval(interval); ov.style.display="none"; ov.setAttribute("aria-hidden","true"); bCancel.onclick=null; bOk.onclick=null; resolve(val); };
    bCancel.onclick=()=>close(false);
    bOk.onclick=()=>close(true);
    interval=setInterval(()=>{
      remaining-=1; cd.textContent=String(Math.max(0,remaining));
      if(remaining<=0){ bOk.disabled=false; clearInterval(interval); interval=null; cd.textContent="Listo"; }
    },1000);
    return p;
  }

  // ========= Paso a paso + Timer widget =========
  function injectRecipeOverlay(){
    if(document.getElementById("amRecipeOverlayV6")) return;
    const wrap=document.createElement("div");
    wrap.innerHTML=`
      <div id="amRecipeOverlayV6" class="modalOverlay" aria-hidden="true" style="display:none;">
        <div class="modalBox" style="max-width:980px;">
          <div class="rowBetween">
            <div>
              <div style="font-weight:950; font-size:18px;" id="amRecipeTitle">Receta</div>
              <div class="muted small" id="amRecipeSub" style="margin-top:6px;"></div>
              <div style="height:8px; border-radius:999px; background:rgba(64,17,2,.08); overflow:hidden; margin-top:10px;">
                <div id="amProgBar" style="height:100%; width:0%; background:rgba(245,110,150,.9); border-radius:999px;"></div>
              </div>
            </div>
            <button id="amRecipeClose" class="btn secondary" type="button">Cerrar</button>
          </div>

          <div style="display:grid; grid-template-columns:1.1fr .9fr; gap:14px; margin-top:12px;" id="amGrid">
            <div class="amCard" style="margin:0;">
              <div class="rowBetween">
                <div class="pill" id="amStepCounter">Paso</div>
                <div class="pill" id="amTimerInline" style="display:none;">⏱️ <span id="amTimerTxt"></span></div>
              </div>
              <div id="amStepText" style="margin-top:12px; font-weight:950; font-size:16px;"></div>
              <div id="amStepHint" class="muted small" style="margin-top:10px;"></div>

              <div class="rowBetween" style="margin-top:14px;">
                <button id="amPrev" class="btn secondary" type="button">← Anterior</button>
                <button id="amNextOrTimer" class="btn primary" type="button">Siguiente →</button>
              </div>
            </div>

            <div class="amCard" style="margin:0;">
              <img id="amStepImg" alt="" style="width:100%; height:auto; border-radius:16px; border:1px solid rgba(64,17,2,.10); display:none;" />
              <div id="amImgFallback" class="muted small" style="display:none;">Sin imagen para este paso.</div>

              <div id="amFinalActions" style="display:none; margin-top:14px;">
                <div class="rowBetween">
                  <button id="amFinishPostre" class="btn secondary" type="button">Finalizar postre</button>
                  <button id="amFinishLote" class="btn primary" type="button">Finalizar lote</button>
                </div>
              </div>
            </div>
          </div>

          <div class="muted small" style="margin-top:10px;">Tip: en móvil, gira la pantalla para ver mejor la imagen.</div>
        </div>
      </div>

      <div id="amStickyTimerV6" class="amStickyTimer">
        <div class="box">
          <div class="tTitle" id="amStickyLabelV6">Temporizador</div>
          <div class="tTime" id="amStickyTimeV6">00:00</div>
          <div class="bar"><div id="amStickyBarV6"></div></div>
          <div class="muted small" id="amStickySubV6" style="margin-top:8px;">Base en nevera</div>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);

    // responsive overlay grid
    const st=document.createElement("style");
    st.textContent=`@media (max-width: 900px){ #amGrid{ grid-template-columns:1fr !important; } }`;
    document.head.appendChild(st);

    $("amRecipeClose").onclick = onRecipeClose;
    $("amPrev").onclick = ()=> stepMove(-1);
    $("amNextOrTimer").onclick = onNextOrTimer;
    $("amFinishPostre").onclick = ()=> finalizePostreFromOverlay();
    $("amFinishLote").onclick = ()=> finalizeLoteFromOverlay();
  }

  function openRecipe(pid, orderIds, units){
    injectRecipeOverlay();
    const ov=$("amRecipeOverlayV6");
    ov.style.display="flex"; ov.setAttribute("aria-hidden","false");
    state.recipe={open:true, productId:pid, orderIds:orderIds||[], units:Number(units||0), stepIdx:0, timerStarted:false};
    renderRecipeStep();
  }
  function closeRecipe(){
    const ov=$("amRecipeOverlayV6");
    if(ov){ ov.style.display="none"; ov.setAttribute("aria-hidden","true"); }
    state.recipe={open:false, productId:null, orderIds:[], units:0, stepIdx:0, timerStarted:false};
  }
  function stepMove(delta){
    const pid=state.recipe.productId; if(!pid) return;
    const steps=RECIPE_UNIT[pid]?.steps||[];
    state.recipe.stepIdx = Math.max(0, Math.min(steps.length-1, state.recipe.stepIdx+delta));
    state.recipe.timerStarted=false;
    renderRecipeStep();
  }
  function msToMMSS(ms){
    const s=Math.max(0,Math.floor(ms/1000));
    const mm=String(Math.floor(s/60)).padStart(2,"0");
    const ss=String(s%60).padStart(2,"0");
    return `${mm}:${ss}`;
  }
  function renderInlineTimer(pid){
    const pill=$("amTimerInline"); const txt=$("amTimerTxt");
    if(!pill||!txt) return;
    const end=getTimerEnd(state.todayKey,pid); const now=Date.now();
    if(end && end>now){ pill.style.display="inline-flex"; txt.textContent=msToMMSS(end-now); }
    else { pill.style.display="none"; txt.textContent=""; }
  }
  function setRecipeImage(src){
    const img=$("amStepImg"); const fb=$("amImgFallback");
    if(!img) return;
    img.onerror=()=>{ img.style.display="none"; if(fb) fb.style.display="block"; img.src=""; };
    if(src){
      img.src=src; img.style.display="block"; if(fb) fb.style.display="none";
    }else{
      img.style.display="none"; if(fb) fb.style.display="block"; img.src="";
    }
  }

  function remainingProductsCount(){
    const todayAll = state.paidOrders.filter(o=>o.__prod_day===state.todayKey);
    const byProd = aggregateByProduct(todayAll);
    const needed = PRODUCTS.map(p=>p.id).filter(pid=>(byProd.get(pid)||0)>0);
    const remaining = needed.filter(pid=>!isProductDone(state.todayKey,pid));
    return remaining.length;
  }

  function renderRecipeStep(){
    const pid=state.recipe.productId; if(!pid) return;
    const prod=PRODUCTS.find(p=>p.id===pid);
    const steps=RECIPE_UNIT[pid]?.steps||[];
    const st=steps[state.recipe.stepIdx]||null;

    $("amRecipeTitle").textContent = `Receta · ${prod?prod.name:pid}`;
    $("amRecipeSub").textContent = `Lote: ${state.recipe.units} unidades · Operador: ${state.session.operatorLabel||"—"}`;
    $("amStepCounter").textContent = `Paso ${state.recipe.stepIdx+1} / ${steps.length}`;
    const bar=$("amProgBar");
    if(bar){ const pct=Math.round(((state.recipe.stepIdx+1)/Math.max(1,steps.length))*100); bar.style.width=pct+"%"; }

    renderInlineTimer(pid);

    const nextBtn=$("amNextOrTimer");
    const finalBox=$("amFinalActions");
    if(finalBox) finalBox.style.display = "none";

    // Mostrar botones finales según si es el último postre pendiente
    if(st?.type==="final"){
      const remaining = remainingProductsCount();
      const btnPostre = $("amFinishPostre");
      const btnLote = $("amFinishLote");
      if(remaining > 1){
        btnPostre.style.display="inline-flex";
        btnLote.style.display="none";
      }else{
        btnPostre.style.display="none";
        btnLote.style.display="inline-flex";
      }
    }

    if(st?.type==="batch_ingredients"){
      const {lines,totalCost}=calcBatchIngredients(pid,state.recipe.units);
      const costText= totalCost>0?`$${money(totalCost)}`:"—";
      $("amStepText").textContent = "Ingredientes totales del lote";
      $("amStepHint").innerHTML =
        `<div class="pill" style="margin:10px 0;">Costo estimado: ${costText}</div>` +
        (lines||[]).map(li=>`
          <div class="line">
            <span>${escapeHtml(li.key)}</span>
            <div>${fmtQty(li.qty)} ${li.pricePerUnit?`<span class="muted small" style="margin-left:8px;">($${money(li.pricePerUnit)}/u)</span>`:`<span class="muted small" style="margin-left:8px;">(sin costo)</span>`}</div>
          </div>`).join("");
      setRecipeImage("");
      nextBtn.disabled=false; nextBtn.textContent="Siguiente →"; nextBtn.onclick = onNextOrTimer;
      return;
    }

    $("amStepText").textContent = st?.text || "";
    $("amStepHint").textContent = "";

    if(st?.type==="timer_base"){
      $("amStepHint").textContent = "Este paso exige temporizador. Inícialo para poder continuar.";
      nextBtn.disabled=false;
      nextBtn.textContent = state.recipe.timerStarted ? "Siguiente →" : "Iniciar temporizador";
    }else if(st?.type==="final"){
      const remaining = remainingProductsCount();
      nextBtn.disabled=false;
      nextBtn.textContent = (remaining > 1) ? "Finalizar postre" : "Finalizar lote";
      nextBtn.onclick = (remaining > 1) ? ()=> finalizePostreFromOverlay() : ()=> finalizeLoteFromOverlay();
    }else{
      nextBtn.disabled=false; nextBtn.textContent="Siguiente →";
    }

    setRecipeImage(st?.img||"");
  }

  function startBaseTimer(pid){
    const existing=getTimerEnd(state.todayKey,pid);
    const now=Date.now();
    if(existing && existing>now){
      startWidgetTicker();
      return;
    }
    const end=Date.now()+BASE_FRIDGE_MINUTES*60*1000;
    setTimerEnd(state.todayKey,pid,end);
    startWidgetTicker();
  }

  function startWidgetTicker(){
    const w=$("amStickyTimerV6");
    const label=$("amStickyLabelV6");
    const time=$("amStickyTimeV6");
    const bar=$("amStickyBarV6");
    const sub=$("amStickySubV6");
    if(!w||!label||!time||!bar||!sub) return;
    if(state.widgetTick) return;

    state.widgetTick=setInterval(()=>{
      const now=Date.now();
      const day = getTimersMap()?.[state.todayKey] || {};
      const entries=Object.entries(day).map(([pid,end])=>({pid,end:Number(end||0)})).filter(x=>x.end>now).sort((a,b)=>a.end-b.end);
      if(entries.length===0){
        w.style.display="none";
        clearInterval(state.widgetTick); state.widgetTick=null;
        return;
      }
      const top=entries[0];
      const prod=PRODUCTS.find(p=>p.id===top.pid);
      label.textContent = prod?prod.name:"Temporizador";
      const left = top.end-now;
      time.textContent = msToMMSS(left);

      // barra: asume 30min si no sabemos; si quieres, podemos guardar startTime para barra exacta
      const total = BASE_FRIDGE_MINUTES*60*1000;
      const pct = Math.max(0, Math.min(100, Math.round((left/total)*100)));
      bar.style.width = pct + "%";
      sub.textContent = "Base en nevera";
      w.style.display="block";

      if(state.recipe.open && state.recipe.productId) renderInlineTimer(state.recipe.productId);
    },250);
  }

  function onNextOrTimer(){
    const pid=state.recipe.productId; if(!pid) return;
    const steps=RECIPE_UNIT[pid]?.steps||[];
    const st=steps[state.recipe.stepIdx]||null;

    if(st?.type==="timer_base"){
      if(!state.recipe.timerStarted){
        startBaseTimer(pid);
        state.recipe.timerStarted=true;
        renderRecipeStep();
        return;
      }
    }
    stepMove(1);
  }

  async function onRecipeClose(){
    // cerrar sin revertir DB por defecto (tu regla dice revertir si se inició erróneo)
    // Aquí mantenemos confirmación; si quieres revertir DB, lo volvemos a conectar a kitchen_bulk_update.
    const ok = await confirmWithDelay({
      title:"Salir del paso a paso",
      message:"¿Deseas salir del paso a paso? (No finalizará el postre).",
      seconds:2,
      okText:"Salir"
    });
    if(!ok) return;
    closeRecipe();
  }

  // ========= BULK UPDATE (DB) =========
  async function kitchenBulkUpdate(orderIds, patch){
    if(!Array.isArray(orderIds)||orderIds.length===0) return;
    // IMPORTANTE: esto debe existir en backend
    return api({
      action:"kitchen_bulk_update",
      admin_pin: state.session.pin||"",
      operator: state.session.operatorLabel||"COCINA",
      order_ids: orderIds.map(String),
      patch: patch||{},
    });
  }

  // ========= Flujos: iniciar paso a paso =========
  async function startRecipeFlow(pid, baseOrders){
    const orders=baseOrders||[];
    const byProd=aggregateByProduct(orders);
    const units=byProd.get(pid)||0;
    const ids=getOrderIdsThatContainProduct(orders,pid);
    if(ids.length===0) return;

    showLoading("Iniciando…","Marcando pedidos en proceso…");
    try{
      await kitchenBulkUpdate(ids,{kitchen_status:"En proceso"});
      await refresh();
      openRecipe(pid, ids, units);
    }catch(e){
      alert(e?.message||String(e));
    }finally{
      hideLoading();
    }
  }

  // ========= Finalizar postre/lote =========
  async function finalizePostreFromOverlay(){
    const pid=state.recipe.productId; if(!pid) return;
    const ok=await confirmWithDelay({title:"Finalizar postre", message:"Este postre pasará a Finalizados (vista).", seconds:2, okText:"Finalizar"});
    if(!ok) return;

    markProductDone(state.todayKey,pid,true);
    clearTimer(state.todayKey,pid);
    closeRecipe();
    renderAll();
  }

  function getTodayOrderIds(){
    return state.paidOrders.filter(o=>o.__prod_day===state.todayKey).map(o=>String(o.order_id));
  }

  async function finalizeLoteFromOverlay(){
    const ids=(state.activeOverlay?.orderIds && state.activeOverlay.orderIds.length)? state.activeOverlay.orderIds : getTodayOrderIds();
    if(ids.length===0) return;

    const ok=await confirmWithDelay({title:"Finalizar lote", message:"Esto cambiará a 'Listo' en la base de datos.", seconds:2, okText:"Finalizar lote"});
    if(!ok) return;

    showLoading("Finalizando lote…","Actualizando base de datos…");
    try{
      await kitchenBulkUpdate(ids,{kitchen_status:"Listo"});
      // Limpieza local
      for(const p of PRODUCTS) markProductDone(state.todayKey,p.id,false);
      closeRecipe();
      await refresh();
    }catch(e){
      alert(e?.message||String(e));
    }finally{
      hideLoading();
    }
  }

  // ========= Render general =========
  function renderFinalizadosLocal(container, orders, badge){
    if(!container) return;
    injectStylesV6();

    const byProd = aggregateByProduct(orders);
    const cards=[];
    for(const p of PRODUCTS){
      const qty=byProd.get(p.id)||0;
      if(qty<=0) continue;
      if(!isProductDone(state.todayKey,p.id)) continue;

      cards.push(`
        <div class="amCard" data-pid="${escapeHtml(p.id)}" data-units="${qty}">
          <div class="amHead">
            <div style="min-width:0;">
              <div class="amName">${escapeHtml(p.name)}</div>
              <div class="muted small" style="margin-top:8px;">${escapeHtml(badge||"Finalizado")}</div>
            </div>
            <div style="display:flex; flex-direction:column; align-items:flex-end; gap:10px;">
              <div class="amQty">${qty}</div>
              <div class="amPill">✅ Hecho</div>
              <div class="muted small">Ver ▾</div>
            </div>
          </div>
          <div class="amBody"></div>
        </div>
      `);
    }

    container.innerHTML = cards.length ? cards.join("") : `<div class="muted small" style="padding:8px 0;">Sin datos.</div>`;

    container.onclick=async(e)=>{
      const card=e.target.closest(".amCard"); if(!card) return;
      const head=e.target.closest(".amHead"); if(!head) return;

      card.classList.toggle("open");
      const body=card.querySelector(".amBody");
      if(!body) return;

      if(!card.classList.contains("open")) return;

      if(body.getAttribute("data-loaded")==="1") return;
      body.setAttribute("data-loaded","1");

      const pid=card.getAttribute("data-pid");
      const units=Number(card.getAttribute("data-units")||0);

      const {lines,totalCost}=calcBatchIngredients(pid,units);
      const costText= totalCost>0?`$${money(totalCost)}`:"—";
      const unitCost = (units>0 && totalCost>0) ? (totalCost/units) : 0;
      const unitText = unitCost>0?`$${money(unitCost)}`:"—";

      const ingHtml=(lines||[]).map(li=>`
        <div class="amIngRow">
          <div class="amIngName">${escapeHtml(li.key)}</div>
          <div class="amIngRight">
            <div class="amIngQty">${fmtQty(li.qty)}</div>
            <div class="amIngCost ${(Number(li.pricePerUnit||0)>0) ? "hasCost" : ""}">${(Number(li.pricePerUnit||0)>0)?`($${money(li.pricePerUnit)}/u)`:"(sin costo)"}</div>
          </div>
        </div>
      `).join("");

      body.innerHTML=`
        <div class="rowBetween" style="margin-bottom:10px;">
          <div class="pill">Ingredientes (lote)</div>
          <div style="display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end;">
            <div class="pill">Unitario: ${unitText}</div>
            <div class="pill">Lote: ${costText}</div>
          </div>
        </div>
        ${ingHtml||`<div class="muted small">Sin receta configurada.</div>`}
      `;
    };
  }


  function renderFinalizadosDb(container, doneOrders){
    if(!container) return;
    injectStylesV6();
    const orders = Array.isArray(doneOrders) ? doneOrders : [];
    // Render por postre agregando detalle desplegable con pedidos (IDs) e ingredientes
    const byProd = aggregateByProduct(orders);
    const cards=[];
    for(const p of PRODUCTS){
      const qty=byProd.get(p.id)||0;
      if(qty<=0) continue;
      // Ingredientes del lote (según receta)
      const ing = calcBatchIngredients(p.id, qty);
      const ingHtml = renderIngredientsPretty(ing, true, qty, p.id);

      // IDs asociados
      const ids = getOrderIdsThatContainProduct(orders, p.id);

      cards.push(`
        <details class="amCard" open="false">
          <summary class="amHead">
            <div style="min-width:0;">
              <div class="amName">${escapeHtml(p.label||p.id)}</div>
              <div class="muted small">Listo · ${ids.length} pedido(s)</div>
            </div>
            <div style="text-align:right;">
              <div class="amQty">${qty}</div>
              <div class="muted small">unidades</div>
            </div>
          </summary>

          <div class="amBody" style="margin-top:10px;">
            <div class="muted small" style="margin:0 0 10px 0;"><b>IDs:</b> ${ids.map(escapeHtml).join(", ")}</div>
            ${ingHtml}
          </div>
        </details>
      `);
    }

    if(cards.length===0){
      container.innerHTML = `<div class="muted small">Sin datos.</div>`;
      return;
    }

    container.innerHTML = `<div class="amStack">${cards.join("")}</div>`;
  }


  // Pretty ingredients block for Finalizados (DB) cards
  function renderIngredientsPretty(batchInfo, showCost, qty, pid){
    // batchInfo expected from calcBatchIngredients(): { lines:[{key,qty,unit,pricePerUnit}], totalCost:number }
    const bi = batchInfo && typeof batchInfo === "object" ? batchInfo : { lines: [], totalCost: 0 };
    const lines = Array.isArray(bi.lines) ? bi.lines : [];
    const total = Number(bi.totalCost||0)||0;
    const unit = (Number(qty||0)>0) ? (total/Number(qty||0)) : 0;

    const costText = showCost ? fmtMoney(Math.round(total)) : "—";
    const unitText = showCost ? fmtMoney(Math.round(unit)) : "—";

    const rows = lines.map(li=>{
      const q = fmtQty(li.qty);
      const ppu = (Number(li.pricePerUnit||0)>0)
        ? `<span class="muted small" style="margin-left:8px;">(${fmtMoney(li.pricePerUnit)}/u)</span>`
        : `<span class="muted small" style="margin-left:8px;">(sin costo)</span>`;
      return `
        <div class="line">
          <span>${escapeHtml(li.key)}</span>
          <div>${q}${ppu}</div>
        </div>`;
    }).join("");

    return `
      <div class="rowBetween" style="margin-bottom:10px;">
        <div class="pill">Ingredientes (lote)</div>
        <div style="display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end;">
          <div class="pill">Unitario: ${unitText}</div>
          <div class="pill">Lote: ${costText}</div>
        </div>
      </div>
      ${rows || `<div class="muted small">Sin receta configurada.</div>`}
    `;
  }

  function renderAll(){
    renderProductCards(todayWrap, state.buckets.today, {badgeText:`Producción ${state.todayKey}`, showAction:true});
    renderProductCards(tomorrowWrap, state.buckets.infoTomorrow, {badgeText:`Informativo (${state.nextKey})`, showAction:false});
    renderProductCards(inProgressWrap, state.buckets.inProgress, {badgeText:"En proceso", showAction:true});

    // Finalizados:
    // 1) DB: pedidos con kitchen_status="Listo"
    renderFinalizadosDb(doneWrap, state.buckets.doneDb);
    // 2) Local (si marcaste postres como hechos en vista, sin cerrar lote)
    renderFinalizadosLocal(doneWrap, state.paidOrders.filter(o=>o.__prod_day===state.todayKey), "Finalizado (operador)");
  }

    // ========= Compras (enviar lista a Costos) =========
  function ensureShoppingButton(){
    if(btnShopping) return;
    const headerBtns = btnRefresh?.parentElement;
    if(!headerBtns) return;
    const btn=document.createElement("button");
    btn.id="btnShopping";
    btn.className="btn secondary";
    btn.type="button";
    btn.innerHTML = `<span class="ico" style="display:none;">🛒</span><span class="txt">Compras</span>`;
    // lo ponemos antes de Costos si existe, si no antes de Actualizar
    headerBtns.insertBefore(btn, (btnCosts || btnRefresh));
    btnShopping = btn;
    btn.onclick = onClickShopping;
  }

  async function onClickShopping(){
    try{
      showLoading("Preparando compras…", "Calculando ingredientes necesarios…");
      const need = computeNeededIngredientsForShopping();
      // Guardar en base de datos (multi-dispositivo)
      await apiPost({
        action: "shopping_save",
        admin_pin: getSessionPin(),
        operator: state.operatorLabel || state.operatorId || "",
        payload: need,
      });
      // Abrir costos en sección compras
      window.open("costs.html#compras", "_blank");
    }catch(e){
      alert(e?.message || "No se pudo preparar la lista de compras.");
      console.error("shopping error:", e);
    }finally{
      hideLoading();
    }
  }

  function computeNeededIngredientsForShopping(){
    // Agrupa ingredientes de lotes que aún se deben producir (hoy + mañana informativo) y los en proceso.
    // Usa las recetas (computeBatchIngredients) y suma por ingrediente (nombre + unidad).
    const map = {}; // key: name|unit => qty
    const add = (name, unit, qty)=>{
      const k = (String(name||"").trim().toLowerCase()) + "|" + (String(unit||"").trim().toLowerCase());
      map[k] = (map[k]||0) + Number(qty||0);
    };

    // lotes hoy pendientes
    const lots = []
      .concat(state.buckets?.todayLots || [])
      .concat(state.buckets?.tomorrowLots || [])
      .concat(state.buckets?.inProgressLots || []);

    for(const lot of lots){
      const productKey = lot.product_key || lot.product || lot.name;
      const qty = Number(lot.qty || lot.quantity || 0);
      if(!productKey || !qty) continue;

      const ing = computeBatchIngredients(productKey, qty); // [{name, unit, qty}]
      for(const it of (ing||[])){
        add(it.name, it.unit, it.qty);
      }
    }

    // output array
    const out = Object.entries(map).map(([k, qty])=>{
      const [name, unit] = k.split("|");
      return { name: name, unit: unit, qty: Math.round(qty*1000)/1000 };
    }).sort((a,b)=> (a.name||"").localeCompare(b.name||"", "es-CO"));

    return {
      created_at: new Date().toISOString(),
      day_key: state.todayKey,
      items: out
    };
  }


// ========= Costs modal (solo lectura) =========
  function ensureCostsButton(){
    const headerBtns = btnRefresh?.parentElement;
    if(!headerBtns) return;

    // Si existe en DOM, solo aseguramos el handler
    if(btnCosts){
      btnCosts.onclick = ()=>openCostsModal();
      return;
    }

    // Si no existe, lo creamos al lado de Actualizar
    const btn=document.createElement("button");
    btn.id="btnCosts";
    btn.className="btn secondary";
    btn.type="button";
    btn.innerHTML = `<span class="ico" style="display:none;">💰</span><span class="txt">Costos</span>`;
    headerBtns.insertBefore(btn, btnRefresh);
    btnCosts = btn;
    btn.onclick = ()=>openCostsModal();
  }
  async function openCostsModal(){
    if(!costsModal) return;
    costsGateErr.textContent="";
    try{
      showLoading("Sincronizando…","Actualizando costos desde la base de datos.");
      await fetchCostsPublic();
    }catch(e){
      costsGateErr.textContent = (e && e.message) ? e.message : "No se pudieron actualizar los costos.";
    }finally{
      hideLoading();
    }
    costsModal.style.display="flex";
    costsModal.setAttribute("aria-hidden","false");
    renderCostsReadOnly();
  }
  function closeCostsModal(){
    if(!costsModal) return;
    costsModal.style.display="none";
    costsModal.setAttribute("aria-hidden","true");
  }
  function renderCostsReadOnly(){
    if(!costsEditor) return;
    const keys=Object.keys(state.pricesMap||{}).sort((a,b)=>a.localeCompare(b,"es"));
    const list=keys.map(k=>({k,v:Number(state.pricesMap[k]||0)})).sort((a,b)=>(b.v-a.v)||a.k.localeCompare(b.k,"es"));
    const html=list.map(it=>`<div class="line"><span>${escapeHtml(it.k)}</span><div>$${money(it.v)}</div></div>`).join("");
    const meta=state.costsLastUpdated?`<div class="muted small" style="margin-bottom:10px;">Última actualización: ${escapeHtml(state.costsLastUpdated)}</div>`:`<div class="muted small" style="margin-bottom:10px;">Costos en modo solo lectura.</div>`;
    costsEditor.innerHTML = meta + `<div class="amCard open" style="margin:0;">
      <div class="rowBetween"><div style="font-weight:950;">Costos por unidad</div><div class="pill">${keys.length} items</div></div>
      <div class="amBody" style="margin-top:10px; max-height:55vh; overflow:auto; display:block;">${html||`<div class="muted small">Sin datos.</div>`}</div>
    </div>`;
  }

  
  // ========= Historial (pedidos elaborados) =========
  let btnHistory = null;
  let historyModal = null;
  let histListEl = null;
  let histStatusEl = null;
  let btnHistClose = null;
  let btnHistRefresh = null;

  function ensureHistoryButton(){
    if(btnHistory) return;
    const headerBtns = btnRefresh?.parentElement;
    if(!headerBtns) return;
    const btn=document.createElement("button");
    btn.id="btnHistory";
    btn.className="btn secondary";
    btn.type="button";
    btn.innerHTML = `<span class="ico" style="display:none;">🕘</span><span class="txt">Historial</span>`;
    btn.style.display = "none";
    // lo ponemos antes de "Actualizar" (y después de Costos si existe)
    headerBtns.insertBefore(btn, btnRefresh);
    btnHistory = btn;
    btn.onclick = openHistoryModal;
  }

  function injectHistoryModal(){
    if(document.getElementById("historyModal")) return;

    const overlay=document.createElement("div");
    overlay.id="historyModal";
    overlay.className="modalOverlay";
    overlay.style.display="none";
    overlay.setAttribute("aria-hidden","true");
    overlay.innerHTML = `
      <div class="modalBox" style="max-width:920px; max-height:88vh; overflow:auto;">
        <div class="rowBetween" style="align-items:flex-start; gap:12px;">
          <div style="min-width:0;">
            <div class="modalTitle" style="margin:0;">Historial · Pedidos elaborados</div>
            <div class="muted small" style="margin-top:6px;">
              Muestra pedidos con <b>cocina: Listo</b> (últimos registros cargados en la sesión).
            </div>
          </div>
          <div class="row" style="gap:10px;">
            <button id="btnHistRefresh" class="btn secondary" type="button">Refrescar</button>
            <button id="btnHistClose" class="btn secondary" type="button">Cerrar</button>
          </div>
        </div>

        <div id="histStatus" class="muted small" style="margin-top:10px;"></div>
        <div id="histList" class="histList"></div>
      </div>
    `;
    document.body.appendChild(overlay);

    // estilos del historial (solo una vez)
    if(!document.getElementById("amHistoryStyles")){
      const st=document.createElement("style");
      st.id="amHistoryStyles";
      st.textContent = `
        .histDays{ margin-top:14px; display:flex; flex-direction:column; gap:10px; }
        .histDay{ border:1px solid rgba(0,0,0,.06); border-radius:14px; padding:10px 12px; background:rgba(255,255,255,.55); }
        .histDay > summary{ cursor:pointer; display:flex; align-items:center; justify-content:space-between; gap:10px; font-weight:800; }
        .histOrders{ display:flex; flex-direction:column; gap:10px; margin-top:10px; }
        .histOrder{ border:1px solid rgba(0,0,0,.06); border-radius:14px; padding:10px 12px; background:#fff; }
        .histOrder > summary{ cursor:pointer; display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
        .histOrder .oid{ font-weight:900; }
        .histOrder .when{ color:rgba(0,0,0,.6); font-size:12px; }
        .histSection{ margin-top:10px; }
        .histSection .label{ font-weight:800; margin-bottom:6px; }
        .miniBox{ border:1px solid rgba(0,0,0,.06); background:rgba(0,0,0,.02); border-radius:12px; padding:10px; }
        .miniRow{ display:flex; justify-content:space-between; gap:10px; padding:6px 0; border-bottom:1px dashed rgba(0,0,0,.08); }
        .miniRow:last-child{ border-bottom:none; }
        .histProd{ border:1px solid rgba(0,0,0,.06); border-radius:12px; padding:8px 10px; background:#fff; margin-top:8px; }
        .histProd > summary{ cursor:pointer; display:flex; gap:8px; align-items:center; flex-wrap:wrap; justify-content:space-between; font-weight:800; }
        .ingList{ margin-top:8px; display:flex; flex-direction:column; gap:6px; }
        .ingRow{ display:flex; justify-content:space-between; gap:10px; padding:4px 0; border-bottom:1px dashed rgba(0,0,0,.08); }
        .ingRow:last-child{ border-bottom:none; }
        .histList{ margin-top:12px; }
      
    `;
      document.head.appendChild(st);
    }

    historyModal = overlay;
    histListEl = overlay.querySelector("#histList");
    histStatusEl = overlay.querySelector("#histStatus");
    btnHistClose = overlay.querySelector("#btnHistClose");
    btnHistRefresh = overlay.querySelector("#btnHistRefresh");

    btnHistClose.onclick = closeHistoryModal;
    btnHistRefresh.onclick = async () => {
      showLoading("Actualizando…","Cargando historial.");
      try{
        await refresh(); // recarga pedidos pagados
        renderHistory();
      }catch(e){
        if(histStatusEl) histStatusEl.textContent = "❌ " + String(e?.message || e);
      }finally{
        hideLoading();
      }
    };

    // click fuera para cerrar
    overlay.addEventListener("click",(e)=>{
      if(e.target === overlay) closeHistoryModal();
    });
  }

  function openHistoryModal(){
    if(!historyModal) return;
    historyModal.style.display="flex";
    historyModal.setAttribute("aria-hidden","false");
    renderHistory();
  }

  function closeHistoryModal(){
    if(!historyModal) return;
    historyModal.style.display="none";
    historyModal.setAttribute("aria-hidden","true");
  }

  function renderHistory(){
    if(!histListEl || !histStatusEl) return;

    const all = (state.paidOrders || [])
      .filter(o => String(o.kitchen_status || "") === "Listo")
      .map(o => {
        if(!o.__prod_day) o.__prod_day = computeProductionDayKeyForOrder(o.created_at) || state.todayKey;
        return o;
      })
      .sort((a,b)=> (Date.parse(b.created_at||"")||0) - (Date.parse(a.created_at||"")||0));

    if(!all.length){
      histStatusEl.textContent = "Sin datos de historial (aún no hay pedidos con cocina en 'Listo').";
      histListEl.innerHTML = "";
      return;
    }

    // agrupar por día de producción
    const groups = new Map();
    for(const o of all){
      const k = o.__prod_day || "—";
      if(!groups.has(k)) groups.set(k, []);
      groups.get(k).push(o);
    }

    const days = Array.from(groups.keys()).sort((a,b)=> b.localeCompare(a,"es"));
    histStatusEl.textContent = `${all.length} pedidos listos · ${days.length} día(s)`;

    const orderHtml = (o)=>{
      const oid = escapeHtml(String(o.order_id||""));
      const when = escapeHtml(formatBogotaDT(o.created_at||""));
      const items = normalizeItemsFromAnyOrder(o);
      const itemsHtml = (items.length? items.map(it=>{
        const pid = String(it.id||"");
        const p = PRODUCTS.find(x=>x.id===pid);
        const name = escapeHtml(p?.name || it.name || pid || "Producto");
        const qty = Number(it.qty||0)||0;
        const price = Number(it.unit_price||0)||0;
        return `<div class="miniRow"><div>${name}</div><div><b>${qty}</b> · ${escapeHtml(fmtMoney(price))}</div></div>`;
      }).join("") : `<div class="muted small">Sin items.</div>`);

      // ingredientes estimados por pedido (según recetas)
      const ingBlocks = [];
      for(const it of items){
        const pid = String(it.id||"");
        const qty = Number(it.qty||0)||0;
        if(!pid || qty<=0) continue;
        const prod = PRODUCTS.find(x=>x.id===pid);
        const bi = calcBatchIngredients(pid, qty);
        if(!bi.lines.length) continue;
        const title = escapeHtml(prod?.name || pid);
        const costLote = Math.round(bi.totalCost);
        const costUnit = qty>0 ? Math.round(bi.totalCost/qty) : 0;
        const linesHtml = bi.lines.map(l=>{
          const q = fmtQty(l.qty);
          const ppu = l.pricePerUnit>0 ? ` (${fmtMoney(l.pricePerUnit)}/u)` : ` <span class="muted small">(sin costo)</span>`;
          return `<div class="ingRow"><div>${escapeHtml(l.key)}</div><div>${q}${ppu}</div></div>`;
        }).join("");
        ingBlocks.push(`
          <details class="histProd">
            <summary>
              <span>${title}</span>
              <span class="pill">${qty} uds</span>
              <span class="pill">${fmtMoney(costLote)} lote</span>
              <span class="pill">${fmtMoney(costUnit)} /ud</span>
            </summary>
            <div class="ingList">${linesHtml}</div>
          </details>
        `);
      }

      const ingHtml = ingBlocks.length ? ingBlocks.join("") : `<div class="muted small">Sin ingredientes configurados para este pedido.</div>`;

      return `
        <details class="histOrder">
          <summary>
            <span class="oid">#${oid}</span>
            <span class="when">${when}</span>
            <span class="pill">Listo</span>
          </summary>
          <div class="histSection">
            <div class="label">Items</div>
            <div class="miniBox">${itemsHtml}</div>
          </div>
          <div class="histSection">
            <div class="label">Ingredientes usados (estimado)</div>
            <div class="miniBox">${ingHtml}</div>
          </div>
        </details>
      `;
    };

    const htmlDays = days.map(dayKey => {
      const orders = groups.get(dayKey) || [];
      const last = orders[0]?.created_at || "";
      const meta = `Pedidos: ${orders.length} · Último: ${escapeHtml(formatBogotaDT(last))}`;

      return `
        <details class="histDay" open>
          <summary>
            <span>${escapeHtml(dayKey)}</span>
            <span class="pill">${orders.length} pedidos</span>
          </summary>
          <div class="muted small" style="margin:6px 0 10px;">${meta}</div>
          <div class="histOrders">
            ${orders.map(orderHtml).join("")}
          </div>
        </details>
      `;
    }).join("");

    histListEl.innerHTML = `
      <div class="histDays">${htmlDays}</div>
    `;
  }


// ========= Refresh =========
  async function refresh(){
    const myNonce=state.refreshNonce;
    showLoading("Cargando…","Actualizando pedidos…");
    try{
      await loadData(myNonce);
      if(myNonce!==state.refreshNonce) return;
      renderAll();
    }finally{
      hideLoading();
    }
  }

  // ========= Login/Logout =========
  async function onLogin(){
    loginErr.textContent="";
    const pin=String(inpPin.value||"").trim();
    if(pin.length<4){ loginErr.textContent="Escribe el PIN."; return; }
    if(!state.profilesLoaded){ loginErr.textContent="Perfiles no cargados."; return; }

    const selectedId=selOperator.value;
    if(!selectedId){ loginErr.textContent="Selecciona un perfil."; return; }

    showLoading("Validando…","Verificando acceso…");
    try{
      await validatePinBestEffort(pin);

      const label=state.profiles.find(p=>p.id===selectedId)?.label;
      if(!label) throw new Error("Perfil no válido.");

      state.session={operatorId:selectedId, operatorLabel:label, pin};
      saveSession();

      showApp();

      // Costos: intentamos cargar al entrar (si falla, igual deja entrar)
      if(!state.costsLoaded){
        const costs = await apiTry({action:"costs_public_list"});
        if(costs.ok===true){
          await fetchCostsPublic();
        }
      }

      await refresh();
      startWidgetTicker();
    }catch(e){
      clearSession();
      showLogin();
      loginErr.textContent = e?.message || "PIN inválido o no autorizado.";
    }finally{
      hideLoading();
    }
  }

  function onLogout(){
    state.refreshNonce++;
    clearSession();
    closeRecipe();
    closeCostsModal();
    showLogin();
    // vuelve a cargar perfiles
    loadProfilesOnStart();
  }

  // ========= Init =========
  async function init(){
    injectStylesV6();
    ensureConfirmOverlay();
    injectRecipeOverlay();
    injectHistoryModal();
    ensureHistoryButton();
    // Compras se gestiona desde Purchases, se elimina el botón en Cocina.
    ensureCostsButton();

    // Trae costos al cargar la vista (para que el botón Costos muestre datos actualizados)
    fetchCostsPublic().catch(()=>{});

    // Botones header: reemplaza texto por iconos en móvil (si tu HTML usa spans, se verá mejor)
    if(btnLogout && !btnLogout.querySelector(".ico")){
      btnLogout.innerHTML = `<span class="ico" style="display:none;">🚪</span><span class="txt">Cerrar sesión</span>`;
    }
    if(btnRefresh && !btnRefresh.querySelector(".ico")){
      btnRefresh.innerHTML = `<span class="ico" style="display:none;">🔄</span><span class="txt">Actualizar</span>`;
    }
    if(btnHistory && !btnHistory.querySelector(".ico")){
      btnHistory.innerHTML = `<span class="ico" style="display:none;">🕘</span><span class="txt">Historial</span>`;
    }
    if(btnCosts && !btnCosts.querySelector(".ico")){
      btnCosts.innerHTML = `<span class="ico" style="display:none;">💰</span><span class="txt">Costos</span>`;
    }

    // marca contenedor header-actions si existe
    const headerBtns = btnRefresh?.parentElement;
    if(headerBtns) headerBtns.classList.add("header-actions");

    showLogin();
    renderProfilesSelect([], "");
    loginErr.textContent="Cargando perfiles…";
    showLoading("Cargando…","Preparando perfiles…");

    // 1) perfiles al iniciar
    await loadProfilesOnStart();
    hideLoading();

    // 2) sesión previa
    if(loadSession()){
      inpPin.value = state.session.pin || "";
      if(state.profilesLoaded){
        renderProfilesSelect(state.profiles, state.session.operatorId);
        const label=state.profiles.find(p=>p.id===state.session.operatorId)?.label;
        if(label){ state.session.operatorLabel=label; saveSession(); }
      }
      showApp();
      // costos best-effort
      await apiTry({action:"costs_public_list"}).then(async(r)=>{ if(r.ok===true) await fetchCostsPublic(); });
      try{
        await refresh();
        startWidgetTicker();
      }catch(_e){
        onLogout();
      }
    }

    if(btnLogin) btnLogin.onclick=onLogin;
    if(btnRefresh) btnRefresh.onclick=()=> refresh().catch(e=>alert(e?.message||String(e)));
    if(btnLogout) btnLogout.onclick=onLogout;
    if(btnCosts) btnCosts.onclick=openCostsModal;
    if(btnCloseCosts) btnCloseCosts.onclick=closeCostsModal;
  }

  init().catch(err=>{
    console.error(err);
    alert("Error inicializando cocina: " + (err?.message||String(err)));
  });
})();
