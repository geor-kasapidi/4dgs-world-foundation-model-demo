# Third-Party Notices

This repository includes original demo code plus third-party runtimes, libraries,
and assets. The repository's MIT License applies only to the original demo code
authored for this project.

## Gracia Web SDK

The Gracia Web SDK is proprietary software owned by Gracia Labs.

This project consumes `@gracia/web-sdk` from npm (installed from the
[gracia-labs/web-sdk](https://github.com/gracia-labs/web-sdk) repository).
This demo uses the **core** entry point (`@gracia/web-sdk/core`), not the AIO
bundle. The SDK is not licensed under MIT. It is governed by the Gracia Web SDK
proprietary license.

For licensing inquiries, contact `support@gracia.ai`.

## Three.js and gl-matrix

The Gracia Web SDK depends on [Three.js](https://threejs.org/) and
[gl-matrix](https://glmatrix.net/) as peer dependencies. This demo lists them
in `package.json` so Vite can resolve SDK imports at build time.

## World Labs Assets

World Foundation Model based assets or generated content may be subject to
World Labs terms or the terms under which those assets were created, exported,
or shared.
