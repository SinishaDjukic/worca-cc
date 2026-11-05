// src/core/mcp/discover.mjs
// Read-only discovery of the MCP servers other tools define on this machine (docs/mcp-servers.md "Import from
// other tools"): Claude Code, Claude Desktop, Cursor, VS Code, Codex and Gemini CLI, in the user's home and in the
// chat's pinned project(s). The ONE reader of those files. It never writes, never watches, and never throws for a
// file: a missing file is status "missing", an unreadable or malformed one is status "error" with a message that
// never quotes the file (smol-toml prints the offending line).
//
// A secret value never leaves this module. An env / header value that is a whole ${…} / $VAR reference, sits under
// a secret-looking name, or looks like a token becomes { secret: true, ref?, prefix? }; only a plain value stays
// { text }. A secret-looking argument becomes { secret: true }. "Secret-looking" also covers a credential inside a
// longer text (embedsSecret): a URL login (postgres://app:pw@db), a URL with a secret query parameter, a header line
// such as "Authorization: Bearer …". A URL with a secret in its query, path or login keeps only its origin and path,
// with urlSecret set. The transport is one of a fixed list (TRANSPORTS); any other text becomes "unsupported", so a
// file cannot put words into it. Free text (description, instructions, trust …) is never read.
import { realpathSync } from 'node:fs';
import { readFile as fsReadFile, stat as fsStat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { parseJsonc } from '../workspace-import.mjs';
import { SECRET_NAME_RE, QUERY_SECRET_RE, hasTokenShape } from '../mcp-secrets.mjs';
import { looksLikeSecret } from '../policy/registry.mjs';
import { detectDeployment } from '../deployment.mjs';

export const DISCOVER_TOOLS = Object.freeze({
  'claude-code': 'Claude Code', 'claude-desktop': 'Claude Desktop', cursor: 'Cursor', vscode: 'VS Code', codex: 'Codex', gemini: 'Gemini CLI',
});
export const DISCOVER_LIMITS = Object.freeze({ fileBytes: 16 * 1024 * 1024, serversPerFile: 200, args: 64, argChars: 2000 });

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const looksSecret = (s) => typeof s === 'string' && (looksLikeSecret(s) || hasTokenShape(s));
const noBom = (t) => (t.charCodeAt(0) === 0xfeff ? t.slice(1) : t);

/** Whether user-level files may be read: only on a local worca (not a container, not hosted), and not when the
 *  parent told the chat's MCP child otherwise (spawn.mjs buildMcpConfig). */
export function homeConfigsAllowed(env = process.env) {
  if (String(env.WORCA_ASK_NO_HOME_CONFIGS || '') === '1') return false;
  if (String(env.WORCA_ALLOWED_HOSTS || '').trim()) return false;
  return detectDeployment(env) === 'local';
}

// ${VAR}, ${VAR:-default} (Claude Code), ${env:VAR} (Cursor, VS Code), ${input:id} (VS Code), $VAR (Gemini CLI).
const REF_RE = /^\$\{(?:env:|input:)?([A-Za-z_][A-Za-z0-9_.-]{0,99})(?::-[^}]*)?\}$|^\$([A-Za-z_][A-Za-z0-9_]{0,99})$/;
const AUTH_RE = /^(Bearer|Basic|Token)[ \t]+(\S.*)$/i;
const FLAG_RE = /^--?([A-Za-z0-9_-]{1,64})(?:=(.*))?$/;
// A flag and its value in ONE argument ("--token abc123").
const SPACE_FLAG_RE = /^--?([A-Za-z][A-Za-z0-9_-]{0,63})\s+(\S.*)$/s;
// scheme://user:password@ anywhere in a value (a connection string inside an argument or env value).
const CRED_RE = /[A-Za-z][A-Za-z0-9+.-]{0,30}:\/\/[^/\s:@]{0,256}:[^/\s@]{1,256}@/;
const WHOLE_URL_RE = /^[A-Za-z][A-Za-z0-9+.-]{0,30}:\/\/\S+$/;
const HEADER_LINE_RE = /^\s*([A-Za-z0-9_-]{1,64})\s*:\s*(.*)$/;
// NAME=value inside an argument (docker -e API_KEY=…, --env=DB_PASSWORD=…, env FOO=… cmd).
const PAIR_RE = /^([A-Za-z_][A-Za-z0-9_.-]{0,99})=(.*)$/s;
/** The transports a file may name, mapped onto worca's three; anything else is "unsupported". */
const TRANSPORTS = Object.freeze({ stdio: 'stdio', http: 'http', 'streamable-http': 'http', streamablehttp: 'http', streamable_http: 'http', sse: 'sse' });

