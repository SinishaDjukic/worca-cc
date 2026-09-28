// test/ui-script-bench.test.mjs — the Test tab (scripts-workbench §5.3): the three
// columns, the request it builds, the frames it consumes and the cases it writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import {
  renderBench, renderBenchResult, collectBenchRequest, collectCase, createBenchController,
  caseListFor, caseIdFrom, SCRATCH_LABEL, EXPECT_VERDICTS, MAX_CASES, MAX_CASE_NAME,
} from '../ui/public/script-bench-view.mjs';

const win = new JSDOM('<!doctype html><body></body>').window;
const doc = win.document;
const tick = () => new Promise((r) => setTimeout(r, 0));
const flush = async (n = 4) => { for (let i = 0; i < n; i += 1) await tick(); };

const META = {
  key: 'runTests', displayName: 'Run tests', origin: 'user', runtime: 'shell', timeoutMs: 20000,
  params: [{ id: 'command', type: 'command', label: 'Command', required: true, default: 'npm test' }],
  inputs: [{ id: 'plan', type: 'md', required: false }, { id: 'conf', type: 'json', required: false }, { id: 'done', type: 'void', required: false }],
  outputs: [{ id: 'log', type: 'md', when: 'always', filename: 'tests-cycle{cycle}.md' },
    { id: 'fail', type: 'md', when: 'blocking', filename: 'tests-cycle{cycle}.md' },
    { id: 'report', type: 'json', when: 'always', filename: 'tests-cycle{cycle}.json' },
    { id: 'pass', type: 'void', when: 'clean' }],
  verdict: { filename: 'tests-cycle{cycle}.json' },
};
const CASE = {
  id: 'c_failing', name: 'failing suite', params: { command: 'npm test' }, ports: null,
  inputs: { plan: { text: '# Plan\n' }, done: { fired: true } }, cwd: { kind: 'scratch' }, timeoutMs: null,
  expect: { verdict: 'blocking', fired: ['log', 'fail'] },
};
const DATA = { meta: META, source: '#!/bin/sh\nnpm test\n', sourceWin32: null, sourcePath: '/u/.worca-cc/scripts/runTests.sh', cases: [CASE], userCases: [], casesWritable: true };
const PLUGIN_DATA = { ...DATA, meta: { ...META, origin: 'plugin:tools' }, cases: [CASE], userCases: [{ ...CASE, id: 'c_mine', name: 'my input' }] };
const PROJECTS = [{ key: 'worca-0001', name: 'worca', path: '/home/u/worca', exists: true },
  { key: 'gone-0002', name: 'gone', path: '/home/u/gone', exists: false }];
const RESULT = {
  status: 'blocking', exitCode: 1, runtime: 'shell', durationMs: 4200, summary: '212 passing, 3 failing',
  warnings: [], fired: ['log', 'fail'],
  outputs: {
    log: { type: 'md', path: '/b/log.md', bytes: 12, text: '# Tests\n\nfailed', truncated: false },
    report: { type: 'json', path: '/b/report.json', bytes: 20, text: '{"failed":3}', truncated: true },
    pass: { type: 'void' },
  },
  verdict: { issues: [{ severity: 'major', title: '3 tests failed' }], summary: 'exited 1' },
  envelopePath: '/b/pipeline/scripts/bench-c1.envelope.json',
  error: null, expect: { pass: true, diffs: [] }, draft: false, benchDir: '/b',
};
const render = (data = DATA, over = {}) => renderBench(data, { doc, projects: PROJECTS, caseState: new Map(), highlight: async (t) => t, ...over });

test('caseListFor: shipped first, the overlay after, and the writable half', () => {
  assert.deepEqual(caseListFor(DATA).cases.map((c) => [c.id, c.writable]), [['c_failing', true]]);
  assert.equal(caseListFor(DATA).writableIndex, 'cases');
  const plug = caseListFor(PLUGIN_DATA);
  assert.deepEqual(plug.cases.map((c) => [c.id, c.writable]), [['c_failing', false], ['c_mine', true]]);
  assert.equal(plug.writableIndex, 'userCases');
});

test('the four panels: the bar (folder, Test, Stop), the setup (params, port rows), the cases strip (dots, locks), the result', () => {
  const root = renderBench(PLUGIN_DATA, { doc, projects: PROJECTS, highlight: async (t) => t,
    caseState: new Map([['runTests', new Map([['c_failing', 'fail']])]]) });
  assert.equal(root.dataset.scriptKey, 'runTests');
  assert.deepEqual([...root.children].map((c) => c.className.split(' ')[0]), ['bench-bar', 'bench-col', 'bench-col', 'bench-col']);
  assert.deepEqual([...root.querySelectorAll('.bench-col')].map((c) => c.querySelector('.bench-col-head').textContent),
    ['Test inputs', 'Cases', 'Result']);
  assert.deepEqual([...root.querySelectorAll('.bench-bar button')].map((b) => b.textContent), ['Test', 'Stop']);
  assert.ok(root.querySelector('.bench-bar [data-field="bench:cwd"]'), 'the folder picker sits in the bar');
  const rows = [...root.querySelectorAll('.bench-case-row')];
  assert.deepEqual(rows.map((r) => r.dataset.caseId), ['c_failing', 'c_mine']);
  assert.deepEqual(rows.map((r) => r.querySelector('.bench-case-name').textContent), ['failing suite', 'my input']);
  assert.equal(rows[0].querySelector('.script-dot').dataset.state, 'fail');
  assert.equal(rows[1].querySelector('.script-dot').dataset.state, 'none');
  // A plugin's SHIPPED case is locked: no Rename, no Delete, no Update (below).
  assert.equal(rows[0].querySelector('.bench-lock').textContent, 'shipped');
  assert.equal(rows[0].querySelector('.bench-case-rename'), null);
  assert.equal(rows[0].querySelector('.bench-case-delete'), null);
  assert.equal(rows[1].querySelector('.bench-lock'), null);
  assert.equal(rows[1].querySelector('.bench-case-rename').textContent, 'Rename');
  assert.equal(rows[1].querySelector('.bench-case-delete').textContent, 'Delete');
  assert.equal(root.querySelector('.bench-add-case').textContent, '+ Case');
  assert.equal(root.querySelector('.bench-run-all').disabled, false);
  assert.equal(root.querySelector('.bench-save-case').textContent, 'Save as case');
  assert.equal(root.querySelector('.bench-case-update'), null, 'Update needs a writable case selected');
  assert.ok(root.querySelector('.bench-cases input[data-field="bench:caseName"]'), 'the name row is inline, never a prompt');

  const folder = root.querySelector('[data-field="bench:cwd"]');
  assert.deepEqual([...folder.options].map((o) => [o.value, o.textContent, o.disabled]), [
    ['', SCRATCH_LABEL, false],
    ['project:worca-0001', 'worca — /home/u/worca', false],
    ['project:gone-0002', 'gone — /home/u/gone', true],
  ]);
  assert.equal(root.querySelector('.bench-params [data-field="param:command"]').value, 'npm test');
  const ports = [...root.querySelectorAll('.bench-port')];
  assert.deepEqual(ports.map((p) => [p.dataset.port, p.dataset.type]), [['plan', 'md'], ['conf', 'json'], ['done', 'void']]);
  assert.equal(ports[0].querySelector('[data-field="in:plan:bound"]').checked, false);
  assert.ok(ports[0].querySelector('textarea[data-field="in:plan:text"]'));
  assert.deepEqual([...ports[0].querySelectorAll('[data-in-src]')].map((b) => b.textContent), ['Text', 'File…', 'Run…']);
  assert.equal(ports[2].querySelector('textarea'), null, 'a void port has no text box');
  assert.equal(ports[2].querySelector('.bench-void-fired').textContent, 'fired');
  assert.equal(root.querySelector('.bench-stop').disabled, true);
  assert.equal(root.querySelector('.bench-status-text').textContent, 'idle');
  assert.equal(root.querySelectorAll('p').length, 0, 'the bench carries no prose either');
});

