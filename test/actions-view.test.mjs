// test/actions-view.test.mjs — pure jsdom tests for the Actions renderers (issue #529).
// No app.js boot: every renderer takes `doc` explicitly and returns detached DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { memberViewState, renderActionsCard, renderOverviewStrip, renderRunPill, renderShipItStrip, shipItTryState,
  renderRunningActionRows, historyActionBadges, formatUptime, isSafeHref, createActionsController, releaseCheckout,
  isChangedMember, defaultPicks, DEFAULT_PICK_LIMIT } from '../ui/public/actions-view.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
/** Stub the clipboard; returns the writes. `fail` refuses every write (and jsdom has no execCommand fallback). */
const stubClipboard = (fail = false) => {
  const writes = [];
  Object.defineProperty(doc.defaultView.navigator, 'clipboard', { configurable: true,
    value: { writeText: async (t) => { if (fail) throw new Error('denied'); writes.push(t); } } });
  return writes;
};
const member = (over = {}) => ({ projectKey: 'app-0cea65fb', projectName: 'app', branch: 'worca-cc/x', worktreeDir: '/h/runs/ab/repos/app-0cea65fb',
  checkout: null, copyCommand: 'cd "/p"\ngit switch worca-cc/x', setup: 'npm ci',
  state: 'not-checked-out', affected: true, files: 3, added: 40, removed: 2, workMode: 'git',
  actions: [{ id: 'run', label: 'Run', kind: 'service' }, { id: 'test', label: 'Test', kind: 'task' }],
  builtins: [{ key: 'editor', label: 'VS Code' }, { key: 'terminal', label: 'Terminal' }, { key: 'fileManager', label: 'Finder' }, { key: 'copyCommand', label: 'Copy command' }], ...over });
const model = (m, instances = []) => ({ enabled: true, finished: true, workspace: false, estimate: { lastSetupMs: 42000 }, members: [m], stacks: [], stackStates: [], instances });
const wsModel = (members, over = {}) => ({ ...model(members[0]), workspace: true, members, stacks: [], stackStates: [],
  totals: { members: members.length, changed: members.filter((m) => m.affected !== false).length,
    files: 0, added: 0, removed: 0 }, ...over });
const rows = (el) => [...el.querySelectorAll('.act-table tbody tr')];
const footBtn = (el) => [...el.querySelectorAll('.act-co-foot button')][0];
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

test('handlers receive the member and action ids; Copy command copies by itself (the labelled-action copy button)', async () => {
  const calls = [];
  const writes = stubClipboard();
  const handlers = { onStart: (m, a) => calls.push(['start', m, a]), onBuiltin: (m, k) => calls.push(['builtin', m, k]),
    onCopyFailed: (w, t) => calls.push(['copy-failed', w, t]), onDiscard: (ms) => calls.push(['discard', ms]) };
  const el = renderActionsCard(model(member({ checkout: { setup: { status: 'ok' } } })), { doc, handlers });
  const click = (label) => [...el.querySelectorAll('button')].find((b) => b.textContent === label).click();
  click('Test'); click('VS Code'); click('Copy command'); click('Discard');
  await tick();
  assert.deepEqual(calls, [['start', 'app-0cea65fb', 'test'], ['builtin', 'app-0cea65fb', 'editor'], ['discard', ['app-0cea65fb']]]);
  assert.deepEqual(writes, ['cd "/p"\ngit switch worca-cc/x']);
  const copy = el.querySelector('.copy-btn-action');
  assert.ok(copy.classList.contains('copy-btn') && !copy.classList.contains('btn-quiet'), 'a secondary button like its row');
  assert.ok(copy.classList.contains('copied'));
  assert.equal(copy.querySelector('.copy-btn-msg').textContent, 'Copied');
});

test('a refused copy reaches the controller with what and the text (for the card notice)', async () => {
  stubClipboard(true);
  const calls = [];
  const el = renderActionsCard(model(member({ checkout: { setup: { status: 'ok' } } })), { doc, handlers: { onCopyFailed: (w, t) => calls.push([w, t]) } });
  el.querySelector('.act-copy[aria-label="Copy branch name"]').click();
  await tick();
  assert.deepEqual(calls, [['branch name', 'worca-cc/x']]);
  assert.ok(el.querySelector('.act-copy[aria-label="Copy branch name"]').classList.contains('copy-miss'));
});

test('workspace: the checkout table posts only the ticked members, and a stack row still stops', () => {
  const api = member({ projectKey: 'api-1a2b3c4d', projectName: 'api' });
  const web = member({ projectKey: 'web-5e6f7a8b', projectName: 'web' });
  const m = { ...wsModel([api, web]), stacks: [{ id: 'dev', label: 'Dev stack', kind: 'service' }],
    stackStates: [{ runId: 'ab', stackId: 'dev', status: 'running' }] };
  const got = [];
  const el = renderActionsCard(m, { doc, picked: new Set(['api-1a2b3c4d']),
    handlers: { onCheckout: (ms) => got.push(ms), onStack: (id, op) => got.push([id, op]) } });
  assert.deepEqual(rows(el).map((r) => r.dataset.member), ['api-1a2b3c4d', 'web-5e6f7a8b']);
  footBtn(el).click();
  [...el.querySelectorAll('button')].find((b) => b.textContent === 'Stop stack').click();
  assert.deepEqual(got, [['api-1a2b3c4d'], ['dev', 'stop']]);
  assert.equal(el.querySelectorAll('section.act-card').length, 0, 'no per-member cards on a workspace run');
  assert.equal(labelsOf(el).filter((t) => t === 'Check out').length, 0);
});

test('workspace: only changed members get a row; the rest fold into one line', () => {
  const api = member({ projectKey: 'api-1', projectName: 'api', branch: 'b/api' });
  const web = member({ projectKey: 'web-2', projectName: 'web', branch: 'b/web', affected: false, files: 0, added: 0, removed: 0 });
  const none = member({ projectKey: 'lib-3', projectName: 'lib', branch: null, state: 'no-branch', affected: false });
  const el = renderActionsCard(wsModel([api, web, none]), { doc });
  assert.deepEqual(rows(el).map((r) => r.dataset.member), ['api-1'], 'one row, the changed member');
  assert.equal(el.querySelectorAll('.act-members').length, 0, 'the old checkbox strip is gone');
  assert.equal(el.querySelectorAll('section.act-card').length, 0, 'no per-member cards on a workspace run');
  const fold = el.querySelector('.act-fold');
  assert.match(fold.querySelector('summary').textContent, /^2 projects had no changes$/);
  const names = [...fold.querySelectorAll('.act-fold-names span')].map((s) => s.textContent);
  assert.deepEqual(names, ['web', '+1 with no branch'], 'a no-branch member is counted, not named');
  assert.equal(fold.querySelectorAll('button, a, input').length, 0, 'nothing inside the fold is clickable');
});

