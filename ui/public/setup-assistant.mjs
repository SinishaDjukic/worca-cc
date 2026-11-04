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
import { fetchJson as defaultFetchJson, renderResults, PORT_EMPTY_NOTE, PORT_SWITCH_NOTE, AUTH_OPTIONS } from './settings-network-proxy.mjs';
import { LEVEL_INFO, UI_LEVELS } from './ui-level.mjs';
import { ROLE_LABELS, MODEL_ROLES } from '../../src/shared/model-roles.mjs';
import { UPSTREAM_TIMEOUTS } from '../../src/shared/proxy-timeouts.mjs';

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
const WORK_KEYS = Object.freeze(['uiLevel', 'pipelineCostLimitUsd', 'totalCostLimitUsd', 'costLimitResetPeriod', 'autoGeneratePrDescription', 'smartNaming', 'runEngine',
  'hideBuiltinModels', 'sync', 'networkWait']);
/** The Review line when a team's values already match what is saved (T17). */
export const TEAM_MATCHES_LINE = "Your setup already matches your team's recommendation.";
/** The Review line when the notice's policy home is no longer cached by the time the dialog loads (T17). */
export const TEAM_GONE_LINE = "Your team's setup is no longer available.";
/** The browser's record of the team setup hashes it has shown (T15): { [policy home]: hash }. */
export const TEAM_SEEN_KEY = 'worca-cc.teamSetupSeen';
/** The account-menu notice for the first home whose Setup hash this browser has not seen, or null (D15, AC-5.7). */
export function teamNotice(homes = [], seen = {}) {
  for (const h of Array.isArray(homes) ? homes : []) {
    if (!h?.home || !h.hash || !Array.isArray(h.keys) || !h.keys.length || seen?.[h.home] === h.hash) continue;
    return { home: h.home, hash: h.hash, label: seen?.[h.home] ? 'Your team updated the recommended setup' : 'Your team has a recommended setup' };
  }
  return null;
}
const UNREACHABLE = 'Worca could not be reached. Check that it is still running.';
/** Failed steps whose retry needs the proxy password again: the server saves it only in proxy-login (A24). */
export const LOGIN_RETRY_STEPS = Object.freeze(['proxy-swap', 'proxy-login']);

/** An http(s) URL as a string, or null: the only hrefs the broker link may carry (security-2-3). */
export function safeHttpUrl(v) {
  try { const u = new URL(String(v ?? '')); return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null; }
  catch { return null; }
}

/** The key a proxy test pass is recorded under: the values the test sent, the account included (A11). */
export function proxyKey(n) {
  const host = String(n.host || '').trim(); const auth = n.auth || 'auto';
  return JSON.stringify({ upstream: host ? `http://${host}:${String(n.port || '').trim() || '8080'}` : null, auth, noProxy: String(n.noProxy || '').trim() || null,
    account: auth === 'auto' ? `${String(n.domain || '').trim()}\\${String(n.user || '').trim()}` : null });
}
/** The login typed on Network, or null: it rides the Test and the network apply, never anything else. */
function typedLogin(n) {
  return n.mode === 'proxy' && n.auth === 'auto' && n.password ? { domain: n.domain.trim(), user: n.user.trim(), password: n.password } : null;
}
/** The one line the dialog shows once Next on Network saved it (the network group applies on Next). */
export function networkSavedLine(n) { return n.mode === 'proxy' ? 'The corporate proxy is saved and on.' : 'Direct connection saved.'; }

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
 * `team` = { values, keys, unmapped } from GET /api/setup/team: on 'first' it fills only blanks (D19: saved values
 * win); on 'team' it replaces the answers for the team's keys (T17). `null` on 'team': the home is gone.
 * `savedKeys` = the keys settings.json really holds (GET /api/setup/team): GET /api/settings fills in defaults, so
 * "blank" is "not saved", not "null" (webui-1). Without it, a null answer is blank. A team record (sync,
 * networkWait…) is merged over the saved one: the team names only the sub-keys it recommends (webui-3).
 */
export function initialAnswers({ saved, detect = null, entry = 'first', step = null, team = undefined, savedKeys = null }) {
  const a = answersFrom(saved, detect, entry, step);
  a.found.team = [];
  const roles = team?.values?.models?.modelRoles || {};
  for (const [harness, picks] of Object.entries(roles)) {
    for (const [role, pick] of Object.entries(picks || {})) {
      const blank = !a.models.modelRoles?.[harness]?.[role]?.model;
      if (entry === 'team' || (entry === 'first' && blank)) { ((a.models.modelRoles[harness] ||= {})[role]) = { ...pick }; a.found.team.push(`models.modelRoles.${harness}.${role}`); }
    }
  }
  for (const [k, v] of Object.entries(team?.values?.work || {})) {
    if (!WORK_KEYS.includes(k)) continue;
    const blank = Array.isArray(savedKeys) ? !savedKeys.includes(k) : a.work[k] == null;
    if (entry !== 'team' && !(entry === 'first' && blank)) continue;
    a.work[k] = isRecord(v) && isRecord(a.work[k]) ? { ...a.work[k], ...structuredClone(v) } : structuredClone(v);
    a.found.team.push(`work.${k}`);
  }
  a.found.unmapped = Array.isArray(team?.unmapped) ? team.unmapped : [];
  a.found.teamGone = entry === 'team' && team === null;   // the home vanished between the menu click and the load (ux-2-4)
  return a;
}
const isRecord = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
function answersFrom(saved, detect, entry, step) {
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
  const login = typedLogin(answers.network);
  if (login) (body.network ||= {}).login = login;
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
  // Whether the team filled a key of this group (the Team chip); network and access never: D12.
  const teamIn = (group) => (answers.found?.team || []).some((k) => k.startsWith(`${group}.`));
  return [
    { group: 'network', step: 'network', label: 'Network', changed: !!body.network, team: false,
      value: n.mode === 'proxy' ? `Corporate proxy · ${n.host}:${n.port || '8080'}` : 'Direct' },
    { group: 'access', step: 'access', label: 'Model access', changed: !!body.access, team: false, value: sources.join(', ') || 'None' },
    { group: 'models', step: 'models', label: 'Models', changed: !!body.models, team: teamIn('models'),
      value: MODEL_ROLES.map((r) => `${ROLE_LABELS[r]} · ${roles[r]?.model || 'each job’s own default'}`).join('; '),
      lines: MODEL_ROLES.map((r) => ({ role: ROLE_LABELS[r], model: roles[r]?.model || null })) },
    { group: 'work', step: 'work', label: 'How you work', changed: !!body.work, team: teamIn('work'),
      value: `${LEVEL_INFO[w.uiLevel || 'simple']?.label || 'Simple'} interface · per run ${money(w.pipelineCostLimitUsd)} · total ${money(w.totalCostLimitUsd)}` },
  ];
}

