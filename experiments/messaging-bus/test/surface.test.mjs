// T-surface: shared-interface surfaces and their breaking diffs (plan §3.3 "What counts", §4.2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classify, surfaceOf, diffSurface, jsSurface, sqlSurface } from '../lib/surface.mjs';

/** The changes between two texts of one file, as `name:change:breaking` strings. */
function changes(path, a, b) {
  const kind = classify(path, b);
  const sa = a === null ? null : surfaceOf(kind, path, a);
  const sb = surfaceOf(kind, path, b);
  assert.ok(sb.ok, `${path} parses`);
  return diffSurface(kind, sa ? sa.surface : null, sb.surface).map((c) => `${c.name}:${c.change}:${c.breaking}`);
}
const breaking = (path, a, b) => changes(path, a, b).filter((c) => c.endsWith(':true'));

test('classify: JS/TS, SQL, JSON schema, config, and none for tests, docs, data', () => {
  for (const p of ['a.js', 'a.mjs', 'a.cjs', 'a.jsx', 'a.ts', 'a.tsx', 'a.mts', 'a.cts']) assert.equal(classify(p), 'js', p);
  assert.equal(classify('db/001.sql'), 'sql');
  assert.equal(classify('api/user.schema.json'), 'json-schema');
  assert.equal(classify('data/x.json', '{"$schema":"http://json-schema.org/draft-07/schema#","type":"object"}'), 'json-schema');
  assert.equal(classify('package.json', '{}'), 'config');
  assert.equal(classify('tsconfig.base.json', '{}'), 'config');
  assert.equal(classify('app.config.json', '{}'), 'config');
  assert.equal(classify('config/limits.json', '{}'), 'config');
  assert.equal(classify('schemas/ids.json', '{}'), 'config');
  assert.equal(classify('data/fixtures.json', '{"a":1}'), 'none');
  assert.equal(classify('src/a.test.mjs'), 'none');
  assert.equal(classify('test/helpers/x.mjs'), 'none');
  assert.equal(classify('README.md'), 'none');
  assert.equal(classify('ui/style.css'), 'none');
  assert.equal(classify('tool.py'), 'none');
});

test('js: signature change, removal and rename are breaking; an added export is not', () => {
  const v1 = 'export function price(item) {\n  return item.cost;\n}\nexport const TAX = 0.2;\n';
  assert.deepEqual(breaking('lib.mjs', v1, v1.replace('price(item)', 'price(item, opts)')), ['price:signature:true']);
  assert.deepEqual(breaking('lib.mjs', v1, v1.replace('export const TAX = 0.2;\n', '')), ['TAX:removed:true']);
  assert.deepEqual(breaking('lib.mjs', v1, v1.replace('function price', 'function cost')), ['price:renamed:true']);
  assert.deepEqual(changes('lib.mjs', v1, v1 + 'export function extra(a) {}\n'), ['extra:added:false']);
});

test('js: body-only, comment-only and reformatted params give no change', () => {
  const v1 = 'export function price(item, opts) {\n  return item.cost;\n}\n';
  assert.deepEqual(changes('lib.mjs', v1, v1.replace('item.cost', 'item.cost * 2')), []);
  assert.deepEqual(changes('lib.mjs', v1, '// price helper\n' + v1.replace('{\n', '{ // body\n')), []);
  assert.deepEqual(changes('lib.mjs', v1, 'export function price(\n  item, /* the item */\n  opts,\n) {\n  return item.cost;\n}\n'), []);
  assert.deepEqual(changes('lib.mjs', v1, v1 + 'function helper(x) { return x; }\n'), []);
});

