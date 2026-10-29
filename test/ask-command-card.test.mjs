// test/ask-command-card.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createCommandCard, createCommandGroup, commandTokens, commandSpans, longCommand } from '../ui/public/ask-command-card.mjs';

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

test('summary mode: a click opens the command box (copy icon), the folder chip and the output panel', () => {
  const doc = dom(); const toggles = [];
  const c = createCommandCard({ doc, card: SUM, onStop: () => {}, summarise: true, onRowToggle: (o) => toggles.push(o) });
  c.update({ status: 'done', exitCode: 0, durationMs: 1400, tail: 'a\nb\nc\n' });
  c.el.querySelector('.ask-cmd-row-btn').click();
  assert.equal(c.el.querySelector('.ask-cmd-detail').hidden, false);
  assert.equal(c.el.querySelector('.ask-cmd-row-btn').getAttribute('aria-expanded'), 'true');
  const copy = c.el.querySelector('.ask-cmd-cmd .ask-cmd-copy');
  assert.equal(copy.title, 'Copy command');
  assert.ok(copy.classList.contains('btn-icon'), 'an icon button');
  assert.equal(copy.querySelector('.ask-cmd-copy-text'), null, 'no words in the command copy');
  assert.equal(c.el.querySelector('.ask-cmd-code').textContent, `$ ${SUM.command}`);
  assert.equal(c.el.querySelector('.ask-cmd-dir').textContent, 'demo · main');
  assert.equal(c.el.querySelector('.ask-cmd-outlabel').textContent, 'Output · 3 lines');
  assert.equal(c.el.querySelector('.ask-cmd-outbox').hidden, false);
  assert.equal(c.el.querySelector('.ask-cmd-toggle'), null, 'no inner Output toggle');
  assert.deepEqual(toggles, [true]);
});

test('summary mode: Show in terminal is the one action that shows the tab; the folder is a chip', () => {
  const doc = dom(); const shown = [];
  const c = createCommandCard({ doc, card: SUM, onStop: () => {}, onShow: (sid) => shown.push(sid), summarise: true });
  assert.equal(c.el.querySelector('.ask-cmd-dir').tagName, 'SPAN');
  assert.equal(c.el.querySelector('.ask-cmd-folder'), null);
  const show = c.el.querySelector('.ask-cmd-show');
  assert.equal(show.textContent, 'Show in terminal');
  show.click();
  assert.deepEqual(shown, ['t-0000000001']);
});

test('Show in terminal on a closed shell says so and stops offering it; a shown tab leaves it as it was', async () => {
  const doc = dom();
  const live = createCommandCard({ doc, card: SUM, onStop: () => {}, onShow: async () => true, summarise: true });
  const liveBtn = live.el.querySelector('.ask-cmd-show');
  liveBtn.click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(liveBtn.disabled, false);
  assert.equal(liveBtn.textContent, 'Show in terminal');
  const shown = [];
  const gone = createCommandCard({ doc, card: SUM, onStop: () => {}, onShow: async (sid) => { shown.push(sid); return false; }, summarise: true });
  const show = gone.el.querySelector('.ask-cmd-show');
  show.click();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(shown, ['t-0000000001']);
  assert.equal(show.disabled, true);
  assert.equal(show.textContent, 'Shell closed');
  assert.match(show.title, /shell has closed/);
});

test('the full card\'s folder on a closed shell is disabled, with the reason as its tooltip', async () => {
  const doc = dom();
  const c = createCommandCard({ doc, card: CARD, onStop: () => {}, onShow: async () => false });
  const folder = c.el.querySelector('.ask-cmd-folder');
  folder.click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(folder.disabled, true);
  assert.equal(folder.textContent, 'demo · main', 'the folder still names where it ran');
  assert.match(folder.title, /shell has closed/);
});

test('summary mode: no summary shows the raw command in mono', () => {
  const doc = dom();
  const c = createCommandCard({ doc, card: { ...CARD, summary: null }, onStop: () => {}, summarise: true });
  c.update({ status: 'done', exitCode: 0, durationMs: 1000, tail: '' });
  const s = c.el.querySelector('.ask-cmd-sum');
  assert.equal(s.textContent, 'npm test');
  assert.ok(s.classList.contains('is-raw'));
});

