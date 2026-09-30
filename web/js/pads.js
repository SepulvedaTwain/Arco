// Articulation pads: one or more sets (e.g. Violins 1, Violas…) of keyswitch notes or CC values.

import { P, articSet, save, on, emit, noteName } from "./store.js";
import { sendNote, sendCC } from "./net.js";
import { isLayoutMode, esc, onPress } from "./ui.js";

const root = document.getElementById("pads");
const setsEl = document.getElementById("articSets");
let active = -1; // index of the last-triggered pad in the current set

export function renderPads() {
  const a = P().artic;
  const set = articSet();

  // Set switcher (only when there's more than one set).
  setsEl.hidden = a.sets.length < 2;
  setsEl.innerHTML = a.sets.map((s, i) => `<button data-i="${i}" aria-pressed="${i === a.set}">${esc(s.name)}</button>`).join("");
  setsEl.querySelectorAll("button").forEach((b) => {
    onPress(b, () => {
      a.set = Number(b.dataset.i);
      active = -1;
      save();
      renderPads();
      emit("artic");
    });
  });

  root.innerHTML = (set?.pads || [])
    .map((p, i) => `
      <button class="pad${i === active ? " on" : ""}">
        <span class="pad-label">${esc(p.label)}</span>
        <span class="pad-sub">${p.type === "note" ? noteName(p.num) : `CC${p.num} · ${p.val}`}</span>
      </button>`)
    .join("") || `<p class="empty">No articulations yet — add some in Settings → Articulations.</p>`;
  root.querySelectorAll(".pad").forEach((b, i) => {
    b.addEventListener("pointerdown", (e) => {
      if (isLayoutMode()) return;
      e.preventDefault();
      trigger(i);
    });
  });
}

export function trigger(i, set = articSet()) {
  const p = set.pads[i];
  if (p.type === "note") {
    // Keyswitch: short note, like tapping the key.
    const ch = P().channel;
    sendNote(p.num, p.val || 100, ch);
    setTimeout(() => sendNote(p.num, 0, ch), 120);
  } else {
    sendCC([{ cc: p.num, v: p.val << 7 }]);
  }
  if (set === articSet()) highlight(i);
}

function highlight(i) {
  active = i;
  root.querySelectorAll(".pad").forEach((b, j) => b.classList.toggle("on", j === i));
  root.children[i]?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
}

// Playing a keyswitch on the keyboard lights up its pad too.
on("note-on", (n) => {
  const i = articSet()?.pads.findIndex((p) => p.type === "note" && p.num === n) ?? -1;
  if (i >= 0 && i !== active) highlight(i);
});
