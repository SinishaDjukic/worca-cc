// ui/public/team-policy-view.mjs
// Pure DOM renderers for the team-policy surfaces (team-policy design §11, boards 1–11):
// the Projects cell, the enable dialog body, the effective-policy table, the editor, the
// workspace card line, the Settings readout, the New pipeline notes line, the team-cap
// pause banner, the Plugins strip and the setup checklist. Like team-metrics-surfaces.mjs:
// no fetch, no network — app.js owns data and delegates events. The few listeners here are
// purely local (a show-all toggle, chip add/remove inside the editor).

const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const POLICY_PAUSE_REASONS = Object.freeze(['cost_pipeline_policy', 'cost_total_policy']);
export const PROTECT_HINT = 'Protect worca-policy on your git host so only maintainers can push. Worca reads it for everyone and writes it only from the Team policy page.';

function h(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
const dot = (doc, tone) => { const d = h(doc, 'span', `dot tm-dot ${tone}`); d.setAttribute('aria-hidden', 'true'); return d; };
const code = (doc, text) => h(doc, 'code', 'mono', text);
function btn(doc, cls, text, primary = false) { const b = h(doc, 'button', `${primary ? 'btn btn-primary btn-mini' : 'btn-ghost btn-mini'} ${cls}`, text); b.type = 'button'; return b; }
const usd = (n) => `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export function relTime(iso, now = Date.now()) {
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const hrs = Math.round(m / 60);
  if (hrs < 48) return `${hrs} h ago`;
  const d = Math.round(hrs / 24);
  if (d < 30) return `${d} d ago`;
  const dt = new Date(iso);
  return `${MO[dt.getUTCMonth()]} ${dt.getUTCDate()}`;
}
const capText = (caps) => {
  if (!caps) return '';
  const parts = [];
  if (caps.pipeline) parts.push(`pipeline cap ${usd(caps.pipeline.value)} (${caps.pipeline.kind})`);
  if (caps.total) parts.push(`total ${usd(caps.total.value)}${caps.resetPeriod ? `/${caps.resetPeriod === 'weekly' ? 'week' : 'month'}` : ''} (${caps.total.kind})`);
  return parts.join(' · ');
};

// ---- Projects cell (board 2) --------------------------------------------------------------
/** Classify a project status (from /api/policy/scopes → projects[]) into a cell variant. */
export function projectTpState(s) {
  if (s.hasOrigin === false) return { kind: 'no-origin' };
  if (!s.present) return { kind: 'off' };
  if (s.unknownSchema) return { kind: 'unsupported' };
  if (s.delegateTo && s.delegateState === 'invalid') return { kind: 'delegate-invalid' };
  if (s.blocked) return { kind: 'blocked' };
  if (s.delegateTo) return { kind: 'follows' };
  return { kind: 'home' };
}

const cap = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t);
/**
 * One project's team-policy state in a few words — the metrics module's projectTmSummary shape:
 * `short` for a row chip and the project page's stat card ("home", "follows acme/gateway", "off"),
 * `detail` the sentence behind it, `tone` the dot colour.
 */
export function projectTpSummary(s, { now = Date.now() } = {}) {
  const { kind } = projectTpState(s);
  const fields = s.fieldCount == null ? '' : `${s.fieldCount} field${s.fieldCount === 1 ? '' : 's'}`;
  const caps = (kind === 'home' || kind === 'follows') ? capText(s.caps) : '';
  switch (kind) {
    case 'no-origin': return { kind, tone: 'muted', short: 'not available', detail: s.noGit ? 'not a git repository' : 'no origin remote' };
    case 'off': return { kind, tone: 'grey', short: 'off', detail: 'your settings apply' };
    case 'unsupported': return { kind, tone: 'red', short: 'needs a newer Worca', detail: s.warnings?.[0] || 'the policy uses a newer schema' };
    case 'delegate-invalid': return { kind, tone: 'red', short: 'follow invalid', detail: `follows ${s.delegateTo} · your settings apply` };
    case 'blocked': return { kind, tone: 'amber', short: s.delegateCode === 'DOC_UNKNOWN' || s.blocked === 'DOC_UNKNOWN' ? 'on · not read yet' : 'on · unresolved', detail: `${s.delegateDetail || 'the policy could not be resolved'} · your settings apply` };
    case 'follows': return { kind, tone: 'green', short: `follows ${s.home || s.delegateTo}`, detail: [fields, caps].filter(Boolean).join(' · ') };
    default: return { kind, tone: 'green', short: 'home', detail: [fields, s.updatedAt ? `updated ${relTime(s.updatedAt, now)}` : '', caps].filter(Boolean).join(' · ') };
  }
}

/** The Projects-row chip, the metrics chip's twin: a dot, the word and the short state, nothing else. */
export function renderProjectTpChip(s, { doc = globalThis.document, now = Date.now() } = {}) {
  const chip = h(doc, 'span', 'pl-team-item pl-tp');
  chip.dataset.key = s.key;
  const sum = projectTpSummary(s, { now });
  chip.dataset.kind = sum.kind;
  if (sum.tone !== 'muted') chip.append(dot(doc, sum.tone));
  chip.append(h(doc, 'span', 'pl-team-name', 'Policy'), ' ', h(doc, 'span', `pl-team-state${sum.tone === 'muted' ? ' muted' : ''}`, sum.short));
  chip.title = `Team policy: ${cap(sum.short)}${sum.detail ? ` · ${sum.detail}` : ''}`;
  return chip;
}

/** The project page's team-policy block: the same two-row grid as the team-metrics cell. */
export function renderProjectTpCell(s, { doc = globalThis.document, now = Date.now(), heading = true } = {}) {
  const cell = h(doc, 'div', 'tm-cell tp-cell');
  cell.dataset.key = s.key;
  if (heading) cell.append(h(doc, 'span', 'tm-label', 'Team policy'));
  const line = h(doc, 'div', 'tm-line');
  const status = h(doc, 'span', 'tm-status');
  const actions = h(doc, 'div', 'tm-actions');
  const { kind } = projectTpState(s);
  const fields = s.fieldCount == null ? '' : ` · ${s.fieldCount} field${s.fieldCount === 1 ? '' : 's'}`;
  let hint = null;
  switch (kind) {
    case 'no-origin':
      status.classList.add('muted');
      status.textContent = s.noGit ? 'Not available · not a git repository' : 'Not available · no origin remote';
      break;
    case 'off':
      status.classList.add('muted'); status.textContent = 'Off · your settings apply';
      actions.append(btn(doc, 'tp-enable', 'Set up team policy…'));
      break;
    case 'unsupported':
      line.append(dot(doc, 'red'));
      status.textContent = 'Needs a newer Worca · your settings apply';
      hint = h(doc, 'small', 'hint tm-hint', s.warnings?.[0] || 'the policy uses a newer schema');
      break;
    case 'delegate-invalid':
      line.append(dot(doc, 'red'));
      status.append('Follow invalid · follows ', code(doc, s.delegateTo),
        s.delegateCode === 'DELEGATE_CHAIN' ? ', which itself follows another (no chains)'
          : s.delegateCode === 'DELEGATE_UNKNOWN' ? ', which is not a project in Worca on this machine'
            : ', which no longer carries a policy');
      actions.append(btn(doc, 'tp-change', 'Change…'));
      hint = h(doc, 'small', 'hint mono tm-hint', 'your settings apply · pick a new home');
      break;
    case 'blocked':
      line.append(dot(doc, 'amber'));
      status.textContent = s.delegateCode === 'DOC_UNKNOWN' || s.blocked === 'DOC_UNKNOWN'
        ? 'On · branch not read yet · your settings apply'
        : `On · ${s.delegateDetail || 'the policy could not be resolved'} · your settings apply`;
      break;
    case 'follows':
      line.append(dot(doc, 'green'));
      status.append('On · follows ', code(doc, s.home || s.delegateTo), fields);
      actions.append(btn(doc, 'tp-open', 'Open'), btn(doc, 'tp-change', 'Change…'));
      break;
    default:
      line.append(dot(doc, 'green'));
      status.textContent = `On · policy home${fields}${s.updatedAt ? ` · updated ${relTime(s.updatedAt, now)}` : ''}`;
      actions.append(btn(doc, 'tp-open', 'Open'));
  }
  if ((kind === 'home' || kind === 'follows') && s.title) status.title = s.title;
  line.append(status);
  cell.append(line);
  if (hint) cell.append(hint);
  if ((kind === 'home' || kind === 'follows')) {
    const capLine = capText(s.caps);
    if (capLine) cell.append(h(doc, 'small', 'hint tm-hint', capLine));
    if (Array.isArray(s.warnings) && s.warnings.length) {
      const w = h(doc, 'small', 'hint tm-hint tp-warn', s.warnings[0]);
      w.title = s.warnings.join('\n');
      cell.append(w);
    }
  }
  if (actions.childNodes.length) cell.append(actions);
  return cell;
}

function radioCard(doc, { name, value, checked, title, body, disabled = false }) {
  const card = h(doc, 'label', `radio-card${checked ? ' on' : ''}${disabled ? ' disabled' : ''}`);
  const input = h(doc, 'input');
  input.type = 'radio'; input.name = name; input.value = value; input.checked = !!checked; input.disabled = disabled;
  const text = h(doc, 'span', 'radio-card-text');
  text.append(h(doc, 'b', null, title));
  const p = h(doc, 'small', 'hint');
  for (const part of body) p.append(typeof part === 'string' ? part : code(doc, part.code));
  text.append(p);
  card.append(input, text);
  return card;
}

/** Enable dialog body (board 3). mode: 'here' | 'follow'. */
export function renderPolicyEnableDialogBody({ project, origin, candidates = [], mode = 'here', change = false }, { doc = globalThis.document } = {}) {
  const root = h(doc, 'div', 'tp-enable-body');
  const sub = h(doc, 'div', 'sub');
  sub.append('for ', h(doc, 'b', null, project.name), ' · origin ', code(doc, origin || '—'));
  root.append(sub);
  const where = h(doc, 'div', 'field');
  where.append(h(doc, 'label', null, 'Where the policy lives'));
  where.append(radioCard(doc, { name: 'tp-where', value: 'here', checked: mode === 'here' && !change, disabled: change, title: 'Here, on this repository',
    body: ['Creates an orphan branch ', { code: 'worca-policy' }, ' on origin holding only ', { code: '.worca-policy/' }, '. Starts empty; you edit it on the Team policy page. Everyone who runs Worca on this repository reads it.'] }));
  const follow = radioCard(doc, { name: 'tp-where', value: 'follow', checked: mode === 'follow', disabled: candidates.length === 0,
    title: "Follow another project's policy",
    body: ["A tiny marker branch on this origin points teammates at the target. This project's runs use the target's policy."] });
  where.append(follow);
  if (mode === 'follow') {
    const sel = h(doc, 'select', 'select tp-follow-target');
    sel.setAttribute('aria-label', 'Policy home');
    const want = project.metricsFollow ? String(project.metricsFollow).toLowerCase() : null;
    for (const c of candidates) {
      const o = h(doc, 'option', null, c.label);
      o.value = c.slug;
      if (want && c.slug.toLowerCase() === want) o.selected = true;
      sel.append(o);
    }
    const wrap = h(doc, 'div', 'select-wrap tm-delegate-wrap');
    wrap.append(sel);
    follow.append(wrap);
    follow.append(h(doc, 'small', 'hint', want && candidates.some((c) => c.slug.toLowerCase() === want)
      ? 'Only projects that carry a policy are listed. Preselected to match where this project\'s metrics go.'
      : 'Only projects that carry a policy are listed.'));
  }
  if (change) where.append(h(doc, 'small', 'hint', 'This project already has a marker branch — pick a new home.'));
  if (!candidates.length) where.append(h(doc, 'small', 'hint', 'No project carries a policy yet — set one up here first, then point other projects at it.'));
  root.append(where);
  const warn = h(doc, 'div', 'hint tm-warn');
  warn.append('Protect ', code(doc, 'worca-policy'), ' on your git host so only maintainers can push. Worca reads it for everyone and writes it only from the Team policy page. This is the opposite of ', code(doc, 'worca-metrics'), ', which every teammate must be able to push to.');
  root.append(warn);
  return root;
}

// ---- Team policy page: read mode (board 4) ----------------------------------------------
const GROUP_LABELS = { cost: 'Cost', ask: 'Ask Worca', guardrails: 'Guardrails', models: 'Models', plugins: 'Plugins', runs: 'Runs' };
const kindChip = (doc, kind, declaredKind) => {
  const c = h(doc, 'span', `tp-kind ${declaredKind === 'hard' ? 'hard' : kind}`, declaredKind === 'hard' ? 'hard' : kind);
  if (declaredKind === 'hard') c.title = 'Hard constraints are not enforced by this version — treated as soft';
  return c;
};

/** The effective-policy table: what the next run on this scope will use. */
export function renderEffectiveTable(payload, { doc = globalThis.document, showAll = false } = {}) {
  const rows = payload.rows || [];
  const card = h(doc, 'section', 'card tp-effective');
  const head = h(doc, 'div', 'card-head');
  head.append(h(doc, 'h2', null, 'Effective policy'), h(doc, 'small', 'hint', payload.policy?.workspaceRun ? 'Effective = what the next workspace run will use' : 'Effective = what your next run on this scope will use'));
  card.append(head);
  const table = h(doc, 'table', 'tm-tbl tp-tbl');
  const thead = h(doc, 'thead'); const hr = h(doc, 'tr');
  for (const t of ['Field', 'Team', 'Kind', 'Yours', 'Effective']) hr.append(h(doc, 'th', null, t));
  thead.append(hr); table.append(thead);
  const tbody = h(doc, 'tbody');
  const groups = new Map();
  for (const r of rows) { if (!groups.has(r.group)) groups.set(r.group, []); groups.get(r.group).push(r); }
  let hiddenCount = 0;
  for (const [group, list] of groups) {
    const visible = list.filter((r) => showAll || r.shown);
    if (!visible.length) { hiddenCount += list.length; continue; }
    const gtr = h(doc, 'tr', 'tp-group'); const gtd = h(doc, 'td', null, GROUP_LABELS[group] || group); gtd.colSpan = 5; gtr.append(gtd); tbody.append(gtr);
    for (const r of list) {
      if (!showAll && !r.shown) { hiddenCount += 1; continue; }
      const tr = h(doc, 'tr'); tr.dataset.key = r.key;
      const key = h(doc, 'td', 'tp-key'); key.append(r.label);
      if (r.help) key.append(h(doc, 'small', null, r.help));
      const team = h(doc, 'td', 'tp-team');
      if (r.team) {
        team.append(h(doc, 'span', 'mono', r.team.display));
        if (r.team.fromWorkspaceRuns) team.append(' ', h(doc, 'span', 'badge grey', 'workspace runs'));
        const attrs = [];
        if (r.team.kind === 'soft' && r.team.onBreach) attrs.push(`on breach: ${r.team.onBreach}`);
        if (r.team.requireReason) attrs.push('reason required');
        if (r.team.window) attrs.push(r.team.window);
        if (attrs.length) team.append(h(doc, 'small', 'hint', attrs.join(' · ')));
      } else team.append(h(doc, 'span', 'muted', '—'));
      const kind = h(doc, 'td');
      if (r.team) kind.append(kindChip(doc, r.team.kind, r.team.declaredKind));
      const loose = !!(r.note && /looser/.test(r.note));
      const yours = h(doc, 'td', `tp-eff${loose ? ' loose' : ''}`, r.local && r.local.set ? r.local.display : '—');
      if (!(r.local && r.local.set)) yours.classList.add('muted');
      const eff = h(doc, 'td', `tp-eff${r.effective.source === 'team' ? ' tight' : ''}`);
      eff.append(r.effective.display);
      const src = { team: 'team', 'team-default': 'team default', local: 'yours', advisory: 'advisory', default: 'default', none: '' }[r.effective.source] || r.effective.source;
      if (src) eff.append(' ', h(doc, 'span', 'tp-src', r.note ? `${src}, ${r.note}` : src));
      tr.append(key, team, kind, yours, eff);
      tbody.append(tr);
    }
  }
  if (!rows.some((r) => r.shown) && !showAll) {
    const tr = h(doc, 'tr'); const td = h(doc, 'td'); td.colSpan = 5;
    td.append(h(doc, 'small', 'hint', 'The policy sets no fields yet — your local settings apply.')); tr.append(td); tbody.append(tr);
  }
  table.append(tbody);
  card.append(table);
  const foot = h(doc, 'small', 'hint tp-foot');
  foot.append('Struck-through = your value is looser than the team\'s and does not apply. ');
  const toggle = h(doc, 'button', 'linkish tp-show-all', showAll ? 'show only the fields the team sets' : `show all ${rows.length} fields`);
  toggle.type = 'button';
  toggle.addEventListener('click', () => { card.replaceWith(renderEffectiveTable(payload, { doc, showAll: !showAll })); });
  foot.append(toggle);
  card.append(foot);
  return card;
}

/** Topbar chip: synced <rel> · <sha7> + Check now. */
export function renderPolicySyncChip({ policy }, { doc = globalThis.document, now = Date.now(), busy = false } = {}) {
  const chip = h(doc, 'div', `sync-chip-inner tp-chip${busy ? ' is-busy' : ''}`);
  const warnings = policy?.warnings || [];
  if (busy) { const sp = h(doc, 'span', 'tm-busy-spin'); sp.setAttribute('aria-hidden', 'true'); chip.append(sp); chip.setAttribute('aria-busy', 'true'); }
  else chip.append(h(doc, 'span', `dot ${warnings.length ? 'amber' : 'green'}`));
  const txt = h(doc, 'span', 'sync-text');
  // The team-metrics chip's words, and only its words: the commit id belongs with "updated by"
  // on the policy panel, not with how fresh this machine's copy is.
  if (busy) txt.append(h(doc, 'span', 'tm-checking', 'Checking origin…'), policy?.checkedAt ? ' · ' : '');
  else txt.append(policy?.checkedAt ? 'Synced ' : 'Not checked yet');
  if (policy?.checkedAt) txt.append(h(doc, 'b', null, relTime(policy.checkedAt, now) || ''));
  if (warnings.length) txt.append(` | ${warnings.length} warning${warnings.length === 1 ? '' : 's'}`);
  chip.append(txt);
  const check = h(doc, 'button', `btn-ghost btn-mini tp-check-now${busy ? ' busy' : ''}`, 'Refresh'); check.type = 'button';
  if (busy) check.disabled = true;
  chip.append(check);
  if (warnings.length) { const w = h(doc, 'pre', 'hint mono tm-sync-error', warnings.join('\n')); chip.append(w); }
  return chip;
}

// ---- Team policy page: the shared document (static) vs this machine (dynamic) ----------------
/**
 * The header panel (board 4): what the TEAM published — title, where it comes from, the version
 * and who last changed it, the notes — with Edit policy as its own action. Everything here is the
 * same for every teammate; the stat cards below are what THIS machine makes of it.
 */
export function renderPolicyHeader(payload, { doc = globalThis.document, now = Date.now(), editing = false } = {}) {
  const policy = payload.policy || {};
  const scope = payload.scope || {};
  const card = h(doc, 'section', 'card tp-head');
  const main = h(doc, 'div', 'tp-head-main');
  main.append(h(doc, 'div', 'tp-head-kicker', 'SHARED WITH THE TEAM'));
  main.append(h(doc, 'h2', 'tp-head-title', policy.doc?.title || `${policy.home || 'Team'} policy`));
  const facts = h(doc, 'dl', 'tp-facts');
  const fact = (label, ...value) => { facts.append(h(doc, 'dt', null, label)); const dd = h(doc, 'dd'); dd.append(...value); facts.append(dd); };
  if (scope.kind === 'workspace') {
    const v = [h(doc, 'span', null, 'Policy home '), code(doc, policy.home || '—')];
    if (policy.delegated && policy.from) v.push(h(doc, 'span', null, ' · the home follows it through '), code(doc, policy.from));
    fact('SOURCE', ...v);
    fact('APPLIES TO', `Workspace runs of ${scope.name || 'this workspace'} — the policy's workspace-run values sit on top`);
  } else if (policy.delegated) {
    fact('SOURCE', h(doc, 'span', null, 'Follows '), code(doc, policy.home || '—'), h(doc, 'span', null, ' — the document lives there'));
    fact('APPLIES TO', `Runs on ${scope.name || 'this project'}`);
  } else {
    fact('SOURCE', h(doc, 'span', null, 'This project\'s own '), code(doc, 'worca-policy'), h(doc, 'span', null, ' branch'));
    fact('APPLIES TO', `Runs on ${scope.name || 'this project'}, and on every project that follows it`);
  }
  const ver = [];
  if (policy.sha) { const c = code(doc, String(policy.sha).slice(0, 7)); c.title = `Policy version: commit ${String(policy.sha).slice(0, 7)} on ${policy.home}'s worca-policy branch`; ver.push(c); }
  if (policy.doc?.updatedAt) ver.push(h(doc, 'span', null, `${ver.length ? ' · ' : ''}updated ${relTime(policy.doc.updatedAt, now) || ''}${policy.doc.updatedBy ? ` by ${policy.doc.updatedBy}` : ''}`));
  if (ver.length) fact('VERSION', ...ver);
  if (policy.doc?.notes) fact('NOTES', h(doc, 'span', 'tp-head-notes', policy.doc.notes));
  main.append(facts);
  card.append(main);
  const actions = h(doc, 'div', 'tp-head-actions');
  const edit = h(doc, 'button', 'btn btn-ghost btn-mini tp-edit', editing ? 'Cancel editing' : 'Edit policy'); edit.type = 'button';
  edit.disabled = !payload.canPublish;
  actions.append(edit);
  if (!payload.canPublish) actions.append(h(doc, 'small', 'hint', `Edit it where ${policy.home || 'the policy home'} is registered in Worca`));
  card.append(actions);
  return card;
}

