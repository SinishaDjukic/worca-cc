// test/ask-run-card-cell-model.test.mjs — the Ask chat's live run card labels each agent with the model it RUNS (the manifest cell), not the
// template's authored config.model — the run page's graph does (run-hosts.mjs modelOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { snapshotFromState, createRunProgressCard } from '../ui/public/ask-run-card.mjs';

const agent = (id, key, over = {}) => ({
  id, kind: 'agent', key, x: 0, y: 0, label: key[0].toUpperCase() + key.slice(1), color: 'violet',
  ports: { inputs: [{ id: 'task', type: 'md', loop: false }], outputs: [{ id: 'out', type: 'md', when: 'always' }], await: true }, ...over,
});
const END = { id: 'n_end', kind: 'end', key: null, x: 0, y: 0, label: 'End', color: '', ports: { inputs: [{ id: 'result', type: 'any' }], outputs: [], await: false } };
// A saved workflow whose template names Opus on the planner; THIS run's overlay (or a project pick) ran Haiku there.
const MANIFEST = { version: 2, template: { id: 'wf_t', name: 'T' }, graph: {
  nodes: [agent('n_plan', 'planner', { config: { model: 'claude-opus-5-5', effort: 'max' }, model: 'claude-haiku-4-5', effort: '' }), END],
  wires: [{ id: 'w2', from: { node: 'n_plan', port: 'out' }, to: { node: 'n_end', port: 'result' }, loop: false }] },
  bookends: { preflight: true, done: true }, runOverlay: { nodes: { n_plan: { model: 'claude-haiku-4-5', effort: '' } } } };
const STATE = { id: 'abcd1234', title: 'Fix login', projectKey: 'proj-00000001', projectDir: '/repos/proj', status: 'running', stepper: MANIFEST,
  steps: [], active: [], totalCostUsd: 0, totalActiveMs: 0, startedAt: '2026-09-07T10:00:00Z' };
const IDENT = { cardId: 'card_00000001', pipelineId: 'abcd1234', runId: 'run-uuid-1', projectKey: 'proj-00000001', workspaceId: null, title: 'Fix login', label: 'proj' };

test('the chat run card names the model the node runs (the manifest cell), never the template\'s authored one', () => {
  const doc = new JSDOM('<!doctype html><html><body></body></html>').window.document;
  const card = createRunProgressCard({ doc, ident: IDENT });
  doc.body.appendChild(card.el);
  card.update({ ...snapshotFromState(STATE, { now: 0 }), source: 'live', runId: 'run-uuid-1' }, 0);
  const metas = [...card.el.querySelectorAll('.ask-rc-graph .lm')].map((e) => e.textContent);
  assert.deepEqual(metas, ['claude-haiku-4-5']);
  card.destroy();
});
