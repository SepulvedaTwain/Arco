// Settings sheet. Global: General. Current page: Page, Faders, Articulations, Keyboard, Drums, Perform.

import {
  state, P, bank, articSet, save, emit, resetAll, clamp, parseNote, noteName,
  PRESETS, COLORS, SCALES, NOTE_NAMES, TEMPLATES, SSO_SECTIONS, SD3_EXTRAS, makeFader, makeProfile, ssoSet,
} from "./store.js";
import { trigger } from "./pads.js";
import { icons, esc, toast } from "./ui.js";

const dlg = document.getElementById("settings");
let tab = "general";

function tabs() {
  const L = P().layout;
  return {
    general: "General",
    page: "Page",
    faders: "Faders",
    artic: "Articulations",
    keyboard: "Keyboard",
    ...(L.drums || P().template === "sd3" ? { drums: "Drums" } : {}),
    ...(L.perform || P().template === "serum2" ? { perform: "Perform" } : {}),
  };
}

export function openSettings(which) {
  if (which) tab = which;
  // Fresh shell on open, so the slide-in animation plays only here, not on every tab change.
  dlg.innerHTML = `
    <div class="sheet">
      <div class="sheet-head">
        <h2>Settings</h2>
        <button class="icon-btn" data-close aria-label="Close">${icons.close}</button>
      </div>
      <nav class="tabs"></nav>
      <div class="sheet-body"></div>
    </div>`;
  dlg.querySelector("[data-close]").onclick = closeSettings;
  applied = false;
  render();
  dlg.showModal();
}

// Apply on every way out (close button, backdrop, Escape). The direct calls matter: some engines
// don't deliver the dialog "close" event reliably.
let applied = true;
function applyChanges() {
  if (applied) return;
  applied = true;
  save();
  emit("rerender");
}
function closeSettings() {
  dlg.close();
  applyChanges();
}
dlg.addEventListener("close", applyChanges);
dlg.addEventListener("click", (e) => { if (e.target === dlg) closeSettings(); });

function render() {
  const t = tabs();
  if (!(tab in t)) tab = "general";
  const nav = dlg.querySelector(".tabs");
  nav.innerHTML = Object.entries(t).map(([k, l]) => `<button data-tab="${k}" aria-selected="${k === tab}">${l}</button>`).join("");
  nav.querySelectorAll("[data-tab]").forEach((b) => { b.onclick = () => { tab = b.dataset.tab; render(); dlg.querySelector(".sheet-body").scrollTop = 0; }; });
  const body = dlg.querySelector(".sheet-body");
  const scroll = body.scrollTop;
  ({ general, page, faders, artic, keyboard, drums, perform })[tab](body);
  body.scrollTop = scroll; // editing re-renders the tab; don't jump to the top
}

// --- helpers -------------------------------------------------------------------

