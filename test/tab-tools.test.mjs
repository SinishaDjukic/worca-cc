// test/tab-tools.test.mjs — what the chat's tab tools do and refuse (issue 1064 slice 3).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkRows } from './helpers/rows.mjs';

let home, mirror, tools, captured, lib, _resetForTests;
let revoked = 0;
const DEDUPE = 'ask_0000eeee'; const CAP = 'ask_0000ffff';
const CHAT = 'ask_0000aaaa'; const OTHER = 'ask_0000bbbb'; const BARE = 'ask_0000cccc';
const THREADS = { [CHAT]: { owner: '', projectKey: 'app-1' }, [OTHER]: { owner: '', projectKey: 'app-2' }, [BARE]: { owner: '', projectKey: null },
  [DEDUPE]: { owner: '', projectKey: 'app-3' }, [CAP]: { owner: '', projectKey: 'app-4' } };
const PNG = Buffer.from('\x89PNG fake');
let shotOut = { note: null, painted: true, png: PNG, width: 1280, height: 800, title: 'T', text: 'page text', console: ['TypeError: x'] };
let web = { enabled: true, allowedDomains: ['docs.example.com'] };
/** A fake resolver: no test reaches the real DNS. rebind.example.com has one private answer among public ones. */
const RESOLVE = async (h) => {
  if (h === 'rebind.example.com') return [{ address: '93.184.216.34' }, { address: '127.0.0.1' }];
  if (h === 'nxdomain.example.com') throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
  return [{ address: '93.184.216.34' }];
};

const refusals = [];
before(async () => {
  home = mkdtempSync(join(tmpdir(), 'worca-tabtools-'));
  Object.assign(process.env, { WORCA_HOME: home, HOME: home, USERPROFILE: home });
  ({ _resetForTests } = await import('../src/core/db.mjs'));
  _resetForTests();
  const { createToolTabsMirror } = await import('../src/core/tool-tabs-mirror.mjs');
  lib = await import('../src/core/tab-tools.mjs');
  mirror = createToolTabsMirror();
  tools = lib.createTabTools({
    mirror,
    thread: (id) => THREADS[id] || null,
    web: () => web,
    // 4400: in the Actions range; 3000: only "All local ports" lets it in, so only for an address the person chose.
    previewRefusal: async (port, { model = false } = {}) => { refusals.push({ port, model });
      return port === 4400 || (port === 3000 && !model) ? null : `Port ${port} is outside the ports Worca previews`; },
    previewBase: async (port) => ({ origin: 'http://127.0.0.1:4317', prefix: `/preview/${port}/tok/`, done: () => { revoked += 1; } }),
    capture: async (o) => { captured = o; return shotOut; },
    saveImage: (_t, { name, png }) => ({ id: 'att_00000001', name, bytes: png.length }),
    fileTarget,
    notify: (id, extra = {}) => notes.push({ id, ...extra }),
    resolve: RESOLVE,
    now: () => Date.UTC(2026, 10, 4, 10, 0, 0),
  });
  mirror.replace('', `chat:${CHAT}`, [{ id: 'tab_mine', kind: 'browser', url: 'http://localhost:4400/app' }, { id: 'tab_term', kind: 'terminal' },
    { id: 'tab_blank', kind: 'browser' }, { id: 'tab_ext', kind: 'browser', url: 'https://evil.example/x' }]);
  mirror.replace('', 'project:app-1', [{ id: 'tab_proj', kind: 'browser', url: 'http://localhost:4400/p' }]);
  mirror.replace('', `chat:${OTHER}`, [{ id: 'tab_theirs', kind: 'browser', url: 'http://localhost:4400/t' }]);
  mirror.replace('', 'project:app-2', [{ id: 'tab_otherproj', kind: 'browser', url: 'http://localhost:4400/o' }]);
});
after(() => { _resetForTests(); rmSync(home, { recursive: true, force: true }); });

const refuses = async (p, code) => { await assert.rejects(p, (e) => e instanceof lib.TabToolError && e.code === code); };

