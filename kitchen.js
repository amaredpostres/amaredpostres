/* kitchen.js (REFactor V5) — AMARED Cocina
   V5:
   - Perfiles SOLO BD (sin fallback). Se cargan usando ADMIN_PIN (para no exponer PROFILES_SECRET).
     Flujo: escribe PIN (>=4) -> carga perfiles categoria "kitchen" -> selecciona perfil -> Ingresar.
   - Acordeón mejorado: sin imagen, nombre+cantidad grandes, abre/cierra con click, solo botón "Iniciar paso a paso".
   - Evita 429: debounce al cargar perfiles; cache de costos.
   - Paso a paso mantiene: timer obligatorio en paso de nevera, widget flotante, confirmación 2s, finalizar postre/lote.
   - Costos: action "costs_public_list" (Costos_Ingredientes) best-effort.
   - No toca Worker ni Apps Script.
*/
(() => {
  "use strict";
  const API_URL = "https://amared-orders.amaredpostres.workers.dev/";
  const TZ = "America/Bogota";
  const CUTOFF_HOUR = 15;
  const BASE_FRIDGE_MINUTES = 30;

  const SS_KEY = "AMARED_KITCHEN_SESSION_V5";
  const LS_TIMER_KEY = "AMARED_KITCHEN_TIMERS_V1";
  const LS_DONE_KEY  = "AMARED_KITCHEN_DONE_V1";

  const PRODUCTS = [
    { id: "mousse_maracuya", name: "Mousse de Maracuyá" },
    { id: "cheesecake_cafe_panela", name: "Cheesecake de café con panela" },
    { id: "arroz_con_leche", name: "Arroz con leche" },
  ];

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
        { type:"normal", text:"Sirve la mezcla en los vasitos sobre la base.", img:"assets/steps/mousse/step09.webp" },
        { type:"normal", text:"Refrigera mínimo 8 horas o toda la noche.", img:"assets/steps/mousse/step10.webp" },
        { type:"normal", text:"Agregar chocorramo (20 g por postre).", img:"assets/steps/mousse/step11.webp" },
        { type:"normal", text:"Espolvorea chocolate con la forma del logo.", img:"assets/steps/mousse/step12.webp" },
        { type:"final", text:"¡Listo! Verifica presentación y limpieza del área.", img:"assets/steps/mousse/step13.webp" },
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
    };
  }
  if(!RECIPE_UNIT.arroz_con_leche){
    RECIPE_UNIT.arroz_con_leche = { unitIngredients: [], steps: [{ type:"batch_ingredients" }, { type:"final", text:"Receta no activa." }] };
  }

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
  const loadingSpin = $("loadingSpin"); // opcional

  const costsModal = $("costsModal");
  const btnCloseCosts = $("btnCloseCosts");
  const costsEditor = $("costsEditor");
  const costsGateErr = $("costsGateErr");

  const state = {
    session: { operatorId:null, operatorLabel:null, pin:null },
    profiles: null,
    profilesLoaded: false,
    profilesLoading: false,
    pricesMap: {},
    costsLoaded: false,
    costsLastUpdated: null,
    paidOrders: [],
    todayKey: null,
    nextKey: null,
    buckets: { today: [], infoTomorrow: [], inProgress: [], done: [] },
    recipe: { open:false, productId:null, orderIds:[], units:0, stepIdx:0, timerStarted:false },
    widgetTick: null,
    refreshNonce: 0,
    deb: { profilesTimer: null },
  };

  const safeJsonParse = (s)=>{ try{return JSON.parse(s);}catch{return null;} };
  const escapeHtml = (s)=> String(s??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
  const money = (n)=> Math.round(Number(n||0)).toLocaleString("es-CO");
  const fmtQty = (q)=> (Math.round(Number(q||0)*10)/10).toLocaleString("es-CO");

  function showLoading(title,msg){
    if(!loading) return;
    if(loadingSpin) loadingSpin.style.display="inline-block";
    loadingTitle.textContent = title || "Cargando…";
    loadingMsg.textContent = msg || "Procesando";
    loading.style.display="flex";
    loading.setAttribute("aria-hidden","false");
  }
  function hideLoading(){
    if(!loading) return;
    loading.style.display="none";
    loading.setAttribute("aria-hidden","true");
  }

  async function api(payload){
    const res = await fetch(API_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload||{})});
    const out = await res.json().catch(async()=>({ok:false,error: await res.text().catch(()=> "Error")}));
    if(!out || out.ok !== true) throw new Error(out?.error || "Error");
    return out;
  }
  async function apiTry(payload){ try{return await api(payload);}catch(e){ return {ok:false,error:String(e?.message||e)}; } }

  // ---- time Bogotá
  function getBogotaParts(date){
    const fmt = new Intl.DateTimeFormat("en-CA",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false});
    const parts = fmt.formatToParts(date);
    const get = (t)=> parts.find(p=>p.type===t)?.value;
    return { hh:Number(get("hour")), key:`${get("year")}-${get("month")}-${get("day")}` };
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

  // ---- orders
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
    return { byProduct: map };
  }
  function getOrderIdsThatContainProduct(orders,pid){
    const ids=[];
    for(const o of (orders||[])){
      if(normalizeItemsFromOrder(o).some(it=>it.id===pid && it.qty>0)) ids.push(String(o.order_id));
    }
    return ids;
  }

  // ---- costs normalization
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

  async function fetchCostsOnce(){
    if(state.costsLoaded) return;
    state.costsLoaded=true;
    const pin = state.session.pin || "";
    let out = await apiTry({action:"costs_public_list", admin_pin: pin});
    if(out.ok!==true) out = await apiTry({action:"costs_public_list"});
    if(out.ok===true){
      const items= out.items || out.costs || [];
      const map={}; let last=null;
      for(const r of items){
        const k = r.ingredient_key || r.key || r.ingredient || "";
        if(!k) continue;
        map[normalizeKey2(k)] = Number(r.cop_per_unit ?? r.copPerUnit ?? r.value ?? 0) || 0;
        const u = r.updated_at || r.updatedAt || null;
        if(u && (!last || String(u)>String(last))) last=u;
      }
      state.pricesMap=map; state.costsLastUpdated=last;
    }else{
      state.pricesMap={}; state.costsLastUpdated=null;
    }
  }

  // ---- profiles (solo BD)
  function renderProfilesSelect(list, selectedId){
    const arr=Array.isArray(list)?list:[];
    selOperator.innerHTML = `<option value="">Seleccionar…</option>` + arr.map(p=>`<option value="${escapeHtml(p.id)}">${escapeHtml(p.label)}</option>`).join("");
    if(selectedId) selOperator.value=selectedId;
  }
  async function fetchProfilesWithPin(pin){
    const out = await apiTry({action:"profiles_list", category:"kitchen", admin_pin: pin});
    if(out.ok!==true) throw new Error(out.error||"No se pudieron cargar perfiles.");
    const arr = out.profiles || out.items || [];
    const list = (Array.isArray(arr)?arr:[])
      .filter(p=>p && (p.id||p.profile_id) && p.label && (p.is_active===undefined || String(p.is_active)!=="false"))
      .map(p=>({id:String(p.id||p.profile_id), label:String(p.label)}));
    if(list.length===0) throw new Error("No hay perfiles activos en categoría cocina.");
    return list;
  }
  async function loadProfilesDebounced(){
    const pin=String(inpPin.value||"").trim();
    if(pin.length<4){
      state.profilesLoaded=false; state.profiles=null;
      renderProfilesSelect([], "");
      loginErr.textContent="Escribe el PIN (mín. 4 dígitos) para cargar perfiles.";
      return;
    }
    if(state.profilesLoading) return;
    state.profilesLoading=true;
    loginErr.textContent="";
    showLoading("Cargando perfiles…","Consultando perfiles de cocina.");
    try{
      const list = await fetchProfilesWithPin(pin);
      state.profiles=list; state.profilesLoaded=true;
      renderProfilesSelect(list, state.session.operatorId||"");
      loginErr.textContent="";
    }catch(e){
      state.profilesLoaded=false; state.profiles=null;
      renderProfilesSelect([], "");
      loginErr.textContent = e?.message || "No se pudieron cargar perfiles.";
    }finally{
      state.profilesLoading=false;
      hideLoading();
    }
  }
  function scheduleProfilesLoad(){
    clearTimeout(state.deb.profilesTimer);
    state.deb.profilesTimer=setTimeout(loadProfilesDebounced, 350);
  }

  // ---- session
  function saveSession(){ sessionStorage.setItem(SS_KEY, JSON.stringify(state.session)); }
  function loadSession(){
    const raw=sessionStorage.getItem(SS_KEY);
    const s=raw? safeJsonParse(raw):null;
    if(s?.operatorId && s?.operatorLabel && s?.pin){ state.session=s; return true; }
    return false;
  }
  function clearSession(){ sessionStorage.removeItem(SS_KEY); state.session={operatorId:null, operatorLabel:null, pin:null}; }
  function showLogin(){
    if(loginBox) loginBox.style.display="block";
    if(app) app.style.display="none";
    if(btnLogout) btnLogout.style.display="none";
    if(btnRefresh) btnRefresh.style.display="none";
  }
  function showApp(){
    if(loginBox) loginBox.style.display="none";
    if(app) app.style.display="block";
    if(btnLogout) btnLogout.style.display="inline-flex";
    if(btnRefresh) btnRefresh.style.display="inline-flex";
  }

  async function validatePinBestEffort(pin){
    const out = await apiTry({action:"validate_admin_pin", admin_pin: pin});
    if(out.ok===true) return true;
    if(String(out.error||"").toLowerCase().includes("unknown action")) return true;
    throw new Error("PIN inválido o no autorizado.");
  }

  // ---- local done/timers
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

  // ---- best-effort log (cocina_lotes)
  async function logLotEvent(eventType, extra){
    await apiTry({
      action:"kitchen_lot_log",
      admin_pin: state.session.pin || "",
      operator: state.session.operatorLabel || "COCINA",
      day_key: state.todayKey || "",
      event: eventType || "",
      product_id: state.recipe.productId || "",
      order_ids: (state.recipe.orderIds||[]).map(String),
      extra: extra || {},
    });
  }

  async function kitchenBulkUpdate(orderIds, patch){
    if(!Array.isArray(orderIds)||orderIds.length===0) return;
    await api({
      action:"kitchen_bulk_update",
      admin_pin: state.session.pin||"",
      operator: state.session.operatorLabel||"COCINA",
      order_ids: orderIds.map(String),
      patch: patch||{},
    });
  }

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

  async function loadData(myNonce){
    if(!state.session.pin) throw new Error("Unauthorized admin");
    state.todayKey=getTodayProductionDayKey();
    state.nextKey=getNextProductionDayKey(state.todayKey);

    showLoading("Cargando cocina…","Obteniendo pedidos…");

    const out = await api({action:"list_orders", payment_status:"Pagado", admin_pin: state.session.pin});
    if(myNonce!==state.refreshNonce) return;

    const paid=(out.orders||[]).map(o=>{ o.__prod_day=computeProductionDayKeyForOrder(o.created_at); return o; });
    state.paidOrders=paid;

    const todayAll = paid.filter(o=>o.__prod_day===state.todayKey);
    const inProg = todayAll.filter(o=>String(o.kitchen_status||"")==="En proceso");
    const done = todayAll.filter(o=>String(o.kitchen_status||"")==="Listo");
    const pending = todayAll.filter(o=>{ const ks=String(o.kitchen_status||""); return ks!=="En proceso" && ks!=="Listo"; });

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
    state.buckets.inProgress=inProg;
    state.buckets.done=done;
  }

  // ---- confirm overlay 2s
  function ensureConfirmOverlay(){
    if(document.getElementById("amConfirmOverlay")) return;
    const el=document.createElement("div");
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

  // ---- UI accordions
  function injectCardTweaks(){
    if(document.getElementById("amCardTweaksV5")) return;
    const st=document.createElement("style");
    st.id="amCardTweaksV5";
    st.textContent=`
      .pCard{ padding:14px; }
      .pHead{ display:flex; justify-content:space-between; gap:14px; align-items:center; cursor:pointer; }
      .pNameBig{ font-weight:950; font-size:18px; line-height:1.15; }
      .pQtyHuge{ font-weight:950; font-size:28px; }
      .accBody{ display:none; margin-top:12px; }
      .pCard.open .accBody{ display:block; }
    `;
    document.head.appendChild(st);
  }

  function renderProductAccordions(container, orders, opts){
    if(!container) return;
    injectCardTweaks();
    const { titlePill, showActions, showInformative } = opts||{};
    const agg=aggregateByProduct(orders);
    const cards=[];
    for(const p of PRODUCTS){
      const qty=agg.byProduct.get(p.id)||0;
      if(qty<=0) continue;
      const doneLocal=isProductDone(state.todayKey,p.id);
      cards.push(`
        <div class="pCard" data-pid="${escapeHtml(p.id)}" data-units="${qty}">
          <div class="pHead" role="button" tabindex="0" aria-expanded="false">
            <div style="min-width:0;">
              <div class="pNameBig">${escapeHtml(p.name)}</div>
              <div class="muted small" style="margin-top:6px;">${titlePill?escapeHtml(titlePill):""}</div>
            </div>
            <div style="display:flex; flex-direction:column; align-items:flex-end; gap:8px;">
              <div class="pQtyHuge">${qty}</div>
              <div class="pill">${doneLocal?"✅ Hecho":"Ver"} ▾</div>
            </div>
          </div>
          <div class="accBody" data-loaded="0"><div class="muted small">Cargando ingredientes…</div></div>
          ${showActions?`
            <div class="rowBetween" style="margin-top:12px;">
              <button class="btn primary" type="button" data-act="start" ${doneLocal?"disabled":""}>Iniciar paso a paso</button>
              ${doneLocal?`<div class="pill">Completado</div>`:`<div class="muted small"></div>`}
            </div>`:""}
          ${showInformative?`<div class="muted small" style="margin-top:10px;">* Informativo: no se inicia producción en esta vista.</div>`:""}
        </div>`);
    }
    if(cards.length===0){ container.innerHTML=`<div class="muted small" style="padding:8px 0;">Sin datos.</div>`; return; }
    container.innerHTML=cards.join("");

    const onToggle=async(card)=>{
      const head=card.querySelector(".pHead");
      const expanded=card.classList.toggle("open");
      if(head) head.setAttribute("aria-expanded", expanded?"true":"false");
      const body=card.querySelector(".accBody");
      if(expanded && body && body.getAttribute("data-loaded")!=="1"){
        body.setAttribute("data-loaded","1");
        const pid=card.getAttribute("data-pid");
        const units=Number(card.getAttribute("data-units")||0);
        const {lines,totalCost}=calcBatchIngredients(pid,units);
        const costText= totalCost>0?`$${money(totalCost)}`:"—";
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
            <div class="pill">Costo estimado: ${costText}</div>
          </div>
          ${ingHtml||`<div class="muted small">Sin receta configurada.</div>`}`;
      }
    };

    container.onclick=async(e)=>{
      const card=e.target.closest(".pCard"); if(!card) return;
      const btn=e.target.closest("button[data-act]");
      if(btn){
        if(btn.getAttribute("data-act")==="start"){
          const pid=card.getAttribute("data-pid");
          await startRecipeFlow(pid, orders);
        }
        return;
      }
      const head=e.target.closest(".pHead");
      if(head) await onToggle(card);
    };
    container.addEventListener("keydown", async(e)=>{
      if(e.key!=="Enter" && e.key!==" ") return;
      const head=e.target.closest(".pHead"); if(!head) return;
      const card=head.closest(".pCard"); if(!card) return;
      e.preventDefault(); await onToggle(card);
    });
  }

  function renderAll(){
    renderProductAccordions(todayWrap, state.buckets.today, {titlePill:`Producción ${state.todayKey}`, showActions:true});
    renderProductAccordions(tomorrowWrap, state.buckets.infoTomorrow, {titlePill:`Informativo (${state.nextKey})`, showActions:false, showInformative:true});
    renderProductAccordions(inProgressWrap, state.buckets.inProgress, {titlePill:"En proceso", showActions:true});
    renderProductAccordions(doneWrap, state.buckets.done, {titlePill:"Finalizados (DB)", showActions:false});
    renderFinalizeLotButton();
  }

  // ---- recipe overlay + timer widget (minimal but functional)
  function injectRecipeStyles(){
    if(document.getElementById("amRecipeStylesV5")) return;
    const st=document.createElement("style");
    st.id="amRecipeStylesV5";
    st.textContent=`
      .amRecipeGrid{ display:grid; grid-template-columns:1.1fr .9fr; gap:14px; margin-top:12px; }
      .amRecipeCard{ background:rgba(255,255,255,.88); border:1px solid rgba(64,17,2,.12); border-radius:18px; padding:14px; }
      .amProgress{ height:8px; border-radius:999px; background:rgba(64,17,2,.08); overflow:hidden; margin-top:10px; }
      .amProgress>div{ height:100%; width:0%; background:rgba(245,110,150,.9); border-radius:999px; }
      .amStepTitle{ font-weight:950; font-size:18px; }
      .amStepText{ margin-top:10px; font-weight:900; font-size:16px; }
      .amStickyTimer{ position:fixed; right:18px; top:78px; z-index:99997; display:none; }
      .amStickyTimer .pill{ box-shadow:var(--shadow); display:flex; gap:10px; align-items:center; }
      @media (max-width:900px){ .amRecipeGrid{ grid-template-columns:1fr; } .amStickyTimer{ top:68px; } }
    `;
    document.head.appendChild(st);
  }
  function ensureRecipeOverlay(){
    injectRecipeStyles();
    if(document.getElementById("amaredRecipeOverlay")) return;
    const wrap=document.createElement("div");
    wrap.innerHTML=`
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
              <div id="amStepHint" class="muted small" style="margin-top:8px;"></div>

              <div class="rowBetween" style="margin-top:14px;">
                <button id="amPrev" class="btn secondary" type="button">← Anterior</button>
                <button id="amNextOrTimer" class="btn primary" type="button">Siguiente →</button>
              </div>
            </div>

            <div class="amRecipeCard">
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
        </div>
      </div>

      <div id="amaredToast" class="pill" style="position:fixed; left:50%; transform:translateX(-50%); bottom:18px; z-index:99999; display:none;"></div>

      <div id="amStickyTimer" class="amStickyTimer">
        <div class="pill">
          <span>⏱️</span>
          <div style="display:flex; flex-direction:column; line-height:1.15;">
            <span style="font-weight:950; font-size:14px;" id="amStickyLabel">Temporizador</span>
            <span class="muted small" id="amStickyTime">00:00</span>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);
    $("amRecipeClose").onclick = onRecipeClose;
    $("amPrev").onclick = ()=> stepMove(-1);
    $("amNextOrTimer").onclick = onNextOrTimer;
    $("amFinishPostre").onclick = ()=> finalizePostreFromOverlay();
    $("amFinishLote").onclick = ()=> finalizeLoteFromOverlay();
  }
  function toast(msg){
    const el=$("amaredToast"); if(!el) return;
    el.textContent=msg; el.style.display="inline-flex";
    clearTimeout(el.__t); el.__t=setTimeout(()=>{ el.style.display="none"; }, 2200);
  }

  function openRecipe(pid, orderIds, units){
    ensureRecipeOverlay();
    const ov=$("amaredRecipeOverlay");
    ov.style.display="flex"; ov.setAttribute("aria-hidden","false");
    state.recipe={open:true, productId:pid, orderIds:orderIds||[], units:Number(units||0), stepIdx:0, timerStarted:false};
    renderRecipeStep();
  }
  function closeRecipe(){
    const ov=$("amaredRecipeOverlay");
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
  function onNextOrTimer(){
    const pid=state.recipe.productId; if(!pid) return;
    const steps=RECIPE_UNIT[pid]?.steps||[];
    const st=steps[state.recipe.stepIdx]||null;

    if(st?.type==="timer_base"){
      if(!state.recipe.timerStarted){
        startBaseTimer(pid);
        state.recipe.timerStarted=true;
        toast("⏱️ Temporizador iniciado. Ya puedes continuar.");
        renderRecipeStep();
        return;
      }
    }
    stepMove(1);
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
  function renderInlineTimer(pid){
    const pill=$("amTimerInline"); const txt=$("amTimerTxt");
    if(!pill||!txt) return;
    const end=getTimerEnd(state.todayKey,pid); const now=Date.now();
    if(end && end>now){ pill.style.display="inline-flex"; txt.textContent=msToMMSS(end-now); }
    else { pill.style.display="none"; txt.textContent=""; }
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

    const nextBtn=$("amNextOrTimer");
    const finalBox=$("amFinalActions");
    if(finalBox) finalBox.style.display = (st?.type==="final")? "block":"none";

    renderInlineTimer(pid);

    if(st?.type==="batch_ingredients"){
      const {lines,totalCost}=calcBatchIngredients(pid,state.recipe.units);
      const costText= totalCost>0?`$${money(totalCost)}`:"—";
      $("amStepText").textContent = "Ingredientes totales del lote";
      $("amStepHint").innerHTML = `<div class="pill" style="margin:10px 0;">Costo estimado: ${costText}</div>` +
        (lines||[]).map(li=>`
          <div class="line"><span>${escapeHtml(li.key)}</span><div>${fmtQty(li.qty)} ${li.pricePerUnit?`<span class="muted small" style="margin-left:8px;">($${money(li.pricePerUnit)}/u)</span>`:`<span class="muted small" style="margin-left:8px;">(sin costo)</span>`}</div></div>`).join("");
      setRecipeImage("");
      nextBtn.disabled=false; nextBtn.textContent="Siguiente →";
      return;
    }

    $("amStepText").textContent = st?.text || "";
    $("amStepHint").textContent = "";

    if(st?.type==="timer_base"){
      $("amStepHint").textContent = "Este paso exige temporizador. Inícialo para poder continuar.";
      nextBtn.disabled=false;
      nextBtn.textContent = state.recipe.timerStarted ? "Siguiente →" : "Iniciar temporizador";
    }else if(st?.type==="final"){
      nextBtn.disabled=true; nextBtn.textContent="Siguiente →";
    }else{
      nextBtn.disabled=false; nextBtn.textContent="Siguiente →";
    }

    setRecipeImage(st?.img||"");
  }

  function msToMMSS(ms){
    const s=Math.max(0,Math.floor(ms/1000));
    const mm=String(Math.floor(s/60)).padStart(2,"0");
    const ss=String(s%60).padStart(2,"0");
    return `${mm}:${ss}`;
  }
  function startBaseTimer(pid){
    const existing=getTimerEnd(state.todayKey,pid);
    const now=Date.now();
    if(existing && existing>now){ toast("⏱️ Ya hay un temporizador activo."); startWidgetTicker(); return; }
    const end=Date.now()+BASE_FRIDGE_MINUTES*60*1000;
    setTimerEnd(state.todayKey,pid,end);
    toast(`⏱️ Temporizador iniciado: ${BASE_FRIDGE_MINUTES} min`);
    startWidgetTicker();
  }
  function startWidgetTicker(){
    const w=$("amStickyTimer"); const label=$("amStickyLabel"); const time=$("amStickyTime");
    if(!w||!label||!time) return;
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
      label.textContent=prod?prod.name:"Temporizador";
      time.textContent=msToMMSS(top.end-now);
      w.style.display="block";
      if(state.recipe.open && state.recipe.productId) renderInlineTimer(state.recipe.productId);
    },250);
  }

  async function onRecipeClose(){
    const pid=state.recipe.productId;
    const ids=(state.recipe.orderIds||[]).slice();
    if(!pid || ids.length===0){ closeRecipe(); return; }
    if(isProductDone(state.todayKey,pid)){ closeRecipe(); return; }

    const ok = await confirmWithDelay({title:"Salir del paso a paso", message:"Esto revertirá el estado para que no aparezca como iniciado. ¿Deseas salir?", seconds:2, okText:"Salir y revertir"});
    if(!ok) return;

    showLoading("Revirtiendo…","Sincronizando estado.");
    try{
      await kitchenBulkUpdate(ids,{kitchen_status:""});
      await logLotEvent("cancel_step_by_step",{product_id:pid});
      await refresh();
      closeRecipe();
      toast("Revertido: no iniciado.");
    }catch(e){ alert(e?.message||String(e)); }
    finally{ hideLoading(); }
  }

  async function startRecipeFlow(pid, baseOrders){
    const orders=baseOrders||[];
    const agg=aggregateByProduct(orders);
    const units=agg.byProduct.get(pid)||0;
    const ids=getOrderIdsThatContainProduct(orders,pid);
    if(ids.length===0){ toast("No hay pedidos para este producto."); return; }

    showLoading("Iniciando…","Marcando pedidos en proceso…");
    try{
      await kitchenBulkUpdate(ids,{kitchen_status:"En proceso"});
      await logLotEvent("start_product",{product_id:pid, units});
      await refresh();
      openRecipe(pid, ids, units);
    }catch(e){ alert(e?.message||String(e)); }
    finally{ hideLoading(); }
  }

  async function finalizePostreFromOverlay(){
    const pid=state.recipe.productId; if(!pid) return;
    const ok=await confirmWithDelay({title:"Finalizar postre", message:"Marcarás este postre como HECHO en la vista.", seconds:2, okText:"Finalizar postre"});
    if(!ok) return;
    markProductDone(state.todayKey,pid,true);
    clearTimer(state.todayKey,pid);
    await logLotEvent("finish_product",{product_id:pid});
    toast("✅ Postre marcado como hecho.");
    closeRecipe(); renderAll();
    renderFinalizeLotButton();
  }
  function allProductsDoneForToday(){
    const todayAll = state.paidOrders.filter(o=>o.__prod_day===state.todayKey);
    const agg=aggregateByProduct(todayAll);
    const needed = PRODUCTS.map(p=>p.id).filter(pid=>(agg.byProduct.get(pid)||0)>0);
    if(needed.length===0) return false;
    return needed.every(pid=>isProductDone(state.todayKey,pid));
  }
  function getTodayOrderIds(){ return state.paidOrders.filter(o=>o.__prod_day===state.todayKey).map(o=>String(o.order_id)); }

  function renderFinalizeLotButton(){
    const existing=document.getElementById("amFinalizeLot");
    if(existing) existing.remove();
    if(!allProductsDoneForToday()) return;

    const btn=document.createElement("button");
    btn.id="amFinalizeLot";
    btn.className="btn primary";
    btn.type="button";
    btn.textContent="✅ Finalizar lote";
    btn.style.position="fixed";
    btn.style.right="18px";
    btn.style.bottom="18px";
    btn.style.zIndex="99998";
    btn.style.boxShadow="var(--shadow)";
    btn.onclick=async()=>{ await finalizeLote(); };
    document.body.appendChild(btn);
  }

  async function finalizeLoteFromOverlay(){ await finalizeLote(); }

  async function finalizeLote(){
    const ids=getTodayOrderIds();
    if(ids.length===0){ toast("No hay pedidos para finalizar."); return; }
    const ok=await confirmWithDelay({title:"Finalizar lote", message:"Esto pasará pedidos a Listo en la base de datos.", seconds:2, okText:"Finalizar lote"});
    if(!ok) return;

    showLoading("Finalizando lote…","Actualizando base de datos.");
    try{
      await kitchenBulkUpdate(ids,{kitchen_status:"Listo"});
      await logLotEvent("finish_lot",{day_key:state.todayKey});
      toast("✅ Lote finalizado.");
      closeRecipe();
      await refresh();
    }catch(e){ alert(e?.message||String(e)); }
    finally{ hideLoading(); }
  }

  // ---- Costs modal read-only
  function ensureCostsButton(){
    if(document.getElementById("btnCostsRO")) return;
    const headerBtns = btnRefresh?.parentElement;
    if(!headerBtns) return;
    const btn=document.createElement("button");
    btn.id="btnCostsRO";
    btn.className="btn secondary";
    btn.type="button";
    btn.textContent="Costos";
    btn.style.display="none";
    btn.onclick=openCostsModal;
    headerBtns.insertBefore(btn, btnRefresh);
    if(btnCloseCosts) btnCloseCosts.onclick=closeCostsModal;
  }
  function openCostsModal(){
    if(!costsModal) return;
    costsGateErr.textContent="";
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
    costsEditor.innerHTML = meta + `<div class="pCard open"><div class="rowBetween"><div style="font-weight:950;">Costos por unidad</div><div class="pill">${keys.length} items</div></div><div class="accBody" style="margin-top:10px; max-height:55vh; overflow:auto; display:block;">${html||`<div class="muted small">Sin datos.</div>`}</div></div>`;
  }

  async function refresh(){
    const myNonce=state.refreshNonce;
    try{ await loadData(myNonce); if(myNonce!==state.refreshNonce) return; renderAll(); }
    finally{ hideLoading(); }
  }

  async function onLogin(){
    loginErr.textContent="";
    const pin=String(inpPin.value||"").trim();
    if(pin.length<4){ loginErr.textContent="Escribe el PIN."; return; }

    if(!state.profilesLoaded) await loadProfilesDebounced();
    if(!state.profilesLoaded || !Array.isArray(state.profiles) || state.profiles.length===0){
      loginErr.textContent="No hay perfiles cargados. Revisa el PIN o la conexión.";
      return;
    }

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
      ensureCostsButton();

      await fetchCostsOnce();
      const btnCostsRO=document.getElementById("btnCostsRO");
      if(btnCostsRO) btnCostsRO.style.display="inline-flex";

      await refresh();
      startWidgetTicker();
    }catch(_e){
      clearSession();
      showLogin();
      loginErr.textContent="PIN inválido o no autorizado.";
    }finally{ hideLoading(); }
  }

  function onLogout(){
    state.refreshNonce++;
    clearSession();
    closeRecipe();
    closeCostsModal();

    state.profilesLoaded=false;
    state.profilesLoading=false;
    state.profiles=null;
    renderProfilesSelect([], "");

    state.costsLoaded=false;
    state.pricesMap={};
    state.costsLastUpdated=null;

    if(loginErr) loginErr.textContent="";
    if(inpPin) inpPin.value="";
    if(selOperator) selOperator.value="";

    showLogin();

    const btnCostsRO=document.getElementById("btnCostsRO");
    if(btnCostsRO) btnCostsRO.style.display="none";
  }

  async function init(){
    ensureRecipeOverlay();
    ensureConfirmOverlay();
    ensureCostsButton();

    renderProfilesSelect([], "");
    showLogin();
    loginErr.textContent="Escribe el PIN (mín. 4 dígitos) para cargar perfiles.";

    if(inpPin){
      inpPin.addEventListener("input", scheduleProfilesLoad);
      inpPin.addEventListener("blur", loadProfilesDebounced);
      inpPin.addEventListener("keydown", (e)=>{ if(e.key==="Enter") onLogin(); });
    }

    if(loadSession()){
      inpPin.value=state.session.pin||"";
      await loadProfilesDebounced();
      if(state.profilesLoaded){
        renderProfilesSelect(state.profiles, state.session.operatorId);
        const label=state.profiles.find(p=>p.id===state.session.operatorId)?.label;
        if(label){ state.session.operatorLabel=label; saveSession(); }
      }
      showApp();
      const btnCostsRO=document.getElementById("btnCostsRO");
      if(btnCostsRO) btnCostsRO.style.display="inline-flex";
      try{
        await fetchCostsOnce();
        await refresh();
        startWidgetTicker();
      }catch(_e){
        onLogout();
      }
    }

    if(btnLogin) btnLogin.onclick=onLogin;
    if(btnRefresh) btnRefresh.onclick=()=> refresh().catch(e=>alert(e?.message||String(e)));
    if(btnLogout) btnLogout.onclick=onLogout;
    if(btnCloseCosts) btnCloseCosts.onclick=closeCostsModal;
  }

  init().catch(err=>{
    console.error(err);
    alert("Error inicializando cocina: " + (err?.message||String(err)));
  });
})();
