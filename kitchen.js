// =================== CONFIG ===================
const ORDER_API_URL = "https://amared-orders.amaredpostres.workers.dev/";

// Temporizador base galleta (minutos)
const FRIDGE_MINUTES = 10; // Ajusta aquí si cambias el tiempo real

// =================== SESSION ===================
let SESSION = { operator: null, pin: null };
let REQUEST_IN_FLIGHT = false;

let kitchenOrders = [];
let currentOrder = null;
let currentSteps = [];
let stepIdx = 0;

let timerTick = null;
let confirm3State = { onConfirm: null };

// =================== DOM ===================
const loginView = document.getElementById("loginView");
const panelView = document.getElementById("panelView");

const opName = document.getElementById("opName");
const opPin = document.getElementById("opPin");
const loginError = document.getElementById("loginError");
const btnLogin = document.getElementById("btnLogin");

const btnRefresh = document.getElementById("btnRefresh");
const btnLogout = document.getElementById("btnLogout");
const filterKitchen = document.getElementById("filterKitchen");

const ordersList = document.getElementById("ordersList");
const ordersStatus = document.getElementById("ordersStatus");
const totalsBox = document.getElementById("totalsBox");

const stepsWrap = document.getElementById("stepsWrap");
const btnCloseSteps = document.getElementById("btnCloseSteps");

const stepsTitle = document.getElementById("stepsTitle");
const stepsMeta = document.getElementById("stepsMeta");
const stepImg = document.getElementById("stepImg");
const stepIndex = document.getElementById("stepIndex");
const stepDesc = document.getElementById("stepDesc");
const btnPrev = document.getElementById("btnPrev");
const btnNext = document.getElementById("btnNext");
const btnStartFridge = document.getElementById("btnStartFridge");
const timerText = document.getElementById("timerText");
const btnToInProcess = document.getElementById("btnToInProcess");
const btnToDone = document.getElementById("btnToDone");
const stepsMsg = document.getElementById("stepsMsg");

// loading
const loading = document.getElementById("loading");
const loadingText = document.getElementById("loadingText");

// confirm 3s
const confirm3 = document.getElementById("confirm3");
const confirm3Text = document.getElementById("confirm3Text");
const confirm3Count = document.getElementById("confirm3Count");
const btnCloseConfirm3 = document.getElementById("btnCloseConfirm3");
const btnCancelConfirm3 = document.getElementById("btnCancelConfirm3");
const btnDoConfirm3 = document.getElementById("btnDoConfirm3");

// =================== HELPERS ===================
function show(el) { el.classList.remove("hidden"); }
function hide(el) { el.classList.add("hidden"); }

function showLoading(text) {
  loadingText.textContent = text || "Cargando...";
  loading.classList.remove("hidden");
  loading.setAttribute("aria-hidden", "false");
}
function hideLoading() {
  loading.classList.add("hidden");
  loading.setAttribute("aria-hidden", "true");
}

function money(n) {
  return Math.round(Number(n || 0)).toLocaleString("es-CO");
}

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

function fmtBogota(dtLike) {
  const d = dtLike instanceof Date ? dtLike : new Date(dtLike);
  if (isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    dateStyle: "short",
    timeStyle: "short",
  }).format(d);
}

