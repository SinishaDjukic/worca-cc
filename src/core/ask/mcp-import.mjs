// src/core/ask/mcp-import.mjs
// The chat's side of discovering and importing other tools' MCP servers (docs/mcp-servers.md "Import from other
// tools"). discover.mjs reads the files and keeps no secret value; this module turns its result into
// discover_mcp_servers' output (every env / header value masked), maps a discovered server onto the
// propose_mcp_change input slice 1 builds and screens, and validates kind "import" into ONE MCP card.
// Everything here came from other programs' files: names are clipped and cleaned, no free text is passed on.
import { validateMcpDefinition, SERVER_NAME_RE } from '../mcp/definitions.mjs';
import { DISCOVER_TOOLS, DISCOVER_LIMITS } from '../mcp/discover.mjs';
import { buildDefinition, defLines, effectsOf, cardLeaks, scrub, clip, MCP_ERRORS, MCP_PAGE, MASK } from './mcp-proposal.mjs';

export const MCP_IMPORT_MAX = 10;
/** discover_mcp_servers lists at most this many servers; moreServers counts the rest (import still finds them by id). */
export const MCP_VIEW_MAX = 100;
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v.trim() : '');
/** Text from another program's file, one line, no context markers. */
const clean = (s, n) => clip(s, n).replace(/\[(\/?)worca context\]/gi, '($1worca context)');
const idText = (v) => clean(v, 100);

export const MCP_IMPORT_ERRORS = Object.freeze({
  picks: `servers must list 1–${MCP_IMPORT_MAX} ids from discover_mcp_servers (each an id, or {"id": "…", "as": "<worca name>"})`,
  unknown: (id) => `no discovered server "${idText(id)}" — discover_mcp_servers shows them`,
  badName: (id, name) => `${idText(id)}: "${idText(name)}" is not a worca name (1–20 lowercase letters, digits or -, starting with a letter) — pass {"id": "${idText(id)}", "as": "<worca name>"}`,
  twice: (n) => `two picks would both be named "${n}" — give one another name with "as"`,
  taken: (n, id) => `${MCP_ERRORS.taken(n)}: pass {"id": "${idText(id)}", "as": "<new name>"}`,
  nothing: 'nothing to import: every picked server is already in worca or cannot be imported (see alreadyPresent and skipped)',
});
/** The same errors in a person's words, for Connectors › MCP servers' import (no chat tool, no JSON). */
export const MCP_IMPORT_UI_ERRORS = Object.freeze({
  picks: `pick 1–${MCP_IMPORT_MAX} servers to import`,
  unknown: (id) => `a picked server is no longer in the other tools' files (${idText(id)}) — list them again`,
  badName: (id, name) => `"${idText(name)}" is not a worca name (1–20 lowercase letters, digits or -, starting with a letter) — change it`,
  twice: (n) => `two picked servers would both be named "${n}" — give one another name`,
  taken: (n, _id) => `${MCP_ERRORS.taken(n)}`,
  nothing: 'nothing to import: every picked server is already in worca or cannot be imported',
});

/** A worca name for a file's server name, or '' when none can be made. */
export function suggestName(name) {
  const s = String(name ?? '').slice(0, 200).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-')
    .replace(/^[^a-z]+/, '').slice(0, 20).replace(/-+$/, '');
  return SERVER_NAME_RE.test(s) && s !== 'worca' ? s : '';
}

const literal = (v) => (typeof v === 'string' ? v : '');
const defTarget = (def) => (def?.type === 'stdio' ? `stdio\n${literal(def.command)}`
  : `remote\n${(Array.isArray(def?.url) ? def.url : [def?.url]).map(literal).join('')}`);
const rawTarget = (raw) => (raw.type === 'stdio' ? `stdio\n${raw.command || ''}` : `remote\n${raw.url || ''}`);

/** The registry entry this discovered server already is: one of `names` AND the same command (stdio) or URL. */
export function worcaMatch(raw, names, catalog) {
  const want = names.filter(Boolean);
  const t = rawTarget(raw);
  return catalog.find((e) => want.some((n) => e.base === n || e.name === n) && defTarget(e.def) === t) || null;
}

