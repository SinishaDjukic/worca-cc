// ui/public/pr-auto-view.mjs
// "Create a PR when a run finishes" in the browser: the New run form's two fields, the read-only line on a run's page,
// the Workspace page's setting and the Schedules row. app.js only calls these; the logic lives here.

import { PR_OPEN, PR_OPEN_LABELS, PR_SLICES, PR_SLICES_LABELS, prSourceText, prExemptText } from '../../src/shared/pr-auto.mjs';
import { notify, cardAlert } from './feedback.mjs';

const node = (doc, tag, cls, text) => { const el = doc.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; };
const optionOf = (doc, value, label) => { const el = node(doc, 'option', null, label); el.value = value; return el; };
const jsonOf = async (response) => { try { return await response.json(); } catch { return null; } };

/** "Create a draft PR · A PR per slice, stacked" for the Schedules details; '' when the request carries none. */
export function prRowText(pr) {
  if (!pr) return '';
  return [PR_OPEN_LABELS[pr.open], PR_SLICES_LABELS[pr.slices]].filter(Boolean).join(' · ');
}

/** The form's values and their sources: the scope's (GET /api/run-defaults `pr`), over which an applied preset's values
 *  (source "run": the preset is the person's own choice) are laid. `slices` is null where it does not apply. */
export function prFormState(runDefaults, presetPr = null) {
  const base = runDefaults && runDefaults.pr ? runDefaults.pr : { open: { value: 'none', source: 'default' }, slices: null };
  const open = presetPr && PR_OPEN.includes(presetPr.open) ? { value: presetPr.open, source: 'run' } : base.open;
  const slices = base.slices ? (presetPr && PR_SLICES.includes(presetPr.slices) ? { value: presetPr.slices, source: 'run' } : base.slices) : null;
  return { open, slices };
}

/** The `pr` a start sends: only the keys the person changed from the prefilled scope value, so the saved source says
 *  truthfully whether the value came from the run or the setting. undefined when nothing changed. */
export function prBodyOf(current, defaults, { slicesShown = false } = {}) {
  const base = defaults && defaults.pr ? defaults.pr : null;
  if (!base) return undefined;   // the scope's value is unknown: there is nothing to differ from
  const out = {};
  if (current.open && PR_OPEN.includes(current.open) && current.open !== base.open.value) out.open = current.open;
  if (slicesShown && current.slices && PR_SLICES.includes(current.slices) && base.slices && current.slices !== base.slices.value) out.slices = current.slices;
  return Object.keys(out).length ? out : undefined;
}

const OUTCOME_TEXT = {
  opened: (o) => ({ prefix: 'Opened: ', urls: o.urls || [] }),
  skipped: (o) => ({ prefix: 'Not opened: ', text: o.reason || '' }),
  failed: (o) => ({ prefix: 'Not opened: ', text: o.reason || '' }),
  blocked: (o) => ({ prefix: 'Not opened: ', text: o.reason || '' }),
  held: () => ({ prefix: '', text: 'Waiting for the requirements to be marked' }),
  waiting: () => ({ prefix: '', text: 'Waiting for the feature' }),
};

