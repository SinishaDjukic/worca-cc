// plugins/jira-source/connector/index.mjs
// Jira task source: JQL search → issue summaries, issue + comments as markdown (renderedFields), a wiki-markup
// comment + an optional named transition on reportResult. Ids are issue keys ("PROJ-123"): the profile that names
// the site is pinned on the run by the host. REST v2 throughout, so Cloud and Data Center share one code path;
// only search pagination differs (Cloud: /search/jql + nextPageToken, Data Center: /search + startAt). Which one a
// site is comes from its own /serverInfo, remembered per profile; the hostname is only the fallback.
// A6 (plans/requirements-a6-design.md §5): the optional export ops. A tool-neutral ticket (Markdown description, normalised
// labels) becomes a v2 issue in wiki markup; a create stores Worca's marker as the issue property `worca.export`; after a
// create or update the description is read back once for the fingerprint Worca compares (D9). A refused field and a ticket
// that is gone are results, not errors (D11). deps.fetch injected by tests.
// Ticket updates (plans/ticket-updates-design.md §7): Worca decides what happens to a ticket when a run finishes and passes it
// as reportResult's `move`; this plugin maps Jira onto Worca's four categories (D1), lists a project's statuses, says what its
// old transitionOnComplete setting means (legacyMove, D4), and without a `move` behaves exactly as before.
// A6.1 (plans/requirements-a61-design.md §5): the optional import ops read a ticket — its rendered description as Markdown, a
// criteria field, the visible comments by display name only, the attachments' metadata — and download one attachment into the
// path the host names.
import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { jiraDownload, jiraFetch } from './jira-api.mjs';
import { htmlToMarkdown, markdownToWiki, plainWiki, wikiLink } from './markup.mjs';

const PAGE = 50;
const FIELDS = ['summary', 'status', 'labels', 'updated'];
const DETAIL_FIELDS = [...FIELDS, 'issuetype', 'project', 'priority', 'description', 'comment'];
const KEY_RE = /^[A-Z][A-Z0-9_]*-\d+$/i;
const enc = encodeURIComponent;
// Write-back is opt-in: only an explicit "yes" pinned on the run writes to the tracker.
const yes = (v) => String(v ?? '').trim().toLowerCase() === 'yes';

function requireKey(id) {
  const key = String(id || '').trim();
  if (!KEY_RE.test(key)) throw Object.assign(new Error(`bad Jira task id "${id}" (expected an issue key like PROJ-123)`), { kind: 'plugin' });
  return key.toUpperCase();
}

/** An issue key pasted into the search box, bare or inside a browse/selectedIssue URL; else null. */
export function pastedKey(search) {
  const s = String(search || '').trim();
  if (KEY_RE.test(s)) return s.toUpperCase();
  const m = /(?:\/browse\/|[?&]selectedIssue=)([A-Z][A-Z0-9_]*-\d+)\b/i.exec(s);
  return m ? m[1].toUpperCase() : null;
}

/** A JQL string literal. */
export const jqlString = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
/** The user's filter scoped to the selected project, plus the search text; the filter's own ORDER BY wins. */
export function buildJql({ project, jql, search } = {}) {
  let filter = String(jql || '').trim();
  let order = 'ORDER BY updated DESC';
  const m = /\bORDER\s+BY\b[\s\S]*$/i.exec(filter);
  if (m) { order = m[0].trim(); filter = filter.slice(0, m.index).trim(); }
  const where = [];
  if (project && String(project).trim()) where.push(`project = ${jqlString(String(project).trim())}`);
  if (filter) where.push(`(${filter})`);
  if (search && String(search).trim()) where.push(`text ~ ${jqlString(String(search).trim())}`);
  return `${where.join(' AND ')} ${order}`.trim();
}

/** The fallback guess when the site does not say: Atlassian's own domains are Cloud, the rest Data Center. */
export const isCloud = (base) => /\.(atlassian\.net|jira\.com)$/i.test((() => { try { return new URL(base).hostname; } catch { return ''; } })());

/** D9: the fingerprint of a description as Jira stores it: what reads back is wiki markup Cloud re-renders from ADF, so line
 *  endings, trailing spaces and outer blank lines never count. Worca compares these opaque strings only. */
