const API_URL = "https://amared-orders.amaredpostres.workers.dev/";

// Catálogo de productos (siempre visibles en edición)
const PRODUCT_CATALOG = [
  { id: "mousse_maracuya", name: "Mousse de Maracuyá", unit_price: 10000 },
  { id: "cheesecake_cafe_panela", name: "Cheesecake de café con panela", unit_price: 12500 },
];

let SESSION = { operator: null, pin: null };

// ===== Control requests / loading =====
let REQUEST_IN_FLIGHT = false;     // evita dobles llamadas list_orders
let LOADING_COUNT = 0;             // permite showLoading anidado sin bloquear

// Historial cache
let HIST_CACHE = null;
let HIST_CACHE_TIME = 0;
const HIST_TTL = 60 * 1000; // 60s

// UI state
let histFilter = "ALL";
let pendingOrdersCache = [];

// ===== DOM =====
const loginView = document.getElementById("loginView");
const panelView = document.getElementById("panelView");

const loginOperator = document.getElementById("loginOperator");
const loginPin = document.getElementById("loginPin");
const btnLogin = document.getElementById("btnLogin");
const loginError = document.getElementById("loginError");

const operatorName = document.getElementById("operatorName");
const btnLogout = document.getElementById('btnLogout');

const statusBadge = document.getElementById("statusBadge");
const ordersList = document.getElementById("ordersList");
const btnRefresh = document.getElementById("btnRefresh");

const btnHistory = document.getElementById("btnHistory");
const btnCloseHistory = document.getElementById("btnCloseHistory");
const historyDrawer = document.getElementById("historyDrawer");
const historyList = document.getElementById("historyList");
const histChips = document.querySelectorAll(".chip");

const modal = document.getElementById("orderModal");
const modalBody = document.getElementById("modalBody");
const modalClose = document.getElementById("modalClose");

const btnMarkPaid = document.getElementById("btnMarkPaid");
const btnCancelOrder = document.getElementById("btnCancelOrder");
const btnEditOrder = document.getElementById("btnEditOrder");

const modalNotice = document.getElementById("modalNotice");

// Pago modal elements
const payModal = document.getElementById("payModal");
const payModalClose = document.getElementById("payModalClose");
const btnPayConfirm = document.getElementById("btnPayConfirm");
const payMethod = document.getElementById("payMethod");
const payRef = document.getElementById("payRef");
const payTimer = document.getElementById("payTimer");

// Cancel modal elements
const cancelModal = document.getElementById("cancelModal");
const cancelModalClose = document.getElementById("cancelModalClose");
const btnCancelConfirm = document.getElementById("btnCancelConfirm");
const cancelReason = document.getElementById("cancelReason");
const cancelTimer = document.getElementById("cancelTimer");

// Edit modal elements
const editModal = document.getElementById("editModal");
const editModalClose = document.getElementById("editModalClose");
const btnEditConfirm = document.getElementById("btnEditConfirm");
const editItemsContainer = document.getElementById("editItemsContainer");
const editNotes = document.getElementById("editNotes");
const editAddress = document.getElementById("editAddress");
const editMapsLink = document.getElementById("editMapsLink");

// ===== Helpers =====
function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

function showLoading(msg="Cargando..."){
  LOADING_COUNT++;
  statusBadge.textContent = msg;
  statusBadge.className = "badge badge-loading";
}
function hideLoading(){
  LOADING_COUNT = Math.max(0, LOADING_COUNT - 1);
  if(LOADING_COUNT===0){
    statusBadge.textContent = "Listo";
    statusBadge.className = "badge badge-ok";
  }
}
function setStatus(msg, type="ok"){
  statusBadge.textContent = msg;
  statusBadge.className = `badge badge-${type}`;
}

function showError(el, msg){
  el.textContent = msg;
  el.style.display = "block";
}
function clearError(el){
  el.textContent = "";
  el.style.display = "none";
}

