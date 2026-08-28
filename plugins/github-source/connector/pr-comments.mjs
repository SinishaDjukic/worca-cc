// plugins/github-source/connector/pr-comments.mjs
// GitHub PR comment threads task source (worca-cc plugin API v1). One task per
// THREAD (root + replies) across every PR the filter matches. GraphQL for
// listing (reviewThreads.isResolved is GraphQL-only) and for resolving; REST
// for the reply write-back. Task ids: "owner/repo#42:<kind>:<itemId>".
import { ghFetch, ghGraphql } from './github-api.mjs';
import { createGhClient, toBool } from './gh-client.mjs';

export const PR_CAP = 20;          // PRs per listing (D13)
const THREADS_FIRST = 100, REVIEWS_FIRST = 50, COMMENTS_FIRST = 100, THREAD_COMMENTS_FIRST = 50;

function pluginErr(message) {
  return Object.assign(new Error(message), { kind: 'plugin' });
}

/**
 * `state:open review-requested:@me pr-author:bob pr:12 label:x resolved:all author:any`
 * PR selectors narrow PRs; `resolved`/`author` filter the threads (D4).
 */
export function parsePrFilter(filter) {
  const q = { state: 'open', reviewRequested: null, prAuthor: null, pr: null, labels: [], resolved: 'unresolved', author: 'not-me' };
  for (const tok of String(filter || '').trim().split(/\s+/)) {
    if (!tok) continue;
    const [k, ...rest] = tok.split(':');
    const v = rest.join(':');
    if (k === 'state' && ['open', 'closed', 'all'].includes(v)) q.state = v;
    else if (k === 'review-requested' && v) q.reviewRequested = v;
    else if (k === 'pr-author' && v) q.prAuthor = v;
    else if (k === 'pr' && /^\d+$/.test(v)) q.pr = Number(v);
    else if (k === 'label' && v) q.labels.push(v);
    else if (k === 'resolved' && ['unresolved', 'all'].includes(v)) q.resolved = v;
    else if (k === 'author' && v) q.author = v;            // not-me | any | <login>
    // Unknown tokens are ignored (forward-compatible micro-syntax).
  }
  return q;
}

/** GitHub search string for the PR selectors (`@me` is native to search). */
export function searchQuery(repo, f) {
  const parts = [`repo:${repo}`, 'is:pr'];
  if (f.state !== 'all') parts.push(`state:${f.state}`);
  if (f.reviewRequested) parts.push(`review-requested:${f.reviewRequested}`);
  if (f.prAuthor) parts.push(`author:${f.prAuthor}`);
  for (const l of f.labels) parts.push(`label:"${l.replace(/"/g, '')}"`);
  return parts.join(' ');
}

export function makeThreadId(repo, number, kind, itemId) {
  return `${repo}#${number}:${kind}:${itemId}`;
}

