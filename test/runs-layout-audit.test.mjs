// test/runs-layout-audit.test.mjs — the Runs list layout rules (runs redesign §3.3a; Known bugs 5, 8, 9) with injected rects
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { auditRunsLayout } from '../tools/runs-layout-audit.mjs';

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
