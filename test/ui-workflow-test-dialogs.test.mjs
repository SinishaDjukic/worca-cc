// test/ui-workflow-test-dialogs.test.mjs — Use this run as a test example (board 3, C4), the run picker (G7), and the
// rule for the run page's ⋯ item (G6), and Test a version with its Connectors section (boards 4, 30; C12, C16, C19).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { openFromRunDialog, openPickRunDialog, canUseAsExample, openTestVersionDialog, scriptCaution, engineNoteLine, fileServerOffLine }
  from '../ui/public/workflows/test-dialogs.mjs';
import * as serverConnectors from '../src/core/workflow-tests/connectors.mjs';
import { runStatusBadge } from '../ui/public/workflows/test-ui.mjs';
import { AUTO_WORKFLOW_ID } from '../src/core/graph/builtin-workflows.mjs';

const dom = () => { const d = new JSDOM('<!doctype html><body></body>'); return { doc: d.window.document, win: d.window }; };
const tick = () => new Promise((r) => setTimeout(r, 0));
const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
const past = (over = {}) => ({
  pipelineId: 'abcd1234', workflowId: 'wf_b', workflowName: 'Product brief writer', title: 'Saved filters for reports',
  request: 'Write the brief.', files: ['reports-interviews.md', 'usage.csv'],
  qa: [{ question: 'Who uses filters?', answer: 'Analysts' }, { question: 'Which reports?', answer: 'Monthly' }],
  use: 4, useLabel: 'v4', testable: true, reason: null, reasonText: null, ...over,
});

test('board 3: the heading, what is kept, the verdict and its hint, and what is sent', async () => {
  const { doc, win } = dom();
  let sent = null;
  openFromRunDialog({ doc, win, past: past(), onSubmit: async (b) => { sent = b; return { ok: true }; } });
  assert.equal(doc.querySelector('#mk-dialog-title').textContent, 'Use this run as a test example');
  assert.equal(doc.querySelector('.wft-fr-intro').textContent, 'Worca keeps the request and files, so every new version of Product brief writer can be tried on exactly the same thing.');
  assert.equal(doc.querySelector('#wft-fr-name').value, 'Saved filters for reports');
  assert.deepEqual([...doc.querySelectorAll('.wft-keep .wft-chk')].map((l) => l.textContent), [
    'The request and its 2 files (reports-interviews.md, usage.csv)',
    'The 2 questions Worca asked and your answers, so the test can run without you',
  ]);
  assert.ok(doc.querySelector('#wft-fr-request').checked && doc.querySelector('#wft-fr-answers').checked);
  assert.ok([...doc.querySelectorAll('.wft-keep input')].every((b) => b.classList.contains('wft-keep-box')), 'the listed picker token (ui-shared-controls)');
  const hint = doc.querySelector('.wft-fr-hint');
  assert.equal(hint.hidden, true, 'no verdict, no hint');
  assert.equal(hint.getAttribute('aria-live'), 'polite', 'what the verdict means is announced');
  const keepBox = doc.querySelector('.wft-keep');
  assert.equal(keepBox.getAttribute('role'), 'group');
  assert.equal(doc.getElementById(keepBox.getAttribute('aria-labelledby')).textContent, 'Keep from this run');
  click([...doc.querySelectorAll('.seg button')].find((b) => b.textContent === 'Not good enough'));
  assert.deepEqual([hint.hidden, hint.textContent], [false, 'This result came from v4 and was not good enough, so v4 shows as not good on this example until it is tested.']);
  click([...doc.querySelectorAll('.seg button')].find((b) => b.textContent === 'Good: keep it like this'));
  assert.equal(hint.textContent, 'This result came from v4 and was good, so v4 shows as good on this example until it is tested.');
  doc.querySelector('#wft-fr-answers').checked = false;
  doc.querySelector('#wft-fr-note').value = 'It should say how many people use filters today.';
  click(doc.querySelector('.wft-dlg-ok'));
  await tick();
  assert.deepEqual(sent, { name: 'Saved filters for reports', keepRequest: true, keepAnswers: false, verdict: 'good', note: 'It should say how many people use filters today.' });
  assert.equal(doc.querySelector('#mk-dialog'), null, 'closes on success');
});

