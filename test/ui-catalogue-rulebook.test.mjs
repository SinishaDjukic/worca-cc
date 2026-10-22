// test/ui-catalogue-rulebook.test.mjs
// Slice 3 of the design language: the catalogue, composer and dialog screens use the shared components
// (docs/design-system.md › Components, › Patterns).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { renderMarketplaceCard } from '../ui/public/marketplace/marketplaces-view.mjs';
import { renderAllInstalled } from '../ui/public/marketplace/installed-view.mjs';
import { renderRemoveDialog } from '../ui/public/marketplace/remove-view.mjs';
import { renderProvidersCard } from '../ui/public/bridge-view.mjs';
import { renderModelsList } from '../ui/public/models-view.mjs';
import { renderPolicySyncChip } from '../ui/public/team-policy-view.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const CSS = read('ui/public/style.css');
const html = read('ui/public/index.html');
const page = new JSDOM(html).window.document;
const doc = new JSDOM('<!doctype html><body></body>').window.document;
// Every rule body whose selector list is exactly `sel` (top level and inside @media), so a phone override is not missed.
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const rules = (sel) => [...CSS.matchAll(new RegExp(`(?:^|[}{\\s])${esc(sel)}\\{([^}]*)\\}`, 'gm'))].map((m) => m[1]);
const ONE_SENTENCE = (t) => t.length <= 140 && !/[.!?]\s+\S/.test(t.trim().replace(/[.!?]$/, ''));

test('Workflows: the node toolbar, error chip and chat dock use .btn; Save is not washed out', () => {
  const shell = read('ui/public/workflows/shell.mjs');
  assert.match(shell, /h\('button', `wfv-tbb btn btn-quiet btn-sm\$\{iconName && !text \? ' btn-icon wfv-tbi' : ''\}`\)/);
  assert.match(html, /<button type="button" class="btn btn-sm btn-danger wfv-errchip" id="wfv-errors" hidden/);
  const dock = read('ui/public/workflows/chat-dock.mjs');
  assert.match(dock, /h\('button', 'btn btn-sm btn-quiet wfc-sel'\)/);
  assert.match(dock, /h\('button', 'btn btn-sm btn-quiet btn-icon wfc-file-x'\)/);
  assert.match(CSS, /\.wfv-savewrap > \.btn-primary:disabled\{opacity:\.7;\}/);
  assert.deepEqual(rules('.wfv-tbb'), [], 'no skin rule of its own');
  // shell.mjs's icon() emits an unsized <svg>: the text+icon buttons (Model ▾, Effort ▾, Delete) need the size too.
  assert.match(rules('.wfv-tb .btn svg').join(';'), /width:14px;height:14px;/);
  // .btn-danger's (0,3,0) hover would turn the grey and amber tones red.
  assert.match(CSS, /\.wfv-errchip\.is-incomplete:hover:not\(:disabled\)\{[^}]*var\(--field\)[^}]*color:var\(--ink-2\);\}/);
  assert.match(CSS, /\.wfv-errchip\.is-warning:hover:not\(:disabled\)\{[^}]*var\(--amber-bg\)[^}]*color:var\(--amber-ink-strong\);\}/);
});

test('Workflows Library: shared filter chips, divided rows, shared icons', () => {
  const lib = read('ui/public/workflows/library.mjs');
  assert.match(lib, /h\('button', 'filter-chip', t\)/);
  assert.doesNotMatch(lib, /PLUS_GLYPH|CLOSE_GLYPH|MORE_GLYPH|CHEVRON_GLYPH/);
  assert.match(lib, /import \{ iconSvg \} from '\.\.\/icons\.mjs';/);
  assert.match(CSS, /\.wfl-list \.wfl-item\{border-bottom:1px solid var\(--line\);border-radius:0;\}/);
  assert.match(CSS, /\.wfl-list \.wfl-item:is\(:hover,:has\(\.wfl-detail\)\)\{border-bottom-color:transparent;border-radius:var\(--r-sm\);\}/);
});

