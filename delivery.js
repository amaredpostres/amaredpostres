;
// delivery.js — AMARED Envíos (v4 UX + Historial + Opt-in fix)
"use strict";

console.log("AMARED delivery v12");

const API_URL = "https://amared-orders.amaredpostres.workers.dev/";
const SS_KEY = "AMARED_DELIVERY_SESSION_V4";
const LS_KEY = "AMARED_DELIVERY_REMEMBER_V1";

let SESSION = { operator: null, pin: null };
let ORDERS = [];
let HIST = [];
let SEND_ORDER = null;
let SEND_CONTEXT = "pending"; // "pending" | "history"


let deliveryMobileBar = null;
let deliveryBarObserverStarted = false;

function isMobileViewport(){
  try{ return window.matchMedia('(max-width: 720px)').matches; }catch(_e){ return window.innerWidth <= 720; }
}
function isVisibleEl(el){
  if(!el) return false;
  const cs = window.getComputedStyle ? getComputedStyle(el) : null;
  if(cs && (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0)) return false;
  if(el.getAttribute && el.getAttribute('aria-hidden') === 'true') return false;
  return true;
}
function hasDeliveryOverlayOpen(){
  return [histBack, sendBack, confirmBack, loading].some(isVisibleEl);
}
function ensureDeliveryMobileBar(){
  if(deliveryMobileBar && document.body.contains(deliveryMobileBar)) return deliveryMobileBar;
  let bar = document.getElementById('amDeliveryMobileBar');
  if(!bar){
    bar = document.createElement('div');
    bar.id = 'amDeliveryMobileBar';
    bar.className = 'amDeliveryMobileBar isHidden';
    bar.innerHTML = `
      <button id="dMBtnRefresh" class="amDeliveryMobileAction isWarm" type="button" aria-label="Recargar">
        <span class="ico">↻</span><span class="txt">Recargar</span>
      </button>
      <div class="amDeliveryMobileCenter" role="group" aria-label="Acciones de envíos">
        <button id="dMBtnHistory" class="amDeliveryMobileSeg isAccent" type="button">
          <span class="txt">Historial</span>
        </button>
      </div>
      <button id="dMBtnLogout" class="amDeliveryMobileAction isNeutral" type="button" aria-label="Salir">
        <span class="ico">🚪</span><span class="txt">Salir</span>
      </button>`;
    document.body.appendChild(bar);
  }
  deliveryMobileBar = bar;
  return bar;
}
function syncDeliveryActionBars(){
  const mobile = isMobileViewport();
  const appVisible = isVisibleEl(panelView);
  const overlay = hasDeliveryOverlayOpen();
  if(btnRefreshTop) btnRefreshTop.style.display = (appVisible && !mobile) ? 'inline-flex' : 'none';
  if(btnHistory) btnHistory.style.display = (appVisible && !mobile) ? 'inline-flex' : 'none';
  if(btnLogoutTop) btnLogoutTop.style.display = (appVisible && !mobile) ? 'inline-flex' : 'none';
  const bar = ensureDeliveryMobileBar();
  if(bar) bar.classList.toggle('isHidden', !appVisible || !mobile || overlay);
  document.body.classList.toggle('deliveryOverlayOpen', !!overlay);
}
function wireDeliveryMobileBar(){
  ensureDeliveryMobileBar();
  const bRefresh = document.getElementById('dMBtnRefresh');
  const bHistory = document.getElementById('dMBtnHistory');
  const bLogout = document.getElementById('dMBtnLogout');
  if(bRefresh && !bRefresh.dataset.wired){ bRefresh.dataset.wired='1'; bRefresh.addEventListener('click', ()=> btnRefreshTop?.click()); }
  if(bHistory && !bHistory.dataset.wired){ bHistory.dataset.wired='1'; bHistory.addEventListener('click', ()=> btnHistory?.click()); }
  if(bLogout && !bLogout.dataset.wired){ bLogout.dataset.wired='1'; bLogout.addEventListener('click', ()=> btnLogoutTop?.click()); }
  syncDeliveryActionBars();
}
function watchDeliveryBarState(){
  if(deliveryBarObserverStarted || !document.body) return;
  const obs = new MutationObserver(()=> syncDeliveryActionBars());
  obs.observe(document.body, { subtree:true, childList:true, attributes:true, attributeFilter:['style','class','aria-hidden'] });
  window.addEventListener('resize', syncDeliveryActionBars, { passive:true });
  window.addEventListener('orientationchange', syncDeliveryActionBars, { passive:true });
  deliveryBarObserverStarted = true;
}


const loginView = document.getElementById("loginView");
const panelView = document.getElementById("panelView");

