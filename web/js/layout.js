// Layout: section sizes, interface scale, and Layout mode (pinch to resize). Per page.
//
// Sections, top to bottom: faders, articulation pads, perform (bend/mod/XY), drums, keyboard.
// The first visible of faders → drums → perform → pads → keys fills the leftover height;
// the others have their own height. In Layout mode touches don't play; pinching a section:
//   keyboard  ↔ key width (anchored under your fingers), ↕ height, 1 finger drag = scroll
//   faders    ↔ fader width, ↕ height (the keyboard gives/takes the space)
//   others    ↕ height
//   top bar   pinch = whole interface size
// On desktop: Ctrl/⌘ + wheel (or plain wheel) = ↔, Shift + wheel = ↕.

import { state, P, bank, save, emit, clamp, makeProfile, TEMPLATES, whiteIndex } from "./store.js";
import { applyView } from "./keyboard.js";
import { isLayoutMode, setPressed, toast } from "./ui.js";

const $ = (id) => document.getElementById(id);
const SECTIONS = {
  faders: { el: $("secFaders"), height: null, min: 140 },
  pads: { el: $("secPads"), height: "padsHeight", min: 44 },
  perform: { el: $("secPerform"), height: "performHeight", min: 100 },
  drums: { el: $("secDrums"), height: "drumsHeight", min: 120 },
  keys: { el: $("secKeys"), height: "keysHeight", min: 120 },
};
const FLEX_ORDER = ["faders", "drums", "perform", "pads", "keys"];
// The section that fills the leftover height never gets smaller than this; if everything
// doesn't fit, the page scrolls instead of squashing it.
const FLEX_MIN = { faders: 260, drums: 280, perform: 200, pads: 120, keys: 180 };
const fadersRow = $("faders");
const keysViewport = $("keys");

const maxHeight = () => Math.round(window.innerHeight * 0.75);
const flexSection = () => FLEX_ORDER.find((k) => P().layout[k]);

export function applyLayout() {
  const L = P().layout;
  document.documentElement.style.setProperty("--ui-scale", state.uiScale);
  const flex = flexSection();
  for (const [key, sec] of Object.entries(SECTIONS)) {
    sec.el.hidden = !L[key];
    if (key === flex) {
      sec.el.style.flex = "1 1 auto";
      sec.el.style.height = "";
      sec.el.style.minHeight = `${FLEX_MIN[key]}px`;
    } else if (sec.height) {
      // Clamp only what's displayed, never the saved size (a momentarily tiny window
      // while the tablet rotates must not permanently shrink anything).
      sec.el.style.flex = "none";
      sec.el.style.minHeight = "";
      sec.el.style.height = `${clamp(L[sec.height], sec.min, Math.max(sec.min, maxHeight()))}px`;
    }
  }
  // Articulation pads wrap into as many rows as fit.
  const padsGrid = $("pads");
  const rowH = 3.25 * 16 * state.uiScale;
  const avail = (flex === "pads" ? SECTIONS.pads.el.clientHeight : L.padsHeight) - ($("articSets").hidden ? 0 : 3 * 16 * state.uiScale);
  padsGrid.style.setProperty("--pad-rows", Math.max(1, Math.floor(avail / rowH)));

  // Bend/Mod strips-or-pad switch in the Layout banner (only when the page has a perform section).
  const bm = $("bendModToggle");
  bm.hidden = !L.perform;
  bm.querySelectorAll("button").forEach((b) => setPressed(b, (b.dataset.v === "pad") === !!P().perform.bendModPad));

  fadersRow.style.setProperty("--fader-flex", L.faderWidth ? `0 1 ${L.faderWidth}px` : "1 1 0");
  setPressed($("btnKeys"), L.keys);
  document.querySelectorAll("#sectionToggles button").forEach((b) => setPressed(b, L[b.dataset.sec]));
  applyView();
}

export function setLayoutMode(onOff) {
  document.body.classList.toggle("layout-mode", onOff);
  setPressed($("btnLayout"), onOff);
}

// --- Gestures ------------------------------------------------------------------

const axisRatio = (a0, a1) => (Math.abs(a0) < 40 ? 1 : Math.abs(a1) / Math.abs(a0));

/** Snapshot of everything a gesture scales from. */
function baseline(points, kind) {
  const first = fadersRow.querySelector(".fader");
  return {
    points,
    L: { ...P().layout },
    ui: state.uiScale,
    faderW: first ? first.getBoundingClientRect().width : 120,
    secH: SECTIONS[kind]?.el.getBoundingClientRect().height ?? 0,
    kbLeft: keysViewport.getBoundingClientRect().left,
  };
}

