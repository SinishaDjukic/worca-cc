// test/ui-usage-view.test.mjs — pure tests for ui/public/usage-view.mjs: the usage rings' model (slots, tones, the
// tie rule), the texts, and the painters for the avatar rings, the Usage row and the Usage submenu (detached DOM).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  liveHarnesses, usageTone, pickTightest, usageModel, pctText, resetText, asOfText, ringParts,
  paintUsageRings, paintUsageRow, renderUsageMenu,
} from '../ui/public/usage-view.mjs';
import { ringDash, RING_R, INNER_R } from '../ui/public/account-menu.mjs';
import { createFlyout } from '../ui/public/side-flyout.mjs';

const TZ = 'UTC';
const NOW = Date.parse('2026-11-18T14:28:00Z');   // a Wednesday
const AT = (iso) => Date.parse(iso);
const OPTS = { now: NOW, locale: 'en-GB', timeZone: TZ };
const win = (kind, pct, iso) => ({ kind, pct, resetsAt: AT(iso) });
const harness = (engine, windows, observedAt = NOW - 4 * 60_000) => ({ engine, observedAt, windows });
const answer = (...h) => ({ harnesses: h });

const MOCK = answer(
  harness('claude', [win('session', 41, '2026-11-18T15:30:00Z'), win('week', 73, '2026-11-23T09:00:00Z')], NOW),
  harness('codex', [win('session', 86, '2026-11-18T14:50:00Z'), win('week', 44, '2026-11-19T08:00:00Z')], NOW - 4 * 60_000),
);

const SHELL = `<button type="button" class="acct" id="side-acct"><span class="acct-ring-wrap">
<svg class="acct-ring" viewBox="0 0 38 38" aria-hidden="true"><g class="ring-s"><circle class="trk" cx="19" cy="19" r="17.5"></circle><circle class="arc" cx="19" cy="19" r="17.5"></circle></g><g class="ring-l"><circle class="trk" cx="19" cy="19" r="14"></circle><circle class="arc" cx="19" cy="19" r="14"></circle></g></svg>
<span class="acct-ava" aria-hidden="true">P</span></span></button>
<div class="menu nav-fly acct-menu" id="acct-menu" role="menu" hidden>
<div class="msect"><button type="button" class="mi menu-item" id="acct-settings" role="menuitem">Settings</button></div>
<div class="msect usage-sect" hidden><button type="button" class="mi menu-item" id="acct-usage" role="menuitem" aria-haspopup="menu" aria-expanded="false" aria-controls="usage-menu" hidden></button></div>
</div>
<div class="menu nav-fly usage-menu" id="usage-menu" role="menu" aria-label="Usage" hidden></div>`;
const shell = () => new JSDOM(`<!doctype html><body>${SHELL}</body>`).window;

test('ring tone at 79, 80 and 100', () => {
  assert.deepEqual([usageTone(0), usageTone(79), usageTone(80), usageTone(99), usageTone(100)], ['ok', 'ok', 'warn', 'warn', 'over']);
});

test('liveHarnesses drops passed windows and engines with none left; junk is ignored', () => {
  const a = answer(harness('claude', [win('session', 5, '2026-11-18T14:00:00Z')]), harness('codex', [win('week', 5, '2026-11-19T00:00:00Z'), win('session', 9, '2026-11-18T14:00:00Z')]),
    harness('copilot', [win('session', 5, '2026-11-19T00:00:00Z')]), null);
  assert.deepEqual(liveHarnesses(a, NOW), [harness('codex', [win('week', 5, '2026-11-19T00:00:00Z')])]);
  assert.deepEqual(liveHarnesses(null, NOW), []);
  assert.deepEqual(liveHarnesses({ harnesses: 'x' }, NOW), []);
});

