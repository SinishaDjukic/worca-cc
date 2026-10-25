// ui/public/setup-assistant.mjs — the setup assistant (plans/setup-assistant-design.md D11, D18, D19).
// One JS-built dialog over the slice-3 backend: GET /api/setup/detect, POST /api/setup/apply and the
// `setup-apply` WebSocket frames. It opens with the saved values (detection only fills blanks on a first
// start), diffs every answer against them, and sends only what changed. Pure DOM; `doc`, `fetchJson` and
// `timers` are injected for jsdom.
import { layoutDialog } from './dialog-layout.mjs';
import { guardModal } from './modal-guard.mjs';
import { makeSwitch } from './switch.mjs';
import { COPILOT_TERMS, renderCopilotSignIn } from './bridge-view.mjs';
import { renderRolesSection, readRolesValues } from './engine-settings-view.mjs';
import { fetchJson as defaultFetchJson, renderResults, FIXED_PORT_NOTE, AUTH_OPTIONS } from './settings-network-proxy.mjs';
import { LEVEL_INFO, UI_LEVELS } from './ui-level.mjs';
import { ROLE_LABELS, MODEL_ROLES } from '../../src/shared/model-roles.mjs';

export const SETUP_STEPS = Object.freeze([
  { id: 'check', label: 'Check this machine' },
  { id: 'network', label: 'Network' },
  { id: 'access', label: 'Model access' },
  { id: 'models', label: 'Models' },
  { id: 'work', label: 'How you work' },
  { id: 'review', label: 'Review' },
  { id: 'apply', label: 'Apply' },
]);
/** A proxy test pass counts this long: under the server's TESTED_TTL_MS (src/core/proxy-host.mjs, 10 min). */
export const TEST_PASS_MS = 9 * 60_000;
const GROUP_STEP = Object.freeze({ network: 'network', access: 'access', models: 'models', work: 'work' });
const WORK_KEYS = Object.freeze(['uiLevel', 'pipelineCostLimitUsd', 'totalCostLimitUsd', 'costLimitResetPeriod', 'autoGeneratePrDescription', 'smartNaming', 'runEngine']);
const UNREACHABLE = 'Worca could not be reached. Check that it is still running.';
/** Failed steps whose retry needs the proxy password again: the server saves it only in proxy-login (A24). */
export const LOGIN_RETRY_STEPS = Object.freeze(['proxy-swap', 'proxy-login']);

/** An http(s) URL as a string, or null: the only hrefs the broker link may carry (security-2-3). */
export function safeHttpUrl(v) {
  try { const u = new URL(String(v ?? '')); return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null; }
  catch { return null; }
}

/** The key a proxy test pass is recorded under: the values the test sent (A11). */
export function proxyKey(n) {
  const host = String(n.host || '').trim();
  return JSON.stringify({ upstream: host ? `http://${host}:${String(n.port || '').trim() || '8080'}` : null, auth: n.auth || 'auto', noProxy: String(n.noProxy || '').trim() || null });
}

/** Order-blind deep equality (the server's sameValue, src/core/setup/apply.mjs:61, for plain JSON); null == undefined. */
function same(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return (a ?? null) === (b ?? null);
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a).filter((k) => a[k] != null); const kb = Object.keys(b).filter((k) => b[k] != null);
  return ka.length === kb.length && ka.every((k) => same(a[k], b[k]));
}

/**
 * The answers the dialog opens with. `saved` = { settings, proxy, providers } as loaded; `detect` = the
 * /api/setup/detect answer (or null). Saved values always win; on `entry: 'first'` detection fills only a
 * blank: a proxy host from HTTPS_PROXY, and the corporate mode when there is no direct route (D19).
 * `step: 'access'` on a fix-it entry switches Copilot on, since the pill was a Copilot sign-in (AC-4.5).
 */
export function initialAnswers({ saved, detect = null, entry = 'first', step = null }) {
  const s = saved.settings || {}; const p = saved.proxy?.settings || {}; const pv = saved.providers || {};
  let host = ''; let port = '';
  if (p.upstream) { try { const u = new URL(p.upstream); host = u.hostname; port = u.port || '80'; } catch { /* left blank */ } }
  const check = (id) => (detect?.checks || []).find((c) => c.id === id);
  let mode = p.enabled === true ? 'proxy' : 'direct'; let found = null;
  if (entry === 'first' && !p.enabled) {
    const envHost = check('proxyEnv')?.facts?.host;
    if (envHost) { const [h, pt] = String(envHost).split(':'); host ||= h; port ||= pt || ''; mode = 'proxy'; found = `${host}:${port || '8080'}`; }
    else if (check('direct')?.state === 'no') mode = 'proxy';
  }
  const cpConnected = !!pv.copilot?.connected || pv.broker?.providers?.copilot?.state === 'set';
  return {
    network: { mode, host, port, auth: p.auth || 'auto', noProxy: Array.isArray(p.noProxy) ? p.noProxy.join(', ') : (p.noProxy || ''),
      domain: saved.proxy?.login?.domain || '', user: saved.proxy?.login?.user || '', password: '', fixedPort: p.fixedPort ? String(p.fixedPort) : '', timeouts: p.timeouts || {} },
    access: {
      claude: check('claude')?.state === 'ok' || (!cpConnected && !pv.openai?.configured && !pv.anthropic?.configured),
      copilot: cpConnected || (entry === 'fix' && step === 'access'),
      copilotAck: !!pv.copilot?.termsCurrent, copilotAccount: pv.copilot?.accountType || 'individual', copilotConnected: cpConnected, copilotLogin: pv.copilot?.login || '',
      openai: !!pv.openai?.configured, openaiUrl: pv.openai?.baseUrl || '', openaiKey: '',
      anthropic: !!pv.anthropic?.configured, anthropicUrl: pv.anthropic?.baseUrl || '', anthropicKey: '',
      importModels: [],
    },
    models: { modelRoles: structuredClone(s.modelRoles || {}), testRoles: true },
    work: Object.fromEntries(WORK_KEYS.map((k) => [k, structuredClone(s[k] ?? null)])),
    // Not an answer: what detection found (A22). Kept out of the diff by buildApplyBody.
    found: { proxy: found, claude: entry === 'first' && check('claude')?.state === 'ok' },
  };
}

