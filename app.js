// =================== CONFIG ===================
const WHATSAPP_NUMBER = "573028473086";
const ORDER_API_URL = "https://amared-orders.amaredpostres.workers.dev/"; // ✅ tu Worker

const PRODUCTS = [
  { id: "mousse_maracuya", name: "Mousse de Maracuyá", price: 10000 },
  { id: "cheesecake_cafe_panela", name: "Cheesecake de café con panela", price: 12500 },
  { id: "arroz_con_leche", name: "Arroz con Leche", price: 8000 },
];

const cart = new Map(PRODUCTS.map(p => [p.id, 0]));

// DOM
const elProducts = document.getElementById("products");
const elTotalUnits = document.getElementById("totalUnits");
const elSubtotal = document.getElementById("subtotal");
const elCartSummary = document.getElementById("cartSummary");
const elStatus = document.getElementById("status");
const btnWhatsApp = document.getElementById("btnWhatsApp");

const btnOpenMaps = document.getElementById("btnOpenMaps");

const modal = document.getElementById("confirmModal");
const btnCloseModal = document.getElementById("btnCloseModal");
const btnCopyMessage = document.getElementById("btnCopyMessage");
const btnSendWhatsApp = document.getElementById("btnSendWhatsApp");
const elModalItems = document.getElementById("modalItems");
const elModalUnits = document.getElementById("modalUnits");
const elModalSubtotal = document.getElementById("modalSubtotal");
const elModalMessage = document.getElementById("modalMessage");

// Estado modal
let pending = null; // { orderId, data, message }

// Utils
function money(n) { return Math.round(n).toLocaleString("es-CO"); }

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

function isValidMapsLink(link) {
  const s = String(link || "").trim();
  if (!s) return false;
  // Aceptamos formatos comunes
  return (
    s.includes("google.com/maps") ||
    s.includes("goo.gl/maps") ||
    s.includes("maps.app.goo.gl") ||
    s.includes("maps.google.com")
  );
}

function openGoogleMaps() {
  // Abre Google Maps para que el usuario copie “Compartir enlace”
  window.open("https://www.google.com/maps", "_blank", "noopener,noreferrer");
}

function renderProducts() {
  elProducts.innerHTML = "";

  for (const p of PRODUCTS) {
    const qty = cart.get(p.id) || 0;
    const div = document.createElement("div");
    div.className = "product";
    div.innerHTML = `
      <div>
        <div class="name">${p.name}</div>
        <div class="price">$${money(p.price)} c/u</div>
      </div>
      <div class="stepper">
        <button type="button" data-action="dec" data-id="${p.id}">−</button>
        <div class="qty" id="qty_${p.id}">${qty}</div>
        <button type="button" data-action="inc" data-id="${p.id}">+</button>
      </div>
    `;
    elProducts.appendChild(div);
  }

  elProducts.onclick = (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;

    const id = btn.dataset.id;
    const action = btn.dataset.action;

    const current = cart.get(id) || 0;
    const next = action === "inc" ? current + 1 : Math.max(0, current - 1);

    cart.set(id, next);
    const qtyEl = document.getElementById(`qty_${id}`);
    if (qtyEl) qtyEl.textContent = String(next);

    updateSummary();
  };
}

function buildCartItems() {
  return PRODUCTS
    .map(p => ({ id: p.id, name: p.name, qty: cart.get(p.id) || 0, price: p.price }))
    .filter(it => it.qty > 0);
}

function updateSummary() {
  const items = buildCartItems();
  const totalUnits = items.reduce((a, b) => a + b.qty, 0);
  const subtotal = items.reduce((a, b) => a + b.qty * b.price, 0);

  elTotalUnits.textContent = String(totalUnits);
  elSubtotal.textContent = money(subtotal);

  if (items.length === 0) {
    elCartSummary.textContent = "Aún no has seleccionado postres.";
  } else {
    elCartSummary.innerHTML = items
      .map(it => `<div>• <strong>${it.name}</strong> x${it.qty}</div>`)
      .join("");
  }
}

function getFormData() {
  const customer_name = document.getElementById("name").value.trim();
  const phone = document.getElementById("phone").value.trim();
  const address_text = document.getElementById("address").value.trim();
  const maps_link = document.getElementById("maps").value.trim();
  const notes = document.getElementById("notes").value.trim();

  const items = buildCartItems();
  const total_units = items.reduce((a, b) => a + b.qty, 0);
  const subtotal = items.reduce((a, b) => a + b.qty * b.price, 0);

  return { customer_name, phone, address_text, maps_link, notes, items, total_units, subtotal };
}