const capSub = (row) => {
  if (!row) return '';
  const src = { team: 'the team cap', 'team-default': 'the team\'s starting value', local: 'your own limit', advisory: 'advisory', default: 'the Worca default', none: '' }[row.effective?.source] || '';
  return [src, row.note].filter(Boolean).join(' · ');
};

/**
 * The stat cards (board 4): what the policy means for THIS machine right now — the caps a run
 * will hit, the plugins it expects, and where your setup differs. Dynamic by nature, so they sit
 * apart from the published document above.
 */
export function renderPolicyStats(payload, { doc = globalThis.document } = {}) {
  const rows = payload.rows || [];
  const byKey = (k) => rows.find((r) => r.key === k) || null;
  const grid = h(doc, 'div', 'tp-ov-grid');
  const statCard = (label, value, sub, tone = null) => {
    const c = h(doc, 'div', 'tp-ov-card');
    c.append(h(doc, 'div', 'tp-ov-label', label), h(doc, 'div', 'tp-ov-value mono', value));
    if (sub) c.append(h(doc, 'div', `tp-ov-sub${tone ? ` is-${tone}` : ''}`, sub));
    grid.append(c);
    return c;
  };
  const pipeline = byKey('cost.pipelineLimitUsd');
  statCard('PER-PIPELINE CAP', pipeline?.effective?.display && pipeline.effective.source !== 'none' ? pipeline.effective.display : 'none',
    pipeline && pipeline.effective.source !== 'none' ? capSub(pipeline) : 'neither you nor the team set one');
  const total = byKey('cost.totalLimitUsd');
  const period = byKey('cost.resetPeriod');
  statCard('TOTAL CAP', total?.effective?.display && total.effective.source !== 'none' ? total.effective.display : 'none',
    total && total.effective.source !== 'none' ? [capSub(total), period?.effective?.display ? `per ${period.effective.display === 'weekly' ? 'week' : 'month'}` : ''].filter(Boolean).join(' · ') : 'neither you nor the team set one');
  const reqs = payload.requirements || [];
  const off = reqs.filter((r) => r.state !== 'ok');
  // Counted by state ("1 missing · 1 below the floor"), never one word per plugin.
  const byState = ['missing', 'outdated', 'disabled']
    .map((st) => [off.filter((r) => r.state === st).length, st === 'outdated' ? 'below the floor' : st])
    .filter(([n]) => n > 0).map(([n, label]) => `${n} ${label}`);
  statCard('REQUIRED PLUGINS', reqs.length ? `${reqs.length - off.length}/${reqs.length}` : 'none',
    reqs.length ? (off.length ? `${byState.join(' · ')} — see the Plugins tab` : 'all installed') : 'the policy expects none',
    off.length ? 'warn' : null);
  const dev = payload.deviations || [];
  statCard('OFF-POLICY HERE', dev.length ? String(dev.length) : 'none',
    dev.length ? dev[0].text : 'your setup matches what the team expects', dev.length ? 'warn' : null);
  return grid;
}

