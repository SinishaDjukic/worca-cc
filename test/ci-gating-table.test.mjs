// test/ci-gating-table.test.mjs — which workflows gate merges into dev, and the rules those hold to.
// CONTRIBUTING.md's "### Checks that gate merges" table classifies every file in .github/workflows/
// once: gating (with its required check, a real job name) or not (with the reason). The gating ones
// (ci.yml, parity-docker.yml, firefox-e2e.yml) must start on every PR into dev with no path filter,
// and cancel superseded PR runs only, so a dev push run is never cancelled (a red mark on dev).
// Both problem functions are pure and return one string per problem, like gateProblems in
// test/tools-test-runner.test.mjs; each rule is proven on a mutated copy of a clean real file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import YAML from 'yaml';

const HEADER = ['Workflow', 'Gates merges', 'Required check', 'How, or why not'];
const HEADING = '### Checks that gate merges';
const GATING = {
  'ci.yml': 'CI gate',
  'firefox-e2e.yml': 'Firefox e2e (Playwright Firefox, branch and split tree)',
  'parity-docker.yml': 'parity (tree against the CI image)',
};
// The ticket rule: a required check that judges the PR description, not the code, so the trigger and
// cancellation rules below (GATING only) do not apply to it. The no-issue label is its bypass.
const TICKET = { 'pr-context.yml': 'Linked issue' };
const UNGATED = ['docker-image.yml', 'docker-rebuild.yml', 'label-by-author.yml', 'quarantine.yml', 'refresh-test-timings.yml', 'release-npm-app.yml', 'worca-metrics-pr-events.yml'];
const PR_ONLY = "${{ github.event_name == 'pull_request' }}";

const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
const ticked = (cell) => (cell.match(/`([^`]+)`/) || [])[1] ?? null;

export function parseGatingTable(markdown) {
  const lines = String(markdown).split('\n');
  const at = lines.findIndex((l) => l.trim() === HEADING);
  if (at < 0) throw new Error('gating table: no "### Checks that gate merges" section in CONTRIBUTING.md');
  let i = at + 1;
  while (i < lines.length && !lines[i].trim().startsWith('|')) i++;
  const table = [];
  for (; i < lines.length && lines[i].trim().startsWith('|'); i++) table.push(lines[i]);
  const head = table.length ? cells(table[0]) : [];
  if (head.join('|') !== HEADER.join('|')) throw new Error('gating table: header must be Workflow | Gates merges | Required check | How, or why not');
  return table.slice(2).map((line) => {
    const [w, g, c, reason = ''] = cells(line);
    const workflow = ticked(w) ?? w;
    if (g !== 'yes' && g !== 'no') throw new Error(`gating table: ${workflow}: Gates merges must be yes or no`);
    return { workflow, gates: g === 'yes', check: c === '—' ? null : ticked(c) ?? c, reason: reason.trim() };
  });
}

export function tableProblems(rows, workflowFiles, docsByFile) {
  const problems = [];
  const count = new Map();
  for (const r of rows) count.set(r.workflow, (count.get(r.workflow) || 0) + 1);
  for (const f of workflowFiles) if (!count.has(f)) problems.push(`${f}: not in the gating table`);
  for (const [f, n] of count) if (n > 1) problems.push(`${f}: listed twice`);
  for (const f of count.keys()) if (!workflowFiles.includes(f)) problems.push(`${f}: in the table but not in .github/workflows`);
  for (const r of rows) {
    if (r.gates) {
      const names = Object.values(docsByFile[r.workflow]?.jobs || {}).map((j) => j?.name);
      if (!r.check || !names.includes(r.check)) problems.push(`${r.workflow}: required check ${JSON.stringify(r.check)} is not a job name in the workflow`);
    } else if (r.check !== null || !r.reason) {
      problems.push(`${r.workflow}: a workflow left ungated needs its reason`);
    }
  }
  const got = [...new Set(rows.filter((r) => r.gates).map((r) => r.workflow))].sort();
  const want = Object.keys({ ...GATING, ...TICKET }).sort();
  if (got.join() !== want.join()) problems.push(`gating set is ${got.join(', ')}, want ${want.join(', ')}`);
  return problems;
}

export function gatingWorkflowProblems(doc, { prefix, ciGroup }) {
  const problems = [];
  const on = doc?.on || {};
  if (!('pull_request' in on)) problems.push('on.pull_request: a gating workflow must run on every pull request');
  const pr = on.pull_request && typeof on.pull_request === 'object' ? on.pull_request : {};
  if ('branches' in pr && ![].concat(pr.branches || []).includes('dev')) problems.push('on.pull_request.branches: must include dev');
  if ('branches-ignore' in pr) problems.push('on.pull_request.branches-ignore: not allowed');
  if ('types' in pr) {
    const types = [].concat(pr.types || []);
    if (!['opened', 'synchronize', 'reopened'].every((t) => types.includes(t))) problems.push('on.pull_request.types: must hold opened, synchronize and reopened');
  }
  if (![].concat(on.push?.branches || []).includes('dev')) problems.push('on.push.branches: must include dev');
  for (const ev of ['pull_request', 'push']) {
    const e = on[ev];
    for (const key of ['paths', 'paths-ignore']) {
      if (e && typeof e === 'object' && key in e) problems.push(`on.${ev}.${key}: a gating workflow must always start (a required check that never runs stays pending)`);
    }
  }
  const c = doc?.concurrency || {};
  if (c['cancel-in-progress'] !== PR_ONLY) problems.push(`concurrency: cancel-in-progress must be ${PR_ONLY}, not ${JSON.stringify(c['cancel-in-progress'])}`);
  const group = String(c.group || '');
  if (group !== prefix + ciGroup) problems.push(`concurrency: group must be ci.yml's group with prefix ${prefix}`);
  if (!['github.run_id', 'github.head_ref', 'github.event.pull_request.head.repo.full_name'].every((s) => group.includes(s)))
    problems.push('concurrency: the push group must be per run (github.run_id) and the PR group per head repo and branch');
  for (const [id, job] of Object.entries(doc?.jobs || {})) {
    if (job && typeof job === 'object' && 'concurrency' in job) problems.push(`${id}: job-level concurrency is not allowed in a gating workflow`);
  }
  return problems;
}

