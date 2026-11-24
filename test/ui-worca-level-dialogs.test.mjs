// test/ui-worca-level-dialogs.test.mjs — the worca level celebration dialog (there is no levels welcome): its copy, the single onClose, the backdrop grace window, and the invariants that
// they hold no inputs, never call the server and never touch <html data-level>.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { renderWorcaDialog } from '../ui/public/worca-level/dialogs.mjs';
import { WORCA_LEVELS, WORCA_LEVEL_COUNT } from '../src/shared/worca-levels.mjs';

const trackDom = useDomRelease(afterEach);
const realFetch = globalThis.fetch;
const realNow = Date.now;
afterEach(() => {
  globalThis.fetch = realFetch;
  Date.now = realNow;
});

const action = (id, done) => ({ id, label: `Label ${id}`, hint: `Hint ${id}`, href: `#/${id}`, done, doneAt: done ? 't' : null });
// What the served celebration says about the level after it (view.mjs celebrationView).
const nextOf = (index) => {
  const next = WORCA_LEVELS[index];
  if (!next) return { nextName: null, nextTotal: null, nextUnit: null };
  const council = next.index === WORCA_LEVEL_COUNT;
  return { nextName: next.name, nextTotal: council ? next.items[0].threshold : next.items.length, nextUnit: council ? 'days' : 'items' };
};
const summaryView = (levels) => levelView(levels[levels.length - 1].index, {
  celebration: null,
  summary: { from: 0, to: levels[levels.length - 1].index, items: [], levels: levels.map((l) => ({ ...l, avatar: WORCA_LEVELS[l.index - 1].avatar })) },
});
const levelView = (index, over = {}) => {
  const l = WORCA_LEVELS[index - 1];
  return {
    level: { index, key: l.key, name: l.name, description: l.description, avatar: l.avatar },
    progress: { done: 1, total: 3 },
    next: [action('a', true), action('b', false), action('c', false), action('d', false)],
    top: index === WORCA_LEVEL_COUNT,
    ladder: [],
    welcome: null,
    celebration: { index, key: l.key, name: l.name, hue: l.hue, avatar: l.avatar, ...nextOf(index) },
    summary: null,
    ...over,
  };
};

function setup() {
  const dom = trackDom(new JSDOM('<!doctype html><html data-level="beginner"><body></body></html>', { url: 'http://localhost:4317/' }));
  const calls = [];
  globalThis.fetch = async (...args) => {
    calls.push(args);
    return { ok: true, status: 200, json: async () => ({}) };
  };
  return { dom, doc: dom.window.document, calls };
}

const open = (kind, v, doc, onClose) => renderWorcaDialog(kind, v, { doc, onClose });
const text = (modal) => modal.textContent.replace(/\s+/g, ' ');
const closeButton = (modal) => modal.querySelector('button.worca-dlg-close');

test('every dialog is a guarded .viewer-modal with the avatar and the shared dialog anatomy', () => {
  for (const kind of ['celebration', 'summary']) {
    const { doc } = setup();
    const modal = open(kind, kind === 'summary' ? summaryView([{ index: 3, name: 'Hooked', reachedAt: null }]) : levelView(3), doc);
    assert.ok(modal.classList.contains('viewer-modal'), kind);
    assert.equal(modal.getAttribute('role'), 'dialog');
    assert.ok(doc.body.contains(modal), `${kind} is attached`);
    assert.equal(modal.querySelector('img').getAttribute('src'), '/assets/worca-levels/hooked.svg');
    assert.ok(modal.querySelector('.dlg-head') && modal.querySelector('.dlg-body') && modal.querySelector('.dlg-foot'));
    assert.equal(modal.querySelectorAll('input, select, textarea, [contenteditable]').length, 0, kind);
  }
});

