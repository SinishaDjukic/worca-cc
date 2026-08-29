// test/sources.test.mjs — the task-source seam (spec §7.3): one resolution path
// for prompt | markdown | plugin, plus source_type/source_ref persistence.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb } from '../src/core/db.mjs';
import { artifactPaths, createPipeline } from '../src/core/artifacts.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { writePluginsLock, pluginCurrentDir } from '../src/core/plugins-lock.mjs';
import { setMockSourceResponses } from '../src/core/plugin-shim.mjs';
import { listTaskSources, resolveTaskInput } from '../src/core/sources.mjs';

useTempHome(after);

const tmp = () => mkdtempSync(join(tmpdir(), 'worca-cc-sources-'));

// ── resolveTaskInput ────────────────────────────────────────────────────────────

test('prompt source: verbatim passthrough, no file, no meta', async () => {
  const input = await resolveTaskInput({ type: 'prompt', prompt: 'add pagination' }, { projectDir: tmp() });
  assert.deepEqual(input, { promptText: 'add pagination', promptFile: null, sourceMeta: null });
});

test('markdown source: promptFile read with resolveAgainst semantics; promptText fallback', async () => {
  const projectDir = tmp();
  mkdirSync(join(projectDir, 'notes'));
  const raw = '# Task\r\nCRLF body line\r\ntrailing spaces, no final newline  ';
  writeFileSync(join(projectDir, 'notes', 'task.md'), raw);
  // relative path resolves against projectDir (same as today's createPipeline read)
  const viaFile = await resolveTaskInput({ type: 'markdown', promptFile: 'notes/task.md' }, { projectDir });
  assert.equal(viaFile.promptText, raw);
  assert.equal(viaFile.promptFile, 'notes/task.md');
  assert.equal(viaFile.sourceMeta, null);
  // pasted markdown (no file)
  const viaText = await resolveTaskInput({ type: 'markdown', promptText: '# pasted' }, { projectDir });
  assert.deepEqual(viaText, { promptText: '# pasted', promptFile: null, sourceMeta: null });
  // MAJ-9: a NAMED file that cannot be read is an error, never an empty prompt —
  // the empty-string fallback is only meaningful when no file was named.
  await assert.rejects(
    () => resolveTaskInput({ type: 'markdown', promptFile: 'notes/absent.md' }, { projectDir }),
    (err) => {
      assert.equal(err.code, 'PROMPT_FILE_UNREADABLE');
      assert.match(err.message, /^cannot read prompt file /);
      assert.ok(err.message.includes(join(projectDir, 'notes', 'absent.md')), err.message);
      return true;
    },
  );
});

test('plugin source: getTask -> "# title\\n\\nbody" + fenced json meta + sourceMeta', async () => {
  process.env.WORCA_MOCK = '1';
  try {
    setMockSourceResponses({
      getTask: (args) => ({
        id: args.id, title: 'Fix login', url: 'https://tracker.test/T-9', state: 'open',
        updatedAt: '2026-07-01T00:00:00Z', body: 'Redirect loop after logout.', meta: { priority: 'high' },
      }),
    });
    const input = await resolveTaskInput(
      { type: 'plugin', plugin: 'gh', sourceId: 'issues', taskId: 'T-9' },
      { projectDir: tmp() },
    );
    const fence = '```';
    assert.equal(
      input.promptText,
      `# Fix login\n\nRedirect loop after logout.\n\n${fence}json meta\n{\n  "priority": "high"\n}\n${fence}`,
    );
    assert.equal(input.promptFile, null);
    assert.deepEqual(input.sourceMeta, {
      plugin: 'gh', sourceId: 'issues', taskId: 'T-9', profile: null, inputs: null,
      url: 'https://tracker.test/T-9', title: 'Fix login',
    });

    // A multi-profile source pins WHICH configuration the task came from, so
    // write-back later reports to that instance even if the project has since
    // been re-bound to another one. The source-panel inputs are pinned for the
    // same reason: a per-run choice (e.g. writeBack) gates THIS run's report.
    const bound = await resolveTaskInput(
      { type: 'plugin', plugin: 'gh', sourceId: 'issues', taskId: 'T-9', profile: 'client', inputs: { writeBack: 'yes' } },
      { projectDir: tmp() },
    );
    assert.equal(bound.sourceMeta.profile, 'client');
    assert.deepEqual(bound.sourceMeta.inputs, { writeBack: 'yes' });
    // empty meta => no fence; null task => throws
    setMockSourceResponses({ getTask: { id: 'T-1', title: 'T', state: 'open', updatedAt: 'x', body: 'b', meta: {} } });
    const bare = await resolveTaskInput({ type: 'plugin', plugin: 'gh', sourceId: 'issues', taskId: 'T-1' }, { projectDir: tmp() });
    assert.equal(bare.promptText, '# T\n\nb');
    setMockSourceResponses({ getTask: null });
    await assert.rejects(
      resolveTaskInput({ type: 'plugin', plugin: 'gh', sourceId: 'issues', taskId: 'gone' }, { projectDir: tmp() }),
      /task "gone" not found/,
    );
  } finally {
    delete process.env.WORCA_MOCK;
    setMockSourceResponses(null);
  }
});

