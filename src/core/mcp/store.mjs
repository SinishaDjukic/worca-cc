// src/core/mcp/store.mjs
// The MCP registry's files (registry design §4.2–§4.5), the only module that touches them:
//   <WORCA_HOME>/mcp/servers.json  manual + consented policy definitions, persisted base names
//   <WORCA_HOME>/mcp/sets.json     user sets, retired set ids, Team state, project assignments
//   <WORCA_HOME>/mcp/secrets.json  secrets per set and server
//   <WORCA_HOME>/mcp/tests.json    the last Test per membership
// All four are 0600 and written atomically. Reads take no lock and never write. Every
// read-modify-write runs under mcp/.lock inside one in-process queue; the lock is not re-entrant,
// so no store operation calls another (they share helpers over the snapshot read inside the lock).
// Every map holding user keys is null-prototype; lookups use Object.hasOwn.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { worcaHome } from '../projects.mjs';
import { PROJECT_KEY_RE } from '../store.mjs';
import { withLock } from '../metrics/lock.mjs';
import { writeJsonAtomic } from '../json-atomic.mjs';
import { validateMcpDefinition, screenNonSecretValue, canonicalJson, sha256Hex, MCP_ENV_VAR_RE, URL_SAFE_SECRET_RE, SETS_API_NOUNS } from './definitions.mjs';
import { parseSkillId, SKILL_ID_RE } from '../skills-registry/ids.mjs';
import { assignBaseNames, newSetId, slugFor, teamRecord, teamRecordsFor } from './identity.mjs';

export class McpStoreError extends Error {
  constructor(status, message) { super(message); this.name = 'McpStoreError'; this.status = status; }
}
const fail = (status, message) => { throw new McpStoreError(status, message); };

export function mcpDir() { return join(worcaHome(), 'mcp'); }
/** A stored tool's name: a Test result holds names (older) or records (workflow tests D35); '' for anything else. */
export const toolNameOf = (t) => (typeof t === 'string' ? t : t && typeof t.name === 'string' ? t.name : '');

const FILES = ['servers', 'sets', 'secrets', 'tests']; // read in this order: sets before secrets (§4.5 pending)
const map = () => Object.create(null);
const isMap = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const orMap = (v) => (isMap(v) ? v : map());
const isTeamId = (id) => id.startsWith('team-');
const nullProto = (k, v) => (isMap(v) ? Object.assign(Object.create(null), v) : v);
const isRef = (v) => isMap(v) && typeof v.field === 'string';
// Drops every entry of a map that is not an object (a hand edit); true when one was dropped.
const dropNonMaps = (obj) => {
  let hit = false;
  for (const [k, v] of Object.entries(obj)) if (!isMap(v)) { delete obj[k]; hit = true; }
  return hit;
};
// A secret record or Test result whose leaves have the wrong type reads as absent: readers template them
// (`String(value.$env)`, `Date.parse(updatedAt)`, `String(tool)`), and the reviver's maps throw when coerced.
const text = (v) => v === undefined || typeof v === 'string';
const secretOk = (r) => ((typeof r.value === 'string' && r.value !== '') || (isMap(r.value) && typeof r.value.$env === 'string')) && text(r.updatedAt);
// A stored tool is its name (a Test written before workflow tests Part 2) or { name, description?, inputSchema?, annotations? }.
const toolOk = (x) => typeof x === 'string' || (isMap(x) && typeof x.name === 'string');
const testOk = (t) => (t.tools === undefined || (Array.isArray(t.tools) && t.tools.every(toolOk)))
  && text(t.at) && text(t.fingerprint) && (t.error === null || text(t.error));