// ── the real tree ────────────────────────────────────────────────────────────────────────────
const WF = new URL('../.github/workflows/', import.meta.url);
const workflowFiles = () => readdirSync(WF).filter((f) => /\.ya?ml$/.test(f)).sort();
const wfDoc = (f) => YAML.parse(readFileSync(new URL(f, WF), 'utf8'));
const docs = () => Object.fromEntries(workflowFiles().map((f) => [f, wfDoc(f)]));
const contributing = () => readFileSync(new URL('../CONTRIBUTING.md', import.meta.url), 'utf8');
const ciGroup = () => {
  const g = String(wfDoc('ci.yml').concurrency?.group || '');
  assert.ok(g.startsWith('ci-'), `ci.yml's concurrency group starts with ci-: ${g}`);
  return g.slice('ci-'.length);
};
const prefixOf = (f) => `${f.replace(/\.ya?ml$/, '')}-`;
const hasProblem = (problems, re, what) => assert.ok(problems.some((p) => re.test(p)), `${what}: ${JSON.stringify(problems)}`);

// Each mutation is checked against a clean real file, so a rule can't "pass" on an unrelated problem.
const mutatedWf = (file, fn, prefix = prefixOf(file)) => {
  const base = wfDoc(file);
  const opts = { prefix: prefixOf(file), ciGroup: ciGroup() };
  assert.deepEqual(gatingWorkflowProblems(base, opts), [], `the real ${file} is clean before the mutation`);
  const doc = structuredClone(base);
  fn(doc);
  return gatingWorkflowProblems(doc, { ...opts, prefix });
};
const realRows = () => parseGatingTable(contributing());
const mutatedTable = (fn) => {
  const rows = realRows();
  const files = workflowFiles();
  const d = docs();
  assert.deepEqual(tableProblems(rows, files, d), [], 'the real gating table is clean before the mutation');
  const m = { rows: structuredClone(rows), files: [...files], docs: structuredClone(d) };
  fn(m);
  return tableProblems(m.rows, m.files, m.docs);
};

// ── the table ────────────────────────────────────────────────────────────────────────────────
test('gating table: every workflow file is listed once and the real tree has no problem', () => {
  assert.deepEqual(tableProblems(realRows(), workflowFiles(), docs()), []);
});

test('gating table: the gating set is ci.yml, parity-docker.yml, firefox-e2e.yml and the ticket check, with their check names', () => {
  const gating = Object.fromEntries(realRows().filter((r) => r.gates).map((r) => [r.workflow, r.check]));
  assert.deepEqual(gating, { ...GATING, ...TICKET });
});

