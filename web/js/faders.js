// Faders: banks, snapshots (with morph), linking, fine mode, curves, range and smoothing.

import { state, P, bank, save, clamp } from "./store.js";
import { sendCC } from "./net.js";
import { icons, toast, tapOrHold, isLayoutMode, setPressed, onPress, quickEdit } from "./ui.js";

const MAX14 = 16383;
const root = document.getElementById("faders");
const banksEl = document.getElementById("banks");
const snapsEl = document.getElementById("snaps");
const fineBtn = document.getElementById("btnFine");

// Per-fader runtime (not persisted): smoothed output, last sent value, morph, DOM element.
const rt = new WeakMap();
const pending = new Set();
let raf = 0;
let lastT = 0;

const shape = (curve, x) => (curve === "exp" ? x * x : curve === "log" ? Math.sqrt(x) : x);

/** Fader position -> 14-bit output, through curve and min/max range. */
function target14(f) {
  const y = shape(f.curve, f.pos);
  return ((f.min + y * (f.max - f.min)) / 127) * MAX14;
}

function runtime(f) {
  let r = rt.get(f);
  if (!r) {
    r = { out: target14(f), sent: -1, morph: null, el: null };
    rt.set(f, r);
  }
  return r;
}

function schedule(f) {
  pending.add(f);
  if (!raf) {
    lastT = performance.now();
    raf = requestAnimationFrame(tick);
  }
}

const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

function tick(now) {
  const dt = Math.min(100, now - lastT);
  lastT = now;
  raf = 0;
  const out = [];
  for (const f of [...pending]) {
    const r = runtime(f);
    if (r.morph) {
      const t = Math.min(1, (now - r.morph.t0) / r.morph.dur);
      f.pos = r.morph.from + (r.morph.to - r.morph.from) * ease(t);
      if (t >= 1) r.morph = null;
      draw(f);
    }
    const target = target14(f);
    if (f.glide > 0) {
      r.out += (target - r.out) * (1 - Math.exp(-dt / f.glide));
      if (Math.abs(target - r.out) < 2) r.out = target;
    } else {
      r.out = target;
    }
    // Only send when the value MIDI will actually see changes.
    const v = Math.round(r.out);
    const q = state.hiRes ? v : v >> 7;
    if (q !== r.sent) {
      r.sent = q;
      out.push({ cc: f.cc, v });
    }
    if (!r.morph && r.out === target) pending.delete(f);
  }
  if (out.length) sendCC(out);
  if (pending.size) raf = requestAnimationFrame(tick);
}

function draw(f) {
  const r = runtime(f);
  if (!r.el) return;
  r.el.querySelector(".fader-fill").style.height = `${f.pos * 100}%`;
  r.el.querySelector(".fader-value").textContent = Math.round(target14(f)) >> 7;
}

export function renderFaders() {
  root.innerHTML = "";
  for (const f of bank().faders) {
    const el = document.createElement("div");
    el.className = "fader";
    el.style.setProperty("--c", f.color);
    el.innerHTML = `
      <div class="fader-head">
        <span class="fader-name"></span>
        <button class="link-btn" aria-label="Link fader" title="Linked faders move together">${icons.link}</button>
      </div>
      <div class="fader-track">
        <div class="fader-fill"><div class="fader-cap"></div></div>
        <div class="fader-readout"><span class="fader-value"></span><span class="fader-cc">CC ${f.cc}</span></div>
      </div>`;
    const name = el.querySelector(".fader-name");
    name.textContent = f.label;
    name.title = "Tap to rename";
    name.onclick = () => {
      if (isLayoutMode()) return;
      quickEdit("Fader", [
        { key: "label", label: "Name", value: f.label },
        { key: "cc", label: "CC number", value: f.cc, type: "number", min: 0, max: 127 },
      ], ({ label, cc }) => {
        f.label = label || `CC ${cc}`;
        f.cc = cc;
        save();
        renderFaders();
      });
    };
    const link = el.querySelector(".link-btn");
    setPressed(link, f.linked);
    link.onclick = () => { f.linked = !f.linked; setPressed(link, f.linked); save(); };
    root.appendChild(el);
    runtime(f).el = el;
    draw(f);
    attachDrag(el.querySelector(".fader-track"), f);
  }
  renderBanks();
  renderSnaps();
  setPressed(fineBtn, state.fine);
}

function attachDrag(track, f) {
  let drag = null;

  track.addEventListener("pointerdown", (e) => {
    if (isLayoutMode() || drag) return;
    track.setPointerCapture(e.pointerId);
    track.classList.add("active");
    const group = f.linked ? bank().faders.filter((g) => g.linked) : [f];
    drag = { id: e.pointerId, y: e.clientY, starts: new Map(group.map((g) => [g, g.pos])) };
    for (const g of group) runtime(g).morph = null;
    if (!state.relative) move(e);
  });

  const move = (e) => {
    const rect = track.getBoundingClientRect();
    const delta = state.relative
      ? ((drag.y - e.clientY) / rect.height) * (state.fine ? 0.25 : 1)
      : (rect.bottom - e.clientY) / rect.height - drag.starts.get(f);
    for (const [g, start] of drag.starts) {
      g.pos = clamp(start + delta, 0, 1);
      draw(g);
      schedule(g);
    }
  };

  track.addEventListener("pointermove", (e) => {
    if (drag && e.pointerId === drag.id) move(e);
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    track.classList.remove("active");
    save();
  };
  track.addEventListener("pointerup", end);
  track.addEventListener("pointercancel", end);
}

// --- Banks & snapshots -------------------------------------------------------

function renderBanks() {
  banksEl.innerHTML = P().banks
    .map((b, i) => `<button data-i="${i}" aria-pressed="${i === P().bank}">${b.name}</button>`)
    .join("");
  banksEl.querySelectorAll("button").forEach((b) => {
    onPress(b, () => {
      P().bank = Number(b.dataset.i);
      save();
      renderFaders();
      toast(`Bank ${bank().name}`);
    });
  });
}

function renderSnaps() {
  const snaps = bank().snapshots;
  snapsEl.innerHTML = snaps
    .map((s, i) => `<button class="snap${s ? " has" : ""}" title="Tap: recall · Hold: save">${i + 1}</button>`)
    .join("");
  snapsEl.querySelectorAll("button").forEach((b, i) => tapOrHold(b, () => recallSnapshot(i), () => storeSnapshot(i)));
}

function storeSnapshot(i) {
  bank().snapshots[i] = bank().faders.map((f) => f.pos);
  save();
  renderSnaps();
  toast(`Snapshot ${i + 1} saved`);
}

function recallSnapshot(i) {
  const snap = bank().snapshots[i];
  if (!snap) {
    toast("Hold a snapshot button to save the current faders");
    return;
  }
  const now = performance.now();
  bank().faders.forEach((f, j) => {
    if (snap[j] == null) return;
    const r = runtime(f);
    if (state.morphMs > 0) {
      r.morph = { from: f.pos, to: snap[j], t0: now, dur: state.morphMs };
    } else {
      f.pos = snap[j];
      draw(f);
    }
    schedule(f);
  });
  setTimeout(save, state.morphMs + 50);
}

onPress(fineBtn, () => {
  state.fine = !state.fine;
  setPressed(fineBtn, state.fine);
  save();
});
