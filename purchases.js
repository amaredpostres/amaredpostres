/* Purchases (full-page login + load after unlock)
   - Validación: se valida COSTS_SECRET llamando a `inventory_get` en el Worker.
   - Luego carga:
     - `costs_public_list` (costos por unidad base)
     - `costs_orders_for_purchases` (necesidades calculadas por pedidos en ventana)
*/

(() => {
  "use strict";

  const API_URL = "https://amared-orders.amaredpostres.workers.dev/";
  const LS_KEY = "AMARED_PURCHASES_COSTS_SECRET";

  // ---------- DOM ----------
  const el = (id) => document.getElementById(id);

  const loginScreen = el("loginScreen");
  const secretInput = el("secretInput");
  const btnEnter = el("btnEnter");
  const btnClear = el("btnClear");
  const loginMsg = el("loginMsg");

  const app = el("app");
  const loadingOverlay = el("loadingOverlay");
  const loadingTitle = el("loadingTitle");
  const loadingSub = el("loadingSub");

  const btnLogout = el("btnLogout");
  const btnReload = el("btnReload");
  const btnSave = el("btnSave");

  const windowHours = el("windowHours");
  const stateLine = el("stateLine");
  const stateHint = el("stateHint");
  const rowsTbody = el("rowsTbody");

  // ---------- State ----------
  let COSTS_SECRET = "";
  let inventoryMap = {}; // key -> { qty, unit }
  let costsMap = {};     // key -> { name, unit_base, cop_per_unit }
  let needsMap = {};     // key -> number
  let lastMeta = null;

  // ---------- Utils ----------
  const fmtNum = (n) => {
    if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
    const v = Number(n);
    const decimals = Math.abs(v - Math.round(v)) < 1e-9 ? 0 : 2;
    return v.toLocaleString("es-CO", { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
  };

  const fmtCOP = (n) => {
    if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
    return Math.round(Number(n)).toLocaleString("es-CO");
  };

  function setLoginMsg(msg, isError = false) {
    loginMsg.textContent = msg || "";
    loginMsg.style.color = isError ? "#fecaca" : "";
  }

  function showLogin() {
    loginScreen.classList.remove("hidden");
    app.classList.add("hidden");
    hideLoading();
    setLoginMsg("");
    setTimeout(() => secretInput?.focus(), 50);
  }

  function showApp() {
    loginScreen.classList.add("hidden");
    app.classList.remove("hidden");
  }

  function showLoading(title = "Cargando…", sub = "Leyendo inventario, costos y necesidades.") {
    loadingTitle.textContent = title;
    loadingSub.textContent = sub;
    loadingOverlay.classList.remove("hidden");
  }

  function hideLoading() {
    loadingOverlay.classList.add("hidden");
  }

  // Robust JSON fetch
  async function api(action, payload = {}, opts = {}) {
    const timeoutMs = Number(opts.timeoutMs || 20000);
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), timeoutMs);

    let res;
    let text = "";
    try {
      res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
        signal: controller.signal,
      });
      text = await res.text();
    } catch (err) {
      if (err && err.name === "AbortError") {
        throw new Error("Tiempo de espera agotado (API). Revisa el Worker o tu conexión.");
      }
      throw err;
    } finally {
      clearTimeout(to);
    }

    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch (_) {
      const preview = (text || "").slice(0, 250).replace(/\s+/g, " ").trim();
      throw new Error(`Respuesta no válida del servidor (HTTP ${res?.status || "?"}): ${preview || "sin contenido"}`);
    }

    if (!res.ok || data.ok === false) {
      const msg = data.error || data.message || `Error HTTP ${res.status}`;
      if (String(msg).toLowerCase().includes("unauthorized")) {
        throw new Error("Clave incorrecta o no autorizada.");
      }
      throw new Error(msg);
    }
    return data;
  }

  // ---------- Rendering ----------
  function buildRows() {
    rowsTbody.innerHTML = "";

    const keys = new Set([
      ...Object.keys(inventoryMap || {}),
      ...Object.keys(costsMap || {}),
      ...Object.keys(needsMap || {}),
    ]);

    const rows = Array.from(keys).map((key) => {
      const inv = inventoryMap?.[key] || { qty: 0, unit: costsMap?.[key]?.unit_base || "g" };
      const cost = costsMap?.[key] || { name: key, unit_base: inv.unit || "g", cop_per_unit: null };
      const need = Number(needsMap?.[key] || 0);
      const invQty = Number(inv.qty || 0);
      const falta = Math.max(need - invQty, 0);

      return {
        key,
        name: cost.name || key,
        need,
        inv: invQty,
        falta,
        unit: inv.unit || cost.unit_base || "g",
        cop: cost.cop_per_unit,
      };
    });

    rows.sort((a, b) => {
      const af = a.falta > 0 ? 0 : 1;
      const bf = b.falta > 0 ? 0 : 1;
      if (af !== bf) return af - bf;
      return String(a.name).localeCompare(String(b.name), "es");
    });

    for (const r of rows) {
      const tr = document.createElement("tr");

      tr.innerHTML = `
        <td><div style="font-weight:800">${escapeHtml(r.name)}</div><div class="muted small">${escapeHtml(r.key)}</div></td>
        <td class="right">${fmtNum(r.need)}</td>
        <td class="right">${fmtNum(r.inv)}</td>
        <td class="right" style="font-weight:800">${fmtNum(r.falta)}</td>
        <td class="center">${escapeHtml(r.unit)}</td>
        <td class="right">${fmtCOP(r.cop)}</td>
        <td class="right">
          <input class="input buyInput" inputmode="decimal" data-key="${escapeHtmlAttr(r.key)}" data-unit="${escapeHtmlAttr(r.unit)}" data-cop="${escapeHtmlAttr(r.cop ?? "")}" placeholder="0" />
        </td>
      `;

      rowsTbody.appendChild(tr);
    }
  }

  function renderState(meta) {
    if (!meta) return;
    const wh = Number(meta.window_hours || 36);
    windowHours.textContent = String(wh);

    const used = Number(meta.orders_used ?? 0);
    const total = Number(meta.orders_total ?? 0);
    stateLine.textContent = `Pedidos usados: ${used}/${total} · Ventana: ${wh}h`;

    const cutoff = meta.cutoff_time ? `Corte: ${meta.cutoff_time}` : "";
    stateHint.textContent = cutoff ? cutoff : "";
  }

  // ---------- Actions ----------
  async function unlockWithSecret(secret) {
    showLoading("Validando…", "Comprobando la clave en el servidor.");
    const invResp = await api("inventory_get", { costs_secret: secret }, { timeoutMs: 25000 });

    COSTS_SECRET = secret;
    localStorage.setItem(LS_KEY, secret);

    inventoryMap = invResp.inventory || {};
  }

  async function loadAll() {
    showLoading("Cargando…", "Leyendo costos y necesidades.");
    try {
      const [costsResp, needsResp] = await Promise.all([
        api("costs_public_list", {}, { timeoutMs: 25000 }),
        api("costs_orders_for_purchases", { costs_secret: COSTS_SECRET }, { timeoutMs: 30000 }),
      ]);

      costsMap = {};
      for (const it of (costsResp.items || [])) {
        if (!it || !it.key) continue;
        costsMap[it.key] = {
          name: it.name || it.key,
          unit_base: it.unit_base || "g",
          cop_per_unit: it.cop_per_unit ?? null,
        };
      }

      needsMap = needsResp.needs || {};
      lastMeta = needsResp.meta || null;

      renderState(lastMeta);
      buildRows();
    } finally {
      hideLoading();
    }
  }

  function collectPurchases() {
    const inputs = Array.from(document.querySelectorAll(".buyInput"));
    const items = [];

    for (const input of inputs) {
      const raw = String(input.value || "").trim().replace(",", ".");
      if (!raw) continue;
      const qty = Number(raw);
      if (!Number.isFinite(qty) || qty <= 0) continue;

      const key = input.getAttribute("data-key");
      const unit = input.getAttribute("data-unit") || "g";
      const cop = input.getAttribute("data-cop");
      const cop_per_unit = cop === "" ? null : Number(cop);

      items.push({
        ingredient_key: key,
        qty,
        unit,
        cop_per_unit: Number.isFinite(cop_per_unit) ? cop_per_unit : null,
      });
    }
    return items;
  }

  async function savePurchases() {
    const items = collectPurchases();
    if (!items.length) {
      alert("No hay compras para registrar.");
      return;
    }

    btnSave.disabled = true;
    showLoading("Registrando…", "Guardando compras en INVENTARIO.");
    try {
      await api("inventory_add_purchase_batch", { costs_secret: COSTS_SECRET, items }, { timeoutMs: 35000 });
      const invResp = await api("inventory_get", { costs_secret: COSTS_SECRET }, { timeoutMs: 25000 });
      inventoryMap = invResp.inventory || {};
      await loadAll();

      for (const input of document.querySelectorAll(".buyInput")) input.value = "";
      alert("Compras registradas ✅");
    } finally {
      hideLoading();
      btnSave.disabled = false;
    }
  }

  function logout() {
    COSTS_SECRET = "";
    localStorage.removeItem(LS_KEY);
    secretInput.value = "";
    showLogin();
  }

  // ---------- Small helpers ----------
  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }
  function escapeHtmlAttr(s){ return escapeHtml(s).replaceAll("`","&#96;"); }

  // ---------- Boot ----------
  async function boot() {
    btnClear.addEventListener("click", () => { secretInput.value = ""; setLoginMsg(""); secretInput.focus(); });
    btnEnter.addEventListener("click", onEnter);
    secretInput.addEventListener("keydown", (e) => { if (e.key === "Enter") onEnter(); });

    btnLogout.addEventListener("click", logout);
    btnReload.addEventListener("click", async () => {
      btnReload.disabled = true;
      try { await loadAll(); } finally { btnReload.disabled = false; }
    });
    btnSave.addEventListener("click", savePurchases);

    const saved = localStorage.getItem(LS_KEY);
    if (saved) {
      secretInput.value = saved;
      try {
        await unlockFlow(saved, { silent: true });
      } catch (_) {
        showLogin();
      }
    } else {
      showLogin();
    }
  }

  async function unlockFlow(secret, opts = {}) {
    const silent = !!opts.silent;
    btnEnter.disabled = true;
    if (!silent) setLoginMsg("Validando clave…");

    try {
      await unlockWithSecret(secret);
      showApp();
      await loadAll();
      setLoginMsg("");
    } catch (err) {
      console.error("[Purchases] unlock error:", err);
      if (silent) throw err;
      setLoginMsg(err.message || "No se pudo validar la clave.", true);
      showLogin();
    } finally {
      btnEnter.disabled = false;
      hideLoading();
    }
  }

  function onEnter() {
    const secret = String(secretInput.value || "").trim();
    if (!secret) { setLoginMsg("Ingresa tu COSTS_SECRET.", true); return; }
    unlockFlow(secret);
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
