// test/team-metrics-timeline-view.test.mjs
// Timeline renderers (ui/public/team-metrics-timeline.mjs): calendar windows in local time, the
// summary tiles (merge data vs. the "Completed" fallback), rows grouped by project or person,
// bars/marks per status, the data-source notice, and the item popover.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { makeRecord } from './fixtures/team-metrics/records.mjs';
import { buildWorkItems } from '../src/shared/team-metrics/timeline.mjs';
import {
  renderTimeline, renderTimelinePopover, timelineWindow, shiftAnchor, isoWeek, fmtSpan, prNotice,
} from '../ui/public/team-metrics-timeline.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const local = (y, m, d, hh = 0, mm = 0) => new Date(y, m - 1, d, hh, mm).getTime();
const NOW = local(2026, 9, 24, 14, 30);
const iso = (t) => new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');

function rec({ id, start, minutes = 60, branch = `worca/${id}`, ...rest }) {
  const r = makeRecord({ id, startedAt: iso(start), ...rest });
  r.endedAt = iso(start + minutes * 60_000);
  r.git.branch = branch;
  return r;
}

const RECORDS = [
  rec({ id: 'ship', start: local(2026, 9, 14, 9), actor: 'Mara Kovač', title: 'Responses upstream', project: 'acme/api' }),
  rec({ id: 'open', start: local(2026, 9, 24, 9), actor: 'Ines Vogel', title: 'Delivery timeline', project: 'acme/api' }),
  rec({ id: 'fail', start: local(2026, 9, 18, 9), actor: 'Dev Patel', title: 'Flaky reconnect', result: 'failed', project: 'acme/docs' }),
  rec({ id: 'aug', start: local(2026, 8, 3, 9), actor: 'Dev Patel', title: 'Old work', project: 'acme/docs' }),
];
const PRS = {
  ship: [{ repo: 'acme/api', number: 474, url: 'https://github.com/acme/api/pull/474', state: 'MERGED', createdAt: iso(local(2026, 9, 16, 14)), mergedAt: iso(local(2026, 9, 22, 17)) }],
  open: [{ repo: 'acme/api', number: 481, url: 'https://github.com/acme/api/pull/481', state: 'OPEN', createdAt: iso(local(2026, 9, 24, 10)) }],
  fail: [],
  aug: [],
};
const items = buildWorkItems(RECORDS, { prs: PRS, now: NOW });

test('calendar windows: month, Monday-first week, 06–22 day; stepping', () => {
  const m = timelineWindow('month', NOW);
  assert.equal(m.s, local(2026, 9, 1));
  assert.equal(m.e, local(2026, 10, 1));
  assert.equal(m.W, 30 * 24, 'minimum width');
  assert.equal(timelineWindow('month', NOW, { fit: 1000 }).W, 1000, 'stretches to the panel');
  assert.equal(timelineWindow('month', NOW, { fit: 300 }).W, 30 * 24, 'never below the minimum (then it scrolls)');
  const w = timelineWindow('week', NOW);
  assert.equal(new Date(w.s).getDay(), 1);
  assert.equal(w.s, local(2026, 9, 21));
  const d = timelineWindow('day', NOW);
  assert.equal(d.s, local(2026, 9, 24, 6));
  assert.equal(d.e, local(2026, 9, 24, 22));
  assert.equal(new Date(shiftAnchor('month', NOW, 1)).getMonth(), 9);
  assert.equal(shiftAnchor('week', NOW, -1), local(2026, 9, 17, 14, 30));
  assert.equal(isoWeek(NOW), 39);
  assert.equal(fmtSpan(45 * 60_000), '45m');
  assert.equal(fmtSpan(190 * 60_000), '3h 10m');
  assert.equal(fmtSpan((2 * 24 + 4) * 3_600_000), '2d 4h');
});

test('month view: tiles, groups by project, bars and marks per status', () => {
  const el = renderTimeline({ items, zoom: 'month', anchor: NOW, mode: 'items', now: NOW }, { doc });
  const tiles = [...el.querySelectorAll('.tl-tile')].map((t) => [t.querySelector('.stat-label span').textContent, t.querySelector('.stat-value').textContent]);
  assert.deepEqual(tiles, [['Shipped', '1'], ['In review', '1'], ['Needs attention', '1'], ['Median lead time', '8d 8h'], ['Agent spend', '$3.00']]);
  assert.deepEqual([...el.querySelectorAll('.tl-group b')].map((b) => b.textContent), ['acme/api', 'acme/docs']);
  const rows = [...el.querySelectorAll('.tl-item')];
  assert.equal(rows.length, 3, 'August work is outside September');
  const ship = rows.find((r) => r.textContent.includes('Responses upstream'));
  assert.ok(ship.querySelector('.tl-mark.is-merged'));
  assert.ok(ship.querySelector('.tl-tail'));
  assert.match(ship.querySelector('.tl-meta').textContent, /Mara Kovač · Shipped/);
  const open = rows.find((r) => r.textContent.includes('Delivery timeline'));
  assert.ok(open.querySelector('.tl-mark.is-open'));
  const fail = rows.find((r) => r.textContent.includes('Flaky reconnect'));
  assert.ok(fail.querySelector('.tl-run.is-failed'));
  assert.match(fail.querySelector('.tl-meta').textContent, /Needs attention/);
  // Header: 30 day cells + week cells, today marked, one merge pip on the 22nd.
  assert.equal(el.querySelectorAll('.tl-hcell[data-tl-day]').length, 30);
  assert.ok(el.querySelector('.tl-hcell[data-tl-week]'));
  assert.equal(el.querySelector('.tl-hcell.is-today').dataset.tlDay, String(local(2026, 9, 24)));
  assert.equal(el.querySelector(`.tl-hcell[data-tl-day="${local(2026, 9, 22)}"] .tl-pips i`) != null, true);
  assert.ok(el.querySelector('.tl-now'));
  assert.equal(el.querySelector('.tl-crumb-cur').textContent, 'September 2026');
});

