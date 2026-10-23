// src/core/automation-azure.mjs — the Azure DevOps half of Git event automations (#711, docs/git-automations.md).
// Like Watch PR's Azure adapter (pr/azure.mjs), it answers in GitHub's shapes, so automations.mjs stays forge-blind:
//   a WORK ITEM in the repository's Azure DevOps project is an issue   { number, html_url, title, body, state, user,
//                                                                         author_association, labels, created_at, updated_at }
//   a PULL REQUEST in the repository is a pull                          (the same, plus pull_request, draft, head, base)
//   a work item comment is an issue comment                             { body, user, author_association, issue_url, created_at }
// Tags are labels. There is no outside contributor on Azure DevOps: anyone who can open a work item or a PR, or
// comment on one, is a member of its organization, so every author is MEMBER (pr/azure.mjs's rule for PR comments).
// A rule's repository is the remote slug `dev.azure.com/<org>/<project>/<repo>`. REST 7.1 over adoFetch: the Code PAT
// (WORCA_ADO_TOKEN, or the read/write pair) for repositories, WORCA_ADO_BOARDS_TOKEN (else the Code PAT) for work items.
import { adoFetch } from './pr/azure.mjs';
import { azurePrUrl } from '../shared/azure-remote.mjs';
import { readAzureCredentials } from './azure-credentials.mjs';
import { issueEvent, prEvent } from './automations.mjs';

const enc = encodeURIComponent;
const COMMENTS_VERSION = '7.1-preview.4';
const CLOSED_STATES = new Set(['Closed', 'Done', 'Removed', 'Resolved', 'Completed']);
const FIELDS = ['System.Id', 'System.Title', 'System.State', 'System.Tags', 'System.CreatedDate', 'System.ChangedDate',
  'System.CreatedBy', 'System.Description', 'Microsoft.VSTS.TCM.ReproSteps', 'System.TeamProject'];
const WIQL_TOP = 200;

/** `dev.azure.com/<org>/<project>/<repo>` → { org, project, repo } | null. */
export function parseAzureRepo(repo) {
  const m = /^dev\.azure\.com\/([^/]+)\/([^/]+)\/([^/]+)$/i.exec(String(repo || ''));
  return m ? { org: m[1], project: m[2], repo: m[3] } : null;
}
const repoSlug = ({ org, project, repo }) => `dev.azure.com/${org}/${project}/${repo}`;
const projectBase = (c) => `https://dev.azure.com/${enc(c.org)}/${enc(c.project)}`;
const repoApi = (c) => `${projectBase(c)}/_apis/git/repositories/${enc(c.repo)}`;
const branchOf = (ref) => (typeof ref === 'string' && ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : null);
const login = (identity) => (identity && typeof identity === 'object' ? identity.uniqueName || identity.displayName || identity.id || null
  : typeof identity === 'string' ? identity.replace(/^.*<([^>]+)>\s*$/, '$1') : null);   // "Jane <jane@x.com>" in a work item field

/** Work item HTML (Description, comments) as plain text: what an agent reads and what `/worca approve` is matched on. */
export function htmlText(html) {
  return String(html || '')
    .replace(/<\s*br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d|tr)>/gi, '\n').replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n').trim();
}

/** A work item (REST, or a service hook's resource) as a GitHub issue. */
export function workItemIssue(c, w) {
  const f = (w && w.fields) || {};
  const id = Number(w?.id ?? f['System.Id']);
  return {
    number: id,
    html_url: `${projectBase({ ...c, project: f['System.TeamProject'] || c.project })}/_workitems/edit/${id}`,
    title: String(f['System.Title'] || `#${id}`),
    body: htmlText(f['System.Description'] || f['Microsoft.VSTS.TCM.ReproSteps'] || ''),
    state: CLOSED_STATES.has(f['System.State']) ? 'closed' : 'open',
    user: { login: login(f['System.CreatedBy']) },
    author_association: 'MEMBER',
    labels: String(f['System.Tags'] || '').split(';').map((t) => t.trim()).filter(Boolean),
    created_at: f['System.CreatedDate'] || null,
    updated_at: f['System.ChangedDate'] || f['System.CreatedDate'] || null,
  };
}

