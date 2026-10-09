// test/ui-topnav-search.test.mjs — the top bar's "Search or ask" combobox (ui/public/topnav-search.mjs) over
// the markup index.html ships: ⌘K / Ctrl+K and its guards, Escape and outside presses, the listbox (groups,
// "No matches", the Ask row), the arrow keys and Enter, hover, what each row does, the lazy sources (once per
// open), the combobox ARIA, the phone's open / close buttons and the platform's shortcut label.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createTopnavSearch } from '../ui/public/topnav-search.mjs';
import { checkRows } from './helpers/rows.mjs';

// The search exactly as index.html ships it (the `.topnav-c` slot's content).
const html = readFileSync(new URL('../ui/public/index.html', import.meta.url), 'utf8');
const MARKUP = new JSDOM(html).window.document.querySelector('.topnav-c').innerHTML;
const PAGE = `<!doctype html><body><button type="button" id="before">Before</button>
  <header class="topnav" id="topnav"><div class="topnav-c">${MARKUP}</div></header>
  <aside class="term-pane"><textarea id="term"></textarea></aside><button type="button" id="out">Elsewhere</button></body>`;

const NOW = Date.now();
const SOURCES = {
  live: [{ runId: 'r1', pipelineId: '', title: 'Fix login', status: 'running', ask: null, startedAt: new Date(NOW - 60e3).toISOString(),
    groupKey: 'billing-1', groupName: 'billing-api' }],
  history: [{ id: 'p1', projectKey: 'billing-1', title: 'Login page', status: 'done', pr: 'MERGED', startedAt: new Date(NOW - 864e5).toISOString(),
    mtime: new Date(NOW - 864e5).toISOString(), groupName: 'billing-api' }],
  projects: [{ key: 'billing-1', name: 'billing-api' }],
  workspaces: [{ id: 'wks-1', name: 'login team', projectCount: 2 }],
  workflows: [], schedules: [], tickets: [],
};

function setup({ platform = '', sources = SOURCES, lazy = null } = {}) {
  const { window } = new JSDOM(PAGE);
  const doc = window.document;
  if (platform) Object.defineProperty(window.navigator, 'platform', { value: platform, configurable: true });
  window.Element.prototype.scrollIntoView = function () {};
  const calls = { navigate: [], workflow: [], ask: [], lazy: 0 };
  const src = { ...sources };
  const search = createTopnavSearch({
    doc, win: window, root: doc.querySelector('.tsearch'),
    getSources: () => src,
    loadLazy: () => { calls.lazy += 1; return lazy ? lazy(src) : null; },
    onAsk: (q) => calls.ask.push(q),
    navigate: (href) => calls.navigate.push(href),
    openWorkflow: (id) => calls.workflow.push(id),
  });
  const $ = (id) => doc.getElementById(id);
  const key = (target, k, init = {}) => {
    const e = new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
    (target || doc.body).dispatchEvent(e);
    return e;
  };
  const type = (text) => { $('tsearch-input').value = text; $('tsearch-input').dispatchEvent(new window.Event('input', { bubbles: true })); };
  const options = () => [...doc.querySelectorAll('#tsearch-pop [role="option"]')];
  const active = () => doc.getElementById($('tsearch-input').getAttribute('aria-activedescendant') || '') || null;
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return { window, doc, $, search, calls, key, type, options, active, settle, src };
}

