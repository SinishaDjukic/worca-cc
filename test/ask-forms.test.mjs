// test/ask-forms.test.mjs
// Gates 2 and 3 (spec §5). Gate 2 turns an agent's {form,data} into the RESOLVED
// ask the host gates on — or into the exact error list the agent is resumed with.
// Gate 3 turns the human's {values} into the {form,version,values} the agent
// receives, or into the 422 body. Neither may ever throw: "No gate may crash a
// run" (D5). Pure module + a temp dir — no WORCA_HOME, no DB.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareFormAsk, formAnswerValidator, askIdToken, downgradeQuestion, ASK_FILES_DIR } from '../src/core/ask-forms.mjs';

const dirs = [];
async function tmp() { const d = await mkdtemp(join(tmpdir(), 'worca-cc-askform-')); dirs.push(d); return d; }
after(async () => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true, maxRetries: 3 }))));

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

const FORM = {
  version: 2,
  title: 'Review mockups',
  data: { type: 'object', required: ['images'], properties: {
    summary: { type: 'string', maxLength: 8000 },
    images: { type: 'array', maxItems: 12, items: { type: 'object', required: ['id', 'file'], properties: {
      id: { type: 'string' }, caption: { type: 'string' },
      file: { type: 'file', accept: ['image/*'] } } } } } },
  answer: { type: 'object', required: ['verdict'], properties: {
    verdict: { type: 'string', enum: ['approve', 'changes'], default: 'approve' },
    picked: { type: 'string', enumFrom: 'data.images[].id' },
    notes: { type: 'string', maxLength: 4000 } } },
  layout: [
    { widget: 'markdown', bind: 'data.summary' },
    { widget: 'gallery', bind: 'data.images', field: 'picked' },
    { widget: 'select', field: 'verdict', label: 'Verdict' },
    { widget: 'textarea', field: 'notes', label: 'What should change?', when: { verdict: 'changes' } },
  ],
  example: { summary: 'Two directions.', images: [{ id: 'a', caption: 'Option A', file: 'mockups/a.png' }] },
};
const META = { key: 'mockReviewer', ask: { forms: { 'review-mockups': FORM } } };

/** A working tree with the two mockups the data below references. */
async function worktree() {
  const dir = await tmp();
  await mkdir(join(dir, 'mockups'), { recursive: true });
  await writeFile(join(dir, 'mockups', 'a.png'), PNG);
  await writeFile(join(dir, 'mockups', 'b.png'), PNG);
  return dir;
}
const DATA = { summary: 'Two directions.', images: [
  { id: 'a', caption: 'Option A', file: 'mockups/a.png' },
  { id: 'b', caption: 'Option B', file: 'mockups/b.png' },
] };

test('askIdToken: filesystem- and URL-safe, deterministic, never empty', () => {
  assert.equal(askIdToken('questions-x:n_impl:1-r1'), 'questions-x_n_impl_1-r1');
  assert.equal(askIdToken('clarify-n_clarify-1'), 'clarify-n_clarify-1');
  assert.equal(askIdToken(''), 'ask');
  assert.equal(askIdToken('../../etc/passwd'), '______etc_passwd', 'six separators, six underscores — nothing collapses');
  assert.equal(askIdToken('x'.repeat(200)).length, 96);
  assert.match(askIdToken('a/b\\c'), /^[A-Za-z0-9_-]+$/);
});

