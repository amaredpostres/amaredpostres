// =================== CONFIG ===================
const SUCCESS_MSG = "Pedido registrado ✅\n\nAhora falta confirmar el pago por WhatsApp.";
const PICKUP_ADDRESS_TEXT = "Recogida presencial";
const PICKUP_RESERVE_PERCENT = 0.4;
const PICKUP_MAPS_TEXT = "RECOGIDA_PRESENCIAL";
const WHATSAPP_LOCATION_TEXT = "Ubicación por WhatsApp";
const WHATSAPP_LOCATION_MAPS_TEXT = "UBICACION_POR_WHATSAPP";
const PICKUP_VIDEO_URL = "https://drive.google.com/file/d/198VXUDfeyfouT7UauXBytVwyqbujxCn9/view?usp=sharing";
const MAPS_TUTORIAL_URL = "";
const WHATSAPP_TUTORIAL_URL = "";

const WHATSAPP_NUMBER = "573028473086";
const ORDER_API_URL = "https://amared-orders.amaredpostres.workers.dev/";
const AMARED_ROUTE_ORIGIN_LABEL = "Edificio Kiwana";
const AMARED_ROUTE_ORIGIN_ADDRESS = "Edificio Kiwana, Cl. 53 #6A-21, Ibagué, Tolima";
const AMARED_ROUTE_UNKNOWN = {
  id: "por_asignar",
  label: "Ruta por asignar",
  short: "Por asignar",
  description: "Se revisa manualmente cuando el barrio escrito no coincide con la base de sectores.",
  score: 50
};
const AMARED_ROUTE_DEFINITIONS = {
  occidente: {
    id: "occidente",
    label: "Ruta 1 · Comunas 1, 2, 3, 4, 10, 11, 12 y 13",
    short: "Ruta 1",
    description: "Zona centro/base y sectores hacia centro, occidente y sur de Ibagué.",
    score: 30
  },
  oriente: {
    id: "oriente",
    label: "Ruta 2 · Comunas 5, 6, 7, 8 y 9",
    short: "Ruta 2",
    description: "Sectores hacia Jordán, Vergel, Mirolindo, Picaleña, Salado y aeropuerto.",
    score: 70
  },
  por_asignar: AMARED_ROUTE_UNKNOWN
};
const AMARED_NEIGHBORHOOD_ROUTES = Array.isArray(window.AMARED_IBAGUE_NEIGHBORHOODS) && window.AMARED_IBAGUE_NEIGHBORHOODS.length
  ? window.AMARED_IBAGUE_NEIGHBORHOODS
  : [
      { name:"Edificio Kiwana", aliases:["kiwana", "edificio kiwana", "calle 53", "cl 53"], route:"occidente", score:1 },
      { name:"Centro", aliases:["centro", "la pola", "belén", "belen", "interlaken"], route:"occidente", score:4 },
      { name:"Jordán", aliases:["jordan", "jordán", "jordan 1", "jordán 1"], route:"oriente", score:5 },
      { name:"Mirolindo", aliases:["mirolindo", "avenida mirolindo"], route:"oriente", score:7 },
      { name:"El Salado", aliases:["salado", "el salado", "aeropuerto", "perales"], route:"oriente", score:10 }
    ];

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

