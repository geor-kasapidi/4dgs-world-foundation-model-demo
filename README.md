# 4DGS + World Foundation Model Demo

A small web demo that combines streamed <a href="https://gracia.ai/" target="_blank" rel="noopener noreferrer">Gracia.ai</a> 4DGS performers with a World Foundation Model based 3D Gaussian scene from <a href="https://www.worldlabs.ai/" target="_blank" rel="noopener noreferrer">World Labs</a>.

The project is intentionally simple: it is a standalone Vite app using <a href="https://threejs.org/" target="_blank" rel="noopener noreferrer">Three.js</a>, <a href="https://sparkjs.dev/" target="_blank" rel="noopener noreferrer">Spark.js</a>, and the Gracia Web SDK runtime files included in `public/dist`.

It includes 4DGS relighting controls, spatial audio playback, keyboard/mouse navigation, and mobile joystick controls for supported mobile browsers.

This is a fully navigable 3D scene: 4DGS extends 3D Gaussian Splatting with time-varying volumetric capture, making it possible to render dynamic human performances inside the world.

![4DGS + World Foundation Model demo screenshot](public/assets/3dgs/4dgs-demo.png)

## Architecture

Spark.js owns the static 3DGS world layer. It loads and renders the SOG scenes through `SparkRenderer` and `SplatMesh`.

Gracia owns the dynamic 4DGS performer layer. It creates its own `GraciaPlayer`, wraps it in `SplatsMesh`, and that mesh is added to the same Three.js scene.

They are peers in the same scene, not nested inside each other. The app coordinates them: when the active Spark world changes, `transition()` also switches the active Gracia source with `activateSourceForWorld()`.

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

## Relighting Extension

The demo keeps Gracia's relighting path intact. The `Relight` toggle still calls Gracia's `EnvLighting` API through each active `GraciaPlayer`.

The extension point is in `src/RelightingProbes.js`. It lets a Spark 3DGS world derive Gracia relighting from a runtime cube capture of the WFM scene, from a provided World Foundation Model environment map, or from precomputed lighting coefficients in a small JSON probe. If a world has none of those, the app falls back to the current hand-authored scene preset lighting.

### World Foundation Model Light Probe Generation

The default path is to generate a low-resolution cube map from the loaded WFM/Spark 3DGS world at runtime. Each world can opt in with `generateEnvironmentProbe: true`. When the world loads, the app captures the static 3DGS scene into a small cube render target, hides the dynamic Gracia performer and helper shadow plane during the capture, uses Three.js `LightProbeGenerator` to create 9 RGB spherical harmonics coefficients, flattens them into the 27-value layout expected by Gracia `EnvLighting`, and adds the world name to the lighting dropdown after the probe is ready.

```js
{
  name: "Bike Shop",
  url: "assets/3dgs/bike-shop.sog",
  generateEnvironmentProbe: true,
  environmentProbeSize: 32
}
```

`environmentProbeSize` defaults to `32`, which keeps the cube capture cheap while preserving enough low-frequency lighting information for SH relighting.

### Technical Relighting Implementation

At runtime, the active World Foundation Model 3DGS scene is rendered into a low-resolution `WebGLCubeRenderTarget` with a `CubeCamera`, excluding the dynamic 4DGS performer and helper shadow plane so the captured lighting comes from the world context. Three.js `LightProbeGenerator` converts that cubemap into 9 RGB spherical harmonics coefficients, the app flattens those values into the 27-number layout expected by Gracia `EnvLighting`, and each active `GraciaPlayer` receives the resulting environment lighting when `Relight` is enabled.

You can also attach the WFM contextual environment as an equirectangular image or six-face cubemap. For equirectangular input, the app loads the environment and renders it into a cube target. For cubemap input, it loads the six faces directly. It then follows the same SH-to-Gracia path.

To attach a WFM environment map, add an `environmentMap` URL to a world definition in `src/GaussianTransitionWorldManager.js`:

```js
{
  name: "Bike Shop",
  url: "assets/3dgs/bike-shop.sog",
  environmentMap: "assets/env/bike-shop.hdr",
  environmentIntensity: 1
}
```

Supported environment inputs are `.hdr`, `.exr`, and standard browser image formats such as `.jpg` or `.png`. HDR/EXR assets are treated as linear environment data; standard images are treated as sRGB. For supplied equirectangular assets, `environmentProbeSize` controls the cube sampling size and defaults to `64`.

For a six-face cubemap, use `environmentCubeMap` in the Three.js cube order:

```js
{
  name: "Bike Shop",
  url: "assets/3dgs/bike-shop.sog",
  environmentCubeMap: [
    "assets/env/bike-shop/px.jpg",
    "assets/env/bike-shop/nx.jpg",
    "assets/env/bike-shop/py.jpg",
    "assets/env/bike-shop/ny.jpg",
    "assets/env/bike-shop/pz.jpg",
    "assets/env/bike-shop/nz.jpg"
  ]
}
```

This is intended to consume the same World Foundation Model context used by environment-map or ground-projection experiments. In that setup, WFM produces or selects the contextual equirectangular/cubemap environment for the 3DGS world, and this demo converts that environment into Gracia-compatible diffuse relighting for the dynamic 4DGS performer.

### Static Probe Fallback

To attach precomputed coefficients instead, add a `relightProbe` URL to a world definition:

```js
{
  name: "Bike Shop",
  url: "assets/3dgs/bike-shop.sog",
  relightProbe: "assets/relighting/bike-shop.probe.json"
}
```

Probe files contain 27 RGB coefficients, matching the 9 coefficient layout expected by Gracia `EnvLighting`:

```json
{
  "name": "Bike Shop",
  "coefficients": [0.5, 0.5, 0.5]
}
```

The example above is shortened for readability. Real probe files must include all 27 values.

## License

This repository is mixed-license:

- Original demo source code is licensed under the [MIT License](LICENSE).
- The Gracia Web SDK runtime files in `public/dist/` are proprietary software owned by Gracia Labs. They may be included publicly only with permission from Gracia Labs and are not covered by the MIT License.
- Third-party libraries and assets are governed by their own licenses and terms.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for details.