test('⌘K / Ctrl+K: opens and focuses the input; pressed again in the input it closes and gives focus back', async () => {
  await checkRows([
    { name: '⌘K opens, focuses, expands; ⌘K again closes and refocuses the previous element', run: () => {
      const { $, doc, key, search } = setup();
      $('before').focus();
      const e1 = key($('before'), 'k', { metaKey: true });
      assert.equal(e1.defaultPrevented, true);
      assert.equal(search.isOpen(), true);
      assert.equal(doc.activeElement, $('tsearch-input'));
      assert.equal($('tsearch-input').getAttribute('aria-expanded'), 'true');
      assert.equal($('tsearch-pop').hidden, false);
      const e2 = key($('tsearch-input'), 'k', { metaKey: true });
      assert.equal(e2.defaultPrevented, true);
      assert.equal(search.isOpen(), false);
      assert.equal($('tsearch-pop').hidden, true);
      assert.equal($('tsearch-input').getAttribute('aria-expanded'), 'false');
      assert.equal(doc.activeElement, $('before'), 'focus went back');
    } },
    { name: 'Ctrl+K does the same (Windows / Linux)', run: () => {
      const { $, doc, key, search } = setup();
      key(doc.body, 'k', { ctrlKey: true });
      assert.equal(search.isOpen(), true);
      assert.equal(doc.activeElement, $('tsearch-input'));
      key($('tsearch-input'), 'K', { ctrlKey: true, shiftKey: true });
      assert.equal(search.isOpen(), false);
      assert.notEqual(doc.activeElement, $('tsearch-input'), 'nothing to go back to: the input lets go');
    } },
    { name: 'ignored inside the terminal pane (the shell’s kill-line), on key repeat and while composing', run: () => {
      const { $, key, search } = setup();
      const t = key($('term'), 'k', { ctrlKey: true });
      assert.equal(t.defaultPrevented, false);
      assert.equal(search.isOpen(), false);
      const held = key(null, 'k', { ctrlKey: true, repeat: true });
      assert.equal(search.isOpen(), false, 'repeat');
      assert.equal(held.defaultPrevented, true, 'a held Ctrl+K never reaches the browser’s own search');
      key(null, 'k', { metaKey: true, isComposing: true });
      assert.equal(search.isOpen(), false, 'composing');
      key(null, 'k', { metaKey: true, altKey: true });
      assert.equal(search.isOpen(), false, 'Alt+K is not the chord');
    } },
    { name: 'ignored while the header is inert (the phone drawer is open)', run: () => {
      const { $, key, search } = setup();
      $('topnav').setAttribute('inert', '');
      const e = key(null, 'k', { metaKey: true });
      assert.equal(search.isOpen(), false);
      assert.equal(e.defaultPrevented, false);
    } },
    { name: 'ignored while a modal is open (a confirm keeps its keys and its focus); a closed one does not block', run: () => {
      const { doc, key, search } = setup();
      const modal = doc.createElement('div');
      modal.className = 'viewer-modal confirm-modal';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      const ok = doc.createElement('button');
      ok.type = 'button';
      modal.appendChild(ok);
      doc.body.appendChild(modal);
      ok.focus();
      const e = key(ok, 'k', { metaKey: true });
      assert.equal(search.isOpen(), false);
      assert.equal(e.defaultPrevented, false);
      assert.equal(doc.activeElement, ok, 'focus stays in the modal');
      modal.classList.add('hidden');
      key(null, 'k', { metaKey: true });
      assert.equal(search.isOpen(), true, 'a hidden modal does not block');
    } },
    { name: 'ignored while a native <dialog> is open', run: () => {
      const { doc, key, search } = setup();
      const dialog = doc.createElement('dialog');
      dialog.setAttribute('open', '');
      doc.body.appendChild(dialog);
      key(null, 'k', { ctrlKey: true });
      assert.equal(search.isOpen(), false);
    } },
    { name: 'ignored while a guide tour runs (its layer keeps the keys, its Escape ends the tour)', run: () => {
      const { doc, key, search } = setup();
      const layer = doc.createElement('div');
      layer.className = 'guide-layer spotlight';
      doc.body.appendChild(layer);
      const e = key(null, 'k', { metaKey: true });
      assert.equal(search.isOpen(), false);
      assert.equal(e.defaultPrevented, false);
      layer.remove();
      key(null, 'k', { metaKey: true });
      assert.equal(search.isOpen(), true, 'the tour over: the chord is back');
    } },
  ]);
});

