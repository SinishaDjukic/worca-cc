// test/forms-schema.test.mjs — the closed schema dialect and its validator (ask-forms P1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDialect, validate, resolveAnswerSchema, SCHEMA_TYPES } from '../src/shared/forms/schema.mjs';
import { reviewForm, releaseForm } from './helpers/ask-form-fixtures.mjs';

const codes = (r) => r.errors.map((e) => `${e.path}:${e.code}`);
const dialect = (schema, side = 'answer') => checkDialect(schema, { side }).map((e) => `${e.path}|${e.message}`);

test('the fixtures are inside the dialect on their own side', () => {
  for (const f of [reviewForm(), releaseForm()]) {
    assert.deepEqual(checkDialect(f.data, { side: 'data' }), []);
    assert.deepEqual(checkDialect(f.answer, { side: 'answer' }), []);
  }
  assert.deepEqual([...SCHEMA_TYPES], ['string', 'number', 'integer', 'boolean', 'array', 'object', 'file']);
});

test('checkDialect refuses everything outside the subset', () => {
  assert.match(dialect({ type: 'object', properties: { a: { type: 'string', oneOf: [] } } })[0], /unsupported keyword "oneOf"/);
  assert.match(dialect({ type: 'object', properties: { a: { $ref: '#/x' } } }).join(), /unsupported keyword "\$ref"/);
  assert.match(dialect({ type: 'object', properties: { a: { type: 'date' } } })[0], /unknown type "date"/);
  assert.match(dialect({ type: 'object', properties: { f: { type: 'file' } } })[0], /data-side type/);
  assert.match(dialect({ type: 'object', properties: { f: { type: 'string', enumFrom: 'data.x[].id' } } }, 'data')[0], /answer-side keyword/);
  assert.match(dialect({ type: 'object', properties: { f: { type: 'string', enumFrom: 'x.y' } } })[0], /not a valid path/);
  assert.match(dialect({ type: 'object', properties: { f: { type: 'string', enum: [] } } })[0], /non-empty list of scalars/);
  assert.match(dialect({ type: 'object', properties: { f: { type: 'string', enum: ['a'], enumFrom: 'data.x[].id' } } })[0], /not both/);
  assert.match(dialect({ type: 'object', properties: { f: { type: 'string', pattern: '(' } } })[0], /does not compile/);
  assert.match(dialect({ type: 'object', properties: { f: { type: 'string', format: 'ipv4' } } })[0], /unknown format/);
  assert.match(dialect({ type: 'object', properties: { f: { type: 'array' } } })[0], /needs "items"/);
  assert.match(dialect({ type: 'object', required: ['zz'], properties: { f: { type: 'string' } } })[0], /unknown property "zz"/);
  assert.match(dialect({ type: 'object', properties: { f: { type: 'object' } } })[0], /needs "properties"/, 'opaque objects are data-side only');
  assert.deepEqual(dialect({ type: 'object', properties: { f: { type: 'object' } } }, 'data'), []);
});

test('checkDialect: nesting stops at object → array → object', () => {
  const deep = { type: 'object', properties: { rows: { type: 'array', items: { type: 'object', properties: { inner: { type: 'object', properties: { x: { type: 'string' } } } } } } } };
  assert.match(dialect(deep, 'data').join(), /nesting is limited/);
});

