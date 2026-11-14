# Design preview R5: browser probe results

Verdict of plan Task 1 (risk R5) for Design P3 Preview. Later tasks read the `## Fallbacks to apply` section at the end.

- **Date:** 2026-11-07.
- **Host:** macOS 26.6.2 (Darwin 25.6.0), arm64.
- **Probe:** `tools/spikes/design-preview-r5/probe.mjs`. It is manual: it needs a real browser and is not part of `npm test` (M3, M14).
- **Driver:** `playwright-core` 1.64.1. Chromium is the system Chrome that `findChrome()` returns. Firefox and WebKit are Playwright's own builds, from `npx playwright-core install firefox webkit`.
- **Browser versions, as Playwright or the user agent reports them:**

| Browser | Version | How it ran |
|---|---|---|
| Chrome | 156.0.8078.80 | Playwright, `executablePath` from `findChrome()` |
| Firefox | 157.0 | Playwright build |
| WebKit | 27.2 | Playwright build (playwright webkit v2370) |
| Safari | 26.6.2 (WebKit 605.1.15) | Real Safari, `--serve --open-safari`, the page POSTs its report back |

## What the probe checks

The shell page `/` is served under worca's literal shell CSP and frames two docs. Each frame is
`<iframe sandbox="allow-scripts" referrerpolicy="no-referrer">` with `src=/design-preview/<token>/<mode>/?src=<scheme>#n=probe`.

The build and run docs are served under C-7's literal CSPs, with C-7's six headers. `{B}` is `<scheme>://<Host>/design-preview/<token>/`.

The token is real-shaped: `randomBytes(32).toString('base64url')`, redrawn until it holds both `-` and `_`.

The verdicts combine two sources:
- what each frame reports by `postMessage`;
- what reached the server. Every request under the token path and to `/outside.png` is logged with its `Origin`, `Sec-Fetch-Site` and `Sec-Fetch-Mode`.

Model JS in the build doc comes in five forms:
- an un-nonced inline `<script>`;
- `<script src="assets/p.js">`, served as real `text/javascript`;
- an `onerror` handler;
- an `onload` handler;
- a clicked `javascript:` anchor.

Capture listeners prove that the two handlers' events really fired and that the anchor was clicked. So for the script, the `src` script and the two handlers, "did not run" means the CSP blocked them. The `javascript:` anchor is the exception: Chrome and Firefox do not run such a link in this sandboxed frame even with no CSP at all, so only the WebKit and Safari rows show the CSP blocking it.

The probe itself was mutation-checked in Chrome. Nine CSP or header weakenings each turned their row `FAIL`:
- `build script-src` without the nonce: p2;
- `img-src` without `{B}`: p4;
- `font-src` without `{B}`: p5;
- no ACAO: p5 and p8;
- `{B}` as the bare origin: p6 and p8;
- an `allow-same-origin` frame: p3;
- `frame-src 'none'` in the shell: p12;
- run `connect-src 'none'`: p8;
- run `script-src` without `'unsafe-inline'`: p7.

## Runs

Each table holds the probe's rows for one command, unedited. A `FAIL` line exits 1. The header line under each command drops the timestamp and the random port. All runs were on the host above.

### chromium, plain http

`node tools/spikes/design-preview-r5/probe.mjs --browser chromium`: exit 0, `browser=chromium version=156.0.8078.80 page=http host=localhost:<port> os=darwin`

| Row | Result | Detail |
|---|---|---|
| p1-nonce-runs | ok | the build doc nonce script ran |
| p2-no-model-js | ok | none of inline-script, script-src-file, onerror, onload, javascript-url ran; 6 CSP violations reported in the doc |
| p3-opaque | ok | self.origin build=null run=null; e.origin build=["null"] run=["null"]; e.source matched frame.contentWindow for every message (unmatched=0) |
| p4-path-css-img | ok | link color=rgb(1, 2, 3) sheet=true img naturalWidth=1; server saw p.css 1x, p.png 1x |
| p5-path-font | ok | font faces=["loaded"] load=resolved 1; server saw p.woff2 1x with Origin=null Sec-Fetch-Mode=cors answered ACAO=* |
| p6-path-enforced | ok | /outside.png img naturalWidth=0; server saw it 0x |
| p7-run-inline | ok | run bridge (inline, no nonce) ran; model inline-script ran; assets/p.js under {B} ran |
| p8-run-connect | ok | fetch(assets/p.css)=ok fetch(/outside.png)=rejected TypeError; server saw /outside.png 0x |
| p9-fetch-metadata | ok | Sec-Fetch-Site build/p.css=cross-site build/p.png=cross-site run/p.js=cross-site build/p.woff2=cross-site run/p.css=cross-site |
| p12-shell-frames | ok | under the shell CSP: server served build=true run=true; frame loads build=1 run=1; frames reported=true; parent violations=[] |

### firefox, plain http

`node tools/spikes/design-preview-r5/probe.mjs --browser firefox`: exit 0, `browser=firefox version=157.0 page=http host=localhost:<port> os=darwin`

