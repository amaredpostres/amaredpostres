// ===== CONFIG =====
const ADMIN_API_URL = "https://amared-orders.amaredpostres.workers.dev/"; // mismo Worker

// Métodos de pago
const PAYMENT_METHODS = ["Nequi","Daviplata","Bancolombia","Davivienda","Efectivo","Otro"];

// ===== STATE =====
let currentTab = "Pendiente";
let ordersCache = [];

// ===== DOM =====
const listEl = document.getElementById("list");
const statusEl = document.getElementById("status");
const pinEl = document.getElementById("pin");
const operatorEl = document.getElementById("operator");

const confirmOverlay = document.getElementById("confirmOverlay");
const confirmTitle = document.getElementById("confirmTitle");
const confirmText = document.getElementById("confirmText");
const confirmTimer = document.getElementById("confirmTimer");
const btnCancelModal = document.getElementById("btnCancelModal");
const btnConfirmModal = document.getElementById("btnConfirmModal");

let modalAction = null; // () => Promise
let countdownInt = null;

// ===== UTILS =====
function money(n) {
  return Math.round(Number(n || 0)).toLocaleString("es-CO");
}

function setStatus(msg) {
  statusEl.textContent = msg || "";
}

function getAuth() {
  const admin_pin = String(pinEl.value || "").trim();
  const operator = String(operatorEl.value || "").trim() || "ADMIN";
  if (!admin_pin) throw new Error("Escribe el PIN Admin.");
  return { admin_pin, operator };
}

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

function parseItems(order) {
  // Preferimos items_json; si no existe, intentamos derivar desde items texto
  const raw = order.items_json;
  if (raw) {
    const parsed = safeJsonParse(raw);
    if (Array.isArray(parsed)) return parsed;
  }
  // fallback: no editable fino sin json, devolvemos vacío
  return [];
}

