/* AMARED Compras & Costos - Unificado v7
   ✅ Misma lógica de cálculo (Pagado + No iniciar)
   ✅ Ventana: ayer 3pm → hoy 3pm + sección de pedidos tarde
   ✅ UI tipo tarjetas + acordeones (mobile-first)
   ✅ Switch Comprar + empaques/cantidad + Auto
   ✅ Modal para editar COSTOS_INGREDIENTES
   ✅ Pestaña Costos (listado + edición + catálogos)
   ✅ Total estimado + confirmación antes de registrar
*/
"use strict";

const API_URL = "https://amared-orders.amaredpostres.workers.dev/";
const LS_SECRET_KEY = "AMARED_COSTS_SECRET";

let UNLOCKED_SECRET = "";
let state = {
  items: [],
  costsByKey: {},
  inventory: {},
  needs: {},
  meta: {},
  ordersByDessert: {},
  late: {},
  stores: [],
  brands: [],
  buyPlan: {},
  window_h: 36,
  view: "purchases",
  ui: {
    q: "",
    onlyMissing: true,
    onlySelected: false,
    cost_q: "",
  }
};

// =============== DOM helpers ===============
const el = (id) => document.getElementById(id);
const show = (node) => { if(node){ node.classList.remove("hidden"); node.hidden = false; node.style.display = ""; } };
const hide = (node) => { if(node){ node.classList.add("hidden"); node.hidden = true; node.style.display = "none"; } };

function setGlobalMsg(msg, isErr=false){
  const g = el("globalMsg");
  if(!g) return;
  const t = String(msg||"").trim();
  if(!t){ g.textContent = ""; g.classList.remove("show","err"); return; }
  g.textContent = t;
  g.classList.add("show");
  g.classList.toggle("err", !!isErr);
}

function moneyCOP(n){
  const v = Math.max(0, Math.round(Number(n||0)));
  return "$" + v.toLocaleString("es-CO");
}

function uniqSorted(arr){
  const uniq = Array.from(new Set((arr||[]).map(v=>String(v||"").trim()).filter(Boolean)));
  uniq.sort((a,b)=>a.localeCompare(b,"es"));
  return uniq;
}
function renderSelect(id, arr, selected){
  const sel = el(id);
  if(!sel) return;
  const list = Array.isArray(arr) ? arr.map(v=>String(v||"").trim()).filter(Boolean) : [];
  const selVal = String(selected||"").trim();
  const hasSel = selVal && list.some(v => v.toLowerCase() === selVal.toLowerCase());
  const opts = [];
  // empty option first
  opts.push(`<option value="">—</option>`);
  // preserve existing value if it's not in catalog (so user can see what was saved)
  if(selVal && !hasSel){
    opts.push(`<option value="${escapeHtml(selVal)}">⚠️ ${escapeHtml(selVal)} (no está en catálogo)</option>`);
  }
  for(const v of list){
    const vv = String(v);
    const isSel = selVal && vv.toLowerCase() === selVal.toLowerCase();
    opts.push(`<option value="${escapeHtml(vv)}" ${isSel ? "selected" : ""}>${escapeHtml(vv)}</option>`);
  }
  sel.innerHTML = opts.join("");
}
function applyCatalogs(out){
  const cat = out?.catalog || {};
  const stores = (cat.stores || []).map(x=>x?.value ?? x).filter(Boolean);
  const brands = (cat.brands || []).map(x=>x?.value ?? x).filter(Boolean);
  state.stores = uniqSorted(stores);
  state.brands = uniqSorted(brands);
  // selects are rendered when opening modal
  // selects are rendered when opening modal
}

function fmtNum(n){
  if(n === null || n === undefined || Number.isNaN(n)) return "—";
  const v = Number(n);
  if(!isFinite(v)) return "—";
  return new Intl.NumberFormat("es-CO", { maximumFractionDigits: 3 }).format(v);
}

function escapeHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));
}

// =============== Loading ===============
function showLoading(title, sub){
  if(el("loadingTitle")) el("loadingTitle").textContent = title || "Cargando…";
  if(el("loadingSub")) el("loadingSub").textContent = sub || "Un momento.";
  show(el("loadingBack"));
}
function hideLoading(){ hide(el("loadingBack")); }

// =============== Tabs ===============
function setView(view){
  const v = (view === "costs") ? "costs" : "purchases";
  state.view = v;

  const vp = el("viewPurchases");
  const vc = el("viewCosts");
  const bb = el("bottomBar");
  const tp = el("btnTabPurchases");
  const tc = el("btnTabCosts");

  if(v === "costs"){
    hide(vp);
    show(vc);
    if(bb) bb.style.display = "none";
    if(tp){ tp.classList.remove("isActive"); tp.setAttribute("aria-selected","false"); }
    if(tc){ tc.classList.add("isActive"); tc.setAttribute("aria-selected","true"); }
    renderCostsGroups();
  } else {
    show(vp);
    hide(vc);
    if(bb) bb.style.display = "";
    if(tp){ tp.classList.add("isActive"); tp.setAttribute("aria-selected","true"); }
    if(tc){ tc.classList.remove("isActive"); tc.setAttribute("aria-selected","false"); }
    renderGroups();
    refreshBottom();
  }
}