test('one file, no questions, no name: the words follow, and a name is needed', async () => {
  const { doc, win } = dom();
  openFromRunDialog({ doc, win, past: past({ files: ['usage.csv'], qa: [], title: '' }), onSubmit: async () => ({ ok: false, error: 'Never sent.' }) });
  assert.deepEqual([...doc.querySelectorAll('.wft-keep .wft-chk')].map((l) => l.textContent), ['The request and its file (usage.csv)']);
  click(doc.querySelector('.wft-dlg-ok'));
  await tick();
  assert.equal(doc.querySelector('.wft-dlg-error').textContent, 'Give the example a name.');
});

test('G7: pick a past run, then Next', async () => {
  const { doc, win } = dom();
  const picked = [];
  openPickRunDialog({ doc, win, workflowName: 'Product brief writer', dateText: () => '14 Oct', onPick: (id) => picked.push(id),
    runs: [{ pipelineId: 'p1', title: 'Bulk invoice export', at: 'x', status: 'done', files: 2, sameAs: null },
      { pipelineId: 'p2', title: 'Saved filters', at: 'x', status: 'error', files: 0, sameAs: null }] });
  assert.equal(doc.querySelector('#mk-dialog-title').textContent, 'Add from a past run');
  assert.equal(doc.querySelector('.mk-dialog-body > .hint').textContent, 'Pick a run of Product brief writer to keep as an example.');
  assert.deepEqual([...doc.querySelectorAll('.wft-pick-row')].map((r) => r.textContent), ['Bulk invoice export · 14 Oct · Finished', 'Saved filters · 14 Oct · Failed']);
  click(doc.querySelector('.wft-dlg-ok'));
  await tick();
  assert.equal(doc.querySelector('.wft-dlg-error').textContent, 'Pick a run first.');
  doc.querySelectorAll('.wft-pick-row input')[1].checked = true;
  click(doc.querySelector('.wft-dlg-ok'));
  await tick();
  assert.deepEqual(picked, ['p2']);
  const empty = dom();
  openPickRunDialog({ doc: empty.doc, win: empty.win, workflowName: 'Product brief writer', runs: [], dateText: () => '', onPick: () => {} });
  assert.equal(empty.doc.querySelector('.mk-dialog-body > .hint').textContent, 'Worca found no runs of Product brief writer yet. Run the workflow once, or write an example yourself.');
  assert.equal(empty.doc.querySelector('.wft-dlg-ok').disabled, true, 'board 25: nothing to pick, Next is disabled');
});

test('G6: only a finished no-project run (3a: or a single-project git run, D65) of a saved user workflow, with the flag on', () => {
  const ok = { flag: true, noProject: true, status: 'done', templateId: 'wf_b', reserved: false };
  assert.equal(canUseAsExample(ok), true);
  assert.equal(canUseAsExample({ ...ok, status: 'error' }), true);
  assert.equal(canUseAsExample({ ...ok, noProject: false, projectRun: true }), true, '3a: a single-project git run');
  for (const bad of [{ flag: false }, { noProject: false }, { status: 'running' }, { templateId: null }, { reserved: true }, { templateId: 'wfp_acme_brief' }, { templateId: AUTO_WORKFLOW_ID }]) {
    assert.equal(canUseAsExample({ ...ok, ...bad }), false, JSON.stringify(bad));
  }
});

test('board 3: one post per Add (busy while it posts), and a throw or refusal gives the button back with the reason', async () => {
  const { doc, win } = dom();
  let calls = 0;
  let release;
  let mode = 'hold';
  openFromRunDialog({ doc, win, past: past(), onSubmit: () => {
    calls += 1;
    if (mode === 'hold') return new Promise((r) => { release = r; });
    throw new Error('Worca did not answer.');
  } });
  const ok = doc.querySelector('.wft-dlg-ok');
  click(ok);
  assert.equal(ok.disabled, true, 'busy while it posts');
  click(ok);
  await tick();
  assert.equal(calls, 1, 'a second click while busy posts nothing');
  release({ ok: false, error: 'This run is of another workflow.' });
  await tick();
  assert.deepEqual([ok.disabled, doc.querySelector('.wft-dlg-error').textContent], [false, 'This run is of another workflow.']);
  mode = 'throw';
  click(ok);
  await tick();
  assert.deepEqual([calls, ok.disabled, doc.querySelector('.wft-dlg-error').textContent], [2, false, 'Worca did not answer.']);
  assert.ok(doc.querySelector('#mk-dialog'), 'still open');
});