test('the Expect row: `—` shows nothing else; a verdict brings the output chips and the summary field', () => {
  assert.deepEqual(EXPECT_VERDICTS, ['clean', 'blocking', 'error']);
  const root = render();
  const sel = root.querySelector('[data-field="expect:verdict"]');
  assert.equal(root.querySelector('.bench-expect-row .bench-zone').textContent, 'Expect');
  assert.deepEqual([...sel.options].map((o) => [o.value, o.textContent]),
    [['', '—'], ['clean', 'clean'], ['blocking', 'blocking'], ['error', 'error']]);
  assert.equal(sel.value, '');
  assert.equal(root.querySelector('[data-field="expect:summaryIncludes"]'), null, '`—` means expect: null');
  assert.equal(root.querySelector('.bench-expect-chip'), null);
  assert.equal(root.querySelector('.bench-expect-from-result').textContent, 'Use result');
  assert.equal(root.querySelector('.bench-expect-from-result').disabled, true, 'nothing has run yet');
  sel.value = 'blocking';
  sel.dispatchEvent(new win.Event('change', { bubbles: true }));
  assert.deepEqual([...root.querySelectorAll('.bench-expect-chip input')].map((c) => c.dataset.field),
    ['expect:fired:log', 'expect:fired:fail', 'expect:fired:report', 'expect:fired:pass'], 'one chip per DECLARED output port, void included');
  assert.deepEqual([...root.querySelectorAll('.bench-expect-chip')].map((c) => c.textContent), ['log', 'fail', 'report', 'pass']);
  assert.ok(root.querySelector('[data-field="expect:summaryIncludes"]'));
  assert.equal(root.querySelector('.bench-expect-row label.ins-label').textContent, 'Summary contains');
  assert.equal(root.querySelectorAll('.bench-expect-row p').length, 0);
});

test('collectCase: the Task 1 Case shape, with expect null or filled', () => {
  const root = render();
  root.querySelector('[data-field="in:plan:bound"]').checked = true;
  root.querySelector('[data-field="in:plan:text"]').value = '# Plan\n';
  root.querySelector('[data-field="in:done:bound"]').checked = true;
  assert.deepEqual(collectCase(root, DATA, { id: 'c-one', name: 'first run' }), {
    id: 'c-one', name: 'first run',
    params: { command: 'npm test' }, ports: null,
    inputs: { plan: { text: '# Plan\n' }, done: { fired: true } },
    cwd: { kind: 'scratch' }, timeoutMs: null, expect: null,
  });
  const sel = root.querySelector('[data-field="expect:verdict"]');
  sel.value = 'blocking';
  sel.dispatchEvent(new win.Event('change', { bubbles: true }));
  root.querySelector('[data-field="expect:fired:log"]').checked = true;
  root.querySelector('[data-field="expect:fired:pass"]').checked = true;
  assert.deepEqual(collectCase(root, DATA, { id: 'c-two', name: 'x' }).expect,
    { verdict: 'blocking', fired: ['log', 'pass'] }, 'declared order, no blank summaryIncludes');
  root.querySelector('[data-field="expect:summaryIncludes"]').value = '  3 failing ';
  assert.deepEqual(collectCase(root, DATA, { id: 'c-two', name: 'x' }).expect,
    { verdict: 'blocking', fired: ['log', 'pass'], summaryIncludes: '3 failing' });
  assert.equal(collectCase(root, DATA, { id: 'c-two', name: ` ${'n'.repeat(120)} ` }).name.length, MAX_CASE_NAME);
});

test('caseIdFrom slugs the name, keeps CASE_ID_RE and steps past a taken id', () => {
  const RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
  assert.equal(caseIdFrom('failing suite', []), 'failing-suite');
  assert.equal(caseIdFrom('failing suite', ['failing-suite']), 'failing-suite-2');
  assert.equal(caseIdFrom('failing suite', ['failing-suite', 'failing-suite-2']), 'failing-suite-3');
  assert.equal(caseIdFrom('  Big Plan!!  ', []), 'big-plan');
  assert.equal(caseIdFrom('2 fast', []), 'c-2-fast', 'an id must START with a letter');
  assert.equal(caseIdFrom('', []), 'case');
  assert.equal(caseIdFrom('…', []), 'case');
  for (const name of ['failing suite', '2 fast', '', '…', 'x'.repeat(200)]) {
    assert.match(caseIdFrom(name, []), RE, `"${name}" must slug to a legal id`);
  }
});

test('a config-ported script gets the port editor above the inputs', () => {
  const cfg = { ...DATA, meta: { ...META, ports: 'config', inputs: undefined, outputs: undefined,
    defaultPorts: { inputs: [{ id: 'in', type: 'md', required: false }], outputs: [{ id: 'out', type: 'md', when: 'always', filename: 'o.md' }] } } };
  const root = render(cfg);
  assert.ok(root.querySelector('.bench-setup .ins-port-editor'));
  assert.deepEqual([...root.querySelectorAll('.bench-port')].map((p) => p.dataset.port), ['in']);
});

test('selecting a case fills the setup from it, EXPECTATION included', () => {
  const b = mountBench();
  const { root } = b;
  root.querySelector('.bench-case-row[data-case-id="c_failing"] .bench-case').click();
  assert.equal(root.querySelector('[data-field="in:plan:bound"]').checked, true);
  assert.equal(root.querySelector('[data-field="in:plan:text"]').value, '# Plan\n');
  assert.equal(root.querySelector('[data-field="in:done:bound"]').checked, true);
  assert.equal(root.querySelector('[data-field="in:conf:bound"]').checked, false);
  assert.equal(root.querySelector('[data-field="param:command"]').value, 'npm test');
  assert.equal(root.querySelector('[data-field="bench:cwd"]').value, '');
  assert.equal(root.querySelector('[data-field="bench:caseName"]').value, 'failing suite');
  assert.equal(root.querySelector('[data-field="expect:verdict"]').value, 'blocking');
  assert.deepEqual([...root.querySelectorAll('.bench-expect-chip input')].filter((c) => c.checked).map((c) => c.dataset.field),
    ['expect:fired:log', 'expect:fired:fail'], 'the stored expectation, chip for chip');
  assert.ok(root.querySelector('.bench-case-row[data-case-id="c_failing"] .bench-case').classList.contains('on'));
  assert.ok(root.querySelector('.bench-case-update'), 'a writable case is selected, so Update appears');
  b.cleanup();
});

test('selecting a SHIPPED case offers no Update', () => {
  const b = mountBench(PLUGIN_DATA);
  b.root.querySelector('.bench-case-row[data-case-id="c_failing"] .bench-case').click();
  assert.equal(b.root.querySelector('.bench-case-update'), null);
  b.root.querySelector('.bench-case-row[data-case-id="c_mine"] .bench-case').click();
  assert.ok(b.root.querySelector('.bench-case-update'), 'the overlay case is writable');
  b.cleanup();
});

test('collectBenchRequest: bound ports only, the two input shapes, the cwd choice', () => {
  const root = render();
  root.querySelector('[data-field="in:plan:bound"]').checked = true;
  root.querySelector('[data-field="in:plan:text"]').value = '# Plan\n';
  root.querySelector('[data-field="in:done:bound"]').checked = true;
  root.querySelector('[data-field="param:command"]').value = 'npm run lint';
  assert.deepEqual(collectBenchRequest(root, DATA), {
    key: 'runTests', caseId: null, all: false, draft: null,
    params: { command: 'npm run lint' }, ports: null,
    inputs: { plan: { text: '# Plan\n' }, done: { fired: true } },
    cwd: { kind: 'scratch' }, timeoutMs: null,
  });
  root.querySelector('[data-field="bench:cwd"]').value = 'project:worca-0001';
  assert.deepEqual(collectBenchRequest(root, DATA).cwd, { kind: 'project', projectKey: 'worca-0001' });
  const draft = { meta: META, source: 'x', sourceWin32: null };
  assert.deepEqual(collectBenchRequest(root, DATA, { draft }).draft, draft);
});

test('renderBenchResult: status, fired chips, expect, one tab per non-void output plus verdict and envelope', async () => {
  const mount = doc.createElement('div');
  const rendered = [];
  mount.appendChild(renderBenchResult(RESULT, {
    doc, highlight: async (t) => `<i>${t}</i>`,
    renderMarkdown: async (textValue, host) => { rendered.push(textValue); host.textContent = textValue; return host; },
    outputHref: (port) => `/api/scripts/bench/b1/output/${port}`,
  }));
  await flush();
  assert.equal(mount.querySelector('.bench-dot').dataset.status, 'blocking');
  assert.equal(mount.querySelector('.bench-status-text').textContent, 'blocking');
  assert.equal(mount.querySelector('.bench-exit').textContent, 'exit 1');
  assert.equal(mount.querySelector('.bench-dur').textContent, '4.2 s');
  assert.equal(mount.querySelector('.bench-summary').textContent, '212 passing, 3 failing');
  assert.equal(mount.querySelector('.bench-draft').hidden, true);
  assert.deepEqual([...mount.querySelectorAll('.bench-fired-chip')].map((c) => c.textContent), ['log', 'fail']);
  assert.equal(mount.querySelector('.bench-expect-state').textContent, 'expect pass');
  assert.deepEqual([...mount.querySelectorAll('.bench-tabs button')].map((b) => b.dataset.rtab),
    ['log', 'log-out', 'report', 'verdict', 'envelope']);
  assert.deepEqual([...mount.querySelectorAll('.bench-tabs button')].map((b) => b.textContent),
    ['Log', 'log', 'report', 'verdict', 'envelope']);
  assert.deepEqual(rendered, ['# Tests\n\nfailed'], 'the md output goes through the page`s sanitizer');
  assert.equal(mount.querySelector('.bench-pane[data-rpane="report"] code').innerHTML, '<i>{\n  "failed": 3\n}</i>');
  assert.equal(mount.querySelector('.bench-pane[data-rpane="report"] .bench-open-full').getAttribute('href'),
    '/api/scripts/bench/b1/output/report');
  assert.equal(mount.querySelector('.bench-pane[data-rpane="log-out"] .bench-open-full'), null, 'not truncated, no link');
  assert.equal(mount.querySelector('.bench-pane[data-rpane="envelope"] code').textContent, RESULT.envelopePath);
  assert.equal(mount.querySelector('.bench-pane[data-rpane="verdict"] code').textContent.includes('3 tests failed'), true);
});