| Row | Result | Detail |
|---|---|---|
| p1-nonce-runs | ok | the build doc nonce script ran |
| p2-no-model-js | ok | none of inline-script, script-src-file, onerror, onload, javascript-url ran; 5 CSP violations reported in the doc |
| p3-opaque | ok | self.origin build=null run=null; e.origin build=["null"] run=["null"]; e.source matched frame.contentWindow for every message (unmatched=0) |
| p4-path-css-img | ok | link color=rgb(1, 2, 3) sheet=true img naturalWidth=1; server saw p.css 1x, p.png 1x |
| p5-path-font | ok | font faces=["loaded"] load=resolved 1; server saw p.woff2 1x with Origin=null Sec-Fetch-Mode=cors answered ACAO=* |
| p6-path-enforced | ok | /outside.png img naturalWidth=0; server saw it 0x |
| p7-run-inline | ok | run bridge (inline, no nonce) ran; model inline-script ran; assets/p.js under {B} ran |
| p8-run-connect | ok | fetch(assets/p.css)=ok fetch(/outside.png)=rejected TypeError; server saw /outside.png 0x |
| p9-fetch-metadata | ok | Sec-Fetch-Site build/p.png=cross-site build/p.css=cross-site run/p.js=cross-site build/p.woff2=cross-site run/p.css=cross-site |
| p12-shell-frames | ok | under the shell CSP: server served build=true run=true; frame loads build=1 run=1; frames reported=true; parent violations=[] |

### webkit, plain http

`node tools/spikes/design-preview-r5/probe.mjs --browser webkit`: exit 0, `browser=webkit version=27.2 page=http host=localhost:<port> os=darwin`

| Row | Result | Detail |
|---|---|---|
| p1-nonce-runs | ok | the build doc nonce script ran |
| p2-no-model-js | ok | none of inline-script, script-src-file, onerror, onload, javascript-url ran; 6 CSP violations reported in the doc |
| p3-opaque | ok | self.origin build=null run=null; e.origin build=["null"] run=["null"]; e.source matched frame.contentWindow for every message (unmatched=0) |
| p4-path-css-img | ok | link color=rgb(1, 2, 3) sheet=true img naturalWidth=1; server saw p.css 1x, p.png 1x |
| p5-path-font | ok | font faces=["loaded"] load=resolved 1; server saw p.woff2 1x with Origin=absent Sec-Fetch-Mode=no-cors answered ACAO=* |
| p6-path-enforced | ok | /outside.png img naturalWidth=0; server saw it 0x |
| p7-run-inline | ok | run bridge (inline, no nonce) ran; model inline-script ran; assets/p.js under {B} ran |
| p8-run-connect | ok | fetch(assets/p.css)=ok fetch(/outside.png)=rejected TypeError; server saw /outside.png 0x |
| p9-fetch-metadata | ok | Sec-Fetch-Site build/p.css=cross-site build/p.png=cross-site run/p.js=cross-site run/p.css=cross-site build/p.woff2=cross-site |
| p12-shell-frames | ok | under the shell CSP: server served build=true run=true; frame loads build=1 run=1; frames reported=true; parent violations=[] |

### chromium, --tls

`node tools/spikes/design-preview-r5/probe.mjs --browser chromium --tls`: exit 1, `browser=chromium version=156.0.8078.80 page=https host=localhost:<port> os=darwin`

| Row | Result | Detail |
|---|---|---|
| p1-nonce-runs | ok | the build doc nonce script ran |
| p2-no-model-js | ok | none of inline-script, script-src-file, onerror, onload, javascript-url ran; 6 CSP violations reported in the doc |
| p3-opaque | ok | self.origin build=null run=null; e.origin build=["null"] run=["null"]; e.source matched frame.contentWindow for every message (unmatched=0) |
| p4-path-css-img | ok | link color=rgb(1, 2, 3) sheet=true img naturalWidth=1; server saw p.css 1x, p.png 1x |
| p5-path-font | ok | font faces=["loaded"] load=resolved 1; server saw p.woff2 1x with Origin=null Sec-Fetch-Mode=cors answered ACAO=* |
| p6-path-enforced | ok | /outside.png img naturalWidth=0; server saw it 0x |
| p7-run-inline | ok | run bridge (inline, no nonce) ran; model inline-script ran; assets/p.js under {B} ran |
| p8-run-connect | ok | fetch(assets/p.css)=ok fetch(/outside.png)=rejected TypeError; server saw /outside.png 0x |
| p9-fetch-metadata | ok | Sec-Fetch-Site build/p.css=cross-site run/p.js=cross-site build/p.png=cross-site build/p.woff2=cross-site run/p.css=cross-site |
| p12-shell-frames | ok | under the shell CSP: server served build=true run=true; frame loads build=1 run=1; frames reported=true; parent violations=[] |
| p10-http-source-on-https | FAIL | {B}=http:// on the https page: p4 FAIL (link color=rgb(0, 0, 0) sheet=true img naturalWidth=0; server saw p.css 0x, p.png 0x); p5 FAIL (font faces=["error"] load=rejected NetworkError; server saw p.woff2 0x with Origin=- Sec-Fetch-Mode=- answered ACAO=-); same {B} in the run doc, for P8: p7 ok (run bridge (inline, no nonce) ran; model inline-script ran; assets/p.js under {B} did not run); p8 FAIL (fetch(assets/p.css)=rejected TypeError fetch(/outside.png)=rejected TypeError; server saw /outside.png 0x) |
| p11-https-source | ok | {B}=https://: p4 ok, p5 ok |

