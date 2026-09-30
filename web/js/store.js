// App state, instrument pages (profiles), persistence, music helpers and a tiny event bus.
//
// Global settings (theme, size, touch behaviour) live on `state`. Everything tied to an
// instrument — faders, articulations, drum pads, keyboard, layout, MIDI channel — lives on a
// *page* in `state.profiles`; `P()` is the page currently shown.

const STORAGE_KEY = "arco-settings";
const OLD_STORAGE_KEY = "string-cc-settings"; // before the rename to Arco; read once if present
export const THEMES = ["midnight", "graphite"];

export const COLORS = ["#f2a93b", "#ef6f5e", "#a57cf2", "#3fc1d9", "#8fd14f", "#f06aa8"];

export const PRESETS = {
  "Spitfire": [["Dynamics", 1], ["Expression", 11], ["Vibrato", 21]],
  "Generic": [["Dynamics", 1], ["Expression", 11], ["Vibrato", 2]],
  "Dyn + Expr": [["Dynamics", 1], ["Expression", 11]],
};

export const SCALES = {
  major: ["Major", [0, 2, 4, 5, 7, 9, 11]],
  minor: ["Natural minor", [0, 2, 3, 5, 7, 8, 10]],
  harmonic: ["Harmonic minor", [0, 2, 3, 5, 7, 8, 11]],
  dorian: ["Dorian", [0, 2, 3, 5, 7, 9, 10]],
  phrygian: ["Phrygian", [0, 1, 3, 5, 7, 8, 10]],
  lydian: ["Lydian", [0, 2, 4, 6, 7, 9, 11]],
  mixolydian: ["Mixolydian", [0, 2, 4, 5, 7, 9, 10]],
  pentatonic: ["Major pentatonic", [0, 2, 4, 7, 9]],
  minorPentatonic: ["Minor pentatonic", [0, 3, 5, 7, 10]],
};

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const isBlack = (n) => [1, 3, 6, 8, 10].includes(n % 12);
const WHITE_OF = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
export const whiteIndex = (n) => Math.floor(n / 12) * 7 + WHITE_OF[n % 12];
export const noteOfWhite = (i) => Math.floor(i / 7) * 12 + [0, 2, 4, 5, 7, 9, 11][i % 7];

/** Note name in the current page's convention: middle C (60) = C4 (REAPER) or C3 (Spitfire/Kontakt). */
export function noteName(n) {
  const middleC = state?.profiles ? P().middleC : 4;
  return `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) + middleC - 5}`;
}

/** Parse "C#3", "Db-1", "60"… in the current page's convention. Returns null if invalid. */
export function parseNote(text) {
  const t = String(text).trim();
  if (/^\d+$/.test(t)) return Math.min(127, Number(t));
  const m = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(t);
  if (!m) return null;
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1].toUpperCase()];
  const acc = m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0;
  const n = (Number(m[3]) - P().middleC + 5) * 12 + base + acc;
  return n >= 0 && n <= 127 ? n : null;
}

// --- Page templates ------------------------------------------------------------

export function makeFader(label, cc, i) {
  return {
    label, cc,
    color: COLORS[i % COLORS.length],
    curve: "linear", // linear | exp | log
    min: 0, max: 127,
    glide: 0, // output smoothing time constant, ms
    linked: false,
    pos: 0, // 0..1 physical position
  };
}

const faders = (list, offset = 0) => list.map(([label, cc], i) => makeFader(label, cc, i + offset));
const emptySnaps = () => [null, null, null, null];
const bankOf = (name, list, offset) => ({ name, faders: faders(list, offset), snapshots: emptySnaps() });
const pad = (label, num, type = "note", val = 100) => ({ label, type, num, val });

// Placeholder keyswitches the old "Strings" page shipped with; removed on upgrade if untouched.
const OLD_PLACEHOLDER_ARTICS = ["Legato", "Sustain", "Staccato", "Spiccato", "Pizzicato", "Tremolo"];