test('js: arrow consts, classes, default, export lists, star, CommonJS and TS declarations', () => {
  assert.deepEqual(breaking('a.mjs', 'export const f = (a) => a;\n', 'export const f = (a, b) => a;\n'), ['f:signature:true']);
  assert.deepEqual(breaking('a.mjs', 'export const f = async function (a) {};\n', 'export const f = async function (a, b) {};\n'), ['f:signature:true']);
  assert.deepEqual(breaking('a.mjs', 'export class Cart extends Base {}\n', 'export class Cart extends Other {}\n'), ['Cart:signature:true']);
  assert.deepEqual(breaking('a.mjs', 'export default function main(a) {}\n', 'export default function main(a, b) {}\n'), ['default:signature:true']);
  assert.deepEqual(breaking('a.mjs', "export { a, b as c } from './x.mjs';\n", "export { a } from './x.mjs';\n"), ['c:removed:true']);
  assert.deepEqual(breaking('a.mjs', "export * from './x.mjs';\n", "export * from './y.mjs';\n"), ["* from './x.mjs':renamed:true"]);
  assert.deepEqual(breaking('a.cjs', 'module.exports = { a, b };\n', 'module.exports = { a };\n'), ['module.exports:signature:true']);
  assert.deepEqual(breaking('a.cjs', 'exports.run = function (a) {};\n', 'exports.run = function (a, b) {};\n'), ['run:signature:true']);
  assert.deepEqual(breaking('a.ts', 'export interface Item {\n  id: string;\n  cost: number;\n}\n', 'export interface Item {\n  id: string;\n  cost: string;\n}\n'), ['Item:signature:true']);
  assert.deepEqual(changes('a.ts', 'export interface Item {\n  id: string;\n  cost: number;\n}\n', 'export interface Item { id: string; cost: number }\n'), []);
  assert.deepEqual(breaking('a.ts', 'export type Id = string;\n', 'export type Id = number;\n'), ['Id:signature:true']);
  assert.deepEqual(breaking('a.ts', 'export enum Mode { A, B }\n', 'export enum Mode { A }\n'), ['Mode:signature:true']);
});

test('sql: drop/rename table or column, type change and a NOT NULL column without default are breaking', () => {
  const v1 = 'CREATE TABLE users (\n  id INTEGER PRIMARY KEY,\n  name TEXT NOT NULL,\n  age INTEGER\n);\n';
  assert.deepEqual(breaking('m.sql', v1, v1 + 'ALTER TABLE users DROP COLUMN age;\n'), ['users.age:removed:true']);
  assert.deepEqual(breaking('m.sql', v1, v1 + 'ALTER TABLE users RENAME COLUMN age TO years;\n'), ['users.age:renamed:true']);
  assert.deepEqual(breaking('m.sql', v1, v1.replace('age INTEGER', 'age TEXT')), ['users.age:type:true']);
  assert.deepEqual(breaking('m.sql', v1, v1 + 'ALTER TABLE users ADD COLUMN email TEXT NOT NULL;\n'), ['users.email:required:true']);
  assert.deepEqual(changes('m.sql', v1, v1 + "ALTER TABLE users ADD COLUMN email TEXT NOT NULL DEFAULT '';\n"), ['users.email:added:false']);
  assert.deepEqual(breaking('m.sql', v1, v1 + 'DROP TABLE IF EXISTS users;\n'), ['users:removed:true']);
  assert.deepEqual(changes('m.sql', v1, v1.replace('name TEXT NOT NULL', 'name   TEXT   NOT NULL')), []);
});

test('sql inside a JS template string is part of the JS surface', () => {
  const a = 'export function migrate(db) {\n  db.exec(`CREATE TABLE t (id INTEGER, label TEXT)`);\n}\n';
  assert.deepEqual(breaking('db.mjs', a, a.replace(', label TEXT', '')), ['t.label:removed:true']);
  assert.deepEqual(jsSurface(a).sql, sqlSurface('CREATE TABLE t (id INTEGER, label TEXT)'));
});

