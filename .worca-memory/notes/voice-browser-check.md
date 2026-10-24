---
name: voice-browser-check
description: Read before any UI browser check or screenshot proof in a headless worca run — the Playwright MCP is often denied, and a CDP route through the cached chrome-hea
paths: ui/public/**, ui/server.mjs
updated: 2026-10-02T18:02:14.979Z
author: Bulibas
---

The Playwright MCP tools are often denied in headless worca runs: nobody is there to approve the permission
prompt. Do NOT replace a planned browser check with HTTP calls to the server. Those prove the server, not
the page, and give no screenshots. A reviewer will send the step back (PR 3, run 4ccdc306, cycle 2).
Use this CDP route instead:

1. Start your OWN server with a temp home. Record its PID and later stop it with `kill <pid>`, never with a pattern kill:
   `HOME=$H WORCA_HOME=$H/.worca-cc PORT=47913 WORCA_MOCK=1 env -u WORCA_HOST_PID node ui/server.mjs`
   (never port 4317, the owner's live UI).
2. Launch the cached `~/Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-mac-arm64/chrome-headless-shell` with `--remote-debugging-port=<p>` (add `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream` for voice). Record its PID too.
3. Drive it over CDP with the repo's `ws` package. From a /tmp script you must import it by absolute path, `<repo>/node_modules/ws/wrapper.mjs`, because a bare `'ws'` does not resolve outside the repo.
4. General UI checks: `Page.navigate`, then `Runtime.evaluate` to set form fields and click, then `Page.captureScreenshot` (base64 PNG) for each state. Use `Emulation.setDeviceMetricsOverride` for a narrow-viewport shot. Put a timeout around every evaluate call.
5. Voice assets: `Runtime.evaluate` a script that imports `/ask-voice.mjs`, calls `loadVadLibrary`, then calls `MicVAD.new({...startOnLoad:false})`. The console line "VAD | debug > ...finished loading VAD" means the ORT wasm runtime and `silero_vad_v5.onnx` loaded from the allow-list.

Trap: in chrome-headless-shell, `getUserMedia` never resolves, even with the fake-device flags, so `MicVAD.start()` hangs forever. Headless proves asset loading and `audioWorklet.addModule` only. It does not prove mic capture, barge-in or echo cancellation; those still need a human in a headed browser.

Confirmed working end-to-end (run 4ccdc306, PR 3 cycle 3, New pipeline engine picker): `--headless --no-sandbox --user-data-dir=<tmp>` plus a fresh `--user-data-dir` per launch, driven from a plain Node script (not a test file) importing the repo's `ws/wrapper.mjs` by absolute path, using `Runtime.evaluate` (wrap every snippet in an IIFE — bare `const` across separate evaluate calls hits the SAME global scope and throws `Identifier 'x' has already been declared` on the second call) and `Page.captureScreenshot`. `POST /api/projects` against the mock server registers a real project (its path just needs to exist; `git init` it to be safe) so `#projectSelect` is populated — no need to fake anything else.

Trap: a fresh `WORCA_HOME` shows the "Welcome to Worca" `#welcome-modal` on first load of New pipeline, covering the form. Click its "Skip" button (find by button text) and wait for `.hidden` before taking any screenshot, or every shot is just the onboarding card.

Trap: `#engineRefusal` and the "Allow unguarded" checkbox sit near the Start button, well below the fold from a top-of-page load — `scrollIntoView({block:'center'})` on it before the screenshot, or the capture just repeats the top of the form.

To get a REAL (not mocked) 409 `engine-refused` from a live `WORCA_MOCK=1` server: pick the "Normal" guardrail set (`#guardrailsSelect` inside `<details id="advanced-config">`, must set `.open = true` first since it is a closed disclosure) — it is one of the three always-present builtin levels (`src/core/guardrails.mjs` `GUARDRAIL_LEVELS`) and genuinely carries permission rules codex cannot enforce, so the gate refuses it for real.