// Spitfire Symphony Orchestra (Kontakt) string techniques, named exactly as the library's
// "Individual techniques" patches. The keyswitch ORDER inside the "All techniques" patches isn't
// readable from disk, so these are grouped Longs → Shorts → Tremolos → Trills → FX and numbered
// chromatically from C-2; match Kontakt's order with ▲▼ + Renumber in Settings → Articulations.
const SSO_LONGS = ["Long", "Long CS", "Long CS Blend", "Long CS Sul Pont", "Long Flautando", "Long Harmonics"];
const SSO_TECHNIQUES = {
  "Violins 1": [...SSO_LONGS, "Long Rachmaninoff Molto Vib", "Long Sul G", "Long Sul Pont", "Long Sul Pont Distorted",
    "Long Sul Tasto", "Long Super Sul Tasto", "Marcato Attack", "Short 0'5", "Short 1'0", "Short Brushed", "Short Brushed CS",
    "Short Col Legno", "Short CS", "Short Harmonics", "Short Pizzicato", "Short Pizzicato Bartok", "Short Spiccato",
    "Tremolo", "Tremolo Measured (150bpm)", "Tremolo Measured (180bpm)", "Tremolo Measured CS (150bpm)", "Tremolo Sul Pont",
    "Trill (Major 2nd)", "Trill (Major 3rd)", "Trill (Minor 2nd)", "Trill (Minor 3rd)", "FX"],
  "Violins 2": [...SSO_LONGS, "Long Rachmaninoff Molto Vib", "Long Sul G", "Long Sul Pont", "Long Super Sul Tasto",
    "Marcato Attack", "Short 0'5", "Short 1'0", "Short Brushed", "Short Brushed CS", "Short Col Legno", "Short CS",
    "Short Harmonics", "Short Pizzicato", "Short Pizzicato Bartok", "Short Spiccato", "Tremolo", "Tremolo CS",
    "Tremolo Measured (150bpm)", "Tremolo Measured (180bpm)", "Tremolo Sul Pont", "Trill (Major 2nd)", "Trill (Minor 2nd)", "FX"],
  "Violas": [...SSO_LONGS, "Long Rachmaninoff Molto Vib", "Long Sul C", "Long Sul Pont", "Long Super Sul Tasto",
    "Marcato Attack", "Short 0'5", "Short 1'0", "Short Brushed", "Short Brushed CS", "Short Col Legno", "Short CS",
    "Short Harmonics", "Short Pizzicato", "Short Pizzicato Bartok", "Short Spiccato", "Tremolo", "Tremolo CS",
    "Tremolo Measured (150bpm)", "Tremolo Measured (180bpm)", "Tremolo Sul Pont", "Trill (Major 2nd)", "Trill (Minor 2nd)", "FX"],
  "Celli": [...SSO_LONGS, "Long Rachmaninoff Molto Vib", "Long Sul C", "Long Sul Pont", "Long Super Sul Tasto",
    "Marcato Attack", "Short 0'5", "Short 1'0", "Short Brushed", "Short Brushed CS", "Short Col Legno", "Short CS",
    "Short Harmonics", "Short Pizzicato", "Short Pizzicato Bartok", "Short Spiccato", "Tremolo", "Tremolo CS",
    "Tremolo Measured (150bpm)", "Tremolo Measured (180bpm)", "Tremolo Measured CS (150bpm)", "Tremolo Sul Pont",
    "Trill (Major 2nd)", "Trill (Major 3rd)", "Trill (Minor 2nd)", "Trill (Minor 3rd)", "FX"],
  "Basses": ["Long", "Long Flautando", "Long Harmonics", "Long Sul Pont", "Long Sul Pont Distorted", "Long Super Sul Tasto",
    "Marcato Attack", "Short 0'5", "Short 1'0", "Short Col Legno", "Short Harmonics", "Short Pizzicato",
    "Short Pizzicato Bartok", "Short Spicc-Pizz", "Short Spiccato", "Short Staccato Dig", "Tremolo",
    "Tremolo Measured (150bpm)", "Tremolo Measured (180bpm)", "Tremolo Sul Pont", "Trill (Major 2nd)", "Trill (Minor 2nd)", "FX"],
  "Ensembles": ["Long", "Long CS", "Long CS Blend", "Long Flautando", "Long Harmonics", "Long Sul Pont", "Long Sul String",
    "Long Super Sul Tasto", "Marcato Attack", "Short 0'5", "Short Brushed", "Short Brushed CS", "Short Col Legno",
    "Short Harmonics", "Short Pizzicato", "Short Pizzicato Bartok", "Short Spiccato", "Short Spiccato CS", "Tremolo",
    "Tremolo CS", "Tremolo SulPont", "Trill (Major 2nd)", "Trill (Minor 2nd)"],
};
// Approximate playable ranges (MIDI notes), shown blue on the keyboard.
const SSO_RANGES = { "Violins 1": [55, 96], "Violins 2": [55, 93], "Violas": [48, 88], "Celli": [36, 81], "Basses": [24, 67], "Ensembles": [24, 96] };