test('C11: an exactly equal request says so in the picker, with the badge of the Tests page (one helper for both)', () => {
  const { doc, win } = dom();
  openPickRunDialog({ doc, win, workflowName: 'Product brief writer', dateText: () => '14 Oct', onPick: () => {},
    runs: [{ pipelineId: 'p1', title: 'Saved filters', at: 'x', status: 'done', files: 0, sameAs: null },
      { pipelineId: 'p2', title: 'Saved filters again', at: 'x', status: 'done', files: 0, sameAs: 'Saved filters' },
      { pipelineId: 'p3', title: 'Bulk export', at: 'x', status: 'stopped', files: 0, sameAs: null }] });
  assert.deepEqual([...doc.querySelectorAll('.wft-pick-row')].map((r) => r.textContent),
    ['Saved filters · 14 Oct · Finished', 'Saved filters again · 14 Oct · Same request as another', 'Bulk export · 14 Oct · Stopped']);
  assert.deepEqual([...doc.querySelectorAll('.wft-pick-row .badge')].map((b) => b.className), ['badge green', 'badge', 'badge']);
  const one = (r) => { const b = runStatusBadge(doc, r); return [b.className, b.textContent]; };
  assert.deepEqual([one({ status: 'done' }), one({ status: 'error' }), one({ status: 'stopped' }), one({ status: 'done', sameAs: 'X' })],
    [['badge green', 'Finished'], ['badge red', 'Failed'], ['badge', 'Stopped'], ['badge', 'Same request as another']]);
});

// ── Test a version (boards 4, 30; C12, C16, C19) ──
const SIX = [1, 2, 3, 4, 5, 6].map((id) => ({ id, name: `Example ${id}`, tries: 3 }));
const OPTIONS = [{ use: 3, label: 'v3' }, { use: 4, label: 'v4 · the team uses it' }, { use: 'draft', label: 'v5 draft · your changes' }];
const planFor = (q, over = {}) => {
  const n = q.examples.split(',').length * Number(q.tries);
  return {
    a: { use: 4, label: 'v4 · the team uses it', short: 'v4', want: n, reusable: n, reusableAt: '2026-10-19T10:00:00Z', perTryUsd: 0.84, savesUsd: n * 0.84 },
    b: { use: 'draft', label: 'v5 draft · your changes', short: 'v5 draft', want: n, reusable: 0, reusableAt: null, perTryUsd: 0.52, savesUsd: 0 },
    examples: n / Number(q.tries), tries: Number(q.tries), perTryMs: 280000,
    connectors: { mode: q.connectors, pretend: ['jira_team', 'slack_team'],
      off: [{ name: 'Google Drive', reason: 'claude-ai' }, { name: 'confluence_team', reason: 'no-tools' }], scripts: ['Publish to wiki'], engines: [] },
    ...over,
  };
};
function openTv(over = {}, planOver = {}) {
  const { doc, win } = dom();
  const plans = []; const started = [];
  openTestVersionDialog({ doc, win, options: OPTIONS, a: 4, b: 'draft', examples: SIX, dateText: () => '19 Oct',
    loadPlan: async (q) => { plans.push(q); return planFor(q, planOver); }, onStart: async (body) => { started.push(body); return { ok: true }; }, ...over });
  return { doc, plans, started };
}
const estRows = (doc) => [...doc.querySelectorAll('.wft-est-row')].map((r) => [...r.children].map((c) => c.textContent));
const change = (node) => node.dispatchEvent(new node.ownerDocument.defaultView.Event('change'));
const notesOf = (doc) => [...doc.querySelectorAll('.wft-conn-notes li')].map((li) => li.textContent);