test('workspace: select-all counts only changed members, and the footer button tracks the selection', () => {
  const ms = [member({ projectKey: 'a', projectName: 'a', branch: 'b/a' }), member({ projectKey: 'b', projectName: 'b', branch: 'b/b' }),
    member({ projectKey: 'c', projectName: 'c', branch: 'b/c', affected: false })];
  let picked = defaultPicks(ms.filter(isChangedMember));
  const draw = () => renderActionsCard(wsModel(ms), { doc, picked, onPick: (n) => { picked = n; } });
  let el = draw();
  assert.equal(el.querySelectorAll('.act-table tbody .act-cb').length, 2, 'no checkbox for the unchanged member');
  assert.equal(footBtn(el).textContent, 'Check out 2 projects');
  const all = el.querySelector('thead .act-cb');
  assert.equal(all.checked, true);
  all.checked = false; all.dispatchEvent(new doc.defaultView.Event('change'));
  assert.equal(picked.size, 0);
  el = draw();
  assert.equal(footBtn(el).textContent, 'Check out');
  assert.equal(footBtn(el).disabled, true);
  const one = el.querySelector('.act-table tbody .act-cb');
  one.checked = true; one.dispatchEvent(new doc.defaultView.Event('change'));
  assert.equal(draw().querySelector('.act-co-foot button').textContent, 'Check out 1 project');
});

test('workspace: exactly one changed member has no checkbox column; the button names it', () => {
  const ms = [member({ projectKey: 'a', projectName: 'alpha', branch: 'b/a' }), member({ projectKey: 'b', affected: false })];
  const el = renderActionsCard(wsModel(ms), { doc, picked: new Set(['a']) });
  assert.equal(el.querySelectorAll('.act-cb').length, 0, 'no checkboxes and no select-all');
  assert.equal(footBtn(el).textContent, 'Check out alpha');
});

test('legacy rows (affected absent or null) still render as changed', () => {
  const ms = [member({ projectKey: 'a', branch: 'b/a', affected: null, files: null, added: null, removed: null }),
    member({ projectKey: 'b', branch: 'b/b', affected: undefined })];
  const el = renderActionsCard(wsModel(ms), { doc, picked: new Set(['a', 'b']) });
  assert.equal(rows(el).length, 2);
  assert.equal(el.querySelector('.act-fold'), null, 'nothing folds away');
  const cells = [...rows(el)[0].querySelectorAll('td')].map((td) => td.textContent.trim());
  assert.ok(cells.includes('—'), 'an unknown count shows as an em dash, not 0');
});

test('a run still in progress shows the table with its checkboxes disabled', () => {
  const ms = [member({ projectKey: 'a', branch: 'b/a' }), member({ projectKey: 'b', branch: 'b/b' })];
  const el = renderActionsCard(wsModel(ms, { finished: false, runStatus: 'running' }), { doc, picked: new Set(['a']) });
  assert.equal(rows(el).length, 2, 'the table still shows');
  assert.ok([...el.querySelectorAll('.act-cb')].every((c) => c.disabled));
  assert.equal(el.querySelector('.act-co-foot').textContent, 'Check out is available once the run has finished.');
  assert.equal(el.querySelector('.act-co-foot button'), null);
});

test('open-in buttons appear only on a row that is checked out; Discard is never the loud button', () => {
  const pend = member({ projectKey: 'a', projectName: 'a', branch: 'b/a' });
  const done = member({ projectKey: 'b', projectName: 'b', branch: 'b/b', checkout: { worktreeDir: '/w/b', setup: { status: 'ok' } } });
  const el = renderActionsCard(wsModel([pend, done]), { doc, picked: new Set(['a']), handlers: { onDiff: () => {} } });
  const row = el.querySelector('.act-wt-row[data-member="b"]');
  assert.deepEqual([...row.querySelectorAll('.act-wt-acts button:not(.act-copy)')].map((b) => b.textContent),
    ['Run', 'Test', 'VS Code', 'Terminal', 'Finder', 'Download patch', 'Discard']);
  assert.ok(row.querySelector('.act-discard').classList.contains('btn-quiet'), 'Discard is quiet');
  assert.ok(row.querySelector('.act-path'), 'the checked-out row shows its folder');
  // the pending row offers none of them
  assert.equal(el.querySelector('.act-table tbody tr[data-member="a"] button:not(.act-copy)'), null);
});

test('an unchanged member that is checked out keeps its row, and the fold never claims it', () => {
  // Reachable without a stale page: Ship It's "Try it first" posts `{}`, which is exempt from the 409 guard
  // and checks out every member, and a stack step checks its own member out.
  const cold = member({ projectKey: 'b', projectName: 'b', branch: 'b/b', affected: false, files: 0, added: 0, removed: 0,
    checkout: { worktreeDir: '/w/b', setup: { status: 'ok' } } });
  const hot = member({ projectKey: 'a', projectName: 'a', branch: 'b/a' });
  const el = renderActionsCard(wsModel([hot, cold]), { doc, picked: new Set(['a']), handlers: { onDiff: () => {} } });
  const row = el.querySelector('.act-wt-row[data-member="b"]');
  assert.ok(row, 'the checkout has a row even though the run did not change it');
  assert.deepEqual([...row.querySelectorAll('.act-wt-acts button:not(.act-copy)')].map((b) => b.textContent),
    ['Run', 'Test', 'VS Code', 'Terminal', 'Finder', 'Download patch', 'Discard'], 'Discard reaches the folder');
  assert.equal(el.querySelector('.act-fold'), null, 'it is not also listed as "had no changes"');
  assert.equal(rows(el).some((r) => r.dataset.member === 'b'), false, 'and it is not offered for checkout again');
  // Even when the run changed nothing at all, the checkout is not swallowed by the empty state.
  const solo = renderActionsCard(wsModel([cold]), { doc });
  assert.ok(solo.querySelector('.act-wt-row[data-member="b"]'));
  assert.equal(solo.querySelector('.act-co-empty'), null);
});

test('single-project, unchanged: the open-in buttons are gone, not a dialog that leads nowhere', () => {
  const seen = [];
  const el = renderActionsCard(model(member({ affected: false, files: 0, added: 0, removed: 0 })),
    { doc, handlers: { onOpenBeforeCheckout: (...a) => seen.push(a), onBuiltin: (...a) => seen.push(a) } });
  assert.deepEqual(labelsOf(el), ['Copy command'], 'Copy command is the only button left');
  assert.doesNotMatch(el.textContent, /Check out takes/, 'and no estimate for a checkout that cannot happen');
  assert.deepEqual(seen, [], 'nothing was wired to a checkout the server refuses');
});