test('scope: a chat reaches its own tabs and its project\'s, and nothing else', async () => {
  await checkRows([
    { name: 'its own browser tab: captured through the proxy prefix; the capture\'s preview token is revoked when it ends', run: async () => {
      const r0 = revoked;
      const r = await tools.screenshot(CHAT, { tabId: 'tab_mine' });
      assert.equal(captured.url, 'http://127.0.0.1:4317/preview/4400/tok/app');
      assert.deepEqual(r.items.map((i) => [i.attId, i.kind, i.width]), [['att_00000001', 'image', 1280]]);
      assert.equal(revoked, r0 + 1);
    } },
    { name: 'its project\'s tab', run: async () => { assert.equal((await tools.read(CHAT, { tabId: 'tab_proj' })).text, 'page text'); } },
    { name: 'another chat\'s tab is out of scope', run: () => refuses(tools.screenshot(CHAT, { tabId: 'tab_theirs' }), 'OUT_OF_SCOPE') },
    { name: 'another project\'s tab is out of scope', run: () => refuses(tools.read(CHAT, { tabId: 'tab_otherproj' }), 'OUT_OF_SCOPE') },
    { name: 'a chat with no project reaches no project tab', run: () => refuses(tools.read(BARE, { tabId: 'tab_proj' }), 'OUT_OF_SCOPE') },
    { name: 'a gone chat', run: () => refuses(tools.read('ask_0000dddd', { tabId: 'tab_mine' }), 'NOT_FOUND') },
    { name: 'a terminal tab is not a Browser tab', run: () => refuses(tools.read(CHAT, { tabId: 'tab_term' }), 'NOT_BROWSER') },
    { name: 'a Browser tab with no address', run: () => refuses(tools.screenshot(CHAT, { tabId: 'tab_blank' }), 'NO_URL') },
    { name: 'a malformed id', run: () => refuses(tools.read(CHAT, { tabId: '../x' }), 'BAD_INPUT') },
    { name: 'the context line lists exactly the reachable tabs, project first', run: () => {
      assert.deepEqual(tools.headerTabs(CHAT).map((t) => [t.id, t.scope]),
        [['tab_proj', 'project'], ['tab_mine', 'chat'], ['tab_term', 'chat'], ['tab_blank', 'chat'], ['tab_ext', 'chat']]);
    } },
  ]);
});

test('addresses: the proxy\'s port rules, and web_fetch\'s allowlist for any other host', async () => {
  await checkRows([
    { name: 'a host off the allowlist is refused with the propose_web_access pointer', run: async () => {
      await assert.rejects(tools.screenshot(CHAT, { tabId: 'tab_ext' }), (e) => e.code === 'NOT_ALLOWLISTED' && /propose_web_access/.test(e.message));
    } },
    { name: 'web off refuses any non-local address', run: async () => {
      web = { enabled: false, allowedDomains: [] };
      try { await refuses(tools.open(CHAT, { kind: 'browser', url: 'https://docs.example.com/' }), 'WEB_OFF'); } finally { web = { enabled: true, allowedDomains: ['docs.example.com'] }; }
    } },
    { name: 'a port outside the preview rules', run: () => refuses(tools.open(CHAT, { kind: 'browser', url: 'http://localhost:3000/' }), 'PREVIEW_REFUSED') },
    { name: 'an allowlisted https page opens; it is captured at its own address', run: async () => {
      const o = await tools.open(CHAT, { kind: 'browser', url: 'docs.example.com/guide' });
      assert.equal(o.url, 'https://docs.example.com/guide');
      await tools.screenshot(CHAT, { tabId: o.tabId });
      assert.equal(captured.url, 'https://docs.example.com/guide');
    } },
    { name: 'a proxy note page and a blank page are errors, never an image; the token is revoked either way', run: async () => {
      const r0 = revoked;
      shotOut = { note: 'NOT_LISTENING' };
      await refuses(tools.screenshot(CHAT, { tabId: 'tab_mine' }), 'PREVIEW_NOTE');
      shotOut = { note: null, painted: false, png: PNG, width: 1, height: 1 };
      await refuses(tools.screenshot(CHAT, { tabId: 'tab_mine' }), 'BLANK');
      assert.equal(revoked, r0 + 2);
      shotOut = { note: null, painted: true, png: PNG, width: 1280, height: 800, title: 'T', text: 'page text', console: [] };
    } },
  ]);
});