/** 'owner/repo#42:thread:PRRT_x' -> { repo, number, kind, itemId } */
export function parseThreadId(id) {
  const m = /^([^\s#:]+\/[^\s#:]+)#(\d+):(thread|review|comment):([A-Za-z0-9_=-]+)$/.exec(String(id || ''));
  if (!m) throw pluginErr(`bad GitHub PR-comment task id "${id}" (expected owner/repo#42:<thread|review|comment>:<id>)`);
  return { repo: m[1], number: Number(m[2]), kind: m[3], itemId: m[4] };
}

/**
 * The thread model mirrors the `diff_comments` vocabulary (path, side
 * 'old'|'new', line, resolved, url, author, body) so a later sync can map 1:1.
 * @typedef {object} PrThread
 * @property {string} id            worca task id (makeThreadId)
 * @property {'thread'|'review'|'comment'} kind
 * @property {string} repo          'owner/repo'
 * @property {number} number        PR number
 * @property {string} prTitle
 * @property {string} prUrl
 * @property {boolean} isDraft
 * @property {string|null} path     diff-anchored threads only
 * @property {number|null} line     end line ('line' in REST); null when outdated
 * @property {number|null} startLine
 * @property {'old'|'new'|null} side   LEFT -> 'old', RIGHT -> 'new'
 * @property {boolean|null} resolved   threads only; null for review/comment
 * @property {boolean} outdated
 * @property {string|null} reviewState  'CHANGES_REQUESTED' | 'COMMENTED' | 'APPROVED' (review kind)
 * @property {string} url           html url of the root item
 * @property {{ref: string, sha: string, repo: string|null}} head
 * @property {{ref: string}} base
 * @property {boolean} sameRepo     head lives in the PR's own repo (no fork)
 * @property {{id: string, author: string, body: string, createdAt: string, url: string, diffHunk: string|null}[]} comments  root first
 * @property {string} updatedAt     last comment's createdAt
 */

export const PR_FRAGMENT = `
fragment PrFields on PullRequest {
  number title url isDraft headRefName headRefOid baseRefName
  headRepository { nameWithOwner } repository { nameWithOwner }
  reviewThreads(first: ${THREADS_FIRST}) { nodes {
    id isResolved isOutdated path line startLine diffSide
    comments(first: ${THREAD_COMMENTS_FIRST}) { nodes { databaseId url body createdAt diffHunk author { login } } }
  } }
  reviews(first: ${REVIEWS_FIRST}) { nodes { databaseId url body state createdAt author { login } } }
  comments(first: ${COMMENTS_FIRST}) { nodes { databaseId url body createdAt author { login } } }
}`;

export const SEARCH_QUERY = `query($q: String!, $first: Int!) {
  viewer { login }
  search(query: $q, type: ISSUE, first: $first) { issueCount nodes { ... on PullRequest { ...PrFields } } }
}${PR_FRAGMENT}`;

export const PR_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  viewer { login }
  repository(owner: $owner, name: $name) { pullRequest(number: $number) { ...PrFields } }
}${PR_FRAGMENT}`;

const sideOf = (diffSide) => (diffSide === 'LEFT' ? 'old' : diffSide === 'RIGHT' ? 'new' : null);
const authorOf = (n) => n?.author?.login || 'ghost';
const commentOf = (c) => ({
  id: String(c.databaseId), author: authorOf(c), body: c.body || '', createdAt: c.createdAt, url: c.url, diffHunk: c.diffHunk ?? null,
});

function prBase(pr) {
  const repo = pr.repository.nameWithOwner;
  const headRepo = pr.headRepository?.nameWithOwner ?? null;   // null when the fork was deleted
  return {
    repo, number: pr.number, prTitle: pr.title, prUrl: pr.url, isDraft: !!pr.isDraft,
    head: { ref: pr.headRefName, sha: pr.headRefOid, repo: headRepo },
    base: { ref: pr.baseRefName },
    sameRepo: headRepo === repo,
  };
}

/** Flatten one PR into PrThread[] (threads, then reviews, then conversation comments), applying the thread filters. */
export function prToThreads(pr, f, me) {
  const base = prBase(pr);
  const out = [];
  const keepAuthor = (login) => f.author === 'any' || (f.author === 'not-me' ? login !== me : login === f.author);

  for (const t of pr.reviewThreads?.nodes || []) {
    const comments = (t.comments?.nodes || []).map(commentOf);
    if (!comments.length) continue;
    if (f.resolved === 'unresolved' && t.isResolved) continue;
    if (!keepAuthor(comments[0].author)) continue;                  // filter on the ROOT author
    out.push({
      ...base, id: makeThreadId(base.repo, base.number, 'thread', t.id), kind: 'thread',
      path: t.path, line: t.line ?? null, startLine: t.startLine ?? null, side: sideOf(t.diffSide),
      resolved: !!t.isResolved, outdated: !!t.isOutdated, reviewState: null, url: comments[0].url,
      comments, updatedAt: comments[comments.length - 1].createdAt,
    });
  }
  for (const r of pr.reviews?.nodes || []) {
    if (!r.body || r.state === 'PENDING') continue;                 // D6
    const c = commentOf(r);
    if (!keepAuthor(c.author)) continue;
    out.push({
      ...base, id: makeThreadId(base.repo, base.number, 'review', r.databaseId), kind: 'review',
      path: null, line: null, startLine: null, side: null, resolved: null, outdated: false,
      reviewState: r.state, url: r.url, comments: [c], updatedAt: c.createdAt,
    });
  }
  for (const ic of pr.comments?.nodes || []) {
    const c = commentOf(ic);
    if (!c.body || !keepAuthor(c.author)) continue;
    out.push({
      ...base, id: makeThreadId(base.repo, base.number, 'comment', ic.databaseId), kind: 'comment',
      path: null, line: null, startLine: null, side: null, resolved: null, outdated: false,
      reviewState: null, url: c.url, comments: [c], updatedAt: c.createdAt,
    });
  }
  return out;
}

const firstLine = (s) => String(s || '').split(/\r?\n/).find((l) => l.trim()) || '';
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const KIND_LABEL = { thread: 'review-thread', review: 'review', comment: 'comment' };

/** TaskSummary for the browser row: "#42 path:line — first line" + labels. */
export function threadSummary(t) {
  const root = t.comments[0];
  const anchor = t.kind === 'thread'
    ? `${t.path}${t.line != null ? `:${t.line}` : ''}`
    : t.kind === 'review' ? `review (${t.reviewState})` : 'comment';
  const labels = [`PR #${t.number}`, KIND_LABEL[t.kind]];
  if (t.kind === 'thread') labels.push(t.resolved ? 'resolved' : 'unresolved');
  if (t.outdated) labels.push('outdated');
  if (t.isDraft) labels.push('draft');
  return {
    id: t.id,
    title: `#${t.number} ${anchor} — ${clip(firstLine(root.body), 70)}`,
    url: t.url,
    state: t.resolved ? 'closed' : 'open',
    labels,
    updatedAt: t.updatedAt,
  };
}

