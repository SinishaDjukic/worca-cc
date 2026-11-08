// test/design-chat-actions.test.mjs
// Design P5 Task 7: the hand-off from a design chat to the engine. Attachment names stay inside assets/att on any OS,
// a thread's uploads copy there with stable names, and createDesignChatActions turns a design-start or design-change
// request into designBuilds.start plus a running design-round card, or a notice and no card.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, writeFileSync, mkdirSync, symlinkSync, rmSync, lstatSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { useTempHome } from './helpers/temp-home.mjs';
import { safeAttachmentName, copyThreadAttachments } from '../src/core/design/attachments.mjs';
import { createDesignChatActions } from '../src/core/design/chat-actions.mjs';
import { createThread, appendMessage, addAttachment, updateThread, attachmentPath } from '../src/core/ask/store.mjs';
import { createDesign, updateDesign, createBuild, BRIEF_MAX } from '../src/core/design/store.mjs';
import { DESIGN_LIMITS, ATTACH_NOTE_MAX } from '../src/core/ask/design-payload.mjs';
import { designWorkDir } from '../src/core/design/paths.mjs';
import { createDesignBuilds } from '../src/core/design/registry.mjs';
import { stageDesignKit } from '../src/core/design/kit.mjs';

useTempHome(after);
test('safeAttachmentName: nothing leaves the folder or collides, on any OS', () => {
  const taken = new Set();
  const n = (s) => safeAttachmentName(s, taken);
  assert.deepEqual(['Logo Final (1).PNG', '../../evil.png', '..\\..\\win.png', 'CON.png', 'logo-final-1.png', 'LOGO-FINAL-1.png', '日本語.png', '.env', 'a.b.c.txt', 'x'.repeat(300) + '.png'].map(n),
    ['logo-final-1.png', 'evil.png', 'win.png', 'file-con.png', 'logo-final-1-2.png', 'logo-final-1-3.png', 'file.png', 'file.env', 'a.b.c.txt', 'x'.repeat(60) + '.png']);
});
test('copyThreadAttachments: uploads only, stable across rounds, names returned', async () => {
  const t = createThread({ mode: 'design', title: 'x' });
  const m = appendMessage(t.id, { role: 'user', text: 'x' });
  addAttachment(t.id, m.id, { name: 'Logo.png', kind: 'image', mime: 'image/png', data: Buffer.from('a') });
  addAttachment(t.id, m.id, { name: 'logo.png', kind: 'image', mime: 'image/png', data: Buffer.from('b') });
  addAttachment(t.id, m.id, { name: 'brief.md', text: 'hello' });
  addAttachment(t.id, null, { name: 'shown.txt', text: 'no' });
  const work = mkdtempSync(join(tmpdir(), 'dca-'));
  const names = await copyThreadAttachments({ threadId: t.id, workDir: work });
  assert.deepEqual(names, await copyThreadAttachments({ threadId: t.id, workDir: work }));
  assert.equal(names.length, 3);
  assert.equal(readFileSync(join(work, 'assets/att/brief.md'), 'utf8'), 'hello');
  assert.equal(existsSync(join(work, 'assets/att/shown.txt')), false);
});

function rig(over = {}) {
  const calls = [];
  const holds = { restoring: false, starting: 0 };
  const designBuilds = { whileStarting: async (id, fn) => { if (holds.restoring) throw Object.assign(new Error('A restore is running: try again in a moment'), { status: 409 }); holds.starting += 1; try { return await fn(); } finally { holds.starting -= 1; } }, start: async (o) => { calls.push(o); if (calls.length > 1) throw Object.assign(new Error('This design already has a build open: continue or stop it first'), { status: 409 }); return { buildId: 'b_0123456789ab', round: 1, kind: 'first' }; } };
  const posted = []; const rows = [];
  const a = createDesignChatActions({ receipts: { posted: (b) => posted.push(b) }, flagOn: () => true, brokerRefusal: async () => null,
    appendCardRow: (tid, block) => rows.push([tid, block]), newCardId: () => 'card_00000001', stageKit: async () => {}, ...over,
    designBuilds: { ...designBuilds, ...over.designBuilds } });
  return { a, calls, posted, rows, holds };
}
const withPlan = (d) => writeFileSync(join(designWorkDir(d.id), 'plan.json'), JSON.stringify({ v: 1, kind: 'web', title: 'T', canvas: { w: 1440 }, notes: '', sections: [{ id: 'hero', job: 'Hero', brief: 'b', parts: ['html'], estHeight: 600 }] }));   // createDesign made work/; web sections need estHeight
const made = () => { const d = createDesign({ kind: 'web', title: 'ShipRadar' }, { by: 'local' }); const t = createThread({ mode: 'design', title: d.title }); updateDesign(d.id, { threadId: t.id }); return { d, t }; };

