import * as THREE from "three";
import { GaussianTransitionWorldManager } from "./GaussianTransitionWorldManager.js";
import { OrbitKeyboardControls } from "./OrbitKeyboardControls.js";
import {
  SCENE_PRESETS,
  SHADOW_PLANE_Y,
  SOURCE_POSITION_OFFSETS,
  SOURCE_SHADOW_Y,
  SOURCE_YAW_OFFSETS
} from "./config.js";
import { loadConfiguredSources, sourceForWorld } from "./GraciaSources.js";
import { createRelightingRuntime } from "./RelightingRuntime.js";
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

const canvas = $("scene");
const worldName = $("world-name");
const status = $("status");

const scene = new THREE.Scene();
scene.background = new THREE.Color("#05070c");
scene.fog = new THREE.Fog("#05070c", 22, 46);

const amb = new THREE.AmbientLight(0x6688aa, 0.32);
const dir = new THREE.DirectionalLight(0xffd59a, 1.2);
dir.position.set(-3, 7, -4);
dir.castShadow = true;
dir.shadow.mapSize.set(2048, 2048);
dir.shadow.camera.near = 0.1;
dir.shadow.camera.far = 30;
dir.shadow.camera.left = -8;
dir.shadow.camera.right = 8;
dir.shadow.camera.top = 8;
dir.shadow.camera.bottom = -8;
dir.shadow.bias = -0.0005;
dir.shadow.radius = 4;
dir.shadow.blurSamples = 8;
scene.add(amb, dir);

const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  powerPreference: "high-performance",
  stencil: false,
  depth: true
});

renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const shadowPlane = new THREE.Mesh(
  new THREE.CircleGeometry(4.8, 96),
  new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.34, transparent: true })
);
shadowPlane.rotation.x = -Math.PI / 2;
shadowPlane.position.set(0, -3.2, 0);
shadowPlane.receiveShadow = true;
shadowPlane.renderOrder = 1;
scene.add(shadowPlane);

const listener = new THREE.AudioListener();
camera.add(listener);

const manager = new GaussianTransitionWorldManager(scene, renderer);
const controls = new OrbitKeyboardControls(camera, canvas);
const clock = new THREE.Clock();

const SPLAT_DEFAULTS = { pos: [0, -2.0, 0], scl: 2.4 };
const SOURCE_FADE_MS = 900;
const sources = [];
const splatSlots = [];
const relightCaptureExclusions = [shadowPlane];
let activeSplatIndex = -1;
let activeSource = null;
let sourceTransitionToken = 0;
let tickBar = null;
let SplatsMesh = null;
let GraciaPlayer = null;
let ModuleFactory = null;
let EnvLighting = null;
let curScene = "studio";
let useVSM = false;
let dofOn = true;
let mobilePlaybackUnlockInstalled = false;
let pendingAudioUnlock = false;

async function loadGraciaRuntime() {
  if (SplatsMesh && GraciaPlayer && ModuleFactory) return;
  const runtimeBaseUrl = new URL("dist/", document.baseURI);
  const [sdk, wasm] = await Promise.all([
    import(/* @vite-ignore */ new URL("GraciaAIO.js", runtimeBaseUrl).href),
    import(/* @vite-ignore */ new URL("GraciaWebCore.js", runtimeBaseUrl).href)
  ]);
  SplatsMesh = sdk.SplatsMesh;
  GraciaPlayer = sdk.GraciaPlayer;
  EnvLighting = sdk.EnvLighting;
  ModuleFactory = wasm.default;
}

function setStatus(message) {
  status.textContent = message;
}

function syncWorldLabel() {
  worldName.textContent = manager.worldDefinitions[manager.currentWorldIndex]?.name || "World Foundation Model";
}

async function transition(offset) {
  if (manager.isTransitioning) return;
  const currentIndex = manager.currentWorldIndex;
  const nextIndex = (currentIndex + offset + manager.worldDefinitions.length) % manager.worldDefinitions.length;
  const nextWorld = manager.worldDefinitions[nextIndex];
  setStatus(`Interpolating to ${nextWorld.name}...`);
  relighting.invalidateWorldRelightProbe();
  const sourceTransition = activateSourceForWorld(nextWorld);
  const didTransition = await manager.go(offset);
  await relighting.syncWorldRelightProbe(manager.worldDefinitions[manager.currentWorldIndex]);
  await sourceTransition;
  syncWorldLabel();
  setStatus(didTransition ? "Use left and right arrows to transition the 3DGS world." : "Transition skipped.");
}

