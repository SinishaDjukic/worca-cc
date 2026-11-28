// test/intent-leads.test.mjs — the Chat intent leads, shared by the composer and the server's fallback title (run 4, D19).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as shared from '../src/shared/intent-leads.mjs';
import { INTENT_LEADS, stripIntentLead } from '../src/shared/intent-leads.mjs';
import { answererLeadKeys } from '../src/shared/answerer.mjs';
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

// The role line (the composer's role picker): one paragraph right after the Shaper lead, for the model only.
const LEAD = INTENT_LEADS.shape;

test('R-po-1: shapeRoleLine words every lead key the flag allows, and refuses any other', () => {
  assert.equal(shared.SHAPE_ROLE_PREFIX, 'Asking as: ');
  assert.equal(shared.shapeRoleLine('compliance'), 'Asking as: compliance.');
  for (const key of answererLeadKeys({ smallRuns: true })) {
    assert.equal(shared.shapeRoleLine(key), `Asking as: ${key}.`);
    assert.equal(shared.parseShapeRoleLine(`Asking as: ${key}.`), key);
  }
  for (const bad of ['boss', 'release', 'Compliance', 'toString', '', null, undefined]) {
    assert.throws(() => shared.shapeRoleLine(bad), TypeError, String(bad));
  }
});

test('parseShapeRoleLine matches the exact line only', () => {
  assert.equal(shared.parseShapeRoleLine('Asking as: qa.'), 'qa');
  for (const s of ['Asking as: boss.', 'Asking as: toString.', 'Asking as: qa', 'asking as: qa.', 'Asking as: QA.', 'Asking as:  qa.',
    ' Asking as: qa.', 'Asking as: qa. ', 'Asking as: qa.\n', 'Asking as: qa. Please', 'qa', '', null, undefined]) {
    assert.equal(shared.parseShapeRoleLine(s), null, JSON.stringify(s));
  }
});

test('stripIntentLead drops the role paragraph after the Shaper lead (the chat title never shows it)', () => {
  assert.equal(stripIntentLead(`${LEAD}\n\nAsking as: qa.\n\nUploads fail`), 'Uploads fail');
  assert.equal(stripIntentLead(`${LEAD}\n\nAsking as: compliance.`), '');
  assert.equal(stripIntentLead(`${LEAD}\n\nAsking as: ux.\n\nUploads fail\n\nOn large files`), 'Uploads fail\n\nOn large files');
});

test('a typed "Asking as:" anywhere but the exact paragraph right after the Shaper lead is never stripped', () => {
  const keep = (text, want = text) => assert.equal(stripIntentLead(text), want, JSON.stringify(text));
  keep('Asking as: qa.\n\nUploads fail');
  keep('Asking as: qa.');
  keep(`${INTENT_LEADS.run}\n\nAsking as: qa.\n\nx`, 'Asking as: qa.\n\nx');
  keep(`${workflowLead({ id: 'wf_a', name: 'A' })}\n\nAsking as: qa.\n\nx`, 'Asking as: qa.\n\nx');
  keep(`${LEAD}\n\nAsking as: boss.\n\nx`, 'Asking as: boss.\n\nx');
  keep(`${LEAD}\n\nAsking as: qa. And as a user.\n\nx`, 'Asking as: qa. And as a user.\n\nx');
  keep(`${LEAD}\n\nAsking as: qa.\nsame paragraph`, 'Asking as: qa.\nsame paragraph');
  keep(`${LEAD}\n\nx\n\nAsking as: qa.`, 'x\n\nAsking as: qa.');
  keep(`${LEAD}\n\nAsking as: qa.\n\nAsking as: ux.`, 'Asking as: ux.');   // one role paragraph, not every one
});

test('stripping the role line does not read the flag: the same result with the flag off and on', () => {
  const prev = process.env.WORCA_FLAGS;
  const text = `${LEAD}\n\nAsking as: compliance.\n\nUploads fail`;
  try {
    for (const flags of [undefined, 'shaperSmallRuns']) {
      if (flags === undefined) delete process.env.WORCA_FLAGS; else process.env.WORCA_FLAGS = flags;
      assert.equal(stripIntentLead(text), 'Uploads fail', String(flags));
    }
  } finally {
    if (prev === undefined) delete process.env.WORCA_FLAGS; else process.env.WORCA_FLAGS = prev;
  }
});