/** The proxy patch the answers stand for (the Network proxy card's patchOf shape). */
function networkPatch(n) {
  if (n.mode === 'direct') return { enabled: false };
  const k = JSON.parse(proxyKey(n));
  return { enabled: true, upstream: k.upstream, auth: k.auth, noProxy: k.noProxy,
    ...(n.fixedPort ? { fixedPort: Number(n.fixedPort) } : {}), ...(Object.keys(n.timeouts || {}).length ? { timeouts: n.timeouts } : {}) };
}
function savedNetworkPatch(saved) {
  const p = saved.proxy?.settings || {};
  if (p.enabled !== true) return { enabled: false };
  // An empty saved list is no list: proxyKey sends null for blank direct hosts, so [] must read as null too.
  return { enabled: true, upstream: p.upstream || null, auth: p.auth || 'auto', noProxy: (Array.isArray(p.noProxy) ? p.noProxy.join(', ') : p.noProxy) || null,
    ...(p.fixedPort ? { fixedPort: p.fixedPort } : {}), ...(p.timeouts && Object.keys(p.timeouts).length ? { timeouts: p.timeouts } : {}) };
}

/**
 * The modelRoles patch (A10): every harness/role whose answer differs from the saved one, with the answer,
 * or null when the answer cleared a saved role. nextModelRoles (src/core/settings.mjs:1448) merges it.
 */
export function rolePatch(saved = {}, now = {}) {
  const patch = {};
  for (const h of new Set([...Object.keys(saved || {}), ...Object.keys(now || {})])) {
    for (const r of MODEL_ROLES) {
      const a = now?.[h]?.[r] ?? null; const b = saved?.[h]?.[r] ?? null;
      if (!same(a, b)) (patch[h] ||= {})[r] = a;
    }
  }
  return patch;
}

/**
 * The POST /api/setup/apply body: only the groups and fields that differ from `saved` (A9, D19). A typed
 * password always rides (it is never saved where the client can read it); an empty or blank key never does.
 */
export function buildApplyBody(saved, answers) {
  const body = {};
  const net = networkPatch(answers.network);
  if (!same(net, savedNetworkPatch(saved))) (body.network ||= {}).networkProxy = net;
  const n = answers.network;
  if (n.mode === 'proxy' && n.auth === 'auto' && n.password) (body.network ||= {}).login = { domain: n.domain.trim(), user: n.user.trim(), password: n.password };
  const a = answers.access; const pv = saved.providers || {};
  const cpSaved = !!pv.copilot?.connected || pv.broker?.providers?.copilot?.state === 'set';
  if (a.copilot && ((a.copilotConnected && !cpSaved) || a.copilotAccount !== (pv.copilot?.accountType || 'individual') || a.importModels.length)) {
    // acknowledgeTerms only from the person's own switch (security-2-2); the server refuses any value but true.
    body.access = { ...body.access, copilot: { ...(a.copilotAck ? { acknowledgeTerms: true } : {}), accountType: a.copilotAccount, signIn: true,
      ...(a.importModels.length ? { importModels: a.importModels } : {}) } };
  }
  for (const name of ['openai', 'anthropic']) {
    if (!a[name]) continue;
    const url = a[`${name}Url`].trim(); const key = a[`${name}Key`].trim();
    const patch = { ...(url !== (pv[name]?.baseUrl || '') ? { baseUrl: url } : {}), ...(key ? { apiKey: key } : {}) };
    if (Object.keys(patch).length) body.access = { ...body.access, [name]: patch };
  }
  const roles = rolePatch(saved.settings?.modelRoles || {}, answers.models.modelRoles);
  if (Object.keys(roles).length) body.models = { modelRoles: roles, testRoles: answers.models.testRoles };
  for (const k of WORK_KEYS) {
    if (!same(answers.work[k], saved.settings?.[k] ?? null)) (body.work ||= {})[k] = answers.work[k];
  }
  return body;
}

/** Review rows: one per group; `changed` when the body would carry that group (D19). */
export function diffRows(saved, answers) {
  const body = buildApplyBody(saved, answers); const n = answers.network; const a = answers.access; const w = answers.work;
  const sources = [a.claude && 'Claude Code', a.copilot && 'GitHub Copilot', a.openai && 'OpenAI-compatible', a.anthropic && 'Anthropic-compatible'].filter(Boolean);
  const roles = answers.models.modelRoles[w.runEngine || 'claude'] || {};
  const money = (v) => (v == null ? 'none' : `$${v}`);
  return [
    { group: 'network', step: 'network', label: 'Network', changed: !!body.network,
      value: n.mode === 'proxy' ? `Corporate proxy · ${n.host}:${n.port || '8080'}` : 'Direct' },
    { group: 'access', step: 'access', label: 'Model access', changed: !!body.access, value: sources.join(', ') || 'None' },
    { group: 'models', step: 'models', label: 'Models', changed: !!body.models,
      value: MODEL_ROLES.map((r) => `${ROLE_LABELS[r]} · ${roles[r]?.model || 'each job’s own default'}`).join('; ') },
    { group: 'work', step: 'work', label: 'How you work', changed: !!body.work,
      value: `${LEVEL_INFO[w.uiLevel || 'simple']?.label || 'Simple'} interface · per run ${money(w.pipelineCostLimitUsd)} · total ${money(w.totalCostLimitUsd)}` },
  ];
}

/**
 * Whether the primary button may run on `step`, and the status line when it may not (A11, R-ux-2).
 * `tested` = { key, at } of the last passing test, or null. A first start with nothing to apply returns
 * { ok: true, finish: true } on Review (A23).
 */
