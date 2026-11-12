// test/model-pick-cleaner-single.test.mjs
// One model-pick cleaner: src/shared/graph/role-slots.mjs owns cleanPick, and every other `{ model, effort }`
// pair trim in shipping code is a known look-alike (a validator or a different contract), pinned by an exact
// per-file count so a new cleaner cannot hide next to one. The role-key regex has one home too.
//
// COMMENTS ARE STRIPPED BEFORE MATCHING (as in test/v1-remnants-removed.test.mjs): prose naming `.model.trim()`
// is documentation, not a cleaner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { posix } from './helpers/posix-path.mjs';

const ROOTS = ['src', 'ui'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'vendor', 'stillhet']);   // stillhet: the prototype's code (moved from plans/rail/prototype/, which these dev scans never read); it has its own gates (docs/rail/gate.md)
const OWNER = 'src/shared/graph/role-slots.mjs';

function files() {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir)) {
      if (SKIP_DIRS.has(e)) continue;
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(mjs|js)$/.test(e)) out.push(posix(p));
    }
  };
  for (const r of ROOTS) walk(r);
  return out;
}

/** Blank out line and block comments, preserving line count. */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

// Read and strip each file once; all tests share it.
const SOURCES = new Map(files().map((f) => [f, stripComments(readFileSync(f, 'utf8'))]));

// A model and an effort trimmed within 300 characters of each other: a pick being cleaned.
const PAIR_TRIM = /\.model\.trim\(\)[\s\S]{0,300}?\.effort\.trim\(\)|\.effort\.trim\(\)[\s\S]{0,300}?\.model\.trim\(\)/g;

// The known look-alikes outside role-slots. None is a second cleanPick; routing one through it changes behaviour.
const LOOK_ALIKES = Object.freeze({
  // setStep and setNodeModel validate and throw; cleanNodeSel carries a node's extra keys (fanOut, askQuestions, …).
  'src/core/config.mjs': 3,
  // pickPair returns undefined for "layer absent" (layerValue reads it) and has no bounds.
  'src/core/settings-cascade.mjs': 1,
  // assertModelPairInput throws; normalizeRolePair and normalizeModelPair report errors for the settings API.
  'src/core/settings.mjs': 3,
  // nodeDefaultsError reports a shared workflow's bad node default; it builds no pick.
  'src/core/workflow-share.mjs': 1,
  // sanitizeNodeDefaults keeps a workflow's other node-default keys and has no bounds.
  'src/core/workflows.mjs': 1,
});

test('cleanPick is defined only in src/shared/graph/role-slots.mjs', () => {
  const defs = [...SOURCES].filter(([, src]) => /\b(?:function|const|let|var)\s+cleanPick\b/.test(src)).map(([f]) => f);
  assert.deepEqual(defs, [OWNER]);
});

test('no second model-pick cleaner: pair trims outside role-slots are the known look-alikes', () => {
  const counts = {};
  for (const [f, src] of SOURCES) {
    if (f === OWNER) continue;
    const n = (src.match(PAIR_TRIM) || []).length;
    if (n) counts[f] = n;
  }
  const extra = Object.entries(counts).filter(([f, n]) => n !== LOOK_ALIKES[f]).map(([f, n]) => `${f}: ${n}`);
  assert.deepEqual(counts, { ...LOOK_ALIKES },
    `pair trims outside ${OWNER} changed (${extra.join(', ') || 'a look-alike went away'}). ` +
    `Import cleanPick / pickOrDrop from ${OWNER} instead of trimming model and effort by hand; ` +
    'a validator or a different contract goes into LOOK_ALIKES with its reason.');
});

test('run-overlay role picks are cleaned by role-slots', () => {
  const imports = SOURCES.get('src/core/run-overlay.mjs').split('\n').filter((l) => l.startsWith('import '));
  assert.ok(imports.some((l) => /^import\s*\{[^}]*\bcleanPick\b[^}]*\}\s*from\s*'\.\.\/shared\/graph\/role-slots\.mjs';/.test(l)),
    `src/core/run-overlay.mjs must import cleanPick from ../shared/graph/role-slots.mjs (imports: ${imports.join(' | ')})`);
});

test('one role-key regex', () => {
  const homes = [...SOURCES].filter(([, src]) => src.includes('/^[a-z]{1,24}$/')).map(([f]) => f);
  assert.deepEqual(homes, ['src/shared/graph/role-review-step.mjs']);
});
