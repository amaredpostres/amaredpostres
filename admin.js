const API_URL = "https://amared-orders.amaredpostres.workers.dev/";

/**
 * Catálogo mínimo para poder editar items incluso si items_json no existe.
 * Ajusta ids/nombres si tus productos tienen otros ids.
 */
const PRODUCT_CATALOG = [
  { id: "mousse_maracuya", name: "Mousse de Maracuyá", unit_price: 10000 },
  { id: "cheesecake_cafe_panela", name: "Cheesecake de café con panela", unit_price: 12500 },
];

// Métodos de pago
const PAYMENT_METHODS = ["Nequi","Daviplata","Bancolombia","Davivienda","Efectivo","Otro"];

let SESSION = { operator: null, pin: null, tab: "Pendiente" };

/* ===== DOM ===== */
const loginView = document.getElementById("loginView");
const panelView = document.getElementById("panelView");

const loginOperator = document.getElementById("loginOperator");
const loginPin = document.getElementById("loginPin");
const btnLogin = document.getElementById("btnLogin");
const loginError = document.getElementById("loginError");

const operatorName = document.getElementById("operatorName");
const btnLogout = document.getElementById("btnLogout");

const listEl = document.getElementById("list");
const statusEl = document.getElementById("status");

const confirmOverlay = document.getElementById("confirmOverlay");
const confirmTitle = document.getElementById("confirmTitle");
const confirmText = document.getElementById("confirmText");
const confirmTimer = document.getElementById("confirmTimer");
const btnCancelModal = document.getElementById("btnCancelModal");
const btnConfirmModal = document.getElementById("btnConfirmModal");

let modalAction = null;
let countdownInt = null;

/* ===== UTILS ===== */
function setStatus(msg) { statusEl.textContent = msg || ""; }
function money(n) { return Math.round(Number(n || 0)).toLocaleString("es-CO"); }

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

async function api(body) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const out = await res.json().catch(async () => ({ ok:false, error: await res.text() }));
  if (!out.ok) throw new Error(out.error || "Error");
  return out;
}

/* ===== LOGIN ===== */
btnLogin.addEventListener("click", async () => {
  loginError.textContent = "";

  const operator = loginOperator.value.trim();
  const pin = loginPin.value.trim();

  if (!operator || !pin) {
    loginError.textContent = "Completa todos los campos.";
    return;
  }

  try {
    // Validamos PIN con una acción admin (listar pendientes)
    await api({ action: "list_orders", admin_pin: pin, payment_status: "Pendiente" });

    SESSION.operator = operator;
    SESSION.pin = pin;
    sessionStorage.setItem("AMARED_ADMIN", JSON.stringify(SESSION));

    showPanel();
    await loadTab("Pendiente");
  } catch {
    loginError.textContent = "PIN incorrecto.";
  }
});

function showPanel() {
  loginView.classList.add("hidden");
  panelView.classList.remove("hidden");
  operatorName.textContent = SESSION.operator;
}

function showLogin() {
  panelView.classList.add("hidden");
  loginView.classList.remove("hidden");
  sessionStorage.removeItem("AMARED_ADMIN");
}

/* ===== LOGOUT ===== */
btnLogout.addEventListener("click", () => {
  SESSION = { operator: null, pin: null, tab: "Pendiente" };
  showLogin();
});

