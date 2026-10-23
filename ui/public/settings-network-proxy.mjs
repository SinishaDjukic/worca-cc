// ui/public/settings-network-proxy.mjs — Settings › Network proxy (corporateProxy flag).
// The body exists only while the flag is on: off, nothing is built and no /api/proxy call goes out.
import { flagOn, onFlagChange } from './flags.mjs';
import { withButton, fieldError, clearFieldErrors } from './feedback.mjs';

export const NETWORK_PROXY_FLAG = 'corporateProxy';
const AUTH_OPTIONS = [['auto', 'NTLMv2 (recommended)'], ['basic', 'Basic (password in cleartext)'], ['none', 'No login']];

async function defaultFetchJson(url, { method = 'GET', body } = {}) {
  const r = await fetch(url, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  let data = {};
  try { data = await r.json(); } catch { /* an empty body */ }
  return { ok: r.ok, status: r.status, data };
}

function make(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function field(doc, id, label, input, control = input) {
  const row = make(doc, 'div', 'field drow');
  const l = make(doc, 'label', 'drow-label', label);
  l.htmlFor = id;
  input.id = id;
  const ctl = make(doc, 'div', 'drow-control');
  ctl.append(control);
  row.append(l, ctl);
  return row;
}

function input(doc, type, attrs = {}) {
  const i = make(doc, 'input', 'input');
  i.type = type;
  for (const [k, v] of Object.entries(attrs)) i.setAttribute(k, v);
  return i;
}

/** The status line: the server's sentence (proxyState().line, D12); the card adds no wording of its own. */
export function statusText(st) {
  return st && typeof st.line === 'string' ? st.line : '';
}

/** The house select markup (`div.select-wrap`, as in #network-wait-settings-card). */
function select(doc, options) {
  const wrap = make(doc, 'div', 'select-wrap');
  const sel = make(doc, 'select', 'select');
  for (const [v, t] of options) { const o = make(doc, 'option', '', t); o.value = v; sel.append(o); }
  wrap.append(sel);
  return { wrap, sel };
}

function build(doc, body) {
  const host = input(doc, 'text', { placeholder: 'proxy.acme.example', autocomplete: 'off', spellcheck: 'false' });
  const port = input(doc, 'number', { min: '1', max: '65535', placeholder: '8080' });
  const { wrap: authWrap, sel: auth } = select(doc, AUTH_OPTIONS);
  const noProxy = input(doc, 'text', { placeholder: 'intranet.acme.example, .corp.acme.example', spellcheck: 'false' });
  const connectS = input(doc, 'number', { min: '1', max: '3600', placeholder: '30' });
  const authS = input(doc, 'number', { min: '1', max: '3600', placeholder: '15' });
  const idleS = input(doc, 'number', { min: '1', max: '3600', placeholder: '600' });
  const domain = input(doc, 'text', { placeholder: 'ACME', autocomplete: 'off', spellcheck: 'false' });
  const user = input(doc, 'text', { placeholder: 'jdoe', autocomplete: 'username', spellcheck: 'false' });
  const password = input(doc, 'password', { autocomplete: 'new-password' });
  const drows = make(doc, 'div', 'drows');
  drows.append(
    field(doc, 'npHost', 'Proxy host', host), field(doc, 'npPort', 'Port', port), field(doc, 'npAuth', 'Login', auth, authWrap),
    field(doc, 'npNoProxy', 'Hosts that go direct', noProxy),
    field(doc, 'npConnectS', 'Connect timeout (s)', connectS), field(doc, 'npAuthS', 'Login timeout (s)', authS), field(doc, 'npIdleS', 'Idle timeout (s)', idleS),
    field(doc, 'npDomain', 'Domain', domain), field(doc, 'npUser', 'User name', user), field(doc, 'npPassword', 'Password', password),
  );
  const actions = make(doc, 'div', 'add-project-actions');
  const btn = (id, text, primary = false) => { const b = make(doc, 'button', primary ? 'btn btn-primary btn-sm' : 'btn btn-sm', text); b.type = 'button'; b.id = id; return b; };
  const save = btn('npSave', 'Save'); const login = btn('npLogin', 'Log in', true); const logout = btn('npLogout', 'Log out'); const test = btn('npTest', 'Test');
  actions.append(save, logout, test, login);
  // Empty small.hint lines filled by JS: the Settings tooltip contract allows no static .hint text.
  const basicNote = make(doc, 'small', 'hint', '');
  basicNote.id = 'npBasicNote';
  basicNote.hidden = true;
  const status = make(doc, 'small', 'hint', '');
  status.id = 'npStatus';
  status.setAttribute('role', 'status');
  const results = make(doc, 'ul', 'np-results');
  results.id = 'npTestResults';
  body.append(drows, actions, basicNote, status, results);
  return { host, port, auth, noProxy, connectS, authS, idleS, domain, user, password, save, login, logout, test, basicNote, status, results };
}

function fill(f, st) {
  const s = (st && st.settings) || {};
  if (s.upstream) { try { const u = new URL(s.upstream); f.host.value = u.hostname; f.port.value = u.port || '80'; } catch { /* left empty */ } }
  f.auth.value = s.auth || 'auto';
  f.noProxy.value = Array.isArray(s.noProxy) ? s.noProxy.join(', ') : (s.noProxy || '');
  const t = s.timeouts || {};
  f.connectS.value = t.connectMs ? String(t.connectMs / 1000) : '';
  f.authS.value = t.authMs ? String(t.authMs / 1000) : '';
  f.idleS.value = t.idleMs ? String(t.idleMs / 1000) : '';
  if (st && st.login) { f.domain.value = st.login.domain; f.user.value = st.login.user; }
  f.status.textContent = statusText(st);
  f.status.dataset.state = st ? st.state : '';
  basicMode(f);
}

/** D5: Basic keeps the login in the HTTPS_PROXY URL, so Log in is off and a hint says why. */
function basicMode(f) {
  const basic = f.auth.value === 'basic';
  f.login.disabled = basic;
  f.basicNote.hidden = !basic;
  f.basicNote.textContent = basic ? 'Basic sends the password in cleartext and cannot use a saved login: put DOMAIN%5Cuser:password@ in HTTPS_PROXY, or choose NTLMv2.' : '';
}

/** Render one Test result row per host. */
export function renderResults(list, results) {
  list.replaceChildren(...(results || []).map((r) => {
    const li = list.ownerDocument.createElement('li');
    li.dataset.host = r.host;
    li.dataset.ok = String(!!r.ok);
    li.textContent = r.ok ? `${r.host}: OK${r.via === 'direct' ? ' (goes direct)' : ` (${r.ms} ms)`}` : `${r.host}: FAIL, ${r.error}`;
    return li;
  }));
}

/** Mount the card; returns an unsubscribe function. */
export function mountNetworkProxyCard({ doc = globalThis.document, fetchJson = defaultFetchJson } = {}) {
  const card = doc.getElementById('network-proxy-settings-card');
  const body = card && card.querySelector('#networkProxyBody');
  if (!body) return () => {};
  let f = null;
  const ms = (el) => (el.value.trim() ? Math.round(Number(el.value) * 1000) : null);
  async function refresh() {
    const r = await fetchJson('/api/proxy/status');
    if (f && r.ok) fill(f, r.data);
  }
  function paint(on) {
    body.replaceChildren();
    f = null;
    if (!on) return;
    f = build(doc, body);
    const cur = f;
    cur.auth.addEventListener('change', () => basicMode(cur));
    cur.save.addEventListener('click', () => withButton(cur.save, async () => {
      clearFieldErrors(body);
      const upstream = cur.host.value.trim() ? `http://${cur.host.value.trim()}:${cur.port.value.trim() || '8080'}` : null;
      const r = await fetchJson('/api/proxy/settings', { method: 'PUT', body: { networkProxy: {
        upstream, auth: cur.auth.value, noProxy: cur.noProxy.value.trim() || null,
        timeouts: { connectMs: ms(cur.connectS), authMs: ms(cur.authS), idleMs: ms(cur.idleS) } } } });
      if (!r.ok) { fieldError(cur.host, r.data.error || 'Could not save'); return { ok: false }; }
      cur.status.textContent = 'Saved. Restart Worca to use the new proxy settings.';
      return { ok: true };
    }));
    cur.login.addEventListener('click', () => withButton(cur.login, async () => {
      clearFieldErrors(body);
      const r = await fetchJson('/api/proxy/login', { method: 'POST', body: { domain: cur.domain.value.trim(), user: cur.user.value.trim(), password: cur.password.value } });
      cur.password.value = '';
      if (!r.ok) { fieldError(({ user: cur.user, domain: cur.domain, password: cur.password, auth: cur.auth })[r.data.field] || cur.user, r.data.error || 'Could not log in'); return { ok: false }; }
      fill(cur, r.data);
      return { ok: true };
    }, { busy: 'Logging in…', done: 'Logged in', idleDisabled: () => cur.auth.value === 'basic' }));   // stays off in Basic after "Logged in"
    cur.logout.addEventListener('click', () => withButton(cur.logout, async () => {
      const r = await fetchJson('/api/proxy/logout', { method: 'POST', body: {} });
      if (r.ok) fill(cur, r.data);
      return { ok: r.ok };
    }, { busy: 'Logging out…', done: 'Logged out' }));
    cur.test.addEventListener('click', () => withButton(cur.test, async () => {
      const r = await fetchJson('/api/proxy/test', { method: 'POST', body: {} });
      // RESTART_NEEDED / NOT_CONFIGURED / TEST_RUNNING: the server's sentence, as is.
      if (!r.ok) { cur.status.textContent = r.data.error || 'The test could not run'; renderResults(cur.results, []); return { ok: false }; }
      renderResults(cur.results, r.data.results);
      void refresh();
      return { ok: r.data.ok };
    }, { busy: 'Testing…', done: 'Tested' }));
    void refresh();
  }
  const off = onFlagChange(NETWORK_PROXY_FLAG, (on) => paint(on));
  paint(flagOn(NETWORK_PROXY_FLAG, doc));
  return off;
}
