// tools/mock-artifact/build.mjs — the build half of the mock artifact (docs/screenshots.md#mock-artifact): one
// self-contained HTML page holding the real frontend (ui/public, bundled with esbuild) and a fake backend (shim.js)
// that answers from a recording (record.mjs). Same recording + same ui/public = the same page, byte for byte.
//
//   node tools/mock-artifact/build.mjs <recording.json> <out.html>
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const PUB = path.join(REPO, 'ui', 'public');
const NM = path.join(REPO, 'node_modules');

/** The recorded HTTP answers, keyed the way shim.js looks them up: method + path + query (+ body), with
 *  method + path as the fallback. Only /api/* and only what came before the chat turn (turnMark). */
export function httpTable(rec) {
  const table = {};
  const mark = rec.turnMark?.http ?? rec.http.length;
  for (const e of rec.http.slice(0, mark)) {
    if (e.status == null || e.err) continue;
    const u = new URL(e.url, 'http://x');
    if (!u.pathname.startsWith('/api/')) continue;
    const resp = { s: e.status, ct: e.ct, ...(e.b64 != null ? { b: e.b64 } : { t: e.text ?? '' }) };
    if (e.body) table[`${e.method} ${u.pathname}${u.search} ${e.body}`] = resp;
    table[`${e.method} ${u.pathname}${u.search}`] ??= resp;
    table[`${e.method} ${u.pathname}`] = resp;
  }
  // The viewer's own light or dark preference, not the light theme the sandbox stores for its screenshots.
  for (const [k, v] of Object.entries(table)) {
    if (!/^GET \/api\/settings(\?|$)/.test(k) || !v.t) continue;
    try {
      const j = JSON.parse(v.t);
      if (j && typeof j === 'object' && 'theme' in j) { j.theme = 'system'; v.t = JSON.stringify(j); }
    } catch { /* not JSON: leave it */ }
  }
  return table;
}

/** The server's socket frames before the chat turn: the hello, then each run's frames (shim.js sends them on subscribe). */
export const wsFrames = (rec) => rec.ws.slice(0, rec.turnMark?.ws ?? rec.ws.length).filter((w) => w.dir === 'in').map((w) => w.data);

