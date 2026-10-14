// tools/demo/extension-video/lib/ports.mjs — a free loopback port (the OS picks it; never a fixed one: 4327 may be a running test Worca).
import net from 'node:net';

export const freePort = (host = '127.0.0.1') => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.once('error', reject);
  s.listen(0, host, () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

export const portFree = (port, host = '127.0.0.1') => new Promise((resolve) => {
  const s = net.createServer();
  s.once('error', () => resolve(false));
  s.listen(port, host, () => s.close(() => resolve(true)));
});
