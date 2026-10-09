// test/ui-levels.test.mjs — the interface mode (docs/ui-levels.md): simple | advanced | expert.
//
// Two jobs. (1) The guard: every nav item, Settings tab, Settings card and detail tab carries an
// EXPLICIT level — `simple` included — so a new one cannot ship without someone deciding where it
// belongs. (2) The contract: the helpers, the CSS gate, the dialog, the setting, the shell render,
// and the rules the mode never breaks (blocking prompts stay, deep links still open).
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { checkRows } from './helpers/rows.mjs';

import {
  UI_LEVELS, LEVEL_INFO, normalizeLevel, levelShows, levelAtLeast, currentLevel, tagLevel, keepVisible,
  minLevelFor, levelCardsHtml, applyLevel, createLevelController,
} from '../ui/public/ui-level.mjs';
import { renderIndexHtml } from '../src/core/index-html.mjs';
import {
  settingsFile, uiLevel, setUiLevel, assertUiLevelInput, defaultUiLevel, SETTINGS_POST_KEYS,
} from '../src/core/settings.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const pub = join(__dir, '..', 'ui', 'public');
const html = readFileSync(join(pub, 'index.html'), 'utf8');
const css = readFileSync(join(pub, 'style.css'), 'utf8');
const app = readFileSync(join(pub, 'app.js'), 'utf8');

const shell = () => new JSDOM(html).window.document;
const LEVEL_RE = /^(simple|advanced|expert)$/;

// ── (1) the guard ─────────────────────────────────────────────────────────────

test('every nav item, Settings tab and card, and detail tab declares an explicit, valid level', async () => {
  await checkRows([
    { name: 'every sidebar item carries an explicit level', run: () => {
      const doc = shell();
      const items = [...doc.querySelectorAll('.nav button')];
      assert.ok(items.length >= 14, 'the sidebar is present');
      for (const b of items) {
        assert.match(b.dataset.minLevel || '', LEVEL_RE, `nav item "${b.textContent.trim()}" has no data-min-level`);
      }
    } },
    { name: 'every Settings tab and every Settings card (the Models page\'s included) carries an explicit level', run: () => {
      const doc = shell();
      const tabs = [...doc.querySelectorAll('#settings-tabs button[data-tab]')];
      assert.ok(tabs.length >= 5);
      for (const b of tabs) assert.match(b.dataset.minLevel || '', LEVEL_RE, `Settings tab "${b.dataset.tab}"`);
      const cards = [...doc.querySelectorAll('.settings-pane .settings-card, [data-view="models"] .settings-card')];
      assert.ok(cards.length >= 10);
      for (const c of cards) {
        const name = c.id || (c.querySelector('h2') || {}).textContent;
        assert.match(c.dataset.minLevel || '', LEVEL_RE, `Settings card "${name}" has no data-min-level`);
      }
    } },
    { name: 'every detail tab (Running, History, project page, workspace page) declares a level', run: () => {
      for (const table of ['RD_TABS', 'HD_TABS', 'PD_TABS', 'WD_TABS']) {
        const start = app.indexOf(`const ${table} = [`);
        assert.ok(start > 0, `${table} exists`);
        const body = app.slice(start, app.indexOf('\n];', start));
        const keys = [...body.matchAll(/key: '([a-z-]+)'/g)].map((m) => m[1]);
        const levels = [...body.matchAll(/level: '([a-z]+)'/g)].map((m) => m[1]);
        assert.ok(keys.length > 0);
        assert.equal(levels.length, keys.length, `${table}: every tab (${keys.join(', ')}) needs a level:`);
        for (const l of levels) assert.match(l, LEVEL_RE);
      }
    } },
    { name: 'every data-min-level / data-max-level value in the shell is a real level', run: () => {
      for (const m of html.matchAll(/data-(?:min|max)-level="([^"]*)"/g)) assert.match(m[1], LEVEL_RE, m[0]);
    } },
  ]);
});

// ── (2) helpers ───────────────────────────────────────────────────────────────