test('slots: session outer, week else day inner, highest pct wins, ties by reset then engine order', () => {
  const m = usageModel(MOCK, { now: NOW });
  assert.deepEqual(m.session, { engine: 'codex', name: 'Codex', kind: 'session', pct: 86, tone: 'warn', resetsAt: AT('2026-11-18T14:50:00Z') });
  assert.deepEqual(m.long, { engine: 'claude', name: 'Claude Code', kind: 'week', pct: 73, tone: 'ok', resetsAt: AT('2026-11-23T09:00:00Z') });
  assert.equal(m.row.engine, 'codex');
  assert.deepEqual(m.blocks.map((b) => [b.engine, b.name, b.windows.map((w) => w.label)]),
    [['claude', 'Claude Code', ['Session', 'Week']], ['codex', 'Codex', ['Session', 'Week']]]);
  // Gemini's day fills the long slot only when no engine has a week; a week of the same engine wins over its day.
  const g = usageModel(answer(harness('gemini', [win('day', 52, '2026-11-19T00:00:00Z')])), { now: NOW });
  assert.equal(g.session, null);
  assert.deepEqual([g.long.engine, g.long.kind, g.long.pct], ['gemini', 'day', 52]);
  const both = usageModel(answer(harness('codex', [win('week', 10, '2026-11-20T00:00:00Z'), win('day', 90, '2026-11-19T00:00:00Z')])), { now: NOW });
  assert.deepEqual([both.long.kind, both.long.pct], ['week', 10]);
  assert.deepEqual([both.row.kind, both.row.pct], ['day', 90]);
  // Ties.
  const t1 = [{ engine: 'codex', pct: 50, resetsAt: 2 }, { engine: 'claude', pct: 50, resetsAt: 3 }];
  assert.equal(pickTightest(t1).engine, 'codex', 'the earlier reset');
  const t2 = [{ engine: 'gemini', pct: 50, resetsAt: 2 }, { engine: 'codex', pct: 50, resetsAt: 2 }, { engine: 'claude', pct: 50, resetsAt: 2 }];
  assert.equal(pickTightest(t2).engine, 'claude');
  assert.equal(pickTightest([]), null);
});

test('no reading draws no ring and hides the row', () => {
  const w = shell();
  const doc = w.document;
  const m = usageModel(answer(), { now: NOW });
  assert.deepEqual([m.session, m.long, m.row, m.blocks], [null, null, null, []]);
  const btn = doc.getElementById('side-acct');
  paintUsageRings(btn, m);
  assert.deepEqual([btn.dataset.usageS, btn.dataset.usageL], ['none', 'none']);
  const row = doc.getElementById('acct-usage');
  row.hidden = false; row.closest('.usage-sect').hidden = false;
  paintUsageRow(row, m, { doc });
  assert.equal(row.hidden, true);
  assert.equal(row.closest('.usage-sect').hidden, true);
});

test('a slot no provider reports is not drawn', () => {
  const doc = shell().document;
  const btn = doc.getElementById('side-acct');
  const models = {
    none: answer(),
    session: answer(harness('codex', [win('session', 41, '2026-11-18T16:00:00Z')])),
    day: answer(harness('gemini', [win('day', 52, '2026-11-19T00:00:00Z')])),
    both: MOCK,
  };
  for (const [name, a] of Object.entries(models)) {
    paintUsageRings(btn, usageModel(a, { now: NOW }));
    const dash = btn.querySelector('.ring-l .arc').getAttribute('stroke-dasharray') || '';
    assert.equal(btn.dataset.usageL !== 'none', dash !== '', name);
  }
  paintUsageRings(btn, usageModel(models.session, { now: NOW }));
  assert.deepEqual([btn.dataset.usageS, btn.dataset.usageL], ['ok', 'none']);
  assert.equal(btn.querySelector('.ring-s .arc').getAttribute('stroke-dasharray'), ringDash(0.41, RING_R));
  paintUsageRings(btn, usageModel(MOCK, { now: NOW }));
  assert.deepEqual([btn.dataset.usageS, btn.dataset.usageL], ['warn', 'ok']);
  assert.equal(btn.querySelector('.ring-l .arc').getAttribute('stroke-dasharray'), ringDash(0.73, INNER_R));
});