export function nextGate(step, answers, { saved, tested = null, now = Date.now(), detect = null, entry = 'first' } = {}) {
  if (step === 'network' && answers.network.mode === 'proxy') {
    if (!tested || tested.key !== proxyKey(answers.network) || now - tested.at >= TEST_PASS_MS) return { ok: false, reason: 'Test the connection to continue' };
  }
  if (step === 'access') {
    const a = answers.access;
    if (!a.claude && !a.copilot && !a.openai && !a.anthropic) return { ok: false, reason: 'Pick at least one source' };
    // Consent first, even when already connected (an older terms version leaves copilotAck false).
    if (a.copilot && !a.copilotAck && !saved?.providers?.broker?.enabled) return { ok: false, reason: 'Accept the GitHub Copilot notice to continue' };
    if (a.copilot && !a.copilotConnected) return { ok: false, reason: 'Sign in to GitHub Copilot to continue' };
    if (a.openai && !a.openaiUrl.trim()) return { ok: false, reason: 'Enter the server address' };
    const claude = (detect?.checks || []).find((c) => c.id === 'claude');
    if (a.claude && claude && claude.state !== 'ok') return { ok: false, reason: 'Run claude /login in a terminal first' };
  }
  if (step === 'review' && !diffRows(saved, answers).some((r) => r.changed)) {
    return entry === 'first' ? { ok: true, finish: true, reason: 'Nothing to change: your current setup already works.' } : { ok: false, reason: 'Nothing changed.' };
  }
  return { ok: true, reason: '' };
}

/** The step that owns an apply 400's `field` ('work.pipelineCostLimitUsd' → 'work'); 'review' when unknown (A20). */
export function stepOfField(field) { return GROUP_STEP[String(field || '').split('.')[0]] || 'review'; }

/** A Models-page sign-in pill → the assistant step it opens, or null to keep the Providers page (A17). */
export function setupStepForSignIn(btn) { return btn?.dataset?.provider === 'copilot' ? 'access' : null; }

const SUBTITLES = Object.freeze({
  check: { first: 'Worca checks this machine, then asks only what it could not find.', other: 'Your current setup is loaded. Change what you need; the rest stays as it is.' },
  network: 'Worca’s agents use this route for every model call.',
  access: 'Turn on every source you can use. You need at least one.',
  models: 'Each role sets the model for every job that has none of its own.',
  work: 'You can change all of these later in Settings.',
  review: { first: 'Worca will save these settings, sign in, import the models and test each one.', other: 'Only the rows marked Changed will be written.' },
  apply: 'Each change runs in order and shows its result.',
});
const TITLES = Object.freeze({ check: 'Let’s set up Worca', network: 'How does this machine reach the internet?', access: 'Where should Worca get its models?',
  models: 'Which models should do the work?', work: 'How do you want to work?', review: 'Check and apply' });
const CHECK_BADGE = Object.freeze({ ok: ['green', 'OK'], warn: ['amber', 'Check'], no: ['grey', 'No'] });
const STATE_BADGE = Object.freeze({ ok: ['green', 'Done'], failed: ['red', 'Failed'], skipped: ['grey', 'Skipped'], refused: ['amber', 'Refused'] });
const COPILOT_PLANS = Object.freeze([['individual', 'Individual'], ['business', 'Business'], ['enterprise', 'Enterprise']]);
const TIMEOUTS = Object.freeze([['connectMs', 'Connect timeout (s)'], ['authMs', 'Login timeout (s)'], ['idleMs', 'Idle timeout (s)']]);
const LOST = 'Worca lost track of this setup. Check the rows, then go back to review.';
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]';

function resultRow(doc, r, state = r.state) {
  const li = doc.createElement('li'); li.className = 'sa-row'; li.dataset.step = r.id; li.dataset.state = state;
  const main = doc.createElement('div'); main.className = 'sa-row-main';
  const name = doc.createElement('div'); name.textContent = r.label; main.append(name);
  if (r.line) { const line = doc.createElement('div'); line.className = 'sa-row-line'; line.textContent = r.line; main.append(line); }
  const mark = doc.createElement('span');
  if (STATE_BADGE[state]) { mark.className = `badge ${STATE_BADGE[state][0]}`; mark.textContent = STATE_BADGE[state][1]; }
  else { mark.className = state === 'running' ? 'mk-phase-spin' : 'mk-phase-dot'; mark.setAttribute('aria-label', state === 'running' ? 'Running' : 'Waiting'); }
  li.append(mark, main);
  return li;
}
function paintApplyRows(doc, list, results, done) {
  const rows = [...results.values()];
  const runIdx = done ? -1 : rows.findIndex((r) => r.state === 'pending');
  list.replaceChildren(...rows.map((r, i) => resultRow(doc, r, i === runIdx ? 'running' : r.state)));
}

/**
 * Open the assistant. entry 'first' | 'rerun' | 'fix'; `step` opens on that step (a fix-it link).
 * onClose(how): 'later' (Set up later / Cancel / Close / Discard), 'done' (Continue after Apply, or Finish).
 * Returns { onFrame(msg), goTo(step), close() }; goTo is a no-op on Apply and switches Copilot on for 'access'.
 */
