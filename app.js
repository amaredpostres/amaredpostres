// =================== CONFIG ===================
const SUCCESS_MSG = "Pedido registrado ✅\n\nAhora falta confirmar el pago por WhatsApp.";
const PICKUP_ADDRESS_TEXT = "Recogida presencial";
const PICKUP_MAPS_TEXT = "RECOGIDA_PRESENCIAL";
const WHATSAPP_LOCATION_TEXT = "Ubicación por WhatsApp";
const WHATSAPP_LOCATION_MAPS_TEXT = "UBICACION_POR_WHATSAPP";
const PICKUP_VIDEO_URL = "https://drive.google.com/file/d/198VXUDfeyfouT7UauXBytVwyqbujxCn9/view?usp=sharing";

const WHATSAPP_NUMBER = "573028473086";
const ORDER_API_URL = "https://amared-orders.amaredpostres.workers.dev/";

// 👇 Asegúrate que estos nombres coincidan con tus archivos en /assets/
const DEFAULT_PRODUCTS = [
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
const PRODUCT_PRICES_STORAGE_KEY = "AMARED_PRODUCT_PRICES_V1";
const HUB_SESSION_KEY = "AMARED_HUB_SESSION_V1";
const HUB_REMEMBER_KEY = "AMARED_HUB_REMEMBER_V1";
const INDEX_ADMIN_ROLE_TAGS = new Set(["index_admin","indexadmin","pedidosweb","weborders","admin"]);
const PRODUCTS = DEFAULT_PRODUCTS.map(p => ({ ...p }));
let _catalogSyncInFlight = null;
let _catalogLastSyncTs = 0;
let _catalogReady = false;
let _catalogLoading = false;

function normalizeCats(v){
  if(Array.isArray(v)) return v.map(x => String(x || "").trim().toLowerCase()).filter(Boolean);
  return String(v || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
}
function safeParseJson(raw){
  try{ return JSON.parse(raw); }catch(_e){ return null; }
}
function loadProductPriceOverrides(){
  try{
    const parsed = safeParseJson(localStorage.getItem(PRODUCT_PRICES_STORAGE_KEY));
    return (parsed && typeof parsed === "object") ? parsed : {};
  }catch(_e){ return {}; }
}
function saveProductPriceOverrides(map){
  try{ localStorage.setItem(PRODUCT_PRICES_STORAGE_KEY, JSON.stringify(map || {})); }catch(_e){}
}
function clearProductPriceOverrides(){
  try{ localStorage.removeItem(PRODUCT_PRICES_STORAGE_KEY); }catch(_e){}
}
function applyStoredProductPrices(){
  const overrides = loadProductPriceOverrides();
  PRODUCTS.forEach((product, idx) => {
    const fallback = Number(DEFAULT_PRODUCTS[idx]?.price || product.price || 0);
    const next = Number(overrides?.[product.id]);
    product.price = Number.isFinite(next) && next > 0 ? Math.round(next) : fallback;
  });
}
function buildProductPriceMapFromItems(items){
  const map = {};
  (Array.isArray(items) ? items : []).forEach(item => {
    const id = String(item?.id || item?.dessert_id || item?.product_id || "").trim();
    const price = Number(item?.price ?? item?.public_price ?? item?.unit_price ?? 0);
    if(id && Number.isFinite(price) && price > 0) map[id] = Math.round(price);
  });
  return map;
}
function applyProductPriceMap(map){
  PRODUCTS.forEach((product, idx) => {
    const fallback = Number(DEFAULT_PRODUCTS[idx]?.price || product.price || 0);
    const next = Number(map?.[product.id]);
    product.price = Number.isFinite(next) && next > 0 ? Math.round(next) : fallback;
  });
}
function setCatalogLoadingState(isLoading){
  _catalogLoading = !!isLoading;
  if(elProducts){
    elProducts.setAttribute('aria-busy', _catalogLoading ? 'true' : 'false');
    elProducts.dataset.loading = _catalogLoading ? '1' : '0';
  }
  if(btnWhatsApp && !shouldUseIndexAdminView()){
    btnWhatsApp.disabled = _catalogLoading;
  }
}
async function bootProductsCatalog(){
  setCatalogLoadingState(true);
  try{
    await syncProductsCatalogFromBackend(true);
  }finally{
    _catalogReady = true;
    setCatalogLoadingState(false);
    renderProducts();
    updateSummary();
    try{ renderIndexAdminPriceEditor(); }catch(_e){}
  }
}
async function syncProductsCatalogFromBackend(force = false){
  const now = Date.now();
  if(!force && _catalogSyncInFlight) return _catalogSyncInFlight;
  if(!force && _catalogLastSyncTs && (now - _catalogLastSyncTs) < 60 * 1000) return Promise.resolve();

  _catalogSyncInFlight = (async ()=>{
    try{
      const res = await fetch(ORDER_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "products_catalog_public" })
      });
      const out = await res.json();
      if(!out?.ok) throw new Error(out?.error || "No se pudo cargar el catálogo público.");
      const items = Array.isArray(out.items) ? out.items : [];
      const priceMap = buildProductPriceMapFromItems(items);
      if(Object.keys(priceMap).length){
        saveProductPriceOverrides(priceMap);
        applyProductPriceMap(priceMap);
      }else{
        applyStoredProductPrices();
      }
      _catalogLastSyncTs = Date.now();
      if(_catalogReady){
        try{
          renderProducts();
          updateSummary();
          renderIndexAdminPriceEditor();
        }catch(_e){}
      }
    }catch(_e){
      applyStoredProductPrices();
      if(_catalogReady){
        try{
          renderProducts();
          updateSummary();
          renderIndexAdminPriceEditor();
        }catch(_e){}
      }
    }finally{
      _catalogSyncInFlight = null;
    }
  })();

  return _catalogSyncInFlight;
}
function buildIndexCatalogAuthPayload(base){
  const payload = Object.assign({}, base || {});
  if(HUB_INDEX_ADMIN_SESSION?.id && HUB_INDEX_ADMIN_SESSION?.password){
    payload.auth_profile_id = String(HUB_INDEX_ADMIN_SESSION.id || "").trim();
    payload.auth_profile_password = String(HUB_INDEX_ADMIN_SESSION.password || "").trim();
    payload.auth_page = "index";
    return payload;
  }
  const pin = window.prompt("Ingresa el PIN de administrador para guardar los precios globales:", "");
  if(!pin || !String(pin).trim()) return null;
  payload.admin_pin = String(pin).trim();
  return payload;
}
function loadHubIndexAdminSession(){
  const candidates = [];
  try{ candidates.push(sessionStorage.getItem(HUB_SESSION_KEY)); }catch(_e){}
  try{ candidates.push(localStorage.getItem(HUB_REMEMBER_KEY)); }catch(_e){}
  for(const raw of candidates){
    const data = safeParseJson(raw);
    if(!data?.password) continue;
    const cats = normalizeCats(data.categories || []);
    if(cats.some(cat => INDEX_ADMIN_ROLE_TAGS.has(cat))) return data;
  }
  return null;
}
function isIndexAdminMode(){
  try{
    const sp = new URLSearchParams(location.search);
    return sp.get("admin") === "1";
  }catch(_e){ return false; }
}
function hasHubSession(){
  try{ return !!sessionStorage.getItem(HUB_SESSION_KEY) || !!localStorage.getItem(HUB_REMEMBER_KEY); }catch(_e){ return false; }
}
function shouldUseIndexAdminView(){
  return isIndexAdminMode() || !!HUB_INDEX_ADMIN_SESSION;
}
function goHubFromIndexAdmin(){
  try{
    const ref = String(document.referrer || "");
    if((/(^|\/)hub\.html(?:\?|$)/i.test(ref) || hasHubSession()) && window.history.length > 1){
      window.history.back();
      return;
    }
  }catch(_e){}
  window.location.href = "hub.html";
}

