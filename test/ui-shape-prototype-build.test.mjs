// test/ui-shape-prototype-build.test.mjs — Shaper small runs C1 (ui/public/shape/prototype-build.mjs): the Prototype
// step's building view on the Design stage's reducer: one Lead row plus one row per screen, pieces that grow on the
// reveal's clock (at most 8 a column), reduced motion, the settled well, and no agent HTML in the DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { fakeClock } from './helpers/design-clock.mjs';
import { mountPrototypeBuild, screenRows, pushPrototypeFrame, onPrototypeFrame, buildMark } from '../ui/public/shape/prototype-build.mjs';
import { selectPlanRows, initialStage } from '../ui/public/design/stage-model.mjs';
import { piecesOf } from '../src/shared/shape/prototype.mjs';

const D = 'd_1';
const B = 'b_1';
let seq = 0;
const fr = (type, over = {}) => ({ type, designId: D, buildId: B, seq: ++seq, ts: 0, ...over });
const SECTIONS = [{ id: 'editor', job: 'Template editor', status: 'planned', parts: ['html'] }, { id: 'prefs', job: 'Preferences', status: 'planned', parts: ['html'] }];
const HTML = `<h1>Template editor</h1><label>Subject</label><input placeholder="Weekly digest"><p>Body text here</p>
  <button>Save</button><button>Preview</button><a href="#">Help</a><li>One</li><li>Two</li><li>Three</li><li>Four</li>`;

function mount(opts = {}) {
  const doc = new JSDOM('<!doctype html><body><div id="h"></div></body>').window.document;
  const host = doc.getElementById('h');
  const clock = fakeClock();
  const subs = [];
  const view = mountPrototypeBuild(doc, host, { buildId: B, designId: D, screens: [{ section: 'editor', name: 'Template editor', ids: ['R-ux-1'] }],
    subscribe: (msg, fn) => { subs.push(msg); return () => {}; }, clock: { set: clock.set, clear: clock.clear, get now() { return clock.now; } }, ...opts });
  return { doc, host, clock, view, subs };
}
const rowTexts = (host) => [...host.querySelectorAll('.proto-rows .plan-check-row')].map((r) => `${r.querySelector('.plan-check-label').textContent}:${r.querySelector('.plan-check-detail').textContent}`);
const pieces = (host, id) => [...host.querySelectorAll(`.proto-col[data-section="${id}"] .proto-piece`)].map((p) => p.textContent);

test('before the plan: 1 Lead row (planning); after plan, agent, file, integrate and change-round frames: Lead plus 1 row per screen', () => {
  const { host, view, subs } = mount();
  assert.deepEqual(subs, [{ type: 'subscribe', designBuildId: B }]);
  assert.deepEqual(rowTexts(host), ['Lead:planning']);
  assert.equal(host.querySelector('.proto-rows').getAttribute('aria-busy'), 'true');
  view.frame(fr('design-build', { status: 'planning' }));
  view.frame(fr('design-plan', { planRev: 1, sections: SECTIONS }));
  assert.deepEqual(rowTexts(host), ['Lead:building', 'Template editor:waiting', 'Preferences:waiting']);
  view.frame(fr('design-build', { status: 'building' }));
  view.frame(fr('design-agent', { agentId: 'a1', role: 'builder', sectionId: 'editor', status: 'writing', job: 'Template editor' }));
  view.frame(fr('design-file', { path: 'sections/editor/index.html', rev: 1, text: '<h1>Hi</h1>' }));
  assert.equal(rowTexts(host).length, 3);
  view.frame(fr('design-build', { status: 'integrating' }));
  view.frame(fr('design-agent', { agentId: 'a9', role: 'lead', status: 'writing', job: 'Integrate' }));
  assert.deepEqual(rowTexts(host)[0], 'Lead:integrating');
  assert.equal(rowTexts(host).length, 3, 'the integrate agent folds into Lead');
  // The rows are the Plan list's rows under one Lead row.
  const v2 = mount();
  v2.view.frame(fr('design-build', { status: 'building' }));
  v2.view.frame(fr('design-plan', { planRev: 1, sections: SECTIONS }));
  assert.deepEqual(rowTexts(v2.host).slice(1).map((t) => t.split(':')[0]), ['Template editor', 'Preferences']);
});

test('pieces grow over ticks, at most 8 a column; a reviewing view says reviewing on the Lead row with the same screen rows', () => {
  const { host, view, clock } = mount();
  view.frame(fr('design-build', { status: 'building' }));
  view.frame(fr('design-plan', { planRev: 1, sections: SECTIONS }));
  view.frame(fr('design-file', { path: 'sections/editor/index.html', rev: 2, text: HTML }));
  const early = pieces(host, 'editor').length;
  clock.tick(5000);
  const late = pieces(host, 'editor');
  assert.ok(late.length > early, `${early} -> ${late.length}`);
  assert.equal(late.length, 8);
  assert.deepEqual(late.slice(0, 3), ['Template editor', 'Subject', 'Weekly digest']);
  const r = mount({ reviewing: true });
  r.view.frame(fr('design-build', { status: 'done' }));
  r.view.frame(fr('design-plan', { planRev: 1, sections: SECTIONS }));
  assert.equal(rowTexts(r.host)[0], 'Lead:reviewing');
  const state = { ...initialStage({ designId: D, kind: 'web' }), status: 'done', sectionOrder: ['editor'], sections: { editor: { id: 'editor', job: 'Template editor', status: 'done' } } };
  assert.deepEqual(screenRows(state).slice(1).map((x) => x.name), selectPlanRows(state).rows.map((x) => x.name));
});

