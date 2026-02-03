// =================== CONFIG ===================
const WHATSAPP_NUMBER = "573028473086";
const ORDER_API_URL = "https://amared-orders.amaredpostres.workers.dev/"; // tu Worker

const PRODUCTS = [
  { id: "mousse_maracuya", name: "Mousse de Maracuyá", price: 10000 },
  { id: "cheesecake_cafe_panela", name: "Cheesecake de café con panela", price: 12500 },
  { id: "arroz_con_leche", name: "Arroz con Leche", price: 8000 },
];

const cart = new Map(PRODUCTS.map(p => [p.id, 0]));

// =================== DOM ===================
const elProducts = document.getElementById("products");
const elTotalUnits = document.getElementById("totalUnits");
const elSubtotal = document.getElementById("subtotal");
const elCartSummary = document.getElementById("cartSummary");
const elStatus = document.getElementById("status");

const btnWhatsApp = document.getElementById("btnWhatsApp");
const btnOpenMaps = document.getElementById("btnOpenMaps");

// Modal confirmación
const modal = document.getElementById("confirmModal");
const btnCloseModal = document.getElementById("btnCloseModal");
const btnCopyMessage = document.getElementById("btnCopyMessage");
const btnSendWhatsApp = document.getElementById("btnSendWhatsApp");

const elModalItems = document.getElementById("modalItems");
const elModalUnits = document.getElementById("modalUnits");
const elModalSubtotal = document.getElementById("modalSubtotal");
const elModalMessage = document.getElementById("modalMessage");

// Ubicación (opciones)
const mapsBlock = document.getElementById("mapsBlock");
const waLocBlock = document.getElementById("waLocBlock");

// Alerta central
const alertOverlay = document.getElementById("alertOverlay");
const alertText = document.getElementById("alertText");
const btnAlertOk = document.getElementById("btnAlertOk");

// =================== STATE ===================
let pending = null; // { orderId, data, message }
let shouldResetAfterAlert = false;

// =================== UTILS ===================
function money(n) {
  return Math.round(n).toLocaleString("es-CO");
}

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

function isValidEmail(email) {
  if (!email) return true; // opcional
  // Validación simple (suficiente para formulario)
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidMapsLink(link) {
  const s = String(link || "").trim();
  if (!s) return false;
  return (
    s.includes("google.com/maps") ||
    s.includes("goo.gl/maps") ||
    s.includes("maps.app.goo.gl") ||
    s.includes("maps.google.com")
  );
}

function openGoogleMaps() {
  window.open("https://www.google.com/maps", "_blank", "noopener,noreferrer");
}

function getSelectedLocationMethod() {
  const el = document.querySelector('input[name="locMethod"]:checked');
  return el ? el.value : "maps";
}

function syncLocationUI() {
  const method = getSelectedLocationMethod();
  const showMaps = method === "maps";
  if (mapsBlock) mapsBlock.style.display = showMaps ? "" : "none";
  if (waLocBlock) waLocBlock.style.display = showMaps ? "none" : "";
}

function getWhatsAppUrl(text) {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
}

// =================== ALERT HELPERS ===================
function showAlert(message) {
  if (!alertOverlay || !alertText) {
    alert(message);
    return;
  }
  alertText.textContent = String(message || "Ocurrió un error.");
  alertOverlay.classList.remove("hidden");
  alertOverlay.setAttribute("aria-hidden", "false");
}

function hideAlert() {
  if (!alertOverlay) return;
  alertOverlay.classList.add("hidden");
  alertOverlay.setAttribute("aria-hidden", "true");
}

// =================== UI RENDER ===================
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

// =================== FORM DATA + VALIDATION ===================
function getFormData() {
  const customer_name = document.getElementById("name").value.trim();
  const phone = document.getElementById("phone").value.trim();
  const address_text = document.getElementById("address").value.trim();
  const maps_link = document.getElementById("maps").value.trim();
  const notes = document.getElementById("notes").value.trim();

  // ✅ nuevos campos
  const emailEl = document.getElementById("email");
  const email = emailEl ? emailEl.value.trim() : "";
  const waOptEl = document.getElementById("waOptIn");
  const wa_opt_in = waOptEl ? waOptEl.checked : false;

  const location_method = getSelectedLocationMethod(); // "maps" | "whatsapp"

  const items = buildCartItems();
  const total_units = items.reduce((a, b) => a + b.qty, 0);
  const subtotal = items.reduce((a, b) => a + b.qty * b.price, 0);

  return {
    customer_name,
    phone,
    address_text,
    maps_link,
    notes,
    location_method,
    items,
    total_units,
    subtotal,
    email,
    wa_opt_in,
  };
}

function validate(data) {
  if (data.items.length === 0) return "Selecciona al menos 1 postre.";
  if (!data.customer_name) return "Escribe tu nombre.";
  if (!data.phone) return "Escribe tu número.";
  if (!data.address_text) return "Escribe tu dirección.";

  if (!isValidEmail(data.email)) return "El correo no parece válido. Revisa el formato (ej: correo@dominio.com).";

  // Ubicación: o link maps (si eligió maps) o enviar ubicación por WhatsApp (si eligió whatsapp)
  if (data.location_method === "maps") {
    if (!data.maps_link) return "Pega el link de Google Maps o selecciona “Enviar ubicación desde WhatsApp”.";
    if (!isValidMapsLink(data.maps_link)) return "El link de Google Maps no parece válido. Usa Compartir → Copiar enlace, o selecciona “Enviar ubicación desde WhatsApp”.";
  }

  return null;
}

// =================== WHATSAPP MESSAGE ===================
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
  lines.push(`Domicilio: lo cubre el cliente. (Se debe confirmar mediante WhatsApp)`);
  lines.push("");
  lines.push(`Dirección: ${data.address_text}`);

  if (data.location_method === "maps") {
    lines.push(`Ubicación (Google Maps): ${data.maps_link}`);
  } else {
    lines.push(`Ubicación: Te la envío por WhatsApp (ubicación/punto).`);
  }

  if (data.notes) lines.push(`Nota: ${data.notes}`);

  // ✅ mensaje que pediste
  lines.push("");
  lines.push("✅ Ya registré el pedido desde la web.");
  lines.push("Para iniciar la elaboración, queda pendiente confirmar el pago por este chat.");
  lines.push("");
  lines.push("Muchas gracias.");

  return lines.join("\n");
}