applyStoredProductPrices();
const HUB_INDEX_ADMIN_SESSION = loadHubIndexAdminSession();
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
const loadingOverlay = document.getElementById("orderLoadingOverlay");
const loadingText = document.getElementById("orderLoadingText");
const loadingSub = document.getElementById("orderLoadingSub");
const loadingBar = document.getElementById("orderLoadingBar");
const loadingPercent = document.getElementById("orderLoadingPercent");
const loadingStep = document.getElementById("orderLoadingStep");
let _loadingStartTs = 0;
let _loadingTimer = null;
let _loadingProgress = 0;

// Ubicación
const mapsBlock = document.getElementById("mapsBlock");
const waLocBlock = document.getElementById("waLocBlock");
const pickupBlock = document.getElementById("pickupBlock");
const pickupVideoLink = document.getElementById("pickupVideoLink");
const pickupVideoHint = document.getElementById("pickupVideoHint");
const addressInput = document.getElementById("address");
const mapsInput = document.getElementById("maps");
const addressLabel = document.getElementById("addressLabel");
const addressHint = document.getElementById("addressHint");

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

function getPickupVideoUrl(){
  return String(PICKUP_VIDEO_URL || "").trim();
}

function syncPickupVideoUI(){
  const url = getPickupVideoUrl();
  if(pickupVideoLink){
    if(url){
      pickupVideoLink.href = url;
      pickupVideoLink.classList.remove("hidden");
    }else{
      pickupVideoLink.href = "#";
      pickupVideoLink.classList.add("hidden");
    }
  }
  if(pickupVideoHint){
    pickupVideoHint.classList.remove("hidden");
  }
}

function setAddressMode(mode){
  if(!addressInput) return;

  const isMaps = mode === "maps";
  const isWhatsApp = mode === "whatsapp";
  const isPickup = mode === "pickup";

  if(typeof addressInput.dataset.prevManualValue === "undefined"){
    addressInput.dataset.prevManualValue = "";
  }

  if(!addressInput.disabled && addressInput.value !== WHATSAPP_LOCATION_TEXT && addressInput.value !== PICKUP_ADDRESS_TEXT){
    addressInput.dataset.prevManualValue = addressInput.value || "";
  }

  if(isMaps){
    addressInput.disabled = false;
    addressInput.placeholder = "Ej: Calle 10 # 5-20, Apto 301";
    addressInput.value = addressInput.dataset.prevManualValue || "";
    if(addressLabel) addressLabel.innerHTML = 'Dirección <span class="req">*</span>';
    if(addressHint){
      addressHint.textContent = 'Escribe la dirección donde deseas recibir tu pedido.';
      addressHint.classList.add("hidden");
    }
    return;
  }

  addressInput.disabled = true;

  if(isWhatsApp){
    addressInput.value = WHATSAPP_LOCATION_TEXT;
    addressInput.placeholder = WHATSAPP_LOCATION_TEXT;
    if(addressLabel) addressLabel.innerHTML = 'Ubicación <span class="req">*</span>';
    if(addressHint){
      addressHint.textContent = 'Tu ubicación se compartirá directamente por WhatsApp cuando se abra el chat.';
      addressHint.classList.remove("hidden");
    }
    return;
  }

  addressInput.value = PICKUP_ADDRESS_TEXT;
  addressInput.placeholder = PICKUP_ADDRESS_TEXT;
  if(addressLabel) addressLabel.innerHTML = 'Recogida <span class="req">*</span>';
  if(addressHint){
    addressHint.textContent = 'El pedido se registrará como recogida presencial.';
    addressHint.classList.remove("hidden");
  }
}

function getSelectedLocationMethod() {
  const el = document.querySelector('input[name="locMethod"]:checked');
  return el ? el.value : "maps";
}

function syncLocationUI() {
  const method = getSelectedLocationMethod();
  const showMaps = method === "maps";
  const showWhatsApp = method === "whatsapp";
  const showPickup = method === "pickup";

  if (mapsBlock) mapsBlock.style.display = showMaps ? "" : "none";
  if (waLocBlock) waLocBlock.style.display = showWhatsApp ? "" : "none";
  if (pickupBlock) pickupBlock.classList.toggle("hidden", !showPickup);

  if(mapsInput && !showMaps){
    if(mapsInput.value && !mapsInput.dataset.prevValue){
      mapsInput.dataset.prevValue = mapsInput.value;
    }
    mapsInput.value = "";
  }else if(mapsInput && showMaps && !mapsInput.value && mapsInput.dataset.prevValue){
    mapsInput.value = mapsInput.dataset.prevValue;
  }

  setAddressMode(method);
  syncPickupVideoUI();
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
  syncIndexAdminMobileBar();
  clearAlertHelp();
}

