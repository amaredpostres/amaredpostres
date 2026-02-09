const API_URL = "https://amared-orders.amaredpostres.workers.dev/";
const LS_COSTS_KEY = "AMARED_INGREDIENT_PRICES_LOCAL";
const LS_COSTS_META_KEY = "AMARED_INGREDIENT_COSTS_META";

let UNLOCKED_SECRET = ""; // solo memoria

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
  if(u==="unidad") return "Cantidad de unidades (del empaque)";
  return "Cantidad del empaque";
}

function unitPlaceholder(u){
  if(u==="g") return "Ej: 1000";
  if(u==="ml") return "Ej: 200";
  if(u==="unidad") return "Ej: 6";
  return "Selecciona unidad primero";
}

// ===== Sheets =====
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
    updated_by: row.updated_by || "COSTS_UI"
  };
  return await api(payload);
}

function getAllKeys(){
  const prices = loadPrices();
  return Array.from(new Set(Object.keys(prices))).sort((a,b)=>a.localeCompare(b,"es"));
}

function render(){
  const list = document.getElementById("list");
  const prices = loadPrices();
  const meta = loadMeta();
  const keys = getAllKeys();

  list.innerHTML = keys.map(k=>{
    const m = meta[k] || { packPrice:0, packQty:0, unit:"", brand:"", store:"" };
    const unit = normUnit(m.unit);
    const unitPrice = Number(prices[k]||0);

    const qtyDisabled = !unit ? "disabled" : "";
    const qtyPH = unitPlaceholder(unit);

    return `
      <div class="item">
        <div class="row" style="justify-content:space-between;gap:10px;">
          <div class="k">${k}</div>
          <div class="pill">COP por unidad: <span data-out="${cssEscape(k)}">${money(unitPrice)}</span></div>
        </div>

        <div class="mini" style="margin-top:8px;opacity:.85;">
          1) Escribe <strong>Precio</strong> y elige <strong>Unidad</strong>. 2) Se habilita <strong>Cantidad</strong>. 3) Presiona <strong>Calcular</strong>.
        </div>

        <div class="row" style="margin-top:10px;align-items:flex-end;">
          <div style="flex:1;min-width:220px;">
            <div class="mini" style="margin-bottom:6px;">Precio del empaque (COP)</div>
            <input class="input" data-packprice="${cssEscape(k)}" type="number" min="0" step="1"
              value="${Number(m.packPrice||0)}" placeholder="Ej: 15000">
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
              value="${Number(m.packQty||0)}" placeholder="${qtyPH}">
          </div>

          <button class="btn secondary" data-calc="${cssEscape(k)}" type="button">Calcular</button>
        </div>

        <div class="row" style="margin-top:10px;">
          <input class="input" data-brand="${cssEscape(k)}" value="${String(m.brand||"")}" placeholder="Marca (opcional)">
          <input class="input" data-store="${cssEscape(k)}" value="${String(m.store||"")}" placeholder="Tienda (opcional)">
        </div>

        <div class="mini" style="margin-top:8px;">
          El sistema calcula: <strong>COP por unidad = Precio del empaque / Cantidad del empaque</strong>.
        </div>
      </div>
    `;
  }).join("");

  // Click en Calcular
  list.addEventListener("click", (e)=>{
    const btn = e.target.closest("button[data-calc]");
    if(!btn) return;
    const key = unescapeCss(btn.dataset.calc);

    const packPrice = Number(list.querySelector(`[data-packprice="${cssEscape(key)}"]`).value||0);
    const unit = normUnit(list.querySelector(`[data-unit="${cssEscape(key)}"]`).value||"");
    const packQty = Number(list.querySelector(`[data-packqty="${cssEscape(key)}"]`).value||0);

    const brand = String(list.querySelector(`[data-brand="${cssEscape(key)}"]`).value||"").trim();
    const store = String(list.querySelector(`[data-store="${cssEscape(key)}"]`).value||"").trim();

    if(packPrice<=0){ alert("Ingresa el precio del empaque."); return; }
    if(!unit){ alert("Selecciona la unidad (g, ml o unidad)."); return; }
    if(packQty<=0){ alert("Ingresa la cantidad del empaque."); return; }

    const perUnit = packPrice / packQty;
    const cpu = roundCOP(perUnit);

    const prices = loadPrices();
    const meta = loadMeta();

    prices[key] = cpu;
    meta[key] = { packPrice, packQty, unit, brand, store };

    savePrices(prices);
    saveMeta(meta);

    const out = list.querySelector(`[data-out="${cssEscape(key)}"]`);
    if(out) out.textContent = money(cpu);

    alert(`✅ Listo: ${key}\nCOP por ${unit}: ${money(cpu)}`);
  }, { passive:true });

  // Cambio unidad -> habilita cantidad + cambia label/placeholder
  list.addEventListener("change", (e)=>{
    const sel = e.target.closest("select[data-unit]");
    if(!sel) return;

    const key = unescapeCss(sel.dataset.unit);
    const unit = normUnit(sel.value);

    const qtyInput = list.querySelector(`[data-packqty="${cssEscape(key)}"]`);
    const qtyLabel = list.querySelector(`[data-qtylabel="${cssEscape(key)}"]`);

    if(qtyLabel) qtyLabel.textContent = unitLabel(unit);
    if(qtyInput){
      qtyInput.disabled = !unit;
      qtyInput.placeholder = unitPlaceholder(unit);
      if(!unit) qtyInput.value = "";
    }

    const meta = loadMeta();
    meta[key] = { ...(meta[key]||{}), unit };
    saveMeta(meta);
  }, { passive:true });

  // Guardar todo a Sheets
  document.getElementById("saveAll").onclick = async ()=>{
    try{
      showLoading("Guardando...", "Actualizando ingredientes en Google Sheets (COSTOS_INGREDIENTES).");

      const pricesNow = loadPrices();
      const metaNow = loadMeta();
      const keysNow = getAllKeys();

      let saved = 0;
      for(const k of keysNow){
        const m = metaNow[k] || {};
        const unit = normUnit(m.unit);
        const packPrice = Number(m.packPrice||0);
        const packQty = Number(m.packQty||0);
        const cpu = roundCOP(pricesNow[k]||0);

        if(!unit) continue;

        if((packPrice>0 && packQty>0) || cpu>0){
          await upsertCostToSheets({
            ingredient_key: k,
            unit_type: unit,
            pack_qty: packQty,
            pack_price: packPrice,
            cop_per_unit: cpu,
            brand: m.brand || "",
            store: m.store || "",
            updated_by: "COSTS_UI"
          });
          saved++;
        }
      }

      alert(`Listo ✅ Guardados en Sheets: ${saved} ingrediente(s).`);
    } catch(e){
      alert("No se pudo guardar en Sheets. Revisa Worker + Apps Script y vuelve a intentar.");
    } finally {
      hideLoading();
    }
  };
}

// Unlock seguro con worker + carga desde Sheets
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
        brand: String(it.brand||""),
        store: String(it.store||"")
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