const PLUGIN_STATE = { ok: ['green', 'installed'], missing: ['amber', 'not installed'], outdated: ['amber', 'below the floor'], disabled: ['amber', 'disabled here'] };

/** The Plugins tab (board 11): what the policy expects, against what this machine has. */
export function renderPolicyPluginsPanel(payload, { doc = globalThis.document } = {}) {
  const reqs = payload.requirements || [];
  const blocked = payload.blockedPlugins || [];
  const root = h(doc, 'div', 'tp-sec-body');
  const card = h(doc, 'section', 'card tp-plugins');
  const head = h(doc, 'div', 'card-head');
  head.append(h(doc, 'h2', null, 'Required plugins'));
  const setup = btn(doc, 'pl-policy-setup', 'Set up…');
  head.append(setup);
  card.append(head);
  card.append(h(doc, 'small', 'hint tp-plugins-hint', 'Installing shows the plugin\'s source, commit and what it ships, and waits for your click. Nothing installs on its own unless you trust the policy home on the Plugins page.'));
  card.append(h(doc, 'p', 'form-msg tp-plugins-msg'));
  if (!reqs.length) card.append(h(doc, 'div', 'hist-empty', 'This policy expects no plugins.'));
  else {
    const table = h(doc, 'table', 'tm-tbl tp-tbl tp-plugins-tbl');
    const thead = h(doc, 'thead'); const hr = h(doc, 'tr');
    for (const t of ['Plugin', 'Expected', 'Installed here', 'State', '']) hr.append(h(doc, 'th', null, t));
    thead.append(hr); table.append(thead);
    const tbody = h(doc, 'tbody');
    for (const r of reqs) {
      const tr = h(doc, 'tr'); tr.dataset.name = r.name;
      const name = h(doc, 'td', 'tp-key'); name.append(r.name);
      name.append(h(doc, 'small', null, `expected by ${(r.homes || []).join(', ') || payload.policy?.home || 'the policy'}${r.marketplace ? ` · from ${r.marketplace}` : ''}`));
      const want = h(doc, 'td', 'mono', r.minVersion ? `≥ ${r.minVersion}` : 'any version');
      const have = h(doc, 'td', 'mono', r.installed?.version || (r.installed ? 'installed' : '—'));
      if (!r.installed) have.classList.add('muted');
      const [tone, label] = PLUGIN_STATE[r.state] || ['grey', r.state];
      const state = h(doc, 'td'); state.append(h(doc, 'span', `badge ${tone}`, label));
      const act = h(doc, 'td', 'tp-plugin-act');
      if (r.state === 'missing') { const b = btn(doc, 'pl-policy-install', 'Install…', true); b.dataset.name = r.name; b.dataset.marketplace = r.marketplace || ''; act.append(b); }
      else if (r.state === 'outdated') { const b = btn(doc, 'pl-policy-update', 'Update…'); b.dataset.name = r.name; act.append(b); }
      else if (r.state === 'disabled') act.append(h(doc, 'small', 'hint', 'enable it on the Plugins page'));
      else if (r.config) { const b = btn(doc, 'pl-policy-configure', 'Configure…'); b.dataset.name = r.name; act.append(b); }
      tr.append(name, want, have, state, act);
      tbody.append(tr);
    }
    table.append(tbody);
    card.append(table);
  }
  root.append(card);
  if (blocked.length) {
    const bc = h(doc, 'section', 'card tp-blocked');
    const bh = h(doc, 'div', 'card-head');
    bh.append(h(doc, 'h2', null, 'Blocked by the policy'), h(doc, 'small', 'hint', 'A run with one of these enabled proceeds and is recorded as off-policy'));
    bc.append(bh);
    const list = h(doc, 'div', 'tp-blocked-list');
    for (const b of blocked) {
      const row = h(doc, 'div', 'tp-blocked-row');
      row.append(h(doc, 'span', 'mono', b.name), h(doc, 'span', 'badge amber', 'enabled here'), h(doc, 'small', 'hint', `blocked by ${b.home}`));
      list.append(row);
    }
    bc.append(list);
    root.append(bc);
  }
  return root;
}