const seg = (name, options, current) =>
  `<div class="seg" data-seg="${name}">${options
    .map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${String(v) === String(current)}">${l}</button>`)
    .join("")}</div>`;

function onSeg(root, name, fn) {
  root.querySelectorAll(`[data-seg="${name}"] button`).forEach((b) => {
    b.onclick = () => { fn(b.dataset.v); save(); render(); };
  });
}

const field = (label, html) => `<div class="field"><label>${label}</label>${html}</div>`;
const toggle = (id, label, hint, checked) =>
  `<label class="toggle"><input type="checkbox" id="${id}" ${checked ? "checked" : ""}><span>${label}${hint ? `<small>${hint}</small>` : ""}</span></label>`;
const num = (v, lo, hi, fallback) => { const n = parseInt(v, 10); return Number.isFinite(n) ? clamp(n, lo, hi) : fallback; };
const $ = (root, sel) => root.querySelector(sel);
const channelSelect = (id, value) =>
  `<select id="${id}">${Array.from({ length: 16 }, (_, i) => `<option value="${i + 1}" ${i + 1 === value ? "selected" : ""}>${i + 1}</option>`).join("")}</select>`;

// --- General -------------------------------------------------------------------

function general(body) {
  body.innerHTML = `
    ${field("Theme", seg("theme", [["midnight", "Midnight"], ["graphite", "Graphite"]], state.theme))}
    ${field(`Interface size <output id="gScaleOut">${Math.round(state.uiScale * 100)}%</output>`, `<input type="range" id="gScale" min="0.75" max="1.6" step="0.05" value="${state.uiScale}">`)}
    ${field("Fader touch", seg("touch", [["rel", "Relative · no jumps"], ["abs", "Absolute"]], state.relative ? "rel" : "abs"))}
    ${toggle("gHiRes", "14-bit CC", "Sends the fine value on CC+32 (CC 0–31 only). Only if your library supports it.", state.hiRes)}
    ${field("Snapshot morph time", seg("morph", [[0, "Instant"], [300, "0.3 s"], [1000, "1 s"], [3000, "3 s"]], state.morphMs))}
    <div class="row">
      <button class="btn" id="gResetLayout">Reset this page's layout</button>
      <button class="btn danger" id="gResetAll">Reset everything</button>
    </div>
    <p class="hint">MIDI channel, instrument and sections are per page — see the Page tab.</p>`;

  onSeg(body, "theme", (v) => { state.theme = v; emit("theme"); });
  const scale = $(body, "#gScale");
  scale.oninput = () => {
    state.uiScale = Number(scale.value);
    $(body, "#gScaleOut").textContent = `${Math.round(state.uiScale * 100)}%`;
    emit("layout");
  };
  scale.onchange = save;
  onSeg(body, "touch", (v) => { state.relative = v === "rel"; });
  $(body, "#gHiRes").onchange = (e) => { state.hiRes = e.target.checked; save(); };
  onSeg(body, "morph", (v) => { state.morphMs = Number(v); });
  $(body, "#gResetLayout").onclick = () => document.getElementById("btnResetLayout").click();
  $(body, "#gResetAll").onclick = () => {
    if (!confirm("Reset all pages, settings, snapshots and articulations?")) return;
    resetAll();
    emit("theme");
    emit("layout");
    render();
    toast("Everything reset");
  };
}

// --- Page ----------------------------------------------------------------------

function page(body) {
  const p = P();
  const L = p.layout;
  body.innerHTML = `
    ${field("Page name", `<input type="text" id="pName" value="${esc(p.name)}">`)}
    ${field("MIDI channel", channelSelect("pChannel", p.channel))}
    <p class="hint">Give each page its own channel, then in REAPER set each instrument track's input to
      <b>Virtual MIDI Keyboard → that channel</b> and arm them all: switching pages here plays a different instrument.</p>
    ${field("Note names", seg("middleC", [[4, "Middle C = C4 (REAPER)"], [3, "Middle C = C3 (Spitfire, Kontakt)"]], p.middleC))}
    ${field("Sections on this page", `<div class="row">
      ${toggle("sF", "Faders", "", L.faders)}${toggle("sP", "Articulations", "", L.pads)}${toggle("sR", "Perform (bend/XY)", "", L.perform)}
      ${toggle("sD", "Drum pads", "", L.drums)}${toggle("sK", "Keyboard", "", L.keys)}
    </div>`)}
    ${p.notes ? field(`Setup notes · ${esc(TEMPLATES[p.template]?.label || "")}`, `<p class="notes">${esc(p.notes)}</p>`) : ""}

    <h3>All pages</h3>
    <div class="cards">${state.profiles.map((q, i) => `
      <div class="card compact${i === state.profile ? " current" : ""}">
        <div class="card-row center">
          <span class="grow"><b>${esc(q.name)}</b><small>${esc(TEMPLATES[q.template]?.label || "Custom")} · Ch ${q.channel}</small></span>
          <button class="icon-btn sm" data-up="${i}" aria-label="Move up">${icons.up}</button>
          <button class="icon-btn sm" data-down="${i}" aria-label="Move down">${icons.down}</button>
          <button class="icon-btn sm" data-dup="${i}" aria-label="Duplicate">${icons.copy}</button>
          <button class="icon-btn sm" data-del="${i}" aria-label="Delete">${icons.trash}</button>
        </div>
      </div>`).join("")}</div>
    ${field("Add a page", `<div class="row">
      <select id="pTemplate" class="grow">${Object.entries(TEMPLATES).map(([k, t]) => `<option value="${k}">${t.label}</option>`).join("")}</select>
      <button class="btn" id="pAdd">${icons.plus} Add page</button>
    </div>`)}`;

  $(body, "#pName").oninput = (e) => { p.name = e.target.value; save(); emit("page-name"); };
  $(body, "#pChannel").onchange = (e) => { p.channel = Number(e.target.value); save(); emit("page-name"); };
  onSeg(body, "middleC", (v) => { p.middleC = Number(v); });
  for (const [id, key] of [["sF", "faders"], ["sP", "pads"], ["sR", "perform"], ["sD", "drums"], ["sK", "keys"]]) {
    $(body, `#${id}`).onchange = (e) => { L[key] = e.target.checked; save(); emit("layout"); render(); };
  }
  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= state.profiles.length) return;
    const cur = state.profiles[state.profile];
    [state.profiles[i], state.profiles[j]] = [state.profiles[j], state.profiles[i]];
    state.profile = state.profiles.indexOf(cur);
    save();
    render();
  };
  body.querySelectorAll("[data-up]").forEach((b) => { b.onclick = () => move(Number(b.dataset.up), -1); });
  body.querySelectorAll("[data-down]").forEach((b) => { b.onclick = () => move(Number(b.dataset.down), 1); });
  body.querySelectorAll("[data-dup]").forEach((b) => {
    b.onclick = () => {
      const i = Number(b.dataset.dup);
      const copy = JSON.parse(JSON.stringify(state.profiles[i]));
      copy.name += " copy";
      state.profiles.splice(i + 1, 0, copy);
      if (state.profile > i) state.profile++;
      save();
      render();
    };
  });
  body.querySelectorAll("[data-del]").forEach((b) => {
    b.onclick = () => {
      const i = Number(b.dataset.del);
      if (state.profiles.length <= 1) return toast("Keep at least one page");
      if (!confirm(`Delete the page "${state.profiles[i].name}"?`)) return;
      const cur = state.profiles[state.profile];
      state.profiles.splice(i, 1);
      state.profile = Math.max(0, state.profiles.indexOf(cur));
      save();
      render();
    };
  });
  $(body, "#pAdd").onclick = () => {
    state.profiles.push(makeProfile($(body, "#pTemplate").value));
    state.profile = state.profiles.length - 1;
    save();
    emit("rerender");
    render();
    toast(`Added "${P().name}"`);
  };
}

