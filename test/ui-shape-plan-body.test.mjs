// test/ui-shape-plan-body.test.mjs — the `plan` ask's step card (spec §3.4, D10, D30–D32; shaper-cards D1, D8, D9, D13):
// one layout with the gate on and off — head, summary, folded check line, perspectives line with chips and Update plan,
// Full plan inline with versions and grounding marks, ⋯ with Fix all, Save, Open in New run and Stop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { renderPlanBody, SEND_FAILED } from '../ui/public/shape/plan-body.mjs';
import { buildFeedbackRow } from '../ui/public/shape/feedback-row.mjs';
import { fixAllFeedback, perspectiveChangeFeedback } from '../ui/public/shape/plan-text.mjs';
import { readStyleCss } from '../src/core/read-style-css.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const flush = () => new Promise((r) => setTimeout(r, 0));

const PLAN_MD = '## 1. Problem and goal\nWhy.\n\n## 2. Decisions\nUse `src/a.mjs:12` and `src/new.mjs` and `src/gone.mjs`.\n';
const CHECK = {
  ok: false, passed: 2, total: 3, found: 1,
  items: [
    { id: 'sections', label: 'Every section', pass: true },
    { id: 'paths', label: 'Paths are real', pass: false, detail: '1 path not found' },
  ],
  grounding: [{ path: 'src/a.mjs', line: 12, found: true, isNew: false }, { path: 'src/new.mjs', found: false, isNew: true }, { path: 'src/gone.mjs', found: false, isNew: false }],
};

const ask = (o = {}) => ({ id: 'q1', kind: 'plan', nodeId: 'plan', executionId: 'e1',
  plan: { port: 'plan', file: '/x/plans/feature-v2.md', round: 2, revisable: true, nodeId: 'plan', check: CHECK, perspectives: ['architect'], ...o } });

// A markdown renderer that builds real DOM from `##` lines and inline `code` spans.
function mdStub() {
  return {
    ensure: async () => true,
    render: (text) => {
      const frag = doc.createDocumentFragment();
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        const m = line.match(/^##\s+(.*)$/);
        if (m) { const h2 = doc.createElement('h2'); h2.textContent = m[1]; frag.appendChild(h2); continue; }
        const p = doc.createElement('p');
        for (const [i, part] of line.split('`').entries()) {
          if (i % 2) { const c = doc.createElement('code'); c.textContent = part; p.appendChild(c); } else p.appendChild(doc.createTextNode(part));
        }
        frag.appendChild(p);
      }
      return { kind: 'md', frag };
    },
  };
}

function setup({ pq = ask(), extras = true, run = {}, submit, savePlan, confirm, fetchPlan } = {}) {
  const panel = doc.createElement('div');
  panel.className = 'qpanel';
  const calls = { submit: [], save: [], confirm: [], fetch: [], openFull: 0, openNew: [] };
  const deps = {
    doc, run, extras, title: 'Your turn: approve the plan', chip: 'Plan',
    fetchPlan: fetchPlan || (async (round) => { calls.fetch.push(round); return { name: 'feature-v2.md', text: round ? `## Decisions\nround ${round}` : PLAN_MD }; }),
    markdown: mdStub(),
    submit: submit ? (p) => { calls.submit.push(p); return submit(p, panel); } : async (p) => { calls.submit.push(p); return true; },
    openFull: () => { calls.openFull++; },
    openInNewRun: (t) => { calls.openNew.push(t); },
    savePlan: savePlan ? (o) => { calls.save.push(o); return savePlan(o); } : async (o) => { calls.save.push(o); return { status: 200, body: { path: 'plans/feature.md' } }; },
    confirm: confirm ? (o) => { calls.confirm.push(o); return confirm(o); } : async (o) => { calls.confirm.push(o); return true; },
  };
  renderPlanBody(panel, pq, deps);
  return { panel, calls, $: (s) => panel.querySelector(s), $$: (s) => [...panel.querySelectorAll(s)] };
}

// What setPanelBusy does after a post: every control comes back unless it is data-locked.
const idle = (panel) => { for (const n of panel.querySelectorAll('button, textarea')) n.disabled = n.dataset.locked === '1'; };

// Opens the card's ⋯ and returns its item labels; pick(label) clicks one.
function menu($) {
  $('.plan-more').click();
  const items = [...doc.querySelectorAll('.wfv-menu .wfv-menu-item')];
  return { labels: items.map((b) => b.textContent), pick: (l) => items.find((b) => b.textContent === l).click() };
}

test('one primary "Approve and build", the same with unmet checks, plus the reason line under the buttons', async () => {
  const ok = setup({ pq: ask({ check: { ...CHECK, ok: true } }) });
  assert.equal(ok.$('.plan-approve').textContent, 'Approve and build');
  assert.equal(ok.$$('.btn-primary').length, 1);
  assert.equal(ok.$('.plan-unmet'), null);
  ok.$('.plan-approve').click();
  assert.deepEqual(ok.calls.submit, [{ decision: 'approve' }]);
  const bad = setup();
  assert.equal(bad.$('.plan-approve').textContent, 'Approve and build');
  assert.equal(bad.$('.plan-unmet').textContent, 'Still to fix: file paths not in the repo');
  assert.equal(bad.$('.plan-actions').nextElementSibling, bad.$('.plan-unmet'));
});