/** The Catalog tab: the guardrail sets and models the policy ships to everyone who follows it. */
export function renderPolicyCatalogPanel(payload, { doc = globalThis.document } = {}) {
  const cat = payload.policy?.doc?.catalogs || {};
  const sets = cat.guardrailSets || [];
  const models = cat.models || [];
  const root = h(doc, 'div', 'tp-sec-body');
  const sc = h(doc, 'section', 'card tp-catalog-sets');
  const sh = h(doc, 'div', 'card-head');
  sh.append(h(doc, 'h2', null, 'Guardrail sets'), h(doc, 'small', 'hint', 'Read-only on every machine that follows this policy · Settings › Guardrails'));
  sc.append(sh);
  if (!sets.length) sc.append(h(doc, 'div', 'hist-empty', 'This policy ships no guardrail sets.'));
  else {
    const list = h(doc, 'div', 'tp-cat-list');
    for (const g of sets) {
      const row = h(doc, 'div', 'tp-cat-row');
      const main = h(doc, 'div', 'tp-cat-main');
      main.append(h(doc, 'b', null, g.name || g.id), ' ', code(doc, `gp:${g.id}`));
      const bits = [g.envScrub ? 'env scrubbed' : 'env passed through', `${(g.protectedPaths || []).length} protected path${(g.protectedPaths || []).length === 1 ? '' : 's'}`, `${(g.deny || []).length} deny rule${(g.deny || []).length === 1 ? '' : 's'}`];
      main.append(h(doc, 'small', 'hint', bits.join(' · ')));
      row.append(main, h(doc, 'span', 'badge blue', 'policy'));
      list.append(row);
    }
    sc.append(list);
  }
  root.append(sc);
  const mc = h(doc, 'section', 'card tp-catalog-models');
  const mh = h(doc, 'div', 'card-head');
  mh.append(h(doc, 'h2', null, 'Models'), h(doc, 'small', 'hint', 'Selectable everywhere a model is chosen · Settings › Models'));
  mc.append(mh);
  if (!models.length) mc.append(h(doc, 'div', 'hist-empty', 'This policy ships no models.'));
  else {
    const list = h(doc, 'div', 'tp-cat-list');
    for (const m of models) {
      const row = h(doc, 'div', 'tp-cat-row');
      const main = h(doc, 'div', 'tp-cat-main');
      main.append(h(doc, 'b', null, m.label || m.id), ' ', code(doc, m.id));
      const envKeys = Object.keys(m.env || {});
      main.append(h(doc, 'small', 'hint', [(m.efforts || []).join(' · ') || 'default efforts', envKeys.length ? `${envKeys.length} env var${envKeys.length === 1 ? '' : 's'}` : null, m.env?.ANTHROPIC_BASE_URL ? 'routes via base URL' : null].filter(Boolean).join(' · ')));
      row.append(main, h(doc, 'span', 'badge blue', 'policy'));
      list.append(row);
    }
    mc.append(list);
  }
  root.append(mc);
  return root;
}

export function renderPolicyEmptyState({ doc = globalThis.document } = {}) {
  const grid = h(doc, 'div', 'empty tm-empty');
  const card = (step, title, body, href, label, primary) => {
    const c = h(doc, 'section', 'card');
    c.append(h(doc, 'div', 'tm-step', step), h(doc, 'h3', null, title));
    const p = h(doc, 'p', 'hint');
    for (const part of body) p.append(typeof part === 'string' ? part : h(doc, 'code', 'mono', part.code));
    const a = h(doc, 'a', primary ? 'btn btn-primary btn-mini' : 'btn btn-ghost btn-mini', label); a.href = href;
    c.append(p, a);
    return c;
  };
  grid.append(
    card('01 · PROJECT', 'Set up team policy on a project',
      ['Creates a ', { code: 'worca-policy' }, " branch on the project's origin holding one document: cost caps, expected plugins, model and guardrail defaults. Every teammate's Worca reads it; nothing is added to your code branches."], '#projects', 'Go to Projects', true),
    card('02 · WORKSPACE', 'Pick a policy home for a workspace',
      ['Workspace runs use the policy of one member you choose, with the values that document sets for workspace runs. The choice lives on this machine and can be changed on the workspace card.'], '#workspaces', 'Go to Workspaces', false),
  );
  const foot = h(doc, 'small', 'hint tm-empty-foot', "Already set up by a teammate? Worca checks each project's origin for the branch on start and every hour. ");
  const check = h(doc, 'button', 'linkish tp-check-now', 'Check now'); check.type = 'button';
  foot.append(check);
  const out = h(doc, 'div');
  out.append(grid, foot);
  return out;
}

// ---- Team policy page: edit mode (board 5) --------------------------------------------------
const KIND_LABEL = { default: 'Default', soft: 'Soft', hard: 'Hard' };
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

function listChips(doc, row, items, labelOf) {
  const list = row.querySelector('.tp-list');
  list.replaceChildren();
  for (const [i, it] of items.entries()) {
    const chip = h(doc, 'span', 'chip tp-chip');
    chip.append(labelOf(it));
    const rm = h(doc, 'button', 'tp-chip-rm', '✕'); rm.type = 'button'; rm.dataset.index = String(i); rm.setAttribute('aria-label', `Remove ${labelOf(it)}`);
    chip.append(rm);
    list.append(chip);
  }
  if (!items.length) list.append(h(doc, 'span', 'muted tp-list-empty', '(none)'));
}