/** Markdown task body: PR, file/line, hunk, the whole thread. */
export function renderTaskBody(t) {
  const lines = [`**PR:** [${t.repo}#${t.number} — ${t.prTitle}](${t.prUrl}) (\`${t.head.ref}\` → \`${t.base.ref}\`)${t.isDraft ? ' — draft' : ''}`];
  if (!t.sameRepo) lines.push(`**Note:** the PR head lives in fork \`${t.head.repo ?? 'unknown'}\`; this run branches off the project's default branch.`);
  if (t.kind === 'thread') {
    const range = t.startLine != null && t.startLine !== t.line ? `lines ${t.startLine}–${t.line}` : `line ${t.line ?? '?'}`;
    lines.push(`**File:** \`${t.path}\` ${range} (${t.side ?? 'new'} side)${t.outdated ? ' — outdated (the diff moved since)' : ''}${t.resolved ? ' — resolved' : ''}`);
    const hunk = t.comments.find((c) => c.diffHunk)?.diffHunk;
    if (hunk) lines.push('', '```diff', hunk, '```');
  } else if (t.kind === 'review') {
    lines.push(`**Review:** ${t.reviewState} by @${t.comments[0].author} — [link](${t.url})`);
  } else {
    lines.push(`**Conversation comment** — [link](${t.url})`);
  }
  lines.push('', '## Thread', '');
  for (const c of t.comments) lines.push(`**@${c.author}** (${c.createdAt}):`, '', c.body, '');
  return lines.join('\n');
}

/** Full getTask() payload: summary + body + meta + (same-repo only) the checkout hint (D8, D11). */
export function threadToTask(t) {
  const task = {
    ...threadSummary(t),
    body: renderTaskBody(t),
    meta: {
      repo: t.repo, number: t.number, prTitle: t.prTitle, prUrl: t.prUrl, kind: t.kind,
      path: t.path, line: t.line, startLine: t.startLine, side: t.side,
      resolved: t.resolved, outdated: t.outdated, reviewState: t.reviewState,
      headRef: t.head.ref, headSha: t.head.sha, headRepo: t.head.repo, baseRef: t.base.ref,
      threadId: t.kind === 'thread' ? parseThreadId(t.id).itemId : null,
      rootCommentId: t.comments[0].id,
      url: t.url,
    },
  };
  // base = the PR base so the host records state.branch.source = base (Create PR: base/head differ, D8).
  if (t.sameRepo) task.checkout = { branch: t.head.ref, base: t.base.ref, repo: t.repo, sha: t.head.sha };
  return task;
}

const NODE_ROOT_QUERY = `query($id: ID!) {
  node(id: $id) { ... on PullRequestReviewThread { comments(first: 1) { nodes { databaseId } } } }
}`;
const RESOLVE_MUTATION = `mutation($threadId: ID!) {
  resolveReviewThread(input: { threadId: $threadId }) { thread { id isResolved } }
}`;

function splitRepo(repo) {
  const [owner, name] = String(repo).split('/');
  if (!owner || !name) throw pluginErr(`bad repo "${repo}" (expected owner/repo)`);
  return { owner, name };
}

