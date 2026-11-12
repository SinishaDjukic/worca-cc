// experiments/messaging-bus/lib/trace-corpus.mjs — E5's scripted tool-call traces (plan §4.9).
// Each case: a temp repo `setup`, the publisher's task, and its tool calls. Contract cases carry the facts a
// correct detector must publish; ordinary cases must publish nothing; behaviour cases pin the
// coalescing, revert, debounce and loop rules by message count. Stated bias: the corpus and the
// detector come from the same author (E7's real replay is the out-of-sample check).
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const VARIANTS = 2; // contract cases per category
const ORDINARY = 5; // ordinary cases per category

const edit = (file, old_string, new_string, who) => ({ event: 'PostToolUse', tool: 'Edit', input: { file_path: file, old_string, new_string }, who });
const write = (file, content, who) => ({ event: 'PostToolUse', tool: 'Write', input: { file_path: file, content }, who });
const read = (file, who) => ({ event: 'PostToolUse', tool: 'Read', input: { file_path: file }, who });
const bash = (command, bashEffect, who) => ({ event: 'PostToolUse', tool: 'Bash', input: { command }, bashEffect, who });
const fx = (file, fn) => (dir) => {
  const p = join(dir, file);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, fn(readFileSync(p, 'utf8')));
};
const map = (own, sib = ['sib/b.mjs', 'sib/b2.mjs']) => ({ v: 1, tasks: {
  a: { title: 'A', file: 'tasks/a.md', files: own, parsed: true },
  b: { title: 'B', file: 'tasks/b.md', files: sib, parsed: true },
} });
const SIB = { 'sib/b.mjs': 'export function total(items) {\n  return items.length;\n}\n', 'sib/b2.mjs': 'export const B2 = 1;\n' };
// built at run time so the corpus file holds no secret-shaped literal
const fakeKey = () => `sk-ant-${'k'.repeat(32)}`;

function contract(id, { files, own, calls, expect }) {
  return { id, label: 'contract', expect, setup: { files: { ...SIB, ...files } }, taskId: 'a', taskMap: map(own ?? Object.keys(files)), calls };
}
function ordinary(id, { files, own, calls }) {
  return { id, label: 'ordinary', expect: [], setup: { files: { ...SIB, ...files } }, taskId: 'a', taskMap: map(own ?? Object.keys(files)), calls };
}

