// test/design-planted-links.test.mjs
// Design P8 fix cycle (review C1, C2, M2): work/ is the owner's agents' to write (hosted: 2770 in the run group; locally
// a Codex lead's sandbox), so an agent can plant a link or a FIFO under it. Whatever the server then removes, makes,
// stages or reads there never goes through such a link and never waits on such a FIFO: a `sections` link or a
// `sections/<id>` link is removed, never followed, by the round's clears and tidies and by the read bundle; plan.json,
// round.json and integration.json read through `readConfined` (a link or a FIFO reads as not written); a planted
// `.asks` in a section is replaced. POSIX: links to folders and FIFOs. Fix cycle 2 (review C-1): a `sections` an agent
// swaps for a link AFTER the check redirects no removal, retries included (Linux: through the open folder; other POSIX
// systems: moved into a worca-only trash and checked first), and a section link planted during the lead stage never
// becomes a builder's folder. Fix cycle 3: a restore removes and writes in work/ only through folders held open, a
// snapshot and dist read it by descriptor, shell.html is renamed over (never written through a link), a question file
// is read and removed through its folders held open, and a folder another user owns under work/ is set aside. Fix
// cycle 4: a name read from disk may hold a backslash (POSIX), a restore puts each file in by rename (a name an agent
// fills meanwhile never stops it) and sets aside what it cannot remove, without retrying, every copy gets a fixed mode,
// and dist and a snapshot skip an entry worca cannot read or whose copy's path is too long. Fix cycle 5: a name an
// agent fills again after its set-aside is cleared again, a bounded number of times, the start folder of a dist asset
// copy is skipped like the entries below it, and a copy stops at the size its source had when it began. Fix cycle 6:
// a failed rename or removal at a name looks again at whatever stands there by then, while the folder above is the same.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync,
  statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, sep } from 'node:path';
import { framesOf, newBuild, newDesign, useDesignEnv } from './helpers/design-fixture.mjs';
import { patchFs } from './helpers/fs-gate.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';
import { assembleDesign } from '../src/core/design/assemble.mjs';
import { DesignBuild } from '../src/core/design/build.mjs';
import {
  asksDir, designDir, designWorkDir, distDir, ensureDesignFolders, inWorkFolder, removeSectionDir, sectionDir, versionDir,
} from '../src/core/design/paths.mjs';
import { validatePlan } from '../src/core/design/plan.mjs';
import { asksFileFor, readAskFile, removeAskFile } from '../src/core/design/questions.mjs';
import { removeReadBundle, stageReadBundle } from '../src/core/design/read-bundle.mjs';
import { createDesignBuilds } from '../src/core/design/registry.mjs';
import { getBuild, getDesign } from '../src/core/design/store.mjs';
import { restoreVersion, snapshotVersion } from '../src/core/design/versions.mjs';

useDesignEnv(after);
const POSIX = { skip: process.platform === 'win32' ? 'POSIX: folder links and FIFOs' : false };
/** Only where a removal moves the folder first: Linux removes through the open `sections` (no move), Windows by path. */
const MOVES = { skip: ['win32', 'linux'].includes(process.platform) ? 'the trash move runs on POSIX systems other than Linux' : false };
/** Only where work/ is walked through `/proc/self/fd`: a folder swapped after it was opened changes nothing there. */
const VIA_FD = { skip: process.platform !== 'linux' ? '/proc/self/fd (Linux only)' : false };
/** Only where a level below work/ is reached by path: Linux reaches it through the one above held open. */
const BY_PATH = { skip: ['win32', 'linux'].includes(process.platform) ? 'work/ is walked by path on POSIX systems other than Linux' : false };
const fs = createRequire(import.meta.url)('node:fs');
/** Replaces node:fs `name` with wrap(original) for every ESM importer, this file's own included; returns restore(). */
function patchSync(name, wrap) {
  const orig = fs[name];
  fs[name] = wrap(orig);
  syncBuiltinESMExports();
  return () => { fs[name] = orig; syncBuiltinESMExports(); };
}
/** The `.trash-*` folders left in a design's folder. */
const trashOf = (id) => readdirSync(designDir(id)).filter((n) => n.startsWith('.trash-'));
const mockRun = (o) => runClaude({ ...o, mock: true });
const inSection = (o, id) => o.cwd.endsWith(`${sep}sections${sep}${id}`);

/** A folder outside every design holding `<name>/keep.txt` for each name; removed after the file. */
function outside(...names) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'dpl-outside-')));
  after(() => rmSync(dir, { recursive: true, force: true }));
  for (const n of names) {
    mkdirSync(join(dir, n));
    writeFileSync(join(dir, n, 'keep.txt'), `keep ${n}`);
  }
  return dir;
}
/** Each `<name>/keep.txt` of `dir` still there, with its text. */
const untouched = (dir, names) => names.map((n) => existsSync(join(dir, n, 'keep.txt')) && readFileSync(join(dir, n, 'keep.txt'), 'utf8'));
/** Replaces work/sections with a link to `target` (the real folder kept aside). */
function linkSections(designId, target) {
  const sections = join(designWorkDir(designId), 'sections');
  renameSync(sections, `${sections}-real`);
  symlinkSync(target, sections, 'dir');
}
const isLink = (p) => { try { return lstatSync(p).isSymbolicLink(); } catch { return false; } };
async function firstBuild(brief = 'MOCK_SECTIONS=2', fields = {}) {
  const d = newDesign(fields);
  const { build } = newBuild(d, { brief });
  assert.deepEqual(await build.run(), { status: 'done', reason: null });
  return getDesign(d.id);
}

test('C1: a sections link planted during the change stage: the removed section\'s tidy and the add\'s clear never follow it', POSIX, async () => {
  const d = await firstBuild();
  const out = outside('features', 'faq');
  const { build } = newBuild(d, { kind: 'change', brief: 'MOCK_ROUND_ADD=faq:hero MOCK_ROUND_REMOVE=features', sections: [], needsLead: true, deps: {
    runClaude: async (o) => {
      const r = await mockRun(o);
      if (o.maxTurns === 20) linkSections(d.id, out);
      return r;
    },
  } });
  await build.run();
  assert.deepEqual(untouched(out, ['features', 'faq']), ['keep features', 'keep faq'], 'neither folder of the link target is removed');
  assert.equal(isLink(join(designWorkDir(d.id), 'sections')), false, 'the planted link is gone');
});

test('C1: a sections link planted during an add-only change stage: the add\'s clear is the first to meet it, and never follows it', POSIX, async () => {
  const d = await firstBuild();
  const out = outside('faq');
  const { build } = newBuild(d, { kind: 'change', brief: 'MOCK_ROUND_ADD=faq:hero', sections: [], needsLead: true, deps: {
    runClaude: async (o) => {
      const r = await mockRun(o);
      if (o.maxTurns === 20) linkSections(d.id, out);
      return r;
    },
  } });
  await build.run();
  assert.deepEqual(untouched(out, ['faq']), ['keep faq']);
  assert.equal(isLink(join(designWorkDir(d.id), 'sections')), false);
});

test('C1: a sections link at a round\'s start: clearing an add that never built never follows it', POSIX, async () => {
  const d = await firstBuild();
  let drain = () => {};
  const add = newBuild(d, { kind: 'change', brief: 'MOCK_ROUND_ADD=faq:hero', sections: [], needsLead: true, deps: {
    runClaude: async (o) => { const r = await mockRun(o); if (o.maxTurns === 20) drain(); return r; },
  } });
  drain = () => add.build.pauseForDrain();
  assert.deepEqual(await add.build.run(), { status: 'paused', reason: 'drain' });
  await DesignBuild.rehydrate({ buildId: add.build.id, deps: { runClaude: mockRun } }).stop('user');
  assert.equal(getBuild(add.build.id).sections.find((s) => s.id === 'faq').unbuiltAdd, true, 'the add never built');
  const out = outside('faq');
  linkSections(d.id, out);
  newBuild(getDesign(d.id), { kind: 'change', brief: 'Bolder', sections: ['hero'], needsLead: false, deps: { runClaude: () => new Promise(() => {}) } });
  assert.deepEqual(untouched(out, ['faq']), ['keep faq']);
  assert.equal(isLink(join(designWorkDir(d.id), 'sections')), false);
});

