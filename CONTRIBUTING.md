# Contributing

Thanks for taking a look at this demo. Contributions, issues, and suggestions are welcome, but this repository is maintained as a focused experiment rather than a general-purpose product.

## Issues

Please open an issue for reproducible bugs, documentation fixes, or focused suggestions related to the 4DGS + World Foundation Model integration. Include the browser, device, operating system, and steps to reproduce when reporting rendering or playback issues.

Issues will be reviewed as time allows. There is no guaranteed response time, roadmap commitment, or support SLA; fixes and enhancements will be prioritized based on project fit and available maintenance time.

## Pull Requests

Pull requests should stay small and focused. Before opening a PR, make sure the app builds:

```sh
npm install
npm run build
```

Please avoid broad rewrites, unrelated formatting churn, or changes to bundled proprietary runtime files. Changes involving Gracia SDK files, generated World Foundation Model assets, or other third-party assets may require separate permission and may not be accepted.

## Scope

This repository is intended to demonstrate one integration path: using a World Foundation Model generated 3DGS scene as contextual lighting and environment for streamed Gracia 4DGS playback. Contributions that keep that experiment clear, simple, and easy to run are the best fit.
