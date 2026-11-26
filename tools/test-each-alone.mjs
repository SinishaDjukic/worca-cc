#!/usr/bin/env node
// tools/test-each-alone.mjs — `node tools/test-each-alone.mjs FILE...`: run each top-level test of a test file on its
// own, through the hermetic runner (`node tools/test.mjs FILE --test-name-pattern ^name$`), to prove that no test
// depends on what an earlier test of the file left behind (a shared app boot, test/helpers/shared-app-boot.mjs).
// A run counts only when exactly one test ran and passed: a pattern that matches nothing passes with 0 tests.
// A file whose test names cannot be read statically (a computed name, a test() or it() that is not a top-level
// statement, such as one in a loop, a block or a function, a describe/suite, a name used twice) or that has no tests is
// refused with exit 2, since some of its tests could not be run alone by name.
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const TEST_CALLEES = new Set(['test', 'it']);
const SUITE_CALLEES = new Set(['describe', 'suite']);

// The callee of `test(…)`, `it(…)`, `describe(…)` or `test.skip(…)`: its name and modifier. `t.test(…)` reads as `t`.
function callParts(expr) {
  if (expr?.type !== 'CallExpression') return null;
  const { callee } = expr;
  if (callee.type === 'Identifier') return { name: callee.name, modifier: null, call: expr };
  if (callee.type === 'MemberExpression' && !callee.computed && callee.object.type === 'Identifier') {
    return { name: callee.object.name, modifier: callee.property.name, call: expr };
  }
  return null;
}

// A call at the top level of the module, as a statement.
function topLevelCall(stmt) {
  let expr = stmt.type === 'ExpressionStatement' ? stmt.expression : null;
  if (expr?.type === 'AwaitExpression') expr = expr.argument;
  return callParts(expr);
}

// A test the runner would run: test()/it(), or their .only (never .skip/.todo).
const isRunTest = (c) => !!c && TEST_CALLEES.has(c.name) && (c.modifier === null || c.modifier === 'only');

// Every CallExpression under `node`, depth first.
function* calls(node) {
  if (!node || typeof node.type !== 'string') return;
  if (node.type === 'CallExpression') yield node;
  for (const key of Object.keys(node)) {
    if (key === 'loc') continue;
    const v = node[key];
    if (Array.isArray(v)) { for (const x of v) yield* calls(x); } else if (v && typeof v === 'object') yield* calls(v);
  }
}

function staticName(node) {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked;
  return null;
}

/** The top-level test names of a test file's source; dynamic or non-top-level tests and describe/suite calls by line. */
export function listTestNames(source) {
  const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  const names = [], dynamic = [], suites = [], seen = new Set(), duplicates = [], topLevel = new Set();
  for (const stmt of ast.body) {
    const c = topLevelCall(stmt);
    if (!c) continue;
    topLevel.add(c.call);
    if (SUITE_CALLEES.has(c.name)) { suites.push(stmt.loc.start.line); continue; }
    if (!isRunTest(c)) continue;
    const name = staticName(c.call.arguments[0]);
    if (name === null) { dynamic.push(stmt.loc.start.line); continue; }
    if (seen.has(name) && !duplicates.includes(name)) duplicates.push(name);
    seen.add(name);
    names.push(name);
  }
  // A test() that is not a top-level statement (in a loop, a block, a function) has no name the tool can run alone.
  for (const call of calls(ast)) {
    if (!topLevel.has(call) && isRunTest(callParts(call))) dynamic.push(call.loc.start.line);
  }
  dynamic.sort((a, b) => a - b);
  return { names, dynamic: [...new Set(dynamic)], duplicates, suites };
}

/** A --test-name-pattern that matches exactly `name`. */
export function namePattern(name) {
  return `^${name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}$`;
}

/** Whether one alone run proves its test: exit 0, and the spec report says exactly 1 test ran and it passed. */
export function judge({ status, stdout }) {
  const read = (key) => {
    const m = new RegExp(`^ℹ ${key} (\\d+)\\s*$`, 'm').exec(stdout || '');
    return m ? Number(m[1]) : 0;
  };
  const tests = read('tests'), pass = read('pass');
  return { ok: status === 0 && tests === 1 && pass === 1, tests, pass };
}

function eachAlone(file) {
  let listed;
  try { listed = listTestNames(readFileSync(file, 'utf8')); } catch (e) { console.error(`${file}: ${e.message}`); return 2; }
  const { names, dynamic, duplicates, suites } = listed;
  const refuse = [];
  if (dynamic.length) refuse.push(`tests that are not top-level calls with a static name, at line(s) ${dynamic.join(', ')}`);
  if (suites.length) refuse.push(`describe/suite calls, at line(s) ${suites.join(', ')}`);
  if (duplicates.length) refuse.push(`test names used more than once: ${duplicates.join(', ')}`);
  if (!names.length && !refuse.length) refuse.push('no top-level tests');
  if (refuse.length) {
    console.error(`${file}: cannot run each test alone by name: ${refuse.join('; ')}`);
    return 2;
  }
  // The child's report is read as plain text: no colours from an agent shell's FORCE_COLOR.
  const env = { ...process.env };
  delete env.FORCE_COLOR;
  delete env.NODE_TEST_CONTEXT;
  let passed = 0;
  for (const name of names) {
    const r = spawnSync(process.execPath, [join(ROOT, 'tools', 'test.mjs'), file, '--test-name-pattern', namePattern(name)],
      { cwd: ROOT, encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 });
    const v = judge({ status: r.status, stdout: r.stdout });
    if (v.ok) passed++;
    else console.log(`✖ alone: ${name} (exit ${r.status}, tests ${v.tests})`);
  }
  console.log(`each alone: ${passed}/${names.length} passed in ${file}`);
  return passed === names.length ? 0 : 1;
}

function main() {
  const files = process.argv.slice(2);
  if (!files.length) { console.error('usage: node tools/test-each-alone.mjs FILE...'); process.exit(2); }
  let code = 0;
  for (const file of files) code = Math.max(code, eachAlone(file));
  process.exit(code);
}

const isMain = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (process.argv[1] && isMain()) main();
