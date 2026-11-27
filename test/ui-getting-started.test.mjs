// test/ui-getting-started.test.mjs
// ui/public/getting-started.mjs — the tile shelf, the sidebar pill and the
// welcome bindings, driven in jsdom with no app.js boot (pure DOM module).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import {
  GETTING_STARTED_STEPS, renderGettingStarted, renderGettingStartedPill, bindWelcome, doneCount, allStepsDone,
  teamStepsVisible, laterSteps, runnerProgress, gsPillText,
} from '../ui/public/getting-started.mjs';
import { checkRows } from './helpers/rows.mjs';
import { backdropClick, dragOut } from './helpers/popups.mjs';

const dom = () => new JSDOM('<!doctype html><body><div id="host"></div><div id="pill"></div></body>', { url: 'http://localhost/' });
const status = (done = [], extra = {}) => ({
  steps: Object.fromEntries(GETTING_STARTED_STEPS.map((s) => [s.id, done.includes(s.id)])),
  hidden: false, welcomeSeen: false, setupFinished: true, ...extra,
});
const click = (win, node) => node.dispatchEvent(new win.Event('click', { bubbles: true, cancelable: true }));

test('the shelf (nine tiles in order, progress, Hide, done tiles re-summon) and the pill (count, opens, gone when hidden/complete)', async () => {
  await checkRows([
    { name: 'the shelf: nine tiles in arc order, progress, Hide; done tiles marked and still clickable', run: () => {
      const { window } = dom();
      const host = window.document.getElementById('host');
      const stepped = [];
      let hid = 0;
      renderGettingStarted(host, status(['claude', 'project']), { onStep: (id) => stepped.push(id), onHide: () => hid++ });
      assert.equal(host.hidden, false);
      const card = host.querySelector('section.card.gs-card');
      assert.ok(card, 'a card, on the app\'s own .card');
      assert.equal(card.getAttribute('role'), 'complementary');
      assert.equal(card.querySelector('.gs-head h2').textContent, 'Your progress');
      assert.equal(card.querySelector('.gs-progress').textContent, '2 of 9');
      const tiles = [...card.querySelectorAll('.gs-tile')];
      assert.equal(tiles.length, 9);
      assert.deepEqual(tiles.map((t) => t.dataset.step), GETTING_STARTED_STEPS.map((s) => s.id));
      assert.deepEqual(tiles.map((t) => t.classList.contains('done')), [true, true, false, false, false, false, false, false, false]);
      for (const t of tiles) {
        assert.equal(t.tagName, 'BUTTON');
        assert.equal(t.getAttribute('type'), 'button');
        assert.ok(t.querySelector('.gs-mark'), 'a check mark');
        assert.ok(t.querySelector('.gs-vig svg'), 'a vignette');
        assert.ok(t.querySelector('.gs-label').textContent.length > 8, 'a label');
      }
      // A finished vignette is painted still; an unfinished one plays.
      assert.ok(tiles[0].querySelector('.gs-vig svg').classList.contains('static'));
      assert.ok(tiles[2].querySelector('.gs-vig svg').classList.contains('play'));
      // Done tiles reveal faster than unfinished ones: strictly increasing delays.
      const delays = tiles.map((t) => parseFloat(t.style.getPropertyValue('--tile-delay')));
      for (let i = 1; i < delays.length; i++) assert.ok(delays[i] > delays[i - 1], `tile ${i} arrives after tile ${i - 1}`);
      assert.ok(delays[2] - delays[1] < delays[3] - delays[2], 'a done tile holds the sequence for less than an unfinished one');

      click(window, tiles[0]);
      click(window, tiles[4]);
      assert.deepEqual(stepped, ['claude', 'realRun'], 'done or not, a tile re-summons its guide');
      click(window, card.querySelector('.gs-hide'));
      assert.equal(hid, 1);
    } },
    { name: 'the pill: count badge, opens on click, gone when hidden or complete', run: () => {
      const { window } = dom();
      const pill = window.document.getElementById('pill');
      let opened = 0;
      renderGettingStartedPill(pill, status(['claude', 'project', 'run']), () => opened++);
      assert.equal(pill.hidden, false);
      const btn = pill.querySelector('button.gs-pill');
      assert.ok(btn);
      assert.equal(btn.getAttribute('type'), 'button');
      assert.equal(btn.hasAttribute('data-nav'), false, 'not a nav route: app.js binds .nav button[data-nav] only');
      assert.equal(btn.querySelector('.nav-count').textContent, '3/9');
      assert.match(btn.getAttribute('aria-label'), /3 of 9/);
      click(window, btn);
      assert.equal(opened, 1);
      renderGettingStartedPill(pill, status([], { hidden: true }), () => opened++);
      assert.equal(pill.hidden, true);
      assert.equal(pill.children.length, 0);
      renderGettingStartedPill(pill, status(GETTING_STARTED_STEPS.map((s) => s.id)), () => opened++);
      assert.equal(pill.hidden, true, 'nothing left to nag about');
    } },
  ]);
});