function parseItems(itemsStr){
  // items se guarda como: "Mousse de Maracuyá x2 | Cheesecake de café con panela x1"
  const parts = (itemsStr || "").split("|").map(s=>s.trim()).filter(Boolean);
  const out = [];
  for(const p of parts){
    const m = p.match(/(.+?)\s*x\s*(\d+)/i);
    if(m){
      out.push({ name: m[1].trim(), qty: parseInt(m[2],10) });
    }else{
      out.push({ name: p, qty: 1 });
    }
  }
  return out;
}

function formatMoney(n){
  try{
    return new Intl.NumberFormat("es-CO", { style:"currency", currency:"COP", maximumFractionDigits:0 }).format(Number(n)||0);
  }catch{
    return `$${Number(n)||0}`;
  }
}

function safeText(v){
  return (v===null || v===undefined) ? "" : String(v);
}

function buildWA(items, total, name, phone, address, maps, notes){
  const lines = [];
  lines.push("Hola AMARED 👋");
  lines.push(`Soy *${name}* (${phone}).`);
  lines.push("");
  lines.push("🧁 *Pedido:*");
  for(const it of items){
    lines.push(`- ${it.name} x${it.qty}`);
  }
  lines.push("");
  lines.push(`💰 *Total:* ${formatMoney(total)}`);
  lines.push("");
  lines.push(`📍 *Dirección:* ${address || "—"}`);
  if(maps) lines.push(`🗺️ *Ubicación:* ${maps}`);
  if(notes) lines.push(`📝 *Notas:* ${notes}`);
  return encodeURIComponent(lines.join("\n"));
}

// ===== API =====
// NOTA: el Worker tiene rate-limit (~1 request / 5s por IP). Si recibimos 429, esperamos >5s antes de reintentar.
async function api(body, retries = 2) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify(body)
  });

  if (res.status === 429 && retries > 0) {
    // El Worker aplica rate-limit (~1 request / 5s por IP). Espera un poco más para no rebotar en 429.
    const waitMs = 5200 * (3 - retries); // 5200ms, 10400ms
    await sleep(waitMs);
    return api(body, retries - 1);
  }

  const out = await res.json().catch(async ()=>({ ok:false, error: await res.text() }));
  if (!out.ok) throw new Error(out.error || "Error");
  return out;
}

// ===== Login =====
btnLogin?.addEventListener("click", async ()=>{
  clearError(loginError);
  const operator = loginOperator.value.trim();
  const pin = loginPin.value.trim();
  if(!operator || !pin){
    showError(loginError, "Completa operador y PIN.");
    return;
  }
  showLoading("Validando...");
  try{
    const out = await api({ action:"admin_login", operator, admin_pin: pin });
    SESSION.operator = operator;
    SESSION.pin = pin;

    operatorName.textContent = operator;
    loginView.style.display = "none";
    panelView.style.display = "block";

    setStatus("Listo", "ok");
    await loadPendingOrders(true);
  }catch(err){
    showError(loginError, err.message || "Error");
    setStatus("Error", "err");
  }finally{
    hideLoading();
  }
});

btnLogout?.addEventListener("click", ()=>{
  SESSION = { operator:null, pin:null };
  panelView.style.display = "none";
  loginView.style.display = "block";
  ordersList.innerHTML = "";
  setStatus("Sesión cerrada", "ok");
});

// ===== Orders list =====
btnRefresh?.addEventListener("click", ()=>{
  loadPendingOrders(true);
});

async function loadPendingOrders(force=false){
  if(REQUEST_IN_FLIGHT && !force) return;
  REQUEST_IN_FLIGHT = true;
  showLoading("Cargando pedidos...");
  setStatus("Cargando pendientes...");

  try{
    const out = await api({
      action: "list_orders",
      admin_pin: SESSION.pin,
      payment_status: "Pendiente"
    });

    pendingOrdersCache = Array.isArray(out.orders) ? out.orders : [];
    renderPendingOrders(pendingOrdersCache);
    setStatus(`Pendientes: ${pendingOrdersCache.length}`, "ok");
  }catch(err){
    setStatus(err.message || "Error cargando", "err");
  }finally{
    hideLoading();
    REQUEST_IN_FLIGHT = false;
  }
}

