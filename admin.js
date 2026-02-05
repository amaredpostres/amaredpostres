const API_URL = "https://amared-orders.amaredpostres.workers.dev/";

// Productos disponibles (para edición: siempre se muestran todos con qty 0)
const PRODUCT_CATALOG = [
  { id: "mousse_maracuya", name: "Mousse de Maracuyá", unit_price: 10000 },
  { id: "cheesecake_cafe_panela", name: "Cheesecake de café con panela", unit_price: 12500 },
];

const PAYMENT_METHODS = ["Nequi","Daviplata","Bancolombia","Davivienda","Efectivo","Otro"];

let SESSION = { operator: null, pin: null };

// UI state
let histFilter = "ALL"; // ALL | Pagado | Cancelado
let pendingOrdersCache = []; // para evitar desincronización visual

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
const btnHistory = document.getElementById("btnHistory");

const statusEl = document.getElementById("status");
const listEl = document.getElementById("list");

// Drawer historial
const drawerOverlay = document.getElementById("drawerOverlay");
const drawer = document.getElementById("drawer");
const btnCloseDrawer = document.getElementById("btnCloseDrawer");
const histStatusEl = document.getElementById("histStatus");
const histListEl = document.getElementById("histList");
const btnHistRefresh = document.getElementById("btnHistRefresh");

// Chips filtro
const chips = Array.from(document.querySelectorAll(".chip"));

// Confirm modal
const confirmOverlay = document.getElementById("confirmOverlay");
const confirmTitle = document.getElementById("confirmTitle");
const confirmText = document.getElementById("confirmText");
const confirmTimer = document.getElementById("confirmTimer");
const btnCancelModal = document.getElementById("btnCancelModal");
const btnConfirmModal = document.getElementById("btnConfirmModal");
let modalAction = null;
let countdownInt = null;

// Loading overlay
const loadingOverlay = document.getElementById("loadingOverlay");
const loadingText = document.getElementById("loadingText");

// ===== UTILS =====
function setStatus(msg) { statusEl.textContent = msg || ""; }
function setHistStatus(msg) { histStatusEl.textContent = msg || ""; }
function money(n) { return Math.round(Number(n || 0)).toLocaleString("es-CO"); }
function safeJsonParse(s){ try { return JSON.parse(s); } catch { return null; } }

function showLoading(text="Cargando...") {
  loadingText.textContent = text;
  loadingOverlay.classList.add("show");
  loadingOverlay.setAttribute("aria-hidden","false");
}
function hideLoading() {
  loadingOverlay.classList.remove("show");
  loadingOverlay.setAttribute("aria-hidden","true");
}

async function api(body) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify(body)
  });
  const out = await res.json().catch(async ()=>({ ok:false, error: await res.text() }));
  if (!out.ok) throw new Error(out.error || "Error");
  return out;
}

