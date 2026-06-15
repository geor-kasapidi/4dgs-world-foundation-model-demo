import * as THREE from "three";
import { EXRLoader } from "three/addons/loaders/EXRLoader.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { LightProbeGenerator } from "three/addons/lights/LightProbeGenerator.js";

const COEFFICIENT_COUNT = 27;
const probeCache = new Map();
const environmentProbeCache = new Map();
const textureLoader = new THREE.TextureLoader();
const cubeTextureLoader = new THREE.CubeTextureLoader();

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

export async function loadWorldRelightProbe(worldDef, { renderer } = {}) {
  if (worldDef?.generateEnvironmentProbe) return null;
  if (worldDef?.environmentMap || worldDef?.environmentCubeMap) return loadEnvironmentRelightProbe(worldDef, renderer);

  const url = worldDef?.relightProbe;
  if (!url) return null;
  if (probeCache.has(url)) return probeCache.get(url);

  const promise = fetch(url)
    .then((response) => {
      if (!response.ok) throw new Error(`Could not load relight probe ${url}`);
      return response.json();
    })
    .then(parseProbe)
    .catch((error) => {
      probeCache.delete(url);
      throw error;
    });

  probeCache.set(url, promise);
  return promise;
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
  const cubeTarget = new THREE.WebGLCubeRenderTarget(probeSize, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    colorSpace: THREE.SRGBColorSpace,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter
  });
  const cubeCamera = new THREE.CubeCamera(near, far, cubeTarget);
  const probePosition = worldDef?.environmentProbePosition ?? [0, 0, 0];
  cubeCamera.position.fromArray(probePosition);

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
    console.log(`Dynamically generated cubemap for 4DGS relighting from ${worldDef?.name ?? "World Foundation Model world"}.`);
    const probe = await LightProbeGenerator.fromCubeRenderTarget(renderer, cubeTarget);
    const coefficients = flattenLightProbeCoefficients(probe, intensity);
    console.log(`Generated World Foundation Model light-probe coefficients for 4DGS relighting from ${worldDef?.name ?? "World Foundation Model world"}.`);
    return {
      name: `${worldDef?.name ?? "World"} generated probe`,
      source: "scene-cube-capture",
      coefficients
    };
  } finally {
    renderer.xr.enabled = previousXrEnabled;
    renderer.setRenderTarget(previousRenderTarget);
    for (const object of hidden) object.visible = true;
    cubeTarget.dispose();
  }
}

async function loadEnvironmentRelightProbe(worldDef, renderer) {
  if (worldDef.environmentMap && !renderer) throw new Error("A renderer is required to generate relighting from an environment map");

  const source = worldDef.environmentMap ?? worldDef.environmentCubeMap;
  const probeSize = worldDef.environmentProbeSize ?? 64;
  const intensity = worldDef.environmentIntensity ?? 1;
  const cacheKey = `${Array.isArray(source) ? source.join(",") : source}|${probeSize}|${intensity}`;
  if (environmentProbeCache.has(cacheKey)) return environmentProbeCache.get(cacheKey);

  const promise = generateRelightProbeFromEnvironment(worldDef, { renderer, probeSize, intensity })
    .then((coefficients) => ({
      name: `${worldDef.name ?? "World"} environment probe`,
      source,
      coefficients
    }))
    .catch((error) => {
      environmentProbeCache.delete(cacheKey);
      throw error;
    });

  environmentProbeCache.set(cacheKey, promise);
  return promise;
}

async function generateRelightProbeFromEnvironment(worldDef, { renderer, probeSize, intensity }) {
  if (worldDef.environmentCubeMap) return generateRelightProbeFromCubeMap(worldDef.environmentCubeMap, intensity);

  const url = worldDef.environmentMap;
  const texture = await loadEnvironmentTexture(url);
  const cubeTarget = new THREE.WebGLCubeRenderTarget(probeSize, {
    format: THREE.RGBAFormat,
    type: texture.type,
    colorSpace: texture.colorSpace
  });

  try {
    cubeTarget.fromEquirectangularTexture(renderer, texture);
    const probe = await LightProbeGenerator.fromCubeRenderTarget(renderer, cubeTarget);
    return flattenLightProbeCoefficients(probe, intensity);
  } finally {
    texture.dispose();
    cubeTarget.dispose();
  }
}

async function generateRelightProbeFromCubeMap(urls, intensity) {
  if (!Array.isArray(urls) || urls.length !== 6) {
    throw new Error("environmentCubeMap must contain 6 cube-face URLs");
  }

  const cubeTexture = await cubeTextureLoader.loadAsync(urls);
  cubeTexture.colorSpace = THREE.SRGBColorSpace;

  try {
    const probe = LightProbeGenerator.fromCubeTexture(cubeTexture);
    return flattenLightProbeCoefficients(probe, intensity);
  } finally {
    cubeTexture.dispose();
  }
}

async function loadEnvironmentTexture(url) {
  const extension = url.split("?")[0].split(".").pop()?.toLowerCase();
  const loader = extension === "hdr" ? new HDRLoader() : extension === "exr" ? new EXRLoader() : textureLoader;
  const texture = await loader.loadAsync(url);

  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;

  if (extension === "hdr" || extension === "exr") {
    texture.colorSpace = THREE.LinearSRGBColorSpace;
  } else {
    texture.colorSpace = THREE.SRGBColorSpace;
  }

  return texture;
}

function flattenLightProbeCoefficients(probe, intensity = 1) {
  const source = probe?.sh?.coefficients;
  if (!Array.isArray(source) || source.length !== 9) {
    throw new Error("Generated light probe did not contain 9 spherical harmonics coefficients");
  }

  const coefficients = new Float32Array(COEFFICIENT_COUNT);
  source.forEach((coefficient, index) => {
    const offset = index * 3;
    coefficients[offset] = coefficient.x * intensity;
    coefficients[offset + 1] = coefficient.y * intensity;
    coefficients[offset + 2] = coefficient.z * intensity;
  });
  return coefficients;
}

function parseProbe(data) {
  const source = Array.isArray(data) ? data : data?.coefficients;
  if (!Array.isArray(source) || source.length !== COEFFICIENT_COUNT || source.some((value) => !Number.isFinite(value))) {
    throw new Error(`Relight probe must contain ${COEFFICIENT_COUNT} coefficients`);
  }

  return {
    name: data?.name ?? "World relight probe",
    coefficients: new Float32Array(source)
  };
}