test('open_tab: kinds, the project rule, and the assistant mark', async () => {
  await checkRows([
    { name: 'a chat with no project opens nothing', run: () => refuses(tools.open(BARE, { kind: 'files' }), 'NO_PROJECT') },
    { name: 'an unknown kind', run: () => refuses(tools.open(CHAT, { kind: 'shell' }), 'BAD_INPUT') },
    { name: 'changes (turned off)', run: () => refuses(tools.open(CHAT, { kind: 'changes' }), 'BAD_INPUT') },
    { name: 'a url on a non-browser kind', run: () => refuses(tools.open(CHAT, { kind: 'files', url: 'http://localhost:4400/' }), 'BAD_INPUT') },
    { name: 'a files tab: undelivered, marked as the assistant\'s, in the chat scope', run: async () => {
      const o = await tools.open(CHAT, { kind: 'files' });
      const got = mirror.list('', `chat:${CHAT}`).find((t) => t.id === o.tabId);
      assert.deepEqual([got.openedBy, got.delivered], ['assistant', false]);
    } },
  ]);
});

test('the request rules: a local preview stays under its prefix; any other host must be public; another site\'s navigations re-check the allowlist', async () => {
  const local = lib.localAllow('http://127.0.0.1:4317', '/preview/4400/tok/', RESOLVE);
  await checkRows([
    ['http://127.0.0.1:4317/preview/4400/tok/a.js', false, true, 'the preview itself'],
    ['ws://127.0.0.1:4317/preview/4400/tok/hmr', false, true, 'the preview\'s own HMR socket'],
    ['http://127.0.0.1:4317/api/settings', false, false, 'Worca\'s API'],
    ['http://127.0.0.1:4317/preview/4401/tok/', true, false, 'another preview'],
    ['http://127.0.0.1:5432/', false, false, 'another loopback server'],
    ['http://192.168.1.4/x', false, false, 'a private address'],
    ['http://wiki/', false, false, 'a dotless intranet name'],
    ['http://printer.local/', false, false, 'a .local name'],
    ['http://rebind.example.com/x.js', false, false, 'a public name with a loopback answer'],
    ['http://nxdomain.example.com/x.js', false, false, 'a name that does not resolve'],
    ['https://fonts.example.org/a.woff2', false, true, 'a public asset'],
    ['https://fonts.example.org/', true, false, 'the top frame never leaves the prefix'],
  ].map(([url, top, want, name]) => ({ name, run: async () => { assert.equal(await local(url, top), want); } })));
  const ext = lib.externalAllow(['docs.example.com'], RESOLVE);
  assert.equal(await ext('https://docs.example.com/b', true), true);
  assert.equal(await ext('https://evil.example/', true), false, 'a redirect off the allowlist');
  assert.equal(await ext('https://cdn.example.net/x.css', false), true);
  assert.equal(await ext('http://localhost:4317/api/x', false), false);
  assert.equal(await lib.externalAllow(['rebind.example.com'], RESOLVE)('https://rebind.example.com/', true), false, 'an allowlisted name with a private answer');
});

test('pick: local previews only, a selector Worca made, the element clipped at 2x', async () => {
  await refuses(tools.pick({ url: 'https://docs.example.com/', selector: 'h1', viewport: { width: 800, height: 600 } }), 'NOT_LOCAL');
  await refuses(tools.pick({ url: 'http://localhost:4400/', selector: 'a\nb' }), 'BAD_INPUT');
  shotOut = { note: null, painted: true, png: PNG, width: 40, height: 20 };
  const r0 = revoked;
  const r = await tools.pick({ url: 'http://localhost:4400/app', selector: 'main > h1', viewport: { width: 640, height: 480 } });
  assert.deepEqual([captured.selector, captured.scale, captured.viewport], ['main > h1', 2, { width: 640, height: 480 }]);
  assert.equal(Buffer.from(r.png, 'base64').toString(), PNG.toString());
  assert.equal(revoked, r0 + 1, 'the pick\'s token is revoked too');
  shotOut = { note: null, painted: true, missing: true };
  await refuses(tools.pick({ url: 'http://localhost:4400/app', selector: '#gone' }), 'NOT_FOUND');
});