test('board 4: v4 against the draft, v4 reused, the live estimate, Start N tries', async () => {
  const { doc, plans, started } = openTv();
  await tick();
  assert.equal(doc.querySelector('#mk-dialog-title').textContent, 'Test a version');
  assert.deepEqual([doc.querySelector('#wft-tv-a').value, doc.querySelector('#wft-tv-b').value], ['4', 'draft']);
  assert.deepEqual([...doc.querySelector('#wft-tv-a').options].map((o) => o.textContent), ['v3', 'v4 · the team uses it']);
  assert.deepEqual(plans[0], { a: '4', b: 'draft', examples: '1,2,3,4,5,6', tries: '3', connectors: 'pretend' });
  assert.equal(doc.querySelector('.wft-reuse .wft-chk').textContent,
    "Use v4's results from 19 Oct. Nothing in v4 or in the examples has changed since, so only v5 draft needs to be tried. This saves about $15.");
  assert.deepEqual([...doc.querySelector('#wft-tv-examples').options].map((o) => o.textContent), ['All 6', 'Example 1', 'Example 2', 'Example 3', 'Example 4', 'Example 5', 'Example 6']);
  assert.equal(doc.querySelector('.wft-tv-tries .seg button.on').textContent, '3');
  assert.equal(doc.querySelector('#wft-tv-quick').checked, true);
  assert.equal(doc.querySelector('#wft-tv-quick').closest('label').textContent, 'Do a free quick check first. Worca makes sure every step of the workflow is connected, without using AI.');
  assert.ok([...doc.querySelectorAll('#mk-dialog input[type="checkbox"]')].every((b) => b.classList.contains('wft-tv-optin')), 'the listed opt-in token (ui-shared-controls)');
  assert.equal(doc.querySelector('.wft-safe').textContent, 'Tests never touch real work through your connectors.');
  assert.equal(doc.querySelector('.wft-est').getAttribute('aria-live'), 'polite');
  assert.deepEqual(estRows(doc), [['18 tries of v5 draft', 'about $9.36'], ['v4 results from 19 Oct', '$0.00'], ['Total · ready in about 28 minutes', '$9 to $11']]);
  assert.equal(doc.querySelector('#wft-tv-cap').value, '$15');
  assert.equal(doc.querySelector('#wft-tv-cap').closest('.field').querySelector('.hint').textContent, 'Tests count in your spending limit. You can close this page: Worca tells you when the results are ready.');
  const ok = doc.querySelector('.wft-dlg-ok');
  assert.deepEqual([ok.textContent, ok.disabled], ['Start 18 tries', false]);
  click([...doc.querySelectorAll('.wft-tv-tries .seg button')].find((b) => b.textContent === '1 · quick look'));
  await tick();
  assert.equal(plans.at(-1).tries, '1');
  assert.equal(ok.textContent, 'Start 6 tries');
  const reuse = doc.querySelector('#wft-tv-reuse-a');
  reuse.focus();
  reuse.checked = false; change(reuse);
  assert.equal(ok.textContent, 'Start 12 tries');
  assert.equal(doc.activeElement, reuse, 'the repaint rebuilds the reuse row: the box keeps the focus');
  assert.deepEqual(estRows(doc).slice(0, 2), [['6 tries of v5 draft', 'about $3.12'], ['6 tries of v4', 'about $5.04']]);
  click(ok);
  await tick();
  assert.deepEqual(started, [{ a: 4, b: 'draft', exampleIds: [1, 2, 3, 4, 5, 6], tries: 1, reuseA: false, reuseB: false, quickCheck: true, capUsd: 15, connectors: 'pretend' }]);
  assert.equal(doc.querySelector('#mk-dialog'), null, 'closes once the test started');
});