const CONTRACT = {
  signature: (i) => {
    const f = `src/price${i}.mjs`;
    const v1 = `export function price${i}(item) {\n  return item.cost;\n}\n`;
    const neu = i === 0 ? `price${i}(item, opts)` : `price${i}(item, token = "${fakeKey()}")`;
    return { files: { [f]: v1 }, calls: [edit(f, `price${i}(item)`, neu)], expect: [{ reason: 'export', file: f, names: [`price${i}`] }] };
  },
  removed: (i) => {
    const f = `src/tax${i}.mjs`;
    return { files: { [f]: `export function a${i}() {}\nexport function tax${i}(x) {}\n` }, calls: [edit(f, `export function tax${i}(x) {}\n`, '')], expect: [{ reason: 'export', file: f, names: [`tax${i}`] }] };
  },
  rename: (i) => {
    const f = `src/user${i}.mjs`;
    return { files: { [f]: `export async function fetchUser${i}(id) {\n  return id;\n}\n` }, calls: [edit(f, `fetchUser${i}`, `loadUser${i}`)], expect: [{ reason: 'export', file: f, names: [`fetchUser${i}`, `loadUser${i}`] }] };
  },
  'ts-interface': (i) => {
    const f = `src/item${i}.ts`;
    return { files: { [f]: `export interface Item${i} {\n  id: string;\n  cost: number;\n}\n` }, calls: [edit(f, 'cost: number;', 'cost: string;')], expect: [{ reason: 'export', file: f, names: [`Item${i}`] }] };
  },
  'ts-type': (i) => {
    const f = `src/ids${i}.ts`;
    return { files: { [f]: `export type Id${i} = string;\n` }, calls: [edit(f, '= string', '= number')], expect: [{ reason: 'export', file: f, names: [`Id${i}`] }] };
  },
  default: (i) => {
    const f = `src/main${i}.mjs`;
    return { files: { [f]: `export default function main${i}(argv) {\n  return argv;\n}\n` }, calls: [edit(f, `main${i}(argv)`, `main${i}(argv, env)`)], expect: [{ reason: 'export', file: f, names: ['default'] }] };
  },
  'export-list': (i) => {
    const f = `src/index${i}.mjs`;
    return { files: { [f]: `const a = 1;\nconst b${i} = 2;\nexport { a, b${i} };\n` }, calls: [edit(f, `export { a, b${i} };`, 'export { a };')], expect: [{ reason: 'export', file: f, names: [`b${i}`] }] };
  },
  'module-exports': (i) => {
    const f = `src/legacy${i}.cjs`;
    return { files: { [f]: `function a() {}\nfunction b() {}\nmodule.exports = { a, b };\n` }, calls: [edit(f, 'module.exports = { a, b };', 'module.exports = { a };')], expect: [{ reason: 'export', file: f, names: ['module.exports'] }] };
  },
  'sql-drop-rename': (i) => {
    const f = `db/00${i}.sql`;
    const v1 = 'CREATE TABLE users (\n  id INTEGER PRIMARY KEY,\n  age INTEGER\n);\n';
    const stmt = i === 0 ? 'ALTER TABLE users DROP COLUMN age;\n' : 'ALTER TABLE users RENAME COLUMN age TO years;\n';
    return { files: { [f]: v1 }, calls: [edit(f, ');\n', `);\n${stmt}`)], expect: [{ reason: 'sql', file: f, names: ['users.age'] }] };
  },
  'sql-not-null': (i) => {
    const f = `db/01${i}.sql`;
    return { files: { [f]: 'CREATE TABLE orders (\n  id INTEGER PRIMARY KEY\n);\n' }, calls: [edit(f, ');\n', `);\nALTER TABLE orders ADD COLUMN ref${i} TEXT NOT NULL;\n`)], expect: [{ reason: 'sql', file: f, names: [`orders.ref${i}`] }] };
  },
  'json-schema': (i) => {
    const f = `api/user${i}.schema.json`;
    const s = (props, req) => JSON.stringify({ $schema: 'x', type: 'object', properties: props, required: req }, null, 2) + '\n';
    const v1 = s({ id: { type: 'string' }, nick: { type: 'string' } }, ['id']);
    const v2 = i === 0 ? s({ id: { type: 'string' } }, ['id']) : s({ id: { type: 'string' }, nick: { type: 'string' } }, ['id', 'nick']);
    return { files: { [f]: v1 }, calls: [write(f, v2)], expect: [{ reason: 'json-schema', file: f, names: ['nick'] }] };
  },
  'package-exports': (i) => {
    const f = i === 0 ? 'package.json' : `packages/p${i}/package.json`;
    const pkg = (target) => JSON.stringify({ name: `p${i}`, version: '1.0.0', exports: { '.': target } }, null, 2) + '\n';
    return { files: { [f]: pkg('./index.mjs') }, calls: [edit(f, './index.mjs', './dist/index.mjs')], expect: [{ reason: 'config', file: f, names: ['exports'] }] };
  },
  'outside-task': (i) => {
    const f = `src/shared${i}.mjs`;
    return { files: { [f]: 'export function helper(x) {\n  return x;\n}\n', 'src/own.mjs': 'export const OWN = 1;\n' }, own: ['src/own.mjs'],
      calls: [edit(f, 'return x;', 'return x + 1;')], expect: [{ reason: 'outside-task', file: f, names: [] }] };
  },
  'write-overwrite': (i) => {
    const f = `src/api${i}.mjs`;
    return { files: { [f]: `export function get${i}(id) {}\nexport function list${i}() {}\n` }, calls: [write(f, `export function get${i}(id, opts) {}\nexport function list${i}() {}\n`)],
      expect: [{ reason: 'export', file: f, names: [`get${i}`] }] };
  },
  'bash-sed': (i) => {
    const f = `src/fmt${i}.mjs`;
    return { files: { [f]: `export function format${i}(n) {\n  return String(n);\n}\n` },
      calls: [bash(`sed -i '' 's/format${i}(n)/format${i}(n, locale)/' ${f}`, fx(f, (t) => t.replace(`format${i}(n)`, `format${i}(n, locale)`)))],
      expect: [{ reason: 'export', file: f, names: [`format${i}`] }] };
  },
  'bash-git-mv': (i) => {
    const f = `src/old${i}.mjs`;
    const to = `src/new${i}.mjs`;
    return { files: { [f]: `export function parse${i}(s) {}\n` }, own: [f, to],
      calls: [bash(`git mv ${f} ${to}`, (dir) => execFileSync('git', ['-C', dir, 'mv', f, to]))],
      expect: [{ reason: 'export', file: f, names: [`parse${i}`] }] };
  },
};

