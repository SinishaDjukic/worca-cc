// test/ui-boot-speedup.test.mjs — tools/ui-boot-speedup.mjs: the summed per-file CI duration of the UI test files
// moved onto the shared app boot, from 2 CI runs before and 2 after on one runner type, with the run links; and the
// committed "before" snapshot (test/ui-boot-speedup.json), kept because CI drops timing artifacts after 14 days.
// The pure parts on in-memory runs, readRun against a fake `gh`, the CLI in a throwaway copy of the repo with a fake
// `gh` and `git` on PATH (no network, nothing written here).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseRunIds, readRun, buildRecord, convertedFiles, siblingsOf, speedupReport, renderMarkdown,
} from '../tools/ui-boot-speedup.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const F = (stem) => `test/${stem}.test.mjs`;
const linkOf = (id) => `https://github.com/worca-org/worca/actions/runs/${id}`;

const run = (runId, seconds, runner = {}) => ({
  runId, url: linkOf(runId), headSha: `sha-${runId}`, createdAt: '2026-11-25T00:00:00Z', event: 'push',
  runner: { labels: ['ubuntu-latest'], image: 'ubuntu-24.04', ...runner }, seconds,
});
const record = (files, before) => ({ about: 'fixture', files, before });

const refusal = (code, message) => (e) => {
  assert.equal(e.code, code, e.message);
  if (message instanceof RegExp) assert.match(e.message, message);
  else if (message !== undefined) assert.equal(e.message, message);
  return true;
};

// ── parseRunIds ─────────────────────────────────────────────────────────────
test('parseRunIds splits on commas', () => {
  assert.deepEqual(parseRunIds('45715697080,45678611999'), ['45715697080', '45678611999']);
});

test('parseRunIds refuses fewer than 2 runs (too-few-runs)', () => {
  assert.throws(() => parseRunIds('1'), refusal('too-few-runs', 'need 2 runs before and 2 after, got 1'));
});

test('parseRunIds refuses a run listed twice (duplicate-run)', () => {
  assert.throws(() => parseRunIds('1,1'), refusal('duplicate-run', 'run 1 is listed twice'));
});

// ── buildRecord ─────────────────────────────────────────────────────────────
test('buildRecord keeps the listed files, their seconds in each run, and the run facts', () => {
  const runs = [run('1', { [F('a')]: 10, [F('b')]: 20, [F('other')]: 99 }), run('2', { [F('a')]: 12, [F('b')]: 18, [F('other')]: 98 })];
  const r = buildRecord([F('a'), F('b')], runs);
  assert.equal(typeof r.about, 'string');
  assert.deepEqual(r.files, [F('a'), F('b')]);
  assert.equal(r.before.length, 2);
  assert.deepEqual(r.before.map((x) => String(x.runId)), ['1', '2']);
  assert.deepEqual(r.before[0].seconds, { [F('a')]: 10, [F('b')]: 20 });
  assert.deepEqual(r.before[1].seconds, { [F('a')]: 12, [F('b')]: 18 });
  assert.equal(r.before[0].url, linkOf('1'));
  assert.equal(r.before[0].headSha, 'sha-1');
  assert.deepEqual(r.before[0].runner, { labels: ['ubuntu-latest'], image: 'ubuntu-24.04' });
});

test('buildRecord refuses a run that lacks a listed file\'s timing, naming the file and the run (missing-timing)', () => {
  const runs = [run('1', { [F('a')]: 10, [F('b')]: 20 }), run('2', { [F('a')]: 12 })];
  assert.throws(() => buildRecord([F('a'), F('b')], runs), refusal('missing-timing', 'test/b.test.mjs has no timing in run 2'));
});

test('buildRecord refuses runs on two runner images, naming both (runner-mismatch)', () => {
  const runs = [run('1', { [F('a')]: 1 }), run('2', { [F('a')]: 1 }, { image: 'ubuntu-22.04' })];
  assert.throws(() => buildRecord([F('a')], runs), refusal('runner-mismatch', /run 1 ran on ubuntu-latest\/ubuntu-24\.04, run 2 on ubuntu-latest\/ubuntu-22\.04/));
});