/** The variable a whole-value reference names, or null. */
export function refName(v) {
  const m = REF_RE.exec(String(v ?? '').trim());
  return m ? (m[1] || m[2]) : null;
}

/** One env / header value → { text } | { secret: true, ref?, prefix? } | { invalid: true }. */
export function classifyValue(key, raw) {
  const v = typeof raw === 'string' ? raw : (typeof raw === 'number' || typeof raw === 'boolean') ? String(raw) : null;
  if (v === null) return { invalid: true };
  if (v.length > DISCOVER_LIMITS.argChars) return { secret: true };   // never scan or keep an unbounded value
  const named = SECRET_NAME_RE.test(String(key));
  // An auth-scheme value is a credential under any name (X-Upstream: Bearer …, UPSTREAM=Basic …).
  const auth = AUTH_RE.exec(v);
  if (auth) {
    const ref = refName(auth[2].trim());
    return { secret: true, prefix: `${auth[1]} `, ...(ref ? { ref } : {}) };
  }
  const ref = refName(v);
  if (ref || named || looksSecret(v) || embedsSecret(v)) return { secret: true, ...(ref ? { ref } : {}) };
  return { text: v };
}

/** A credential inside a longer text: a URL login (scheme://user:pass@), a whole URL whose login, path or query holds
 *  a secret (urlOf), or a header line ("Authorization: …", "X-Api-Key: …", "Name: Bearer …"). */
function embedsSecret(s) {
  if (CRED_RE.test(s)) return true;
  if (WHOLE_URL_RE.test(s.trim()) && urlOf(s).urlSecret) return true;
  const h = HEADER_LINE_RE.exec(s);
  if (!h) return false;
  const value = h[2].trim();
  return SECRET_NAME_RE.test(h[1]) || AUTH_RE.test(value) || looksSecret(value);
}

/** NAME=value whose name is secret-looking (API_KEY=…, DB_PASSWORD=…) or whose value is: the form docker -e,
 *  env and --env= pass a variable in an argument. An empty value is not a secret. */
function pairSecret(s) {
  const m = PAIR_RE.exec(s);
  return !!m && m[2] !== '' && (SECRET_NAME_RE.test(m[1]) || looksSecret(m[2]) || embedsSecret(m[2]));
}

/** Arguments, in order: text, or { secret: true } for a token, a credential inside the argument (embedsSecret, also
 *  the value of any --flag=value or "--flag value"), a secret NAME=value pair (pairSecret, also as a flag's value), a
 *  secret-named --flag=value or "--flag value" in one argument, or the word after a secret-named --flag. */
function argsOf(list, problems) {
  if (list !== undefined && !Array.isArray(list)) { problems.push('its args is not a list'); return []; }
  const out = [];
  let afterSecretFlag = false;
  for (const [i, a] of (list || []).entries()) {
    if (typeof a !== 'string' && typeof a !== 'number') { problems.push(`argument ${i + 1} is not text`); out.push({ invalid: true }); afterSecretFlag = false; continue; }
    const s = String(a);
    // Never scan or keep an over-long argument: it is masked, and its server cannot be imported.
    if (s.length > DISCOVER_LIMITS.argChars) { problems.push(`argument ${i + 1} is longer than ${DISCOVER_LIMITS.argChars} characters`); out.push({ invalid: true }); afterSecretFlag = false; continue; }
    const flag = FLAG_RE.exec(s);
    const secretFlag = !!flag && SECRET_NAME_RE.test(flag[1]);
    const spaced = flag ? null : SPACE_FLAG_RE.exec(s);
    const flagValue = flag && flag[2] !== undefined ? flag[2] : spaced ? spaced[2] : '';
    if (looksSecret(s) || embedsSecret(s) || pairSecret(s)
      || (flagValue && (looksSecret(flagValue) || embedsSecret(flagValue) || pairSecret(flagValue)))
      || afterSecretFlag || ((secretFlag || (!!spaced && SECRET_NAME_RE.test(spaced[1]))) && flagValue !== '')) out.push({ secret: true });
    else out.push(s);
    afterSecretFlag = secretFlag && flag[2] === undefined;
  }
  return out;
}