test('the card: head, summary, footer of four, Stop only in ⋯, no Run anyway', async () => {
  const { $, $$, panel } = setup({ run: { title: 'Plan demo' } });
  await flush();
  assert.equal(panel.firstElementChild, $('.ask-mcard-head'));
  assert.equal($('.ask-mcard-title').textContent, 'Your turn: approve the plan');
  assert.equal($('.ask-mcard-kind').textContent, 'Plan');
  assert.equal($('.plan-sub').textContent, 'Plan demo · v2');
  assert.equal($('.plan-summary').hidden, false);
  assert.equal($('.plan-summary').textContent, 'Why.');
  assert.deepEqual($$('.plan-actions > button').map((b) => b.textContent || b.getAttribute('aria-label')), ['Ask for changes', 'Full plan', 'Approve and build', 'More for this plan']);
  assert.ok($('.plan-more svg'), '⋯ is a stroke icon, not a character');
  assert.equal($('.plan-stop'), null);
  assert.equal($('.plan-open-full'), null);
  assert.doesNotMatch($('.plan-body').textContent, /Run anyway|Run this plan/);
});

test('D19: plan.outlineChange shows the planner\'s note as text; without it there is no note', () => {
  const withNote = setup({ pq: ask({ outlineChange: 'Slice 1 did not add the <b>tags</b> table.' }) });
  assert.equal(withNote.$('.shape-plan-outline-change-head').textContent, 'The planner says this run can\'t be built as outlined:');
  assert.equal(withNote.$('.shape-plan-outline-change-text').textContent, 'Slice 1 did not add the <b>tags</b> table.');
  assert.equal(withNote.$('.shape-plan-outline-change-text b'), null, 'text, never markup');
  assert.equal(setup().$('.shape-plan-outline-change'), null);
});

test('s5: notes from the chat list as "From the chat", the same with the gate on and off', () => {
  const notes = [{ kind: 'plan', text: 'A' }, { kind: 'idea', text: 'B' }];
  for (const extras of [true, false]) {
    const { $, $$ } = setup({ extras, pq: ask({ notes }) });
    assert.equal($('.shape-plan-notes-head').textContent, 'From the chat');
    assert.deepEqual($$('.shape-plan-notes li').map((li) => li.textContent), ['Added to this run: A', 'Saved for later: B']);
  }
  assert.equal(setup().$('.shape-plan-notes'), null);
});

test('the meta line shows the file and Shape p/t, then sections and words once the text loads', async () => {
  const { $ } = setup({ fetchPlan: async () => new Promise(() => {}) });
  assert.equal($('.plan-meta').textContent, 'feature-v2.md · Shape 2/3');
  const loaded = setup();
  await flush();
  assert.match(loaded.$('.plan-meta').textContent, /^feature-v2\.md · 2 sections · \d+ words · Shape 2\/3$/);
});

test('checks are folded on one line; rows are neutral with ✓ / ✕; Fix all in ⋯ posts every failure', () => {
  const { $, $$, calls } = setup();
  const line = $('.plan-check-line');
  assert.equal(line.querySelector('.plan-fold-text').textContent, 'Shape 2/3 · 1 to fix');
  assert.equal(line.getAttribute('aria-expanded'), 'false');
  assert.equal($('.plan-checks').hidden, true);
  line.click();
  assert.equal($('.plan-checks').hidden, false);
  assert.deepEqual($$('.plan-check-row').map((r) => r.querySelector('.plan-check-mark').getAttribute('aria-label')), ['met', 'unmet']);
  assert.ok($$('.plan-check-mark').every((m) => m.querySelector('svg') && m.textContent === ''), 'the marks are icons, not ✓ / ✕ characters');
  assert.equal($$('.plan-check-bad').length + $$('.plan-fix').length, 0);
  assert.equal($$('.plan-fix-all').length, 0, 'no Fix all button in the body');
  menu($).pick('Fix all');
  assert.deepEqual(calls.submit, [{ decision: 'revise', feedback: fixAllFeedback(CHECK.items) }]);
  assert.equal($('.plan-check-detail').textContent, '1 path not found');
  assert.ok(!menu(setup({ pq: ask({ check: { ...CHECK, ok: true, items: [CHECK.items[0]] } }) }).$).labels.includes('Fix all'), 'nothing fixable');
});

test('a chip toggle enables Update plan, which posts perspectives and the change feedback; UX is locked', () => {
  const { $, calls } = setup();
  const update = $('.plan-update');
  assert.equal(update.disabled, true);
  const ux = $('.shape-chip[data-perspective="ux"]');
  assert.equal(ux.disabled, true);
  assert.equal(ux.dataset.locked, '1');
  $('.shape-chip[data-perspective="qa"]').click();
  assert.equal(update.disabled, false);
  $('.shape-chip[data-perspective="qa"]').click();
  assert.equal(update.disabled, true, 'back to the original set');
  $('.shape-chip[data-perspective="security"]').click();
  update.click();
  assert.deepEqual(calls.submit, [{ decision: 'revise', feedback: perspectiveChangeFeedback(['architect'], ['product', 'architect', 'security']), perspectives: ['product', 'architect', 'security'] }]);
});

test('after a failed submit and setPanelBusy re-enabling, locked chips and an unchanged Update plan stay disabled', async () => {
  const { panel, $, calls } = setup({ submit: () => Promise.reject(new Error('net')) });
  menu($).pick('Fix all');
  idle(panel);
  await flush();
  assert.equal(calls.submit.length, 1);
  assert.equal($('.shape-chip[data-perspective="product"]').disabled, true);
  assert.equal($('.shape-chip[data-perspective="ux"]').disabled, true);
  assert.equal($('.plan-update').disabled, true);
  assert.equal($('.plan-err').textContent, SEND_FAILED);
});

