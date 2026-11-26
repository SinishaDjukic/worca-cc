// test/docs-secrets.test.mjs — docs/secrets.md covers the vault's 11 topics, the three statements the owner asked for,
// the four commands, and the pages that point to it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8');
const doc = read('docs/secrets.md');

test('one ## section per topic, the 11 topics', () => {
  const headings = doc.split('\n').filter((l) => l.startsWith('## ')).map((l) => l.slice(3));
  assert.deepEqual(headings, [
    'Turning the vault on', 'Backends', 'The macOS Keychain access prompt', 'Export and downgrade',
    'The one-time message', 'Terminal-only commands', 'A locked store', 'A lost key item and `worca secrets reset`',
    'What file theft does and does not cover', 'The accepted risk of an older vault file', 'The WSL2 DPAPI path',
    'Turning the flag off after a migration', 'With the other setups',
  ]);
  assert.match(doc, /unverified on real hardware/);
  assert.match(doc, /When the flag is on and no vault file exists, export checks the OS store for a leftover key item, bounded by\s+the store time limit/);
});

test('the three owner statements and the four commands', () => {
  const flat = doc.replace(/\s+/g, ' ');
  assert.ok(flat.includes('The migration first proves the OS store with a test record'));
  assert.ok(flat.includes('The migration never writes a secret back into a JSON file on its own'));
  assert.ok(flat.includes('The only two ways back to config-file storage are `worca secrets export` and turning the flag off, which covers new keys only'));
  for (const c of ['worca secrets export', 'worca secrets ack', 'worca secrets status --check', 'worca secrets reset']) assert.ok(flat.includes(c), c);
});

test('feature-flags.md says "while the vault is in use", and storage.md, feature-flags.md and SECURITY.md link docs/secrets.md', () => {
  assert.match(read('docs/feature-flags.md'), /While the vault is in use \(flag on, or a vault file left from a migration\)/);
  assert.match(read('docs/feature-flags.md'), /\]\(secrets\.md\)/);
  assert.match(read('docs/storage.md'), /\]\(secrets\.md\)/);
  assert.match(read('SECURITY.md'), /\]\(docs\/secrets\.md\)/);
  for (const name of ['worca-vault.enc', 'worca-vault.key', 'worca-vault.migrate.lock', 'secrets-notice.json']) assert.ok(read('docs/storage.md').includes(name), name);
});
