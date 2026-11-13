// test/stillhet-flag-off.test.mjs — with `rail` off (stored or locked) GET / is dev's page, byte for byte; with it on the
// server sends the Stillhet shell. The golden was taken from the merged base (dev 544cdc6a7, Tasks slice) with its own code:
// `git archive` of that commit, a fresh HOME (welcomeSeen only), WORCA_FLAGS unset, git usable, mock mode; the body
// hashed as served. Re-merging dev recaptures it from dev's own files, before this slice's changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { cp, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from './helpers/stillhet-server.mjs';

const GOLDEN = readFileSync(new URL('./fixtures/index-html-flag-off.sha256', import.meta.url), 'utf8').trim();
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const get = async (base) => { const r = await fetch(base + '/'); return { r, buf: Buffer.from(await r.arrayBuffer()) }; };
const HEADERS = ['content-security-policy', 'x-frame-options', 'cache-control', 'x-content-type-options'];

test('rail off (default) and WORCA_FLAGS=-rail serve today\'s page: same bytes as the golden, no stillhet reference', async () => {
  for (const flags of [undefined, '-rail']) {
    const s = await startServer({ flags });
    try {
      const { buf } = await get(s.base);
      assert.equal(sha(buf), GOLDEN, `flags=${flags}`);
      assert.doesNotMatch(buf.toString(), /stillhet/i);
      for (const raw of ['/stillhet/shell.html', '/stillhet/shell']) assert.doesNotMatch(await (await fetch(s.base + raw)).text(), /data-host="app"/, raw);
    } finally { await s.stop(); }
  }
});

test('rail locked on serves the Stillhet shell with the same security headers', async () => {
  const off = await startServer();
  const on = await startServer({ flags: 'rail' });
  try {
    const a = await get(off.base), b = await get(on.base);
    const html = b.buf.toString();
    assert.match(html, /<script src="\/stillhet\/boot\.js" data-host="app"><\/script>/);
    assert.doesNotMatch(html, /\/app\.js/);
    assert.match(html, /<html lang="en" data-theme="system" data-level="(simple|advanced|expert)" data-git="(on|off)" data-adapter="live" data-rail-locked="true">/);   // live data (D2); WORCA_FLAGS=rail locks the switch
    for (const h of HEADERS) assert.equal(b.r.headers.get(h), a.r.headers.get(h), h);
    assert.equal((await fetch(on.base + '/stillhet/boot.js')).status, 200);
    assert.equal((await fetch(on.base + '/stillhet/css/rail.css')).status, 200);
  } finally { await off.stop(); await on.stop(); }
});

// The shell file under ui/public must never reach the browser raw (no framing or script headers, the theme anchor unfilled),
// in either flag state and under any spelling express.static would map to it.
const SHELL_SPELLINGS = ['/stillhet/shell.html', '/stillhet/shell', '/stillhet//shell.html', '/stillhet/%73hell.html', '/stillhet/./shell'];
test('the raw Stillhet shell file is never served: every spelling gets the rendered page and its headers, rail on or off', async () => {
  for (const flags of ['rail', '-rail']) {
    const s = await startServer({ flags });
    try {
      for (const raw of SHELL_SPELLINGS) {
        const r = await fetch(s.base + raw), body = await r.text();
        assert.ok(!body.includes('<html lang="en" data-theme="system">'), `${flags} ${raw}: the unfilled theme anchor`);
        if (r.status === 200 && /text\/html/.test(r.headers.get('content-type') || '')) {
          assert.equal(r.headers.get('x-frame-options'), 'DENY', `${flags} ${raw}`);
          assert.ok(r.headers.get('content-security-policy'), `${flags} ${raw}`);
        }
        if (flags === 'rail') assert.match(body, /data-host="app"/, raw);
        else assert.doesNotMatch(body, /data-host="app"/, raw);
      }
    } finally { await s.stop(); }
  }
});

// The two bundle tests remove the generated files, so they run against a copy of the served tree: the checkout's own
// ui/public/stillhet/ (shared with every other test and the gates) is never touched.
const ROOT = new URL('..', import.meta.url).pathname;
const COPIED = ['ui', 'src', 'tools', 'package.json', 'docs/design-system-catalog.json', 'plans/rail/prototype/gates'];
async function treeCopy(t) {
  const root = await mkdtemp(join(tmpdir(), 'stillhet-tree-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const p of COPIED) await cp(join(ROOT, p), join(root, p), { recursive: true });
  await symlink(join(ROOT, 'node_modules'), join(root, 'node_modules'));
  return { root, dir: join(root, 'ui/public/stillhet/') };
}
const NAMES = ['components.js', 'graph.js', 'app.css'];

test('rail off starts with the generated bundles absent and serves today\'s page', async (t) => {
  const { root, dir } = await treeCopy(t);
  for (const f of NAMES) rmSync(dir + f, { force: true });
  const s = await startServer({ flags: '-rail', root });
  try {
    assert.equal(sha((await get(s.base)).buf), GOLDEN);
    assert.equal(NAMES.some((f) => existsSync(dir + f)), false, 'flag off never builds');
  } finally { await s.stop(); }
});

test('rail on with the generated bundles absent: the first shell request builds them in a source checkout', async (t) => {
  const { root, dir } = await treeCopy(t);
  for (const f of NAMES) rmSync(dir + f, { force: true });
  const s = await startServer({ flags: 'rail', root });
  try {
    const { r } = await get(s.base);
    assert.equal(r.status, 200);
    assert.deepEqual(NAMES.filter((f) => !existsSync(dir + f)), []);
  } finally { await s.stop(); }
});
