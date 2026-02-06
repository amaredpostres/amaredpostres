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

// ===== UTILS =====
function setStatus(msg) { statusEl.textContent = msg || ""; }
function setHistStatus(msg) { histStatusEl.textContent = msg || ""; }
function money(n) { return Math.round(Number(n || 0)).toLocaleString("es-CO"); }
function safeJsonParse(s){ try { return JSON.parse(s); } catch { return null; } }

function showLoading(text="Cargando...") {
  LOADING_COUNT++;
  loadingText.textContent = text;
  loadingOverlay.classList.add("show");
}
function hideLoading() {
  LOADING_COUNT = Math.max(0, LOADING_COUNT - 1);
  if (LOADING_COUNT === 0) loadingOverlay.classList.remove("show");
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
  const s = String(v || "").trim();
  if (s.includes("T")) return s.replace(".000Z","").replace("T"," ");
  return s;
}

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

// ===== API con reintento 429 =====
async function api(body, retries = 2) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify(body)
  });

  if (res.status === 429 && retries > 0) {
    await sleep(600 * (3 - retries)); // 600ms, 1200ms
    return api(body, retries - 1);
  }

  const out = await res.json().catch(async ()=>({ ok:false, error: await res.text() }));
  if (!out.ok) throw new Error(out.error || "Error");
  return out;
}