test('the shelf paints nothing when hidden/foreign, replaces never stacks; all nine done reads All set and the count helpers agree', async () => {
  await checkRows([
    { name: 'the shelf paints nothing when hidden or when the status is not ours', run: () => {
      const { window } = dom();
      const host = window.document.getElementById('host');
      renderGettingStarted(host, status([], { hidden: true }));
      assert.equal(host.children.length, 0);
      assert.equal(host.hidden, true);
      renderGettingStarted(host, { pipelines: 0, projects: 0 });   // the boot tests' generic stub
      assert.equal(host.children.length, 0);
      renderGettingStarted(host, null);
      assert.equal(host.children.length, 0);
      renderGettingStarted(host, status(['claude']));
      assert.equal(host.hidden, false);
      assert.equal(host.children.length, 1, 'painting again replaces, never stacks');
      renderGettingStarted(host, status(['claude']));
      assert.equal(host.children.length, 1);
    } },
    { name: 'all nine done reads "All set" and the count helpers agree', run: () => {
      const all = status(GETTING_STARTED_STEPS.map((s) => s.id));
      assert.equal(doneCount(all), 9);
      assert.equal(allStepsDone(all), true);
      assert.equal(allStepsDone(status(['run'])), false);
      const { window } = dom();
      const host = window.document.getElementById('host');
      renderGettingStarted(host, all);
      assert.equal(host.querySelector('.gs-head h2').textContent, 'All set');
      assert.equal(host.querySelectorAll('.gs-tile.done').length, 9);
    } },
  ]);
});

test('the shelf shows one level line when worcaLevel is passed; it links to the level view and goes with the shelf', async () => {
  const curious = { top: false, level: { index: 1, name: 'Curious', avatar: '/assets/worca-levels/curious.svg' },
    nextLevel: { index: 2, key: 'runner', name: 'Runner' },
    ladder: [{ index: 1, avatar: '/assets/worca-levels/curious.svg' }, { index: 2, avatar: '/assets/worca-levels/runner.svg' }] };
  const hooked = { top: false, level: { index: 3, name: 'Hooked', avatar: '/assets/worca-levels/hooked.svg' },
    nextLevel: { index: 4, name: 'Council', avatar: '/assets/worca-levels/council.svg' } };
  const top = { top: true, level: { index: 5, name: 'Worcaholic', avatar: '/assets/worca-levels/worcaholic.svg' }, nextLevel: null };
  const text = (n) => n.textContent.replace(/\s+/g, ' ').trim();
  await checkRows([
    { name: 'one level line: exactly one, inside the shelf, still nine tiles and the same count', run: () => {
      const { window } = dom();
      const host = window.document.getElementById('host');
      renderGettingStarted(host, status(['claude']), { worcaLevel: curious });
      const lines = host.querySelectorAll('.gs-level-line');
      assert.equal(lines.length, 1);
      assert.equal(lines[0].tagName, 'P');
      assert.ok(host.querySelector('.gs-card').contains(lines[0]), 'inside the shelf');
      assert.equal(GETTING_STARTED_STEPS.length, 9);
      assert.equal(host.querySelectorAll('.gs-tile').length, 9);
      assert.equal(host.querySelector('.gs-progress').textContent, '1 of 9');
    } },
    { name: 'Curious copy points at the next level and shows its art at 16px', run: () => {
      const { window } = dom();
      const host = window.document.getElementById('host');
      renderGettingStarted(host, status(['claude']), { worcaLevel: curious });
      const line = host.querySelector('.gs-level-line');
      assert.equal(text(line), 'Finishing these moves you toward Runner, your next level. See levels');
      const img = line.querySelector('img');
      assert.equal(img.getAttribute('src'), '/assets/worca-levels/runner.svg');
      assert.equal(img.getAttribute('width'), '16');
      assert.equal(img.getAttribute('height'), '16');
    } },
    { name: 'Runner-or-higher copy names the current level and shows its own art; the top level reads the same', run: () => {
      const { window } = dom();
      const host = window.document.getElementById('host');
      renderGettingStarted(host, status(['claude']), { worcaLevel: hooked });
      let line = host.querySelector('.gs-level-line');
      assert.equal(text(line), 'You are Hooked, level 3 of 5. See levels');
      assert.equal(line.querySelector('img').getAttribute('src'), hooked.level.avatar);
      renderGettingStarted(host, status(['claude']), { worcaLevel: top });
      line = host.querySelector('.gs-level-line');
      assert.equal(text(line), 'You are Worcaholic, level 5 of 5. See levels');
    } },
    { name: 'the link is a.gs-level-link to #profile/level', run: () => {
      const { window } = dom();
      const host = window.document.getElementById('host');
      renderGettingStarted(host, status(['claude']), { worcaLevel: hooked });
      const a = host.querySelector('.gs-level-line a.gs-level-link');
      assert.equal(a.getAttribute('href'), '#profile/level');
      assert.equal(a.textContent, 'See levels');
    } },
    { name: 'without a usable view: no line, and re-rendering never stacks it', run: () => {
      const { window } = dom();
      const host = window.document.getElementById('host');
      renderGettingStarted(host, status(['claude']));
      assert.equal(host.querySelector('.gs-level-line'), null);
      renderGettingStarted(host, status(['claude']), { worcaLevel: null });
      assert.equal(host.querySelector('.gs-level-line'), null);
      renderGettingStarted(host, status(['claude']), { worcaLevel: {} });
      assert.equal(host.querySelector('.gs-level-line'), null);
      renderGettingStarted(host, status(['claude']), { worcaLevel: curious });
      renderGettingStarted(host, status(['claude']), { worcaLevel: curious });
      assert.equal(host.querySelectorAll('.gs-level-line').length, 1);
    } },
    { name: 'a dismissed shelf hides the line too', run: () => {
      const { window } = dom();
      const host = window.document.getElementById('host');
      renderGettingStarted(host, status([], { hidden: true }), { worcaLevel: curious });
      assert.equal(host.hidden, true);
      assert.equal(host.querySelector('.gs-level-line'), null);
    } },
  ]);
});

