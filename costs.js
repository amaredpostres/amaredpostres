const API_URL = "https://amared-orders.amaredpostres.workers.dev/";
const LS_COSTS_KEY = "AMARED_INGREDIENT_PRICES_LOCAL";
const LS_COSTS_META_KEY = "AMARED_INGREDIENT_COSTS_META";

let UNLOCKED_SECRET = ""; // solo memoria

// Defaults visibles incluso si el catálogo está vacío en Sheets
const DEFAULT_STORES = []; // Se cargan desde Google Sheets (COSTOS_CATALOGOS)
const DEFAULT_BRANDS = []; // Se cargan desde Google Sheets (COSTOS_CATALOGOS)

let STORES = [];
let BRANDS = [];

// ===== Helpers base =====
function safeJsonParse(s){ try{return JSON.parse(s);}catch{return null;} }

function showLoading(t,d){
  const el=document.getElementById("loading");
  document.getElementById("lt").textContent=t||"Cargando...";
  document.getElementById("ld").textContent=d||"Por favor espera.";
  el.classList.add("show");
}
function hideLoading(){ document.getElementById("loading").classList.remove("show"); }

async function api(payload){
  const res = await fetch(API_URL,{
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify(payload)
  });
  const out = await res.json().catch(async()=>({ok:false,error:await res.text().catch(()=> "Error")}));
  if(!out.ok) throw new Error(out.error||"Error");
  return out;
}

function loadPrices(){
  const raw = localStorage.getItem(LS_COSTS_KEY);
  const local = raw ? safeJsonParse(raw) : null;
  const base = (window.AMARED_INGREDIENT_PRICES && typeof window.AMARED_INGREDIENT_PRICES==="object") ? window.AMARED_INGREDIENT_PRICES : {};
  return { ...base, ...(local && typeof local==="object" ? local : {}) };
}
function savePrices(prices){
  localStorage.setItem(LS_COSTS_KEY, JSON.stringify(prices||{}));
}

function loadMeta(){
  const raw = localStorage.getItem(LS_COSTS_META_KEY);
  const m = raw ? safeJsonParse(raw) : null;
  return (m && typeof m==="object") ? m : {};
}
function saveMeta(meta){
  localStorage.setItem(LS_COSTS_META_KEY, JSON.stringify(meta||{}));
}

function money(n){ return Math.round(Number(n||0)).toLocaleString("es-CO"); }
function roundCOP(n){ return Math.max(0, Math.round(Number(n||0))); }