test('level helpers: ordered/cumulative with unknown -> expert, levelAtLeast reads <html data-level>, tagLevel/keepVisible/minLevelFor ancestry, applyLevel fires only on change', async () => {
  await checkRows([
    { name: 'levels are ordered and cumulative; unknown values normalise to expert (gate nothing)', run: () => {
      assert.deepEqual([...UI_LEVELS], ['simple', 'advanced', 'expert']);
      assert.equal(normalizeLevel('bogus'), 'expert');
      assert.equal(normalizeLevel(undefined), 'expert');
      assert.ok(levelShows('simple', 'simple'));
      assert.ok(!levelShows('simple', 'advanced'));
      assert.ok(levelShows('advanced', 'simple'));
      assert.ok(!levelShows('advanced', 'expert'));
      assert.ok(levelShows('expert', 'advanced'));
      for (const l of UI_LEVELS) {
        assert.ok(LEVEL_INFO[l].label && LEVEL_INFO[l].who && LEVEL_INFO[l].desc && LEVEL_INFO[l].adds, `${l} is described`);
      }
    } },
    { name: 'levelAtLeast reads <html data-level>; no attribute behaves as expert', run: () => {
      const doc = new JSDOM('<!doctype html><html><body></body></html>').window.document;
      assert.equal(currentLevel(doc), 'expert');
      doc.documentElement.dataset.level = 'simple';
      assert.ok(levelAtLeast('simple', doc));
      assert.ok(!levelAtLeast('advanced', doc));
      doc.documentElement.dataset.level = 'advanced';
      assert.ok(levelAtLeast('advanced', doc));
      assert.ok(!levelAtLeast('expert', doc));
    } },
    { name: 'tagLevel / keepVisible / minLevelFor: the highest ancestor wins unless it is kept', run: () => {
      const doc = new JSDOM('<div id="a"><div id="b"><span id="c"></span></div></div>').window.document;
      tagLevel(doc.getElementById('a'), 'advanced');
      assert.equal(minLevelFor(doc.getElementById('c')), 'advanced');
      tagLevel(doc.getElementById('b'), 'expert');
      assert.equal(minLevelFor(doc.getElementById('c')), 'expert');
      keepVisible(doc.getElementById('b'), true);
      assert.equal(minLevelFor(doc.getElementById('c')), 'advanced', 'a kept element no longer raises the bar');
      keepVisible(doc.getElementById('b'), false);
      assert.equal(doc.getElementById('b').dataset.levelKeep, undefined);
      assert.equal(tagLevel(doc.getElementById('a'), 'nonsense').dataset.minLevel, 'advanced', 'an invalid level is ignored');
    } },
    { name: 'applyLevel sets the attribute and fires worca:level only on a change', run: () => {
      const dom = new JSDOM('<!doctype html><html data-level="simple"><body></body></html>');
      const doc = dom.window.document;
      const seen = [];
      doc.addEventListener('worca:level', (e) => seen.push(e.detail));
      applyLevel('expert', doc);
      applyLevel('expert', doc);
      assert.equal(doc.documentElement.dataset.level, 'expert');
      assert.deepEqual(seen, [{ level: 'expert', previous: 'simple' }]);
    } },
  ]);
});

// ── the CSS gate ──────────────────────────────────────────────────────────────

