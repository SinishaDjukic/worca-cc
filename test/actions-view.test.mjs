// test/actions-view.test.mjs — pure jsdom tests for the Actions renderers (issue #529).
// No app.js boot: every renderer takes `doc` explicitly and returns detached DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { memberViewState, renderActionsCard, renderOverviewStrip, renderRunPill,
  renderRunningActionRows, historyActionBadges, formatUptime, isSafeHref, createActionsController } from '../ui/public/actions-view.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const member = (over = {}) => ({ projectKey: 'app-0cea65fb', projectName: 'app', branch: 'worca-cc/x', worktreeDir: '/h/runs/ab/repos/app-0cea65fb',
  checkout: null, copyCommand: 'cd "/p"\ngit switch worca-cc/x', setup: 'npm ci',
  actions: [{ id: 'run', label: 'Run', kind: 'service' }, { id: 'test', label: 'Test', kind: 'task' }],
  builtins: [{ key: 'editor', label: 'VS Code' }, { key: 'terminal', label: 'Terminal' }, { key: 'fileManager', label: 'Finder' }, { key: 'copyCommand', label: 'Copy command' }], ...over });
const model = (m, instances = []) => ({ enabled: true, finished: true, workspace: false, estimate: { lastSetupMs: 42000 }, members: [m], stacks: [], stackStates: [], instances });
// A button's accessible name (aria-label when it has one: the stop button reads "Stop Run"); icon-only copy buttons are left out.
const labelsOf = (el) => [...el.querySelectorAll('button:not(.act-copy)')].map((b) => b.getAttribute('aria-label') || b.textContent);

test('four states (plus pending / interrupted setup)', () => {
  assert.equal(memberViewState(member(), []), 'not-checked-out');
  assert.equal(memberViewState(member({ checkout: { setup: { status: 'running' } } }), []), 'setting-up');
  assert.equal(memberViewState(member({ checkout: { setup: { status: 'pending' } }, setupQueued: true }), []), 'setting-up');
  // a kept-by-policy checkout: setup has not run yet and nothing is queued → usable, not stuck
  assert.equal(memberViewState(member({ checkout: { setup: { status: 'pending' } } }), []), 'ready');
  assert.equal(memberViewState(member({ checkout: { setup: { status: 'interrupted' } } }), []), 'setup-failed');
  const run = { instanceId: 'i', member: 'app-0cea65fb', actionId: 'run', kind: 'service', status: 'ready', ports: { PORT: 4417 }, url: 'http://localhost:4417', startedAt: 0 };
  assert.equal(memberViewState(member({ checkout: { setup: { status: 'ok' } } }), [run]), 'running');
  const task = { instanceId: 't', member: 'app-0cea65fb', actionId: 'test', kind: 'task', status: 'exited', exitCode: 1 };
  assert.equal(memberViewState(member({ checkout: { setup: { status: 'ok' } } }), [task]), 'task-result');
});

test('not checked out: folder to come, estimate, Check out + Copy command, the other built-ins check out first', () => {
  const el = renderActionsCard(model(member()), { doc, handlers: {} });
  assert.doesNotMatch(el.textContent, /\/h\/runs\/ab\/repos\/app-0cea65fb/, 'no folder path before it exists');
  assert.match(el.querySelector('.act-meta').textContent, /FolderCreated when you check out/);
  assert.match(el.querySelector('.act-apps').textContent, /^Check out takes about 42 s\./);
  assert.deepEqual(labelsOf(el), ['Check out', 'Copy command', 'VS Code', 'Terminal', 'Finder']);
  const opens = [...el.querySelectorAll('button')].filter((b) => ['VS Code', 'Terminal', 'Finder'].includes(b.textContent));
  assert.ok(opens.every((b) => !b.disabled && b.title.startsWith('Check out first (asks), then: ')));
  assert.equal(opens.find((b) => b.textContent === 'Terminal').title, 'Check out first (asks), then: open Terminal in the checkout');
  assert.match(el.textContent, /VS Code, Terminal and Finder open the checkout, so they check out first\./);
  const seen = [];
  const el2 = renderActionsCard(model(member()), { doc, handlers: { onOpenBeforeCheckout: (...a) => seen.push(a) } });
  [...el2.querySelectorAll('button')].find((b) => b.textContent === 'Terminal').click();
  assert.deepEqual(seen, [['app-0cea65fb', 'terminal', 'Terminal']]);
  const ws = model(member()); ws.workspace = true;
  const wsEl = renderActionsCard(ws, { doc, handlers: {} });
  assert.ok([...wsEl.querySelectorAll('button')].filter((b) => b.textContent === 'Terminal').every((b) => b.disabled && b.title === 'Available after Check out'),
    'a workspace run checks out from its checklist');
});

