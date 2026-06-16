# 4DGS + World Foundation Model Demo

A small web demo that combines streamed <a href="https://gracia.ai/" target="_blank" rel="noopener noreferrer">Gracia.ai</a> 4DGS performers with a World Foundation Model based 3D Gaussian scene from <a href="https://www.worldlabs.ai/" target="_blank" rel="noopener noreferrer">World Labs</a>.

The project is intentionally simple: it is a standalone Vite app using <a href="https://threejs.org/" target="_blank" rel="noopener noreferrer">Three.js</a>, <a href="https://sparkjs.dev/" target="_blank" rel="noopener noreferrer">Spark.js</a>, and the Gracia Web SDK runtime files included in `public/dist`.

It includes 4DGS relighting controls, spatial audio playback, keyboard/mouse navigation, and mobile joystick controls for supported mobile browsers.

This is a fully navigable 3D scene: 4DGS extends 3D Gaussian Splatting with time-varying volumetric capture, making it possible to render dynamic human performances inside the world.

<img src="public/assets/3dgs/4dgs-demo.png" alt="4DGS + World Foundation Model demo screenshot">

## What This Demonstrates

- Rendering a static World Foundation Model generated 3DGS scene and a streamed Gracia 4DGS performer in one Three.js scene.
- Dynamically generating a low-resolution WFM cube map at runtime and converting it into Gracia-compatible spherical harmonics relighting.
- Switching between generated 3DGS worlds while keeping the 4DGS performer, audio, controls, and relighting state coordinated.

## Architecture

Spark.js owns the static 3DGS world layer. It loads and renders the SOG scenes through `SparkRenderer` and `SplatMesh`.

Gracia owns the dynamic 4DGS performer layer. It creates its own `GraciaPlayer`, wraps it in `SplatsMesh`, and that mesh is added to the same Three.js scene.

They are peers in the same scene, not nested inside each other. The app coordinates them: when the active Spark world changes, `transition()` also switches the active Gracia source with `activateSourceForWorld()`.

## Code Organization

- `src/config.js` contains editable demo configuration: WFM worlds, Gracia source mappings, lighting presets, and relighting probe defaults.
- `src/GaussianTransitionWorldManager.js` owns Spark 3DGS world loading, caching, and transitions.
- `src/GraciaSources.js` loads and enriches configured Gracia streaming sources.
- `src/RelightingProbes.js` captures the active WFM scene into a cube map and converts it into spherical harmonics coefficients.
- `src/RelightingRuntime.js` owns relighting state, probe caching, and application through Gracia `EnvLighting`.
- `src/main.js` remains the app entry point and orchestration layer for scene setup, UI controls, playback, and the render loop.

The demo intentionally uses plain JavaScript to keep the integration easy to inspect, copy, and adapt. Spark ships TypeScript declarations, so teams that prefer TypeScript should be able to migrate the app structure without changing the core Spark/Gracia integration approach.

## Getting Started

Install dependencies:

```sh
npm install
```

Build the app:

```sh
npm run build
```

Start the local server:

```sh
npm start
```

The app will be served at `http://localhost:4174/`.

## Controls

- Drag to orbit the camera.
- Use `W`, `A`, `S`, and `D` to move through the scene.
- Use the left and right arrow keys or the on-screen arrows to transition between 3DGS worlds.
- Use the on-screen controls to switch Gracia sources, lighting presets, and depth-of-field settings.
- On mobile, use the on-screen joysticks to move and look around, and use the arrow buttons to switch worlds.

## Notes

- Requires Node.js 20.19 or newer.
- Gracia 4DGS playback requires a browser and device with WebGPU support, including supported mobile browsers.
- Gracia playback uses `SharedArrayBuffer`, so the page must be cross-origin isolated. The local Vite server sets the required `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` headers automatically.
- Production deployments must serve the same cross-origin isolation headers; static hosts that do not allow custom headers may not support Gracia playback.
- The 3DGS world assets are loaded from `public/assets/3dgs`.
- Streaming source entries live in `public/sources.json`.
- The bundled Gracia source entries use the public demo view token from the Gracia AI WebSDK demo setup in `src/config.js`; it is included intentionally and should be replaced when using different streamed 4DGS content.

## Known Constraints