function valuesOf(m, what, problems) {
  if (m === undefined || m === null) return {};
  if (!isObj(m)) { problems.push(`its ${what} is not an object`); return {}; }
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, classifyValue(k, v)]));
}

/** A URL with no secret in it: { url, urlSecret }. A secret anywhere (login, query, fragment, a path segment) keeps
 *  only origin + path, minus the secret segment. The fragment is screened like the query (#access_token=… in an
 *  OAuth-style URL) and never kept on a secret URL. */
function urlOf(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return { url: '', urlSecret: false };
  let u;
  try { u = new URL(raw.trim()); } catch { return looksSecret(raw) ? { url: '', urlSecret: true } : { url: raw.trim(), urlSecret: false }; }
  const segs = u.pathname.split('/');
  const badSeg = segs.some((s) => looksSecret(decodeURIComponentSafe(s)));
  const badParam = ([k, v]) => QUERY_SECRET_RE.test(k) || looksSecret(v) || !!refName(v);
  const badQuery = [...u.searchParams].some(badParam);
  const frag = decodeURIComponentSafe(u.hash.slice(1));
  const badHash = !!frag && (looksSecret(frag) || [...new URLSearchParams(frag)].some(badParam));
  if (!(u.username || u.password || badSeg || badQuery || badHash)) return { url: raw.trim(), urlSecret: false };
  const path = segs.filter((s) => !looksSecret(decodeURIComponentSafe(s))).join('/');
  return { url: `${u.protocol}//${u.host}${path}`, urlSecret: true };
}
function decodeURIComponentSafe(s) { try { return decodeURIComponent(s); } catch { return s; } }

/** One entry of an mcpServers / servers map → a discovered server (no secret value in it). */
function serverOf(tool, name, e) {
  const problems = []; const notes = [];
  if (!isObj(e)) return { name, type: '', env: {}, headers: {}, problems: ['the entry is not an object'], notes };
  // type (Claude Code, VS Code), or transport (seen in Cursor files); only the TRANSPORTS words are kept.
  const given = typeof e.type === 'string' ? e.type : typeof e.transport === 'string' ? e.transport : '';
  const t = given.trim().toLowerCase();
  const httpUrl = typeof e.httpUrl === 'string' ? e.httpUrl : null;
  const url = httpUrl ?? (typeof e.url === 'string' ? e.url : null);
  if (t && !Object.hasOwn(TRANSPORTS, t)) problems.push(`its transport ${/^[a-z0-9_-]{1,20}$/.test(t) ? t : '(not a known name)'} is not one worca has (stdio, http, sse)`);
  const type = t ? (Object.hasOwn(TRANSPORTS, t) ? TRANSPORTS[t] : 'unsupported')
    : (typeof e.command === 'string' ? 'stdio'
      : tool === 'gemini' && httpUrl === null && url !== null ? 'sse'   // Gemini CLI: url is SSE, httpUrl streamable HTTP
      : url !== null ? 'http' : '');
  const out = { name, type, env: {}, headers: {}, problems, notes };
  if (type === 'stdio') {
    out.command = typeof e.command === 'string' ? e.command.trim() : '';
    // A command holding a credential (a URL login, an inline API_KEY=… prefix, "--token x" inside it) is dropped,
    // never shown: each of its words is classified as an argument would be.
    if (out.command.length > DISCOVER_LIMITS.argChars || looksSecret(out.command) || embedsSecret(out.command)
      || argsOf(out.command.split(/\s+/), []).some((a) => typeof a !== 'string')) {
      out.command = ''; out.commandSecret = true; problems.push('its command looks like it holds a secret');
    } else if (!out.command) problems.push('it names no command');
    out.args = argsOf(e.args, problems);
    if (out.args.length > DISCOVER_LIMITS.args) problems.push(`it has more than ${DISCOVER_LIMITS.args} arguments`);
    out.env = valuesOf(e.env, 'env', problems);
    if (typeof e.cwd === 'string' && e.cwd.trim()) notes.push('it sets a working folder (cwd), which worca does not keep');
    if (typeof e.envFile === 'string' && e.envFile.trim()) notes.push('the values in its envFile are not imported');
  } else if (url && url.length > DISCOVER_LIMITS.argChars) {
    // Never scan or keep an over-long URL.
    out.url = ''; problems.push(`its URL is longer than ${DISCOVER_LIMITS.argChars} characters`);
    out.headers = valuesOf(e.headers, 'headers', problems);
  } else {
    const u = urlOf(url);
    out.url = u.url;
    if (u.urlSecret) out.urlSecret = true;
    if (!url) problems.push('it names no URL');
    out.headers = valuesOf(e.headers, 'headers', problems);
  }
  return out;
}