test('renderBenchResult: the Raw toggle swaps the md pane, and a void output is a chip only', async () => {
  const mount = doc.createElement('div');
  mount.appendChild(renderBenchResult(RESULT, {
    doc, highlight: async (t) => t,
    renderMarkdown: async (textValue, host) => { host.className = 'artifact-markdown'; host.textContent = textValue; return host; },
    outputHref: (port) => `/o/${port}`,
  }));
  await flush();
  const pane = mount.querySelector('.bench-pane[data-rpane="log-out"]');
  const toggle = pane.querySelector('.bench-raw');
  assert.equal(toggle.textContent, 'Raw');
  toggle.click();
  await flush();
  assert.equal(toggle.textContent, 'Rendered');
  assert.equal(pane.querySelector('pre.bench-rawtext').textContent, '# Tests\n\nfailed');
  assert.equal(mount.querySelector('.bench-tabs button[data-rtab="pass"]'), null, 'a void output gets no tab');
});

test('an execution error is a RESULT: status error, the message and the tail', async () => {
  const mount = doc.createElement('div');
  const err = { ...RESULT, status: 'error', exitCode: 127, fired: [], outputs: {}, verdict: null, expect: null,
    error: { message: 'script "runTests": no result frame (exit 127)', tail: ['sh: npm: not found'] } };
  mount.appendChild(renderBenchResult(err, { doc, highlight: async (t) => t, renderMarkdown: async () => {}, outputHref: () => '#' }));
  await flush();
  assert.equal(mount.querySelector('.bench-dot').dataset.status, 'error');
  assert.equal(mount.querySelector('.bench-error').textContent, 'script "runTests": no result frame (exit 127)');
  assert.deepEqual([...mount.querySelectorAll('.bench-error-tail div')].map((d) => d.textContent), ['sh: npm: not found']);
  assert.equal(mount.querySelector('.bench-expect'), null, 'no expectation, no expect line');
});

// ---- the controller --------------------------------------------------------

const ok = (data) => ({ ok: true, status: 200, data });
function mountBench(data = DATA, over = {}) {
  // A fresh clone per mount: the controller writes back into `data.cases` /
  // `data.userCases` after a successful write, and the module constants must not
  // drift between tests.
  const live = { ...data, cases: (data.cases || []).map((c) => ({ ...c })), userCases: (data.userCases || []).map((c) => ({ ...c })) };
  const root = render(live, over.caseState ? { caseState: over.caseState } : {});
  doc.body.appendChild(root);
  const calls = [];
  const sent = [];
  const states = [];
  const asked = [];
  const api = {
    bench: async (r) => { calls.push(['bench', r]); return ok({ benchId: 'bench_1' }); },
    benchStop: async (id) => { calls.push(['benchStop', id]); return ok({ ok: true }); },
    benchOutput: (id, port, caseId = null) => `/api/scripts/bench/${id}/output/${port}${caseId ? `?caseId=${caseId}` : ''}`,
    writeCases: async (key, cases) => { calls.push(['writeCases', key, cases]); return ok({ cases }); },
    ...(over.api || {}),
  };
  const ctl = createBenchController({
    root, data: live, api, doc,
    ws: { send: (obj) => sent.push(obj) },
    onCaseState: (key, caseId, state) => states.push([key, caseId, state]),
    getDraft: over.getDraft || (() => null),
    confirm: over.confirm || (async (opts) => { asked.push(opts); return true; }),
    renderMarkdown: async (textValue, host) => { host.textContent = textValue; return host; },
    highlight: async (t) => t,
  });
  return { root, ctl, data: live, calls, sent, states, asked, cleanup: () => { ctl.destroy(); root.remove(); } };
}

test('Run posts the request, subscribes by benchId, and streams lines into the Log pane', async () => {
  const b = mountBench();
  b.root.querySelector('[data-field="in:plan:bound"]').checked = true;
  b.root.querySelector('[data-field="in:plan:text"]').value = '# Plan\n';
  b.root.querySelector('.bench-run').click();
  await flush();
  assert.equal(b.calls[0][0], 'bench');
  assert.deepEqual(b.calls[0][1].inputs, { plan: { text: '# Plan\n' } });
  assert.deepEqual(b.sent, [{ type: 'subscribe', benchId: 'bench_1' }]);
  assert.equal(b.root.querySelector('.bench-status-text').textContent, 'running');
  assert.equal(b.root.querySelector('.bench-stop').disabled, false);
  assert.equal(b.root.querySelector('.bench-run').disabled, true);
  b.ctl.onFrame({ type: 'scriptbench-line', benchId: 'bench_1', caseId: null, stream: 'out', text: '> npm test' });
  b.ctl.onFrame({ type: 'scriptbench-line', benchId: 'other', caseId: null, stream: 'out', text: 'not mine' });
  b.ctl.onFrame({ type: 'scriptbench-line', benchId: 'bench_1', caseId: null, stream: 'out', text: '3 failing' });
  assert.equal(b.root.querySelector('.bench-pane[data-rpane="log"] .bench-log').textContent, '> npm test\n3 failing\n');
  // An ad-hoc run: the engine has no stored case to check against, so its result carries expect: null.
  b.ctl.onFrame({ type: 'scriptbench-done', benchId: 'bench_1', result: { ...RESULT, expect: null } });
  await flush();
  assert.equal(b.root.querySelector('.bench-status-text').textContent, 'blocking');
  assert.equal(b.root.querySelector('.bench-stop').disabled, true);
  assert.equal(b.root.querySelector('.bench-run').disabled, false);
  assert.deepEqual(b.states, [['runTests', null, 'ran']], 'no Expect row filled, nothing to judge');
  assert.equal(b.root.querySelector('.bench-pane[data-rpane="report"] .bench-open-full').getAttribute('href'),
    '/api/scripts/bench/bench_1/output/report', 'a single run needs no caseId');
  b.cleanup();
});

test('Stop asks the server and the stopped result lands as a result', async () => {
  const b = mountBench();
  b.root.querySelector('.bench-run').click();
  await flush();
  b.root.querySelector('.bench-stop').click();
  await flush();
  assert.deepEqual(b.calls.filter((c) => c[0] === 'benchStop'), [['benchStop', 'bench_1']]);
  b.ctl.onFrame({ type: 'scriptbench-done', benchId: 'bench_1', result: { ...RESULT, status: 'stopped', expect: null } });
  await flush();
  assert.equal(b.root.querySelector('.bench-dot').dataset.status, 'stopped');
  b.cleanup();
});

test('a transport error shows the server`s sentence and never leaves the page running', async () => {
  const b = mountBench();
  b.root.querySelector('.bench-run').click();
  await flush();
  b.ctl.onFrame({ type: 'scriptbench-error', benchId: 'bench_1', code: 'BAD_REQUEST', message: 'input "conf" is not valid JSON' });
  await flush();
  assert.equal(b.root.querySelector('.bench-status-text').textContent, 'error');
  assert.equal(b.root.querySelector('.bench-error').textContent, 'input "conf" is not valid JSON');
  assert.equal(b.root.querySelector('.bench-run').disabled, false);
  b.cleanup();
});

test('a BUSY cap hit arrives over the socket AFTER the POST answered, and Run comes back', async () => {
  const b = mountBench();
  b.root.querySelector('.bench-run').click();
  await flush();
  assert.equal(b.root.querySelector('.bench-run').disabled, true, 'the POST succeeded, so the page is running');
  b.ctl.onFrame({ type: 'scriptbench-error', benchId: 'bench_1', code: 'BUSY', message: 'a bench is already running for "runTests"' });
  await flush();
  assert.equal(b.root.querySelector('.bench-error').textContent, 'a bench is already running for "runTests"');
  assert.equal(b.root.querySelector('.bench-run').disabled, false);
  assert.equal(b.root.querySelector('.bench-stop').disabled, true);
  b.cleanup();
});

test('a refused POST is reported without a subscription', async () => {
  const b = mountBench(DATA, { api: { bench: async () => ({ ok: false, status: 429, data: { error: 'two benches are already running' } }) } });
  b.root.querySelector('.bench-run').click();
  await flush();
  assert.deepEqual(b.sent, []);
  assert.equal(b.root.querySelector('.bench-error').textContent, 'two benches are already running');
  assert.equal(b.root.querySelector('.bench-run').disabled, false);
  b.cleanup();
});