### firefox, --tls

`node tools/spikes/design-preview-r5/probe.mjs --browser firefox --tls`: exit 0, `browser=firefox version=157.0 page=https host=localhost:<port> os=darwin`

| Row | Result | Detail |
|---|---|---|
| p1-nonce-runs | ok | the build doc nonce script ran |
| p2-no-model-js | ok | none of inline-script, script-src-file, onerror, onload, javascript-url ran; 5 CSP violations reported in the doc |
| p3-opaque | ok | self.origin build=null run=null; e.origin build=["null"] run=["null"]; e.source matched frame.contentWindow for every message (unmatched=0) |
| p4-path-css-img | ok | link color=rgb(1, 2, 3) sheet=true img naturalWidth=1; server saw p.css 1x, p.png 1x |
| p5-path-font | ok | font faces=["loaded"] load=resolved 1; server saw p.woff2 1x with Origin=null Sec-Fetch-Mode=cors answered ACAO=* |
| p6-path-enforced | ok | /outside.png img naturalWidth=0; server saw it 0x |
| p7-run-inline | ok | run bridge (inline, no nonce) ran; model inline-script ran; assets/p.js under {B} ran |
| p8-run-connect | ok | fetch(assets/p.css)=ok fetch(/outside.png)=rejected TypeError; server saw /outside.png 0x |
| p9-fetch-metadata | ok | Sec-Fetch-Site build/p.css=cross-site build/p.png=cross-site run/p.js=cross-site build/p.woff2=cross-site run/p.css=cross-site |
| p12-shell-frames | ok | under the shell CSP: server served build=true run=true; frame loads build=1 run=1; frames reported=true; parent violations=[] |
| p10-http-source-on-https | ok | {B}=http:// on the https page: p4 ok (link color=rgb(1, 2, 3) sheet=true img naturalWidth=1; server saw p.css 1x, p.png 1x); p5 ok (font faces=["loaded"] load=resolved 1; server saw p.woff2 1x with Origin=null Sec-Fetch-Mode=cors answered ACAO=*); same {B} in the run doc, for P8: p7 ok (run bridge (inline, no nonce) ran; model inline-script ran; assets/p.js under {B} ran); p8 ok (fetch(assets/p.css)=ok fetch(/outside.png)=rejected TypeError; server saw /outside.png 0x) |
| p11-https-source | ok | {B}=https://: p4 ok, p5 ok |

### webkit, --tls

`node tools/spikes/design-preview-r5/probe.mjs --browser webkit --tls`: exit 0, `browser=webkit version=27.2 page=https host=localhost:<port> os=darwin`

| Row | Result | Detail |
|---|---|---|
| p1-nonce-runs | ok | the build doc nonce script ran |
| p2-no-model-js | ok | none of inline-script, script-src-file, onerror, onload, javascript-url ran; 6 CSP violations reported in the doc |
| p3-opaque | ok | self.origin build=null run=null; e.origin build=["null"] run=["null"]; e.source matched frame.contentWindow for every message (unmatched=0) |
| p4-path-css-img | ok | link color=rgb(1, 2, 3) sheet=true img naturalWidth=1; server saw p.css 1x, p.png 1x |
| p5-path-font | ok | font faces=["loaded"] load=resolved 1; server saw p.woff2 1x with Origin=absent Sec-Fetch-Mode=no-cors answered ACAO=* |
| p6-path-enforced | ok | /outside.png img naturalWidth=0; server saw it 0x |
| p7-run-inline | ok | run bridge (inline, no nonce) ran; model inline-script ran; assets/p.js under {B} ran |
| p8-run-connect | ok | fetch(assets/p.css)=ok fetch(/outside.png)=rejected TypeError; server saw /outside.png 0x |
| p9-fetch-metadata | ok | Sec-Fetch-Site build/p.css=cross-site run/p.js=cross-site build/p.png=cross-site run/p.css=cross-site build/p.woff2=cross-site |
| p12-shell-frames | ok | under the shell CSP: server served build=true run=true; frame loads build=1 run=1; frames reported=true; parent violations=[] |
| p10-http-source-on-https | ok | {B}=http:// on the https page: p4 ok (link color=rgb(1, 2, 3) sheet=true img naturalWidth=1; server saw p.css 1x, p.png 1x); p5 ok (font faces=["loaded"] load=resolved 1; server saw p.woff2 1x with Origin=absent Sec-Fetch-Mode=no-cors answered ACAO=*); same {B} in the run doc, for P8: p7 ok (run bridge (inline, no nonce) ran; model inline-script ran; assets/p.js under {B} ran); p8 ok (fetch(assets/p.css)=ok fetch(/outside.png)=rejected TypeError; server saw /outside.png 0x) |
| p11-https-source | ok | {B}=https://: p4 ok, p5 ok |