test('welcome bindings: doors hand over their step, Skip / backdrop / Esc skip', () => {
  const { window } = dom();
  const doc = window.document;
  doc.body.innerHTML = `
    <div id="welcome-modal" class="viewer-modal">
      <div class="card"><button type="button" data-door="project">a</button><button type="button" data-door="run">b</button>
      <button type="button" class="ob-skip">Skip</button></div>
    </div>`;
  const modal = doc.getElementById('welcome-modal');
  const doors = []; let skips = 0;
  const unbind = bindWelcome(modal, { win: window, onDoor: (d) => doors.push(d), onSkip: () => skips++ });
  click(window, modal.querySelector('[data-door="run"]'));
  assert.deepEqual(doors, ['run']);
  click(window, modal.querySelector('.ob-skip'));
  backdropClick(window, modal);                           // press and release on the backdrop
  click(window, modal.querySelector('.card'));            // the card is not the backdrop
  dragOut(window, modal.querySelector('.card'), modal);   // a press inside released on the backdrop is not one
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(skips, 3);
  unbind();
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(skips, 3, 'unbound');
});

test('welcome bindings: a second bind after an unbind leaves each door with one listener (A6)', () => {
  const { window } = dom();
  const doc = window.document;
  doc.body.innerHTML = `
    <div id="welcome-modal" class="viewer-modal">
      <div class="card"><button type="button" data-door="project">a</button><button type="button" class="ob-skip">Skip</button></div>
    </div>`;
  const modal = doc.getElementById('welcome-modal');
  const doors = []; let skips = 0;
  const h = { onDoor: (d) => doors.push(d), onSkip: () => skips++ };
  bindWelcome(modal, h)();
  const unbind = bindWelcome(modal, h);
  click(window, modal.querySelector('[data-door="project"]'));
  click(window, modal.querySelector('.ob-skip'));
  assert.deepEqual(doors, ['project'], 'one call per door click');
  assert.equal(skips, 1);
  unbind();
  click(window, modal.querySelector('[data-door="project"]'));
  assert.deepEqual(doors, ['project'], 'unbound doors are silent');
});

/* ------------------------------------------------- step 0, sections, pill, team visibility */
const view = (index, realRuns = 0) => ({
  top: false, level: { index, name: ['', 'Curious', 'Runner', 'Hooked', 'Council', 'Worcaholic'][index] },
  nextLevel: null, runner: { realRuns, of: 3, stepsDone: 0, stepsOf: 6 },
});
const textOf = (n) => n.textContent.replace(/\s+/g, ' ').trim();

