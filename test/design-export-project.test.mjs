// test/design-export-project.test.mjs — Design P6 Task 3: copy a finished design's dist/ into a project folder. The
// folder rule (inside the project, never `.git` or a Windows form of it, Windows name rules on every OS), links on the
// way or at a target path, collisions refused before anything is written, the Windows path length, and a failure
// midway that says how far it got.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs, { chmodSync, closeSync, constants, fstatSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, symlinkSync, rmSync, linkSync, renameSync, openSync, writeSync, unlinkSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { basename, join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { checkRows } from './helpers/rows.mjs';
import { checkExportSubdir, copyDistToProject, ExportRefusal } from '../src/core/design/export.mjs';

// Every folder this file makes, removed by exact path: other runs share os.tmpdir().
const made = [];
const scratch = (prefix) => { const dir = mkdtempSync(join(tmpdir(), prefix)); made.push(dir); return dir; };
after(() => { for (const dir of made) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); });

const code = (c) => (e) => e instanceof ExportRefusal && e.code === c;
function world() {
  const root = scratch('dcp-'); const dist = join(root, 'dist'); const projectDir = join(root, 'proj');
  for (const [rel, text] of [['index.html', 'H'], ['assets/a.png', 'A'], ['sections/hero/assets/b.svg', 'B']]) { mkdirSync(dirname(join(dist, rel)), { recursive: true }); writeFileSync(join(dist, rel), text); }
  mkdirSync(join(projectDir, '.git'), { recursive: true });
  return { root, dist, projectDir };
}
/** The 409's collisions key: an overwrite replaces exactly the list it was given for. */
async function keyOf(opts) {
  let key = null;
  await assert.rejects(copyDistToProject(opts), (e) => { key = e?.data?.collisionsKey; return code('exists')(e); });
  return key;
}
// The copy's seams: `open`, the exclusive open right after the checks, and `write`, the bytes before the checks again.
// dist's files copy in order: assets/a.png, index.html, sections/hero/assets/b.svg.
const writeAll = async (src, fd) => { writeSync(fd, readFileSync(src)); };
const afterWrite = (plant, at = 2) => { let n = 0; return async (src, fd) => { await writeAll(src, fd); n += 1; if (n === at) plant(); }; };
const atOpen = (before, at = 3, after = () => {}) => { let n = 0; return (p, f, m) => { n += 1; if (n === at) before(p); const fd = openSync(p, f, m); if (n === at) after(p); return fd; }; };
/** The part files left anywhere under `dir`: every file is written to one first, and none may stay. */
const partFiles = (dir) => readdirSync(dir, { recursive: true }).filter((n) => n.endsWith('.part'));
const openFds = () => readdirSync('/dev/fd').length;
const POSIX = { skip: process.platform === 'win32' ? 'POSIX' : false };
test('checkExportSubdir', async () => {
  const bad = ['', ' ', '../x', 'a/../../x', 'a/..', '/etc', '\\\\host\\share', 'C:/x', 'C:x', 'con/x', 'a/aux.txt', 'trail./x', 'trail /x', 'a<b', 'a|b', 'a?b', 'a*b', 'a"b', 'a\0b', 'a'.repeat(201)];
  const git = ['.git', '.git/hooks', 'a/.GIT/b', '.git./x', '.git /x', 'git~1', 'GIT~1/x'];
  await checkRows([
    ...bad.map((s) => ({ name: JSON.stringify(s), run: () => assert.equal(checkExportSubdir(s).code, 'bad-folder') })),
    ...git.map((s) => ({ name: s, run: () => assert.equal(checkExportSubdir(s).code, 'git-folder') })),
    ...[['design/ship', 'design/ship'], ['a\\b', 'a/b'], ['./a/', 'a'], ['.github/x', '.github/x'], ['.', '']].map(([s, rel]) => ({ name: s, run: () => assert.deepEqual(checkExportSubdir(s), { ok: true, rel }) })),
  ]);
});
test('copies dist, no commit, nothing else', async () => {
  const w = world();
  assert.deepEqual(await copyDistToProject({ ...w, subdir: 'design/ship' }), { target: 'design/ship', files: 3 });
  assert.equal(readFileSync(join(w.projectDir, 'design/ship/sections/hero/assets/b.svg'), 'utf8'), 'B');
  assert.deepEqual(readdirSync(join(w.projectDir, '.git')), []);
  assert.deepEqual(partFiles(w.projectDir), [], 'no part file is left');
});
test('exists: refuses before writing anything; overwrite replaces those and keeps the rest', async () => {
  const w = world(); const t = join(w.projectDir, 'design/ship');
  mkdirSync(join(t, 'assets'), { recursive: true }); writeFileSync(join(t, 'assets/a.png'), 'OLD'); writeFileSync(join(t, 'mine.txt'), 'M');
  await assert.rejects(copyDistToProject({ ...w, subdir: 'design/ship' }), (e) => code('exists')(e) && e.status === 409 && e.data.total === 1 && e.data.collisions[0] === 'assets/a.png');
  assert.equal(existsSync(join(t, 'index.html')), false);
  const key = await keyOf({ ...w, subdir: 'design/ship' });
  assert.match(key, /^[0-9a-f]{64}$/);
  await copyDistToProject({ ...w, subdir: 'design/ship', overwrite: true, expect: key });
  assert.equal(readFileSync(join(t, 'assets/a.png'), 'utf8'), 'A');
  assert.equal(readFileSync(join(t, 'mine.txt'), 'utf8'), 'M');
});
// Review cycle 2, C1: "Replace these files" replaces the list the person was shown, and nothing else.
test('overwrite replaces only the collisions its key was given for: a list that changed is a new 409 and writes nothing', async () => {
  const w = world(); const t = join(w.projectDir, 'd');
  mkdirSync(join(t, 'assets'), { recursive: true }); writeFileSync(join(t, 'assets/a.png'), 'OLD');
  const shown = await keyOf({ ...w, subdir: 'd' });
  await assert.rejects(copyDistToProject({ ...w, subdir: 'd', overwrite: true }), (e) => code('exists')(e) && e.data.collisionsKey === shown, 'overwrite with no key replaces nothing');
  writeFileSync(join(t, 'index.html'), 'MINE');   // collides now, never listed
  let grown = null;
  await assert.rejects(copyDistToProject({ ...w, subdir: 'd', overwrite: true, expect: shown }), (e) => {
    grown = e.data?.collisionsKey;
    return code('exists')(e) && e.status === 409 && e.message === '2 files already exist.' && e.data.total === 2 && e.data.collisions.join() === 'assets/a.png,index.html';
  });
  assert.notEqual(grown, shown);
  assert.deepEqual([readFileSync(join(t, 'assets/a.png'), 'utf8'), readFileSync(join(t, 'index.html'), 'utf8'), existsSync(join(t, 'sections'))], ['OLD', 'MINE', false], 'nothing was written');
  rmSync(join(t, 'index.html'));
  await assert.rejects(copyDistToProject({ ...w, subdir: 'd', overwrite: true, expect: grown }), (e) => code('exists')(e) && e.data.collisionsKey === shown, 'a list that shrank is a new list too');
  mkdirSync(join(w.projectDir, 'd2', 'assets'), { recursive: true }); writeFileSync(join(w.projectDir, 'd2', 'assets/a.png'), 'OLD');
  assert.notEqual(await keyOf({ ...w, subdir: 'd2' }), shown, 'the same names in another folder are another list');
  // A file that turns up at an unlisted path while the copy runs is never replaced: only listed files are swapped in.
  const late = afterWrite(() => writeFileSync(join(t, 'index.html'), 'LATE'), 1);
  await assert.rejects(copyDistToProject({ ...w, subdir: 'd', overwrite: true, expect: shown, write: late }), (e) => code('partial')(e) && e.message === 'Copied 1 of 3 files, then: EEXIST.');
  assert.deepEqual([readFileSync(join(t, 'assets/a.png'), 'utf8'), readFileSync(join(t, 'index.html'), 'utf8')], ['A', 'LATE']);
  assert.deepEqual(partFiles(t), []);
});
test('collisions shown are capped; the total is true', async () => {
  const w = world(); for (let i = 0; i < 30; i += 1) writeFileSync(join(w.dist, `f${i}.txt`), 'x');
  mkdirSync(join(w.projectDir, 'd')); for (let i = 0; i < 30; i += 1) writeFileSync(join(w.projectDir, 'd', `f${i}.txt`), 'y');
  await assert.rejects(copyDistToProject({ ...w, subdir: 'd' }), (e) => e.data.total === 30 && e.data.collisions.length === 20);
});
test('links and .git through a link', { skip: process.platform === 'win32' ? 'POSIX' : false }, async () => {
  const w = world(); const out = scratch('dcp-out-');
  symlinkSync(out, join(w.projectDir, 'out'));
  await assert.rejects(copyDistToProject({ ...w, subdir: 'out/x' }), code('outside-project'));
  symlinkSync(join(w.projectDir, '.git'), join(w.projectDir, 'g'));
  await assert.rejects(copyDistToProject({ ...w, subdir: 'g/x' }), code('git-folder'));
  mkdirSync(join(w.projectDir, 'd')); symlinkSync(join(out, 'victim'), join(w.projectDir, 'd', 'index.html'));
  await assert.rejects(copyDistToProject({ ...w, subdir: 'd', overwrite: true }), code('link'));
  symlinkSync(out, join(w.projectDir, 'd', 'assets'));
  await assert.rejects(copyDistToProject({ ...w, subdir: 'd' }), code('link'));
  assert.deepEqual(readdirSync(out), []);
});
test('a file in the way; Windows length; a failure midway says how far it got', async () => {
  const w = world(); writeFileSync(join(w.projectDir, 'f'), 'x');
  await assert.rejects(copyDistToProject({ ...w, subdir: 'f/x' }), code('not-a-folder'));
  writeFileSync(join(w.dist, 'z'.repeat(80) + '.txt'), 'z');   // past 259 under Linux's short /tmp; macOS's 72-char real tmpdir trips it on the first file already
  await assert.rejects(copyDistToProject({ ...w, subdir: 'x'.repeat(150) + '/' + 'y'.repeat(45), platform: 'win32' }), (e) => code('path-too-long')(e) && e.message.endsWith(' would be longer than Windows allows.'));
  rmSync(join(w.dist, 'z'.repeat(80) + '.txt'));
  let n = 0; const open = (p, f, m) => { n += 1; if (n === 2) throw Object.assign(new Error('x'), { code: 'EACCES' }); return openSync(p, f, m); };
  await assert.rejects(copyDistToProject({ ...w, subdir: 'p', open }), (e) => code('partial')(e) && e.status === 500 && e.message === 'Copied 1 of 3 files, then: EACCES.');
});
test('a missing project, the refusal texts, the project root, and the length rule only on win32', async () => {
  const w = world();
  await assert.rejects(copyDistToProject({ ...w, projectDir: join(w.root, 'gone'), subdir: 'x' }), (e) => code('project-missing')(e) && e.status === 422 && e.message === 'This project\'s folder is missing.');
  for (const s of [null, 5, `a${String.fromCharCode(1)}b`]) assert.equal(checkExportSubdir(s).code, 'bad-folder', JSON.stringify(s));
  assert.deepEqual(checkExportSubdir('../x'), { ok: false, code: 'bad-folder', error: 'Folder must be a path inside the project.' });
  assert.deepEqual(checkExportSubdir('.git'), { ok: false, code: 'git-folder', error: 'worca does not write into .git.' });
  await assert.rejects(copyDistToProject({ ...w, subdir: '.git/x' }), (e) => code('git-folder')(e) && e.status === 422 && e.message === 'worca does not write into .git.');
  mkdirSync(join(w.projectDir, 'd')); writeFileSync(join(w.projectDir, 'd', 'assets'), 'x');
  await assert.rejects(copyDistToProject({ ...w, subdir: 'd' }), (e) => code('not-a-folder')(e) && e.status === 422 && e.message === 'd/assets is a file, not a folder.');
  writeFileSync(join(w.projectDir, 'index.html'), 'old');
  await assert.rejects(copyDistToProject({ ...w, subdir: '.' }), (e) => code('exists')(e) && e.message === '1 file already exists.');
  mkdirSync(join(w.projectDir, 'assets')); writeFileSync(join(w.projectDir, 'assets', 'a.png'), 'old');
  await assert.rejects(copyDistToProject({ ...w, subdir: '.' }), (e) => code('exists')(e) && e.message === '2 files already exist.' && e.data.total === 2);
  const modes = []; const open = (p, f, m) => { modes.push([f, /^\.worca-[0-9a-f]{8}\.part$/.test(basename(p))]); return openSync(p, f, m); };
  const expect = await keyOf({ ...w, subdir: '.' });
  assert.deepEqual(await copyDistToProject({ ...w, subdir: '.', overwrite: true, expect, open }), { target: '.', files: 3 });
  assert.deepEqual(await copyDistToProject({ ...w, subdir: 'fresh', open }), { target: 'fresh', files: 3 });
  const NEW = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0);
  assert.deepEqual(modes, Array(6).fill([NEW, true]), 'every open makes a new part file: a listed collision is renamed over the old entry, every other file is linked in as a new name, so a file planted after the checks is never overwritten');
  assert.deepEqual(partFiles(w.projectDir), [], 'no part file is left');
  assert.equal(readFileSync(join(w.projectDir, 'assets/a.png'), 'utf8'), 'A');
  assert.deepEqual(readdirSync(join(w.projectDir, '.git')), []);
  if (process.platform === 'win32') return;
  writeFileSync(join(w.dist, 'z'.repeat(80) + '.txt'), 'z');
  const long = 'x'.repeat(150) + '/' + 'y'.repeat(45);
  assert.deepEqual(await copyDistToProject({ ...w, subdir: long, platform: 'linux' }), { target: long, files: 4 });
});
test('a link inside the project is followed; a dangling one, one to a file, and one on a file\'s way are refused', { skip: process.platform === 'win32' ? 'POSIX' : false }, async () => {
  const w = world();
  mkdirSync(join(w.projectDir, 'real')); symlinkSync(join(w.projectDir, 'real'), join(w.projectDir, 'in'));
  assert.deepEqual(await copyDistToProject({ ...w, subdir: 'in/x' }), { target: 'in/x', files: 3 });
  assert.equal(readFileSync(join(w.projectDir, 'real/x/sections/hero/assets/b.svg'), 'utf8'), 'B');
  symlinkSync(join(w.root, 'nowhere'), join(w.projectDir, 'dead'));
  await assert.rejects(copyDistToProject({ ...w, subdir: 'dead/x' }), (e) => code('outside-project')(e) && e.status === 422 && e.message === 'That folder is outside the project.');
  writeFileSync(join(w.projectDir, 'file'), 'x'); symlinkSync(join(w.projectDir, 'file'), join(w.projectDir, 'tofile'));
  await assert.rejects(copyDistToProject({ ...w, subdir: 'tofile/x' }), (e) => code('not-a-folder')(e) && e.message === 'tofile is a file, not a folder.');
  mkdirSync(join(w.projectDir, 'e')); symlinkSync(join(w.root, 'victim'), join(w.projectDir, 'e', 'index.html'));
  await assert.rejects(copyDistToProject({ ...w, subdir: 'e', overwrite: true }), (e) => code('link')(e) && e.status === 422 && e.message === 'e/index.html is a link, so nothing was copied.');
  mkdirSync(join(w.projectDir, 'f')); symlinkSync(join(w.projectDir, 'real'), join(w.projectDir, 'f', 'assets'));
  await assert.rejects(copyDistToProject({ ...w, subdir: 'f' }), (e) => code('link')(e) && e.message === 'f/assets is a link, so nothing was copied.');
  assert.equal(existsSync(join(w.root, 'victim')), false);
});