test('json schema: removed property, type change and newly required are breaking', () => {
  const s = (props, required = []) => JSON.stringify({ $schema: 'x', type: 'object', properties: props, required });
  const v1 = s({ id: { type: 'string' }, tags: { type: 'array' } }, ['id']);
  assert.deepEqual(breaking('a.schema.json', v1, s({ id: { type: 'string' } }, ['id'])), ['tags:removed:true']);
  assert.deepEqual(breaking('a.schema.json', v1, s({ id: { type: 'number' }, tags: { type: 'array' } }, ['id'])), ['id:type:true']);
  assert.deepEqual(breaking('a.schema.json', v1, s({ id: { type: 'string' }, tags: { type: 'array' } }, ['id', 'tags'])), ['tags:required:true']);
  assert.deepEqual(changes('a.schema.json', v1, s({ id: { type: 'string' }, tags: { type: 'array' }, x: { type: 'string' } }, ['id'])), ['x:added:false']);
});

test('config: package.json named fields and dependency keys; generic config key paths', () => {
  const pkg = (o) => JSON.stringify({ name: 'p', version: '1.0.0', scripts: { t: 'x' }, ...o });
  const v1 = pkg({ exports: { '.': './a.mjs' }, dependencies: { ws: '8', yaml: '2' } });
  assert.deepEqual(breaking('package.json', v1, pkg({ exports: { '.': './b.mjs' }, dependencies: { ws: '8', yaml: '2' } })), ['exports:signature:true']);
  assert.deepEqual(breaking('package.json', v1, pkg({ exports: { '.': './a.mjs' }, dependencies: { ws: '8' } })), ['dependencies.yaml:removed:true']);
  assert.deepEqual(changes('package.json', v1, pkg({ version: '2.0.0', exports: { '.': './a.mjs' }, dependencies: { ws: '9', yaml: '2' } })), []);
  assert.deepEqual(breaking('tsconfig.json', '{"compilerOptions":{"module":"esnext","strict":true}}', '{"compilerOptions":{"module":"commonjs","strict":false}}'), ['compilerOptions.module:signature:true']);
  assert.deepEqual(breaking('config/limits.json', '{"a":{"b":1,"c":"x"}}', '{"a":{"b":"1"}}'), ['a.b:type:true', 'a.c:removed:true']);
  assert.deepEqual(changes('config/limits.json', '{"a":{"b":1}}', '{"a":{"b":2}}'), []);
});

test('unparsable JSON → ok:false; a created file diffs as all-added', () => {
  assert.deepEqual(surfaceOf('config', 'config/x.json', '{"a": '), { ok: false });
  assert.deepEqual(changes('lib.mjs', null, 'export function a(x) {}\n'), ['a:added:false']);
});

/** CPU ms (user + system) of the best of 3 runs, after a warm-up. CPU time, not wall time: a busy host cannot fail it. */
function cpuMs(p, text) {
  const kind = classify(p, text);
  surfaceOf(kind, p, text);
  let best = Infinity;
  for (let r = 0; r < 3; r++) {
    const c0 = process.cpuUsage();
    surfaceOf(kind, p, text);
    const c = process.cpuUsage(c0);
    best = Math.min(best, (c.user + c.system) / 1000);
  }
  return best;
}