test('running a case sends its id and nothing else; the dot follows its expectation', async () => {
  const b = mountBench();
  b.root.querySelector('.bench-case-row[data-case-id="c_failing"] .bench-case').click();
  b.root.querySelector('.bench-run').click();
  await flush();
  assert.equal(b.calls[0][1].caseId, 'c_failing');
  b.ctl.onFrame({ type: 'scriptbench-done', benchId: 'bench_1', result: { ...RESULT, expect: { pass: false, diffs: ['verdict: expected clean, got blocking'] } } });
  await flush();
  assert.deepEqual(b.states, [['runTests', 'c_failing', 'fail']]);
  assert.equal(b.root.querySelector('.bench-expect-state').textContent, 'expect fail');
  assert.deepEqual([...b.root.querySelectorAll('.bench-expect-diff')].map((d) => d.textContent), ['verdict: expected clean, got blocking']);
  assert.equal(b.root.querySelector('.bench-case-row[data-case-id="c_failing"] .script-dot').dataset.state, 'fail');
  b.cleanup();
});

test('a case with no expectation reports `ran`', async () => {
  const data = { ...DATA, cases: [{ ...CASE, expect: null }] };
  const b = mountBench(data);
  b.root.querySelector('.bench-case').click();
  b.root.querySelector('.bench-run').click();
  await flush();
  b.ctl.onFrame({ type: 'scriptbench-done', benchId: 'bench_1', result: { ...RESULT, expect: null } });
  await flush();
  assert.deepEqual(b.states, [['runTests', 'c_failing', 'ran']]);
  b.cleanup();
});

test('Run all sends { all: true }, tags lines per case and aggregates', async () => {
  const b = mountBench();
  b.root.querySelector('.bench-run-all').click();
  await flush();
  assert.equal(b.calls[0][1].all, true);
  assert.equal(b.calls[0][1].caseId, null);
  b.ctl.onFrame({ type: 'scriptbench-line', benchId: 'bench_1', caseId: 'c_failing', stream: 'out', text: 'one' });
  assert.equal(b.root.querySelector('.bench-pane[data-rpane="log"] .bench-log').textContent, '[c_failing] one\n');
  b.ctl.onFrame({ type: 'scriptbench-done', benchId: 'bench_1', result: {
    cases: [{ caseId: 'c_failing', result: { ...RESULT, expect: { pass: true, diffs: [] } } },
      { caseId: 'c_other', result: { ...RESULT, expect: { pass: false, diffs: ['no'] } } },
      { caseId: 'c_third', result: { ...RESULT, expect: null } }],
    passed: 1, failed: 1, unchecked: 1,
  } });
  await flush();
  assert.deepEqual(b.states, [['runTests', 'c_failing', 'pass'], ['runTests', 'c_other', 'fail'], ['runTests', 'c_third', 'ran']]);
  assert.equal(b.root.querySelector('.bench-status-text').textContent, 'passed 1 · failed 1 · unchecked 1');
  // The last case's result is the one on screen, so its truncated output's link
  // has to name WHICH case the server should read.
  assert.equal(b.root.querySelector('.bench-pane[data-rpane="report"] .bench-open-full').getAttribute('href'),
    '/api/scripts/bench/bench_1/output/report?caseId=c_third');
  b.cleanup();
});

test('Use result fills the expect row from the result on screen', async () => {
  const b = mountBench();
  assert.equal(b.root.querySelector('.bench-expect-from-result').disabled, true, 'nothing has run yet');
  b.root.querySelector('.bench-run').click();
  await flush();
  b.ctl.onFrame({ type: 'scriptbench-done', benchId: 'bench_1', result: { ...RESULT, expect: null } });
  await flush();
  const use = b.root.querySelector('.bench-expect-from-result');
  assert.equal(use.disabled, false, 'a single-run result is on screen');
  use.click();
  await flush();
  assert.equal(b.root.querySelector('[data-field="expect:verdict"]').value, 'blocking', 'from result.status');
  assert.deepEqual([...b.root.querySelectorAll('.bench-expect-chip input')].filter((c) => c.checked).map((c) => c.dataset.field),
    ['expect:fired:log', 'expect:fired:fail'], 'from result.fired, intersected with the DECLARED output ports');
  assert.equal(b.root.querySelector('[data-field="expect:summaryIncludes"]').value, '', 'the summary is left alone');
  assert.deepEqual(collectCase(b.root, b.data, { id: 'c-x', name: 'x' }).expect, { verdict: 'blocking', fired: ['log', 'fail'] });
  // The next Run wipes the result pane, so there is nothing on screen to copy any
  // more: the button must go back to disabled rather than offer the old run's verdict.
  b.root.querySelector('.bench-run').click();
  await flush();
  assert.equal(b.root.querySelector('.bench-status-text').textContent, 'running');
  assert.equal(b.root.querySelector('.bench-expect-from-result').disabled, true, 'the previous result is off the screen');
  b.cleanup();
});

test('Use result stays put for a stopped result, and a Run all offers nothing to copy', async () => {
  const b = mountBench();
  b.root.querySelector('.bench-run').click();
  await flush();
  b.ctl.onFrame({ type: 'scriptbench-done', benchId: 'bench_1', result: { ...RESULT, status: 'stopped', fired: [], expect: null } });
  await flush();
  b.root.querySelector('.bench-expect-from-result').click();
  await flush();
  assert.equal(b.root.querySelector('[data-field="expect:verdict"]').value, '', 'stopped is not an expectable verdict');
  b.root.querySelector('.bench-run-all').click();
  await flush();
  b.ctl.onFrame({ type: 'scriptbench-done', benchId: 'bench_1', result: { cases: [{ caseId: 'c_failing', result: RESULT }], passed: 1, failed: 0, unchecked: 0 } });
  await flush();
  assert.equal(b.root.querySelector('.bench-expect-from-result').disabled, true, 'a Run all is not ONE result to copy');
  b.cleanup();
});