test('gating table: the ticket check reports again when the description or a label changes', () => {
  const types = wfDoc('pr-context.yml').on.pull_request_target.types;
  for (const t of ['opened', 'edited', 'reopened', 'synchronize', 'labeled', 'unlabeled']) assert.ok(types.includes(t), `pr-context.yml runs on ${t}`);
});

test('gating table: each ungated workflow has a reason', () => {
  const ungated = realRows().filter((r) => !r.gates);
  assert.deepEqual(ungated.map((r) => r.workflow).sort(), UNGATED);
  for (const r of ungated) {
    assert.equal(r.check, null, `${r.workflow} has no required check`);
    assert.ok(r.reason.length > 0, `${r.workflow} has a reason`);
  }
});

test('gating table: a workflow file missing from the table is named', () => {
  hasProblem(mutatedTable((m) => { m.files.push('new.yml'); }), /^new\.yml: not in the gating table$/, 'new.yml');
  hasProblem(mutatedTable((m) => { m.rows.push({ ...m.rows[0] }); }), /: listed twice$/, 'duplicate row');
  hasProblem(mutatedTable((m) => { m.rows.push({ workflow: 'gone.yml', gates: false, check: null, reason: 'x' }); }), /^gone\.yml: in the table but not in \.github\/workflows$/, 'gone.yml');
});

test('gating table: a renamed required check is named', () => {
  const p = mutatedTable((m) => {
    const job = Object.values(m.docs['parity-docker.yml'].jobs).find((j) => j.name === GATING['parity-docker.yml']);
    job.name = 'parity (renamed)';
  });
  hasProblem(p, /^parity-docker\.yml: required check "parity \(tree against the CI image\)" is not a job name/, 'renamed parity job');
});

test('gating table: an ungated row without a reason is named', () => {
  const p = mutatedTable((m) => { m.rows.find((r) => r.workflow === 'docker-image.yml').reason = ''; });
  hasProblem(p, /^docker-image\.yml: a workflow left ungated needs its reason$/, 'empty reason');
  const q = mutatedTable((m) => { m.rows.find((r) => r.workflow === 'docker-image.yml').gates = true; });
  hasProblem(q, /^gating set is ci\.yml, docker-image\.yml, firefox-e2e\.yml, parity-docker\.yml, pr-context\.yml, want ci\.yml, firefox-e2e\.yml, parity-docker\.yml, pr-context\.yml$/, 'extra gating row');
});

test('gating table: a malformed table throws', () => {
  const md = (head, row) => `# x\n\n${HEADING}\n\nLead.\n\n${head}\n|---|---|---|---|\n${row}\n\nAfter.\n`;
  const ok = md('| Workflow | Gates merges | Required check | How, or why not |', '| `ci.yml` | yes | `CI gate` | the gate job |');
  assert.deepEqual(parseGatingTable(ok), [{ workflow: 'ci.yml', gates: true, check: 'CI gate', reason: 'the gate job' }]);
  assert.deepEqual(parseGatingTable(md('| Workflow | Gates merges | Required check | How, or why not |', '| `docker-image.yml` | no | — | tags only |')),
    [{ workflow: 'docker-image.yml', gates: false, check: null, reason: 'tags only' }]);
  assert.throws(() => parseGatingTable(md('| Gates merges | Workflow | Required check | How, or why not |', '| yes | `ci.yml` | `CI gate` | x |')),
    { message: 'gating table: header must be Workflow | Gates merges | Required check | How, or why not' });
  assert.throws(() => parseGatingTable(md('| Workflow | Gates merges | Required check | How, or why not |', '| `ci.yml` | maybe | `CI gate` | x |')),
    { message: 'gating table: ci.yml: Gates merges must be yes or no' });
  assert.throws(() => parseGatingTable('# no table here\n'), { message: 'gating table: no "### Checks that gate merges" section in CONTRIBUTING.md' });
});

// ── the gating workflows' triggers and cancellation ────────────────────────────────────────────
test('gating workflows: each of the 3 real workflows has no trigger or cancellation problem', () => {
  const g = ciGroup();
  for (const f of Object.keys(GATING)) assert.deepEqual(gatingWorkflowProblems(wfDoc(f), { prefix: prefixOf(f), ciGroup: g }), [], f);
});