export function openSetupAssistant({ doc = globalThis.document, fetchJson = defaultFetchJson, entry = 'first', step = 'check', onClose = () => {}, now = () => Date.now(),
  timers = { setTimeout: (f, ms) => doc.defaultView.setTimeout(f, ms), clearTimeout: (t) => doc.defaultView.clearTimeout(t) } } = {}) {
  const el = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const btn = (text, cls, on) => { const b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', on); return b; };
  // A rejected fetch becomes an answer, so no await can leave the dialog loading or busy (A18).
  const call = async (url, opts) => { try { return await fetchJson(url, opts); } catch { return { ok: false, status: 0, data: { error: UNREACHABLE } }; } };
  const S = { step, saved: null, detect: null, answers: null, opened: null, loadError: '', tested: null, testing: false, testResults: [],
    applying: false, early: [], job: null, results: new Map(), body: null, done: null, error: '', errField: null, pollT: null, pollFails: 0, passT: null,
    cpFlow: null, cpT: null, copilotModels: [], expanded: false, more: false, hadLogin: false, retryLogin: null };

  const stepOf = el('span', 'sa-step-of'); const title = el('h2', null); title.id = 'setup-title'; const sub = el('p', 'sa-sub');
  const head = el('div', 'card-head'); head.append(stepOf, title, sub);
  const body = el('div', 'sa-step'); const status = el('small', 'hint sa-status'); status.setAttribute('role', 'status');
  const actions = el('div', 'confirm-actions');
  const card = el('div', 'card setup-card'); card.append(head, body, status, actions);
  layoutDialog(card, { head: [head], foot: [status, actions] });
  const modal = el('div', 'viewer-modal confirm-modal setup-modal'); modal.id = 'setup-modal';
  modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-labelledby', 'setup-title');
  modal.append(card);
  // Any input clears a shown error, so the status line returns to the gate reason (ux-1-5), and the
  // field markField tagged stops reading as invalid.
  card.addEventListener('input', () => {
    if (!S.error && !S.errField) return;
    for (const n of body.querySelectorAll('[aria-invalid]')) n.removeAttribute('aria-invalid');
    S.error = ''; S.errField = null; paintFoot();
  });
  // Tab and Shift+Tab wrap inside the dialog (marketplace/layers.mjs trapTab).
  card.tabIndex = -1;
  const focusables = () => [...card.querySelectorAll(FOCUSABLE)].filter((n) => n.tabIndex >= 0 && n.checkVisibility?.() !== false);
  modal.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const list = focusables(); const active = doc.activeElement;
    if (!list.length) { e.preventDefault(); card.focus(); return; }
    if (!card.contains(active) || active === card) { e.preventDefault(); (e.shiftKey ? list[list.length - 1] : list[0]).focus(); }
    else if (e.shiftKey && active === list[0]) { e.preventDefault(); list[list.length - 1].focus(); }
    else if (!e.shiftKey && active === list[list.length - 1]) { e.preventDefault(); list[0].focus(); }
  });
  // A repaint that removed the focused control (a step change, a seg pick) moves focus into the new step,
  // else to the primary button. Focus held anywhere else (the Discard prompt) is left alone.
  function keepFocus() {
    if (closed || !modal.isConnected) return;
    const active = doc.activeElement;
    if (active && active !== doc.body && active.isConnected) return;
    const next = actions.querySelector('.sa-next:not([disabled])');
    (focusables().find((n) => body.contains(n)) || next || focusables()[0] || card).focus();
  }

  const opener = doc.activeElement; let closed = false;
  function teardown(how) {
    if (closed) return; closed = true;
    timers.clearTimeout(S.pollT); timers.clearTimeout(S.cpT); timers.clearTimeout(S.passT);
    guard.release(); modal.remove();
    if (opener?.isConnected) opener.focus?.();
    onClose(how);
  }
  const guard = guardModal(modal, { kind: 'form', close: () => teardown('later'),
    // Apply (and a login Retry after it) is past the point of discarding: its writes are done (architect-1-2).
    isDirty: () => S.step !== 'apply' && !S.retryLogin && !!S.answers && !!S.opened && JSON.stringify(S.answers) !== S.opened });

  const idx = () => SETUP_STEPS.findIndex((s) => s.id === S.step);
  function goTo(id) { S.step = SETUP_STEPS.some((s) => s.id === id) ? id : 'check'; S.error = ''; S.errField = null; paint(); }
  // A second openSetup while the dialog is up (A5): the same entry fix as initialAnswers, never mid-apply (architect-2-2).
  function focusStep(id) {
    if (closed || S.step === 'apply' || S.applying || S.retryLogin) return;
    if (id === 'access' && S.answers) S.answers.access.copilot = true;
    goTo(id);
  }
  function paint() { paintHead(); paintBody(); paintFoot(); keepFocus(); }
  function paintHead() {
    stepOf.textContent = `Step ${idx() + 1} of ${SETUP_STEPS.length}`;
    const pick = (v) => (typeof v === 'string' ? v : v[entry === 'first' ? 'first' : 'other']);
    title.textContent = S.step === 'apply' ? (S.done ? (S.done.ok ? 'Worca is ready' : 'Setup stopped') : 'Setting up Worca…') : TITLES[S.step];
    sub.textContent = pick(SUBTITLES[S.step]);
  }

  // ── small builders ──
  const rows = (cls, ...items) => { const u = el('ul', `sa-rows ${cls}`); u.append(...items); return u; };
  const badge = (tone, text) => el('span', `badge ${tone}`, text);
  function row(mark, label, line) {
    const li = el('li', 'sa-row'); const main = el('div', 'sa-row-main');
    main.append(el('div', null, label));
    if (line) main.append(el('div', 'sa-row-line', line));
    li.append(...(mark ? [mark] : []), main);
    return li;
  }
  /** `.field > label + control`, the input tagged with its apply field (markField). */
  function field(label, control, saField, input = control) {
    const f = el('div', 'field'); const l = el('label', null, label);
    if (saField) input.dataset.saField = saField;
    f.append(l, control);
    return f;
  }
  function textInput(type, value, onValue, attrs = {}) {
    const i = el('input', 'input'); i.type = type; i.value = value ?? '';
    for (const [k, v] of Object.entries(attrs)) i.setAttribute(k, v);
    i.addEventListener('input', () => { onValue(i.value); paintFoot(); });
    return i;
  }
  function seg(options, value, onPick, { label = '', disabled = false } = {}) {
    const g = el('div', 'seg'); g.setAttribute('role', 'group'); if (label) g.setAttribute('aria-label', label);
    for (const [v, t] of options) {
      const b = btn(t, null, () => { if (v !== value) onPick(v); });
      b.dataset.value = v; b.setAttribute('aria-pressed', String(v === value)); b.disabled = disabled;
      g.append(b);
    }
    return g;
  }
  function sw(label, checked, onValue, inputClass = '') {
    const { row: r, input } = makeSwitch(doc, { label, checked, inputClass });
    input.addEventListener('change', () => onValue(input.checked));
    return r;
  }
  function brokerNote(text) {
    const p = el('p', 'sa-broker', text);
    const href = safeHttpUrl(S.saved.providers?.broker?.keyPage);
    if (href) {
      const a = el('a', 'link', 'Open the key page'); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
      p.append(' ', a);
    }
    return p;
  }

  // ── step painters ──
  function paintBody() {
    body.replaceChildren();
    if (S.loadError) {
      const list = rows('sa-load');
      const li = row(badge('red', S.loadError), '');
      li.append(btn('Try again', 'btn btn-sm sa-reload', () => { void load(); }));
      list.append(li); body.append(list);
      return;
    }
    if (!S.answers) { const list = rows('sa-load'); list.append(row(el('span', 'mk-phase-spin'), 'Loading your setup…')); body.append(list); return; }
    ({ check: paintCheck, network: paintNetwork, access: paintAccess, models: paintModels, work: paintWork, review: paintReview, apply: paintApply })[S.step]();
    markField(S.errField);
    keepFocus();
  }
  function markField(field) {
    if (!field) return;
    // Compare the dataset instead of building a selector: jsdom has no CSS escape helper (security-2-4).
    const input = [...body.querySelectorAll('[data-sa-field]')].find((n) => n.dataset.saField === field);
    if (input) { input.setAttribute('aria-invalid', 'true'); input.focus?.(); }
  }

  function paintCheck() {
    const list = rows('sa-check');
    if (!S.detect) list.append(row(badge('amber', 'Couldn\'t check this machine.'), 'Worca continues without it.'));
    else for (const c of S.detect.checks || []) { const [tone, text] = CHECK_BADGE[c.state] || CHECK_BADGE.no; list.append(row(badge(tone, text), c.label, c.line)); }
    body.append(list);
  }

  function paintNetwork() {
    const n = S.answers.network; const locked = !!S.retryLogin;
    // Any edit to a value the test sent drops the pass, so changing it back still needs a new test.
    const untest = (set) => (v) => { S.tested = null; timers.clearTimeout(S.passT); set(v); };
    body.append(seg([['direct', 'Direct'], ['proxy', 'Through a corporate proxy']], n.mode, untest((v) => { n.mode = v; paint(); }), { label: 'Connection', disabled: locked }));
    if (n.mode !== 'proxy') return;
    const test = btn('Test', 'btn btn-sm sa-test', () => { void testProxy(); });
    test.disabled = S.testing;
    if (S.answers.found.proxy && !S.expanded && !locked) {
      const list = rows('sa-found');
      const li = row(null, `Found in your environment: ${S.answers.found.proxy}`);
      li.append(btn('Change', 'btn btn-sm btn-quiet sa-change', () => { S.expanded = true; paintBody(); }));
      list.append(li); body.append(list, test);
    } else {
      const host = textInput('text', n.host, untest((v) => { n.host = v; }), { placeholder: 'proxy.acme.example', autocomplete: 'off', spellcheck: 'false' });
      const port = textInput('number', n.port, untest((v) => { n.port = v; }), { placeholder: '8080', min: '1', max: '65535', 'aria-label': 'Port' });
      host.dataset.saField = 'network.networkProxy'; port.dataset.saField = 'network.networkProxy.port';
      const pair = el('div', 'sa-pair'); pair.append(host, port);
      const authWrap = el('div', 'select-wrap'); const auth = el('select', 'select'); auth.dataset.saField = 'network.networkProxy.auth';
      for (const [v, t] of AUTH_OPTIONS) { const o = el('option', null, t); o.value = v; auth.append(o); }
      auth.value = n.auth; authWrap.append(auth);
      auth.addEventListener('change', () => untest((v) => { n.auth = v; paint(); })(auth.value));
      const noProxy = textInput('text', n.noProxy, untest((v) => { n.noProxy = v; }), { placeholder: 'intranet.acme.example, .corp.acme.example', spellcheck: 'false' });
      for (const i of [host, port, auth, noProxy]) i.disabled = locked;
      body.append(field('Proxy', pair, null), field('Login', authWrap, null));
      if (n.auth === 'auto') {
        const domain = textInput('text', n.domain, (v) => { n.domain = v; }, { placeholder: 'ACME', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Domain' });
        const user = textInput('text', n.user, (v) => { n.user = v; }, { placeholder: 'jdoe', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'User name' });
        domain.dataset.saField = 'network.login.domain'; user.dataset.saField = 'network.login.user';
        const account = el('div', 'sa-pair'); account.append(domain, user);
        const pw = textInput('password', n.password, (v) => { n.password = v; }, { autocomplete: 'off',
          ...(S.saved.proxy?.login && !locked ? { placeholder: 'Saved login in use · type to replace' } : {}) });
        body.append(field('Account', account, null), field('Password', pw, 'network.login.password'));
      }
      body.append(field('Go direct to', noProxy, 'network.networkProxy.noProxy'));
      if (!locked) {
        body.append(btn('More: timeouts and local proxy port', 'link sa-more', () => { S.more = !S.more; paintBody(); }));
        if (S.more) {
          const fixed = textInput('number', n.fixedPort, untest((v) => { n.fixedPort = v.trim(); }), { min: '1024', max: '65535', placeholder: 'any free port' });
          const f = field('Local proxy port', fixed, 'network.networkProxy.fixedPort'); f.append(el('small', 'hint', FIXED_PORT_NOTE));
          body.append(f);
          for (const [k, label] of TIMEOUTS) {
            const v = n.timeouts?.[k];
            body.append(field(label, textInput('number', v ? String(v / 1000) : '', untest((s) => {
              const t = { ...(n.timeouts || {}) };
              if (s.trim()) t[k] = Math.round(Number(s) * 1000); else delete t[k];
              n.timeouts = t;
            }), { min: '1', max: '3600' }), `network.networkProxy.timeouts.${k}`));
          }
        }
        body.append(test);
      }
    }
    if (S.testing) { const list = rows('sa-testing'); list.append(row(el('span', 'mk-phase-spin'), 'Testing…')); body.append(list); }
    else if (S.testResults.length && !locked) { const list = el('ul', 'np-results sa-results'); renderResults(list, S.testResults); body.append(list); }
  }

  function paintAccess() {
    const a = S.answers.access; const broker = !!S.saved.providers?.broker?.enabled; const pv = S.saved.providers || {};
    const toggle = (name) => (on) => { a[name] = on; paint(); };
    if (S.answers.found.claude) body.append(rows('sa-claude', row(badge('green', 'OK'), 'Claude Code is signed in')));
    else {
      body.append(sw('Claude Code sign-in', a.claude, toggle('claude'), 'sa-src-claude'));
      const claude = (S.detect?.checks || []).find((c) => c.id === 'claude');
      if (a.claude && claude && claude.state !== 'ok') {
        const list = rows('sa-claude'); const li = row(badge('amber', 'Check'), 'Run claude, then /login, in a terminal');
        li.append(btn('Check again', 'btn btn-sm sa-recheck', () => { void recheck(); }));
        list.append(li); body.append(list);
      }
    }
    body.append(sw('GitHub Copilot', a.copilot, toggle('copilot'), 'sa-src-copilot'));
    if (a.copilot) {
      const box = el('div', 'sa-step sa-copilot');
      if (broker) box.append(brokerNote('Copilot sign-in is kept by the credential broker.'));
      else {
        for (const para of COPILOT_TERMS.body.split('\n\n')) box.append(el('p', 'sa-sub', para));
        box.append(sw(COPILOT_TERMS.checkbox, a.copilotAck, (on) => { a.copilotAck = on; paint(); }, 'sa-cp-ack'));
        box.append(field('Plan', seg(COPILOT_PLANS, a.copilotAccount, (v) => { a.copilotAccount = v; paint(); }, { label: 'Plan' }), null));
        if (a.copilotConnected) box.append(rows('sa-cp', row(badge('green', 'OK'), `Connected as @${a.copilotLogin || 'github'}`)));
        else {
          const go = btn('Sign in with GitHub', 'btn btn-sm sa-cp-signin', () => { void copilotSignIn(); });
          go.disabled = !a.copilotAck || !!S.cpFlow; box.append(go);
          if (S.cpFlow) {
            const flow = renderCopilotSignIn(S.cpFlow, { doc });
            flow.querySelector('.mv-cp-cancel')?.addEventListener('click', () => { S.cpFlow = null; timers.clearTimeout(S.cpT); paint(); });
            box.append(flow);
          }
        }
      }
      body.append(box);
    }
    for (const [name, label] of [['openai', 'OpenAI-compatible'], ['anthropic', 'Anthropic-compatible']]) {
      body.append(sw(label, a[name], toggle(name), `sa-src-${name}`));
      if (!a[name]) continue;
      const box = el('div', 'sa-step');
      box.append(field('Address', textInput('url', a[`${name}Url`], (v) => { a[`${name}Url`] = v; }, { placeholder: 'https://llm.acme.example/v1', spellcheck: 'false' }), `access.${name}.baseUrl`));
      if (broker) box.append(brokerNote('Keys are kept by the credential broker.'));
      else {
        const key = textInput('password', a[`${name}Key`], (v) => { a[`${name}Key`] = v; },
          { autocomplete: 'off', placeholder: pv[name]?.keyMasked || 'API key, or ${VAR}' });
        key.classList.add('sa-key');
        box.append(field('API key', key, `access.${name}.apiKey`));
      }
      body.append(box);
    }
  }

  function paintModels() {
    const host = el('div', 'sa-roles');
    const pending = S.copilotModels.filter((m) => !m.inCatalog);
    const catalog = [...S.saved.catalog, ...pending.map((m) => ({ id: m.catalogId, label: `${m.name || m.id} · Copilot` }))];
    body.append(host);
    renderRolesSection(host, { roles: S.answers.models.modelRoles, catalog, engine: S.answers.work.runEngine || 'claude', onChange: (next) => {
      // A click that changes nothing (the harness switch) keeps the answers as they were.
      if (!Object.keys(rolePatch(S.answers.models.modelRoles, next)).length) return;
      S.answers.models.modelRoles = next;
      const picked = new Set(Object.values(next).flatMap((h) => Object.values(h || {}).map((v) => v?.model)).filter(Boolean));
      S.answers.access.importModels = pending.filter((m) => picked.has(m.catalogId)).map((m) => m.catalogId.replace(/^copilot-/, ''));
      paintFoot();
    } });
    body.append(sw('Test each model after Apply', S.answers.models.testRoles, (on) => { S.answers.models.testRoles = on; paintFoot(); }, 'sa-test-roles'));
  }

  function paintWork() {
    const w = S.answers.work;
    const shown = w.uiLevel || doc.documentElement.dataset.level || 'simple';
    body.append(field('Interface', seg(UI_LEVELS.map((l) => [l, LEVEL_INFO[l].label]), shown, (v) => { w.uiLevel = v; paint(); }, { label: 'Interface' }), null));
    const money = (k, label) => {
      const i = textInput('number', w[k] == null ? '' : String(w[k]), (v) => { w[k] = v.trim() === '' ? null : Number(v); }, { min: '0', step: '0.01', placeholder: '$' });
      return field(label, i, `work.${k}`);
    };
    const limits = el('div', 'sa-pair'); limits.append(money('pipelineCostLimitUsd', 'Per-run limit ($)'), money('totalCostLimitUsd', 'Total limit ($)'));
    body.append(limits);
    body.append(field('Reset', seg([['weekly', 'Weekly'], ['monthly', 'Monthly']], w.costLimitResetPeriod || 'monthly', (v) => { w.costLimitResetPeriod = v; paint(); }, { label: 'Reset' }), null));
    body.append(sw('AI-written PR descriptions', w.autoGeneratePrDescription !== false, (on) => { w.autoGeneratePrDescription = on; paintFoot(); }, 'sa-pr-desc'));
    const naming = w.smartNaming || {};
    body.append(sw('Smart run names', naming.suggestTitle !== false && naming.suggestBranch !== false,
      (on) => { w.smartNaming = { ...naming, suggestTitle: on, suggestBranch: on }; paintFoot(); }, 'sa-smart-naming'));
  }

  function paintReview() {
    const list = rows('sa-review');
    for (const r of diffRows(S.saved, S.answers)) {
      if (entry !== 'first' && !r.changed) continue;
      const li = row(null, r.label, r.value); li.dataset.group = r.group;
      if (r.changed) li.append(badge('amber', 'Changed'));
      li.append(btn('Change', 'btn btn-sm btn-quiet sa-change', () => goTo(r.step)));
      list.append(li);
    }
    body.append(list);
  }

  function paintApply() {
    const list = rows('sa-apply');
    paintApplyRows(doc, list, S.results, !!S.done);
    body.append(list);
  }

  function paintFoot() {
    actions.replaceChildren();
    const first = idx() === 0;
    if (S.step === 'apply') {
      if (S.done?.ok) actions.append(btn('Continue', 'btn btn-primary sa-continue', () => teardown('done')));
      else if (S.done) {
        actions.append(btn('Close', 'btn sa-close', () => teardown('later')));
        actions.append(S.done.retry ? btn('Retry', 'btn btn-primary sa-retry', () => retry(S.done.retry))
          : btn('Back to review', 'btn btn-primary sa-back-review', () => goTo('review')));
      }
      status.className = `hint sa-status${S.error ? ' err' : ''}`; status.textContent = S.error || (S.done ? '' : 'Working…');
      return;
    }
    if (S.applying) { status.className = 'hint sa-status'; status.textContent = 'Working…'; return; }
    if (S.retryLogin && S.step === 'network') {           // A24: Network in re-type mode
      const pw = String(S.answers.network.password || '').trim();
      actions.append(btn('Back', 'btn sa-back', () => { S.retryLogin = null; S.answers.network.password = ''; goTo('apply'); }));
      const again = btn('Retry', 'btn btn-primary sa-next', () => startApply(S.retryLogin, { login: true }));
      again.disabled = !pw; actions.append(again);
      status.className = `hint sa-status${S.error ? ' err' : ''}`; status.textContent = S.error || 'Type the proxy password again to retry';
      return;
    }
    actions.append(first ? btn(entry === 'first' ? 'Set up later' : 'Cancel', 'btn btn-quiet sa-later', () => guard.cancel())
      : btn('Back', 'btn sa-back', () => goTo(SETUP_STEPS[idx() - 1].id)));
    if (S.answers && idx() >= 1 && idx() <= 4) actions.append(btn('Skip', 'btn btn-quiet sa-skip', () => skip()));
    const gate = S.answers ? nextGate(S.step, S.answers, { saved: S.saved, tested: S.tested, now: now(), detect: S.detect, entry }) : { ok: false, reason: '' };
    const label = S.step === 'check' ? 'Start' : S.step === 'review' ? (gate.finish ? 'Finish' : entry === 'first' ? 'Apply setup' : 'Apply changes') : 'Next';
    const onNext = () => (S.step !== 'review' ? goTo(SETUP_STEPS[idx() + 1].id) : gate.finish ? teardown('done') : startApply(null));
    const next = btn(label, 'btn btn-primary sa-next', onNext);
    next.disabled = !gate.ok || S.testing; actions.append(next);
    status.className = `hint sa-status${S.error ? ' err' : ''}`; status.textContent = S.error || gate.reason;
  }

  // Skip keeps the saved values for that step (mockup: "Skipping a step keeps its saved values").
  function skip() {
    const saved = initialAnswers({ saved: S.saved, entry: 'rerun' });
    const group = GROUP_STEP[S.step];
    if (group) S.answers[group] = saved[group];
    // Picked Copilot models live in access.importModels, so skipping either step drops them (qa-2-2).
    if (group === 'access' || group === 'models') S.answers.access.importModels = [];
    goTo(SETUP_STEPS[idx() + 1].id);
  }

  // keepAnswers: a 409 SETTINGS_CHANGED reloads what is saved and keeps what the person typed (A20).
  async function load({ keepAnswers = false } = {}) {
    S.loadError = ''; if (!keepAnswers) S.error = ''; paint();   // a successful Try again leaves no stale error (ux-2-1)
    const [settings, proxy, providers, cfg, detect] = await Promise.all(['/api/settings', '/api/proxy/status', '/api/providers', '/api/config', '/api/setup/detect'].map((u) => call(u)));
    if (closed) return;
    const bad = [settings, proxy, providers].find((r) => !r.ok);
    if (bad) { S.loadError = "Couldn't load your settings."; S.error = `${S.loadError} ${bad.data?.error || `HTTP ${bad.status}`}`; paint(); return; }
    S.saved = { settings: settings.data, proxy: proxy.data, providers: providers.data, catalog: Array.isArray(cfg.data?.models) ? cfg.data.models : [] };
    S.detect = detect.ok ? detect.data : null;
    if (!keepAnswers || !S.answers) {
      S.answers = initialAnswers({ saved: S.saved, detect: S.detect, entry, step });
      S.opened = JSON.stringify(S.answers);
    }
    paint();
    guard.markClean();
  }

  // Model access › Claude › Check again: detect once more, past its cache.
  async function recheck() {
    const r = await call('/api/setup/detect?recheck=1');
    if (closed) return;
    if (r.ok) S.detect = r.data;
    paint();
  }

  // Network › Test: POST /api/proxy/test with the values on screen; a pass records { key, at } (A11).
  async function testProxy() {
    const n = S.answers.network; const key = proxyKey(n);
    S.testing = true; S.tested = null; S.error = ''; paint();
    const r = await call('/api/proxy/test', { method: 'POST', body: { networkProxy: networkPatch(n) } });
    if (closed) return;
    S.testing = false;
    S.testResults = r.ok ? (r.data.results || []) : [];
    if (r.ok && r.data.ok && proxyKey(S.answers.network) === key) {
      S.tested = { key, at: now() };
      // The pass ends on screen too: repaint the foot when it expires (ux-2-4).
      timers.clearTimeout(S.passT); S.passT = timers.setTimeout(() => { if (!closed) paintFoot(); }, TEST_PASS_MS);
    } else S.expanded = true;                            // a failed test opens the collapsed "Found" row (ux-2-4)
    S.error = r.ok ? (r.data.ok ? '' : 'The test did not pass. Check the values and test again.') : (r.data.error || 'The test could not run');
    paint();
  }

  // Model access › Copilot: acknowledge, start the device flow, poll on the injected timers (A12).
  async function copilotSignIn() {
    const a = S.answers.access;
    if (!a.copilotAck || S.saved.providers?.broker?.enabled) return;
    const ack = await call('/api/providers/copilot/acknowledge', { method: 'POST', body: {} });
    if (closed) return;
    if (!ack.ok) { S.error = ack.data.error || 'Could not accept the notice'; paint(); return; }
    const start = await call('/api/providers/copilot/login', { method: 'POST', body: {} });
    if (closed) return;
    if (!start.ok) { S.error = start.data.error || 'Sign-in did not start'; paint(); return; }
    S.cpFlow = { ...start.data, status: 'Waiting for approval on github.com…' }; paint();
    const poll = async () => {
      if (closed || !S.cpFlow) return;
      const r = await call(`/api/providers/copilot/login/${encodeURIComponent(S.cpFlow.deviceCode)}`, { method: 'POST', body: {} });
      if (closed || !S.cpFlow) return;
      if (r.data?.ok) {
        a.copilotConnected = true; a.copilotLogin = r.data.login || ''; S.cpFlow = null;
        const list = await call('/api/providers/copilot/models');
        if (closed) return;
        S.copilotModels = list.ok && Array.isArray(list.data?.models) ? list.data.models : [];
        paint(); return;
      }
      if (r.status === 0) { S.cpT = timers.setTimeout(poll, Math.max(3, S.cpFlow.interval || 5) * 1000); return; }   // unreachable for a moment (ux-2-5)
      if (r.data?.error || !r.ok) { S.cpFlow = { ...S.cpFlow, error: r.data?.error || `HTTP ${r.status}` }; paint(); return; }
      S.cpT = timers.setTimeout(poll, Math.max(3, Number(r.data?.interval) || S.cpFlow.interval || 5) * 1000);
    };
    S.cpT = timers.setTimeout(poll, Math.max(3, Number(S.cpFlow.interval) || 5) * 1000);
  }

  /**
   * After a 202, drop every secret from the answers and the Retry body (A21). Keys are stored in the settings
   * commit; the password is saved only by the proxy-login step, so a retry at or before it re-types it (A24).
   */
  function scrubSecrets() {
    S.answers.network.password = ''; S.answers.access.openaiKey = ''; S.answers.access.anthropicKey = '';
    if (S.body?.network) { delete S.body.network.login; if (!Object.keys(S.body.network).length) delete S.body.network; }
    for (const name of ['openai', 'anthropic']) {
      const p = S.body?.access?.[name];
      if (p) { delete p.apiKey; if (!Object.keys(p).length) delete S.body.access[name]; }
    }
    if (S.body?.access && !Object.keys(S.body.access).length) delete S.body.access;
  }

  // Retry (A20, A24): a login retry first asks for the password again; any other step posts the kept body.
  function retry(fromStep) {
    if (S.hadLogin && LOGIN_RETRY_STEPS.includes(fromStep)) {
      S.retryLogin = fromStep; S.answers.network.password = ''; S.expanded = true; goTo('network'); return;
    }
    void startApply(fromStep);
  }

  // Apply (A19, A20). fromStep = a failed step's id on Retry; withLogin = a login retry from re-typed values.
  async function startApply(fromStep, { login: withLogin = false } = {}) {
    if (!fromStep) { S.body = buildApplyBody(S.saved, S.answers); S.hadLogin = !!S.body.network?.login; }
    let post = fromStep ? { ...S.body, fromStep } : S.body;
    if (withLogin) {
      const n = S.answers.network;
      post = { ...post, network: { ...(S.body.network || {}), login: { domain: n.domain.trim(), user: n.user.trim(), password: n.password } } };
    }
    // A fresh job: no old id or result, so the foot shows only "Working…" and early frames buffer (architect-2-1, qa-2-1).
    S.applying = true; S.job = null; S.done = null; S.early = []; S.error = ''; S.pollFails = 0; card.dataset.fbState = 'busy'; paintFoot();
    const r = await call('/api/setup/apply', { method: 'POST', body: post });
    post = null;
    if (closed) return;
    S.applying = false;
    if (r.status === 202) { S.retryLogin = null; scrubSecrets(); return attach(r.data.id, r.data.steps || []); }
    if (r.status === 409 && r.data.code === 'SETUP_RUNNING') { S.retryLogin = null; return attach(r.data.id, [], { pollNow: true }); }
    delete card.dataset.fbState; S.early = [];
    if (r.status === 400) {
      if (r.data.code === 'UNTESTED') S.tested = null;
      goTo(stepOfField(r.data.field));                  // goTo clears S.error, so the error is set after it
      S.error = r.data.error || 'Check this value.'; S.errField = r.data.field || null;
      paintFoot(); markField(S.errField); return;
    }
    if (r.status === 409 && r.data.code === 'SETTINGS_CHANGED') {
      S.retryLogin = null; await load({ keepAnswers: true }); goTo('review');
      S.error = r.data.error || 'Your settings changed elsewhere. Check the rows again.'; paintFoot(); return;
    }
    S.error = r.data.error || `HTTP ${r.status}`; paintFoot();
  }
  function attach(id, steps, { pollNow = false } = {}) {
    S.job = id; S.done = null; S.results = new Map(steps.map((s) => [s.id, { ...s, state: 'pending' }]));
    goTo('apply');
    const early = S.early; S.early = [];
    for (const m of early) onFrame(m);                  // frames that beat the 202 (qa-1-2); other ids are dropped
    if (!S.done) schedulePoll(pollNow ? 0 : 2000);       // a 409 SETUP_RUNNING has no steps yet: poll at once (architect-2-3)
  }
  function paintResult(res) {
    if (!S.results.has(res.id)) S.results.set(res.id, res);
    else S.results.set(res.id, { ...S.results.get(res.id), ...res });
  }
  function finish(done) {
    S.done = { ok: done.ok === true, retry: done.retry || null }; delete card.dataset.fbState;
    timers.clearTimeout(S.pollT); paint();
  }
  function schedulePoll(ms = 2000) {
    timers.clearTimeout(S.pollT);
    S.pollT = timers.setTimeout(async () => {
      if (closed || S.done || !S.job) return;
      const job = S.job;
      const r = await call(`/api/setup/apply/${encodeURIComponent(job)}`);
      if (closed || S.done || S.job !== job) return;
      if (r.ok) { S.pollFails = 0; for (const res of r.data.results || []) paintResult(res); if (r.data.done) return finish(r.data); paintBody(); }
      // Five misses in a row (a restarted server forgets its jobs): end with Close and Back to review (ux-2-3).
      else if (++S.pollFails >= 5) { S.error = LOST; return finish({ ok: false, retry: null }); }
      schedulePoll();
    }, ms);
  }
  function onFrame(msg) {
    if (closed || !msg || msg.type !== 'setup-apply') return;
    if (!S.job) { if (S.applying && S.early.length < 200) S.early.push(msg); return; }
    if (msg.id !== S.job || S.done) return;
    if (msg.result) { paintResult(msg.result); paintBody(); }
    if (msg.done) finish(msg);
  }

  doc.body.append(modal);
  guard.opened();
  void load();
  return { onFrame, goTo: focusStep, close: () => teardown('later') };
}