const FILE_ROWS = { 'src/a.js': { type: 'file', lines: 40 }, src: { type: 'dir' } };
const notes = [];
const fileTarget = async (threadId, { path, line, endLine }) => {
  const f = FILE_ROWS[path];
  if (!f) throw new lib.TabToolError(`open_tab: ${path} is not in this chat's project`, 'NOT_FOUND');   // lib: the module before() imports
  if (line != null && (f.type === 'dir' || line > f.lines)) throw new lib.TabToolError('open_tab: bad line', 'BAD_LINE');
  return { path, type: f.type, ...(line ? { line } : {}), ...(endLine ? { endLine } : {}), root: null };
};

test('open_tab files: path and line reach the mirror; refusals and bad input are errors that add nothing', async () => {
  const r = await tools.open('ask_0000aaaa', { kind: 'files', path: 'src/a.js', line: 12 }, { turn: 'T1' });
  assert.equal(r.ok, true); assert.equal(r.path, 'src/a.js'); assert.equal(r.line, 12);
  assert.deepEqual(mirror.list('', 'chat:ask_0000aaaa').find((x) => x.id === r.tabId).target, { path: 'src/a.js', line: 12 });
  await refuses(tools.open('ask_0000aaaa', { kind: 'files', path: 'nope.js' }, { turn: 'T1' }), 'NOT_FOUND');
  await refuses(tools.open('ask_0000aaaa', { kind: 'files', path: 'src/a.js', line: 99 }, { turn: 'T1' }), 'BAD_LINE');
  await refuses(tools.open('ask_0000aaaa', { kind: 'browser', path: 'src/a.js' }, { turn: 'T1' }), 'BAD_INPUT');
  await refuses(tools.open('ask_0000aaaa', { kind: 'files', line: 3 }, { turn: 'T1' }), 'BAD_INPUT');
});

test('open_tab: an open file or address is brought forward, not opened twice; it counts; user tabs stay the user\'s', async () => {
  mirror.replace('', 'chat:ask_0000bbbb', [{ id: 'tab_user1', kind: 'files', target: { path: 'src/a.js' }, at: 1 }]);
  notes.length = 0;
  const r = await tools.open('ask_0000bbbb', { kind: 'files', path: 'src/a.js', line: 30 }, { turn: 'T2' });
  assert.deepEqual([r.tabId, r.focused], ['tab_user1', true]);
  assert.deepEqual(notes, [{ id: 'ask_0000bbbb', focus: 'tab_user1', target: { path: 'src/a.js', line: 30 } }]);
  const row = mirror.list('', 'chat:ask_0000bbbb');
  assert.deepEqual(row.map((x) => [x.id, x.openedBy, x.target]), [['tab_user1', 'user', { path: 'src/a.js', line: 30 }]]);
});

test('open_tab: a project-scope Files tab of the same path is NOT the chat\'s file (a new chat tab opens)', async () => {
  // THREADS gains `[DEDUPE]: { owner: '', projectKey: 'app-3' }` with `const DEDUPE = 'ask_0000eeee';` (NOT ask_0000dddd:
  // the file's read row uses that as the gone chat; a fresh project keeps the other project-scope fixtures untouched).
  // The web policy fake allows docs.example.com (line ~84).
  mirror.replace('', 'project:app-3', [{ id: 'tab_proj1', kind: 'files', target: { path: 'src/a.js' }, at: 1 }]);
  const r = await tools.open(DEDUPE, { kind: 'files', path: 'src/a.js' }, { turn: 'T5' });
  assert.notEqual(r.tabId, 'tab_proj1');
  assert.equal(r.focused, undefined);
  assert.equal(mirror.list('', `chat:${DEDUPE}`).length, 1);
  mirror.replace('', 'project:app-3', [{ id: 'tab_proj2', kind: 'browser', url: 'https://docs.example.com/', at: 2 }]);
  // an address in the project scope IS the same page: brought forward
  const b = await tools.open(DEDUPE, { kind: 'browser', url: 'https://docs.example.com/' }, { turn: 'T5' });
  assert.deepEqual([b.tabId, b.focused], ['tab_proj2', true]);
});