function readItems(row) { try { const v = JSON.parse(row.dataset.json || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } }
function writeItems(row, items) { row.dataset.json = JSON.stringify(items); }

/** Value control for one registry row; the row's dataset carries list-shaped values. */
function valueControl(doc, meta, entry, row) {
  const wrap = h(doc, 'div', 'tp-control');
  const v = entry ? entry.value : undefined;
  switch (meta.type) {
    case 'usd': case 'int': {
      const inp = h(doc, 'input', 'input tp-val'); inp.type = 'number'; inp.step = meta.type === 'usd' ? '0.01' : '1';
      if (meta.min != null) inp.min = String(meta.min); if (meta.max != null) inp.max = String(meta.max);
      inp.value = v == null ? '' : String(v); inp.setAttribute('aria-label', meta.label);
      wrap.append(inp); break;
    }
    case 'usd-or-null': {
      const inp = h(doc, 'input', 'input tp-val'); inp.type = 'number'; inp.step = '0.1'; inp.min = String(meta.min ?? 0.1); inp.max = String(meta.max ?? 100);
      inp.value = v == null ? '' : String(v); inp.setAttribute('aria-label', meta.label);
      const lab = h(doc, 'label', 'check-row'); const cb = h(doc, 'input', 'tp-null'); cb.type = 'checkbox'; cb.checked = entry ? v === null : false;
      lab.append(cb, ' No cap');
      wrap.append(inp, lab); break;
    }
    case 'bool': {
      const lab = h(doc, 'label', 'switch-row'); const cb = h(doc, 'input', 'sw-input tp-val'); cb.type = 'checkbox'; cb.checked = v === true;
      cb.setAttribute('aria-label', meta.label);
      lab.append(cb, h(doc, 'span', 'switch switch-sm'), h(doc, 'span', 'txt', v === true ? 'on' : 'off'));
      cb.addEventListener('change', () => { lab.querySelector('.txt').textContent = cb.checked ? 'on' : 'off'; });
      wrap.append(lab); break;
    }
    case 'enum': {
      const sw = h(doc, 'div', 'select-wrap'); const sel = h(doc, 'select', 'select tp-val'); sel.setAttribute('aria-label', meta.label);
      for (const val of meta.values || []) { const o = h(doc, 'option', null, val); o.value = val; if (v === val) o.selected = true; sel.append(o); }
      sw.append(sel); wrap.append(sw); break;
    }
    case 'string': case 'semver': {
      const inp = h(doc, 'input', 'input tp-val'); inp.type = 'text'; inp.value = v == null ? '' : String(v); inp.setAttribute('aria-label', meta.label);
      inp.placeholder = meta.type === 'semver' ? '1.4.0' : meta.key === 'workflows.default' ? 'wf_full or wfp_<plugin>_<slug>' : meta.key === 'guardrails.default' ? 'normal, gr_<slug> or gp:<name>' : '';
      wrap.append(inp); break;
    }
    case 'string[]': {
      writeItems(row, Array.isArray(v) ? v : []);
      wrap.append(h(doc, 'div', 'tp-list'));
      const add = h(doc, 'div', 'path-row tp-add-row'); const inp = h(doc, 'input', 'input tp-add'); inp.type = 'text'; inp.placeholder = meta.key === 'plugins.marketplaces' ? 'owner/repo or URL' : meta.key === 'models.allowed' ? 'model id' : 'plugin name';
      const b = h(doc, 'button', 'btn btn-ghost btn-mini tp-add-btn', '+ add'); b.type = 'button';
      add.append(inp, b); wrap.append(add);
      break;
    }
    case 'plugins': {
      writeItems(row, Array.isArray(v) ? v : []);
      wrap.append(h(doc, 'div', 'tp-list'));
      const add = h(doc, 'div', 'path-row tp-add-row');
      const name = h(doc, 'input', 'input tp-add tp-plugin-name'); name.type = 'text'; name.placeholder = 'plugin name';
      const mkt = h(doc, 'input', 'input tp-plugin-marketplace'); mkt.type = 'text'; mkt.placeholder = 'marketplace (optional)';
      const min = h(doc, 'input', 'input tp-plugin-min'); min.type = 'text'; min.placeholder = 'min version';
      const b = h(doc, 'button', 'btn btn-ghost btn-mini tp-add-btn', '+ add'); b.type = 'button';
      add.append(name, mkt, min, b); wrap.append(add);
      break;
    }
    case 'steps': {
      const items = v && typeof v === 'object' ? Object.entries(v).map(([role, s]) => ({ role, model: s?.model || '', effort: s?.effort || '' })) : [];
      writeItems(row, items);
      wrap.append(h(doc, 'div', 'tp-list'));
      const add = h(doc, 'div', 'path-row tp-add-row');
      const role = h(doc, 'input', 'input tp-add tp-step-role'); role.type = 'text'; role.placeholder = 'role (planner, implementer, …)';
      const model = h(doc, 'input', 'input tp-step-model'); model.type = 'text'; model.placeholder = 'model id';
      const sw = h(doc, 'div', 'select-wrap'); const effort = h(doc, 'select', 'select tp-step-effort');
      const none = h(doc, 'option', null, 'effort'); none.value = ''; effort.append(none);
      for (const e of EFFORTS) { const o = h(doc, 'option', null, e); o.value = e; effort.append(o); }
      sw.append(effort);
      const b = h(doc, 'button', 'btn btn-ghost btn-mini tp-add-btn', '+ add'); b.type = 'button';
      add.append(role, model, sw, b); wrap.append(add);
      break;
    }
    default: wrap.append(h(doc, 'span', 'muted', '—'));
  }
  return wrap;
}

const chipLabel = (meta) => (it) => (meta.type === 'plugins' ? `${it.name}${it.minVersion ? ` ≥ ${it.minVersion}` : ''}${it.marketplace ? ` (${it.marketplace})` : ''}`
  : meta.type === 'steps' ? `${it.role} ${it.model || '·'}${it.effort ? ` / ${it.effort}` : ''}` : String(it));

function editorRow(doc, meta, entry, scope) {
  const row = h(doc, 'div', 'tp-edit-row');
  row.dataset.key = meta.key; row.dataset.scope = scope; row.dataset.type = meta.type;
  const key = h(doc, 'div', 'tp-key'); key.append(meta.label);
  if (meta.help) key.append(h(doc, 'small', null, meta.help));
  row.append(key);
  row.append(valueControl(doc, meta, entry, row));
  const seg = h(doc, 'div', 'seg tp-kind-seg'); seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Kind');
  const allowed = Array.isArray(meta.kinds) ? meta.kinds : ['default'];
  for (const k of ['default', 'soft', 'hard']) {
    const b = h(doc, 'button', `tp-kind-btn${entry && entry.kind === k ? ' on' : ''}`, KIND_LABEL[k]); b.type = 'button'; b.dataset.kind = k;
    if (k === 'hard') { b.disabled = true; b.title = 'Hard constraints arrive in a later version. The value is stored today and treated as soft.'; }
    else if (!allowed.includes(k)) { b.disabled = true; b.title = k === 'soft' ? 'Only a default: the developer\'s own value wins' : 'Only soft: an expectation the run may go past'; }
    seg.append(b);
  }
  row.append(seg);
  const extra = h(doc, 'div', 'tp-extra');
  if (meta.cap) {
    const lab = h(doc, 'label', 'tp-onbreach'); lab.append('on breach ');
    const sw = h(doc, 'span', 'select-wrap'); const sel = h(doc, 'select', 'select tp-onbreach-sel');
    for (const val of ['pause', 'warn']) { const o = h(doc, 'option', null, val); o.value = val; if ((entry?.onBreach || 'pause') === val) o.selected = true; sel.append(o); }
    sw.append(sel); lab.append(sw);
    const rr = h(doc, 'label', 'check-row tp-require'); const cb = h(doc, 'input', 'tp-require-reason'); cb.type = 'checkbox'; cb.checked = !!entry?.requireReason;
    rr.append(cb, ' reason required');
    extra.append(lab, rr);
    const sync = () => { const soft = seg.querySelector('.on')?.dataset.kind === 'soft'; lab.hidden = !soft; rr.hidden = !soft; };
    seg.addEventListener('click', () => setTimeout(sync, 0)); sync();
  } else if (meta.advisory) {
    const lab = h(doc, 'label', 'tp-onbreach'); lab.append('window ');
    const sw = h(doc, 'span', 'select-wrap'); const sel = h(doc, 'select', 'select tp-window-sel');
    for (const val of ['monthly', 'weekly']) { const o = h(doc, 'option', null, val); o.value = val; if ((entry?.window || 'monthly') === val) o.selected = true; sel.append(o); }
    sw.append(sel); lab.append(sw); extra.append(lab, h(doc, 'span', 'tp-src', 'always warn'));
  }
  const unset = h(doc, 'button', 'tp-unset', 'unset'); unset.type = 'button'; extra.append(unset);
  row.append(extra);
  if (meta.type === 'string[]' || meta.type === 'plugins' || meta.type === 'steps') listChips(doc, row, readItems(row), chipLabel(meta));
  return row;
}

/** Auto-pick the first allowed kind when a value changes on an unset row. */
function ensureKind(row) {
  const seg = row.querySelector('.tp-kind-seg');
  if (seg.querySelector('.on')) return;
  const first = [...seg.querySelectorAll('button')].find((b) => !b.disabled);
  if (first) { first.classList.add('on'); seg.dispatchEvent(new (row.ownerDocument.defaultView.Event)('click', { bubbles: true })); }
}

function wireEditor(doc, root, registry) {
  const metaOf = (key) => registry.find((m) => m.key === key);
  root.addEventListener('click', (e) => {
    const kindBtn = e.target.closest && e.target.closest('.tp-kind-btn');
    if (kindBtn && !kindBtn.disabled) {
      const seg = kindBtn.closest('.tp-kind-seg');
      seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === kindBtn));
      root.dispatchEvent(new (doc.defaultView.Event)('tp-change', { bubbles: true }));
      return;
    }
    const unset = e.target.closest && e.target.closest('.tp-unset');
    if (unset) {
      const row = unset.closest('.tp-edit-row');
      row.querySelectorAll('.tp-kind-btn').forEach((b) => b.classList.remove('on'));
      const meta = metaOf(row.dataset.key);
      if (meta.type === 'string[]' || meta.type === 'plugins' || meta.type === 'steps') { writeItems(row, []); listChips(doc, row, [], chipLabel(meta)); }
      else if (meta.type === 'bool') { const cb = row.querySelector('.tp-val'); cb.checked = false; cb.dispatchEvent(new (doc.defaultView.Event)('change')); }
      else { const v = row.querySelector('.tp-val'); if (v) v.value = ''; const n = row.querySelector('.tp-null'); if (n) n.checked = false; }
      root.dispatchEvent(new (doc.defaultView.Event)('tp-change', { bubbles: true }));
      return;
    }
    const rm = e.target.closest && e.target.closest('.tp-chip-rm');
    if (rm) {
      const row = rm.closest('.tp-edit-row'); const meta = metaOf(row.dataset.key);
      const items = readItems(row); items.splice(Number(rm.dataset.index), 1);
      writeItems(row, items); listChips(doc, row, items, chipLabel(meta));
      root.dispatchEvent(new (doc.defaultView.Event)('tp-change', { bubbles: true }));
      return;
    }
    const add = e.target.closest && e.target.closest('.tp-add-btn');
    if (add) {
      const row = add.closest('.tp-edit-row'); const meta = metaOf(row.dataset.key);
      const items = readItems(row);
      if (meta.type === 'plugins') {
        const name = row.querySelector('.tp-plugin-name').value.trim();
        if (!name) return;
        const it = { name };
        const mkt = row.querySelector('.tp-plugin-marketplace').value.trim(); if (mkt) it.marketplace = mkt;
        const min = row.querySelector('.tp-plugin-min').value.trim(); if (min) it.minVersion = min;
        items.push(it);
        row.querySelector('.tp-plugin-name').value = ''; row.querySelector('.tp-plugin-marketplace').value = ''; row.querySelector('.tp-plugin-min').value = '';
      } else if (meta.type === 'steps') {
        const role = row.querySelector('.tp-step-role').value.trim();
        if (!role) return;
        const it = { role, model: row.querySelector('.tp-step-model').value.trim(), effort: row.querySelector('.tp-step-effort').value };
        const i = items.findIndex((x) => x.role === role); if (i >= 0) items[i] = it; else items.push(it);
        row.querySelector('.tp-step-role').value = ''; row.querySelector('.tp-step-model').value = ''; row.querySelector('.tp-step-effort').value = '';
      } else {
        const val = row.querySelector('.tp-add').value.trim();
        if (!val || items.includes(val)) return;
        items.push(val); row.querySelector('.tp-add').value = '';
      }
      writeItems(row, items); listChips(doc, row, items, chipLabel(meta));
      ensureKind(row);
      root.dispatchEvent(new (doc.defaultView.Event)('tp-change', { bubbles: true }));
    }
  });
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const inp = e.target.closest && e.target.closest('.tp-add-row input');
    if (!inp) return;
    e.preventDefault();
    inp.closest('.tp-add-row').querySelector('.tp-add-btn').click();
  });
  root.addEventListener('input', (e) => {
    const row = e.target.closest && e.target.closest('.tp-edit-row');
    if (!row || !(e.target.classList.contains('tp-val') || e.target.classList.contains('tp-null'))) return;
    ensureKind(row);
    root.dispatchEvent(new (doc.defaultView.Event)('tp-change', { bubbles: true }));
  });
  root.addEventListener('change', (e) => {
    const row = e.target.closest && e.target.closest('.tp-edit-row');
    if (row && (e.target.classList.contains('tp-val') || e.target.classList.contains('tp-null'))) ensureKind(row);
    if (e.target.closest && (e.target.closest('.tp-edit-row') || e.target.closest('.tp-doc-head') || e.target.closest('.tp-catalogs'))) {
      root.dispatchEvent(new (doc.defaultView.Event)('tp-change', { bubbles: true }));
    }
  });
}