/** An Azure DevOps pull request as a GitHub pull. A PR from a fork names the fork as its head repository. */
export function azurePull(c, pr) {
  return {
    number: pr.pullRequestId,
    html_url: azurePrUrl(c, pr.pullRequestId),
    title: String(pr.title || ''),
    body: String(pr.description || ''),
    state: pr.status === 'active' ? 'open' : 'closed',
    draft: pr.isDraft === true,
    user: { login: login(pr.createdBy) },
    author_association: 'MEMBER',
    labels: (Array.isArray(pr.labels) ? pr.labels : []).filter((l) => l && l.active !== false).map((l) => l.name).filter(Boolean),
    created_at: pr.creationDate || null,
    updated_at: pr.creationDate || null,
    pull_request: {},
    head: { sha: pr.lastMergeSourceCommit?.commitId || null, ref: branchOf(pr.sourceRefName),
      repo: { full_name: pr.forkSource ? `${repoSlug(c)}:fork` : repoSlug(c) } },
    base: { ref: branchOf(pr.targetRefName), repo: { full_name: repoSlug(c) } },
  };
}

const failure = (e) => ({ ok: false, status: e?.status || null, class: e?.status === 429 ? 'rate-limit' : e?.kind === 'auth' ? 'auth' : 'failed',
  error: e?.message || String(e) });

/**
 * The automations host adapter for Azure DevOps (the GitHub one's contract, see createAutomationEngine).
 *   fetchHead({ projectDir, repo, number, branch }) → git-sync's fetchPullHead through the repo's remote
 */
