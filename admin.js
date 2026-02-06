const API_URL = "https://amared-orders.amaredpostres.workers.dev/";

// Catálogo de productos (para edición)
const PRODUCT_CATALOG = [
  { id: "mousse_maracuya", name: "Mousse de Maracuyá", unit_price: 10000 },
  { id: "cheesecake_cafe_panela", name: "Cheesecake de café con panela", unit_price: 12500 },
];

let SESSION = { operator: null, pin: null };

// ===== Control requests / loading =====
let REQUEST_IN_FLIGHT = false;
let LOADING_COUNT = 0;

// Historial cache
let HIST_CACHE = null;       // { paid:[], canceled:[] }
let HIST_CACHE_TIME = 0;
const HIST_TTL = 60 * 1000;

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

function showLoading(text="Cargando.") {
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
    await loadPendientes(false); // esto valida el PIN (401 si es incorrecto)
  } catch (e) {
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
  operatorName.textContent = SESSION.operator || "";
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

async function softRefreshPendientes() {
  await sleep(700);
  try { await loadPendientes(true); } catch { /* ignore */ }
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
      HIST_CACHE = {
        paid: (paid.orders || []),
        canceled: (canceled.orders || [])
      };
      HIST_CACHE_TIME = now;
    }

    let all = [...(HIST_CACHE?.paid || []), ...(HIST_CACHE?.canceled || [])];
    all.sort((a,b) => (Date.parse(b.created_at || "")||0) - (Date.parse(a.created_at || "")||0));

    if (histFilter !== "ALL") all = all.filter(o => String(o.payment_status) === histFilter);

    renderOrdersList(histListEl, all, { mode:"HIST" });
    setHistStatus(`${all.length} pedidos (filtro: ${histFilter === "ALL" ? "Todos" : histFilter}).`);
  } catch (e) {
    const msg = String(e.message || "");
    if (msg.toLowerCase().includes("too many") || msg.includes("429")) {
      setHistStatus("⚠️ Muchas solicitudes. Espera 2–3s y vuelve a intentar.");
    } else {
      setHistStatus("❌ " + msg);
    }
  } finally {
    hideLoading();
  }
}

