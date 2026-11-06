// test/ui-tool-browser.test.mjs — the Browser tool (issue 1064): what the address bar means, local addresses through
// the preview proxy in a frame without allow-same-origin, other sites in their own origin, back and forward, the
// fallback for a site that refuses framing, Open externally on a local and a hosted Worca, and the empty tab's
// services and dev server offer ("Use this" saves the Action, starts it, and opens it once ready).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createBrowserKind, classifyUrl, logicalFromProxy, readRecentUrls, RECENT_KEY, pickMarkdown } from '../ui/public/tool-browser.mjs';
import { createFilesKind } from '../ui/public/tool-files.mjs';
import { createChangesKind } from '../ui/public/tool-changes.mjs';
import { chatPageKeyAction } from '../ui/public/list-keys.mjs';

const tick = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const PK = 'app-0000aaaa';
const P = { type: 'project', id: PK };
const RUN = { type: 'run', id: 'run-1', projectKey: PK };

/** `routes`: "METHOD /path" → body, or (body, url) → body; `__status` sets the HTTP status. */
function harness(routes = {}, { url = 'http://localhost:4317/', services = [], waitMs = 60000, fail = false, loadTimeoutMs = 5, onPick = null } = {}) {
  const dom = new JSDOM('<!doctype html><body><div id="host"></div></body>', { url });
  const win = dom.window;
  const calls = [];
  const fetch = async (u, opts = {}) => {
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    calls.push({ method, url: u, body });
    if (fail) throw new TypeError('Failed to fetch');
    const h = routes[`${method} ${u.split('?')[0]}`];
    const v = typeof h === 'function' ? h(body, u) : h;
    const status = v?.__status || (v === undefined ? 404 : 200);
    return { ok: status < 400, status, json: async () => v ?? {} };
  };
  const box = { services, listeners: new Set(), opened: [] };
  const tabs = new Map();
  const api = {
    tab: (id) => tabs.get(id), isMounted: (id) => tabs.has(id), scopeFor: (t) => t.scope,
    setTabState: (id, p) => { const t = tabs.get(id); for (const [k, v] of Object.entries(p)) { if (v === undefined) delete t.state[k]; else t.state[k] = v; } },
    openTab: () => null, close: (id) => tabs.delete(id), view: () => ({}),
  };
  const kind = createBrowserKind({ doc: win.document, win, fetch, storage: win.localStorage, loadTimeoutMs, waitMs,
    services: () => box.services, onServices: (fn) => { box.listeners.add(fn); return () => box.listeners.delete(fn); },
    openExternal: (u) => box.opened.push(u), onPick });
  const host = win.document.getElementById('host');
  const mount = async (state = {}, scope = P) => {
    const tab = { id: 'tab_b1', kind: 'browser', scope, state };
    tabs.set(tab.id, tab);
    kind.mount(tab, host, api);
    await tick();
    return tab;
  };
  const frame = () => host.querySelector('iframe.tool-browser-frame');
  const post = (data, source = frame().contentWindow) => win.dispatchEvent(new win.MessageEvent('message', { data, source }));
  const press = (label) => host.querySelector(`button[aria-label="${label}"]`).click();
  const setServices = async (list) => { box.services = list; for (const fn of box.listeners) fn(); await tick(); };
  return { win, host, calls, box, kind, tabs, api, mount, frame, post, press, setServices };
}
const mint = (port = 5173, token = 'tok') => ({ 'POST /api/preview/sessions': (b) => ({ __status: 201, port: b.port, token, base: `/preview/${b.port}/${token}/` }) });

test('classifyUrl: local addresses go through the proxy over http; other sites keep their own address; the rest is refused', () => {
  assert.deepEqual(classifyUrl('localhost:5173/a?b#c'), { kind: 'local', port: 5173, path: '/a?b#c', url: 'http://localhost:5173/a?b#c' });
  assert.deepEqual(classifyUrl(':4400'), { kind: 'local', port: 4400, path: '/', url: 'http://localhost:4400/' });
  assert.equal(classifyUrl('http://127.0.0.1:3000/x').url, 'http://localhost:3000/x');
  assert.equal(classifyUrl('http://[::1]:3000').kind, 'local');
  assert.equal(classifyUrl('http://app.localhost:3000').kind, 'local');
  assert.equal(classifyUrl('http://localhost').port, 80);
  assert.deepEqual(classifyUrl('example.com/docs'), { kind: 'external', url: 'https://example.com/docs' });
  assert.equal(classifyUrl('http://10.0.0.5:8080/').kind, 'external', 'a LAN address is not this server\'s loopback');
  for (const bad of ['', 'javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'ftp://x.org', 'https://localhost:5173',
    'http://user:pw@localhost:5173', 'http://']) assert.ok(classifyUrl(bad).error, bad);
  assert.equal(logicalFromProxy('http://127.0.0.1:4317/preview/5173/tok/about?x=1#y', 5173, '/preview/5173/tok/'), 'http://localhost:5173/about?x=1#y');
  assert.equal(logicalFromProxy('http://127.0.0.1:4317/api/runs', 5173, '/preview/5173/tok/'), null);
});

test('a local address opens through the proxy in a frame with no allow-same-origin, and is remembered', async () => {
  const h = harness(mint());
  const tab = await h.mount({ url: 'localhost:5173' });
  assert.deepEqual(h.calls.map((c) => [c.method, c.url, c.body]), [['POST', '/api/preview/sessions', { port: 5173 }]]);
  const f = h.frame();
  assert.equal(f.getAttribute('src'), '/preview/5173/tok/');
  assert.doesNotMatch(f.getAttribute('sandbox'), /allow-same-origin/);
  assert.match(f.getAttribute('sandbox'), /allow-scripts/);
  assert.equal(f.getAttribute('referrerpolicy'), 'no-referrer');
  assert.equal(tab.state.url, 'http://localhost:5173/');
  assert.equal(h.kind.title(tab), 'localhost:5173');
  assert.equal(h.host.querySelector('.tool-browser-url input').value, 'http://localhost:5173/');
  assert.deepEqual(readRecentUrls(h.win.localStorage), ['http://localhost:5173/']);
  assert.equal(h.host.querySelector('button[aria-label="Back"]').disabled, true);
});

test('a port outside the set shows the server\'s refusal, pointing at Settings, and no frame', async () => {
  const text = 'Port 3000 is outside the ports Worca previews: 4400–4499 and running Actions. Choose "All local ports" under Preview ports in Settings › Runs › Actions, or widen the range.';
  const h = harness({ 'POST /api/preview/sessions': { __status: 403, error: text, code: 'PORT_NOT_ALLOWED' } });
  await h.mount({ url: 'http://localhost:3000' });
  assert.equal(h.frame(), null);
  assert.equal(h.host.querySelector('.tool-browser-note .tool-note').textContent, text);
});

