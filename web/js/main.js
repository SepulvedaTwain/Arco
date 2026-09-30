// Entry point: wires the modules together and runs the page (instrument) switcher.

import { state, P, on, emit, save, TEMPLATES } from "./store.js";
import { connect } from "./net.js";
import { renderFaders } from "./faders.js";
import { renderKeyboard, releaseAll, setSustain, sustainOn } from "./keyboard.js";
import { renderPads } from "./pads.js";
import { renderPerform } from "./perform.js";
import { renderDrums } from "./drums.js";
import { applyLayout, initLayout } from "./layout.js";
import { openSettings } from "./settings.js";
import { icons, esc, toast } from "./ui.js";

const $ = (id) => document.getElementById(id);

for (const el of document.querySelectorAll("[data-icon]")) {
  el.insertAdjacentHTML("afterbegin", icons[el.dataset.icon]);
}

const applyTheme = () => { document.documentElement.dataset.theme = state.theme; };

function rerender() {
  applyTheme();
  renderFaders();
  renderPads();
  renderPerform();
  renderDrums();
  renderKeyboard();
  applyLayout();
  renderPageButton();
}

on("rerender", rerender);
on("theme", applyTheme);
on("layout", applyLayout);
on("open-settings", openSettings);
on("page-name", renderPageButton);

// --- Page switcher -------------------------------------------------------------

const pageBtn = $("btnPage");
const menu = $("pageMenu");

function renderPageButton() {
  pageBtn.querySelector(".page-name").textContent = P().name;
  pageBtn.querySelector(".page-ch").textContent = `Ch ${P().channel}`;
}

function switchPage(i) {
  if (i === state.profile) return;
  // Leave nothing hanging on the old page's channel.
  releaseAll();
  if (sustainOn()) setSustain(false);
  state.profile = i;
  save();
  rerender();
  toast(P().name);
}

function renderMenu() {
  menu.innerHTML = `
    ${state.profiles.map((p, i) => `
      <button class="menu-item" data-i="${i}" aria-current="${i === state.profile}">
        <span class="menu-title">${esc(p.name)}</span>
        <span class="menu-sub">${esc(TEMPLATES[p.template]?.label || "Custom")} · Ch ${p.channel}</span>
      </button>`).join("")}
    <div class="menu-sep"></div>
    <button class="menu-item" data-action="pages"><span class="menu-title">${icons.plus} Add or edit pages…</span></button>`;
  menu.querySelectorAll("[data-i]").forEach((b) => {
    b.onclick = () => { menu.hidden = true; switchPage(Number(b.dataset.i)); };
  });
  menu.querySelector('[data-action="pages"]').onclick = () => { menu.hidden = true; openSettings("page"); };
}

pageBtn.onclick = (e) => {
  e.stopPropagation();
  menu.hidden = !menu.hidden;
  if (!menu.hidden) renderMenu();
};
document.addEventListener("pointerdown", (e) => {
  if (!menu.hidden && !menu.contains(e.target) && !pageBtn.contains(e.target)) menu.hidden = true;
});

// --- Header: connection + MIDI activity ------------------------------------------

const connEl = $("conn");
on("conn", ({ on: isOn, text }) => {
  connEl.classList.toggle("on", isOn);
  connEl.querySelector(".text").textContent = text;
});
const actEl = $("activity");
on("activity", (text) => {
  actEl.querySelector(".text").textContent = text;
  actEl.classList.remove("flash");
  void actEl.offsetWidth; // restart the flash animation
  actEl.classList.add("flash");
});

$("btnSettings").onclick = () => openSettings();

const fullBtn = $("btnFull");
const root = document.documentElement;
const requestFs = root.requestFullscreen || root.webkitRequestFullscreen;
if (!requestFs) fullBtn.hidden = true;
fullBtn.onclick = () => {
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  } else {
    requestFs.call(root);
  }
};

// Keep iOS from zooming the page instead of playing.
document.addEventListener("gesturestart", (e) => e.preventDefault());
document.addEventListener("dblclick", (e) => e.preventDefault());

rerender();
initLayout();
connect();
emit("artic");