test('the row value', () => {
  const doc = shell().document;
  const row = doc.getElementById('acct-usage');
  paintUsageRow(row, usageModel(MOCK, { now: NOW }), { doc });
  assert.equal(row.hidden, false);
  assert.equal(row.closest('.usage-sect').hidden, false);
  assert.equal(row.querySelector('.mi-lbl').textContent, 'Usage');
  assert.equal(row.querySelector('.mi-val').textContent, 'Codex 86%');
  assert.equal(row.dataset.tone, 'warn');
  assert.ok(row.querySelector('svg.mini-ring .arc') && row.querySelector('.mi-chev'));
  paintUsageRow(row, usageModel(answer(harness('codex', [win('session', 100, '2026-11-18T16:00:00Z')])), { now: NOW }), { doc });
  assert.equal(row.querySelector('.mi-val').textContent, 'Codex Reached');
  assert.equal(row.dataset.tone, 'over');
  assert.equal(row.querySelectorAll('.mi-lbl').length, 1, 'a repaint replaces, never appends');
});

test('pct and reset text', () => {
  assert.deepEqual([pctText(0), pctText(86), pctText(100)], ['0%', '86%', 'Reached']);
  assert.equal(resetText(AT('2026-11-18T14:50:00Z'), OPTS), '14:50');
  assert.equal(resetText(AT('2026-11-19T09:00:00Z'), OPTS), 'Thu 09:00');
  assert.equal(asOfText(AT('2026-11-16T14:28:00Z'), OPTS), '14:28', '"as of" is the time alone');
  const us = resetText(AT('2026-11-18T14:50:00Z'), { ...OPTS, locale: 'en-US' });
  assert.match(us, /^0?2:50\s?PM$/i);
});

test('accessible name: one part per drawn ring', () => {
  assert.deepEqual(ringParts(usageModel(MOCK, { now: NOW }), OPTS),
    ['Session · Codex: 86%, resets 14:50', 'Week · Claude Code: 73%, resets Sun 09:00'.replace('Sun', new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: TZ }).format(AT('2026-11-23T09:00:00Z')))]);
  assert.deepEqual(ringParts(usageModel(answer(harness('codex', [win('session', 100, '2026-11-18T14:50:00Z')])), { now: NOW }), OPTS),
    ['Session · Codex: Reached, resets 14:50']);
  assert.deepEqual(ringParts(usageModel(answer(), { now: NOW }), OPTS), []);
});

test('submenu blocks', () => {
  const doc = shell().document;
  const menu = doc.getElementById('usage-menu');
  renderUsageMenu(menu, usageModel(MOCK, { now: NOW }), { doc, ...OPTS });
  const k = menu.querySelector('.nav-fly-k');
  assert.equal(k.textContent, 'Limits');
  assert.equal(k.getAttribute('aria-hidden'), 'true');
  const groups = [...menu.querySelectorAll('[role="group"]')];
  assert.deepEqual(groups.map((g) => g.getAttribute('aria-label')), ['Claude Code, as of 14:28', 'Codex, as of 14:24']);
  assert.deepEqual(groups.map((g) => g.querySelector('.uw-asof').textContent), ['as of 14:28', 'as of 14:24']);
  const rows = [...menu.querySelectorAll('[role="menuitem"]')];
  assert.deepEqual(rows.map((r) => [r.querySelector('.uw-kind').textContent, r.querySelector('.uw-pct').textContent, r.querySelector('.uw-reset').textContent, r.title, r.dataset.tone]), [
    ['Session', '41%', 'resets 15:30', 'Reported by Claude Code', 'ok'],
    ['Week', '73%', `resets ${resetText(AT('2026-11-23T09:00:00Z'), OPTS)}`, 'Reported by Claude Code', 'ok'],
    ['Session', '86%', 'resets 14:50', 'Reported by Codex', 'warn'],
    ['Week', '44%', 'resets Thu 08:00', 'Reported by Codex', 'ok'],
  ]);
  assert.ok(rows.every((r) => r.getAttribute('tabindex') === '-1' && r.querySelector('svg.mini-ring')));
  const day = renderUsageMenu(menu, usageModel(answer(harness('gemini', [win('day', 52, '2026-11-19T00:00:00Z')])), { now: NOW }), { doc, ...OPTS });
  assert.equal(day, undefined);
  assert.deepEqual([...menu.querySelectorAll('.uw-kind')].map((n) => n.textContent), ['Day']);
});

