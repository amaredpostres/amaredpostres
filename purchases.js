/* AMARED Purchases - client (v3)
   ✅ Ventana de pedidos: ayer 3:00 p.m. → hoy 3:00 p.m. (backend)
   ✅ Sección "Pedidos después de las 3:00 p.m." (backend.late)
   ✅ Resumen de postres confirmados (usados para el cálculo)
   ✅ Inventario + compras en unidad base (g/ml) usando COSTOS_INGREDIENTES
   ✅ Detalle/edición rápida de COSTOS_INGREDIENTES desde Purchases
*/
"use strict";

const API_URL = "https://amared-orders.amaredpostres.workers.dev/";
const LS_SECRET_KEY = "AMARED_COSTS_SECRET";

let UNLOCKED_SECRET = "";
let state = {
  items: [],          // costs_list (rows)
  costsByKey: {},     // ingredient_key -> item
  inventory: {},      // inventory_get (map)
  needs: {},          // costs_orders_for_purchases (map)
  meta: {},           // costs_orders_for_purchases.meta
  ordersByDessert: {},// costs_orders_for_purchases.orders_by_dessert
  late: {},           // costs_orders_for_purchases.late
  pending: {},        // compras pendientes (unidad base): ingredient_key -> qty
  window_h: 36,
};

function el(id){ return document.getElementById(id); }

function show(elm, display="flex"){
  if(!elm) return;
  elm.hidden = false;
  elm.style.display = display;
}
function hide(elm){
  if(!elm) return;
  elm.hidden = true;
  elm.style.display = "none";
}

function showApp(){
  const app = el("appRoot");
  if(!app) return;
  app.hidden = false;
  app.style.display = "block";
}
function hideApp(){
  const app = el("appRoot");
  if(!app) return;
  app.hidden = true;
  app.style.display = "none";
}

function showLoading(title, sub){
  if(el("loadingTitle")) el("loadingTitle").textContent = title || "Cargando…";
  if(el("loadingSub")) el("loadingSub").textContent = sub || "";
  show(el("loadingBack"), "flex");
}
function hideLoading(){ hide(el("loadingBack")); }

function openUnlock(message){
  hideApp();
  if(el("unlockMsg")) el("unlockMsg").textContent = message || "";
  show(el("unlockBack"), "flex");
  const inp = el("secretInput");
  if(inp) inp.focus();
}
function closeUnlock(){
  hide(el("unlockBack"));
  if(el("unlockMsg")) el("unlockMsg").textContent = "";
}

function setMeta(msg){
  const m = el("meta");
  if(m) m.textContent = msg;
}

