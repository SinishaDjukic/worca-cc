// T-doc: docs/design/messaging-bus.md has the plan §3 structure and the key phrases.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const doc = readFileSync(fileURLToPath(new URL('../../../docs/design/messaging-bus.md', import.meta.url)), 'utf8');
const HEADINGS = [
  'Summary', 'Entity map', 'Message model', 'Transport abstraction', 'Candidates compared',
  'Agent delivery without extra turns', 'Trust model', 'Migration of cross-chat messaging', 'Phased rollout',
  'Experiments', 'Open questions and known gaps',
];
function section(name) {
  const start = doc.indexOf(`\n## ${name}`);
  assert.ok(start >= 0, name);
  const rest = doc.slice(start + 4);
  const end = rest.search(/^## /m);
  return end >= 0 ? rest.slice(0, end) : rest;
}

test('the 11 headings, in order', () => {
  const found = [...doc.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
  assert.deepEqual(found, HEADINGS);
});

test('entity map names every entity', () => {
  const s = section('Entity map').toLowerCase();
  for (const e of ['run', 'step', 'sub-agent', 'decompose', 'ask chat', 'chat channel', 'schedule', 'actions', 'team metrics', 'team policy', 'e2b', 'websocket']) {
    assert.ok(s.includes(e), e);
  }
});

test('candidate table has every candidate and criterion', () => {
  const s = section('Candidates compared');
  for (const c of ['EventEmitter', 'SQLite outbox + cursors', 'SQLite + fs watcher', 'git-branch', 'NATS', 'Redis Streams', 'Postgres LISTEN/NOTIFY']) assert.ok(s.includes(c), c);
  for (const c of ['Footprint', 'Ordering', 'Delivery guarantee', 'Persistence', 'Multi-host', 'Security boundary', 'Agent token cost']) assert.ok(s.includes(c), c);
  assert.match(s, /not measured: not installed/);
});

test('message model, migration and rollout sections', () => {
  const m = section('Message model');
  for (const w of ['envelope', 'seq', 'origin', 'idempot', 'retention', 'BUS_BAD_TOPIC']) assert.ok(m.toLowerCase().includes(w.toLowerCase()), w);
  const mig = section('Migration of cross-chat messaging');
  for (const w of ['createChatMessenger', 'askDeferred', 'findIncoming', 'send_to_chat', '372ca0f81']) assert.ok(mig.includes(w), w);
  const r = section('Phased rollout');
  for (const w of ['pipeline_commands', 'directions.ndjson', 'P0', 'P1', 'P2', 'P3', 'P4', 'P5']) assert.ok(r.includes(w), w);
  assert.ok(section('Transport abstraction').includes('full mesh'));
});

test('key phrases', () => {
  for (const p of ['agent_id', 'agent.<sessionId>.sub.', 'full mesh', 'at most once', 'computed from a step model', 'shown prefix', 'step-start mark', 'per (consumer, origin)']) {
    assert.ok(doc.includes(p), p);
  }
  assert.match(section('Agent delivery without extra turns'), /never starts a model turn/);
});

test('each experiment has a hypothesis, a metric and a threshold', () => {
  const s = section('Experiments');
  for (const n of [1, 2, 3, 4]) {
    const start = s.indexOf(`### E${n}`);
    assert.ok(start >= 0, `### E${n}`);
    const next = s.indexOf('### E', start + 4);
    const part = s.slice(start, next < 0 ? undefined : next);
    for (const w of ['Hypothesis', 'Metric', 'Threshold']) assert.ok(part.includes(w), `E${n} ${w}`);
  }
});
