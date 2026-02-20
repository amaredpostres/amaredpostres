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
  buyPlan: {},        // plan de compra: ingredient_key -> {selected, packs, qty_manual}
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

function updateBuyMeta(){
  const selectedKeys = Object.keys(state.buyPlan || {}).filter(k => state.buyPlan[k] && state.buyPlan[k].selected);
  const n = selectedKeys.length;
  if(n === 0){ updateTotalCostUI(); return; }
  const totalQty = selectedKeys.reduce((s,k)=> s + (computePlannedQty(k) || 0), 0);
  const totalCop = selectedKeys.reduce((s,k)=> s + (computePlannedCost(k) || 0), 0);
  const unitHint = "(en unidad base g/ml)";
  const used = Number(state.meta?.orders_used || 0);
  const lim  = Number(state.meta?.orders_limit || 0);
  const w0   = String(state.meta?.window_start || "").trim();
  const w1   = String(state.meta?.window_end || "").trim();
  const winText = (w0&&w1) ? (w0+" → "+w1) : "";
  const ordersText = lim ? `Pedidos: ${used}/${lim}` : `Pedidos: ${used}`;
  setMeta(`🧾 Seleccionados: ${n} ingrediente(s) · Cantidad total ${unitHint}: ${fmtNum(totalQty)} · Total aprox: $${moneyCOP(totalCop)} · ${ordersText}${winText?(' · Ventana: '+winText):''}`);
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


function moneyCOP(n){
  const v = Math.max(0, Math.round(Number(n || 0)));
  return v.toLocaleString("es-CO");
}
function roundCOP(n){
  const v = Math.round(Number(n || 0));
  return isFinite(v) ? v : 0;
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

function getPlan(key){
  if(!state.buyPlan) state.buyPlan = {};
  const cur = state.buyPlan[key];
  if(cur && typeof cur === "object") return cur;
  const p = { selected:false, packs:0, qty_manual:0 };
  state.buyPlan[key] = p;
  return p;
}

function computePlannedQty(key){
  const plan = getPlan(key);
  if(!plan.selected) return 0;

  const spec = getCostSpec(key);
  const base = baseFromSpec(spec);

  // Si hay empaque definido (pack_qty) lo usamos con "empaques"
  const packs = Number(plan.packs || 0);
  if(base.pack_qty > 0 && packs > 0){
    return packs * base.pack_qty;
  }

  // Fallback: cantidad manual en unidad base
  const q = Number(plan.qty_manual || 0);
  if(q > 0) return q;

  return 0;
}


function generatePurchaseId(){
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const day = String(d.getDate()).padStart(2,"0");
  const hh = String(d.getHours()).padStart(2,"0");
  const mm = String(d.getMinutes()).padStart(2,"0");
  const ss = String(d.getSeconds()).padStart(2,"0");
  const rnd = String(Math.floor(Math.random()*9000)+1000);
  return `PUR-${y}${m}${day}-${hh}${mm}${ss}-${rnd}`;
}

function computePlannedCost(key){
  const plan = getPlan(key);
  if(!plan.selected) return 0;

  const qty = computePlannedQty(key);
  if(!(qty > 0)) return 0;

  const spec = getCostSpec(key);
  const base = baseFromSpec(spec);

  // Si se está comprando por empaques y tenemos precio de empaque, usamos eso.
  const packs = Number(plan.packs || 0);
  if(base.pack_qty > 0 && packs > 0 && Number(base.pack_price || 0) > 0){
    return roundCOP(Number(base.pack_price || 0) * packs);
  }

  // Fallback: costo por unidad base * qty
  const cpu = getCostPerUnit(key);
  if(cpu && isFinite(cpu) && cpu > 0){
    return roundCOP(cpu * qty);
  }
  return 0;
}

function computeTotalPlannedCost(){
  let sum = 0;
  for(const k of Object.keys(state.buyPlan || {})){
    sum += computePlannedCost(k);
  }
  return roundCOP(sum);
}

function updateTotalCostUI(){
  const total = computeTotalPlannedCost();
  const top = el("totalCostTop");
  if(top){
    top.textContent = total > 0 ? (`Total aprox: $${moneyCOP(total)}`) : "";
    top.hidden = !(total > 0);
  }
}
function computeRow(key){
  const need = Number(state.needs?.[key] || 0) || 0;

  const invN = normalizeInvToBase(key);
  const invBase = Number(invN.qty || 0);

  const planned = computePlannedQty(key);
  const invShown = invBase + planned;

  const missing = Math.max(0, need - invShown);
  const unit = getUnitFor(key);
  const cpu = getCostPerUnit(key);

  return { key, name: key, need, invBase, planned, invShown, missing, unit, cpu };
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

    const spec = getCostSpec(key);
    const base = baseFromSpec(spec);
    const plan = getPlan(key);

    const hasPack = (base.pack_qty > 0) && !!base.base_unit;
    const suggestedPacks = (hasPack && r.missing > 0) ? Math.max(0, Math.ceil(r.missing / base.pack_qty)) : 0;

    // Valores a mostrar en inputs (sin mutar estado)
    const showSelected = !!plan.selected;
    const showPacks = Number(plan.packs || 0) || (showSelected ? (suggestedPacks || 1) : (suggestedPacks || 0));
    const showQtyManual = Number(plan.qty_manual || 0) || (showSelected && !hasPack ? (r.missing || 0) : 0);

    const packDesc = hasPack
      ? `Empaque: ${fmtNum(base.pack_qty)} ${escapeHtml(base.base_unit)} · $${fmtNum(base.pack_price || 0)}`
      : `Empaque: sin configurar (usa ⚙️)`;

    const extraDesc = [base.brand ? `Marca: ${base.brand}` : "", base.store ? `Tienda: ${base.store}` : ""].filter(Boolean).join(" · ");

    const plannedQty = computePlannedQty(key);

    const buyCell = hasPack
      ? `
        <div style="display:flex; gap:10px; justify-content:flex-end; align-items:center; flex-wrap:wrap;">
          <label class="badge">
            <input class="chk" type="checkbox" data-sel="${escapeAttr(key)}" ${showSelected ? "checked" : ""}/>
            <span class="small muted">Comprar</span>
          </label>
          <input class="inpNum" data-packs="${escapeAttr(key)}" type="number" min="0" step="1" value="${escapeAttr(showPacks)}" title="Empaques"/>
        </div>
        <div class="small muted" style="text-align:right; margin-top:6px;">= ${fmtNum(plannedQty)} ${escapeHtml(r.unit)}</div>
      `
      : `
        <div style="display:flex; gap:10px; justify-content:flex-end; align-items:center; flex-wrap:wrap;">
          <label class="badge">
            <input class="chk" type="checkbox" data-sel="${escapeAttr(key)}" ${showSelected ? "checked" : ""}/>
            <span class="small muted">Comprar</span>
          </label>
          <input class="inpNum" data-qtym="${escapeAttr(key)}" type="number" min="0" step="any" value="${escapeAttr(showQtyManual)}" title="Cantidad (${escapeAttr(r.unit)})"/>
        </div>
        <div class="small muted" style="text-align:right; margin-top:6px;">(define empaque en ⚙️ para usar “empaques”)</div>
      `;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(r.name)}</td>
      <td class="num">${fmtNum(r.need)}</td>
      <td class="num">${fmtNum(r.invShown)}</td>
      <td class="num">${fmtNum(r.missing)}</td>
      <td>${escapeHtml(r.unit)}</td>
      <td class="num">${r.cpu === null ? "—" : fmtNum(Math.round(r.cpu))}</td>
      <td>
        <div style="display:flex; gap:10px; align-items:center;">
          <button class="btn" data-detail="${escapeAttr(r.key)}">⚙️</button>
          <div>
            <div class="small muted">${packDesc}</div>
            ${extraDesc ? `<div class="small muted">${escapeHtml(extraDesc)}</div>` : ``}
          </div>
        </div>
      </td>
      <td class="num">${buyCell}</td>
    `;
    tbody.appendChild(tr);
  }

  // detalle/edición
  tbody.querySelectorAll("button[data-detail]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const key = btn.getAttribute("data-detail") || "";
      openCostModal(key);
    });
  });

  // switch comprar
  tbody.querySelectorAll("input[data-sel]").forEach(chk=>{
    chk.addEventListener("change", ()=>{
      const key = chk.getAttribute("data-sel") || "";
      const plan = getPlan(key);
      plan.selected = !!chk.checked;

      // Si se activa y no hay cantidad, sugerimos algo
      if(plan.selected){
        const rr = computeRow(key);
        const spec = getCostSpec(key);
        const base = baseFromSpec(spec);
        if(base.pack_qty > 0){
          if(!(Number(plan.packs || 0) > 0)){
            plan.packs = Math.max(1, Math.ceil((rr.missing || 0) / base.pack_qty) || 1);
          }
        }else{
          if(!(Number(plan.qty_manual || 0) > 0)){
            plan.qty_manual = Math.max(0, rr.missing || 0);
          }
        }
      }

      renderTable();
      updateBuyMeta();
    });
  });

  // empaques
  tbody.querySelectorAll("input[data-packs]").forEach(inp=>{
    inp.addEventListener("input", ()=>{
      const key = inp.getAttribute("data-packs") || "";
      const plan = getPlan(key);
      const v = Math.max(0, Math.floor(Number(inp.value || 0)));
      plan.packs = v;
      plan.selected = v > 0; // más visual: si pones empaques, queda activo
      renderTable();
      updateBuyMeta();
    });
  });

  // cantidad manual
  tbody.querySelectorAll("input[data-qtym]").forEach(inp=>{
    inp.addEventListener("input", ()=>{
      const key = inp.getAttribute("data-qtym") || "";
      const plan = getPlan(key);
      const v = Math.max(0, Number(inp.value || 0));
      plan.qty_manual = v;
      plan.selected = v > 0;
      updateBuyMeta();
      updateTotalCostUI();
    });
  });

  updateBuyMeta();
  updateTotalCostUI();
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
  const purchase_id = generatePurchaseId();

  const items = [];
  let total_cop = 0;

  for(const [k,plan] of Object.entries(state.buyPlan || {})){
    if(!plan || !plan.selected) continue;

    const qty = computePlannedQty(k);
    if(!qty || qty <= 0) continue;

    const unit = getUnitFor(k);
    const cpu = getCostPerUnit(k);

    const spec = getCostSpec(k);
    const base = baseFromSpec(spec);

    const packs = (base.pack_qty > 0) ? Math.max(0, Math.floor(Number(plan.packs || 0))) : 0;
    const cop_total = computePlannedCost(k);

    total_cop += cop_total;

    const row = {
      ingredient_key: k,
      qty,
      unit,
      // para inventario + movimientos
      cop_per_unit: (cpu && isFinite(cpu) && cpu>0) ? cpu : 0,
      cop_total: cop_total || 0,
      // para historial de compras (opcional en backend)
      purchase_id,
      packs: packs || "",
      pack_price: Number(base.pack_price || 0) || "",
      pack_qty: Number(base.pack_qty || 0) || "",
      brand: base.brand || "",
      store: base.store || "",
    };

    items.push(row);
  }

  return { purchase_id, total_cop: roundCOP(total_cop), items };
}

let CONFIRM_BATCH = null;

function openConfirmModal(batch){
  const back = el("confirmBack");
  const rows = el("confirmRows");
  const total = el("confirmTotal");
  const sub = el("confirmSub");
  if(!back || !rows || !total) return false;

  CONFIRM_BATCH = batch;

  const items = batch.items || [];
  rows.innerHTML = items.map(it=>{
    const name = String(it.ingredient_key || "");
    const qty = Number(it.qty || 0);
    const unit = String(it.unit || "");
    const cost = Number(it.cop_total || 0);
    const packsTxt = (it.packs ? `${it.packs} empaque(s)` : "");
    return `<tr>
      <td>${escapeHtml(name)}</td>
      <td class="num">${fmtNum(qty)}</td>
      <td>${escapeHtml(unit)}</td>
      <td class="num">$${moneyCOP(cost)}</td>
      <td class="small muted">${escapeHtml(packsTxt)}</td>
    </tr>`;
  }).join("");

  const t = Number(batch.total_cop || 0) || 0;
  total.textContent = `$${moneyCOP(t)}`;
  if(sub){
    sub.textContent = `Se registrarán ${items.length} ingrediente(s) en INVENTARIO y se guardará el historial de compra.`;
  }

  show(back, "flex");
  return true;
}

function closeConfirmModal(){
  const back = el("confirmBack");
  if(back) hide(back);
  CONFIRM_BATCH = null;
}

async function confirmRegisterPurchases(){
  if(!UNLOCKED_SECRET){
    closeConfirmModal();
    openUnlock("Desbloquea con tu clave de Costos para iniciar.");
    return;
  }

  const batch = CONFIRM_BATCH;
  if(!batch || !Array.isArray(batch.items) || batch.items.length === 0){
    closeConfirmModal();
    setMeta("No hay ingredientes marcados para comprar.");
    return;
  }

  closeConfirmModal();

  showLoading("Registrando compras…", "Actualizando inventario en la base de datos.");
  try{
    const out = await api({
      action: "inventory_add_purchase_batch",
      costs_secret: UNLOCKED_SECRET,
      updated_by: "PURCHASES_UI",
      source: "PURCHASES_UI",
      purchase_id: batch.purchase_id,
      total_cop: batch.total_cop,
      items: batch.items
    }, {timeoutMs: 60000});

    // refresca
    const total = Number(batch.total_cop || 0) || 0;
    state.buyPlan = {};
    await loadAll();
    setMeta(`✅ Compras registradas y inventario actualizado. Total aprox: $${moneyCOP(total)}`);
  } catch(err){
    setMeta(`❌ Error registrando compras: ${(err && err.message) ? err.message : "Error"}`);
  } finally { hideLoading(); }
}

async function registerPurchases(){
  if(!UNLOCKED_SECRET){
    openUnlock("Desbloquea con tu clave de Costos para iniciar.");
    return;
  }

  const batch = buildPurchaseBatch();
  if(!batch.items.length){
    setMeta("No hay ingredientes marcados para comprar.");
    return;
  }

  // mostrar total y confirmar
  const ok = openConfirmModal(batch);
  if(!ok){
    // fallback si el modal no existe
    CONFIRM_BATCH = batch;
    return confirmRegisterPurchases();
  }
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

  // confirmar compras
  if(el("btnConfirmCancel")) el("btnConfirmCancel").addEventListener("click", closeConfirmModal);
  if(el("btnConfirmOk")) el("btnConfirmOk").addEventListener("click", confirmRegisterPurchases);
  const cBack = el("confirmBack");
  if(cBack) cBack.addEventListener("click", (ev)=>{ if(ev.target === cBack) closeConfirmModal(); });

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
