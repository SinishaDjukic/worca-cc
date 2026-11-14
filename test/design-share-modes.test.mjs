// test/design-share-modes.test.mjs
// Design P8 Task 5 (L8.13, L8.28): what a design's files look like to its owner's agent. Under a share umask (007)
// the copied uploads, the versions and a restore all stay readable and writable by the agent's group; the copy's mode
// change follows no link and waits on no FIFO planted at its name; snapshot and restore refuse a work/ that is a link
// (a restore empties work/, which through a link is another folder). And a Design chat turn claims its design for the
// turn's person (a turn with none: the design's maker), a refused claim ending the turn with a reason that names no
// path. Its own server (bootDesignChat): the chat row needs startAskTurn, and the mode rows share its home. Mode rows
// are POSIX. The fix cycle (review C3, C4): a copy never writes through a link planted at its name or a swapped
// `assets/att`; `dist/` and `versions/` are worca's alone (a claim closes them, and a rebuilt dist/ is made so), and a
// restore copies only from the version folder it checked.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync, closeSync, constants, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, renameSync, rmSync,
  statSync, symlinkSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { copyFile, lstat, mkdir, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { bootDesignChat } from './helpers/design-chat-boot.mjs';
import { patchFs } from './helpers/fs-gate.mjs';

const POSIX = process.platform === 'win32' ? 'POSIX' : false;
const { call, settled, mod } = await bootDesignChat(after);
const { addAttachment, appendMessage, attachmentPath, createThread, getThread } = await import('../src/core/ask/store.mjs');
const { copyThreadAttachments } = await import('../src/core/design/attachments.mjs');
const { createDesignThread } = await import('../src/core/design/chat-thread.mjs');
const { designDir, designWorkDir, distDir, versionDir, versionsDir } = await import('../src/core/design/paths.mjs');
const { createDesign, getDesign, updateDesign } = await import('../src/core/design/store.mjs');
const { restoreVersion, snapshotVersion } = await import('../src/core/design/versions.mjs');

const scratch = [];
after(() => { for (const p of scratch) rmSync(p, { recursive: true, force: true }); });
const tmp = (prefix) => { const p = mkdtempSync(join(tmpdir(), prefix)); scratch.push(p); return p; };

/** Runs `fn` under the share umask: what worca makes is group read-write, as on the hosted volume. */
async function underShareUmask(fn) {
  const prev = process.umask(0o007);
  try { return await fn(); } finally { process.umask(prev); }
}

/** A design whose chat holds uploads (`brief.md` by default), each made private (0600) as an upload folder can be. */
function designWithUpload(names = ['brief.md']) {
  const d = createDesign({ kind: 'web', title: 'Share' }, { by: 'local' });
  const t = createThread({ mode: 'design', title: d.title });
  updateDesign(d.id, { threadId: t.id });
  const m = appendMessage(t.id, { role: 'user', text: 'x' });
  for (const name of names) {
    const a = addAttachment(t.id, m.id, { name, text: 'hello' });
    chmodSync(attachmentPath(t.id, a.id), 0o600);
  }
  return { d, t };
}
/** No group or other bits on `p`. */
const worcaOnly = (p) => (lstatSync(p).mode & 0o077).toString(8);

/** `root` and every entry under it that is not a link, as `[path, stats]`. */
function plainTree(root) {
  const out = [[root, lstatSync(root)]];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = lstatSync(p);
      if (st.isSymbolicLink()) continue;
      out.push([p, st]);
      if (st.isDirectory()) walk(p);
    }
  };
  walk(root);
  return out;
}

