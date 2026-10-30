// src/core/ticket-updates-routes.mjs — Ticket updates' host routes (plans/ticket-updates-design.md §5, D8), behind the
// `ticketUpdates` flag. The manage sheet reads and saves here; listProjects, listStatuses and legacyMove run in the server
// through callSource with the saved profile, never from the browser (POST /api/sources/call's allowlist is unchanged).
import { requireFlag } from './flags.mjs';
import { callSource as shimCallSource } from './plugin-shim.mjs';
import { listProfiles, isValidProfileId, redactedConfig, readTicketUpdates, writeTicketUpdates, DEFAULT_PROFILE } from './plugin-config.mjs';
import { actorOf } from './identity.mjs';
import { reachSentence } from './source-reach.mjs';
import { validateTicketUpdates, TU_CATEGORIES, TU_LIMITS } from './ticket-updates.mjs';

/** listProjects pages up to 2,000 Jira Cloud projects (§3, A6-D14). */
export const LIST_PROJECTS_TIMEOUT_MS = 60_000;
export const CANNOT_UPDATE = 'This plugin cannot update tickets.';

const isBag = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);
/** The shim's answer for a disabled plugin (plugin-shim.mjs): `plugin "<name>" is disabled — …`. */
const DISABLED = /^plugin "[^"]+" is disabled\b/;
/** A project key as a tracker names it: 1 to 100 characters, never "." or "..", no slash, backslash, "?", "#", "%" or control
 *  character (it lands in a URL path in the plugin, where "%2e%2e" or ".%2e" reads as ".."; Jira keys are [A-Z][A-Z0-9_]*).
 *  jira-source checks the same in statusesOf. */
