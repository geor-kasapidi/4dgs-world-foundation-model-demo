import * as THREE from "three";
import { LightProbeGenerator } from "three/addons/lights/LightProbeGenerator.js";

const COEFFICIENT_COUNT = 27;
const DEFAULT_PROBE_POSITION = [0, 2, 0];
const DEFAULT_SETTLE_FRAMES = 4;
const DEFAULT_CAPTURE_ATTEMPTS = 4;
const DEFAULT_STABILITY_EPSILON = 0.01;
// Keep directional SH subtle by default: enough for contextual color variation,
// but not enough to reintroduce the dark lobe artifacts seen in bad captures.
const DEFAULT_DIRECTIONAL_SCALE = 0.18;
const DEFAULT_MAX_DIRECTIONAL_RATIO = 0.5;

export function buildPresetRelightCoefficients(preset) {
  if (preset.relight) return buildProfileRelightCoefficients(preset.relight);

  const ambient = new THREE.Color(preset.amb);
  const sun = new THREE.Color(preset.dir);
  const coefficients = new Float32Array(COEFFICIENT_COUNT);

  coefficients[0] = ambient.r * Math.max(0.15, preset.ambI);
  coefficients[1] = ambient.g * Math.max(0.15, preset.ambI);
  coefficients[2] = ambient.b * Math.max(0.15, preset.ambI);
  coefficients[3] = sun.r * preset.dirI * 0.18;
  coefficients[4] = sun.g * preset.dirI * 0.18;
  coefficients[5] = sun.b * preset.dirI * 0.18;
  coefficients[6] = sun.r * preset.dirI * 0.1;
  coefficients[7] = sun.g * preset.dirI * 0.1;
  coefficients[8] = sun.b * preset.dirI * 0.1;

  return coefficients;
}

function buildProfileRelightCoefficients(profile) {
  const coefficients = new Float32Array(COEFFICIENT_COUNT);
  coefficients.set(profile.ambient, 0);
  coefficients.set(profile.topDown, 3);
  if (profile.frontBack) coefficients.set(profile.frontBack, 6);
  if (profile.leftRight) coefficients.set(profile.leftRight, 9);
  return coefficients;
}

export function coefficientsForRelight({ preset, worldProbe }) {
  return worldProbe?.coefficients ?? buildPresetRelightCoefficients(preset);
}

export async function generateRelightProbeFromScene({
  renderer,
  scene,
  worldDef,
  exclude = []
}) {
  if (!renderer || !scene) throw new Error("A renderer and scene are required to generate a relight probe from the scene");

  const probeSize = worldDef?.environmentProbeSize ?? 32;
  const intensity = worldDef?.environmentIntensity ?? 1;
  const near = worldDef?.environmentProbeNear ?? 0.05;
  const far = worldDef?.environmentProbeFar ?? 80;
  const settleFrames = worldDef?.environmentProbeSettleFrames ?? DEFAULT_SETTLE_FRAMES;
  const maxAttempts = worldDef?.environmentProbeCaptureAttempts ?? DEFAULT_CAPTURE_ATTEMPTS;
  const stabilityEpsilon = worldDef?.environmentProbeStabilityEpsilon ?? DEFAULT_STABILITY_EPSILON;
  const directionalScale = worldDef?.environmentProbeDirectionalScale ?? DEFAULT_DIRECTIONAL_SCALE;
  const maxDirectionalRatio = worldDef?.environmentProbeMaxDirectionalRatio ?? DEFAULT_MAX_DIRECTIONAL_RATIO;
  const cubeTarget = new THREE.WebGLCubeRenderTarget(probeSize, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    colorSpace: THREE.SRGBColorSpace,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter
  });
  const cubeCamera = new THREE.CubeCamera(near, far, cubeTarget);
  const probePosition = worldDef?.environmentProbePosition ?? DEFAULT_PROBE_POSITION;
  cubeCamera.position.fromArray(probePosition);

  try {
    const coefficients = await captureStableCoefficients({
      renderer,
      scene,
      cubeCamera,
      cubeTarget,
      exclude,
      intensity,
      directionalScale,
      maxDirectionalRatio,
      settleFrames,
      maxAttempts,
      stabilityEpsilon,
      worldName: worldDef?.name ?? "World Foundation Model world"
    });

    console.log(`Dynamically generated cubemap for 4DGS relighting from ${worldDef?.name ?? "World Foundation Model world"}.`);
    logGeneratedCoefficients(worldDef, coefficients, { probeSize, probePosition, intensity, directionalScale });
    console.log(`Generated World Foundation Model light-probe coefficients for 4DGS relighting from ${worldDef?.name ?? "World Foundation Model world"}.`);
    return {
      name: `${worldDef?.name ?? "World"} generated probe`,
      source: "scene-cube-capture",
      coefficients
    };
  } finally {
    cubeTarget.dispose();
  }
}

