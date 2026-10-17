// test/verify-buttons-cdp.test.mjs — the pure half of the main-views button audit: three heights, one lg, tabs at 32,
// the CTA content-sized at desktop and spanning at 390px. Importing the tool must not start a server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditView, auditCta, VIEW_NAMES, SCALE, SCALE_SEL } from '../tools/verify-buttons-cdp.mjs';

const b = (cls, h, w = 80) => ({ cls, h, w });

test('the scale is 28 / 34 / 42 and the selector names the three aliases', () => {
  assert.deepEqual(SCALE, [28, 34, 42]);
  for (const c of ['.btn', '.btn-ghost', '.btn-go', '.rd-cta']) assert.ok(SCALE_SEL.split(', ').includes(c), c);
});

test('the audited views are the 12 the outline lists', () => {
  assert.deepEqual(VIEW_NAMES, ['chat-home', 'chat-run-card', 'run-live', 'run-saved', 'runs', 'new', 'schedules', 'projects',
    'models', 'stats', 'settings', 'dialog']);
});

test('auditView passes 28, 34 and one 42', () => {
  assert.deepEqual(auditView('new', [b('btn btn-mini', 28), b('btn-ghost', 34), b('btn-go btn-lg', 42)]), []);
});

test('auditView rejects an off-scale height, a second lg and an empty view; minButtons 0 allows an empty view', () => {
  assert.match(auditView('models', [b('btn-ghost', 36)])[0], /36px \(28, 34 or 42\)/);
  assert.match(auditView('run-saved', [b('rd-cta', 42), b('btn-go btn-lg', 42)])[0], /2 lg buttons/);
  assert.match(auditView('stats', [])[0], /no scale buttons/);
  assert.deepEqual(auditView('chat-home', [], { minButtons: 0 }), []);
});

test('auditView pins must-draw buttons and the 32px tabs', () => {
  const must = [{ sel: '#project-add-btn', found: true, h: 34, want: 28 }, { sel: '.sched-feed-open', found: false }];
  const fails = auditView('x', [b('btn', 34)], { must, tabs: [{ cls: 'hd-tab', h: 40 }] });
  assert.equal(fails.length, 3);
  assert.match(fails[0], /#project-add-btn is 34px, want 28/);
  assert.match(fails[1], /\.sched-feed-open is not drawn/);
  assert.match(fails[2], /tab hd-tab is 40px, want 32/);
  assert.match(auditView('settings', [b('btn', 28)], { tabs: [] })[0], /no tabs drawn/);
});

test('auditCta: content-sized at desktop, spanning at 390px', () => {
  assert.deepEqual(auditCta({ cta: { w: 220 }, box: { w: 760 } }, false), []);
  assert.match(auditCta({ cta: { w: 760 }, box: { w: 760 } }, false)[0], /not content-sized/);
  assert.deepEqual(auditCta({ cta: { w: 358 }, box: { w: 358 } }, true), []);
  assert.match(auditCta({ cta: { w: 200 }, box: { w: 358 } }, true)[0], /does not span/);
  assert.match(auditCta({ cta: null, box: { w: 358 } }, false)[0], /no \.rd-cta/);
});
