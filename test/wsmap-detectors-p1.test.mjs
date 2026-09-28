// test/wsmap-detectors-p1.test.mjs — the detector registry and the two P1 detectors (wsmap P1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import { DETECTORS, detectorById } from '../src/core/workspace-map/detectors/index.mjs';
import pkgNpm from '../src/core/workspace-map/detectors/pkg-npm.mjs';
import identity, { readmeRole } from '../src/core/workspace-map/detectors/identity.mjs';

const root = join('/', 'ws');
const member = (key, projectDir = join(root, key)) => ({ key, name: key, dir: join(root, 'repos', key), projectDir });
const web = member('web');
const shared = member('shared-lib-0a1b2c3d', join(root, 'shared-lib'));
const ctx = (m = web) => ({ member: m, members: [web, shared], files: [], state: {} });

test('registry: P1 block is identity then pkg-npm, frozen; detectorById', () => {
  assert.ok(Object.isFrozen(DETECTORS));
  // P1's block comes first; P3 and P4 append theirs after it.
  assert.deepEqual(DETECTORS.slice(0, 2).map((d) => d.id), ['identity', 'pkg-npm']);
  assert.equal(detectorById('pkg-npm'), pkgNpm);
  assert.equal(detectorById('nope'), null);
  for (const d of DETECTORS) assert.equal(typeof d.claims, 'function');
});

test('pkg-npm: provides the name, consumes every dependency section with line evidence', () => {
  const text = [
    '{',
    '  "name": "@acme/web",',
    '  "description": "Customer storefront",',
    '  "author": { "name": "someone" },',
    '  "dependencies": {',
    '    "@acme/billing-client": "^1.2.0",',
    '    "shared": "file:../shared-lib",',
    '    "lodash-es": "npm:lodash@4.17.21",',
    '    "shared-ws": "workspace:../shared-lib",',
    '    "internal": "workspace:*"',
    '  },',
    '  "devDependencies": { "typescript": "5.6.0" }',
    '}',
  ].join('\n');
  assert.equal(pkgNpm.claims('package.json'), true);
  assert.equal(pkgNpm.claims('packages/a/package.json'), true);
  assert.equal(pkgNpm.claims('package.json.bak'), false);
  const r = pkgNpm.detect({ rel: 'package.json', text }, ctx());
  assert.deepEqual(r.stack, ['node']);
  assert.deepEqual(r.role, { text: 'Customer storefront', source: 'manifest' });
  assert.deepEqual(r.aliases.map((a) => a.value), ['@acme/web', 'web']);
  const byKey = Object.fromEntries(r.facts.map((f) => [f.key, f]));
  assert.deepEqual(byKey['npm:@acme/web'], { kind: 'pkg', dir: 'provides', key: 'npm:@acme/web', file: 'package.json', line: 2, match: '"name": "@acme/web",', detail: 'package.json name' });
  assert.equal(byKey['npm:@acme/billing-client'].line, 6);
  assert.equal(byKey['npm:@acme/billing-client'].detail, 'dependencies ^1.2.0');
  assert.equal(byKey['npm:shared'].target, 'shared-lib-0a1b2c3d', 'file: dep resolved against projectDir → member key');
  assert.equal(byKey['npm:lodash'].match, '"lodash-es": "npm:lodash@4.17.21",', 'npm: alias consumes the real package');
  assert.equal(byKey['npm:shared-ws'].target, 'shared-lib-0a1b2c3d', 'workspace:<path> resolves like file:');
  assert.equal(byKey['npm:internal'].target, undefined, 'workspace:* names no path');
  assert.equal(byKey['npm:internal'].detail, 'dependencies workspace:*');
  assert.equal(byKey['npm:typescript'].detail, 'devDependencies 5.6.0');
  assert.equal(byKey['npm:typescript'].line, 12);
  for (const f of r.facts) assert.ok(text.split('\n')[f.line - 1].includes(f.match), `${f.key}: match must be on its line`);
});

test('pkg-npm: nested package.json gives facts but no role/aliases; broken JSON is unresolved, not a throw', () => {
  const r = pkgNpm.detect({ rel: 'packages/ui/package.json', text: '{"name":"ui","dependencies":{"react":"18"}}' }, ctx());
  assert.equal(r.role, undefined);
  assert.deepEqual(r.aliases, []);
  assert.deepEqual(r.facts.map((f) => [f.dir, f.key, f.line]), [['provides', 'npm:ui', 1], ['consumes', 'npm:react', 1]]);
  const bad = pkgNpm.detect({ rel: 'package.json', text: '{ nope' }, ctx());
  assert.equal(bad.unresolved[0].reason, 'unparsable package.json');
  assert.deepEqual(pkgNpm.detect({ rel: 'package.json', text: '[1,2]' }, ctx()), {});
});

test('pkg-npm: a file: / workspace: path inside the member itself names no member', () => {
  const text = JSON.stringify({ name: '@acme/web', dependencies: {
    ui: 'workspace:./packages/ui', vendored: 'file:./vendor/vendored', shared: 'file:../shared-lib' } }, null, 2);
  const byKey = Object.fromEntries(pkgNpm.detect({ rel: 'package.json', text }, ctx()).facts.map((f) => [f.key, f]));
  assert.equal(byKey['npm:ui'].target, undefined, 'an intra-member workspace package is no other member');
  assert.equal(byKey['npm:vendored'].target, undefined, 'nor is a vendored copy');
  assert.equal(byKey['npm:shared'].target, 'shared-lib-0a1b2c3d', 'a sibling project still names its member');
});