test('another site loads in its own origin; even once its frame loads it says it may refuse framing, with Open externally', async () => {
  const h = harness({}, { loadTimeoutMs: 80 });
  const tab = await h.mount({ url: 'example.com' });
  assert.equal(h.calls.length, 0, 'no proxy, no probe of other hosts');
  assert.equal(h.frame().getAttribute('src'), 'https://example.com/');
  assert.match(h.frame().getAttribute('sandbox'), /allow-same-origin/);
  assert.equal(h.host.querySelector('.tool-browser-slow'), null, 'precondition: the hint is not up yet');
  h.frame().dispatchEvent(new h.win.Event('load'));   // Chrome fires load for its own refused-to-connect page too
  await new Promise((r) => setTimeout(r, 160));
  const hint = h.host.querySelector('.tool-browser-slow');
  assert.match(hint.textContent, /does not allow being shown here/);
  assert.equal(hint.getAttribute('role'), 'status');
  hint.querySelector('button').click();
  assert.deepEqual(h.box.opened, ['https://example.com/']);
  h.press('Open in your browser');
  assert.deepEqual(h.box.opened, ['https://example.com/', 'https://example.com/'], 'and the bar\'s button always');
  assert.equal(h.kind.title(tab), 'example.com');
});

test('a proxied page that refuses framing shows the fallback with Open externally; a message from anywhere else is ignored', async () => {
  const h = harness(mint());
  await h.mount({ url: 'localhost:5173/admin' });
  h.post({ type: 'worca-preview:note', code: 'FRAME_REFUSED' }, h.win);
  assert.ok(h.frame(), 'not from the frame: ignored');
  h.post({ type: 'worca-preview:note', code: 'FRAME_REFUSED' });
  assert.equal(h.frame(), null);
  assert.equal(h.host.querySelector('.tool-browser-note .tool-note').textContent, 'This site cannot be shown here.');
  [...h.host.querySelectorAll('.tool-browser-note button')].find((b) => b.textContent === 'Open externally').click();
  assert.deepEqual(h.box.opened, ['http://localhost:5173/admin'], 'Worca runs here: the address itself');
});

test('on a hosted Worca, Open externally opens the proxied page (sandboxed on its own), minted afresh', async () => {
  const h = harness(mint(5173, 'tok2'), { url: 'https://worca.example.com/' });
  await h.mount({ url: 'localhost:5173/x' });
  h.press('Open in your browser');
  await tick();
  assert.deepEqual(h.box.opened, ['https://worca.example.com/preview/5173/tok2/x']);
});

test('links the page follows move the address bar; Back and Forward walk the tab\'s own history', async () => {
  const h = harness(mint());
  const tab = await h.mount({ url: 'localhost:5173' });
  h.post({ type: 'worca-preview:location', href: 'http://localhost:4317/preview/5173/tok/', title: 'Home' });   // its load
  h.post({ type: 'worca-preview:location', href: 'http://localhost:4317/preview/5173/tok/about', title: 'About' });
  assert.equal(tab.state.url, 'http://localhost:5173/about');
  assert.equal(tab.state.title, 'About');
  assert.deepEqual(tab.state.back, ['http://localhost:5173/']);
  h.post({ type: 'worca-preview:location', href: 'https://evil.example/preview/5173/x/' });
  h.post({ type: 'worca-preview:location', href: 'http://localhost:4317/api/runs' });
  assert.equal(tab.state.url, 'http://localhost:5173/about', 'only addresses under this tab\'s prefix');
  assert.equal(h.host.querySelector('button[aria-label="Back"]').disabled, false);
  h.press('Back');
  await tick();
  assert.equal(tab.state.url, 'http://localhost:5173/');
  assert.deepEqual(tab.state.fwd, ['http://localhost:5173/about']);
  assert.equal(h.frame().getAttribute('src'), '/preview/5173/tok/');
  h.press('Forward');
  await tick();
  assert.equal(tab.state.url, 'http://localhost:5173/about');
  assert.equal(h.frame().getAttribute('src'), '/preview/5173/tok/about');
});

test('a redirect on load and a replaceState replace the address; they add no Back step that would redirect again', async () => {
  const h = harness(mint());
  const tab = await h.mount({ url: 'localhost:5173/admin' });
  h.kind.focus(tab);   // every activation focuses the address bar
  const input = h.host.querySelector('.tool-browser-url input');
  h.post({ type: 'worca-preview:location', href: 'http://localhost:4317/preview/5173/tok/login' });
  assert.deepEqual([tab.state.url, tab.state.back], ['http://localhost:5173/login', undefined]);
  assert.equal(input.value, 'http://localhost:5173/login', 'the bar follows the redirect, focused or not');
  input.value = 'localhost:51';
  input.dispatchEvent(new h.win.Event('input'));
  h.post({ type: 'worca-preview:location', href: 'http://localhost:4317/preview/5173/tok/login?typing=1', replace: true });
  assert.equal(input.value, 'localhost:51', 'what the person is typing is kept');
  input.dispatchEvent(new h.win.Event('blur'));
  h.post({ type: 'worca-preview:location', href: 'http://localhost:4317/preview/5173/tok/login?next=1', replace: true });
  assert.deepEqual([tab.state.url, tab.state.back], ['http://localhost:5173/login?next=1', undefined]);
  assert.equal(input.value, 'http://localhost:5173/login?next=1', 'once the bar loses the focus, the page moves it again');
  h.post({ type: 'worca-preview:location', href: 'http://localhost:4317/preview/5173/tok/home', title: 'Home' });
  assert.deepEqual(tab.state.back, ['http://localhost:5173/login?next=1'], 'a later pushState is a step');
  const recent = readRecentUrls(h.win.localStorage);
  h.press('Reload');
  await tick();
  assert.equal(tab.state.title, 'Home', 'a reload keeps the title');
  assert.deepEqual(readRecentUrls(h.win.localStorage), recent, 'and the recent list as it was');
});

test('while a new address mints its token, the old page\'s reports are ignored', async () => {
  const h = harness(mint());
  const tab = await h.mount({ url: 'localhost:5173' });
  const old = h.frame().contentWindow;
  const input = h.host.querySelector('.tool-browser-url input');
  input.value = 'localhost:5174/b';
  input.dispatchEvent(new h.win.Event('input'));
  input.form.dispatchEvent(new h.win.Event('submit', { cancelable: true }));
  h.post({ type: 'worca-preview:location', href: 'http://localhost:4317/preview/5173/tok/stale' }, old);
  await tick();
  assert.equal(tab.state.url, 'http://localhost:5174/b');
  assert.equal(input.value, 'http://localhost:5174/b', 'a submitted address is the bar\'s again');
  assert.deepEqual(tab.state.back, ['http://localhost:5173/']);
});

test('Worca not answering says so; Worca\'s own address never frames in Worca\'s origin', async () => {
  const h = harness({}, { fail: true });
  await h.mount({ url: 'localhost:5173' });
  assert.equal(h.host.querySelector('.tool-browser-note .tool-note').textContent, 'Worca did not answer. Try again in a moment.');
  assert.equal(h.host.querySelector('.tool-browser-note .tool-note').getAttribute('role'), 'status');
  const hosted = harness({}, { url: 'https://worca.example.com/' });
  await hosted.mount({ url: 'https://worca.example.com/api/runs' });
  assert.equal(hosted.frame(), null);
  assert.equal(hosted.host.querySelector('.tool-browser-note .tool-note').textContent, 'Worca does not preview itself.');
});

