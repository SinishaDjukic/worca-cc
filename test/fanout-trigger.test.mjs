// test/fanout-trigger.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ctxFanOut, fanOutDirective, buildClarifyPrompt } from '../src/core/phases.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { checkRows } from './helpers/rows.mjs';

test('ctxFanOut: node flag wins, ctx flag for node-less contexts, false for anything malformed', async () => {
  await checkRows([
    { name: 'ctxFanOut: dispatched node fan-out (plan/refine) is honored', run: async () => {
      assert.equal(ctxFanOut({ node: { fanOut: true } }), true);
      assert.equal(ctxFanOut({ node: { fanOut: false } }), false);
      assert.equal(ctxFanOut({ node: {} }), false);
    } },
    { name: 'ctxFanOut: node-less context-level fan-out (clarify pre-step) is honored', run: async () => {
      assert.equal(ctxFanOut({ fanOut: true }), true);
      assert.equal(ctxFanOut({ fanOut: false }), false);
    } },
    { name: 'ctxFanOut: a present node takes precedence over a stray ctx-level flag', run: async () => {
      // A dispatched node decides for itself; the ctx-level flag is only for the
      // node-less clarify path, so node:{fanOut:false} must win over ctx.fanOut:true.
      assert.equal(ctxFanOut({ node: { fanOut: false }, fanOut: true }), false);
    } },
    { name: 'ctxFanOut: missing / malformed ctx is false (never throws)', run: async () => {
      assert.equal(ctxFanOut(undefined), false);
      assert.equal(ctxFanOut(null), false);
      assert.equal(ctxFanOut({}), false);
    } },
  ]);
});

test('the fan-out directive is emitted only when on, and reaches the clarify prompt only then', async () => {
  await checkRows([
    { name: 'fanOutDirective: returns the directive when on, empty string when off', run: () => {
      assert.equal(fanOutDirective(false), '');
      const d = fanOutDirective(true);
      assert.match(d, /Fan-out ENABLED/);
      assert.match(d, /general-purpose/);
      assert.match(d, /READ-ONLY/);
      assert.match(d, /\.claude\/agents/); // project/personal agents are usable as subagent_type
      assert.match(d, /Skill tool/);       // skills available to the agent AND its sub-agents
    } },
    { name: 'buildClarifyPrompt includes the directive only when the ctx has fan-out', run: () => {
      // ctx with no node: ctxFanOut reads ctx.fanOut (the clarify pre-step shape).
      const base = { projectDir: '/tmp/p', pipelineDir: '/tmp/p', taskPrompt: 'Add a delete button' };
      assert.doesNotMatch(buildClarifyPrompt({ ...base, fanOut: false }), /Fan-out ENABLED/);
      assert.match(buildClarifyPrompt({ ...base, fanOut: true }), /Fan-out ENABLED/);
    } },
  ]);
});

test('the built-in agent bodies name no Claude-only sub-agent tool: the Fan-out block names the engine\'s own', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const dir = new URL('../agents/', import.meta.url);
  const bodies = readdirSync(dir).filter((f) => f.endsWith('.md'));
  assert.ok(bodies.length > 10);
  for (const file of bodies) {
    const body = readFileSync(new URL(file, dir), 'utf8');
    for (const token of ['subagent_type', 'run_in_background', 'Task tool', 'Task/Agent', '"general-purpose"', '"Explore"']) {
      assert.equal(body.includes(token), false, `agents/${file} names ${token}`);
    }
  }
});
