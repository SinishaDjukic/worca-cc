// test/helpers/fake-azure-boards.mjs — a fake Azure DevOps (Boards REST 7.1) for azure-boards-source's Ticket updates
// (plans/ticket-updates-pr2-plan.md): one organization ("acme"), in memory, every request recorded. The connector's host
// (https://dev.azure.com) is fixed and it takes an injected `fetch`, so the fake is that fetch: it answers real `Response`
// objects (status, headers, JSON body) and opens no port. Never a real Azure DevOps.
const st = (name, category) => ({ name, category });
/** An Agile-process project: its work item types and their states (category per state), a custom type with a state only it
 *  has, a hidden type and a disabled one (neither is listed). */
export const AGILE = [
  { name: 'Bug', states: [st('New', 'Proposed'), st('Active', 'InProgress'), st('Resolved', 'Resolved'), st('Closed', 'Completed')] },
  { name: 'Task', states: [st('New', 'Proposed'), st('Active', 'InProgress'), st('Closed', 'Completed'), st('Removed', 'Removed')] },
  { name: 'User Story', states: [st('New', 'Proposed'), st('Active', 'InProgress'), st('Resolved', 'Resolved'), st('Closed', 'Completed'),
    st('Removed', 'Removed')] },
  { name: 'Shipping Note', states: [st('Draft', 'Proposed'), st('Shipped', 'Completed')] },
  { name: 'Idea', states: [st('Proposed', 'Proposed'), st('Dropped', 'Removed')] },
  { name: 'Code Review Request', states: [st('Requested', 'Proposed'), st('Closed', 'Completed')] },
  { name: 'Old Type', isDisabled: true, states: [st('Parked', 'Proposed')] },
];
const ORG = 'acme';

/**
 * @param {{token?:string, projects?:string[], types?:Record<string,object[]>, hidden?:Record<string,string[]>,
 *   items?:Array<{id:number, project:string, type:string, state:string}>, refusePatch?:{status:number, body:any}|null}} o
 */
export function fakeAzureBoards(o = {}) {
  const opt = { token: 'pat', projects: ['Shop'], types: { Shop: AGILE }, hidden: { Shop: ['Code Review Request'] }, items: [], refusePatch: null, ...o };
  const items = new Map(opt.items.map((w) => [w.id, { ...w, comments: [] }]));
  const requests = [];
  const auth = `Basic ${Buffer.from(`:${opt.token}`).toString('base64')}`;
  const answer = (status, body) => new Response(body == null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  // Azure DevOps reads a project name case-insensitively in a URL
  const projectOf = (name) => Object.keys(opt.types).find((k) => k.toLowerCase() === String(name).toLowerCase());
  const view = (w) => ({ id: w.id, rev: 1, fields: { 'System.Id': w.id, 'System.Title': `Item ${w.id}`, 'System.State': w.state,
    'System.WorkItemType': w.type, 'System.TeamProject': w.project, 'System.Tags': '', 'System.ChangedDate': '2026-10-01T00:00:00Z' } });

  async function fetchImpl(url, init = {}) {
    const u = new URL(url);
    const method = (init.method || 'GET').toUpperCase();
    const headers = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    requests.push({ method, path: u.pathname, query: Object.fromEntries(u.searchParams), body, headers });
    if (headers.authorization !== auth) return answer(401, null);
    const seg = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);   // [org, project | '_apis', …]
    if (seg[0] !== ORG) return answer(404, { message: `VS800001: The organization ${seg[0]} does not exist.` });
    if (seg[1] === '_apis' && seg[2] === 'projects') return answer(200, { count: opt.projects.length, value: opt.projects.map((name) => ({ name })) });
    const project = projectOf(seg[1]);
    if (!project) return answer(404, { message: `VS800075: The project with id '${seg[1]}' does not exist, or you do not have permission to access it.` });
    const types = opt.types[project];
    const rest = seg.slice(2).join('/');
    if (method === 'GET' && rest === '_apis/wit/workitemtypes') {
      return answer(200, { count: types.length, value: types.map((t) => ({ name: t.name, isDisabled: !!t.isDisabled, states: t.states.map((s) => ({ ...s, color: '007acc' })) })) });
    }
    if (method === 'GET' && rest === '_apis/wit/workitemtypecategories') {
      return answer(200, { count: 1, value: [{ name: 'Hidden Types Category', referenceName: 'Microsoft.HiddenCategory',
        workItemTypes: (opt.hidden[project] || []).map((name) => ({ name })) }] });
    }
    let m = /^_apis\/wit\/workitemtypes\/([^/]+)\/states$/.exec(rest);
    if (m && method === 'GET') {
      const t = types.find((x) => x.name.toLowerCase() === m[1].toLowerCase());
      return t ? answer(200, { count: t.states.length, value: t.states.map((s) => ({ ...s, color: '007acc' })) })
        : answer(404, { message: `VS402323: Work item type ${m[1]} does not exist.` });
    }
    m = /^_apis\/wit\/workitems\/(\d+)(\/comments)?$/i.exec(rest);
    const w = m && items.get(Number(m[1]));
    if (m && !w) return answer(404, { message: `TF401232: Work item ${m[1]} does not exist, or you do not have permissions to read it.` });
    if (m && m[2]) {
      if (method === 'POST') { w.comments.push(body.text); return answer(200, { id: w.comments.length, text: body.text }); }
      return answer(200, { totalCount: w.comments.length, comments: w.comments.map((text) => ({ text, createdBy: { displayName: 'Worca' }, createdDate: '2026-10-01T00:00:00Z' })) });
    }
    if (m && method === 'PATCH') {
      if (opt.refusePatch) return answer(opt.refusePatch.status, opt.refusePatch.body);
      const op = (Array.isArray(body) ? body : []).find((x) => x.path === '/fields/System.State');
      const t = types.find((x) => x.name === w.type);
      if (op && !t.states.some((s) => s.name === op.value)) {
        return answer(400, { message: 'TF401320: Rule Error for field State. Error code: Required, HasValues, LimitedToValues, AllowsOldValue, InvalidEmpty.' });
      }
      if (op) w.state = op.value;
      return answer(200, view(w));
    }
    if (m && method === 'GET') return answer(200, view(w));
    return answer(404, { message: `fake Azure DevOps: no route ${method} ${u.pathname}` });
  }
  return { fetch: fetchImpl, items, requests };
}
