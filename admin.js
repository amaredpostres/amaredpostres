const API_URL = "https://amared-orders.amaredpostres.workers.dev/";

const PRODUCT_CATALOG = [
  { id: "mousse_maracuya", name: "Mousse de Maracuyá", unit_price: 10000 },
  { id: "cheesecake_cafe_panela", name: "Cheesecake de café con panela", unit_price: 12500 },
];

let SESSION = { operator: null, pin: null };
let pendingOrdersCache = [];
let REQUEST_IN_FLIGHT = false;

// ===== DOM =====
const loginView = document.getElementById("loginView");
const panelView = document.getElementById("panelView");

const loginOperator = document.getElementById("loginOperator");
const loginPin = document.getElementById("loginPin");
const btnLogin = document.getElementById("btnLogin");
const loginError = document.getElementById("loginError");

const operatorName = document.getElementById("operatorName");
const btnLogout = document.getElementById("btnLogout");
const btnRefresh = document.getElementById("btnRefresh");

const statusEl = document.getElementById("status");
const listEl = document.getElementById("list");

// Modales
const payModal = document.getElementById("payModal");
const payTitle = document.getElementById("payTitle");
const payText = document.getElementById("payText");
const payMethod = document.getElementById("payMethod");
const payOtherWrap = document.getElementById("payOtherWrap");
const payOtherText = document.getElementById("payOtherText");
const payRef = document.getElementById("payRef");
const payTimer = document.getElementById("payTimer");
const btnPayBack = document.getElementById("btnPayBack");
const btnPayConfirm = document.getElementById("btnPayConfirm");

const cancelModal = document.getElementById("cancelModal");
const cancelTitle = document.getElementById("cancelTitle");
const cancelText = document.getElementById("cancelText");
const cancelReason = document.getElementById("cancelReason");
const cancelOtherWrap = document.getElementById("cancelOtherWrap");
const cancelOtherText = document.getElementById("cancelOtherText");
const cancelTimer = document.getElementById("cancelTimer");
const btnCancelBack = document.getElementById("btnCancelBack");
const btnCancelConfirm = document.getElementById("btnCancelConfirm");

// ===== Modal state =====
let modalOrder = null;
let payCountdownInt = null;
let cancelCountdownInt = null;
let payTimerStarted = false;
let cancelTimerStarted = false;

// ===== UI helpers =====
function setStatus(msg) { statusEl.textContent = msg || ""; }
function money(n) { return Math.round(Number(n || 0)).toLocaleString("es-CO"); }
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
function safeJsonParse(s){ try { return JSON.parse(s); } catch { return null; } }
function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}
function openModal(el){ el.classList.add("show"); el.setAttribute("aria-hidden","false"); }
function closeModal(el){ el.classList.remove("show"); el.setAttribute("aria-hidden","true"); }

// ===== API (con logs + retry 429) =====
async function api(body, retries = 2) {
  console.log("➡️ API request body:", body);

  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify(body)
  });

  console.log("⬅️ API status:", res.status);

  if (res.status === 429 && retries > 0) {
    await sleep(650 * (3 - retries));
    return api(body, retries - 1);
  }

  const out = await res.json().catch(async ()=>({ ok:false, error: await res.text().catch(()=> "") }));
  console.log("⬅️ API response JSON:", out);

  if (!out.ok) throw new Error(out.error || "Error");
  return out;
}

// ===== Login / Panel =====
function showPanel() {
  loginView.classList.add("hidden");
  panelView.classList.remove("hidden");
  operatorName.textContent = SESSION.operator || "";
}
function showLogin() {
  panelView.classList.add("hidden");
  loginView.classList.remove("hidden");
}

btnLogin.addEventListener("click", async () => {
  loginError.textContent = "";
  const operator = loginOperator.value.trim();
  const pin = loginPin.value.trim();
  if (!operator || !pin) { loginError.textContent = "Completa todos los campos."; return; }

  try {
    SESSION = { operator, pin };
    sessionStorage.setItem("AMARED_ADMIN", JSON.stringify(SESSION));
    showPanel();
    await loadPendientes();
  } catch (e) {
    SESSION = { operator:null, pin:null };
    sessionStorage.removeItem("AMARED_ADMIN");
    showLogin();
    loginError.textContent = "Error: " + String(e.message || e);
  }
});

btnLogout.addEventListener("click", () => {
  SESSION = { operator:null, pin:null };
  sessionStorage.removeItem("AMARED_ADMIN");
  showLogin();
});

btnRefresh.addEventListener("click", async () => {
  await loadPendientes(true);
});