test('validate: required, types, bounds, enum, pattern, format, arrays — stable codes', () => {
  const s = { type: 'object', required: ['name', 'n'], properties: {
    name: { type: 'string', minLength: 2, maxLength: 5, pattern: '^[a-z]+$', patternHint: 'Lowercase only.' },
    n: { type: 'integer', minimum: 1, maximum: 5, multipleOf: 2 },
    when: { type: 'string', format: 'date' }, on: { type: 'boolean' },
    tags: { type: 'array', minItems: 1, maxItems: 2, uniqueItems: true, items: { type: 'string', enum: ['x', 'y', 'z'] } } } };
  assert.deepEqual(validate(s, { name: 'ab', n: 2 }), { ok: true, errors: [] });
  assert.deepEqual(codes(validate(s, {})), ['name:required', 'n:required']);
  assert.deepEqual(codes(validate(s, { name: '', n: 2 })), ['name:required'], 'an empty string is missing');
  assert.deepEqual(codes(validate(s, { name: 'A', n: 2 })), ['name:minLength', 'name:pattern']);
  assert.equal(validate(s, { name: 'A1', n: 2 }).errors[0].message, 'Lowercase only.');
  assert.deepEqual(codes(validate(s, { name: 'abcdef', n: 2 })), ['name:maxLength']);
  assert.deepEqual(codes(validate(s, { name: 'ab', n: 2.5 })), ['n:type', 'n:multiple']);
  assert.deepEqual(codes(validate(s, { name: 'ab', n: 7 })), ['n:max', 'n:multiple']);
  assert.deepEqual(codes(validate(s, { name: 'ab', n: 0 })), ['n:min']);
  assert.deepEqual(codes(validate(s, { name: 'ab', n: '2' })), ['n:type']);
  assert.deepEqual(codes(validate(s, { name: 'ab', n: 2, when: '23/09/2026' })), ['when:format']);
  assert.deepEqual(codes(validate(s, { name: 'ab', n: 2, on: 'yes' })), ['on:type']);
  assert.deepEqual(codes(validate(s, { name: 'ab', n: 2, tags: [] })), ['tags:minItems']);
  assert.deepEqual(codes(validate(s, { name: 'ab', n: 2, tags: ['x', 'x'] })), ['tags:unique']);
  assert.deepEqual(codes(validate(s, { name: 'ab', n: 2, tags: ['x', 'y', 'z'] })), ['tags:maxItems']);
  assert.deepEqual(codes(validate(s, { name: 'ab', n: 2, tags: ['q'] })), ['tags[0]:enum']);
  assert.deepEqual(codes(validate(s, { name: 'ab', n: 2, extra: 1 })), ['extra:unknown-key']);
});

test('validate: nested rows and the file type', () => {
  const { data } = reviewForm();
  assert.equal(validate(data, { images: [{ id: 'a', file: 'm/a.png' }] }).ok, true);
  assert.deepEqual(codes(validate(data, { images: [{ id: 'a' }] })), ['images[0].file:required']);
  assert.deepEqual(codes(validate(data, { images: [{ id: 'a', file: 7 }] })), ['images[0].file:type']);
  assert.deepEqual(codes(validate(data, { images: [{ id: 'a', file: 'a\0b' }] })), ['images[0].file:type']);
  assert.deepEqual(codes(validate(data, { images: 'a.png' })), ['images:type']);
  assert.deepEqual(codes(validate({ type: 'object', properties: { blob: { type: 'object' } } }, { blob: { any: [1, 2] } })), [], 'an opaque object takes any JSON');
});

test('resolveAnswerSchema: enumFrom and defaultFrom become concrete, the source is untouched', () => {
  const f = reviewForm();
  const r = resolveAnswerSchema(f.answer, f.example);
  assert.deepEqual(r.properties.picked.enum, ['a', 'b']);
  assert.equal(r.properties.picked.enumFrom, undefined);
  assert.equal(f.answer.properties.picked.enumFrom, 'data.images[].id', 'the declaration is not mutated');
  const rel = releaseForm();
  assert.equal(resolveAnswerSchema(rel.answer, rel.example).properties.version.default, '1.4.0-rc.2');
  assert.equal(resolveAnswerSchema(rel.answer, {}).properties.version.default, undefined, 'a missing source leaves no default');
  assert.deepEqual(resolveAnswerSchema(f.answer, { images: [] }).properties.picked.enum, [], 'no rows → a closed, empty set');
});

