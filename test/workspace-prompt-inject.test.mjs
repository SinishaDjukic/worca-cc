// test/workspace-prompt-inject.test.mjs
// M4: the workspace runners (runWorkspaceReviewer; the scanner is a pipeline node now) inject the
// frozen description into the SYSTEM prompt on a workspace run, while single-project
// prompts are BYTE-IDENTICAL. We capture the exact systemPrompt/prompt by stubbing
// the claude-runner's runClaude (the runners' single IO seam).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSystemPrompt } from '../src/core/phases.mjs';

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

test('the scanner body gets no workspace block when none is passed (a scan run passes description "")', () => {
  // The scanner produces the description, so it gets NO injected context (4th arg
  // undefined). Its body is the contract.
  const sys = buildSystemPrompt('', scannerBody, 'workspace-scanner', undefined);
  assert.doesNotMatch(sys, /## Workspace Context/, 'the scanner is not given an injected description');
  assert.match(sys, /Workspace Scanner/, 'the scanner body is the contract');
  // A scan RUN passes the synthetic target with description '' (D9): still no block.
  const scanRun = buildSystemPrompt('', scannerBody, 'workspace-scanner', { ...WS, description: '' });
  assert.doesNotMatch(scanRun, /## Workspace Context/, 'a scan run passes description "": no block');
});