// ===== ITEMS =====
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

  // fallback items en texto "- Nombre: 2"
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
  const current = normalizeItemsFromOrder(order);
  const map = new Map(current.map(it => [it.id, it]));

  const base = PRODUCT_CATALOG.map(p => ({
    id: p.id,
    name: p.name,
    qty: map.get(p.id)?.qty ?? 0,
    unit_price: p.unit_price
  }));

  // conservar items extra no catalogados
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
// Login = 1 sola request (loadPendientes valida PIN)
btnLogin.addEventListener("click", async () => {
  loginError.textContent = "";
  const operator = loginOperator.value.trim();
  const pin = loginPin.value.trim();
  if (!operator || !pin) { loginError.textContent = "Completa todos los campos."; return; }

  try {
    showLoading("Verificando acceso...");
    SESSION = { operator, pin };
    sessionStorage.setItem("AMARED_ADMIN", JSON.stringify(SESSION));

    showPanel();
    await loadPendientes(false);
  } catch {
    SESSION = { operator:null, pin:null };
    sessionStorage.removeItem("AMARED_ADMIN");
    showLogin();
    loginError.textContent = "PIN incorrecto o temporalmente bloqueado. Intenta de nuevo.";
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
}

// ===== LOGOUT =====
btnLogout.addEventListener("click", () => {
  SESSION = { operator:null, pin:null };
  closeDrawer();
  sessionStorage.removeItem("AMARED_ADMIN");
  showLogin();
});

// ===== PENDIENTES =====
btnRefresh.addEventListener("click", async () => {
  await loadPendientes(true);
});

async function loadPendientes(fromRefresh=false) {
  if (REQUEST_IN_FLIGHT) return; // evita spam
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
    renderOrdersList(listEl, pendingOrdersCache, { mode:"PENDIENTES" });
    setStatus(`${pendingOrdersCache.length} pedidos pendientes.`);
  } catch (e) {
    const msg = String(e.message || "");
    if (msg.toLowerCase().includes("too many") || msg.includes("429")) {
      setStatus("⚠️ Muchas solicitudes seguidas. Espera 2–3 segundos y vuelve a intentar.");
    } else {
      setStatus("❌ " + msg);
    }
    throw e;
  } finally {
    hideLoading();
    REQUEST_IN_FLIGHT = false;
  }
}

// refresh “suave” después de acciones (reduce 429)
async function softRefreshPendientes() {
  // pequeño delay para evitar choque con el request que acaba de ocurrir
  await sleep(700);
  try { await loadPendientes(true); } catch { /* si falla 429, no pasa nada */ }
}

// ===== HISTORIAL =====
btnHistory.addEventListener("click", async () => {
  openDrawer();
  await loadHist(false);
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
    histFilter = ch.dataset.filter;
    await loadHist(false);
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

    const now = Date.now();
    const useCache = HIST_CACHE && (now - HIST_CACHE_TIME) < HIST_TTL;

    if (forceFetch || !useCache) {
      const [paid, canceled] = await Promise.all([
        api({ action:"list_orders", admin_pin: SESSION.pin, payment_status:"Pagado" }),
        api({ action:"list_orders", admin_pin: SESSION.pin, payment_status:"Cancelado" }),
      ]);
      HIST_CACHE = [...(paid.orders || []), ...(canceled.orders || [])];
      HIST_CACHE_TIME = now;
    }

    let all = [...(HIST_CACHE || [])];
    all.sort((a,b) => (Date.parse(b.created_at || "")||0) - (Date.parse(a.created_at || "")||0));

    if (histFilter !== "ALL") all = all.filter(o => String(o.payment_status) === histFilter);

    renderOrdersList(histListEl, all, { mode:"HIST" });
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
        <div class="orderId">
          ${escapeHtml(order.order_id)}
          <span class="badge">$${money(order.subtotal)}</span>
          ${statusBadge}
        </div>
        <div class="orderMeta">${escapeHtml(order.customer_name || "")} • ${escapeHtml(formatDate(order.created_at))}</div>
      </div>
      <div class="chev">›</div>
    `;

    const body = document.createElement("div");
    body.className = "orderBody";

    if (mode === "PENDIENTES") body.appendChild(renderPendingDetail(order, head));
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

// ===== DETAIL: HIST =====
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
  `;
  return wrap;
}

// ===== DETAIL: PENDIENTES =====
function renderPendingDetail(order, headEl) {
  const wrap = document.createElement("div");
  let editMode = false;

  let items = buildEditableItems(order);
  let totals = calcTotals(items);

  const originalSnapshot = {
    customer_name: order.customer_name || "",
    phone: order.phone || "",
    address_text: order.address_text || "",
    maps_link: order.maps_link || "",
    notes: order.notes || "",
    items: JSON.stringify(items)
  };

  function showInlineAlert(msg) {
    const el = wrap.querySelector(".inlineAlert");
    if (!el) return;
    el.textContent = msg || "";
    el.style.display = msg ? "block" : "none";
  }

  function updateHeaderBadge() {
    if (!headEl) return;
    const badge = headEl.querySelector(".badge");
    if (badge) badge.textContent = `$${money(order.subtotal ?? totals.subtotal)}`;
  }

  function computeTotalsFromInputsIfEditing() {
    if (!editMode) return;
    wrap.querySelectorAll(".itemQty").forEach(inp => {
      const idx = Number(inp.dataset.idx);
      items[idx].qty = Number(inp.value || 0);
    });
    totals = calcTotals(items);
  }

  function validateNotEmpty() {
    computeTotalsFromInputsIfEditing();
    if (totals.total_units <= 0) {
      showInlineAlert("⚠️ El pedido no puede quedar vacío. Agrega al menos 1 ítem.");
      return false;
    }
    showInlineAlert("");
    return true;
  }

  function render() {
    totals = calcTotals(items);

    const summaryStyle = editMode
      ? `background: rgba(246,186,96,.12); border:1px solid rgba(64,17,2,.12);`
      : `background: rgba(255,255,255,.55); border:1px solid rgba(64,17,2,.10);`;

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
      <div style="${summaryStyle} border-radius:14px; padding:10px 12px; display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap;">
        <div class="mutedSmall" style="font-weight:950;">
          Total actual: <span class="t_subtotal">$${money(totals.subtotal)}</span>
        </div>
        <div class="mutedSmall" style="font-weight:950;">
          Unidades: <span class="t_units">${totals.total_units}</span>
        </div>
      </div>

      <div class="inlineAlert mutedSmall" style="display:none; color:#b00020; margin-top:8px;"></div>

      <div class="grid2" style="margin-top:10px;">
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

      <div class="btnRow">
        ${!editMode ? `<button class="btn secondary btnEdit" type="button">Editar</button>` : ""}
        ${editMode ? `<button class="btn secondary btnSave" type="button">Guardar cambios</button>` : ""}
        ${editMode ? `<button class="btn secondary btnCancelEdit" type="button">Cancelar edición</button>` : ""}
        <button class="btn btnDanger btnCancel" type="button">Cancelar Pedido</button>
        <button class="btn primary btnPay" type="button">Confirmar pago</button>
      </div>
    `;

    // Live totals update si editMode
    function hookLiveUpdates() {
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
    }
    if (editMode) hookLiveUpdates();

    // Editar
    const btnEdit = wrap.querySelector(".btnEdit");
    if (btnEdit) btnEdit.addEventListener("click", () => {
      editMode = true;
      render();
    });

    // Cancelar edición
    const btnCancelEdit = wrap.querySelector(".btnCancelEdit");
    if (btnCancelEdit) btnCancelEdit.addEventListener("click", () => {
      editMode = false;

      order.customer_name = originalSnapshot.customer_name;
      order.phone = originalSnapshot.phone;
      order.address_text = originalSnapshot.address_text;
      order.maps_link = originalSnapshot.maps_link;
      order.notes = originalSnapshot.notes;

      items = safeJsonParse(originalSnapshot.items) || buildEditableItems(order);
      totals = calcTotals(items);
      showInlineAlert("");

      render();
    });

    // Guardar cambios
    const btnSave = wrap.querySelector(".btnSave");
    if (btnSave) {
      btnSave.addEventListener("click", async () => {
        if (!validateNotEmpty()) return;

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

          totals = calcTotals(items);
          order.subtotal = totals.subtotal;
          order.total_units = totals.total_units;

          order.customer_name = wrap.querySelector(".f_name").value.trim();
          order.phone = wrap.querySelector(".f_phone").value.trim();
          order.address_text = wrap.querySelector(".f_address").value.trim();
          order.maps_link = wrap.querySelector(".f_maps").value.trim();
          order.notes = wrap.querySelector(".f_notes").value.trim();

          order.items_json = JSON.stringify(updatedItems.map(it => ({
            id: it.id, name: it.name, qty: it.qty, unit_price: it.price
          })));

          updateHeaderBadge();

          editMode = false;
          showInlineAlert("");
          setStatus("✅ Cambios guardados.");

          await loadPendientes(true);
        } catch (e) {
          setStatus("❌ " + (e.message || "Error"));
        } finally {
          hideLoading();
        }
      });
    }

    // Confirmar pago (abre modal)
    wrap.querySelector(".btnPay").addEventListener("click", () => {
      if (editMode && !validateNotEmpty()) return;
      openPayModal(order);
    });

    // Cancelar pedido (abre modal)
    wrap.querySelector(".btnCancel").addEventListener("click", () => {
      openCancelModal(order);
    });

    updateHeaderBadge();
  }

  render();
  return wrap;
}

// ===== MODAL helpers =====
function openModal(el){
  el.classList.add("show");
  el.setAttribute("aria-hidden","false");
}
function closeModal(el){
  el.classList.remove("show");
  el.setAttribute("aria-hidden","true");
}

// ===== MODAL PAGO: timer solo cuando campos están completos =====
payMethod.addEventListener("change", () => {
  payOtherWrap.classList.toggle("hidden", payMethod.value !== "Otro");
  resetPayTimerIfNeeded();
  maybeStartPayTimer();
});
payOtherText.addEventListener("input", () => {
  resetPayTimerIfNeeded();
  maybeStartPayTimer();
});
payRef.addEventListener("input", () => {
  resetPayTimerIfNeeded();
  maybeStartPayTimer();
});

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
  // datos completos -> inicia timer 3s
  startPayCountdown(3);
}

function resetPayTimerIfNeeded() {
  if (!payTimerStarted) return;
  // si cambian inputs, reinicia (para obligar a revisar)
  stopPayCountdown();
  btnPayConfirm.disabled = true;
  payTimer.textContent = "Completa los datos para iniciar la confirmación.";
  payTimerStarted = false;
}

function startPayCountdown(seconds){
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

function stopPayCountdown(resetStarted=true){
  if (payCountdownInt) clearInterval(payCountdownInt);
  payCountdownInt = null;
  if (resetStarted) payTimerStarted = false;
}

btnPayConfirm.addEventListener("click", async () => {
  if (!modalOrder) return;

  // seguridad extra
  if (!isPayValid()) {
    alert("Completa método de pago y referencia para confirmar.");
    return;
  }

  const finalMethod = payMethod.value === "Otro" ? payOtherText.value.trim() : payMethod.value;
  const finalRef = payRef.value.trim();

  try {
    // 1) UI optimista: remover pedido YA
    pendingOrdersCache = pendingOrdersCache.filter(o => o.order_id !== modalOrder.order_id);
    renderOrdersList(listEl, pendingOrdersCache, { mode:"PENDIENTES" });
    setStatus("Procesando confirmación...");

    // 2) cerrar modal y mostrar loading encima
    closePayModal();
    showLoading("Confirmando pago...");

    await api({
      action: "mark_paid",
      admin_pin: SESSION.pin,
      operator: SESSION.operator,
      order_id: modalOrder.order_id,
      payment_method: finalMethod,
      payment_ref: finalRef
    });

    setStatus("✅ Pago confirmado. Pedido removido de Pendientes.");

    // invalidar cache historial
    HIST_CACHE = null;
    HIST_CACHE_TIME = 0;

    // 3) refresh suave (reduce 429)
    await softRefreshPendientes();
  } catch (e) {
    // si falló, volvemos a pedir pendientes para reparar UI
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

// ===== MODAL CANCELAR: timer solo cuando razón está completa =====
cancelReason.addEventListener("change", () => {
  cancelOtherWrap.classList.toggle("hidden", cancelReason.value !== "Otro");
  resetCancelTimerIfNeeded();
  maybeStartCancelTimer();
});
cancelOtherText.addEventListener("input", () => {
  resetCancelTimerIfNeeded();
  maybeStartCancelTimer();
});

btnCancelBack.addEventListener("click", closeCancelModal);

function openCancelModal(order) {
  modalOrder = order;

  cancelReason.value = "";
  cancelOtherText.value = "";
  cancelOtherWrap.classList.add("hidden");

  btnCancelConfirm.disabled = true;
  cancelTimer.textContent = "Selecciona la razón para iniciar la cancelación.";
  cancelTimerStarted = false;

  cancelTitle.textContent = "Cancelar pedido";
  cancelText.textContent = `Vas a cancelar el pedido ${order.order_id}. Esta acción dejará trazabilidad.`;

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
    cancelTimer.textContent = "Selecciona la razón para iniciar la cancelación.";
    return;
  }
  startCancelCountdown(3);
}

function resetCancelTimerIfNeeded() {
  if (!cancelTimerStarted) return;
  stopCancelCountdown();
  btnCancelConfirm.disabled = true;
  cancelTimer.textContent = "Selecciona la razón para iniciar la cancelación.";
  cancelTimerStarted = false;
}

function startCancelCountdown(seconds){
  stopCancelCountdown();
  cancelTimerStarted = true;

  let t = seconds;
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

function stopCancelCountdown(resetStarted=true){
  if (cancelCountdownInt) clearInterval(cancelCountdownInt);
  cancelCountdownInt = null;
  if (resetStarted) cancelTimerStarted = false;
}

btnCancelConfirm.addEventListener("click", async () => {
  if (!modalOrder) return;

  if (!isCancelValid()) {
    alert("Selecciona una razón para cancelar.");
    return;
  }

  const finalReason = cancelReason.value === "Otro"
    ? cancelOtherText.value.trim()
    : cancelReason.value;

  try {
    // 1) UI optimista: remover pedido YA
    pendingOrdersCache = pendingOrdersCache.filter(o => o.order_id !== modalOrder.order_id);
    renderOrdersList(listEl, pendingOrdersCache, { mode:"PENDIENTES" });
    setStatus("Procesando cancelación...");

    // 2) cerrar modal y loading encima
    closeCancelModal();
    showLoading("Cancelando pedido...");

    await api({
      action: "cancel_order",
      admin_pin: SESSION.pin,
      operator: SESSION.operator,
      order_id: modalOrder.order_id,
      cancel_reason: finalReason
    });

    setStatus("✅ Pedido cancelado. Removido de Pendientes.");

    // invalidar cache historial
    HIST_CACHE = null;
    HIST_CACHE_TIME = 0;

    // 3) refresh suave
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

// ===== INIT =====
(function init() {
  const saved = sessionStorage.getItem("AMARED_ADMIN");
  if (saved) {
    SESSION = JSON.parse(saved);
    showPanel();
    loadPendientes(false).catch(()=>{});
  }
})();