/** The run's saved decision, read-only: the value and where it came from, then what happened. @returns {HTMLElement} div.hd-pr-auto */
export function renderRunPrFact(doc, prAuto) {
  const box = node(doc, 'div', 'hd-pr-auto');
  if (!prAuto) return box;
  if (prAuto.exempt) { box.append(node(doc, 'span', 'hd-pr-auto-value', prExemptText(prAuto.exempt))); return box; }
  const source = prAuto.feature ? `${prSourceText('feature')} (${prSourceText(prAuto.feature.source?.open)})` : prSourceText(prAuto.source?.open);
  const parts = [PR_OPEN_LABELS[prAuto.open] || prAuto.open];
  if (prAuto.feature && prAuto.slices && prAuto.open !== 'none') parts.push(PR_SLICES_LABELS[prAuto.slices]);
  box.append(node(doc, 'span', 'hd-pr-auto-value', `${parts.join(' · ')} · ${source}`));
  const outcome = (prAuto.slices === 'one' && prAuto.feature && prAuto.feature.outcome) || prAuto.outcome;
  const shown = outcome && OUTCOME_TEXT[outcome.status] ? OUTCOME_TEXT[outcome.status](outcome) : null;
  if (shown && prAuto.open !== 'none') {
    const line = node(doc, 'div', `hd-pr-auto-outcome ${outcome.status}`, shown.prefix);
    if (shown.urls) for (const [i, url] of shown.urls.entries()) {
      if (i) line.append(', ');
      if (!/^https?:\/\//i.test(url)) { line.append(String(url)); continue; }
      const a = node(doc, 'a', null, url); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; line.append(a);
    } else line.append(shown.text);
    box.append(line);
  }
  return box;
}

const KNOWN = new Map();   // `${id}:${status}` -> { at, prAuto }; a terminal answer stays, anything else is asked again after a few seconds
const RECHECK_MS = 4000;
const KNOWN_MAX = 200;
const TERMINAL = { run: ['opened', 'failed', 'skipped'], feature: ['opened', 'blocked', 'failed', 'skipped'] };
const isTerminal = (prAuto) => {
  if (!prAuto) return false;
  const feature = prAuto.slices === 'one' && prAuto.feature ? prAuto.feature.outcome : null;
  if (feature) return TERMINAL.feature.includes(feature.status);
  const own = prAuto.outcome;
  if (!own || own.final === false) return false;
  return TERMINAL.run.includes(own.status);
};
/** Fill a run page's "Pull request" fact row. Re-checks isCurrent() after the await, like the other painters. */
export async function paintRunPrAuto(row, id, status, isCurrent, { fetchFn = (url) => fetch(url), now = () => Date.now() } = {}) {
  if (!row || !id) return;
  const key = `${id}:${status || ''}`;
  let hit = KNOWN.get(key);
  if (!hit || (!isTerminal(hit.prAuto) && now() - hit.at > RECHECK_MS)) {
    if (row.dataset.prAutoFor !== id) { row.querySelector('.rd-kv-v')?.replaceChildren(); row.hidden = true; }
    let data = null;
    try { const r = await fetchFn(`/api/pipelines/${encodeURIComponent(id)}/pr-auto`); data = r.ok ? await jsonOf(r) : null; } catch { data = null; }
    if (!data) return;
    hit = { at: now(), prAuto: data.prAuto || null };
    KNOWN.set(key, hit);
    if (KNOWN.size > KNOWN_MAX) KNOWN.delete(KNOWN.keys().next().value);
  }
  if (!isCurrent()) return;
  const value = row.querySelector('.rd-kv-v');
  if (!value) return;
  value.replaceChildren(...(hit.prAuto ? [renderRunPrFact(row.ownerDocument, hit.prAuto)] : []));
  row.hidden = !hit.prAuto;
  row.dataset.prAutoFor = id;
}

/** The Workspace page's row: the workspace's own pr.open, with what applies and from where. */
export async function mountWorkspacePrSetting(host, { workspaceId, fetchFn = (url, options) => fetch(url, options) }) {
  const doc = host.ownerDocument;
  const url = `/api/workspaces/${encodeURIComponent(workspaceId)}/settings`;
  host.classList.add('pd-settings-card', 'wd-pr-setting');
  const paint = (data) => {
    host.replaceChildren();
    const effective = data.effective['pr.open'];
    const row = node(doc, 'div', 'field drow');
    const label = node(doc, 'label', 'drow-label', 'Create a PR when a run finishes');
    const select = node(doc, 'select', 'select');
    select.append(optionOf(doc, '', 'Use team policy / Worca default'), ...PR_OPEN.map((v) => optionOf(doc, v, PR_OPEN_LABELS[v])));
    select.value = data.own['pr.open'] || '';
    const hint = node(doc, 'small', 'hint drow-help', `Now: ${PR_OPEN_LABELS[effective.value]} (${prSourceText(effective.source)})`);
    const save = node(doc, 'button', 'btn btn-primary btn-sm', 'Save'); save.type = 'button';
    row.append(label, node(doc, 'div', 'select-wrap', null), hint);
    row.querySelector('.select-wrap').append(select);
    host.append(node(doc, 'h3', null, 'Pull requests'), row, save);
    save.addEventListener('click', async () => {
      cardAlert(host, null);
      let response; let body;
      try {
        response = await fetchFn(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ 'pr.open': select.value || null }) });
        body = await jsonOf(response);
      } catch (error) { cardAlert(host, { title: 'Not saved', detail: error?.message || 'Worca did not answer.' }); return; }
      if (!response.ok) { cardAlert(host, { title: 'Not saved', detail: body?.error || `The server answered ${response.status}.` }); return; }
      paint(body);
      notify({ tone: 'ok', title: 'Saved', detail: 'New runs of this workspace use it.' }, { doc });
    });
  };
  try {
    const response = await fetchFn(url);
    const data = response.ok ? await jsonOf(response) : null;
    if (data && data.effective) paint(data); else host.hidden = true;
  } catch { host.hidden = true; }
}

