/* delivery.js — AMARED Envíos
   - Login con perfiles (category: payments) + PIN (admin_pin)
   - Lista pedidos: Pagado + Listo + delivery_status Pendiente
   - Botón Enviar: pide ETA, genera mensaje WhatsApp (variantes), marca delivery_status = En camino
*/

"use strict";

const API_URL = "https://amared-orders.amaredpostres.workers.dev/";
const SS_KEY = "AMARED_DELIVERY_SESSION_V1";

let state = {
  session: { operatorId:null, operatorLabel:null, pin:null },
  profiles: [],
  orders: [],
  filtered: [],
  activeOrder: null,
  lastMessage: "",
};

const el = (id)=>document.getElementById(id);

function showLoading(title, desc){
  const box = el("loading");
  if(el("lt")) el("lt").textContent = title || "Cargando…";
  if(el("ld")) el("ld").textContent = desc || "Por favor espera.";
  if(box){ box.style.display="flex"; box.setAttribute("aria-hidden","false"); }
}
function hideLoading(){
  const box = el("loading");
  if(box){ box.style.display="none"; box.setAttribute("aria-hidden","true"); }
}

async function api(payload){
  const res = await fetch(API_URL, {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify(payload || {})
  });
  const out = await res.json().catch(async()=>({ ok:false, error: await res.text().catch(()=> "Error") }));
  if(out?.ok === false) throw new Error(out.error || out.message || "Error");
  return out;
}

async function apiTry(payload){
  try{ return await api(payload); }
  catch(e){ return { ok:false, error: String(e.message||e) }; }
}

function safeJsonParse(s){ try{ return JSON.parse(s); } catch { return null; } }
function escapeHtml(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}
function fmtDate(v){
  if(!v) return "";
  const d = new Date(v);
  if(Number.isNaN(d.getTime())) return String(v);
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    year:"numeric", month:"2-digit", day:"2-digit",
    hour:"2-digit", minute:"2-digit", hour12:false
  }).format(d);
}

function getFirstName(full){
  const s = String(full||"").trim();
  if(!s) return "Hola";
  return s.split(/\s+/)[0];
}

function normalizePhone(p){
  const digits = String(p||"").replace(/\D+/g,"");
  if(!digits) return "";
  if(digits.startsWith("57") && digits.length>=12) return digits;
  if(digits.length===10) return "57"+digits;
  return digits;
}

function itemsFromOrder(order){
  const raw = order.items_json ?? order.itemsJson ?? order.itemsJSON;
  if(raw){
    const parsed = (typeof raw==="string") ? safeJsonParse(raw) : raw;
    if(Array.isArray(parsed)){
      return parsed.map(it=>({
        name: String(it.name||""),
        qty: Number(it.qty||it.units||0) || 0
      })).filter(it=>it.name && it.qty>0);
    }
  }
  // fallback: lines "- Nombre: 2"
  const txt = String(order.items||"").trim();
  if(!txt) return [];
  const lines = txt.split("\n").map(x=>x.trim()).filter(Boolean);
  const out=[];
  for(const line0 of lines){
    const line=line0.replace(/^-+\s*/,"");
    const m=line.match(/^(.+?)\s*:\s*(\d+(?:[\.,]\d+)?)$/);
    if(!m) continue;
    const name=m[1].trim();
    const qty=Number(String(m[2]).replace(",","."))||0;
    if(qty>0) out.push({name, qty});
  }
  return out;
}

function summarizeItems(items){
  const total = items.reduce((s,it)=>s+Number(it.qty||0),0);
  if(items.length===0) return { total_units: total, short: `${total || 0} postres` };
  const parts = items.map(it=>`${it.qty} ${it.name}`).slice(0,4);
  const more = items.length>4 ? ` +${items.length-4} más` : "";
  return { total_units: total, short: parts.join(", ") + more };
}

const TEMPLATES = [
  {
    id:"v1",
    label:"✨ Cercano",
    build: ({name, itemsShort, minutes, mode}) => {
      if(mode==="recoger"){
        return `Hola ${name} 😊\n\nTu pedido (${itemsShort}) ya está listo ✅\nPuedes pasar a reclamarlo en ~${minutes} min.\n\n¡Gracias por elegir AMARED! 🩷🍰`;
      }
      return `Hola ${name} 😊\n\nTu pedido (${itemsShort}) ya va en camino 🚚💨\nLlega en aproximadamente ${minutes} min.\n\n¡Que lo disfrutes muchísimo! 🩷🍰`;
    }
  },
  {
    id:"v2",
    label:"🚚 En camino",
    build: ({name, itemsShort, minutes, mode}) => {
      if(mode==="recoger"){
        return `¡Hola ${name}! 🙌\n\nYa tenemos tu pedido listo (${itemsShort}) ✅\nEn unos ${minutes} min lo puedes reclamar.\n\nGracias 🩷`;
      }
      return `¡Hola ${name}! 🙌\n\nTu pedido (${itemsShort}) salió para entrega 🚚\nTiempo estimado: ${minutes} min ⏳\n\nGracias por tu compra 🩷`;
    }
  },
  {
    id:"v3",
    label:"🍰 Dulce",
    build: ({name, itemsShort, minutes, mode}) => {
      if(mode==="recoger"){
        return `Hola ${name} 🩷\n\n¡Tu antojo ya está listo! (${itemsShort}) ✅\nPasa por él en ~${minutes} min.\n\nAMARED 🍰✨`;
      }
      return `Hola ${name} 🩷\n\n¡Tu antojo salió! (${itemsShort}) 🚚✨\nLlega en ~${minutes} min.\n\nAMARED 🍰`;
    }
  },
];