function hideAlert() {
  if (!alertOverlay) return;
  alertOverlay.classList.add("hidden");
  alertOverlay.setAttribute("aria-hidden", "true");
  try{ alertOverlay.style.display = "none"; }catch(_e){}
  syncIndexAdminMobileBar();
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
function ensureCatalogLoadingInlineStyles(){
  if(document.getElementById("amaredPriceLoadingStyles")) return;
  const style = document.createElement("style");
  style.id = "amaredPriceLoadingStyles";
  style.textContent = `
    .priceLoadingText{
      display:inline-flex;
      align-items:center;
      gap:10px;
      opacity:.9;
      font-weight:700;
      letter-spacing:.01em;
    }
    .priceLoadingDots{
      display:inline-flex;
      align-items:center;
      gap:4px;
      min-width:26px;
    }
    .priceLoadingDot{
      width:7px;
      height:7px;
      border-radius:999px;
      background:currentColor;
      opacity:.22;
      transform:translateY(0) scale(.92);
      animation:amaredPriceLoadingPulse 1.15s ease-in-out infinite;
      box-shadow:0 0 0 0 rgba(255,255,255,0);
    }
    .priceLoadingDot:nth-child(2){ animation-delay:.16s; }
    .priceLoadingDot:nth-child(3){ animation-delay:.32s; }
    .priceLoadingLabel{
      opacity:.88;
      animation:amaredPriceLoadingFade 1.4s ease-in-out infinite;
    }
    @keyframes amaredPriceLoadingPulse{
      0%, 100%{ opacity:.22; transform:translateY(0) scale(.92); box-shadow:0 0 0 0 rgba(255,255,255,0); }
      40%{ opacity:.95; transform:translateY(-1px) scale(1.08); box-shadow:0 0 0 5px rgba(255,255,255,.05); }
    }
    @keyframes amaredPriceLoadingFade{
      0%, 100%{ opacity:.62; }
      50%{ opacity:1; }
    }
  `;
  document.head.appendChild(style);
}

function warmProductImages(){
  try{
    PRODUCTS.forEach(product => {
      const src = String(product?.img || "").trim();
      if(!src) return;
      const img = new Image();
      img.decoding = "async";
      img.src = src;
    });
  }catch(_e){}
}

function renderProductPriceHtml(product){
  if(_catalogReady) return `$${money(product.price)} c/u`;
  return '<span class="priceLoadingText" aria-live="polite"><span class="priceLoadingDots" aria-hidden="true"><span class="priceLoadingDot"></span><span class="priceLoadingDot"></span><span class="priceLoadingDot"></span></span><span class="priceLoadingLabel">Cargando precio…</span></span>';
}

function renderProductBottomHtml(product, qty){
  if(shouldUseIndexAdminView()){
    return `<div class="productAdminNote">Solo visualización en esta página admin</div>`;
  }
  if(!_catalogReady){
    return `<div class="productAdminNote">Espera un momento mientras cargamos el precio actualizado.</div>`;
  }
  return `
        <div class="stepper">
          <button type="button" data-action="dec" data-id="${product.id}" ${qty <= 0 ? "disabled" : ""}>−</button>
          <div class="qty" id="qty_${product.id}">${qty}</div>
          <button type="button" data-action="inc" data-id="${product.id}">+</button>
        </div>`;
}

function updateProductCard(card, product){
  if(!card || !product) return;
  const qty = cart.get(product.id) || 0;
  card.className = `productCard${qty > 0 ? " is-selected" : ""}`;
  card.dataset.productId = product.id;

  const img = card.querySelector(".productImg");
  if(img){
    const nextSrc = String(product.img || "");
    if(img.getAttribute("src") !== nextSrc) img.setAttribute("src", nextSrc);
    const nextAlt = String(product.alt || product.name || "");
    if(img.getAttribute("alt") !== nextAlt) img.setAttribute("alt", nextAlt);
  }

  const nameEl = card.querySelector(".productTop .name");
  if(nameEl && nameEl.textContent !== String(product.name || "")) nameEl.textContent = String(product.name || "");

  const descEl = card.querySelector(".productDesc");
  if(descEl && descEl.textContent !== String(product.desc || "")) descEl.textContent = String(product.desc || "");

  const priceEl = card.querySelector(".price");
  if(priceEl){
    const nextPriceHtml = renderProductPriceHtml(product);
    const nextClass = `price${_catalogReady ? '' : ' muted priceLoading'}`;
    if(priceEl.className !== nextClass) priceEl.className = nextClass;
    if(priceEl.innerHTML != nextPriceHtml) priceEl.innerHTML = nextPriceHtml;
  }

  const bottomEl = card.querySelector(".productBottom");
  if(bottomEl){
    const nextBottomHtml = renderProductBottomHtml(product, qty);
    if(bottomEl.innerHTML != nextBottomHtml) bottomEl.innerHTML = nextBottomHtml;
  }

  const qtyEl = card.querySelector(`#qty_${product.id}`);
  if(qtyEl) qtyEl.textContent = String(qty);

  const decBtn = card.querySelector('button[data-action="dec"]');
  if(decBtn) decBtn.disabled = qty <= 0;
}

function createProductCard(p) {
  const qty = cart.get(p.id) || 0;
  const div = document.createElement("div");
  div.className = `productCard${qty > 0 ? " is-selected" : ""}`;
  div.dataset.productId = p.id;

  div.innerHTML = `
    <div class="productMediaWrap">
      <img class="productImg" src="${p.img}" alt="${p.alt || p.name}" width="1200" height="675" loading="eager" decoding="async" fetchpriority="high" draggable="false" />
    </div>

    <div class="productInfo">
      <div class="productTop">
        <div class="productEyebrow">Postre artesanal</div>
        <div class="name">${p.name}</div>
        <div class="productMetaRow">
          <div class="price${_catalogReady ? '' : ' muted priceLoading'}">${renderProductPriceHtml(p)}</div>
          <span class="sizeBadge">6 oz</span>
        </div>
      </div>

      <div class="productDesc">${p.desc || ""}</div>

      <div class="productBottom">${renderProductBottomHtml(p, qty)}</div>
    </div>
  `;

  return div;
}

function refreshProductCard(id) {
  const card = elProducts.querySelector(`[data-product-id="${id}"]`);
  if (!card) return;
  const qty = cart.get(id) || 0;
  card.classList.toggle("is-selected", qty > 0);

  const qtyEl = card.querySelector(`#qty_${id}`);
  if (qtyEl) qtyEl.textContent = String(qty);

  const decBtn = card.querySelector('button[data-action="dec"]');
  if (decBtn) decBtn.disabled = qty <= 0;
}

function onProductsClick(e) {
  if (shouldUseIndexAdminView() || !_catalogReady || _catalogLoading) return;
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;

  const id = btn.dataset.id;
  const action = btn.dataset.action;
  const current = cart.get(id) || 0;
  const next = action === "inc" ? current + 1 : Math.max(0, current - 1);

  cart.set(id, next);
  refreshProductCard(id);
  updateSummary();
}

function renderProducts(forceRebuild = false) {
  ensureCatalogLoadingInlineStyles();

  const targetIds = PRODUCTS.map(p => p.id);
  const cards = Array.from(elProducts.querySelectorAll("[data-product-id]"));
  const currentIds = cards.map(card => card.dataset.productId);
  const sameStructure = !forceRebuild && cards.length === targetIds.length && currentIds.every((id, idx) => id === targetIds[idx]);

  if(!sameStructure){
    elProducts.innerHTML = "";
    const frag = document.createDocumentFragment();
    for (const p of PRODUCTS) {
      frag.appendChild(createProductCard(p));
    }
    elProducts.appendChild(frag);
  }else{
    PRODUCTS.forEach((product, idx) => {
      updateProductCard(cards[idx], product);
    });
  }

  if (!elProducts.dataset.bound) {
    elProducts.addEventListener("click", onProductsClick);
    elProducts.dataset.bound = "1";
  }
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
    elCartSummary.innerHTML = `
      <div class="cartEmptyState">
        <strong>Tu pedido está vacío.</strong>
        <span>Selecciona tus postres favoritos para comenzar.</span>
      </div>
    `;
  } else {
    elCartSummary.innerHTML = items
      .map(it => `
        <div class="cartLine">
          <span class="cartLineName">${escapeHtml(it.name)}</span>
          <span class="cartLineMeta">x${it.qty}</span>
        </div>
      `)
      .join("");
  }
}

