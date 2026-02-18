const PURCHASES_VERSION = "20260218181217";
console.log("Purchases JS v", PURCHASES_VERSION, "(costslogin3)");

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
async function api(payload, timeoutMs = 60000){
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
      throw new Error(`Tiempo de espera agotado (API) en acción: ${payload && payload.action ? payload.action : "unknown"}. Revisa el Worker/Apps Script o tu conexión.`);
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
  setOverlayState({ modalOpen:false, loadingOpen:true });
}
function hideLoading(){ setOverlayState({ modalOpen:false, loadingOpen:false }); }

function setMeta(text){
  document.getElementById("metaText").textContent = text || "";
}

function setUnlockedUI(isUnlocked){
  const btnReload = document.getElementById("btnReload");
  const btnRegister = document.getElementById("btnRegister");
  if(btnReload) btnReload.disabled = !isUnlocked;
  if(btnRegister) btnRegister.disabled = !isUnlocked;
  const btnUnlock = document.getElementById("btnUnlock");
  if(btnUnlock) btnUnlock.textContent = isUnlocked ? "Desbloqueado" : "Desbloquear";
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


function setOverlayState({ modalOpen=false, loadingOpen=false }){
  const mb = document.getElementById("unlockBack");
  const lb = document.getElementById("loadingBack");
  if(mb) mb.hidden = !modalOpen;
  if(lb) lb.hidden = !loadingOpen;
  // Guard: nunca permitir ambos visibles
  if(mb && lb && !mb.hidden && !lb.hidden){ lb.hidden = true; }
}
// ---------- Core flow ----------
async function loadAll(){
  if(!UNLOCKED_SECRET) throw new Error("Primero desbloquea Purchases con tu clave de Costos.");
  showLoading("Calculando…","Leyendo pedidos/recetas e inventario…");
  try{
    // catálogo costos (para unidad y costo/u)
    const c = await api({ action:"costs_public_list" }, 60000);
    COSTS = Array.isArray(c.items) ? c.items : [];

    // necesidades (últimas 36h · pagado + no iniciar)
    const n = await api({ action:"costs_orders_for_purchases", costs_secret: UNLOCKED_SECRET }, 60000);
    NEEDS = (n.needs && typeof n.needs === "object") ? n.needs : {};
    const meta = n.meta || {};
    setMeta(`Pedidos usados: ${meta.orders_used ?? "?"}/${meta.orders_total ?? "?"} · Ventana: ${meta.window_hours ?? 36}h`);

    // inventario actual
    const inv = await api({ action:"inventory_get", costs_secret: UNLOCKED_SECRET }, 60000);
    INVENTORY = (inv.inventory && typeof inv.inventory === "object") ? inv.inventory : {};

    buildRows();
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

  showLoading("Registrando compras…", "Sumando cantidades al inventario…");
  try{
    await api({ action:"inventory_add_purchase_batch", costs_secret: UNLOCKED_SECRET, items });
    // refrescar inventario y recalcular
    const inv = await api({ action:"inventory_get", costs_secret: UNLOCKED_SECRET }, 60000);
    INVENTORY = (inv.inventory && typeof inv.inventory === "object") ? inv.inventory : {};
    buildRows();
    render();
    alert("Listo: compras registradas en INVENTARIO.");
  } catch(e){
    alert(e.message || "No se pudo registrar");
  } finally {
    hideLoading();
  }
}

// ---------- Unlock modal ----------
function openUnlock(){
  const input = document.getElementById("secretInput");
  const msg = document.getElementById("unlockMsg");
  input.value = UNLOCKED_SECRET || loadSecretFromLS() || "";
  if(UNLOCKED_SECRET){
    msg.textContent = "Ya estás desbloqueado. Si quieres, puedes revalidar la clave.";
  } else {
    msg.textContent = "";
  }
  setOverlayState({ modalOpen:true, loadingOpen:false });
}
function closeUnlock(){
  setOverlayState({ modalOpen:false, loadingOpen:false });
}

async function doUnlock(){
  const btn = document.getElementById("btnDoUnlock");
  const msg = document.getElementById("unlockMsg");
  const s = String(document.getElementById("secretInput").value || "").trim();

  if(!s){
    msg.textContent = "Ingresa la clave.";
    return;
  }

  btn.disabled = true;
  msg.textContent = "";

  showLoading("Validando…", "Comprobando clave…");

  try{
    // Validación rápida: acción protegida por COSTS_SECRET
    await api({ action:"costs_list", costs_secret: s }, 20000);

    UNLOCKED_SECRET = s;
    saveSecretToLS(s);
    setUnlockedUI(true);

    // cerrar modal ya (aunque el cálculo tarde)
    closeUnlock();

    // cargar en segundo plano
    loadAll()
      .then(()=>{ /* ok */ })
      .catch(err=>{
        const em = (err && err.message) ? err.message : String(err);
        setMeta(`Desbloqueado, pero no se pudo cargar el cálculo: ${em}`);
      });
  } catch(e){
    hideLoading();
    setOverlayState({ modalOpen:true, loadingOpen:false });
    msg.textContent = (e && e.message) ? e.message : "Clave inválida.";
    setUnlockedUI(false);
  } finally {
    btn.disabled = false;
    if(document.getElementById("loadingBack")) document.getElementById("loadingBack").hidden = true;
  }
}


// ---------- Bootstrap ----------

document.addEventListener("DOMContentLoaded", ()=>{
  document.getElementById("btnUnlock").addEventListener("click", openUnlock);
  document.getElementById("btnCancelUnlock").addEventListener("click", closeUnlock);
  document.getElementById("btnDoUnlock").addEventListener("click", doUnlock);

  // botones dependen de desbloqueo
  document.getElementById("btnReload").addEventListener("click", ()=>{
    if(!UNLOCKED_SECRET) return openUnlock();
    loadAll().catch(e=>alert(e.message||"Error"));
  });
  document.getElementById("btnRegister").addEventListener("click", ()=>{
    if(!UNLOCKED_SECRET) return openUnlock();
    registerPurchases();
  });

  setUnlockedUI(false);

  // autoload si ya hay clave guardada (validamos rápido)
  const saved = loadSecretFromLS();
  if(saved){
    showLoading("Validando…", "Comprobando clave guardada…");
    api({ action:"costs_list", costs_secret: saved }, 20000)
      .then(()=>{
        UNLOCKED_SECRET = saved;
        setUnlockedUI(true);
        return loadAll();
      })
      .catch(()=>{
        setMeta("Clave guardada inválida o expirada. Presiona “Desbloquear”.");
        UNLOCKED_SECRET = "";
        saveSecretToLS("");
        setUnlockedUI(false);
      })
      .finally(()=>{ if(document.getElementById("loadingBack")) document.getElementById("loadingBack").hidden = true; });
  } else {
    setMeta("Bloqueado. Presiona “Desbloquear” para cargar cálculo e inventario.");
  }
});