test('gating workflows: a paths filter on pull_request to parity-docker.yml is named', () => {
  hasProblem(mutatedWf('parity-docker.yml', (d) => { d.on.pull_request.paths = ['src/**']; }), /^on\.pull_request\.paths: a gating workflow must always start/, 'pull_request.paths');
  hasProblem(mutatedWf('parity-docker.yml', (d) => { d.on.pull_request['paths-ignore'] = ['docs/**']; }), /^on\.pull_request\.paths-ignore:/, 'pull_request.paths-ignore');
  hasProblem(mutatedWf('parity-docker.yml', (d) => { d.on.push.paths = ['src/**']; }), /^on\.push\.paths:/, 'push.paths');
});

test('gating workflows: cancel-in-progress true cancels dev runs and is named', () => {
  for (const f of ['parity-docker.yml', 'firefox-e2e.yml']) {
    hasProblem(mutatedWf(f, (d) => { d.concurrency['cancel-in-progress'] = true; }), /^concurrency: cancel-in-progress must be .*, not true$/, f);
  }
});

test('gating workflows: a branch-only group (no run_id) is named', () => {
  const old = 'parity-docker-${{ github.event.pull_request.head.repo.full_name || github.repository }}-${{ github.head_ref || github.ref_name }}';
  const p = mutatedWf('parity-docker.yml', (d) => { d.concurrency.group = old; });
  hasProblem(p, /^concurrency: group must be ci\.yml's group with prefix parity-docker-$/, 'group shape');
  hasProblem(p, /^concurrency: the push group must be per run \(github\.run_id\)/, 'per-run push group');
});

test('gating workflows: a group that drifts from ci.yml\'s shape is named', () => {
  const swapped = mutatedWf('firefox-e2e.yml', (d) => { d.concurrency.group = d.concurrency.group.replace('github.head_ref', 'github.ref_name'); });
  hasProblem(swapped, /^concurrency: group must be ci\.yml's group with prefix firefox-e2e-$/, 'head_ref swapped');
  const wrongPrefix = mutatedWf('firefox-e2e.yml', (d) => { d.concurrency.group = `parity-docker-${ciGroup()}`; });
  hasProblem(wrongPrefix, /^concurrency: group must be ci\.yml's group with prefix firefox-e2e-$/, 'parity prefix on firefox');
});

test('gating workflows: no pull_request trigger, or branches without dev, is named', () => {
  hasProblem(mutatedWf('parity-docker.yml', (d) => { delete d.on.pull_request; }), /^on\.pull_request: a gating workflow must run on every pull request$/, 'no pull_request');
  hasProblem(mutatedWf('parity-docker.yml', (d) => { d.on.pull_request.branches = ['main']; }), /^on\.pull_request\.branches: must include dev$/, 'branches main');
  hasProblem(mutatedWf('firefox-e2e.yml', (d) => { d.on.pull_request['branches-ignore'] = ['dev']; }), /^on\.pull_request\.branches-ignore: not allowed$/, 'branches-ignore');
  hasProblem(mutatedWf('firefox-e2e.yml', (d) => { d.on.push.branches = ['main']; }), /^on\.push\.branches: must include dev$/, 'push branches main');
});

test('gating workflows: ci.yml\'s pull_request trigger counts as every PR: its real types, and a bare pull_request: (null)', () => {
  const g = ciGroup();
  const doc = wfDoc('ci.yml');
  for (const t of ['opened', 'synchronize', 'reopened']) assert.ok(doc.on.pull_request.types.includes(t), `ci.yml runs on ${t}`);
  assert.deepEqual(gatingWorkflowProblems(doc, { prefix: 'ci-', ciGroup: g }), []);
  const bare = structuredClone(doc);
  bare.on.pull_request = null;
  assert.deepEqual(gatingWorkflowProblems(bare, { prefix: 'ci-', ciGroup: g }), [], 'a bare pull_request: is every PR');
});

test('gating workflows: types without synchronize is named', () => {
  hasProblem(mutatedWf('parity-docker.yml', (d) => { d.on.pull_request.types = ['opened']; }), /^on\.pull_request\.types: must hold opened, synchronize and reopened$/, 'types [opened]');
});

test('gating workflows: job-level concurrency is named', () => {
  const p = mutatedWf('parity-docker.yml', (d) => { d.jobs['parity-docker'].concurrency = { group: 'x', 'cancel-in-progress': true }; });
  hasProblem(p, /^parity-docker: job-level concurrency is not allowed/, 'job concurrency');
});