test('board 30: Connectors, Pretend by default with its notes; Real warns, hides the promise, and is sent (D35, C19)', async () => {
  const { doc, plans, started } = openTv();
  await tick();
  assert.equal(doc.querySelector('.wft-conn legend').textContent, 'Connectors');
  const [pretend, real] = [...doc.querySelectorAll('input[name="wft-tv-conn"]')];
  assert.deepEqual([pretend.id, pretend.checked, real.id, real.checked], ['wft-tv-conn-pretend', true, 'wft-tv-conn-real', false]);
  assert.deepEqual([...doc.querySelectorAll('.wft-conn .radio-card-text')].map((t) => t.textContent), [
    'PretendYour connectors are replaced by stand-ins. Nothing is posted or sent, and Worca shows what would have been sent. Anything the workflow reads from them comes back empty.',
    'RealTries use your real connectors. If the workflow posts or sends something, it does it in every try: 18 times in this test.',
  ]);
  assert.deepEqual(notesOf(doc), [
    'Jira team, Slack team: pretend',   // one shared name helper (Task 14 fix 2)
    "Google Drive is switched off: Worca can't pretend for claude.ai connectors.",
    'Confluence team is switched off: test it once in Connectors so Worca knows its tools.',
  ]);
  assert.equal(doc.querySelector('.wft-conn-notes a').getAttribute('href'), '#connectors');
  assert.equal(doc.querySelector('.wft-caution').textContent, 'The script step Publish to wiki runs as in a normal run. If it posts or sends something, it does it in every try.');
  assert.equal(doc.querySelector('.wft-caution b').textContent, 'Publish to wiki');
  real.checked = true; change(real);
  await tick();
  assert.equal(plans.at(-1).connectors, 'real', 'reuse is counted per mode (D26)');
  assert.deepEqual([doc.querySelector('.wft-safe').hidden, doc.querySelector('.wft-conn-notes').hidden, doc.querySelector('.wft-caution').hidden], [true, true, false]);
  click(doc.querySelector('.wft-dlg-ok'));
  await tick();
  assert.equal(started[0].connectors, 'real');
  assert.equal(scriptCaution([]), null);
  const two = scriptCaution(['Publish to wiki', 'Post to Slack']);
  assert.equal(two.lead + two.name + two.rest, 'The script steps Publish to wiki and Post to Slack run as in a normal run. If they post or send something, they do it in every try.');
  // M2 (final review): the free quick check runs a script step with no mock of its own for real too.
  const words = (c) => c.lead + c.name + c.rest + (c.more ? c.more.lead + c.more.name + c.more.rest : '');
  assert.equal(words(scriptCaution(['Publish to wiki'], ['Publish to wiki'])),
    'The script step Publish to wiki runs as in a normal run. If it posts or sends something, it does it in every try and in the free quick check.');
  assert.equal(words(scriptCaution(['Publish to wiki', 'Post to Slack'], ['Post to Slack', 'Publish to wiki'])),
    'The script steps Publish to wiki and Post to Slack run as in a normal run. If they post or send something, they do it in every try and in the free quick check.');
  assert.equal(words(scriptCaution(['Publish to wiki', 'Post to Slack'], ['Post to Slack'])),
    'The script steps Publish to wiki and Post to Slack run as in a normal run. If they post or send something, they do it in every try. The free quick check runs Post to Slack as in a normal run too.');
  assert.equal(scriptCaution(['Publish to wiki', 'Post to Slack'], ['Post to Slack']).more.name, 'Post to Slack');
  assert.equal(words(scriptCaution(['Publish to wiki'], [])), 'The script step Publish to wiki runs as in a normal run. If it posts or sends something, it does it in every try.');
});

test('reuse is offered ticked for the older version only, whichever side it is on (M3, board 4)', async () => {
  const both = (doc) => [doc.querySelector('#wft-tv-reuse-a').checked, doc.querySelector('#wft-tv-reuse-b').checked];
  const reusable = { reusable: 18, reusableAt: '2026-10-19T10:00:00Z' };
  const { doc, started } = openTv({}, { b: { use: 'draft', label: 'v5 draft · your changes', short: 'v5 draft', want: 18, perTryUsd: 0.52, savesUsd: 9.36, ...reusable } });
  await tick();
  assert.deepEqual(both(doc), [true, false]);
  const a = doc.querySelector('#wft-tv-a'); const b = doc.querySelector('#wft-tv-b');
  b.value = '3'; change(b);   // v4 with v3: v3 is the older one
  await tick();
  assert.deepEqual(both(doc), [false, true]);
  a.value = '3'; b.value = '4'; change(b);
  await tick();
  assert.deepEqual(both(doc), [true, false]);
  click(doc.querySelector('.wft-dlg-ok'));
  await tick();
  assert.deepEqual([started[0].reuseA, started[0].reuseB], [true, false]);
});