function setCostsMeta(msg){
  const c = el("costsMeta");
  if(c) c.textContent = msg || "";
}

// =============== API ===============
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
  await api({ action:"costs_list", costs_secret: secret }, {timeoutMs: 30000});
  return true;
}

// =============== Costos helpers ===============
function indexCosts(items){
  const map = {};
  for(const it of (items||[])){
    const k = String(it?.ingredient_key ?? it?.key ?? it?.name ?? "").trim();
    if(!k) continue;
    map[k] = it;
  }
  state.costsByKey = map;
}

function getInvEntryRaw(key){
  const v = state.inventory?.[key];
  if(v && typeof v === "object") return { qty: Number(v.qty || 0), unit: String(v.unit || "").trim() };
  if(typeof v === "number") return { qty: Number(v || 0), unit: "" };
  const n = Number(v || 0);
  return { qty: isFinite(n) ? n : 0, unit: "" };
}

function baseFromSpec(spec){
  const unit_type = String(spec?.unit_type || "").trim().toLowerCase();
  const pack_qty = Number(spec?.pack_qty || 0);
  const pack_price = Number(spec?.pack_price || 0);
  const cpuStored = Number(spec?.cop_per_unit || 0);
  const unit_item_qty = Number(spec?.unit_item_qty || 0);
  const unit_item_type = String(spec?.unit_item_qty_type || "").trim().toLowerCase();
  const brand = String(spec?.brand || "").trim();
  const store = String(spec?.store || "").trim();

  const cpuOr = (cpuStored>0 && isFinite(cpuStored)) ? cpuStored : ((pack_qty>0 && pack_price>0) ? (pack_price/pack_qty) : null);

  if(unit_type === "g" || unit_type === "ml"){
    return { base_unit: unit_type, cpu: cpuOr, pack_qty, pack_price, brand, store, unit_item_qty, unit_item_type, unit_type };
  }

  if(unit_type === "unidad"){
    if(unit_item_qty>0 && (unit_item_type === "g" || unit_item_type === "ml")){
      const basePackQty = pack_qty * unit_item_qty;
      const cpu = (basePackQty>0 && pack_price>0) ? (pack_price/basePackQty) : null;
      return { base_unit: unit_item_type, cpu, pack_qty: basePackQty, pack_price, brand, store, unit_item_qty, unit_item_type, unit_type };
    }
    return { base_unit: "unidad", cpu: cpuOr, pack_qty, pack_price, brand, store, unit_item_qty, unit_item_type, unit_type };
  }

  return { base_unit: "", cpu: null, pack_qty: 0, pack_price: 0, brand:"", store:"", unit_item_qty:0, unit_item_type:"", unit_type:"" };
}

function normalizeInvToBase(key){
  const raw = getInvEntryRaw(key);
  const spec = state.costsByKey?.[key] || null;
  const base = baseFromSpec(spec);

  let unit = raw.unit || "";
  let qty = Number(raw.qty || 0);

  if(!unit){
    return { qty, unit: base.base_unit || "g", raw };
  }

  if(base.base_unit && unit === base.base_unit){
    return { qty, unit, raw };
  }

  if(unit === "unidad" && (base.base_unit === "g" || base.base_unit === "ml") && base.unit_item_qty>0 && base.unit_item_type === base.base_unit){
    return { qty: qty * base.unit_item_qty, unit: base.base_unit, raw };
  }

  return { qty, unit, raw };
}

function getUnitFor(key){
  const spec = state.costsByKey?.[key] || null;
  const base = baseFromSpec(spec);
  if(base.base_unit) return base.base_unit;
  const inv = normalizeInvToBase(key);
  if(inv.unit) return inv.unit;
  return "g";
}

function getCostPerUnit(key){
  const spec = state.costsByKey?.[key] || null;
  const base = baseFromSpec(spec);
  if(base.cpu !== null && isFinite(base.cpu)) return base.cpu;
  return null;
}

// =============== Keys & groups ===============
function collectAllKeys(){
  const seen = new Set();
  const out = [];
  for(const k of Object.keys(state.needs || {})){
    if(!k) continue;
    if(!seen.has(k)){ seen.add(k); out.push(k); }
  }
  for(const k of Object.keys(state.inventory || {})){
    if(!k) continue;
    if(!seen.has(k)){ seen.add(k); out.push(k); }
  }
  return out;
}

function groupKeys(keys){
  const groups = Array.isArray(window.AMARED_COSTS_SECTIONS) ? window.AMARED_COSTS_SECTIONS : null;
  const used = new Set();
  const out = [];

  if(groups){
    for(const g of groups){
      const title = String(g?.title || "").trim();
      const gkeys = [];
      for(const raw of (g?.keys || [])){
        const k = String(raw||"").trim();
        if(!k) continue;
        if(keys.includes(k)){
          gkeys.push(k);
          used.add(k);
        }
      }
      if(gkeys.length) out.push({ title, keys: gkeys });
    }
  }

  const other = keys.filter(k => !used.has(k));
  other.sort((a,b)=>a.localeCompare(b,"es"));
  if(other.length) out.push({ title: "Otros", keys: other });

  return out;
}