/**
 * Whether the primary button may run on `step`, and the status line when it may not (A11, R-ux-2).
 * `tested` = { key, at } of the last passing test, or null. A first start with nothing to apply returns
 * { ok: true, finish: true } on Review (A23); so does any entry once Next on Network saved it (`netSaved`).
 */
export function nextGate(step, answers, { saved, tested = null, now = Date.now(), detect = null, entry = 'first', netSaved = '' } = {}) {
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
    if (netSaved) return { ok: true, finish: true, reason: `${netSaved} Nothing else to change.` };
    if (entry === 'first') return { ok: true, finish: true, reason: 'Nothing to change: your current setup already works.' };
    // 'team' finishes like 'first' (T17): Finish closes with done, which marks the notice seen.
    if (entry === 'team') return { ok: true, finish: true, reason: answers.found?.teamGone ? TEAM_GONE_LINE : TEAM_MATCHES_LINE };
    return { ok: false, reason: 'Nothing changed.' };
  }
  return { ok: true, reason: '' };
}

/** The step that owns an apply 400's `field` ('work.pipelineCostLimitUsd' → 'work'); 'review' when unknown (A20). */
export function stepOfField(field) { return GROUP_STEP[String(field || '').split('.')[0]] || 'review'; }

/** A Models-page sign-in pill → the assistant step it opens, or null to keep the Providers page (A17). */
export function setupStepForSignIn(btn) { return btn?.dataset?.provider === 'copilot' ? 'access' : null; }

