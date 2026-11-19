// src/core/ask/mcp-proposal.mjs
// The ONE validator behind mcp__worca__propose_mcp_change, the chat's view of a definition, and the event/notice
// text of the MCP card (docs/mcp-servers.md "Chat"). Pure: the catalog, the name check and the engine rule are
// injected (mcp-deps.mjs binds the real ones), so the MCP child validates for the model's self-correction and the
// parent turn re-validates authoritatively. Nothing here writes; applying a card is the cards route's business.
//
// Why a card: a stdio definition is a command worca runs on this machine, and an http one names a host chats and
// runs connect to. Secrets never pass through here: a secret is an empty secret field the user fills in each set
// on Connectors › MCP servers, by pasting a value or picking an MCP_ variable. A value the model sends for a
// secret-named key is dropped, never echoed.
import { validateMcpDefinition, canonicalJson, defDigest, MCP_ENV_VAR_RE } from '../mcp/definitions.mjs';
import { SECRET_NAME_RE, hasTokenShape } from '../mcp-secrets.mjs';
import { looksLikeSecret } from '../policy/registry.mjs';

export const MCP_CHANGE_KINDS = Object.freeze(['add', 'edit', 'remove', 'import']);
export const MCP_PAGE = 'Connectors › MCP servers';
export const MASK = '••••';