test('celebration: tinted art, level counter, headline, recap with hat, next line, two buttons', () => {
  const { doc } = setup();
  const modal = open('celebration', levelView(3), doc);
  const art = modal.querySelector('.worca-dlg-art');
  assert.equal(art.style.getPropertyValue('--wl-hue'), '295');
  assert.ok(art.querySelector('img'));
  assert.match(text(modal), /New level · 3 of 5/);
  assert.equal(modal.querySelector('h2').textContent, "You're Hooked");
  assert.match(text(modal), /You've run 10 real runs on 3 days, created a PR and tried 2 more things\. Your avatar now wears the flat cap\./);
  assert.match(text(modal), /Next: WorcaHolic · 3 actions/);
  const see = modal.querySelector('a.worca-dlg-see');
  assert.equal(see.getAttribute('href'), '#profile/level');
  assert.equal(see.textContent, 'See your level');
  assert.equal(closeButton(modal).textContent, 'Carry on');
});

test("celebration art uses the celebrated level's hue and avatar even when view.level differs", () => {
  const { doc } = setup();
  const modal = open('celebration', levelView(4, { celebration: levelView(3).celebration }), doc);
  const art = modal.querySelector('.worca-dlg-art');
  const hooked = WORCA_LEVELS[2];
  assert.equal(art.getAttribute('data-worca-level'), hooked.key);
  assert.equal(art.style.getPropertyValue('--wl-hue'), String(hooked.hue));
  assert.match(art.querySelector('img').getAttribute('src'), new RegExp(`${hooked.key}\\.svg`));
  assert.match(text(modal), /New level · 3 of 5/);
  assert.equal(modal.querySelector('h2').textContent, "You're Hooked");
});

test('celebration of WorcaHolic shows "20 active days" for the Council next', () => {
  const { doc } = setup();
  const modal = open('celebration', levelView(4), doc);
  assert.match(text(modal), /Next: Worca's Council · 20 active days/);
  assert.doesNotMatch(text(modal), /actions/);
});

test('celebration "Next" uses celebration.nextTotal and nextName from the served view', () => {
  const { doc } = setup();
  const v = levelView(3);
  const modal = open('celebration', { ...v, celebration: { ...v.celebration, nextName: 'Next One', nextTotal: 7, nextUnit: 'items' } }, doc);
  assert.match(text(modal), /Next: Next One · 7 actions/);
});

test('summary lists each earned level once with its date', () => {
  const { doc } = setup();
  const modal = open('summary', summaryView([
    { index: 1, name: 'Beginner', reachedAt: '2026-03-02T10:00:00.000Z' },
    { index: 2, name: 'Runner', reachedAt: '2026-04-11T10:00:00.000Z' },
    { index: 3, name: 'Hooked', reachedAt: null },
  ]), doc);
  assert.equal(modal.dataset.dialog, 'summary');
  assert.match(text(modal), /Your work so far/);
  assert.equal(modal.querySelector('h2').textContent, "You're Hooked");
  const rows = [...modal.querySelectorAll('.worca-dlg-levels li')];
  assert.equal(rows.length, 3);
  assert.match(rows[0].textContent, /Beginner/);
  assert.match(rows[1].textContent, /Runner/);
  assert.match(rows[1].textContent, /2026/);
  assert.equal(rows.filter((r) => /Hooked/.test(r.textContent)).length, 1);
  assert.match(text(modal), /Only you can see your level\./);
  const see = modal.querySelector('a.worca-dlg-see');
  assert.equal(see.getAttribute('href'), '#profile/level');
  assert.equal(see.textContent, 'See your level');
  assert.equal(closeButton(modal).textContent, 'Carry on');
});

test('summary closes once through onClose', () => {
  const { doc } = setup();
  let closed = 0;
  const modal = open('summary', summaryView([{ index: 1, name: 'Beginner', reachedAt: null }]), doc, () => { closed += 1; });
  modal.querySelector('a.worca-dlg-see').click();
  closeButton(modal).click();
  assert.equal(closed, 1);
});

test('celebration at the top level has no Next line', () => {
  const { doc } = setup();
  const modal = open('celebration', levelView(5, { next: [] }), doc);
  assert.equal(modal.querySelector('h2').textContent, "You're part of Worca's Council");
  assert.match(text(modal), /Your avatar now wears the graduation cap\./);
  assert.doesNotMatch(text(modal), /Next:/);
});

test('onClose runs once even if both buttons are clicked, and the dialog never calls the server', () => {
  const { doc, calls } = setup();
  let closed = 0;
  const modal = open('celebration', levelView(3), doc, () => { closed += 1; });
  modal.querySelector('a.worca-dlg-see').click();
  closeButton(modal).click();
  closeButton(modal).click();
  assert.equal(closed, 1);
  assert.ok(!doc.body.contains(modal));
  assert.equal(calls.length, 0);
});

test('Escape closes once', () => {
  const { dom, doc } = setup();
  let closed = 0;
  const modal = open('celebration', levelView(1), doc, () => { closed += 1; });
  for (let i = 0; i < 2; i += 1) modal.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(closed, 1);
  assert.ok(!doc.body.contains(modal));
});

test('a scrim click straight after opening is ignored; one after the grace window closes', () => {
  const { dom, doc } = setup();
  const start = realNow();
  Date.now = () => start;
  let closed = 0;
  const modal = open('celebration', levelView(3), doc, () => { closed += 1; });
  const scrim = () => {
    modal.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true }));
    modal.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  };
  scrim();
  assert.equal(closed, 0);
  assert.ok(doc.body.contains(modal));
  Date.now = () => start + 600;
  scrim();
  assert.equal(closed, 1);
  assert.ok(!doc.body.contains(modal));
});

test('rendering and closing leave <html data-level> untouched', () => {
  for (const kind of ['celebration']) {
    const { doc } = setup();
    const modal = open(kind, levelView(2), doc);
    closeButton(modal).click();
    assert.equal(doc.documentElement.getAttribute('data-level'), 'beginner', kind);
  }
});

test('an unknown kind throws, and the levels welcome kinds no longer exist', () => {
  const { doc } = setup();
  for (const kind of ['nope', 'welcome']) assert.throws(() => open(kind, levelView(1), doc), /unknown/i, kind);
});
