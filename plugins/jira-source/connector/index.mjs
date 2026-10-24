// plugins/jira-source/connector/index.mjs
// Jira task source: JQL search → issue summaries, issue + comments as markdown (renderedFields), a wiki-markup
// comment + an optional named transition on reportResult. Ids are issue keys ("PROJ-123"): the profile that names
// the site is pinned on the run by the host. REST v2 throughout, so Cloud and Data Center share one code path;
// only search pagination differs (Cloud: /search/jql + nextPageToken, Data Center: /search + startAt). Which one a
// site is comes from its own /serverInfo, remembered per profile; the hostname is only the fallback.
// deps.fetch injected by tests.
import { jiraFetch } from './jira-api.mjs';
import { htmlToMarkdown, markdownToWiki, wikiLink } from './markup.mjs';

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

export default function createTaskSource(ctx, deps = {}) {
  const base = String(ctx.config?.baseUrl || '').trim().replace(/\/+$/, '');
  const jira = { fetch: deps.fetch || globalThis.fetch, base, email: String(ctx.config?.email || '').trim(), token: ctx.config?.token || '' };
  const log = (level, msg) => { try { ctx.log?.(level, msg); } catch { /* logging never fails an op */ } };

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
      if ((await deployment()) !== 'cloud') {
        const all = await jiraFetch(jira, '/rest/api/2/project');
        return (Array.isArray(all) ? all : []).map((p) => ({ value: p.key, label: `${p.name} (${p.key})` }));
      }
      const out = [];
      for (let startAt = 0, page = 0; page < 20; page++) {
        const j = await jiraFetch(jira, `/rest/api/2/project/search?orderBy=name&maxResults=100&startAt=${startAt}`);
        const values = j?.values || [];
        out.push(...values.map((p) => ({ value: p.key, label: `${p.name} (${p.key})` })));
        if (j?.isLast !== false || !values.length) break;
        startAt += values.length;
      }
      return out;
    },
    async listTasks({ inputs = {}, search, cursor } = {}) {
      const key = pastedKey(search);
      if (key) {
        try { return { tasks: [summary(await issue(key))] }; }
        catch (e) { if (e.status === 404) return { tasks: [] }; throw e; }
      }
      const jql = buildJql({ project: inputs.project, jql: inputs.jql, search });
      const q = `jql=${enc(jql)}&fields=${FIELDS.join(',')}&maxResults=${PAGE}`;
      if ((await deployment()) === 'cloud') {
        const j = await jiraFetch(jira, `/rest/api/2/search/jql?${q}${cursor ? `&nextPageToken=${enc(cursor)}` : ''}`);
        return { tasks: (j?.issues || []).map(summary), ...(j?.nextPageToken && j?.isLast !== true ? { cursor: j.nextPageToken } : {}) };
      }
      const start = Number(cursor) || 0;
      const j = await jiraFetch(jira, `/rest/api/2/search?${q}&startAt=${start}`);
      const issues = j?.issues || [];
      const next = start + issues.length;
      return { tasks: issues.map(summary), ...(issues.length && next < (j?.total ?? 0) ? { cursor: String(next) } : {}) };
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
    async reportResult(id, { status, summary: text, links = [], inputs = {} } = {}) {
      // A bad id throws: sources.mjs records a throw as a failed write-back, a return as ok:true.
      const key = requireKey(id);
      if (!yes(inputs?.writeBack)) return { skipped: true };
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
    capabilities({ inputs } = {}) { return { writeBack: yes(inputs?.writeBack), incrementalSync: false }; },
  };
}