test('files stay usable by the agent\'s group', { skip: POSIX }, async () => {
  const d = await underShareUmask(async () => {
    const made = designWithUpload();
    assert.deepEqual(await copyThreadAttachments({ threadId: made.t.id, workDir: designWorkDir(made.d.id) }), ['brief.md']);
    assert.equal(await snapshotVersion({ designId: made.d.id }), 1);
    assert.deepEqual(await restoreVersion({ designId: made.d.id, n: 1 }), { version: 2, restoredFrom: 1 });
    return made.d;
  });
  const home = designDir(d.id);
  const tree = [...plainTree(designWorkDir(d.id)), ...plainTree(versionsDir(d.id))];
  const names = tree.map(([p]) => relative(home, p));
  for (const want of ['work/assets/att/brief.md', 'versions/1/assets/att/brief.md', 'versions/2/assets/att/brief.md']) {
    assert.ok(names.includes(want), `${want} in ${names.join(', ')}`);
  }
  assert.equal(worcaOnly(versionsDir(d.id)), '0', 'versions/ itself is worca\'s alone');
  for (const [p, st] of tree) {
    if (p === versionsDir(d.id)) continue;
    const mode = (st.mode & 0o777).toString(8);
    // P8 review cycle 4 (major 1): every copy gets a fixed mode, never its source's: 0600 in versions/ (worca's alone),
    // 0660 when a restore puts it back in work/.
    if (st.isFile() && !relative(versionsDir(d.id), p).startsWith('..')) {
      assert.equal(mode, '600', `${relative(home, p)} is worca's alone (${mode})`);
      continue;
    }
    assert.equal(st.mode & 0o060, 0o060, `${relative(home, p)} is group read-write (${mode})`);
    if (st.isDirectory()) assert.equal(st.mode & 0o010, 0o010, `${relative(home, p)} is group traversable (${mode})`);
  }
});

test('a link swapped in at the copy\'s destination is not followed by the chmod', { skip: POSIX }, async () => {
  const { t } = designWithUpload();
  const victim = join(tmp('worca-share-victim-'), 'worca-own.txt');
  writeFileSync(victim, 'worca');
  chmodSync(victim, 0o600);
  const io = {
    mkdir, lstat, rm, open,
    copyFile: async (from, to) => { await copyFile(from, to); await rm(to); symlinkSync(victim, to); },
  };
  await assert.rejects(copyThreadAttachments({ threadId: t.id, workDir: tmp('worca-share-work-'), io }));
  assert.equal(statSync(victim).mode & 0o777, 0o600, 'the link\'s target keeps its mode');
});

test('C3: a link planted at an upload\'s name before the copy is never written through', { skip: POSIX }, async () => {
  const { t } = designWithUpload();
  const victim = join(tmp('worca-share-victim-'), 'worca-own.txt');
  writeFileSync(victim, 'worca');
  const io = { mkdir, lstat, rm, open, copyFile: async (from, to, mode) => { symlinkSync(victim, to); return copyFile(from, to, mode); } };
  await assert.rejects(copyThreadAttachments({ threadId: t.id, workDir: tmp('worca-share-work-'), io }), { code: 'EEXIST' });
  assert.equal(readFileSync(victim, 'utf8'), 'worca', 'the link\'s target is never written');
});

test('C3: assets/att swapped for a link after a copy: no later upload lands in its target', { skip: POSIX }, async () => {
  const { t } = designWithUpload(['one.md', 'two.md']);
  const work = tmp('worca-share-swap-');
  const att = join(work, 'assets', 'att');
  const target = tmp('worca-share-target-');
  let copies = 0;
  let swapped = false;
  const io = {
    mkdir, rm, open,
    copyFile: async (from, to, mode) => { await copyFile(from, to, mode); copies += 1; },
    // The swap lands once the first upload is copied and made group usable, at the next look at the folder chain.
    lstat: async (p, ...rest) => {
      if (copies === 1 && !swapped && (p === join(work, 'assets') || p.startsWith(`${att}/`))) {
        swapped = true;
        renameSync(att, `${att}-real`);
        symlinkSync(target, att, 'dir');
      }
      return lstat(p, ...rest);
    },
  };
  await assert.rejects(copyThreadAttachments({ threadId: t.id, workDir: work, io }), { code: 'ELOOP' });
  assert.equal(swapped, true);
  assert.deepEqual(readdirSync(target), [], 'nothing written into the link\'s target');
  assert.equal(copies, 1);
});