async function loadSources() {
  sources.push(...(await loadConfiguredSources()));

  if (!sources.length) {
    $("srcToggle").textContent = "Open .mint file";
    Object.assign(mk("button", "dd-item", $("srcMenu")), { textContent: "No configured sources" }).disabled = true;
    return;
  }

  for (const source of sources) Object.assign(mk("button", "dd-item", $("srcMenu")), { textContent: source.label }).dataset.src = source.id;
}

function activeSplats() {
  return splatSlots[activeSplatIndex] ?? null;
}

const relighting = createRelightingRuntime({
  renderer,
  scene,
  splatSlots,
  captureExclusions: relightCaptureExclusions,
  getActiveSplats: activeSplats,
  getCurrentPreset: () => SCENE_PRESETS[curScene],
  getEnvLighting: () => EnvLighting,
  getLightDirection: () => dir.position.clone().normalize(),
  onStateChange: () => renderSceneMenu()
});

async function createGraciaSplats(visible = false) {
  await loadGraciaRuntime();
  if (!navigator.gpu) throw new Error("WebGPU not available");

  const player = await GraciaPlayer.create(
    (opts) => ModuleFactory({ ...opts, print: console.log, printErr: console.error }),
    { gl: renderer.getContext(), backend: "hybrid" }
  );
  const mesh = new SplatsMesh(player);
  mesh.enableMesh = true;
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  mesh.visible = visible;
  mesh.traverse?.((child) => {
    child.castShadow = true;
    child.receiveShadow = false;
  });
  scene.add(mesh);
  return mesh;
}

async function initGracia() {
  splatSlots.push(await createGraciaSplats(true), await createGraciaSplats(false));
  activeSplatIndex = 0;
}

function applyInitialTransform(mesh, src) {
  if (!mesh) return;
  const transform = src.initialTransform;
  if (transform) {
    if (transform.rotation) mesh.quaternion.set(transform.rotation.x, transform.rotation.y, transform.rotation.z, transform.rotation.w);
    else mesh.quaternion.identity();

    if (transform.translation) {
      mesh.position.set(
        transform.translation.x + SPLAT_DEFAULTS.pos[0],
        transform.translation.y + SPLAT_DEFAULTS.pos[1],
        transform.translation.z + SPLAT_DEFAULTS.pos[2]
      );
    } else {
      mesh.position.set(...SPLAT_DEFAULTS.pos);
    }

    if (transform.scale) {
      mesh.scale.set(transform.scale.x * SPLAT_DEFAULTS.scl, transform.scale.y * SPLAT_DEFAULTS.scl, transform.scale.z * SPLAT_DEFAULTS.scl);
    } else {
      mesh.scale.setScalar(SPLAT_DEFAULTS.scl);
    }
  } else {
    mesh.position.set(...SPLAT_DEFAULTS.pos);
    mesh.quaternion.identity();
    mesh.scale.setScalar(SPLAT_DEFAULTS.scl);
  }

  const yawOffset = SOURCE_YAW_OFFSETS[src.label] ?? 0;
  if (yawOffset) {
    const worldYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yawOffset);
    mesh.quaternion.premultiply(worldYaw);
  }

  const positionOffset = SOURCE_POSITION_OFFSETS[src.label];
  if (positionOffset) mesh.position.add(new THREE.Vector3().fromArray(positionOffset));

  mesh.userData.baseScale = mesh.scale.clone();
}

function setSplatOpacity(mesh, opacity) {
  if (!mesh) return;
  const value = clamp(opacity);
  mesh.visible = value > 0.01;

  // The GRACIA splat shader does not behave like a normal mesh material; mutating
  // opacity/transparent on its internals can make the 4DGS asset render black.
  const baseScale = mesh.userData.baseScale;
  if (baseScale) mesh.scale.copy(baseScale).multiplyScalar(0.94 + value * 0.06);
}