/**
 * The New run form's two fields (#prOpen / #prSlices in new.html). `getTarget()` → { kind: 'project'|'workspace'|'none',
 * projectDir, workspaceId }. refresh() reads the scope's value for the current target and prefills it (a field the person
 * touched keeps their pick until the target changes); body() is the `pr` a start sends; apply(pr) lays a preset over it.
 */
export function createRunPrFields({ doc, getTarget, fetchFn = (url) => fetch(url), onChange = () => {} }) {
  const open = doc.getElementById('prOpen');
  const slices = doc.getElementById('prSlices');
  if (!open || !slices) return { refresh: async () => {}, body: () => undefined, apply: () => {} };
  const openRow = doc.getElementById('pr-open-row'); const slicesRow = doc.getElementById('pr-slices-row');
  const openSource = doc.getElementById('prOpenSource'); const slicesSource = doc.getElementById('prSlicesSource');
  open.replaceChildren(...PR_OPEN.map((v) => optionOf(doc, v, PR_OPEN_LABELS[v])));
  slices.replaceChildren(...PR_SLICES.map((v) => optionOf(doc, v, PR_SLICES_LABELS[v])));
  let defaults = null; let preset = null; let gen = 0; let targetKey = ''; const touched = { open: false, slices: false };
  const kindOf = () => getTarget().kind;
  const paint = () => {
    const kind = kindOf();
    const form = prFormState(defaults, preset);
    openRow.hidden = kind === 'none' || !defaults;
    slicesRow.hidden = !(kind === 'project' && form.slices);
    for (const [key, select, small] of [['open', open, openSource], ['slices', slices, slicesSource]]) {
      const field = form[key];
      if (!field) continue;
      if (!touched[key]) select.value = field.value;
      if (small) small.textContent = select.value !== field.value ? 'This run only' : prSourceText(field.source);
    }
  };
  const refresh = async () => {
    const mine = ++gen;
    const target = getTarget();
    const key = `${target.kind}|${target.projectDir || ''}|${target.workspaceId || ''}`;
    if (key !== targetKey) { targetKey = key; touched.open = false; touched.slices = false; }
    let data = null;
    const known = target.kind === 'workspace' ? target.workspaceId : target.kind === 'project' ? target.projectDir : '';
    if (known) {
      const query = target.kind === 'workspace' ? `workspaceId=${encodeURIComponent(target.workspaceId || '')}` : `projectDir=${encodeURIComponent(target.projectDir || '')}`;
      try { const r = await fetchFn(`/api/run-defaults?${query}`); data = r.ok ? await jsonOf(r) : null; } catch { data = null; }
    }
    if (mine !== gen) return;
    defaults = data && data.pr ? data : null;
    paint();
  };
  for (const [key, select] of [['open', open], ['slices', slices]]) {
    select.addEventListener('change', () => { touched[key] = true; paint(); onChange(); });
  }
  return {
    refresh,
    body: () => {
      if (defaults) return prBodyOf({ open: open.value, slices: slices.value }, defaults, { slicesShown: kindOf() === 'project' });
      if (!preset || kindOf() === 'none') return undefined;
      const out = {};
      if (PR_OPEN.includes(preset.open)) out.open = preset.open;
      if (kindOf() === 'project' && PR_SLICES.includes(preset.slices)) out.slices = preset.slices;
      return Object.keys(out).length ? out : undefined;
    },
    apply(pr) { preset = pr && typeof pr === 'object' ? pr : null; touched.open = false; touched.slices = false; paint(); },
  };
}