test('failure feedback: false shows SEND_FAILED; a 422 setErrors message is kept; true shows nothing', async () => {
  const f = setup({ submit: async () => false });
  f.$('.plan-approve').click();
  await flush();
  const err = f.$('.plan-err[role=alert]');
  assert.equal(err.hidden, false);
  assert.equal(err.textContent, SEND_FAILED);

  const v = setup({ submit: async (p, panel) => { panel.__plan.setErrors([{ message: 'x' }]); return false; } });
  v.$('.plan-approve').click();
  await flush();
  assert.equal(v.$('.plan-err').hidden, false);
  assert.equal(v.$('.plan-err').textContent, 'x');

  const t = setup({ submit: async () => true });
  t.$('.plan-approve').click();
  await flush();
  assert.equal(t.$('.plan-err').hidden, true);
});

test('a submit resolving the server\'s reason keeps the typed feedback and says "Not sent: …"', async () => {
  for (const extras of [true, false]) {
    const { $ } = setup({ extras, submit: async () => 'this question is no longer pending' });
    $('.plan-ask-changes').click();
    $('.plan-feedback').value = 'more tests';
    $('.plan-revise').click();
    await flush();
    assert.equal($('.plan-err').hidden, false);
    assert.equal($('.plan-err').textContent, 'Not sent: this question is no longer pending');
    assert.equal($('.plan-feedback').value, 'more tests');
  }
});

test('a second click while a post is in flight is ignored', async () => {
  let release;
  const { $, calls } = setup({ submit: () => new Promise((r) => { release = r; }) });
  $('.plan-approve').click();
  $('.plan-approve').click();
  assert.equal(calls.submit.length, 1);
  release(true);
  await flush();
  $('.plan-approve').click();
  assert.equal(calls.submit.length, 2);
});

test('buildFeedbackRow: Send changes is primary only with primary:true; the plan card\'s stays plain', () => {
  const row = (o) => buildFeedbackRow(doc, { label: 'x', onSend: () => {}, ...o }).row;
  assert.equal(row().querySelector('.plan-revise').className, 'btn btn-sm plan-revise');
  assert.equal(row({ primary: true }).querySelector('.plan-revise').className, 'btn btn-sm btn-primary plan-revise');
  const { $ } = setup();
  $('.plan-ask-changes').click();
  assert.equal($('.plan-revise').classList.contains('btn-primary'), false);
});

test('Ask for changes is closed by default and opens the box; Send changes posts the revise', () => {
  const { $, calls } = setup();
  assert.equal($('.plan-typed').hidden, true);
  $('.plan-ask-changes').click();
  assert.equal($('.plan-typed').hidden, false);
  assert.equal($('.plan-ask-changes').getAttribute('aria-expanded'), 'true');
  $('.plan-revise').click();
  assert.equal($('.plan-err').textContent, 'Write what should change first');
  $('.plan-feedback').value = '  shorter please ';
  $('.plan-revise').click();
  assert.deepEqual(calls.submit, [{ decision: 'revise', feedback: 'shorter please' }]);
});

test('perspectives read as a line; edit opens the chips and Update plan in place', () => {
  const { $ } = setup();
  assert.equal($('.plan-persp-names').textContent, 'Product · Architect');
  assert.equal($('.plan-perspectives').hidden, true);
  $('.plan-persp-edit').click();
  assert.equal($('.plan-perspectives').hidden, false);
  assert.ok($('.plan-perspectives .plan-update'));
});

test('⋯ holds Fix all, Save to plans/, Open in New run and Stop; Simple level drops Open in New run; a workspace run and the gate off keep Fix all and Stop', async () => {
  const { $ } = setup();
  assert.deepEqual(menu($).labels, ['Fix all', 'Save to plans/', 'Open in New run', 'Stop']);
  doc.documentElement.dataset.level = 'simple';
  try { assert.deepEqual(menu(setup().$).labels, ['Fix all', 'Save to plans/', 'Stop']); } finally { delete doc.documentElement.dataset.level; }
  assert.deepEqual(menu(setup({ run: { workspaceId: 'w1' } }).$).labels, ['Fix all', 'Stop']);
  assert.deepEqual(menu(setup({ extras: false }).$).labels, ['Fix all', 'Stop']);
});

test('Full plan expands the plan inline (tags, grounding marks, versions); no popup', async () => {
  const run = { shaping: { rounds: [{ round: 1, passed: 1, total: 3, feedback: 'add QA' }] } };
  const { $, $$, calls } = setup({ run });
  await flush();
  assert.equal($('.plan-full-view').hidden, true);
  $('.plan-full').click();
  assert.equal($('.plan-full-view').hidden, false);
  assert.equal($('.plan-full').textContent, 'Hide plan');
  assert.equal(calls.openFull, 0);
  assert.ok($('.plan-full-view .plan-versions details.plan-version'));
  assert.deepEqual($$('.plan-md h2').map((h2) => [...h2.querySelectorAll('.plan-tag')].map((t) => t.textContent)).slice(0, 2), [['Product'], ['Architect']]);
});