test('C1: the read bundle never stages or removes through a planted section link or sections link', POSIX, () => {
  const d = newDesign();
  const work = designWorkDir(d.id);
  const hero = sectionDir(d.id, 'hero');
  writeFileSync(join(work, 'tokens.css'), ':root{}');
  // The section folder linked out, its target holding a .ctx: staging removes the link and stages into a real folder.
  const out = outside('.ctx');
  symlinkSync(out, hero, 'dir');
  const r = stageReadBundle({ designId: d.id, sectionId: 'hero' });
  assert.equal(isLink(hero), false, 'the section link is gone');
  assert.deepEqual(r.files, ['tokens.css']);
  assert.ok(lstatSync(r.dir).isDirectory());
  assert.deepEqual(untouched(out, ['.ctx']), ['keep .ctx'], 'nothing removed from the target');
  assert.deepEqual(readdirSync(join(out, '.ctx')), ['keep.txt'], 'nothing written into it');
  // Planted again before the removal: only the link goes.
  rmSync(hero, { recursive: true });
  symlinkSync(out, hero, 'dir');
  removeReadBundle({ designId: d.id, sectionId: 'hero' });
  assert.deepEqual(untouched(out, ['.ctx']), ['keep .ctx']);
  assert.equal(isLink(hero), false);

  // The whole sections folder linked out, its target's hero holding a .ctx: neither removal nor staging reaches it.
  const parent = outside('hero');
  mkdirSync(join(parent, 'hero', '.ctx'));
  writeFileSync(join(parent, 'hero', '.ctx', 'keep.txt'), 'keep ctx');
  rmSync(join(work, 'sections'), { recursive: true });
  symlinkSync(parent, join(work, 'sections'), 'dir');
  removeReadBundle({ designId: d.id, sectionId: 'hero' });
  assert.deepEqual(readdirSync(join(parent, 'hero', '.ctx')), ['keep.txt']);
  assert.equal(isLink(join(work, 'sections')), false, 'the sections link is gone');
  symlinkSync(parent, join(work, 'sections'), 'dir');
  stageReadBundle({ designId: d.id, sectionId: 'hero' });
  assert.deepEqual(readdirSync(join(parent, 'hero', '.ctx')), ['keep.txt'], 'staging never reaches it either');
  assert.deepEqual(readdirSync(join(parent, 'hero')), ['.ctx', 'keep.txt']);
  assert.ok(lstatSync(join(work, 'sections')).isDirectory() && !isLink(join(work, 'sections')));
  assert.ok(lstatSync(join(hero, '.ctx')).isDirectory(), 'staged into a real folder');
});

test('C1: making the design\'s folders replaces a planted sections link, never making anything through it', POSIX, () => {
  const d = newDesign();
  const out = outside();
  linkSections(d.id, out);
  ensureDesignFolders(d.id);
  assert.ok(lstatSync(join(designWorkDir(d.id), 'sections')).isDirectory());
  assert.equal(isLink(join(designWorkDir(d.id), 'sections')), false);
  assert.deepEqual(readdirSync(out), []);
});

test('C-1: sections swapped for a link after the check: a section\'s removal and a read bundle\'s never reach the link\'s target, retries included', POSIX, () => {
  // The agent swaps `sections` while rmSync runs: every retry of a removal by path resolves `sections` again.
  const swapOnRemove = (designId, target, fn) => {
    let swaps = 0;
    const restore = patchSync('rmSync', (rm) => (p, o) => {
      if (swaps === 0) { swaps += 1; linkSections(designId, target); }
      return rm(p, o);
    });
    try { fn(); } finally { restore(); }
    assert.equal(swaps, 1, 'the removal ran');
  };
  const d = newDesign();
  const sections = join(designWorkDir(d.id), 'sections');
  mkdirSync(join(sections, 'store'));
  writeFileSync(join(sections, 'store', 'index.html'), '<p>');
  const out = outside('store');
  swapOnRemove(d.id, out, () => removeSectionDir(d.id, 'store'));
  assert.deepEqual(untouched(out, ['store']), ['keep store'], 'nothing removed from the link\'s target');
  assert.equal(existsSync(join(`${sections}-real`, 'store')), false, 'the section itself is gone');
  assert.deepEqual(trashOf(d.id), [], 'no trash left behind');

  const e = newDesign();
  const eSections = join(designWorkDir(e.id), 'sections');
  mkdirSync(join(eSections, 'hero', '.ctx'), { recursive: true });
  writeFileSync(join(eSections, 'hero', '.ctx', 'plan.json'), '{}');
  const parent = outside('hero');
  mkdirSync(join(parent, 'hero', '.ctx'));
  writeFileSync(join(parent, 'hero', '.ctx', 'keep.txt'), 'keep ctx');
  swapOnRemove(e.id, parent, () => removeReadBundle({ designId: e.id, sectionId: 'hero' }));
  assert.deepEqual(readdirSync(join(parent, 'hero', '.ctx')), ['keep.txt'], 'the target\'s .ctx is kept');
  assert.equal(existsSync(join(`${eSections}-real`, 'hero', '.ctx')), false, 'the bundle itself is gone');
  assert.ok(existsSync(join(`${eSections}-real`, 'hero')), 'only the bundle');
  assert.deepEqual(trashOf(e.id), []);
});

test('C-1: sections swapped for a link between the check and the move: what moved is put back, never removed', MOVES, () => {
  const d = newDesign();
  const sections = join(designWorkDir(d.id), 'sections');
  mkdirSync(join(sections, 'store'));
  writeFileSync(join(sections, 'store', 'index.html'), '<p>');
  const out = outside('store');
  let swaps = 0;
  const restore = patchSync('renameSync', (rename) => (from, to) => {
    if (swaps === 0) {
      swaps += 1;
      rename(sections, `${sections}-real`);
      symlinkSync(out, sections, 'dir');
    }
    return rename(from, to);
  });
  try {
    assert.throws(() => removeSectionDir(d.id, 'store'), { code: 'ELOOP' });
  } finally {
    restore();
  }
  assert.equal(swaps, 1);
  assert.deepEqual(untouched(out, ['store']), ['keep store'], 'the target\'s folder is back in its place');
  assert.equal(readFileSync(join(`${sections}-real`, 'store', 'index.html'), 'utf8'), '<p>', 'nothing removed');
  assert.deepEqual(trashOf(d.id), [], 'the empty trash is removed');
});

test('C-1: a section link planted during the lead stage: the builder starts in a real folder under work/, never in the link\'s target', POSIX, async () => {
  const d = newDesign();
  const out = outside();
  const hero = sectionDir(d.id, 'hero');
  const cwds = [];
  const { build } = newBuild(d, { brief: 'MOCK_SECTIONS=1', deps: {
    runClaude: async (o) => {
      if (inSection(o, 'hero')) cwds.push(realpathSync(o.cwd));
      const r = await mockRun(o);
      if (o.maxTurns === 80) {
        rmSync(hero, { recursive: true, force: true });
        symlinkSync(out, hero, 'dir');
      }
      return r;
    },
  } });
  assert.deepEqual(await build.run(), { status: 'done', reason: null });
  assert.ok(cwds.length > 0, 'the builder ran');
  const want = join(realpathSync(designWorkDir(d.id)), 'sections', 'hero');
  assert.deepEqual([...new Set(cwds)], [want], 'its folder resolves under work/');
  assert.deepEqual(readdirSync(out), [], 'nothing written in the link\'s target');
  assert.equal(isLink(hero), false, 'the planted link is gone');
});

test('C2: a plan.json linked to another design\'s valid plan is not this design\'s plan', POSIX, async () => {
  const other = await firstBuild('MOCK_SECTIONS=3');
  const otherPlan = join(designWorkDir(other.id), 'plan.json');
  const d = newDesign();
  const plan = join(designWorkDir(d.id), 'plan.json');
  const { build, frames, calls } = newBuild(d, { brief: 'MOCK_SECTIONS=2', deps: {
    runClaude: async (o) => {
      if (o.maxTurns !== 80) return mockRun(o);
      if (!isLink(plan)) symlinkSync(otherPlan, plan);
      return { text: 'Planned.', exitCode: 0 };
    },
  } });
  assert.deepEqual(await build.run(), { status: 'error', reason: 'plan-invalid' });
  assert.equal(calls.length, 2, 'one fix resume, no builder');
  assert.equal(framesOf(frames, 'design-plan').length, 0, 'another design\'s plan is never sent');

  // A change round, a Continue's snapshot and a start's pins read it the same way.
  const mine = await firstBuild();
  const minePlan = join(designWorkDir(mine.id), 'plan.json');
  rmSync(minePlan);
  symlinkSync(otherPlan, minePlan);
  assert.throws(() => newBuild(getDesign(mine.id), { kind: 'change', brief: 'x', sections: [], needsLead: true }),
    { name: 'DesignRefusal', status: 422, message: 'A change round needs a valid plan' });
  const r = createDesignBuilds({ broadcast: () => {} });
  assert.equal(r.snapshotFor(getDesign(mine.id).currentBuild).plan.planRev, 0, 'the row snapshot holds no plan');
});

