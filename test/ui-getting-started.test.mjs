// test/ui-getting-started.test.mjs
// ui/public/getting-started.mjs — the tile shelf, the sidebar pill and the
// welcome bindings, driven in jsdom with no app.js boot (pure DOM module).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  GETTING_STARTED_STEPS, renderGettingStarted, renderGettingStartedPill, bindWelcome, doneCount, allStepsDone, vignette,
} from '../ui/public/getting-started.mjs';

const dom = () => new JSDOM('<!doctype html><body><div id="host"></div><div id="pill"></div></body>', { url: 'http://localhost/' });
const status = (done = [], extra = {}) => ({
  steps: Object.fromEntries(GETTING_STARTED_STEPS.map((s) => [s.id, done.includes(s.id)])),
  hidden: false, welcomeSeen: false, ...extra,
});
const click = (win, node) => node.dispatchEvent(new win.Event('click', { bubbles: true, cancelable: true }));

test('the shelf: eight tiles in arc order, progress, Hide; done tiles marked and still clickable', () => {
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
  assert.equal(card.querySelector('.gs-progress').textContent, '2 of 8');
  const tiles = [...card.querySelectorAll('.gs-tile')];
  assert.equal(tiles.length, 8);
  assert.deepEqual(tiles.map((t) => t.dataset.step), GETTING_STARTED_STEPS.map((s) => s.id));
  assert.deepEqual(tiles.map((t) => t.classList.contains('done')), [true, true, false, false, false, false, false, false]);
  for (const t of tiles) {
    assert.equal(t.tagName, 'BUTTON');
    assert.equal(t.getAttribute('type'), 'button');
    assert.ok(t.querySelector('.gs-mark'), 'a check mark');
    assert.ok(t.querySelector('.gs-vig svg'), 'a vignette');
    assert.ok(t.querySelector('.gs-label').textContent.length > 8, 'a label');
  }
  // A finished vignette is painted still; an unfinished one plays.
  assert.ok(tiles[0].querySelector('svg').classList.contains('static'));
  assert.ok(tiles[2].querySelector('svg').classList.contains('play'));
  // Done tiles reveal faster than unfinished ones: strictly increasing delays.
  const delays = tiles.map((t) => parseFloat(t.style.getPropertyValue('--tile-delay')));
  for (let i = 1; i < delays.length; i++) assert.ok(delays[i] > delays[i - 1], `tile ${i} arrives after tile ${i - 1}`);
  assert.ok(delays[2] - delays[1] < delays[3] - delays[2], 'a done tile holds the sequence for less than an unfinished one');

  click(window, tiles[0]);
  click(window, tiles[5]);
  assert.deepEqual(stepped, ['claude', 'realRun'], 'done or not, a tile re-summons its guide');
  click(window, card.querySelector('.gs-hide'));
  assert.equal(hid, 1);
});

test('the shelf paints nothing when hidden or when the status is not ours', () => {
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
});

test('all eight done reads "All set" and the count helpers agree', () => {
  const all = status(GETTING_STARTED_STEPS.map((s) => s.id));
  assert.equal(doneCount(all), 8);
  assert.equal(allStepsDone(all), true);
  assert.equal(allStepsDone(status(['run'])), false);
  const { window } = dom();
  const host = window.document.getElementById('host');
  renderGettingStarted(host, all);
  assert.equal(host.querySelector('.gs-head h2').textContent, 'All set');
  assert.equal(host.querySelectorAll('.gs-tile.done').length, 8);
});

test('the pill: count badge, opens on click, gone when hidden or complete', () => {
  const { window } = dom();
  const pill = window.document.getElementById('pill');
  let opened = 0;
  renderGettingStartedPill(pill, status(['claude', 'project', 'run']), () => opened++);
  assert.equal(pill.hidden, false);
  const btn = pill.querySelector('button.gs-pill');
  assert.ok(btn);
  assert.equal(btn.getAttribute('type'), 'button');
  assert.equal(btn.hasAttribute('data-nav'), false, 'not a nav route: app.js binds .nav button[data-nav] only');
  assert.equal(btn.querySelector('.nav-count').textContent, '3/8');
  assert.match(btn.getAttribute('aria-label'), /3 of 8/);
  click(window, btn);
  assert.equal(opened, 1);
  renderGettingStartedPill(pill, status([], { hidden: true }), () => opened++);
  assert.equal(pill.hidden, true);
  assert.equal(pill.children.length, 0);
  renderGettingStartedPill(pill, status(GETTING_STARTED_STEPS.map((s) => s.id)), () => opened++);
  assert.equal(pill.hidden, true, 'nothing left to nag about');
});

test('every vignette draws, with exactly one accent element per scene', () => {
  const { window } = dom();
  for (const s of GETTING_STARTED_STEPS) {
    const svg = vignette(window.document, s.vig, { animate: true, delay: 0.5 });
    assert.equal(svg.getAttribute('viewBox'), '0 0 120 70');
    assert.ok(svg.children.length >= 3, `${s.id} has artwork`);
    const accents = svg.querySelectorAll('.gs-accent');
    assert.ok(accents.length >= 1 && accents.length <= 2, `${s.id}: red scarce — one accent element (a wire may lead into it)`);
    assert.equal(svg.style.getPropertyValue('--tile-delay'), '0.5s');
    for (const part of svg.children) assert.ok(part.style.getPropertyValue('--d'), 'every element has its slot');
  }
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
  click(window, modal);                                   // the backdrop itself
  click(window, modal.querySelector('.card'));            // the card is not the backdrop
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(skips, 3);
  unbind();
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(skips, 3, 'unbound');
});