async function api(body) {
  const res = await fetch(ADMIN_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const out = await res.json().catch(async () => ({ ok:false, error: await res.text() }));
  if (!out.ok) throw new Error(out.error || "Error en servidor");
  return out;
}

// ===== LIST / RENDER =====
async function loadTab(tab) {
  currentTab = tab;
  setStatus("Cargando...");

  const { admin_pin } = getAuth(); // valida pin
  const out = await api({
    action: "list_orders",
    admin_pin,
    payment_status: tab
  });

  ordersCache = out.orders || [];
  renderList();
  setStatus(`${ordersCache.length} pedidos en ${tab}.`);
}

function renderList() {
  listEl.innerHTML = "";
  if (!ordersCache.length) {
    listEl.innerHTML = `<div class="mutedSmall">No hay pedidos en este apartado.</div>`;
    return;
  }

  for (const o of ordersCache) {
    const card = document.createElement("div");
    card.className = "orderItem";

    const head = document.createElement("div");
    head.className = "orderHead";

    const left = document.createElement("div");
    left.className = "orderMain";
    left.innerHTML = `
      <div class="orderId">${o.order_id} <span class="badge">$${money(o.subtotal)}</span></div>
      <div class="orderMeta">${o.customer_name} • ${o.created_at}</div>
    `;

    const chev = document.createElement("div");
    chev.className = "chev";
    chev.textContent = "›";

    head.appendChild(left);
    head.appendChild(chev);

    const body = document.createElement("div");
    body.className = "orderBody";
    body.appendChild(renderDetail(o));

    head.addEventListener("click", () => {
      const open = card.classList.toggle("open");
      chev.textContent = open ? "⌄" : "›";
    });

    card.appendChild(head);
    card.appendChild(body);
    listEl.appendChild(card);
  }
}

function renderDetail(o) {
  const wrap = document.createElement("div");

  // Campos editables solo si Pendiente
  const editable = (currentTab === "Pendiente");

  const items = parseItems(o);

  const itemsHtml = items.length
    ? items.map((it, idx) => `
        <div class="grid2" style="align-items:end; margin-bottom:10px;">
          <div class="field">
            <label>${it.name}</label>
            <div class="mutedSmall">$${money(it.unit_price)} c/u</div>
          </div>
          <div class="field">
            <label>Cantidad</label>
            <input class="input itemQty" type="number" min="0" step="1" data-idx="${idx}" value="${it.qty}">
          </div>
        </div>
      `).join("")
    : `<div class="mutedSmall">⚠️ items_json vacío. (Agrega la columna items_json y asegúrate que create_order la llene.)</div>`;

  wrap.innerHTML = `
    <div class="grid2">
      <div class="field">
        <label>Nombre</label>
        <input class="input f_name" ${editable ? "" : "disabled"} value="${o.customer_name || ""}">
      </div>
      <div class="field">
        <label>Teléfono</label>
        <input class="input f_phone" ${editable ? "" : "disabled"} value="${o.phone || ""}">
      </div>
    </div>

    <div class="field" style="margin-top:10px;">
      <label>Dirección</label>
      <input class="input f_address" ${editable ? "" : "disabled"} value="${o.address_text || ""}">
    </div>

    <div class="field" style="margin-top:10px;">
      <label>Ubicación (maps_link o WHATSAPP)</label>
      <input class="input f_maps" ${editable ? "" : "disabled"} value="${o.maps_link || ""}">
    </div>

    <div class="grid2" style="margin-top:10px;">
      <div class="field">
        <label>Email</label>
        <input class="input f_email" ${editable ? "" : "disabled"} value="${o.email || ""}">
      </div>
      <div class="field">
        <label>wa_opt_in</label>
        <select class="input f_opt" ${editable ? "" : "disabled"}>
          <option value="true" ${String(o.wa_opt_in) === "true" ? "selected" : ""}>TRUE</option>
          <option value="false" ${String(o.wa_opt_in) === "false" ? "selected" : ""}>FALSE</option>
        </select>
      </div>
    </div>

    <div class="field" style="margin-top:10px;">
      <label>Notas</label>
      <textarea class="textarea f_notes" rows="3" ${editable ? "" : "disabled"}>${o.notes || ""}</textarea>
    </div>

    <div style="margin-top:12px;">
      <div class="mutedSmall" style="font-weight:950; margin-bottom:6px;">Ítems (editable solo en Pendientes)</div>
      ${itemsHtml}
    </div>

    ${
      editable ? `
        <div class="grid2" style="margin-top:10px;">
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
      ` : ""
    }

    <div class="btnRow">
      ${editable ? `<button class="btn secondary btnSave" type="button">Guardar cambios</button>` : ""}
      ${editable ? `<button class="btn btnDanger btnCancel" type="button">Cancelar pedido</button>` : ""}
      ${editable ? `<button class="btn primary btnPay" type="button">Confirmar pago</button>` : ""}
    </div>
  `;

  if (!editable) return wrap;

  // handlers
  wrap.querySelector(".btnSave").addEventListener("click", async () => {
    const { admin_pin, operator } = getAuth();
    const updatedItems = parseItems(o).map((it, i) => {
      const qtyEl = wrap.querySelector(`.itemQty[data-idx="${i}"]`);
      return { ...it, qty: Number(qtyEl?.value || 0), price: it.unit_price };
    }).filter(it => it.qty > 0);

    await api({
      action: "update_order",
      admin_pin,
      operator,
      order_id: o.order_id,
      customer_name: wrap.querySelector(".f_name").value.trim(),
      phone: wrap.querySelector(".f_phone").value.trim(),
      address_text: wrap.querySelector(".f_address").value.trim(),
      maps_link: wrap.querySelector(".f_maps").value.trim(),
      email: wrap.querySelector(".f_email").value.trim(),
      wa_opt_in: wrap.querySelector(".f_opt").value === "true",
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
      text: `¿Confirmar pago del pedido ${o.order_id} por $${money(o.subtotal)}?`,
      seconds: 3,
      onConfirm: async () => {
        const { admin_pin, operator } = getAuth();
        await api({
          action: "mark_paid",
          admin_pin,
          operator,
          order_id: o.order_id,
          payment_method: method,
          payment_ref: ref
        });
        setStatus("✅ Pago confirmado. Pedido enviado a Pagados.");
        await loadTab("Pendiente");
      }
    });
  });

  wrap.querySelector(".btnCancel").addEventListener("click", async () => {
    await confirmWithTimer({
      title: "Cancelar pedido",
      text: `¿Cancelar el pedido ${o.order_id}? (No se podrá confirmar después)`,
      seconds: 3,
      onConfirm: async () => {
        const { admin_pin, operator } = getAuth();
        await api({
          action: "cancel_order",
          admin_pin,
          operator,
          order_id: o.order_id,
          cancel_reason: "Cliente canceló"
        });
        setStatus("✅ Pedido cancelado. Pasó a Cancelados.");
        await loadTab("Pendiente");
      }
    });
  });

  return wrap;
}

// ===== MODAL CONFIRM =====
function openModal() {
  confirmOverlay.classList.add("show");
  confirmOverlay.setAttribute("aria-hidden","false");
}
function closeModal() {
  confirmOverlay.classList.remove("show");
  confirmOverlay.setAttribute("aria-hidden","true");
}

btnCancelModal.addEventListener("click", () => {
  if (countdownInt) clearInterval(countdownInt);
  closeModal();
});

async function confirmWithTimer({ title, text, seconds, onConfirm }) {
  modalAction = onConfirm;
  confirmTitle.textContent = title;
  confirmText.textContent = text;
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

// ===== TABS =====
document.querySelectorAll(".tabBtn").forEach(btn => {
  btn.addEventListener("click", async () => {
    document.querySelectorAll(".tabBtn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    await loadTab(btn.dataset.tab);
  });
});

// ===== INIT =====
(async function init(){
  setStatus("Ingresa Operador y PIN para cargar.");
})();
