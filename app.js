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
let _loadingStartTs = 0;

// Ubicación
const mapsBlock = document.getElementById("mapsBlock");
const waLocBlock = document.getElementById("waLocBlock");

// Alerta central
const alertOverlay = document.getElementById("alertOverlay");
const alertText = document.getElementById("alertText");
const btnAlertOk = document.getElementById("btnAlertOk");
const alertHelpWrap = document.getElementById("alertHelpWrap");
const alertHelpDetails = document.getElementById("alertHelpDetails");
const alertWaNumberText = document.getElementById("alertWaNumberText");
const btnAlertOpenChat = document.getElementById("btnAlertOpenChat");
const btnAlertCopyMessage = document.getElementById("btnAlertCopyMessage");
const alertHelpMessage = document.getElementById("alertHelpMessage");

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
  const NL = String.fromCharCode(10);
  let msg = raw;
  // Convertir secuencias escapadas a saltos reales
  for(let i=0;i<3;i++){
    msg = msg.split("\\n").join(NL);
    msg = msg.split("\n").join(NL);
  }

  if (!alertOverlay || !alertText) return;
  alertText.textContent = msg;
  try{
    alertOverlay.style.zIndex = "30000";
    alertOverlay.style.display = "grid";
  }catch(_e){}
  alertOverlay.classList.remove("hidden");
  alertOverlay.setAttribute("aria-hidden", "false");
  clearAlertHelp();
}

function hideAlert() {
  if (!alertOverlay) return;
  alertOverlay.classList.add("hidden");
  alertOverlay.setAttribute("aria-hidden", "true");
  try{ alertOverlay.style.display = "none"; }catch(_e){}
  clearAlertHelp();
}

function clearAlertHelp(){
  try{
    if(alertHelpWrap) alertHelpWrap.classList.add("hidden");
    if(alertHelpDetails) alertHelpDetails.open = false;
    if(alertHelpMessage){
      alertHelpMessage.value = "";
      alertHelpMessage.style.display = "none";
    }
  }catch(_e){}
}

function setAlertHelp(messageToCopy, autoOpen=false){
  try{
    if(!alertHelpWrap) return;
    if(alertWaNumberText) alertWaNumberText.textContent = "+57 302 847 3086";
    if(alertHelpMessage){
      alertHelpMessage.value = String(messageToCopy || "");
      alertHelpMessage.style.display = (alertHelpDetails && alertHelpDetails.open) ? "block" : "none";
    }
    alertHelpWrap.classList.remove("hidden");
    if(autoOpen && alertHelpDetails) alertHelpDetails.open = true;
  }catch(_e){}
}

alertHelpDetails?.addEventListener("toggle", () => {
  if(!alertHelpMessage) return;
  alertHelpMessage.style.display = alertHelpDetails.open ? "block" : "none";
});


