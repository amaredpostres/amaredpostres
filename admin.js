// =================== CONFIG ===================
const API_URL = "https://amared-orders.amaredpostres.workers.dev/";

// Catálogo (mismo de tu web pública)
const PRODUCT_CATALOG = [
  { id: "mousse_maracuya", name: "Mousse de Maracuyá", unit_price: 10000 },
  { id: "cheesecake_cafe_panela", name: "Cheesecake de café con panela", unit_price: 12500 },
];

// =================== SESSION / STATE ===================
let SESSION = { operator: null, pin: null };
let REQUEST_IN_FLIGHT = false;

let pendingOrdersCache = [];
let HIST_CACHE = null;  // { paid:[], canceled:[] }
let HIST_CACHE_TIME = 0;
const HIST_TTL = 60 * 1000;
let histFilter = "ALL";

let modalOrder = null;

// timers
let payCountdownInt = null;
let cancelCountdownInt = null;
let payTimerStarted = false;
let cancelTimerStarted = false;

// Loading overlay counter
let LOADING_COUNT = 0;

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

// =================== UTILS ===================
function setStatus(msg) { if (statusEl) statusEl.textContent = msg || ""; }
function setHistStatus(msg) { if (histStatusEl) histStatusEl.textContent = msg || ""; }

function money(n) {
  return Math.round(Number(n || 0)).toLocaleString("es-CO");
}
function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}
function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function formatDate(v) {
  if (!v) return "";
  const d = new Date(v);

  // Si no es una fecha válida, devuelve el texto tal cual
  if (Number.isNaN(d.getTime())) return String(v);

  // Mostrar en hora de Colombia (Ibagué): America/Bogota (UTC-5)
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(d);
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// =================== LOADING (UX) ===================
function showLoading(text = "Cargando...") {
  LOADING_COUNT++;
  if (loadingText) loadingText.textContent = text;
  if (loadingOverlay) loadingOverlay.classList.add("show");
}
function hideLoading() {
  LOADING_COUNT = Math.max(0, LOADING_COUNT - 1);
  if (LOADING_COUNT === 0 && loadingOverlay) loadingOverlay.classList.remove("show");
}

// =================== API (logs + retry 429) ===================
async function api(body, retries = 2) {
  console.log("➡️ API request:", body);

  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  console.log("⬅️ API status:", res.status);

  if (res.status === 429 && retries > 0) {
    await sleep(650 * (3 - retries));
    return api(body, retries - 1);
  }

  const out = await res.json().catch(async () => ({ ok:false, error: await res.text().catch(() => "") }));
  console.log("⬅️ API response:", out);

  if (!out.ok) throw new Error(out.error || "Error");
  return out;
}

// =================== NAV (login/panel) ===================
function showPanel() {
  if (loginView) loginView.classList.add("hidden");
  if (panelView) panelView.classList.remove("hidden");
  if (operatorName) operatorName.textContent = SESSION.operator || "";
}
function showLogin() {
  if (panelView) panelView.classList.add("hidden");
  if (loginView) loginView.classList.remove("hidden");
}

// =================== Drawer ===================
function openDrawer() {
  if (drawerOverlay) drawerOverlay.classList.add("show");
  if (drawer) drawer.setAttribute("aria-hidden", "false");
}
function closeDrawer() {
  if (drawerOverlay) drawerOverlay.classList.remove("show");
  if (drawer) drawer.setAttribute("aria-hidden", "true");
}

// =================== MODALS ===================
function openModal(el) {
  if (!el) return;
  el.classList.add("show");
  el.setAttribute("aria-hidden", "false");
}
function closeModal(el) {
  if (!el) return;
  el.classList.remove("show");
  el.setAttribute("aria-hidden", "true");
}

// =================== ITEMS HELPERS ===================
function normalizeItemsFromOrder(order) {
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

  const base = PRODUCT_CATALOG.map(p => ({
    id: p.id,
    name: p.name,
    qty: map.get(p.id)?.qty ?? 0,
    unit_price: p.unit_price
  }));

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
btnLogin?.addEventListener("click", async () => {
  loginError.textContent = "";
  const operator = (loginOperator?.value || "").trim();
  const pin = (loginPin?.value || "").trim();

  if (!operator || !pin) {
    loginError.textContent = "Completa todos los campos.";
    return;
  }

  try {
    showLoading("Verificando acceso...");
    SESSION = { operator, pin };
    sessionStorage.setItem("AMARED_ADMIN", JSON.stringify(SESSION));

    showPanel();
    await loadPendientes(false); // valida login
  } catch (e) {
    SESSION = { operator: null, pin: null };
    sessionStorage.removeItem("AMARED_ADMIN");
    showLogin();
    loginError.textContent = `Error: ${String(e.message || e)}`;
  } finally {
    hideLoading();
  }
});

btnLogout?.addEventListener("click", () => {
  SESSION = { operator: null, pin: null };
  sessionStorage.removeItem("AMARED_ADMIN");
  closeDrawer();
  showLogin();
});

// =================== PENDIENTES ===================
btnRefresh?.addEventListener("click", async () => loadPendientes(true));

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
  } catch (e) {
    setStatus("❌ " + String(e.message || e));
    throw e;
  } finally {
    hideLoading();
    REQUEST_IN_FLIGHT = false;
  }
}

