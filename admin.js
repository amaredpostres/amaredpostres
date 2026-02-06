// =================== CONFIG ===================
const API_URL = "https://amared-orders.amaredpostres.workers.dev/";

// Catálogo para edición (mismos que tu web pública)
const PRODUCT_CATALOG = [
  { id: "mousse_maracuya", name: "Mousse de Maracuyá", unit_price: 10000 },
  { id: "cheesecake_cafe_panela", name: "Cheesecake de café con panela", unit_price: 12500 },
];

// =================== SESSION ===================
let SESSION = { operator: null, pin: null };

// Evitar dobles llamadas / loading anidado
let REQUEST_IN_FLIGHT = false;
let LOADING_COUNT = 0;

// Historial cache (reduce 429)
let HIST_CACHE = null; // { paid:[], canceled:[] }
let HIST_CACHE_TIME = 0;
const HIST_TTL = 60 * 1000;

// UI state
let histFilter = "ALL";
let pendingOrdersCache = [];

// =================== DOM ===================
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
const chips = Array.from(document.querySelectorAll(".chip"));

// Loading overlay
const loadingOverlay = document.getElementById("loadingOverlay");
const loadingText = document.getElementById("loadingText");

// Modal pago
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

// Modal cancelar
const cancelModal = document.getElementById("cancelModal");
const cancelTitle = document.getElementById("cancelTitle");
const cancelText = document.getElementById("cancelText");
const cancelReason = document.getElementById("cancelReason");
const cancelOtherWrap = document.getElementById("cancelOtherWrap");
const cancelOtherText = document.getElementById("cancelOtherText");
const cancelTimer = document.getElementById("cancelTimer");
const btnCancelBack = document.getElementById("btnCancelBack");
const btnCancelConfirm = document.getElementById("btnCancelConfirm");

// Timers
let payCountdownInt = null;
let cancelCountdownInt = null;
let payTimerStarted = false;
let cancelTimerStarted = false;

// Current order in modal
let modalOrder = null;

// =================== UTILS ===================
function setStatus(msg) { statusEl.textContent = msg || ""; }
function setHistStatus(msg) { histStatusEl.textContent = msg || ""; }