function renderPendingOrders(list){
  ordersList.innerHTML = "";
  if(!list || list.length===0){
    ordersList.innerHTML = `<div class="empty">No hay pedidos pendientes.</div>`;
    return;
  }

  for(const o of list){
    const card = document.createElement("div");
    card.className = "order-card";
    card.innerHTML = `
      <div class="order-top">
        <div class="order-id">${safeText(o.order_id)}</div>
        <div class="order-total">${formatMoney(o.subtotal || o.total || o.total_amount || o.total_value || o.total_price || o.total_units || o.total)}</div>
      </div>
      <div class="order-meta">
        <div><b>${safeText(o.customer_name)}</b> · ${safeText(o.phone)}</div>
        <div class="muted">${safeText(o.address_text)}</div>
        <div class="muted">${safeText(o.created_at || o.order_date || "")}</div>
      </div>
      <div class="order-actions">
        <button class="btn btn-soft" data-open="${safeText(o.order_id)}">Ver</button>
        <button class="btn btn-primary" data-paid="${safeText(o.order_id)}">Pagar</button>
        <button class="btn btn-danger" data-cancel="${safeText(o.order_id)}">Cancelar</button>
      </div>
    `;

    ordersList.appendChild(card);

    card.querySelector('[data-open]')?.addEventListener("click", ()=> openOrderModal(o.order_id));
    card.querySelector('[data-paid]')?.addEventListener("click", ()=> openPayFlow(o.order_id));
    card.querySelector('[data-cancel]')?.addEventListener("click", ()=> openCancelFlow(o.order_id));
  }
}

// ===== Modal (ver pedido) =====
let modalOrder = null;

function openOrderModal(orderId){
  modalOrder = pendingOrdersCache.find(x=>x.order_id===orderId) || null;
  if(!modalOrder) return;

  const items = parseItems(modalOrder.items);
  const itemsHtml = items.map(it=>`<li>${safeText(it.name)} <b>x${it.qty}</b></li>`).join("");

  const waMsg = buildWA(
    items,
    modalOrder.subtotal || modalOrder.total || 0,
    modalOrder.customer_name || "",
    modalOrder.phone || "",
    modalOrder.address_text || "",
    modalOrder.maps_link || "",
    modalOrder.notes || ""
  );

  modalBody.innerHTML = `
    <div class="modal-section">
      <div class="row"><span class="muted">Pedido</span><b>${safeText(modalOrder.order_id)}</b></div>
      <div class="row"><span class="muted">Cliente</span><b>${safeText(modalOrder.customer_name)}</b></div>
      <div class="row"><span class="muted">Teléfono</span><b>${safeText(modalOrder.phone)}</b></div>
      <div class="row"><span class="muted">Dirección</span><b>${safeText(modalOrder.address_text)}</b></div>
      ${modalOrder.maps_link ? `<div class="row"><span class="muted">Maps</span><a target="_blank" href="${safeText(modalOrder.maps_link)}">Abrir</a></div>` : ""}
      ${modalOrder.email ? `<div class="row"><span class="muted">Email</span><b>${safeText(modalOrder.email)}</b></div>` : ""}
      ${modalOrder.wa_opt_in ? `<div class="row"><span class="muted">Opt-in WhatsApp</span><b>${safeText(modalOrder.wa_opt_in)}</b></div>` : ""}
    </div>

    <div class="modal-section">
      <div class="muted">Items</div>
      <ul class="items">${itemsHtml}</ul>
      <div class="row total"><span>Total</span><b>${formatMoney(modalOrder.subtotal || modalOrder.total || 0)}</b></div>
      ${modalOrder.notes ? `<div class="notes"><b>Notas:</b> ${safeText(modalOrder.notes)}</div>` : ""}
    </div>

    <div class="modal-section">
      <a class="btn btn-soft w100" target="_blank" href="https://wa.me/?text=${waMsg}">Abrir WhatsApp (mensaje)</a>
    </div>
  `;

  modal.style.display = "flex";
  modalNotice.textContent = "";
}