test('a tab state that is not an address never reaches window.open; a huge address is never recorded', async () => {
  const h = harness(mint());
  await h.mount({ url: 'javascript:alert(1)' });
  const ext = h.host.querySelector('button[aria-label="Open in your browser"]');
  assert.equal(ext.disabled, true);
  ext.disabled = false;
  ext.click();
  await tick();
  assert.deepEqual(h.box.opened, [], 'and openOutside refuses it too');
  const h2 = harness(mint());
  const tab = await h2.mount({ url: 'localhost:5173' });
  h2.post({ type: 'worca-preview:location', href: `http://localhost:4317/preview/5173/tok/#${'x'.repeat(3000)}` });
  assert.equal(tab.state.url, 'http://localhost:5173/', 'a page keeping its state in the address does not fill localStorage');
  const input = h2.host.querySelector('.tool-browser-url input');
  input.value = `localhost:5173/${'y'.repeat(3000)}`;
  input.form.dispatchEvent(new h2.win.Event('submit', { cancelable: true }));
  await tick();
  assert.deepEqual(readRecentUrls(h2.win.localStorage), ['http://localhost:5173/'], 'nor the recent list');
});

test('a services repaint keeps the focus on the same service\'s row', async () => {
  const S = (id, port) => ({ instanceId: id, runId: 'r1', member: PK, actionId: id, label: id, kind: 'service', status: 'ready', url: `http://localhost:${port}` });
  const h = harness({}, { services: [S('a', 4401), S('b', 4402)] });
  await h.mount({});
  const rows = () => [...h.host.querySelectorAll('.tool-browser-services button')];
  rows()[1].focus();
  await h.setServices([S('c', 4403), S('a', 4401), S('b', 4402)]);
  assert.equal(h.win.document.activeElement, rows()[2]);
  assert.equal(h.win.document.activeElement.dataset.instanceId, 'b');
});

test('the shortcut leaves the Chat page\'s keys alone on every platform', () => {
  const kinds = [createBrowserKind({ doc: new JSDOM('').window.document, win: {}, fetch: async () => ({}) }),
    createFilesKind({ doc: new JSDOM('').window.document, fetch: async () => ({}) }),
    createChangesKind({ doc: new JSDOM('').window.document, fetch: async () => ({}), renderDiff: () => {} })];
  for (const k of kinds) {
    const sc = k.shortcut;
    const e = { key: sc.key, code: sc.code, ctrlKey: !!sc.ctrl, shiftKey: !!sc.shift, altKey: !!sc.alt, metaKey: false, inField: false };
    assert.equal(chatPageKeyAction(e, { mac: false }), null, `${k.kind}: ${sc.label}`);
  }
});

test('an expired token (Worca restarted) mints once more and reloads; a second refusal does not loop', async () => {
  let n = 0;
  const h = harness({ 'POST /api/preview/sessions': (b) => ({ __status: 201, base: `/preview/${b.port}/t${(n += 1)}/` }) });
  await h.mount({ url: 'localhost:5173' });
  h.post({ type: 'worca-preview:note', code: 'TOKEN_UNKNOWN' });
  await tick();
  assert.equal(h.frame().getAttribute('src'), '/preview/5173/t2/');
  h.post({ type: 'worca-preview:note', code: 'TOKEN_UNKNOWN' });
  await tick();
  assert.equal(n, 2);
});

test('an empty tab lists its scope\'s running services and offers the dev server; Use this saves, starts and opens it', async () => {
  const offer = { suggestion: { command: 'npm run dev', cmd: 'npm run dev -- --port {PORT}', port: 5173, script: 'dev' } };
  const h = harness({ ...mint(4401), [`GET /api/projects/${PK}/dev-server`]: offer,
    [`POST /api/projects/${PK}/dev-server`]: { __status: 201, action: { id: 'dev', label: 'Dev server' } },
    [`POST /api/projects/${PK}/actions/dev/try`]: { runId: 'run-9', instanceId: 'act:run-9:app:dev', status: 'starting' } },
  { services: [{ instanceId: 'x', kind: 'service', label: 'Web', member: PK, runId: 'r', url: 'http://localhost:4417', status: 'ready' },
    { instanceId: 'y', kind: 'service', label: 'Other', member: 'other-1', runId: 'r2', url: 'http://localhost:4418', status: 'ready' }] });
  const tab = await h.mount();
  assert.deepEqual([...h.host.querySelectorAll('.tool-browser-services .tool-newtab-label')].map((n) => n.textContent), ['Web']);
  assert.equal(h.host.querySelector('.tool-browser-offer-text').textContent, 'Dev server: npm run dev, on a free Actions port',
    'PORT=auto: the port it gets is not known yet');
  h.host.querySelector('.tool-browser-offer button').click();
  await tick();
  assert.deepEqual(h.calls.filter((c) => c.method === 'POST').map((c) => c.url), [`/api/projects/${PK}/dev-server`, `/api/projects/${PK}/actions/dev/try`]);
  assert.match(h.host.querySelector('.tool-browser-status').textContent, /Saved as the project Action "Dev server"/);
  await h.setServices([{ instanceId: 'act:run-9:app:dev', kind: 'service', member: PK, runId: 'run-9', status: 'starting', url: 'http://localhost:4401' }]);
  assert.equal(h.frame(), null, 'not ready yet');
  await h.setServices([{ instanceId: 'act:run-9:app:dev', kind: 'service', member: PK, runId: 'run-9', status: 'ready', url: 'http://localhost:4401' }]);
  assert.equal(tab.state.url, 'http://localhost:4401/');
  assert.equal(h.frame().getAttribute('src'), '/preview/4401/tok/');
});

test('a dev server pinned to its own port names it; a ready check that fails says why and stays said', async () => {
  const h = harness({ [`GET /api/projects/${PK}/dev-server`]: { suggestion: { command: 'npm run dev', port: 5173, pinned: true } },
    [`POST /api/projects/${PK}/dev-server`]: { __status: 201, action: { id: 'dev', label: 'Dev server' } },
    [`POST /api/projects/${PK}/actions/dev/try`]: { instanceId: 'i1' } }, { waitMs: 60 });
  await h.mount();
  assert.equal(h.host.querySelector('.tool-browser-offer-text').textContent, 'Dev server: npm run dev, port 5173');
  h.host.querySelector('.tool-browser-offer button').click();
  await tick();
  await h.setServices([{ instanceId: 'i1', kind: 'service', member: PK, runId: 'r', status: 'running', url: 'http://localhost:5173', readyError: 'no answer on 5173' }]);
  await new Promise((r) => setTimeout(r, 120));   // past waitMs: "It is taking long" must not replace the reason
  assert.equal(h.host.querySelector('.tool-browser-status').textContent, 'It is running but did not answer: no answer on 5173');
  assert.equal(h.host.querySelector('.tool-browser-status').getAttribute('role'), 'status');
});