test('Escape closes and restores focus, and no later handler sees it; an outside press closes; Tab away closes', async () => {
  await checkRows([
    { name: 'Escape in the input: closed, focus back, consumed before a page handler', run: () => {
      const { $, doc, key, search } = setup();
      let leaked = 0;
      doc.addEventListener('keydown', (e) => { if (e.key === 'Escape') leaked += 1; }, true);   // a page arm added later (app.js)
      $('before').focus();
      key(null, 'k', { metaKey: true });
      const e = key($('tsearch-input'), 'Escape');
      assert.equal(search.isOpen(), false);
      assert.equal(e.defaultPrevented, true);
      assert.equal(leaked, 0, 'stopImmediatePropagation');
      assert.equal(doc.activeElement, $('before'));
    } },
    { name: 'Escape elsewhere with the search closed is not touched', run: () => {
      const { $, doc, key } = setup();
      let seen = 0;
      doc.addEventListener('keydown', (e) => { if (e.key === 'Escape') seen += 1; }, true);
      const e = key($('out'), 'Escape');
      assert.equal(e.defaultPrevented, false);
      assert.equal(seen, 1);
    } },
    { name: 'a pointerdown outside closes; one inside the popover does not', run: () => {
      const { $, window, key, search } = setup();
      key(null, 'k', { metaKey: true });
      $('tsearch-pop').dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
      assert.equal(search.isOpen(), true);
      $('out').dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
      assert.equal(search.isOpen(), false);
    } },
    { name: 'focus leaving the search (Tab) closes it', run: () => {
      const { $, key, search } = setup();
      key(null, 'k', { metaKey: true });
      $('out').focus();
      assert.equal(search.isOpen(), false);
    } },
  ]);
});

test('the listbox: Runs, then "Projects, workflows, schedules", a divider, Ask Worca last; empty query; No matches', async () => {
  await checkRows([
    { name: 'a query shows both groups and the Ask row last', run: () => {
      const { doc, key, type, options } = setup();
      key(null, 'k', { metaKey: true });
      type('login');
      const labels = [...doc.querySelectorAll('#tsearch-pop .tsearch-label')].map((n) => n.textContent);
      assert.deepEqual(labels, ['Runs', 'Projects, workflows, schedules']);
      const groups = [...doc.querySelectorAll('#tsearch-pop [role="group"]')];
      assert.deepEqual(groups.map((g) => g.querySelectorAll('[role="option"]').length), [2, 1]);
      assert.equal(groups[0].getAttribute('aria-labelledby'), 'tsearch-g-runs');
      const opts = options();
      assert.equal(opts.length, 4);
      assert.equal(opts[0].querySelector('.tsearch-title').textContent, 'Login page', 'title prefix first');
      assert.equal(opts[1].querySelector('.tsearch-meta').textContent, 'billing-api · Running');
      assert.ok(opts[1].querySelector('.tsearch-dot.tone-run'));
      assert.equal(opts[2].querySelector('.tsearch-meta').textContent, 'Workspace · 2 projects');
      const last = opts[3];
      assert.equal(last.querySelector('.tsearch-title').textContent, 'Ask Worca');
      assert.equal(last.querySelector('.tsearch-meta').textContent, 'opens a chat');
      assert.ok(last.previousElementSibling.classList.contains('tsearch-sep'), 'a divider before Ask Worca');
      assert.equal(doc.querySelector('#tsearch-pop .tsearch-none'), null);
    } },
    { name: 'the empty query lists runs only (the second group is hidden)', run: () => {
      const { doc, key, options } = setup();
      key(null, 'k', { metaKey: true });
      assert.deepEqual([...doc.querySelectorAll('#tsearch-pop .tsearch-label')].map((n) => n.textContent), ['Runs']);
      assert.deepEqual(options().map((o) => o.querySelector('.tsearch-title').textContent), ['Fix login', 'Login page', 'Ask Worca']);
    } },
    { name: 'nothing typed and no runs yet: the Ask row alone, no "No matches", no divider', run: () => {
      const { doc, key, options } = setup({ sources: { projects: SOURCES.projects } });
      key(null, 'k', { metaKey: true });
      assert.equal(doc.querySelector('#tsearch-pop .tsearch-none'), null);
      assert.equal(doc.querySelector('#tsearch-pop .tsearch-sep'), null);
      assert.deepEqual(options().map((o) => o.querySelector('.tsearch-title').textContent), ['Ask Worca']);
    } },
    { name: 'no match: one muted "No matches" line and the Ask row', run: () => {
      const { doc, key, type, options } = setup();
      key(null, 'k', { metaKey: true });
      type('zzz');
      assert.equal(doc.querySelector('#tsearch-pop .tsearch-none').textContent, 'No matches');
      assert.equal(doc.querySelectorAll('#tsearch-pop [role="group"]').length, 0);
      assert.deepEqual(options().map((o) => o.querySelector('.tsearch-title').textContent), ['Ask Worca']);
    } },
  ]);
});