test('reduced motion: every piece shows after the first frame; settled: the well only, no rows, no aria-busy', () => {
  const { host, view } = mount({ reduced: () => true });
  view.frame(fr('design-build', { status: 'building' }));
  view.frame(fr('design-plan', { planRev: 1, sections: SECTIONS }));
  view.frame(fr('design-file', { path: 'sections/editor/index.html', rev: 2, text: HTML }));
  assert.equal(pieces(host, 'editor').length, 8);
  const s = mount({ settled: true, screens: [{ section: 'editor', name: 'Template editor', ids: ['R-ux-1'], pieces: piecesOf(HTML) }] });
  assert.equal(s.host.querySelector('.proto-rows'), null);
  assert.equal(s.host.querySelector('[aria-busy]'), null);
  assert.equal(pieces(s.host, 'editor').length, 8);
  assert.equal(s.host.querySelector('.proto-well').getAttribute('aria-label'), 'Prototype preview: 1 screen');
  assert.equal(s.host.querySelector('.proto-col-ids').textContent, 'R-ux-1');
  assert.equal(mount({ settled: true, register: 'plain', screens: [{ section: 'editor', name: 'E', ids: ['R-ux-1'], pieces: [] }] }).host.querySelector('.proto-col-ids'), null);
});

test('live mount before the plan: rows only, no .proto-well; after design-plan: the well follows the rows', () => {
  const { host, view } = mount();
  assert.ok(host.querySelector('.proto-rows'));
  assert.equal(host.querySelector('.proto-well'), null, 'no empty preview while the Lead plans');
  view.frame(fr('design-build', { status: 'building' }));
  view.frame(fr('design-plan', { planRev: 1, sections: SECTIONS }));
  assert.deepEqual([...host.children].map((c) => c.classList.contains('proto-well') ? 'well' : 'rows'), ['rows', 'well']);
  view.destroy();
  assert.equal(host.children.length, 0);
});

test('Lead planning and an active screen show the live dot; a planned screen keeps the hollow mark; done shows the check', () => {
  const { host, view } = mount();
  const marks = () => [...host.querySelectorAll('.proto-rows .plan-check-row')].map((r) => {
    const m = r.querySelector('.plan-check-mark');
    return m.classList.contains('is-live') ? 'live' : m.classList.contains('is-wait') ? 'wait' : m.querySelector('svg') ? 'icon' : '?';
  });
  assert.deepEqual(marks(), ['live'], 'Lead planning');
  view.frame(fr('design-build', { status: 'building' }));
  view.frame(fr('design-plan', { planRev: 1, sections: SECTIONS }));
  view.frame(fr('design-agent', { agentId: 'a1', role: 'builder', sectionId: 'editor', status: 'writing', job: 'Template editor' }));
  assert.deepEqual(rowTexts(host).map((t) => t.split(':')[1]), ['building', 'writing', 'waiting']);
  assert.deepEqual(marks(), ['live', 'live', 'wait']);
  const d = mount({ settled: false });
  d.view.frame(fr('design-build', { status: 'done' }));
  d.view.frame(fr('design-plan', { planRev: 1, sections: SECTIONS.map((x) => ({ ...x, status: 'done' })) }));
  assert.equal(d.host.querySelector('.proto-rows .plan-check-row .plan-check-mark').classList.contains('is-live'), false);
  assert.equal(d.host.querySelector('.proto-rows .plan-check-row').classList.contains('ok') || !!d.host.querySelector('.proto-rows .plan-check-mark svg'), true);
});

test('buildMark: done check, failed x, waiting and stopped hollow, every other word live', () => {
  const table = { done: 'check', failed: 'x', waiting: 'wait', stopped: 'wait', planning: 'live', building: 'live', integrating: 'live',
    reviewing: 'live', writing: 'live', thinking: 'live', reading: 'live', starting: 'live', retrying: 'live' };
  for (const [word, mark] of Object.entries(table)) assert.equal(buildMark(word), mark, word);
});

test('invariant 7: agent HTML (a script tag, an onerror attribute) never reaches the DOM', () => {
  const { host, view } = mount({ reduced: () => true });
  const evil = '<h1>Hi</h1><script>window.__x=1</script><img src=x onerror="window.__y=1" alt="Logo"><p>ok</p>';
  view.frame(fr('design-build', { status: 'building' }));
  view.frame(fr('design-plan', { planRev: 1, sections: SECTIONS }));
  view.frame(fr('design-file', { path: 'sections/editor/index.html', rev: 2, text: evil }));
  assert.equal(host.querySelector('script, img, [onerror]'), null);
  assert.deepEqual(pieces(host, 'editor'), ['Hi', 'Logo', 'ok']);
  assert.ok(!host.innerHTML.includes('onerror'));
});

test('the frame bus reaches each listener until it unsubscribes', () => {
  const got = [];
  const off = onPrototypeFrame((f) => got.push(f.type));
  pushPrototypeFrame({ type: 'design-build' });
  off();
  pushPrototypeFrame({ type: 'design-plan' });
  assert.deepEqual(got, ['design-build']);
});
