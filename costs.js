/* AMARED - Costs (Ingredientes + Compras/Sobrantes) - v6
   Fixes:
   - getNeedList() not defined
   - showToast() not defined
   - Robust shopping_get / shopping_save integration (COMPRAS_NEED)
   Notes:
   - Requires Worker to allow: costs_validate / costs_list / costs_upsert (existing) AND shopping_get / shopping_save.
   - Costs page uses COSTS_SECRET to unlock; after unlock it loads ingredients costs AND shopping needs.
*/

(() => {
  'use strict';

  // ---------- Config ----------
  const WORKER_URL = window.WORKER_URL || (typeof WORKER_URL !== 'undefined' ? WORKER_URL : '');
  // Some builds expose WORKER_URL via inline script; fallback to same origin is NOT desired here.
  // If empty, we will try to detect from existing scripts.
  const DEFAULT_WORKER_URL = 'https://amared-orders.amaredpostres.workers.dev/';
  const API_URL = (WORKER_URL && String(WORKER_URL).trim()) || DEFAULT_WORKER_URL;

  // ---------- State ----------
  const state = {
    unlocked: false,
    costsSecret: '',
    // ingredient catalog from Costos_Ingredientes
    ingredients: [], // normalized rows
    // shopping data from COMPRAS_NEED (server)
    shopping: {
      sentAt: null,
      needs: {},     // { key: qty }
      leftovers: {}, // { key: qty }
      meta: {}       // any extra
    }
  };

  // ---------- DOM helpers ----------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function safeText(s) {
    return (s == null) ? '' : String(s);
  }

  function fmtMoney(n) {
    const x = Number(n || 0);
    try {
      return x.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
    } catch {
      return '$' + Math.round(x).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    }
  }

  function fmtDateTime(isoOrMs) {
    if (!isoOrMs) return '';
    const d = (typeof isoOrMs === 'number') ? new Date(isoOrMs) : new Date(String(isoOrMs));
    if (isNaN(d.getTime())) return safeText(isoOrMs);
    try {
      return d.toLocaleString('es-CO', { timeZone: 'America/Bogota' });
    } catch {
      return d.toLocaleString();
    }
  }

  // ---------- UI: Loading + Toast ----------
  function setLoading(on, msg = 'Cargando...', sub = 'Por favor espera.') {
    const overlay = $('#loadingOverlay');
    if (!overlay) return;
    overlay.style.display = on ? 'flex' : 'none';
    const t = overlay.querySelector('.loadingTitle');
    const s = overlay.querySelector('.loadingSub');
    if (t) t.textContent = msg;
    if (s) s.textContent = sub;
  }

  function showToast(message, type = 'info', ms = 2200) {
    let host = $('#toastHost');
    if (!host) {
      host = document.createElement('div');
      host.id = 'toastHost';
      host.style.position = 'fixed';
      host.style.left = '50%';
      host.style.bottom = '18px';
      host.style.transform = 'translateX(-50%)';
      host.style.zIndex = '99999';
      host.style.display = 'flex';
      host.style.flexDirection = 'column';
      host.style.gap = '8px';
      document.body.appendChild(host);
    }
    const el = document.createElement('div');
    el.className = 'toast';
    el.style.minWidth = '240px';
    el.style.maxWidth = '90vw';
    el.style.padding = '12px 14px';
    el.style.borderRadius = '14px';
    el.style.boxShadow = '0 8px 24px rgba(0,0,0,.12)';
    el.style.background = (type === 'error') ? '#ffe3e3' : (type === 'success') ? '#e3ffe9' : '#fff';
    el.style.color = '#3b2a22';
    el.style.border = '1px solid rgba(0,0,0,.06)';
    el.textContent = message;
    host.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity .25s ease';
      setTimeout(() => el.remove(), 260);
    }, ms);
  }

  // ---------- API ----------
  async function api(payload) {
    if (!API_URL) throw new Error('WORKER_URL no configurado');
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { ok: false, raw: text }; }
    if (!res.ok || data.ok === false) {
      const msg = data && (data.error || data.message) ? (data.error || data.message) : `HTTP ${res.status}`;
      const err = new Error(msg);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  // ---------- Normalizers ----------
  function normKey(s) {
    return safeText(s).trim().toLowerCase();
  }

  // costs ingredient row -> { key, name, unit, unit_cost, ... }
  function normalizeCostRow(row) {
    // Accept different shapes; we’ve seen Apps Script returning arrays or objects.
    if (Array.isArray(row)) {
      // Try common order: name, unit, unit_cost
      const name = safeText(row[0]);
      const unit = safeText(row[1]);
      const unitCost = Number(row[2] || 0);
      return { key: normKey(name), name, unit, unit_cost: unitCost, raw: row };
    }
    const name = safeText(row.name || row.ingredient || row.label || row.item);
    const unit = safeText(row.unit || row.unidad || row.uom);
    const unitCost = Number(row.unit_cost ?? row.unitCost ?? row.price ?? row.costo ?? 0);
    return { key: normKey(name), name, unit, unit_cost: unitCost, raw: row };
  }

  // ---------- Shopping helpers (FIX for getNeedList) ----------
  function getNeedList(shoppingObj) {
    // returns array of { key, needed, leftover, toBuy, unitCost, unitLabel, name }
    const needs = (shoppingObj && shoppingObj.needs) ? shoppingObj.needs : {};
    const leftovers = (shoppingObj && shoppingObj.leftovers) ? shoppingObj.leftovers : {};

    // Use ingredient catalog for names + unit costs
    const byKey = new Map(state.ingredients.map(r => [r.key, r]));
    const allKeys = new Set([
      ...Object.keys(needs || {}),
      ...Object.keys(leftovers || {})
    ]);

    const out = [];
    for (const k of allKeys) {
      const needed = Number(needs[k] || 0);
      const leftover = Number(leftovers[k] || 0);
      const toBuy = Math.max(0, needed - leftover);
      const meta = byKey.get(k);
      const name = meta ? meta.name : k;
      const unitCost = meta ? Number(meta.unit_cost || 0) : 0;
      const unitLabel = meta ? safeText(meta.unit || '') : '';
      out.push({ key: k, name, needed, leftover, toBuy, unitCost, unitLabel });
    }
    // Sort: first those with toBuy > 0, then by name
    out.sort((a, b) => {
      const ap = a.toBuy > 0 ? 0 : 1;
      const bp = b.toBuy > 0 ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return a.name.localeCompare(b.name, 'es');
    });
    return out;
  }

  // ---------- Rendering ----------
  function renderShopping() {
    const sentAtEl = $('#buySentAt');
    if (sentAtEl) {
      const txt = state.shopping.sentAt ? `Enviado desde cocina: ${fmtDateTime(state.shopping.sentAt)}` : 'Sin importación desde cocina.';
      sentAtEl.textContent = txt;
    }

    const list = getNeedList(state.shopping);
    const tbody = $('#buyTableBody');
    if (!tbody) return;

    tbody.innerHTML = '';
    let needCount = 0;
    let total = 0;

    for (const r of list) {
      if (r.needed > 0) needCount += 1;
      const est = r.toBuy * r.unitCost;
      total += est;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <div class="buyIngName">${safeText(r.name)}</div>
          <div class="buyIngMeta">${safeText(r.unitLabel)} · ${r.unitCost ? (fmtMoney(r.unitCost) + '/u') : 'sin costo/u'}</div>
        </td>
        <td><input class="buyInp buyNeed" data-k="${r.key}" type="number" step="0.01" min="0" value="${r.needed}"></td>
        <td><input class="buyInp buyLeft" data-k="${r.key}" type="number" step="0.01" min="0" value="${r.leftover}"></td>
        <td class="buyToBuy" data-k="${r.key}">${r.toBuy}</td>
        <td class="buyEst" data-k="${r.key}">${fmtMoney(est)}</td>
      `;
      tbody.appendChild(tr);
    }

    const chipsNeed = $('#buyNeedCount');
    const chipsTotal = $('#buyTotalEst');
    if (chipsNeed) chipsNeed.textContent = `Ingredientes con necesidad: ${needCount}`;
    if (chipsTotal) chipsTotal.textContent = `Total compra estimada: ${fmtMoney(total)}`;

    // Wire inputs to recalc
    $$('.buyNeed, .buyLeft').forEach(inp => {
      inp.oninput = () => {
        const k = inp.getAttribute('data-k');
        const needInp = tbody.querySelector(`.buyNeed[data-k="${CSS.escape(k)}"]`);
        const leftInp = tbody.querySelector(`.buyLeft[data-k="${CSS.escape(k)}"]`);
        const need = Number(needInp?.value || 0);
        const left = Number(leftInp?.value || 0);
        state.shopping.needs[k] = need;
        state.shopping.leftovers[k] = left;
        // update row derived
        const toBuy = Math.max(0, need - left);
        const meta = state.ingredients.find(x => x.key === k);
        const unitCost = meta ? Number(meta.unit_cost || 0) : 0;
        const est = toBuy * unitCost;

        const toEl = tbody.querySelector(`.buyToBuy[data-k="${CSS.escape(k)}"]`);
        const estEl = tbody.querySelector(`.buyEst[data-k="${CSS.escape(k)}"]`);
        if (toEl) toEl.textContent = String(toBuy);
        if (estEl) estEl.textContent = fmtMoney(est);

        // update totals
        renderShoppingTotalsOnly();
      };
    });
  }

  function renderShoppingTotalsOnly() {
    const list = getNeedList(state.shopping);
    let needCount = 0;
    let total = 0;
    for (const r of list) {
      if (r.needed > 0) needCount += 1;
      total += (r.toBuy * r.unitCost);
    }
    const chipsNeed = $('#buyNeedCount');
    const chipsTotal = $('#buyTotalEst');
    if (chipsNeed) chipsNeed.textContent = `Ingredientes con necesidad: ${needCount}`;
    if (chipsTotal) chipsTotal.textContent = `Total compra estimada: ${fmtMoney(total)}`;
  }

  // ---------- Loaders ----------
  async function validateAndUnlock() {
    const inp = $('#costsKey');
    const key = safeText(inp?.value).trim();
    if (!key) { showToast('Ingresa la clave de costos.', 'error'); return; }

    setLoading(true, 'Validando...', 'Revisando la clave en el servidor.');
    try {
      // Worker validates COSTS_SECRET; action name may be costs_validate or validate_costs depending on your worker.
      // We try both.
      try {
        await api({ action: 'costs_validate', costs_secret: key });
      } catch (e1) {
        await api({ action: 'validate_costs', costs_secret: key });
      }

      state.unlocked = true;
      state.costsSecret = key;
      localStorage.setItem('amared_costs_secret', key);

      // Toggle UI
      const locked = $('#lockedBlock');
      const unlocked = $('#unlockedBlock');
      if (locked) locked.style.display = 'none';
      if (unlocked) unlocked.style.display = 'block';

      showToast('Desbloqueado.', 'success');
      await loadAllAfterUnlock();
    } catch (err) {
      console.error('unlock error', err);
      showToast(err.message || 'Clave incorrecta o no autorizada.', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function loadCostsIngredients() {
    // Load ingredient cost table
    // Worker action could be costs_list or costs_ingredients_list; we try both.
    const key = state.costsSecret;
    let data;
    try {
      data = await api({ action: 'costs_list', costs_secret: key, sheet: 'COSTOS_INGREDIENTES' });
    } catch (e1) {
      data = await api({ action: 'costs_ingredients_list', costs_secret: key });
    }
    const rows = data.items || data.rows || data.data || [];
    state.ingredients = rows.map(normalizeCostRow).filter(r => r.key);

    // This page already renders ingredients elsewhere; we won't override existing UI for ingredient accordions.
    // But we DO need ingredient catalog for shopping costs.
  }

  async function shoppingGet() {
    // read from COMPRAS_NEED
    // Note: This must be allowed by worker without extra secrets? We use costs_secret for admin-like access.
    const key = state.costsSecret;
    let data;
    try {
      data = await api({ action: 'shopping_get', costs_secret: key });
    } catch (e1) {
      // some workers require admin_pin for shopping; try that if stored
      const pin = localStorage.getItem('amared_admin_pin') || '';
      data = await api({ action: 'shopping_get', costs_secret: key, admin_pin: pin });
    }
    const payload = data.shopping || data.data || data.payload || {};
    state.shopping.sentAt = payload.sent_at || payload.created_at || data.sent_at || data.created_at || null;
    state.shopping.needs = payload.needs || payload.need || payload.necesario || payload.needs_map || {};
    state.shopping.leftovers = payload.leftovers || payload.sobrantes || payload.left || {};
    state.shopping.meta = payload.meta || {};
  }

  async function shoppingSave() {
    const key = state.costsSecret;
    const payload = {
      sent_at: state.shopping.sentAt || new Date().toISOString(),
      needs: state.shopping.needs || {},
      leftovers: state.shopping.leftovers || {},
      meta: state.shopping.meta || {}
    };
    // Persist to COMPRAS_NEED (and maybe COMPRAS_SOBRANTES) through Apps Script
    // Worker action: shopping_save
    await api({ action: 'shopping_save', costs_secret: key, shopping: payload });
  }

  async function loadAllAfterUnlock() {
    setLoading(true, 'Cargando...', 'Preparando ingredientes y compras.');
    try {
      await loadCostsIngredients();
      await loadNeedsFromServerAndRender_(); // render shopping
    } finally {
      setLoading(false);
    }
  }

  // FIX function name referenced in console: loadNeedsFromServerAndRender_
  async function loadNeedsFromServerAndRender_() {
    try {
      await shoppingGet();
      renderShopping();
    } catch (err) {
      console.error('loadNeedsFromServerAndRender_ error', err);
      showToast(err.message || 'No se pudo cargar compras desde cocina.', 'error');
      // still render with current state (maybe empty)
      renderShopping();
    }
  }

  // ---------- Button actions ----------
  async function onImportFromKitchen() {
    setLoading(true, 'Importando...', 'Leyendo la última importación desde cocina.');
    try {
      await loadNeedsFromServerAndRender_();
      showToast('Importación actualizada.', 'success');
    } catch (err) {
      console.error('import buy error', err);
      showToast(err.message || 'Error importando desde cocina.', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function onSaveLeftovers() {
    setLoading(true, 'Guardando...', 'Actualizando sobrantes en la base de datos.');
    try {
      await shoppingSave();
      showToast('Sobrantes guardados.', 'success');
    } catch (err) {
      console.error('save leftovers error', err);
      showToast(err.message || 'No se pudo guardar.', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function onResetLeftovers() {
    // Reset leftovers to 0 but keep needs
    const ok = confirm('¿Reiniciar sobrantes a 0?');
    if (!ok) return;
    for (const k of Object.keys(state.shopping.leftovers || {})) state.shopping.leftovers[k] = 0;
    renderShopping();
    await onSaveLeftovers();
  }

  // ---------- Wiring ----------
  function init() {
    // Bind unlock
    const btn = $('#btnUnlock');
    if (btn) btn.onclick = validateAndUnlock;

    // Pre-fill stored secret (optional)
    const stored = localStorage.getItem('amared_costs_secret');
    const inp = $('#costsKey');
    if (inp && stored) inp.value = stored;

    // Bind shopping buttons
    const importBtn = $('#buyImport');
    if (importBtn) importBtn.onclick = onImportFromKitchen;

    const saveBtn = $('#buySaveLeftovers');
    if (saveBtn) saveBtn.onclick = onSaveLeftovers;

    const resetBtn = $('#buyResetLeftovers');
    if (resetBtn) resetBtn.onclick = onResetLeftovers;

    // If already unlocked from previous session (optional)
    // We keep it locked by default; user must press unlock.
  }

  document.addEventListener('DOMContentLoaded', init);

})();