test('C2: a round.json or integration.json linked out of work/ is never applied', POSIX, async () => {
  const d = await firstBuild();
  const out = outside();
  const stray = join(out, 'round.json');
  writeFileSync(stray, JSON.stringify({ v: 1, summary: 's', touch: [], add: [], remove: ['features'] }));
  const round = join(designWorkDir(d.id), 'round.json');
  const r = newBuild(d, { kind: 'change', brief: 'Warmer', sections: [], needsLead: true, deps: {
    runClaude: async (o) => {
      if (o.maxTurns !== 20) return mockRun(o);
      if (!isLink(round)) symlinkSync(stray, round);
      return { text: 'Planned.', exitCode: 0 };
    },
  } });
  assert.deepEqual(await r.build.run(), { status: 'error', reason: 'plan-invalid' });
  assert.deepEqual(JSON.parse(readFileSync(join(designWorkDir(d.id), 'plan.json'), 'utf8')).sections.map((s) => s.id), ['hero', 'features']);

  const e = newDesign();
  const work = join(out, 'integration.json');
  writeFileSync(work, '{"v":1,"rework":[{"id":"hero","why":"x"}]}');
  const integration = join(designWorkDir(e.id), 'integration.json');
  const i = newBuild(e, { brief: 'MOCK_SECTIONS=2', deps: {
    runClaude: async (o) => {
      if (o.maxTurns !== 40) return mockRun(o);
      if (!isLink(integration)) symlinkSync(work, integration);
      return { text: 'Integrated.', exitCode: 0 };
    },
  } });
  assert.deepEqual(await i.build.run(), { status: 'done', reason: null });
  assert.equal(i.calls.filter((o) => inSection(o, 'hero')).length, 1, 'no rework from a linked file');
});

test('M2: a file or a dangling link planted as a section\'s .asks does not fail its builder', POSIX, async () => {
  for (const plant of ['file', 'dangling']) {
    const d = newDesign({ engine: 'codex' });
    const asks = join(sectionDir(d.id, 'hero'), '.asks');
    mkdirSync(sectionDir(d.id, 'hero'));
    if (plant === 'file') writeFileSync(asks, 'x');
    else symlinkSync(join(tmpdir(), `dpl-missing-${process.pid}`), asks);
    const { build } = newBuild(d, { brief: 'MOCK_SECTIONS=1' });
    assert.deepEqual(await build.run(), { status: 'done', reason: null }, plant);
    assert.ok(lstatSync(asks).isDirectory(), `${plant}: replaced by a real folder`);
  }
});

test('m4: a file planted as a done section\'s .asks does not reopen it on Continue', POSIX, async () => {
  const d = newDesign({ engine: 'codex' });
  const first = newBuild(d, { brief: 'MOCK_SECTIONS=2 MOCK_FAIL_SECTION=hero' });
  assert.deepEqual(await first.build.run(), { status: 'paused', reason: 'failed' });
  assert.equal(getBuild(first.build.id).sections.find((s) => s.id === 'features').status, 'done');
  const asks = join(sectionDir(d.id, 'features'), '.asks');
  rmSync(asks, { recursive: true, force: true });
  writeFileSync(asks, 'not a folder');
  const calls = [];
  const b = DesignBuild.rehydrate({ buildId: first.build.id, deps: { staggerMs: 0, retryDelayMs: 0, runClaude: (o) => { calls.push(o); return mockRun(o); } } });
  await b.continue({ sections: ['hero'] });
  assert.equal(calls.some((o) => inSection(o, 'features')), false, 'the done section is not rebuilt');
  assert.ok(calls.some((o) => inSection(o, 'hero')));
});

test('critical 1: a restore removes work/ through folders held open: sections swapped for a link while it is removed loses nothing outside, and nothing is copied through it', POSIX, async () => {
  const d = await firstBuild();
  assert.equal(await snapshotVersion({ designId: d.id }), 1, 'the version to restore');   // a build's own snapshot is the registry's dep
  const sections = join(designWorkDir(d.id), 'sections');
  const out = outside('store');
  let swaps = 0;
  // Linux removes `sections` through the open work/; elsewhere it is first moved into a .trash-* folder.
  const restore = patchSync('rmSync', (rm) => (p, o) => {
    const reached = basename(String(p)) === 'sections' || (basename(String(p)).startsWith('.trash-') && existsSync(join(p, 'sections')));
    if (swaps === 0 && reached) {
      swaps += 1;
      if (existsSync(sections)) renameSync(sections, `${sections}-real`);
      symlinkSync(out, sections, 'dir');
    }
    return rm(p, o);
  });
  try {
    await restoreVersion({ designId: d.id, n: 1 });
  } finally {
    restore();
  }
  assert.equal(swaps, 1, 'the restore removed sections with rmSync, never fs.promises rm');
  assert.deepEqual(untouched(out, ['store']), ['keep store'], 'nothing removed from the link\'s target');
  assert.deepEqual(readdirSync(out), ['store'], 'nothing copied into it');
  assert.equal(isLink(sections), false);
  assert.ok(existsSync(join(sections, 'hero', 'index.html')), 'the version\'s sections are back');
});

test('critical 1: a sections link planted after a restore cleared work/ gets none of the version written through it', POSIX, async () => {
  const d = await firstBuild();
  assert.equal(await snapshotVersion({ designId: d.id }), 1);
  const from = versionDir(d.id, 1);
  const sections = join(designWorkDir(d.id), 'sections');
  const out = outside();
  let swaps = 0;
  const plant = (p) => {
    if (swaps > 0 || p !== from) return;
    swaps += 1;
    if (existsSync(sections)) renameSync(sections, `${sections}-real`);
    symlinkSync(out, sections, 'dir');
  };
  const undo = [
    patchSync('readdirSync', (readdir) => (...a) => { plant(a[0]); return readdir(...a); }),
    patchFs('readdir', (readdir) => (...a) => { plant(a[0]); return readdir(...a); }),
  ];
  try {
    await restoreVersion({ designId: d.id, n: 1 });
  } finally {
    for (const u of undo) u();
  }
  assert.equal(swaps, 1, 'the version was listed after work/ was cleared');
  assert.deepEqual(readdirSync(out), [], 'nothing written into the link\'s target');
  assert.equal(isLink(sections), false);
  assert.ok(existsSync(join(sections, 'hero', 'index.html')));
});

test('critical 1: a link planted at a version\'s folder after its place in work/ was cleared is replaced before anything is copied into it', POSIX, async () => {
  const d = await firstBuild();
  assert.equal(await snapshotVersion({ designId: d.id }), 1);
  const hero = join(designWorkDir(d.id), 'sections', 'hero');
  const out = outside();
  let plants = 0;
  // Right after the restore cleared hero's place (lstat elsewhere, rmSync through the open sections on Linux), before
  // it makes the folder again: the copy must not go into what stands there then.
  const plantAfter = (orig) => (p, ...a) => {
    let r;
    try {
      r = orig(p, ...a);
    } finally {
      const atHero = p === hero || (String(p).startsWith('/proc/self/fd/') && basename(String(p)) === 'hero');
      if (plants === 0 && atHero && !existsSync(hero)) {
        plants += 1;
        symlinkSync(out, hero, 'dir');
      }
    }
    return r;
  };
  const undo = [patchSync('lstatSync', plantAfter), patchSync('rmSync', plantAfter)];
  try {
    await restoreVersion({ designId: d.id, n: 1 });
  } finally {
    for (const u of undo) u();
  }
  assert.equal(plants, 1);
  assert.deepEqual(readdirSync(out), [], 'nothing written into the link\'s target');
  assert.equal(isLink(hero), false);
  assert.ok(existsSync(join(hero, 'index.html')));
});

/** A design whose work/assets/img holds a.png, a folder outside holding secret/keep.txt, and swap() to put a link to
 *  it in img's place (unswap() puts img back). */
async function imgWorld() {
  const d = await firstBuild();
  const img = join(designWorkDir(d.id), 'assets', 'img');
  mkdirSync(img, { recursive: true });
  writeFileSync(join(img, 'a.png'), 'png');
  const out = outside('secret');
  const w = { d, img, out, swapped: false };
  w.swap = () => { w.swapped = true; renameSync(img, `${img}-real`); symlinkSync(out, img, 'dir'); };
  w.unswap = () => { rmSync(img); renameSync(`${img}-real`, img); w.swapped = false; };
  w.isImg = (p) => p === img || (typeof p === 'string' && p.startsWith('/proc/self/fd/') && p.endsWith(`${sep}img`));
  w.dist = () => {
    const work = designWorkDir(d.id);
    const plan = validatePlan(readFileSync(join(work, 'plan.json'), 'utf8'), { kind: 'web' }).plan;
    assembleDesign({ workDir: work, plan, mode: 'dist' });
    return join(distDir(d.id), 'assets', 'img');
  };
  w.snapshot = async () => join(versionDir(d.id, await snapshotVersion({ designId: d.id })), 'assets', 'img');
  return w;
}
/** Nothing of `out` reached the copy at `p`: no link there and no secret below it. */
const noSecret = (p) => !isLink(p) && !existsSync(join(p, 'secret'));

