// test/memory-health.test.mjs — memoryHealth (pure, agent-memory-design.md §8) + memoryScopeReport (fs).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  memoryHealth, memoryScopeReport, MEMORY_LEVELS, GLOBAL_SCOPE, projectScope, scopeDir,
  writeMemory, bumpScopeState, readScopeState, renderDefragBrief, DEFRAG_BRIEF_HEADING,
} from '../src/core/memory-store.mjs';

const CAPS = { softBytesPerFile: 100, hardBytesPerFile: 200, maxFilesPerScope: 10, hookMaxChars: 160, defrag: { writes: 4, files: 5, bytesPct: 60, alwaysOnBytes: 300 } };
const NOW = '2026-09-09T10:00:00.000Z';
const file = (name, bytes, over = {}) => ({ name, description: `Hook ${name}`, paths: [], source: 'user', updated: NOW, bytes, hasFrontmatter: true, hash: name, ...over });
const STATE = { writesSinceDefrag: 0, lastWriteAt: null, lastDefragAt: null, lastDefragRunId: null };

test('levels are the five the UI knows', () => {
  assert.deepEqual([...MEMORY_LEVELS], ['fresh', 'ok', 'due', 'overdue', 'failing']);
});

test('fresh: no files ⇒ fresh with no reasons, whatever the counters say', () => {
  const h = memoryHealth([], { ...STATE, writesSinceDefrag: 99 }, CAPS);
  assert.equal(h.level, 'fresh');
  assert.deepEqual(h.reasons, []);
  assert.equal(h.files, 0); assert.equal(h.bytes, 0); assert.equal(h.writesSinceDefrag, 99);
});

test('ok: files under every threshold', () => {
  const h = memoryHealth([file('a', 10), file('b', 20)], { ...STATE, writesSinceDefrag: 3, lastWriteAt: NOW }, CAPS);
  assert.equal(h.level, 'ok');
  assert.deepEqual(h.reasons, []);
  assert.deepEqual({ files: h.files, bytes: h.bytes, oversized: h.oversized, overHard: h.overHard, invalidFrontmatter: h.invalidFrontmatter, alwaysOnBytes: h.alwaysOnBytes, alwaysOnFiles: h.alwaysOnFiles },
    { files: 2, bytes: 30, oversized: 0, overHard: 0, invalidFrontmatter: 0, alwaysOnBytes: 30, alwaysOnFiles: 2 });
  assert.equal('indexDropped' in h, false, 'the index is gone');
  assert.equal(h.lastWriteAt, NOW);
});

test('due: each trigger alone, with its exact reason', () => {
  const one = [file('a', 10)];
  const r = (entries, state = STATE) => memoryHealth(entries, state, CAPS);
  assert.deepEqual(r(one, { ...STATE, writesSinceDefrag: 4 }).reasons, ['4 memory writes since the last defragment (due at 4)']);
  assert.equal(r(one, { ...STATE, writesSinceDefrag: 4 }).level, 'due');
  assert.deepEqual(r([file('a', 1), file('b', 1), file('c', 1), file('d', 1), file('e', 1)]).reasons, ['5 files in this scope (due at 5)']);
  // budget = 10 × 100 = 1000 bytes; 60 % = 600
  assert.deepEqual(r([file('a', 100), file('b', 100), file('c', 100), file('d', 100), file('e', 100), file('f', 100)]).reasons.filter((s) => /budget/.test(s)), ["60% of the scope's byte budget in use (due at 60%)"]);
  // The threshold is compared on integers (spec §8's `≥`), never on a rounded percentage —
  // 595/1000 is 59.5 %, which Math.round would turn into a 60 % "due".
  assert.deepEqual(r([file('a', 595)]).reasons.filter((s) => /budget/.test(s)), [], '59.5% of the budget is not 60%');
  assert.deepEqual(r([file('a', 649)]).reasons.filter((s) => /budget/.test(s)), ["64% of the scope's byte budget in use (due at 60%)"], 'the displayed share is floored, never rounded up');
  assert.deepEqual(r([file('big', 150)]).reasons, ['1 file over the 100-byte soft cap: big.md']);
  assert.deepEqual(r([file('a', 10, { hasFrontmatter: false })]).reasons, ['1 file without frontmatter — added by hand? worca still serves them; a defragment rewrites them: a.md']);
  // Native rules: every file WITHOUT `paths` loads into every agent's context at launch.
  assert.deepEqual(r([file('a', 200), file('b', 100)]).reasons.filter((s) => /every agent/.test(s)),
    ["300 bytes of memory load into the context of every agent that mounts this scope (2 files without paths; due at 300)"]);
  assert.deepEqual(r([file('a', 200), file('b', 100, { paths: ['src/**'] })]).reasons.filter((s) => /every agent/.test(s)), [],
    'a path-scoped file costs nothing at launch');
  assert.equal(r([file('a', 200), file('b', 100, { paths: ['src/**'] })]).alwaysOnBytes, 200);
  assert.equal(r([file('a', 200), file('b', 100, { paths: ['src/**'] })]).alwaysOnFiles, 1);
});