test('submenu at 100', () => {
  const doc = shell().document;
  const menu = doc.getElementById('usage-menu');
  renderUsageMenu(menu, usageModel(answer(harness('codex', [win('session', 100, '2026-11-18T14:50:00Z')])), { now: NOW }), { doc, ...OPTS });
  const row = menu.querySelector('[role="menuitem"]');
  assert.equal(row.querySelector('.uw-pct').textContent, 'Reached');
  assert.equal(row.dataset.tone, 'over');
});

test('submenu keyboard: arrows visit only the window rows and wrap', () => {
  const w = shell();
  const doc = w.document;
  w.HTMLElement.prototype.getBoundingClientRect ??= () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 });
  const acctMenu = doc.getElementById('acct-menu');
  const trigger = doc.getElementById('acct-usage');
  const menu = doc.getElementById('usage-menu');
  const m = usageModel(MOCK, { now: NOW });
  paintUsageRow(trigger, m, { doc });
  renderUsageMenu(menu, m, { doc, ...OPTS });
  for (const g of menu.querySelectorAll('[role="group"]')) assert.equal(/menuitem/.test(g.getAttribute('role')), false);
  assert.equal(menu.querySelector('.nav-fly-k').getAttribute('role'), null);
  acctMenu.hidden = false;
  const fly = createFlyout({ doc, win: w, trigger, menu, mode: 'beside', parent: acctMenu });
  fly.open({ focus: true });
  const rows = [...menu.querySelectorAll('[role="menuitem"]')];
  assert.equal(doc.activeElement, rows[0]);
  const seen = [];
  for (let i = 0; i < 4; i += 1) {
    doc.activeElement.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    seen.push(rows.indexOf(doc.activeElement));
  }
  assert.deepEqual(seen, [1, 2, 3, 0]);
});

test('provider text is set as text, never HTML', () => {
  const doc = shell().document;
  const menu = doc.getElementById('usage-menu');
  const evil = { harnesses: [{ engine: 'codex', observedAt: '<img src=x onerror=alert(1)>', windows: [{ kind: 'session', pct: 5, resetsAt: AT('2026-11-18T16:00:00Z') }] }] };
  const m = usageModel(evil, { now: NOW });
  m.blocks[0].name = '<img src=x onerror=alert(1)>';
  renderUsageMenu(menu, m, { doc, ...OPTS });
  assert.equal(menu.querySelectorAll('img').length, 0);
  assert.ok(menu.textContent.includes('<img src=x onerror=alert(1)>'));
});

test('repaint in place keeps focus on the same row', () => {
  const w = shell();
  const doc = w.document;
  const menu = doc.getElementById('usage-menu');
  menu.hidden = false;
  renderUsageMenu(menu, usageModel(MOCK, { now: NOW }), { doc, ...OPTS });
  menu.querySelector('[data-engine="codex"][data-kind="week"]').focus();
  const changed = answer(MOCK.harnesses[0], harness('codex', [win('session', 90, '2026-11-18T14:50:00Z'), win('week', 45, '2026-11-19T08:00:00Z')]));
  renderUsageMenu(menu, usageModel(changed, { now: NOW }), { doc, ...OPTS });
  const now = doc.activeElement;
  assert.equal(now.dataset.engine, 'codex');
  assert.equal(now.dataset.kind, 'week');
  assert.equal(now.querySelector('.uw-pct').textContent, '45%');
});