test('Save as case writes the whole list back, with the slugged id and the expectation', async () => {
  const b = mountBench();
  b.root.querySelector('[data-field="bench:caseName"]').value = 'lint only';
  b.root.querySelector('[data-field="in:plan:bound"]').checked = true;
  b.root.querySelector('[data-field="in:plan:text"]').value = '# Plan\n';
  const sel = b.root.querySelector('[data-field="expect:verdict"]');
  sel.value = 'clean';
  sel.dispatchEvent(new win.Event('change', { bubbles: true }));
  b.root.querySelector('[data-field="expect:fired:pass"]').checked = true;
  b.root.querySelector('.bench-save-case').click();
  await flush();
  const [, key, cases] = b.calls.find((c) => c[0] === 'writeCases');
  assert.equal(key, 'runTests');
  assert.equal(cases.length, 2, 'the existing case plus the new one');
  assert.equal(cases[1].id, 'lint-only');
  assert.equal(cases[1].name, 'lint only');
  assert.match(cases[1].id, /^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
  assert.deepEqual(cases[1].inputs, { plan: { text: '# Plan\n' } });
  assert.deepEqual(cases[1].cwd, { kind: 'scratch' });
  assert.deepEqual(cases[1].expect, { verdict: 'clean', fired: ['pass'] });
  assert.deepEqual([...b.root.querySelectorAll('.bench-case-row')].map((r) => r.dataset.caseId), ['c_failing', 'lint-only']);
  assert.ok(b.root.querySelector('.bench-case-row[data-case-id="lint-only"] .bench-case').classList.contains('on'),
    'the new case is selected');
  b.cleanup();
});

test('a second case of the same name gets a numbered id', async () => {
  const b = mountBench({ ...DATA, cases: [{ ...CASE, id: 'lint-only', name: 'lint only' }] });
  b.root.querySelector('[data-field="bench:caseName"]').value = 'lint only';
  b.root.querySelector('.bench-save-case').click();
  await flush();
  const [, , cases] = b.calls.find((c) => c[0] === 'writeCases');
  assert.deepEqual(cases.map((c) => c.id), ['lint-only', 'lint-only-2']);
  b.cleanup();
});

test('Save as case on a plugin script writes the W18 overlay, not the shipped file', async () => {
  const b = mountBench(PLUGIN_DATA);
  b.root.querySelector('[data-field="bench:caseName"]').value = 'mine too';
  b.root.querySelector('.bench-save-case').click();
  await flush();
  const [, , cases] = b.calls.find((c) => c[0] === 'writeCases');
  assert.deepEqual(cases.map((c) => c.name), ['my input', 'mine too'], 'the shipped case is not rewritten');
  assert.equal(cases.every((c) => !('writable' in c)), true, 'the render-only flag never reaches the wire');
  b.cleanup();
});

test('Update case overwrites the selected one in place and resets its dot', async () => {
  const b = mountBench(DATA, { caseState: new Map([['runTests', new Map([['c_failing', 'pass']])]]) });
  b.root.querySelector('.bench-case-row[data-case-id="c_failing"] .bench-case').click();
  b.root.querySelector('[data-field="in:plan:text"]').value = '# Plan v2\n';
  b.root.querySelector('.bench-case-update').click();
  await flush();
  const [, , cases] = b.calls.find((c) => c[0] === 'writeCases');
  assert.equal(cases.length, 1, 'overwritten, not appended');
  assert.equal(cases[0].id, 'c_failing', 'the id is stable');
  assert.equal(cases[0].name, 'failing suite');
  assert.deepEqual(cases[0].inputs.plan, { text: '# Plan v2\n' });
  assert.deepEqual(cases[0].expect, { verdict: 'blocking', fired: ['log', 'fail'] }, 'the expect row round-tripped');
  assert.equal(b.root.querySelector('.bench-case-row[data-case-id="c_failing"] .script-dot').dataset.state, 'none',
    'the stored case changed, so the old result no longer describes it');
  assert.deepEqual(b.states, [['runTests', 'c_failing', 'none']]);
  b.cleanup();
});

test('Rename is inline: Enter commits, Escape cancels, and only the name moves', async () => {
  const b = mountBench();
  b.root.querySelector('.bench-case-row[data-case-id="c_failing"] .bench-case-rename').click();
  const box = b.root.querySelector('.bench-case-rename-input');
  assert.equal(box.value, 'failing suite');
  box.value = 'nope';
  box.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await flush();
  assert.equal(b.calls.some((c) => c[0] === 'writeCases'), false);
  assert.equal(b.root.querySelector('.bench-case-row[data-case-id="c_failing"] .bench-case-name').textContent, 'failing suite');

  b.root.querySelector('.bench-case-row[data-case-id="c_failing"] .bench-case-rename').click();
  const box2 = b.root.querySelector('.bench-case-rename-input');
  box2.value = '  still failing  ';
  box2.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await flush();
  const [, , cases] = b.calls.find((c) => c[0] === 'writeCases');
  assert.equal(cases.length, 1);
  assert.equal(cases[0].id, 'c_failing', 'a rename never moves the id');
  assert.equal(cases[0].name, 'still failing');
  assert.deepEqual(cases[0].inputs, CASE.inputs, 'nothing but the name is touched');
  assert.equal(b.root.querySelector('.bench-case-row[data-case-id="c_failing"] .bench-case-name').textContent, 'still failing');
  b.cleanup();
});

test('a blank rename is refused with the same sentence Save uses', async () => {
  const b = mountBench();
  b.root.querySelector('.bench-case-rename').click();
  const box = b.root.querySelector('.bench-case-rename-input');
  box.value = '   ';
  box.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await flush();
  assert.equal(b.calls.some((c) => c[0] === 'writeCases'), false);
  assert.equal(b.root.querySelector('.bench-msg').textContent, 'Name the case first.');
  b.cleanup();
});

test('Delete asks first, then writes the list without it and clears the setup', async () => {
  const b = mountBench();
  b.root.querySelector('.bench-case-row[data-case-id="c_failing"] .bench-case').click();
  b.root.querySelector('.bench-case-row[data-case-id="c_failing"] .bench-case-delete').click();
  await flush();
  assert.deepEqual({ title: b.asked[0].title, message: b.asked[0].message, confirmLabel: b.asked[0].confirmLabel, danger: b.asked[0].danger },
    { title: 'Delete case', message: 'Delete case "failing suite"?', confirmLabel: 'Delete', danger: true });
  const [, , cases] = b.calls.find((c) => c[0] === 'writeCases');
  assert.deepEqual(cases, []);
  assert.equal(b.root.querySelector('.bench-case-row'), null);
  assert.equal(b.root.querySelector('.bench-run-all').disabled, true);
  assert.equal(b.root.querySelector('[data-field="bench:caseName"]').value, '', 'the selected case went, so the setup cleared');
  assert.equal(b.root.querySelector('[data-field="expect:verdict"]').value, '');
  // W15: the list card's dot counts the cases that ran THIS session, so a deleted
  // one must stop colouring it — the `none` report is what drops the entry.
  assert.deepEqual(b.states, [['runTests', 'c_failing', 'none']]);
  b.cleanup();
});

test('a rename or a delete of ANOTHER case leaves the Setup column exactly as it is', async () => {
  const b = mountBench({ ...DATA, cases: [CASE, { ...CASE, id: 'c_other', name: 'other' }] });
  // an ad-hoc setup nobody has saved yet: a write for a different row must not touch it
  b.root.querySelector('[data-field="in:plan:text"]').value = 'TYPED BY HAND';
  b.root.querySelector('[data-field="bench:caseName"]').value = 'my ad hoc';
  b.root.querySelector('.bench-case-row[data-case-id="c_other"] .bench-case-rename').click();
  const box = b.root.querySelector('.bench-case-rename-input');
  box.value = 'other renamed';
  box.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await flush();
  assert.equal(b.root.querySelector('.bench-case-row[data-case-id="c_other"] .bench-case-name').textContent, 'other renamed');
  assert.equal(b.root.querySelector('[data-field="in:plan:text"]').value, 'TYPED BY HAND');
  assert.equal(b.root.querySelector('[data-field="bench:caseName"]').value, 'my ad hoc');

  // ...and an EDIT of the selected case survives a delete of a different one (C18:
  // the italics marker is what says "Run sends what is on screen").
  b.root.querySelector('.bench-case-row[data-case-id="c_failing"] .bench-case').click();
  const ta = b.root.querySelector('[data-field="in:plan:text"]');
  ta.value = '# Plan edited\n';
  ta.dispatchEvent(new win.Event('input', { bubbles: true }));
  assert.equal(b.root.querySelector('.bench-case-row[data-case-id="c_failing"]').dataset.edited, 'true');
  b.root.querySelector('.bench-case-row[data-case-id="c_other"] .bench-case-delete').click();
  await flush();
  assert.equal(b.root.querySelector('[data-field="in:plan:text"]').value, '# Plan edited\n');
  assert.equal(b.root.querySelector('.bench-case-row[data-case-id="c_failing"]').dataset.edited, 'true');
  assert.ok(b.root.querySelector('.bench-case-row[data-case-id="c_failing"] .bench-case').classList.contains('on'),
    'the selection is re-applied to the freshly painted rows');
  b.cleanup();
});

test('two case writes at once: the second waits and rebases on the first`s list', async () => {
  const sentLists = [];
  let gate = null;
  const b = mountBench(DATA, {
    api: {
      writeCases: async (key, cases) => {
        sentLists.push(cases.map((c) => c.id));
        if (sentLists.length === 1) await new Promise((r) => { gate = r; });
        return { ok: true, status: 200, data: { cases } };
      },
    },
  });
  b.root.querySelector('[data-field="bench:caseName"]').value = 'brand new';
  b.root.querySelector('.bench-save-case').click();                  // held open below
  await flush();
  b.root.querySelector('.bench-case-row[data-case-id="c_failing"] .bench-case-rename').click();
  const box = b.root.querySelector('.bench-case-rename-input');
  box.value = 'renamed mid-save';
  box.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await flush();
  assert.deepEqual(sentLists, [['c_failing', 'brand-new']], 'the rename does not send its own list yet');
  gate();
  await flush(8);
  assert.deepEqual(sentLists[1], ['c_failing', 'brand-new'], 'the rename rebased: the new case is still there');
  assert.deepEqual([...b.root.querySelectorAll('.bench-case .bench-case-name')].map((n) => n.textContent),
    ['renamed mid-save', 'brand new']);
  b.cleanup();

  // A double click on Save as case is ONE case, not a duplicate-id refusal.
  const twice = [];
  const d = mountBench(DATA, { api: { writeCases: async (key, cases) => { twice.push(cases.map((c) => c.id)); return { ok: true, status: 200, data: { cases } }; } } });
  d.root.querySelector('[data-field="bench:caseName"]').value = 'brand new';
  d.root.querySelector('.bench-save-case').click();
  d.root.querySelector('.bench-save-case').click();
  await flush(8);
  assert.deepEqual(twice, [['c_failing', 'brand-new']]);
  d.cleanup();
});

test('a write that lands after the tab was left still updates the list the next mount renders', async () => {
  let gate = null;
  const b = mountBench(DATA, {
    api: { writeCases: async (key, cases) => { await new Promise((r) => { gate = r; }); return { ok: true, status: 200, data: { cases } }; } },
  });
  b.root.querySelector('.bench-case-row[data-case-id="c_failing"] .bench-case-rename').click();
  const box = b.root.querySelector('.bench-case-rename-input');
  box.value = 'renamed on the way out';
  box.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await flush();
  b.ctl.destroy();                       // a tab hop: scripts-view unmounts the bench mid-write
  gate();
  await flush(8);
  // The rename IS stored. `data` is what the Test tab paints on the way back and what
  // the next case action sends as the whole list, so a stale copy undoes this write.
  assert.deepEqual(b.data.cases.map((c) => c.name), ['renamed on the way out']);
  b.root.remove();
});

test('a cancelled Delete writes nothing', async () => {
  const b = mountBench(DATA, { confirm: async () => false });
  b.root.querySelector('.bench-case-delete').click();
  await flush();
  assert.equal(b.calls.some((c) => c[0] === 'writeCases'), false);
  assert.equal(b.root.querySelectorAll('.bench-case-row').length, 1);
  b.cleanup();
});

test('a refused write shows the store`s sentence verbatim and keeps the list on screen', async () => {
  const b = mountBench(DATA, { api: { writeCases: async () => ({ ok: false, status: 400, data: { error: 'case name is longer than 80 characters' } }) } });
  b.root.querySelector('[data-field="bench:caseName"]').value = 'too long';
  b.root.querySelector('.bench-save-case').click();
  await flush();
  assert.equal(b.root.querySelector('.bench-msg').textContent, 'case name is longer than 80 characters');
  assert.deepEqual([...b.root.querySelectorAll('.bench-case-row')].map((r) => r.dataset.caseId), ['c_failing']);
  b.cleanup();
});

test('Save as case refuses a nameless case and the 33rd one; Update still works at the cap', async () => {
  const b = mountBench();
  b.root.querySelector('.bench-save-case').click();
  await flush();
  assert.equal(b.calls.some((c) => c[0] === 'writeCases'), false);
  assert.equal(b.root.querySelector('.bench-msg').textContent, 'Name the case first.');
  b.cleanup();

  assert.equal(MAX_CASES, 32);
  const many = { ...DATA, cases: Array.from({ length: MAX_CASES }, (_, i) => ({ ...CASE, id: `c-${i + 1}`, name: `case ${i}` })) };
  const full = mountBench(many);
  full.root.querySelector('[data-field="bench:caseName"]').value = 'one more';
  full.root.querySelector('.bench-save-case').click();
  await flush();
  assert.equal(full.calls.some((c) => c[0] === 'writeCases'), false);
  assert.equal(full.root.querySelector('.bench-msg').textContent, '32 cases is the limit.');
  // Update REPLACES, so the cap must not block it.
  full.root.querySelector('.bench-case-row[data-case-id="c-1"] .bench-case').click();
  full.root.querySelector('.bench-case-update').click();
  await flush();
  assert.equal(full.calls.filter((c) => c[0] === 'writeCases').length, 1);
  full.cleanup();
});

test('an unsaved draft rides with the run and lights the chip', async () => {
  const draft = { meta: META, source: '#!/bin/sh\nnpm run lint\n', sourceWin32: null };
  const b = mountBench(DATA, { getDraft: () => draft });
  b.root.querySelector('.bench-run').click();
  await flush();
  assert.deepEqual(b.calls[0][1].draft, draft);
  b.ctl.onFrame({ type: 'scriptbench-done', benchId: 'bench_1', result: { ...RESULT, draft: true } });
  await flush();
  assert.equal(b.root.querySelector('.bench-draft').hidden, false);
  assert.equal(b.root.querySelector('.bench-draft').textContent, 'unsaved draft');
  b.cleanup();
});

test('+ Case clears the setup, the expectation and the selection', async () => {
  const b = mountBench();
  b.root.querySelector('.bench-case').click();
  b.root.querySelector('.bench-add-case').click();
  assert.equal(b.root.querySelector('.bench-case.on'), null);
  assert.equal(b.root.querySelector('.bench-case-update'), null, 'nothing selected, nothing to update');
  assert.equal(b.root.querySelector('[data-field="in:plan:bound"]').checked, false);
  assert.equal(b.root.querySelector('[data-field="in:plan:text"]').value, '');
  assert.equal(b.root.querySelector('[data-field="bench:caseName"]').value, '');
  assert.equal(b.root.querySelector('[data-field="expect:verdict"]').value, '');
  assert.equal(b.root.querySelector('.bench-expect-chip'), null);
  b.cleanup();
});

test('destroy stops consuming frames', async () => {
  const b = mountBench();
  b.root.querySelector('.bench-run').click();
  await flush();
  b.ctl.destroy();
  b.ctl.onFrame({ type: 'scriptbench-done', benchId: 'bench_1', result: RESULT });
  await flush();
  assert.equal(b.root.querySelector('.bench-status-text').textContent, 'running', 'nothing repainted after destroy');
  b.root.remove();
});

test('an ad-hoc run with the Expect row filled is judged client-side, by the shared evaluateExpect', async () => {
  const b = mountBench();
  const sel = b.root.querySelector('[data-field="expect:verdict"]');
  sel.value = 'clean';
  sel.dispatchEvent(new win.Event('change', { bubbles: true }));
  b.root.querySelector('.bench-run').click();
  await flush();
  assert.equal(b.calls[0][1].caseId, null);
  b.ctl.onFrame({ type: 'scriptbench-done', benchId: 'bench_1', result: { ...RESULT, expect: null } });
  await flush();
  assert.equal(b.root.querySelector('.bench-expect-state').textContent, 'expect fail', 'clean expected, blocking got');
  assert.deepEqual([...b.root.querySelectorAll('.bench-expect-diff')].map((d) => d.textContent),
    ['expected clean, got blocking']);
  assert.deepEqual(b.states, [['runTests', null, 'fail']]);
  b.cleanup();
});

test('a selected case whose Setup was edited runs AD HOC: what is on screen, not the stored case', async () => {
  const b = mountBench();
  b.root.querySelector('.bench-case-row[data-case-id="c_failing"] .bench-case').click();
  const row = b.root.querySelector('.bench-case-row[data-case-id="c_failing"]');
  assert.equal(row.dataset.edited, undefined, 'filling the Setup from the case is not an edit');
  const ta = b.root.querySelector('[data-field="in:plan:text"]');
  ta.value = '# Plan v2\n';
  ta.dispatchEvent(new win.Event('input', { bubbles: true }));
  assert.equal(row.dataset.edited, 'true');
  b.root.querySelector('.bench-run').click();
  await flush();
  assert.equal(b.calls[0][1].caseId, null, 'the engine would run the STORED case and ignore the edit (§4.2)');
  assert.deepEqual(b.calls[0][1].inputs.plan, { text: '# Plan v2\n' });
  b.ctl.onFrame({ type: 'scriptbench-done', benchId: 'bench_1', seq: 1, result: { ...RESULT, expect: null } });
  await flush();
  assert.equal(row.querySelector('.script-dot').dataset.state, 'none', 'the stored case did not run, so its dot is left alone');
  assert.equal(b.root.querySelector('.bench-expect-state').textContent, 'expect pass', 'the Expect row on screen was judged here');
  b.root.querySelector('.bench-case-update').click();
  await flush();
  assert.equal(b.root.querySelector('.bench-case-row[data-case-id="c_failing"]').dataset.edited, undefined, 'Update commits the edit');
  b.root.querySelector('.bench-run').click();
  await flush();
  assert.equal(b.calls.filter((c) => c[0] === 'bench')[1][1].caseId, 'c_failing');
  b.cleanup();
});

test('frames that beat the POST answer are kept, and a frame delivered twice is shown once', async () => {
  let answer;
  const b = mountBench(DATA, { api: { bench: () => new Promise((r) => { answer = () => r(ok({ benchId: 'bench_9' })); }) } });
  b.root.querySelector('.bench-run').click();
  await flush();
  // The server broadcasts the moment the bench starts: a fast script is DONE before the POST resolves.
  b.ctl.onFrame({ type: 'scriptbench-line', benchId: 'bench_9', seq: 1, caseId: null, stream: 'out', text: 'one' });
  b.ctl.onFrame({ type: 'scriptbench-line', benchId: 'other', seq: 1, caseId: null, stream: 'out', text: 'not mine' });
  b.ctl.onFrame({ type: 'scriptbench-done', benchId: 'bench_9', seq: 2, result: { ...RESULT, expect: null } });
  answer();
  await flush();
  assert.equal(b.root.querySelector('.bench-status-text').textContent, 'blocking', 'not stuck on running');
  assert.equal(b.root.querySelector('.bench-pane[data-rpane="log"] .bench-log').textContent, 'one\n');
  // …and the subscribe replay re-delivers both: seq keeps the second copy out.
  b.ctl.onFrame({ type: 'scriptbench-line', benchId: 'bench_9', seq: 1, caseId: null, stream: 'out', text: 'one' });
  b.ctl.onFrame({ type: 'scriptbench-done', benchId: 'bench_9', seq: 2, result: { ...RESULT, expect: null } });
  await flush();
  assert.equal(b.root.querySelector('.bench-pane[data-rpane="log"] .bench-log').textContent, 'one\n');
  b.cleanup();
});

test('selecting another case resets every declared param, not only the ones the case names', async () => {
  const data = { ...DATA, cases: [{ ...CASE, id: 'a', name: 'a', params: { command: 'npm run lint' } }, { ...CASE, id: 'b', name: 'b', params: {} }] };
  const b = mountBench(data);
  b.root.querySelector('.bench-case-row[data-case-id="a"] .bench-case').click();
  assert.equal(b.root.querySelector('[data-field="param:command"]').value, 'npm run lint');
  b.root.querySelector('.bench-case-row[data-case-id="b"] .bench-case').click();
  assert.equal(b.root.querySelector('[data-field="param:command"]').value, 'npm test', 'back to the sidecar default');
  b.cleanup();
});

// ---- the bench's own port editor, the orphaned bench and the Run-all draft ----

const CFG_META = { ...META, ports: 'config', inputs: undefined, outputs: undefined,
  defaultPorts: { inputs: [{ id: 'in', type: 'md', required: false }],
    outputs: [{ id: 'log', type: 'md', when: 'always', filename: 'o.md' }] } };
const CFG_CASE = { id: 'c_cfg', name: 'own ports', params: {}, cwd: { kind: 'scratch' }, timeoutMs: null, expect: null,
  ports: { inputs: [{ id: 'data', type: 'md', required: false }], outputs: [{ id: 'log', type: 'md', when: 'always', filename: 'o.md' }] },
  inputs: { data: { text: 'from the case' } } };
const CFG = { ...DATA, meta: CFG_META, cases: [CFG_CASE], userCases: [] };

test('a config-ported script: editing a port id moves the Inputs row with it, so the binding still reaches the run', async () => {
  const b = mountBench(CFG);
  const bound = b.root.querySelector('[data-field="in:in:bound"]');
  bound.checked = true;
  b.root.querySelector('[data-field="in:in:text"]').value = 'hello';
  const id = b.root.querySelector('.bench-setup [data-field="port:inputs:0:id"]');
  id.value = 'data';
  id.dispatchEvent(new win.Event('change', { bubbles: true }));
  await flush();
  assert.deepEqual([...b.root.querySelectorAll('.bench-port')].map((p) => p.dataset.port), ['data'],
    'the Inputs row follows the port the user renamed');
  const req = collectBenchRequest(b.root, b.data);
  assert.deepEqual(req.ports.inputs.map((p) => p.id), ['data']);
  assert.deepEqual(req.inputs, { data: { text: 'hello' } }, 'the text typed for that port is not silently dropped');
  b.cleanup();
});

test('a config-ported script: + input adds a row to the BENCH, and the Expect chips follow the outputs', async () => {
  const b = mountBench(CFG);
  b.root.querySelector('.bench-setup [data-port-add="inputs"]').click();
  await flush();
  assert.deepEqual([...b.root.querySelectorAll('.bench-port')].map((p) => p.dataset.port), ['in', 'in2']);
  const sel = b.root.querySelector('[data-field="expect:verdict"]');
  sel.value = 'clean';
  sel.dispatchEvent(new win.Event('change', { bubbles: true }));
  b.root.querySelector('.bench-setup [data-port-add="outputs"]').click();
  await flush();
  assert.deepEqual([...b.root.querySelectorAll('.bench-expect-chip input')].map((c) => c.dataset.field),
    ['expect:fired:log', 'expect:fired:out'], 'the chips are the ports the bench declares now');
  b.root.querySelector('.bench-setup .ins-prow[data-dir="inputs"][data-index="1"] .ins-prm').click();
  await flush();
  assert.deepEqual([...b.root.querySelectorAll('.bench-port')].map((p) => p.dataset.port), ['in']);
  b.cleanup();
});

test('a config-ported script: switching an output`s type reshapes its row, filename box and all', async () => {
  const b = mountBench(CFG);
  const type = b.root.querySelector('.bench-setup .ins-prow[data-dir="outputs"] [data-field="port:outputs:0:type"]');
  assert.equal(b.root.querySelector('.bench-setup .ins-prow[data-dir="outputs"] .ins-pfile').hidden, false);
  type.value = 'void';
  type.dispatchEvent(new win.Event('change', { bubbles: true }));
  await flush();
  assert.equal(b.root.querySelector('.bench-setup .ins-prow[data-dir="outputs"] .ins-pfile').hidden, true,
    'a void output has no filename — the box goes, as it does on the Overview form');
  const back = b.root.querySelector('.bench-setup .ins-prow[data-dir="outputs"] [data-field="port:outputs:0:type"]');
  back.value = 'md';
  back.dispatchEvent(new win.Event('change', { bubbles: true }));
  await flush();
  assert.equal(b.root.querySelector('.bench-setup .ins-prow[data-dir="outputs"] .ins-pfile').hidden, false);
  // An INPUT's type change still keeps every other row's text.
  b.root.querySelector('[data-field="in:in:text"]').value = 'kept';
  const itype = b.root.querySelector('.bench-setup .ins-prow[data-dir="inputs"] [data-field="port:inputs:0:type"]');
  itype.value = 'json';
  itype.dispatchEvent(new win.Event('change', { bubbles: true }));
  await flush();
  assert.equal(b.root.querySelector('.bench-port').dataset.type, 'json');
  assert.equal(b.root.querySelector('[data-field="in:in:text"]').value, 'kept');
  b.cleanup();
});

test('a config-ported case carries its own port set, and selecting it restores it', async () => {
  const b = mountBench(CFG);
  b.root.querySelector('.bench-case-row[data-case-id="c_cfg"] .bench-case').click();
  await flush();
  assert.deepEqual([...b.root.querySelectorAll('.bench-setup .ins-prow[data-dir="inputs"] .ins-pid')].map((n) => n.value), ['data']);
  assert.deepEqual([...b.root.querySelectorAll('.bench-port')].map((p) => p.dataset.port), ['data']);
  assert.equal(b.root.querySelector('[data-field="in:data:text"]').value, 'from the case');
  b.cleanup();
});

test('destroy stops the bench it started, so the per-key slot is not held by a tab nobody is looking at', async () => {
  const b = mountBench();
  b.root.querySelector('.bench-run').click();
  await flush();
  b.ctl.destroy();
  await flush();
  assert.deepEqual(b.calls.filter((c) => c[0] === 'benchStop').map((c) => c[1]), ['bench_1']);
  b.root.remove();
});

test('destroy while the POST is still in flight stops the bench as soon as the answer names it', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const b = mountBench(DATA, { api: { bench: async () => { await gate; return ok({ benchId: 'bench_late' }); } } });
  b.root.querySelector('.bench-run').click();
  await flush();
  b.ctl.destroy();                                  // no benchId yet: nothing to stop
  assert.equal(b.calls.some((c) => c[0] === 'benchStop'), false);
  release();
  await flush(6);
  assert.deepEqual(b.calls.filter((c) => c[0] === 'benchStop').map((c) => c[1]), ['bench_late']);
  b.root.remove();
});

