// test/design-system-task-view.test.mjs — TaskView (docs/rail/thing-page.md › thing.read-only): a teammate's task, read
// only: the task page's head, metadata, StatusLine, Figures, runs and PR; never an action, a step or a log.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { taskView, kindMark } from '../ui/public/design-system/components/index.mjs';

const model = (o = {}) => ({
  back: { label: 'By person › Maya', attrs: { 'data-in-back': '' } },
  mark: kindMark({ kind: 'task', tone: 'fail' }),
  title: 'Tax ID validation',
  meta: ['Maya', 'web-app', 'Default', 'ENG-12', 'feat/tax-id', '+40 −3'],
  state: { tone: 'is-red', word: 'Failed', detail: 'The last attempt failed.' },
  figures: [{ k: 'Cost', v: '$12.40' }, { k: 'Time working', v: '24m' }, { k: 'Runs', v: '2' }, { k: 'Review rounds', v: '1' }],
  pr: { status: 'merged', label: '#1418 merged Nov 8', url: 'https://github.com/acme/web-app/pull/1418' },
  runs: { columns: [{ id: 'started', label: 'Started' }, { id: 'result', label: 'Result' }, { id: 'cost', label: 'Cost', num: true }, { id: 'time', label: 'Time', num: true }], rows: [{ started: 'Nov 3, 10:00', result: 'Failed', cost: '$6.20', time: '12m' }, { started: 'Nov 4, 10:00', result: 'Failed', cost: '$6.20', time: '12m' }] },
  ...o,
});
const dom = (html) => new JSDOM(`<body>${html}</body>`).window.document;

test('taskView shows its seven slots: back, title, metadata, StatusLine, figures, PR, runs', () => {
  const d = dom(taskView(model()));
  assert.match(d.querySelector('[data-in-back]').textContent, /By person › Maya/);
  assert.match(d.querySelector('.tv-title').textContent, /Tax ID validation/);
  assert.ok(d.querySelector('.tv-title .kind-mark'));
  assert.equal(d.querySelector('.tv-meta').textContent, 'Maya · web-app · Default · ENG-12 · feat/tax-id · +40 −3');
  assert.equal(d.querySelector('.rc-zone .rc-word').textContent, 'Failed');
  assert.equal(d.querySelector('.rc-zone .rc-detail').textContent, 'The last attempt failed.');
  assert.match(d.querySelector('.rc-figs').textContent, /Cost \$12\.40.*Time working 24m.*Runs 2.*Review rounds 1/);
  assert.ok(d.querySelector('.tv-pr .git-mark'));
  assert.equal(d.querySelector('.tv-pr a').getAttribute('href'), 'https://github.com/acme/web-app/pull/1418');
  assert.equal(d.querySelector('table.rt').getAttribute('aria-label'), 'Runs');
});

test('taskView has no ⋯ and an empty action slot', () => {
  const html = taskView(model());
  assert.doesNotMatch(html, /⋯|data-menu|more/i);
  const zone = dom(html).querySelector('.rc-zone');
  assert.deepEqual([...zone.children].map((c) => c.className), ['rc-rail', 'rc-main rc-word', 'rc-detail']);
});

test('taskView has exactly one control besides the PR link: the back link', () => {
  const d = dom(taskView(model()));
  const controls = [...d.querySelectorAll('button, a[href], input, select, textarea, [tabindex]')];
  assert.equal(controls.filter((c) => !c.closest('.tv-pr')).length, 1);
  assert.ok(controls[0].matches('[data-in-back]'));
  assert.equal(d.querySelector('.tv-pr a').getAttribute('target'), '_blank');
  assert.equal(d.querySelector('.tv-pr a').getAttribute('rel'), 'noopener noreferrer');
  assert.equal(dom(taskView(model({ pr: null }))).querySelector('.tv-pr'), null, 'no PR, no line');
});

test('taskView escapes its text', () => {
  const d = dom(taskView(model({ title: '<b>bold</b> idea', meta: ['<i>x</i>'] })));
  assert.equal(d.querySelector('.tv-title b'), null);
  assert.match(d.querySelector('.tv-title').textContent, /<b>bold<\/b> idea/);
  assert.equal(d.querySelector('.tv-meta i'), null);
});

test('taskView lists one table row per run', () => {
  assert.equal(dom(taskView(model())).querySelectorAll('table.rt tbody tr').length, 2);
});

test('taskView: a PR without an http(s) url is its label as text, no link', () => {
  for (const url of ['javascript:alert(1)', '']) {
    const d = dom(taskView(model({ pr: { status: 'open', label: '#7 open', url } })));
    assert.equal(d.querySelector('.tv-pr [href]'), null);
    assert.equal(d.querySelector('.tv-pr').textContent, '#7 open');
  }
});