/* ===== TABS ===== */
document.querySelectorAll(".tabBtn").forEach(btn => {
  btn.addEventListener("click", async () => {
    document.querySelectorAll(".tabBtn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    await loadTab(btn.dataset.tab);
  });
});

/* ===== ITEMS PARSE / BUILD ===== */
function parseItemsFromOrder(order) {
  // 1) Prefer items_json (ideal)
  if (order.items_json) {
    const parsed = safeJsonParse(order.items_json);
    if (Array.isArray(parsed)) {
      return parsed.map(it => ({
        id: String(it.id || ""),
        name: String(it.name || ""),
        qty: Number(it.qty || 0),
        unit_price: Number(it.unit_price || it.price || 0),
      })).filter(it => it.qty > 0 && it.name);
    }
  }

  // 2) Fallback: parse from items text: "- Nombre: 2"
  if (order.items) {
    const lines = String(order.items).split("\n").map(s => s.trim()).filter(Boolean);
    const found = [];
    for (const line of lines) {
      const m = line.replace(/^-+\s*/, "").match(/^(.+?)\s*:\s*(\d+)/);
      if (!m) continue;
      const name = m[1].trim();
      const qty = Number(m[2]);
      // match catalog by includes
      const cat = PRODUCT_CATALOG.find(p => name.toLowerCase().includes(p.name.toLowerCase().slice(0, 10)));
      found.push({
        id: cat?.id || name.toLowerCase().replace(/\s+/g, "_"),
        name,
        qty,
        unit_price: cat?.unit_price || 0
      });
    }
    return found.filter(it => it.qty > 0);
  }

  return [];
}

function calcTotals(items) {
  const total_units = items.reduce((s,it) => s + Number(it.qty || 0), 0);
  const subtotal = items.reduce((s,it) => s + Number(it.qty || 0) * Number(it.unit_price || 0), 0);
  return { total_units, subtotal };
}

/* ===== LIST LOAD / RENDER ===== */
async function loadTab(tab) {
  SESSION.tab = tab;
  sessionStorage.setItem("AMARED_ADMIN", JSON.stringify(SESSION));

  setStatus("Cargando pedidos...");
  const out = await api({
    action: "list_orders",
    admin_pin: SESSION.pin,
    payment_status: tab
  });

  renderList(out.orders || []);
  setStatus(`${(out.orders || []).length} pedidos en ${tab}.`);
}

function renderList(orders) {
  listEl.innerHTML = "";

  if (!orders.length) {
    listEl.innerHTML = `<div class="mutedSmall">No hay pedidos.</div>`;
    return;
  }

  orders.forEach(order => {
    const card = document.createElement("div");
    card.className = "orderItem";

    const head = document.createElement("div");
    head.className = "orderHead";

    head.innerHTML = `
      <div style="min-width:0;">
        <div class="orderId">
          ${order.order_id} <span class="badge">$${money(order.subtotal)}</span>
        </div>
        <div class="orderMeta">${order.customer_name} • ${formatDate(order.created_at)}</div>
      </div>
      <div class="chev">›</div>
    `;

    const body = document.createElement("div");
    body.className = "orderBody";
    body.appendChild(renderDetail(order));

    head.addEventListener("click", () => {
      const open = card.classList.toggle("open");
      head.querySelector(".chev").textContent = open ? "⌄" : "›";
    });

    card.appendChild(head);
    card.appendChild(body);
    listEl.appendChild(card);
  });
}

function formatDate(v) {
  const s = String(v || "").trim();
  // Si viene ISO, lo dejamos corto
  if (s.includes("T")) return s.replace(".000Z","").replace("T"," ");
  return s;
}

/* ===== DETAIL VIEW (expand) ===== */
function renderDetail(order) {
  const wrap = document.createElement("div");
  const editable = (SESSION.tab === "Pendiente");

  const items = parseItemsFromOrder(order);
  const totals = calcTotals(items);

  // Si items_json no existe, igual mostramos items; para editar con buen cálculo,
  // ideal que tu webhook llene items_json en Sheets.
  const hasUnitPrices = items.every(it => Number(it.unit_price) > 0);

  const itemsListHtml = items.length
    ? items.map((it, idx) => `
        <div class="grid2" style="align-items:end; margin-bottom:10px;">
          <div class="field" style="margin:0;">
            <label>${escapeHtml(it.name)}</label>
            <div class="mutedSmall">${it.unit_price ? `$${money(it.unit_price)} c/u` : "Precio no disponible"}</div>
          </div>
          <div class="field" style="margin:0;">
            <label>Cantidad</label>
            <input class="input itemQty" type="number" min="0" step="1" data-idx="${idx}" value="${it.qty}" ${editable ? "" : "disabled"}>
          </div>
        </div>
      `).join("")
    : `<div class="mutedSmall">No se encontraron ítems en este pedido.</div>`;

  wrap.innerHTML = `
    <div class="grid2">
      <div class="field">
        <label>Nombre</label>
        <input class="input f_name" ${editable ? "" : "disabled"} value="${escapeAttr(order.customer_name || "")}">
      </div>
      <div class="field">
        <label>Teléfono</label>
        <input class="input f_phone" ${editable ? "" : "disabled"} value="${escapeAttr(order.phone || "")}">
      </div>
    </div>

    <div class="field" style="margin-top:10px;">
      <label>Dirección</label>
      <input class="input f_address" ${editable ? "" : "disabled"} value="${escapeAttr(order.address_text || "")}">
    </div>

    <div class="field" style="margin-top:10px;">
      <label>Ubicación (maps_link o WHATSAPP)</label>
      <input class="input f_maps" ${editable ? "" : "disabled"} value="${escapeAttr(order.maps_link || "")}">
    </div>

    <div class="field" style="margin-top:10px;">
      <label>Notas</label>
      <textarea class="textarea f_notes" rows="3" ${editable ? "" : "disabled"}>${escapeHtml(order.notes || "")}</textarea>
    </div>

    <div class="hr"></div>

    <div class="mutedSmall" style="font-weight:950; margin-bottom:6px;">Ítems</div>
    ${itemsListHtml}

    <div class="mutedSmall" style="margin-top:8px;">
      Unidades: <strong>${totals.total_units}</strong> • Subtotal estimado: <strong>$${money(totals.subtotal)}</strong>
      ${!hasUnitPrices ? `<div class="mutedSmall" style="margin-top:6px;">⚠️ Para recalcular con exactitud, se recomienda que el webhook guarde <strong>items_json</strong> con precios.</div>` : ""}
    </div>

    ${
      editable ? `
      <div class="hr"></div>

      <div class="grid2">
        <div class="field">
          <label>Método de pago</label>
          <select class="input f_method">
            ${PAYMENT_METHODS.map(m => `<option value="${m}">${m}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label>Referencia (texto)</label>
          <input class="input f_ref" placeholder="Ej: Ref 983274 / últimos 4 dígitos">
        </div>
      </div>

      <div class="field" style="margin-top:10px;">
        <label>Razón de cancelación</label>
        <select class="input f_cancel_reason">
          <option value="Cliente canceló">Cliente canceló</option>
          <option value="Cliente se equivocó">Cliente se equivocó</option>
          <option value="Dirección incorrecta">Dirección incorrecta</option>
          <option value="Duplicado">Duplicado</option>
          <option value="Otro">Otro</option>
        </select>
      </div>

      <div class="btnRow">
        <button class="btn secondary btnSave" type="button">Guardar cambios</button>
        <button class="btn btnDanger btnCancel" type="button">Cancelar</button>
        <button class="btn primary btnPay" type="button">Confirmar pago</button>
      </div>
      ` : `
      <div class="hr"></div>
      <div class="mutedSmall">Este pedido está en <strong>${escapeHtml(SESSION.tab)}</strong>. No se puede editar ni confirmar.</div>
      `
    }
  `;

  if (!editable) return wrap;

  // ===== Actions (Pendiente) =====
  wrap.querySelector(".btnSave").addEventListener("click", async () => {
    setStatus("Guardando cambios...");

    const updatedItems = parseItemsFromOrder(order).map((it, idx) => {
      const qtyEl = wrap.querySelector(`.itemQty[data-idx="${idx}"]`);
      const newQty = Number(qtyEl?.value || 0);
      return {
        id: it.id,
        name: it.name,
        qty: newQty,
        price: it.unit_price
      };
    }).filter(it => it.qty > 0);

    await api({
      action: "update_order",
      admin_pin: SESSION.pin,
      operator: SESSION.operator,
      order_id: order.order_id,
      customer_name: wrap.querySelector(".f_name").value.trim(),
      phone: wrap.querySelector(".f_phone").value.trim(),
      address_text: wrap.querySelector(".f_address").value.trim(),
      maps_link: wrap.querySelector(".f_maps").value.trim(),
      notes: wrap.querySelector(".f_notes").value.trim(),
      items: updatedItems
    });

    setStatus("✅ Cambios guardados.");
    await loadTab("Pendiente");
  });

  wrap.querySelector(".btnPay").addEventListener("click", async () => {
    const method = wrap.querySelector(".f_method").value;
    const ref = wrap.querySelector(".f_ref").value.trim();

    await confirmWithTimer({
      title: "Confirmar pago",
      text: `¿Confirmar el pago del pedido ${order.order_id} por $${money(order.subtotal)}?`,
      seconds: 3,
      confirmLabel: "Confirmar pago",
      onConfirm: async () => {
        await api({
          action: "mark_paid",
          admin_pin: SESSION.pin,
          operator: SESSION.operator,
          order_id: order.order_id,
          payment_method: method,
          payment_ref: ref
        });
        setStatus("✅ Pago confirmado. El pedido pasó a Pagados.");
        await loadTab("Pendiente");
      }
    });
  });

  wrap.querySelector(".btnCancel").addEventListener("click", async () => {
    const reason = wrap.querySelector(".f_cancel_reason").value;

    await confirmWithTimer({
      title: "Cancelar pedido",
      text: `¿Cancelar el pedido ${order.order_id}? (No se podrá confirmar después)`,
      seconds: 3,
      confirmLabel: "Cancelar pedido",
      onConfirm: async () => {
        await api({
          action: "cancel_order",
          admin_pin: SESSION.pin,
          operator: SESSION.operator,
          order_id: order.order_id,
          cancel_reason: reason
        });
        setStatus("✅ Pedido cancelado. Pasó a Cancelados.");
        await loadTab("Pendiente");
      }
    });
  });

  return wrap;
}

/* ===== MODAL CONFIRM WITH TIMER ===== */
btnCancelModal.addEventListener("click", () => {
  if (countdownInt) clearInterval(countdownInt);
  closeModal();
});

function openModal() {
  confirmOverlay.classList.add("show");
  confirmOverlay.setAttribute("aria-hidden","false");
}
function closeModal() {
  confirmOverlay.classList.remove("show");
  confirmOverlay.setAttribute("aria-hidden","true");
}

async function confirmWithTimer({ title, text, seconds, confirmLabel, onConfirm }) {
  modalAction = onConfirm;

  confirmTitle.textContent = title;
  confirmText.textContent = text;
  btnConfirmModal.textContent = confirmLabel || "Confirmar";
  btnConfirmModal.disabled = true;

  let t = seconds;
  confirmTimer.textContent = `Espera ${t}s para habilitar la confirmación...`;
  openModal();

  if (countdownInt) clearInterval(countdownInt);
  countdownInt = setInterval(() => {
    t--;
    if (t <= 0) {
      clearInterval(countdownInt);
      confirmTimer.textContent = "Listo. Puedes confirmar ahora.";
      btnConfirmModal.disabled = false;
    } else {
      confirmTimer.textContent = `Espera ${t}s para habilitar la confirmación...`;
    }
  }, 1000);

  btnConfirmModal.onclick = async () => {
    btnConfirmModal.disabled = true;
    try {
      await modalAction();
      closeModal();
    } catch (e) {
      setStatus("❌ " + (e.message || "Error"));
      closeModal();
    }
  };
}

/* ===== BASIC HTML ESCAPE ===== */
function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function escapeAttr(s) { return escapeHtml(s); }

/* ===== INIT ===== */
(function init() {
  const saved = sessionStorage.getItem("AMARED_ADMIN");
  if (saved) {
    SESSION = JSON.parse(saved);
    showPanel();
    loadTab(SESSION.tab || "Pendiente");
  }
})();