test('the footer never offers a checkout the server would refuse, and never ignores a checkbox', () => {
  // The one row is held in a folder of your own: a plain checkout of it is 409 BRANCH_CHECKED_OUT, which the
  // client refreshes away quietly — so there must be no primary button at all, only the row's own offer.
  const held = member({ projectKey: 'a', projectName: 'alpha', branch: 'b/a', heldBy: '/Users/ada/dev/a' });
  const one = renderActionsCard(wsModel([held]), { doc, picked: defaultPicks([held]) });
  assert.deepEqual([...one.querySelectorAll('.act-co-foot button')].map((b) => b.textContent), ['Copy git commands'],
    'no "Check out alpha" that would do nothing');
  assert.match(one.querySelector('tr[data-member="a"]').textContent, /Use that folder/);
  // A Folder member next to one real row: no checkbox column, and the button names that row.
  const git = member({ projectKey: 'g', projectName: 'g', branch: 'b/g' });
  const copy = member({ projectKey: 'f', projectName: 'f', branch: null, state: 'no-branch', workMode: 'folder', affected: true, files: 2 });
  const got = [];
  const el = renderActionsCard(wsModel([git, copy]), { doc, picked: new Set(), handlers: { onCheckout: (ms) => got.push(ms) } });
  assert.equal(el.querySelectorAll('.act-cb').length, 0, 'one pickable row needs no checkbox');
  assert.equal(footBtn(el).textContent, 'Check out g');
  footBtn(el).click();
  assert.deepEqual(got, [['g']]);
  // Two pickable rows and a Folder member: the button posts the ticked ones, never the unticked one.
  const g2 = member({ projectKey: 'g2', projectName: 'g2', branch: 'b/g2' });
  const sent = [];
  const el2 = renderActionsCard(wsModel([git, g2, copy]), { doc, picked: new Set(['g2']), handlers: { onCheckout: (ms) => sent.push(ms) } });
  assert.equal(el2.querySelectorAll('.act-table tbody .act-cb').length, 2, 'no checkbox for the Folder member');
  footBtn(el2).click();
  assert.deepEqual(sent, [['g2']]);
});

test('a long card collapses its checked-out rows to one line, and Show opens one again', () => {
  const svc = { instanceId: 'i', member: 'c1', actionId: 'run', kind: 'service', status: 'ready', ports: { PORT: 4417 }, url: 'http://localhost:4417', startedAt: 0 };
  const ms = Array.from({ length: 10 }, (_, i) => member({ projectKey: `p${i}`, projectName: `p${i}`, branch: `b/${i}` }));
  ms[0] = member({ projectKey: 'c0', projectName: 'c0', branch: 'b/c0', checkout: { worktreeDir: '/w/c0', setup: { status: 'ok' } } });
  ms[1] = member({ projectKey: 'c1', projectName: 'c1', branch: 'b/c1', checkout: { worktreeDir: '/w/c1', setup: { status: 'ok' } } });
  let expanded = new Set();
  const draw = () => renderActionsCard(wsModel(ms, { instances: [svc] }), { doc, picked: new Set(),
    expanded, onExpand: (k) => { expanded = new Set(expanded).add(k); }, handlers: { onDiff: () => {} } });
  let el = draw();
  const ready = el.querySelector('.act-wt-row[data-member="c0"]');
  const running = el.querySelector('.act-wt-row[data-member="c1"]');
  assert.equal(ready.querySelector('.act-wt-acts'), null, 'an idle row collapses to its one line');
  assert.ok(running.querySelector('.act-wt-acts'), 'a running service stays open');
  assert.equal(running.querySelector('.act-wt-toggle'), null, 'and has nothing to toggle');
  const show = ready.querySelector('.act-wt-toggle');
  assert.equal(show.textContent, 'Show');
  assert.equal(show.getAttribute('aria-expanded'), 'false');
  show.click();
  const open = draw().querySelector('.act-wt-row[data-member="c0"]');
  assert.deepEqual([...open.querySelectorAll('.act-wt-acts button:not(.act-copy)')].map((b) => b.textContent),
    ['Run', 'Test', 'VS Code', 'Terminal', 'Finder', 'Download patch', 'Discard'], 'everything is reachable again');
  assert.equal(open.querySelector('.act-wt-toggle').textContent, 'Hide');
});

test('the collapse starts at 10 rows (table + checkouts, unchanged checkouts included); a failed setup stays open', () => {
  const co = (k, over = {}) => member({ projectKey: k, projectName: k, branch: `b/${k}`, checkout: { worktreeDir: `/w/${k}`, setup: { status: 'ok' } }, ...over });
  const pend = (n) => Array.from({ length: n }, (_, i) => member({ projectKey: `p${i}`, projectName: `p${i}`, branch: `b/${i}` }));
  const toggles = (el) => el.querySelectorAll('.act-wt-toggle').length;
  // 9 rows: 7 in the table, 2 checked out. Nothing collapses, nothing to toggle.
  const nine = renderActionsCard(wsModel([...pend(7), co('c0'), co('c1')]), { doc, picked: new Set() });
  assert.equal(toggles(nine), 0);
  assert.equal(nine.querySelectorAll('.act-wt-row .act-wt-acts').length, 2, 'both checked-out rows are open');
  // 10 rows: 7 in the table, 3 checked out, one of them a member the run did not change (a stack step made
  // it): that one counts toward the 10 too.
  const failed = co('c2', { checkout: { worktreeDir: '/w/c2', setup: { status: 'failed', exitCode: 1 } } });
  const ten = renderActionsCard(wsModel([...pend(7), co('c0'), failed, co('u', { affected: false, files: 0, added: 0, removed: 0 })]),
    { doc, picked: new Set() });
  assert.equal(rows(ten).length + ten.querySelectorAll('.act-wt-row').length, 10);
  const row = (k) => ten.querySelector(`.act-wt-row[data-member="${k}"]`);
  assert.equal(row('c0').querySelector('.act-wt-acts'), null, 'ten rows: an idle row collapses');
  assert.equal(row('u').querySelector('.act-wt-acts'), null, 'so does the unchanged checkout');
  assert.ok(row('c2').querySelector('.act-exit.fail'), 'a failed setup stays open and says so');
  assert.equal(row('c2').querySelector('.act-wt-toggle'), null, 'with nothing to toggle');
});

test('a held branch is unticked by default and offers its folder; a Folder member never offers checkout', () => {
  const held = member({ projectKey: 'a', projectName: 'a', branch: 'b/a', heldBy: '/Users/ada/dev/a' });
  const copy = member({ projectKey: 'b', projectName: 'b', branch: null, state: 'no-branch', workMode: 'folder', affected: true, files: 2 });
  const changed = [held, copy].filter(isChangedMember);
  assert.deepEqual([...defaultPicks(changed)], [], 'neither is ticked by default');
  const el = renderActionsCard(wsModel([held, copy]), { doc, picked: defaultPicks(changed) });
  assert.deepEqual(rows(el).map((r) => r.dataset.member), ['a', 'b']);
  assert.match(el.querySelector('tr[data-member="a"]').textContent, /In your folder/);
  assert.match(el.querySelector('tr[data-member="a"]').textContent, /Use that folder/);
  assert.match(el.querySelector('tr[data-member="b"]').textContent, /On a copy/);
  assert.equal(el.querySelector('tr[data-member="b"] .act-cb'), null, 'a Folder member has no checkbox');
});