test('setSummary: a raw row takes the generated line in place; a chat-given summary is never replaced', () => {
  const doc = dom();
  const c = createCommandCard({ doc, card: { ...CARD, summary: null }, onStop: () => {}, summarise: true });
  c.update({ status: 'done', exitCode: 0, durationMs: 400, tail: '' });
  const s = c.el.querySelector('.ask-cmd-sum');
  c.setSummary('Running the tests');
  assert.equal(c.el.querySelector('.ask-cmd-sum'), s, 'same element');
  assert.equal(s.textContent, 'Running the tests');
  assert.ok(!s.classList.contains('is-raw'));
  assert.equal(s.title, 'npm test', 'the hover still names the exact command');
  assert.match(c.el.querySelector('.ask-cmd-row-btn').getAttribute('aria-label'), /Running the tests/);
  const given = createCommandCard({ doc, card: SUM, onStop: () => {}, summarise: true });
  given.setSummary('Something else');
  assert.equal(given.el.querySelector('.ask-cmd-sum').textContent, SUM.summary);
});

test('summary mode: a failure stays folded, red ! dot, "exit 1 · 38s"; a click shows its output', () => {
  const doc = dom(); const rows = []; const folds = [];
  const c = createCommandCard({ doc, card: SUM, onStop: () => {}, summarise: true, onRowToggle: (o) => rows.push(o), onToggle: (o) => folds.push(o) });
  c.update({ status: 'done', exitCode: 1, durationMs: 38_000, tail: '✖ badge\nℹ fail 1' });
  const dot = c.el.querySelector('.status-dot');
  assert.ok(dot.classList.contains('is-red') && dot.classList.contains('has-sym'));
  assert.ok(c.el.querySelector('.ask-cmd-row-btn').getAttribute('aria-label').startsWith('Failed: '));
  assert.equal(c.el.querySelector('.ask-cmd-meta').textContent, 'exit 1 · 38s');
  assert.ok(c.el.classList.contains('is-failed'));
  assert.equal(c.el.querySelector('.ask-cmd-detail').hidden, true, 'a failure does not open the row');
  assert.deepEqual(rows, []);
  c.el.querySelector('.ask-cmd-row-btn').click();
  assert.equal(c.el.querySelector('.ask-cmd-detail').hidden, false);
  assert.equal(c.el.querySelector('.ask-cmd-outbox').hidden, false);
  assert.deepEqual(rows, [true]);
  assert.deepEqual(folds, [], 'the row has one fold: the full card\'s onToggle is never called');
});