// --- Faders --------------------------------------------------------------------

function faderCard(f) {
  return `
    <div class="card" style="--c:${f.color}">
      <div class="card-row">
        <label class="mini grow">Name<input type="text" data-k="label" value="${esc(f.label)}"></label>
        <label class="mini">CC<input type="number" data-k="cc" min="0" max="127" value="${f.cc}"></label>
        <button class="icon-btn" data-remove aria-label="Remove fader">${icons.trash}</button>
      </div>
      <div class="swatches">${COLORS.map((c) => `<button class="swatch" data-color="${c}" style="--s:${c}" aria-pressed="${c === f.color}" aria-label="Colour"></button>`).join("")}</div>
      <div class="card-row">
        <label class="mini">Curve<select data-k="curve">
          <option value="linear">Linear</option><option value="exp">Exp · fine low</option><option value="log">Log · fine high</option>
        </select></label>
        <label class="mini">Min<input type="number" data-k="min" min="0" max="127" value="${f.min}"></label>
        <label class="mini">Max<input type="number" data-k="max" min="0" max="127" value="${f.max}"></label>
        <label class="mini">Smoothing<select data-k="glide">
          <option value="0">Off</option><option value="40">Light</option><option value="120">Medium</option><option value="300">Heavy</option>
        </select></label>
      </div>
    </div>`;
}