test('defaultPicks ticks at most five, and a stack row names the unchanged projects it uses', () => {
  const many = Array.from({ length: 7 }, (_, i) => member({ projectKey: `p${i}`, projectName: `p${i}`, branch: `b/${i}` }));
  assert.equal(defaultPicks(many).size, DEFAULT_PICK_LIMIT);
  assert.equal(defaultPicks(many.slice(0, 4)).size, 4, 'five or fewer: all ticked');
  const cold = member({ projectKey: 'cold', projectName: 'cold', branch: 'b/cold', affected: false });
  const m = wsModel([many[0], cold], { stacks: [{ id: 'dev', label: 'Dev stack', kind: 'service', steps: [{ member: 'p0', action: 'run' }, { member: 'cold', action: 'run' }] }] });
  const el = renderActionsCard(m, { doc, picked: new Set(['p0']) });
  assert.match(el.querySelector('.act-stack').textContent, /also uses 1 unchanged project/);
});

test('a workspace run that changed nothing says so and still folds the rest', () => {
  const ms = [member({ projectKey: 'a', affected: false }), member({ projectKey: 'b', affected: false })];
  const el = renderActionsCard(wsModel(ms), { doc });
  assert.match(el.querySelector('.act-co-empty').textContent, /No project changed in this run\./);
  assert.equal(el.querySelector('.act-table'), null);
  assert.equal(el.querySelector('.act-co-foot'), null);
  assert.match(el.querySelector('.act-fold summary').textContent, /2 projects had no changes/);
});

test('single-project: an unchanged run says so and offers no Check out', () => {
  const el = renderActionsCard(model(member({ affected: false, files: 0, added: 0, removed: 0 })), { doc });
  assert.match(el.textContent, /No changes in this project\./);
  assert.equal([...el.querySelectorAll('button')].find((b) => b.textContent === 'Check out'), undefined);
  assert.ok([...el.querySelectorAll('button')].find((b) => b.textContent === 'Copy command'), 'Copy command stays');
});

test('the client and the server agree on which members count as changed', () => {
  // The actions route (ui/routes/runs/checkout-and-actions.mjs) imports isChangedMember for totals.changed, so
  // this pins the predicate itself: unknown counts as changed, and a Folder member needs no branch.
  const ms = [member({ projectKey: 'a', affected: true }), member({ projectKey: 'b', affected: false }),
    member({ projectKey: 'c', affected: null }), member({ projectKey: 'd', branch: null, state: 'no-branch', affected: false }),
    member({ projectKey: 'e', branch: null, state: 'no-branch', workMode: 'folder', affected: true })];
  const m = wsModel(ms);
  assert.equal(ms.filter(isChangedMember).length, m.totals.changed);
  assert.deepEqual(ms.filter(isChangedMember).map((x) => x.projectKey), ['a', 'c', 'e']);
});

test('shipItTryState: checkout before the branch is checked out, strip after, null when unfinished or branchless', () => {
  assert.equal(shipItTryState(model(member())), 'checkout');
  assert.equal(renderShipItStrip(model(member()), { doc }), null, 'no Check out button in the strip any more');
  const inn = model(member({ checkout: { dir: '/x' } }));
  assert.equal(shipItTryState(inn), 'strip');
  assert.equal(renderShipItStrip(inn, { doc }).querySelector('.act-label').textContent, 'Try it first');
  assert.equal(shipItTryState({ ...model(member()), finished: false }), null);
  assert.equal(shipItTryState(model(member({ branch: null }))), null);
  assert.equal(shipItTryState(null), null);
});