// ── persistence through createPipeline ─────────────────────────────────────────

test('plugin source persists source_type=plugin + source_ref JSON round-trip', async () => {
  const meta = { plugin: 'gh', sourceId: 'issues', taskId: 'T-9', url: 'https://tracker.test/T-9', title: 'Fix login' };
  const p = await createPipeline(tmp(), { promptText: '# Fix login\n\nbody', sourceType: 'plugin', sourceMeta: meta });
  const row = getDb().prepare('SELECT source_type, source_ref FROM pipelines WHERE id = ?').get(p.id);
  assert.equal(row.source_type, 'plugin');
  assert.deepEqual(JSON.parse(row.source_ref), meta);
  assert.equal(await readFile(join(p.dir, 'prompt.md'), 'utf8'), '# Fix login\n\nbody');
});

test('legacy prompt path: identical prompt.md bytes; row gets prompt/NULL defaults', async () => {
  const p = await createPipeline(tmp(), { prompt: 'add pagination' });
  const row = getDb().prepare('SELECT source_type, source_ref FROM pipelines WHERE id = ?').get(p.id);
  assert.equal(row.source_type, 'prompt');
  assert.equal(row.source_ref, null);
  assert.equal(await readFile(join(p.dir, 'prompt.md'), 'utf8'), 'add pagination');
});

test('markdown file is still copied VERBATIM into prompt.md (not re-serialized)', async () => {
  const projectDir = tmp();
  const raw = '# Task\r\nCRLF line\r\ntrailing spaces, no final newline  ';
  writeFileSync(join(projectDir, 'task.md'), raw);
  const input = await resolveTaskInput({ type: 'markdown', promptFile: 'task.md' }, { projectDir });
  const p = await createPipeline(projectDir, {
    promptText: input.promptText, promptFile: input.promptFile, sourceType: 'markdown',
  });
  assert.equal(await readFile(join(p.dir, 'prompt.md'), 'utf8'), raw, 'byte-identical copy');
  const row = getDb().prepare('SELECT source_type, source_ref FROM pipelines WHERE id = ?').get(p.id);
  assert.equal(row.source_type, 'markdown');
  assert.equal(row.source_ref, null);
});

// ── orchestrator threading (feature-off proof at the run level) ────────────────

test('createOrchestrator({prompt}) mock e2e: row stays source_type=prompt / NULL ref', async () => {
  const projectDir = tmp();
  const orch = createOrchestrator({ projectDir, prompt: 'demo task', auto: true, claude: { mock: true } });
  const res = await orch.run();
  assert.equal(res.status, 'done');
  const row = getDb().prepare('SELECT source_type, source_ref, prompt FROM pipelines WHERE id = ?')
    .get(orch.getState().id);
  assert.equal(row.source_type, 'prompt');
  assert.equal(row.source_ref, null);
  assert.equal(row.prompt, 'demo task');
});

// ── listTaskSources ────────────────────────────────────────────────────────────