### Safari (real), plain http

`node tools/spikes/design-preview-r5/probe.mjs --serve --open-safari`: exit 0, `browser=safari version=26.6.2 page=http host=localhost:<port> os=darwin`

| Row | Result | Detail |
|---|---|---|
| p1-nonce-runs | ok | the build doc nonce script ran |
| p2-no-model-js | ok | none of inline-script, script-src-file, onerror, onload, javascript-url ran; 7 CSP violations reported in the doc |
| p3-opaque | ok | self.origin build=null run=null; e.origin build=["null"] run=["null"]; e.source matched frame.contentWindow for every message (unmatched=0) |
| p4-path-css-img | ok | link color=rgb(1, 2, 3) sheet=true img naturalWidth=1; server saw p.css 1x, p.png 1x |
| p5-path-font | ok | font faces=["loaded"] load=resolved 1; server saw p.woff2 1x with Origin=absent Sec-Fetch-Mode=no-cors answered ACAO=* |
| p6-path-enforced | ok | /outside.png img naturalWidth=0; server saw it 0x |
| p7-run-inline | ok | run bridge (inline, no nonce) ran; model inline-script ran; assets/p.js under {B} ran |
| p8-run-connect | ok | fetch(assets/p.css)=ok fetch(/outside.png)=rejected TypeError; server saw /outside.png 0x |
| p9-fetch-metadata | ok | Sec-Fetch-Site build/p.css=cross-site build/p.png=cross-site run/p.js=cross-site run/p.css=cross-site build/p.woff2=cross-site |
| p12-shell-frames | ok | under the shell CSP: server served build=true run=true; frame loads build=1 run=1; frames reported=true; parent violations=[] |

### Linux: Chrome and Firefox

not reached: this run had only the macOS host, and no Linux machine was reachable from it.

### Windows: Chrome and Firefox

not reached: this run had only the macOS host, and no Windows machine was reachable from it.

### Supplementary: `--tls --default-port` (the TLS proxy case for p10)

These runs go beyond the plan's seven. `--tls` serves `https://localhost:<port>/`, so `{B}` carries an explicit non-default port. A real TLS proxy serves the default port, where `Host` has no port.

`--default-port` loads `https://r5-probe.test/` through a local CONNECT proxy that tunnels only that name to the probe. So the Host is `r5-probe.test` and `{B}` is `http://r5-probe.test/design-preview/<token>/`. Binding 443 directly needs root.

### chromium, --tls --default-port

`node tools/spikes/design-preview-r5/probe.mjs --browser chromium --tls --default-port`: exit 0, `browser=chromium version=156.0.8078.80 page=https host=r5-probe.test (default port, through a CONNECT proxy) os=darwin`

| Row | Result | Detail |
|---|---|---|
| p1-nonce-runs | ok | the build doc nonce script ran |
| p2-no-model-js | ok | none of inline-script, script-src-file, onerror, onload, javascript-url ran; 6 CSP violations reported in the doc |
| p3-opaque | ok | self.origin build=null run=null; e.origin build=["null"] run=["null"]; e.source matched frame.contentWindow for every message (unmatched=0) |
| p4-path-css-img | ok | link color=rgb(1, 2, 3) sheet=true img naturalWidth=1; server saw p.css 1x, p.png 1x |
| p5-path-font | ok | font faces=["loaded"] load=resolved 1; server saw p.woff2 1x with Origin=null Sec-Fetch-Mode=cors answered ACAO=* |
| p6-path-enforced | ok | /outside.png img naturalWidth=0; server saw it 0x |
| p7-run-inline | ok | run bridge (inline, no nonce) ran; model inline-script ran; assets/p.js under {B} ran |
| p8-run-connect | ok | fetch(assets/p.css)=ok fetch(/outside.png)=rejected TypeError; server saw /outside.png 0x |
| p9-fetch-metadata | ok | Sec-Fetch-Site build/p.css=cross-site run/p.js=cross-site build/p.png=cross-site build/p.woff2=cross-site run/p.css=cross-site |
| p12-shell-frames | ok | under the shell CSP: server served build=true run=true; frame loads build=1 run=1; frames reported=true; parent violations=[] |
| p10-http-source-on-https | ok | {B}=http:// on the https page: p4 ok (link color=rgb(1, 2, 3) sheet=true img naturalWidth=1; server saw p.css 1x, p.png 1x); p5 ok (font faces=["loaded"] load=resolved 1; server saw p.woff2 1x with Origin=null Sec-Fetch-Mode=cors answered ACAO=*); same {B} in the run doc, for P8: p7 ok (run bridge (inline, no nonce) ran; model inline-script ran; assets/p.js under {B} ran); p8 ok (fetch(assets/p.css)=ok fetch(/outside.png)=rejected TypeError; server saw /outside.png 0x) |
| p11-https-source | ok | {B}=https://: p4 ok, p5 ok |