function money(n) {
  return Math.round(Number(n || 0)).toLocaleString("es-CO");
}
function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}
function escapeHtml(s) {
  // ✅ FIX: aquí estaba roto en tu archivo (faltaba el punto antes de replaceAll)
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function formatDate(v) {
  const s = String(v || "").trim();
  if (s.includes("T")) return s.replace(".000Z", "").replace("T", " ");
  return s;
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function showLoading(text = "Cargando.") {
  LOADING_COUNT++;
  loadingText.textContent = text;
  loadingOverlay.classList.add("show");
}
function hideLoading() {
  LOADING_COUNT = Math.max(0, LOADING_COUNT - 1);
  if (LOADING_COUNT === 0) loadingOverlay.classList.remove("show");
}

// =================== API (retry 429) ===================
async function api(body, retries = 2) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (res.status === 429 && retries > 0) {
    await sleep(650 * (3 - retries)); // 650ms, 1300ms
    return api(body, retries - 1);
  }

  const out = await res.json().catch(async () => ({ ok: false, error: await res.text().catch(() => "") }));
  if (!out.ok) throw new Error(out.error || "Error");
  return out;
}

// =================== NAV (login/panel) ===================
function showPanel() {
  loginView.classList.add("hidden");
  panelView.classList.remove("hidden");
  operatorName.textContent = SESSION.operator || "";
}
function showLogin() {
  panelView.classList.add("hidden");
  loginView.classList.remove("hidden");
}

// =================== Drawer ===================
function openDrawer() {
  drawerOverlay.classList.add("show");
  drawer.setAttribute("aria-hidden", "false");
}
function closeDrawer() {
  drawerOverlay.classList.remove("show");
  drawer.setAttribute("aria-hidden", "true");
}

// =================== ITEMS helpers ===================
function normalizeItemsFromOrder(order) {
  // 1) prefer items_json
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

  // 2) fallback: items en texto "- Nombre: 2"
  if (order.items) {
    const lines = String(order.items).split("\n").map(s => s.trim()).filter(Boolean);
    const out = [];
    for (const line of lines) {
      const m = line.replace(/^-+\s*/, "").match(/^(.+?)\s*:\s*(\d+)/);
      if (!m) continue;
      const name = m[1].trim();
      const qty = Number(m[2]);
      const cat = PRODUCT_CATALOG.find(p => p.name.toLowerCase() === name.toLowerCase());
      out.push({
        id: cat?.id || name.toLowerCase().replace(/\s+/g, "_"),
        name,
        qty,
        unit_price: cat?.unit_price || 0
      });
    }
    return out.filter(it => it.name);
  }

  return [];
}

function buildEditableItems(order) {
  const current = normalizeItemsFromOrder(order);
  const map = new Map(current.map(it => [it.id, it]));

  // siempre mostrar catálogo
  const base = PRODUCT_CATALOG.map(p => ({
    id: p.id,
    name: p.name,
    qty: map.get(p.id)?.qty ?? 0,
    unit_price: p.unit_price
  }));

  // conservar items extra si existieran
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
  const total_units = items.reduce((s, it) => s + Number(it.qty || 0), 0);
  const subtotal = items.reduce((s, it) => s + Number(it.qty || 0) * Number(it.unit_price || 0), 0);
  return { total_units, subtotal };
}

// =================== LOGIN ===================
btnLogin.addEventListener("click", async () => {
  loginError.textContent = "";
  const operator = loginOperator.value.trim();
  const pin = loginPin.value.trim();
  if (!operator || !pin) {
    loginError.textContent = "Completa todos los campos.";
    return;
  }

  try {
    showLoading("Verificando acceso...");
    SESSION = { operator, pin };
    sessionStorage.setItem("AMARED_ADMIN", JSON.stringify(SESSION));

    // Validar con un list_orders (si falla, no dejamos sesión)
    showPanel();
    await loadPendientes(false);
  } catch (e) {
    SESSION = { operator: null, pin: null };
    sessionStorage.removeItem("AMARED_ADMIN");
    showLogin();

    // ✅ Mostrar el error real (útil para CORS/429/variables)
    loginError.textContent = `Error: ${String(e.message || e || "No se pudo iniciar sesión.")}`;
  } finally {
    hideLoading();
  }
});

// Logout
btnLogout.addEventListener("click", () => {
  SESSION = { operator: null, pin: null };
  sessionStorage.removeItem("AMARED_ADMIN");
  closeDrawer();
  showLogin();
});

// =================== Pendientes ===================
btnRefresh.addEventListener("click", async () => {
  await loadPendientes(true);
});

async function loadPendientes(fromRefresh = false) {
  if (REQUEST_IN_FLIGHT) return;
  REQUEST_IN_FLIGHT = true;

  try {
    showLoading(fromRefresh ? "Actualizando pedidos..." : "Cargando pedidos...");
    setStatus("Cargando pendientes...");

    const out = await api({
      action: "list_orders",
      admin_pin: SESSION.pin,
      payment_status: "Pendiente"
    });

    pendingOrdersCache = out.orders || [];
    renderOrdersList(listEl, pendingOrdersCache, { mode: "PENDIENTES" });
    setStatus(`${pendingOrdersCache.length} pedidos pendientes.`);
  } finally {
    hideLoading();
    REQUEST_IN_FLIGHT = false;
  }
}

async function softRefreshPendientes() {
  await sleep(700);
  try { await loadPendientes(true); } catch { /* ignore */ }
}

// =================== Historial ===================
btnHistory.addEventListener("click", async () => {
  openDrawer();
  await loadHist(false);
});

drawerOverlay.addEventListener("click", closeDrawer);
btnCloseDrawer.addEventListener("click", closeDrawer);
btnHistRefresh.addEventListener("click", async () => loadHist(true));

chips.forEach(ch => {
  ch.addEventListener("click", async () => {
    chips.forEach(c => c.classList.remove("active"));
    ch.classList.add("active");
    histFilter = ch.dataset.filter;
    await loadHist(false);
  });
});

async function loadHist(forceFetch) {
  try {
    showLoading("Cargando historial...");
    setHistStatus("Cargando...");
    histListEl.innerHTML = "";

    const now = Date.now();
    const useCache = HIST_CACHE && (now - HIST_CACHE_TIME) < HIST_TTL;

    if (forceFetch || !useCache) {
      const [paid, canceled] = await Promise.all([
        api({ action: "list_orders", admin_pin: SESSION.pin, payment_status: "Pagado" }),
        api({ action: "list_orders", admin_pin: SESSION.pin, payment_status: "Cancelado" }),
      ]);

      // ✅ FIX: aquí estaba roto en tu admin.js (tenías [.(...) ...])
      HIST_CACHE = {
        paid: (paid.orders || []),
        canceled: (canceled.orders || [])
      };
      HIST_CACHE_TIME = now;
    }

    let all = [...(HIST_CACHE.paid || []), ...(HIST_CACHE.canceled || [])];
    all.sort((a, b) => (Date.parse(b.created_at || "") || 0) - (Date.parse(a.created_at || "") || 0));

    if (histFilter !== "ALL") {
      all = all.filter(o => String(o.payment_status) === histFilter);
    }

    renderOrdersList(histListEl, all, { mode: "HIST" });
    setHistStatus(`${all.length} pedidos (filtro: ${histFilter === "ALL" ? "Todos" : histFilter}).`);
  } catch (e) {
    const msg = String(e.message || "");
    setHistStatus("❌ " + msg);
  } finally {
    hideLoading();
  }
}

// =================== Render ===================
function renderOrdersList(container, orders, { mode }) {
  container.innerHTML = "";

  if (!orders || orders.length === 0) {
    container.innerHTML = `<div class="mutedSmall" style="text-align:center; padding:14px;">No hay pedidos.</div>`;
    return;
  }

  for (const order of orders) {
    const card = document.createElement("div");
    card.className = "orderItem";

    const head = document.createElement("div");
    head.className = "orderHead";

    const statusBadge = (mode === "HIST")
      ? `<span class="badge">${escapeHtml(order.payment_status || "")}</span>`
      : "";

    head.innerHTML = `
      <div style="min-width:0;">
        <div class="orderId">
          ${escapeHtml(order.order_id || "")}
          <span class="badge">$${money(order.subtotal || 0)}</span>
          ${statusBadge}
        </div>
        <div class="orderMeta">${escapeHtml(order.customer_name || "")} • ${escapeHtml(formatDate(order.created_at || ""))}</div>
      </div>
      <div class="chev">›</div>
    `;

    const body = document.createElement("div");
    body.className = "orderBody";
    body.style.display = "none";

    head.addEventListener("click", () => {
      const open = body.style.display !== "none";
      body.style.display = open ? "none" : "block";
      card.classList.toggle("open", !open);
    });

    if (mode === "PENDIENTES") {
      body.appendChild(renderPendingBody(order));
    } else {
      body.appendChild(renderHistBody(order));
    }

    card.appendChild(head);
    card.appendChild(body);
    container.appendChild(card);
  }
}

function renderHistBody(order) {
  const wrap = document.createElement("div");

  const items = normalizeItemsFromOrder(order);
  const lines = items.length
    ? items.map(it => `<div class="mutedSmall">• ${escapeHtml(it.name)} x${Number(it.qty || 0)}</div>`).join("")
    : `<div class="mutedSmall">Sin items</div>`;

  wrap.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:8px;">
      <div><strong>Dirección:</strong> ${escapeHtml(order.address_text || "")}</div>
      <div><strong>Ubicación:</strong> ${escapeHtml(order.maps_link || "")}</div>
      <div><strong>Tel:</strong> ${escapeHtml(order.phone || "")}</div>
      <div><strong>Notas:</strong> ${escapeHtml(order.notes || "")}</div>
      <div><strong>Items:</strong><div style="margin-top:6px;">${lines}</div></div>
    </div>
  `;
  return wrap;
}

function renderPendingBody(order) {
  const wrap = document.createElement("div");

  let editMode = false;

  // snapshot
  const original = {
    customer_name: order.customer_name,
    phone: order.phone,
    address_text: order.address_text,
    maps_link: order.maps_link,
    notes: order.notes,
    items_json: order.items_json,
    items: order.items
  };

  let items = buildEditableItems(order);
  let totals = calcTotals(items);

  function showInlineAlert(msg) {
    const el = wrap.querySelector(".inlineAlert");
    if (!el) return;
    el.textContent = msg || "";
    el.style.display = msg ? "" : "none";
  }

  function validateNotEmpty() {
    if (!editMode) return true;
    const nameV = wrap.querySelector(".f_name").value.trim();
    const phoneV = wrap.querySelector(".f_phone").value.trim();
    const addrV = wrap.querySelector(".f_address").value.trim();
    if (!nameV || !phoneV || !addrV) {
      showInlineAlert("Completa: nombre, teléfono y dirección.");
      return false;
    }
    showInlineAlert("");
    return true;
  }

  function render() {
    const itemsLines = items.map((it, idx) => {
      return `
        <div class="rowBetween" style="gap:10px;">
          <div style="flex:1;">
            <div style="font-weight:900;">${escapeHtml(it.name)}</div>
            <div class="mutedSmall">$${money(it.unit_price)} c/u</div>
          </div>
          <div style="min-width:120px; text-align:right;">
            ${editMode
              ? `<input class="input itemQty" type="number" min="0" step="1" value="${Number(it.qty || 0)}" data-idx="${idx}" style="width:110px; text-align:right;" />`
              : `<div style="font-weight:900;">x${Number(it.qty || 0)}</div>`
            }
          </div>
        </div>
      `;
    }).join("");

    wrap.innerHTML = `
      <div class="inlineAlert" style="display:none; margin:8px 0; color:#b00020; font-weight:900;"></div>

      <div class="grid2" style="gap:10px;">
        <div>
          <div class="mutedSmall">Nombre</div>
          ${editMode ? `<input class="input f_name" value="${escapeHtml(order.customer_name || "")}" />`
                    : `<div style="font-weight:900;">${escapeHtml(order.customer_name || "")}</div>`}
        </div>
        <div>
          <div class="mutedSmall">Teléfono</div>
          ${editMode ? `<input class="input f_phone" value="${escapeHtml(order.phone || "")}" />`
                    : `<div style="font-weight:900;">${escapeHtml(order.phone || "")}</div>`}
        </div>
      </div>

      <div style="margin-top:10px;">
        <div class="mutedSmall">Dirección</div>
        ${editMode ? `<input class="input f_address" value="${escapeHtml(order.address_text || "")}" />`
                  : `<div style="font-weight:900;">${escapeHtml(order.address_text || "")}</div>`}
      </div>

      <div style="margin-top:10px;">
        <div class="mutedSmall">Ubicación</div>
        ${editMode ? `<input class="input f_maps" value="${escapeHtml(order.maps_link || "")}" placeholder="Link Maps / WhatsApp" />`
                  : `<div style="font-weight:900;">${escapeHtml(order.maps_link || "")}</div>`}
      </div>

      <div style="margin-top:10px;">
        <div class="mutedSmall">Notas</div>
        ${editMode ? `<textarea class="textarea f_notes" rows="2">${escapeHtml(order.notes || "")}</textarea>`
                  : `<div style="font-weight:900;">${escapeHtml(order.notes || "")}</div>`}
      </div>

      <div style="margin-top:12px;">
        <div class="mutedSmall" style="font-weight:900;">Items</div>
        <div style="display:flex; flex-direction:column; gap:10px; margin-top:8px;">${itemsLines}</div>
      </div>

      <div class="rowBetween" style="margin-top:12px;">
        <div class="mutedSmall">Unidades</div>
        <div class="t_units" style="font-weight:950;">${Number(totals.total_units)}</div>
      </div>
      <div class="rowBetween">
        <div class="mutedSmall">Subtotal</div>
        <div class="t_subtotal" style="font-weight:950;">$${money(totals.subtotal)}</div>
      </div>

      <div style="margin-top:12px; display:flex; gap:10px; flex-wrap:wrap;">
        ${!editMode ? `<button class="btn secondary btnEdit" type="button">Editar</button>` : ""}
        ${editMode ? `<button class="btn secondary btnSave" type="button">Guardar cambios</button>` : ""}
        ${editMode ? `<button class="btn secondary btnCancelEdit" type="button">Cancelar edición</button>` : ""}
        <button class="btn btnDanger btnCancel" type="button">Cancelar Pedido</button>
        <button class="btn primary btnPay" type="button">Confirmar pago</button>
      </div>
    `;

    // live updates
    if (editMode) {
      wrap.querySelectorAll(".itemQty").forEach(inp => {
        inp.addEventListener("input", () => {
          const idx = Number(inp.dataset.idx);
          items[idx].qty = Number(inp.value || 0);
          totals = calcTotals(items);
          wrap.querySelector(".t_units").textContent = String(totals.total_units);
          wrap.querySelector(".t_subtotal").textContent = `$${money(totals.subtotal)}`;
          validateNotEmpty();
        });
      });

      wrap.querySelector(".f_name")?.addEventListener("input", validateNotEmpty);
      wrap.querySelector(".f_phone")?.addEventListener("input", validateNotEmpty);
      wrap.querySelector(".f_address")?.addEventListener("input", validateNotEmpty);
    }

    // handlers
    wrap.querySelector(".btnEdit")?.addEventListener("click", () => {
      editMode = true;
      render();
    });

    wrap.querySelector(".btnCancelEdit")?.addEventListener("click", () => {
      editMode = false;

      order.customer_name = original.customer_name;
      order.phone = original.phone;
      order.address_text = original.address_text;
      order.maps_link = original.maps_link;
      order.notes = original.notes;
      order.items_json = original.items_json;
      order.items = original.items;

      items = buildEditableItems(order);
      totals = calcTotals(items);
      showInlineAlert("");
      render();
    });

    wrap.querySelector(".btnSave")?.addEventListener("click", async () => {
      if (!validateNotEmpty()) return;

      const customer_name = wrap.querySelector(".f_name").value.trim();
      const phone = wrap.querySelector(".f_phone").value.trim();
      const address_text = wrap.querySelector(".f_address").value.trim();
      const maps_link = wrap.querySelector(".f_maps").value.trim();
      const notes = wrap.querySelector(".f_notes").value.trim();

      // Formato esperado por tu Apps Script: [{id,name,qty,price}]
      const updatedItems = items
        .map(it => ({
          id: it.id,
          name: it.name,
          qty: Number(it.qty || 0),
          price: Number(it.unit_price || 0)
        }))
        .filter(it => it.qty > 0);

      try {
        showLoading("Guardando cambios...");
        setStatus("Guardando...");

        await api({
          action: "update_order",
          admin_pin: SESSION.pin,
          operator: SESSION.operator,
          order_id: order.order_id,
          customer_name,
          phone,
          address_text,
          maps_link,
          notes,
          items: updatedItems
        });

        // actualizar local
        order.customer_name = customer_name;
        order.phone = phone;
        order.address_text = address_text;
        order.maps_link = maps_link;
        order.notes = notes;
        order.items_json = JSON.stringify(updatedItems.map(it => ({
          id: it.id, name: it.name, qty: it.qty, unit_price: it.price
        })));

        items = buildEditableItems(order);
        totals = calcTotals(items);

        setStatus("✅ Cambios guardados.");
        editMode = false;

        HIST_CACHE = null;
        HIST_CACHE_TIME = 0;

        render();
        await softRefreshPendientes();
      } catch (e) {
        setStatus("❌ " + (e.message || "No se pudo guardar."));
      } finally {
        hideLoading();
      }
    });

    wrap.querySelector(".btnPay")?.addEventListener("click", () => {
      if (editMode && !validateNotEmpty()) return;
      openPayModal(order);
    });

    wrap.querySelector(".btnCancel")?.addEventListener("click", () => {
      openCancelModal(order);
    });
  }

  render();
  return wrap;
}

// =================== Modal helpers ===================
function openModal(el) {
  el.classList.add("show");
  el.setAttribute("aria-hidden", "false");
}
function closeModal(el) {
  el.classList.remove("show");
  el.setAttribute("aria-hidden", "true");
}

// =================== PAGO ===================
payMethod.addEventListener("change", () => {
  payOtherWrap.classList.toggle("hidden", payMethod.value !== "Otro");
  resetPayTimerIfNeeded();
  maybeStartPayTimer();
});
payOtherText.addEventListener("input", () => { resetPayTimerIfNeeded(); maybeStartPayTimer(); });
payRef.addEventListener("input", () => { resetPayTimerIfNeeded(); maybeStartPayTimer(); });

btnPayBack.addEventListener("click", closePayModal);

function openPayModal(order) {
  modalOrder = order;

  payMethod.value = "";
  payRef.value = "";
  payOtherText.value = "";
  payOtherWrap.classList.add("hidden");

  btnPayConfirm.disabled = true;
  payTimer.textContent = "Completa los datos para iniciar la confirmación.";
  payTimerStarted = false;

  payTitle.textContent = "Confirmar pago";
  payText.textContent = `Confirma el pago del pedido ${order.order_id} por $${money(order.subtotal)}.`;

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
  if (payTimerStarted) return;
  if (!isPayValid()) {
    btnPayConfirm.disabled = true;
    payTimer.textContent = "Completa los datos para iniciar la confirmación.";
    return;
  }
  startPayCountdown(3);
}

function resetPayTimerIfNeeded() {
  if (!payTimerStarted) return;
  stopPayCountdown();
  btnPayConfirm.disabled = true;
  payTimer.textContent = "Completa los datos para iniciar la confirmación.";
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

function stopPayCountdown(resetStarted = true) {
  if (payCountdownInt) clearInterval(payCountdownInt);
  payCountdownInt = null;
  if (resetStarted) payTimerStarted = false;
}

btnPayConfirm.addEventListener("click", async () => {
  if (!modalOrder) return;
  if (!isPayValid()) return;

  const finalMethod = (payMethod.value === "Otro") ? payOtherText.value.trim() : payMethod.value;
  const finalRef = payRef.value.trim();

  try {
    // UI optimista
    pendingOrdersCache = pendingOrdersCache.filter(o => o.order_id !== modalOrder.order_id);
    renderOrdersList(listEl, pendingOrdersCache, { mode: "PENDIENTES" });
    setStatus("Procesando confirmación...");

    closePayModal();
    showLoading("Confirmando pago...");

    // ✅ acción oficial (tu Worker puede traducir a mark_paid)
    await api({
      action: "confirm_payment",
      admin_pin: SESSION.pin,
      operator: SESSION.operator,
      order_id: modalOrder.order_id,
      payment_method: finalMethod,
      payment_ref: finalRef
    });

    setStatus("✅ Pago confirmado. Pedido removido de Pendientes.");
    HIST_CACHE = null; HIST_CACHE_TIME = 0;

    await softRefreshPendientes();
  } catch (e) {
    setStatus("❌ " + (e.message || "Error confirmando pago."));
    await softRefreshPendientes();
  } finally {
    hideLoading();
  }
});

// =================== CANCELAR ===================
cancelReason.addEventListener("change", () => {
  cancelOtherWrap.classList.toggle("hidden", cancelReason.value !== "Otro");
  resetCancelTimerIfNeeded();
  maybeStartCancelTimer();
});
cancelOtherText.addEventListener("input", () => { resetCancelTimerIfNeeded(); maybeStartCancelTimer(); });

btnCancelBack.addEventListener("click", closeCancelModal);

function openCancelModal(order) {
  modalOrder = order;

  cancelReason.value = "";
  cancelOtherText.value = "";
  cancelOtherWrap.classList.add("hidden");

  btnCancelConfirm.disabled = true;
  cancelTimer.textContent = "Selecciona una razón para habilitar la cancelación.";
  cancelTimerStarted = false;

  cancelTitle.textContent = "Cancelar pedido";
  cancelText.textContent = `Vas a cancelar el pedido ${order.order_id} por $${money(order.subtotal)}.`;

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
  if (cancelTimerStarted) return;
  if (!isCancelValid()) {
    btnCancelConfirm.disabled = true;
    cancelTimer.textContent = "Selecciona una razón para habilitar la cancelación.";
    return;
  }
  startCancelCountdown(3);
}

function resetCancelTimerIfNeeded() {
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

function stopCancelCountdown(resetStarted = true) {
  if (cancelCountdownInt) clearInterval(cancelCountdownInt);
  cancelCountdownInt = null;
  if (resetStarted) cancelTimerStarted = false;
}

btnCancelConfirm.addEventListener("click", async () => {
  if (!modalOrder) return;
  if (!isCancelValid()) return;

  const reason = (cancelReason.value === "Otro") ? cancelOtherText.value.trim() : cancelReason.value;

  try {
    // UI optimista
    pendingOrdersCache = pendingOrdersCache.filter(o => o.order_id !== modalOrder.order_id);
    renderOrdersList(listEl, pendingOrdersCache, { mode: "PENDIENTES" });
    setStatus("Procesando cancelación...");

    closeCancelModal();
    showLoading("Cancelando pedido...");

    await api({
      action: "cancel_order",
      admin_pin: SESSION.pin,
      operator: SESSION.operator,
      order_id: modalOrder.order_id,
      cancel_reason: reason
    });

    setStatus("✅ Pedido cancelado. Removido de Pendientes.");
    HIST_CACHE = null; HIST_CACHE_TIME = 0;

    await softRefreshPendientes();
  } catch (e) {
    setStatus("❌ " + (e.message || "Error cancelando pedido."));
    await softRefreshPendientes();
  } finally {
    hideLoading();
  }
});

// =================== INIT ===================
(function init() {
  const saved = sessionStorage.getItem("AMARED_ADMIN");
  if (saved) {
    try {
      SESSION = JSON.parse(saved);
      if (SESSION?.operator && SESSION?.pin) {
        showPanel();
        loadPendientes(false).catch(() => {
          // si pin inválido / CORS / etc
          SESSION = { operator: null, pin: null };
          sessionStorage.removeItem("AMARED_ADMIN");
          showLogin();
        });
      }
    } catch { /* ignore */ }
  }
})();