test('critical 1: dist and a snapshot copy nothing through a folder an agent swaps for a link after it was looked at', POSIX, async () => {
  const w = await imgWorld();
  // The walk before this fix looked (cp's and cpSync's filters), then walked by path: the swap lands after that look.
  // The walk now opens each level itself without following a link, so the swap lands right before that open.
  let inCp = false;
  const undo = [
    patchFs('lstat', (lstat) => async (p, ...a) => { const st = await lstat(p, ...a); if (!w.swapped && p === w.img) w.swap(); return st; }),
    patchSync('cpSync', (cp) => (src, dest, o = {}) => {
      inCp = true;
      try {
        return cp(src, dest, { ...o, filter: (sp, dp) => { const ok = o.filter ? o.filter(sp, dp) : true; if (ok && !w.swapped && sp === w.img) w.swap(); return ok; } });
      } finally {
        inCp = false;
      }
    }),
    patchSync('lstatSync', (lstat) => (p, ...a) => { if (!inCp && !w.swapped && w.isImg(p)) w.swap(); return lstat(p, ...a); }),
    patchSync('openSync', (open) => (p, ...a) => { if (!w.swapped && w.isImg(p)) w.swap(); return open(p, ...a); }),
  ];
  try {
    const distImg = w.dist();
    assert.ok(w.swapped, 'dist met the swap');
    assert.ok(noSecret(distImg), 'dist copies nothing through the link');
    w.unswap();
    const versionImg = await w.snapshot();
    assert.ok(w.swapped, 'the snapshot met the swap');
    assert.ok(noSecret(versionImg), 'the snapshot copies nothing through the link');
  } finally {
    for (const u of undo) u();
  }
  assert.deepEqual(untouched(w.out, ['secret']), ['keep secret']);
});

test('critical 1: a file swapped for a link after its folder was listed is skipped by dist and a snapshot, never followed', POSIX, async () => {
  const w = await imgWorld();
  const png = join(w.img, 'a.png');
  const secret = join(w.out, 'secret', 'keep.txt');
  let swaps = 0;
  const atPng = (p) => p === png || (String(p).startsWith('/proc/self/fd/') && basename(String(p)) === 'a.png');
  const restore = patchSync('openSync', (open) => (p, ...a) => {
    if (atPng(p) && existsSync(png) && !isLink(png)) {
      swaps += 1;
      renameSync(png, `${png}-real`);
      symlinkSync(secret, png);
    }
    return open(p, ...a);
  });
  const putBack = () => { rmSync(png); renameSync(`${png}-real`, png); };
  const leaked = (dir) => isLink(join(dir, 'a.png')) || (existsSync(join(dir, 'a.png')) && readFileSync(join(dir, 'a.png'), 'utf8') === 'keep secret');
  try {
    const distImg = w.dist();
    assert.equal(swaps, 1, 'dist opened the file itself');
    assert.equal(leaked(distImg), false, 'dist never copies the link\'s target');
    putBack();
    const versionImg = await w.snapshot();
    assert.equal(swaps, 2, 'the snapshot opened the file itself');
    assert.equal(leaked(versionImg), false, 'the snapshot never copies it');
  } finally {
    restore();
  }
});

test('critical 1: on Linux dist and a snapshot read a folder through its open descriptor: a swap after the open changes nothing', VIA_FD, async () => {
  const w = await imgWorld();
  const restore = patchSync('openSync', (open) => (p, ...a) => { const fd = open(p, ...a); if (!w.swapped && w.isImg(p)) w.swap(); return fd; });
  try {
    const distImg = w.dist();
    assert.ok(w.swapped);
    assert.ok(noSecret(distImg));
    assert.equal(readFileSync(join(distImg, 'a.png'), 'utf8'), 'png', 'the folder that was opened is the one copied');
    w.unswap();
    const versionImg = await w.snapshot();
    assert.ok(w.swapped);
    assert.ok(noSecret(versionImg));
    assert.equal(readFileSync(join(versionImg, 'a.png'), 'utf8'), 'png');
  } finally {
    restore();
  }
});

test('critical 2: a shell.html swapped for a link after a change round read it is replaced, never written through', POSIX, async () => {
  const d = await firstBuild('MOCK_SECTIONS=2 MOCK_SHELL_SLOTS');
  const shell = join(designWorkDir(d.id), 'shell.html');
  const victim = join(outside(), 'worca.db');
  writeFileSync(victim, 'precious');
  let swaps = 0;
  // plan.json is written between the shell's read and its write: the agent's swap lands there.
  const restore = patchSync('renameSync', (rename) => (from, to) => {
    const r = rename(from, to);
    if (swaps === 0 && String(to).endsWith(`${sep}plan.json`)) {
      swaps += 1;
      rmSync(shell);
      symlinkSync(victim, shell);
    }
    return r;
  });
  try {
    const { build } = newBuild(d, { kind: 'change', brief: 'MOCK_ROUND_ADD=faq:hero', sections: [], needsLead: true });
    assert.equal((await build.run()).status, 'done');
  } finally {
    restore();
  }
  assert.equal(swaps, 1);
  assert.equal(readFileSync(victim, 'utf8'), 'precious', 'the link\'s target is untouched');
  assert.equal(isLink(shell), false);
  assert.match(readFileSync(shell, 'utf8'), /data-worca-slot="hero"><\/div><div data-worca-slot="faq"/, 'the new shell is in place');
  assert.deepEqual(readdirSync(designWorkDir(d.id)).filter((n) => n.endsWith('.tmp')), [], 'no temp left');
});

test('critical 3: a question file is read and removed through its folders held open: a sections link into another design reaches neither its questions nor its .asks', POSIX, () => {
  const victim = newDesign();
  const theirs = join(asksDir(victim.id), 'a_00000001.json');
  const question = { questions: [{ id: 'q1', text: 'Which?', options: [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }] }] };
  writeFileSync(theirs, JSON.stringify(question));
  const d = newDesign({ engine: 'codex' });
  const section = sectionDir(d.id, 'work');   // a section id that makes sections/work/.asks the victim's work/.asks
  mkdirSync(section);
  symlinkSync(outside(), join(section, '.asks'), 'dir');
  const file = asksFileFor({ row: { confine: 'sandbox' }, designId: d.id, sectionId: 'work', agentId: 'a_00000001' });
  const sections = join(designWorkDir(d.id), 'sections');
  linkSections(d.id, designDir(victim.id));
  assert.equal(readAskFile(file), null, 'another design\'s question is never read');
  rmSync(sections);
  renameSync(`${sections}-real`, sections);
  let swaps = 0;
  const restore = patchSync('rmSync', (rm) => (p, o) => {
    if (swaps === 0) { swaps += 1; linkSections(d.id, designDir(victim.id)); }
    return rm(p, o);
  });
  try {
    removeAskFile(file);
  } catch {
    // Off Linux the removal of the planted .asks may meet the victim's folder by path and refuse it (not recursive).
  } finally {
    restore();
  }
  assert.equal(swaps, 1, 'the planted .asks was removed with rmSync');
  assert.deepEqual(JSON.parse(readFileSync(theirs, 'utf8')), question, 'the other design\'s pending question is kept');
});

test('major 2: a folder another user owns under work/ is set aside and made again, never used; worca\'s own are kept', POSIX, () => {
  const d = newDesign();
  const work = designWorkDir(d.id);
  writeFileSync(join(work, 'assets', 'att', 'old.md'), 'x');
  const other = process.getuid() + 1;
  ensureDesignFolders(d.id, { uid: other });
  const aside = (name) => readdirSync(work).filter((n) => n.startsWith(`.${name}-`));
  assert.deepEqual([aside('sections').length, aside('assets').length, aside('.asks').length], [1, 1, 1]);
  assert.equal(readFileSync(join(work, aside('assets')[0], 'att', 'old.md'), 'utf8'), 'x', 'set aside, not removed');
  assert.deepEqual(readdirSync(join(work, 'assets', 'att')), [], 'a fresh assets/att');
  ensureDesignFolders(d.id);
  assert.deepEqual([aside('sections').length, aside('assets').length, aside('.asks').length], [1, 1, 1], 'worca\'s own folders are kept');
  assert.equal(inWorkFolder(d.id, [], { uid: other }, () => 'held'), 'held', 'work/ itself is never set aside');
  assert.equal(existsSync(work), true);
  assert.throws(() => inWorkFolder(d.id, ['..']), /not a folder name/);
  assert.throws(() => inWorkFolder(d.id, ['sections', `a${sep}b`]), /not a folder name/);
});

/** POSIX and not root: a folder or file worca itself cannot read or empty. */
const LOCKED = { skip: process.platform === 'win32' || process.getuid?.() === 0 ? 'POSIX, not root: an unreadable or locked folder' : false };
/** Every folder below `dir` made writable and readable again (a row's locked folder, wherever a restore left it), so
 *  the design's temp home can be removed. */