// =============== Plan de compra ===============
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

  const spec = state.costsByKey?.[key] || null;
  const base = baseFromSpec(spec);

  const packs = Number(plan.packs || 0);
  if(base.pack_qty > 0 && packs > 0) return packs * base.pack_qty;

  const q = Number(plan.qty_manual || 0);
  if(q > 0) return q;

  return 0;
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
  const spec = state.costsByKey?.[key] || null;
  const base = baseFromSpec(spec);
  return { key, need, invBase, planned, invShown, missing, unit, cpu, base };
}

function prettyDessertName(id){
  const s = String(id||"");
  const map = {
    mousse_maracuya: "Mousse de maracuyá",
    cheesecake_cafe_panela: "Cheesecake de café con panela",
    arroz_con_leche: "Arroz con leche",
  };
  return map[s] || s.replaceAll("_"," ");
}

// =============== Render: summaries ===============
function renderDesserts(){
  const tbody = el("dessertRows");
  const meta = el("dessertsMeta");
  if(!tbody) return;

  const by = state.ordersByDessert || {};
  const ids = ["mousse_maracuya","cheesecake_cafe_panela","arroz_con_leche"];
  const rows = ids.map(id => ({ id, qty: Number(by[id]||0) || 0 }));
  const extra = Object.keys(by).filter(k => !ids.includes(k) && Number(by[k]||0)>0).map(k => ({ id:k, qty:Number(by[k]||0) }));
  const all = rows.concat(extra);

  tbody.innerHTML = all.map(r=>`
    <tr>
      <td>${escapeHtml(prettyDessertName(r.id))}</td>
      <td class="num">${fmtNum(r.qty)}</td>
    </tr>
  `).join("");

  const used = Number(state.meta?.orders_used || 0);
  const lim  = Number(state.meta?.orders_limit || 0);
  const w0   = String(state.meta?.window_start || "").trim();
  const w1   = String(state.meta?.window_end || "").trim();
  const ordersText = lim ? `Pedidos: ${used}/${lim}` : `Pedidos: ${used}`;
  if(meta) meta.textContent = `${ordersText}${(w0&&w1)?(" · Ventana: "+w0+" → "+w1):""}`;
}

function renderLate(){
  const tbody = el("lateRows");
  const meta = el("lateMeta");
  if(!tbody) return;

  const by = state.late?.orders_by_dessert || state.late?.ordersByDessert || {};
  const ids = ["mousse_maracuya","cheesecake_cafe_panela","arroz_con_leche"];
  const rows = ids.map(id => ({ id, qty: Number(by[id]||0) || 0 }));
  const extra = Object.keys(by).filter(k => !ids.includes(k) && Number(by[k]||0)>0).map(k => ({ id:k, qty:Number(by[k]||0) }));
  const all = rows.concat(extra);

  tbody.innerHTML = all.map(r=>`
    <tr>
      <td>${escapeHtml(prettyDessertName(r.id))}</td>
      <td class="num">${fmtNum(r.qty)}</td>
    </tr>
  `).join("");

  const used = Number(state.late?.orders_used || 0);
  const w0 = String(state.meta?.late_window_start || "").trim();
  const w1 = String(state.meta?.late_window_end || "").trim();
  if(meta) meta.textContent = `Pedidos: ${used}${(w0&&w1)?(" · Ventana: "+w0+" → "+w1):""}`;
}

// =============== Render: ingredients ===============
function rowPassesFilters(row){
  const q = String(state.ui.q||"").trim().toLowerCase();
  const onlyMissing = !!state.ui.onlyMissing;
  const onlySelected = !!state.ui.onlySelected;
  const plan = getPlan(row.key);

  if(q && !row.key.toLowerCase().includes(q)) return false;
  if(onlyMissing && !(row.missing > 0)) return false;
  if(onlySelected && !plan.selected) return false;
  return true;
}

function groupMetaText(keys){
  let missingCount = 0;
  let needCount = 0;
  for(const k of keys){
    const r = computeRow(k);
    if(r.missing > 0) missingCount++;
    if(r.need > 0) needCount++;
  }
  return `${needCount} con receta · ${missingCount} con faltante`;
}

function renderGroups(){
  const host = el("groups");
  if(!host) return;

  const allKeys = collectAllKeys();
  const groups = groupKeys(allKeys);

  host.innerHTML = groups.map((g, idx)=>{
    const keys = (g.keys||[]).filter(k => rowPassesFilters(computeRow(k)));
    if(!keys.length) return "";

    const meta = groupMetaText(keys);
    const openAttr = (idx === 0) ? "open" : "";

    const itemsHtml = keys.map(k => renderItemCard(computeRow(k))).join("");

    return `
      <details class="pGroup" ${openAttr}>
        <summary>
          <div>
            <div class="pGroupTitle">${escapeHtml(g.title || "Sección")}</div>
            <div class="pGroupMeta">${escapeHtml(meta)}</div>
          </div>
          <div class="pGroupMeta">Toca para abrir</div>
        </summary>
        <div class="pGroupBody">
          ${itemsHtml}
        </div>
      </details>
    `;
  }).join("");
}

