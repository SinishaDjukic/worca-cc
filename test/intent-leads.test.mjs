// test/intent-leads.test.mjs — the Chat intent leads, shared by the composer and the server's fallback title (run 4, D19).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INTENT_LEADS, stripIntentLead } from '../src/shared/intent-leads.mjs';
import { INTENTS, workflowLead } from '../ui/public/chat/intent.mjs';

test('the composer sends exactly the shared leads', () => {
  assert.deepEqual(Object.keys(INTENTS).sort(), Object.keys(INTENT_LEADS).sort());
  for (const [id, it] of Object.entries(INTENTS)) assert.equal(it.lead, INTENT_LEADS[id], id);
});

test('stripIntentLead drops a lead line and its blank line, and nothing else', () => {
  assert.equal(stripIntentLead(`${INTENT_LEADS.shape}\n\nUploads fail`), 'Uploads fail');
  assert.equal(stripIntentLead(INTENT_LEADS.shape), '');
  assert.equal(stripIntentLead(`${INTENT_LEADS.run}\n\nFix the login`), 'Fix the login');
  assert.equal(stripIntentLead(`${workflowLead({ id: 'wf_acme', name: 'Acme review' })}\n\nCheck docs`), 'Check docs');
  assert.equal(stripIntentLead('Shape this task first, please'), 'Shape this task first, please');
  assert.equal(stripIntentLead(`Uploads fail\n\n${INTENT_LEADS.shape}`), `Uploads fail\n\n${INTENT_LEADS.shape}`);
  assert.equal(stripIntentLead(null), '');
});
