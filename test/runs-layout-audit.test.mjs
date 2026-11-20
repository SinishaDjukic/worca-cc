// test/runs-layout-audit.test.mjs — the Runs list layout rules (runs redesign §3.3a; Known bugs 5, 8, 9) with injected rects
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { auditRunsLayout, auditGroupPageLayout } from '../tools/runs-layout-audit.mjs';

const html = `<div id="l">
  <div class="runs-item" data-state-word="Working"><a class="runs-row"><span class="runs-row-title">A</span><span class="runs-row-right" id="r1"></span><span class="runs-row-sub">Build</span><div class="runs-stage"><div class="run-prog-track" id="b1"></div><div class="run-prog-marks">Plan Build Review Ready</div></div></a></div>
  <div class="runs-item" data-state-word="Merged"><a class="runs-row"><span class="runs-row-title">B</span><span class="runs-row-right" id="r2"><span class="runs-count">2/3</span><span class="runs-pr"><span class="runs-pr-word">Merged</span></span></span><span class="runs-row-sub" id="s2">Fri</span></a></div>
</div><div class="wfv-menu" id="m"></div>`;

const R = (left, right, top = 0, bottom = 20) => ({ left, right, top, bottom, width: right - left, height: bottom - top });
const env = (rects) => ({ viewport: { width: 375, height: 800 }, rect: (n) => rects[n.id] || R(0, 0, 0, 0) });

test('passes when bars and right items end at one x, menus are on screen and each fact appears once', () => {
  const doc = new JSDOM(html).window.document;
  const ok = env({ r1: R(300, 340), b1: R(30, 340, 40, 44), r2: R(260, 340.5, 60, 80), m: R(100, 300, 10, 200) });
  assert.deepEqual(auditRunsLayout(doc.getElementById('l'), ok, doc), []);
});

test('fails on a right edge 6px off (Known bug 5), a menu off-screen (Known bug 8) and a fact said twice (Known bug 9)', () => {
  const doc = new JSDOM(html).window.document;
  doc.getElementById('s2').textContent = 'Merged · Fri';
  const bad = env({ r1: R(300, 334), b1: R(30, 340, 40, 44), r2: R(260, 340, 60, 80), m: R(250, 450, 10, 200) });
  assert.deepEqual(auditRunsLayout(doc.getElementById('l'), bad, doc).map((p) => p.rule).sort(), ['fact-twice', 'off-screen', 'right-edge']);
});

test('group page: title, card, tabs and table share edges; the row chevrons line up', () => {
  const doc = new JSDOM(`<!doctype html><body><div class="gpage"><header class="gpage-head"></header><section class="gpage-card"></section>
    <nav class="gpage-tabs"></nav><div class="gpage-panel"><ol class="run-members is-table">
    <li class="run-member"><span class="run-member-go"></span></li><li class="run-member"><span class="run-member-go"></span></li></ol></div></div></body>`).window.document;
  const rects = new Map([['.gpage-head', R(20, 980, 0, 40)], ['.gpage-card', R(20, 980, 50, 200)], ['.gpage-tabs', R(20, 980, 210, 240)], ['.run-members', R(20, 980, 250, 330)]]);
  const opens = [R(920, 980, 260, 288), R(920, 980, 300, 328)];
  const openEls = [...doc.querySelectorAll('.run-member-go')];
  const env = { rect: (e) => (e.classList.contains('run-member-go') ? opens[openEls.indexOf(e)] : rects.get([...rects.keys()].find((k) => e.matches(k)))),
    viewport: { width: 1000, height: 800 } };
  assert.deepEqual(auditGroupPageLayout(doc.querySelector('.gpage'), env, doc), []);
  opens[1] = R(900, 960, 300, 328);
  rects.set('.gpage-tabs', R(20, 990, 210, 240));
  const problems = auditGroupPageLayout(doc.querySelector('.gpage'), env, doc);
  assert.ok(problems.some((p) => p.rule === 'edges' && p.selector === '.gpage-tabs'));
  assert.ok(problems.some((p) => p.rule === 'open-column'));
});

test('QA 2: a title squeezed under half the row, or a chip over the title, fails', () => {
  const doc = new JSDOM(`<!doctype html><body><div id="l"><div class="runs-item" data-state-word="In review"><a class="runs-row" id="row">
    <span class="runs-row-title" id="t">1 · Found</span><span class="runs-row-right" id="r"><span class="runs-pr" id="c">Checks failing</span></span>
    <span class="runs-row-sub" id="s">Fri</span></a></div></div></body>`).window.document;
  const squeezed = env({ row: R(0, 300), t: R(0, 80), r: R(88, 300), c: R(88, 300) });
  assert.deepEqual(auditRunsLayout(doc.getElementById('l'), squeezed, doc).map((p) => p.rule), ['title-share']);
  const over = env({ row: R(0, 300), t: R(0, 200), r: R(150, 300), c: R(150, 300) });
  assert.deepEqual(auditRunsLayout(doc.getElementById('l'), over, doc).map((p) => p.rule).sort(), ['overlap']);
  const wrapped = env({ row: R(0, 300, 0, 60), t: R(0, 300), r: R(180, 300, 22, 40), c: R(180, 300, 22, 40) });
  assert.deepEqual(auditRunsLayout(doc.getElementById('l'), wrapped, doc), [], 'dropped under the title: fine');
});