// =============== Costos view (listado) ===============
function costKeyPasses(k){
  const q = String(state.ui?.cost_q || "").trim().toLowerCase();
  if(!q) return true;
  return String(k||"").toLowerCase().includes(q);
}

function renderCostItemCard(key){
  const spec = state.costsByKey?.[key] || null;
  const b = baseFromSpec(spec);
  const unit = b.base_unit || (String(spec?.unit_type||"").trim() || "—");
  const pack_qty = Number(spec?.pack_qty || 0);
  const pack_price = Number(spec?.pack_price || 0);
  const cpu = getCostPerUnit(key);

  const metaA = (pack_qty>0 && pack_price>0)
    ? `Empaque: ${fmtNum(pack_qty)} ${unit} · ${moneyCOP(pack_price)} · ${cpu!==null?moneyCOP(cpu):"—"} / ${unit}`
    : "Sin empaque (edita con ⚙️)";

  const brand = String(spec?.brand || "").trim();
  const store = String(spec?.store || "").trim();
  const metaB = [brand, store].filter(Boolean).join(" · ") || "—";

  return `
    <div class="pItem cItem" data-k="${escapeHtml(key)}">
      <div class="pItemTop">
        <div>
          <div class="pName">${escapeHtml(key)}</div>
          <div class="pSubLine">${escapeHtml(metaA)}</div>
          <div class="pSubLine" style="margin-top:4px;">Marca/Tienda: ${escapeHtml(metaB)}</div>
        </div>
        <div class="pRight">
          <span class="pPill">${escapeHtml(unit)}</span>
          <button class="pGear" data-act="edit" title="Editar costo">⚙️</button>
        </div>
      </div>
    </div>
  `;
}

function renderCostsGroups(){
  const host = el("costGroups");
  if(!host) return;

  const keysAll = Object.keys(state.costsByKey || {});
  keysAll.sort((a,b)=>a.localeCompare(b,"es"));

  const keys = keysAll.filter(costKeyPasses);
  const groups = groupKeys(keys);

  setCostsMeta(`Ingredientes: ${keysAll.length} · Mostrando: ${keys.length} · Tiendas: ${state.stores.length} · Marcas: ${state.brands.length}`);

  host.innerHTML = groups.map((g, idx)=>{
    const gkeys = (g.keys||[]).filter(k => keys.includes(k));
    if(!gkeys.length) return "";

    const meta = `${gkeys.length} ingrediente(s)`;
    const openAttr = (idx === 0) ? "open" : "";
    const itemsHtml = gkeys.map(k => renderCostItemCard(k)).join("");

    return `
      <details class="pGroup" ${openAttr}>
        <summary>
          <div>
            <div class="pGroupTitle">${escapeHtml(g.title || "Sección")}</div>
            <div class="pGroupMeta">${escapeHtml(meta)}</div>
          </div>
          <div class="pGroupMeta">Toca para abrir</div>
        </summary>
        <div class="pGroupBody">
          ${itemsHtml}
        </div>
      </details>
    `;
  }).join("");
}

function lastSpecLine(row){
  const b = row.base;
  const parts = [];
  if(b.brand) parts.push(b.brand);
  if(b.store) parts.push(b.store);

  let packInfo = "";
  if(b.pack_qty > 0 && b.pack_price > 0){
    packInfo = `Empaque: ${fmtNum(b.pack_qty)} ${b.base_unit || row.unit} · ${moneyCOP(b.pack_price)}`;
  }

  return [parts.join(" · "), packInfo].filter(Boolean).join(" · ") || "Sin detalle de empaque (puedes definirlo con ⚙️)";
}