function unlockAll(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    chmodSync(join(dir, e.name), 0o755);
    unlockAll(join(dir, e.name));
  }
}
/** `fn()` with console.warn captured: `[what it returned, the lines]`. */
async function warned(fn) {
  const lines = [];
  const warn = console.warn;
  console.warn = (...a) => { lines.push(a.join(' ')); };
  try {
    return [await fn(), lines];
  } finally {
    console.warn = warn;
  }
}
/** A change round whose lead adds the section `add` after hero (the mock lead's MOCK_ROUND_ADD). */
const changeRound = (d, add = 'faq') => newBuild(getDesign(d.id), { kind: 'change', brief: `MOCK_ROUND_ADD=${add}:hero`, sections: [], needsLead: true }).build.run();
const modeOf = (p) => lstatSync(p).mode & 0o7777;

test('cycle 4 critical 1: a name with a backslash (a plain name on POSIX) never stops a restore, dist or a snapshot', POSIX, async () => {
  const d = await firstBuild();
  const work = designWorkDir(d.id);
  writeFileSync(join(work, 'sections', 'hero', 'img\\a.png'), 'png');
  mkdirSync(join(work, 'assets', 'x\\y'), { recursive: true });
  writeFileSync(join(work, 'assets', 'x\\y', 'b.png'), 'png');
  const n = await snapshotVersion({ designId: d.id });
  assert.equal(readFileSync(join(versionDir(d.id, n), 'assets', 'x\\y', 'b.png'), 'utf8'), 'png', 'the snapshot copies the folder');
  writeFileSync(join(work, 'a\\b'), 'stray');
  assert.deepEqual(await restoreVersion({ designId: d.id, n }), { version: n + 1, restoredFrom: n });
  assert.equal(readFileSync(join(work, 'sections', 'hero', 'img\\a.png'), 'utf8'), 'png', 'the version is back whole');
  assert.ok(existsSync(join(work, 'sections', 'hero', 'index.html')));
  assert.equal(existsSync(join(work, 'a\\b')), false, 'a top-level a\\b is removed like any entry');
  assert.equal(getDesign(d.id).status, 'done');
  assert.equal(readFileSync(join(distDir(d.id), 'assets', 'x\\y', 'b.png'), 'utf8'), 'png', 'dist copies the folder');
});

test('cycle 4 major 1: a file or a folder an agent makes at a name while a restore puts it back never stops the restore', POSIX, async () => {
  const d = await firstBuild();
  assert.equal(await snapshotVersion({ designId: d.id }), 1);
  const work = designWorkDir(d.id);
  const hero = join(work, 'sections', 'hero');
  const v1 = (...p) => readFileSync(join(versionDir(d.id, 1), ...p), 'utf8');
  /** `p` is `<work>/<rel>`, or on Linux `/proc/self/fd/<n>/<last part of rel>`: the restore's own place for it. */
  const at = (p, ...rel) => String(p) === join(work, ...rel) || (String(p).startsWith('/proc/self/fd/') && basename(String(p)) === rel.at(-1));
  const plants = [];
  /** An agent's process that outlived its build fills the name just before the restore makes or puts it. */
  const plant = (p) => {
    if (!plants.includes('hero') && at(p, 'sections', 'hero') && !existsSync(hero)) {
      plants.push('hero');
      writeFileSync(hero, 'agent');
    } else if (!plants.includes('index') && at(p, 'sections', 'hero', 'index.html') && existsSync(hero) && !existsSync(join(hero, 'index.html'))) {
      plants.push('index');
      mkdirSync(join(hero, 'index.html'));
      writeFileSync(join(hero, 'index.html', 'x'), 'agent');
    } else if (!plants.includes('shell') && at(p, 'shell.html') && !existsSync(join(work, 'shell.html'))) {
      plants.push('shell');
      writeFileSync(join(work, 'shell.html'), 'agent');
    }
  };
  const undo = [
    patchSync('mkdirSync', (mkdir) => (p, ...a) => { plant(p); return mkdir(p, ...a); }),
    patchSync('copyFileSync', (copy) => (from, to, ...a) => { plant(to); return copy(from, to, ...a); }),
    patchSync('renameSync', (rename) => (from, to) => { plant(to); return rename(from, to); }),
  ];
  let restored;
  try {
    restored = await restoreVersion({ designId: d.id, n: 1 });
  } finally {
    for (const u of undo) u();
  }
  assert.deepEqual(plants.sort(), ['hero', 'index', 'shell'], 'each name was filled once');
  assert.deepEqual(restored, { version: 2, restoredFrom: 1 });
  assert.equal(readFileSync(join(hero, 'index.html'), 'utf8'), v1('sections', 'hero', 'index.html'), 'the version\'s file, not the agent\'s folder');
  assert.equal(readFileSync(join(work, 'shell.html'), 'utf8'), v1('shell.html'), 'the version\'s file, not the agent\'s');
  assert.equal(getDesign(d.id).status, 'done');
});

test('cycle 4 major 1: a folder worca cannot empty (an agent\'s 0555 folder holding a file) is set aside: every restore completes, never retrying', LOCKED, async () => {
  const d = await firstBuild();
  assert.equal(await snapshotVersion({ designId: d.id }), 1);
  const work = designWorkDir(d.id);
  const locked = join(work, 'sections', 'agent');
  mkdirSync(locked);
  writeFileSync(join(locked, 'f.txt'), 'x');
  chmodSync(locked, 0o555);
  try {
    for (const [round, version] of [[1, 2], [2, 3]]) {
      const t0 = Date.now();
      const [restored, lines] = await warned(() => restoreVersion({ designId: d.id, n: 1 }));
      const ms = Date.now() - t0;
      assert.deepEqual(restored, { version, restoredFrom: 1 }, `restore ${round}`);
      assert.ok(ms < 1000, `restore ${round}: ${ms} ms (a retried removal waits 2 s with the server blocked)`);
      assert.ok(existsSync(join(work, 'sections', 'hero', 'index.html')), `restore ${round}: the version is back`);
      assert.equal(existsSync(locked), false, `restore ${round}: what could not be removed is out of the source`);
      if (round === 1) assert.ok(lines.some((l) => /sections/.test(l)), `logged: ${lines.join(' | ')}`);
    }
    assert.equal(getDesign(d.id).status, 'done');
  } finally {
    unlockAll(designDir(d.id));
  }
});

test('cycle 4 major 1: a folder worca cannot remove, made at a version folder\'s name after the clear, is set aside too', LOCKED, async () => {
  const d = await firstBuild();
  assert.equal(await snapshotVersion({ designId: d.id }), 1);
  const hero = join(designWorkDir(d.id), 'sections', 'hero');
  const from = join(versionDir(d.id, 1), 'sections');
  let plants = 0;
  // Once the restore made sections again and lists the version's: an agent's hero, 0555, holding a folder.
  const restore = patchSync('readdirSync', (readdir) => (p, ...a) => {
    if (plants === 0 && p === from) {
      plants += 1;
      mkdirSync(join(hero, 'agent'), { recursive: true });
      writeFileSync(join(hero, 'agent', 'f.txt'), 'x');
      chmodSync(hero, 0o555);
    }
    return readdir(p, ...a);
  });
  try {
    const [restored] = await warned(() => restoreVersion({ designId: d.id, n: 1 }));
    assert.deepEqual(restored, { version: 2, restoredFrom: 1 });
    assert.equal(plants, 1);
    assert.equal(readFileSync(join(hero, 'index.html'), 'utf8'), readFileSync(join(from, 'hero', 'index.html'), 'utf8'), 'the version\'s hero');
    assert.equal(existsSync(join(hero, 'agent')), false, 'the agent\'s folder is out of the source');
  } finally {
    restore();
    unlockAll(designDir(d.id));
  }
});

test('cycle 4 major 1: a folder swapped for a link while a restore removes it is never set aside through the link: the restore stops', MOVES, async () => {
  const d = await firstBuild();
  assert.equal(await snapshotVersion({ designId: d.id }), 1);
  const sections = join(designWorkDir(d.id), 'sections');
  const from = join(versionDir(d.id, 1), 'sections');
  const out = outside('hero');
  let swaps = 0;
  const undo = [
    // An agent's folder at hero once the restore made sections again...
    patchSync('readdirSync', (readdir) => (p, ...a) => {
      if (p === from && !existsSync(join(sections, 'hero'))) mkdirSync(join(sections, 'hero'));
      return readdir(p, ...a);
    }),
    // ...and sections swapped for a link between the look at hero and its move into the trash.
    patchSync('renameSync', (rename) => (src, to) => {
      if (swaps === 0 && src === join(sections, 'hero') && basename(dirname(to)).startsWith('.trash-')) {
        swaps += 1;
        rename(sections, `${sections}-real`);
        symlinkSync(out, sections, 'dir');
      }
      return rename(src, to);
    }),
  ];
  try {
    await assert.rejects(restoreVersion({ designId: d.id, n: 1 }), { code: 'ELOOP' });
  } finally {
    for (const u of undo) u();
  }
  assert.equal(swaps, 1);
  assert.deepEqual(readdirSync(out), ['hero'], 'nothing in the link\'s target was renamed aside');
  assert.deepEqual(untouched(out, ['hero']), ['keep hero']);
});