test('Stop in ⋯ confirms, then posts stop; a declined confirm posts nothing', async () => {
  for (const extras of [true, false]) {
    const yes = setup({ extras });
    menu(yes.$).pick('Stop');
    await flush();
    assert.equal(yes.calls.confirm[0].danger, true);
    assert.deepEqual(yes.calls.submit, [{ decision: 'stop' }]);
    const no = setup({ extras, confirm: async () => false });
    menu(no.$).pick('Stop');
    await flush();
    assert.equal(no.calls.confirm.length, 1);
    assert.equal(no.calls.submit.length, 0);
  }
});

test('gate off: Full plan opens the artifact popup and fetches no plan text', async () => {
  const { $, calls } = setup({ extras: false });
  await flush();
  $('.plan-full').click();
  assert.equal(calls.openFull, 1);
  assert.equal(calls.fetch.length, 0);
  assert.equal($('.plan-full-view'), null);
});

test('Save: a 409 exists asks to replace, then re-posts with overwrite; a 200 shows Saved to …', async () => {
  const replies = [{ status: 409, body: { error: 'exists', path: 'plans/feature.md' } }, { status: 200, body: { path: 'plans/feature.md' } }];
  const { $, calls } = setup({ savePlan: async () => replies.shift() });
  menu($).pick('Save to plans/');
  await flush();
  assert.deepEqual(calls.save, [false, true]);
  assert.match(calls.confirm[0].message, /plans\/feature\.md already exists/);
  assert.equal($('.plan-err').hidden, false);
  assert.equal($('.plan-err').textContent, 'Saved to plans/feature.md');
  assert.ok($('.plan-err').classList.contains('ok'));

  const declined = setup({ savePlan: async () => ({ status: 409, body: { error: 'exists', path: 'p.md' } }), confirm: async () => false });
  menu(declined.$).pick('Save to plans/');
  await flush();
  assert.deepEqual(declined.calls.save, [false]);
  assert.equal(declined.$('.plan-err').hidden, true);

  const failed = setup({ savePlan: async () => ({ status: 500, body: { error: 'disk full' } }) });
  menu(failed.$).pick('Save to plans/');
  await flush();
  assert.equal(failed.$('.plan-err').textContent, 'disk full');
  assert.ok(!failed.$('.plan-err').classList.contains('ok'));
});

test('gate on and gate off draw the same head and foot; the gate off drops only the gated controls', async () => {
  const on = setup();
  const off = setup({ extras: false, run: { shaping: { rounds: [{ round: 1, passed: 1, total: 3 }] } } });
  await flush();
  const shape = ({ $, $$ }) => [$('.ask-mcard-title').textContent, $('.ask-mcard-kind').textContent,
    ...$$('.plan-actions > button').map((b) => b.textContent || b.getAttribute('aria-label'))];
  assert.deepEqual(shape(off), shape(on));
  assert.deepEqual(shape(off), ['Your turn: approve the plan', 'Plan', 'Ask for changes', 'Full plan', 'Approve and build', 'More for this plan']);
  for (const s of ['.shape-chips', '.plan-update', '.plan-persp-edit', '.plan-md', '.plan-versions', '.plan-summary', '.plan-check-bad'])
    assert.equal(off.$(s), null, s);
  assert.equal(off.calls.fetch.length, 0);
  assert.equal(off.$('.plan-persp-names').textContent, 'Product · Architect');
  assert.equal(off.$('.plan-check-line .plan-fold-text').textContent, 'Shape 2/3 · 1 to fix');
  assert.equal(off.$('.plan-unmet').textContent, 'Still to fix: file paths not in the repo');
  off.$('.plan-approve').click();
  await flush();
  off.$('.plan-feedback').value = 'more tests';
  off.$('.plan-revise').click();
  await flush();
  assert.deepEqual(off.calls.submit, [{ decision: 'approve' }, { decision: 'revise', feedback: 'more tests' }]);
});

test('a plan that is not revisable has no typed revise and no chips', () => {
  const { $ } = setup({ pq: ask({ revisable: false }) });
  assert.equal($('.plan-feedback'), null);
  assert.equal($('.plan-revise'), null);
  assert.equal($('.plan-update'), null);
  assert.equal($('.plan-fix'), null);
  for (const s of ['.plan-ask-changes', '.plan-fix-all', '.plan-persp-edit']) assert.equal($(s), null, s);
  assert.deepEqual(menu($).labels, ['Save to plans/', 'Open in New run', 'Stop'], 'no Fix all on the last round');
  assert.ok($('.plan-approve'));
});

test('versions: one details per earlier round, text loaded on first open', async () => {
  const run = { shaping: { rounds: [{ round: 1, passed: 1, total: 3, feedback: 'add QA' }, { round: 2, passed: 2, total: 3 }] } };
  const { $$, calls } = setup({ run });
  await flush();
  const ds = $$('.plan-full-view .plan-versions details.plan-version');
  assert.equal(ds.length, 1);
  assert.equal(ds[0].querySelector('summary').textContent, 'v1 · Shape 1/3 · you asked: add QA');
  assert.deepEqual(calls.fetch, [undefined]);
  ds[0].open = true;
  ds[0].dispatchEvent(new doc.defaultView.Event('toggle'));
  await flush();
  assert.deepEqual(calls.fetch, [undefined, 1]);
  assert.match(ds[0].querySelector('.plan-md').textContent, /round 1/);
  ds[0].open = false; ds[0].dispatchEvent(new doc.defaultView.Event('toggle'));
  ds[0].open = true; ds[0].dispatchEvent(new doc.defaultView.Event('toggle'));
  await flush();
  assert.equal(calls.fetch.length, 2, 'loaded once');
});