test('the script caution counts the free quick check only while it is ticked (final review M2)', async () => {
  const { doc } = openTv({}, { connectors: { mode: 'pretend', pretend: [], off: [], scripts: ['Publish to wiki'], quickScripts: ['Publish to wiki'], engines: [] } });
  await tick();
  const caution = () => doc.querySelector('.wft-caution').textContent;
  assert.equal(caution(), 'The script step Publish to wiki runs as in a normal run. If it posts or sends something, it does it in every try and in the free quick check.');
  const quick = doc.querySelector('#wft-tv-quick');
  quick.checked = false; change(quick);
  assert.equal(caution(), 'The script step Publish to wiki runs as in a normal run. If it posts or sends something, it does it in every try.');
  quick.checked = true; change(quick);
  assert.equal(doc.querySelectorAll('.wft-caution b').length, 1);
  assert.match(caution(), /and in the free quick check.$/);
});

test('board 30: a file server, a server in your own settings, other engines, and a list Worca could not read', async () => {
  const { doc } = openTv({}, { connectors: { mode: 'pretend', pretend: [], previewError: true, scripts: [], engines: ['Codex', 'Gemini'],
    off: [{ name: 'wiki_files', reason: 'file-server' }, { name: 'my_github', reason: 'own-settings' }] } });
  await tick();
  assert.deepEqual(notesOf(doc), [
    'Worca could not list your connectors just now.',
    "Wiki files is switched off: Worca can't pretend for servers from a project file.",
    "My github is switched off: Worca can't pretend for servers in your own Claude Code settings.",
    "Steps on Codex can still use connectors from Codex's own settings. Pretend can't stop those.",
    "Steps on Codex still use Codex's own plugins and settings. Pretend switches off only Claude Code's.",
    "Steps on Gemini can still use connectors from Gemini's own settings. Pretend can't stop those.",
    "Steps on Gemini still use Gemini's own plugins and settings. Pretend switches off only Claude Code's.",
  ]);
  assert.equal(doc.querySelector('.wft-caution').hidden, true, 'no script step, no caution');
  const one = openTv({ examples: [{ id: 1, name: 'A', tries: 1 }] }, { a: null });
  await tick();
  assert.match(one.doc.querySelectorAll('.wft-conn .radio-card-text')[1].textContent, /it does it in every try: once in this test\.$/);
});

test('the engine and file-server lines are the server\'s own sentences (drift guard: the browser cannot load src/core)', () => {
  for (const label of ['Codex', 'Gemini CLI', 'A']) assert.equal(engineNoteLine(label), serverConnectors.engineNoteLine(label));
  for (const name of ['wiki_files', 'x']) assert.equal(fileServerOffLine(name), serverConnectors.fileServerOffLine(name));
});