function validate(data) {
  if (data.items.length === 0) return "Selecciona al menos 1 postre.";
  if (!data.customer_name) return "Escribe tu nombre.";
  if (!data.phone) return "Escribe tu número.";
  if (!data.address_text) return "Escribe tu dirección.";
  if (!isValidMapsLink(data.maps_link)) return "Pega un link válido de Google Maps (Compartir → Copiar enlace).";
  return null;
}

function buildWhatsAppMessage(data, orderId) {
  const lines = [];
  lines.push(`Hola, mi nombre es ${data.customer_name} y mi número es ${data.phone}.`);
  lines.push("");
  lines.push(`Quiero hacer un pedido (Código: ${orderId}):`);
  for (const it of data.items) {
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

function openWhatsApp(text) {
  const url = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

async function saveOrder(data) {
  const res = await fetch(ORDER_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  let out;
  try {
    out = await res.json();
  } catch {
    const t = await res.text().catch(() => "");
    throw new Error(`Worker non-JSON response. HTTP ${res.status}\n${t.slice(0, 300)}`);
  }

  if (!out.ok) {
    const extra = out.raw_snippet ? `\n\nDetalle:\n${out.raw_snippet}` : "";
    const dbg = out.debug ? `\n\nDebug: ${JSON.stringify(out.debug)}` : "";
    throw new Error((out.error || "No se pudo guardar el pedido.") + dbg + extra);
  }

  return out.order_id || null;
}

// ===== Modal helpers =====
function showModal() {
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function hideModal() {
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

function fillModal(data, orderId, message) {
  elModalItems.innerHTML = data.items.map(it => {
    const lineTotal = it.qty * it.price;
    return `
      <div class="itemLine">
        <div class="itemLeft">
          <div class="itemName">${it.name} x${it.qty}</div>
          <div class="itemMeta">$${money(it.price)} c/u</div>
        </div>
        <div class="itemRight"><strong>$${money(lineTotal)}</strong></div>
      </div>
    `;
  }).join("");

  elModalUnits.textContent = String(data.total_units);
  elModalSubtotal.textContent = money(data.subtotal);
  elModalMessage.value = message;
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback
    elModalMessage.focus();
    elModalMessage.select();
    try {
      const ok = document.execCommand("copy");
      return ok;
    } catch {
      return false;
    }
  }
}

// ===== Events =====
btnOpenMaps.addEventListener("click", () => {
  openGoogleMaps();
});

btnCloseModal.addEventListener("click", () => hideModal());
modal.addEventListener("click", (e) => {
  if (e.target === modal) hideModal();
});

btnCopyMessage.addEventListener("click", async () => {
  if (!pending) return;
  const ok = await copyToClipboard(pending.message);
  elStatus.textContent = ok ? "✅ Mensaje copiado. Si WhatsApp no abre, pégalo manualmente." : "❌ No se pudo copiar. Selecciona el texto y cópialo manualmente.";
});

btnSendWhatsApp.addEventListener("click", async () => {
  if (!pending) return;

  btnSendWhatsApp.disabled = true;
  btnCopyMessage.disabled = true;
  btnCloseModal.disabled = true;

  try {
    // 1) Abrir WhatsApp
    openWhatsApp(pending.message);

    // 2) Guardar en Sheets
    elStatus.textContent = "Registrando pedido...";
    await saveOrder(pending.data);

    elStatus.textContent = `Listo ✅ Pedido creado (código: ${pending.orderId}).`;
    hideModal();
  } catch (e) {
    elStatus.textContent = `Error: ${e.message}`;
  } finally {
    btnSendWhatsApp.disabled = false;
    btnCopyMessage.disabled = false;
    btnCloseModal.disabled = false;
  }
});

btnWhatsApp.addEventListener("click", () => {
  elStatus.textContent = "";

  try {
    const data = getFormData();
    const err = validate(data);
    if (err) throw new Error(err);

    const orderId = generateClientOrderId();
    data.order_id = orderId;

    const message = buildWhatsAppMessage(data, orderId);

    // Guardar como pendiente y mostrar modal
    pending = { orderId, data, message };
    fillModal(data, orderId, message);
    showModal();
  } catch (e) {
    elStatus.textContent = `Error: ${e.message}`;
  }
});

// Init
renderProducts();
updateSummary();
