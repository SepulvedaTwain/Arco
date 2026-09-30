// Drum pads (e.g. Superior Drummer 3): velocity from hit position, hi-hat openness strip,
// and note repeat that retriggers held pads in time.

import { P, save, clamp, noteName } from "./store.js";
import { sendNote, sendCC } from "./net.js";
import { isLayoutMode, esc, setPressed, onPress } from "./ui.js";

const root = document.getElementById("drumGrid");
const hhEl = document.getElementById("hhStrip");
const repeatBtn = document.getElementById("btnRepeat");
const rateEl = document.getElementById("repeatRate");
const bpmEl = document.getElementById("bpm");

const RATES = { "1/4": 1, "1/8": 2, "1/8T": 3, "1/16": 4, "1/16T": 6, "1/32": 8 };
const held = new Map(); // pointerId -> { i, note, vel, timer }

export function renderDrums() {
  const d = P().drums;
  releaseAll();
  root.style.setProperty("--drum-cols", d.cols);
  root.innerHTML = d.pads
    .map((p) => `<button class="drum-pad"><span class="pad-label">${esc(p.label)}</span><span class="pad-sub">${p.num} · ${noteName(p.num)}</span></button>`)
    .join("");
  root.querySelectorAll(".drum-pad").forEach((b, i) => attachPad(b, i));

  hhEl.hidden = !(d.hhCC >= 0);
  hhEl.querySelector(".strip-label").textContent = `${d.hhLabel} · CC${d.hhCC}`;
  drawHH();

  setPressed(repeatBtn, d.repeat);
  rateEl.innerHTML = Object.keys(RATES).map((r) => `<option ${r === d.rate ? "selected" : ""}>${r}</option>`).join("");
  bpmEl.value = d.bpm;
}

function velocityFor(e, el) {
  const d = P().drums;
  if (!d.velByPos) return d.velocity;
  const r = el.getBoundingClientRect();
  return Math.round(30 + clamp((e.clientY - r.top) / r.height, 0, 1) * 97); // top soft, bottom loud
}

function hit(note, vel, el) {
  sendNote(note, vel);
  sendNote(note, 0); // drums are one-shots; SD3 ignores note length
  el.classList.remove("hit");
  void el.offsetWidth;
  el.classList.add("hit");
}

function attachPad(el, i) {
  el.addEventListener("pointerdown", (e) => {
    if (isLayoutMode()) return;
    e.preventDefault();
    const d = P().drums;
    const note = d.pads[i].num;
    const vel = velocityFor(e, el);
    hit(note, vel, el);
    const h = { i, note, vel, timer: 0 };
    if (d.repeat) {
      const tick = () => {
        hit(note, vel, el);
        h.timer = setTimeout(tick, interval());
      };
      h.timer = setTimeout(tick, interval());
    }
    held.set(e.pointerId, h);
    el.classList.add("held");
  });
  const end = (e) => {
    const h = held.get(e.pointerId);
    if (!h) return;
    clearTimeout(h.timer);
    held.delete(e.pointerId);
    if (![...held.values()].some((x) => x.i === i)) el.classList.remove("held");
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
  el.addEventListener("pointerleave", end);
}

const interval = () => 60000 / P().drums.bpm / RATES[P().drums.rate];

function releaseAll() {
  for (const h of held.values()) clearTimeout(h.timer);
  held.clear();
}

// --- Hi-hat openness strip ------------------------------------------------------

function drawHH() {
  hhEl.querySelector(".strip-fill").style.height = `${P().drums.hhPos * 100}%`;
}

let hhId = null;
let hhSent = -1;
function hhMove(e) {
  const r = hhEl.getBoundingClientRect();
  const d = P().drums;
  d.hhPos = clamp((r.bottom - e.clientY) / r.height, 0, 1);
  drawHH();
  const v = Math.round(d.hhPos * 16383);
  if (v >> 7 !== hhSent >> 7) sendCC([{ cc: d.hhCC, v: (hhSent = v) }]);
}
hhEl.addEventListener("pointerdown", (e) => {
  if (isLayoutMode() || hhId !== null) return;
  e.preventDefault();
  hhId = e.pointerId;
  try { hhEl.setPointerCapture(hhId); } catch {}
  hhEl.classList.add("active");
  hhMove(e);
});
hhEl.addEventListener("pointermove", (e) => { if (e.pointerId === hhId) hhMove(e); });
const hhEnd = (e) => {
  if (e.pointerId !== hhId) return;
  hhId = null;
  hhEl.classList.remove("active");
  save();
};
hhEl.addEventListener("pointerup", hhEnd);
hhEl.addEventListener("pointercancel", hhEnd);

// --- Toolbar ----------------------------------------------------------------------

onPress(repeatBtn, () => {
  const d = P().drums;
  d.repeat = !d.repeat;
  setPressed(repeatBtn, d.repeat);
  save();
});
rateEl.onchange = () => { P().drums.rate = rateEl.value; save(); };
bpmEl.onchange = () => {
  P().drums.bpm = clamp(parseInt(bpmEl.value, 10) || 120, 30, 300);
  bpmEl.value = P().drums.bpm;
  save();
};
onPress(document.getElementById("bpmDown"), () => { bpmEl.value = P().drums.bpm - 1; bpmEl.onchange(); });
onPress(document.getElementById("bpmUp"), () => { bpmEl.value = P().drums.bpm + 1; bpmEl.onchange(); });
