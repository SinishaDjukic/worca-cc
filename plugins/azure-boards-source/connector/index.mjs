// plugins/azure-boards-source/connector/index.mjs
// Azure Boards task source: WIQL list → workitemsbatch details, work item + comments as markdown, comment +
// Completed-category state on reportResult. Ids "org/project#123" round-trip. deps.fetch injected by tests.
// Ticket updates (plans/ticket-updates-design.md §3, plans/ticket-updates-pr2-plan.md): Worca decides what happens to a work
// item when a run finishes and passes it as reportResult's `move`; this plugin maps Azure's state categories onto Worca's four
// (D1), lists a project's states, says what its old closeOnComplete setting means (legacyMove, D4), and without a `move`
// behaves exactly as before.
import { adoFetch } from './ado-api.mjs';
import { htmlToMarkdown, markdownToHtml, escapeHtml, safeHref } from './html-md.mjs';

const PAGE = 50;                 // ≤ 200, workitemsbatch's id cap: one batch POST per page
const FIELDS = ['System.Id', 'System.Title', 'System.State', 'System.Tags', 'System.ChangedDate', 'System.WorkItemType', 'System.TeamProject'];
const CLOSED_CATEGORIES = new Set(['Completed', 'Removed']);
const enc = encodeURIComponent;
const toBool = (v) => v === true || String(v).toLowerCase() === 'yes';

/** D1: Azure's state categories onto Worca's four (Resolved counts as in progress, so Any Done status is Completed; user,
 *  2026-10-29); a state without a known category is to do. */
const CATEGORY = { Proposed: 'todo', InProgress: 'in_progress', Resolved: 'in_progress', Completed: 'done', Removed: 'cancelled' };
export const categoryOf = (state) => CATEGORY[state?.category] || 'todo';