modalClose?.addEventListener("click", ()=>{ modal.style.display="none"; });
modal?.addEventListener("click", (e)=>{ if(e.target===modal) modal.style.display="none"; });

// ===== Pago flow =====
let payCountdownInt = null;
function stopPayCountdown(clearText=true){
  if(payCountdownInt){ clearInterval(payCountdownInt); payCountdownInt=null; }
  if(clearText) payTimer.textContent = "";
}

function openPayFlow(orderId){
  modalOrder = pendingOrdersCache.find(x=>x.order_id===orderId) || null;
  if(!modalOrder) return;

  payMethod.value = "Transferencia";
  payRef.value = "";
  payModal.style.display = "flex";

  // bloqueo 5s (reduce doble click + respeta rate limit)
  let t = 5;
  stopPayCountdown(false);
  btnPayConfirm.disabled = true;
  payTimer.textContent = `Espera ${t}s para habilitar...`;

  payCountdownInt = setInterval(() => {
    t--;
    if (t <= 0) {
      stopPayCountdown(false);
      payTimer.textContent = "Listo. Puedes confirmar ahora.";
      btnPayConfirm.disabled = false;
    } else {
      payTimer.textContent = `Espera ${t}s para habilitar...`;
    }
  }, 1000);
}

payModalClose?.addEventListener("click", ()=>{
  payModal.style.display="none";
  stopPayCountdown(true);
});
payModal?.addEventListener("click", (e)=>{
  if(e.target===payModal){
    payModal.style.display="none";
    stopPayCountdown(true);
  }
});

btnPayConfirm?.addEventListener("click", async ()=>{
  if(!modalOrder) return;

  const finalMethod = payMethod.value.trim() || "Transferencia";
  const finalRef = payRef.value.trim() || "";

  btnPayConfirm.disabled = true;
  showLoading("Confirmando pago...");
  try{
    // ✅ FIX: la acción correcta es "mark_paid" (no "confirm_payment")
    await api({
      action: "mark_paid",
      admin_pin: SESSION.pin,
      operator: SESSION.operator,
      order_id: modalOrder.order_id,
      payment_method: finalMethod,
      payment_ref: finalRef
    });

    payModal.style.display = "none";
    stopPayCountdown(true);

    modalNotice.textContent = "✅ Pago confirmado.";
    setStatus("Pago confirmado", "ok");

    // refresca lista (una sola vez)
    await loadPendingOrders(true);
  }catch(err){
    modalNotice.textContent = `❌ ${err.message || "Error al confirmar"}`;
    setStatus("Error confirmando", "err");
  }finally{
    hideLoading();
    btnPayConfirm.disabled = false;
  }
});

// ===== Cancel flow =====
let cancelCountdownInt = null;
function stopCancelCountdown(clearText=true){
  if(cancelCountdownInt){ clearInterval(cancelCountdownInt); cancelCountdownInt=null; }
  if(clearText) cancelTimer.textContent = "";
}

function openCancelFlow(orderId){
  modalOrder = pendingOrdersCache.find(x=>x.order_id===orderId) || null;
  if(!modalOrder) return;

  cancelReason.value = "";
  cancelModal.style.display = "flex";

  // bloqueo 5s (reduce doble click + respeta rate limit)
  let t = 5;
  stopCancelCountdown(false);
  btnCancelConfirm.disabled = true;
  cancelTimer.textContent = `Espera ${t}s para habilitar...`;

  cancelCountdownInt = setInterval(() => {
    t--;
    if (t <= 0) {
      stopCancelCountdown(false);
      cancelTimer.textContent = "Listo. Puedes confirmar ahora.";
      btnCancelConfirm.disabled = false;
    } else {
      cancelTimer.textContent = `Espera ${t}s para habilitar...`;
    }
  }, 1000);
}

cancelModalClose?.addEventListener("click", ()=>{
  cancelModal.style.display="none";
  stopCancelCountdown(true);
});
cancelModal?.addEventListener("click", (e)=>{
  if(e.target===cancelModal){
    cancelModal.style.display="none";
    stopCancelCountdown(true);
  }
});

