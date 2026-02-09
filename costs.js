const API_URL = "https://amared-orders.amaredpostres.workers.dev/";
const LS_COSTS_KEY = "AMARED_INGREDIENT_PRICES_LOCAL";
const LS_COSTS_META_KEY = "AMARED_INGREDIENT_COSTS_META"; // para recordar empaque/cantidad

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

function getAllKeys(){
  // unión entre base y precios actuales
  const prices = loadPrices();
  return Object.keys(prices).sort((a,b)=>a.localeCompare(b,"es"));
}

function render(){
  const list = document.getElementById("list");
  const prices = loadPrices();
  const meta = loadMeta();
  const keys = getAllKeys();

  list.innerHTML = keys.map(k=>{
    const m = meta[k] || { packPrice:0, packQty:0, unit:"g" };
    const unitPrice = Number(prices[k]||0);

    return `
      <div class="item">
        <div class="row" style="justify-content:space-between;">
          <div class="k">${k}</div>
          <div class="pill">COP/unidad: <span data-out="${cssEscape(k)}">${money(unitPrice)}</span></div>
        </div>

        <div class="row" style="margin-top:10px;">
          <input class="input" data-packprice="${cssEscape(k)}" type="number" min="0" step="1" value="${Number(m.packPrice||0)}" placeholder="Precio empaque (COP)">
          <input class="input" data-packqty="${cssEscape(k)}" type="number" min="0" step="0.01" value="${Number(m.packQty||0)}" placeholder="Cantidad neta">
          <select class="input" data-unit="${cssEscape(k)}" style="max-width:160px;">
            ${["g","ml","unidad"].map(u=>`<option ${m.unit===u?"selected":""} value="${u}">${u}</option>`).join("")}
          </select>
          <button class="btn secondary" data-calc="${cssEscape(k)}" type="button">Calcular</button>
        </div>

        <div class="mini" style="margin-top:8px;">
          También puedes editar manualmente el COP/unidad en cocina, pero aquí queda más organizado para compras.
        </div>
      </div>
    `;
  }).join("");

  list.onclick = (e)=>{
    const btn = e.target.closest("button[data-calc]");
    if(!btn) return;
    const key = unescapeCss(btn.dataset.calc);

    const packPrice = Number(list.querySelector(`[data-packprice="${cssEscape(key)}"]`).value||0);
    const packQty = Number(list.querySelector(`[data-packqty="${cssEscape(key)}"]`).value||0);
    const unit = String(list.querySelector(`[data-unit="${cssEscape(key)}"]`).value||"g");

    if(packPrice<=0 || packQty<=0){
      alert("Ingresa precio del empaque y cantidad neta.");
      return;
    }

    const perUnit = packPrice / packQty;
    prices[key] = Math.max(0, Math.round(perUnit)); // redondeo a COP
    meta[key] = { packPrice, packQty, unit };

    savePrices(prices);
    saveMeta(meta);

    const out = list.querySelector(`[data-out="${cssEscape(key)}"]`);
    if(out) out.textContent = money(prices[key]);
  };

  document.getElementById("saveAll").onclick = ()=>{
    alert("Listo ✅ Ya quedó guardado en este navegador (localStorage).");
  };
}

// helpers para dataset keys
function cssEscape(s){ return String(s).replace(/"/g,'\\"'); }
function unescapeCss(s){ return String(s).replace(/\\"/g,'"'); }

// Unlock seguro con worker
document.getElementById("unlock").addEventListener("click", async ()=>{
  const secret = (document.getElementById("secret").value||"").trim();
  const err = document.getElementById("err");
  err.textContent = "";

  try{
    showLoading("Verificando...", "Validando clave con el servidor.");
    await api({ action:"validate_secret", type:"costs", secret });
    document.getElementById("editor").style.display = "block";
    render();
  } catch(e){
    err.textContent = "Clave inválida.";
  } finally {
    hideLoading();
  }
});