test('open_tab: at most 3 per turn (refusals free); a new turn starts again; endTurn forgets', async () => {
  // its own chat (THREADS gains `[CAP]: { owner: '', projectKey: 'app-4' }`, `const CAP = 'ask_0000ffff';`): the five
  // opens below must not meet the 8-pending limit together with the other rows' tabs of ask_0000aaaa
  const T = 'T3';
  const base = tools.openCounts();   // the earlier rows' turns (T1, T2, T5) were never ended
  await refuses(tools.open(CAP, { kind: 'files', path: 'nope.js' }, { turn: T }), 'NOT_FOUND');
  for (const k of ['files', 'files', 'terminal']) await tools.open(CAP, { kind: k }, { turn: T });
  await refuses(tools.open(CAP, { kind: 'files' }, { turn: T }), 'TOO_MANY');
  assert.equal((await tools.open(CAP, { kind: 'files' }, { turn: 'T4' })).ok, true);
  tools.endTurn(T);
  assert.equal((await tools.open(CAP, { kind: 'files' }, { turn: T })).ok, true);
  assert.equal(tools.openCounts(), base + 2);   // T3 again and T4
});

test('headerTabs: a mirrored files tab with a target lists its path and line', () => {
  mirror.replace('', `chat:${DEDUPE}`, [{ id: 'tab_hdr1', kind: 'files', target: { path: 'src/a.js', line: 12 }, at: 9 }]);
  const h = tools.headerTabs(DEDUPE).find((x) => x.id === 'tab_hdr1');
  assert.equal(h.path, 'src/a.js'); assert.equal(h.line, 12);
});

test('extra: a chat tab of the same path under ANOTHER root is not the same file', async () => {
  const G = 'ask_0000abab'; THREADS[G] = { owner: '', projectKey: 'app-5' };
  mirror.replace('', `chat:${G}`, [{ id: 'tab_runroot', kind: 'files', target: { path: 'src/a.js', root: 'run:abcd1234' }, at: 1 }]);
  const r = await tools.open(G, { kind: 'files', path: 'src/a.js' }, { turn: 'T7' });
  assert.notEqual(r.tabId, 'tab_runroot');
});

test('extra: a refusal at the cap is TOO_MANY; a mirror refusal gives its slot back', async () => {
  const P = 'ask_0000acac'; THREADS[P] = { owner: '', projectKey: 'app-6' };
  for (let i = 0; i < 8; i += 1) mirror.add('', `chat:${P}`, { kind: 'files' });
  await refuses(tools.open(P, { kind: 'files' }, { turn: 'T8' }), 'PENDING');
  mirror.replace('', `chat:${P}`, [], { seen: mirror.list('', `chat:${P}`).map((x) => x.id) });
  for (const k of ['files', 'files', 'terminal']) assert.equal((await tools.open(P, { kind: k }, { turn: 'T8' })).ok, true, k);
  await refuses(tools.open(P, { kind: 'files', path: 'nope.js' }, { turn: 'T8' }), 'TOO_MANY');
});

test('model-chosen addresses keep to the Actions range: open_tab and captures of its own tabs; a tab the person opened stays readable', async () => {
  mirror.replace('', `chat:${CHAT}`, [...mirror.list('', `chat:${CHAT}`).filter((t) => t.id !== 'tab_dev'), { id: 'tab_dev', kind: 'browser', url: 'http://localhost:3000/' }]);
  refusals.length = 0;
  assert.equal((await tools.read(CHAT, { tabId: 'tab_dev' })).tabId, 'tab_dev', 'the person opened it: their Preview ports choice holds');
  assert.deepEqual(refusals.at(-1), { port: 3000, model: false });
  await refuses(tools.open(CHAT, { kind: 'browser', url: 'http://localhost:3000/' }), 'PREVIEW_REFUSED');
  assert.deepEqual(refusals.at(-1), { port: 3000, model: true });
  const id = (await tools.open(CHAT, { kind: 'browser', url: 'http://localhost:4400/mine' })).tabId;
  const rows = mirror.list('', `chat:${CHAT}`).map((t) => (t.id === id ? { ...t, url: 'http://localhost:3000/x' } : t));
  mirror.replace('', `chat:${CHAT}`, rows);   // the person moved the assistant's tab to another port: it stays the assistant's
  await refuses(tools.screenshot(CHAT, { tabId: id }), 'PREVIEW_REFUSED');
  assert.deepEqual(refusals.at(-1), { port: 3000, model: true });
  assert.match(lib.modelPortRefusal(3000, { low: 4400, high: 4499 }), /Port 3000 .*4400–4499.*Ask the user to open it/);
});