// =================== FORM DATA + VALIDATION ===================
function getFormData() {
  const customer_name = document.getElementById("name").value.trim();
  const phone = document.getElementById("phone").value.trim();
  const location_method = getSelectedLocationMethod(); // "maps" | "whatsapp" | "pickup"
  const address_text = location_method === "pickup"
    ? PICKUP_ADDRESS_TEXT
    : location_method === "whatsapp"
      ? WHATSAPP_LOCATION_TEXT
      : document.getElementById("address").value.trim();
  const maps_link = location_method === "pickup"
    ? PICKUP_MAPS_TEXT
    : location_method === "whatsapp"
      ? WHATSAPP_LOCATION_MAPS_TEXT
      : document.getElementById("maps").value.trim();
  const notes = document.getElementById("notes").value.trim();

  const emailEl = document.getElementById("email");
  const email = emailEl ? emailEl.value.trim() : "";

  const waOptEl = document.getElementById("waOptIn");
  const wa_opt_in = waOptEl ? waOptEl.checked : false;

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
  if (!isValidEmail(data.email)) return "El correo no parece válido. Revisa el formato (ej: correo@dominio.com).";

  if (data.location_method === "maps" && !data.address_text) return "Escribe tu dirección.";

  if (data.location_method === "maps") {
    if (!data.maps_link) return "Pega el link de Google Maps o selecciona “Enviar ubicación desde WhatsApp”.";
    if (!isValidMapsLink(data.maps_link)) return "El link de Google Maps no parece válido. Usa Compartir → Copiar enlace, o selecciona “Enviar ubicación desde WhatsApp”.";
  }

  return null;
}

