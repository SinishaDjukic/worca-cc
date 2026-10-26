// test/helpers/fake-jira.mjs — a fake Jira (REST v2) on 127.0.0.1 for jira-source's export ops (plans/requirements-a6-design.md
// §5, §9): Cloud or Data Center, in memory, every request recorded. Never a real Jira. Cloud answers create metadata as
// { issueTypes | fields }, Data Center as { values }; Cloud searches at /search/jql, Data Center at /search.
import { createServer } from 'node:http';

const PROJECTS = [{ key: 'SHOP', name: 'Shop web' }, { key: 'OPS', name: 'Operations' }];
const TYPES = [{ id: '10001', name: 'Story', subtask: false }, { id: '10002', name: 'Task', subtask: false }, { id: '10003', name: 'Bug', subtask: false },
  { id: '10004', name: 'Sub-task', subtask: true }];
const BASE_FIELDS = [
  { fieldId: 'summary', name: 'Summary', required: true, schema: { type: 'string', system: 'summary' } },
  { fieldId: 'issuetype', name: 'Issue Type', required: true, schema: { type: 'issuetype', system: 'issuetype' } },
  { fieldId: 'priority', name: 'Priority', required: false, schema: { type: 'priority', system: 'priority' },
    allowedValues: [{ id: '1', name: 'Highest' }, { id: '3', name: 'Medium' }] },
  { fieldId: 'customfield_10070', name: 'Acceptance Criteria', required: false,
    schema: { type: 'string', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:textarea' } },
  { fieldId: 'customfield_10080', name: 'Sprint goal', required: false,
    schema: { type: 'string', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:textfield' } },
];

export async function startFakeJira(o = {}) {
  // refusePropertyPut: a role that may create issues but not edit them (403 on the property PUT); failReadBack: a description
  // read fails (500); refuseIssuetypeEdit: an edit naming issuetype is refused; fail: one request answers that status and body.
  const opt = { deployment: 'cloud', token: 'tok', email: 'ann@acme.test', refuseToken: false, refuseProperties: false, refusePropertyPut: false,
    failReadBack: false, refuseIssuetypeEdit: false, fail: null, oldCreatemeta: false, requiredField: null, refuseOnUpdate: null, storeCrlf: false, ...o };
  const cloud = opt.deployment === 'cloud';
  const auth = cloud ? `Basic ${Buffer.from(`${opt.email}:${opt.token}`).toString('base64')}` : `Bearer ${opt.token}`;
  const fields = [...BASE_FIELDS, ...(opt.requiredField ? [{ fieldId: opt.requiredField.id, name: opt.requiredField.name, required: true,
    schema: { type: 'option', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:select' } }] : [])];
  const issues = new Map();   // key → { key, project, fields, properties, comments }
  const requests = [];
  let next = 101;
  // Cloud keeps descriptions as ADF and answers v2 reads in wiki markup it re-renders: storeCrlf mimics a re-render that is
  // not byte-equal (CRLF, trailing spaces), which the fingerprint must not count as an edit.
  const stored = (text) => (opt.storeCrlf ? `${String(text ?? '').split('\n').join('  \r\n')}\r\n` : String(text ?? ''));
  const send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(body === undefined ? '' : JSON.stringify(body)); };
  const gone = (res) => send(res, 404, { errorMessages: ['Issue does not exist or you do not have permission to see it.'], errors: {} });
  let base = '';
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fake');
    let raw = '';
    for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : undefined;
    const p = url.pathname;
    requests.push({ method: req.method, path: p, query: Object.fromEntries(url.searchParams), body, auth: req.headers.authorization || null });
    if (p === '/rest/api/2/serverInfo') return send(res, 200, { deploymentType: cloud ? 'Cloud' : 'DataCenter' });
    if (opt.refuseToken || req.headers.authorization !== auth) return send(res, 401, { errorMessages: ['You are not authenticated.'] });
    if (opt.fail && req.method === opt.fail.method && p === opt.fail.path) return send(res, opt.fail.status, opt.fail.body);
    if (cloud && p === '/rest/api/2/project/search') return send(res, 200, { values: PROJECTS, isLast: true });
    if (!cloud && p === '/rest/api/2/project') return send(res, 200, PROJECTS);
    let m = /^\/rest\/api\/2\/issue\/createmeta\/([^/]+)\/issuetypes(?:\/([^/]+))?$/.exec(p);
    if (m) {
      if (opt.oldCreatemeta) return send(res, 404, { errorMessages: ['null for uri'], errors: {} });
      const list = m[2] ? fields : TYPES;
      return send(res, 200, cloud ? { [m[2] ? 'fields' : 'issueTypes']: list, startAt: 0, maxResults: 100, total: list.length }
        : { values: list, startAt: 0, maxResults: 100, total: list.length, isLast: true });
    }
    if (p === '/rest/api/2/issue' && req.method === 'POST') {
      if (body.properties && opt.refuseProperties) {
        return send(res, 400, { errorMessages: [], errors: { properties: "Field 'properties' cannot be set. It is not on the appropriate screen, or unknown." } });
      }
      if (opt.requiredField && !body.fields[opt.requiredField.id]) {
        return send(res, 400, { errorMessages: [], errors: { [opt.requiredField.id]: `${opt.requiredField.name} is required.` } });
      }
      const key = `${body.fields.project.key}-${next++}`;
      issues.set(key, { key, project: body.fields.project.key, fields: { ...body.fields, labels: [...(body.fields.labels || [])], description: stored(body.fields.description) },
        properties: Object.fromEntries((body.properties || []).map((x) => [x.key, x.value])), comments: [] });
      return send(res, 201, { id: String(next), key, self: `${base}/rest/api/2/issue/${key}` });
    }
    m = /^\/rest\/api\/2\/issue\/([^/]+)\/properties\/([^/]+)$/.exec(p);
    if (m) {
      const i = issues.get(m[1]);
      if (!i) return gone(res);
      if (req.method === 'PUT') {
        if (opt.refusePropertyPut) return send(res, 403, { errorMessages: ['You do not have permission to edit issues in this project.'], errors: {} });
        i.properties[m[2]] = body;
        return send(res, 200, {});
      }
      return m[2] in i.properties ? send(res, 200, { key: m[2], value: i.properties[m[2]] }) : send(res, 404, { errorMessages: ['The property was not found.'] });
    }
    m = /^\/rest\/api\/2\/issue\/([^/]+)\/comment$/.exec(p);
    if (m) {
      const i = issues.get(m[1]);
      if (!i) return gone(res);
      i.comments.push(body.body);
      return send(res, 201, { id: String(i.comments.length) });
    }
    m = /^\/rest\/api\/2\/issue\/([^/]+)$/.exec(p);
    if (m) {
      const i = issues.get(m[1]);
      if (!i) return gone(res);
      if (req.method === 'PUT') {
        if (opt.refuseIssuetypeEdit && body.fields && 'issuetype' in body.fields) {
          return send(res, 400, { errorMessages: [], errors: { issuetype: "Field 'issuetype' cannot be set. It is not on the appropriate screen, or unknown." } });
        }
        if (opt.refuseOnUpdate && body.fields && opt.refuseOnUpdate.id in body.fields) {
          return send(res, 400, { errorMessages: [], errors: { [opt.refuseOnUpdate.id]: opt.refuseOnUpdate.message } });
        }
        for (const [k, v] of Object.entries(body.fields || {})) i.fields[k] = k === 'description' ? stored(v) : v;
        for (const op of (body.update && body.update.labels) || []) if (op.add && !i.fields.labels.includes(op.add)) i.fields.labels.push(op.add);
        return send(res, 204);
      }
      if (opt.failReadBack && /description/.test(url.searchParams.get('fields') || '')) return send(res, 500, { errorMessages: [], errors: {} });
      return send(res, 200, { key: i.key, fields: { description: i.fields.description, labels: i.fields.labels, summary: i.fields.summary,
        issuetype: i.fields.issuetype } });
    }
    if ((cloud && p === '/rest/api/2/search/jql') || (!cloud && p === '/rest/api/2/search')) {
      const jql = url.searchParams.get('jql') || '';
      const project = (/project = "([^"]+)"/.exec(jql) || [])[1];
      const label = (/labels = "([^"]+)"/.exec(jql) || [])[1];
      const hits = [...issues.values()].filter((i) => (!project || i.project === project) && (!label || i.fields.labels.includes(label))).reverse()
        .map((i) => ({ key: i.key, fields: { description: i.fields.description, labels: i.fields.labels } }));
      return send(res, 200, cloud ? { issues: hits, isLast: true } : { issues: hits, startAt: 0, total: hits.length });
    }
    return send(res, 404, { errorMessages: [`fake Jira: no route ${req.method} ${p}`] });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  return { base, issues, requests, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}