// Review cycle 1, M1-M3: what another writer leaves at a target path, or plants while the copy runs.
test('a hard link at a target path is replaced, never written through', async () => {
  const w = world(); const outside = join(w.root, 'secret.txt'); writeFileSync(outside, 'SECRET');
  mkdirSync(join(w.projectDir, 'd')); linkSync(outside, join(w.projectDir, 'd', 'index.html'));
  await assert.rejects(copyDistToProject({ ...w, subdir: 'd' }), (e) => code('exists')(e) && e.data.collisions[0] === 'index.html');
  assert.deepEqual(await copyDistToProject({ ...w, subdir: 'd', overwrite: true, expect: await keyOf({ ...w, subdir: 'd' }) }), { target: 'd', files: 3 });
  assert.equal(readFileSync(outside, 'utf8'), 'SECRET', 'the file outside the project keeps its bytes');
  assert.equal(readFileSync(join(w.projectDir, 'd', 'index.html'), 'utf8'), 'H');
  assert.deepEqual(readdirSync(join(w.projectDir, 'd')).sort(), ['assets', 'index.html', 'sections'], 'no part file is left');
});
test('a folder or a FIFO at a file\'s path is refused before anything is written, with overwrite too', async () => {
  const w = world();
  mkdirSync(join(w.projectDir, 'd', 'index.html'), { recursive: true });
  for (const overwrite of [false, true]) {
    await assert.rejects(copyDistToProject({ ...w, subdir: 'd', overwrite }), (e) => code('not-a-file')(e) && e.status === 422 && e.message === 'd/index.html is a folder, not a file.');
  }
  assert.deepEqual(readdirSync(join(w.projectDir, 'd')), ['index.html'], 'nothing was copied');
  if (process.platform === 'win32') return;
  mkdirSync(join(w.projectDir, 'p')); execFileSync('mkfifo', [join(w.projectDir, 'p', 'index.html')]);
  for (const overwrite of [false, true]) {
    await assert.rejects(copyDistToProject({ ...w, subdir: 'p', overwrite }), (e) => code('not-a-file')(e) && e.message === 'p/index.html is not a file.');
  }
  assert.deepEqual(readdirSync(join(w.projectDir, 'p')), ['index.html']);
});
test('a link planted while the copy runs is refused, never followed, on either path', { skip: process.platform === 'win32' ? 'POSIX' : false }, async () => {
  const w = world(); const out = scratch('dcp-out-'); const p = (...a) => join(w.projectDir, ...a);
  await assert.rejects(copyDistToProject({ ...w, subdir: 'fresh', write: afterWrite(() => symlinkSync(out, p('fresh', 'sections'))) }),
    (e) => code('partial')(e) && e.status === 500 && e.message === 'Copied 2 of 3 files, then: fresh/sections is a link.' && e.data.copied === 2);
  mkdirSync(p('old', 'sections'), { recursive: true });
  await assert.rejects(copyDistToProject({ ...w, subdir: 'old', overwrite: true, write: afterWrite(() => { rmSync(p('old', 'sections'), { recursive: true }); symlinkSync(out, p('old', 'sections')); }) }),
    (e) => code('partial')(e) && e.message === 'Copied 2 of 3 files, then: old/sections is a link.');
  mkdirSync(p('way'));
  await assert.rejects(copyDistToProject({ ...w, subdir: 'way/x', write: afterWrite(() => { rmSync(p('way'), { recursive: true }); symlinkSync(out, p('way')); }) }),
    (e) => code('partial')(e) && e.message === 'Copied 1 of 3 files, then: way leads outside the project.');
  assert.deepEqual(readdirSync(out), [], 'nothing was written outside the project');
  // Overwrite: the target folder moved out of the project, a link left in its place, between a part file's bytes and
  // its rename. Renamed through the link, the file would land outside.
  mkdirSync(p('mv', 'assets'), { recursive: true }); writeFileSync(p('mv', 'assets', 'a.png'), 'OLD');
  const mvKey = await keyOf({ ...w, subdir: 'mv' });
  await assert.rejects(copyDistToProject({ ...w, subdir: 'mv', overwrite: true, expect: mvKey, write: afterWrite(() => { renameSync(p('mv'), join(out, 'moved')); symlinkSync(join(out, 'moved'), p('mv')); }, 1) }),
    (e) => code('partial')(e) && e.message === 'Copied 0 of 3 files, then: mv leads outside the project.');
  assert.deepEqual([readdirSync(join(out, 'moved', 'assets')), readFileSync(join(out, 'moved', 'assets', 'a.png'), 'utf8')], [['a.png'], 'OLD'], 'nothing replaced outside, and no part file');
  // Overwrite: the part file itself swapped for another between its bytes and its rename.
  mkdirSync(p('pf', 'assets'), { recursive: true }); writeFileSync(p('pf', 'assets', 'a.png'), 'OLD');
  let partAt = null; const open = (q, f, m) => { partAt = q; return openSync(q, f, m); };
  await assert.rejects(copyDistToProject({ ...w, subdir: 'pf', overwrite: true, expect: await keyOf({ ...w, subdir: 'pf' }), open, write: afterWrite(() => { unlinkSync(partAt); writeFileSync(partAt, 'EVIL'); }, 1) }),
    (e) => code('partial')(e) && e.message === 'Copied 0 of 3 files, then: pf/assets moved.');
  assert.deepEqual(readdirSync(p('pf', 'assets')), ['a.png']); assert.equal(readFileSync(p('pf', 'assets', 'a.png'), 'utf8'), 'OLD');
});
// Review cycle 2, M2: the checks, the open and the checks again run back to back, so a link planted in the gap before
// the open is caught right after it. At worst an empty part file of worca's own name is left where the link led, never
// the bytes.
test('a link planted between the checks and the open: the copy stops, and no byte lands outside', { skip: process.platform === 'win32' ? 'POSIX' : false }, async () => {
  const w = world(); const out = scratch('dcp-out-'); const p = (...a) => join(w.projectDir, ...a); const fds = openFds();
  const plantAt = (folder, to) => () => { rmSync(folder, { recursive: true }); mkdirSync(join(to, 'hero', 'assets'), { recursive: true }); symlinkSync(to, folder); };
  await assert.rejects(copyDistToProject({ ...w, subdir: 'fresh', open: atOpen(plantAt(p('fresh', 'sections'), join(out, 'a'))) }),
    (e) => code('partial')(e) && e.message === 'Copied 2 of 3 files, then: fresh/sections is a link.');
  assert.deepEqual(readdirSync(join(out, 'a', 'hero', 'assets')), [], 'the part file opened through the link is removed through it');
  // Put back before the second check: the folders pass again, but the open file is not the one at its path.
  const back = () => { unlinkSync(p('back', 'sections')); mkdirSync(p('back', 'sections', 'hero', 'assets'), { recursive: true }); };
  await assert.rejects(copyDistToProject({ ...w, subdir: 'back', open: atOpen(plantAt(p('back', 'sections'), join(out, 'b')), 3, back) }),
    (e) => code('partial')(e) && e.message === 'Copied 2 of 3 files, then: back/sections/hero/assets moved.');
  const leftB = join(out, 'b', 'hero', 'assets');
  assert.deepEqual(readdirSync(leftB).map((n) => [/^\.worca-[0-9a-f]{8}\.part$/.test(n), readFileSync(join(leftB, n), 'utf8')]), [[true, '']], 'an empty file of worca\'s own name at most');
  assert.deepEqual(readdirSync(p('back', 'sections', 'hero', 'assets')), []);
  // Overwrite: the part file opened through the link is removed, and the listed file outside keeps its bytes.
  mkdirSync(p('sw', 'sections', 'hero', 'assets'), { recursive: true }); writeFileSync(p('sw', 'sections', 'hero', 'assets', 'b.svg'), 'OLD');
  const moveOut = () => { renameSync(p('sw', 'sections'), join(out, 'c')); symlinkSync(join(out, 'c'), p('sw', 'sections')); };
  await assert.rejects(copyDistToProject({ ...w, subdir: 'sw', overwrite: true, expect: await keyOf({ ...w, subdir: 'sw' }), open: atOpen(moveOut) }),
    (e) => code('partial')(e) && e.message === 'Copied 2 of 3 files, then: sw/sections is a link.');
  assert.deepEqual([readdirSync(join(out, 'c', 'hero', 'assets')), readFileSync(join(out, 'c', 'hero', 'assets', 'b.svg'), 'utf8')], [['b.svg'], 'OLD']);
  assert.equal(openFds(), fds, 'every file the copies opened is closed');
});
// Review cycle 2, M3: the re-walk's own rules for a link planted on the target's way, and a file planted in a folder's place.
test('planted while the copy runs: a link into .git, a link to a file, a file where a folder goes', { skip: process.platform === 'win32' ? 'POSIX' : false }, async () => {
  const w = world(); const p = (...a) => join(w.projectDir, ...a);
  mkdirSync(p('.git', 'x'));
  const relink = (dir, to) => () => { rmSync(p(dir), { recursive: true }); symlinkSync(to, p(dir)); };
  await assert.rejects(copyDistToProject({ ...w, subdir: 'way', write: afterWrite(relink('way', p('.git', 'x'))) }),
    (e) => code('partial')(e) && e.message === 'Copied 1 of 3 files, then: way leads into .git.');
  assert.deepEqual(readdirSync(p('.git', 'x')), [], 'nothing written into .git');
  writeFileSync(p('file'), 'x');
  await assert.rejects(copyDistToProject({ ...w, subdir: 'tofile', write: afterWrite(relink('tofile', p('file'))) }),
    (e) => code('partial')(e) && e.message === 'Copied 1 of 3 files, then: tofile is not a folder.');
  await assert.rejects(copyDistToProject({ ...w, subdir: 'fs', write: afterWrite(() => writeFileSync(p('fs', 'sections'), 'x')) }),
    (e) => code('partial')(e) && e.message === 'Copied 2 of 3 files, then: fs/sections is not a folder.');
  assert.equal(readFileSync(p('fs', 'sections'), 'utf8'), 'x');
});
// Review cycle 3, C1-b: the 409's key and the copy bind the real folder the 409 looked in, not the typed path.
test('a link on the way pointed elsewhere after the 409, or while the copy runs: Replace never writes into a folder the 409 did not look in', POSIX, async () => {
  const w = world(); const p = (...a) => join(w.projectDir, ...a);
  for (const d of ['a', 'b']) { mkdirSync(p(d, 'ship'), { recursive: true }); writeFileSync(p(d, 'ship', 'index.html'), `${d}-own`); }
  const point = (to) => { rmSync(p('design'), { force: true }); symlinkSync(p(to), p('design')); };
  point('a');
  const shown = await keyOf({ ...w, subdir: 'design/ship' });
  point('b');   // the same names, in another real folder
  await assert.rejects(copyDistToProject({ ...w, subdir: 'design/ship', overwrite: true, expect: shown }),
    (e) => code('exists')(e) && e.data.collisions.join() === 'index.html' && /^[0-9a-f]{64}$/.test(e.data.collisionsKey) && e.data.collisionsKey !== shown);
  assert.deepEqual([readFileSync(p('a', 'ship', 'index.html'), 'utf8'), readFileSync(p('b', 'ship', 'index.html'), 'utf8')], ['a-own', 'b-own'], 'nothing was written');
  // While the copy runs: pointed at b once assets/a.png is in place in a, so the listed index.html would be replaced in b.
  point('a');
  let n = 0; const link = (from, to) => { linkSync(from, to); n += 1; if (n === 1) point('b'); };
  await assert.rejects(copyDistToProject({ ...w, subdir: 'design/ship', overwrite: true, expect: shown, link }),
    (e) => code('partial')(e) && e.message === 'Copied 1 of 3 files, then: design moved.');
  assert.deepEqual([readFileSync(p('a', 'ship', 'assets', 'a.png'), 'utf8'), readFileSync(p('a', 'ship', 'index.html'), 'utf8')], ['A', 'a-own']);
  assert.deepEqual(readdirSync(p('b', 'ship')), ['index.html'], 'b is untouched');
  assert.equal(readFileSync(p('b', 'ship', 'index.html'), 'utf8'), 'b-own');
  assert.deepEqual(partFiles(p('a')), []);
  // The link removed while the copy runs: no folder is made in its place.
  point('a'); rmSync(p('a', 'ship', 'assets'), { recursive: true });
  n = 0; const drop = (from, to) => { linkSync(from, to); n += 1; if (n === 1) unlinkSync(p('design')); };
  await assert.rejects(copyDistToProject({ ...w, subdir: 'design/ship', overwrite: true, expect: shown, link: drop }),
    (e) => code('partial')(e) && e.message === 'Copied 1 of 3 files, then: design moved.');
  assert.equal(existsSync(p('design')), false);
});
// Review cycle 3, M-1: a hard link made elsewhere to the open file would get the bytes, so the open file must have one name.
test('a hard link made to the open file before the second check: the copy stops, and no byte lands outside', POSIX, async () => {
  const w = world(); const out = scratch('dcp-out-'); const p = (...a) => join(w.projectDir, ...a);
  mkdirSync(join(out, 'hero', 'assets'), { recursive: true });
  const away = () => { rmSync(p('hl', 'sections'), { recursive: true }); symlinkSync(out, p('hl', 'sections')); };
  const back = (at) => { unlinkSync(p('hl', 'sections')); mkdirSync(dirname(at), { recursive: true }); linkSync(join(out, 'hero', 'assets', basename(at)), at); };
  await assert.rejects(copyDistToProject({ ...w, subdir: 'hl', open: atOpen(away, 3, back) }),
    (e) => code('partial')(e) && e.message === 'Copied 2 of 3 files, then: hl/sections/hero/assets moved.');
  assert.deepEqual(readdirSync(join(out, 'hero', 'assets')).map((n) => readFileSync(join(out, 'hero', 'assets', n), 'utf8')), [''], 'an empty file at most');
  assert.deepEqual(readdirSync(p('hl', 'sections', 'hero', 'assets')), [], 'the name planted in the project is removed');
});
// Review cycle 3, M-2: the open file is closed once, by the copy: never handed to a stream, which closes it on an error.
test('a write that fails closes the open file once and leaves no fd open', { skip: process.platform === 'win32' || process.getuid?.() === 0 ? 'POSIX, not root' : false }, async () => {
  const w = world(); const src = join(w.dist, 'assets', 'a.png'); chmodSync(src, 0);
  const opened = []; const closes = []; const victims = [];
  const open = (q, f, m) => { const fd = openSync(q, f, m); opened.push(fd); return fd; };
  const { close, closeSync: closeNow } = fs;
  // A file opened right after a stream's close would get the same number, and a second close would close it.
  fs.close = (fd, cb) => close(fd, (err) => { closes.push(fd); if (opened.includes(fd)) victims.push(openSync(join(w.root, `victim-${victims.length}`), 'w')); cb?.(err); });
  fs.closeSync = (fd) => { closes.push(fd); return closeNow(fd); };
  syncBuiltinESMExports();
  const fds = openFds();
  try {
    await assert.rejects(copyDistToProject({ ...w, subdir: 'd', open }), (e) => code('partial')(e) && e.message === 'Copied 0 of 3 files, then: EACCES.');
  } finally {
    fs.close = close; fs.closeSync = closeNow; syncBuiltinESMExports(); chmodSync(src, 0o644);
  }
  assert.equal(opened.length, 1);
  assert.deepEqual(closes.filter((fd) => opened.includes(fd)), opened, 'closed once');
  for (const v of victims) { fstatSync(v); closeSync(v); }
  assert.equal(openFds(), fds, 'no fd left open');
  assert.deepEqual(partFiles(join(w.projectDir, 'd')), []);
});
// Review cycle 3, M-3: every file is written to a part file first, so a write that fails half way leaves no file at its name.
test('a write that fails half way leaves nothing at the file\'s name, listed or not', async () => {
  const w = world(); const t = join(w.projectDir, 'h');
  const half = (at) => { let n = 0; return async (src, fd) => { n += 1; if (n === at) { writeSync(fd, 'HALF'); throw Object.assign(new Error('x'), { code: 'ENOSPC' }); } await writeAll(src, fd); }; };
  await assert.rejects(copyDistToProject({ ...w, subdir: 'h', write: half(2) }), (e) => code('partial')(e) && e.message === 'Copied 1 of 3 files, then: ENOSPC.' && e.data.copied === 1);
  assert.deepEqual([existsSync(join(t, 'index.html')), partFiles(t)], [false, []], 'no truncated file, no part file');
  writeFileSync(join(t, 'index.html'), 'OLD');
  await assert.rejects(copyDistToProject({ ...w, subdir: 'h', overwrite: true, expect: await keyOf({ ...w, subdir: 'h' }), write: half(2) }),
    (e) => code('partial')(e) && e.message === 'Copied 1 of 3 files, then: ENOSPC.');
  assert.deepEqual([readFileSync(join(t, 'index.html'), 'utf8'), partFiles(t)], ['OLD', []], 'the listed file keeps its bytes');
});
test('a file system with no hard links: a new file is copied in exclusively, never over a file that turned up', async () => {
  const w = world(); const p = (...a) => join(w.projectDir, ...a);
  const link = () => { throw Object.assign(new Error('x'), { code: 'EPERM' }); };
  assert.deepEqual(await copyDistToProject({ ...w, subdir: 'nl', link }), { target: 'nl', files: 3 });
  assert.deepEqual([readFileSync(p('nl', 'sections', 'hero', 'assets', 'b.svg'), 'utf8'), partFiles(p('nl'))], ['B', []]);
  await assert.rejects(copyDistToProject({ ...w, subdir: 'late', link, write: afterWrite(() => writeFileSync(p('late', 'index.html'), 'LATE'), 1) }),
    (e) => code('partial')(e) && e.message === 'Copied 1 of 3 files, then: EEXIST.');
  assert.deepEqual([readFileSync(p('late', 'index.html'), 'utf8'), partFiles(p('late'))], ['LATE', []]);
  // Review cycle 4, major 1: a file another writer makes in the very gap before the file is put in place (here inside the
  // call that puts it, whichever it is) is kept, never replaced.
  const dest = join(fs.realpathSync(w.projectDir), 'race', 'index.html');
  const { renameSync: renameNow, copyFileSync: copyNow, openSync: openNow } = fs;
  const plant = (to) => { if (to === dest) writeFileSync(to, 'OTHER'); };
  fs.renameSync = (from, to) => { plant(to); return renameNow(from, to); };
  fs.copyFileSync = (from, to, mode) => { plant(to); return copyNow(from, to, mode); };
  fs.openSync = (at, flags, mode) => { plant(at); return openNow(at, flags, mode); };
  syncBuiltinESMExports();
  try {
    await assert.rejects(copyDistToProject({ ...w, subdir: 'race', link }), (e) => code('partial')(e) && e.message === 'Copied 1 of 3 files, then: EEXIST.');
  } finally {
    fs.renameSync = renameNow; fs.copyFileSync = copyNow; fs.openSync = openNow; syncBuiltinESMExports();
  }
  assert.deepEqual([readFileSync(p('race', 'index.html'), 'utf8'), partFiles(p('race'))], ['OTHER', []]);
});
// Review cycle 5, major 1: with no hard links, a copy into the new file that fails removes that file only by a name of
// worca's own and only when the name holds worca's own file, so another program's file that took the name meanwhile is
// kept. After a copy that worked, a name another program took meanwhile is not counted as copied, and nothing is removed.
test('a file system with no hard links: a copy that fails removes only worca\'s own file, never one another program put at its name', POSIX, async () => {
  const w = world(); const p = (...a) => join(w.projectDir, ...a); const fds = openFds();
  const link = () => { throw Object.assign(new Error('x'), { code: 'EPERM' }); };
  // The copy of index.html's part file into its new file: half of it written, `meanwhile`, then ENOSPC, or with `ok` the whole of it.
  const intoNew = (meanwhile = () => {}, ok = false) => async (src, fd) => {
    if (!src.endsWith('.part') || readFileSync(src, 'utf8') !== 'H') return writeAll(src, fd);
    writeSync(fd, ok ? 'H' : 'HALF'); meanwhile();
    if (!ok) throw Object.assign(new Error('x'), { code: 'ENOSPC' });
  };
  /** Every file under `dir` with its text. */
  const texts = (dir) => readdirSync(dir, { recursive: true }).filter((n) => fs.lstatSync(join(dir, n)).isFile()).sort().map((n) => [n, readFileSync(join(dir, n), 'utf8')]);
  const NEW_FILES = [['assets/a.png', 'A']];
  // Nobody else writes: nothing at the name, no part file.
  await assert.rejects(copyDistToProject({ ...w, subdir: 'alone', link, write: intoNew() }), (e) => code('partial')(e) && e.message === 'Copied 1 of 3 files, then: ENOSPC.');
  assert.deepEqual(texts(p('alone')), NEW_FILES);
  // Another program renames its file over the name while the copy runs: its file is kept, at a name the refusal gives.
  const over = (dir) => () => { writeFileSync(p(dir, '.btmp'), 'OTHER'); renameSync(p(dir, '.btmp'), p(dir, 'index.html')); };
  let aside = null;
  await assert.rejects(copyDistToProject({ ...w, subdir: 'over', link, write: intoNew(over('over')) }), (e) => {
    aside = /^Copied 1 of 3 files, then: ENOSPC\. Another program wrote over\/index\.html meanwhile; its file is now over\/(\.worca-[0-9a-f]{8}\/index\.html)\.$/.exec(e.message)?.[1];
    return code('partial')(e) && Boolean(aside);
  });
  assert.deepEqual(texts(p('over')), [[aside, 'OTHER'], ...NEW_FILES], 'the other program\'s file, and no byte of worca\'s half-written one');
  // Another program moves worca's file to a backup name and writes its own: the backup is emptied, its own file kept.
  const backup = () => { renameSync(p('bak', 'index.html'), p('bak', 'index.html~')); writeFileSync(p('bak', 'index.html'), 'OTHER'); };
  await assert.rejects(copyDistToProject({ ...w, subdir: 'bak', link, write: intoNew(backup) }), (e) => {
    aside = /^Copied 1 of 3 files, then: ENOSPC\. Another program wrote bak\/index\.html meanwhile; its file is now bak\/(\.worca-[0-9a-f]{8}\/index\.html)\.$/.exec(e.message)?.[1];
    return code('partial')(e) && Boolean(aside);
  });
  assert.deepEqual(texts(p('bak')), [[aside, 'OTHER'], ...NEW_FILES, ['index.html~', '']]);
  // Another program removes worca's file meanwhile: nothing is at the name to clear, and no folder of worca's own stays.
  await assert.rejects(copyDistToProject({ ...w, subdir: 'gone', link, write: intoNew(() => unlinkSync(p('gone', 'index.html'))) }),
    (e) => code('partial')(e) && e.message === 'Copied 1 of 3 files, then: ENOSPC.');
  assert.deepEqual(readdirSync(p('gone'), { recursive: true }).sort(), ['assets', 'assets/a.png']);
  // A copy that worked, with the name taken meanwhile: not counted, and the other program's file stays at its name.
  await assert.rejects(copyDistToProject({ ...w, subdir: 'rep', link, write: intoNew(over('rep'), true) }),
    (e) => code('partial')(e) && e.message === 'Copied 1 of 3 files, then: rep/index.html changed meanwhile.');
  assert.deepEqual(texts(p('rep')), [...NEW_FILES, ['index.html', 'OTHER']]);
  assert.equal(openFds(), fds, 'every new file the copies opened is closed');
});
// Review cycle 6, major 1: on FAT and exFAT a file's inode number changes when it is emptied or renamed, so whether the
// fresh name holds worca's own file is judged by the open file's `fstat` taken after the rename, not at open.
test('a file system with no hard links and inode numbers that change on a truncate or a rename: a failed copy alone leaves nothing', POSIX, async () => {
  const w = world(); const p = (...a) => join(w.projectDir, ...a);
  const link = () => { throw Object.assign(new Error('x'), { code: 'EPERM' }); };
  const intoNew = async (src, fd) => {
    if (!src.endsWith('.part') || readFileSync(src, 'utf8') !== 'H') return writeAll(src, fd);
    writeSync(fd, 'HALF'); throw Object.assign(new Error('x'), { code: 'ENOSPC' });
  };
  // As macOS msdos and Windows FAT number files: a new number after a truncate or a rename, the same for fstat and lstat.
  let gen = 0n; const { ftruncateSync: tr, renameSync: rn, fstatSync: fst, lstatSync: lst } = fs;
  const shift = (st) => (typeof st?.ino === 'bigint' ? Object.assign(Object.create(Object.getPrototypeOf(st)), st, { ino: st.ino + gen * 1000003n }) : st);
  fs.ftruncateSync = (...a) => { gen += 1n; return tr(...a); };
  fs.renameSync = (...a) => { gen += 1n; return rn(...a); };
  fs.fstatSync = (...a) => shift(fst(...a));
  fs.lstatSync = (...a) => shift(lst(...a));
  syncBuiltinESMExports();
  try {
    await assert.rejects(copyDistToProject({ ...w, subdir: 'fat', link, write: intoNew }), (e) => code('partial')(e) && e.message === 'Copied 1 of 3 files, then: ENOSPC.');
  } finally {
    fs.ftruncateSync = tr; fs.renameSync = rn; fs.fstatSync = fst; fs.lstatSync = lst; syncBuiltinESMExports();
  }
  assert.deepEqual(readdirSync(p('fat'), { recursive: true }).sort(), ['assets', 'assets/a.png']);
});
// Review cycle 6, major 2: a failed copy clears its file by name only after checking, in the same tick, that the folder
// is still the one the copy started in, so a link planted on the way during the copy never moves a file outside.
test('a copy that fails after its folder became a link out of the project renames nothing outside', POSIX, async () => {
  const w = world(); const p = (...a) => join(w.projectDir, ...a); const outside = scratch('dcp-out-'); const fds = openFds();
  writeFileSync(join(outside, 'index.html'), 'VICTIM');
  const link = () => { throw Object.assign(new Error('x'), { code: 'EPERM' }); };
  const intoNew = async (src, fd) => {
    if (!src.endsWith('.part') || readFileSync(src, 'utf8') !== 'H') return writeAll(src, fd);
    writeSync(fd, 'HALF'); renameSync(p('sw'), p('sw-moved')); symlinkSync(outside, p('sw'));
    throw Object.assign(new Error('x'), { code: 'ENOSPC' });
  };
  await assert.rejects(copyDistToProject({ ...w, subdir: 'sw', link, write: intoNew }),
    (e) => code('partial')(e) && e.message === 'Copied 1 of 3 files, then: sw leads outside the project.');
  assert.deepEqual(readdirSync(outside).map((n) => [n, readFileSync(join(outside, n), 'utf8')]), [['index.html', 'VICTIM']]);
  assert.equal(openFds(), fds, 'the new file is closed');
});
// Review cycle 7, major 1: the folder can still be swapped after clearOwn's check, a syscall or two before its rename.
// The clearing rename is the one whose source is the target's own name (index.html), so it moves that name into a
// folder of worca's own made in the checked folder and checked again: after a swap the rename finds no such folder.
test('a failed copy whose folder, or worca\'s own folder for the clearing rename, is swapped at the last moment moves nothing outside', POSIX, async () => {
  const w = world(); const p = (...a) => join(w.projectDir, ...a); const fds = openFds();
  const link = () => { throw Object.assign(new Error('x'), { code: 'EPERM' }); };
  const intoNew = async (src, fd) => {
    if (!src.endsWith('.part') || readFileSync(src, 'utf8') !== 'H') return writeAll(src, fd);
    writeSync(fd, 'HALF'); throw Object.assign(new Error('x'), { code: 'ENOSPC' });
  };
  const { renameSync: renameNow, mkdirSync: mkdirNow } = fs;
  /** worca's own folder for the clearing rename. */
  const isBox = (at) => /^\.worca-[0-9a-f]{8}$/.test(basename(at));
  /** Another program swaps `dir` for a link to a fresh outside folder holding its own index.html, in the call `when` picks. */
  const swapIn = async (dir, when, message) => {
    const outside = scratch('dcp-out-'); writeFileSync(join(outside, 'index.html'), 'VICTIM');
    const own = join(fs.realpathSync(w.projectDir), dir);
    let swapped = false;
    const swap = (at) => { if (!swapped && when(at, own)) { swapped = true; renameNow(p(dir), p(`${dir}-moved`)); symlinkSync(outside, p(dir)); } };
    fs.renameSync = (from, to) => { swap(from); return renameNow(from, to); };
    fs.mkdirSync = (at, ...rest) => { swap(at); return mkdirNow(at, ...rest); };
    syncBuiltinESMExports();
    try {
      await assert.rejects(copyDistToProject({ ...w, subdir: dir, link, write: intoNew }), (e) => code('partial')(e) && e.message === message);
    } finally {
      fs.renameSync = renameNow; fs.mkdirSync = mkdirNow; syncBuiltinESMExports();
    }
    assert.equal(swapped, true, `${dir}: the swap ran`);
    assert.deepEqual(readdirSync(outside).map((n) => [n, readFileSync(join(outside, n), 'utf8')]), [['index.html', 'VICTIM']], `${dir}: nothing outside moved, and no folder of worca's own stays there`);
  };
  // In the clearing rename's own call, before it runs: the rename's target folder is not there, and nothing moves.
  await swapIn('sw', (at, own) => at === join(own, 'index.html'), 'Copied 1 of 3 files, then: ENOSPC.');
  // Before worca's own folder is made: it is made where the link leads, the check after it refuses and removes it.
  await swapIn('mk', (at, own) => dirname(at) === own && isBox(at), 'Copied 1 of 3 files, then: mk leads outside the project.');
  // Another program removes worca's own folder right after it is made, or puts a link out of the project in its place:
  // the copy's own failure is the one reported, and nothing moves into where the link leads.
  const outside = scratch('dcp-out-'); writeFileSync(join(outside, 'index.html'), 'VICTIM');
  for (const [dir, then] of [['rm', (at) => fs.rmdirSync(at)], ['ln', (at) => { fs.rmdirSync(at); symlinkSync(outside, at); }]]) {
    fs.mkdirSync = (at, ...rest) => { const r = mkdirNow(at, ...rest); if (isBox(at)) then(at); return r; };
    syncBuiltinESMExports();
    try {
      await assert.rejects(copyDistToProject({ ...w, subdir: dir, link, write: intoNew }), (e) => code('partial')(e) && e.message === 'Copied 1 of 3 files, then: ENOSPC.', dir);
    } finally {
      fs.mkdirSync = mkdirNow; syncBuiltinESMExports();
    }
  }
  assert.deepEqual(readdirSync(outside).map((n) => [n, readFileSync(join(outside, n), 'utf8')]), [['index.html', 'VICTIM']], 'nothing moved through the link at worca\'s folder');
  assert.equal(openFds(), fds, 'the new files are closed');
});