function cssEscape(s){ return String(s).replace(/"/g,'\\\\"'); }
function unescapeCss(s){ return String(s).replace(/\\\\"/g,'"'); }

function uniqSorted(arr){
  const uniq = Array.from(new Set((arr||[]).map(s=>String(s||"").trim()).filter(Boolean)));
  uniq.sort((a,b)=>a.localeCompare(b,"es"));
  return uniq;
}

function normUnit(u){
  const s = String(u||"").trim().toLowerCase();
  if(s==="g") return "g";
  if(s==="ml") return "ml";
  if(s==="unidad"||s==="u") return "unidad";
  return "";
}

function unitLabel(u){
  if(u==="g") return "Cantidad del empaque (g)";
  if(u==="ml") return "Cantidad del empaque (ml)";
  if(u==="unidad") return "Cantidad de unidades (empaque)";
  return "Cantidad del empaque";
}
function unitPlaceholder(u){
  if(u==="g") return "Ej: 1000";
  if(u==="ml") return "Ej: 200";
  if(u==="unidad") return "Ej: 6";
  return "Selecciona unidad…";
}
function perUnitLabel(u){
  if(u==="g") return "COP por g";
  if(u==="ml") return "COP por ml";
  if(u==="unidad") return "COP por unidad";
  return "COP por unidad";
}

// ===== Sheets: costos =====
async function fetchCostsFromSheets(){
  const out = await api({ action:"costs_list", costs_secret: UNLOCKED_SECRET });
  return out.items || [];
}
async function upsertCostToSheets(row){
  const payload = {
    action:"costs_upsert",
    costs_secret: UNLOCKED_SECRET,
    ingredient_key: row.ingredient_key,
    unit_type: row.unit_type,
    pack_qty: row.pack_qty,
    pack_price: row.pack_price,
    cop_per_unit: row.cop_per_unit,
    brand: row.brand || "",
    store: row.store || "",
    unit_item_qty: row.unit_item_qty ?? "",
    unit_item_qty_type: row.unit_item_qty_type ?? "",
    updated_by: row.updated_by || "COSTS_UI"
  };
  return await api(payload);
}

// ===== Sheets: catálogos (tiendas/marcas) =====
async function fetchCatalogsFromSheets(){
  const out = await api({ action:"catalog_list", costs_secret: UNLOCKED_SECRET });
  const stores = (out.stores || []).map(x=>x.value || x).filter(Boolean);
  const brands = (out.brands || []).map(x=>x.value || x).filter(Boolean);

  // ✅ SOLO desde Sheets (los defaults ya se “seedearon” en la hoja)
  STORES = uniqSorted(stores);
  BRANDS = uniqSorted(brands);

  return out;
}
async function addCatalogValue(type, value){
  const v = String(value||"").trim();
  if(!v) throw new Error("Valor vacío.");
  return await api({ action:"catalog_add", costs_secret: UNLOCKED_SECRET, type, value: v });
}
async function deleteCatalogValue(type, value){
  const v = String(value||"").trim();
  if(!v) throw new Error("Selecciona un valor.");
  return await api({ action:"catalog_delete", costs_secret: UNLOCKED_SECRET, type, value: v });
}

function makeSelectOptions(arr, selected){
  const s = String(selected||"");
  return (arr||[]).map(v=>{
    const vv = String(v);
    const sel = (vv===s) ? "selected" : "";
    return `<option value="${cssEscape(vv)}" ${sel}>${vv}</option>`;
  }).join("");
}

// ===== Modal (AMARED) =====
function ensureModal(){
  let m = document.getElementById("am_modal");
  if(m) return m;

  m = document.createElement("div");
  m.id = "am_modal";
  m.className = "amModal";
  m.innerHTML = `
    <div class="amModalCard">
      <div class="amModalHeader">
        <div>
          <div class="amModalTitle" id="am_modal_title">Título</div>
          <div class="amModalDesc" id="am_modal_desc">Descripción</div>
        </div>
        <button class="amBtn amBtnSecondary" id="am_modal_close" type="button">Cerrar</button>
      </div>
      <div class="amModalBody" id="am_modal_body"></div>
    </div>
  `;

  document.body.appendChild(m);

  m.querySelector("#am_modal_close").onclick = ()=>{ m.classList.remove("isOpen"); };

  m.addEventListener("click",(e)=>{
    if(e.target===m) m.classList.remove("isOpen");
  }, {passive:true});

  return m;
}

function openModal(title, desc, html){
  const m = ensureModal();
  m.querySelector("#am_modal_title").textContent = title || "";
  m.querySelector("#am_modal_desc").textContent = desc || "";
  m.querySelector("#am_modal_body").innerHTML = html || "";
  m.classList.add("isOpen");
  return m;
}

function confirmWithTimer(m, seconds){
  return new Promise((resolve)=>{
    const body = m.querySelector("#am_modal_body");
    const okBtn = body.querySelector("#am_ok");
    const cancelBtn = body.querySelector("#am_cancel");

    let t = Number(seconds||2);
    okBtn.disabled = true;
    okBtn.textContent = `Confirmar (${t})`;

    const int = setInterval(()=>{
      t--;
      if(t<=0){
        clearInterval(int);
        okBtn.disabled = false;
        okBtn.textContent = "Confirmar";
      }else{
        okBtn.textContent = `Confirmar (${t})`;
      }
    }, 1000);

    cancelBtn.onclick = ()=>{
      clearInterval(int);
      m.classList.remove("isOpen");
      resolve(false);
    };
    okBtn.onclick = ()=>{
      clearInterval(int);
      m.classList.remove("isOpen");
      resolve(true);
    };
  });
}

// ===== UI: panel Tiendas/Marcas =====
async function openCatalogManager(){
  await fetchCatalogsFromSheets();

  const html = `
  <div class="item">
    <div class="k">Tiendas y Marcas</div>
    <div class="mini" style="margin-top:6px;">Agrega o elimina opciones (con confirmación de 2s).</div>

    <div class="amModalGrid" style="margin-top:14px;">
      <div class="amCol">
        <div class="amLabel">Tiendas</div>
        <div class="amRow">
          <select class="amSelect" id="storePick">
            <option value="">Selecciona…</option>
            ${makeSelectOptions(STORES,"")}
          </select>
          <button class="amBtn amBtnDanger" id="delStore" type="button">Eliminar</button>
        </div>
        <div class="amRow" style="margin-top:10px;">
          <input class="amInput" id="storeNew" placeholder="Nueva tienda…">
          <button class="amBtn" id="addStore" type="button">Agregar</button>
        </div>
      </div>

      <div class="amCol">
        <div class="amLabel">Marcas</div>
        <div class="amRow">
          <select class="amSelect" id="brandPick">
            <option value="">Selecciona…</option>
            ${makeSelectOptions(BRANDS,"")}
          </select>
          <button class="amBtn amBtnDanger" id="delBrand" type="button">Eliminar</button>
        </div>
        <div class="amRow" style="margin-top:10px;">
          <input class="amInput" id="brandNew" placeholder="Nueva marca…">
          <button class="amBtn" id="addBrand" type="button">Agregar</button>
        </div>
      </div>
    </div>
  </div>
`;

  const m = openModal("⚙️ Gestionar tiendas y marcas", "Este panel está separado para evitar cambios accidentales.", html);

  const storePick = m.querySelector("#storePick");
  const brandPick = m.querySelector("#brandPick");
  const storeNew = m.querySelector("#storeNew");
  const brandNew = m.querySelector("#brandNew");

  m.querySelector("#addStore").onclick = async ()=>{
    const v = storeNew.value.trim();
    if(!v) return alert("Escribe una tienda.");
    const ok = await confirm2s("¿Agregar tienda?", `Se agregará: ${v}`);
    if(!ok) return;
    showLoading("Agregando…","Guardando tienda en la base de datos.");
    try{
      await addCatalogValue("store", v);
      storeNew.value = "";
      await fetchCatalogsFromSheets();
      storePick.innerHTML = `<option value="">Selecciona…</option>${makeSelectOptions(STORES,"")}`;
      render(); // refresca selects en filas
    }catch(e){ alert(e.message||"Error"); }
    finally{ hideLoading(); }
  };

  m.querySelector("#addBrand").onclick = async ()=>{
    const v = brandNew.value.trim();
    if(!v) return alert("Escribe una marca.");
    const ok = await confirm2s("¿Agregar marca?", `Se agregará: ${v}`);
    if(!ok) return;
    showLoading("Agregando…","Guardando marca en la base de datos.");
    try{
      await addCatalogValue("brand", v);
      brandNew.value = "";
      await fetchCatalogsFromSheets();
      brandPick.innerHTML = `<option value="">Selecciona…</option>${makeSelectOptions(BRANDS,"")}`;
      render();
    }catch(e){ alert(e.message||"Error"); }
    finally{ hideLoading(); }
  };

  m.querySelector("#delStore").onclick = async ()=>{
    const v = unescapeCss(storePick.value||"").trim();
    if(!v) return alert("Selecciona una tienda.");
    const ok = await confirm2s("¿Eliminar tienda?", `Se eliminará: ${v}`);
    if(!ok) return;
    showLoading("Eliminando…","Quitando tienda de la base de datos.");
    try{
      await deleteCatalogValue("store", v);
      await fetchCatalogsFromSheets();
      storePick.innerHTML = `<option value="">Selecciona…</option>${makeSelectOptions(STORES,"")}`;
      render();
    }catch(e){ alert(e.message||"Error"); }
    finally{ hideLoading(); }
  };

  m.querySelector("#delBrand").onclick = async ()=>{
    const v = unescapeCss(brandPick.value||"").trim();
    if(!v) return alert("Selecciona una marca.");
    const ok = await confirm2s("¿Eliminar marca?", `Se eliminará: ${v}`);
    if(!ok) return;
    showLoading("Eliminando…","Quitando marca de la base de datos.");
    try{
      await deleteCatalogValue("brand", v);
      await fetchCatalogsFromSheets();
      brandPick.innerHTML = `<option value="">Selecciona…</option>${makeSelectOptions(BRANDS,"")}`;
      render();
    }catch(e){ alert(e.message||"Error"); }
    finally{ hideLoading(); }
  };
}

async function confirm2s(title, desc){
  const html = `
    <div class="item">
      <div class="k">${title}</div>
      <div class="mini" style="margin-top:6px;">${desc}</div>
      <div class="amRow" style="margin-top:12px; justify-content:flex-end;">
        <button class="amBtn amBtnSecondary" id="am_cancel" type="button">Cancelar</button>
        <button class="amBtn" id="am_ok" type="button">Confirmar</button>
      </div>
    </div>
  `;
  const m = openModal("Confirmación", "Espera 2 segundos para confirmar.", html);
  return await confirmWithTimer(m, 2);
}

// ===== Modelo de datos UI =====
let CANON = [];       // lista de ingredientes canónicos (kitchen-costs.js)
let GROUPS = [];      // secciones/acordeones (kitchen-costs.js)
let SHEETS_ROWS = []; // items desde Sheets (COSTOS_INGREDIENTES)
let PRICES = {};      // precios cache local (solo para fallback)
let UI = {};          // estado editable por ingrediente_key

function getCanonFromKitchenCosts(){
  const canon = [];
  const groups = [];

  // Espera: window.AMARED_COSTS_SECTIONS = [{title, keys:[]}, ...]
  if(Array.isArray(window.AMARED_COSTS_SECTIONS)){
    window.AMARED_COSTS_SECTIONS.forEach(sec=>{
      groups.push({ title: sec.title, keys: (sec.keys||[]).map(String) });
      (sec.keys||[]).forEach(k=>canon.push(String(k)));
    });
  }else{
    // fallback: intenta leer window.AMARED_INGREDIENTS
    if(Array.isArray(window.AMARED_INGREDIENTS)){
      groups.push({ title:"Ingredientes", keys: window.AMARED_INGREDIENTS.map(String) });
      window.AMARED_INGREDIENTS.forEach(k=>canon.push(String(k)));
    }
  }

  // uniq
  const uniq = Array.from(new Set(canon));
  return { canon: uniq, groups };
}

function buildUIFromSheets(items){
  const map = {};
  (items||[]).forEach(r=>{
    const k = String(r.ingredient_key||"").trim();
    if(!k) return;
    map[k] = {
      ingredient_key: k,
      unit_type: normUnit(r.unit_type),
      pack_qty: String(r.pack_qty||""),
      pack_price: String(r.pack_price||""),
      cop_per_unit: String(r.cop_per_unit||""),
      brand: String(r.brand||""),
      store: String(r.store||""),
      unit_item_qty: String(r.unit_item_qty||""),
      unit_item_qty_type: String(r.unit_item_qty_type||""),
      updated_at: r.updated_at || "",
      updated_by: r.updated_by || ""
    };
  });

  // Para cada ingrediente canónico crea base si no existe
  const ui = {};
  CANON.forEach(k=>{
    ui[k] = map[k] || {
      ingredient_key: k,
      unit_type: "",
      pack_qty: "",
      pack_price: "",
      cop_per_unit: "",
      brand: "",
      store: "",
      unit_item_qty: "",
      unit_item_qty_type: "",
      updated_at: "",
      updated_by: ""
    };
  });

  UI = ui;
}

function isCompleteRow(r){
  const u = normUnit(r.unit_type);
  const qty = Number(r.pack_qty||0);
  const price = Number(r.pack_price||0);
  const cpu = Number(r.cop_per_unit||0);

  if(!u) return false;
  if(!(qty>0) || !(price>0)) return false;
  if(!(cpu>0)) return false;

  // Si unidad → exige cantidad por unidad (contenido de 1 unidad)
  if(u==="unidad"){
    const itemQty = Number(r.unit_item_qty||0);
    if(!(itemQty>0)) return false;
  }
  return true;
}

function computeCopPerUnit(u, packQty, packPrice, unitItemQty){
  const qty = Number(packQty||0);
  const price = Number(packPrice||0);
  if(!(qty>0) || !(price>0)) return 0;

  // g/ml: cop_per_unit = price / qty
  if(u==="g" || u==="ml") return price / qty;

  // unidad: pack_qty = unidades por empaque
  // cop_por_unidad = price / qty
  // si unit_item_qty existe, lo dejamos para cálculo de costo por “cantidad” (p.ej gramos por unidad)
  return price / qty;
}

function computeEstimatedCost(r){
  // Esto se usa si quieres estimar “costo por unidad” y mostrarlo.
  // Para g/ml: cop_per_unit ya es directo.
  // Para unidad: cop_per_unit es COP por unidad (pieza).
  const cpu = Number(r.cop_per_unit||0);
  return roundCOP(cpu);
}

function setRowField(key, field, value){
  UI[key][field] = value;

  // Auto cálculo cop_per_unit si cambia unidad/qty/price
  const r = UI[key];
  const u = normUnit(r.unit_type);
  const qty = Number(r.pack_qty||0);
  const price = Number(r.pack_price||0);
  const itemQty = Number(r.unit_item_qty||0);

  const cpu = computeCopPerUnit(u, qty, price, itemQty);
  if(cpu>0) UI[key].cop_per_unit = String(roundCOP(cpu));

  // Si cambia a unidad, por defecto unit_item_qty_type = "g" (se puede ajustar)
  if(u==="unidad" && !r.unit_item_qty_type) r.unit_item_qty_type = "g";

  // Si NO es unidad, limpiar campos extra
  if(u!=="unidad"){
    r.unit_item_qty = "";
    r.unit_item_qty_type = "";
  }
}

// ===== Render =====
function render(){
  const root = document.getElementById("list");
  root.innerHTML = "";

  // Top tools (Refrescar + Catálogos)
  renderTopTools();

  GROUPS.forEach((g,idx)=>{
    const keys = (g.keys||[]).filter(k=>UI[k]);
    const complete = keys.filter(k=>isCompleteRow(UI[k]));
    const pending = keys.filter(k=>!isCompleteRow(UI[k]));

    const det = document.createElement("details");
    det.className = "item";
    det.open = false; // ✅ cerrado por defecto

    det.innerHTML = `
      <summary class="am_sum" style="display:flex; align-items:center; justify-content:space-between; gap:10px; cursor:pointer;">
        <div style="display:flex; align-items:center; gap:10px;">
          <span class="am_chev">▶</span>
          <div>
            <div class="k">${g.title}</div>
            <div class="mini">${pending.length} pendiente(s) · ${complete.length} completo(s)</div>
          </div>
        </div>
        <span class="pill">${keys.length} ingrediente(s)</span>
      </summary>

      <div style="margin-top:12px;" data-sec="${idx}"></div>
    `;

    // Flecha ▶/▼
    det.addEventListener("toggle",()=>{
      det.querySelector(".am_chev").textContent = det.open ? "▼" : "▶";
    });

    const box = det.querySelector(`[data-sec="${idx}"]`);

    // Pendientes primero
    if(pending.length){
      const sub = document.createElement("details");
      sub.className = "item";
      sub.open = false;
      sub.innerHTML = `
        <summary class="am_sum" style="display:flex; align-items:center; justify-content:space-between; gap:10px; cursor:pointer;">
          <div style="display:flex; align-items:center; gap:10px;">
            <span class="am_chev">▶</span>
            <div>
              <div class="k">🟡 Pendientes</div>
              <div class="mini">${pending.length} pendiente(s)</div>
            </div>
          </div>
        </summary>
        <div style="margin-top:12px;" data-sub="p"></div>
      `;
      sub.addEventListener("toggle",()=>{
        sub.querySelector(".am_chev").textContent = sub.open ? "▼" : "▶";
      });
      box.appendChild(sub);
      const subBox = sub.querySelector(`[data-sub="p"]`);
      pending.forEach(k=> subBox.appendChild(renderIngredientRow(k)) );
    }

    // Completos
    if(complete.length){
      const sub = document.createElement("details");
      sub.className = "item";
      sub.open = false;
      sub.style.marginTop = "12px";
      sub.innerHTML = `
        <summary class="am_sum" style="display:flex; align-items:center; justify-content:space-between; gap:10px; cursor:pointer;">
          <div style="display:flex; align-items:center; gap:10px;">
            <span class="am_chev">▶</span>
            <div>
              <div class="k">✅ Completos</div>
              <div class="mini">${complete.length} completo(s)</div>
            </div>
          </div>
        </summary>
        <div style="margin-top:12px;" data-sub="c"></div>
      `;
      sub.addEventListener("toggle",()=>{
        sub.querySelector(".am_chev").textContent = sub.open ? "▼" : "▶";
      });
      box.appendChild(sub);
      const subBox = sub.querySelector(`[data-sub="c"]`);
      complete.forEach(k=> subBox.appendChild(renderIngredientRow(k)) );
    }

    root.appendChild(det);
  });
}

function renderTopTools(){
  const el = document.getElementById("topTools");
  if(!el) return;

  el.innerHTML = `
    <div class="row" style="gap:10px; flex-wrap:wrap;">
      <button class="btn secondary" id="refreshBtn">⟳ Refrescar</button>
      <button class="btn secondary" id="catalogBtn">⚙️ Tiendas/Marcas</button>
      <span class="pill">Secciones cerradas por defecto</span>
    </div>
  `;

  document.getElementById("refreshBtn").onclick = async ()=>{
    showLoading("Refrescando…","Leyendo datos actualizados desde la base de datos.");
    try{
      await fetchCatalogsFromSheets();
      SHEETS_ROWS = await fetchCostsFromSheets();
      buildUIFromSheets(SHEETS_ROWS);
      render();
    }catch(e){
      alert(e.message||"Error");
    }finally{
      hideLoading();
    }
  };

  document.getElementById("catalogBtn").onclick = async ()=>{
    try{ await openCatalogManager(); }catch(e){ alert(e.message||"Error"); }
  };
}

function renderIngredientRow(key){
  const r = UI[key];

  const wrap = document.createElement("div");
  wrap.className = "item";
  wrap.style.marginTop = "12px";

  const u = normUnit(r.unit_type);
  const cpuLabel = perUnitLabel(u);
  const est = computeEstimatedCost(r);

  // select de tiendas/marcas
  const storeOpts = `<option value="">—</option>${makeSelectOptions(STORES, r.store)}`;
  const brandOpts = `<option value="">—</option>${makeSelectOptions(BRANDS, r.brand)}`;

  wrap.innerHTML = `
    <div class="row" style="justify-content:space-between; align-items:flex-start; gap:10px; flex-wrap:wrap;">
      <div>
        <div class="k">${key}</div>
        <div class="mini" style="margin-top:4px;">${isCompleteRow(r) ? "✅ Completo" : "🟡 Pendiente"} · Estimado: <b>$${money(est)}</b></div>
      </div>
      <span class="pill">${u ? u : "sin unidad"}</span>
    </div>

    <div style="margin-top:12px; display:grid; grid-template-columns: repeat(12, 1fr); gap:10px;">
      <div style="grid-column: span 3;">
        <div class="mini" style="font-weight:900;">Unidad</div>
        <select class="input" data-k="${cssEscape(key)}" data-f="unit_type">
          <option value="">Selecciona…</option>
          <option value="g" ${u==="g"?"selected":""}>g</option>
          <option value="ml" ${u==="ml"?"selected":""}>ml</option>
          <option value="unidad" ${u==="unidad"?"selected":""}>unidad</option>
        </select>
      </div>

      <div style="grid-column: span 3;">
        <div class="mini" style="font-weight:900;">${unitLabel(u)}</div>
        <input class="input" data-k="${cssEscape(key)}" data-f="pack_qty" placeholder="${unitPlaceholder(u)}" value="${r.pack_qty||""}">
      </div>

      <div style="grid-column: span 3;">
        <div class="mini" style="font-weight:900;">Precio empaque (COP)</div>
        <input class="input" data-k="${cssEscape(key)}" data-f="pack_price" placeholder="Ej: 12000" value="${r.pack_price||""}">
      </div>

      <div style="grid-column: span 3;">
        <div class="mini" style="font-weight:900;">${cpuLabel}</div>
        <input class="input" data-k="${cssEscape(key)}" data-f="cop_per_unit" placeholder="Auto" value="${r.cop_per_unit||""}">
      </div>

      <div style="grid-column: span 6;" class="unitExtra ${u==="unidad"?"":"hide"}">
        <div class="mini" style="font-weight:900;">Cantidad por unidad (contenido)</div>
        <div class="row" style="gap:10px; flex-wrap:wrap;">
          <input class="input" style="flex:1; min-width:160px;" data-k="${cssEscape(key)}" data-f="unit_item_qty" placeholder="Ej: 200" value="${r.unit_item_qty||""}">
          <select class="input" style="width:140px;" data-k="${cssEscape(key)}" data-f="unit_item_qty_type">
            <option value="g" ${(r.unit_item_qty_type||"")==="g"?"selected":""}>g</option>
            <option value="ml" ${(r.unit_item_qty_type||"")==="ml"?"selected":""}>ml</option>
          </select>
        </div>
        <div class="mini" style="margin-top:6px;">Ejemplo: si 1 unidad trae 200g, escribe 200 y elige “g”.</div>
      </div>

      <div style="grid-column: span 3;">
        <div class="mini" style="font-weight:900;">Tienda</div>
        <select class="input" data-k="${cssEscape(key)}" data-f="store">
          ${storeOpts}
        </select>
      </div>

      <div style="grid-column: span 3;">
        <div class="mini" style="font-weight:900;">Marca</div>
        <select class="input" data-k="${cssEscape(key)}" data-f="brand">
          ${brandOpts}
        </select>
      </div>

      <div style="grid-column: span 6;">
        <div class="mini" style="font-weight:900;">Última actualización</div>
        <input class="input" disabled value="${r.updated_at ? String(r.updated_at) : ""}" placeholder="—">
      </div>
    </div>
  `;

  // esconder/mostrar extra unidad
  const extra = wrap.querySelector(".unitExtra");
  if(extra){
    extra.style.display = (u==="unidad") ? "block" : "none";
  }

  // listeners
  wrap.querySelectorAll("[data-k]").forEach(inp=>{
    inp.addEventListener("input", ()=>{
      const k = unescapeCss(inp.getAttribute("data-k"));
      const f = inp.getAttribute("data-f");
      const v = inp.value;

      setRowField(k, f, v);

      // si cambia unidad, re-render para mostrar/ocultar extra
      if(f==="unit_type"){
        render();
      }else{
        // actualiza "estimado" de esta fila
        const mini = wrap.querySelector(".mini b");
        if(mini) mini.textContent = `$${money(computeEstimatedCost(UI[k]))}`;
      }
    }, {passive:true});
    inp.addEventListener("change", ()=>{
      const k = unescapeCss(inp.getAttribute("data-k"));
      const f = inp.getAttribute("data-f");
      const v = inp.value;
      setRowField(k, f, v);
      if(f==="unit_type") render();
    }, {passive:true});
  });

  return wrap;
}

// ===== Guardado =====
async function saveAllToSheets(){
  const keys = Object.keys(UI||{});
  showLoading("Guardando…","Actualizando información en la base de datos.");
  try{
    for(const k of keys){
      const r = UI[k];
      // Solo guarda si tiene algo (o si está completo)
      const hasAny = String(r.unit_type||"").trim() || String(r.pack_qty||"").trim() || String(r.pack_price||"").trim() || String(r.cop_per_unit||"").trim() || String(r.brand||"").trim() || String(r.store||"").trim();
      if(!hasAny) continue;
      await upsertCostToSheets(r);
    }
  }finally{
    hideLoading();
  }
}

async function bootstrap(){
  // Unlock
  document.getElementById("unlock").onclick = async ()=>{
    const s = document.getElementById("secret").value.trim();
    if(!s){
      document.getElementById("err").textContent = "Ingresa la clave.";
      return;
    }
    document.getElementById("err").textContent = "";
    UNLOCKED_SECRET = s;

    showLoading("Verificando…","Validando acceso y cargando datos.");
    try{
      // Carga canon
      const k = getCanonFromKitchenCosts();
      CANON = k.canon;
      GROUPS = k.groups;

      // Catálogos + costos
      await fetchCatalogsFromSheets();
      SHEETS_ROWS = await fetchCostsFromSheets();
      buildUIFromSheets(SHEETS_ROWS);

      document.getElementById("editor").style.display = "block";
      render();
    }catch(e){
      document.getElementById("err").textContent = (e && e.message) ? e.message : "Error";
      UNLOCKED_SECRET = "";
    }finally{
      hideLoading();
    }
  };

  // Save
  document.getElementById("saveAll").onclick = async ()=>{
    try{
      await saveAllToSheets();
      // refresca todo después de guardar
      showLoading("Refrescando…","Cargando cambios desde la base de datos.");
      await fetchCatalogsFromSheets();
      SHEETS_ROWS = await fetchCostsFromSheets();
      buildUIFromSheets(SHEETS_ROWS);
      render();
    }catch(e){
      alert(e.message||"Error");
    }finally{
      hideLoading();
    }
  };
}

document.addEventListener("DOMContentLoaded", bootstrap);