test('a start hands over the brief and returns a running receipt', async () => {
  const { d, t } = made(); const { a, calls, posted } = rig();
  const r = await a.apply({ kind: 'design-start', brief: 'A landing page' }, { threadId: t.id, by: 'local' });
  assert.deepEqual(calls[0], { designId: d.id, brief: 'A landing page', by: 'local' });
  assert.deepEqual([r.ok, r.block.id, r.block.state], [true, 'card_00000001', 'running']);
  assert.deepEqual(r.block.card, { type: 'design-round', designId: d.id, buildId: 'b_0123456789ab', round: 1, kind: 'first', summary: 'Round 1 (first): A landing page', baseVersion: 0 });
  r.posted(true);
  assert.deepEqual(posted, ['b_0123456789ab']);
});
test('a change carries the thread pins, sections and needsLead; attachment names join the instruction', async () => {
  const { d, t } = made();
  const pins = [{ id: 'hero', path: 'h1', tag: 'h1', text: 'x', html: '<h1>' }];
  updateThread(t.id, { composer: { designId: d.id, pins } });
  withPlan(d);
  const m = appendMessage(t.id, { role: 'user', text: 'x' });
  addAttachment(t.id, m.id, { name: 'Logo.png', kind: 'image', mime: 'image/png', data: Buffer.from('a') });
  const { a, calls } = rig();
  await a.apply({ kind: 'design-change', instruction: 'Bolder', sections: ['hero'], needsLead: false }, { threadId: t.id, by: 'local' });
  assert.deepEqual(calls[0], { designId: d.id, instruction: 'Bolder\n\nAttached files, copied to assets/att/ in the source folder: logo.png', sections: ['hero'], needsLead: false, pins, by: 'local' });
});
test('refusals are notices and no card', async () => {
  const { d, t } = made(); withPlan(d);   // the unknown-section row needs a plan: an unreadable one skips that check
  const ask = { kind: 'design-start', brief: 'x' }; const ctx = { threadId: t.id, by: 'local' };
  assert.deepEqual(await rig({ flagOn: () => false }).a.apply(ask, ctx), { ok: false, notice: 'Design is switched off.' });
  assert.deepEqual(await rig({ brokerRefusal: async () => 'You haven\'t added your key yet.' }).a.apply(ask, ctx), { ok: false, notice: 'You haven\'t added your key yet.' });
  assert.deepEqual(await rig({ designBuilds: { start: async () => { throw Object.assign(new Error('x'), { status: 403 }); } } }).a.apply(ask, ctx), { ok: false, notice: 'Total cost limit reached: no build started.' });
  assert.deepEqual(await rig().a.apply({ kind: 'design-change', instruction: 'x', sections: ['faq'], needsLead: false }, ctx), { ok: false, notice: 'Could not start the change: unknown section "faq".' });
  assert.deepEqual(await rig().a.apply(ask, { threadId: 'ask_ffffffff', by: 'local' }), { ok: false, notice: 'This chat has no design.' });
  assert.deepEqual(await rig().a.apply({ kind: 'nope' }, ctx), { ok: false, notice: 'Could not start the build: unknown request.' });
  const draining = Object.assign(new Error('worca is stopping: start this again once it is back'), { status: 503 });
  assert.deepEqual(await rig({ designBuilds: { start: async () => { throw draining; } } }).a.apply(ask, ctx), { ok: false, notice: 'worca is stopping: start this again once it is back' });
  const person = Object.assign(new Error('You already have a build running: stop it or wait for it.'), { status: 409 });
  assert.deepEqual(await rig({ designBuilds: { start: async () => { throw person; } } }).a.apply(ask, ctx), { ok: false, notice: 'You already have a build running: stop it or wait for it.' }, 'another 409 keeps its own words');
});
test('a chat turn trying a second build gets the 409 as a notice; only one build started', async () => {
  const { t } = made(); const { a, calls } = rig();
  const ctx = { threadId: t.id, by: 'local' }; const ask = { kind: 'design-start', brief: 'x' };
  const [one, two] = await Promise.all([a.apply(ask, ctx), a.apply(ask, ctx)]);
  assert.equal(one.ok, true);
  assert.deepEqual(two, { ok: false, notice: 'A build is already open: wait for it, or press Resume or Stop.' });
  assert.equal(calls.length, 2, 'both reached start; the engine refused the second');
});
test('a card the finished reply could not take still reaches the chat', async () => {
  const { t } = made(); const { a, rows } = rig();
  const r = await a.apply({ kind: 'design-start', brief: 'x' }, { threadId: t.id, by: 'local' });
  r.posted(false);
  assert.deepEqual(rows, [[t.id, r.block]]);
});

