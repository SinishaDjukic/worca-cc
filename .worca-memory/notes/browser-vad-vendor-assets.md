---
name: browser-vad-vendor-assets
description: Facts about loading Silero VAD (@ricky0123/vad-web + onnxruntime-web) into worca's no-bundler UI; read before touching voice-mode vendor routes or upgrading eit
paths: ui/server.mjs, ui/public/ask-voice.mjs, package.json
updated: 2026-09-29T20:19:43.802Z
author: Bulibas
---

Worca's UI has no bundler or import map. Third-party browser code is served file by file out of
`node_modules` through explicit `/vendor/*` routes in `ui/server.mjs` (the marked/dompurify pattern).

These facts were checked against the npm tarballs of @ricky0123/vad-web 0.0.31 (ISC) and
onnxruntime-web 1.22.0 (MIT).

vad-web's browser build:
- `dist/bundle.min.js` is UMD and sets `window.vad`. It carries its OWN copy of ORT Web 1.22.0
  JS (verified: the bundle contains the `1.22.0` version string and the
  `ort-wasm-simd-threaded.mjs` file name). It does not read a global `ort`, so do NOT load or
  serve `ort.wasm.min.js`. Configure ORT only through MicVAD's `ortConfig(ort)` option.
- Because the ORT JS is baked into the vad bundle, the served `ort-wasm-simd-threaded.{mjs,wasm}`
  must come from exactly the same ORT version: pin `onnxruntime-web` to that exact version and
  check `npm ls onnxruntime-web` shows one deduped copy.
- `MicVAD.new` loads its worklet and model from `baseAssetPath`:
  - worklet: `vad.worklet.bundle.min.js`
  - model: `silero_vad_legacy.onnx`, `silero_vad_v5.onnx` or `silero_vad_v6.onnx`, chosen by the
    `model` option; the default is `legacy`.
- It sets `ort.env.wasm.wasmPaths = onnxWASMBasePath`.
- `startOnLoad` defaults to `true`. Pass `false` so the mic is opened only by `start()`.
- `onSpeechEnd(audio)` gives a Float32Array at 16 kHz, which can be WAV-encoded directly.
- `setOptions()` only updates the frame processor's thresholds. `minSpeechMs` and `redemptionMs` are
  applied when the VAD is constructed, so change those there.

onnxruntime-web 1.22:
- The wasm-only runtime is `ort-wasm-simd-threaded.mjs` plus `ort-wasm-simd-threaded.wasm`.
- There is no separate non-threaded artifact. Set `ort.env.wasm.numThreads = 1`, because worca
  sends no COOP/COEP headers.
- Unpacked it is about 94 MB in `node_modules`, and only about 12 MB of it is ever served.

Resolving the directories from Node:
- `import.meta.resolve('onnxruntime-web/wasm')` gives `.../dist/ort.wasm.bundle.min.mjs`; take
  its dirname.
- vad-web has no `exports` field, so `import.meta.resolve('@ricky0123/vad-web')` gives
  `.../dist/index.js`; take its dirname.

After any version bump:
- Re-check the served allow-list in DevTools → Network.
- ORT file names change between minor versions.
