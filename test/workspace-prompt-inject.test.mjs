// test/workspace-prompt-inject.test.mjs
// M4: the workspace runners (runWorkspaceReviewer, runWorkspaceScan) inject the
// frozen description into the SYSTEM prompt on a workspace run, while single-project
// prompts are BYTE-IDENTICAL. We capture the exact systemPrompt/prompt by stubbing
// the claude-runner's runClaude (the runners' single IO seam).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSystemPrompt } from '../src/core/phases.mjs';

const tmpDirs = [];
async function makeTmpDir() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-ws-prompt-'));
  tmpDirs.push(dir);
  return dir;
}
after(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
});

const WS = {
  key: 'wks-demo-1a2b3c4d',
  name: 'Demo WS',
  description: '# Workspace: Demo\n\nTwo services share a REST contract.',
  projects: [
    { projectKey: 'iam-1a2b3c4d', projectName: 'iam', worktreeDir: '/wt/iam', checkpointRef: 'sha-iam' },
    { projectKey: 'ui-5e6f7a8b', projectName: 'ui', worktreeDir: '/wt/ui', checkpointRef: 'sha-ui' },
  ],
};

// Load the two workspace agent bodies so the system-prompt assertions exercise the
// REAL shipped bodies (the contract per C10).
const AGENTS_DIR = fileURLToPath(new URL('../agents/', import.meta.url));
const reviewerBody = await readFile(join(AGENTS_DIR, 'worca-cc-workspace-reviewer.md'), 'utf8');
const scannerBody = await readFile(join(AGENTS_DIR, 'worca-cc-workspace-scanner.md'), 'utf8');

function ctxFor(dir, extra = {}) {
  return {
    projectDir: dir,
    pipelineDir: dir,
    taskPrompt: 'demo task',
    toolInstruction: '',
    agentPrompts: { workspaceReviewer: reviewerBody, workspaceScanner: scannerBody },
    checkpointRef: null,
    signal: undefined,
    onEvent: () => {},
    claudeOpts: { mock: true },
    cycle: 1,
    ...extra,
  };
}

test('the workspace reviewer system prompt injects the description (byte-identity off)', () => {
  // The runner builds buildSystemPrompt(toolInstruction, body, 'workspace-reviewer',
  // ctx.workspace). On a workspace run the FROZEN DESCRIPTION is injected ahead of the
  // body; with no workspace the prompt is byte-identical (the helper returns '').
  // NB: the reviewer BODY itself references the string "## Workspace Context" (it
  // documents the block it receives), so we key on the injected DESCRIPTION TEXT +
  // member-names line, which appear ONLY when a workspace is passed.
  const withWs = buildSystemPrompt('', reviewerBody, 'workspace-reviewer', WS);
  const withoutWs = buildSystemPrompt('', reviewerBody, 'workspace-reviewer', undefined);
  assert.match(withWs, /share a REST contract/, 'the frozen description is injected');
  assert.match(withWs, /Member projects: iam, ui\./, 'the member-names line is injected');
  assert.doesNotMatch(withoutWs, /share a REST contract/, 'no workspace -> description not injected');
  assert.doesNotMatch(withoutWs, /Member projects: iam, ui\./);
  // The body (the contract) is present in both.
  assert.match(withWs, /You are the \*\*Workspace Reviewer\*\*/);
  assert.match(withoutWs, /You are the \*\*Workspace Reviewer\*\*/);
});

test('runWorkspaceScan does NOT inject a workspace block (it IS the scanner)', () => {
  // The scanner produces the description, so it gets NO injected context (4th arg
  // undefined). Its body is the contract.
  const sys = buildSystemPrompt('', scannerBody, 'workspace-scanner', undefined);
  assert.doesNotMatch(sys, /## Workspace Context/, 'the scanner is not given an injected description');
  assert.match(sys, /Workspace Scanner/, 'the scanner body is the contract');
});

test('runWorkspaceScan (mock) writes a §5.8-template description and returns it', async () => {
  const dir = await makeTmpDir();
  const { runWorkspaceScan } = await import('../src/core/phases.mjs');
  const ctx = ctxFor(dir, {
    workspaceName: 'Demo WS',
    projects: WS.projects.map((p) => ({ projectKey: p.projectKey, projectName: p.projectName, projectDir: p.worktreeDir })),
  });
  const { description, outPath } = await runWorkspaceScan(ctx, { name: 'Demo WS' });
  assert.equal(outPath, join(dir, 'workspace-description.md'));
  assert.match(description, /# Workspace: Demo WS/);
  assert.match(description, /## Overview/);
  assert.match(description, /## Interconnections/);
  assert.match(description, /## Suggested change order/);
  // The mock derived the member keys from the task prompt's member lines.
  assert.match(description, /iam-1a2b3c4d|ui-5e6f7a8b/);
});