const SUBTITLES = Object.freeze({
  check: { first: 'Worca checks this machine, then asks only what it could not find.', other: 'Status of your local setup.' },
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
 * Open the assistant. entry 'first' | 'rerun' | 'fix' | 'team'; `step` opens on that step (a fix-it link); `team` is the
 * policy home a 'team' entry reviews (the account-menu notice).
 * onClose(how): 'later' (Set up later / Cancel / Close / Discard), 'done' (Continue after Apply, or Finish).
 * Returns { onFrame(msg), goTo(step), close() }; goTo is a no-op on Apply and switches Copilot on for 'access'.
 */
export function openSetupAssistant({ doc = globalThis.document, fetchJson = defaultFetchJson, entry = 'first', step = 'check', team: teamHome = null, onClose = () => {}, now = () => Date.now(),
  timers = { setTimeout: (f, ms) => doc.defaultView.setTimeout(f, ms), clearTimeout: (t) => doc.defaultView.clearTimeout(t) } } = {}) {
  const el = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const btn = (text, cls, on) => { const b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', on); return b; };
  // A rejected fetch becomes an answer, so no await can leave the dialog loading or busy (A18).
  const call = async (url, opts) => { try { return await fetchJson(url, opts); } catch { return { ok: false, status: 0, data: { error: UNREACHABLE } }; } };
  const S = { step, saved: null, detect: null, answers: null, opened: null, loadError: '', tested: null, testing: false, testResults: [],
    applying: false, early: [], job: null, results: new Map(), body: null, done: null, error: '', errField: null, pollT: null, pollFails: 0, passT: null,
    cpFlow: null, cpT: null, copilotModels: [], expanded: false, more: false, hadLogin: false, retryLogin: null, note: '', sharing: false, team: null,
    // Network applies on Next (a network-only apply): netJob while it runs; netRetry { fromStep, body, login } after
    // a failed step; netPending what a Retry would resend; netSaved the line once it is saved.
    netJob: false, netRetry: null, netPending: null, netSaved: '' };

  const stepOf = el('span', 'sa-step-of'); const title = el('h2', null); title.id = 'setup-title'; const sub = el('p', 'sa-sub');
  // One segment per step, above "Step N of 7". Decorative: the step line says the same to a screen reader.
  const progress = el('div', 'sa-progress'); progress.setAttribute('aria-hidden', 'true');
  for (const s of SETUP_STEPS) { const seg = el('span', 'sa-progress-seg'); seg.dataset.step = s.id; seg.title = s.label; progress.append(seg); }
  const head = el('div', 'card-head'); head.append(progress, stepOf, title, sub);
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
    // preventScroll: paintBody owns the body's scroll position (kept on a repaint, the top on a new step).
    (focusables().find((n) => body.contains(n)) || next || focusables()[0] || card).focus({ preventScroll: true });
  }

  const opener = doc.activeElement; let closed = false;
  function teardown(how) {
    if (closed) return; closed = true;
    timers.clearTimeout(S.pollT); timers.clearTimeout(S.cpT); timers.clearTimeout(S.passT);
    guard.release(); modal.remove();
    if (opener?.isConnected) opener.focus?.();
    onClose(how);
  }
  const guard = guardModal(modal, { kind: 'form', close: () => teardown('later'), busy: () => S.netJob,
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
    // A finished Apply fills the last segment too: nothing is left to do.
    const at = idx(); const finished = S.step === 'apply' && !!S.done?.ok;
    [...progress.children].forEach((seg, i) => { seg.dataset.state = i < at || finished ? 'done' : i === at ? 'current' : 'todo'; });
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
  /** A titled group inside a step: `.sa-section > h3 + hint? + children`; consecutive sections get a rule between them. */
  function section(title, hint, ...children) {
    const s = el('section', 'sa-section'); s.append(el('h3', 'sa-section-title', title));
    if (hint) s.append(el('p', 'hint sa-section-hint', hint));
    s.append(...children);
    return s;
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
  // A repaint within the same step (Test, a seg pick, More) keeps the scroll position and the focused control: it
  // rebuilds every node, which otherwise snaps the body to the top and lets keepFocus jump to the first control.
  // The control is found again by focusKey; one that comes back disabled (Test while it runs) is retried next paint.
  const focusKey = (n) => n?.dataset?.saField ? `field:${n.dataset.saField}`
    : n?.classList ? `${n.tagName}:${[...n.classList].filter((c) => c.startsWith('sa-')).join('.')}:${n.dataset.value || ''}` : null;
  function paintBody() {
    const scroller = body.parentElement; const same = S.paintedStep === S.step; S.paintedStep = S.step;
    const top = same && scroller ? scroller.scrollTop : 0;
    const active = doc.activeElement;
    // Focus keepFocus parked while the control was disabled is not a new choice: the pending refocus stays.
    if (!same) S.refocus = null; else if (active && body.contains(active) && active !== S.parked) S.refocus = focusKey(active);
    S.parked = null;
    paintStep();
    if (S.refocus) {
      const again = [...body.querySelectorAll('button, input, select, textarea, a[href]')].find((n) => focusKey(n) === S.refocus);
      if (again && !again.disabled) { again.focus({ preventScroll: true }); S.refocus = null; }
    }
    const before = doc.activeElement; keepFocus();
    if (S.refocus && doc.activeElement !== before) S.parked = doc.activeElement;
    if (scroller) scroller.scrollTop = top;
  }
  function paintStep() {
    body.replaceChildren();
    if (S.loadError) {
      const list = rows('sa-load');
      const li = row(badge('red', S.loadError), '');
      li.append(btn('Try again', 'btn btn-sm sa-reload', () => { void load(); }));
      list.append(li); body.append(list);
      return;
    }
    if (!S.answers) { const list = rows('sa-load'); list.append(row(el('span', 'mk-phase-spin'), 'Loading your setup…')); body.append(list); return; }
    if (S.netSaved && S.step !== 'check' && S.step !== 'apply') body.append(el('p', 'hint sa-net-saved', S.netSaved));
    ({ check: paintCheck, network: paintNetwork, access: paintAccess, models: paintModels, work: paintWork, review: paintReview, apply: paintApply })[S.step]();
    markField(S.errField);
  }
  function markField(field) {
    if (!field) return;
    // Compare the dataset instead of building a selector: jsdom has no CSS escape helper (security-2-4).
    const input = [...body.querySelectorAll('[data-sa-field]')].find((n) => n.dataset.saField === field);
    if (input) { input.setAttribute('aria-invalid', 'true'); input.focus?.(); }
  }

  // A team setup is optional, so its row shows only when there is one to report: the file (found, or refused with
  // the reason), else a team policy home that recommends one. Neither: no row, not a grey "No".
  function teamRow(c) {
    if (c.state !== 'no') return c;
    const homes = S.teamHomes || [];
    if (!homes.length) return null;
    return { ...c, state: 'ok', line: `Your team policy recommends a setup (${homes.map((x) => x.home).join(', ')}).` };
  }
  // One table, so badges, names and details line up; the engines check adds one sub-row per engine.
  function paintCheck() {
    if (!S.detect) { const list = rows('sa-check'); list.append(row(badge('amber', 'Couldn\'t check this machine.'), 'Worca continues without it.')); body.append(list); return; }
    const table = el('table', 'sa-check');
    const head = el('tr');
    for (const t of ['Status', 'Check', 'Details']) head.append(el('th', null, t));
    const thead = el('thead', 'sr-only'); thead.append(head);
    const tbody = el('tbody');
    const tr = (cls, mark, name, line) => {
      const r = el('tr', cls); const n = el('td', 'sa-check-name'); n.append(name);
      const m = el('td', 'sa-check-mark'); m.append(mark);
      r.append(m, n, el('td', 'sa-check-line', line || ''));
      return r;
    };
    for (const detected of S.detect.checks || []) {
      const c = detected.id === 'teamSetup' ? teamRow(detected) : detected;
      if (!c) continue;
      const [tone, text] = CHECK_BADGE[c.state] || CHECK_BADGE.no;
      const r = tr(null, badge(tone, text), c.label, c.line); r.dataset.check = c.id;
      if (c.id === 'teamSetup' && c.state === 'ok') r.querySelector('.sa-check-name').append(badge('team', 'Team'));
      tbody.append(r);
      if (c.id !== 'harnesses') continue;
      for (const e of c.facts?.engines || []) {
        const [t, x] = CHECK_BADGE[e.ready ? 'ok' : 'no'];
        const s = tr('sa-check-sub', badge(t, x), e.label, e.line); s.dataset.engine = e.name;
        tbody.append(s);
      }
    }
    table.append(thead, tbody);
    body.append(table);
  }

  function paintNetwork() {
    const n = S.answers.network; const locked = !!S.retryLogin || !!S.netRetry || S.netJob;
    // Any edit to a value the test sent drops the pass, so changing it back still needs a new test.
    const untest = (set) => (v) => { S.tested = null; timers.clearTimeout(S.passT); set(v); };
    body.append(seg([['direct', 'Direct'], ['proxy', 'Proxy']], n.mode, untest((v) => { n.mode = v; paint(); }), { label: 'Connection', disabled: locked }));
    if (n.mode !== 'proxy') return;
    const test = btn('Test', 'btn btn-sm sa-test', () => { void testProxy(); });
    test.disabled = S.testing;
    if (S.answers.found.proxy && !S.expanded && !locked) {
      const list = rows('sa-found');
      const li = row(null, `Found in your environment: ${S.answers.found.proxy}`);
      li.append(btn('Change', 'btn btn-sm btn-quiet sa-change', () => { S.expanded = true; paintBody(); }));
      list.append(li); body.append(list, test);
    } else {
      const host = textInput('text', n.host, untest((v) => { n.host = v; }), { placeholder: 'proxy.example.com', autocomplete: 'off', spellcheck: 'false' });
      const port = textInput('number', n.port, untest((v) => { n.port = v; }), { placeholder: '8080', min: '1', max: '65535', 'aria-label': 'Port' });
      host.dataset.saField = 'network.networkProxy'; port.dataset.saField = 'network.networkProxy.port';
      const pair = el('div', 'sa-pair'); pair.append(host, port);
      const authWrap = el('div', 'select-wrap'); const auth = el('select', 'select'); auth.dataset.saField = 'network.networkProxy.auth';
      for (const [v, t] of AUTH_OPTIONS) { const o = el('option', null, t); o.value = v; auth.append(o); }
      auth.value = n.auth; authWrap.append(auth);
      auth.addEventListener('change', () => untest((v) => { n.auth = v; paint(); })(auth.value));
      const noProxy = textInput('text', n.noProxy, untest((v) => { n.noProxy = v; }), { placeholder: 'intranet.example.com, .corp.example.com', spellcheck: 'false' });
      for (const i of [host, port, auth, noProxy]) i.disabled = locked;
      // Auto-detect: the proxy this machine's own settings pick (PAC, auto-discovery or manual, GET /api/proxy/detect).
      const detect = btn('Auto-detect', 'btn btn-sm sa-detect', () => { void autoDetect(); }); detect.disabled = locked || S.detecting;
      const detectRow = el('div', 'sa-detect-row'); detectRow.append(detect);
      if (S.detectLine) detectRow.append(el('small', 'hint sa-detect-line', S.detectLine));
      const proxyField = field('Proxy', pair, null); proxyField.append(detectRow);
      body.append(proxyField, field('Login', authWrap, null));
      if (n.auth === 'auto') {
        // The account rides the Test, so editing it (the password too) needs a new one.
        const domain = textInput('text', n.domain, untest((v) => { n.domain = v; }), { placeholder: 'domain', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Domain' });
        const user = textInput('text', n.user, untest((v) => { n.user = v; }), { placeholder: 'username', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'User name' });
        domain.dataset.saField = 'network.login.domain'; user.dataset.saField = 'network.login.user';
        const account = el('div', 'sa-pair'); account.append(domain, user);
        const pw = textInput('password', n.password, untest((v) => { n.password = v; }), { autocomplete: 'off',
          ...(S.saved.proxy?.login && !locked ? { placeholder: 'Saved login in use · type to replace' } : {}) });
        body.append(field('Account', account, null), field('Password', pw, 'network.login.password'));
      }
      body.append(field('No proxy hosts', noProxy, 'network.networkProxy.noProxy'));
      if (!locked) {
        body.append(btn('More: timeouts and local proxy port', 'link-btn sa-more', () => { S.more = !S.more; paintBody(); }));
        if (S.more) {
          const fixed = textInput('number', n.fixedPort, untest((v) => { n.fixedPort = v.trim(); }), { min: '1024', max: '65535', placeholder: 'Automatic' });
          const f = field('Local proxy port', fixed, 'network.networkProxy.fixedPort');
          // What empty means, always; with a proxy already running, also that a new port applies at once while the old
          // one keeps answering for the programs holding it until the next start (egress-policy.mjs listenAlso).
          f.append(el('small', 'hint', S.saved.proxy?.running ? `${PORT_EMPTY_NOTE} ${PORT_SWITCH_NOTE}` : PORT_EMPTY_NOTE));
          body.append(f);
          // Shown filled in with the default; saved only when it differs, so an untouched field never reads as a change.
          for (const [k, label] of TIMEOUTS) {
            const v = n.timeouts?.[k] || UPSTREAM_TIMEOUTS[k];
            body.append(field(label, textInput('number', String(v / 1000), untest((s) => {
              const t = { ...(n.timeouts || {}) }; const ms = Math.round(Number(s) * 1000);
              if (s.trim() && ms !== UPSTREAM_TIMEOUTS[k]) t[k] = ms; else delete t[k];
              n.timeouts = t;
            }), { min: '1', max: '3600' }), `network.networkProxy.timeouts.${k}`));
          }
        }
        // Reset to defaults: every value here that has a default (login mode, no proxy hosts, local port, timeouts).
        // The proxy address and the account have none, so they stay. Like any edit, it drops a passing test.
        const reset = btn('Reset to defaults', 'btn btn-sm btn-quiet sa-reset', untest(() => {
          Object.assign(n, { auth: 'auto', noProxy: '', fixedPort: '', timeouts: {} }); paintBody();
        }));
        const bar = el('div', 'sa-proxy-actions'); bar.append(test, reset);
        body.append(bar);
      }
    }
    if (S.testing) { const list = rows('sa-testing'); list.append(row(el('span', 'mk-phase-spin'), 'Testing…')); body.append(list); }
    else if (S.testResults.length && !locked) { const list = el('ul', 'np-results sa-results'); renderResults(list, S.testResults); body.append(list); }
    paintNetworkApply();
  }
  // The network-only apply's rows, inline on Network (Direct included): its progress, or the failed step's line.
  function paintNetworkApply() {
    if (!(S.netJob || S.netRetry) || !S.results.size) return;
    const list = rows('sa-apply sa-net-apply');
    paintApplyRows(doc, list, S.results, !S.netJob);
    body.append(list);
  }

  function paintAccess() {
    const a = S.answers.access; const broker = !!S.saved.providers?.broker?.enabled; const pv = S.saved.providers || {};
    const toggle = (name) => (on) => { a[name] = on; paint(); };
    const claude = (S.detect?.checks || []).find((c) => c.id === 'claude');
    if (!S.answers.found.claude) body.append(sw('Claude Code sign-in', a.claude, toggle('claude'), 'sa-src-claude'));
    if (S.answers.found.claude || (a.claude && claude?.state === 'ok')) {
      // Signed in: Worca cannot run Claude's own login (interactive, tied to the home folder), so "Sign in again"
      // opens the terminal steps and a Check again that reads the sign-in past its cache.
      const li = row(badge('green', 'OK'), 'Claude Code is signed in', S.claudeChecked || '');
      if (!S.claudeRelogin) li.append(btn('Sign in again', 'btn btn-sm btn-quiet sa-claude-relogin', () => { S.claudeRelogin = true; S.claudeChecked = ''; paint(); }));
      const list = rows('sa-claude', li);
      if (S.claudeRelogin) {
        const steps = row(null, 'In a terminal, run claude, then /logout and /login. Then check again here.');
        steps.append(btn('Check again', 'btn btn-sm sa-recheck', () => { void recheck({ relogin: true }); }),
          btn('Cancel', 'btn btn-sm btn-quiet sa-claude-relogin-cancel', () => { S.claudeRelogin = false; paint(); }));
        list.append(steps);
      }
      body.append(list);
    } else if (a.claude && claude && claude.state !== 'ok') {
      const list = rows('sa-claude'); const li = row(badge('amber', 'Check'), 'Run claude, then /login, in a terminal');
      li.append(btn('Check again', 'btn btn-sm sa-recheck', () => { void recheck(); }));
      list.append(li); body.append(list);
    }
    body.append(sw('GitHub Copilot', a.copilot, toggle('copilot'), 'sa-src-copilot'));
    if (a.copilot) {
      const box = el('div', 'sa-step sa-copilot');
      if (broker) box.append(brokerNote('Copilot sign-in is kept by the credential broker.'));
      else {
        for (const para of COPILOT_TERMS.body.split('\n\n')) box.append(el('p', 'sa-sub', para));
        box.append(sw(COPILOT_TERMS.checkbox, a.copilotAck, (on) => { a.copilotAck = on; paint(); }, 'sa-cp-ack'));
        box.append(field('Plan', seg(COPILOT_PLANS, a.copilotAccount, (v) => { a.copilotAccount = v; paint(); }, { label: 'Plan' }), null));
        if (a.copilotConnected) {
          // Use another account: sign out (the Providers page's endpoint), then the device sign-in starts here.
          const li = row(badge('green', 'OK'), `Connected as @${a.copilotLogin || 'github'}`);
          if (!S.cpSwitch) li.append(btn('Use another account', 'btn btn-sm btn-quiet sa-cp-switch', () => { S.cpSwitch = true; paint(); }));
          const list = rows('sa-cp', li);
          if (S.cpSwitch) {
            const ask = row(badge('amber', 'Check'), 'Sign out of GitHub Copilot?', 'Models bridged through Copilot stop working until you sign in again.');
            const go = btn('Sign out and sign in again', 'btn btn-sm sa-cp-switch-go', () => { void copilotSwitch(); }); go.disabled = !a.copilotAck;
            ask.append(go, btn('Cancel', 'btn btn-sm btn-quiet sa-cp-switch-cancel', () => { S.cpSwitch = false; paint(); }));
            list.append(ask);
          }
          box.append(list);
        }
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
        const keyField = field('API key', key, `access.${name}.apiKey`);
        if (pv[name]?.keyMasked) keyField.append(el('small', 'hint', 'A key is saved. Type a new one to replace it.'));
        box.append(keyField);
      }
      body.append(box);
    }
  }

  // The Team line above a step the team filled, and the roles no source here serves (T18).
  function paintTeamLine(text) {
    const line = el('p', 'hint sa-team-line'); line.append(badge('team', 'Team'), doc.createTextNode(` ${text}`)); body.append(line);
  }
  function paintUnmapped() {
    const un = S.answers.found.unmapped || [];
    if (!un.length) return;
    // "Your pick is kept." only when there is a pick to keep (ux-2-1).
    const kept = (u) => !!S.answers.models.modelRoles?.[u.harness || 'claude']?.[u.role]?.model;
    body.append(rows('sa-team-unmapped', ...un.map((u) => row(null, `${ROLE_LABELS[u.role] || u.role} · ${u.upstream}`, kept(u) ? `${u.line} Your pick is kept.` : u.line))));
  }

  // Copilot models Apply would import, shaped like the entry the import writes (copilot.mjs: upstream.provider
  // 'copilot', "<name> (Copilot)"), so the role pickers group them under GitHub Copilot, not the Claude sign-in.
  // Only the models GitHub's own picker shows (model_picker_enabled): the rest are older dated snapshots under the
  // same names. A name that still repeats carries its model id.
  function pendingCopilotModels(list) {
    const rows = (list || []).filter((m) => !m.inCatalog && m.pickerEnabled !== false);
    const seen = new Map(); for (const m of rows) { const n = m.name || m.id; seen.set(n, (seen.get(n) || 0) + 1); }
    return rows.map((m) => {
      const name = m.name || m.id;
      return { id: m.catalogId, label: seen.get(name) > 1 ? `${name} · ${m.id} (Copilot)` : `${name} (Copilot)`,
        upstream: { provider: 'copilot', api: m.api || null, model: m.id }, cost: { free: true } };
    });
  }
  // Copilot already connected when the dialog opened: its models are fetched once, on the first visit to Models
  // (a sign-in in the dialog fetches them itself). Until then the pickers show the catalog alone.
  async function loadCopilotModels() {
    S.copilotModelsAsked = true;
    const list = await call('/api/providers/copilot/models');
    if (closed) return;
    if (list.ok && Array.isArray(list.data?.models)) { S.copilotModels = list.data.models; if (S.step === 'models') paintBody(); }
  }
  function paintModels() {
    const a = S.answers.access;
    if (a.copilot && a.copilotConnected && !S.copilotModels.length && !S.copilotModelsAsked && !S.saved.providers?.broker?.enabled) void loadCopilotModels();
    if ((S.answers.found.team || []).some((k) => k.startsWith('models.'))) paintTeamLine('Your team recommends these roles.');
    paintUnmapped();
    const host = el('div', 'sa-roles');
    const pending = pendingCopilotModels(S.copilotModels);
    const catalog = [...S.saved.catalog, ...pending];
    body.append(host);
    renderRolesSection(host, { roles: S.answers.models.modelRoles, catalog, engine: S.answers.work.runEngine || 'claude', onChange: (next) => {
      // A click that changes nothing (the harness switch) keeps the answers as they were.
      if (!Object.keys(rolePatch(S.answers.models.modelRoles, next)).length) return;
      S.answers.models.modelRoles = next;
      const picked = new Set(Object.values(next).flatMap((h) => Object.values(h || {}).map((v) => v?.model)).filter(Boolean));
      S.answers.access.importModels = pending.filter((m) => picked.has(m.id)).map((m) => m.id.replace(/^copilot-/, ''));
      paintFoot();
    } });
  }

  function paintWork() {
    if ((S.answers.found.team || []).some((k) => k.startsWith('work.'))) paintTeamLine('Your team recommends some of these values.');
    const w = S.answers.work;
    // Three titled sections, a rule between them: what the interface shows, what runs may spend, what helpers write.
    const shown = w.uiLevel || doc.documentElement.dataset.level || 'simple';
    body.append(section('Interface', LEVEL_INFO[shown]?.who ? `${LEVEL_INFO[shown].who}.` : '',
      seg(UI_LEVELS.map((l) => [l, LEVEL_INFO[l].label]), shown, (v) => { w.uiLevel = v; paint(); }, { label: 'Interface' })));
    const money = (k, label) => {
      const i = textInput('number', w[k] == null ? '' : String(w[k]), (v) => { w[k] = v.trim() === '' ? null : Number(v); }, { min: '0', step: '0.01', placeholder: 'No limit' });
      return field(label, i, `work.${k}`);
    };
    const limits = el('div', 'sa-pair'); limits.append(money('pipelineCostLimitUsd', 'Per run ($)'), money('totalCostLimitUsd', 'Total ($)'));
    body.append(section('Spending limits', 'Leave a limit empty for none. The total counts every run until it resets.', limits,
      field('Total resets', seg([['weekly', 'Weekly'], ['monthly', 'Monthly']], w.costLimitResetPeriod || 'monthly', (v) => { w.costLimitResetPeriod = v; paint(); }, { label: 'Total resets' }), null)));
    const naming = w.smartNaming || {};
    body.append(section('AI helpers', 'Short model calls that save you typing. They use the Quick jobs model.',
      sw('AI-written PR descriptions', w.autoGeneratePrDescription !== false, (on) => { w.autoGeneratePrDescription = on; paintFoot(); }, 'sa-pr-desc'),
      sw('Smart run names', naming.suggestTitle !== false && naming.suggestBranch !== false,
        (on) => { w.smartNaming = { ...naming, suggestTitle: on, suggestBranch: on }; paintFoot(); }, 'sa-smart-naming')));
  }

  // A table like the Check step's: the group and its value stacked on the left, its badges and Change on the right,
  // top-aligned. Models gets one line per role, by the model's label (a Copilot model still to import included).
  function paintReview() {
    const list = el('table', 'sa-review'); const tbody = el('tbody'); list.append(tbody);
    const labelOf = (() => { const all = [...S.saved.catalog, ...pendingCopilotModels(S.copilotModels)]; return (id) => all.find((m) => m.id === id)?.label || id; })();
    for (const r of diffRows(S.saved, S.answers)) {
      const netSaved = r.group === 'network' && !!S.netSaved && !r.changed;
      if (entry !== 'first' && !r.changed && !netSaved) continue;
      const tr = el('tr'); tr.dataset.group = r.group;
      const what = el('td', 'sa-review-what'); what.append(el('div', 'sa-review-name', r.label));
      if (r.lines) {
        const ul = el('ul', 'sa-review-lines');
        for (const l of r.lines) { const li = el('li'); li.append(el('span', 'sa-review-role', l.role), doc.createTextNode(l.model ? labelOf(l.model) : 'each job’s own default')); ul.append(li); }
        what.append(ul);
      } else what.append(el('div', 'sa-review-value', r.value));
      const marks = el('td', 'sa-review-marks');
      if (r.changed) marks.append(badge('amber', 'Changed'));
      if (netSaved) marks.append(badge('green', 'Saved'));
      if (r.team) marks.append(badge('team', 'Team'));
      const act = el('td', 'sa-review-act'); act.append(btn('Change', 'btn btn-sm btn-quiet sa-change', () => goTo(r.step)));
      tr.append(what, marks, act); tbody.append(tr);
    }
    body.append(list);
    // Next to the Apply button it governs: the role tests run on the Apply step, after the network, sign-ins and
    // imports are saved, so they test what will run. Only with changed roles: the body carries testRoles only then.
    if (diffRows(S.saved, S.answers).some((r) => r.group === 'models' && r.changed)) {
      body.append(sw('Test models after applying', S.answers.models.testRoles, (on) => { S.answers.models.testRoles = on; paintFoot(); }, 'sa-test-roles'));
    }
    if (entry === 'team' && !tbody.children.length) body.append(el('p', 'hint sa-review-empty', S.answers.found.teamGone ? TEAM_GONE_LINE : TEAM_MATCHES_LINE));
    paintUnmapped();
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
      if (S.done?.ok) {
        const share = btn('Share as team setup', 'btn btn-quiet sa-share', () => { void shareDraft(); });
        share.disabled = S.sharing;                              // one draft at a time (ux-1-5)
        actions.append(share);
        actions.append(btn('Continue', 'btn btn-primary sa-continue', () => teardown('done')));
      } else if (S.done) {
        actions.append(btn('Close', 'btn sa-close', () => teardown('later')));
        actions.append(S.done.retry ? btn('Retry', 'btn btn-primary sa-retry', () => retry(S.done.retry))
          : btn('Back to review', 'btn btn-primary sa-back-review', () => goTo('review')));
      }
      status.className = `hint sa-status${S.error ? ' err' : ''}`; status.textContent = S.error || S.note || (S.done ? '' : 'Working…');
      return;
    }
    if (S.applying || S.netJob) { status.className = 'hint sa-status'; status.textContent = 'Working…'; return; }
    if (S.netRetry && S.step === 'network') {             // a failed network apply: Retry from its step
      const needPw = S.netRetry.login && !String(S.answers.network.password || '').trim();
      actions.append(btn('Back', 'btn sa-back', () => goTo(SETUP_STEPS[idx() - 1].id)));
      actions.append(btn('Skip for now', 'btn btn-quiet sa-skip', () => { void skip(); }));
      const again = btn('Retry', 'btn btn-primary sa-next', () => applyNetwork(S.netRetry.body, S.netRetry));
      again.disabled = needPw; actions.append(again);
      status.className = `hint sa-status${S.error ? ' err' : ''}`; status.textContent = S.error || (needPw ? 'Type the proxy password again to retry' : '');
      return;
    }
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
    const gate = S.answers ? nextGate(S.step, S.answers, { saved: S.saved, tested: S.tested, now: now(), detect: S.detect, entry, netSaved: S.netSaved }) : { ok: false, reason: '' };
    const skipLabel = S.answers && idx() >= 1 && idx() <= 4 ? skipLabelFor(gate) : null;
    if (skipLabel) actions.append(btn(skipLabel, 'btn btn-quiet sa-skip', () => { void skip(); }));
    const label = S.step === 'check' ? 'Start' : S.step === 'review' ? (gate.finish ? 'Finish' : 'Apply') : 'Next';
    const onNext = () => (S.step === 'network' ? nextFromNetwork() : S.step !== 'review' ? goTo(SETUP_STEPS[idx() + 1].id) : gate.finish ? teardown('done') : startApply(null));
    const next = btn(label, 'btn btn-primary sa-next', onNext);
    next.disabled = !gate.ok || S.testing; actions.append(next);
    status.className = `hint sa-status${S.error ? ' err' : ''}`; status.textContent = S.error || gate.reason;
  }

  // D17: the saved settings as a team setup draft, downloaded. The server builds it (network and access never read).
  async function shareDraft() {
    if (S.sharing) return;
    S.sharing = true; S.error = ''; S.note = 'Preparing the team setup…'; paintFoot(); refocusShare();
    const r = await call('/api/setup/team/draft', { method: 'POST', body: {} });
    if (closed) return;
    S.sharing = false;
    if (!r.ok || typeof r.data?.text !== 'string') { S.note = ''; S.error = r.data?.error || "Couldn't prepare the team setup."; paintFoot(); refocusShare(); return; }
    const win = doc.defaultView;
    const url = win.URL.createObjectURL(new win.Blob([r.data.text], { type: 'application/json' }));
    const a = el('a'); a.href = url; a.download = 'team-setup.json'; doc.body.append(a); a.click(); a.remove();
    win.setTimeout(() => win.URL.revokeObjectURL(url), 1000);   // not 0: Firefox can cancel a download whose URL is revoked at once
    const left = (r.data.warnings || []).filter((w) => w.startsWith('models.roles.')).map((w) => {
      const [path, why] = w.split(': '); return `${ROLE_LABELS[path.split('.').at(-1)] || path} (${why.replace(/ — left out$/, '')})`;
    });
    S.note = `Saved team-setup.json. It has no network settings, model sources or keys.${left.length ? ` Left out: ${left.join(', ')}.` : ''}`;
    paintFoot();
    refocusShare();
  }
  // paintFoot() rebuilds the foot, so the focused Share button is replaced; put focus back on the new one (ux-2-2).
  // The status line is the dialog's small.hint.sa-status[role=status], so each note is announced.
  function refocusShare() { if (!closed) actions.querySelector('.sa-share')?.focus(); }

  // Skip keeps the saved values for that step (mockup: "Skipping a step keeps its saved values"). After a failed
  // network apply those are re-read first: its earlier steps may have saved some of them.
  // The second button on steps 2–5 shows only when it does something Next does not. Both labels run skip(), which
  // puts the step back to its saved values and moves on. Next blocked (an untested proxy, a missing sign-in):
  // "Skip for now". The step differs from what is saved (the Review step's Changed): "Discard changes". Else none.
  function skipLabelFor(gate) {
    if (!gate.ok) return 'Skip for now';
    return diffRows(S.saved, S.answers).some((r) => r.step === S.step && r.changed) ? 'Discard changes' : null;
  }
  async function skip() {
    if (S.netRetry && S.step === 'network') {
      S.netRetry = null; S.results = new Map(); S.answers.network.password = '';
      await load({ keepAnswers: true });
      if (closed) return;
    }
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
    const [settings, proxy, providers, cfg, detect, teamRes] = await Promise.all(['/api/settings', '/api/proxy/status', '/api/providers', '/api/config', '/api/setup/detect', '/api/setup/team'].map((u) => call(u)));
    if (closed) return;
    const bad = [settings, proxy, providers].find((r) => !r.ok);
    if (bad) { S.loadError = "Couldn't load your settings."; S.error = `${S.loadError} ${bad.data?.error || `HTTP ${bad.status}`}`; paint(); return; }
    S.saved = { settings: settings.data, proxy: proxy.data, providers: providers.data, catalog: Array.isArray(cfg.data?.models) ? cfg.data.models : [] };
    S.detect = detect.ok ? detect.data : null;
    // 'team': the home the notice named (null when it is gone); any other entry: a valid team setup file.
    const t = teamRes.ok ? teamRes.data : null;
    S.team = entry === 'team' ? (t?.homes || []).find((x) => x.home === teamHome) || null : (t?.file?.ok ? t.file : null);
    S.teamHomes = (t?.homes || []).filter((x) => x?.home && Array.isArray(x.keys) && x.keys.length);   // the Check step's Team setup row
    if (!keepAnswers || !S.answers) {
      S.answers = initialAnswers({ saved: S.saved, detect: S.detect, entry, step, team: S.team, savedKeys: Array.isArray(t?.savedKeys) ? t.savedKeys : null });
      S.opened = JSON.stringify(S.answers);
    }
    paint();
    guard.markClean();
  }

  // Model access › Claude › Check again: detect once more, past its cache. After "Sign in again", a signed-in answer
  // closes the steps and says it was checked; any other answer shows the usual Check row.
  async function recheck({ relogin = false } = {}) {
    const r = await call('/api/setup/detect?recheck=1');
    if (closed) return;
    if (r.ok) S.detect = r.data;
    const ok = (S.detect?.checks || []).find((c) => c.id === 'claude')?.state === 'ok';
    if (relogin) {
      S.claudeRelogin = !ok; S.claudeChecked = ok ? 'Checked again just now.' : '';
      if (!ok) { S.answers.found.claude = false; S.answers.access.claude = true; }   // shows the Check row with its steps
    }
    paint();
  }

  // Model access › Copilot › Use another account: sign out, then the device sign-in, as on a first connection.
  async function copilotSwitch() {
    const a = S.answers.access;
    const r = await call('/api/providers/copilot/logout', { method: 'POST', body: {} });
    if (closed) return;
    if (!r.ok) { S.error = r.data?.error || "Couldn't sign out of GitHub Copilot"; paint(); return; }
    S.cpSwitch = false; a.copilotConnected = false; a.copilotLogin = '';
    if (S.saved.providers?.copilot) S.saved.providers.copilot.connected = false;   // a Skip now keeps "signed out", the truth
    paint();
    await copilotSignIn();
  }

  // Network › Test: POST /api/proxy/test with the values on screen; a pass records { key, at } (A11).
  // Fills host and port (and, from a manual system setting, its usable bypass list); like any edit it needs a new Test.
  async function autoDetect() {
    const n = S.answers.network;
    S.detecting = true; S.detectLine = 'Looking at this machine\'s proxy settings…'; paint();
    const r = await call('/api/proxy/detect');
    if (closed) return;
    S.detecting = false;
    const d = r.ok ? r.data : null;
    if (d?.found) {
      S.tested = null; timers.clearTimeout(S.passT);
      n.host = d.host; n.port = String(d.port);
      if (Array.isArray(d.noProxy) && d.noProxy.length) n.noProxy = d.noProxy.join(', ');
    }
    S.detectLine = d?.line || "Couldn't read this machine's proxy settings.";
    paint();
  }

  async function testProxy() {
    const n = S.answers.network; const key = proxyKey(n);
    S.testing = true; S.tested = null; S.error = ''; paint();
    const login = typedLogin(n);
    const r = await call('/api/proxy/test', { method: 'POST', body: { networkProxy: networkPatch(n), ...(login ? { login } : {}) } });
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
        S.copilotModels = list.ok && Array.isArray(list.data?.models) ? list.data.models : []; S.copilotModelsAsked = true;
        paint(); return;
      }
      if (r.status === 0) { S.cpT = timers.setTimeout(poll, Math.max(3, S.cpFlow.interval || 5) * 1000); return; }   // unreachable for a moment (ux-2-5)
      if (r.data?.error || !r.ok) { S.cpFlow = { ...S.cpFlow, error: r.data?.error || `HTTP ${r.status}` }; paint(); return; }
      S.cpT = timers.setTimeout(poll, Math.max(3, Number(r.data?.interval) || S.cpFlow.interval || 5) * 1000);
    };
    S.cpT = timers.setTimeout(poll, Math.max(3, Number(S.cpFlow.interval) || 5) * 1000);
  }

  /**
   * Next on Network: the network group takes effect now, so steps 3 on (the Copilot sign-in) already go
   * through the proxy. Values that match what is saved post nothing (D19); otherwise a network-only apply
   * runs inline, and Model access opens only once it succeeded.
   */
  function nextFromNetwork() {
    const net = buildApplyBody(S.saved, S.answers).network;
    if (!net) { goTo(SETUP_STEPS[idx() + 1].id); return; }
    void applyNetwork({ network: net });
  }
  /** POST the network-only body (`retry` = a failed run's { fromStep, login }: the password is typed again). */
  async function applyNetwork(netBody, retry = null) {
    let post = retry ? { ...netBody, fromStep: retry.fromStep } : netBody;
    if (retry?.login) post = { ...post, network: { ...post.network, login: typedLogin(S.answers.network) } };
    S.applying = true; S.netJob = true; S.job = null; S.done = null; S.early = []; S.error = ''; S.errField = null; S.pollFails = 0;
    S.results = new Map(); card.dataset.fbState = 'busy'; paint();
    const r = await call('/api/setup/apply', { method: 'POST', body: post });
    const hadLogin = !!post.network?.login;
    post = null;
    if (closed) return;
    S.applying = false;
    if (r.status === 202) {
      // Scrubbed as scrubSecrets() does: the password was saved by proxy-login, or is typed again on Retry.
      S.answers.network.password = '';
      const kept = { network: { ...netBody.network } }; delete kept.network.login;
      S.netRetry = null; S.netPending = { body: kept, login: hadLogin };
      return attach(r.data.id, r.data.steps || []);
    }
    S.netJob = false; delete card.dataset.fbState; S.early = [];
    if (r.status === 400) {
      if (r.data.code === 'UNTESTED') S.tested = null;
      S.error = r.data.error || 'Check this value.'; S.errField = r.data.field || null;
      paint(); return;
    }
    if (r.status === 409 && r.data.code === 'SETTINGS_CHANGED') { await load({ keepAnswers: true }); if (closed) return; }
    S.error = r.data.error || `HTTP ${r.status}`; paint();
  }
  /** The network-only apply ended: reload what is saved, so the D19 diff (and the final Apply) has no network. */
  async function finishNetwork(done) {
    const failed = [...S.results.values()].find((x) => x.state === 'failed');
    const pending = S.netPending; S.netPending = null; S.job = null; S.done = null;
    if (done.ok) {
      S.results = new Map();
      await load({ keepAnswers: true });
      if (closed) return;
      S.netJob = false; S.netSaved = networkSavedLine(S.answers.network);
      goTo(SETUP_STEPS[idx() + 1].id);
      return;
    }
    // A failed step keeps its earlier writes (D20): Retry runs from it with the same body, as the final Apply's does.
    S.netJob = false;
    S.netRetry = done.retry ? { fromStep: done.retry, body: pending.body, login: pending.login && LOGIN_RETRY_STEPS.includes(done.retry) } : null;
    if (!S.netRetry) { S.results = new Map(); await load({ keepAnswers: true }); if (closed) return; }
    paint();
    S.error = failed?.line || S.error || 'The network settings were not applied.'; paintFoot();
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
    if (S.netJob) paint(); else goTo('apply');
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
    timers.clearTimeout(S.pollT);
    if (S.netJob) { void finishNetwork(S.done); return; }
    paint();
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
