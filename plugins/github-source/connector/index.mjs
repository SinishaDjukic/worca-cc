// plugins/github-source/connector/index.mjs
// GitHub Issues task source (worca-cc plugin API v1). REST only, injected fetch,
// zero dependencies. Task ids round-trip opaquely as "owner/repo#123".

import { ghFetch } from './github-api.mjs';

const PER_PAGE = 30;

/** 'owner/repo#123' -> { repo: 'owner/repo', number: 123 } */
function parseId(id) {
  const m = /^([^\s#]+\/[^\s#]+)#(\d+)$/.exec(String(id || ''));
  if (!m) throw Object.assign(new Error(`bad GitHub task id "${id}" (expected owner/repo#123)`), { kind: 'plugin' });
  return { repo: m[1], number: Number(m[2]) };
}

/** configSchema `select` fields deliver strings; coerce yes/true -> boolean. */
function toBool(v) {
  return v === true || v === 'yes' || v === 'true';
}

/** `assignee:@me state:open label:x label:y` -> { assignee, state, labels[] }. */
export function parseFilter(filter) {
  const q = { state: 'open', labels: [], assignee: null };
  for (const tok of String(filter || '').trim().split(/\s+/)) {
    if (!tok) continue;
    const [k, ...rest] = tok.split(':');
    const v = rest.join(':');
    if (k === 'state' && ['open', 'closed', 'all'].includes(v)) q.state = v;
    else if (k === 'assignee' && v) q.assignee = v;
    else if (k === 'label' && v) q.labels.push(v);
    // Unknown tokens are ignored (forward-compatible micro-syntax).
  }
  return q;
}

function toSummary(repo, it) {
  return {
    id: `${repo}#${it.number}`,
    title: it.title,
    url: it.html_url,
    state: it.state === 'closed' ? 'closed' : 'open',
    labels: (it.labels || []).map((l) => (typeof l === 'string' ? l : l.name)).filter(Boolean),
    updatedAt: it.updated_at,
  };
}

export default function createTaskSource(ctx, deps = { fetch: globalThis.fetch }) {
  const gh = { fetch: deps.fetch, token: String(ctx.config?.token || '') };
  const closeOnComplete = toBool(ctx.config?.closeOnComplete);

  /** @me resolution: login cached in state by validateConfig; lazily fetched otherwise. */
  async function login() {
    const cached = await ctx.state.get('login');
    if (cached) return cached;
    const { json } = await ghFetch(gh, '/user');
    await ctx.state.set('login', json.login);
    return json.login;
  }

  return {
    async validateConfig() {
      try {
        const { json } = await ghFetch(gh, '/user');
        await ctx.state.set('login', json.login);
        return { ok: true, identity: json.login };
      } catch (e) {
        if (e.kind === 'auth') return { ok: false, errors: [{ field: 'token', message: e.message }] };
        throw e; // network / rate-limit stay op errors -> protocol frame kinds
      }
    },

    /** inputs[].optionsFrom: "listRepos" */
    async listRepos() {
      const { json } = await ghFetch(gh, '/user/repos?per_page=100&sort=updated');
      return json.map((r) => ({ value: r.full_name, label: r.full_name }));
    },

    async listTasks({ inputs = {}, search, cursor } = {}) {
      const repo = String(inputs.repo || '');
      if (!repo) return { tasks: [] };
      const page = Math.max(1, Number(cursor) || 1);
      const f = parseFilter(inputs.filter);
      const params = new URLSearchParams({ state: f.state, per_page: String(PER_PAGE), page: String(page) });
      if (f.assignee) params.set('assignee', f.assignee === '@me' ? await login() : f.assignee);
      if (f.labels.length) params.set('labels', f.labels.join(','));
      const path = `/repos/${repo}/issues?${params}`;

      // ETag revalidation on the FIRST page only (the hot re-open path).
      const etagKey = `etag:${repo}`;
      const cacheKey = `cache:${repo}`;
      const reqHeaders = {};
      if (page === 1) {
        const etag = await ctx.state.get(etagKey);
        if (etag) reqHeaders['if-none-match'] = etag;
      }
      const res = await ghFetch(gh, path, { headers: reqHeaders });
      let items;
      if (res.status === 304) {
        items = JSON.parse((await ctx.state.get(cacheKey)) || '[]');
        ctx.log('info', `github: ${repo} unchanged (304), served ${items.length} cached issues`);
      } else {
        // GitHub's issues list INCLUDES pull requests — they carry a
        // `pull_request` key. Dropping them is the top REST-API gotcha.
        items = res.json.filter((it) => !it.pull_request);
        if (page === 1) {
          const etag = res.headers.get('etag');
          if (etag) await ctx.state.set(etagKey, etag);
          await ctx.state.set(cacheKey, JSON.stringify(items));
        }
      }
      let tasks = items.map((it) => toSummary(repo, it));
      const needle = String(search || '').trim().toLowerCase();
      if (needle) tasks = tasks.filter((t) => t.title.toLowerCase().includes(needle)); // client-side title match
      // Cursor = next page number while the RAW page was full (pre-PR-filter).
      return { tasks, ...(res.status !== 304 && res.json.length === PER_PAGE ? { cursor: String(page + 1) } : {}) };
    },

    async getTask(id) {
      const { repo, number } = parseId(id);
      const issue = (await ghFetch(gh, `/repos/${repo}/issues/${number}`)).json;
      const comments = (await ghFetch(gh, `/repos/${repo}/issues/${number}/comments?per_page=50`)).json; // first page
      let body = issue.body || '';
      if (comments.length) {
        body += '\n\n## Comments\n';
        for (const c of comments) {
          body += `\n**@${c.user?.login || 'unknown'}** (${c.created_at}):\n\n${c.body || ''}\n`;
        }
      }
      return {
        ...toSummary(repo, issue),
        body, // ALWAYS markdown (GitHub bodies already are)
        meta: {
          repo,
          number,
          labels: (issue.labels || []).map((l) => (typeof l === 'string' ? l : l.name)).filter(Boolean),
          assignee: issue.assignee?.login || null,
        },
      };
    },

    async reportResult(id, { status, summary, links = [] }) {
      const { repo, number } = parseId(id);
      let body = summary || `worca-cc run finished: ${status}`;
      if (links.length) {
        body += '\n\n';
        for (const l of links) body += `- [${l.title}](${l.url})\n`;
      }
      await ghFetch(gh, `/repos/${repo}/issues/${number}/comments`, { method: 'POST', body: { body } });
      if (status === 'completed' && closeOnComplete) {
        await ghFetch(gh, `/repos/${repo}/issues/${number}`, {
          method: 'PATCH',
          body: { state: 'closed', state_reason: 'completed' },
        });
      }
    },

    capabilities() {
      return { writeBack: true, incrementalSync: false };
    },
  };
}