test('buildRecord refuses runs with different runner labels (runner-mismatch)', () => {
  const runs = [run('1', { [F('a')]: 1 }), run('2', { [F('a')]: 1 }, { labels: ['ubuntu-latest-8-cores'] })];
  assert.throws(() => buildRecord([F('a')], runs), refusal('runner-mismatch', /ubuntu-latest-8-cores/));
});

test('buildRecord refuses fewer than 2 runs (too-few-runs) and the same run twice (duplicate-run)', () => {
  const one = run('1', { [F('a')]: 1 });
  assert.throws(() => buildRecord([F('a')], [one]), refusal('too-few-runs', 'need 2 runs before and 2 after, got 1'));
  assert.throws(() => buildRecord([F('a')], [one, { ...one }]), refusal('duplicate-run', 'run 1 is listed twice'));
});

// ── the fake gh ─────────────────────────────────────────────────────────────
// What `gh` answers for the runs in `data` (id -> {conclusion?, path?, name?, image?, seconds}), as raw API JSON.
// Self-contained: the CLI tests write its source into a fake `gh` executable.
function answerGh(args, data, fsx, pathx) {
  const joined = args.join(' ');
  if (args.includes('--jq') || args.includes('-q') || args.includes('--template')) throw new Error(`fake gh answers raw JSON only: ${joined}`);
  const known = (id) => { if (!data[id]) throw new Error(`fake gh: no run ${id}: ${joined}`); return data[id]; };
  if (args[0] === 'run' && args[1] === 'download') {
    const id = args.slice(2).find((a) => /^\d+$/.test(a));
    const at = args.findIndex((a) => a === '--dir' || a === '-D');
    if (!args.includes('test-timings-*') || at < 0) throw new Error(`fake gh: want --pattern 'test-timings-*' --dir DIR: ${joined}`);
    const entries = Object.entries(known(id).seconds);
    // two fast shards and one slow shard, laid out as `gh run download` does: DIR/<artifact>/<file>.json
    [['test-timings-fast-1', 'fast-1.json'], ['test-timings-fast-2', 'fast-2.json'], ['test-timings-slow-1', 'slow-1.json']].forEach(([artifact, name], i) => {
      const folder = pathx.join(args[at + 1], artifact);
      fsx.mkdirSync(folder, { recursive: true });
      fsx.writeFileSync(pathx.join(folder, name), JSON.stringify(Object.fromEntries(entries.filter((_, n) => n % 3 === i))));
    });
    return '';
  }
  // Job ids are <run id> followed by 01 (Node 24, shard 1), 02 (Node 24, shard 2), 03 (Node 26), 04 (slow).
  const viewJob = args[0] === 'run' && args[1] === 'view' && args.includes('--job') ? args[args.indexOf('--job') + 1] : null;
  const logJob = viewJob ?? joined.match(/actions\/jobs\/(\d+)\/logs/)?.[1];
  if (logJob) {
    const d = known(logJob.slice(0, -2));
    const image = logJob.endsWith('01') ? (d.image ?? 'ubuntu-24.04') : 'ubuntu-wrong-job';
    return [
      '2026-11-25T22:48:49.0000000Z ##[group]Operating System',
      '2026-11-25T22:48:49.1000000Z Ubuntu',
      '2026-11-25T22:48:49.2000000Z ##[endgroup]',
      '2026-11-25T22:48:49.3000000Z ##[group]Runner Image',
      `2026-11-25T22:48:49.4000000Z Image: ${image}`,
      '2026-11-25T22:48:49.5000000Z Version: 20261122.9.1',
      '2026-11-25T22:48:49.6000000Z Image Release: https://github.com/actions/runner-images/releases/tag/x',
      '2026-11-25T22:48:49.7000000Z ##[endgroup]',
      '',
    ].join('\n');
  }
  const jobsOf = joined.match(/actions\/runs\/(\d+)\/jobs/)?.[1];
  if (jobsOf) {
    known(jobsOf);
    const job = (n, name, labels) => ({ id: Number(`${jobsOf}${n}`), name, labels, conclusion: 'success' });
    const jobs = [
      job('04', 'slow tests (1/2)', ['slow-runner']),
      job('03', 'fast tests (Node 26, 1/4)', ['node-26-runner']),
      job('02', 'fast tests (Node 24, 2/4)', ['ubuntu-latest']),
      job('01', 'fast tests (Node 24, 1/4)', ['ubuntu-latest']),
    ];
    return JSON.stringify({ total_count: jobs.length, jobs });
  }
  const runOf = joined.match(/actions\/runs\/(\d+)(?!\d|\/)/)?.[1];
  if (runOf) {
    const d = known(runOf);
    return JSON.stringify({
      id: Number(runOf), name: d.name ?? 'CI', path: d.path ?? '.github/workflows/ci.yml',
      conclusion: d.conclusion === undefined ? 'success' : d.conclusion, head_sha: `sha-${runOf}`,
      created_at: '2026-11-25T22:43:51Z', html_url: `https://github.com/worca-org/worca/actions/runs/${runOf}`, event: 'push',
    });
  }
  throw new Error(`fake gh: unhandled: ${joined}`);
}