/** D15: newest first; equal timestamps -> higher PR number first -> id. Stable and total. */
function byRecency(a, b) {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
  if (a.number !== b.number) return b.number - a.number;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

const ALL_THREADS = parsePrFilter('resolved:all author:any');   // getTask/reportResult never filter

export default function createPrCommentsSource(ctx, deps = {}) {
  const { gh, login, validateConfig } = createGhClient(ctx, deps);
  const resolveOnComplete = toBool(ctx.config?.resolveOnComplete);

  /** Remember the viewer login from any GraphQL response so @me / not-me never costs an extra request. */
  async function remember(data) {
    if (data?.viewer?.login) await ctx.state.set('login', data.viewer.login);
    return data?.viewer?.login || (await login());
  }

  async function fetchPr(repo, number) {
    const { owner, name } = splitRepo(repo);
    const data = await ghGraphql(gh, PR_QUERY, { owner, name, number });
    const pr = data?.repository?.pullRequest;
    if (!pr) throw pluginErr(`GitHub PR ${repo}#${number} not found or not visible to this token`);
    return { pr, me: await remember(data) };
  }

  return {
    validateConfig,

    /** inputs[].optionsFrom: "listRepos" — identical to the issues source. */
    async listRepos() {
      const { json } = await ghFetch(gh, '/user/repos?per_page=100&sort=updated');
      return json.map((r) => ({ value: r.full_name, label: r.full_name }));
    },

    async listTasks({ inputs = {}, search } = {}) {
      const repo = String(inputs.repo || '');
      if (!repo) return { tasks: [] };
      const f = parsePrFilter(inputs.filter);
      let prs, me;
      if (f.pr) {
        const one = await fetchPr(repo, f.pr);
        prs = [one.pr]; me = one.me;
      } else {
        const q = searchQuery(repo, f);
        const data = await ghGraphql(gh, SEARCH_QUERY, { q, first: PR_CAP });
        me = await remember(data);
        prs = (data?.search?.nodes || []).filter((n) => n && n.number);
        const total = data?.search?.issueCount || 0;
        if (total > PR_CAP) {
          ctx.log('warn', `github-pr-comments: ${total} PRs match "${q}", listing threads from the first ${PR_CAP} — narrow the filter (e.g. pr:<n>)`);
        }
      }
      const threads = prs.flatMap((pr) => prToThreads(pr, f, me)).sort(byRecency);
      const needle = String(search || '').trim().toLowerCase();
      const kept = needle
        ? threads.filter((t) => threadSummary(t).title.toLowerCase().includes(needle)
          || t.comments.some((c) => c.body.toLowerCase().includes(needle)))
        : threads;
      return { tasks: kept.map(threadSummary) };            // no cursor (D13; the UI never sends one)
    },

    async getTask(id) {
      const ref = parseThreadId(id);
      const { pr } = await fetchPr(ref.repo, ref.number);
      const thread = prToThreads(pr, ALL_THREADS, null).find((t) => t.id === id);
      if (!thread) throw pluginErr(`GitHub PR comment thread "${id}" not found (deleted, or beyond the first ${THREADS_FIRST} threads)`);
      return threadToTask(thread);
    },

    async reportResult(id, { status, summary, links = [] }) {
      const ref = parseThreadId(id);
      let body = summary || `worca-cc run finished: ${status}`;
      if (links.length) {
        body += '\n\n';
        for (const l of links) body += `- [${l.title}](${l.url})\n`;
      }
      if (ref.kind === 'thread') {
        const data = await ghGraphql(gh, NODE_ROOT_QUERY, { id: ref.itemId });
        const rootId = data?.node?.comments?.nodes?.[0]?.databaseId;
        if (!rootId) throw pluginErr(`review thread ${ref.itemId} has no root comment (deleted?)`);
        await ghFetch(gh, `/repos/${ref.repo}/pulls/${ref.number}/comments/${rootId}/replies`, { method: 'POST', body: { body } });
        if (status === 'completed' && resolveOnComplete) {
          await ghGraphql(gh, RESOLVE_MUTATION, { threadId: ref.itemId });
        }
        return;
      }
      // review / conversation comment: no reply endpoint exists — quote + link the original (D7).
      const { pr } = await fetchPr(ref.repo, ref.number);
      const orig = prToThreads(pr, ALL_THREADS, null).find((t) => t.id === id);
      const who = orig ? `@${orig.comments[0].author}` : 'the reviewer';
      const what = ref.kind === 'review' ? `review by ${who}` : `${who}'s comment`;
      const link = orig ? ` (${orig.url})` : '';
      await ghFetch(gh, `/repos/${ref.repo}/issues/${ref.number}/comments`, { method: 'POST', body: { body: `> Re: ${what}${link}\n\n${body}` } });
    },

    capabilities() {
      return { writeBack: true, incrementalSync: false };
    },
  };
}