async function api(body, {timeoutMs=30000} = {}){
  const controller = new AbortController();
  const t = setTimeout(()=>controller.abort(), timeoutMs);
  let res;
  try{
    res = await fetch(API_URL, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally { clearTimeout(t); }

  const raw = await res.text().catch(()=>"");
  let out;
  try{ out = raw ? JSON.parse(raw) : {ok:false, error:`HTTP ${res.status}`}; }
  catch{ out = {ok:false, error: raw || `HTTP ${res.status}`}; }

  if(!res.ok) throw new Error(out?.error || out?.message || `HTTP ${res.status}`);
  if(!out || out.ok !== true) throw new Error(out?.error || "Error");
  return out;
}

async function validateSecret(secret){
  await api({ action: "costs_list", costs_secret: secret }, {timeoutMs: 30000});
  return true;
}

// =================== helpers ===================
function fmtNum(n){
  if(n === null || n === undefined || Number.isNaN(n)) return "—";
  const v = Number(n);
  if(!isFinite(v)) return "—";
  return new Intl.NumberFormat("es-CO", { maximumFractionDigits: 3 }).format(v);
}

function escapeHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));
}
function escapeAttr(s){ return escapeHtml(s); }
function cssEscape(s){ return String(s).replace(/\\/g,"\\\\").replace(/"/g,'\\"'); }

function getInvEntryRaw(key){
  const v = state.inventory?.[key];
  if(v && typeof v === "object"){
    return { qty: Number(v.qty || 0), unit: String(v.unit || "").trim() };
  }
  if(typeof v === "number"){
    return { qty: Number(v || 0), unit: "" };
  }
  const n = Number(v || 0);
  return { qty: isFinite(n) ? n : 0, unit: "" };
}

function getCostSpec(key){
  return state.costsByKey?.[key] || null;
}

function baseFromSpec(spec){
  // Determina unidad base y costo por unidad base
  const unit_type = String(spec?.unit_type || "").trim().toLowerCase();
  const pack_qty = Number(spec?.pack_qty || 0);
  const pack_price = Number(spec?.pack_price || 0);
  const cpuStored = Number(spec?.cop_per_unit || 0);
  const unit_item_qty = Number(spec?.unit_item_qty || 0);
  const unit_item_type = String(spec?.unit_item_qty_type || "").trim().toLowerCase();
  const brand = String(spec?.brand || "").trim();
  const store = String(spec?.store || "").trim();

  // helper
  const cpuOr = (cpuStored>0 && isFinite(cpuStored)) ? cpuStored : ((pack_qty>0 && pack_price>0) ? (pack_price/pack_qty) : null);

  if(unit_type === "g" || unit_type === "ml"){
    return { base_unit: unit_type, cpu: cpuOr, pack_qty, pack_price, brand, store, unit_item_qty, unit_item_type, unit_type };
  }

  if(unit_type === "unidad"){
    // Si hay conversión por unidad, guardamos en base g/ml
    if(unit_item_qty>0 && (unit_item_type === "g" || unit_item_type === "ml")){
      const basePackQty = pack_qty * unit_item_qty;
      const cpu = (basePackQty>0 && pack_price>0) ? (pack_price/basePackQty) : null;
      return { base_unit: unit_item_type, cpu, pack_qty: basePackQty, pack_price, brand, store, unit_item_qty, unit_item_type, unit_type };
    }
    // Sin conversión: se queda en unidad
    return { base_unit: "unidad", cpu: cpuOr, pack_qty, pack_price, brand, store, unit_item_qty, unit_item_type, unit_type };
  }

  // fallback si aún no hay costos guardados
  return { base_unit: "", cpu: null, pack_qty: 0, pack_price: 0, brand:"", store:"", unit_item_qty:0, unit_item_type:"", unit_type:"" };
}

function normalizeInvToBase(key){
  const raw = getInvEntryRaw(key);
  const spec = getCostSpec(key);
  const base = baseFromSpec(spec);

  let unit = raw.unit || "";
  let qty = Number(raw.qty || 0);

  // Si no hay unidad en inventario, asumimos base
  if(!unit){
    return { qty, unit: base.base_unit || "g", raw };
  }

  // Si ya coincide con base, ok
  if(base.base_unit && unit === base.base_unit){
    return { qty, unit, raw };
  }

  // Si inventario está en "unidad" pero base es g/ml y hay factor, convertimos SOLO para mostrar/cálculo
  if(unit === "unidad" && (base.base_unit === "g" || base.base_unit === "ml") && base.unit_item_qty>0 && base.unit_item_type === base.base_unit){
    return { qty: qty * base.unit_item_qty, unit: base.base_unit, raw };
  }

  // En otros casos, dejamos como está (para no inventar conversiones)
  return { qty, unit, raw };
}

function getUnitFor(key){
  const spec = getCostSpec(key);
  const base = baseFromSpec(spec);
  if(base.base_unit) return base.base_unit;
  const inv = normalizeInvToBase(key);
  if(inv.unit) return inv.unit;
  return "g";
}

function getCostPerUnit(key){
  const spec = getCostSpec(key);
  const base = baseFromSpec(spec);
  return (typeof base.cpu === "number" && isFinite(base.cpu) && base.cpu>0) ? base.cpu : null;
}

function collectAllKeys(){
  const keys = new Set();
  for(const it of (state.items || [])){
    const k = String(it?.ingredient_key ?? it?.key ?? it?.name ?? "").trim();
    if(k) keys.add(k);
  }
  for(const k of Object.keys(state.needs || {})) keys.add(k);
  for(const k of Object.keys(state.inventory || {})) keys.add(k);
  return Array.from(keys).filter(Boolean);
}

function buildCanon(allKeys){
  const groups = Array.isArray(window.AMARED_COSTS_SECTIONS) ? window.AMARED_COSTS_SECTIONS : null;
  const seen = new Set();
  const canon = [];

  if(groups){
    for(const g of groups){
      for(const raw of (g?.keys || [])){
        const k = String(raw || "").trim();
        if(k && !seen.has(k)){
          canon.push(k);
          seen.add(k);
        }
      }
    }
  }

  for(const k of (allKeys || [])){
    if(k && !seen.has(k)){
      canon.push(k);
      seen.add(k);
    }
  }

  if(!groups) canon.sort((a,b)=>a.localeCompare(b,"es"));
  return canon;
}

function computeRow(key){
  const need = Number(state.needs?.[key] || 0) || 0;

  const invN = normalizeInvToBase(key);
  const invBase = Number(invN.qty || 0);

  const pending = Number(state.pending?.[key] || 0) || 0;
  const invShown = invBase + pending;

  const missing = Math.max(0, need - invShown);
  const unit = getUnitFor(key);
  const cpu = getCostPerUnit(key);

  return { key, name: key, need, invBase, pending, invShown, missing, unit, cpu };
}

// =================== UI ===================
function renderDessertsSection(){
  const card = el("dessertsCard");
  const tbody = el("dessertRows");
  const meta = el("dessertsMeta");
  if(!card || !tbody) return;

  const by = state.ordersByDessert || {};
  // Siempre mostramos los 3 postres principales
  const ids = ["mousse_maracuya","cheesecake_cafe_panela","arroz_con_leche"];
  const rows = ids.map(id => ({ id, qty: Number(by[id]||0) || 0 }));

  // Si además hay otros postres, los anexamos
  const extra = Object.keys(by).filter(k => !ids.includes(k) && Number(by[k]||0)>0).map(k => ({id:k, qty:Number(by[k]||0)}));
  const all = rows.concat(extra);

  const hasAny = all.some(x => Number(x.qty||0)>0);
  if(!hasAny){
    hide(card);
    tbody.innerHTML = "";
    if(meta) meta.textContent = "";
    return;
  }

  tbody.innerHTML = all.map(x=>`
    <tr>
      <td>${escapeHtml(prettyDessertName(x.id))}</td>
      <td class="num">${fmtNum(x.qty)}</td>
    </tr>
  `).join("");

  const used = Number(state.meta?.orders_used || 0);
  const lim  = Number(state.meta?.orders_limit || 0);
  const w0   = String(state.meta?.window_start || "").trim();
  const w1   = String(state.meta?.window_end || "").trim();

  if(meta){
    const ordersText = lim ? `Pedidos: ${used}/${lim}` : `Pedidos: ${used}`;
    meta.textContent = `${ordersText}${(w0&&w1)?(" · Ventana: "+w0+" → "+w1):""}`;
  }

  show(card, "block");
}

function renderTable(){
  const tbody = el("rows");
  if(!tbody) return;
  tbody.innerHTML = "";

  const allKeys = collectAllKeys();
  const keys = buildCanon(allKeys);

  for(const key of keys){
    const r = computeRow(key);

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(r.name)}</td>
      <td class="num">${fmtNum(r.need)}</td>
      <td class="num">${fmtNum(r.invShown)}</td>
      <td class="num">${fmtNum(r.missing)}</td>
      <td>${escapeHtml(r.unit)}</td>
      <td class="num">${r.cpu === null ? "—" : fmtNum(Math.round(r.cpu))}</td>
      <td><button class="btn" data-detail="${escapeAttr(r.key)}">⚙️</button></td>
      <td class="num"><input class="inp inpSm" data-buy="${escapeAttr(r.key)}" type="number" min="0" step="any" placeholder="0"/></td>
      <td class="num"><button class="btn" data-add="${escapeAttr(r.key)}">+</button></td>
    `;
    tbody.appendChild(tr);
  }

  // sumar a pendientes
  tbody.querySelectorAll("button[data-add]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const key = btn.getAttribute("data-add") || "";
      const inp = tbody.querySelector(`input[data-buy="${cssEscape(key)}"]`);
      const val = inp ? Number(inp.value || 0) : 0;
      if(!val || val <= 0) return;

      state.pending[key] = Number(state.pending?.[key] || 0) + val;
      if(inp) inp.value = "";

      renderTable();
      const totalItems = Object.keys(state.pending).filter(k => Number(state.pending[k]||0)>0).length;
      if(totalItems>0){
        setMeta(`✅ Pendientes: ${totalItems} ingrediente(s) · Pedidos: ${Number(state.meta?.orders_used||0)} · Ventana: ${String(state.meta?.window_start||"")} → ${String(state.meta?.window_end||"")}`);
      }
    });
  });

  // detalle/edición
  tbody.querySelectorAll("button[data-detail]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const key = btn.getAttribute("data-detail") || "";
      openCostModal(key);
    });
  });
}

function prettyDessertName(id){
  const s = String(id||"").trim();
  if(!s) return "";
  const map = {
    "mousse_maracuya":"Mousse de maracuyá",
    "mousse":"Mousse de maracuyá",
    "cheesecake_cafe":"Cheesecake de café con panela",
    "cheesecake_cafe_panela":"Cheesecake de café con panela",
    "cheesecake":"Cheesecake de café con panela",
    "arroz_con_leche":"Arroz con leche",
    "arroz":"Arroz con leche",
  };
  if(map[s]) return map[s];
  return s.replace(/[_-]+/g," ");
}

function renderLateSection(){
  const card = el("lateCard");
  const tbody = el("lateRows");
  const meta = el("lateMeta");
  if(!card || !tbody) return;

  const by = state.late?.byDessert || {};
  const keys = Object.keys(by).filter(k => Number(by[k]||0) > 0);
  if(keys.length === 0){
    hide(card);
    tbody.innerHTML = "";
    if(meta) meta.textContent = "";
    return;
  }

  keys.sort((a,b)=>Number(by[b]||0)-Number(by[a]||0));
  tbody.innerHTML = keys.map(k=>{
    const qty = Number(by[k]||0);
    return `<tr>
      <td>${escapeHtml(prettyDessertName(k))}</td>
      <td class="num">${fmtNum(qty)}</td>
    </tr>`;
  }).join("");

  const used = Number(state.late?.orders_used || 0);
  const w0 = String(state.meta?.late_window_start || "").trim();
  const w1 = String(state.meta?.late_window_end || "").trim();
  if(meta) meta.textContent = `Pedidos: ${used}${(w0&&w1)?(" · Ventana: "+w0+" → "+w1):""}`;

  show(card, "block");
}

// =================== data ===================
function indexCosts(items){
  const map = {};
  for(const it of (items || [])){
    const k = String(it?.ingredient_key ?? it?.key ?? it?.name ?? "").trim();
    if(!k) continue;
    map[k] = it;
  }
  state.costsByKey = map;
}

async function loadAll(){
  if(!UNLOCKED_SECRET) throw new Error("Sin clave.");

  setMeta("Cargando inventario, necesidades y costos…");

  const [invOut, needsOut, costsOut] = await Promise.all([
    api({ action: "inventory_get", costs_secret: UNLOCKED_SECRET }),
    api({ action: "costs_orders_for_purchases", costs_secret: UNLOCKED_SECRET, window_h: state.window_h }),
    api({ action: "costs_list", costs_secret: UNLOCKED_SECRET }),
  ]);

  state.inventory = invOut.inventory || {};
  state.needs = needsOut.needs || {};
  state.meta = needsOut.meta || {};
  state.ordersByDessert = needsOut.orders_by_dessert || needsOut.ordersByDessert || {};
  state.late = needsOut.late || {};
  state.items = costsOut.items || [];
  indexCosts(state.items);

  const used = Number(state.meta?.orders_used || 0);
  const lim  = Number(state.meta?.orders_limit || 0);
  const w0   = String(state.meta?.window_start || "").trim();
  const w1   = String(state.meta?.window_end || "").trim();
  const winText = (w0 && w1) ? `${w0} → ${w1}` : `${Number(state.meta?.window_hours || state.window_h)}h`;
  const ordersText = lim ? `Pedidos: ${used}/${lim}` : `Pedidos: ${used}`;
  setMeta(`Ventana: ${winText} · ${ordersText}`);

  renderDessertsSection();
  renderLateSection();
  renderTable();
}

// =================== compras -> inventario (Sheets) ===================
function buildPurchaseBatch(){
  const entries = [];
  for(const [k,v] of Object.entries(state.pending || {})){
    const qty = Number(v || 0);
    if(!qty || qty <= 0) continue;

    const unit = getUnitFor(k);
    const cpu = getCostPerUnit(k);

    // Si es "unidad" y no hay conversión, aún permitimos, pero idealmente se configure en Costs.
    const row = { ingredient_key: k, qty, unit };
    if(cpu !== null) row.cop_per_unit = cpu;
    entries.push(row);
  }
  return entries;
}

async function registerPurchases(){
  if(!UNLOCKED_SECRET){
    openUnlock("Desbloquea con tu clave de Costos para iniciar.");
    return;
  }

  const items = buildPurchaseBatch();
  if(items.length === 0){
    setMeta("No hay compras pendientes para registrar.");
    return;
  }

  showLoading("Registrando compras…", "Actualizando inventario en la base de datos.");
  try{
    const out = await api({
      action: "inventory_add_purchase_batch",
      costs_secret: UNLOCKED_SECRET,
      updated_by: "PURCHASES_UI",
      source: "PURCHASES_UI",
      items
    }, {timeoutMs: 60000});

    // refresca
    state.pending = {};
    await loadAll();
    setMeta("✅ Compras registradas y inventario actualizado.");
  } catch(err){
    setMeta(`❌ Error registrando compras: ${(err && err.message) ? err.message : "Error"}`);
  } finally { hideLoading(); }
}

// =================== COST MODAL ===================
let CM = { key:null };

function cmEls(){
  return {
    back: el("costModalBack"),
    title: el("costModalTitle"),
    sub: el("costModalSub"),
    unitType: el("cmUnitType"),
    packQty: el("cmPackQty"),
    packPrice: el("cmPackPrice"),
    unitExtra: el("cmUnitExtra"),
    unitItemQty: el("cmUnitItemQty"),
    unitItemType: el("cmUnitItemType"),
    brand: el("cmBrand"),
    store: el("cmStore"),
    computed: el("cmComputed"),
    err: el("cmErr"),
    cancel: el("cmCancel"),
    save: el("cmSave"),
  };
}

function cmComputePreview(){
  const e = cmEls();
  const unit_type = String(e.unitType?.value||"").trim();
  const pack_qty = Number(e.packQty?.value||0);
  const pack_price = Number(e.packPrice?.value||0);
  const unit_item_qty = Number(e.unitItemQty?.value||0);
  const unit_item_type = String(e.unitItemType?.value||"").trim();

  let base_unit = unit_type;
  let base_pack_qty = pack_qty;
  let cpu = null;

  if(unit_type === "unidad" && unit_item_qty>0 && (unit_item_type==="g" || unit_item_type==="ml")){
    base_unit = unit_item_type;
    base_pack_qty = pack_qty * unit_item_qty;
  }

  if(base_pack_qty>0 && pack_price>0){
    cpu = pack_price / base_pack_qty;
  }

  if(e.unitExtra){
    e.unitExtra.style.display = (unit_type === "unidad") ? "block" : "none";
  }
  if(e.computed){
    e.computed.textContent = `Se guardará como: ${base_pack_qty ? fmtNum(base_pack_qty) : "—"} ${base_unit || "—"} por empaque · Costo/u: ${cpu?("$"+fmtNum(Math.round(cpu))):"—"}`;
  }
}

function openCostModal(key){
  const e = cmEls();
  if(!e.back) return;

  CM.key = key;
  if(e.err) e.err.textContent = "";

  const spec = getCostSpec(key);
  const base = baseFromSpec(spec);

  if(e.title) e.title.textContent = `Detalle: ${key}`;
  if(e.sub) e.sub.textContent = "Edita la última presentación guardada (se actualizará en COSTOS_INGREDIENTES).";

  // Si no hay spec, dejamos valores en blanco
  const unit_type = String(spec?.unit_type || "").trim().toLowerCase() || (base.base_unit || "g");
  if(e.unitType) e.unitType.value = (unit_type==="g"||unit_type==="ml"||unit_type==="unidad") ? unit_type : "g";

  if(e.packQty) e.packQty.value = spec?.pack_qty ? String(spec.pack_qty) : "";
  if(e.packPrice) e.packPrice.value = spec?.pack_price ? String(spec.pack_price) : "";

  if(e.unitItemQty) e.unitItemQty.value = (spec?.unit_item_qty ? String(spec.unit_item_qty) : "");
  if(e.unitItemType) e.unitItemType.value = String(spec?.unit_item_qty_type || "").trim().toLowerCase();

  if(e.brand) e.brand.value = String(spec?.brand || "");
  if(e.store) e.store.value = String(spec?.store || "");

  // Preview
  cmComputePreview();

  show(e.back, "flex");
}

function closeCostModal(){
  const e = cmEls();
  if(e.back) hide(e.back);
  CM.key = null;
}

async function saveCostModal(){
  const e = cmEls();
  if(!CM.key) return;
  if(e.err) e.err.textContent = "";

  const ingredient_key = CM.key;
  const unit_type = String(e.unitType?.value||"").trim();
  const pack_qty0 = Number(e.packQty?.value||0);
  const pack_price = Number(e.packPrice?.value||0);
  const brand = String(e.brand?.value||"").trim();
  const store = String(e.store?.value||"").trim();

  const unit_item_qty = Number(e.unitItemQty?.value||0);
  const unit_item_qty_type = String(e.unitItemType?.value||"").trim();

  if(!unit_type){ if(e.err) e.err.textContent = "Selecciona unidad."; return; }
  if(!(pack_qty0>0)){ if(e.err) e.err.textContent = "Cantidad de empaque inválida."; return; }
  if(!(pack_price>0)){ if(e.err) e.err.textContent = "Precio de empaque inválido."; return; }

  // Normalizar: si es unidad + trae g/ml por unidad, guardamos en unidad base g/ml
  let save_unit_type = unit_type;
  let save_pack_qty = pack_qty0;
  if(unit_type === "unidad" && unit_item_qty>0 && (unit_item_qty_type==="g" || unit_item_qty_type==="ml")){
    save_unit_type = unit_item_qty_type;
    save_pack_qty = pack_qty0 * unit_item_qty;
  }
  const cop_per_unit = pack_price / save_pack_qty;

  showLoading("Guardando…", "Actualizando COSTOS_INGREDIENTES.");
  try{
    await api({
      action:"costs_upsert",
      costs_secret: UNLOCKED_SECRET,
      ingredient_key,
      unit_type: save_unit_type,
      pack_qty: save_pack_qty,
      pack_price,
      cop_per_unit,
      brand,
      store,
      unit_item_qty: (unit_item_qty>0 ? unit_item_qty : ""),
      unit_item_qty_type: unit_item_qty_type || "",
      updated_by: "PURCHASES_UI"
    }, {timeoutMs: 60000});

    // recargar datos (costos + tabla)
    await loadAll();
    closeCostModal();
    setMeta("✅ Costos actualizados.");
  } catch(err){
    if(e.err) e.err.textContent = (err && err.message) ? err.message : "Error guardando.";
  } finally { hideLoading(); }
}

// =================== auth ===================
async function doUnlock(isAuto=false){
  const inp = el("secretInput");
  const secret = String(inp?.value || "").trim();

  if(!secret){
    if(el("unlockMsg")) el("unlockMsg").textContent = "Ingresa la clave.";
    return;
  }

  showLoading("Validando…", "Un momento.");
  try{
    await validateSecret(secret);

    UNLOCKED_SECRET = secret;
    localStorage.setItem(LS_SECRET_KEY, secret);

    closeUnlock();
    showApp();

    showLoading("Cargando…", "Leyendo inventario y calculando necesidades.");
    await loadAll();
  } catch(err){
    UNLOCKED_SECRET = "";
    if(!isAuto) localStorage.removeItem(LS_SECRET_KEY);
    openUnlock();
    if(el("unlockMsg")) el("unlockMsg").textContent = (err && err.message) ? err.message : "Clave inválida o sin permisos.";
  } finally {
    hideLoading();
  }
}

function clearSecret(){
  UNLOCKED_SECRET = "";
  localStorage.removeItem(LS_SECRET_KEY);
  const inp = el("secretInput");
  if(inp) inp.value = "";
  openUnlock();
}

// =================== boot ===================
async function boot(){
  if(el("btnReload")) el("btnReload").addEventListener("click", async()=>{
    if(!UNLOCKED_SECRET){ openUnlock("Desbloquea con tu clave de Costos para iniciar."); return; }
    showLoading("Cargando…", "Actualizando.");
    try{ await loadAll(); } finally { hideLoading(); }
  });

  if(el("btnRegister")) el("btnRegister").addEventListener("click", registerPurchases);
  if(el("btnExit")) el("btnExit").addEventListener("click", ()=>{ window.location.href = "index.html"; });

  if(el("btnDoUnlock")) el("btnDoUnlock").addEventListener("click", ()=>doUnlock(false));
  if(el("btnClear")) el("btnClear").addEventListener("click", clearSecret);

  // modal events
  const e = cmEls();
  if(e.cancel) e.cancel.addEventListener("click", closeCostModal);
  if(e.back) e.back.addEventListener("click", (ev)=>{ if(ev.target === e.back) closeCostModal(); });
  if(e.save) e.save.addEventListener("click", saveCostModal);
  if(e.unitType) e.unitType.addEventListener("change", cmComputePreview);
  if(e.packQty) e.packQty.addEventListener("input", cmComputePreview);
  if(e.packPrice) e.packPrice.addEventListener("input", cmComputePreview);
  if(e.unitItemQty) e.unitItemQty.addEventListener("input", cmComputePreview);
  if(e.unitItemType) e.unitItemType.addEventListener("change", cmComputePreview);

  const inp = el("secretInput");
  if(inp){
    inp.addEventListener("keydown", (ev)=>{
      if(ev.key === "Enter") doUnlock(false);
    });
  }

  hideApp();
  openUnlock("Ingresa tu clave de Costos para iniciar.");

  const saved = String(localStorage.getItem(LS_SECRET_KEY) || "").trim();
  if(saved && saved !== "null" && saved !== "undefined"){
    if(inp) inp.value = saved;
    setTimeout(()=>doUnlock(true), 100);
  }
}

document.addEventListener("DOMContentLoaded", boot);