test('a started service that stops says so for good; one never seen says it stopped before it answered', async () => {
  const routes = (instanceId, extra = {}) => ({ [`GET /api/projects/${PK}/dev-server`]: { suggestion: { command: 'npm run dev', port: 3000 } },
    [`POST /api/projects/${PK}/dev-server`]: { __status: 201, action: { id: 'dev', label: 'Dev server' } },
    [`POST /api/projects/${PK}/actions/dev/try`]: { instanceId, ...extra } });
  const status = (h) => h.host.querySelector('.tool-browser-status').textContent;
  const h = harness(routes('i1'), { waitMs: 60 });
  await h.mount();
  h.host.querySelector('.tool-browser-offer button').click();
  await tick();
  await h.setServices([{ instanceId: 'i1', kind: 'service', member: PK, runId: 'r', status: 'starting', url: 'http://localhost:4401' }]);
  await h.setServices([]);
  assert.equal(status(h), 'It stopped. Its log is on the run\'s Actions tab.');
  await new Promise((r) => setTimeout(r, 120));   // past waitMs
  assert.equal(status(h), 'It stopped. Its log is on the run\'s Actions tab.', '"taking long" never replaces it');
  const never = harness(routes('i2'), { waitMs: 60 });
  await never.mount();
  never.host.querySelector('.tool-browser-offer button').click();
  await tick();
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(status(never), 'It stopped before it answered. Its log is on the run\'s Actions tab.');
  const queued = harness(routes('i3', { queued: true }), { waitMs: 60 });
  await queued.mount();
  queued.host.querySelector('.tool-browser-offer button').click();
  await tick();
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(status(queued), 'It is taking long. Its log is on the run\'s Actions tab.', 'behind its setup command: not listed yet');
});

test('a Use this start survives a remount (another tab, the panel hidden): the tab still opens it once ready', async () => {
  let asked = 0;
  const h = harness({ ...mint(4401), [`GET /api/projects/${PK}/dev-server`]: () => ((asked += 1) === 1
    ? { suggestion: { command: 'npm run dev', port: 3000, setup: 'npm ci' } } : { suggestion: null, reason: 'HAS_SERVICE' }),
  [`POST /api/projects/${PK}/dev-server`]: { __status: 201, action: { id: 'dev', label: 'Dev server' } },
  [`POST /api/projects/${PK}/actions/dev/try`]: { __status: 202, queued: true, instanceId: 'i1' } });
  const tab = await h.mount();
  assert.equal(h.host.querySelector('.tool-browser-offer-text').textContent, 'Dev server: npm run dev, on a free Actions port (installs with npm ci first)');
  h.host.querySelector('.tool-browser-offer button').click();
  await tick();
  h.kind.unmount(tab);
  h.kind.mount(tab, h.host, h.api);
  await tick();
  assert.equal(asked, 1, 'still waiting: no new offer asked for');
  await h.setServices([{ instanceId: 'i1', kind: 'service', member: PK, runId: 'r', status: 'ready', url: 'http://localhost:4401' }]);
  assert.equal(tab.state.url, 'http://localhost:4401/');
  assert.equal(h.frame().getAttribute('src'), '/preview/4401/tok/');
  h.kind.unmount(tab);
  h.kind.mount(tab, h.host, h.api);
  await tick();
  assert.equal(h.frame().getAttribute('src'), '/preview/4401/tok/', 'opened: nothing pending any more');
});

test('Use this in a run tab starts it in that run, checking the run out first when it has to', async () => {
  let starts = 0;
  const h = harness({ [`GET /api/projects/${PK}/dev-server`]: { suggestion: { command: 'npm run dev', port: 3000 } },
    [`POST /api/projects/${PK}/dev-server`]: { __status: 201, action: { id: 'dev', label: 'Dev server' } },
    'POST /api/runs/run-1/actions/dev/start': () => ((starts += 1) === 1 ? { __status: 409, code: 'NOT_CHECKED_OUT', error: 'Check out the run first.' } : { instanceId: 'i1' }),
    'POST /api/runs/run-1/checkout': { ok: true } });
  await h.mount({}, RUN);
  h.host.querySelector('.tool-browser-offer button').click();
  await tick(12);
  assert.deepEqual(h.calls.filter((c) => c.method === 'POST').map((c) => c.url), [`/api/projects/${PK}/dev-server`,
    `/api/runs/run-1/actions/dev/start?projectKey=${PK}`, `/api/runs/run-1/checkout?projectKey=${PK}`, `/api/runs/run-1/actions/dev/start?projectKey=${PK}`]);
});

test('Use this in a project with no finished run says where it will run; a refused save keeps the button', async () => {
  const h = harness({ [`GET /api/projects/${PK}/dev-server`]: { suggestion: { command: 'npm run dev', port: 3000 } },
    [`POST /api/projects/${PK}/dev-server`]: { __status: 201, action: { id: 'dev', label: 'Dev server' } },
    [`POST /api/projects/${PK}/actions/dev/try`]: { __status: 404, code: 'NO_FINISHED_RUN', error: 'No finished run yet.' } });
  await h.mount();
  h.host.querySelector('.tool-browser-offer button').click();
  await tick();
  assert.match(h.host.querySelector('.tool-browser-status').textContent, /no finished run yet/);
  const h2 = harness({ [`GET /api/projects/${PK}/dev-server`]: { suggestion: { command: 'npm run dev', port: 3000 } },
    [`POST /api/projects/${PK}/dev-server`]: { __status: 409, code: 'HAS_SERVICE', error: 'This project already has a service Action.' } });
  await h2.mount();
  const use = h2.host.querySelector('.tool-browser-offer button');
  use.click();
  await tick();
  assert.equal(use.disabled, false);
  assert.equal(h2.host.querySelector('.tool-browser-status').textContent, 'This project already has a service Action.');
});

test('unmount stops listening: the message listener and the services subscription go', async () => {
  const h = harness(mint());
  const message = { added: 0, removed: 0 };
  const add = h.win.addEventListener.bind(h.win);
  const remove = h.win.removeEventListener.bind(h.win);
  h.win.addEventListener = (type, fn, o) => { if (type === 'message') message.added += 1; return add(type, fn, o); };
  h.win.removeEventListener = (type, fn, o) => { if (type === 'message') message.removed += 1; return remove(type, fn, o); };
  const tab = await h.mount({});
  assert.equal(h.box.listeners.size, 1, 'the empty tab follows the services list');
  const f = h.host.querySelector('.tool-browser');
  h.kind.unmount(tab);
  assert.deepEqual(message, { added: 1, removed: 1 });
  assert.equal(h.box.listeners.size, 0);
  assert.ok(f, 'precondition: it had drawn');
  const live = await h.mount({ url: 'localhost:5173' });
  h.kind.unmount(live);
  h.post({ type: 'worca-preview:location', href: 'http://localhost:4317/preview/5173/tok/later' }, h.win);
  assert.equal(live.state.url, 'http://localhost:5173/');
  assert.equal(JSON.parse(h.win.localStorage.getItem(RECENT_KEY)).length, 1);
});