// The exec readRun takes: the `gh` arguments in, its stdout (a string) out.
const fakeExec = (data) => async (...received) => {
  const args = received.find(Array.isArray) ?? received.flat().filter((a) => typeof a === 'string');
  return answerGh(args[0] === 'gh' ? args.slice(1) : args, data, fs, path);
};

const tempDir = (t) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'worca-cc-speedup-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  return dir;
};

// ── readRun ─────────────────────────────────────────────────────────────────
test('readRun reads the run, the Node 24 fast shards\' labels, the shard-1 image and every timing artifact', async (t) => {
  const seconds = { [F('a')]: 10.5, [F('b')]: 20, [F('c')]: 3, [F('d')]: 4 };
  const r = await readRun('101', { exec: fakeExec({ 101: { image: 'ubuntu-26.04', seconds } }), dir: tempDir(t) });
  assert.equal(String(r.runId), '101');
  assert.equal(r.url, linkOf('101'));
  assert.equal(r.headSha, 'sha-101');
  assert.equal(r.createdAt, '2026-11-25T22:43:51Z');
  assert.equal(r.event, 'push');
  assert.deepEqual(r.runner, { labels: ['ubuntu-latest'], image: 'ubuntu-26.04' });
  assert.deepEqual(r.seconds, seconds);
});

test('readRun refuses a run that did not succeed (not-green)', async (t) => {
  const exec = fakeExec({ 5: { conclusion: 'failure', seconds: {} } });
  await assert.rejects(readRun('5', { exec, dir: tempDir(t) }), refusal('not-green', 'run 5 is not a successful ci.yml run (conclusion failure)'));
});

test('readRun refuses a run of another workflow (not-ci)', async (t) => {
  const exec = fakeExec({ 5: { path: '.github/workflows/quarantine.yml', name: 'Quarantine', seconds: {} } });
  await assert.rejects(readRun('5', { exec, dir: tempDir(t) }), refusal('not-ci', /^run 5 is workflow .*quarantine.*, not ci\.yml$/i));
});

// ── convertedFiles and siblingsOf ───────────────────────────────────────────
test('convertedFiles returns the record\'s files that left the offender list', () => {
  const rec = record([F('a'), F('b'), F('c')], []);
  assert.deepEqual(convertedFiles(rec, [F('b')], () => true), [F('a'), F('c')]);
});

test('convertedFiles refuses a converted file that no longer exists (file-gone)', () => {
  const rec = record([F('a'), F('b')], []);
  assert.throws(() => convertedFiles(rec, [F('b')], (f) => f !== F('a')),
    refusal('file-gone', 'test/a.test.mjs is no longer on the offender list and no longer exists'));
});

test('siblingsOf counts a prefix-named file only when it boots through the shared helper and is no listed file, for the longest stem only', () => {
  const converted = [F('a'), F('a-b')];
  const topLevel = ['a', 'a-b', 'a-b-c', 'a-d', 'a-no-shared', 'a-listed', 'ab', 'other'].map(F);
  const shared = (f) => f !== F('a-no-shared');
  const excluded = new Set([F('a'), F('a-b'), F('a-listed')]);
  assert.deepEqual(siblingsOf(F('a'), converted, topLevel, shared, excluded), [F('a-d')],
    'a-b is converted itself, a-b-c belongs to a-b, a-no-shared and a-listed count for nobody, ab is no prefix');
  assert.deepEqual(siblingsOf(F('a-b'), converted, topLevel, shared, excluded), [F('a-b-c')]);
});

