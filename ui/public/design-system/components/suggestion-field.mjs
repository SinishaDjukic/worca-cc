// SuggestionField (docs/rail/forms.md): text Worca writes for you. A sparkle inside the field, a Suggested chip, the violet
// shimmer while it writes, and a grey line when it could not; the field then keeps the text it had.
import { esc, attrs, cls } from './html.mjs';
import { icon } from './icons.mjs';
import { button } from './button.mjs';

/** The Suggested chip. */
export const suggestedChip = () => '<span class="pd-sug">Suggested</span>';

/** The grey line when Worca could not write it: the text stays, Try again. */
export function suggestionFail({ model = '', retry = {}, cls: c = '', attrs: a = {} }) {
  return `<span class="${cls('pd-fail', c)}" role="status"${attrs(a)}>Could not write it: no answer${model ? ` from ${esc(model)}` : ''} in 20s. The text is as it was. ${failureLink({ label: 'Try again', attrs: retry })}</span>`;
}

/** The way on from a failure's line: Try again, Details. */
export const failureLink = ({ label, attrs: a = {} }) => `<button type="button" class="pd-retry"${attrs(a)}>${esc(label)}</button>`;

/** Write or preview a description: the eye beside its label. */
export const previewToggle = ({ on = false, attrs: a = {} }) => `<button type="button" class="pd-eye${on ? ' is-on' : ''}"${attrs({ ...a, 'aria-pressed': String(on), title: 'Preview', 'aria-label': 'Preview' })}>${icon('eye', 14)}</button>`;

/** The field's text as it will read, in the field's place. */
export const suggestionPreview = ({ html, writing = false }) => `<div class="${cls('pd-adorn', writing && 'is-writing')}"><div class="pd-preview">${html}</div></div>`;

/**
 * @param {object} o
 * @param {string} o.id
 * @param {string} [o.value]
 * @param {string} [o.placeholder]
 * @param {string} [o.writingPlaceholder]  what the field says while Worca writes
 * @param {boolean} [o.writing]            Worca is writing: the shimmer, read only, no text
 * @param {number} [o.rows]                a textarea of this many rows; otherwise one line
 * @param {string} [o.inputCls]
 * @param {object} [o.attrs]               on the input
 * @param {string} [o.act]                 the buttons inside the field (the sparkle, Stop)
 * @param {string} [o.cls]
 */
export function suggestionField({ id, value = '', placeholder = '', writingPlaceholder = '', writing = false, rows = 0, inputCls = '', attrs: a = {}, act = '', cls: c = '' }) {
  const ph = writing && writingPlaceholder ? writingPlaceholder : placeholder;
  const common = attrs({ id, placeholder: ph, ...a, readonly: writing });
  const field = rows
    ? `<textarea class="${cls('textarea', inputCls)}" rows="${rows}"${common}>${writing ? '' : esc(value)}</textarea>`
    : `<input class="${cls('input', inputCls)}" type="text"${attrs({ value: writing ? '' : value })}${common}>`;
  return `<div class="${cls('pd-adorn', writing && 'is-writing', c)}">${field}${act ? `<span class="pd-act">${act}</span>` : ''}</div>`;
}

/** The sparkle inside a field: asks Worca to write it; its tooltip names the helper job. */
export function suggestButton({ tip, label = tip, attrs: a = {} }) {
  return `<button type="button" class="pd-ai"${attrs({ title: tip, 'aria-label': label, ...a })}>${icon('sparkle', 14)}</button>`;
}

/** A gap in a rewrite (form.rewrite): the perspective that decides it and the question, as an amber mark. */
export const gapMark = ({ perspective = '', decide = '' }) => `<mark class="pd-gap">${esc(perspective)} · decide: ${esc(decide)}</mark>`;

const FAIL_WHY = {
  'model unavailable': ': no model is available',
  'total cost limit reached': ': the cost limit is reached',
};

/** The grey line when Worca could not rewrite it (form.rewrite): the text stays; Try again only when `retry` is given. */
export function rewriteFail({ model = '', reason = '', retry = null }) {
  const why = reason === 'timeout' ? `: no answer${model ? ` from ${esc(model)}` : ''} in 60s` : FAIL_WHY[reason] || '';
  return `<p class="pd-fail" tabindex="-1">Could not rewrite it${why}. Your text is as it was.${retry ? ` ${failureLink({ label: 'Try again', attrs: retry })}` : ''}</p>`;
}

const PATH_SHOWN = 80;
const clipPath = (p) => (String(p).length > PATH_SHOWN ? `${String(p).slice(0, PATH_SHOWN)}…` : String(p));

/**
 * A whole-text rewrite Worca suggests (form.rewrite), beside the field it would replace.
 * @param {object} o
 * @param {string} o.kind          the kind's label ("Requirement"), shown in lower case in the head
 * @param {'busy'|'ready'|'used'|'failed'} o.state
 * @param {{label:string, text:string, gaps:{label:string, decide:string}[]}[]} [o.sections]  ready
 * @param {string[]} [o.notInRepo] cited paths that are not in the project (ready)
 * @param {string} [o.model]       the model's label: the foot (ready) or the timeout line (failed)
 * @param {{reason:string, retry?:object|null}} [o.fail]  failed
 * @param {{use?:object, keep?:object, undo?:object, busy?:object}} [o.actions]  attrs of each button and the busy region
 */
export function rewriteSuggestion({ kind = '', state, sections = [], notInRepo = [], model = '', fail = null, actions = {} }) {
  const head = `<div class="pd-rewrite-head">Suggested rewrite: ${esc(String(kind).toLowerCase())}</div>`;
  if (state === 'used') {
    return `<div class="pd-rewrite is-used"><span>Rewrite used.</span> ${button({ label: 'Undo', kind: 'quiet', attrs: actions.undo || {} })}</div>`;
  }
  if (state === 'busy') {
    return `<div class="pd-rewrite is-busy">${head}<div class="pd-adorn is-writing pd-rewrite-busy" tabindex="-1"${attrs(actions.busy || {})}>Rewriting…</div></div>`;
  }
  if (state === 'failed') {
    return `<div class="pd-rewrite is-failed">${head}${rewriteFail({ model, reason: fail?.reason, retry: fail?.retry ?? null })}</div>`;
  }
  const rows = sections.map((s) => {
    const marks = (s.gaps || []).map((g) => gapMark({ perspective: g.label, decide: g.decide })).join(' ');
    return `<p class="pd-rewrite-sec"><span class="pd-rewrite-label">${esc(s.label)}:</span> ${[esc(s.text || ''), marks].filter(Boolean).join(' ')}</p>`;
  }).join('');
  const missing = notInRepo.length
    ? `<p class="pd-rewrite-missing">Not in the repo: ${notInRepo.map((p) => `<code>${esc(clipPath(p))}</code>`).join(', ')}</p>` : '';
  const foot = `<div class="pd-rewrite-foot"><span>Rewritten${model ? ` by ${esc(model)}` : ''} · your language and intent kept</span>`
    + `<span class="pd-rewrite-acts">${button({ label: 'Use this', kind: 'primary', attrs: actions.use || {} })}${button({ label: 'Keep mine', kind: 'quiet', attrs: actions.keep || {} })}</span></div>`;
  return `<div class="pd-rewrite is-ready">${head}<div class="pd-rewrite-body">${rows}</div>${missing}${foot}</div>`;
}

/** Stop, while Worca writes. */
export function stopWriting({ attrs: a = {}, size = 12 }) {
  return `<button type="button" class="pd-stop"${attrs({ title: 'Stop', 'aria-label': 'Stop writing', ...a })}>${icon('x', size)}</button>`;
}
