import { GraciaApp, envCoefsFromPreset, loadGraciaModule } from "@gracia/web-sdk/core";
import { WORLD_NAMES } from "./config.js";
import { loadConfiguredSources } from "./GraciaSources.js";
import "./styles.css";

const $ = (id) => document.getElementById(id);
const mk = (tag, cls, par) => {
  const element = document.createElement(tag);
  if (cls) element.className = cls;
  par?.appendChild(element);
  return element;
};
const clamp = (value, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, value));
const fmt = (time) => (!Number.isFinite(time) || time < 0 ? "0:00" : `${Math.trunc(time / 60)}:${String(Math.trunc(time) % 60).padStart(2, "0")}`);

const worldName = $("world-name");
const status = $("status");
const loader = $("loader");
const loaderText = $("loaderText");

const sources = [];
let app = null;
let activeSource = null;
let relightOn = true;
let disposeBar = null;
let firstReady = false;
let loadSceneImpl = null;

function setStatus(message) {
  status.textContent = message;
}

function setLoaderMessage(message) {
  if (loaderText) loaderText.textContent = message;
}

function showLoader(light = false) {
  if (!loader) return;
  loader.classList.remove("hidden");
  loader.classList.toggle("light", light);
  loader.setAttribute("aria-busy", "true");
}

function hideLoader() {
  if (!loader) return;
  loader.classList.add("hidden");
  loader.classList.remove("light");
  loader.setAttribute("aria-busy", "false");
}

function beginLoading(message = "Loading scene…", light = false) {
  showLoader(light);
  setLoaderMessage(message);
}

function syncWorldLabel(src) {
  worldName.textContent = WORLD_NAMES[src?.label] ?? src?.displayName ?? src?.label ?? "World Foundation Model";
}

function buildEnvCoefficients(profile) {
  if (!profile) return null;
  return envCoefsFromPreset(profile);
}

function applyEnvLighting(profile) {
  const player = app?.player;
  if (!player) return;
  if (!relightOn || !profile) {
    player.clearEnvLighting?.();
    return;
  }
  player.clearEnvLighting?.();
  player.setEnvLighting(buildEnvCoefficients(profile), 1.0);
}

function applySourceEnvLighting(src = activeSource) {
  applyEnvLighting(src?.envLighting);
}

function syncSourceDropdown(src) {
  if (!src) return;
  $("srcToggle").textContent = src.label;
  for (const button of $("srcMenu").querySelectorAll(".dd-item")) {
    button.classList.toggle("active", button.dataset.src === src.id);
  }
}

function onSceneChange(src) {
  activeSource = src;
  syncWorldLabel(src);
  syncSourceDropdown(src);
  applySourceEnvLighting(src);
}

function loadScene(index) {
  beginLoading(firstReady ? "Switching world…" : "Loading scene…", firstReady);
  loadSceneImpl(index);
}

function openSource(src) {
  if (!app || !src) return;

  const index = sources.findIndex((candidate) => candidate.id === src.id);
  if (index < 0) return;

  if (app.sceneIndex === index && activeSource?.id === src.id) {
    app.player?.play?.();
    syncSourceDropdown(src);
    syncWorldLabel(src);
    return;
  }

  loadScene(index);
}

function transitionWorld(offset) {
  if (!app || !sources.length) return;
  const currentIndex = app.sceneIndex >= 0 ? app.sceneIndex : 0;
  const nextIndex = (currentIndex + offset + sources.length) % sources.length;
  loadScene(nextIndex);
}

async function loadSources() {
  sources.push(...(await loadConfiguredSources()));
  if (!sources.length) {
    $("srcToggle").textContent = "No sources";
    Object.assign(mk("button", "dd-item", $("srcMenu")), { textContent: "No configured sources" }).disabled = true;
    return;
  }
  for (const source of sources) {
    Object.assign(mk("button", "dd-item", $("srcMenu")), { textContent: source.label }).dataset.src = source.id;
  }
}

function initDropdown() {
  const dd = $("srcDD");
  const toggle = $("srcToggle");
  const menu = $("srcMenu");

  toggle.onclick = () => dd.classList.toggle("open");
  document.addEventListener("click", (event) => {
    if (!dd.contains(event.target)) dd.classList.remove("open");
  });

  menu.onclick = (event) => {
    const item = event.target.closest(".dd-item");
    if (!item) return;
    dd.classList.remove("open");
    const source = sources.find((candidate) => candidate.id === item.dataset.src);
    if (source) openSource(source);
  };
}

function initRelightToggle() {
  const toggle = $("toggleProbe");
  toggle.onclick = () => {
    relightOn = !relightOn;
    toggle.classList.toggle("on", relightOn);
    applySourceEnvLighting();
  };
  toggle.classList.toggle("on", relightOn);
}

