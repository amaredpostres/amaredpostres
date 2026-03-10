

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

  // Obtener campo de un objeto sin depender de mayúsculas/guiones/espacios (robusto para headers de Sheets)
  function getFieldAny_(obj, ...names){
    try{
      if(!obj) return undefined;
      const norm = (s)=> String(s||"").toLowerCase().replace(/[^a-z0-9]/g,"");
      const map = {};
      for(const k in obj){
        map[norm(k)] = obj[k];
      }
      for(const n of names){
        const key = norm(n);
        if(Object.prototype.hasOwnProperty.call(map, key)) return map[key];
      }
    }catch(_e){}
    return undefined;
  }



  
  function normTextKey_(s){
    return String(s||"")
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
  }
  function guessProductIdByName_(name){
    const n = normTextKey_(name);
    if(!n) return "";
    if(n.includes("mousse") && (n.includes("maracuya") || n.includes("maracuja") || n.includes("maracu"))) return "mousse_maracuya";
    if((n.includes("cheesecake") || n.includes("quesecake")) && (n.includes("cafe") || n.includes("caf"))) return "cheesecake_cafe_panela";
    if(n.includes("arroz") && n.includes("leche")) return "arroz_con_leche";
    return "";
  }

  const KNOWN_PRODUCT_IDS = new Set(["mousse_maracuya","cheesecake_cafe_panela","arroz_con_leche"]);
  // Canoniza IDs: si el backend trae un "id" raro (ej: nombre del producto), lo convertimos a los IDs internos esperados.
  function canonicalProductId_(pid, name){
    const p = String(pid||"").trim();
    if(p && KNOWN_PRODUCT_IDS.has(p)) return p;
    const g = guessProductIdByName_(name || p);
    if(g) return g;
    return p;
  }


