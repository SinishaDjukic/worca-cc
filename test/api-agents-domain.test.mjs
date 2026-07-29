// test/api-agents-domain.test.mjs — registry serialization carries domain
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listAgents } from '../src/core/agent-store.mjs';

test('listAgents() carries domain on every agent', async () => {
  const all = await listAgents();
  assert.ok(all.every((a) => typeof a.domain === 'string' && a.domain.length));
  assert.equal(all.find((a) => a.key === 'workspaceScanner').domain, 'shared');
});
