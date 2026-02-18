// Purchases (unified login + app) v20260218190526
console.log("Purchases unified JS v", "20260218190526");

const WORKER_URL = "https://amared-orders.amaredpostres.workers.dev/";
const LS_COSTS_SECRET = "amared_costs_secret_v1";

let COSTS_SECRET = localStorage.getItem(LS_COSTS_SECRET) || "";

function $(id) { return document.getElementById(id); }

function show(el, on) {
  if (!el) return;
  el.hidden = !on;
}

function showLoading(on) {
  show($("loadingBack"), !!on);
}

function setLoginMsg(t) {
  const el = $("loginMsg");
  if (el) el.textContent = t || "";
}

function setMeta(t) {
  const el = $("metaText");
  if (el) el.textContent = t || "";
}

async function api(payload, timeoutMs = 120000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal
    });

    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch(_) {}

    if (!r.ok) {
      const err = (json && json.error) ? json.error : text;
      throw new Error(String(err).slice(0, 400));
    }
    return json ?? { ok: true };
  } catch (e) {
    if (e && e.name === "AbortError") {
      throw new Error("Tiempo de espera agotado (API). Revisa el Worker o tu conexión.");
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}

async function validateSecret(secret) {
  // Requiere que el Worker tenga el action: validate_costs_secret
  const r = await api({ action: "validate_costs_secret", costs_secret: secret }, 15000);
  return !!(r && r.valid === true);
}

function fmt(n) {
  const x = Number(n);
  if (!isFinite(x)) return "0";
  return x.toLocaleString("es-CO");
}

function buildCostMap(costItems) {
  const map = new Map();
  (costItems || []).forEach(it => {
    const key = String(it.ingredient || it.nombre || it.name || "").trim().toLowerCase();
    if (!key) return;
    const u = String(it.unit || it.unidad || "").trim().toLowerCase();
    const cpu = Number(it.cost_per_unit ?? it.costo_por_unidad ?? it.costo ?? it.cost ?? 0);
    map.set(key, { unit: u, cost_per_unit: cpu });
  });
  return map;
}

function renderRows(rows, costMap) {
  const tbody = document.querySelector("#tbl tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  (rows || []).forEach(r => {
    const name = r.ingredient || r.ingrediente || r.nombre || "";
    const need = Number(r.needed ?? r.necesario ?? 0);
    const inv  = Number(r.inventory ?? r.inventario ?? 0);
    const lack = Math.max(0, need - inv);
    const unit = r.unit || r.unidad || (costMap.get(String(name).toLowerCase())?.unit || "");
    const cpu  = costMap.get(String(name).toLowerCase())?.cost_per_unit;

    const tr = document.createElement("tr");
    const safeName = String(name).replace(/"/g, "&quot;");

    tr.innerHTML = [
      "<td>", name, "</td>",
      "<td class=\"num\">", fmt(need), "</td>",
      "<td class=\"num\">", fmt(inv), "</td>",
      "<td class=\"num\">", fmt(lack), "</td>",
      "<td>", (unit || ""), "</td>",
      "<td class=\"num\">", (cpu != null && isFinite(cpu)) ? fmt(cpu) : "—", "</td>",
      "<td class=\"num\"><input class=\"inpNum\" data-ingredient=\"", safeName, "\" value=\"0\" inputmode=\"decimal\" /></td>"
    ].join("");

    tbody.appendChild(tr);
  });
}

async function loadAll() {
  showLoading(true);
  try {
    const c = await api({ action: "costs_public_list" }, 120000);
    const costMap = buildCostMap(c.items || []);

    const need = await api({ action: "costs_orders_for_purchases", costs_secret: COSTS_SECRET }, 120000);
    const inv = await api({ action: "inventory_get", costs_secret: COSTS_SECRET }, 120000);

    const items = (need.items || need.rows || []);
    const invMap = new Map();
    (inv.items || []).forEach(it => {
      const k = String(it.ingredient || it.ingrediente || it.nombre || "").trim().toLowerCase();
      invMap.set(k, Number(it.qty ?? it.cantidad ?? it.amount ?? 0));
    });

    const merged = items.map(it => {
      const ing = it.ingredient || it.ingrediente || it.nombre || "";
      const k = String(ing).trim().toLowerCase();
      return {
        ingredient: ing,
        needed: Number(it.needed ?? it.necesario ?? it.total ?? 0),
        inventory: invMap.get(k) ?? 0,
        unit: it.unit || it.unidad || ""
      };
    });

    renderRows(merged, costMap);

    const used = need.meta && need.meta.orders_used != null ? need.meta.orders_used : 0;
    const total = need.meta && need.meta.orders_total != null ? need.meta.orders_total : 0;
    const win = need.meta && need.meta.window_hours != null ? need.meta.window_hours : 36;
    setMeta(`Desbloqueado. Pedidos usados: ${used}/${total} · Ventana: ${win}h`);
  } catch (e) {
    console.error("[purchases] loadAll error", e);
    setMeta("Error cargando cálculo: " + (e && e.message ? e.message : String(e)));
  } finally {
    showLoading(false);
  }
}

async function registerPurchases() {
  const inputs = Array.from(document.querySelectorAll("input[data-ingredient]"));
  const lines = inputs.map(inp => {
    const ing = inp.getAttribute("data-ingredient");
    const qty = Number(String(inp.value || "0").replace(",", "."));
    return { ingredient: ing, qty: isFinite(qty) ? qty : 0 };
  }).filter(x => x.qty > 0);

  if (lines.length === 0) {
    alert("No hay compras para registrar.");
    return;
  }

  showLoading(true);
  try {
    const r = await api({ action: "inventory_add_purchase_batch", costs_secret: COSTS_SECRET, items: lines }, 120000);
    if (r && r.ok === false) throw new Error(r.error || "No se pudo registrar.");
    await loadAll();
    alert("Compras registradas.");
  } catch (e) {
    alert(e && e.message ? e.message : "Error registrando compras.");
  } finally {
    showLoading(false);
  }
}

function setUnlockedUI(on) {
  show($("loginBack"), !on);
  show($("appView"), !!on);
  show($("appActions"), !!on);
}

async function doLogin() {
  const s = String($("inpSecret").value || "").trim();
  if (!s) {
    setLoginMsg("Ingresa la clave.");
    return;
  }

  const btn = $("btnLogin");
  btn.disabled = true;
  setLoginMsg("");
  showLoading(true);

  try {
    const ok = await validateSecret(s);
    if (!ok) {
      setLoginMsg("Clave incorrecta.");
      return;
    }
    COSTS_SECRET = s;
    localStorage.setItem(LS_COSTS_SECRET, s);
    setUnlockedUI(true);
    await loadAll();
  } catch (e) {
    setLoginMsg(e && e.message ? e.message : "No se pudo validar la clave.");
  } finally {
    showLoading(false);
    btn.disabled = false;
  }
}

function logout() {
  localStorage.removeItem(LS_COSTS_SECRET);
  COSTS_SECRET = "";
  // limpiar inputs de compra
  document.querySelectorAll("input[data-ingredient]").forEach(i => i.value = "0");
  setMeta("—");
  setUnlockedUI(false);
}

function init() {
  $("btnLogin")?.addEventListener("click", doLogin);
  $("inpSecret")?.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") doLogin();
  });

  $("btnReload")?.addEventListener("click", loadAll);
  $("btnRegister")?.addEventListener("click", registerPurchases);
  $("btnLogout")?.addEventListener("click", logout);

  // Inicial: si hay clave guardada, mostramos app; si no, login a pantalla completa.
  if (COSTS_SECRET) {
    setUnlockedUI(true);
    loadAll();
  } else {
    setUnlockedUI(false);
  }
}

document.addEventListener("DOMContentLoaded", init);