function faders(body) {
  const b = bank();
  body.innerHTML = `
    ${field("Editing bank", seg("bank", P().banks.map((bk, i) => [i, bk.name]), P().bank))}
    ${field("Load a preset into this bank", `<div class="row">${Object.keys(PRESETS).map((p) => `<button class="btn" data-preset="${esc(p)}">${esc(p)}</button>`).join("")}</div>`)}
    <div class="cards">${b.faders.map(faderCard).join("")}</div>
    <button class="btn" id="fAdd" ${b.faders.length >= 8 ? "disabled" : ""}>${icons.plus} Add fader</button>
    <p class="hint">Exp/Log curves give more precision at the bottom/top of the fader. Min/Max limit the output range. Smoothing glides the output for extra-smooth swells.</p>`;

  onSeg(body, "bank", (v) => { P().bank = Number(v); });
  body.querySelectorAll("[data-preset]").forEach((btn) => {
    btn.onclick = () => {
      b.faders = PRESETS[btn.dataset.preset].map(([l, cc], i) => makeFader(l, cc, i));
      b.snapshots = [null, null, null, null];
      save();
      render();
    };
  });

  body.querySelectorAll(".card").forEach((card, i) => {
    const f = b.faders[i];
    $(card, '[data-k="curve"]').value = f.curve;
    $(card, '[data-k="glide"]').value = String(f.glide);
    $(card, '[data-k="label"]').oninput = (e) => { f.label = e.target.value; save(); };
    $(card, '[data-k="cc"]').onchange = (e) => { f.cc = num(e.target.value, 0, 127, f.cc); e.target.value = f.cc; save(); };
    $(card, '[data-k="min"]').onchange = (e) => { f.min = num(e.target.value, 0, 127, f.min); e.target.value = f.min; save(); };
    $(card, '[data-k="max"]').onchange = (e) => { f.max = num(e.target.value, 0, 127, f.max); e.target.value = f.max; save(); };
    $(card, '[data-k="curve"]').onchange = (e) => { f.curve = e.target.value; save(); };
    $(card, '[data-k="glide"]').onchange = (e) => { f.glide = Number(e.target.value); save(); };
    card.querySelectorAll(".swatch").forEach((s) => { s.onclick = () => { f.color = s.dataset.color; save(); render(); }; });
    $(card, "[data-remove]").onclick = () => {
      b.faders.splice(i, 1);
      save();
      render();
    };
  });

  $(body, "#fAdd").onclick = () => {
    const n = b.faders.length;
    b.faders.push(makeFader(`CC ${20 + n}`, 20 + n, n));
    save();
    render();
  };
}

// --- Articulations -------------------------------------------------------------

