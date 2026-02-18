// AMARED · Purchases (Compras + Inventario)
// Requiere Cloudflare Worker (API_URL) con acciones:
// - costs_list (para catálogo de unidades/costos)
// - costs_orders_for_purchases (necesidades desde PEDIDOS + RECETAS)
// - inventory_get (mapa actual)
// - inventory_add_purchase_batch (sumar compras al inventario)

const API_URL = "https://amared-orders.amaredpostres.workers.dev/";
const LS_SECRET_KEY = "amared_costs_secret_v1";

let UNLOCKED_SECRET = "";
let COSTS = [];          // filas de COSTOS_INGREDIENTES
let NEEDS = {};          // {ingredient_key: qty}
let INVENTORY = {};      // {ingredient_key: {qty, unit}}
let UI_ROWS = [];        // render state

// ---------- Helpers ----------
async function api(payload, timeoutMs = 15000){
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try{
    const res = await fetch(API_URL, {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal
    });

    let out;
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if(ct.includes("application/json")){
      out = await res.json();
    } else {
      const text = await res.text().catch(()=> "");
      try{ out = JSON.parse(text); }catch(_e){ out = { ok:false, error: text || ("HTTP "+res.status) }; }
    }

    if(out && out.ok === false) throw new Error(out.error || ("HTTP "+res.status));
    if(!res.ok) throw new Error(out?.error || ("HTTP "+res.status));
    return out;
  } catch(e){
    if(e && e.name === "AbortError"){
      throw new Error("Tiempo de espera agotado (API). Revisa el Worker o tu conexión.");
    }
    if(String(e).includes("Failed to fetch")){
      throw new Error("No se pudo conectar al Worker (CORS / red). Verifica ALLOWED_ORIGIN y que el Worker esté activo.");
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}
function num(x){ const n = Number(x); return isFinite(n) ? n : 0; }
function fmt(n){ 
  const v = num(n);
  return (Math.round((v + Number.EPSILON)*1000)/1000).toString();
}
function fmtCOP(n){
  const v = Math.round(num(n));
  return v.toString().replace(/\B(?=(\d{3})+(?!\d))/g,".");
}
function esc(s){
  return String(s||"").replace(/[&<>\"']/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
}

function showLoading(title, sub){
  document.getElementById("loadingTitle").textContent = title || "Cargando…";
  document.getElementById("loadingSub").textContent = sub || "";
  document.getElementById("loadingBack").hidden = false;
}
function hideLoading(){ document.getElementById("loadingBack").hidden = true; }

function setMeta(text){
  document.getElementById("metaText").textContent = text || "";
}

function loadSecretFromLS(){
  try{ return localStorage.getItem(LS_SECRET_KEY) || ""; }catch(_e){ return ""; }
}
function saveSecretToLS(v){
  try{
    if(v) localStorage.setItem(LS_SECRET_KEY, v);
    else localStorage.removeItem(LS_SECRET_KEY);
  }catch(_e){}
}

function findCostRow(key){
  key = String(key||"").trim();
  if(!key) return null;
  return COSTS.find(r => String(r.ingredient_key||"").trim() === key) || null;
}

// ---------- Core flow ----------
async function loadAll(){
  if(!UNLOCKED_SECRET) throw new Error("Primero desbloquea Purchases con tu clave.");
  showLoading("Calculando…","Leyendo PEDIDOS + RECETAS + INVENTARIO…");
  try{
    // Snapshot unificado (backend hace el merge)
    const snap = await api({ action:"purchases_snapshot", costs_secret: UNLOCKED_SECRET }, 25000);

    const meta = snap.meta || {};
    setMeta(`Pedidos usados: ${meta.orders_used ?? "?"}/${meta.orders_total ?? "?"} · Ventana: ${meta.window_hours ?? 36}h`);

    // construir filas UI desde snap.rows
    const rows = Array.isArray(snap.rows) ? snap.rows : [];
    UI_ROWS = rows.map(r=>{
      const needed = num(r.needed);
      const invQty = num(r.inventory);
      const missing = Math.max(0, num(r.missing));
      const unit = String(r.unit || "unidad").trim() || "unidad";
      const cop = num(r.cop_per_unit || 0);
      return {
        ingredient_key: String(r.ingredient_key || ""),
        needed, invQty, missing,
        unit,
        cop_per_unit: cop,
        buyQty: missing > 0 ? missing : 0,
        include: missing > 0
      };
    });

    // orden (faltantes primero)
    UI_ROWS.sort((a,b)=>{
      const af = a.missing>0 ? 0 : 1;
      const bf = b.missing>0 ? 0 : 1;
      if(af!==bf) return af-bf;
      return a.ingredient_key.localeCompare(b.ingredient_key, "es");
    });

    render();
  } finally {
    hideLoading();
  }
}

function buildRows(){
  const keys = new Set();
  Object.keys(NEEDS||{}).forEach(k=>keys.add(k));
  Object.keys(INVENTORY||{}).forEach(k=>keys.add(k));
  COSTS.forEach(r=>{ if(r && r.ingredient_key) keys.add(String(r.ingredient_key)); });

  const arr = Array.from(keys).map(k=>{
    const cost = findCostRow(k) || {};
    const needed = num(NEEDS[k] ?? 0);
    const invQty = num((INVENTORY[k] && INVENTORY[k].qty) ?? 0);
    const missing = Math.max(0, needed - invQty);
    const unit = String((INVENTORY[k] && INVENTORY[k].unit) || cost.unit_type || "unidad").trim() || "unidad";
    const cop = num(cost.cop_per_unit || 0);
    return {
      ingredient_key: String(k),
      needed, invQty, missing,
      unit,
      cop_per_unit: cop,
      buyQty: missing > 0 ? missing : 0,
      include: missing > 0
    };
  });

  // orden: primero faltantes, luego alfabético
  arr.sort((a,b)=>{
    const af = a.missing>0 ? 0 : 1;
    const bf = b.missing>0 ? 0 : 1;
    if(af!==bf) return af-bf;
    return a.ingredient_key.localeCompare(b.ingredient_key, "es");
  });

  UI_ROWS = arr;
}

function render(){
  const tb = document.getElementById("rows");
  if(!tb) return;

  tb.innerHTML = UI_ROWS.map((r, idx)=>{
    const missClass = r.missing>0 ? "style='color:#fbbf24;font-weight:700'" : "style='color:#9ca3af'";
    return `
      <tr data-i="${idx}">
        <td>${esc(r.ingredient_key)}</td>
        <td class="num">${fmt(r.needed)}</td>
        <td class="num">${fmt(r.invQty)}</td>
        <td class="num" ${missClass}>${fmt(r.missing)}</td>
        <td>${esc(r.unit)}</td>
        <td class="num">${r.cop_per_unit>0 ? fmtCOP(r.cop_per_unit) : "—"}</td>
        <td class="num"><input class="inpNum" inputmode="decimal" value="${fmt(r.buyQty)}" /></td>
        <td class="num"><input class="chk" type="checkbox" ${r.include ? "checked":""} /></td>
      </tr>
    `;
  }).join("");

  // bind
  tb.querySelectorAll("tr").forEach(tr=>{
    const idx = Number(tr.getAttribute("data-i"));
    const inp = tr.querySelector("input.inpNum");
    const chk = tr.querySelector("input.chk");
    if(inp){
      inp.addEventListener("input", ()=>{
        const v = num(inp.value);
        UI_ROWS[idx].buyQty = v;
        if(v>0) UI_ROWS[idx].include = true;
      });
    }
    if(chk){
      chk.addEventListener("change", ()=>{
        UI_ROWS[idx].include = chk.checked;
      });
    }
  });

  document.getElementById("btnReload").disabled = !UNLOCKED_SECRET;
  document.getElementById("btnRegister").disabled = !UNLOCKED_SECRET;
}

// ---------- Register purchases ----------
async function registerPurchases(){
  if(!UNLOCKED_SECRET) return;

  const items = UI_ROWS
    .filter(r => r.include && num(r.buyQty) > 0)
    .map(r => ({
      ingredient_key: r.ingredient_key,
      qty: num(r.buyQty),
      unit: r.unit,
      cop_per_unit: num(r.cop_per_unit || 0),
      source: "PURCHASES_UI"
    }));

  if(items.length === 0){
    alert("No hay compras para registrar.");
    return;
  }

  showLoading("Registrando compras…", "Actualizando inventario…");
  try{
    const snap = await api({ action:"purchases_register_batch", costs_secret: UNLOCKED_SECRET, items }, 25000);
    const meta = snap.meta || {};
    setMeta(`Pedidos usados: ${meta.orders_used ?? "?"}/${meta.orders_total ?? "?"} · Ventana: ${meta.window_hours ?? 36}h`);

    const rows = Array.isArray(snap.rows) ? snap.rows : [];
    UI_ROWS = rows.map(r=>{
      const needed = num(r.needed);
      const invQty = num(r.inventory);
      const missing = Math.max(0, num(r.missing));
      const unit = String(r.unit || "unidad").trim() || "unidad";
      const cop = num(r.cop_per_unit || 0);
      return {
        ingredient_key: String(r.ingredient_key || ""),
        needed, invQty, missing,
        unit,
        cop_per_unit: cop,
        buyQty: missing > 0 ? missing : 0,
        include: missing > 0
      };
    });

    UI_ROWS.sort((a,b)=>{
      const af = a.missing>0 ? 0 : 1;
      const bf = b.missing>0 ? 0 : 1;
      if(af!==bf) return af-bf;
      return a.ingredient_key.localeCompare(b.ingredient_key, "es");
    });

    render();
    alert("Listo: compras registradas en INVENTARIO.");
  } catch(e){
    alert(e.message || "No se pudo registrar");
  } finally {
    hideLoading();
  }
}


// ---------- Unlock modal ----------

// ---------- Unlock modal ----------
function openUnlock(){
  document.getElementById("unlockMsg").textContent = "";
  document.getElementById("secretInput").value = UNLOCKED_SECRET || loadSecretFromLS() || "";
  document.getElementById("unlockBack").hidden = false;
}
function closeUnlock(){
  document.getElementById("unlockBack").hidden = true;
}

async function doUnlock(){
  const s = String(document.getElementById("secretInput").value || "").trim();
  if(!s){
    document.getElementById("unlockMsg").textContent = "Ingresa la clave.";
    return;
  }
  // Validación ligera: intentar una llamada que requiera secret
  showLoading("Validando…","Comprobando acceso…");
  try{
    await api({ action:"purchases_snapshot", costs_secret: s }, 25000);
    UNLOCKED_SECRET = s;
    saveSecretToLS(s);
    closeUnlock();
    await loadAll();
  } catch(e){
    document.getElementById("unlockMsg").textContent = (e && e.message) ? e.message : "Clave inválida o sin permisos.";
  } finally {
    hideLoading();
  }
}

// ---------- Bootstrap ----------
document.addEventListener("DOMContentLoaded", ()=>{
  document.getElementById("btnUnlock").addEventListener("click", openUnlock);
  document.getElementById("btnCancelUnlock").addEventListener("click", closeUnlock);
  document.getElementById("btnDoUnlock").addEventListener("click", doUnlock);
  document.getElementById("btnReload").addEventListener("click", ()=>loadAll().catch(e=>alert(e.message||"Error")));
  document.getElementById("btnRegister").addEventListener("click", registerPurchases);

  // autoload si ya hay clave guardada
  const saved = loadSecretFromLS();
  if(saved){
    UNLOCKED_SECRET = saved;
    loadAll().catch((e)=>{ setMeta((e && e.message) ? e.message : "Clave guardada inválida o expirada. Presiona “Desbloquear”."); UNLOCKED_SECRET=""; });
  }
});
