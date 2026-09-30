// Scrollable, zoomable full-range keyboard with scale highlight/lock, sustain, and
// Spitfire-style colouring: keyswitch keys red, the articulation set's playable range blue.

import { P, articSet, save, on, emit, clamp, SCALES, NOTE_NAMES, isBlack, whiteIndex, noteOfWhite, noteName } from "./store.js";
import { sendNote, sendCC, sendPanic } from "./net.js";
import { isLayoutMode, setPressed, toast, onPress } from "./ui.js";

const viewport = document.getElementById("keys");
const strip = document.getElementById("keyStrip");
const rangeEl = document.getElementById("range");
const sustainBtn = document.getElementById("btnSustain");
const scaleBtn = document.getElementById("btnScale");

const WHITE_COUNT = whiteIndex(127) + 1;
const pointers = new Map(); // pointerId -> note under that finger (null when off the keys)
let sustain = false;
const sustained = new Set(); // released while the pedal was down: still sounding, still shown pressed

function inScale(n) {
  const kb = P().keyboard;
  if (kb.scale === "off" || !SCALES[kb.scale]) return true;
  return SCALES[kb.scale][1].includes((((n - kb.scaleRoot) % 12) + 12) % 12);
}

export function renderKeyboard() {
  releaseAll();
  const kb = P().keyboard;
  const scaleOn = kb.scale !== "off" && SCALES[kb.scale];
  const frag = document.createDocumentFragment();
  for (let n = 0; n <= 127; n++) {
    const key = document.createElement("div");
    const black = isBlack(n);
    const wi = whiteIndex(n);
    key.dataset.note = n;
    key.className = `key ${black ? "black" : "white"}`;
    key.style.left = black ? `calc(${wi + 1} * var(--kw) - var(--kw) * 0.3)` : `calc(${wi} * var(--kw))`;
    if (scaleOn && !inScale(n)) key.classList.add("out");
    if (scaleOn && n % 12 === kb.scaleRoot) key.classList.add("root");
    if (!black && (kb.names === "all" || (kb.names === "c" && n % 12 === 0))) {
      key.innerHTML = `<span class="key-name">${noteName(n)}</span>`;
    }
    frag.appendChild(key);
  }
  strip.innerHTML = "";
  strip.appendChild(frag);
  strip.style.width = `calc(${WHITE_COUNT} * var(--kw))`;
  scaleBtn.querySelector(".chip-text").textContent = scaleOn ? `${NOTE_NAMES[kb.scaleRoot]} ${SCALES[kb.scale][0]}` : "Scale";
  setPressed(scaleBtn, scaleOn);
  markArticulations();
  applyView();
}

/** Keyswitch keys red, playable range blue (current articulation set). */
export function markArticulations() {
  const set = articSet();
  const ks = new Set(P().layout.pads && set ? set.pads.filter((p) => p.type === "note").map((p) => p.num) : []);
  const [lo, hi] = set?.range || [-1, -1];
  for (const key of strip.children) {
    const n = Number(key.dataset.note);
    key.classList.toggle("ks", ks.has(n));
    key.classList.toggle("range", n >= lo && n <= hi && !ks.has(n));
  }
}

const visibleWhites = () => viewport.clientWidth / P().layout.keyWidth;

/** Apply key width + scroll position (called on render, resize and during pinch). */
export function applyView() {
  const L = P().layout;
  if (viewport.clientWidth > 0) {
    // Never smaller than "whole range fits"; if zoomed fully out, stay fitted after a rotate/resize.
    const fitAll = viewport.clientWidth / WHITE_COUNT;
    L.keyWidth = L.keyFit ? fitAll : Math.max(L.keyWidth, fitAll);
    L.keyScroll = clamp(L.keyScroll, 0, Math.max(0, WHITE_COUNT - visibleWhites()));
  }
  viewport.style.setProperty("--kw", `${L.keyWidth}px`);
  strip.style.transform = `translateX(${-L.keyScroll * L.keyWidth}px)`;
  const first = noteOfWhite(Math.round(L.keyScroll));
  const last = noteOfWhite(clamp(Math.floor(L.keyScroll + visibleWhites()) - 1, 0, WHITE_COUNT - 1));
  rangeEl.textContent = `${noteName(first)} – ${noteName(Math.min(127, last))}`;
}

