/* ======================================================
   AMARED – Kitchen.js Limpio y Estable
   Gestión completa de perfiles
   ====================================================== */

(function () {

  const API_BASE =
    window.API_BASE ||
    window.API_URL ||
    window.WORKER_URL ||
    "https://amared-orders.amaredpostres.workers.dev";

  const $ = (id) => document.getElementById(id);

  const btnManage = $("btnManageProfiles");
  const modal = $("profilesModal");
  const btnClose = $("btnCloseProfiles");
  const btnVerify = $("btnVerifyProfiles") || $("btnUnlockProfiles");
  const secretInput = $("profilesSecretInput") || $("profilesSecret");
  const editor = $("profilesEditor");
  const listEl = $("profilesList");
  const btnAdd = $("btnAddProfile");
  const newLabel = $("newProfileLabel");
  const statusEl = $("profilesStatus");
  const profileSelect = $("profileSelect");

  if (!btnManage || !modal) {
    console.warn("No se encontraron elementos necesarios en el HTML.");
    return;
  }

  /* =============================
     UTILIDADES
  ============================== */

  function showModal() {
    modal.style.display = "flex";
    modal.setAttribute("aria-hidden", "false");
  }

  function hideModal() {
    modal.style.display = "none";
    modal.setAttribute("aria-hidden", "true");
  }

  function showStatus(msg, isError = false) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.style.color = isError ? "#b91c1c" : "#6b7280";
  }

  async function post(action, payload) {
    const res = await fetch(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...payload }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data?.error || "Error del servidor");
    }

    return data;
  }

  function slugify(label) {
    return label
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  /* =============================
     CARGAR PERFILES EN LOGIN
  ============================== */

  async function loadProfiles() {
    try {
      const out = await post("profiles_list", {});
      const profiles = out.profiles || [];

      if (!profileSelect) return;

      profileSelect.innerHTML = `<option value="">Seleccionar...</option>`;

      profiles.forEach(p => {
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = p.label;
        profileSelect.appendChild(opt);
      });

    } catch (err) {
      console.error("No se pudieron cargar perfiles", err);
    }
  }

  window.loadProfiles = loadProfiles;

  /* =============================
     REFRESH LISTA EDITOR
  ============================== */

  async function refreshProfiles(secret) {
    const out = await post("profiles_list", {});
    const profiles = out.profiles || [];

    listEl.innerHTML = "";

    profiles.forEach(p => {

      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.justifyContent = "space-between";
      row.style.alignItems = "center";
      row.style.marginBottom = "8px";

      row.innerHTML = `
        <span>${p.label}</span>
        <button class="btn secondary">Eliminar</button>
      `;

      const btnDel = row.querySelector("button");

      btnDel.onclick = async () => {
        try {
          showStatus("Eliminando perfil...");
          await post("profiles_delete", {
            profiles_secret: secret,
            profile_id: p.id
          });

          showStatus("Perfil eliminado correctamente.");
          await refreshProfiles(secret);
          await loadProfiles();

        } catch (err) {
          showStatus("No se pudo eliminar.", true);
        }
      };

      listEl.appendChild(row);
    });
  }

  /* =============================
     EVENTOS
  ============================== */

  btnManage.addEventListener("click", () => {
    showModal();
    showStatus("Ingresa la clave para continuar.");
  });

  btnClose?.addEventListener("click", hideModal);

  btnVerify?.addEventListener("click", async () => {

    const secret = secretInput?.value.trim();

    if (!secret) {
      showStatus("Ingresa la clave.", true);
      return;
    }

    try {

      showStatus("Validando clave...");
      await post("validate_secret", { type: "profiles", secret });

      showStatus("Clave correcta.");
      editor.style.display = "block";

      await refreshProfiles(secret);

      btnAdd.onclick = async () => {

        const label = newLabel?.value.trim();
        if (!label) {
          showStatus("Escribe un nombre.", true);
          return;
        }

        try {

          showStatus("Guardando perfil...");

          await post("profiles_add", {
            profiles_secret: secret,
            profile_id: slugify(label),
            label,
            created_at: new Date().toISOString(),
            created_by: "kitchen",
            is_active: true
          });

          newLabel.value = "";
          showStatus("Perfil guardado correctamente.");

          await refreshProfiles(secret);
          await loadProfiles();

        } catch (err) {
          showStatus("No se pudo guardar.", true);
        }
      };

    } catch (err) {
      showStatus("Clave incorrecta.", true);
    }
  });

  /* =============================
     INICIALIZAR
  ============================== */

  document.addEventListener("DOMContentLoaded", loadProfiles);

})();
