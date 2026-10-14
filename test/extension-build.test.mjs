// test/extension-build.test.mjs — production builds succeed and carry no E2E hooks; the test build keeps them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildOne, defaultBaseUrlFromEnv, parseArgs, releaseBuildRefusal } from '../tools/build-extension.mjs';

test('production builds (chrome, edge, firefox) contain no test hooks', async () => {
  const dist = mkdtempSync(join(tmpdir(), 'wx-build-'));
  try {
    for (const b of ['chrome', 'edge', 'firefox']) {
      const { out } = await buildOne(b, { dist });   // buildOne itself throws on a leaked hook
      for (const f of ['background.js', 'content.js', 'sidebar.js']) {
        const js = readFileSync(join(out, f), 'utf8');
        assert.doesNotMatch(js, /__worcaTest|__worcaSidebarTest|__WORCA_EXT_TEST__|__WORCA_EXT_DEMO__/, `${b}/${f}`);
        assert.doesNotMatch(js, /vad-web|onnxruntime|ricky0123/, `${b}/${f}: no voice runtime in the extension`);
      }
    }
  } finally { rmSync(dist, { recursive: true, force: true }); }
});

test('the --test build keeps the hooks (so the check above is not vacuous)', async () => {
  const dist = mkdtempSync(join(tmpdir(), 'wx-build-'));
  try {
    const { out } = await buildOne('chrome', { test: true, dist });
    assert.match(readFileSync(join(out, 'background.js'), 'utf8'), /__worcaTest/);
    assert.match(readFileSync(join(out, 'sidebar.js'), 'utf8'), /__worcaSidebarTest/);
  } finally { rmSync(dist, { recursive: true, force: true }); }
});

// Chrome refuses a content script holding a Unicode noncharacter (U+FFFF, U+FDD0–U+FDEF, …) with "It isn't UTF-8
// encoded", so injection fails silently and Pinpoint and the capture never mount. esbuild copies a raw one from a
// regex source as is: a source must spell it as an escape (\uffff), never the character itself.
const NONCHAR = /[\uFDD0-\uFDEF\uFFFE\uFFFF]/;
test('every bundle loads in Chrome: no Unicode noncharacters (the content script would not inject)', async () => {
  const dist = mkdtempSync(join(tmpdir(), 'wx-build-'));
  try {
    for (const [b, opts] of [['chrome', {}], ['firefox', {}], ['chrome', { test: true }]]) {
      const { out } = await buildOne(b, { ...opts, dist });
      for (const f of ['background.js', 'content.js', 'sidebar.js']) {
        assert.doesNotMatch(readFileSync(join(out, f), 'utf8'), NONCHAR, `${b}${opts.test ? ' (test)' : ''}/${f}`);
      }
    }
  } finally { rmSync(dist, { recursive: true, force: true }); }
});

// Build-time default Worca address (docs/browser-extension.md "Testing against another Worca"): WORCA_EXT_PORT or
// WORCA_EXT_BASE_URL (wins), loopback http only, bundled through esbuild define; --zip refuses while either is set.
test('defaultBaseUrlFromEnv: unset → null; a port → 127.0.0.1; a URL wins and is normalised; invalid values throw', () => {
  assert.equal(defaultBaseUrlFromEnv({}), null);
  assert.equal(defaultBaseUrlFromEnv({ WORCA_EXT_PORT: '', WORCA_EXT_BASE_URL: '' }), null);
  assert.equal(defaultBaseUrlFromEnv({ WORCA_EXT_PORT: '4999' }), 'http://127.0.0.1:4999');
  assert.equal(defaultBaseUrlFromEnv({ WORCA_EXT_BASE_URL: 'http://localhost:5001/' }), 'http://localhost:5001');
  assert.equal(defaultBaseUrlFromEnv({ WORCA_EXT_PORT: '4999', WORCA_EXT_BASE_URL: 'http://localhost:5001' }), 'http://localhost:5001');
  for (const port of ['0', '65536', '49x', '-1', '4999.5', 'http://127.0.0.1:4999']) {
    assert.throws(() => defaultBaseUrlFromEnv({ WORCA_EXT_PORT: port }), /WORCA_EXT_PORT/, port);
  }
  for (const url of ['https://127.0.0.1:4999', 'http://worca.example.com:4317', 'http://192.168.1.5:4317', 'nonsense']) {
    assert.throws(() => defaultBaseUrlFromEnv({ WORCA_EXT_BASE_URL: url }), /WORCA_EXT_BASE_URL.*127\.0\.0\.1.*localhost/, url);
  }
});

test('the bundled default: http://127.0.0.1:4317 without the variables, the given address with them', async () => {
  const dist = mkdtempSync(join(tmpdir(), 'wx-build-'));
  try {
    const plain = await buildOne('chrome', { dist, env: {} });
    for (const f of ['background.js', 'sidebar.js']) {
      const js = readFileSync(join(plain.out, f), 'utf8');
      assert.match(js, /http:\/\/127\.0\.0\.1:4317/, f);
      assert.doesNotMatch(js, /__WORCA_EXT_DEFAULT_BASE_URL__/, `${f}: the define is replaced`);
    }
    const custom = await buildOne('chrome', { dist, env: { WORCA_EXT_PORT: '4999' } });
    for (const f of ['background.js', 'sidebar.js']) assert.match(readFileSync(join(custom.out, f), 'utf8'), /http:\/\/127\.0\.0\.1:4999/, f);
    await assert.rejects(buildOne('chrome', { dist, env: { WORCA_EXT_BASE_URL: 'http://worca.example.com' } }), /WORCA_EXT_BASE_URL/);
  } finally { rmSync(dist, { recursive: true, force: true }); }
});

