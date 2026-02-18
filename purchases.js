// ===============================
// AMARED - PURCHASES (V4)
// Objetivo: flujo estable SIN getSheet_ en frontend.
// - Calcula necesidades desde backend: action "costs_orders_for_purchases"
// - Lee inventario: action "inventory_get"
// - Lee costos (COP/u y unidad): action "costs_list"
// - Registra compras + suma a inventario + registra movimiento: action "inventory_add_purchase_batch"
// Requisitos backend: Webhook.gs ya tiene esos actions.
// ===============================

(function(){
  "use strict";

  const API_URL = "https://amared-orders.amaredpostres.workers.dev/";

  // ---- DOM helpers ----
  const $ = (id)=> document.getElementById(id);
  const bySel = (q)=> document.querySelector(q);

  const secretInp = $("secret");
  const btnUnlock = $("unlock");
  const errBox = $("err");

  const editor = $("editor");

  const btnRefresh = $("buyRefreshOrders");
  const btnReset = $("buyReset");

  const totalsEl = $("buyTotals");
  const listEl = $("buyList");
  const panelEl = $("buyPurchasePanel");
  const summaryHint = $("buySummaryHint");
  const netDebug = $("netDebug");

  // ---- State ----
  const state = {
    // Clave de costos, ingresada por el usuario. Este valor se envía como
    // costs_secret en las llamadas al backend.
    costsSecret: "",
    // PIN admin se mantiene por compatibilidad, pero no se usa en Compras.
    pin: "",
    needs: {},        // ingredient_key -> qty needed (from backend)
    inventory: {},    // ingredient_key -> {qty, unit}
    costs: {},        // ingredient_key -> {cop_per_unit, unit}
    uiRows: [],       // normalized rows rendered
  };

  // ---- Utils ----
  const esc = (s)=> String(s??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
  const num = (v)=> { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const fmt0 = (v)=> Math.round(num(v)).toLocaleString("es-CO");
  const fmt2 = (v)=> (Math.round(num(v)*100)/100).toLocaleString("es-CO");
  const normKey = (k)=> String(k||"").trim();

  function setErr(msg){
    if(!errBox) return;
    errBox.textContent = msg || "";
  }

  async function api(payload){
    const res = await fetch(API_URL, {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify(payload||{})
    });
    const out = await res.json().catch(async()=>({ok:false,error: await res.text().catch(()=> "Error")}));    
    if(!out || out.ok !== true) throw new Error(out?.error || "Error");
    return out;
  }

  // Validación de PIN no es necesaria para Compras. Retornamos true siempre.
  async function validatePin(pin){
    return true;
  }

  function showEditor(){
    if(editor) editor.style.display = "block";
  }
  function hideEditor(){
    if(editor) editor.style.display = "none";
  }

  function buildRows(){
    const allKeys = new Set([
      ...Object.keys(state.needs||{}),
      ...Object.keys(state.inventory||{}),
      ...Object.keys(state.costs||{}),
    ]);

    const rows = [];
    for(const k of allKeys){
      const key = normKey(k);
      if(!key) continue;

      const need = num(state.needs[key] || 0);
      const inv = num(state.inventory[key]?.qty ?? 0);
      const unit = String(state.costs[key]?.unit || state.inventory[key]?.unit || "").trim();
      const cpu  = num(state.costs[key]?.cop_per_unit ?? 0);

      const toBuy = Math.max(0, need - inv);
      const est = toBuy * cpu;

      rows.push({
        ingredient_key: key,
        need,
        inv,
        unit,
        cpu,
        toBuy,
        est,
        buyQty: toBuy, // por defecto
        selected: toBuy > 0
      });
    }

    // orden: primero los que necesitan compra, luego alfabético
    rows.sort((a,b)=>{
      const aN = a.toBuy>0 ? 0 : 1;
      const bN = b.toBuy>0 ? 0 : 1;
      if(aN !== bN) return aN - bN;
      return a.ingredient_key.localeCompare(b.ingredient_key, "es");
    });

    state.uiRows = rows;
  }

  function render(){
    buildRows();

    const rows = state.uiRows;

    const countNeed = rows.filter(r=>r.toBuy>0).length;
    const totalEst = rows.reduce((s,r)=> s + (r.est||0), 0);

    if(summaryHint) summaryHint.textContent = `${countNeed} ing. · $${fmt0(totalEst)}`;

    if(totalsEl){
      totalsEl.innerHTML = `
        <div class="buyChip">Ingredientes con necesidad: <b>${countNeed}</b></div>
        <div class="buyChip">Total compra estimada: <b>$${fmt0(totalEst)}</b></div>
      `;
    }

    if(!listEl) return;

    listEl.innerHTML = `
      <div class="buyTable">
        <div class="buyHead">
          <div>Ingrediente</div>
          <div>Necesario</div>
          <div>Inventario</div>
          <div>Comprar</div>
          <div>Costo estimado</div>
        </div>
        <div class="buyBody">
          ${rows.map((r,idx)=> rowHtml(r,idx)).join("")}
        </div>
      </div>
    `;

    // listeners qty + select
    rows.forEach((r,idx)=>{
      const chk = $("buy_chk_"+idx);
      const qty = $("buy_qty_"+idx);

      if(chk){
        chk.checked = !!r.selected;
        chk.addEventListener("change", ()=>{
          r.selected = chk.checked;
          repaintPanel();
        });
      }
      if(qty){
        qty.value = String(r.buyQty || 0);
        qty.addEventListener("input", ()=>{
          r.buyQty = Math.max(0, num(qty.value));
          // auto-select si > 0
          if(r.buyQty>0){
            r.selected = true;
            if(chk) chk.checked = true;
          }
          repaintPanel();
        });
      }
    });

    repaintPanel();
  }

  function rowHtml(r,idx){
    const small = r.unit ? `<div class="muted small">${esc(r.unit)} · $${fmt0(r.cpu)}/u</div>` : `<div class="muted small">—</div>`;
    const buy = (r.toBuy>0) ? `<b>${fmt2(r.toBuy)}</b>` : `<span class="muted">0</span>`;
    const est = (r.est>0) ? `<b>$${fmt0(r.est)}</b>` : `<span class="muted">$0</span>`;

    return `
      <div class="buyRow">
        <div class="buyIng">
          <div class="buyName">${esc(r.ingredient_key)}</div>
          ${small}
        </div>

        <div class="buyCell">
          <input class="input" value="${fmt2(r.need)}" disabled />
        </div>

        <div class="buyCell">
          <input class="input" value="${fmt2(r.inv)}" disabled />
        </div>

        <div class="buyCell buyBuy">
          <label class="buyPick">
            <input type="checkbox" id="buy_chk_${idx}" />
            <span>Comprar</span>
          </label>
          <input class="input" id="buy_qty_${idx}" type="number" min="0" step="0.01" value="${fmt2(r.buyQty)}" />
          <div class="muted small">Sugerido: ${buy}</div>
        </div>

        <div class="buyCell">
          ${est}
        </div>
      </div>
    `;
  }

  function repaintPanel(){
    if(!panelEl) return;
    const selected = state.uiRows.filter(r=>r.selected && num(r.buyQty)>0);
    const total = selected.reduce((s,r)=> s + (num(r.buyQty)*num(r.cpu)), 0);

    panelEl.innerHTML = `
      <div class="buyPanel">
        <div class="buyPanelTitle">✅ Registrar compra</div>
        <div class="muted small" style="margin-bottom:10px;">
          Seleccionados: <b>${selected.length}</b> · Total estimado: <b>$${fmt0(total)}</b>
        </div>
        <button id="btnRegisterPurchase" class="btn">Registrar compra (seleccionados)</button>
        <div id="buyPanelMsg" class="muted small" style="margin-top:10px;"></div>
      </div>
    `;

    const btn = $("btnRegisterPurchase");
    if(btn){
      btn.addEventListener("click", async ()=>{
        const msg = $("buyPanelMsg");
        try{
          btn.disabled = true;
          if(msg) msg.textContent = "Registrando compra…";

          const items = selected.map(r=>({
            ingredient_key: r.ingredient_key,
            qty: num(r.buyQty),
            unit: r.unit || "",
            cop_per_unit: num(r.cpu),
          }));

          if(items.length===0) throw new Error("No hay ítems seleccionados.");

          await api({
            action:"inventory_add_purchase_batch",
            // Enviamos costs_secret para registrar compras
            costs_secret: state.costsSecret,
            items,
            updated_by: "PURCHASES_UI",
            source: "PURCHASES_UI"
          });

          if(msg) msg.textContent = "✅ Compra registrada. Actualizando inventario…";
          // recargar inventario y re-render usando costs_secret
          const inv = await api({action:"inventory_get", costs_secret: state.costsSecret});
          state.inventory = inv.inventory || {};
          render();
          if(msg) msg.textContent = "✅ Listo. Inventario actualizado.";
        }catch(e){
          const em = String(e?.message||e);
          if(msg) msg.textContent = "❌ " + em;
          setErr(em);
        }finally{
          btn.disabled = false;
        }
      });
    }
  }

  async function refreshFromBackend(){
    if(!state.costsSecret) throw new Error("Primero desbloquea con la clave de costos.");

    setErr("");
    if(netDebug) netDebug.style.display="none";

    // Usamos costs_secret en lugar de admin_pin para todos los endpoints relevantes
    const [needsOut, invOut, costsOut] = await Promise.all([
      api({action:"costs_orders_for_purchases", costs_secret: state.costsSecret}),
      api({action:"inventory_get", costs_secret: state.costsSecret}),
      api({action:"costs_list", costs_secret: state.costsSecret}),
    ]);

    state.needs = needsOut.needs || {};
    state.inventory = invOut.inventory || {};

    // costs_list puede venir como array o map. Normalizamos a map {ingredient_key:{cop_per_unit,unit}}
    const costs = {};
    const items = costsOut.items || costsOut.costs || costsOut.rows || [];
    if(Array.isArray(items)){
      for(const r of items){
        const k = normKey(r.ingredient_key || r.key || r.ingredient || "");
        if(!k) continue;
        costs[k] = { cop_per_unit: num(r.cop_per_unit ?? r.copPerUnit ?? r.value ?? 0), unit: String(r.unit||"").trim() };
      }
    }else if(items && typeof items === "object"){
      for(const [k,v] of Object.entries(items)){
        costs[normKey(k)] = { cop_per_unit: num(v?.cop_per_unit ?? v?.copPerUnit ?? v ?? 0), unit: String(v?.unit||"").trim() };
      }
    }
    state.costs = costs;

    // Debug meta
    if(netDebug){
      const meta = needsOut.meta || {};
      netDebug.style.display="block";
      netDebug.textContent = "meta: " + JSON.stringify(meta);
    }

    showEditor();
    render();
  }

  function resetLocal(){
    // En v4 no guardamos sobrantes locales. Si quieres, después agregamos edición local por ingrediente.
    setErr("");
    render();
  }

  async function onUnlock(){
    try{
      const secret = String(secretInp?.value||"").trim();
      if(!secret) throw new Error("Ingresa la clave.");
      // Guardamos la clave de costos y limpiamos cualquier PIN previo
      state.costsSecret = secret;
      state.pin = "";
      setErr("");
      showEditor();
      await refreshFromBackend();
    }catch(e){
      hideEditor();
      setErr(String(e?.message||e));
    }
  }

  function wire(){
    console.log("[AMARED] purchases.js cargado: V4");

    hideEditor();

    if(btnUnlock) btnUnlock.addEventListener("click", (e)=>{ e.preventDefault(); onUnlock(); });
    if(btnRefresh) btnRefresh.addEventListener("click", (e)=>{ e.preventDefault(); refreshFromBackend().catch(err=>setErr(String(err?.message||err))); });
    if(btnReset) btnReset.addEventListener("click", (e)=>{ e.preventDefault(); resetLocal(); });

    // Enter para desbloquear
    if(secretInp){
      secretInp.addEventListener("keydown",(ev)=>{
        if(ev.key==="Enter"){ ev.preventDefault(); onUnlock(); }
      });
    }
  }

  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();

})();