// =================== SAVE ORDER ===================
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
    throw new Error(`Respuesta inválida del servidor. HTTP ${res.status}\n${t.slice(0, 250)}`);
  }

  if (!out.ok) {
    throw new Error(out.error || "No se pudo guardar el pedido.");
  }

  return out.order_id || null;
}

// =================== MODAL HELPERS ===================
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
        <div>
          <div class="itemName">${it.name} x${it.qty}</div>
          <div class="itemMeta">$${money(it.price)} c/u</div>
        </div>
        <div><strong>$${money(lineTotal)}</strong></div>
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
    // fallback
    elModalMessage.focus();
    elModalMessage.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    }
  }
}

// =================== RESET AFTER ORDER ===================
function resetAll() {
  // Vaciar carrito
  for (const p of PRODUCTS) cart.set(p.id, 0);

  // Reset inputs
  document.getElementById("name").value = "";
  document.getElementById("phone").value = "";
  document.getElementById("address").value = "";
  document.getElementById("maps").value = "";
  document.getElementById("notes").value = "";

  const emailEl = document.getElementById("email");
  if (emailEl) emailEl.value = "";

  const waOpt = document.getElementById("waOptIn");
  if (waOpt) waOpt.checked = false;

  // Reset ubicación a maps
  const rMaps = document.querySelector('input[name="locMethod"][value="maps"]');
  if (rMaps) rMaps.checked = true;
  syncLocationUI();

  pending = null;
  elStatus.textContent = "";

  renderProducts();
  updateSummary();

  window.scrollTo({ top: 0, behavior: "smooth" });
}

// =================== EVENTS ===================
btnOpenMaps?.addEventListener("click", () => openGoogleMaps());

document.querySelectorAll('input[name="locMethod"]').forEach(r => {
  r.addEventListener("change", syncLocationUI);
});

btnAlertOk?.addEventListener("click", () => {
  hideAlert();
  if (shouldResetAfterAlert) {
    shouldResetAfterAlert = false;
    resetAll();
  }
});

alertOverlay?.addEventListener("click", (e) => {
  if (e.target === alertOverlay) hideAlert();
});

btnCloseModal?.addEventListener("click", hideModal);
modal?.addEventListener("click", (e) => {
  if (e.target === modal) hideModal();
});

btnCopyMessage?.addEventListener("click", async () => {
  if (!pending) return;
  const ok = await copyToClipboard(pending.message);
  elStatus.textContent = ok
    ? "✅ Mensaje copiado. Si WhatsApp no abre, pégalo manualmente."
    : "❌ No se pudo copiar. Selecciona el texto y cópialo manualmente.";
});

// ✅ CLAVE: Guardar primero y luego redirigir a WhatsApp (en la misma pestaña)
btnSendWhatsApp?.addEventListener("click", async () => {
  if (!pending) return;

  btnSendWhatsApp.disabled = true;
  btnCopyMessage.disabled = true;
  btnCloseModal.disabled = true;

  try {
    elStatus.textContent = "Registrando pedido...";

    // 1) Guardar primero
    await saveOrder(pending.data);

    // 2) Cerrar modal
    hideModal();

    // 3) Mostrar aviso y preparar limpieza
    shouldResetAfterAlert = true;
    showAlert(
      "Pedido registrado ✅\n\nAhora falta confirmar el pago por WhatsApp para poder iniciar la elaboración."
    );

    // 4) Abrir WhatsApp (más compatible)
    const waUrl = getWhatsAppUrl(pending.message);
    window.location.assign(waUrl);

  } catch (e) {
    elStatus.textContent = "";
    showAlert(`Error: ${e.message}`);
  } finally {
    btnSendWhatsApp.disabled = false;
    btnCopyMessage.disabled = false;
    btnCloseModal.disabled = false;
  }
});

// Botón principal: valida y abre el modal
btnWhatsApp?.addEventListener("click", () => {
  elStatus.textContent = "";

  try {
    const data = getFormData();
    const err = validate(data);
    if (err) throw new Error(err);

    const orderId = generateClientOrderId();
    data.order_id = orderId;

    const message = buildWhatsAppMessage(data, orderId);

    pending = { orderId, data, message };
    fillModal(data, orderId, message);
    showModal();
  } catch (e) {
    showAlert(e.message);
  }
});

// =================== INIT ===================
renderProducts();
updateSummary();
syncLocationUI();