/** A discovered server → propose_mcp_change add input, plus problems (block the import) and notes (card warnings). */
export function importInput(raw) {
  const problems = [...(raw.problems || [])];
  const notes = [...(raw.notes || [])];
  const value = (v, where) => {
    if (!isObj(v) || v.invalid) { problems.push(`${where} is not text`); return null; }
    if (v.secret) {
      if (v.ref) notes.push(`${where} was the variable ${clean(v.ref, 60)}: worca passes only MCP_ variables, so pick one (such as MCP_${clean(v.ref, 40).toUpperCase().replace(/[^A-Z0-9_]/g, '_')}) or paste the value`);
      return { secret: true, ...(v.prefix ? { prefix: v.prefix } : {}) };
    }
    if (v.text.includes('${')) { problems.push(`${where} uses \${…} inside a longer value — worca keeps only a whole value as a secret field`); return null; }
    return v.text;
  };
  const map = (m, what) => {
    const out = {};
    for (const [k, v] of Object.entries(m || {})) { const s = value(v, `${what} ${clean(k, 60)}`); if (s !== null) out[k] = s; }
    return out;
  };
  if (raw.type === 'stdio') {
    const args = [];
    for (const [i, a] of (raw.args || []).entries()) {
      if (isObj(a) && a.secret) problems.push(`argument ${i + 1} looks like a secret — worca cannot keep a secret in an argument; pass it through env instead`);
      else if (typeof a !== 'string') problems.push(`argument ${i + 1} is not text`);
      else if (a.includes('${')) problems.push(`argument ${i + 1} uses \${…} — worca does not expand variables in arguments`);
      else args.push(a);
    }
    return { input: { type: 'stdio', command: raw.command || '', args, env: map(raw.env, 'env') }, problems, notes };
  }
  if (raw.type === 'http' || raw.type === 'sse') {
    if (raw.urlSecret) problems.push(`its URL carries a secret (in its login, path or query) — add it on ${MCP_PAGE} with a secret field instead`);
    else if ((raw.url || '').includes('${')) problems.push('its URL uses ${…} — worca does not expand variables in a URL');
    return { input: { type: raw.type, url: raw.url || '', headers: map(raw.headers, 'header') }, problems, notes };
  }
  // discover.mjs already named an unknown transport (a fixed word list, never the file's text).
  if (!problems.length) problems.push('it names no transport worca has (stdio, http, sse)');
  return { input: null, problems, notes };
}

const fromLabel = (raw) => `${DISCOVER_TOOLS[raw.tool] || raw.tool} · ${raw.source}${raw.scope === 'local' ? ` (local to ${raw.project})` : ''}`;
const plain = (s) => (isObj(s) ? MASK : clean(scrub(s), DISCOVER_LIMITS.argChars));

/** discover_mcp_servers: what was found, with every env / header value masked and no free text. */
export function discoveryView(disc, catalog) {
  const values = (m) => Object.fromEntries(Object.entries(m || {}).map(([k, v]) => [clean(scrub(k), 80),
    { value: MASK, secret: !!(v && v.secret), ...(v && v.ref ? { ref: clean(v.ref, 80) } : {}) }]));
  return {
    servers: disc.servers.slice(0, MCP_VIEW_MAX).map((raw) => {
      const suggested = suggestName(raw.name);
      const present = worcaMatch(raw, [suggested, raw.name], catalog);
      const { problems, notes } = importInput(raw);
      const env = values(raw.env); const headers = values(raw.headers);
      const hasSecrets = [...Object.values(raw.env || {}), ...Object.values(raw.headers || {})].some((v) => v && v.secret)
        || !!raw.urlSecret || !!raw.commandSecret || (raw.args || []).some((a) => isObj(a) && a.secret);
      return {
        id: raw.id, tool: DISCOVER_TOOLS[raw.tool] || raw.tool, scope: raw.scope, ...(raw.project ? { project: raw.project } : {}), source: raw.source,
        name: clean(raw.name, 60), suggestedName: suggested || null, transport: raw.type || 'unknown',
        ...(raw.type === 'stdio' ? { command: plain(raw.command || ''), args: (raw.args || []).map(plain) } : raw.type ? { url: plain(raw.url || '') } : {}),
        ...(Object.keys(env).length ? { env } : {}), ...(Object.keys(headers).length ? { headers } : {}),
        hasSecrets,
        inWorca: !!present, ...(present ? { worcaName: present.base } : {}),
        ...(!present && suggested && catalog.some((e) => e.base === suggested || e.name === suggested) ? { nameTaken: true } : {}),
        importable: !present && !problems.length,
        ...(problems.length ? { problems: problems.map((p) => clean(scrub(p), 200)) } : {}),
        ...(notes.length ? { notes: notes.map((p) => clean(scrub(p), 200)) } : {}),
      };
    }),
    files: disc.files.map((f) => ({ tool: DISCOVER_TOOLS[f.tool] || f.tool, source: f.source, status: f.status,
      ...(f.status === 'ok' ? { servers: f.servers || 0 } : {}), ...(f.truncated ? { truncated: true } : {}), ...(f.error ? { error: f.error } : {}) })),
    ...(disc.servers.length > MCP_VIEW_MAX ? { moreServers: disc.servers.length - MCP_VIEW_MAX } : {}),
    howTo: `Read-only: nothing in those files changes. Import servers with propose_mcp_change kind "import" (servers: ids, or {"id", "as"} to give one a worca name). A secret becomes an empty secret field the user fills in on ${MCP_PAGE}; applying adds definitions only, in no set.`,
  };
}

