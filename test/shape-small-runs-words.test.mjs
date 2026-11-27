// test/shape-small-runs-words.test.mjs — the words "small runs" still in the product. A literal scan over src/ and ui/
// (the pattern of test/ui-ship-words.test.mjs: string literals outside comments) lists every literal holding whitespace
// that says "small runs" or "small-runs". The one named exception is the Labs title; the keys that match a stored
// record's old reason are data (and, with the flag off, the words kept as before); everything else is listed in KNOWN
// until it is reworded, and KNOWN only shrinks. A bare hyphenated token (`small-runs` alone) is not read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { FLAGS } from '../src/shared/flags/registry.mjs';
// A namespace read, so a missing new export (LEGACY_OUTCOME_REASONS) fails only the tests that need it.
import * as PR_AUTO from '../src/shared/pr-auto.mjs';
import { groupShipChoice } from '../ui/public/ship-group-dialog.mjs';
import { requirementStatus } from '../src/shared/shape/req-status.mjs';
import { groupShipLine } from '../ui/public/run-status-card.mjs';
import { groupModel } from '../src/shared/run-model.mjs';
// A namespace read: the carried-run words are new exports.
import * as LEDGER from '../src/shared/shape/ship-ledger.mjs';
import * as VERIFIER from '../src/shared/shape/verifier.mjs';
import { flagRowsHtml } from '../ui/public/flags-view.mjs';

const EXCEPTION = 'Shaper small runs';   // the Labs entry's title
const OLD_REASON = 'small runs ship a PR per run';

