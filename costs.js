const API_URL = "https://amared-orders.amaredpostres.workers.dev/";
const LS_COSTS_KEY = "AMARED_INGREDIENT_PRICES_LOCAL";
const LS_COSTS_META_KEY = "AMARED_INGREDIENT_COSTS_META"; // pack y unidad

let UNLOCKED_SECRET = ""; // se guarda solo en memoria (no localStorage)

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

function cssEscape(s){ return String(s).replace(/"/g,'\\"'); }
function unescapeCss(s){ return String(s).replace(/\\"/g,'"'); }

function normUnit(u){
  const s = String(u||"").trim().toLowerCase();
  if(s==="g") return "g";
  if(s==="ml") return "ml";
  if(s==="unidad"||s==="u") return "unidad";
  return "g";
}

function getAllKeys(){
  const prices = loadPrices();
  return Object.keys(prices).sort((a,b)=>a.localeCompare(b,"es"));
}

// ---- NUEVO: cargar desde Sheets (best = máximo por ingrediente) ----
async function fetchCostsFromSheets(){
  // ⚠️ IMPORTANTE: esto requiere que el Worker reenvíe estas acciones al Apps Script.
  // (te dejo el mini-parche del Worker debajo).
  const out = await api({ action:"costs_list", costs_secret: UNLOCKED_SECRET });
  // out.items trae array de registros best
  return out.items || [];
}

// ---- NUEVO: guardar 1 ingrediente en Sheets ----
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
    updated_by: row.updated_by || "ADMIN"
  };
  const out = await api(payload);
  return out;
}

function render(){
  const list = document.getElementById("list");
  const prices = loadPrices();
  const meta = loadMeta();
  const keys = getAllKeys();

  list.innerHTML = keys.map(k=>{
    const m = meta[k] || { packPrice:0, packQty:0, unit:"g", brand:"", store:"" };
    const unitPrice = Number(prices[k]||0);

    return `
      <div class="item">
        <div class="row" style="justify-content:space-between;">
          <div class="k">${k}</div>
          <div class="pill">COP/unidad: <span data-out="${cssEscape(k)}">${money(unitPrice)}</span></div>
        </div>

        <div class="row" style="margin-top:10px;">
          <input class="input" data-packprice="${cssEscape(k)}" type="number" min="0" step="1"
            value="${Number(m.packPrice||0)}" placeholder="Precio empaque (COP)">

          <input class="input" data-packqty="${cssEscape(k)}" type="number" min="0" step="0.01"
            value="${Number(m.packQty||0)}" placeholder="Cantidad neta (según unidad)">

          <select class="input" data-unit="${cssEscape(k)}" style="max-width:160px;">
            ${["g","ml","unidad"].map(u=>`<option ${normUnit(m.unit)===u?"selected":""} value="${u}">${u}</option>`).join("")}
          </select>

          <button class="btn secondary" data-calc="${cssEscape(k)}" type="button">Calcular</button>
        </div>

        <div class="row" style="margin-top:10px;">
          <input class="input" data-brand="${cssEscape(k)}" value="${String(m.brand||"")}" placeholder="Marca (opcional)">
          <input class="input" data-store="${cssEscape(k)}" value="${String(m.store||"")}" placeholder="Tienda (opcional)">
        </div>

        <div class="mini" style="margin-top:8px;">
          Consejo: coloca la cantidad neta real del empaque (ej: 1000 g, 200 ml, 12 unidades) para un COP/unidad realista.
        </div>
      </div>
    `;
  }).join("");

  // Calcular por ítem
  list.onclick = (e)=>{
    const btn = e.target.closest("button[data-calc]");
    if(!btn) return;
    const key = unescapeCss(btn.dataset.calc);

    const packPrice = Number(list.querySelector(`[data-packprice="${cssEscape(key)}"]`).value||0);
    const packQty   = Number(list.querySelector(`[data-packqty="${cssEscape(key)}"]`).value||0);
    const unit      = normUnit(list.querySelector(`[data-unit="${cssEscape(key)}"]`).value||"g");

    const brand     = String(list.querySelector(`[data-brand="${cssEscape(key)}"]`).value||"").trim();
    const store     = String(list.querySelector(`[data-store="${cssEscape(key)}"]`).value||"").trim();

    if(packPrice<=0 || packQty<=0){
      alert("Ingresa precio del empaque y cantidad neta para calcular.");
      return;
    }

    const perUnit = packPrice / packQty;
    prices[key] = roundCOP(perUnit); // COP por unidad
    meta[key] = { packPrice, packQty, unit, brand, store };

    savePrices(prices);
    saveMeta(meta);

    const out = list.querySelector(`[data-out="${cssEscape(key)}"]`);
    if(out) out.textContent = money(prices[key]);
  };

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
        const packPrice = Number(m.packPrice||0);
        const packQty = Number(m.packQty||0);
        const unit = normUnit(m.unit||"g");
        const cpu = roundCOP(pricesNow[k]||0);

        // Solo guardamos si hay datos suficientes (o cpu manual > 0)
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
      alert("No se pudo guardar en Sheets. Verifica el Worker (acciones costs_*) y vuelve a intentar.");
    } finally {
      hideLoading();
    }
  };
}

// Unlock seguro con worker
document.getElementById("unlock").addEventListener("click", async ()=>{
  const secret = (document.getElementById("secret").value||"").trim();
  const err = document.getElementById("err");
  err.textContent = "";

  try{
    showLoading("Verificando...", "Validando clave con el servidor.");
    await api({ action:"validate_secret", type:"costs", secret });

    // Guardamos el secret SOLO en memoria
    UNLOCKED_SECRET = secret;

    // 1) intenta cargar desde Sheets
    let fromSheets = [];
    try{
      showLoading("Cargando...", "Leyendo COSTOS_INGREDIENTES desde Google Sheets.");
      fromSheets = await fetchCostsFromSheets();
    } catch {
      fromSheets = [];
    }

    // 2) merge -> Sheet (best) + base local
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
        packPrice: packPrice,
        packQty: packQty,
        unit: unit,
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