/** Codex [mcp_servers.<name>]: env_vars, env_http_headers and bearer_token_env_var name variables, never values. */
function codexServerOf(name, e) {
  if (!isObj(e)) return serverOf('codex', name, e);
  const env = isObj(e.env) ? { ...e.env } : {};
  for (const n of Array.isArray(e.env_vars) ? e.env_vars : []) if (typeof n === 'string' && !Object.hasOwn(env, n)) env[n] = '${' + n + '}';
  const headers = isObj(e.http_headers) ? { ...e.http_headers } : {};
  for (const [h, v] of Object.entries(isObj(e.env_http_headers) ? e.env_http_headers : {})) if (typeof v === 'string') headers[h] = '${' + v + '}';
  if (typeof e.bearer_token_env_var === 'string' && e.bearer_token_env_var) headers.Authorization = 'Bearer ${' + e.bearer_token_env_var + '}';
  const s = serverOf('codex', name, { command: e.command, args: e.args, env, url: e.url, headers, cwd: e.cwd });
  if (e.enabled === false) s.notes.push('Codex has it turned off');
  return s;
}

/** Every config file discovery reads: user-level ones first (homeScope), then each project's. */
export function discoverySources({ home = homedir(), platform = process.platform, env = process.env, projects = [], homeScope = true } = {}) {
  const appSupport = platform === 'darwin' ? join(home, 'Library', 'Application Support')
    : platform === 'win32' ? (env.APPDATA || join(home, 'AppData', 'Roaming'))
      : (env.XDG_CONFIG_HOME || join(home, '.config'));
  const user = !homeScope ? [] : [
    ['claude-code', join(home, '.claude.json'), 'claude-json', 'mcpServers'],
    ['claude-desktop', join(appSupport, 'Claude', 'claude_desktop_config.json'), 'json', 'mcpServers'],
    ['cursor', join(home, '.cursor', 'mcp.json'), 'json', 'mcpServers'],
    ['vscode', join(appSupport, 'Code', 'User', 'mcp.json'), 'jsonc', 'servers'],
    ['codex', join(env.CODEX_HOME || join(home, '.codex'), 'config.toml'), 'toml', 'mcp_servers'],
    ['gemini', join(home, '.gemini', 'settings.json'), 'jsonc', 'mcpServers'],
  ].map(([tool, path, format, root]) => ({ tool, scope: 'user', path, format, root }));
  const proj = projects.flatMap((p) => [
    ['claude-code', ['.mcp.json'], 'json', 'mcpServers'],
    ['cursor', ['.cursor', 'mcp.json'], 'json', 'mcpServers'],
    ['vscode', ['.vscode', 'mcp.json'], 'jsonc', 'servers'],
    ['codex', ['.codex', 'config.toml'], 'toml', 'mcp_servers'],
    ['gemini', ['.gemini', 'settings.json'], 'jsonc', 'mcpServers'],
  ].map(([tool, rel, format, root]) => ({ tool, scope: 'project', project: p.key, path: join(resolve(p.path), ...rel), format, root })));
  return [...user, ...proj];
}

const readError = (e) => (e?.code === 'EACCES' || e?.code === 'EPERM' ? 'cannot read it: permission denied'
  : `cannot read it (${typeof e?.code === 'string' ? e.code : 'error'})`);

/** A parser message can quote the file: only the kind and the position are kept. For JSONC (VS Code, Gemini CLI)
 *  the position is counted on parseJsonc's text with comments and trailing commas removed, so it can point a little
 *  before the real spot; it holds only digits either way. */
function parseError(format, e, text) {
  const kind = format === 'toml' ? 'TOML' : 'JSON';
  const msg = String(e?.message || '');
  let line = Number.isInteger(e?.line) ? e.line : null;
  let col = Number.isInteger(e?.column) ? e.column : null;
  const lc = /\(line (\d+) column (\d+)\)/.exec(msg);
  if (lc) { line = Number(lc[1]); col = Number(lc[2]); }
  else if (line === null) {
    const p = /position (\d+)/.exec(msg);
    if (p) { const before = text.slice(0, Number(p[1])); line = before.split('\n').length; col = before.length - before.lastIndexOf('\n'); }
  }
  return `not valid ${kind}${line ? ` (line ${line}, column ${col ?? 1})` : ''}`;
}

