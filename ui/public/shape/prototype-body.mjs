// ui/public/shape/prototype-body.mjs — Shaper small runs C1: the Prototype step on the one feature card, in the shared
// step chrome (stepHead, stepSender, errLine, ownButton), with the shared row layout (`.srows`, buildCheckRows), the
// Split's foot ⋯ (toggleMenu) and live line, and the shared stop question (buildChatQuestion). The moments a person
// answers (offered, built, remark, failed) post through stepSender; the working ones (building, reviewing, matching)
// draw no button.
import { stepHead, stepSender, errLine, ownButton, prototypeTitle } from './step-card.mjs';
import { buildCheckRows, buildCheckFold } from './check-row.mjs';
import { buildChatQuestion } from '../chat/question.mjs';
import { toggleMenu } from '../workflows/menu.mjs';
import { icon } from '../icons.mjs';
import { mountPrototypeBuild } from './prototype-build.mjs';
import { careCell } from '../../../src/shared/shape/feature-record.mjs';
import { REMARK_MAX } from '../../../src/shared/shape/prototype.mjs';

const plural = (n, one) => `${n} ${n === 1 ? one : `${one}s`}`;
const usd = (n) => `$${(Number(n) || 0).toFixed(2)}`;
export const REMARK_PLACEHOLDER = 'A remark? e.g. Preview should show dark mode';
/** The remark field's placeholder at this card's 480px breakpoint, where the long one clips. */
export const REMARK_PLACEHOLDER_SHORT = 'A remark?';
export const NO_MATCH = 'That remark matches no requirement. Name the one it changes, for example R-ux-2.';
export const NO_MATCH_PLAIN = 'That remark matches no requirement. Name the requirement it changes.';
const ASKS = new Set(['offered', 'built', 'remark', 'failed']);

/** The step's moment: the ask's, else the saved state's. */
const momentOf = (p) => (p && (p.moment || p.state)) || '';

/** D21: the one card's detail for the Prototype step (Section 3's table); '' where it has none. */
export function prototypeDetail(p) {
  const v = p || {};
  const screens = Array.isArray(v.screens) ? v.screens.length : 0;
  switch (momentOf(v)) {
    case 'offered': return plural(Array.isArray(v.screenIds) ? v.screenIds.length : (v.requirements || []).length, 'screen requirement');
    case 'building': return screens ? `Building the prototype · ${plural(screens, 'screen')}` : 'Building the prototype';
    case 'reviewing': return `Round ${Math.max(1, Number(v.reviewRounds) || 1)} of ${Number(careCell('fixCycles', 'thorough'))}`;
    case 'built': return v.rebuilt ? `Prototype rebuilt with your remark · ${usd(v.costUsd)}` : `Prototype built · ${plural(screens, 'screen')} · ${usd(v.costUsd)}`;
    case 'remark': return 'Your remark changes a requirement';
    case 'failed': return 'The prototype did not build';
    default: return '';
  }
}

/** The step's ⋯: "Stop", plus at most one item (Section 3). */
function moreButton(doc, { extra = null, send, confirm }) {
  const more = ownButton(doc, 'btn-sm btn-quiet btn-icon plan-more', '', () => {
    toggleMenu({ doc, anchor: more, align: 'end', label: 'More for the prototype', items: [
      ...(extra ? [extra] : []),
      { label: 'Stop', onSelect: async () => {
        if (!confirm || await confirm({ title: 'Stop this run', message: 'The requirements stay in the run\'s artifacts.', confirmLabel: 'Stop', danger: true })) send({ decision: 'stop' });
      } },
    ] });
  });
  more.append(icon(doc, 'more', 16));
  more.setAttribute('aria-label', 'More for the prototype');
  more.setAttribute('aria-haspopup', 'menu');
  return more;
}

/**
 * Draws the step's moment into `panel`. `pq.prototype` is the ask's body (moment plus the step's view); `deps` is the
 * step deps (`doc`, `title`, `chip`, `submit`, `confirm`, `register`: 'plain' names no requirement id, `subscribe` and
 * `reduced` for the live build, `readOnly`: the run side panel, which draws the moment with no control to answer it).
 * @returns {{setErrors: (errors: object[]) => void, destroy: () => void}}
 */