/**
 * The editor (board 5): one card per registry group, a collapsed "For workspace runs" card,
 * the catalogs, a sticky publish bar. `registry` is the FIELDS list served by GET /api/policy.
 */
export function renderPolicyEditor(policyDoc, { registry = [], doc = globalThis.document } = {}) {
  const src = policyDoc || {};
  const root = h(doc, 'div', 'tp-editor');
  root.dataset.original = JSON.stringify(canonicalDoc(src));
  const headCard = h(doc, 'section', 'card tp-doc-head');
  const hh = h(doc, 'div', 'card-head'); hh.append(h(doc, 'h2', null, 'Policy'), h(doc, 'small', 'hint', 'Soft caps pause and can be continued past; defaults only start a developer off.'));
  headCard.append(hh);
  const tf = h(doc, 'div', 'field field-compact'); const tl = h(doc, 'label', null, 'Title'); tl.htmlFor = 'tp-title';
  const ti = h(doc, 'input', 'input tp-title'); ti.id = 'tp-title'; ti.type = 'text'; ti.value = src.title || ''; ti.placeholder = 'e.g. Gateway team policy';
  tf.append(tl, ti);
  const nf = h(doc, 'div', 'field field-compact'); const nl = h(doc, 'label', null, 'Notes'); nl.htmlFor = 'tp-notes';
  const na = h(doc, 'textarea', 'textarea tp-notes'); na.id = 'tp-notes'; na.rows = 2; na.value = src.notes || ''; na.placeholder = 'Who to ask before raising anything, what the caps are for…';
  nf.append(nl, na);
  headCard.append(tf, nf);
  root.append(headCard);
  const groups = [];
  for (const m of registry) if (!groups.includes(m.group)) groups.push(m.group);
  for (const g of groups) {
    const card = h(doc, 'section', 'card tp-group-card'); card.dataset.group = g;
    const head = h(doc, 'div', 'card-head'); head.append(h(doc, 'h2', null, GROUP_LABELS[g] || g));
    if (g === 'cost') head.append(h(doc, 'small', 'hint', 'Caps apply per developer. Soft caps pause and can be continued past.'));
    if (g === 'plugins') head.append(h(doc, 'small', 'hint', 'Worca offers to install; it never installs without the developer\'s consent.'));
    if (g === 'models') head.append(h(doc, 'small', 'hint', 'Catalog entries may use ${VAR} for tokens. Literal secrets are refused.'));
    card.append(head);
    for (const m of registry.filter((x) => x.group === g)) card.append(editorRow(doc, m, src.fields?.[m.key] || null, 'fields'));
    root.append(card);
  }
  const ws = h(doc, 'details', 'card tp-ws-card');
  const sum = h(doc, 'summary'); sum.append(h(doc, 'b', null, 'For workspace runs'), ' ', h(doc, 'small', 'hint', 'Values here replace the ones above for pipelines that target a workspace following this home. Empty = same as above.'));
  ws.append(sum);
  const wsFields = Object.keys(src.workspaceRuns || {});
  if (wsFields.length) ws.open = true;
  for (const m of registry.filter((x) => !x.advisory && x.key !== 'plugins.marketplaces' && x.key !== 'plugins.required' && x.key !== 'plugins.blocked' && x.key !== 'worca.minVersion' && x.key !== 'metrics.record')) {
    ws.append(editorRow(doc, m, src.workspaceRuns?.[m.key] || null, 'workspaceRuns'));
  }
  root.append(ws);
  const cat = h(doc, 'details', 'card tp-catalogs');
  const cs = h(doc, 'summary'); cs.append(h(doc, 'b', null, 'Catalogs (advanced)'), ' ', h(doc, 'small', 'hint', 'Guardrail sets and model entries this policy ships to every teammate, as JSON.'));
  cat.append(cs);
  const gf = h(doc, 'div', 'field field-compact'); const gl = h(doc, 'label', null, 'Guardrail sets'); gl.htmlFor = 'tp-cat-guardrails';
  const ga = h(doc, 'textarea', 'textarea mono tp-catalog-guardrails'); ga.id = 'tp-cat-guardrails'; ga.rows = 6; ga.value = JSON.stringify(src.catalogs?.guardrailSets || [], null, 2);
  gf.append(gl, ga, h(doc, 'small', 'hint', '[{ "id", "name", "honorProjectSettings", "envScrub", "envAllowlist": [], "protectedPaths": [], "deny": [] }]'));
  const mf = h(doc, 'div', 'field field-compact'); const ml = h(doc, 'label', null, 'Models'); ml.htmlFor = 'tp-cat-models';
  const ma = h(doc, 'textarea', 'textarea mono tp-catalog-models'); ma.id = 'tp-cat-models'; ma.rows = 6; ma.value = JSON.stringify(src.catalogs?.models || [], null, 2);
  mf.append(ml, ma, h(doc, 'small', 'hint', '[{ "id", "label", "efforts": [], "env": { "ANTHROPIC_BASE_URL": "…", "ANTHROPIC_AUTH_TOKEN": "${VAR}" } }]'));
  cat.append(gf, mf);
  root.append(cat);
  const bar = h(doc, 'div', 'tp-publish-bar');
  const grow = h(doc, 'span', 'grow'); grow.append(h(doc, 'span', 'tp-change-count', 'no changes'), ' · ');
  const vj = h(doc, 'button', 'linkish tp-view-json', 'View JSON'); vj.type = 'button';
  const cj = h(doc, 'button', 'linkish tp-copy-json', 'Copy for a pull request'); cj.type = 'button';
  grow.append(vj, ' · ', cj);
  const discard = h(doc, 'button', 'btn btn-ghost btn-mini tp-discard', 'Discard'); discard.type = 'button';
  const publish = h(doc, 'button', 'btn btn-primary btn-mini tp-publish', 'Publish to worca-policy'); publish.type = 'button'; publish.disabled = true;
  bar.append(grow, discard, publish);
  root.append(bar);
  const pre = h(doc, 'pre', 'tp-json mono'); pre.hidden = true; root.append(pre);
  const msg = h(doc, 'p', 'form-msg tp-msg'); msg.setAttribute('aria-live', 'polite'); root.append(msg);
  wireEditor(doc, root, registry);
  vj.addEventListener('click', () => { pre.hidden = !pre.hidden; if (!pre.hidden) pre.textContent = JSON.stringify(docFromEditor(root, { registry }), null, 2); });
  const refresh = () => {
    const dirty = editorDirty(root, src, { registry });
    root.querySelector('.tp-change-count').textContent = dirty ? `${changedKeys(root, src, { registry })} change${changedKeys(root, src, { registry }) === 1 ? '' : 's'}` : 'no changes';
    publish.disabled = !dirty;
    if (!pre.hidden) pre.textContent = JSON.stringify(docFromEditor(root, { registry }), null, 2);
  };
  root.addEventListener('tp-change', refresh);
  ti.addEventListener('input', refresh); na.addEventListener('input', refresh); ga.addEventListener('input', refresh); ma.addEventListener('input', refresh);
  return root;
}