function fillTemplates(){
  const sel = el("tpl");
  if(!sel) return;
  sel.innerHTML = TEMPLATES.map(t=>`<option value="${t.id}">${t.label}</option>`).join("");
  sel.value = TEMPLATES[0].id;
}

function showLogin(){
  el("loginBox").style.display = "block";
  el("app").style.display = "none";
  el("btnLogoutTop").style.display = "none";
  el("btnRefreshTop").style.display = "none";
}
function showApp(){
  el("loginBox").style.display = "none";
  el("app").style.display = "block";
  el("btnLogoutTop").style.display = "inline-flex";
  el("btnRefreshTop").style.display = "inline-flex";
}

function saveSession(){ sessionStorage.setItem(SS_KEY, JSON.stringify(state.session)); }
function loadSession(){
  const raw=sessionStorage.getItem(SS_KEY);
  const s=raw? safeJsonParse(raw):null;
  if(s?.operatorId && s?.operatorLabel && s?.pin){ state.session=s; return true; }
  return false;
}
function clearSession(){ sessionStorage.removeItem(SS_KEY); state.session={operatorId:null, operatorLabel:null, pin:null}; }

function renderProfilesSelect(list){
  const sel = el("selOperator");
  if(!sel) return;
  if(!list.length){
    sel.innerHTML = `<option value="">No hay perfiles</option>`;
    return;
  }
  sel.innerHTML = `<option value="">Seleccionar…</option>` + list.map(p=>`<option value="${escapeHtml(p.id)}">${escapeHtml(p.label)}</option>`).join("");
}

async function loadProfilesOnStart(){
  const errEl = el("loginErr");
  if(errEl) errEl.textContent = "Cargando perfiles…";
  showLoading("Cargando…", "Preparando perfiles…");
  try{
    // payments (principal) -> pago (fallback)
    let out = await apiTry({action:"profiles_public_list", category:"payments"});
    if(out.ok!==true || !(out.profiles||out.items)){
      out = await apiTry({action:"profiles_public_list", category:"pago"});
    }
    if(out.ok!==true){
      throw new Error(out.error || "No se pudieron cargar perfiles.");
    }
    const arr = out.profiles || out.items || [];
    const list = (Array.isArray(arr)?arr:[])
      .filter(p=>p && (p.id||p.profile_id) && p.label && (p.is_active===undefined || String(p.is_active)!=="false"))
      .map(p=>({id:String(p.id||p.profile_id), label:String(p.label)}));

    state.profiles = list;
    renderProfilesSelect(list);
    if(errEl) errEl.textContent = "";
  }catch(e){
    state.profiles = [];
    renderProfilesSelect([]);
    if(errEl) errEl.textContent = e?.message || String(e);
  }finally{
    hideLoading();
  }
}

async function validatePin(pin){
  const out = await apiTry({action:"validate_admin_pin", admin_pin: pin});
  if(out.ok===true && out.valid===true) return true;
  // compat: si no existe acción, deja pasar
  if(String(out.error||"").toLowerCase().includes("unknown action")) return true;
  throw new Error("PIN inválido o no autorizado.");
}

function filterOrders(){
  const q = String(el("q")?.value || "").trim().toLowerCase();
  if(!q){
    state.filtered = state.orders.slice();
    return;
  }
  state.filtered = state.orders.filter(o=>{
    const id = String(o.order_id||"").toLowerCase();
    const name = String(o.customer_name||"").toLowerCase();
    return id.includes(q) || name.includes(q);
  });
}

