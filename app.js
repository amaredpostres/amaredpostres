// =================== CONFIG ===================
const WHATSAPP_NUMBER = "573028473086";

// 🔐 URL DEL CLOUDFARE WORKER (NO Apps Script)
const ORDER_API_URL = "https://amared-orders.amaredpostres.workers.dev/";

// Productos y precios
const PRODUCTS = [
  { id: "mousse_maracuya", name: "Mousse de Maracuyá", price: 10000 },
  { id: "cheesecake_cafe_panela", name: "Cheesecake de café con panela", price: 12500 },
  { id: "arroz_con_leche", name: "Arroz con Leche", price: 8000 },
];

// Estado del carrito
const cart = new Map(PRODUCTS.map(p => [p.id, 0]));

// Elementos DOM
const elProducts = document.getElementById("products");
const elTotalUnits = document.getElementById("totalUnits");
const elSubtotal = document.getElementById("subtotal");
const elStatus = document.getElementById("status");
const btnWhatsApp = document.getElementById("btnWhatsApp");

function money(n) {
  return Math.round(n).toLocaleString("es-CO");
}

// Generar ID único del pedido (lado cliente)
function generateClientOrderId() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  const rnd = String(Math.floor(Math.random() * 9000) + 1000);
  return `AMR-${y}${m}${d}-${hh}${mm}${ss}-${rnd}`;
}

// Render productos
function renderProducts() {
  elProducts.innerHTML = "";

  for (const p of PRODUCTS) {
    const div = document.createElement("div");
    div.className = "product";
    div.innerHTML = `
      <div class="top">
        <div>
          <div class="name">${p.name}</div>
          <div class="price">$${money(p.price)} c/u</div>
        </div>
      </div>
      <div class="stepper">
        <button type="button" data-action="dec" data-id="${p.id}">−</button>
        <div class="qty" id="qty_${p.id}">0</div>
        <button type="button" data-action="inc" data-id="${p.id}">+</button>
      </div>
    `;
    elProducts.appendChild(div);
  }

  elProducts.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;

    const id = btn.dataset.id;
    const action = btn.dataset.action;
    const current = cart.get(id) || 0;
    const next = action === "inc" ? current + 1 : Math.max(0, current - 1);

    cart.set(id, next);
    document.getElementById(`qty_${id}`).textContent = next;
    updateSummary();
  }, { once: true });
}

// Resumen
function updateSummary() {
  let totalUnits = 0;
  let subtotal = 0;

  for (const p of PRODUCTS) {
    const qty = cart.get(p.id) || 0;
    totalUnits += qty;
    subtotal += qty * p.price;
  }

  elTotalUnits.textContent = totalUnits;
  elSubtotal.textContent = money(subtotal);
}

// Obtener datos del formulario
function getFormData() {
  const customer_name = document.getElementById("name").value.trim();
  const phone = document.getElementById("phone").value.trim();
  const address_text = document.getElementById("address").value.trim();
  const maps_link = document.getElementById("maps").value.trim();
  const notes = document.getElementById("notes").value.trim();

  const items = PRODUCTS
    .map(p => ({
      id: p.id,
      name: p.name,
      qty: cart.get(p.id) || 0,
      price: p.price
    }))
    .filter(it => it.qty > 0);

  const total_units = items.reduce((a, b) => a + b.qty, 0);
  const subtotal = items.reduce((a, b) => a + b.qty * b.price, 0);

  return {
    customer_name,
    phone,
    address_text,
    maps_link,
    notes,
    items,
    total_units,
    subtotal
  };
}

// Validación
function validate(data) {
  if (data.items.length === 0) return "Selecciona al menos 1 postre.";
  if (!data.customer_name) return "Escribe tu nombre.";
  if (!data.phone) return "Escribe tu número.";
  if (!data.address_text) return "Escribe tu dirección.";
  if (!data.maps_link || !data.maps_link.includes("http"))
    return "Pega el link de Google Maps.";
  return null;
}

// Mensaje WhatsApp
function buildWhatsAppMessage(data, orderId) {
  return [
    `Hola, mi nombre es ${data.customer_name} y mi número es ${data.phone}.`,
    ``,
    `Quiero hacer un pedido (Código: ${orderId}):`,
    ...data.items.map(it => `- ${it.name}: ${it.qty}`),
    ``,
    `Subtotal: $${money(data.subtotal)}`,
    `Domicilio: lo cubre el cliente (se confirma por WhatsApp).`,
    ``,
    `Dirección: ${data.address_text}`,
    `Ubicación (Maps): ${data.maps_link}`,
    data.notes ? `Nota: ${data.notes}` : ``,
    ``,
    `Muchas gracias.`
  ].join("\n");
}

// Abrir WhatsApp
function openWhatsApp(text) {
  const url = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

// Guardar pedido vía Worker
async function saveOrder(data) {
  const res = await fetch(ORDER_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  const out = await res.json();
  if (!out.ok) throw new Error(out.error || "No se pudo guardar el pedido.");
}

// Botón principal
btnWhatsApp.addEventListener("click", async () => {
  elStatus.textContent = "";
  btnWhatsApp.disabled = true;

  try {
    if (ORDER_API_URL.includes("PEGA_AQUI")) {
      throw new Error("ORDER_API_URL no está configurada.");
    }

    const data = getFormData();
    const err = validate(data);
    if (err) throw new Error(err);

    const orderId = generateClientOrderId();
    data.order_id = orderId;

    // 1️⃣ WhatsApp
    openWhatsApp(buildWhatsAppMessage(data, orderId));

    // 2️⃣ Guardar en Sheets
    elStatus.textContent = "Registrando pedido...";
    await saveOrder(data);

    elStatus.textContent = `Listo ✅ Pedido creado (código: ${orderId}).`;
  } catch (e) {
    elStatus.textContent = `Error: ${e.message}`;
  } finally {
    btnWhatsApp.disabled = false;
  }
});

renderProducts();
updateSummary();