// Items parser (works with Apps Script rows: items_json + items text)
  function normalizeItemsFromAnyOrder(order){
    if(!order) return [];

    // 0) Direct array in "items"
    const directArr = getFieldAny_(order,'items') ?? order.items;
    if(Array.isArray(directArr)){
      return directArr.map(it=>{
        const name = String(it.name || it.product_name || it.title || "");
        let id = String(it.id || it.product_id || it.productId || it.sku || "");
        if(!id && name) id = guessProductIdByName_(name);
        const qty = Number(it.qty ?? it.units ?? it.quantity ?? it.count ?? 0) || 0;
        const unit_price = Number(it.unit_price ?? it.price ?? it.unitPrice ?? 0) || 0;
        return { id, name, qty, unit_price };
      }).filter(it=>it.id && it.qty>0);
    }

    // 1) Prefer items_json (string/array)
    const raw = getFieldAny_(order,'items_json','itemsjson','items json','Items_json','ITEMS_JSON','itemsJSON','itemsJson') ?? (order.items_json ?? order.itemsJson ?? order.itemsJSON ?? order.itemsJSONText ?? order.itemsJsonText);
    if(raw){
      const parsed = (typeof raw === "string") ? safeJsonParse(raw) : raw;
      if(Array.isArray(parsed)){
        return parsed.map(it=>{
          const name = String(it.name || it.product_name || it.title || "");
          let id = String(it.id || it.product_id || it.productId || it.sku || "");
          id = canonicalProductId_(id, name);
          if(!id && name) id = canonicalProductId_("", name);
          const qty = Number(it.qty ?? it.units ?? it.quantity ?? it.count ?? 0) || 0;
          const unit_price = Number(it.unit_price ?? it.price ?? it.unitPrice ?? 0) || 0;
          return { id, name, qty, unit_price };
        }).filter(it=>it.id && it.qty>0);
      }
    }

    // 2) If "items" is JSON string, parse it
    if(typeof (getFieldAny_(order,"items") ?? order.items) === "string"){
      const t = String(getFieldAny_(order,'items') ?? order.items).trim();
      if((t.startsWith("[") && t.endsWith("]")) || (t.startsWith("{") && t.endsWith("}"))){
        const parsed = safeJsonParse(t);
        if(Array.isArray(parsed)){
          return parsed.map(it=>{
            const name = String(it.name || it.product_name || it.title || "");
            let id = String(it.id || it.product_id || it.productId || it.sku || "");
            if(!id && name) id = guessProductIdByName_(name);
            const qty = Number(it.qty ?? it.units ?? it.quantity ?? it.count ?? 0) || 0;
            const unit_price = Number(it.unit_price ?? it.price ?? it.unitPrice ?? 0) || 0;
            return { id, name, qty, unit_price };
          }).filter(it=>it.id && it.qty>0);
        }
        if(parsed && typeof parsed === "object" && (parsed.name || parsed.product_name) && (parsed.qty || parsed.units || parsed.quantity)){
          const name = String(parsed.name || parsed.product_name || "");
          let id = String(parsed.id || parsed.product_id || "");
          id = canonicalProductId_(id, name);
          if(!id && name) id = canonicalProductId_("", name);
          const qty = Number(parsed.qty ?? parsed.units ?? parsed.quantity ?? 0) || 0;
          const unit_price = Number(parsed.unit_price ?? parsed.price ?? 0) || 0;
          return (id && qty>0) ? [{ id, name, qty, unit_price }] : [];
        }
      }
    }

    // 3) Text fallback (WhatsApp / plain lines)
    const txt = String(getFieldAny_(order,'items_text','itemstext','items text','Items_text','ITEMS_TEXT') || getFieldAny_(order,'itemsText') || getFieldAny_(order,'items') || order.items_text || order.itemsText || order.items || "").trim();
    if(txt){
      const lines = txt.split("\n").map(s=>s.trim()).filter(Boolean);
      const out=[];
      for(const line0 of lines){
        const clean0 = line0.replace(/^[\-\•\*\u2022]\s*/,"").trim();
        if(!clean0) continue;

        // A) "Nombre: 2" / "Nombre x 2" / "Nombre × 2"
        let mm = clean0.match(/^(.+?)\s*[:xX×]\s*(\d+(?:[.,]\d+)?)\s*$/);

        // B) "2 x Nombre" / "2x Nombre"
        if(!mm) mm = clean0.match(/^(\d+(?:[.,]\d+)?)\s*(?:x|X|×)\s*(.+?)\s*$/);

        // C) "Nombre (2)" / "Nombre (x2)"
        if(!mm) mm = clean0.match(/^(.+?)\s*\(\s*(?:x\s*)?(\d+(?:[.,]\d+)?)\s*\)\s*$/);

        // D) "Nombre - 2" / "Nombre — 2"
        if(!mm) mm = clean0.match(/^(.+?)\s*[-—–]\s*(\d+(?:[.,]\d+)?)\s*$/);

        // E) "2 Nombre" (qty al inicio)
        if(!mm) mm = clean0.match(/^(\d+(?:[.,]\d+)?)\s+(.+?)\s*$/);

        if(mm){
          let name="", qtyStr="";
          if(mm.length===3){
            const a = String(mm[1]).trim();
            const b = String(mm[2]).trim();
            if(/^\d/.test(a) && !/^\d/.test(b)){
              qtyStr = a; name = b;
            }else{
              name = a; qtyStr = b;
            }
          }
          const qty = Number(qtyStr.replace(",", ".")) || 0;
          if(!(qty>0)) continue;
          const nameClean = name.trim();
          const id = guessProductIdByName_(nameClean);
          if(id) out.push({ id, name: nameClean, qty, unit_price:0 });
          continue;
        }

        // F) Nombre sin qty -> si coincide, asumir 1
        const gid = canonicalProductId_(guessProductIdByName_(clean0), clean0);
        if(gid){
          out.push({ id: gid, name: clean0, qty: 1, unit_price:0 });
          continue;
        }

        // G) Lista separada por coma -> asumir 1 cada uno
        if(clean0.includes(",")){
          const parts = clean0.split(",").map(s=>s.trim()).filter(Boolean);
          for(const p of parts){
            const pid = guessProductIdByName_(p);
            if(pid) out.push({ id: pid, name: p, qty: 1, unit_price:0 });
          }
        }
      }
      if(out.length) return out;
    }

    // 4) Last resort: product_id + qty columns
    if(order.product_id && order.qty){
      const id = String(order.product_id||"").trim();
      const qty = Number(order.qty||0) || 0;
      if(id && qty>0) return [{ id: canonicalProductId_(id, String(order.product_name||id)), name:String(order.product_name||id), qty, unit_price:0 }];
    }

    try{
      const oid = getFieldAny_(order,'order_id','orderid','Order_id','ORDER_ID') || order.order_id;
      if(oid){ console.warn('AMARED: items vacíos para order_id', oid, 'keys:', Object.keys(order||{})); }
    }catch(_e){}
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

  console.log("AMARED kitchen v2026-03-02 fix7u costs scroll lock");

  // ========= CONFIG =========
  const API_URL = "https://amared-orders.amaredpostres.workers.dev/";
  const TZ = "America/Bogota";
  const CUTOFF_HOUR = 15;
  const BASE_FRIDGE_MINUTES = 30;

  const SS_KEY = "AMARED_KITCHEN_SESSION_V6";
  const LS_KEY = "amared_kitchen_session";

  const LS_TIMER_KEY = "AMARED_KITCHEN_TIMERS_V1";
  const LS_DONE_KEY  = "AMARED_KITCHEN_DONE_V1";
const LS_ORDER_DONE_KEY = "AMARED_KITCHEN_ORDER_DONE_V1";

  // ========= PRODUCTOS =========
  const PRODUCTS = [
    { id: "mousse_maracuya", name: "Mousse de Maracuyá" },
    { id: "cheesecake_cafe_panela", name: "Cheesecake de café con panela" },
    { id: "arroz_con_leche", name: "Arroz con leche" },
  ];

  // ====== Trazabilidad por producto (JSON en una sola celda) ======
  function nowIso(){ return new Date().toISOString(); }
  function productMeta(pid){
    const p = PRODUCTS.find(x=>x.id===pid);
    return { id: pid, name: p ? p.name : String(pid||"") };
  }
  function buildProdStampPayload(pid){
    const meta = productMeta(pid);
    return { [meta.id]: { name: meta.name, at: nowIso() } };
  }


  // ========= RECETAS (unitarias) =========
  // Puedes sobreescribir desde otro archivo definiendo window.AMARED_RECIPES antes de kitchen.js
  const RECIPE_UNIT = window.AMARED_RECIPES || {};
  if(!RECIPE_UNIT.mousse_maracuya){
    RECIPE_UNIT.mousse_maracuya = {
      unitIngredients: [
        { key:"Pulpa de maracuyá (ml)", qty:21.41 },
        { key:"Leche condensada (ml)", qty:42.83 },
        { key:"Crema de leche (ml)", qty:42.83 },
        { key:"Leche entera (ml)", qty:42.83 },
        { key:"Gelatina sin sabor (g)", qty:1.25 },
        { key:"Agua (ml)", qty:8.33 },
        { key:"Galletas trituradas (g)", qty:25 },
        { key:"Mantequilla derretida (g)", qty:11.6 },
        { key:"Vainilla (ml)", qty:0.33 },
        { key:"Chocorramo (g)", qty:20 },
        { key:"Envase plástico (unidad)", qty:1 },
        { key:"Cuchara plástica (unidad)", qty:1 },
      ],
      steps: [
        { type:"batch_ingredients" },

        { type:"normal", text:"Tritura las galletas hasta lograr una textura tipo arena.", img:"assets/steps/mousse/step01.webp" },
        { type:"normal", text:"Mezcla la galleta triturada con la mantequilla derretida hasta que compacte.", img:"assets/steps/mousse/step02.webp" },
        { type:"normal", text:"Divide 25 g por vasito y presiona firme para formar la base.", img:"assets/steps/mousse/step03.webp" },
        { type:"timer_base", text:"Lleva los vasitos con base a la nevera por 30 min. (Inicia el temporizador para continuar).", img:"assets/steps/mousse/step04.webp" },

        { type:"normal", text:"En licuadora: integra pulpa, leche condensada, crema de leche, leche entera y vainilla, hasta obtener una mezcla uniforme.", img:"assets/steps/mousse/step05.webp" },
        { type:"normal", text:"Calienta el agua sin dejar que hierva.", img:"assets/steps/mousse/step06.webp" },
        { type:"normal", text:"Agrega la gelatina al agua tibia y mezcla en el fogón hasta disolver (sin grumos).", img:"assets/steps/mousse/step07.webp" },
        { type:"normal", text:"Con la licuadora encendida, incorpora la gelatina disuelta lentamente.", img:"assets/steps/mousse/step08.webp" },

        { type:"normal", text:"Vierte 150 ml de mezcla en cada vasito, sobre la base.", img:"assets/steps/mousse/step09.webp" },
        { type:"normal", text:"Refrigera mínimo 8 horas o toda la noche.", img:"assets/steps/mousse/step10.webp" },
        { type:"normal", text:"Decora con el logo espolvoreado.", img:"assets/steps/mousse/step11.webp" },
        { type:"normal", text:"Añade cubos de chocorramo (≈ 20 g por postre).", img:"assets/steps/mousse/step12.webp" },

        { type:"final", text:"¡Listo! Revisa presentación y deja el área limpia.", img:"assets/steps/mousse/step13.webp" },
      ],
    };
  }
  if(!RECIPE_UNIT.cheesecake_cafe_panela){
    RECIPE_UNIT.cheesecake_cafe_panela = {
      unitIngredients: [
        { key:"Galleta de leche triturada (g)", qty:25 },
        { key:"Mantequilla derretida (g)", qty:10 },
        { key:"Queso crema (g)", qty:75 },
        { key:"Crema de leche (ml)", qty:41.66 },
        { key:"Leche condensada (g)", qty:25 },
        { key:"Café molido (g)", qty:2.5 },
        { key:"Panela rallada (g)", qty:3.33 },
        { key:"Gelatina sin sabor (g)", qty:1.66 },
        { key:"Agua total (ml)", qty:17.5 },
        { key:"Vainilla (ml)", qty:0.33 },
        { key:"Sal (g)", qty:0.08 },
        { key:"Envase plástico (unidad)", qty:1 },
        { key:"Cuchara plástica (unidad)", qty:1 },
      ],
      steps: [
        { type:"batch_ingredients" },

        { type:"normal", text:"Tritura las galletas de leche hasta que queden bien finas (tipo arena).", img:"assets/steps/cheesecake/step01.webp" },
        { type:"normal", text:"Mezcla la galleta triturada con la mantequilla derretida hasta que compacte.", img:"assets/steps/cheesecake/step02.webp" },
        { type:"normal", text:"Pon 25 g en cada vasito y compacta firmemente para formar la base.", img:"assets/steps/cheesecake/step03.webp" },
        { type:"timer_base", text:"Refrigera la base 30 min. (Inicia el temporizador para continuar).", img:"assets/steps/cheesecake/step04.webp" },

        { type:"normal", text:"Prepara el café usando {{COFFEE_WATER_ML}} ml de agua.", img:"assets/steps/cheesecake/step05.webp" },   // Paso 6
        { type:"normal", text:"Añade la panela rallada al café caliente y mezcla hasta disolver.", img:"assets/steps/cheesecake/step06.webp" }, // Paso 7
        { type:"normal", text:"Mezcla queso crema, crema de leche, leche condensada, vainilla, sal y el café con panela (a temperatura ambiente) hasta integrar.", img:"assets/steps/cheesecake/step07.webp" }, // Paso 8

        { type:"normal", text:"Calienta agua tibia sin hervir.", img:"assets/steps/cheesecake/step08.webp" }, // Paso 9
        { type:"normal", text:"Añade la gelatina sin sabor y revuelve hasta disolver por completo.", img:"assets/steps/cheesecake/step09.webp" }, // Paso 10
        { type:"normal", text:"Incorpora la gelatina disuelta poco a poco mientras mezclas.", img:"assets/steps/cheesecake/step10.webp" }, // Paso 11

        { type:"normal", text:"Sirve 150 ml de mezcla en cada vasito, sobre la base.", img:"assets/steps/cheesecake/step11.webp" }, // Paso 12
        { type:"normal", text:"Refrigera mínimo 8 horas o toda la noche.", img:"assets/steps/cheesecake/step12.webp" }, // Paso 13
        { type:"normal", text:"Decora espolvoreando harina/galleta de leche con la forma del logo.", img:"assets/steps/cheesecake/step13.webp" }, // Paso 14

        { type:"final", text:"¡Listo! Revisa presentación y deja el área limpia.", img:"assets/steps/cheesecake/step14.webp" }, // Paso 15
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
  const btnTogglePin = $("btnTogglePin");
  const chkRemember = $("chkRemember");
  const btnLogin = $("btnLogin");
  const loginErr = $("loginErr");

  const btnLogout = $("btnLogout");
  const btnRefresh = $("btnRefresh");
  let btnShopping = $("btnShopping"); // se crea si no existe
  let btnCosts = $("btnCosts"); // si no existe, se crea

  const todayWrap = $("todayWrap");
  const tomorrowWrap = $("tomorrowWrap");
  const inProgressWrapAll = $("inProgressWrapAll");
  const inProgressWrapToday = $("inProgressWrapToday");
  const inProgressWrapOlder = $("inProgressWrapOlder");
  const backlogWrap = $("backlogWrap");
  const doneWrap = $("doneWrap");

  // Tabs Producción (Hoy / Pendientes pagados)
  const tabProdToday = $("tabProdToday");
  const tabProdBacklog = $("tabProdBacklog");
  const prodPanelToday = $("prodPanelToday");
  const prodPanelBacklog = $("prodPanelBacklog");

  // Tabs En proceso (Del día / Anteriores)
  const tabInProgAll = $("tabInProgAll");
  const tabInProgToday = $("tabInProgToday");
  const tabInProgOlder = $("tabInProgOlder");
  const inProgPanelAll = $("inProgPanelAll");
  const inProgPanelToday = $("inProgPanelToday");
  const inProgPanelOlder = $("inProgPanelOlder");

  function setProdTab(which){
    const isToday = which === "today";
    tabProdToday?.classList.toggle("active", isToday);
    tabProdBacklog?.classList.toggle("active", !isToday);
    prodPanelToday?.classList.toggle("hidden", !isToday);
    prodPanelBacklog?.classList.toggle("hidden", isToday);
  }

  
  function setInProgTab(which){
    const isAll = which === "all";
    const isToday = which === "today";
    const isOlder = which === "older";

    tabInProgAll?.classList.toggle("active", isAll);
    tabInProgToday?.classList.toggle("active", isToday);
    tabInProgOlder?.classList.toggle("active", isOlder);

    inProgPanelAll?.classList.toggle("hidden", !isAll);
    inProgPanelToday?.classList.toggle("hidden", !isToday);
    inProgPanelOlder?.classList.toggle("hidden", !isOlder);
  }

  tabInProgAll?.addEventListener("click", ()=>setInProgTab("all"));
  tabInProgToday?.addEventListener("click", ()=>setInProgTab("today"));
  tabInProgOlder?.addEventListener("click", ()=>setInProgTab("older"));

tabProdToday?.addEventListener("click", ()=>setProdTab("today"));
  tabProdBacklog?.addEventListener("click", ()=>setProdTab("backlog"));


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
    recipesIndex: {},
    recipesLoaded: false,
    recipesLastUpdated: null,
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
      const raw = localStorage.getItem(LS_KEY);
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
    // Importante: "hoy" es el día calendario (Bogotá), incluso si no es laboral.
    // Los pedidos se asignan a su día de producción con computeProductionDayKeyForOrder().
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
    return normalizeItemsFromAnyOrder(order);
  }
  function aggregateByProduct(orders){
    const map=new Map();
    for(const o of (orders||[])){
      for(const it of normalizeItemsFromOrder(o)){
        map.set(it.id,(map.get(it.id)||0)+it.qty);
      }
    }
        try{
      const unknownKeys = [...map.keys()].filter(k=>!KNOWN_PRODUCT_IDS.has(String(k)));
      if(unknownKeys.length) console.warn('AMARED: IDs de productos desconocidos en pedido(s):', unknownKeys);
    }catch(_e){}
    return map;
  }
  function aggregateByProductRemaining(orders){
    const map=new Map();
    for(const o of (orders||[])){
      const day=String(o.__prod_day||state.todayKey||"");
      const oid=String(o.order_id||"");
      for(const it of normalizeItemsFromOrder(o)){
        if(isOrderProductDone(day, oid, it.id)) continue;
        map.set(it.id,(map.get(it.id)||0)+it.qty);
      }
    }
    return map;
  }
  function aggregateByProductDone(orders){
    const map=new Map();
    for(const o of (orders||[])){
      const day=String(o.__prod_day||state.todayKey||"");
      const oid=String(o.order_id||"");
      for(const it of normalizeItemsFromOrder(o)){
        if(!isOrderProductDone(day, oid, it.id)) continue;
        map.set(it.id,(map.get(it.id)||0)+it.qty);
      }
    }
    return map;
  }

  function getOrderIdsThatContainProduct(orders,pid){
    const ids=[];
    for(const o of (orders||[])){
      const day=String(o.__prod_day||state.todayKey||"");
      const oid=String(o.order_id||"");
      if(isOrderProductDone(day, oid, pid)) continue;
      if(normalizeItemsFromOrder(o).some(it=>it.id===pid && it.qty>0)) ids.push(String(o.order_id));
    }
    return ids;
  }

  // ========= DONE / TIMERS (LOCAL) =========
// Guardamos progreso por día y por producto en CANTIDAD (no boolean).
// Así, si llegan pedidos nuevos (más unidades), el postre vuelve a aparecer como pendiente.
const getDoneMap=()=>{ const r=localStorage.getItem(LS_DONE_KEY); const o=r?safeJsonParse(r):null; return (o&&typeof o==="object")?o:{}; };
const setDoneMap=(o)=> localStorage.setItem(LS_DONE_KEY, JSON.stringify(o||{}));
const getDoneQty=(day,pid)=> Number(getDoneMap()?.[day]?.[pid]||0);
function setDoneQty(day,pid,qty){
  const m=getDoneMap(); if(!m[day]) m[day]={};
  m[day][pid]=Math.max(0, Number(qty||0));
  setDoneMap(m);
}
function addDoneQty(day,pid,delta){
  setDoneQty(day,pid, getDoneQty(day,pid) + Number(delta||0));
}

const getTimersMap=()=>{ const r=localStorage.getItem(LS_TIMER_KEY); const o=r?safeJsonParse(r):null; return (o&&typeof o==="object")?o:{}; };
const setTimersMap=(o)=> localStorage.setItem(LS_TIMER_KEY, JSON.stringify(o||{}));
const setTimerEnd=(day,pid,end)=>{ const m=getTimersMap(); if(!m[day]) m[day]={}; m[day][pid]=Number(end||0); setTimersMap(m); };
const getTimerEnd=(day,pid)=> Number(getTimersMap()?.[day]?.[pid]||0);
const clearTimer=(day,pid)=>{ const m=getTimersMap(); if(m?.[day]){ delete m[day][pid]; setTimersMap(m); } };


// Limpieza: mantener SOLO progreso del día actual (evita que "Finalizados" se arrastre al día siguiente)

// Progreso por pedido: qué productos ya se completaron (para NO marcar el pedido como LISTO hasta que termine todo)
const getOrderDoneMap=()=>{ const r=localStorage.getItem(LS_ORDER_DONE_KEY); const o=r?safeJsonParse(r):null; return (o&&typeof o==="object")?o:{}; };
const setOrderDoneMap=(o)=> localStorage.setItem(LS_ORDER_DONE_KEY, JSON.stringify(o||{}));
function isOrderProductDone(day, orderId, pid){
  const m=getOrderDoneMap(); return !!(m?.[day]?.[orderId]?.[pid]);
}
function setOrderProductDone(day, orderId, pid, val=true){
  const m=getOrderDoneMap();
  const d=String(day||""); const oid=String(orderId||""); const p=String(pid||"");
  if(!d || !oid || !p) return;
  if(!m[d]) m[d]={};
  if(!m[d][oid]) m[d][oid]={};
  if(val) m[d][oid][p]=true;
  else delete m[d][oid][p];
  setOrderDoneMap(m);
}
function clearOrderDoneDay(day){
  const m=getOrderDoneMap(); const d=String(day||"");
  if(m && d && m[d]){ delete m[d]; setOrderDoneMap(m); }
}
function pruneLocalProgressToDay_(keepDayKey){
  try{
    const dk = String(keepDayKey||"");
    // DONE
    const dm = getDoneMap();
    const ndm = {};
    if(dk && dm && dm[dk]) ndm[dk] = dm[dk];
    setDoneMap(ndm);

    // TIMERS
    const tm = getTimersMap();
    const ntm = {};
    if(dk && tm && tm[dk]) ntm[dk] = tm[dk];
    setTimersMap(ntm);

    // ORDER_DONE
    const om = getOrderDoneMap();
    const nom = {};
    if(dk && om && om[dk]) nom[dk] = om[dk];
    setOrderDoneMap(nom);
  }catch(e){
    console.warn("pruneLocalProgressToDay_ error:", e);
  }
}

// Observa cambio de día (Bogotá) incluso si la pestaña queda abierta.
// Si cambia el día, limpiamos progreso local y recargamos buckets.
function startDayRolloverWatch_(){
  let lastKey = String(state.todayKey||"");
  setInterval(async ()=>{
    try{
      const nowKey = String(getTodayProductionDayKey() || "");
      if(nowKey && nowKey !== lastKey){
        lastKey = nowKey;
        state.todayKey = nowKey;
        state.nextKey = getNextProductionDayKey(state.todayKey);

        // Regla pedida: a las 00:00 se limpia el progreso local (Finalizado operador)
        pruneLocalProgressToDay_(state.todayKey);

        // Refrescar UI/BD
        await refresh();
      }
    }catch(e){
      console.warn("day rollover watch error:", e);
    }
  }, 60_000); // cada 60s
}
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
  function isMobileViewport(){
    try{ return window.matchMedia("(max-width: 860px)").matches; }catch(_e){ return window.innerWidth <= 860; }
  }
  function syncActionBarsVisibility(){
    const headerBtns = btnRefresh?.parentElement;
    const appVisible = !!(app && app.style.display !== "none");
    const mobile = isMobileViewport();
    if(headerBtns){
      headerBtns.classList.toggle("isHidden", !appVisible || mobile);
    }
    if(mobileActionBar){
      mobileActionBar.classList.toggle("isHidden", !appVisible || !mobile);
    }
  }
  function showLogin(){
    if(loginBox) loginBox.style.display="block";
    if(app) app.style.display="none";
    if(btnLogout) btnLogout.style.display="none";
    if(btnRefresh) btnRefresh.style.display="none";
    if(btnShopping) btnShopping.style.display="none";
    if(btnCosts) btnCosts.style.display="none";
    if(btnHistory) btnHistory.style.display="none";
    syncActionBarsVisibility();
  }
  function showApp(){
    if(loginBox) loginBox.style.display="none";
    if(app) app.style.display="block";
    if(btnLogout) btnLogout.style.display="inline-flex";
    if(btnRefresh) btnRefresh.style.display="inline-flex";
    if(btnShopping) btnShopping.style.display="none";
    if(btnCosts) btnCosts.style.display="inline-flex";
    if(btnHistory) btnHistory.style.display="inline-flex";
    syncActionBarsVisibility();
  }
  function saveSession(){ sessionStorage.setItem(SS_KEY, JSON.stringify(state.session)); }
  function loadSession(){
    const raw=sessionStorage.getItem(SS_KEY);
    const s=raw? safeJsonParse(raw):null;
    if(s?.operatorId && s?.operatorLabel && s?.pin){ state.session=s; return true; }
    return false;
  }
  function saveRememberSession(){
    try{
      localStorage.setItem(LS_KEY, JSON.stringify(state.session));
    }catch(_e){}
  }
  function loadRememberSession(){
    try{
      const raw=localStorage.getItem(LS_KEY);
      const s=raw? safeJsonParse(raw):null;
      if(s?.operatorId && s?.operatorLabel && s?.pin){ return s; }
    }catch(_e){}
    return null;
  }
  function clearRememberSession(){
    try{ localStorage.removeItem(LS_KEY); }catch(_e){}
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

  async function fetchRecipesPublic(){
    // Lee la hoja RECETAS (solo lectura). Permite que la cocina siempre use cantidades actualizadas.
    const out = await apiTry({ action: "recipes_public_list" });
    if(out.ok!==true) throw new Error(out.error||"Falta habilitar recipes_public_list en el Worker/Apps Script.");
    const items = out.items || out.recipes || out.rows || [];
    const index = {};
    let last = null;

    for(const r of (Array.isArray(items)?items:[])){
      const did = String(r.dessert_id ?? r.dessertId ?? "").trim();
      if(!did) continue;

      const key = String(r.ingredient_key ?? r.ingredientKey ?? r.key ?? r.ingredient ?? "").trim();
      if(!key) continue;

      const qty = Number(r.qty_per_unit ?? r.qtyPerUnit ?? r.qty ?? r.quantity ?? 0) || 0;
      const unit = String(r.unit ?? "").trim().toLowerCase();
      if(!(qty>0) || !unit) continue;

      (index[did] ||= []).push({ ingredient_key: key, qty_per_unit: qty, unit });

      const u = r.updated_at || r.updatedAt || null;
      if(u && (!last || String(u) > String(last))) last = u;
    }

    state.recipesIndex = index;
    state.recipesLastUpdated = last;
    state.recipesLoaded = true;
  }


  // ========= RECETA / COSTOS LOTE =========
  function calcBatchIngredients(pid, units){
    const u = Number(units||0)||0;

    // ✅ Preferir siempre RECETAS (base de datos) si ya está cargado
    const dbList = (state.recipesIndex && Array.isArray(state.recipesIndex[pid])) ? state.recipesIndex[pid] : null;
    if(dbList){
      let totalCost = 0;
      const lines = [];
      for(const r of dbList){
        const key = String(r.ingredient_key || "").trim();
        if(!key) continue;
        const qty = (Number(r.qty_per_unit||0)||0) * u;
        const unit = String(r.unit || "").trim().toLowerCase();
        const ppu = Number(priceLookup(key) || 0) || 0; // COP por g/ml/unidad según COSTOS_INGREDIENTES
        const cost = qty * ppu;
        totalCost += cost;
        lines.push({ key, qty, unit, pricePerUnit: ppu, cost });
      }
      return { lines, totalCost };
    }

    // Fallback: receta embebida (si RECETAS no está disponible)
    const recipe = RECIPE_UNIT[pid];
    if(!recipe) return { lines:[], totalCost:0 };
    let totalCost = 0;
    const lines = (recipe.unitIngredients||[]).map(ing=>{
      const rawKey = String(ing.key||"").trim();
      const unitMatch = rawKey.match(/\(([^)]+)\)\s*$/);
      const unit = unitMatch ? String(unitMatch[1]).trim().toLowerCase() : "";
      const key = rawKey.replace(/\s*\([^)]*\)\s*$/,"").trim() || rawKey;

      const qty = (Number(ing.qty||0)||0) * u;
      const ppu = Number(priceLookup(key) || 0) || 0;
      const cost = qty * ppu;
      totalCost += cost;
      return { key, qty, unit, pricePerUnit: ppu, cost };
    });

    return { lines, totalCost };
  }

  // ========= DATA LOAD =========
  async function loadData(myNonce){
    if(!state.session.pin) throw new Error("Unauthorized admin");
    state.todayKey=getTodayProductionDayKey();
    state.nextKey=getNextProductionDayKey(state.todayKey);
    pruneLocalProgressToDay_(state.todayKey);

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
    const inProgDb = paid.filter(o=>normStatus(o.kitchen_status)==="en proceso");
    const doneDb = paid
      .filter(o=>normStatus(o.kitchen_status)==="listo")
      .filter(o=>{
        // ✅ Solo finalizados del día (hora Colombia)
        const raw = String(o.kitchen_done_at || o.kitchen_done || "");
        if(raw){
          const d = new Date(raw);
          if(!Number.isNaN(d.getTime())){
            const key = getBogotaParts(d).key;
            return key === state.todayKey;
          }
        }
        // fallback: si no hay timestamp, usar día de producción
        return o.__prod_day === state.todayKey;
      });
    const pending = todayAll.filter(o=>{ const ks=normStatus(o.kitchen_status); return ks!=="en proceso" && ks!=="listo"; });

    // Informativo (próxima producción): pedidos cuyo día de producción es state.nextKey
    const infoTomorrow = paid.filter(o=>{
      const ks=normStatus(o.kitchen_status);
      if(ks==="en proceso" || ks==="listo") return false;
      return String(o.__prod_day||"") === String(state.nextKey||"");
    });

    state.buckets.today=pending;
    state.buckets.infoTomorrow=infoTomorrow;
    state.buckets.inProgress=inProgDb;
    state.buckets.inProgressAll = inProgDb || [];

    // Separación En proceso: del día vs anteriores
    state.buckets.inProgressToday = (inProgDb||[]).filter(o=>String(o.__prod_day||"")===String(state.todayKey||""));
    state.buckets.inProgressOlder = (inProgDb||[]).filter(o=>String(o.__prod_day||"")!==String(state.todayKey||""));
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
      body{
        background:
          radial-gradient(900px 420px at 20% 5%, rgba(242,91,143,.10), transparent 60%),
          radial-gradient(900px 420px at 80% 8%, rgba(246,186,96,.12), transparent 60%),
          var(--cream);
      }
      .hidden{ display:none !important; }
      .topbar{
        position: sticky;
        top: 0;
        z-index: 45;
      }
      .topbarInner{
        max-width: 1180px;
        gap: 16px;
      }
      .brandRow{
        gap: 12px;
        min-width: 0;
      }
      .brandLogo2{
        width: 50px;
        height: 50px;
      }
      .ttl{
        font-size: clamp(20px, 2vw, 22px);
        letter-spacing: .02em;
      }
      .sub{
        font-size: 13px;
        line-height: 1.25;
      }
      #loginBox{
        max-width: 760px !important;
        border-radius: 28px;
        box-shadow: 0 20px 48px rgba(64,17,2,.10);
      }
      .layout{
        align-items: start;
        gap: 16px;
      }
      .card{
        border-radius: 26px;
      }
      .cardTitle{
        margin-bottom: 6px;
      }

      /* Menú de acciones */
      .header-actions{
        display:flex;
        align-items:center;
        gap:10px;
        flex-wrap:wrap;
        padding: 0;
        border-radius: 0;
        background: transparent;
        border: 0;
        box-shadow: none;
        backdrop-filter: none;
      }
      .header-actions.isHidden{ display:none !important; }
      .header-actions .btn{
        min-height: 42px;
        border-radius: 14px;
        padding: 10px 13px;
        display:inline-flex;
        align-items:center;
        justify-content:center;
        gap:7px;
        box-shadow:none;
      }
      .header-actions .btn .ico{
        display:inline !important;
        font-size:15px;
      }
      .header-actions .btn .txt{
        display:inline !important;
      }

      .amMobileBar{
        position: fixed !important;
        left: 12px;
        right: 12px;
        bottom: calc(env(safe-area-inset-bottom, 0px) + 10px) !important;
        z-index: 9999;
        display: grid;
        grid-template-columns: 58px minmax(0,1fr) 58px;
        gap: 10px;
        align-items: center;
        padding: 8px;
        border-radius: 26px;
        background: rgba(255,253,252,.96);
        border: 1px solid rgba(64,17,2,.08);
        box-shadow: 0 18px 34px rgba(64,17,2,.10);
        backdrop-filter: blur(12px);
      }
      .amMobileBar.isHidden{ display:none !important; }
      .amMobileAction{
        min-height: 56px;
        min-width: 56px;
        border: 1px solid rgba(64,17,2,.08);
        border-radius: 999px;
        background: rgba(255,255,255,.96);
        color: var(--choco);
        display:flex;
        align-items:center;
        justify-content:center;
        gap:0;
        padding: 0;
        font: inherit;
        font-weight: 900;
        cursor: pointer;
        box-shadow: inset 0 1px 0 rgba(255,255,255,.65);
      }
      .amMobileAction .ico{ font-size:20px; line-height:1; }
      .amMobileAction .txt{ display:none; }
      .amMobileAction.amDanger{ background: rgba(255,255,255,.96); }
      .amMobileAction:active{ transform: translateY(1px); }
      .amMobileCenter{
        min-width: 0;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
        padding: 6px;
        border-radius: 999px;
        background: rgba(255,255,255,.96);
        border: 1px solid rgba(64,17,2,.08);
        box-shadow: inset 0 1px 0 rgba(255,255,255,.65);
      }
      .amMobileSeg{
        min-width: 0;
        min-height: 50px;
        border: 0;
        border-radius: 999px;
        background: transparent;
        color: rgba(64,17,2,.78);
        display:flex;
        align-items:center;
        justify-content:center;
        padding: 0 14px;
        font: inherit;
        font-weight: 900;
        cursor: pointer;
        transition: background .15s ease, color .15s ease, transform .08s ease;
      }
      .amMobileSeg .ico{ display:none; }
      .amMobileSeg .txt{
        display:block;
        font-size: 16px;
        line-height: 1;
        white-space: nowrap;
      }
      .amMobileSeg.isPrimary{
        background: linear-gradient(180deg, rgba(248,221,228,.92), rgba(247,234,222,.96));
        color: var(--choco);
        box-shadow: inset 0 1px 0 rgba(255,255,255,.85);
      }
      .amMobileSeg:active{ transform: translateY(1px); }

      /* Tabs Producción */
      .prodTabs{ display:flex; gap:10px; flex-wrap:wrap; margin: 10px 0 12px; }
      .tabBtn{
        padding:10px 16px;
        border-radius:16px;
        border:1px solid rgba(64,17,2,.12);
        background: rgba(255,255,255,.78);
        font-weight:900;
        cursor:pointer;
        box-shadow: 0 6px 16px rgba(64,17,2,.04);
      }
      .tabBtn.active{
        background: rgba(246,186,96,.20);
        border-color: rgba(246,186,96,.55);
        box-shadow: none;
      }

      /* Cards de producto */
      .amCard{
        background: rgba(255,255,255,.92);
        border: 1px solid rgba(64,17,2,.08);
        border-radius: 20px;
        padding: 16px;
        box-shadow: 0 10px 20px rgba(64,17,2,.05);
        margin-bottom: 12px;
      }
      .amHead{
        display:flex;
        justify-content:space-between;
        align-items:center;
        gap:14px;
        cursor:pointer;
        user-select:none;
      }
      .amName{
        font-weight: 950;
        font-size: clamp(20px, 2vw, 24px);
        line-height: 1.1;
      }
      .amQty{
        font-weight: 950;
        font-size: clamp(34px, 3vw, 42px);
        line-height: 1;
        color: var(--choco);
      }
      .amPill{
        display:inline-flex;
        align-items:center;
        gap:8px;
        padding: 9px 14px;
        border-radius: 999px;
        background: rgba(64,17,2,.06);
        border: 1px solid rgba(64,17,2,.10);
        font-weight: 900;
      }
      .amBody{
        display:none;
        margin-top: 14px;
      }
      .amCard.open .amBody{ display:block; }

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
      .amActionRow{ display:flex; justify-content:flex-end; margin-top: 14px; }
      .amActionRow .btn{ width: 100%; justify-content:center; }

      /* Timer widget */
      .amStickyTimer{
        position:fixed;
        right: 18px;
        top: 88px;
        z-index: 99997;
        display:none;
        width: 232px;
      }
      .amStickyTimer .box{
        background: rgba(255,255,255,.94);
        border: 1px solid rgba(64,17,2,.14);
        border-radius: 20px;
        box-shadow: 0 16px 36px rgba(64,17,2,.10);
        padding: 14px;
        backdrop-filter: blur(8px);
      }
      .amStickyTimer .tTitle{ font-weight:950; font-size:13px; }
      .amStickyTimer .tTime{ font-weight:950; font-size:24px; margin-top:4px; }
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

      /* Historial modal */
      .histList{display:flex; flex-direction:column; gap:10px; margin-top:10px; }
      .histDay{background: rgba(255,255,255,.82); border:1px solid rgba(64,17,2,.12); border-radius:16px; padding:12px; }
      .histDay summary{cursor:pointer; font-weight:950; list-style:none; display:flex; align-items:center; justify-content:space-between; gap:10px; }
      .histDay summary::-webkit-details-marker{display:none; }

      /* ===== Costos modal scroll ===== */
      #costsModal{ align-items:flex-start; overflow:auto; -webkit-overflow-scrolling:touch; }
      #costsModal .modalBox{ max-height: calc(100vh - 32px); overflow:hidden; display:flex; flex-direction:column; }
      #costsModal #costsEditor{ flex:1; min-height:0; overflow:auto; -webkit-overflow-scrolling:touch; padding-right:6px; }
      #costsModal #costsGateErr{ flex:0 0 auto; }

      .histRows{margin-top:10px; display:flex; flex-direction:column; gap:8px; }
      .histRow{display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px 12px; border-radius:14px; background: rgba(255,255,255,.75); border:1px solid rgba(64,17,2,.08); }
      .histRow .n{font-weight:950; }
      .histRow .q{font-weight:950; font-size:22px; line-height:1; }
      .histMeta{margin-top:8px; font-size:12px; opacity:.7; }

      @media (min-width: 861px){
        .container{ padding-top: 16px; }
        .header-actions{
          justify-content:flex-end;
          min-width: fit-content;
        }
      }

      @media (max-width: 860px){
        .topbarInner{
          padding: 14px 16px;
        }
        .container{
          padding: 14px;
        }
        #app{
          padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 94px);
        }
        .layout{
          gap: 14px;
        }
        .card{
          border-radius: 22px;
          padding: 16px;
        }
        .amStickyTimer{
          right: 12px;
          top: 76px;
          width: 208px;
        }
        .header-actions{
          display:none !important;
        }
      }

      @media (max-width: 640px){
        .topbarInner{
          justify-content:flex-start !important;
          align-items:flex-start;
        }
        .brandRow{
          width: 100%;
        }
        .brandLogo2{
          width: 46px;
          height: 46px;
        }
        .ttl{
          font-size: 18px;
        }
        .sub{
          font-size: 11.5px;
        }
        #loginBox{
          margin-top: 10px !important;
          border-radius: 22px;
        }
        .prodTabs{
          gap: 8px;
        }
        .tabBtn{
          flex: 1 1 auto;
          justify-content:center;
          text-align:center;
          padding: 10px 12px;
        }
        .amCard{
          padding: 14px;
          border-radius: 18px;
        }
        .amHead{
          align-items:flex-start;
        }
        .amName{
          font-size: 17px;
        }
        .amQty{
          font-size: 24px;
        }
        .amPill{
          padding: 8px 11px;
          font-size: 12.5px;
        }
      }

      @media (min-width: 861px){
        .amMobileBar{ display:none !important; }
      }
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
    const byProd = (opts&&opts.showAction) ? aggregateByProductRemaining(orders) : aggregateByProduct(orders);
    const dayKey = (opts && opts.dayKey) ? String(opts.dayKey) : String(state.todayKey);

    // Decide qué mostrar en cada bloque: ocultar los hechos (local) arriba
    const cards=[];
    for(const p of PRODUCTS){
      const qty=byProd.get(p.id)||0;
      if(qty<=0) continue;

      const doneQty = getDoneQty(dayKey, p.id);
      const doneLocal = (qty>0) && (doneQty >= qty);
      const partial = (doneQty > 0) && (doneQty < qty);
      // Nota: no ocultamos tarjetas en Producción/En proceso por progreso local; siempre se muestran si hay pedidos.

      cards.push(`
        <div class="amCard" data-pid="${escapeHtml(p.id)}" data-units="${qty}">
          <div class="amHead" role="button" tabindex="0" aria-expanded="false">
            <div style="min-width:0;">
              <div class="amName">${escapeHtml(p.name)}</div>
              <div class="muted small" style="margin-top:8px;">${escapeHtml(badgeText||"")}</div>
            </div>
            <div style="display:flex; flex-direction:column; align-items:flex-end; gap:10px;">
              <div class="amQty">${qty}</div>
              <div class="amPill">${(opts&&opts.mode==="info") ? "Ver" : (showAction ? "Ver" : (doneLocal ? "✅ Hecho" : (partial ? ("Hecho " + fmtQty(doneQty) + "/" + qty) : "Ver")))} <span aria-hidden="true">▾</span></div>
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
      // Diagnóstico visible: hay pedidos pero no se pueden construir tarjetas (productos no detectados)
      if((orders||[]).length){
        const o0 = orders[0] || {};
        let byList = "";
        try{
          const by = aggregateByProduct(orders||[]);
          byList = [...by.entries()].map(([k,v])=>`${k}: ${v}`).join(", ");
        }catch(_e){}
        const diag = {
          order_id: getFieldAny_(o0,"order_id","orderid","id") ?? o0.order_id,
          created_at: getFieldAny_(o0,"created_at","createdat") ?? o0.created_at,
          kitchen_status: getFieldAny_(o0,"kitchen_status","kitchenstatus") ?? o0.kitchen_status,
          payment_status: getFieldAny_(o0,"payment_status","paymentstatus") ?? o0.payment_status,
          keys: Object.keys(o0||{}),
          items: getFieldAny_(o0,"items") ?? o0.items,
          items_json: getFieldAny_(o0,"items_json","itemsjson","items json","itemsJSON","itemsJson") ?? o0.items_json,
          items_text: getFieldAny_(o0,"items_text","itemstext","items text","itemsText") ?? o0.items_text,
        };
        container.innerHTML = `
          <div class="muted small" style="padding:8px 0;">
            Hay <b>${orders.length}</b> pedido(s) en esta sección, pero no se pudieron generar tarjetas de postres.
          </div>
          <details style="background:rgba(255,255,255,.75); border:1px solid rgba(64,17,2,.12); border-radius:12px; padding:10px;">
            <summary style="cursor:pointer; font-weight:900;">Ver diagnóstico</summary>
            <div class="small muted" style="margin-top:8px;">Productos detectados: <b>${escapeHtml(byList||"(ninguno)")}</b></div>
            <pre style="white-space:pre-wrap; word-break:break-word; max-height:220px; overflow:auto; margin-top:10px; padding:10px; border-radius:10px; background:rgba(255,255,255,.92); border:1px solid rgba(64,17,2,.10);">${escapeHtml(JSON.stringify(diag,null,2))}</pre>
          </details>
        `;
        console.warn("AMARED DIAG (no cards)", diag, "byProd:", byList);
        return;
      }
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
          <div class="line" style="display:flex; justify-content:space-between; gap:12px; padding:10px 0; border-bottom:1px solid rgba(64,17,2,.08);">
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
      <style id="amRecipeCss">
        /* Unified recipe modal */
                #amTextCol{ min-height:0; overflow:hidden; }
        #amStepScroll{ min-height:0; padding-bottom:14px; }
        #amNav{ position:sticky; bottom:0; z-index:6; background:rgba(255,255,255,.92); }
#amUnifiedCard{ min-height:0; }
        #amStepScroll{ -webkit-overflow-scrolling: touch; }

        @media (max-width: 920px){
          /* Mobile: texto -> imagen -> botones (una sola sección) */
          #amUnifiedCard{
            grid-template-columns: 1fr !important;
            grid-template-areas: "text" "img" "nav" !important;
            grid-template-rows: minmax(0,1fr) auto auto !important;
          }
          #amNav{ justify-content:center !important; }
          #amNav .btn{ flex:1; max-width:260px; }
        }
      
        /* Nav alignment */
        #amNav{ justify-content:flex-end; }
        #amNav .btn{ min-width:160px; }
        @media (max-width: 920px){
          #amNav{ justify-content:center !important; }
          #amNav .btn{ min-width:140px; }
        }

        /* Desktop: botones abajo a la derecha */
        #amNav{ display:flex; gap:12px; justify-content:flex-end; max-width:520px; margin-left:auto; }
        #amNav .btn{ min-width:160px; }
        /* Móvil: botones centrados (bloque centrado con espacio entre) */
        @media (max-width: 920px){
          #amNav{ justify-content:space-between; margin:0 auto; max-width:420px; }
          #amNav .btn{ min-width:140px; flex:1; }
          #amStepScroll{ max-height:45vh; }
        }
</style>

      <div id="amRecipeOverlayV6" class="modalOverlay" aria-hidden="true" style="display:none;">
        <div class="modalBox" style="max-width:980px; max-height:calc(100vh - 32px); overflow:hidden; display:flex; flex-direction:column; position:relative;">
          <div class="rowBetween" style="align-items:flex-start;">
            <div style="min-width:0;">
              <div style="font-weight:950; font-size:18px;" id="amRecipeTitle">Receta</div>
              <div class="muted small" id="amRecipeSub" style="margin-top:6px;"></div>
              <div style="height:8px; border-radius:999px; background:rgba(64,17,2,.08); overflow:hidden; margin-top:10px;">
                <div id="amProgBar" style="width:0%; background:rgba(245,110,150,.9); border-radius:999px;"></div>
              </div>
            </div>

            <!-- Close (top-right) -->
            <button id="amRecipeClose" class="iconBtn" type="button" aria-label="Cerrar" title="Cerrar" style="position:absolute; top:14px; right:14px; z-index:5;">✕</button>
          </div>

          <div style="margin-top:12px; overflow:hidden; min-height:0;">
            <!-- Unified section -->
            <div id="amUnifiedCard" class="amCard"
              style="margin:0; overflow:hidden; min-height:0; display:grid; grid-template-columns:1.1fr .9fr; grid-template-areas:'text img' 'nav nav'; grid-template-rows:auto auto; gap:14px;">

              <!-- Text -->
              <div id="amTextCol" style="grid-area:text; display:flex; flex-direction:column; overflow:hidden; min-height:0; padding-bottom:6px;">
                <div class="rowBetween" style="flex:0 0 auto;">
                  <div class="pill" id="amStepCounter">Paso</div>
                  <div class="pill" id="amTimerInline" style="display:none;">⏱️ <span id="amTimerTxt"></span></div>
                </div>

                <div id="amStepScroll" style="overflow:auto; max-height:52vh; padding-right:6px; padding-bottom:18px; margin-top:12px; min-height:0;">
                  <div id="amStepText" style="font-weight:950; font-size:16px;"></div>
                  <div id="amStepHint" class="muted small" style="margin-top:10px;"></div>
                </div>
              </div>

              <!-- Image -->
              <div id="amImgCol" style="grid-area:img; min-height:0; display:flex; align-items:center; justify-content:center; overflow:hidden;">
                <img id="amStepImg" alt="" style="width:100%; max-object-fit:contain; border-radius:16px; border:1px solid rgba(64,17,2,.10); display:none;" />

                <div id="amFinalActions" style="display:none; margin-top:14px;">
                  <div class="rowBetween">
                    <button id="amFinishPostre" class="btn secondary" type="button">Finalizar postre</button>
                    <button id="amFinishLote" class="btn primary" type="button">Finalizar lote</button>
                  </div>
                </div>
              </div>

              <!-- Nav -->
              <div id="amNav" class="rowBetween" style="grid-area:nav; padding-top:12px; border-top:1px solid rgba(64,17,2,.08); background:rgba(255,255,255,.92); width:100%;">
                <button id="amPrev" class="btn secondary" type="button">← Anterior</button>
                <button id="amNextOrTimer" class="btn primary" type="button">Siguiente →</button>
              </div>

            </div>
          </div>
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
  
  function fmtDec2(n){
    const v = Number(n||0);
    return new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 }).format(v);
  }

  // Permite textos dinámicos en el paso a paso (tokens tipo {{TOKEN}})
  function applyStepVars(text, pid){
    let t = String(text || "");
    // Cheesecake: agua para preparar café (10 ml por postre)
    if(pid === "cheesecake_cafe_panela"){
      const units = Number(state?.recipe?.units || 0) || 0;
      const coffeeWater = units * 10; // ml por postre (según tu receta)
      t = t.replaceAll("{{COFFEE_WATER_ML}}", fmtDec2(coffeeWater));
    }
    return t;
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
    const img = $("amStepImg");
    const imgCol = document.getElementById("amImgCol");
    const card = document.getElementById("amUnifiedCard");
    if(!img || !card) return;
    card.style.height = "auto";

    function layoutWithImage(){
      if(imgCol) imgCol.style.display = "";
      card.style.gridTemplateColumns = "1.1fr .9fr";
      card.style.gridTemplateAreas = '"text img" "nav nav"';
      card.style.gridTemplateRows = "auto auto";
    }
    function layoutNoImage(){
      if(imgCol) imgCol.style.display = "none";
      card.style.gridTemplateColumns = "1fr";
      card.style.gridTemplateAreas = '"text" "nav"';
      card.style.gridTemplateRows = "auto auto";
    }

    img.onerror = () => {
      img.style.display = "none";
      img.src = "";
      layoutNoImage();
    };

    if(src){
      img.src = src;
      img.style.display = "block";
      layoutWithImage();
    }else{
      img.style.display = "none";
      img.src = "";
      layoutNoImage();
    }
  }

  function remainingProductsCount(){
    const todayAll = state.paidOrders.filter(o=>String(o.__prod_day||"")===String(state.todayKey||""));
    const normStatus = (v)=>String(v||"").trim().toLowerCase();
    // Contar por producto SOLO los pedidos que aún no están LISTO en BD
    const pending = todayAll.filter(o=>{ const ks=normStatus(o.kitchen_status); return ks!=="listo"; });
    const byProd = aggregateByProduct(pending);
    const needed = PRODUCTS.map(p=>p.id).filter(pid=>(byProd.get(pid)||0)>0);
    return needed.length;
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
    // Ocultar botones finales (se usa el mismo botón principal en el último paso)
    const btnPostre = $("amFinishPostre");
    const btnLote = $("amFinishLote");
    if(btnPostre) btnPostre.style.display="none";
    if(btnLote) btnLote.style.display="none";

    if(st?.type==="batch_ingredients"){
      const {lines,totalCost}=calcBatchIngredients(pid,state.recipe.units);
      const costText= totalCost>0?`$${money(totalCost)}`:"—";
      $("amStepText").textContent = "Ingredientes totales del lote";
      $("amStepHint").innerHTML =
        `<div class="pill" style="margin:10px 0;">Costo estimado: ${costText}</div>` +
        (lines||[]).map(li=>{
          const u = li.unit ? escapeHtml(li.unit) : "u";
          const qtyText = `${fmtQty(li.qty)} ${u}`;
          const ppuText = (Number(li.pricePerUnit||0)>0)
            ? `<span class="muted small" style="margin-left:8px;">($${money(li.pricePerUnit)}/${u})</span>`
            : `<span class="muted small" style="margin-left:8px;">(sin costo)</span>`;
          const lineCost = (Number(li.cost||0)>0) ? `$${money(li.cost)}` : "—";
          return `
            <div class="line" style="display:flex; justify-content:space-between; gap:12px; padding:10px 0; border-bottom:1px solid rgba(64,17,2,.08);">
              <span>${escapeHtml(li.key)}</span>
              <div style="text-align:right;">
                <div><b>${qtyText}</b> ${ppuText}</div>
                <div class="muted small">Total: ${lineCost}</div>
              </div>
            </div>`;
        }).join("");
      setRecipeImage("");
      nextBtn.disabled=false; nextBtn.textContent="Siguiente →"; nextBtn.onclick = onNextOrTimer;
      return;
    }

    $("amStepText").textContent = applyStepVars(st?.text || "", pid);
    $("amStepHint").textContent = "";

    if(st?.type==="timer_base"){
      $("amStepHint").textContent = "Se debe esperar el temporizador. Inícialo para poder continuar.";
      nextBtn.disabled=false;
      nextBtn.textContent = state.recipe.timerStarted ? "Siguiente →" : "Iniciar temporizador";
      // ✅ Si vienes del último paso, reestablecer comportamiento normal
      nextBtn.onclick = onNextOrTimer;
    }else if(st?.type==="final"){
      const remaining = remainingProductsCount();
      nextBtn.disabled=false;
      nextBtn.textContent = (remaining > 1) ? "Finalizar postre" : "Finalizar lote";
      nextBtn.onclick = (remaining > 1) ? ()=> finalizePostreFromOverlay() : ()=> finalizeLoteFromOverlay();
    }else{
      nextBtn.disabled=false;
      nextBtn.textContent="Siguiente →";
      // ✅ Importante: volver a comportamiento normal al retroceder pasos
      nextBtn.onclick = onNextOrTimer;
    }

    setRecipeImage(st?.img||"");
  }

  async function startBaseTimer(pid){
// ✅ Guardar trazabilidad en BD (por producto, JSON)
    try{
      showLoading("Iniciando temporizador…","Guardando hora de nevera");
      const ids = (state.recipe?.orderIds && state.recipe.orderIds.length) ? state.recipe.orderIds : getTodayOrderIds();
      if(ids.length){
        const r = await kitchenBulkUpdate(ids,{ base_fridge_started_at: JSON.stringify(buildProdStampPayload(pid)) });
        if(r && r.ok===false){ showAlert("No se pudo guardar la hora de nevera."); }
      hideLoading();

      }
    }catch(e){
      console.warn("No se pudo guardar base_fridge_started_at:", e);
      hideLoading();
    }

    
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

  async function onNextOrTimer(){
    const pid=state.recipe.productId; if(!pid) return;
    const steps=RECIPE_UNIT[pid]?.steps||[];
    const st=steps[state.recipe.stepIdx]||null;

    if(st?.type==="timer_base"){
      if(!state.recipe.timerStarted){
        await startBaseTimer(pid);
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
    const byProd=aggregateByProductRemaining(orders);
    const units=byProd.get(pid)||0;
    const ids=getOrderIdsThatContainProduct(orders,pid);
    if(ids.length===0) return;

    showLoading("Iniciando…","Marcando pedidos en proceso…");
    try{
      await kitchenBulkUpdate(ids,{ kitchen_status:"En proceso", kitchen_started_at: JSON.stringify(buildProdStampPayload(pid)) });
      await refresh();
      openRecipe(pid, ids, units);
    }catch(e){
      alert(e?.message||String(e));
    }finally{
      hideLoading();
    }
  }

  // ========= Finalizar postre/lote =========
  
  function getRequiredProductIdsForOrder_(order){
    const set=new Set();
    for(const it of normalizeItemsFromOrder(order||{})){
      if(it && it.id && (Number(it.qty)||0)>0) set.add(String(it.id));
    }
    return [...set];
  }
async function finalizePostreFromOverlay(){
    const pid=state.recipe.productId; if(!pid) return;
    const orderIds=(state.recipe?.orderIds||[]).map(String);
    if(orderIds.length===0) return;

    const ok=await confirmWithDelay({
      title:"Finalizar postre",
      message:"Se marcará este postre como completado. Los pedidos que aún tengan otro postre pendiente seguirán en proceso.",
      seconds:2,
      okText:"Finalizar"
    });
    if(!ok) return;

    // 1) Marcar localmente este producto como listo por pedido
    const day=String(state.todayKey||"");
    for(const oid of orderIds){
      setOrderProductDone(day, oid, pid, true);
    }
    clearTimer(day, pid);

    // 2) Pasar a LISTO en BD solo los pedidos que ya tengan TODOS sus productos listos
    const byId=new Map((state.paidOrders||[]).map(o=>[String(o.order_id||""), o]));
    const toListo=[];
    for(const oid of orderIds){
      const o=byId.get(String(oid));
      if(!o) continue;
      const req=getRequiredProductIdsForOrder_(o);
      if(!req.length) continue;
      const allDone=req.every(pp=>isOrderProductDone(String(o.__prod_day||day), String(oid), String(pp)));
      if(allDone) toListo.push(String(oid));
    }

    if(toListo.length){
      showLoading("Finalizando…","Marcando pedidos como LISTO…");
      try{
        const nowIso=new Date().toISOString();
        await kitchenBulkUpdate(toListo,{
          kitchen_status:"Listo",
          kitchen_done_at: nowIso,
          kitchen_done_by: state.session.operatorLabel||"COCINA",
        });
      }catch(e){
        alert(e?.message||String(e));
      }finally{
        hideLoading();
      }
    }

    closeRecipe();
    await refresh();
  }

  function getTodayOrderIds(){
    return state.paidOrders.filter(o=>o.__prod_day===state.todayKey).map(o=>String(o.order_id));
  }

  async function finalizeLoteFromOverlay(){
    const ids=(state.recipe?.orderIds && state.recipe.orderIds.length)? state.recipe.orderIds : getTodayOrderIds();
    if(ids.length===0) return;

    const ok=await confirmWithDelay({title:"Finalizar lote", message:"Esto cambiará a 'Listo' en la base de datos.", seconds:2, okText:"Finalizar lote"});
    if(!ok) return;

    showLoading("Finalizando lote…","Actualizando base de datos…");
    try{
      await kitchenBulkUpdate(ids,{kitchen_status:"Listo"});
      // Limpieza local: temporizadores + progreso por pedido/producto (cerramos el día).
      for(const p of PRODUCTS) clearTimer(state.todayKey, p.id);
      clearOrderDoneDay(state.todayKey);
      // (Opcional) también limpiar doneQty
      try{ const dm=getDoneMap(); delete dm[state.todayKey]; setDoneMap(dm); }catch(_e){}
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

    const normStatus = (v)=>String(v||"").trim().toLowerCase();
    const notDoneDb = (orders||[]).filter(o=>normStatus(o.kitchen_status)!=="listo");

    const byProd = aggregateByProductDone(notDoneDb);
    const cards=[];
    for(const p of PRODUCTS){
      const qty=byProd.get(p.id)||0;
      if(qty<=0) continue;

      const ids = getOrderIdsThatContainProduct(notDoneDb, p.id);

      cards.push(`
        <div class="amCard" data-pid="${escapeHtml(p.id)}" data-units="${qty}">
          <div class="amHead" role="button" tabindex="0" aria-expanded="false">
            <div style="min-width:0;">
              <div class="amName">${escapeHtml(p.name||p.id)}</div>
              <div class="muted small" style="margin-top:8px;">${escapeHtml(badge||"Finalizado (operador)")}</div>
            </div>
            <div style="display:flex; flex-direction:column; align-items:flex-end; gap:8px;">
              <div class="amQty">${fmtQty(qty)}</div>
              <div class="muted small">unidades</div>
              <div class="amPill">Ver <span aria-hidden="true">▾</span></div>
            </div>
          </div>
          <div class="amBody" data-loaded="0"><div class="muted small">Cargando ingredientes…</div></div>
        </div>
      `);
    }

    container.innerHTML = cards.length ? cards.join("") : ``;

    async function toggleCard(card){
      const head=card.querySelector(".amHead");
      const expanded=card.classList.toggle("open");
      if(head) head.setAttribute("aria-expanded", expanded?"true":"false");
      const body=card.querySelector(".amBody");
      if(!expanded || !body) return;

      if(body.getAttribute("data-loaded")==="1") return;
      body.setAttribute("data-loaded","1");

      const pid=card.getAttribute("data-pid");
      const units=Number(card.getAttribute("data-units")||0);

      // IDs asociados (solo referencia)
      const ids = getOrderIdsThatContainProduct(notDoneDb, pid);

      const {lines,totalCost}=calcBatchIngredients(pid,units);
      const costText= totalCost>0?`$${money(totalCost)}`:"—";
      const unitCost = (units>0 && totalCost>0) ? (totalCost/units) : 0;
      const unitText = unitCost>0?`$${money(unitCost)}`:"—";

      const ingHtml=(lines||[]).map(li=>`
        <div class="line" style="display:flex; justify-content:space-between; gap:12px; padding:10px 0; border-bottom:1px solid rgba(64,17,2,.08);">
          <span>${escapeHtml(li.key)}</span>
          <div>
            ${fmtQty(li.qty)} ${li.unit?escapeHtml(li.unit):""}
            ${li.pricePerUnit?`<span class="muted small" style="margin-left:8px;">($${money(li.pricePerUnit)}/${escapeHtml(li.unit||"u")})</span>`:`<span class="muted small" style="margin-left:8px;">(sin costo)</span>`}
          </div>
        </div>`).join("");

      body.innerHTML = `
        <div class="muted small" style="margin-bottom:10px;"><b>IDs:</b> ${ids.length?ids.map(x=>`<code>${escapeHtml(x)}</code>`).join(" "):"—"}</div>
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

    container.onclick=async(e)=>{
      const card=e.target.closest(".amCard"); if(!card) return;
      const head=e.target.closest(".amHead"); if(!head) return;
      await toggleCard(card);
    };

    container.addEventListener("keydown", async(e)=>{
      if(e.key!=="Enter" && e.key!==" ") return;
      const head=e.target.closest(".amHead"); if(!head) return;
      const card=head.closest(".amCard"); if(!card) return;
      e.preventDefault();
      await toggleCard(card);
    });
  }


  function renderFinalizadosDb(container, doneOrders){
    if(!container) return;
    injectStylesV6();
    const orders = Array.isArray(doneOrders) ? doneOrders : [];
    const byProd = aggregateByProduct(orders);

    const cards=[];
    for(const p of PRODUCTS){
      const qty=byProd.get(p.id)||0;
      if(qty<=0) continue;

      const ids = getOrderIdsThatContainProduct(orders, p.id);

      cards.push(`
        <div class="amCard" data-pid="${escapeHtml(p.id)}" data-units="${qty}">
          <div class="amHead" role="button" tabindex="0" aria-expanded="false">
            <div style="min-width:0;">
              <div class="amName">${escapeHtml(p.name||p.id)}</div>
              <div class="muted small" style="margin-top:8px;">Listo · ${ids.length} pedido(s)</div>
            </div>
            <div style="display:flex; flex-direction:column; align-items:flex-end; gap:8px;">
              <div class="amQty">${fmtQty(qty)}</div>
              <div class="muted small">unidades</div>
              <div class="amPill">Ver <span aria-hidden="true">▾</span></div>
            </div>
          </div>
          <div class="amBody" data-loaded="0"><div class="muted small">Cargando ingredientes…</div></div>
        </div>
      `);
    }

    container.innerHTML = cards.length ? cards.join("") : `<div class="muted small">Sin datos.</div>`;

    async function toggleCard(card){
      const head=card.querySelector(".amHead");
      const expanded=card.classList.toggle("open");
      if(head) head.setAttribute("aria-expanded", expanded?"true":"false");
      const body=card.querySelector(".amBody");
      if(expanded && body && body.getAttribute("data-loaded")!=="1"){
        body.setAttribute("data-loaded","1");
        const pid=card.getAttribute("data-pid");
        const units=Number(card.getAttribute("data-units")||0);
        const ids = getOrderIdsThatContainProduct(orders, pid);

        const {lines,totalCost}=calcBatchIngredients(pid,units);
        const costText= totalCost>0?`$${money(totalCost)}`:"—";
        const unitCost = (units>0 && totalCost>0) ? (totalCost/units) : 0;
        const unitText = unitCost>0?`$${money(unitCost)}`:"—";

        const ingHtml=(lines||[]).map(li=>`
          <div class="line" style="display:flex; justify-content:space-between; gap:12px; padding:10px 0; border-bottom:1px solid rgba(64,17,2,.08);">
            <span>${escapeHtml(li.key)}</span>
            <div>
              ${fmtQty(li.qty)} ${li.unit?escapeHtml(li.unit):""}
              ${li.pricePerUnit?`<span class="muted small" style="margin-left:8px;">($${money(li.pricePerUnit)}/${escapeHtml(li.unit||"u")})</span>`:`<span class="muted small" style="margin-left:8px;">(sin costo)</span>`}
            </div>
          </div>`).join("");

        body.innerHTML=`
          <div class="muted small" style="margin-bottom:10px;"><b>IDs:</b> ${ids.length?ids.map(x=>`<code>${escapeHtml(x)}</code>`).join(" "):"—"}</div>
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
      const u = li.unit ? escapeHtml(li.unit) : "u";
      const q = `${fmtQty(li.qty)} ${u}`;
      const ppu = (Number(li.pricePerUnit||0)>0)
        ? `<span class="muted small" style="margin-left:8px;">(${fmtMoney(li.pricePerUnit)}/${u})</span>`
        : `<span class="muted small" style="margin-left:8px;">(sin costo)</span>`;
      const lineCost = (Number(li.cost||0)>0) ? fmtMoney(Math.round(li.cost)) : "—";
      return `
        <div class="line" style="display:flex; justify-content:space-between; gap:12px; padding:10px 0; border-bottom:1px solid rgba(64,17,2,.08);">
          <span>${escapeHtml(li.key)}</span>
          <div style="text-align:right;">
            <div><b>${q}</b>${ppu}</div>
            <div class="muted small">Total: ${lineCost}</div>
          </div>
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
    renderProductCards(tomorrowWrap, state.buckets.infoTomorrow, {badgeText:`Informativo (${state.nextKey})`, showAction:false, mode:"info", dayKey: state.nextKey});
    renderProductCards(backlogWrap, state.buckets.backlog||[], {badgeText:"Pendientes pagados", showAction:true});

    // actualizar tabs con conteo y vista por defecto
    try{
      const cToday = (state.buckets.today||[]).length;
      const cBack  = (state.buckets.backlog||[]).length;
      const t1 = $("tabProdToday");
      const t2 = $("tabProdBacklog");
      if(t1) t1.textContent = `Hoy (${cToday})`;
      if(t2) t2.textContent = `Pendientes pagados (${cBack})`;
      if(cToday===0 && cBack>0) setProdTab("backlog");
      else setProdTab("today");
    }catch(_e){}

    renderProductCards(inProgressWrapAll, state.buckets.inProgressAll||[], {badgeText:"En proceso (todos)", showAction:true});
    renderProductCards(inProgressWrapToday, state.buckets.inProgressToday||[], {badgeText:"En proceso (del día)", showAction:true});
    renderProductCards(inProgressWrapOlder, state.buckets.inProgressOlder||[], {badgeText:"En proceso (anteriores)", showAction:true});

    // actualizar tabs En proceso con conteo
    try{
      const cA = (state.buckets.inProgressAll||[]).length;
      const cT = (state.buckets.inProgressToday||[]).length;
      const cO = (state.buckets.inProgressOlder||[]).length;
      if(tabInProgAll) tabInProgAll.textContent = `Todos (${cA})`;
      if(tabInProgToday) tabInProgToday.textContent = `Del día (${cT})`;
      if(tabInProgOlder) tabInProgOlder.textContent = `Anteriores (${cO})`;
      setInProgTab("all");
    }catch(_e){} 

    // Finalizados:
    if(doneWrap){
      doneWrap.innerHTML = `<div class="muted small" style="margin:6px 0 10px; font-weight:900;">Listo (BD)</div><div id="doneDbBlock"></div><div style="height:14px;"></div><div class="muted small" style="margin:6px 0 10px; font-weight:900;">Finalizado (operador)</div><div id="doneLocalBlock"></div>`;
      renderFinalizadosDb(document.getElementById("doneDbBlock"), state.buckets.doneDb);
      renderFinalizadosLocal(document.getElementById("doneLocalBlock"), state.paidOrders.filter(o=>String(o.__prod_day||"")===String(state.todayKey||"")), "Finalizado (operador)");
    }
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
      showLoading("Sincronizando…","Actualizando costos y recetas desde la base de datos.");
      // Asegurar RECETAS + COSTOS
      await Promise.all([
        fetchCostsPublic(),
        fetchRecipesPublic().catch(e=>{ console.warn("recipes_public_list:", e); })
      ]);
    }catch(e){
      costsGateErr.textContent = (e && e.message) ? e.message : "No se pudieron actualizar los costos.";
    }finally{
      hideLoading();
    }
    costsModal.style.display="flex";
      try{ costsModal.scrollTop=0; }catch(_e){}
      try{ costsEditor.scrollTop=0; costsEditor.style.overflow="auto"; }catch(_e){}
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
    injectStylesV6();

    const keys=Object.keys(state.pricesMap||{}).sort((a,b)=>a.localeCompare(b,"es"));
    const list=keys.map(k=>({k,v:Number(state.pricesMap[k]||0)})).sort((a,b)=>(b.v-a.v)||a.k.localeCompare(b.k,"es"));
    const ingHtml=list.map(it=>`
      <div class="line" style="display:flex; justify-content:space-between; gap:12px; padding:10px 0; border-bottom:1px solid rgba(64,17,2,.08);">
        <span>${escapeHtml(it.k)}</span>
        <div>$${money(it.v)}</div>
      </div>`).join("");

    const metaParts = [];
    metaParts.push(state.costsLastUpdated ? `Costos: ${escapeHtml(state.costsLastUpdated)}` : `Costos: —`);
    metaParts.push(state.recipesLastUpdated ? `Recetas: ${escapeHtml(state.recipesLastUpdated)}` : `Recetas: —`);
    const meta = `<div class="muted small" style="margin-bottom:10px;">Modo solo lectura · ${metaParts.join(" · ")}</div>`;

    // ====== Postres: costo unitario + desglose ======
    const dessertCards = (PRODUCTS||[])
      .filter(p=>p && p.id && p.id!=="arroz_con_leche")
      .map(p=>{
        const hasRecipe = state.recipesIndex && Array.isArray(state.recipesIndex[p.id]) && state.recipesIndex[p.id].length>0;
        const {lines,totalCost} = hasRecipe ? calcBatchIngredients(p.id, 1) : ({lines:[], totalCost:0});
        const unitText = totalCost>0 ? `$${money(totalCost)}` : "—";

        const body = (lines||[]).length ? (lines.map(li=>{
          const per = li.pricePerUnit ? `$${money(li.pricePerUnit)}/${escapeHtml(li.unit||"u")}` : "sin costo";
          const tot = (li.cost && li.cost>0) ? `$${money(li.cost)}` : "—";
          return `
            <div style="display:flex; justify-content:space-between; gap:12px; padding:10px 0; border-bottom:1px solid rgba(64,17,2,.08);">
              <div style="min-width:0;">
                <div style="font-weight:800;">${escapeHtml(li.key)}</div>
                <div class="muted small">${fmtQty(li.qty)} ${escapeHtml(li.unit||"")}</div>
              </div>
              <div style="text-align:right;">
                <div class="muted small">${per}</div>
                <div style="font-weight:900;">${tot}</div>
              </div>
            </div>`;
        }).join("")) : `<div class="muted small">Sin receta configurada para este postre.</div>`;

        return `
          <div class="amCard" data-pid="${escapeHtml(p.id)}" style="margin:0 0 10px 0;">
            <div class="amHead" role="button" tabindex="0" aria-expanded="false" style="align-items:center;">
              <div style="min-width:0;">
                <div class="amName">${escapeHtml(p.name||p.id)}</div>
                <div class="muted small" style="margin-top:6px;">Precio unitario estimado</div>
              </div>
              <div style="display:flex; flex-direction:column; align-items:flex-end; gap:8px;">
                <div class="pill" style="cursor:pointer; user-select:none;">
                  ${unitText} <span aria-hidden="true">▾</span>
                </div>
                <div class="muted small">toca para ver desglose</div>
              </div>
            </div>
            <div class="amBody dessertBreakdown" style="display:none;">
              <div class="rowBetween" style="margin-bottom:10px;">
                <div class="pill">Ingredientes por unidad</div>
                <div class="pill">Total: ${unitText}</div>
              </div>
              ${body}
            </div>
          </div>`;
      }).join("");

    const dessertsWrap = `
      <div class="amCard open" style="margin:0 0 14px 0;">
        <div class="rowBetween">
          <div style="font-weight:950;">Precio unitario por postre</div>
          <div class="pill">${(PRODUCTS||[]).filter(p=>p&&p.id&&p.id!=="arroz_con_leche").length} postres</div>
        </div>
        <div class="amBody" style="margin-top:10px; display:block;">
          ${dessertCards || `<div class="muted small">Sin datos.</div>`}
        </div>
      </div>
    `;

    const ingredientsWrap = `
      <div class="amCard open" style="margin:0;">
        <div class="rowBetween">
          <div style="font-weight:950;">Costos por unidad (ingredientes)</div>
          <div class="pill">${keys.length} items</div>
        </div>
        <div class="amBody" style="margin-top:10px; max-height:40vh; overflow:auto; display:block;">
          ${ingHtml||`<div class="muted small">Sin datos.</div>`}
        </div>
      </div>
    `;

    costsEditor.innerHTML = meta + `<div class="costsScroll">` + dessertsWrap + ingredientsWrap + `</div>`;

    // Toggle: clic en cualquier parte del postre (cabecera completa)
    const toggleCard = (card)=>{
      const head = card.querySelector('.amHead');
      const body = card.querySelector('.amBody');
      const open = card.classList.toggle('open');
      if(head) head.setAttribute('aria-expanded', open?'true':'false');
      if(body) body.style.display = open ? 'block' : 'none';
    };

    costsEditor.onclick = (e)=>{
      const head = e.target.closest('.amHead');
      if(!head) return;
      const card = head.closest('.amCard[data-pid]');
      if(!card) return;
      toggleCard(card);
    };

    costsEditor.addEventListener("keydown", (e)=>{
      if(e.key!=="Enter" && e.key!==" ") return;
      const head = e.target.closest('.amHead');
      if(!head) return;
      const card = head.closest('.amCard[data-pid]');
      if(!card) return;
      e.preventDefault();
      toggleCard(card);
    });
  }

  
  // ========= Historial (pedidos elaborados) =========
  let btnHistory = null;
  let mobileActionBar = null;
  let mBtnHistory = null;
  let mBtnCosts = null;
  let mBtnRefresh = null;
  let mBtnLogout = null;
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


  function ensureMobileActionBar(){
    if(mobileActionBar && document.body.contains(mobileActionBar)) return mobileActionBar;

    let bar = document.getElementById("amKitchenMobileBar");
    if(!bar){
      bar = document.createElement("div");
      bar.id = "amKitchenMobileBar";
      bar.className = "amMobileBar isHidden";
      bar.innerHTML = `
        <button id="mBtnRefresh" class="amMobileAction" type="button" aria-label="Actualizar">
          <span class="ico">↻</span><span class="txt">Actualizar</span>
        </button>
        <div class="amMobileCenter" aria-label="Acciones principales">
          <button id="mBtnHistory" class="amMobileSeg isPrimary" type="button">
            <span class="ico">🕘</span><span class="txt">Historial</span>
          </button>
          <button id="mBtnCosts" class="amMobileSeg" type="button">
            <span class="ico">💰</span><span class="txt">Costos</span>
          </button>
        </div>
        <button id="mBtnLogout" class="amMobileAction amDanger" type="button" aria-label="Salir">
          <span class="ico">◉</span><span class="txt">Salir</span>
        </button>`;
      document.body.appendChild(bar);
    }

    mobileActionBar = bar;
    mBtnLogout = bar.querySelector("#mBtnLogout");
    mBtnHistory = bar.querySelector("#mBtnHistory");
    mBtnCosts = bar.querySelector("#mBtnCosts");
    mBtnRefresh = bar.querySelector("#mBtnRefresh");
    return bar;
  }

  function wireMobileActionBar(){
    ensureMobileActionBar();
    if(mBtnLogout) mBtnLogout.onclick = (e)=>{ e.preventDefault(); onLogout(); };
    if(mBtnHistory) mBtnHistory.onclick = (e)=>{ e.preventDefault(); openHistoryModal(); };
    if(mBtnCosts) mBtnCosts.onclick = (e)=>{ e.preventDefault(); openCostsModal(); };
    if(mBtnRefresh) mBtnRefresh.onclick = (e)=>{ e.preventDefault(); refresh().catch(err=>alert(err?.message||String(err))); };
    syncActionBarsVisibility();
  }


// ========= Refresh =========
  async function refresh(){
    const myNonce=state.refreshNonce;
    showLoading("Cargando…","Actualizando pedidos…");
    try{ await fetchRecipesPublic(); }catch(_e){}
    try{ await fetchCostsPublic(); }catch(_e){}
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
      if(chkRemember?.checked){ saveRememberSession(); } else { clearRememberSession(); }

      showApp();

      // Costos: intentamos cargar al entrar (si falla, igual deja entrar)
      if(!state.costsLoaded){
        const costs = await apiTry({action:"costs_public_list"});
        if(costs.ok===true){
          await fetchCostsPublic();
        }
      }

      // Recetas: cargar cantidades desde la hoja RECETAS (solo lectura)
      if(!state.recipesLoaded){
        const rec = await apiTry({action:"recipes_public_list"});
        if(rec.ok===true){
          await fetchRecipesPublic();
        }
      }


      await refresh();
      startWidgetTicker();
    }catch(e){
      clearSession();
    clearRememberSession();
    if(chkRemember) chkRemember.checked=false;
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
    ensureMobileActionBar();

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

    // 2) sesión previa (manual: Recuérdame)
    const remembered = loadRememberSession();
    if(remembered){
      // Carga perfiles y trata de iniciar automáticamente
      inpPin.value = remembered.pin || "";
      if(chkRemember) chkRemember.checked = true;
      if(state.profilesLoaded){
        renderProfilesSelect(state.profiles, remembered.operatorId);
      }
      // Validación y entrada automática
      state.session = remembered;
      try{
        showLoading("Ingresando…","Validando sesión guardada…");
        await validatePinBestEffort(remembered.pin);
        showApp();
        await refresh();
        startWidgetTicker();
      }catch(_e){
        clearRememberSession();
        clearSession();
        showLogin();
      }finally{
        hideLoading();
      }
    }


    
    // Ver/ocultar PIN
    if(btnTogglePin && inpPin){
      btnTogglePin.onclick = ()=>{
        const isPass = inpPin.type === "password";
        inpPin.type = isPass ? "text" : "password";
        btnTogglePin.textContent = isPass ? "🙈" : "👁";
      };
    }

    if(btnLogin) btnLogin.onclick=onLogin;
    if(btnRefresh) btnRefresh.onclick=()=> refresh().catch(e=>alert(e?.message||String(e)));
    if(btnLogout) btnLogout.onclick=onLogout;
    if(btnCosts) btnCosts.onclick=openCostsModal;
    if(btnCloseCosts) btnCloseCosts.onclick=closeCostsModal;
    wireMobileActionBar();
    syncActionBarsVisibility();
    window.addEventListener("resize", syncActionBarsVisibility, { passive:true });
    window.addEventListener("orientationchange", syncActionBarsVisibility, { passive:true });
  }

  init().catch(err=>{
    console.error(err);
    alert("Error inicializando cocina: " + (err?.message||String(err)));
  });
  })();
