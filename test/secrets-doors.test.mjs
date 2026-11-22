// test/secrets-doors.test.mjs — the static guard for the secret vault's doors: only the stores that own a secret file
// open it, only src/core/secrets/ loads the vault and the OS store, the readers resolve vault references, and no MCP or
// Ask module reads a snapshot secret record's value. A source scan (comments stripped) with an explicit, reasoned
// allowlist; fixtures prove each rule fires. Any new hit over src/ and ui/ is a finding to fix, never an entry to add.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, posix, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../', import.meta.url));

// Rule 1 (open): a module that names a secret file AND calls an fs API. The names come from src/core/secrets/files.mjs
// (PROXY_LOGIN_BASENAME, VAULT_NAME_PREFIX, WRAPPED_KEY_FILE and the constants' identifiers) plus `secrets.json` (the
// MCP and plugin secret stores).
const SECRET_NAME_RE = /proxy-login\.json|worca-vault|secrets\.json|\b(?:PROXY_LOGIN_BASENAME|PROXY_LOGIN_FILE|VAULT_NAME_PREFIX|WRAPPED_KEY_FILE|VAULT_FILE|VAULT_LOCK_FILE)\b/;
const FS_CALL_RE = /\b(?:readFileSync|readFile|openSync|open|createReadStream|createWriteStream|writeFileSync|writeFile|writeJsonAtomic|copyFileSync|copyFile|cpSync|cp|renameSync|rename|rmSync|unlinkSync)\b(?=\s*\()|\bfs\.promises\b/;
/** The doors: the modules that own a secret file. */
const DOORS = ['src/core/proxy-credentials.mjs', 'src/core/plugin-config.mjs', 'src/core/mcp/store.mjs'];
const isDoor = (file) => DOORS.includes(file) || /^src\/core\/secrets\/[^/]+\.mjs$/.test(file);
/** Modules that name a secret file without opening it. */
const NAMES_ONLY = Object.freeze({
  'src/core/ask/show-files.mjs': 'names the secret files to keep them out of what an agent is shown',
  'src/core/ask/command-policy.mjs': 'names the secret files to deny an agent command that reads them',
  'ui/routes/models/export-plugin.mjs': 'names data/secrets.json in the exported plugin README text',
});

// Rule 2 (vault): who may load the vault, the OS store and the store-vault module.
const VAULT_MODULES = ['src/core/secrets/vault.mjs', 'src/core/secrets/os-store.mjs'];
const VAULT_EXCEPTION = 'src/core/mcp/store.mjs';   // its flag-gated assertVaultLockFree import (lock order)
const STORE_VAULT = 'src/core/secrets/store-vault.mjs';
const STORE_VAULT_IMPORTERS = [...DOORS, 'src/core/settings.mjs', 'src/core/plugin-store.mjs'];
// The settings store's vault glue: settings.mjs (flag-gated dynamic imports) and the Settings › Secrets route.
const SETTINGS_VAULT = 'src/core/secrets/settings-vault.mjs';
const SETTINGS_VAULT_IMPORTERS = ['src/core/settings.mjs', 'ui/routes/settings/secrets.mjs'];
const SPEC_RE = /(?:\bfrom\s*|\bimport\s*\(\s*)['"]([^'"]+)['"]/g;

// Rule 3 (resolver): the point-of-use readers resolve vault references through the one sync resolver.
const RESOLVER_CALLS = [
  { file: 'src/core/plugin-config.mjs', fn: 'readPluginConfig', call: 'resolveVaultRefSync' },
  { file: 'src/core/proxy-credentials.mjs', fn: 'readProxyLogin', call: 'resolveVaultRefSync' },
  { file: 'src/core/mcp/registry.mjs', fn: 'materializeCopy', call: 'resolveVaultRefSync' },
  { file: 'src/core/settings.mjs', fn: 'resolveProviderSecret', call: 'resolveSettingsSecretSync' },
  { file: 'src/core/settings.mjs', fn: 'maskStoredSecret', call: 'resolveSettingsSecretSync' },
];

// Rule 4 (mcp-raw): a direct read of a snapshot secret record's value outside the MCP store and resolver. A heuristic
// for that one form (`secrets[key].value`, `bag[k]?.value`), not a full taint check.
const MCP_RAW_SCOPE = /^(?:src\/core\/mcp\/|src\/core\/ask\/|ui\/routes\/mcp-servers\/)/;
const MCP_RAW_OWNERS = ['src/core/mcp/store.mjs', 'src/core/mcp/registry.mjs'];
const MCP_RAW_RE = /\b(secrets|bag)\b[^;\n]*\]\s*\??\.\s*value\b/;

/** Comments out, strings kept (a `://` in a URL is not a comment). */
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

/** The text of top-level function `fn` in `text`: from its declaration to the next top-level declaration. */
function functionBody(text, fn) {
  const m = new RegExp(`^(?:export\\s+)?(?:async\\s+)?function\\s+${fn}\\s*\\(`, 'm').exec(text);
  if (!m) return null;
  const rest = text.slice(m.index + m[0].length);
  const end = rest.search(/^(?:export\s|function\s|async\s+function\s|const\s|let\s|class\s)/m);
  return end < 0 ? rest : rest.slice(0, end);
}

/** The rule violations in `sources` (`[{ file, text }]`, repo-relative posix paths): `[{ file, rule }]`. */
function scanSecretDoors(sources) {
  const out = [];
  for (const { file, text: raw } of sources) {
    const text = stripComments(raw);
    if (SECRET_NAME_RE.test(text) && FS_CALL_RE.test(text) && !isDoor(file) && !Object.hasOwn(NAMES_ONLY, file)) out.push({ file, rule: 'open' });
    const specs = [...text.matchAll(SPEC_RE)].map((x) => x[1]).filter((s) => s.startsWith('.'))
      .map((s) => posix.normalize(posix.join(posix.dirname(file), s)));
    const vaultHit = specs.some((s) => VAULT_MODULES.includes(s)) && !/^src\/core\/secrets\//.test(file) && file !== VAULT_EXCEPTION;
    const storeVaultHit = specs.includes(STORE_VAULT) && !STORE_VAULT_IMPORTERS.includes(file) && !/^src\/core\/secrets\//.test(file);
    const settingsVaultHit = specs.includes(SETTINGS_VAULT) && !SETTINGS_VAULT_IMPORTERS.includes(file) && !/^src\/core\/secrets\//.test(file);
    if (vaultHit || storeVaultHit || settingsVaultHit) out.push({ file, rule: 'vault' });
    if (RESOLVER_CALLS.some((r) => r.file === file && !(functionBody(text, r.fn) ?? '').includes(`${r.call}(`))) out.push({ file, rule: 'resolver' });
    if (MCP_RAW_SCOPE.test(file) && !MCP_RAW_OWNERS.includes(file) && MCP_RAW_RE.test(text)) out.push({ file, rule: 'mcp-raw' });
  }
  return out;
}

function repoSources() {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      const rel = relative(REPO, p).split('\\').join('/');
      if (e.isDirectory()) { if (e.name !== 'node_modules' && rel !== 'ui/public') walk(p); continue; }
      if (e.name.endsWith('.mjs')) out.push({ file: rel, text: readFileSync(p, 'utf8') });
    }
  };
  walk(join(REPO, 'src'));
  walk(join(REPO, 'ui'));
  return out;
}

