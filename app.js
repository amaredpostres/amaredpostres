// =================== CONFIG ===================
// Cambia APPS_SCRIPT_WEBAPP_URL por la URL del Web App de Apps Script desplegado.
const WHATSAPP_NUMBER = "573028473086";
const APPS_SCRIPT_WEBAPP_URL = "PASTE_YOUR_WEBAPP_URL_HERE";

// Definición de los productos con sus precios actuales. Estos valores se
// pueden ajustar sin tocar el resto del código.
const PRODUCTS = [
  { id: "mousse_maracuya", name: "Mousse de Maracuyá", price: 10000 },
  { id: "cheesecake_panela", name: "Cheesecake de café con panela", price: 12500 },
  { id: "arroz_con_leche", name: "Arroz con Leche", price: 8000 },
];

// Estado del carrito: se inicializa con 0 unidades de cada producto.
const cart = new Map(PRODUCTS.map(p => [p.id, 0]));

// Elementos del DOM que se usarán más adelante
const elProducts = document.getElementById("products");
const elTotalUnits = document.getElementById("totalUnits");
const elSubtotal = document.getElementById("subtotal");
const elStatus = document.getElementById("status");
const btnWhatsApp = document.getElementById("btnWhatsApp");

/**
 * Formatea un número a pesos colombianos sin decimales.
 * @param {number} n
 * @returns {string}
 */
function money(n) {
  return Math.round(n).toLocaleString("es-CO");
}

/**
 * Renderiza la lista de productos en la página.
 */
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

  // Delegación de eventos para los botones de incremento/decremento
  elProducts.addEventListener(
    "click",
    e => {
      const btn = e.target.closest("button");
      if (!btn) return;
      const id = btn.dataset.id;
      const action = btn.dataset.action;
      const current = cart.get(id) || 0;
      const next = action === "inc" ? current + 1 : Math.max(0, current - 1);
      cart.set(id, next);
      document.getElementById(`qty_${id}`).textContent = String(next);
      updateSummary();
    },
    { once: true },
  );
}

/**
 * Actualiza el total de unidades y el subtotal según el carrito.
 */
function updateSummary() {
  let totalUnits = 0;
  let subtotal = 0;
  for (const p of PRODUCTS) {
    const qty = cart.get(p.id) || 0;
    totalUnits += qty;
    subtotal += qty * p.price;
  }
  elTotalUnits.textContent = String(totalUnits);
  elSubtotal.textContent = money(subtotal);
}

/**
 * Obtiene los datos del formulario y del carrito.
 * @returns {object}
 */
function getFormData() {
  const customer_name = document.getElementById("name").value.trim();
  const phone = document.getElementById("phone").value.trim();
  const address_text = document.getElementById("address").value.trim();
  const maps_link = document.getElementById("maps").value.trim();
  const notes = document.getElementById("notes").value.trim();

  const items = PRODUCTS.map(p => ({ id: p.id, name: p.name, qty: cart.get(p.id) || 0, price: p.price })).filter(
    it => it.qty > 0,
  );
  const total_units = items.reduce((a, b) => a + b.qty, 0);
  const subtotal = items.reduce((a, b) => a + b.qty * b.price, 0);
  return { customer_name, phone, address_text, maps_link, notes, items, total_units, subtotal };
}

/**
 * Valida la información necesaria antes de enviar el pedido.
 * @param {object} data
 * @returns {string|null}
 */
function validate(data) {
  if (data.items.length === 0) return "Selecciona al menos 1 postre.";
  if (!data.customer_name) return "Escribe tu nombre.";
  if (!data.phone) return "Escribe tu número.";
  if (!data.address_text) return "Escribe tu dirección.";
  if (!data.maps_link || !data.maps_link.includes("http"))
    return "Pega el enlace de tu ubicación de Google Maps.";
  return null;
}

/**
 * Construye el mensaje que se enviará por WhatsApp.
 * @param {object} data
 * @param {string} orderIdOrTemp
 * @returns {string}
 */
function buildWhatsAppMessage(data, orderIdOrTemp) {
  const lines = [];
  lines.push(`Hola, mi nombre es ${data.customer_name} y mi número es ${data.phone}.`);
  lines.push("");
  lines.push(`Quiero hacer un pedido (Código: ${orderIdOrTemp}):`);
  for (const it of data.items) {
    lines.push(`- ${it.name}: ${it.qty}`);
  }
  lines.push("");
  lines.push(`Dirección: ${data.address_text}`);
  lines.push(`Ubicación (Maps): ${data.maps_link}`);
  if (data.notes) lines.push(`Nota: ${data.notes}`);
  lines.push("");
  lines.push(
    "¡Muchas gracias! El costo del domicilio se confirmará por WhatsApp junto con las instrucciones de pago.",
  );
  return lines.join("\n");
}

/**
 * Envía los datos al Web App de Apps Script para registrarlos en la hoja de cálculo.
 * @param {object} data
 * @returns {Promise<string>} - Resuelve con el order_id generado
 */
async function saveToSheets(data) {
  const res = await fetch(APPS_SCRIPT_WEBAPP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || !out.ok) {
    throw new Error(out.error || "No se pudo guardar el pedido.");
  }
  return out.order_id;
}

/**
 * Abre WhatsApp en una nueva pestaña con el texto ya codificado.
 * @param {string} text
 */
function openWhatsApp(text) {
  const url = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

// Manejo del clic del botón principal
btnWhatsApp.addEventListener("click", async () => {
  elStatus.textContent = "";
  btnWhatsApp.disabled = true;
  try {
    if (APPS_SCRIPT_WEBAPP_URL.includes("PASTE_YOUR_WEBAPP_URL_HERE")) {
      throw new Error("Falta configurar APPS_SCRIPT_WEBAPP_URL en app.js");
    }
    const data = getFormData();
    const err = validate(data);
    if (err) throw new Error(err);
    // 1) Guardar en Sheets y obtener el order_id
    elStatus.textContent = "Registrando pedido...";
    const orderId = await saveToSheets(data);
    // 2) Construir mensaje de WhatsApp con el código real
    const msg = buildWhatsAppMessage(data, orderId);
    elStatus.textContent = "Abriendo WhatsApp...";
    openWhatsApp(msg);
    elStatus.textContent = `Listo ✅ Pedido registrado con código: ${orderId}`;
  } catch (e) {
    elStatus.textContent = `Error: ${e.message}`;
  } finally {
    btnWhatsApp.disabled = false;
  }
});

// Inicializa la página al cargar
renderProducts();
updateSummary();