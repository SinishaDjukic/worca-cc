// tools/readiness/e2e.mjs — the e2e:* suites of a tree, and the before/after judgement for e2e:extension, whose darwin
// screenshot baselines fail on this machine on untouched dev: same tests pass, same tests fail, same images.
import { existsSync, readdirSync, readFileSync, cpSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { childEnv } from './proc.mjs';
import { diffPng } from '../parity/visual.mjs';

/** Every e2e:* suite in package.json scripts, not the snapshot updaters (`:update-…`), sorted. */
export const e2eScripts = (scripts = {}) => Object.keys(scripts).filter((k) => /^e2e:/.test(k) && !/:update(?:-|$)/.test(k)).sort();
export const SAME_RESULTS = new Set(['e2e:extension']);
/** The job in .github/workflows/firefox-e2e.yml that runs Playwright's Firefox on Linux (pinned by test/extension-packaging). */
export const FIREFOX_CI_JOB = 'firefox-e2e';
/** Suites that `--firefox-in-ci` leaves to CI: headless Playwright Firefox hangs on the macOS dev machine (D13). */
export const CI_ONLY = Object.freeze({ 'e2e:firefox-smoke': FIREFOX_CI_JOB });
const PW = /\bplaywright test\b/;
const IMG = /-(?:actual|diff)\.png$/;

/** Playwright JSON report → { 'file › suite › spec[ › project]': status }. */
export function testResults(rep) {
  if (!rep?.suites) return null;
  const out = {};
  const walk = (s, path) => {
    for (const sp of s.specs ?? []) for (const t of sp.tests ?? []) out[[...path, sp.title, t.projectName].filter(Boolean).join(' › ')] = t.status;
    for (const c of s.suites ?? []) walk(c, [...path, c.title]);
  };
  for (const s of rep.suites) walk(s, [s.title]);
  return out;
}

/** The Playwright outputDir of a script: `-c CONFIG` → CONFIG's dir/test-results (the config's `outputDir`). */
export const resultsDirOf = (script) => join(dirname(/-c\s+(\S+)/.exec(script)?.[1] ?? 'playwright.config.mjs'), 'test-results');

/** One suite in `dir`. Playwright suites also write a JSON report and copy their actual/diff PNGs into evidence. */
export function runSuite(d, dir, name, script, E, tag) {
  const file = `${tag}-${name.replace(/:/g, '-')}`;
  const pw = PW.test(script);
  const json = E(`${file}.json`);
  const r = d.runLogged('npm', ['run', name, ...(pw ? ['--', '--reporter=list,json'] : [])], E(`${file}.log`),
    { cwd: dir, env: { ...childEnv(), ...(pw ? { PLAYWRIGHT_JSON_OUTPUT_NAME: json } : {}) } });
  const res = { name, code: r.code, skipped: /\bSKIP\b/.test(r.text ?? ''), log: `evidence/${file}.log` };
  if (!pw) return res;
  res.results = testResults(existsSync(json) ? JSON.parse(readFileSync(json, 'utf8')) : null);
  const from = join(dir, resultsDirOf(script)); const to = E(`${file}-images`);
  res.images = existsSync(from) ? readdirSync(from, { recursive: true }).map(String).filter((f) => IMG.test(f)).sort() : [];
  if (res.images.length) { mkdirSync(to, { recursive: true }); for (const f of res.images) cpSync(join(from, f), join(to, f)); }
  res.read = (f) => readFileSync(join(to, f));
  res.imagesDir = `evidence/${file}-images`;
  return res;
}

export function judgeSameResults(before, after) {
  if (!before.results || !after.results) return { same: false, problems: ['no Playwright JSON report on a side'], pass: 0, fail: 0, images: 0 };
  const problems = [];
  for (const k of new Set([...Object.keys(before.results), ...Object.keys(after.results)])) {
    if (before.results[k] !== after.results[k]) problems.push(`${k}: ${before.results[k] ?? 'absent'} before, ${after.results[k] ?? 'absent'} after`);
  }
  const imgs = [...new Set([...before.images, ...after.images])].sort();
  for (const f of imgs) {
    if (!before.images.includes(f) || !after.images.includes(f)) { problems.push(`${f}: only ${before.images.includes(f) ? 'before' : 'after'}`); continue; }
    const dp = diffPng(before.read(f), after.read(f));
    if (dp.pixels) problems.push(`${f}: ${dp.note ?? `${dp.pixels} px differ`}`);
  }
  const st = Object.values(after.results);
  return { same: !problems.length, problems, pass: st.filter((s) => s === 'expected' || s === 'flaky').length,
    fail: st.filter((s) => s === 'unexpected').length, images: imgs.length };
}

/**
 * Every e2e suite of `afterDir`; SAME_RESULTS suites also run in `beforeDir` and are judged against it. `memo` (a Map
 * the caller keeps) holds the "before" run per suite, so verify:919 rows i and k run the before suite once, not twice.
 * `ciOnly` ({ suite: CI job }) names suites that are not run here: they are listed as `mode: 'ci'`, `ok: null`, never a
 * pass, and the row is decided by the suites that did run (at least one must).
 */
export function e2eRow(d, beforeDir, afterDir, tag, E, memo = new Map(), { ciOnly = {} } = {}) {
  const scripts = d.scripts(afterDir);
  const list = e2eScripts(scripts).map((name) => {
    if (ciOnly[name]) return { name, mode: 'ci', ok: null, ci: ciOnly[name] };
    const after = runSuite(d, afterDir, name, scripts[name], E, `${tag}-after`);
    if (!SAME_RESULTS.has(name)) return { name, mode: 'green', ok: after.code === 0 && !after.skipped, skipped: after.skipped, after };
    const key = `${beforeDir}\0${name}`;
    if (!memo.has(key)) memo.set(key, runSuite(d, beforeDir, name, scripts[name], E, `${tag}-before`));
    const before = memo.get(key);
    const judge = judgeSameResults(before, after);
    return { name, mode: 'same-before-after', ok: judge.same, judge, before, after };
  });
  const text = list.map((x) => (x.mode === 'ci' ? `${x.name}: CI job ${x.ci}, not run locally`
    : x.mode === 'same-before-after'
      ? `${x.name} ${x.ok ? 'same' : 'NOT same'} before/after (${x.judge.pass} pass, ${x.judge.fail} fail, ${x.judge.images} images${x.ok ? ' identical' : `; ${x.judge.problems[0]}`})`
      : `${x.name} ${x.ok ? 'green' : x.skipped ? 'SKIPPED' : 'FAIL'}`)).join('; ');
  const local = list.filter((x) => x.mode !== 'ci');
  return { ok: local.length > 0 && local.every((x) => x.ok), text,
    notLocal: list.filter((x) => x.mode === 'ci').map(({ name, ci }) => ({ name, ci })),
    list: list.map(({ before, after, ...x }) => ({ ...x, logs: [before?.log, after?.log].filter(Boolean) })) };
}