/**
 * kind "import" of propose_mcp_change (bound as createMcpChangeValidator's importChange).
 * @param {{ discover: (o:{pin:object|null}) => Promise<{servers:object[], files:object[]}>, catalog: () => Promise<object[]>,
 *   nameTaken: (name:string) => Promise<boolean>, engines: (name:string, def:object) => {on:string[], off:object[]},
 *   errors?: typeof MCP_IMPORT_ERRORS }} r  errors: the wording table (default the chat's; MCP_IMPORT_UI_ERRORS for Settings)
 */
export function createMcpImportValidator(r) {
  const E = r.errors ?? MCP_IMPORT_ERRORS;
  const fail = (errors, extra) => ({ ok: false, errors: errors.map(scrub), ...extra });
  return async function validateMcpImport(inp, { pin = null } = {}) {
    const picks = Array.isArray(inp.servers) ? inp.servers : [];
    if (!picks.length || picks.length > MCP_IMPORT_MAX) return fail([E.picks], {});
    const [disc, cat] = await Promise.all([r.discover({ pin }), r.catalog()]);
    const byId = new Map(disc.servers.map((s) => [s.id, s]));
    const errors = []; const adds = []; const alreadyPresent = []; const skipped = []; const names = new Set();
    for (const p of picks) {
      const id = typeof p === 'string' ? p.trim() : isObj(p) ? str(p.id) : '';
      const as = isObj(p) ? str(p.as) : '';
      const raw = byId.get(id);
      if (!raw) { errors.push(E.unknown(id)); continue; }
      const from = fromLabel(raw);
      const name = as || suggestName(raw.name);
      const present = worcaMatch(raw, [name, suggestName(raw.name), raw.name], cat);
      if (present) { alreadyPresent.push({ id, name: present.base, from }); continue; }
      if (!SERVER_NAME_RE.test(name) || name === 'worca') { errors.push(E.badName(id, name || raw.name)); continue; }
      if (names.has(name)) { errors.push(E.twice(name)); continue; }
      names.add(name);
      if (await r.nameTaken(name)) { errors.push(E.taken(name, id)); continue; }
      const { input, problems, notes } = importInput(raw);
      if (problems.length) { skipped.push({ id, name, from, reasons: problems.map((x) => clean(scrub(x), 200)) }); continue; }
      const built = buildDefinition(input, null);
      const checked = validateMcpDefinition(built.def, { name, source: 'manual' });
      const all = [...built.errors, ...checked.errors];
      if (all.length) { skipped.push({ id, name, from, reasons: all.map((x) => clean(scrub(x), 200)) }); continue; }
      adds.push({ name, def: checked.def, from, notes: [...notes, ...built.warnings] });
    }
    const extra = { alreadyPresent, skipped };
    if (errors.length) return fail(errors, extra);
    if (!adds.length) return fail([E.nothing], extra);
    const note = clip(str(inp.note), 200);
    const list = adds.map((a) => a.name).join(', ');
    const card = {
      type: 'mcp', kind: 'import', ...(note ? { note } : {}), target: list,
      summary: `Import ${adds.length === 1 ? 'MCP server' : `${adds.length} MCP servers`}: ${list}`,
      changes: adds.flatMap((a) => [{ op: 'add', label: `${a.name} · From`, after: a.from },
        ...defLines(a.def).map((l) => ({ op: 'add', label: `${a.name} · ${l.label}`, after: l.value }))]),
      warnings: [
        ...adds.flatMap((a) => [
          ...a.notes.map((n) => `${a.name}: ${n}`),
          ...(a.def.fields || []).filter((f) => f.secret).map((f) => `${a.name}: ${f.label} is an empty secret field — the value in ${a.from.split(' · ')[0]} is not copied; paste it or pick an MCP_ variable on ${MCP_PAGE}`),
        ]),
        ...skipped.map((s) => `Not imported: ${s.name || s.id} (${s.from}) — ${s.reasons.join('; ')}`),
      ],
      effects: adds.flatMap((a) => effectsOf(a.name, a.def, r.engines).map((e, i) => (i ? `${a.name}: ${e}` : e))),
      alreadyPresent,
      change: { servers: adds.map(({ name, def }) => ({ name, def })) },
    };
    if (cardLeaks(card)) return fail([MCP_ERRORS.cardSecret], extra);
    return { ok: true, card, ...extra };
  };
}
