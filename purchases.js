/* =========================================================
   AMARED · purchases.js (Compras) — Variante Backend-first  [P3]
   - Diseñado para TU purchases.html actual (ids: secret/unlock/buyList/buyTotals)
   - NO usa getSheet_ ni depende de kitchen-costs.js
   ========================================================= */
const API_URL = "https://amared-orders.amaredpostres.workers.dev/";

const $ = (id) => document.getElementById(id);

function fmtCOP(n){
  const v = Number(n||0);
  return v.toLocaleString("es-CO", { style:"currency", currency:"COP", maximumFractionDigits:0 });
}
function num(v){ const x = Number(v); return (isFinite(x) ? x : 0); }
function strip00(x){
  const v = num(x);
  const s = v.toFixed(2);
  return s.replace(/\.00$/,"");
}

function setErr(msg=""){
  const el = $("err");
  if(!el) return;
  el.textContent = msg || "";
}

function showLoading(on, title="Cargando…", desc="Por favor espera."){
  const box = $("loading");
  const lt = $("lt");
  const ld = $("ld");
  if(lt) lt.textContent = title;
  if(ld) ld.textContent = desc;
  if(box) box.style.display = on ? "flex" : "none";
}

function getKey(){
  return (sessionStorage.getItem("AMARED_COSTS_KEY") || "").trim();
}
function setKey(k){ sessionStorage.setItem("AMARED_COSTS_KEY", String(k||"").trim()); }

async function api(action, body={}){
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify({ action, ...body })
  });
  const data = await res.json().catch(()=> ({ok:false, error:"Respuesta no-JSON"}));
  if(!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function buildRows(needsMap, invMap, costItems){
  const costMap = {};
  (costItems||[]).forEach(it=>{
    const k = String(it.ingredient_key||"").trim();
    if(!k) return;
    const cpu = num(it.cop_per_unit);
    if(!costMap[k] || cpu > costMap[k].cop_per_unit){
      costMap[k] = { cop_per_unit: cpu, unit_type: it.unit_type || "" };
    }
  });

  const keys = Object.keys(needsMap||{}).sort((a,b)=>a.localeCompare(b,"es"));
  return keys.map(k=>{
    const need = num(needsMap[k]);
    const inv = invMap && invMap[k] ? invMap[k] : null;
    const invQty = inv ? num(inv.qty) : 0;
    const invUnit = inv ? String(inv.unit||"") : "";
    const cpu = costMap[k] ? num(costMap[k].cop_per_unit) : 0;
    const buy = Math.max(need - invQty, 0);

    return {
      ingredient_key: k,
      need,
      invQty,
      invUnit,
      buy,
      cop_per_unit: cpu,
      cop_total: cpu * buy
    };
  });
}

function render(rows){
  const list = $("buyList");
  const totals = $("buyTotals");
  const panel = $("buyPurchasePanel");
  if(!list) return;

  let total = 0;
  let needCount = 0;

  const tableRows = rows.map((r, idx)=>{
    total += num(r.cop_total);
    if(r.buy > 0) needCount++;

    return `
      <tr>
        <td style="min-width:240px;">
          <label style="display:flex; gap:10px; align-items:center; cursor:pointer;">
            <input type="checkbox" class="p3-cb" data-k="${idx}">
            <span><b>${escapeHtml(r.ingredient_key)}</b><br><span class="muted small">${escapeHtml(r.invUnit||"")}</span></span>
          </label>
        </td>
        <td style="text-align:right;">${strip00(r.need)}</td>
        <td style="text-align:right;">${strip00(r.invQty)}</td>
        <td style="text-align:right;">
          <input class="p3-buy" data-k="${idx}" type="number" min="0" step="0.01"
            value="${strip00(r.buy)}"
            style="width:110px; text-align:right; padding:8px; border-radius:10px; border:1px solid rgba(0,0,0,.12); background:rgba(255,255,255,.8);">
        </td>
        <td style="text-align:right; font-weight:700;" data-money="${idx}">${fmtCOP(r.cop_total)}</td>
      </tr>
    `;
  }).join("");

  list.innerHTML = `
    <div style="overflow:auto;">
      <table class="table" style="width:100%; border-collapse:collapse;">
        <thead>
          <tr>
            <th style="text-align:left;">Ingrediente</th>
            <th style="text-align:right;">Necesario</th>
            <th style="text-align:right;">Inventario</th>
            <th style="text-align:right;">Comprar</th>
            <th style="text-align:right;">Costo estimado</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
  `;

  if(totals){
    totals.innerHTML = `
      <div class="buyPills" style="display:flex; gap:10px; flex-wrap:wrap; margin:10px 0;">
        <span class="pill">Ingredientes con necesidad: <b id="p3NeedCount">${needCount}</b></span>
        <span class="pill">Total compra estimada: <b id="p3Total">${fmtCOP(total)}</b></span>
      </div>
    `;
  }

  if(panel){
    panel.innerHTML = `
      <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-top:10px;">
        <button id="p3Commit" class="btn">Registrar compra (seleccionados)</button>
        <span class="muted small">Marca ingredientes y registra el movimiento + actualiza inventario.</span>
      </div>
    `;
  }

  // bind inputs
  document.querySelectorAll(".p3-buy").forEach(inp=>{
    inp.addEventListener("input", ()=>{
      const idx = Number(inp.dataset.k);
      const v = Math.max(num(inp.value), 0);
      rows[idx].buy = v;
      rows[idx].cop_total = num(rows[idx].cop_per_unit) * v;

      const moneyEl = document.querySelector(`[data-money="${idx}"]`);
      if(moneyEl) moneyEl.textContent = fmtCOP(rows[idx].cop_total);

      const total2 = rows.reduce((s,x)=> s + num(x.cop_total), 0);
      const need2 = rows.reduce((s,x)=> s + (x.buy>0 ? 1:0), 0);
      const tEl = document.getElementById("p3Total");
      const nEl = document.getElementById("p3NeedCount");
      if(tEl) tEl.textContent = fmtCOP(total2);
      if(nEl) nEl.textContent = String(need2);
    });
  });

  const btn = $("p3Commit");
  if(btn){
    btn.addEventListener("click", ()=>{
      commit(rows).catch(e=> setErr(String(e.message||e)));
    });
  }

  window.__P3_ROWS__ = rows;
}

function escapeHtml(s){
  return String(s||"").replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[m]));
}