export const MCP_ERRORS = Object.freeze({
  kind: `kind must be one of ${MCP_CHANGE_KINDS.join(', ')}`,
  importOff: 'importing from other tools is unavailable here',
  name: 'name is required: the new server name (add), or the name or id list_mcp_servers shows (edit, remove)',
  unknown: (n) => `no MCP server "${shown(n)}" — list_mcp_servers shows them`,
  readOnly: (n, origin) => `"${n}" comes from ${origin} and is read-only here — only Manual servers can be edited or removed from chat`,
  taken: (n) => `the name "${n}" is taken — choose another`,
  slot: (where) => `${where} must be text or {"secret": true}`,
  partialRef: (where) => `${where}: \${…} works only as the whole value of an env or header — send {"secret": true} for it instead`,
  looksSecret: (where) => `${where} looks like a secret — send {"secret": true} for its env or header; the user pastes the value or picks an MCP_ variable on ${MCP_PAGE}`,
  argSecret: (where) => `${where} looks like a secret — a secret cannot be an argument: pass it through env with {"secret": true}`,
  unknownField: (where, k) => `${where}: field "${shown(k)}" is not declared by the stored definition`,
  masked: (where) => `${where} is ${MASK}: send ${MASK} back only where list_mcp_servers showed it, to keep the stored value there — otherwise send the real value`,
  noChange: 'nothing changes — the stored definition already says exactly this',
  cardSecret: 'the card would carry a value that looks like a secret — leave it out (the note too) and send {"secret": true} for its env or header',
});

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
// eslint-disable-next-line no-control-regex
const BREAKS_RE = /[\x00-\x1f\x7f-\x9f\u2028\u2029]/g;
export const clip = (v, n) => String(v ?? '').replace(BREAKS_RE, ' ').slice(0, n);
const WHOLE_REF_RE = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/;
const AUTH_PREFIX_RE = /^(?:Bearer|Basic|Token)\s+/i;
/** One value the chat may never show or store: a known token shape, a JWT, or a long opaque string. */
export const secretish = (s) => typeof s === 'string' && (looksLikeSecret(s) || hasTokenShape(s));
/** Model-supplied text an error may quote (a name, a field key, an env or header name): short, one line, masked. */
const shown = (v) => (secretish(String(v ?? '')) ? MASK : clip(v, 60));
/** Free text from the store or a result (an error, a detail) with every secret-looking word masked. */
export const scrub = (s) => String(s ?? '').split(/([\s"'`,;()]+)/).map((w) => (secretish(w) ? MASK : w)).join('');

/** The Settings form's field key for an env / header name (ui/public/mcp-definition-form.mjs fieldKeyFor, pinned
 *  by a parity test), made unique ignoring case: the form refuses a clash, the chat numbers it. */
export function fieldKeyFor(name, taken = []) {
  const base = (String(name).replace(/[^A-Za-z0-9_]/g, '_').replace(/^[^A-Za-z]+/, '') || 'field').slice(0, 32);
  const lower = new Set(taken.map((k) => k.toLowerCase()));
  if (!lower.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) {
    const k = `${base.slice(0, 32 - String(i).length - 1)}_${i}`;
    if (!lower.has(k.toLowerCase())) return k;
  }
}

// ---- input → definition ------------------------------------------------------------------------------------
/** A literal the chat may not show: secret-looking, or the value of a secret-named env / header key (a Manual
 *  definition written by hand on disk can hold `API_KEY: 'short'`, which `secretish` alone does not flag). */
const hideLiteral = (v, key) => secretish(v) || (typeof key === 'string' && SECRET_NAME_RE.test(key));

/** The slot of `def` at `at` (['command'], ['args', i], ['env', k], ['headers', k], ['url', i | null]). */
function slotAt(def, [part, k]) {
  if (part === 'command') return def?.command;
  if (part === 'url') return Array.isArray(def?.url) ? (k === null ? undefined : def.url[k]) : (k === null ? def?.url : undefined);
  const m = def?.[part];
  return isObj(m) || Array.isArray(m) ? (Object.hasOwn(m, k) ? m[k] : undefined) : undefined;
}
/** True when the stored definition holds, at `at`, a literal the chat showed as MASK. */
function maskedAt(stored, at) {
  const v = slotAt(stored, at);
  return typeof v === 'string' && hideLiteral(v, at[0] === 'env' || at[0] === 'headers' ? at[1] : null);
}
/** Rebuild `def` with `fn(value, at)` applied to every literal-capable slot. */
function mapSlots(def, fn) {
  const out = { ...def };
  if (def.type === 'stdio') {
    out.command = fn(def.command, ['command']);
    out.args = (def.args || []).map((a, i) => fn(a, ['args', i]));
    out.env = Object.fromEntries(Object.entries(def.env || {}).map(([k, v]) => [k, fn(v, ['env', k])]));
  } else {
    out.url = Array.isArray(def.url) ? def.url.map((p, i) => fn(p, ['url', i])) : fn(def.url, ['url', null]);
    out.headers = Object.fromEntries(Object.entries(def.headers || {}).map(([k, v]) => [k, fn(v, ['headers', k])]));
  }
  return out;
}
/** An edit card's definition carries MASK where the chat sent the masked stored literal back (so the card holds
 *  no stored literal). This puts the stored literal back at each such slot; null when a MASK has none to keep.
 *  The cards route applies the result with the card's digest, so the stored definition read here is the one the
 *  digest pinned. */
export function keepMasked(def, stored) {
  let bad = false;
  const out = mapSlots(def, (v, at) => {
    if (v !== MASK) return v;
    if (!maskedAt(stored, at)) { bad = true; return v; }
    return slotAt(stored, at);
  });
  return bad ? null : out;
}
/** `def` with MASK back at every slot where `input` (the built definition) sent MASK. */
const remask = (def, input) => mapSlots(def, (v, at) => (slotAt(input, at) === MASK ? MASK : v));

/** MASK at `at`: kept (an edit whose stored definition hides a literal there), else an error. */
function maskSlot(where, at, ctx) {
  if (ctx.stored && maskedAt(ctx.stored, at)) return MASK;
  ctx.errors.push(MCP_ERRORS.masked(where)); return null;
}

/** A field ref the stored definition (edit) already declares, kept with its declaration. */
function storedRef(where, v, ctx) {
  const f = (ctx.stored?.fields || []).find((x) => x.key === v.field);
  if (!f) { ctx.errors.push(MCP_ERRORS.unknownField(where, v.field)); return null; }
  if (!ctx.fields.some((x) => x.key === f.key)) ctx.fields.push(f);
  return { field: f.key, ...(typeof v.prefix === 'string' && v.prefix ? { prefix: v.prefix } : {}), ...(typeof v.suffix === 'string' && v.suffix ? { suffix: v.suffix } : {}) };
}

/** An empty secret field for env / header `key`; an edit reuses the stored secret field of the same label. */
function secretField(key, prefix, ctx) {
  const kept = (ctx.stored?.fields || []).find((f) => f.secret && f.label === key && !ctx.fields.some((x) => x.key === f.key));
  const f = kept || { key: fieldKeyFor(key, ctx.fields.map((x) => x.key)), label: key, secret: true, required: true };
  ctx.fields.push(f);
  return { field: f.key, ...(prefix ? { prefix } : {}) };
}

/** One env or header value → a slot (text or a field ref), or null after recording an error. */
function mapSlot(where, key, v, ctx, at) {
  if (v === MASK) return maskSlot(where, at, ctx);
  if (isObj(v)) {
    if (typeof v.field === 'string') return storedRef(where, v, ctx);
    // An import keeps a secret header's auth scheme ("Bearer "): only the three schemes, never free text.
    if (v.secret === true) return secretField(key, typeof v.prefix === 'string' && /^(?:Bearer|Basic|Token) $/i.test(v.prefix) ? v.prefix : '', ctx);
    ctx.errors.push(MCP_ERRORS.slot(where)); return null;
  }
  if (typeof v !== 'string') { ctx.errors.push(MCP_ERRORS.slot(where)); return null; }
  const ref = WHOLE_REF_RE.exec(v.trim());
  if (ref) {
    const pick = MCP_ENV_VAR_RE.test(ref[1]) ? ref[1] : `an MCP_ variable such as MCP_${ref[1].toUpperCase()}`;
    ctx.warnings.push(`${where} was \${${ref[1]}}: worca passes only MCP_ variables — on ${MCP_PAGE} pick ${pick} for it, or paste the value`);
    return secretField(key, '', ctx);
  }
  if (v.includes('${')) { ctx.errors.push(MCP_ERRORS.partialRef(where)); return null; }
  if (SECRET_NAME_RE.test(key)) {
    const prefix = (AUTH_PREFIX_RE.exec(v) || [''])[0];
    if (v.slice(prefix.length).trim()) ctx.warnings.push(`the value given for ${where} was left out — the user pastes it or picks an MCP_ variable on ${MCP_PAGE}`);
    return secretField(key, prefix, ctx);
  }
  if (secretish(v)) { ctx.errors.push(MCP_ERRORS.looksSecret(where)); return null; }
  return v;
}

function mapOf(what, raw, ctx) {
  if (raw === undefined || raw === null) return {};
  if (!isObj(raw)) { ctx.errors.push(`${what} must be an object of name → value`); return {}; }
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    const slot = mapSlot(`${what === 'env' ? 'env' : 'header'} ${shown(k)}`, k, v, ctx, [what, k]);
    if (slot !== null) out[k] = slot;
  }
  return out;
}

/** Arguments and URL parts are text, or (edit) a stored ref; a secret never goes there. */
function plainSlot(where, v, ctx, { arg = false, at } = {}) {
  if (v === MASK) return maskSlot(where, at, ctx);
  if (isObj(v) && typeof v.field === 'string') return storedRef(where, v, ctx);
  if (typeof v !== 'string') { ctx.errors.push(`${where} must be text`); return null; }
  if (v.includes('${')) { ctx.errors.push(MCP_ERRORS.partialRef(where)); return null; }
  if (arg && secretish(v)) { ctx.errors.push(MCP_ERRORS.argSecret(where)); return null; }
  return v;
}

/** The model's input → a raw §4.1 definition for validateMcpDefinition, plus warnings and errors. On an edit a
 *  slot sent as MASK, where the stored definition hides a literal, stays MASK: keepMasked fills it in. */
export function buildDefinition(inp, stored = null) {
  const ctx = { fields: [], stored, warnings: [], errors: [] };
  const type = str(inp.type) || stored?.type || '';
  const def = { type, fields: ctx.fields, description: clip(str(inp.description ?? stored?.description ?? ''), 200) };
  if (type === 'stdio') {
    def.command = str(inp.command) === MASK ? maskSlot('command', ['command'], ctx) : str(inp.command);
    def.args = (Array.isArray(inp.args) ? inp.args : []).map((a, i) => plainSlot(`args[${i}]`, a, ctx, { arg: true, at: ['args', i] })).filter((a) => a !== null);
    def.env = mapOf('env', inp.env, ctx);
  } else if (type === 'http' || type === 'sse') {
    const url = Array.isArray(inp.url) ? inp.url.map((p, i) => plainSlot(`url[${i}]`, p, ctx, { at: ['url', i] })).filter((p) => p !== null)
      : plainSlot('url', inp.url ?? '', ctx, { at: ['url', null] });
    def.url = url;
    def.headers = mapOf('headers', inp.headers, ctx);
  }
  return { def, warnings: ctx.warnings, errors: ctx.errors };
}

// ---- definition → what the chat and the card show ------------------------------------------------------------
/** One slot as text: a literal word for word (masked if it must stay hidden), a field ref as {KEY: …}. */
export function slotText(v, fields = [], key = null) {
  if (typeof v === 'string') return hideLiteral(v, key) ? MASK : v;
  if (isObj(v) && typeof v.field === 'string') {
    const f = fields.find((x) => x.key === v.field);
    return `${v.prefix || ''}{${v.field}: ${f?.secret ? 'secret' : 'value'}, filled in each set}${v.suffix || ''}`;
  }
  return '';
}

/** The labelled lines of a definition, in the order the card shows them. */
export function defLines(def) {
  const f = def.fields || [];
  const out = [{ label: 'Type', value: def.type }];
  if (def.type === 'stdio') {
    out.push({ label: 'Command', value: slotText(def.command, f) });
    (def.args || []).forEach((a, i) => out.push({ label: `Argument ${i + 1}`, value: slotText(a, f) }));
    for (const [k, v] of Object.entries(def.env || {})) out.push({ label: `env ${k}`, value: slotText(v, f, k) });
  } else {
    out.push({ label: 'URL', value: (Array.isArray(def.url) ? def.url : [def.url]).map((p) => slotText(p, f)).join('') });
    for (const [k, v] of Object.entries(def.headers || {})) out.push({ label: `header ${k}`, value: slotText(v, f, k) });
  }
  if (def.description) out.push({ label: 'Description', value: def.description });
  return out;
}

/** A definition as list_mcp_servers returns it: round-trips into propose_mcp_change kind "edit". */
export function describeForChat(def) {
  const f = def.fields || [];
  const slot = (v, key = null) => (typeof v === 'string' ? (hideLiteral(v, key) ? MASK : v)
    : { field: v.field, ...(f.find((x) => x.key === v.field)?.secret ? { secret: true } : {}), ...(v.prefix ? { prefix: v.prefix } : {}), ...(v.suffix ? { suffix: v.suffix } : {}) });
  const map = (m) => Object.fromEntries(Object.entries(m || {}).map(([k, v]) => [k, slot(v, k)]));
  return {
    type: def.type,
    ...(def.type === 'stdio' ? { command: slot(def.command), args: (def.args || []).map((a) => slot(a)), env: map(def.env) }
      : { url: Array.isArray(def.url) ? def.url.map((p) => slot(p)) : slot(def.url), headers: map(def.headers) }),
    fields: f.map(({ key, label, secret, required }) => ({ key, label, secret: !!secret, required: !!required })),
    ...(def.description ? { description: def.description } : {}),
  };
}

/** Every string inside v, keys included. */
function* strings(v) {
  if (typeof v === 'string') yield v;
  else if (Array.isArray(v)) for (const x of v) yield* strings(x);
  else if (isObj(v)) for (const [k, x] of Object.entries(v)) { yield k; yield* strings(x); }
}
/** The last check before a card leaves: no string in it may look like a secret (fail closed). */
export function cardLeaks(card) {
  for (const s of strings(card)) if (secretish(s)) return true;
  return false;
}

// ---- the validator -----------------------------------------------------------------------------------------
function hostOf(def) {
  const first = Array.isArray(def.url) ? def.url[0] : def.url;
  try { return typeof first === 'string' ? new URL(first).host : ''; } catch { return ''; }
}

export function effectsOf(name, def, engines) {
  const fx = [def.type === 'stdio'
    ? `Applying saves the definition only. Worca runs "${defLines(def).filter((l) => l.label === 'Command' || l.label.startsWith('Argument ')).map((l) => l.value).join(' ')}" on this machine, as the user worca runs as, only once ${name} is turned on in a set on ${MCP_PAGE}`
    : `Applying saves the definition only. Chats and runs connect to ${hostOf(def) || 'its URL'} only once ${name} is turned on in a set on ${MCP_PAGE}`];
  const { on, off } = engines(name, def);
  fx.push(`Engines that can use it: ${on.join(', ') || 'none'}`);
  for (const o of off) fx.push(`Not on ${o.engine}: ${o.reason}`);
  return fx;
}

/**
 * @param {{ catalog: () => Promise<Array<{id:string, source:'manual'|'plugin'|'policy', name:string, base:string,
 *   sourceLabel:string, def:object, inSets:string[]}>>, nameTaken: (name:string) => Promise<boolean>,
 *   engines: (name:string, def:object) => {on:string[], off:Array<{engine:string, reason:string}>},
 *   importChange?: (input:object, opts:{pin:object|null}) => Promise<object> }} r
 */
export function createMcpChangeValidator(r) {
  // D19: registry errors quote the model's input (a name, an env key); every error is scrubbed before it returns.
  const fail = (errors) => ({ ok: false, errors: errors.map(scrub) });
  // change.expect is the stored definition's sha256 digest: long hex by design, never a value, so it is not screened.
  const done = (card) => (cardLeaks({ ...card, change: { ...card.change, expect: undefined } }) ? fail([MCP_ERRORS.cardSecret]) : { ok: true, card });

  return async function validateMcpChange(input, { pin = null } = {}) {
    const inp = isObj(input) ? input : {};
    const kind = str(inp.kind);
    if (!MCP_CHANGE_KINDS.includes(kind)) return fail([MCP_ERRORS.kind]);
    // import (mcp-import.mjs): discovered servers from other tools' files, re-read here for the chat's pinned scope.
    if (kind === 'import') return typeof r.importChange === 'function' ? r.importChange(inp, { pin }) : fail([MCP_ERRORS.importOff]);
    const name = str(inp.name);
    if (!name) return fail([MCP_ERRORS.name]);
    const note = clip(str(inp.note), 200);
    const base = { type: 'mcp', kind, ...(note ? { note } : {}) };

    if (kind === 'add') {
      const built = buildDefinition(inp, null);
      const { def, errors } = validateMcpDefinition(built.def, { name, source: 'manual' });
      const all = [...built.errors, ...errors];
      if (!all.length && await r.nameTaken(name)) all.push(MCP_ERRORS.taken(name));
      if (all.length) return fail(all);
      return done({ ...base, target: name, serverId: `manual:${name}`, summary: `Add MCP server ${name} (${def.type})`,
        changes: defLines(def).map((l) => ({ op: 'add', label: l.label, after: l.value })),
        warnings: built.warnings, effects: effectsOf(name, def, r.engines), change: { name, def } });
    }

    const cat = await r.catalog();
    const entry = cat.find((e) => e.id === name) || cat.find((e) => e.source === 'manual' && e.name === name) || cat.find((e) => e.base === name);
    if (!entry) return fail([MCP_ERRORS.unknown(name)]);
    if (entry.source !== 'manual') return fail([MCP_ERRORS.readOnly(entry.base, entry.source === 'plugin' ? `the plugin ${entry.sourceLabel}` : entry.sourceLabel)]);
    // The card pins the stored definition by digest: it never carries a stored literal the chat masks.
    const expect = defDigest(entry.def);

    if (kind === 'remove') {
      const sets = entry.inSets.length ? `It leaves ${entry.inSets.join(', ')}. ` : '';
      return done({ ...base, target: entry.name, serverId: entry.id, summary: `Remove MCP server ${entry.name}`,
        changes: defLines(entry.def).map((l) => ({ op: 'remove', label: l.label, before: l.value })),
        warnings: [], effects: [`${sets}Its values, secrets and test results go.`],
        change: { name: entry.name, serverId: entry.id, expect } });
    }

    // edit: the WHOLE new definition, as list_mcp_servers returned it.
    const built = buildDefinition(inp, entry.def);
    if (built.errors.length) return fail(built.errors);
    const { def, errors } = validateMcpDefinition(keepMasked(built.def, entry.def), { name: entry.name, source: 'manual' });
    if (errors.length) return fail(errors);
    if (canonicalJson(def) === canonicalJson(entry.def)) return fail([MCP_ERRORS.noChange]);
    const before = new Map(defLines(entry.def).map((l) => [l.label, l.value]));
    const after = new Map(defLines(def).map((l) => [l.label, l.value]));
    const changes = [];
    for (const [label, v] of after) {
      if (!before.has(label)) changes.push({ op: 'add', label, after: v });
      else if (before.get(label) !== v) changes.push({ op: 'change', label, before: before.get(label), after: v });
    }
    for (const [label, v] of before) if (!after.has(label)) changes.push({ op: 'remove', label, before: v });
    const gone = (entry.def.fields || []).filter((f) => f.secret && !def.fields.some((x) => x.key === f.key && x.secret));
    const warnings = [...built.warnings, ...gone.map((f) => `secret field ${f.label} goes: the value each set stored for it is dropped`)];
    // D18: a stored secret that stays while the command line or URL changes now goes to the NEW destination; one
    // that stays while an env / header entry is added or changed (NODE_OPTIONS, LD_PRELOAD, a proxy) can be read
    // by new code or routed elsewhere. Its own row is unchanged, so `changes` does not show it: say it in a warning.
    const target = (d) => defLines(d).filter((l) => l.label === 'Command' || l.label.startsWith('Argument ') || l.label === 'URL').map((l) => l.value).join(' ');
    const moved = target(def) !== target(entry.def);
    const envRows = changes.filter((c) => c.op !== 'remove' && /^(env|header) /.test(c.label)).map((c) => c.label);
    if (moved || envRows.length) {
      const kept = def.fields.filter((f) => f.secret && (entry.def.fields || []).some((x) => x.key === f.key && x.secret));
      const stored = entry.inSets.length ? ` (stored in ${entry.inSets.join(', ')})` : '';
      const to = def.type === 'stdio' ? `the command "${target(def)}"` : (hostOf(def) || 'the new URL');
      for (const f of kept) {
        warnings.push(moved ? `secret ${f.label}${stored} will now be given to ${to}`
          : `secret ${f.label}${stored} stays while ${envRows.join(', ')} change: check them before applying`);
      }
    }
    return done({ ...base, target: entry.name, serverId: entry.id, summary: `Edit MCP server ${entry.name}`,
      changes, warnings, effects: effectsOf(entry.name, def, r.engines), change: { name: entry.name, serverId: entry.id, def: remask(def, built.def), expect } });
  };
}

const eventText = (s, n) => clip(s, n).replace(/"/g, "'").replace(/\[(\/?)worca context\]/gi, '($1worca context)');

/** `[worca event] …` — the synthetic turn's prompt after the user acted on an MCP card. */
export function mcpEventPrompt({ cardId, state, card = {}, result = null }) {
  const summary = eventText(card.summary, 200);
  if (state === 'declined') return `[worca event] mcp card ${cardId} declined; "${summary}"`;
  if (state === 'failed') return `[worca event] mcp card ${cardId} failed: ${eventText(scrub(result?.error || 'unknown error'), 200)}; "${summary}"`;
  return `[worca event] mcp card ${cardId} applied; "${summary}"${result?.detail ? `; ${eventText(scrub(result.detail), 300)}` : ''}`;
}

/** The user-row notice above the event turn. */
export function mcpNoticeText({ state, card = {}, result = null }) {
  const s = clip(card.summary, 160);
  if (state === 'declined') return `Declined — ${s}`;
  if (state === 'failed') return `Could not apply — ${s}: ${clip(scrub(result?.error || 'unknown error'), 200)}`;
  return `Applied — ${s}${result?.detail ? ` · ${clip(scrub(result.detail), 200)}` : ''}`;
}