/** Shorten technique names the way the Spitfire player labels them. */
const sfLabel = (t) => t
  .replace("Long Rachmaninoff Molto Vib", "Long (Rachm.)")
  .replace(/^Tremolo Measured CS \((\d+bpm)\)$/, "Trem CS Ms ($1)")
  .replace(/^Tremolo Measured \((\d+bpm)\)$/, "Trem Ms ($1)")
  .replace(/^Tremolo ?Sul ?Pont$/, "Trem Sul Pont")
  .replace(/^Short (Pizzicato Bartok|Pizzicato|Col Legno|Spiccato CS|Spiccato|Spicc-Pizz|Brushed CS|Brushed|Harmonics|Staccato Dig)$/, "$1");

export function ssoSet(section) {
  return {
    name: section,
    range: SSO_RANGES[section],
    pads: SSO_TECHNIQUES[section].map((t, i) => pad(sfLabel(t), i)),
  };
}
export const SSO_SECTIONS = Object.keys(SSO_TECHNIQUES);

// Superior Drummer 3 core library map (from its SDX-Keys.pdf). The GM-compatible notes
// (kick 36, snare 38, hats 42/44/46, toms, crash 49…) are the same as General MIDI.
const SD3_PADS = [
  ["Cymbal 2", 49], ["Cymbal 3", 55], ["Cymbal 4", 57], ["Ride", 51],
  ["Racktom 1", 48], ["Racktom 2", 47], ["Racktom 3", 45], ["Ride Bell", 53],
  ["HH Closed", 42], ["HH Open", 46], ["Floortom 1", 43], ["Floortom 2", 41],
  ["Kick", 36], ["Snare", 38], ["Rimshot", 40], ["HH Pedal", 44],
].map(([label, num]) => ({ label, num }));
export const SD3_EXTRAS = [
  ["Sidestick", 37], ["Snare Edge", 33], ["Snare Roll", 39], ["Snare Rim Only", 71],
  ["Cymbal 5", 52], ["Ride Crash", 59], ["HH Tight", 62], ["HH Closed Tip", 61],
  ["Cym 2 Choke", 50], ["Cym 3 Choke", 56], ["Cym 4 Choke", 58], ["Cym 5 Choke", 54],
  ["Rack 1 Rim", 82], ["Rack 2 Rim", 80], ["Rack 3 Rim", 78], ["Floor 1 Rim", 75],
].map(([label, num]) => ({ label, num }));

function baseProfile(name, template, channel) {
  return {
    name, template, channel,
    middleC: 4,
    bank: 0,
    banks: [bankOf("A", [["CC 20", 20], ["CC 21", 21], ["CC 22", 22]]), bankOf("B", [], 0), bankOf("C", [], 0)],
    artic: { set: 0, sets: [] },
    drums: {
      pads: SD3_PADS.map((p) => ({ ...p })),
      cols: 4,
      velByPos: true, velocity: 100,
      // Hi-hat openness CC. Off by default: SD3 only applies it to its "{CC}" e-drum trigger
      // hi-hat notes, not the fixed GM hi-hat notes (42/44/46) the pads use.
      hhCC: -1, hhLabel: "Hi-hat", hhPos: 0,
      repeat: false, rate: "1/16", bpm: 120,
    },
    perform: {
      bend: true,
      modCC: 1, mod: 0,
      bendModPad: false, // true: one XY pad (X = pitch bend, Y = mod) instead of two strips
      xy: { xcc: 16, ycc: 17, xlabel: "X · CC16", ylabel: "Y · CC17", spring: false, x: 0.5, y: 0.5 },
    },
    layout: {
      faders: true, pads: true, perform: false, drums: false, keys: true,
      keysHeight: 240, padsHeight: 64, performHeight: 220, drumsHeight: 300,
      faderWidth: 0, keyWidth: 52, keyScroll: whiteIndex(48),
    },
    keyboard: {
      velocity: 100, velByPos: true,
      names: "c", scale: "off", scaleRoot: 0, scaleLock: false,
    },
    notes: "",
  };
}

