// docs/test-offenders.md: the verdict record of the repeat test offenders. Pins its shape and keeps it in step with
// test/quarantine.json (through tools/quarantine.mjs) and test/tiers.json (through tools/test.mjs selectFiles).
// Rows with spec or proof paths (the browser offenders) are accepted by the same rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { entryKind, readQuarantine, quarantinedPaths } from '../tools/quarantine.mjs';
import { selectFiles } from '../tools/test.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RECORD = 'docs/test-offenders.md';
const NODE_OFFENDERS = [
  'test/ui-ask-side-shell.test.mjs',
  'test/api-attribution-audit.test.mjs',
  'test/parity-routes.test.mjs',
  'test/design-film-mp4-real.test.mjs',
  'test/ask-panel-voice.test.mjs',
  'test/ui-ship-words.test.mjs',
];
const BROWSER_OFFENDERS = [
  'e2e/extension/visual.spec.mjs',
  'tools/verify-composer-cdp.mjs',
  'tools/verify-theme-cdp.mjs',
  'tools/verify-feature-page-cdp.mjs',
  'tools/verify-requirements-cdp.mjs',
];
const OFFENDERS = [...NODE_OFFENDERS, ...BROWSER_OFFENDERS];
const VERDICT = /^(deterministic|flaky \(timing\)|flaky \(load\)|environment)(?=$|[\s,;.:])/;
const OUTCOMES = ['green', 'slow tier', 'quarantined'];
const PATH = /(test\/[A-Za-z0-9._-]+\.test\.mjs|e2e\/extension\/[A-Za-z0-9._-]+\.spec\.mjs|tools\/verify-[A-Za-z0-9._-]+-cdp\.mjs)/;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const clean = (cell) => cell.replace(/`/g, '').trim();

/** The body of `## TITLE` up to the next `## ` heading. */
function section(md, title) {
  const m = new RegExp(`^## ${escapeRe(title)}[ \\t]*$`, 'm').exec(md);
  assert.ok(m, `${RECORD}: no "## ${title}" section`);
  const rest = md.slice(m.index + m[0].length);
  const next = /^## /m.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

/** The data rows of every Markdown table in `body` (all `|` lines after the first two; the extra header and
 *  separator lines become unused keys such as `Run` and `---`), each an array of raw cells. */
function tableRows(body) {
  const lines = body.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('|'));
  return lines.slice(2).map((l) => l.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()));
}

/** Read per test, so a missing record fails each case on its own. */
function record() {
  const file = join(ROOT, RECORD);
  assert.ok(existsSync(file), `${RECORD} does not exist`);
  const md = readFileSync(file, 'utf8');
  const verdicts = tableRows(section(md, 'Verdicts')).map((cells, i) => {
    const m = PATH.exec(cells[0] ?? '');
    assert.ok(m, `${RECORD} Verdicts row ${i + 1}: no test, spec or proof path in its File cell "${cells[0]}"`);
    const [, verdict = '', outcome = '', evidence = ''] = cells;
    return { path: m[1], verdict: clean(verdict), outcome: clean(outcome), evidence: clean(evidence) };
  });
  const runs = new Map(tableRows(section(md, 'Evidence runs')).map((cells) => [clean(cells[0] ?? ''), cells.join(' | ')]));
  return { md, verdicts, runs };
}

test('the record lists all 11 audit offenders', () => {
  const { verdicts } = record();
  assert.equal(OFFENDERS.length, 11);
  for (const p of OFFENDERS) {
    const n = verdicts.filter((r) => r.path === p).length;
    assert.equal(n, 1, `${p}: expected exactly one Verdicts row, found ${n}`);
  }
});

test('every row has a known verdict and outcome', () => {
  const { verdicts } = record();
  assert.ok(verdicts.length >= OFFENDERS.length, 'the Verdicts table has too few rows');
  for (const r of verdicts) {
    const first = r.verdict.split(';')[0].trim();
    assert.match(first, VERDICT, `${r.path}: verdict "${r.verdict}" does not start with deterministic, flaky (timing), flaky (load) or environment`);
    assert.ok(OUTCOMES.includes(r.outcome), `${r.path}: outcome "${r.outcome}" is not one of ${OUTCOMES.join(', ')}`);
  }
});

test('every row\'s path exists and is a test, spec or proof', () => {
  const { verdicts } = record();
  for (const r of verdicts) {
    assert.notEqual(entryKind(r.path), null, `${r.path}: not a test file, Playwright spec or CDP proof`);
    assert.ok(existsSync(join(ROOT, r.path)), `${r.path}: no such file`);
  }
});

test('quarantined rows and the quarantine list agree', () => {
  const { verdicts } = record();
  const listed = quarantinedPaths(readQuarantine(ROOT));
  for (const r of verdicts) {
    if (r.outcome === 'quarantined') assert.ok(listed.has(r.path), `${r.path}: outcome quarantined, but not in test/quarantine.json`);
    else assert.ok(!listed.has(r.path), `${r.path}: in test/quarantine.json, but its outcome is "${r.outcome}"`);
  }
});

test('slow-tier rows match test/tiers.json', () => {
  const { verdicts } = record();
  const tiers = JSON.parse(readFileSync(join(ROOT, 'test', 'tiers.json'), 'utf8'));
  for (const r of verdicts.filter((v) => entryKind(v.path) === 'test')) {
    const slow = selectFiles({ all: [r.path], tier: 'slow', tiers }).includes(r.path);
    if (r.outcome === 'slow tier') assert.ok(slow, `${r.path}: outcome slow tier, but test/tiers.json does not put it in the slow tier`);
    else assert.ok(!slow, `${r.path}: in the slow tier of test/tiers.json, but its outcome is "${r.outcome}"`);
  }
});