test('keys: ↓/↑ move the active option (wrapping, never onto a label), Enter activates it; hover sets it', async () => {
  await checkRows([
    { name: 'arrows wrap over the options only; aria-activedescendant and aria-selected follow', run: () => {
      const { $, key, type, options, active } = setup();
      key(null, 'k', { metaKey: true });
      type('login');
      const opts = options();
      const input = $('tsearch-input');
      assert.equal(active(), opts[0], 'the first option is active');
      key(input, 'ArrowDown');
      assert.equal(active(), opts[1]);
      key(input, 'ArrowDown');
      assert.equal(active(), opts[2], 'straight past the second group’s label');
      key(input, 'ArrowDown');
      key(input, 'ArrowDown');
      assert.equal(active(), opts[0], 'wraps to the top');
      key(input, 'ArrowUp');
      assert.equal(active(), opts[3], 'wraps to the bottom (Ask Worca)');
      assert.deepEqual(opts.map((o) => o.getAttribute('aria-selected')), ['false', 'false', 'false', 'true']);
      assert.equal(new Set(opts.map((o) => o.id)).size, 4);
      for (const o of opts) assert.match(o.id, /^tsearch-opt-\d+$/);
    } },
    { name: 'Enter activates the active option', run: () => {
      const { $, key, type, calls } = setup();
      key(null, 'k', { metaKey: true });
      type('login');
      key($('tsearch-input'), 'ArrowDown');
      const e = key($('tsearch-input'), 'Enter');
      assert.equal(e.defaultPrevented, true);
      assert.deepEqual(calls.navigate, ['#running/r1']);
    } },
    { name: 'hover makes an option active', run: () => {
      const { window, key, type, options, active } = setup();
      key(null, 'k', { metaKey: true });
      type('login');
      const opts = options();
      opts[2].querySelector('.tsearch-title').dispatchEvent(new window.Event('pointermove', { bubbles: true }));
      assert.equal(active(), opts[2]);
    } },
    { name: 'while an IME composes, Enter, Escape and the arrows belong to it: no move, no activation, no close', run: () => {
      const { $, key, type, options, active, search, calls } = setup();
      key(null, 'k', { metaKey: true });
      type('login');
      const input = $('tsearch-input');
      const first = options()[0];
      const down = key(input, 'ArrowDown', { isComposing: true });
      assert.equal(down.defaultPrevented, false);
      assert.equal(active(), first, 'no move');
      const enter = key(input, 'Enter', { isComposing: true });
      assert.equal(enter.defaultPrevented, false);
      assert.deepEqual(calls.navigate, [], 'no activation');
      const esc = key(input, 'Escape', { isComposing: true });
      assert.equal(esc.defaultPrevented, false);
      assert.equal(search.isOpen(), true, 'no close');
      // WebKit ends the composition before the committing keydown, which then reads isComposing false, keyCode 229.
      const commit = key(input, 'Enter', { keyCode: 229 });
      assert.equal(commit.keyCode, 229);
      assert.equal(commit.defaultPrevented, false);
      assert.deepEqual(calls.navigate, [], 'the commit Enter does not activate');
      key(input, 'ArrowDown', { keyCode: 229 });
      assert.equal(active(), first, 'nor move');
      key(input, 'Escape', { keyCode: 229 });
      assert.equal(search.isOpen(), true, 'nor close');
    } },
  ]);
});