test('C16 with no saved version; two equal versions; one example starts at its own tries (G10); the cap must be a number', async () => {
  const none = openTv({ options: [{ use: 'draft', label: 'Your draft' }], a: null });
  await tick();
  const selA = none.doc.querySelector('#wft-tv-a');
  assert.deepEqual([selA.disabled, selA.options[0].textContent], [true, 'No saved version yet']);
  assert.equal(none.doc.querySelector('.wft-tv-note').textContent, 'Save a version first: a test compares two versions. Try it once now tries one example on your draft.');
  assert.deepEqual([none.doc.querySelector('.wft-dlg-ok').disabled, none.doc.querySelector('.wft-dlg-ok').textContent], [true, 'Start']);
  assert.equal(none.plans.length, 0);
  // M6 (board 29): only the two selects, the sentence, Cancel and Start.
  const shown = (doc) => [...doc.querySelector('#mk-dialog .wft-vs').parentElement.children]
    .filter((n) => !n.hidden && !n.classList.contains('wft-dlg-error')).map((n) => n.className);   // the error line is empty
  assert.deepEqual(shown(none.doc), ['wft-vs', 'hint wft-tv-note']);
  assert.equal(none.doc.querySelector('#wft-tv-cap').closest('.field').hidden, true);
  assert.deepEqual([...none.doc.querySelectorAll('#mk-dialog button')].filter((x) => !x.closest('[hidden]')).map((x) => x.textContent),
    ['Cancel', 'Start']);
  const same = openTv();
  await tick();
  const b = same.doc.querySelector('#wft-tv-b');
  b.value = '4'; change(b);
  await tick();
  assert.deepEqual([same.doc.querySelector('.wft-tv-note').textContent, same.doc.querySelector('.wft-dlg-ok').disabled, same.doc.querySelector('.wft-dlg-ok').textContent],
    ['Pick two different versions.', true, 'Start']);
  const one = openTv({ examples: [{ id: 1, name: 'A', tries: 5 }, { id: 2, name: 'B', tries: 1 }], exampleIds: [2] });
  await tick();
  assert.equal(one.doc.querySelector('.wft-tv-tries .seg button.on').textContent, '1 · quick look');
  assert.deepEqual(one.plans[0], { a: '4', b: 'draft', examples: '2', tries: '1', connectors: 'pretend' });
  const ex = one.doc.querySelector('#wft-tv-examples');
  ex.value = 'all'; change(ex);
  await tick();
  assert.equal(one.doc.querySelector('.wft-tv-tries .seg button.on').textContent, '5');
  const cap = one.doc.querySelector('#wft-tv-cap');
  cap.value = 'lots'; cap.dispatchEvent(new one.doc.defaultView.Event('input'));
  click(one.doc.querySelector('.wft-dlg-ok'));
  await tick();
  assert.equal(one.doc.querySelector('.wft-dlg-error').textContent, 'Give the cost limit in dollars, such as $15.');
  assert.equal(one.started.length, 0);
  for (const bad of ['-2', '2e3', '1,000']) {
    cap.value = bad; cap.dispatchEvent(new one.doc.defaultView.Event('input'));
    click(one.doc.querySelector('.wft-dlg-ok'));
    await tick();
    assert.equal(one.started.length, 0, `${bad} is refused`);
  }
  cap.value = '15,50'; cap.dispatchEvent(new one.doc.defaultView.Event('input'));
  click(one.doc.querySelector('.wft-dlg-ok'));
  await tick();
  assert.equal(one.started.length, 1);
  assert.equal(one.started[0].capUsd, 15.5, 'I2: a decimal comma, not $1,550');
});

test('C16 every result reused: Start 0 tries, disabled; C12 a cost not known yet', async () => {
  const all = openTv({}, { b: { use: 'draft', label: 'v5 draft · your changes', short: 'v5 draft', want: 18, reusable: 18, reusableAt: '2026-10-20T10:00:00Z', perTryUsd: 0.52, savesUsd: 9.36 } });
  await tick();
  // M3 (board 4): only the older version's results are reused unless the person ticks the newer one too.
  assert.deepEqual([all.doc.querySelector('#wft-tv-reuse-a').checked, all.doc.querySelector('#wft-tv-reuse-b').checked], [true, false]);
  assert.equal(all.doc.querySelector('.wft-dlg-ok').textContent, 'Start 18 tries');
  const boxB = all.doc.querySelector('#wft-tv-reuse-b');
  boxB.checked = true; change(boxB);
  assert.deepEqual([all.doc.querySelector('.wft-dlg-ok').textContent, all.doc.querySelector('.wft-dlg-ok').disabled], ['Start 0 tries', true]);
  assert.equal(all.doc.querySelector('.wft-tv-note').textContent, 'Nothing to try: both versions have results for these examples.');
  assert.equal(all.doc.querySelectorAll('.wft-reuse .wft-chk').length, 2, 'one opt-in per version with results');
  assert.deepEqual([all.doc.querySelector('#wft-tv-reuse-a').checked, all.doc.querySelector('#wft-tv-reuse-b').checked], [true, true], 'both ticked: nothing to try');
  const unknown = openTv({}, { perTryMs: null, b: { use: 'draft', label: 'v5 draft · your changes', short: 'v5 draft', want: 18, reusable: 0, reusableAt: null, perTryUsd: null, savesUsd: null } });
  await tick();
  assert.deepEqual(estRows(unknown.doc), [['18 tries of v5 draft', 'cost not known yet'], ['v4 results from 19 Oct', '$0.00'], ['Total', 'cost not known yet']]);
  assert.deepEqual([unknown.doc.querySelector('#wft-tv-cap').value, unknown.doc.querySelector('.wft-dlg-ok').textContent], ['$10', 'Start 18 tries']);
});

