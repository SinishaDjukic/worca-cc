// read_run_artifact over the real readers: a binary kind or extension is a
// model-actionable AskToolError, never raw bytes or a crash (run-folder-artifacts §7);
// an over-cap text file is paged, not refused.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { createAskTools } from '../src/core/ask/tools.mjs';
import { defaultToolDeps } from '../src/core/ask/tool-deps.mjs';
import { addProject } from '../src/core/projects.mjs';
import { createThread } from '../src/core/ask/store.mjs';
import { recordArtifact, ARTIFACT_READ_MAX_BYTES } from '../src/core/artifacts.mjs';

useTempHome(after);

test('read_run_artifact refuses binary kinds and over-cap files with typed errors; list shows the new kinds', async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'worca-ask-guard-proj-'));
  await addProject({ name: 'guarddemo', path: projectDir });
  const seeded = await seedPipeline(projectDir, { title: 'Guard run', status: 'done' });
  const step = join(seeded.dir, 'steps', 'n_review-c1');
  mkdirSync(step, { recursive: true });
  writeFileSync(join(step, 'shot.png'), Buffer.from([0x89, 0x50]));
  writeFileSync(join(step, 'big.txt'), '');
  await truncate(join(step, 'big.txt'), ARTIFACT_READ_MAX_BYTES + 1);
  writeFileSync(join(step, 'raw.dat'), Buffer.from([0, 1, 2]));
  writeFileSync(join(step, 'impl-review-cycle1.json'), '{"issues":[],"summary":"ok"}\n');
  const attr = { stepKey: 'x:n_review:1', nodeId: 'n_review', cycle: 1 };
  recordArtifact(seeded.id, 'image', 'steps/n_review-c1/shot.png', attr);
  recordArtifact(seeded.id, 'text', 'steps/n_review-c1/big.txt', attr);
  recordArtifact(seeded.id, 'binary', 'steps/n_review-c1/raw.dat', attr);
  recordArtifact(seeded.id, 'verdict', 'steps/n_review-c1/impl-review-cycle1.json', attr);
  const tools = createAskTools(defaultToolDeps({ threadId: createThread().id }));
  await assert.rejects(() => tools.call('read_run_artifact', { runId: seeded.id, relPath: 'steps/n_review-c1/shot.png' }),
    { name: 'AskToolError', message: /shot\.png is binary, not text/ });
  // A binary KIND on an extension the path check does not know: refused by the reader.
  await assert.rejects(() => tools.call('read_run_artifact', { runId: seeded.id, relPath: 'steps/n_review-c1/raw.dat' }),
    { name: 'AskToolError', message: 'read_run_artifact: binary artifact (3 bytes) — not readable as text' });
  // The viewer's 2 MB cap does not apply to Ask: it pages the text itself (a deck's
  // standalone HTML is several MB), so an over-cap text file comes back one page at a time.
  const big = await tools.call('read_run_artifact', { runId: seeded.id, relPath: 'steps/n_review-c1/big.txt' });
  assert.equal(big.totalBytes, ARTIFACT_READ_MAX_BYTES + 1);
  assert.equal(big.truncated, true);
  const verdict = await tools.call('read_run_artifact', { runId: seeded.id, relPath: 'steps/n_review-c1/impl-review-cycle1.json' });
  assert.match(verdict.text, /"summary"/);
  const listed = await tools.call('list_run_artifacts', { runId: seeded.id });
  assert.deepEqual(listed.artifacts.filter((a) => a.nodeId === 'n_review').map((a) => a.kind).sort(), ['binary', 'image', 'text', 'verdict']);
});