function renderItemCard(row){
  const plan = getPlan(row.key);

  const needCls = row.need>0 ? "" : "";
  const invCls = row.invBase>=row.need && row.need>0 ? "ok" : "";
  const missCls = row.missing>0 ? "warn" : (row.need>0?"ok":"");

  // Input mode
  const hasPack = row.base.pack_qty > 0;
  const packLabel = hasPack ? "Empaques" : `Cantidad (${row.unit})`;
  const packHint  = hasPack ? `1 empaque = ${fmtNum(row.base.pack_qty)} ${row.unit}` : "";

  const plannedQty = row.planned;
  const est = (row.cpu!==null && plannedQty>0) ? (plannedQty * row.cpu) : null;

  return `
    <div class="pItem" data-k="${escapeHtml(row.key)}">
      <div class="pItemTop">
        <div>
          <div class="pName">${escapeHtml(row.key)}</div>
          <div class="pSubLine">${escapeHtml(lastSpecLine(row))}</div>
        </div>
        <div class="pRight">
          <span class="pPill">${escapeHtml(row.unit)}</span>
          <button class="pGear" data-act="edit" title="Editar presentación">⚙️</button>
        </div>
      </div>

      <div class="pNums">
        <div class="pNum ${needCls}">
          <div class="lbl">Necesario</div>
          <div class="val">${fmtNum(row.need)}</div>
        </div>
        <div class="pNum ${invCls}">
          <div class="lbl">Inventario</div>
          <div class="val">${fmtNum(row.invBase)}</div>
        </div>
        <div class="pNum ${missCls}">
          <div class="lbl">Falta</div>
          <div class="val">${fmtNum(row.missing)}</div>
        </div>
      </div>

      <div class="pBuyRow">
        <div class="pSwitch">
          <label class="switch" title="Marcar para comprar">
            <input type="checkbox" data-act="toggle" ${plan.selected?"checked":""} />
            <span class="slider"></span>
          </label>
          <div style="font-weight:950;">Comprar</div>
        </div>

        <div class="pBuyInputs">
          <input class="input" data-act="packs" type="number" step="any" min="0" placeholder="${escapeHtml(packLabel)}" value="${plan.selected && hasPack && plan.packs?escapeHtml(String(plan.packs)):""}" ${plan.selected?"":"disabled"} />
          <input class="input" data-act="manual" type="number" step="any" min="0" placeholder="Cantidad (${escapeHtml(row.unit)})" value="${plan.selected && (!hasPack) && plan.qty_manual?escapeHtml(String(plan.qty_manual)):""}" ${plan.selected?"":"disabled"} ${hasPack?"style=\"display:none\"":""} />
          <button class="pTinyBtn" data-act="auto" ${plan.selected?"":"disabled"} title="Rellenar con lo que falta">Auto</button>
        </div>

        <div class="pBuyMeta">
          ${packHint ? (escapeHtml(packHint) + " · ") : ""}
          Planeado: <b>${fmtNum(plannedQty)}</b> ${escapeHtml(row.unit)}
          ${row.cpu!==null ? (` · Costo/u: <b>${moneyCOP(row.cpu)}</b>`):""}
          ${est!==null ? (` · Est: <b>${moneyCOP(est)}</b>`):""}
        </div>
      </div>
    </div>
  `;
}

// =============== Totals & confirm ===============
function selectedKeys(){
  return Object.keys(state.buyPlan || {}).filter(k => state.buyPlan[k]?.selected);
}

function totalEstimated(){
  let total = 0;
  let any = false;
  for(const k of selectedKeys()){
    const qty = computePlannedQty(k);
    if(!(qty>0)) continue;
    const cpu = getCostPerUnit(k);
    if(cpu === null) continue;
    total += qty * cpu;
    any = true;
  }
  return { total, any };
}

function refreshBottom(){
  const keys = selectedKeys();
  const n = keys.length;
  const est = totalEstimated();

  if(el("totalCop")) el("totalCop").textContent = est.any ? moneyCOP(est.total) : "$—";
  if(el("totalHint")) el("totalHint").textContent = `${n} ingrediente(s) marcados`;

  const btn = el("btnRegister");
  if(btn) btn.disabled = (n === 0);
}

function openConfirm(){
  const back = el("confirmBack");
  const list = el("confirmList");
  const totalEl = el("confirmTotal");

  const keys = selectedKeys();
  const rows = [];

  for(const k of keys){
    const qty = computePlannedQty(k);
    if(!(qty>0)) continue;
    const unit = getUnitFor(k);
    const cpu = getCostPerUnit(k);
    const est = (cpu!==null) ? (qty * cpu) : null;
    rows.push({ k, qty, unit, cpu, est });
  }

  const sum = rows.reduce((s,r)=> s + (r.est||0), 0);
  if(totalEl) totalEl.textContent = rows.some(r=>r.est!==null) ? moneyCOP(sum) : "$—";

  if(list){
    list.innerHTML = rows.length ? rows.map(r=>`
      <div class="pConfirmItem">
        <div class="pConfirmItemTop">
          <div class="pConfirmItemName">${escapeHtml(r.k)}</div>
          <div style="font-weight:950;">${r.est!==null ? moneyCOP(r.est) : "$—"}</div>
        </div>
        <div class="pConfirmItemMeta">
          Cantidad: <b>${fmtNum(r.qty)}</b> ${escapeHtml(r.unit)}
          ${r.cpu!==null ? (` · Costo/u: ${moneyCOP(r.cpu)}`) : ""}
        </div>
      </div>
    `).join("") : `<div class="hint">No hay cantidades planeadas (revisa empaques/cantidad).</div>`;
  }

  show(back);
}

function closeConfirm(){ hide(el("confirmBack")); }

// =============== Register purchases ===============
function buildPurchaseBatch(){
  const entries = [];
  for(const k of selectedKeys()){
    const qty = computePlannedQty(k);
    if(!(qty>0)) continue;
    const unit = getUnitFor(k);
    const cpu = getCostPerUnit(k);
    const row = { ingredient_key: k, qty, unit };
    if(cpu !== null) row.cop_per_unit = cpu;
    entries.push(row);
  }
  return entries;
}

async function registerPurchases(){
  if(!UNLOCKED_SECRET){
    openUnlock("Ingresa tu clave para continuar.");
    return;
  }

  const items = buildPurchaseBatch();
  if(items.length === 0){
    setMeta("No hay ingredientes con cantidad planeada.");
    return;
  }

  showLoading("Registrando compras…", "Actualizando inventario en la base de datos.");
  try{
    await api({
      action: "inventory_add_purchase_batch",
      costs_secret: UNLOCKED_SECRET,
      updated_by: "PURCHASES_UI",
      source: "PURCHASES_UI",
      items
    }, {timeoutMs: 60000});

    state.buyPlan = {};
    await loadAll();
    setMeta("✅ Compras registradas y inventario actualizado.");
  } catch(err){
    setMeta(`❌ Error registrando compras: ${(err && err.message) ? err.message : "Error"}`);
  } finally {
    hideLoading();
  }
}