test('Start posts once while busy; a refusal or a throw gives the button back with the reason; a late plan never paints over a newer pick', async () => {
  let release;
  let mode = 'hold';
  let calls = 0;
  const { doc } = openTv({ onStart: () => {
    calls += 1;
    if (mode === 'hold') return new Promise((r) => { release = r; });
    throw new Error('Worca did not answer.');
  } });
  await tick();
  const ok = doc.querySelector('.wft-dlg-ok');
  click(ok);
  assert.equal(ok.disabled, true, 'busy while it posts');
  const reuse = doc.querySelector('#wft-tv-reuse-a');
  reuse.checked = false; change(reuse);
  assert.equal(ok.disabled, true, 'a repaint while it posts keeps Start disabled');
  click(ok);
  await tick();
  assert.equal(calls, 1);
  release({ ok: false, error: 'A test of this workflow is running. Wait for it, or stop it first.' });
  await tick();
  assert.deepEqual([ok.disabled, doc.querySelector('.wft-dlg-error').textContent], [false, 'A test of this workflow is running. Wait for it, or stop it first.']);
  mode = 'throw';
  click(ok);
  await tick();
  assert.deepEqual([calls, ok.disabled, doc.querySelector('.wft-dlg-error').textContent], [2, false, 'Worca did not answer.']);
  // Two picks, the first answer last: the dialog shows the second pick's plan.
  const slow = [];
  const { doc: d2 } = openTv({ loadPlan: (q) => new Promise((r) => slow.push(() => r(planFor(q)))) });
  click([...d2.querySelectorAll('.wft-tv-tries .seg button')].find((x) => x.textContent === '1 · quick look'));
  slow[1]();
  await tick();
  slow[0]();
  await tick();
  assert.equal(d2.querySelector('.wft-dlg-ok').textContent, 'Start 6 tries');
});

test('board 30 (Task 13 review): an off reason Worca does not know reads generically; no count in the Real hint with nothing to try', async () => {
  const { doc } = openTv({}, { connectors: { mode: 'pretend', pretend: [], scripts: [], engines: [],
    off: [{ name: 'confluence_team', reason: 'no-tools' }, { name: 'odd_server', reason: 'something-new' }] } });
  await tick();
  assert.deepEqual(notesOf(doc), ['Confluence team is switched off: test it once in Connectors so Worca knows its tools.',
    'Odd server is switched off for this test.']);
  assert.equal(doc.querySelectorAll('.wft-conn-notes a').length, 1, 'only no-tools links to Connectors');
  const all = openTv({}, { b: { use: 'draft', label: 'v5 draft · your changes', short: 'v5 draft', want: 18, reusable: 18, reusableAt: '2026-10-20T10:00:00Z', perTryUsd: 0.52, savesUsd: 9.36 } });
  await tick();
  const reuseB = all.doc.querySelector('#wft-tv-reuse-b');
  reuseB.checked = true; change(reuseB);   // everything reused: nothing to try
  assert.equal(all.doc.querySelectorAll('.wft-conn .radio-card-text')[1].textContent,
    'RealTries use your real connectors. If the workflow posts or sends something, it does it in every try.');
});
