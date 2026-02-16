// ===============================
// AMARED · purchases.js (Compras desde PEDIDOS)
// Requiere: amared.core.js cargado antes
// ===============================
console.log('[AMARED] purchases.js cargado: STABLE');

(function(){
  // ---------- DOM refs ----------
  function el(id){ return document.getElementById(id); }

  // ---------- Unlock (valida clave) ----------
  async function unlock_(){
    const inp = el('secret');
    const val = (inp ? inp.value : '').trim();
    if(!val) return showToast('Ingresa la clave', 'err');

    showLoading('Validando...', 'Verificando acceso');
    try{
      // Ping barato: costs_list (si tu backend lo soporta) o test.
      const r = await api({ action: 'costs_list', costs_secret: val });
      if(!r || !r.ok) throw new Error(r?.error || 'Clave inválida');
      UNLOCKED_SECRET = val;
      // UI
      const wrap = el('buyWrapper');
      if(wrap) wrap.style.display = 'block';
      const gate = el('gate');
      if(gate) gate.classList.add('unlocked');
      showToast('Desbloqueado', 'ok');
    }catch(e){
      showToast(e.message || 'Error al validar', 'err');
    }finally{
      hideLoading();
    }
  }

  // ---------- Cargar necesidades desde pedidos ----------
  async function refreshFromOrders_(){
    try{
      if(!UNLOCKED_SECRET) throw new Error('Primero debes Desbloquear con la clave');

      showLoading('Actualizando...', 'Leyendo pedidos y calculando ingredientes');

      // IMPORTANTE: Esta action debe existir en tu backend (Worker/Apps Script)
      // En tu flujo actual, la lógica se estaba intentando hacer en frontend.
      // Si tu Worker ya expone una acción existente, cambia este nombre.
      // Opción A (más segura): que el servidor devuelva needs ya calculados.
      // Opción B (actual): que servidor devuelva pedidos + recetas + inventario.

      const r = await api({ action: 'costs_orders_for_purchases', costs_secret: UNLOCKED_SECRET });
      if(!r || !r.ok) throw new Error(r?.error || 'No se pudo calcular');

      // Aceptamos dos formatos:
      // 1) r.data = [{ingredient, needed, in_stock, missing, unit, cost_per_unit}, ...]
      // 2) r.needs = ...
      const list = Array.isArray(r.data) ? r.data : (Array.isArray(r.needs) ? r.needs : []);
      renderNeeds_(list);

      showToast('Actualizado', 'ok');
    }catch(e){
      console.error(e);
      showToast(e.message || 'Error', 'err');
    }finally{
      hideLoading();
    }
  }

  // ---------- Render ----------
  function num(v){
    const n = Number(v);
    return isFinite(n) ? n : 0;
  }

  function renderNeeds_(list){
    const tbody = el('buyTbody');
    const countEl = el('buyCount');
    const totalEl = el('buyTotal');
    if(!tbody) return;

    // Normaliza
    const rows = (Array.isArray(list) ? list : []).map(x => ({
      ingredient: String(x.ingredient || x.name || '').trim(),
      needed: num(x.needed),
      in_stock: num(x.in_stock ?? x.stock ?? x.sobrante ?? 0),
      missing: num(x.missing ?? x.to_buy ?? 0),
      unit: String(x.unit || ''),
      cost_est: num(x.cost_est || x.estimated_cost || 0)
    })).filter(r => r.ingredient);

    tbody.innerHTML = '';

    let needCount = 0;
    let total = 0;

    rows.forEach((r, idx) => {
      const toBuy = r.missing > 0;
      if(toBuy) needCount++;
      total += (toBuy ? r.cost_est : 0);

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="ingCell">
          <div class="ingName">${escapeHtml_(r.ingredient)}</div>
          <div class="ingMeta">${escapeHtml_(r.unit || '')}</div>
        </td>
        <td><input class="inp" type="number" min="0" step="any" value="${r.needed}" data-k="needed" data-i="${idx}" disabled></td>
        <td><input class="inp" type="number" min="0" step="any" value="${r.in_stock}" data-k="stock" data-i="${idx}"></td>
        <td class="buyCell"><div class="buyVal">${toBuy ? r.missing : 0}</div></td>
        <td class="costCell">$${Math.round(r.cost_est).toLocaleString('es-CO')}</td>
        <td class="actCell">
          <label class="chkLbl">
            <input type="checkbox" class="chk" data-i="${idx}" ${toBuy ? '' : 'disabled'}>
            <span>Comprado</span>
          </label>
          <button class="btnMini" type="button" data-act="edit" data-i="${idx}">Editar</button>
          <button class="btnMini danger" type="button" data-act="reset" data-i="${idx}">Reiniciar sobrante</button>
        </td>
      `;
      tbody.appendChild(tr);

      // handlers
      tr.querySelector('[data-act="edit"]').addEventListener('click', () => openEdit_(r));
      tr.querySelector('[data-act="reset"]').addEventListener('click', () => resetSobrante_(r));
      tr.querySelector('.chk').addEventListener('change', (ev) => {
        if(ev.target.checked) registerPurchase_(r);
      });
    });

    if(countEl) countEl.textContent = String(needCount);
    if(totalEl) totalEl.textContent = '$' + Math.round(total).toLocaleString('es-CO');
  }

  // ---------- Acciones ----------
  async function registerPurchase_(row){
    // Esta acción debe existir en backend. Ajusta si tu Worker usa otro nombre.
    try{
      showLoading('Registrando...', row.ingredient);
      const payload = {
        action: 'inventory_add_purchase',
        costs_secret: UNLOCKED_SECRET,
        ingredient_key: row.ingredient,
        qty: Math.max(0, row.missing),
        unit: row.unit || ''
      };
      const r = await api(payload);
      if(!r || !r.ok) throw new Error(r?.error || 'No se pudo registrar');
      showToast('Compra registrada: ' + row.ingredient, 'ok');
      // refresca
      await refreshFromOrders_();
    }catch(e){
      showToast(e.message || 'Error registrando compra', 'err');
    }finally{
      hideLoading();
    }
  }

  function openEdit_(row){
    // Modal simple: reusa prompt para no romper tu UI actual.
    // Si quieres, lo cambiamos luego por un modal bonito.
    const qtyPack = prompt(`Nueva cantidad de presentación para: ${row.ingredient} (ej: 1000)`, '');
    if(qtyPack === null) return;
    const pricePack = prompt(`Nuevo precio del paquete para: ${row.ingredient} (COP)`, '');
    if(pricePack === null) return;

    saveCostUpdate_(row.ingredient, qtyPack, pricePack, row.unit || '');
  }

  async function saveCostUpdate_(ingredient, packQty, packPrice, unit){
    try{
      showLoading('Guardando...', ingredient);
      const r = await api({
        action: 'costs_upsert',
        costs_secret: UNLOCKED_SECRET,
        item: {
          ingredient,
          unit,
          pack_qty: Number(packQty),
          pack_price: Number(packPrice)
        }
      });
      if(!r || !r.ok) throw new Error(r?.error || 'No se pudo actualizar costos');
      showToast('Costos actualizados: ' + ingredient, 'ok');
      await refreshFromOrders_();
    }catch(e){
      showToast(e.message || 'Error', 'err');
    }finally{
      hideLoading();
    }
  }

  async function resetSobrante_(row){
    // Resetea SOBRANTE de un ingrediente en inventario (set 0)
    try{
      if(!confirm('¿Reiniciar sobrante de ' + row.ingredient + '?')) return;
      showLoading('Reiniciando...', row.ingredient);
      const r = await api({
        action: 'inventory_set',
        costs_secret: UNLOCKED_SECRET,
        ingredient_key: row.ingredient,
        qty: 0,
        unit: row.unit || ''
      });
      if(!r || !r.ok) throw new Error(r?.error || 'No se pudo reiniciar');
      showToast('Sobrante reiniciado', 'ok');
      await refreshFromOrders_();
    }catch(e){
      showToast(e.message || 'Error', 'err');
    }finally{
      hideLoading();
    }
  }

  // ---------- Utils ----------
  function escapeHtml_(s){
    return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  }

  // ---------- Bind UI ----------
  document.addEventListener('DOMContentLoaded', () => {
    const bUnlock = el('unlockBtn');
    const bRefresh = el('buyRefresh');
    if(bUnlock) bUnlock.addEventListener('click', unlock_);
    if(bRefresh) bRefresh.addEventListener('click', refreshFromOrders_);
  });

  // expose
  globalThis.amaredRefreshOrders = refreshFromOrders_;
})();
