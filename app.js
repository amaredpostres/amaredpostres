// =================== CONFIG ===================
const WHATSAPP_NUMBER = "573028473086";

// Pega aquí tu URL de Apps Script (termina en /exec)
const ORDER_API_URL = "https://amared-orders.amaredpostres.workers.dev/";


// Productos y precios actuales (los puedes cambiar cuando quieras)
const PRODUCTS = [
  { id: "mousse_maracuya", name: "Mousse de Maracuyá", price: 10000 },
  { id: "cheesecake_cafe_panela", name: "Cheesecake de café con panela", price: 12500 },
  { id: "arroz_con_leche", name: "Arroz con Leche", price: 8000 },
];

// Estado carrito
const cart = new Map(PRODUCTS.map(p => [p.id, 0]));

// Elements
const elProducts = document.getElementById("products");
const elTotalUnits = document.getElementById("totalUnits");
const elSubtotal = document.getElementById("subtotal");
const elStatus = document.getElementById("status");
const btnWhatsApp = document.getElementById("btnWhatsApp");

function money(n){
  return Math.round(n).toLocaleString("es-CO");
}

// Genera un código de pedido en el cliente (no depende de la respuesta del servidor)
function generateClientOrderId() {
  // Ej: AMR-20260202-142355-8392
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

function renderProducts(){
  elProducts.innerHTML = "";

  for (const p of PRODUCTS){
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
    document.getElementById(`qty_${id}`).textContent = String(next);
    updateSummary();
  }, { once: true });
}

function updateSummary(){
  let totalUnits = 0;
  let subtotal = 0;

  for (const p of PRODUCTS){
    const qty = cart.get(p.id) || 0;
    totalUnits += qty;
    subtotal += qty * p.price;
  }

  elTotalUnits.textContent = String(totalUnits);
  elSubtotal.textContent = money(subtotal);
}

function getFormData(){
  const customer_name = document.getElementById("name").value.trim();
  const phone = document.getElementById("phone").value.trim();
  const address_text = document.getElementById("address").value.trim();
  const maps_link = document.getElementById("maps").value.trim();
  const notes = document.getElementById("notes").value.trim();

  const items = PRODUCTS
    .map(p => ({ id: p.id, name: p.name, qty: cart.get(p.id) || 0, price: p.price }))
    .filter(it => it.qty > 0);

  const total_units = items.reduce((a, b) => a + b.qty, 0);
  const subtotal = items.reduce((a, b) => a + (b.qty * b.price), 0);

  return { customer_name, phone, address_text, maps_link, notes, items, total_units, subtotal };
}

function validate(data){
  if (data.items.length === 0) return "Selecciona al menos 1 postre.";
  if (!data.customer_name) return "Escribe tu nombre.";
  if (!data.phone) return "Escribe tu número.";
  if (!data.address_text) return "Escribe tu dirección.";
  if (!data.maps_link || !data.maps_link.includes("http")) return "Pega el link de Google Maps (ubicación exacta).";
  return null;
}

function buildWhatsAppMessage(data, orderId){
  const lines = [];
  lines.push(`Hola, mi nombre es ${data.customer_name} y mi número es ${data.phone}.`);
  lines.push("");
  lines.push(`Quiero hacer un pedido (Código: ${orderId}):`);
  for (const it of data.items){
    lines.push(`- ${it.name}: ${it.qty}`);
  }
  lines.push("");
  lines.push(`Subtotal: $${money(data.subtotal)}`);
  lines.push(`Domicilio: lo cubre el cliente (se confirma por WhatsApp).`);
  lines.push("");
  lines.push(`Dirección: ${data.address_text}`);
  lines.push(`Ubicación (Maps): ${data.maps_link}`);
  if (data.notes) lines.push(`Nota: ${data.notes}`);
  lines.push("");
  lines.push("Muchas gracias.");
  return lines.join("\n");
}

function openWhatsApp(text){
  const url = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

// Guardado a Sheets sin leer respuesta (evita CORS)
async function saveToSheetsNoCors(data){
  await fetch(APPS_SCRIPT_WEBAPP_URL, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

btnWhatsApp.addEventListener("click", async () => {
  elStatus.textContent = "";
  btnWhatsApp.disabled = true;

  try {
    if (APPS_SCRIPT_WEBAPP_URL.includes("https://script.google.com/macros/s/AKfycbxHo6WJSbnZQ4UdpToPzvPC2SIumm-sdMRKIrHa7vPbjwb0uPsmod_nVFyAlek7oYvq4w/exec")) {
      throw new Error("Falta configurar APPS_SCRIPT_WEBAPP_URL en app.js");
    }

    const data = getFormData();
    const err = validate(data);
    if (err) throw new Error(err);

    const orderId = generateClientOrderId();
    data.order_id = orderId;

    // Abre WhatsApp primero (mejor experiencia)
    const msg = buildWhatsAppMessage(data, orderId);
    openWhatsApp(msg);

    // Registra en Sheets
    elStatus.textContent = "Registrando pedido...";
    await saveToSheetsNoCors(data);

    elStatus.textContent = `Listo ✅ Pedido creado (código: ${orderId}).`;
  } catch (e) {
    elStatus.textContent = `Error: ${e.message}`;
  } finally {
    btnWhatsApp.disabled = false;
  }
});

renderProducts();
updateSummary();
