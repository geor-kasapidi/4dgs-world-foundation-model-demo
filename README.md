# 4DGS + World Foundation Model Demo

A web demo that combines streamed <a href="https://gracia.ai/" target="_blank" rel="noopener noreferrer">Gracia.ai</a> 4DGS performers with World Foundation Model 3D Gaussian backgrounds, rendered entirely through the <a href="https://github.com/gracia-labs/web-sdk" target="_blank" rel="noopener noreferrer">Gracia Web SDK</a>.

Each scene pairs a streamed 4DGS capture (`.mint`) with a static 3DGS world (`.sog`) using alignment transforms. The Singer and Cycling examples use transforms from the provided alignment files.

<img src="public/assets/3dgs/4dgs-demo.png" alt="4DGS + World Foundation Model demo screenshot">

## What This Demonstrates

- Combined 3DGS + 4DGS playback through a single Gracia source entry (`staticUrl` + stream `url`).
- Scene switching between WFM worlds (Theater / Bike Shop) with matched 4DGS performers (Singer / Cycling).
- Per-scene environment relighting from `sources.json` applied to the 4DGS performer.
- Spatial audio playback and standard Gracia orbit camera controls.

## Architecture

The Gracia Web SDK owns all splat rendering — both the static 3DGS background and the streamed 4DGS performer. `GraciaApp` loads combined sources from `public/sources.json`, applies `staticTransform` to the background and `initialTransform` to the performer, and handles playback.

World switching uses `app.loadScene()` to move between configured sources. Each source is self-contained with its own static world, stream URL, transforms, and background color.

## Code Organization

- `public/sources.json` — combined 3DGS + 4DGS source entries with alignment transforms.
- `src/config.js` — demo token and world name mapping.
- `src/GraciaSources.js` — loads sources and enriches streaming metadata from the Gracia API.
- `src/main.js` — app entry point: GraciaApp setup, UI controls, and playback bar.
- `vite.config.js` — Vite config with the Gracia plugin (COOP/COEP headers, WASM serving).

## Getting Started

Install dependencies:

```sh
npm install
```

Run the dev server:

```sh
npm run dev
```

Or build and preview:

```sh
npm run build
npm start
```

The app is served at `http://localhost:4174/`.

## Controls

- Drag to orbit, scroll to zoom, WASD to move (Gracia built-in controls).
- Left/right arrow keys or on-screen arrows switch between 3DGS worlds.
- Use the source dropdown to pick a performer/world pair.
- Use the Relight toggle to enable or disable 4DGS environment relighting.

## Source Format

Each entry in `public/sources.json` follows the Gracia combined source format:

```json
{
  "id": "streaming-id",
  "label": "Singer",
  "type": "stream",
  "url": "https://market.gracia.ai/api/v1/streaming/content/{id}/",
  "staticUrl": "assets/3dgs/theater.sog",
  "background": "#2a2a32",
  "controls": "orbit",
  "initialTransform": { "rotation": {}, "scale": {}, "translation": {} },
  "staticTransform": { "rotation": {}, "scale": {}, "translation": {} }
}
```

Place 3DGS `.sog` assets under `public/assets/3dgs/`.

## Notes

- Requires Node.js 20.19 or newer.
- Gracia playback requires WebGPU and cross-origin isolation (COOP/COEP). The Gracia Vite plugin sets these headers automatically.
- The bundled demo token in `src/config.js` is for public demo content only; replace it for other streams.
- Production deployments must serve COOP/COEP headers on all HTML/JS responses.

## License

This repository is mixed-license:

- Original demo source code is licensed under the <a href="LICENSE" target="_blank" rel="noopener noreferrer">MIT License</a>.
- The Gracia Web SDK (`@gracia/web-sdk`) is proprietary software owned by Gracia Labs.
- Third-party libraries and assets are governed by their own licenses.

See <a href="THIRD_PARTY_NOTICES.md" target="_blank" rel="noopener noreferrer">THIRD_PARTY_NOTICES.md</a> for details.

## Contributing

Issues and focused pull requests are welcome. See <a href="CONTRIBUTING.md" target="_blank" rel="noopener noreferrer">CONTRIBUTING.md</a> for expectations.
