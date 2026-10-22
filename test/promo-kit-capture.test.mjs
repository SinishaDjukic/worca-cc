// test/promo-kit-capture.test.mjs
// The promo kit's capture library: real-UI "plates" (transparent PNG of one component), the sandboxed
// app runner (temp HOME, own port, tree kill) and the leak guard. Browser cases skip without Chrome.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir, userInfo, homedir } from 'node:os';
import { join } from 'node:path';
import { open, Plate, startApp, leakGuard, freePort, spawnArgv, defaultDeny } from '../assets/promo-kit/capture/lib.mjs';
import { decodePNG, encodePNG } from '../assets/promo-kit/tools/analyze.mjs';
import { findChrome } from '../assets/promo-kit/tools/find-tools.mjs';

const CHROME = findChrome();
const noChrome = CHROME ? false : 'no Chrome-family browser on this host (set WORCA_CHROME)';

test('decodePNG keeps the alpha channel; encodePNG round-trips RGB', () => {
  const rgb = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 10, 20, 30]);
  const back = decodePNG(encodePNG(2, 2, rgb));
  assert.equal(back.width, 2); assert.equal(back.height, 2);
  assert.deepEqual([...back.rgb], [...rgb]);
  assert.equal(back.alpha, null, 'RGB PNG has no alpha');
});

test('leakGuard throws on the user name or home path, quietly passes demo text', () => {
  const name = userInfo().username;
  // the default list holds the OS user name unless it is a service account (root, node, runner…)
  const deny = defaultDeny().includes(name) ? undefined : [name, homedir()];
  assert.throws(() => leakGuard(`Signed in as ${name}`, deny), /leak guard/);
  assert.ok(!['root', 'node', 'runner', 'app'].some((u) => defaultDeny().includes(u)));
  assert.throws(() => leakGuard(`opened ${homedir()}/projects/app`), /leak guard/);
  assert.throws(() => leakGuard('owner: Pat', ['pat']), /leak guard/);
  assert.doesNotThrow(() => leakGuard('Acme dashboard · 24 runs · Sam Lee', ['pat']));
  assert.doesNotThrow(() => leakGuard('compatible pattern', ['pat']), 'whole words only');
  // the error never echoes the matched identity
  assert.throws(() => leakGuard(`hi ${name}`, [name]), (e) => !e.message.includes(name));
});

test('spawnArgv: argv arrays everywhere; a Windows .cmd shim (npm) goes through cmd.exe with quoted args', () => {
  assert.deepEqual(spawnArgv('npm', ['run', 'dev'], { platform: 'linux', env: {} }), { file: 'npm', args: ['run', 'dev'], verbatim: false });
  const env = { Path: 'C:\\Program Files\\nodejs', PATHEXT: '.COM;.EXE;.BAT;.CMD', ComSpec: 'C:\\Windows\\system32\\cmd.exe' };
  const exists = (p) => p === 'C:\\Program Files\\nodejs\\npm.CMD' || p === 'C:\\Program Files\\nodejs\\node.EXE';
  const npm = spawnArgv('npm', ['run', 'dev', '--', '--port', '4567', '--title', 'My App'], { platform: 'win32', env, exists });
  assert.equal(npm.file, 'C:\\Windows\\system32\\cmd.exe');
  assert.equal(npm.verbatim, true);
  assert.deepEqual(npm.args.slice(0, 3), ['/d', '/s', '/c']);
  assert.equal(npm.args[3], '""C:\\Program Files\\nodejs\\npm.CMD" run dev -- --port 4567 --title "My App""');
  assert.deepEqual(spawnArgv('node', ['server.js'], { platform: 'win32', env, exists }),
    { file: 'C:\\Program Files\\nodejs\\node.EXE', args: ['server.js'], verbatim: false });
});

test('startApp runs the app on its own port with a temp HOME, and stop() frees the port', async () => {
  const port = await freePort();
  const script = "const h=require('http');h.createServer((q,s)=>{s.end(JSON.stringify({home:process.env.HOME,up:process.env.USERPROFILE}))}).listen(+process.env.PORT,'127.0.0.1')";
  const app = await startApp({ cmd: process.execPath, args: ['-e', script], port, readyUrl: `http://127.0.0.1:${port}/`, timeoutMs: 20000 });
  try {
    assert.equal(app.url, `http://127.0.0.1:${port}/`);
    const body = await (await fetch(app.url)).json();
    assert.notEqual(body.home, homedir(), 'HOME is sandboxed');
    assert.equal(body.home, body.up, 'USERPROFILE matches HOME');
    assert.ok(body.home.includes('promo-app-home-'), body.home);
  } finally { await app.stop(); }
  // the port is free again
  await new Promise((res, rej) => { const s = createServer(); s.once('error', rej); s.listen(port, '127.0.0.1', () => s.close(res)); });
  assert.equal(existsSync(app.home), false, 'temp HOME removed');
});

