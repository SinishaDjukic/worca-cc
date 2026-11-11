// test/ui-money-usage.test.mjs — structure: no cost in ui/public prints a dollar of its own (docs/display-currency.md).
// Every figure a person reads as spend goes through ui/public/money.mjs, so changing the display currency changes all
// of them (Tarefa 1, A11). A line that spells `$` is fine when it is the legacy USD branch of fmtCost/fmtMoneyRange,
// a setting kept in USD (usdSetting / isUsd), or a reasoned entry in ALLOW below. Anything else fails here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../ui/public/', import.meta.url));
const SKIP_DIRS = new Set(['vendor', 'node_modules']);

/** A dollar printed by hand: `$${x}`, `'$' + x`, `<$0`, or a literal amount such as '$0.05' / ($0). */
const DOLLAR = [/\$\$\{/, /['"`]\$['"`]\s*\+/, /<\$0/, /['"`(\s]\$\d+(?:\.\d+)?(?=[\s'"`–)/.,]|$)/];
/** The line already routes through money.mjs (its USD text is the legacy branch) or is a USD setting. */
const ROUTED = /\b(fmtCost|fmtMoneyRange|usdSetting|isUsd)\(/;

/** file → [substring on the line, why it is not a cost in the display currency]. */
const ALLOW = {
  'mcp-view.mjs': [['`$${f.state.env}`', 'an environment variable name ($API_KEY), not money']],
  'ask/widgets-input.mjs': [["'$' + item.envDefault", 'an environment variable name, not money']],
  'requirements-view.mjs': [
    ["const READ_RANGE = '$0.05–0.20'", 'the legacy USD text of fmtMoneyRange(0.05, 0.2, READ_RANGE)'],
    ["const ASK_RANGE = '$0.05–0.15'", 'the legacy USD text of fmtMoneyRange(0.05, 0.15, ASK_RANGE)'],
  ],
  'models-view.mjs': [
    ["['free', 'Free ($0)']", 'a model price tier: prices per token stay USD (A10)'],
    ['Blank rates count as $0', 'help text about price-per-token rates, which stay USD (A10)'],
  ],
  'app.js': [['Enter at least $0.01', 'validation of a USD limit input (A10)']],
};

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (!SKIP_DIRS.has(name)) yield* files(p); continue; }
    if (/\.(mjs|js)$/.test(name)) yield p;
  }
}

test('every dollar sign printed in ui/public goes through money.mjs or is a reasoned USD exception', () => {
  const offenders = [];
  const allowUsed = new Set();
  for (const p of files(ROOT)) {
    const rel = relative(ROOT, p).split('\\').join('/');
    if (rel === 'money.mjs') continue;
    readFileSync(p, 'utf8').split('\n').forEach((raw, i) => {
      const line = raw.replace(/\s\/\/\s.*$/, '');   // a trailing comment ("never $0.00") prints nothing
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
      if (/\.replace\(/.test(line) && !/\$\$\{|<\$0/.test(line)) return;   // '$1' back-references
      if (!DOLLAR.some((re) => re.test(line)) || ROUTED.test(line)) return;
      const hit = (ALLOW[rel] || []).find(([s]) => line.includes(s));
      if (hit) { allowUsed.add(`${rel}|${hit[0]}`); return; }
      offenders.push(`${rel}:${i + 1}: ${t.slice(0, 140)}`);
    });
  }
  assert.deepEqual(offenders, [], `format these through ui/public/money.mjs (or add a reasoned ALLOW entry):\n${offenders.join('\n')}`);
  const stale = Object.entries(ALLOW).flatMap(([f, rows]) => rows.map(([s]) => `${f}|${s}`)).filter((k) => !allowUsed.has(k));
  assert.deepEqual(stale, [], 'an ALLOW entry no longer matches any line: remove it');
});

test('the three historic fmtUsd formatters delegate to money.mjs', () => {
  for (const f of ['app.js', 'ask-meter.mjs', 'graph/run-decor.mjs']) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    assert.match(src, /from '\.{1,2}\/money\.mjs'/, `${f} imports money.mjs`);
  }
});
