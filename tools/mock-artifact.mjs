#!/usr/bin/env node
// tools/mock-artifact.mjs — builds the mock artifact: the real web UI as one offline HTML page on demo data
// (docs/screenshots.md#mock-artifact). NOT part of `npm test`: it needs Chrome and boots a real server.
//
//   npm run mock:artifact                   record (~10 min), build, check: .mock-artifact/worca-mock.html
//   … -- --reuse                            build from the saved recording (pr-assets/mock-artifact) instead
//   … -- --serve                            at the end, serve the page on 127.0.0.1 and open it in the browser
//   … -- --save-recording                   after a passing check, commit rec.json to pr-assets/mock-artifact and push
//   … -- --out DIR | --no-check | --max-diff N | --remote NAME | --port N
//
// The built page also opens straight from disk (double-click worca-mock.html).
// Steps: tools/readme-screenshots.mjs --record seeds its sandbox and records the session (mock-artifact/record.mjs),
// mock-artifact/build.mjs turns rec.json into the page, mock-artifact/check.mjs walks the page and pixel-diffs it
// against the real app's shots. --reuse skips the recording, so the check reports unanswered requests only.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMockPage } from './mock-artifact/build.mjs';
import { checkMock, printReport, serveDir } from './mock-artifact/check.mjs';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); if (i === -1) return null; const v = args[i + 1]; return v && !v.startsWith('--') ? v : ''; };
const REPO = fileURLToPath(new URL('..', import.meta.url));
const OUT = path.resolve(flag('--out') || path.join(REPO, '.mock-artifact'));
const REMOTE = flag('--remote') || 'origin';
const ASSETS_BRANCH = 'pr-assets/mock-artifact';
const REC = path.join(OUT, 'rec.json');
const git = (argv, opts = {}) => String(execFileSync('git', argv, { cwd: REPO, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts }) ?? '').trim();
const log = (m) => process.stderr.write(`[mock-artifact] ${m}\n`);

await mkdir(OUT, { recursive: true });
// Shots of an older recording would be compared against the wrong data.
await rm(path.join(OUT, 'real-shots'), { recursive: true, force: true });
await rm(path.join(OUT, 'mock-shots'), { recursive: true, force: true });

if (args.includes('--reuse')) {
  log(`fetching rec.json from ${REMOTE}/${ASSETS_BRANCH}`);
  git(['fetch', '--quiet', REMOTE, `refs/heads/${ASSETS_BRANCH}`]);
  await writeFile(REC, execFileSync('git', ['show', 'FETCH_HEAD:rec.json'], { cwd: REPO, maxBuffer: 1 << 30 }));
} else {
  const port = flag('--port') || '4398';
  log('recording (about 10 minutes)');
  const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(REPO, 'tools/readme-screenshots.mjs'), '--record', REC, '--port', port],
    { cwd: REPO, stdio: 'inherit' });
  if (r.status !== 0) { log('recording failed'); process.exit(r.status || 1); }
}

const rec = JSON.parse(await readFile(REC, 'utf8'));
const page = path.join(OUT, 'worca-mock.html');
await writeFile(page, await buildMockPage(rec));
log(`built ${page}`);

if (!args.includes('--no-check')) {
  const maxDiff = flag('--max-diff') ? Number(flag('--max-diff')) : 2;
  if (!printReport(await checkMock(OUT, { maxDiff, log }))) process.exit(1);
}

if (args.includes('--save-recording')) {
  if (args.includes('--no-check')) { log('--save-recording needs a passing check, not --no-check'); process.exit(2); }
  if (args.includes('--reuse')) { log('--save-recording needs a fresh recording, not --reuse'); process.exit(2); }
  // One commit on the orphan branch holding only rec.json, on top of the branch's last commit when it has one.
  let parent = null;
  try { git(['fetch', '--quiet', REMOTE, `refs/heads/${ASSETS_BRANCH}`]); parent = git(['rev-parse', 'FETCH_HEAD']); } catch { /* a first save */ }
  const blob = git(['hash-object', '-w', REC]);
  const tree = git(['mktree'], { input: `100644 blob ${blob}\trec.json\n` });
  const head = git(['rev-parse', '--short', 'HEAD']);
  const commit = git(['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', `Mock artifact recording from ${head}`]);
  git(['push', REMOTE, `${commit}:refs/heads/${ASSETS_BRANCH}`], { stdio: 'inherit' });
  log(`saved rec.json to ${REMOTE}/${ASSETS_BRANCH} (${commit.slice(0, 9)})`);
}
log(`done: ${page}`);

if (args.includes('--serve')) {
  const { base } = await serveDir(OUT);
  log(`serving ${base}/ (Ctrl-C stops)`);
  const opener = { darwin: 'open', win32: 'explorer' }[process.platform] || 'xdg-open';
  try { spawnSync(opener, [`${base}/`], { stdio: 'ignore' }); } catch { /* no opener: the URL above still works */ }
}
