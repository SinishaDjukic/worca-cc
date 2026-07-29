// test/sources.test.mjs — the task-source seam (spec §7.3): one resolution path
// for prompt | markdown | plugin, plus source_type/source_ref persistence.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb } from '../src/core/db.mjs';
import { createPipeline } from '../src/core/artifacts.mjs';
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
  // unreadable file degrades to '' exactly like the legacy catch{} path
  const missing = await resolveTaskInput({ type: 'markdown', promptFile: 'notes/absent.md' }, { projectDir });
  assert.equal(missing.promptText, '');
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
      plugin: 'gh', sourceId: 'issues', taskId: 'T-9', url: 'https://tracker.test/T-9', title: 'Fix login',
    });
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