async function captureStableCoefficients({
  renderer,
  scene,
  cubeCamera,
  cubeTarget,
  exclude,
  intensity,
  directionalScale,
  maxDirectionalRatio,
  settleFrames,
  maxAttempts,
  stabilityEpsilon,
  worldName
}) {
  let previous = null;
  let latest = null;
  let fallback = null;

  await waitForAnimationFrames(settleFrames);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const raw = await captureCoefficients({ renderer, scene, cubeCamera, cubeTarget, exclude, intensity, directionalScale: 1 });
    const directionalRatio = coefficientDirectionalRatio(raw);
    latest = scaleDirectionalCoefficients(raw, directionalScale);

    // Validate raw SH before scaling so unstable cold-start captures cannot pass
    // just because their directional bands are damped for Gracia.
    if (directionalRatio > maxDirectionalRatio) {
      console.warn(
        `WFM relighting probe capture for ${worldName} had high directional SH ratio ${directionalRatio.toFixed(3)}; retrying before caching coefficients.`
      );
      fallback = scaleDirectionalCoefficients(raw, 0);
      await waitForAnimationFrames(1);
      continue;
    }

    if (previous) {
      const maxDelta = maxCoefficientDelta(previous, latest);
      if (maxDelta <= stabilityEpsilon) return latest;
      console.warn(
        `WFM relighting probe capture for ${worldName} changed by ${maxDelta.toFixed(6)}; retrying before caching coefficients.`
      );
    }

    previous = latest;
    await waitForAnimationFrames(1);
  }

  if (fallback) {
    console.warn(`WFM relighting probe capture for ${worldName} stayed too directional; using average-color coefficients.`);
    return fallback;
  }

  console.warn(`WFM relighting probe capture for ${worldName} did not fully stabilize; using the latest coefficients.`);
  return latest;
}

async function captureCoefficients({ renderer, scene, cubeCamera, cubeTarget, exclude, intensity, directionalScale }) {
  const hidden = [];
  for (const object of exclude) {
    if (!object?.visible) continue;
    hidden.push(object);
    object.visible = false;
  }

  const previousRenderTarget = renderer.getRenderTarget();
  const previousXrEnabled = renderer.xr.enabled;
  renderer.xr.enabled = false;

  try {
    cubeCamera.update(renderer, scene);
    const probe = await LightProbeGenerator.fromCubeRenderTarget(renderer, cubeTarget);
    return flattenLightProbeCoefficients(probe, { intensity, directionalScale });
  } finally {
    renderer.xr.enabled = previousXrEnabled;
    renderer.setRenderTarget(previousRenderTarget);
    for (const object of hidden) object.visible = true;
  }
}

function waitForAnimationFrames(frameCount) {
  return new Promise((resolve) => {
    let remaining = Math.max(0, frameCount);
    const tick = () => {
      if (remaining <= 0) {
        resolve();
        return;
      }
      remaining--;
      requestAnimationFrame(tick);
    };
    tick();
  });
}

function maxCoefficientDelta(a, b) {
  let max = 0;
  for (let index = 0; index < COEFFICIENT_COUNT; index++) {
    max = Math.max(max, Math.abs(a[index] - b[index]));
  }
  return max;
}

function coefficientDirectionalRatio(coefficients) {
  const dc = Math.max(Math.abs(coefficients[0]), Math.abs(coefficients[1]), Math.abs(coefficients[2]), 1e-6);
  let directional = 0;
  for (let index = 3; index < COEFFICIENT_COUNT; index++) {
    directional = Math.max(directional, Math.abs(coefficients[index]));
  }
  return directional / dc;
}

function scaleDirectionalCoefficients(coefficients, directionalScale) {
  if (directionalScale === 1) return coefficients;
  const scaled = new Float32Array(coefficients);
  for (let index = 3; index < COEFFICIENT_COUNT; index++) scaled[index] *= directionalScale;
  return scaled;
}

function logGeneratedCoefficients(worldDef, coefficients, { probeSize, probePosition, intensity, directionalScale }) {
  const values = Array.from(coefficients, (value) => Number(value.toFixed(6)));
  const maxAbs = values.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
  const dc = values.slice(0, 3);
  console.log("WFM SH coefficients for 4DGS relighting", {
    world: worldDef?.name ?? "World Foundation Model world",
    probeSize,
    probePosition,
    intensity,
    directionalScale,
    dc,
    maxAbs: Number(maxAbs.toFixed(6)),
    coefficients: values
  });
}

function flattenLightProbeCoefficients(probe, { intensity = 1, directionalScale = 1 } = {}) {
  const source = probe?.sh?.coefficients;
  if (!Array.isArray(source) || source.length !== 9) {
    throw new Error("Generated light probe did not contain 9 spherical harmonics coefficients");
  }

  const coefficients = new Float32Array(COEFFICIENT_COUNT);
  source.forEach((coefficient, index) => {
    const offset = index * 3;
    const scale = intensity * (index === 0 ? 1 : directionalScale);
    coefficients[offset] = coefficient.x * scale;
    coefficients[offset + 1] = coefficient.y * scale;
    coefficients[offset + 2] = coefficient.z * scale;
  });
  return coefficients;
}
