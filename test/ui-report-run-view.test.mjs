// test/ui-report-run-view.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderReasonOptions, renderOptIns, previewText, reportBlobParts }
  from '../ui/public/report-run.mjs';
import { OPT_IN_KEYS } from '../src/shared/report-reasons.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;

test('the reason select lists all six, in order, with poor-quality first', () => {
  const opts = renderReasonOptions({ doc });
  assert.equal(opts.length, 6, 'six reasons');
  assert.equal(opts[0].value, 'poor-quality');
  assert.equal(opts[4].value, 'failed-or-stuck', 'the reason the user added in clarify');
  assert.equal(opts[5].value, 'something-else', 'the catch-all is last');
  assert.equal(opts[0].textContent, 'Poor quality', 'human labels, not ids');
});

test('the opt-ins are exactly three checkboxes; the diff and logs are not offered', () => {
  const wrap = renderOptIns({ doc, include: { paths: true, prompt: false, names: false } });
  const boxes = [...wrap.querySelectorAll('input[type="checkbox"]')];
  assert.equal(boxes.length, 3, 'three classes, no more');
  assert.deepEqual(boxes.map((b) => b.dataset.optin), OPT_IN_KEYS);
  assert.equal(boxes[0].checked, true, 'current state is reflected');
  assert.equal(boxes[1].checked, false);
  assert.doesNotMatch(wrap.textContent.toLowerCase(), /\bdiff\b/,
    'the unified diff is never offered');
  assert.doesNotMatch(wrap.textContent.toLowerCase(), /\blog lines\b/,
    'log lines are never offered');
  assert.equal(wrap.querySelector('.hint'), null,
    'hints use .report-optin-hint — .hint is asserted empty across the settings view');
});

test('the preview is the EXACT payload, pretty-printed', () => {
  const payload = { schemaVersion: 1, run: { id: 'abc' } };
  const text = previewText(payload);
  assert.equal(text, JSON.stringify(payload, null, 2),
    'what the reporter reads is byte-identical to what is copied');
  assert.deepEqual(JSON.parse(text), payload, 'and it round-trips');
});

test('previewText degrades honestly when there is no payload yet', () => {
  assert.match(previewText(null), /Building/i, 'a placeholder, never the string "null"');
});

test('reportBlobParts produce valid JSON with a trailing newline', () => {
  const [text] = reportBlobParts({ a: 1 });
  assert.equal(text, '{\n  "a": 1\n}\n');
});
