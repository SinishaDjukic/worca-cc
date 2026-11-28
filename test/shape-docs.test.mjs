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
// A namespace read, so a missing new export (findingsReason) fails only its own test.
import * as LEDGER from '../src/shared/shape/ship-ledger.mjs';
import * as VERIFIER from '../src/shared/shape/verifier.mjs';

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
    'ships the whole feature as one PR', 'already has pull request', 'STACKED_ONLY', 'run 1 (the planning run) included', 'in the order the runs finished',
    'ACCEPTANCE_INCOMPLETE', 'NOT_READY', 'on record for the exact head it would ship', 'nothing of the feature is live, finishing, interrupted or pending', 'It is checked again when you press Ship', 'before each pull request Ship opens and after the changelog commit', 'a re-plan, **Resume** and a run\'s own **Create PR** are refused with `SHIPPING`', 'still opening when **One** ships refuses that ship with `HAS_SLICE_PR`', 'once more when the feature would be recorded as shipped', 'With no check on record, Ship is not ready', 'a new series, round 1', 'its chip reads "Runs"', 'The Requirements page is not changed',
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
      'a resumed run first merges the latest finished work', 'on a marked feature, every finished run it lacks, whatever its base, and it records the branch it now builds on as its base',
      'HEAD_MISSING_WORK', "a finished feature's figures are recorded",
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
  // Slice 7: the guide quotes the flag-on words, which a judged ledger (with the runs) gives.
  const ledger = shipLedger({ agreed: [{ id: 'R-comp-4', text: 'The data stays in the EU' }],
    kinds: [{ id: 'R-comp-4', kind: 'confirmed', role: 'compliance' }], runs: [] });
  const care = careRecordLine({ position: 'balanced', chosenBy: 'default', worcaPick: null });
  assert.ok(care.startsWith('Care: '));
  const words = [VERIFY_WORDS.gaps, VERIFY_WORDS.clean, MARK_WORDS.met, MARK_WORDS['not-met'], MARK_WORDS.dropped,
    care, `"${ledger.reason}"`];
  assert.equal(ledger.reason, 'Waiting for you to confirm R-comp-4');
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
  assert.deepEqual(missing(para, [/waited at a stop/i, /paused run is resumed/i, /whatever base that run started from/i, /meanwhile|while it waited/i, '`feat/run-9 moved · run 2 starts from it`',
    /pull request/i, '`after run 3`', /clash/i, /not sent/i, /stays open/i, /nothing moves/i, /settle/i, /answer again/i]), []);
  const live = flat(small).split('**The flag, read live.**')[1]?.split('**A feature with the marker')[0] || '';
  assert.match(live, /waited at a stop takes in every finished run it lacks, whatever its base, before its answer goes on/);
});

// Slice 3 runner rules (R-rel-1): Pause drops a held answer; finished work comes from any base; a clash holds a resume.
test('slice 3 runner rules (R-rel-1): Open stops on the card says Pause drops a held answer', () => {
  const part = smallPart('Open stops on the card');
  assert.ok(part, 'the "### Open stops on the card" part');
  const sentences = part.split(/(?<=\.)\s+/);
  assert.ok(sentences.some((s) => /Pause/.test(s) && /drops? (a|the) held answer/i.test(s)), 'a sentence says Pause drops a held answer');
});

