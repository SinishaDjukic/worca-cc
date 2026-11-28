// test/plugin-ai-readiness-chip.test.mjs — the readinessChip script hands the chip's view of the run
// (api.readiness) to the next steps as a json file, and fails clearly on a worca without it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import run from '../plugins/ai-readiness/scripts/readiness-chip.mjs';

const VIEW = { engines: ['claude', 'codex'], labels: { claude: 'Claude Code', codex: 'Codex' }, sources: {}, limits: {}, judged: ['claude'], report: null };

function envelope(readiness) {
  const dir = mkdtempSync(join(tmpdir(), 'air-chip-'));
  const out = join(dir, 'readiness-chip.json');
  return { dir, out, api: { inputs: {}, outputs: { view: { path: out } }, ctx: {}, readiness, log: () => {} } };
}

test('readiness-chip writes the view from api.readiness', async () => {
  const { dir, out, api } = envelope(VIEW);
  try {
    await run(api);
    assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')), VIEW);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('readiness-chip writes a workspace view as it is', async () => {
  const ws = { members: { api: VIEW, web: { ...VIEW, judged: ['codex'] } } };
  const { dir, out, api } = envelope(ws);
  try {
    await run(api);
    assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')), ws);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('readiness-chip fails clearly without api.readiness', async () => {
  const { dir, api } = envelope(null);
  try {
    await assert.rejects(() => run(api), /this worca has no readiness view; update worca/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