test('C4: a claim closes dist/ and versions/ to worca, and a rebuilt dist/ is made so', { skip: POSIX }, async () => {
  const d = await underShareUmask(async () => createDesign({ kind: 'web', title: 'Closed' }, { by: 'local' }));
  assert.equal(worcaOnly(designDir(d.id)), '0', 'a new design folder is worca\'s alone until it is claimed');
  for (const p of [distDir(d.id), versionsDir(d.id)]) assert.equal(worcaOnly(p), '0', `${relative(designDir(d.id), p)} is made worca's alone`);
  // A snapshot that has to make versions/ again makes it so too.
  rmSync(versionsDir(d.id), { recursive: true });
  writeFileSync(join(designWorkDir(d.id), 'index.html'), '<p>v1</p>');
  assert.equal(await underShareUmask(() => snapshotVersion({ designId: d.id })), 1);
  assert.equal(worcaOnly(versionsDir(d.id)), '0', 'versions/ made by a snapshot');
  // A design made before: both group read-write, as the share umask left them.
  for (const p of [distDir(d.id), versionsDir(d.id)]) chmodSync(p, 0o2770);
  const own = mod.designBuilds._claimDir;
  mod.designBuilds._claimDir = () => {};
  try {
    mod.designBuilds.claim(d.id, { owner: 'local' });
    for (const p of [distDir(d.id), versionsDir(d.id)]) assert.equal(worcaOnly(p), '0', `${relative(designDir(d.id), p)} after a claim`);
    await underShareUmask(async () => {
      await mod.designBuilds.start({ designId: d.id, brief: 'MOCK_SECTIONS=1', by: 'local' });
      await mod.designBuilds.settled();
    });
    assert.ok(statSync(join(distDir(d.id), 'index.html')).isFile(), 'the build wrote dist/');
    assert.equal(worcaOnly(distDir(d.id)), '0', 'the rebuilt dist/ is worca\'s alone');
  } finally {
    mod.designBuilds._claimDir = own;
  }
});

test('C4: a versions/<n> swapped for a link after the restore checked it is refused, its target never copied', { skip: POSIX }, async () => {
  const d = createDesign({ kind: 'web', title: 'Swapped' }, { by: 'local' });
  const work = designWorkDir(d.id);
  writeFileSync(join(work, 'index.html'), '<p>v1</p>');
  assert.equal(await snapshotVersion({ designId: d.id }), 1);
  const v1 = versionDir(d.id, 1);
  const other = tmp('worca-share-other-');
  writeFileSync(join(other, 'secret.txt'), 'worca');
  let armed = true;
  const restore = patchFs('readdir', (orig) => async (p, ...a) => {
    if (armed && p === work) { armed = false; renameSync(v1, `${v1}-real`); symlinkSync(other, v1, 'dir'); }
    return orig(p, ...a);
  });
  try {
    await assert.rejects(restoreVersion({ designId: d.id, n: 1 }), { code: 'ELOOP' });
  } finally {
    restore();
  }
  assert.equal(armed, false, 'swapped once the check passed');
  assert.equal(existsSync(join(work, 'secret.txt')), false, 'the link\'s target is not copied into work/');
});

test('a FIFO planted at the copy\'s destination is refused, never waited on', { skip: POSIX }, async () => {
  const { t } = designWithUpload();
  const work = tmp('worca-share-fifo-');
  const fifo = join(work, 'assets', 'att', 'brief.md');
  const io = {
    mkdir, lstat, rm, open,
    copyFile: async (from, to) => {
      await copyFile(from, to);
      await rm(to);
      assert.equal(spawnSync('mkfifo', [to]).status, 0, 'mkfifo');
    },
  };
  const outcome = copyThreadAttachments({ threadId: t.id, workDir: work, io }).then(() => 'copied', () => 'refused');
  let timer;
  const first = await Promise.race([outcome, new Promise((res) => { timer = setTimeout(() => res('hung'), 2000); })]);
  clearTimeout(timer);
  if (first === 'hung') closeSync(openSync(fifo, constants.O_WRONLY | constants.O_NONBLOCK));   // let the blocked open end
  assert.deepEqual([first, await outcome], ['refused', 'refused']);
});