test('overview strip: Check out, then open link + Stop while a service runs; null without a branch', () => {
  const calls = [];
  const handlers = { onCheckout: () => calls.push('checkout'), onStop: (m, a) => calls.push(['stop', m, a]), onOpenTab: () => calls.push('tab') };
  const a = renderOverviewStrip(model(member()), { doc, handlers });
  assert.deepEqual(labelsOf(a), ['Check out', 'Open tab ›']);
  a.querySelector('button').click();   // a single project has nothing to choose: it checks out on the spot
  const ws = renderOverviewStrip(wsModel([member(), member({ projectKey: 'api-1', affected: false })]), { doc, handlers });
  assert.deepEqual(labelsOf(ws), ['Check out 1 changed project', 'Open tab ›']);
  ws.querySelector('button').click();  // a workspace run links to the Actions tab, where you pick the projects
  const run = { instanceId: 'i', member: 'app-0cea65fb', actionId: 'run', label: 'Run', kind: 'service', status: 'ready', ports: { PORT: 4417 }, url: 'http://localhost:4417' };
  const b = renderOverviewStrip(model(member({ checkout: { setup: { status: 'ok' } } }), [run]), { doc, handlers });
  assert.equal(b.querySelector('a.act-open').textContent, 'Open :4417');
  [...b.querySelectorAll('button')].find((x) => x.textContent === 'Stop').click();
  [...b.querySelectorAll('button')].find((x) => x.textContent === 'Open tab ›').click();
  assert.deepEqual(calls, ['checkout', 'tab', ['stop', 'app-0cea65fb', 'run'], 'tab']);
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

test('releaseCheckout: the Actions tab\'s Discard / Unlink copy and DELETE, shared with the worktree notice', async () => {
  const asked = [];
  const calls = [];
  const api = async (method, url, body) => {
    calls.push([method, url, body]);
    return calls.length === 1 && !body.force && url.includes('snap') ? { ok: false, status: 409, data: { code: 'SNAPSHOT_FAILED' } } : { ok: true, status: 200, data: {} };
  };
  const yes = async (o) => { asked.push(o); return true; };
  // Discard: danger confirm, then DELETE with the members.
  await releaseCheckout({ api, url: '/api/runs/ab/checkout?projectKey=app', members: ['app-0cea65fb'], confirm: yes });
  assert.equal(asked[0].title, 'Discard the checkout?');
  assert.equal(asked[0].message, 'Running services stop first. Uncommitted changes are saved as a patch in the run\'s files.');
  assert.equal(asked[0].danger, true);
  assert.deepEqual(calls[0], ['DELETE', '/api/runs/ab/checkout?projectKey=app', { members: ['app-0cea65fb'] }]);
  // Unlink: names the folder, never danger.
  asked.length = 0; calls.length = 0;
  await releaseCheckout({ api, url: '/u', members: ['app-0cea65fb'], external: true, dir: '/Users/ada/app', confirm: yes });
  assert.equal(asked[0].title, 'Stop using this folder?');
  assert.deepEqual(asked[0].message, ['Running services stop first. ', { strong: '/Users/ada/app' }, ' stays exactly as it is.']);
  assert.ok(!asked[0].danger);
  // SNAPSHOT_FAILED asks again, then forces.
  asked.length = 0; calls.length = 0;
  await releaseCheckout({ api, url: '/snap', members: ['m'], confirm: yes });
  assert.deepEqual(asked.map((o) => o.title), ['Discard the checkout?', 'Saving the uncommitted changes failed']);
  assert.deepEqual(calls.map((c) => c[2]), [{ members: ['m'] }, { members: ['m'], force: true }]);
  // A declined confirm sends nothing and resolves null.
  calls.length = 0;
  assert.equal(await releaseCheckout({ api, url: '/x', members: ['m'], confirm: async () => false }), null);
  assert.equal(calls.length, 0);
});

test('checked out: Download patch sits before Discard; a linked folder before Unlink; the folder path has a copy button', async () => {
  const calls = [];
  const writes = stubClipboard();
  const handlers = { onDiff: (k, b) => calls.push(['diff', k, b.tagName]), onDiscard: () => {}, onUnlink: () => {} };
  const own = renderActionsCard(model(member({ checkout: { setup: { status: 'ok' } } })), { doc, handlers });
  const ownLabels = labelsOf(own);
  assert.equal(ownLabels.at(-1), 'Discard');
  assert.equal(ownLabels.at(-2), 'Download patch');
  own.querySelector('.act-diff').click();
  own.querySelector('.act-copy[aria-label="Copy folder path"]').click();
  await tick();
  assert.deepEqual(calls, [['diff', 'app-0cea65fb', 'BUTTON']]);
  assert.deepEqual(writes, ['/h/runs/ab/repos/app-0cea65fb']);
  const linked = renderActionsCard(model(member({ checkout: { external: true, worktreeDir: '/Users/ada/dev/app', setup: { status: 'skipped' } } })), { doc, handlers });
  assert.deepEqual(labelsOf(linked).slice(-2), ['Download patch', 'Unlink']);
  assert.ok(!labelsOf(linked).includes('Discard'), 'a linked folder is never discarded');
  assert.ok(linked.querySelector('.act-copy[aria-label="Copy folder path"]'));
  for (const s of [{ status: 'running' }, { status: 'failed', exitCode: 1 }]) {   // setting up / setup failed keep the patch too
    assert.ok(renderActionsCard(model(member({ checkout: { setup: s } })), { doc, handlers }).querySelector('.act-diff'));
  }
  assert.equal(renderActionsCard(model(member()), { doc, handlers }).querySelector('.act-diff'), null, 'not before Check out');
});

test('controller: Download patch hands the scoped diff URL and branch to downloadPatch', async () => {
  const got = [];
  const host = doc.createElement('div');
  const m = member({ checkout: { setup: { status: 'ok' } } });
  const ctl = createActionsController({ runId: 'ab', scopeQuery: 'projectKey=app', host, doc, ws: { send() {} },
    api: async () => ({ ok: true, status: 200, data: model(m) }), confirm: async () => true,
    downloadPatch: (o) => got.push(o) });
  await ctl.refresh();
  host.querySelector('.act-diff').click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(got.length, 1);
  assert.equal(got[0].url, '/api/runs/ab/checkout/diff?projectKey=app&member=app-0cea65fb');
  assert.equal(got[0].branch, 'worca-cc/x');
  assert.equal(got[0].btn.tagName, 'BUTTON');
  ctl.destroy();
});

test('controller: a Discard that succeeds says so in the card', async () => {
  const host = doc.createElement('div');
  let co = { setup: { status: 'ok' } };
  const api = async (method) => (method === 'DELETE'
    ? (co = null, { ok: true, status: 200, data: { patches: ['checkout-discard-app.patch'] } })
    : { ok: true, status: 200, data: model(member({ checkout: co })) });
  const ctl = createActionsController({ runId: 'ab', scopeQuery: 'projectKey=app', host, doc, ws: { send() {} }, api, confirm: async () => true });
  await ctl.refresh();
  [...host.querySelectorAll('button')].find((b) => b.textContent === 'Discard').click();
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  assert.match(host.textContent, /Checkout discarded\. Uncommitted changes were saved as a patch in the run's files\./);
  ctl.destroy();
});

// ---------------------------------------------------------------------------
// Progress while checking out, setting up, discarding and starting
// ---------------------------------------------------------------------------

const PK = 'app-0cea65fb';
const NOW = Date.parse('2026-11-04T10:00:00Z');
const SETUP_ID = `act:ab:${PK}:__setup`;
const setupInst = (over = {}) => ({ instanceId: SETUP_ID, runId: 'ab', member: PK, actionId: '__setup', label: 'Setup', kind: 'task',
  status: 'running', startedAt: NOW - 12000, ...over });
const buttonNamed = (el, label) => [...el.querySelectorAll('button')].find((b) => b.textContent === label);
/** A fake api whose writes wait until `release()`: the click-pending window, held open. */
function heldApi(getModel) {
  const calls = []; let open = [];
  const api = (method, url, body) => {
    calls.push([method, url, body]);
    if (method === 'GET') return Promise.resolve({ ok: true, status: 200, data: getModel() });
    return new Promise((res) => open.push(res));
  };
  const release = (r = { ok: true, status: 200, data: {} }) => { const o = open; open = []; for (const f of o) f(r); };
  return { api, calls, release, writes: () => calls.filter((c) => c[0] !== 'GET') };
}
const pressAnyway = (b) => b.dispatchEvent(new doc.defaultView.Event('click'));
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await tick(); };

test('checking out: the Check out button is busy and a status row names the branch', () => {
  const el = renderActionsCard(model(member()), { doc, handlers: {}, busy: new Set([`checkout:${PK}`]) });
  const card = el.querySelector('section.act-card');
  assert.equal(card.dataset.state, 'checking-out');
  assert.equal(card.querySelector('.act-state').textContent, 'Checking out');
  const b = buttonNamed(el, 'Checking out…');
  assert.ok(b && b.disabled, 'busy: disabled, with its own label');
  assert.equal(b.getAttribute('aria-busy'), 'true');
  assert.ok(b.querySelector('.act-spin'), 'a spinner in the button');
  const status = card.querySelector('.act-status');
  assert.equal(status.getAttribute('role'), 'status');
  assert.ok(status.querySelector('.act-spin'));
  assert.equal(status.textContent, 'Checking out worca-cc/x…');
  assert.ok(['VS Code', 'Terminal', 'Finder'].every((l) => buttonNamed(el, l).disabled), 'the folder they open is not there yet');
  // Without the busy key it is the plain card again.
  const idle = renderActionsCard(model(member()), { doc, handlers: {} });
  assert.equal(idle.querySelector('.act-status'), null);
  assert.ok(!buttonNamed(idle, 'Check out').disabled);
});

test('setting up: spinner, the setup command, elapsed time, the usual length and the setup log tail', () => {
  // The setup instance's own start wins over the checkout's stamp (the job wrote `running` a moment before it).
  const m = member({ checkout: { setup: { status: 'running', at: new Date(NOW - 30000).toISOString() } }, setupQueued: true });
  const logs = new Map([[SETUP_ID, [{ stream: 'out', text: 'added 512 packages' }]]]);
  const el = renderActionsCard(model(m, [setupInst()]), { doc, handlers: {}, logs, now: NOW });
  const status = el.querySelector('.act-status');
  assert.ok(status.querySelector('.act-spin'));
  assert.equal(status.querySelector('code').textContent, 'npm ci');
  assert.equal(status.querySelector('.act-elapsed').textContent, '12s');
  assert.equal(status.querySelector('.act-elapsed').dataset.since, String(NOW - 12000));
  assert.equal(status.textContent, 'Running setup: npm ci · 12s · usually ~42s');
  const pre = el.querySelector('pre.act-log');
  assert.equal(pre.dataset.instanceId, SETUP_ID);
  assert.equal(pre.textContent, 'added 512 packages\n');
  // No setup instance yet (the job has only just begun): elapsed from the checkout's setup stamp; no estimate known.
  const fresh = model(member({ checkout: { setup: { status: 'running', at: new Date(NOW - 12000).toISOString() } }, setupQueued: true }));
  fresh.estimate = { lastSetupMs: null };
  const el2 = renderActionsCard(fresh, { doc, handlers: {}, now: NOW });
  assert.equal(el2.querySelector('.act-status').textContent, 'Running setup: npm ci · 12s');
});

test('workspace: the footer Check out is busy while any of its members checks out, and that row says Checking out', () => {
  const api = member({ projectKey: 'api-1a2b3c4d', projectName: 'api' });
  const web = member({ projectKey: 'web-5e6f7a8b', projectName: 'web' });
  const m = { ...model(api), workspace: true, members: [api, web] };
  const el = renderActionsCard(m, { doc, handlers: {}, busy: new Set(['checkout:web-5e6f7a8b']) });
  const go = el.querySelector('.act-co-foot button');
  assert.equal(go.textContent, 'Checking out…');
  assert.ok(go.disabled && go.querySelector('.act-spin'));
  const chips = [...el.querySelectorAll('.act-table tbody tr')].map((tr) => tr.querySelector('.act-c-end .badge').textContent);
  assert.deepEqual(chips, ['Not checked out', 'Checking out']);
  assert.ok(el.querySelectorAll('.act-table tbody tr')[1].querySelector('.act-spin'), 'the busy row spins');
  assert.equal(renderActionsCard(m, { doc, handlers: {} }).querySelector('.act-co-foot button').textContent, 'Check out 2 projects');
});

test('setting up: the setup log stays the one shown when a newer instance exists', () => {
  const m = member({ checkout: { setup: { status: 'running' } } });
  const old = { instanceId: `act:ab:${PK}:test`, member: PK, actionId: 'test', kind: 'task', status: 'exited', exitCode: 0, startedAt: NOW };
  const el = renderActionsCard(model(m, [setupInst({ startedAt: NOW - 5000 }), old]), { doc, handlers: {}, logs: new Map(), now: NOW });
  assert.equal(el.querySelector('pre.act-log').dataset.instanceId, SETUP_ID);
});

test('setup done: Checked out, no status row, actions startable', () => {
  const el = renderActionsCard(model(member({ checkout: { setup: { status: 'ok' } } }), [setupInst({ status: 'exited', exitCode: 0 })]), { doc, handlers: {}, now: NOW });
  assert.equal(el.querySelector('.act-state').textContent, 'Checked out');
  assert.equal(el.querySelector('.act-status'), null);
  assert.ok(!buttonNamed(el, 'Run').disabled && !buttonNamed(el, 'Test').disabled);
});

test('setup failed: the error and the setup log stay visible', () => {
  const logs = new Map([[SETUP_ID, [{ stream: 'err', text: 'npm ERR! missing script' }]]]);
  const el = renderActionsCard(model(member({ checkout: { setup: { status: 'failed', exitCode: 1 } } }), [setupInst({ status: 'exited', exitCode: 1 })]),
    { doc, handlers: {}, logs, now: NOW });
  assert.equal(el.querySelector('.act-state').textContent, 'Setup failed');
  assert.equal(el.querySelector('.act-exit.fail').textContent, 'Setup failed (exit 1).');
  assert.equal(el.querySelector('.act-status'), null);
  assert.equal(el.querySelector('pre.act-log').textContent, 'npm ERR! missing script\n');
});

test('busy Discard and Start: spinner, disabled, own label', () => {
  const m = member({ checkout: { setup: { status: 'ok' } } });
  const el = renderActionsCard(model(m), { doc, handlers: {}, busy: new Set([`discard:${PK}`, `start:${PK}:run`]) });
  for (const label of ['Discarding…', 'Starting…']) {
    const b = buttonNamed(el, label);
    assert.ok(b && b.disabled && b.querySelector('.act-spin'), label);
  }
  assert.ok(buttonNamed(el, 'Test') && !buttonNamed(el, 'Test').disabled, 'only the pressed action is busy');
  const linked = renderActionsCard(model(member({ checkout: { external: true, worktreeDir: '/u/app', setup: { status: 'skipped' } } })),
    { doc, handlers: {}, busy: new Set([`discard:${PK}`]) });
  assert.ok(buttonNamed(linked, 'Unlinking…').disabled);
});

test('a starting service shows a spinner until it is ready', () => {
  const run = { instanceId: `act:ab:${PK}:run`, member: PK, actionId: 'run', kind: 'service', status: 'starting', ports: { PORT: 4417 }, url: 'http://localhost:4417', startedAt: NOW - 2000 };
  const m = member({ checkout: { setup: { status: 'ok' } } });
  for (const status of ['starting', 'running']) {
    const line = renderActionsCard(model(m, [{ ...run, status }]), { doc, handlers: {}, now: NOW }).querySelector('.act-service');
    assert.ok(line.querySelector('.act-spin'), status);
    assert.match(line.textContent, /Starting…/);
  }
  const ready = renderActionsCard(model(m, [{ ...run, status: 'ready' }]), { doc, handlers: {}, now: NOW }).querySelector('.act-service');
  assert.equal(ready.querySelector('.act-spin'), null);
  assert.doesNotMatch(ready.textContent, /Starting…/);
  const failing = renderActionsCard(model(m, [{ ...run, status: 'running', readyError: 'port never opened' }]), { doc, handlers: {}, now: NOW }).querySelector('.act-service');
  assert.equal(failing.querySelector('.act-spin'), null, 'a ready check that gave up is not "starting"');
});

test('workspace checked-out rows: busy Discard / Unlink / Start, Starting… before ready, and the setup log while setting up', () => {
  const other = member({ projectKey: 'web-5e6f7a8b', projectName: 'web', branch: 'b/web' });
  const ws = (m, instances = [], opts = {}) => renderActionsCard(wsModel([m, other], { instances }), { doc, handlers: {}, now: NOW, ...opts })
    .querySelector(`.act-wt-row[data-member="${PK}"]`);
  const ok = member({ checkout: { worktreeDir: '/w/app', setup: { status: 'ok' } } });

  const row = ws(ok, [], { busy: new Set([`discard:${PK}`, `start:${PK}:run`]) });
  for (const label of ['Discarding…', 'Starting…']) {
    const b = buttonNamed(row, label);
    assert.ok(b && b.disabled && b.querySelector('.act-spin'), label);
  }
  assert.ok(buttonNamed(row, 'Test') && !buttonNamed(row, 'Test').disabled, 'only the pressed action is busy');
  assert.ok(buttonNamed(ws(ok), 'Discard'), 'not busy without the key');
  const linked = ws(member({ checkout: { external: true, worktreeDir: '/u/app', setup: { status: 'skipped' } } }), [],
    { busy: new Set([`discard:${PK}`]) });
  assert.ok(buttonNamed(linked, 'Unlinking…').disabled);

  const run = { instanceId: `act:ab:${PK}:run`, member: PK, actionId: 'run', kind: 'service', status: 'starting', ports: { PORT: 4417 }, url: 'http://localhost:4417', startedAt: NOW - 2000 };
  const starting = ws(ok, [run]).querySelector('.act-wt-svc');
  assert.ok(starting.querySelector('.act-starting .act-spin'));
  assert.equal(starting.querySelector('.act-uptime'), null, 'no uptime before ready');
  const ready = ws(ok, [{ ...run, status: 'ready' }]).querySelector('.act-wt-svc');
  assert.equal(ready.querySelector('.act-starting'), null);
  assert.ok(ready.querySelector('.act-uptime'));

  const old = { instanceId: `act:ab:${PK}:test`, member: PK, actionId: 'test', kind: 'task', status: 'exited', exitCode: 0, startedAt: NOW };
  const settingUp = ws(member({ checkout: { worktreeDir: '/w/app', setup: { status: 'running' } } }), [setupInst({ startedAt: NOW - 5000 }), old], { logs: new Map() });
  assert.equal(settingUp.dataset.state, 'setting-up');
  assert.equal(settingUp.querySelector('pre.act-log').dataset.instanceId, SETUP_ID);
  const failed = ws(member({ checkout: { worktreeDir: '/w/app', setup: { status: 'failed', exitCode: 1 } } }),
    [setupInst({ status: 'exited', exitCode: 1, startedAt: NOW - 5000 }), old], { logs: new Map() });
  assert.equal(failed.dataset.state, 'setup-failed');
  assert.equal(failed.querySelector('pre.act-log').dataset.instanceId, SETUP_ID);
});

test('controller: Check out goes busy at once, a second click does nothing, the answer clears it', async () => {
  let cur = model(member());
  const h = heldApi(() => cur);
  const host = doc.createElement('div');
  const ctl = createActionsController({ runId: 'ab', scopeQuery: 'projectKey=app', api: h.api, ws: { send() {} }, host, doc, confirm: async () => true });
  await ctl.refresh();
  buttonNamed(host, 'Check out').click();
  assert.ok(buttonNamed(host, 'Checking out…').disabled, 'busy before the server answers');
  assert.equal(host.querySelector('.act-status').textContent, 'Checking out worca-cc/x…');
  pressAnyway(buttonNamed(host, 'Checking out…'));   // a disabled button can still get an Event: the handler must refuse
  ctl.onFrame({ type: 'action-status', instanceId: `act:ab:${PK}:x`, snapshot: null, seq: 1 });   // a re-render keeps busy
  assert.ok(buttonNamed(host, 'Checking out…'));
  await settle();
  assert.equal(h.writes().length, 1, 'one checkout only');
  cur = model(member({ checkout: { setup: { status: 'running' } }, setupQueued: true }));
  h.release();
  await settle();
  assert.equal(host.querySelector('section.act-card').dataset.state, 'setting-up');
  assert.equal(buttonNamed(host, 'Checking out…'), undefined);
  ctl.destroy();
});

test('controller: a failed Check out clears busy and shows the error', async () => {
  const h = heldApi(() => model(member()));
  const host = doc.createElement('div');
  const ctl = createActionsController({ runId: 'ab', scopeQuery: 'projectKey=app', api: h.api, ws: { send() {} }, host, doc, confirm: async () => true });
  await ctl.refresh();
  buttonNamed(host, 'Check out').click();
  h.release({ ok: false, status: 500, data: { error: 'git worktree add failed' } });
  await settle();
  assert.ok(!buttonNamed(host, 'Check out').disabled);
  assert.match(host.querySelector('.act-notice').textContent, /git worktree add failed/);
  ctl.destroy();
});

test('controller: Discard is busy once confirmed; a second click while busy asks nothing', async () => {
  let cur = model(member({ checkout: { setup: { status: 'ok' } } }));
  const h = heldApi(() => cur);
  const host = doc.createElement('div');
  let asked = 0;
  const ctl = createActionsController({ runId: 'ab', scopeQuery: 'projectKey=app', api: h.api, ws: { send() {} }, host, doc,
    confirm: async () => { asked += 1; return true; } });
  await ctl.refresh();
  buttonNamed(host, 'Discard').click();
  await settle();
  assert.ok(buttonNamed(host, 'Discarding…').disabled);
  pressAnyway(buttonNamed(host, 'Discarding…'));   // a disabled button can still get an Event: the handler must refuse
  await settle();
  assert.equal(asked, 1);
  assert.equal(h.writes().length, 1);
  cur = model(member());
  h.release({ ok: true, status: 200, data: { patches: [] } });
  await settle();
  assert.ok(buttonNamed(host, 'Check out'));
  assert.match(host.textContent, /Checkout discarded\./);
  ctl.destroy();
});

test('controller: a declined Discard never shows busy', async () => {
  const h = heldApi(() => model(member({ checkout: { setup: { status: 'ok' } } })));
  const host = doc.createElement('div');
  let answer; let asked = 0;
  const ctl = createActionsController({ runId: 'ab', scopeQuery: 'projectKey=app', api: h.api, ws: { send() {} }, host, doc,
    confirm: () => new Promise((r) => { asked += 1; answer = r; }) });
  await ctl.refresh();
  buttonNamed(host, 'Discard').click();
  await settle();
  assert.ok(buttonNamed(host, 'Discard'), 'not busy while the confirm is open');
  await ctl.refresh();   // any re-render while the confirm is open (a refresh, a ws frame) still shows plain Discard
  assert.equal(buttonNamed(host, 'Discarding…'), undefined, 'no busy look before the user confirms');
  assert.ok(!buttonNamed(host, 'Discard').disabled);
  buttonNamed(host, 'Discard').click();   // the confirm is still open: no second one
  await settle();
  assert.equal(asked, 1, 'a press while the confirm is open asks nothing');
  answer(false);
  await settle();
  assert.ok(!buttonNamed(host, 'Discard').disabled);
  buttonNamed(host, 'Discard').click();   // the lock is released after a cancel
  await settle();
  assert.equal(asked, 2, 'the lock is released after a cancel');
  assert.equal(h.writes().length, 0, 'nothing was discarded');
  ctl.destroy();
});

test('controller: Start is busy until the server answers; a second click starts nothing', async () => {
  const h = heldApi(() => model(member({ checkout: { setup: { status: 'ok' } } })));
  const host = doc.createElement('div');
  const ctl = createActionsController({ runId: 'ab', scopeQuery: 'projectKey=app', api: h.api, ws: { send() {} }, host, doc, confirm: async () => true });
  await ctl.refresh();
  buttonNamed(host, 'Run').click();
  assert.ok(buttonNamed(host, 'Starting…').disabled);
  pressAnyway(buttonNamed(host, 'Starting…'));   // a disabled button can still get an Event: the handler must refuse
  await settle();
  assert.equal(h.writes().length, 1);
  h.release({ ok: true, status: 200, data: { instanceId: `act:ab:${PK}:run`, member: PK, actionId: 'run', kind: 'service', status: 'starting', ports: {}, startedAt: Date.now() } });
  await settle();
  assert.equal(buttonNamed(host, 'Starting…'), undefined);
  assert.match(host.querySelector('.act-service').textContent, /Starting…/);
  ctl.destroy();
});

test('controller: the setup instance\'s first status frame subscribes it, and the elapsed time ticks in place', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: NOW });
  const m = model(member({ checkout: { setup: { status: 'running', at: new Date(NOW - 3000).toISOString() } }, setupQueued: true }));
  const sent = [];
  const host = doc.createElement('div');
  const ctl = createActionsController({ runId: 'ab', scopeQuery: 'projectKey=app', api: async () => ({ ok: true, status: 200, data: m }),
    ws: { send: (o) => sent.push(o) }, host, doc, confirm: async () => true });
  await ctl.refresh();
  assert.equal(host.querySelector('.act-elapsed').textContent, '3s');
  ctl.onFrame({ type: 'action-status', instanceId: SETUP_ID, snapshot: setupInst({ startedAt: NOW - 3000 }), seq: 1 });
  assert.deepEqual(sent.at(-1), { type: 'subscribe', instanceId: SETUP_ID }, 'its log replays from the start');
  ctl.onFrame({ type: 'action-line', instanceId: SETUP_ID, stream: 'out', text: 'npm warn', seq: 2 });
  const pre = host.querySelector('pre.act-log');
  t.mock.timers.tick(2000);
  assert.equal(host.querySelector('.act-elapsed').textContent, '5s');
  assert.equal(host.querySelector('pre.act-log'), pre, 'the tick does not rebuild the card');
  ctl.destroy();
  t.mock.timers.tick(5000);   // no tick after destroy (the host is empty; nothing throws)
});

