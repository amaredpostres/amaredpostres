/* Purchases unified JS v 20260218 (login gate + robust load) */
(() => {
  'use strict';

  const API_BASE = 'https://amared-orders.amaredpostres.workers.dev';
  const STORAGE_KEY = 'AMARED_COSTS_SECRET';

  // --- DOM ---
  const elLoginBack = document.getElementById('loginBack');
  const elLoginSecret = document.getElementById('loginSecret');
  const elBtnLogin = document.getElementById('btnLogin');
  const elLoginMsg = document.getElementById('loginMsg');

  const elApp = document.getElementById('app');
  const elStatus = document.getElementById('status');
  const elRows = document.getElementById('rows');

  const elBtnLogout = document.getElementById('btnLogout');
  const elBtnRecalc = document.getElementById('btnRecalc');
  const elBtnRegister = document.getElementById('btnRegister');

  const elLoadingBack = document.getElementById('loadingBack');
  const elLoadingTitle = document.getElementById('loadingTitle');
  const elLoadingSub = document.getElementById('loadingSub');

  // --- state ---
  let COSTS_SECRET = '';
  let STATE = {
    inventory: {},
    costs: [],
    needs: {},
    meta: null,
  };

  // --- utils ---
  const fmtInt = (n) => {
    const x = Number(n || 0);
    if (!Number.isFinite(x)) return '0';
    return Math.round(x).toLocaleString('es-CO');
  };

  const toNum = (v) => {
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
  };

  function setLoginMsg(msg, isError = false) {
    elLoginMsg.textContent = msg || '';
    elLoginMsg.style.color = isError ? '#ff6b6b' : '';
  }

  function showLoading(title, sub) {
    elLoadingTitle.textContent = title || 'Cargando…';
    elLoadingSub.textContent = sub || '';
    elLoadingBack.hidden = false;
  }

  function hideLoading() {
    elLoadingBack.hidden = true;
  }

  function lock() {
    COSTS_SECRET = '';
    sessionStorage.removeItem(STORAGE_KEY);
    elApp.hidden = true;
    elLoginBack.hidden = false;
    setLoginMsg('');
    elLoginSecret.value = '';
  }

  function unlock() {
    elLoginBack.hidden = true;
    elApp.hidden = false;
  }

  async function fetchWithTimeout(url, opts, timeoutMs = 60000) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...opts, signal: controller.signal });
      return res;
    } finally {
      clearTimeout(t);
    }
  }

  async function api(action, payload = {}, { timeoutMs = 60000, includeSecret = true } = {}) {
    const body = {
      action,
      ...payload,
    };
    if (includeSecret) body.costs_secret = COSTS_SECRET;

    const res = await fetchWithTimeout(API_BASE + '/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, timeoutMs);

    const ct = (res.headers.get('content-type') || '').toLowerCase();
    let data;
    if (ct.includes('application/json')) {
      data = await res.json();
    } else {
      // Si Apps Script devolvió HTML (por error), lo capturamos para debug.
      const txt = await res.text();
      const snippet = txt.slice(0, 220).replace(/\s+/g, ' ').trim();
      const err = new Error('Respuesta no-JSON del servidor');
      err.status = res.status;
      err.snippet = snippet;
      throw err;
    }

    if (!res.ok || data?.ok === false) {
      const err = new Error(data?.error || data?.message || `HTTP ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }

    return data;
  }

  async function validateSecret(secret) {
    // 1) Intento directo (rápido) si el Worker tiene validate_costs_secret.
    COSTS_SECRET = secret;
    try {
      const out = await api('validate_costs_secret', {}, { timeoutMs: 15000, includeSecret: true });
      if (out?.valid === true) return true;
      return false;
    } catch (e) {
      // 2) Fallback: si el action no existe, probamos una llamada real protegida.
      try {
        await api('inventory_get', {}, { timeoutMs: 20000, includeSecret: true });
        return true;
      } catch (e2) {
        // Si es 401, clave inválida
        if ((e2?.status || e?.status) === 401) return false;
        // Otros errores: dejamos que el caller muestre el mensaje
        throw e2;
      }
    }
  }

  function computeCostPerUnitMap(costsRows) {
    // Devuelve { ingredient_key: bestRow }
    const best = {};
    for (const r of (costsRows || [])) {
      const k = (r.ingredient_key || '').trim();
      if (!k) continue;
      const cpu = toNum(r.cop_per_unit);
      if (!best[k] || cpu > toNum(best[k].cop_per_unit)) best[k] = r;
    }
    return best;
  }

  function buildIngredientKeys(inventory, needs, costBest) {
    const s = new Set();
    for (const k of Object.keys(inventory || {})) s.add(k);
    for (const k of Object.keys(needs || {})) s.add(k);
    for (const k of Object.keys(costBest || {})) s.add(k);
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'es'));
  }

  function render() {
    const inv = STATE.inventory || {};
    const needs = STATE.needs || {};
    const costBest = computeCostPerUnitMap(STATE.costs || []);

    const keys = buildIngredientKeys(inv, needs, costBest);

    const meta = STATE.meta;
    if (meta?.window_hours) {
      const used = meta.orders_used ?? 0;
      const total = meta.orders_total ?? 0;
      elStatus.textContent = `Desbloqueado. Pedidos usados: ${used}/${total} · Ventana: ${meta.window_hours}h`;
    } else {
      elStatus.textContent = 'Desbloqueado. Ventana: 36h';
    }

    elRows.innerHTML = '';

    for (const k of keys) {
      const invRow = inv[k] || {};
      const needRow = needs[k] || {};
      const costRow = costBest[k] || {};

      const needQty = toNum(needRow.need_qty);
      const invQty = toNum(invRow.qty);
      const missing = Math.max(0, needQty - invQty);

      const unit = (needRow.unit || invRow.unit || costRow.unit_type || '').toString();
      const cpu = toNum(costRow.cop_per_unit);

      const tr = document.createElement('tr');

      tr.innerHTML = `
        <td>${escapeHtml(k)}</td>
        <td class="num">${needQty ? fmtInt(needQty) : '0'}</td>
        <td class="num">${invQty ? fmtInt(invQty) : '0'}</td>
        <td class="num">${missing ? fmtInt(missing) : '0'}</td>
        <td>${escapeHtml(unit || '—')}</td>
        <td class="num">${cpu ? fmtInt(cpu) : '—'}</td>
        <td class="num"><input class="inp buyQty" inputmode="decimal" placeholder="0" style="text-align:right; max-width:120px;" /></td>
        <td class="num"><input class="chk include" type="checkbox" checked /></td>
      `.trim();

      tr.dataset.ingredientKey = k;
      tr.dataset.unit = unit;
      tr.dataset.cpu = String(cpu || 0);

      // Si falta algo, sugerimos compra = missing
      const buyInp = tr.querySelector('input.buyQty');
      if (missing > 0) buyInp.value = String(Math.round(missing));

      elRows.appendChild(tr);
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  async function loadAll({ recalc = false } = {}) {
    showLoading('Cargando…', 'Leyendo inventario y costos…');

    try {
      // 1) Inventario + costos en paralelo
      const [invRes, costsRes] = await Promise.all([
        api('inventory_get', {}, { timeoutMs: 45000 }),
        api('costs_list', {}, { timeoutMs: 45000 }),
      ]);

      STATE.inventory = invRes.inventory || {};
      STATE.costs = costsRes.items || costsRes.costs || []; // tolerante

      // Render rápido (aunque todavía no tengamos "Necesario")
      render();

      // 2) Necesidades: puede tardar. Si falla, dejamos la UI operativa.
      showLoading('Cargando…', recalc ? 'Recalculando necesidades (últimas 36h)…' : 'Calculando necesidades (últimas 36h)…');

      try {
        const needsRes = await api('costs_orders_for_purchases', {}, { timeoutMs: 110000 });
        STATE.needs = needsRes?.needs || {};
        STATE.meta = needsRes?.meta || null;
        render();
      } catch (eNeeds) {
        console.error('[Purchases] needs calc error:', eNeeds);
        // Mensaje, pero sin bloquear el uso del inventario
        let msg = 'Inventario y costos cargados, pero falló el cálculo de necesidades.';
        if (eNeeds?.name === 'AbortError') msg = 'Inventario y costos cargados. Tiempo de espera agotado calculando necesidades.';
        else if (eNeeds?.snippet) msg = `Inventario y costos cargados. Apps Script devolvió HTML (no JSON) en necesidades: ${eNeeds.snippet}`;
        else if (eNeeds?.message) msg = `Inventario y costos cargados. Error en necesidades: ${eNeeds.message}`;
        elStatus.textContent = msg;
      }
    } catch (e) {
      console.error('[Purchases] loadAll error:', e);

      // Mensaje amigable
      let msg = 'Error al cargar.';
      if (e?.name === 'AbortError') msg = 'Tiempo de espera agotado (API). Revisa el Worker o tu conexión.';
      else if (e?.status === 401) msg = 'No autorizado. Tu clave puede ser inválida o expiró.';
      else if (e?.snippet) msg = `Servidor devolvió HTML (no JSON). Probable error en Apps Script: ${e.snippet}`;
      else if (e?.message) msg = e.message;

      elStatus.textContent = msg;
    } finally {
      hideLoading();
    }
  }

  function collectPurchasesFromUI() {
    const items = [];
    const trs = Array.from(elRows.querySelectorAll('tr'));
    for (const tr of trs) {
      const include = tr.querySelector('input.include')?.checked;
      if (!include) continue;

      const k = tr.dataset.ingredientKey;
      const unit = tr.dataset.unit || '';
      const cpu = toNum(tr.dataset.cpu);
      const qty = toNum(tr.querySelector('input.buyQty')?.value);
      if (!k || qty <= 0) continue;

      items.push({ ingredient_key: k, qty, unit, cop_per_unit: cpu || undefined });
    }
    return items;
  }

  async function registerPurchases() {
    const items = collectPurchasesFromUI();
    if (!items.length) {
      alert('No hay compras para registrar ("Comprar (u)" debe ser > 0).');
      return;
    }

    showLoading('Registrando compras…', 'Actualizando inventario en la base de datos.');
    try {
      // Preferimos batch; si no existe, hacemos fallback item por item.
      try {
        await api('inventory_add_purchase_batch', { items }, { timeoutMs: 110000 });
      } catch (e) {
        if (String(e?.message || '').toLowerCase().includes('unknown') || e?.status === 404) {
          for (const it of items) {
            await api('inventory_add_purchase', it, { timeoutMs: 60000 });
          }
        } else {
          throw e;
        }
      }

      // Recargar inventario
      const invRes = await api('inventory_get', {}, { timeoutMs: 45000 });
      STATE.inventory = invRes.inventory || {};
      render();

      alert('Compras registradas ✅');
    } catch (e) {
      console.error('[Purchases] registerPurchases error:', e);
      let msg = 'Error al registrar compras.';
      if (e?.name === 'AbortError') msg = 'Tiempo de espera agotado (API) registrando compras.';
      else if (e?.status === 401) msg = 'No autorizado (clave inválida o expirada).';
      else if (e?.snippet) msg = `Servidor devolvió HTML (no JSON). Probable error en Apps Script: ${e.snippet}`;
      else if (e?.message) msg = e.message;
      alert(msg);
    } finally {
      hideLoading();
    }
  }

  // --- events ---
  elBtnLogin.addEventListener('click', async () => {
    const secret = (elLoginSecret.value || '').trim();
    if (!secret) {
      setLoginMsg('Ingresa la clave para continuar.', true);
      return;
    }

    elBtnLogin.disabled = true;
    setLoginMsg('Validando clave…');

    try {
      const ok = await validateSecret(secret);
      if (!ok) {
        setLoginMsg('Clave incorrecta.', true);
        return;
      }

      sessionStorage.setItem(STORAGE_KEY, secret);
      unlock();
      await loadAll({ recalc: false });
    } catch (e) {
      console.error('[Purchases] login error:', e);
      let msg = 'No se pudo validar la clave.';
      if (e?.name === 'AbortError') msg = 'Tiempo de espera agotado validando la clave.';
      else if (e?.status === 401) msg = 'Clave incorrecta.';
      else if (e?.snippet) msg = `Servidor devolvió HTML (no JSON). Probable error en Apps Script: ${e.snippet}`;
      else if (e?.message) msg = e.message;
      setLoginMsg(msg, true);
      COSTS_SECRET = '';
    } finally {
      elBtnLogin.disabled = false;
    }
  });

  elLoginSecret.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') elBtnLogin.click();
  });

  elBtnLogout.addEventListener('click', () => {
    lock();
  });

  elBtnRecalc.addEventListener('click', async () => {
    await loadAll({ recalc: true });
  });

  elBtnRegister.addEventListener('click', async () => {
    await registerPurchases();
  });

  // --- boot ---
  (async () => {
    console.log('Purchases unified JS v 20260218');
    const saved = (sessionStorage.getItem(STORAGE_KEY) || '').trim();
    if (!saved) {
      lock();
      return;
    }

    // Si había clave guardada, intentamos validar silenciosamente.
    showLoading('Validando…', 'Comprobando tu clave guardada.');
    try {
      const ok = await validateSecret(saved);
      if (!ok) {
        hideLoading();
        lock();
        setLoginMsg('Clave guardada inválida o expirada. Ingresa la clave nuevamente.', true);
        return;
      }

      unlock();
      await loadAll({ recalc: false });
    } catch (e) {
      console.error('[Purchases] boot validate error:', e);
      lock();
      setLoginMsg('No se pudo validar la clave guardada. Ingresa la clave nuevamente.', true);
    } finally {
      hideLoading();
    }
  })();
})();