test('linear time: 4× the input costs at most 8× the CPU, and 1 MB of any shape stays under 1 s of CPU', () => {
  const unit = 'export function f0(a, b) {\n  return `x${a}` + "(" + b; // c\n}\n/* block */\nconst y = [1, 2, 3];\n';
  const rep = (u) => (n) => u.repeat(Math.ceil(n / u.length)).slice(0, n);
  const lines = (f) => (n) => { const out = []; let len = 0; for (let i = 0; len < n; i++) { const l = f(i); out.push(l); len += l.length; } return out.join(''); };
  const cases = [
    ['big.mjs', rep(unit)],
    ['p.mjs', (n) => 'export function f' + '('.repeat(n / 10)],
    ['p.mjs', (n) => '('.repeat(n / 10)],
    ['p.sql', (n) => 'CREATE TABLE t ' + '('.repeat(n / 10)],
    ['p.sql', rep('CREATE TABLE t (a INT);\n')],
    // every statement names its own table (M4): a per-CREATE walk over all keys is quadratic
    ['p.sql', lines((i) => `CREATE TABLE t${i} (a INT, b INT);\n`)],
    ['p.sql', lines((i) => `CREATE TABLE t${i}\n`)],
    ['p.mjs', lines((i) => `db.exec(\`CREATE TABLE t${i} (a INT, b INT)\`);\n`)],
    ['p.ts', rep('export interface I\n')],
    ['p.ts', rep('export type T =\n')],
    ['p.mjs', rep('export default a ||\n')],
    // a `/` that may open a regex scans a capped window, not to the end of the line (review c2 major 2)
    ['p.mjs', rep('= /[')],
    ['p.mjs', rep('(/[')],
    ['p.mjs', (n) => 'const t = `${' + '(/['.repeat(n / 3)],
    // an unfinished declaration resumes after itself, never rescans the rest of the file
    ['p.ts', rep('export type T = (\n')],
    ['p.ts', rep('export enum E {\n')],
  ];
  for (const [p, gen] of cases) {
    const small = cpuMs(p, gen(250_000));
    const big = cpuMs(p, gen(1_000_000));
    const label = `${p} ${JSON.stringify(gen(40))}: ${small.toFixed(1)} ms at 250 KB, ${big.toFixed(1)} ms at 1 MB`;
    assert.ok(big <= 8 * Math.max(small, 10), `not linear: ${label}`);
    assert.ok(big <= 1000, `too slow: ${label}`);
  }
});

test('sql: comments are not columns, and a comment cannot hide or drop a table (M5)', () => {
  const t = (c) => `CREATE TABLE w (id INT, -- JSON: [ ${c} ]\n g TEXT);\n`;
  assert.deepEqual(sqlSurface(t('{id,from,to}')), { w: '§table', 'w.id': 'INT', 'w.g': 'TEXT' });
  assert.deepEqual(changes('m.sql', t('{id,from,to}'), t('{id,source,target}')), []);
  // a comma in a comment does not end the column: the type change after it is still seen
  const c1 = 'CREATE TABLE u (\n  age INTEGER /* years, not months */ NOT NULL,\n  n TEXT\n);\n';
  assert.deepEqual(breaking('m.sql', 'CREATE TABLE u (\n  age /* a, b */ INTEGER,\n  n TEXT\n);\n', 'CREATE TABLE u (\n  age /* a, b */ TEXT,\n  n TEXT\n);\n'), ['u.age:type:true']);
  assert.deepEqual(sqlSurface(c1), { u: '§table', 'u.age': 'INTEGER|nn', 'u.n': 'TEXT' });
  // an open paren in a comment does not unbalance the table
  const v1 = 'CREATE TABLE p (\n  id INT,\n  n TEXT\n);\n';
  assert.deepEqual(changes('m.sql', v1, v1.replace('id INT,', 'id INT, -- see (the docs')), []);
  assert.deepEqual(changes('m.sql', v1, v1.replace('id INT,', 'id INT, /* (( */')), []);
  // a commented-out statement is not a statement; a quoted `--` is not a comment
  assert.deepEqual(changes('m.sql', v1, v1 + '-- DROP TABLE p;\n/* ALTER TABLE p DROP COLUMN n; */\n'), []);
  assert.deepEqual(sqlSurface("CREATE TABLE q (a TEXT DEFAULT '--', b INT);\n"), { q: '§table', 'q.a': 'TEXT|def', 'q.b': 'INT' });
  // inside a JS template the same holds, and a glob string is not a block comment
  const js = (c) => `const G = ['src/**/*.mjs'];\nexport function migrate(db) {\n  db.exec(\`CREATE TABLE w (id INT, -- ${c}\n    g TEXT)\`);\n}\nconst H = ['lib/**/*.mjs'];\n`;
  assert.deepEqual(jsSurface(js('{a,b}')).sql, { w: '§table', 'w.id': 'INT', 'w.g': 'TEXT' });
  assert.deepEqual(changes('db.mjs', js('{a,b}'), js('{c,d,e} (')), []);
});