test('teamStepsVisible matrix: pre-Runner expert-only; Runner+team all modes; Runner+solo none', () => {
  for (const mode of ['simple', 'advanced', 'expert']) {
    for (const levelIndex of [1, null, undefined]) {
      for (const onTeam of [true, false]) {
        assert.equal(teamStepsVisible({ levelIndex, mode, onTeam }), mode === 'expert', `pre-Runner ${levelIndex} ${mode}`);
      }
    }
    for (const levelIndex of [2, 3, 5]) {
      assert.equal(teamStepsVisible({ levelIndex, mode, onTeam: true }), true, `Runner+ team ${mode}`);
      assert.equal(teamStepsVisible({ levelIndex, mode, onTeam: false }), false, `Runner+ solo ${mode}`);
    }
  }
});

test('laterSteps: the workspace step always; team steps by the matrix, onTeam from either team step', () => {
  const ids = (st, o) => laterSteps(st, o).map((s) => s.id);
  assert.deepEqual(ids(status(), { levelIndex: 1, mode: 'simple' }), ['workspace']);
  assert.deepEqual(ids(status(), { levelIndex: 1, mode: 'expert' }), ['workspace', 'teamMetrics', 'teamPolicy']);
  assert.deepEqual(ids(status(), { levelIndex: 3, mode: 'expert' }), ['workspace']);
  assert.deepEqual(ids(status(['teamPolicy']), { levelIndex: 3, mode: 'simple' }), ['workspace', 'teamMetrics', 'teamPolicy']);
  assert.ok(laterSteps(status(), { levelIndex: 1, mode: 'expert' }).every((s) => s.helps === 'hooked'));
});

test('GETTING_STARTED_STEPS: entries 7-9 help Hooked, the first label is Connect a model', () => {
  assert.equal(GETTING_STARTED_STEPS[0].label, 'Connect a model');
  assert.deepEqual(GETTING_STARTED_STEPS.filter((s) => s.helps === 'hooked').map((s) => s.id), ['workspace', 'teamMetrics', 'teamPolicy']);
});

test('runnerProgress and the pill text: Runner · 4 of 7, Finish setup first, nothing at Runner+', () => {
  const four = status(['claude', 'project', 'run', 'ask']);
  assert.deepEqual(runnerProgress(four, view(1, 0)), { done: 4, of: 7 });
  assert.deepEqual(runnerProgress(four, view(1, 3)), { done: 5, of: 7 });
  assert.deepEqual(runnerProgress(status(['workspace', 'teamPolicy']), view(1, 2)), { done: 0, of: 7 }, 'only steps 1-6 count');
  assert.equal(gsPillText(four, view(1, 0)), 'Runner · 4 of 7');
  assert.equal(gsPillText(status([], { setupFinished: false }), view(1)), 'Finish setup');
  assert.equal(gsPillText(status([], { setupFinished: false }), view(3)), 'Finish setup');
  assert.equal(gsPillText(four, view(2)), null);
  assert.equal(gsPillText(four, view(4)), null);
  assert.equal(gsPillText(four, null), null, 'unknown view: the plain pill');
});

test('the pill paints gsPillText and drops the count badge; without one it stays "Getting started" with its count', () => {
  const { window } = dom();
  const pill = window.document.getElementById('pill');
  renderGettingStartedPill(pill, status(['claude', 'project', 'run', 'ask']), () => {}, view(1));
  assert.equal(textOf(pill), 'Runner · 4 of 7');
  assert.match(pill.querySelector('button').getAttribute('aria-label'), /Runner · 4 of 7/);
  renderGettingStartedPill(pill, status([], { setupFinished: false }), () => {}, view(1));
  assert.equal(textOf(pill), 'Finish setup');
  renderGettingStartedPill(pill, status(['claude']), () => {}, view(3));
  assert.equal(textOf(pill), 'Getting started1/9');
});

test('step 0 shows only when setup is not finished, first, and calls onStep("setup")', () => {
  const { window } = dom();
  const host = window.document.getElementById('host');
  const stepped = [];
  renderGettingStarted(host, status([], { setupFinished: false }), { onStep: (id) => stepped.push(id) });
  const first = host.querySelector('.gs-tiles .gs-setup-tile');
  assert.ok(first, 'a Finish setup tile');
  assert.equal(textOf(first.querySelector('.gs-label')), 'Finish setup');
  const all = [...host.querySelectorAll('.gs-setup-tile, .gs-tile')];
  assert.equal(all[0], first, 'first in the card');
  click(window, first);
  assert.deepEqual(stepped, ['setup']);
  assert.equal(doneCount(status([], { setupFinished: false })), 0, 'step 0 never counts');
  renderGettingStarted(host, status([]), {});
  assert.equal(host.querySelector('.gs-setup-tile'), null);
});