test('the rendered plan carries perspective tags on ## headings and grounding marks on code paths', async () => {
  const { $, $$ } = setup();
  await flush();
  const tags = $$('.plan-md h2').map((h2) => [...h2.querySelectorAll('.plan-tag')].map((t) => t.textContent));
  assert.deepEqual(tags, [['Product'], ['Architect']]);
  const marks = $$('.plan-ground').map((m) => [m.previousSibling.textContent, m.className, m.textContent]);
  assert.deepEqual(marks, [
    ['src/a.mjs:12', 'plan-ground found', 'exists'],
    ['src/new.mjs', 'plan-ground new', 'new'],
    ['src/gone.mjs', 'plan-ground missing', 'not found'],
  ]);
});

test('a plain markdown result shows the text in a pre; a missing text says so', async () => {
  const p2 = (() => {
    const panel = doc.createElement('div');
    renderPlanBody(panel, ask(), { doc, run: {}, extras: true, fetchPlan: async () => ({ name: 'a.md', text: '# hi' }),
      markdown: { ensure: async () => false, render: () => { throw new Error('not loaded'); } },
      submit: async () => true, openFull() {}, openInNewRun() {}, savePlan: async () => ({}), confirm: async () => true });
    return panel;
  })();
  const gone = (() => {
    const panel = doc.createElement('div');
    renderPlanBody(panel, ask(), { doc, run: {}, extras: true, fetchPlan: async () => null, markdown: mdStub(),
      submit: async () => true, openFull() {}, openInNewRun() {}, savePlan: async () => ({}), confirm: async () => true });
    return panel;
  })();
  await flush();
  assert.equal(p2.querySelector('.plan-md pre').textContent, '# hi');
  assert.match(gone.querySelector('.plan-md').textContent, /not available here/);
});

test('Open in New run from the ⋯ menu sends the plan text', async () => {
  const { $, calls } = setup();
  await flush();
  menu($).pick('Open in New run');
  await flush();
  assert.deepEqual(calls.openNew, [PLAN_MD]);
});

test('one primary, no .btn-go: Approve and build, and no click reaches a host delegate', async () => {
  const { $$, $, panel } = setup();
  assert.equal($$('.btn-go').length, 0);
  assert.deepEqual($$('.btn-primary').map((b) => b.textContent), ['Approve and build']);
  const host = doc.createElement('div');
  host.appendChild(panel);
  let seen = 0;
  host.addEventListener('click', () => { seen += 1; });
  $('.plan-approve').click();
  await flush();
  assert.equal(seen, 0);
});

const RECORDED = JSON.parse(readFileSync(new URL('./fixtures/role-review/recorded-run.json', import.meta.url), 'utf8'));
const recordedAsk = (rr = RECORDED.plan.roleReviews) => ({ ...RECORDED, plan: { ...RECORDED.plan, roleReviews: rr } });

test('recorded shaped run: one row per role, Show unfolds that role\'s findings, each fact once', async () => {
  const { panel, $, $$ } = setup({ pq: recordedAsk() });
  await flush();
  assert.equal($('.plan-role-line .plan-fold-text').textContent, 'Reviewed by 5 roles · 1 open');
  const rows = $$('.plan-roles .plan-check-row');
  assert.deepEqual(rows.map((r) => r.querySelector('.plan-check-label').textContent), ['Product · no findings',
    'Architect · 1 fixed', 'QA · 2 fixed', 'UX · 1 fixed', 'Project fit · 1 open']);
  // A met row's mark is the check icon (icons.mjs, D14); an open issue's is `!`.
  assert.deepEqual(rows.map((r) => { const m = r.querySelector('.plan-check-mark'); return m.querySelector('svg') ? 'check' : m.textContent; }), ['check', 'check', 'check', 'check', '!']);
  assert.equal($$('.plan-roles .plan-check-show').length, 4);
  const show = rows[4].querySelector('.plan-check-show');
  show.click();
  assert.equal(show.textContent, 'Hide');
  assert.equal(show.getAttribute('aria-expanded'), 'true');
  const open = $$('.plan-findings').filter((l) => !l.hidden);
  assert.equal(open.length, 1);
  const li = open[0].querySelectorAll('.plan-finding');
  assert.equal(li.length, 1);
  assert.ok(li[0].querySelector('.plan-sev').classList.contains('plan-sev-major'));
  assert.deepEqual([...li[0].children].map((c) => c.textContent),
    ['major', 'Code layout', 'Render role rows through buildCheckRows in check-row.mjs', 'open']);
  const status = (i) => [...rows[i].nextElementSibling.querySelectorAll('.plan-finding-status')].map((s) => s.textContent);
  assert.deepEqual(status(1), ['fixed in v2']);
  assert.deepEqual(status(2), ['fixed in v2', 'fixed in v3']);
  const text = panel.textContent;
  const shown = RECORDED.plan.roleReviews.rounds.flatMap((r) => r.roles.flatMap((x) => x.findings)).filter((f) => f.id !== 'fit-1-1');
  for (const f of new Map(shown.map((x) => [x.id, x])).values()) assert.equal(text.split(f.fix).length - 1, 1, f.id);
  assert.equal(text.includes('Reuse ui/public/shape/check-row.mjs'), false, 'a superseded finding is not shown');
});

