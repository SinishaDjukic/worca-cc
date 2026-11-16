// test/design-system-time-track.test.mjs — TimeTrack, WorkBar, MarkLegend and their helpers (docs/rail/look.md ›
// look.time-track): a person's work on a day axis, each row one task, its PR mark the row's one second target.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { trackX, dayTicks, workBar, markLegend, timeTrack, gitMark } from '../ui/public/design-system/components/index.mjs';

const DAY = 86_400_000, NOV = (d, h = 0) => Date.UTC(2026, 10, d, h);
const dom = (html) => new JSDOM(`<body>${html}</body>`).window.document;

test('trackX: a time on the track, clamped to 0..1', () => {
  assert.equal(trackX(NOV(5), NOV(1), NOV(9)), 0.5);
  assert.equal(trackX(NOV(1) - DAY, NOV(1), NOV(9)), 0);
  assert.equal(trackX(NOV(20), NOV(1), NOV(9)), 1);
});

test('trackX: a track whose end is not after its start throws', () => {
  assert.throws(() => trackX(NOV(1), NOV(2), NOV(2)), (e) => e instanceof RangeError && e.message === 'empty track');
  assert.throws(() => trackX(NOV(1), NOV(3), NOV(2)), RangeError);
});

test('dayTicks: Nov 1 to 8 is 8 days, each one labelled', () => {
  const t = dayTicks(NOV(1), NOV(9) - 1);
  assert.equal(t.days, 8);
  assert.deepEqual(t.ticks.map((x) => x.label), ['Nov 1', 'Nov 2', 'Nov 3', 'Nov 4', 'Nov 5', 'Nov 6', 'Nov 7', 'Nov 8']);
  assert.equal(t.ticks[0].x, 0);
  assert.ok(t.ticks.every((x) => x.x >= 0 && x.x < 1));
});

test('dayTicks: 30 days carry at most 10 labels, the first always Nov 1', () => {
  const t = dayTicks(NOV(1), NOV(31) - 1);
  assert.equal(t.days, 30);
  assert.ok(t.ticks.length <= 10 && t.ticks.length > 1, `${t.ticks.length} labels`);
  assert.equal(t.ticks[0].label, 'Nov 1');
});

test('workBar: without a wait there is no dashed tail', () => {
  const d = dom(workBar({ work: [0.1, 0.4] }));
  assert.equal(d.querySelectorAll('.tt-work').length, 1);
  assert.equal(d.querySelector('.tt-wait'), null);
  const w = dom(workBar({ work: [-0.2, 0.4], wait: [0.4, 0.8] }));
  assert.ok(w.querySelector('.tt-wait'), 'a wait draws its dashed tail');
  assert.ok(w.querySelector('.tt-work.is-cut'), 'a span that starts before the window says it is cut');
});

test('workBar: a PR with a url is a new-tab link, never inside a button', () => {
  const d = dom(`<button>${'x'}</button>${workBar({ work: [0.1, 0.4], end: { status: 'merged', x: 0.9, url: 'https://github.com/acme/billing-api/pull/1418', label: '#1418 merged, opens the pull request' } })}`);
  const a = d.querySelector('a.tt-end');
  assert.ok(a);
  assert.equal(a.getAttribute('target'), '_blank');
  assert.equal(a.getAttribute('rel'), 'noopener noreferrer');
  assert.equal(a.getAttribute('href'), 'https://github.com/acme/billing-api/pull/1418');
  assert.equal(a.closest('button'), null);
  assert.ok(a.querySelector('.git-mark'));
  const none = dom(workBar({ work: [0, 0.2], end: { status: 'open', x: 0.5, label: '#7 open' } }));
  assert.ok(none.querySelector('button.tt-end'), 'without a url the mark is a button');
});

test('workBar: the card is named by the mark it describes', () => {
  const d = dom(workBar({ work: [0.1, 0.4], wait: [0.4, 0.7], end: { status: 'merged', x: 0.7, url: 'https://x/1', label: '#1' }, card: { title: 'Retry failed webhook deliveries', line: '#1418 merged Nov 8, 11:00' } }));
  const mark = d.querySelector('.tt-end'), card = d.querySelector('.tline-card');
  assert.ok(card.id);
  assert.equal(mark.getAttribute('aria-describedby'), card.id);
  assert.match(card.className, /is-track/);
  // the card says it once: no native "Merged" tooltip on the mark beside it (review cycle 1, issue 4)
  assert.equal(d.querySelectorAll('[title]').length, 0);
});

test('workBar: without a card, the mark keeps its own title', () => {
  const d = dom(workBar({ work: [0.1, 0.4], end: { status: 'merged', x: 0.4, label: '#1' } }));
  assert.equal(d.querySelector('.tt-end .git-mark').getAttribute('title'), 'Merged');
});

test('markLegend names the five marks; timeTrack puts each title in its button and the bar beside it', () => {
  const legend = markLegend({ items: [{ line: 'solid', text: 'Agent working, first run to last' }, { line: 'dashed', text: 'Waiting for review' }, { mark: gitMark({ status: 'merged' }), text: 'Merged' }, { mark: gitMark({ status: 'open' }), text: 'Open' }, { mark: gitMark({ status: 'closed' }), text: 'Closed' }] });
  const d = dom(timeTrack({ label: "Maya's work", ...dayTicks(NOV(1), NOV(9) - 1), rows: [
    { id: 'a', mark: '', title: 'Retry failed webhook deliveries', sub: 'billing-api · #1418', bar: workBar({ work: [0.1, 0.4], end: { status: 'merged', x: 0.6, url: 'https://x/1', label: '#1418' } }), label: 'Retry failed webhook deliveries, Merged', attrs: { 'data-x': '1' } },
  ], legend, more: { n: 3, attrs: { 'data-more': '' } } }));
  assert.equal(d.querySelectorAll('.tt-legend .ch-key').length, 5);
  const btn = d.querySelector('button.tt-open');
  assert.match(btn.textContent, /Retry failed webhook deliveries/);
  assert.equal(btn.getAttribute('data-x'), '1');
  assert.equal(btn.querySelector('.tt-work'), null, 'the bar is not in the button');
  assert.ok(d.querySelector('.tt-row .tt-lane .tt-work'));
  assert.equal(d.querySelector('.tt').getAttribute('role'), 'group');
  assert.equal(d.querySelector('[data-more]').textContent, 'Show 3 more');
});

test('workBar: a url that is not http(s) gives no href; the mark is a button', () => {
  const d = dom(workBar({ work: [0, 0.2], end: { status: 'open', x: 0.5, url: 'javascript:alert(1)', label: '#7 open' } }));
  assert.equal(d.querySelector('[href]'), null);
  assert.ok(d.querySelector('button.tt-end'));
});