function storeResumeAlert(message, shouldReset, helpMessage=""){
  try{
    localStorage.setItem("AMARED_RESUME_ALERT", JSON.stringify({
      message: String(message || ""),
      help: String(helpMessage || ""),
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
      if(data.help) setAlertHelp(data.help, false);
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
      // ✅ EXACTO como delivery: usar wa.me y navegar en la MISMA pestaña
      hideModal();
      shouldResetAfterAlert = true;

      // al volver al navegador, mostrar aviso
      storeResumeAlert(SUCCESS_MSG, true, pending.messageFallback);

      hideLoading();
      openWhatsAppUrl(waUrl); // mobile => location.href
      return;
    }

    // PC: abre en pestaña nueva
    if(waWin){
      try{ waWin.location.href = waUrl; }catch(_e){}
      hideModal();
      shouldResetAfterAlert = true;
      showAlert(SUCCESS_MSG);
      setAlertHelp(pending.messageFallback, false);
      return;
    }

    // Si el navegador bloqueó abrir pestaña: abrir ayuda
    enableHelpMessage(pending.messageFallback, true);
    showAlert("Pedido registrado ✅\n\nSi no se abrió WhatsApp, copia el mensaje y pégalo en el chat.");
    setAlertHelp(pending.messageFallback, true);
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
    _loadingStartTs = Date.now();
    if(loadingText) loadingText.textContent = text;
    if(loadingOverlay){
      loadingOverlay.classList.remove("hidden");
      loadingOverlay.setAttribute("aria-hidden","false");
      loadingOverlay.style.zIndex = "28000";
      loadingOverlay.style.display = "grid";
    }
  }catch(_e){}
}
function hideLoading(){
  try{
    const elapsed = _loadingStartTs ? (Date.now() - _loadingStartTs) : 9999;
    const doHide = () => {
      if(loadingOverlay){
        loadingOverlay.classList.add("hidden");
        loadingOverlay.setAttribute("aria-hidden","true");
        loadingOverlay.style.display = "none";
      }
    };
    if(elapsed < 600){
      setTimeout(doHide, 600 - elapsed);
    }else{
      doHide();
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


btnAlertOpenChat?.addEventListener("click", () => {
  const url = buildWhatsAppChatOnlyUrl();
  openWhatsAppUrl(url);
});

btnAlertCopyMessage?.addEventListener("click", async () => {
  try{
    const txt = (alertHelpMessage && alertHelpMessage.value) ? alertHelpMessage.value : "";
    if(!txt) return;
    await navigator.clipboard.writeText(txt);
    const NL = String.fromCharCode(10);
    if(alertText) alertText.textContent = "Mensaje copiado ✅" + NL + NL + "Pégalo en WhatsApp y envíalo para confirmar tu pedido.";
  }catch(_e){
    try{
      if(alertHelpMessage){
        alertHelpMessage.focus();
        alertHelpMessage.select();
        document.execCommand("copy");
        const NL = String.fromCharCode(10);
        if(alertText) alertText.textContent = "Mensaje copiado ✅" + NL + NL + "Pégalo en WhatsApp y envíalo para confirmar tu pedido.";
      }
    }catch(_e2){}
  }
});



/* =========================
   Opiniones (Reviews)
========================= */

const reviewsListEl = document.getElementById("reviewsList");
const reviewsAvgEl = document.getElementById("reviewsAvg");
const reviewsCountEl = document.getElementById("reviewsCount");
const reviewsAvgStarsEl = document.getElementById("reviewsAvgStars");
const btnOpenReviewModal = document.getElementById("btnOpenReviewModal");

const reviewModal = document.getElementById("reviewModal");
const btnCloseReview = document.getElementById("btnCloseReview");
const btnSubmitReview = document.getElementById("btnSubmitReview");
const reviewLast4 = document.getElementById("reviewLast4");
const reviewName = document.getElementById("reviewName");
const reviewComment = document.getElementById("reviewComment");
const reviewCharCount = document.getElementById("reviewCharCount");
const reviewStarsRow = document.getElementById("reviewStars");

let _reviewRating = 0;

function showReviewModal(){
  if(!reviewModal) return;
  reviewModal.classList.remove("hidden");
  reviewModal.setAttribute("aria-hidden","false");
}

function hideReviewModal(){
  if(!reviewModal) return;
  reviewModal.classList.add("hidden");
  reviewModal.setAttribute("aria-hidden","true");
}

function setStarsUI(val){
  _reviewRating = val;
  if(!reviewStarsRow) return;
  [...reviewStarsRow.querySelectorAll(".starBtn")].forEach(btn => {
    const v = Number(btn.getAttribute("data-value") || "0");
    btn.classList.toggle("isOn", v <= val);
  });
}

reviewStarsRow?.addEventListener("click", (e) => {
  const btn = e.target?.closest?.(".starBtn");
  if(!btn) return;
  const v = Number(btn.getAttribute("data-value") || "0");
  if(!v) return;
  setStarsUI(v);
});

reviewComment?.addEventListener("input", () => {
  if(reviewCharCount){
    reviewCharCount.textContent = `${String(reviewComment.value || "").length}/300`;
  }
});

btnOpenReviewModal?.addEventListener("click", () => {
  hideAlert();
  // reset
  if(reviewLast4) reviewLast4.value = "";
  if(reviewName) reviewName.value = "";
  if(reviewComment) reviewComment.value = "";
  if(reviewCharCount) reviewCharCount.textContent = "0/300";
  setStarsUI(0);
  showReviewModal();
});

btnCloseReview?.addEventListener("click", hideReviewModal);
reviewModal?.addEventListener("click", (e) => {
  if(e.target === reviewModal) hideReviewModal();
});

function starsText(n){
  const k = Math.max(0, Math.min(5, Number(n)||0));
  return "★★★★★".slice(0,k) + "☆☆☆☆☆".slice(0, 5-k);
}

function renderAvgStars(avg){
  const a = Math.round((Number(avg)||0) * 10) / 10;
  const full = Math.round(a); // simple
  if(reviewsAvgStarsEl) reviewsAvgStarsEl.textContent = starsText(full);
}

function renderReviews(data){
  const list = data?.reviews || [];
  const avg = Number(data?.avg_rating || 0);
  const count = Number(data?.count || list.length || 0);

  if(reviewsAvgEl) reviewsAvgEl.textContent = count ? (Math.round(avg*10)/10).toFixed(1) : "—";
  if(reviewsCountEl) reviewsCountEl.textContent = String(count || 0);
  renderAvgStars(avg);

  if(!reviewsListEl) return;
  if(!list.length){
    reviewsListEl.innerHTML = '<div class="muted small">Aún no hay opiniones publicadas.</div>';
    return;
  }

  reviewsListEl.innerHTML = list.map(r => {
    const nm = escapeHtml(r.name || "Cliente");
    const txt = escapeHtml(r.comment || "");
    const dt = escapeHtml(r.created_at || "");
    const st = starsText(r.rating || 0);
    return `
      <div class="reviewCard">
        <div class="reviewCardTop">
          <div class="reviewName">${nm}</div>
          <div class="reviewStars" aria-hidden="true">${st}</div>
        </div>
        <div class="muted small reviewMeta">${dt}</div>
        <div class="reviewText">${txt}</div>
      </div>
    `;
  }).join("");
}

async function fetchReviews(){
  try{
    const res = await fetch(ORDER_API_URL, {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ action: "reviews_list", limit: 8 })
    });
    const out = await res.json();
    if(out?.ok) renderReviews(out);
  }catch(_e){
    // silencioso
  }
}

async function submitReview(){
  const last4 = String(reviewLast4?.value || "").trim();
  const name = String(reviewName?.value || "").trim();
  const comment = String(reviewComment?.value || "").trim();

  if(!/^[0-9]{4}$/.test(last4)){
    showAlert("Escribe los últimos 4 dígitos del ID (ej: 1234).");
    return;
  }
  if(!_reviewRating || _reviewRating < 1 || _reviewRating > 5){
    showAlert("Selecciona una calificación (1 a 5 estrellas).");
    return;
  }
  if(comment.length < 10){
    showAlert("Escribe una opinión un poco más larga (mínimo 10 caracteres).");
    return;
  }

  showLoading("Enviando opinión...");
  try{
    const res = await fetch(ORDER_API_URL, {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({
        action: "reviews_submit",
        last4,
        rating: _reviewRating,
        name,
        comment
      })
    });
    const out = await res.json();
    hideLoading();
    if(btnSubmitReview) btnSubmitReview.disabled = false;

    if(!out?.ok){
      showAlert(out?.error || "No se pudo enviar la opinión.");
      return;
    }

    hideReviewModal();
    if(btnSubmitReview) btnSubmitReview.disabled = false;
    showAlert("¡Gracias! Tu opinión se publicará si tu pedido aparece como ENVIADO.");
    await fetchReviews();
  }catch(e){
    hideLoading();
    if(btnSubmitReview) btnSubmitReview.disabled = false;
    showAlert("Error enviando la opinión. Intenta de nuevo.");
  }
}

btnSubmitReview?.addEventListener("click", submitReview);

// cargar opiniones al iniciar
fetchReviews();
