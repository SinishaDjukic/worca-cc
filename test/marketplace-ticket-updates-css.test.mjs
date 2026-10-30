// test/marketplace-ticket-updates-css.test.mjs — Ticket updates' style block (plans/ticket-updates-design.md §8, boards 1, 2, 6):
// every mk-tu- class the section, the move select and the popover emit has a rule; the block sits in the Marketplace block
// (after P6, before P7); tokens only; board 6's phone rules.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { sheetHarness, settle } from './helpers/marketplace-sheet-harness.mjs';
import { createTicketUpdates } from '../ui/public/marketplace/ticket-updates-section.mjs';
import { tuGet, tuRoutes, ALL_DONE, LEGACY } from './helpers/ticket-updates-fixtures.mjs';

const trackDom = useDomRelease(afterEach);
const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
const at = css.indexOf('/* ── marketplace ticket updates ── */');
const block = css.slice(at, css.indexOf('/* ── marketplace P7 ── */'));
// JS and test hooks with no rule of their own.
const HOOKS = new Set(['mk-tu-add-projects', 'mk-tu-add-rule', 'mk-tu-projects', 'mk-tu-rulesblock', 'mk-tu-movepop', 'mk-tu-done', 'mk-tu-pcheck', 'mk-tu-newrow',
  'mk-tu-plive']);   // mk-tu-plive is .sr-only

test('every mk-tu- class the three modules and the sheet emit has a rule in the Ticket updates block', async () => {
  const h = sheetHarness({ trackDom, routes: tuRoutes(tuGet({ saved: false, legacy: { ...LEGACY, target: { typed: 'Resolve' } }, projects: [{ value: 'SHOP', label: 'Shop' }],
    rules: [ALL_DONE, { project: 'CRM', label: 'Customer portal', moment: 'finished', target: { kind: 'status', value: '10099', label: 'Shipped', category: 'done' } }] })) });
  const tu = createTicketUpdates({ doc: h.doc, api: h.deps.api, plugin: 'jira-source', sourceId: 'jira', profile: 'acme', tracker: 'Jira' });
  h.doc.body.append(tu.el);
  await tu.load();
  await settle();
  tu.el.querySelector('.mk-tu-add-rule').click();
  tu.el.querySelector('[data-project="CRM"] .mk-tu-move').click();
  await settle();
  const used = new Set([...h.doc.querySelectorAll('*')].flatMap((n) => [...n.classList]).filter((c) => c === 'mk-tu' || c.startsWith('mk-tu-')));
  h.doc.querySelector('[data-project="CRM"] .mk-tu-move').click();   // closes the list
  tu.el.querySelector('.mk-tu-add-projects').click();
  await settle();
  for (const c of [...h.doc.querySelectorAll('*')].flatMap((n) => [...n.classList])) if (c.startsWith('mk-tu-')) used.add(c);
  for (const c of ['mk-tu-moved', 'mk-tu-new', 'mk-tu-dot-in_progress', 'mk-tu-dot-todo', 'mk-tu-dot-cancelled', 'mk-tu-dot-none', 'mk-tu-dot-typed', 'mk-tu-optgroup']) used.add(c);
  const missing = [...used].filter((c) => !HOOKS.has(c) && !new RegExp(`\\.${c}(?![\\w-])`).test(block));
  assert.deepEqual(missing, []);
});

test('the block sits after P6 and before P7 (the Marketplace block); tokens only; scale font sizes', () => {
  assert.ok(at > css.indexOf('/* ── marketplace P6 ── */') && css.indexOf('/* ── marketplace P7 ── */') > at);
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}(?![\w-])|rgba?\(/);
  assert.deepEqual([...block.matchAll(/font-size:([^;}]+)/g)].map((m) => m[1]).filter((v) => !v.startsWith('var(--fs-')), []);
  assert.match(block, /\.mk-tu-rule\{display:grid;grid-template-columns:minmax\(0,1fr\) 220px 32px;/, 'board 1: name, a 220 px select, remove');
  assert.match(block, /\.mk-tu-dot-done\{background:var\(--green\);\}/);
  assert.match(block, /\.mk-tu-dot-in_progress\{background:var\(--peach\);\}/);
  assert.match(block, /\.mk-tu-dot-cancelled\{background:var\(--red\);\}/);
});

test('board 6: at 600 px and narrower each rule stacks, chips 36 px with 32 px ×, every button, select, option and row 44 px', () => {
  // House style writes the query without a space (17 uses in style.css)
  const phone = block.slice(block.indexOf('@media (max-width:600px)'));
  assert.ok(block.includes('@media (max-width:600px)'));
  assert.match(phone, /\.mk-tu-rule\{grid-template-columns:minmax\(0,1fr\) 44px;\}/);
  assert.match(phone, /\.mk-tu-rule>\.mk-tu-movewrap\{grid-column:1 \/ -1;grid-row:2;\}/);
  assert.match(phone, /\.mk-tu-chip\{min-height:36px;\}/);
  assert.match(phone, /\.mk-tu-x\{width:32px;height:32px;\}/);
  assert.match(phone, /\.mk-tu \.btn,\.mk-tu-move,\.mk-tu-project,\.mk-tu-remove,\.mk-tu-pop \.btn\{min-height:44px;\}/);
  // decided 2026-10-30: the listbox options and the popover's rows are phone targets too
  assert.match(phone, /\.mk-tu-opt,\.mk-tu-prow\{min-height:44px;\}/);
});
