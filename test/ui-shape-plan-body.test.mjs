// test/ui-shape-plan-body.test.mjs — the `plan` ask's body (spec §3.4, D10): approve / revise / stop, the shape check
// with Fix, perspective chips with Update plan, versions, grounding marks, Save and Open in New run, and the
// gate-off fallback that keeps a held run from being stranded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderPlanBody, SEND_FAILED } from '../ui/public/shape/plan-body.mjs';
import { fixFeedback, perspectiveChangeFeedback } from '../ui/public/shape/plan-text.mjs';

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
    doc, run, extras,
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

test('Run this plan approves; "Run anyway" when the shape check fails', async () => {
  const ok = setup({ pq: ask({ check: { ...CHECK, ok: true } }) });
  assert.equal(ok.$('.plan-approve').textContent, 'Run this plan');
  assert.ok(!ok.$('.plan-approve').classList.contains('btn-go'));
  ok.$('.plan-approve').click();
  assert.deepEqual(ok.calls.submit, [{ decision: 'approve' }]);
  const bad = setup();
  assert.equal(bad.$('.plan-approve').textContent, 'Run anyway');
});

test('the meta line shows the file and Shape p/t, then sections and words once the text loads', async () => {
  const { $ } = setup({ fetchPlan: async () => new Promise(() => {}) });
  assert.equal($('.plan-meta').textContent, 'feature-v2.md · Shape 2/3');
  const loaded = setup();
  await flush();
  assert.match(loaded.$('.plan-meta').textContent, /^feature-v2\.md · 2 sections · \d+ words · Shape 2\/3$/);
});

