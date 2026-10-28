// test/ui-labels-settings.test.mjs — Settings › Labels & cost tags › Labels (slice s2): the rows and their ⋯ menu.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { renderLabelsSection, runCount } from '../ui/public/labels-settings.mjs';
import { labelHue } from '../src/shared/run-labels.mjs';

const trackDom = useDomRelease(afterEach);
const docOf = () => trackDom(new JSDOM('<!doctype html><body></body>')).window.document;

test('renderLabelsSection: one row per label with its dot, the label, "on N runs" and a menu of Rename and Delete', () => {
  const doc = docOf();
  const calls = [];
  const list = renderLabelsSection(doc, [{ label: 'hotfix', count: 3 }, { label: 'needs demo', count: 1 }],
    { onRename: (r) => calls.push(['rename', r.label]), onDelete: (r) => calls.push(['delete', r.label]) });
  doc.body.append(list);
  const rows = [...list.querySelectorAll('.lbl-set-row')];
  assert.deepEqual(rows.map((r) => [r.querySelector('.lbl-set-name').textContent, r.querySelector('.lbl-set-count').textContent]),
    [['hotfix', 'on 3 runs'], ['needs demo', 'on 1 run']]);
  assert.ok(rows[0].querySelector(`.label-dot.hue-${labelHue('hotfix')}`));
  assert.ok(list.classList.contains('drows') && rows.every((r) => r.classList.contains('drow')), 'divided rows');
  assert.ok(rows[0].querySelector('.drow-label .lbl-set-name') && rows[0].querySelector('.drow-control .lbl-set-more'));
  const more = rows[0].querySelector('.lbl-set-more');
  assert.equal(more.getAttribute('aria-label'), 'More for hotfix');
  more.click();
  const items = [...doc.querySelectorAll('.wfv-menu [role="menuitem"]')];
  assert.deepEqual(items.map((i) => i.textContent.trim()), ['Rename', 'Delete']);
  items[1].click();
  assert.deepEqual(calls, [['delete', 'hotfix']]);
});

test('renderLabelsSection: no labels shows the empty hint and no rows; runCount says "1 run" and "2 runs"', () => {
  const list = renderLabelsSection(docOf(), []);
  assert.equal(list.querySelectorAll('.lbl-set-row').length, 0);
  assert.equal(list.querySelector('.lbl-set-empty').textContent, 'No labels yet. Add one from a run page or the Runs list.');
  assert.deepEqual([runCount(1), runCount(2)], ['1 run', '2 runs']);
});