// ── speedupReport ───────────────────────────────────────────────────────────
const small = () => {
  const files = [F('a'), F('b')];
  const rec = record(files, [run('A', { [F('a')]: 10, [F('b')]: 20 }), run('B', { [F('a')]: 12, [F('b')]: 18 })]);
  const sib = F('a-deep-link');
  const after = ['C', 'D'].map((id) => run(id, { [F('a')]: 4, [sib]: 1, [F('b')]: 7 }));
  return { rec, after, files, siblings: { [F('a')]: [sib], [F('b')]: [] } };
};
const rowsOf = (report) => Object.fromEntries(report.rows.map((r) => [r.file, [r.before, r.after]]));

test('speedupReport takes each file\'s mean of the 2 runs, adds its siblings after, and sums them into the headline', () => {
  const { rec, after, files, siblings } = small();
  const r = speedupReport(rec, after, files, siblings);
  assert.deepEqual(rowsOf(r), { [F('a')]: [11, 5], [F('b')]: [19, 7] });
  assert.equal(r.before, 30);
  assert.equal(r.after, 12);
  assert.equal(r.lower, true);
  assert.equal(r.headline, 'converted ui-* files: 30 s → 12 s (runs A, B → C, D)');
});

// R-qa-4's example, to the letter.
const example = () => {
  const x = F('ui-running-detail');
  const y = F('ui-history');
  const sib = F('ui-history-deep-link');
  const rec = record([x, y], [run('A', { [x]: 1190, [y]: 1261 }), run('B', { [x]: 1170, [y]: 1253 })]);
  const after = [run('C', { [x]: 399, [y]: 425, [sib]: 70 }), run('D', { [x]: 405, [y]: 431, [sib]: 70 })];
  return { rec, after, files: [x, y], siblings: { [x]: [], [y]: [sib] } };
};

test('R-qa-4 example: converted ui-* files: 2437 s → 900 s (runs A, B → C, D)', () => {
  const { rec, after, files, siblings } = example();
  const r = speedupReport(rec, after, files, siblings);
  assert.equal(r.headline, 'converted ui-* files: 2437 s → 900 s (runs A, B → C, D)');
});

test('speedupReport counts only the converted files: a record file still on the list adds nothing', () => {
  const rec = record([F('a'), F('listed')], [run('A', { [F('a')]: 10, [F('listed')]: 500 }), run('B', { [F('a')]: 10, [F('listed')]: 500 })]);
  const after = [run('C', { [F('a')]: 3 }), run('D', { [F('a')]: 3 })];
  const r = speedupReport(rec, after, [F('a')], { [F('a')]: [] });
  assert.equal(r.before, 10);
  assert.equal(r.after, 3);
  assert.deepEqual(r.rows.map((x) => x.file), [F('a')]);
});

test('speedupReport rounds the totals of the means, not each mean, to whole seconds', () => {
  const rec = record([F('a'), F('b')], [run('A', { [F('a')]: 10.4, [F('b')]: 20.4 }), run('B', { [F('a')]: 10.4, [F('b')]: 20.4 })]);
  const after = ['C', 'D'].map((id) => run(id, { [F('a')]: 1.3, [F('b')]: 2.3 }));
  const r = speedupReport(rec, after, [F('a'), F('b')], { [F('a')]: [], [F('b')]: [] });
  assert.equal(r.before, 31);
  assert.equal(r.after, 4);
});

test('speedupReport: an after total equal to the before total is not lower', () => {
  const rec = record([F('a')], [run('A', { [F('a')]: 10 }), run('B', { [F('a')]: 12 })]);
  const r = speedupReport(rec, [run('C', { [F('a')]: 11 }), run('D', { [F('a')]: 11 })], [F('a')], { [F('a')]: [] });
  assert.equal(r.before, 11);
  assert.equal(r.after, 11);
  assert.equal(r.lower, false);
});

test('speedupReport refuses an after run that lacks a converted file or a sibling, naming the file and the run (missing-timing)', () => {
  const { rec, after, files, siblings } = small();
  const without = (r, file) => ({ ...r, seconds: Object.fromEntries(Object.entries(r.seconds).filter(([f]) => f !== file)) });
  assert.throws(() => speedupReport(rec, [after[0], without(after[1], F('b'))], files, siblings),
    refusal('missing-timing', 'test/b.test.mjs has no timing in run D'));
  assert.throws(() => speedupReport(rec, [without(after[0], F('a-deep-link')), after[1]], files, siblings),
    refusal('missing-timing', 'test/a-deep-link.test.mjs has no timing in run C'));
});

