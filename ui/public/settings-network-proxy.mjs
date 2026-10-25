// ui/public/settings-network-proxy.mjs — Settings › Network proxy (networkProxy.enabled, Simple level).
// Save applies live (the server swaps the upstream); a new upstream must pass a Test first (UNTESTED).
import { withButton, fieldError, clearFieldErrors } from './feedback.mjs';
import { makeSwitch } from './switch.mjs';

export const FIXED_PORT_NOTE = 'Applies at the next start';
export const SAVED_TEXT = 'Saved. New connections use it now.';
export const PORT_PENDING_TEXT = ' The local proxy port applies at the next start.';
export const NOT_SAVED_TEXT = 'Not saved: the test did not pass. Fix the values and Save again.';
export const SAVED_OFF_TEXT = 'Saved. New connections go direct now.';
export const TESTING_TEXT = 'Testing…';
const AUTH_OPTIONS = [['auto', 'NTLMv2 (recommended)'], ['basic', 'Basic (password in cleartext)'], ['digest', 'Digest (password from HTTPS_PROXY)'], ['none', 'No login']];
/** Login modes that need the password itself, so Log in (a saved NT hash) is off, with this hint (D16). */
const PASSWORD_NOTES = {
  basic: 'Basic sends the password in cleartext and cannot use a saved login: put DOMAIN%5Cuser:password@ in HTTPS_PROXY, or choose NTLMv2.',
  digest: 'Digest cannot use a saved login (it needs the password): put DOMAIN%5Cuser:password@ in HTTPS_PROXY, or choose NTLMv2.',
};

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

/** The New run page's disclosure (details.advanced, index.html), named np-more here. */
function moreFold(doc, ...rows) {
  const d = make(doc, 'details', 'advanced np-more');
  const s = make(doc, 'summary');
  const chev = make(doc, 'span', 'adv-chev');
  chev.setAttribute('aria-hidden', 'true');
  s.append(chev, make(doc, 'span', '', 'More'));
  const inner = make(doc, 'div', 'advanced-body drows');
  inner.append(...rows);
  d.append(s, inner);
  return d;
}