function artic(body) {
  const a = P().artic;
  const set = articSet();
  body.innerHTML = `
    ${a.sets.length ? field("Set", seg("set", a.sets.map((s, i) => [i, esc(s.name)]), a.set)) : ""}
    <div class="row">
      <button class="btn" id="aNewSet">${icons.plus} New set</button>
      <select id="aSSO"><option value="">Add a Spitfire SSO section…</option>${SSO_SECTIONS.map((s) => `<option>${s}</option>`).join("")}</select>
      ${set ? `<button class="btn danger" id="aDelSet">${icons.trash} Delete set</button>` : ""}
    </div>
    ${set ? `
      ${field("Set name", `<input type="text" id="aName" value="${esc(set.name)}">`)}
      ${field("Playable range (blue on the keyboard) — leave empty for none", `<div class="row">
        <input type="text" id="aLo" placeholder="e.g. G2" value="${set.range ? noteName(set.range[0]) : ""}" class="note-in">
        <span class="to">to</span>
        <input type="text" id="aHi" placeholder="e.g. C6" value="${set.range ? noteName(set.range[1]) : ""}" class="note-in">
      </div>`)}
      ${field(`Articulations · ${set.pads.length}`, `<div class="artic-list">${set.pads.map((p, i) => `
        <div class="artic-row" data-i="${i}">
          <button class="icon-btn sm" data-test aria-label="Test">${icons.play}</button>
          <input type="text" data-k="label" value="${esc(p.label)}" class="grow" aria-label="Name">
          <select data-k="type" aria-label="Type"><option value="note">Note</option><option value="cc">CC</option></select>
          <input type="text" data-k="num" value="${p.type === "note" ? noteName(p.num) : p.num}" class="note-in" aria-label="${p.type === "note" ? "Keyswitch note" : "CC number"}">
          ${p.type === "cc" ? `<input type="number" data-k="val" min="0" max="127" value="${p.val}" class="val-in" aria-label="CC value">` : ""}
          <button class="icon-btn sm" data-up aria-label="Move up">${icons.up}</button>
          <button class="icon-btn sm" data-down aria-label="Move down">${icons.down}</button>
          <button class="icon-btn sm" data-del aria-label="Remove">${icons.trash}</button>
        </div>`).join("")}</div>`)}
      <div class="row">
        <button class="btn" id="aAdd">${icons.plus} Add articulation</button>
      </div>
      ${field("Renumber keyswitches", `<div class="row">
        <span class="to">in list order, one key apart, starting at</span>
        <input type="text" id="aStart" value="${noteName(0)}" class="note-in">
        <button class="btn" id="aRenumber">Renumber</button>
      </div>`)}
      <p class="hint">To match a Kontakt patch: order this list like its articulation bar (▲▼), then Renumber from its lowest
        keyswitch (Spitfire: C-2). ▶ sends that keyswitch so you can see which articulation lights up.</p>` : `<p class="hint">No articulation sets on this page yet.</p>`}
    ${field("Paste a list", `
      <textarea id="aPaste" rows="5" placeholder="One articulation per line, in keyswitch order&#10;Legato&#10;Long&#10;Spiccato…"></textarea>
      <div class="row">
        <span class="to">first keyswitch</span><input type="text" id="aPasteStart" value="${noteName(0)}" class="note-in">
        <button class="btn" id="aPasteNew">As new set</button>
        ${set ? `<button class="btn" id="aPasteReplace">Replace this set</button>` : ""}
      </div>`)}`;

  onSeg(body, "set", (v) => { a.set = Number(v); });
  $(body, "#aNewSet").onclick = () => {
    a.sets.push({ name: `Set ${a.sets.length + 1}`, range: null, pads: [] });
    a.set = a.sets.length - 1;
    save();
    render();
  };
  $(body, "#aSSO").onchange = (e) => {
    if (!e.target.value) return;
    a.sets.push(ssoSet(e.target.value));
    a.set = a.sets.length - 1;
    save();
    render();
    toast(`Added ${e.target.value}`);
  };
  const pasteList = () => $(body, "#aPaste").value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const pasteStart = () => parseNote($(body, "#aPasteStart").value);
  const padsFrom = (names, start) => names.map((label, i) => ({ label, type: "note", num: clamp(start + i, 0, 127), val: 100 }));
  $(body, "#aPasteNew").onclick = () => {
    const names = pasteList();
    const start = pasteStart();
    if (!names.length || start == null) return toast(start == null ? "Invalid start note" : "Paste some names first");
    a.sets.push({ name: `Set ${a.sets.length + 1}`, range: null, pads: padsFrom(names, start) });
    a.set = a.sets.length - 1;
    save();
    render();
    toast(`${names.length} articulations added`);
  };
  if (!set) return;

  $(body, "#aPasteReplace").onclick = () => {
    const names = pasteList();
    const start = pasteStart();
    if (!names.length || start == null) return toast(start == null ? "Invalid start note" : "Paste some names first");
    set.pads = padsFrom(names, start);
    save();
    render();
    toast(`${names.length} articulations`);
  };
  $(body, "#aDelSet").onclick = () => {
    if (!confirm(`Delete the set "${set.name}"?`)) return;
    a.sets.splice(a.set, 1);
    a.set = Math.max(0, a.set - 1);
    save();
    render();
  };
  $(body, "#aName").oninput = (e) => { set.name = e.target.value; save(); };
  const rangeChange = () => {
    const lo = parseNote($(body, "#aLo").value);
    const hi = parseNote($(body, "#aHi").value);
    set.range = lo != null && hi != null ? [Math.min(lo, hi), Math.max(lo, hi)] : null;
    save();
  };
  $(body, "#aLo").onchange = rangeChange;
  $(body, "#aHi").onchange = rangeChange;

  body.querySelectorAll(".artic-row").forEach((row) => {
    const i = Number(row.dataset.i);
    const p = set.pads[i];
    $(row, '[data-k="type"]').value = p.type;
    $(row, "[data-test]").onclick = () => trigger(i, set);
    $(row, '[data-k="label"]').oninput = (e) => { p.label = e.target.value; save(); };
    $(row, '[data-k="type"]').onchange = (e) => { p.type = e.target.value; save(); render(); };
    $(row, '[data-k="num"]').onchange = (e) => {
      const n = p.type === "note" ? parseNote(e.target.value) : num(e.target.value, 0, 127, null);
      if (n == null) { toast("Use a note like C-2, F#1 or a number 0–127"); e.target.value = p.type === "note" ? noteName(p.num) : p.num; return; }
      p.num = n;
      e.target.value = p.type === "note" ? noteName(n) : n;
      save();
    };
    const val = $(row, '[data-k="val"]');
    if (val) val.onchange = (e) => { p.val = num(e.target.value, 0, 127, p.val); e.target.value = p.val; save(); };
    const swap = (j) => {
      if (j < 0 || j >= set.pads.length) return;
      [set.pads[i], set.pads[j]] = [set.pads[j], set.pads[i]];
      save();
      render();
    };
    $(row, "[data-up]").onclick = () => swap(i - 1);
    $(row, "[data-down]").onclick = () => swap(i + 1);
    $(row, "[data-del]").onclick = () => { set.pads.splice(i, 1); save(); render(); };
  });

  $(body, "#aAdd").onclick = () => {
    const last = set.pads[set.pads.length - 1];
    set.pads.push({ label: "New", type: "note", num: last ? Math.min(127, last.num + 1) : 0, val: 100 });
    save();
    render();
  };
  $(body, "#aRenumber").onclick = () => {
    const start = parseNote($(body, "#aStart").value);
    if (start == null) return toast("Invalid start note");
    let n = start;
    for (const p of set.pads) if (p.type === "note") p.num = clamp(n++, 0, 127);
    save();
    render();
    toast(`Renumbered from ${noteName(start)}`);
  };
}

