# Third-party notices

Worca is MIT-licensed (see `LICENSE`). The first section below covers code adapted
from another MIT-licensed project, whose notice travels with the code as its license
asks; the last names the npm packages worca installs for MCP Test.

## ericc-ch/copilot-api

`src/core/bridge/providers/copilot.mjs` carries the GitHub Copilot protocol
constants — the device-flow client id and scope, the token-exchange endpoint,
the gateway hosts and the editor request headers — as published in
[ericc-ch/copilot-api](https://github.com/ericc-ch/copilot-api). The
translation layer under `src/core/bridge/translate/` was written for Worca; the
same project, together with
[voidsteed/copilot-proxy-api](https://github.com/voidsteed/copilot-proxy-api),
served as the reference for the edge cases it handles.

```
MIT License

Copyright (c) 2025 Erick Christian

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## @modelcontextprotocol/sdk

Test (on the Connectors page, `src/core/mcp/test.mjs`) talks to MCP servers
through the official SDK, `@modelcontextprotocol/sdk 1.32.2` (MIT, Copyright (c)
2024 Anthropic, PBC), pinned exactly in `package.json`. It and the packages it
pulls in are installed from npm, each under its own license (the text ships in
the package):

- MIT: `@modelcontextprotocol/sdk`, `@hono/node-server`, `accepts`, `ajv`,
  `ajv-formats`, `body-parser`, `content-disposition`, `content-type`,
  `cookie-signature`, `cors`, `cross-spawn`, `debug`, `eventsource`,
  `eventsource-parser`, `express` (5, nested under the SDK), `express-rate-limit`,
  `fast-deep-equal`, `finalhandler`, `fresh`, `hono`, `iconv-lite`, `ip-address`,
  `is-promise`, `jose`, `json-schema-traverse`, `media-typer`,
  `merge-descriptors`, `mime-db`, `mime-types`, `ms`, `negotiator`,
  `object-assign`, `path-key`, `path-to-regexp`, `pkce-challenge`, `raw-body`,
  `require-from-string`, `router`, `send`, `serve-static`, `shebang-command`,
  `shebang-regex`, `type-is`, `zod`
- ISC: `isexe`, `once`, `which`, `wrappy`, `zod-to-json-schema`
- BSD-2-Clause: `json-schema-typed`
- BSD-3-Clause: `fast-uri`

## Terminal pane

The terminal pane (`ui/public/terminal-pane.mjs`) draws the shell with xterm.js, `@xterm/xterm 6.0.0` and
`@xterm/addon-fit 0.11.0` (MIT, Copyright (c) 2017-2024 The xterm.js authors), served from
`node_modules`. The server runs shells under `node-pty 1.1.0` (MIT, Copyright (c) Microsoft Corporation),
an optional dependency. Each is installed from npm under its own license (the text ships in the package):

- MIT: `@xterm/xterm`, `@xterm/addon-fit`, `node-pty`, `node-addon-api`

## Office preview fallback

When the server has no LibreOffice, the file viewer shows a simplified Office preview in the browser
(`ui/public/artifacts/office-lite.mjs`). It loads `docx-preview 0.4.1` (Apache-2.0, Copyright Volodymyr Baydalka) for
`.docx` page layout, and `jszip 3.10.2` (Copyright (c) 2009-2016 Stuart Knightley; dual licensed "MIT OR
GPL-3.0-or-later", used here under MIT) to read every Office package. Both are served from `node_modules`. The
minified `jszip.min.js` bundles `pako` (MIT AND Zlib, Copyright (C) 2014-2017 by Vitaly Puzrin and Andrei Tuputcyn),
`lie` and `immediate` (MIT), and `setimmediate` (MIT). Each is installed from npm under its own license (the text
ships in the package):

- Apache-2.0: `docx-preview`
- MIT (of MIT OR GPL-3.0-or-later): `jszip`
- MIT AND Zlib: `pako`
- MIT: `lie`, `immediate`, `setimmediate`
## @napi-rs/keyring

With the `secretVault` flag on, the vault's master key lives in the OS key store (macOS Keychain, Windows
Credential Manager or the Linux Secret Service), reached through `@napi-rs/keyring 2.1.2` (MIT, Copyright (c) 2020
N-API for Rust), an optional dependency loaded only by `src/core/secrets/keyring-backend.mjs`. npm installs the one
prebuilt platform package that matches the machine; none runs an install script. Each is installed from npm under
its own license (the text ships in the package):

- MIT: `@napi-rs/keyring`, `@napi-rs/keyring-darwin-arm64`, `@napi-rs/keyring-darwin-x64`, `@napi-rs/keyring-freebsd-x64`, `@napi-rs/keyring-linux-arm-gnueabihf`, `@napi-rs/keyring-linux-arm64-gnu`, `@napi-rs/keyring-linux-arm64-musl`, `@napi-rs/keyring-linux-riscv64-gnu`, `@napi-rs/keyring-linux-x64-gnu`, `@napi-rs/keyring-linux-x64-musl`, `@napi-rs/keyring-win32-arm64-msvc`, `@napi-rs/keyring-win32-ia32-msvc`, `@napi-rs/keyring-win32-x64-msvc`

## C4 viewer layout

The C4 viewer (`ui/public/c4/c4-view.mjs`) lays out element views and dependency-ordered frames with
`@dagrejs/dagre 3.1.1`, which bundles `@dagrejs/graphlib` (MIT, Copyright (c) 2012-2014 Chris Pettitt).
The minified browser build is vendored as `ui/public/c4/dagre.min.js` and loaded by the browser and,
through `scripts/c4-dagre.mjs`, by the C4 render card.

- MIT: `@dagrejs/dagre`, `@dagrejs/graphlib`

## Brand marks

The Models page (`ui/public/models/brand-marks.mjs`) draws the marks of AI vendors, tools and providers from
`@lobehub/icons-static-svg 1.103.0` (MIT, Copyright (c) 2023 LobeHub; its README states the license, and the
package ships no LICENSE file), served one file at a time from `node_modules` at `/vendor/brand-icons`. Each mark
is a trademark of its owner, shown only to name that owner's models, tools and services.

- MIT: `@lobehub/icons-static-svg`