export const TEMPLATES = {
  strings: {
    label: "Default",
    make() {
      const p = baseProfile("Default", "strings", 1);
      p.banks = [
        bankOf("A", PRESETS.Spitfire),
        bankOf("B", PRESETS.Generic),
        bankOf("C", [["CC 20", 20], ["CC 22", 22], ["CC 23", 23]], 3),
      ];
      p.layout.pads = false; // no articulations until you add some (Settings → Articulations)
      return p;
    },
  },
  sso: {
    label: "Spitfire Symphony Orchestra",
    make() {
      const p = baseProfile("Spitfire SSO", "sso", 2);
      p.middleC = 3; // name notes the way the Spitfire player does
      p.banks = [
        bankOf("A", [["Dynamics", 1], ["Expression", 11], ["Vibrato", 21]]),
        bankOf("B", [["Dynamics", 1], ["Expression", 11], ["Tightness", 20]]),
        bankOf("C", [["CC 22", 22], ["CC 23", 23], ["CC 24", 24]], 3),
      ];
      p.artic.sets = SSO_SECTIONS.map(ssoSet);
      p.layout.padsHeight = 170;
      p.layout.keysHeight = 220;
      p.notes =
        "One articulation list per section (Violins 1, Violins 2, Violas, Celli, Basses, Ensembles), named " +
        "exactly like the library's techniques. Keyswitch keys show red and the playable range blue, like the " +
        "Spitfire keyboard; notes are named with middle C = C3 like Spitfire. The ORDER of the keyswitches in " +
        "each \"All techniques\" patch couldn't be read from disk: open the patch in Kontakt, then in " +
        "Settings → Articulations use ▲▼ to match its articulation bar and tap Renumber (C-2 upward). " +
        "▶ sends a keyswitch so you can check which articulation lights up. " +
        "Tightness has no fixed CC: in the plugin right-click Tightness → MIDI Learn, then move the fader.";
      return p;
    },
  },
  serum2: {
    label: "Serum 2 (synth)",
    make() {
      const p = baseProfile("Serum 2", "serum2", 3);
      p.banks = [
        bankOf("A", [["Macro 1", 20], ["Macro 2", 21], ["Macro 3", 22], ["Macro 4", 23]]),
        bankOf("B", [["Macro 5", 24], ["Macro 6", 25], ["Macro 7", 26], ["Macro 8", 27]], 4),
        bankOf("C", [["CC 70", 70], ["CC 71", 71], ["CC 72", 72], ["CC 73", 73]], 2),
      ];
      p.layout = { ...p.layout, pads: false, perform: true, keysHeight: 210, performHeight: 200, keyWidth: 46 };
      p.perform.xy = { xcc: 28, ycc: 29, xlabel: "X · CC28", ylabel: "Y · CC29", spring: false, x: 0.5, y: 0.5 };
      p.notes =
        "Serum doesn't listen to fixed CCs for macros — map them once: in Serum 2 right-click a macro → " +
        "MIDI Learn, then move the matching fader here (Macro 1 = CC20 … Macro 8 = CC27). Do the same for " +
        "the XY pad (CC28/CC29) on any knob you like. Mod wheel (CC1) and pitch bend work out of the box; " +
        "set the bend range in Serum's global/voicing settings.";
      return p;
    },
  },
  sd3: {
    label: "Superior Drummer 3 (drums)",
    make() {
      const p = baseProfile("Superior Drummer 3", "sd3", 10);
      p.banks = [bankOf("A", [["Hi-hat", 4]]), bankOf("B", [], 0), bankOf("C", [], 0)];
      p.layout = { ...p.layout, faders: false, pads: false, drums: true, keys: false, keyScroll: whiteIndex(36) };
      p.notes =
        "Pads follow Superior Drummer 3's core library key map (SDX-Keys.pdf): Kick 36, Snare 38, Rimshot 40, " +
        "Hi-hat 42/46/44, Racktoms 48/47/45, Floortoms 43/41, Cymbals 2/3/4 on 49/55/57, Ride 51 + bell 53. " +
        "Settings → Drums → Add SD3 extras adds sidestick, rim-only, tom rimshots and cymbal chokes. " +
        "Note repeat retriggers held pads at the tempo you set. A hi-hat openness strip (CC4) is available in " +
        "Settings → Drums, but SD3 only applies it to its {CC} e-drum hi-hat trigger notes (see SD3 → Settings → " +
        "MIDI In), not to the fixed hi-hat pads here.";
      return p;
    },
  },
  blank: {
    label: "Blank page",
    make() {
      const p = baseProfile("New page", "blank", 1);
      p.layout.pads = false;
      return p;
    },
  },
};

export function makeProfile(template) {
  return TEMPLATES[template].make();
}

export function defaults() {
  return {
    version: 7,
    theme: "midnight",
    uiScale: 1,
    relative: true,
    hiRes: false,
    fine: false,
    morphMs: 300,
    profile: 0,
    profiles: ["strings", "sso", "serum2", "sd3"].map(makeProfile),
  };
}

// --- Migration -----------------------------------------------------------------