function mountBar(player, container) {
  const bar = mk("div", "vb", container);
  const btn = mk("button", "vb-btn", bar);
  const track = mk("div", "vb-track", bar);
  const fill = mk("div", "vb-fill", track);
  const thumb = mk("div", "vb-thumb", track);
  const time = mk("span", "vb-time", bar);
  const icons = { play: "\u25B6", pause: "\u23F8", spin: "\u27F3" };
  let currentIcon = "";
  let dragging = false;
  let rafId = 0;

  const duration = () => player.duration ?? 0;
  const pos = (value) => {
    fill.style.width = `${value * 100}%`;
    thumb.style.left = `${value * 100}%`;
  };
  const pct = (event) => clamp((event.clientX - track.getBoundingClientRect().left) / track.offsetWidth);
  const toggle = () => {
    if (!player) return;
    player.isPlaying ? player.pause() : player.play();
  };

  function icon(name) {
    if (name === currentIcon) return;
    currentIcon = name;
    const size = name === "play" ? 14 : 12;
    btn.innerHTML = `<span style="color:#fff;font-size:${size}px">${icons[name]}</span>`;
  }

  icon("play");
  btn.onclick = toggle;
  track.onpointerdown = (event) => {
    if (!player) return;
    event.preventDefault();
    dragging = true;
    const value = pct(event);
    pos(value);
    player.seek?.(value * duration());
    track.setPointerCapture(event.pointerId);
  };
  track.onpointermove = (event) => {
    if (!dragging || !player) return;
    const value = pct(event);
    pos(value);
    player.seek?.(value * duration());
  };
  track.onpointerup = () => {
    dragging = false;
  };

  const loop = () => {
    rafId = requestAnimationFrame(loop);
    const busy = player?.isBuffering ?? false;
    icon(busy ? "spin" : player?.isPlaying ? "pause" : "play");
    const current = player?.currentTime ?? 0;
    const total = duration();
    if (!dragging && total > 0) pos(clamp(current / total));
    time.textContent = `${fmt(current)} / ${fmt(total)}`;
  };
  loop();
  return () => {
    cancelAnimationFrame(rafId);
    bar.remove();
  };
}

function resetBar() {
  disposeBar?.();
  disposeBar = app?.player && firstReady ? mountBar(app.player, $("barWrap")) : null;
}

function initWorldButtons() {
  const bind = (button, offset) => {
    if (!button) return;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      transitionWorld(offset);
    });
  };
  bind($("prevWorld"), -1);
  bind($("nextWorld"), 1);
  bind($("mobilePrevWorld"), -1);
  bind($("mobileNextWorld"), 1);
}

window.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLElement && ["INPUT", "BUTTON"].includes(event.target.tagName)) return;
  if (event.key === "ArrowRight") {
    event.preventDefault();
    transitionWorld(1);
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    transitionWorld(-1);
  }
});

async function start() {
  try {
    if (!navigator.gpu) {
      throw new Error("WebGPU is required for Gracia playback.");
    }

    const graciaModule = await loadGraciaModule(__GRACIA_MODULE_URL__);
    await loadSources();
    initDropdown();
    initRelightToggle();
    initWorldButtons();

    app = await GraciaApp.create(
      (opts) => graciaModule({ ...opts, print: console.log, printErr: console.error }),
      { container: $("canvasWrap"), mode: "pw" }
    );

    app.onSceneChange = onSceneChange;
    app.onProgress = (pct) => {
      const label = pct > 0 && pct < 100 ? `Loading ${pct}%` : firstReady ? "Switching world…" : "Loading scene…";
      setLoaderMessage(label);
    };
    app.onReady = () => {
      hideLoader();
      if (!firstReady) firstReady = true;
      resetBar();
      applySourceEnvLighting();
      setStatus("Use left and right arrows to switch between 3DGS worlds.");
    };
    app.onError = (error) => {
      hideLoader();
      console.error("Gracia playback error:", error);
      setStatus(typeof error === "object" && error?.message ? error.message : "Playback failed.");
    };

    loadSceneImpl = app.loadScene.bind(app);
    app.loadScene = loadScene;

    app.sources = sources;
    app.start();

    if (sources.length) {
      loadScene(0);
    } else {
      hideLoader();
      setStatus("Add sources to public/sources.json.");
    }
  } catch (error) {
    hideLoader();
    console.error("Failed to initialize 4DGS + World Foundation Model demo:", error);
    worldName.textContent = "Load failed";
    setStatus(error.message || "Could not initialize the combined scene.");
  }
}

start();
