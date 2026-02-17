/* =========================================================
   AMARED · Compras v2 (Backend-first)  [P2b]
   - NO usa getSheet_ ni kitchen-costs.js
   - Apps Script calcula needs; front solo renderiza
   ========================================================= */
const API_URL = "https://amared-orders.amaredpostres.workers.dev/";

const $ = (sel) => document.querySelector(sel);

function fmtCOP(n){
  const v = Number(n||0);
  return v.toLocaleString("es-CO", { style:"currency", currency:"COP", maximumFractionDigits:0 });
}

function num(v){ const x = Number(v); return (isFinite(x) ? x : 0); }

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

function getKey(){
  return (sessionStorage.getItem("AMARED_COSTS_KEY") || "").trim();
}
function setKey(k){ sessionStorage.setItem("AMARED_COSTS_KEY", String(k||"").trim()); }

function setStatus(msg, kind="") {
  const el = $("#p2Status");
  if(!el) return;
  el.textContent = msg || "";
  el.className = "p2-status " + (kind ? ("p2-" + kind) : "");
}

function strip00(x){
  const v = num(x);
  const s = v.toFixed(2);
  return s.replace(/\.00$/,"");
}

function buildRows(needsMap, invMap, costItems){
  const costMap = {};
  (costItems||[]).forEach(it=>{
    const k = String(it.ingredient_key||"").trim();
    if(!k) return;
    const cpu = num(it.cop_per_unit);
    if(!costMap[k] || cpu > costMap[k].cop_per_unit) costMap[k] = { cop_per_unit: cpu, unit_type: it.unit_type || "" };
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

function renderTable(rows){
  const tbody = $("#p2Tbody");
  tbody.innerHTML = "";
  let total = 0;
  let countNeed = 0;

  rows.forEach((r, idx)=>{
    if(r.buy > 0) countNeed++;
    total += num(r.cop_total);

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="p2-td-ing">
        <label class="p2-check">
          <input type="checkbox" class="p2-cb" data-k="${idx}">
          <span>${r.ingredient_key}</span>
        </label>
        <div class="p2-sub">${r.invUnit ? r.invUnit : ""}</div>
      </td>
      <td class="p2-num">${strip00(r.need)}</td>
      <td class="p2-num">${strip00(r.invQty)}</td>
      <td class="p2-num">
        <input class="p2-buy" data-k="${idx}" type="number" min="0" step="0.01" value="${strip00(r.buy)}">
      </td>
      <td class="p2-num p2-money" data-money="${idx}">${fmtCOP(r.cop_total)}</td>
    `;
    tbody.appendChild(tr);
  });

  $("#p2NeedCount").textContent = String(countNeed);
  $("#p2TotalCost").textContent = fmtCOP(total);
}

function bindBuyInputs(rows){
  document.querySelectorAll(".p2-buy").forEach(inp=>{
    inp.addEventListener("input", ()=>{
      const idx = Number(inp.dataset.k);
      const v = Math.max(num(inp.value), 0);
      rows[idx].buy = v;
      rows[idx].cop_total = num(rows[idx].cop_per_unit) * v;

      const moneyEl = document.querySelector(`[data-money="${idx}"]`);
      if(moneyEl) moneyEl.textContent = fmtCOP(rows[idx].cop_total);

      const total = rows.reduce((s,x)=> s + num(x.cop_total), 0);
      $("#p2TotalCost").textContent = fmtCOP(total);

      const countNeed = rows.reduce((s,x)=> s + (x.buy>0 ? 1:0), 0);
      $("#p2NeedCount").textContent = String(countNeed);
    });
  });
}

async function refresh(){
  const key = getKey();
  if(!key) throw new Error("Ingresa la clave de Costos y desbloquea.");

  setStatus("Calculando desde pedidos…", "loading");

  const needsRes = await api("costs_orders_for_purchases", { costs_secret: key });
  const needsMap = needsRes.needs || {};
  const meta = needsRes.meta || {};

  const invRes = await api("inventory_get", { costs_secret: key });
  const invMap = invRes.inventory || {};

  let costItems = [];
  try {
    const costsRes = await api("costs_public_list", {});
    costItems = costsRes.items || [];
  } catch(e) {
    costItems = [];
  }

  const rows = buildRows(needsMap, invMap, costItems);
  renderTable(rows);
  bindBuyInputs(rows);

  $("#p2Meta").textContent = `Pedidos usados: ${meta.orders_used||0} (ventana: ${meta.window_hours||""}h, corte: ${meta.cutoff_hour||""}:00)`;
  setStatus("Listo.", "ok");

  window.__P2_ROWS__ = rows;
}

async function commitPurchases(){
  const rows = window.__P2_ROWS__ || [];
  const key = getKey();
  if(!key) throw new Error("Clave no encontrada.");

  const checked = Array.from(document.querySelectorAll(".p2-cb"))
    .filter(cb => cb.checked)
    .map(cb => Number(cb.dataset.k));

  if(!checked.length) throw new Error("Selecciona al menos 1 ingrediente para registrar la compra.");

  const items = checked.map(i => {
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

  if(!items.length) throw new Error("Las filas seleccionadas tienen compra en 0.");

  setStatus("Registrando compra y actualizando inventario…", "loading");

  await api("inventory_add_purchase_batch", {
    costs_secret: key,
    items,
    updated_by: "COSTS_UI",
    source: "PURCHASES_V2"
  });

  setStatus("Compra registrada. Inventario actualizado.", "ok");
  await refresh();
}

function init(){
  console.log("[AMARED] purchases2.js cargado: P2b");
  const k = getKey();
  if(k) $("#p2Key").value = k;

  $("#p2Unlock").addEventListener("click", ()=>{
    const key = String($("#p2Key").value||"").trim();
    if(!key) return setStatus("Ingresa la clave.", "warn");
    setKey(key);
    setStatus("Desbloqueado.", "ok");
  });

  $("#p2Refresh").addEventListener("click", ()=>{
    refresh().catch(err=> setStatus(String(err.message||err), "warn"));
  });

  $("#p2Commit").addEventListener("click", ()=>{
    commitPurchases().catch(err=> setStatus(String(err.message||err), "warn"));
  });
}

document.addEventListener("DOMContentLoaded", init);



/* ---- Compat: soporta botones existentes en purchases.html ---- */
window.amaredRefreshOrders = function(){
  // mantiene el nombre que usa el HTML actual
  return refresh();
};
/* ---- End compat ---- */
