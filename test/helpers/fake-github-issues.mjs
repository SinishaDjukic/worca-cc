// test/helpers/fake-github-issues.mjs — a fake GitHub Issues REST API for github-source's Ticket updates
// (plans/ticket-updates-pr2-plan.md): in memory, every request recorded. The connector's host (https://api.github.com) is fixed
// and it takes an injected `fetch`, so the fake is that fetch: it answers real `Response` objects and opens no port. Not
// test/helpers/fake-github.mjs, which serves git data for the git-free transports. Never a real GitHub.

/**
 * @param {{token?:string, repos?:Array<{full_name:string, name?:string}>,
 *   issues?:Array<{repo:string, number:number, state:'open'|'closed', state_reason?:string|null}>,
 *   refusePatch?:{status:number, body:any, headers?:object}|null}} o
 */
export function fakeGithubIssues(o = {}) {
  const opt = { token: 'tok', repos: [{ full_name: 'Acme/API' }, { full_name: 'Acme/Web' }], issues: [], refusePatch: null, ...o };
  // GitHub reads owner/repo case-insensitively in a URL and answers its canonical name
  const keyOf = (repo, number) => `${String(repo).toLowerCase()}#${number}`;
  const issues = new Map(opt.issues.map((i) => [keyOf(i.repo, i.number), { state_reason: null, ...i, comments: [] }]));
  const requests = [];
  const answer = (status, body, headers = {}) => new Response(body == null ? null : JSON.stringify(body),
    { status, headers: { 'content-type': 'application/json', ...headers } });
  const view = (i) => ({ number: i.number, title: `Issue ${i.number}`, body: '', state: i.state, state_reason: i.state_reason,
    html_url: `https://github.com/${i.repo}/issues/${i.number}`, repository_url: `https://api.github.com/repos/${i.repo}`,
    labels: [], assignee: null, updated_at: '2026-10-01T00:00:00Z' });

  async function fetchImpl(url, init = {}) {
    const u = new URL(url);
    const method = (init.method || 'GET').toUpperCase();
    const headers = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    requests.push({ method, path: u.pathname, query: Object.fromEntries(u.searchParams), body });
    if (headers.authorization !== `Bearer ${opt.token}`) return answer(401, { message: 'Bad credentials' });
    if (method === 'GET' && u.pathname === '/user/repos') {
      return answer(200, opt.repos.map((r) => ({ full_name: r.full_name, name: r.name ?? r.full_name.split('/')[1] })));
    }
    const m = /^\/repos\/([^/]+)\/([^/]+)\/issues\/(\d+)(\/comments)?$/.exec(u.pathname);
    const i = m && issues.get(keyOf(`${m[1]}/${m[2]}`, m[3]));
    if (!i) return answer(404, { message: 'Not Found' });
    if (m[4]) {
      if (method === 'POST') { i.comments.push(body.body); return answer(201, { id: i.comments.length, body: body.body }); }
      return answer(200, []);
    }
    if (method === 'PATCH') {
      if (opt.refusePatch) return answer(opt.refusePatch.status, opt.refusePatch.body, opt.refusePatch.headers);
      i.state = body.state || i.state;
      i.state_reason = i.state === 'open' ? 'reopened' : (body.state_reason ?? 'completed');
      return answer(200, view(i));
    }
    return answer(200, view(i));
  }
  return { fetch: fetchImpl, issues, requests, issue: (repo, number) => issues.get(keyOf(repo, number)) };
}