// --- Keyboard ------------------------------------------------------------------

function keyboard(body) {
  const kb = P().keyboard;
  body.innerHTML = `
    ${field("Velocity", seg("vel", [["pos", "Touch position"], ["fixed", "Fixed"]], kb.velByPos ? "pos" : "fixed"))}
    ${kb.velByPos
      ? `<p class="hint">Touch near the top of a key for soft notes, near the bottom for loud (30–127).</p>`
      : field(`Fixed velocity <output id="kVelOut">${kb.velocity}</output>`, `<input type="range" id="kVel" min="1" max="127" value="${kb.velocity}">`)}
    ${field("Note names on keys", seg("names", [["c", "C only"], ["all", "All white keys"], ["none", "None"]], kb.names))}
    ${field("Scale", `<div class="row">
      <select id="kRoot">${NOTE_NAMES.map((n, i) => `<option value="${i}" ${i === kb.scaleRoot ? "selected" : ""}>${n}</option>`).join("")}</select>
      <select id="kScale" class="grow"><option value="off">Off</option>${Object.entries(SCALES).map(([k, [l]]) => `<option value="${k}" ${k === kb.scale ? "selected" : ""}>${l}</option>`).join("")}</select>
    </div>`)}
    ${toggle("kLock", "Lock to scale", "Out-of-scale keys are dimmed and don't play.", kb.scaleLock)}
    <p class="hint">Keyswitch keys of the current articulation set show red, its playable range blue.</p>`;

  onSeg(body, "vel", (v) => { kb.velByPos = v === "pos"; });
  const vel = $(body, "#kVel");
  if (vel) {
    vel.oninput = () => { kb.velocity = Number(vel.value); $(body, "#kVelOut").textContent = kb.velocity; };
    vel.onchange = save;
  }
  onSeg(body, "names", (v) => { kb.names = v; });
  $(body, "#kRoot").onchange = (e) => { kb.scaleRoot = Number(e.target.value); save(); };
  $(body, "#kScale").onchange = (e) => { kb.scale = e.target.value; save(); };
  $(body, "#kLock").onchange = (e) => { kb.scaleLock = e.target.checked; save(); };
}