function resize(kind, sx, sy, g, center) {
  const L = P().layout;
  const isFlex = kind === flexSection();
  if (kind === "header") {
    state.uiScale = Math.round(clamp(g.ui * sx * sy, 0.75, 1.6) * 100) / 100;
  } else if (kind === "keys") {
    // Fully zoomed out = all 128 notes (75 white keys) fit the keyboard's width exactly.
    const fitAll = keysViewport.clientWidth / (whiteIndex(127) + 1);
    const kw = clamp(g.L.keyWidth * sx, fitAll, 160);
    // Keep the key that was under the pinch centre under it.
    const startCx = (g.points[0].x + g.points[g.points.length - 1].x) / 2 - g.kbLeft;
    const anchor = g.L.keyScroll + startCx / g.L.keyWidth;
    L.keyWidth = kw;
    L.keyFit = kw <= fitAll + 0.01; // remembered, so it stays fitted when the screen size changes
    L.keyScroll = anchor - (center.x - g.kbLeft) / kw;
  } else if (kind === "faders") {
    const n = bank().faders.length || 1;
    const rowW = fadersRow.clientWidth;
    const w = clamp((g.L.faderWidth || g.faderW) * sx, 64, rowW);
    L.faderWidth = w * n + 16 * (n - 1) >= rowW ? 0 : Math.round(w);
  }
  // Vertical: a fixed section changes its own height; the flexible one grows by
  // shrinking the keyboard (or the last fixed section) instead.
  const sec = SECTIONS[kind];
  if (sec && sy !== 1) {
    if (!isFlex && sec.height) {
      L[sec.height] = clamp(g.L[sec.height] * sy, sec.min, maxHeight());
    } else {
      const donor = ["keys", "drums", "perform", "pads"].find((k) => k !== kind && L[k] && SECTIONS[k].height);
      if (donor) {
        const h = SECTIONS[donor].height;
        L[h] = clamp(g.L[h] - g.secH * (sy - 1), SECTIONS[donor].min, maxHeight());
      }
    }
  }
  applyLayout();
}

function attachGestures(el, kind) {
  const pts = new Map();
  let g = null;
  const list = () => [...pts.values()];

  el.addEventListener("pointerdown", (e) => {
    if (!isLayoutMode() || e.target.closest("button:not(.pad):not(.drum-pad), input, select")) return;
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch {} // not every pointer can be captured
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    g = baseline(list(), kind);
  });

  el.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = list();
    const s = g.points;
    if (p.length === 1 && s.length === 1) {
      if (kind === "keys") {
        P().layout.keyScroll = g.L.keyScroll - (p[0].x - s[0].x) / P().layout.keyWidth;
        applyView();
      }
      return;
    }
    if (p.length >= 2 && s.length >= 2) {
      const sx = axisRatio(s[0].x - s[1].x, p[0].x - p[1].x);
      const sy = axisRatio(s[0].y - s[1].y, p[0].y - p[1].y);
      const d0 = Math.hypot(s[0].x - s[1].x, s[0].y - s[1].y);
      const d1 = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      const center = { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
      if (kind === "header") resize(kind, d0 > 20 ? d1 / d0 : 1, 1, g, center);
      else resize(kind, sx, sy, g, center);
    }
  });

  const end = (e) => {
    if (!pts.delete(e.pointerId)) return;
    g = baseline(list(), kind); // re-baseline so lifting one finger doesn't jump
    if (!pts.size) save();
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);

  el.addEventListener("wheel", (e) => {
    if (!isLayoutMode()) return;
    e.preventDefault();
    const point = { x: e.clientX, y: e.clientY };
    if (kind === "keys" && !e.ctrlKey && !e.metaKey && !e.shiftKey && Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      P().layout.keyScroll += e.deltaX / P().layout.keyWidth;
      applyView();
    } else {
      const f = Math.exp(-e.deltaY * 0.0015);
      resize(kind, e.shiftKey ? 1 : f, e.shiftKey ? f : 1, baseline([point], kind), point);
    }
    save();
  }, { passive: false });
}

export function initLayout() {
  for (const key of Object.keys(SECTIONS)) attachGestures(SECTIONS[key].el, key);
  attachGestures($("topbar"), "header");

  $("btnLayout").onclick = () => setLayoutMode(!isLayoutMode());
  $("btnLayoutDone").onclick = () => setLayoutMode(false);
  $("btnResetLayout").onclick = () => {
    const fresh = makeProfile(P().template in TEMPLATES ? P().template : "blank").layout;
    P().layout = fresh;
    state.uiScale = 1;
    applyLayout();
    save();
    toast("Layout reset");
  };
  document.querySelectorAll("#sectionToggles button").forEach((b) => {
    b.onclick = () => {
      P().layout[b.dataset.sec] = !P().layout[b.dataset.sec];
      applyLayout();
      save();
    };
  });
  document.querySelectorAll("#bendModToggle button").forEach((b) => {
    b.onclick = () => {
      P().perform.bendModPad = b.dataset.v === "pad";
      save();
      emit("rerender");
    };
  });
  $("btnKeys").onclick = () => {
    P().layout.keys = !P().layout.keys;
    applyLayout();
    save();
  };
  window.addEventListener("resize", applyLayout);
}