test('an external page then a local one: a new iframe each time, never the allow-same-origin one reused', async () => {
  const h = harness(mint());
  await h.mount({ url: 'example.com' });
  const ext = h.frame();
  assert.match(ext.getAttribute('sandbox'), /allow-same-origin/);
  const input = h.host.querySelector('.tool-browser-url input');
  input.value = 'localhost:5173';
  h.host.querySelector('form').dispatchEvent(new h.win.Event('submit', { cancelable: true }));
  await tick();
  const loc = h.frame();
  assert.notEqual(loc, ext);
  assert.equal(ext.isConnected, false);
  assert.doesNotMatch(loc.getAttribute('sandbox'), /allow-same-origin/);
  assert.equal(h.host.querySelectorAll('iframe').length, 1);
  // back to the external one: a new frame again
  h.press('Back');
  await tick();
  assert.notEqual(h.frame(), loc);
  assert.match(h.frame().getAttribute('sandbox'), /allow-same-origin/);
  // forward to local through the remint: new frame, no same-origin
  h.press('Forward');
  await tick();
  assert.doesNotMatch(h.frame().getAttribute('sandbox'), /allow-same-origin/);
});

test('a remount while Use this is still starting keeps the auto-open', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const h = harness({ ...mint(4401), [`GET /api/projects/${PK}/dev-server`]: { suggestion: { command: 'npm run dev', port: 3000 } },
    [`POST /api/projects/${PK}/dev-server`]: { __status: 201, action: { id: 'dev', label: 'Dev server' } },
    [`POST /api/projects/${PK}/actions/dev/try`]: () => gate });
  const tab = await h.mount();
  h.host.querySelector('.tool-browser-offer button').click();
  await tick();
  h.kind.unmount(tab);          // the person looks at another tab while the start request is in flight
  h.kind.mount(tab, h.host, h.api);
  await tick();
  release({ instanceId: 'i1' });
  await tick();
  await h.setServices([{ instanceId: 'i1', kind: 'service', member: PK, runId: 'r', status: 'ready', url: 'http://localhost:4401' }]);
  assert.equal(tab.state.url, 'http://localhost:4401/', 'the started service never opens');
});

test('after a failed Use this wait, a service that starts later is still listed', async () => {
  const h = harness({ [`GET /api/projects/${PK}/dev-server`]: { suggestion: { command: 'npm run dev', port: 3000 } },
    [`POST /api/projects/${PK}/dev-server`]: { __status: 201, action: { id: 'dev', label: 'Dev server' } },
    [`POST /api/projects/${PK}/actions/dev/try`]: { instanceId: 'i1' } });
  await h.mount();
  h.host.querySelector('.tool-browser-offer button').click();
  await tick();
  await h.setServices([{ instanceId: 'i1', kind: 'service', member: PK, runId: 'r', status: 'starting', url: 'http://localhost:4401' }]);
  await h.setServices([]);
  assert.match(h.host.querySelector('.tool-browser-status').textContent, /It stopped/);
  await h.setServices([{ instanceId: 'x', kind: 'service', label: 'Web', member: PK, runId: 'r', url: 'http://localhost:4417', status: 'ready' }]);
  assert.deepEqual([...h.host.querySelectorAll('.tool-browser-services .tool-newtab-label')].map((n) => n.textContent), ['Web']);
});

test('while Use this waits, the services list still follows starts and stops', async () => {
  const h = harness({ [`GET /api/projects/${PK}/dev-server`]: { suggestion: { command: 'npm run dev', port: 3000 } },
    [`POST /api/projects/${PK}/dev-server`]: { __status: 201, action: { id: 'dev', label: 'Dev server' } },
    [`POST /api/projects/${PK}/actions/dev/try`]: { instanceId: 'i1', queued: true } });
  await h.mount();
  h.host.querySelector('.tool-browser-offer button').click();
  await tick();
  await h.setServices([{ instanceId: 'x', kind: 'service', label: 'Web', member: PK, runId: 'r', url: 'http://localhost:4417', status: 'ready' }]);
  assert.deepEqual([...h.host.querySelectorAll('.tool-browser-services .tool-newtab-label')].map((n) => n.textContent), ['Web']);
});

test('another site in the frame cannot put up the proxy\'s notes', async () => {
  const h = harness();
  await h.mount({ url: 'example.com' });
  for (const code of ['FRAME_REFUSED', 'NOT_LISTENING', 'TOKEN_UNKNOWN']) h.post({ type: 'worca-preview:note', code });
  await tick();
  assert.equal(h.frame().getAttribute('src'), 'https://example.com/');
  assert.equal(h.calls.length, 0);
});

test('a slow mint that lands after another address was typed is dropped', async () => {
  let release;
  const h = harness({ 'POST /api/preview/sessions': () => new Promise((r) => { release = r; }) });
  const tab = await h.mount({ url: 'localhost:5173' });
  const input = h.host.querySelector('.tool-browser-url input');
  input.value = 'example.com';
  h.host.querySelector('form').dispatchEvent(new h.win.Event('submit', { cancelable: true }));
  release({ port: 5173, token: 'tok', base: '/preview/5173/tok/' });
  await tick();
  assert.equal(tab.state.url, 'https://example.com/');
  assert.equal(h.frame().getAttribute('src'), 'https://example.com/');
});

test('a Use this start that becomes ready after the person typed an address leaves their page alone', async () => {
  const h = harness({ ...mint(4401), [`GET /api/projects/${PK}/dev-server`]: { suggestion: { command: 'npm run dev', port: 3000 } },
    [`POST /api/projects/${PK}/dev-server`]: { __status: 201, action: { id: 'dev', label: 'Dev server' } },
    [`POST /api/projects/${PK}/actions/dev/try`]: { instanceId: 'i1' } });
  const tab = await h.mount();
  h.host.querySelector('.tool-browser-offer button').click();
  await tick();
  const input = h.host.querySelector('.tool-browser-url input');
  input.value = 'example.com';
  h.host.querySelector('form').dispatchEvent(new h.win.Event('submit', { cancelable: true }));
  await tick();
  await h.setServices([{ instanceId: 'i1', kind: 'service', member: PK, runId: 'r', status: 'ready', url: 'http://localhost:4401' }]);
  assert.equal(tab.state.url, 'https://example.com/');
});

// ── in the real app (app.js + index.html) ───────────────────────────────────────────────────────────
async function bootApp() {
  const { bootChat, ok } = await import('./helpers/chat-panel-boot.mjs');
  const SVC = { instanceId: 'act:r1:app:web', runId: 'r1', member: PK, actionId: 'web', label: 'Web', kind: 'service', status: 'ready',
    ports: { PORT: 4417 }, url: 'http://localhost:4417', histKey: PK, runTitle: 'Fix login' };
  const minted = [];
  const ctx = await bootChat({ arms: (url, opts) => {
    const path = url.split('?')[0];
    if (path.endsWith('/api/actions/running')) return ok([SVC]);
    if (path.endsWith('/api/preview/sessions')) { const { port } = JSON.parse(opts.body); minted.push(port); return ok({ port, token: 'tok', base: `/preview/${port}/tok/` }); }
    return null;
  } });
  ctx.dispatch({ type: 'actions-changed', action: 'ready' });
  await ctx.settle(8);
  const doc = ctx.window.document;
  const frames = () => [...doc.querySelectorAll('.tool-panel iframe.tool-browser-frame')].map((f) => f.getAttribute('src'));
  const tabs = () => [...doc.querySelectorAll('.tool-panel .tool-tab-text')].map((n) => n.textContent);
  return { ...ctx, doc, minted, frames, tabs };
}