async function refresh(){
  const key = getKey();
  if(!key) throw new Error("Ingresa la clave y desbloquea.");
  setErr("");

  showLoading(true, "Calculando…", "Leyendo pedidos, recetas e inventario.");
  try{
    const needsRes = await api("costs_orders_for_purchases", { costs_secret: key });
    const invRes   = await api("inventory_get", { costs_secret: key });

    let costItems = [];
    try{
      const costsRes = await api("costs_public_list", {});
      costItems = costsRes.items || [];
    }catch(_e){ costItems = []; }

    const rows = buildRows(needsRes.needs||{}, invRes.inventory||{}, costItems);
    render(rows);

    // mostrar editor
    const ed = $("editor");
    if(ed) ed.style.display = "block";
  } finally {
    showLoading(false);
  }
}

async function commit(rows){
  const key = getKey();
  if(!key) throw new Error("Clave no encontrada.");

  const checked = Array.from(document.querySelectorAll(".p3-cb"))
    .filter(cb => cb.checked)
    .map(cb => Number(cb.dataset.k));

  if(!checked.length) throw new Error("Selecciona al menos 1 ingrediente.");

  const items = checked.map(i=>{
    const r = rows[i];
    const qty = Math.max(num(r.buy), 0);
    if(qty <= 0) return null;
    return {
      ingredient_key: r.ingredient_key,
      qty,
      unit: r.invUnit || "",
      cop_per_unit: num(r.cop_per_unit)
    };
  }).filter(Boolean);

  if(!items.length) throw new Error("Los seleccionados tienen compra en 0.");

  showLoading(true, "Registrando compra…", "Actualizando inventario y guardando movimiento.");
  try{
    await api("inventory_add_purchase_batch", {
      costs_secret: key,
      items,
      updated_by: "COSTS_UI",
      source: "PURCHASES_MAIN"
    });
    setErr("✅ Compra registrada e inventario actualizado.");
    await refresh();
  } finally {
    showLoading(false);
  }
}

/* ------- Boot (usa tus ids actuales) ------- */
function init(){
  console.log("[AMARED] purchases.js cargado: P3b");

  // prefill
  const secret = $("secret");
  if(secret){
    const k = getKey();
    if(k) secret.value = k;
  }

  const unlock = $("unlock");
  if(unlock){
    unlock.addEventListener("click", ()=>{
      const k = secret ? String(secret.value||"").trim() : "";
      if(!k) return setErr("Ingresa la clave.");
      setKey(k);
      setErr("✅ Desbloqueado.");
      // mostrar editor
      const ed = $("editor");
      if(ed) ed.style.display = "block";
    });
  }

  // botón existente (tiene onclick)
  window.amaredRefreshOrders = function(ev){
    try{
      if(ev && ev.preventDefault) ev.preventDefault();
      if(ev && ev.stopPropagation) ev.stopPropagation();
      if(ev && ev.stopImmediatePropagation) ev.stopImmediatePropagation();
    }catch(_e){}
    return refresh().catch(e=> setErr(String(e.message||e)));
  };

  // reset button (opcional)
  const reset = $("buyReset");
  if(reset){
    reset.addEventListener("click", ()=>{
      const rows = window.__P3_ROWS__ || [];
      rows.forEach(r=>{ r.buy = Math.max(r.need - r.invQty, 0); r.cop_total = num(r.cop_per_unit)*r.buy; });
      render(rows);
    });
  }
}

document.addEventListener("DOMContentLoaded", init);
