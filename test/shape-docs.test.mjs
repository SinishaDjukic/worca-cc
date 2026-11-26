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
    'ACCEPTANCE_INCOMPLETE', 'NOT_READY', 'on record for the exact head it would ship', 'nothing of the feature is live, finishing, interrupted or pending', 'It is checked again when you press Ship', 'before each pull request Ship opens and after the changelog commit', 'a re-plan and **Resume** are refused with `SHIPPING`', 'once more when the feature would be recorded as shipped', 'With no check on record, Ship is not ready', 'a new series, round 1', 'its chip reads "Runs"', 'The Requirements page is not changed',
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

test('s5: the marks paragraph names the Runs list member rows and the run page head too, and a done run\'s ship line', () => {
  const para = DOCS['shape-it-first.md'].text().split(/\n\s*\n/).map(flat).find((p) => p.includes('markDot')) || '';
  assert.ok(para, 'the paragraph that names markDot');
  assert.deepEqual(missing(para, [/Chat card/, /Runs tab/, /Runs list/i, /member rows/i, /run page/i, /ship line/i]), []);
});

// Shaper small runs slice 6 (R-po-4): the open stop list on the card.
test('s6: "Open stops on the card" sits under Small runs, after the run words, and says what a line holds up, the order and Resume', () => {
  const small = DOCS['shape-it-first.md'].text();
  const at = small.indexOf('\n### Open stops on the card\n');
  assert.ok(at >= 0, 'the heading "### Open stops on the card" under Small runs');
  assert.ok(at > small.indexOf('\n### The run words\n'), 'after "The run words"');
  const rest = small.slice(at + 1);
  const next = rest.indexOf('\n### ', 1);
  const part = flat(next < 0 ? rest : rest.slice(0, next));
  assert.deepEqual(missing(part, ['holds up', 'in run order', 'Resume']), []);
});

// Shaper small runs slice 7 (R-po-5): the state line and the need-you count, under the stop list part.
test('s7: the stop list part says what the state line names, the need-you count and who must act', () => {
  const small = DOCS['shape-it-first.md'].text();
  const at = small.indexOf('\n### Open stops on the card\n');
  const off = small.indexOf('\n### Off\n');
  assert.ok(at >= 0 && off > at, '"Open stops on the card" comes before "Off"');
  assert.deepEqual(missing(flat(small.slice(at, off)), ['next: run', 'need you', 'Nothing can go on until you act']), []);
});

// Shaper small runs slice 8 (R-ux-2): the link marks, after the marks paragraph and before the stop list part.
test('s8: a paragraph under the run words names the solid and dashed bars, click or Enter to keep, Esc, and that nothing moves', () => {
  const small = DOCS['shape-it-first.md'].text();
  const marks = small.indexOf('markDot');
  const stops = small.indexOf('\n### Open stops on the card\n');
  assert.ok(marks >= 0 && stops > marks, 'the marks paragraph comes before the stop list part');
  const paras = small.slice(marks, stops).split(/\n\s*\n/).slice(1).map(flat);
  const para = paras.find((p) => /dashed/i.test(p) && /solid/i.test(p)) || '';
  assert.ok(para, 'a paragraph of its own that names the solid and the dashed bar');
  assert.deepEqual(missing(para, [/\bsolid\b/i, /\bdashed\b/i, /builds? on/i, /\bclick/i, /\bEnter\b/, /\bEsc\b/, /(?:nothing|no row)[^.]*\bmov/i]), []);
});


// Shaper small runs slice 10 (R-ux-3, R-rel-1): Show order, and the closing check of the whole run-order feature.
/** The part of the Small runs section under `### heading`, up to the next `### ` (flattened), or ''. */
function smallPart(heading) {
  const small = DOCS['shape-it-first.md'].text();
  const at = small.indexOf(`\n### ${heading}\n`);
  if (at < 0) return '';
  const rest = small.slice(at + 1);
  const next = rest.indexOf('\n### ', 1);
  return flat(next < 0 ? rest : rest.slice(0, next));
}

test('s10: a Show order part before Off names the Runs tab, 5 runs, plain chain, closed, the rows for screen readers, and not the Chat card or Runs sidebar', () => {
  const small = DOCS['shape-it-first.md'].text();
  const at = small.indexOf('\n### Show order\n');
  const off = small.indexOf('\n### Off\n');
  assert.ok(at >= 0, 'the heading "### Show order" under Small runs');
  assert.ok(off > at, 'before "Off"');
  const part = smallPart('Show order');
  assert.deepEqual(missing(part, [/Runs tab/, /\b5 runs\b/, /branch/i, /\bjoin/i, /plain chain/i, /\bclosed\b/i, /screen reader/i,
    // what the drawing shows
    /\bmarks?\b/i, /right of/i, /\bholds?\b/i, /\bdot\b/i, /pulse/i]), []);
  const sentences = part.split(/(?<=\.)\s+/);
  assert.ok(sentences.some((s) => /Chat card/.test(s) && /Runs sidebar/i.test(s) && /\b(?:never|not|no)\b/i.test(s)),
    'one sentence says it is not on the Chat card or the Runs sidebar');
});

