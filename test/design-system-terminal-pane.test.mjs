// test/design-system-terminal-pane.test.mjs — TerminalPane (docs/rail/panels.md › panel.terminal): a command's shell under
// its card, composed of LogLines, Field and Button; its output a polite live log; closed, "Shell closed" with dev's tip and
// the input off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { terminalPane } from '../ui/public/design-system/components/index.mjs';
import { SHELL_CLOSED } from '../ui/public/design-system/components/terminal-pane.mjs';

const dom = (html) => new JSDOM(`<body>${html}</body>`).window.document.body.firstElementChild;
const hooks = { stop: { 'data-term-stop': 's1' }, close: { 'data-term-close': 's1' }, send: { 'data-term-input': 's1' } };

test('open: the output is a polite live log of its lines; one input line; Stop and Close carry their hooks', () => {
  const el = dom(terminalPane({ title: 'npm test', lines: [{ t: '10:01', text: 'ok 1' }, { t: '10:02', text: '<b>' }], hooks }));
  const log = el.querySelector('[role="log"]');
  assert.ok(log, 'role=log');
  assert.equal(log.getAttribute('aria-live'), 'polite');
  assert.equal(log.querySelectorAll('li').length, 2);
  assert.ok(log.innerHTML.includes('&lt;b&gt;'), 'output is escaped');
  const input = el.querySelector('input[data-term-input="s1"]');
  assert.ok(input && !input.disabled);
  assert.equal(el.querySelector('[data-term-stop="s1"]').textContent, 'Stop');
  assert.equal(el.querySelector('[data-term-close="s1"]').textContent, 'Close');
});

test('closed: "Shell closed" is its last line, the input is off with dev\'s reason, and Stop is gone', () => {
  const el = dom(terminalPane({ title: 'npm test', lines: [{ t: '10:01', text: 'ok 1' }], closed: true, hooks }));
  const rows = [...el.querySelectorAll('[role="log"] li')];
  assert.match(rows.at(-1).textContent, /Shell closed/);
  const input = el.querySelector('input[data-term-input="s1"]');
  assert.equal(input.disabled, true);
  assert.equal(input.getAttribute('title'), SHELL_CLOSED);
  assert.equal(el.querySelector('[data-term-stop]'), null);
  assert.ok(el.querySelector('[data-term-close="s1"]'));
});
