import {
  DEFAULT_RELIGHT_DIRECTIONAL_SCALE,
  DEFAULT_RELIGHT_MAX_DIRECTIONAL_RATIO,
  DEFAULT_RELIGHT_PROBE_CAPTURE_ATTEMPTS,
  DEFAULT_RELIGHT_PROBE_POSITION,
  DEFAULT_RELIGHT_PROBE_SETTLE_FRAMES,
  DEFAULT_RELIGHT_PROBE_SIZE,
  DEFAULT_RELIGHT_PROBE_STABILITY_EPSILON
} from "./config.js";
import { coefficientsForRelight, generateRelightProbeFromScene } from "./RelightingProbes.js";

const RELIGHT_READY_RETRY_LIMIT = 20;

export function createRelightingRuntime({
  renderer,
  scene,
  splatSlots,
  captureExclusions,
  getActiveSplats,
  getCurrentPreset,
  getEnvLighting,
  getLightDirection,
  onStateChange
}) {
  let activeWorldProbe = null;
  let relightMode = "preset";
  let probeOn = false;
  let relightProbeRequest = 0;
  let relightApplyRequest = 0;
  const generatedWorldProbes = new Map();

  const notify = () => onStateChange?.();

  function state() {
    return { activeWorldProbe, relightMode, probeOn };
  }

  function setPresetMode() {
    relightMode = "preset";
  }

  function setProbeEnabled(enabled) {
    probeOn = enabled;
    applyRelight();
  }

  function invalidateWorldRelightProbe() {
    relightProbeRequest++;
    activeWorldProbe = null;
    notify();
    applyRelight();
  }

  async function syncWorldRelightProbe(worldDef) {
    const request = ++relightProbeRequest;
    activeWorldProbe = null;
    notify();
    applyRelight();

    try {
      const cacheKey = generatedWorldProbeKey(worldDef);
      let probe = generatedWorldProbes.get(cacheKey);
      if (!probe && worldDef.generateEnvironmentProbe) {
        probe = await generateRelightProbeFromScene({
          renderer,
          scene,
          worldDef,
          exclude: [...splatSlots, ...captureExclusions]
        });
        generatedWorldProbes.set(cacheKey, probe);
      }

      if (request !== relightProbeRequest) return;
      activeWorldProbe = probe ?? null;
      notify();
      applyRelight();
    } catch (error) {
      if (request !== relightProbeRequest) return;
      activeWorldProbe = null;
      notify();
      console.warn(`Falling back to preset relighting for ${worldDef?.name ?? "world"}:`, error);
      applyRelight();
    }
  }

  function selectWorldRelightProbe() {
    if (!activeWorldProbe) return;
    relightMode = "world";
    notify();
    applyRelight();
  }

  function applyRelight(retryCount = 0) {
    const active = getActiveSplats();
    const EnvLighting = getEnvLighting();
    const request = ++relightApplyRequest;

    if (!probeOn || !EnvLighting) {
      for (const mesh of splatSlots) mesh.player?.clearEnvLighting?.();
      return;
    }

    if (!active?.player) return;

    if (!active.player.isReady) {
      active.player.clearEnvLighting?.();
      if (retryCount >= RELIGHT_READY_RETRY_LIMIT) return;
      window.setTimeout(() => {
        if (request === relightApplyRequest) applyRelight(retryCount + 1);
      }, 100);
      return;
    }

    const coefficients = coefficientsForRelight({
      preset: getCurrentPreset(),
      worldProbe: relightMode === "world" ? activeWorldProbe : null
    });
    active.player.clearEnvLighting?.();
    active.player.setEnvLighting(new EnvLighting(coefficients).prepare(getLightDirection()), 1.0);
  }

  function generatedWorldProbeKey(worldDef) {
    return [
      worldDef.url,
      worldDef.environmentProbeSize ?? DEFAULT_RELIGHT_PROBE_SIZE,
      worldDef.environmentIntensity ?? 1,
      worldDef.environmentProbeNear ?? 0.05,
      worldDef.environmentProbeFar ?? 80,
      worldDef.environmentProbeSettleFrames ?? DEFAULT_RELIGHT_PROBE_SETTLE_FRAMES,
      worldDef.environmentProbeCaptureAttempts ?? DEFAULT_RELIGHT_PROBE_CAPTURE_ATTEMPTS,
      worldDef.environmentProbeStabilityEpsilon ?? DEFAULT_RELIGHT_PROBE_STABILITY_EPSILON,
      worldDef.environmentProbeDirectionalScale ?? DEFAULT_RELIGHT_DIRECTIONAL_SCALE,
      worldDef.environmentProbeMaxDirectionalRatio ?? DEFAULT_RELIGHT_MAX_DIRECTIONAL_RATIO,
      ...(worldDef.environmentProbePosition ?? DEFAULT_RELIGHT_PROBE_POSITION)
    ].join("|");
  }

  return {
    state,
    setPresetMode,
    setProbeEnabled,
    invalidateWorldRelightProbe,
    syncWorldRelightProbe,
    selectWorldRelightProbe,
    applyRelight
  };
}