### firefox, --tls --default-port

`node tools/spikes/design-preview-r5/probe.mjs --browser firefox --tls --default-port`: exit 0, `browser=firefox version=157.0 page=https host=r5-probe.test (default port, through a CONNECT proxy) os=darwin`

| Row | Result | Detail |
|---|---|---|
| p1-nonce-runs | ok | the build doc nonce script ran |
| p2-no-model-js | ok | none of inline-script, script-src-file, onerror, onload, javascript-url ran; 5 CSP violations reported in the doc |
| p3-opaque | ok | self.origin build=null run=null; e.origin build=["null"] run=["null"]; e.source matched frame.contentWindow for every message (unmatched=0) |
| p4-path-css-img | ok | link color=rgb(1, 2, 3) sheet=true img naturalWidth=1; server saw p.css 1x, p.png 1x |
| p5-path-font | ok | font faces=["loaded"] load=resolved 1; server saw p.woff2 1x with Origin=null Sec-Fetch-Mode=cors answered ACAO=* |
| p6-path-enforced | ok | /outside.png img naturalWidth=0; server saw it 0x |
| p7-run-inline | ok | run bridge (inline, no nonce) ran; model inline-script ran; assets/p.js under {B} ran |
| p8-run-connect | ok | fetch(assets/p.css)=ok fetch(/outside.png)=rejected TypeError; server saw /outside.png 0x |
| p9-fetch-metadata | ok | Sec-Fetch-Site build/p.css=cross-site build/p.png=cross-site run/p.js=cross-site build/p.woff2=cross-site run/p.css=cross-site |
| p12-shell-frames | ok | under the shell CSP: server served build=true run=true; frame loads build=1 run=1; frames reported=true; parent violations=[] |
| p10-http-source-on-https | ok | {B}=http:// on the https page: p4 ok (link color=rgb(1, 2, 3) sheet=true img naturalWidth=1; server saw p.css 1x, p.png 1x); p5 ok (font faces=["loaded"] load=resolved 1; server saw p.woff2 1x with Origin=null Sec-Fetch-Mode=cors answered ACAO=*); same {B} in the run doc, for P8: p7 ok (run bridge (inline, no nonce) ran; model inline-script ran; assets/p.js under {B} ran); p8 ok (fetch(assets/p.css)=ok fetch(/outside.png)=rejected TypeError; server saw /outside.png 0x) |
| p11-https-source | ok | {B}=https://: p4 ok, p5 ok |

### webkit, --tls --default-port

`node tools/spikes/design-preview-r5/probe.mjs --browser webkit --tls --default-port`: exit 0, `browser=webkit version=27.2 page=https host=r5-probe.test (default port, through a CONNECT proxy) os=darwin`

| Row | Result | Detail |
|---|---|---|
| p1-nonce-runs | ok | the build doc nonce script ran |
| p2-no-model-js | ok | none of inline-script, script-src-file, onerror, onload, javascript-url ran; 6 CSP violations reported in the doc |
| p3-opaque | ok | self.origin build=null run=null; e.origin build=["null"] run=["null"]; e.source matched frame.contentWindow for every message (unmatched=0) |
| p4-path-css-img | ok | link color=rgb(1, 2, 3) sheet=true img naturalWidth=1; server saw p.css 1x, p.png 1x |
| p5-path-font | ok | font faces=["loaded"] load=resolved 1; server saw p.woff2 1x with Origin=absent Sec-Fetch-Mode=no-cors answered ACAO=* |
| p6-path-enforced | ok | /outside.png img naturalWidth=0; server saw it 0x |
| p7-run-inline | ok | run bridge (inline, no nonce) ran; model inline-script ran; assets/p.js under {B} ran |
| p8-run-connect | ok | fetch(assets/p.css)=ok fetch(/outside.png)=rejected TypeError; server saw /outside.png 0x |
| p9-fetch-metadata | ok | Sec-Fetch-Site build/p.css=cross-site run/p.js=cross-site run/p.css=cross-site build/p.png=cross-site build/p.woff2=cross-site |
| p12-shell-frames | ok | under the shell CSP: server served build=true run=true; frame loads build=1 run=1; frames reported=true; parent violations=[] |
| p10-http-source-on-https | ok | {B}=http:// on the https page: p4 ok (link color=rgb(1, 2, 3) sheet=true img naturalWidth=1; server saw p.css 1x, p.png 1x); p5 ok (font faces=["loaded"] load=resolved 1; server saw p.woff2 1x with Origin=absent Sec-Fetch-Mode=no-cors answered ACAO=*); same {B} in the run doc, for P8: p7 ok (run bridge (inline, no nonce) ran; model inline-script ran; assets/p.js under {B} ran); p8 ok (fetch(assets/p.css)=ok fetch(/outside.png)=rejected TypeError; server saw /outside.png 0x) |
| p11-https-source | ok | {B}=https://: p4 ok, p5 ok |