// A missing file reads as empty. A lock-free read never throws: a file that cannot be read or does not
// parse to an object reads as empty. Inside the lock (strict), any read error but ENOENT (EACCES, EMFILE,
// EBUSY…) throws, and so does a damaged servers.json, sets.json or secrets.json: a write built from that
// empty snapshot would replace the file — the orphan sweep would drop every secret, one secret PUT would keep
// only its own secret, retired ids (§4.2) and bases (§4.4) would be handed out again. A damaged tests.json (the
// last Test results) is replaced by the next write. A leading BOM (some Windows editors write one) is not damage.
const damaged = (name) => fail(409, `MCP registry file mcp/${name}.json is damaged — fix it or remove it`);
function readJson(name, strict) {
  let text;
  try { text = readFileSync(join(mcpDir(), `${name}.json`), 'utf8'); } catch (e) {
    if (strict && e.code !== 'ENOENT') throw e;
    return map();
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  let v = null;
  try { v = JSON.parse(text, nullProto); } catch { /* damaged: below */ }
  if (isMap(v)) return v;
  if (strict && name !== 'tests') damaged(name);
  return map();
}

// Skills in sets (skills registry §3.2), additive to schema 1: `sets[id].skills` — a skill id at most once and a skill name at
// most once per set — and `teams[home].skills`, Team state per required skill. A hand-edited entry that is not an object, a
// `skill` that is not text, a repeated id or a repeated name reads as absent; every kept entry stays as written (keys a newer
// Worca adds included). No skills ⇒ no `skills` key, in the snapshot as in the file: readers take `set.skills ?? []` and
// `team.skills ?? {}`, and a registry without skills reads and writes exactly as before.
const skillNameOf = (id) => parseSkillId(id)?.name ?? null;
function readSetSkills(set) {
  if (set.skills === undefined) return;
  const ids = new Set();
  const names = new Set();
  const kept = Array.isArray(set.skills) ? set.skills.filter((k) => {
    if (!isMap(k) || typeof k.skill !== 'string' || ids.has(k.skill)) return false;
    const name = skillNameOf(k.skill);
    if (name !== null && names.has(name)) return false;
    ids.add(k.skill);
    if (name !== null) names.add(name);
    return true;
  }) : [];
  if (kept.length) set.skills = kept; else delete set.skills;
}
function readTeamSkills(t) {
  if (t.skills === undefined) return;
  if (isMap(t.skills)) dropNonMaps(t.skills);
  if (!isMap(t.skills) || !Object.keys(t.skills).length) delete t.skills;
}

// A (set, server) pair whose secrets and test are kept: a user set's member, or a Team set member with
// persisted Team state (Team state is removed only by the §11.2 actions, never by this sweep; its secrets
// are written only after it, so a Forget or uninstall interrupted between the two files leaves an orphan).
function live(s, setId, serverId) {
  if (isTeamId(setId)) return Object.values(s.teams).some((t) => t.id === setId && Object.hasOwn(t.members, serverId));
  return Object.hasOwn(s.sets, setId) && s.sets[setId].members.some((m) => m.server === serverId);
}

function load(strict = false) {
  const f = Object.fromEntries(FILES.map((n) => [n, readJson(n, strict)]));
  // `schema` compares only as a number or text: a hand-edited object has no primitive value (the reviver's maps).
  const newer = FILES.some((n) => ['number', 'string'].includes(typeof f[n].schema) && Number(f[n].schema) > 1);
  const [servers, sets, secrets, tests] = FILES.map((n) => (newer ? map() : f[n]));
  // Inside the lock a top-level key of the wrong type is damage too: read as empty, the next write would drop
  // everything under it (every set or Team state, and the sweep their secrets; every retired id or base).
  if (strict && !newer) {
    for (const [n, k] of [['servers', 'bases'], ['servers', 'manual'], ['servers', 'policy'], ['sets', 'sets'], ['sets', 'teams'],
      ['sets', 'projects'], ['sets', 'retired'], ['secrets', 'sets']]) {
      const v = f[n][k];
      if (v !== undefined && !(k === 'retired' ? Array.isArray(v) : isMap(v))) damaged(n);
    }
  }
  const s = {
    newer,
    bases: orMap(servers.bases), manual: orMap(servers.manual), policy: orMap(servers.policy),
    sets: orMap(sets.sets), retired: Array.isArray(sets.retired) ? sets.retired.filter((id) => typeof id === 'string') : [],
    teams: orMap(sets.teams), projects: orMap(sets.projects),
    secrets: orMap(secrets.sets), tests: orMap(tests.tests),
  };
  // Hand edits below the top level read as absent, so no reader and no locked write trips on them.
  for (const [id, base] of Object.entries(s.bases)) if (typeof base !== 'string') delete s.bases[id];
  dropNonMaps(s.manual);
  for (const [key, p] of Object.entries(s.policy)) if (!isMap(p) || !isMap(p.def)) delete s.policy[key];
  dropNonMaps(s.sets);
  for (const [id, set] of Object.entries(s.sets)) {
    if (typeof set.name !== 'string') set.name = id === 'general' ? 'General' : id;
    const seen = new Set(); // §4.2: a server at most once per set — a hand-edited repeat reads as absent
    set.members = Array.isArray(set.members) ? set.members.filter((m) => isMap(m) && typeof m.server === 'string' && !seen.has(m.server) && seen.add(m.server)) : [];
    for (const m of set.members) m.values = orMap(m.values);
    readSetSkills(set);
  }
  if (!Object.hasOwn(s.sets, 'general')) s.sets.general = { name: 'General', members: [] };
  dropNonMaps(s.teams);
  for (const t of Object.values(s.teams)) {
    t.members = orMap(t.members);
    dropNonMaps(t.members);
    for (const st of Object.values(t.members)) { st.values = orMap(st.values); st.seeded = orMap(st.seeded); }
    readTeamSkills(t);
  }
  // A slug, Team id or Team name that is not text (a hand edit; copy names template the slug) is computed again
  // as at creation (§4.2, §4.4), over the slugs that are text. General has no slug.
  const slugs = [...Object.values(s.sets), ...Object.values(s.teams)].map((x) => x.slug).filter((x) => typeof x === 'string' && x);
  for (const [id, set] of Object.entries(s.sets)) {
    if (id === 'general') { if (typeof set.slug !== 'string') delete set.slug; }
    else if (typeof set.slug !== 'string' || !set.slug) slugs.push(set.slug = slugFor({ setId: id, source: id }, slugs));
  }
  for (const [home, t] of Object.entries(s.teams)) {
    if (typeof t.id === 'string' && typeof t.slug === 'string' && t.slug && typeof t.name === 'string') continue;
    const rec = teamRecord(home, { takenSlugs: slugs });
    if (typeof t.id !== 'string') t.id = rec.id;
    if (typeof t.slug !== 'string' || !t.slug) slugs.push(t.slug = rec.slug);
    if (typeof t.name !== 'string') t.name = rec.name;
  }
  dropNonMaps(s.projects);
  for (const p of Object.values(s.projects)) {
    p.sets = Array.isArray(p.sets) ? p.sets.filter((id) => typeof id === 'string') : [];
    if (typeof p.includeGeneral !== 'boolean') delete p.includeGeneral;
  }
  // Junk in secrets.json or tests.json is swept like an orphan: the next locked write replaces the file.
  const orphans = { secrets: dropNonMaps(s.secrets), tests: dropNonMaps(s.tests) };
  for (const [setId, bySet] of Object.entries(s.secrets)) {
    if (dropNonMaps(bySet)) orphans.secrets = true;
    for (const [serverId, entry] of Object.entries(bySet)) {
      if (dropNonMaps(entry)) orphans.secrets = true;
      for (const [k, r] of Object.entries(entry)) if (!secretOk(r)) { delete entry[k]; orphans.secrets = true; }
      if (!Object.keys(entry).length || !live(s, setId, serverId)) { delete bySet[serverId]; orphans.secrets = true; }
    }
    if (!Object.keys(bySet).length) { delete s.secrets[setId]; orphans.secrets = true; }
  }
  for (const key of Object.keys(s.tests)) {
    const i = key.indexOf('|');
    if (i < 0 || !testOk(s.tests[key]) || !live(s, key.slice(0, i), key.slice(i + 1))) { delete s.tests[key]; orphans.tests = true; }
  }
  return { s, orphans };
}

/** The whole registry, orphans left out. No lock; never writes. */
export async function readMcpStore() { return load().s; }

function fileOf(name, s) {
  if (name === 'servers') return { manual: s.manual, policy: s.policy, bases: s.bases };
  if (name === 'sets') {
    const sets = { ...s.sets };
    if (!sets.general.members.length && !sets.general.skills?.length) delete sets.general; // implicit until it holds a member or a skill
    return { sets, retired: s.retired, teams: s.teams, projects: s.projects };
  }
  return name === 'secrets' ? { sets: s.secrets } : { tests: s.tests };
}

let queue = Promise.resolve();
const holding = new AsyncLocalStorage();

/**
 * Run `fn(tx)` under the registry lock. `tx.snapshot` is read inside the lock (orphans already swept
 * from disk); `await tx.write(name, obj = <that file from tx.snapshot>)` writes one file, 0600,
 * atomically, at once. Never nest: a store operation inside `fn` rejects.
 */
export function withMcpLock(fn, lockOpts) {
  if (holding.getStore()?.active) return Promise.reject(new Error('withMcpLock: MCP store operations never nest'));
  const run = queue.then(() => withLock(join(mcpDir(), '.lock'), () => {
    // `hold` ends with fn: work fn left scheduled may call the store later, and a kept tx may not write.
    const hold = { active: true };
    return holding.run(hold, async () => {
      try {
        const { s, orphans } = load(true);
        if (s.newer) fail(409, 'MCP registry files need a newer Worca');
        const tx = {
          snapshot: s,
          write: async (name, obj = fileOf(name, s)) => {
            if (!hold.active) throw new Error('withMcpLock: tx.write after the lock was released');
            writeJsonAtomic(join(mcpDir(), `${name}.json`), { schema: 1, ...obj }, { mode: 0o600 });
          },
        };
        if (orphans.secrets) await tx.write('secrets');
        if (orphans.tests) await tx.write('tests');
        return await fn(tx);
      } finally { hold.active = false; }
    });
  }, lockOpts));
  queue = run.catch(() => {});
  return run.catch((e) => { throw e?.code === 'LOCK_TIMEOUT' ? new McpStoreError(503, 'MCP registry is busy') : e; });
}

const allSlugs = (s) => [...Object.values(s.sets), ...Object.values(s.teams)].map((x) => x.slug).filter(Boolean);
// Ids a new set may not take (§4.2): every set's, and every id a project assignment still names — a set removed
// by hand (or read as junk) was never retired, and a new set under its id would inherit that assignment — and the
// words /api/sets/<word> uses for the rest of the Sets API (skills registry §7).
const takenIds = (s) => [...Object.keys(s.sets), ...Object.values(s.projects).flatMap((p) => p.sets), ...SETS_API_NOUNS];

function checkSetName(s, name, selfId) {
  const n = typeof name === 'string' ? name.trim() : '';
  if (!n || n.length > 40) fail(400, 'a set name is 1–40 characters');
  if (n.toLowerCase().startsWith('team · ')) fail(400, 'set names starting "Team · " are reserved');
  if (Object.entries(s.sets).some(([id, x]) => id !== selfId && x.name.toLowerCase() === n.toLowerCase())) fail(409, `a set named "${n}" already exists`);
  return n;
}

export async function createSet(name) {
  return withMcpLock(async (tx) => {
    const s = tx.snapshot;
    const n = checkSetName(s, name);
    const id = newSetId(n, { taken: takenIds(s), retired: s.retired });
    const slug = slugFor({ setId: id, source: id }, allSlugs(s));
    s.sets[id] = { name: n, slug, members: [] };
    await tx.write('sets');
    return { id, name: n, slug };
  });
}

// A user set other than General: the only kind that is renamed or deleted.
function userSet(s, id, verb) {
  if (id === 'general' || isTeamId(id)) fail(400, `${id === 'general' ? 'General' : 'a Team set'} cannot be ${verb}`);
  if (!Object.hasOwn(s.sets, id)) fail(404, `no MCP set "${id}"`);
  return s.sets[id];
}

export async function renameSet(id, name) {
  return withMcpLock(async (tx) => {
    const s = tx.snapshot;
    userSet(s, id, 'renamed').name = checkSetName(s, name, id);
    await tx.write('sets');
  });
}

/** §4.2 + §4.5: sets.json first (the set, its project entries, the retired id), then secrets, then tests. */
export async function deleteSet(id) {
  return withMcpLock(async (tx) => {
    const s = tx.snapshot;
    userSet(s, id, 'deleted');
    delete s.sets[id];
    s.retired.push(id);
    for (const p of Object.values(s.projects)) if (Array.isArray(p.sets)) p.sets = p.sets.filter((x) => x !== id);
    await tx.write('sets');
    if (Object.hasOwn(s.secrets, id)) { delete s.secrets[id]; await tx.write('secrets'); }
    const tests = Object.keys(s.tests).filter((k) => k.startsWith(`${id}|`));
    for (const k of tests) delete s.tests[k];
    if (tests.length) await tx.write('tests');
  });
}

/**
 * §4.2: a new user set with the source's members, values and secrets (secrets written first, §4.5), and its skills
 * (skills registry §3.2). A Team source needs `team = { home, members, skills? }` — the Team set's derived member ids
 * (§11.2) and skill ids; each gets its local state's switch (and values), or off with none.
 */
export async function duplicateSet(id, name, { team } = {}) {
  return withMcpLock(async (tx) => {
    const s = tx.snapshot;
    let members;
    let skills;
    if (isTeamId(id)) {
      if (typeof team?.home !== 'string' || !Array.isArray(team.members)) fail(400, 'duplicating a Team set needs its home and members');
      const rec = Object.hasOwn(s.teams, team.home) ? s.teams[team.home] : null;
      if ((rec?.id ?? teamRecord(team.home).id) !== id) fail(404, `no Team set "${id}" for ${team.home}`);
      members = [...new Set(team.members)].map((server) => { // a server at most once per set (§4.2)
        const st = rec && Object.hasOwn(rec.members, server) ? rec.members[server] : null;
        // An interrupted Team write stays skipped in the copy too (§4.5 pending).
        return { server, enabled: st?.enabled === true, values: structuredClone(st?.values ?? {}), ...(st?.pending === true ? { pending: true } : {}) };
      });
      skills = [...new Set(Array.isArray(team.skills) ? team.skills : [])].map((skill) => {
        const st = rec?.skills && Object.hasOwn(rec.skills, skill) ? rec.skills[skill] : null;
        return { skill, enabled: st?.enabled === true && st.pending !== true };
      });
    } else {
      if (!Object.hasOwn(s.sets, id)) fail(404, `no MCP set "${id}"`);
      members = structuredClone(s.sets[id].members);
      skills = structuredClone(s.sets[id].skills ?? []);
    }
    const n = checkSetName(s, name);
    const newId = newSetId(n, { taken: takenIds(s), retired: s.retired });
    const slug = slugFor({ setId: newId, source: newId }, allSlugs(s));
    await persistBases(tx, members.map((m) => m.server));
    const from = Object.hasOwn(s.secrets, id) ? s.secrets[id] : map();
    const secrets = map();
    for (const m of members) if (Object.hasOwn(from, m.server)) secrets[m.server] = structuredClone(from[m.server]);
    if (Object.keys(secrets).length) { s.secrets[newId] = secrets; await tx.write('secrets'); }
    s.sets[newId] = { name: n, slug, members, ...(skills.length ? { skills } : {}) };
    await tx.write('sets');
    return { id: newId, name: n, slug };
  });
}

/** §4.2 `projects`: keyed by project key; only user sets are assigned (General rides includeGeneral). */
export async function setProjectAssignment(projectKey, { sets, includeGeneral } = {}) {
  return withMcpLock(async (tx) => {
    const s = tx.snapshot;
    if (typeof projectKey !== 'string' || !PROJECT_KEY_RE.test(projectKey)) fail(400, 'invalid project key');
    if (!Array.isArray(sets) || typeof includeGeneral !== 'boolean') fail(400, 'expected { sets: [set ids], includeGeneral: true|false }');
    const ids = [...new Set(sets)];
    for (const id of ids) {
      if (typeof id !== 'string') fail(400, 'sets must hold set ids'); // never template JSON: an own toString throws
      if (id === 'general' || !Object.hasOwn(s.sets, id)) fail(400, `"${id}" is not a set that can be assigned`);
    }
    s.projects[projectKey] = { sets: ids, includeGeneral };
    await tx.write('sets');
  });
}

// §4.4: a locked write that places a server id persists its base when it has none (servers.json first: a base
// written alone is harmless), so a member never runs under a provisional name another write can take.
async function persistBases(tx, ids) {
  const added = assignBaseNames(tx.snapshot.bases, ids);
  if (Object.keys(added).length) { Object.assign(tx.snapshot.bases, added); await tx.write('servers'); }
}

const newTeamState = () => ({ enabled: false, values: map(), seeded: map(), consent: null });
const ensureTeam = (s, home) => {
  if (!Object.hasOwn(s.teams, home)) s.teams[home] = { ...teamRecord(home, { takenSlugs: allSlugs(s) }), members: map() };
  return s.teams[home];
};

function setSecretsEntry(s, setId, serverId, entry) {
  if (Object.keys(entry).length) {
    if (!Object.hasOwn(s.secrets, setId)) s.secrets[setId] = map();
    s.secrets[setId][serverId] = entry;
  } else if (Object.hasOwn(s.secrets, setId)) {
    delete s.secrets[setId][serverId];
    if (!Object.keys(s.secrets[setId]).length) delete s.secrets[setId];
  }
}

/**
 * Add or update a membership (§4.2, §4.3). `def` (the server's McpDef, from the catalog) routes each key:
 * `values` take non-secret fields (undefined keeps, null clears, each passes screenNonSecretValue);
 * `secrets` take secret fields (undefined and the `{ set: true }` echo keep, null clears, text, or
 * `{ $env: 'MCP_…' }` stored verbatim; a secret the url uses must be URL-safe). Team set ids need
 * `team = { home }`: the member's state lives in `teams[home]`, whose record the first write persists;
 * callers enforce the Team locks. When both files change, the member is marked `pending` first (§4.5).
 */
export async function putMember(setId, serverId, { enabled, values, secrets } = {}, { team, def } = {}) {
  return withMcpLock(async (tx) => {
    const s = tx.snapshot;
    if (!isMap(def) || !Array.isArray(def.fields)) fail(400, 'the server definition is required');
    if (enabled !== undefined && typeof enabled !== 'boolean') fail(400, 'enabled must be true or false');
    if (values !== undefined && !isMap(values)) fail(400, 'values must be an object');
    if (secrets !== undefined && !isMap(secrets)) fail(400, 'secrets must be an object');
    const fields = map();
    for (const f of def.fields) fields[f.key] = f;
    const home = isTeamId(setId) ? team?.home : null;
    let target;
    if (isTeamId(setId)) {
      if (typeof home !== 'string') fail(400, 'a Team set write needs its home');
      const rec = Object.hasOwn(s.teams, home) ? s.teams[home] : null;
      if ((rec?.id ?? teamRecord(home).id) !== setId) fail(404, `no Team set "${setId}" for ${home}`);
      target = rec && Object.hasOwn(rec.members, serverId) ? rec.members[serverId] : null;
    } else {
      if (!Object.hasOwn(s.sets, setId)) fail(404, `no MCP set "${setId}"`);
      target = s.sets[setId].members.find((m) => m.server === serverId) ?? null;
    }
    const before = target ?? (home ? newTeamState() : { server: serverId, enabled: true, values: map() });
    const next = { ...before, enabled: enabled ?? before.enabled, values: { ...before.values } };
    delete next.pending;
    for (const [k, v] of Object.entries(values ?? {})) {
      if (v === undefined) continue;
      if (!Object.hasOwn(fields, k) || fields[k].secret) fail(400, `values.${k}: not a non-secret field of this server`);
      if (v === null) { delete next.values[k]; continue; }
      const bad = screenNonSecretValue(v);
      if (bad) fail(400, `values.${k}: ${bad}`);
      next.values[k] = v;
    }
    const prev = Object.hasOwn(s.secrets, setId) && Object.hasOwn(s.secrets[setId], serverId) ? s.secrets[setId][serverId] : map();
    const nextSecrets = { ...prev };
    const inUrl = new Set((Array.isArray(def.url) ? def.url : [def.url]).filter(isRef).map((r) => r.field));
    const now = new Date().toISOString();
    for (const [k, v] of Object.entries(secrets ?? {})) {
      if (v === undefined || (isMap(v) && v.set === true)) continue;
      if (!Object.hasOwn(fields, k) || !fields[k].secret) fail(400, `secrets.${k}: not a secret field of this server`);
      if (v === null) { delete nextSecrets[k]; continue; }
      if (isMap(v) && typeof v.$env === 'string') {
        if (!MCP_ENV_VAR_RE.test(v.$env)) fail(400, `secrets.${k}: $env must name a variable matching ^MCP_[A-Z0-9_]{1,60}$`);
        nextSecrets[k] = { value: { $env: v.$env }, updatedAt: now };
      } else if (typeof v === 'string' && v) {
        // spawn() refuses an env value holding NUL: every spawn resolving this set would fail, echoing the value.
        if (v.includes(String.fromCharCode(0))) fail(400, `secrets.${k}: may not contain a NUL character`);
        if (inUrl.has(k) && !URL_SAFE_SECRET_RE.test(v)) fail(400, `secrets.${k}: the URL uses it, so only letters, digits and . _ ~ - are allowed`);
        nextSecrets[k] = { value: v, updatedAt: now };
      } else fail(400, `secrets.${k}: expected text, { "$env": "MCP_…" } or null`);
    }
    const setsChanged = !target || canonicalJson(target) !== canonicalJson(next);
    const secretsChanged = canonicalJson(prev) !== canonicalJson(nextSecrets);
    if (!setsChanged && !secretsChanged) return;
    await persistBases(tx, [serverId]);
    const place = (m) => {
      if (home) { ensureTeam(s, home).members[serverId] = m; return; }
      const members = s.sets[setId].members;
      const i = members.findIndex((x) => x.server === serverId);
      if (i < 0) members.push(m); else members[i] = m;
    };
    if (setsChanged && secretsChanged) { place({ ...before, pending: true }); await tx.write('sets'); }
    if (secretsChanged) { setSecretsEntry(s, setId, serverId, nextSecrets); await tx.write('secrets'); }
    if (setsChanged) { place(next); await tx.write('sets'); }
  });
}

/** Remove a user set's (or General's) member with its secrets and test: sets, then secrets, then tests. */
export async function deleteMember(setId, serverId) {
  return withMcpLock(async (tx) => {
    const s = tx.snapshot;
    if (isTeamId(setId)) fail(400, 'Team set members are not removed by hand');
    if (!Object.hasOwn(s.sets, setId)) fail(404, `no MCP set "${setId}"`);
    const members = s.sets[setId].members;
    const i = members.findIndex((m) => m.server === serverId);
    if (i < 0) fail(404, `${serverId} is not in this set`);
    members.splice(i, 1);
    await tx.write('sets');
    if (Object.hasOwn(s.secrets, setId) && Object.hasOwn(s.secrets[setId], serverId)) { setSecretsEntry(s, setId, serverId, {}); await tx.write('secrets'); }
    const key = `${setId}|${serverId}`;
    if (Object.hasOwn(s.tests, key)) { delete s.tests[key]; await tx.write('tests'); }
  });
}

/** Store one Test result (§4.5): Test connects outside the lock; this re-reads and writes only its entry.
 *  @returns {Promise<boolean>} false when the membership is gone (nothing written) */
export async function recordTest(setId, serverId, { at, ok, tools, error, fingerprint }) {
  return withMcpLock(async (tx) => {
    const s = tx.snapshot;
    if (!live(s, setId, serverId)) return false;
    s.tests[`${setId}|${serverId}`] = { at, ok, tools, error, fingerprint };
    await tx.write('tests');
    return true;
  });
}

/**
 * §4.5: first 16 hex of sha256 over the definition's hash, the plugin code (pinned sha7 | 'linked' |
 * null), the effective non-secret values and each secret's updatedAt (`secrets` = `{ key: updatedAt }`).
 * A linked plugin never matches: its results are always stale.
 */
export function testFingerprint({ def, code = null, values = {}, secrets = {} }) {
  if (code === 'linked') return randomBytes(8).toString('hex');
  return sha256Hex(canonicalJson({ def: sha256Hex(canonicalJson(def)), code, values, secrets })).slice(0, 16);
}

function checkManual(name, raw) {
  const { def, errors } = validateMcpDefinition(raw, { name, source: 'manual' });
  if (!def) throw Object.assign(new McpStoreError(400, errors.join('; ')), { errors });
  return def;
}

/** §4.1 manual definitions. `catalogNames` = the declared name of every catalog id (the caller's catalog). */
export async function addManualServer(name, rawDef, { catalogNames = [] } = {}) {
  const def = checkManual(name, rawDef);
  return withMcpLock(async (tx) => {
    const s = tx.snapshot;
    const held = Object.entries(s.bases).some(([id, base]) => base === name && id !== `manual:${name}`);
    if (Object.hasOwn(s.manual, name) || held || catalogNames.includes(name)) {
      fail(409, `the name "${name}" is taken — choose another`);
    }
    s.manual[name] = def;
    Object.assign(s.bases, assignBaseNames(s.bases, [`manual:${name}`]));
    await tx.write('servers');
    return def;
  });
}

// §4.6 field migration over the snapshot: a stored value (non-secret) or secret survives only while its
// key exists in `def` with the same secret flag — in user sets and in Team state (values, seeded).
function migrate(s, serverId, def) {
  const secret = map();
  for (const f of def.fields) secret[f.key] = f.secret;
  const prune = (obj, keepSecret) => {
    let hit = false;
    for (const k of Object.keys(obj ?? {})) if (!Object.hasOwn(secret, k) || secret[k] !== keepSecret) { delete obj[k]; hit = true; }
    return hit;
  };
  const dirty = { sets: false, secrets: false };
  for (const set of Object.values(s.sets)) for (const m of set.members) if (m.server === serverId && prune(m.values, false)) dirty.sets = true;
  for (const t of Object.values(s.teams)) {
    if (!Object.hasOwn(t.members, serverId)) continue;
    const values = prune(t.members[serverId].values, false);
    const seeded = prune(t.members[serverId].seeded, false);
    if (values || seeded) dirty.sets = true;
  }
  for (const [setId, bySet] of Object.entries(s.secrets)) {
    if (!Object.hasOwn(bySet, serverId) || !prune(bySet[serverId], true)) continue;
    setSecretsEntry(s, setId, serverId, bySet[serverId]);
    dirty.secrets = true;
  }
  return dirty;
}

async function writeMigration(tx, dirty) {
  if (dirty.sets) await tx.write('sets');
  if (dirty.secrets) await tx.write('secrets');
}

/** Manual Edit definition (§4.6): the name is the id and never changes; every membership migrates. */
export async function editManualServer(name, rawDef) {
  const def = checkManual(name, rawDef);
  return withMcpLock(async (tx) => {
    const s = tx.snapshot;
    if (!Object.hasOwn(s.manual, name)) fail(404, `no manual MCP server "${name}"`);
    await writeMigration(tx, migrate(s, `manual:${name}`, def));
    s.manual[name] = def;
    await tx.write('servers');
    return def;
  });
}

/** §4.6 field migration for a plugin update or a Team Update. Only `newDef` decides; `oldDef` is not needed. */
export async function migrateServerFields(serverId, oldDef, newDef) {
  return withMcpLock(async (tx) => writeMigration(tx, migrate(tx.snapshot, serverId, newDef)));
}

/** Manual Remove, Remove of a retired policy server, plugin uninstall (§4.6): every membership (Team state
 *  included), their secrets and tests, then the manual or policy definition. The base stays reserved. */
export async function removeServerEverywhere(serverId) {
  return withMcpLock(async (tx) => {
    const s = tx.snapshot;
    let sets = false;
    for (const set of Object.values(s.sets)) {
      const kept = set.members.filter((m) => m.server !== serverId);
      if (kept.length !== set.members.length) { set.members = kept; sets = true; }
    }
    for (const t of Object.values(s.teams)) if (Object.hasOwn(t.members, serverId)) { delete t.members[serverId]; sets = true; }
    if (sets) await tx.write('sets');
    const setIds = Object.keys(s.secrets).filter((id) => Object.hasOwn(s.secrets[id], serverId));
    for (const id of setIds) setSecretsEntry(s, id, serverId, {});
    if (setIds.length) await tx.write('secrets');
    const tests = Object.keys(s.tests).filter((k) => k.slice(k.indexOf('|') + 1) === serverId);
    for (const k of tests) delete s.tests[k];
    if (tests.length) await tx.write('tests');
    const rest = serverId.slice(serverId.indexOf(':') + 1);
    const defs = serverId.startsWith('manual:') ? s.manual : serverId.startsWith('policy:') ? s.policy : null;
    if (defs && Object.hasOwn(defs, rest)) { delete defs[rest]; await tx.write('servers'); }
  });
}

/**
 * §4.4: persist base names for `ids` lacking one (plugin install/link/update hooks, policy Install,
 * reconcile) and the Team records of `homes` lacking one (reconcile; teamRecordsFor).
 * @returns {Promise<Record<string,string>>} the new bases
 */
export async function assignBases(ids, { homes = [] } = {}) {
  return withMcpLock(async (tx) => {
    const s = tx.snapshot;
    const added = assignBaseNames(s.bases, ids);
    if (Object.keys(added).length) { Object.assign(s.bases, added); await tx.write('servers'); }
    const records = Object.entries(teamRecordsFor(s.teams, homes, allSlugs(s)));
    for (const [h, rec] of records) s.teams[h] = { ...rec, members: map() };
    if (records.length) await tx.write('sets');
    return added;
  });
}

/** Team consent writes (§11.2): `patch` ⊂ { enabled, values, seeded, consent }, each replacing its key.
 *  The caller has validated the values; the first write for a home persists its record. */
export async function setTeamState(homeSlug, serverId, patch) {
  return withMcpLock(async (tx) => {
    await persistBases(tx, [serverId]);
    const members = ensureTeam(tx.snapshot, homeSlug).members;
    const st = Object.hasOwn(members, serverId) ? members[serverId] : (members[serverId] = newTeamState());
    for (const k of ['enabled', 'values', 'seeded', 'consent']) if (patch[k] !== undefined) st[k] = patch[k];
    await tx.write('sets');
  });
}

/** Store a consented policy definition (§4.1 Policy) under `<homeSlug>/<name>`, and its base name. */
export async function putPolicyServer(key, { def, hash }) {
  return withMcpLock(async (tx) => {
    const s = tx.snapshot;
    s.policy[key] = { def, hash, installedAt: new Date().toISOString() };
    Object.assign(s.bases, assignBaseNames(s.bases, [`policy:${key}`]));
    await tx.write('servers');
  });
}

/** Forget (§11.2): a home's Team state, its Team set's secrets and tests — for `serverIds` (server and skill ids, skills
 *  registry §5; a list of skill ids alone writes only sets.json, as a skill holds no secret and no test), or all.
 *  Forgetting a whole home also drops its record, so a greyed Team set leaves the list. */
export async function forgetTeamState(homeSlug, serverIds) {
  if (serverIds !== undefined && !Array.isArray(serverIds)) fail(400, 'serverIds must be an array of server ids');
  return withMcpLock(async (tx) => {
    const s = tx.snapshot;
    if (!Object.hasOwn(s.teams, homeSlug)) return;
    const t = s.teams[homeSlug];
    const hit = (id) => serverIds === undefined || serverIds.includes(id);
    if (serverIds === undefined) delete s.teams[homeSlug];
    else {
      for (const id of Object.keys(t.members)) if (hit(id)) delete t.members[id];
      for (const id of Object.keys(t.skills ?? {})) if (hit(id)) delete t.skills[id];
      if (t.skills && !Object.keys(t.skills).length) delete t.skills;
    }
    await tx.write('sets');
    // A skill holds no secret and no test (skills registry §3.2): a list of skill ids alone writes only sets.json.
    if (serverIds !== undefined && serverIds.length && serverIds.every((id) => typeof id === 'string' && id.startsWith('skill:'))) return;
    if (Object.hasOwn(s.secrets, t.id)) for (const id of Object.keys(s.secrets[t.id])) if (hit(id)) setSecretsEntry(s, t.id, id, {});
    await tx.write('secrets');
    for (const k of Object.keys(s.tests)) if (k.startsWith(`${t.id}|`) && hit(k.slice(t.id.length + 1))) delete s.tests[k];
    await tx.write('tests');
  });
}

// ── Skills in sets (skills registry §3.2, §5) ────────────────────────────────

const isPluginSkillId = (id) => typeof id === 'string' && SKILL_ID_RE.test(id) && id.startsWith('skill:plugin:');

/**
 * Add a skill to a set or switch it (skills registry §3.2, §7). `entry` = the skill's catalog entry (the caller looked it
 * up). A user set (or General) holds a skill id at most once and a skill name at most once — the name is the id's last
 * part, so the check runs on the snapshot inside the lock. A Team set's skills derive from team policy: `team = { home }`,
 * the state lives in `teams[home].skills` (the first write persists the record), plugin skills only (F8); callers enforce
 * the Team locks (update only; a never-consented skill turns on only from the team checklist).
 */
export async function putSkillMember(setId, skillId, { enabled } = {}, { team, entry } = {}) {
  return withMcpLock(async (tx) => {
    const s = tx.snapshot;
    if (typeof skillId !== 'string' || !SKILL_ID_RE.test(skillId)) fail(400, 'invalid skill id');
    if (!isMap(entry) || entry.id !== skillId) fail(400, 'the skill catalog entry is required');
    if (enabled !== undefined && typeof enabled !== 'boolean') fail(400, 'enabled must be true or false');
    if (isTeamId(setId)) {
      const home = team?.home;
      if (typeof home !== 'string') fail(400, 'a Team set write needs its home');
      const rec = Object.hasOwn(s.teams, home) ? s.teams[home] : null;
      if ((rec?.id ?? teamRecord(home).id) !== setId) fail(404, `no Team set "${setId}" for ${home}`);
      if (!isPluginSkillId(skillId)) fail(400, 'Team set skills are plugin skills');
      const before = rec?.skills && Object.hasOwn(rec.skills, skillId) ? rec.skills[skillId] : null;
      const next = { ...(before ?? { enabled: false, consent: null }), enabled: enabled ?? before?.enabled === true };
      delete next.pending;
      if (before && canonicalJson(before) === canonicalJson(next)) return;
      const t = ensureTeam(s, home);
      if (!t.skills) t.skills = map();
      t.skills[skillId] = next;
      await tx.write('sets');
      return;
    }
    if (!Object.hasOwn(s.sets, setId)) fail(404, `no MCP set "${setId}"`);
    const set = s.sets[setId];
    const list = set.skills ?? [];
    const i = list.findIndex((k) => k.skill === skillId);
    const name = skillNameOf(skillId);
    if (i < 0 && list.some((k) => skillNameOf(k.skill) === name)) fail(409, `a skill named "${name}" is already in this set`);
    const before = i < 0 ? null : list[i];
    const next = { ...(before ?? { skill: skillId }), enabled: enabled ?? (before ? before.enabled === true : true) };
    delete next.pending;
    if (before && canonicalJson(before) === canonicalJson(next)) return;
    set.skills = i < 0 ? [...list, next] : list.map((k, j) => (j === i ? next : k));
    await tx.write('sets');
  });
}

/** Remove a skill from a user set or General (a Team set's skills come from team policy). The last one leaves no key. */
export async function deleteSkillMember(setId, skillId) {
  return withMcpLock(async (tx) => {
    const s = tx.snapshot;
    if (typeof skillId !== 'string') fail(400, 'invalid skill id');
    if (isTeamId(setId)) fail(400, 'Team set skills are not removed by hand');
    if (!Object.hasOwn(s.sets, setId)) fail(404, `no MCP set "${setId}"`);
    const set = s.sets[setId];
    const kept = (set.skills ?? []).filter((k) => k.skill !== skillId);
    if (kept.length === (set.skills ?? []).length) fail(404, `${skillId} is not in this set`);
    if (kept.length) set.skills = kept; else delete set.skills;
    await tx.write('sets');
  });
}

/** A skill leaves the registry (library Remove, plugin uninstall or update, skills registry §3.2, §5): every set's
 *  membership and every home's Team state, in one sets.json write — the caller removes the library entry and folder only
 *  after, under the skills lock (the two locks are never held together). */
export async function removeSkillEverywhere(skillId) {
  return withMcpLock(async (tx) => {
    const s = tx.snapshot;
    let hit = false;
    for (const set of Object.values(s.sets)) {
      if (!set.skills) continue;
      const kept = set.skills.filter((k) => k.skill !== skillId);
      if (kept.length === set.skills.length) continue;
      hit = true;
      if (kept.length) set.skills = kept; else delete set.skills;
    }
    for (const t of Object.values(s.teams)) {
      if (!t.skills || !Object.hasOwn(t.skills, skillId)) continue;
      hit = true;
      delete t.skills[skillId];
      if (!Object.keys(t.skills).length) delete t.skills;
    }
    if (hit) await tx.write('sets');
  });
}

/** Team skill consent writes (skills registry §5, F8): `patch` ⊂ { enabled, consent }, each replacing its key (consent is
 *  the consented hash, or null). Plugin skills only; the first write for a home persists its record. */
export async function setTeamSkillState(homeSlug, skillId, patch) {
  if (typeof homeSlug !== 'string') fail(400, 'a Team set write needs its home');
  if (!isPluginSkillId(skillId)) fail(400, 'Team set skills are plugin skills');
  if (!isMap(patch)) fail(400, 'patch must be an object');
  if (patch.enabled !== undefined && typeof patch.enabled !== 'boolean') fail(400, 'enabled must be true or false');
  if (patch.consent !== undefined && patch.consent !== null && typeof patch.consent !== 'string') fail(400, 'consent must be text or null');
  return withMcpLock(async (tx) => {
    const t = ensureTeam(tx.snapshot, homeSlug);
    if (!t.skills) t.skills = map();
    const st = Object.hasOwn(t.skills, skillId) ? t.skills[skillId] : (t.skills[skillId] = { enabled: false, consent: null });
    for (const k of ['enabled', 'consent']) if (patch[k] !== undefined) st[k] = patch[k];
    await tx.write('sets');
  });
}