test('src/ and ui/ have no secret-door violation', () => {
  const sources = repoSources();
  assert.ok(sources.length > 100 && sources.some((s) => s.file === 'src/core/mcp/registry.mjs'), 'the scan reads the repo');
  assert.deepEqual(scanSecretDoors(sources), []);
});

test('every names-only allowlist entry still names a secret file (no stale entry)', () => {
  const byFile = new Map(repoSources().map((s) => [s.file, s.text]));
  for (const [file, reason] of Object.entries(NAMES_ONLY)) {
    assert.ok(reason, file);
    assert.ok(byFile.has(file), `${file} is gone: drop it from the allowlist`);
    assert.ok(SECRET_NAME_RE.test(stripComments(byFile.get(file))), `${file} no longer names a secret file: drop it from the allowlist`);
  }
});

test('each rule fires on its fixture: open, vault, resolver, mcp-raw', () => {
  const breaker = 'test/fixtures/secrets/door-breaker.mjs';
  const text = readFileSync(join(REPO, breaker), 'utf8');
  assert.deepEqual(scanSecretDoors([{ file: breaker, text }]), [{ file: breaker, rule: 'open' }]);
  assert.deepEqual(scanSecretDoors([{ file: 'src/core/chat/x.mjs', text: "export const v = () => import('../secrets/vault.mjs');" }]),
    [{ file: 'src/core/chat/x.mjs', rule: 'vault' }]);
  assert.deepEqual(scanSecretDoors([{ file: 'ui/routes/x.mjs', text: "export const v = () => import('../../src/core/secrets/settings-vault.mjs');" }]),
    [{ file: 'ui/routes/x.mjs', rule: 'vault' }]);
  assert.deepEqual(scanSecretDoors([{ file: 'src/core/chat/y.mjs', text: "const f = 'proxy-login.json';\nexport const c = (to) => copyFileSync(f, to);" }]),
    [{ file: 'src/core/chat/y.mjs', rule: 'open' }]);
  assert.deepEqual(scanSecretDoors([{ file: 'src/core/mcp/registry.mjs', text: 'export function materializeCopy(m) {\n  return m.secrets;\n}\n' }]),
    [{ file: 'src/core/mcp/registry.mjs', rule: 'resolver' }]);
  assert.deepEqual(scanSecretDoors([{ file: 'src/core/mcp/views.mjs', text: 'export const raw = (secrets, key) => secrets[key].value;\n' }]),
    [{ file: 'src/core/mcp/views.mjs', rule: 'mcp-raw' }]);
});

test('only src/core/secrets/flag.mjs names migrate.mjs: no other module imports the migration', () => {
  const MIGRATE = 'src/core/secrets/migrate.mjs';
  const importers = [];
  for (const { file, text: raw } of repoSources()) {
    const specs = [...stripComments(raw).matchAll(SPEC_RE)].map((x) => x[1]).filter((s) => s.startsWith('.'))
      .map((s) => posix.normalize(posix.join(posix.dirname(file), s)));
    if (specs.includes(MIGRATE)) importers.push(file);
  }
  assert.deepEqual(importers, ['src/core/secrets/flag.mjs']);
});

test('only src/cli/secrets.mjs imports export.mjs; no ui/ file names it (no HTTP door to an export)', () => {
  const EXPORT = 'src/core/secrets/export.mjs';
  const importers = [];
  for (const { file, text: raw } of repoSources()) {
    const specs = [...stripComments(raw).matchAll(SPEC_RE)].map((x) => x[1]).filter((s) => s.startsWith('.'))
      .map((s) => posix.normalize(posix.join(posix.dirname(file), s)));
    if (specs.includes(EXPORT)) importers.push(file);
  }
  assert.deepEqual(importers, ['src/cli/secrets.mjs']);
  const ui = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); continue; }
      if (/\.(?:mjs|js|html)$/.test(e.name) && readFileSync(p, 'utf8').includes('secrets/export.mjs')) ui.push(relative(REPO, p));
    }
  };
  walk(join(REPO, 'ui'));
  assert.deepEqual(ui, []);
});