test('snapshot and restore refuse a work/ that is a link, and leave its target untouched', { skip: POSIX }, async () => {
  const d = createDesign({ kind: 'web', title: 'Linked' }, { by: 'local' });
  const work = designWorkDir(d.id);
  mkdirSync(work, { recursive: true });
  writeFileSync(join(work, 'index.html'), '<p>v1</p>');
  assert.equal(await snapshotVersion({ designId: d.id }), 1);
  const other = tmp('worca-share-other-');
  writeFileSync(join(other, 'keep.txt'), 'worca');
  renameSync(work, `${work}-real`);
  symlinkSync(other, work, 'dir');
  // Refused for being a link (ENOTDIR), not by a later step failing on the way.
  await assert.rejects(snapshotVersion({ designId: d.id }), { code: 'ENOTDIR' });
  await assert.rejects(restoreVersion({ designId: d.id, n: 1 }), { code: 'ENOTDIR' });
  assert.deepEqual(readdirSync(other), ['keep.txt'], 'nothing removed from or copied into the target');
  assert.equal(readFileSync(join(other, 'keep.txt'), 'utf8'), 'worca');
  assert.equal(getDesign(d.id).version, 1);
  assert.deepEqual(readdirSync(versionsDir(d.id)), ['1']);

  // With no work/ at all, a restore makes it again, as before.
  unlinkSync(work);
  assert.deepEqual(await restoreVersion({ designId: d.id, n: 1 }), { version: 2, restoredFrom: 1 });
  assert.equal(readFileSync(join(work, 'index.html'), 'utf8'), '<p>v1</p>');
});

test('a Design chat turn claims its design for the turn\'s person; a refused claim ends it safely', async () => {
  // Made by Ada; on a local install the chat's turns are local's, so the two owners differ.
  const design = createDesign({ kind: 'web', title: 'Claimed' }, { by: 'ada@example.com' });
  const id = design.id;
  const threadId = createDesignThread({ design, by: 'ada@example.com' }).id;
  updateDesign(id, { threadId });
  const MODEL = { model: 'claude-opus-5-5', effort: 'high' };
  const send = () => call('POST', `/api/ask/threads/${threadId}/messages`, { text: 'MOCK_DESIGN_CHAT hi', ...MODEL, design: { designId: id, pins: [] } });
  const claimsFor = (owner) => [
    [designDir(id), { owner, mode: 0o2750, sharedFallback: true }],
    [designWorkDir(id), { owner, sharedFallback: true }],
  ];
  const seen = [];
  let fail = null;
  const own = mod.designBuilds._claimDir;
  mod.designBuilds._claimDir = (dir, opts) => { seen.push([dir, opts]); if (fail) throw fail; };
  try {
    const ok = await send();
    assert.equal(ok.status, 202, JSON.stringify(ok.body));
    await settled(threadId);
    assert.deepEqual(seen, claimsFor('local'), 'the turn\'s person');

    fail = Object.assign(new Error(`${designDir(id)} is not ours`), { code: 'ELOOP' });
    const refused = await send();
    assert.deepEqual([refused.status, refused.body?.error], [500, "Could not prepare this design's folder (ELOOP)"]);
    assert.equal(mod._testing.askJobs.get(threadId), undefined, 'the slot is free again');

    // A turn with no person in its context (an event turn): the design's maker.
    fail = null;
    seen.length = 0;
    const thread = getThread(threadId);
    const r = await mod._testing.startAskTurn({ threadId, thread, ctx: thread.context || {}, ...MODEL, text: 'MOCK_DESIGN_CHAT again' });
    assert.equal(r.ok, true, JSON.stringify(r));
    await settled(threadId);
    assert.deepEqual(seen, claimsFor('ada@example.com'));
  } finally {
    mod.designBuilds._claimDir = own;
  }
});
