// test/required-checks.test.mjs
// docs/required-checks.md: the admin checklist that makes dev require the CI gate, parity and Firefox e2e.
// A required check is matched by its job name, so a renamed job would leave dev waiting for a check that never
// reports. The "Required checks" table is the one place the page cites the names; this file pins each cited name
// to its workflow job, and pins the page's steps. The helpers are pure and exported by this file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import YAML from 'yaml';

const ROOT = new URL('..', import.meta.url);
const PAGE = 'docs/required-checks.md';
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const clean = (cell) => cell.replace(/`/g, '').trim();
const cellsOf = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

/** The body of `## TITLE` up to the next `## ` heading; '' when the heading is missing. */
function section(md, title) {
  const m = new RegExp(`^## ${escapeRe(title)}[ \\t]*$`, 'm').exec(md);
  if (!m) return '';
  const rest = md.slice(m.index + m[0].length);
  const next = /^## /m.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

/** The data rows of the Markdown table in `body` (all `|` lines after the first two), each an array of raw cells. */
function tableRows(body) {
  return body.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('|')).slice(2).map(cellsOf);
}

/** The data rows of the one table in `body` whose header cells are `head`. */
function tableWithHead(body, head) {
  const blocks = body.match(/(?:^[ \t]*\|.*(?:\n|$))+/gm) || [];
  const found = blocks.filter((b) => cellsOf(b.split('\n')[0]).map(clean).join('|') === head.join('|'));
  assert.equal(found.length, 1, `${PAGE}: expected one table with the columns ${head.join(', ')}, found ${found.length}`);
  return tableRows(found[0]);
}

/** The rows of the table under `## Required checks`. */
export function citedChecks(markdown) {
  return tableRows(section(markdown, 'Required checks'))
    .map(([check = '', workflow = '', jobId = '']) => ({ check: clean(check), workflow: clean(workflow), jobId: clean(jobId) }));
}

/** One problem per cited row that the workflows (keyed by basename) would never report; each starts with the name. */
export function checkNameProblems(cited, docsByFile) {
  const problems = [];
  for (const { check, workflow, jobId } of cited) {
    const file = basename(workflow);
    const doc = docsByFile[file];
    if (!doc) {
      problems.push(`"${check}" (${file}): ${PAGE} cites it in ${file}, but ${file} does not exist`);
      continue;
    }
    const at = `"${check}" (${file} job ${jobId})`;
    const job = doc.jobs?.[jobId];
    if (!job) {
      problems.push(`${at}: ${PAGE} cites it, but ${file} has no job ${jobId}`);
      continue;
    }
    const name = String(job.name ?? jobId);
    if (name.includes('${{')) problems.push(`${at}: ${PAGE} cites it, but that job's name is an expression, so its check name changes per run`);
    else if (name !== check) problems.push(`${at}: ${PAGE} cites it, but that job is named "${name}". A branch rule requiring "${check}" would wait forever: rename the job back, or change the checklist and the branch rule together`);
  }
  return problems;
}

const WORKFLOWS = new URL('.github/workflows/', ROOT);
const realDocs = () => Object.fromEntries(readdirSync(WORKFLOWS).filter((n) => /\.ya?ml$/.test(n))
  .map((n) => [n, YAML.parse(readFileSync(new URL(n, WORKFLOWS), 'utf8'))]));

/** Read per test, so a missing page fails each case on its own. */
function page() {
  assert.ok(existsSync(new URL(PAGE, ROOT)), `${PAGE} does not exist`);
  return readFileSync(new URL(PAGE, ROOT), 'utf8');
}

const realCited = () => {
  const cited = citedChecks(page());
  assert.equal(cited.length, 4, `${PAGE}: the "Required checks" table must cite 4 checks, found ${cited.length}`);
  return cited;
};

// Prose wraps, so phrases are looked up with every run of whitespace read as one space.
const flat = (s) => s.replace(/\s+/g, ' ');
const sectionText = (md, title) => {
  const body = section(md, title);
  assert.ok(body.trim(), `${PAGE}: no "## ${title}" section, or it is empty`);
  return flat(body);
};
const has = (text, needle, where) => assert.ok(text.includes(needle), `${PAGE} ${where}: missing "${needle}"`);
/** Every needle (string or regex) appears, each after the one before it. */
const inOrder = (text, needles, where) => {
  let from = 0;
  for (const n of needles) {
    const rest = text.slice(from);
    const m = typeof n === 'string' ? new RegExp(escapeRe(n)).exec(rest) : n.exec(rest);
    assert.ok(m, `${PAGE} ${where}: missing ${n}, or it is out of order`);
    from += m.index + m[0].length;
  }
};

const STEPS = [
  'See the three checks report',
  'Set up the timings PR identity',
  'Require the checks on dev',
  'Prove the rule',
];
const [STEP1, STEP2, STEP3, STEP4] = STEPS.map((t, i) => `${i + 1}. ${t}`);
const RED_LEG = 'A red leg that runs only on dev';

// ── the cited names against the workflows ────────────────────────────────────────────────

test('required checks: the page cites exactly the three CI gating jobs and the ticket check', () => {
  assert.deepEqual(realCited().map((r) => `${r.workflow} ${r.jobId}`).sort(), [
    '.github/workflows/ci.yml ci-gate',
    '.github/workflows/firefox-e2e.yml firefox-e2e',
    '.github/workflows/parity-docker.yml parity-docker',
    '.github/workflows/pr-context.yml linked-issue',
  ]);
});

test('required checks: the real workflows match the cited names', () => {
  const problems = checkNameProblems(realCited(), realDocs());
  assert.deepEqual(problems, [], problems.join('\n'));
});

// Each mutation starts from workflows that match the real page, so a case can't pass on an unrelated problem.
const mutated = (fn) => {
  const cited = realCited();
  const docs = realDocs();
  assert.deepEqual(checkNameProblems(cited, docs), [], 'the real workflows match the page before the mutation');
  fn(docs);
  return checkNameProblems(cited, docs);
};
const oneProblem = (problems, check, re) => {
  assert.equal(problems.length, 1, JSON.stringify(problems));
  assert.ok(problems[0].startsWith(`"${check}"`), `the message starts with "${check}": ${problems[0]}`);
  assert.match(problems[0], re);
};

test('required checks: renaming the CI gate job names "CI gate" (R-rel-3 example)', () => {
  const p = mutated((d) => { d['ci.yml'].jobs['ci-gate'].name = 'ci-gate'; });
  oneProblem(p, 'CI gate', /is named "ci-gate"/);
  assert.match(p[0], /docs\/required-checks\.md/);
  assert.match(p[0], /would wait forever/);
});

test('required checks: renaming the parity job names its cited check', () => {
  const p = mutated((d) => { d['parity-docker.yml'].jobs['parity-docker'].name = 'parity'; });
  oneProblem(p, 'parity (tree against the CI image)', /is named "parity"/);
});

test('required checks: renaming the Firefox job names its cited check', () => {
  const p = mutated((d) => { d['firefox-e2e.yml'].jobs['firefox-e2e'].name = 'Firefox e2e'; });
  oneProblem(p, 'Firefox e2e (Playwright Firefox, branch and split tree)', /is named "Firefox e2e"/);
});

test('required checks: a missing job or workflow is named', () => {
  oneProblem(mutated((d) => { delete d['ci.yml'].jobs['ci-gate']; }), 'CI gate', /has no job ci-gate/);
  oneProblem(mutated((d) => { delete d['ci.yml']; }), 'CI gate', /does not exist/);
});

test('required checks: an expression job name is rejected', () => {
  const p = mutated((d) => { d['ci.yml'].jobs['ci-gate'].name = 'fast (${{ matrix.node }})'; });
  oneProblem(p, 'CI gate', /name is an expression, so its check name changes per run/);
});

// ── the page's shape ─────────────────────────────────────────────────────────────────────

test('required checks: the steps come in order', () => {
  const md = page();
  assert.match(md, /^# Requiring the CI checks on dev[ \t]*$/m);
  const steps = [...md.matchAll(/^## (\d+)\.[ \t]+(.*?)[ \t]*$/gm)].map((m) => `${m[1]}. ${m[2]}`);
  assert.deepEqual(steps, [STEP1, STEP2, STEP3, STEP4]);
  for (const title of ['Required checks', 'Rollback', 'Admin bypass', RED_LEG]) sectionText(md, title);
});

test('required checks: step 1 links the prerequisite PRs and asks for 5 green dev runs', (t) => {
  const md = page();
  const text = sectionText(md, STEP1);
  const body = section(md, STEP1);

  has(text, 'Prerequisite PRs', 'step 1');
  const prs = tableWithHead(body, ['Slice', 'PR', 'Merged']);
  assert.equal(prs.length, 3, `${PAGE} step 1: the Prerequisite PRs table has 3 rows`);
  const link = /https:\/\/github\.com\/worca-org\/worca\/(pull\/\d+|pulls\?q=[^\s)\]>|]+)/;
  for (const [slice, name] of [[2, 'Every required check reports'], [5, 'Node test offenders'], [6, 'Browser offenders']]) {
    const rows = prs.filter((c) => (c[0] ?? '').includes(name));
    assert.equal(rows.length, 1, `${PAGE} step 1: one Prerequisite PRs row names "${name}" (slice ${slice})`);
    const m = link.exec(rows[0][1] ?? '');
    assert.ok(m, `${PAGE} step 1: no PR link for slice ${slice} in "${rows[0][1]}"`);
    // Both forms pass; a search link still there is logged, to be swapped for /pull/N before the merge.
    if (m[1].startsWith('pulls')) t.diagnostic(`search link left in Prerequisite PRs: slice ${slice}`);
  }

  has(text, 'Green dev push runs', 'step 1');
  const runs = tableWithHead(body, ['#', 'Commit', 'CI', 'Parity', 'Firefox e2e']);
  assert.deepEqual(runs.map((c) => clean(c[0] ?? '')), ['1', '2', '3', '4', '5'], `${PAGE} step 1: 5 green-run rows, numbered 1 to 5`);

  for (const needle of ['slices 1 to 6 and 8', '5 consecutive green', 'step 3', 'test PR',
    'actions/workflows/ci.yml?query=branch%3Adev+event%3Apush', 'test-offenders.md#post-merge-check']) {
    has(text, needle, 'step 1');
  }
});

test('required checks: step 2 pins the App secrets and limits', () => {
  const text = sectionText(page(), STEP2);
  for (const needle of ['TIMINGS_APP_ID', 'TIMINGS_APP_PRIVATE_KEY', 'Workflows', 'Administration',
    'Allow GitHub Actions to create and approve pull requests']) {
    has(text, needle, 'step 2');
  }
});

test('required checks: rollback tracks getting the rule back', () => {
  has(sectionText(page(), 'Rollback'), 'repeat step 3 when closed', 'Rollback');
});

test('required checks: the admin bypass asks for the reason and the run link', () => {
  const text = sectionText(page(), 'Admin bypass');
  for (const needle of ['bypass', 'merge box', 'reason', 'run link']) has(text, needle, 'Admin bypass');
});

test('required checks: steps 3 and 4 do not repeat the names', () => {
  const md = page();
  const cited = realCited();
  const table = new Set(section(md, 'Required checks').split('\n').filter((l) => l.trim().startsWith('|')));
  const rest = md.split('\n').filter((l) => !table.has(l));
  for (const { check } of cited) {
    assert.deepEqual(rest.filter((l) => l.includes(`\`${check}\``)), [], `${PAGE}: "${check}" is cited again outside the Required checks table`);
  }
  const step3 = sectionText(md, STEP3);
  has(step3, 'Require branches to be up to date before merging', 'step 3');
  has(step3, 'Update branch', 'step 3');
});

test('required checks: step 4 probes the label and the rollback', () => {
  inOrder(sectionText(page(), STEP4), [
    'Merging is blocked', 'label', 'full-node-matrix', 'still blocked', 'Rollback',
    /remove the gate from the ruleset/i, /add it back/i,
  ], 'step 4');
});

test('required checks: under ten minutes, a test PR is blocked until the gate passes, and removing the gate unblocks it (R-ops-1 example)', () => {
  const md = page();
  const intro = flat(md.split(/^## /m)[0]);
  has(intro, 'under 10 minutes', 'intro');
  inOrder(sectionText(md, STEP4), [
    'Merging is blocked', /remove the gate from the ruleset/i, /mergeable/i, /add it back/i,
    /revert/i, /gate passes/i, /merge is allowed/i,
  ], 'step 4');
});

test('required checks: the red dev-only leg section points to quarantine', () => {
  const text = sectionText(page(), RED_LEG);
  for (const needle of ['test/quarantine.json', '22.19.0', '26', 'slow']) has(text, needle, RED_LEG);
});

test('required checks: a red dev-only leg is fixed or quarantined by the next PR, naming the test (R-rel-1 example)', () => {
  const text = sectionText(page(), RED_LEG);
  inOrder(text, [/shows red on that `?dev`? commit/i, /next PR into `?dev`?/i, /either fixes it or adds/i, 'test/quarantine.json', /names the failing test/i], RED_LEG);
  for (const field of ['path', 'reason', 'exitCondition']) has(text, `\`${field}\``, RED_LEG);
});

test('required checks: CONTRIBUTING and the docs index link the page', () => {
  const read = (file) => readFileSync(new URL(file, ROOT), 'utf8');
  assert.ok(read('CONTRIBUTING.md').includes(PAGE), `CONTRIBUTING.md does not mention ${PAGE}`);
  assert.ok(read('docs/README.md').includes('](required-checks.md)'), 'docs/README.md does not link required-checks.md');
});