test('Fix posts a revise naming the failing check; passing checks are chips', () => {
  const { $, $$, calls } = setup();
  assert.deepEqual($$('.plan-check-ok').map((e) => e.textContent), ['✓ Every section']);
  const fixes = $$('.plan-fix');
  assert.equal(fixes.length, 1);
  fixes[0].click();
  assert.equal(calls.submit.length, 1);
  assert.equal(calls.submit[0].decision, 'revise');
  assert.equal(calls.submit[0].feedback, fixFeedback(CHECK.items[1]));
  assert.match(calls.submit[0].feedback, /Paths are real/);
  assert.equal($('.plan-check-detail').textContent, '1 path not found');
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
  $('.plan-fix').click();
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

test('typed text posts a revise; empty text shows an error and posts nothing', () => {
  const { $, calls } = setup();
  $('.plan-revise').click();
  assert.equal(calls.submit.length, 0);
  assert.equal($('.plan-err').hidden, false);
  assert.equal($('.plan-err').textContent, 'Write what should change first');
  $('.plan-feedback').value = '  shorter please ';
  $('.plan-revise').click();
  assert.deepEqual(calls.submit, [{ decision: 'revise', feedback: 'shorter please' }]);
});

test('Stop confirms, then posts stop; a declined confirm posts nothing', async () => {
  const yes = setup();
  yes.$('.plan-stop').click();
  await flush();
  assert.equal(yes.calls.confirm[0].danger, true);
  assert.deepEqual(yes.calls.submit, [{ decision: 'stop' }]);
  const no = setup({ confirm: async () => false });
  no.$('.plan-stop').click();
  await flush();
  assert.equal(no.calls.confirm.length, 1);
  assert.equal(no.calls.submit.length, 0);
});

test('Open full plan calls openFull', () => {
  const { $, calls } = setup();
  $('.plan-open-full').click();
  assert.equal(calls.openFull, 1);
});

test('Save: a 409 exists asks to replace, then re-posts with overwrite; a 200 shows Saved to …', async () => {
  const replies = [{ status: 409, body: { error: 'exists', path: 'plans/feature.md' } }, { status: 200, body: { path: 'plans/feature.md' } }];
  const { $, calls } = setup({ savePlan: async () => replies.shift() });
  $('.plan-save').click();
  await flush();
  assert.deepEqual(calls.save, [false, true]);
  assert.match(calls.confirm[0].message, /plans\/feature\.md already exists/);
  assert.equal($('.plan-err').hidden, false);
  assert.equal($('.plan-err').textContent, 'Saved to plans/feature.md');
  assert.ok($('.plan-err').classList.contains('ok'));

  const declined = setup({ savePlan: async () => ({ status: 409, body: { error: 'exists', path: 'p.md' } }), confirm: async () => false });
  declined.$('.plan-save').click();
  await flush();
  assert.deepEqual(declined.calls.save, [false]);
  assert.equal(declined.$('.plan-err').hidden, true);

  const failed = setup({ savePlan: async () => ({ status: 500, body: { error: 'disk full' } }) });
  failed.$('.plan-save').click();
  await flush();
  assert.equal(failed.$('.plan-err').textContent, 'disk full');
  assert.ok(!failed.$('.plan-err').classList.contains('ok'));
});

test('extras off: no chips, Fix, Save, Open in New run or plan text; approve, revise and stop still work', async () => {
  const { $, calls } = setup({ extras: false, run: { shaping: { rounds: [{ round: 1, passed: 1, total: 3 }] } } });
  await flush();
  for (const s of ['.shape-chips', '.plan-update', '.plan-fix', '.plan-save', '.plan-open-new', '.plan-md', '.plan-expand', '.plan-versions']) assert.equal($(s), null, s);
  assert.equal(calls.fetch.length, 0);
  assert.equal($('.plan-perspectives-ro').textContent, 'Architect');
  $('.plan-approve').click();
  await flush();
  $('.plan-feedback').value = 'more tests';
  $('.plan-revise').click();
  await flush();
  $('.plan-stop').click();
  await flush();
  assert.deepEqual(calls.submit, [{ decision: 'approve' }, { decision: 'revise', feedback: 'more tests' }, { decision: 'stop' }]);
  assert.ok($('.plan-open-full'));
});

test('a plan that is not revisable has no typed revise and no chips', () => {
  const { $ } = setup({ pq: ask({ revisable: false }) });
  assert.equal($('.plan-feedback'), null);
  assert.equal($('.plan-revise'), null);
  assert.equal($('.plan-update'), null);
  assert.equal($('.plan-fix'), null);
  assert.ok($('.plan-approve'));
});

test('versions: one details per earlier round, text loaded on first open', async () => {
  const run = { shaping: { rounds: [{ round: 1, passed: 1, total: 3, feedback: 'add QA' }, { round: 2, passed: 2, total: 3 }] } };
  const { $$, calls } = setup({ run });
  await flush();
  const ds = $$('.plan-versions details.plan-version');
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
  const md = $('.plan-md');
  assert.ok(md.classList.contains('collapsed'));
  const tags = $$('.plan-md h2').map((h2) => [...h2.querySelectorAll('.plan-tag')].map((t) => t.textContent));
  assert.deepEqual(tags, [['Product'], ['Architect']]);
  const marks = $$('.plan-ground').map((m) => [m.previousSibling.textContent, m.className, m.textContent]);
  assert.deepEqual(marks, [
    ['src/a.mjs:12', 'plan-ground found', '✓ exists'],
    ['src/new.mjs', 'plan-ground new', 'new'],
    ['src/gone.mjs', 'plan-ground missing', 'not found'],
  ]);
  $('.plan-expand').click();
  assert.ok(!md.classList.contains('collapsed'));
  assert.equal($('.plan-expand').textContent, 'Collapse');
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

test('Open in New run is tagged advanced, sends the plan text, and is absent on a workspace run', async () => {
  const { $, calls } = setup();
  await flush();
  const open = $('.plan-open-new');
  assert.equal(open.dataset.minLevel, 'advanced');
  open.click();
  await flush();
  assert.deepEqual(calls.openNew, [PLAN_MD]);
  const ws = setup({ run: { workspaceId: 'w1' } });
  assert.equal(ws.$('.plan-open-new'), null);
  assert.equal(ws.$('.plan-save'), null);
});

test('no button in the body uses .btn-go', () => {
  const { $$ } = setup();
  assert.equal($$('.btn-go').length, 0);
});