test('controller: Terminal before Check out shows Checking out while the POST is out; a second press checks out nothing', async () => {
  const h = heldApi(() => model(member()));
  const host = doc.createElement('div');
  let asked = 0;
  const ctl = createActionsController({ runId: 'ab', scopeQuery: 'projectKey=app', api: h.api, ws: { send() {} }, host, doc,
    confirm: async () => { asked += 1; return true; } });
  await ctl.refresh();
  buttonNamed(host, 'Terminal').click();
  await settle();
  assert.equal(host.querySelector('section.act-card').dataset.state, 'checking-out');
  assert.ok(buttonNamed(host, 'Checking out…').disabled);
  pressAnyway(buttonNamed(host, 'Terminal'));   // a disabled button can still get an Event: the handler must refuse
  await settle();
  assert.equal(h.writes().length, 1, 'one checkout only');
  h.release({ ok: true, status: 200, data: {} });
  await settle();
  assert.equal(buttonNamed(host, 'Checking out…'), undefined);
  assert.ok(asked >= 1);
  ctl.destroy();
});

test('workspace: only the first member shows "usually ~Ns" (the estimate is that project\'s)', () => {
  const setting = { checkout: { setup: { status: 'running', at: new Date(NOW - 4000).toISOString() } }, setupQueued: true };
  const api = member({ projectKey: 'api-1a2b3c4d', projectName: 'api', ...setting });
  const web = member({ projectKey: 'web-5e6f7a8b', projectName: 'web', ...setting });
  const m = { ...model(api), workspace: true, members: [api, web] };
  const el = renderActionsCard(m, { doc, handlers: {}, now: NOW });
  const [first, second] = [...el.querySelectorAll('.act-wt-row')].map((c) => c.querySelector('.act-status').textContent);
  assert.equal(first, 'Running setup: npm ci · 4s · usually ~42s');
  assert.equal(second, 'Running setup: npm ci · 4s', 'another project\'s estimate is never shown');
});