test('one open major: Approve with 1 open issue; none: Approve and build; approve names itself', () => {
  const a = setup({ pq: recordedAsk() });
  assert.equal(a.$('.plan-approve').textContent, 'Approve with 1 open issue');
  const seen = [];
  a.panel.addEventListener('plan-answer', (e) => seen.push(e.detail));
  a.$('.plan-approve').click();
  assert.deepEqual(seen, [{ decision: 'approve' }]);
  const clean = structuredClone(RECORDED.plan.roleReviews);
  for (const f of clean.rounds.at(-1).roles.flatMap((r) => r.findings)) { f.status = 'fixed'; f.fixedIn = 3; }
  const c = setup({ pq: recordedAsk(clean) });
  assert.equal(c.$('.plan-approve').textContent, 'Approve and build');
  assert.equal(c.$('.plan-role-line .plan-fold-text').textContent, 'Reviewed by 5 roles');
  assert.equal(c.$$('.btn-primary').length, 1);
});

test('a plan ask without role reviews has no role line', () => {
  assert.equal(setup().$$('.plan-role-line').length, 0);
});

// #990 slice 3: a conflict between two roles is one decision card; Approve carries the picks and needs one per card.
const withConflict = () => {
  const rr = structuredClone(RECORDED.plan.roleReviews);
  const last = rr.rounds.at(-1);
  last.conflicts = [{ id: 'conflict-1', findings: ['qa-1-1', 'fit-2-1'], roles: ['qa', 'fit'], section: 'Code layout',
    question: 'One shared row module, or keep the plan card\'s own?', options: ['One shared module', 'Keep its own'] }];
  return recordedAsk(rr);
};

test('one conflict renders one decision card inside the plan card, before the actions', () => {
  const { $, $$ } = setup({ pq: withConflict() });
  assert.equal($$('.plan-decisions .plan-decision').length, 1);
  assert.equal($('.plan-decision-src').textContent, 'QA and Project fit disagree on Code layout');
  assert.equal($$('.plan-decision .qpanel-foot, .plan-decision [data-qpanel-submit]').length, 0, 'no submit of its own');
  assert.equal($$('.btn-primary').length, 1);
  assert.ok($('.plan-decisions').compareDocumentPosition($('.plan-actions')) & 4, 'the decisions come before Approve');
});

test('Approve with an unanswered decision shows "Answer each decision first", focuses it and sends nothing', async () => {
  const { $, calls, panel } = setup({ pq: withConflict() });
  doc.body.appendChild(panel);
  $('.plan-approve').click();
  await flush();
  assert.deepEqual(calls.submit, []);
  assert.equal($('.plan-err').hidden, false);
  assert.equal($('.plan-err').textContent, 'Answer each decision first');
  assert.equal(doc.activeElement, $('.plan-decision'));
  panel.remove();
});

test('with picks, Approve sends conflicts; a revise sends the picks made so far; no conflicts, no key', async () => {
  const a = setup({ pq: withConflict() });
  a.$$('.plan-decision .qopt')[1].click();
  a.$('.plan-approve').click();
  await flush();
  assert.deepEqual(a.calls.submit, [{ decision: 'approve', conflicts: [{ id: 'conflict-1', choice: 'Keep its own' }] }]);
  const r = setup({ pq: withConflict() });
  r.$$('.plan-decision .qopt')[0].click();
  r.$('.plan-ask-changes').click();
  r.$('.plan-feedback').value = 'Tighten the rollout.';
  r.$('.plan-revise').click();
  await flush();
  assert.deepEqual(r.calls.submit, [{ decision: 'revise', feedback: 'Tighten the rollout.', conflicts: [{ id: 'conflict-1', choice: 'One shared module' }] }]);
  const plain = setup({ pq: recordedAsk() });
  plain.$('.plan-approve').click();
  await flush();
  assert.deepEqual(plain.calls.submit, [{ decision: 'approve' }]);
});