test('running: Stop Run, Test, built-ins, open link, Discard', () => {
  const run = { instanceId: 'i', member: 'app-0cea65fb', actionId: 'run', kind: 'service', status: 'ready', ports: { PORT: 4417 }, url: 'http://localhost:4417', startedAt: Date.now() - 65000 };
  const el = renderActionsCard(model(member({ checkout: { setup: { status: 'ok' } } }), [run]), { doc, handlers: {} });
  const labels = labelsOf(el);
  const stop = el.querySelector('.act-stop-btn');
  assert.equal(stop.textContent, 'Run', 'the service name, not "Stop Run"');
  assert.ok(stop.querySelector('svg rect') && stop.classList.contains('btn-danger'), 'a stop square, in the stop colour');
  assert.equal(stop.title, 'Stop Run and free its port');
  for (const l of ['Stop Run', 'Test', 'VS Code', 'Terminal', 'Finder', 'Copy command', 'Discard']) assert.ok(labels.includes(l), l);
  assert.equal(el.querySelector('a.act-open').getAttribute('href'), 'http://localhost:4417');
  assert.equal(el.querySelector('a.act-open').getAttribute('rel'), 'noopener noreferrer');
});

test('an unsafe url is never rendered as a link (D24, defence in depth)', () => {
  const run = { instanceId: 'i', member: 'app-0cea65fb', actionId: 'run', kind: 'service', status: 'ready', ports: { PORT: 4417 }, url: 'javascript:alert(1)', startedAt: 0 };
  const el = renderActionsCard(model(member({ checkout: { setup: { status: 'ok' } } }), [run]), { doc, handlers: {} });
  assert.equal(el.querySelector('a.act-open'), null);
  assert.equal(isSafeHref('http://localhost:1'), true);
  assert.equal(isSafeHref(' JAVASCRIPT:x'), false);
});

test('run not finished (interrupted / paused): no Check out, a hint', () => {
  const m = model(member()); m.finished = false; m.runStatus = 'interrupted';
  const el = renderActionsCard(m, { doc, handlers: {} });
  assert.match(el.textContent, /Check out is available once the run has finished\./);
  assert.doesNotMatch(el.textContent, /stop the run/);
  assert.equal(labelsOf(el).some((t) => t === 'Check out'), false);
});

test('disabled (hosted): actions and built-ins hidden, Check out and Copy command kept', () => {
  const m = model(member()); m.enabled = false;
  const el = renderActionsCard(m, { doc, handlers: {} });
  assert.match(el.textContent, /turned off on this hosted deployment/);
  assert.deepEqual(labelsOf(el), ['Check out', 'Copy command']);
});

