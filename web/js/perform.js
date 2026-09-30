// Perform section for synths: pitch bend + mod (as two strips, or together on one XY pad)
// and a free XY pad for any two CCs (e.g. filter cutoff / resonance).

import { P, save, clamp } from "./store.js";
import { sendCC, sendPitch } from "./net.js";
import { isLayoutMode, esc, doubleTapper, quickEdit } from "./ui.js";

const root = document.getElementById("perform");

let bendValue = 0.5; // 0..1, 0.5 = centre; never saved — bend always rests at centre
let lastSent = {};
const resetSent = () => { lastSent = { bend: 8192, mod: -128, x: -128, y: -128 }; };
const modCC = () => (P().perform.modCC >= 0 ? P().perform.modCC : 1);

const xyHtml = (kind, xlabel, ylabel) => `
  <div class="xy${kind === "bm" ? " bm" : ""}" data-kind="${kind}">
    <div class="xy-grid"></div>
    <div class="xy-dot"></div>
    <span class="xy-label x" data-axis="x">${esc(xlabel)}</span>
    <span class="xy-label y" data-axis="y">${esc(ylabel)}</span>
  </div>`;

export function renderPerform() {
  const pf = P().perform;
  resetSent(); // new page / channel: next move always sends
  root.innerHTML = pf.bendModPad
    ? xyHtml("bm", "← Bend →", `Mod · CC${modCC()}`)
    : `${pf.bend ? `<div class="strip bend" data-kind="bend"><div class="strip-fill"></div><span class="strip-label">Bend</span></div>` : ""}
       ${pf.modCC >= 0 ? `<div class="strip mod" data-kind="mod"><div class="strip-fill"></div><span class="strip-label">Mod · CC${pf.modCC}</span></div>` : ""}`;
  root.insertAdjacentHTML("beforeend", xyHtml("xy", pf.xy.xlabel, pf.xy.ylabel));
  drawAll();
  root.querySelectorAll("[data-kind]").forEach(attach);
  root.querySelectorAll('[data-kind="xy"] .xy-label').forEach((label) => {
    label.addEventListener("pointerdown", (e) => e.stopPropagation()); // don't move the dot
    label.addEventListener("click", () => editAxis(label.dataset.axis));
  });
}

/** Tap the X/Y label of the free XY pad to rename it and change its CC. */
function editAxis(axis) {
  const xy = P().perform.xy;
  quickEdit(`XY pad · ${axis.toUpperCase()} axis`, [
    { key: "label", label: "Name", value: xy[`${axis}label`] },
    { key: "cc", label: "CC number", value: xy[`${axis}cc`], type: "number", min: 0, max: 127 },
  ], ({ label, cc }) => {
    xy[`${axis}label`] = label || `${axis.toUpperCase()} · CC${cc}`;
    xy[`${axis}cc`] = cc;
    save();
    renderPerform();
  });
}

/** Double-tap: back to the resting position (XY centre, no bend, mod at zero). */
function reset(kind) {
  const pf = P().perform;
  if (kind === "xy") { pf.xy.x = 0.5; pf.xy.y = 0.5; sendXY(); }
  if (kind === "mod" || kind === "bm") { pf.mod = 0; sendMod(); }
  if (kind === "bend" || kind === "bm") { bendValue = 0.5; sendBend(); }
  drawAll();
  save();
}

function placeDot(kind, x, y) {
  const dot = root.querySelector(`[data-kind="${kind}"] .xy-dot`);
  if (!dot) return;
  dot.style.left = `${x * 100}%`;
  dot.style.top = `${(1 - y) * 100}%`;
}

function drawAll() {
  const pf = P().perform;
  const bend = root.querySelector(".bend .strip-fill");
  if (bend) {
    const v = bendValue - 0.5;
    bend.style.bottom = `${Math.min(0.5, 0.5 + v) * 100}%`;
    bend.style.height = `${Math.abs(v) * 100}%`;
  }
  const mod = root.querySelector(".mod .strip-fill");
  if (mod) mod.style.height = `${pf.mod * 100}%`;
  placeDot("bm", bendValue, pf.mod);
  placeDot("xy", pf.xy.x, pf.xy.y);
}

function sendBend() {
  const v = Math.round(clamp(bendValue, 0, 1) * 16383);
  if (v !== lastSent.bend) sendPitch((lastSent.bend = v));
}

function sendMod() {
  const v = Math.round(P().perform.mod * 16383);
  if (v >> 7 !== lastSent.mod >> 7) sendCC([{ cc: modCC(), v: (lastSent.mod = v) }]);
}

function sendXY() {
  const xy = P().perform.xy;
  const x = Math.round(xy.x * 16383);
  const y = Math.round(xy.y * 16383);
  const out = [];
  if (x >> 7 !== lastSent.x >> 7) out.push({ cc: xy.xcc, v: (lastSent.x = x) });
  if (y >> 7 !== lastSent.y >> 7) out.push({ cc: xy.ycc, v: (lastSent.y = y) });
  if (out.length) sendCC(out);
}

function attach(el) {
  const kind = el.dataset.kind;
  let id = null;
  const isDoubleTap = doubleTapper();

  const move = (e) => {
    const r = el.getBoundingClientRect();
    const fx = clamp((e.clientX - r.left) / r.width, 0, 1);
    const fy = clamp((r.bottom - e.clientY) / r.height, 0, 1);
    const pf = P().perform;
    if (kind === "bend") { bendValue = fy; sendBend(); }
    else if (kind === "mod") { pf.mod = fy; sendMod(); }
    else if (kind === "bm") { bendValue = fx; pf.mod = fy; sendBend(); sendMod(); }
    else { pf.xy.x = fx; pf.xy.y = fy; sendXY(); }
    drawAll();
  };

  el.addEventListener("pointerdown", (e) => {
    if (isLayoutMode() || id !== null) return;
    e.preventDefault();
    if (isDoubleTap(e)) { reset(kind); return; }
    id = e.pointerId;
    try { el.setPointerCapture(id); } catch {}
    el.classList.add("active");
    move(e);
  });
  el.addEventListener("pointermove", (e) => { if (e.pointerId === id) move(e); });
  const end = (e) => {
    if (e.pointerId !== id) return;
    id = null;
    el.classList.remove("active");
    const pf = P().perform;
    // Pitch bend always springs back to centre; mod stays where you left it.
    if (kind === "bend" || kind === "bm") { bendValue = 0.5; sendBend(); }
    if (kind === "xy" && pf.xy.spring) { pf.xy.x = 0.5; pf.xy.y = 0.5; sendXY(); }
    drawAll();
    save();
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
}