function normalizeRouteText(value){
  return String(value || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[#.,;:()\[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
const ROUTE_SEARCH_STOPWORDS = new Set(["de","del","la","las","el","los","y","en","al","a","por","para","urbanizacion","urb","barrio","sector"]);
function routeSearchTokens(value){
  return normalizeRouteText(value)
    .split(" ")
    .map(x => x.trim())
    .filter(x => x && !ROUTE_SEARCH_STOPWORDS.has(x));
}
function routeCompactText(value){
  return routeSearchTokens(value).join(" ");
}
function routeNeighborhoodMatchScore(name, query, aliases=[]){
  const rawQuery = String(query || "").trim();
  if(!rawQuery) return 1000;
  const qNorm = normalizeRouteText(rawQuery);
  const qCompact = routeCompactText(rawQuery);
  const qTokens = routeSearchTokens(rawQuery);
  if(!qNorm && !qCompact) return 1000;
  let best = Infinity;
  [name].concat(Array.isArray(aliases) ? aliases : []).forEach(candidate => {
    const nNorm = normalizeRouteText(candidate);
    const nCompact = routeCompactText(candidate);
    const nTokens = routeSearchTokens(candidate);
    if(!nNorm && !nCompact) return;
    let score = 999;
    if(qNorm === nNorm || (qCompact && qCompact === nCompact)) score = 0;
    else if(nNorm.startsWith(qNorm) || (qCompact && nCompact.startsWith(qCompact))) score = 5;
    else if(nNorm.includes(qNorm) || qNorm.includes(nNorm) || (qCompact && (nCompact.includes(qCompact) || qCompact.includes(nCompact)))) score = 12;
    else if(qTokens.length){
      const matched = qTokens.filter(t => nTokens.some(nt => nt.includes(t) || t.includes(nt))).length;
      if(matched){
        const coverage = matched / Math.max(1, qTokens.length);
        score = 35 - coverage * 20 + Math.max(0, nTokens.length - matched) * 1.2;
      }
    }
    if(score < best) best = score;
  });
  return best;
}
function inferAmaredRouteInfo(input){
  const text = normalizeRouteText(input);
  if(!text){
    return { ...AMARED_ROUTE_UNKNOWN, neighborhood:"", detected:false, score:AMARED_ROUTE_UNKNOWN.score };
  }
  let best = null;
  AMARED_NEIGHBORHOOD_ROUTES.forEach(item => {
    const score = routeNeighborhoodMatchScore(item.name, input, item.aliases || []);
    if(!Number.isFinite(score) || score > 38) return;
    const weight = 1000 - score + (normalizeRouteText(input) === normalizeRouteText(item.name) ? 100 : 0);
    if(!best || weight > best.weight){
      best = { item, weight };
    }
  });
  if(!best){
    return { ...AMARED_ROUTE_UNKNOWN, neighborhood:"", detected:false, score:AMARED_ROUTE_UNKNOWN.score };
  }
  const def = AMARED_ROUTE_DEFINITIONS[best.item.route] || AMARED_ROUTE_UNKNOWN;
  return {
    ...def,
    neighborhood: best.item.name,
    detected:true,
    score: Number(best.item.score || def.score || 50)
  };
}
function populateNeighborhoodOptions(){
  const dl = document.getElementById("neighborhoodOptions");
  if(!dl || dl.dataset.loaded === "1") return;
  const names = Array.from(new Set(AMARED_NEIGHBORHOOD_ROUTES.map(x => x.name).filter(Boolean))).sort((a,b)=>a.localeCompare(b, "es"));
  dl.innerHTML = names.map(name => `<option value="${escapeHtml(name)}"></option>`).join("");
  dl.dataset.loaded = "1";
}
function getNeighborhoodNames(){
  return Array.from(new Set(AMARED_NEIGHBORHOOD_ROUTES.map(x => String(x.name || "").trim()).filter(Boolean)))
    .sort((a,b)=>a.localeCompare(b, "es"));
}

function setNeighborhoodSuggestOpen(open){
  const box = document.getElementById("neighborhoodSuggest");
  const input = document.getElementById("neighborhood");
  const field = document.getElementById("neighborhoodField");
  const toggle = document.getElementById("neighborhoodToggle");
  if(!box) return;
  box.classList.toggle("hidden", !open);
  field?.classList.toggle("is-open", !!open);
  toggle?.setAttribute("aria-expanded", open ? "true" : "false");
  if(input) input.setAttribute("aria-expanded", open ? "true" : "false");
}

function renderNeighborhoodSuggestions(query = "", showAll = false){
  const box = document.getElementById("neighborhoodSuggest");
  const input = document.getElementById("neighborhood");
  if(!box || !input) return;

  const rawQuery = String(query || "").trim();
  const normalizedQuery = normalizeRouteText(rawQuery);
  const names = getNeighborhoodNames();
  const routeByName = new Map(AMARED_NEIGHBORHOOD_ROUTES.map(item => [String(item.name || "").trim(), item]));
  const filtered = (!normalizedQuery || showAll)
    ? names
    : names
        .map(name => {
          const item = routeByName.get(name) || { name };
          return { name, score: routeNeighborhoodMatchScore(name, rawQuery, item.aliases || []) };
        })
        .filter(item => Number.isFinite(item.score) && item.score <= 38)
        .sort((a,b) => a.score - b.score || a.name.localeCompare(b.name, "es"))
        .map(item => item.name);

  const exactMatch = !!normalizedQuery && names.some(name => normalizeRouteText(name) === normalizedQuery || routeCompactText(name) === routeCompactText(rawQuery));
  const visible = filtered.slice(0, 90);
  const manualOption = rawQuery && !exactMatch
    ? `<button type="button" class="neighborhoodSuggestItem neighborhoodSuggestManual" data-name="${escapeHtml(rawQuery)}" role="option">
        <span>Usar “${escapeHtml(rawQuery)}”</span>
        <small>No aparece en el listado; se revisará para la entrega.</small>
      </button>`
    : "";

  const items = visible.map(name => `
    <button type="button" class="neighborhoodSuggestItem" data-name="${escapeHtml(name)}" role="option">
      <span>${escapeHtml(name)}</span>
    </button>
  `).join("");

  const limitNote = filtered.length > visible.length
    ? `<div class="neighborhoodSuggestNote">Mostrando ${visible.length} de ${filtered.length}. Escribe más letras para filtrar.</div>`
    : "";

  const emptyNote = (!items && !manualOption)
    ? `<div class="neighborhoodSuggestEmpty">No encontramos coincidencias. Puedes escribir tu barrio manualmente.</div>`
    : "";

  box.innerHTML = `${manualOption}${items}${limitNote}${emptyNote}`;
  setNeighborhoodSuggestOpen(true);
}

function hideNeighborhoodSuggestions(){
  setNeighborhoodSuggestOpen(false);
}

function chooseNeighborhoodValue(value){
  const input = document.getElementById("neighborhood");
  if(!input) return;
  input.value = String(value || "").trim();
  hideNeighborhoodSuggestions();
  input.dispatchEvent(new Event("change", { bubbles:true }));
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
const btnMapsTutorial = document.getElementById("btnMapsTutorial");
const btnWaTutorial = document.getElementById("btnWaTutorial");
const btnPickupTutorial = document.getElementById("btnPickupTutorial");
const pickupVideoHint = document.getElementById("pickupVideoHint");
const pickupPreviewTotal = document.getElementById("pickupPreviewTotal");
const pickupPreviewReserve = document.getElementById("pickupPreviewReserve");
const pickupPreviewBalance = document.getElementById("pickupPreviewBalance");
const modalPickupBreakdown = document.getElementById("modalPickupBreakdown");
const modalPickupReserve = document.getElementById("modalPickupReserve");
const modalPickupBalance = document.getElementById("modalPickupBalance");
const addressInput = document.getElementById("address");
const mapsInput = document.getElementById("maps");
const addressLabel = document.getElementById("addressLabel");
const addressHint = document.getElementById("addressHint");
const neighborhoodField = document.getElementById("neighborhoodField");
const neighborhoodInput = document.getElementById("neighborhood");
const neighborhoodHint = document.getElementById("neighborhoodHint");
const neighborhoodSuggest = document.getElementById("neighborhoodSuggest");
const neighborhoodToggle = document.getElementById("neighborhoodToggle");
const waOptHint = document.getElementById("waOptHint");

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

function getPickupPaymentBreakdown(subtotal) {
  const safeSubtotal = Math.max(0, Number(subtotal) || 0);
  const reserve = Math.round(safeSubtotal * PICKUP_RESERVE_PERCENT);
  const remaining = Math.max(0, safeSubtotal - reserve);
  return { subtotal: safeSubtotal, reserve, remaining };
}

function syncPickupPricingUI(subtotal = 0, locationMethod = getSelectedLocationMethod()) {
  const info = getPickupPaymentBreakdown(subtotal);

  if (pickupPreviewTotal) pickupPreviewTotal.textContent = `$${money(info.subtotal)}`;
  if (pickupPreviewReserve) pickupPreviewReserve.textContent = `$${money(info.reserve)}`;
  if (pickupPreviewBalance) pickupPreviewBalance.textContent = `$${money(info.remaining)}`;

  const showModalBreakdown = locationMethod === "pickup" && info.subtotal > 0;
  if (modalPickupBreakdown) modalPickupBreakdown.classList.toggle("hidden", !showModalBreakdown);
  if (modalPickupReserve) modalPickupReserve.textContent = `$${money(info.reserve)}`;
  if (modalPickupBalance) modalPickupBalance.textContent = `$${money(info.remaining)}`;
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

function getTutorialUrl(type){
  switch(String(type || "").trim()){
    case "maps": return String(MAPS_TUTORIAL_URL || "").trim();
    case "whatsapp": return String(WHATSAPP_TUTORIAL_URL || "").trim();
    case "pickup": return String(PICKUP_VIDEO_URL || "").trim();
    default: return "";
  }
}

function getPickupVideoUrl(){
  return getTutorialUrl("pickup");
}

function syncTutorialButtonsUI(){
  [
    [btnMapsTutorial, "maps"],
    [btnWaTutorial, "whatsapp"],
    [btnPickupTutorial, "pickup"],
  ].forEach(([btn, type]) => {
    if(!btn) return;
    const hasUrl = !!getTutorialUrl(type);
    btn.dataset.ready = hasUrl ? "1" : "0";
    btn.setAttribute("aria-label", hasUrl ? "Ver tutorial" : "Tutorial próximamente");
    btn.title = hasUrl ? "Ver tutorial" : "Configura la URL del video en app.js";
  });
  if(pickupVideoHint){
    pickupVideoHint.classList.remove("hidden");
  }
}

function openTutorial(type){
  const url = getTutorialUrl(type);
  if(!url){
    showAlert("Aún no hemos configurado el video tutorial de esta opción. Cuando tengas el enlace, solo debes pegarlo en app.js.");
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

function setAddressMode(mode){
  if(!addressInput) return;

  const isMaps = mode === "maps";
  const isWhatsApp = mode === "whatsapp";

  if(typeof addressInput.dataset.prevManualValue === "undefined"){
    addressInput.dataset.prevManualValue = "";
  }

  if(!addressInput.disabled && addressInput.value !== PICKUP_ADDRESS_TEXT){
    addressInput.dataset.prevManualValue = addressInput.value || "";
  }

  if(isMaps || isWhatsApp){
    addressInput.disabled = false;
    addressInput.placeholder = isWhatsApp
      ? "Ej: Calle 53, número 8-2, Ibagué, Tolima"
      : "Ej: Calle 53, número 8-2, Ibagué, Tolima";
    addressInput.value = addressInput.dataset.prevManualValue || "";
    if(addressLabel) addressLabel.innerHTML = 'Dirección <span class="req">*</span>';
    if(addressHint){
      addressHint.textContent = isWhatsApp
        ? 'Escribe una dirección de referencia. En el chat te indicaremos cómo compartir la ubicación por WhatsApp si lo necesitas.'
        : 'Escribe la dirección donde deseas recibir tu pedido.';
      addressHint.classList.toggle("hidden", !isWhatsApp);
    }
    return;
  }

  addressInput.disabled = true;
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
  return el ? el.value : "whatsapp";
}

function syncLocationUI() {
  const method = getSelectedLocationMethod();
  const showMaps = method === "maps";
  const showWhatsApp = method === "whatsapp";
  const showPickup = method === "pickup";

  if (mapsBlock) mapsBlock.style.display = showMaps ? "" : "none";
  if (waLocBlock) waLocBlock.style.display = showWhatsApp ? "" : "none";
  if (pickupBlock) pickupBlock.classList.toggle("hidden", !showPickup);
  if (neighborhoodField) neighborhoodField.classList.toggle("hidden", showPickup);
  if (showPickup) hideNeighborhoodSuggestions();
  if (neighborhoodInput) neighborhoodInput.required = !showPickup;
  if (neighborhoodHint){
    neighborhoodHint.textContent = showPickup
      ? ""
      : "Busca tu barrio en el listado. Si no aparece, puedes escribirlo manualmente para revisar la entrega.";
  }

  if(mapsInput && !showMaps){
    if(mapsInput.value && !mapsInput.dataset.prevValue){
      mapsInput.dataset.prevValue = mapsInput.value;
    }
    mapsInput.value = "";
  }else if(mapsInput && showMaps && !mapsInput.value && mapsInput.dataset.prevValue){
    mapsInput.value = mapsInput.dataset.prevValue;
  }

  if(showPickup){
    const waOptEl = document.getElementById("waOptIn");
    if(waOptEl) waOptEl.checked = true;
  }

  const currentSubtotal = buildCartItems().reduce((a, b) => a + b.qty * b.price, 0);
  syncPickupPricingUI(currentSubtotal, method);

  if(waOptHint){
    waOptHint.classList.toggle("hidden", !showPickup);
  }

  setAddressMode(method);
  syncTutorialButtonsUI();
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
  try{
    window.location.replace(deep);
  }catch(_e){
    window.location.href = deep;
  }
}

function getProjectAssetUrl(relativePath){
  try{
    return new URL(String(relativePath || ""), window.location.href).href;
  }catch(_e){
    return String(relativePath || "");
  }
}

function buildDesktopWhatsAppLoaderHtml(targetUrl){
  const brandLogo = getProjectAssetUrl("assets/Logo-Amared.svg");
  const isoLogo = getProjectAssetUrl("assets/Logo-Isotipo-Amared.svg");
  const safeTarget = JSON.stringify(String(targetUrl || ""));
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>AMARED • Abriendo WhatsApp</title>
  <style>
    :root{
      --choco:#401102;
      --pink:#f25b8f;
      --gold:#f6ba60;
      --shell:#fffaf5;
      --shell2:#fef6ef;
    }
    *{box-sizing:border-box}
    html,body{margin:0;min-height:100%}
    body{
      min-height:100vh;
      font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
      color:var(--choco);
      display:grid;
      place-items:center;
      padding:24px;
      background:
        radial-gradient(1000px 520px at 0% 0%, rgba(242,91,143,.16), transparent 62%),
        radial-gradient(920px 520px at 100% 0%, rgba(246,186,96,.16), transparent 58%),
        linear-gradient(180deg, var(--shell) 0%, var(--shell2) 48%, #fff9f6 100%);
      overflow:hidden;
    }
    .bgfx{
      position:fixed;
      inset:0;
      pointer-events:none;
      background:
        radial-gradient(420px 220px at 18% 18%, rgba(242,91,143,.14), transparent 62%),
        radial-gradient(440px 220px at 82% 12%, rgba(246,186,96,.16), transparent 62%),
        radial-gradient(560px 260px at 50% 100%, rgba(255,255,255,.20), transparent 70%);
    }
    .card{
      position:relative;
      width:min(560px, 94vw);
      border-radius:28px;
      padding:28px 22px 22px;
      border:1px solid rgba(255,255,255,.7);
      background:linear-gradient(180deg, rgba(255,253,252,.96), rgba(255,248,243,.92));
      box-shadow:0 26px 80px rgba(64,17,2,.18);
      display:grid;
      gap:14px;
      justify-items:center;
      overflow:hidden;
    }
    .card::before{
      content:"";
      position:absolute;
      inset:0;
      background:linear-gradient(135deg, rgba(255,255,255,.42), transparent 48%, rgba(246,186,96,.10));
      pointer-events:none;
    }
    .brand{
      position:relative;
      z-index:1;
      height:36px;
      width:auto;
      display:block;
    }
    .visual{
      position:relative;
      z-index:1;
      width:138px;
      height:138px;
      display:grid;
      place-items:center;
    }
    .halo{
      position:absolute;
      inset:6px;
      border-radius:999px;
      background:radial-gradient(circle, rgba(246,186,96,.34) 0%, rgba(242,91,143,.16) 48%, rgba(255,255,255,0) 72%);
      filter:blur(2px);
      animation:pulse 1.7s ease-in-out infinite;
    }
    .logoWrap{
      position:relative;
      width:88px;
      height:88px;
      border-radius:999px;
      background:linear-gradient(180deg, rgba(255,255,255,.98), rgba(251,239,229,.92));
      border:1px solid rgba(64,17,2,.08);
      display:grid;
      place-items:center;
      box-shadow:0 18px 30px rgba(64,17,2,.12);
    }
    .iso{
      width:52px;
      height:52px;
      object-fit:contain;
      display:block;
      animation:float 1.7s ease-in-out infinite;
    }
    .copy{
      position:relative;
      z-index:1;
      text-align:center;
      display:grid;
      gap:6px;
    }
    .kicker{
      font-size:12px;
      text-transform:uppercase;
      letter-spacing:.14em;
      font-weight:950;
      color:rgba(64,17,2,.56);
    }
    .title{
      font-size:26px;
      line-height:1.06;
      font-weight:950;
      color:var(--choco);
    }
    .sub{
      font-size:14px;
      line-height:1.45;
      color:rgba(64,17,2,.74);
      font-weight:750;
      max-width:420px;
    }
    .meta{
      position:relative;
      z-index:1;
      width:100%;
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:12px;
    }
    .step{
      font-size:13px;
      font-weight:900;
      color:rgba(64,17,2,.72);
    }
    .percent{
      font-size:18px;
      font-weight:950;
      color:var(--choco);
    }
    .track{
      position:relative;
      z-index:1;
      width:100%;
      height:12px;
      border-radius:999px;
      background:rgba(64,17,2,.10);
      overflow:hidden;
    }
    .bar{
      display:block;
      width:0%;
      height:100%;
      border-radius:inherit;
      background:linear-gradient(90deg, rgba(242,91,143,.95), rgba(246,186,96,.95));
      box-shadow:0 4px 12px rgba(242,91,143,.25);
      transition:width .18s ease;
    }
    .hint{
      position:relative;
      z-index:1;
      font-size:13px;
      line-height:1.45;
      font-weight:760;
      color:rgba(64,17,2,.62);
      text-align:center;
    }
    @keyframes pulse{
      0%,100%{transform:scale(.96);opacity:.82}
      50%{transform:scale(1.04);opacity:1}
    }
    @keyframes float{
      0%,100%{transform:translateY(0px) scale(1)}
      50%{transform:translateY(-3px) scale(1.03)}
    }
    @media (max-width:560px){
      body{padding:16px}
      .card{padding:22px 18px 18px;border-radius:24px}
      .visual{width:124px;height:124px}
      .title{font-size:22px}
      .sub{font-size:13px}
    }
  </style>
</head>
<body>
  <div class="bgfx" aria-hidden="true"></div>
  <main class="card" role="status" aria-live="polite">
    <img class="brand" src="${brandLogo}" alt="AMARED">
    <div class="visual" aria-hidden="true">
      <div class="halo"></div>
      <div class="logoWrap">
        <img class="iso" src="${isoLogo}" alt="">
      </div>
    </div>
    <div class="copy">
      <div class="kicker">AMARED está preparando tu confirmación</div>
      <div id="waLoaderTitle" class="title">Abriendo WhatsApp...</div>
      <div id="waLoaderSub" class="sub">Tu pedido ya fue registrado. En un momento te llevaremos al chat para confirmar el pago y los detalles finales.</div>
    </div>
    <div class="meta">
      <span id="waLoaderStep" class="step">Preparando pestaña segura</span>
      <strong id="waLoaderPercent" class="percent">0%</strong>
    </div>
    <div class="track" aria-hidden="true"><span id="waLoaderBar" class="bar"></span></div>
    <div class="hint">No cierres esta pestaña. El chat se abrirá automáticamente.</div>
  </main>
  <script>
    (function(){
      const targetUrl = ${safeTarget};
      const percentEl = document.getElementById("waLoaderPercent");
      const stepEl = document.getElementById("waLoaderStep");
      const barEl = document.getElementById("waLoaderBar");
      const titleEl = document.getElementById("waLoaderTitle");
      const subEl = document.getElementById("waLoaderSub");
      let progress = 0;
      let done = false;

      function update(value){
        progress = Math.max(0, Math.min(100, Math.round(value || 0)));
        if(percentEl) percentEl.textContent = progress + "%";
        if(barEl) barEl.style.width = progress + "%";
        if(stepEl){
          if(progress < 25) stepEl.textContent = "Preparando pestaña segura";
          else if(progress < 55) stepEl.textContent = "Conectando con WhatsApp";
          else if(progress < 85) stepEl.textContent = "Cargando chat";
          else if(progress < 100) stepEl.textContent = "Casi listo";
          else stepEl.textContent = "Abriendo chat";
        }
        if(progress >= 100){
          if(titleEl) titleEl.textContent = "WhatsApp listo";
          if(subEl) subEl.textContent = "Estamos abriendo el chat para que confirmes tu pedido con AMARED.";
        }
      }

      function go(){
        if(done) return;
        done = true;
        update(100);
        setTimeout(function(){
          try{
            window.location.replace(targetUrl);
          }catch(_e){
            window.location.href = targetUrl;
          }
        }, 220);
      }

      const timer = setInterval(function(){
        if(progress >= 100){
          clearInterval(timer);
          go();
          return;
        }
        const step = progress < 20 ? 6 : progress < 55 ? 5 : progress < 82 ? 3 : 2;
        update(Math.min(100, progress + step));
      }, 70);

      window.addEventListener("pageshow", function(){
        if(progress < 8) update(8);
      });

      update(4);
    })();
  </script>
</body>
</html>`;
}

function showDesktopWhatsAppLoaderTab(tab, targetUrl){
  if(!tab || tab.closed) return false;
  try{
    tab.document.open();
    tab.document.write(buildDesktopWhatsAppLoaderHtml(targetUrl));
    tab.document.close();
    try{ tab.focus(); }catch(_e){}
    return true;
  }catch(_e){
    return false;
  }
}

function openDesktopWhatsAppLoaderTabAfterMainLoader(targetUrl){
  const html = buildDesktopWhatsAppLoaderHtml(targetUrl);
  try{
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const blobUrl = URL.createObjectURL(blob);
    const newTab = window.open(blobUrl, "_blank", "noopener,noreferrer");
    if(!newTab){
      try{ URL.revokeObjectURL(blobUrl); }catch(_e){}
      return false;
    }
    try{ newTab.opener = null; }catch(_e){}
    try{ newTab.focus(); }catch(_e){}
    setTimeout(() => {
      try{ URL.revokeObjectURL(blobUrl); }catch(_e){}
    }, 60000);
    return true;
  }catch(_e){
    return false;
  }
}

function prepareDesktopWhatsAppTab(){
  try{
    const tab = window.open("about:blank", "_blank");
    if(!tab) return null;
    try{ tab.opener = null; }catch(_e){}
    try{
      tab.document.open();
      tab.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AMARED</title><style>html,body{margin:0;height:100%;background:#fffaf5}</style></head><body aria-hidden="true"></body></html>`);
      tab.document.close();
    }catch(_e){}
    try{ tab.blur(); }catch(_e){}
    try{ window.focus(); }catch(_e){}
    return tab;
  }catch(_e){
    return null;
  }
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

  syncPickupPricingUI(subtotal);
}

// =================== FORM DATA + VALIDATION ===================
function getFormData() {
  const customer_name = document.getElementById("name").value.trim();
  const phone = document.getElementById("phone").value.trim();
  const location_method = getSelectedLocationMethod(); // "maps" | "whatsapp" | "pickup"
  const address_text = location_method === "pickup"
    ? PICKUP_ADDRESS_TEXT
    : document.getElementById("address").value.trim();
  const neighborhood_text = location_method === "pickup"
    ? ""
    : (neighborhoodInput ? neighborhoodInput.value.trim() : "");
  const routeInfo = location_method === "pickup"
    ? { ...AMARED_ROUTE_UNKNOWN, id:"pickup", label:"Recogida presencial", short:"Recoger", neighborhood:"", detected:true, score:0 }
    : inferAmaredRouteInfo(`${neighborhood_text} ${address_text}`);
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
    neighborhood_text,
    route_zone: routeInfo.id || "por_asignar",
    route_label: routeInfo.label || AMARED_ROUTE_UNKNOWN.label,
    route_order_score: Number(routeInfo.score || 50),
    route_detected_neighborhood: routeInfo.neighborhood || "",
    route_detected: !!routeInfo.detected,
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

  if ((data.location_method === "maps" || data.location_method === "whatsapp") && !data.address_text) return "Escribe tu dirección.";
  if ((data.location_method === "maps" || data.location_method === "whatsapp") && !data.neighborhood_text) return "Escribe el barrio o sector de entrega.";

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
  const pickupPayment = getPickupPaymentBreakdown(data.subtotal);

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
    lines.push(`Anticipo de reserva (40%): $${money(pickupPayment.reserve)}`);
    lines.push(`Saldo restante al reclamar el pedido: $${money(pickupPayment.remaining)}`);
    lines.push("");
    lines.push(`Recogida: ${PICKUP_ADDRESS_TEXT}.`);
    if (pickupVideoUrl) {
      lines.push(`Guía de recogida presencial: ${pickupVideoUrl}`);
    }
  } else if (data.location_method === "maps") {
    lines.push(`Domicilio: lo cubre el cliente. (Se debe confirmar mediante WhatsApp)`);
    lines.push("");
    lines.push(`Dirección: ${data.address_text}`);
    if (data.neighborhood_text) lines.push(`Barrio/sector: ${data.neighborhood_text}`);
    lines.push(`Ubicación (Google Maps): ${data.maps_link}`);
  } else {
    lines.push(`Domicilio: lo cubre el cliente. (Se debe confirmar mediante WhatsApp)`);
    lines.push("");
    lines.push(`Dirección de referencia: ${data.address_text}`);
    if (data.neighborhood_text) lines.push(`Barrio/sector: ${data.neighborhood_text}`);
    lines.push(`Ubicación exacta: la compartiré por WhatsApp dentro del chat.`);
  }

  if (data.notes) lines.push(`Nota: ${data.notes}`);

  lines.push("");
  lines.push("✅ Ya registré el pedido desde la web.");
  if (data.location_method === "pickup") {
    lines.push(`Para confirmar la recogida presencial, queda pendiente enviar el anticipo de reserva por $${money(pickupPayment.reserve)} por este chat.`);
    lines.push(`El saldo restante de $${money(pickupPayment.remaining)} se paga al momento de reclamar tu pedido.`);
  } else {
    lines.push("Para iniciar la elaboración, queda pendiente confirmar el pago por este chat.");
  }
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
  syncPickupPricingUI(data.subtotal || 0, data.location_method);

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
  if (neighborhoodInput) neighborhoodInput.value = "";
  document.getElementById("notes").value = "";

  const emailEl = document.getElementById("email");
  if (emailEl) emailEl.value = "";

  const waOpt = document.getElementById("waOptIn");
  if (waOpt) waOpt.checked = true;

  const rWhatsApp = document.querySelector('input[name="locMethod"][value="whatsapp"]');
  if (rWhatsApp) rWhatsApp.checked = true;
  if(addressInput){
    addressInput.disabled = false;
    addressInput.placeholder = "Ej: Calle 53, número 8-2, Ibagué, Tolima";
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
btnMapsTutorial?.addEventListener("click", ()=> openTutorial("maps"));
btnWaTutorial?.addEventListener("click", ()=> openTutorial("whatsapp"));
btnPickupTutorial?.addEventListener("click", ()=> openTutorial("pickup"));

document.querySelectorAll('input[name="locMethod"]').forEach(r => {
  r.addEventListener("change", syncLocationUI);
});

neighborhoodInput?.addEventListener("focus", () => renderNeighborhoodSuggestions(neighborhoodInput.value, true));
neighborhoodInput?.addEventListener("click", () => renderNeighborhoodSuggestions(neighborhoodInput.value, true));
neighborhoodInput?.addEventListener("input", () => renderNeighborhoodSuggestions(neighborhoodInput.value, false));
neighborhoodInput?.addEventListener("keydown", (event) => {
  if(event.key === "Escape"){
    hideNeighborhoodSuggestions();
    return;
  }
  if(event.key === "ArrowDown"){
    event.preventDefault();
    renderNeighborhoodSuggestions(neighborhoodInput.value, !neighborhoodInput.value.trim());
    const first = neighborhoodSuggest?.querySelector(".neighborhoodSuggestItem");
    first?.focus();
  }
});

neighborhoodToggle?.addEventListener("click", (event) => {
  event.preventDefault();
  if(neighborhoodSuggest && !neighborhoodSuggest.classList.contains("hidden")){
    hideNeighborhoodSuggestions();
    return;
  }
  renderNeighborhoodSuggestions(neighborhoodInput?.value || "", true);
  neighborhoodInput?.focus();
});

neighborhoodSuggest?.addEventListener("click", (event) => {
  const item = event.target.closest(".neighborhoodSuggestItem");
  if(!item) return;
  chooseNeighborhoodValue(item.dataset.name || "");
});

neighborhoodSuggest?.addEventListener("keydown", (event) => {
  const items = Array.from(neighborhoodSuggest.querySelectorAll(".neighborhoodSuggestItem"));
  const currentIndex = items.indexOf(document.activeElement);
  if(event.key === "Escape"){
    hideNeighborhoodSuggestions();
    neighborhoodInput?.focus();
  }
  if(event.key === "ArrowDown"){
    event.preventDefault();
    const next = items[Math.min(currentIndex + 1, items.length - 1)] || items[0];
    next?.focus();
  }
  if(event.key === "ArrowUp"){
    event.preventDefault();
    if(currentIndex <= 0){
      neighborhoodInput?.focus();
    }else{
      items[currentIndex - 1]?.focus();
    }
  }
  if(event.key === "Enter" && document.activeElement?.classList?.contains("neighborhoodSuggestItem")){
    event.preventDefault();
    chooseNeighborhoodValue(document.activeElement.dataset.name || "");
  }
});

document.addEventListener("click", (event) => {
  if(!neighborhoodField || neighborhoodField.classList.contains("hidden")) return;
  if(!neighborhoodField.contains(event.target)) hideNeighborhoodSuggestions();
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

  btnSendWhatsApp.disabled = true;
  btnCloseModal.disabled = true;

  showLoading("Registrando pedido...");

  await nextFrame();

  try {
    elStatus.textContent = "Registrando pedido...";

    await saveOrder(pending.data);

    const waUrl = buildWhatsAppUrlWithText(pending.messageNormal);
    enableHelpMessage(pending.messageFallback, false);

    if(isMobile){
      await completeLoadingSuccess();
      hideModal();
      shouldResetAfterAlert = true;
      storeResumeAlert(SUCCESS_MSG, true, pending.messageFallback);
      hideLoading();
      openWhatsAppMobile(pending.messageNormal);
      return;
    }

    hideModal();
    shouldResetAfterAlert = true;
    setAlertHelp(pending.messageFallback, false);

    await completeLoadingSuccess();
    hideLoading();

    try{
      window.location.assign(waUrl);
      return;
    }catch(_e){
      try{
        window.location.href = waUrl;
        return;
      }catch(_e2){}
    }

    enableHelpMessage(pending.messageFallback, true);
    showAlert("Pedido registrado ✅\n\nNo se pudo abrir WhatsApp automáticamente. Copia el mensaje y pégalo en el chat.");
    setAlertHelp(pending.messageFallback, true);
    elStatus.textContent = "";

  } catch (e) {
    hideLoading();
    elStatus.textContent = "";
    showAlert(`Error: ${e.message}`);

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
populateNeighborhoodOptions();
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
const reviewNameStatus = document.getElementById("reviewNameStatus");
const reviewComment = document.getElementById("reviewComment");
const reviewCharCount = document.getElementById("reviewCharCount");
const reviewStarsRow = document.getElementById("reviewStars");

let _reviewRating = 0;
let _reviewLookupTimer = null;
let _reviewLookupSeq = 0;
let _reviewResolvedName = "";
let _reviewResolvedOrderId = "";
let _reviewLookupEligible = false;

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

function setReviewIdentityStatus(text, tone = "muted"){
  if(!reviewNameStatus) return;
  reviewNameStatus.textContent = String(text || "");
  reviewNameStatus.dataset.tone = tone;
}

function resetReviewIdentity(){
  _reviewResolvedName = "";
  _reviewResolvedOrderId = "";
  _reviewLookupEligible = false;
  if(reviewName){
    reviewName.value = "";
    reviewName.dataset.orderId = "";
  }
  setReviewIdentityStatus("Escribe los 4 dígitos y cargaremos el nombre del pedido.", "muted");
}

async function lookupReviewIdentity(last4){
  const seq = ++_reviewLookupSeq;
  _reviewResolvedName = "";
  _reviewResolvedOrderId = "";
  _reviewLookupEligible = false;
  if(reviewName){
    reviewName.value = "";
    reviewName.dataset.orderId = "";
  }
  setReviewIdentityStatus("Cargando nombre...", "loading");

  try{
    const res = await fetch(ORDER_API_URL, {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ action: "reviews_lookup_identity", last4 })
    });
    const out = await res.json();
    if(seq !== _reviewLookupSeq) return;

    if(!out?.ok || !String(out?.customer_name || "").trim()){
      resetReviewIdentity();
      setReviewIdentityStatus(out?.error || "No encontramos un pedido con esos 4 dígitos.", "error");
      return;
    }

    _reviewResolvedName = String(out.customer_name || "").trim();
    _reviewResolvedOrderId = String(out.order_id || "").trim();
    _reviewLookupEligible = !!out.eligible_for_review;
    if(reviewName){
      reviewName.value = _reviewResolvedName;
      reviewName.dataset.orderId = _reviewResolvedOrderId;
    }

    if(_reviewLookupEligible){
      setReviewIdentityStatus(`Nombre cargado para el pedido ${_reviewResolvedOrderId || ""}. Así aparecerá tu opinión.`, "success");
    }else{
      const pay = String(out.payment_status || "").trim();
      const delivery = String(out.delivery_status || "").trim();
      setReviewIdentityStatus(`Encontramos el pedido a nombre de ${_reviewResolvedName}. Estado actual: ${delivery || pay || "pendiente"}.`, "warning");
    }
  }catch(_e){
    if(seq !== _reviewLookupSeq) return;
    resetReviewIdentity();
    setReviewIdentityStatus("No fue posible cargar el nombre en este momento. Intenta de nuevo.", "error");
  }
}

function scheduleReviewIdentityLookup(){
  const raw = String(reviewLast4?.value || "").replace(/\D+/g, "").slice(-4);
  if(reviewLast4 && reviewLast4.value !== raw) reviewLast4.value = raw;
  if(_reviewLookupTimer) clearTimeout(_reviewLookupTimer);
  _reviewLookupSeq += 1;

  if(raw.length !== 4){
    resetReviewIdentity();
    return;
  }

  _reviewLookupTimer = setTimeout(() => {
    lookupReviewIdentity(raw);
  }, 260);
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

reviewLast4?.addEventListener("input", scheduleReviewIdentityLookup);

btnOpenReviewModal?.addEventListener("click", () => {
  hideAlert();
  // reset
  if(reviewLast4) reviewLast4.value = "";
  resetReviewIdentity();
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
  const name = String(_reviewResolvedName || reviewName?.value || "").trim();
  const comment = String(reviewComment?.value || "").trim();

  if(!/^[0-9]{4}$/.test(last4)){
    showAlert("Escribe los últimos 4 dígitos del ID (ej: 1234).");
    return;
  }
  if(!_reviewRating || _reviewRating < 1 || _reviewRating > 5){
    showAlert("Selecciona una calificación (1 a 5 estrellas).");
    return;
  }
  if(!name){
    showAlert("Espera a que cargue el nombre del pedido antes de enviar tu opinión.");
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

syncTutorialButtonsUI();
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


// =================== HERO QUICK NAV ===================
function focusOrderFieldForQuickNav(mode){
  if(mode === "pedido"){
    try{
      const target = document.getElementById("name") || document.getElementById("phone") || document.getElementById("address");
      target?.focus?.({ preventScroll: true });
    }catch(_e){}
    return;
  }
  if(mode === "whatsapp"){
    try{
      const target = document.getElementById("btnWhatsApp") || document.getElementById("name") || document.getElementById("phone");
      target?.focus?.({ preventScroll: true });
    }catch(_e){}
  }
}

function setupHeroQuickNav(){
  const quickButtons = Array.from(document.querySelectorAll(".spotlightStep[data-scroll-target]"));
  if(!quickButtons.length) return;

  quickButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetKey = String(btn.getAttribute("data-scroll-target") || "").trim().toLowerCase();
      const targetId = (targetKey === "postres") ? "postres" : "pedido";
      const target = document.getElementById(targetId);
      if(!target) return;

      target.scrollIntoView({ behavior: "smooth", block: "start" });

      if(targetKey === "pedido" || targetKey === "whatsapp"){
        window.setTimeout(() => focusOrderFieldForQuickNav(targetKey), 420);
      }
    });
  });
}

setupHeroQuickNav();
