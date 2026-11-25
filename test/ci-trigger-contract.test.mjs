// test/ci-trigger-contract.test.mjs
// The workflow trigger contract: the repo has no merge queue (a user-owned repository; queues need an
// organization), so no gating workflow (one with a pull_request trigger) may run on merge_group. If a queue
// is ever chosen, flip MERGE_QUEUE and every gating workflow must then have merge_group (R-arch-6).
// The helpers are pure and exported by this file; the tests fail until they exist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import YAML from 'yaml';

// This repo is a user-owned repository, and merge queues need an organization, so there is no queue.
const MERGE_QUEUE = false;

// The events a workflow starts on: `on` may be one event name, a list of them, or a map keyed by event.
export function triggersOf(doc) {
  const on = doc?.on;
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return on.map(String);
  return on && typeof on === 'object' ? Object.keys(on) : [];
}

// The gating workflows: every one with a pull_request trigger (pull_request_target does not count).
export function gatingWorkflows(docsByFile) {
  return Object.keys(docsByFile).filter((f) => triggersOf(docsByFile[f]).includes('pull_request')).sort();
}

export function triggerContractProblems(docsByFile, { mergeQueue }) {
  const gating = gatingWorkflows(docsByFile);
  const withQueue = gating.filter((f) => triggersOf(docsByFile[f]).includes('merge_group'));
  if (!mergeQueue) return withQueue.map((f) => `${f}: merge_group trigger, but this repo has no merge queue (R-arch-6); remove it or set MERGE_QUEUE`);
  if (withQueue.length === 0) return [];
  return gating.filter((f) => !withQueue.includes(f)).map((f) => `merge_group missing on ${f}: every workflow with a required check must run on merge_group`);
}
const DIR = new URL('../.github/workflows/', import.meta.url);
const realDocs = () => Object.fromEntries(readdirSync(DIR).filter((n) => /\.ya?ml$/.test(n)).map((n) => [n, YAML.parse(readFileSync(new URL(n, DIR), 'utf8'))]));
const exportsOf = async () => {
  const mod = await import(import.meta.url);
  for (const n of ['triggersOf', 'gatingWorkflows', 'triggerContractProblems']) assert.equal(typeof mod[n], 'function', `test/ci-trigger-contract.test.mjs exports ${n}`);
  return mod;
};

test('the gating set is the workflows with a pull_request trigger', async () => {
  const { gatingWorkflows } = await exportsOf();
  assert.deepEqual(gatingWorkflows(realDocs()), ['ci.yml', 'firefox-e2e.yml', 'parity-docker.yml']);
});

test('the real workflows keep the contract', async () => {
  const { triggerContractProblems } = await exportsOf();
  assert.deepEqual(triggerContractProblems(realDocs(), { mergeQueue: MERGE_QUEUE }), []);
});

test('merge_group on ci.yml is rejected while there is no merge queue', async () => {
  const { triggerContractProblems } = await exportsOf();
  const docs = structuredClone(realDocs());
  docs['ci.yml'].on.merge_group = {};
  const p = triggerContractProblems(docs, { mergeQueue: false });
  assert.equal(p.length, 1, JSON.stringify(p));
  assert.match(p[0], /ci\.yml/);
});

test('with a merge queue, merge_group on ci.yml alone names the other two', async () => {
  const { triggerContractProblems } = await exportsOf();
  const docs = structuredClone(realDocs());
  docs['ci.yml'].on.merge_group = {};
  const p = triggerContractProblems(docs, { mergeQueue: true }).join('\n');
  assert.match(p, /firefox-e2e\.yml/);
  assert.match(p, /parity-docker\.yml/);
  for (const f of ['firefox-e2e.yml', 'parity-docker.yml']) docs[f].on.merge_group = {};
  assert.deepEqual(triggerContractProblems(docs, { mergeQueue: true }), []);
});

test('on as a string or a list is read', async () => {
  const { triggersOf } = await exportsOf();
  assert.deepEqual(triggersOf({ on: 'pull_request' }), ['pull_request']);
  assert.deepEqual([...triggersOf({ on: ['push', 'merge_group'] })].sort(), ['merge_group', 'push']);
});