btnCancelConfirm?.addEventListener("click", async ()=>{
  if(!modalOrder) return;

  const reason = cancelReason.value.trim() || "Sin razón";

  btnCancelConfirm.disabled = true;
  showLoading("Cancelando pedido...");
  try{
    await api({
      action: "cancel_order",
      admin_pin: SESSION.pin,
      operator: SESSION.operator,
      order_id: modalOrder.order_id,
      reason
    });

    cancelModal.style.display = "none";
    stopCancelCountdown(true);

    modalNotice.textContent = "✅ Pedido cancelado.";
    setStatus("Pedido cancelado", "ok");

    // refresca lista
    await loadPendingOrders(true);
  }catch(err){
    modalNotice.textContent = `❌ ${err.message || "Error al cancelar"}`;
    setStatus("Error cancelando", "err");
  }finally{
    hideLoading();
    btnCancelConfirm.disabled = false;
  }
});

// ===== Edit flow (UI existente; persistencia depende del backend) =====
let editDraft = null;

function openEditFlow(orderId){
  modalOrder = pendingOrdersCache.find(x=>x.order_id===orderId) || null;
  if(!modalOrder) return;

  // draft base
  editDraft = {
    order_id: modalOrder.order_id,
    notes: modalOrder.notes || "",
    address_text: modalOrder.address_text || "",
    maps_link: modalOrder.maps_link || "",
    items: parseItems(modalOrder.items)
  };

  renderEditItems(editDraft.items);
  editNotes.value = editDraft.notes;
  editAddress.value = editDraft.address_text;
  editMapsLink.value = editDraft.maps_link;

  editModal.style.display = "flex";
}

function renderEditItems(items){
  editItemsContainer.innerHTML = "";

  // Siempre mostrar catálogo completo (para agregar)
  for(const p of PRODUCT_CATALOG){
    const existing = items.find(i => i.name.toLowerCase() === p.name.toLowerCase());
    const qty = existing ? existing.qty : 0;

    const row = document.createElement("div");
    row.className = "edit-item-row";
    row.innerHTML = `
      <div class="edit-item-name">${p.name}</div>
      <div class="edit-item-qty">
        <button class="btn btn-soft" data-dec>-</button>
        <span class="qty">${qty}</span>
        <button class="btn btn-soft" data-inc>+</button>
      </div>
    `;
    const qtyEl = row.querySelector(".qty");
    row.querySelector("[data-dec]")?.addEventListener("click", ()=>{
      const current = Number(qtyEl.textContent)||0;
      const next = Math.max(0, current - 1);
      qtyEl.textContent = String(next);
      applyEditQty(p.name, next);
    });
    row.querySelector("[data-inc]")?.addEventListener("click", ()=>{
      const current = Number(qtyEl.textContent)||0;
      const next = current + 1;
      qtyEl.textContent = String(next);
      applyEditQty(p.name, next);
    });

    editItemsContainer.appendChild(row);
  }
}

function applyEditQty(name, qty){
  if(!editDraft) return;
  const idx = editDraft.items.findIndex(i => i.name.toLowerCase() === name.toLowerCase());
  if(qty<=0){
    if(idx>=0) editDraft.items.splice(idx,1);
  }else{
    if(idx>=0) editDraft.items[idx].qty = qty;
    else editDraft.items.push({ name, qty });
  }
}

editModalClose?.addEventListener("click", ()=>{
  editModal.style.display="none";
  editDraft = null;
});
editModal?.addEventListener("click", (e)=>{
  if(e.target===editModal){
    editModal.style.display="none";
    editDraft = null;
  }
});

btnEditOrder?.addEventListener("click", ()=>{
  if(modalOrder) openEditFlow(modalOrder.order_id);
});

