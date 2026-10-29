/* Shared cost calculation extracted from Compras y Recetas. No requests or credentials. */
(() => {
const DESSERT_NAME_TO_ID_={"mousse de maracuya":"mousse_maracuya","cheesecake de cafe con panela":"cheesecake_cafe_panela","arroz con leche":"arroz_con_leche"};
function normText_(s){
  return String(s||"")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/\s+/g," ")
    .trim();
}


function normRecipeUnit_(u){
  const t = String(u||"").trim().toLowerCase();
  if(!t) return "";
  if(t === "u" || t === "und" || t === "unidad" || t === "unidades") return "unidad";
  if(t === "g" || t === "gr" || t === "gramo" || t === "gramos") return "g";
  if(t === "ml" || t === "mililitro" || t === "mililitros") return "ml";
  if(t === "m" || t === "mt" || t === "mts" || t === "metro" || t === "metros") return "m";
  return t;
}

function normalizeRecipePricingMode_(value){
  const t = String(value ?? "").trim().toLowerCase();
  if(!t) return "margin_60";
  if(t === "true" || t === "1" || t === "si" || t === "sí" || t === "yes") return "direct_cost";
  if(t.includes("direct") || t.includes("costo") || t.includes("cost") || t.includes("sin margen") || t.includes("sin rentabilidad") || t.includes("no_margin") || t.includes("nomargin")) return "direct_cost";
  return "margin_60";
}

function isNoMarginMode_(value){
  return normalizeRecipePricingMode_(value) === "direct_cost";
}

function recipeLineIsDirectCost_(line){
  if(!line) return false;
  return !!(line.direct_cost || line.no_margin || line.noMargin || isNoMarginMode_(line.pricing_mode || line.pricingMode || line.price_mode || line.margin_mode));
}

function recipeRowUpdatedTime_(row){
  const v = row?.updated_at ?? row?.updatedAt ?? row?.recipe_updated_at ?? row?.updated ?? row?.modified_at ?? row?.modifiedAt ?? "";
  if(v instanceof Date) return v.getTime();
  const s = String(v || "").trim();
  if(!s) return 0;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

function recipeRowIsInactive_(row){
  const values = [
    row?.active, row?.is_active, row?.enabled, row?.included, row?.use,
    row?.activo, row?.incluido
  ];
  for(const v of values){
    if(v === undefined || v === null || v === "") continue;
    const t = String(v).trim().toLowerCase();
    if(["0","false","no","n","off","inactivo","inactive","desactivado"].includes(t)) return true;
  }
  return false;
}

function buildRecipesIndex_(items){
  const rows = Array.isArray(items) ? items : [];
  const normalized = [];
  const hasExactDessertRows = {};

  for(const r of rows){
    if(recipeRowIsInactive_(r)) continue;

    const didRaw = String(r?.dessert_id || r?.dessertId || "").trim();
    const dname = String(r?.dessert_name || r?.dessertName || "").trim();
    const didFromName = DESSERT_NAME_TO_ID_[normText_(dname)] || "";
    const did = didRaw || didFromName;
    if(!did) continue;

    const ing = String(r?.ingredient_key || r?.ingredientKey || r?.key || "").trim();
    if(!ing) continue;

    const qty = parseNumFlex_(r?.qty_per_unit ?? r?.qtyPerUnit ?? r?.qty ?? 0);
    if(!(qty > 0)) continue;

    const unit = normRecipeUnit_(r?.unit);
    if(!unit) continue;

    const exactDessertId = !!didRaw;
    if(exactDessertId) hasExactDessertRows[did] = true;

    const pricingMode = normalizeRecipePricingMode_([r?.pricing_mode,r?.pricingMode,r?.price_mode,r?.margin_mode,r?.no_margin,r?.noMargin].find(v=>v!==undefined && v!==null && v!=="") ?? "");
    const directCost = pricingMode === "direct_cost";

    normalized.push({
      dessert_id: did,
      exactDessertId,
      ingredient_key: ing,
      ingredient_canon: canonicalKey(ing),
      qty_per_unit: qty,
      unit,
      pricing_mode: directCost ? "direct_cost" : "margin_60",
      no_margin: directCost,
      updated_ts: recipeRowUpdatedTime_(r),
      row_order: normalized.length
    });
  }

  const byDessertAndIngredient = {};
  for(const r of normalized){
    // Si ya existe información actual con dessert_id, ignoramos filas legacy que
    // solo venían por nombre. Importante: NO filtramos todo el postre por el
    // timestamp más reciente, porque cuando una hoja se edita manualmente puede
    // quedar un ingrediente con fecha distinta y eso ocultaba ingredientes activos
    // como Bolsa hermética en el costo unitario.
    if(hasExactDessertRows[r.dessert_id] && !r.exactDessertId) continue;

    const ingredientKey = r.ingredient_canon || canonicalKey(r.ingredient_key);
    if(!ingredientKey) continue;
    const mapKey = `${r.dessert_id}::${ingredientKey}`;

    const prev = byDessertAndIngredient[mapKey] || null;
    const prevTs = Number(prev?.updated_ts || 0) || 0;
    const ts = Number(r.updated_ts || 0) || 0;

    // Si hay duplicados del mismo producto en el mismo postre, gana la fila más
    // reciente de ese producto; si no hay fecha, gana la última recibida.
    if(!prev || (ts && ts >= prevTs) || (!ts && !prevTs && r.row_order >= (prev.row_order || 0))){
      byDessertAndIngredient[mapKey] = {
        ingredient_key: r.ingredient_key,
        qty_per_unit: r.qty_per_unit,
        unit: r.unit,
        pricing_mode: r.pricing_mode,
        no_margin: r.no_margin,
        updated_ts: r.updated_ts,
        row_order: r.row_order
      };
    }
  }

  const out = {};
  for(const mapKey of Object.keys(byDessertAndIngredient)){
    const did = mapKey.split("::")[0];
    if(!out[did]) out[did] = [];
    out[did].push(byDessertAndIngredient[mapKey]);
  }

  // ordenar por nombre ingrediente para consistencia visual
  for(const k of Object.keys(out)){
    out[k].sort((a,b)=> String(a.ingredient_key||"").localeCompare(String(b.ingredient_key||""),"es"));
  }
  return out;
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

  if(unit_type === "g" || unit_type === "ml" || unit_type === "m"){
    return { base_unit: unit_type, cpu: cpuOr, pack_qty, pack_price, brand, store, unit_item_qty, unit_item_type, unit_type };
  }

  if(unit_type === "unidad"){
    if(unit_item_qty>0 && (unit_item_type === "g" || unit_item_type === "ml" || unit_item_type === "m")){
      const basePackQty = pack_qty * unit_item_qty;
      const cpu = (basePackQty>0 && pack_price>0) ? (pack_price/basePackQty) : null;
      return { base_unit: unit_item_type, cpu, pack_qty: basePackQty, pack_price, brand, store, unit_item_qty, unit_item_type, unit_type };
    }
    return { base_unit: "unidad", cpu: cpuOr, pack_qty, pack_price, brand, store, unit_item_qty, unit_item_type, unit_type };
  }

  return { base_unit: "", cpu: null, pack_qty: 0, pack_price: 0, brand:"", store:"", unit_item_qty:0, unit_item_type:"", unit_type:"" };
}

function resolveCostForRecipe_(ingredientKey, recipeUnit, state){
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

  return { ok:true, ingredient_key: ik, cpu: Number(base.cpu), base_unit: have || base.base_unit || "", note, updated_at: spec?.updated_at || spec?.updatedAt || "" };
}
function breakdown(dessertId,recipeRows,costsByKey,lotQty=0){
  const state={costsByKey,_costAlias:Object.fromEntries(Object.keys(costsByKey).map(k=>[canonicalKey(k),k]))};
  const lines=[],packagingLines=[],missing=[],packagingMissing=[];
  for(const r of recipeRows||[]){
    const direct=recipeLineIsDirectCost_(r),rc=resolveCostForRecipe_(r.ingredient_key,r.unit,state),qty=Number(r.qty_per_unit);
    if(!rc.ok || !(qty>0)){(direct?packagingMissing:missing).push(r.ingredient_key);continue;}
    const line={ingredient_key:rc.ingredient_key,qty,unit:normRecipeUnit_(r.unit),cpu:rc.cpu,cpu_unit:rc.base_unit,note:rc.note,subtotal:qty*rc.cpu,direct_cost:direct,pricing_mode:direct?'direct_cost':'margin_60',cost_updated_at:rc.updated_at};
    (direct?packagingLines:lines).push(line);
  }
  lines.sort((a,b)=>b.subtotal-a.subtotal);packagingLines.sort((a,b)=>a.ingredient_key.localeCompare(b.ingredient_key,'es'));
  const sum=lines.reduce((n,l)=>n+l.subtotal,0),packagingSum=packagingLines.reduce((n,l)=>n+l.subtotal,0);
  const price60=sum>0?sum/.40:null;
  return {dessertId,source:'sheet',lines,packagingLines,missing,packagingMissing,sum,packagingSum,totalUnitWithPackaging:sum+packagingSum,price60,price60WithPackaging:price60!==null&&!packagingMissing.length&&!missing.length?price60+packagingSum:null,lotQty,lot:lotQty*sum,packagingLot:lotQty*packagingSum};
}
function roundUp990(value){return Number.isFinite(value)&&value>0?Math.max(990,Math.ceil((value-990)/1000)*1000+990):null;}
function suggest(id,recipes,costs){
 const rows=buildRecipesIndex_(recipes)[id];
 if(!rows?.length)return {ok:false,reason:'Falta una receta activa en Compras y recetas.'};
 const map=Object.fromEntries(costs.map(c=>[c.ingredient_key,c])),b=breakdown(id,rows,map);
 if(b.missing.length||b.packagingMissing.length)return {ok:false,reason:'Faltan costos o unidades compatibles: '+[...b.missing,...b.packagingMissing].join(', ')};
 const price=roundUp990(b.price60WithPackaging);
 if(!price)return {ok:false,reason:'No hay un costo de producción válido.'};
 return {ok:true,price,minimum:b.price60WithPackaging,production:b.sum,extras:b.packagingSum,approximate:b.lines.concat(b.packagingLines).some(l=>l.note==='approx_g_ml')};
}
globalThis.AMAREDPricing={breakdown,suggest,roundUp990,buildRecipesIndex_,baseFromSpec,normRecipeUnit_,recipeLineIsDirectCost_};
})();