export function createAzureAutomationHost({ env = () => process.env, fetchHead } = {}) {
  const E = () => (typeof env === 'function' ? env() : env);
  const boards = (role) => {
    const e = E();
    const t = String(e.WORCA_ADO_BOARDS_TOKEN || '').trim() || (role === 'write' ? readAzureCredentials(e).write : readAzureCredentials(e).read);
    return t ? { authorization: `Basic ${Buffer.from(`:${t}`).toString('base64')}` } : null;
  };
  const wi = (role, url, opts = {}) => adoFetch(role, url, { env: E(), auth: boards(role), ...opts });
  const code = (role, url, opts = {}) => adoFetch(role, url, { env: E(), ...opts });
  const coords = (repo) => {
    const c = parseAzureRepo(repo);
    if (!c) throw Object.assign(new Error(`not an Azure DevOps repository: ${repo}`), { kind: 'failed' });
    return c;
  };
  const getPullRaw = async (c, number) => (await code('read', `${repoApi(c)}/pullrequests/${Number(number)}`)).json;

  return {
    /** Work items of the project changed since `since`, and the repository's active PRs, oldest change first. */
    async listIssues({ repo, since }) {
      try {
        const c = coords(repo);
        const q = `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.ChangedDate] >= '${String(since).replace(/'/g, '')}' ORDER BY [System.ChangedDate] ASC`;
        const { json: w } = await wi('read', `${projectBase(c)}/_apis/wit/wiql?timePrecision=true&$top=${WIQL_TOP}`, { method: 'POST', body: { query: q } });
        const ids = (Array.isArray(w?.workItems) ? w.workItems : []).map((x) => x.id).filter(Number.isSafeInteger);
        let items = [];
        if (ids.length) {
          const { json: b } = await wi('read', `https://dev.azure.com/${enc(c.org)}/_apis/wit/workitemsbatch`,
            { method: 'POST', body: { ids, fields: FIELDS, errorPolicy: 'Omit' } });
          items = (Array.isArray(b?.value) ? b.value : []).filter(Boolean).map((x) => workItemIssue(c, x));
        }
        // Every active PR: the list has no "changed since"; the engine's one-decision-per-subject keeps it cheap.
        const { json: p } = await code('read', `${repoApi(c)}/pullrequests?searchCriteria.status=active&$top=100`);
        const pulls = (Array.isArray(p?.value) ? p.value : []).map((x) => azurePull(c, x));
        return { ok: true, items: [...items, ...pulls], etag: null };
      } catch (e) { return failure(e); }
    },
    async getIssue({ repo, number }) {
      try {
        const c = coords(repo);
        const { json } = await wi('read', `${projectBase(c)}/_apis/wit/workitems/${Number(number)}?$expand=fields`);
        return { ok: true, issue: workItemIssue(c, json) };
      } catch (e) { return failure(e); }
    },
    async getPr({ repo, number }) {
      try { const c = coords(repo); return { ok: true, pr: azurePull(c, await getPullRaw(c, number)) }; }
      catch (e) { return failure(e); }
    },
    /** The comments of the waiting work items (`numbers`) changed since `since`: Azure has no project-wide comment list. */
    async listComments({ repo, since, numbers = [] }) {
      try {
        const c = coords(repo);
        const items = [];
        for (const n of [...new Set(numbers)].filter(Number.isSafeInteger)) {
          const { json } = await wi('read', `${projectBase(c)}/_apis/wit/workItems/${n}/comments`, { version: COMMENTS_VERSION });
          for (const x of Array.isArray(json?.comments) ? json.comments : []) {
            const at = x.modifiedDate || x.createdDate;
            if (since && at < since) continue;
            items.push({ body: htmlText(x.text), user: { login: login(x.createdBy) }, author_association: 'MEMBER',
              issue_url: `${projectBase(c)}/_apis/wit/workItems/${n}`, created_at: x.createdDate, updated_at: at });
          }
        }
        return { ok: true, items };
      } catch (e) { return failure(e); }
    },
    /** A work item comment, in markdown. */
    async comment({ repo, number, body }) {
      try {
        const c = coords(repo);
        await wi('write', `${projectBase(c)}/_apis/wit/workItems/${Number(number)}/comments?format=markdown`,
          { method: 'POST', version: COMMENTS_VERSION, body: { text: String(body || '') } });
        return { ok: true };
      } catch (e) { return failure(e); }
    },
    /**
     * The review: one summary thread (created closed: information, like Watch PR's PR comments) and one active
     * thread per inline finding, anchored on the right side of its file. Never a vote. The summary failing fails the
     * review (retried); an inline thread that Azure refuses is left out rather than posting the review twice.
     */
    async review({ repo, number, review }) {
      try {
        const c = coords(repo);
        const threads = `${repoApi(c)}/pullRequests/${Number(number)}/threads`;
        await code('write', threads, { method: 'POST', body: { comments: [{ parentCommentId: 0, content: review.body, commentType: 1 }], status: 4 } });
        for (const x of review.comments || []) {
          try {
            await code('write', threads, { method: 'POST', body: { comments: [{ parentCommentId: 0, content: x.body, commentType: 1 }], status: 1,
              threadContext: { filePath: `/${String(x.path).replace(/^\/+/, '')}`, rightFileStart: { line: x.line, offset: 1 }, rightFileEnd: { line: x.line, offset: 1 } } } });
          } catch { /* that line is not in the PR: the summary already holds the finding's text */ }
        }
        return { ok: true };
      } catch (e) { return failure(e); }
    },
    /** The paths the PR changes, at its latest iteration (without the leading slash Azure gives them). */
    async prFiles({ repo, number }) {
      try {
        const c = coords(repo);
        const pr = `${repoApi(c)}/pullRequests/${Number(number)}`;
        const { json: it } = await code('read', `${pr}/iterations`);
        const last = (Array.isArray(it?.value) ? it.value : []).reduce((m, x) => Math.max(m, Number(x.id) || 0), 0);
        if (!last) return { ok: true, files: [] };
        const { json: ch } = await code('read', `${pr}/iterations/${last}/changes?$top=1000`);
        return { ok: true, files: (Array.isArray(ch?.changeEntries) ? ch.changeEntries : [])
          .map((x) => String(x?.item?.path || '').replace(/^\/+/, '')).filter(Boolean) };
      } catch (e) { return failure(e); }
    },
    /** Azure DevOps has no refs/pull/<n>/head: the PR's source branch is fetched instead (a fork's PR is refused). */
    async fetchPrHead({ projectDir, repo, number, headSha }) {
      try {
        const c = coords(repo);
        const raw = await getPullRaw(c, number);
        if (raw.forkSource) return { ok: false, error: 'pull requests from a fork are not reviewed on Azure DevOps yet' };
        const branch = branchOf(raw.sourceRefName);
        if (!branch) return { ok: false, error: 'the pull request has no source branch' };
        const r = await fetchHead({ projectDir, repo, number, branch });
        if (!r?.ok) return r || { ok: false, error: 'fetch failed' };
        if (headSha && r.sha && r.sha !== headSha) return { ok: false, error: 'the pull request moved while Worca fetched it' };
        return r;
      } catch (e) { return failure(e); }
    },
    /** The account behind the token, per organization (connectionData): Worca's own comments and PRs. */
    async ownLogins(repo) {
      const c = parseAzureRepo(repo);
      if (!c) return [];
      try {
        const { json } = await code('read', `https://dev.azure.com/${enc(c.org)}/_apis/connectionData`, { version: '7.1-preview.1' });
        const u = json?.authenticatedUser;
        return [u?.properties?.Account?.$value, u?.providerDisplayName].filter((x) => typeof x === 'string' && x);
      } catch { return []; }
    },
  };
}