test('gate 2: a good ask resolves enumFrom, snapshots the files and returns the auto answer', async () => {
  const cwd = await worktree();
  const pipelineDir = await tmp();
  const out = await prepareFormAsk({
    agentMeta: META, payload: { form: 'review-mockups', data: DATA },
    cwd, pipelineDir, askId: 'questions-x:n_impl:1-r1',
  });
  assert.equal(out.ok, true, JSON.stringify(out.errors));
  assert.equal(out.ask.kind, 'form');
  assert.equal(out.ask.form, 'review-mockups');
  assert.equal(out.ask.version, 2);
  assert.equal(out.ask.title, 'Review mockups');
  assert.equal(out.ask.askId, 'questions-x_n_impl_1-r1');
  assert.equal(out.ask.surface, 'any', 'X1/E19: the default surface is applied HERE, not in the sidecar');
  assert.equal('id' in out.ask, false, 'the QUESTION id is the caller\'s; the ask carries only askId (E1)');
  assert.deepEqual(out.ask.layout, FORM.layout, 'layout rides VERBATIM');
  assert.deepEqual(out.ask.answerSchema.properties.picked.enum, ['a', 'b'],
    'enumFrom is resolved to a CLOSED set at ask time (§3.1)');
  assert.deepEqual(out.ask.files.map((f) => [f.index, f.rel, f.mime, f.stored]), [
    [0, 'mockups/a.png', 'image/png', '0.png'],
    [1, 'mockups/b.png', 'image/png', '1.png'],
  ]);
  assert.equal(out.ask.files[0].name, 'a.png');
  // X16: the renderer's file lookup table, index-for-index with `files`.
  assert.deepEqual(out.ask.fileRefs, [
    { path: 'data.images[0].file', rel: 'mockups/a.png' },
    { path: 'data.images[1].file', rel: 'mockups/b.png' },
  ]);
  assert.deepEqual(out.ask.fileRefs.map((r) => r.rel), out.ask.files.map((f) => f.rel),
    'fileRefs[i] is the ref files[i] was snapshotted from');
  assert.equal(out.ask.fileRefs.some((r) => 'accept' in r), false, 'accept is a gate-2 input, not envelope data');
  assert.deepEqual(out.autoValues.verdict, 'approve', 'D10: `default` feeds auto mode');
  assert.equal('autoValues' in out.ask, false, 'the auto answer is NOT part of the persisted ask (E2)');
});

test('gate 2: a declared surface rides through; an unknown one falls back to "any"', async () => {
  const cwd = await worktree();
  const webMeta = { key: 'r', ask: { forms: { 'review-mockups': { ...FORM, surface: 'web' } } } };
  const web = await prepareFormAsk({ agentMeta: webMeta, payload: { form: 'review-mockups', data: DATA },
    cwd, pipelineDir: await tmp(), askId: 'a' });
  assert.equal(web.ask.surface, 'web');
  const oddMeta = { key: 'r', ask: { forms: { 'review-mockups': { ...FORM, surface: 'carrier-pigeon' } } } };
  const odd = await prepareFormAsk({ agentMeta: oddMeta, payload: { form: 'review-mockups', data: DATA },
    cwd, pipelineDir: await tmp(), askId: 'a' });
  assert.equal(odd.ask.surface, 'any', 'FORM_SURFACES is the closed set; anything else fails safe to "any"');
});

test('gate 2 refuses: data whose AUTO ANSWER could not pass gate 3 (checkAskData, ruling X4)', async () => {
  const cwd = await worktree();
  // `picked` is required and its enum comes from data.images[].id — with NO
  // images the resolved enum is closed and empty, so no auto answer exists.
  const strict = { ...FORM, answer: { type: 'object', required: ['picked'],
    properties: { picked: { type: 'string', enumFrom: 'data.images[].id' } } },
  layout: [{ widget: 'gallery', bind: 'data.images', field: 'picked' }] };
  const out = await prepareFormAsk({
    agentMeta: { key: 'r', ask: { forms: { 'review-mockups': strict } } },
    payload: { form: 'review-mockups', data: { images: [] } },
    cwd, pipelineDir: await tmp(), askId: 'a',
  });
  assert.equal(out.ok, false);
  assert.equal(out.errors[0].code, 'bad-auto');
  assert.match(out.errors[0].path, /^answer\./, 'P1 prefixes a bad-auto path with `answer.`');
});

test('gate 2 refuses: an UNDECLARED data key is named (P1 C1 unknown-key), not silently dropped', async () => {
  const cwd = await worktree();
  const out = await prepareFormAsk({
    agentMeta: META, payload: { form: 'review-mockups', data: { ...DATA, imagez: [] } },
    cwd, pipelineDir: await tmp(), askId: 'a',
  });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => e.code === 'unknown-key'), JSON.stringify(out.errors));
});

test('gate 2: the snapshot lands under <pipelineDir>/ask-files/<askId>/', async () => {
  const cwd = await worktree();
  const pipelineDir = await tmp();
  const out = await prepareFormAsk({
    agentMeta: META, payload: { form: 'review-mockups', data: DATA },
    cwd, pipelineDir, askId: 'ask1',
  });
  assert.equal(out.ok, true);
  const { readFile } = await import('node:fs/promises');
  const manifest = JSON.parse(await readFile(join(pipelineDir, ASK_FILES_DIR, 'ask1', 'manifest.json'), 'utf8'));
  assert.equal(manifest.files.length, 2);
});

