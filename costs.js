const API_URL = "https://amared-orders.amaredpostres.workers.dev/";
const LS_COSTS_KEY = "AMARED_INGREDIENT_PRICES_LOCAL";
const LS_COSTS_META_KEY = "AMARED_INGREDIENT_COSTS_META";
const LS_CATALOG_KEY = "AMARED_COSTS_CATALOG_LOCAL";

let UNLOCKED_SECRET = ""; // solo memoria

// Defaults (se mezclan con lo que exista en Sheets/localStorage)
const DEFAULT_STORES = ["Salsamentaria Sinai","Mercacentro","Plaza"];
const DEFAULT_BRANDS = ["Cowie","Mercacentro","Alpina","San Jorge","Levapan","Refisal","Ramo","Colanta","Colombina","Tostao"];

let STORES = [...DEFAULT_STORES];
let BRANDS = [...DEFAULT_BRANDS];

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

function loadCatalogLocal(){
  const raw = localStorage.getItem(LS_CATALOG_KEY);
  const c = raw ? safeJsonParse(raw) : null;
  if(c && typeof c==="object"){
    const s = Array.isArray(c.stores) ? c.stores : [];
    const b = Array.isArray(c.brands) ? c.brands : [];
    return { stores:s, brands:b };
  }
  return { stores:[], brands:[] };
}
function saveCatalogLocal(stores, brands){
  localStorage.setItem(LS_CATALOG_KEY, JSON.stringify({ stores, brands }));
}

function money(n){ return Math.round(Number(n||0)).toLocaleString("es-CO"); }
function roundCOP(n){ return Math.max(0, Math.round(Number(n||0))); }

