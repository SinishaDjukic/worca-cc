// test/forms-catalog-paths.test.mjs — the widget catalog and the path language (ask-forms P1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ASK_CATALOG_VERSION, INPUT_WIDGETS, DISPLAY_WIDGETS, LAYOUT_WIDGETS, ASK_LIMITS, COMMON_ITEM_KEYS, LAYOUT_ITEM_KEYS,
  isKnownWidget, widgetClass, widgetAcceptsType,
} from '../src/shared/forms/catalog.mjs';
import { isValidPath, resolvePath, schemaAtPath, pathInSchema } from '../src/shared/forms/paths.mjs';
import { reviewForm } from './helpers/ask-form-fixtures.mjs';

test('catalog v1: 12 input, 12 display, 3 layout names, frozen, limits verbatim', () => {
  assert.equal(ASK_CATALOG_VERSION, 1);
  assert.deepEqual([INPUT_WIDGETS.length, DISPLAY_WIDGETS.length, LAYOUT_WIDGETS.length], [12, 12, 3]);
  for (const t of [INPUT_WIDGETS, DISPLAY_WIDGETS, LAYOUT_WIDGETS, ASK_LIMITS]) assert.ok(Object.isFrozen(t));
  assert.deepEqual({ ...ASK_LIMITS }, { formsPerAgent: 8, askBlockBytes: 65536, filesPerAsk: 24, fileBytes: 26214400, askBytes: 104857600, dataBytes: 262144 });
});

test('LAYOUT_ITEM_KEYS names every catalog widget exactly once', () => {
  const all = [...new Set([...INPUT_WIDGETS, ...DISPLAY_WIDGETS, ...LAYOUT_WIDGETS])].sort();
  assert.deepEqual(Object.keys(LAYOUT_ITEM_KEYS).sort(), all);
  assert.deepEqual([...COMMON_ITEM_KEYS], ['widget', 'field', 'bind', 'label', 'help', 'when', 'requires', 'fallback']);
  assert.ok(LAYOUT_ITEM_KEYS.select.includes('suggest'), '`suggest` is a LAYOUT key of select, never a schema keyword');
  for (const keys of Object.values(LAYOUT_ITEM_KEYS)) assert.ok(Object.isFrozen(keys));
});

test('isKnownWidget / widgetClass: gallery is input only with a field', () => {
  assert.equal(isKnownWidget('review-list'), true);
  assert.equal(isKnownWidget('signature'), false);
  assert.equal(widgetClass('gallery', { field: 'picked' }), 'input');
  assert.equal(widgetClass('gallery', {}), 'display');
  assert.equal(widgetClass('pdf', {}), 'display');
  assert.equal(widgetClass('tabs', {}), 'layout');
  assert.equal(widgetClass('nope', {}), null);
});

test('widgetAcceptsType: the widget/answer-type pairing', () => {
  assert.equal(widgetAcceptsType('toggle', { type: 'boolean' }), true);
  assert.equal(widgetAcceptsType('toggle', { type: 'string' }), false);
  assert.equal(widgetAcceptsType('slider', { type: 'integer' }), true);
  assert.equal(widgetAcceptsType('date', { type: 'string' }), false, 'a date needs format: date');
  assert.equal(widgetAcceptsType('date', { type: 'string', format: 'date' }), true);
  assert.equal(widgetAcceptsType('rank', { type: 'array', items: { type: 'string' } }), true);
  assert.equal(widgetAcceptsType('rank', { type: 'array', items: { type: 'number' } }), false);
  assert.equal(widgetAcceptsType('table-select', { type: 'string' }), true);
  assert.equal(widgetAcceptsType('table-select', { type: 'array', items: { type: 'string' } }), true);
  assert.equal(widgetAcceptsType('review-list', { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, verdict: { type: 'string', enum: ['a'] } } } }), true);
  assert.equal(widgetAcceptsType('review-list', { type: 'array', items: { type: 'string' } }), false);
  assert.equal(widgetAcceptsType('markdown', { type: 'string' }), false, 'display widgets fill nothing');
});

test('isValidPath: data.a.b and data.items[].id, nothing else', () => {
  for (const ok of ['data.summary', 'data.images[].id', 'data.a.b_c', 'data.rows[].cells[].v']) assert.equal(isValidPath(ok), true, ok);
  for (const bad of ['summary', 'data', 'data.', 'data.images[0].id', 'data.a-b', 'data.a..b', 'data.a[]x', '', null, 'data.' + 'a'.repeat(300)]) assert.equal(isValidPath(bad), false, String(bad));
});

test('resolvePath: scalars, columns, missing branches', () => {
  const data = { summary: 'hi', images: [{ id: 'a', file: 'x.png' }, { id: 'b' }, null], meta: { n: 0 } };
  assert.equal(resolvePath('data.summary', { data }), 'hi');
  assert.equal(resolvePath('data.meta.n', { data }), 0);
  assert.deepEqual(resolvePath('data.images[].id', { data }), ['a', 'b']);
  assert.deepEqual(resolvePath('data.images[].file', { data }), ['x.png']);
  assert.equal(resolvePath('data.nope.deeper', { data }), undefined);
  assert.deepEqual(resolvePath('data.nope[].id', { data }), []);
  assert.equal(resolvePath('data.images[0].id', { data }), undefined, 'an invalid path resolves to nothing');
});

test('schemaAtPath / pathInSchema: a path must exist in the declared data schema', () => {
  const { data } = reviewForm();
  assert.equal(schemaAtPath('data.summary', data).type, 'string');
  assert.equal(schemaAtPath('data.images[].file', data).type, 'file');
  assert.equal(schemaAtPath('data.images', data).type, 'array');
  assert.equal(pathInSchema('data.images[].nope', data), false);
  assert.equal(pathInSchema('data.summary[].x', data), false, '[] on a non-array');
  assert.equal(pathInSchema('data.summary[]', data), false, '[] on a non-array, as the last segment');
  assert.equal(pathInSchema('data.images.id', data), false, 'an array needs []');
  const opaque = { type: 'object', properties: { current: { type: 'object' } } };
  assert.equal(pathInSchema('data.current.anything', opaque), true, 'an object without properties is opaque');
});

test('inherited names are never data: constructor / toString / __proto__ are not paths, values or widgets', () => {
  const { data } = reviewForm();
  for (const p of ['data.constructor', 'data.toString', 'data.__proto__', 'data.images[].constructor']) assert.equal(pathInSchema(p, data), false, p);
  assert.equal(resolvePath('data.constructor', { data: {} }), undefined);
  assert.equal(resolvePath('data.toString', { data: { a: 1 } }), undefined);
  assert.deepEqual(resolvePath('data.rows[].valueOf', { data: { rows: [{}, {}] } }), []);
  assert.equal(resolvePath('data.constructor', { data: { constructor: 'mine' } }), 'mine', 'an OWN key of that name is ordinary data');
  assert.equal(widgetAcceptsType('constructor', { type: 'string' }), false, 'no TypeError on an inherited name');
  assert.equal(isKnownWidget('constructor'), false);
});