export function parseWorkItemRef(id) {
  const m = /^([^/#]+)\/(.+)#(\d+)$/.exec(String(id || ''));
  return m ? { org: m[1], project: m[2], id: Number(m[3]) } : null;
}
function requireRef(id) {
  const ref = parseWorkItemRef(id);
  if (!ref) throw Object.assign(new Error(`bad Azure Boards task id "${id}" (expected org/project#123)`), { kind: 'plugin' });
  return ref;
}

const quote = (s) => `'${String(s).replace(/'/g, "''")}'`;
/** The user's filter wrapped into one WIQL query scoped to the selected project, newest first. */
export function wrapWiql(query, search) {
  const where = ['[System.TeamProject] = @project'];
  if (query && String(query).trim()) where.push(`(${String(query).trim()})`);
  if (search && String(search).trim()) where.push(`[System.Title] CONTAINS ${quote(String(search).trim())}`);
  return `SELECT [System.Id] FROM WorkItems WHERE ${where.join(' AND ')} ORDER BY [System.ChangedDate] DESC`;
}

export default function createTaskSource(ctx, deps = {}) {
  const org = String(ctx.config?.organization || '').trim();
  const ado = { fetch: deps.fetch || globalThis.fetch, token: ctx.config?.token || '' };
  const base = `https://dev.azure.com/${enc(org)}`;
  const webUrl = (project, id) => `${base}/${enc(project)}/_workitems/edit/${id}`;

  const summary = (w) => {
    const f = w.fields || {};
    const project = f['System.TeamProject'];
    return {
      id: `${org}/${project}#${w.id}`,
      title: f['System.Title'] || `#${w.id}`,
      url: webUrl(project, w.id),
      state: ['Closed', 'Done', 'Removed', 'Resolved'].includes(f['System.State']) ? 'closed' : 'open',
      labels: String(f['System.Tags'] || '').split(';').map((t) => t.trim()).filter(Boolean),
      updatedAt: f['System.ChangedDate'] || null,
    };
  };
  // errorPolicy 'Omit': one deleted or inaccessible id answers null in its slot instead of failing the whole page.
  const batch = async (ids) => (ids.length
    ? ((await adoFetch(ado, `${base}/_apis/wit/workitemsbatch`, { method: 'POST', body: { ids, fields: FIELDS, errorPolicy: 'Omit' } }))?.value || []).filter(Boolean)
    : []);
  const one = async (ref) => adoFetch(ado, `${base}/${enc(ref.project)}/_apis/wit/workitems/${ref.id}?$expand=fields`);

  // ---- Ticket updates ----
  const lc = (s) => String(s ?? '').trim().toLowerCase();
  /** A project name, never a path (as jira-source's projectKeyOf): ".." would turn /{project}/_apis into another endpoint. */
  function projectOf(project) {
    const name = String(project ?? '').trim();
    if (!name) throw Object.assign(new Error('a project is required'), { kind: 'plugin' });
    if (name.length > 100 || /^\.+$/.test(name) || /[/\\?#]/.test(name)) {
      throw Object.assign(new Error('a project name cannot be a path'), { kind: 'plugin' });
    }
    return name;
  }
  /** Azure's own words for a refusal, without a trailing full stop; "Azure Boards gave no reason" when it sends none. */
  const azureSaid = (e) => (String(e?.detail || '').trim() || 'Azure Boards gave no reason').replace(/\.+$/, '');
  /** A refusal as Azure's words ("Azure Boards refused the request: …"), never adoFetch's status and REST URL, which the host's
   *  reach sentence would show as they are; auth, network and rate limit pass unchanged. */
  const ownWords = (e) => (e && e.kind === 'plugin' && e.status
    ? Object.assign(new Error(`Azure Boards refused the request: ${azureSaid(e)}.`), { kind: 'plugin', status: e.status }) : e);
  /** Every state of the project's visible work item types once, by name, in Azure's order, with its category (D1). Disabled
   *  types and the hidden ones (Code Review Request, Test Plan, …: Microsoft.HiddenCategory) add nothing. */
  async function statesOfProject(project) {
    const p = enc(projectOf(project));
    const [types, cats] = await Promise.all([adoFetch(ado, `${base}/${p}/_apis/wit/workitemtypes`),
      adoFetch(ado, `${base}/${p}/_apis/wit/workitemtypecategories`)]);
    const hiddenCat = (cats?.value || []).find((c) => c?.referenceName === 'Microsoft.HiddenCategory');
    const hidden = new Set((hiddenCat?.workItemTypes || []).map((t) => t?.name));
    const seen = new Set();
    const out = [];
    for (const t of types?.value || []) {
      if (!t || t.isDisabled || hidden.has(t.name)) continue;
      for (const s of Array.isArray(t.states) ? t.states : []) {
        const name = String(s?.name || '');
        if (!name || seen.has(lc(name))) continue;
        seen.add(lc(name));
        out.push({ value: name, label: name, category: categoryOf(s) });
      }
    }
    return out;
  }
  /** PR 1's rule for a refused move (its Deviation 3), in Azure's terms: a 4xx other than 401 (auth, as 203) and 429 (rate
   *  limit) is a line; a 5xx, network error, timeout, refused token or rate limit throws, so the write-back can be retried. */
  const refusedMove = (e) => !!e && e.kind === 'plugin' && e.status >= 400 && e.status < 500 && e.status !== 429;
  /** One move, before the comment (D11). Answers { note, moved }. Any Done status is the type's first Completed-category state,
   *  never a Removed one; a status move is that state of the work item's own type, with no fallback (decision 3). Reading the
   *  item or its states throws (decision 9). */
  async function applyMove(ref, move) {
    const none = { note: '', moved: null };
    const want = typeof move.status === 'string' ? move.status.trim() : '';
    if (move.none === true || (move.category !== 'done' && !want)) return none;
    const f = (await one(ref))?.fields || {};
    const type = String(f['System.WorkItemType'] || '');
    const project = String(f['System.TeamProject'] || ref.project);
    const from = String(f['System.State'] || '?');
    // Work Item Type States - List is a preview endpoint in 7.1: pin its version, as closeOnComplete does.
    const states = ((await adoFetch(ado, `${base}/${enc(ref.project)}/_apis/wit/workitemtypes/${enc(type)}/states?api-version=7.1-preview.1`))?.value || [])
      .filter((s) => s && s.name);
    let to;
    if (move.category === 'done') {
      const now = states.find((s) => lc(s.name) === lc(from));
      if (now && (now.category === 'Completed' || now.category === 'Removed')) return { ...none, note: `Already in ${from}.` };
      to = states.find((s) => s.category === 'Completed');
      if (!to) return { ...none, note: `Not moved: ${project}'s ${type} type has no Done status.` };
    } else {
      const named = typeof move.name === 'string' && move.name.trim() ? move.name.trim() : want;
      if (lc(from) === lc(want)) return { ...none, note: `Already in ${from}.` };
      to = states.find((s) => lc(s.name) === lc(want));
      if (!to) {
        let has = true;
        try { has = (await statesOfProject(ref.project)).some((s) => lc(s.value) === lc(want)); } catch { has = true; }   // unknown: the type line
        return { ...none, note: has ? `Not moved: ${project}'s ${type} type has no status named ${named}.`
          : `Not moved: ${project} has no status named ${named} any more.` };
      }
    }
    try {
      await adoFetch(ado, `${base}/${enc(ref.project)}/_apis/wit/workitems/${ref.id}`, {
        method: 'PATCH', contentType: 'application/json-patch+json', body: [{ op: 'add', path: '/fields/System.State', value: to.name }],
      });
    } catch (e) {
      if (refusedMove(e)) return { ...none, note: `Not moved: Azure Boards refused the move to ${to.name}: ${azureSaid(e)}.` };
      throw e;
    }
    return { note: `Moved to ${to.name}.`, moved: { from, to: to.name } };
  }

  return {
    async validateConfig() {
      if (!org) return { ok: false, errors: [{ field: 'organization', message: 'organization is required' }] };
      if (!ado.token) return { ok: false, errors: [{ field: 'token', message: 'a personal access token is required' }] };
      try {
        const j = await adoFetch(ado, `${base}/_apis/connectionData`);
        return { ok: true, identity: j?.authenticatedUser?.providerDisplayName || null };
      } catch (e) {
        if (e.kind === 'auth') return { ok: false, errors: [{ field: 'token', message: e.message }] };
        if (e.status === 404) return { ok: false, errors: [{ field: 'organization', message: `organization ${org} not found` }] };
        throw e;
      }
    },
    async listProjects() {
      let j;
      try { j = await adoFetch(ado, `${base}/_apis/projects?$top=500`); }
      catch (e) {
        // A Work Items-only PAT passes validateConfig but cannot list projects (vso.project).
        if (e.kind === 'auth') e.message = 'Azure DevOps refused to list projects: the token needs the Project and Team (Read) scope as well as Work Items (Read & Write)';
        throw e;
      }
      return (j?.value || []).map((p) => ({ value: p.name, label: p.name }));
    },
    async listTasks({ inputs = {}, search, cursor } = {}) {
      const project = inputs.project;
      if (!project) return { tasks: [] };
      const pasted = /(?:^#|_workitems\/edit\/)(\d+)\b/.exec(String(search || '').trim());
      if (pasted) {
        try { return { tasks: [summary(await one({ project, id: Number(pasted[1]) }))] }; }
        catch (e) { if (e.status === 404) return { tasks: [] }; throw e; }
      }
      const wiql = await adoFetch(ado, `${base}/${enc(project)}/_apis/wit/wiql?$top=1000`, { method: 'POST', body: { query: wrapWiql(inputs.query, search) } });
      const ids = (wiql?.workItems || []).map((w) => w.id);
      const start = Number(cursor) || 0;
      const items = await batch(ids.slice(start, start + PAGE));
      return { tasks: items.map(summary), ...(start + PAGE < ids.length ? { cursor: String(start + PAGE) } : {}) };
    },
    async getTask(id) {
      const ref = requireRef(id);
      const w = await one(ref);
      const f = w.fields || {};
      const parts = [htmlToMarkdown(f['System.Description'] || ''), htmlToMarkdown(f['Microsoft.VSTS.TCM.ReproSteps'] || ''),
        f['Microsoft.VSTS.Common.AcceptanceCriteria'] ? `## Acceptance criteria\n\n${htmlToMarkdown(f['Microsoft.VSTS.Common.AcceptanceCriteria'])}` : '']
        .filter(Boolean);
      const c = await adoFetch(ado, `${base}/${enc(ref.project)}/_apis/wit/workItems/${ref.id}/comments?api-version=7.1-preview.4`).catch(() => null);
      const comments = (c?.comments || []).map((x) => `**${x.createdBy?.displayName || 'someone'}** (${x.createdDate}):\n${htmlToMarkdown(x.text || '')}`);
      return { ...summary(w), body: [...parts, ...(comments.length ? [`## Comments\n\n${comments.join('\n\n')}`] : [])].join('\n\n'),
        // meta.project (Ticket updates, D6): the item's own project as listProjects names it, whatever case the id was typed in
        meta: { organization: ref.org, project: f['System.TeamProject'] || ref.project, id: ref.id, type: f['System.WorkItemType'] || null } };
    },
    async reportResult(id, { status, summary: text, links = [], move } = {}) {
      // A bad id throws like github-source's parseId: sources.mjs records a throw as a failed write-back,
      // while a normal return would be recorded as ok:true for a comment that was never posted.
      const ref = requireRef(id);
      // The host's summary is multi-line markdown (sources.mjs buildResultSummary); Azure comments render HTML.
      // Only http(s) links become anchors (s2); any other scheme is shown as escaped text.
      const item = (l) => (safeHref(l.url) ? `<a href="${escapeHtml(safeHref(l.url))}">${escapeHtml(l.title || l.url)}</a>` : escapeHtml(l.title || l.url || ''));
      const html = `${markdownToHtml(text || `worca pipeline ${status}`)}${links.length ? `<ul>${links.map((l) => `<li>${item(l)}</li>`).join('')}</ul>` : ''}`;
      if (move && typeof move === 'object') {
        // Ticket updates (D11): Worca decided the move; the state changes first, then one comment: the run summary, its links,
        // then the outcome line last. Without a move (nothing saved in Worca) the old path below runs unchanged (D4).
        const out = await applyMove(ref, move);
        await adoFetch(ado, `${base}/${enc(ref.project)}/_apis/wit/workItems/${ref.id}/comments?api-version=7.1-preview.4`,
          { method: 'POST', body: { text: `${html}${out.note ? `<p>${escapeHtml(out.note)}</p>` : ''}` } });
        return { commented: true, moved: out.moved, note: out.note };
      }
      await adoFetch(ado, `${base}/${enc(ref.project)}/_apis/wit/workItems/${ref.id}/comments?api-version=7.1-preview.4`, { method: 'POST', body: { text: html } });
      if (status !== 'completed' || !toBool(ctx.config?.closeOnComplete)) return;
      const w = await one(ref);
      const type = w.fields?.['System.WorkItemType'];
      // Work Item Type States - List is a preview endpoint in 7.1 (§7 manual check): pin its version explicitly.
      const states = await adoFetch(ado, `${base}/${enc(ref.project)}/_apis/wit/workitemtypes/${enc(type)}/states?api-version=7.1-preview.1`);
      // Process templates name it Done, Closed or Resolved: pick by category, not by name.
      const done = (states?.value || []).find((s) => s.category === 'Completed');
      if (!done || CLOSED_CATEGORIES.has((states.value || []).find((s) => s.name === w.fields?.['System.State'])?.category)) return;
      await adoFetch(ado, `${base}/${enc(ref.project)}/_apis/wit/workitems/${ref.id}`, {
        method: 'PATCH', contentType: 'application/json-patch+json',
        body: [{ op: 'add', path: '/fields/System.State', value: done.name }],
      });
    },
    capabilities() { return { writeBack: true, incrementalSync: false, ticketUpdates: true }; },
    // ---- Ticket updates (plans/ticket-updates-design.md §3) ----
    async listStatuses({ project } = {}) {
      projectOf(project);   // its own words pass unchanged
      try { return await statesOfProject(project); } catch (e) { throw ownWords(e); }
    },
    legacyMove() {
      return { field: 'closeOnComplete', target: toBool(ctx.config?.closeOnComplete) ? { category: 'done' } : null };
    },
  };
}
