// test/rail-instructions.test.mjs — the instructions stay on the single plan (plans/rail/implementation-prompt.md).
// Each check is a predicate over text, run on the real files and on a seeded violation, so every failure mode is proven red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const PLAN = 'plans/rail/implementation-prompt.md';
const ENTRY = ['CLAUDE.md', 'AGENTS.md', 'docs/rail/README.md'];
const AGENTS = ['implementer', 'planner', 'plan-refiner', 'plan-reviewer', 'code-reviewer'].map((a) => `.claude/agents/worca-cc-${a}.md`);
const HISTORY = ['wave-1', 'wave-2', 'wave-3', 'waves', 'game-plan', 'gameplan', 'dev-alignment', 'lists-index'];
const HISTORY_LINE = 'History. Superseded by implementation-prompt.md; do not build from it.';

function walk(dir, ok) {
  const out = [];
  for (const n of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${n}`;
    if (rel === 'plans/rail/history' || rel === 'plans/rail/prototype/today') continue;
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...walk(rel, ok)); else if (ok(rel)) out.push(rel);
  }
  return out;
}
const md = (f) => f.endsWith('.md');
const DRIFT_FILES = ['CLAUDE.md', 'AGENTS.md', 'CONTRIBUTING.md', ...walk('docs', md), ...walk('.claude/agents', md), ...walk('plans/rail', (f) => /\.(md|js|css|html)$/.test(f))];
// Rail's own documents: where a "Would…" or "stand-in" line must refuse it or name the mock.
const RAIL_DOCS = ['CLAUDE.md', 'AGENTS.md', 'CONTRIBUTING.md', ...walk('docs/rail', md), ...walk('.claude/agents', md), ...walk('plans/rail', md)];

// ---- the predicates ----
const DRIFT = ["Rail colours on today's pages", 'dev parity', "Rail's skin", 'give the reason it stays'];
const driftHits = (text) => DRIFT.filter((p) => text.toLowerCase().includes(p.toLowerCase()));
const historyLinks = (text) => text.match(/plans\/rail\/history\/|\(history\//g) || [];
const REFUSAL = /\b(never|no|not|without)\b|prototype|demo|mock/i;
const permissiveLines = (text) => text.split('\n').filter((l) => /Would…|Would \w|stand-ins?\b/.test(l) && !REFUSAL.test(l));
const DENY = ['with a clear stand-in', 'keep them visible and off', 'for anything real behind it', 'may say what it would do'];
const denied = (text) => DENY.filter((p) => text.includes(p));
const REQUIREMENTS = [
  'Stillhet (codename Rail) is a new design system under the `rail` flag, opt-in and opt-out.',
  'We build it, and adapt every existing feature to it, **stepping first on the redesign**: the prototype\'s screen is what gets built.',
  'Where something a feature needs is missing in the design, it is created in the design first (the prototype plus a `docs/rail/` rule, catalog entry, component, test and gallery example), then built.',
  '**The design leads.** Dev contributes data, APIs and logic, never its screens or markup.',
  'What the design introduces is developed for real: no "Would…" toasts and no disabled stand-ins in the app.',
];
const SLICES = ['Instructions cleanup plus the flag, opt-in and opt-out', 'The prototype served under the flag', 'The live data layer', 'Chat', 'Tasks and the task page', 'Schedules', 'Workflows', 'Marketplace', 'Projects', 'Insights', 'Requirements', 'Settings', 'Onboarding'];
const missingRequirements = (text) => REQUIREMENTS.filter((r) => !text.includes(r));
const slicesInOrder = (text) => {
  const at = text.indexOf('## The slices'); let from = at;
  if (at < 0) return false;
  for (const [i, name] of SLICES.entries()) {
    const k = text.indexOf(`${i + 1}. ${name}`, from);
    if (k < 0) return false;
    from = k;
  }
  return true;
};
const hasConcept = (text) => /^## The concept/m.test(text);

test('the entry points link to the single plan and to no history file', () => {
  for (const f of ENTRY) { const t = read(f); assert.ok(t.includes('plans/rail/implementation-prompt.md'), f); assert.deepEqual(historyLinks(t), [], f); }
  assert.deepEqual(historyLinks('see plans/rail/history/wave-1.md'), ['plans/rail/history/']);
});

test('none of the four drift phrases appears outside history (no quoting exemption)', () => {
  for (const f of DRIFT_FILES) assert.deepEqual(driftHits(read(f)), [], f);
  for (const p of DRIFT) assert.deepEqual(driftHits(`x ${p.toUpperCase()} y`), [p], 'a seeded phrase is caught');
});

test('a "Would…" or stand-in line refuses it or names the mock; the deny list holds regardless', () => {
  for (const f of RAIL_DOCS) { assert.deepEqual(permissiveLines(read(f)), [], f); assert.deepEqual(denied(read(f)), [], f); }
  assert.equal(permissiveLines('The control says "Would open…" for now.').length, 1);
  assert.equal(permissiveLines('Never ship a "Would…" toast.').length, 0);
  assert.deepEqual(denied('no, with a clear stand-in until then'), ['with a clear stand-in']);
});

test('the single plan holds the five requirements, the 13 slices in order and the concept', () => {
  const t = read(PLAN);
  assert.deepEqual(missingRequirements(t), []);
  assert.ok(slicesInOrder(t));
  assert.ok(hasConcept(t));
  assert.deepEqual(missingRequirements(t.replace(REQUIREMENTS[2], '')), [REQUIREMENTS[2]]);
  assert.equal(slicesInOrder(t.replace('4. Chat', '4. Talk')), false);
  assert.equal(hasConcept(t.replace('## The concept', '## Notion')), false);
});

test('the eight old plans sit in history with the history first line', () => {
  for (const n of HISTORY) {
    assert.ok(existsSync(join(ROOT, `plans/rail/history/${n}.md`)), n);
    assert.equal(read(`plans/rail/history/${n}.md`).split('\n')[0], HISTORY_LINE, n);
    assert.ok(!existsSync(join(ROOT, `plans/rail/${n}.md`)), `${n} is still in plans/rail`);
  }
});

test('nothing outside history names a retired companion file; the wiring map holds the moves and the Opt-in rows', () => {
  const dead = /dev-vs-prototype\.md|compare-pages\.json|rail-retires\.json/;
  const files = [...DRIFT_FILES.filter((f) => !f.endsWith('rail-instructions.test.mjs')), 'package.json'].filter((f) => !f.startsWith('docs/split-by'));
  for (const f of files) assert.doesNotMatch(read(f), dead, f);
  const w = read('plans/rail/stillhet-wiring.md');
  assert.match(w, /\| Dev feature \| New name and place \| Dev data or module reused \| Old address \|/);
  const moves = w.split('## Moves')[1].split('\n\n')[1].split('\n').slice(2).filter((l) => l.startsWith('|'));
  assert.ok(moves.length >= 9, `${moves.length} moves`);
  assert.equal((w.match(/add to the design first/g) || []).length >= 4, true);
  const optin = w.split('## Opt-in')[1];
  assert.match(optin, /\|/);
  assert.doesNotMatch(optin, /Would/);
});

test('each of the five agent definitions carries the brief\'s sentence', () => {
  for (const f of AGENTS) {
    const t = read(f);
    assert.match(t, /Under `rail`, the prototype's screen is the spec: .*read `plans\/rail\/implementation-prompt\.md` first\./, f);
  }
});

test('docs/feature-flags.md lists rail as Stillhet, experimental and off', () => {
  assert.match(read('docs/feature-flags.md'), /\| `rail` \| experimental, default off \| Stillhet/);
});

test('the gate doc names a mode for each comparison and keeps no exemption', () => {
  const g = read('docs/rail/gate.md');
  assert.match(g, /worca-rail\.mode/);
  assert.match(g, /\*\*Mode\.\*\*/);
  assert.doesNotMatch(g, /only pages in|exempt/);
});

test('this guard reads files that exist', () => {
  assert.ok(DRIFT_FILES.length > 20 && relative(ROOT, join(ROOT, PLAN)) === PLAN);
});