function formatDate(v) {
  const s = String(v || "").trim();
  if (s.includes("T")) return s.replace(".000Z","").replace("T"," ");
  return s;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ===== ITEMS =====
function normalizeItemsFromOrder(order) {
  // 1) items_json preferido
  if (order.items_json) {
    const parsed = safeJsonParse(order.items_json);
    if (Array.isArray(parsed)) {
      return parsed.map(it => ({
        id: String(it.id || ""),
        name: String(it.name || ""),
        qty: Number(it.qty || 0),
        unit_price: Number(it.unit_price || it.price || 0),
      })).filter(it => it.name);
    }
  }

  // 2) fallback items texto "- Nombre: 2"
  if (order.items) {
    const lines = String(order.items).split("\n").map(s => s.trim()).filter(Boolean);
    const found = [];
    for (const line of lines) {
      const m = line.replace(/^-+\s*/, "").match(/^(.+?)\s*:\s*(\d+)/);
      if (!m) continue;
      const name = m[1].trim();
      const qty = Number(m[2]);
      const cat = PRODUCT_CATALOG.find(p => name.toLowerCase().includes(p.name.toLowerCase().slice(0, 10)));
      found.push({
        id: cat?.id || name.toLowerCase().replace(/\s+/g, "_"),
        name,
        qty,
        unit_price: cat?.unit_price || 0
      });
    }
    return found.filter(it => it.name);
  }

  return [];
}

function buildEditableItems(order) {
  // Siempre mostrar todo el catálogo + los items actuales del pedido (por si cambian nombres)
  const current = normalizeItemsFromOrder(order);
  const map = new Map(current.map(it => [it.id, it]));

  // Catálogo (si no está en pedido, qty=0)
  const base = PRODUCT_CATALOG.map(p => ({
    id: p.id,
    name: p.name,
    qty: map.get(p.id)?.qty ?? 0,
    unit_price: p.unit_price
  }));

  // Si el pedido trae algún item extra fuera del catálogo, lo añadimos para no perderlo
  current.forEach(it => {
    if (!base.some(b => b.id === it.id)) {
      base.push({
        id: it.id,
        name: it.name,
        qty: it.qty ?? 0,
        unit_price: it.unit_price ?? 0
      });
    }
  });

  return base;
}

function calcTotals(items) {
  const total_units = items.reduce((s,it) => s + Number(it.qty || 0), 0);
  const subtotal = items.reduce((s,it) => s + Number(it.qty || 0) * Number(it.unit_price || 0), 0);
  return { total_units, subtotal };
}

// ===== LOGIN =====
btnLogin.addEventListener("click", async () => {
  loginError.textContent = "";
  const operator = loginOperator.value.trim();
  const pin = loginPin.value.trim();
  if (!operator || !pin) { loginError.textContent = "Completa todos los campos."; return; }

  try {
    showLoading("Verificando acceso...");
    await api({ action:"list_orders", admin_pin: pin, payment_status:"Pendiente" });

    SESSION = { operator, pin };
    sessionStorage.setItem("AMARED_ADMIN", JSON.stringify(SESSION));

    showPanel();
    await loadPendientes(false);
  } catch {
    loginError.textContent = "PIN incorrecto.";
  } finally {
    hideLoading();
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

// ===== LOGOUT =====
btnLogout.addEventListener("click", () => {
  SESSION = { operator:null, pin:null };
  closeDrawer();
  showLogin();
});

// ===== PENDIENTES =====
btnRefresh.addEventListener("click", async () => {
  await loadPendientes(true);
});

async function loadPendientes(fromRefresh=false) {
  try {
    showLoading(fromRefresh ? "Actualizando pedidos..." : "Cargando pedidos...");
    setStatus("Cargando pendientes...");

    const out = await api({
      action: "list_orders",
      admin_pin: SESSION.pin,
      payment_status: "Pendiente"
    });

    pendingOrdersCache = out.orders || [];
    renderPendientes(pendingOrdersCache);
    setStatus(`${pendingOrdersCache.length} pedidos pendientes.`);
  } catch (e) {
    setStatus("❌ " + (e.message || "Error"));
  } finally {
    hideLoading();
  }
}

function renderPendientes(orders) {
  renderOrdersList(listEl, orders, { mode:"PENDIENTES" });
}

// ===== HISTORIAL =====
btnHistory.addEventListener("click", async () => {
  openDrawer();
  await loadHist(true);
});
drawerOverlay.addEventListener("click", closeDrawer);
btnCloseDrawer.addEventListener("click", closeDrawer);

btnHistRefresh.addEventListener("click", async () => {
  await loadHist(true);
});

chips.forEach(ch => {
  ch.addEventListener("click", async () => {
    chips.forEach(c => c.classList.remove("active"));
    ch.classList.add("active");
    histFilter = ch.dataset.filter; // ALL / Pagado / Cancelado
    await loadHist(false); // recargar para aplicar filtro (y por consistencia)
  });
});

function openDrawer() {
  drawerOverlay.classList.add("show");
  drawer.setAttribute("aria-hidden","false");
}
function closeDrawer() {
  drawerOverlay.classList.remove("show");
  drawer.setAttribute("aria-hidden","true");
}

async function loadHist(forceFetch) {
  try {
    showLoading("Cargando historial...");
    setHistStatus("Cargando...");
    histListEl.innerHTML = "";

    // Fetch both Pagado + Cancelado and merge, then filter
    const [paid, canceled] = await Promise.all([
      api({ action:"list_orders", admin_pin: SESSION.pin, payment_status:"Pagado" }),
      api({ action:"list_orders", admin_pin: SESSION.pin, payment_status:"Cancelado" }),
    ]);

    let all = [...(paid.orders || []), ...(canceled.orders || [])];

    // Orden por fecha desc
    all.sort((a,b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());

    if (histFilter !== "ALL") {
      all = all.filter(o => String(o.payment_status) === histFilter);
    }

    renderOrdersList(histListEl, all, { mode:"HIST" });
    setHistStatus(`${all.length} pedidos (filtro: ${histFilter === "ALL" ? "Todos" : histFilter}).`);
  } catch (e) {
    setHistStatus("❌ " + (e.message || "Error"));
  } finally {
    hideLoading();
  }
}

// ===== RENDER LIST =====
function renderOrdersList(container, orders, { mode }) {
  container.innerHTML = "";

  if (!orders.length) {
    container.innerHTML = `<div class="mutedSmall">No hay pedidos.</div>`;
    return;
  }

  orders.forEach(order => {
    const card = document.createElement("div");
    card.className = "orderItem";

    const head = document.createElement("div");
    head.className = "orderHead";

    const statusBadge = (mode === "HIST")
      ? `<span class="badge">${escapeHtml(order.payment_status || "")}</span>`
      : "";

    head.innerHTML = `
      <div style="min-width:0;">
        <div class="orderId">${escapeHtml(order.order_id)} <span class="badge">$${money(order.subtotal)}</span> ${statusBadge}</div>
        <div class="orderMeta">${escapeHtml(order.customer_name || "")} • ${escapeHtml(formatDate(order.created_at))}</div>
      </div>
      <div class="chev">›</div>
    `;

    const body = document.createElement("div");
    body.className = "orderBody";

    if (mode === "PENDIENTES") body.appendChild(renderPendingDetail(order));
    else body.appendChild(renderHistDetail(order));

    head.addEventListener("click", () => {
      const open = card.classList.toggle("open");
      head.querySelector(".chev").textContent = open ? "⌄" : "›";
    });

    card.appendChild(head);
    card.appendChild(body);
    container.appendChild(card);
  });
}

// ===== DETAIL: HIST (solo lectura) =====
function renderHistDetail(order) {
  const wrap = document.createElement("div");
  const items = normalizeItemsFromOrder(order).filter(it => Number(it.qty) > 0);
  const totals = calcTotals(items);

  const itemsHtml = items.length
    ? items.map(it => `<div class="mutedSmall"><strong>${escapeHtml(it.name)}</strong> x ${it.qty}</div>`).join("")
    : `<div class="mutedSmall">Items no disponibles.</div>`;

  wrap.innerHTML = `
    <div class="mutedSmall"><strong>Tel:</strong> ${escapeHtml(order.phone || "")}</div>
    <div class="mutedSmall"><strong>Dirección:</strong> ${escapeHtml(order.address_text || "")}</div>
    <div class="mutedSmall"><strong>Ubicación:</strong> ${escapeHtml(order.maps_link || "")}</div>
    <div class="mutedSmall"><strong>Notas:</strong> ${escapeHtml(order.notes || "—")}</div>

    <div class="hr"></div>

    <div class="mutedSmall" style="font-weight:950; margin-bottom:6px;">Ítems</div>
    ${itemsHtml}

    <div class="mutedSmall" style="margin-top:8px;">
      Unidades: <strong>${totals.total_units}</strong> • Subtotal: <strong>$${money(order.subtotal || totals.subtotal)}</strong>
    </div>

    ${
      String(order.payment_status) === "Pagado" ? `
        <div class="hr"></div>
        <div class="mutedSmall"><strong>Método:</strong> ${escapeHtml(order.payment_method || "—")}</div>
        <div class="mutedSmall"><strong>Referencia:</strong> ${escapeHtml(order.payment_ref || "—")}</div>
        <div class="mutedSmall"><strong>Pagado por:</strong> ${escapeHtml(order.paid_by || "—")}</div>
        <div class="mutedSmall"><strong>Pagado en:</strong> ${escapeHtml(order.paid_at || "—")}</div>
      ` : `
        <div class="hr"></div>
        <div class="mutedSmall"><strong>Razón cancelación:</strong> ${escapeHtml(order.cancel_reason || "—")}</div>
        <div class="mutedSmall"><strong>Cancelado por:</strong> ${escapeHtml(order.canceled_by || "—")}</div>
        <div class="mutedSmall"><strong>Cancelado en:</strong> ${escapeHtml(order.canceled_at || "—")}</div>
      `
    }
  `;
  return wrap;
}

// ===== DETAIL: PENDIENTES (editable con botón Editar) =====
function renderPendingDetail(order) {
  const wrap = document.createElement("div");
  let editMode = false;

  // items para edición: siempre todos
  let items = buildEditableItems(order);
  let totals = calcTotals(items);

  function render() {
    const itemsHtml = items.map((it, idx) => `
      <div class="grid2" style="align-items:end; margin-bottom:10px;">
        <div class="field" style="margin:0;">
          <label>${escapeHtml(it.name)}</label>
          <div class="mutedSmall">$${money(it.unit_price)} c/u</div>
        </div>
        <div class="field" style="margin:0;">
          <label>Cantidad</label>
          <input class="input itemQty" type="number" min="0" step="1"
            data-idx="${idx}" value="${it.qty}"
            ${editMode ? "" : "disabled"}>
        </div>
      </div>
    `).join("");

    wrap.innerHTML = `
      <div class="btnRow" style="justify-content:flex-start; margin-top:0;">
        ${editMode
          ? `<button class="btn secondary btnCancelEdit" type="button">Cancelar edición</button>`
          : `<button class="btn secondary btnEdit" type="button">Editar</button>`
        }
      </div>

      <div class="grid2">
        <div class="field">
          <label>Nombre</label>
          <input class="input f_name" ${editMode ? "" : "disabled"} value="${escapeHtml(order.customer_name || "")}">
        </div>
        <div class="field">
          <label>Teléfono</label>
          <input class="input f_phone" ${editMode ? "" : "disabled"} value="${escapeHtml(order.phone || "")}">
        </div>
      </div>

      <div class="field" style="margin-top:10px;">
        <label>Dirección</label>
        <input class="input f_address" ${editMode ? "" : "disabled"} value="${escapeHtml(order.address_text || "")}">
      </div>

      <div class="field" style="margin-top:10px;">
        <label>Ubicación (maps_link o WHATSAPP)</label>
        <input class="input f_maps" ${editMode ? "" : "disabled"} value="${escapeHtml(order.maps_link || "")}">
      </div>

      <div class="field" style="margin-top:10px;">
        <label>Notas</label>
        <textarea class="textarea f_notes" rows="3" ${editMode ? "" : "disabled"}>${escapeHtml(order.notes || "")}</textarea>
      </div>

      <div class="hr"></div>

      <div class="mutedSmall" style="font-weight:950; margin-bottom:6px;">Ítems</div>
      ${itemsHtml}

      <div class="mutedSmall" style="margin-top:8px;">
        Unidades: <strong class="t_units">${totals.total_units}</strong> •
        Subtotal: <strong class="t_subtotal">$${money(totals.subtotal)}</strong>
      </div>

      <div class="hr"></div>

      <div class="grid2">
        <div class="field">
          <label>Método de pago</label>
          <select class="input f_method" ${editMode ? "" : ""}>
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
        ${editMode ? `<button class="btn secondary btnSave" type="button">Guardar cambios</button>` : ""}
        <button class="btn btnDanger btnCancel" type="button">Cancelar</button>
        <button class="btn primary btnPay" type="button">Confirmar pago</button>
      </div>
    `;

    // Botón Editar / Cancelar edición
    const btnEdit = wrap.querySelector(".btnEdit");
    const btnCancelEdit = wrap.querySelector(".btnCancelEdit");

    if (btnEdit) btnEdit.addEventListener("click", () => {
      editMode = true;
      render();
      hookQtyLiveUpdate();
    });
    if (btnCancelEdit) btnCancelEdit.addEventListener("click", () => {
      editMode = false;
      // restaurar valores originales del pedido
      items = buildEditableItems(order);
      totals = calcTotals(items);
      render();
    });

    // Live update totals cuando editas cantidades
    function hookQtyLiveUpdate() {
      wrap.querySelectorAll(".itemQty").forEach(inp => {
        inp.addEventListener("input", () => {
          const idx = Number(inp.dataset.idx);
          items[idx].qty = Number(inp.value || 0);
          totals = calcTotals(items);
          wrap.querySelector(".t_units").textContent = String(totals.total_units);
          wrap.querySelector(".t_subtotal").textContent = `$${money(totals.subtotal)}`;
        });
      });
    }
    if (editMode) hookQtyLiveUpdate();

    // Guardar cambios (solo si editMode)
    const btnSave = wrap.querySelector(".btnSave");
    if (btnSave) {
      btnSave.addEventListener("click", async () => {
        try {
          showLoading("Guardando cambios...");
          setStatus("Guardando...");

          const updatedItems = items
            .map(it => ({ id: it.id, name: it.name, qty: Number(it.qty || 0), price: it.unit_price }))
            .filter(it => it.qty > 0);

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

          // ✅ FIX: actualizar inmediatamente el order local (subtotal/units/items) para confirmar sin refrescar
          const newTotals = calcTotals(items);
          order.subtotal = newTotals.subtotal;
          order.total_units = newTotals.total_units;
          order.items_json = JSON.stringify(updatedItems.map(it => ({
            id: it.id, name: it.name, qty: it.qty, unit_price: it.price
          })));

          // salir de edición y refrescar UI del detalle
          editMode = false;
          setStatus("✅ Cambios guardados.");
          render();

          // además refrescamos la lista para que el badge $ y resumen se actualicen
          await loadPendientes(true);
        } catch (e) {
          setStatus("❌ " + (e.message || "Error"));
        } finally {
          hideLoading();
        }
      });
    }

    // Confirmar pago (usa el subtotal actualizado en `order.subtotal`)
    wrap.querySelector(".btnPay").addEventListener("click", async () => {
      const method = wrap.querySelector(".f_method").value;
      const ref = wrap.querySelector(".f_ref").value.trim();

      await confirmWithTimer({
        title: "Confirmar pago",
        text: `¿Confirmar el pago del pedido ${order.order_id} por $${money(order.subtotal)}?`,
        seconds: 3,
        confirmLabel: "Confirmar pago",
        onConfirm: async () => {
          showLoading("Confirmando pago...");
          await api({
            action: "mark_paid",
            admin_pin: SESSION.pin,
            operator: SESSION.operator,
            order_id: order.order_id,
            payment_method: method,
            payment_ref: ref
          });
          hideLoading();
          setStatus("✅ Pago confirmado. Pedido removido de Pendientes.");
          // ✅ refrescar pendientes para que se mueva de sección
          await loadPendientes(true);
        }
      });
    });

    // Cancelar pedido
    wrap.querySelector(".btnCancel").addEventListener("click", async () => {
      const reason = wrap.querySelector(".f_cancel_reason").value;

      await confirmWithTimer({
        title: "Cancelar pedido",
        text: `¿Cancelar el pedido ${order.order_id}? (No se podrá confirmar después)`,
        seconds: 3,
        confirmLabel: "Cancelar",
        onConfirm: async () => {
          showLoading("Cancelando pedido...");
          await api({
            action: "cancel_order",
            admin_pin: SESSION.pin,
            operator: SESSION.operator,
            order_id: order.order_id,
            cancel_reason: reason
          });
          hideLoading();
          setStatus("✅ Pedido cancelado. Removido de Pendientes.");
          // ✅ refrescar pendientes para que se mueva de sección
          await loadPendientes(true);
        }
      });
    });
  }

  render();
  return wrap;
}

// ===== CONFIRM MODAL =====
btnCancelModal.addEventListener("click", () => {
  if (countdownInt) clearInterval(countdownInt);
  closeConfirm();
});
function openConfirm() {
  confirmOverlay.classList.add("show");
  confirmOverlay.setAttribute("aria-hidden","false");
}
function closeConfirm() {
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
  confirmTimer.textContent = `Espera ${t}s para habilitar...`;
  openConfirm();

  if (countdownInt) clearInterval(countdownInt);
  countdownInt = setInterval(() => {
    t--;
    if (t <= 0) {
      clearInterval(countdownInt);
      confirmTimer.textContent = "Listo. Puedes confirmar ahora.";
      btnConfirmModal.disabled = false;
    } else {
      confirmTimer.textContent = `Espera ${t}s para habilitar...`;
    }
  }, 1000);

  btnConfirmModal.onclick = async () => {
    btnConfirmModal.disabled = true;
    try {
      await modalAction();
      closeConfirm();
    } catch (e) {
      closeConfirm();
      setStatus("❌ " + (e.message || "Error"));
    }
  };
}

// ===== INIT =====
(function init() {
  const saved = sessionStorage.getItem("AMARED_ADMIN");
  if (saved) {
    SESSION = JSON.parse(saved);
    showPanel();
    loadPendientes(false);
  }
})();