test('the CLI: an invalid address fails the build with a clear message; --zip refuses while either variable is set', () => {
  const run = (args, env) => spawnSync(process.execPath, ['tools/build-extension.mjs', ...args], { encoding: 'utf8', env: { ...process.env, WORCA_EXT_PORT: '', WORCA_EXT_BASE_URL: '', ...env } });
  const bad = run(['--browser', 'chrome'], { WORCA_EXT_PORT: 'nope' });
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /WORCA_EXT_PORT/);
  for (const env of [{ WORCA_EXT_PORT: '4999' }, { WORCA_EXT_BASE_URL: 'http://127.0.0.1:4999' }]) {
    const z = run(['--zip', '--browser', 'chrome'], env);
    assert.equal(z.status, 2, JSON.stringify(env));
    assert.match(z.stderr, /--zip/);
    assert.doesNotMatch(z.stdout, /built/, 'refused before building');
  }
});

test('--pack is a production build of all three browsers, refused with a test address or a partial/test build', () => {
  const o = parseArgs(['--pack']);
  assert.equal(o.pack, true);
  assert.deepEqual(o.browsers, ['chrome', 'edge', 'firefox']);
  assert.equal(releaseBuildRefusal(o, {}), null);
  assert.match(releaseBuildRefusal(o, { WORCA_EXT_PORT: '4999' }), /--pack refuses .*WORCA_EXT_PORT/);
  assert.match(releaseBuildRefusal(o, { WORCA_EXT_BASE_URL: 'http://127.0.0.1:4999' }), /--pack refuses/);
  assert.match(releaseBuildRefusal(parseArgs(['--pack', '--test']), {}), /--pack .*--test/);
  assert.match(releaseBuildRefusal(parseArgs(['--pack', '--browser', 'chrome']), {}), /--pack .*--browser/);
  assert.equal(releaseBuildRefusal(parseArgs(['--pack', '--browser', 'all']), {}), null);
  // --zip keeps its own refusal text (the existing CLI test greps for --zip)
  assert.match(releaseBuildRefusal(parseArgs(['--zip']), { WORCA_EXT_PORT: '4999' }), /--zip refuses/);
  assert.equal(releaseBuildRefusal(parseArgs([]), { WORCA_EXT_PORT: '4999' }), null, 'a plain build may use a test address');
});

test('CLI: --pack refuses before building when a test address is set', () => {
  const run = (args, env) => spawnSync(process.execPath, ['tools/build-extension.mjs', ...args], { encoding: 'utf8', env: { ...process.env, WORCA_EXT_PORT: '', WORCA_EXT_BASE_URL: '', ...env } });
  for (const env of [{ WORCA_EXT_PORT: '4999' }, { WORCA_EXT_BASE_URL: 'http://127.0.0.1:4999' }]) {
    const r = run(['--pack'], env);
    assert.equal(r.status, 2, JSON.stringify(env));
    assert.match(r.stderr, /--pack/);
    assert.doesNotMatch(r.stdout, /built/, 'refused before building');
  }
  const t = run(['--pack', '--test'], {});
  assert.equal(t.status, 2);
  assert.doesNotMatch(t.stdout, /built/);
});

test('demo build: keeps the E2E hooks and the demo manifest; production carries none of it', async () => {
  const dist = mkdtempSync(join(tmpdir(), 'wx-build-'));
  try {
    const { out } = await buildOne('chrome', { demo: true, dist, env: { WORCA_EXT_PORT: '4999' } });
    assert.match(out, /chrome-demo$/);
    assert.match(readFileSync(join(out, 'background.js'), 'utf8'), /__worcaTest/);
    assert.match(readFileSync(join(out, 'sidebar.js'), 'utf8'), /http:\/\/127\.0\.0\.1:4999/);
    const man = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
    assert.deepEqual(man.web_accessible_resources?.[0]?.resources, ['sidebar.html']);
    const prod = (await buildOne('chrome', { dist, env: {} })).out;
    for (const f of ['background.js', 'content.js', 'sidebar.js']) {
      assert.doesNotMatch(readFileSync(join(prod, f), 'utf8'), /__WORCA_EXT_DEMO__|__worcaTest/, f);
    }
    assert.equal(JSON.parse(readFileSync(join(prod, 'manifest.json'), 'utf8')).web_accessible_resources, undefined);
  } finally { rmSync(dist, { recursive: true, force: true }); }
});

test('--demo is refused with --zip and --pack, and parses on its own', () => {
  assert.equal(parseArgs(['--demo', '--browser', 'chrome']).demo, true);
  assert.match(releaseBuildRefusal(parseArgs(['--zip', '--demo']), {}), /--demo/);
  assert.match(releaseBuildRefusal({ ...parseArgs(['--pack']), demo: true }, {}), /--demo/);
});