test('identity: README first paragraph → role; names → aliases', () => {
  assert.equal(identity.claims('README.md'), true);
  assert.equal(identity.claims('Readme.rst'), true);
  assert.equal(identity.claims('docs/README.md'), false);
  const text = ['# Billing API', '', '[![ci](x.svg)](y)', '', '```sh', 'npm start', '```', '',
    'Bills **customers** and keeps [invoices](docs/x.md)', 'for the storefront.', '', 'Second paragraph.'].join('\n');
  assert.deepEqual(identity.detect({ rel: 'README.md', text }, ctx()), { role: { text: 'Bills customers and keeps invoices for the storefront.', source: 'readme' } });
  assert.equal(readmeRole('Title\n=====\n\nThe body.'), 'The body.', 'rst title underline skipped');
  assert.equal(readmeRole('# Only a heading\n'), '');
  assert.ok(readmeRole('word '.repeat(100)).length <= 160);
  assert.deepEqual(identity.detect({ rel: 'README.md', text: '# x' }, ctx()), {});
  const fin = identity.finish(ctx(shared));
  assert.deepEqual(fin.aliases.map((a) => a.value), ['shared-lib-0a1b2c3d', 'shared-lib']);
  assert.ok(fin.aliases.every((a) => a.source === 'identity'));
});

test('pkg-npm and identity stay linear on 1 MiB adversarial input (the index\'s scan hygiene)', () => {
  // v2 re-scanned the manifest once per dependency and ran the README link regexes over the whole
  // paragraph: 16 s for the 40 000-dependency manifest, minutes for the README runs.
  const deps = Object.fromEntries(Array.from({ length: 40000 }, (_, i) => [`dep-${i}`, '1.0.0']));
  const inputs = [
    ['package.json', JSON.stringify({ name: 'x', dependencies: deps }, null, 2)],
    ['package.json', JSON.stringify({ name: 'x', dependencies: deps })],
    ['package.json', '\n'.repeat(1 << 20)],
    ['package.json', '{"a":' + '"'.repeat(1 << 20)],
    ['README.md', 'a' + '['.repeat(1 << 20)],
    ['README.md', 'x ' + '!['.repeat(1 << 19)],
    ['README.md', 'x ' + '[a]('.repeat(1 << 18)],
    ['README.md', '\n'.repeat(1 << 20)],
  ];
  for (const [rel, text] of inputs) {
    const d = rel === 'README.md' ? identity : pkgNpm;
    const t0 = performance.now();
    const r = d.detect({ rel, text }, ctx());
    const ms = performance.now() - t0;
    assert.ok(ms < 3000, `${d.id} on ${JSON.stringify(text.slice(0, 12))}… (${text.length} chars) took ${Math.round(ms)} ms`);
    if (text.includes('"dependencies"')) assert.equal(r.facts.length, 40001, 'every dependency still found');
  }
});

test('CRLF manifests and READMEs (Windows checkouts): right lines, clean matches, clean role (review focus)', () => {
  const text = '{\r\n  "name": "@acme/crlf",\r\n  "dependencies": {\r\n    "lodash.merge": "4.6.2"\r\n  }\r\n}\r\n';
  const r = pkgNpm.detect({ rel: 'package.json', text }, ctx());
  assert.deepEqual(r.facts.map((f) => [f.key, f.line, f.match]), [
    ['npm:@acme/crlf', 2, '"name": "@acme/crlf",'], ['npm:lodash.merge', 4, '"lodash.merge": "4.6.2"']]);
  assert.equal(readmeRole('# T\r\n\r\nLine one\r\nline two.\r\n\r\nNext.\r\n'), 'Line one line two.');
});

test('pkg-npm: an escaped dependency name still cites its own line (v4)', () => {
  const B = String.fromCharCode(92);
  const text = ['{', '  "name": "w",', '  "dependencies": {', `    "@acme${B}/x": "1",`, `    "${B}u0040acme/y": "1",`, '    "react": "18"', '  }', '}'].join('\n');
  const r = pkgNpm.detect({ rel: 'package.json', text }, ctx());
  assert.deepEqual(r.facts.filter((f) => f.dir === 'consumes').map((f) => [f.key, f.line]), [['npm:@acme/x', 4], ['npm:@acme/y', 5], ['npm:react', 6]]);
});

test('pkg-npm: an escaped or padded package name still provides; a huge name never throws (probe D)', () => {
  const B = String.fromCharCode(92);
  // The serializer that writes "@acme\/x" as a dependency key writes the package's own name the same way.
  for (const v of [`@acme${B}/billing`, ' @acme/billing ', `${B}u0040acme/billing`]) {
    const text = ['{', `  "name": "${v}",`, '  "dependencies": {', `    "@acme${B}/shared": "1"`, '  }', '}'].join('\n');
    const r = pkgNpm.detect({ rel: 'package.json', text }, ctx());
    assert.deepEqual(r.facts.map((f) => [f.dir, f.key, f.line]), [['provides', 'npm:@acme/billing', 2], ['consumes', 'npm:@acme/shared', 4]], v);
    assert.ok(text.split('\n')[1].includes(r.facts[0].match), 'the match is on its line');
  }
  // …and cites the top-level name's line, never an earlier nested "name" (an author, a contributor) (v6).
  const nested = ['{', '  "author": { "name": "Jane" },', `  "name": "@acme${B}/billing"`, '}'].join('\n');
  assert.deepEqual(pkgNpm.detect({ rel: 'package.json', text: nested }, ctx()).facts.map((f) => [f.key, f.line]), [['npm:@acme/billing', 3]]);
  // A name too long for a RegExp (V8: "Regular expression too large" at ~32 KiB) cost every fact of the manifest.
  const r = pkgNpm.detect({ rel: 'package.json', text: JSON.stringify({ name: 'a'.repeat(40000), dependencies: { react: '18' } }) }, ctx());
  assert.deepEqual(r.facts.filter((f) => f.dir === 'consumes').map((f) => f.key), ['npm:react']);
});