function build(doc, body) {
  const host = input(doc, 'text', { placeholder: 'proxy.acme.example', autocomplete: 'off', spellcheck: 'false' });
  const port = input(doc, 'number', { min: '1', max: '65535', placeholder: '8080' });
  const { wrap: authWrap, sel: auth } = select(doc, AUTH_OPTIONS);
  const noProxy = input(doc, 'text', { placeholder: 'intranet.acme.example, .corp.acme.example', spellcheck: 'false' });
  const fixedPort = input(doc, 'number', { min: '1024', max: '65535', placeholder: 'any free port' });
  const connectS = input(doc, 'number', { min: '1', max: '3600', placeholder: '30' });
  const authS = input(doc, 'number', { min: '1', max: '3600', placeholder: '15' });
  const idleS = input(doc, 'number', { min: '1', max: '3600', placeholder: '600' });
  const domain = input(doc, 'text', { placeholder: 'ACME', autocomplete: 'off', spellcheck: 'false' });
  const user = input(doc, 'text', { placeholder: 'jdoe', autocomplete: 'username', spellcheck: 'false' });
  const password = input(doc, 'password', { autocomplete: 'new-password' });
  const { row: enabledRow, input: enabled } = makeSwitch(doc, { label: 'Use a corporate proxy', rowClass: 'np-switch' });
  enabled.id = 'npEnabled';
  const portNote = make(doc, 'small', 'hint', '');
  portNote.id = 'npFixedPortNote';
  const fixedRow = field(doc, 'npFixedPort', 'Local proxy port', fixedPort);
  fixedRow.querySelector('.drow-control').append(portNote);
  const drows = make(doc, 'div', 'drows');
  drows.append(
    enabledRow,
    field(doc, 'npHost', 'Proxy host', host), field(doc, 'npPort', 'Port', port), field(doc, 'npAuth', 'Login', auth, authWrap),
    field(doc, 'npNoProxy', 'Hosts that go direct', noProxy),
    moreFold(doc, fixedRow, field(doc, 'npConnectS', 'Connect timeout (s)', connectS),
      field(doc, 'npAuthS', 'Login timeout (s)', authS), field(doc, 'npIdleS', 'Idle timeout (s)', idleS)),
    field(doc, 'npDomain', 'Domain', domain), field(doc, 'npUser', 'User name', user), field(doc, 'npPassword', 'Password', password),
  );
  const actions = make(doc, 'div', 'add-project-actions');
  const btn = (id, text, primary = false) => { const b = make(doc, 'button', primary ? 'btn btn-primary btn-sm' : 'btn btn-sm', text); b.type = 'button'; b.id = id; return b; };
  const save = btn('npSave', 'Save'); const login = btn('npLogin', 'Log in', true); const logout = btn('npLogout', 'Log out'); const test = btn('npTest', 'Test');
  actions.append(save, logout, test, login);
  // Empty small.hint lines filled by JS: the Settings tooltip contract allows no static .hint text.
  // #npBasicNote keeps its slice-2 name on purpose: it now carries the Digest note too (tests pin the id).
  const basicNote = make(doc, 'small', 'hint', '');
  basicNote.id = 'npBasicNote';
  basicNote.hidden = true;
  const status = make(doc, 'small', 'hint', '');
  status.id = 'npStatus';
  status.setAttribute('role', 'status');
  const results = make(doc, 'ul', 'np-results');
  results.id = 'npTestResults';
  body.append(drows, actions, basicNote, status, results);
  portNote.textContent = FIXED_PORT_NOTE;
  return { enabled, host, port, auth, noProxy, fixedPort, connectS, authS, idleS, domain, user, password, save, login, logout, test, basicNote, status, results };
}

function fill(f, st) {
  const s = (st && st.settings) || {};
  f.enabled.checked = s.enabled === true;
  if (s.upstream) { try { const u = new URL(s.upstream); f.host.value = u.hostname; f.port.value = u.port || '80'; } catch { /* left empty */ } }
  f.auth.value = s.auth || 'auto';
  f.noProxy.value = Array.isArray(s.noProxy) ? s.noProxy.join(', ') : (s.noProxy || '');
  f.fixedPort.value = s.fixedPort ? String(s.fixedPort) : '';
  const t = s.timeouts || {};
  f.connectS.value = t.connectMs ? String(t.connectMs / 1000) : '';
  f.authS.value = t.authMs ? String(t.authMs / 1000) : '';
  f.idleS.value = t.idleMs ? String(t.idleMs / 1000) : '';
  if (st && st.login) { f.domain.value = st.login.domain; f.user.value = st.login.user; }
  fillStatus(f, st);
}

/** The server's state line only: the inputs keep what the person typed (after a Test, ux-1-1). */
function fillStatus(f, st) {
  f.status.textContent = statusText(st);
  f.status.dataset.state = st ? st.state : '';
  basicMode(f);
}