test('pill, sidebar rows, history badges', () => {
  const run = { instanceId: 'i', runId: 'ab12cd34', member: 'app-0cea65fb', label: 'Run', kind: 'service', status: 'ready', ports: { PORT: 4417 }, url: 'http://localhost:4417' };
  assert.equal(renderRunPill([run], { doc }).textContent, 'Run :4417');
  assert.equal(renderRunPill([], { doc }), null);
  assert.equal(renderRunPill([{ ...run, ports: {} }], { doc }).textContent, 'Run');   // no port variable
  assert.deepEqual(historyActionBadges({ id: 'ab12cd34', checkout: null }, [{ ...run, ports: {} }]).map((b) => b.text), ['Running']);
  const rows = renderRunningActionRows([run], { doc, titleOf: () => 'Fix login' });
  assert.equal(rows.querySelector('.act-srow-name').textContent, 'Fix login · Run :4417');
  assert.doesNotMatch(rows.textContent, /Running actions/, 'no header row');
  assert.deepEqual(historyActionBadges({ id: 'ab12cd34', checkout: { members: [{ policy: 'on-success' }, { policy: 'on-success' }] } }, [run]).map((b) => b.text),
    ['Running :4417', '2 checked out', 'Kept · on success']);
  assert.equal(formatUptime(3_723_000), '1h 2m');
  assert.equal(renderOverviewStrip(undefined, { doc }), null);
  assert.deepEqual(historyActionBadges({ id: 'x', checkout: { members: [{ policy: 'on-demand' }] } }, []).map((b) => b.text), ['Checked out']);
  assert.deepEqual(historyActionBadges({ id: 'x', checkout: { members: [{ policy: 'until-pr' }] } }, []).map((b) => b.text), ['Checked out', 'Kept · until PR']);
  assert.deepEqual(historyActionBadges({ id: 'x' }, []), []);
});

// ── Beyond the plan's pinned cases: the remaining renderers and the controller ──

test('handlers receive the member and action ids', () => {
  const calls = [];
  const handlers = { onStart: (m, a) => calls.push(['start', m, a]), onBuiltin: (m, k) => calls.push(['builtin', m, k]),
    onCopy: (t) => calls.push(['copy', t]), onDiscard: (ms) => calls.push(['discard', ms]) };
  const el = renderActionsCard(model(member({ checkout: { setup: { status: 'ok' } } })), { doc, handlers });
  const click = (label) => [...el.querySelectorAll('button')].find((b) => b.textContent === label).click();
  click('Test'); click('VS Code'); click('Copy command'); click('Discard');
  assert.deepEqual(calls, [['start', 'app-0cea65fb', 'test'], ['builtin', 'app-0cea65fb', 'editor'],
    ['copy', 'cd "/p"\ngit switch worca-cc/x'], ['discard', ['app-0cea65fb']]]);
});

test('workspace: member checkboxes, "Check out selected", stack rows', () => {
  const api = member({ projectKey: 'api-1a2b3c4d', projectName: 'api' });
  const web = member({ projectKey: 'web-5e6f7a8b', projectName: 'web' });
  const m = { ...model(api), workspace: true, members: [api, web], stacks: [{ id: 'dev', label: 'Dev stack', kind: 'service' }],
    stackStates: [{ runId: 'ab', stackId: 'dev', status: 'running' }] };
  const got = [];
  const el = renderActionsCard(m, { doc, handlers: { onCheckout: (ms) => got.push(ms), onStack: (id, op) => got.push([id, op]) } });
  assert.equal(el.querySelectorAll('.act-members input[type="checkbox"]').length, 2);
  el.querySelectorAll('.act-members input[type="checkbox"]')[1].checked = false;
  [...el.querySelectorAll('button')].find((b) => b.textContent === 'Check out selected').click();
  [...el.querySelectorAll('button')].find((b) => b.textContent === 'Stop stack').click();
  assert.deepEqual(got, [['api-1a2b3c4d'], ['dev', 'stop']]);
  assert.equal(el.querySelectorAll('section.act-card').length, 2);
  assert.equal(labelsOf(el).filter((t) => t === 'Check out').length, 0);
});