test('startApp.stop() kills the whole tree: a grandchild server (like npm → node) lets go of the port', async () => {
  const port = await freePort();
  const server = "require('http').createServer((q,s)=>s.end('ok')).listen(+process.env.PORT,'127.0.0.1')";
  const parent = `require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(server)}], { stdio: 'inherit' })`;
  const app = await startApp({ cmd: process.execPath, args: ['-e', parent], port, timeoutMs: 20000 });
  assert.equal(await (await fetch(app.url)).text(), 'ok');
  await app.stop();
  await new Promise((res, rej) => { const s = createServer(); s.once('error', rej); s.listen(port, '127.0.0.1', () => s.close(res)); });
});

test('startApp keeps a HOME the caller provides and fails fast when the app exits early', async () => {
  await assert.rejects(startApp({ cmd: process.execPath, args: ['-e', 'console.error("boom"); process.exit(3)'], timeoutMs: 20000 }),
    /exited.*3[\s\S]*boom/);
  const home = mkdtempSync(join(tmpdir(), 'promo-own-home-'));
  const port = await freePort();
  const app = await startApp({ cmd: process.execPath, args: ['-e', "require('http').createServer((q,s)=>s.end(process.env.HOME)).listen(+process.env.PORT,'127.0.0.1')"],
    env: { HOME: home }, port, timeoutMs: 20000 });
  try { assert.equal(await (await fetch(app.url)).text(), home); } finally { await app.stop(); rmSync(home, { recursive: true, force: true }); }
});

test('Plate.begin(...).shot() writes a transparent PNG of one component and merges the manifest', { skip: noChrome }, async () => {
  const server = createServer((q, s) => {
    s.setHeader('content-type', 'text/html');
    s.end(`<!doctype html><html><body style="margin:0;background:#888">
      <header style="height:60px;background:#222;color:#fff">App chrome</header>
      <div class="card" style="position:absolute;left:200px;top:150px;width:300px;height:160px;background:#fff;border-radius:12px">
        <b class="title">Demo card</b><button class="go">Go</button></div></body></html>`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const promo = mkdtempSync(join(tmpdir(), 'promo-kit-plates-'));
  const { page, close } = await open({ url: `http://127.0.0.1:${server.address().port}/`, dsf: 2, width: 900, height: 600, promoDir: promo });
  try {
    const p = await Plate.begin(page, 'hook-card', { target: '.card', pad: 20, dsf: 2, desc: 'Demo card', anchors: { go: '.go' } });
    const file = await p.shot('default');
    assert.equal(file, 'plates/hook-card/default.png');
    const img = decodePNG(readFileSync(join(promo, file)));
    assert.equal(img.width, (300 + 40) * 2);
    assert.equal(img.height, (160 + 40) * 2);
    assert.ok(img.alpha, 'PNG has an alpha channel');
    assert.equal(img.alpha[0], 0, 'corner is transparent');
    const c = (img.height >> 1) * img.width + (img.width >> 1);
    assert.equal(img.alpha[c], 255, 'centre is opaque');
    assert.deepEqual([...img.rgb.subarray(c * 3, c * 3 + 3)], [255, 255, 255], 'centre is the white card');
    p.save();
    const m = JSON.parse(readFileSync(join(promo, 'plates', 'manifest.json'), 'utf8'));
    assert.equal(m.version, 1);
    assert.deepEqual(m.plates['hook-card'].states.default, { file: 'plates/hook-card/default.png', w: 340, h: 200 });
    assert.ok(m.plates['hook-card'].anchors.go.w > 0);
    // a second plate merges into the same manifest
    const q = await Plate.begin(page, 'hook-title', { target: '.title', pad: 8 });
    await q.shot('default'); q.save();
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(promo, 'plates', 'manifest.json'), 'utf8')).plates).sort(), ['hook-card', 'hook-title']);
    await assert.rejects(Plate.begin(page, '../escape', { target: '.card' }), /plate name/);
  } finally { await close(); server.close(); rmSync(promo, { recursive: true, force: true }); }
});