- This is a focused integration demo, not a general-purpose 3DGS/4DGS editor.
- The production build may emit a Vite large chunk warning. This is expected because the demo bundles substantial 3D/WebGPU runtime code and does not indicate a failed build.
- Runtime relighting is tuned for low-frequency contextual lighting from WFM scenes; it is not intended to reproduce full global illumination.
- The Gracia runtime and bundled demo assets have separate licensing and usage terms from the original MIT-licensed demo source.

## Relighting Extension

The demo keeps Gracia's relighting path intact. The `Relight` toggle still calls Gracia's `EnvLighting` API through each active `GraciaPlayer`.

The extension point is in `src/RelightingProbes.js`. It lets a Spark 3DGS world derive Gracia relighting from a runtime cube map capture of the World Foundation Model scene. The value proposition is that the WFM-generated world itself becomes the lighting context for the 4DGS performer. If a world does not generate a WFM probe, the app falls back to the current hand-authored scene preset lighting.

### World Foundation Model Light Probe Generation

The relighting path starts from a World Foundation Model generated 3DGS asset, such as a `.sog` scene from World Labs or comparable 3DGS outputs from other WFM systems. Each world can opt in with `generateEnvironmentProbe: true`. When the world loads, the app captures the static WFM/Spark 3DGS scene into a small cube map, hides the dynamic Gracia performer and helper shadow plane during the capture, uses Three.js `LightProbeGenerator` to read the scene's low-frequency lighting, applies the captured average light color plus subtle directional SH to the Gracia-facing probe, and adds the world name to the lighting dropdown after the probe is ready.

```js
{
  name: "Bike Shop",
  url: "assets/3dgs/bike-shop.sog",
  generateEnvironmentProbe: true
}
```

`environmentProbeSize` defaults to `32`, which keeps the cube capture cheap while preserving enough low-frequency lighting information for SH relighting.
The cube map is captured from `[0, 2, 0]` by default, which places the probe above the scene origin instead of at floor level. Worlds can override this with `environmentProbePosition`.
The directional SH contribution is intentionally subtle by default. Tune these values per world if the relighting should be more directional, softer, or more conservative:

```js
{
  name: "Bike Shop",
  url: "assets/3dgs/bike-shop.sog",
  generateEnvironmentProbe: true,
  environmentProbeSize: 32,
  environmentProbePosition: [0, 2, 0],
  environmentProbeDirectionalScale: 0.18,
  environmentProbeMaxDirectionalRatio: 0.5
}
```

For slower-loading or visually denser WFM assets, `environmentProbeSettleFrames`, `environmentProbeCaptureAttempts`, and `environmentProbeStabilityEpsilon` can also be adjusted to make probe generation wait longer or require tighter coefficient stability before caching.

### Technical Relighting Implementation

At runtime, the active World Foundation Model 3DGS scene is rendered into a low-resolution `WebGLCubeRenderTarget` with a `CubeCamera`. Probe generation waits a few frames, rejects highly directional raw SH captures, and compares consecutive captures before caching coefficients, which keeps cold-start Spark/WebGL warm-up from producing unstable values. Three.js `LightProbeGenerator` converts the cube map into 9 RGB spherical harmonics coefficients. The app preserves the captured average WFM light color and scales the directional bands with `environmentProbeDirectionalScale` before passing the 27-value coefficient array into Gracia `EnvLighting`, so the 4DGS actor gets contextual side-to-side color variation without the dark-gradient artifact. Each active `GraciaPlayer` receives the resulting environment lighting when `Relight` is enabled.

## License

This repository is mixed-license:

- Original demo source code is licensed under the <a href="LICENSE" target="_blank" rel="noopener noreferrer">MIT License</a>.
- The Gracia Web SDK runtime files in `public/dist/` are proprietary software owned by Gracia Labs. They may be included publicly only with permission from Gracia Labs and are not covered by the MIT License.
- Third-party libraries and assets are governed by their own licenses and terms.

See <a href="THIRD_PARTY_NOTICES.md" target="_blank" rel="noopener noreferrer">THIRD_PARTY_NOTICES.md</a> for details.

## Contributing

Issues and focused pull requests are welcome as time allows. See <a href="CONTRIBUTING.md" target="_blank" rel="noopener noreferrer">CONTRIBUTING.md</a> for expectations and project scope.