btnEditConfirm?.addEventListener("click", async ()=>{
  if(!editDraft) return;

  editDraft.notes = editNotes.value.trim();
  editDraft.address_text = editAddress.value.trim();
  editDraft.maps_link = editMapsLink.value.trim();

  // Construir items string igual formato original
  const itemsStr = editDraft.items
    .map(i => `${i.name} x${i.qty}`)
    .join(" | ");

  showLoading("Guardando cambios...");
  try{
    // IMPORTANTE: Este endpoint debe existir en tu Apps Script / Worker si quieres persistir.
    // Si aún no lo implementaste, este bloque seguirá fallando con "Invalid action".
    await api({
      action: "update_order",
      admin_pin: SESSION.pin,
      operator: SESSION.operator,
      order_id: editDraft.order_id,
      items: itemsStr,
      notes: editDraft.notes,
      address_text: editDraft.address_text,
      maps_link: editDraft.maps_link
    });

    editModal.style.display="none";
    editDraft = null;

    modalNotice.textContent = "✅ Cambios guardados.";
    setStatus("Cambios guardados", "ok");

    await loadPendingOrders(true);
  }catch(err){
    modalNotice.textContent = `❌ ${err.message || "Error guardando"}`;
    setStatus("Error guardando", "err");
  }finally{
    hideLoading();
  }
});

// ===== Botones del modal principal =====
btnMarkPaid?.addEventListener("click", ()=>{
  if(modalOrder) openPayFlow(modalOrder.order_id);
});
btnCancelOrder?.addEventListener("click", ()=>{
  if(modalOrder) openCancelFlow(modalOrder.order_id);
});

// ===== History drawer =====
btnHistory?.addEventListener("click", ()=> openHistoryDrawer());
btnCloseHistory?.addEventListener("click", ()=> closeHistoryDrawer());

function openHistoryDrawer(){
  historyDrawer.classList.add("open");
  loadHistory(true);
}
function closeHistoryDrawer(){
  historyDrawer.classList.remove("open");
}

histChips?.forEach(chip=>{
  chip.addEventListener("click", ()=>{
    histChips.forEach(c=>c.classList.remove("active"));
    chip.classList.add("active");
    histFilter = chip.dataset.filter || "ALL";
    renderHistory(HIST_CACHE || []);
  });
});

async function loadHistory(force=false){
  const now = Date.now();
  if(!force && HIST_CACHE && (now - HIST_CACHE_TIME) < HIST_TTL){
    renderHistory(HIST_CACHE);
    return;
  }

  showLoading("Cargando historial...");
  try{
    const out = await api({
      action: "history",
      admin_pin: SESSION.pin
    });

    HIST_CACHE = Array.isArray(out.orders) ? out.orders : [];
    HIST_CACHE_TIME = now;
    renderHistory(HIST_CACHE);
  }catch(err){
    historyList.innerHTML = `<div class="empty">Error: ${safeText(err.message)}</div>`;
  }finally{
    hideLoading();
  }
}

function renderHistory(list){
  let filtered = list || [];
  if(histFilter==="PAID") filtered = filtered.filter(o=> (o.payment_status||"").toLowerCase()==="pagado");
  if(histFilter==="CANCEL") filtered = filtered.filter(o=> (o.payment_status||"").toLowerCase()==="cancelado");

  historyList.innerHTML = "";
  if(!filtered || filtered.length===0){
    historyList.innerHTML = `<div class="empty">No hay registros.</div>`;
    return;
  }

  for(const o of filtered){
    const card = document.createElement("div");
    card.className = "order-card";
    card.innerHTML = `
      <div class="order-top">
        <div class="order-id">${safeText(o.order_id)}</div>
        <div class="order-total">${formatMoney(o.subtotal || o.total || 0)}</div>
      </div>
      <div class="order-meta">
        <div><b>${safeText(o.customer_name)}</b> · ${safeText(o.phone)}</div>
        <div class="muted">${safeText(o.payment_status)}</div>
        <div class="muted">${safeText(o.created_at || o.order_date || "")}</div>
      </div>
    `;
    historyList.appendChild(card);
  }
}

// ===== Inicial =====
setStatus("Ingresa para comenzar", "ok");
clearError(loginError);