test('speedupReport refuses after runs on another runner image than the before runs (runner-mismatch)', () => {
  const { rec, after, files, siblings } = small();
  const moved = after.map((r) => ({ ...r, runner: { labels: ['ubuntu-latest'], image: 'ubuntu-26.04' } }));
  assert.throws(() => speedupReport(rec, moved, files, siblings), (e) => {
    assert.equal(e.code, 'runner-mismatch', e.message);
    assert.match(e.message, /ubuntu-latest\/ubuntu-24\.04/);
    assert.match(e.message, /ubuntu-latest\/ubuntu-26\.04/);
    return true;
  });
});

// ── renderMarkdown ──────────────────────────────────────────────────────────
test('renderMarkdown: headline, the 4 linked runs with their sums, the runner line, one row per converted file and the totals', () => {
  const { rec, after, files, siblings } = example();
  const report = speedupReport(rec, after, files, siblings);
  const md = renderMarkdown(report, rec, after);
  const lines = md.split('\n');
  const at = (re, what) => {
    const i = lines.findIndex((l) => re.test(l));
    assert.ok(i >= 0, `${what} is in the report:\n${md}`);
    return i;
  };
  assert.ok(lines.find((l) => l.trim()).includes(report.headline), `the page opens with the headline:\n${md}`);

  // each run: its link and, on the same line, the seconds that run took for the converted files (siblings included)
  const runLines = [['A', 2451], ['B', 2423], ['C', 894], ['D', 906]].map(([id, sum]) => at(
    new RegExp(`(?=.*${linkOf(id)}(?![\\w-]))(?=.*(?<![\\d.])${sum} s)`), `the link of run ${id} with its ${sum} s`));
  assert.deepEqual(runLines, [...runLines].sort((a, b) => a - b), 'before runs first, then after runs');

  const runner = at(/Runner, all four: `?ubuntu-latest \/ ubuntu-24\.04`?/, 'the runner line');
  const head = at(/^\|.*File.*\|.*Before.*\|.*After.*\|/, 'the table head');
  const total = at(/^\|.*Total.*\|/, 'the Total row');
  assert.ok(runLines[3] < runner && runner < head && head < total, 'runs, runner line, table, in that order');
  assert.match(lines[total], /\b2437 s\b.*\b900 s\b/);

  const body = lines.slice(head + 1, total).filter((l) => l.startsWith('|') && !/^\|[\s:|-]+\|$/.test(l));
  assert.equal(body.length, files.length, 'one row per converted file; a sibling has no row of its own');
  assert.match(body.find((l) => l.includes('ui-running-detail')) ?? '', /\b1180 s\b.*\b402 s\b/);
  assert.match(body.find((l) => l.includes('ui-history')) ?? '', /\b1257 s\b.*\b498 s\b/);
});

// ── the CLI, in a throwaway copy of the repo ────────────────────────────────
const skipCli = process.platform === 'win32' && 'the fake gh and git are shebang scripts';

