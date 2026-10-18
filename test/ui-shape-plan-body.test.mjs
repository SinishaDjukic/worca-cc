// test/ui-shape-plan-body.test.mjs — the `plan` ask's body (spec §3.4, D10, D30–D32): the decision card (summary,
// folded check line with Fix all, perspectives line with chips and Update plan, Full plan inline with versions and
// grounding marks, ⋯ with Save and Open in New run), and the gate-off held body that keeps approve / revise / stop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { renderPlanBody, SEND_FAILED } from '../ui/public/shape/plan-body.mjs';
import { fixAllFeedback, perspectiveChangeFeedback } from '../ui/public/shape/plan-text.mjs';

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
  assert.equal(bad.$('.plan-unmet').textContent, '1 check unmet: paths');
  assert.equal(bad.$('.plan-actions').nextElementSibling, bad.$('.plan-unmet'));
  assert.equal(setup({ pq: ask({ outline: { slices: [] } }) }).$('.plan-approve').textContent, 'Approve the slices');
});

test('the card: summary, footer of four, no Stop, no Run anyway', async () => {
  const { $, $$ } = setup({ run: { title: 'Plan demo' } });
  await flush();
  assert.equal($('.plan-sub').textContent, 'Plan demo · v2');
  assert.equal($('.plan-summary').hidden, false);
  assert.equal($('.plan-summary').textContent, 'Why.');
  assert.deepEqual($$('.plan-actions > button').map((b) => b.textContent), ['Approve and build', 'Ask for changes', 'Full plan', '⋯']);
  assert.equal($('.plan-stop'), null);
  assert.equal($('.plan-open-full'), null);
  assert.doesNotMatch($('.plan-body').textContent, /Run anyway/);
});

test('D19: plan.outlineChange shows the planner\'s note as text; without it there is no note', () => {
  const withNote = setup({ pq: ask({ outlineChange: 'Slice 1 did not add the <b>tags</b> table.' }) });
  assert.equal(withNote.$('.shape-plan-outline-change-head').textContent, 'The planner says this slice can\'t be built as outlined:');
  assert.equal(withNote.$('.shape-plan-outline-change-text').textContent, 'Slice 1 did not add the <b>tags</b> table.');
  assert.equal(withNote.$('.shape-plan-outline-change-text b'), null, 'text, never markup');
  assert.equal(setup().$('.shape-plan-outline-change'), null);
});

test('the meta line shows the file and Shape p/t, then sections and words once the text loads', async () => {
  const { $ } = setup({ fetchPlan: async () => new Promise(() => {}) });
  assert.equal($('.plan-meta').textContent, 'feature-v2.md · Shape 2/3');
  const loaded = setup();
  await flush();
  assert.match(loaded.$('.plan-meta').textContent, /^feature-v2\.md · 2 sections · \d+ words · Shape 2\/3$/);
});