test('the stylesheet gates exactly the three cumulative cases, and honours data-level-keep', () => {
  const rule = (lvl, min) => new RegExp(`:root\\[data-level="${lvl}"\\] \\[data-min-level="${min}"\\]:not\\(\\[data-level-keep\\]\\)`);
  assert.match(css, rule('simple', 'advanced'));
  assert.match(css, rule('simple', 'expert'));
  assert.match(css, rule('advanced', 'expert'));
  assert.doesNotMatch(css, /:root\[data-level="expert"\] \[data-min-level/, 'expert hides nothing');
  assert.doesNotMatch(css, /\[data-min-level="simple"\][^{]*\{[^}]*display:none/, 'simple elements are never gated');
});

// ── the switch ────────────────────────────────────────────────────────────────

test('mode dialog: three radio cards, a click applies and saves, a failed save reverts; a [data-mode-set] control sets the mode without the dialog', async () => {
  await checkRows([
    { name: 'the dialog: three radio cards, click applies at once and saves, a failed save reverts', run: async () => {
      const dom = new JSDOM(html.replace('<html lang="en" data-theme="system">', '<html lang="en" data-theme="system" data-level="simple">'));
      const doc = dom.window.document;
      const saved = [];
      let fail = false;
      const ctl = createLevelController({ doc, save: async (l) => { saved.push(l); return fail ? { ok: false, error: 'disk full' } : { ok: true, level: l }; } });
      ctl.paint();
      assert.equal(doc.querySelector('#nav-mode .lv-name').textContent, 'Simple');
      doc.getElementById('nav-mode').click();
      const modal = doc.getElementById('mode-modal');
      assert.ok(!modal.classList.contains('hidden'), 'click opens the dialog');
      const cards = [...doc.querySelectorAll('#mode-cards [data-level-choice]')];
      assert.deepEqual(cards.map((c) => c.dataset.levelChoice), ['simple', 'advanced', 'expert']);
      assert.equal(doc.querySelector('#mode-cards [aria-checked="true"]').dataset.levelChoice, 'simple');
      assert.equal(doc.activeElement.dataset.levelChoice, 'simple', 'focus lands on the checked card');

      doc.querySelector('[data-level-choice="expert"]').click();
      assert.equal(doc.documentElement.dataset.level, 'expert', 'applies before the save resolves (live preview)');
      await new Promise((r) => setTimeout(r, 0));
      assert.deepEqual(saved, ['expert']);
      assert.equal(doc.querySelector('#nav-mode .lv-name').textContent, 'Expert');
      assert.equal(doc.querySelector('#modeSettingsName').textContent, 'Expert', 'the Settings card follows');

      fail = true;
      doc.querySelector('[data-level-choice="advanced"]').click();
      await new Promise((r) => setTimeout(r, 0));
      assert.equal(doc.documentElement.dataset.level, 'expert', 'a failed save reverts to the confirmed mode');
      assert.match(doc.getElementById('mode-msg').textContent, /disk full/);

      doc.getElementById('mode-done').click();
      assert.ok(modal.classList.contains('hidden'), 'Done closes');
    } },
    { name: 'a [data-mode-set] control (banner, hidden-settings note) sets the mode without opening the dialog', run: async () => {
      const doc = new JSDOM(html).window.document;
      const saved = [];
      createLevelController({ doc, save: async (l) => { saved.push(l); return { ok: true, level: l }; } }).paint('simple');
      const b = doc.getElementById('level-banner-switch');
      b.dataset.modeSet = 'expert';
      b.click();
      await new Promise((r) => setTimeout(r, 0));
      assert.deepEqual(saved, ['expert']);
      assert.ok(doc.getElementById('mode-modal').classList.contains('hidden'));
    } },
  ]);
});

test('levelCardsHtml escapes and marks exactly one card checked', () => {
  const doc = new JSDOM(`<div>${levelCardsHtml('advanced')}</div>`).window.document;
  assert.equal(doc.querySelectorAll('[aria-checked="true"]').length, 1);
  assert.equal(doc.querySelector('[aria-checked="true"]').dataset.levelChoice, 'advanced');
  assert.equal(doc.querySelectorAll('[role="radio"]').length, 3);
});

// ── the rules the mode never breaks ───────────────────────────────────────────

test('blocking prompts are never under a gated ancestor in the shell', () => {
  const doc = shell();
  for (const sel of ['#run-detail-tpl']) {
    const tpl = doc.querySelector(sel).content;
    for (const q of tpl.querySelectorAll('.qpanel, .cost-banner, .retained-banner, .rd-questions')) {
      assert.equal(minLevelFor(q), 'simple', `${sel} ${q.className} must show at every level`);
    }
  }
  for (const id of ['stop-modal', 'confirm-modal', 'mode-modal']) {
    const m = doc.getElementById(id);
    if (m) assert.equal(minLevelFor(m), 'simple', `#${id}`);
  }
});

test('a detail screen never opens on a tab the mode hides', () => {
  const init = app.slice(app.indexOf('function initDetailTabs'), app.indexOf('function reselectHiddenDetailTabs'));
  assert.match(init, /tagLevel\(btn, t\.level\)/);
  assert.match(init, /showsTab\(want\)/);
});

// ── the shell render ──────────────────────────────────────────────────────────

test('renderIndexHtml writes data-level beside data-theme; omitted ⇒ no attribute', () => {
  assert.match(renderIndexHtml(html, 'dark', 'simple'), /<html lang="en" data-theme="dark" data-level="simple">/);
  assert.match(renderIndexHtml(html, 'light'), /<html lang="en" data-theme="light">/);
});

// ── the setting ───────────────────────────────────────────────────────────────

let home, prevHome, prevProfile;
before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-ui-level-'));
  prevHome = process.env.HOME; prevProfile = process.env.USERPROFILE;
  process.env.HOME = home; process.env.USERPROFILE = home;
});
beforeEach(async () => {
  await mkdir(join(home, '.worca-cc'), { recursive: true });
  await writeFile(settingsFile(), '{}\n', 'utf8');
});
after(async () => {
  if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
  if (prevProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = prevProfile;
  await rm(home, { recursive: true, force: true });
});

test('uiLevel settings: absent/invalid -> null (loudly), setUiLevel stores every valid value and a clear deletes', async () => {
  await checkRows([
    { name: 'uiLevel: absent ⇒ null (never chosen); invalid ⇒ null, loudly', run: async () => {
      assert.equal(uiLevel(), null);
      await writeFile(settingsFile(), JSON.stringify({ uiLevel: 'wizard' }), 'utf8');
      const warned = [];
      const orig = console.warn; console.warn = (m) => warned.push(String(m));
      try { assert.equal(uiLevel(), null); } finally { console.warn = orig; }
      assert.match(warned[0], /invalid uiLevel "wizard"/);
    } },
    { name: 'setUiLevel stores every valid value (there is no fixed default to elide); a clear deletes', run: async () => {
      await writeFile(settingsFile(), '{}\n', 'utf8');
      for (const l of UI_LEVELS) {
        assert.deepEqual(await setUiLevel(l), { uiLevel: l });
        assert.equal(JSON.parse(await readFile(settingsFile(), 'utf8')).uiLevel, l);
      }
      await setUiLevel('');
      assert.equal('uiLevel' in JSON.parse(await readFile(settingsFile(), 'utf8')), false);
      await assert.rejects(() => setUiLevel('beginner'), /uiLevel must be simple, advanced or expert/);
      assert.throws(() => assertUiLevelInput('Expert'), /uiLevel must be/);
      assert.ok(SETTINGS_POST_KEYS.includes('uiLevel'));
    } },
  ]);
});

test('a fresh install starts simple; an install with history keeps the full UI', () => {
  assert.equal(defaultUiLevel({ fresh: true }), 'simple');
  assert.equal(defaultUiLevel({ fresh: false }), 'expert');
  assert.equal(defaultUiLevel(), 'expert', 'unknown ⇒ the safe side: hide nothing');
});