test('cycle 4 major 1: a version\'s file swapped for a link after it was checked is never copied in, and a put that fails leaves no temp', POSIX, async () => {
  const d = await firstBuild();
  assert.equal(await snapshotVersion({ designId: d.id }), 1);
  const work = designWorkDir(d.id);
  const shell = join(versionDir(d.id, 1), 'shell.html');
  const kept = readFileSync(shell, 'utf8');
  const secret = join(outside('secret'), 'secret', 'keep.txt');
  let swaps = 0;
  const undoReal = patchSync('realpathSync', (real) => (p, ...a) => {
    const r = real(p, ...a);
    if (swaps === 0 && p === shell) {
      swaps += 1;
      rmSync(shell);
      symlinkSync(secret, shell);
    }
    return r;
  });
  try {
    await assert.rejects(restoreVersion({ designId: d.id, n: 1 }), { code: 'ELOOP' });
  } finally {
    undoReal();
  }
  assert.equal(swaps, 1, 'swapped after the check');
  const put = join(work, 'shell.html');
  assert.equal(existsSync(put) && readFileSync(put, 'utf8') === 'keep secret', false, 'the link\'s target is never copied');
  assert.deepEqual(readdirSync(work).filter((n) => n.endsWith('.tmp')), [], 'the temp is removed');
  rmSync(shell);
  writeFileSync(shell, kept);
  const undoRename = patchSync('renameSync', (rename) => (src, to) => {
    if (basename(String(to)) === 'shell.html') throw Object.assign(new Error('EIO: i/o error, rename'), { code: 'EIO' });
    return rename(src, to);
  });
  try {
    await assert.rejects(restoreVersion({ designId: d.id, n: 1 }), { code: 'EIO' });
  } finally {
    undoRename();
  }
  assert.deepEqual(readdirSync(work).filter((n) => n.endsWith('.tmp')), [], 'a failed rename removes its temp');
});

test('cycle 4 major 1: a copy never keeps its source\'s mode: 0600 in versions/ and dist/, 0660 back in work/, never setuid', POSIX, async () => {
  const d = await firstBuild();
  const work = designWorkDir(d.id);
  const png = join(work, 'assets', 'a.png');
  mkdirSync(dirname(png), { recursive: true });
  writeFileSync(png, 'png');
  chmodSync(png, 0o4755);
  const n = await snapshotVersion({ designId: d.id });
  assert.equal(modeOf(join(versionDir(d.id, n), 'assets', 'a.png')).toString(8), '600', 'versions/');
  await restoreVersion({ designId: d.id, n });
  assert.equal(modeOf(png).toString(8), '660', 'back in work/');
  assert.equal(modeOf(join(distDir(d.id), 'assets', 'a.png')).toString(8), '600', 'dist/');
  assert.equal(readFileSync(png, 'utf8'), 'png');
});

test('cycle 4 major 2: an entry worca cannot read, or whose copy\'s path would be too long, is skipped by dist and a snapshot: every round still ends done', LOCKED, async () => {
  const d = await firstBuild();
  const work = designWorkDir(d.id);
  const assets = join(work, 'assets');
  const img = join(assets, 'img');
  mkdirSync(img, { recursive: true });
  writeFileSync(join(img, 'a.png'), 'png');
  writeFileSync(join(assets, 'b.png'), 'png');
  writeFileSync(join(assets, 'keep.png'), 'png');
  // A path that fits under work/ but not under dist.tmp-<8 hex>/ or versions/<n>.tmp/ (13 and 10 bytes longer). Sized
  // from the real path: macOS counts a link it expands on the way (/var → /private/var) toward PATH_MAX.
  const pathMax = process.platform === 'linux' ? 4096 : 1024;
  const room = pathMax - 1 - 6 - Buffer.byteLength(join(realpathSync(assets), 'long', 'f.png'));
  const count = Math.ceil(room / 201);
  const chars = room - count;
  const deep = Array.from({ length: count }, (_, i) => 'd'.repeat(Math.floor(chars / count) + (i < chars % count ? 1 : 0)));
  mkdirSync(join(assets, 'long', ...deep), { recursive: true });
  writeFileSync(join(assets, 'long', ...deep, 'f.png'), 'png');
  chmodSync(img, 0);
  chmodSync(join(assets, 'b.png'), 0);
  try {
    for (const round of [1, 2]) {
      const [r, lines] = await warned(async () => [await changeRound(d, `add${round}`), await snapshotVersion({ designId: d.id })]);
      assert.deepEqual(r[0], { status: 'done', reason: null }, `round ${round}`);
      for (const root of [distDir(d.id), versionDir(d.id, r[1])]) {
        const copied = readdirSync(join(root, 'assets')).filter((n) => n !== 'long' && n !== 'att').sort();
        assert.deepEqual(copied, ['keep.png'], `round ${round}: ${root} lacks img and b.png`);
        assert.equal(existsSync(join(root, 'assets', 'long', ...deep, 'f.png')), false);
      }
      assert.ok(lines.some((l) => /assets\/img/.test(l) && /EACCES|EPERM/.test(l)), `round ${round}: logged ${lines.join(' | ')}`);
      assert.ok(lines.some((l) => /ENAMETOOLONG/.test(l)), `round ${round}: the long path is logged`);
    }
  } finally {
    unlockAll(work);
    chmodSync(join(assets, 'b.png'), 0o644);
  }
});

/** placeWorkFile's own temp (`.<12 hex>.tmp`): a gate keyed on it never fires on a set-aside or a trash move. */
const isTemp = (p) => /^\.[0-9a-f]{12}\.tmp$/.test(basename(String(p)));
/** `p` is `<dir>/<name>`, or on Linux `/proc/self/fd/<n>/<name>`. */
const atName = (p, dir, name) => String(p) === join(dir, name) || (String(p).startsWith('/proc/self/fd/') && basename(String(p)) === name);

test('cycle 5 major 1: a folder an agent makes at a file\'s name again after its set-aside, or removes before the look, never stops a restore', POSIX, async () => {
  const d = await firstBuild();
  assert.equal(await snapshotVersion({ designId: d.id }), 1);
  const work = designWorkDir(d.id);
  const shell = join(work, 'shell.html');
  const kept = readFileSync(join(versionDir(d.id, 1), 'shell.html'), 'utf8');
  // Restore 1: an agent's folder at shell.html before the first rename over it and again before the second.
  let plants = 0;
  let undo = patchSync('renameSync', (rename) => (from, to) => {
    if (plants < 2 && isTemp(from) && atName(to, work, 'shell.html')) {
      plants += 1;
      mkdirSync(shell);
      writeFileSync(join(shell, 'x'), 'agent');
    }
    return rename(from, to);
  });
  let restored;
  try {
    restored = await restoreVersion({ designId: d.id, n: 1 });
  } finally {
    undo();
  }
  assert.equal(plants, 2, 'planted before both renames');
  assert.deepEqual(restored, { version: 2, restoredFrom: 1 });
  assert.equal(readFileSync(shell, 'utf8'), kept, 'the version\'s file, not the agent\'s folder');
  assert.equal(getDesign(d.id).status, 'done');
  // Restore 2: the folder fails the rename, then is gone before the look at the name.
  let looks = 0;
  undo = patchSync('renameSync', (rename) => (from, to) => {
    if (looks === 0 && isTemp(from) && atName(to, work, 'shell.html')) {
      looks += 1;
      mkdirSync(shell);
      try {
        return rename(from, to);
      } finally {
        rmSync(shell, { recursive: true, force: true });
      }
    }
    return rename(from, to);
  });
  try {
    restored = await restoreVersion({ designId: d.id, n: 1 });
  } finally {
    undo();
  }
  assert.equal(looks, 1);
  assert.deepEqual(restored, { version: 3, restoredFrom: 1 });
  assert.equal(readFileSync(shell, 'utf8'), kept);
  assert.equal(getDesign(d.id).status, 'done');
});