async function readSource(src, fs) {
  let st;
  try { st = await fs.stat(src.path); } catch (e) {
    return e?.code === 'ENOENT' || e?.code === 'ENOTDIR' ? { status: 'missing' } : { status: 'error', error: readError(e) };
  }
  if (!st.isFile()) return { status: 'error', error: 'not a file' };
  if (st.size > DISCOVER_LIMITS.fileBytes) return { status: 'error', error: `larger than ${DISCOVER_LIMITS.fileBytes / 1048576} MiB` };
  let text;
  try { text = String(await fs.readFile(src.path, 'utf8')); } catch (e) { return { status: 'error', error: readError(e) }; }
  try {
    const doc = src.format === 'toml' ? parseToml(noBom(text)) : src.format === 'jsonc' ? parseJsonc(text) : JSON.parse(noBom(text));
    return { status: 'ok', doc };
  } catch (e) { return { status: 'error', error: parseError(src.format, e, text) }; }
}

/** ~/.claude.json: the user-scope map, and each pinned project's local-scope map (projects[<abs path>]). The
 *  project row is looked up by the resolved path, then by its real path: the same rule as run-context.mjs's private
 *  claudeJsonProject, which the run path uses on its own already-parsed document. */
function claudeJsonGroups(doc, projects) {
  const out = [{ scope: 'user', map: isObj(doc) ? doc.mcpServers : undefined }];
  const rows = isObj(doc) && isObj(doc.projects) ? doc.projects : {};
  const real = (p) => { try { return realpathSync(p); } catch { return null; } };
  for (const p of projects) {
    const keys = [resolve(p.path), real(p.path)].filter(Boolean);
    const key = keys.find((k) => Object.hasOwn(rows, k));
    const row = key ? rows[key] : null;
    if (isObj(row) && row.mcpServers !== undefined) out.push({ scope: 'local', project: p.key, map: row.mcpServers });
  }
  return out;
}

/**
 * @param {{home?:string, platform?:string, env?:object, projects?:Array<{key:string, path:string}>, homeScope?:boolean,
 *   fs?:{stat:Function, readFile:Function}}} [o]
 * @returns {Promise<{servers:object[], files:object[]}>}
 */
export async function discoverMcpConfigs({ home = homedir(), platform = process.platform, env = process.env, projects = [], homeScope = true,
  fs = { stat: fsStat, readFile: fsReadFile } } = {}) {
  const shown = (p) => (p === home || p.startsWith(home + sep) ? `~${p.slice(home.length)}` : p);
  const servers = []; const files = [];
  for (const src of discoverySources({ home, platform, env, projects, homeScope })) {
    const r = await readSource(src, fs);
    const file = { tool: src.tool, scope: src.scope, ...(src.project ? { project: src.project } : {}), path: src.path, source: shown(src.path), status: r.status,
      ...(r.error ? { error: r.error } : {}) };
    files.push(file);
    if (r.status !== 'ok') continue;
    const groups = src.format === 'claude-json' ? claudeJsonGroups(r.doc, projects)
      : [{ scope: src.scope, project: src.project, map: isObj(r.doc) ? r.doc[src.root] : undefined }];
    let count = 0;
    for (const g of groups) {
      if (g.map === undefined || g.map === null) continue;
      if (!isObj(g.map)) { file.status = 'error'; file.error = `its ${src.root} is not an object`; continue; }
      for (const [i, [name, e]] of Object.entries(g.map).entries()) {
        if (count >= DISCOVER_LIMITS.serversPerFile) { file.truncated = true; break; }
        count += 1;
        const s = src.tool === 'codex' ? codexServerOf(name, e) : serverOf(src.tool, name, e);
        const tag = g.scope === 'user' ? 'user' : `${g.scope}@${g.project}`;
        const id = `${src.tool}:${tag}:${/^[A-Za-z0-9._@-]{1,64}$/.test(name) ? name : `#${i + 1}`}`;
        servers.push({ id, tool: src.tool, scope: g.scope, ...(g.project ? { project: g.project } : {}), path: src.path, source: shown(src.path), ...s });
      }
    }
    file.servers = count;
  }
  return { servers, files };
}