const ORD = {
  'body-only': (i) => {
    const f = `src/body${i}.mjs`;
    return { files: { [f]: `export function work${i}(a) {\n  return a + 1;\n}\n` }, calls: [edit(f, 'return a + 1;', `return a + ${i + 2};`)] };
  },
  comment: (i) => {
    const f = `src/doc${i}.mjs`;
    return { files: { [f]: `// helper ${i}\nexport function run${i}(a) { // the runner\n  return a;\n}\n` }, calls: [edit(f, `// helper ${i}`, `/** helper ${i}, documented */`), edit(f, '// the runner', '// runs it')] };
  },
  reformat: (i) => {
    const f = `src/fmt${i}.mjs`;
    return { files: { [f]: `export function build${i}(a, b, c) {\n  return a;\n}\n` }, calls: [edit(f, `build${i}(a, b, c)`, `build${i}(\n  a,\n  b, // second\n  c,\n)`)] };
  },
  'private-function': (i) => {
    const f = `src/priv${i}.mjs`;
    return { files: { [f]: `export function pub${i}(a) {\n  return a;\n}\n` }, calls: [edit(f, `export function pub${i}`, `function inner${i}(x) {\n  return x;\n}\nexport function pub${i}`)] };
  },
  'export-added': (i) => {
    const f = `src/add${i}.mjs`;
    return { files: { [f]: `export function first${i}(a) {}\n` }, calls: [edit(f, `export function first${i}(a) {}\n`, `export function first${i}(a) {}\nexport function second${i}(b) {}\n`)] };
  },
  'test-file': (i) => {
    const f = `test/lib${i}.test.mjs`;
    return { files: { [f]: `export function fixture${i}(a) {}\ntest('x', () => {});\n` }, calls: [edit(f, `fixture${i}(a)`, `fixture${i}(a, b)`)] };
  },
  markdown: (i) => {
    const f = `docs/guide${i}.md`;
    return { files: { [f]: `# Guide\n\nexport function notReal${i}(a) {}\n` }, calls: [edit(f, `notReal${i}(a)`, `notReal${i}(a, b)`)] };
  },
  'json-data': (i) => {
    const f = `data/fixtures${i}.json`;
    return { files: { [f]: JSON.stringify({ users: [{ id: 1, name: 'x' }] }, null, 2) + '\n' }, calls: [edit(f, '"name": "x"', '"name": "y", "age": 3')] };
  },
  'new-own-file': (i) => {
    const f = `src/fresh${i}.mjs`;
    return { files: { 'src/keep.mjs': 'export const K = 1;\n' }, own: ['src/keep.mjs', f], calls: [write(f, `export function brandNew${i}(a) {}\n`)] };
  },
  'bash-no-change': (i) => {
    const f = `src/stable${i}.mjs`;
    return { files: { [f]: `export function stable${i}(a) {}\n` }, calls: [bash(i % 2 ? 'npm test' : 'node --test test/', null), read(f)] };
  },
  'bash-sibling': (i) => {
    const f = 'src/mine.mjs';
    return { files: { [f]: 'export const MINE = 1;\n' }, own: [f],
      calls: [bash(`sed -i '' 's/total(items)/total(items, opts${i})/' sib/b.mjs`, fx('sib/b.mjs', (t) => t.replace('total(items)', `total(items, opts${i})`)))] };
  },
  'env-own': (i) => {
    const f = i % 2 ? '.env' : `app/.env.production`;
    return { files: { [f]: `API_TOKEN=${fakeKey()}\nexport function x${i}(a) {}\n` }, calls: [edit(f, 'x' + i + '(a)', 'x' + i + '(a, b)'), write(f, `PASSWORD=hunter${i}\n`)] };
  },
  'secret-outside': (i) => {
    const f = i % 2 ? `.env.local` : `certs/deploy${i}.pem`;
    return { files: { [f]: `-----BEGIN RSA PRIVATE KEY-----\n${'Q'.repeat(40)}\n-----END RSA PRIVATE KEY-----\n`, 'src/own.mjs': 'export const OWN = 1;\n' }, own: ['src/own.mjs'],
      calls: [edit(f, 'Q'.repeat(40), 'R'.repeat(40))] };
  },
};