function easeInOut(value) {
  return value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

function shadowYForSource(src) {
  return SOURCE_SHADOW_Y[src?.label] ?? SHADOW_PLANE_Y;
}

function syncSourceDropdown(src) {
  if (!src) return;
  $("srcToggle").textContent = src.label;
  for (const button of $("srcMenu").querySelectorAll(".dd-item")) button.classList.toggle("active", button.dataset.src === src.id);
}

function safePlay(player) {
  if (!player) return;
  try {
    const result = player.play();
    result?.catch?.((error) => {
      console.warn("4DGS playback was blocked until user interaction:", error);
      installMobilePlaybackUnlock();
    });
  } catch (error) {
    console.warn("4DGS playback was blocked until user interaction:", error);
    installMobilePlaybackUnlock();
  }
}

function sourceWithoutAudio(src) {
  if (!src?.audio) return src;
  const { audio, ...playbackSource } = src;
  return playbackSource;
}

function ensureActivePlayback() {
  const player = activeSplats()?.player;
  if (!player || player.isPlaying) return;
  safePlay(player);
}

function hasUserActivation() {
  return Boolean(navigator.userActivation?.hasBeenActive);
}

function shouldDeferInitialPlayback() {
  return matchMedia("(pointer: coarse)").matches || /iP(hone|ad|od)|Safari/i.test(navigator.userAgent);
}

function attachActiveAudioIfAllowed() {
  const active = activeSplats();
  if (!activeSource?.audio || !active) return;

  if (!hasUserActivation()) {
    pendingAudioUnlock = true;
    installMobilePlaybackUnlock();
    return;
  }

  pendingAudioUnlock = false;
  active.setAudio(activeSource.audio, listener);
}

function installMobilePlaybackUnlock() {
  if (mobilePlaybackUnlockInstalled) return;
  mobilePlaybackUnlockInstalled = true;

  const unlock = () => {
    if (pendingAudioUnlock) attachActiveAudioIfAllowed();
    ensureActivePlayback();
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("touchstart", unlock);
  };

  window.addEventListener("pointerdown", unlock, { passive: true });
  window.addEventListener("touchstart", unlock, { passive: true });
}

function animateSourceFade(incoming, outgoing, token) {
  const start = performance.now();
  setSplatOpacity(incoming, 0);
  setSplatOpacity(outgoing, outgoing ? 1 : 0);

  return new Promise((resolve) => {
    const step = (time) => {
      if (token !== sourceTransitionToken) {
        resolve(false);
        return;
      }

      const t = clamp((time - start) / SOURCE_FADE_MS);
      const eased = easeInOut(t);
      setSplatOpacity(incoming, eased);
      setSplatOpacity(outgoing, 1 - eased);

      if (t >= 1) {
        setSplatOpacity(incoming, 1);
        if (outgoing) {
          outgoing.player?.close();
          setSplatOpacity(outgoing, 0);
        }
        resolve(true);
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

async function openSource(src, { fade = true, syncUi = true, autoplay = true } = {}) {
  if (!src || !splatSlots.length) return false;
  if (activeSource?.id === src.id) {
    shadowPlane.position.y = shadowYForSource(src);
    if (syncUi) syncSourceDropdown(src);
    if (autoplay) ensureActivePlayback();
    return true;
  }

  const token = ++sourceTransitionToken;
  const outgoingIndex = activeSplatIndex;
  const outgoing = splatSlots[outgoingIndex] ?? null;
  const incomingIndex = outgoingIndex >= 0 ? (outgoingIndex + 1) % splatSlots.length : 0;
  const incoming = splatSlots[incomingIndex];
  const player = incoming.player;
  player.close();
  applyInitialTransform(incoming, src);
  player.open(sourceWithoutAudio(src));
  if (autoplay) {
    safePlay(player);
    window.setTimeout(() => {
      if (token === sourceTransitionToken && activeSplatIndex === incomingIndex) ensureActivePlayback();
    }, 250);
  } else {
    installMobilePlaybackUnlock();
  }

  activeSplatIndex = incomingIndex;
  activeSource = src;
  attachActiveAudioIfAllowed();
  shadowPlane.position.x = incoming.position.x;
  shadowPlane.position.y = shadowYForSource(src);
  shadowPlane.position.z = incoming.position.z;
  if (syncUi) syncSourceDropdown(src);
  relighting.applyRelight();

  if (!fade || !outgoing || outgoing === incoming) {
    setSplatOpacity(incoming, 1);
    setSplatOpacity(outgoing, 0);
    return true;
  }

  return animateSourceFade(incoming, outgoing, token);
}

function activateSourceForWorld(worldDef) {
  const source = sourceForWorld(sources, worldDef);
  return source ? openSource(source, { fade: true, syncUi: true }) : Promise.resolve(false);
}

function applyScenePreset(name) {
  const preset = SCENE_PRESETS[name];
  if (!preset) return;

  relighting.setPresetMode();
  curScene = name;
  scene.background = new THREE.Color(preset.bg);
  scene.fog = new THREE.Fog(preset.fog, preset.fogNear, preset.fogFar);
  amb.color.setHex(preset.amb);
  amb.intensity = preset.ambI;
  dir.color.setHex(preset.dir);
  dir.intensity = preset.dirI;
  dir.position.set(...preset.dirPos);
  renderer.toneMappingExposure = preset.exposure;

  renderSceneMenu();
  relighting.applyRelight();
}

function renderSceneMenu() {
  const toggle = $("sceneToggle");
  const menu = $("sceneMenu");
  if (!toggle || !menu) return;

  const { activeWorldProbe, relightMode } = relighting.state();
  menu.replaceChildren();
  for (const [key, preset] of Object.entries(SCENE_PRESETS)) {
    const active = relightMode === "preset" && key === curScene;
    const item = Object.assign(mk("button", `dd-item${active ? " active" : ""}`, menu), { textContent: preset.label });
    item.dataset.type = "preset";
    item.dataset.val = key;
  }

  const worldDef = manager.worldDefinitions[manager.currentWorldIndex];
  if (activeWorldProbe) {
    const active = relightMode === "world";
    const label = `${worldDef?.name ?? activeWorldProbe.name} (WFM)`;
    const item = Object.assign(mk("button", `dd-item${active ? " active" : ""}`, menu), { textContent: label });
    item.dataset.type = "world";
  }

  toggle.textContent = relightMode === "world" && activeWorldProbe ? `${worldDef?.name ?? activeWorldProbe.name} (WFM)` : SCENE_PRESETS[curScene].label;
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
    if (!source) return;

    openSource(source, { fade: true, syncUi: true });
  };

  $("fileBtn").onclick = async () => {
    if (window.showOpenFilePicker) {
      let handles;
      try {
        handles = await showOpenFilePicker({
          types: [{ description: "Volumetric video", accept: { "application/octet-stream": [".mint"] } }]
        });
      } catch {
        return;
      }
      const handle = handles[0];
      toggle.textContent = handle.name;
      for (const button of menu.querySelectorAll(".dd-item")) button.classList.remove("active");
      openSource({ id: handle.name, label: handle.name, localFile: handle }, { fade: true, syncUi: false });
    } else {
      $("fileInput").click();
    }
  };

  $("fileInput").onchange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    toggle.textContent = file.name;
    for (const button of menu.querySelectorAll(".dd-item")) button.classList.remove("active");
    openSource({ id: file.name, label: file.name, file, localFile: file }, { fade: true, syncUi: false });
  };
}

function initSceneControls() {
  const dd = $("sceneDD");
  const toggle = $("sceneToggle");
  const menu = $("sceneMenu");

  renderSceneMenu();

  toggle.onclick = () => dd.classList.toggle("open");
  document.addEventListener("click", (event) => {
    if (!dd.contains(event.target)) dd.classList.remove("open");
  });
  menu.onclick = (event) => {
    const item = event.target.closest(".dd-item");
    if (!item) return;
    dd.classList.remove("open");
    if (item.dataset.type === "world") relighting.selectWorldRelightProbe();
    else applyScenePreset(item.dataset.val);
  };

  $("toggleVSM").onclick = () => {
    useVSM = !useVSM;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = useVSM ? THREE.VSMShadowMap : THREE.PCFShadowMap;
    dir.shadow.radius = useVSM ? 2 : 4;
    dir.shadow.blurSamples = useVSM ? 6 : 8;
    dir.shadow.needsUpdate = true;
    $("toggleVSM").classList.toggle("on", useVSM);
  };

  $("toggleProbe").onclick = () => {
    const nextProbeOn = !relighting.state().probeOn;
    $("toggleProbe").classList.toggle("on", nextProbeOn);
    relighting.setProbeEnabled(nextProbeOn);
  };
  $("toggleProbe").classList.toggle("on", relighting.state().probeOn);

  applyScenePreset(curScene);
}

function initDepthOfFieldControls() {
  const toggle = $("toggleDof");
  const focus = $("dofFocus");
  const aperture = $("dofAperture");
  const focusValue = $("dofFocusValue");
  const apertureValue = $("dofApertureValue");

  const sync = () => {
    const focalDistance = Number(focus.value);
    const apertureSize = Number(aperture.value);
    manager.updateDepthOfField({
      enabled: dofOn,
      focalDistance,
      apertureSize
    });
    toggle.textContent = dofOn ? "On" : "Off";
    toggle.classList.toggle("on", dofOn);
    focus.disabled = !dofOn;
    aperture.disabled = !dofOn;
    focusValue.textContent = focalDistance.toFixed(1);
    apertureValue.textContent = apertureSize.toFixed(2);
  };

  toggle.onclick = () => {
    dofOn = !dofOn;
    sync();
  };
  focus.oninput = sync;
  aperture.oninput = sync;
  sync();
}

function initWorldButtons() {
  const bind = (button, offset) => {
    if (!button) return;
    button.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      ensureActivePlayback();
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      transition(offset).then(() => ensureActivePlayback());
    });
  };

  bind($("prevWorld"), -1);
  bind($("nextWorld"), 1);
  bind($("mobilePrevWorld"), -1);
  bind($("mobileNextWorld"), 1);
}

function mountBar(container) {
  const bar = mk("div", "vb", container);
  const btn = mk("button", "vb-btn", bar);
  const track = mk("div", "vb-track", bar);
  const fill = mk("div", "vb-fill", track);
  const thumb = mk("div", "vb-thumb", track);
  const time = mk("span", "vb-time", bar);
  const icons = { play: "\u25B6", pause: "\u23F8", spin: "\u27F3" };
  let currentIcon = "";
  let dragging = false;

  const player = () => activeSplats()?.player ?? null;
  const duration = () => player()?.duration ?? 0;
  const pos = (value) => {
    fill.style.width = `${value * 100}%`;
    thumb.style.left = `${value * 100}%`;
  };
  const pct = (event) => clamp((event.clientX - track.getBoundingClientRect().left) / track.offsetWidth);
  const toggle = () => {
    const active = player();
    if (!active) return;
    active.isPlaying ? active.pause() : safePlay(active);
  };

  function icon(name) {
    if (name === currentIcon) return;
    currentIcon = name;
    const size = name === "play" ? 14 : 12;
    const margin = name === "play" ? ";margin-left:2px" : "";
    const anim = name === "spin" ? ";animation:spin .7s linear infinite;display:inline-block" : "";
    btn.innerHTML = `<span style="color:#fff;font-size:${size}px${margin}${anim}">${icons[name]}</span>`;
  }

  icon("play");
  btn.onclick = toggle;

  track.onpointerdown = (event) => {
    const active = player();
    if (!active) return;
    event.preventDefault();
    dragging = true;
    const value = pct(event);
    pos(value);
    active.seek?.(value * duration());
    track.setPointerCapture(event.pointerId);
  };
  track.onpointermove = (event) => {
    const active = player();
    if (!dragging || !active) return;
    const value = pct(event);
    pos(value);
    active.seek?.(value * duration());
  };
  track.onpointerup = (event) => {
    if (!dragging) return;
    dragging = false;
    track.releasePointerCapture(event.pointerId);
  };
  track.onpointercancel = () => {
    dragging = false;
  };

  return () => {
    const active = player();
    const busy = active?.isBuffering ?? false;
    icon(busy ? "spin" : active?.isPlaying ? "pause" : "play");
    const current = active?.currentTime ?? 0;
    const total = duration();
    if (!dragging && total > 0) pos(clamp(current / total));
    time.textContent = `${fmt(current)} / ${fmt(total)}`;
  };
}

window.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLElement && ["INPUT", "BUTTON"].includes(event.target.tagName)) return;

  if (event.key === "ArrowRight") {
    event.preventDefault();
    transition(1);
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    transition(-1);
  }
});