test('in the real app: the Browser kind is registered, so its header icon is no longer "coming soon"', async () => {
  const a = await bootApp();
  const b = a.doc.querySelector('.tool-icon[data-tool-kind="browser"]');
  assert.ok(b);
  assert.doesNotMatch(b.title, /coming soon/);
});

test('in the real app: an Actions Open link opens a Browser tab through the proxy; a modified click keeps the browser\'s own tab', async () => {
  const a = await bootApp();
  const link = a.doc.createElement('a');
  link.className = 'act-open';
  link.href = 'http://localhost:4417';
  link.target = '_blank';
  a.doc.body.append(link);
  const ctrl = new a.window.MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
  link.dispatchEvent(ctrl);
  assert.equal(ctrl.defaultPrevented, false);
  const plain = new a.window.MouseEvent('click', { bubbles: true, cancelable: true });
  link.dispatchEvent(plain);
  await a.settle(10);
  assert.equal(plain.defaultPrevented, true);
  assert.deepEqual(a.minted, [4417]);
  assert.deepEqual(a.frames(), ['/preview/4417/tok/']);
  assert.deepEqual(a.tabs(), ['localhost:4417'], 'a new chat opens no tab of its own: the service\'s run holds it');
  const nowhere = a.doc.createElement('a');
  nowhere.className = 'act-open';
  nowhere.href = 'http://localhost:4499';
  a.doc.body.append(nowhere);
  const lost = new a.window.MouseEvent('click', { bubbles: true, cancelable: true });
  nowhere.dispatchEvent(lost);
  assert.equal(lost.defaultPrevented, false, 'not running and no run, chat or project here: the browser\'s own tab');
  const inDialog = a.doc.createElement('a');
  inDialog.className = 'act-open';
  inDialog.href = 'http://localhost:4417';
  a.doc.getElementById('shipit-modal').append(inDialog);
  const modal = new a.window.MouseEvent('click', { bubbles: true, cancelable: true });
  inDialog.dispatchEvent(modal);
  assert.equal(modal.defaultPrevented, false, 'Create PR\'s Try it first: the panel would open under the dialog');
});

test('in the real app: the sidebar\'s Running actions row opens its service in a Browser tab, and Suggested lists it as recent', async () => {
  const a = await bootApp();
  const globe = a.doc.querySelector('#side-actions-rows .act-srow-open');
  assert.ok(globe, 'the row has its globe');
  globe.click();
  await a.settle(10);
  assert.deepEqual(a.frames(), ['/preview/4417/tok/']);
  a.doc.querySelector('.tool-panel .tool-new').click();
  await a.settle(6);
  const rows = [...a.doc.querySelectorAll('.tool-panel .tool-suggest .tool-newtab-row')].map((r) => r.textContent);
  assert.ok(rows.some((t) => t.includes('http://localhost:4417/') && t.includes('Recent')), rows.join(' | '));
});

test('in the real app: a service that starts while the + page shows appears among its Suggested rows', async () => {
  const { bootChat, ok } = await import('./helpers/chat-panel-boot.mjs');
  const running = [];
  const ctx = await bootChat({ url: `http://localhost:4317/#projects/${PK}`, arms: (url) => {
    const path = url.split('?')[0];
    if (path.endsWith('/api/projects')) return ok({ projects: [{ key: PK, name: 'app', path: '/tmp/app' }] });
    if (path.endsWith('/api/actions/running')) return ok(running.slice());
    return null;
  } });
  await ctx.settle(8);
  const doc = ctx.window.document;
  ctx.window.localStorage.setItem(RECENT_KEY, JSON.stringify(['http://localhost:4417/']));
  doc.querySelector('.tool-panel .tool-new').click();
  await ctx.settle(6);
  const labels = () => [...doc.querySelectorAll('.tool-panel .tool-suggest .tool-newtab-label')].map((n) => n.textContent);
  assert.deepEqual(labels(), ['http://localhost:4417/']);
  running.push({ instanceId: 'act:r1:app:web', runId: 'r1', member: PK, actionId: 'web', label: 'Web', kind: 'service', status: 'ready',
    ports: { PORT: 4417 }, url: 'http://localhost:4417', histKey: PK, runTitle: 'Fix login' });
  ctx.dispatch({ type: 'actions-changed', action: 'ready' });
  await ctx.settle(8);
  assert.deepEqual(labels(), ['Web :4417'], 'its recent address is the same page: listed once');
  const away = doc.createElement('a');
  away.className = 'act-open';
  away.href = 'https://staging.example.com/';
  doc.body.append(away);
  const ev = new ctx.window.MouseEvent('click', { bubbles: true, cancelable: true });
  away.dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, false, 'an Action that opens another site keeps its own browser tab (most refuse frames)');
});

test('in the real app: a divider drag turns framed pages off, so a Browser tab cannot take the moves and the release', async () => {
  const { readStyleCss } = await import('../src/core/read-style-css.mjs');
  const css = readStyleCss();
  assert.match(css, /body\.tool-resizing iframe\{pointer-events:none;?\}/);
});

/** The project page with its sync chip read (`remoteLabel`) and window.open recorded. */
async function bootProjectWithRemote(remoteLabel) {
  const { bootChat, ok } = await import('./helpers/chat-panel-boot.mjs');
  const ctx = await bootChat({ url: `http://localhost:4317/#projects/${PK}`, arms: (url) => {
    const path = url.split('?')[0];
    if (path.endsWith('/api/projects')) return ok({ projects: [{ key: PK, name: 'app', path: '/tmp/app' }] });
    if (path.endsWith('/api/sync/projects')) return ok({ projects: { [PK]: { remote: 'origin', remoteLabel, ahead: 0, behind: 0 } } });
    if (path.endsWith('/api/actions/running')) return ok([]);
    return null;
  } });
  const opened = [];
  ctx.window.open = (...args) => { opened.push(args); return null; };
  await ctx.settle(8);
  await new Promise((r) => setTimeout(r, 400));   // the sync chips' read is coalesced (300 ms)
  await ctx.settle(8);
  const doc = ctx.window.document;
  doc.querySelector('.tool-panel .tool-new').click();
  await ctx.settle(6);
  const rows = () => [...doc.querySelectorAll('.tool-panel .tool-suggest .tool-newtab-row')];
  return { ...ctx, doc, opened, rows };
}

test('in the real app: the + page offers the project\'s GitHub repo, opened in a window of its own; another host gets no such row', async () => {
  const a = await bootProjectWithRemote('github.com/o/r');
  const gh = a.rows().find((r) => r.textContent.includes('o/r on GitHub'));
  assert.ok(gh, a.rows().map((r) => r.textContent).join(' | '));
  gh.click();
  await a.settle(4);
  assert.deepEqual(a.opened, [['https://github.com/o/r', '_blank', 'noopener,noreferrer']]);
  for (const label of ['gitlab.com/o/r', 'github.com/o/r/extra', 'github.com.evil.example/o/r']) {
    const b = await bootProjectWithRemote(label);
    assert.ok(!b.rows().some((r) => /on GitHub/.test(r.textContent)), `${label}: ${b.rows().map((r) => r.textContent).join(' | ')}`);
  }
});

