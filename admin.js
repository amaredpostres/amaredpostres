const API_URL = "https://amared-orders.amaredpostres.workers.dev/";

let SESSION = {
  operator: null,
  pin: null,
  tab: "Pendiente"
};

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

/* ===== UTILS ===== */
function setStatus(msg) {
  statusEl.textContent = msg || "";
}

function money(n) {
  return Math.round(Number(n || 0)).toLocaleString("es-CO");
}

async function api(body) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const out = await res.json();
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
    // Validamos PIN intentando listar pedidos (no muestra nada si no hay)
    await api({
      action: "list_orders",
      admin_pin: pin,
      payment_status: "Pendiente"
    });

    SESSION.operator = operator;
    SESSION.pin = pin;

    sessionStorage.setItem("AMARED_ADMIN", JSON.stringify(SESSION));

    showPanel();
    loadTab("Pendiente");

  } catch (err) {
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
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tabBtn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    loadTab(btn.dataset.tab);
  });
});

/* ===== LIST ===== */
async function loadTab(tab) {
  SESSION.tab = tab;
  setStatus("Cargando pedidos...");

  const out = await api({
    action: "list_orders",
    admin_pin: SESSION.pin,
    payment_status: tab
  });

  renderList(out.orders || []);
  setStatus(`${out.orders.length} pedidos en ${tab}.`);
}

function renderList(orders) {
  listEl.innerHTML = "";

  if (!orders.length) {
    listEl.innerHTML = `<div class="mutedSmall">No hay pedidos.</div>`;
    return;
  }

  orders.forEach(o => {
    const card = document.createElement("div");
    card.className = "orderItem";

    const head = document.createElement("div");
    head.className = "orderHead";
    head.innerHTML = `
      <div>
        <div class="orderId">${o.order_id} • $${money(o.subtotal)}</div>
        <div class="orderMeta">${o.customer_name} • ${o.created_at}</div>
      </div>
      <div>›</div>
    `;

    const body = document.createElement("div");
    body.className = "orderBody";
    body.innerHTML = `
      <p><strong>Tel:</strong> ${o.phone}</p>
      <p><strong>Dirección:</strong> ${o.address_text}</p>
      <p><strong>Notas:</strong> ${o.notes || "—"}</p>
    `;

    head.addEventListener("click", () => {
      card.classList.toggle("open");
    });

    card.appendChild(head);
    card.appendChild(body);
    listEl.appendChild(card);
  });
}

/* ===== INIT ===== */
(function init() {
  const saved = sessionStorage.getItem("AMARED_ADMIN");
  if (saved) {
    SESSION = JSON.parse(saved);
    showPanel();
    loadTab(SESSION.tab || "Pendiente");
  }
})();