/** The four behaviour cases (counted on their own, not in precision / recall). */
function behaviour() {
  const v1 = 'export function price(item) {\n  return item.cost;\n}\n';
  const lib = 'lib.mjs';
  const own = map([lib], ['cart.mjs']);
  const cart = 'export function total(items) {\n  return items.length;\n}\n';
  return [
    { id: 'dedup', label: 'behaviour', expect: [], expectMessages: 1, setup: { files: { [lib]: v1, 'cart.mjs': cart } }, taskId: 'a', taskMap: own,
      calls: [edit(lib, 'price(item)', 'price(item, opts)'), edit(lib, 'price(item, opts)', 'price(item)'), edit(lib, 'price(item)', 'price(item, opts)')] },
    { id: 'revert', label: 'behaviour', expect: [], expectMessages: 2, setup: { files: { [lib]: v1, 'cart.mjs': cart } }, taskId: 'a', taskMap: own,
      calls: [edit(lib, 'price(item)', 'price(item, opts)'), edit(lib, 'price(item, opts)', 'price(item)')] },
    { id: 'burst', label: 'behaviour', expect: [], expectMessages: 2,
      setup: { files: { [lib]: [0, 1, 2, 3].map((k) => `export function f${k}(a) {}\n`).join(''), 'cart.mjs': cart } }, taskId: 'a', taskMap: own,
      calls: [0, 1, 2, 3].map((k) => edit(lib, `f${k}(a)`, `f${k}(a, b)`)) },
    { id: 'loop', label: 'behaviour', expect: [], expectMessages: 2,
      setup: { files: { [lib]: v1 + 'export function tax(x) {}\n', 'cart.mjs': cart } }, taskId: 'a', taskMap: own,
      calls: [
        edit(lib, 'price(item)', 'price(item, opts)', 'a'),
        read('cart.mjs', 'b'),
        edit('cart.mjs', 'total(items)', 'total(items, opts)', 'b'),
        read(lib, 'a'),
        edit(lib, 'tax(x)', 'tax(x, opts)', 'a'),
      ] },
  ];
}

/** `quick`: the first variant of every category plus all behaviour cases. */
export function buildCorpus({ quick = false } = {}) {
  const cases = [];
  for (const [cat, make] of Object.entries(CONTRACT)) {
    for (let i = 0; i < (quick ? 1 : VARIANTS); i++) cases.push(contract(`contract.${cat}.${i}`, make(i)));
  }
  for (const [cat, make] of Object.entries(ORD)) {
    for (let i = 0; i < (quick ? 1 : ORDINARY); i++) cases.push(ordinary(`ordinary.${cat}.${i}`, make(i)));
  }
  cases.push(...behaviour());
  return cases;
}

export const CONTRACT_CATEGORIES = Object.keys(CONTRACT);
export const ORDINARY_CATEGORIES = Object.keys(ORD);