const selOperator = document.getElementById("selOperator");
const inpPin = document.getElementById("inpPin");
const btnTogglePin = document.getElementById("btnTogglePin");
const chkRemember = document.getElementById("chkRemember");
const btnLogin = document.getElementById("btnLogin");
const loginErr = document.getElementById("loginErr");

const btnRefresh = document.getElementById("btnRefresh");
const btnLogout = document.getElementById("btnLogout");
const btnHistory = document.getElementById("btnHistory");
const btnRefreshTop = document.getElementById("btnRefreshTop");
const btnLogoutTop = document.getElementById("btnLogoutTop");

const metaLine = document.getElementById("metaLine");
const statusEl = document.getElementById("status");
const listEl = document.getElementById("list");

// History modal
const histBack = document.getElementById("histBack");
const btnHistClose = document.getElementById("btnHistClose");
const btnHistReload = document.getElementById("btnHistReload");
const histMetaLine = document.getElementById("histMetaLine");
const histStatus = document.getElementById("histStatus");
const histList = document.getElementById("histList");

const loading = document.getElementById("loading");
const loadingTitle = document.getElementById("loadingTitle");
const loadingMsg = document.getElementById("loadingMsg");

const sendBack = document.getElementById("sendBack");
const btnSendClose = document.getElementById("btnSendClose");
const sendSubtitle = document.getElementById("sendSubtitle");
const inpEta = document.getElementById("inpEta");
const selTemplate = document.getElementById("selTemplate");
const txtMsg = document.getElementById("txtMsg");
const btnCopy = document.getElementById("btnCopy");
const btnAskWhatsApp = document.getElementById("btnAskWhatsApp");
const btnMarkSent = document.getElementById("btnMarkSent");
const sendErr = document.getElementById("sendErr");

// Confirm overlay
const confirmBack = document.getElementById("confirmBack");
const confirmTitle = document.getElementById("confirmTitle");
const confirmDesc = document.getElementById("confirmDesc");
const confirmTimer = document.getElementById("confirmTimer");
const confirmOrder = document.getElementById("confirmOrder");
const btnConfirmCancel = document.getElementById("btnConfirmCancel");
const btnConfirmGo = document.getElementById("btnConfirmGo");
const confirmErr = document.getElementById("confirmErr");

let CONFIRM_INT = null;
let CONFIRM_LEFT = 0;
let CONFIRM_MODE = "wa"; // "wa" | "manual"

function showLoading(t="Cargando…", m="Por favor espera."){
  // ✅ Siempre encima de confirm/modales
  try{ if(loading) loading.style.zIndex = "20000"; }catch(_e){}
  if(!loading) return;
  if(loadingTitle) loadingTitle.textContent = t;
  if(loadingMsg) loadingMsg.textContent = m;
  loading.style.display = "flex";
  loading.setAttribute("aria-hidden","false");
}
function hideLoading(){
  if(!loading) return;
  loading.style.display = "none";
  loading.setAttribute("aria-hidden","true");
}
function setStatus(msg){ if(statusEl) statusEl.textContent = msg || ""; }

