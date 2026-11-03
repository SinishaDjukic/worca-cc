// test/phases-cold-redispatch.test.mjs — a cold sub-agent is told what happened, never "this session was resumed".
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { runOpts, RESUME_HEADER, COLD_REDISPATCH_HEADER, COLD_FOLLOWUP_HEADER, promptHeaderFor, READ_WRITE_TOOLS } from '../src/core/phases.mjs';
import { makeCtxFor } from './helpers/prompt-ctx.mjs';

useTempHome(after);
const ctxFor = makeCtxFor({ pipelineDir: mkdtempSync(join(tmpdir(), 'cold-p-')), projectDir: mkdtempSync(join(tmpdir(), 'cold-w-')) });
const opts = (over) => runOpts({ ...ctxFor('implementer'), ...over }, { role: 'r', prompt: 'TASK', systemPrompt: 'S', allowedTools: READ_WRITE_TOOLS });

test('no resume id: no header in any mode (byte-identical prompt)', () => {
  for (const sessionMode of [undefined, null, 'subagents', 'shared', 'separate']) assert.ok(opts({ sessionMode }).prompt.startsWith('TASK'), String(sessionMode));
});

test('a re-dispatch in subagents mode gets the cold header; shared and ungrouped keep RESUME_HEADER', () => {
  assert.ok(opts({ resumeSessionId: 'H', sessionMode: 'subagents' }).prompt.startsWith(COLD_REDISPATCH_HEADER + 'TASK'));
  assert.ok(opts({ resumeSessionId: 'H', sessionMode: 'shared' }).prompt.startsWith(RESUME_HEADER + 'TASK'));
  assert.ok(opts({ resumeSessionId: 'H' }).prompt.startsWith(RESUME_HEADER + 'TASK'));
  assert.doesNotMatch(COLD_REDISPATCH_HEADER, /session has been resumed/);
  assert.match(COLD_REDISPATCH_HEADER, /files may already\nexist: check them first/);
});

test('C38 — follow-up rounds say the step asked for input, not that it was interrupted', () => {
  const base = { resumeSessionId: 'H', sessionMode: 'subagents' };
  for (const f of [{ questionsAnswered: [{ id: 'q1' }] }, { formAnswers: [{ form: 'f' }] }, { formRepair: { form: 'f', errors: [] } }, { shapeOutlineNote: { decision: 'flat' } }]) {
    assert.equal(promptHeaderFor({ ...base, ...f }), COLD_FOLLOWUP_HEADER, Object.keys(f)[0]);
  }
  assert.doesNotMatch(COLD_FOLLOWUP_HEADER, /interrupted/);
});

test('C42 — a former member that now runs separate starts fresh with the cold header, never RESUME_HEADER', () => {
  assert.equal(promptHeaderFor({ coldRedispatch: true, sessionMode: 'separate' }), COLD_REDISPATCH_HEADER);
  assert.equal(promptHeaderFor({ coldRedispatch: true, sessionMode: null }), COLD_REDISPATCH_HEADER);
  assert.equal(promptHeaderFor({}), '');
});

test('v4 — a cold re-dispatch in subagents mode with no resume id still tells a follow-up round apart; empty lists are no follow-up', () => {
  assert.equal(promptHeaderFor({ coldRedispatch: true, sessionMode: 'subagents', formAnswers: [{ form: 'f' }] }), COLD_FOLLOWUP_HEADER);
  assert.equal(promptHeaderFor({ coldRedispatch: true, sessionMode: 'subagents' }), COLD_REDISPATCH_HEADER);
  assert.equal(promptHeaderFor({ coldRedispatch: true, sessionMode: 'shared', formAnswers: [{ form: 'f' }] }), COLD_REDISPATCH_HEADER, 'rule 2: only subagents mode reads the follow-up fields');
  assert.equal(promptHeaderFor({ resumeSessionId: 'H', sessionMode: 'subagents', questionsAnswered: [], formAnswers: [] }), COLD_REDISPATCH_HEADER);
});

test('v5 — rule 2 comes before rule 3: a former member with a resume id outside subagents mode still starts cold; no ctx is no header', () => {
  assert.equal(promptHeaderFor({ coldRedispatch: true, resumeSessionId: 'H', sessionMode: 'shared' }), COLD_REDISPATCH_HEADER);
  assert.equal(promptHeaderFor({ coldRedispatch: true, resumeSessionId: 'H' }), COLD_REDISPATCH_HEADER);
  assert.equal(promptHeaderFor(undefined), '');
  assert.equal(promptHeaderFor(null), '');
});