// A copy of the tool and its imports, a test/ of its own, and fake `gh` and `git` on PATH.
function sandbox(t, { runs, files, listed = [], rec = null }) {
  const dir = tempDir(t);
  fs.cpSync(path.join(ROOT, 'tools'), path.join(dir, 'tools'), { recursive: true });
  for (const link of ['src', 'node_modules']) fs.symlinkSync(path.join(ROOT, link), path.join(dir, link));
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(dir, 'package.json'));
  fs.mkdirSync(path.join(dir, 'test'));
  fs.mkdirSync(path.join(dir, 'docs'));
  for (const f of ['tiers.json', 'quarantine.json']) fs.copyFileSync(path.join(ROOT, 'test', f), path.join(dir, 'test', f));
  for (const f of files) fs.writeFileSync(path.join(dir, f), '');
  fs.writeFileSync(path.join(dir, 'test', 'suite-guard-offenders.json'), JSON.stringify({ about: 'fixture', perTestBoot: listed }));
  if (rec) fs.writeFileSync(path.join(dir, 'test', 'ui-boot-speedup.json'), JSON.stringify(rec));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'package.json'), '{"type":"commonjs"}');   // the fake gh and git use require()
  const script = (name, body) => fs.writeFileSync(path.join(bin, name), `#!${process.execPath}\n${body}\n`, { mode: 0o755 });
  script('gh', [
    "const fsx = require('node:fs'); const pathx = require('node:path');",
    `const answerGh = ${answerGh.toString()};`,
    `try { process.stdout.write(answerGh(process.argv.slice(2), ${JSON.stringify(runs)}, fsx, pathx)); }`,
    'catch (e) { console.error(e.message); process.exit(1); }',
  ].join('\n'));
  // slice 11's list, as `git show 54ae95625:test/suite-guard-offenders.json` prints it
  script('git', [
    'const a = process.argv.slice(2);',
    "if (a.includes('show') && a.some((x) => /^54ae95625[0-9a-f]*:test\\/suite-guard-offenders\\.json$/.test(x))) {",
    `  process.stdout.write(${JSON.stringify(JSON.stringify({ perTestBoot: files }))});`,
    "} else { console.error('fake git: unhandled: ' + a.join(' ')); process.exit(1); }",
  ].join('\n'));
  const cli = (...args) => spawnSync(process.execPath, [path.join(dir, 'tools', 'ui-boot-speedup.mjs'), ...args], {
    cwd: dir, encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, NODE_TEST_CONTEXT: undefined, FORCE_COLOR: undefined },
  });
  return { dir, cli, has: (rel) => fs.existsSync(path.join(dir, rel)), read: (rel) => fs.readFileSync(path.join(dir, rel), 'utf8') };
}

const CLI_FILES = [F('a'), F('b')];
const timed = (a, b) => ({ seconds: { [F('a')]: a, [F('b')]: b } });

test('record writes test/ui-boot-speedup.json: slice 11\'s files and the 2 before runs', { skip: skipCli }, (t) => {
  const box = sandbox(t, { runs: { 101: timed(10, 20), 102: timed(12, 18) }, files: CLI_FILES });
  const r = box.cli('record', '--before', '101,102');
  assert.equal(r.status, 0, r.stderr);
  const saved = JSON.parse(box.read('test/ui-boot-speedup.json'));
  assert.deepEqual(saved.files, CLI_FILES);
  assert.deepEqual(saved.before.map((x) => String(x.runId)), ['101', '102']);
  assert.deepEqual(saved.before.map((x) => x.url), [linkOf('101'), linkOf('102')]);
  assert.deepEqual(saved.before[1].seconds, timed(12, 18).seconds);
  assert.deepEqual(saved.before[0].runner, { labels: ['ubuntu-latest'], image: 'ubuntu-24.04' });
});

