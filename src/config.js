export const MARKET_URL = "https://market.gracia.ai";
export const STREAMING_BASE = `${MARKET_URL}/api/v1/streaming/content`;

// Public demo view token from the Gracia AI WebSDK demo setup. It is included
// intentionally for the bundled demo source entries; replace it when using
// different streamed 4DGS content.
export const DEMO_TOKEN =
  "eyJhbGciOiJIUzI1NiJ9.eyJpYXQiOjE3NzMyMjg4OTcsImV4cCI6MTg5NDM2MTY0MH0.U9kEeoph8JFV9zZ9ht7F7NAFpaLRIKRuMyFAYR9xqsw";

export const DEFAULT_RELIGHT_PROBE_POSITION = [0, 2, 0];
export const DEFAULT_RELIGHT_PROBE_SIZE = 32;
export const DEFAULT_RELIGHT_PROBE_SETTLE_FRAMES = 4;
export const DEFAULT_RELIGHT_PROBE_CAPTURE_ATTEMPTS = 4;
export const DEFAULT_RELIGHT_PROBE_STABILITY_EPSILON = 0.01;
// Subtle by default: enough contextual SH variation to read as environment
// lighting, but not enough to reintroduce dark lobe artifacts in bad captures.
export const DEFAULT_RELIGHT_DIRECTIONAL_SCALE = 0.18;
export const DEFAULT_RELIGHT_MAX_DIRECTIONAL_RATIO = 0.5;
export const SHADOW_PLANE_Y = -3.2;

export const WORLD_DEFINITIONS = [
  {
    name: "Bike Shop",
    url: "assets/3dgs/bike-shop.sog",
    position: [-0.5, -3.85, 3.3],
    scale: 2.2,
    generateEnvironmentProbe: true
  },
  {
    name: "Theater",
    url: "assets/3dgs/theater.sog",
    position: [0, -0.33, 0],
    generateEnvironmentProbe: true
  }
];

export const WORLD_SOURCE_LABELS = {
  "Bike Shop": "Cycling",
  Theater: "Singer"
};

export const SOURCE_SHADOW_Y = {
  Singer: SHADOW_PLANE_Y - 0.68,
  Cycling: SHADOW_PLANE_Y - 0.55
};

export const SOURCE_YAW_OFFSETS = {
  Singer: (Math.PI * 13) / 18
};

export const SOURCE_POSITION_OFFSETS = {
  Singer: [2, 0, -2]
};

export const SCENE_PRESETS = {
  golden: {
    label: "Golden",
    bg: 0x101018,
    fog: 0x11101a,
    fogNear: 20,
    fogFar: 48,
    amb: 0x75685a,
    ambI: 0.36,
    dir: 0xffd08a,
    dirI: 1.35,
    dirPos: [-3, 7, -4],
    exposure: 1.18,
    relight: { ambient: [3.7, 3.45, 3.05], topDown: [0.24, 0.2, 0.12], frontBack: [0.06, 0.04, 0.02] }
  },
  sunset: {
    label: "Sunset",
    bg: 0x160b15,
    fog: 0x23101b,
    fogNear: 18,
    fogFar: 44,
    amb: 0x7d4e72,
    ambI: 0.34,
    dir: 0xff794d,
    dirI: 1.55,
    dirPos: [5, 4, -2],
    exposure: 1.05,
    relight: { ambient: [4.08, 3.01, 1.95], topDown: [0.25, 0.12, 0.02], frontBack: [0.15, 0.06, 0], leftRight: [-0.3, -0.12, 0] }
  },
  cobalt: {
    label: "Cobalt",
    bg: 0x06101d,
    fog: 0x06101d,
    fogNear: 18,
    fogFar: 46,
    amb: 0x406b9a,
    ambI: 0.44,
    dir: 0x83b6ff,
    dirI: 1.1,
    dirPos: [-2, 8, 3],
    exposure: 1.2,
    relight: { ambient: [3.12, 3.3, 3.72], topDown: [0.1, 0.15, 0.3] }
  },
  studio: {
    label: "Studio",
    bg: 0x111214,
    fog: 0x111214,
    fogNear: 24,
    fogFar: 58,
    amb: 0xc8ced4,
    ambI: 0.52,
    dir: 0xffffff,
    dirI: 1.0,
    dirPos: [0, 8, -4],
    exposure: 1.0,
    relight: { ambient: [3.72, 3.37, 2.84], topDown: [0.3, 0.25, 0.15] }
  },
  night: {
    label: "Night",
    bg: 0x03050a,
    fog: 0x03050a,
    fogNear: 14,
    fogFar: 38,
    amb: 0x253558,
    ambI: 0.28,
    dir: 0x5870b8,
    dirI: 0.7,
    dirPos: [-4, 8, -2],
    exposure: 1.32,
    relight: { ambient: [2.48, 2.66, 3.01], topDown: [0.08, 0.1, 0.15] }
  }
};
