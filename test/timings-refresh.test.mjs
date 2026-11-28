// tools/timings-refresh.mjs and .github/workflows/refresh-test-timings.yml: the weekly "Refresh test timings" run. It
// picks the newest green dev push run that has every timing artifact, merges it, and opens or updates one PR with a
// GitHub App token. No test here reaches the network or a real repository: `gh` and `git` are stubs on PATH.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { tierFiles } from '../tools/test.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TOOL = join(ROOT, 'tools', 'timings-refresh.mjs');
const WORKFLOW = '.github/workflows/refresh-test-timings.yml';
const rmOpts = { recursive: true, force: true, maxRetries: 10, retryDelay: 50 };
const posix = { skip: process.platform === 'win32' && 'the stub gh and git are POSIX shell scripts' };
// Imported per test, so a missing module fails each case on its own instead of the whole file.
const T = () => import('../tools/timings-refresh.mjs');

const MESSAGE = 'Refresh test timings needs the GitHub App secrets: see the CI gate admin checklist step 2';
const HINT = 'close the open "Refresh test timings" PR and delete the timings-refresh branch; the next run opens a fresh one';
const REFUSAL = "! [remote rejected] HEAD -> timings-refresh (refusing to allow a GitHub App to create or update workflow `.github/workflows/ci.yml` without `workflows` permission)";
const ARTIFACTS = ['test-timings-fast-1', 'test-timings-fast-2', 'test-timings-fast-3', 'test-timings-fast-4', 'test-timings-slow-1', 'test-timings-slow-2'];

const flag = (args, name) => args[args.indexOf(name) + 1];
const readText = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const readYaml = (rel) => YAML.parse(readText(rel));
const ciDoc = () => readYaml('.github/workflows/ci.yml');

const url = (id) => `https://github.com/o/r/actions/runs/${id}`;
const ghRun = (id, extra = {}) => ({
  databaseId: id, headSha: String(id).padEnd(40, 'a'), url: url(id), event: 'push', headBranch: 'dev', status: 'completed',
  conclusion: 'success', createdAt: '2026-11-20T10:00:00Z', ...extra,
});
const artifacts = ({ without = [], expired = [] } = {}) => [...ARTIFACTS.filter((n) => !without.includes(n)), 'test-failures-1-fast-24-1']
  .map((name) => ({ name, expired: expired.includes(name) }));
const job = (name, end, extra = {}) => ({ name, conclusion: 'success', started_at: '2026-11-20T10:00:00Z', completed_at: end, ...extra });
// Node 24's four shards end 95 s apart; the other Node legs and the slow tier end far outside that.
const shardJobs = (lastEnd = '2026-11-20T10:07:35Z') => [
  job('fast tests (Node 24, 1/4)', '2026-11-20T10:06:00Z'),
  job('fast tests (Node 24, 2/4)', lastEnd),
  job('fast tests (Node 24, 3/4)', '2026-11-20T10:06:40Z'),
  job('fast tests (Node 24, 4/4)', '2026-11-20T10:07:00Z'),
  job('fast tests (Node 22.19.0, 1/4)', '2026-11-20T10:01:00Z'),
  job('fast tests (Node 26, 1/4)', '2026-11-20T10:30:00Z'),
  job('slow tests (1/2)', '2026-11-20T10:40:00Z'),
];

// ── stub gh / git / node ────────────────────────────────────────────────────────────────────

const STUB = `
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const [tool, ...args] = process.argv.slice(2);
const cfg = JSON.parse(readFileSync(process.env.STUB_CONFIG, 'utf8'));
appendFileSync(process.env.STUB_LOG, JSON.stringify({ tool, args, token: process.env.GH_TOKEN || '' }) + '\\n');
const out = (s) => process.stdout.write(s + '\\n');
const after = (...names) => { const i = args.findIndex((a) => names.includes(a)); return i < 0 ? undefined : args[i + 1]; };
if (tool === 'git') {
  // pushFailures: how many pushes fail before one goes through (every push fails when unset).
  const pushes = readFileSync(process.env.STUB_LOG, 'utf8').split('\\n').filter((l) => l.includes('"tool":"git"') && l.includes('"push"')).length;
  if (args.includes('push') && cfg.pushError && (cfg.pushFailures === undefined || pushes <= cfg.pushFailures)) {
    process.stderr.write(cfg.pushError + '\\n'); process.exit(1);
  }
  if (args.includes('diff') && args.includes('--quiet')) process.exit(cfg.diffError ? 128 : cfg.changed ? 1 : 0);
  if (args.includes('rev-parse')) out('a'.repeat(40));
}
if (tool === 'gh') {
  if (cfg.ghDown) { process.stderr.write('HTTP 503: Service Unavailable\\n'); process.exit(1); }
  const [a, b] = args;
  if (a === 'run' && b === 'list') {
    const created = after('--created'), limit = after('-L', '--limit');
    let runs = cfg.runs || [];
    if (created) runs = runs.filter((r) => Date.parse(r.createdAt) >= Date.parse(created.replace(/^>=/, '')));
    if (limit) runs = runs.slice(0, Number(limit));
    out(JSON.stringify(runs));
  }
  if (a === 'run' && b === 'download') mkdirSync(join(after('--dir', '-D'), 'test-timings-fast-1'), { recursive: true });
  if (a === 'api') {
    const m = args.map((x) => /actions\\/runs\\/(\\d+)\\/(artifacts|jobs)/.exec(x)).find(Boolean);
    if (m) for (const row of cfg[m[2]]?.[m[1]] || []) out(JSON.stringify(row));
    else if (args.some((x) => x.includes('users/'))) out('123');
  }
  if (a === 'pr' && b === 'list') {
    // openPrs: the open PRs on the head name, a fork's included; openPr N is one same-repo PR.
    const open = cfg.openPrs ?? (cfg.openPr ? [{ number: cfg.openPr, isCrossRepository: false }] : []);
    const fields = String(after('--json') || '').split(',');
    // Without isCrossRepository in --json, jq sees null there, so a "not cross-repo" filter keeps every PR.
    const rows = open.map((p) => fields.includes('isCrossRepository') ? p : { number: p.number });
    const q = after('-q', '--jq');
    if (after('--state', '-s') === 'merged') out(JSON.stringify(cfg.merged || []));
    else if (q !== undefined) {
      const kept = q.includes('select(.isCrossRepository | not)') ? rows.filter((p) => !p.isCrossRepository) : rows;
      out(kept[0] ? String(kept[0].number) : '');
    } else out(JSON.stringify(rows));
  }
}
`;

