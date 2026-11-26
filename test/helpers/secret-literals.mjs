// test/helpers/secret-literals.mjs — file-stored secrets in all four stores, in dev's shapes, written as raw JSON at
// 0600 (as an install from before the vault left them), and the reader that tells, per secret, whether its file holds
// the literal or a vault reference and what that reference resolves to. Shared by the migration tests and the
// settings-child `seed-literals` command, so every test seeds and checks the same set. It loads neither the vault nor
// the OS-store fake (the flag-off pair runs the seed and forbids the fake): the readers take a vault from the caller.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isVaultRef } from '../../src/core/secrets/refs.mjs';

/** In every seeded value: a leak check looks for it. */
export const CANARY = 'cnry7d3f';
/** The proxy NT hash is 32 hex characters, so it carries its own marker. */
const NT_HASH = (tag) => `c0ffee${Buffer.from(tag).toString('hex').padEnd(26, '0').slice(0, 26)}`;
export const SAVED_AT = '2026-01-02T03:04:05.000Z';
export const PLUGIN = 'vault-a';
export const MCP_SERVER = 'manual:pg';

const value = (tag, slot) => `${CANARY}-${tag}-${slot}`;

/**
 * Every seeded secret: `id`, `store`, the vault `field` (owner), the file it lives in (`file(home, worca)`), the
 * path of its raw value in that file, and its literal for `tag`.
 */
export function secretSlots(tag = 'a') {
  return [
    { id: 'settings.openai', store: 'settings', field: 'providers.openai.apiKey', file: 'settings', path: ['providers', 'openai', 'apiKey'], value: value(tag, 'openai') },
    { id: 'settings.stt', store: 'settings', field: 'providers.speech.stt.apiKey', file: 'settings', path: ['providers', 'speech', 'stt', 'apiKey'], value: value(tag, 'stt') },
    { id: 'settings.upstream', store: 'settings', field: 'models.upstream.apiKey', file: 'settings', path: ['models', 0, 'upstream', 'apiKey'], value: value(tag, 'upstream') },
    { id: 'settings.env', store: 'settings', field: 'models.env.ANTHROPIC_AUTH_TOKEN', file: 'settings', path: ['models', 1, 'env', 'ANTHROPIC_AUTH_TOKEN'], value: value(tag, 'env') },
    { id: 'mcp.password', store: 'mcp', field: `${MCP_SERVER}/password`, file: 'mcp', path: ['sets', 'general', MCP_SERVER, 'password', 'value'], value: value(tag, 'mcp-password') },
    { id: 'mcp.token', store: 'mcp', field: `${MCP_SERVER}/token`, file: 'mcp', path: ['sets', 'general', MCP_SERVER, 'token', 'value'], value: value(tag, 'mcp-token') },
    { id: 'plugin.default', store: 'plugin', field: `${PLUGIN}/default/token`, file: 'plugin', path: ['profiles', 'default', 'token'], value: value(tag, 'plugin-default') },
    { id: 'plugin.work', store: 'plugin', field: `${PLUGIN}/work/token`, file: 'plugin', path: ['profiles', 'work', 'token'], value: value(tag, 'plugin-work') },
    { id: 'proxy', store: 'proxy', field: 'login.ntHash', file: 'proxy', path: ['ntHash'], value: NT_HASH(tag) },
  ];
}

/** The four secret files of a seeded install. */
export function secretFiles(home, worca) {
  return {
    settings: join(home, '.worca-cc', 'settings.json'),
    mcp: join(worca, 'mcp', 'secrets.json'),
    plugin: join(worca, 'plugins', PLUGIN, 'data', 'secrets.json'),
    proxy: join(worca, 'proxy-login.json'),
  };
}

const writeRaw = (file, obj) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(obj, null, 2) + '\n', { mode: 0o600 });
};

/**
 * Write the literals of `secretSlots(tag)` into `home` (settings.json) and `worca` (the Worca home), plus the values a
 * migration must leave alone: a `${VAR}` key, a readable model env key and an `{ $env }` MCP secret. `big` adds a
 * 65 537-byte provider key (too large for the vault).
 */
export function seedLiterals({ home, worca, tag = 'a', big = false }) {
  const v = Object.fromEntries(secretSlots(tag).map((s) => [s.id, s.value]));
  const files = secretFiles(home, worca);
  writeRaw(files.settings, {
    providers: {
      openai: { apiKey: v['settings.openai'] },
      anthropic: { apiKey: '${MY_KEY}' },
      speech: { stt: { apiKey: v['settings.stt'] } },
      ...(big ? { images: { apiKey: 'x'.repeat(65537) } } : {}),
    },
    models: [
      { id: 'm-bridged', upstream: { provider: 'openai', api: 'openai-chat', model: 'gpt-x', apiKey: v['settings.upstream'] } },
      { id: 'm-env', env: { ANTHROPIC_AUTH_TOKEN: v['settings.env'], ANTHROPIC_MODEL: 'claude-x', ANTHROPIC_BASE_URL: 'https://gw.example.test' } },
    ],
  });
  writeRaw(join(worca, 'mcp', 'sets.json'), { schema: 1, sets: { general: { name: 'General', members: [{ server: MCP_SERVER, enabled: true, values: {} }] } } });
  writeRaw(files.mcp, { schema: 1, sets: { general: { [MCP_SERVER]: {
    password: { value: v['mcp.password'], updatedAt: SAVED_AT },
    token: { value: v['mcp.token'], updatedAt: SAVED_AT },
    region: { value: { $env: 'MCP_REGION' }, updatedAt: SAVED_AT },
  } } } });
  writeRaw(files.plugin, { $format: 'profiles/1', profiles: { default: { token: v['plugin.default'] }, work: { token: v['plugin.work'] } } });
  writeRaw(files.proxy, { v: 1, id: 'a1b2c3d4e5f60718', domain: 'ACME', user: 'jdoe', ntHash: v.proxy, savedAt: SAVED_AT, rejected: null });
}

const at = (obj, path) => path.reduce((x, k) => (x == null ? undefined : x[k]), obj);

/**
 * Per secret id: `{ raw, ref, value }` — `ref` whether the file holds a vault reference, `value` what the file's
 * value reads as (the literal itself, or the reference resolved through `vault` for its own owner; null when it
 * does not resolve).
 */
export async function readSecrets({ home, worca, vault, tag = 'a' }) {
  const files = secretFiles(home, worca);
  const parsed = {};
  for (const [k, f] of Object.entries(files)) parsed[k] = JSON.parse(readFileSync(f, 'utf8'));
  const out = {};
  for (const s of secretSlots(tag)) {
    const raw = at(parsed[s.file], s.path);
    let resolved = raw;
    if (isVaultRef(raw)) {
      try { resolved = await vault.resolve(raw, { store: s.store, field: s.field }); } catch { resolved = null; }
    }
    out[s.id] = { raw, ref: isVaultRef(raw), value: resolved };
  }
  return out;
}

/** The entries of `vault` that are not `droppedAt`-marked ([] when there is no vault file). */
export async function liveEntries(vault) {
  return (await vault.list()).filter((e) => e.droppedAt === undefined);
}