test('Stop pressed while the POST is still in flight stops the bench once the answer names it', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const b = mountBench(DATA, { api: { bench: async () => { await gate; return ok({ benchId: 'bench_late' }); } } });
  b.root.querySelector('.bench-run').click();
  await flush();
  assert.equal(b.root.querySelector('.bench-stop').disabled, false, 'Stop is live from the first frame of the run');
  b.root.querySelector('.bench-stop').click();       // no benchId yet: nothing to post
  await flush();
  assert.equal(b.calls.some((c) => c[0] === 'benchStop'), false);
  release();
  await flush(6);
  assert.deepEqual(b.calls.filter((c) => c[0] === 'benchStop').map((c) => c[1]), ['bench_late'],
    'the wish is honoured, never posted with an empty benchId');
  b.cleanup();
});

test('destroy asks for no stop when nothing is running', async () => {
  const b = mountBench();
  b.root.querySelector('.bench-run').click();
  await flush();
  b.ctl.onFrame({ type: 'scriptbench-done', benchId: 'bench_1', seq: 1, result: { ...RESULT, expect: null } });
  await flush();
  b.ctl.destroy();
  await flush();
  assert.equal(b.calls.some((c) => c[0] === 'benchStop'), false);
  b.root.remove();
});

test('Run all carries the unsaved draft too — the cases must not run yesterday`s program', async () => {
  const draft = { meta: META, source: '#!/bin/sh\nnpm run lint\n', sourceWin32: null };
  const b = mountBench(DATA, { getDraft: () => draft });
  b.root.querySelector('.bench-run-all').click();
  await flush();
  assert.equal(b.calls[0][1].all, true);
  assert.deepEqual(b.calls[0][1].draft, draft);
  b.cleanup();
});