// --- Drums ---------------------------------------------------------------------

function drums(body) {
  const d = P().drums;
  body.innerHTML = `
    ${field("Columns", seg("cols", [[3, "3"], [4, "4"], [5, "5"], [6, "6"], [8, "8"]], d.cols))}
    ${field("Velocity", seg("dvel", [["pos", "Hit position"], ["fixed", "Fixed"]], d.velByPos ? "pos" : "fixed"))}
    ${d.velByPos ? `<p class="hint">Hit near the top of a pad for soft, near the bottom for loud.</p>`
      : field(`Fixed velocity <output id="dVelOut">${d.velocity}</output>`, `<input type="range" id="dVel" min="1" max="127" value="${d.velocity}">`)}
    ${field("Hi-hat strip", `<div class="row">
      <label class="mini grow">Label<input type="text" id="dHHLabel" value="${esc(d.hhLabel)}"></label>
      <label class="mini">CC (−1 = hide)<input type="number" id="dHHCC" min="-1" max="127" value="${d.hhCC}"></label>
    </div>`)}
    ${field(`Pads · ${d.pads.length}`, `<div class="artic-list">${d.pads.map((p, i) => `
      <div class="artic-row" data-i="${i}">
        <input type="text" data-k="label" value="${esc(p.label)}" class="grow" aria-label="Name">
        <input type="text" data-k="num" value="${p.num}" class="note-in" aria-label="Note number">
        <span class="to">${noteName(p.num)}</span>
        <button class="icon-btn sm" data-up aria-label="Move up">${icons.up}</button>
        <button class="icon-btn sm" data-down aria-label="Move down">${icons.down}</button>
        <button class="icon-btn sm" data-del aria-label="Remove">${icons.trash}</button>
      </div>`).join("")}</div>`)}
    <div class="row">
      <button class="btn" id="dAdd">${icons.plus} Add pad</button>
      <button class="btn" id="dExtras">Add SD3 extras</button>
      <button class="btn" id="dReset">Reset to SD3 core map</button>
    </div>
    <p class="hint">Pads are listed left→right, top→bottom. Notes are MIDI numbers (36 = kick).</p>`;

  onSeg(body, "cols", (v) => { d.cols = Number(v); });
  onSeg(body, "dvel", (v) => { d.velByPos = v === "pos"; });
  const vel = $(body, "#dVel");
  if (vel) {
    vel.oninput = () => { d.velocity = Number(vel.value); $(body, "#dVelOut").textContent = d.velocity; };
    vel.onchange = save;
  }
  $(body, "#dHHLabel").oninput = (e) => { d.hhLabel = e.target.value; save(); };
  $(body, "#dHHCC").onchange = (e) => { d.hhCC = num(e.target.value, -1, 127, d.hhCC); e.target.value = d.hhCC; save(); };
  body.querySelectorAll(".artic-row").forEach((row) => {
    const i = Number(row.dataset.i);
    const p = d.pads[i];
    $(row, '[data-k="label"]').oninput = (e) => { p.label = e.target.value; save(); };
    $(row, '[data-k="num"]').onchange = (e) => { p.num = num(e.target.value, 0, 127, p.num); save(); render(); };
    const swap = (j) => { if (j < 0 || j >= d.pads.length) return; [d.pads[i], d.pads[j]] = [d.pads[j], d.pads[i]]; save(); render(); };
    $(row, "[data-up]").onclick = () => swap(i - 1);
    $(row, "[data-down]").onclick = () => swap(i + 1);
    $(row, "[data-del]").onclick = () => { d.pads.splice(i, 1); save(); render(); };
  });
  $(body, "#dAdd").onclick = () => { d.pads.push({ label: "Pad", num: 36 }); save(); render(); };
  $(body, "#dExtras").onclick = () => {
    const have = new Set(d.pads.map((p) => p.num));
    const add = SD3_EXTRAS.filter((p) => !have.has(p.num));
    d.pads.push(...add.map((p) => ({ ...p })));
    save();
    render();
    toast(add.length ? `${add.length} pads added` : "Already there");
  };
  $(body, "#dReset").onclick = () => { d.pads = makeProfile("sd3").drums.pads; save(); render(); };
}