test('summary mode: a failed row the person opened stays open on later frames', () => {
  const doc = dom();
  const c = createCommandCard({ doc, card: SUM, onStop: () => {}, summarise: true, rowOpen: true });
  c.update({ status: 'done', exitCode: 1, durationMs: 1000, tail: 'x' });
  assert.equal(c.el.querySelector('.ask-cmd-detail').hidden, false);
  c.update({ status: 'done', exitCode: 1, durationMs: 1000, tail: 'x\ny' });
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

test('commandTokens: first word per segment, operators, flags, quoted strings; joined they are the command', () => {
  const cmd = 'node --test a.mjs 2>&1 | tail -40 && git commit -m "fix: a | b";ls\nnpm  run x';
  const toks = commandTokens(cmd);
  assert.equal(toks.map((t) => t.s).join(''), cmd);
  assert.deepEqual(toks.filter((t) => t.t !== 'text').map((t) => [t.t, t.s]), [
    ['cmd', 'node'], ['flag', '--test'], ['op', '|'], ['cmd', 'tail'], ['flag', '-40'], ['op', '&&'], ['cmd', 'git'],
    ['flag', '-m'], ['str', '"fix: a | b"'], ['op', ';'], ['cmd', 'ls'], ['cmd', 'npm']]);
  assert.equal(commandTokens('echo "open').map((t) => t.s).join(''), 'echo "open', 'an unclosed quote runs to the end');
});

test('commandSpans: text only, never HTML', () => {
  const doc = dom();
  const code = doc.createElement('code');
  code.append(...commandSpans(doc, 'echo <img src=x onerror=alert(1)> | cat'));
  assert.equal(code.querySelector('img'), null);
  assert.equal(code.textContent, 'echo <img src=x onerror=alert(1)> | cat');
  assert.ok([...code.querySelectorAll('*')].every((n) => n.tagName === 'SPAN' && n.children.length === 0));
});

test('summary mode: opening the row shows the output directly (no inner Output toggle), pinned to the end', () => {
  const doc = dom(); doc.body.innerHTML = '';
  const c = createCommandCard({ doc, card: SUM, onStop: () => {}, summarise: true });
  doc.body.appendChild(c.el);
  c.update({ status: 'running', exitCode: null, startedAt: Date.now(), tail: 'a\n' });
  c.el.querySelector('.ask-cmd-row-btn').click();
  assert.equal(c.el.querySelector('.ask-cmd-toggle'), null);
  const out = c.el.querySelector('.ask-cmd-outbox .ask-cmd-out');
  let top = 0;
  Object.defineProperty(out, 'scrollHeight', { configurable: true, get: () => 1000 });
  Object.defineProperty(out, 'clientHeight', { configurable: true, get: () => 400 });
  Object.defineProperty(out, 'scrollTop', { configurable: true, get: () => top, set: (v) => { top = v; } });
  c.update({ status: 'running', exitCode: null, startedAt: Date.now(), tail: 'a\nb\n' });
  assert.equal(top, 1000, 'live: follows the newest line');
  top = 100; out.dispatchEvent(new doc.defaultView.Event('scroll'));
  c.update({ status: 'running', exitCode: null, startedAt: Date.now(), tail: 'a\nb\nc\n' });
  assert.equal(top, 100, 'scrolled up: the new tail does not pull the person down');
  c.destroy();
});

test('createCommandGroup: a quiet head over one body, folded while running and once passed; a click is the person\'s choice', () => {
  const doc = dom(); const choices = [];
  const g = createCommandGroup({ doc, onToggle: (o) => choices.push(o) });
  const head = g.el.querySelector('.ask-cmd-ghead');
  assert.equal(head.getAttribute('aria-controls'), g.body.id);
  g.update([{ status: 'done', exitCode: 0, durationMs: 1000 }, { status: 'running', startedAt: 0 }], { now: 2000, current: 'Run the ui tests' });
  assert.equal(head.querySelector('.ask-cmd-gwords').textContent, 'Run the ui tests · 2 commands · 3.0s');
  assert.equal(head.getAttribute('aria-expanded'), 'false');
  assert.equal(g.body.hidden, true, 'running: folded to the head line');
  const passed = [{ status: 'done', exitCode: 0, durationMs: 1000 }, { status: 'done', exitCode: 0, durationMs: 2000 }];
  g.update(passed);
  assert.equal(g.body.hidden, true);
  assert.equal(head.querySelector('.ask-cmd-gwords').textContent, 'Ran 2 commands · 3.0s');
  assert.deepEqual(choices, []);
  head.click();
  g.update(passed);
  assert.equal(g.body.hidden, false, 'the person\'s open stays');
  assert.deepEqual(choices, [true]);
});

test('createCommandGroup: a failure stays folded with a red "1 failed"; a recorded open wins', () => {
  const doc = dom(); const choices = [];
  const views = [{ status: 'done', exitCode: 0, durationMs: 1000 }, { status: 'done', exitCode: 1, durationMs: 500 }];
  const g = createCommandGroup({ doc, onToggle: (o) => choices.push(o) });
  g.update(views);
  assert.equal(g.body.hidden, true);
  assert.equal(g.el.querySelector('.ask-cmd-gfail').textContent, '1 failed');
  assert.deepEqual(choices, [], 'no auto-open is recorded');
  const again = createCommandGroup({ doc, choice: true });
  again.update(views);
  assert.equal(again.body.hidden, false, 'rebuilt with the recorded open');
});

test('createCommandGroup: Stop on the head while a member runs and the group is folded; opened, the row\'s Stop takes over', () => {
  const doc = dom(); let stops = 0;
  const g = createCommandGroup({ doc, onStop: () => { stops += 1; } });
  const stop = g.el.querySelector('.ask-cmd-gtop > .ask-cmd-stop');
  const running = [{ status: 'done', exitCode: 0, durationMs: 100 }, { status: 'running', startedAt: 0 }];
  g.update(running, { now: 1000 });
  assert.equal(stop.hidden, false);
  stop.click();
  assert.equal(stops, 1);
  assert.equal(stop.disabled, true, 'one click');
  assert.equal(g.body.hidden, true, 'Stop never opens the group');
  g.el.querySelector('.ask-cmd-ghead').click();
  assert.equal(stop.hidden, true, 'open: the running row shows its own Stop');
  g.el.querySelector('.ask-cmd-ghead').click();
  g.update([{ status: 'done', exitCode: 0, durationMs: 100 }, { status: 'stopped', durationMs: 900 }]);
  assert.equal(stop.hidden, true);
  assert.equal(stop.disabled, false);
});
