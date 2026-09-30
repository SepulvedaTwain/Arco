// Small shared UI helpers.

const svg = (paths) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const icons = {
  settings: svg('<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>'),
  layout: svg('<path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/><rect x="8" y="8" width="8" height="8" rx="1"/>'),
  keys: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v8M11 5v8M15 5v8M9 13v6M13 13v6M17 5v8"/>'),
  fullscreen: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  link: svg('<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>'),
  left: svg('<path d="M15 6l-6 6 6 6"/>'),
  right: svg('<path d="M9 6l6 6-6 6"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  panic: svg('<path d="M8.5 3h7L21 8.5v7L15.5 21h-7L3 15.5v-7z"/><path d="M12 8v5M12 16h.01"/>'),
  pedal: svg('<path d="M7 21h10M9 21l1-9h4l1 9M12 12V4"/>'),
  up: svg('<path d="M6 15l6-6 6 6"/>'),
  down: svg('<path d="M6 9l6 6 6-6"/>'),
  copy: svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'),
  play: svg('<path d="M8 5l11 7-11 7z"/>'),
  repeat: svg('<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>'),
  scale: svg('<path d="M4 18h16M4 18V9M9 18V6M14 18v-8M19 18V4"/>'),
};

export function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 1500);
}

/** Tap runs `tap`, press-and-hold runs `hold` instead. */
export function tapOrHold(el, tap, hold, ms = 550) {
  let timer = 0;
  let held = false;
  el.addEventListener("pointerdown", () => {
    held = false;
    timer = setTimeout(() => { held = true; hold(); }, ms);
  });
  el.addEventListener("pointerup", () => { clearTimeout(timer); if (!held) tap(); });
  el.addEventListener("pointerleave", () => clearTimeout(timer));
  el.addEventListener("pointercancel", () => clearTimeout(timer));
  el.addEventListener("contextmenu", (e) => e.preventDefault());
}

/**
 * Run `fn` the moment a finger lands. Use for buttons pressed while another finger is busy
 * (holding a note, riding a fader): iPad Safari doesn't fire `click` during multi-touch.
 */
export function onPress(el, fn) {
  el.addEventListener("pointerdown", (e) => {
    if (e.button > 0) return;
    e.preventDefault();
    fn(e);
  });
  el.addEventListener("click", (e) => { if (e.detail === 0) fn(e); }); // keyboard (Enter/Space)
}

/** Detects a second tap within 300 ms at about the same spot. Call on every pointerdown. */
export function doubleTapper() {
  let last = { t: 0, x: 0, y: 0 };
  return (e) => {
    const now = performance.now();
    const hit = now - last.t < 300 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 40;
    last = hit ? { t: 0, x: 0, y: 0 } : { t: now, x: e.clientX, y: e.clientY };
    return hit;
  };
}

/**
 * Small in-place editor. fields: [{ key, label, value, type: "text" | "number", min, max }].
 * Calls onSave({ key: value… }) when Done is tapped.
 */
export function quickEdit(title, fields, onSave) {
  const dlg = document.getElementById("quick");
  dlg.innerHTML = `
    <form class="quick-form">
      <h3>${esc(title)}</h3>
      ${fields.map((f) => `
        <label class="mini">${esc(f.label)}
          <input name="${f.key}" type="${f.type || "text"}" value="${esc(f.value)}"
            ${f.min != null ? `min="${f.min}"` : ""} ${f.max != null ? `max="${f.max}"` : ""}>
        </label>`).join("")}
      <div class="row end">
        <button type="button" data-cancel class="btn">Cancel</button>
        <button type="submit" class="btn primary">Done</button>
      </div>
    </form>`;
  // Save straight from the submit (Done or Enter) rather than the dialog's "close" event,
  // which some engines don't deliver reliably.
  dlg.querySelector("form").onsubmit = (e) => {
    e.preventDefault();
    const out = {};
    for (const f of fields) {
      const raw = dlg.querySelector(`[name="${f.key}"]`).value;
      out[f.key] = f.type === "number" ? Math.min(f.max ?? Infinity, Math.max(f.min ?? -Infinity, parseInt(raw, 10) || 0)) : raw;
    }
    dlg.close();
    onSave(out);
  };
  dlg.querySelector("[data-cancel]").onclick = () => dlg.close();
  dlg.showModal();
  const first = dlg.querySelector("input");
  first.focus();
  first.select();
}

export const isLayoutMode = () => document.body.classList.contains("layout-mode");

export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function setPressed(el, on) {
  el.setAttribute("aria-pressed", String(!!on));
}
