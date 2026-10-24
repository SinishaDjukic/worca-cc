// test/ask-command-card.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createCommandCard, longCommand } from '../ui/public/ask-command-card.mjs';

const dom = () => new JSDOM('<!doctype html><html><body></body></html>').window.document;
const CARD = { type: 'command', blockId: 't-0000000001:1', sessionId: 't-0000000001', seq: 1, command: 'npm test', folder: 'demo · main', warning: null };

test('a running command: the command, a live tail, a Stop button', () => {
  const doc = dom(); const stops = [];
  const c = createCommandCard({ doc, card: CARD, onStop: (sid) => stops.push(sid) });
  doc.body.appendChild(c.el);
  c.update({ status: 'running', tail: 'PASS a\nPASS b\n', exitCode: null });
  assert.equal(c.el.querySelector('.ask-cmd-line').textContent, '$ npm test');
  assert.equal(c.el.querySelector('.ask-cmd-more').hidden, true, 'a short command needs no Show all');
  assert.match(c.el.querySelector('.ask-cmd-out').textContent, /PASS b/);
  assert.equal(c.el.querySelector('.ask-cmd-out').hidden, true, 'the output is folded by default');
  const stop = c.el.querySelector('.ask-cmd-stop');
  assert.equal(stop.hidden, false);
  stop.click();
  assert.deepEqual(stops, ['t-0000000001']);
  assert.equal(stop.disabled, true);                      // one click
});

test('ended: exit pill, no Stop; a failure is red, a cap stop says so', () => {
  const doc = dom();
  const c = createCommandCard({ doc, card: CARD, onStop: () => {} });
  c.update({ status: 'done', exitCode: 1, tail: 'FAIL', durationMs: 4200 });
  assert.equal(c.el.querySelector('.ask-cmd-stop').hidden, true);
  assert.equal(c.el.querySelector('.ask-cmd-pill').textContent, 'exit 1');
  assert.ok(c.el.querySelector('.ask-cmd-pill').classList.contains('st-red'));
  c.update({ status: 'stopped', exitCode: 130, stoppedBy: 'ask:cap', tail: '' });
  assert.equal(c.el.querySelector('.ask-cmd-pill').textContent, 'stopped (30-min cap)');
});

test('the live-run warning shows when the card carries one', () => {
  const doc = dom();
  const c = createCommandCard({ doc, card: { ...CARD, warning: 'This pipeline is still running…' }, onStop: () => {} });
  assert.equal(c.el.querySelector('.ask-cmd-warning').hidden, false);
});

test('the output: folded behind a chevron toggle with its line count; no output, no toggle; a long command is clamped with Show all', () => {
  const doc = dom(); const toggles = [];
  const long = `npm test -- ${'--grep very-long-pattern '.repeat(12)}`.trim();
  const c = createCommandCard({ doc, card: { ...CARD, command: long }, onStop: () => {}, onToggle: (open) => toggles.push(open) });
  doc.body.appendChild(c.el);
  assert.equal(c.el.querySelector('.ask-cmd-line').textContent, `$ ${long}`, 'the whole command line');
  const more = c.el.querySelector('button.ask-cmd-more');
  assert.equal(more.hidden, false, 'a long command offers Show all');
  more.click();
  assert.ok(c.el.querySelector('.ask-cmd-line').classList.contains('is-open'));
  assert.equal(more.getAttribute('aria-expanded'), 'true');
  assert.equal(more.textContent, 'Show less');
  more.click();
  assert.equal(c.el.querySelector('.ask-cmd-line').classList.contains('is-open'), false);
  assert.equal(more.textContent, 'Show all');
  assert.equal(longCommand('a\nb\nc'), false);
  assert.equal(longCommand('a\nb\nc\nd'), true, 'more than 3 lines');
  assert.equal(longCommand('x'.repeat(181)), true);
  const toggle = c.el.querySelector('button.ask-cmd-toggle');
  const out = c.el.querySelector('.ask-cmd-out');
  c.update({ status: 'running', tail: '', exitCode: null });
  assert.equal(toggle.hidden, true, 'no output: no toggle');
  assert.equal(out.hidden, true);
  c.update({ status: 'running', tail: 'PASS a\nPASS b\nPASS c\n', exitCode: null });
  assert.equal(toggle.hidden, false);
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.ok(toggle.querySelector('.ask-cmd-chev'), 'a chevron');
  assert.equal(toggle.textContent.replace(/›/g, '').trim(), 'Output · 3 lines');
  assert.equal(out.hidden, true, 'folded by default');
  toggle.click();
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(out.hidden, false, 'the toggle shows the tail');
  assert.deepEqual(toggles, [true]);
  c.update({ status: 'done', tail: 'PASS a\nPASS b\nPASS c\nPASS d', exitCode: 0, truncated: true });
  assert.equal(out.hidden, false, 'an update keeps it open');
  assert.equal(toggle.textContent.replace(/›/g, '').trim(), 'Output · last 4 lines', 'a clipped tail says so');
  toggle.click();
  assert.equal(out.hidden, true);
  assert.deepEqual(toggles, [true, false]);
  c.update({ status: 'done', tail: 'PASS a', exitCode: 0 });
  assert.equal(out.hidden, true, 'an update keeps it folded');
  assert.equal(toggle.textContent.replace(/›/g, '').trim(), 'Output · 1 line');
});

test('the toggle folds the output inside the host\'s keepInPlace(control, change), so the host can hold the toggle still', () => {
  const doc = dom(); const calls = [];
  let out = null;
  const keepInPlace = (control, change) => { const before = out.hidden; change(); calls.push([control, before, out.hidden]); };
  const c = createCommandCard({ doc, card: CARD, onStop: () => {}, keepInPlace });
  doc.body.appendChild(c.el);
  out = c.el.querySelector('.ask-cmd-out');
  const toggle = c.el.querySelector('.ask-cmd-toggle');
  c.update({ status: 'running', tail: 'PASS a', exitCode: null });
  assert.deepEqual(calls, [], 'an update is not a user toggle');
  toggle.click();
  toggle.click();
  assert.deepEqual(calls, [[toggle, true, false], [toggle, false, true]], 'each click opens or folds inside the hook');
});

test('a card built open (the panel remembers the toggle) shows its output, and an open live card follows the tail', () => {
  const doc = dom();
  const c = createCommandCard({ doc, card: CARD, onStop: () => {}, expanded: true });
  doc.body.appendChild(c.el);
  const out = c.el.querySelector('.ask-cmd-out');
  Object.defineProperty(out, 'scrollHeight', { value: 900, configurable: true });
  c.update({ status: 'running', tail: 'line 1\nline 2', exitCode: null });
  assert.equal(c.el.querySelector('.ask-cmd-toggle').getAttribute('aria-expanded'), 'true');
  assert.equal(out.hidden, false);
  assert.equal(out.scrollTop, 900, 'scrolled to the bottom');
});

test('the folder label shows the command\'s terminal tab (onShow with the session)', () => {
  const doc = dom(); const shown = [];
  const c = createCommandCard({ doc, card: CARD, onStop: () => {}, onShow: (sid) => shown.push(sid) });
  const folder = c.el.querySelector('.ask-cmd-folder');
  assert.equal(folder.tagName, 'BUTTON');
  assert.equal(folder.textContent, 'demo · main');
  assert.match(folder.title, /terminal/i);
  folder.click();
  assert.deepEqual(shown, ['t-0000000001']);
});