export function fingerprintOf(text) {
  const norm = String(text ?? '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/[ \t]+$/, '')).join('\n').trim();
  return createHash('sha256').update(norm).digest('hex');
}
const PROPERTY = 'worca.export';
/** D10: once Jira has made the issue, each further request (the marker property, the read-back) gets this long, so a
 *  hung one cannot run the op into the host's 60 s limit, which would read as "nothing made" and make a second ticket. */
export const AFTER_KEY_TIMEOUT_MS = 15_000;

/** D1: a done status whose name means a negative ending is cancelled (case-insensitive; ' or ’). */
export const CANCELLED_NAME = /^(?:won['’]?t (?:do|fix)|rejected|duplicate|cancell?ed|declined|invalid|obsolete|abandoned|not planned)$/i;
/** Inner runs of whitespace (NBSP too) collapse to one space and the ends are trimmed before the test. */
const squash = (name) => String(name ?? '').replace(/\s+/g, ' ').trim();
export const isCancelledName = (name) => CANCELLED_NAME.test(squash(name));
/** I1: a transition's own name can cancel a ticket even when it leads to a neutral status ("Won't Do" into Closed, "Close as
 *  Duplicate"): the cancelling words anywhere in the name, as whole words, whitespace and NBSP collapsed. */
const CANCELLED_TRANSITION = /\b(?:won['’]?t|wont|duplicate|reject(?:ed)?|cancell?(?:ed)?|declin(?:e|ed)|invalid|obsolete|abandon(?:ed)?|not planned|cannot reproduce)\b/i;
export const isCancelledTransition = (name) => isCancelledName(name) || CANCELLED_TRANSITION.test(squash(name));
/** A transition named like a done verb ("Done", "Close Issue", "Resolve"). */
const DONE_VERB = /^(?:done|close|closed|resolve|resolved|complete|completed|finish)\b/i;
const doneVerb = (name) => DONE_VERB.test(squash(name));
/** D1: Jira's statusCategory onto Worca's four: new → todo, indeterminate → in_progress, done → done (cancelled-named:
 *  cancelled); a status without a category is to do. */
export function categoryOf(status) {
  const key = status?.statusCategory?.key;
  if (key === 'done') return isCancelledName(status?.name) ? 'cancelled' : 'done';
  if (key === 'indeterminate') return 'in_progress';
  return 'todo';
}

// A6.1 (plans/requirements-a61-design.md §4, §5): the optional import ops. They only read; REST v2 as the rest.
const IMPORT_SEARCH_FIELDS = ['summary', 'status', 'issuetype', 'updated'];
const IMPORT_PAGE = 20;
const IMPORT_COMMENTS = 50;
const emailish = (s) => /^[^@\s]+@[^@\s]+$/.test(String(s || ''));
/** D8: an app or automation author: Cloud's accountType when the author has one (a deactivated Cloud person stays a person),
 *  else Data Center's inactive user without an email-shaped name. */
const authorKind = (a) => (a && (a.accountType ? a.accountType === 'app' : (a.active === false && !emailish(a.name))) ? 'app' : 'person');
/** A criteria field's text as items: one per list item (nested ones too: `- `, `  - `, wiki `**`, `##`), else one per line. */
const listItems = (md) => String(md || '').split('\n').map((l) => l.replace(/^\s*(?:[-*+#]+|\d+[.)])\s+/, '').trim()).filter(Boolean);
/** Jira Cloud refuses a search with no clause before ORDER BY ("Unbounded JQL queries are not allowed here"): such a search (the
 *  import's "All projects, recently updated", a task list with no project and no filter) asks for the tickets updated within this
 *  window. */
const CLOUD_RECENT = 'updated >= -365d';

export default function createTaskSource(ctx, deps = {}) {
  const base = String(ctx.config?.baseUrl || '').trim().replace(/\/+$/, '');
  const jira = { fetch: deps.fetch || globalThis.fetch, base, email: String(ctx.config?.email || '').trim(), token: ctx.config?.token || '' };
  const log = (level, msg) => { try { ctx.log?.(level, msg); } catch { /* logging never fails an op */ } };
  const afterKey = Number(deps.afterKeyTimeoutMs) > 0 ? Number(deps.afterKeyTimeoutMs) : AFTER_KEY_TIMEOUT_MS;

  const summary = (i) => {
    const f = i.fields || {};
    return {
      id: i.key,
      title: f.summary || i.key,
      url: `${base}/browse/${i.key}`,
      state: f.status?.statusCategory?.key === 'done' ? 'closed' : 'open',
      labels: Array.isArray(f.labels) ? f.labels : [],
      updatedAt: f.updated || null,
    };
  };
  // 'cloud' | 'datacenter' from the site's serverInfo: anonymously first (works unless anonymous access is off),
  // then with the token; null when neither answers. Keyed by URL so a profile pointed elsewhere asks again.
  const DEPLOYMENT_KEY = `deployment:${base}`;
  async function probeDeployment() {
    for (const anonymous of [true, false]) {
      try {
        const info = await jiraFetch(jira, '/rest/api/2/serverInfo', { anonymous });
        if (info?.deploymentType) return /^cloud$/i.test(info.deploymentType) ? 'cloud' : 'datacenter';
      } catch { /* try the next way, then fall back */ }
    }
    return null;
  }
  let known = null;
  async function deployment() {
    if (known) return known;
    const cached = await ctx.state.get(DEPLOYMENT_KEY);
    if (cached === 'cloud' || cached === 'datacenter') return (known = cached);
    const probed = await probeDeployment();
    if (probed) { await ctx.state.set(DEPLOYMENT_KEY, probed); return (known = probed); }
    return (known = isCloud(base) ? 'cloud' : 'datacenter');   // not remembered: the next op asks the site again
  }

  const issue = (key, fields = FIELDS, expand = '') =>
    jiraFetch(jira, `/rest/api/2/issue/${enc(key)}?fields=${fields.join(',')}${expand ? `&expand=${expand}` : ''}`);
  // Every project: Data Center lists them at once, Cloud pages (up to 2,000, as listProjects always did).
  async function projectList() {
    if ((await deployment()) !== 'cloud') {
      const all = await jiraFetch(jira, '/rest/api/2/project');
      return (Array.isArray(all) ? all : []).map((p) => ({ key: p.key, name: p.name }));
    }
    const out = [];
    for (let startAt = 0, page = 0; page < 20; page++) {
      const j = await jiraFetch(jira, `/rest/api/2/project/search?orderBy=name&maxResults=100&startAt=${startAt}`);
      const values = j?.values || [];
      out.push(...values.map((p) => ({ key: p.key, name: p.name })));
      if (j?.isLast !== false || !values.length) break;
      startAt += values.length;
    }
    return out;
  }
  // listTasks and searchTickets: one search. A pasted key or link is that one issue (none when `missing(e)` says so), else the JQL
  // through Cloud's /search/jql (nextPageToken) or Data Center's /search (startAt). On Cloud a JQL with no clause before ORDER BY
  // gets CLOUD_RECENT, and a filter keeps its own ORDER BY.
  async function searchIssues({ project, filter = '', search, cursor, fields, max, missing }) {
    const key = pastedKey(search);
    if (key) {
      try { return { issues: [await issue(key, fields)] }; }
      catch (e) { if (await missing(e)) return { issues: [] }; throw e; }
    }
    const cloud = (await deployment()) === 'cloud';
    let jql = buildJql({ project, jql: filter, search });
    if (cloud && /^ORDER\s+BY\b/i.test(jql)) jql = buildJql({ project, jql: `${CLOUD_RECENT} ${String(filter || '').trim()}`, search });
    const q = `jql=${enc(jql)}&fields=${fields.join(',')}&maxResults=${max}`;
    if (cloud) {
      const j = await jiraFetch(jira, `/rest/api/2/search/jql?${q}${cursor ? `&nextPageToken=${enc(cursor)}` : ''}`);
      return { issues: j?.issues || [], ...(j?.nextPageToken && j?.isLast !== true ? { cursor: j.nextPageToken } : {}) };
    }
    const start = Number(cursor) || 0;
    const j = await jiraFetch(jira, `/rest/api/2/search?${q}&startAt=${start}`);
    const issues = j?.issues || [];
    const next = start + issues.length;
    return { issues, ...(issues.length && next < (j?.total ?? 0) ? { cursor: String(next) } : {}) };
  }
  // Create metadata (D16): Cloud and Data Center 8.4+, paged; Cloud names the list issueTypes / fields, Data Center values.
  async function createmeta(path, key) {
    const out = [];
    for (let startAt = 0, page = 0; page < 20; page++) {
      const j = await jiraFetch(jira, `${path}?startAt=${startAt}&maxResults=100`);
      const list = Array.isArray(j?.[key]) ? j[key] : Array.isArray(j?.values) ? j.values : [];
      out.push(...list);
      const total = Number(j?.total);
      if (!list.length || j?.isLast === true || (Number.isFinite(total) ? startAt + list.length >= total : list.length < 100)) break;
      startAt += list.length;
    }
    return out;
  }
  const createFields = (project, issueType) => createmeta(`/rest/api/2/issue/createmeta/${enc(project)}/issuetypes/${enc(issueType)}`, 'fields');
  const fieldId = (f) => f.fieldId || f.key || f.id;
  const browse = (key) => `${base}/browse/${key}`;
  // The issue's own description, read back after a create or an update (and for a ticket findTicket matched), with the
  // after-key timeout: a failure or a hang answers text and fingerprint null (the host then skips the edited check once);
  // it never throws, or the host would think nothing was made (D10)
  async function readBack(key) {
    try {
      const got = await jiraFetch(jira, `/rest/api/2/issue/${enc(key)}?fields=description`, { timeoutMs: afterKey });
      // jiraFetch answers null for a 200 whose body stalled or does not parse: that read says nothing, and the fingerprint
      // of nothing would make the next Update warn "edited in Jira". An empty description (fields present) is real.
      if (!got || typeof got.fields !== 'object' || got.fields === null) throw new Error('the answer had no fields');
      const text = got.fields.description;
      return { text: text ?? '', fingerprint: fingerprintOf(text) };
    } catch (e) { log('warn', `${key}: could not read the description back: ${e?.message || e}`); return { text: null, fingerprint: null }; }
  }
  const readFingerprint = async (key) => (await readBack(key)).fingerprint;
  // serverInfo's [major, minor] (Data Center 8.4 added create metadata per project, D16); null when the site does not say
  async function serverVersion() {
    for (const anonymous of [true, false]) {
      try {
        const info = await jiraFetch(jira, '/rest/api/2/serverInfo', { anonymous });
        const v = Array.isArray(info?.versionNumbers) ? info.versionNumbers.map(Number)
          : /^\d+\.\d+/.test(String(info?.version || '')) ? String(info.version).split('.').map((n) => parseInt(n, 10)) : [];
        if (Number.isFinite(v[0]) && Number.isFinite(v[1])) return v;
      } catch { /* try the next way */ }
    }
    return null;
  }
  // D11: jira-api's message names the HTTP status and the REST path, which the host would show. An export op's `plugin`
  // failure that is not a refusal or gone says Jira's own words only; auth, network and rate-limit pass unchanged.
  function plainFailure(e) {
    if (!e || e.kind !== 'plugin') return e;
    const said = (e.body?.errorMessages || []).map((m) => String(m).trim()).filter(Boolean).join('; ');
    return Object.assign(new Error(`Jira refused the request: ${said || 'no reason given'}`), { kind: 'plugin', status: e.status });
  }
  const exportOp = (fn) => async (args = {}) => { try { return await fn(args); } catch (e) { throw plainFailure(e); } };
  // Ticket updates (S3): listStatuses through exportOp, so a 403 or 404 carries Jira's own words to the host's reach sentence
  const listStatusesOp = exportOp(async ({ project }) => statusesOf(project));
  // The ticket's fields (design §5). Labels arrive normalised (no spaces); the criteria field gets the items as a wiki list.
  function ticketFields(t) {
    const f = { project: { key: t.project }, issuetype: { id: String(t.issueType) }, summary: t.title, description: markdownToWiki(t.description),
      labels: Array.isArray(t.labels) ? t.labels : [] };
    if (t.priority) f.priority = { id: String(t.priority) };
    if (t.criteria?.target === 'field' && t.criteria.field) f[t.criteria.field] = markdownToWiki((t.criteria.items || []).map((i) => `- ${i}`).join('\n'));
    return f;
  }
  // D11: a 400 naming a field is a result the product owner can act on; the field's name comes from create metadata.
  async function refusal(e, project, issueType) {
    if (e?.status !== 400) return null;
    const errors = e.body?.errors && typeof e.body.errors === 'object' ? e.body.errors : {};
    const [id, msg] = Object.entries(errors)[0] || [];
    if (!id) return null;
    let name = id;
    try { const f = (await createFields(project, issueType)).find((x) => fieldId(x) === id); if (f?.name) name = f.name; } catch { /* its id, then */ }
    const message = /\brequired\b/i.test(String(msg)) ? `Jira needs a value for “${name}” in ${project}.` : `Jira refused “${name}”: ${String(msg)}`;
    return { refused: { field: name, message } };
  }
  const refusesProperties = (e) => e?.status === 400 && ('properties' in (e.body?.errors || {})
    || (e.body?.errorMessages || []).some((m) => /propert/i.test(String(m))));
  const lastLine = (text) => String(text ?? '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean).at(-1) || '';
  // Ticket updates: a project key, never a path (S9): `..` would turn /project/../statuses into another REST endpoint
  function projectKeyOf(project) {
    const key = String(project ?? '').trim();
    if (!key) throw Object.assign(new Error('a project is required'), { kind: 'plugin' });
    if (key.length > 100 || /^\.+$/.test(key) || /[/\\?#]/.test(key)) {
      throw Object.assign(new Error('a project key cannot be a path'), { kind: 'plugin' });
    }
    return key;
  }
  // Every status of a project once by id, in Jira's order (one list per issue type), with its category (D1). Unwrapped: applyMove
  // (Task 10) reads jira-api's own failure kinds and status.
  async function statusesOf(project) {
    const key = projectKeyOf(project);
    const types = await jiraFetch(jira, `/rest/api/2/project/${enc(key)}/statuses`);
    const seen = new Set();
    const out = [];
    for (const t of Array.isArray(types) ? types : []) {
      for (const s of Array.isArray(t?.statuses) ? t.statuses : []) {
        const id = String(s?.id ?? '');
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push({ value: id, label: String(s.name || id), category: categoryOf(s) });
      }
    }
    return out;
  }

  // ---- Ticket updates: one move (§7, D10) ----
  const PREFERRED = ['done', 'closed', 'resolved', 'complete', 'completed'];
  const RESOLUTIONS = ['done', 'fixed', 'complete', 'completed'];
  const lc = (s) => String(s ?? '').trim().toLowerCase();
  /** "A", "A and B", "A, B and C". */
  const andList = (names) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);
  /** Jira's own words for a refusal, without a trailing full stop; "Jira gave no reason" when it sends none (decided 2026-10-30). */
  const jiraSaid = (e) => ([...(e?.body?.errorMessages || []), ...Object.values(e?.body?.errors || {})]
    .map((m) => String(m).replace(/\s+/g, ' ').trim()).filter(Boolean).join('; ') || 'Jira gave no reason').replace(/\.+$/, '');
  /** Deviation 3 (decided 2026-10-30): a 4xx refusal of the transition, other than 401 (auth) and 429 (rate limit), is a line;
   *  a 5xx, network, timeout, 401 or 429 throws, so the write-back fails and Report result retries. */
  const refusedMove = (e) => !!e && e.kind === 'plugin' && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 429;
  /** Jira would not let Worca read the ticket's status or transitions (403, 404): a line; anything else throws. */
  const unreadable = (e) => !!e && e.kind === 'plugin' && (e.status === 403 || e.status === 404);
  /** What a transition still needs: its Resolution (undefined when not required; the first allowed value named Done, Fixed,
   *  Complete or Completed; null when none fits), and its other required fields without a default (Worca fills none). */
  function needs(t) {
    const fields = t?.fields && typeof t.fields === 'object' ? t.fields : {};
    const r = fields.resolution;
    const resolution = r && r.required === true ? (r.allowedValues || []).find((v) => RESOLUTIONS.includes(lc(v?.name))) || null : undefined;
    const other = Object.entries(fields).filter(([k, f]) => k !== 'resolution' && f && f.required === true && !f.hasDefaultValue).map(([k, f]) => f.name || k);
    return { resolution, other };
  }
  const nameOf = (t) => t?.to?.name || t?.name || '?';
  const needLine = (t, n) => (n.other.length ? `Not moved: the move to ${nameOf(t)} asks for fields Worca does not fill (${n.other.join(', ')}).`
    : `Not moved: the move to ${nameOf(t)} needs a Resolution, and none is named Done, Fixed or Complete.`);
  const transitionsOf = async (key) => ((await jiraFetch(jira, `/rest/api/2/issue/${enc(key)}/transitions?expand=transitions.fields`)) || {}).transitions || [];
  /** §7: one move, before the comment. Answers { note, moved, transitioned }. A 4xx refusal of the transition (Deviation 3) or
   *  of reading the ticket's status or transitions (403, 404) is a "Not moved" line; auth, network, rate limit, timeout and a
   *  5xx throw, so the write-back fails and Report result retries (a retry after a failed comment finds the ticket moved:
   *  "Already in …"). */
  async function applyMove(key, move) {
    const none = { note: '', moved: null, transitioned: false };
    if (!move || move.none === true) return none;
    if (move.category !== 'done' && typeof move.status !== 'string' && typeof move.status !== 'number') return none;   // an unrecognised shape moves nothing
    const notRead = (e) => ({ ...none, note: `Not moved: Jira did not let Worca read ${key}'s transitions (${jiraSaid(e)}).` });
    let fields;
    try { fields = (await issue(key, ['status', 'project']))?.fields || {}; } catch (e) { if (unreadable(e)) return notRead(e); throw e; }
    const readTransitions = async () => {
      try { return { list: await transitionsOf(key) }; } catch (e) { if (unreadable(e)) return { refused: notRead(e) }; throw e; }
    };
    const now = fields.status || {};
    const from = now.name || '?';
    const go = async (t, resolution) => {
      try {
        await jiraFetch(jira, `/rest/api/2/issue/${enc(key)}/transitions`, { method: 'POST',
          body: { transition: { id: t.id }, ...(resolution ? { fields: { resolution: { id: resolution.id } } } : {}) } });
      } catch (e) {
        if (refusedMove(e)) return { ...none, note: `Not moved: Jira refused the move to ${nameOf(t)}: ${jiraSaid(e)}.` };
        throw e;
      }
      return { note: resolution ? `Moved to ${nameOf(t)}, Resolution: ${resolution.name}.` : `Moved to ${nameOf(t)}.`,
        moved: { from, to: nameOf(t) }, transitioned: true };
    };
    if (move.category === 'done') {
      if (now.statusCategory?.key === 'done') return { ...none, note: `Already in ${from}.` };
      const read = await readTransitions();
      if (read.refused) return read.refused;
      const done = read.list.filter((t) => t?.to?.statusCategory?.key === 'done');
      const usable = done.filter((t) => !isCancelledName(t.to?.name) && !isCancelledTransition(t.name));
      if (!usable.length) {
        const names = [...new Set(done.map((t) => (isCancelledName(t.to?.name) ? t.to?.name : t.name || t.to?.name)).filter(Boolean))];
        // "only Won't Do leads", "only Won't Do and Duplicate lead" (decided 2026-10-30)
        return { ...none, note: names.length ? `Not moved: from "${from}" only ${andList(names)} ${names.length === 1 ? 'leads' : 'lead'} to a Done status.`
          : `Not moved: from "${from}" no transition leads to a Done status.` };
      }
      const rank = (t) => { const i = PREFERRED.indexOf(lc(t.to?.name)); return i < 0 ? PREFERRED.length : i; };
      const ordered = usable.map((t, i) => [t, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || Number(!doneVerb(a[0].name)) - Number(!doneVerb(b[0].name)) || a[1] - b[1]).map(([t]) => t);
      for (const t of ordered) {
        const n = needs(t);
        if (!n.other.length && n.resolution !== null) return go(t, n.resolution);
      }
      return { ...none, note: needLine(ordered[0], needs(ordered[0])) };
    }
    const want = String(move.status ?? '').trim();
    const named = typeof move.name === 'string' && move.name.trim() ? move.name.trim() : null;
    if (String(now.id ?? '') === want || lc(from) === lc(want) || (named && lc(from) === lc(named))) return { ...none, note: `Already in ${from}.` };
    const read = await readTransitions();
    if (read.refused) return read.refused;
    const transitions = read.list;
    // By the status id; else, as legacy does (S2), a transition's name across all transitions first, then a target's name.
    // I1: a transition whose own name cancels ("Won't Do" into Closed) is not taken to a neutral-named status; of the rest,
    // one named like a done verb comes first.
    const viaTo = (match) => {
      const ok = transitions.filter(match).filter((x) => isCancelledName(x?.to?.name) || !isCancelledTransition(x?.name));
      return ok.find((x) => doneVerb(x?.name)) || ok[0];
    };
    const t = viaTo((x) => String(x?.to?.id ?? '') === want)
      || transitions.find((x) => lc(x?.name) === lc(want))
      || viaTo((x) => lc(x?.to?.name) === lc(want));
    if (!t) {
      const project = fields.project?.key;
      if (named && project) {
        let has = true;
        try { has = (await statusesOf(project)).some((s) => s.value === want); } catch { has = true; }   // unknown: the general line
        if (!has) return { ...none, note: `Not moved: ${project} has no status named ${named} any more.` };
      }
      const note = `Could not move to "${named || want}" from "${from}" (available: ${transitions.map((x) => x.name).join(', ') || 'none'}).`;
      log('warn', `${key}: ${note}`);
      return { ...none, note };
    }
    const n = needs(t);
    if (n.other.length || n.resolution === null) return { ...none, note: needLine(t, n) };
    return go(t, n.resolution);
  }

  const ticketOf = (i) => {
    const f = i.fields || {};
    return { key: i.key, title: f.summary || i.key, url: browse(i.key), type: f.issuetype?.name || null, status: f.status?.name || null, updatedAt: f.updated || null };
  };
  // A6.1 D16: Jira answers 404 for a ticket that does not exist and for one this connection may not see; a Data Center may answer 403
  const notVisible = async (e) => e.status === 404 || (e.status === 403 && (await deployment()) === 'datacenter');
  // D7: the multi-line text fields named "Acceptance Criteria", when no criteria field is given (multi-line: a textarea custom
  // field, as exportOptions' criteriaFields filters them). A site may have several; importTicket reads them all and takes the
  // first with a value.
  async function criteriaFieldIds() {
    try {
      const all = await jiraFetch(jira, '/rest/api/2/field');
      return (Array.isArray(all) ? all : []).filter((x) => x && x.custom && /:textarea$/.test(String(x.schema?.custom || ''))
        && String(x.name || '').trim().toLowerCase() === 'acceptance criteria').map((x) => String(x.id));
    } catch (e) { log('warn', `the field list could not be read: ${String(e?.message || e).split('\n')[0].slice(0, 200)}`); return []; }
  }

  return {
    async validateConfig() {
      if (!base) return { ok: false, errors: [{ field: 'baseUrl', message: 'the Jira URL is required' }] };
      if (!/^https?:\/\//i.test(base)) return { ok: false, errors: [{ field: 'baseUrl', message: 'the Jira URL must start with https://' }] };
      if (!jira.token) return { ok: false, errors: [{ field: 'token', message: 'an API token is required' }] };
      // Always asked afresh here: Test connection is where a changed site or a wrong auth mode should surface.
      const probed = await probeDeployment();
      if (probed) await ctx.state.set(DEPLOYMENT_KEY, probed);
      const cloud = probed ? probed === 'cloud' : isCloud(base);
      if (cloud && !jira.email) return { ok: false, errors: [{ field: 'email', message: 'this is a Jira Cloud site: its API tokens need the account email' }] };
      // Only when the site itself said so: a hostname guess is not enough to refuse a setting.
      if (probed === 'datacenter' && jira.email) {
        return { ok: false, errors: [{ field: 'email', message: 'this is a Jira Data Center / Server site: leave the email blank and use a personal access token' }] };
      }
      try {
        const me = await jiraFetch(jira, '/rest/api/2/myself');
        return { ok: true, identity: me?.displayName || me?.emailAddress || me?.name || null };
      } catch (e) {
        if (e.kind === 'auth') return { ok: false, errors: [{ field: 'token', message: e.message }] };
        if (e.kind === 'network' || e.status === 404) return { ok: false, errors: [{ field: 'baseUrl', message: `no Jira answered at ${base}: ${e.message}` }] };
        throw e;
      }
    },
    async listProjects() {
      // `name` (Ticket updates, D5): the project's name alone, for the chips
      return (await projectList()).map((p) => ({ value: p.key, label: `${p.name} (${p.key})`, name: p.name }));
    },
    async listTasks({ inputs = {}, search, cursor } = {}) {
      const r = await searchIssues({ project: inputs.project, filter: inputs.jql, search, cursor, fields: FIELDS, max: PAGE, missing: (e) => e.status === 404 });
      return { tasks: r.issues.map(summary), ...(r.cursor ? { cursor: r.cursor } : {}) };
    },
    async getTask(id) {
      const key = requireKey(id);
      const i = await issue(key, DETAIL_FIELDS, 'renderedFields');
      const f = i.fields || {};
      const r = i.renderedFields || {};
      // Rendered HTML is the same on Cloud and Data Center; the raw field (ADF-free in v2: wiki markup) is the fallback.
      const description = r.description ? htmlToMarkdown(r.description) : String(f.description || '').trim();
      const renderedById = new Map((r.comment?.comments || []).map((c) => [c.id, c.body]));
      const comments = (f.comment?.comments || []).map((c) => {
        const body = renderedById.has(c.id) ? htmlToMarkdown(renderedById.get(c.id)) : String(c.body || '').trim();
        return `**${c.author?.displayName || 'someone'}** (${c.created || ''}):\n${body}`;
      });
      return {
        ...summary(i),
        body: [description, ...(comments.length ? [`## Comments\n\n${comments.join('\n\n')}`] : [])].filter(Boolean).join('\n\n'),
        meta: { key: i.key, project: f.project?.key || null, type: f.issuetype?.name || null, status: f.status?.name || null,
          priority: f.priority?.name || null },
      };
    },
    async reportResult(id, { status, summary: text, links = [], inputs = {}, move } = {}) {
      // A bad id throws: sources.mjs records a throw as a failed write-back, a return as ok:true.
      const key = requireKey(id);
      if (!yes(inputs?.writeBack)) return { skipped: true };
      if (move && typeof move === 'object') {
        // Ticket updates (§7, D11): Worca decided the move; Jira transitions first, then one comment: the run summary, its links,
        // then the outcome line last. Without a move (nothing saved in Worca) the old path below runs unchanged (D4).
        const out = await applyMove(key, move);
        const lines = links.map((l) => `* ${wikiLink(l.title, l.url)}`);
        const body = [markdownToWiki(text || `worca pipeline ${status}`), ...(lines.length ? ['', ...lines] : []),
          ...(out.note ? ['', markdownToWiki(out.note)] : [])].join('\n');
        await jiraFetch(jira, `/rest/api/2/issue/${enc(key)}/comment`, { method: 'POST', body: { body } });
        return { commented: true, transitioned: out.transitioned, moved: out.moved, note: out.note };
      }
      // The transition goes first so the one comment can say how it went: a bad transition name shows on the
      // ticket instead of in a log, and a retry after a failed comment finds the issue already moved.
      const target = String(ctx.config?.transitionOnComplete || '').trim();
      let note = '';
      let transitioned = false;
      if (status === 'completed' && target) {
        const same = (s) => String(s || '').trim().toLowerCase() === target.toLowerCase();
        const from = (await issue(key, ['status']))?.fields?.status?.name || '?';
        if (same(from)) note = `Already in ${from}.`;
        else {
          const { transitions = [] } = (await jiraFetch(jira, `/rest/api/2/issue/${enc(key)}/transitions`)) || {};
          const t = transitions.find((x) => same(x.name)) || transitions.find((x) => same(x.to?.name));
          if (t) {
            await jiraFetch(jira, `/rest/api/2/issue/${enc(key)}/transitions`, { method: 'POST', body: { transition: { id: t.id } } });
            transitioned = true;
            note = `Moved to ${t.to?.name || t.name}.`;
          } else {
            note = `Could not move to "${target}" from "${from}" (available: ${transitions.map((x) => x.name).join(', ') || 'none'}).`;
            log('warn', `${key}: ${note}`);
          }
        }
      }
      const md = [text || `worca pipeline ${status}`, ...(note ? ['', note] : [])].join('\n');
      const linkLines = links.map((l) => `* ${wikiLink(l.title, l.url)}`);
      const body = [markdownToWiki(md), ...(linkLines.length ? ['', ...linkLines] : [])].join('\n');
      await jiraFetch(jira, `/rest/api/2/issue/${enc(key)}/comment`, { method: 'POST', body: { body } });
      return { commented: true, transitioned };
    },
    capabilities({ inputs } = {}) { return { writeBack: yes(inputs?.writeBack), incrementalSync: false, export: true, import: true, ticketUpdates: true }; },
    // ---- Ticket updates (plans/ticket-updates-design.md §3, §7) ----
    async listStatuses({ project } = {}) {
      projectKeyOf(project);   // its own words pass unchanged: plainFailure would turn them into "no reason given"
      return listStatusesOp({ project });   // S3: a refusal says Jira's words, not the REST path
    },
    legacyMove() {
      const text = String(ctx.config?.transitionOnComplete || '').trim();
      return { field: 'transitionOnComplete', target: text ? { typed: text } : null };
    },
    // ---- A6: export (plans/requirements-a6-design.md §4, §5); each op through exportOp (Jira's words, never a status or path) ----
    exportOptions: exportOp(async ({ project, issueType } = {}) => {
      const projects = (await projectList()).map((p) => ({ value: p.key, label: `${p.key} — ${p.name}` }));
      const doneStatus = String(ctx.config?.transitionOnComplete || '').trim() || null;
      if (!project) return { projects, doneStatus };
      let types;
      try { types = await createmeta(`/rest/api/2/issue/createmeta/${enc(project)}/issuetypes`, 'issueTypes'); }
      catch (e) {
        // only a Data Center before 8.4 lacks this endpoint, as its serverInfo says; on Cloud, on a newer Data Center and when
        // the version is unknown, a 404 means the project is gone or not visible (D16) and goes the normal way
        if (e.status === 404 && (await deployment()) === 'datacenter') {
          const v = await serverVersion();
          if (v && (v[0] < 8 || (v[0] === 8 && v[1] < 4))) return { projects, issueTypes: [], tooOld: true, doneStatus };
        }
        throw e;
      }
      const issueTypes = types.filter((t) => !t.subtask).map((t) => ({ value: String(t.id), label: t.name }));
      if (!issueType) return { projects, issueTypes, doneStatus };
      const fields = await createFields(project, issueType);
      const prio = fields.find((f) => fieldId(f) === 'priority');
      return {
        projects, issueTypes, doneStatus,
        priorities: (prio?.allowedValues || []).map((p) => ({ value: String(p.id), label: p.name })),
        // a list needs lines: only multi-line text fields can hold the criteria (D16)
        criteriaFields: fields.filter((f) => /:textarea$/.test(String(f.schema?.custom || ''))).map((f) => ({ value: fieldId(f), label: f.name })),
      };
    }),
    createTicket: exportOp(async ({ ticket } = {}) => {
      const fields = ticketFields(ticket);
      const props = ticket.marker ? [{ key: PROPERTY, value: { marker: ticket.marker } }] : null;
      let made;
      let propertyLater = false;
      try {
        made = await jiraFetch(jira, '/rest/api/2/issue', { method: 'POST', body: { fields, ...(props ? { properties: props } : {}) } });
      } catch (e) {
        if (!(props && refusesProperties(e))) { const r = await refusal(e, ticket.project, ticket.issueType); if (r) return r; throw e; }
        // a site that will not take properties in the create body: create, then set the property
        try { made = await jiraFetch(jira, '/rest/api/2/issue', { method: 'POST', body: { fields } }); }
        catch (e2) { const r = await refusal(e2, ticket.project, ticket.issueType); if (r) return r; throw e2; }
        propertyLater = true;
      }
      // Jira has made the issue: from here nothing throws (D10). A throw would keep the host's pending marker, and since the
      // issue then lacks the property findTicket would not match it, so Try again would make a second ticket.
      if (propertyLater) {
        try { await jiraFetch(jira, `/rest/api/2/issue/${enc(made.key)}/properties/${PROPERTY}`, { method: 'PUT', body: { marker: ticket.marker },
          timeoutMs: afterKey }); }
        catch (e) { log('warn', `${made.key}: could not store Worca's marker: ${e?.message || e}`); }
      }
      return { key: made.key, url: browse(made.key), fingerprint: await readFingerprint(made.key) };
    }),
    updateTicket: exportOp(async ({ key, ticket } = {}) => {
      const k = requireKey(key);
      const { project, labels, ...fields } = ticketFields(ticket);
      // Many sites refuse issuetype in an edit (Data Center: a type change is a Move; Cloud: often not on the edit screen), so it
      // is sent only when it changes. The same read finds a ticket that is gone.
      let now;
      try { now = await issue(k, ['issuetype']); }
      catch (e) { if (e.status === 404) return { gone: true }; throw e; }
      if (String(now?.fields?.issuetype?.id ?? '') === fields.issuetype.id) delete fields.issuetype;
      try {
        await jiraFetch(jira, `/rest/api/2/issue/${enc(k)}`, { method: 'PUT',
          body: { fields, update: { labels: labels.map((add) => ({ add })) } } });   // labels are added, never removed (D7)
      } catch (e) {
        if (e.status === 404) return { gone: true };
        const r = await refusal(e, project.key, ticket.issueType);
        if (r) return r;
        throw e;
      }
      // the edit is made: a failed read-back answers fingerprint null, never a failure (D10)
      return { key: k, url: browse(k), fingerprint: await readFingerprint(k) };
    }),
    commentTicket: exportOp(async ({ key, body } = {}) => {
      const k = requireKey(key);
      try { await jiraFetch(jira, `/rest/api/2/issue/${enc(k)}/comment`, { method: 'POST', body: { body: markdownToWiki(body) } }); }
      catch (e) { if (e.status === 404) return { gone: true }; throw e; }
      return { ok: true };
    }),
    ticketState: exportOp(async ({ key } = {}) => {
      const k = requireKey(key);
      try { return { exists: true, url: browse(k), fingerprint: fingerprintOf((await issue(k, ['description']))?.fields?.description) }; }
      catch (e) { if (e.status === 404) return { exists: false }; throw e; }
    }),
    findTicket: exportOp(async ({ project, label, marker } = {}) => {
      const jql = buildJql({ project, jql: `labels = ${jqlString(label)} ORDER BY created DESC` });
      const q = `jql=${enc(jql)}&fields=description,labels&maxResults=10`;
      const j = (await deployment()) === 'cloud'
        ? await jiraFetch(jira, `/rest/api/2/search/jql?${q}`) : await jiraFetch(jira, `/rest/api/2/search?${q}&startAt=0`);
      for (const i of (j?.issues || []).slice(0, 10)) {
        let prop = null;
        try { prop = await jiraFetch(jira, `/rest/api/2/issue/${enc(i.key)}/properties/${PROPERTY}`); }
        catch (e) { if (e.status !== 404) throw e; }
        if (!prop || prop.value?.marker !== marker) continue;
        // the fingerprint of the issue itself, as createTicket and ticketState read it: a search may answer the description
        // otherwise (Cloud), and a mismatch would show a false "edited in Jira" on the next Update
        const back = await readBack(i.key);
        return { key: i.key, url: browse(i.key), fingerprint: back.fingerprint, lastLine: lastLine(back.text ?? i.fields?.description),
          marker: prop.value.marker,
          labels: Array.isArray(i.fields?.labels) ? i.fields.labels : [] };
      }
      return null;
    }),
    // ---- A6.1: import (plans/requirements-a61-design.md §4, §5); read-only, each op through exportOp ----
    importOptions: exportOp(async () => ({ projects: (await projectList()).map((p) => ({ value: p.key, label: `${p.key} — ${p.name}` })) })),
    searchTickets: exportOp(async ({ project, search, cursor } = {}) => {
      // never the user's saved filter: the import searches the whole project
      const r = await searchIssues({ project, search, cursor, fields: IMPORT_SEARCH_FIELDS, max: IMPORT_PAGE, missing: notVisible });
      return { tickets: r.issues.map(ticketOf), ...(r.cursor ? { cursor: r.cursor } : {}) };
    }),
    importTicket: exportOp(async ({ key, criteriaField } = {}) => {
      const k = requireKey(key);
      const candidates = /^customfield_\d+$/.test(String(criteriaField || '')) ? [String(criteriaField)] : await criteriaFieldIds();
      const fields = ['summary', 'description', 'issuetype', 'priority', 'status', 'project', 'attachment', 'comment', ...candidates];
      let i;
      try { i = await issue(k, fields, 'renderedFields,names'); }
      catch (e) { if (await notVisible(e)) return { gone: true }; throw e; }
      const f = i.fields || {};
      const r = i.renderedFields || {};
      // the rendered HTML (the same on Cloud and Data Center) as Markdown; the raw wiki text as plain text when a site renders
      // nothing, through plainWiki so a mention's account id never leaves the connector (D8, D15)
      const description = r.description ? htmlToMarkdown(r.description) : plainWiki(f.description);
      // the first candidate field with items; its unrendered value goes through plainWiki like the description (D8, D15)
      let criteria = null;
      for (const id of candidates) {
        const items = listItems(r[id] ? htmlToMarkdown(r[id]) : plainWiki(f[id]));
        if (items.length) { criteria = { field: { id, name: (i.names && i.names[id]) || id }, items }; break; }
      }
      let raw = Array.isArray(f.comment?.comments) ? f.comment.comments : [];
      const total = Number.isFinite(Number(f.comment?.total)) ? Number(f.comment.total) : raw.length;
      // only a comment Jira rendered: one without (null or absent) falls back to its wiki text below
      const rendered = new Map((r.comment?.comments || []).filter((c) => c && c.body).map((c) => [String(c.id), c.body]));
      if (total > raw.length) {
        const page = await jiraFetch(jira, `/rest/api/2/issue/${enc(k)}/comment?orderBy=-created&maxResults=${IMPORT_COMMENTS}&expand=renderedBody`);
        raw = [...(Array.isArray(page?.comments) ? page.comments : [])].reverse();   // the newest 50, oldest first
        for (const c of raw) if (c.renderedBody) rendered.set(String(c.id), c.renderedBody);
      }
      const visible = raw.filter((c) => !c.visibility);   // a comment restricted to a group or role is never offered (D8)
      const comments = visible.slice(-IMPORT_COMMENTS).map((c) => ({ id: String(c.id), author: c.author?.displayName || 'Someone', authorKind: authorKind(c.author),
        created: c.created || null, body: rendered.has(String(c.id)) ? htmlToMarkdown(rendered.get(String(c.id))) : plainWiki(c.body) }));
      return {
        key: i.key, url: browse(i.key), title: f.summary || i.key, description, criteria, comments, commentsTotal: total,
        restrictedComments: raw.length - visible.length,
        attachments: (Array.isArray(f.attachment) ? f.attachment : []).map((a) => ({ id: String(a.id), name: String(a.filename || ''), mime: a.mimeType || '',
          bytes: Number(a.size) || 0, created: a.created || null })),
        meta: { project: f.project?.key || null, projectName: f.project?.name || null,
          type: f.issuetype ? { id: String(f.issuetype.id), name: f.issuetype.name } : null, status: f.status?.name || null,
          priority: f.priority ? { id: String(f.priority.id), name: f.priority.name } : null },
        fingerprint: fingerprintOf(f.description),   // as ticketState computes it, so A6's edited check holds (D11)
      };
    }),
    downloadAttachment: exportOp(async ({ key, id, maxBytes, dest } = {}) => {
      const k = requireKey(key);
      if (typeof dest !== 'string' || !isAbsolute(dest)) throw Object.assign(new Error('dest must be an absolute path the host made'), { kind: 'plugin' });
      const max = Number(maxBytes) > 0 ? Number(maxBytes) : 25 * 1024 * 1024;
      let meta;
      try { meta = await issue(k, ['attachment']); }
      catch (e) { if (e.status === 404) return { gone: true }; if (e.status === 403) return { gone: true, forbidden: true }; throw e; }
      const a = (meta?.fields?.attachment || []).find((x) => String(x.id) === String(id));
      if (!a) return { gone: true };   // the attachment must belong to this ticket
      if (Number(a.size) > max) return { tooLarge: true, bytes: Number(a.size) };   // checked before any download
      const r = await jiraDownload(jira, a.content, { dest, maxBytes: max, allowHttpRedirect: deps.allowHttpRedirect === true });
      if (r.gone || r.tooLarge) return r;
      return { name: String(a.filename || ''), mime: a.mimeType || '', bytes: r.bytes };   // never the body in the frame
    }),
  };
}