test('overdue: writes at twice the threshold, or any file over the hard cap (which is also oversized)', () => {
  const a = memoryHealth([file('a', 10)], { ...STATE, writesSinceDefrag: 8 }, CAPS);
  assert.equal(a.level, 'overdue');
  const b = memoryHealth([file('huge', 250)], STATE, CAPS);
  assert.equal(b.level, 'overdue');
  assert.deepEqual(b.reasons, [
    '1 file over the 100-byte soft cap: huge.md',
    '1 file over the 200-byte hard cap — runs cannot update them: huge.md',
  ]);
  assert.equal(b.oversized, 1); assert.equal(b.overHard, 1);
  assert.equal(memoryHealth([file('a', 10)], { ...STATE, writesSinceDefrag: 7 }, CAPS).level, 'due', 'one short of 2× is due, not overdue');
  const loud = memoryHealth([file('a', 90), file('b', 90), file('c', 90), file('d', 90), file('e', 90), file('f', 90), file('g', 90)], STATE,
    { ...CAPS, defrag: { ...CAPS.defrag, files: 99 } });
  assert.equal(loud.level, 'overdue', '630 always-on bytes ≥ 2 × 300');
  assert.ok(loud.reasons.some((s) => /630 bytes of memory load/.test(s)));
});

test('failing: a failed write with no newer store write outranks every level (even fresh); a newer store write or a defragment clears it; the reason names the run', () => {
  const T1 = '2026-09-17T10:00:00.000Z'; const T2 = '2026-09-17T11:00:00.000Z';
  const failed = { ...STATE, failedWrites: 2, lastFailedAt: T2, lastFailedRunId: 'abc12345' };
  const empty = memoryHealth([], failed, CAPS);
  assert.equal(empty.level, 'failing', 'an empty scope whose writes fail is not "fresh"');
  assert.deepEqual(empty.reasons, ['2 memory writes by runs failed since the last defragment — last in run abc12345; that run\'s History detail carries the reason']);
  assert.deepEqual({ failedWrites: empty.failedWrites, lastFailedAt: empty.lastFailedAt, lastFailedRunId: empty.lastFailedRunId }, { failedWrites: 2, lastFailedAt: T2, lastFailedRunId: 'abc12345' });
  assert.equal(memoryHealth([file('a', 10)], { ...failed, writesSinceDefrag: 20 }, CAPS).level, 'failing', 'outranks overdue');
  const cleared = memoryHealth([file('a', 10)], { ...failed, lastWriteAt: '2026-09-17T12:00:00.000Z' }, CAPS);
  assert.equal(cleared.level, 'ok', 'a store write newer than the last failure clears the level');
  assert.deepEqual(cleared.reasons, ['2 memory writes by runs failed since the last defragment — last in run abc12345; that run\'s History detail carries the reason'], 'the reason stays until a defragment resets the counter');
  assert.equal(memoryHealth([file('a', 10)], { ...failed, lastWriteAt: T1 }, CAPS).level, 'failing', 'an OLDER store write does not clear it');
  assert.equal(memoryHealth([], { ...STATE, failedWrites: 0 }, CAPS).level, 'fresh');
  assert.equal(memoryHealth([file('a', 10)], { ...failed, failedWrites: 2, lastFailedAt: null }, CAPS).level, 'failing', 'a counter without a timestamp still counts (corrupt state is loud, not silent)');
});

test('names are capped at three, then an ellipsis; caps without a defrag block fall back to 10 / 30 / 60', () => {
  const many = ['a', 'b', 'c', 'd'].map((n) => file(n, 150));
  assert.equal(memoryHealth(many, STATE, CAPS).reasons.find((s) => /soft cap/.test(s)), '4 files over the 100-byte soft cap: a.md, b.md, c.md, …');
  const noDefrag = { softBytesPerFile: 8192, hardBytesPerFile: 32768, maxFilesPerScope: 50, hookMaxChars: 160 };
  assert.equal(memoryHealth([file('a', 10)], { ...STATE, writesSinceDefrag: 9 }, noDefrag).level, 'ok');
  assert.equal(memoryHealth([file('a', 10)], { ...STATE, writesSinceDefrag: 10 }, noDefrag).level, 'due');
  assert.equal(memoryHealth([file('a', 10)], { ...STATE, writesSinceDefrag: 20 }, noDefrag).level, 'overdue');
});

