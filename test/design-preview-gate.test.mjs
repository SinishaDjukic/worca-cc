// test/design-preview-gate.test.mjs - P3 Task 11: the preview gate at /design-preview. It answers every request itself
// (a 599 sentinel mounted after it proves nothing falls through), checks the Host (403), the flag (404), the path and
// token (404), the design (404, which also drops the grant) and the method (405), then serves the generated doc or a
// file under work/ with C-7's headers. Refusals stay bare.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import express from 'express';
import { createPreviewGrants } from '../src/core/design/preview-grants.mjs';
import { createPreviewGate, parsePreviewPath } from '../src/core/design/preview-gate.mjs';

const POSIX = { skip: process.platform === 'win32' ? 'symlinks' : false };

// The real path of the temp root: macOS /var is a link to /private/var.
const root = realpathSync(mkdtempSync(join(tmpdir(), 'worca-gate-')));
const servers = [];
after(async () => {
  await Promise.all(servers.map((s) => new Promise((done) => { s.closeAllConnections?.(); s.close(() => done()); })));
  rmSync(root, { recursive: true, force: true });
});

const work = join(root, 'd_a', 'work');
// The NFC name the request `caf%C3%A9.png` decodes to, built in code so no editor can change its spelling.
const CAFE = 'caf' + String.fromCharCode(0xe9) + '.png';
const FIXTURE = {
  [join(work, 'plan.json')]: '{}',
  [join(work, 'x.js')]: 'console.log(1);\n',
  [join(work, 'm.mjs')]: 'export {};\n',
  [join(work, 'assets', 'hero.png')]: 'PNG-hero',
  [join(work, 'assets', 'Hero Image (1).png')]: 'PNG-hero-image',
  [join(work, 'assets', CAFE)]: 'PNG-cafe',
  [join(work, 'assets', 'thing.xyz')]: 'XYZ',
  [join(work, 'assets', 'p.woff2')]: 'wOF2-font-bytes',
  [join(work, 'assets', 'empty.png')]: '',
  [join(work, '.crew.json')]: '[]',
  [join(work, '.asks', 'a.json')]: '{}',
  [join(work, '.kit', 'CONTRACT.md')]: '# kit\n',
  [join(root, 'd_a', 'dist', 'a.html')]: '<p>dist</p>',
  [join(root, 'd_b', 'work', 'only-b.txt')]: 'only b',
  [join(root, 'secret.txt')]: 'SECRET',
};
for (const [file, text] of Object.entries(FIXTURE)) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

const DESIGNS = { d_a: { workDir: work, kind: 'web' }, d_b: { workDir: join(root, 'd_b', 'work'), kind: 'web' } };
const LOCAL_NAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
// Parses the Host with `new URL` as hostGuard does, so `localhost/;script-src *` passes here and only the gate's
// previewBase re-check can refuse it (L3.3).
const hostNameOk = (host) => {
  try { return LOCAL_NAMES.has(new URL(`http://${host}`).hostname); } catch { return false; }
};
const docStub = (calls) => (o) => { calls.push(o); return `<!doctype html><script nonce="${o.nonce}"></script>`; };
const lookup = (designs) => (id) => (Object.hasOwn(designs, id) ? designs[id] : null);

function deps(over = {}) {
  return { grants: createPreviewGrants(), hostNameOk, designFor: lookup(DESIGNS), renderDoc: docStub([]), enabled: () => true, ...over };
}