// =================== WHATSAPP MESSAGE ===================
function buildWhatsAppMessage(data, orderId) {
  const lines = [];
  const pickupVideoUrl = getPickupVideoUrl();

  lines.push(`Hola, mi nombre es ${data.customer_name} y mi número es ${data.phone}.`);
  lines.push("");
  lines.push(`Quiero hacer un pedido (Código: ${orderId}):`);

  for (const it of data.items) {
    lines.push(`- ${it.name}: ${it.qty}`);
  }

  lines.push("");
  lines.push(`Subtotal: $${money(data.subtotal)}`);

  if (data.location_method === "pickup") {
    lines.push(`Entrega: Recogida presencial.`);
    lines.push("");
    lines.push(`Recogida: ${PICKUP_ADDRESS_TEXT}.`);
    if (pickupVideoUrl) {
      lines.push(`Guía de recogida presencial: ${pickupVideoUrl}`);
    }
  } else if (data.location_method === "maps") {
    lines.push(`Domicilio: lo cubre el cliente. (Se debe confirmar mediante WhatsApp)`);
    lines.push("");
    lines.push(`Dirección: ${data.address_text}`);
    lines.push(`Ubicación (Google Maps): ${data.maps_link}`);
  } else {
    lines.push(`Domicilio: lo cubre el cliente. (Se debe confirmar mediante WhatsApp)`);
    lines.push("");
    lines.push(`Ubicación: Te la envío por WhatsApp cuando se abra el chat.`);
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
  syncIndexAdminMobileBar();
}

function hideModal() {
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  syncIndexAdminMobileBar();
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
  if(addressInput){
    addressInput.disabled = false;
    addressInput.placeholder = "Ej: Calle 10 # 5-20, Apto 301";
    delete addressInput.dataset.prevManualValue;
  }
  if(mapsInput){
    delete mapsInput.dataset.prevValue;
  }
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

  // ✅ deja que el navegador pinte el loader
  await nextFrame();

  try {
    elStatus.textContent = "Registrando pedido...";

    // 1) Guardar primero
    await saveOrder(pending.data);
    await completeLoadingSuccess();

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
      openWhatsAppMobile(pending.messageNormal); // iPhone/mobile: intenta abrir la app directo y hace fallback a wa.me
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

  if(!_catalogReady || _catalogLoading){
    showAlert("Estamos cargando el catálogo actualizado. Espera un momento e inténtalo de nuevo.");
    return;
  }

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
setCatalogLoadingState(true);
warmProductImages();
renderProducts(true);
updateSummary();
syncLocationUI();
bootProductsCatalog().catch(()=>{});


function setLoadingProgress(value){
  _loadingProgress = Math.max(0, Math.min(100, Math.round(value || 0)));
  if(loadingPercent) loadingPercent.textContent = `${_loadingProgress}%`;
  if(loadingBar) loadingBar.style.width = `${_loadingProgress}%`;

  if(loadingStep){
    if(_loadingProgress < 20) loadingStep.textContent = "Iniciando pedido";
    else if(_loadingProgress < 45) loadingStep.textContent = "Conectando con AMARED";
    else if(_loadingProgress < 70) loadingStep.textContent = "Validando información";
    else if(_loadingProgress < 100) loadingStep.textContent = "Preparando confirmación";
    else loadingStep.textContent = "Pedido registrado";
  }
}

function startLoadingProgressLoop(){
  clearInterval(_loadingTimer);
  _loadingTimer = setInterval(() => {
    const limit = 84;
    if(_loadingProgress >= limit) return;
    const step = _loadingProgress < 18 ? 4 : _loadingProgress < 42 ? 3 : _loadingProgress < 68 ? 2 : 1;
    setLoadingProgress(Math.min(limit, _loadingProgress + step));
  }, 170);
}

function animateLoadingTo(target, duration = 420){
  target = Math.max(0, Math.min(100, Math.round(target || 0)));
  const start = _loadingProgress;
  const delta = target - start;
  if(delta === 0) return Promise.resolve();

  return new Promise(resolve => {
    const startTs = performance.now();
    function tick(now){
      const p = Math.min(1, (now - startTs) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setLoadingProgress(start + delta * eased);
      if(p < 1){
        requestAnimationFrame(tick);
      }else{
        setLoadingProgress(target);
        resolve();
      }
    }
    requestAnimationFrame(tick);
  });
}

function showLoading(text="Procesando...", sub=""){
  try{
    _loadingStartTs = Date.now();
    clearInterval(_loadingTimer);
    const t = String(text || "Procesando...");
    let finalSub = String(sub || "").trim();
    if(!finalSub){
      finalSub = t.toLowerCase().includes("registrando")
        ? "Estamos conectando tu pedido con AMARED y preparando la confirmación por WhatsApp."
        : "Un momento, ya casi terminamos.";
    }
    if(loadingText) loadingText.textContent = t;
    if(loadingSub) loadingSub.textContent = finalSub;
    setLoadingProgress(0);
    if(loadingOverlay){
      loadingOverlay.classList.remove("hidden");
      loadingOverlay.setAttribute("aria-hidden","false");
      loadingOverlay.style.zIndex = "31000";
      loadingOverlay.style.display = "flex";
    }
    document.body.classList.add("is-loading");
    syncIndexAdminMobileBar();
    startLoadingProgressLoop();
  }catch(_e){}
}

async function completeLoadingSuccess(){
  try{
    clearInterval(_loadingTimer);
    if(loadingText) loadingText.textContent = "Pedido registrado";
    if(loadingSub) loadingSub.textContent = "Ahora abriremos WhatsApp para confirmar el pago y los detalles finales.";
    await animateLoadingTo(100, 520);
    await new Promise(resolve => setTimeout(resolve, 260));
  }catch(_e){}
}

function hideLoading(){
  try{
    clearInterval(_loadingTimer);
    const elapsed = _loadingStartTs ? (Date.now() - _loadingStartTs) : 9999;
    const doHide = () => {
      if(loadingOverlay){
        loadingOverlay.classList.add("hidden");
        loadingOverlay.setAttribute("aria-hidden","true");
        loadingOverlay.style.display = "none";
      }
      document.body.classList.remove("is-loading");
      syncIndexAdminMobileBar();
    };
    if(elapsed < 700){
      setTimeout(doHide, 700 - elapsed);
    }else{
      doHide();
    }
  }catch(_e){}
}

function nextFrame(){
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
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
const reviewsInlineLoading = document.getElementById("reviewsInlineLoading");
const btnMoreReviews = document.getElementById("btnMoreReviews");
const btnAdminReviews = document.getElementById("btnAdminReviews");
const reviewsAvgEl = document.getElementById("reviewsAvg");
const reviewsCountEl = document.getElementById("reviewsCount");
const reviewsAvgStarsEl = document.getElementById("reviewsAvgStars");
const btnOpenReviewModal = document.getElementById("btnOpenReviewModal");
const opinionesSection = document.getElementById("opiniones");
const btnOpinionesTop = document.getElementById("btnOpinionesTop");
const indexAdminSection = document.getElementById("indexAdminSection");
const indexAdminPriceList = document.getElementById("indexAdminPriceList");
const btnIndexAdminSavePrices = document.getElementById("btnIndexAdminSavePrices");
const btnIndexAdminResetPrices = document.getElementById("btnIndexAdminResetPrices");
const btnIndexAdminGoOpiniones = document.getElementById("btnIndexAdminGoOpiniones");
const indexAdminStatus = document.getElementById("indexAdminStatus");
const indexAdminMobileBar = document.getElementById("indexAdminMobileBar");
const btnIndexAdminBarHub = document.getElementById("btnIndexAdminBarHub");
const btnIndexAdminBarOpiniones = document.getElementById("btnIndexAdminBarOpiniones");
const btnIndexAdminBarTools = document.getElementById("btnIndexAdminBarTools");
const btnIndexAdminDesktopHub = document.getElementById("btnIndexAdminDesktopHub");
const orderSection = document.getElementById("pedido");

const reviewModal = document.getElementById("reviewModal");
const btnCloseReview = document.getElementById("btnCloseReview");
const btnSubmitReview = document.getElementById("btnSubmitReview");
const reviewLast4 = document.getElementById("reviewLast4");
const reviewName = document.getElementById("reviewName");
const reviewComment = document.getElementById("reviewComment");
const reviewCharCount = document.getElementById("reviewCharCount");
const reviewStarsRow = document.getElementById("reviewStars");

let _reviewRating = 0;

function setIndexAdminStatus(msg, isError=false){
  if(!indexAdminStatus) return;
  indexAdminStatus.textContent = String(msg || "");
  indexAdminStatus.style.color = isError ? "#b00020" : "rgba(64,17,2,.72)";
}

function renderIndexAdminPriceEditor(){
  if(!indexAdminPriceList) return;
  indexAdminPriceList.innerHTML = PRODUCTS.map(product => `
    <div class="indexAdminPriceRow">
      <div>
        <div class="indexAdminPriceName">${escapeHtml(product.name)}</div>
        <div class="indexAdminPriceHint">Precio visible actualmente: $${money(product.price)}</div>
      </div>
      <label class="indexAdminField">
        <input class="input" type="number" min="0" step="100" data-price-id="${escapeHtml(product.id)}" value="${Number(product.price || 0)}" />
      </label>
    </div>
  `).join("");
}

function applyIndexAdminVisibility(){
  const enabled = shouldUseIndexAdminView();
  document.body.classList.toggle("is-index-admin-view", enabled);
  if(indexAdminSection) indexAdminSection.classList.toggle("hidden", !enabled);
  if(btnAdminReviews) btnAdminReviews.classList.add("hidden");
  if(orderSection) orderSection.classList.toggle("hidden", enabled);
  if(btnIndexAdminDesktopHub){
    const hasHub = hasHubSession() || /(^|\/)hub\.html(?:\?|$)/i.test(String(document.referrer || ""));
    btnIndexAdminDesktopHub.classList.toggle("hidden", !(enabled && hasHub));
    btnIndexAdminDesktopHub.classList.toggle("isVisible", !!(enabled && hasHub));
  }
  let shouldRefreshReviews = false;
  if(enabled){
    renderIndexAdminPriceEditor();
    renderProducts();
    updateSummary();
  }
  if(enabled && HUB_INDEX_ADMIN_SESSION?.password){
    if(!_isAdminReviews) shouldRefreshReviews = true;
    _isAdminReviews = true;
    if(adminReviewsErr) adminReviewsErr.textContent = "Modo administrador habilitado desde el Hub.";
  }
  syncIndexAdminMobileBar();
  if(shouldRefreshReviews) fetchReviews();
}
function syncIndexAdminMobileBar(){
  if(!indexAdminMobileBar) return;
  const enabled = shouldUseIndexAdminView();
  const mobile = window.matchMedia("(max-width: 720px)").matches;
  const blocked = !enabled || !mobile || document.body.classList.contains("is-loading") || !alertOverlay?.classList.contains("hidden") || !modal?.classList.contains("hidden") || !reviewModal?.classList.contains("hidden") || !adminReviewsModal?.classList.contains("hidden");
  indexAdminMobileBar.classList.toggle("hidden", blocked);
  indexAdminMobileBar.classList.toggle("isVisible", !blocked);
  if(btnIndexAdminBarHub){
    const hasHub = hasHubSession() || /(^|\/)hub\.html(?:\?|$)/i.test(String(document.referrer || ""));
    const ico = btnIndexAdminBarHub.querySelector(".ico");
    if(ico) ico.textContent = hasHub ? "⌂" : "↑";
    btnIndexAdminBarHub.setAttribute("aria-label", hasHub ? "Volver al panel" : "Volver arriba");
  }
  btnIndexAdminBarOpiniones?.setAttribute("aria-label", "Ir a opiniones");
  btnIndexAdminBarTools?.setAttribute("aria-label", "Ir a precios");
}

async function saveIndexAdminPrices(){
  if(!indexAdminPriceList) return;
  const inputs = Array.from(indexAdminPriceList.querySelectorAll("[data-price-id]"));
  const nextMap = {};
  const items = [];
  for(const input of inputs){
    const id = String(input.getAttribute("data-price-id") || "").trim();
    const value = Number(input.value || 0);
    if(!id || !Number.isFinite(value) || value <= 0){
      setIndexAdminStatus("Revisa los precios antes de guardar. Todos deben ser mayores a 0.", true);
      input.focus();
      return;
    }
    nextMap[id] = Math.round(value);
    const product = PRODUCTS.find(p => p.id === id) || DEFAULT_PRODUCTS.find(p => p.id === id) || {};
    items.push({ dessert_id: id, dessert_name: String(product.name || "").trim(), public_price: Math.round(value) });
  }

  const payload = buildIndexCatalogAuthPayload({ action: "products_catalog_save", items });
  if(!payload){
    setIndexAdminStatus("Se necesita el PIN de administrador para guardar los precios globales.", true);
    return;
  }

  showLoading("Guardando precios...", "Actualizando el catálogo visible para todos los clientes.");
  try{
    const res = await fetch(ORDER_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const out = await res.json();
    hideLoading();
    if(!out?.ok){
      setIndexAdminStatus(out?.error || "No se pudieron guardar los precios.", true);
      return;
    }
    saveProductPriceOverrides(nextMap);
    applyProductPriceMap(nextMap);
    renderProducts();
    updateSummary();
    renderIndexAdminPriceEditor();
    setIndexAdminStatus("Precios globales actualizados correctamente.");
    window.dispatchEvent(new CustomEvent("amared:catalog-updated", { detail: { source: "index" } }));
  }catch(e){
    hideLoading();
    setIndexAdminStatus(String(e?.message || e || "No se pudieron guardar los precios."), true);
  }
}

async function resetIndexAdminPrices(){
  const defaults = {};
  const items = DEFAULT_PRODUCTS.map(product => {
    const price = Math.round(Number(product.price || 0));
    defaults[product.id] = price;
    return { dessert_id: product.id, dessert_name: String(product.name || "").trim(), public_price: price };
  });

  const payload = buildIndexCatalogAuthPayload({ action: "products_catalog_save", items });
  if(!payload){
    setIndexAdminStatus("Se necesita el PIN de administrador para restablecer los precios globales.", true);
    return;
  }

  showLoading("Restableciendo precios...", "Volviendo a los precios base del catálogo.");
  try{
    const res = await fetch(ORDER_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const out = await res.json();
    hideLoading();
    if(!out?.ok){
      setIndexAdminStatus(out?.error || "No se pudieron restablecer los precios.", true);
      return;
    }
    saveProductPriceOverrides(defaults);
    applyProductPriceMap(defaults);
    renderProducts();
    updateSummary();
    renderIndexAdminPriceEditor();
    setIndexAdminStatus("Se restablecieron los precios globales.");
    window.dispatchEvent(new CustomEvent("amared:catalog-updated", { detail: { source: "index" } }));
  }catch(e){
    hideLoading();
    setIndexAdminStatus(String(e?.message || e || "No se pudieron restablecer los precios."), true);
  }
}

function showReviewModal(){
  if(!reviewModal) return;
  reviewModal.classList.remove("hidden");
  reviewModal.setAttribute("aria-hidden","false");
  syncIndexAdminMobileBar();
}

function hideReviewModal(){
  if(!reviewModal) return;
  reviewModal.classList.add("hidden");
  reviewModal.setAttribute("aria-hidden","true");
  syncIndexAdminMobileBar();
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

  // Ver más (carga 3 más por clic)
  if(btnMoreReviews){
    const canMore = (count > _reviewsLimit);
    btnMoreReviews.classList.toggle("hidden", !canMore);
    btnMoreReviews.textContent = "Ver más";
  }
if(!reviewsListEl) return;
  if(!list.length){
    reviewsListEl.innerHTML = '<div class="muted small">Aún no hay opiniones publicadas.</div>';
    return;
  }

    const renderReviewCard = (r) => {
    const nm = escapeHtml(r.name || "Cliente");
    const txt = escapeHtml(r.comment || "");
    const dt = timeAgo(r.created_at || "");
    const st = starsText(r.rating || 0);

    const reply = r.reply ? escapeHtml(r.reply) : "";
    const replyBlock = reply ? `
      <div class="reviewReply">
        <div class="reviewReplyTitle">AMARED respondió</div>
        <div class="reviewText">${reply}</div>
      </div>
    ` : "";

    const adminControls = (_isAdminReviews) ? `
      <div class="reviewAdminRow">
        <input class="input" data-reply-for="${escapeHtml(r.order_id || "")}" placeholder="Responder..." maxlength="300"/>
        <button class="btn secondary" data-reply-btn="${escapeHtml(r.order_id || "")}" type="button">Responder</button>
      </div>
    ` : "";

    return `
      <div class="reviewCard">
        <div class="reviewCardTop">
          <div class="reviewName">${nm}</div>
          <div class="reviewStars" aria-hidden="true">${st}</div>
        </div>
        <div class="muted small reviewMeta">${dt}</div>
        <div class="reviewText">${txt}</div>
        ${replyBlock}
        ${adminControls}
      </div>
    `;
  };

  if(_reviewsAppendMode && _reviewsRenderedCount > 0 && list.length >= _reviewsRenderedCount){
    const extra = list.slice(_reviewsRenderedCount);
    if(extra.length){
      reviewsListEl.insertAdjacentHTML("beforeend", extra.map(renderReviewCard).join(""));
    }
  }else{
    reviewsListEl.innerHTML = list.map(renderReviewCard).join("");
  }

  _reviewsRenderedCount = list.length;

  // bind reply buttons
  if(_isAdminReviews){
    reviewsListEl.querySelectorAll("[data-reply-btn]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const orderId = btn.getAttribute("data-reply-btn");
        const input = reviewsListEl.querySelector(`[data-reply-for="${CSS.escape(orderId)}"]`);
        const replyText = input ? input.value.trim() : "";
        const pin = (adminPinReviews && adminPinReviews.value) ? adminPinReviews.value.trim() : "";
        if(!replyText) return showAlert("Escribe una respuesta.");
        const payload = { action:"reviews_reply", order_id: orderId, reply: replyText };
        if(HUB_INDEX_ADMIN_SESSION?.id && HUB_INDEX_ADMIN_SESSION?.password){
          payload.auth_profile_id = String(HUB_INDEX_ADMIN_SESSION.id || "").trim();
          payload.auth_profile_password = String(HUB_INDEX_ADMIN_SESSION.password || "").trim();
          payload.auth_page = "index";
        }else{
          if(!pin) return showAlert("Ingresa el PIN en Modo admin.");
          payload.admin_pin = pin;
        }
        showLoading("Enviando respuesta...");
        try{
          const res = await fetch(ORDER_API_URL, {
            method:"POST",
            headers:{ "Content-Type":"application/json" },
            body: JSON.stringify(payload)
          });
          const out = await res.json();
          hideLoading();
          if(!out?.ok) return showAlert(out?.error || "No se pudo responder.");
          if(input) input.value = "";
          await fetchReviews({ append: true });
          showAlert("Respuesta publicada ✅");
        }catch(e){
          hideLoading();
          showAlert(String(e));
        }
      });
    });
  }

  updateOpinionesTopVisibility();
}

async function fetchReviews(opts = {}) {
  const limit = _reviewsLimit;
  const append = !!opts.append;

  const attempt = async () => {
    const res = await fetch(ORDER_API_URL, {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ action: "reviews_list", limit })
    });
    let out = null;
    try { out = await res.json(); } catch (_e) { out = null; }
    return { res, out };
  };

  try{
    _reviewsAppendMode = append;

    // mini loader solo en Opiniones
    if(reviewsInlineLoading) reviewsInlineLoading.classList.remove("hidden");

    // Solo limpiamos en carga inicial (no en "ver más")
    if(!append){
      if(reviewsListEl) reviewsListEl.innerHTML = "";
      _reviewsRenderedCount = 0;
    }

    // Deshabilitar botón mientras carga
    if(btnMoreReviews) btnMoreReviews.disabled = true;

    let { res, out } = await attempt();

    // retry corto por si fue un fallo temporal / cold start
    if(!out){
      await new Promise(r => setTimeout(r, 700));
      const r2 = await attempt();
      res = r2.res; out = r2.out;
    }

    if(out?.ok){
      renderReviews(out);
    }else{
      const msg = out?.error ? `No se pudieron cargar las opiniones. (${out.error})` : "No se pudieron cargar las opiniones.";
      // En "ver más", mantenemos las ya cargadas y solo mostramos aviso
      if(append){
        showAlert(msg);
      }else{
        if(reviewsListEl) reviewsListEl.innerHTML = `<div class="muted small">${escapeHtml(msg)}</div>`;
      }
    }
  }catch(e){
    const msg = `No se pudieron cargar las opiniones. (${String(e)})`;
    if(append){
      showAlert(msg);
    }else{
      if(reviewsListEl) reviewsListEl.innerHTML = `<div class="muted small">${escapeHtml(msg)}</div>`;
    }
  }finally{
    if(reviewsInlineLoading) reviewsInlineLoading.classList.add("hidden");
    if(btnMoreReviews) btnMoreReviews.disabled = false;
    _reviewsAppendMode = false;
    updateOpinionesTopVisibility();
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
  await nextFrame();
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
    showAlert("✅ Opinión publicada con éxito. ¡Gracias por compartir tu experiencia!");
    await fetchReviews();
  }catch(e){
    hideLoading();
    if(btnSubmitReview) btnSubmitReview.disabled = false;
    showAlert("Error enviando la opinión. Intenta de nuevo.");
  }
}

btnSubmitReview?.addEventListener("click", submitReview);

// cargar opiniones al iniciar (se hace después de inicializar límites)



// Admin (opiniones)
const adminReviewsModal = document.getElementById("adminReviewsModal");
const btnCloseAdminReviewsModal = document.getElementById("btnCloseAdminReviewsModal");
const btnAdminLoginReviews = document.getElementById("btnAdminLoginReviews");
const adminPinReviews = document.getElementById("adminPinReviews");
const adminReviewsErr = document.getElementById("adminReviewsErr");
let _isAdminReviews = false;

function showAdminButtonIfNeeded(){
  if(btnAdminReviews) btnAdminReviews.classList.add("hidden");
}
function showModalEl(el){ if(!el) return; el.classList.remove("hidden"); el.setAttribute("aria-hidden","false"); syncIndexAdminMobileBar(); }
function hideModalEl(el){ if(!el) return; el.classList.add("hidden"); el.setAttribute("aria-hidden","true"); syncIndexAdminMobileBar(); }


function timeAgo(dateStr){
  const t = Date.parse(dateStr || "");
  if(!t) return String(dateStr || "");
  const sec = Math.floor((Date.now() - t) / 1000);
  if(sec < 0) return "Hace un momento";
  if(sec < 60) return "Hace un momento";
  const min = Math.floor(sec/60);
  if(min < 60) return `Hace ${min} minuto${min===1?"":"s"}`;
  const hr = Math.floor(min/60);
  if(hr < 24) return `Hace ${hr} hora${hr===1?"":"s"}`;
  const day = Math.floor(hr/24);
  if(day < 30) return `Hace ${day} día${day===1?"":"s"}`;
  const mo = Math.floor(day/30);
  if(mo < 12) return `Hace ${mo} mes${mo===1?"":"es"}`;
  const yr = Math.floor(day/365);
  return `Hace ${yr} año${yr===1?"":"s"}`;
}

let _reviewsLimit = 3;
let _reviewsMoreClicks = 0;
let _reviewsRenderedCount = 0;
let _reviewsAppendMode = false;
btnMoreReviews?.addEventListener("click", async () => {
  _reviewsLimit += 3;
  _reviewsMoreClicks += 1;
  // ✅ No borra lo ya cargado; agrega solo las nuevas
  await fetchReviews({ append: true });
  updateOpinionesTopVisibility();
});

// ✅ Cargar las 3 últimas opiniones al abrir la página
if(reviewsListEl) fetchReviews();

showAdminButtonIfNeeded();
applyIndexAdminVisibility();
syncIndexAdminMobileBar();

btnIndexAdminSavePrices?.addEventListener("click", saveIndexAdminPrices);
btnIndexAdminResetPrices?.addEventListener("click", resetIndexAdminPrices);
btnIndexAdminGoOpiniones?.addEventListener("click", ()=>{ opinionesSection?.scrollIntoView?.({ behavior:"smooth", block:"start" }); });
btnIndexAdminBarHub?.addEventListener("click", ()=>{
  const hasHub = hasHubSession() || /(^|\/)hub\.html(?:\?|$)/i.test(String(document.referrer || ""));
  if(hasHub) goHubFromIndexAdmin();
  else window.scrollTo({ top: 0, behavior: "smooth" });
});
btnIndexAdminDesktopHub?.addEventListener("click", ()=> goHubFromIndexAdmin());
btnIndexAdminBarOpiniones?.addEventListener("click", ()=>{ opinionesSection?.scrollIntoView?.({ behavior:"smooth", block:"start" }); });
btnIndexAdminBarTools?.addEventListener("click", ()=>{ indexAdminSection?.scrollIntoView?.({ behavior:"smooth", block:"start" }); });
window.addEventListener("resize", syncIndexAdminMobileBar);

btnAdminReviews?.addEventListener("click", () => {
  const enabled = shouldUseIndexAdminView();
  if(!enabled) return;
  if(_isAdminReviews){
    opinionesSection?.scrollIntoView?.({ behavior:"smooth", block:"start" });
    return;
  }
  if(adminReviewsErr) adminReviewsErr.textContent = "";
  showModalEl(adminReviewsModal);
});
btnCloseAdminReviewsModal?.addEventListener("click", ()=> hideModalEl(adminReviewsModal));
adminReviewsModal?.addEventListener("click", (e)=>{ if(e.target===adminReviewsModal) hideModalEl(adminReviewsModal); });

if(HUB_INDEX_ADMIN_SESSION?.password){
  _isAdminReviews = true;
  if(adminReviewsErr) adminReviewsErr.textContent = "Modo administrador habilitado desde el Hub.";
  fetchReviews().catch(()=>{});
}

btnAdminLoginReviews?.addEventListener("click", async ()=> {
  if(adminReviewsErr) adminReviewsErr.textContent = "";
  const pin = (adminPinReviews?.value || "").trim();
  if(!pin){
    if(adminReviewsErr) adminReviewsErr.textContent = "Ingresa el PIN.";
    return;
  }
  showLoading("Validando...");
  try{
    const res = await fetch(ORDER_API_URL, {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ action:"validate_admin_pin", admin_pin: pin })
    });
    const out = await res.json();
    hideLoading();
    if(out?.ok && out?.valid){
      _isAdminReviews = true;
      hideModalEl(adminReviewsModal);
      await fetchReviews();
      showAlert("Modo admin activado ✅");
    }else{
      if(adminReviewsErr) adminReviewsErr.textContent = "PIN incorrecto.";
    }
  }catch(e){
    hideLoading();
    if(adminReviewsErr) adminReviewsErr.textContent = String(e);
  }
});

let _opinionesInView = false;

function updateOpinionesTopVisibility(){
  if(!btnOpinionesTop) return;
  const atTop = (window.scrollY || 0) < 80;
  const canShow = (_reviewsMoreClicks >= 3) && _opinionesInView && !atTop;
  btnOpinionesTop.classList.toggle("hidden", !canShow);
}

if(opinionesSection && "IntersectionObserver" in window){
  const obs = new IntersectionObserver((entries)=>{
    const e = entries[0];
    _opinionesInView = !!e?.isIntersecting;
    updateOpinionesTopVisibility();
  }, { threshold: 0.15 });
  obs.observe(opinionesSection);
}

window.addEventListener("scroll", updateOpinionesTopVisibility);

btnOpinionesTop?.addEventListener("click", ()=>{
  window.scrollTo({ top: 0, behavior: "smooth" });
});

window.addEventListener("focus", ()=>{ syncProductsCatalogFromBackend(true).catch(()=>{}); });
document.addEventListener("visibilitychange", ()=>{ if(!document.hidden) syncProductsCatalogFromBackend(true).catch(()=>{}); });
window.addEventListener("amared:catalog-updated", ()=>{ syncProductsCatalogFromBackend(true).catch(()=>{}); });