test('inherited names are undeclared keys, never schemas; `__proto__` is no property name', () => {
  const s = { type: 'object', required: ['a'], properties: { a: { type: 'string' } } };
  const hostile = JSON.parse('{"a":"x","constructor":1,"toString":2,"__proto__":3}');
  assert.deepEqual(codes(validate(s, hostile)), ['constructor:unknown-key', 'toString:unknown-key', '__proto__:unknown-key']);
  assert.match(dialect({ type: 'object', required: ['toString'], properties: { a: { type: 'string' } } })[0], /unknown property "toString"/);
  assert.match(dialect(JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"}}}'))[0], /"__proto__" cannot be a property name/);
  const own = { type: 'object', required: ['constructor'], properties: { constructor: { type: 'string' } } };
  assert.deepEqual(dialect(own), [], 'a DECLARED property of that name is ordinary');
  assert.deepEqual(codes(validate(own, {})), ['constructor:required'], 'an inherited value does not satisfy `required`');
  assert.deepEqual(codes(validate(own, { constructor: 'x' })), []);
});

test('checkDialect: keyword VALUES are checked, not only keyword names', () => {
  const one = (node, side) => dialect({ type: 'object', properties: { f: node } }, side);
  assert.match(one({ type: 'number', multipleOf: 0 })[0], /"multipleOf" must be greater than 0/);
  assert.match(one({ type: 'number', minimum: '1' })[0], /"minimum" must be a number/);
  assert.match(one({ type: 'string', minLength: -1 })[0], /"minLength" must be a whole number, 0 or more/);
  assert.match(one({ type: 'array', maxItems: 1.5, items: { type: 'string' } })[0], /"maxItems" must be a whole number, 0 or more/);
  assert.match(one({ type: 'string', patternHint: 5 })[0], /"patternHint" must be text/);
  assert.match(one({ type: 'string', title: {} })[0], /"title" must be text/);
  assert.match(one({ type: 'array', uniqueItems: 'yes', items: { type: 'string' } })[0], /"uniqueItems" must be true or false/);
  assert.match(one({ type: 'integer', minimum: 1, default: 'two' })[0], /"default" does not fit its own schema: Must be a number\./);
  assert.match(one({ type: 'string', enum: ['a', 'b'], default: 'c' })[0], /"default" does not fit its own schema/);
  assert.deepEqual(one({ type: 'string', enumFrom: 'data.x[].id', default: 'anything' }), [], 'an enumFrom set is only known at ask time');
  assert.deepEqual(one({ type: 'array', default: ['x'] }).map((m) => m.split('|')[1]), ['an array needs "items"'], 'a broken node is never run against its own default');
});

test('validate: a date is a real calendar date, a date-time a real instant', () => {
  const s = { type: 'object', properties: { d: { type: 'string', format: 'date' }, t: { type: 'string', format: 'date-time' } } };
  for (const d of ['2026-09-21', '2028-02-29', '0099-01-01']) assert.deepEqual(codes(validate(s, { d })), [], d);
  for (const d of ['2026-13-45', '2027-02-29', '2026-00-10', '2026-9-1']) assert.deepEqual(codes(validate(s, { d })), ['d:format'], d);
  for (const t of ['2026-09-21T10:30:00Z', '2026-09-21T10:30+02:00', '2026-09-21T23:59:59.250-05:00']) assert.deepEqual(codes(validate(s, { t })), [], t);
  for (const t of ['2026-09-21T25:00:00Z', '2026-02-30T10:00:00Z', '2026-09-21T10:61:00Z', '2026-09-21 10:30:00Z']) assert.deepEqual(codes(validate(s, { t })), ['t:format'], t);
});

test('checkDialect: a keyword on a type it cannot apply to is refused, not silently ignored', () => {
  const one = (node, side) => dialect({ type: 'object', properties: { f: node } }, side);
  assert.match(one({ type: 'integer', minLength: 2 })[0], /"minLength" does not apply to integer/);
  assert.match(one({ type: 'string', minimum: 1 })[0], /"minimum" does not apply to string/);
  assert.match(one({ type: 'array', enum: ['a'], items: { type: 'string' } })[0], /"enum" does not apply to array/);
  assert.match(one({ type: 'string', items: { type: 'string' } })[0], /"items" does not apply to string/);
  assert.match(one({ type: 'boolean', required: ['x'] })[0], /"required" does not apply to boolean/);
  assert.match(one({ type: 'file', pattern: '^a' }, 'data')[0], /"pattern" does not apply to file/);
  assert.deepEqual(one({ type: 'integer', enum: [1, 2], default: 2, title: 'N', description: 'how many' }), [], 'what applies everywhere still does');
});

test('resolveAnswerSchema: `defaultFrom` feeds a list field from a list, and nothing from null or an empty list', () => {
  const s = { type: 'object', properties: {
    version: { type: 'string', defaultFrom: 'data.suggested' },
    platforms: { type: 'array', items: { type: 'string', enum: ['macos', 'linux'] }, defaultFrom: 'data.platforms' },
    order: { type: 'array', items: { type: 'string' }, defaultFrom: 'data.steps[].id' } } };
  const data = { suggested: null, platforms: ['linux'], steps: [{ id: 's2' }, { id: 's1' }] };
  const r = resolveAnswerSchema(s, data);
  assert.equal(Object.hasOwn(r.properties.version, 'default'), false, 'null is no default (it printed as `default null`)');
  assert.deepEqual(r.properties.platforms.default, ['linux'], "a list field takes the agent's list");
  assert.deepEqual(r.properties.order.default, ['s2', 's1'], 'or a column of its rows');
  r.properties.platforms.default.push('x');
  assert.deepEqual(data.platforms, ['linux'], 'a copy: the stored schema does not alias the data');
  const none = resolveAnswerSchema(s, { platforms: [], steps: [] });
  assert.equal(Object.hasOwn(none.properties.platforms, 'default'), false, 'an empty list suggests nothing: auto mode falls back to the first choice');
  assert.equal(Object.hasOwn(none.properties.order, 'default'), false);
  assert.equal(Object.hasOwn(resolveAnswerSchema(s, { suggested: ['a'] }).properties.version, 'default'), false, 'a text field never takes a list');
  assert.equal(Object.hasOwn(resolveAnswerSchema(s, { platforms: 'linux' }).properties.platforms, 'default'), false, 'and a list field never takes one value');
});

test("checkDialect: `enum` values are of the node's own type", () => {
  const one = (node) => dialect({ type: 'object', properties: { f: node } });
  assert.deepEqual(one({ type: 'integer', enum: ['a'] }), ['f|"enum" values must be of type integer'], 'no answer could ever match it');
  assert.deepEqual(one({ type: 'integer', enum: [1, 2.5] }), ['f|"enum" values must be of type integer']);
  assert.deepEqual(one({ type: 'string', enum: ['a', 1] }), ['f|"enum" values must be of type string']);
  assert.deepEqual(one({ type: 'boolean', enum: ['true'] }), ['f|"enum" values must be of type boolean']);
  assert.deepEqual(one({ type: 'number', enum: [1, 2.5] }), []);
  assert.deepEqual(one({ type: 'integer', enum: [1, 2, 4, 8] }), []);
  assert.deepEqual(one({ type: 'boolean', enum: [true] }), []);
  assert.deepEqual(one({ type: 'string', enum: [] }), ['f|"enum" is a non-empty list of scalars'], 'a malformed list is reported once, as before');
});

test('checkDialect: lists inside lists are capped too — a 5 000-deep schema is refused, not a RangeError', () => {
  let m = { type: 'string' };
  for (let i = 0; i < 5000; i += 1) m = { type: 'array', items: m };
  assert.match(dialect({ type: 'object', properties: { m } }, 'data').join(), /nesting is limited/);
  // the deepest shape the dialect means to allow: object → array → object → a list of scalars
  assert.deepEqual(dialect({ type: 'object', properties: { rows: { type: 'array', items: { type: 'object', properties: { tags: { type: 'array', items: { type: 'string' } } } } } } }, 'data'), []);
  // and one list deeper is past it
  assert.match(dialect({ type: 'object', properties: { rows: { type: 'array', items: { type: 'object', properties: { tags: { type: 'array', items: { type: 'array', items: { type: 'string' } } } } } } } }, 'data').join(), /nesting is limited/);
});