test('gate 2 refuses: an UNKNOWN form id, and it names what the agent DOES declare', async () => {
  const out = await prepareFormAsk({
    agentMeta: META, payload: { form: 'nope', data: {} },
    cwd: await tmp(), pipelineDir: await tmp(), askId: 'a',
  });
  assert.equal(out.ok, false);
  assert.equal(out.errors[0].path, 'form');
  assert.equal(out.errors[0].code, 'unknown-field');
  assert.match(out.errors[0].message, /unknown form "nope".*review-mockups/);
  const none = await prepareFormAsk({
    agentMeta: { key: 'plain' }, payload: { form: 'x', data: {} },
    cwd: await tmp(), pipelineDir: await tmp(), askId: 'a',
  });
  assert.equal(none.ok, false);
  assert.match(none.errors[0].message, /declares none/);
});

test('gate 2 refuses: data that fails the data schema — and never touches the filesystem after that', async () => {
  const pipelineDir = await tmp();
  const out = await prepareFormAsk({
    agentMeta: META, payload: { form: 'review-mockups', data: { summary: 'x' } },   // `images` is required
    cwd: await tmp(), pipelineDir, askId: 'a',
  });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => e.code === 'required'), JSON.stringify(out.errors));
  assert.ok(out.errors.every((e) => e.path.startsWith('data.') || e.path === 'data'),
    'checkAskData prefixes every data-schema error path with `data.` — P2 must not prefix again');
  const { existsSync } = await import('node:fs');
  assert.equal(existsSync(join(pipelineDir, ASK_FILES_DIR, 'a')), false, 'no snapshot dir for a refused ask');
});

test('gate 2 refuses: a bad FILE, with the data path of the offending value', async () => {
  const cwd = await worktree();
  const out = await prepareFormAsk({
    agentMeta: META,
    payload: { form: 'review-mockups', data: { images: [{ id: 'a', file: '../../../etc/passwd' }] } },
    cwd, pipelineDir: await tmp(), askId: 'a',
  });
  assert.equal(out.ok, false);
  assert.equal(out.errors[0].code, 'file-path');
  assert.match(out.errors[0].path, /^data\.images\[0\]\.file$/);
});

test('gate 2 refuses: oversize data, before any schema work', async () => {
  const out = await prepareFormAsk({
    agentMeta: META,
    payload: { form: 'review-mockups', data: { summary: 'x'.repeat(300000), images: [] } },
    cwd: await tmp(), pipelineDir: await tmp(), askId: 'a',
  });
  assert.equal(out.ok, false);
  assert.equal(out.errors[0].code, 'too-big');
  assert.equal(out.errors[0].path, 'data');
});

test('gate 3: a valid answer becomes {form, version, values}; hidden fields are dropped', async () => {
  const cwd = await worktree();
  const { ask } = await prepareFormAsk({
    agentMeta: META, payload: { form: 'review-mockups', data: DATA },
    cwd, pipelineDir: await tmp(), askId: 'a',
  });
  const check = formAnswerValidator(ask);
  const ok = check({ values: { verdict: 'changes', picked: 'b', notes: 'tighten the spacing', bogus: 1 } });
  assert.deepEqual(ok, { ok: true, payload: { form: 'review-mockups', version: 2,
    values: { verdict: 'changes', picked: 'b', notes: 'tighten the spacing' } } }, 'unknown keys stripped');
  const hidden = check({ values: { verdict: 'approve', picked: 'a', notes: 'never asked' } });
  assert.equal(hidden.ok, true);
  assert.equal('notes' in hidden.payload.values, false, '`when: {verdict:"changes"}` hides notes, so it is dropped');
});

test('gate 3 refuses: a missing required field, a value outside the RESOLVED enum, and a malformed payload', async () => {
  const cwd = await worktree();
  const { ask } = await prepareFormAsk({
    agentMeta: META, payload: { form: 'review-mockups', data: DATA },
    cwd, pipelineDir: await tmp(), askId: 'a',
  });
  const check = formAnswerValidator(ask);
  const missing = check({ values: {} });
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.some((e) => e.code === 'required'), JSON.stringify(missing.errors));
  const outside = check({ values: { verdict: 'approve', picked: 'zzz' } });
  assert.equal(outside.ok, false);
  assert.ok(outside.errors.some((e) => e.code === 'enum'));
  for (const bad of [null, undefined, {}, { values: null }, { values: 'text' }, 'nope']) {
    const r = check(bad);
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.equal(typeof r.errors[0].message, 'string');
  }
});

test('gate 3 works from a PERSISTED ask alone — no sidecar, no def (R1, spec §9)', async () => {
  const cwd = await worktree();
  const { ask } = await prepareFormAsk({
    agentMeta: META, payload: { form: 'review-mockups', data: DATA },
    cwd, pipelineDir: await tmp(), askId: 'a',
  });
  const revived = JSON.parse(JSON.stringify(ask));   // exactly what the DB gives back
  assert.equal(formAnswerValidator(revived)({ values: { verdict: 'approve', picked: 'a' } }).ok, true);
});