test('each row goes to its place; every activation closes the popover and clears the input', async () => {
  const sources = {
    ...SOURCES,
    workflows: [{ id: 'wf_9', name: 'nightly flow', builtin: false }],
    schedules: [{ id: 's1', title: 'nightly sweep', sentence: 'Every day at 02:00', status: 'active' }],
    tickets: [{ id: 't1', scheduleId: null, title: 'nightly once', status: 'scheduled', runAt: new Date(NOW + 864e5).toISOString(), after: null }],
  };
  const pick = (query, title, init = {}) => {
    const ctx = setup({ sources, ...init });
    ctx.key(null, 'k', { metaKey: true });
    if (query) ctx.type(query);
    const o = ctx.options().find((x) => x.querySelector('.tsearch-title').textContent === title);
    assert.ok(o, `${title} is listed`);
    o.dispatchEvent(new ctx.window.MouseEvent('click', { bubbles: true }));
    assert.equal(ctx.search.isOpen(), false, 'closed');
    assert.equal(ctx.$('tsearch-input').value, '', 'cleared');
    assert.notEqual(ctx.doc.activeElement, ctx.$('tsearch-input'));
    return ctx.calls;
  };
  await checkRows([
    { name: 'a live run → #running/<runId>', run: () => assert.deepEqual(pick('fix', 'Fix login').navigate, ['#running/r1']) },
    { name: 'a finished run → #history/<projectKey>/<id>', run: () => assert.deepEqual(pick('page', 'Login page').navigate, ['#history/billing-1/p1']) },
    { name: 'a project → #projects/<key>', run: () => assert.deepEqual(pick('billing project', 'billing-api').navigate, ['#projects/billing-1']) },
    { name: 'a workspace → #workspaces/<id>', run: () => assert.deepEqual(pick('team', 'login team').navigate, ['#workspaces/wks-1']) },
    { name: 'a workflow → openWorkflow(id)', run: () => {
      const calls = pick('flow', 'nightly flow');
      assert.deepEqual(calls.workflow, ['wf_9']);
      assert.deepEqual(calls.navigate, []);
    } },
    { name: 'a series → #schedules/repeating', run: () => assert.deepEqual(pick('sweep', 'nightly sweep').navigate, ['#schedules/repeating']) },
    { name: 'a one-off → #schedules/once', run: () => assert.deepEqual(pick('once', 'nightly once').navigate, ['#schedules/once']) },
    { name: 'Ask Worca with text → onAsk(the query, trimmed)', run: () => assert.deepEqual(pick('  why did it fail ', 'Ask Worca').ask, ['why did it fail']) },
    { name: 'Ask Worca with nothing typed → onAsk("")', run: () => assert.deepEqual(pick('', 'Ask Worca').ask, ['']) },
  ]);
});

test('lazy sources: fetched once per open — never per keystroke — and the rows repaint when they land', async () => {
  let release = null;
  const ctx = setup({ lazy: (src) => new Promise((r) => { release = () => { src.workflows = [{ id: 'wf_9', name: 'nightly flow', builtin: true }]; r(); }; }) });
  ctx.key(null, 'k', { metaKey: true });
  await ctx.settle();
  assert.equal(ctx.calls.lazy, 1);
  ctx.type('n');
  ctx.type('ni');
  ctx.type('nightly');
  assert.equal(ctx.calls.lazy, 1, 'typing does not fetch');
  assert.equal(ctx.doc.querySelector('#tsearch-pop .tsearch-none').textContent, 'No matches');
  release();
  await ctx.settle();
  const titles = ctx.options().map((o) => o.querySelector('.tsearch-title').textContent);
  assert.deepEqual(titles, ['nightly flow', 'Ask Worca'], 'repainted with what arrived');
  assert.equal(ctx.options()[0].querySelector('.tsearch-meta').textContent, 'Workflow · built-in');
  ctx.key(ctx.$('tsearch-input'), 'Escape');
  ctx.key(null, 'k', { metaKey: true });
  await ctx.settle();
  assert.equal(ctx.calls.lazy, 2, 'the next open fetches again');
});

test('a lazy read that fails (rejects or throws) leaves the rows already in memory, and the next open tries again', async () => {
  await checkRows([
    { name: 'a rejected read', run: async () => {
      const ctx = setup({ lazy: () => Promise.reject(new Error('workflows down')) });
      ctx.key(null, 'k', { metaKey: true });
      ctx.type('login');
      await ctx.settle();
      assert.equal(ctx.search.isOpen(), true);
      assert.deepEqual(ctx.options().map((o) => o.querySelector('.tsearch-title').textContent), ['Login page', 'Fix login', 'login team', 'Ask Worca']);
      ctx.key(ctx.$('tsearch-input'), 'Escape');
      ctx.key(null, 'k', { metaKey: true });
      await ctx.settle();
      assert.equal(ctx.calls.lazy, 2);
    } },
    { name: 'a read that throws before it returns a promise', run: async () => {
      const ctx = setup({ lazy: () => { throw new Error('boom'); } });
      ctx.key(null, 'k', { metaKey: true });
      await ctx.settle();
      ctx.type('fix');
      assert.deepEqual(ctx.options().map((o) => o.querySelector('.tsearch-title').textContent), ['Fix login', 'Ask Worca']);
    } },
  ]);
});

