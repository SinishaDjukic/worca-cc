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
through the official SDK, `@modelcontextprotocol/sdk 1.31.0` (MIT, Copyright (c)
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