// =============== Meta ===============
function setMeta(msg){
  const m = el("meta");
  if(m) m.textContent = msg || "";
}

function updateMetaLine(){
  const used = Number(state.meta?.orders_used || 0);
  const lim  = Number(state.meta?.orders_limit || 0);
  const w0   = String(state.meta?.window_start || "").trim();
  const w1   = String(state.meta?.window_end || "").trim();
  const winText = (w0&&w1) ? `${w0} → ${w1}` : `${Number(state.meta?.window_hours || state.window_h)}h`;
  const ordersText = lim ? `Pedidos: ${used}/${lim}` : `Pedidos: ${used}`;

  const selected = selectedKeys().length;
  setMeta(`Ventana: ${winText} · ${ordersText} · Marcados: ${selected}`);
}

// =============== Data load ===============
async function loadAll(){
  if(!UNLOCKED_SECRET) throw new Error("Sin clave.");

  updateMetaLine();

    const [invOut, needsOut, costsOut, catOut] = await Promise.all([
    api({ action:"inventory_get", costs_secret: UNLOCKED_SECRET }),
    api({ action:"costs_orders_for_purchases", costs_secret: UNLOCKED_SECRET, window_h: state.window_h }),
    api({ action:"costs_list", costs_secret: UNLOCKED_SECRET }),
    api({ action:"catalog_list", costs_secret: UNLOCKED_SECRET }),
  ]);

  state.inventory = invOut.inventory || {};
  state.needs = needsOut.needs || {};
  state.meta = needsOut.meta || {};
  applyCatalogs(catOut);

  state.ordersByDessert = needsOut.orders_by_dessert || needsOut.ordersByDessert || {};
  state.late = needsOut.late || {};
  state.items = costsOut.items || [];
  indexCosts(state.items);

  updateMetaLine();
  renderDesserts();
  renderLate();
  renderGroups();
  renderCostsGroups();
  refreshBottom();
}

// =============== Unlock / logout ===============
function openUnlock(msg){
  if(el("unlockMsg")) el("unlockMsg").textContent = msg || "";
  show(el("unlockBack"));
  hide(el("appRoot"));
  if(el("secretInput")) el("secretInput").focus();
}

function closeUnlock(){
  if(el("unlockMsg")) el("unlockMsg").textContent = "";
  hide(el("unlockBack"));
}

async function doUnlock(isAuto=false){
  const secret = String(el("secretInput")?.value || "").trim();
  if(!secret){
    if(!isAuto && el("unlockMsg")) el("unlockMsg").textContent = "Escribe la clave.";
    return;
  }

  showLoading("Validando…", "Verificando la clave en el servidor.");
  try{
    await validateSecret(secret);
    UNLOCKED_SECRET = secret;
    localStorage.setItem(LS_SECRET_KEY, secret);

    closeUnlock();
    show(el("appRoot"));

    setView("purchases");

    await loadAll();
  } catch(err){
    if(el("unlockMsg")) el("unlockMsg").textContent = (err && err.message) ? err.message : "No autorizado";
    if(!isAuto) localStorage.removeItem(LS_SECRET_KEY);
  } finally {
    hideLoading();
  }
}

function logout(){
  UNLOCKED_SECRET = "";
  localStorage.removeItem(LS_SECRET_KEY);
  state.buyPlan = {};
  openUnlock("Sesión cerrada.");
}

// =============== Cost modal (edit) ===============
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

  if(base_pack_qty>0 && pack_price>0) cpu = pack_price / base_pack_qty;

  if(e.unitExtra) e.unitExtra.style.display = (unit_type === "unidad") ? "block" : "none";
  if(e.computed){
    e.computed.textContent = `Se guardará como: ${base_pack_qty ? fmtNum(base_pack_qty) : "—"} ${base_unit || "—"} por empaque · Costo/u: ${cpu?moneyCOP(cpu):"—"}`;
  }
}

function openCostModal(key){
  const e = cmEls();
  CM.key = key;
  if(e.err) e.err.textContent = "";

  const spec = state.costsByKey?.[key] || null;
  const unit_type = String(spec?.unit_type || "").trim().toLowerCase() || "g";

  if(e.title) e.title.textContent = `Detalle: ${key}`;

  if(e.unitType) e.unitType.value = (unit_type==="g"||unit_type==="ml"||unit_type==="unidad") ? unit_type : "g";
  if(e.packQty) e.packQty.value = spec?.pack_qty ? String(spec.pack_qty) : "";
  if(e.packPrice) e.packPrice.value = spec?.pack_price ? String(spec.pack_price) : "";

  if(e.unitItemQty) e.unitItemQty.value = spec?.unit_item_qty ? String(spec.unit_item_qty) : "";
  if(e.unitItemType) e.unitItemType.value = String(spec?.unit_item_qty_type || "").trim().toLowerCase();

  renderSelect("cmBrand", state.brands || [], String(spec?.brand || ""));
  renderSelect("cmStore", state.stores || [], String(spec?.store || ""));

  cmComputePreview();
  show(e.back);
}