test('people grouping, filters, week and day zooms', () => {
  const people = renderTimeline({ items, zoom: 'month', anchor: NOW, mode: 'people', now: NOW }, { doc });
  assert.deepEqual([...people.querySelectorAll('.tl-group b')].map((b) => b.textContent), ['Dev Patel', 'Ines Vogel', 'Mara Kovač']);
  assert.equal(people.querySelector('.tl-mode button.on').dataset.tlMode, 'people');
  const att = renderTimeline({ items, zoom: 'month', anchor: NOW, mode: 'items', filter: 'attention', now: NOW }, { doc });
  assert.equal(att.querySelectorAll('.tl-item').length, 1);
  assert.equal(att.querySelector('[data-tl-filter="attention"]').getAttribute('aria-pressed'), 'true');
  const week = renderTimeline({ items, zoom: 'week', anchor: NOW, mode: 'items', now: NOW }, { doc });
  assert.equal(week.querySelectorAll('.tl-hcell[data-tl-day]').length, 7);
  assert.deepEqual([...week.querySelectorAll('.tl-crumb')].map((b) => b.dataset.tlZoom), ['month']);
  const day = renderTimeline({ items, zoom: 'day', anchor: NOW, mode: 'items', now: NOW }, { doc });
  assert.equal(day.querySelectorAll('.tl-hour').length, 16);
  assert.equal(day.querySelector('.tl-crumb-cur').textContent, 'Thu 24 Sep');
  const empty = renderTimeline({ items, zoom: 'month', anchor: local(2026, 12, 5), mode: 'items', now: NOW }, { doc });
  assert.match(empty.querySelector('.tl-empty').textContent, /No work in this period/);
});

test('without merge data: Completed tile, no lead time, and the notice says why', () => {
  const noPr = buildWorkItems(RECORDS, { now: NOW });
  const el = renderTimeline({ items: noPr, zoom: 'month', anchor: NOW, mode: 'items', now: NOW, prStatus: { gh: 'missing', actionRepos: [], unsupportedRepos: [] } }, { doc });
  const labels = [...el.querySelectorAll('.tl-tile .stat-label span')].map((s) => s.textContent);
  assert.deepEqual(labels, ['Completed', 'Needs attention', 'Agent spend']);
  const note = el.querySelector('.tl-note');
  assert.match(note.textContent, /GitHub CLI \(gh\) is not installed/);
  assert.match(note.textContent, /worca metrics pr-workflow/);
  assert.match(note.textContent, /Completed counts finished runs/);
  // The Action answers → no gh nag.
  assert.equal(prNotice(doc, { status: { gh: 'missing', actionRepos: ['acme/api'], unsupportedRepos: [] } }), null);
  assert.match(prNotice(doc, { status: { gh: 'unauthenticated', actionRepos: [] } }).textContent, /not signed in/);
  assert.match(prNotice(doc, { status: { gh: 'ok', actionRepos: [], unsupportedRepos: ['gitlab.com/g/api'] } }).textContent, /gitlab\.com\/g\/api shows without merge data/);
  assert.match(prNotice(doc, { loading: true }).textContent, /Checking pull requests/);
  assert.equal(prNotice(doc, { status: { gh: 'ok', actionRepos: [] } }), null);
});

test('popover: status, reason, PR links (http only), runs', () => {
  const ship = items.find((i) => i.title === 'Responses upstream');
  const pop = renderTimelinePopover(ship, { doc, now: NOW });
  assert.equal(pop.querySelector('.tl-pill').textContent, 'Shipped');
  assert.match(pop.textContent, /Lead time8d 8h \(first run to merge\)/);
  assert.equal(pop.querySelector('a').getAttribute('href'), 'https://github.com/acme/api/pull/474');
  assert.equal(pop.querySelectorAll('.tl-att').length, 1);
  const fail = items.find((i) => i.title === 'Flaky reconnect');
  const fp = renderTimelinePopover(fail, { doc, now: NOW });
  assert.equal(fp.querySelector('.tl-reason').textContent, 'The last attempt failed.');
  assert.match(fp.textContent, /Pull requestNone opened/);
  const evil = { ...ship, prs: [{ ...ship.prs[0], url: 'javascript:alert(1)' }] };
  assert.equal(renderTimelinePopover(evil, { doc, now: NOW }).querySelector('a'), null);
});
