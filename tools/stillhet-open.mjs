// npm run stillhet: builds the prototype's generated files and opens it in the browser.
// npm run stillhet -- --serve [port]: serves the repository on 127.0.0.1 (default 4610) and opens the prototype from there.
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildStillhet } from './stillhet-build.mjs';

await buildStillhet();

const root = fileURLToPath(new URL('..', import.meta.url));
const at = process.argv.indexOf('--serve');
const page = at < 0 ? fileURLToPath(new URL('../plans/stillhet/prototype/index.html', import.meta.url)) : await serve(Number(process.argv[at + 1]) || 4610);

function serve(port) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
  const server = createServer((req, res) => {
    const file = normalize(join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
    let ok = false;
    try { ok = (file + sep).startsWith(root) && statSync(file).isFile(); } catch { /* not there */ }
    if (!ok) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    createReadStream(file).pipe(res);
  });
  return new Promise((done) => server.listen(port, '127.0.0.1', () => done(`http://127.0.0.1:${port}/plans/stillhet/prototype/index.html`)));
}
const [cmd, ...args] = process.platform === 'darwin' ? ['open'] : process.platform === 'win32' ? ['cmd', '/c', 'start', ''] : ['xdg-open'];
spawn(cmd, [...args, page], { stdio: 'ignore', detached: true }).on('error', () => console.error(`Could not open a browser: open ${page} yourself`)).unref();
console.log(page);
