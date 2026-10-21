// test/ui-shape-feature-actions.test.mjs — Shaper s3: the feature card's controls (Pause · Stop, Resume · Re-plan the
// rest, the ⋯ menu), the same on every host.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { featureButtons, featureMenu, featureMenuItems, paintFeatureActions } from '../ui/public/shape/feature-actions.mjs';
import { closeMenus } from '../ui/public/workflows/menu.mjs';

const track = useDomRelease(afterEach);
const C = (over = {}) => ({ featureId: 'feat_1', active: true, halted: false, rest: true, approveEach: true, planPipelineId: 'p0',
  target: { index: 2, runId: 'r2', pipelineId: 'p2', status: 'running' }, ...over });
function setup(c, over = {}) {
  const dom = track(new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true }));
  const doc = dom.window.document;
  const host = doc.body.appendChild(doc.createElement('div'));
  const seen = [];
  const deps = { act: async (a, b, o) => { seen.push(['act', a, b, o]); return { ok: true }; }, confirm: async () => true,
    pause: async (t) => { seen.push(['pause', t.runId]); }, stop: (t) => seen.push(['stop', t.pipelineId]), openPlan: (x) => seen.push(['plan', x.planPipelineId]), ...over };
  paintFeatureActions(doc, host, c, deps);
  const labels = () => [...host.querySelectorAll('button')].map((b) => b.textContent);
  const menu = () => { host.querySelector('[data-act="feature-more"]').click(); return [...doc.querySelectorAll('.wfv-menu-item')]; };
  return { doc, host, seen, labels, menu, win: dom.window };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

test('running: Pause · Stop · ⋯; halted: Resume · Re-plan the rest · ⋯; finished: ⋯ only', () => {
  assert.deepEqual(featureButtons(C()).map((b) => b.label), ['Pause', 'Stop']);
  assert.deepEqual(featureButtons(C({ target: { index: 2, runId: 'r2', pipelineId: 'p2', status: 'pausing' } })).map((b) => [b.label, !!b.disabled]), [['Pausing…', true], ['Stop', false]]);
  assert.deepEqual(featureButtons(C({ target: { index: 2, runId: 'r2', pipelineId: 'p2', status: 'running', asks: true } })).map((b) => [b.label, !!b.disabled]),
    [['Pause', true], ['Stop', false]], 'Needs you · Run 2 · Plan: Pause (disabled) · Stop');
  assert.deepEqual(featureButtons(C({ halted: true })).map((b) => b.label), ['Resume', 'Re-plan the rest']);
  assert.deepEqual(featureButtons(C({ active: false, rest: false })), []);
  assert.deepEqual(featureMenu(C()).map((i) => i.label), ['Re-plan the rest', 'Cancel the rest', 'Ask before each run', 'Open the plan']);
  assert.deepEqual(featureMenu(C({ active: false, rest: false })).map((i) => i.label), ['Open the plan']);
  assert.deepEqual(featureButtons(null), []);
});

test('Resume posts resume; Ask before each run posts approve-each with the flipped switch; Open the plan opens', async () => {
  const { host, seen, menu } = setup(C({ halted: true }));
  host.querySelector('[data-act="feature-resume"]').click();
  await settle();
  assert.deepEqual(seen[0], ['act', 'resume', null, { focus: 'feature-resume' }]);
  const items = menu();
  assert.equal(items[2].getAttribute('aria-checked'), 'true');
  items[2].click(); await settle();
  assert.deepEqual(seen[1].slice(0, 3), ['act', 'approve-each', { on: false }]);
  closeMenus(); menu()[3].click(); await settle();
  assert.deepEqual(seen[2], ['plan', 'p0']);
});

test('Re-plan and Cancel ask first; a refused confirm posts nothing; a 409 shows its text and re-enables', async () => {
  const no = setup(C({ halted: true }), { confirm: async () => false });
  no.host.querySelector('[data-act="feature-replan"]').click(); await settle();
  assert.equal(no.seen.length, 0);
  const bad = setup(C({ halted: true }), { act: async () => ({ ok: false, error: 'Slice 2 is still going: stop it first, then re-plan the rest' }) });
  const b = bad.host.querySelector('[data-act="feature-replan"]');
  b.click(); await settle(); await settle();
  assert.equal(bad.host.querySelector('.shape-feature-err').textContent, 'Slice 2 is still going: stop it first, then re-plan the rest');
  assert.equal(b.disabled, false);
});