/** A temp folder with stub `gh` and `git` (and, when asked, `node`) first on PATH; every call is logged. */
function withStubs(config, fn, { node = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-timings-refresh-'));
  try {
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    writeFileSync(join(dir, 'stub.mjs'), STUB);
    for (const tool of ['gh', 'git', ...(node ? ['node'] : [])]) {
      writeFileSync(join(bin, tool), `#!/bin/sh\nexec "${process.execPath}" "${join(dir, 'stub.mjs')}" ${tool} "$@"\n`);
      chmodSync(join(bin, tool), 0o755);
    }
    const configure = (c) => writeFileSync(join(dir, 'config.json'), JSON.stringify(c));
    configure(config);
    writeFileSync(join(dir, 'log'), '');
    const env = {
      PATH: bin + delimiter + process.env.PATH, HOME: dir, STUB_CONFIG: join(dir, 'config.json'), STUB_LOG: join(dir, 'log'),
      GIT_DIR: join(dir, 'no-repo'), // even a git that slipped past the stub finds no repository to push from
      GITHUB_OUTPUT: join(dir, 'output'), GITHUB_ENV: join(dir, 'env'), RUNNER_TEMP: dir, GITHUB_REPOSITORY: 'o/r',
    };
    writeFileSync(env.GITHUB_OUTPUT, '');
    writeFileSync(env.GITHUB_ENV, '');
    const calls = (tool) => readFileSync(join(dir, 'log'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
      .filter((c) => !tool || c.tool === tool);
    const reset = () => writeFileSync(join(dir, 'log'), '');
    return fn({ dir, env, calls, reset, configure });
  } finally { rmSync(dir, rmOpts); }
}

const cli = (args, env = { PATH: process.env.PATH }, cwd = ROOT) =>
  spawnSync(process.execPath, [TOOL, ...args], { cwd, encoding: 'utf8', timeout: 60_000, env });

// ── checkSecrets ────────────────────────────────────────────────────────────────────────────

test('checkSecrets: both set returns ok; one empty or whitespace returns ok false, names it, and the message starts with SECRETS_MESSAGE', async () => {
  const { checkSecrets, SECRETS_MESSAGE } = await T();
  assert.equal(SECRETS_MESSAGE, MESSAGE);
  const both = { TIMINGS_APP_ID: '12345', TIMINGS_APP_PRIVATE_KEY: 'key' };
  assert.deepEqual(checkSecrets(both), { ok: true });
  for (const name of Object.keys(both)) {
    for (const value of ['', '  \n', undefined]) {
      const r = checkSecrets({ ...both, [name]: value });
      assert.equal(r.ok, false, `${name}=${JSON.stringify(value)}`);
      assert.deepEqual(r.missing, [name]);
      assert.ok(r.message.startsWith(MESSAGE), r.message);
      assert.ok(r.message.includes('(docs/required-checks.md, "2. Set up the timings PR identity")'), r.message);
      assert.ok(r.message.includes(name), r.message);
    }
  }
  assert.deepEqual(checkSecrets({}).missing, ['TIMINGS_APP_ID', 'TIMINGS_APP_PRIVATE_KEY']);
});

test('check-secrets CLI with no secrets exits 1 and stderr contains "see the CI gate admin checklist step 2"', () => {
  const r = cli(['check-secrets']);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.ok(r.stderr.includes('::error::' + MESSAGE), r.stderr);
  assert.ok(r.stderr.includes('see the CI gate admin checklist step 2'), r.stderr);
});

test('check-secrets CLI with both secrets exits 0; an unknown subcommand exits 2', () => {
  const ok = cli(['check-secrets'], { PATH: process.env.PATH, TIMINGS_APP_ID: '12345', TIMINGS_APP_PRIVATE_KEY: 'key' });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  const bad = cli(['frobnicate']);
  assert.equal(bad.status, 2, bad.stdout + bad.stderr);
});

// ── the source run ──────────────────────────────────────────────────────────────────────────

test('expectedTimingArtifacts on the real ci.yml returns the 6 names fast-1..4, slow-1..2', async () => {
  const { expectedTimingArtifacts } = await T();
  assert.deepEqual(expectedTimingArtifacts(ciDoc()), ARTIFACTS);
});

test('expectedTimingArtifacts follows ci.yml\'s shard matrices: a fifth fast shard is expected too', async () => {
  const { expectedTimingArtifacts } = await T();
  const doc = ciDoc();
  doc.jobs['test-fast'].strategy.matrix.shard = [1, 2, 3, 4, 5];
  doc.jobs['test-slow'].strategy.matrix.shard = [1];
  assert.deepEqual(expectedTimingArtifacts(doc), [...ARTIFACTS.slice(0, 4), 'test-timings-fast-5', 'test-timings-slow-1']);
});

test('expectedTimingArtifacts throws when test-slow has no shard matrix (and when test-fast has none)', async () => {
  const { expectedTimingArtifacts } = await T();
  for (const id of ['test-slow', 'test-fast']) {
    const doc = ciDoc();
    delete doc.jobs[id].strategy.matrix.shard;
    assert.throws(() => expectedTimingArtifacts(doc), { message: 'ci.yml has no test-fast/test-slow shard matrix' }, id);
  }
});

test('pickTimingsRun returns the newest qualifying run, skipping a failed run, a pull_request run, a run missing test-timings-slow-2 and a run whose fast-3 is expired', async () => {
  const { pickTimingsRun } = await T();
  const runs = [ghRun(900, { conclusion: 'failure' }), ghRun(800, { event: 'pull_request' }), ghRun(700), ghRun(600), ghRun(500), ghRun(400)];
  const have = {
    900: artifacts(), 800: artifacts(), 700: artifacts({ without: ['test-timings-slow-2'] }),
    600: artifacts({ expired: ['test-timings-fast-3'] }), 500: artifacts(), 400: artifacts(),
  };
  const asked = [];
  const got = await pickTimingsRun(runs, async (id) => { asked.push(id); return have[id]; }, ARTIFACTS);
  assert.deepEqual(got, runs[4]);
  assert.deepEqual(asked, [700, 600, 500]);
});

test('pickTimingsRun returns null when none of 30 qualifies, and never asks for a filtered-out run\'s artifacts', async () => {
  const { pickTimingsRun } = await T();
  const filtered = [{ event: 'pull_request' }, { headBranch: 'feature' }, { status: 'in_progress', conclusion: '' }, { conclusion: 'cancelled' }, { conclusion: 'failure' }];
  const runs = Array.from({ length: 30 }, (_, i) => ghRun(1000 - i, i < filtered.length ? filtered[i] : {}));
  const asked = [];
  const got = await pickTimingsRun(runs, async (id) => { asked.push(id); return artifacts({ without: ['test-timings-fast-1'] }); }, ARTIFACTS);
  assert.equal(got, null);
  assert.deepEqual(asked, runs.slice(filtered.length).map((r) => r.databaseId));
});

test('pick downloads the newest green dev push run with every timing artifact and writes source-run.json with the post-merge run\'s spread', posix, () => withStubs({
  runs: [
    ghRun(900, { createdAt: '2026-11-26T10:00:00Z' }),
    ghRun(700, { createdAt: '2026-11-24T10:00:00Z' }),
    ghRun(600, { createdAt: '2026-11-17T10:00:00Z' }),
  ],
  artifacts: { 900: artifacts({ without: ['test-timings-fast-4'] }), 700: artifacts(), 600: artifacts() },
  merged: [{ mergedAt: '2026-11-23T09:00:00Z' }],
  jobs: { 700: shardJobs() },
}, ({ dir, env, calls }) => {
  const d = join(dir, 'timings', 'artifacts');
  const r = cli(['pick', '--dir', d], env);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const gh = calls('gh').map((c) => c.args);
  const list = gh.find((a) => a[0] === 'run' && a[1] === 'list').join(' ');
  for (const part of ['-w ci.yml', '-b dev', '-e push', '-s success', '-L 30']) assert.ok(list.includes(part), `${part} in: ${list}`);
  const downloads = gh.filter((a) => a[0] === 'run' && a[1] === 'download');
  assert.deepEqual(downloads, [['run', 'download', '700', '--pattern', 'test-timings-*', '--dir', d]]);
  const source = JSON.parse(readFileSync(join(dir, 'timings', 'source-run.json'), 'utf8'));
  assert.equal(source.id, 700);
  assert.equal(source.url, url(700));
  assert.equal(source.headSha, ghRun(700).headSha);
  assert.equal(source.postMerge.run.url, url(700), 'the oldest green dev push run since the last refresh merged');
  assert.equal(source.postMerge.spread.spreadS, 95);
  assert.equal(source.postMerge.mergedAt, '2026-11-23T09:00:00Z');
  const since = gh.filter((a) => a[0] === 'run' && a[1] === 'list' && a.includes('--created'));
  assert.equal(since.length, 1, 'one run list for the runs since the merge');
  assert.equal(flag(since[0], '--created'), '>=2026-11-23T09:00:00Z');
  const output = readFileSync(env.GITHUB_OUTPUT, 'utf8').split('\n');
  assert.ok(output.includes('id=700') && output.includes(`url=${url(700)}`), output.join('\n'));
}));

test('pick with no refresh PR merged yet writes postMerge null', posix, () => withStubs(
  { runs: [ghRun(700)], artifacts: { 700: artifacts() }, merged: [] },
  ({ dir, env }) => {
    const r = cli(['pick', '--dir', join(dir, 'timings', 'artifacts')], env);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(JSON.parse(readFileSync(join(dir, 'timings', 'source-run.json'), 'utf8')).postMerge, null);
  }));

test('pick finds the post-merge run beyond the 30 runs it picks the source from: the oldest green dev push run since the merge', posix, () => {
  // 40 green runs a day apart, newest first; the refresh merged before the 35th newest.
  const runs = Array.from({ length: 40 }, (_, i) => ghRun(1000 - i, { createdAt: new Date(Date.parse('2026-11-26T10:00:00Z') - i * 86_400_000).toISOString() }));
  return withStubs({ runs, artifacts: { 1000: artifacts() }, merged: [{ mergedAt: runs[34].createdAt }], jobs: { 966: shardJobs() } }, ({ dir, env }) => {
    const r = cli(['pick', '--dir', join(dir, 'timings', 'artifacts')], env);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const { postMerge } = JSON.parse(readFileSync(join(dir, 'timings', 'source-run.json'), 'utf8'));
    assert.equal(postMerge.run.databaseId, 966);
    assert.equal(postMerge.spread.spreadS, 95);
  });
});

test('pick after a merge with no green run since writes run null with mergedAt, and with more runs since than it lists writes truncated', posix, () => {
  const mergedAt = '2026-11-23T09:00:00Z';
  const read = (dir) => JSON.parse(readFileSync(join(dir, 'timings', 'source-run.json'), 'utf8')).postMerge;
  withStubs({ runs: [ghRun(700, { createdAt: '2026-11-22T10:00:00Z' })], artifacts: { 700: artifacts() }, merged: [{ mergedAt }] }, ({ dir, env }) => {
    assert.equal(cli(['pick', '--dir', join(dir, 'timings', 'artifacts')], env).status, 0);
    assert.deepEqual(read(dir), { mergedAt, run: null });
  });
  const many = Array.from({ length: 205 }, (_, i) => ghRun(5000 - i, { createdAt: new Date(Date.parse('2026-11-26T10:00:00Z') - i * 60_000).toISOString() }));
  withStubs({ runs: many, artifacts: { 5000: artifacts() }, merged: [{ mergedAt }] }, ({ dir, env }) => {
    assert.equal(cli(['pick', '--dir', join(dir, 'timings', 'artifacts')], env).status, 0);
    assert.deepEqual(read(dir), { mergedAt, run: null, truncated: true });
  });
});

test('pick exits 1 naming the missing artifacts and downloads nothing when no run qualifies', posix, () => withStubs(
  { runs: [ghRun(700)], artifacts: { 700: artifacts({ expired: ARTIFACTS }) } },
  ({ dir, env, calls }) => {
    const r = cli(['pick', '--dir', join(dir, 'artifacts')], env);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.ok((r.stdout + r.stderr).includes('no green dev push run among the last 30 has every timing artifact (test-timings-fast-1, '), r.stdout + r.stderr);
    assert.deepEqual(calls('gh').filter((c) => c.args[1] === 'download'), []);
  }));

test('pick exits 2 on a gh error', posix, () => withStubs({ ghDown: true }, ({ dir, env, calls }) => {
  const r = cli(['pick', '--dir', join(dir, 'artifacts')], env);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.ok(calls('gh').length > 0);
}));

// ── the PR body ─────────────────────────────────────────────────────────────────────────────

test('postMergeRun returns the oldest green dev push run created at or after mergedAt, and null for a null mergedAt', async () => {
  const { postMergeRun } = await T();
  const at = (d) => `2026-11-${d}T10:00:00Z`;
  const runs = [
    ghRun(6, { createdAt: at(26) }),
    ghRun(5, { createdAt: at(25) }),
    ghRun(4, { createdAt: at(24), conclusion: 'failure' }),
    ghRun(3, { createdAt: at(23), event: 'pull_request' }),
    ghRun(2, { createdAt: at(20) }),
  ];
  assert.equal(postMergeRun(runs, at(22)).databaseId, 5);
  assert.equal(postMergeRun(runs, at(26)).databaseId, 6, 'created exactly at the merge counts');
  assert.equal(postMergeRun(runs, at(27)), null);
  assert.equal(postMergeRun(runs, null), null);
});

test('shardSpread returns 95 s for 4 Node 24 shards ending 95 s apart, ignores Node 22.19.0/26 jobs, and returns null with 3 completed shards', async () => {
  const { shardSpread } = await T();
  assert.equal(shardSpread(shardJobs(), 4).spreadS, 95);
  const three = shardJobs().map((j) => (j.name === 'fast tests (Node 24, 2/4)' ? { ...j, conclusion: null, completed_at: null } : j));
  assert.equal(shardSpread(three, 4), null);
});

test('diffTimings counts added, removed and re-timed keys', async () => {
  const { diffTimings } = await T();
  assert.deepEqual(diffTimings({ a: 1, b: 2, c: 3 }, { a: 1, b: 5, d: 4, e: 6 }), { added: 2, removed: 1, retimed: 1 });
});

test('pushFailureMessage names the Workflows cause only for stderr with "refusing to allow a GitHub App to create or update workflow", and always carries git\'s stderr and the recovery hint', async () => {
  const { pushFailureMessage } = await T();
  const other = "fatal: unable to access 'https://github.com/o/r.git/': The requested URL returned error: 503";
  for (const [stderr, workflows] of [[REFUSAL, true], [other, false]]) {
    const message = pushFailureMessage(stderr);
    assert.ok(message.includes(stderr), message);
    assert.ok(message.includes(HINT), message);
    // git's own text names `workflows` permission, so look at what the tool added to it.
    assert.equal(/Workflows permission/.test(message.replace(stderr, '')), workflows, message);
  }
});

test('prBody lists the run link, the counts, the untimed count and the post-merge run\'s spread against 2 min, reads "over the 2 min target" at 130 s, and falls back to "not measured" and "no refresh PR merged yet"', async () => {
  const { prBody, shardSpread, TIMINGS_BRANCH, PR_TITLE, SPREAD_TARGET_S } = await T();
  assert.deepEqual([TIMINGS_BRANCH, PR_TITLE, SPREAD_TARGET_S], ['timings-refresh', 'Refresh test timings', 120]);
  const source = { id: 700, databaseId: 700, url: url(700), headSha: 'abc1234def5678abc1234def5678abc1234def56' };
  const diff = { added: 763, removed: 29, retimed: 41 };
  const after = ghRun(555);
  const body = (postMerge) => prBody({ run: source, diff, untimed: 17, postMerge });
  // The last shard ends `s` seconds after the first (10:06:00).
  const spread = (s) => shardSpread(shardJobs(new Date(Date.parse('2026-11-20T10:06:00Z') + s * 1000).toISOString()), 4);

  const within = body({ run: after, spread: spread(95) });
  for (const part of [url(700), 'abc1234', '763', '29', '41', 'untimed after merge: 17', 'Post-merge check', url(555)]) {
    assert.ok(within.includes(part), `${part} in:\n${within}`);
  }
  for (const word of [/added/i, /removed/i, /re-?timed/i, /\b95 ?s\b/, /2 min|120 ?s/]) assert.match(within, word);
  assert.ok(!within.includes('over the 2 min target'), within);
  assert.ok(!body({ run: after, spread: spread(120) }).includes('over the 2 min target'), '120 s is within the target');

  const over = body({ run: after, spread: spread(130) });
  assert.match(over, /\b130 ?s\b/);
  assert.ok(over.includes('over the 2 min target'), over);

  const unread = body({ run: after, spread: null });
  assert.ok(unread.includes("fast-shard spread: not measured (the run's jobs were not readable)"), unread);
  assert.ok(unread.includes(url(555)), unread);

  assert.ok(body(null).includes('no refresh PR merged yet'));
  const mergedAt = '2026-11-23T09:00:00Z';
  const none = body({ mergedAt, run: null });
  assert.ok(none.includes(`no green dev push run since the refresh merged on ${mergedAt}`), none);
  assert.ok(!none.includes('no refresh PR merged yet'), none);
  const truncated = body({ mergedAt, run: null, truncated: true });
  assert.ok(truncated.includes('not measured') && truncated.includes(mergedAt), truncated);
  assert.ok(within.includes('This branch is rebuilt from dev each week; do not push to it.'), within);
});

test('body writes the PR body with the source run link and the count of fast and slow tier files still untimed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-timings-body-'));
  try {
    const tier = [...tierFiles(ROOT, 'fast').files, ...tierFiles(ROOT, 'slow').files];
    const after = Object.fromEntries(tier.slice(3).map((f) => [f, 1])); // three tier files stay untimed
    const f = (n) => join(dir, n);
    writeFileSync(f('source.json'), JSON.stringify({ id: 700, url: url(700), headSha: ghRun(700).headSha, postMerge: null }));
    writeFileSync(f('before.json'), '{}');
    writeFileSync(f('after.json'), JSON.stringify(after));
    const r = cli(['body', '--source', f('source.json'), '--before', f('before.json'), '--after', f('after.json'), '--out', f('body.md')]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const text = readFileSync(f('body.md'), 'utf8');
    assert.ok(text.includes(url(700)), text);
    assert.ok(text.includes('untimed after merge: 3'), text);
    assert.ok(text.includes('no refresh PR merged yet'), text);
  } finally { rmSync(dir, rmOpts); }
});

// ── push ────────────────────────────────────────────────────────────────────────────────────

const PUSH = ['push', '--force', 'origin', 'HEAD:refs/heads/timings-refresh'];

test('push force-pushes HEAD to the one timings-refresh branch', posix, () => withStubs({}, ({ dir, env, calls }) => {
  const r = cli(['push'], env, dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(calls('git').map((c) => c.args), [PUSH]);
}));

test('a refused push exits 1 with ::error::, git\'s stderr, the Workflows cause and the recovery hint', posix, () => withStubs(
  { pushError: REFUSAL },
  ({ dir, env }) => {
    const r = cli(['push'], env, dir);
    const out = r.stdout + r.stderr;
    assert.equal(r.status, 1, out);
    for (const part of ['::error::', REFUSAL, HINT, 'Workflows permission']) assert.ok(out.includes(part), `${part} in:\n${out}`);
  }));

test('a Workflows refusal closes the same-repo refresh PR (never a fork\'s), deletes the branch and pushes it afresh', posix, () => withStubs(
  { pushError: REFUSAL, pushFailures: 1, openPrs: [{ number: 9, isCrossRepository: true }, { number: 7, isCrossRepository: false }] },
  ({ dir, env, calls }) => {
    const r = cli(['push'], { ...env, GH_TOKEN: 'app-token' }, dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const order = calls().map((c) => `${c.tool} ${c.args.join(' ')}`);
    const at = (re) => order.findIndex((l) => re.test(l));
    const closes = order.filter((l) => /^gh pr close /.test(l));
    assert.deepEqual(closes.map((l) => l.split(' ')[3]), ['7'], order.join('\n'));
    const del = at(/^gh api .*-X DELETE|^gh api -X DELETE/);
    assert.ok(del >= 0 && order[del].includes('git/refs/heads/timings-refresh'), order.join('\n'));
    const pushes = order.map((l, i) => [l, i]).filter(([l]) => /^git push/.test(l));
    assert.equal(pushes.length, 2, order.join('\n'));
    assert.ok(at(/^gh pr close /) < del && del < pushes[1][1], order.join('\n'));
    assert.deepEqual(calls('git')[1].args, ['push', 'origin', 'HEAD:refs/heads/timings-refresh']);
    assert.ok(calls('gh').every((c) => c.token === 'app-token'));
  }));

test('a refusal with no open same-repo PR deletes and re-pushes without closing anything; a non-Workflows failure touches no PR or branch', posix, () => {
  withStubs({ pushError: REFUSAL, pushFailures: 1, openPrs: [{ number: 9, isCrossRepository: true }] }, ({ dir, env, calls }) => {
    assert.equal(cli(['push'], env, dir).status, 0);
    assert.deepEqual(calls('gh').filter((c) => c.args[1] === 'close'), []);
    assert.equal(calls('git').length, 2);
  });
  withStubs({ pushError: 'fatal: unable to access: 503', pushFailures: 1 }, ({ dir, env, calls }) => {
    assert.equal(cli(['push'], env, dir).status, 1);
    assert.deepEqual(calls('gh'), []);
    assert.equal(calls('git').length, 1);
  });
});

// ── the workflow ────────────────────────────────────────────────────────────────────────────

const wf = () => readYaml(WORKFLOW);
const steps = () => wf().jobs.refresh.steps;
const runOf = (s) => String(s.run || '');
const stepWith = (needle) => {
  const found = steps().filter((s) => runOf(s).includes(needle));
  assert.equal(found.length, 1, `exactly one step runs "${needle}", got ${found.length}`);
  return found[0];
};
const tokenStep = () => {
  const s = steps().find((x) => String(x.uses || '').startsWith('actions/create-github-app-token@'));
  assert.ok(s, 'a create-github-app-token step');
  return s;
};

/** Run one step's script the way the runner does (bash -e), against the stubs, with ${{ }} expressions filled in. */
function runStep(step, { env, cwd, secrets = '' }) {
  const fill = (v) => String(v).replace(/\$\{\{\s*(.*?)\s*\}\}/g, (_, e) => {
    if (e.startsWith('secrets.')) return secrets;
    if (e.endsWith('.outputs.token')) return 'app-token';
    if (e === 'github.token') return 'actions-token';
    if (e.endsWith('.outputs.id')) return '4242';
    if (e === 'runner.temp') return env.RUNNER_TEMP || tmpdir();
    return 'stub';
  });
  const own = Object.fromEntries(Object.entries({ ...wf().env, ...wf().jobs.refresh.env, ...step.env }).map(([k, v]) => [k, fill(v)]));
  return spawnSync('bash', ['-e', '-c', fill(step.run)], { cwd, encoding: 'utf8', timeout: 60_000, env: { ...env, ...own } });
}

const COMMIT = /\bgit\b.*\scommit\s/;

/** A working folder as the job has it before its write steps: the merged timings and the picked run. */
function jobFolder(dir) {
  for (const d of ['test', '.test-timings']) mkdirSync(join(dir, d), { recursive: true });
  for (const f of [join(dir, 'test', 'timings.json'), join(dir, 'before.json')]) writeFileSync(f, '{}\n');
  writeFileSync(join(dir, '.test-timings', 'source-run.json'), JSON.stringify({ id: 4242, url: url(4242), headSha: 'a'.repeat(40), postMerge: null }));
  return dir;
}

test('workflow: refresh-test-timings.yml has name "Refresh test timings", schedule plus workflow_dispatch and no pull_request, permissions contents read plus actions read only, timeout-minutes 15, and concurrency without cancel-in-progress', () => {
  const doc = wf();
  assert.equal(doc.name, 'Refresh test timings');
  assert.deepEqual(Object.keys(doc.on).sort(), ['schedule', 'workflow_dispatch']);
  assert.deepEqual(doc.on.schedule, [{ cron: '0 3 * * 1' }]);
  assert.deepEqual(doc.permissions, { contents: 'read', actions: 'read' });
  assert.deepEqual(Object.keys(doc.jobs), ['refresh']);
  const j = doc.jobs.refresh;
  assert.equal(j.name, 'refresh test timings');
  assert.equal(j.permissions, undefined, 'the job widens nothing');
  assert.equal(j['timeout-minutes'], 15);
  assert.deepEqual(doc.concurrency, { group: 'refresh-test-timings', 'cancel-in-progress': false });
});

test('workflow: it checks out dev without credentials, then checks the secrets, picks the run and merges it, all before the App token is minted', () => {
  const all = steps();
  const checkout = all.find((s) => String(s.uses || '').startsWith('actions/checkout@'));
  assert.deepEqual(checkout.with, { ref: 'dev', 'persist-credentials': false, 'fetch-depth': 0 });
  const node = all.find((s) => String(s.uses || '').startsWith('actions/setup-node@'));
  assert.equal(node.with['node-version-file'], '.nvmrc');
  const order = [
    stepWith('npm ci --ignore-scripts'),
    stepWith('tools/timings-refresh.mjs check-secrets'),
    stepWith('tools/timings-refresh.mjs pick'),
    stepWith('tools/test-timings-merge.mjs'),
    tokenStep(),
    stepWith('tools/timings-refresh.mjs push'),
  ];
  const at = order.map((s) => all.findIndex((x) => JSON.stringify(x) === JSON.stringify(s)));
  assert.deepEqual(at, [...at].sort((a, b) => a - b), `step order: ${at}`);
  assert.equal(stepWith('tools/timings-refresh.mjs pick').env.GH_TOKEN, '${{ github.token }}');
  assert.match(runOf(stepWith('tools/test-timings-merge.mjs')), /test\/timings\.json[^\n]*before\.json[\s\S]*tools\/test-timings-merge\.mjs/, 'dev\'s timings are copied before the merge');
  for (const s of all) assert.equal(s['continue-on-error'], undefined, 'a refusal stops the job');
});

test('workflow: check-secrets precedes create-github-app-token, the token step passes both secrets with permission-contents and permission-pull-requests write, git add names only test/timings.json, and the push, PR and close steps set GH_TOKEN from the token step', () => {
  const all = steps();
  const index = (pred) => all.findIndex(pred);
  const check = index((s) => runOf(s).includes('check-secrets'));
  assert.ok(check >= 0 && check < index((s) => String(s.uses || '').startsWith('actions/create-github-app-token@')), 'check-secrets first');
  assert.deepEqual(all[check].env, { TIMINGS_APP_ID: '${{ secrets.TIMINGS_APP_ID }}', TIMINGS_APP_PRIVATE_KEY: '${{ secrets.TIMINGS_APP_PRIVATE_KEY }}' });

  const token = tokenStep();
  assert.match(readText(WORKFLOW), /uses: actions\/create-github-app-token@[0-9a-f]{40} # v3\.4\.0\b/);
  assert.equal(token.with['private-key'], '${{ secrets.TIMINGS_APP_PRIVATE_KEY }}');
  assert.ok(Object.values(token.with).includes('${{ secrets.TIMINGS_APP_ID }}'), JSON.stringify(token.with));
  assert.deepEqual(Object.fromEntries(Object.entries(token.with).filter(([k]) => k.startsWith('permission-'))),
    { 'permission-contents': 'write', 'permission-pull-requests': 'write' });
  assert.ok(token.id, 'the token step has an id');

  const adds = all.flatMap((s) => runOf(s).split('\n')).filter((l) => /\bgit\b.*\sadd\s/.test(l));
  assert.equal(adds.length, 1, adds.join('\n'));
  assert.match(adds[0], /\bgit add (-- )?test\/timings\.json(?=\s*($|&&|;))/);

  const writes = all.filter((s) => /gh pr (create|edit|close)|timings-refresh\.mjs push/.test(runOf(s)));
  for (const needle of ['gh pr create', 'gh pr edit', 'gh pr close', 'timings-refresh.mjs push']) {
    assert.ok(writes.some((s) => runOf(s).includes(needle)), needle);
  }
  for (const s of writes) assert.equal(s.env?.GH_TOKEN, `\${{ steps.${token.id}.outputs.token }}`, s.name || s.run);
  const push = runOf(stepWith('timings-refresh.mjs push'));
  assert.ok(push.indexOf('gh auth setup-git') >= 0 && push.indexOf('gh auth setup-git') < push.indexOf('timings-refresh.mjs push'), push);
});

test('a scheduled run with the App secrets missing fails at the check-secrets step with the message naming checklist step 2', posix, () => {
  const step = stepWith('check-secrets');
  assert.equal(step.if, undefined, 'it runs on every event, the schedule included');
  const r = runStep(step, { env: { PATH: process.env.PATH }, cwd: ROOT, secrets: '' });
  assert.notEqual(r.status, 0, r.stdout + r.stderr);
  assert.ok((r.stdout + r.stderr).includes(MESSAGE), r.stdout + r.stderr);
});

test('workflow: when the merged timings equal dev\'s, the run says so, closes an open refresh PR with that line and skips the commit, push and PR steps', posix, () => {
  const step = stepWith('git diff --quiet -- test/timings.json');
  const line = 'test/timings.json already matches ci.yml run 4242';
  const closes = (calls) => calls('gh').filter((c) => c.args[0] === 'pr' && c.args[1] === 'close');
  withStubs({ changed: false, openPr: 7 }, ({ dir, env, calls, reset, configure }) => {
    const cwd = jobFolder(dir);
    const flags = () => readFileSync(env.GITHUB_OUTPUT, 'utf8') + readFileSync(env.GITHUB_ENV, 'utf8');
    const r = runStep(step, { env, cwd });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(r.stdout.includes(line), r.stdout + r.stderr);
    const [close, ...more] = closes(calls);
    assert.ok(close && !more.length, 'one gh pr close');
    assert.ok(['7', 'timings-refresh'].includes(close.args[2]), close.args.join(' '));
    assert.ok(close.args.some((a) => a.includes(line)), close.args.join(' '));
    assert.equal(close.token, 'app-token');
    assert.match(flags(), /^changed=false$/m);
    assert.deepEqual(calls('git').filter((c) => c.args.includes('push')), []);

    reset();
    configure({ changed: false });
    const none = runStep(step, { env, cwd });
    assert.equal(none.status, 0, none.stdout + none.stderr);
    assert.deepEqual(closes(calls), [], 'no open PR: nothing to close');

    reset();
    configure({ changed: true, openPr: 7 });
    writeFileSync(env.GITHUB_OUTPUT, '');
    writeFileSync(env.GITHUB_ENV, '');
    const changed = runStep(step, { env, cwd });
    assert.equal(changed.status, 0, changed.stdout + changed.stderr);
    assert.deepEqual(closes(calls), [], 'new timings: the PR stays open');
    assert.doesNotMatch(flags(), /^changed=false$/m);
  });
  for (const [what, pattern] of [['commit', COMMIT], ['push', /timings-refresh\.mjs push/], ['PR', /gh pr create/]]) {
    const s = steps().find((x) => pattern.test(runOf(x)));
    assert.match(String(s?.if || ''), /changed/, `the ${what} step is skipped when nothing changed`);
  }
});

test('workflow: the commit holds test/timings.json only and names its source run', posix, () => {
  const found = steps().filter((s) => COMMIT.test(runOf(s)));
  assert.equal(found.length, 1, 'one commit step');
  withStubs({ changed: true }, ({ dir, env, calls }) => {
    const r = runStep(found[0], { env, cwd: jobFolder(dir) });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const git = calls('git').map((c) => c.args);
    const adds = git.filter((a) => a.includes('add'));
    assert.deepEqual(adds.map((a) => a.slice(a.indexOf('add') + 1).filter((x) => x !== '--')), [['test/timings.json']]);
    const commit = git.find((a) => a.includes('commit'));
    assert.ok(commit.some((a) => a.includes('Refresh test timings from ci.yml run 4242')), commit.join(' '));
    assert.ok(!commit.slice(commit.indexOf('commit') + 1).some((a) => a === '--all' || /^-[a-z]*a/.test(a)), commit.join(' '));
    assert.ok(JSON.stringify(found[0]).includes('[bot]'), 'authored as the App\'s bot');
  });
});

/** The PR step's `gh pr create|edit` calls with the given open PR (`node tools/… body` is stubbed out). */
function prCalls(openPr, openPrs) {
  const step = stepWith('gh pr create');
  assert.ok(runOf(step).includes('gh pr edit'), 'one step edits or creates');
  return withStubs({ changed: true, openPr, openPrs }, ({ dir, env, calls }) => {
    const r = runStep(step, { env, cwd: jobFolder(dir) });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    return calls('gh').filter((c) => c.args[0] === 'pr' && ['create', 'edit'].includes(c.args[1]));
  }, { node: true });
}

test('a fork\'s open PR from a branch named timings-refresh is never edited or closed: the PR step creates ours, the no-change step closes nothing', posix, () => {
  const fork = { number: 9, isCrossRepository: true };
  const made = prCalls(undefined, [fork]);
  assert.deepEqual(made.map((c) => c.args[1]), ['create'], JSON.stringify(made));
  assert.deepEqual(prCalls(undefined, [fork, { number: 7, isCrossRepository: false }]).map((c) => c.args.slice(1, 3)), [['edit', '7']]);
  withStubs({ changed: false, openPrs: [fork] }, ({ dir, env, calls }) => {
    const r = runStep(stepWith('git diff --quiet -- test/timings.json'), { env, cwd: jobFolder(dir) });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(calls('gh').filter((c) => c.args[1] === 'close'), []);
  });
});

test('workflow: a git error from git diff --quiet fails the step instead of reading as changed', posix, () => withStubs(
  { diffError: true },
  ({ dir, env }) => {
    const r = runStep(stepWith('git diff --quiet -- test/timings.json'), { env, cwd: jobFolder(dir) });
    assert.notEqual(r.status, 0, r.stdout + r.stderr);
    assert.doesNotMatch(readFileSync(env.GITHUB_OUTPUT, 'utf8'), /changed=/);
  }));

// R-ops-3's example: each week the open "Refresh test timings" PR gets a new commit with the new timings.
test('each week the open "Refresh test timings" PR is updated in place: a push to its one branch and an edit, never a second PR', posix, () => {
  assert.match(wf().on.schedule[0].cron, /^\d+ \d+ \* \* [0-6]$/, 'weekly');
  withStubs({}, ({ dir, env, calls }) => {
    assert.equal(cli(['push'], env, dir).status, 0);
    assert.deepEqual(calls('git').map((c) => c.args), [PUSH], 'the new commit lands on the open PR\'s head');
  });
  const made = prCalls(7);
  assert.equal(made.length, 1, JSON.stringify(made));
  const [{ args }] = made;
  assert.equal(args[1], 'edit', args.join(' '));
  assert.ok(['7', 'timings-refresh'].includes(args[2]), args.join(' '));
  assert.equal(flag(args, '--title'), 'Refresh test timings');
  assert.ok(args.includes('--body-file'), args.join(' '));
});

// R-ops-6's example: the refresh PR opened at 03:00 gets all three required checks with nobody pushing to it.
test('the PR the 03:00 run opens starts all three required checks by itself: opened with the App token into dev, where each gating workflow runs on every pull request', posix, () => {
  assert.match(wf().on.schedule[0].cron, /^0 3 /);
  const made = prCalls(undefined);
  assert.equal(made.length, 1, JSON.stringify(made));
  const [{ args, token }] = made;
  assert.equal(args[1], 'create', args.join(' '));
  assert.equal(flag(args, '--base'), 'dev');
  assert.equal(flag(args, '--head'), 'timings-refresh');
  assert.equal(flag(args, '--title'), 'Refresh test timings');
  assert.ok(args.includes('--body-file'), args.join(' '));
  assert.equal(token, 'app-token', 'a PR opened with the Actions token starts no workflow');
  const push = stepWith('timings-refresh.mjs push');
  assert.equal(push.env.GH_TOKEN, `\${{ steps.${tokenStep().id}.outputs.token }}`);
  for (const f of ['ci.yml', 'parity-docker.yml', 'firefox-e2e.yml']) {
    const on = readYaml(`.github/workflows/${f}`).on;
    assert.ok('pull_request' in on, `${f} runs on pull_request`);
    const pr = on.pull_request || {};
    assert.equal(pr.paths ?? pr['paths-ignore'], undefined, `${f} filters no paths`);
    assert.ok(!pr.branches || pr.branches.includes('dev'), `${f} covers dev`);
    assert.ok(!pr.types || ['opened', 'synchronize'].every((t) => pr.types.includes(t)), `${f} runs on open and push`);
  }
});