function rowValue(row, meta) {
  switch (meta.type) {
    case 'usd': case 'int': { const s = row.querySelector('.tp-val').value.trim(); if (s === '') return undefined; const n = Number(s); return Number.isFinite(n) ? (meta.type === 'int' ? Math.round(n) : n) : undefined; }
    case 'usd-or-null': { if (row.querySelector('.tp-null')?.checked) return null; const s = row.querySelector('.tp-val').value.trim(); if (s === '') return undefined; const n = Number(s); return Number.isFinite(n) ? n : undefined; }
    case 'bool': return !!row.querySelector('.tp-val').checked;
    case 'enum': return row.querySelector('.tp-val').value;
    case 'string': case 'semver': { const s = row.querySelector('.tp-val').value.trim(); return s === '' ? undefined : s; }
    case 'string[]': return readItems(row);
    case 'plugins': return readItems(row);
    case 'steps': { const out = {}; for (const it of readItems(row)) { const s = {}; if (it.model) s.model = it.model; if (it.effort) s.effort = it.effort; out[it.role] = s; } return out; }
    default: return undefined;
  }
}

/** The DOM read back into a policy document. Rows without a kind are omitted; empty lists are omitted. */
export function docFromEditor(root, { registry = [] } = {}) {
  const metaOf = (key) => registry.find((m) => m.key === key) || { type: root.querySelector(`.tp-edit-row[data-key="${key}"]`)?.dataset.type };
  const out = { schema: 1, title: root.querySelector('.tp-title')?.value.trim() || '', notes: root.querySelector('.tp-notes')?.value.trim() || '', fields: {}, workspaceRuns: {}, catalogs: { guardrailSets: [], models: [] } };
  for (const row of root.querySelectorAll('.tp-edit-row')) {
    const kind = row.querySelector('.tp-kind-seg .on')?.dataset.kind;
    if (!kind) continue;
    const meta = metaOf(row.dataset.key);
    const value = rowValue(row, meta);
    if (value === undefined) continue;
    if ((meta.type === 'string[]' || meta.type === 'plugins') && !value.length) continue;
    if (meta.type === 'steps' && !Object.keys(value).length) continue;
    const entry = { kind, value };
    if (meta.cap && kind === 'soft') {
      const ob = row.querySelector('.tp-onbreach-sel')?.value; if (ob) entry.onBreach = ob;
      if (row.querySelector('.tp-require-reason')?.checked) entry.requireReason = true;
    }
    if (meta.advisory) { const w = row.querySelector('.tp-window-sel')?.value; if (w) entry.window = w; }
    out[row.dataset.scope === 'workspaceRuns' ? 'workspaceRuns' : 'fields'][row.dataset.key] = entry;
  }
  const parse = (sel) => { try { const v = JSON.parse(root.querySelector(sel)?.value || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
  out.catalogs.guardrailSets = parse('.tp-catalog-guardrails');
  out.catalogs.models = parse('.tp-catalog-models');
  return out;
}

function canonicalDoc(d) {
  return { title: d?.title || '', notes: d?.notes || '', fields: d?.fields || {}, workspaceRuns: d?.workspaceRuns || {}, catalogs: { guardrailSets: d?.catalogs?.guardrailSets || [], models: d?.catalogs?.models || [] } };
}
export function editorDirty(root, original, { registry = [] } = {}) {
  return JSON.stringify(canonicalDoc(docFromEditor(root, { registry }))) !== JSON.stringify(canonicalDoc(original));
}
function changedKeys(root, original, { registry = [] } = {}) {
  const a = canonicalDoc(docFromEditor(root, { registry })); const b = canonicalDoc(original);
  let n = 0;
  for (const scope of ['fields', 'workspaceRuns']) {
    const keys = new Set([...Object.keys(a[scope]), ...Object.keys(b[scope])]);
    for (const k of keys) if (JSON.stringify(a[scope][k]) !== JSON.stringify(b[scope][k])) n += 1;
  }
  if (a.title !== b.title) n += 1;
  if (a.notes !== b.notes) n += 1;
  if (JSON.stringify(a.catalogs) !== JSON.stringify(b.catalogs)) n += 1;
  return n;
}

// ---- Workspace card line (board 6) ----------------------------------------------------------
export function renderWsPolicyLine(w, { doc = globalThis.document } = {}) {
  const root = h(doc, 'div', 'ws-policy-inner');
  const home = w.home || { state: 'unset' };
  root.append(h(doc, 'span', 'tm-label', 'Team policy'));
  const line = h(doc, 'span', 'ws-policy-line');
  if (home.state === 'unset') {
    line.append(h(doc, 'span', 'muted', 'no policy home'));
  } else if (home.state !== 'ok') {
    line.append(dot(doc, 'red'), ' ', h(doc, 'span', 'ws-sum-bad', home.detail || 'the policy home is stale'));
  } else {
    line.append(dot(doc, 'green'), ' follows ', code(doc, home.slug));
    // The home is a member that itself follows another project: say through which one.
    if (home.follows) line.append(' via ', code(doc, home.follows));
    // Only what the workspaceRuns block changes, by name (board 6); every other field is the
    // same as for project runs, so it is not repeated here.
    const changed = Array.isArray(home.workspaceRuns) ? home.workspaceRuns : [];
    if (changed.length) {
      const LABEL = { 'cost.pipelineLimitUsd': 'pipeline cap', 'cost.totalLimitUsd': 'total cap', 'guardrails.default': 'guardrails' };
      line.append(' · for workspace runs: ', changed.map((x) => `${LABEL[x.key] || x.label.replace(/ \(USD\)$/, '').toLowerCase()} ${x.display}`).join(', '));
    } else line.append(' · same values as project runs');
  }
  root.append(line);
  const actions = h(doc, 'span', 'ws-tbl-actions');
  if (home.state === 'ok') actions.append(btn(doc, 'wsp-open', 'Open policy'));
  if (home.state === 'ok' && (w.members || []).some((m) => m.state === 'none')) actions.append(btn(doc, 'wsp-route', 'Route all to policy home'));
  actions.append(btn(doc, 'wsp-home-change', home.state === 'unset' ? 'Choose policy home…' : 'Change policy home…'));
  root.append(actions);
  if (home.state === 'unset') root.append(h(doc, 'small', 'hint ws-home-hint', 'Workspace runs use your local settings until a policy home is chosen. The home is a per-machine choice; it defaults to the metrics home.'));
  root.append(h(doc, 'div', 'ws-policy-results'));
  return root;
}

// ---- Settings readout + chip (board 7) --------------------------------------------------------
export function renderTeamCapsReadout(homes, { doc = globalThis.document } = {}) {
  const list = (homes || []).filter((x) => x && x.slug && x.caps && (x.caps.pipeline || x.caps.total || x.caps.resetPeriod));
  if (!list.length) return null;
  const root = h(doc, 'div', 'team-readout');
  const lead = h(doc, 'span'); lead.append(h(doc, 'b', null, 'Team caps also apply'), ', per project. The tighter value wins; you can continue past a team cap when a run pauses.');
  root.append(lead);
  for (const x of list) {
    const row = h(doc, 'span', 'team-readout-row');
    row.append(h(doc, 'span', 'badge blue', x.slug), ' ');
    const parts = [];
    if (x.caps.pipeline) { const b = h(doc, 'b', 'mono', usd(x.caps.pipeline.value)); const s = h(doc, 'span'); s.append('pipeline ', b, ` (${x.caps.pipeline.kind})`); parts.push(s); }
    if (x.caps.total) { const b = h(doc, 'b', 'mono', usd(x.caps.total.value)); const s = h(doc, 'span'); s.append('total ', b, `/${(x.caps.resetPeriod || 'monthly') === 'weekly' ? 'week' : 'month'} (${x.caps.total.kind})`); parts.push(s); }
    parts.forEach((p, i) => { if (i) row.append(' · '); row.append(p); });
    const others = (x.usedBy || []).filter((s) => s !== x.slug);
    if (others.length) { row.append(' · also used by '); row.append(code(doc, others.join(', '))); }
    root.append(row);
  }
  const link = h(doc, 'a', 'linkish tp-open-page', 'Open Team policy →'); link.href = '#team-policy';
  const l = h(doc, 'span'); l.append(link); root.append(l);
  return root;
}

export function renderTeamChip({ kind, display }, { doc = globalThis.document } = {}) {
  const c = h(doc, 'span', 'team-chip');
  c.append(h(doc, 'span', 'kind', kind), ` team ${display}`);
  return c;
}

// ---- New pipeline notes line (board 8) ----------------------------------------------------------
export function renderPolicyNotesLine({ policy, notes = [] }, { doc = globalThis.document } = {}) {
  const root = h(doc, 'div', 'policy-line');
  const head = h(doc, 'div', 'pl-head-row');
  head.append(h(doc, 'span', 'badge blue', 'team policy'), h(doc, 'b', null, policy?.home || '—'));
  const n = notes.length;
  head.append(h(doc, 'span', 'muted', n ? ` · ${n} note${n === 1 ? '' : 's'} · nothing here blocks the run` : ' · nothing to note'));
  root.append(head);
  for (const note of notes) {
    const row = h(doc, 'div', `pl-note${note.level === 'warn' ? ' warn' : ''}`);
    row.append(dot(doc, note.level === 'warn' ? 'amber' : 'grey'), h(doc, 'span', null, note.text));
    root.append(row);
  }
  const caps = capText(policy?.caps);
  const pooled = policy?.caps?.pooled ? `pooled budget ${usd(policy.caps.pooled.value)} / ${policy.caps.pooled.window}` : '';
  if (caps || pooled) {
    const row = h(doc, 'div', 'pl-note');
    row.append(dot(doc, 'grey'), h(doc, 'span', null, [caps, pooled].filter(Boolean).join(' · ')));
    root.append(row);
  }
  return root;
}

// ---- Team-cap pause banner (board 9) --------------------------------------------------------------
export function renderTeamCapPauseBanner(rec, { doc = globalThis.document, budget = null } = {}) {
  const total = rec.pauseReason === 'cost_total_policy';
  const el = h(doc, 'div', `cost-banner cb-policy ${total ? 'cb-policy-total' : 'cb-policy-pipeline'}`);
  el.append(h(doc, 'b', null, total ? 'Paused — team total cap reached' : 'Paused — team cost cap reached'));
  const text = h(doc, 'div', 'cb-text');
  // The harness detail carries the numbers and the home: "team cost cap reached ($11.40 >= $10.00, acme/gateway)"
  // or "team total cap reached ($160.00 >= $150.00 this month, acme/gateway)".
  const m = /\(\$([\d.,]+) >= \$([\d.,]+)(?: this (week|month))?, ([^)]+)\)/.exec(String(rec.pauseDetail || ''));
  const mono = (v) => h(doc, 'span', 'mono', `$${v}`);
  const b = budget || {};
  if (m) {
    const [, spent, cap, period, home] = m;
    if (total) {
      text.append('Estimated spend is ', mono(spent), ` this ${period || 'period'}, past the `, mono(cap), ' total cap set by ', h(doc, 'span', 'cb-home', home), "'s team policy.");
      if (b.totalLimitUsd != null) text.append(' Your own total limit ', mono(Number(b.totalLimitUsd).toFixed(2)), ' still applies.');
      text.append(' You can continue past the team cap once for this period; the overshoot is recorded to team metrics.');
    } else {
      text.append("This pipeline's estimated cost hit ", mono(spent), ', the per-pipeline cap of ', mono(cap), ' set by ', h(doc, 'span', 'cb-home', home), "'s team policy.");
      if (b.pipelineLimitUsd != null) text.append(' Your own limit is ', mono(Number(b.pipelineLimitUsd).toFixed(2)), '.');
      text.append(' You can continue past the team cap for this pipeline; the overshoot is recorded to team metrics.');
    }
  } else {
    text.append(total
      ? 'This is the total cap set by the team policy for this period; your own limits still apply. You can continue past it once for this period; the overshoot is recorded to team metrics.'
      : "This is the per-pipeline cap set by the team policy; your own limits still apply. You can continue past it for this pipeline; the overshoot is recorded to team metrics.");
  }
  el.append(text);
  const actions = h(doc, 'div', 'cb-actions');
  const open = h(doc, 'button', 'btn btn-mini cb-policy-open', 'Open Team policy'); open.type = 'button';
  const past = h(doc, 'button', 'btn btn-primary btn-mini cb-past-team-cap', total ? 'Continue past team cap (this period)' : 'Continue past team cap (this pipeline)'); past.type = 'button';
  past.dataset.pipelineId = rec.pipelineId || '';
  actions.append(open, past);
  el.append(actions);
  return el;
}

// ---- Plugins page strip + setup checklist (boards 10, 11) ---------------------------------------
export function renderRequiredStrip(requirements = [], blockedPlugins = [], { doc = globalThis.document } = {}) {
  const off = (requirements || []).filter((r) => r.state !== 'ok');
  const blocked = blockedPlugins || [];
  if (!off.length && !blocked.length) return null;
  const root = h(doc, 'div', 'pl-required-list');
  for (const r of off) {
    const strip = h(doc, 'div', 'pl-required');
    strip.dataset.name = r.name;
    strip.append(h(doc, 'span', 'badge blue', 'team policy'));
    const text = h(doc, 'span');
    text.append(h(doc, 'b', null, r.homes.join(', ')), ' expects ', h(doc, 'b', null, `${r.name}${r.minVersion ? ` ≥ ${r.minVersion}` : ''}`),
      r.state === 'missing' ? ', not installed.' : r.state === 'disabled' ? ', which is disabled.' : `, installed ${r.installed?.version || '?'}.`);
    strip.append(text);
    if (r.state === 'missing') { const b = btn(doc, 'pl-policy-install', `Install ${r.name}…`, true); b.dataset.name = r.name; b.dataset.marketplace = r.marketplace || ''; strip.append(b); }
    else if (r.state === 'outdated') { const b = btn(doc, 'pl-policy-update', `Update ${r.name}…`, true); b.dataset.name = r.name; strip.append(b); }
    else if (r.state === 'disabled') strip.append(h(doc, 'small', 'hint', 'enable it below'));
    root.append(strip);
  }
  for (const b of blocked) {
    const strip = h(doc, 'div', 'pl-required pl-blocked');
    strip.append(h(doc, 'span', 'badge blue', 'team policy'));
    const text = h(doc, 'span'); text.append(h(doc, 'b', null, b.home), ' blocks ', h(doc, 'b', null, b.name), ', which is enabled here. Runs proceed and are recorded as off-policy.');
    strip.append(text);
    root.append(strip);
  }
  const setup = btn(doc, 'pl-policy-setup', 'Set up…');
  root.append(setup);
  return root;
}

export function renderSetupChecklist({ home, requirements = [], seeds = [], trusted = false }, { doc = globalThis.document } = {}) {
  const root = h(doc, 'div', 'tp-setup');
  root.append(h(doc, 'div', 'hint', 'The policy expects the items below on this machine. Nothing here runs without your click, and nothing blocks a run while an item is open.'));
  const list = h(doc, 'div', 'tp-setup-list');
  const row = (tone, main, sub, action) => {
    const r = h(doc, 'div', 'tp-setup-row');
    r.append(dot(doc, tone));
    const t = h(doc, 'span', 'tp-setup-text'); t.append(main); if (sub) t.append(h(doc, 'small', 'hint', sub));
    r.append(t);
    if (action) r.append(action);
    list.append(r);
    return r;
  };
  for (const s of seeds) row(s.added ? 'green' : 'amber', (() => { const m = h(doc, 'span'); m.append(h(doc, 'b', null, s.added ? 'Marketplace added ' : 'Marketplace to add '), code(doc, s.url)); return m; })(), s.error || null, s.added ? h(doc, 'span', 'badge green', 'done') : null);
  for (const r of requirements) {
    const label = h(doc, 'span'); label.append(h(doc, 'b', null, r.state === 'outdated' ? `Update ${r.name}` : r.state === 'ok' ? `${r.name} installed` : `Install ${r.name}`), r.minVersion ? ` ≥ ${r.minVersion}` : '', r.marketplace ? ` from ${r.marketplace}` : '');
    let action = null;
    if (r.state === 'missing') { action = btn(doc, 'pl-policy-install', 'Install…', true); action.dataset.name = r.name; action.dataset.marketplace = r.marketplace || ''; }
    else if (r.state === 'outdated') { action = btn(doc, 'pl-policy-update', 'Update…'); action.dataset.name = r.name; }
    else if (r.state === 'ok') action = h(doc, 'span', 'badge green', 'done');
    else if (r.state === 'disabled') action = h(doc, 'span', 'badge amber', 'disabled');
    row(r.state === 'ok' ? 'green' : 'amber', label, r.state === 'outdated' ? `installed ${r.installed?.version || '?'} · opens the update preview: commits, diffstat, manifest changes` : r.state === 'missing' ? 'opens the consent inventory: source, SHA, agents, tools' : null, action);
    if (r.config) {
      const cfg = h(doc, 'span'); cfg.append(h(doc, 'b', null, `Configure ${r.name}`), ` · ${Object.keys(r.config).join(', ')} seeded by the policy; secrets are yours to enter`);
      const c = btn(doc, 'pl-policy-configure', 'Configure…'); c.dataset.name = r.name; c.disabled = r.state === 'missing';
      row('grey', cfg, null, c);
    }
  }
  if (!seeds.length && !requirements.length) list.append(h(doc, 'div', 'hist-empty', 'Nothing to set up.'));
  root.append(list);
  const trust = h(doc, 'label', 'switch-row tp-trust-row');
  const cb = h(doc, 'input', 'sw-input tp-trust'); cb.type = 'checkbox'; cb.checked = !!trusted; cb.dataset.home = home || '';
  const txt = h(doc, 'span', 'txt'); txt.append(h(doc, 'b', null, 'Trust this policy home'), h(doc, 'small', 'hint', `Install and update required plugins from ${home || 'this home'} automatically on this machine, without this checklist. Plugins run with your user privileges. You can turn this off on the Plugins page at any time.`));
  trust.append(cb, h(doc, 'span', 'switch switch-sm'), txt);
  root.append(trust);
  const actions = h(doc, 'div', 'confirm-actions');
  const later = h(doc, 'button', 'btn btn-ghost btn-mini tp-later', 'Later'); later.type = 'button';
  const all = h(doc, 'button', 'btn btn-primary btn-mini tp-install-all', 'Install all…'); all.type = 'button';
  all.disabled = !requirements.some((r) => r.state === 'missing' || r.state === 'outdated');
  actions.append(later, all);
  root.append(actions);
  return root;
}

export function renderPolicyBadgeFor(origin, { doc = globalThis.document } = {}) {
  const b = h(doc, 'span', 'badge blue tp-origin', 'policy');
  if (origin) b.title = `from the team policy on ${origin}`;
  return b;
}