test('an output port named verdict or envelope gets its own pane, not the fixed one', () => {
  const clash = { ...RESULT, fired: ['verdict'], outputs: {
    verdict: { type: 'md', path: '/b/v.md', bytes: 3, text: '# from the port', truncated: false },
    envelope: { type: 'json', path: '/b/e.json', bytes: 3, text: '{"a":1}', truncated: false },
  } };
  const frag = renderBenchResult(clash, { doc, highlight: async (t) => t, outputHref: () => '#',
    renderMarkdown: async (textValue, mount) => { mount.textContent = textValue; return mount; } });
  const host = doc.createElement('div');
  host.appendChild(frag);
  const panes = [...host.querySelectorAll('.bench-pane')].map((p) => p.dataset.rpane);
  assert.deepEqual(panes, [...new Set(panes)], 'no two panes answer to the same tab');
  assert.deepEqual(panes, ['log', 'verdict-out', 'envelope-out', 'verdict', 'envelope']);
  assert.equal(host.querySelector('.bench-pane[data-rpane="verdict"] code').textContent.includes('exited 1'), true,
    'the fixed verdict tab still shows the sidecar verdict, not the port');
  assert.equal(host.querySelector('.bench-pane[data-rpane="verdict-out"] .bench-raw').textContent, 'Raw',
    'the port`s own md pane, beside the fixed verdict tab');
  // PORT_ID_RE admits `constructor`, and OUT_PANE is a plain object: an unguarded
  // lookup answers with Object.prototype.constructor, which stringifies into the
  // attribute as "function Object() { [native code] }".
  const proto = { ...RESULT, fired: [], expect: null, verdict: null, outputs: {
    constructor: { type: 'json', path: '/b/c.json', bytes: 2, text: '{}', truncated: false } } };
  const protoHost = doc.createElement('div');
  protoHost.appendChild(renderBenchResult(proto, { doc, highlight: async (t) => t, outputHref: () => '#',
    renderMarkdown: async (textValue, mount) => { mount.textContent = textValue; return mount; } }));
  assert.ok(protoHost.querySelector('.bench-pane[data-rpane="constructor"]'),
    'a port named `constructor` gets its own pane id');
  assert.deepEqual([...protoHost.querySelectorAll('.bench-tabs button')].map((b) => b.dataset.rtab),
    ['log', 'constructor', 'verdict', 'envelope']);
});

