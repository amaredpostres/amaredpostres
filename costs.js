
// ===============================
// PATCH AMARED (FULLFIX v1)
// - Define normDateOnly_ globally to avoid ReferenceError
// - Hide global "Reiniciar sobrantes" button (#buyReset)
// ===============================
console.log("[AMARED] costs.js cargado: FULLFIX v1");

// Global date normalizer (YYYY-MM-DD) compatible with any scope
(function(){
  function _norm(value){
    if(!value) return "";
    // If already 'YYYY-MM-DD...'
    if(typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0,10);
    const d = (value instanceof Date) ? value : new Date(value);
    if(isNaN(d.getTime())) return "";
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,"0");
    const day = String(d.getDate()).padStart(2,"0");
    return `${y}-${m}-${day}`;
  }
  // expose in all globals
  globalThis.normDateOnly_ = globalThis.normDateOnly_ || _norm;
  // also window alias (browser)
  if(typeof window !== "undefined") window.normDateOnly_ = window.normDateOnly_;
})();

// Hide the global reset button; we keep code but remove from UI
document.addEventListener("DOMContentLoaded", ()=>{
  const btn = document.getElementById("buyReset");
  if(btn) btn.style.display = "none";
});

window.amaredRefreshOrders = async function(ev){
  try{ ev && ev.preventDefault && ev.preventDefault(); }catch(_e){}
  try{
    setNetDebug_("<b>AMARED</b> Ejecutando: Actualizar desde pedidos…", "info");
    if(typeof showLoading === "function"){ showLoading("Calculando desde pedidos…", "Leyendo PEDIDOS (Pagado + No iniciar) y aplicando corte 3:00 p.m."); }
    if(typeof loadNeedsFromPaidOrdersAndRender_ === "function"){
      await loadNeedsFromPaidOrdersAndRender_();
    }else{
      throw new Error("No existe la función loadNeedsFromPaidOrdersAndRender_. El JS cargado no es el correcto.");
    }
    if(typeof hideLoading === "function"){ hideLoading(); }
    if(typeof showToast === "function"){ showToast("Pedidos actualizados", "ok"); }
    setNetDebug_("<b>AMARED</b> OK: tabla actualizada.", "ok");
  }catch(e){
    try{ if(typeof hideLoading === "function") hideLoading(); }catch(_e){}
    console.error(e);
    if(typeof showToast === "function"){ showToast(e && e.message ? e.message : "No se pudo actualizar desde pedidos", "err"); }
    setNetDebug_("<b>AMARED</b> Error: " + (e && e.message ? e.message : "fallo") , "err");
  }
  return false;
};


function setNetDebug_(msg, type){
  const el = document.getElementById("netDebug");
  if(!el) return;
  el.style.display = "block";
  el.innerHTML = msg;
  el.style.background = (type==="err") ? "#b00020" : (type==="ok" ? "#0b6e4f" : "#111");
  clearTimeout(el.__t);
  el.__t = setTimeout(()=>{ el.style.display="none"; }, 5500);
}


function initBuyButtons_(){
  const btnRefresh = document.getElementById("buyRefreshOrders") || document.getElementById("buyImport");
  if(btnRefresh && !btnRefresh.__amaredBound){
    btnRefresh.__amaredBound = true;
    btnRefresh.addEventListener("click", (ev)=> window.amaredRefreshOrders && window.amaredRefreshOrders(ev));
  }
  const btnReset = document.getElementById("buyReset");
  if(btnReset && !btnReset.__amaredBound){
    btnReset.__amaredBound = true;
    btnReset.addEventListener("click", ()=>{
      try{
        lsWriteObj(STOCK_LS_KEY, {});
        setPurchaseSelect_({});
        renderPurchases();
        showToast("Sobrantes reiniciados", "ok");
      }catch(e){
        console.error(e);
        showToast("No se pudo reiniciar", "err");
      }
    });
  }
}

const API_URL = "https://amared-orders.amaredpostres.workers.dev/";

let UNLOCKED_SECRET = "";
let STORES = [];
let BRANDS = [];

let CANON = [];
let GROUPS = [];
let UI = {};
let SHEETS_ROWS = [];

// ===== Helpers =====
function getPurchaseSelect_(){ return lsReadObj(PURCHASE_SELECT_LS_KEY); }
function setPurchaseSelect_(obj){ lsWriteObj(PURCHASE_SELECT_LS_KEY, obj||{}); }

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