test('listTaskSources: built-ins only with zero plugins (feature-off)', () => {
  writePluginsLock({});
  assert.deepEqual(listTaskSources(), [
    { type: 'prompt', displayName: 'Prompt' },
    { type: 'markdown', displayName: 'Markdown' },
  ]);
});

test('listTaskSources lists enabled plugin sources with inputs; skips disabled + broken', () => {
  const manifest = (name, displayName) => JSON.stringify({
    name,
    taskSources: [{
      id: 'issues', displayName, module: './connector/index.mjs',
      inputs: [{ key: 'task', type: 'task-browser', label: 'Task' }],
    }],
  });
  for (const name of ['alpha-src', 'beta-src']) {
    mkdirSync(pluginCurrentDir(name), { recursive: true });
    writeFileSync(join(pluginCurrentDir(name), 'worca-cc-plugin.json'), manifest(name, name === 'alpha-src' ? 'Alpha Issues' : 'Beta Issues'));
  }
  const entry = (enabled) => ({ repo: 'r', subdir: null, pinnedSha: 'a'.repeat(40), version: null, enabled, installedAt: 't' });
  writePluginsLock({
    'alpha-src': entry(true),
    'beta-src': entry(false),          // disabled -> hidden
    'gamma-src': entry(true),          // enabled but current/ missing -> skipped, never throws
  });
  const plug = listTaskSources().filter((s) => s.type === 'plugin');
  assert.equal(plug.length, 1);
  assert.equal(plug[0].plugin, 'alpha-src');
  assert.equal(plug[0].sourceId, 'issues');
  assert.equal(plug[0].displayName, 'Alpha Issues');
  assert.ok(plug[0].inputs.some((i) => i.type === 'task-browser'), 'inputs schema passed through');
});

// ── MAJ-9: a named-but-unreadable prompt file must never run an empty prompt ────

test('MAJ-9: createPipeline throws PROMPT_FILE_UNREADABLE instead of seeding a 0-byte prompt.md', async () => {
  const projectDir = tmp();
  const before = getDb().prepare('SELECT COUNT(*) n FROM pipelines').get().n;
  await assert.rejects(
    () => createPipeline(projectDir, { promptFile: 'nope/missing.md', sourceType: 'markdown' }),
    (err) => {
      assert.equal(err.code, 'PROMPT_FILE_UNREADABLE');
      assert.ok(err.message.includes(join(projectDir, 'nope', 'missing.md')), err.message);
      return true;
    },
  );
  assert.equal(getDb().prepare('SELECT COUNT(*) n FROM pipelines').get().n, before, 'no row was inserted');
  // The refusal happens BEFORE anything is created — not half-way through, with a
  // pipeline directory already mkdir'd and only the prompt.md copy failing.
  assert.equal(
    existsSync(artifactPaths(projectDir).pipelines)
      ? readdirSync(artifactPaths(projectDir).pipelines).length : 0,
    0,
    'no pipeline directory was created',
  );
});

test('MAJ-9: the copyFile fallback no longer masks a vanished file (inline prompt + bad promptFile)', async () => {
  // run-harness passes `promptFile: input.promptFile ?? this.opts.promptFile`, so a
  // caller with BOTH an inline prompt and a promptFile reaches createPipeline's
  // copyFile with a path resolveTaskInput never read. Before the fix that catch
  // silently substituted the inline text for the file the user named.
  const projectDir = tmp();
  await assert.rejects(
    () => createPipeline(projectDir, { prompt: 'inline wins the text', promptFile: 'gone.md' }),
    (err) => {
      assert.equal(err.code, 'PROMPT_FILE_UNREADABLE');
      assert.ok(err.message.includes(join(projectDir, 'gone.md')), err.message);
      return true;
    },
  );
});

test('MAJ-9: an unnamed file still degrades to the empty prompt (no file, no error)', async () => {
  const projectDir = tmp();
  const input = await resolveTaskInput({ type: 'markdown' }, { projectDir });
  assert.deepEqual(input, { promptText: '', promptFile: null, sourceMeta: null });
  const p = await createPipeline(projectDir, { promptText: '', sourceType: 'markdown' });
  assert.equal(await readFile(join(p.dir, 'prompt.md'), 'utf8'), '');
});