test('Pause and Stop act on the current run; a repaint with the same controls keeps the DOM (an open menu survives)', async () => {
  const { doc, host, seen } = setup(C());
  host.querySelector('[data-act="feature-pause"]').click();
  host.querySelector('[data-act="feature-stop"]').click();
  await settle();
  assert.deepEqual(seen, [['pause', 'r2'], ['stop', 'p2']]);
  const before = host.firstChild;
  host.hidden = true;                                   // a caller's non-feature paint hid it
  paintFeatureActions(doc, host, C(), { act: async () => ({ ok: true }), confirm: async () => true, pause: async () => {}, stop: () => {}, openPlan: () => {} });
  assert.equal(host.firstChild, before);
  assert.equal(host.hidden, false, 'shown again though the controls did not change');
});

// Chromium blurs a focused button the moment it is disabled; jsdom does not (rule: focus-after-disable).
function blurOnDisable(win) {
  const proto = win.HTMLButtonElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, 'disabled');
  Object.defineProperty(proto, 'disabled', { configurable: true, get() { return desc.get.call(this); },
    set(v) { if (v) this.blur(); desc.set.call(this, v); } });   // jsdom's blur() skips a disabled button
}
const NOOP = { act: async () => ({ ok: true }), confirm: async () => true, pause: async () => {}, stop: () => {}, openPlan: () => {} };

test('focus survives a disabling click: the same control when it is back, else ⋯ once the control is gone or disabled', async () => {
  // A menu pick: menu.mjs focuses ⋯, then the action disables it; it comes back focused when the post answers.
  const a = setup(C());
  blurOnDisable(a.win);
  const items = a.menu();
  items[2].click();
  await settle(); await settle();
  assert.equal(a.doc.activeElement && a.doc.activeElement.dataset.act, 'feature-more');
  // A repaint while the post is in flight (the shape-feature frame beat the answer): the rebuilt ⋯ takes the focus.
  let answer;
  const b = setup(C(), { act: () => new Promise((r) => { answer = r; }) });
  blurOnDisable(b.win);
  b.menu()[2].click();
  await settle();
  assert.equal(b.doc.activeElement, b.doc.body, 'the disabled ⋯ dropped the focus');
  paintFeatureActions(b.doc, b.host, C({ approveEach: false }), NOOP);
  assert.equal(b.doc.activeElement.dataset.act, 'feature-more');
  answer({ ok: true }); await settle();
  // Pause: the control comes back as Pausing… (disabled), so the focus goes to ⋯ (never to Stop).
  const p = setup(C());
  blurOnDisable(p.win);
  const pause = p.host.querySelector('[data-act="feature-pause"]');
  pause.focus(); pause.click(); await settle();
  paintFeatureActions(p.doc, p.host, C({ target: { index: 2, runId: 'r2', pipelineId: 'p2', status: 'pausing' } }), NOOP);
  assert.equal(p.doc.activeElement.dataset.act, 'feature-more');
  // Resume: the feature runs again, Resume is gone; ⋯ keeps the focus.
  const r = setup(C({ halted: true }));
  blurOnDisable(r.win);
  const resume = r.host.querySelector('[data-act="feature-resume"]');
  resume.focus(); resume.click(); await settle();
  paintFeatureActions(r.doc, r.host, C(), NOOP);
  assert.equal(r.doc.activeElement.dataset.act, 'feature-more');
  // A pending focus never steals it back from a control the person moved to.
  const s = setup(C(), { act: () => new Promise(() => {}) });
  blurOnDisable(s.win);
  const elsewhere = s.doc.body.appendChild(s.doc.createElement('button'));
  s.menu()[2].click(); await settle();
  elsewhere.focus();
  paintFeatureActions(s.doc, s.host, C({ approveEach: false }), NOOP);
  assert.equal(s.doc.activeElement, elsewhere);
});