/** The org (and project, repository) a service hook payload names: account baseUrl, the resource's URL, or the PR's repository. */
function payloadCoords(payload) {
  const r = payload?.resource || {};
  const fromUrl = (u) => /^https:\/\/dev\.azure\.com\/([^/]+)\//i.exec(String(u || ''))?.[1] || null;
  const org = fromUrl(payload?.resourceContainers?.account?.baseUrl) || fromUrl(r.url) || fromUrl(r.repository?.url)
    || fromUrl(r.repository?.webUrl) || fromUrl(r.revision?.url);
  return org ? decodeURIComponent(org) : null;
}

/**
 * An Azure DevOps service hook delivery as the engine's items (automations.mjs handleItems), for the rule repositories
 * `repos` (`dev.azure.com/<org>/<project>/<repo>`). A work item belongs to a project, not a repository: it is offered
 * to every repository of its project that has a rule. Events:
 *   workitem.created / workitem.updated (a tag added: the trigger label path) → issue.opened
 *   workitem.commented → a comment (a `/worca approve`)
 *   git.pullrequest.created / git.pullrequest.updated (published from draft, a new push) → pr.opened
 */
export function azureWebhookItems(payload, repos = []) {
  const type = String(payload?.eventType || '');
  const org = payloadCoords(payload);
  if (!org) return [];
  const known = repos.map((r) => ({ slug: r, c: parseAzureRepo(r) })).filter((x) => x.c && x.c.org.toLowerCase() === org.toLowerCase());
  const r = payload.resource || {};
  if (type === 'workitem.created' || type === 'workitem.updated' || type === 'workitem.commented') {
    const w = type === 'workitem.updated' ? { id: r.workItemId ?? r.revision?.id, fields: r.revision?.fields || {} } : r;
    const project = w.fields?.['System.TeamProject'];
    const out = [];
    for (const { slug, c } of known.filter((x) => !project || x.c.project.toLowerCase() === String(project).toLowerCase())) {
      const issue = workItemIssue(c, w);
      if (!Number.isSafeInteger(issue.number)) continue;
      if (type === 'workitem.commented') {
        out.push({ kind: 'comment', repo: slug, number: issue.number, comment: { body: htmlText(w.fields?.['System.History'] || ''),
          user: { login: login(w.fields?.['System.ChangedBy']) }, author_association: 'MEMBER', created_at: w.fields?.['System.ChangedDate'] || null } });
      } else out.push({ kind: 'event', ev: issueEvent(slug, issue) });
    }
    return out;
  }
  if (type === 'git.pullrequest.created' || type === 'git.pullrequest.updated') {
    const name = r.repository?.name; const project = r.repository?.project?.name;
    const hit = known.find((x) => x.c.repo.toLowerCase() === String(name || '').toLowerCase()
      && x.c.project.toLowerCase() === String(project || '').toLowerCase());
    if (!hit || !Number.isSafeInteger(r.pullRequestId)) return [];
    return [{ kind: 'event', ev: prEvent(hit.slug, azurePull(hit.c, r)) }];
  }
  return [];
}
