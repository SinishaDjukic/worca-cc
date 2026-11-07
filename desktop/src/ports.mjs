// desktop/src/ports.mjs — which port the desktop app asks its server to bind (docs/desktop.md).
// 4317 (worca's default, the browser extension's too) when it is free, else 0: the server binds an OS port and
// prints it on its ready line, so the fallback has no check-then-bind race. Imports only node: builtins.
import realNet from 'node:net';

export const PREFERRED_PORT = 4317;

/** Whether (port, host) can be bound right now. EADDRINUSE / EACCES → false; any other error rejects. */
export function isPortFree(port, host = '127.0.0.1', { net = realNet } = {}) {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', (err) => {
      if (err && (err.code === 'EADDRINUSE' || err.code === 'EACCES')) resolve(false);
      else reject(err);
    });
    srv.listen(port, host, () => srv.close(() => resolve(true)));
  });
}

/** `preferred` when free, else 0 (D4). */
export async function choosePort({ preferred = PREFERRED_PORT, host = '127.0.0.1', isFree = isPortFree } = {}) {
  return (await isFree(preferred, host)) ? preferred : 0;
}