// --- Playing -----------------------------------------------------------------

function velocityFor(e, key) {
  const kb = P().keyboard;
  if (!kb.velByPos) return kb.velocity;
  const r = key.getBoundingClientRect();
  const t = clamp((e.clientY - r.top) / r.height, 0, 1);
  return Math.round(30 + t * 97); // top of key soft, bottom loud
}

function setDown(n, down) {
  strip.children[n]?.classList.toggle("down", down);
}

const heldBy = (n) => [...pointers.values()].filter((p) => p === n).length;

function noteOn(n, vel) {
  sustained.delete(n);
  sendNote(n, vel);
  setDown(n, true);
}

/** Note-off is always sent (the synth handles the pedal); the key stays lit while sustained. */
function noteOff(n) {
  sendNote(n, 0);
  if (sustain) sustained.add(n);
  else setDown(n, false);
}

function trackPointer(e) {
  const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest(".key");
  let key = hit && strip.contains(hit) ? hit : null;
  if (key && P().keyboard.scaleLock && key.classList.contains("out")) key = null;
  const note = key ? Number(key.dataset.note) : null;
  const prev = pointers.has(e.pointerId) ? pointers.get(e.pointerId) : undefined;
  if (note === prev) return;

  pointers.set(e.pointerId, note);
  if (prev != null && heldBy(prev) === 0) noteOff(prev);
  if (note != null && heldBy(note) === 1) noteOn(note, velocityFor(e, key));
}

function releasePointer(e) {
  if (!pointers.has(e.pointerId)) return;
  const note = pointers.get(e.pointerId);
  pointers.delete(e.pointerId);
  if (note != null && heldBy(note) === 0) noteOff(note);
}

export function releaseAll() {
  const notes = new Set(pointers.values());
  pointers.clear();
  for (const n of notes) if (n != null) noteOff(n);
}

viewport.addEventListener("pointerdown", (e) => {
  if (isLayoutMode()) return;
  e.preventDefault();
  trackPointer(e);
});
viewport.addEventListener("pointermove", (e) => { if (pointers.has(e.pointerId)) trackPointer(e); });
viewport.addEventListener("pointerup", releasePointer);
viewport.addEventListener("pointercancel", releasePointer);
document.addEventListener("visibilitychange", () => { if (document.hidden) releaseAll(); });

on("disconnected", () => {
  pointers.clear();
  sustained.clear();
  strip.querySelectorAll(".down").forEach((k) => k.classList.remove("down"));
  setSustain(false, false);
});
on("artic", markArticulations);

// --- Toolbar -----------------------------------------------------------------

function shift(whites) {
  P().layout.keyScroll += whites;
  applyView();
  save();
}

export function setSustain(onOff, send = true) {
  sustain = onOff;
  setPressed(sustainBtn, sustain);
  if (!sustain) {
    // Pedal up: sustained notes stop sounding, so un-light those no finger is holding.
    for (const n of sustained) if (heldBy(n) === 0) setDown(n, false);
    sustained.clear();
  }
  if (send) sendCC([{ cc: 64, v: sustain ? 16383 : 0 }]);
}
export const sustainOn = () => sustain;

onPress(document.getElementById("octDown"), () => shift(-7));
onPress(document.getElementById("octUp"), () => shift(7));
onPress(sustainBtn, () => setSustain(!sustain));
scaleBtn.onclick = () => emit("open-settings", "keyboard");
onPress(document.getElementById("btnPanic"), () => {
  releaseAll();
  if (sustain) setSustain(false);
  sendPanic();
  toast("All notes off");
});