## Findings

1. **No STOP row.** These held in every browser reached, over both transports:
   - `p2-no-model-js`: none of the five model-JS forms ran;
   - `p3-opaque`: `self.origin`, `e.origin` and `e.source` were all as specified;
   - `p12-shell-frames`: the shell CSP allowed framing.

   SPEC section 3 and L5 hold in Chrome, Firefox, WebKit and Safari.
2. **p1, p4, p6, p7, p8, p9 and p11 pass everywhere.**
   - The nonce script runs in the opaque frame.
   - Path sources admit `{B}` and refuse `/outside.png` on the same host, for `img` and for `fetch`.
   - The run doc's inline JS and `connect-src {B}` behave.
   - Every frame subresource sent `Sec-Fetch-Site: cross-site`.
3. **p5: WebKit and Safari fetch `@font-face` as `no-cors`.** The request carries `Sec-Fetch-Mode: no-cors` and no `Origin` header, so `Access-Control-Allow-Origin` is not consulted. The font still loads.
   - Chrome and Firefox send a CORS request with `Origin: null`, and the `*` answer satisfies it.
   - So the probe's p5 accepts either shape: a CORS request with `Origin: null` and ACAO `*`, or a `no-cors` request with no `Origin`. Each must come with a loaded font.
   - The plan's text assumed every browser sends `Origin: null`. This is recorded in the run's `DEVIATIONS.md`.
   - No browser needs p5's fallback.
4. **p10 fails in Chrome only when `{B}` names an explicit non-default port.**
   - The failing case: page `https://localhost:<port>/`, `{B}` = `http://localhost:<port>/…`. Chrome 156 does not match the `http:` source against the `https:` URL on the same explicit port. CSS, image, font, run-doc `assets/p.js` and `fetch` were all blocked before any request.
   - Firefox and WebKit match it.
   - With the default port, Chrome passes too. That is the real proxy case: page `https://r5-probe.test/`, `{B}` = `http://r5-probe.test/…`.
   - For P8: a deployment whose proxy drops `X-Forwarded-Proto` AND serves a non-default https port breaks Chrome's subresources. In that case `inline=1` fixes the build doc only. The run doc's `script-src {B}` and `connect-src {B}` stay blocked, which matters only for `.js` files and `fetch`; docs inline their JS.
   - Task 3's `X-Forwarded-Proto` read avoids the case entirely.
5. **No constant changes.** No result calls for `PREVIEW_INLINE_DEFAULT = true` (Task 11), for serving the bridge at `{B}build/__bridge.js` (p1), or for a different run-doc `script-src` or `connect-src` (p7, p8).

## Fallbacks to apply

- p10-http-source-on-https, chromium (Chrome 156), --tls with an explicit non-default port (`https://localhost:<port>/`): `previewBase` already reads `X-Forwarded-Proto` (Task 3). Where a proxy omits it, use `inline=1` on that deployment. (The same Chrome passes p10 on the default port; see Findings 4.)

## Task 13: the real-browser proof

`tools/verify-design-preview-cdp.mjs` (`npm run verify:design-preview`) seeds three designs through P1's store and spawns one real `node ui/server.mjs` (`WORCA_FLAGS=design`, `WORCA_MOCK=1`, a scratch HOME and WORCA_HOME). It mints tokens through the real `POST /api/design/:id/preview-token`. Each doc is framed in the real worca shell, under the shell's own CSP, with `sandbox="allow-scripts"` and `referrerpolicy="no-referrer"`, and is driven by C-6 messages.

- **Date:** 2026-11-07. **Host:** as above (macOS 26.6.2, arm64, on AC power).
- **Judge:** Chrome, which CI's `cdp` job also runs. Firefox and WebKit were each run once on this host, as Task 13 Step 4 asks.
- **`assets/p.webm`:** each browser recorded its own (`webm=` in the header line). WebKit 27.2 records and plays webm, so no media-only browser limit was hit.
- **Mutation check (Chrome).** 13 one-line product mutants were each run through the whole proof in a scratch copy of this tree. Every one turned its check `FAIL`:

  | Mutant | Check that failed |
  |---|---|
  | settle off | `settle ran and added no attribute` |
  | settle adds an attribute | `settle ran and added no attribute` |
  | no beat | `at most 8 applies a second` (40 applies), and `12 live of 40 held the limit` (100 applies a section) |
  | a 230 ms flush | `12 live of 40 held the limit`: 16 long tasks, the largest 233 ms. So the frame's longtask observer does see the frame's tasks |
  | `docRect` without scroll | `applied rect matches the element` |
  | slot moved to `<body>` | `a nested slot was replaced where it stood` |
  | `<video>` replaced on a morph | `video kept playing across a morph` |
  | rects stop at 39 | `rects reported all 40` |
  | `picked.tag` from the root | `picked the clicked element` |
  | build `script-src 'unsafe-inline'` | `raw file under build CSP: no hostile payload fired` (6 payloads fired) |
  | `meta[http-equiv]` kept by `stripBuildDoc` | `meta refresh did not navigate` (2 loads, `chrome-error://`) |
  | run `connect-src *` | `run doc: /api refused` (still rejected by CORS, but no `connect-src` violation) |
  | no `Access-Control-Allow-Origin` | `font loaded with Origin: null` |

  The control (no change) was all `ok`. With the bridge's `strip` and the build doc's click canceller both off, every check stayed `ok`: the CSP alone holds a live section.