test('combobox ARIA: role, owns the listbox, expanded state, active descendant only while open', () => {
  const { $, key } = setup();
  const input = $('tsearch-input');
  assert.equal(input.getAttribute('role'), 'combobox');
  assert.equal(input.getAttribute('type'), 'search');
  assert.equal(input.getAttribute('placeholder'), 'Search or ask');
  assert.equal(input.getAttribute('aria-autocomplete'), 'list');
  assert.equal(input.getAttribute('aria-controls'), 'tsearch-pop');
  assert.equal($('tsearch-pop').getAttribute('role'), 'listbox');
  assert.equal($('tsearch-pop').getAttribute('tabindex'), '-1', 'an overflowing listbox is never a Tab stop (focus stays in the input)');
  assert.equal(input.getAttribute('aria-expanded'), 'false');
  assert.equal(input.hasAttribute('aria-activedescendant'), false);
  key(null, 'k', { metaKey: true });
  assert.equal(input.getAttribute('aria-activedescendant'), 'tsearch-opt-0');
  key(input, 'Escape');
  assert.equal(input.hasAttribute('aria-activedescendant'), false);
});

test('phone: the search button opens the full-width input, its close button closes it and focus goes back', () => {
  const { $, doc, window, search } = setup();
  const openBtn = $('tsearch-open');
  assert.equal(openBtn.getAttribute('aria-label'), 'Search');
  assert.equal($('tsearch-close').getAttribute('aria-label'), 'Close search');
  openBtn.focus();
  openBtn.click();
  assert.equal(search.isOpen(), true);
  assert.ok(doc.querySelector('.tsearch').classList.contains('is-open'), 'the CSS hook for the full-width row');
  assert.equal(doc.activeElement, $('tsearch-input'));
  const down = new window.MouseEvent('mousedown', { bubbles: true, cancelable: true });
  $('tsearch-close').dispatchEvent(down);
  assert.equal(down.defaultPrevented, true, 'pressing close keeps focus in the input until the click');
  $('tsearch-close').click();
  assert.equal(search.isOpen(), false);
  assert.equal(doc.querySelector('.tsearch').classList.contains('is-open'), false);
  assert.equal(doc.activeElement, openBtn);
});

test('the shortcut chip reads ⌘K on a Mac and Ctrl K elsewhere', () => {
  assert.equal(setup({ platform: 'MacIntel' }).doc.querySelector('.tsearch-kbd').textContent, '⌘K');
  assert.equal(setup({ platform: 'Win32' }).doc.querySelector('.tsearch-kbd').textContent, 'Ctrl K');
  assert.equal(setup({ platform: 'Linux x86_64' }).doc.querySelector('.tsearch-kbd').textContent, 'Ctrl K');
});

// The look is pinned in the stylesheet (jsdom has no layout): the house ruleBody idiom reads the FIRST
// rule written exactly as `selector {…}`; the phone rules are read from the "Responsive nav tiers" block.
const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp('(?:^|[\\s,}])' + escaped + '\\s*\\{([^}]*)\\}'));
  return m ? m[1].replace(/\s+/g, ' ') : null;
}

