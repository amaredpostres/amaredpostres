const API_URL = "https://amared-orders.amaredpostres.workers.dev/";

let UNLOCKED_SECRET = "";
let STORES = [];
let BRANDS = [];

let CANON = [];
let GROUPS = [];
let UI = {};
let SHEETS_ROWS = [];

// ===== Helpers =====
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
  const cat = out.catalog || out;
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
    }catch(e){ alert(e.message||"Error"); }
    finally{ hideLoading(); }
  };

  document.getElementById("catalogBtn").onclick = async ()=>{
    try{ await openCatalogManager(); }catch(e){ alert(e.message||"Error"); }
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
        <input class="input" data-k="${cssEscape(key)}" data-f="cop_per_unit" placeholder="Auto" value="${r.cop_per_unit||""}" readonly disabled>
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
