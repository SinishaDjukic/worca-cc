// test/ui-automations-view.test.mjs — the Automations tab's PR control and Waiting lines (design system: PR controls,
// status line "State · detail").
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { prControl, waitLine, renderAutomations, eventStatus } from '../ui/public/automations-view.mjs';

const trackDom = useDomRelease(afterEach);
const domOf = () => trackDom(new JSDOM('<!doctype html><body></body>'));

test('prControl: one PR is a secondary small View PR link led by the pull-request glyph', () => {
  const doc = domOf().window.document;
  const a = prControl(doc, { prUrl: 'https://github.com/o/r/pull/7' });
  assert.equal(a.tagName, 'A');
  assert.equal(a.className, 'btn btn-sm');
  assert.equal(a.textContent.trim(), 'View PR');
  assert.equal(a.getAttribute('href'), 'https://github.com/o/r/pull/7');
  assert.ok(a.firstChild.matches('span.ic'), 'the glyph leads');
  assert.equal(a.firstChild.style.width, '14px');
});

test('prControl: several PRs are one View PRs ▾ whose menu names each repository', () => {
  const dom = domOf();
  const doc = dom.window.document;
  const opened = [];
  dom.window.open = (url) => { opened.push(url); return null; };
  const b = prControl(doc, { prs: [{ name: 'api', url: 'https://github.com/o/api/pull/1' }, { name: 'web', url: 'https://github.com/o/web/pull/2' },
    { name: 'bad', url: 'javascript:alert(1)' }, { name: 'none' }] });
  doc.body.append(b);
  assert.equal(b.tagName, 'BUTTON');
  assert.equal(b.className, 'btn btn-sm automations-prs');
  assert.equal(b.textContent.trim(), 'View PRs');
  assert.equal(b.querySelectorAll('span.ic svg').length, 2, 'the PR glyph and the chevron, no typed ▾');
  b.click();
  const items = [...doc.querySelectorAll('.menu [role="menuitem"]')];
  assert.deepEqual(items.map((i) => i.textContent.trim()), ['View PR · api', 'View PR · web']);
  items[1].click();
  assert.deepEqual(opened, ['https://github.com/o/web/pull/2']);
});

test('prControl: no https PR, no control', () => {
  const doc = domOf().window.document;
  assert.equal(prControl(doc, {}), null);
  assert.equal(prControl(doc, { prUrl: 'http://x/pull/1' }), null);
});

test('waitLine: "Waiting · detail", no colon forms', () => {
  const now = Date.UTC(2026, 9, 24, 19, 0, 0);
  assert.equal(waitLine({ reason: 'daily-cap' }, now), 'Waiting · daily limit · starts 00:00 UTC (in about 5 hours)');
  assert.equal(waitLine({ reason: 'daily-cap' }, Date.UTC(2026, 9, 24, 23, 30)), 'Waiting · daily limit · starts 00:00 UTC (in about 1 hour)');
  assert.equal(waitLine({ reason: 'concurrency' }, now), 'Waiting · starts when a run ends');
});

test('Waiting row: the status line leads, the caveat sits in the tooltip', () => {
  const doc = domOf().window.document;
  const root = renderAutomations(doc, { scope: 'project', repo: 'o/r', forge: 'github', rules: [], events: [], switches: [],
    queue: [{ id: 'e1', number: 3, title: 'Crash', kind: 'issue', action: 'propose', reason: 'daily-cap' }] });
  const line = root.querySelector('.automations-waiting .hint');
  assert.match(line.textContent, /^Waiting · daily limit · starts 00:00 UTC .* · Triage and propose$/);
  assert.ok(!line.textContent.includes(': '), 'no colon form');
  assert.match(line.title, /next day's limit/);
});

test('eventStatus and the Recent meta line: reasons and triage carry no colon forms', () => {
  for (const reason of ['daily-cap', 'question', 'needs-info', 'concurrency', 'queue-full', 'untrusted-author'])
    assert.ok(!eventStatus({ status: 'skipped', reason }).reason.includes(': '), reason);
  const doc = domOf().window.document;
  const root = renderAutomations(doc, { scope: 'project', repo: 'o/r', forge: 'github', rules: [], switches: [], queue: [],
    events: [{ id: 'e1', number: 4, title: 'How do I export?', kind: 'issue', action: 'propose', phase: 'question', status: 'skipped', reason: 'question' }] });
  assert.equal(root.querySelector('.automations-event .hint').textContent, 'Triage and propose · triaged as question · a question · commented, no run');
});
