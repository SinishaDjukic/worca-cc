# Third-party notices

Worca is MIT-licensed (see `LICENSE`). The pieces below were adapted from other
MIT-licensed projects; their notices travel with the code as the license asks.

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
