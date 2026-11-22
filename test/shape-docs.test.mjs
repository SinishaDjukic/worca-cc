// test/shape-docs.test.mjs — Shaper small runs D4: the docs say what was built. Each doc is sliced to its new text
// (docs/shape-it-first.md's "Small runs" section, docs/requirements.md's "Shaper's requirements (small runs)" section,
// docs/feature-flags.md's shaperSmallRuns row), so removing the new text fails a check here even if an older section
// names the same term. The quoted state words are built from the code that produces them, never typed here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FLAGS } from '../src/shared/flags/registry.mjs';
import { VERIFY_WORDS } from '../src/shared/shape/verifier.mjs';
import { MARK_WORDS, shipLedger } from '../src/shared/shape/ship-ledger.mjs';
import { careRecordLine } from '../src/shared/shape/feature-record.mjs';

const read = (name) => readFileSync(new URL(`../docs/${name}`, import.meta.url), 'utf8');
const flat = (t) => t.replace(/\s+/g, ' ');
/** A `## heading` section up to the next `## ` (or the end). */
function section(text, heading) {
  const at = text.indexOf(`\n## ${heading}\n`);
  if (at < 0) return '';
  const rest = text.slice(at + 1);
  const next = rest.indexOf('\n## ', 1);
  return next < 0 ? rest : rest.slice(0, next);
}
const DOCS = {
  'shape-it-first.md': { heading: 'section "Small runs (`shaperSmallRuns`)"', text: () => section(read('shape-it-first.md'), 'Small runs (`shaperSmallRuns`)') },
  'requirements.md': { heading: 'section "Shaper\'s requirements (small runs)"', text: () => section(read('requirements.md'), "Shaper's requirements (small runs)") },
  'feature-flags.md': { heading: 'the `shaperSmallRuns` table row', text: () => read('feature-flags.md').split('\n').find((l) => l.startsWith('| `shaperSmallRuns` |')) || '' },
};
const slices = Object.fromEntries(Object.entries(DOCS).map(([name, d]) => {
  const t = d.text();
  assert.ok(t.trim(), `${name}: no ${d.heading} found`);
  return [name, flat(t)];
}));
const missing = (text, terms) => terms.filter((t) => (t instanceof RegExp ? !t.test(text) : !text.includes(t))).map(String);

test('each doc\'s new text names shaperSmallRuns, stacked Ship, ACCEPTANCE_INCOMPLETE and confirmed by a person, and the four places', () => {
  const out = [];
  for (const [name, text] of Object.entries(slices)) {
    const gone = missing(text, ['shaperSmallRuns', /stacked/i, 'ACCEPTANCE_INCOMPLETE', 'confirmed by a person',
      /group row/i, /run panel/i, /run page/i, /feature page/i]);
    if (gone.length) out.push(`${name}: ${gone.join(', ')}`);
  }
  assert.deepEqual(out, []);
});

test('shape-it-first\'s new section states Care is fixed after Start, the three marks with the reason rule, run 1 included, finish order, the Runs chip, and that the Requirements page is not changed', () => {
  const gone = missing(slices['shape-it-first.md'], [
    'Care is fixed after Start', 'pausing and resuming keep it',
    'Met, Not met or Dropped', 'Not met and Dropped need a one-line reason of at most 300 characters', 'Only Met counts as met',
    'Ship is stacked only', 'STACKED_ONLY', 'run 1 (the planning run) included', 'in the order the runs finished',
    'ACCEPTANCE_INCOMPLETE', 'NOT_READY', 'on record for the exact head it would ship', 'nothing of the feature is live, finishing, interrupted or pending', 'It is checked again when you press Ship', 'With no check on record, Ship is not ready', 'a new series, round 1', 'its chip reads "Runs"', 'The Requirements page is not changed',
    'Start', 'Requirements', 'Prototype', 'Ship', '**Build**', '**Verifier**',
    'Worca does not check that the person marking holds it', 'ship with the gap']);
  assert.deepEqual(gone.map((t) => `shape-it-first.md: ${t}`), []);
});