test('a confirm-backed pick (Re-plan the rest, Cancel the rest) gives the focus back to ⋯ on either answer', async () => {
  // The confirm takes the focus and hides itself when it closes (app.js modalShell adds .hidden). Chromium still reports
  // its hidden button as activeElement when the promise resolves, and drops the focus to <body> only a frame later.
  const modal = (answer) => async function () {
    const box = this.doc.body.appendChild(this.doc.createElement('div'));
    const ok = box.appendChild(this.doc.createElement('button'));
    ok.focus(); box.classList.add('hidden');
    return answer;
  };
  for (const [i, answer, act] of [[0, false, null], [0, true, { ok: false, error: 'Slice 1 is still going' }], [1, true, { ok: true }]]) {
    const deps = { act: async () => act };
    const x = setup(C(), deps);
    deps.confirm = modal(answer).bind(x);
    paintFeatureActions(x.doc, x.host, C({ approveEach: false }), { ...NOOP, ...deps });   // rebuild with the bound confirm
    blurOnDisable(x.win);
    x.menu()[i].click();
    await settle(); await settle(); await settle();
    assert.equal(x.doc.activeElement && x.doc.activeElement.dataset.act, 'feature-more', `item ${i}, confirm ${answer}`);
  }
  // A halted feature's own Re-plan the rest button: refused confirm, the focus comes back to it.
  const h = setup(C({ halted: true }));
  const deps = { ...NOOP, confirm: modal(false).bind(h) };
  paintFeatureActions(h.doc, h.host, C({ halted: true, approveEach: false }), deps);
  const replan = h.host.querySelector('[data-act="feature-replan"]');
  replan.focus(); replan.click(); await settle();
  assert.equal(h.doc.activeElement, replan);
});

// The bundle merge (D10): the host's run-model footer owns Pause / Stop / Resume.
test('paintFeatureActions omits what the model footer already shows', () => {
  const doc = track(new JSDOM('<!doctype html><body><div id=h></div></body>')).window.document;
  const host = doc.getElementById('h');
  const c = C({ halted: true, target: null });
  const deps = { act: async () => ({ ok: true }), confirm: async () => true, openPlan: () => {} };
  paintFeatureActions(doc, host, c, deps);
  assert.ok(host.querySelector('[data-act="feature-resume"]'), 'Resume shows without omit');
  paintFeatureActions(doc, host, c, deps, { omit: ['resume'] });
  assert.equal(host.querySelector('[data-act="feature-resume"]'), null);
  assert.ok(host.querySelector('[data-act="feature-replan"]'));
  assert.ok(host.querySelector('.shape-feature-more svg'));
  assert.equal(host.querySelector('.shape-feature-more').getAttribute('aria-label'), 'More actions');
  assert.equal(host.querySelector('[data-act="feature-pause"], [data-act="feature-stop"]'), null);  // no pause/stop deps
});

test('a running feature with no pause/stop deps paints no Pause or Stop (the group page, the chat card)', () => {
  const doc = track(new JSDOM('<!doctype html><body><div id=h></div></body>')).window.document;
  const host = doc.getElementById('h');
  paintFeatureActions(doc, host, C(), { act: async () => ({ ok: true }), confirm: async () => true, openPlan: () => {} });
  assert.equal(host.querySelector('[data-act="feature-pause"]'), null);
  assert.equal(host.querySelector('[data-act="feature-stop"]'), null);
  assert.ok(host.querySelector('[data-act="feature-more"]'));
});

test('run 4 D18: featureMenuItems runs the footer ⋯ actions from another menu and gives the focus back to it', async () => {
  const { window: w } = new JSDOM('<button id="a">⋯</button>');
  const anchor = w.document.getElementById('a');
  const posts = []; const confirms = [];
  const c = { active: true, rest: true, approveEach: false, planPipelineId: 'p0' };
  const items = featureMenuItems(c, { act: async (a, body) => { posts.push([a, body]); return { ok: true }; },
    confirm: async (o) => { confirms.push(o.title); return true; }, openPlan: () => posts.push(['plan']) }, anchor);
  assert.deepEqual(items.map((i) => i.label), ['Re-plan the rest', 'Cancel the rest', 'Ask before each run', 'Open the plan']);
  assert.equal(items[2].checked, false);
  await items[0].onSelect();
  await items[2].onSelect();
  assert.deepEqual(confirms, ['Re-plan the rest']);
  assert.deepEqual(posts, [['replan', null], ['approve-each', { on: true }]]);
  assert.equal(w.document.activeElement, anchor);
});

test('run 4 D17: paintFeatureActions with menu:false draws no ⋯', () => {
  const dom = track(new JSDOM('<!doctype html><body></body>'));
  const host = dom.window.document.body.appendChild(dom.window.document.createElement('div'));
  paintFeatureActions(dom.window.document, host, C(), { act: async () => ({ ok: true }), confirm: async () => true, pause: async () => {}, stop() {}, openPlan() {} }, { menu: false });
  assert.equal(host.querySelector('[data-act="feature-more"]'), null);
});