test('plan-body draws no check row itself and has no local fold (one check-row component)', () => {
  const src = readFileSync(new URL('../ui/public/shape/plan-body.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /plan-check-row/);
  assert.doesNotMatch(src, /function fold\(|const fold = \(/);
  assert.match(src, /import \{ fold, swapOpen, buildCheckFold \} from '\.\/check-row\.mjs';/);
});

test('slice 4 CSS: 2px/4px radii only, light-dark colour tokens only, 1px dividers, the finding line wraps', () => {
  const css = readStyleCss().replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => /plan-(sev|finding|check-show)/.test(m[1]));
  assert.ok(rules.length >= 7);
  for (const [, sel, body] of rules) {
    for (const r of body.matchAll(/border-radius\s*:\s*([^;]+)/g)) assert.match(r[1].trim(), /^var\(--r-(xs|sm)\)$/, sel.trim());
    assert.doesNotMatch(body, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i, sel.trim());
    for (const b of body.matchAll(/border-top\s*:\s*([^;]+)/g)) assert.match(b[1].trim(), /^1px solid var\(--line\)$/, sel.trim());
    for (const v of body.matchAll(/(?:color|background)\s*:\s*var\((--[\w-]+)\)/g)) {
      assert.match(css, new RegExp(`${v[1]}:\\s*light-dark\\(`), `${v[1]} has a dark value`);
    }
  }
  assert.match(css, /\.plan-sev\{[^}]*border-radius:var\(--r-xs\)/);
  assert.match(css, /\.plan-finding\{[^}]*flex-wrap:wrap/);
  assert.match(css, /\.plan-finding-fix\{[^}]*overflow-wrap:anywhere/);
});

test('run 4 D8: Ask for changes swaps for the field, Cancel swaps back', () => {
  const { $, panel } = setup();
  doc.body.appendChild(panel);
  const ask = $('.plan-ask-changes');
  ask.click();
  assert.equal(ask.hidden, true, 'the button gives way to the field');
  assert.equal($('.plan-typed').hidden, false);
  assert.equal(ask.getAttribute('aria-expanded'), 'true');
  assert.deepEqual([...$('.plan-typed').querySelectorAll('button')].map((b) => b.textContent), ['Cancel', 'Send changes']);
  assert.equal(doc.activeElement, $('.plan-feedback'));
  $('.plan-typed-cancel').click();
  assert.equal($('.plan-typed').hidden, true);
  assert.equal(ask.hidden, false);
  assert.equal(doc.activeElement, ask);
  panel.remove();
});

test('#990 s5 the approval card shows the implementer\'s concern once, above the approve button', async () => {
  const pq = ask();
  pq.concern = { title: 'Store export jobs in the DB, not in memory', detail: 'A restart loses queued exports.', section: 'Decisions' };
  const { panel, $, $$ } = setup({ pq });
  await flush();
  assert.equal($$('.plan-concern').length, 1);
  assert.equal(panel.textContent.split(pq.concern.title).length - 1, 1, 'the title is shown once');
  assert.ok($('.plan-sub').compareDocumentPosition($('.plan-concern')) & 4, 'the note comes after the sub line');
  assert.ok($('.plan-concern').compareDocumentPosition($('.plan-approve')) & 4, 'the note comes before Approve');
  assert.equal($('.plan-concern .shape-plan-outline-change-head').textContent, 'The implementer has a concern about this plan:');
  assert.ok($('.plan-concern').textContent.includes('Section: Decisions'));
  assert.equal($('.plan-concern-what').textContent,
    'Approve overrides the concern and builds the plan as written. Ask for changes accepts it and sends the plan back to the planner with this concern.');
  assert.equal($('.plan-ask-changes').textContent, 'Ask for changes');
});

test('#990 s5 no concern, no concern note; markup in a concern stays text', async () => {
  assert.equal(setup({ pq: ask() }).$('.plan-concern'), null);
  const pq = ask();
  pq.concern = { title: '<img src=x onerror=alert(1)>' };
  const { $ } = setup({ pq });
  await flush();
  assert.equal($('.plan-concern img'), null);
  assert.equal($('.plan-concern-title').textContent, '<img src=x onerror=alert(1)>');
});

// Shaper requirements s3 (3.A): a reviewer's requirement concern rides the same note with its own head and what line.
test('a requirement concern: its head and what line, and each id once in the card for one concern and for two', async () => {
  const { requirementConcernOf } = await import('../src/shared/review/plan-concern.mjs');
  const finding = (id, title, fix) => ({ id: `qa-1-${id}`, severity: 'major', title, fix, requirement: id });
  const roles = (findings) => [{ round: 1, roles: [{ key: 'qa', label: 'QA', findings }] }];
  const one = requirementConcernOf(roles([finding('R-po-1', 'R-po-1: Export needs a server we do not have', 'drop the server export')]));
  const two = requirementConcernOf(roles([finding('R-po-1', 'Export needs a server', 'drop it'), finding('R-sec-2', 'Signing is out of reach', 'sign later')]));
  for (const [concern, ids, title] of [[one, ['R-po-1'], 'Export needs a server we do not have'], [two, ['R-po-1', 'R-sec-2'], '2 requirement concerns']]) {
    const pq = ask();
    pq.concern = concern;
    const { panel, $, $$ } = setup({ pq });
    await flush();
    assert.equal($$('.plan-concern').length, 1);
    assert.equal($('.plan-concern .shape-plan-outline-change-head').textContent, 'A reviewer says an agreed requirement is wrong or cannot be met:');
    assert.equal($('.plan-concern-title').textContent, title, 'the title holds no id');
    assert.equal($('.plan-concern-what').textContent,
      'Approve keeps the requirement as agreed and builds the plan. Ask for changes sends your answer to the planner.');
    for (const id of ids) assert.equal(panel.textContent.split(id).length - 1, 1, `${id} is shown once`);
    const lines = [...$$('.plan-concern .shape-plan-outline-change-text')].map((p) => p.textContent).filter((t) => /^R-/.test(t));
    assert.equal(lines.length, ids.length, 'one detail line per id');
    assert.equal($('.plan-approve').textContent.includes('Approve'), true, 'the buttons do not change');
  }
});

// Requirements first: the plan ask carries `coverage` (which agreed requirements a step delivers).
const COVERED = (n) => Array.from({ length: n }, (_, i) => ({ id: `R-po-${i + 1}`, label: `R-po-${i + 1} · covered by Step ${i + 1}`, pass: true }));
const UNCOVERED = { id: 'R-ops-1', label: 'R-ops-1 · not covered by any step', detail: 'Turning the flag off removes the export', pass: false };
const COVERAGE = { ok: false, passed: 7, total: 8, items: [...COVERED(7), UNCOVERED] };
const COVERAGE_OK = { ok: true, passed: 8, total: 8, items: COVERED(8) };
const SHAPE_OK = { ...CHECK, ok: true, passed: 2, items: [CHECK.items[0], { ...CHECK.items[1], pass: true, detail: undefined }] };
const lines = ($) => [...$('.plan-body').querySelectorAll('.plan-check-line')];
const foot = ($) => [...$('.plan-actions').children].map((b) => b.textContent || b.getAttribute('aria-label'));

test('U11: coverage shows a Requirements fold above Shape, open when a row fails, with the criterion text and "not covered by any step"', () => {
  const { $, $$ } = setup({ pq: ask({ coverage: COVERAGE }) });
  const lines = $$('.plan-check-line');
  assert.deepEqual(lines.map((l) => l.querySelector('.plan-fold-text').textContent), ['Requirements 7/8 · 1 to fix', 'Shape 2/3 · 1 to fix']);
  assert.equal(lines[0].getAttribute('aria-expanded'), 'true');
  assert.equal(lines[0].nextElementSibling.hidden, false);
  assert.equal(lines[1].getAttribute('aria-expanded'), 'false');
  const bad = $$('.plan-check-row').find((r) => r.querySelector('.plan-check-label').textContent.startsWith('R-ops-1'));
  assert.equal(bad.querySelector('.plan-check-label').textContent, 'R-ops-1 · Turning the flag off removes the export');
  assert.equal(bad.querySelector('.plan-check-detail').textContent, 'not covered by any step');
  assert.equal($$('.plan-check-row')[0].querySelector('.plan-check-label').textContent, 'R-po-1 · covered by Step 1');
  const closed = setup({ pq: ask({ coverage: COVERAGE_OK, check: SHAPE_OK }) });
  assert.equal(closed.$('.plan-check-line').getAttribute('aria-expanded'), 'false');
  assert.equal(closed.$('.plan-check-line .plan-fold-text').textContent, 'Requirements 8/8');
  const bare = setup({ pq: ask({ coverage: { ...COVERAGE, items: [{ ...UNCOVERED, detail: '' }] , passed: 0, total: 1 } }) });
  assert.equal(bare.$$('.plan-check-label')[0].textContent, 'R-ops-1 · not covered by any step', 'an empty detail keeps the engine label');
});

test('R-ux-5: with a failing row Fix all is the foot\'s only primary and is not in ⋯; Approve is a plain btn; "Still to fix" stays shape-only', () => {
  const { $, $$, calls } = setup({ pq: ask({ coverage: COVERAGE }) });
  assert.deepEqual(foot($), ['Ask for changes', 'Full plan', 'Fix all', 'Approve and build', 'More for this plan']);
  assert.deepEqual($$('.btn-primary').map((b) => b.textContent), ['Fix all']);
  assert.equal($('.plan-approve').classList.contains('btn-primary'), false);
  assert.equal($('.plan-approve').classList.contains('btn'), true);
  assert.ok(!menu($).labels.includes('Fix all'));
  assert.doesNotMatch($('.plan-unmet').textContent, /R-ops-1/);
  $('.plan-approve').click();
  assert.deepEqual(calls.submit, [{ decision: 'approve' }], 'Approve still approves');
});

test('U11: Fix all asks for the shape rows, then the raw uncovered rows', () => {
  const { $, calls } = setup({ pq: ask({ coverage: COVERAGE }) });
  $('.plan-fix-primary').click();
  assert.deepEqual(calls.submit, [{ decision: 'revise', feedback: 'The shape check fails "Paths are real": 1 path not found. Fix the plan so this check passes.\n'
    + 'The agreed requirement R-ops-1: Turning the flag off removes the export is not covered by any step. Fix the plan so a step delivers it.' }]);
});

test('R-ux-5: a failing shape row alone (coverage all covered) also makes Fix all the primary', () => {
  const { $ } = setup({ pq: ask({ coverage: COVERAGE_OK }) });
  assert.deepEqual(primaries($), ['Fix all']);
  assert.ok(!menu($).labels.includes('Fix all'));
});
const primaries = ($) => [...$('.plan-actions').querySelectorAll('.btn-primary')].map((b) => b.textContent);

test('R-ux-5: all rows pass → Approve is the primary and there is no Fix all', () => {
  const { $ } = setup({ pq: ask({ coverage: COVERAGE_OK, check: SHAPE_OK }) });
  assert.deepEqual(primaries($), ['Approve and build']);
  assert.equal($('.plan-fix-primary'), null);
  assert.ok(!menu($).labels.includes('Fix all'));
});

test('R-ux-5: not revisable and a failing row → no primary and no Fix all', () => {
  const { $ } = setup({ pq: ask({ coverage: COVERAGE, revisable: false }) });
  assert.deepEqual(primaries($), []);
  assert.equal($('.plan-fix-primary'), null);
  assert.ok(!menu($).labels.includes('Fix all'));
});

test('U11 scope: with no coverage and a failing shape row the foot is today\'s (Approve primary, Fix all only in ⋯)', () => {
  const { $ } = setup();
  assert.deepEqual(foot($), ['Ask for changes', 'Full plan', 'Approve and build', 'More for this plan']);
  assert.deepEqual(primaries($), ['Approve and build']);
  assert.equal(lines($).length, 1);
  assert.ok(menu($).labels.includes('Fix all'));
  const empty = setup({ pq: ask({ coverage: { ok: true, passed: 0, total: 0, items: [] } }) });
  assert.equal(lines(empty.$).length, 1, 'a coverage with no items draws nothing');
  assert.deepEqual(primaries(empty.$), ['Approve and build']);
});