function escapeHtml(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function safeJsonParse(v){
  try{
    if(v == null) return null;
    if(typeof v === "object") return v;
    const s = String(v).trim();
    if(!s) return null;
    return JSON.parse(s);
  }catch{ return null; }
}

function normalizeCatsAny(v){
  if(Array.isArray(v)) return v.map(x=>String(x||"").trim().toLowerCase()).filter(Boolean);
  return String(v||"")
    .split(",")
    .map(s=>s.trim().toLowerCase())
    .filter(Boolean);
}

function isActiveAny(v){
  const s = String(v ?? "true").trim().toLowerCase();
  return !(s === "false" || s === "0" || s === "no");
}

// ✅ FIX opt-in: soporta TRUE/VERDADERO/SI/ON y boolean
function isOptIn(v){
  if(v === true) return true;
  if(v === false) return false;
  const s = String(v ?? "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "si" || s === "sí" || s === "yes" || s === "on" || s === "verdadero";
}

// Category matching (supports synonyms)
function hasCategory(profile, wanted){
  const cats = normalizeCatsAny(profile?.categories);
  const w = String(wanted||"").toLowerCase();
  const map = {
    delivery: ["delivery","envios","envíos","envio","envío","envíos","reparto","domicilio"],
    admin: ["admin","administracion","administración"],
    payments: ["payments","pago","pagos"],
    kitchen: ["kitchen","cocina"],
  };
  const aliases = map[w] || [w];
  return aliases.some(a => cats.includes(a));
}

async function api(payload){
  const res = await fetch(API_URL, {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify(payload || {})
  });
  const out = await res.json().catch(async()=>({ ok:false, error: await res.text().catch(()=> "") }));
  if(!out || out.ok === false) throw new Error(out?.error || out?.message || "Error");
  return out;
}

// ---- Profiles (public list) ----
async function fetchProfilesPublic(){
  const out = await api({ action: "profiles_public_list" });
  return out.profiles || [];
}

function renderProfilesSelect(list){
  if(!selOperator) return;
  const opts = ['<option value="">Seleccionar…</option>'];
  for(const p of (list||[])){
    opts.push(`<option value="${escapeHtml(p.id)}">${escapeHtml(p.label)}</option>`);
  }
  selOperator.innerHTML = opts.join("");
}

function syncPinToggleState(){
  if(!inpPin || !btnTogglePin) return;
  const show = inpPin.type === "text";
  btnTogglePin.textContent = show ? "🙈" : "👁";
  btnTogglePin.setAttribute("aria-label", show ? "Ocultar PIN" : "Mostrar PIN");
}

function saveDeliverySession(remember = false){
  try{ sessionStorage.setItem(SS_KEY, JSON.stringify(SESSION)); }catch(_e){}
  try{
    if(remember) localStorage.setItem(LS_KEY, JSON.stringify(SESSION));
    else localStorage.removeItem(LS_KEY);
  }catch(_e){}
}

function loadSavedDeliverySession(){
  try{
    const rawLocal = localStorage.getItem(LS_KEY);
    const sLocal = rawLocal ? JSON.parse(rawLocal) : null;
    if(sLocal?.pin && sLocal?.operator) return { data:sLocal, remembered:true };
  }catch(_e){}
  try{
    const raw = sessionStorage.getItem(SS_KEY);
    const s = raw ? JSON.parse(raw) : null;
    if(s?.pin && s?.operator) return { data:s, remembered:false };
  }catch(_e){}
  return null;
}

function clearSavedDeliverySession(){
  try{ sessionStorage.removeItem(SS_KEY); }catch(_e){}
  try{ localStorage.removeItem(LS_KEY); }catch(_e){}
}

btnTogglePin?.addEventListener('click', ()=>{
  if(!inpPin) return;
  inpPin.type = inpPin.type === 'password' ? 'text' : 'password';
  syncPinToggleState();
});
syncPinToggleState();

async function loadProfilesOnStart(){
  renderProfilesSelect([]);
  showLoading("Cargando perfiles…","Buscando perfiles de envíos/admin.");
  loginErr.textContent = "";
  try{
    const all = await fetchProfilesPublic();
    const list = (all||[])
      .filter(p => p && p.id && p.label)
      .filter(p => isActiveAny(p.is_active ?? p.active ?? true))
      .filter(p => hasCategory(p,"delivery") || hasCategory(p,"admin"));

    renderProfilesSelect(list);
    const saved = loadSavedDeliverySession();
    if(saved?.data?.operator?.id && selOperator && !selOperator.value){
      selOperator.value = String(saved.data.operator.id);
      if(inpPin && !inpPin.value) inpPin.value = String(saved.data.pin || '');
      if(chkRemember) chkRemember.checked = !!saved.remembered;
    }
    if(list.length === 0){
      loginErr.textContent = "No hay perfiles con categoría delivery/admin. Ve a “Gestionar perfiles” y asigna la categoría.";
    }
  }catch(e){
    renderProfilesSelect([]);
    loginErr.textContent = (e?.message || "No se pudieron cargar perfiles.")
      + " (Revisa profiles_public_list en Worker)";
  }finally{
    hideLoading();
  }
}

// ---- Login ----
async function doLogin(){
  loginErr.textContent = "";
  const id = String(selOperator?.value || "").trim();
  const pin = String(inpPin?.value || "").trim();
  if(!id){ loginErr.textContent = "Selecciona un perfil."; return; }
  if(!pin){ loginErr.textContent = "Ingresa el PIN."; return; }

  showLoading("Validando…","Comprobando acceso…");
  try{
    const out = await api({ action:"validate_admin_pin", admin_pin: pin });
    if(!out.valid){
      loginErr.textContent = "PIN incorrecto.";
      return;
    }
    const all = await fetchProfilesPublic();
    const p = (all||[]).find(x => String(x.id) === id);
    SESSION = { operator: { id, label: p?.label || id }, pin };
    saveDeliverySession(!!chkRemember?.checked);
    showPanel();
    await loadOrders();
  }catch(e){
    loginErr.textContent = e?.message || "No se pudo validar.";
  }finally{
    hideLoading();
  }
}

function showPanel(){
  if(loginView) loginView.style.display = "none";
  if(panelView) panelView.style.display = "block";
  syncDeliveryActionBars();
}
function showLogin(){
  if(panelView) panelView.style.display = "none";
  if(loginView) loginView.style.display = "block";
  syncDeliveryActionBars();
}

function logout(){
  SESSION = { operator:null, pin:null };
  clearSavedDeliverySession();
  if(inpPin) inpPin.value = "";
  closeHistory();
  showLogin();
}

// ---- Orders ----
function normStatus(s){ return String(s||"").trim().toLowerCase(); }

function normalizeItemsFromAnyOrder(order){
  if(!order) return [];
  const raw = order.items_json ?? order.itemsJson ?? order.itemsJSON;
  if(raw){
    const parsed = (typeof raw === "string") ? safeJsonParse(raw) : raw;
    if(Array.isArray(parsed)){
      return parsed.map(it=>({
        id: String(it.id || it.product_id || ""),
        name: String(it.name || ""),
        qty: Number(it.qty || it.units || 0) || 0,
      })).filter(it=>it.name && it.qty>0);
    }
  }
  const txt = String(order.items || order.items_text || "").trim();
  if(txt){
    const lines = txt.split("\n").map(s=>s.trim()).filter(Boolean);
    const out=[];
    for(const line0 of lines){
      const line = line0.replace(/^-+\s*/, "");
      const m = line.match(/^(.+?)\s*:\s*(\d+(?:[\.,]\d+)?)$/);
      if(!m) continue;
      const name = m[1].trim();
      const qty = Number(String(m[2]).replace(",", ".")) || 0;
      if(qty>0) out.push({ id: name.toLowerCase().replace(/\s+/g,"_"), name, qty });
    }
    return out;
  }
  return [];
}

function itemsSummary(items){
  return (items||[]).map(it => `${it.name} x${it.qty}`).join(", ");
}

function firstName(full){
  const s = String(full||"").trim();
  if(!s) return "hola";
  return s.split(/\s+/)[0];
}

function formatDate(v){
  if(!v) return "";
  const d = new Date(v);
  if(Number.isNaN(d.getTime())) return String(v);
  return new Intl.DateTimeFormat("es-CO", {
    timeZone:"America/Bogota",
    year:"numeric", month:"2-digit", day:"2-digit",
    hour:"2-digit", minute:"2-digit", hour12:false
  }).format(d);
}

function calcUnits(order){
  const items = normalizeItemsFromAnyOrder(order);
  return Number(order.total_units||0) || items.reduce((s,it)=>s+it.qty,0) || 0;
}

function money(n){
  return Math.round(Number(n||0)).toLocaleString("es-CO");
}

function renderOrders(orders){
  ORDERS = orders || [];
  if(metaLine){
    metaLine.textContent = `Operador: ${SESSION?.operator?.label || "—"} · Pedidos: ${ORDERS.length}`;
  }

  if(!listEl) return;
  if(ORDERS.length === 0){
    listEl.innerHTML = `<div class="muted small">No hay pedidos con <b>Pagado + Listo + delivery Pendiente</b>.</div>`;
    return;
  }

  const html = ORDERS.map(o=>{
    const items = normalizeItemsFromAnyOrder(o);
    const summary = itemsSummary(items) || (o.items || "");
    const units = calcUnits(o);
    const canWa = isOptIn(o.wa_opt_in);

    return `
      <div class="orderCard">
        <div class="orderHead">
          <div>
            <div class="orderId">${escapeHtml(o.order_id || "")}</div>
            <div class="orderMeta">${escapeHtml(o.customer_name || "")} · ${escapeHtml(formatDate(o.created_at))}</div>
          </div>
          <div class="row" style="gap:10px; flex-wrap:wrap; justify-content:flex-end;">
            <span class="pill">🧁 ${escapeHtml(String(units))} u</span>
            <span class="pill">💰 $${escapeHtml(money(o.subtotal||0))}</span>
            ${canWa ? "" : '<span class="pill">📵 Sin WhatsApp</span>'}
          </div>
        </div>

        <div class="orderBody">
          <div class="kv">
            <label>Ítems</label>
            <div class="itemsBox">${escapeHtml(summary || "—")}</div>
          </div>

          <div class="grid2">
            <div class="kv">
              <label>Dirección</label>
              <div class="v">${escapeHtml(o.address_text || "—")}</div>
            </div>
            <div class="kv">
              <label>Teléfono</label>
              <div class="v">${escapeHtml(o.phone || "—")}</div>
            </div>
          </div>

          <div class="btnRow">
            <button class="btn secondary btnSend" data-id="${escapeHtml(o.order_id)}">Ver mensaje</button>
          </div>
        </div>
      </div>
    `;
  }).join("");

  listEl.innerHTML = html;
}

async function loadOrders(){
  setStatus("");
  showLoading("Cargando pedidos…","Buscando Pagado + Listo + delivery Pendiente…");
  try{
    let out = await api({ action:"delivery_list", admin_pin: SESSION.pin, hours: 72, view:"pending" });
    let orders = out.orders || [];

    // fallback: list_orders + client-side filter
    if(orders.length === 0){
      const out2 = await api({ action:"list_orders", admin_pin: SESSION.pin, payment_status:"Pagado" });
      const all = out2.orders || [];
      orders = all.filter(o=>{
        const kit = normStatus(o.kitchen_status);
        const del = normStatus(o.delivery_status || "pendiente");
        const pay = normStatus(o.payment_status);
        return pay === "pagado" && kit === "listo" && (del === "pendiente" || del === "");
      });
    }

    renderOrders(orders);
  }catch(e){
    console.error("loadOrders error:", e);
    setStatus(e?.message || "Error cargando pedidos.");
    if(listEl) listEl.innerHTML = "";
  }finally{
    hideLoading();
  }
}

// ---- History ----
function openHistory(){
  if(!histBack) return;
  histStatus.textContent = "";
  histBack.style.display = "flex";
  histBack.setAttribute("aria-hidden","false");
  loadHistory();
}
function closeHistory(){
  if(!histBack) return;
  histBack.style.display = "none";
  histBack.setAttribute("aria-hidden","true");
}
function renderHistory(orders){
  HIST = orders || [];
  if(histMetaLine){
    histMetaLine.textContent = `Enviados: ${HIST.length} · Operador: ${SESSION?.operator?.label || "—"}`;
  }
  if(!histList) return;
  if(HIST.length === 0){
    histList.innerHTML = `<div class="muted small">No hay pedidos marcados como enviados en el rango.</div>`;
    return;
  }

  const html = HIST.map(o=>{
    const items = normalizeItemsFromAnyOrder(o);
    const summary = itemsSummary(items) || (o.items || "");
    const units = calcUnits(o);
    const st = String(o.delivery_status || "Enviado").trim() || "Enviado";
    const sentAt = String(o.delivery_sent_at || "").trim();
    const who = String(o.delivery_sent_by || "").trim();
    const canWa = isOptIn(o.wa_opt_in);

    return `
      <div class="orderCard">
        <div class="orderHead">
          <div>
            <div class="orderId">${escapeHtml(o.order_id || "")}</div>
            <div class="orderMeta">${escapeHtml(o.customer_name || "")} · ${escapeHtml(sentAt ? sentAt : formatDate(o.created_at))}${who ? " · " + escapeHtml(who) : ""}</div>
          </div>
          <div class="row" style="gap:10px; flex-wrap:wrap; justify-content:flex-end;">
            <span class="pill">✅ ${escapeHtml(st)}</span>
            <span class="pill">🧁 ${escapeHtml(String(units))} u</span>
            ${canWa ? "" : '<span class="pill">📵 Sin WhatsApp</span>'}
          </div>
        </div>

        <div class="orderBody">
          <div class="kv">
            <label>Ítems</label>
            <div class="itemsBox">${escapeHtml(summary || "—")}</div>
          </div>

          <div class="btnRow">
            <button class="btn secondary btnHistView" data-id="${escapeHtml(o.order_id)}">Ver detalle</button>
          </div>
        </div>
      </div>
    `;
  }).join("");

  histList.innerHTML = html;
}

async function loadHistory(){
  if(histStatus) histStatus.textContent = "";
  showLoading("Cargando historial…","Buscando pedidos enviados…");
  try{
    const out = await api({ action:"delivery_list", admin_pin: SESSION.pin, hours: 240, view:"history" });
    renderHistory(out.orders || []);
  }catch(e){
    if(histStatus) histStatus.textContent = e?.message || "Error cargando historial.";
    if(histList) histList.innerHTML = "";
  }finally{
    hideLoading();
  }
}

// ---- Send flow ----
const TEMPLATES = [
  {
    id:"t1",
    label:"Cercano (✨🚗)",
    build: ({name, items, eta}) =>
      `Hola ${name} 👋✨\nTu pedido (${items}) ya va en camino 🚗💨\nLlega aprox. en ${eta} min ⏱️\n¡Gracias por elegir AMARED! 😋🍰`
  },
  {
    id:"t2",
    label:"Corto (😊🧁)",
    build: ({name, units, eta}) =>
      `¡Hola ${name}! 😊\nYa salió tu pedido 🧁🚚 (son ${units} postres).\nTiempo estimado: ${eta} min ⏱️\n¡Que lo disfrutes mucho! 💖`
  },
  {
    id:"t3",
    label:"Con energía (🚀💛)",
    build: ({name, eta}) =>
      `Hola ${name} 🙌\nTu pedido está listo y va en ruta 🚀\nEstimado: ${eta} min ⏱️\n¡Disfrútalo! 💛`
  },
];

function openSendModal(order, opts={}){
  SEND_ORDER = order;
  SEND_CONTEXT = opts?.fromHistory ? "history" : "pending";
  sendErr.textContent = "";
  if(!sendBack) return;

  sendSubtitle.textContent = `${order.order_id} · ${order.customer_name || ""}`;
  inpEta.value = "5";

  selTemplate.innerHTML = TEMPLATES.map(t=>`<option value="${t.id}">${t.label}</option>`).join("");
  selTemplate.value = "t1";

  txtMsg.value = buildMessage(order, Number(inpEta.value||5)||5, "t1");

  const canWa = isOptIn(order.wa_opt_in);
if(btnAskWhatsApp){
  btnAskWhatsApp.disabled = !canWa;
  btnAskWhatsApp.style.opacity = canWa ? "" : "0.55";
  btnAskWhatsApp.title = canWa ? "Abrir WhatsApp" : "El cliente no autorizó WhatsApp";
}
if(btnMarkSent){
  btnMarkSent.disabled = false;
  btnMarkSent.style.opacity = "";
  btnMarkSent.title = "Marcar Enviado";
}
if(!canWa){
  sendErr.textContent = "Este cliente NO autorizó recibir mensajes por WhatsApp. Puedes copiar el mensaje y luego usar “Marcar Enviado”.";
}

  applyContextButtons(order);

  sendBack.style.display = "flex";
  sendBack.setAttribute("aria-hidden","false");
}

function closeSendModal(){
  SEND_ORDER = null;
  if(!sendBack) return;
  sendBack.style.display = "none";
  sendBack.setAttribute("aria-hidden","true");
}

function buildMessage(order, etaMinutes, templateId){
  const itemsArr = normalizeItemsFromAnyOrder(order);
  const itemsTxt = itemsSummary(itemsArr) || (order.items || "tu pedido");
  const units = calcUnits(order);

  const name = firstName(order.customer_name);
  const eta = Math.max(1, Math.round(Number(etaMinutes||0) || 0));

  const t = TEMPLATES.find(x=>x.id===templateId) || TEMPLATES[0];
  return t.build({ name, items: itemsTxt, units, eta });
}

function applyContextButtons(order){
  const canWa = isOptIn(order?.wa_opt_in);
  const isHist = (SEND_CONTEXT === "history");

  if(isHist){
    if(btnMarkSent) btnMarkSent.style.display = "none";
    if(btnAskWhatsApp){
      btnAskWhatsApp.style.display = "";
      btnAskWhatsApp.disabled = false;
      btnAskWhatsApp.style.opacity = "";
      btnAskWhatsApp.title = "Abrir chat (sin mensaje)";
      btnAskWhatsApp.textContent = "Ver chat";
    }
    if(sendErr) sendErr.textContent = "";
    return;
  }

  if(canWa){
    if(btnAskWhatsApp){
      btnAskWhatsApp.style.display = "";
      btnAskWhatsApp.disabled = false;
      btnAskWhatsApp.style.opacity = "";
      btnAskWhatsApp.title = "Abrir WhatsApp (con mensaje)";
      btnAskWhatsApp.textContent = "Abrir WhatsApp";
    }
    if(btnMarkSent) btnMarkSent.style.display = "none";
    if(sendErr) sendErr.textContent = "";
  }else{
    if(btnAskWhatsApp) btnAskWhatsApp.style.display = "none";
    if(btnMarkSent){
      btnMarkSent.style.display = "";
      btnMarkSent.disabled = false;
      btnMarkSent.style.opacity = "";
      btnMarkSent.title = "Marcar Enviado";
    }
    if(sendErr) sendErr.textContent = "Este cliente NO autorizó WhatsApp. Usa “Marcar Enviado”.";
  }
}


function normalizePhoneToWa(phone){
  const digits = String(phone||"").replace(/\D+/g,"");
  if(!digits) return "";
  if(digits.length >= 11) return digits;
  if(digits.length === 10) return "57" + digits; // Colombia
  return digits;
}

function isMobileUA(){
  const ua = navigator.userAgent || "";
  return /Android|iPhone|iPad|iPod|Mobi/i.test(ua);
}
function buildWhatsAppUrlWithText(phoneDigits, message){
  const enc = encodeURIComponent(String(message || ""));
  if(!isMobileUA()){
    return `https://api.whatsapp.com/send?phone=${phoneDigits}&text=${enc}`;
  }
  return `https://wa.me/${phoneDigits}?text=${enc}`;
}
function buildWhatsAppChatOnlyUrl(phoneDigits){
  if(!isMobileUA()){
    return `https://api.whatsapp.com/send?phone=${phoneDigits}`;
  }
  return `https://wa.me/${phoneDigits}`;
}
function openWhatsAppUrl(url){
  if(isMobileUA()){
    window.location.href = url;
  }else{
    window.open(url, "_blank", "noopener,noreferrer");
  }
}


// --- Confirm (2s delay) ---
function openConfirm(orderId, mode){
  CONFIRM_MODE = (mode === "chat") ? "chat" : ((mode === "manual") ? "manual" : "wa");

  if(confirmTitle) confirmTitle.textContent = (CONFIRM_MODE === "manual") ? "¿Marcar como enviado?" : "¿Abrir WhatsApp?";
  if(confirmDesc){
    confirmDesc.innerHTML = (CONFIRM_MODE === "manual")
      ? "Se marcará el pedido como <b>Enviado</b> (para trazabilidad), sin abrir WhatsApp."
      : "Se marcará el pedido como <b>Enviado</b> y se abrirá WhatsApp con el mensaje listo.";
  }

  confirmErr.textContent = "";
  if(!confirmBack) return;
  confirmBack.style.display = "flex";
  confirmBack.setAttribute("aria-hidden","false");

  confirmOrder.textContent = orderId || "—";
  CONFIRM_LEFT = 2;
  btnConfirmGo.disabled = true;
  confirmTimer.textContent = `Espera ${CONFIRM_LEFT}s…`;

  if(CONFIRM_INT) clearInterval(CONFIRM_INT);
  CONFIRM_INT = setInterval(()=>{
    CONFIRM_LEFT = Math.max(0, CONFIRM_LEFT - 1);
    if(CONFIRM_LEFT <= 0){
      confirmTimer.textContent = "Listo ✅";
      btnConfirmGo.disabled = false;
      clearInterval(CONFIRM_INT);
      CONFIRM_INT = null;
      return;
    }
    confirmTimer.textContent = `Espera ${CONFIRM_LEFT}s…`;
  }, 1000);
}

function closeConfirm(){
  if(CONFIRM_INT) clearInterval(CONFIRM_INT);
  CONFIRM_INT = null;
  if(!confirmBack) return;
  confirmBack.style.display = "none";
  confirmBack.setAttribute("aria-hidden","true");
}

async function markSentOnly(){
  confirmErr.textContent = "";
  if(!SEND_ORDER) return;

  // eta opcional
  const eta = Number(inpEta.value || 0) || 0;

  showLoading("Actualizando…","Marcando pedido como Enviado…");
  try{
    await api({
      action:"delivery_mark_sent",
      admin_pin: SESSION.pin,
      order_id: SEND_ORDER.order_id,
      eta_minutes: (eta > 0 ? Math.round(eta) : 0),
      sent_by: SESSION?.operator?.label || "DELIVERY",
      delivery_status: "Enviado"
    });

    closeConfirm();
    closeSendModal();
    await loadOrders();
    if(histBack && histBack.style.display === "flex") await loadHistory();
  }catch(e){
    confirmErr.textContent = e?.message || "Error actualizando.";
  }finally{
    hideLoading();
  }
}


async function openChatOnly(){
  confirmErr.textContent = "";
  if(!SEND_ORDER) return;

  const wa = normalizePhoneToWa(SEND_ORDER.phone);
  if(!wa){
    confirmErr.textContent = "El pedido no tiene teléfono.";
    return;
  }

  const url = buildWhatsAppChatOnlyUrl(wa);
  closeConfirm();
  openWhatsAppUrl(url);
}

async function markSentAndOpenWhatsApp(){
  confirmErr.textContent = "";
  if(!SEND_ORDER) return;

  if(!isOptIn(SEND_ORDER.wa_opt_in)){
    confirmErr.textContent = "Este cliente no autorizó recibir mensajes por WhatsApp.";
    return;
  }

  const eta = Number(inpEta.value || 0) || 0;
  if(!(eta > 0)){
    confirmErr.textContent = "Ingresa los minutos (mayor a 0).";
    return;
  }
  const tpl = String(selTemplate.value || "t1");
  const msg = buildMessage(SEND_ORDER, eta, tpl);
  txtMsg.value = msg;

  const wa = normalizePhoneToWa(SEND_ORDER.phone);
  if(!wa){
    confirmErr.textContent = "El pedido no tiene teléfono. Copia el mensaje y envíalo manualmente.";
    return;
  }

  showLoading("Actualizando…","Marcando pedido como Enviado…");
  try{
    await api({
      action:"delivery_mark_sent",
      admin_pin: SESSION.pin,
      order_id: SEND_ORDER.order_id,
      eta_minutes: Math.round(eta),
      sent_by: SESSION?.operator?.label || "DELIVERY",
      delivery_status: "Enviado"
    });

    const waUrl = buildWhatsAppUrlWithText(wa, msg);
    closeConfirm();
    closeSendModal();
    openWhatsAppUrl(waUrl);
    await loadOrders();
    if(histBack && histBack.style.display === "flex") await loadHistory();
  }catch(e){
    confirmErr.textContent = e?.message || "Error actualizando.";
  }finally{
    hideLoading();
  }
}

async function doConfirmAction(){
  if(CONFIRM_MODE === "manual") return markSentOnly();
  if(CONFIRM_MODE === "chat") return openChatOnly();
  return markSentAndOpenWhatsApp();
}

async function copyMsg(){
  try{
    await navigator.clipboard.writeText(txtMsg.value || "");
  }catch{
    const ta = document.createElement("textarea");
    ta.value = txtMsg.value || "";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
}

// ---- Events ----
btnLogin?.addEventListener("click", doLogin);
btnRefresh?.addEventListener("click", loadOrders);
btnLogout?.addEventListener("click", logout);
btnHistory?.addEventListener("click", openHistory);
btnRefreshTop?.addEventListener("click", loadOrders);
btnLogoutTop?.addEventListener("click", logout);

listEl?.addEventListener("click", (ev)=>{
  const btnSend = ev.target?.closest?.(".btnSend");
  if(!btnSend) return;

  const id = String(btnSend.getAttribute("data-id")||"").trim();
  const o = ORDERS.find(x => String(x.order_id) === id);
  if(!o) return;

  openSendModal(o);
});

histList?.addEventListener("click", (ev)=>{
  const btn = ev.target?.closest?.(".btnHistView");
  if(!btn) return;
  const id = String(btn.getAttribute("data-id")||"").trim();
  const o = HIST.find(x => String(x.order_id) === id);
  if(!o) return;

  closeHistory();
  openSendModal(o, { fromHistory:true });
});

btnSendClose?.addEventListener("click", closeSendModal);
sendBack?.addEventListener("click", (ev)=>{ if(ev.target === sendBack) closeSendModal(); });

inpEta?.addEventListener("input", ()=>{
  if(!SEND_ORDER) return;
  const eta = Number(inpEta.value||0) || 0;
  txtMsg.value = buildMessage(SEND_ORDER, eta, selTemplate.value);
});
selTemplate?.addEventListener("change", ()=>{
  if(!SEND_ORDER) return;
  const eta = Number(inpEta.value||0) || 0;
  txtMsg.value = buildMessage(SEND_ORDER, eta, selTemplate.value);
});

btnCopy?.addEventListener("click", copyMsg);

btnAskWhatsApp?.addEventListener("click", ()=>{
  if(!SEND_ORDER) return;

  if(SEND_CONTEXT === "history"){
    // ✅ Historial: abrir directo (sin confirmación) y SIN texto
    const wa = normalizePhoneToWa(SEND_ORDER.phone);
    if(!wa){
      if(sendErr) sendErr.textContent = "El pedido no tiene teléfono.";
      return;
    }
    const url = buildWhatsAppChatOnlyUrl(wa);
    openWhatsAppUrl(url);
    return;
  }

  if(!isOptIn(SEND_ORDER.wa_opt_in)){
    if(sendErr) sendErr.textContent = "Este cliente no autorizó WhatsApp. Usa “Marcar Enviado”.";
    return;
  }
  openConfirm(SEND_ORDER.order_id, "wa");
});

btnMarkSent?.addEventListener("click", ()=>{
  if(!SEND_ORDER) return;
  openConfirm(SEND_ORDER.order_id, "manual");
});

btnConfirmCancel?.addEventListener("click", closeConfirm);
confirmBack?.addEventListener("click", (ev)=>{ if(ev.target === confirmBack) closeConfirm(); });
btnConfirmGo?.addEventListener("click", doConfirmAction);

// History events
btnHistClose?.addEventListener("click", closeHistory);
btnHistReload?.addEventListener("click", loadHistory);
histBack?.addEventListener("click", (ev)=>{ if(ev.target === histBack) closeHistory(); });

// ---- Init ----
(function init(){
  wireDeliveryMobileBar();
  watchDeliveryBarState();
  syncDeliveryActionBars();
  try{
    const saved = loadSavedDeliverySession();
    if(saved?.data?.pin && saved?.data?.operator){
      if(chkRemember) chkRemember.checked = !!saved.remembered;
      SESSION = saved.data;
      if(inpPin) inpPin.value = String(saved.data.pin || '');
      showPanel();
      loadOrders();
    }else{
      showLogin();
      loadProfilesOnStart();
    }
  }catch{
    showLogin();
    loadProfilesOnStart();
  }
})();