async function softRefreshPendientes() {
  await sleep(700);
  try { await loadPendientes(true); } catch {}
}

// =================== HISTORIAL ===================
btnHistory?.addEventListener("click", async () => {
  openDrawer();
  await loadHist(false);
});

drawerOverlay?.addEventListener("click", closeDrawer);
btnCloseDrawer?.addEventListener("click", closeDrawer);
btnHistRefresh?.addEventListener("click", async () => loadHist(true));

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
    if (histListEl) histListEl.innerHTML = "";

    const now = Date.now();
    const useCache = HIST_CACHE && (now - HIST_CACHE_TIME) < HIST_TTL;

    if (forceFetch || !useCache) {
      const [paid, canceled] = await Promise.all([
        api({ action: "list_orders", admin_pin: SESSION.pin, payment_status: "Pagado" }),
        api({ action: "list_orders", admin_pin: SESSION.pin, payment_status: "Cancelado" }),
      ]);
      HIST_CACHE = { paid: (paid.orders || []), canceled: (canceled.orders || []) };
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
    if (msg.toLowerCase().includes("too many") || msg.includes("429")) {
      setHistStatus("⚠️ Muchas solicitudes seguidas. Espera 2–3 segundos y presiona Refrescar.");
    } else {
      setHistStatus("❌ " + msg);
    }
  } finally {
    hideLoading();
  }
}

