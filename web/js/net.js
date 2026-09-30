// WebSocket link to bridge.py, plus MIDI send helpers that report activity.
// Everything goes out on the current page's MIDI channel.

import { state, P, emit, noteName } from "./store.js";

let ws = null;

export function connect() {
  ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onopen = () => emit("conn", { on: true, text: "connected" });
  ws.onclose = () => {
    emit("conn", { on: false, text: "offline" });
    emit("disconnected"); // the bridge releases held notes / sustain / bend itself
    setTimeout(connect, 1000);
  };
  ws.onerror = () => ws.close();
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if ("pong" in msg) emit("conn", { on: true, text: `${Math.round(performance.now() - msg.pong)} ms` });
  };
}

setInterval(() => raw({ ping: performance.now() }), 2000);

function raw(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

/** list: [{ cc, v }] with v 14-bit (0–16383). */
export function sendCC(list) {
  raw({ cc: list.map(({ cc, v }) => ({ ch: P().channel, cc, v, hr: state.hiRes })) });
  const last = list[list.length - 1];
  emit("activity", `CC${last.cc} ${last.v >> 7}`);
}

/** Pass `ch` for a delayed note-off, so it can't land on another page's channel. */
export function sendNote(n, v, ch = P().channel) {
  raw({ note: [{ ch, n, v }] });
  if (v) {
    emit("activity", `${noteName(n)} ${v}`);
    emit("note-on", n);
  }
}

/** v: 0–16383, 8192 = centre. */
export function sendPitch(v) {
  raw({ pitch: [{ ch: P().channel, v }] });
  emit("activity", `Bend ${v - 8192 > 0 ? "+" : ""}${v - 8192}`);
}

export function sendPanic() {
  raw({ panic: true });
  emit("activity", "All notes off");
}