test('cycle 5 major 1: a name an agent fills before every rename fails the restore after a bounded number of tries, a file there too', POSIX, async () => {
  const d = await firstBuild();
  assert.equal(await snapshotVersion({ designId: d.id }), 1);
  const work = designWorkDir(d.id);
  const shell = join(work, 'shell.html');
  let plants = 0;
  let undo = patchSync('renameSync', (rename) => (from, to) => {
    if (plants < 50 && isTemp(from) && atName(to, work, 'shell.html')) {
      plants += 1;
      mkdirSync(shell);
    }
    return rename(from, to);
  });
  try {
    await assert.rejects(restoreVersion({ designId: d.id, n: 1 }), { code: 'EISDIR' });
  } finally {
    undo();
  }
  assert.ok(plants > 2 && plants < 50, `${plants} tries, then the restore gives up`);
  assert.deepEqual(readdirSync(work).filter((n) => n.endsWith('.tmp')), [], 'the temp is removed');
  // A file at the name and a rename that fails anyway (EIO): tried again a bounded number of times (cycle 6 major 1: a
  // folder that became a file meanwhile is one rename away), then the restore fails.
  let calls = 0;
  undo = patchSync('renameSync', (rename) => (from, to) => {
    if (isTemp(from) && atName(to, work, 'shell.html')) {
      calls += 1;
      writeFileSync(shell, 'agent');
      throw Object.assign(new Error('EIO: i/o error, rename'), { code: 'EIO' });
    }
    return rename(from, to);
  });
  try {
    await assert.rejects(restoreVersion({ designId: d.id, n: 1 }), { code: 'EIO' });
  } finally {
    undo();
  }
  assert.ok(calls > 1 && calls < 50, `${calls} tries, then the restore gives up`);
  assert.equal(readFileSync(shell, 'utf8'), 'agent', 'the file there is left as it is');
  assert.deepEqual(await restoreVersion({ designId: d.id, n: 1 }), { version: 2, restoredFrom: 1 }, 'the next restore completes');
});

test('cycle 5 major 1: a level an agent makes again after each set-aside is set aside again, a bounded number of times', POSIX, () => {
  const d = newDesign();
  const work = designWorkDir(d.id);
  const sections = join(work, 'sections');
  const other = process.getuid() + 1;
  const aside = () => readdirSync(work).filter((n) => n.startsWith('.sections-')).length;
  /** inWorkFolder(['sections']) as user `other` with `limit` folders made at the name just before worca makes it. */
  const held = (limit) => {
    let plants = 0;
    const undo = patchSync('mkdirSync', (mkdir) => (p, ...a) => {
      if (plants < limit && atName(p, work, 'sections')) {
        plants += 1;
        mkdir(p);
      }
      return mkdir(p, ...a);
    });
    try {
      return [inWorkFolder(d.id, ['sections'], { create: true, uid: other }, () => 'held'), plants];
    } catch (err) {
      return [err, plants];
    } finally {
      undo();
    }
  };
  assert.deepEqual(held(2), ['held', 2]);
  assert.equal(aside(), 3, 'worca\'s own (another user\'s to `other`) and both made again are set aside');
  assert.ok(lstatSync(sections).isDirectory());
  const [err, plants] = held(50);
  assert.equal(err.code, 'EEXIST');
  assert.ok(plants > 2 && plants < 50, `${plants} tries, then it gives up`);
});

test('cycle 6 major 1: an agent\'s folder at a file\'s name that becomes a file after the failed rename never stops a restore', POSIX, async () => {
  const d = await firstBuild();
  assert.equal(await snapshotVersion({ designId: d.id }), 1);
  const work = designWorkDir(d.id);
  const shell = join(work, 'shell.html');
  const kept = readFileSync(join(versionDir(d.id, 1), 'shell.html'), 'utf8');
  /** work/'s entries a version holds (a restore clears the dot names, `.asks` and `.crew.json`). */
  const plain = () => readdirSync(work).filter((n) => !n.startsWith('.')).sort();
  const before = plain();
  let swaps = 0;
  const undo = patchSync('renameSync', (rename) => (from, to) => {
    if (swaps === 0 && isTemp(from) && atName(to, work, 'shell.html')) {
      swaps += 1;
      mkdirSync(shell);
      try {
        return rename(from, to);
      } finally {
        rmSync(shell, { recursive: true, force: true });
        writeFileSync(shell, 'agent');
      }
    }
    return rename(from, to);
  });
  let restored;
  try {
    restored = await restoreVersion({ designId: d.id, n: 1 });
  } finally {
    undo();
  }
  assert.equal(swaps, 1);
  assert.deepEqual(restored, { version: 2, restoredFrom: 1 });
  assert.equal(readFileSync(shell, 'utf8'), kept, 'the version\'s file, renamed over the agent\'s');
  assert.deepEqual(plain(), before, 'every entry put back');
  assert.equal(getDesign(d.id).status, 'done');
});

test('cycle 6 major 1: a file at a level\'s name that becomes a folder before worca removes it never stops a restore', POSIX, async () => {
  const d = await firstBuild();
  assert.equal(await snapshotVersion({ designId: d.id }), 1);
  const work = designWorkDir(d.id);
  const sections = join(work, 'sections');
  const want = readdirSync(join(versionDir(d.id, 1), 'sections')).sort();
  let planted = false;
  let swapped = false;
  // After the restore cleared work/, an agent's file at `sections` when worca looks, swapped for a folder before the rm.
  const undoL = patchSync('lstatSync', (lstat) => (p, ...a) => {
    if (!planted && atName(p, work, 'sections') && new Error().stack.includes('realFolder') && !existsSync(sections)) {
      planted = true;
      writeFileSync(sections, 'agent');
    }
    return lstat(p, ...a);
  });
  const undoR = patchSync('rmSync', (rm) => (p, ...a) => {
    if (planted && !swapped && atName(p, work, 'sections')) {
      swapped = true;
      rm(sections, { force: true });
      mkdirSync(sections);
    }
    return rm(p, ...a);
  });
  let restored;
  try {
    restored = await restoreVersion({ designId: d.id, n: 1 });
  } finally {
    undoR();
    undoL();
  }
  assert.ok(planted && swapped, 'the file was planted and swapped');
  assert.deepEqual(restored, { version: 2, restoredFrom: 1 });
  assert.deepEqual(readdirSync(sections).sort(), want, 'every section put back');
  for (const s of want) assert.ok(existsSync(join(sections, s, 'index.html')), `${s} restored`);
  assert.equal(getDesign(d.id).status, 'done');
});

test('cycle 6 major 1: a level whose make fails because the folder above was swapped for a link is never looked at again through the link', BY_PATH, () => {
  const victim = newDesign();
  const d = newDesign();
  const sections = join(designWorkDir(d.id), 'sections');
  let swaps = 0;
  const undo = patchSync('mkdirSync', (mkdir) => (p, ...a) => {
    if (swaps === 0 && String(p) === join(sections, 'work')) {
      swaps += 1;
      linkSections(d.id, designDir(victim.id));   // sections/work is now the victim's work/: the make finds it there
    }
    return mkdir(p, ...a);
  });
  let reached = null;
  try {
    assert.throws(() => inWorkFolder(d.id, ['sections', 'work'], { create: true }, (base) => { reached = base; }), { code: 'EEXIST' });
  } finally {
    undo();
  }
  assert.equal(swaps, 1);
  assert.equal(reached, null, 'the victim\'s work/ is never handed out as the section\'s folder');
});

test('cycle 6 major 1: a file at a level\'s name whose removal keeps failing fails the step after a bounded number of looks', POSIX, () => {
  const d = newDesign();
  const work = designWorkDir(d.id);
  const sections = join(work, 'sections');
  rmSync(sections, { recursive: true });
  writeFileSync(sections, 'agent');
  let calls = 0;
  const undo = patchSync('rmSync', (rm) => (p, ...a) => {
    if (calls < 50 && atName(p, work, 'sections')) {
      calls += 1;
      throw Object.assign(new Error('EPERM: operation not permitted, rm'), { code: 'EPERM' });
    }
    return rm(p, ...a);
  });
  try {
    assert.throws(() => inWorkFolder(d.id, ['sections'], { create: true }), { code: 'EPERM' });
  } finally {
    undo();
  }
  assert.ok(calls > 1 && calls < 50, `${calls} tries, then it gives up`);
});