/** Text inside <script>: no early </script>, no <!-- (which would start the script-data escape state). */
const inScript = (s) => s.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
/** JSON inside <script type=application/json>, ASCII only, so the page reads the same under any charset. */
const jsonInScript = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/[\u0080-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

export async function buildMockPage(rec) {
  const req = createRequire(path.join(REPO, 'package.json'));
  const esbuild = req('esbuild');
  const { renderIndexHtml } = await import(pathToFileURL(path.join(REPO, 'src/core/index-html.mjs')).href);
  const { HLJS_GRAMMAR_IDS } = await import(pathToFileURL(path.join(PUB, 'hljs-loader.mjs')).href);

  // URL path (as the browser asks for it) -> file on disk, mirroring the routes of ui/server.mjs.
  const VENDOR = {
    '/vendor/marked/marked.esm.js': path.join(NM, 'marked/lib/marked.esm.js'),
    '/vendor/dompurify/purify.es.mjs': path.join(NM, 'dompurify/dist/purify.es.mjs'),
    '/vendor/xterm/xterm.mjs': path.join(NM, '@xterm/xterm/lib/xterm.mjs'),
    '/vendor/xterm/addon-fit.mjs': path.join(NM, '@xterm/addon-fit/lib/addon-fit.mjs'),
  };
  for (const [k, f] of Object.entries(VENDOR)) if (!fs.existsSync(f)) throw new Error(`${k}: ${f} is missing (npm ci)`);
  const fileFor = (p) => VENDOR[p] || (p.startsWith('/src/') ? path.join(REPO, p) : path.join(PUB, p));
  const urlPathOf = (file) => {
    for (const root of [PUB, REPO]) {
      if (!file.startsWith(root + path.sep)) continue;
      const rel = path.relative(root, file).split(path.sep).join('/');
      if (root === PUB || rel.startsWith('src/')) return `/${rel}`;
    }
    return null;
  };
  // The frontend imports by URL ('../src/shared/x.mjs' from /app.js is /src/shared/x.mjs, served from the repo).
  const urlPaths = {
    name: 'url-paths',
    setup(b) {
      b.onResolve({ filter: /^(\.{1,2})?\// }, (args) => {
        if (args.kind === 'entry-point') return undefined;
        const from = args.importer && urlPathOf(args.importer);
        if (!from && !args.path.startsWith('/')) return undefined;   // inside node_modules: default resolution
        return { path: fileFor(decodeURIComponent(new URL(args.path, `http://x${from || '/'}`).pathname)) };
      });
    },
  };

  const js = await esbuild.build({
    entryPoints: [path.join(PUB, 'app.js')], bundle: true, format: 'esm', write: false, minify: true, target: 'es2022',
    plugins: [urlPaths], logLevel: 'warning', legalComments: 'none', charset: 'ascii',
  });
  // esbuild inlines import('literal'); an import(variable) stays (the hljs grammars): route it to the page's table.
  const appJs = js.outputFiles[0].text.replace(/\bimport\(/g, '__worcaImport(');
  const css = await esbuild.build({
    entryPoints: [path.join(PUB, 'style.css')], bundle: true, write: false, minify: true, plugins: [urlPaths],
    loader: { '.woff2': 'dataurl', '.png': 'dataurl', '.jpg': 'dataurl', '.svg': 'dataurl' }, logLevel: 'warning', charset: 'ascii',
  });

  // Files the frontend names by URL at runtime (img src, a <script> it injects, a <link> it adds): shim.js maps them.
  const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
  const assets = {};
  const add = (urlPath, file) => { assets[urlPath] = { type: MIME[path.extname(file)] || 'application/octet-stream', b64: fs.readFileSync(file).toString('base64') }; };
  for (const d of ['assets', 'fonts']) for (const f of fs.readdirSync(path.join(PUB, d)).sort()) add(`/${d}/${f}`, path.join(PUB, d, f));
  add('/c4/dagre.min.js', path.join(PUB, 'c4/dagre.min.js'));
  add('/vendor/xterm/xterm.css', path.join(NM, '@xterm/xterm/css/xterm.css'));
  const hljs = path.join(NM, '@highlightjs/cdn-assets/es');
  const modules = { '/vendor/hljs/core.min.js': fs.readFileSync(path.join(hljs, 'core.min.js'), 'utf8') };
  for (const id of HLJS_GRAMMAR_IDS) {
    const f = path.join(hljs, 'languages', `${id}.min.js`);
    if (fs.existsSync(f)) modules[`/vendor/hljs/languages/${id}.min.js`] = fs.readFileSync(f, 'utf8');
  }

  const ws = wsFrames(rec);
  const hello = JSON.parse(ws.find((d) => d.startsWith('{"type":"hello"')) || '{}');
  // The page's clock starts just after the crawl began, so the seeded chats read "just now" as they did.
  const data = { now: rec.t0 + 2000, http: httpTable(rec), ws, assets, modules };
  const shim = fs.readFileSync(path.join(HERE, 'shim.js'), 'utf8');

  const html = renderIndexHtml(fs.readFileSync(path.join(PUB, 'index.html'), 'utf8'), 'system', 'expert', hello.flags || {}, { git: true })
    .replace(/<link rel="stylesheet" href="\/style\.css" \/>/, () => `<style>${css.outputFiles[0].text}</style>`)
    .replace(/<link rel="icon"[^>]*>/, () => `<link rel="icon" type="image/png" href="data:image/png;base64,${assets['/assets/worca-favicon.png'].b64}" />`)
    .replace(/<script src="\/app\.js" type="module"><\/script>/, () =>
      `<script type="application/json" id="worca-mock-data">${jsonInScript(data)}</script>\n<script>${inScript(shim)}</script>\n<script type="module">${inScript(appJs)}</script>`);
  if (!html.includes('id="worca-mock-data"')) throw new Error('ui/public/index.html lost its app.js script tag');

  // The artifact host wraps the page in its own document: keep the head and body contents, and set the <html>
  // attributes the stylesheet keys on (theme, interface mode, flags, git) from the first script.
  const rootAttrs = Object.fromEntries([...html.match(/<html([^>]*)>/)[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  const headEnd = html.indexOf('</head>');
  const head = html.slice(html.indexOf('<head>') + 6, headEnd)
    .replace(/<meta charset[^>]*>\s*/i, '').replace(/<meta name="viewport"[^>]*>\s*/i, '').replace(/<title>[^<]*<\/title>\s*/, '');
  const bodyOpen = html.indexOf('>', html.indexOf('<body', headEnd)) + 1;
  return `<meta charset="utf-8">\n<title>Worca Mock</title>\n`
    + `<script>(function(a){for(var k in a)document.documentElement.setAttribute(k,a[k]);})(${JSON.stringify(rootAttrs)});</script>\n`
    + `${head}\n${html.slice(bodyOpen, html.lastIndexOf('</body>'))}`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [recFile, out] = process.argv.slice(2);
  if (!recFile || !out) { console.error('usage: node tools/mock-artifact/build.mjs <recording.json> <out.html>'); process.exit(2); }
  const page = await buildMockPage(JSON.parse(fs.readFileSync(recFile, 'utf8')));
  fs.writeFileSync(out, page);
  console.log(`${out}: ${(page.length / 1e6).toFixed(1)} MB`);
}