async function boot({ now, renderDoc, enabled } = {}) {
  const grants = createPreviewGrants({ now });
  const calls = [];
  let designs = { ...DESIGNS };
  const gate = createPreviewGate(deps({
    grants,
    designFor: (id) => lookup(designs)(id),
    renderDoc: renderDoc ?? docStub(calls),
    ...(enabled ? { enabled } : {}),
  }));
  const app = express();
  app.use('/design-preview', gate);
  app.use((_q, s) => s.status(599).send('fell through'));
  const server = http.createServer(app);
  servers.push(server);
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address();
  // http.request sends the path as written (no `..` folding, unlike fetch) and, by default, `Host: 127.0.0.1:<port>`.
  const raw = (path, { method = 'GET', headers = {} } = {}) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const r = { status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') };
        try { assert.notEqual(r.status, 599, `fell through the gate: ${method} ${path}`); resolve(r); } catch (e) { reject(e); }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
  const t = grants.mint({ designId: 'd_a', owner: null }).token;
  return { t, raw, grants, setDesigns: (next) => { designs = next; }, work, root, calls };
}

test('the gate takes no next argument', () => assert.equal(createPreviewGate(deps()).length, 2));
test('parsePreviewPath', () => {
  const T = 'a'.repeat(43);
  assert.deepEqual(parsePreviewPath(`/${T}/build/`), { token: T, mode: 'build', rel: '' });
  assert.deepEqual(parsePreviewPath(`/${T}/run/assets/Hero%20Image%20(1).png`), { token: T, mode: 'run', rel: 'assets/Hero Image (1).png' });
  for (const p of ['/', `/${T}`, `/${T}/`, `/${T}/build`, `/${T}/other/`, `/${T}/BUILD/`, `/short/build/`]) assert.equal(parsePreviewPath(p), null, p);
  for (const rel of ['..', '../x', '.', './x', '%2e%2e/x', '%2E%2E%2Fx', '..%2fx', '.%2e/x', '..%5cx', 'a/../../x', 'a/./x', 'a//x', '.crew.json', '.asks/a.json', '.kit/CONTRACT.md',
    'a%00b', 'a%0ab', 'C%3A%5CWindows%5Cwin.ini', 'x.png.', 'x.png%20', 'a%2Fb', '%zz'])
    assert.equal(parsePreviewPath(`/${T}/build/${rel}`), null, rel);
});
test('the doc: 200, C-7 headers, nonce in CSP matches the doc', async () => {
  const { t, raw } = await boot();
  const r = await raw(`/design-preview/${t}/build/`, { headers: { host: 'localhost:4317', origin: 'null' } });
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(r.headers['access-control-allow-origin'], '*');
  assert.equal(r.headers['cross-origin-resource-policy'], 'cross-origin');
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.equal(r.headers['referrer-policy'], 'no-referrer');
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.equal(r.headers['set-cookie'], undefined);
  assert.equal(r.headers['access-control-allow-credentials'], undefined);
  const n = /script-src 'nonce-([^']+)'/.exec(r.headers['content-security-policy'])[1];
  assert.ok(n.length >= 22);
  assert.ok(r.text.includes(`nonce="${n}"`));
  assert.ok(r.headers['content-security-policy'].includes(`http://localhost:4317/design-preview/${t}/`));
});
test('a new nonce for each doc', async () => {
  const { t, raw } = await boot();
  const nonce = async () => /'nonce-([^']+)'/.exec((await raw(`/design-preview/${t}/build/`)).headers['content-security-policy'])[1];
  assert.notEqual(await nonce(), await nonce());
});
test('bad tokens are 404 and tell nothing', async () => {
  const { t, grants, raw } = await boot();
  for (const bad of ['a'.repeat(43), 'short', '__proto__', `${t}x`]) {
    const r = await raw(`/design-preview/${bad}/build/`);
    assert.equal(r.status, 404); assert.ok(!r.text.includes('<')); assert.equal(r.headers['access-control-allow-origin'], undefined);
  }
  assert.equal((await raw('/design-preview')).status, 404);
  assert.equal((await raw('/design-preview/')).status, 404);
  assert.equal((await raw(`/design-preview/${t}`)).status, 404);
  assert.equal((await raw(`/design-preview/${t}/build`)).status, 404);
  assert.equal((await raw(`/design-preview/${t}/other/`)).status, 404);
  grants.revokeDesign('d_a');
  assert.equal((await raw(`/design-preview/${t}/build/`)).status, 404);
});
test('Review Focus: an expired grant and a deleted design are plain 404s, and the grant goes', async () => {
  let now = 0; const { t, raw, grants, setDesigns } = await boot({ now: () => now });
  now = 43_200_000;
  assert.equal((await raw(`/design-preview/${t}/build/`)).status, 404);
  now = 0; const t2 = grants.mint({ designId: 'd_a', owner: null }).token;
  setDesigns({});
  const r = await raw(`/design-preview/${t2}/run/assets/hero.png`);
  assert.equal(r.status, 404); assert.ok(!r.text.includes('<'));
  assert.equal(grants.check(t2), null);
});
test('dot segments and other escapes are 404 as raw paths, and the secret never appears', async () => {
  const { t, raw } = await boot();
  for (const rel of ['../secret.txt', '../../secret.txt', '%2e%2e/%2e%2e/secret.txt', '%2E%2E%2F%2E%2E%2Fsecret.txt', '..%2f..%2fsecret.txt', '.%2e/.%2e/secret.txt',
    '..%5c..%5csecret.txt', 'assets/../../../secret.txt', '../dist/a.html', '../../d_b/work/only-b.txt', '.crew.json', '.asks/a.json', '.kit/CONTRACT.md', 'a%00b', '%zz']) {
    const r = await raw(`/design-preview/${t}/build/${rel}`);
    assert.equal(r.status, 404, rel); assert.ok(!r.text.includes('SECRET'), rel);
  }
});
test('symlink escape is refused via openArtifactUnder', POSIX, async () => {
  const { t, raw, work, root } = await boot();
  symlinkSync(join(root, 'secret.txt'), join(work, 'leak.txt'));
  mkdirSync(join(root, 'elsewhere')); writeFileSync(join(root, 'elsewhere', 'x.txt'), 'SECRET');
  symlinkSync(join(root, 'elsewhere'), join(work, 'linked'));
  assert.equal((await raw(`/design-preview/${t}/build/leak.txt`)).status, 404);
  assert.equal((await raw(`/design-preview/${t}/build/linked/x.txt`)).status, 404);
});
test('a token opens only its own design', async () => {
  const { t, raw } = await boot();
  assert.equal((await raw(`/design-preview/${t}/run/only-b.txt`)).status, 404);
});
test('Review Focus: asset names', async () => {
  const { t, raw } = await boot();
  assert.equal((await raw(`/design-preview/${t}/run/assets/Hero%20Image%20(1).png`)).status, 200);
  assert.equal((await raw(`/design-preview/${t}/run/assets/caf%C3%A9.png`)).status, 200);
  assert.equal((await raw(`/design-preview/${t}/run/assets/HERO.PNG`)).status, 404);
  assert.equal((await raw(`/design-preview/${t}/run/assets/nope.png`)).status, 404);
  assert.equal((await raw(`/design-preview/${t}/run/assets/thing.xyz`)).status, 404, 'no known type');
});
test('wrong method 405 with a good token, 404 with a bad one', async () => {
  const { t, raw } = await boot();
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    const r = await raw(`/design-preview/${t}/build/`, { method });
    assert.equal(r.status, 405); assert.equal(r.headers.allow, 'GET, HEAD');
    assert.equal((await raw(`/design-preview/${'a'.repeat(43)}/build/`, { method })).status, 404);
  }
  const h = await raw(`/design-preview/${t}/build/`, { method: 'HEAD' });
  assert.equal(h.status, 200); assert.equal(h.text, '');
});
test('Review Focus: Host forms', async () => {
  const { t, raw, calls } = await boot();
  assert.equal((await raw(`/design-preview/${t}/build/`, { headers: { host: 'evil.example' } })).status, 403);
  assert.equal((await raw(`/design-preview/${t}/build/`, { headers: { host: 'localhost/;script-src *' } })).status, 403);
  const v6 = await raw(`/design-preview/${t}/build/`, { headers: { host: '[::1]:4317' } });
  assert.equal(v6.status, 200);
  assert.ok(!v6.headers['content-security-policy'].includes('design-preview'));
  assert.equal(calls.at(-1).inline, true, 'no {B}: everything must be embedded');
});
test('a foreign Origin does not matter: the token is the credential', async () => {
  const { t, raw } = await boot();
  assert.equal((await raw(`/design-preview/${t}/build/`, { headers: { origin: 'https://evil.example' } })).status, 200);
});
test('.js follows sendArtifactRaw (server.mjs:5585-5595) exactly', async () => {
  const { t, raw } = await boot();
  const url = `/design-preview/${t}/run/x.js`;
  for (const dest of ['script', 'worker', 'sharedworker', 'serviceworker']) {
    const r = await raw(url, { headers: { 'sec-fetch-site': 'same-origin', 'sec-fetch-dest': dest } });
    assert.equal(r.status, 403); assert.deepEqual(JSON.parse(r.text), { error: 'artifact scripts do not run in the worca page' });
  }
  const type = async (headers) => (await raw(url, { headers })).headers['content-type'];
  assert.equal(await type({ 'sec-fetch-site': 'same-origin', 'sec-fetch-dest': 'empty' }), 'text/plain; charset=utf-8');
  assert.equal(await type({ 'sec-fetch-site': 'same-site', 'sec-fetch-dest': 'script' }), 'text/plain; charset=utf-8');
  assert.equal(await type({}), 'text/plain; charset=utf-8');
  assert.equal(await type({ 'sec-fetch-site': 'cross-site', 'sec-fetch-dest': 'script' }), 'text/javascript; charset=utf-8');
  assert.equal((await raw(`/design-preview/${t}/run/m.mjs`, { headers: { 'sec-fetch-site': 'same-origin', 'sec-fetch-dest': 'script' } })).status, 403);
});
test('files carry the same headers, with Range', async () => {
  const { t, raw } = await boot();
  const r = await raw(`/design-preview/${t}/run/assets/p.woff2`, { headers: { origin: 'null' } });
  assert.equal(r.status, 200); assert.equal(r.headers['content-type'], 'font/woff2');
  assert.equal(r.headers['access-control-allow-origin'], '*');
  assert.ok(r.headers['content-security-policy'].startsWith('sandbox allow-scripts;'));
  const part = await raw(`/design-preview/${t}/run/assets/p.woff2`, { headers: { range: 'bytes=0-3' } });
  assert.equal(part.status, 206); assert.equal(part.headers['content-length'], '4');
  assert.equal((await raw(`/design-preview/${t}/run/assets/p.woff2`, { headers: { range: 'bytes=99999999-' } })).status, 416);
  const empty = await raw(`/design-preview/${t}/run/assets/empty.png`);
  assert.equal(empty.status, 200); assert.equal(empty.headers['content-length'], '0');
  assert.equal((await raw(`/design-preview/${t}/run/assets/empty.png`, { headers: { range: 'bytes=0-3' } })).status, 416);
});
test('inline=1 passes through; nothing else does', async () => {
  const { t, raw, calls } = await boot();
  await raw(`/design-preview/${t}/build/?inline=1`); assert.equal(calls.at(-1).inline, true);
  await raw(`/design-preview/${t}/build/?inline=true`); assert.equal(calls.at(-1).inline, false);
  await raw(`/design-preview/${t}/build/`); assert.equal(calls.at(-1).inline, false);
});
test('a failing doc is a bare 500 that names nothing, and the flag off is 404', async () => {
  const a = await boot({ renderDoc: () => { throw new Error('/secret/path'); } });
  const r = await a.raw(`/design-preview/${a.t}/build/`);
  assert.equal(r.status, 500); assert.ok(!r.text.includes('/secret/path'));
  const b = await boot({ enabled: () => false });
  assert.equal((await b.raw(`/design-preview/${b.t}/build/`)).status, 404);
});
test('each refused character on its own, a folder with a file type, and a bad Range on an empty file', async () => {
  const T = 'a'.repeat(43);
  for (const rel of ['a%5Cb', 'a%3Ab', 'a%7Fb']) assert.equal(parsePreviewPath(`/${T}/build/${rel}`), null, rel);
  assert.equal(parsePreviewPath(`x/${T}/build/`), null, 'no leading slash');
  const { t, raw, work } = await boot();
  mkdirSync(join(work, 'folder.png'));
  assert.equal((await raw(`/design-preview/${t}/run/folder.png`)).status, 404);
  assert.equal((await raw(`/design-preview/${t}/run/assets/empty.png`, { headers: { range: 'bytes' } })).status, 416);
  assert.equal((await raw(`/design-preview/${t}/run/assets/p.woff2`, { headers: { range: 'bytes' } })).status, 200, 'a malformed Range gets the whole file');
});
