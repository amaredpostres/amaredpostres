// ===============================
// AMARED - PURCHASES (V5 ESTABLE)
//
// Este módulo implementa la interfaz de compras para calcular y registrar
// ingredientes necesarios a partir de pedidos pagados y no iniciados en cocina.
// Utiliza el backend (Webhook.gs) mediante acciones:
//   - costs_orders_for_purchases
//   - inventory_get
//   - costs_list
//   - inventory_add_purchase_batch
// El desbloqueo utiliza la clave de costos (costs_secret) en lugar del PIN de admin.
// ===============================

(function(){
  "use strict";

  const API_URL = "https://amared-orders.amaredpostres.workers.dev/";

  // ---------- DOM ----------
  const $ = (id)=> document.getElementById(id);

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

  // ---------- STATE ----------
  const state = {
    costsSecret: "",
    needs: {},
    inventory: {},
    costs: {},
    uiRows: []
  };

  // ---------- UTILS ----------
  const num = (v)=> Number(v) || 0;
  const fmt0 = (v)=> Math.round(num(v)).toLocaleString("es-CO");
  const normKey = (k)=> String(k||"").trim();

  function setErr(msg){
    if(errBox) errBox.textContent = msg || "";
  }

  function showEditor(){
    if(editor) editor.style.display = "block";
  }

  function hideEditor(){
    if(editor) editor.style.display = "none";
  }

  async function api(payload){
    const res = await fetch(API_URL,{
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify(payload || {})
    });
    const out = await res.json().catch(()=>({ok:false,error:"Error"}));
    if(!out.ok) throw new Error(out.error || "Error");
    return out;
  }

  // ---------- UNLOCK ----------
  async function onUnlock(){
    try{
      const secret = String(secretInp.value||"").trim();
      if(!secret) throw new Error("Ingresa la clave.");
      state.costsSecret = secret;
      setErr("");
      showEditor();
      await refreshFromBackend();
    }catch(e){
      hideEditor();
      setErr(e.message);
    }
  }

  // ---------- LOAD DATA ----------
  async function refreshFromBackend(){
    if(!state.costsSecret) throw new Error("Primero desbloquea con la clave.");
    const [needsOut, invOut, costsOut] = await Promise.all([
      api({ action:"costs_orders_for_purchases", costs_secret: state.costsSecret }),
      api({ action:"inventory_get",             costs_secret: state.costsSecret }),
      api({ action:"costs_list",                costs_secret: state.costsSecret })
    ]);
    state.needs = needsOut.needs || {};
    state.inventory = invOut.inventory || {};
    const costs = {};
    const items = costsOut.items || [];
    for(const r of items){
      const k = normKey(r.ingredient_key);
      if(!k) continue;
      costs[k] = {
        cop_per_unit: num(r.cop_per_unit),
        unit: r.unit || ""
      };
    }
    state.costs = costs;
    render();
  }

  // ---------- RENDER ----------
  function render(){
    const rows = [];
    for(const key of Object.keys(state.needs)){
      const need = num(state.needs[key]);
      const have = num(state.inventory[key]?.qty);
      const diff = need - have;
      rows.push({ key, need, have, diff });
    }
    state.uiRows = rows;
    if(listEl){
      listEl.innerHTML = rows.map(r=>`
        <div class="item">
          <div class="k">${r.key}</div>
          <div class="mini">
            Necesario: ${fmt0(r.need)} |
            Inventario: ${fmt0(r.have)} |
            ${
              r.diff>0 ? `<b style="color:#b00020;">Comprar: ${fmt0(r.diff)}</b>` :
                         `<b style="color:#0b6e4f;">Sobrante: ${fmt0(Math.abs(r.diff))}</b>`
            }
          </div>
        </div>
      `).join("");
    }
  }

  // ---------- EVENTS ----------
  btnUnlock?.addEventListener("click", onUnlock);
  btnRefresh?.addEventListener("click", refreshFromBackend);

})();