test('cycle 7 major 1: a temp an agent removes before its rename is written again: the restore puts every entry back', POSIX, async () => {
  const d = await firstBuild();
  assert.equal(await snapshotVersion({ designId: d.id }), 1);
  const work = designWorkDir(d.id);
  const v1 = versionDir(d.id, 1);
  const plain = () => readdirSync(work).filter((n) => !n.startsWith('.')).sort();
  const before = plain();
  const sections = readdirSync(join(v1, 'sections')).sort();
  // The first file the restore puts back: its temp is unlinked between its write and its rename.
  let removed = null;
  const undo = patchSync('renameSync', (rename) => (from, to) => {
    if (removed === null && isTemp(from)) {
      removed = basename(String(to));
      rmSync(from);
    }
    return rename(from, to);
  });
  let restored;
  try {
    restored = await restoreVersion({ designId: d.id, n: 1 });
  } finally {
    undo();
  }
  assert.ok(removed, 'a temp was removed');
  assert.deepEqual(restored, { version: 2, restoredFrom: 1 });
  assert.deepEqual(plain(), before, 'every entry put back');
  assert.equal(readFileSync(join(work, removed), 'utf8'), readFileSync(join(v1, removed), 'utf8'), 'the version\'s file at the name');
  for (const s of sections) assert.ok(existsSync(join(work, 'sections', s, 'index.html')), `${s} restored`);
  assert.deepEqual(readdirSync(work).filter((n) => n.endsWith('.tmp')), [], 'no temp left');
  assert.equal(getDesign(d.id).status, 'done');
  // Restore 2: the temp is replaced by an agent's folder and a file is put at the name, so the rename fails (ENOTDIR):
  // the folder is not worca's temp, so a new one is written, and the agent's folder stays where the agent made it.
  let replaced = null;
  let filled = null;
  const undo2 = patchSync('renameSync', (rename) => (from, to) => {
    if (replaced === null && isTemp(from)) {
      replaced = basename(String(from));
      filled = basename(String(to));
      rmSync(from);
      mkdirSync(from);
      writeFileSync(to, 'agent');
    }
    return rename(from, to);
  });
  try {
    restored = await restoreVersion({ designId: d.id, n: 1 });
  } finally {
    undo2();
  }
  assert.deepEqual(restored, { version: 3, restoredFrom: 1 });
  assert.deepEqual(plain(), before, 'every entry put back');
  assert.equal(readFileSync(join(work, filled), 'utf8'), readFileSync(join(v1, filled), 'utf8'), 'the version\'s file, not the agent\'s');
  assert.deepEqual(readdirSync(work).filter((n) => n.endsWith('.tmp')), [replaced], 'only the agent\'s folder');
  assert.equal(getDesign(d.id).status, 'done');
});

test('cycle 7 major 1: a temp an agent removes before every rename fails the restore after a bounded number of tries', POSIX, async () => {
  const d = await firstBuild();
  assert.equal(await snapshotVersion({ designId: d.id }), 1);
  const work = designWorkDir(d.id);
  let removes = 0;
  const undo = patchSync('renameSync', (rename) => (from, to) => {
    if (removes < 50 && isTemp(from) && atName(to, work, 'shell.html')) {
      removes += 1;
      rmSync(from, { force: true });
    }
    return rename(from, to);
  });
  try {
    await assert.rejects(restoreVersion({ designId: d.id, n: 1 }), { code: 'ENOENT' });
  } finally {
    undo();
  }
  assert.ok(removes > 2 && removes < 50, `${removes} tries, then the restore gives up`);
  assert.deepEqual(readdirSync(work).filter((n) => n.endsWith('.tmp')), [], 'no temp left');
  assert.deepEqual(await restoreVersion({ designId: d.id, n: 1 }), { version: 2, restoredFrom: 1 }, 'the next restore completes');
});

test('cycle 6 major 1: a level that is not there, its folder above gone too, reads as not there without create', () => {
  const d = newDesign();
  rmSync(designDir(d.id), { recursive: true });
  assert.equal(inWorkFolder(d.id, [], {}), null);
  assert.equal(inWorkFolder(d.id, ['sections'], {}), null);
  assert.doesNotThrow(() => removeSectionDir(d.id, 'hero'));
});

test('cycle 5 major 2: a section\'s assets folder worca cannot read, or the section itself, is skipped by dist: every round ends done', LOCKED, async () => {
  const d = await firstBuild();
  const work = designWorkDir(d.id);
  const hero = join(work, 'sections', 'hero');
  const heroAssets = join(hero, 'assets');
  mkdirSync(heroAssets);
  writeFileSync(join(heroAssets, 'h.png'), 'png');
  const named = (lines) => lines.filter((l) => /sections\/hero\/assets \((EACCES|EPERM)\)/.test(l));
  chmodSync(heroAssets, 0);
  try {
    for (const round of [1, 2]) {
      const [r, lines] = await warned(() => changeRound(d, `add${round}`));
      assert.deepEqual(r, { status: 'done', reason: null }, `round ${round}`);
      assert.equal(existsSync(join(distDir(d.id), 'sections', 'hero', 'assets')), false, `round ${round}: dist lacks the folder`);
      assert.equal(named(lines).length, 1, `round ${round}: logged once ${lines.join(' | ')}`);
    }
    chmodSync(heroAssets, 0o755);
    chmodSync(hero, 0);
    for (const round of [1, 2]) {
      const [r, lines] = await warned(() => newBuild(getDesign(d.id), { kind: 'change', brief: 'Bolder', sections: ['features'], needsLead: false }).build.run());
      assert.deepEqual(r, { status: 'done', reason: null }, `section round ${round}`);
      assert.doesNotMatch(readFileSync(join(distDir(d.id), 'index.html'), 'utf8'), /data-section="hero"/, `section round ${round}`);
      assert.equal(named(lines).length, 1, `section round ${round}: logged once ${lines.join(' | ')}`);
    }
  } finally {
    chmodSync(hero, 0o755);
    chmodSync(heroAssets, 0o755);
  }
  // Only what worca may not read is skipped: a listing that fails otherwise (EIO), or a dist copy that cannot be
  // written, still fails the round, the old dist kept.
  const fail = (code) => Object.assign(new Error(`${code}: injected`), { code });
  const { ino } = lstatSync(heroAssets);
  /** `p` is sections/hero/assets, by path or (Linux) as `/proc/self/fd/<n>` of the folder held open. */
  const isHeroAssets = (p) => { try { return statSync(String(p)).ino === ino; } catch { return false; } };
  const gates = [
    ['readdirSync', isHeroAssets, 'EIO'],
    ['mkdirSync', (p) => /dist\.tmp-[0-9a-f]{8}\/sections\/hero\/assets$/.test(String(p)), 'EACCES'],
  ];
  const error = console.error;
  console.error = () => {};
  try {
    for (const [i, [name, at, code]] of gates.entries()) {
      const undo = patchSync(name, (orig) => (p, ...a) => { if (at(p)) throw fail(code); return orig(p, ...a); });
      try {
        assert.deepEqual(await changeRound(d, `fail${i}`), { status: 'error', reason: 'assemble-failed' }, `${name} ${code}`);
      } finally {
        undo();
      }
    }
  } finally {
    console.error = error;
  }
});

test('cycle 5 major 2: a snapshot of a work/ worca cannot read still fails, never an empty version', LOCKED, async () => {
  const d = await firstBuild();
  const work = designWorkDir(d.id);
  const mode = lstatSync(work).mode & 0o7777;
  chmodSync(work, 0);
  try {
    await assert.rejects(snapshotVersion({ designId: d.id }), { code: 'EACCES' });
  } finally {
    chmodSync(work, mode);
  }
  assert.equal(existsSync(versionDir(d.id, 1)), false);
});

test('cycle 5 minor 2: a file an agent keeps appending to is copied at the size it had when the copy began', POSIX, async () => {
  const d = await firstBuild();
  const png = join(designWorkDir(d.id), 'assets', 'big.png');
  mkdirSync(dirname(png), { recursive: true });
  writeFileSync(png, Buffer.alloc(300 * 1024, 1));
  const { ino } = lstatSync(png);
  let grown = 0;
  const undo = patchSync('readSync', (read) => (fd, ...a) => {
    if (grown < 100 && fs.fstatSync(fd).ino === ino) {
      grown += 1;
      appendFileSync(png, Buffer.alloc(1024, 2));
    }
    return read(fd, ...a);
  });
  let n;
  try {
    n = await snapshotVersion({ designId: d.id });
  } finally {
    undo();
  }
  assert.ok(grown >= 2, 'the file grew while it was copied');
  assert.equal(statSync(join(versionDir(d.id, n), 'assets', 'big.png')).size, 300 * 1024);
});

// Last: a reverted reader blocks on the FIFO for good, so every other row has reported by then.
test('C2: a FIFO as plan.json or round.json reads as not written, never blocking the server', POSIX, async () => {
  const d = await firstBuild();
  const plan = join(designWorkDir(d.id), 'plan.json');
  const kept = readFileSync(plan, 'utf8');
  rmSync(plan);
  execFileSync('mkfifo', [plan]);
  assert.throws(() => newBuild(getDesign(d.id), { kind: 'change', brief: 'x', sections: [], needsLead: true }), { status: 422 });
  const r = createDesignBuilds({ broadcast: () => {} });
  assert.equal(r.snapshotFor(getDesign(d.id).currentBuild).plan.planRev, 0);
  rmSync(plan);
  writeFileSync(plan, kept);

  const round = join(designWorkDir(d.id), 'round.json');
  const { build, calls } = newBuild(getDesign(d.id), { kind: 'change', brief: 'Warmer', sections: [], needsLead: true, deps: {
    runClaude: async (o) => {
      if (o.maxTurns !== 20) return mockRun(o);
      if (!existsSync(round)) execFileSync('mkfifo', [round]);
      return { text: 'Planned.', exitCode: 0 };
    },
  } });
  assert.deepEqual(await build.run(), { status: 'error', reason: 'plan-invalid' });
  assert.equal(calls.length, 2, 'not written: one fix resume, then the round fails');
});