// Rows beyond the plan's: each pins a guard the rows above leave open.
const scratch = [];
after(() => { for (const p of scratch) rmSync(p, { recursive: true, force: true }); });
const scratchDir = (prefix) => { const p = mkdtempSync(join(tmpdir(), prefix)); scratch.push(p); return p; };

test('safeAttachmentName: accents fold to ASCII, a cut never ends on a separator, a device stem before a dot is prefixed', () => {
  const taken = new Set();
  assert.deepEqual(['Café Menü.png', 'Résumé.pdf', 'folder\\pic.png', 'a'.repeat(59) + '-b.png', '_____' + 'y'.repeat(60) + '.png', 'con.tar.gz']
    .map((s) => safeAttachmentName(s, taken)),
  ['cafe-menu.png', 'resume.pdf', 'pic.png', 'a'.repeat(59) + '.png', 'y'.repeat(60) + '.png', 'file-con.tar.gz']);
});
test('copyThreadAttachments: a body that is gone is skipped; a link at a name is replaced, a linked folder refused', { skip: process.platform === 'win32' }, async () => {
  const t = createThread({ mode: 'design', title: 'x' });
  const m = appendMessage(t.id, { role: 'user', text: 'x' });
  const gone = addAttachment(t.id, m.id, { name: 'gone.md', text: 'lost' });
  rmSync(attachmentPath(t.id, gone.id));
  addAttachment(t.id, m.id, { name: 'brief.md', text: 'hello' });
  const outside = join(scratchDir('dca-out-'), 'keep.md');
  writeFileSync(outside, 'mine');
  const work = scratchDir('dca-');
  mkdirSync(join(work, 'assets/att'), { recursive: true });
  symlinkSync(outside, join(work, 'assets/att/brief.md'));
  assert.deepEqual(await copyThreadAttachments({ threadId: t.id, workDir: work }), ['brief.md']);
  assert.equal(readFileSync(outside, 'utf8'), 'mine');
  assert.equal(lstatSync(join(work, 'assets/att/brief.md')).isSymbolicLink(), false);
  assert.equal(readFileSync(join(work, 'assets/att/brief.md'), 'utf8'), 'hello');
  const linked = scratchDir('dca-');
  mkdirSync(join(linked, 'assets'));
  symlinkSync(dirname(outside), join(linked, 'assets/att'));
  await assert.rejects(copyThreadAttachments({ threadId: t.id, workDir: linked }), /assets\/att is a link/);
  assert.equal(existsSync(join(dirname(outside), 'brief.md')), false);
  const linkedAssets = scratchDir('dca-');
  symlinkSync(dirname(outside), join(linkedAssets, 'assets'));
  await assert.rejects(copyThreadAttachments({ threadId: t.id, workDir: linkedAssets }), /^Error: assets is a link$/);
  assert.equal(existsSync(join(dirname(outside), 'att')), false, 'nothing made through the link');
});
test('a gone chat, a failed copy, a plain refusal; no plan means no section check; the card keeps the version and the words said', async () => {
  const { d, t } = made();
  const ctx = { threadId: t.id, by: 'local' }; const ask = { kind: 'design-start', brief: 'x' };
  const lost = createDesign({ kind: 'web', title: 'Lost' }, { by: 'local' });
  updateDesign(lost.id, { threadId: 'ask_0000dead' });
  assert.deepEqual(await rig().a.apply(ask, { threadId: 'ask_0000dead', by: 'local' }), { ok: false, notice: 'This chat has no design.' }, 'the design row outlived its chat');
  const errors = [];
  const logged = console.error;
  console.error = (line) => errors.push(line);
  try {
    assert.deepEqual(await rig({ stageKit: async () => { throw new Error("ENOENT: no such file or directory, unlink '/srv/home/design/d_1/work/.kit/CONTRACT.md'"); } }).a.apply(ask, ctx),
      { ok: false, notice: 'Could not prepare the build: try again.' }, 'a staging error names no server path');
    const { d: d0, t: t0 } = made();
    addAttachment(t0.id, appendMessage(t0.id, { role: 'user', text: 'x' }).id, { name: 'a.md', text: 'a' });
    mkdirSync(join(designWorkDir(d0.id), 'assets/att/a.md'), { recursive: true });   // a folder where the upload goes
    assert.deepEqual(await rig().a.apply(ask, { threadId: t0.id, by: 'local' }), { ok: false, notice: 'Could not copy the attachments: try again.' });
  } finally {
    console.error = logged;
  }
  assert.equal(errors.length, 2);
  assert.match(errors[0], /^\[worca-design\] staging the kit of d_[0-9a-f]+ failed: ENOENT: .*\.kit\/CONTRACT\.md'$/, 'the log keeps the fs message');
  assert.match(errors[1], /^\[worca-design\] copying the uploads of d_[0-9a-f]+ failed: E[A-Z]+: /);
  const brief = Object.assign(new Error('A brief is required'), { status: 422 });
  assert.deepEqual(await rig({ designBuilds: { start: async () => { throw brief; } } }).a.apply(ask, ctx), { ok: false, notice: 'Could not start the build: A brief is required.' });
  updateThread(t.id, { composer: { designId: d.id, pins: [{ id: 'hero', path: 'h1', tag: 'h1', text: 'x', html: '<h1>' }] } });
  updateDesign(d.id, { version: 3 });
  const m = appendMessage(t.id, { role: 'user', text: 'x' });
  addAttachment(t.id, m.id, { name: 'brief.md', text: 'hello' });
  const note = '\n\nAttached files, copied to assets/att/ in the source folder: brief.md';
  const s = rig();
  const r = await s.a.apply({ kind: 'design-start', brief: 'A page' }, ctx);
  assert.deepEqual(s.calls[0], { designId: d.id, brief: `A page${note}`, by: 'local' }, 'a start never carries pins');
  assert.deepEqual([r.block.card.summary, r.block.card.baseVersion], ['Round 1 (first): A page', 3]);
  updateThread(t.id, { composer: { designId: d.id, pins: [] } });
  const change = { kind: 'design-change', instruction: 'Y', sections: ['faq'] };
  const c = rig();
  assert.equal((await c.a.apply(change, ctx)).ok, true, 'no plan.json yet: P2 checks the sections');
  assert.deepEqual(c.calls[0], { designId: d.id, instruction: `Y${note}`, sections: ['faq'], needsLead: true, by: 'local' }, 'no pins: no pins key');
  writeFileSync(join(designWorkDir(d.id), 'plan.json'), '{');
  assert.equal((await rig().a.apply(change, ctx)).ok, true, 'an invalid plan.json: P2 refuses it with its own 422');
});

test('a brief or instruction at its limit plus any number of uploads fits P1\'s BRIEF_MAX; one over is refused before anything is staged', async () => {
  assert.equal(DESIGN_LIMITS.brief + ATTACH_NOTE_MAX, BRIEF_MAX, 'the chat\'s limit leaves the attachment line its room');
  assert.equal(DESIGN_LIMITS.instruction + ATTACH_NOTE_MAX, BRIEF_MAX);
  const { d, t } = made(); withPlan(d);
  const m = appendMessage(t.id, { role: 'user', text: 'x' });
  for (let i = 0; i < 40; i += 1) addAttachment(t.id, m.id, { name: `${'n'.repeat(70)}${i}.md`, text: 'hello' });
  const ctx = { threadId: t.id, by: 'local' };
  const s = rig();
  assert.equal((await s.a.apply({ kind: 'design-start', brief: 'b'.repeat(DESIGN_LIMITS.brief) }, ctx)).ok, true);
  assert.ok(s.calls[0].brief.length <= BRIEF_MAX, String(s.calls[0].brief.length));
  assert.match(s.calls[0].brief, / and \d+ more$/);
  createBuild({ designId: d.id, kind: 'first', brief: s.calls[0].brief }, { by: 'local' });   // P1 takes it
  const c = rig();
  assert.equal((await c.a.apply({ kind: 'design-change', instruction: 'i'.repeat(DESIGN_LIMITS.instruction), sections: ['hero'] }, ctx)).ok, true);
  assert.ok(c.calls[0].instruction.length <= BRIEF_MAX, String(c.calls[0].instruction.length));
  const { d: d2, t: t2 } = made(); withPlan(d2);
  let staged = 0;
  const over = rig({ stageKit: async () => { staged += 1; } });
  assert.deepEqual(await over.a.apply({ kind: 'design-change', instruction: 'i'.repeat(DESIGN_LIMITS.instruction + 1), sections: ['hero'] }, { threadId: t2.id, by: 'local' }),
    { ok: false, notice: `Could not start the change: instruction is longer than ${DESIGN_LIMITS.instruction} characters.` });
  assert.deepEqual(await over.a.apply({ kind: 'design-start', brief: 'b'.repeat(DESIGN_LIMITS.brief + 1) }, { threadId: t2.id, by: 'local' }),
    { ok: false, notice: `Could not start the build: brief is longer than ${DESIGN_LIMITS.brief} characters.` });
  assert.equal(staged, 0, 'refused before the kit is staged');
  const att = join(designWorkDir(d2.id), 'assets/att');
  assert.deepEqual(existsSync(att) ? readdirSync(att) : [], [], 'and before any upload is copied');
  assert.deepEqual(over.calls, []);
  const refused = Object.assign(new Error('the plan is not valid'), { status: 422 });
  assert.deepEqual(await rig({ designBuilds: { start: async () => { throw refused; } } }).a.apply({ kind: 'design-change', instruction: 'Y', sections: ['hero'] }, ctx),
    { ok: false, notice: 'Could not start the change: the plan is not valid.' }, 'a change\'s refusal names the change');
});

test('M3: the hand-off stages and starts inside the design\'s hold; a restore running refuses it before anything is staged', async () => {
  const { d, t } = made(); const ctx = { threadId: t.id, by: 'local' };
  let seen = null;
  const s = rig({ stageKit: async () => { seen = s.holds.starting; } });
  assert.equal((await s.a.apply({ kind: 'design-start', brief: 'x' }, ctx)).ok, true);
  assert.equal(seen, 1, 'the kit is staged while the hold is held');
  assert.equal(s.holds.starting, 0, 'and it is let go');
  let staged = 0;
  const r = rig({ stageKit: async () => { staged += 1; } });
  r.holds.restoring = true;
  assert.deepEqual(await r.a.apply({ kind: 'design-start', brief: 'x' }, ctx), { ok: false, notice: 'A restore is running: try again in a moment' });
  assert.equal(staged, 0);
  assert.deepEqual(r.calls, []);
  void d;
});
test('two hand-offs at once with the real hold and kit, 50 rounds: one stages and starts, the other meets its open build before staging', async () => {
  const reg = createDesignBuilds({ broadcast: () => {} });
  const kit = readFileSync(new URL('../assets/design-kit/web/CONTRACT.md', import.meta.url), 'utf8');
  for (let i = 0; i < 50; i += 1) {
    const { d, t } = made();
    const work = designWorkDir(d.id);
    if (i % 2) await stageDesignKit({ kind: 'web', workDir: work });   // an earlier round's kit: fs.cp(force) raced on its unlink
    let staged = 0;
    const started = [];
    const s = rig({
      stageKit: async (o) => { staged += 1; return stageDesignKit(o); },
      designBuilds: {
        whileStarting: (id, fn) => reg.whileStarting(id, fn),
        start: async (o) => {   // P2's start: its open-build 409 for a second call, else a real open build row
          started.push(o.designId);
          if (started.length > 1) throw Object.assign(new Error('This design already has a build open: continue or stop it first'), { status: 409 });
          const b = createBuild({ designId: o.designId, kind: 'first', brief: o.brief }, { by: 'local' });
          return { buildId: b.id, round: b.round, kind: b.kind };
        },
      },
    });
    const pair = await Promise.all([1, 2].map(() => s.a.apply({ kind: 'design-start', brief: 'A page' }, { threadId: t.id, by: 'local' })));
    assert.equal(pair.filter((r) => r.ok).length, 1, `round ${i}: ${JSON.stringify(pair.map((r) => r.notice))}`);
    assert.deepEqual(pair.find((r) => !r.ok), { ok: false, notice: 'A build is already open: wait for it, or press Resume or Stop.' }, `round ${i}`);
    assert.deepEqual([staged, started.length], [1, 1], `round ${i}: the loser staged nothing and never reached start`);
    assert.equal(readFileSync(join(work, '.kit/CONTRACT.md'), 'utf8'), kit);
  }
});
test('M3: the receipt\'s baseVersion is the version the round starts from, read once the design is held, not before the awaits', async () => {
  const { d, t } = made(); updateDesign(d.id, { version: 2 });
  const s = rig({ brokerRefusal: async () => { updateDesign(d.id, { version: 3 }); return null; } });   // a restore ended meanwhile
  const r = await s.a.apply({ kind: 'design-start', brief: 'x' }, { threadId: t.id, by: 'local' });
  assert.equal(r.block.card.baseVersion, 3);
});