const roots = [];
after(() => Promise.all(roots.map((d) => rm(d, { recursive: true, force: true }))));
async function root() { const d = await mkdtemp(join(tmpdir(), 'worca-mem-health-')); roots.push(d); return d; }

test('memoryScopeReport: entries + state + health from disk', async () => {
  const r = await root();
  const caps = { ...CAPS, hardBytesPerFile: 32768, softBytesPerFile: 8192 };
  const fresh = await memoryScopeReport(r, GLOBAL_SCOPE, caps);
  assert.deepEqual(fresh, { scope: 'global', entries: [], state: { writesSinceDefrag: 0, lastWriteAt: null, lastDefragAt: null, lastDefragRunId: null, failedWrites: 0, lastFailedAt: null, lastFailedRunId: null }, health: fresh.health });
  assert.equal(fresh.health.level, 'fresh');
  assert.equal(fresh.health.alwaysOnBytes, 0);
  // A 160-char hook: the index line must overflow a 450-byte cap even on a short tmpdir (Linux CI).
  await writeMemory(r, GLOBAL_SCOPE, 'a', `---\nname: a\ndescription: ${'h'.repeat(160)}\n---\nA.\n`, { source: 'user', now: NOW, caps });
  await bumpScopeState(r, GLOBAL_SCOPE, { writesSinceDefrag: 4 });
  const due = await memoryScopeReport(r, GLOBAL_SCOPE, caps);
  assert.equal(due.scope, 'global');
  assert.deepEqual(due.entries.map((e) => e.name), ['a']);
  assert.equal(due.state.writesSinceDefrag, 4);
  assert.equal(due.health.level, 'due');
  assert.deepEqual(due.health.reasons, ['4 memory writes since the last defragment (due at 4)']);
  // A project scope reports under its own key; a junk file is reported through onError, never thrown.
  const pk = projectScope('demo-00000001');
  await mkdir(scopeDir(r, pk), { recursive: true });
  await writeFile(join(scopeDir(r, pk), 'bad name.md'), 'x\n');
  const seen = [];
  const p = await memoryScopeReport(r, pk, caps, { onError: (path, err) => seen.push(err.code) });
  assert.equal(p.scope, 'projects/demo-00000001');
  assert.deepEqual(seen, ['ENAME']);
  assert.equal(p.health.level, 'fresh');
});

// ── the defragmenter's brief: the health the run was started for, handed to the agent ──
test('renderDefragBrief: every reason is a bullet, the always-on budget carries both figures, the block is byte-stable', () => {
  const h = memoryHealth([file('a', 90), file('b', 90), file('c', 90), file('d', 90), file('scoped', 90, { paths: ['src/**'] })], { ...STATE, writesSinceDefrag: 4, lastWriteAt: NOW }, CAPS);
  assert.equal(h.level, 'due');
  const brief = renderDefragBrief(h, CAPS);
  assert.ok(brief.startsWith(`\n${DEFRAG_BRIEF_HEADING}\n`), 'a section of its own, appended to the task document');
  assert.match(brief, /Level: due\./);
  for (const r of h.reasons) assert.ok(brief.includes(`- ${r}\n`), `reason listed: ${r}`);
  assert.match(brief, /files WITHOUT `paths`[^\n]*under 300 bytes — now 360 in 4 files/);
  assert.match(brief, /fewer than 5 files — now 5/);
  assert.match(brief, /each file under 100 bytes/);
  assert.equal(renderDefragBrief(h, CAPS), brief);
});

test('renderDefragBrief: a healthy scope still gets the budgets (a defragment must not break them), and says nothing is crossed', () => {
  const h = memoryHealth([file('a', 10)], { ...STATE }, CAPS);
  const brief = renderDefragBrief(h, CAPS);
  assert.match(brief, /Level: ok\./);
  assert.match(brief, /No threshold is crossed/);
  assert.match(brief, /under 300 bytes — now 10 in 1 file\b/);
  assert.ok(!/\n- /.test(brief.split('Budgets')[0]), 'no reason bullets');
});

test('renderDefragBrief: caps without a defrag block fall back to the defaults memoryHealth uses', () => {
  const h = memoryHealth([file('a', 10)], { ...STATE }, undefined);
  assert.match(renderDefragBrief(h, undefined), /under 16384 bytes — now 10 in 1 file/);
});