test('Toward Runner holds steps 1-6 + counter; Later tags Helps Hooked', () => {
  const { window } = dom();
  const host = window.document.getElementById('host');
  renderGettingStarted(host, status(['claude']), { worcaLevel: view(1, 2) });
  const secs = [...host.querySelectorAll('.gs-section')];
  assert.deepEqual(secs.map((s) => textOf(s.querySelector('.gs-section-title'))), ['Toward Runner', 'Later']);
  const toward = secs[0];
  assert.deepEqual([...toward.querySelectorAll('.gs-tile')].map((t) => t.dataset.step),
    ['claude', 'project', 'run', 'ask', 'realRun', 'workflows']);
  assert.equal(textOf(toward.querySelector('.gs-counter')), 'Real runs · 2 of 3');
  const later = secs[1];
  assert.deepEqual([...later.querySelectorAll('.gs-tile')].map((t) => t.dataset.step), ['workspace', 'teamMetrics', 'teamPolicy']);
  for (const t of later.querySelectorAll('.gs-tile')) assert.equal(textOf(t.querySelector('.gs-helps')), 'Helps Hooked');
  assert.equal(toward.querySelector('.gs-helps'), null);
  renderGettingStarted(host, status(['claude']), { worcaLevel: null });
  assert.equal(textOf(host.querySelector('.gs-counter')), '3 real runs');
});

test('Later hides team steps before Runner outside Expert mode', () => {
  const { window } = dom();
  const host = window.document.getElementById('host');
  renderGettingStarted(host, status(), { worcaLevel: view(1), level: 'simple' });
  assert.deepEqual([...host.querySelectorAll('.gs-tile')].map((t) => t.dataset.step),
    ['claude', 'project', 'run', 'ask', 'realRun', 'workflows', 'workspace']);
});

test('at Runner the shelf folds and lists visible undone Later steps', () => {
  const { window } = dom();
  const host = window.document.getElementById('host');
  const stepped = [];
  renderGettingStarted(host, status(['claude', 'workspace', 'teamMetrics']), { worcaLevel: view(2, 3), level: 'simple', onStep: (id) => stepped.push(id) });
  assert.equal(host.querySelector('.gs-section'), null, 'no sections');
  assert.equal(host.querySelector('.gs-counter'), null);
  assert.equal(textOf(host.querySelector('.gs-fold')), "You're a Runner. Your level card shows what to try next.");
  const items = [...host.querySelectorAll('.gs-later-item')];
  assert.deepEqual(items.map((i) => i.dataset.step), ['teamPolicy'], 'team is on, solo steps done: only the undone visible step');
  click(window, items[0]);
  assert.deepEqual(stepped, ['teamPolicy']);
  renderGettingStarted(host, status(), { worcaLevel: view(2, 3), level: 'simple' });
  assert.deepEqual([...host.querySelectorAll('.gs-later-item')].map((i) => i.dataset.step), ['workspace'], 'solo: team steps hidden in every mode');
  renderGettingStarted(host, status(), { worcaLevel: view(3, 3), level: 'expert' });
  assert.deepEqual([...host.querySelectorAll('.gs-later-item')].map((i) => i.dataset.step), ['workspace']);
});

test('VIEW_MIN_LEVEL for team pages unchanged (R-po-37)', () => {
  const src = readFileSync(new URL('../ui/public/app.js', import.meta.url), 'utf8');
  assert.match(src, /'team-metrics': 'expert', 'team-policy': 'expert'/);
});

test('app wiring: the shelf opens setup for step 0, and onboarding-changed refreshes the level', () => {
  const app = readFileSync(new URL('../ui/public/app.js', import.meta.url), 'utf8');
  assert.match(app, /id === 'setup'\s*\?\s*openSetup\(\{ entry: 'first' \}\)/);
  const wiring = readFileSync(new URL('../ui/public/worca-level/app-wiring.mjs', import.meta.url), 'utf8');
  assert.match(wiring, /WORCA_REFRESH_EVENTS = new Set\([\s\S]*'onboarding-changed'/);
});

test('docs keep "Skip all"', () => {
  assert.match(readFileSync(new URL('../docs/getting-started.md', import.meta.url), 'utf8'), /Skip all/);
});