test('overview strip: Check out, then open link + Stop while a service runs; null without a branch', () => {
  const calls = [];
  const handlers = { onCheckout: () => calls.push('checkout'), onStop: (m, a) => calls.push(['stop', m, a]), onOpenTab: () => calls.push('tab') };
  const a = renderOverviewStrip(model(member()), { doc, handlers });
  assert.deepEqual(labelsOf(a), ['Check out', 'Open tab ›']);
  a.querySelector('button').click();
  const run = { instanceId: 'i', member: 'app-0cea65fb', actionId: 'run', label: 'Run', kind: 'service', status: 'ready', ports: { PORT: 4417 }, url: 'http://localhost:4417' };
  const b = renderOverviewStrip(model(member({ checkout: { setup: { status: 'ok' } } }), [run]), { doc, handlers });
  assert.equal(b.querySelector('a.act-open').textContent, 'Open :4417');
  [...b.querySelectorAll('button')].find((x) => x.textContent === 'Stop').click();
  [...b.querySelectorAll('button')].find((x) => x.textContent === 'Open tab ›').click();
  assert.deepEqual(calls, ['checkout', ['stop', 'app-0cea65fb', 'run'], 'tab']);
  assert.equal(renderOverviewStrip(model(member({ branch: null })), { doc, handlers }), null);
});

test('running action rows: null when nothing runs; one row per running service with a square Stop and the uptime in its title', () => {
  assert.equal(renderRunningActionRows([], { doc }), null);
  const now = Date.now();
  const run = { instanceId: 'i', runId: 'ab12cd34', member: 'app-0cea65fb', label: 'Run', kind: 'service', status: 'ready', ports: { PORT: 4417 }, startedAt: now - 5000 };
  const gone = { ...run, instanceId: 'j', status: 'exited' };
  const got = [];
  const rows = renderRunningActionRows([run, gone], { doc, now, titleOf: (s) => s.runId, onStop: (s) => got.push(['stop', s.instanceId]), onOpen: (s) => got.push(['open', s.runId]) });
  assert.equal(rows.querySelectorAll('.act-srow').length, 1, 'only running services get a row');
  const row = rows.querySelector('.act-srow');
  assert.equal(row.dataset.instanceId, 'i');
  assert.deepEqual([...row.children].map((c) => c.className), ['pdot', 'act-srow-name', 'act-stop']);
  assert.equal(row.title, 'ab12cd34 · Run :4417 · up 5s');
  const stop = row.querySelector('button.act-stop');
  assert.equal(stop.getAttribute('aria-label'), 'Stop Run and free its port');
  assert.equal(stop.title, 'Stop Run and free its port');
  assert.equal(stop.textContent, '', 'an icon button: the square glyph, no word');
  stop.click();
  row.querySelector('button.act-srow-name').click();
  assert.deepEqual(got, [['stop', 'i'], ['open', 'ab12cd34']]);
  assert.equal(formatUptime(5000), '5s');
  assert.equal(formatUptime(65000), '1m 5s');
});

test('running action rows: a run with no saved row is plain text; menu:true marks the buttons as menu items for the rail flyout', () => {
  const run = { instanceId: 'i', runId: 'ab12cd34', label: 'Run', kind: 'service', status: 'running', ports: {}, histKey: null };
  const plain = renderRunningActionRows([run], { doc, onOpen: () => {} });
  assert.equal(plain.querySelector('.act-srow-name').tagName, 'SPAN', 'nowhere to open');
  assert.equal(plain.querySelector('.act-srow-name').textContent, 'ab12cd34 · Run', 'no port variable: no ":undefined"');
  assert.equal(plain.querySelector('.act-srow').title, 'ab12cd34 · Run', 'no startedAt: no uptime');
  const menu = renderRunningActionRows([{ ...run, histKey: 'k' }], { doc, onOpen: () => {}, menu: true });
  assert.equal(menu.querySelector('.act-srow').getAttribute('role'), 'none');
  assert.equal(menu.querySelector('.act-srow-name').getAttribute('role'), 'menuitem');
  assert.equal(menu.querySelector('.act-stop').getAttribute('role'), 'menuitem');
  assert.equal(renderRunningActionRows([run], { doc }).querySelector('.act-stop').hasAttribute('role'), false);
});

