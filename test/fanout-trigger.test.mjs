// test/fanout-trigger.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ctxFanOut, fanOutDirective } from '../src/core/phases.mjs';

test('ctxFanOut: dispatched node fan-out (plan/refine) is honored', () => {
  assert.equal(ctxFanOut({ node: { fanOut: true } }), true);
  assert.equal(ctxFanOut({ node: { fanOut: false } }), false);
  assert.equal(ctxFanOut({ node: {} }), false);
});

test('ctxFanOut: node-less context-level fan-out (clarify pre-step) is honored', () => {
  assert.equal(ctxFanOut({ fanOut: true }), true);
  assert.equal(ctxFanOut({ fanOut: false }), false);
});

test('ctxFanOut: a present node takes precedence over a stray ctx-level flag', () => {
  // A dispatched node decides for itself; the ctx-level flag is only for the
  // node-less clarify path, so node:{fanOut:false} must win over ctx.fanOut:true.
  assert.equal(ctxFanOut({ node: { fanOut: false }, fanOut: true }), false);
});

test('ctxFanOut: missing / malformed ctx is false (never throws)', () => {
  assert.equal(ctxFanOut(undefined), false);
  assert.equal(ctxFanOut(null), false);
  assert.equal(ctxFanOut({}), false);
});

test('fanOutDirective: returns the directive when on, empty string when off', () => {
  assert.equal(fanOutDirective(false), '');
  const d = fanOutDirective(true);
  assert.match(d, /Fan-out ENABLED/);
  assert.match(d, /general-purpose/);
  assert.match(d, /READ-ONLY/);
  assert.match(d, /\.claude\/agents/); // project/personal agents are usable as subagent_type
  assert.match(d, /Skill tool/);       // skills available to the agent AND its sub-agents
});

// Pins the exact expression the generic agent executor inserts:
// `fanOutDirective(ctxFanOut(ctx), ...)` (graph/executor.mjs buildAgentPrompt). A
// living spec of that line + a regression guard on the helpers.
test('implementer fan-out wiring: the expression the executor inserts is gated by the node', () => {
  // Solo (no decomposer): the resolved implementer node carries fanOut.
  assert.match(fanOutDirective(ctxFanOut({ node: { key: 'implementer', fanOut: true } })), /Fan-out ENABLED/);
  // Decomposed: the synthetic task node carries the inherited fanOut (Step 1).
  assert.match(fanOutDirective(ctxFanOut({ node: { key: 'implementer', decomposedTask: true, fanOut: true } })), /Fan-out ENABLED/);
  // Off -> empty string -> the implementer prompt is byte-identical to today.
  assert.equal(fanOutDirective(ctxFanOut({ node: { key: 'implementer', fanOut: false } })), '');
});
