// test/ask-projection.test.mjs
// The two projection caps every non-web surface shares, and the one helper that
// renders a persisted ask's ANSWER as text (spec D9, §9). The ask BODY is always
// P1's projectForm — this module never formats it. Pure: no WORCA_HOME, no fs.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PROMPT_PROJECTION_MAX, CHAT_PROJECTION_MAX, askValuesText, askProgress,
} from '../src/core/ask-projection.mjs';

/** A PERSISTED form ask (P2 E13 / X3): the envelope minus `id`, with `values` merged.
 *  What P2 persists is prepareFormAsk's ask (executor.mjs `gate.ask`), which carries NO
 *  `agent` — the executor adds that on the wire only; `agentKey` sits beside the row. */
function persistedAsk(over = {}) {
  return {
    kind: 'form', askId: 'questions-x_n_a_1-r1', form: 'review-mockups', version: 1,
    title: 'Review mockups', surface: 'any',
    data: { summary: 'Two directions.', images: [{ id: 'a', caption: 'Option A' }, { id: 'b', caption: 'Option B' }] },
    layout: [
      { widget: 'markdown', bind: 'data.summary' },
      { widget: 'select', field: 'verdict', label: 'Verdict' },
      { widget: 'textarea', field: 'notes', label: 'What should change?' },
    ],
    answerSchema: { type: 'object', required: ['verdict'], properties: {
      verdict: { type: 'string', enum: ['approve', 'changes'], default: 'approve' },
      notes: { type: 'string', maxLength: 4000 },
    } },
    files: [],
    values: { notes: 'tighten the spacing', verdict: 'changes' },
    ...over,
  };
}

test('the caps are the pinned numbers', () => {
  assert.equal(PROMPT_PROJECTION_MAX, 2000);
  assert.equal(CHAT_PROJECTION_MAX, 1400);
});

test('askValuesText: labels and promptFields ORDER, not the values key order', () => {
  assert.equal(askValuesText(persistedAsk()),
    'Verdict: changes\nWhat should change?: tighten the spacing');
});

test('askValuesText: an unanswered or absent ask is the empty string, never "undefined"', () => {
  assert.equal(askValuesText(persistedAsk({ values: null })), '');
  assert.equal(askValuesText(persistedAsk({ values: {} })), '');
  assert.equal(askValuesText(null), '');
  assert.equal(askValuesText(undefined), '');
  assert.equal(askValuesText({}), '');
});

test('askValuesText: arrays, rank orders and review-list rows all render as text', () => {
  const ask = persistedAsk({
    layout: [
      { widget: 'multiselect', field: 'tags', label: 'Tags' },
      { widget: 'rank', field: 'order', label: 'Order', bind: 'data.images' },
      { widget: 'review-list', field: 'reviews', label: 'Per image', bind: 'data.images' },
      { widget: 'toggle', field: 'ship', label: 'Ship it' },
      { widget: 'number', field: 'count', label: 'Count' },
    ],
    answerSchema: { type: 'object', properties: {
      tags: { type: 'array', items: { type: 'string', enum: ['spacing', 'colour'] } },
      order: { type: 'array', items: { type: 'string' } },
      reviews: { type: 'array', items: { type: 'object', properties: {
        id: { type: 'string' }, verdict: { type: 'string', enum: ['approve', 'changes'] },
        note: { type: 'string' } } } },
      ship: { type: 'boolean' },
      count: { type: 'integer' },
    } },
    values: {
      tags: ['spacing', 'colour'], order: ['b', 'a'],
      reviews: [{ id: 'a', verdict: 'approve' }, { id: 'b', verdict: 'changes', note: 'too dark' }],
      ship: true, count: 3,
    },
  });
  const out = askValuesText(ask);
  assert.match(out, /^Tags: spacing, colour$/m);
  assert.match(out, /^Order: b, a$/m);
  assert.match(out, /^Per image: a: approve; b: changes \(too dark\)$/m);
  assert.match(out, /^Ship it: true$/m);
  assert.match(out, /^Count: 3$/m);
  assert.equal(out.includes('[object Object]'), false, out);
  assert.equal(out.includes('undefined'), false, out);
});

test('askValuesText: a value with no matching input field still prints, by field name', () => {
  const ask = persistedAsk({ values: { verdict: 'approve', legacyLeftover: 'x' } });
  const out = askValuesText(ask);
  assert.match(out, /^Verdict: approve$/m);
  assert.match(out, /^legacyLeftover: x$/m, 'a key promptFields does not know is named, not dropped');
});

test('askProgress: a persisted form round is { projection, values }; a legacy round is null', () => {
  const out = askProgress(persistedAsk());
  assert.match(out.projection, /^Review mockups$/m, 'a persisted row has no agent half — the executor adds `agent` on the wire only');
  assert.match(askProgress({ ...persistedAsk(), agent: 'Designer' }).projection, /^Review mockups — Designer$/m, 'the wire shape still projects it');
  assert.match(out.projection, /Two directions\./);
  assert.match(out.projection, /^1\. Verdict \{verdict\}$/m);
  assert.equal(out.projection.includes('/answer'), false, 'no ref, so no reply line (X9)');
  assert.equal(out.values, 'Verdict: changes\nWhat should change?: tighten the spacing');
  assert.equal(askProgress(persistedAsk({ values: null })).values, '', 'unanswered: empty, never "undefined"');
  assert.equal(askProgress(null), null);
  assert.equal(askProgress({ questions: [] }), null, 'a legacy row has no kind');
});

test('askProgress: the projection is capped at PROMPT_PROJECTION_MAX from the END, and a junk row degrades to the title', () => {
  const big = persistedAsk({
    layout: [{ widget: 'markdown', bind: 'data.summary' }, { widget: 'markdown', bind: 'data.filler' },
      { widget: 'select', field: 'verdict', label: 'Verdict' }],
    data: { summary: 'keep me', filler: 'y'.repeat(9000), images: [] },
  });
  const out = askProgress(big);
  assert.ok(out.projection.length <= PROMPT_PROJECTION_MAX, `${out.projection.length} chars`);
  assert.match(out.projection, /keep me/, 'display text is dropped from the end, so the first block survives');
  assert.equal((out.projection.match(/^…$/gm) || []).length, 1, 'exactly one … marker (X9)');
  // A review-list whose persisted schema lost `items` makes promptFields throw
  // (schema.items.properties) — the row is still reported, by its title.
  const junk = askProgress(persistedAsk({
    layout: [{ widget: 'review-list', field: 'r', bind: 'data.images', label: 'R' }],
    answerSchema: { type: 'object', properties: { r: { type: 'array' } } }, values: {},
  }));
  assert.equal(junk.projection, 'Review mockups', 'projectForm threw on the row; the title stands in');
  assert.equal(junk.values, '', 'askValuesText survives the same row');
});
