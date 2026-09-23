// ui/public/bridge-view.mjs
// Pure DOM renderers for the model bridge (model-bridge-design.md §8): the
// Providers card, the Copilot sign-in block, the Import-from-Copilot sheet,
// the editor's Connection section, the terms notice text, and the card
// badges. Same contract as models-view.mjs: every function takes `doc` via
// opts and returns DETACHED elements; app.js owns endpoint calls, mounting
// and the delegated listeners. Interactive elements carry a routing class
// (mv-cp-*, mv-pv-*, mvi-*, mv-conn-*) plus data-provider / data-id.

function h(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/** Mirrors model-env.mjs PROVIDER_APIS — the server validates; this is the form. */
export const PROVIDER_APIS = { copilot: ['anthropic', 'openai-chat'], openai: ['openai-chat'], anthropic: ['anthropic'] };
export const PROVIDER_LABELS = { copilot: 'GitHub Copilot', openai: 'OpenAI-compatible', anthropic: 'Anthropic-compatible' };
export const API_LABELS = { anthropic: 'Anthropic Messages', 'openai-chat': 'OpenAI chat completions' };
export const CAPABILITY_FLAGS = [['toolCalls', 'Tool calls'], ['vision', 'Vision'], ['reasoning', 'Reasoning']];

/** The notice every Copilot sign-in must acknowledge (§8.2). One source of truth: the UI modal and the CLI print it. */
export const COPILOT_TERMS = Object.freeze({
  title: 'Using GitHub Copilot from Worca',
  body: [
    "Worca will talk to GitHub Copilot through the same API GitHub's editor extensions use, identifying itself as an editor client. GitHub's terms allow Copilot only through supported clients, and GitHub has suspended Copilot access for automated or unsupported use. Pipelines are automated, high-volume use.",
    '• Your GitHub account, not Worca, carries this risk.',
    '• Worca caps concurrent requests (configurable) and never signs in without you.',
    '• Premium-request quotas apply per your plan; Worca shows usage but cannot enforce it.',
  ].join('\n\n'),
  checkbox: 'I understand and want to continue',
  confirm: 'Continue',
});

/** One-line degradation copy for a translated (openai-chat) model, '' otherwise (§8.5). */
export function degradationLine(m) {
  if (!m || !m.upstream || m.upstream.api !== 'openai-chat') return '';
  const caps = m.upstream.capabilities || {};
  const limit = caps.maxPromptTokens ? `, prompt limit ~${Math.round(caps.maxPromptTokens / 1000)}k tokens` : '';
  return `translated — no thinking blocks, no WebSearch/WebFetch${limit}`;
}

/** The `bridged: <provider>` badge for a catalog card, or null. */
export function bridgedBadge(m, { doc = globalThis.document } = {}) {
  if (!m || !m.bridged) return null;
  const b = h(doc, 'span', 'badge blue mv-bridged', `bridged: ${m.bridged}`);
  b.title = `Worca's in-process bridge forwards this model's calls to ${PROVIDER_LABELS[m.bridged] || m.bridged}${m.upstream ? ` as ${m.upstream.model} (${API_LABELS[m.upstream.api] || m.upstream.api})` : ''}.`;
  return b;
}

/** The blocking "needs sign-in" pill + button for a card, or null (§8.5). */
export function needsSignInPill(m, { doc = globalThis.document } = {}) {
  if (!m || !m.needsSignIn) return null;
  const wrap = h(doc, 'span', 'mv-needs-signin');
  const b = h(doc, 'span', 'badge red mv-needs-signin-badge', m.signInReason === 'terms' ? 'needs acknowledgement' : m.signInReason === 'no_key' ? 'needs API key' : 'needs sign-in');
  b.title = m.signInMessage || 'The provider behind this model is not usable yet.';
  wrap.appendChild(b);
  const btn = h(doc, 'button', 'btn-ghost mv-signin', m.signInReason === 'no_key' ? 'Set key' : 'Sign in');
  btn.type = 'button';
  btn.dataset.provider = m.bridged || '';
  wrap.appendChild(btn);
  return wrap;
}

// ── Providers card (§8.1) ────────────────────────────────────────────────────

function providerStatePill(doc, c) {
  if (!c.termsCurrent) return h(doc, 'span', 'badge grey', 'sign-in blocked until acknowledged');
  if (!c.connected) return h(doc, 'span', 'badge grey', 'not connected');
  return h(doc, 'span', 'badge green', `connected${c.login ? ` as @${c.login}` : ''}`);
}

function quotaLine(q) {
  if (!q) return '';
  if (q.unlimited) return 'Premium requests: unlimited on this plan';
  if (q.used != null && q.entitlement != null) return `Premium requests used this month: ${q.used} / ${q.entitlement}${q.resetDate ? ` (resets ${q.resetDate})` : ''}`;
  if (q.remaining != null) return `Premium requests remaining this month: ${q.remaining}`;
  return '';
}

function numberField(doc, cls, labelText, value, { min = 1, max = 64, hint = '', provider } = {}) {
  const wrap = h(doc, 'label', 'mv-field');
  wrap.appendChild(h(doc, 'span', 'mv-field-label', labelText));
  const inp = h(doc, 'input', `input ${cls}`);
  inp.type = 'number'; inp.min = String(min); inp.max = String(max); inp.step = '1';
  inp.value = value == null ? '' : String(value);
  if (provider) inp.dataset.provider = provider;
  wrap.appendChild(inp);
  if (hint) wrap.appendChild(h(doc, 'small', 'hint', hint));
  return wrap;
}

/**
 * The Providers card. `providers` is GET /api/providers' payload (never a
 * token). `signIn` is an in-flight device-flow {userCode, verificationUri,
 * status, error} or null; app.js keeps it across repaints.
 */
export function renderProvidersCard(providers, { doc = globalThis.document, signIn = null, split = false } = {}) {
  const p = providers || {};
  const c = p.copilot || { connected: false, termsCurrent: false, accountType: 'individual', maxConcurrent: 4 };
  // On the Providers TAB each provider is its own card: three unrelated accounts stacked in one
  // card read as one long form, and the page has room for them now. Inside the Models view (the
  // old home) it stays a single card. Either way the rows keep their shape, so every flow that
  // finds .mv-pv-row[data-provider] is unaffected.
  const root = h(doc, split ? 'div' : 'section', split ? 'mv-providers mv-providers-split' : 'card mv-providers');
  if (!split) {
    const head = h(doc, 'div', 'mv-head');
    head.appendChild(h(doc, 'h3', 'mv-section-title', 'Providers'));
    root.appendChild(head);
  }
  root.appendChild(h(doc, 'small', 'hint mv-providers-hint',
    "Providers let Worca run models that don't speak the Anthropic API — through its own in-process bridge. Sign in or set a key once; then import or add models on the Models tab and pick them anywhere a model is picked."));
  /** One provider's row, in its own card when the tab hosts it. */
  const place = (row, title) => {
    if (!split) { root.appendChild(row); return; }
    const card = h(doc, 'section', 'card mv-pv-card');
    const head = h(doc, 'div', 'mv-head');
    head.appendChild(h(doc, 'h3', 'mv-section-title', title));
    card.appendChild(head);
    card.appendChild(row);
    root.appendChild(card);
  };

  // ── GitHub Copilot ──
  const cp = h(doc, 'div', 'mv-pv-row');
  cp.dataset.provider = 'copilot';
  const cpMain = h(doc, 'div', 'mv-pv-main');
  const cpHead = h(doc, 'div', 'mv-head');
  cpHead.appendChild(h(doc, 'b', 'mv-name', 'GitHub Copilot'));
  cpHead.appendChild(providerStatePill(doc, c));
  cpMain.appendChild(cpHead);
  cpMain.appendChild(h(doc, 'small', 'hint',
    c.acknowledgedTerms
      ? `Notice acknowledged on ${String(c.acknowledgedTerms).slice(0, 10)}${c.termsCurrent ? '' : ' — the wording changed, please re-read'}. Claude models run through Copilot's native Anthropic endpoint (thinking intact); other vendors run through a translation layer.`
      : 'Uses your Copilot subscription for GPT, Gemini, Grok and Claude models. Sign in reads the GitHub notice first.'));
  if (c.tokenSource === 'env') cpMain.appendChild(h(doc, 'small', 'hint', `Token read from your shell env (${c.tokenRef}).`));
  const flow = h(doc, 'div', 'mv-cp-flow');
  if (signIn) flow.appendChild(renderCopilotSignIn(signIn, { doc }));
  cpMain.appendChild(flow);
  const quota = h(doc, 'small', 'hint mv-cp-quota', quotaLine(c.quota));
  cpMain.appendChild(quota);
  cpMain.appendChild(h(doc, 'small', 'hint mv-pv-msg'));
  cp.appendChild(cpMain);

  const cpCtl = h(doc, 'div', 'mv-pv-ctl');
  const acct = h(doc, 'label', 'mv-field');
  acct.appendChild(h(doc, 'span', 'mv-field-label', 'Account'));
  const sel = h(doc, 'select', 'select mv-cp-account');
  for (const [v, t] of [['individual', 'Individual'], ['business', 'Business'], ['enterprise', 'Enterprise']]) {
    const o = h(doc, 'option', null, t); o.value = v; if (v === c.accountType) o.selected = true; sel.appendChild(o);
  }
  acct.appendChild(sel);
  acct.appendChild(h(doc, 'small', 'hint', 'Picks the Copilot API host. The sign-in itself reports the host it was issued for and wins when it does.'));
  cpCtl.appendChild(acct);
  cpCtl.appendChild(numberField(doc, 'mv-pv-conc', 'Max concurrent requests', c.maxConcurrent, {
    provider: 'copilot',
    hint: "Fan-out children beyond this wait their turn. The one knob that lowers GitHub's abuse-detection risk — keep it low.",
  }));
  cp.appendChild(cpCtl);

  const cpBtns = h(doc, 'div', 'mv-pv-btns');
  const imp = h(doc, 'button', 'btn-ghost mv-cp-fetch-models', 'Import models…');
  imp.type = 'button'; imp.disabled = !c.connected;
  if (!c.connected) imp.title = 'Sign in first';
  cpBtns.appendChild(imp);
  const quotaBtn = h(doc, 'button', 'btn-ghost mv-cp-quota-refresh', 'Refresh usage');
  quotaBtn.type = 'button'; quotaBtn.disabled = !c.connected;
  cpBtns.appendChild(quotaBtn);
  if (c.connected) {
    const outBtn = h(doc, 'button', 'btn-ghost mv-cp-signout', 'Sign out');
    outBtn.type = 'button';
    cpBtns.appendChild(outBtn);
  } else if (!signIn) {
    const inBtn = h(doc, 'button', 'btn-go mv-cp-signin', 'Sign in…');
    inBtn.type = 'button';
    cpBtns.appendChild(inBtn);
  }
  const terms = h(doc, 'button', 'btn-ghost mv-cp-terms', c.acknowledgedTerms ? 'Re-read notice' : 'Read notice');
  terms.type = 'button';
  cpBtns.appendChild(terms);
  cp.appendChild(cpBtns);
  place(cp, 'GitHub Copilot');

  // ── key-based providers ──
  for (const name of ['openai', 'anthropic']) {
    const k = p[name] || { configured: false, keySet: false, baseUrl: '', maxConcurrent: 8 };
    const row = h(doc, 'div', 'mv-pv-row');
    row.dataset.provider = name;
    const main = h(doc, 'div', 'mv-pv-main');
    const rh = h(doc, 'div', 'mv-head');
    rh.appendChild(h(doc, 'b', 'mv-name', PROVIDER_LABELS[name]));
    rh.appendChild(k.configured ? h(doc, 'span', 'badge green', 'key set')
      : k.keySet ? h(doc, 'span', 'badge red', 'key ${VAR} not set')
        : k.keyOptional ? h(doc, 'span', 'badge green', 'local — no key needed') : h(doc, 'span', 'badge grey', 'no key'));
    main.appendChild(rh);
    main.appendChild(h(doc, 'small', 'hint', name === 'openai'
      ? 'OpenAI, Azure, Ollama, vLLM, Groq, an in-house gateway — anything with a /chat/completions endpoint. Models run through the translation layer (no thinking blocks, no web tools).'
      : 'A gateway that already speaks the Anthropic Messages API but needs a key Worca holds for it. Calls pass through untouched.'));
    if (k.keySource === 'env') main.appendChild(h(doc, 'small', 'hint', `Key read from your shell env (${k.keyRef}).`));
    main.appendChild(h(doc, 'small', 'hint mv-pv-msg'));
    row.appendChild(main);

    const ctl = h(doc, 'div', 'mv-pv-ctl');
    const bu = h(doc, 'label', 'mv-field');
    bu.appendChild(h(doc, 'span', 'mv-field-label', 'Base URL'));
    const buIn = h(doc, 'input', 'input mv-pv-baseurl');
    buIn.type = 'text'; buIn.value = k.baseUrl || ''; buIn.dataset.provider = name;
    buIn.placeholder = name === 'openai' ? 'https://api.openai.com/v1' : 'https://api.anthropic.com';
    bu.appendChild(buIn);
    ctl.appendChild(bu);
    const key = h(doc, 'label', 'mv-field');
    key.appendChild(h(doc, 'span', 'mv-field-label', 'API key'));
    const keyIn = h(doc, 'input', 'input mv-pv-key');
    keyIn.type = 'text'; keyIn.dataset.provider = name;
    keyIn.value = k.keyRef || k.keyMasked || '';
    if (keyIn.value) keyIn.dataset.original = keyIn.value;
    keyIn.placeholder = 'sk-…, or ${VAR} to read your shell env';
    key.appendChild(keyIn);
    key.appendChild(h(doc, 'small', 'hint', 'Stored masked; leave masked to keep. A model can override this key on its Connection.'));
    ctl.appendChild(key);
    ctl.appendChild(numberField(doc, 'mv-pv-conc', 'Max concurrent requests', k.maxConcurrent, { provider: name }));
    row.appendChild(ctl);

    const btns = h(doc, 'div', 'mv-pv-btns');
    // The verdict belongs NEXT TO the button that asks for it: the hint line under the description
    // is in the other column, and a one-line grey answer there reads as "nothing happened".
    btns.appendChild(h(doc, 'span', 'mv-pv-result', ''));
    if (name === 'openai') {
      // §8.4 for a server you run: ask the endpoint what it serves instead of typing model ids.
      const browse = h(doc, 'button', 'btn-ghost mv-pv-browse', 'Import models…');
      browse.type = 'button'; browse.dataset.provider = name;
      browse.title = 'List what this endpoint serves (llama.cpp, Ollama, LM Studio, vLLM…) and import the ones you want';
      btns.appendChild(browse);
    }
    const test = h(doc, 'button', 'btn-ghost mv-pv-test', 'Test connection');
    test.type = 'button'; test.dataset.provider = name;
    btns.appendChild(test);
    const save = h(doc, 'button', 'btn-go mv-pv-save', 'Save');
    save.type = 'button'; save.dataset.provider = name;
    btns.appendChild(save);
    row.appendChild(btns);
    place(row, PROVIDER_LABELS[name]);
  }
  return root;
}

/** Collect a key-based provider row into a PATCH body (masked echo dropped). */
export function collectProviderRow(rootEl, name) {
  const row = rootEl.querySelector(`.mv-pv-row[data-provider="${name}"]`);
  if (!row) return null;
  const body = {};
  const bu = row.querySelector('.mv-pv-baseurl');
  if (bu) body.baseUrl = bu.value.trim();
  const key = row.querySelector('.mv-pv-key');
  if (key) {
    const v = key.value.trim();
    if (v !== (key.dataset.original || '')) body.apiKey = v;   // unchanged (masked or ref) = keep
  }
  const conc = row.querySelector('.mv-pv-conc');
  if (conc && conc.value.trim() !== '') body.maxConcurrent = Number(conc.value);
  return body;
}

/** The device-flow block: the code in large type, copy, the link, a live status line, cancel (§8.1). */
export function renderCopilotSignIn(flow, { doc = globalThis.document } = {}) {
  const box = h(doc, 'div', 'mv-cp-signin-box');
  box.appendChild(h(doc, 'small', 'hint', 'Enter this code on github.com to connect your Copilot account:'));
  const codeRow = h(doc, 'div', 'mv-cp-code-row');
  codeRow.appendChild(h(doc, 'code', 'mv-cp-code', flow.userCode || ''));
  const copy = h(doc, 'button', 'btn-ghost mv-cp-copy', 'Copy code');
  copy.type = 'button'; copy.dataset.code = flow.userCode || '';
  codeRow.appendChild(copy);
  const link = h(doc, 'a', 'btn-ghost mv-cp-open', 'Open github.com/login/device');
  link.href = flow.verificationUri || 'https://github.com/login/device';
  link.target = '_blank'; link.rel = 'noopener';
  codeRow.appendChild(link);
  box.appendChild(codeRow);
  const status = h(doc, 'small', `hint mv-cp-status${flow.error ? ' err' : ''}`, flow.error || flow.status || 'Waiting for approval…');
  box.appendChild(status);
  const cancel = h(doc, 'button', 'btn-ghost mv-cp-cancel', flow.error ? 'Dismiss' : 'Cancel');
  cancel.type = 'button';
  box.appendChild(cancel);
  return box;
}

// ── Import from Copilot (§8.4) ───────────────────────────────────────────────

const yesNo = (v) => (v ? '✓' : '—');
const fmtK = (n) => (n ? `${Math.round(n / 1000)}k` : '—');

/** The import sheet over GET /api/providers/copilot/models' list. */
export function renderImportSheet(models, { doc = globalThis.document } = {}) {
  const root = h(doc, 'section', 'card mv-editor mvi');
  root.appendChild(h(doc, 'h3', 'mv-editor-title', 'Import from GitHub Copilot'));
  root.appendChild(h(doc, 'small', 'hint',
    'These run through your Copilot subscription. Claude models keep extended thinking; other vendors run through a translation layer (no thinking blocks, no web tools). Imported entries are priced free — Copilot bills premium requests, not tokens — and Worca counts requests per run.'));
  const list = Array.isArray(models) ? models : [];
  if (!list.length) {
    root.appendChild(h(doc, 'div', 'hist-empty', 'Copilot returned no chat models for this account.'));
  } else {
    const tbl = h(doc, 'table', 'tm-tbl mvi-tbl');
    const thead = h(doc, 'thead');
    const hr = h(doc, 'tr');
    const allTh = h(doc, 'th');
    const all = h(doc, 'input', 'mvi-all'); all.type = 'checkbox'; all.title = 'Select all importable';
    allTh.appendChild(all);
    hr.appendChild(allTh);
    for (const t of ['Model', 'Vendor', 'Context', 'Tools', 'Vision', 'Reasoning', 'Status']) hr.appendChild(h(doc, 'th', null, t));
    thead.appendChild(hr);
    tbl.appendChild(thead);
    const tbody = h(doc, 'tbody');
    for (const m of list) {
      const tr = h(doc, 'tr');
      tr.dataset.id = m.id;
      const disabled = m.policyState && m.policyState !== 'enabled';
      if (disabled) tr.className = 'mvi-disabled';
      const cbTd = h(doc, 'td');
      const cb = h(doc, 'input', 'mvi-cb'); cb.type = 'checkbox'; cb.value = m.id; cb.disabled = !!disabled;
      cbTd.appendChild(cb);
      tr.appendChild(cbTd);
      const nameTd = h(doc, 'td');
      nameTd.appendChild(h(doc, 'b', null, m.name || m.id));
      nameTd.appendChild(h(doc, 'small', 'hint mvi-id', m.id));
      tr.appendChild(nameTd);
      tr.appendChild(h(doc, 'td', null, m.vendor || '—'));
      tr.appendChild(h(doc, 'td', 'num', fmtK(m.contextWindow || m.maxPromptTokens)));
      tr.appendChild(h(doc, 'td', null, yesNo(m.toolCalls)));
      tr.appendChild(h(doc, 'td', null, yesNo(m.vision)));
      tr.appendChild(h(doc, 'td', null, yesNo(m.reasoning)));
      const status = [];
      if (m.inCatalog) status.push('in catalog ✓');
      if (m.preview) status.push('preview');
      if (disabled) status.push('disabled — enable it in your GitHub Copilot settings');
      tr.appendChild(h(doc, 'td', 'mvi-status', status.join(' · ') || '—'));
      tbody.appendChild(tr);
    }
    tbl.appendChild(tbody);
    root.appendChild(tbl);
  }
  const msg = h(doc, 'p', 'form-msg mvi-msg');
  msg.setAttribute('aria-live', 'polite');
  root.appendChild(msg);
  const btns = h(doc, 'div', 'mv-editor-btns');
  const go = h(doc, 'button', 'btn-go mvi-go', 'Import selected');
  go.type = 'button'; go.disabled = !list.length;
  const cancel = h(doc, 'button', 'btn-ghost mvi-cancel', 'Cancel');
  cancel.type = 'button';
  btns.appendChild(go); btns.appendChild(cancel);
  root.appendChild(btns);
  return root;
}

/**
 * The import sheet over GET /api/providers/openai/models (§8.4): what one OpenAI-compatible
 * endpoint serves. Same chrome and same checkbox contract as the Copilot sheet — collectImportSheet
 * reads both — with the columns a local server decides a pipeline on: the window ONE request gets,
 * tool calls, and whether the model is loaded.
 */
export function renderEndpointSheet(payload, { doc = globalThis.document } = {}) {
  const p = payload || {};
  const list = Array.isArray(p.models) ? p.models : [];
  const root = h(doc, 'section', 'card mv-editor mvi mvi-ep');
  root.dataset.source = 'endpoint';
  root.dataset.baseurl = p.baseUrl || '';
  root.appendChild(h(doc, 'h3', 'mv-editor-title', `Import from ${p.serverLabel || 'this endpoint'}`));
  root.appendChild(h(doc, 'small', 'hint', `${p.baseUrl || ''} — these run through the translation layer (no thinking blocks, no web tools) and are priced free: a model on your own machine bills nothing. Worca pins the prompt limit only when the server reports the window it really serves.`));
  for (const w of Array.isArray(p.warnings) ? p.warnings : []) root.appendChild(h(doc, 'small', 'hint mvi-warn', w));
  if (!list.length) {
    root.appendChild(h(doc, 'div', 'hist-empty', 'This endpoint lists no models.'));
  } else {
    const tbl = h(doc, 'table', 'tm-tbl mvi-tbl');
    const thead = h(doc, 'thead');
    const hr = h(doc, 'tr');
    const allTh = h(doc, 'th');
    const all = h(doc, 'input', 'mvi-all'); all.type = 'checkbox'; all.title = 'Select all importable';
    allTh.appendChild(all);
    hr.appendChild(allTh);
    for (const t of ['Model', 'Detail', 'Window', 'Tools', 'Vision', 'Status']) hr.appendChild(h(doc, 'th', null, t));
    thead.appendChild(hr);
    tbl.appendChild(thead);
    const tbody = h(doc, 'tbody');
    for (const m of list) {
      const tr = h(doc, 'tr');
      tr.dataset.id = m.id;
      const blocked = m.importable === false;
      if (blocked) tr.className = 'mvi-disabled';
      const cbTd = h(doc, 'td');
      const cb = h(doc, 'input', 'mvi-cb'); cb.type = 'checkbox'; cb.value = m.id; cb.disabled = blocked;
      cbTd.appendChild(cb);
      tr.appendChild(cbTd);
      const nameTd = h(doc, 'td');
      nameTd.appendChild(h(doc, 'b', null, m.name || m.id));
      nameTd.appendChild(h(doc, 'small', 'hint mvi-id', m.catalogId || ''));
      tr.appendChild(nameTd);
      tr.appendChild(h(doc, 'td', null, m.detail || '—'));
      // The served window is the one a prompt limit may be pinned from; the trained one is context.
      const ctxTd = h(doc, 'td', 'num', fmtK(m.servedContext));
      if (!m.servedContext && m.trainedContext) {
        ctxTd.textContent = '';
        ctxTd.appendChild(h(doc, 'span', 'mvi-ctx-unknown', `? · supports ${fmtK(m.trainedContext)}`));
      }
      tr.appendChild(ctxTd);
      tr.appendChild(h(doc, 'td', null, m.toolCalls === null || m.toolCalls === undefined ? '?' : yesNo(m.toolCalls)));
      tr.appendChild(h(doc, 'td', null, m.vision === null || m.vision === undefined ? '?' : yesNo(m.vision)));
      const status = [];
      if (m.inCatalog) status.push('in catalog ✓');
      if (m.loaded === true) status.push('loaded');
      else if (m.loaded === false) status.push('not loaded');
      if (blocked) status.push(m.blocked || 'not importable');
      tr.appendChild(h(doc, 'td', 'mvi-status', status.join(' · ') || '—'));
      tbody.appendChild(tr);
    }
    tbl.appendChild(tbody);
    root.appendChild(tbl);
  }
  const msg = h(doc, 'p', 'form-msg mvi-msg');
  msg.setAttribute('aria-live', 'polite');
  root.appendChild(msg);
  const btns = h(doc, 'div', 'mv-editor-btns');
  const go = h(doc, 'button', 'btn-go mvi-go', 'Import selected');
  go.type = 'button'; go.disabled = !list.some((m) => m.importable !== false);
  const cancel = h(doc, 'button', 'btn-ghost mvi-cancel', 'Cancel');
  cancel.type = 'button';
  btns.appendChild(go); btns.appendChild(cancel);
  root.appendChild(btns);
  return root;
}

/** The Copilot model ids ticked in an import sheet. */
export function collectImportSheet(rootEl) {
  return [...rootEl.querySelectorAll('.mvi-cb')].filter((c) => c.checked && !c.disabled).map((c) => c.value);
}

/** The select-all box: tick every importable row. */
export function applyImportSelectAll(rootEl, on) {
  for (const c of rootEl.querySelectorAll('.mvi-cb')) if (!c.disabled) c.checked = !!on;
}

// ── Editor: Connection section (§8.3) ───────────────────────────────────────

/**
 * The Connection block for the model editor. `model` is the MASKED entry or
 * null; `providers` the GET /api/providers payload (for the readiness hints);
 * `copilotModels` an optional list for the upstream-id datalist.
 */
export function renderConnectionSection(model, { doc = globalThis.document, providers = null, copilotModels = [] } = {}) {
  const editing = !!model;
  const upstream = editing && model.upstream ? model.upstream : null;
  const groupName = `mv-conn-mode-${editing ? model.id : 'new'}`;
  const wrap = h(doc, 'div', 'mv-conn');
  wrap.dataset.provider = upstream ? upstream.provider : '';

  const modes = h(doc, 'div', 'mv-conn-modes');
  const startMode = upstream ? 'provider' : (editing && model.env && Object.keys(model.env).length ? 'env' : 'direct');
  for (const [value, text, hint] of [
    ['direct', 'Anthropic API / CLI default', "Today's behaviour: the claude CLI reaches the endpoint its own login or env names."],
    ['env', 'Custom endpoint via env', 'For endpoints that already speak the Anthropic API — LiteLLM, Bedrock, Vertex, a gateway. Set the routing env below.'],
    ['provider', 'Through a provider', "Worca's own bridge: GitHub Copilot, or an OpenAI-compatible endpoint. No LiteLLM needed."],
  ]) {
    const lab = h(doc, 'label', 'mv-conn-mode');
    const rb = h(doc, 'input', 'mv-conn-mode-rb');
    rb.type = 'radio'; rb.name = groupName; rb.value = value; rb.checked = value === startMode;
    lab.appendChild(rb);
    const txt = h(doc, 'span', 'mv-conn-mode-text');
    txt.appendChild(h(doc, 'b', null, text));
    txt.appendChild(h(doc, 'small', 'hint', hint));
    lab.appendChild(txt);
    modes.appendChild(lab);
  }
  wrap.appendChild(modes);

  const body = h(doc, 'div', 'mv-conn-body');
  const grid = h(doc, 'div', 'mv-conn-grid');
  const field = (labelText, input, cls = '') => {
    const f = h(doc, 'label', `mv-field${cls ? ` ${cls}` : ''}`);
    f.appendChild(h(doc, 'span', 'mv-field-label', labelText));
    f.appendChild(input);
    return f;
  };

  const provSel = h(doc, 'select', 'select mv-conn-provider');
  for (const name of ['copilot', 'openai', 'anthropic']) {
    const o = h(doc, 'option', null, PROVIDER_LABELS[name]); o.value = name;
    if (upstream ? upstream.provider === name : name === 'copilot') o.selected = true;
    provSel.appendChild(o);
  }
  const provField = field('Provider', provSel);
  provField.appendChild(h(doc, 'small', 'hint mv-conn-provider-hint'));
  grid.appendChild(provField);

  const apiSel = h(doc, 'select', 'select mv-conn-api');
  if (upstream) apiSel.dataset.keep = upstream.api;   // refilled by applyConnectionMode below
  grid.appendChild(field('API', apiSel));

  const modelIn = h(doc, 'input', 'input mv-conn-model');
  modelIn.type = 'text'; modelIn.placeholder = 'gpt-5, claude-sonnet-4.5, …';
  modelIn.value = upstream ? upstream.model : '';
  if (Array.isArray(copilotModels) && copilotModels.length) {
    const dl = h(doc, 'datalist');
    dl.id = `mv-conn-copilot-models-${editing ? model.id : 'new'}`;
    for (const m of copilotModels) {
      const o = h(doc, 'option'); o.value = m.id; o.label = `${m.name || m.id} · ${m.vendor || ''}${m.contextWindow ? ` · ${fmtK(m.contextWindow)}` : ''}`;
      dl.appendChild(o);
    }
    modelIn.setAttribute('list', dl.id);
    grid.appendChild(dl);
  }
  const modelField = field('Upstream model id', modelIn);
  modelField.appendChild(h(doc, 'small', 'hint', 'The id the endpoint expects. The model id above stays Worca’s handle.'));
  grid.appendChild(modelField);
  body.appendChild(grid);

  // Advanced: per-entry overrides for the key-based providers.
  const adv = h(doc, 'details', 'advanced mv-conn-adv');
  const sum = h(doc, 'summary', null, 'Advanced — base URL, API key, extra headers');
  adv.appendChild(sum);
  const advBody = h(doc, 'div', 'advanced-body mv-conn-adv-body');
  const bu = h(doc, 'input', 'input mv-conn-baseurl');
  bu.type = 'text'; bu.placeholder = 'leave empty to use the provider’s base URL'; bu.value = upstream && upstream.baseUrl ? upstream.baseUrl : '';
  advBody.appendChild(field('Base URL override', bu));
  const key = h(doc, 'input', 'input mv-conn-key');
  key.type = 'text'; key.placeholder = 'leave empty to use the provider’s key; or ${VAR}';
  key.value = upstream && upstream.apiKey ? upstream.apiKey : '';
  if (key.value) key.dataset.original = key.value;
  advBody.appendChild(field('API key override', key));
  const hdr = h(doc, 'textarea', 'textarea mv-conn-headers');
  hdr.rows = 2; hdr.placeholder = 'One per line: Header-Name: value';
  hdr.value = upstream && upstream.headers ? Object.entries(upstream.headers).map(([k, v]) => `${k}: ${v}`).join('\n') : '';
  advBody.appendChild(field('Extra headers', hdr));
  adv.appendChild(advBody);
  body.appendChild(adv);

  // Capabilities.
  const caps = h(doc, 'div', 'mv-conn-caps');
  const capsRow = h(doc, 'div', 'mv-conn-caps-row');
  const stored = upstream && upstream.capabilities ? upstream.capabilities : {};
  for (const [k, text] of CAPABILITY_FLAGS) {
    const lab = h(doc, 'label', 'mv-conn-cap');
    const cb = h(doc, 'input', 'mv-conn-cap-cb');
    cb.type = 'checkbox'; cb.dataset.cap = k;
    cb.checked = stored[k] === undefined ? (k === 'toolCalls') : !!stored[k];
    lab.appendChild(cb);
    lab.appendChild(h(doc, 'span', null, text));
    capsRow.appendChild(lab);
  }
  for (const [k, text] of [['maxPromptTokens', 'Prompt limit (tokens)'], ['maxOutputTokens', 'Output limit (tokens)']]) {
    const lab = h(doc, 'label', 'mv-conn-limit');
    lab.appendChild(h(doc, 'span', null, text));
    const inp = h(doc, 'input', 'input mv-conn-limit-in');
    inp.type = 'number'; inp.min = '1'; inp.step = '1'; inp.dataset.limit = k;
    inp.value = stored[k] ? String(stored[k]) : '';
    lab.appendChild(inp);
    capsRow.appendChild(lab);
  }
  caps.appendChild(capsRow);
  caps.appendChild(h(doc, 'small', 'hint', 'Prefilled by Import from Copilot; edit for an unknown endpoint. Reasoning maps Worca’s effort to reasoning_effort; without it, only medium effort is offered.'));
  body.appendChild(caps);
  body.appendChild(h(doc, 'small', 'hint mv-conn-note'));
  wrap.appendChild(body);

  if (providers) wrap._providers = providers;   // readiness hints (jsdom-safe expando)
  applyConnectionMode(wrap);
  return wrap;
}

/** The api options a provider allows; keeps the current pick when still legal. */
function refillApiSelect(sel, provider, keep) {
  const apis = PROVIDER_APIS[provider] || [];
  const cur = keep || sel.value;
  sel.innerHTML = '';
  for (const a of apis) {
    const o = sel.ownerDocument.createElement('option');
    o.value = a; o.textContent = API_LABELS[a] || a;
    sel.appendChild(o);
  }
  sel.value = apis.includes(cur) ? cur : apis[0] || '';
  sel.disabled = apis.length <= 1;
}

/**
 * Apply the Connection rules to the form (§8.3): the provider block shows only
 * in provider mode, Advanced only for key-based providers, the API list follows
 * the provider, the readiness hint follows the provider's state, and the
 * effort checkboxes in the SAME editor collapse to medium for a translated
 * model without reasoning. The single place that knows these rules — the
 * initial render and app.js's delegated `change` handler both call it.
 * @param {Element} connEl  the .mv-conn root (or any ancestor containing one)
 */
export function applyConnectionMode(connEl) {
  const conn = connEl && (connEl.classList && connEl.classList.contains('mv-conn') ? connEl : connEl.querySelector && connEl.querySelector('.mv-conn'));
  if (!conn) return;
  const mode = conn.querySelector('.mv-conn-mode-rb:checked')?.value || 'direct';
  const body = conn.querySelector('.mv-conn-body');
  if (body) body.hidden = mode !== 'provider';
  const provider = conn.querySelector('.mv-conn-provider')?.value || 'copilot';
  conn.dataset.provider = mode === 'provider' ? provider : '';
  const apiSel = conn.querySelector('.mv-conn-api');
  if (apiSel) refillApiSelect(apiSel, provider, apiSel.dataset.keep || apiSel.value);
  delete apiSel?.dataset.keep;
  const api = apiSel ? apiSel.value : '';
  const adv = conn.querySelector('.mv-conn-adv');
  if (adv) adv.hidden = provider === 'copilot';
  const hint = conn.querySelector('.mv-conn-provider-hint');
  const p = conn._providers;
  if (hint) {
    if (!p) hint.textContent = '';
    else if (provider === 'copilot') hint.textContent = p.copilot?.connected ? `Connected${p.copilot.login ? ` as @${p.copilot.login}` : ''}.` : 'Not connected — sign in on the Providers card above, or Save is refused.';
    else hint.textContent = p[provider]?.configured ? 'Provider key set.' : (p[provider]?.keySet ? 'The provider key’s ${VAR} is not set in Worca’s environment.' : p[provider]?.keyOptional ? 'Local endpoint — no key needed.' : 'No provider key — set one on the Providers card, or override it under Advanced.');
    hint.className = `hint mv-conn-provider-hint${(provider === 'copilot' ? !p?.copilot?.connected : !(p?.[provider]?.configured || p?.[provider]?.keyOptional)) && p ? ' warn' : ''}`;
  }
  const note = conn.querySelector('.mv-conn-note');
  if (note) {
    note.textContent = mode !== 'provider' ? '' : api === 'openai-chat'
      ? `Translated: no thinking blocks, WebSearch/WebFetch withheld, prompt limit per the capabilities above.${provider === 'copilot' ? ' Copilot bills premium requests, so Pricing defaults to Free.' : ''}`
      : provider === 'copilot' ? 'Copilot’s native Anthropic endpoint: thinking blocks and cache accounting arrive intact. Copilot bills premium requests, so Pricing defaults to Free.'
        : 'Passthrough: the request reaches the endpoint untouched; only auth and headers are added.';
  }
  const reasoning = !!conn.querySelector('.mv-conn-cap-cb[data-cap="reasoning"]')?.checked;
  // Efforts live in the editor grid beside this block.
  const editor = conn.closest ? conn.closest('.mv-editor') : null;
  const effCbs = editor ? [...editor.querySelectorAll('.mv-effort-cb')] : [];
  const effHint = editor ? editor.querySelector('.mv-efforts-hint') : null;
  const translatedNoReasoning = mode === 'provider' && api === 'openai-chat' && !reasoning;
  for (const cb of effCbs) {
    if (translatedNoReasoning) {
      cb.disabled = cb.value !== 'medium';
      if (cb.value !== 'medium') cb.checked = false; else cb.checked = true;
    } else cb.disabled = false;
  }
  if (effHint) {
    effHint.textContent = translatedNoReasoning
      ? 'This model has no reasoning control; effort would be ignored — only medium is offered.'
      : mode === 'provider' && api === 'openai-chat' ? 'Maps to reasoning_effort low / medium / high — xhigh and max are not distinct.'
        : 'All checked = every effort (the default).';
  }
}

/** Load a stored upstream into a rendered Connection block (Edit a copy, import prefill). */
export function setModelUpstream(connEl, upstream) {
  const conn = connEl.classList && connEl.classList.contains('mv-conn') ? connEl : connEl.querySelector('.mv-conn');
  if (!conn) return;
  const mode = upstream ? 'provider' : 'direct';
  for (const rb of conn.querySelectorAll('.mv-conn-mode-rb')) rb.checked = rb.value === mode;
  if (upstream) {
    const prov = conn.querySelector('.mv-conn-provider'); if (prov) prov.value = upstream.provider;
    const api = conn.querySelector('.mv-conn-api'); if (api) api.dataset.keep = upstream.api;
    const model = conn.querySelector('.mv-conn-model'); if (model) model.value = upstream.model || '';
    const bu = conn.querySelector('.mv-conn-baseurl'); if (bu) bu.value = upstream.baseUrl || '';
    const key = conn.querySelector('.mv-conn-key'); if (key) { key.value = upstream.apiKey || ''; if (key.value) key.dataset.original = key.value; }
    const hdr = conn.querySelector('.mv-conn-headers'); if (hdr) hdr.value = upstream.headers ? Object.entries(upstream.headers).map(([k, v]) => `${k}: ${v}`).join('\n') : '';
    const caps = upstream.capabilities || {};
    for (const cb of conn.querySelectorAll('.mv-conn-cap-cb')) cb.checked = caps[cb.dataset.cap] === undefined ? cb.dataset.cap === 'toolCalls' : !!caps[cb.dataset.cap];
    for (const inp of conn.querySelectorAll('.mv-conn-limit-in')) inp.value = caps[inp.dataset.limit] ? String(caps[inp.dataset.limit]) : '';
  }
  applyConnectionMode(conn);
}

/**
 * Collect the Connection block: `{ upstream }` where upstream is the object to
 * store, or null to clear (the form shows the truth, like Pricing's 'cli').
 * A masked key echo is sent as-is; the server treats it as "keep".
 */
export function collectConnection(connEl) {
  const conn = connEl.classList && connEl.classList.contains('mv-conn') ? connEl : connEl.querySelector('.mv-conn');
  if (!conn) return { upstream: undefined };
  const mode = conn.querySelector('.mv-conn-mode-rb:checked')?.value || 'direct';
  if (mode !== 'provider') return { upstream: null };
  const provider = conn.querySelector('.mv-conn-provider')?.value || 'copilot';
  const api = conn.querySelector('.mv-conn-api')?.value || '';
  const model = (conn.querySelector('.mv-conn-model')?.value || '').trim();
  const upstream = { provider, api, model };
  if (provider !== 'copilot') {
    const bu = (conn.querySelector('.mv-conn-baseurl')?.value || '').trim();
    if (bu) upstream.baseUrl = bu;
    const key = (conn.querySelector('.mv-conn-key')?.value || '').trim();
    if (key) upstream.apiKey = key;
    const lines = (conn.querySelector('.mv-conn-headers')?.value || '').split('\n').map((l) => l.trim()).filter(Boolean);
    const headers = {};
    for (const l of lines) {
      const i = l.indexOf(':');
      if (i > 0) headers[l.slice(0, i).trim()] = l.slice(i + 1).trim();
    }
    if (Object.keys(headers).length) upstream.headers = headers;
  }
  const capabilities = {};
  for (const cb of conn.querySelectorAll('.mv-conn-cap-cb')) capabilities[cb.dataset.cap] = !!cb.checked;
  for (const inp of conn.querySelectorAll('.mv-conn-limit-in')) {
    const v = (inp.value || '').trim();
    if (v !== '') capabilities[inp.dataset.limit] = Number(v);
  }
  upstream.capabilities = capabilities;
  return { upstream };
}