test('js: a regex literal with a quote, a backtick or a bracket does not mask the rest of the file (M6)', () => {
  const body = 'export function a(x) {}\nexport function b(y) {}\n';
  for (const re of ['/`/', "/'/", '/"/g', '/[/"\'`]/g', '/[/\\`]/', '/\\//', '/[(]/', '/a{/']) {
    for (const lead of ['const R = ', 'f(', 'return ', 'x = y || ', 'typeof ', '[', 'a ? b : ', 'if (x) {} ']) {
      const src = `${lead}${re};\n${body}`;
      assert.deepEqual(Object.keys(jsSurface(src).exports), ['a', 'b'], src);
    }
    assert.deepEqual(changes('lib.mjs', body, `const TICK = ${re};\n${body}`), [], re);
  }
  // a division is not a regex: the string after it is still a string
  const div = 'const r = a / b; const s = "x/y {"; const t = (a + b) / 2; const u = n / m / k; const q = "(";\n';
  assert.deepEqual(Object.keys(jsSurface(div + body).exports), ['a', 'b']);
  // two divisions on one line around a quoted slash: read as a regex, the backtick string would run to the end
  assert.deepEqual(Object.keys(jsSurface('const h = n / 2, s = "/", k = "`";\n' + body).exports), ['a', 'b']);
  // nested templates: the inner backticks do not end the outer template
  const tpl = 'const t = `a${ `b${ c ? `{` : "}" }` }d ( `;\n';
  assert.deepEqual(Object.keys(jsSurface(tpl + body).exports), ['a', 'b']);
  assert.deepEqual(changes('lib.mjs', body, tpl + body), []);
  // a backtick inside a string inside `${ }` is not the template's end
  assert.deepEqual(Object.keys(jsSurface('const u = `a${ "`" }b`;\n' + body).exports), ['a', 'b']);
  assert.deepEqual(Object.keys(jsSurface('const doc = `${ "`" }\nexport function ghost() {}\n`;\n' + body).exports), ['a', 'b']);
  // a regex literal or a comment inside `${ }` holding a quote or a backtick does not hide later exports (review c2 major 1)
  for (const line of [
    'const q = `"${s.replace(/"/g, "")}"`;\n',
    'const q = `${s.replace(/`/g, "")}`;\n',
    'const q = `${ f(/[`]/) }`;\n',
    'const q = `${ x /* ` */ }`;\n',
    'const q = `${ x // `\n }`;\n',
    'const q = `${ a / b }${ "`" }`;\n',
    'const q = `${ a / 2 }px`; const p = n / 2;\n',
  ]) {
    assert.deepEqual(Object.keys(jsSurface(line + body).exports), ['a', 'b'], line);
    assert.deepEqual(changes('lib.mjs', body, line + body), [], line);
  }
});

test('js: this module\'s own source (regex literals holding quotes) gives its whole export list', () => {
  const src = readFileSync(new URL('../lib/surface.mjs', import.meta.url), 'utf8');
  assert.deepEqual(Object.keys(jsSurface(src).exports).sort(),
    ['blankSqlComments', 'classify', 'configSurface', 'diffSurface', 'jsSurface', 'jsonSchemaSurface', 'maskSource', 'matchBrackets', 'normSig', 'sqlSurface', 'surfaceOf']);
});

test('js: an unfinished declaration does not swallow the export on the next line', () => {
  assert.deepEqual(Object.keys(jsSurface('export type T =\nexport function f(a) {}\n').exports), ['T', 'f']);
});

test('js: a secret in a long signature is masked before the surface is cut to its cap', () => {
  const key = `ghp_${'A1b2'.repeat(9)}`;
  const sig = jsSurface(`export function f(${'p'.repeat(380)}, k = "${key}") {}\n`).exports.f;
  assert.ok(sig.length <= 400);
  assert.ok(!sig.includes('ghp_'), sig.slice(-40));
});