async function api(payload) {
  const res = await fetch(ORDER_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  let out;
  try {
    out = await res.json();
  } catch {
    const t = await res.text().catch(() => "");
    throw new Error(`Respuesta inválida del servidor. HTTP ${res.status}\n${t.slice(0, 200)}`);
  }
  if (!out.ok) throw new Error(out.error || "Error de API.");
  return out;
}

// =================== RECETAS (PASO A PASO) ===================
// Usa imágenes livianas (webp). Puedes crear estas rutas en /assets/steps/
const STEPS = {
  mousse_maracuya: {
    name: "Mousse de Maracuyá",
    steps: [
      { img: "assets/steps/galleta.webp", text: "Tritura galleta y mezcla con mantequilla derretida hasta lograr textura arenosa." },
      { img: "assets/steps/base_envase.webp", text: "Pon la base de galleta en los envases, presiona ligeramente y deja listo para refrigerar." },
      { img: "assets/steps/nevera.webp", text: "Refrigera la base. Presiona “Ya está en nevera” cuando la metas." , fridge: true },
      { img: "assets/steps/licuadora.webp", text: "En licuadora mezcla: leche condensada + crema de leche + leche entera + pulpa de maracuyá + vainilla (todo junto)." },
      { img: "assets/steps/gelatina.webp", text: "Disuelve gelatina sin sabor en agua tibia/caliente (sin hervir), revolviendo hasta homogénea." },
      { img: "assets/steps/integrar.webp", text: "Con la licuadora encendida, integra la gelatina disuelta en la mezcla para que quede uniforme." },
      { img: "assets/steps/servir.webp", text: "Sirve la mezcla en los envases con la base ya fría." },
      { img: "assets/steps/decorar.webp", text: "Decora con chocorramo y una ligera capa decorativa de chocolate en polvo (estilo logo, poca cantidad)." },
    ]
  },

  cheesecake_cafe_panela: {
    name: "Cheesecake de café con panela",
    steps: [
      { img: "assets/steps/galleta.webp", text: "Tritura galleta y mezcla con mantequilla derretida hasta lograr textura arenosa." },
      { img: "assets/steps/base_envase.webp", text: "Pon la base de galleta en los envases, presiona ligeramente y deja listo para refrigerar." },
      { img: "assets/steps/nevera.webp", text: "Refrigera la base. Presiona “Ya está en nevera” cuando la metas.", fridge: true },
      { img: "assets/steps/mezclar.webp", text: "Mezcla: queso crema + crema de leche + leche condensada + vainilla hasta integrar bien." },
      { img: "assets/steps/gelatina.webp", text: "Disuelve gelatina sin sabor en agua tibia/caliente, revolviendo hasta homogénea." },
      { img: "assets/steps/integrar.webp", text: "Integra la gelatina disuelta en la mezcla mientras revuelves, para que no queden grumos." },
      { img: "assets/steps/servir.webp", text: "Sirve la mezcla en los envases con la base ya fría." },
      { img: "assets/steps/decorar.webp", text: "Decora según tu presentación (café/panela). Mantén la estética AMARED." },
    ]
  },

  arroz_con_leche: {
    name: "Arroz con leche",
    steps: [
      { img: "assets/steps/olla.webp", text: "Sigue el paso a paso actual tal como está en tu receta base." },
      { img: "assets/steps/revolver.webp", text: "Mantén el proceso constante y controlado para textura cremosa." },
      { img: "assets/steps/servir.webp", text: "Porciona y presenta en envases. (Producto aún no activo en web, pero listo para cocina cuando lo habilites)." },
    ]
  }
};

// =================== LOGIN / SESSION ===================
function restoreSession() {
  const raw = sessionStorage.getItem("AMARED_KITCHEN");
  if (!raw) return false;
  try {
    const s = JSON.parse(raw);
    if (s?.operator && s?.pin) {
      SESSION = s;
      return true;
    }
  } catch {}
  return false;
}

function saveSession() {
  sessionStorage.setItem("AMARED_KITCHEN", JSON.stringify(SESSION));
}

function clearSession() {
  sessionStorage.removeItem("AMARED_KITCHEN");
  SESSION = { operator: null, pin: null };
}

function showLogin() {
  show(loginView);
  hide(panelView);
}

function showPanel() {
  hide(loginView);
  show(panelView);
}

// =================== LOAD DATA ===================
async function loadKitchen(fromRefresh = false) {
  if (REQUEST_IN_FLIGHT) return;
  REQUEST_IN_FLIGHT = true;

  try {
    showLoading(fromRefresh ? "Actualizando cocina..." : "Cargando pedidos pagados...");
    ordersStatus.textContent = "Cargando...";

    const filter = (filterKitchen?.value || "").trim();

    const out = await api({
      action: "list_kitchen_orders",
      admin_pin: SESSION.pin,
      kitchen_status: filter || ""
    });

    kitchenOrders = out.orders || [];
    renderOrders();
    renderTotals();
    ordersStatus.textContent = `${kitchenOrders.length} pedidos pagados (${filter || "Todos"}).`;
  } catch (e) {
    ordersStatus.textContent = `❌ ${String(e.message || e)}`;
    throw e;
  } finally {
    hideLoading();
    REQUEST_IN_FLIGHT = false;
  }
}

function parseItems(order) {
  // Preferimos items_json
  const raw = order.items_json;
  if (raw) {
    const parsed = typeof raw === "string" ? safeJsonParse(raw) : raw;
    if (Array.isArray(parsed)) return parsed;
  }
  // Fallback: no podemos reconstruir exacto desde "items" texto
  return [];
}

function renderOrders() {
  if (!ordersList) return;
  if (!kitchenOrders.length) {
    ordersList.innerHTML = `<div class="muted small">No hay pedidos para mostrar.</div>`;
    return;
  }

  ordersList.innerHTML = kitchenOrders.map(o => {
    const created = fmtBogota(o.created_at);
    const ks = String(o.kitchen_status || "No iniciar");
    const badgeClass = ks === "Listo" ? "badgeOk" : (ks === "En proceso" ? "badgeWarn" : "badge");

    return `
      <div class="orderCard">
        <div class="rowBetween">
          <div>
            <div class="orderId">${o.order_id}</div>
            <div class="muted small">${created}</div>
          </div>
          <span class="${badgeClass}">${ks}</span>
        </div>

        <div class="muted small" style="margin-top:8px;">
          <strong>${o.customer_name || ""}</strong> · ${o.phone || ""}<br/>
          ${o.address_text || ""}
        </div>

        <div class="miniCard" style="margin-top:10px;">
          <div class="muted small">Items</div>
          <div class="small">${(o.items || "").toString().replace(/\n/g, "<br/>")}</div>
          <div class="rowBetween" style="margin-top:8px;">
            <span class="muted small">Unidades</span>
            <strong>${o.total_units || 0}</strong>
          </div>
          <div class="rowBetween">
            <span class="muted small">Subtotal</span>
            <strong>$${money(o.subtotal)}</strong>
          </div>
        </div>

        <div class="rowBetween" style="margin-top:10px; gap:10px; flex-wrap:wrap;">
          <button class="btn secondary btnSteps" data-id="${o.order_id}">Abrir paso a paso</button>
          <button class="btn secondary btnInProcess" data-id="${o.order_id}">En proceso</button>
          <button class="btn primary btnDone" data-id="${o.order_id}">Finalizar</button>
        </div>
      </div>
    `;
  }).join("");

  // listeners
  ordersList.querySelectorAll(".btnSteps").forEach(b => b.addEventListener("click", () => openSteps(b.dataset.id)));
  ordersList.querySelectorAll(".btnInProcess").forEach(b => b.addEventListener("click", () => setKitchenStatus(b.dataset.id, "En proceso")));
  ordersList.querySelectorAll(".btnDone").forEach(b => b.addEventListener("click", () => confirm3s(
    "Vas a marcar este pedido como LISTO. ¿Confirmas?",
    async () => setKitchenStatus(b.dataset.id, "Listo")
  )));
}

function renderTotals() {
  // Suma por producto (a partir de items_json)
  const totals = {}; // id -> qty
  let totalUnits = 0;

  for (const o of kitchenOrders) {
    const items = parseItems(o);
    for (const it of items) {
      const id = String(it.id || "");
      const qty = Number(it.qty || 0);
      if (!id || qty <= 0) continue;
      totals[id] = (totals[id] || 0) + qty;
      totalUnits += qty;
    }
  }

  const lines = Object.entries(totals)
    .sort((a,b) => b[1] - a[1])
    .map(([id, qty]) => `<div class="rowBetween"><span>${id}</span><strong>${qty}</strong></div>`)
    .join("");

  totalsBox.innerHTML = `
    <div class="rowBetween"><span class="muted small">Total unidades</span><strong>${totalUnits}</strong></div>
    <hr style="border:none; border-top:1px solid rgba(0,0,0,.06); margin:10px 0;">
    ${lines || `<div class="muted small">No hay items_json para calcular totales (revisa que items_json exista en sheet).</div>`}
  `;
}

// =================== ACTIONS ===================
async function setKitchenStatus(orderId, status) {
  try {
    showLoading("Actualizando estado...");
    await api({
      action: "update_kitchen_status",
      admin_pin: SESSION.pin,
      operator: SESSION.operator,
      order_id: orderId,
      kitchen_status: status
    });
    await loadKitchen(true);

    // si estoy en steps y coincide, refrescar currentOrder
    if (currentOrder && currentOrder.order_id === orderId) {
      currentOrder = kitchenOrders.find(o => o.order_id === orderId) || currentOrder;
      stepsMeta.textContent = metaText_(currentOrder);
    }
  } catch (e) {
    alert(String(e.message || e));
  } finally {
    hideLoading();
  }
}

async function startFridge(orderId) {
  try {
    showLoading("Guardando inicio de nevera...");
    const out = await api({
      action: "set_base_fridge_started",
      admin_pin: SESSION.pin,
      operator: SESSION.operator,
      order_id: orderId
    });

    // Actualizar localmente
    const iso = out.base_fridge_started_at;
    if (currentOrder && currentOrder.order_id === orderId) {
      currentOrder.base_fridge_started_at = iso;
      stepsMeta.textContent = metaText_(currentOrder);
    }

    updateTimerUI();
  } catch (e) {
    alert(String(e.message || e));
  } finally {
    hideLoading();
  }
}

// =================== STEPS UI ===================
function metaText_(o) {
  const ks = String(o.kitchen_status || "No iniciar");
  const created = fmtBogota(o.created_at);
  return `Estado: ${ks} · Creado: ${created}`;
}

function pickRecipeKeyFromOrder(order) {
  // Heurística por items_json. Si hay 1 producto dominante lo usamos.
  const items = parseItems(order);
  if (!items.length) return null;

  // Elegir el de mayor qty
  items.sort((a,b) => Number(b.qty||0) - Number(a.qty||0));
  const mainId = String(items[0].id || "");
  if (STEPS[mainId]) return mainId;

  // fallback: si contiene mousse o cheesecake
  return null;
}

function openSteps(orderId) {
  const o = kitchenOrders.find(x => x.order_id === orderId);
  if (!o) return;

  currentOrder = o;
  const recipeKey = pickRecipeKeyFromOrder(o);

  // Si el pedido tiene múltiples productos, mostramos un “modo genérico”
  if (!recipeKey) {
    currentSteps = [
      { img:"assets/steps/servir.webp", text:"Este pedido contiene múltiples productos. Usa la lista de items como guía." },
      { img:"assets/steps/decorar.webp", text:"Finaliza cada producto según la receta correspondiente." },
    ];
    stepsTitle.textContent = `Pedido ${o.order_id}`;
  } else {
    currentSteps = STEPS[recipeKey].steps;
    stepsTitle.textContent = `${STEPS[recipeKey].name} · Pedido ${o.order_id}`;
  }

  stepsMeta.textContent = metaText_(o);
  stepIdx = 0;

  show(stepsWrap);
  renderStep();

  // timer
  clearInterval(timerTick);
  timerTick = setInterval(updateTimerUI, 1000);
  updateTimerUI();
}

function closeSteps() {
  hide(stepsWrap);
  currentOrder = null;
  currentSteps = [];
  stepIdx = 0;
  clearInterval(timerTick);
  timerTick = null;
  timerText.textContent = "—";
  stepsMsg.textContent = "";
}

function renderStep() {
  if (!currentSteps.length) return;

  const step = currentSteps[stepIdx];
  stepIndex.textContent = `Paso ${stepIdx + 1} / ${currentSteps.length}`;
  stepDesc.textContent = step.text || "";

  // imagen
  const imgSrc = step.img || "";
  if (imgSrc) {
    stepImg.src = imgSrc;
    stepImg.style.display = "block";
  } else {
    stepImg.style.display = "none";
  }

  // Botones
  btnPrev.disabled = stepIdx === 0;
  btnNext.disabled = stepIdx === currentSteps.length - 1;

  // Si el step tiene fridge, mostramos el botón (igual se puede usar siempre)
  const hasFridgeStep = !!step.fridge;
  btnStartFridge.style.display = hasFridgeStep ? "inline-flex" : "inline-flex";
}

function updateTimerUI() {
  if (!currentOrder) {
    timerText.textContent = "—";
    return;
  }

  const started = String(currentOrder.base_fridge_started_at || "").trim();
  if (!started) {
    timerText.textContent = "No iniciado";
    return;
  }

  const startMs = new Date(started).getTime();
  if (isNaN(startMs)) {
    timerText.textContent = "Fecha inválida";
    return;
  }

  const endMs = startMs + FRIDGE_MINUTES * 60 * 1000;
  const now = Date.now();
  const left = endMs - now;

  if (left <= 0) {
    timerText.textContent = "✅ Listo (tiempo cumplido)";
    return;
  }

  const mm = Math.floor(left / 60000);
  const ss = Math.floor((left % 60000) / 1000);
  timerText.textContent = `${String(mm).padStart(2,"0")}:${String(ss).padStart(2,"0")} restantes`;
}

// =================== CONFIRM 3s MODAL ===================
function confirm3s(text, onConfirm) {
  confirm3State.onConfirm = onConfirm;
  confirm3Text.textContent = text || "¿Confirmas?";
  confirm3Count.textContent = "3";
  show(confirm3);

  let n = 3;
  let t = setInterval(() => {
    n -= 1;
    confirm3Count.textContent = String(n);
    if (n <= 0) {
      clearInterval(t);
      t = null;
    }
  }, 1000);

  const close = () => {
    if (t) { clearInterval(t); t = null; }
    hide(confirm3);
    confirm3State.onConfirm = null;
  };

  btnCloseConfirm3.onclick = close;
  btnCancelConfirm3.onclick = close;

  btnDoConfirm3.onclick = async () => {
    if (n > 0) return; // no antes de 3s
    try {
      await (confirm3State.onConfirm ? confirm3State.onConfirm() : Promise.resolve());
    } finally {
      close();
    }
  };
}

// =================== EVENTS ===================
btnLogin?.addEventListener("click", async () => {
  loginError.textContent = "";
  const operator = (opName?.value || "").trim();
  const pin = (opPin?.value || "").trim();

  if (!operator || !pin) {
    loginError.textContent = "Completa operador y PIN.";
    return;
  }

  try {
    showLoading("Verificando acceso...");
    SESSION = { operator, pin };
    saveSession();
    showPanel();
    await loadKitchen(false);
  } catch (e) {
    clearSession();
    showLogin();
    loginError.textContent = `Error: ${String(e.message || e)}`;
  } finally {
    hideLoading();
  }
});

btnRefresh?.addEventListener("click", async () => loadKitchen(true));

filterKitchen?.addEventListener("change", async () => loadKitchen(true));

btnLogout?.addEventListener("click", () => {
  closeSteps();
  clearSession();
  showLogin();
});

btnCloseSteps?.addEventListener("click", closeSteps);

btnPrev?.addEventListener("click", () => {
  if (stepIdx > 0) stepIdx--;
  renderStep();
});
btnNext?.addEventListener("click", () => {
  if (stepIdx < currentSteps.length - 1) stepIdx++;
  renderStep();
});

btnStartFridge?.addEventListener("click", async () => {
  if (!currentOrder) return;
  await startFridge(currentOrder.order_id);
});

btnToInProcess?.addEventListener("click", async () => {
  if (!currentOrder) return;
  await setKitchenStatus(currentOrder.order_id, "En proceso");
});

btnToDone?.addEventListener("click", async () => {
  if (!currentOrder) return;
  confirm3s(
    "Vas a marcar este pedido como LISTO. ¿Confirmas?",
    async () => setKitchenStatus(currentOrder.order_id, "Listo")
  );
});

// =================== INIT ===================
(function init() {
  if (restoreSession()) {
    showPanel();
    loadKitchen(false).catch(() => {
      clearSession();
      showLogin();
    });
  } else {
    showLogin();
  }
})();