// =================== RENDER ===================
function renderOrdersList(container, orders, { mode }) {
  if (!container) return;
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

    if (mode === "PENDIENTES") body.appendChild(renderPendingBody(order));
    else body.appendChild(renderHistBody(order));

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
      ${order.payment_status === "Pagado" ? `
        <div class="mutedSmall"><strong>Método:</strong> ${escapeHtml(order.payment_method || "")} • <strong>Ref:</strong> ${escapeHtml(order.payment_ref || "")}</div>
      ` : ""}
      ${order.payment_status === "Cancelado" ? `
        <div class="mutedSmall"><strong>Razón:</strong> ${escapeHtml(order.cancel_reason || "")}</div>
      ` : ""}
    </div>
  `;
  return wrap;
}


function renderPendingBody(order) {
  const wrap = document.createElement("div");
  let editMode = false;

  // Copia editable inicial (para poder cancelar edición)
  const initialFields = {
    customer_name: String(order.customer_name || ""),
    phone: String(order.phone || ""),
    address_text: String(order.address_text || ""),
    maps_link: String(order.maps_link || ""),
    notes: String(order.notes || ""),
    email: String(order.email || ""),
    wa_opt_in: Boolean(order.wa_opt_in),
  };

  let fields = { ...initialFields };

  let items = buildEditableItems(order);
  let totals = calcTotals(items);

  function render() {
    const itemsLines = items.map((it, idx) => `
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
    `).join("");

    wrap.innerHTML = `
      <div style="margin-top:10px; display:flex; flex-direction:column; gap:10px;">

        ${!editMode ? `
          <div><strong>Nombre:</strong> ${escapeHtml(fields.customer_name)}</div>
          <div><strong>Tel:</strong> ${escapeHtml(fields.phone)}</div>
          <div><strong>Dirección:</strong> ${escapeHtml(fields.address_text)}</div>
          <div><strong>Ubicación:</strong> ${escapeHtml(fields.maps_link)}</div>
          <div><strong>Email:</strong> ${escapeHtml(fields.email)}</div>
          <div><strong>Opt-in WhatsApp:</strong> ${fields.wa_opt_in ? "Sí" : "No"}</div>
          <div><strong>Notas:</strong> ${escapeHtml(fields.notes)}</div>
        ` : `
          <div>
            <div class="mutedSmall" style="font-weight:900;">Nombre</div>
            <input id="ed_name" class="input" type="text" value="${escapeHtml(fields.customer_name)}" />
          </div>

          <div>
            <div class="mutedSmall" style="font-weight:900;">Teléfono</div>
            <input id="ed_phone" class="input" type="text" value="${escapeHtml(fields.phone)}" />
            <div class="mutedSmall">Tip: déjalo como texto para no perder ceros.</div>
          </div>

          <div>
            <div class="mutedSmall" style="font-weight:900;">Dirección</div>
            <input id="ed_addr" class="input" type="text" value="${escapeHtml(fields.address_text)}" />
          </div>

          <div>
            <div class="mutedSmall" style="font-weight:900;">Ubicación (Maps/WhatsApp)</div>
            <input id="ed_maps" class="input" type="text" value="${escapeHtml(fields.maps_link)}" />
          </div>

          <div>
            <div class="mutedSmall" style="font-weight:900;">Email (opcional)</div>
            <input id="ed_email" class="input" type="email" value="${escapeHtml(fields.email)}" />
          </div>

          <div style="display:flex; align-items:center; gap:10px;">
            <input id="ed_optin" type="checkbox" ${fields.wa_opt_in ? "checked" : ""} />
            <label for="ed_optin"><strong>Opt-in WhatsApp</strong></label>
          </div>

          <div>
            <div class="mutedSmall" style="font-weight:900;">Notas</div>
            <textarea id="ed_notes" class="input" rows="3" style="resize:vertical;">${escapeHtml(fields.notes)}</textarea>
          </div>
        `}
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
        ${!editMode ? `<button class="btn secondary btnEdit" type="button">Editar pedido</button>` : ""}
        ${editMode ? `<button class="btn secondary btnSave" type="button">Guardar cambios</button>` : ""}
        ${editMode ? `<button class="btn secondary btnCancelEdit" type="button">Cancelar edición</button>` : ""}

        <button class="btn btnDanger btnCancel" type="button">Cancelar Pedido</button>
        <button class="btn primary btnPay" type="button">Confirmar pago</button>
      </div>
    `;

    // ====== En modo edición: listeners para items ======
    if (editMode) {
      wrap.querySelectorAll(".itemQty").forEach(inp => {
        inp.addEventListener("input", () => {
          const idx = Number(inp.dataset.idx);
          items[idx].qty = Number(inp.value || 0);
          totals = calcTotals(items);
          wrap.querySelector(".t_units").textContent = String(totals.total_units);
          wrap.querySelector(".t_subtotal").textContent = `$${money(totals.subtotal)}`;
        });
      });

      // ====== listeners para campos ======
      const ed_name = wrap.querySelector("#ed_name");
      const ed_phone = wrap.querySelector("#ed_phone");
      const ed_addr = wrap.querySelector("#ed_addr");
      const ed_maps = wrap.querySelector("#ed_maps");
      const ed_email = wrap.querySelector("#ed_email");
      const ed_notes = wrap.querySelector("#ed_notes");
      const ed_optin = wrap.querySelector("#ed_optin");

      const syncFields = () => {
        fields.customer_name = (ed_name?.value || "").trim();
        fields.phone = (ed_phone?.value || "").trim();
        fields.address_text = (ed_addr?.value || "").trim();
        fields.maps_link = (ed_maps?.value || "").trim();
        fields.email = (ed_email?.value || "").trim();
        fields.notes = (ed_notes?.value || "").trim();
        fields.wa_opt_in = !!ed_optin?.checked;
      };

      [ed_name, ed_phone, ed_addr, ed_maps, ed_email, ed_notes].forEach(el => {
        el?.addEventListener("input", syncFields);
      });
      ed_optin?.addEventListener("change", syncFields);
    }

    // ====== Botones ======
    wrap.querySelector(".btnEdit")?.addEventListener("click", () => {
      editMode = true;
      render();
    });

    wrap.querySelector(".btnCancelEdit")?.addEventListener("click", () => {
      editMode = false;
      fields = { ...initialFields };
      items = buildEditableItems(order);
      totals = calcTotals(items);
      render();
    });

    wrap.querySelector(".btnSave")?.addEventListener("click", async () => {
      try {
        showLoading("Guardando cambios...");
        setStatus("Guardando cambios del pedido...");

        // Validaciones mínimas (antes de enviar)
        if (!fields.customer_name.trim()) {
          alert("El nombre no puede quedar vacío.");
          return;
        }
        if (!fields.phone.trim()) {
          alert("El teléfono no puede quedar vacío.");
          return;
        }
        if (!fields.address_text.trim()) {
          alert("La dirección no puede quedar vacía.");
          return;
        }

        const updatedItems = items
          .map(it => ({
            id: it.id,
            name: it.name,
            qty: Number(it.qty || 0),
            price: Number(it.unit_price || 0)
          }))
          .filter(it => it.qty > 0);

        await api({
          action: "update_order",
          admin_pin: SESSION.pin,
          operator: SESSION.operator,
          order_id: order.order_id,

          // ✅ campos completos editables
          customer_name: fields.customer_name,
          phone: fields.phone,
          address_text: fields.address_text,
          maps_link: fields.maps_link,
          notes: fields.notes,
          email: fields.email,
          wa_opt_in: fields.wa_opt_in,

          // ✅ items (recalcula subtotal/unidades en backend)
          items: updatedItems
        });

        // Actualiza el objeto local para que al cerrar edición se vea lo nuevo
        order.customer_name = fields.customer_name;
        order.phone = fields.phone;
        order.address_text = fields.address_text;
        order.maps_link = fields.maps_link;
        order.notes = fields.notes;
        order.email = fields.email;
        order.wa_opt_in = fields.wa_opt_in;

        order.items_json = JSON.stringify(updatedItems.map(it => ({
          id: it.id, name: it.name, qty: it.qty, unit_price: it.price
        })));

        // refrescar totals local
        items = buildEditableItems(order);
        totals = calcTotals(items);

        // cerrar edición
        editMode = false;

        // actualiza snapshot “inicial” para futuras ediciones
        initialFields.customer_name = fields.customer_name;
        initialFields.phone = fields.phone;
        initialFields.address_text = fields.address_text;
        initialFields.maps_link = fields.maps_link;
        initialFields.notes = fields.notes;
        initialFields.email = fields.email;
        initialFields.wa_opt_in = fields.wa_opt_in;

        setStatus("✅ Pedido actualizado (solo permitido si estaba Pendiente).");
        HIST_CACHE = null; HIST_CACHE_TIME = 0;

        render();
        await softRefreshPendientes();

      } catch (e) {
        const msg = String(e.message || e);
        // Si intentan editar después de pagado/cancelado, el backend responde Locked
        if (msg.toLowerCase().includes("locked")) {
          alert("Este pedido ya no está Pendiente. No se puede editar después de confirmar/cancelar.");
        }
        setStatus("❌ " + msg);
      } finally {
        hideLoading();
      }
    });

    wrap.querySelector(".btnPay")?.addEventListener("click", () => openPayModal(order));
    wrap.querySelector(".btnCancel")?.addEventListener("click", () => openCancelModal(order));
  }

  render();
  return wrap;
}

// =================== PAGO ===================
payMethod?.addEventListener("change", () => {
  payOtherWrap?.classList.toggle("hidden", payMethod.value !== "Otro");
  resetPayTimerIfNeeded();
  maybeStartPayTimer();
});
payOtherText?.addEventListener("input", () => { resetPayTimerIfNeeded(); maybeStartPayTimer(); });
payRef?.addEventListener("input", () => { resetPayTimerIfNeeded(); maybeStartPayTimer(); });

btnPayBack?.addEventListener("click", closePayModal);

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

btnPayConfirm?.addEventListener("click", async () => {
  if (!modalOrder) return;
  if (!isPayValid()) return;

  const finalMethod = (payMethod.value === "Otro") ? payOtherText.value.trim() : payMethod.value;
  const finalRef = payRef.value.trim();

  const orderId = modalOrder.order_id;

  try {
    // ✅ UI optimista: remover YA del listado
    pendingOrdersCache = pendingOrdersCache.filter(o => o.order_id !== orderId);
    renderOrdersList(listEl, pendingOrdersCache, { mode: "PENDIENTES" });
    setStatus("Procesando confirmación de pago...");

    closePayModal();
    showLoading("Confirmando pago...");

    await api({
      action: "confirm_payment",
      admin_pin: SESSION.pin,
      operator: SESSION.operator,
      order_id: orderId,
      payment_method: finalMethod,
      payment_ref: finalRef
    });

    setStatus("✅ Pago confirmado. Removido de Pendientes.");
    HIST_CACHE = null; HIST_CACHE_TIME = 0;

    await softRefreshPendientes();
  } catch (e) {
    const msg = String(e.message || "");
    if (msg.toLowerCase().includes("too many") || msg.includes("429")) {
      setStatus("⚠️ Confirmado, pero hay muchas solicitudes. Refresca en unos segundos si no ves el cambio.");
    } else {
      setStatus("❌ " + msg);
    }
    await softRefreshPendientes();
  } finally {
    hideLoading();
  }
});

// =================== CANCELAR ===================
cancelReason?.addEventListener("change", () => {
  cancelOtherWrap?.classList.toggle("hidden", cancelReason.value !== "Otro");
  resetCancelTimerIfNeeded();
  maybeStartCancelTimer();
});
cancelOtherText?.addEventListener("input", () => { resetCancelTimerIfNeeded(); maybeStartCancelTimer(); });

btnCancelBack?.addEventListener("click", closeCancelModal);

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

btnCancelConfirm?.addEventListener("click", async () => {
  if (!modalOrder) return;
  if (!isCancelValid()) return;

  const reason = (cancelReason.value === "Otro") ? cancelOtherText.value.trim() : cancelReason.value;
  const orderId = modalOrder.order_id;

  try {
    // ✅ UI optimista: remover YA del listado
    pendingOrdersCache = pendingOrdersCache.filter(o => o.order_id !== orderId);
    renderOrdersList(listEl, pendingOrdersCache, { mode: "PENDIENTES" });
    setStatus("Procesando cancelación...");

    closeCancelModal();
    showLoading("Cancelando pedido...");

    await api({
      action: "cancel_order",
      admin_pin: SESSION.pin,
      operator: SESSION.operator,
      order_id: orderId,
      cancel_reason: reason
    });

    setStatus("✅ Pedido cancelado. Removido de Pendientes.");
    HIST_CACHE = null; HIST_CACHE_TIME = 0;

    await softRefreshPendientes();
  } catch (e) {
    const msg = String(e.message || "");
    if (msg.toLowerCase().includes("too many") || msg.includes("429")) {
      setStatus("⚠️ Cancelado, pero hay muchas solicitudes. Refresca en unos segundos si no ves el cambio.");
    } else {
      setStatus("❌ " + msg);
    }
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
          SESSION = { operator: null, pin: null };
          sessionStorage.removeItem("AMARED_ADMIN");
          showLogin();
        });
      }
    } catch {}
  }
})();