### chromium (the judge)

`npm run verify:design-preview`: exit 0, `browser=chromium version=156.0.8078.80 os=darwin webm=chromium page=http://localhost:<port>/`

| Check | Result | Detail |
|---|---|---|
| build doc: no hostile payload fired | ok | clicked jsl,jsl2,jsl3,b; pwn []; window.__pwn null |
| meta refresh did not navigate | ok | loads 1 at 1500 ms, 1 after the clicks; url unchanged |
| raw file under build CSP: no hostile payload fired | ok | raw: loaded 1, clicked jsl,jsl2,jsl3,b, pwn []; live section: applied rev 1, clicked jsl,jsl2,jsl3,b, pwn [] |
| font loaded with Origin: null | ok | faces ["loaded"]; requests Origin=null Sec-Fetch-Mode=cors 200 ACAO=* |
| applied rect matches the element | ok | scrollY 600; applied [0,137.3,1280,1481.9] vs element [0,137.3,1280,1481.9]; tail [147,1601.2,7.1,18] |
| at most 8 applies a second | ok | 17 applies for 40 messages over 1950 ms; last rev landed 98 ms after its send |
| settle ran and added no attribute | ok | animations right after each apply [1,1]; once finished [0,0]; markup as sent plus data-section |
| video kept playing across a morph | ok | same element true, paused false, currentTime 0.05 0.15 0.25 0.35 0.45 0.55 (5 of 5 steps rose) |
| a nested slot was replaced where it stood | ok | row before s0@0 s1@322 s2@644 s3@966; after slot s0@0 s1@322 slot s2@644 slot s3@966 |
| rects reported all 40 | ok | 40 sections, each finite and at least its estHeight tall; docH 2518 |
| 12 live of 40 held the limit | ok | long tasks 0, largest 0 ms; largest 16 ms timer gap 22 ms; most applies per section 39 over 4952 ms; slowest last rev 149 ms |
| run doc: model script ran | ok | {ran:1} from the frame, origin null |
| run doc: /api refused | ok | fetch(location.origin + '/api/flags') rejected TypeError; violations ["connect-src"]; fetch('assets/p.woff2') 200 |
| picked the clicked element | ok | id hero, tag h1, path [data-section="hero"] > h1:nth-of-type(1) |
| frame origin is null | ok | 11 ready messages, each matched to its frame's contentWindow; e.origin ["null"] |

### firefox

`node tools/verify-design-preview-cdp.mjs --browser firefox`: exit 0, `browser=firefox version=157.0 os=darwin webm=firefox page=http://localhost:<port>/`

| Check | Result | Detail |
|---|---|---|
| build doc: no hostile payload fired | ok | clicked jsl,jsl2,jsl3,b; pwn []; window.__pwn null |
| meta refresh did not navigate | ok | loads 1 at 1500 ms, 1 after the clicks; url unchanged |
| raw file under build CSP: no hostile payload fired | ok | raw: loaded 1, clicked jsl,jsl2,jsl3,b, pwn []; live section: applied rev 1, clicked jsl,jsl2,jsl3,b, pwn [] |
| font loaded with Origin: null | ok | faces ["loaded"]; requests Origin=null Sec-Fetch-Mode=cors 200 ACAO=* |
| applied rect matches the element | ok | scrollY 600; applied [0,141.1,1280,1483.9] vs element [0,141.1,1280,1483.9]; tail [147.1,1607.5,7.1,16] |
| at most 8 applies a second | ok | 16 applies for 40 messages over 1954 ms; last rev landed 25 ms after its send |
| settle ran and added no attribute | ok | animations right after each apply [1,1]; once finished [0,0]; markup as sent plus data-section |
| video kept playing across a morph | ok | same element true, paused false, currentTime 0.09 0.18 0.31 0.40 0.53 0.63 (5 of 5 steps rose) |
| a nested slot was replaced where it stood | ok | row before s0@0 s1@322 s2@644 s3@966; after slot s0@0 s1@322 slot s2@644 slot s3@966 |
| rects reported all 40 | ok | 40 sections, each finite and at least its estHeight tall; docH 2519 |
| 12 live of 40 held the limit | ok | longtask not observable here, judged by the largest timer gap; largest 16 ms timer gap 128 ms; most applies per section 38 over 4952 ms; slowest last rev 115 ms |
| run doc: model script ran | ok | {ran:1} from the frame, origin null |
| run doc: /api refused | ok | fetch(location.origin + '/api/flags') rejected TypeError; violations ["connect-src"]; fetch('assets/p.woff2') 200 |
| picked the clicked element | ok | id hero, tag h1, path [data-section="hero"] > h1:nth-of-type(1) |
| frame origin is null | ok | 11 ready messages, each matched to its frame's contentWindow; e.origin ["null"] |

