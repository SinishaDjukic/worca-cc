// src/shared/secrets-notice.mjs — the one wording of the message about secrets moved into the Worca vault, for the CLI
// (stderr, at each vault-aware start until acknowledged) and Settings › About. Pure, no imports: the browser loads it
// from /src/shared. A notice is `{ id, at, label, keys: [{ store, name }], left }` and never holds a value.

const MAX_NAME = 200;

/** The display name of one moved key (`Provider key: openai`, `Proxy login`, …), cleaned of control characters. */
export function keyName(key) {
  const name = typeof key?.name === 'string' ? key.name : '';
  return name.replace(/\p{Cc}/gu, ' ').trim().slice(0, MAX_NAME);
}

/**
 * The lines of `notice`. `surface` is `cli` or `settings`: Settings omits the backend sentence (the Secrets row right
 * above shows the store) and the action line (its Got it button is the action). `settingsReachable` false (the flag is
 * off, so Settings does not show it) ends the CLI action line after "this message.".
 * @returns {string[]}
 */
export function noticeLines(notice, { surface = 'cli', settingsReachable = true } = {}) {
  const keys = Array.isArray(notice?.keys) ? notice.keys.map(keyName).filter(Boolean) : [];
  const n = keys.length;
  const left = Number.isInteger(notice?.left) && notice.left > 0 ? notice.left : 0;
  const moved = `Worca moved ${n} saved ${n === 1 ? 'secret' : 'secrets'} into the vault.`;
  const label = typeof notice?.label === 'string' ? notice.label.replace(/\p{Cc}/gu, ' ').trim() : '';
  const lines = [surface === 'cli' && label ? `${moved} Its key is kept in ${label}.` : moved];
  lines.push('These keys are now in the vault:');
  for (const k of keys) lines.push(`  - ${k}`);
  if (left) lines.push(`${left} ${left === 1 ? 'secret was' : 'secrets were'} left in the config file (too large, or saved for another Worca home).`);
  if (surface === 'cli') {
    lines.push(settingsReachable
      ? 'Run `worca secrets ack` to dismiss this message, or press Got it in Settings › About.'
      : 'Run `worca secrets ack` to dismiss this message.');
  }
  return lines;
}

const serverName = (id) => { const s = String(id ?? ''); const i = s.indexOf(':'); return i >= 0 ? s.slice(i + 1) : s; };

/**
 * The notice key of a settings secret slot (`{ path, modelId? }`): `Provider key: openai`, `Model gpt-4o: upstream API
 * key`, `Model local: env OPENAI_API_KEY`.
 */
export function settingsKeyName({ path = [], modelId } = {}) {
  if (path[0] === 'models') {
    const id = String(modelId ?? path[1]);
    return path[2] === 'env' ? `Model ${id}: env ${path[3]}` : `Model ${id}: upstream API key`;
  }
  return `Provider key: ${path.slice(1, -1).join(' ')}`;
}

/** The notice key of an MCP secret: `MCP set Default, server github: GITHUB_TOKEN`. */
export function mcpKeyName({ set, server, key } = {}) {
  return `MCP set ${set}, server ${serverName(server)}: ${key}`;
}

/** The notice key of a plugin secret: `Plugin jira, profile default: apiToken`. */
export function pluginKeyName({ name, profile, key } = {}) {
  return `Plugin ${name}, profile ${profile}: ${key}`;
}

/** The notice key of the saved proxy login. */
export const PROXY_KEY_NAME = 'Proxy login';