test('controller: the selection survives a re-render, and a NOT_AFFECTED refusal refreshes with no red error', async () => {
  const a = member({ projectKey: 'a', projectName: 'a', branch: 'b/a' });
  const b = member({ projectKey: 'b', projectName: 'b', branch: 'b/b' });
  const m = { ...model(a), workspace: true, members: [a, b], totals: { members: 2, changed: 2, files: 0, added: 0, removed: 0 } };
  const { api, calls } = fakeApi((method) => (method === 'GET' ? { ok: true, status: 200, data: m }
    : { ok: false, status: 409, data: { error: 'No changes in this project', code: 'NOT_AFFECTED', members: ['b'] } }));
  const host = doc.createElement('div');
  const ctl = createActionsController({ runId: 'ab', scopeQuery: 'workspaceId=w', api, ws: { send: () => {} }, host, doc,
    confirm: async () => true, navigate: () => {} });
  await ctl.refresh();
  const cb = host.querySelectorAll('.act-table tbody .act-cb')[1];
  cb.checked = false; cb.dispatchEvent(new doc.defaultView.Event('change'));
  assert.equal(host.querySelector('.act-co-foot button').textContent, 'Check out 1 project', 'the untick survived the re-render');
  host.querySelector('.act-co-foot button').click();
  for (let i = 0; i < 6; i++) await tick();
  assert.equal(host.querySelector('.act-notice'), null, 'a stale page refreshes quietly');
  assert.ok(calls.filter((c) => c[0] === 'GET').length >= 2, 'it refetched the model');
  ctl.destroy();
});