// ===== RENDER LIST =====
function renderOrdersList(container, orders, opts) {
  container.innerHTML = "";
  if (!orders || orders.length === 0) {
    container.innerHTML = `<div class="mutedSmall" style="text-align:center; padding:14px;">Sin pedidos.</div>`;
    return;
  }

  for (const order of orders) {
    const wrap = document.createElement("div");
    wrap.className = "orderItem";

    let editMode = false;

    // snapshot para cancelar edición
    const originalSnapshot = {
      customer_name: order.customer_name,
      phone: order.phone,
      address_text: order.address_text,
      maps_link: order.maps_link,
      notes: order.notes,
      items_json: order.items_json,
      items: order.items,
    };

    let items = buildEditableItems(order);
    let totals = calcTotals(items);

    function showInlineAlert(msg) {
      const el = wrap.querySelector(".inlineAlert");
      if (el) {
        el.textContent = msg || "";
        el.style.display = msg ? "" : "none";
      }
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
      const statusBadge = `<span class="badge">${escapeHtml(order.payment_status || "")}</span>`;

      const itemsLines = items
        .filter(it => it.qty > 0 || editMode)
        .map((it, idx) => {
          const line = `
            <div class="rowBetween" style="gap:10px;">
              <div style="flex:1;">
                <div style="font-weight:900;">${escapeHtml(it.name)}</div>
                <div class="mutedSmall">$${money(it.unit_price)} c/u</div>
              </div>
              <div style="min-width:120px; text-align:right;">
                ${editMode
                  ? `<input class="input itemQty" type="number" min="0" step="1" value="${Number(it.qty||0)}" data-idx="${idx}" style="width:110px; text-align:right;" />`
                  : `<div style="font-weight:900;">x${Number(it.qty||0)}</div>`
                }
              </div>
            </div>
          `;
          return line;
        }).join("");

      wrap.innerHTML = `
        <div class="orderHead">
          <div>
            <div class="orderId">#${escapeHtml(order.order_id || "")}</div>
            <div class="mutedSmall">${escapeHtml(formatDate(order.created_at || ""))} ${statusBadge}</div>
          </div>
        </div>

        <div class="inlineAlert" style="display:none; margin:8px 0; color:#b00020; font-weight:800;"></div>

        <details class="orderDetails">
          <summary class="orderSummary">Ver detalles</summary>
          <div class="orderBody">

            <div class="grid2" style="gap:10px;">
              <div>
                <div class="mutedSmall">Nombre</div>
                ${editMode
                  ? `<input class="input f_name" value="${escapeHtml(order.customer_name || "")}" />`
                  : `<div style="font-weight:900;">${escapeHtml(order.customer_name || "")}</div>`
                }
              </div>
              <div>
                <div class="mutedSmall">Teléfono</div>
                ${editMode
                  ? `<input class="input f_phone" value="${escapeHtml(order.phone || "")}" />`
                  : `<div style="font-weight:900;">${escapeHtml(order.phone || "")}</div>`
                }
              </div>
            </div>

            <div style="margin-top:10px;">
              <div class="mutedSmall">Dirección</div>
              ${editMode
                ? `<input class="input f_address" value="${escapeHtml(order.address_text || "")}" />`
                : `<div style="font-weight:900;">${escapeHtml(order.address_text || "")}</div>`
              }
            </div>

            <div style="margin-top:10px;">
              <div class="mutedSmall">Ubicación</div>
              ${editMode
                ? `<input class="input f_maps" value="${escapeHtml(order.maps_link || "")}" placeholder="Link Maps / WHATSAPP" />`
                : `<div style="font-weight:900;">${escapeHtml(order.maps_link || "")}</div>`
              }
            </div>

            <div style="margin-top:10px;">
              <div class="mutedSmall">Notas</div>
              ${editMode
                ? `<textarea class="textarea f_notes" rows="2">${escapeHtml(order.notes || "")}</textarea>`
                : `<div style="font-weight:900;">${escapeHtml(order.notes || "")}</div>`
              }
            </div>

            <div style="margin-top:12px;">
              <div class="mutedSmall" style="font-weight:900;">Items</div>
              <div style="display:flex; flex-direction:column; gap:10px; margin-top:8px;">${itemsLines || `<div class="mutedSmall">Sin items</div>`}</div>
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
              ${opts.mode === "PENDIENTES" && !editMode ? `<button class="btn secondary btnEdit" type="button">Editar</button>` : ""}
              ${opts.mode === "PENDIENTES" && editMode ? `<button class="btn secondary btnSave" type="button">Guardar cambios</button>` : ""}
              ${opts.mode === "PENDIENTES" && editMode ? `<button class="btn secondary btnCancelEdit" type="button">Cancelar edición</button>` : ""}
              ${opts.mode === "PENDIENTES" ? `<button class="btn btnDanger btnCancel" type="button">Cancelar Pedido</button>` : ""}
              ${opts.mode === "PENDIENTES" ? `<button class="btn primary btnPay" type="button">Confirmar pago</button>` : ""}
            </div>

          </div>
        </details>
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

        // también validar cambios en inputs
        wrap.querySelector(".f_name")?.addEventListener("input", validateNotEmpty);
        wrap.querySelector(".f_phone")?.addEventListener("input", validateNotEmpty);
        wrap.querySelector(".f_address")?.addEventListener("input", validateNotEmpty);
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
        order.items_json = originalSnapshot.items_json;
        order.items = originalSnapshot.items;

        items = buildEditableItems(order);
        totals = calcTotals(items);
        showInlineAlert("");
        render();
      });

      // Guardar cambios
      const btnSave = wrap.querySelector(".btnSave");
      if (btnSave) {
        btnSave.addEventListener("click", async () => {
          if (!validateNotEmpty()) return;

          const customer_name = wrap.querySelector(".f_name").value.trim();
          const phone = wrap.querySelector(".f_phone").value.trim();
          const address_text = wrap.querySelector(".f_address").value.trim();
          const maps_link = wrap.querySelector(".f_maps").value.trim();
          const notes = wrap.querySelector(".f_notes").value.trim();

          // items que se envían al webhook (formato esperado: id,name,qty,price)
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

            // actualizar UI local
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
      }

      // Cancelar pedido
      const btnCancel = wrap.querySelector(".btnCancel");
      if (btnCancel) btnCancel.addEventListener("click", () => {
        openCancelModal(order);
      });

      // Confirmar pago
      const btnPay = wrap.querySelector(".btnPay");
      if (btnPay) btnPay.addEventListener("click", () => {
        openPayModal(order);
      });
    }

    render();
    container.appendChild(wrap);
  }
}

// ===== MODAL PAGO =====
function openPayModal(order) {
  modalOrder = order;
  payTitle.textContent = `Confirmar pago #${order.order_id || ""}`;
  payText.textContent = `${order.customer_name || ""} • $${money(order.subtotal || 0)}`;
  payMethod.value = "";
  payOtherText.value = "";
  payOtherWrap.classList.add("hidden");
  payRef.value = "";
  btnPayConfirm.disabled = true;
  payTimer.textContent = "Completa los datos para iniciar la confirmación.";
  payTimerStarted = false;
  stopPayCountdown();

  payModal.classList.add("show");
  payModal.setAttribute("aria-hidden","false");
}

function closePayModal() {
  payModal.classList.remove("show");
  payModal.setAttribute("aria-hidden","true");
  stopPayCountdown();
  modalOrder = null;
}

btnPayBack.addEventListener("click", closePayModal);

payMethod.addEventListener("change", () => {
  payOtherWrap.classList.toggle("hidden", payMethod.value !== "Otro");
  resetPayTimerIfNeeded();
  maybeStartPayTimer();
});
payOtherText.addEventListener("input", () => { resetPayTimerIfNeeded(); maybeStartPayTimer(); });
payRef.addEventListener("input", () => { resetPayTimerIfNeeded(); maybeStartPayTimer(); });

function isPayValid() {
  const method = payMethod.value;
  const ref = payRef.value.trim();
  if (!method) return false;
  if (method === "Otro" && !payOtherText.value.trim()) return false;
  if (!ref) return false;
  return true;
}

function maybeStartPayTimer() {
  if (!modalOrder) return;
  if (!isPayValid()) return;
  startPayCountdown(3);
}

function resetPayTimerIfNeeded() {
  if (!payTimerStarted) return;
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

  if (!isPayValid()) {
    alert("Completa método de pago y referencia para confirmar.");
    return;
  }

  const finalMethod = payMethod.value === "Otro" ? payOtherText.value.trim() : payMethod.value;
  const finalRef = payRef.value.trim();

  try {
    // UI optimista
    pendingOrdersCache = pendingOrdersCache.filter(o => o.order_id !== modalOrder.order_id);
    renderOrdersList(listEl, pendingOrdersCache, { mode:"PENDIENTES" });
    setStatus("Procesando confirmación...");

    closePayModal();
    showLoading("Confirmando pago...");

    await api({
      action: "mark_paid",              // ✅ acción correcta en Apps Script
      admin_pin: SESSION.pin,
      operator: SESSION.operator,
      order_id: modalOrder.order_id,
      payment_method: finalMethod,
      payment_ref: finalRef
    });

    setStatus("✅ Pago confirmado. Pedido removido de Pendientes.");

    HIST_CACHE = null;
    HIST_CACHE_TIME = 0;

    await softRefreshPendientes();
  } catch (e) {
    const msg = String(e.message || "");
    if (msg.toLowerCase().includes("too many") || msg.includes("429")) {
      setStatus("⚠️ Muchas solicitudes. Refresca en unos segundos si no ves el cambio.");
    } else {
      setStatus("❌ " + msg);
    }
    await softRefreshPendientes();
  } finally {
    hideLoading();
  }
});

// ===== MODAL CANCELAR =====
function openCancelModal(order) {
  modalOrder = order;
  cancelTitle.textContent = `Cancelar pedido #${order.order_id || ""}`;
  cancelText.textContent = `${order.customer_name || ""} • $${money(order.subtotal || 0)}`;
  cancelReason.value = "";
  cancelOtherText.value = "";
  cancelOtherWrap.classList.add("hidden");
  btnCancelConfirm.disabled = true;
  cancelTimer.textContent = "Selecciona una razón para habilitar la cancelación.";
  cancelTimerStarted = false;
  stopCancelCountdown();

  cancelModal.classList.add("show");
  cancelModal.setAttribute("aria-hidden","false");
}

function closeCancelModal() {
  cancelModal.classList.remove("show");
  cancelModal.setAttribute("aria-hidden","true");
  stopCancelCountdown();
  modalOrder = null;
}

btnCancelBack.addEventListener("click", closeCancelModal);

cancelReason.addEventListener("change", () => {
  cancelOtherWrap.classList.toggle("hidden", cancelReason.value !== "Otro");
  resetCancelTimerIfNeeded();
  maybeStartCancelTimer();
});
cancelOtherText.addEventListener("input", () => { resetCancelTimerIfNeeded(); maybeStartCancelTimer(); });

function isCancelValid() {
  const r = cancelReason.value;
  if (!r) return false;
  if (r === "Otro" && !cancelOtherText.value.trim()) return false;
  return true;
}

function maybeStartCancelTimer() {
  if (!modalOrder) return;
  if (!isCancelValid()) return;
  startCancelCountdown(3);
}

function resetCancelTimerIfNeeded() {
  if (!cancelTimerStarted) return;
  stopCancelCountdown();
  btnCancelConfirm.disabled = true;
  cancelTimer.textContent = "Selecciona una razón para habilitar la cancelación.";
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
      cancelTimer.textContent = "Listo. Puedes cancelar ahora.";
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
    // UI optimista
    pendingOrdersCache = pendingOrdersCache.filter(o => o.order_id !== modalOrder.order_id);
    renderOrdersList(listEl, pendingOrdersCache, { mode:"PENDIENTES" });
    setStatus("Procesando cancelación...");

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

    HIST_CACHE = null;
    HIST_CACHE_TIME = 0;

    await softRefreshPendientes();
  } catch (e) {
    const msg = String(e.message || "");
    if (msg.toLowerCase().includes("too many") || msg.includes("429")) {
      setStatus("⚠️ Muchas solicitudes. Refresca en unos segundos si no ves el cambio.");
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
    try {
      SESSION = JSON.parse(saved);
      if (SESSION?.operator && SESSION?.pin) {
        showPanel();
        loadPendientes(false).catch(()=>{});
      }
    } catch {}
  }
})();
