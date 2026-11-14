// test/design-system-turn-time.test.mjs — TurnTime (ui/public/design-system/components/turn-time.mjs, panel.turn-time):
// a conversation turn's time, shown on hover, focus or a tap, in the gap under the turn, moving nothing. Fixtures are local
// times, so the tests pass in any time zone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { turnTimeText, turnTime, youTurn, icon } from '../ui/public/design-system/components/index.mjs';

const NOW = new Date(2026, 10, 12, 15, 0).getTime();
const at = (mo, d, h, m, y = 2026) => new Date(y, mo, d, h, m).getTime();
const dom = (html) => new JSDOM(`<body>${html}</body>`).window.document.body;
const CSS = readFileSync(new URL('../ui/public/stillhet/css/rail.css', import.meta.url), 'utf8');

test('turnTimeText: today reads as its time, a later time today too', () => {
  assert.equal(turnTimeText(at(10, 12, 14, 32), NOW), '14:32');
  assert.equal(turnTimeText(at(10, 12, 15, 30), NOW), '15:30');
  assert.equal(turnTimeText(at(10, 12, 0, 0), NOW), '00:00');
});

test('turnTimeText: yesterday reads Yesterday and its time', () => {
  assert.equal(turnTimeText(at(10, 11, 9, 5), NOW), 'Yesterday 09:05');
});

test('turnTimeText: an older time of the same year reads its date and time, a week-bucket time too', () => {
  assert.equal(turnTimeText(at(10, 3, 14, 32), NOW), 'Nov 3, 14:32');
  assert.equal(turnTimeText(at(10, 5, 8, 0), NOW), 'Nov 5, 08:00');
});

test('turnTimeText: another year carries its year', () => {
  assert.equal(turnTimeText(at(11, 30, 8, 0, 2025), NOW), 'Dec 30 2025, 08:00');
});

test('turnTimeText: a time after today (clock skew) reads its date', () => {
  assert.equal(turnTimeText(at(10, 13, 10, 0), NOW), 'Nov 13, 10:00');
});

test('turnTimeText: an invalid or missing time is empty; an ISO string is parsed', () => {
  for (const v of [NaN, null, undefined, 'garbage']) assert.equal(turnTimeText(v, NOW), '', String(v));
  assert.equal(turnTimeText(new Date(at(10, 12, 13, 0)).toISOString(), NOW), '13:00');
});

test('turnTime: one time.turn-time, its datetime the ISO time, its text the formatted time', () => {
  const t = at(10, 12, 14, 32);
  const b = dom(turnTime({ at: t, now: NOW, attrs: { 'data-x': 'a"b' } }));
  assert.equal(b.children.length, 1);
  const el = b.firstElementChild;
  assert.ok(el.matches('time.turn-time'));
  assert.equal(el.getAttribute('datetime'), new Date(t).toISOString());
  assert.equal(el.textContent, '14:32');
  assert.equal(el.getAttribute('data-x'), 'a"b', 'its attributes are escaped');
});

test('turnTime: nothing for a missing or invalid time', () => {
  assert.equal(turnTime({ now: NOW }), '');
  assert.equal(turnTime({ at: NaN, now: NOW }), '');
  assert.equal(turnTime({ at: 'garbage', now: NOW }), '');
});

test('youTurn: a time is its last child; without one the markup is unchanged (I3)', () => {
  const plain = youTurn({ text: 'Same bug?', quote: 'Off by a cent', files: ['x.pdf'], attrs: { 'data-anchor': 'a1' } });
  assert.equal(plain, `<div class="convo-you" data-anchor="a1"><blockquote class="you-quote">Off by a cent</blockquote>Same bug?<span class="you-files"><span class="kind-chip">${icon('file', 12)}x.pdf</span></span></div>`);
  assert.equal(youTurn({ text: 'Hi', time: '' }), '<div class="convo-you">Hi</div>');
  const el = dom(youTurn({ text: 'Hi', files: ['x.pdf'], time: turnTime({ at: at(10, 12, 14, 32), now: NOW }) })).firstElementChild;
  assert.ok(el.lastElementChild.matches('time.turn-time'));
  assert.equal(el.lastElementChild.textContent, '14:32');
});

const rule = (sel) => { const m = CSS.match(new RegExp(`(^|\\n|\\})\\s*${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`)); return m ? m[2] : null; };
test('CSS: .turn-time is absolute, hidden by opacity, not a target and not copied', () => {
  const r = rule('.turn-time'); assert.ok(r, 'a .turn-time rule');
  for (const d of ['position:absolute', 'opacity:0', 'pointer-events:none', 'user-select:none']) assert.ok(r.replace(/\s/g, '').includes(d), d);
});

test('CSS: the reveal names :hover, :focus-within and .is-time-shown and sets only opacity:1 (I1)', () => {
  const m = CSS.match(/:is\(\.convo-you,\.convo-words\):is\(([^)]*)\)\s*\.turn-time\s*\{([^}]*)\}/);
  assert.ok(m, 'one reveal rule');
  for (const s of [':hover', ':focus-within', '.is-time-shown']) assert.ok(m[1].includes(s), s);
  assert.equal(m[2].replace(/[\s;]/g, ''), 'opacity:1');
});