function fakeApi(routes) {
  const calls = [];
  const api = async (method, url, body) => {
    calls.push([method, url, body]);
    const r = routes(method, url, body, calls);
    return r || { ok: true, status: 200, data: {} };
  };
  return { api, calls };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test('controller: refresh renders, subscribes every instance, dedupes frames, appends log lines in place', async () => {
  const run = { instanceId: 'act:ab:app-0cea65fb:run', runId: 'ab', member: 'app-0cea65fb', actionId: 'run', label: 'Run', kind: 'service', status: 'ready', ports: { PORT: 4417 }, url: 'http://localhost:4417', startedAt: Date.now() };
  const m = model(member({ checkout: { setup: { status: 'ok' } } }), [run]);
  const { api } = fakeApi((method, url) => (method === 'GET' ? { ok: true, status: 200, data: m } : null));
  const sent = []; const models = [];
  const host = doc.createElement('div');
  const ctl = createActionsController({ runId: 'ab', scopeQuery: 'projectKey=app', api, ws: { send: (o) => sent.push(o) }, host, doc,
    confirm: async () => true, navigate: () => {}, onModel: (x) => models.push(x) });
  assert.equal(ctl.runId, 'ab');
  await ctl.refresh();
  assert.deepEqual(sent, [{ type: 'subscribe', instanceId: run.instanceId }]);
  assert.equal(models.length, 1);
  assert.ok(labelsOf(host).includes('Stop Run'));
  const pre = host.querySelector('pre.act-log');
  assert.equal(pre.dataset.instanceId, run.instanceId);
  ctl.onFrame({ type: 'action-line', instanceId: run.instanceId, stream: 'out', text: 'listening', seq: 1 });
  ctl.onFrame({ type: 'action-line', instanceId: run.instanceId, stream: 'out', text: 'listening', seq: 1 });   // replay duplicate
  ctl.onFrame({ type: 'action-line', instanceId: 'act:other:x:run', stream: 'out', text: 'not mine', seq: 2 });
  assert.equal(host.querySelector('pre.act-log'), pre, 'no re-render on a line');
  assert.equal(pre.textContent, 'listening\n');
  ctl.onFrame({ type: 'action-status', instanceId: run.instanceId, snapshot: { ...run, status: 'stopped' }, seq: 2 });
  assert.ok(labelsOf(host).includes('Run'));
  assert.match(host.querySelector('pre.act-log').textContent, /listening/, 'the tail survives a re-render');
  ctl.destroy();
  assert.equal(host.childNodes.length, 0);
});

test('controller: 202 start subscribes at once and shows "Starts after setup"', async () => {
  const m = model(member({ checkout: { setup: { status: 'pending' } } }));
  const { api, calls } = fakeApi((method) => (method === 'GET' ? { ok: true, status: 200, data: m }
    : { ok: true, status: 202, data: { queued: true, instanceId: 'act:ab:app-0cea65fb:run' } }));
  const sent = [];
  const host = doc.createElement('div');
  const ctl = createActionsController({ runId: 'ab', scopeQuery: 'projectKey=app', api, ws: { send: (o) => sent.push(o) }, host, doc,
    confirm: async () => true, navigate: () => {}, onModel: () => {} });
  await ctl.refresh();
  [...host.querySelectorAll('button')].find((b) => b.textContent === 'Run').click();
  await tick(); await tick();
  assert.deepEqual(calls[1], ['POST', '/api/runs/ab/actions/run/start?projectKey=app', { member: 'app-0cea65fb' }]);
  assert.deepEqual(sent.at(-1), { type: 'subscribe', instanceId: 'act:ab:app-0cea65fb:run' });
  assert.ok(labelsOf(host).includes('Starts after setup'));
  ctl.destroy();
});

test('controller: a queued start that cannot start leaves "Starts after setup"', async () => {
  // While setup runs the start waits; once setup settled with no instance for it, a refresh drops the wait.
  let m = model(member({ checkout: { setup: { status: 'pending' } } }));   // a kept checkout: setup not run yet
  const { api } = fakeApi((method) => (method === 'GET' ? { ok: true, status: 200, data: m }
    : { ok: true, status: 202, data: { queued: true, instanceId: 'act:ab:app-0cea65fb:run' } }));
  const host = doc.createElement('div');
  const ctl = createActionsController({ runId: 'ab', scopeQuery: 'projectKey=app', api, ws: { send: () => {} }, host, doc,
    confirm: async () => true, navigate: () => {}, onModel: () => {} });
  await ctl.refresh();
  [...host.querySelectorAll('button')].find((b) => b.textContent === 'Run').click();
  await tick(); await tick();
  m = model({ ...member({ checkout: { setup: { status: 'running' } } }), setupQueued: true });
  await ctl.refresh();
  assert.equal(host.querySelector('section.act-card').dataset.state, 'setting-up');
  m = model({ ...member({ checkout: { setup: { status: 'ok' } } }), setupQueued: false });   // e.g. no free port
  await ctl.refresh();
  assert.ok(!labelsOf(host).includes('Starts after setup'));
  assert.ok(labelsOf(host).includes('Run'));
  ctl.destroy();

  // The server's snapshot-less status frame clears the wait at once and shows why.
  m = model(member({ checkout: { setup: { status: 'pending' } } }));
  const host2 = doc.createElement('div');
  const ctl2 = createActionsController({ runId: 'ab', scopeQuery: 'projectKey=app', api, ws: { send: () => {} }, host: host2, doc,
    confirm: async () => true, navigate: () => {}, onModel: () => {} });
  await ctl2.refresh();
  [...host2.querySelectorAll('button')].find((b) => b.textContent === 'Run').click();
  await tick(); await tick();
  ctl2.onFrame({ type: 'action-status', instanceId: 'act:ab:app-0cea65fb:run', snapshot: null, error: 'Not started: no free port in 4400-4499', seq: 1 });
  assert.ok(!labelsOf(host2).includes('Starts after setup'));
  assert.match(host2.textContent, /Not started: no free port/);
  ctl2.destroy();
});

test('controller: Discard confirms, and SNAPSHOT_FAILED asks again before force', async () => {
  const m = model(member({ checkout: { setup: { status: 'ok' } } }));
  let deletes = 0;
  const { api, calls } = fakeApi((method) => {
    if (method === 'GET') return { ok: true, status: 200, data: m };
    if (method === 'DELETE') return ++deletes === 1 ? { ok: false, status: 409, data: { code: 'SNAPSHOT_FAILED', error: 'x' } } : { ok: true, status: 200, data: { removed: ['app-0cea65fb'] } };
    return null;
  });
  const asked = [];
  const host = doc.createElement('div');
  const ctl = createActionsController({ runId: 'ab', scopeQuery: 'projectKey=app', api, ws: { send: () => {} }, host, doc,
    confirm: async (o) => { asked.push(o.title); return true; }, navigate: () => {}, onModel: () => {} });
  await ctl.refresh();
  [...host.querySelectorAll('button')].find((b) => b.textContent === 'Discard').click();
  for (let i = 0; i < 6; i++) await tick();
  assert.equal(asked.length, 2);
  assert.equal(asked[0], 'Discard the checkout?');
  const dels = calls.filter((c) => c[0] === 'DELETE');
  assert.deepEqual(dels.map((c) => c[2]), [{ members: ['app-0cea65fb'] }, { members: ['app-0cea65fb'], force: true }]);
  ctl.destroy();
});

test('controller: a declined Discard sends nothing', async () => {
  const m = model(member({ checkout: { setup: { status: 'ok' } } }));
  const { api, calls } = fakeApi((method) => (method === 'GET' ? { ok: true, status: 200, data: m } : null));
  const host = doc.createElement('div');
  const ctl = createActionsController({ runId: 'ab', scopeQuery: 'projectKey=app', api, ws: { send: () => {} }, host, doc,
    confirm: async () => false, navigate: () => {}, onModel: () => {} });
  await ctl.refresh();
  [...host.querySelectorAll('button')].find((b) => b.textContent === 'Discard').click();
  for (let i = 0; i < 4; i++) await tick();
  assert.equal(calls.some((c) => c[0] === 'DELETE'), false);
  ctl.destroy();
});

test('middleClip keeps both ends', async () => {
  const { middleClip } = await import('../ui/public/actions-view.mjs');
  assert.equal(middleClip('short'), 'short');
  const c = middleClip('a'.repeat(40) + 'END', 20);
  assert.equal(c.length, 20);
  assert.ok(c.startsWith('aaaa') && c.endsWith('END') && c.includes('…'));
});

test('controller: Terminal before Check out asks, then checks out this member and opens it; Cancel does nothing', async () => {
  const m = model(member());
  const { api, calls } = fakeApi((method) => (method === 'GET' ? { ok: true, status: 200, data: m } : null));
  const asked = [];
  let answer = false;
  const host = doc.createElement('div');
  const ctl = createActionsController({ runId: 'ab', scopeQuery: 'projectKey=app', api, ws: { send: () => {} }, host, doc,
    confirm: async (o) => { asked.push(o); return answer; }, navigate: () => {} });
  await ctl.refresh();
  const click = () => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Terminal').click();
  click(); await tick(); await tick();
  assert.equal(asked[0].title, 'Check out to open Terminal?');
  assert.deepEqual(asked[0].message, ["Terminal opens the run's checkout, which doesn't exist yet. Worca checks out ", { strong: 'worca-cc/x' },
    ' first (a few seconds), then opens Terminal.', ' Then the setup command runs: ', { strong: 'npm ci' }], 'the branch and the setup command are bold');
  assert.equal(asked[0].confirmLabel, 'Check out and open');
  assert.ok(!calls.some((c) => c[0] === 'POST'), 'cancel: nothing posted');
  answer = true;
  click(); for (let i = 0; i < 6; i++) await tick();
  const posts = calls.filter((c) => c[0] === 'POST');
  assert.deepEqual(posts.map((c) => [c[1], c[2]]), [
    ['/api/runs/ab/checkout?projectKey=app', { members: ['app-0cea65fb'] }],
    ['/api/runs/ab/builtins/terminal?projectKey=app', { member: 'app-0cea65fb' }],
  ]);
  ctl.destroy();
});

// ---------------------------------------------------------------------------
// The branch is already checked out in the person's own folder (heldBy / a linked checkout)
// ---------------------------------------------------------------------------

test('a linked folder: "Your folder" badge and Unlink instead of Discard', () => {
  const m = member({ checkout: { external: true, worktreeDir: '/Users/ada/dev/app', setup: { status: 'skipped' } } });
  const el = renderActionsCard(model(m), { doc, handlers: {} });
  assert.equal(el.querySelector('.act-linked').textContent, 'Your folder');
  const labels = labelsOf(el);
  assert.ok(labels.includes('Unlink') && !labels.includes('Discard'));
  assert.ok(labels.includes('Run setup'), 'setup did not run by itself; it stays one click away');
});

test('controller: Use that folder confirms, links with useExisting; Terminal before it links then opens; Unlink deletes the link', async () => {
  const held = model(member({ heldBy: '/Users/ada/dev/app' }));
  const { api, calls } = fakeApi((method) => (method === 'GET' ? { ok: true, status: 200, data: held } : null));
  const asked = [];
  const host = doc.createElement('div');
  const ctl = createActionsController({ runId: 'ab', scopeQuery: 'projectKey=app', api, ws: { send: () => {} }, host, doc,
    confirm: async (o) => { asked.push(o); return true; }, navigate: () => {} });
  await ctl.refresh();
  const press = async (label) => { [...host.querySelectorAll('button')].find((b) => b.textContent === label).click(); for (let i = 0; i < 6; i++) await tick(); };
  await press('Use that folder');
  assert.equal(asked[0].title, 'Use the folder that has this branch?');
  assert.deepEqual(asked[0].message[1], { strong: '/Users/ada/dev/app' });
  await press('Terminal');
  assert.equal(asked[1].title, 'Open Terminal in your folder?');
  assert.equal(asked[1].confirmLabel, 'Use it and open Terminal');
  const posts = calls.filter((c) => c[0] === 'POST').map((c) => [c[1], c[2]]);
  assert.deepEqual(posts, [
    ['/api/runs/ab/checkout?projectKey=app', { members: ['app-0cea65fb'], useExisting: true }],
    ['/api/runs/ab/checkout?projectKey=app', { members: ['app-0cea65fb'], useExisting: true }],
    ['/api/runs/ab/builtins/terminal?projectKey=app', { member: 'app-0cea65fb' }],
  ]);
  ctl.destroy();

  const linked = model(member({ checkout: { external: true, worktreeDir: '/Users/ada/dev/app', setup: { status: 'skipped' } } }));
  const two = fakeApi((method) => (method === 'GET' ? { ok: true, status: 200, data: linked } : null));
  const host2 = doc.createElement('div');
  const asked2 = [];
  const ctl2 = createActionsController({ runId: 'ab', scopeQuery: 'projectKey=app', api: two.api, ws: { send: () => {} }, host: host2, doc,
    confirm: async (o) => { asked2.push(o); return true; }, navigate: () => {} });
  await ctl2.refresh();
  [...host2.querySelectorAll('button')].find((b) => b.textContent === 'Unlink').click();
  for (let i = 0; i < 6; i++) await tick();
  assert.equal(asked2[0].title, 'Stop using this folder?');
  assert.ok(!asked2[0].danger, 'nothing is deleted');
  assert.deepEqual(two.calls.filter((c) => c[0] === 'DELETE').map((c) => [c[1], c[2]]), [['/api/runs/ab/checkout?projectKey=app', { members: ['app-0cea65fb'] }]]);
  ctl2.destroy();
});

test('controller: a Check out refused because the branch is held elsewhere refreshes into "Use that folder", with no red error', async () => {
  let current = model(member());
  const { api } = fakeApi((method) => (method === 'GET' ? { ok: true, status: 200, data: current }
    : method === 'POST' ? (current = model(member({ heldBy: '/Users/ada/dev/app' })), { ok: false, status: 409, data: { code: 'BRANCH_CHECKED_OUT', error: 'x', holder: '/Users/ada/dev/app' } }) : null));
  const host = doc.createElement('div');
  const ctl = createActionsController({ runId: 'ab', scopeQuery: 'projectKey=app', api, ws: { send: () => {} }, host, doc, confirm: async () => true, navigate: () => {} });
  await ctl.refresh();
  [...host.querySelectorAll('button')].find((b) => b.textContent === 'Check out').click();
  for (let i = 0; i < 6; i++) await tick();
  assert.equal(host.querySelector('.act-notice'), null);
  assert.ok(labelsOf(host).includes('Use that folder'));
  ctl.destroy();
});

test('Run setup shows only when setup was skipped AND the project has a setup command', () => {
  const linked = { external: true, worktreeDir: '/Users/ada/dev/app', setup: { status: 'skipped' } };
  assert.ok(labelsOf(renderActionsCard(model(member({ checkout: linked })), { doc, handlers: {} })).includes('Run setup'));
  assert.ok(!labelsOf(renderActionsCard(model(member({ checkout: linked, setup: null })), { doc, handlers: {} })).includes('Run setup'),
    'no setup command: nothing to run, no button');
  assert.ok(!labelsOf(renderActionsCard(model(member({ checkout: { setup: { status: 'ok' } } })), { doc, handlers: {} })).includes('Run setup'),
    'setup already ran: no button');
});