export function renderPrototypeBody(panel, pq, deps = {}) {
  const doc = deps.doc || panel.ownerDocument;
  const p = (pq && pq.prototype) || {};
  const moment = momentOf(p);
  const plain = deps.register === 'plain';
  const h = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  panel.appendChild(stepHead(doc, deps.title || prototypeTitle(p), deps.chip || 'Prototype'));
  const body = h('div', 'plan-body plan-card proto-body srows');
  const live = h('div', 'sr-only proto-live');
  live.setAttribute('aria-live', 'polite');
  const word = ASKS.has(moment) ? 'Needs you' : 'Running';
  const detail = prototypeDetail(p);
  live.textContent = detail ? `${word} · ${detail}` : word;
  const err = errLine(doc);
  const send = stepSender(deps, err);
  const foot = h('div', 'qpanel-foot plan-actions');
  // The run side panel shows the step but answers it nowhere: the feature card holds its controls (R-ux-1).
  const readOnly = deps.readOnly === true;
  const mounted = [];
  const setErrors = (errors) => {
    const list = Array.isArray(errors) ? errors : [];
    err.classList.remove('ok');
    err.textContent = list.map((e) => e.message || e.code || 'invalid').join(' · ');
    err.hidden = !list.length;
  };
  const reqRows = (list) => {
    const box = h('div', 'plan-checks proto-reqs');
    box.append(...buildCheckRows(doc, { items: list.map((r) => ({ id: plain ? '' : r.id, idCol: true, label: r.text, pass: true, mark: 'wait', ariaLabel: 'screen requirement' })) }));
    return box;
  };
  const well = (opts) => {
    const host = h('div', 'proto-build');
    mounted.push(mountPrototypeBuild(doc, host, { designId: p.designId || null, buildId: p.buildId || null, screens: p.screens || [],
      subscribe: deps.subscribe, reduced: deps.reduced, register: deps.register, ...opts }));
    return host;
  };

  if (moment === 'offered') {
    body.append(reqRows(p.requirements || []));
    const offer = p.offer || { primary: 'build' };
    const BUILD = { label: 'Build prototype', onSelect: () => send({ decision: 'build' }) };
    const SKIP = { label: 'Skip the prototype', onSelect: () => send({ decision: 'skip' }) };
    const [primary, extra] = offer.primary === 'skip' ? [SKIP, BUILD] : [BUILD, SKIP];
    if (!readOnly) foot.append(ownButton(doc, 'btn-sm btn-primary proto-go', primary.label, primary.onSelect), moreButton(doc, { extra, send, confirm: deps.confirm }));
  } else if (moment === 'built') {
    body.append(well({ settled: true }));
    if (Array.isArray(p.findings) && p.findings.length && p.offer && p.offer.review) {
      const f = buildCheckFold(doc, p.findings, '', { text: () => 'Design and Product reviewed it',
        rows: (d, fs) => buildCheckRows(d, { items: fs.map((x) => ({ pass: !x.objection, label: `${x.role === 'product' ? 'Product' : 'Design'}: ${x.text}` })) }) });
      body.append(f.line, f.rows);
    }
    if (p.designId) {
      const open = h('a', 'btn btn-sm btn-quiet proto-open', 'Open prototype');
      open.href = `#design/${encodeURIComponent(p.designId)}`;
      body.append(open);
    }
    if (!readOnly) builtControls();
  } else if (moment === 'remark') {
    const r = p.remark || {};
    const pr = r.proposed || {};
    const rows = h('div', 'plan-checks proto-reqs');
    rows.append(...buildCheckRows(doc, { items: [{ id: plain ? '' : r.id || '', idCol: true, label: pr.text || '', pass: true, mark: 'wait', ariaLabel: 'changed requirement', note: `Example: ${pr.example || ''}` }] }));
    const was = h('div', 'proto-was', `Was: ${pr.was || ''}`);
    body.append(rows, was);
    if (!readOnly) {
      foot.append(ownButton(doc, 'btn-sm btn-primary proto-change', 'Change requirement', () => send({ decision: 'change' })),
        moreButton(doc, { extra: { label: 'Keep the requirement', onSelect: () => send({ decision: 'keep' }) }, send, confirm: deps.confirm }));
    }
  } else if (moment === 'failed' && readOnly) {
    const why = (p.findings || []).map((f) => f.text).join(' · ');
    if (why) body.append(h('p', 'proto-quote', why));
  } else if (moment === 'failed') {
    failedQuestion();
  } else {
    // building, reviewing, matching: what Worca does now, with no button.
    if (moment === 'matching') {
      const quote = h('blockquote', 'proto-quote', `“${(p.remark && p.remark.text) || p.remarkText || ''}”`);
      body.setAttribute('aria-busy', 'true');
      body.append(quote);
    } else {
      body.append(well({ reviewing: moment === 'reviewing' }));
    }
  }
  body.append(live, err);
  if (foot.childNodes.length) body.append(foot);
  panel.appendChild(body);
  return { setErrors, destroy() { for (const m of mounted) m.destroy(); } };

  /** The Built moment's remark field, Send remark and the foot (the feature card's, never the side panel's). */
  function builtControls() {
    const row = h('div', 'proto-remark');
    const field = h('input', 'input input-sm proto-remark-field');
    field.type = 'text';
    field.maxLength = REMARK_MAX;
    // The short placeholder at 480px or less, switched live; the long one where there is no matchMedia (jsdom).
    const win = doc.defaultView;
    const narrow = win && typeof win.matchMedia === 'function' ? win.matchMedia('(max-width:480px)') : null;
    const fit = () => { field.placeholder = narrow && narrow.matches ? REMARK_PLACEHOLDER_SHORT : REMARK_PLACEHOLDER; };
    fit();
    if (narrow && typeof narrow.addEventListener === 'function') {
      narrow.addEventListener('change', fit);
      mounted.push({ destroy: () => narrow.removeEventListener('change', fit) });
    }
    field.setAttribute('aria-label', 'A remark on the prototype');
    const go = ownButton(doc, 'btn-sm proto-remark-send', 'Send remark', () => { const t = field.value.trim(); if (t) send({ decision: 'remark', remark: t }); });
    // locked follows the field: setPanelBusy re-enables a control only when it is not locked (an empty remark).
    const sync = () => { const empty = !field.value.trim(); go.disabled = empty; if (empty) go.dataset.locked = '1'; else delete go.dataset.locked; };
    field.addEventListener('input', sync);
    field.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go.click(); } });
    row.append(field, go);
    body.append(row);
    if (p.remarkError) {
      field.value = p.remarkText || '';
      err.id = `proto-err-${String(pq.id || 'q').replace(/[^A-Za-z0-9_-]/g, '')}`;
      err.textContent = plain ? NO_MATCH_PLAIN : NO_MATCH;
      err.hidden = false;
      field.setAttribute('aria-describedby', err.id);
      setTimeout(() => field.focus(), 0);
    }
    sync();
    foot.append(ownButton(doc, 'btn-sm btn-primary proto-confirm', 'Confirm prototype', () => send({ decision: 'confirm' })), moreButton(doc, { send, confirm: deps.confirm }));
  }

  /** The failed moment's question: Build again (Worca's pick) or Skip the prototype. */
  function failedQuestion() {
    const why = (p.findings || []).map((f) => f.text).join(' · ');
    const q = buildChatQuestion(doc, {
      id: `proto-${pq.id || 'q'}`, heading: prototypeTitle(p), numbers: false, head: false,
      questions: [{ id: 'again', text: 'Build the prototype again?', why,
        options: [{ value: 'build', label: 'Build again', recommended: true }, { value: 'skip', label: 'Skip the prototype' }] }],
      preset: new Map([['again', 'build']]),
      submitLabel: (picks) => (picks.get('again') === 'skip' ? 'Skip the prototype' : 'Build again'),
      onSubmit: (picks) => send({ decision: picks.get('again') === 'skip' ? 'skip' : 'build' }),
    }, { register: 'plain' });
    body.append(q.el);
    mounted.push({ destroy: () => q.destroy() });
  }
}
