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

// --- RECETAS (desde hoja RECETAS) ---
state.recipesByDessert = null; // {dessert_id: [{ingredient_key, qty_per_unit, unit}]}
state.recipesSource = "embedded"; // "sheet" | "embedded"
state.recipesPinUnlocked = false;
state.recipesPin = "";
state.desserts = [];

// ====== Costo unitario por postre (recetas canónicas) ======
const AMARED_RECIPES_PER_UNIT = {
  "mousse_maracuya": [
    [
      "Pulpa de maracuyá",
      21.4
    ],
    [
      "Leche condensada",
      42.8
    ],
    [
      "Crema de leche",
      42.8
    ],
    [
      "Leche entera",
      42.8
    ],
    [
      "Gelatina sin sabor",
      1.25
    ],
    [
      "Agua",
      8.3
    ],
    [
      "Vainilla",
      0.33
    ],
    [
      "Galletas saladas",
      25.0
    ],
    [
      "Mantequilla sin sal",
      11.7
    ],
    [
      "Chocorramo",
      20.0
    ],
    [
      "Chocolate en polvo",
      20.0
    ],
    [
      "Envase plástico",
      1.0
    ],
    [
      "Cuchara plástica",
      1.0
    ]
  ],
  "cheesecake_cafe_panela": [
    [
      "Galletas saladas",
      25.0
    ],
    [
      "Mantequilla sin sal",
      10.0
    ],
    [
      "Queso crema",
      75.0
    ],
    [
      "Crema de leche",
      41.7
    ],
    [
      "Leche condensada",
      25.0
    ],
    [
      "Café",
      10.0
    ],
    [
      "Panela",
      3.33
    ],
    [
      "Gelatina sin sabor",
      1.67
    ],
    [
      "Agua",
      7.5
    ],
    [
      "Vainilla",
      0.33
    ],
    [
      "Galleta de leche",
      25.0
    ],
    [
      "Envase plástico",
      1.0
    ],
    [
      "Cuchara plástica",
      1.0
    ]
  ]
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


function parseNumFlex_(v){
  if(v == null) return 0;
  if(typeof v === "number") return isFinite(v) ? v : 0;
  const s = String(v).trim();
  if(!s) return 0;
  // soporta coma decimal
  const n = parseFloat(s.replace(",", "."));
  return isFinite(n) ? n : 0;
}

function escapeHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));
}