test('checks are folded on one line; rows are neutral with ✓ / ✕; one Fix all posts every failure', () => {
  const { $, $$, calls } = setup();
  const line = $('.plan-check-line');
  assert.equal(line.querySelector('.plan-fold-text').textContent, 'Shape 2/3 · 1 to fix');
  assert.equal(line.getAttribute('aria-expanded'), 'false');
  assert.equal($('.plan-checks').hidden, true);
  line.click();
  assert.equal($('.plan-checks').hidden, false);
  assert.deepEqual($$('.plan-check-row').map((r) => r.querySelector('.plan-check-mark').textContent), ['✓', '✕']);
  assert.equal($$('.plan-check-bad').length + $$('.plan-fix').length, 0);
  assert.equal($$('.plan-fix-all').length, 1);
  $('.plan-fix-all').click();
  assert.deepEqual(calls.submit, [{ decision: 'revise', feedback: fixAllFeedback(CHECK.items) }]);
  assert.equal($('.plan-check-detail').textContent, '1 path not found');
  assert.equal(setup({ pq: ask({ check: { ...CHECK, ok: true, items: [CHECK.items[0]] } }) }).$('.plan-fix-all'), null, 'nothing fixable');
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
  $('.plan-fix-all').click();
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

test('⋯ holds Save to plans/ and Open in New run; Simple level drops Open in New run; a workspace run has no ⋯', async () => {
  const { $ } = setup();
  assert.deepEqual(menu($).labels, ['Save to plans/', 'Open in New run']);
  doc.documentElement.dataset.level = 'simple';
  try { assert.deepEqual(menu(setup().$).labels, ['Save to plans/']); } finally { delete doc.documentElement.dataset.level; }
  assert.equal(setup({ run: { workspaceId: 'w1' } }).$('.plan-more'), null);
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

test('Stop confirms, then posts stop; a declined confirm posts nothing', async () => {
  const yes = setup({ extras: false });
  yes.$('.plan-stop').click();
  await flush();
  assert.equal(yes.calls.confirm[0].danger, true);
  assert.deepEqual(yes.calls.submit, [{ decision: 'stop' }]);
  const no = setup({ extras: false, confirm: async () => false });
  no.$('.plan-stop').click();
  await flush();
  assert.equal(no.calls.confirm.length, 1);
  assert.equal(no.calls.submit.length, 0);
});

test('Open full plan calls openFull', () => {
  const { $, calls } = setup({ extras: false });
  $('.plan-open-full').click();
  assert.equal(calls.openFull, 1);
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

test('extras off: no chips, Fix, Save, Open in New run or plan text; approve, revise and stop still work', async () => {
  const { $, calls } = setup({ extras: false, run: { shaping: { rounds: [{ round: 1, passed: 1, total: 3 }] } } });
  await flush();
  for (const s of ['.shape-chips', '.plan-update', '.plan-fix', '.plan-save', '.plan-open-new', '.plan-md', '.plan-expand', '.plan-versions',
    '.plan-more', '.plan-full', '.plan-unmet']) assert.equal($(s), null, s);
  assert.equal(calls.fetch.length, 0);
  assert.equal($('.plan-perspectives-ro').textContent, 'Architect');
  assert.equal($('.plan-approve').textContent, 'Run this plan');
  assert.ok($('.plan-check-bad'), 'the legacy check look is unchanged');
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
  for (const s of ['.plan-ask-changes', '.plan-fix-all', '.plan-persp-edit']) assert.equal($(s), null, s);
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
    ['src/a.mjs:12', 'plan-ground found', '✓ exists'],
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

test('no button in the body uses .btn-go', () => {
  const { $$ } = setup();
  assert.equal($$('.btn-go').length, 0);
});

const RECORDED = JSON.parse(readFileSync(new URL('./fixtures/role-review/recorded-run.json', import.meta.url), 'utf8'));
const recordedAsk = (rr = RECORDED.plan.roleReviews) => ({ ...RECORDED, plan: { ...RECORDED.plan, roleReviews: rr } });

test('recorded shaped run: one row per role, Show unfolds that role\'s findings, each fact once', async () => {
  const { panel, $, $$ } = setup({ pq: recordedAsk() });
  await flush();
  assert.equal($('.plan-role-line .plan-fold-text').textContent, 'Reviewed by 5 roles · 1 open');
  const rows = $$('.plan-roles .plan-check-row');
  assert.deepEqual(rows.map((r) => r.querySelector('.plan-check-label').textContent), ['Product · no findings',
    'Architect · 1 major fixed', 'QA · 1 critical, 1 suggestion fixed', 'UX · 1 minor fixed', 'Project fit · 1 major open']);
  assert.deepEqual(rows.map((r) => r.querySelector('.plan-check-mark').textContent), ['✓', '✓', '✓', '✓', '!']);
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

test('plan-body draws no check row itself and has no local fold (one check-row component)', () => {
  const src = readFileSync(new URL('../ui/public/shape/plan-body.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /plan-check-row/);
  assert.doesNotMatch(src, /function fold\(|const fold = \(/);
  assert.match(src, /import \{ fold, buildCheckFold \} from '\.\/check-row\.mjs';/);
});

test('slice 4 CSS: 2px/4px radii only, light-dark colour tokens only, 1px dividers, the finding line wraps', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
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
