// test/wsmap-graphql-client-copy-slow.test.mjs — the 1 MiB ReDoS and size-cap rows of wsmap-graphql-client-copy, in the
// slow tier (test/tiers.json): they spend their CPU budget on adversarial input, so the fast tier leaves them out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import detector from '../src/core/workspace-map/detectors/api-graphql.mjs';
import { loadBudget } from './helpers/load-budget.mjs';

const SCHEMA = 'type Query {\n  invoice(id: ID!): Invoice\n  invoices: [Invoice]\n}\ntype Mutation {\n  pay(id: ID!): Invoice\n}\ntype Invoice { id: ID! }\n';
const ROOTS = ['Mutation.pay', 'Query.invoice', 'Query.invoices'];

test('the server-evidence scans stay linear on 1 MiB adversarial code and paths (2 s a row)', () => {
  const MB = 1024 * 1024;
  const js = (s) => `${'// ok\n'.repeat(700)}${s}`.slice(0, MB); // short first lines: no bundle, so the file is read
  const fill = (unit) => unit.repeat(Math.ceil(MB / unit.length)).slice(0, MB);
  const member = { key: 'm', name: 'm', dir: '/w/m', projectDir: '/w/m' };
  for (const [rel, text] of [
    ['a.ts', js(`import${' '.repeat(MB)}`)],
    ['a.ts', js(`require${' '.repeat(MB / 2)}(${' '.repeat(MB / 2)}`)],
    ['a.ts', js(fill("from '@apollo/server-a-a-a-a"))],
    ['a.ts', js(fill("import('apollo-server/a/b/c/d/e/f/g/"))],
    ['a.py', `from${' '.repeat(MB - 4)}`],
    ['a.py', fill('\n \t \t')],
    ['a.py', fill('import strawberr')],
  ]) {
    const ctx = { member, members: [member], files: [rel, 'schema.graphql'], state: {} };
    const t0 = performance.now();
    detector.detect({ rel, text }, ctx);
    if (detector.finish) detector.finish(ctx);
    const ms = performance.now() - t0;
    assert.ok(ms < loadBudget(2000), `${rel} ${JSON.stringify(text.slice(4200, 4230))}: ${ms.toFixed(0)} ms`);
  }
  // and the listing's server files, over paths of near misses (a schema to decide makes finish() read them)
  const files = [`${'app/GraphQL/'.repeat(87000)}x.rb`, `${'app/graphql/'.repeat(87000)}schema.r`, `${'x.gqlgen.y/'.repeat(95000)}`, 'schema.graphql'];
  const ctx = { member, members: [member], files, state: {} };
  const t0 = performance.now();
  detector.detect({ rel: 'schema.graphql', text: SCHEMA }, ctx);
  if (detector.finish) detector.finish(ctx);
  assert.ok(performance.now() - t0 < 2000, `listing: ${(performance.now() - t0).toFixed(0)} ms`);
});

test('a crafted 1 MiB schema of 137 000 root fields never throws in finish(), never costs the member its other schema, and holds at most the fact cap', () => {
  const MB = 1024 * 1024;
  let body = '';
  for (let i = 0; body.length < MB - 40; i += 1) body += `f${i.toString(36)}:A\n`;
  const member = { key: 'm', name: 'm', dir: '/w/m', projectDir: '/w/m' };
  const ctx = { member, members: [member], files: ['schema.graphql', 'zz/huge.graphql'], state: {} };
  detector.detect({ rel: 'schema.graphql', text: SCHEMA }, ctx);
  detector.detect({ rel: 'zz/huge.graphql', text: `type Query {\n${body}}\n`.slice(0, MB) }, ctx);
  const r = detector.finish(ctx);
  assert.deepEqual(r.facts.filter((f) => f.file === 'schema.graphql').map((f) => f.key).sort(), ROOTS);
  assert.ok(r.facts.length <= 5000, `${r.facts.length} facts`);
});

test('crafted operation files never grow the member\'s operation set without bound (the copy verdict keeps at most 50 000 root fields)', () => {
  const MB = 1024 * 1024;
  const member = { key: 'm', name: 'm', dir: '/w/m', projectDir: '/w/m' };
  const ctx = { member, members: [member], files: [], state: {} };
  for (const p of ['a', 'b']) {
    let body = '';
    for (let i = 0; body.length < MB - 40; i += 1) body += `${p}${i.toString(36)}\n`;
    detector.detect({ rel: `src/${p}.graphql`, text: `query {\n${body}}\n` }, ctx);
  }
  assert.ok(ctx.state.ops.size <= 50000, `${ctx.state.ops.size} root fields held`);
});

test('the other-language server-evidence scan stays linear on 1 MiB adversarial code (2 s a row)', () => {
  const MB = 1024 * 1024;
  const fill = (unit) => unit.repeat(Math.ceil(MB / unit.length)).slice(0, MB);
  const member = { key: 'm', name: 'm', dir: '/w/m', projectDir: '/w/m' };
  for (const [rel, text] of [
    ['a.go', fill('"github.com/graph-gophers/graphql-g')],
    ['a.cs', fill('AddGraphQLServer\t')],
    ['a.cs', `using${' '.repeat(MB - 5)}`],
    ['a.php', fill('GraphQL\\Utils\\BuildSchem')],
    ['a.rs', fill('use async_graphql_')],
  ]) {
    const ctx = { member, members: [member], files: [rel, 'schema.graphql'], state: {} };
    const t0 = performance.now();
    detector.detect({ rel, text }, ctx);
    detector.finish(ctx);
    const ms = performance.now() - t0;
    assert.ok(ms < loadBudget(2000), `${rel}: ${ms.toFixed(0)} ms`);
  }
});