export const isProjectKey = (v) => typeof v === 'string' && v.length > 0 && v.length <= 100 && !/^\.+$/.test(v)
  && !/[/\\?#%\u0000-\u001f\u007f]/.test(v);
/** Board 5 A's line, the answer to a save while the connection is not saved (D12). */
const notSaved = (tracker) => `Save this connection first. Ticket updates read ${tracker}'s projects and statuses through it.`;

/**
 * The task source and profile a request names, guarded as PUT /api/plugins/:name/config guards them: an unknown source 400,
 * a bad profile id 400, a multi-profile source without a roster profile 400. `allowNew` (GET only, Deviation 2): a
 * multi-profile source whose roster is empty may name no profile. null after an answer was sent.
 */
function guard(req, res, manifest, name, { body = false, allowNew = false } = {}) {
  const src = body ? (isBag(req.body) ? req.body : {}) : (req.query || {});
  const sources = manifest.taskSources || [];
  const sourceId = typeof src.sourceId === 'string' && src.sourceId ? src.sourceId : (sources.length === 1 ? sources[0].id : '');
  const source = sources.find((s) => s.id === sourceId);
  if (!source) { res.status(400).json({ error: 'sourceId does not match a task source of this plugin' }); return null; }
  const profile = typeof src.profile === 'string' && src.profile ? src.profile : null;
  if (profile && !isValidProfileId(profile)) { res.status(400).json({ error: 'invalid profile id' }); return null; }
  const roster = listProfiles(name);
  if (source.multiProfile && !profile) {
    if (allowNew && !roster.length) return { source, profile: null, bucket: null, roster };
    res.status(400).json({ error: 'profile is required for this task source' });
    return null;
  }
  if (source.multiProfile && !roster.some((p) => p.id === profile)) {
    res.status(400).json({ error: `plugin "${name}" has no profile "${profile}". Create it first` });
    return null;
  }
  return { source, profile: source.multiProfile ? profile : null, bucket: source.multiProfile ? profile : DEFAULT_PROFILE, roster };
}

/** 'saved' when the profile is in the roster and every required config field has a stored value (D12), else 'new'. */
function connectionOf(ctx) {
  if (ctx.source.multiProfile && !ctx.profile) return 'new';
  const schema = list(ctx.source.configSchema);
  const values = redactedConfig(ctx.name, schema, ctx.profile || undefined);
  const missing = schema.filter((f) => f && f.required).some((f) => {
    const v = values[f.key];
    return f.secret ? !(isBag(v) && v.set === true) : (v == null || String(v).trim() === '');
  });
  return missing ? 'new' : 'saved';
}

/** The section header's "<label> (<id>)" parts; a single-profile source is its source's name. */
function profileOf(ctx) {
  if (ctx.profile) {
    const p = ctx.roster.find((x) => x.id === ctx.profile);
    return { id: ctx.profile, label: (p && p.label) || ctx.profile };
  }
  return ctx.source.multiProfile ? null : { id: DEFAULT_PROFILE, label: ctx.tracker };
}

/** legacyMove's answer (D4) checked against the source's config schema: the old field's key and label, and what it means. */
function legacyOf(answer, source) {
  if (!isBag(answer) || typeof answer.field !== 'string') return null;
  const field = list(source.configSchema).find((f) => f && f.key === answer.field);
  if (!field) return null;
  const t = answer.target;
  const target = isBag(t) && t.category === 'done' ? { category: 'done' }
    : isBag(t) && typeof t.typed === 'string' && t.typed.trim() ? { typed: t.typed.trim().slice(0, TU_LIMITS.text) } : null;
  return { field: field.key, label: field.label || field.key, target };
}

/**
 * Mount the four routes. Deps from ui/server.mjs: requirePlugin(req, res) → name | null (it answers the 404), readManifest(name)
 * → manifest | null, onChanged() after a save (the `plugins-changed` frame); callSource for tests.
 */
export function registerTicketUpdatesRoutes(app, { requirePlugin, readManifest, onChanged = () => {}, callSource = shimCallSource } = {}) {
  const gate = requireFlag('ticketUpdates');
  const P = '/api/plugins/:name/ticket-updates';

  function start(req, res, opts) {
    const name = requirePlugin(req, res);
    if (!name) return null;
    const manifest = readManifest(name);
    if (!manifest) { res.status(409).json({ error: 'plugin manifest unreadable. Run doctor' }); return null; }
    const ref = guard(req, res, manifest, name, opts);
    if (!ref) return null;
    return { name, ...ref, tracker: ref.source.displayName || name };
  }
  const run = (ctx, op, args, more = {}) => callSource({ plugin: ctx.name, sourceId: ctx.source.id, op, args,
    ...(ctx.profile ? { profile: ctx.profile } : {}), ...more });
  function failed(res, ctx, op, err) {
    const kind = (err && err.kind) || 'plugin';
    if (kind === 'unimplemented') return res.status(409).json({ error: CANNOT_UPDATE });
    const first = String((err && err.message) || err).split(/\r?\n/)[0].slice(0, 200);   // never a plugin's whole output
    console.error(`ticket updates: ${op} via ${ctx.name}/${ctx.source.id} failed (${kind}):`, first);
    // The shim's own `plugin "x" is disabled` is not product copy (source-reach's NOT_COPY), so it would read "stopped
    // unexpectedly"; say what is true instead.
    const error = DISABLED.test(first) ? `Worca could not reach ${ctx.tracker}: the ${ctx.tracker} plugin is disabled.`
      : reachSentence(ctx.tracker, { kind, message: err && err.message });
    return res.status(502).json({ error, kind });
  }
  /** F29 (ui/server.mjs): an async handler never lets a throw escape (Express 4, no unhandledRejection handler). */
  const safe = (handler) => async (req, res) => {
    try { await handler(req, res); } catch (err) {
      console.error('ticket updates: route failed:', String((err && err.message) || err).split(/\r?\n/)[0].slice(0, 200));
      if (!res.headersSent) res.status(500).json({ error: err && err.message ? String(err.message) : String(err) });
    }
  };
  /** Does the connector say ticketUpdates? An absent capabilities op is "no"; any other failure throws. With no profile yet
   *  (Deviation 2) the probe runs against the default bucket: capabilities needs no connection. */
  async function capable(ctx) {
    const probe = !ctx.profile && ctx.source.multiProfile ? { profile: DEFAULT_PROFILE, allowLegacyDefault: true } : {};
    try {
      const caps = await run(ctx, 'capabilities', { inputs: {} }, probe);
      return !!(caps && caps.ticketUpdates === true);
    } catch (err) {
      if ((err && err.kind) === 'unimplemented') return false;
      throw err;
    }
  }

  // GET: what the sheet paints. No tracker call: capabilities, and legacyMove for a saved connection (Deviation 1), in parallel.
  app.get(P, gate, safe(async (req, res) => {
    const ctx = start(req, res, { allowNew: true });
    if (!ctx) return;
    const connection = connectionOf(ctx);
    const profile = profileOf(ctx);
    const legacyP = connection === 'saved'
      ? run(ctx, 'legacyMove', {}).then((a) => legacyOf(a, ctx.source), () => null) : Promise.resolve(null);
    let ok;
    try { ok = await capable(ctx); } catch (err) { await legacyP; return failed(res, ctx, 'capabilities', err); }
    const legacy = await legacyP;
    const empty = { saved: false, projects: [], rules: [], legacy: null };
    if (!ok) return res.json({ available: false, connection, profile, ...empty });
    if (connection !== 'saved') return res.json({ available: true, connection, profile, ...empty });
    const rec = readTicketUpdates(ctx.name, ctx.bucket, ctx.source.id);
    res.json({ available: true, connection, profile, saved: !!rec, projects: rec ? list(rec.projects) : [], rules: rec ? list(rec.rules) : [], legacy });
  }));

  // GET projects: the tracker's projects, unfiltered (D9: the section's own picker sees them all).
  app.get(`${P}/projects`, gate, safe(async (req, res) => {
    const ctx = start(req, res);
    if (!ctx) return;
    try {
      const r = await run(ctx, 'listProjects', {}, { timeoutMs: LIST_PROJECTS_TIMEOUT_MS });
      res.json({ projects: list(r).filter((o) => isBag(o) && o.value != null).map((o) => ({ value: String(o.value), label: String(o.label ?? o.value),
        ...(typeof o.name === 'string' && o.name.trim() ? { name: o.name.trim() } : {}) })) });
    } catch (err) { failed(res, ctx, 'listProjects', err); }
  }));

  // GET statuses: one project's statuses with their category (D1); a category outside the four is left out.
  app.get(`${P}/statuses`, gate, safe(async (req, res) => {
    const ctx = start(req, res);
    if (!ctx) return;
    const project = typeof req.query.project === 'string' ? req.query.project.trim() : '';
    if (!project) return res.status(400).json({ error: 'project is required' });
    // A project is a key, never a path: "..", "." or a slash would let the plugin's URL reach another tracker endpoint.
    if (!isProjectKey(project)) return res.status(400).json({ error: 'project is not a project key' });
    try {
      const r = await run(ctx, 'listStatuses', { project });
      res.json({ statuses: list(r).filter((s) => isBag(s) && s.value != null && TU_CATEGORIES.includes(s.category))
        .map((s) => ({ value: String(s.value), label: String(s.label ?? s.value), category: s.category })) });
    } catch (err) { failed(res, ctx, 'listStatuses', err); }
  }));

  // PUT: §4's checks first (a bad body never spawns a child), then the connection and the capability, then the record with
  // who saved it and when.
  app.put(P, gate, safe(async (req, res) => {
    const ctx = start(req, res, { body: true });
    if (!ctx) return;
    let clean;
    try { clean = validateTicketUpdates(req.body); } catch (err) {
      if (err && err.code === 'BAD_REQUEST') return res.status(400).json({ error: err.message });
      throw err;
    }
    // D12: a connection that is not saved has no Ticket updates (board 5 A).
    if (connectionOf(ctx) !== 'saved') return res.status(409).json({ error: notSaved(ctx.tracker) });
    let ok;
    try { ok = await capable(ctx); } catch (err) { return failed(res, ctx, 'capabilities', err); }
    if (!ok) return res.status(409).json({ error: CANNOT_UPDATE });
    // The capability probe awaited: a profile removed meanwhile must not get a record back.
    if (ctx.profile && !listProfiles(ctx.name).some((p) => p.id === ctx.profile)) {
      return res.status(400).json({ error: `plugin "${ctx.name}" has no profile "${ctx.profile}". Create it first` });
    }
    writeTicketUpdates(ctx.name, ctx.bucket, ctx.source.id, { ...clean, savedAt: new Date().toISOString(), savedBy: actorOf(req) });
    onChanged();
    res.json({ ok: true });
  }));
}