// --- Perform -------------------------------------------------------------------

function perform(body) {
  const pf = P().perform;
  body.innerHTML = `
    ${field("Pitch bend + mod", seg("bm", [["strips", "Two strips"], ["pad", "One XY pad"]], pf.bendModPad ? "pad" : "strips"))}
    <p class="hint">${pf.bendModPad
      ? "XY pad: left/right = pitch bend (springs back to the centre line when you let go), up/down = mod wheel (stays)."
      : "Bend springs back to centre when you let go; mod stays where you leave it. Set the bend range in the synth."}</p>
    ${pf.bendModPad ? "" : toggle("rBend", "Show pitch bend strip", "", pf.bend)}
    ${field("Mod CC (1 = mod wheel; −1 hides the mod strip)", `<input type="number" id="rMod" min="-1" max="127" value="${pf.modCC}">`)}
    ${field("XY pad", `<div class="row">
      <label class="mini">X CC<input type="number" id="rXcc" min="0" max="127" value="${pf.xy.xcc}"></label>
      <label class="mini grow">X label<input type="text" id="rXl" value="${esc(pf.xy.xlabel)}"></label>
    </div><div class="row">
      <label class="mini">Y CC<input type="number" id="rYcc" min="0" max="127" value="${pf.xy.ycc}"></label>
      <label class="mini grow">Y label<input type="text" id="rYl" value="${esc(pf.xy.ylabel)}"></label>
    </div>`)}
    ${toggle("rSpring", "XY springs back to centre", "", pf.xy.spring)}
    <p class="hint">In the synth, MIDI-learn the parameter you want on each axis, then move the XY pad.</p>`;

  onSeg(body, "bm", (v) => { pf.bendModPad = v === "pad"; });
  const bend = $(body, "#rBend");
  if (bend) bend.onchange = (e) => { pf.bend = e.target.checked; save(); };
  $(body, "#rMod").onchange = (e) => { pf.modCC = num(e.target.value, -1, 127, pf.modCC); save(); };
  $(body, "#rXcc").onchange = (e) => { pf.xy.xcc = num(e.target.value, 0, 127, pf.xy.xcc); save(); };
  $(body, "#rYcc").onchange = (e) => { pf.xy.ycc = num(e.target.value, 0, 127, pf.xy.ycc); save(); };
  $(body, "#rXl").oninput = (e) => { pf.xy.xlabel = e.target.value; save(); };
  $(body, "#rYl").oninput = (e) => { pf.xy.ylabel = e.target.value; save(); };
  $(body, "#rSpring").onchange = (e) => { pf.xy.spring = e.target.checked; save(); };
}
