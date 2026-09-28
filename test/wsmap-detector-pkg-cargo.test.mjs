import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorkspace, runDetector, keysOf, assertEvidence } from './helpers/wsmap-fixtures.mjs';
import detector from '../src/core/workspace-map/detectors/pkg-cargo.mjs';

const ROOT = `[workspace]
members = ["crates/*"]

[workspace.dependencies]
serde = { version = "1", features = ["derive"] }
`;
const API = `[package]
name = "Billing-Api"
description = "Billing HTTP API"

[dependencies]
serde = { workspace = true }
tokio = "1"
money = { package = "acme-money", version = "0.3" }
ledger = { path = "../../../ledger" }

[dependencies.shared]
path = "../../../shared"

[dev-dependencies]
insta = "1"

[target.'cfg(unix)'.dependencies]
nix = "0.29"
util = { path = "../util" }
`;

let ws;
before(async () => {
  ws = await makeWorkspace({
    billing: { 'Cargo.toml': ROOT, 'crates/api/Cargo.toml': API.replace(/\n/g, '\r\n') },
    ledger: { 'Cargo.toml': '[package]\nname = "ledger"\n' },
    shared: { 'Cargo.toml': '[package]\nname = "shared"\n' },
    broken: { 'Cargo.toml': '[package]\nname = "half"\n[dependencies\nx = 1\n' },
    odd: {
      'Cargo.toml': 'dependencies = "serde"\n[package]\nname = "odd"\n',
      'tests/fixtures/sample/Cargo.toml': '[package]\nname = "fixture-crate"\ndescription = "A test fixture"\n',
    },
    fixtureonly: { 'tests/fixtures/sample/Cargo.toml': '[package]\nname = "fixture-crate"\n' },
  });
});
after(() => ws.cleanup());
const member = (k) => ws.members.find((m) => m.key === k);

test('pkg-cargo: a crate provides its package name (cargo lower-cased by normKey); the virtual root provides nothing', async () => {
  const r = await runDetector(detector, member('billing'), ws.members);
  assert.deepEqual(keysOf(r, 'pkg', 'provides'), ['cargo:Billing-Api']);
  const p = r.facts.find((f) => f.dir === 'provides');
  assert.deepEqual([p.file, p.line, p.norm], ['crates/api/Cargo.toml', 2, 'pkg:cargo:billing-api']);
  assert.deepEqual(r.aliases.map((a) => a.value), ['Billing-Api']);
  assert.equal(r.role.text, 'Billing HTTP API');
  assert.deepEqual(r.stack, ['rust']);
  assertEvidence(member('billing'), r);
});

test('pkg-cargo: consumes all dependency tables, renamed packages, workspace deps', async () => {
  const r = await runDetector(detector, member('billing'), ws.members);
  assert.deepEqual(keysOf(r, 'pkg', 'consumes'), [
    'cargo:acme-money', 'cargo:insta', 'cargo:ledger', 'cargo:nix', 'cargo:serde', 'cargo:shared', 'cargo:tokio',
  ]);
  assert.equal(r.facts.find((f) => f.key === 'cargo:nix').detail, 'target cfg(unix)');
  assert.equal(r.facts.find((f) => f.key === 'cargo:acme-money').line, 8);
});

test('pkg-cargo: path dependencies (inline and [dependencies.x] table) target the owning member; a path inside the member is not a consume', async () => {
  const r = await runDetector(detector, member('billing'), ws.members);
  const ledger = r.facts.find((f) => f.key === 'cargo:ledger');
  const shared = r.facts.find((f) => f.key === 'cargo:shared');
  assert.deepEqual([ledger.target, ledger.line], ['ledger', 9]);
  assert.deepEqual([shared.target, shared.line], ['shared', 11]);
  assert.equal(r.facts.find((f) => f.key === 'cargo:tokio').target, undefined);
  assert.ok(!r.facts.some((f) => f.key === 'cargo:util'), 'a path inside the member (a sibling crate) is not a consume');
});

test('pkg-cargo: a string where a dependency table belongs is ignored; a fixture crate sets no role and no alias', async () => {
  const r = await runDetector(detector, member('odd'), ws.members);
  assert.deepEqual(keysOf(r, 'pkg', 'consumes'), [], 'never iterated per character');
  assert.deepEqual([r.aliases.map((a) => a.value), r.role, r.stack], [['odd'], null, ['rust']]);
  const only = await runDetector(detector, member('fixtureonly'), ws.members);
  assert.deepEqual([only.aliases, only.stack], [[], []], 'a fixture crate alone sets no stack and no alias');
});

test('pkg-cargo: malformed Cargo.toml → heuristic provide + unresolved, never throws', async () => {
  const r = await runDetector(detector, member('broken'), ws.members);
  assert.deepEqual(keysOf(r, 'pkg', 'provides'), ['cargo:half']);
  assert.match(r.unresolved[0].reason, /^toml parse error/);
});