test('green and slow-tier rows cite 3 loaded runs', () => {
  const { verdicts, runs } = record();
  for (const r of verdicts.filter((v) => v.outcome === 'green' || v.outcome === 'slow tier')) {
    const browser = entryKind(r.path) !== 'test';
    const re = browser ? /\bbrowser-\d+\b/g : /\bfull-\d+\b/g;
    const cited = [...new Set(r.evidence.match(re) ?? [])];
    assert.ok(cited.length >= 3, `${r.path}: cites ${cited.length} loaded runs (${cited.join(', ') || 'none'}), needs 3`);
    for (const id of cited) {
      assert.ok(runs.has(id), `${r.path}: cites ${id}, which has no row under "## Evidence runs"`);
      assert.match(runs.get(id), new RegExp(`${escapeRe(r.path)}=\\d+(\\.\\d+)?s`), `${r.path}: Evidence run ${id} has no ${r.path}=Ns seconds value`);
      if (browser) assert.match(runs.get(id), /\b[0-9a-f]{64}\b/, `${id}: no log sha256`);
      assert.doesNotMatch(runs.get(id), new RegExp(`${escapeRe(r.path)}\`? exit [1-9]`), `${r.path}: cites ${id}, in which it failed (exit non-zero)`);
    }
  }
});

// D5/D6: the spec is decided by its own harness, the 4 computed-style tests, in the rounds browser-4 to browser-6.
test('the spec row is decided by browser-4 to browser-6, never by the whole-file rounds browser-1 to browser-3', () => {
  const { verdicts, runs } = record();
  const spec = verdicts.find((v) => v.path === 'e2e/extension/visual.spec.mjs');
  assert.ok(spec, 'e2e/extension/visual.spec.mjs: no Verdicts row');
  if (spec.outcome === 'green') {
    for (const id of ['browser-4', 'browser-5', 'browser-6']) {
      assert.match(spec.evidence, new RegExp(`\\b${id}\\b`), `spec Evidence "${spec.evidence}" does not cite ${id}`);
      const row = runs.get(id);
      assert.ok(row, `${id}: no row under "## Evidence runs"`);
      assert.match(row, /1\/1 exit 0 \(4 of 4 tests\)/, `${id}: Results is not "1/1 exit 0 (4 of 4 tests)"`);
      assert.match(row, /e2e\/extension\/visual\.spec\.mjs=\d+(\.\d+)?s/, `${id}: no spec seconds value`);
    }
    for (const id of ['browser-1', 'browser-2', 'browser-3']) {
      assert.doesNotMatch(spec.evidence, new RegExp(`\\b${id}\\b`), `spec Evidence cites ${id}, in which the whole file failed`);
    }
  } else {
    assert.equal(spec.outcome, 'quarantined');
    assert.match(spec.evidence, /\bfailed \d+ of 3 loaded\b/);
  }
});

test('the record names the D5 spec harness and the stale darwin baselines', () => {
  const { md } = record();
  assert.match(md, /tokens resolve\|computed styles/, 'the spec harness filter is not written in the record');
  assert.match(md, /\bbrowser-6\b/, 'browser-6 is not mentioned');
  assert.match(md, /darwin/i, 'the stale darwin baselines are not noted');
  assert.match(md, /fd6eb0c3d/, 'the darwin baselines\' last-update commit fd6eb0c3d is not named');
});

test('a spec or proof has no slow tier', () => {
  const { verdicts } = record();
  for (const r of verdicts.filter((v) => entryKind(v.path) !== 'test')) {
    assert.notEqual(r.outcome, 'slow tier', `${r.path}: a spec or proof has no slow tier`);
  }
});

test('each browser offender\'s evidence cites its loaded browser runs', () => {
  const { verdicts } = record();
  for (const p of BROWSER_OFFENDERS) {
    const r = verdicts.find((v) => v.path === p);
    assert.ok(r, `${p}: no Verdicts row`);
    if (r.outcome === 'green') assert.match(r.evidence, /\bbrowser-\d+\b/, `${p}: Evidence "${r.evidence}" cites no loaded browser run`);
    else if (r.outcome === 'quarantined') assert.match(r.evidence, /\bfailed \d+ of 3 loaded\b|\bno local loaded runs\b/, `${p}: Evidence "${r.evidence}" says neither "failed N of 3 loaded" nor "no local loaded runs"`);
  }
});

test('the Post-merge check has a Window column with 5 rows from each slice', () => {
  const { md } = record();
  const body = section(md, 'Post-merge check');
  assert.match(body, /\bWindow\b/);
  assert.equal((body.match(/from slice 5 merge/g) ?? []).length, 5);
  assert.equal((body.match(/from slice 6 merge/g) ?? []).length, 5);
});

// R-qa-5's example: "`test/ui-ask-side-shell.test.mjs`: flaky, timing; failed 3 of 20 loaded runs, 0 of 20 alone".
test('each node offender\'s evidence gives its alone runs and its loaded runs (R-qa-5)', () => {
  const { verdicts } = record();
  for (const p of NODE_OFFENDERS) {
    const r = verdicts.find((v) => v.path === p);
    assert.ok(r, `${p}: no Verdicts row`);
    assert.match(r.evidence, /\b\d+\/\d+ alone\b/, `${p}: Evidence "${r.evidence}" gives no "N/M alone" count`);
    assert.match(r.evidence, /\bfull-\d+\b/, `${p}: Evidence "${r.evidence}" cites no loaded run`);
  }
});
