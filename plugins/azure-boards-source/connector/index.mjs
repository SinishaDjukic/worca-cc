// plugins/azure-boards-source/connector/index.mjs
// Azure Boards task source: WIQL list → workitemsbatch details, work item + comments as markdown, comment +
// Completed-category state on reportResult. Ids "org/project#123" round-trip. deps.fetch injected by tests.
import { adoFetch } from './ado-api.mjs';
import { htmlToMarkdown, markdownToHtml, escapeHtml, safeHref } from './html-md.mjs';

const PAGE = 50;                 // ≤ 200, workitemsbatch's id cap: one batch POST per page
const FIELDS = ['System.Id', 'System.Title', 'System.State', 'System.Tags', 'System.ChangedDate', 'System.WorkItemType', 'System.TeamProject'];
const CLOSED_CATEGORIES = new Set(['Completed', 'Removed']);
const enc = encodeURIComponent;
const toBool = (v) => v === true || String(v).toLowerCase() === 'yes';

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
        meta: { organization: ref.org, project: ref.project, id: ref.id, type: f['System.WorkItemType'] || null } };
    },
    async reportResult(id, { status, summary: text, links = [] }) {
      // A bad id throws like github-source's parseId: sources.mjs records a throw as a failed write-back,
      // while a normal return would be recorded as ok:true for a comment that was never posted.
      const ref = requireRef(id);
      // The host's summary is multi-line markdown (sources.mjs buildResultSummary); Azure comments render HTML.
      // Only http(s) links become anchors (s2); any other scheme is shown as escaped text.
      const item = (l) => (safeHref(l.url) ? `<a href="${escapeHtml(safeHref(l.url))}">${escapeHtml(l.title || l.url)}</a>` : escapeHtml(l.title || l.url || ''));
      const html = `${markdownToHtml(text || `worca pipeline ${status}`)}${links.length ? `<ul>${links.map((l) => `<li>${item(l)}</li>`).join('')}</ul>` : ''}`;
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
    capabilities() { return { writeBack: true, incrementalSync: false }; },
  };
}
