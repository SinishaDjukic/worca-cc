// src/core/mcpjson-approval.mjs
// A project's committed `.mcp.json` servers as Worca sees them on every engine: each one approved,
// unapproved or disabled by the rules a run uses (run-context.mjs mcpjsonApproval). Codex, Copilot
// and Cursor attach only the approved ones; a Claude spawn names the rest in disabledMcpjsonServers
// (unapprovedMcpjsonNames). The Approve action names a server in the project's own
// `.claude/settings.local.json`, the file Claude Code keeps for local answers. That file only counts
// while git does not track it, so Approve refuses a tracked one and keeps a new one out of git.

import { readFile, appendFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { readMcpFile, mcpjsonApproval } from './run-context.mjs';
import { writeJsonAtomic } from './json-atomic.mjs';
import { gitAvailable, gitMissingError } from './git-available.mjs';

const LOCAL = join('.claude', 'settings.local.json');

function cerr(message, code) {
  return Object.assign(new Error(message), { code });
}

function git(projectDir, args) {
  if (!gitAvailable()) throw gitMissingError();
  return execFileSync('git', args, { cwd: projectDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
}

/** Whether git tracks the project's `.claude/settings.local.json`. Not a repository, not tracked, or git missing (the
 *  decided flip: Approve may then write it): false; any other failure counts as tracked, so Approve never writes a
 *  file a repository might ship. */
export function localSettingsTracked(projectDir) {
  if (!gitAvailable()) return false;
  try {
    git(projectDir, ['ls-files', '--error-unmatch', '--', LOCAL]);
    return true;
  } catch (err) {
    return !(err?.status === 1 || err?.status === 128);
  }
}

/** Keep `.claude/settings.local.json` out of git through the repository's own `info/exclude`, unless git already
 *  ignores it. Best-effort: outside a repository there is nothing to do. */
function keepOutOfGit(projectDir) {
  if (!gitAvailable()) return;
  try {
    git(projectDir, ['check-ignore', '-q', '--', LOCAL]);
    return;                                                  // already ignored
  } catch (err) {
    if (err?.status !== 1) return;                           // 128: no repository
  }
  try {
    const exclude = resolve(projectDir, git(projectDir, ['rev-parse', '--git-path', 'info/exclude']).trim());
    const prefix = git(projectDir, ['rev-parse', '--show-prefix']).trim();
    return appendFile(exclude, `\n# worca: Claude Code local settings\n/${prefix}${LOCAL.split('\\').join('/')}\n`);
  } catch { /* best-effort */ }
}

/**
 * The servers of `<projectDir>/.mcp.json`, sorted by name, each with its status for a non-Claude run:
 * `approved`, `unapproved` or `disabled`. `canApprove` is false when git tracks `.claude/settings.local.json`.
 * `error` names an unreadable or invalid `.mcp.json`. No `.mcp.json`: no servers.
 */
export async function committedMcpStatus(projectDir, { homeDir = homedir() } = {}) {
  const { servers, parseError, readError } = await readMcpFile(join(projectDir, '.mcp.json'));
  const error = parseError || (readError && readError !== 'ENOENT' ? readError : null);
  if (!servers) return { servers: [], canApprove: false, error };
  const verdict = await mcpjsonApproval(projectDir, homeDir, () => {});
  return {
    servers: Object.keys(servers).sort().map((name) => ({ name, status: verdict(name) })),
    canApprove: !localSettingsTracked(projectDir),
    error: null,
  };
}

/**
 * The servers of `<cwd>/.mcp.json` that are not approved for `projectDir` (default `cwd`), by raw name. A Claude
 * spawn starts every server of that file in `-p` whatever its approval (probed on Claude Code 2.1.293), so the
 * runner names these in `disabledMcpjsonServers`, which Claude Code honors over any approval. Read at each spawn:
 * an agent may have edited the file since the run started. No file, or one Claude Code cannot parse either: none.
 */
export async function unapprovedMcpjsonNames(cwd, projectDir = cwd, { homeDir = homedir(), git = true } = {}) {
  if (!cwd) return [];
  const { servers } = await readMcpFile(join(cwd, '.mcp.json'));
  if (!servers || !Object.keys(servers).length) return [];
  const verdict = await mcpjsonApproval(projectDir || cwd, homeDir, () => {}, { git });
  return Object.keys(servers).filter((n) => verdict(n) !== 'approved').sort();
}

/**
 * Approve `names` (servers of the project's `.mcp.json`) in `<projectDir>/.claude/settings.local.json`: add them
 * to `enabledMcpjsonServers` and drop them from that file's `disabledMcpjsonServers`. Every other key is kept.
 * Throws `LOCAL_TRACKED` when git tracks that file, `LOCAL_INVALID` when it is not a JSON object, and
 * `UNKNOWN_SERVER` for a name the `.mcp.json` does not define.
 */
export async function approveCommittedMcp(projectDir, names) {
  const { servers } = await readMcpFile(join(projectDir, '.mcp.json'));
  const unknown = names.filter((n) => typeof n !== 'string' || !servers || !Object.hasOwn(servers, n));
  if (!names.length || unknown.length) throw cerr(`Not a server of this project's .mcp.json: ${unknown.join(', ') || '(none given)'}`, 'UNKNOWN_SERVER');
  if (localSettingsTracked(projectDir)) {
    throw cerr('This repository tracks .claude/settings.local.json, so an approval there does not count. Approve the servers in ~/.claude/settings.json instead.', 'LOCAL_TRACKED');
  }
  const file = join(projectDir, LOCAL);
  let doc = {};
  let text = null;
  try { text = await readFile(file, 'utf8'); } catch (err) { if (err?.code !== 'ENOENT') throw err; }
  if (text !== null && text.trim()) {
    try { doc = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text); } catch { doc = null; }
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw cerr(`${file} is not a JSON object; fix it first.`, 'LOCAL_INVALID');
  }
  const list = (v) => (Array.isArray(v) ? v.filter((n) => typeof n === 'string') : []);
  doc.enabledMcpjsonServers = [...new Set([...list(doc.enabledMcpjsonServers), ...names])];
  if (Array.isArray(doc.disabledMcpjsonServers)) doc.disabledMcpjsonServers = list(doc.disabledMcpjsonServers).filter((n) => !names.includes(n));
  writeJsonAtomic(file, doc);
  if (text === null) await keepOutOfGit(projectDir);
}