const PLUGIN = { name: 'acme', version: '1.0.0', enabled: true };
const MKT = { id: 'worca-cc', name: 'Worca CC Official', url: 'https://x/y.git', builtin: true, lastSync: { sha: 'abcdef0123', at: '2026-10-20T10:00:00Z' }, plugins: [{ name: 'acme', installed: false }] };
test('Marketplace: Installed is one card of divided rows, a marketplace is one card, Remove only in its ⋯ menu and dialog, no amber name badge, no page intro (L18)', () => {
  const all = renderAllInstalled(doc, [PLUGIN]);
  assert.ok(all.querySelector('ul.mk-rows.card > li.mk-row') && !all.querySelector('li.mk-row.card'), 'one card of divided rows, never a card per row');
  assert.equal(all.querySelector('.btn-danger'), null, 'Remove lives in the ⋯ menu and its dialog');
  assert.deepEqual(renderRemoveDialog(doc, { name: 'acme', iconKind: 'none', goesAway: [], changes: [] }).foot.map((b) => b.className),
    ['btn btn-quiet', 'btn btn-danger mk-confirm']);
  const card = renderMarketplaceCard(doc, MKT);
  assert.ok(card.classList.contains('card') && card.classList.contains('mk-mkt'), 'a card frames the marketplace you act on');
  assert.equal(card.querySelector('.btn-danger'), null, 'Remove lives in the ⋯ menu and its dialog');
  assert.equal(card.querySelector('.badge.mk-chip-built').textContent, 'Built-in');
  assert.deepEqual(rules('.pl-remove'), [], 'the solid red skin is gone');
  assert.equal(page.querySelector('[data-view="marketplace"] .page-intro'), null, 'the tabs are the header (docs/design-system.md › Marketplace exceptions)');
});