test('QA 8: group page rows: a chip over the cost fails; chip and cost under the title pass', () => {
  const doc = new JSDOM(`<!doctype html><body><div class="gpage"><ol class="run-members is-table"><li class="run-member">
    <span class="status-dot"></span><span class="run-member-num">1</span>
    <span class="run-member-main"><a class="run-member-title" id="t">Found the bug</a><span class="run-member-line">Needs you</span></span>
    <span class="run-member-pr"><a class="runs-pr is-failing" id="c"><span class="runs-pr-word">Checks failing</span></a></span>
    <span class="run-member-cost" id="k">$1.20</span><span class="run-member-go"></span></li></ol></div></body>`).window.document;
  const rules = (rects) => auditGroupPageLayout(doc.querySelector('.gpage'),
    { rect: (e) => rects[e.id] || R(0, 250, 0, 80), viewport: { width: 290, height: 800 } }, doc).map((p) => p.rule);
  assert.deepEqual(rules({ t: R(40, 140, 0, 40), c: R(150, 260), k: R(200, 260) }), ['overlap']);
  assert.deepEqual(rules({ t: R(40, 200, 0, 40), c: R(40, 150, 44, 60), k: R(200, 240, 44, 60) }), [], 'stacked under the title');
});

test('QA 8: a group page row wider than its table (a ~290px pane) fails as row-overflow', () => {
  const doc = new JSDOM(`<!doctype html><body><div class="gpage"><ol class="run-members is-table" id="tbl"><li class="run-member" id="row">
    <a class="run-member-title" id="t">Billing: invoices</a></li></ol></div></body>`).window.document;
  const rules = (rects) => auditGroupPageLayout(doc.querySelector('.gpage'),
    { rect: (e) => rects[e.id] || R(0, 0), viewport: { width: 290, height: 800 } }, doc).map((p) => p.rule);
  assert.deepEqual(rules({ tbl: R(72, 218), row: R(72, 262), t: R(104, 202) }), ['row-overflow']);
  assert.deepEqual(rules({ tbl: R(72, 218), row: R(72, 218), t: R(92, 218) }), []);
});

test('bundle QA 2: at 290px the number stays on the title line and the chip icon stays with its word', () => {
  const doc = new JSDOM(`<!doctype html><body><div class="gpage"><ol class="run-members is-table"><li class="run-member">
    <span class="status-dot"></span><span class="run-member-num" id="n">1</span>
    <span class="run-member-main"><a class="run-member-title" id="t">Found the bug in uploads</a><span class="run-member-line">In review</span></span>
    <span class="run-member-pr"><a class="runs-pr is-failing" id="c"><span class="ic" id="i"></span><span class="runs-pr-word" id="w">Checks failing</span></a></span>
    <span class="run-member-cost" id="k">$1.20</span></li></ol></div></body>`).window.document;
  const rules = (rects) => auditGroupPageLayout(doc.querySelector('.gpage'),
    { rect: (e) => rects[e.id] || R(0, 250, 0, 80), viewport: { width: 290, height: 800 } }, doc).map((p) => p.rule).sort();
  const ok = { n: R(20, 40, 12, 28), t: R(48, 250, 0, 40), c: R(48, 160, 44, 60), i: R(48, 62, 45, 59), w: R(66, 160, 44, 60), k: R(210, 250, 44, 60) };
  assert.deepEqual(rules(ok), []);
  assert.deepEqual(rules({ ...ok, n: R(20, 40, 44, 60) }), ['num-line'], 'the number dropped under the title');
  assert.deepEqual(rules({ ...ok, c: R(48, 120, 44, 80), i: R(48, 62, 44, 58), w: R(48, 120, 62, 78) }), ['chip-wrap'], 'the icon sits above its word');
});

test('#955 member-height: a row inside a group is 26px, 40px on a coarse pointer; a live member with its line is exempt', () => {
  const doc = new JSDOM(`<div id="l"><div class="runs-item" data-level="top" id="g"><a class="runs-row"><span class="runs-row-title">G</span><span class="runs-row-right"></span></a>
    <div class="runs-members">
      <div class="runs-item" data-level="member" id="m1"><a class="runs-row"><span class="runs-row-title">1 · A</span><span class="runs-row-right"></span><span class="runs-row-sub">Merged</span></a></div>
      <div class="runs-item" data-level="member" id="m2"><a class="runs-row"><span class="runs-row-title">2 · B</span><span class="runs-row-right"></span><span class="runs-row-sub">Build</span><span class="runs-row-prog"><i></i></span></a></div>
      <div class="runs-item" data-level="member" id="m3"><a class="runs-row"><span class="runs-row-title">3 · C</span><span class="runs-row-right"></span><span class="runs-row-sub">Refine Plan</span><div class="run-prog runs-stage"></div></a></div>
    </div></div></div>`).window.document;
  const root = doc.getElementById('l');
  // m3 (#1012): a staged live member's four-section block is exempt too.
  const run = (m1, coarse) => auditRunsLayout(root, { coarse, viewport: { width: 375, height: 800 },
    rect: (n) => ({ g: R(0, 340, 0, 120), m1, m2: R(0, 340, 60, 93), m3: R(0, 340, 93, 153) })[n.id] || R(0, 0, 0, 0) }, doc).map((p) => p.rule);
  assert.deepEqual(run(R(0, 340, 34, 60), false), []);
  assert.deepEqual(run(R(0, 340, 34, 70), false), ['member-height']);
  assert.deepEqual(run(R(0, 340, 34, 74), true), []);
  assert.deepEqual(run(R(0, 340, 34, 60), true), ['member-height']);
});