### webkit

`node tools/verify-design-preview-cdp.mjs --browser webkit`: exit 0, `browser=webkit version=27.2 os=darwin webm=webkit page=http://localhost:<port>/`

| Check | Result | Detail |
|---|---|---|
| build doc: no hostile payload fired | ok | clicked jsl,jsl2,jsl3,b; pwn []; window.__pwn null |
| meta refresh did not navigate | ok | loads 1 at 1500 ms, 1 after the clicks; url unchanged |
| raw file under build CSP: no hostile payload fired | ok | raw: loaded 1, clicked jsl,jsl2,jsl3,b, pwn []; live section: applied rev 1, clicked jsl,jsl2,jsl3,b, pwn [] |
| font loaded with Origin: null | ok | faces ["loaded"]; requests Origin=absent Sec-Fetch-Mode=no-cors 200 ACAO=* |
| applied rect matches the element | ok | scrollY 600; applied [0,137.3,1280,1481.9] vs element [0,137.3,1280,1481.9]; tail [147,1601.2,7.2,18] |
| at most 8 applies a second | ok | 16 applies for 40 messages over 1955 ms; last rev landed 79 ms after its send |
| settle ran and added no attribute | ok | animations right after each apply [1,1]; once finished [0,0]; markup as sent plus data-section |
| video kept playing across a morph | ok | same element true, paused false, currentTime 0.10 0.20 0.30 0.40 0.50 0.61 (5 of 5 steps rose) |
| a nested slot was replaced where it stood | ok | row before s0@0 s1@322 s2@644 s3@966; after slot s0@0 s1@322 slot s2@644 slot s3@966 |
| rects reported all 40 | ok | 40 sections, each finite and at least its estHeight tall; docH 2518 |
| 12 live of 40 held the limit | ok | longtask not observable here, judged by the largest timer gap; largest 16 ms timer gap 41 ms; most applies per section 37 over 4955 ms; slowest last rev 132 ms |
| run doc: model script ran | ok | {ran:1} from the frame, origin null |
| run doc: /api refused | ok | fetch(location.origin + '/api/flags') rejected TypeError; violations ["connect-src"]; fetch('assets/p.woff2') 200 |
| picked the clicked element | ok | id hero, tag h1, path [data-section="hero"] > h1:nth-of-type(1) |
| frame origin is null | ok | 11 ready messages, each matched to its frame's contentWindow; e.origin ["null"] |

### Findings of Task 13

1. **Every check is `ok` in Chrome, Firefox and WebKit.** No constant changes: `BEAT_MS` stays 125, and no fallback applies.
2. **12 live of 40, in Chrome:** 0 long tasks. The most applies any one section got was 39, over about 5 s. The slowest last rev landed 149 ms after its send. The largest gap of a 16 ms timer in the frame was 22 ms.
3. **Firefox and WebKit have no `longtask` entry type.** There the tool judges the stall by the largest gap of a 16 ms timer in the frame, against the same 200 ms bound: 128 ms in Firefox, 41 ms in WebKit.
4. **WebKit fetches the `@font-face` no-cors, with no `Origin`.** This is the same shape as Task 1's p5 (Findings 3). The font loads and the response carries ACAO `*`. The tool accepts that shape for WebKit only; Chrome and Firefox must send `Origin: null`.
5. **Linux and Windows:** not reached from this host. CI's `cdp` job runs the proof in Chrome on ubuntu.

### Review fix cycles: checks 16 and 17

Two checks were added after the tables above: `a shell naming Document members still boots and merges` (fix cycle 4) and
`form= controls neither hang a merge nor reach another section` (fix cycle 5). On the fix-cycle-5 tree, all 17 checks are
`ok` (exit 0) in Chrome 156.0.8078.80, Firefox 157.0 and WebKit 27.2 on darwin. The two new rows read the same in all three:

| Check | Result | Detail |
|---|---|---|
| a shell naming Document members still boots and merges | ok | applied rev 1; morphdom a function, `document.createElement` an img, hero `<section data-section="hero"><h1>Ship, merged</h1></section>` |
| form= controls neither hang a merge nor reach another section | ok | revs 1 to 4 applied; no `[form]` before or after; aside and `other` unchanged; hero after rev 2 `<section data-section="hero"><h1>Sign up</h1><form id="f"><input name="email"></form></section>`, after rev 4 `<form data-section="hero" class="a" id="h"><input name="q"><p>2</p></form>` |

With the cycle-4 `bridge.js` and `preview-doc.mjs` put back (every other file as in cycle 5), check 17 is the one `FAIL`:
"the frame hung after rev 2" in Chrome (only the frame hangs, so the frame read is what times out) and in Firefox (the
parent page hangs too). The Node-side race ends both runs, with exit 1, in about 30 s.
