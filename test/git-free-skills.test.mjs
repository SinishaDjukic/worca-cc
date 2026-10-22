// test/git-free-skills.test.mjs — skill import from a GitHub URL without git (P6 Task 6).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readdirSync, readFileSync, readlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { stageImport, discardStage, updatePreview } from '../src/core/skills-registry/import.mjs';
import { commitImport, stagesDir } from '../src/core/skills-registry/library.mjs';
import { _testing as ghTesting } from '../src/core/git-free/github.mjs';
import { fakeGithub } from './helpers/fake-github.mjs';
import { withNoGit } from './helpers/git-off.mjs';
import { tarGz } from './helpers/tar-writer.mjs';

useTempHome(after);
const gh = await fakeGithub();
ghTesting.setFetch(gh.fetch);
let srv, base;
before(async () => {
  const { app } = await import('../ui/server.mjs');
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => { ghTesting.reset(); gh.close(); if (srv) await new Promise((r) => srv.close(r)); });
const SKILL = (name) => `---\nname: ${name}\ndescription: The ${name} skill.\n---\nDo the thing.\n`;
const origin = (s) => JSON.parse(readFileSync(`${s.dir}.json`, 'utf8')).origin;
const stages = () => { try { return readdirSync(stagesDir()).sort(); } catch { return []; } };
const tarballs = (from) => gh.calls.slice(from).filter((c) => c.path.includes('/tarball/')).length;

test('a GitHub URL imports over HTTPS: the folder picked, pinned to the commit, the origin git would record', async (t) => {
  const { sha } = gh.repo('acme/skills', { files: { 'skills/release-notes/SKILL.md': SKILL('release-notes'),
    'skills/release-notes/notes.md': 'n\n', 'skills/other/SKILL.md': SKILL('other'), 'README.md': 'r\n' } });
  withNoGit(t);
  const s = await stageImport({ kind: 'git', url: 'https://github.com/acme/skills', subdir: 'skills/release-notes' });
  assert.equal(s.name, 'release-notes');
  assert.deepEqual(readdirSync(s.dir).sort(), ['SKILL.md', 'notes.md']);
  assert.deepEqual(origin(s), { kind: 'git', url: 'https://github.com/acme/skills', ref: null, subdir: 'skills/release-notes', sha });
  discardStage(s.stage);
});

test('several skills and no folder: the candidates, nothing downloaded', async (t) => {
  gh.repo('acme/many', { files: { 'a/SKILL.md': SKILL('a'), 'b/SKILL.md': SKILL('b') } });
  const n = gh.calls.length;
  withNoGit(t);
  await assert.rejects(stageImport({ kind: 'git', url: 'https://github.com/acme/many' }),
    (e) => e.status === 400 && /^pick the skill's folder in https:\/\/github\.com\/acme\/many at [0-9a-f]{7}: a, b$/.test(e.message) && e.candidates.join() === 'a,b');
  assert.equal(tarballs(n), 0);
});

test('a ref pins a tag or a commit', async (t) => {
  const { sha: v1 } = gh.repo('acme/pinned', { files: { 'SKILL.md': SKILL('pinned') } });
  gh.tag('acme/pinned', 'v1', v1);
  gh.commit('acme/pinned', { files: { 'SKILL.md': `${SKILL('pinned')}v2\n` } });
  withNoGit(t);
  for (const ref of ['v1', v1]) {
    const s = await stageImport({ kind: 'git', url: 'https://github.com/acme/pinned', ref });
    assert.equal(origin(s).sha, v1);
    discardStage(s.stage);
  }
});

test('over the limits from the tree: refused before the archive is downloaded', async (t) => {
  const files = { 'big/SKILL.md': SKILL('big') };
  for (let i = 0; i < 301; i++) files[`big/f${i}.txt`] = '';
  gh.repo('acme/big', { files });
  const n = gh.calls.length;
  withNoGit(t);
  await assert.rejects(stageImport({ kind: 'git', url: 'https://github.com/acme/big', subdir: 'big' }),
    (e) => e.status === 400 && e.message === 'too large for a skill (at most 300 files, 1000 links and folders and 8 MB): more than 300 files');
  assert.equal(tarballs(n), 0);
});

test('an archive that holds more than the tree lists (export-subst) stops at the skill limits and leaves no stage', async (t) => {
  const { sha } = gh.repo('acme/subst', { files: { 'SKILL.md': SKILL('subst') } });
  const top = `acme-subst-${sha.slice(0, 7)}`;
  gh.tarballOverride('acme/subst', sha, tarGz([{ path: `${top}/SKILL.md`, body: SKILL('subst') }, { path: `${top}/huge.txt`, body: 'x'.repeat(9 * 2 ** 20) }]));
  const before = stages();
  withNoGit(t);
  await assert.rejects(stageImport({ kind: 'git', url: 'https://github.com/acme/subst' }),
    (e) => e.status === 400 && e.message === 'too large for a skill (at most 300 files, 1000 links and folders and 8 MB): the archive holds more than the tree lists');
  assert.deepEqual(stages(), before);
});

test('Check for updates over HTTPS: what changed at the origin', async (t) => {
  gh.repo('acme/upd-skill', { files: { 'SKILL.md': SKILL('upd-skill'), 'a.md': 'a\n' } });
  withNoGit(t);
  const s = await stageImport({ kind: 'git', url: 'https://github.com/acme/upd-skill' });
  await commitImport(s.dir, 'upd-skill');
  gh.commit('acme/upd-skill', { files: { 'a.md': 'a2\n', 'b.md': 'b\n' } });
  const d = await updatePreview('upd-skill');
  assert.deepEqual([d.added, d.removed, d.changed], [['b.md'], [], ['a.md']]);
  discardStage(d.stage);
});

test('another host, or a tree too large to list: 409 GIT_MISSING (the dialog shows Needs git)', async (t) => {
  withNoGit(t);
  const r = await fetch(`${base}/api/skills/import/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: { kind: 'git', url: 'https://gitlab.com/acme/skills' } }) });
  assert.equal(r.status, 409);
  assert.deepEqual(await r.json(), { error: 'git is not installed on this machine', code: 'GIT_MISSING' });
  gh.repo('acme/huge', { files: { 'SKILL.md': SKILL('huge') } });
  gh.truncateTrees(true);
  await assert.rejects(stageImport({ kind: 'git', url: 'https://github.com/acme/huge' }), (e) => e.status === 409 && e.code === 'GIT_MISSING');
  gh.truncateTrees(false);
});

const TOO_LARGE = 'too large for a skill (at most 300 files, 1000 links and folders and 8 MB): the archive holds more than the tree lists';

test('a file over 1 MB the tree lists is staged with the inspection problem, as git stages it', async (t) => {
  gh.repo('acme/k1', { files: { 'SKILL.md': SKILL('k1'), 'big.txt': 'x'.repeat(2 * 2 ** 20) } });
  withNoGit(t);
  const s = await stageImport({ kind: 'git', url: 'https://github.com/acme/k1' });
  assert.deepEqual(s.inspection.problems, ['big.txt: larger than 1 MB']);
  discardStage(s.stage);
});

test('an archive past 8 MB in total (no file past 1 MB) stops at the skill limits', async (t) => {
  const { sha } = gh.repo('acme/k2', { files: { 'SKILL.md': SKILL('k2') } });
  const top = `acme-k2-${sha.slice(0, 7)}`;
  gh.tarballOverride('acme/k2', sha, tarGz([{ path: `${top}/SKILL.md`, body: SKILL('k2') },
    ...Array.from({ length: 9 }, (_, i) => ({ path: `${top}/p${i}.txt`, body: 'x'.repeat(2 ** 20 - 1) }))]));
  const before = stages();
  withNoGit(t);
  await assert.rejects(stageImport({ kind: 'git', url: 'https://github.com/acme/k2' }), (e) => e.status === 400 && e.message === TOO_LARGE);
  assert.deepEqual(stages(), before);
});

test('an archive with more entries than a skill may hold stops at the skill limits', async (t) => {
  const { sha } = gh.repo('acme/k3', { files: { 'SKILL.md': SKILL('k3') } });
  const top = `acme-k3-${sha.slice(0, 7)}`;
  gh.tarballOverride('acme/k3', sha, tarGz([{ path: `${top}/SKILL.md`, body: SKILL('k3') },
    ...Array.from({ length: 1301 }, (_, i) => ({ path: `${top}/e${i}/`, type: '5' }))]));
  withNoGit(t);
  await assert.rejects(stageImport({ kind: 'git', url: 'https://github.com/acme/k3' }), (e) => e.status === 400 && e.message === TOO_LARGE);
});

test('the limits count the picked folder only: a large sibling does not refuse it', async (t) => {
  gh.repo('acme/k4', { files: { 'small/SKILL.md': SKILL('small'), 'small-data/data.bin': 'x'.repeat(9 * 2 ** 20) } });
  withNoGit(t);
  const s = await stageImport({ kind: 'git', url: 'https://github.com/acme/k4', subdir: 'small' });
  assert.deepEqual(readdirSync(s.dir), ['SKILL.md']);
  discardStage(s.stage);
});

test('folders are counted below the pick: 999 folders in a/b stage', async (t) => {
  const files = { 'a/b/SKILL.md': SKILL('b') };
  for (let c = 0; c < 10; c++) files[`a/b/c${c}/${'d/'.repeat(98)}f.txt`] = 'f';
  for (let j = 0; j < 9; j++) files[`a/b/e${j}/x.txt`] = 'x';
  gh.repo('acme/k5', { files });
  withNoGit(t);
  const s = await stageImport({ kind: 'git', url: 'https://github.com/acme/k5', subdir: 'a/b' });
  assert.deepEqual(s.inspection.problems, []);
  discardStage(s.stage);
});

test('a link inside the skill lands verbatim (POSIX); the stage folder is 0700', { skip: process.platform === 'win32' }, async (t) => {
  gh.repo('acme/k6', { files: { 'SKILL.md': SKILL('k6'), 'docs/a.md': 'a\n', in: { link: 'docs/a.md' } } });
  withNoGit(t);
  const s = await stageImport({ kind: 'git', url: 'https://github.com/acme/k6' });
  assert.equal(readlinkSync(join(s.dir, 'in')), 'docs/a.md');
  assert.equal(statSync(s.dir).mode & 0o777, 0o700);
  discardStage(s.stage);
});

test('a link to a link, and a link through a linked folder, stage as git stages them (POSIX)', { skip: process.platform === 'win32' }, async (t) => {
  gh.repo('acme/k6c', { files: { 'SKILL.md': SKILL('k6c'), 'AGENTS.md': 'a\n', 'CLAUDE.md': { link: 'AGENTS.md' }, 'GEMINI.md': { link: 'CLAUDE.md' },
    'docs/v2/README.md': 'r\n', 'docs/latest': { link: 'v2' }, x: { link: 'docs/latest/README.md' } } });
  withNoGit(t);
  const s = await stageImport({ kind: 'git', url: 'https://github.com/acme/k6c' });
  assert.deepEqual([readlinkSync(join(s.dir, 'GEMINI.md')), readFileSync(join(s.dir, 'GEMINI.md'), 'utf8'), readFileSync(join(s.dir, 'x'), 'utf8')],
    ['CLAUDE.md', 'a\n', 'r\n']);
  discardStage(s.stage);
});

test('an archive of exactly 300 files and 1000 folders below a picked folder stages (its own entry is not one of them)', async (t) => {
  const { sha } = gh.repo('acme/k7', { files: { 'sk/SKILL.md': SKILL('sk') } });
  const top = `acme-k7-${sha.slice(0, 7)}`;
  gh.tarballOverride('acme/k7', sha, tarGz([{ path: `${top}/sk/`, type: '5' }, { path: `${top}/sk/SKILL.md`, body: SKILL('sk') },
    ...Array.from({ length: 299 }, (_, i) => ({ path: `${top}/sk/f${i}.txt`, body: '' })),
    ...Array.from({ length: 1000 }, (_, i) => ({ path: `${top}/sk/d${i}/`, type: '5' }))]));
  withNoGit(t);
  const s = await stageImport({ kind: 'git', url: 'https://github.com/acme/k7', subdir: 'sk' });
  assert.equal(readdirSync(s.dir).length, 1300);
  discardStage(s.stage);
});

test('an archive cut short before its end-of-archive marker refuses the import: never a stage missing files', async (t) => {
  const { sha } = gh.repo('acme/k12', { files: { 'SKILL.md': SKILL('k12'), 'a.md': 'a\n' } });
  const top = `acme-k12-${sha.slice(0, 7)}`;
  // a whole gzip member around a tar that stops after SKILL.md (its header and one block): a.md never arrives
  const tar = gunzipSync(tarGz([{ path: `${top}/SKILL.md`, body: SKILL('k12') }, { path: `${top}/a.md`, body: 'a\n' }]));
  gh.tarballOverride('acme/k12', sha, gzipSync(tar.subarray(0, 512 * 2)));
  const before = stages();
  withNoGit(t);
  await assert.rejects(stageImport({ kind: 'git', url: 'https://github.com/acme/k12' }),
    (e) => e.status === 400 && e.message === 'git: could not fetch the default branch from https://github.com/acme/k12: archive truncated (no end-of-archive marker)');
  assert.deepEqual(stages(), before);
});

test('names git writes but this path cannot (a drive letter, a backslash) refuse the import: never staged without them', async (t) => {
  gh.repo('acme/k8', { files: { 'sk/SKILL.md': SKILL('sk'), 'sk/C:x.md': 'c\n', 'sk/a\\b.md': 'b\n', 'other/a\\b.md': 'o\n' } });
  const before = stages();
  withNoGit(t);
  await assert.rejects(stageImport({ kind: 'git', url: 'https://github.com/acme/k8', subdir: 'sk' }),
    (e) => e.status === 400 && e.message === 'names Worca cannot write without git: C:x.md, a\\b.md');
  assert.deepEqual(stages(), before);
});

test('a picked folder named like a drive (a:b) is stripped, never written: it stages as git stages it', { skip: process.platform === 'win32' }, async (t) => {
  gh.repo('acme/k13', { files: { 'a:b/SKILL.md': SKILL('ab'), 'a:b/n.md': 'n\n' } });
  withNoGit(t);
  const s = await stageImport({ kind: 'git', url: 'https://github.com/acme/k13' });
  assert.deepEqual([readdirSync(s.dir).sort(), origin(s).subdir], [['SKILL.md', 'n.md'], 'a:b']);
  discardStage(s.stage);
});

test('a file the disk cannot write fails the import without naming the stage folder', async (t) => {
  gh.repo('acme/k9', { files: { 'sk/SKILL.md': SKILL('sk'), [`sk/${'n'.repeat(300)}.md`]: 'n\n' } });
  const before = stages();
  withNoGit(t);
  await assert.rejects(stageImport({ kind: 'git', url: 'https://github.com/acme/k9', subdir: 'sk' }),
    (e) => e.status === 400 && !e.message.includes(stagesDir()) && e.message === `could not write the skill's files: ENAMETOOLONG: name too long, open '${'n'.repeat(300)}.md'`);
  assert.deepEqual(stages(), before);
});

test('an abbreviated commit is refused as git refuses it, and leaves no stage', async (t) => {
  const { sha } = gh.repo('acme/k10', { files: { 'SKILL.md': SKILL('k10') } });
  const before = stages();
  withNoGit(t);
  for (const ref of [sha.slice(0, 7), sha.slice(0, 12).toUpperCase()]) {
    await assert.rejects(stageImport({ kind: 'git', url: 'https://github.com/acme/k10', ref }),
      (e) => e.status === 400 && e.message === `git: could not fetch ${ref} from https://github.com/acme/k10: use the full 40-character commit`);
  }
  assert.deepEqual(stages(), before);
});

test('a ref with a "." or an empty segment is refused as git refuses it, never folded into another ref, before any request', async (t) => {
  const { bare } = gh.repo('acme/k11', { files: { 'SKILL.md': SKILL('k11') } });
  gh.commit('acme/k11', { branch: 'rel/v2', from: 'main', files: { 'SKILL.md': `${SKILL('k11')}v2\n` } });
  const refs = ['./main', 'rel/./v2', 'rel//v2'];
  const before = stages();
  const viaGit = pathToFileURL(bare).href;
  for (const ref of refs) {
    await assert.rejects(stageImport({ kind: 'git', url: viaGit, ref }), (e) => e.status === 400 && e.message === `git: could not fetch ${ref} from ${viaGit}: fatal: invalid refspec '${ref}'`);
  }
  withNoGit(t);
  const n = gh.calls.length;
  for (const ref of refs) {
    await assert.rejects(stageImport({ kind: 'git', url: 'https://github.com/acme/k11', ref }),
      (e) => e.status === 400 && e.message === `git: could not fetch ${ref} from https://github.com/acme/k11: not found on GitHub: ${ref}`);
  }
  assert.deepEqual([stages(), gh.calls.length], [before, n]);
});