test('the module`s DEFAULT highlighter ESCAPES: nothing reaches innerHTML raw (C11)', async () => {
  // the old detail page's default was fixed in cycle 2; this module still defaulted
  // to the identity, and that default reaches two innerHTML sinks (the params
  // form's code editor and the json output pane). Not reachable through app.js,
  // which always injects scriptHighlight — but the default is the guard.
  const root = renderBench(DATA, { doc, projects: [] });          // no highlight injected
  doc.body.appendChild(root);
  const ctl = createBenchController({
    root, data: DATA, doc,                                        // no highlight injected
    api: { bench: async () => ok({ benchId: 'b1' }), benchStop: async () => ok({ ok: true }),
      benchOutput: () => '#', writeCases: async (k, c) => ok({ cases: c }) },
    ws: { send: () => {} }, onCaseState: () => {}, getDraft: () => null,
    renderMarkdown: async (textValue, host) => { host.textContent = textValue; return host; },
  });
  root.querySelector('.bench-run').click();
  await flush();
  const nasty = '<img src=x onerror="window.__pwned=1">';
  ctl.onFrame({ type: 'scriptbench-done', benchId: 'b1', result: { ...RESULT, expect: null, fired: [],
    outputs: { report: { type: 'json', path: '/b/r.json', bytes: 9, text: nasty, truncated: false } } } });
  await flush(6);
  const pane = root.querySelector('.bench-pane[data-rpane="report"]');
  assert.equal(pane.querySelectorAll('img').length, 0, 'the default escapes, exactly as code-editor.mjs does');
  assert.equal(pane.querySelector('code').textContent, nasty);
  ctl.destroy();
  root.remove();
});

test('the case dots are really painted: the .script-dot rules are not scoped to the list card', () => {
  // The bench's case rows carry `i.script-dot` too (spec §5.3: green pass, red
  // fail, grey ran, hollow not-run). A `.script-card`-scoped rule leaves them
  // 0x0 and transparent, and a jsdom dataset assertion cannot see it.
  const lines = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8').split('\n');
  const ruleFor = (sel) => lines.find((l) => l.includes(sel)) || '';
  for (const sel of ['.script-dot{', '.script-dot[data-state="pass"]', '.script-dot[data-state="fail"]', '.script-dot[data-state="ran"]']) {
    const rule = ruleFor(sel);
    assert.ok(rule, `no rule for ${sel}`);
    assert.equal(rule.includes('.script-card'), false, `${sel} must reach the bench's case rows, not only the list card`);
  }
});

test('setMeta: a changed declaration re-renders params and input rows IN PLACE, keeping what was typed by id; the next request uses it', async () => {
  const b = mountBench();
  b.root.querySelector('[data-field="in:plan:bound"]').checked = true;
  b.root.querySelector('[data-field="in:plan:text"]').value = '# Plan\n';
  b.root.querySelector('[data-field="param:command"]').value = 'npm run lint';
  b.root.querySelector('.bench-result-body').dataset.marker = 'kept';
  b.ctl.setMeta({ ...META,
    inputs: [{ id: 'plan', type: 'md', required: false }, { id: 'diff', type: 'md', required: false }],
    outputs: [{ id: 'log', type: 'md', when: 'always', filename: 'l.md' }],
    params: [{ id: 'command', type: 'command', required: true }, { id: 'limit', type: 'number', default: 5 }] });
  assert.deepEqual([...b.root.querySelectorAll('.bench-port')].map((p) => p.dataset.port), ['plan', 'diff']);
  assert.equal(b.root.querySelector('[data-field="in:plan:bound"]').checked, true);
  assert.equal(b.root.querySelector('[data-field="in:plan:text"]').value, '# Plan\n');
  assert.equal(b.root.querySelector('[data-field="param:command"]').value, 'npm run lint', 'a typed param value survives');
  assert.equal(b.root.querySelector('[data-field="param:limit"]').value, '5', 'a new param shows its default');
  assert.equal(b.root.querySelector('.bench-result-body').dataset.marker, 'kept', 'never a remount');
  assert.equal(b.data.meta.inputs.length, 2, 'the tree`s data follows the declaration');
  b.root.querySelector('.bench-run').click();
  await flush();
  assert.deepEqual(Object.keys(b.calls[0][1].inputs), ['plan']);
  assert.deepEqual(b.calls[0][1].params, { command: 'npm run lint', limit: 5 });
  b.cleanup();
});

test('setMeta: the Expect chips follow the new outputs, and a selected case is not marked edited by the re-render', async () => {
  const b = mountBench();
  b.root.querySelector('.bench-case-row[data-case-id="c_failing"] .bench-case').click();
  b.ctl.setMeta({ ...META, outputs: [{ id: 'log', type: 'md', when: 'always', filename: 'l.md' }, { id: 'extra', type: 'void', when: 'always' }] });
  assert.deepEqual([...b.root.querySelectorAll('[data-field^="expect:fired:"]')].map((c) => c.dataset.field), ['expect:fired:log', 'expect:fired:extra']);
  assert.equal(b.root.querySelector('.bench-case-row[data-case-id="c_failing"]').dataset.edited, undefined);
  b.cleanup();
});

test('unsaved: the case actions are off with a title, Run all is inert, run() and stop() are exposed and Test runs the draft', async () => {
  const root = render(DATA, { unsaved: true });
  doc.body.appendChild(root);
  const calls = [];
  const api = {
    bench: async (req) => { calls.push(req); return { ok: true, status: 200, data: { benchId: 'bench_9' } }; },
    benchStop: async (id) => { calls.push(['stop', id]); return { ok: true, status: 200, data: { ok: true } }; },
    writeCases: async () => ({ ok: true, status: 200, data: { cases: [] } }),
    benchOutput: () => '',
  };
  const ctl = createBenchController({ root, data: { ...DATA }, api, doc, getDraft: () => ({ meta: META, source: 'x' }), highlight: async (t) => t });
  for (const sel of ['.bench-save-case', '.bench-add-case', '.bench-run-all']) {
    assert.equal(root.querySelector(sel).disabled, true, sel);
    assert.equal(root.querySelector(sel).title, 'Save the script first', sel);
  }
  assert.equal(root.querySelector('[data-field="bench:caseName"]').disabled, true);
  root.querySelector('.bench-run-all').click();
  await flush();
  assert.equal(calls.length, 0, 'a disabled Run all fires nothing');
  assert.equal(typeof ctl.run, 'function');
  assert.equal(typeof ctl.stop, 'function');
  ctl.run();
  await flush();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].draft, { meta: META, source: 'x' });
  assert.equal(root.querySelector('.bench-run').disabled, true);
  ctl.stop();
  await flush();
  assert.deepEqual(calls[1], ['stop', 'bench_9']);
  ctl.destroy();
  root.remove();
});