test('downgradeQuestion: the form TITLE verbatim, free text, no options (E12)', () => {
  assert.deepEqual(downgradeQuestion({ form: 'review-mockups', title: 'Review mockups' }),
    { id: 'form-review-mockups', question: 'Review mockups', options: [], allowFreeText: true });
  assert.equal(downgradeQuestion({ form: 'review-mockups', title: '' }).question, 'review-mockups');
});

/** A value nested `n` levels, built as TEXT: JSON.parse is iterative, so the fixture itself
 *  can never overflow — only a recursive consumer can. */
const deep = (n) => JSON.parse('['.repeat(n) + ']'.repeat(n));

/** Opaque rows (`items: { type: 'object' }` with no properties) are the one data shape the
 *  data schema admits WITHOUT walking — so a deep value rides inside a row unchecked. */
const OPAQUE = {
  version: 1, title: 'Opaque rows',
  data: { type: 'object', required: ['rows'], properties: { rows: { type: 'array', items: { type: 'object' } } } },
  answer: { type: 'object', required: ['verdict'], properties: {
    verdict: { type: 'string', enum: ['approve', 'changes'], default: 'approve' }, notes: { type: 'string' } } },
  layout: [{ widget: 'select', field: 'verdict', label: 'Verdict' }, { widget: 'textarea', field: 'notes', label: 'Notes' }],
  example: { rows: [{ x: 1 }] },
};
const OPAQUE_META = { key: 'r', ask: { forms: { rows: OPAQUE } } };

test('gate 2 refuses: data nested deeper than 256 levels, by NAME and before any recursive step (Node 22 and 25 alike)', async () => {
  const pipelineDir = await tmp();
  for (const n of [300, 9000]) {
    const out = await prepareFormAsk({
      agentMeta: OPAQUE_META, payload: { form: 'rows', data: { rows: [{ x: deep(n) }] } },
      cwd: await tmp(), pipelineDir, askId: 'deep',
    });
    assert.equal(out.ok, false, `${n} levels must be refused`);
    assert.deepEqual(out.errors, [{ path: 'data', code: 'too-big', message: 'data is nested deeper than 256 levels' }],
      `${n}: the depth count runs before JSON.stringify, whose RangeError on Node 22 would otherwise read as "not JSON-serializable" — and Node 25 would ADMIT the value`);
  }
  const { existsSync } = await import('node:fs');
  assert.equal(existsSync(join(pipelineDir, ASK_FILES_DIR, 'deep')), false, 'no snapshot dir for a refused ask');
  const fine = await prepareFormAsk({
    agentMeta: OPAQUE_META, payload: { form: 'rows', data: { rows: [{ x: deep(20) }] } },
    cwd: await tmp(), pipelineDir, askId: 'shallow',
  });
  assert.equal(fine.ok, true, JSON.stringify(fine.errors));
});

test('gate 3 refuses: values nested deeper than 256 levels — a 422, never a RangeError out of answer()', async () => {
  const check = formAnswerValidator({ form: 'rows', version: 1, layout: OPAQUE.layout, answerSchema: OPAQUE.answer });
  for (const values of [{ verdict: 'approve', notes: deep(9000) }, { verdict: 'approve', bogus: deep(9000) }]) {
    const r = check({ values });
    assert.equal(r.ok, false);
    assert.deepEqual(r.errors, [{ path: '', code: 'too-big', message: 'values are nested deeper than 256 levels' }],
      'collectAnswer clones a posted value with a JSON round trip, which Node 22 overflows at this depth');
  }
  assert.equal(check({ values: { verdict: 'approve', notes: 'fine' } }).ok, true);
});

test('gate 2 never throws on a def that lacks a schema, and gate 3 never throws on a null ask', async () => {
  const out = await prepareFormAsk({
    agentMeta: { key: 'r', ask: { forms: { half: { version: 1, title: 'Half', data: OPAQUE.data, layout: OPAQUE.layout } } } },
    payload: { form: 'half', data: { rows: [] } }, cwd: await tmp(), pipelineDir: await tmp(), askId: 'a',
  });
  assert.equal(out.ok, false);
  assert.equal(out.errors[0].code, 'unknown-field');
  assert.match(out.errors[0].message, /no data or answer schema/);
  assert.doesNotThrow(() => formAnswerValidator(null)({ values: { verdict: 'approve' } }));
});