function cssEscape(s){ return String(s).replace(/"/g,'\\\"'); }
function unescapeCss(s){ return String(s).replace(/\\"/g,'"'); }

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

// ===== Catálogos: intenta Sheets, si no existe -> localStorage =====
async function fetchCatalogs(){
  // 1) Local base (defaults + local)
  const local = loadCatalogLocal();
  STORES = uniqSorted([...DEFAULT_STORES, ...local.stores]);
  BRANDS = uniqSorted([...DEFAULT_BRANDS, ...local.brands]);

  // 2) Intento backend (si está implementado)
  try{
    const out = await api({ action:"catalog_list", costs_secret: UNLOCKED_SECRET });
    if(out && out.catalog){
      if(Array.isArray(out.catalog.stores)) STORES = uniqSorted([...DEFAULT_STORES, ...out.catalog.stores]);
      if(Array.isArray(out.catalog.brands)) BRANDS = uniqSorted([...DEFAULT_BRANDS, ...out.catalog.brands]);
      // sincroniza copia local para que no se pierda
      saveCatalogLocal(STORES, BRANDS);
    }
  } catch {
    // si falla, nos quedamos con local
  }
}

function uniqSorted(arr){
  const uniq = Array.from(new Set((arr||[]).map(s=>String(s||"").trim()).filter(Boolean)));
  uniq.sort((a,b)=>a.localeCompare(b,"es"));
  return uniq;
}

async function catalogAdd(type, value){
  value = String(value||"").trim();
  if(!value) throw new Error("empty");

  // local first
  if(type==="store"){
    STORES = uniqSorted([...STORES, value]);
    saveCatalogLocal(STORES, BRANDS);
  } else {
    BRANDS = uniqSorted([...BRANDS, value]);
    saveCatalogLocal(STORES, BRANDS);
  }

  // try backend (si existe)
  try{
    await api({ action:"catalog_add", costs_secret: UNLOCKED_SECRET, type, value });
    await fetchCatalogs();
  } catch {
    // backend no existe -> igual funciona local
  }
}

async function catalogDelete(type, value){
  value = String(value||"").trim();
  if(!value) throw new Error("empty");

  // local first
  if(type==="store"){
    STORES = STORES.filter(x=>x!==value);
    saveCatalogLocal(STORES, BRANDS);
  } else {
    BRANDS = BRANDS.filter(x=>x!==value);
    saveCatalogLocal(STORES, BRANDS);
  }

  // try backend
  try{
    await api({ action:"catalog_delete", costs_secret: UNLOCKED_SECRET, type, value });
    await fetchCatalogs();
  } catch {
    // backend no existe -> igual funciona local
  }
}

// ===== Ingredientes (de grupos) =====
function getAllKeys(){
  const base = (window.AMARED_INGREDIENT_PRICES && typeof window.AMARED_INGREDIENT_PRICES==="object") ? window.AMARED_INGREDIENT_PRICES : {};
  return Array.from(new Set(Object.keys(base))).sort((a,b)=>a.localeCompare(b,"es"));
}
function getGroups(){
  const gs = Array.isArray(window.AMARED_INGREDIENT_GROUPS) ? window.AMARED_INGREDIENT_GROUPS : [];
  const all = new Set(getAllKeys());
  return gs.map(g => ({...g, keys: g.keys.filter(k => all.has(k))}));
}

// ===== Cálculo realtime =====
function calcCpu(unit, packPrice, packQty, unitItemQty, unitItemQtyType){
  if(packPrice<=0) return 0;

  if(unit === "unidad"){
    if(packQty<=0) return 0;
    const cpuUnit = packPrice / packQty; // COP por unidad

    const q = Number(unitItemQty||0);
    const t = normUnit(unitItemQtyType);
    if(q>0 && (t==="g" || t==="ml")){
      // COP por g/ml
      return cpuUnit / q;
    }
    return cpuUnit; // COP por unidad
  }

  if(packQty<=0) return 0;
  return packPrice / packQty; // COP por g o ml
}

function cpuDisplayLabel(unit, unitItemQtyType, unitItemQty){
  if(unit !== "unidad") return perUnitLabel(unit);
  const q = Number(unitItemQty||0);
  const t = normUnit(unitItemQtyType);
  if(q>0 && (t==="g" || t==="ml")) return `COP por ${t} (desde unidad)`;
  return "COP por unidad";
}

function makeSelectOptions(arr, selected){
  const uniq = uniqSorted(arr);
  return uniq.map(v=>`<option ${v===selected?"selected":""} value="${cssEscape(v)}">${v}</option>`).join("");
}

// ===== UI: Modal simple (reutilizable) =====
function ensureModal(){
  let m = document.getElementById("am_modal");
  if(m) return m;

  m = document.createElement("div");
  m.id = "am_modal";
  m.style.cssText = `
    position:fixed; inset:0; background:rgba(0,0,0,.55);
    display:none; align-items:center; justify-content:center;
    z-index:9999; padding:16px;
  `;
  m.innerHTML = `
    <div style="background:#111; border:1px solid rgba(255,255,255,.12); border-radius:14px; width:min(720px,100%); padding:14px;">
      <div class="row" style="justify-content:space-between; align-items:center; gap:10px;">
        <div>
          <div class="k" id="am_modal_title">Título</div>
          <div class="mini" id="am_modal_desc" style="margin-top:4px;">Descripción</div>
        </div>
        <button class="btn secondary" id="am_modal_close" type="button">Cerrar</button>
      </div>
      <div id="am_modal_body" style="margin-top:12px;"></div>
    </div>
  `;
  document.body.appendChild(m);
  m.querySelector("#am_modal_close").onclick = ()=>{ m.style.display="none"; };
  m.addEventListener("click",(e)=>{ if(e.target===m) m.style.display="none"; }, {passive:true});
  return m;
}

function openModal(title, desc, html){
  const m = ensureModal();
  m.querySelector("#am_modal_title").textContent = title || "";
  m.querySelector("#am_modal_desc").textContent = desc || "";
  m.querySelector("#am_modal_body").innerHTML = html || "";
  m.style.display = "flex";
  return m;
}

// Confirmación con temporizador 2s
function confirmWithTimer(title, desc){
  return new Promise((resolve)=>{
    let t = 2;
    const m = openModal(title, desc, `
      <div class="item">
        <div class="mini" style="opacity:.9;">Espera <strong id="am_t">${t}</strong> segundo(s) para confirmar.</div>
        <div class="row" style="margin-top:12px; gap:10px;">
          <button class="btn secondary" id="am_cancel" type="button">Cancelar</button>
          <button class="btn" id="am_ok" type="button" disabled>Confirmar</button>
        </div>
      </div>
    `);

    const okBtn = m.querySelector("#am_ok");
    const tEl = m.querySelector("#am_t");

    const int = setInterval(()=>{
      t -= 1;
      if(tEl) tEl.textContent = String(t);
      if(t<=0){
        clearInterval(int);
        okBtn.disabled = false;
        if(tEl) tEl.textContent = "0";
      }
    }, 1000);

    m.querySelector("#am_cancel").onclick = ()=>{
      clearInterval(int);
      m.style.display="none";
      resolve(false);
    };
    okBtn.onclick = ()=>{
      clearInterval(int);
      m.style.display="none";
      resolve(true);
    };
  });
}

// ===== UI: Catálogos en modal (no visible al inicio) =====
function openCatalogManager(){
  const html = `
    <div class="item">
      <div class="row" style="justify-content:space-between; align-items:center; gap:10px;">
        <div>
          <div class="k">Tiendas y Marcas</div>
          <div class="mini">Agrega o elimina opciones. (Con confirmación de 2s)</div>
        </div>
      </div>

      <div class="row" style="margin-top:12px; gap:14px; flex-wrap:wrap;">
        <div style="flex:1; min-width:280px;">
          <div class="mini" style="margin-bottom:6px;">Tiendas</div>
          <div class="row" style="gap:8px;">
            <select class="input" id="storePick">
              <option value="">Selecciona…</option>
              ${makeSelectOptions(STORES,"")}
            </select>
            <button class="btn secondary" id="delStore" type="button">Eliminar</button>
          </div>
          <div class="row" style="gap:8px; margin-top:8px;">
            <input class="input" id="storeNew" placeholder="Nueva tienda…">
            <button class="btn" id="addStore" type="button">Agregar</button>
          </div>
        </div>

        <div style="flex:1; min-width:280px;">
          <div class="mini" style="margin-bottom:6px;">Marcas</div>
          <div class="row" style="gap:8px;">
            <select class="input" id="brandPick">
              <option value="">Selecciona…</option>
              ${makeSelectOptions(BRANDS,"")}
            </select>
            <button class="btn secondary" id="delBrand" type="button">Eliminar</button>
          </div>
          <div class="row" style="gap:8px; margin-top:8px;">
            <input class="input" id="brandNew" placeholder="Nueva marca…">
            <button class="btn" id="addBrand" type="button">Agregar</button>
          </div>
        </div>
      </div>
    </div>
  `;

  const m = openModal("⚙️ Gestionar tiendas y marcas", "Este panel está separado para evitar cambios accidentales.", html);

  // Handlers
  m.querySelector("#addStore").onclick = async ()=>{
    const v = (m.querySelector("#storeNew").value||"").trim();
    if(!v) return alert("Escribe el nombre de la tienda.");
    const ok = await confirmWithTimer("Agregar tienda", `Se agregará: "${v}"`);
    if(!ok) return;
    showLoading("Guardando...", "Agregando tienda...");
    try{
      await catalogAdd("store", v);
      hideLoading();
      m.style.display = "none";
      render(); // refresca selects en ingredientes
    } finally { hideLoading(); }
  };

  m.querySelector("#addBrand").onclick = async ()=>{
    const v = (m.querySelector("#brandNew").value||"").trim();
    if(!v) return alert("Escribe el nombre de la marca.");
    const ok = await confirmWithTimer("Agregar marca", `Se agregará: "${v}"`);
    if(!ok) return;
    showLoading("Guardando...", "Agregando marca...");
    try{
      await catalogAdd("brand", v);
      hideLoading();
      m.style.display = "none";
      render();
    } finally { hideLoading(); }
  };

  m.querySelector("#delStore").onclick = async ()=>{
    const v = unescapeCss(m.querySelector("#storePick").value||"");
    if(!v) return alert("Selecciona una tienda para eliminar.");
    const ok = await confirmWithTimer("Eliminar tienda", `Se eliminará: "${v}"`);
    if(!ok) return;
    showLoading("Guardando...", "Eliminando tienda...");
    try{
      await catalogDelete("store", v);
      m.style.display = "none";
      render();
    } finally { hideLoading(); }
  };

  m.querySelector("#delBrand").onclick = async ()=>{
    const v = unescapeCss(m.querySelector("#brandPick").value||"");
    if(!v) return alert("Selecciona una marca para eliminar.");
    const ok = await confirmWithTimer("Eliminar marca", `Se eliminará: "${v}"`);
    if(!ok) return;
    showLoading("Guardando...", "Eliminando marca...");
    try{
      await catalogDelete("brand", v);
      m.style.display = "none";
      render();
    } finally { hideLoading(); }
  };
}

// ===== Render principal (acordeones cerrados + icono) =====
function render(){
  const list = document.getElementById("list");
  const prices = loadPrices();
  const meta = loadMeta();
  const groups = getGroups();

  // Barra superior con botón para catálogos
  const top = document.getElementById("topTools");
  if(top){
    top.innerHTML = `
      <div class="row" style="justify-content:space-between; align-items:center; gap:10px; margin-bottom:12px;">
        <div class="mini" style="opacity:.9;">Tip: las secciones están en acordeón. Haz clic para desplegar.</div>
        <button class="btn secondary" id="openCatalog" type="button">⚙️ Gestionar tiendas y marcas</button>
      </div>
    `;
    top.querySelector("#openCatalog").onclick = ()=> openCatalogManager();
  }

  list.innerHTML = groups.map(g=>{
    return `
      <details class="item">
        <summary class="row am_sum" style="cursor:pointer;justify-content:space-between; align-items:center;">
          <div class="row" style="gap:10px; align-items:center;">
            <span class="am_chev" aria-hidden="true">▶</span>
            <div class="k">${g.title}</div>
          </div>
          <div class="mini">${g.keys.length} ingrediente(s)</div>
        </summary>

        <div style="margin-top:10px;">
          ${g.keys.map(k=>{
            const m = meta[k] || { packPrice:"", packQty:"", unit:"", brand:"", store:"", unitItemQty:"", unitItemQtyType:"", updated_at:"" };
            const unit = normUnit(m.unit);
            const packPrice = Number(m.packPrice||0);
            const packQty = Number(m.packQty||0);
            const unitItemQty = Number(m.unitItemQty||0);
            const unitItemQtyType = normUnit(m.unitItemQtyType);

            const cpu = roundCOP(calcCpu(unit, packPrice, packQty, unitItemQty, unitItemQtyType));
            const cpuLbl = cpuDisplayLabel(unit, unitItemQtyType, unitItemQty);
            if(cpu>0) prices[k] = cpu;

            const qtyDisabled = !unit ? "disabled" : "";
            const showUnidad = (unit==="unidad") ? "" : "style=\\"display:none;\\"";
            const disableUnidad = (unit==="unidad") ? "" : "disabled";

            return `
              <div class="item" style="margin-top:12px;">
                <div class="row" style="justify-content:space-between;gap:10px;align-items:center;">
                  <div class="k">${k}</div>
                  <div class="pill"><span data-cpulbl="${cssEscape(k)}">${cpuLbl}</span>: <span data-out="${cssEscape(k)}">${money(cpu)}</span></div>
                </div>

                <div class="row" style="margin-top:10px;align-items:flex-end;gap:12px;flex-wrap:wrap;">
                  <div style="flex:1;min-width:220px;">
                    <div class="mini" style="margin-bottom:6px;">Precio del empaque (COP)</div>
                    <input class="input" data-packprice="${cssEscape(k)}" type="number" min="0" step="1"
                      value="${m.packPrice||""}" placeholder="Ej: 15000">
                  </div>

                  <div style="flex:1;min-width:170px;max-width:220px;">
                    <div class="mini" style="margin-bottom:6px;">Unidad</div>
                    <select class="input" data-unit="${cssEscape(k)}">
                      <option value="" ${!unit?"selected":""}>Selecciona…</option>
                      <option value="g" ${unit==="g"?"selected":""}>g</option>
                      <option value="ml" ${unit==="ml"?"selected":""}>ml</option>
                      <option value="unidad" ${unit==="unidad"?"selected":""}>unidad</option>
                    </select>
                  </div>

                  <div style="flex:1;min-width:220px;">
                    <div class="mini" style="margin-bottom:6px;" data-qtylabel="${cssEscape(k)}">${unitLabel(unit)}</div>
                    <input class="input" data-packqty="${cssEscape(k)}" type="number" min="0" step="0.01" ${qtyDisabled}
                      value="${m.packQty||""}" placeholder="${unitPlaceholder(unit)}">
                  </div>
                </div>

                <div class="row" data-unidadwrap="${cssEscape(k)}" ${showUnidad} style="margin-top:10px;gap:12px;flex-wrap:wrap;">
                  <div style="flex:1;min-width:240px;">
                    <div class="mini" style="margin-bottom:6px;">Contenido por unidad (opcional)</div>
                    <input class="input" data-unititemqty="${cssEscape(k)}" type="number" min="0" step="0.01" ${disableUnidad}
                      value="${m.unitItemQty||""}" placeholder="Ej: 200">
                  </div>
                  <div style="min-width:180px;max-width:220px;">
                    <div class="mini" style="margin-bottom:6px;">Medida del contenido</div>
                    <select class="input" data-unititemtype="${cssEscape(k)}" ${disableUnidad}>
                      <option value="" ${!unitItemQtyType?"selected":""}>Selecciona…</option>
                      <option value="g" ${unitItemQtyType==="g"?"selected":""}>g</option>
                      <option value="ml" ${unitItemQtyType==="ml"?"selected":""}>ml</option>
                    </select>
                  </div>
                  <div class="mini" style="flex-basis:100%;opacity:.85;">
                    Si llenas esto, el sistema calcula <strong>COP por g/ml</strong> a partir de “unidad”.
                  </div>
                </div>

                <div class="row" style="margin-top:10px;gap:12px;flex-wrap:wrap;">
                  <div style="flex:1;min-width:240px;">
                    <div class="mini" style="margin-bottom:6px;">Tienda</div>
                    <select class="input" data-store="${cssEscape(k)}">
                      <option value="">Selecciona…</option>
                      ${makeSelectOptions(STORES, m.store || "")}
                    </select>
                  </div>
                  <div style="flex:1;min-width:240px;">
                    <div class="mini" style="margin-bottom:6px;">Marca</div>
                    <select class="input" data-brand="${cssEscape(k)}">
                      <option value="">Selecciona…</option>
                      ${makeSelectOptions(BRANDS, m.brand || "")}
                    </select>
                  </div>
                </div>

                <div class="mini" style="margin-top:8px;">
                  Última actualización: <span data-updated="${cssEscape(k)}">${m.updated_at ? String(m.updated_at) : "—"}</span>
                </div>
              </div>
            `;
          }).join("")}
        </div>
      </details>
    `;
  }).join("");

  savePrices(prices);

  // Flecha ▶ / ▼ según estado del details
  list.querySelectorAll("details").forEach(d=>{
    const chev = d.querySelector(".am_chev");
    const sync = ()=>{ if(chev) chev.textContent = d.open ? "▼" : "▶"; };
    sync();
    d.addEventListener("toggle", sync, { passive:true });
  });

  const recalcOne = (key)=>{
    const pricesNow = loadPrices();
    const metaNow = loadMeta();

    const packPrice = Number(list.querySelector(`[data-packprice="${cssEscape(key)}"]`)?.value||0);
    const unit = normUnit(list.querySelector(`[data-unit="${cssEscape(key)}"]`)?.value||"");
    const packQty = Number(list.querySelector(`[data-packqty="${cssEscape(key)}"]`)?.value||0);

    const unitItemQty = Number(list.querySelector(`[data-unititemqty="${cssEscape(key)}"]`)?.value||0);
    const unitItemQtyType = normUnit(list.querySelector(`[data-unititemtype="${cssEscape(key)}"]`)?.value||"");

    const store = unescapeCss(list.querySelector(`[data-store="${cssEscape(key)}"]`)?.value||"");
    const brand = unescapeCss(list.querySelector(`[data-brand="${cssEscape(key)}"]`)?.value||"");

    const cpu = roundCOP(calcCpu(unit, packPrice, packQty, unitItemQty, unitItemQtyType));
    const cpuLbl = cpuDisplayLabel(unit, unitItemQtyType, unitItemQty);

    const out = list.querySelector(`[data-out="${cssEscape(key)}"]`);
    if(out) out.textContent = money(cpu);
    const lbl = list.querySelector(`[data-cpulbl="${cssEscape(key)}"]`);
    if(lbl) lbl.textContent = cpuLbl;

    const qtyInput = list.querySelector(`[data-packqty="${cssEscape(key)}"]`);
    const qtyLabel = list.querySelector(`[data-qtylabel="${cssEscape(key)}"]`);
    if(qtyInput){
      qtyInput.disabled = !unit;
      qtyInput.placeholder = unitPlaceholder(unit);
    }
    if(qtyLabel) qtyLabel.textContent = unitLabel(unit);

    const wrap = list.querySelector(`[data-unidadwrap="${cssEscape(key)}"]`);
    if(wrap) wrap.style.display = (unit==="unidad") ? "" : "none";
    const uiq = list.querySelector(`[data-unititemqty="${cssEscape(key)}"]`);
    const uit = list.querySelector(`[data-unititemtype="${cssEscape(key)}"]`);
    if(uiq) uiq.disabled = (unit!=="unidad");
    if(uit) uit.disabled = (unit!=="unidad");

    if(cpu>0) pricesNow[key] = cpu;
    metaNow[key] = {
      ...(metaNow[key]||{}),
      packPrice: packPrice || "",
      packQty: packQty || "",
      unit,
      unitItemQty: unitItemQty || "",
      unitItemQtyType: unitItemQtyType || "",
      store,
      brand
    };
    savePrices(pricesNow);
    saveMeta(metaNow);
  };

  list.addEventListener("input", (e)=>{
    const el = e.target.closest("[data-packprice],[data-packqty],[data-unititemqty]");
    if(!el) return;
    const key = el.dataset.packprice || el.dataset.packqty || el.dataset.unititemqty;
    if(!key) return;
    recalcOne(unescapeCss(key));
  }, { passive:true });

  list.addEventListener("change", (e)=>{
    const el = e.target.closest("select[data-unit],select[data-store],select[data-brand],select[data-unititemtype]");
    if(!el) return;
    const key = el.dataset.unit || el.dataset.store || el.dataset.brand || el.dataset.unititemtype;
    if(!key) return;
    recalcOne(unescapeCss(key));
  }, { passive:true });

  document.getElementById("saveAll").onclick = async ()=>{
    try{
      showLoading("Guardando...", "Actualizando ingredientes en Google Sheets (COSTOS_INGREDIENTES).");

      const metaNow = loadMeta();
      const keysNow = getAllKeys();

      let saved = 0;
      for(const k of keysNow){
        const m = metaNow[k] || {};
        const unit = normUnit(m.unit);
        const packPrice = Number(m.packPrice||0);
        const packQty = Number(m.packQty||0);

        const unitItemQty = Number(m.unitItemQty||0);
        const unitItemQtyType = normUnit(m.unitItemQtyType);

        const cpu = roundCOP(calcCpu(unit, packPrice, packQty, unitItemQty, unitItemQtyType));

        if(!unit) continue;
        if(packPrice<=0 || packQty<=0) continue;

        await upsertCostToSheets({
          ingredient_key: k,
          unit_type: unit,
          pack_qty: packQty,
          pack_price: packPrice,
          cop_per_unit: cpu,
          unit_item_qty: (unit==="unidad" ? unitItemQty : ""),
          unit_item_qty_type: (unit==="unidad" ? unitItemQtyType : ""),
          brand: m.brand || "",
          store: m.store || "",
          updated_by: "COSTS_UI"
        });

        saved++;
      }

      alert(`Listo ✅ Guardados en Sheets: ${saved} ingrediente(s).`);
    } catch(e){
      alert("No se pudo guardar en Sheets. Revisa el Webhook (costs_upsert) y vuelve a intentar.");
    } finally {
      hideLoading();
    }
  };
}

// ===== Unlock =====
document.getElementById("unlock").addEventListener("click", async ()=>{
  const secret = (document.getElementById("secret").value||"").trim();
  const err = document.getElementById("err");
  err.textContent = "";

  try{
    showLoading("Verificando...", "Validando clave con el servidor.");
    await api({ action:"validate_secret", type:"costs", secret });
    UNLOCKED_SECRET = secret;

    showLoading("Cargando...", "Leyendo COSTOS_INGREDIENTES desde Google Sheets.");
    const fromSheets = await fetchCostsFromSheets();

    // carga catálogos (local + backend si existe)
    await fetchCatalogs();

    const prices = loadPrices();
    const meta = loadMeta();

    for(const it of fromSheets){
      const k = String(it.ingredient_key||"").trim();
      if(!k) continue;

      const unit = normUnit(it.unit_type);
      const packQty = Number(it.pack_qty||0);
      const packPrice = Number(it.pack_price||0);
      const cpu = roundCOP(it.cop_per_unit||0);

      if(cpu>0) prices[k] = cpu;

      meta[k] = {
        ...(meta[k]||{}),
        packPrice,
        packQty,
        unit,
        unitItemQty: Number(it.unit_item_qty||0) || "",
        unitItemQtyType: normUnit(it.unit_item_qty_type),
        brand: String(it.brand||""),
        store: String(it.store||""),
        updated_at: String(it.updated_at||"")
      };
    }

    savePrices(prices);
    saveMeta(meta);

    document.getElementById("editor").style.display = "block";
    render();

  } catch(e){
    err.textContent = "Clave inválida.";
  } finally {
    hideLoading();
  }
});