function closeCostModal(){
  hide(el("costModalBack"));
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

    await loadAll();
    closeCostModal();
    setMeta("✅ Costos actualizados.");
  } catch(err){
    if(e.err) e.err.textContent = (err && err.message) ? err.message : "Error guardando.";
  } finally {
    hideLoading();
  }
}

// =============== Catalog manager (Tiendas/Marcas) ===============
async function refreshCatalogs(){
  const out = await api({ action:"catalog_list", costs_secret: UNLOCKED_SECRET });
  applyCatalogs(out);
}

function fillSimpleSelect(selId, arr){
  const s = el(selId);
  if(!s) return;
  const list = Array.isArray(arr) ? arr.map(v=>String(v||"").trim()).filter(Boolean) : [];
  if(list.length === 0){
    s.innerHTML = `<option value="">(vacío)</option>`;
    return;
  }
  s.innerHTML = list.map(v=>`<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
}

function openCatalogModal(){
  if(!UNLOCKED_SECRET){
    openUnlock("Ingresa tu clave para continuar.");
    return;
  }
  if(el("catErr")) el("catErr").textContent = "";
  fillSimpleSelect("catStores", state.stores);
  fillSimpleSelect("catBrands", state.brands);
  show(el("catModalBack"));
}

function closeCatalogModal(){ hide(el("catModalBack")); }

async function addCatalogValue(type, value){
  const v = String(value||"").trim();
  if(!v) throw new Error("Valor vacío.");
  await api({ action:"catalog_add", costs_secret: UNLOCKED_SECRET, type, value: v });
  await refreshCatalogs();
}

async function deleteCatalogValue(type, value){
  const v = String(value||"").trim();
  if(!v) throw new Error("Selecciona un valor.");
  await api({ action:"catalog_delete", costs_secret: UNLOCKED_SECRET, type, value: v });
  await refreshCatalogs();
}

// =============== Events ===============
function bind(){
  // Buttons
  el("btnExit")?.addEventListener("click", logout);
  el("btnReload")?.addEventListener("click", ()=>{ showLoading("Recargando…", "Actualizando datos."); loadAll().finally(hideLoading); });

  // Tabs
  el("btnTabPurchases")?.addEventListener("click", ()=> setView("purchases"));
  el("btnTabCosts")?.addEventListener("click", ()=> setView("costs"));

  // Costos view
  el("btnCostsRefresh")?.addEventListener("click", ()=>{ showLoading("Refrescando…","Leyendo datos actualizados."); loadAll().finally(hideLoading); });
  el("btnCatalogs")?.addEventListener("click", ()=> openCatalogModal());
  el("inpCostSearch")?.addEventListener("input", (e)=>{ state.ui.cost_q = String(e.target.value||""); renderCostsGroups(); });

  // Unlock
  el("btnDoUnlock")?.addEventListener("click", ()=>doUnlock(false));
  el("btnClear")?.addEventListener("click", ()=>{ if(el("secretInput")) el("secretInput").value = ""; if(el("unlockMsg")) el("unlockMsg").textContent = ""; el("secretInput")?.focus(); });
  el("secretInput")?.addEventListener("keydown", (e)=>{ if(e.key === "Enter") doUnlock(false); });

  // Controls
  el("inpSearch")?.addEventListener("input", (e)=>{ state.ui.q = String(e.target.value||""); renderGroups(); refreshBottom(); updateMetaLine(); });
  el("chkOnlyMissing")?.addEventListener("change", (e)=>{ state.ui.onlyMissing = !!e.target.checked; renderGroups(); refreshBottom(); updateMetaLine(); });
  el("chkOnlySelected")?.addEventListener("change", (e)=>{ state.ui.onlySelected = !!e.target.checked; renderGroups(); refreshBottom(); updateMetaLine(); });

  // Cost list interactions
  el("costGroups")?.addEventListener("click", (e)=>{
    const btn = e.target.closest("button");
    if(!btn) return;
    const card = e.target.closest(".pItem");
    const key = card ? String(card.getAttribute("data-k")||"") : "";
    if(!key) return;
    const act = btn.getAttribute("data-act") || "";
    if(act === "edit") openCostModal(key);
  });

  // Group interactions (event delegation)
  el("groups")?.addEventListener("click", (e)=>{
    const btn = e.target.closest("button");
    if(!btn) return;
    const card = e.target.closest(".pItem");
    const key = card ? String(card.getAttribute("data-k")||"") : "";
    if(!key) return;

    const act = btn.getAttribute("data-act") || "";
    if(act === "edit"){
      openCostModal(key);
      return;
    }
    if(act === "auto"){
      const r = computeRow(key);
      const p = getPlan(key);
      p.selected = true;
      const needBuy = Math.max(0, r.need - r.invBase);
      if(r.base.pack_qty>0){
        p.packs = needBuy>0 ? Math.ceil(needBuy / r.base.pack_qty) : 0;
        p.qty_manual = 0;
      } else {
        p.qty_manual = needBuy>0 ? needBuy : 0;
        p.packs = 0;
      }
      renderGroups();
      refreshBottom();
      updateMetaLine();
    }
  });

  // Inputs & switches (delegation)
  el("groups")?.addEventListener("change", (e)=>{
    const card = e.target.closest(".pItem");
    const key = card ? String(card.getAttribute("data-k")||"") : "";
    if(!key) return;

    const act = e.target.getAttribute("data-act") || "";
    const plan = getPlan(key);

    if(act === "toggle"){
      plan.selected = !!e.target.checked;
      if(!plan.selected){ plan.packs = 0; plan.qty_manual = 0; }
      renderGroups();
      refreshBottom();
      updateMetaLine();
      return;
    }

    if(act === "packs"){
      plan.packs = Number(e.target.value||0);
      plan.selected = true;
      renderGroups();
      refreshBottom();
      updateMetaLine();
      return;
    }

    if(act === "manual"){
      plan.qty_manual = Number(e.target.value||0);
      plan.selected = true;
      renderGroups();
      refreshBottom();
      updateMetaLine();
      return;
    }
  });

  // Bottom bar
  el("btnRegister")?.addEventListener("click", ()=>{ openConfirm(); });

  // Confirm modal
  el("btnConfirmClose")?.addEventListener("click", closeConfirm);
  el("btnConfirmCancel")?.addEventListener("click", closeConfirm);
  el("btnConfirmGo")?.addEventListener("click", async ()=>{
    closeConfirm();
    await registerPurchases();
    renderGroups();
    refreshBottom();
  });

  // Cost modal
  el("cmCancelX")?.addEventListener("click", closeCostModal);
  el("cmSave")?.addEventListener("click", saveCostModal);
  el("cmOpenCatalogs")?.addEventListener("click", ()=> openCatalogModal());
  ["cmUnitType","cmPackQty","cmPackPrice","cmUnitItemQty","cmUnitItemType"].forEach(id=>{
    el(id)?.addEventListener("input", cmComputePreview);
    el(id)?.addEventListener("change", cmComputePreview);
  });

  // Catalog modal
  el("catCloseX")?.addEventListener("click", closeCatalogModal);
  el("btnAddStore")?.addEventListener("click", async ()=>{
    try{
      if(el("catErr")) el("catErr").textContent = "";
      showLoading("Guardando…","Agregando tienda.");
      await addCatalogValue("stores", el("catStoreNew")?.value);
      if(el("catStoreNew")) el("catStoreNew").value = "";
      fillSimpleSelect("catStores", state.stores);
      fillSimpleSelect("catBrands", state.brands);
      setGlobalMsg("✅ Tienda agregada.");
    }catch(err){
      if(el("catErr")) el("catErr").textContent = err?.message || "Error";
    }finally{ hideLoading(); }
  });
  el("btnDelStore")?.addEventListener("click", async ()=>{
    try{
      if(el("catErr")) el("catErr").textContent = "";
      const v = el("catStores")?.value;
      showLoading("Guardando…","Eliminando tienda.");
      await deleteCatalogValue("stores", v);
      fillSimpleSelect("catStores", state.stores);
      setGlobalMsg("✅ Tienda eliminada.");
    }catch(err){
      if(el("catErr")) el("catErr").textContent = err?.message || "Error";
    }finally{ hideLoading(); }
  });
  el("btnAddBrand")?.addEventListener("click", async ()=>{
    try{
      if(el("catErr")) el("catErr").textContent = "";
      showLoading("Guardando…","Agregando marca.");
      await addCatalogValue("brands", el("catBrandNew")?.value);
      if(el("catBrandNew")) el("catBrandNew").value = "";
      fillSimpleSelect("catBrands", state.brands);
      fillSimpleSelect("catStores", state.stores);
      setGlobalMsg("✅ Marca agregada.");
    }catch(err){
      if(el("catErr")) el("catErr").textContent = err?.message || "Error";
    }finally{ hideLoading(); }
  });
  el("btnDelBrand")?.addEventListener("click", async ()=>{
    try{
      if(el("catErr")) el("catErr").textContent = "";
      const v = el("catBrands")?.value;
      showLoading("Guardando…","Eliminando marca.");
      await deleteCatalogValue("brands", v);
      fillSimpleSelect("catBrands", state.brands);
      setGlobalMsg("✅ Marca eliminada.");
    }catch(err){
      if(el("catErr")) el("catErr").textContent = err?.message || "Error";
    }finally{ hideLoading(); }
  });

  // Close modal by clicking outside
  el("costModalBack")?.addEventListener("click", (e)=>{ if(e.target === el("costModalBack")) closeCostModal(); });
  el("confirmBack")?.addEventListener("click", (e)=>{ if(e.target === el("confirmBack")) closeConfirm(); });
  el("catModalBack")?.addEventListener("click", (e)=>{ if(e.target === el("catModalBack")) closeCatalogModal(); });
}

// =============== Boot ===============
(function init(){
  bind();

  const saved = String(localStorage.getItem(LS_SECRET_KEY) || "").trim();
  if(saved){
    if(el("secretInput")) el("secretInput").value = saved;
    // auto unlock
    doUnlock(true);
  } else {
    openUnlock("");
  }
})();
