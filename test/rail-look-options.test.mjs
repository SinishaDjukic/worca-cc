// test/rail-look-options.test.mjs — a component brings its look (docs/rail/components.md › comp.look-options): every size,
// colour or class option a library function takes is listed in the catalog's lookOptions, allowed or deprecated with a why,
// and the list only goes down. Removing the deprecated ones is the final cleanup PR's job.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as LIB from '../ui/public/design-system/components/index.mjs';

// Lower it in the same change that removes a look option; never raise it.
const LOOK_OPTIONS_CEILING = 51;

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = 'ui/public/design-system/components';
const LOOK = /^(cls|class|className|\w+Cls|size|tone|colou?r|width|height|style|variant|small|large|wide|compact)$/;

// The parameter list from the `(` at `at` to its matching `)`, with strings emptied and comments dropped.
function params(src, at) {
  let out = '', depth = 0;
  for (let i = at; i < src.length; i++) {
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
    if (ch === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { let j = i + 1; while (j < src.length && src[j] !== ch) j += src[j] === '\\' ? 2 : 1; out += "''"; i = j; continue; }
    if ('({['.includes(ch)) depth++;
    if (')}]'.includes(ch)) depth--;
    out += ch;
    if (depth === 0) return out;
  }
  return out;
}
// Look options in a module's exported signatures: positional parameters and destructured keys (the left of `a: b`).
function scan(src) {
  const out = [];
  for (const m of src.matchAll(/export (?:function (\w+)\s*|const (\w+)\s*=\s*)\(/g)) {
    const names = [...params(src, m.index + m[0].length - 1).matchAll(/(?:^|[({,])\s*(?:\.\.\.)?([A-Za-z_$][\w$]*)(?=\s*[,:=})])/g)].map((x) => x[1]);
    for (const option of new Set(names)) if (LOOK.test(option)) out.push({ name: m[1] || m[2], option });
  }
  return out;
}
const scanned = () => readdirSync(join(ROOT, DIR)).filter((f) => f.endsWith('.mjs') && f !== 'index.mjs')
  .flatMap((f) => scan(readFileSync(join(ROOT, DIR, f), 'utf8')).filter((x) => x.name in LIB).map((x) => ({ code: `${DIR}/${f}#${x.name}`, option: x.option })));
const catalog = () => JSON.parse(readFileSync(join(ROOT, 'docs/design-system-catalog.json'), 'utf8')).lookOptions;
const key = (x) => `${x.code} ${x.option}`;

test('the scanner finds a look option in each signature form', () => {
  const opts = (s) => scan(s).map((x) => x.option);
  assert.deepEqual(opts("export function a({ label, cls: extra = '' }) {}"), ['cls']);
  assert.deepEqual(opts("export function icon(name, size = 14, { cls = '' } = {}) {}"), ['size', 'cls']);
  assert.deepEqual(opts('export const b = ({ size = 10 }) => 1;'), ['size']);
  assert.deepEqual(opts("export function p({ title, mark = '(', tone = '' }) {   // center: { label, to }: the crumb (nav.center-home)\n  return 1; }"), ['tone']);
  assert.deepEqual(opts("export function q({ title, // the name, (one line)\n  tone = '' }) {}"), ['tone']);
  assert.deepEqual(opts('export function c({ label, kind }) {}'), []);
});

test('every look option a library function takes is in the catalog', () => {
  const listed = new Set(catalog().map(key));
  for (const x of scanned()) assert.ok(listed.has(key(x)), `${x.code} takes ${x.option}: a component brings its look (build.default, comp.look-options); a new size, colour or class option is a question for a person`);
});

test('every catalog look option still exists', () => {
  const now = new Set(scanned().map(key));
  for (const x of catalog()) assert.ok(now.has(key(x)), `${x.code} no longer takes ${x.option}: remove its row and lower LOOK_OPTIONS_CEILING`);
});

test('each look option is allowed or deprecated and says why', () => {
  for (const x of catalog()) {
    assert.ok(['allowed', 'deprecated'].includes(x.status), `${key(x)}: status ${x.status}`);
    assert.ok(typeof x.why === 'string' && x.why.trim(), `${key(x)}: no why`);
  }
});

test('the look options only go down (ceiling)', () => {
  const n = catalog().length;
  assert.ok(n <= LOOK_OPTIONS_CEILING, `${n} look options is more than the ceiling ${LOOK_OPTIONS_CEILING}: a new one is a question for a person`);
  assert.equal(n, LOOK_OPTIONS_CEILING, `${n} look options is below the ceiling: lower LOOK_OPTIONS_CEILING to ${n} in this change`);
});