function escapeHtmlAttr(s){
  return escapeHtml(s).replace(/"/g,"&quot;");
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
  const v = (view === "costs") ? "costs" : (view === "recipes" ? "recipes" : "purchases");
  state.view = v;

  const vp = el("viewPurchases");
  const vc = el("viewCosts");
  const vr = el("viewRecipes");
  const bb = el("bottomBar");

  const tp = el("btnTabPurchases");
  const tc = el("btnTabCosts");
  const tr = el("btnTabRecipes");

  if(tp){ tp.classList.remove("isActive"); tp.setAttribute("aria-selected","false"); }
  if(tc){ tc.classList.remove("isActive"); tc.setAttribute("aria-selected","false"); }
  if(tr){ tr.classList.remove("isActive"); tr.setAttribute("aria-selected","false"); }

  show(vp); hide(vc); hide(vr);
  if(bb) bb.style.display = "";

  if(v === "costs"){
    hide(vp);
    show(vc);
    if(bb) bb.style.display = "none";
    if(tc){ tc.classList.add("isActive"); tc.setAttribute("aria-selected","true"); }
    renderCostsGroups();
    renderUnitCosts();
    return;
  }

  if(v === "recipes"){
    hide(vp); hide(vc); show(vr);
    if(bb) bb.style.display = "none";
    if(tr){ tr.classList.add("isActive"); tr.setAttribute("aria-selected","true"); }
    ensureRecipesUnlocked_();
    return;
  }

  show(vp); hide(vc); hide(vr);
  if(tp){ tp.classList.add("isActive"); tp.setAttribute("aria-selected","true"); }
  renderGroups();
  refreshBottom();
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

// =============== RECETAS (desde hoja RECETAS) ===============
function normText_(s){
  return String(s||"")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/\s+/g," ")
    .trim();
}
const DESSERT_NAME_TO_ID_ = {
  "mousse de maracuya": "mousse_maracuya",
  "mousse de maracuya ": "mousse_maracuya",
  "mousse de maracuyá": "mousse_maracuya",
  "cheesecake de cafe con panela": "cheesecake_cafe_panela",
  "cheesecake de café con panela": "cheesecake_cafe_panela",
  "arroz con leche": "arroz_con_leche"
};

function normRecipeUnit_(u){
  const t = String(u||"").trim().toLowerCase();
  if(!t) return "";
  if(t === "u" || t === "und" || t === "unidad" || t === "unidades") return "unidad";
  if(t === "g" || t === "gr" || t === "gramo" || t === "gramos") return "g";
  if(t === "ml" || t === "mililitro" || t === "mililitros") return "ml";
  return t;
}

function buildRecipesIndex_(items){
  const out = {};
  const rows = Array.isArray(items) ? items : [];
  for(const r of rows){
    const didRaw = String(r?.dessert_id || r?.dessertId || "").trim();
    const dname = String(r?.dessert_name || r?.dessertName || "").trim();
    const did = didRaw || (DESSERT_NAME_TO_ID_[normText_(dname)] || "");
    if(!did) continue;

    const ing = String(r?.ingredient_key || r?.ingredientKey || r?.key || "").trim();
    if(!ing) continue;

    const qty = parseNumFlex_(r?.qty_per_unit ?? r?.qtyPerUnit ?? r?.qty ?? 0);
    if(!(qty > 0)) continue;

    const unit = normRecipeUnit_(r?.unit);
    if(!unit) continue;

    if(!out[did]) out[did] = [];
    out[did].push({ ingredient_key: ing, qty_per_unit: qty, unit });
  }

  // ordenar por nombre ingrediente para consistencia visual
  for(const k of Object.keys(out)){
    out[k].sort((a,b)=> String(a.ingredient_key||"").localeCompare(String(b.ingredient_key||""),"es"));
  }
  return out;
}

async function loadRecipesFromSheet_(){
  state.recipesByDessert = null;
  state.recipesSource = "embedded";
  try{
    const out = await api({ action:"recipes_list", costs_secret: UNLOCKED_SECRET }, {timeoutMs: 45000});
    const idx = buildRecipesIndex_(out.items || []);
    if(Object.keys(idx).length){
      state.recipesByDessert = idx;
      state.recipesSource = "sheet";
    }
  }catch(_e){
    // fallback: embedded (AMARED_RECIPES_PER_UNIT)
    state.recipesByDessert = null;
    state.recipesSource = "embedded";
  }
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

  const cpuOr = ((pack_qty>0 && pack_price>0) ? (pack_price/pack_qty) : ((cpuStored>0 && isFinite(cpuStored)) ? cpuStored : null));

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

  // 🔶 Asignación manual por sección (desde COSTOS_INGREDIENTES.section_title)
  const titleToGroup = {};

  // Primero: ubicar ingredientes con sección fija
  for(const k of (keys||[])){
    const kk = String(k||"").trim();
    if(!kk) continue;
    const spec = state.costsByKey?.[kk];
    const sec = String(spec?.section_title || spec?.section || "").trim();
    if(!sec) continue;

    // crear grupo si no existe
    let grp = out.find(x=>String(x.title||"")===sec);
    if(!grp){
      grp = { title: sec, keys: [] };
      out.push(grp);
    }
    // evitar duplicados
    if(!used.has(kk)){
      grp.keys.push(kk);
      used.add(kk);
    }
  }

  if(groups){
    for(const g of groups){
      const t = String(g?.title||"").trim();
      if(t) titleToGroup[t] = g;
    }
  }

  // índice por canonicalKey para tolerar tildes, comas, etc.
  const keyByCanon = {};
  for(const k of (keys||[])){
    const kk = String(k||"").trim();
    if(!kk) continue;
    const c = canonicalKey(kk);
    if(c && !keyByCanon[c]) keyByCanon[c] = kk;
  }


  // Primero: ubicar ingredientes con sección fija
  for(const k of (keys||[])){
    const kk = String(k||"").trim();
    if(!kk) continue;
    const spec = state.costsByKey?.[kk];
    const sec = String(spec?.section_title || spec?.section || "").trim();
    if(!sec) continue;

    // crear grupo si no existe
    let grp = out.find(x=>String(x.title||"")===sec);
    if(!grp){
      grp = { title: sec, keys: [] };
      out.push(grp);
    }
    // evitar duplicados
    if(!used.has(kk)){
      grp.keys.push(kk);
      used.add(kk);
    }
  }

  if(groups){
    for(const g of groups){
      const title = String(g?.title || "").trim();
      const gkeys = [];
      for(const raw of (g?.keys || [])){
        const wantedRaw = String(raw||"").trim();
        if(!wantedRaw) continue;
        const hit = keyByCanon[canonicalKey(wantedRaw)] || null;
        if(hit && !used.has(hit)){
          gkeys.push(hit);
          used.add(hit);
        }
      }
      if(gkeys.length) out.push({ title, keys: gkeys });
    }
  }

  // ✅ No crear sección "Otros". Si queda algo por fuera, lo anexamos a la primera sección.
  const other = (keys||[]).filter(k => k && !used.has(k));
  other.sort((a,b)=>String(a).localeCompare(String(b),"es"));
  if(other.length){
    if(out.length){
      out[0].keys = out[0].keys.concat(other);
    }else{
      out.push({ title: "Ingredientes", keys: other });
    }
  }

  return out;
}

function groupAccent_(idx){
  const palette = ["var(--caramel)","var(--pink)","var(--beige)","rgba(64,17,2,.35)","rgba(242,91,143,.45)","rgba(246,186,96,.45)"];
  const i = Math.abs(Number(idx||0)) % palette.length;
  return palette[i];
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

function canonicalKey(s){
  return String(s||"")
    .trim()
    .replace(/,+$/g,"")
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g," ")
    .replace(/\s+/g," ")
    .trim();
}


function ensurePackagingSection(){
  state.sections = state.sections || [];
  if(!state.sections.length) return;
  const sec0 = state.sections[0];
  sec0.keys = Array.isArray(sec0.keys) ? sec0.keys : [];
  for(const k of ["Envase plástico", "Cuchara plástica"]){
    if(!sec0.keys.includes(k)) sec0.keys.push(k);
  }
}

function ensurePackagingEntries(){
  state.costsByKey = state.costsByKey || {};
  state.needs = state.needs || {};

  for(const k of ["Envase plástico", "Cuchara plástica"]){
    if(!(k in state.needs)) state.needs[k] = 0;
    if(!state.costsByKey[k]){
      state.costsByKey[k] = {
        ingredient_key: k,
        unit_type: "u",
        pack_qty: 0,
        pack_price: 0,
        cop_per_unit: null,
        brand: "",
        store: "",
        updated_at: "",
        updated_by: ""
      };
    }
  }

  const by = state.ordersByDessert || {};
  let total = 0;
  for(const v of Object.values(by)) total += Number(v||0)||0;
  if(total>0){
    for(const k of ["Envase plástico", "Cuchara plástica"]){
      state.needs[k] = Math.max(Number(state.needs[k]||0)||0, total);
    }
  }
}

function buildCostAliasMap(){
  const map = {};
  for(const k of Object.keys(state.costsByKey||{})) map[canonicalKey(k)] = k;
  state._costAlias = map;
}

function cpuFor(key){
  const k0 = String(key||"").trim();
  const alias = state._costAlias?.[canonicalKey(k0)];
  const k = alias || k0;
  return getCostPerUnit(k);
}

function resolveCostForRecipe_(ingredientKey, recipeUnit){
  const ik0 = String(ingredientKey||"").trim();
  const alias = state._costAlias?.[canonicalKey(ik0)];
  const ik = alias || ik0;

  const spec = state.costsByKey?.[ik] || null;
  const base = baseFromSpec(spec);

  const want = normRecipeUnit_(recipeUnit);
  const have = normRecipeUnit_(base.base_unit);

  if(base.cpu === null || base.cpu === undefined || !(Number(base.cpu) > 0)) {
    return { ok:false, reason:"missing_cost", ingredient_key: ik0 };
  }

  let note = "";
  // Si la receta especifica unidad, validar compatibilidad
  if(want && have && want !== have){
    const bothMassVol = ((want==="g"||want==="ml") && (have==="g"||have==="ml"));
    if(bothMassVol){
      // ✅ Para visualización de costos, permitimos g↔ml asumiendo 1:1 (aprox)
      note = "approx_g_ml";
    }else{
      return { ok:false, reason:`unit_mismatch:${want}:${have}`, ingredient_key: ik0 };
    }
  }

  return { ok:true, ingredient_key: ik, cpu: Number(base.cpu), base_unit: have || base.base_unit || "", note };
}


function moneyCOP2(n){
  const v = Number(n||0);
  const frac = Math.abs(v - Math.round(v)) > 1e-9;
  return "$" + v.toLocaleString("es-CO", { maximumFractionDigits: frac ? 2 : 0 });
}

function dessertUnitBreakdown_(dessertId, lotQty){
  const bySheet = state.recipesByDessert?.[dessertId] || null;

  let lines = [];
  let missing = [];
  let sum = 0;
  let source = "embedded";

  if(bySheet && bySheet.length){
    source = "sheet";
    for(const r of bySheet){
      const ik = String(r.ingredient_key||"").trim();
      const qty = Number(r.qty_per_unit||0) || 0;
      const unit = normRecipeUnit_(r.unit);
      if(!ik || !(qty>0) || !unit) continue;

      const rc = resolveCostForRecipe_(ik, unit);
      if(!rc.ok){
        missing.push(ik);
        continue;
      }
      const sub = qty * rc.cpu;
      sum += sub;
      lines.push({ ingredient_key: rc.ingredient_key, qty, unit, cpu: rc.cpu, cpu_unit: rc.base_unit || unit, note: rc.note || "", subtotal: sub });
    }
  } else {
    // fallback: recetas embebidas (compat)
    const rec = AMARED_RECIPES_PER_UNIT[dessertId] || [];
    for(const pair of rec){
      const ik = String(pair?.[0]||"").trim();
      const qty = Number(pair?.[1]||0) || 0;
      if(!ik || !(qty>0)) continue;
      const cpu = cpuFor(ik);
      if(cpu===null || cpu===undefined){ missing.push(ik); continue; }
      const sub = qty * Number(cpu||0);
      sum += sub;
      lines.push({ ingredient_key: ik, qty, unit: "", cpu: Number(cpu||0), cpu_unit: "", subtotal: sub });
    }
  }

  // ordenar por subtotal desc para lectura rápida
  lines.sort((a,b)=> (b.subtotal||0) - (a.subtotal||0));

  const lot = (lotQty && sum) ? (sum * lotQty) : null;
  return { dessertId, source, lines, missing, sum, lotQty: Number(lotQty||0)||0, lot };
}

function unitBreakdownHtml_(b){
  const lotQty = b.lotQty || 0;
  const missing = Array.isArray(b.missing) ? b.missing : [];
  const hasMiss = missing.length > 0;

  const header = `<div class="hint" style="margin-bottom:8px;">Ingredientes por <b>1 unidad</b>${b.source==="sheet" ? " (RECETAS)" : ""}</div>`;

  const list = b.lines.length ? b.lines.map(x=>`
    <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start;">
      <div style="min-width:0;">
        <div style="font-weight:950;">${escapeHtml(x.ingredient_key)}</div>
        <div style="opacity:.75; font-weight:850; font-size:12.5px; margin-top:2px;">
          ${fmtNum(x.qty)} ${escapeHtml(x.unit || "")}${x.note ? ` <span style="opacity:.7;">(≈)</span>` : ""}
          ${x.cpu ? (` · ${moneyCOP2(x.cpu)}/${escapeHtml(x.cpu_unit || x.unit || "")}`) : ""}
        </div>
      </div>
      <div style="font-weight:950; white-space:nowrap;">${moneyCOP2(x.subtotal)}</div>
    </div>
  `).join(`<div style="height:8px;"></div>`) : `<div class="hint">No hay ingredientes en la receta.</div>`;

  const total = `<div style="border-top:1px solid rgba(64,17,2,.10); padding-top:10px; margin-top:10px; display:flex; justify-content:space-between;">
      <div style="font-weight:950;">Total unitario</div>
      <div style="font-weight:950; white-space:nowrap;">${moneyCOP2(b.sum)}</div>
    </div>`;

  const lot = (lotQty>0) ? `<div style="opacity:.85; font-weight:850; margin-top:6px; display:flex; justify-content:space-between;">
      <div>Total lote (${fmtNum(lotQty)} u)</div>
      <div style="white-space:nowrap;">${b.lot!==null ? moneyCOP2(b.lot) : "$—"}</div>
    </div>` : "";

  const miss = hasMiss ? `<div class="hint" style="margin-top:10px; color:#b32020; font-weight:950;">
      Faltan costos o unidades compatibles para: ${escapeHtml(missing.slice(0,10).join(", "))}${missing.length>10?"…":""}
    </div>` : "";

  return `<div style="padding:10px 12px;">${header}${list}${total}${lot}${miss}</div>`;
}

function dessertUnitCost(dessertId){
  const b = dessertUnitBreakdown_(dessertId, 0);
  return { sum: b.sum, missing: b.missing };
}

function renderUnitCosts(){
  const tbody = el("unitCostRows");
  const meta = el("unitCostMeta");
  if(!tbody) return;

  ensurePackagingEntries();
  buildCostAliasMap();

  const by = state.ordersByDessert || {};
  const baseIds = ["mousse_maracuya","cheesecake_cafe_panela","arroz_con_leche"];
  const extra = Object.keys(by).filter(k => !baseIds.includes(k) && Number(by[k]||0)>0);
  const all = baseIds.concat(extra);

  state.ui.unitOpen = state.ui.unitOpen || {};

  const rows = [];
  const miss = new Set();

  for(const id of all){
    const qty = Number(by[id]||0)||0;
    const b = dessertUnitBreakdown_(id, qty);
    b.missing.forEach(x=>miss.add(x));
    const unit = b.missing.length ? null : b.sum;
    const lote = (unit!==null) ? (unit*qty) : null;
    rows.push({ id, qty, unit, lote, open: !!state.ui.unitOpen[id], breakdown: b });
  }

  tbody.innerHTML = rows.map(r=>`
    <tr data-dessert="${escapeHtml(r.id)}" style="cursor:pointer;">
      <td>${escapeHtml(prettyDessertName(r.id))} <span style="opacity:.55; font-weight:950;">${r.open?"▾":"▸"}</span></td>
      <td class="num">${r.unit!==null ? moneyCOP2(r.unit) : "$—"}</td>
      <td class="num">${r.unit!==null ? moneyCOP2(r.unit/0.40) : "$—"}</td>
      <td class="num">${r.lote!==null ? moneyCOP2(r.lote) : "$—"}</td>
    </tr>
    <tr data-detail="${escapeHtml(r.id)}" style="${r.open ? "" : "display:none;"}">
      <td colspan="4" style="padding:0; background: rgba(255,255,255,.55);">
        ${unitBreakdownHtml_(r.breakdown)}
      </td>
    </tr>
  `).join("");

  const src = (state.recipesSource === "sheet") ? "RECETAS" : "receta embebida";
  meta.textContent = miss.size
    ? (`(${src}) Faltan costos de: ` + Array.from(miss).slice(0,8).join(", ") + (miss.size>8?"…":""))
    : (`OK (${src}) · Precio 60% = costo / 0.40`);
}


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
    const openAttr = "";
    const accent = groupAccent_(idx);

    const itemsHtml = keys.map(k => renderItemCard(computeRow(k))).join("");

    return `
      <details class="pGroup" ${openAttr} style="--gacc:${accent}; border-left:6px solid var(--gacc);">
        <summary style="padding-left:10px;">
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
    ? `Empaque: ${fmtNum(pack_qty)} ${unit} · ${moneyCOP(pack_price)} · ${cpu!==null?moneyCOP2(cpu):"—"} / ${unit}`
    : "Sin empaque (edita con ⚙️)";

  const brand = String(spec?.brand || "").trim();
  const store = String(spec?.store || "").trim();
  const metaB = [brand, store].filter(Boolean).join(" · ") || "—";

  return `
    <div class="pItem cItem" data-k="${escapeHtml(key)}" style="border-left:6px solid var(--gacc, rgba(64,17,2,.14));">
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
    const openAttr = "";
    const accent = groupAccent_(idx);
    const itemsHtml = gkeys.map(k => renderCostItemCard(k)).join("");

    return `
      <details class="pGroup" ${openAttr} style="--gacc:${accent}; border-left:6px solid var(--gacc);">
        <summary style="padding-left:10px;">
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
    <div class="pItem" data-k="${escapeHtml(row.key)}" style="border-left:6px solid var(--gacc, rgba(64,17,2,.14));">
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
          ${row.cpu!==null ? (` · Costo/u: <b>${moneyCOP2(row.cpu)}</b>`):""}
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

  // Recetas desde hoja RECETAS (para costo unitario)
  await loadRecipesFromSheet_();

  updateMetaLine();
  renderDesserts();
  renderUnitCosts();
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
    e.computed.textContent = `Se guardará como: ${base_pack_qty ? fmtNum(base_pack_qty) : "—"} ${base_unit || "—"} por empaque · Costo/u: ${cpu?moneyCOP2(cpu):"—"}`;
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



let ingDeleteTimer = null;
let ingDeleteCountdown = 0;
let ingDeletePendingKey = "";

function openIngredientsModal(){
  if(!UNLOCKED_SECRET){
    openUnlock("Ingresa tu clave para continuar.");
    return;
  }
  if(el("ingAddMsg")) el("ingAddMsg").textContent = "";
  if(el("ingDelMsg")) el("ingDelMsg").textContent = "";
  // Secciones disponibles (desde kitchen-costs.js)
  const secSel = el("ingNewSection");
  if(secSel){
    const base = Array.isArray(window.AMARED_COSTS_SECTIONS) ? window.AMARED_COSTS_SECTIONS.map(s=>String(s.title||"").trim()).filter(Boolean) : [];
    // incluir secciones personalizadas que ya existan en COSTOS_INGREDIENTES
    const extra = [];
    for(const k of Object.keys(state.costsByKey||{})){
      const t = String(state.costsByKey?.[k]?.section_title || state.costsByKey?.[k]?.section || "").trim();
      if(t) extra.push(t);
    }
    const uniq = Array.from(new Set(["(Sin asignar)"].concat(base).concat(extra)));
    secSel.innerHTML = uniq.map(t=>{
      const val = (t==="(Sin asignar)") ? "" : t;
      return `<option value="${escapeHtmlAttr(val)}">${escapeHtml(t)}</option>`;
    }).join("");
  }

  // llenar select con ingredientes actuales (desde COSTOS_INGREDIENTES)
  const keys = Object.keys(state.costsByKey||{}).sort((a,b)=>a.localeCompare(b,"es"));
  const sel = el("ingSelect");
  if(sel){
    sel.innerHTML = keys.map(k=>`<option value="${escapeHtmlAttr(k)}">${escapeHtml(k)}</option>`).join("");
  }
  show(el("ingModalBack"));
}
function closeIngredientsModal(){ hide(el("ingModalBack")); }



function openIngConfirm(key){
  ingDeletePendingKey = String(key||"").trim();
  if(el("ingConfirmName")) el("ingConfirmName").textContent = ingDeletePendingKey || "—";
  if(el("ingConfirmCountdown")) el("ingConfirmCountdown").textContent = "";
  ingDeleteCountdown = 2;

  const btn = el("ingConfirmGo");
  if(btn){
    btn.disabled = true;
    btn.textContent = `Eliminar (${ingDeleteCountdown})`;
  }
  show(el("ingConfirmBack"));

  if(ingDeleteTimer) clearInterval(ingDeleteTimer);
  ingDeleteTimer = setInterval(()=>{
    ingDeleteCountdown -= 1;
    const b = el("ingConfirmGo");
    if(!b) return;
    if(ingDeleteCountdown > 0){
      b.disabled = true;
      b.textContent = `Eliminar (${ingDeleteCountdown})`;
    }else{
      b.disabled = false;
      b.textContent = "Eliminar";
      clearInterval(ingDeleteTimer);
      ingDeleteTimer = null;
    }
  }, 1000);
}

function closeIngConfirm(){
  if(ingDeleteTimer) clearInterval(ingDeleteTimer);
  ingDeleteTimer = null;
  ingDeleteCountdown = 0;
  ingDeletePendingKey = "";
  hide(el("ingConfirmBack"));
}
function normalizeUnitType_(u){
  const t = String(u||"").trim().toLowerCase();
  if(t==="g"||t==="gr"||t==="gramo"||t==="gramos") return "g";
  if(t==="ml"||t==="mililitro"||t==="mililitros") return "ml";
  if(t==="u"||t==="und"||t==="unidad"||t==="unidades") return "unidad";
  return t;
}

async function addIngredient(){
  if(state.ingBusy) return;
  state.ingBusy = true;
  const btn = el("btnAddIng"); if(btn) btn.disabled = true;
  showLoading("Publicando ingrediente…","Guardando en COSTOS_INGREDIENTES e INVENTARIO.");

  const key = String(el("ingNewKey")?.value||"").trim();
  const unit_type = normalizeUnitType_(el("ingNewUnit")?.value||"");
  const section_title = String(el("ingNewSection")?.value||"").trim();
  const unit_item_qty_raw = String(el("ingUnitItemQty")?.value||"").trim();
  const unit_item_qty = unit_item_qty_raw ? Number(unit_item_qty_raw.replace(",", ".")) : null;
  const unit_item_qty_type = normalizeUnitType_(el("ingUnitItemQtyType")?.value||"");

  if(!key) throw new Error("Escribe el nombre del ingrediente.");
  if(!unit_type || !["g","ml","unidad"].includes(unit_type)) throw new Error("Selecciona un tipo válido (g/ml/unidad).");
  if(unit_item_qty_raw && !(unit_item_qty>0)) throw new Error("Cantidad por unidad inválida.");
  if(unit_item_qty_raw && !["g","ml"].includes(unit_item_qty_type)) throw new Error("Selecciona g o ml en “Cantidad por unidad”.");

  try{
  await api({
    action:"ingredient_add",
    costs_secret: UNLOCKED_SECRET,
    ingredient_key: key,
    unit_type,
    section_title,
    unit_item_qty: unit_item_qty_raw ? unit_item_qty : "",
    unit_item_qty_type: unit_item_qty_raw ? unit_item_qty_type : ""
  });

  // refrescar costos/inventario para que aparezca de inmediato
  await loadAll();
  } finally {
    hideLoading();
    state.ingBusy = false;
    const btn2 = el("btnAddIng"); if(btn2) btn2.disabled = false;
  }
  if(el("ingNewKey")) el("ingNewKey").value = "";
  if(el("ingUnitItemQty")) el("ingUnitItemQty").value = "";
  if(el("ingUnitItemQtyType")) el("ingUnitItemQtyType").value = "";
  if(el("ingAddMsg")) el("ingAddMsg").textContent = "Ingrediente agregado con éxito.";
}

async function deleteIngredient(){
  if(state.ingBusy) return;
  state.ingBusy = true;
  const btn = el("btnDelIng"); if(btn) btn.disabled = true;
  showLoading("Eliminando ingrediente…","Actualizando base de datos.");

  const key = String(el("ingSelect")?.value||"").trim();
  if(!key) throw new Error("Selecciona un ingrediente.");
  // Confirmación mínima (sin ventanas nativas para no bloquear UX)
  try{
  await api({ action:"ingredient_delete", costs_secret: UNLOCKED_SECRET, ingredient_key: key });
  await loadAll();
  } finally {
    hideLoading();
    state.ingBusy = false;
    const btn2 = el("btnDelIng"); if(btn2) btn2.disabled = false;
  }
  if(el("ingDelMsg")) el("ingDelMsg").textContent = "Ingrediente eliminado.";
}
function normalizeCatalogType_(type){
  const t = String(type||"").trim().toLowerCase();
  if(t === "stores" || t === "store" || t === "tiendas") return "store";
  if(t === "brands" || t === "brand" || t === "marcas") return "brand";
  return t;
}

async function addCatalogValue(type, value){
  const v = String(value||"").trim();
  if(!v) throw new Error("Valor vacío.");
  const t = normalizeCatalogType_(type);
  await api({ action:"catalog_add", costs_secret: UNLOCKED_SECRET, type: t, value: v });
  await refreshCatalogs();
}

async function deleteCatalogValue(type, value){
  const v = String(value||"").trim();
  if(!v) throw new Error("Selecciona un valor.");
  const t = normalizeCatalogType_(type);
  await api({ action:"catalog_delete", costs_secret: UNLOCKED_SECRET, type: t, value: v });
  await refreshCatalogs();
}


function resetRecipesAuth_(){
  state.recipesPinUnlocked = false;
  state.recipesPin = "";
state.desserts = [];
  try{ localStorage.removeItem("amared_recipes_pin"); }catch(_e){}
}

// =============== Recetas (admin) ===============
function getStoredRecipesPin_(){
  try{ return String(localStorage.getItem("amared_recipes_pin")||""); }catch(_e){ return ""; }
}
function storeRecipesPin_(pin){
  try{ localStorage.setItem("amared_recipes_pin", String(pin||"")); }catch(_e){}
}

async function validateRecipesPin_(pin){
  const p = String(pin||"").trim();
  if(!p) return false;
  try{
    const out = await api({ action:"recipes_pin_check", costs_secret: UNLOCKED_SECRET, recipes_pin: p }, {timeoutMs: 15000});
    return !!out.valid;
  }catch(_e){
    return false;
  }
}

function openRecipesUnlock_(msg){
  if(el("recipesUnlockMsg")) el("recipesUnlockMsg").textContent = msg || "";
  if(el("recipesPinInput")) el("recipesPinInput").value = "";
  show(el("recipesUnlockBack"));
  setTimeout(()=>{ el("recipesPinInput")?.focus(); }, 60);
}
function closeRecipesUnlock_(){ hide(el("recipesUnlockBack")); }

async function doRecipesUnlock_(silent=false){
  if(!UNLOCKED_SECRET){
    openUnlock("Ingresa tu COSTS_SECRET para validar el código de Recetas.");
    return false;
  }

  const pin = String(el("recipesPinInput")?.value || "").trim();
  if(!pin){
    openRecipesUnlock_("Escribe el código de Recetas.");
    return false;
  }

  const btn = el("btnDoRecipesUnlock");
  if(btn){ btn.disabled = true; btn.textContent = "Validando…"; }

  showLoading("Validando…","Verificando código de Recetas.");
  try{
    const ok = await validateRecipesPin_(pin);
    if(!ok){
      if(el("recipesUnlockMsg")) el("recipesUnlockMsg").textContent = "Código inválido.";
      el("recipesPinInput")?.focus();
      return false;
    }

    state.recipesPinUnlocked = true;
    state.recipesPin = pin;

    // Cargar datos base y RECETAS
    try{ await loadAll(); }catch(_e){}
    try{ await loadDessertsFromSheet_(); }catch(_e){}

    closeRecipesUnlock_();
    show(el("viewRecipes"));
    renderRecipesView_();
    return true;
  } finally {
    hideLoading();
    if(btn){ btn.disabled = false; btn.textContent = "Entrar"; }
  }
}

async function ensureRecipesUnlocked_(){
  // Requiere COSTS_SECRET (base)
  if(!UNLOCKED_SECRET){
    openUnlock("Ingresa tu COSTS_SECRET para acceder a Recetas.");
    setView("purchases");
    return;
  }

  // Siempre pedir código (privacidad adicional)
  state.recipesPinUnlocked = false;
  state.recipesPin = "";
state.desserts = [];

  // Preparar UI mínima (evita pantalla vacía)
  try{
    setRecipesMeta_("Bloqueado: ingresa el código de Recetas.");
    if(el("dessertList")) el("dessertList").innerHTML = `<div class="hint">Ingresa el código para ver postres.</div>`;
    if(el("recipeEditor")) el("recipeEditor").innerHTML = ``;
    if(el("btnRecipeSave")) el("btnRecipeSave").disabled = true;
    if(el("recipeEditorTitle")) el("recipeEditorTitle").textContent = "Acceso protegido";
    if(el("recipeEditorSub")) el("recipeEditorSub").textContent = "Ingresa el código de Recetas para continuar.";
  }catch(_e){}

  hide(el("viewRecipes"));
  openRecipesUnlock_("");
}

function collectDessertIds_(){
  const set = new Set();

  // 1) Desde POSTRES (sheet)
  (state.desserts||[]).forEach(d=>{
    const id = String(d.dessert_id || d.id || "").trim();
    if(id) set.add(id);
  });

  // 2) Desde RECETAS existentes
  Object.keys(state.recipesByDessert||{}).forEach(id=>set.add(id));

  // 3) Desde pedidos (por si llega un postre nuevo)
  Object.keys(state.ordersByDessert||{}).forEach(id=>set.add(id));
  const late = state.late?.orders_by_dessert || state.late?.ordersByDessert || {};
  Object.keys(late||{}).forEach(id=>set.add(id));

  // Arroz aún no activo
  set.delete("arroz_con_leche");

  return Array.from(set).filter(Boolean);
}

function getDraftMap_(dessertId){
  state.ui.recipeDraftByDessert = state.ui.recipeDraftByDessert || {};
  if(!state.ui.recipeDraftByDessert[dessertId]){
    const seed = {};
    const rows = state.recipesByDessert?.[dessertId] || [];
    for(const r of rows){
      const k = String(r.ingredient_key||"").trim();
      if(!k) continue;
      seed[k] = { use:true, qty: parseNumFlex_(r.qty_per_unit||0), unit: String(r.unit||"").trim() };
    }
    state.ui.recipeDraftByDessert[dessertId] = seed;
  }
  return state.ui.recipeDraftByDessert[dessertId];
}


async function loadDessertsFromSheet_(){
  if(!UNLOCKED_SECRET) return;
  if(!state.recipesPin) return;
  try{
    const out = await api({ action:"desserts_list", costs_secret: UNLOCKED_SECRET, recipes_pin: state.recipesPin }, {timeoutMs: 20000});
    state.desserts = Array.isArray(out.items) ? out.items : [];
  }catch(_e){
    state.desserts = state.desserts || [];
  }
}

function slugifyDessertId_(name){
  let s = String(name||"").trim().toLowerCase();
  s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); // quita acentos
  s = s.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g,"");
  if(!s) s = "postre";
  return s;
}

function openDessertModal_(){
  if(el("dessertCreateMsg")) el("dessertCreateMsg").textContent = "";
  if(el("dessertNameInput")) el("dessertNameInput").value = "";
  if(el("dessertIdInput")) el("dessertIdInput").value = "";
  show(el("dessertModalBack"));
  setTimeout(()=> el("dessertNameInput")?.focus(), 50);
}
function closeDessertModal_(){
  hide(el("dessertModalBack"));
}

async function createDessert_(){
  const name = String(el("dessertNameInput")?.value||"").trim();
  let id = String(el("dessertIdInput")?.value||"").trim();
  if(!name) throw new Error("Escribe el nombre del postre.");
  if(!id) id = slugifyDessertId_(name);
  id = slugifyDessertId_(id);

  showLoading("Creando…","Guardando postre.");
  try{
    await api({
      action:"dessert_add",
      costs_secret: UNLOCKED_SECRET,
      recipes_pin: state.recipesPin,
      dessert_id: id,
      dessert_name: name
    }, {timeoutMs: 30000});

    await loadDessertsFromSheet_();
    // seleccionar el nuevo postre
    state.ui.activeDessert = id;
    // reset draft
    state.ui.recipeDraftByDessert = state.ui.recipeDraftByDessert || {};
    delete state.ui.recipeDraftByDessert[id];

    closeDessertModal_();
    renderRecipesView_();
  } finally {
    hideLoading();
  }
}
function renderDessertList_(){
  const box = el("dessertList");
  if(!box) return;
  const q = String(state.ui.dessert_q||"").trim().toLowerCase();
  const ids = collectDessertIds_();

  const rows = ids
    .map(id=>{
      const name = prettyDessertName(id);
      const cnt = (state.recipesByDessert?.[id]||[]).length;
      return { id, name, cnt };
    })
    .filter(x=> !q || x.name.toLowerCase().includes(q) || x.id.toLowerCase().includes(q))
    .sort((a,b)=>a.name.localeCompare(b.name,"es"));

  box.innerHTML = rows.map(r=>{
    const open = (String(state.ui.activeDessert||"") === r.id);
    const sub = r.cnt ? `${r.cnt} ingrediente(s) configurado(s)` : `sin receta aún`;
    const chev = open ? "▾" : "▸";
    return `
      <div class="pDessertCard ${open?"isOpen":""}" data-did="${escapeHtmlAttr(r.id)}">
        <div class="pDessertHead" role="button" tabindex="0">
          <div class="pDessertStripe"></div>
          <div class="pDessertTitle">
            <div class="name">${escapeHtml(r.name)}</div>
            <div class="sub">${escapeHtml(sub)}</div>
          </div>
          <div class="pDessertMeta">
            <div class="pDessertCount">${r.cnt || 0}</div>
            <div class="pDessertChevron" aria-hidden="true">${chev}</div>
          </div>
        </div>

        <div class="pDessertPanel ${open?"":"hidden"}" id="dessertPanel_${escapeHtmlAttr(r.id)}">
          ${open ? renderDessertPanelShell_(r.id) : ""}
        </div>
      </div>`;
  }).join("") || `<div class="hint">Sin postres.</div>`;

  const did = String(state.ui.activeDessert||"").trim();
  if(did){
    renderDessertPanel_(did);
  }
}


function renderDessertPanelShell_(dessertId){
  const name = prettyDessertName(dessertId);
  return `
    <div class="pDessertPanelTop">
      <div>
        <div class="cardTitle" style="margin:0;">Editar receta: ${escapeHtml(name)}</div>
        <div class="hint">Activa ingredientes (switch) y define cantidades por unidad.</div>
      </div>
      <button class="btn primary" data-act="save_recipe">Guardar receta</button>
    </div>

    <div class="pDessertPanelControls" style="margin-top:10px;">
      <input class="input" data-act="ing_search" placeholder="Buscar ingrediente…" />
    </div>

    <div class="pDessertPanelScroll">
      <div class="pGroups" data-act="recipe_editor" style="margin-top:12px;"></div>
    </div>
  `;
}

function bindInlineRecipeEditor_(panel, dessertId){
  if(!panel || panel.__bound) return;
  panel.__bound = true;

  // Guardar
  panel.addEventListener('click', (e)=>{
    const btn = e.target.closest('[data-act="save_recipe"]');
    if(!btn) return;
    saveRecipe_().catch(err=> setRecipesMeta_(String(err.message||err)));
  });

  // Buscar ingrediente
  panel.addEventListener('input', (e)=>{
    const inp = e.target.closest('[data-act="ing_search"]');
    if(!inp) return;
    state.ui.ingredient_q = String(inp.value||'');
    renderRecipeEditor_();
  });

  // Cantidad
  panel.addEventListener('input', (e)=>{
    const row = e.target.closest('.pRecipeRow');
    if(!row) return;
    const k = String(row.getAttribute('data-k')||'');
    if(!k) return;
    const did = String(state.ui.activeDessert||'');
    if(!did) return;
    const draft = getDraftMap_(did);
    draft[k] = draft[k] || { use:false, qty:'', unit:getUnitFor(k) };
    const act = e.target.getAttribute('data-act') || '';
    if(act==='r_qty') draft[k].qty = String(e.target.value||'').replace(',', '.');
  });

  // Switch
  panel.addEventListener('change', (e)=>{
    const row = e.target.closest('.pRecipeRow');
    if(!row) return;
    const k = String(row.getAttribute('data-k')||'');
    if(!k) return;
    const did = String(state.ui.activeDessert||'');
    if(!did) return;
    const draft = getDraftMap_(did);
    draft[k] = draft[k] || { use:false, qty:'', unit:getUnitFor(k) };
    const act = e.target.getAttribute('data-act') || '';
    if(act==='r_toggle'){
      draft[k].use = !!e.target.checked;
      row.classList.toggle('isOn', draft[k].use);
      row.classList.toggle('isOff', !draft[k].use);
      const sw = row.querySelector('.switchWrap');
      if(sw){
        sw.classList.toggle('isOn', draft[k].use);
        sw.classList.toggle('isOff', !draft[k].use);
        const meta = sw.querySelector('.meta');
        if(meta) meta.textContent = draft[k].use ? 'Incluido' : 'No';
      }
      const qtyInp = row.querySelector('input.qty');
      if(qtyInp) qtyInp.disabled = !draft[k].use;
      if(draft[k].use && (!draft[k].qty || Number(draft[k].qty) <= 0)){
        if(qtyInp) qtyInp.value = '1';
        draft[k].qty = 1;
      }
    }
  });
}

function renderDessertPanel_(dessertId){
  const panel = el('dessertPanel_' + dessertId);
  if(!panel) return;

  // mount shell if needed
  if(!panel.querySelector('[data-act="recipe_editor"]')){
    panel.innerHTML = renderDessertPanelShell_(dessertId);
  }

  // seed search input
  const search = panel.querySelector('[data-act="ing_search"]');
  if(search) search.value = String(state.ui.ingredient_q||'');

  bindInlineRecipeEditor_(panel, dessertId);
  renderRecipeEditor_();
}

function renderRecipeEditor_(){
  const did = String(state.ui.activeDessert||"").trim();
  if(!did) return;

  const panel = el('dessertPanel_' + did);
  const editor = panel ? panel.querySelector('[data-act="recipe_editor"]') : null;
  if(!editor) return;

  const draft = getDraftMap_(did);
  const q = String(state.ui.ingredient_q||"").trim().toLowerCase();

  const keys = Object.keys(state.costsByKey||{}).sort((a,b)=>a.localeCompare(b,"es"));
  const filtered = keys.filter(k => !q || k.toLowerCase().includes(q));

  const rows = filtered.map(k=>{
    const d = draft[k] || { use:false, qty:"", unit:getUnitFor(k) };
    const unit = String(d.unit || getUnitFor(k) || "g");
    const checked = !!d.use;
    const qtyVal = (d.qty!=="" && d.qty!=null) ? String(d.qty).replace(".", ",") : "";

    return `
      <div class="pRecipeRow ${checked?"isOn":"isOff"}" data-k="${escapeHtmlAttr(k)}">
        <label class="switchWrap ${checked?"isOn":"isOff"}">
          <input class="switchInput" type="checkbox" data-act="r_toggle" ${checked?"checked":""} />
          <span class="switch" aria-hidden="true"></span>
          <span class="meta">${checked ? "Incluido" : "No"}</span>
        </label>

        <div class="name">
          ${escapeHtml(k)}
          <div class="meta">Unidad: <b>${escapeHtml(unit)}</b></div>
        </div>

        <input class="input qty" data-act="r_qty" type="number" step="any" min="0" placeholder="Cantidad" value="${escapeHtmlAttr(qtyVal)}" ${checked?"":"disabled"} />
      </div>`;
  }).join("");

  editor.innerHTML = rows || `<div class="hint">No hay ingredientes.</div>`;
}

function setRecipesMeta_(txt){
  const m = el("recipesMeta");
  if(m) m.textContent = txt || "";
}

function renderRecipesView_(){
  setRecipesMeta_(state.recipesSource === "sheet" ? "Fuente: RECETAS (hoja)" : "Fuente: receta embebida (fallback)");
  renderDessertList_();
  renderRecipeEditor_();
}

async function saveRecipe_(){
  const did = String(state.ui.activeDessert||"").trim();
  if(!did) return;
  const draft = getDraftMap_(did);

  const items = [];
  for(const [k,v] of Object.entries(draft)){
    if(!v || !v.use) continue;
    const qty = Number(String(v.qty||"").replace(",", "."));
    if(!(qty>0)) continue;
    const unit = String(v.unit || getUnitFor(k) || "").trim().toLowerCase();
    if(!unit) continue;
    items.push({ ingredient_key: k, qty_per_unit: qty, unit });
  }

  showLoading("Guardando…","Actualizando RECETAS.");
  try{
    await api({ action: "recipes_set", costs_secret: UNLOCKED_SECRET, recipes_pin: state.recipesPin, dessert_id: did, dessert_name: prettyDessertName(did), items }, {timeoutMs: 45000});
    await loadRecipesFromSheet_();
    // Clasificar secciones automáticamente (sin botón manual)
    try{ await autoClassifyCostsSections_(); }catch(_e){}
    setRecipesMeta_("Receta guardada con éxito.");
  } finally { hideLoading(); }
}

function joinNames_(names){
  const arr = (names||[]).filter(Boolean);
  if(arr.length<=1) return arr[0]||"";
  if(arr.length===2) return `${arr[0]} y ${arr[1]}`;
  return arr.slice(0,-1).join(", ") + " y " + arr[arr.length-1];
}

function computeAutoSections_(){
  const dessertIds = collectDessertIds_();
  const names = dessertIds.map(id=>prettyDessertName(id));
  const n = dessertIds.length;
  const fullMask = (1<<n) - 1;

  const mem = {};
  dessertIds.forEach((did, idx)=>{
    const rows = state.recipesByDessert?.[did] || [];
    for(const r of rows){
      const k = String(r.ingredient_key||"").trim();
      if(!k) continue;
      mem[k] = (mem[k] || 0) | (1<<idx);
    }
  });

  const out = [];
  for(const k of Object.keys(mem)){
    const mask = mem[k];
    const inIdx = [];
    for(let i=0;i<n;i++){ if(mask & (1<<i)) inIdx.push(i); }
    const inNames = inIdx.map(i=>names[i]);

    let title = "";
    if(mask === fullMask) title = "Ingredientes que comparten todos los postres";
    else if(inIdx.length > 1) title = "Ingredientes que comparten " + joinNames_(inNames);
    else title = "Ingredientes para " + (inNames[0] || "Postre");

    out.push({ ingredient_key: k, section_title: title });
  }
  return out;
}

async function autoClassifyCostsSections_(){
  showLoading("Clasificando…","Actualizando secciones en COSTOS_INGREDIENTES.");
  try{
    const items = computeAutoSections_();
    await api({ action:"costs_sections_set", costs_secret: UNLOCKED_SECRET, recipes_pin: state.recipesPin, items }, {timeoutMs: 45000});
    await loadAll();
    setRecipesMeta_("Secciones actualizadas con éxito.");
  } finally { hideLoading(); }
}

// =============== Events ===============
function bind(){
  // Buttons
  el("btnExit")?.addEventListener("click", logout);
  el("btnReload")?.addEventListener("click", ()=>{ showLoading("Recargando…", "Actualizando datos."); loadAll().finally(hideLoading); });

  // Unit-cost breakdown (toggle)
  el("unitCostRows")?.addEventListener("click", (ev)=>{
    const tr = ev.target && ev.target.closest ? ev.target.closest("tr[data-dessert]") : null;
    if(!tr) return;
    const id = tr.getAttribute("data-dessert");
    if(!id) return;
    state.ui.unitOpen = state.ui.unitOpen || {};
    state.ui.unitOpen[id] = !state.ui.unitOpen[id];
    renderUnitCosts();
  });

  // Tabs
  el("btnTabPurchases")?.addEventListener("click", ()=> setView("purchases"));
  el("btnTabCosts")?.addEventListener("click", ()=> setView("costs"));
  el("btnTabRecipes")?.addEventListener("click", ()=> setView("recipes"));

  // Costos view
  el("btnCostsRefresh")?.addEventListener("click", ()=>{ showLoading("Refrescando…","Leyendo datos actualizados."); loadAll().finally(hideLoading); });
  el("btnCatalogs")?.addEventListener("click", ()=> openCatalogModal());
  el("btnIngredients")?.addEventListener("click", ()=> openIngredientsModal());
  el("inpCostSearch")?.addEventListener("input", (e)=>{ state.ui.cost_q = String(e.target.value||""); renderCostsGroups(); });  // Recetas view
  el("inpDessertSearch")?.addEventListener("input", (e)=>{ state.ui.dessert_q = String(e.target.value||""); renderDessertList_(); });
  el("dessertList")?.addEventListener("click", (e)=>{
    const head = e.target.closest('.pDessertHead');
    if(!head) return;
    const card = head.closest('.pDessertCard');
    if(!card) return;
    const did = String(card.getAttribute('data-did')||'');
    if(!did) return;

    if(String(state.ui.activeDessert||"") === did){
      state.ui.activeDessert = "";
      state.ui.ingredient_q = "";
      renderDessertList_();
      return;
    }

    state.ui.recipeDraftByDessert = state.ui.recipeDraftByDessert || {};
    delete state.ui.recipeDraftByDessert[did];
    state.ui.activeDessert = did;
    state.ui.ingredient_q = "";
    renderDessertList_();

    setTimeout(()=>{
      const p = el('dessertPanel_' + did);
      if(p && window.innerWidth <= 860){
        p.scrollIntoView({behavior:'smooth', block:'start'});
      }
    }, 50);
  });
  // Recetas: interacción con switches y cantidades (delegación)
  el("dessertList")?.addEventListener("input", (e)=>{
    const act = e.target?.getAttribute?.("data-act") || "";
    if(act !== "r_qty") return;

    const row = e.target.closest(".pRecipeRow");
    if(!row) return;
    const k = String(row.getAttribute("data-k")||"");
    if(!k) return;
    const did = String(state.ui.activeDessert||"");
    if(!did) return;

    const draft = getDraftMap_(did);
    draft[k] = draft[k] || { use:false, qty:"", unit:getUnitFor(k) };
    draft[k].qty = String(e.target.value||"").replace(",", ".");
  });

  el("dessertList")?.addEventListener("change", (e)=>{
    const act = e.target?.getAttribute?.("data-act") || "";
    if(act !== "r_toggle") return;

    const row = e.target.closest(".pRecipeRow");
    if(!row) return;
    const k = String(row.getAttribute("data-k")||"");
    if(!k) return;
    const did = String(state.ui.activeDessert||"");
    if(!did) return;

    const draft = getDraftMap_(did);
    draft[k] = draft[k] || { use:false, qty:"", unit:getUnitFor(k) };
    draft[k].use = !!e.target.checked;

    // UI
    row.classList.toggle("isOn", draft[k].use);
    row.classList.toggle("isOff", !draft[k].use);

    const sw = row.querySelector(".switchWrap");
    if(sw){
      sw.classList.toggle("isOn", draft[k].use);
      sw.classList.toggle("isOff", !draft[k].use);
      const meta = sw.querySelector(".meta");
      if(meta) meta.textContent = draft[k].use ? "Incluido" : "No";
    }

    const qtyInp = row.querySelector("input.qty");
    if(qtyInp) qtyInp.disabled = !draft[k].use;

    // default qty = 1
    if(draft[k].use){
      const cur = parseNumFlex_(draft[k].qty);
      if(!(cur > 0)){
        draft[k].qty = 1;
        if(qtyInp) qtyInp.value = "1";
      }
    }
  });

  el("btnRecipesRefresh")?.addEventListener("click", ()=>{ showLoading("Refrescando…","Leyendo datos."); loadAll().finally(hideLoading); });


  // Unlock
  el("btnDoUnlock")?.addEventListener("click", ()=>doUnlock(false));
  el("btnClear")?.addEventListener("click", ()=>{ if(el("secretInput")) el("secretInput").value = ""; if(el("unlockMsg")) el("unlockMsg").textContent = ""; el("secretInput")?.focus(); });
  el("secretInput")?.addEventListener("keydown", (e)=>{ if(e.key === "Enter") doUnlock(false); });

  // Recipes unlock
  el("btnDoRecipesUnlock")?.addEventListener("click", ()=>doRecipesUnlock_(false));
  el("btnRecipesClear")?.addEventListener("click", ()=>{ if(el("recipesPinInput")) el("recipesPinInput").value=""; if(el("recipesUnlockMsg")) el("recipesUnlockMsg").textContent=""; el("recipesPinInput")?.focus(); });
  el("btnRecipesCancel")?.addEventListener("click", ()=>{ closeRecipesUnlock_(); setView("purchases"); });
  el("recipesPinInput")?.addEventListener("keydown", (e)=>{ if(e.key==="Enter") doRecipesUnlock_(false); });
  el("recipesUnlockBack")?.addEventListener("click", (e)=>{ if(e.target && e.target.id==="recipesUnlockBack") closeRecipesUnlock_(); });

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
  el("ingCloseX")?.addEventListener("click", closeIngredientsModal);
  el("btnAddIng")?.addEventListener("click", async()=>{ try{ if(el("ingAddMsg")) el("ingAddMsg").textContent=""; await addIngredient(); }catch(e){ try{ hideLoading(); }catch(_e){} if(el("ingAddMsg")) el("ingAddMsg").textContent=String(e.message||e); } });
  el("btnDelIng")?.addEventListener("click", ()=>{
    try{
      if(el("ingDelMsg")) el("ingDelMsg").textContent="";
      const key = String(el("ingSelect")?.value||"").trim();
      if(!key) throw new Error("Selecciona un ingrediente.");
      openIngConfirm(key);
    }catch(e){ if(el("ingDelMsg")) el("ingDelMsg").textContent=String(e.message||e); }
  });
el("ingModalBack")?.addEventListener("click", (e)=>{ if(e.target && e.target.id==="ingModalBack") closeIngredientsModal(); });
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


  // Confirm delete modal
  el("ingConfirmCancel")?.addEventListener("click", closeIngConfirm);
  el("ingConfirmBack")?.addEventListener("click", (e)=>{ if(e.target && e.target.id==="ingConfirmBack") closeIngConfirm(); });

  // ESC para cancelar
  document.addEventListener("keydown", (e)=>{
    if(e.key !== "Escape") return;
    const back = el("ingConfirmBack");
    if(back && !back.classList.contains("hidden")) closeIngConfirm();
  });

  // Recetas: crear postre / crear ingrediente
  el("btnDessertAdd")?.addEventListener("click", ()=> openDessertModal_());
  el("btnRecipesAddIngredient")?.addEventListener("click", ()=> openIngredientsModal());
  el("dessertNameInput")?.addEventListener("input", (e)=>{ 
    const name = String(e.target.value||""); 
    if(el("dessertIdInput") && !String(el("dessertIdInput").value||"").trim()) el("dessertIdInput").value = slugifyDessertId_(name);
  });
  el("btnDessertCancel")?.addEventListener("click", closeDessertModal_);
  el("dessertModalBack")?.addEventListener("click", (e)=>{ if(e.target && e.target.id==="dessertModalBack") closeDessertModal_(); });
  el("btnDessertCreate")?.addEventListener("click", async()=>{
    try{
      if(el("dessertCreateMsg")) el("dessertCreateMsg").textContent="";
      await createDessert_();
    }catch(e){
      if(el("dessertCreateMsg")) el("dessertCreateMsg").textContent = String(e.message||e);
    }
  });
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
