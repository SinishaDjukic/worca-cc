// test/helpers/design-preview-fixture.mjs
// Shared work folders for the Design preview tests (P3 Tasks 10, 12 and 13): a `work/` tree that P1's assembler
// reads, optionally carrying hostile markup or a shell with 20 nested slots (M5).

import { after } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Markup a model could write into a section, each part trying to run `fire(n)` (n counts from 1) in its own way.
 * Markup only: nothing here runs outside the doc under test.
 * @param {(n: number) => string} fire the code a payload would run, e.g. `(n) => 'window.__pwn=' + n`
 * @returns {string}
 */
export function hostileMarkup(fire) {
  let n = 0;
  const F = () => fire(++n);
  return [
    `<script>${F()}</script>`,
    `<script nonce="guess">${F()}</script>`,
    `<svg><script>${F()}</script></svg>`,
    `<img src="missing.png" onerror="${F()}">`,
    `<svg onload="${F()}"></svg>`,
    `<a id="jsl" href="javascript:${F()}">x</a>`,
    `<a id="jsl2" href=" JaVa&#9;ScRiPt:${F()}">x</a>`,
    `<iframe srcdoc="<script>${F()}</script>"></iframe>`,
    `<object data="javascript:${F()}"></object>`,
    `<embed src="javascript:${F()}">`,
    `<svg><a id="jsl3" xlink:href="javascript:${F()}"><text>y</text></a></svg>`,
    `<form id="f" action="javascript:${F()}"><button id="b" formaction="javascript:${F()}">z</button></form>`,
    `<details open ontoggle="${F()}"></details>`,
  ].join('\n');
}

const HEAD = '<!doctype html><html><head><meta charset="utf-8">';
const HOSTILE_HEAD = '<meta http-equiv="refresh" content="0;url=https://example.invalid/"><base href="https://example.invalid/">';
const FINE_COUNT = 40;
const FINE_ROWS = 5;
const FINE_PER_ROW = 4;

/** `shell.html`: the head, then the body, whose `<header>` is followed by `rows` (markup) and the sections container. */
function shellHtml({ hostile, rows }) {
  return `${HEAD}${hostile ? HOSTILE_HEAD : ''}<!--worca:head--></head>`
    + `<body${hostile ? ' onload="window.__pwn=1"' : ''}><header>H</header>${rows}`
    + '<main><!--worca:sections--></main><!--worca:foot--></body></html>';
}

/**
 * Writes a design's `work/` folder (creating it) and returns the plan written to `plan.json`.
 * - Default: a web plan with `hero` (done in `.crew.json`, written) and `price` (planned, left unstarted).
 * - `hostile`: `hero` embeds `hostileMarkup`, and the shell adds a `meta` refresh, a `base` and a `body` `onload`.
 * - `fine`: 40 sections `s0`-`s39`, all planned. The shell nests `s0`-`s19` in five `div.row`s of four slots each,
 *   right after `<header>` and outside `svg`, `math`, `select` and `template`; P1 puts `s20`-`s39` in `<main>`.
 * @param {string} work
 * @param {{ hostile?: boolean, fine?: boolean }} [opts]
 * @returns {object} the plan
 */
export function writeDesignWork(work, { hostile = false, fine = false } = {}) {
  mkdirSync(join(work, 'sections', 'hero'), { recursive: true });
  let plan;
  let crew;
  let rows = '';
  if (fine) {
    const ids = Array.from({ length: FINE_COUNT }, (_, i) => `s${i}`);
    plan = { v: 1, kind: 'web', title: 'Fixture', canvas: { w: 1440 },
      sections: ids.map((id) => ({ id, job: `Job ${id}`, brief: 'b', parts: ['html'], estHeight: 100 })) };
    crew = ids.map((id) => ({ id, status: 'planned', summary: '' }));
    for (let r = 0; r < FINE_ROWS; r += 1) {
      const slots = ids.slice(r * FINE_PER_ROW, (r + 1) * FINE_PER_ROW).map((id) => `<div data-worca-slot="${id}"></div>`);
      rows += `<div class="row">${slots.join('')}</div>`;
    }
  } else {
    plan = { v: 1, kind: 'web', title: 'Fixture', canvas: { w: 1440 }, sections: [
      { id: 'hero', job: 'Hero', brief: 'b', parts: ['html', 'css'], estHeight: 600 },
      { id: 'price', job: 'Price', brief: 'b', parts: ['html'], estHeight: 400 },
    ] };
    crew = [{ id: 'hero', status: 'done', summary: 's' }, { id: 'price', status: 'planned', summary: '' }];
  }
  writeFileSync(join(work, 'plan.json'), JSON.stringify(plan));
  writeFileSync(join(work, '.crew.json'), JSON.stringify(crew));
  writeFileSync(join(work, 'shell.html'), shellHtml({ hostile, rows }));
  writeFileSync(join(work, 'tokens.css'), ':root{--ink:#111;--paper:#fff}');
  writeFileSync(join(work, 'global.css'), 'body{margin:0;color:var(--ink);background:var(--paper)}');
  const extra = hostile ? `\n${hostileMarkup((n) => 'window.__pwn=' + n)}\n` : '';
  writeFileSync(join(work, 'sections', 'hero', 'index.html'), `<section data-section="hero"><h1>Ship</h1>${extra}</section>`);
  writeFileSync(join(work, 'sections', 'hero', 'style.css'), '[data-section="hero"] h1{font-size:48px}');
  return plan;
}

/**
 * A fresh `<root>/work/` under its own `mkdtemp` folder, removed by that exact path in an `after` hook (of the calling
 * test, or of the file when called at the top level). `hostile` and `fine` go to `writeDesignWork`; `noPlan` leaves
 * `plan.json` out.
 * @param {{ hostile?: boolean, fine?: boolean, noPlan?: boolean }} [opts]
 * @returns {{ root: string, work: string }}
 */
export function tmpDesign({ hostile = false, fine = false, noPlan = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dprev-'));
  after(() => rmSync(root, { recursive: true, force: true }));
  const work = join(root, 'work');
  writeDesignWork(work, { hostile, fine });
  if (noPlan) unlinkSync(join(work, 'plan.json'));
  return { root, work };
}