test('s10: the feature page bullet of "The four places" names Show order on its Runs tab', () => {
  const bullet = smallPart('The four places').split(/ - \*\*/).find((b) => b.startsWith('The feature page**')) || '';
  assert.ok(bullet, 'the feature page bullet');
  assert.deepEqual(missing(bullet, [/Show order[^.]*Runs tab/]), []);
});

test('s10 closing (R-rel-1): Small runs describes next and no word, the open stop list, the link marks and Show order', () => {
  const words = smallPart('The run words');
  assert.deepEqual(missing(words, ['`next`', /next` comes only from/, 'shows no word']), [], 'when a row reads next, and no word');
  assert.deepEqual(missing(smallPart('Open stops on the card'), ['holds up', 'Resume']), [], 'the open stop list');
  assert.ok(words.includes('solid') && words.includes('dashed bar'), 'the link marks');
  assert.ok(smallPart('Show order'), 'the "### Show order" part');
});

// Shaper small runs slice 15 (R-po-6): a run that has not started has no run page; the docs say where its two facts show.
test('s15 (R-po-6): the run page bullet says Waits for and Needed by show on a started run\'s page only, and a not-started run\'s row opens the feature page', () => {
  const bullet = smallPart('The four places').split(/ - \*\*/).find((b) => b.startsWith('The run panel and the Expert run page**')) || '';
  assert.ok(bullet, 'the run panel and run page bullet');
  assert.deepEqual(missing(bullet, [/started run/, /not started/, 'no run page', 'feature page', /point(ing)? at the row/, 'dashed bar']), []);
});

// Shaper small runs slice 16 (R-po-6): the contract's words stay in the run page bullet.
test('S16-T6 (R-po-6): the run page bullet says a run that has not started has no run page, and names Waits for, Needed by and nothing', () => {
  const bullet = smallPart('The four places').split(/ - \*\*/).find((b) => b.startsWith('The run panel and the Expert run page**')) || '';
  assert.ok(bullet, 'the run panel and run page bullet');
  assert.deepEqual(missing(bullet, ['has no run page', 'Waits for', 'Needed by', '`nothing`']), []);
});

// Shaper small runs slice 3 (R-po-2): a run that waited at a stop takes in what finished meanwhile.
test('slice 3: "Work taken in after a wait" follows the clash part and "The flag, read live" names the take-in before an answer', () => {
  const small = DOCS['shape-it-first.md'].text();
  const at = small.indexOf('Work taken in after a wait');
  assert.ok(at >= 0, 'the paragraph "Work taken in after a wait" under Small runs');
  assert.ok(at > small.indexOf('When the runs it builds on clash'), 'after "When the runs it builds on clash"');
  const para = flat(small.slice(at).split(/\n\s*\n/).slice(0, 2).join('\n'));   // a heading and its paragraph, or one paragraph
  assert.deepEqual(missing(para, [/waited at a stop/i, /same base/i, /meanwhile|while it waited/i, '`feat/run-9 moved · run 2 starts from it`',
    /pull request/i, '`after run 3`', /clash/i, /not sent/i, /stays open/i, /nothing moves/i, /settle/i, /answer again/i]), []);
  const live = flat(small).split('**The flag, read live.**')[1]?.split('**A feature with the marker')[0] || '';
  assert.match(live, /waited at a stop takes in every same-base finished run it lacks before its answer goes on/);
});

test('a clash between the runs it builds on: Small runs says a run starts with all of them and how a held run is released', () => {
  const small = DOCS['shape-it-first.md'].text();
  const live = flat(small).split('**The flag, read live.**')[1]?.split('**A feature with the marker')[0] || '';
  assert.match(live, /merges in every run it builds on/, '"The flag, read live" says the start takes in every run it builds on');
  const at = small.indexOf('When the runs it builds on clash');
  assert.ok(at >= 0, 'the paragraph "When the runs it builds on clash"');
  const para = flat(small.slice(at).split(/\n\s*\n/).slice(0, 2).join('\n'));   // a heading and its paragraph, or one paragraph
  assert.deepEqual(missing(para, [/held/i, /clash/i, /settle/i, /branch/i, 'Start now', 'Re-plan the rest', 'Cancel the rest', /restart/i]), []);
});

// Shaper small runs slice 4 (R-ux-3): Ship lists the pull requests along the real branches.
test('slice 4: the Ship part says the PRs follow the real branches, which run gets none, and keeps the finish order for the other case', () => {
  const part = smallPart('Ship');
  assert.ok(part, 'the "### Ship" part');
  assert.deepEqual(missing(part, ['along the real branches', 'gets no pull request of its own', 'in the order the runs finished']), []);
});
