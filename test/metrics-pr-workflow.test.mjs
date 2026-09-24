// test/metrics-pr-workflow.test.mjs
// The PR-events GitHub Action (src/core/metrics/pr-events-workflow.yml): this repository runs
// the same file, its github-script body behaves against a fake GitHub API (no branch, one PR,
// a race with a teammate's push, a backfill), and `worca metrics pr-workflow` installs it.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { personKey } from '../src/core/metrics/record.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { installPrWorkflow, prWorkflowText, PR_WORKFLOW_PATH, parsePrEvent } from '../src/core/metrics/prs.mjs';

useTempHome(after);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const CLI = join(ROOT, 'src', 'cli', 'worca-cc.mjs');
const TEMPLATE = readFileSync(join(ROOT, 'src/core/metrics/pr-events-workflow.yml'), 'utf8');
const scratch = mkdtempSync(join(tmpdir(), 'worca-pr-workflow-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

/** The `script: |` block, de-indented — what actions/github-script runs. */
function scriptBody(yml) {
  const lines = yml.split('\n');
  const at = lines.findIndex((l) => /^\s+script: \|\s*$/.test(l));
  assert.ok(at > 0, 'the workflow has a github-script body');
  const body = [];
  for (const l of lines.slice(at + 1)) {
    if (l.trim() && !l.startsWith(' '.repeat(12))) break;
    body.push(l.slice(12));
  }
  return body.join('\n');
}

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

function fakeGithub({ branch = true, raceOnce = false, pages = [], attribution = 'git-user', commits = {} } = {}) {
  const state = { tip: 'c0', trees: { c0: 't0' }, files: {}, commits: [], raced: false, notices: [], infos: [] };
  const err = (status) => Object.assign(new Error(`HTTP ${status}`), { status });
  let treeN = 0; let commitN = 0;
  const pending = new Map();   // tree sha → files it adds
  const github = {
    rest: {
      git: {
        getRef: async () => { if (!branch) throw err(404); return { data: { object: { sha: state.tip } } }; },
        getCommit: async ({ commit_sha }) => ({ data: { tree: { sha: state.trees[commit_sha] } } }),
        createTree: async ({ base_tree, tree }) => {
          const changed = tree.filter((e) => state.files[e.path] !== e.content);
          if (!changed.length) return { data: { sha: base_tree } };
          const sha = `t${++treeN}`;
          pending.set(sha, tree);
          return { data: { sha } };
        },
        createCommit: async ({ tree, parents, message }) => { const sha = `c${++commitN}`; state.trees[sha] = tree; pending.set(sha, { tree, parents, message }); return { data: { sha } }; },
        updateRef: async ({ sha, force }) => {
          assert.equal(force, false, 'never force-pushes the shared branch');
          if (raceOnce && !state.raced) { state.raced = true; state.tip = 'teammate'; state.trees.teammate = 't0'; throw err(422); }
          const c = pending.get(sha);
          assert.equal(c.parents[0], state.tip, 'commits on the current tip');
          for (const e of pending.get(c.tree)) state.files[e.path] = e.content;
          state.tip = sha; state.commits.push(c.message);
          return { data: {} };
        },
      },
      pulls: { list: Symbol('pulls.list') },
      repos: {
        getContent: async ({ path, ref }) => {
          assert.equal(ref, 'worca-metrics');
          if (path !== '.worca-metrics/config.json' || attribution == null) throw err(404);
          return { data: { content: Buffer.from(JSON.stringify({ schema: 1, attribution })).toString('base64') } };
        },
      },
    },
    paginate: { iterator: async function* () { for (const p of pages) yield { data: p }; } },
    // Commit authors per PR number (`commits`), answered for every aliased pullRequest(number: N).
    graphql: async (query, vars) => {
      state.graphql = (state.graphql || 0) + 1;
      assert.deepEqual(vars, { owner: 'acme', repo: 'api' });
      const repository = {};
      for (const m of query.matchAll(/(p\d+): pullRequest\(number: (\d+)\)/g)) {
        const list = commits[Number(m[2])] || [];
        repository[m[1]] = { commits: { nodes: list.map(([name, email]) => ({ commit: { author: { name, email } } })) } };
      }
      return { repository };
    },
  };
  const core = { notice: (m) => state.notices.push(m), info: (m) => state.infos.push(m) };
  return { github, core, state };
}

const PR = (n, extra = {}) => ({
  number: n, html_url: `https://github.com/acme/api/pull/${n}`, user: { login: 'mara-k' }, title: `PR ${n}\u2028with a line break`, state: 'closed',
  head: { ref: `worca/feature-${n}` }, base: { ref: 'dev' }, created_at: '2026-09-20T10:00:00Z',
  merged_at: '2026-09-22T17:30:00Z', closed_at: '2026-09-22T17:30:00Z', updated_at: '2026-09-22T17:30:00Z', ...extra,
});

async function runScript({ github, core }, context) {
  const fn = new AsyncFunction('github', 'context', 'core', 'require', scriptBody(TEMPLATE));
  // Retries sleep 1 s × attempt; keep the test fast.
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (cb) => realSetTimeout(cb, 0);
  try { await fn(github, { repo: { owner: 'acme', repo: 'api' }, ...context }, core, createRequire(import.meta.url)); } finally { globalThis.setTimeout = realSetTimeout; }
}

test('this repository runs the shipped template, byte for byte', () => {
  assert.equal(readFileSync(join(ROOT, PR_WORKFLOW_PATH), 'utf8'), TEMPLATE);
});

test('workflow shape: pull_request_target without a checkout, write scope, serialized', () => {
  assert.match(TEMPLATE, /pull_request_target:\n\s+types: \[opened, reopened, closed\]/);
  assert.match(TEMPLATE, /workflow_dispatch:/);
  assert.match(TEMPLATE, /contents: write/);
  assert.match(TEMPLATE, /cancel-in-progress: false/);
  assert.ok(!/actions\/checkout/.test(TEMPLATE), 'never checks out pull-request code');
  assert.ok(!/[\u2028\u2029]/.test(TEMPLATE), 'no raw line separators (they break YAML)');
});

test('no worca-metrics branch: a notice, no writes', async () => {
  const f = fakeGithub({ branch: false });
  await runScript(f, { eventName: 'pull_request_target', payload: { pull_request: PR(1) } });
  assert.equal(f.state.commits.length, 0);
  assert.match(f.state.notices[0], /not enabled/);
});

test('a merged PR becomes one event file that Worca reads back', async () => {
  const f = fakeGithub();
  await runScript(f, { eventName: 'pull_request_target', payload: { pull_request: PR(474) } });
  assert.deepEqual(f.state.commits, ['worca-metrics: PR #474 merged']);
  const text = f.state.files['.worca-metrics/prs/474.json'];
  const ev = parsePrEvent(text);
  assert.equal(ev.state, 'MERGED');
  assert.equal(ev.head, 'worca/feature-474');
  assert.equal(ev.repo, 'acme/api');
  assert.equal(ev.title, 'PR 474 with a line break');
  assert.ok(text.endsWith('\n') && text.split('\n').length === 2, 'one JSON line');
  // Re-delivery of the same event changes nothing.
  await runScript(f, { eventName: 'pull_request_target', payload: { pull_request: PR(474) } });
  assert.equal(f.state.commits.length, 1);
});

test('the author is recorded unless the team chose no attribution', async () => {
  const f = fakeGithub();
  await runScript(f, { eventName: 'pull_request_target', payload: { pull_request: PR(20) } });
  assert.equal(parsePrEvent(f.state.files['.worca-metrics/prs/20.json']).author, 'mara-k');
  const none = fakeGithub({ attribution: 'none' });
  await runScript(none, { eventName: 'pull_request_target', payload: { pull_request: PR(21) } });
  assert.equal(JSON.parse(none.state.files['.worca-metrics/prs/21.json']).author, null);
  const noConfig = fakeGithub({ attribution: null });
  await runScript(noConfig, { eventName: 'pull_request_target', payload: { pull_request: PR(22) } });
  assert.equal(parsePrEvent(noConfig.state.files['.worca-metrics/prs/22.json']).author, 'mara-k');
});

test('the git author of most commits names the PR (as for runs); machines skipped; same key as Worca', async () => {
  const f = fakeGithub({ commits: {
    30: [['Siniša Đukić', 'Sini@Example.com'], ['orchestrator', 'orchestrator@local'], ['orchestrator', 'orchestrator@local'], ['Sinisha D', 'sini@example.com'], ['Siniša Đukić', 'sini@example.com'], ['Mara K', 'mara@example.com']],
    31: [['orchestrator', 'orchestrator@local']],
  } });
  await runScript(f, { eventName: 'pull_request_target', payload: { pull_request: PR(30) } });
  const ev = parsePrEvent(f.state.files['.worca-metrics/prs/30.json']);
  assert.equal(ev.authorName, 'Siniša Đukić', 'the most-used name of the most frequent email');
  assert.equal(ev.authorKey, personKey('sini@example.com'), 'the Action and Worca compute the same key');
  assert.equal(ev.author, 'mara-k', 'the login stays as the fallback');
  assert.ok(!f.state.files['.worca-metrics/prs/30.json'].includes('example.com'), 'no email is stored');
  await runScript(f, { eventName: 'pull_request_target', payload: { pull_request: PR(31) } });
  const machine = parsePrEvent(f.state.files['.worca-metrics/prs/31.json']);
  assert.equal(machine.authorName, null, 'only machine commits: no git author');
  assert.equal(machine.authorKey, null);
  // attribution "none": no author of any kind, and the commits are not even read.
  const none = fakeGithub({ attribution: 'none', commits: { 32: [['X', 'x@example.com']] } });
  await runScript(none, { eventName: 'pull_request_target', payload: { pull_request: PR(32) } });
  const hidden = JSON.parse(none.state.files['.worca-metrics/prs/32.json']);
  assert.deepEqual([hidden.author, hidden.authorName, hidden.authorKey], [null, null, null]);
  assert.equal(none.state.graphql, undefined);
});

test('backfill reads commit authors 50 PRs per GraphQL query', async () => {
  const recent = new Date(Date.now() - 86_400_000).toISOString();
  const page = Array.from({ length: 120 }, (_, i) => PR(i + 1, { updated_at: recent }));
  const f = fakeGithub({ pages: [page] });
  await runScript(f, { eventName: 'workflow_dispatch', payload: { inputs: { days: '30' } } });
  assert.equal(f.state.graphql, 3);
  assert.equal(Object.keys(f.state.files).length, 120);
});

test('opened and closed-unmerged states', async () => {
  const f = fakeGithub();
  await runScript(f, { eventName: 'pull_request_target', payload: { pull_request: PR(5, { state: 'open', merged_at: null, closed_at: null }) } });
  await runScript(f, { eventName: 'pull_request_target', payload: { pull_request: PR(6, { merged_at: null }) } });
  assert.equal(parsePrEvent(f.state.files['.worca-metrics/prs/5.json']).state, 'OPEN');
  assert.equal(parsePrEvent(f.state.files['.worca-metrics/prs/6.json']).state, 'CLOSED');
});

test('a teammate pushing in between: rebuilt on the new tip, never forced', async () => {
  const f = fakeGithub({ raceOnce: true });
  await runScript(f, { eventName: 'pull_request_target', payload: { pull_request: PR(9) } });
  assert.equal(f.state.raced, true);
  assert.equal(f.state.commits.length, 1);
  assert.ok(f.state.files['.worca-metrics/prs/9.json']);
});

test('backfill: PRs updated within N days, one commit, stops at the cutoff', async () => {
  const recent = new Date(Date.now() - 86_400_000).toISOString();
  const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
  const f = fakeGithub({ pages: [[PR(1, { updated_at: recent }), PR(2, { updated_at: recent })], [PR(3, { updated_at: old }), PR(4, { updated_at: recent })]] });
  await runScript(f, { eventName: 'workflow_dispatch', payload: { inputs: { days: '30' } } });
  assert.deepEqual(f.state.commits, ['worca-metrics: 2 PR events']);
  assert.deepEqual(Object.keys(f.state.files).sort(), ['.worca-metrics/prs/1.json', '.worca-metrics/prs/2.json']);
});

test('installPrWorkflow: created, unchanged, differs unless forced', async () => {
  const proj = join(scratch, 'proj');
  mkdirSync(proj, { recursive: true });
  assert.equal((await installPrWorkflow(proj)).status, 'created');
  assert.equal(readFileSync(join(proj, PR_WORKFLOW_PATH), 'utf8'), await prWorkflowText());
  assert.equal((await installPrWorkflow(proj)).status, 'unchanged');
  writeFileSync(join(proj, PR_WORKFLOW_PATH), '# edited by the team\n');
  assert.equal((await installPrWorkflow(proj)).status, 'differs');
  assert.equal(readFileSync(join(proj, PR_WORKFLOW_PATH), 'utf8'), '# edited by the team\n');
  assert.equal((await installPrWorkflow(proj, { force: true })).status, 'updated');
});

function runCli(args) {
  return new Promise((res) => {
    const child = spawn(process.execPath, [CLI, ...args], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (b) => (stdout += b.toString()));
    child.stderr.on('data', (b) => (stderr += b.toString()));
    child.on('exit', (code) => res({ code: code ?? 0, stdout, stderr }));
  });
}

test('worca metrics pr-workflow: --print, install, refuse to clobber', async () => {
  const printed = await runCli(['metrics', 'pr-workflow', '--print']);
  assert.equal(printed.code, 0);
  assert.equal(printed.stdout, TEMPLATE);
  const proj = join(scratch, 'cli-proj');
  mkdirSync(proj, { recursive: true });
  const first = await runCli(['metrics', 'pr-workflow', '--project', proj]);
  assert.equal(first.code, 0, first.stderr);
  assert.match(first.stdout, /created \.github\/workflows\/worca-metrics-pr-events\.yml/);
  writeFileSync(join(proj, PR_WORKFLOW_PATH), 'x\n');
  const clash = await runCli(['metrics', 'pr-workflow', '--project', proj]);
  assert.equal(clash.code, 1);
  assert.match(clash.stderr, /--force/);
  const help = await runCli(['metrics', 'help']);
  assert.match(help.stdout, /pr-workflow/);
});