test('the look: a 34px pill, the open ring from the search tokens, a listbox as wide as the pill (360px at least), [hidden] restated', () => {
  assert.match(css, /--search-line:light-dark\(rgba\(221,107,77,\.45\),rgba\(240,154,124,\.45\)\);/);
  assert.match(css, /--search-ring:light-dark\(rgba\(221,107,77,\.24\),rgba\(240,154,124,\.26\)\);/);
  const field = ruleBody('.tsearch-field');
  assert.match(field, /height:34px;/);
  assert.match(field, /border-radius:999px;/);
  assert.match(field, /box-shadow:0 0 0 1px var\(--line\);/);
  assert.match(ruleBody('.tsearch.is-open .tsearch-field'), /box-shadow:0 0 0 1px var\(--search-line\),0 0 0 4px var\(--search-ring\);/);
  assert.equal(ruleBody('.tsearch-open,.tsearch-close'), 'display:none;', 'desktop: no phone buttons');
  assert.equal(ruleBody('.tsearch-kbd:empty'), 'display:none;', 'no empty chip before the script names the chord');
  const pop = ruleBody('.tsearch-pop');
  assert.match(pop, /position:absolute;z-index:30;top:calc\(100% \+ 8px\);/);
  assert.match(pop, /width:100%;min-width:360px;/);
  assert.match(pop, /border-radius:var\(--r-card\);/);
  assert.match(pop, /var\(--shadow-pop\);/);
  assert.equal(ruleBody('.tsearch-pop[hidden]'), 'display:none;');
  assert.match(ruleBody('.tsearch-opt'), /min-height:34px;/);
  assert.equal(ruleBody('.tsearch-opt.is-active'), 'background:var(--hover);');
  assert.equal(ruleBody('.tsearch-dot.tone-need'), 'background:var(--amber);');
  assert.equal(ruleBody('.tsearch-dot.tone-run'), 'background:var(--blue);');
  assert.equal(ruleBody('.tsearch-dot.tone-fail'), 'background:var(--red);');
  const top = css.indexOf('.topnav-new:focus-visible{');
  assert.ok(top > 0 && css.indexOf('\n.tsearch{') > top && css.indexOf('\n.tsearch{') < css.indexOf('\n.topbar{'), 'the block sits after the top bar rules');
});

test('stacking: open, the whole search sits over the open Ask Worca sheet, under the phone drawer, the flyouts, a tour and the modals', () => {
  const z = (selector) => {
    const body = ruleBody(selector);
    assert.ok(body, `${selector} is styled`);
    const m = body.match(/(?:^|;|\s)z-index:(\d+)/);
    assert.ok(m, `${selector} declares a z-index`);
    return Number(m[1]);
  };
  // .topnav, .main-col and .app make no stacking context, so .tsearch.is-open competes in the root one.
  for (const sel of ['.app', '.main-col', '.topnav']) assert.doesNotMatch(ruleBody(sel), /z-index|transform|filter|opacity|isolation|contain/, `${sel} adds no stacking context`);
  assert.match(ruleBody('.tsearch'), /position:relative;/);
  const open = z('.tsearch.is-open');
  assert.equal(open, 41);
  assert.ok(open > z('.ask-dock'), 'over the Ask dock (its sheet is opaque and centred under the search)');
  assert.ok(open > z('.term-pane'), 'over the terminal pane');
  assert.ok(open < z('.nav-fly') && open < z('.guide-scrim') && open < z('.viewer-modal'), 'under the flyouts, a tour and the modals');
  assert.ok(open < Number(css.match(/\n {2}\.sidebar\{position:fixed;[^}]*z-index:(\d+);/)[1]), 'under the phone drawer');
});

test('phones: the pill folds into a 32px search button; open, the input is a full-width row over the bar and the listbox spans the screen less 16px', () => {
  const start = css.indexOf('  .topnav-new-label{display:none;}');
  assert.ok(start > 0, 'inside the "Responsive nav tiers" phone block');
  const block = css.slice(start, css.indexOf('\n}\n', start));
  assert.match(block, /\n {2}\.tsearch-field\{display:none;\}/);
  assert.match(block, /\n {2}\.tsearch-open\{display:flex;[^}]*width:32px;height:32px;/);
  assert.match(block, /\n {2}\.tsearch\.is-open::before\{content:"";position:fixed;top:0;left:0;right:0;z-index:30;height:48px;background:var\(--panel\);\}/);
  assert.match(block, /\n {2}\.tsearch\.is-open \.tsearch-field\{display:flex;position:fixed;top:7px;left:8px;right:8px;z-index:31;\}/);
  assert.match(block, /\n {2}\.tsearch\.is-open \.tsearch-open\{visibility:hidden;\}/, 'the covered search button is no Tab stop while the row is open');
  assert.match(block, /\n {2}\.tsearch\.is-open \.tsearch-close\{display:flex;/);
  assert.match(block, /\n {2}\.tsearch-pop\{position:fixed;top:56px;left:8px;right:8px;width:auto;min-width:0;transform:none;/);
});