/** The real app with two running services in the sidebar's Running actions (both with a globe). */
async function bootTwoServices() {
  const { bootChat, ok } = await import('./helpers/chat-panel-boot.mjs');
  const svc = (n, port) => ({ instanceId: `act:r${n}:app:web`, runId: `r${n}`, member: PK, actionId: 'web', label: 'Web', kind: 'service',
    status: 'ready', ports: { PORT: port }, url: `http://localhost:${port}`, histKey: PK, runTitle: `Run ${n}` });
  const box = { running: [svc(1, 4417), svc(2, 4418)] };
  const ctx = await bootChat({ arms: (url, opts) => {
    const path = url.split('?')[0];
    if (path.endsWith('/api/actions/running')) return ok(box.running.slice());
    if (path.endsWith('/api/preview/sessions')) { const { port } = JSON.parse(opts.body); return ok({ port, token: 'tok', base: `/preview/${port}/tok/` }); }
    return null;
  } });
  ctx.dispatch({ type: 'actions-changed', action: 'ready' });
  await ctx.settle(8);
  const doc = ctx.window.document;
  const row = (host, id) => [...doc.querySelectorAll(`${host} .act-srow`)].find((r) => r.dataset.instanceId === id);
  const repaint = async (list) => { box.running = list; ctx.dispatch({ type: 'actions-changed', action: 'ready' }); await ctx.settle(8); };
  return { ...ctx, doc, box, svc, row, repaint };
}

test('in the real app: a Running actions repaint keeps the focus on the same row\'s globe; a row that loses its globe hands it to its Stop', async () => {
  const a = await bootTwoServices();
  const id2 = 'act:r2:app:web';
  a.row('#side-actions-rows', id2).querySelector('.act-srow-open').focus();
  await a.repaint([a.svc(1, 4417), a.svc(2, 4418)]);
  let f = a.doc.activeElement;
  assert.ok(f.classList.contains('act-srow-open'), f.className);
  assert.equal(f.closest('.act-srow').dataset.instanceId, id2, 'the same row\'s globe');
  // The second service's address stops being one a frame may open: its row keeps Stop, loses the globe.
  await a.repaint([a.svc(1, 4417), { ...a.svc(2, 4418), url: 'javascript:alert(1)' }]);
  f = a.doc.activeElement;
  assert.ok(f.classList.contains('act-stop'), `focus on ${f.className || f.tagName}`);
  assert.equal(f.closest('.act-srow').dataset.instanceId, id2, 'its own Stop, never another row\'s globe');
});

test('in the real app: the globe in the rail flyout closes the flyout before the Browser tab it opens takes the focus', async () => {
  const a = await bootTwoServices();
  const tile = a.doc.getElementById('side-actions-tile');
  const fly = a.doc.getElementById('side-actions-fly');
  tile.click();
  await a.settle(4);
  assert.equal(fly.hidden, false, 'precondition: the flyout is open');
  // Window capture runs before the flyout's own focusin close (focus leaving it), so this sees the explicit close only.
  const atFocus = [];
  a.window.addEventListener('focusin', (e) => { if (e.target.closest?.('.tool-panel')) atFocus.push(fly.hidden); }, true);
  a.row('#side-actions-fly-rows', 'act:r1:app:web').querySelector('.act-srow-open').click();
  await a.settle(10);
  assert.equal(fly.hidden, true, 'the flyout closed');
  assert.equal(atFocus[0], true, 'closed by the globe itself, not only by the focus leaving it');
  assert.deepEqual([...a.doc.querySelectorAll('.tool-panel iframe.tool-browser-frame')].map((x) => x.getAttribute('src')), ['/preview/4417/tok/']);
});

test('Pick element: aria-disabled with a reason off local previews; on a preview it asks the frame, then sends files to the composer', async () => {
  const sent = [];
  const pickRoute = { 'POST /api/tools/browser/pick': (b) => (b.selector === '#gone' ? { __status: 409, error: 'The element is not on a fresh load of this page', code: 'NOT_FOUND' } : { png: Buffer.from('PNGDATA').toString('base64'), width: 10, height: 10 }) };
  const ext = harness({}, { onPick: (files, o) => sent.push([files, o]) });
  await ext.mount({ url: 'https://example.com/' });
  const pb = () => ext.host.querySelector('button[aria-label="Pick an element"]');
  assert.equal(pb().getAttribute('aria-disabled'), 'true');
  assert.match(pb().title, /local previews/);
  const h = harness({ ...mint(), ...pickRoute }, { onPick: (files, o) => sent.push([files, o]) });
  await h.mount({ url: 'localhost:5173/app' });
  const btn = h.host.querySelector('button[aria-label="Pick an element"]');
  assert.equal(btn.getAttribute('aria-disabled'), 'false');
  const asked = [];
  h.frame().contentWindow.postMessage = (m) => asked.push(m);
  h.post({ type: 'worca-preview:picked', selector: 'h1' });          // not asked for: ignored
  await tick();
  assert.equal(sent.length, 0);
  btn.click();
  assert.deepEqual(asked, [{ type: 'worca-preview:pick', on: true }]);
  assert.equal(btn.getAttribute('aria-pressed'), 'true');
  h.post({ type: 'worca-preview:picked', selector: 'main > h1', snippet: '<h1>Hi</h1>', rect: { x: 1, y: 2, width: 30, height: 10 } });
  await tick();
  const [files, opts] = sent.at(-1);
  assert.deepEqual(files.map((f) => [f.type, /^element-\d+\.png$|^picked-element-\d+\.md$/.test(f.name)]), [['image/png', true], ['text/markdown', true]]);
  assert.equal(new TextDecoder().decode(new Uint8Array(await files[0].arrayBuffer())), 'PNGDATA');
  assert.match(await files[1].text(), /selector: main > h1[\s\S]*untrusted DATA|untrusted DATA[\s\S]*selector: main > h1/);
  assert.equal(opts.note, '');
  const call = h.calls.find((c) => c.url === '/api/tools/browser/pick');
  assert.deepEqual([call.body.url, call.body.selector], ['http://localhost:5173/app', 'main > h1']);
  btn.click();
  h.post({ type: 'worca-preview:picked', selector: '#gone' });
  await tick();
  const [only, o2] = sent.at(-1);
  assert.deepEqual(only.map((f) => f.type), ['text/markdown'], 'no screenshot: the selector still goes');
  assert.match(o2.note, /fresh load/);
  btn.click();
  h.post({ type: 'worca-preview:pick-cancel' });
  assert.equal(btn.getAttribute('aria-pressed'), 'false');
  // A reload while picking ends the pick (the new token's mint), and a picked message the new page posts by itself
  // is ignored.
  btn.click();
  assert.equal(btn.getAttribute('aria-pressed'), 'true');
  // A link the page follows loads a new page whose shim starts unarmed: its location report arms it again.
  asked.length = 0;
  h.post({ type: 'worca-preview:location', href: 'http://localhost:4317/preview/5173/tok/next' });
  assert.deepEqual(asked, [{ type: 'worca-preview:pick', on: true }]);
  assert.equal(btn.getAttribute('aria-pressed'), 'true');
  h.press('Reload');
  await tick();
  assert.equal(btn.getAttribute('aria-pressed'), 'false');
  const n = sent.length;
  h.post({ type: 'worca-preview:picked', selector: 'h2' });
  await tick();
  assert.equal(sent.length, n);
});

