// test/nav-page-head.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { cssRules } from './helpers/css-rules.mjs';
import { buildPageHead, mountPageHead, setPageMeta, focusPageTitle } from '../ui/public/nav/page-head.mjs';
import { buildGroupPage } from '../ui/public/group-page.mjs';
import * as runPageHead from '../ui/public/run-page-head.mjs';

const doc = (html) => new JSDOM(`<!doctype html><body>${html}</body>`).window.document;
const CSS = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
const HTML = readFileSync(new URL('../ui/public/index.html', import.meta.url), 'utf8');

test('build: title row slot, meta (hidden while empty), actions slot, tabs slot', () => {
  const h = buildPageHead(doc(''));
  assert.equal(h.root.tagName, 'HEADER');
  assert.equal(h.root.className, 'ph');
  assert.ok(h.root.querySelector(':scope > .ph-row > .ph-main > .ph-meta'));
  assert.ok(h.root.querySelector(':scope > .ph-row > .ph-actions'));
  assert.ok(h.root.querySelector(':scope > .ph-tabs'));
  assert.equal(h.meta.hidden, true);
  setPageMeta(h, '5 runs');
  assert.equal(h.meta.hidden, false);
  assert.equal(h.meta.textContent, '5 runs');
});

test('mount moves the screen\'s own nodes (same objects, listeners kept) and is idempotent', () => {
  const d = doc(`<div class="rd"><div class="rd-bar"><button class="rd-after">Run after</button></div>
    <section class="rd-glance"><header class="rd-page-head"><div class="rd-title-row"><h1 class="rd-page-title" tabindex="-1">T</h1></div></header></section>
    <section class="rd-details"><div class="rd-tabs" role="tablist"></div></section></div>`);
  const screen = d.querySelector('.rd');
  const bar = screen.querySelector('.rd-bar');
  const row = screen.querySelector('.rd-title-row');
  const tabs = screen.querySelector('.rd-tabs');
  let clicks = 0;
  bar.querySelector('.rd-after').addEventListener('click', () => clicks++);
  const h = mountPageHead(screen, { titleRow: row, actions: bar, tablist: tabs });
  assert.equal(screen.firstElementChild, h.root);
  assert.equal(h.root.querySelector('.ph-main > .rd-title-row'), row);
  assert.equal(h.root.querySelector('.ph-actions > .rd-bar'), bar);
  assert.equal(h.root.querySelector('.ph-tabs > .rd-tabs'), tabs);
  h.root.querySelector('.rd-after').click();
  assert.equal(clicks, 1);
  assert.equal(mountPageHead(screen, { titleRow: row, actions: bar, tablist: tabs }), h);
  assert.equal(screen.querySelectorAll('.ph').length, 1);
});

test('focusPageTitle focuses the head\'s h1 unless focus is inside the `keep` element', () => {
  const d = doc(`<ul id="list"><li><a href="#x" id="row">r</a></li></ul><div class="rd"><div class="rd-title-row"><h1 tabindex="-1">T</h1></div></div>`);
  const screen = d.querySelector('.rd');
  const h = mountPageHead(screen, { titleRow: screen.querySelector('.rd-title-row') });
  d.getElementById('row').focus();
  focusPageTitle(h, { keep: d.getElementById('list') });
  assert.equal(d.activeElement.id, 'row');
  focusPageTitle(h, { keep: null });                    // the slide layout passes no keep: the h1 wins
  assert.equal(d.activeElement.tagName, 'H1');
});

test('style.css: the head and breadcrumb rules use tokens only (light and dark come from light-dark())', () => {
  const rules = cssRules(CSS).filter((r) => /\.ph\b|\.ph-|\.nav-trail|\.nav-crumb|\.nav-up|\.topnav-crumbs|data-presentation="page"/.test(r.sel));
  assert.ok(rules.length >= 8, `found ${rules.length} rules`);
  for (const r of rules) assert.doesNotMatch(r.body, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i, r.sel);
});

test('style.css: a strip in the head scrolls sideways and is not sticky; the group head adds no second inset', () => {
  const top = cssRules(CSS).filter((r) => !r.media);
  const strip = top.find((r) => r.sel.trim() === '.ph-tabs > [role="tablist"]');
  assert.ok(strip, 'no .ph-tabs > [role="tablist"] rule');
  assert.match(strip.body, /overflow-x\s*:\s*auto/);
  assert.match(strip.body, /position\s*:\s*static/);
  assert.match(strip.body, /padding-top\s*:\s*0/);
  const g = top.find((r) => r.sel.trim() === '.gpage > .ph');
  assert.ok(g && /padding\s*:\s*0/.test(g.body), 'no .gpage > .ph{padding:0}');
  assert.ok(buildGroupPage(doc('')).querySelector(':scope > .ph > .ph-tabs > .tabs[role="tablist"]'));
});

test('deleted, not hidden: no old way back in either run template, the group page, run-page-head.mjs or style.css', () => {
  const page = doc('');
  page.body.innerHTML = HTML.replace(/^[\s\S]*?<body[^>]*>/i, '').replace(/<\/body>[\s\S]*$/i, '');
  const OLD = '.rd-back,.hd-back,.rd-to-run,.hd-to-run,.rd-crumbs,.rd-bar-mid,.rd-bar-title';
  for (const id of ['run-detail-tpl', 'hist-detail-tpl']) {
    const root = page.getElementById(id).content.firstElementChild;
    assert.equal(root.querySelectorAll(OLD).length, 0, id);
    assert.equal(root.hasAttribute('data-mode'), false, `${id}: the page has no Details mode`);
    assert.ok(root.querySelector('.rd-header, .hd-header'), `${id}: the Chat panel's Details header stays (slice 3)`);
  }
  const g = buildGroupPage(page);
  assert.equal(g.querySelectorAll('.gpage-back,.rd-crumbs,.gpage-head').length, 0);
  assert.equal('runCrumbs' in runPageHead, false);
  assert.equal('paintCrumbs' in runPageHead, false);
  const sels = cssRules(CSS).map((r) => r.sel).join('\n');
  assert.doesNotMatch(sels, /\.rd-crumb|data-title-out|\.rd-bar-mid|\.rd-to-run|\.hd-to-run/);
});