function render(){
  filterOrders();
  const list = el("list");
  const status = el("status");
  const meta = el("meta");
  if(meta) meta.textContent = `${state.filtered.length} pedidos (Pagado + Listo + Pendiente). Actualizado: ${new Date().toLocaleString("es-CO")}`;
  if(status) status.textContent = state.filtered.length ? "" : "No hay pedidos para enviar.";
  if(!list) return;

  list.innerHTML = "";
  for(const o of state.filtered){
    const items = itemsFromOrder(o);
    const sum = summarizeItems(items);
    const card = document.createElement("div");
    card.className = "orderCard";
    card.innerHTML = `
      <div class="orderTop">
        <div style="min-width:0;">
          <div class="orderId">${escapeHtml(o.order_id || "")} <span class="badge ok">Pagado</span> <span class="badge ok">Listo</span></div>
          <div class="metaLine">${escapeHtml(o.customer_name || "")} • ${escapeHtml(fmtDate(o.created_at || ""))}</div>
          <div class="metaLine">Tel: ${escapeHtml(o.phone || "")}</div>
          <div class="metaLine">Dirección: ${escapeHtml(o.address_text || "")}</div>
        </div>
        <div class="badges">
          <span class="badge warn">Pendiente</span>
        </div>
      </div>

      <div class="itemsBox">
        <div class="itemLine">Pedido: ${escapeHtml(sum.short)}</div>
        ${o.notes ? `<div class="metaLine">Notas: ${escapeHtml(o.notes)}</div>` : ""}
      </div>

      <div class="actionsRow">
        <button class="btn secondary" type="button" data-copy="${escapeHtml(o.order_id||"")}">Copiar mensaje</button>
        <button class="btn" type="button" data-send="${escapeHtml(o.order_id||"")}">Enviar</button>
      </div>
    `;
    list.appendChild(card);

    card.querySelector("[data-send]")?.addEventListener("click", ()=> openSendModal(o));
    card.querySelector("[data-copy]")?.addEventListener("click", async ()=>{
      const msg = buildMessage(o);
      await copyToClipboard(msg);
      toastStatus("✅ Mensaje copiado.");
    });
  }
}

function toastStatus(msg){
  const status = el("status");
  if(status) status.textContent = msg || "";
  if(msg){
    setTimeout(()=>{ if(status && status.textContent===msg) status.textContent=""; }, 3200);
  }
}

function openSendModal(order){
  state.activeOrder = order;
  const title = el("sendTitle");
  const sub = el("sendSub");
  const err = el("sendErr");
  if(err) err.textContent = "";
  if(title) title.textContent = "Enviar pedido";
  if(sub) sub.textContent = `${order.order_id || ""} • ${order.customer_name || ""}`;
  if(el("etaMin")) el("etaMin").value = "30";

  // default template random-ish
  if(el("tpl")){
    el("tpl").value = TEMPLATES[Math.floor(Math.random()*TEMPLATES.length)].id;
  }

  updatePreview();
  const ov = el("sendOverlay");
  if(ov){ ov.style.display="flex"; ov.setAttribute("aria-hidden","false"); }
}

function closeSendModal(){
  const ov = el("sendOverlay");
  if(ov){ ov.style.display="none"; ov.setAttribute("aria-hidden","true"); }
  state.activeOrder = null;
}

function buildMessage(order){
  const name = getFirstName(order.customer_name);
  const items = itemsFromOrder(order);
  const sum = summarizeItems(items);
  const minutes = Math.max(1, Number(el("etaMin")?.value || 30) || 30);
  const mode = String(el("mode")?.value || "domicilio");
  const tplId = String(el("tpl")?.value || TEMPLATES[0].id);
  const tpl = TEMPLATES.find(t=>t.id===tplId) || TEMPLATES[0];
  return tpl.build({ name, itemsShort: sum.short, minutes, mode });
}

function updatePreview(){
  const prev = el("msgPreview");
  if(!prev) return;
  if(!state.activeOrder){ prev.textContent=""; return; }
  const msg = buildMessage(state.activeOrder);
  state.lastMessage = msg;
  prev.textContent = msg;
}

async function copyToClipboard(text){
  try{
    await navigator.clipboard.writeText(String(text||""));
    return true;
  }catch{
    // fallback
    const ta = document.createElement("textarea");
    ta.value = String(text||"");
    ta.style.position="fixed";
    ta.style.left="-9999px";
    document.body.appendChild(ta);
    ta.select();
    try{ document.execCommand("copy"); }catch{}
    document.body.removeChild(ta);
    return true;
  }
}

function openWhatsApp(phone, message){
  const p = normalizePhone(phone);
  if(!p) throw new Error("Teléfono no válido.");
  const url = `https://wa.me/${encodeURIComponent(p)}?text=${encodeURIComponent(String(message||""))}`;
  window.open(url, "_blank", "noopener");
}