test('Providers: one intro line, four divided rows, shared buttons', () => {
  const pv = page.querySelector('[data-view="providers"] .page-intro');
  assert.ok(pv && ONE_SENTENCE(pv.textContent), 'one sentence');
  assert.equal(page.querySelectorAll('[data-view="providers"] .page-intro').length, 1, 'the two intros are one');
  const card = renderProvidersCard({}, { doc, split: true });
  assert.equal(card.querySelector('.mv-providers-hint'), null, 'the in-card intro merged into the page intro');
  assert.ok(card.classList.contains('drows'));
  const rows = [...card.querySelectorAll('.mv-pv-card')];
  assert.equal(rows.length, 4);
  for (const r of rows) assert.ok(r.classList.contains('drow') && r.classList.contains('drow-stack') && !r.classList.contains('card'));
  assert.deepEqual(rules('.mv-pv-card'), [], '.drow.drow-stack sets the gap');
  // The three-column field grid stacks under 560px like every other .drows row.
  assert.match(CSS, /@container drows \(max-width:560px\)\{\s*\.mv-pv-card \.mv-pv-row:not\(\.mv-sp-row\) \.mv-pv-ctl\{grid-template-columns:minmax\(0,1fr\);\}/);
  const pill = card.querySelector('.mv-cp-terms-pill');
  assert.ok(pill && pill.tagName === 'BUTTON' && pill.classList.contains('btn') && !pill.classList.contains('badge'));
  assert.ok(card.querySelector('.mv-pv-preset').classList.contains('btn'));
  assert.ok(renderProvidersCard({}, { doc }).querySelector('.mv-providers-hint'), 'the old in-Models card keeps its hint');
});

test('Connectors: one page intro, no mcp-chip, no typed plus, the plus icon on every Add', () => {
  const view = read('ui/public/mcp-view.mjs');
  const src = view + read('ui/public/mcp-definition-form.mjs');
  assert.doesNotMatch(src, /mcp-chip|['"`]\+ ?[Aa]dd/);
  assert.match(src, /addBtn\(doc, 'Add server', \{ act: 'add-member' \}\)/);
  assert.match(view, /h\(doc, 'div', 'sub page-intro', 'MCP servers and skills/);
  assert.match(CSS, /\.mcp-usedby > \.chip\{display:inline-flex;align-items:center;gap:6px;\}/);
  assert.match(CSS, /\.mcp-usedby > \.chip:has\(> \.btn\)\{padding-block:0;\}/, 'the 28px × sets a removable chip\'s height');
  assert.deepEqual(rules('.mcp-x'), []);
});

test('Models: shared filter chip, the group header is a 28px .btn, no centred column, sentence case', () => {
  const list = renderModelsList({ globals: [{ id: 'a', label: 'A' }] }, { doc });
  const chips = [...list.querySelectorAll('.mv-filters > button')];
  assert.ok(chips.length >= 7 && chips.every((c) => c.classList.contains('filter-chip') && c.dataset.filter));
  assert.equal(chips.filter((c) => c.getAttribute('aria-pressed') === 'true').length, 1);
  const t = list.querySelector('.mv-sec-toggle');
  assert.deepEqual([...t.classList], ['btn', 'btn-quiet', 'btn-sm', 'mv-sec-toggle']);
  assert.ok(t.querySelector('h3.section-title.mv-section-title'));
  assert.doesNotMatch(CSS, /\[data-view="models"\][^{]*\{[^}]*max-width/);
  assert.doesNotMatch(CSS, /\.mv-[\w-]+[^{]*\{[^}]*text-transform:uppercase/);
  assert.match(CSS, /\.info-tip\{[^}]*width:28px;height:28px;flex:0 0 28px;/);
  const intro = page.querySelector('[data-view="models"] .page-intro').textContent;
  assert.ok(ONE_SENTENCE(intro), intro);
  assert.deepEqual(rules('.mv-filter'), []);
  assert.deepEqual(rules('.mv-section-title'), [], '.section-title styles the group title');
});

const POLICY = { policy: { checkedAt: new Date(Date.now() - 9 * 60e3).toISOString(), warnings: [] } };
// Every all-caps label the slice rewrites (team-policy-view.mjs facts, stat cards and the kicker; app.js's machine label).
const CAPS = ['SHARED WITH THE TEAM', 'SOURCE', 'APPLIES TO', 'VERSION', 'NOTES', 'PER-PIPELINE CAP', 'TOTAL CAP',
  'REQUIRED PLUGINS', 'OFF-POLICY HERE', 'POLICY HOME', 'WORKSPACE RUNS', 'MEMBERS', 'NAME', 'FROM', 'PLUGIN', 'TYPE',
  'RUNS', 'ENVIRONMENT', 'HEADERS', 'EACH TEAMMATE FILLS', 'JOINS', 'FILES', 'SCRIPTS', 'SHELL BLOCKS', 'HOOKS',
  'PLUGIN FILES', 'ALLOWED TOOLS', 'CONSENT', 'UPDATES', 'ON THIS MACHINE'];
const ACRONYMS = new Set(['URL']);
test('Team policy: sentence-case labels, a sans sync chip, grey "not installed", no typed plus', () => {
  const src = read('ui/public/team-policy-view.mjs');
  const app = read('ui/public/app.js');
  assert.deepEqual(CAPS.filter((s) => src.includes(`'${s}'`) || app.includes(`'${s}'`)), []);
  // Any NEW all-caps fact or stat label fails too; an acronym such as 'URL' is allowed.
  const caps = [...src.matchAll(/(?:fact|statCard)\('([A-Z][A-Z -]+)'/g)].map((m) => m[1]).filter((s) => !ACRONYMS.has(s));
  assert.deepEqual(caps, []);
  assert.match(src, /fact\('URL'/, 'the acronym stays');
  const chip = renderPolicySyncChip(POLICY, { doc });
  assert.ok(!chip.classList.contains('tp-chip') && chip.classList.contains('tp-sync'), 'the editor value-chip rule (mono) no longer reaches the sync chip');
  assert.match(src, /missing: \['grey', 'not installed'\]/);
  assert.match(src, /'not-installed': \['grey', 'Not installed'/);
  assert.match(src, /h\(doc, 'span', 'badge slate', 'Team policy'\)/);
  assert.doesNotMatch(src, /h\(doc, 'button', '(?:linkish|tp-unset|tp-chip-rm)/, 'linkish stays only on the a.tp-open-page link');
  assert.doesNotMatch(src, /['"`]\+ ?[A-Za-z]/, 'no typed plus, lowercase "+ add" included');
  assert.doesNotMatch(src, /'✕'/);
  assert.match(CSS, /\.tp-kind\{display:inline-flex;padding:0 6px;\}/);
  assert.deepEqual(rules('.tp-kind').length, 1);
  assert.match(rules('.tp-chip').join(), /padding-block:0;/, 'the 28px × sets the chip height');
});

// The 16 dialogs in index.html. The model editor's card and the plugin modal's actions are JS-built, so their static
// markup has no footer button; the proof's dialog-sizes state and the source pins below cover them.
const DIALOGS = ['#model-editor-modal', '#model-import-modal', '#viewer-card', '#folder-browser', '#mode-modal', '#confirm-modal',
  '#report-modal', '#export-modal', '#shipit-modal', '#publish-modal', '#welcome-modal', '#claude-setup-modal', '#stop-modal',
  '#project-add-modal', '#project-bulk-modal', '#plugin-modal', '#scan-model-modal'];
// D12: the action rows, and the head Close / Full screen buttons.
const FOOT = ['.confirm-actions', '.stop-actions', '.add-project-actions', '.mode-foot', '.report-head-actions', '.publish-actions',
  '.shipit-actions', '.mv-editor-btns', '.viewer-actions', '[data-card-actions]'].map((s) => `${s} .btn`).concat('#plugin-modal-close', '#claude-setup-close').join(', ');
test('dialogs: footer actions are 32px .btn, cards keep the shared 24px padding, the danger OK is .btn-danger', () => {
  assert.equal(page.querySelectorAll('.viewer-modal[id]').length, DIALOGS.length, 'a new dialog joins DIALOGS');
  const small = [];
  for (const id of DIALOGS) {
    const m = page.querySelector(id);
    assert.ok(m, id);
    for (const b of m.querySelectorAll(FOOT)) if (b.classList.contains('btn-sm')) small.push(`${id} ${b.textContent.trim()}`);
  }
  assert.deepEqual(small, []);
  for (const id of ['#confirm-modal', '#folder-browser', '#mode-modal', '#publish-modal', '#project-add-modal', '#stop-modal'])
    assert.ok(page.querySelector(id).querySelector(FOOT), `${id} has a footer the selector sees`);
  for (const sel of ['.ob-welcome', '.mode-modal .card', '.shipit-card', '.gs-card', '.mv-editor'])
    assert.deepEqual(rules(sel).filter((b) => /(?:^|;)\s*padding\s*:/.test(b)), [], `${sel} keeps the shared .card padding (phone rules too)`);
  // The graph save dialog is a <dialog>, not a .card: its body carries the same 24px itself.
  assert.match(rules('.save-dialog .sd-body').join(';'), /(?:^|;)padding:24px;/);
  assert.doesNotMatch(CSS, /#confirm-ok\.danger\{/);
  assert.match(read('ui/public/app.js'), /el\.confirmOk\.classList\.toggle\('btn-danger', !!danger\);\s*el\.confirmOk\.classList\.toggle\('btn-primary', !danger\);/);
  assert.match(rules('.confirm-message').join(';'), /font-size:var\(--fs-body\)/);
  assert.doesNotMatch(rules('.confirm-field .input').join(';'), /padding/);
});

test('JS-built dialogs: footer actions carry no btn-sm', () => {
  // Each pin is the CURRENT btn-sm class string, so the test is red before the change and green after.
  const pins = [
    ['ui/public/schedule-sheet.mjs', /class: 'btn btn-sm sched-cancel'|class: 'btn btn-primary btn-sm sched-ok'/],
    ['ui/public/branch-sync.mjs', /class: 'btn btn-sm', text: 'Close'|class: 'btn btn-primary btn-sm sync-go'/],
    ['ui/public/modal-guard.mjs', /'btn btn-sm discard-keep'|'btn btn-sm btn-danger discard-go'/],
  ];
  for (const [file, old] of pins) assert.doesNotMatch(read(file), old, file);
  assert.doesNotMatch(read('ui/public/graph/save-dialog.mjs'), /btn-sm/);
  // #plugin-modal: about 25 callers pass ['Cancel', 'btn btn-sm', fn] tuples; the one shell drops btn-sm for all of them.
  assert.match(read('ui/public/app.js'), /b\.className = cls\.split\(' '\)\.filter\(\(c\) => c !== 'btn-sm'\)\.join\(' '\);/);
});

test('Getting started: one intro line, Hide is a quiet .btn, the card heading is a section title', () => {
  const gs = read('ui/public/getting-started.mjs');
  assert.match(gs, /hide\.className = 'btn btn-sm btn-quiet gs-hide';/);
  assert.match(gs, /h2\.className = 'section-title';/);
  const intro = page.querySelector('[data-view="getting-started"] .page-intro').textContent;
  assert.ok(ONE_SENTENCE(intro), intro);
  assert.deepEqual(rules('.gs-hide'), [], 'the underline skin is gone');
});

test('the theme proof measures the slice-3 pages, intros and dialogs, and runs the stray audit on all six pages', () => {
  const proof = read('tools/verify-theme-cdp.mjs');
  assert.match(proof, /\['workflows', 'marketplace', 'connectors', 'models', 'providers', 'team-policy', 'getting-started'\]/);
  for (const s of ['workflows', 'settings-plugins', 'connectors', 'settings-models', 'settings-providers', 'team-policy'])
    assert.match(proof, new RegExp(`STRAY_ROOTS = \\{[^}]*'?${s}'?:`), `${s} is stray-audited`);
  assert.match(proof, /'divided rows', 'quiet chip', 'grey badge', 'team policy type', 'page intro', 'dialog'/);
  assert.match(proof, /\['dialog-sizes', async \(\) => \{/);
  // Both Phase B skip lists (the running and the history variants) exclude dialog-sizes, so it adds no audit rows.
  assert.match(proof, /\['running-detail-tabs', 'layout-widths', 'dialog-sizes'\]\.includes\(id\)/, 'running skip list');
  assert.match(proof, /\['history-detail-tabs', 'history-menu', 'layout-widths', 'dialog-sizes'\]\.includes\(id\)/, 'history skip list');
  assert.match(proof, /strayReport\.push\(\{ state: `dialog-sizes #\$\{id\}`/, 'every index.html dialog is stray-audited');
  // The proof's FOOT selector is the unit test's, so the two dialog lists cannot drift.
  const line = proof.match(/const FOOT = (\[[\s\S]*?\.join\(', '\));/);
  assert.ok(line, 'the proof declares FOOT');
  assert.equal(new Function(`return ${line[1]}`)(), FOOT);
});

test('the typed-plus ratchet lost the four slice-3 files', () => {
  const debt = JSON.parse(read('test/fixtures/design-debt.json'));
  for (const f of ['mcp-view.mjs', 'mcp-definition-form.mjs', 'team-policy-view.mjs', 'script-bench-view.mjs'])
    assert.ok(!debt.typedPlus.includes(`ui/public/${f}`), f);
  for (const s of ['.mv-filter.on', '.wfl-chip[aria-pressed="true"]']) assert.ok(!debt.solidPressed.includes(s), s);
  // Run 3 (F-12): app.js and engine-settings-view.mjs typed "+" into <option> text, which cannot hold an icon; the
  // plus is dropped ("Add model…", "Add project…", "Override a …"), so the list is empty. Run 4 (D15): release-row.mjs's
  // "Add a release" is a quiet small button with the plus icon.
  assert.deepEqual(debt.typedPlus, []);
  assert.match(read('ui/public/app.js'), /option\('__add__', 'Add model…'\)/);
  assert.match(read('ui/public/engine-settings-view.mjs'), /doc\.createElement\('option'\), \{ value: '', textContent: `Override a/);
  assert.doesNotMatch(read('ui/public/shape/release-row.mjs'), /'\+ Add a release'/);
});

test('sideways scroll: the Marketplace header wraps and a long marketplace URL breaks at 290 and 375px', () => {
  assert.match(CSS, /\.mk-head\{[^}]*flex-wrap:wrap;/);
  assert.match(CSS, /\.mk-grid\{display:grid;grid-template-columns:repeat\(auto-fill,minmax\(min\(270px,100%\),1fr\)\);/);
  assert.match(CSS, /\.mk-mkt-url\{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:4px;min-width:0;overflow-wrap:anywhere;\}/);
});

test('docs/design-system.md names the Marketplace exceptions once (L18)', () => {
  const g = read('docs/design-system.md');
  const at = g.indexOf('\n### Marketplace exceptions\n');
  assert.ok(at > 0 && g.indexOf('\n### Marketplace exceptions\n', at + 1) < 0, 'one block');
  const block = g.slice(at, g.indexOf('\n## ', at + 1));
  for (const w of ['tile grid', 'Search plugins', 'facet rail', 'not filter chips', 'No page intro', 'Centred empty states', '`.mk-t-*`', '-ink-strong'])
    assert.ok(block.includes(w), w);
  assert.match(g, /Search is the top bar's "Search or ask" only\.(?:(?!\n- )[\s\S]){0,300}?\(Marketplace exceptions\)/);
  assert.match(g, /A full-bleed editor \(Workflows\) has\s+no page header; the Marketplace's tabs are its header \(Marketplace exceptions\)\./);
});
