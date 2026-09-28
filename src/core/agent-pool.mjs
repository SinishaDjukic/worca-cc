// src/core/agent-pool.mjs
// One agent user per signed-in person (credential broker, docs/credential-broker.md).
// With a single `worca-agent`, every person's agents share one uid and can read each
// other's processes — including the broker token in a live spawn's environment. The
// entrypoint creates a pool (worca-agent-01..16, WORCA_AGENT_POOL) and a HOME for each
// (WORCA_AGENT_HOMES/<user>); this module gives each person a user of their own, for good:
// Claude Code keeps a person's sessions in that user's HOME, so a resumed chat or run must
// land on the same one. Assignments are stored in <worca home>/agent-pool.json.
//
// Nobody in particular ('local', no signed-in person) keeps the shared WORCA_AGENT_USER.
// More people than users: the rest share by a stable hash, with one warning — still
// better than one uid for everyone, and the operator can raise the pool.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import { agentIdentity } from './agent-user.mjs';
import { worcaHome } from './projects.mjs';

const USER_RE = /^[a-z_][a-z0-9_-]{0,31}$/;
let warnedFull = false;

/** {users, homes} when a pool is configured, else null. Pure: reads only `env`. */
export function agentPool(env = process.env) {
  const users = String(env.WORCA_AGENT_POOL || '').split(',').map((s) => s.trim()).filter((u) => USER_RE.test(u));
  const homes = String(env.WORCA_AGENT_HOMES || '').trim();
  if (!users.length || !isAbsolute(homes)) return null;
  return { users, homes };
}

/**
 * The pool user for `person` given the current assignments. Pure.
 * @returns {{user:string, assignments:Record<string,string>, shared:boolean}}
 */
export function assignPoolUser(person, users, assignments = {}) {
  if (assignments[person] && users.includes(assignments[person])) return { user: assignments[person], assignments, shared: false };
  const taken = new Set(Object.values(assignments));
  const free = users.find((u) => !taken.has(u));
  if (free) return { user: free, assignments: { ...assignments, [person]: free }, shared: false };
  const i = createHash('sha256').update(person).digest().readUInt32BE(0) % users.length;
  return { user: users[i], assignments, shared: true };
}

function stateFile() { return join(worcaHome(), 'agent-pool.json'); }

function readAssignments(file) {
  try { return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')).people || {}) : {}; } catch { return {}; }
}

/**
 * The agent identity for work `person` owns: their pool user (and its HOME), or the shared
 * agent user when there is no pool or no person, or null when agents run as the server.
 * @param {string|null} person  a lower-cased email, 'local', or null
 */
export function agentIdentityFor(person, env = process.env, { file = null } = {}) {
  const base = agentIdentity(env);
  if (!base) return null;
  const pool = agentPool(env);
  const who = typeof person === 'string' ? person.trim().toLowerCase() : '';
  if (!pool || !who || who === 'local' || !who.includes('@')) return base;
  const f = file || stateFile();
  const before = readAssignments(f);
  const r = assignPoolUser(who, pool.users, before);
  if (r.assignments !== before) {
    try {
      const tmp = `${f}.tmp-${process.pid}`;
      writeFileSync(tmp, JSON.stringify({ people: r.assignments }, null, 2), { mode: 0o600 });
      renameSync(tmp, f);
    } catch (err) { console.warn(`[worca] agent pool: could not save the assignment for ${who}: ${err.message}`); }
  }
  if (r.shared && !warnedFull) {
    warnedFull = true;
    console.warn(`[worca] agent pool: all ${pool.users.length} agent users are assigned; more people now share one. Their agents can read each other's processes.`);
  }
  // dedicated: this person's user is theirs alone (not the shared fallback, not hash-shared)
  return { user: r.user, home: join(pool.homes, r.user), gid: base.gid, dedicated: !r.shared };
}