/** D5/D16: Basic and Digest keep the login in the HTTPS_PROXY URL, so Log in is off and a hint says why. */
function basicMode(f) {
  const note = PASSWORD_NOTES[f.auth.value];
  f.login.disabled = !!note;
  f.basicNote.hidden = !note;
  f.basicNote.textContent = note || '';
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

/** Mount the card; returns a no-op unsubscribe (the card has no flag to follow). */
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
  function paint() {
    body.replaceChildren();
    f = build(doc, body);
    const cur = f;
    cur.auth.addEventListener('change', () => basicMode(cur));
    /** The form as a networkProxy patch: Save and Test send the same values. */
    const patchOf = (c) => ({
      enabled: c.enabled.checked,
      upstream: c.host.value.trim() ? `http://${c.host.value.trim()}:${c.port.value.trim() || '8080'}` : null,
      auth: c.auth.value, noProxy: c.noProxy.value.trim() || null,
      fixedPort: c.fixedPort.value.trim() ? Number(c.fixedPort.value) : null,
      timeouts: { connectMs: ms(c.connectS), authMs: ms(c.authS), idleMs: ms(c.idleS) },
    });
    /** Test these values (saved or not); one row per host. @returns {Promise<boolean|null>} passed; null: it could not run */
    const runTest = async (c, patch) => {
      const r = await fetchJson('/api/proxy/test', { method: 'POST', body: { networkProxy: patch } });
      // NOT_CONFIGURED / UPSTREAM_INVALID / TEST_RUNNING: the server's sentence, as is.
      if (!r.ok) { c.status.textContent = r.data.error || 'The test could not run'; renderResults(c.results, []); return null; }
      renderResults(c.results, r.data.results);
      return !!r.data.ok;
    };
    cur.save.addEventListener('click', () => withButton(cur.save, async () => {
      clearFieldErrors(body);
      const patch = patchOf(cur);
      const put = () => fetchJson('/api/proxy/settings', { method: 'PUT', body: { networkProxy: patch } });
      let r = await put();
      if (!r.ok && r.data && r.data.code === 'UNTESTED') {
        cur.status.textContent = TESTING_TEXT;   // #npStatus is the live region; the button keeps withButton's spinner
        if (!(await runTest(cur, patch))) { cur.status.textContent = NOT_SAVED_TEXT; return { ok: false }; }
        r = await put();
      }
      if (!r.ok) { fieldError(cur.host, r.data.error || 'Could not save'); return { ok: false }; }
      const port = (r.data.pending || []).includes('fixedPort') ? PORT_PENDING_TEXT : '';
      // Saved, but the running proxy kept its connector (Decision 6a): say why and point at the host (ux-2-3).
      if (r.data.upstreamError) { cur.status.textContent = r.data.upstreamError; fieldError(cur.host, r.data.upstreamError, { focus: false }); }
      else cur.status.textContent = (patch.enabled ? SAVED_TEXT : SAVED_OFF_TEXT) + port;
      return { ok: true };
    }));
    cur.login.addEventListener('click', () => withButton(cur.login, async () => {
      clearFieldErrors(body);
      const r = await fetchJson('/api/proxy/login', { method: 'POST', body: { domain: cur.domain.value.trim(), user: cur.user.value.trim(), password: cur.password.value } });
      cur.password.value = '';
      if (!r.ok) { fieldError(({ user: cur.user, domain: cur.domain, password: cur.password, auth: cur.auth })[r.data.field] || cur.user, r.data.error || 'Could not log in'); return { ok: false }; }
      fill(cur, r.data);
      return { ok: true };
    }, { busy: 'Logging in…', done: 'Logged in', idleDisabled: () => !!PASSWORD_NOTES[cur.auth.value] }));   // stays off in Basic/Digest after "Logged in"
    cur.logout.addEventListener('click', () => withButton(cur.logout, async () => {
      const r = await fetchJson('/api/proxy/logout', { method: 'POST', body: {} });
      if (r.ok) fill(cur, r.data);
      return { ok: r.ok };
    }, { busy: 'Logging out…', done: 'Logged out' }));
    /** After a Test: the server's state line only. The inputs keep what the person typed (ux-1-1). */
    const refreshStatus = async () => {
      const r = await fetchJson('/api/proxy/status');
      if (f === cur && r.ok) fillStatus(cur, r.data);
    };
    cur.test.addEventListener('click', () => withButton(cur.test, async () => {
      const ok = await runTest(cur, patchOf(cur));
      if (ok !== null) void refreshStatus();   // a refusal keeps the server's sentence in the status line
      return { ok: !!ok };
    }, { busy: TESTING_TEXT, done: 'Tested' }));
    void refresh();
  }
  paint();
  return () => {};
}