// ===== Cargar pendientes =====
async function loadPendientes(fromRefresh=false) {
  if (REQUEST_IN_FLIGHT) return;
  REQUEST_IN_FLIGHT = true;

  try {
    setStatus(fromRefresh ? "Actualizando..." : "Cargando pedidos...");
    const out = await api({
      action: "list_orders",
      admin_pin: SESSION.pin,
      payment_status: "Pendiente"
    });

    pendingOrdersCache = out.orders || [];
    renderPendientes(pendingOrdersCache);
    setStatus(`${pendingOrdersCache.length} pedidos pendientes.`);
  } catch (e) {
    setStatus("❌ " + String(e.message || e));
    throw e;
  } finally {
    REQUEST_IN_FLIGHT = false;
  }
}

// ===== Render pendientes =====
function normalizeItemsFromOrder(order) {
  if (order.items_json) {
    const parsed = safeJsonParse(order.items_json);
    if (Array.isArray(parsed)) return parsed;
  }
  return [];
}

function renderPendientes(orders) {
  listEl.innerHTML = "";

  if (!orders.length) {
    listEl.innerHTML = `<div class="mutedSmall" style="text-align:center; padding:14px;">Sin pedidos.</div>`;
    return;
  }

  for (const o of orders) {
    const card = document.createElement("div");
    card.className = "orderItem";

    const items = normalizeItemsFromOrder(o);
    const lines = items.length
      ? items.map(it => `<div class="mutedSmall">• ${escapeHtml(it.name)} x${Number(it.qty||0)}</div>`).join("")
      : `<div class="mutedSmall">• ${escapeHtml(String(o.items||""))}</div>`;

    card.innerHTML = `
      <div class="orderHead">
        <div style="min-width:0;">
          <div class="orderId">#${escapeHtml(o.order_id)} <span class="badge">$${money(o.subtotal)}</span></div>
          <div class="orderMeta">${escapeHtml(o.customer_name)} • ${escapeHtml(String(o.created_at||""))}</div>
        </div>
      </div>

      <div class="orderBody" style="display:block;">
        <div><strong>Tel:</strong> ${escapeHtml(o.phone)}</div>
        <div><strong>Dirección:</strong> ${escapeHtml(o.address_text)}</div>
        <div style="margin-top:6px;"><strong>Items:</strong>${lines}</div>

        <div style="margin-top:12px; display:flex; gap:10px; flex-wrap:wrap;">
          <button class="btn btnDanger btnCancel" type="button">Cancelar Pedido</button>
          <button class="btn primary btnPay" type="button">Confirmar pago</button>
        </div>
      </div>
    `;

    card.querySelector(".btnCancel").addEventListener("click", () => openCancelModal(o));
    card.querySelector(".btnPay").addEventListener("click", () => openPayModal(o));

    listEl.appendChild(card);
  }
}

// ===== Modal Cancelar =====
cancelReason.addEventListener("change", () => {
  cancelOtherWrap.classList.toggle("hidden", cancelReason.value !== "Otro");
  resetCancelTimer();
  maybeStartCancelTimer();
});
cancelOtherText.addEventListener("input", () => { resetCancelTimer(); maybeStartCancelTimer(); });

btnCancelBack.addEventListener("click", () => closeCancelModal());

function openCancelModal(order) {
  modalOrder = order;
  cancelTitle.textContent = `Cancelar pedido #${order.order_id}`;
  cancelText.textContent = `${order.customer_name} • $${money(order.subtotal)}`;

  cancelReason.value = "";
  cancelOtherText.value = "";
  cancelOtherWrap.classList.add("hidden");

  btnCancelConfirm.disabled = true;
  cancelTimer.textContent = "Selecciona una razón para habilitar la cancelación.";
  cancelTimerStarted = false;
  stopCancelCountdown();

  openModal(cancelModal);
}

function closeCancelModal() {
  stopCancelCountdown();
  closeModal(cancelModal);
  modalOrder = null;
}

function isCancelValid() {
  if (!cancelReason.value) return false;
  if (cancelReason.value === "Otro" && !cancelOtherText.value.trim()) return false;
  return true;
}

function maybeStartCancelTimer() {
  if (!isCancelValid()) return;
  startCancelCountdown(2);
}

function resetCancelTimer() {
  if (!cancelTimerStarted) return;
  stopCancelCountdown();
  btnCancelConfirm.disabled = true;
  cancelTimer.textContent = "Selecciona una razón para habilitar la cancelación.";
  cancelTimerStarted = false;
}

function startCancelCountdown(seconds) {
  stopCancelCountdown();
  cancelTimerStarted = true;

  let t = seconds;
  btnCancelConfirm.disabled = true;
  cancelTimer.textContent = `Espera ${t}s para habilitar...`;

  cancelCountdownInt = setInterval(() => {
    t--;
    if (t <= 0) {
      stopCancelCountdown(false);
      cancelTimer.textContent = "Listo. Puedes cancelar ahora.";
      btnCancelConfirm.disabled = false;
    } else {
      cancelTimer.textContent = `Espera ${t}s para habilitar...`;
    }
  }, 1000);
}