function uniqSorted(arr){
  const uniq = Array.from(new Set((arr||[]).map(s=>String(s||"").trim()).filter(Boolean)));
  uniq.sort((a,b)=>a.localeCompare(b,"es"));
  return uniq;
}
function cssEscape(s){ return String(s).replace(/"/g,'\\\\"'); }
function unescapeCss(s){ return String(s).replace(/\\\\"/g,'"'); }

function normUnit(u){
  const s = String(u||"").trim().toLowerCase();
  if(s==="g") return "g";
  if(s==="ml") return "ml";
  if(s==="unidad"||s==="u") return "unidad";
  return "";
}
function money(n){ return Math.round(Number(n||0)).toLocaleString("es-CO"); }
function roundCOP(n){ return Math.max(0, Math.round(Number(n||0))); }

// ===== Sheets =====
async function fetchCostsFromSheets(){
  const out = await api({ action:"costs_list", costs_secret: UNLOCKED_SECRET });
  return out.items || [];
}
async function upsertCostToSheets(row){
  return await api({
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
  });
}
async function fetchCatalogsFromSheets(){
  const out = await api({ action:"catalog_list", costs_secret: UNLOCKED_SECRET });
  // Webhook devuelve: { ok:true, catalog:{ stores:[...], brands:[...] } }
  const cat = out.catalog || {};
  const stores = (cat.stores || []).map(x=>x.value || x).filter(Boolean);
  const brands = (cat.brands || []).map(x=>x.value || x).filter(Boolean);
  STORES = uniqSorted(stores);
  BRANDS = uniqSorted(brands);
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

// ===== Modal =====
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

  m.querySelector("#am_modal_close").onclick = ()=> m.classList.remove("isOpen");
  m.addEventListener("click",(e)=>{ if(e.target===m) m.classList.remove("isOpen"); }, {passive:true});

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

async function confirm2s(title, desc){
  const html = `
    <div class="item">
      <div class="k">${title}</div>
      <div class="mini" style="margin-top:6px;">${desc}</div>
      <div class="amRow" style="margin-top:12px; justify-content:flex-end;">
        <button class="amBtn amBtnSecondary" id="am_cancel" type="button">Cancelar</button>
        <button class="amBtn" id="am_ok" type="button" disabled>Confirmar (2)</button>
      </div>
    </div>
  `;
  const m = openModal("Confirmación", "Espera 2 segundos para confirmar.", html);

  const okBtn = m.querySelector("#am_ok");
  const cancelBtn = m.querySelector("#am_cancel");
  let t = 2;
  const int = setInterval(()=>{
    t--;
    if(t<=0){
      clearInterval(int);
      okBtn.disabled=false;
      okBtn.textContent="Confirmar";
    }else{
      okBtn.textContent=`Confirmar (${t})`;
    }
  },1000);

  return await new Promise((resolve)=>{
    cancelBtn.onclick = ()=>{ clearInterval(int); m.classList.remove("isOpen"); resolve(false); };
    okBtn.onclick = ()=>{ clearInterval(int); m.classList.remove("isOpen"); resolve(true); };
  });
}

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
  const storeNew  = m.querySelector("#storeNew");
  const brandNew  = m.querySelector("#brandNew");

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
      render();
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

// ===== Secciones =====
function getCanonFromKitchenCosts(){
  if(Array.isArray(window.AMARED_COSTS_SECTIONS) && window.AMARED_COSTS_SECTIONS.length){
    const groups = window.AMARED_COSTS_SECTIONS.map(s=>({
      title: s.title,
      keys: (s.keys||[]).map(String)
    }));
    const canon = Array.from(new Set(groups.flatMap(g=>g.keys)));
    return { canon, groups };
  }
  return { canon: [], groups: [] };
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
  if(!(qty>0) || !(price>0) || !(cpu>0)) return false;
  if(u==="unidad"){
    const itemQty = Number(r.unit_item_qty||0);
    if(!(itemQty>0)) return false;
  }
  return true;
}

function computeCopPerUnit(u, packQty, packPrice){
  const qty = Number(packQty||0);
  const price = Number(packPrice||0);
  if(!(qty>0) || !(price>0)) return 0;
  return price / qty;
}

function setRowField(key, field, value){
  if(field==="cop_per_unit") return; // Auto calculado, no editable
  UI[key][field] = value;

  const r = UI[key];
  const u = normUnit(r.unit_type);

  // si cambia a unidad, default tipo contenido g
  if(field==="unit_type"){
    if(u==="unidad" && !r.unit_item_qty_type) r.unit_item_qty_type = "g";
    if(u!=="unidad"){ r.unit_item_qty=""; r.unit_item_qty_type=""; }
  }

  // auto cálculo
  const cpu = computeCopPerUnit(u, r.pack_qty, r.pack_price);
  if(cpu>0) r.cop_per_unit = String(roundCOP(cpu));
}

// ====== Mantener acordeones abiertos ======
function getOpenAccordionsState(){
  const open = new Set();
  document.querySelectorAll("#list details.item[data-idx]").forEach(det=>{
    if(det.open) open.add(String(det.getAttribute("data-idx")));
  });
  return open;
}

function restoreOpenAccordionsState(openSet){
  document.querySelectorAll("#list details.item[data-idx]").forEach(det=>{
    const idx = String(det.getAttribute("data-idx"));
    det.open = openSet.has(idx);
    const chev = det.querySelector(".am_chev");
    if(chev) chev.textContent = det.open ? "▼" : "▶";
  });
}

// ===== Render =====
function renderTopTools(){
  const el = document.getElementById("topTools");
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
    
      try{ renderPurchases(); }catch(_e){}}catch(e){ alert(e.message||"Error"); }
    finally{ hideLoading(); }
  };

  document.getElementById("catalogBtn").onclick = async ()=>{
  showLoading("Cargando…","Abriendo Tiendas/Marcas.");
  try{ await openCatalogManager(); }
  catch(e){ alert(e.message||"Error"); }
  finally{ hideLoading(); }
};
}

function renderIngredientRow(key, sectionIndex){
  const r = UI[key];
  const u = normUnit(r.unit_type);

  const wrap = document.createElement("div");
  wrap.className = "item";
  wrap.style.marginTop = "12px";

  const storeOpts = `<option value="">—</option>${makeSelectOptions(STORES, r.store)}`;
  const brandOpts = `<option value="">—</option>${makeSelectOptions(BRANDS, r.brand)}`;

  wrap.innerHTML = `
    <div class="row" style="justify-content:space-between; align-items:flex-start; gap:10px; flex-wrap:wrap;">
      <div>
        <div class="k">${key}</div>
        <div class="mini" style="margin-top:4px;">${isCompleteRow(r) ? "✅ Completo" : "🟡 Pendiente"}</div>
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
        <div class="mini" style="font-weight:900;">Cantidad empaque</div>
        <input class="input" data-k="${cssEscape(key)}" data-f="pack_qty" placeholder="Ej: 1000" value="${r.pack_qty||""}">
      </div>

      <div style="grid-column: span 3;">
        <div class="mini" style="font-weight:900;">Precio empaque (COP)</div>
        <input class="input" data-k="${cssEscape(key)}" data-f="pack_price" placeholder="Ej: 12000" value="${r.pack_price||""}">
      </div>

      <div style="grid-column: span 3;">
        <div class="mini" style="font-weight:900;">COP por unidad</div>
        <input class="input" data-k="${cssEscape(key)}" data-f="cop_per_unit" placeholder="Auto" value="${r.cop_per_unit||""}" readonly style="background:#f7f7f7; cursor:not-allowed;" title="Auto calculado">
      </div>

      <div style="grid-column: span 6; ${u==="unidad" ? "" : "display:none;"}">
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
        <select class="input" data-k="${cssEscape(key)}" data-f="store">${storeOpts}</select>
      </div>

      <div style="grid-column: span 3;">
        <div class="mini" style="font-weight:900;">Marca</div>
        <select class="input" data-k="${cssEscape(key)}" data-f="brand">${brandOpts}</select>
      </div>

      <div style="grid-column: span 6;">
        <div class="mini" style="font-weight:900;">Última actualización</div>
        <input class="input" disabled value="${r.updated_at ? String(r.updated_at) : ""}" placeholder="—">
      </div>
    </div>
  `;

  wrap.querySelectorAll("[data-k]").forEach(inp=>{
    // Cuando cambia unidad: re-render pero manteniendo acordeones abiertos
    const onChange = ()=>{
      const k = unescapeCss(inp.getAttribute("data-k"));
      const f = inp.getAttribute("data-f");
      const v = inp.value;
      setRowField(k,f,v);

      if(f==="unit_type"){
        const openState = getOpenAccordionsState();
        openState.add(String(sectionIndex)); // fuerza abierta la sección donde estás
        render();
        restoreOpenAccordionsState(openState);
      }
    };

    // Para input normal: solo actualiza datos (no re-render)
    const onInput = ()=>{
      const k = unescapeCss(inp.getAttribute("data-k"));
      const f = inp.getAttribute("data-f");
      const v = inp.value;
      setRowField(k,f,v);
    };

    inp.addEventListener("change", onChange, {passive:true});
    inp.addEventListener("input", onInput, {passive:true});
  });

  return wrap;
}

function render(){
  // ✅ guardar cuáles estaban abiertos antes
  const openState = getOpenAccordionsState();

  renderTopTools();

  const root = document.getElementById("list");
  root.innerHTML = "";

  if(!GROUPS.length){
    root.innerHTML = `<div class="item"><div class="k">No hay secciones</div><div class="mini" style="margin-top:6px;">
      Revisa que <b>kitchen-costs.js</b> tenga <code>window.AMARED_COSTS_SECTIONS</code>.
    </div></div>`;
    return;
  }

  GROUPS.forEach((g,idx)=>{
    const keys = (g.keys||[]).filter(k=>UI[k]);
    const complete = keys.filter(k=>isCompleteRow(UI[k]));
    const pending = keys.filter(k=>!isCompleteRow(UI[k]));

    const det = document.createElement("details");
    det.className = "item";
    det.setAttribute("data-idx", String(idx));
    det.open = false;

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

    det.addEventListener("toggle",()=>{
      const chev = det.querySelector(".am_chev");
      if(chev) chev.textContent = det.open ? "▼" : "▶";
    });

    const box = det.querySelector(`[data-sec="${idx}"]`);
    keys.forEach(k=> box.appendChild(renderIngredientRow(k, idx)));
    root.appendChild(det);
  });

  // ✅ restaurar acordeones abiertos
  restoreOpenAccordionsState(openState);
}

// ===== Guardar =====
async function saveAllToSheets(){
  const keys = Object.keys(UI||{});
  showLoading("Guardando…","Actualizando información en la base de datos.");
  try{
    for(const k of keys){
      const r = UI[k];
      const hasAny =
        String(r.unit_type||"").trim() ||
        String(r.pack_qty||"").trim() ||
        String(r.pack_price||"").trim() ||
        String(r.cop_per_unit||"").trim() ||
        String(r.brand||"").trim() ||
        String(r.store||"").trim();

      if(!hasAny) continue;
      await upsertCostToSheets(r);
    }
  }finally{
    hideLoading();
  }
}


// =========================
// COMPRAS / SOBRANTES (localStorage)
// =========================
const STOCK_LS_KEY = "amared_stock_ingredients_v1";
const NEED_LS_KEY  = "amared_need_ingredients_v1";
// Keys alternos por compatibilidad (si Cocina guarda otro nombre)
const NEED_LS_KEYS_FALLBACK = ["amared_required_ingredients", "amared_kitchen_batch_ingredients", "amared_latest_batch_ingredients_v1"];

function lsReadObj(key){
  try{
    const raw = localStorage.getItem(key);
    if(!raw) return {};
    const obj = JSON.parse(raw);
    return (obj && typeof obj === "object") ? obj : {};
  }catch(_e){ return {}; }
}
function lsWriteObj(key, obj){
  try{ localStorage.setItem(key, JSON.stringify(obj||{})); }catch(_e){}
}
// ===== Shopping helpers (persistencia cross-device via servidor + respaldo local) =====
function getNeedList(){
  // En esta app lo manejamos como objeto: { "Ingrediente": cantidadNecesaria }
  return lsReadObj(NEED_LS_KEY);
}
function getStockMap(){
  // Sobrantes/inventario: { "Ingrediente": cantidadSobrante }
  return lsReadObj(STOCK_LS_KEY);
}

// Toast simple (no bloqueante)
function showToast(msg, kind="ok"){
  try{
    let el = document.getElementById("toast");
    if(!el){
      el = document.createElement("div");
      el.id = "toast";
      el.style.position = "fixed";
      el.style.left = "50%";
      el.style.bottom = "22px";
      el.style.transform = "translateX(-50%)";
      el.style.padding = "10px 14px";
      el.style.borderRadius = "14px";
      el.style.boxShadow = "0 10px 30px rgba(0,0,0,.18)";
      el.style.fontWeight = "700";
      el.style.fontSize = "14px";
      el.style.zIndex = "99999";
      el.style.maxWidth = "92vw";
      el.style.textAlign = "center";
      el.style.cursor = "pointer";
      el.onclick = ()=>{ el.style.display="none"; };
      document.body.appendChild(el);
    }
    el.textContent = String(msg || "");
    // colores coherentes con el tema (sin depender de CSS extra)
    if(kind === "err"){
      el.style.background = "rgba(255, 80, 110, .95)";
      el.style.color = "#fff";
    }else{
      el.style.background = "rgba(246, 186, 96, .95)";
      el.style.color = "#3a1a0a";
    }
    el.style.display = "block";
    clearTimeout(el._t);
    el._t = setTimeout(()=>{ el.style.display="none"; }, 2600);
  }catch(_){}
}

function fmtDateTimeCol_(iso){
  try{
    const d = new Date(iso);
    return d.toLocaleString("es-CO", { year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit" });
  }catch(_){ return String(iso||""); }
}

function num(v){
  const n = Number(String(v).replace(",", "."));
  if(!isFinite(n)) return 0;
  return n;
}
function fmt(n){
  const x = Number(n||0);
  if(!isFinite(x)) return "0";
  // mostrar decimales solo si hace falta
  const isInt = Math.abs(x - Math.round(x)) < 1e-9;
  return isInt ? String(Math.round(x)) : x.toFixed(1).replace(".", ",");
}
function fmtCOP(n){
  const x = Math.round(Number(n||0));
  return x.toLocaleString("es-CO");
}

function getAllIngredientKeys(){
  const a = [];
  for(const k of (CANON||[])) a.push(k);
  for(const r of (SHEETS_ROWS||[])){
    if(r && r.ingredient_key) a.push(String(r.ingredient_key));
  }
  return uniqSorted(a);
}

function findCostRow(ingredientKey){
  const key = String(ingredientKey||"");
  return (SHEETS_ROWS||[]).find(r=> String(r.ingredient_key||"")===key) || null;
}

function renderPurchases(ctx){
  const acc = document.getElementById("buyAcc");
  const hint = document.getElementById("buySummaryHint");
  const totalsEl = document.getElementById("buyTotals");
  const listEl = document.getElementById("buyList");
  if(!acc || !totalsEl || !listEl) return;

  const stock = lsReadObj(STOCK_LS_KEY);
  const need  = lsReadObj(NEED_LS_KEY);

  const keys = getAllIngredientKeys();

  let totalCost = 0;
  let countNeed = 0;

  const rowsHtml = keys.map(k=>{
    const row = findCostRow(k);
    const unit = normUnit(row?.unit_type || "");
    const price = num(row?.cop_per_unit || 0);
    const nNeed = num(need[k] ?? 0);
    const nStock = num(stock[k] ?? 0);
    const nBuy = Math.max(0, nNeed - nStock);
    const lineCost = nBuy * price;

    if(nNeed > 0) countNeed++;
    totalCost += lineCost;

    const priceTxt = price>0 ? `$${fmtCOP(price)}/u` : "—";

    return `
      <tr data-k="${cssEscape(k)}">
        <td>
          <div class="buyName">${k}</div>
          <div class="buyUnit">${unit || "unidad"} · ${priceTxt}</div>
        </td>
        <td><input class="buyNum inpNeed" inputmode="decimal" value="${fmt(nNeed)}" /></td>
        <td><input class="buyNum inpStock" inputmode="decimal" value="${fmt(nStock)}" /></td>
        <td class="buyToBuy">${
          nBuy>0 ? fmt(nBuy) : "0"
        }</td>
        <td class="buyToBuy">$${fmtCOP(lineCost)}</td>
      </tr>
    `;
  }).join("");

  listEl.innerHTML = `
    <table class="buyTable">
      <thead>
        <tr>
          <th>Ingrediente</th>
          <th>Necesario</th>
          <th>Sobrante</th>
          <th>Comprar</th>
          <th>Costo estimado</th>
        </tr>
      </thead>
      <tbody>${rowsHtml || `<tr><td colspan="5" class="muted small">Sin datos.</td></tr>`}</tbody>
    </table>
  `;

  totalsEl.innerHTML = `
    <div class="buyPill">Ingredientes con necesidad: ${countNeed}</div>
    <div class="buyPill">Total compra estimada: $${fmtCOP(totalCost)}</div>
  `;
  hint.textContent = `$${fmtCOP(totalCost)} · ${countNeed} ing.`;

  renderPurchaseChecklist_({ keys, need, stock, ctx });

  // bind inputs (delegación)
  const tbody = listEl.querySelector("tbody");
  tbody.addEventListener("input", (ev)=>{
    const tr = ev.target.closest("tr");
    if(!tr) return;
    const key = unescapeCss(tr.getAttribute("data-k")||"");
    if(!key) return;

    const needObj = lsReadObj(NEED_LS_KEY);
    const stockObj = lsReadObj(STOCK_LS_KEY);

    if(ev.target.classList.contains("inpNeed")){
      needObj[key] = num(ev.target.value);
      lsWriteObj(NEED_LS_KEY, needObj);
    }
    if(ev.target.classList.contains("inpStock")){
      stockObj[key] = num(ev.target.value);
      lsWriteObj(STOCK_LS_KEY, stockObj);
    }
    // re-render rápido (sin loader)
    renderPurchases();
  }, { once: true }); // el render vuelve a crear la tabla; re-atach en cada render
}

function importNeedsFromKitchen(){
  // Lee NEED_LS_KEY si ya existe
  let obj = lsReadObj(NEED_LS_KEY);
  if(Object.keys(obj).length>0) return obj;

  for(const k of NEED_LS_KEYS_FALLBACK){
    const o = lsReadObj(k);
    if(o && Object.keys(o).length>0){
      obj = o;
      break;
    }
  }
  return obj;
}



async function fetchNeedsFromServer(){
  // Requiere que UNLOCKED_SECRET esté definido (COSTS_SECRET)
  if(!UNLOCKED_SECRET) return null;
  try{
    const out = await api({ action:"shopping_get", costs_secret: UNLOCKED_SECRET });
    // Esperado: { ok:true, data:{ day_key, items:[{name,unit,qty}], created_at, operator } }
    return out?.data || null;
  }catch(e){
    // Si no existe la acción aún, simplemente ignoramos y seguimos con localStorage
    console.warn("shopping_get no disponible:", e?.message||e);
    return null;
  }
}

// -------------------------------
// Compras: carga desde servidor (COMPRAS_NEED) + persistencia de sobrantes
// -------------------------------
let LAST_SERVER_PAYLOAD = null;   // {day_key, created_at, needs, ...}
let LAST_SERVER_META = null;      // {day_key, created_at}

function setBuyMetaText_(txt){
  const el = document.getElementById("buySummaryHint");
  if(!el) return;
  if(txt) el.textContent = txt;
}

async function loadNeedsFromServerAndRender_(){
  // Trae desde el servidor el último cálculo enviado desde Cocina (hoja COMPRAS_NEED)
  try{
    const serverData = await fetchNeedsFromServer(); // {items, payload, created_at, day_key...}

    // El Apps Script devuelve: { ok:true, data:{ day_key, created_at, items:[{name,unit,qty}], payload?:{...} } }
    // Aceptamos varias formas para máxima compatibilidad.
    const data = serverData || {};
    const payload = (data && data.payload) ? data.payload : null;
    const items = (data && Array.isArray(data.items)) ? data.items : (payload && Array.isArray(payload.items) ? payload.items : []);

    // 1) Construir NEEDS (necesario) desde items (qty / need_qty)
    const needsObj = {};
    for(const it of items){
      const name = (it && (it.name || it.ingredient || it.n)) ? String(it.name || it.ingredient || it.n).trim() : '';
      if(!name) continue;
      const qty = Number(it.qty ?? it.need_qty ?? it.need ?? it.amount ?? 0) || 0;
      needsObj[name] = qty;
    }

    // 2) Guardar en localStorage para que el render actual lo use (sin romper el formato existente)
    lsWriteObj(NEED_LS_KEY, needsObj);

    // 3) Meta (fecha/hora) del último envío para mostrar al usuario (si existe el contenedor)
    const meta = {
      day_key: data.day_key || payload?.day_key || null,
      created_at: data.created_at || payload?.created_at || null,
      updated_at_local: new Date().toISOString()
    };
    lsWriteObj('AMARED_SHOPPING_META', meta);

    // 4) Render UI
    renderPurchases();

    // 5) Mostrar fecha/hora si existe contenedor (no falla si no existe)
    const metaEl = document.getElementById('shoppingMeta');
    if(metaEl){
      metaEl.textContent = meta.created_at
        ? `Último envío desde cocina: ${meta.created_at}`
        : 'Sin envíos recientes desde cocina.';
    }

    return true;
  }catch(err){
    console.error('loadNeedsFromServerAndRender_ error', err);
    showToast('No se pudo importar desde cocina. Revisa consola.', 'error');
    return false;
  }
}

async function saveShoppingPayloadToServer_(){
  // Construye un payload unificado: needs + stock + meta
  const stock = getStockMap();
  const needs = getNeedList();

  const dayKey = (LAST_SERVER_META && LAST_SERVER_META.day_key) ? LAST_SERVER_META.day_key : (new Date()).toISOString().slice(0,10);
  const createdAt = (LAST_SERVER_META && LAST_SERVER_META.created_at) ? LAST_SERVER_META.created_at : (new Date()).toISOString();

  const payload = Object.assign({}, (LAST_SERVER_PAYLOAD && typeof LAST_SERVER_PAYLOAD === "object") ? LAST_SERVER_PAYLOAD : {});
  payload.day_key = payload.day_key || dayKey;
  payload.created_at = payload.created_at || createdAt;
  payload.needs = needs;
  payload.stock = stock;
  payload.updated_from_costs_at = new Date().toISOString();

  const res = await api({ action:"shopping_save", costs_secret: UNLOCKED_SECRET, payload });
  if(!res || res.ok !== true){
    throw new Error(res && res.error ? res.error : "No se pudo guardar compras en servidor");
  }
  // Actualiza meta local con respuesta
  if(res.day_key) LAST_SERVER_META = { day_key: String(res.day_key), created_at: payload.created_at };
  setBuyMetaText_(LAST_SERVER_META && LAST_SERVER_META.created_at
    ? `Última sincronización desde cocina: ${fmtDateTimeCol_(LAST_SERVER_META.created_at)}`
    : "");
}



// ===== Bootstrap =====
async function bootstrap(){
  document.getElementById("unlock").onclick = async ()=>{
    const s = document.getElementById("secret").value.trim();
    if(!s){ document.getElementById("err").textContent="Ingresa la clave."; return; }
    document.getElementById("err").textContent = "";
    UNLOCKED_SECRET = s;

    showLoading("Cargando…","Leyendo secciones, catálogos y costos.");
    try{
      const data = getCanonFromKitchenCosts();
      CANON = data.canon;
      GROUPS = data.groups;

      await fetchCatalogsFromSheets();
      SHEETS_ROWS = await fetchCostsFromSheets();
      buildUIFromSheets(SHEETS_ROWS);

      document.getElementById("editor").style.display = "block";
      render();

      // Traer lista de compras desde servidor (multi-dispositivo)
      try{
        const serverNeed = await fetchNeedsFromServer();
        if(serverNeed && Array.isArray(serverNeed.items)){
          // Guardamos en localStorage para reutilizar UI existente
          const obj = {};
          for(const it of serverNeed.items){
            const key = (String(it.name||"").trim().toLowerCase()) + "|" + (String(it.unit||"").trim().toLowerCase());
            obj[key] = Number(it.qty||0);
          }
          lsWriteObj(NEED_LS_KEY, obj);
        }
      }catch(_e){}


    
      // Compras / sobrantes
      try{ renderPurchases(); }catch(_e){}
      const bi=document.getElementById("buyImport");
      const br=document.getElementById("buyReset");
      if(bi && !bi._bound){
        bi._bound=true;
        bi.onclick=async ()=>{
          try{
            showLoading( "Importando desde cocina...");
            // Lee COMPRAS_NEED desde el servidor (Worker -> Apps Script) y renderiza
            await loadNeedsFromServerAndRender_({saveBack:true});
            // abre el acordeón si estaba cerrado
            const acc=document.getElementById("buyAcc");
            if(acc && !acc.open) acc.open = true;
          }catch(e){
            console.error("import buy error", e);
            showToast(e && e.message ? e.message : "No se pudo importar desde cocina", "err");
          }finally{
            hideLoading();
          }
        };
      }
      if(br && !br._bound){
        br._bound=true;
        br.onclick=async ()=>{
          try{
            showLoading( "Reiniciando sobrantes...");
            lsWriteObj(STOCK_LS_KEY, {});
            // Guardar en servidor para que aplique en cualquier navegador
            await saveShoppingPayloadToServer_();
            renderPurchases({ needs: getNeedList(), stock: getStockMap(), meta: LAST_SERVER_META });
            const acc=document.getElementById("buyAcc");
            if(acc && !acc.open) acc.open = true;
            showToast("Sobrantes reiniciados", "ok");
          }catch(e){
            console.error("reset sobrantes error", e);
            showToast(e && e.message ? e.message : "No se pudo reiniciar sobrantes", "err");
          }finally{
            hideLoading();
          }
        };
      }
}catch(e){
      document.getElementById("err").textContent = e.message || "Error";
      UNLOCKED_SECRET = "";
    }finally{
      hideLoading();
    }
  };

  document.getElementById("saveAll").onclick = async ()=>{
    try{
      await saveAllToSheets();
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

async function loadNeedsFromPaidOrdersAndRender_(){
  if(!UNLOCKED_SECRET) throw new Error("Primero desbloquea Costos con tu clave.");
  // Backend debe devolver {needs:{ingredient:qty}, late:{byDessert:{}, total:{}}, meta:{...}}
  const out = await api({ action:"costs_orders_for_purchases", costs_secret: UNLOCKED_SECRET });
  const needs = out.needs || out.needObj || (out.data && out.data.items ? out.data.items : null);
  if(!needs || typeof needs !== "object") throw new Error("No llegó la necesidad desde pedidos. Revisa Worker/Apps Script.");
  lsWriteObj(NEED_LS_KEY, needs);

  // cargar inventario desde BD si está disponible
  try{
    const inv = await api({ action:"inventory_get", costs_secret: UNLOCKED_SECRET });
    if(inv && inv.ok && inv.inventory && typeof inv.inventory === "object"){
      lsWriteObj(STOCK_LS_KEY, inv.inventory);
    }
  }catch(e){
    console.warn("No se pudo leer INVENTARIO (se usará local):", e);
  }

  renderPurchases(out);
}

function renderPurchaseChecklist_({ keys, need, stock, ctx }){
  const panel = document.getElementById("buyPurchasePanel");
  if(!panel) return;

  const sel = getPurchaseSelect_();
  const rows = keys.map(k=>{
    const row = findCostRow(k) || {};
    const unit = normUnit(row.unit_type || "") || "unidad";
    const packQty = num(row.pack_qty || 0);
    const packPrice = num(row.pack_price || 0);
    const copUnit = num(row.cop_per_unit || 0);

    const nNeed = num(need[k] ?? 0);
    const nStock = num(stock[k] ?? 0);
    const nBuyNeed = Math.max(0, nNeed - nStock);

    const s = sel[k] || { buy:false, mult:1, updateCost:false };
    const mult = num(s.mult || 1);

    // Cantidad que entra a inventario si compro 1 empaque:
    const addQty = packQty * (mult || 1);

    const store = row.store || "—";
    const brand = row.brand || "—";

    const priceTxt = copUnit>0 ? `$${fmtCOP(copUnit)}/u` : "—";

    return `
      <div class="buyItem" data-k="${cssEscape(k)}">
        <label class="buyChk">
          <input type="checkbox" class="buyMark" ${s.buy ? "checked":""}/>
          <span class="buyMarkTxt">${s.buy ? "Comprado" : "No comprado"}</span>
        </label>

        <div class="buyMeta">
          <div class="buyItemName">${k}</div>
          <div class="buyItemSub">${unit} · ${priceTxt} · ${brand} · ${store}</div>
          <div class="buyItemNeed">Necesario hoy: <b>${fmt(nNeed)}</b> · Sobrante: <b>${fmt(nStock)}</b> · Falta: <b>${fmt(nBuyNeed)}</b></div>
        </div>

        <div class="buyControls">
          <div class="buyCtrl">
            <div class="muted small">Empaques</div>
            <input class="buyNum buyMult" inputmode="decimal" value="${fmt(mult)}"/>
          </div>
          <div class="buyCtrl">
            <div class="muted small">+ Inventario</div>
            <div class="buyAddQty">${fmt(addQty)} ${unit}</div>
          </div>
          <button class="btn small buyEdit" type="button">Editar costo</button>
          <label class="buySmallChk">
            <input type="checkbox" class="buyUpdateCost" ${s.updateCost ? "checked":""}/>
            Actualizar precio al guardar
          </label>
        </div>
      </div>
    `;
  }).join("");

  // Bloque informativo después de 3pm (si backend lo envía)
  let lateHtml = "";
  const late = ctx && ctx.late ? ctx.late : null;
  if(late && late.byDessert){
    const items = Object.entries(late.byDessert).map(([name, qty])=>`<li><b>${name}</b>: ${qty}</li>`).join("");
    const total = late.totalQty ?? Object.values(late.byDessert).reduce((a,b)=>a+num(b),0);
    lateHtml = `
      <div class="lateBox">
        <div class="lateTitle">Informativo: pedidos después de las 3:00 p.m.</div>
        <ul class="lateList">${items || "<li class=\"muted\">Sin pedidos después de 3pm.</li>"}</ul>
        <div class="lateTotal">Total general: <b>${total}</b> postres</div>
      </div>
    `;
  }

  panel.innerHTML = `
    <div class="buyPanelHead">
      <div>
        <div class="buyPanelTitle">Registrar compras (por ingrediente)</div>
        <div class="muted small">Marca lo que compraste, ajusta empaques y guarda todo en base de datos. (Si no hay backend, quedará local.)</div>
      </div>
      <button id="buySaveBatch" class="btn gold" type="button">Guardar compras en inventario</button>
    </div>
    ${lateHtml}
    <div class="buyPanelList">${rows}</div>
  `;

  // Eventos
  panel.querySelectorAll(".buyItem").forEach(el=>{
    const key = unescapeCss(el.getAttribute("data-k")||"");
    const mark = el.querySelector(".buyMark");
    const multEl = el.querySelector(".buyMult");
    const updEl = el.querySelector(".buyUpdateCost");
    const editBtn = el.querySelector(".buyEdit");

    function saveLocal(){
      const cur = sel[key] || { buy:false, mult:1, updateCost:false };
      cur.buy = !!mark.checked;
      cur.mult = num(multEl.value || 1) || 1;
      cur.updateCost = !!updEl.checked;
      sel[key] = cur;
      setPurchaseSelect_(sel);

      // update label and addQty display
      const row = findCostRow(key) || {};
      const unit = normUnit(row.unit_type || "") || "unidad";
      const packQty = num(row.pack_qty || 0);
      el.querySelector(".buyMarkTxt").textContent = cur.buy ? "Comprado" : "No comprado";
      el.querySelector(".buyAddQty").textContent = `${fmt(packQty*cur.mult)} ${unit}`;
    }

    mark.addEventListener("change", saveLocal);
    multEl.addEventListener("input", saveLocal);
    updEl.addEventListener("change", saveLocal);

    editBtn.addEventListener("click", ()=>{
      // Llevar al ingrediente en tabla de costos (si existe)
      const rowEl = document.querySelector(`[data-ik="${cssEscape(key)}"]`);
      if(rowEl){
        try{ rowEl.scrollIntoView({behavior:"smooth", block:"center"});}catch(_e){}
        rowEl.classList.add("flash");
        setTimeout(()=>rowEl.classList.remove("flash"), 900);
      }else{
        // fallback: abrir acordeón correspondiente
        showToast("Busca el ingrediente en la tabla y edítalo, luego guarda.", "ok");
      }
    });
  });

  const btn = document.getElementById("buySaveBatch");
  if(btn && !btn.__amaredBound){
    btn.__amaredBound = true;
    btn.addEventListener("click", ()=> savePurchasesBatch_());
  }
}

async function savePurchasesBatch_(){
  if(!UNLOCKED_SECRET){
    showToast("Primero desbloquea Costos con tu clave.", "err");
    return;
  }
  const sel = getPurchaseSelect_();
  const keys = Object.keys(sel).filter(k=>sel[k] && sel[k].buy);
  if(keys.length === 0){
    showToast("No marcaste compras. Selecciona ingredientes comprados.", "err");
    return;
  }

  // Construir items
  const items = keys.map(k=>{
    const row = findCostRow(k) || {};
    const unit = normUnit(row.unit_type || "") || "unidad";
    const packQty = num(row.pack_qty || 0);
    const mult = num(sel[k].mult || 1) || 1;
    const qty = packQty * mult;
    return {
      ingredient_key: k,
      qty,
      unit,
      cop_per_unit: num(row.cop_per_unit || 0),
      pack_price: num(row.pack_price || 0),
      brand: row.brand || "",
      store: row.store || "",
      updateCost: !!sel[k].updateCost,
      costRow: row
    };
  });

  showLoading("Guardando compras…", "Actualizando inventario y registrando movimientos.");
  try{
    // Intento batch en backend
    let out = null
    try{
      out = await api({ action:"inventory_add_purchase_batch", costs_secret: UNLOCKED_SECRET, items: items.map(i=>({ ingredient_key:i.ingredient_key, qty:i.qty, unit:i.unit, cop_per_unit:i.cop_per_unit, pack_price:i.pack_price, brand:i.brand, store:i.store })) });
    }catch(e){
      console.warn("Batch no disponible, intento individual:", e);
    }

    // Fallback: individual
    if(!out || out.ok === false){
      for(const it of items){
        await api({ action:"inventory_add_purchase", costs_secret: UNLOCKED_SECRET, ingredient_key: it.ingredient_key, qty: it.qty, unit: it.unit, source:"COSTS_UI_BATCH" });
      }
    }

    // Actualizar costos si el usuario lo pidió (reutiliza upsert existente)
    for(const it of items){
      if(it.updateCost){
        await upsertCostToSheets(it.costRow);
      }
    }

    // Refrescar inventario desde BD
    try{
      const inv = await api({ action:"inventory_get", costs_secret: UNLOCKED_SECRET });
      if(inv && inv.ok && inv.inventory){
        lsWriteObj(STOCK_LS_KEY, inv.inventory);
      }
    }catch(e){}

    // limpiar marcas compradas (las dejamos desmarcadas para siguiente compra)
    const next = getPurchaseSelect_();
    for(const k of keys){
      if(next[k]) next[k].buy = false;
    }
    setPurchaseSelect_(next);

    hideLoading();
    showToast("Compras guardadas en inventario", "ok");
    renderPurchases();
  }catch(e){
    hideLoading();
    console.error(e);
    showToast(e && e.message ? e.message : "No se pudo guardar compras", "err");
  }
}