test('pickMarkdown: one line per value, a fence longer than any in the snippet, no screenshot noted', () => {
  const md = pickMarkdown({ url: 'http://localhost:1/\nx', selector: 'a\nb', snippet: '<p>```</p>', viewport: { width: 1, height: 1 } });
  assert.match(md, /^url: http:\/\/localhost:1\/ x$/m);
  assert.match(md, /^````html$/m);
  assert.match(md, /screenshot: none/);
});

test('in the real app: a chat\'s undelivered assistant tab joins the strip, marked; an ask-tool-tabs frame for another chat fetches nothing (issue 1064 slice 3)', async () => {
  const { bootChat, ok } = await import('./helpers/chat-panel-boot.mjs');
  const CHAT = 'ask_0000aaaa';
  const ctx = await bootChat({ url: `http://localhost:4317/#chat/${CHAT}`, arms: (url, opts) => {
    const path = url.split('?')[0];
    if (path.endsWith(`/api/ask/threads/${CHAT}`) && (opts.method || 'GET') === 'GET') {
      return ok({ thread: { id: CHAT, title: 'Tabs', context: { pinned: true, projectKey: PK } }, messages: [] });
    }
    if (path.endsWith('/api/tools/tabs')) {
      if (opts.method === 'PUT') return ok({ tabs: [] });
      return ok({ tabs: url.includes(`threadId=${CHAT}`) ? [{ id: 'tab_srv1', kind: 'files', delivered: false }] : [] });
    }
    if (path.endsWith('/api/projects')) return ok({ projects: [{ key: PK, name: 'app', path: '/tmp/app' }] });
    return null;
  } });
  await ctx.settle(12);
  const doc = ctx.window.document;
  doc.querySelector('.tool-icon[data-tool-kind="files"]').click();
  await ctx.settle(8);
  assert.deepEqual([...doc.querySelectorAll('.tool-panel .tool-tab-item.is-assistant')].map((n) => n.dataset.tabId), ['tab_srv1']);
  const gets = () => ctx.calls.filter((c) => c.url.split('?')[0].endsWith('/api/tools/tabs') && (c.opts.method || 'GET') === 'GET').length;
  const before = gets();
  ctx.dispatch({ type: 'ask-tool-tabs', threadId: 'ask_0000bbbb' });
  await ctx.settle(4);
  assert.equal(gets(), before, 'another chat\'s frame: no pull');
  ctx.dispatch({ type: 'ask-tool-tabs', threadId: CHAT });
  await ctx.settle(4);
  assert.ok(gets() > before, 'the chat on screen: its tabs are pulled');
});

/** A project page whose panel shows a local Browser tab, with the pick route answered by `pick`. */
async function bootPicking(pick) {
  const { bootChat, ok } = await import('./helpers/chat-panel-boot.mjs');
  const tools = { v: 1, tabs: [{ id: 'tab_pk1', kind: 'browser', scope: { type: 'project', id: PK }, state: { url: 'http://localhost:4417/' }, at: 1 }],
    active: {}, prefs: { width: 460 }, open: [`project:${PK}`] };
  const picks = [];
  const ctx = await bootChat({ url: `http://localhost:4317/#projects/${PK}`, local: { 'worca-cc.tools': JSON.stringify(tools) }, arms: (url, opts) => {
    const path = url.split('?')[0];
    if (path.endsWith('/api/projects')) return ok({ projects: [{ key: PK, name: 'app', path: '/tmp/app' }] });
    if (path.endsWith('/api/preview/sessions')) { const { port } = JSON.parse(opts.body); return ok({ port, token: 'tok', base: `/preview/${port}/tok/` }); }
    if (path.endsWith('/api/tools/browser/pick')) { picks.push(JSON.parse(opts.body)); return pick(); }
    return null;
  } });
  await ctx.settle(10);
  const doc = ctx.window.document;
  const frame = doc.querySelector('.tool-panel iframe.tool-browser-frame');
  assert.ok(frame, 'precondition: the tab shows its proxied page');
  const asked = [];
  frame.contentWindow.postMessage = (d) => asked.push(d);
  doc.querySelector('.tool-panel button[aria-label="Pick an element"]').click();
  assert.deepEqual(asked, [{ type: 'worca-preview:pick', on: true }]);
  ctx.window.dispatchEvent(new ctx.window.MessageEvent('message', { data: { type: 'worca-preview:picked', selector: 'main > h1', snippet: '<h1>Hi</h1>' }, source: frame.contentWindow }));
  await ctx.settle(12);
  const chips = [...doc.querySelectorAll('#ask-side .ask-chip-name')].map((n) => n.textContent);
  const side = doc.getElementById('ask-side');
  const toasts = [...doc.querySelectorAll('#toasts .toast')].map((n) => n.textContent);
  return { ...ctx, doc, picks, chips, toasts, side };
}

test('in the real app: Pick element on a project page opens the chat and puts the screenshot and the selector into its composer', async () => {
  const { ok } = await import('./helpers/chat-panel-boot.mjs');
  const a = await bootPicking(() => ok({ png: Buffer.from('PNGDATA').toString('base64'), width: 10, height: 10 }));
  assert.deepEqual(a.picks.map((p) => [p.url, p.selector]), [['http://localhost:4417/', 'main > h1']]);
  assert.equal(a.window.location.hash, `#projects/${PK}`, 'the page stays: openChat opens the side column');
  assert.ok(a.side && !a.side.hidden && !a.side.classList.contains('hidden'), 'the side column shows');
  assert.equal(a.chips.length, 2, a.chips.join(' | '));
  assert.match(a.chips[0], /^element-\d+\.png$/);
  assert.match(a.chips[1], /^picked-element-\d+\.md$/);
  assert.ok(!a.toasts.some((t) => /Pick element/.test(t)), 'a screenshot that worked says nothing');
});

test('in the real app: a failed screenshot still sends the selector file, and a toast says why', async () => {
  const { fail } = await import('./helpers/chat-panel-boot.mjs');
  const a = await bootPicking(() => fail(409, { error: 'The element is not on a fresh load of this page', code: 'NOT_FOUND' }));
  assert.equal(a.chips.length, 1, a.chips.join(' | '));
  assert.match(a.chips[0], /^picked-element-\d+\.md$/);
  assert.ok(a.toasts.some((t) => /Pick element/.test(t) && /fresh load/.test(t)), a.toasts.join(' | '));
});
