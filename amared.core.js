// ===============================
// AMARED · core.js (compartido)
// - NO asume elementos específicos (safe for any page)
// - Evita redeclaraciones (API_URL, api, normDateOnly_)
// ===============================

(function(){
  // --- API URL (no redeclare) ---
  if (typeof globalThis.API_URL !== 'string' || !globalThis.API_URL) {
    // ⚠️ Cambia esto si tu Worker tiene otra URL
    globalThis.API_URL = globalThis.API_URL || 'https://amared-orders.amaredpostres.workers.dev/';
  }

  // --- Fecha YYYY-MM-DD (binding real) ---
  if (typeof globalThis.normDateOnly_ !== 'function') {
    globalThis.normDateOnly_ = function(d){
      try{
        const dt = (d instanceof Date) ? d : new Date(d);
        if (isNaN(dt)) return '';
        const y = dt.getFullYear();
        const m = String(dt.getMonth()+1).padStart(2,'0');
        const day = String(dt.getDate()).padStart(2,'0');
        return `${y}-${m}-${day}`;
      }catch(_e){ return ''; }
    };
  }
  // También crear binding local si algún script lo usa directamente
  if (typeof normDateOnly_ !== 'function') {
    // eslint-disable-next-line no-var
    var normDateOnly_ = globalThis.normDateOnly_;
  }

  // --- API helper ---
  if (typeof globalThis.api !== 'function') {
    globalThis.api = async function(payload){
      const res = await fetch(globalThis.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {})
      });
      const txt = await res.text();
      let json;
      try{ json = JSON.parse(txt); }
      catch(e){ throw new Error('Respuesta no-JSON del servidor'); }
      return json;
    };
  }

  // --- UI helpers (opcionales) ---
  if (typeof globalThis.showLoading !== 'function') {
    globalThis.showLoading = function(title, desc){
      const box = document.getElementById('loading');
      if(!box) return;
      box.style.display = 'flex';
      const lt = document.getElementById('lt');
      const ld = document.getElementById('ld');
      if(lt && title) lt.textContent = title;
      if(ld && desc) ld.textContent = desc;
    };
  }
  if (typeof globalThis.hideLoading !== 'function') {
    globalThis.hideLoading = function(){
      const box = document.getElementById('loading');
      if(box) box.style.display = 'none';
    };
  }
  if (typeof globalThis.showToast !== 'function') {
    globalThis.showToast = function(msg, type){
      // fallback simple
      try{ console[type==='err'?'error':'log']('[AMARED]', msg); }catch(_e){}
      const t = document.getElementById('toast');
      if(!t){
        if(type==='err') alert(msg);
        return;
      }
      t.textContent = msg;
      t.className = 'toast ' + (type||'');
      t.style.display = 'block';
      clearTimeout(globalThis.__toastTimer);
      globalThis.__toastTimer = setTimeout(()=>{ t.style.display='none'; }, 2800);
    };
  }

  // --- sesión (clave desbloqueada) ---
  if (typeof globalThis.UNLOCKED_SECRET !== 'string') {
    globalThis.UNLOCKED_SECRET = '';
  }
})();