window.addEventListener("resize", () => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
});

async function start() {
  try {
    await Promise.all([loadSources(), manager.initialize(setStatus), initGracia()]);
    initDropdown();
    initSceneControls();
    initDepthOfFieldControls();
    initWorldButtons();
    tickBar = mountBar($("barWrap"));
    syncWorldLabel();
    setStatus("Use left and right arrows to transition the 3DGS world.");
    await relighting.syncWorldRelightProbe(manager.worldDefinitions[manager.currentWorldIndex]);

    if (sources.length) {
      const defaultSource = sourceForWorld(sources, manager.worldDefinitions[manager.currentWorldIndex]) ?? sources.find((source) => source.label === "Cycling") ?? sources[0];
      await openSource(defaultSource, { fade: false, syncUi: true, autoplay: !shouldDeferInitialPlayback() });
      installMobilePlaybackUnlock();
    }
  } catch (error) {
    console.error("Failed to initialize 4DGS + World Foundation Model experiment:", error);
    worldName.textContent = "Load failed";
    setStatus(error.message || "Could not initialize the combined scene.");
  }
}

function animate() {
  const delta = clock.getDelta();
  controls.tick(delta);
  renderer.render(scene, camera);
  tickBar?.();
  requestAnimationFrame(animate);
}

start();
animate();