async function markSentAndOpen(){
  const order = state.activeOrder;
  const err = el("sendErr");
  if(err) err.textContent = "";
  if(!order) return;

  const minutes = Math.max(1, Number(el("etaMin")?.value || 30) || 30);
  const mode = String(el("mode")?.value || "domicilio");
  const msg = buildMessage(order);

  showLoading("Guardando…", "Marcando pedido como En camino…");
  try{
    // 1) marcar en BD
    const out = await apiTry({
      action: "delivery_mark_sent",
      admin_pin: state.session.pin,
      operator: state.session.operatorLabel || state.session.operatorId || "DELIVERY",
      order_id: order.order_id,
      eta_minutes: minutes,
      delivery_mode: mode,
      delivery_status: "En camino",
      message_variant: String(el("tpl")?.value || "")
    });

    if(out.ok !== true){
      // Si aún no instalas el patch de Webhook/Worker, te lo dirá
      throw new Error(out.error || "No se pudo marcar el envío. (¿Habilitaste delivery_mark_sent?)");
    }

    // 2) copiar + abrir WA
    await copyToClipboard(msg);
    openWhatsApp(order.phone, msg);

    // 3) quitar de la lista local
    state.orders = state.orders.filter(x => String(x.order_id) !== String(order.order_id));
    render();
    closeSendModal();
    toastStatus("✅ Pedido marcado y WhatsApp abierto.");
  } catch(e){
    if(err) err.textContent = "❌ " + (e?.message || String(e));
  } finally {
    hideLoading();
  }
}

function isPendingDelivery(order){
  const ps = String(order.payment_status || "").trim().toLowerCase();
  const ks = String(order.kitchen_status || "").trim().toLowerCase();
  const ds = String(order.delivery_status || "").trim().toLowerCase();
  const pending = (!ds || ds === "pendiente");
  return ps === "pagado" && ks === "listo" && pending;
}

async function loadOrders(){
  showLoading("Cargando…", "Buscando pedidos listos para enviar…");
  try{
    // Preferido: endpoint dedicado
    let out = await apiTry({ action: "delivery_list", admin_pin: state.session.pin });

    // fallback: list_orders pagados + filtro en frontend
    if(out.ok !== true && String(out.error||"").toLowerCase().includes("unknown action")){
      out = await apiTry({ action: "list_orders", admin_pin: state.session.pin, payment_status: "Pagado" });
    }
    if(out.ok !== true) throw new Error(out.error || "No se pudieron cargar pedidos.");

    const orders = Array.isArray(out.orders) ? out.orders : [];
    state.orders = orders.filter(isPendingDelivery)
      .sort((a,b)=>(Date.parse(a.created_at||"")||0)-(Date.parse(b.created_at||"")||0));

    render();
  } finally {
    hideLoading();
  }
}

// ===== Events =====
el("btnLogin")?.addEventListener("click", async ()=>{
  const errEl = el("loginErr");
  if(errEl) errEl.textContent = "";
  const pin = String(el("inpPin")?.value || "").trim();
  const operatorId = String(el("selOperator")?.value || "").trim();
  const operatorLabel = state.profiles.find(p=>p.id===operatorId)?.label || "";

  if(!operatorId){ if(errEl) errEl.textContent = "Selecciona un perfil."; return; }
  if(pin.length < 4){ if(errEl) errEl.textContent = "Escribe el PIN."; return; }

  showLoading("Validando…", "Verificando acceso…");
  try{
    await validatePin(pin);
    state.session = { operatorId, operatorLabel, pin };
    saveSession();
    showApp();
    await loadOrders();
  }catch(e){
    clearSession();
    showLogin();
    if(errEl) errEl.textContent = e?.message || String(e);
  }finally{
    hideLoading();
  }
});

el("btnLogoutTop")?.addEventListener("click", ()=>{
  clearSession();
  showLogin();
  loadProfilesOnStart();
});

el("btnRefreshTop")?.addEventListener("click", ()=> loadOrders());

el("q")?.addEventListener("input", ()=> render());

el("btnCloseSend")?.addEventListener("click", closeSendModal);
el("sendOverlay")?.addEventListener("click", (e)=>{ if(e.target === el("sendOverlay")) closeSendModal(); });

el("etaMin")?.addEventListener("input", updatePreview);
el("mode")?.addEventListener("change", updatePreview);
el("tpl")?.addEventListener("change", updatePreview);

el("btnCopy")?.addEventListener("click", async ()=>{
  await copyToClipboard(state.lastMessage || "");
  toastStatus("✅ Copiado.");
});
el("btnOpenWa")?.addEventListener("click", ()=>{
  if(!state.activeOrder) return;
  openWhatsApp(state.activeOrder.phone, state.lastMessage || buildMessage(state.activeOrder));
});
el("btnConfirmSend")?.addEventListener("click", markSentAndOpen);

// ===== Init =====
(async function init(){
  fillTemplates();
  showLogin();
  await loadProfilesOnStart();

  // auto-login
  if(loadSession()){
    el("inpPin").value = state.session.pin || "";
    el("selOperator").value = state.session.operatorId || "";
    // if profiles aren't loaded yet, wait a tick
    showApp();
    await loadOrders();
  }
})();