test('slice 3 runner rules (R-rel-1): Work taken in after a wait says "from any base" and that a clashing resume stays paused', () => {
  const small = DOCS['shape-it-first.md'].text();
  const at = small.indexOf('Work taken in after a wait');
  assert.ok(at >= 0, 'the paragraph "Work taken in after a wait" under Small runs');
  const para = flat(small.slice(at).split(/\n\s*\n/).slice(0, 2).join('\n'));
  assert.deepEqual(missing(para, ['from any base', /Resume/, /stays paused/i, /not retried/i]), []);
  assert.ok(!para.includes('goes on without that work'), 'no longer says a resumed run goes on without that work');
  const live = flat(small).split('**The flag, read live.**')[1]?.split('**A feature with the marker')[0] || '';
  assert.match(live, /on a clash it stays paused/i, '"The flag, read live" says a clashing resume stays paused');
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

// One PR for a feature planned in small runs: when One is on, why it is off, what it answers and what the one PR carries.
test('the Ship part says One ships the whole feature as one PR, when it is off and refused, and what the one PR carries', () => {
  const part = smallPart('Ship');
  assert.deepEqual(missing(part, ['ships the whole feature as one PR', 'already has pull request #', 'HEAD_MISSING_WORK', 'STACKED_ONLY',
    'small runs ship a PR per run', 'Satisfies', /\bCare\b/, /carried/i]), []);
  assert.doesNotMatch(flat(read('shape-it-first.md')), /Ship is stacked only|ships stacked only/);
  // The older lines that said a small-runs feature never ships as one PR are gone.
  assert.doesNotMatch(flat(read('shape-it-first.md')), /A small-runs feature opens nothing this way|the feature ships as one PR per run\./);
  assert.doesNotMatch(flat(read('requirements.md')), /Ship is stacked, one PR per run, and/);
});

test('the flag table says Ship offers one PR or stacked PRs, stacked only with the flag off', () => {
  assert.deepEqual(missing(slices['feature-flags.md'], ['Ship offers one PR or stacked PRs; with the flag off it is stacked only']), []);
  assert.doesNotMatch(slices['feature-flags.md'], /Ship is stacked only/);
});

test('design-system.md says where One\'s reason sits, what it names, and that the applied card counts one PR once', () => {
  assert.deepEqual(missing(flat(read('design-system.md')), ['.shipit-prs-one-why', 'Run 2 already has pull request #40 open', '1 PR open']), []);
});

// Shaper small runs slice 6 (R-po-6, R-arch-2): `next` and the delivery of held answers follow one order.
test('slice 6: the run words say next and held answers follow one order', () => {
  assert.deepEqual(missing(smallPart('The run words'), ['the order held answers are delivered in', /lowest run number first/i]), []);
  const live = flat(DOCS['shape-it-first.md'].text()).split('**The flag, read live.**')[1]?.split('**A feature with the marker')[0] || '';
  assert.deepEqual(missing(live, ['held answers go on one at a time, lowest run first']), []);
});

// Shaper small runs slice 7 (R-po-4, R-po-5): a resume waits its turn.
test('slice 7: Held resumes', () => {
  const small = DOCS['shape-it-first.md'].text();
  const part = smallPart('Held resumes');
  assert.ok(part, 'the "### Held resumes" part');
  assert.ok(small.indexOf('\n### Held resumes\n') > small.indexOf('\n### Open stops on the card\n'), 'after "Open stops on the card"');
  assert.deepEqual(missing(part, ['held resume', 'restart', 'paused']), []);
  assert.deepEqual(missing(smallPart('The run words'), [/`next` comes only from the server's turn: an answer or a resume held for its turn first/]), []);
  const live = flat(small).split('**The flag, read live.**')[1]?.split('**A feature with the marker')[0] || '';
  assert.deepEqual(missing(live, ['an answer or a resume held for its turn waits']), []);
});

// Shaper small runs slice 8 (R-ux-1, R-ux-2): the row word and the Resume wording of a held resume.
test('slice 8: Held resumes names the row word and the Resume wording', () => {
  const part = smallPart('Held resumes');
  assert.deepEqual(missing(part, ['after run N', 'Resume after run N']), []);
  for (const gone of ['Until the row wording lands', "a stop line's Resume"]) assert.ok(!part.includes(gone), `no longer says: ${gone}`);
});

// R-ux-4: a stop's findings list shows on every surface where the stop can be answered.
test('R-ux-4: "One card, three hosts" says a small run\'s stop card lists its findings under its question on every surface', () => {
  const para = read('shape-it-first.md').split(/\n\s*\n/).map(flat).find((p) => p.startsWith('**One card, three hosts.**')) || '';
  assert.ok(para, 'the paragraph "One card, three hosts"');
  assert.deepEqual(missing(para, [/small runs on/i, /lists its findings under (?:its|the) question/i, /every surface/i]), []);
});

// Slice 5 (R-po-2): Ship names the carried runs and its button counts the pull requests it will open.
test('Ship guide names carried runs and the new-PR count', () => {
  const part = smallPart('Ship');
  assert.deepEqual(missing(part, ["Run 2's work ships in run 3's pull request (#40 is open)", 'The open pull request is not counted',
    /\bnew (?:PRs?|pull requests?)\b/i, /\bclosed\b/i]), []);
});

test('design system lists .shipit-prs-carried and .ask-shipcard-carried', () => {
  assert.deepEqual(missing(flat(read('design-system.md')), ['.shipit-prs-carried', '.shipit-prs-kept', '.ask-shipcard-carried']), []);
});

// Feature page slice 6 (R-ux-3, R-arch-2): the five tabs, Mark and ship, and the Cost tab with the Verifier.
test('feature page guide: the five tabs in order, the Ship card on Requirements, the step log in Log, and Mark and ship', () => {
  const doc = flat(read('shape-it-first.md'));
  assert.deepEqual(missing(doc, [/Runs, Requirements, Decisions, Cost(?:,| and) Log\b/, 'Mark and ship',
    /Ship card[^.]*(?:top of|first)[^.]*Requirements|Requirements[^.]*Ship card[^.]*(?:top|first)|Ship card[^.]*Requirements[^.]*(?:top|first)/i,
    /step log/i]), []);
});

test('feature page guide: the Cost tab counts each Verifier round once and marks a failed or stopped one', () => {
  const doc = flat(read('shape-it-first.md'));
  assert.deepEqual(missing(doc, [/Cost tab/i, /Verifier (?:rounds?|runs?)[^.]*\bonce\b/i, '· failed', '· stopped']), []);
});

test('design system: the feature page\'s Cost table, Mark and ship, and Log at every level', () => {
  const doc = flat(read('design-system.md'));
  assert.deepEqual(missing(doc, ['Mark and ship', /\.gpage-cost|Cost table/, /\bLog\b[^.]*every (?:UI )?level/i]), []);
});

// Slice 7 (R-ux-1, R-ux-2, R-arch-4): confirm in place.
test('s7: confirm in place in the guide and the design system', () => {
  const guide = flat(read('shape-it-first.md'));
  assert.deepEqual(missing(guide, ['Needs your confirmation: R-ux-2', 'waiting for you to confirm · Design', /requirements\/ship/,
    'on this page.', 'The open pull request is not counted.']), [], 'shape-it-first.md');
  const design = flat(read('design-system.md'));
  assert.deepEqual(missing(design, ['Lock tip', '.rd-tip', '.run-status-link', 'The open pull request is not counted.']), [], 'design-system.md');
  assert.doesNotMatch(`${guide} ${design}`, /#40 is not counted/);
});

// Shaper small runs slice 8 (R-po-3): the gate on the Verifier's gaps.
test('s8 (R-po-3): the Verifier part says it asks from round 1 before any run, with three answers per gap', () => {
  const part = smallPart('Runs stop, change and the Verifier');
  assert.deepEqual(missing(part, ['from round 1', 'Add a fix run', 'Ship with the gap', 'Change the requirement', 'a reason is required']), []);
  assert.doesNotMatch(part, /stops adding runs by itself/, 'the old bound rule is gone');
});

test('s8 (R-po-3): the Ship part names the shipped-gap line', () => {
  assert.deepEqual(missing(smallPart('Ship'), ['ships with a gap']), []);
});

test('s8: design-system.md describes the Gap question after the Open stop list', () => {
  const design = read('design-system.md');
  const at = design.indexOf('\n### Gap question\n');
  assert.ok(at >= 0, 'the heading "### Gap question"');
  assert.ok(at > design.indexOf('\n### Open stop list (checked)\n'), 'after "Open stop list"');
  const rest = design.slice(at + 1);
  const next = rest.indexOf('\n### ', 1);
  assert.deepEqual(missing(flat(next < 0 ? rest : rest.slice(0, next)), ['ui/public/shape/gap-question.mjs']), []);
});


// Shaper small runs slice 9 (R-po-4): findings outside the verdicts need an acknowledgement.
test('s9 (R-po-4): the guide says each note is acknowledged before Ship, never by Away mode, and names the findings key', () => {
  assert.equal(typeof LEDGER.findingsReason, 'function', 'ship-ledger exports findingsReason');
  assert.deepEqual(missing(smallPart('Ship'), [LEDGER.findingsReason(1), 'Acknowledge', 'Away mode never acknowledges']), []);
  assert.deepEqual(missing(smallPart('Runs stop, change and the Verifier'), ['`findings`']), []);
});

test('s9: design-system.md describes the Ship card notes after the Gap question', () => {
  const design = read('design-system.md');
  const at = design.indexOf('\n### Ship card notes\n');
  assert.ok(at >= 0, 'the heading "### Ship card notes"');
  assert.ok(at > design.indexOf('\n### Gap question\n'), 'after "Gap question"');
  const rest = design.slice(at + 1);
  const next = rest.indexOf('\n### ', 1);
  assert.deepEqual(missing(flat(next < 0 ? rest : rest.slice(0, next)), ['ui/public/shape/ship-card.mjs', '.plan-checks.srows.ask-shipcard-notes',
    '.btn.btn-sm', 'Acknowledge', 'acknowledged · 14:02', '.ask-card-err']), []);
});

// Shaper small runs slice 10 (R-po-5, D13): who answers a Verifier gap, and who answered it.
const heldReasons = () => ['judgement', 'scope', 'requirement'].map((k) => VERIFIER.GAP_KIND_WORDS[k].reason);

test('s10 (R-po-5): the Small runs section says both answered-by words and the three hold reasons', () => {
  assert.ok(VERIFIER.ANSWERED_BY_WORDS && VERIFIER.GAP_KIND_WORDS, 'verifier exports ANSWERED_BY_WORDS and GAP_KIND_WORDS');
  assert.deepEqual(missing(slices['shape-it-first.md'], [VERIFIER.ANSWERED_BY_WORDS.away, VERIFIER.ANSWERED_BY_WORDS.you, ...heldReasons()]), []);
});

test('s10 (R-po-5): the Away table has a Verifier gap row', () => {
  const part = section(read('shape-it-first.md'), 'Away mode on a Shaper run');
  assert.ok(part, 'the section "Away mode on a Shaper run"');
  assert.ok(part.split('\n').some((l) => l.startsWith('|') && l.includes('Verifier gap')), 'a table row "Verifier gap"');
});

test('s10: the guide says what /retry and /approve do on a gap stop', () => {
  const doc = read('shape-it-first.md');
  const both = flat(`${section(doc, 'Away mode on a Shaper run')}\n${DOCS['shape-it-first.md'].text()}`);
  assert.deepEqual(missing(both, ['`/retry`', '`/approve`']), []);
});

test('s10: design-system.md Gap question describes the decided rows and the held reason', () => {
  const design = read('design-system.md');
  const rest = design.slice(design.indexOf('\n### Gap question\n') + 1);
  const next = rest.indexOf('\n### ', 1);
  assert.deepEqual(missing(flat(next < 0 ? rest : rest.slice(0, next)), ['decided by Away mode', 'Held for you']), []);
});

// Shaper small runs slice 11 (R-ux-4): Verifier rounds show inside their feature's group.
test('s11 (R-ux-4): the guide\'s Runs list bullet describes the check rows, the group row\'s Verifier line and the title', () => {
  const bullet = smallPart('The four places').split(/ - \*\*/).find((b) => b.startsWith('The Runs list group row**')) || '';
  assert.ok(bullet, 'the Runs list group row bullet');
  assert.deepEqual(missing(bullet, ['Verifier · round 2 · 1 gap', 'check rows', 'Verifier round 2 failed · 1 gap',
    'Verifier · Sign-up · round 2', /Ready to ship[^.]*once/]), []);
});

test('s11: design-system.md\'s "Two row levels" paragraph describes the check row', () => {
  const design = read('design-system.md');
  const at = design.indexOf('\n- Two row levels');
  assert.ok(at >= 0, 'the "Two row levels" paragraph');
  const rest = design.slice(at + 1);
  const next = rest.indexOf('\n- ', 1);
  assert.deepEqual(missing(flat(next < 0 ? rest : rest.slice(0, next)), [/check row/i, '.is-check', '--field', /shield/i,
    'RUN_MARK_DOTS', /checkbox/i, 'Ready to ship']), []);
});

// ---- Slice 12 (R-ux-5): closed stop lines, one step card, the feature page, paused runs, no Answer ------------------
test('S12: Open stops on the card says lines open one step card and the feature page lists them, and a paused run has no line', () => {
  const part = smallPart('Open stops on the card');
  assert.ok(part, 'the "### Open stops on the card" part');
  assert.deepEqual(missing(part, [/closed/i, /one step card/i, /feature page/i, /Runs tab/, /Answer is not shown while lines are listed/]), []);
  const sentences = part.split(/(?<=\.)\s+/);
  assert.ok(sentences.some((s) => /paused/i.test(s) && /\b(?:no (?:stop )?line|not a stop|gets no)\b/i.test(s)), 'a sentence says a paused run has no line');
  assert.doesNotMatch(part, /The bar's Answer goes to the first line/);
});

test('S12: design-system.md\'s Open stop list names both hosts, the closed Row button, the one step card, paused runs and no Answer', () => {
  const design = read('design-system.md');
  const at = design.indexOf('\n### Open stop list (checked)\n');
  assert.ok(at >= 0, 'the heading "### Open stop list (checked)"');
  const rest = design.slice(at + 1);
  const next = rest.indexOf('\n### ', 1);
  const part = flat(next < 0 ? rest : rest.slice(0, next));
  assert.deepEqual(missing(part, ['ui/public/group-page.mjs', 'ui/public/chat/run-card.mjs', /feature page/i, '.row-btn', '`.chat-rc-stop-chev`',
    /closed/i, /(?:one|a single) step card/i, /paused/i, /Answer is not shown/i]), []);
  assert.doesNotMatch(part, /Its only host is the Chat card/);
  assert.doesNotMatch(part, /never show the list(?! on)[^.]*feature page|feature page and the Runs sidebar never show/);
});

// ---- Run order, later runs: links drawn faint once none holds a run back, the row's dot, where a Verifier run stands ---
test('s13: Show order says every link is drawn faint once none holds a run back, a paused or stopped run shows the row\'s dot, and a Verifier run stands right of the run before it', () => {
  const part = smallPart('Show order');
  assert.ok(part, 'the "### Show order" part');
  const sentences = part.split(/(?<=\.)\s+/);
  const says = (...res) => sentences.some((s) => res.every((re) => re.test(s)));
  assert.ok(says(/\bnone\b/i, /\bholds?\b/i, /every link/i, /\bfaint\b/i), 'once none holds a run back, every link is drawn faint');
  assert.ok(says(/\bpaused\b/i, /\bstopped\b/i, /row['’]s dot/i), 'a paused or stopped run shows the row\'s dot');
  assert.ok(says(/\bVerifier\b/, /last run before/i, /right of/i), 'a run the Verifier adds stands right of the last run before it');
  assert.doesNotMatch(part, /already\s+met\b[^.]*\bnot drawn\b/i, 'met links are no longer always left out');
});

test('s13: design-system.md\'s Run order map names .rom-link.is-faint and --line-2', () => {
  const design = read('design-system.md');
  const at = design.indexOf('\n### Run order map (checked)\n');
  assert.ok(at >= 0, 'the heading "### Run order map (checked)"');
  const section = design.slice(at + 1).split(/\n##+ /)[0];
  const row = section.split('\n').find((l) => /^\|[^|\n]*\|\s*`\.rom-link\.is-faint`\s*\|/.test(l)) || '';
  assert.ok(row, 'a table row for `.rom-link.is-faint`');
  assert.deepEqual(missing(row, ['--line-2']), []);
  assert.deepEqual(missing(flat(section), [/row['’]s dot/i]), []);
});

// ---- R-ux-6: pointing at or keeping a row marks its links, and the links follow the mock's routing ------------------
test('Show order says pointing at or keeping a row lights the run and its links and dims the rest, and how links route', () => {
  const part = smallPart('Show order');
  assert.ok(part, 'the "### Show order" part');
  const sentences = part.split(/(?<=\.)\s+/);
  const says = (...res) => sentences.some((s) => res.every((re) => re.test(s)));
  assert.ok(says(/\bpoint(?:ing|s|ed)?\b/i, /\bkeep(?:ing|s)?\b|\bkept\b/i, /\brow\b/i, /\blights?\b|\bmarks?\b/i, /\blinks?\b/i),
    'pointing at or keeping a row lights the run and its links');
  assert.ok(says(/\bdim(?:s|med|ming)?\b/i), 'the other links dim');
  assert.ok(says(/next column/i, /\b(?:one|a single) curve\b/i), 'a link to the next column is one curve');
  assert.ok(says(/\bskips?\b/i, /\blane\b/i, /(?:under|below) (?:its|the) upper row/i), 'a skipping link runs in the lane under its upper row');
  assert.ok(says(/\b7\s?px\b/i, /\bdot\b/i), 'no link passes within 7px of another run\'s dot');
  assert.doesNotMatch(part, /no line passes through another run['’]s dot/i);
});

test('design-system.md\'s Run order map describes the marks and the curved routing', () => {
  const design = read('design-system.md');
  const at = design.indexOf('\n### Run order map (checked)\n');
  assert.ok(at >= 0, 'the heading "### Run order map (checked)"');
  const section = design.slice(at + 1).split(/\n##+ /)[0];
  for (const cls of ['.rom-link.is-lit', '.rom-link.is-dim', '.rom-run.is-lit']) {
    const name = cls.replaceAll('.', '\\.');
    assert.match(section, new RegExp(`^\\|[^|\\n]*\\|\\s*\`${name}(?:::before)?\`\\s*\\|`, 'm'), `a table row for ${cls}`);
  }
  const text = flat(section);
  assert.deepEqual(missing(text, [/above its dot, cent(?:red|ered), on `--bg`/i,
    /the map shows pointing and keeping alike; the rows show which run is kept/i, /\blane\b/i, /\bcurve/i]), []);
  assert.doesNotMatch(text, /straight segments only/i);
  assert.doesNotMatch(text, /never run together/i);
  assert.doesNotMatch(text, /above right of its dot/i);
});

// ---- Slice 15 (R-qa-3, R-po-4): no "small runs" left on screen, and a lone Verifier note is said once ---------------
/** The `### heading` part of design-system.md, up to the next `### ` or `## ` (flattened), or ''. */
function designPart(heading) {
  const design = read('design-system.md');
  const at = design.indexOf(`\n### ${heading}\n`);
  return at < 0 ? '' : flat(design.slice(at + 1).split(/\n##+ /)[0]);
}

test('s15 (R-qa-3): the guide\'s The words paragraph names the Labs title, the new words, the refusals and what stays with the flag off', () => {
  const small = section(read('shape-it-first.md'), 'Small runs (`shaperSmallRuns`)');
  const words = flat(small.split(/\n\s*\n/).find((p) => p.trim().startsWith('**The words.**')) || '');
  assert.ok(words, 'a "**The words.**" paragraph in the Small runs section');
  assert.deepEqual(missing(words, [/["“]small runs["”]/, 'Shaper small runs', 'a chain of runs that each own a few requirements',
    'has no runs that own its requirements', 'the Shaper Labs switch is off', /flag off/i, /One reason/,
    'each run of this feature ships its own pull request']), []);
});

test('s15 (R-po-4): the guide says a note that is all that blocks Ship is said once, in the state line', () => {
  assert.deepEqual(missing(smallPart('Ship'), [
    'When a note is all that blocks Ship, the card says so once, in its state line, and the disabled Ship button is described by that line.']), []);
});

test('s15 (R-qa-3): design-system.md\'s Do and don\'t has the row that keeps "small runs" off the screen', () => {
  const table = section(read('design-system.md'), 'Do and don\'t');
  const row = table.split('\n').find((l) => l.startsWith('|') && l.includes('"small runs"')) || '';
  assert.ok(row, 'a table row naming "small runs"');
  const [, say, dont] = row.split('|');
  assert.deepEqual(missing(say, ['"a chain of runs that each own a few requirements"']), []);
  assert.deepEqual(missing(dont, ['"small runs"', /tooltip/i, /aria label/i]), []);
});

test('s15 (R-po-4): design-system.md\'s Ship card notes says the state line describes Create and no reason line repeats it', () => {
  assert.deepEqual(missing(designPart('Ship card notes'), ['.ask-shipcard-stats', /describes Create/, /no reason line repeats it/i]), []);
});

// ---- Slice 16 (R-qa-4, R-qa-5): held and refused words, row word contrast, and the lane clear of every number ------
const sentencesOf = (part) => part.split(/(?<=\.)\s+/);

test('s16 (R-qa-4): Held resumes names the held words on the group line, in More ways to resume and on Resume, and one text per cause', () => {
  assert.deepEqual(missing(smallPart('Held resumes'), [
    'waiting for its turn', /group line/i, 'More ways to resume', /Waiting for its turn after run (?:N\b|\d)/, /`Waiting for its turn`/,
    /Goes on after run (?:N\b|\d)/, /Run (?:N|\d+) is still saving its work/, /Run (?:N|\d+) holds the turn/, /clash/i,
    'Not resumed: the cost limit is reached', 'not resumed: ',
  ]), []);
});

test('s16: The run words table has a cannot start row and a not resumed row', () => {
  const rows = (section(read('shape-it-first.md'), 'Small runs (`shaperSmallRuns`)').split('\n### The run words\n')[1] || '')
    .split('\n### ')[0].split('\n').filter((l) => l.startsWith('|'));
  assert.ok(rows.some((r) => /cannot start · waits for run (?:3|N) \(was canceled\)/.test(r)), 'a "cannot start · waits for run 3 (was canceled)" row');
  assert.ok(rows.some((r) => /`not resumed: /.test(r)), 'a "not resumed: …" row');
});

test('s16 (R-qa-5): the guide\'s Colour part gives the row words "waiting for you" and "failed" the stronger inks, for 4.5:1 on --bg', () => {
  assert.deepEqual(missing(designPart('Colour (checked)'), ['waiting for you', /\bfailed\b/, '--amber-ink-strong', '--red-ink-strong', /4\.5\s?:\s?1/, '--bg']), []);
});

test('s16: Show order and the guide\'s Run order map say the lane runs in the gap under its upper row, clear of every number', () => {
  for (const [where, part] of [['shape-it-first.md Show order', smallPart('Show order')], ['design-system.md Run order map', designPart('Run order map (checked)')]]) {
    const lane = sentencesOf(part).filter((s) => /\blane\b/i.test(s));
    assert.ok(lane.some((s) => /\bgap\b/i.test(s)), `${where}: the lane runs in the gap`);
    assert.ok(sentencesOf(part).some((s) => /\b(?:lane|link)\b/i.test(s) && /\b(?:clear of|never|no)\b[^.]*\bnumbers?\b/i.test(s)),
      `${where}: no link passes through a number`);
    assert.doesNotMatch(part, /lane midway under its upper row/i, `${where}: the old lane rule is gone`);
  }
});

// Slice 18 (D12): where a chat-less feature's gaps are answered, and what outranks In review.
test('s18 (R-arch-4): the guide says a feature with no chat is answered on its feature page in the Worca UI', () => {
  assert.deepEqual(missing(smallPart('Runs stop, change and the Verifier'), [
    'A feature started without a chat has no feature card', 'answer on its feature page in the Worca UI',
  ]), []);
});

// Slice 19 (R-arch-4): Chat home's Answer on a chat-less feature's Verifier question lands on the feature page too.
test('s19 (R-arch-4): the guide says Answer on a chat-less feature\'s Verifier question opens its feature page', () => {
  assert.deepEqual(missing(flat(read('shape-it-first.md')), ['or on its Verifier\'s question, opens its feature page']), [], 'shape-it-first.md');
});

test('s18: the guide and the design system say a failed Verifier round or an open confirmation outranks In review', () => {
  const guide = flat(DOCS['shape-it-first.md'].text());
  assert.deepEqual(missing(guide, [/failed Verifier round or an open confirmation outranks In review/i]), [], 'shape-it-first.md');
  const design = flat(read('design-system.md'));
  assert.deepEqual(missing(design, [/failed Verifier round or an open confirmation outranks In review/i]), [], 'design-system.md');
});

test('ask screens s2 (R-po-6): Requirements first describes the flag-on card and Settings › Chat "Your role", and keeps the flag-off sentence; Who is asking points there', () => {
  const requirements = flat(section(read('shape-it-first.md'), 'Requirements first'));
  assert.ok(requirements.includes('You lead as'), 'the flag-off sentence stays');
  for (const term of ['shaperSmallRuns', 'Your role', 'Supported by', 'Settings › Chat', 'Shape requirements', 'saved lead, else Product']) {
    assert.ok(requirements.includes(term), `"${term}" in Requirements first`);
  }
  const small = section(read('shape-it-first.md'), 'Small runs (`shaperSmallRuns`)');
  const asking = flat((small.split('\n**Who is asking.**')[1] || '').split('\n### ')[0]);
  assert.ok(asking.includes('(#requirements-first)'), 'the Who is asking paragraph points at the card');
});

// Shaper ask screens, slice 3: the Guide job on Models, and the Guide switch and line in the composer.
test('ask screens s3 (R-arch-3): docs/models.md names the Guide job with its flag, under Helper jobs\' wording', () => {
  const blocks = read('models.md').split(/\n\n+/);
  assert.ok(blocks.some((b) => /\bGuide\b/.test(b) && b.includes('shaperSmallRuns')), 'a paragraph names Guide and shaperSmallRuns together');
  assert.match(read('models.md'), /^\|[^\n]*Helper jobs › Guide\b[^\n]*\|/m, 'a Guide row in the models table');
});

test('ask screens s3: the design system\'s Composer bar part describes the Guide switch and the one Guide line', () => {
  const bar = flat((read('design-system.md').split('\n### Composer bar\n')[1] || '').split(/\n##+ /)[0]);
  assert.deepEqual(missing(bar, ['Guide', '.ask-guide', '.ask-guide-t', 'Sending works as it is.',
    'New: Guide checks your idea for gaps before you send. Switch it off any time.', /ellipsis/i, /never wraps/i, /32px/, /40px/, /coarse/i]), []);
});

// Shaper ask screens, slice 4: what the Guide job is asked and what it returns.
test('slice 4: the Guide paragraph of docs/models.md says what Guide is asked, what it returns and the 8000 limit', () => {
  const doc = read('models.md');
  const at = doc.indexOf('\n*Guide* is ');
  const end = doc.indexOf('\nThe *Requirements interview* helper', at);
  assert.ok(at >= 0 && end > at, 'the Guide paragraph, before the Requirements interview one');
  assert.deepEqual(missing(flat(doc.slice(at, end)), [/\bfive\b|\b5\b/i, /\bcovered\b/i, /\bquestion\b/i, /\bplain\b/i, /\btechnical\b/i,
    /\bsmall\b/i, /\bmedium\b/i, /\blarge\b/i, /\b8,?000\b/]), []);
});

// Shaper ask screens, slice 5: the check in the composer, and its result and size in the Guide line.
const SIZE_PHRASES = ['Prompt 5/5 · Large: several runs', 'Prompt 5/5 · Medium: a few runs', 'Clear enough · Small: one run'];
/** A home-directory path (a mock or scratch folder) never belongs in a doc. */
const HOME_PATH = /(?:^|[\s("'`])(?:~\/|\/Users\/|\/home\/)/;

test('slice 5: the guide\'s Guide checks paragraph, after Who is asking, says when the check runs, what the line reads and the size words', () => {
  const small = section(read('shape-it-first.md'), 'Small runs (`shaperSmallRuns`)');
  const paragraphs = small.split(/\n\s*\n/).map((p) => p.trim());
  const at = paragraphs.findIndex((p) => p.startsWith('**Guide checks.**'));
  assert.ok(at >= 0, 'a "**Guide checks.**" paragraph in the Small runs section');
  assert.ok(at > paragraphs.findIndex((p) => p.startsWith('**Who is asking.**')), 'after **Who is asking.**');
  const text = flat(paragraphs[at]);
  assert.deepEqual(missing(text, ['2 seconds', '12 characters', 'Checking your prompt…', 'checking…', 'Prompt 2/5 · 3 gaps',
    ...SIZE_PHRASES, /never on send/i, /dropped/i]), []);
  assert.doesNotMatch(text, /small runs/i);
  assert.doesNotMatch(text, HOME_PATH);
});

test('slice 5: chat-home\'s Ask worca beside the page says the docked composer checks and sizes under the same pin rule', () => {
  const beside = section(read('chat-home.md'), 'Ask worca beside the page');
  const bullet = flat(beside.split(/\n(?=- |\n|## )/).find((b) => b.startsWith('- **Guide.**')) || '');
  assert.ok(bullet, 'a "- **Guide.**" bullet');
  assert.deepEqual(missing(bullet, ['Guide', 'Shaper pin', '2 seconds', 'Clear enough · Small: one run']), []);
  assert.doesNotMatch(bullet, /small runs/i);
  assert.doesNotMatch(bullet, HOME_PATH);
});

test('slice 5: the design system\'s Composer bar part describes the result fold, and that the size words give way first', () => {
  const bar = designPart('Composer bar');
  assert.deepEqual(missing(bar, ['.ask-guide-fold', /give way first/i]), []);
  assert.doesNotMatch(bar, HOME_PATH);
});

// Shaper ask screens, slice 6: what the Guide line says when a check fails, and the one announcement.
test('slice 6: Guide checks names both failure lines and their actions, and the once-per-result announcement', () => {
  const failures = ['Guide is not answering right now.', 'Try again', 'Guide has no model to run on.', 'Open Models'];
  const small = section(read('shape-it-first.md'), 'Small runs (`shaperSmallRuns`)');
  const checks = flat(small.split(/\n\s*\n/).map((p) => p.trim()).find((p) => p.startsWith('**Guide checks.**')) || '');
  assert.deepEqual(missing(checks, [...failures, /announced once/i]), []);
  assert.doesNotMatch(checks, /leaves the line empty/);
  assert.doesNotMatch(checks, HOME_PATH);
  const bar = designPart('Composer bar');
  // `.btn.btn-sm.btn-quiet` is the failure action's own spelling: the part already names the role picker's button.
  assert.deepEqual(missing(bar, ['Guide is not answering right now.', 'Guide has no model to run on.', '.btn.btn-sm.btn-quiet']), []);
  assert.doesNotMatch(bar, HOME_PATH);
});
