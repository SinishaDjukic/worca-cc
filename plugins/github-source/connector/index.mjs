// plugins/github-source/connector/index.mjs
// GitHub Issues task source (worca-cc plugin API v1). REST only, injected fetch,
// zero dependencies. Task ids round-trip opaquely as "owner/repo#123".
// Ticket updates (plans/ticket-updates-design.md §3, plans/ticket-updates-pr2-plan.md): a repository is a project ("owner/repo");
// Worca decides what happens to an issue when a run finishes and passes it as reportResult's `move`; this plugin maps an issue's
// state onto Worca's four categories (D1), says what its old closeOnComplete setting means (legacyMove, D4), and without a
// `move` behaves exactly as before. Projects (v2) status fields are not read (decision 2).

import { ghFetch } from './github-api.mjs';
import { ghAuthToken } from './gh-cli.mjs';

const PER_PAGE = 30;

/** D1: GitHub Issues' statuses: open is to do, closed as completed done, closed as not planned cancelled; nothing is in
 *  progress. The values are the API's own (`state`, `state_reason`). */
export const STATUSES = Object.freeze([
  Object.freeze({ value: 'open', label: 'Open', category: 'todo' }),
  Object.freeze({ value: 'completed', label: 'Closed', category: 'done' }),
  Object.freeze({ value: 'not_planned', label: 'Closed as not planned', category: 'cancelled' }),
]);
const DUPLICATE = Object.freeze({ value: 'duplicate', label: 'Closed as duplicate', category: 'cancelled' });
/** An issue's status: reopened is open, a close without a reason (older issues) completed, a duplicate cancelled. */
export function statusOf(issue) {
  if (issue?.state !== 'closed') return STATUSES[0];
  if (issue.state_reason === 'not_planned') return STATUSES[2];
  if (issue.state_reason === 'duplicate') return DUPLICATE;
  return STATUSES[1];
}
/** A repository as Worca keys it (decision 1): owner/repo in GitHub's own characters (an owner of 1 to 39 letters, digits or
 *  inner hyphens; a repo of 1 to 100 letters, digits, ".", "_" or "-", never "." or ".."), so it is never another path. */
const REPO_KEY = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/(?!\.\.?$)[A-Za-z0-9._-]{1,100}$/;
function repoKeyOf(project) {
  const key = String(project ?? '').trim();
  if (!key) throw Object.assign(new Error('a project is required'), { kind: 'plugin' });
  if (!REPO_KEY.test(key)) throw Object.assign(new Error('a project is a repository: owner/repo'), { kind: 'plugin' });
  return key;
}

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

/**
 * Search text that names one issue -> { repo, number }, else null. Accepts
 * `https://github.com/o/r/issues/123` (or /pull/123), `o/r#123`, and `#123` /
 * `123` against the selected repo.
 */
export function parseIssueRef(search, selectedRepo) {
  const s = String(search || '').trim();
  let m = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^\s/#?]+\/[^\s/#?]+)\/(?:issues|pull)\/(\d+)(?:[/?#]\S*)?$/i.exec(s);
  if (m) return { repo: m[1], number: Number(m[2]) };
  m = /^([^\s#/]+\/[^\s#/]+)#(\d+)$/.exec(s);
  if (m) return { repo: m[1], number: Number(m[2]) };
  m = /^#?(\d+)$/.exec(s);
  if (m && selectedRepo) return { repo: selectedRepo, number: Number(m[1]) };
  return null;
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

export default function createTaskSource(ctx, deps = {}) {
  const resolveToken = deps.ghAuthToken || ghAuthToken;
  // An explicit config token wins. With none, fall back to the gh CLI's
  // logged-in account (the `gh` CLI's identity on this machine).
  // Lazy AND memoized: building the source must not spawn anything, and one op
  // must not spawn gh once per request.
  let token = String(ctx.config?.token || '') || null;
  const gh = {
    fetch: deps.fetch || globalThis.fetch,
    get token() { return token ?? (token = resolveToken()); },
  };
  const closeOnComplete = toBool(ctx.config?.closeOnComplete);

  /** @me resolution: login cached in state by validateConfig; lazily fetched otherwise. */
  async function login() {
    const cached = await ctx.state.get('login');
    if (cached) return cached;
    const { json } = await ghFetch(gh, '/user');
    await ctx.state.set('login', json.login);
    return json.login;
  }

  /** The token's repositories, the 100 most recently updated (as the Repository input has always listed them). */
  const repoList = async () => (await ghFetch(gh, '/user/repos?per_page=100&sort=updated')).json;

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

    /** The Repository input's options before Ticket updates; kept for any caller that still names it. */
    async listRepos() {
      return (await repoList()).map((r) => ({ value: r.full_name, label: r.full_name }));
    },

    /** inputs[].optionsFrom: "listProjects" (Ticket updates, D9: a repository is a project, so New run's list is filtered by
     *  the projects you work on); `name` is the repository's name alone, for the chips (D5). */
    async listProjects() {
      return (await repoList()).map((r) => ({ value: r.full_name, label: r.full_name, name: r.name }));
    },

    async listTasks({ inputs = {}, search, cursor } = {}) {
      const repo = String(inputs.repo || '');
      // A pasted URL / o/r#N / #N names one issue: fetch it directly, ignoring
      // the Filter, so closed, foreign-assigned or deep-paged issues are reachable.
      const ref = parseIssueRef(search, repo);
      if (ref) {
        let it;
        try {
          it = (await ghFetch(gh, `/repos/${ref.repo}/issues/${ref.number}`)).json;
        } catch (e) {
          if (e.status === 404 || e.status === 410) return { tasks: [] };
          throw e;
        }
        return { tasks: it.pull_request ? [] : [toSummary(ref.repo, it)] };
      }
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
          // Ticket updates (D6): the issue's repository as listProjects names it (GitHub's case), whatever case the id was typed in
          project: /\/repos\/([^/]+\/[^/]+)$/.exec(String(issue.repository_url || ''))?.[1] || repo,
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
      return { writeBack: true, incrementalSync: false, ticketUpdates: true };
    },

    // ---- Ticket updates (plans/ticket-updates-design.md §3) ----
    /** GitHub Issues has the same three statuses in every repository: nothing is asked. */
    async listStatuses({ project } = {}) {
      repoKeyOf(project);
      return STATUSES.map((s) => ({ ...s }));
    },
    legacyMove() {
      return { field: 'closeOnComplete', target: closeOnComplete ? { category: 'done' } : null };
    },
  };
}