function stopCancelCountdown(resetStarted=true) {
  if (cancelCountdownInt) clearInterval(cancelCountdownInt);
  cancelCountdownInt = null;
  if (resetStarted) cancelTimerStarted = false;
}

btnCancelConfirm.addEventListener("click", async () => {
  console.log("✅ CLICK CANCEL CONFIRM", { modalOrder });

  if (!modalOrder) { alert("No se detectó el pedido. Cierra y abre el modal."); return; }
  if (!isCancelValid()) { alert("Selecciona una razón válida."); return; }

  const reason = (cancelReason.value === "Otro") ? cancelOtherText.value.trim() : cancelReason.value;

  try {
    setStatus("Cancelando pedido...");
    console.log("➡️ ACTION cancel_order", { order_id: modalOrder.order_id, reason });

    await api({
      action: "cancel_order",
      admin_pin: SESSION.pin,
      operator: SESSION.operator,
      order_id: modalOrder.order_id,
      cancel_reason: reason
    });

    closeCancelModal();
    setStatus("✅ Pedido cancelado.");

    // Recargar lista (esto ya debe venir sin ese pedido si tu Apps Script cambió status)
    await loadPendientes(true);

  } catch (e) {
    setStatus("❌ " + String(e.message || e));
  }
});

// ===== Modal Pago =====
payMethod.addEventListener("change", () => {
  payOtherWrap.classList.toggle("hidden", payMethod.value !== "Otro");
  resetPayTimer();
  maybeStartPayTimer();
});
payOtherText.addEventListener("input", () => { resetPayTimer(); maybeStartPayTimer(); });
payRef.addEventListener("input", () => { resetPayTimer(); maybeStartPayTimer(); });

btnPayBack.addEventListener("click", () => closePayModal());

function openPayModal(order) {
  modalOrder = order;
  payTitle.textContent = `Confirmar pago #${order.order_id}`;
  payText.textContent = `${order.customer_name} • $${money(order.subtotal)}`;

  payMethod.value = "";
  payOtherText.value = "";
  payOtherWrap.classList.add("hidden");
  payRef.value = "";

  btnPayConfirm.disabled = true;
  payTimer.textContent = "Completa método y referencia.";
  payTimerStarted = false;
  stopPayCountdown();

  openModal(payModal);
}

function closePayModal() {
  stopPayCountdown();
  closeModal(payModal);
  modalOrder = null;
}

function isPayValid() {
  if (!payMethod.value) return false;
  if (payMethod.value === "Otro" && !payOtherText.value.trim()) return false;
  if (!payRef.value.trim()) return false;
  return true;
}

function maybeStartPayTimer() {
  if (!isPayValid()) return;
  startPayCountdown(2);
}

function resetPayTimer() {
  if (!payTimerStarted) return;
  stopPayCountdown();
  btnPayConfirm.disabled = true;
  payTimer.textContent = "Completa método y referencia.";
  payTimerStarted = false;
}

function startPayCountdown(seconds) {
  stopPayCountdown();
  payTimerStarted = true;

  let t = seconds;
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

function stopPayCountdown(resetStarted=true) {
  if (payCountdownInt) clearInterval(payCountdownInt);
  payCountdownInt = null;
  if (resetStarted) payTimerStarted = false;
}

btnPayConfirm.addEventListener("click", async () => {
  console.log("✅ CLICK PAY CONFIRM", { modalOrder });

  if (!modalOrder) { alert("No se detectó el pedido. Cierra y abre el modal."); return; }
  if (!isPayValid()) { alert("Completa método de pago y referencia."); return; }

  const method = (payMethod.value === "Otro") ? payOtherText.value.trim() : payMethod.value;
  const ref = payRef.value.trim();

  try {
    setStatus("Confirmando pago...");
    console.log("➡️ ACTION confirm_payment", { order_id: modalOrder.order_id, method, ref });

    await api({
      action: "confirm_payment", // el Worker lo traduce a mark_paid
      admin_pin: SESSION.pin,
      operator: SESSION.operator,
      order_id: modalOrder.order_id,
      payment_method: method,
      payment_ref: ref
    });

    closePayModal();
    setStatus("✅ Pago confirmado.");

    await loadPendientes(true);

  } catch (e) {
    setStatus("❌ " + String(e.message || e));
  }
});

// ===== INIT =====
(function init() {
  const saved = sessionStorage.getItem("AMARED_ADMIN");
  if (saved) {
    try {
      SESSION = JSON.parse(saved);
      if (SESSION?.operator && SESSION?.pin) {
        showPanel();
        loadPendientes().catch(() => {
          SESSION = { operator:null, pin:null };
          sessionStorage.removeItem("AMARED_ADMIN");
          showLogin();
        });
      }
    } catch {}
  }
})();