// One phrase per fact, so the Off text cannot go back to "works as before": the parts that read the marker stay with the
// flag off, the parts that read the live flag also act on an unmarked feature (src/core/shape/chain.mjs, verifier.mjs).
test('each doc\'s new text says what off means: the marker\'s parts stay, the live flag\'s parts stop, unmarked features included', () => {
  const FACTS = {
    'shape-it-first.md': [
      'also for a feature with no marker', 'waits only for the runs it builds on', "starts from the feature's latest finished run",
      'a resumed run first merges the latest finished work', 'HEAD_MISSING_WORK', "a finished feature's figures are recorded",
      'keeps its one card, its Care and the Care row on its Ship card, its run stops, the stacked-only Ship and the marks that block it',
      'no Verifier check starts', 'a stopped or failed check offers none', 'ten minutes after', 'never while Worca is still committing', 'Ship opens with no Verifier check', 'A check already open, or with a gap, keeps Ship at `NOT_READY`',
      'continue by the linear chain', 'is not checked, so ship it as one PR per run', 'no figures are recorded, figures already',
      "the last run's branch of an unmarked feature", 'a run still opens its own PR when it finishes',
      'its **Resume** starts a fresh check', 'the Agents tab and Overview stay as today'],
    'requirements.md': ['With the flag off', 'no Verifier check starts'],
    'feature-flags.md': [
      'also for a feature with no marker', 'waits only for the runs it builds on', "starts from the feature's latest finished run",
      'a resumed run first merges the latest finished work', 'HEAD_MISSING_WORK', 'stacked-only Ship', 'no Verifier check starts',
      'continue by the linear chain', 'is not checked, so ship it as one PR per run', 'no figures are recorded',
      "the last run's branch of an unmarked feature", 'needs **Resume** once it is on again'],
  };
  const out = [];
  for (const [name, facts] of Object.entries(FACTS)) {
    const gone = missing(slices[name], facts);
    if (gone.length) out.push(`${name}: ${gone.join(' | ')}`);
    if (/(also )?(behaves|works) as before/i.test(slices[name])) out.push(`${name}: says "as before"`);
  }
  const description = FLAGS.find((f) => f.key === 'shaperSmallRuns').description;
  const gone = missing(description, ['no marker', 'no Verifier check starts', 'linear chain']);
  if (gone.length) out.push(`registry: ${gone.join(' | ')}`);
  if (/keeps its small runs|as before/.test(description)) out.push('registry: "keeps its small runs" or "as before"');
  assert.deepEqual(out, []);
});

test('each quoted state word equals its export\'s output', () => {
  const ledger = shipLedger({ agreed: [{ id: 'R-comp-4', text: 'The data stays in the EU' }],
    kinds: [{ id: 'R-comp-4', kind: 'confirmed', role: 'compliance' }] });
  const care = careRecordLine({ position: 'balanced', chosenBy: 'default', worcaPick: null });
  assert.ok(care.startsWith('Care: '));
  const words = [VERIFY_WORDS.gaps, VERIFY_WORDS.clean, MARK_WORDS.met, MARK_WORDS['not-met'], MARK_WORDS.dropped,
    care, `"${ledger.reason}"`];
  assert.equal(ledger.reason, 'Waiting for Compliance to confirm R-comp-4');
  const gone = words.filter((w) => !slices['shape-it-first.md'].includes(w));
  assert.deepEqual(gone.map((w) => `shape-it-first.md: ${w}`), []);
  assert.ok(slices['shape-it-first.md'].includes(`reads "${VERIFY_WORDS.gaps}"`) && slices['shape-it-first.md'].includes(`reads "${VERIFY_WORDS.clean}"`),
    'the Verifier words are quoted as the card shows them');
});

test('no flag owner handle from the registry appears in the three docs', () => {
  const owners = [...new Set(FLAGS.map((f) => f.owner).filter(Boolean))];
  assert.ok(owners.length > 0);
  const hits = [];
  for (const name of Object.keys(DOCS)) {
    const text = read(name);
    for (const o of owners) if (text.toLowerCase().includes(o.toLowerCase())) hits.push(`${name}: ${o}`);
  }
  assert.deepEqual(hits, []);
});