const noComments = (s) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).map((l) => l.replace(/\s\/\/.*$/, '')).join('\n');
const literals = (src) => src.match(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g) || [];
const walkFrom = (root, dir = '') => readdirSync(new URL(`../${root}/${dir}`, import.meta.url), { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? (e.name === 'vendor' ? [] : walkFrom(root, `${dir}${e.name}/`)) : /\.(mjs|js)$/.test(e.name) ? [`${root}/${dir}${e.name}`] : []);
const readRepo = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

/** The literals of `src` (without their quotes) that hold whitespace and say small runs; an `is-small-runs` class token is not words. */
const hits = (src) => literals(noComments(src).replace(/\/\*[\s\S]*?\*\//g, '')).map((lit) => lit.slice(1, -1))
  .filter((text) => /\s/.test(text) && /small[ -]runs/i.test(text.replace(/(^|\s)is-small-runs(?=\s|$)/g, '$1')));
const FOUND = ['src', 'ui'].flatMap((root) => walkFrom(root)).sort()
  .flatMap((file) => hits(readRepo(file)).map((text) => ({ file, text })));

/** Each entry is a literal's file and its first 60 characters. */
const head = ({ file, text }) => ({ file, text: text.slice(0, 60) });
const KNOWN = [];
const byPlace = (a, b) => `${a.file}\n${a.text}`.localeCompare(`${b.file}\n${b.text}`);
const legacyKeys = () => Object.keys(PR_AUTO.LEGACY_OUTCOME_REASONS || {});
/** What of `found` is neither the Labs title nor a legacy record key. */
const leftOver = (found) => {
  const legacy = new Set(legacyKeys());
  return found.filter(({ text }) => text !== EXCEPTION && !legacy.has(text)).map(head);
};
/** The Labs row of `flag` as Settings draws it: the pieces of its text, titles and aria labels that say small runs
 *  once the Labs title itself is taken out. Empty means clean. */
const labsLeaks = (flag) => {
  const markup = flagRowsHtml([{ ...flag, on: false, locked: false, docsUrl: null }]);
  const named = [...markup.matchAll(/\s(?:title|aria-label)="([^"]*)"/g)].map((m) => m[1]);
  return [...markup.split(/<[^>]*>/), ...named].map((piece) => piece.replaceAll(EXCEPTION, ''))
    .filter((piece) => /small[ -]runs/i.test(piece));
};
const labsFlag = () => FLAGS.find((f) => f.key === 'shaperSmallRuns');

test('the scan reads literals, not comments or bare tokens (mutation check)', () => {
  assert.deepEqual(hits("const a = 'small runs ship a PR per run';"), [OLD_REASON]);
  assert.deepEqual(hits('el.title = `a small-runs feature ${x}`;'), ['a small-runs feature ${x}']);
  assert.deepEqual(hits("// a 'small runs' note\n/* 'small runs here' */\nimport x from './small-runs.mjs';\nconst k = 'small-runs';"), []);
  assert.deepEqual(hits("h('div', `ask-card is-${p} is-small-runs`)"), [], 'a class token is not words');
});

test('every small-runs literal is the Labs title, a legacy record key or a known one', () => {
  assert.deepEqual(leftOver(FOUND).sort(byPlace), [...KNOWN].sort(byPlace));
});

// ── R-qa-3: the Labs entry ────────────────────────────────────────────────────────────────────────────────────
const LABS_DESCRIPTION = 'Shaper builds a feature as a chain of runs that each own a few requirements, checked as a whole by a Verifier and shipped as one PR or as stacked PRs. Features with no marker also start from the latest finished work. Off: runs follow the linear chain, and a feature started with it on keeps its card, Care and stacked Ship, but no Verifier check starts.';

test('the Labs entry says small runs only in its title', () => {
  const flag = labsFlag();
  const markup = flagRowsHtml([{ ...flag, on: false, locked: false, docsUrl: null }]);
  assert.ok(markup.includes(`aria-label="${EXCEPTION}"`), 'the switch is named by the title');
  assert.deepEqual(labsLeaks(flag), []);
  assert.doesNotMatch(flag.description, /small[ -]runs/i);
  assert.equal(flag.description, LABS_DESCRIPTION);
});

test('a Labs description that says small runs fails (mutation check)', () => {
  const doctored = 'Shaper builds a feature as small runs.';
  assert.equal(labsLeaks({ ...labsFlag(), description: doctored }).length, 1, 'the rendered row');
  const registry = readRepo('src/shared/flags/registry.mjs');
  const source = registry.replace(/(key: 'shaperSmallRuns',[\s\S]*?description: )("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`[^`]*`)/,
    (all, before) => `${before}'${doctored}'`);
  assert.notEqual(source, registry, 'the description literal was replaced');
  assert.deepEqual(leftOver(hits(source).map((text) => ({ file: 'src/shared/flags/registry.mjs', text }))),
    [{ file: 'src/shared/flags/registry.mjs', text: doctored }]);
});

test('the One reason is gone from every flag-on word; it stays only as the legacy constant the flag-off paths share', () => {
  assert.deepEqual(FOUND.filter(({ text }) => text === OLD_REASON).map(({ file }) => file), ['src/shared/shape/ship-ledger.mjs'],
    'the old reason stays only as the key that maps a stored record');
  assert.deepEqual(legacyKeys(), [OLD_REASON]);
  assert.equal(KNOWN.some(({ text }) => text === OLD_REASON), false);
  const url = 'https://github.com/me/repo/pull/40';
  for (const oneOk of [true, false]) {
    for (const pr of [null, { url, number: 40, state: 'OPEN' }]) {
      const members = [{ position: 1, pr: null }, { position: 2, pr }];
      const { oneOff } = groupShipChoice({ kind: 'feature', members, all: members, smallRuns: true, oneOk });
      // With the flag off, nothing changes for a small-runs feature, wording included (owner direction).
      if (oneOk) assert.doesNotMatch(oneOff, /small[ -]runs/i, `oneOk ${oneOk}, pr ${!!pr}`);
      else assert.equal(oneOff, OLD_REASON, `flag off, pr ${!!pr}: the words as before`);
    }
  }
});

test('the exception is the Labs title', () => {
  assert.equal(FLAGS.find((f) => f.key === 'shaperSmallRuns').title, EXCEPTION);
  assert.deepEqual(FOUND.filter(({ text }) => text === EXCEPTION).map(({ file }) => file), ['src/shared/flags/registry.mjs']);
});

test('the Labs description says a feature ships as one PR or as stacked PRs, and keeps what Off does', () => {
  const { description } = FLAGS.find((f) => f.key === 'shaperSmallRuns');
  assert.ok(description.includes('shipped as one PR or as stacked PRs'), description);
  assert.doesNotMatch(description, /shipped as one stacked PR per run/);
  assert.ok(description.includes('stacked Ship'), 'with the flag off, Ship stays stacked');
});

test('the carried-run and not-counted words say no small runs', () => {
  const url = (n) => `https://github.com/me/repo/pull/${n}`;
  const open = (n) => ({ url: url(n), number: n, state: 'OPEN' });
  const words = [
    LEDGER.carriedLine({ index: 2, by: 3, pr: open(40) }),
    LEDGER.carriedLine({ index: 2, by: 3, pr: { url: 'created:2', state: 'OPEN' } }),
    LEDGER.carriedLine({ index: 2, by: 3, pr: null }),
    LEDGER.keptOpenNote([{ index: 2, pr: open(40) }]),
    LEDGER.keptOpenNote([{ index: 2, pr: open(40) }, { index: 4, pr: open(41) }]),
  ];
  assert.ok(words.every((w) => typeof w === 'string' && /\s/.test(w)), JSON.stringify(words));
  assert.deepEqual(words.flatMap((w) => hits(JSON.stringify(w))), []);
});

// ── Slice 7 (D15): confirm in place's new texts ───────────────────────────────────────────────────────────────
test('s7: the confirm-in-place texts say no small runs', () => {
  assert.equal(typeof LEDGER.confirmHold, 'function', 'ship-ledger exports confirmHold');
  const ledger = LEDGER.shipLedger({ agreed: [{ id: 'R-ux-2', text: 'x' }], kinds: [{ id: 'R-ux-2', kind: 'confirmed', role: 'design' }], runs: [] });
  const done = { status: 'done', endReached: true };
  const model = groupModel({ kind: 'feature', title: 'F', members: [done, { status: 'running' }] });
  const line = groupShipLine({ kind: 'chain', groupKind: 'feature', model, members: model.members.map((m, i) => ({ position: i + 1, model: m })) }, { hasChat: false });
  const url = (n) => `https://github.com/me/repo/pull/${n}`;
  const refusal = literals(readRepo('src/core/shape/verifier.mjs')).filter((l) => l.includes('Ship stopped'));
  assert.equal(refusal.length, 1, 'the Verifier\'s Ship refusal');
  assert.match(refusal[0], /Resume on the feature page/);
  const words = [requirementStatus(ledger.confirmed[0]).text, ledger.reason, LEDGER.confirmHold(ledger), line,
    LEDGER.keptOpenNote([{ index: 2, pr: { url: url(40), number: 40, state: 'OPEN' } }]), ...refusal];
  assert.ok(words.every((w) => typeof w === 'string' && /\s/.test(w)), JSON.stringify(words));
  assert.ok(line.endsWith('on this page.'), line);
  assert.deepEqual(words.flatMap((w) => hits(JSON.stringify(w))), []);
});

test('s7: no waiting row reads confirmed by a person', () => {
  for (const role of ['Product', 'Design', 'Engineering', 'QA', 'Security', 'Compliance']) {
    const row = requirementStatus({ id: 'R-x-1', roleLabel: role, state: 'waiting', mark: null, reason: null });
    assert.doesNotMatch(`${row.word} ${row.text}`, /confirmed by a person/, role);
    assert.equal(row.text, `waiting for you to confirm · ${role}`);
  }
});

/** The files whose literals may still say `confirmed by a person`: the coverage rule's words (a requirement's kind),
 *  the one-card proposal, the flag-off Ship card note (noteOf's fallback) and the ledger row's owner key. */
const SAYS_BY_A_PERSON = ['src/shared/shape/feature-record.mjs', 'src/shared/shape/req-status.mjs', 'src/shared/shape/slices.mjs',
  'ui/public/shape/proposal.mjs', 'ui/public/shape/ship-card.mjs'];
test('s7: confirmed by a person stays only in the rule words, the owner key and the flag-off fallback', () => {
  const said = ['src', 'ui'].flatMap((root) => walkFrom(root)).sort().flatMap((file) =>
    literals(noComments(readRepo(file)).replace(/\/\*[\s\S]*?\*\//g, '')).filter((l) => /confirmed by a person/i.test(l)).map((text) => ({ file, text })));
  assert.deepEqual(said.filter(({ file }) => !SAYS_BY_A_PERSON.includes(file)), []);
  // In the status function it is only the row's owner key, never words a waiting row shows.
  assert.deepEqual(said.filter(({ file }) => file === 'src/shared/shape/req-status.mjs').map(({ text }) => text.slice(1, -1))
    .filter((t) => t !== 'confirmed by a person'), []);
});

// ── Slice 8 (D15): the Verifier gate's new texts ──────────────────────────────────────────────────────────────
test('s8: the gap gate\'s texts say no small runs', () => {
  assert.ok(Array.isArray(VERIFIER.GAP_ANSWERS), 'verifier.mjs exports GAP_ANSWERS');
  assert.equal(typeof LEDGER.shippedGapLine, 'function', 'ship-ledger exports shippedGapLine');
  const gaps = [{ id: 'R-po-2', why: 'x' }, { id: 'R-ux-1', why: 'y' }];
  const texts = { 'R-po-2': 'People export', 'R-ux-1': 'The list is dense' };
  const stops = [1, 2].map((round) => VERIFIER.verifyStop({ gaps, round, fixCycles: 2, texts }));
  const decide = (...answers) => ({ decision: 'answer', answers });
  const FIX = { id: 'R-ux-1', answer: 'fix' };
  const refusals = [
    { decision: 'another' }, decide(), decide({ id: 'R-x-1', answer: 'fix' }),
    decide({ id: 'R-po-2', answer: 'ship' }, FIX), decide({ id: 'R-po-2', answer: 'change', text: '' }, FIX),
    decide({ id: 'R-po-2', answer: 'change', text: 'People export' }, FIX),
  ].map((raw) => VERIFIER.verifyGateAnswer(stops[0], raw).error);
  const words = [...VERIFIER.GAP_ANSWERS.flatMap((a) => [a.label, a.sub]), ...stops.flatMap((s) => [s.head, s.text, ...s.options.flatMap((o) => [o.label, o.sub])]),
    ...refusals, LEDGER.shippedGapLine({ id: 'R-po-2', reason: 'covered by a later feature' }), LEDGER.shippedGapLine({ id: 'R-po-2' })];
  assert.ok(words.every((w) => typeof w === 'string' && /\s/.test(w)), JSON.stringify(words));
  assert.deepEqual(words.flatMap((w) => hits(JSON.stringify(w))), []);
});

