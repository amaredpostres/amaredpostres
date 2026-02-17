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
  const secretInp = $("secret");
  const btnUnlock = $("unlock");
  const errBox = $("err");

  const editor = $("editor");

  const btnRefresh = $("buyRefreshOrders");
  const btnReset = $("buyReset");

  const totalsEl = $("buyTotals");
  const ordersPanelEl = $("buyOrdersPanel");
  const listEl = $("buyList");
  const panelEl = $("buyPurchasePanel");
  const summaryHint = $("buySummaryHint");
  const netDebug = $("netDebug");
  const loadingEl = $("loading");
  const loadingTitleEl = $("lt");
  const loadingDescEl = $("ld");

  // ---- State ----
  const state = {
    pin: "",
    authField: "",   // "admin_pin" | "costs_secret"
    needs: {},        // ingredient_key -> qty needed (from backend)
    inventory: {},    // ingredient_key -> {qty, unit}
    costs: {},        // ingredient_key -> {cop_per_unit, unit}
    uiRows: [],       // normalized rows rendered
    orderMeta: null,   // breakdown de pedidos usados para el cálculo
    isUnlocking: false,
  };

  // ---- Utils ----
  const esc = (s)=> String(s??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
  const num = (v)=> { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const fmt0 = (v)=> Math.round(num(v)).toLocaleString("es-CO");
  const fmt2 = (v)=> (Math.round(num(v)*100)/100).toLocaleString("es-CO");
  const normKey = (k)=> String(k||"").trim();

  function boolFromAny(v){
    const s = String(v ?? "").trim().toLowerCase();
    return ["1","true","si","sí","yes","y","pagado","paid","ok"].includes(s);
  }

  function kitchenNotStarted(v){
    const s = String(v ?? "").trim().toLowerCase();
    return ["no iniciar","sin iniciar","pendiente","pending",""].includes(s);
  }

  function normalizeOrderItem(it){
    return {
      id: String(it?.id || it?.product_id || it?.productId || "").trim(),
      name: String(it?.name || it?.product_name || "").trim(),
      qty: num(it?.qty ?? it?.units ?? it?.quantity ?? 0),
    };
  }

  function normalizeItemsFromOrder(order){
    if(!order) return [];

    const raw = order.items_json ?? order.itemsJson ?? order.itemsJSON;
    if(raw){
      try{
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        if(Array.isArray(parsed)) return parsed.map(normalizeOrderItem).filter(it=>it.qty>0 && (it.id || it.name));
      }catch(_e){}
    }

    const txt = String(order.items || "").trim();
    if(!txt) return [];
    const rows = [];
    for(const line0 of txt.split("\n")){
      const line = String(line0 || "").trim().replace(/^-+\s*/, "");
      const m = line.match(/^(.+?)\s*:\s*(\d+(?:[\.,]\d+)?)$/);
      if(!m) continue;
      rows.push({ id:"", name:m[1].trim(), qty: num(String(m[2]).replace(",",".")) });
    }
    return rows.filter(it=>it.qty>0 && (it.id || it.name));
  }

  function orderMatchesFilters(order){
    const paymentRaw = order?.payment_status ?? order?.estado_pago ?? order?.paymentStatus ?? order?.status_payment ?? order?.paid;
    const kitchenRaw = order?.kitchen_status ?? order?.estado_cocina ?? order?.kitchenStatus ?? order?.status_kitchen;

    const paymentText = String(paymentRaw ?? "").trim().toLowerCase();
    const kitchenText = String(kitchenRaw ?? "").trim().toLowerCase();

    const paymentOk = paymentText === "pagado" || paymentText === "paid" || boolFromAny(paymentRaw);
    const kitchenOk = kitchenNotStarted(kitchenRaw) || kitchenText === "no iniciar";

    return paymentOk && kitchenOk;
  }

  function normalizeNeedsOut(out){
    const base = out?.needs || out?.needObj || out?.data?.needs || {};
    const normalizedNeeds = {};
    for(const [k,v] of Object.entries(base || {})){
      const nk = normKey(k);
      if(!nk) continue;
      normalizedNeeds[nk] = num(v);
    }

    const meta = out?.meta || {};
    const orders = Array.isArray(out?.orders) ? out.orders : (Array.isArray(out?.source_orders) ? out.source_orders : []);

    const filteredOrders = orders.filter(orderMatchesFilters);
    const totalDesserts = filteredOrders.reduce((acc,order)=>{
      const items = normalizeItemsFromOrder(order);
      return acc + items.reduce((s,it)=>s + num(it.qty),0);
    },0);

    return {
      needs: normalizedNeeds,
      meta: {
        selected_orders: filteredOrders.length || num(meta.selected_orders || meta.orders_used || 0),
        total_orders_received: orders.length || num(meta.total_orders_received || meta.orders_total || 0),
        total_desserts: totalDesserts || num(meta.total_desserts || meta.total_units || 0),
        used_cutoff_hour: meta.used_cutoff_hour || meta.cutoff_hour || 15,
      },
      rawOrders: filteredOrders
    };
  }

  function setErr(msg){
    if(!errBox) return;
    errBox.textContent = msg || "";
  }

  function setLoading(show, title, desc){
    if(!loadingEl) return;
    if(loadingTitleEl && title) loadingTitleEl.textContent = title;
    if(loadingDescEl && desc) loadingDescEl.textContent = desc;
    loadingEl.classList.toggle("show", !!show);
  }

  function setUnlockBusy(isBusy){
    if(!btnUnlock) return;
    btnUnlock.disabled = !!isBusy;
    btnUnlock.textContent = isBusy ? "Desbloqueando..." : "Desbloquear";
  }

  function formatApiError(status, fallbackText){
    const raw = String(fallbackText || "").trim();
    if(!raw) return `Error HTTP ${status}`;

    const lowered = raw.toLowerCase();
    const looksLikeHtml = lowered.includes("<!doctype html") || lowered.includes("<html") || lowered.includes("<head") || lowered.includes("google apps script");

    if(raw.includes("The script completed but the returned value is not a supported return type")){
      return "Webhook.gs devolvió un tipo no soportado por Apps Script. Revisa la acción 'costs_orders_for_purchases' y asegúrate de retornar json_(...) en todos los caminos.";
    }

    if(looksLikeHtml){
      return `El webhook devolvió HTML (HTTP ${status}) en lugar de JSON. Revisa que doPost/doGet retornen json_(...).`;
    }

    return raw;
  }

  async function api(payload){
    const res = await fetch(API_URL, {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify(payload||{})
    });

    let out = null;
    let rawText = "";
    try{
      rawText = await res.text();
      out = rawText ? JSON.parse(rawText) : null;
    }catch(_e){
      out = { ok:false, error: formatApiError(res.status, rawText || "Error") };
    }

    const errMsg = formatApiError(res.status, out?.error ?? rawText ?? "");
    if(!res.ok) throw new Error(errMsg || `HTTP ${res.status}`);
    if(!out || out.ok !== true) throw new Error(errMsg || "Error");
    return out;
  }

  async function detectAuthField(pin){
    // 1) Si es PIN admin válido, lo usamos.
    try{
      const out = await api({action:"validate_admin_pin", admin_pin: pin});
      if(out && out.valid === true) return "admin_pin";
    }catch(_e){}

    // 2) Si no, probamos la clave de costos contra una acción de compras.
    try{
      await api({action:"inventory_get", costs_secret: pin});
      return "costs_secret";
    }catch(_e2){}

    throw new Error("Clave inválida o no autorizada.");
  }

  function withAuth(payload){
    const field = state.authField || "admin_pin";
    return { ...(payload||{}), [field]: state.pin };
  }

  async function apiAuth(payload){
    return api(withAuth(payload));
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

  function renderOrdersPanel(){
    if(!ordersPanelEl) return;
    const m = state.orderMeta || {};
    const lines = [
      `Pedidos recibidos: <b>${fmt0(m.total_orders_received || 0)}</b>`,
      `Pedidos usados (Pagado + No iniciar): <b>${fmt0(m.selected_orders || 0)}</b>`,
      `Postres totales por preparar: <b>${fmt0(m.total_desserts || 0)}</b>`,
      `Corte aplicado: <b>${fmt0(m.used_cutoff_hour || 15)}:00</b>`,
    ];
    ordersPanelEl.innerHTML = `<div class="buyChip">${lines.join(" · ")}</div>`;
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

    renderOrdersPanel();

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

          await apiAuth({
            action:"inventory_add_purchase_batch",
            items,
            updated_by: "PURCHASES_UI",
            source: "PURCHASES_UI"
          });

          if(msg) msg.textContent = "✅ Compra registrada. Actualizando inventario…";
          // recargar inventario y re-render
          const inv = await apiAuth({action:"inventory_get"});
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

  async function fetchCostsWithFallback(){
    // Worker nuevo: usar endpoint público que ya inyecta COSTS_SECRET.
    try{
      return await api({action:"costs_public_list"});
    }catch(_e1){
      // Compatibilidad con backend anterior.
      return await apiAuth({action:"costs_list"});
    }
  }

  async function fetchNeedsWithFallback(){
    try{
      const out = await apiAuth({action:"costs_orders_for_purchases"});
      return { out, source: "costs_orders_for_purchases" };
    }catch(primaryErr){
      try{
        const shopping = await apiAuth({action:"shopping_get"});
        const fallbackNeeds = shopping?.data?.needs || shopping?.needs || shopping?.data?.payload?.needs || {};
        const fallbackMeta = shopping?.data?.meta || shopping?.meta || {};
        return {
          out: {
            ok: true,
            needs: fallbackNeeds,
            meta: {
              ...fallbackMeta,
              source: "shopping_get"
            }
          },
          source: "shopping_get",
          warning: String(primaryErr?.message || primaryErr || "")
        };
      }catch(_fallbackErr){
        throw primaryErr;
      }
    }
  }

  async function refreshFromBackend(){
    if(!state.pin) throw new Error("Primero desbloquea con el PIN.");

    setErr("");
    if(netDebug) netDebug.style.display="none";

    const [needsPackOut, invOut, costsOut] = await Promise.all([
      fetchNeedsWithFallback(),
      apiAuth({action:"inventory_get"}),
      fetchCostsWithFallback(),
    ]);

    const needsOut = needsPackOut?.out || {};
    const needsPack = normalizeNeedsOut(needsOut || {});
    state.needs = needsPack.needs || {};
    state.orderMeta = needsPack.meta || null;
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
      const meta = state.orderMeta || needsOut.meta || {};
      netDebug.style.display="block";
      netDebug.textContent = "meta: " + JSON.stringify(meta);
      if(needsPackOut?.warning){
        netDebug.textContent += "\nwarning: fallback a shopping_get por error en costs_orders_for_purchases.";
      }
    }

    if(needsPackOut?.warning){
      setErr("Aviso: se usó fallback de compras (shopping_get) porque falló costs_orders_for_purchases.");
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
    if(state.isUnlocking) return;
    state.isUnlocking = true;

    setUnlockBusy(true);
    setLoading(true, "Desbloqueando compras...", "Estamos validando la clave y consultando pedidos e inventario.");

    try{
      const pin = String(secretInp?.value||"").trim();
      if(!pin) throw new Error("Ingresa la clave.");
      const authField = await detectAuthField(pin);
      state.pin = pin;
      state.authField = authField;
      setErr("");
      showEditor();
      await refreshFromBackend();
    }catch(e){
      hideEditor();
      setErr(String(e?.message||e));
    }finally{
      state.isUnlocking = false;
      setLoading(false);
      setUnlockBusy(false);
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