test('a refused record leaves no file', { skip: skipCli }, (t) => {
  const box = sandbox(t, {
    files: CLI_FILES,
    runs: {
      101: timed(10, 20),
      102: { ...timed(12, 18), conclusion: 'failure' },
      103: { seconds: { [F('a')]: 1 } },
      104: { ...timed(1, 1), image: 'ubuntu-22.04' },
      105: { ...timed(1, 1), path: '.github/workflows/quarantine.yml', name: 'Quarantine' },
    },
  });
  const cases = [
    ['101', /need 2 runs before and 2 after, got 1/],
    ['101,101', /run 101 is listed twice/],
    ['101,102', /run 102 is not a successful ci\.yml run \(conclusion failure\)/],
    ['101,103', /test\/b\.test\.mjs has no timing in run 103/],
    ['101,104', /ubuntu-22\.04/],
    ['101,105', /run 105 is workflow .*, not ci\.yml/],
  ];
  for (const [ids, message] of cases) {
    const r = box.cli('record', '--before', ids);
    assert.equal(r.status, 1, `record --before ${ids}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, message);
    assert.equal(box.has('test/ui-boot-speedup.json'), false, `record --before ${ids} wrote nothing`);
  }
});

const cliRecord = () => record(CLI_FILES, [run('101', timed(10, 20).seconds), run('102', timed(12, 18).seconds)]);

test('report prints the Markdown and, with --write, saves it as docs/ui-boot-speedup.md', { skip: skipCli }, (t) => {
  const box = sandbox(t, { runs: { 103: timed(4, 7), 104: timed(6, 7) }, files: CLI_FILES, rec: cliRecord() });
  const printed = box.cli('report', '--after', '103,104');
  assert.equal(printed.status, 0, printed.stderr);
  assert.match(printed.stdout, /converted ui-\* files: 30 s → 12 s \(runs 101, 102 → 103, 104\)/);
  assert.equal(box.has('docs/ui-boot-speedup.md'), false, 'without --write nothing is saved');
  const written = box.cli('report', '--after', '103,104', '--write');
  assert.equal(written.status, 0, written.stderr);
  const page = box.read('docs/ui-boot-speedup.md');
  assert.match(page.split('\n').find((l) => l.trim()), /converted ui-\* files: 30 s → 12 s/);
  assert.ok(page.includes(linkOf('104')));
});

test('report exits 1 with not-lower when after is not lower than before, and writes nothing', { skip: skipCli }, (t) => {
  const box = sandbox(t, { runs: { 103: timed(11, 19), 104: timed(11, 19) }, files: CLI_FILES, rec: cliRecord() });
  const r = box.cli('report', '--after', '103,104', '--write');
  assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /after 30 s is not lower than before 30 s/);
  assert.equal(box.has('docs/ui-boot-speedup.md'), false);
});

test('a refused report writes no page: too few runs, a repeated run, a missing timing, another runner', { skip: skipCli }, (t) => {
  const box = sandbox(t, {
    files: CLI_FILES, rec: cliRecord(),
    runs: { 103: timed(4, 7), 104: { seconds: { [F('a')]: 1 } }, 105: { ...timed(1, 1), image: 'ubuntu-22.04' }, 106: { ...timed(1, 1), image: 'ubuntu-22.04' } },
  });
  const cases = [
    ['103', /need 2 runs before and 2 after, got 1/],
    ['103,103', /run 103 is listed twice/],
    ['103,104', /test\/b\.test\.mjs has no timing in run 104/],
    ['105,106', /ubuntu-22\.04/],
  ];
  for (const [ids, message] of cases) {
    const r = box.cli('report', '--after', ids, '--write');
    assert.equal(r.status, 1, `report --after ${ids}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, message);
    assert.equal(box.has('docs/ui-boot-speedup.md'), false, `report --after ${ids} wrote nothing`);
  }
});

test('the CLI exits 2 on a usage error', { skip: skipCli }, (t) => {
  const box = sandbox(t, { runs: {}, files: CLI_FILES });
  for (const args of [[], ['nonsense'], ['record'], ['report']]) {
    const r = box.cli(...args);
    assert.equal(r.status, 2, `ui-boot-speedup ${args.join(' ')}: ${r.stdout}${r.stderr}`);
    assert.notEqual(r.stderr.trim(), '');
  }
});

// ── the committed before snapshot ───────────────────────────────────────────
// sha256 of slice 11's 196 files (test/suite-guard-offenders.json at 54ae95625), joined with "\n". Pinned here
// because CI checkouts are shallow and cannot read that commit.
const SLICE_11_FILES = '164c72d018d425ae15585e1934e4058a7bd9550af72fee0dc42070f80aabb967';

test('the committed test/ui-boot-speedup.json holds 2 green dev-push runs on one runner, with seconds for slice 11\'s 196 files', () => {
  const saved = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'ui-boot-speedup.json'), 'utf8'));
  assert.equal(saved.files.length, 196);
  assert.equal(createHash('sha256').update(saved.files.join('\n')).digest('hex'), SLICE_11_FILES, 'files is slice 11\'s list, in its order');
  assert.deepEqual(saved.before.map((r) => String(r.runId)).sort(), ['45678611999', '45715697080']);
  assert.deepEqual(saved.before[1].runner, saved.before[0].runner, 'one runner type');
  assert.ok(saved.before[0].runner.labels.length > 0 && /^ubuntu-/.test(saved.before[0].runner.image));
  for (const r of saved.before) {
    assert.equal(r.url, linkOf(r.runId));
    assert.equal(r.event, 'push');
    assert.deepEqual(saved.files.filter((f) => !(Number.isFinite(r.seconds[f]) && r.seconds[f] > 0)), [], `run ${r.runId} times every file`);
  }
});
