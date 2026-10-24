// test/ask-command-card.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createCommandCard } from '../ui/public/ask-command-card.mjs';

const dom = () => new JSDOM('<!doctype html><html><body></body></html>').window.document;
const CARD = { type: 'command', blockId: 't-0000000001:1', sessionId: 't-0000000001', seq: 1, command: 'npm test', folder: 'demo · main', warning: null };

test('a running command: the command, a live tail, a Stop button', () => {
  const doc = dom(); const stops = [];
  const c = createCommandCard({ doc, card: CARD, onStop: (sid) => stops.push(sid) });
  doc.body.appendChild(c.el);
  c.update({ status: 'running', tail: 'PASS a\nPASS b\n', exitCode: null });
  assert.equal(c.el.querySelector('.ask-cmd-line').textContent, '$ npm test');
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

test('the output: folded behind a chevron toggle with its line count; no output, no toggle; a long command is never clamped', () => {
  const doc = dom(); const toggles = [];
  const long = `npm test -- ${'--grep very-long-pattern '.repeat(12)}`.trim();
  const c = createCommandCard({ doc, card: { ...CARD, command: long }, onStop: () => {}, onToggle: (open) => toggles.push(open) });
  doc.body.appendChild(c.el);
  assert.equal(c.el.querySelector('.ask-cmd-line').textContent, `$ ${long}`, 'the whole command line');
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

// Command summaries (#911): the one-line row mode.
const SUM = { ...CARD, summary: 'Syncing the latest code from dev', command: 'git checkout dev && git pull --ff-only origin dev' };

test('summary mode: one row, green dot and the time after exit 0; no kicker, no exit chip (#911)', () => {
  const doc = dom();
  const c = createCommandCard({ doc, card: SUM, onStop: () => {}, summarise: true });
  c.update({ status: 'done', exitCode: 0, durationMs: 1400, tail: 'Already up to date.' });
  assert.ok(c.el.classList.contains('is-sum'));
  assert.equal(c.el.querySelector('.ask-cmd-sum').textContent, 'Syncing the latest code from dev');
  assert.equal(c.el.querySelector('.ask-cmd-sum').title, SUM.command);
  assert.ok(c.el.querySelector('.status-dot').classList.contains('is-green'));
  assert.equal(c.el.querySelector('.ask-cmd-meta').textContent, '1.4s');
  assert.equal(c.el.querySelector('.ask-cmd-kicker'), null);
  assert.equal(c.el.querySelector('.ask-cmd-pill'), null);
  assert.equal(c.el.querySelector('.ask-cmd-detail').hidden, true);
  assert.equal(c.el.querySelector('.ask-cmd-row-btn').getAttribute('aria-label'), 'Done: Syncing the latest code from dev, 1.4s');
  assert.equal(c.el.querySelector('.status-dot').getAttribute('aria-hidden'), 'true');
});

test('summary mode: a click opens the command (copy button), the folder and the output toggle', () => {
  const doc = dom(); const toggles = [];
  const c = createCommandCard({ doc, card: SUM, onStop: () => {}, summarise: true, onRowToggle: (o) => toggles.push(o) });
  c.update({ status: 'done', exitCode: 0, durationMs: 1400, tail: 'a\nb\nc\n' });
  c.el.querySelector('.ask-cmd-row-btn').click();
  assert.equal(c.el.querySelector('.ask-cmd-detail').hidden, false);
  assert.equal(c.el.querySelector('.ask-cmd-row-btn').getAttribute('aria-expanded'), 'true');
  assert.equal(c.el.querySelector('.ask-cmd-copy .ask-cmd-copy-text').textContent, SUM.command);
  assert.equal(c.el.querySelector('.ask-cmd-copy').title, 'Copy command');
  assert.equal(c.el.querySelector('.ask-cmd-folder').textContent, 'demo · main');
  assert.equal(c.el.querySelector('.ask-cmd-toggle-label').textContent, 'Output · 3 lines');
  assert.deepEqual(toggles, [true]);
});

test('summary mode: no summary shows the raw command in mono', () => {
  const doc = dom();
  const c = createCommandCard({ doc, card: { ...CARD, summary: null }, onStop: () => {}, summarise: true });
  c.update({ status: 'done', exitCode: 0, durationMs: 1000, tail: '' });
  const s = c.el.querySelector('.ask-cmd-sum');
  assert.equal(s.textContent, 'npm test');
  assert.ok(s.classList.contains('is-raw'));
});

test('summary mode: a failure opens itself with its output, red ! dot, "exit 1 · 38s"', () => {
  const doc = dom(); const rows = []; const folds = [];
  const c = createCommandCard({ doc, card: SUM, onStop: () => {}, summarise: true, onRowToggle: (o) => rows.push(o), onToggle: (o) => folds.push(o) });
  c.update({ status: 'done', exitCode: 1, durationMs: 38_000, tail: '✖ badge\nℹ fail 1' });
  const dot = c.el.querySelector('.status-dot');
  assert.ok(dot.classList.contains('is-red') && dot.classList.contains('has-sym'));
  assert.ok(c.el.querySelector('.ask-cmd-row-btn').getAttribute('aria-label').startsWith('Failed: '));
  assert.equal(c.el.querySelector('.ask-cmd-meta').textContent, 'exit 1 · 38s');
  assert.equal(c.el.querySelector('.ask-cmd-detail').hidden, false);
  assert.equal(c.el.querySelector('.ask-cmd-out').hidden, false);
  assert.deepEqual([rows, folds], [[true], [true]], 'the auto-open is reported once, so the panel keeps it');
});

test('summary mode: a failure opens its output once; a fold the person closed stays closed on later frames', () => {
  const doc = dom();
  const c = createCommandCard({ doc, card: SUM, onStop: () => {}, summarise: true });
  c.update({ status: 'done', exitCode: 1, durationMs: 1000, tail: 'x' });
  c.el.querySelector('.ask-cmd-toggle').click();
  assert.equal(c.el.querySelector('.ask-cmd-out').hidden, true);
  c.update({ status: 'done', exitCode: 1, durationMs: 1000, tail: 'x\ny' });
  assert.equal(c.el.querySelector('.ask-cmd-out').hidden, true);
  assert.equal(c.el.querySelector('.ask-cmd-detail').hidden, false);
});

test('summary mode: a person who closed a failed row keeps it closed (rowOpen false)', () => {
  const doc = dom();
  const c = createCommandCard({ doc, card: SUM, onStop: () => {}, summarise: true, rowOpen: false });
  c.update({ status: 'done', exitCode: 1, durationMs: 1000, tail: 'x' });
  assert.equal(c.el.querySelector('.ask-cmd-detail').hidden, true);
});

test('summary mode: running pulses peach and keeps Stop; stopped is dark grey', () => {
  const doc = dom(); const stops = [];
  const c = createCommandCard({ doc, card: SUM, onStop: (sid) => stops.push(sid), summarise: true });
  c.update({ status: 'running', exitCode: null, durationMs: null, startedAt: Date.now() - 11_000, tail: '' });
  const dot = c.el.querySelector('.status-dot');
  assert.ok(dot.classList.contains('is-peach') && dot.classList.contains('is-pulse'));
  const stop = c.el.querySelector('.ask-cmd-stop');
  assert.equal(stop.hidden, false);
  stop.click();
  assert.deepEqual(stops, ['t-0000000001']);
  assert.equal(c.el.querySelector('.ask-cmd-detail').hidden, true, 'Stop never opens the row');
  c.update({ status: 'stopped', exitCode: 130, durationMs: 4000, tail: '' });
  assert.ok(c.el.querySelector('.status-dot').classList.contains('is-dark-grey'));
  assert.equal(c.el.querySelector('.ask-cmd-meta').textContent, 'stopped · 4.0s');
});

test('summary mode: a running row ticks each second with no frame; the ticker stops when it ends', () => {
  const doc = dom(); const win = doc.defaultView;
  const ticks = []; const cleared = [];
  win.setInterval = (fn, ms) => { ticks.push({ fn, ms }); return ticks.length; };
  win.clearInterval = (id) => cleared.push(id);
  let now = 1_000_000;
  const c = createCommandCard({ doc, card: SUM, onStop: () => {}, summarise: true, now: () => now });
  c.update({ status: 'running', exitCode: null, durationMs: null, startedAt: now - 2000, tail: '' });
  c.update({ status: 'running', exitCode: null, durationMs: null, startedAt: now - 2000, tail: 'a' });
  assert.equal(ticks.length, 1, 'one ticker per card');
  assert.equal(ticks[0].ms, 1000);
  assert.equal(c.el.querySelector('.ask-cmd-meta').textContent, '2.0s');
  now += 3000; ticks[0].fn();
  assert.equal(c.el.querySelector('.ask-cmd-meta').textContent, '5.0s');
  c.update({ status: 'done', exitCode: 0, durationMs: 5100, tail: '' });
  assert.deepEqual(cleared, [1]);
});

test('summary mode: each tick of a running row calls onTick, so the panel can repaint its group head', () => {
  const doc = dom(); const win = doc.defaultView;
  const ticks = [];
  win.setInterval = (fn) => { ticks.push(fn); return ticks.length; };
  win.clearInterval = () => {};
  let calls = 0;
  const c = createCommandCard({ doc, card: SUM, onStop: () => {}, summarise: true, onTick: () => { calls += 1; } });
  c.update({ status: 'running', exitCode: null, durationMs: null, startedAt: Date.now(), tail: '' });
  ticks[0](); ticks[0]();
  assert.equal(calls, 2);
});

test('summary mode: the warning shows under a closed row', () => {
  const doc = dom();
  const c = createCommandCard({ doc, card: { ...SUM, warning: 'This pipeline is still running…' }, onStop: () => {}, summarise: true });
  c.update({ status: 'done', exitCode: 0, durationMs: 300, tail: '' });
  assert.equal(c.el.querySelector('.ask-cmd-detail').hidden, true);
  assert.equal(c.el.querySelector('.ask-cmd-warning').hidden, false);
});

test('summary mode: setGroup marks the role and paints the head on the first row', () => {
  const doc = dom();
  const c = createCommandCard({ doc, card: SUM, onStop: () => {}, summarise: true });
  c.setGroup({ role: 'first', head: '3 commands · 6.1s' });
  assert.ok(c.el.classList.contains('in-group') && c.el.classList.contains('is-g-first'));
  assert.equal(c.el.querySelector('.ask-cmd-ghead').textContent, '3 commands · 6.1s');
  c.setGroup(null);
  assert.ok(!c.el.classList.contains('in-group'));
  assert.equal(c.el.querySelector('.ask-cmd-ghead').hidden, true);
});