/** Fill fields a saved page may be missing (added in later versions). */
function completeProfile(saved) {
  const base = TEMPLATES[saved.template] ? makeProfile(saved.template) : baseProfile("", "blank", 1);
  return {
    ...base, ...saved,
    layout: { ...base.layout, ...saved.layout },
    keyboard: { ...base.keyboard, ...saved.keyboard },
    drums: { ...base.drums, ...saved.drums },
    perform: { ...base.perform, ...saved.perform, xy: { ...base.perform.xy, ...saved.perform?.xy } },
    artic: saved.artic?.sets ? saved.artic : base.artic,
    banks: Array.isArray(saved.banks) && saved.banks.length ? saved.banks : base.banks,
  };
}

/** v3 → v4: "Strings" page becomes "Default" without the placeholder keyswitches; SD3 hi-hat strip off. */
function upgradeToV4(p) {
  if (p.template === "strings") {
    if (p.name === "Strings") p.name = "Default";
    const sets = p.artic.sets;
    const untouched = sets.length === 1 && sets[0].pads.map((x) => x.label).join() === OLD_PLACEHOLDER_ARTICS.join();
    if (untouched) {
      p.artic = { set: 0, sets: [] };
      p.layout.pads = false;
    }
  }
  if (p.template === "sd3" && p.drums.hhCC === 4) p.drums.hhCC = -1;
}

/** v7 removed the presets row (program changes / REAPER presets) and the Kontakt page built on it. */
function removePresets(profiles, saved) {
  const current = profiles[saved.profile || 0];
  for (let i = profiles.length - 1; i >= 0; i--) {
    if (profiles[i].template === "kontakt" && profiles.length > 1) profiles.splice(i, 1);
  }
  for (const p of profiles) {
    delete p.presets;
    delete p.layout.presets;
    delete p.layout.presetsHeight;
  }
  saved.profile = Math.max(0, profiles.indexOf(current));
}

/** v1 (single fader list) and v2 (banks, one page) become the "Default" page. */
function stringsFromOld(saved) {
  const p = makeProfile("strings");
  if (saved.version === 2) {
    if (Array.isArray(saved.banks) && saved.banks.length) p.banks = saved.banks;
    if (Number.isInteger(saved.bank)) p.bank = saved.bank;
    if (Array.isArray(saved.pads)) p.artic.sets = [{ name: "Articulations", range: null, pads: saved.pads }];
    Object.assign(p.layout, saved.layout);
    Object.assign(p.keyboard, saved.keyboard);
  } else {
    if (Array.isArray(saved.faders) && saved.faders.length) {
      p.banks[0].faders = saved.faders.map((f, i) => ({ ...makeFader(f.label, f.cc, i), pos: (f.value || 0) / 16383 }));
    }
    const kb = saved.keyboard || {};
    if (kb.velocity) p.keyboard.velocity = kb.velocity;
    if ("velByPos" in kb) p.keyboard.velByPos = kb.velByPos;
    if ("show" in kb) p.layout.keys = kb.show;
    if (Number.isInteger(kb.startOctave)) p.layout.keyScroll = whiteIndex(12 * (kb.startOctave + 1));
  }
  if (saved.channel) p.channel = saved.channel;
  upgradeToV4(p);
  return p;
}

function migrate(saved) {
  const d = defaults();
  if (!saved || typeof saved !== "object") return d;
  if (saved.version >= 3 && saved.version <= 7) {
    const profiles = Array.isArray(saved.profiles) && saved.profiles.length ? saved.profiles.map(completeProfile) : d.profiles;
    if (saved.version === 3) profiles.forEach(upgradeToV4);
    removePresets(profiles, saved);
    return { ...d, ...saved, version: 7, profiles, profile: Math.min(saved.profile || 0, profiles.length - 1) };
  }
  for (const k of ["theme", "uiScale", "relative", "hiRes", "fine", "morphMs"]) if (k in saved) d[k] = saved[k];
  d.profiles[0] = stringsFromOld(saved);
  return d;
}

function load() {
  try {
    const s = migrate(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(OLD_STORAGE_KEY)));
    if (!THEMES.includes(s.theme)) s.theme = "midnight"; // e.g. the removed Daylight theme
    return s;
  } catch {
    return defaults();
  }
}

export const state = load();
export const P = () => state.profiles[state.profile];
export const bank = () => P().banks[P().bank];
export const articSet = () => P().artic.sets[P().artic.set] || null;

let saveTimer = 0;
export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
  }, 250);
}

export function resetAll() {
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, defaults());
  save();
}

const listeners = {};
export function on(evt, fn) { (listeners[evt] ||= []).push(fn); }
export function emit(evt, arg) { for (const fn of listeners[evt] || []) fn(arg); }

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
