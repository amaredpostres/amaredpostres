// =================== CONFIG ===================
const SUCCESS_MSG = "Pedido registrado ✅\n\nAhora falta confirmar el pago por WhatsApp.";

const WHATSAPP_NUMBER = "573028473086";
const ORDER_API_URL = "https://amared-orders.amaredpostres.workers.dev/";

// 👇 Asegúrate que estos nombres coincidan con tus archivos en /assets/
const PRODUCTS = [
  {
    id: "mousse_maracuya",
    name: "Mousse de Maracuyá",
    desc: "Cremoso, cítrico y refrescante. Perfecto para después del almuerzo.",
    price: 10000,
    img: "assets/mousse.webp",
    alt: "Mousse de maracuyá"
  },
  {
    id: "cheesecake_cafe_panela",
    name: "Cheesecake de café con panela",
    desc: "Sabor intenso a café, dulce balanceado y textura suave.",
    price: 12500,
    img: "assets/cheesecake.webp",
    alt: "Cheesecake de café con panela"
  },
  /*{
    id: "arroz_con_leche",
    name: "Arroz con Leche",
    desc: "Tradicional, cremosito y casero. Un clásico que siempre antoja.",
    price: 8000,
    img: "assets/arroz.webp",
    alt: "Arroz con leche"
  }, Desactivado Temporalmente.*/
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

// Fallback UI
const fallbackWrap = document.getElementById("fallbackWrap");
const fallbackDetails = document.getElementById("fallbackDetails");
const waNumberText = document.getElementById("waNumberText");
const btnOpenChat = document.getElementById("btnOpenChat");
const modalStatus = document.getElementById("modalStatus");

// Loading overlay
const loadingOverlay = document.getElementById("loadingOverlay");
const loadingText = document.getElementById("loadingText");

// Ubicación
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



function escapeHtml(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
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
  if (!email) return true;
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

function isMobileUA(){
  const ua = navigator.userAgent || "";
  return /Android|iPhone|iPad|iPod|Mobi/i.test(ua);
}
function buildWhatsAppUrlWithText(text){
  const enc = encodeURIComponent(String(text || ""));
  // ✅ PC: página intermedia (muestra el texto siempre)
  if(!isMobileUA()){
    return `https://api.whatsapp.com/send?phone=${WHATSAPP_NUMBER}&text=${enc}`;
  }
  // ✅ Móvil: abre app directo
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${enc}`;
}
function buildWhatsAppChatOnlyUrl(){
  if(!isMobileUA()){
    return `https://api.whatsapp.com/send?phone=${WHATSAPP_NUMBER}`;
  }
  return `https://wa.me/${WHATSAPP_NUMBER}`;
}

function openWhatsAppUrl(url){
  if(isMobileUA()){
    window.location.href = url;
  }else{
    window.open(url, "_blank", "noopener,noreferrer");
  }
}


function openWhatsAppMobile(text){
  const enc = encodeURIComponent(String(text || ""));
  const deep = `whatsapp://send?phone=${WHATSAPP_NUMBER}&text=${enc}`;
  const web = `https://wa.me/${WHATSAPP_NUMBER}?text=${enc}`;
  window.location.href = deep;
  setTimeout(() => {
    if(document.visibilityState === "visible") window.location.href = web;
  }, 650);
}


// =================== ALERT HELPERS ===================
function showAlert(message) {
  const raw = String(message || "Ocurrió un error.");
  // Si llega con "\\n", conviértelo a salto real
  const msg = raw.split("\\n").join("\n");

  if (!alertOverlay || !alertText) return;
  alertText.textContent = msg;
  try{
    alertOverlay.style.zIndex = "30000";
    alertOverlay.style.display = "grid";
  }catch(_e){}
  alertOverlay.classList.remove("hidden");
  alertOverlay.setAttribute("aria-hidden", "false");
}

function hideAlert() {
  if (!alertOverlay) return;
  alertOverlay.classList.add("hidden");
  alertOverlay.setAttribute("aria-hidden", "true");
  try{ alertOverlay.style.display = "none"; }catch(_e){}
}

function storeResumeAlert(message, shouldReset){
  try{
    localStorage.setItem("AMARED_RESUME_ALERT", JSON.stringify({
      message: String(message || ""),
      reset: !!shouldReset,
      ts: Date.now()
    }));
  }catch(_e){}
}

function tryResumeAlert(){
  try{
    const raw = localStorage.getItem("AMARED_RESUME_ALERT");
    if(!raw) return;
    localStorage.removeItem("AMARED_RESUME_ALERT");
    const data = JSON.parse(raw);
    if(data && data.message){
      shouldResetAfterAlert = !!data.reset;
      showAlert(data.message);
    }
  }catch(_e){}
}

document.addEventListener("visibilitychange", () => {
  if(document.visibilityState === "visible"){
    tryResumeAlert();
  }
});


// =================== UI RENDER ===================
function renderProducts() {
  elProducts.innerHTML = "";

  for (const p of PRODUCTS) {
    const qty = cart.get(p.id) || 0;

    const div = document.createElement("div");
    div.className = "productCard";

    div.innerHTML = `
      <img class="productImg" src="${p.img}" alt="${p.alt || p.name}" loading="lazy" />

      <div class="productInfo">
        <div class="productTop">
          <div class="name">${p.name}</div>
          <div class="price">$${money(p.price)} c/u <span class="sizeBadge">6 oz</span></div>
        </div>

        <div class="productDesc">${p.desc || ""}</div>

        <div class="productBottom">
          <div class="stepper">
            <button type="button" data-action="dec" data-id="${p.id}">−</button>
            <div class="qty" id="qty_${p.id}">${qty}</div>
            <button type="button" data-action="inc" data-id="${p.id}">+</button>
          </div>
        </div>
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

  lines.push("");
  lines.push("✅ Ya registré el pedido desde la web.");
  lines.push("Para iniciar la elaboración, queda pendiente confirmar el pago por este chat.");
  lines.push("");
  lines.push("Muchas gracias.");

  return lines.join("\n");
}

function buildWhatsAppFallbackMessage(data, orderId){
  const base = buildWhatsAppMessage(data, orderId);
  const head = "⚠️ Mensaje copiado desde la web (WhatsApp no se abrió automáticamente).";
  return head + "\n\n" + base;
}


// =================== SAVE ORDER ===================
async function saveOrder(data) {
  const res = await fetch(ORDER_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "create_order", ...data }),
  });

  let out;
  try {
    out = await res.json();
  } catch {
    const t = await res.text().catch(() => "");
    throw new Error(`Respuesta inválida del servidor. HTTP ${res.status}\n${t.slice(0, 250)}`);
  }

  if (!out.ok) throw new Error(out.error || "No se pudo guardar el pedido.");

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

function fillModal(data, orderId) {
  // items list
  const items = data.items || [];
  elModalItems.innerHTML = items.map(it => `
    <div class="modalItem">
      <div><b>${escapeHtml(it.name)}</b></div>
      <div class="muted">x ${it.qty}</div>
    </div>
  `).join("");

  elModalUnits.textContent = String(data.total_units || 0);
  elModalSubtotal.textContent = money(data.subtotal || 0);

  if(modalStatus){
    modalStatus.style.display = "none";
    modalStatus.textContent = "";
  }
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    elModalMessage.focus();
    elModalMessage.select();
    try { return document.execCommand("copy"); } catch { return false; }
  }
}

// =================== RESET ===================
function resetAll() {
  for (const p of PRODUCTS) cart.set(p.id, 0);

  document.getElementById("name").value = "";
  document.getElementById("phone").value = "";
  document.getElementById("address").value = "";
  document.getElementById("maps").value = "";
  document.getElementById("notes").value = "";

  const emailEl = document.getElementById("email");
  if (emailEl) emailEl.value = "";

  const waOpt = document.getElementById("waOptIn");
  if (waOpt) waOpt.checked = false;

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
btnOpenMaps?.addEventListener("click", openGoogleMaps);

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



btnOpenChat?.addEventListener("click", () => {
  const url = buildWhatsAppChatOnlyUrl();
  openWhatsAppUrl(url);
});

btnCopyMessage?.addEventListener("click", async () => {
  try{
    const txt = (elModalMessage && elModalMessage.value) ? elModalMessage.value : (pending?.messageFallback || "");
    if(!txt) return;
    await navigator.clipboard.writeText(txt);
    showAlert("Mensaje copiado ✅\n\nPégalo en WhatsApp y envíalo para confirmar tu pedido.");
  }catch(_e){
    try{
      if(elModalMessage){
        elModalMessage.focus();
        elModalMessage.select();
        document.execCommand("copy");
        showAlert("Mensaje copiado ✅\n\nPégalo en WhatsApp y envíalo para confirmar tu pedido.");
      }
    }catch(_e2){}
  }
});


btnSendWhatsApp?.addEventListener("click", async () => {
  if (!pending) return;

  const isMobile = isMobileUA();

  // ✅ PC: pre-abrir pestaña para evitar bloqueo por "user gesture"
  let waWin = null;
  if(!isMobile){
    waWin = window.open("about:blank", "_blank");
  }

  btnSendWhatsApp.disabled = true;
  btnCloseModal.disabled = true;

  showLoading("Registrando pedido...");

  try {
    elStatus.textContent = "Registrando pedido...";

    // 1) Guardar primero
    await saveOrder(pending.data);

    // 2) Abrir WhatsApp con texto (normal)
    const waUrl = buildWhatsAppUrlWithText(pending.messageNormal);

    // 3) Habilitar ayuda (copiar/pegar) después del primer intento
    enableHelpMessage(pending.messageFallback, false);

    hideLoading();

    if(isMobile){
      // ✅ Igual que delivery: abrir la app directo (sin pestaña adicional)
      hideModal();
      shouldResetAfterAlert = true;

      // mostrar aviso al regresar al navegador
      storeResumeAlert(SUCCESS_MSG, true);

      hideLoading();
      openWhatsAppMobile(pending.messageNormal);
      return;
    }

    // PC: abre en pestaña nueva
    if(waWin){
      try{ waWin.location.href = waUrl; }catch(_e){}
      hideModal();
      shouldResetAfterAlert = true;
      showAlert(SUCCESS_MSG);
      return;
    }

    // Si el navegador bloqueó abrir pestaña: abrir ayuda
    enableHelpMessage(pending.messageFallback, true);
    showAlert("Pedido registrado ✅\n\nSi no se abrió WhatsApp, copia el mensaje y pégalo en el chat.");
    elStatus.textContent = "";

  } catch (e) {
    hideLoading();
    elStatus.textContent = "";
    showAlert(`Error: ${e.message}`);

    // En error: mostrar ayuda
    try{
      enableHelpMessage(pending?.messageFallback || "", true);
    }catch(_e){}
  } finally {
    btnSendWhatsApp.disabled = false;
    btnCloseModal.disabled = false;
  }
});

btnWhatsApp?.addEventListener("click", () => {
  elStatus.textContent = "";
  hideAlert();

  const data = getFormData();
  const err = validate(data);
  if (err) {
    showAlert(err);
    return;
  }

  const orderId = generateClientOrderId();
  data.order_id = orderId;

  const messageNormal = buildWhatsAppMessage(data, orderId);
  const messageFallback = buildWhatsAppFallbackMessage(data, orderId);

  pending = { orderId, data, messageNormal, messageFallback };
  initHelpUI();
  enableHelpMessage(messageFallback, false);
  fillModal(data, orderId);
  showModal();
});// =================== INIT ===================
renderProducts();
updateSummary();
syncLocationUI();


function showLoading(text="Procesando..."){
  try{
    if(loadingText) loadingText.textContent = text;
    if(loadingOverlay){
      loadingOverlay.classList.remove("hidden");
      loadingOverlay.setAttribute("aria-hidden","false");
      loadingOverlay.style.zIndex = "25000";
      loadingOverlay.style.display = "grid";
    }
  }catch(_e){}
}
function hideLoading(){
  try{
    if(loadingOverlay){
      loadingOverlay.classList.add("hidden");
      loadingOverlay.setAttribute("aria-hidden","true");
      loadingOverlay.style.display = "none";
    }
  }catch(_e){}
}


function initHelpUI(){
  try{
    if(waNumberText) waNumberText.textContent = "+57 302 847 3086";
    if(elModalMessage){
      elModalMessage.style.display = "none";
    }
    if(fallbackDetails) fallbackDetails.open = false;
  }catch(_e){}
}
function enableHelpMessage(text, autoOpen=false){
  try{
    if(elModalMessage){
      elModalMessage.value = text || "";
      elModalMessage.style.display = (fallbackDetails && fallbackDetails.open) ? "block" : "none";
    }
    if(autoOpen && fallbackDetails) fallbackDetails.open = true;
  }catch(_e){}
}


fallbackDetails?.addEventListener("toggle", () => {
  if(!elModalMessage) return;
  elModalMessage.style.display = fallbackDetails.open ? "block" : "none";
});

window.addEventListener("focus", () => { tryResumeAlert(); });
