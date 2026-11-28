// ui/public/chat/guide-line.mjs — the composer's Guide switch and Guide line (a CONTRACT §2 composer add-on, registered
// right after the role picker). With the shaperSmallRuns flag on and the Shaper pin set, the lead row gains a "Guide"
// switch after the role picker, and one line of fixed height sits between the field and the bar: the first-time offer
// while the prompt is empty, else nothing. The prefs and the Guide model's name are read once per mount
// (GET /api/shape/guide); nothing shows before that read lands. With the flag off or no Shaper pin there is no switch,
// no line and no request. It never takes, holds or rewords a send: no beforeSend, no transformSend.
// The check: 2 seconds after the person types a changed prompt of 12 or more characters, one POST
// /api/shape/guide/check with the role the composer carries. Never on send, at most one in flight, and an answer for
// text that has since changed is dropped. The line reads "Checking your prompt…", then the result: a fold
// "Prompt 2/5 · 3 gaps", or with no gap the size in words. A failed check says so calmly with one quiet action: "Try
// again", or "Open Models" when Guide has no model. Each new result is spoken once through the composer's announce.
// The rows: the fold opens onto the five checks (shut by default; the person's open choice is saved as rowsOpen). An
// open gap has the hollow mark and an Add that opens one field; its answer joins the prompt as "<question>: <answer>"
// (the question the row shows, without its closing question mark, else the label), and the point counts as covered at
// once. While an Add field is open, results are held and applied when it closes.
import { registerComposerAddon } from './extensions.mjs';
import { makeSwitch } from '../switch.mjs';
import { flagOn as liveFlagOn, onFlagChange as liveOnFlagChange } from '../flags.mjs';
import { buildCheckRows, fold } from '../shape/check-row.mjs';
import { icon } from '../icons.mjs';
import { GUIDE_CHECK_IDS, GUIDE_DEFAULT_QUESTIONS, GUIDE_PROMPT_MAX, GUIDE_SIZES } from '../../../src/shared/prompt-check/assessment.mjs';

export const GUIDE_ADDON_ID = 'guide';
export const LINE_TITLE = 'Sending works as it is.';
export const OFFER_TEXT = 'New: Guide checks your idea for gaps before you send. Switch it off any time.';
export const TIP_HEAD = 'Guide: a quick model check of your prompt for gaps, before you send. It can write the prompt out. Runs on';

export const CHECK_DELAY_MS = 2000;
export const CHECK_MIN_CHARS = 12;
export const CHECKING_TEXT = 'Checking your prompt…';
export const RECHECK_TEXT = 'checking…';
/** The size in words, shown only when no gap is open: never a number of runs. */
export const SIZE_WORDS = Object.freeze({ small: 'Small: one run', medium: 'Medium: a few runs', large: 'Large: several runs' });
export const FAIL_TEXT = 'Guide is not answering right now.';
export const NO_MODEL_TEXT = 'Guide has no model to run on.';
export const TRY_AGAIN = 'Try again';
export const OPEN_MODELS = 'Open Models';
export const MODELS_HREF = '#models/jobs/helpers';
export const ADD_TEXT = 'Add';
export const ADD_PLACEHOLDER = 'Your answer';

const FLAG = 'shaperSmallRuns';

/** The switch's tooltip, naming the Guide model (or saying there is none yet). */
export function guideTip(label) {
  return label ? `${TIP_HEAD} ${label} (change it in Settings › Models).` : `${TIP_HEAD} no model yet (pick one in Settings › Models).`;
}

/** The line's words: null with Guide off (no line), the offer the first time while the prompt is empty, else ''. */
export function lineText({ on, offerSeen, offerGone, prompt }) {
  if (!on) return null;
  return !offerSeen && !offerGone && prompt === '' ? OFFER_TEXT : '';
}

/** The result's words from the check route's body: `{ fold, head, rest }` (`rest` starts with ' · '), or null for a
 *  body that is not five checks and a known size. A gap open: the score and the gap count, no size. No gap: the size. */
export function resultWords(check) {
  if (!check || !Array.isArray(check.checks) || check.checks.length !== GUIDE_CHECK_IDS.length) return null;
  if (typeof check.size !== 'string' || !GUIDE_SIZES.includes(check.size)) return null;
  const total = GUIDE_CHECK_IDS.length;
  const covered = check.checks.filter((c) => c && c.covered === true).length;
  const gaps = total - covered;
  if (gaps > 0) return { fold: true, head: `Prompt ${covered}/${total}`, rest: ` · ${gaps} ${gaps === 1 ? 'gap' : 'gaps'}` };
  const rest = ` · ${SIZE_WORDS[check.size]}`;
  return check.size === 'small' ? { fold: false, head: 'Clear enough', rest } : { fold: true, head: `Prompt ${total}/${total}`, rest };
}

/** The words a screen reader hears for a result: "Prompt 2 of 5, 3 gaps", or null for a body that is no result. */
export function resultSpeech(check) {
  const w = resultWords(check);
  if (!w) return null;
  return `${w.head.replace(/(\d+)\/(\d+)/, '$1 of $2')}${w.rest.replace(/^ · /, ', ')}`;
}

/** Which failure line a check's code gets: 'no-model', null (no line: Guide off elsewhere, an abort, a superseded
 *  check), or 'failed' for every other code. */
export function failureKind(code) {
  if (code === 'GUIDE_NO_MODEL') return 'no-model';
  if (code === 'GUIDE_OFF' || code === 'ABORTED' || code === 'GUIDE_SUPERSEDED') return null;
  return 'failed';
}

/** What the line shows, first match: off, a result (with "checking…" on a re-check), the first check, a failure, the
 *  offer, empty. */
export function lineState({ on, offerSeen, offerGone, prompt, result, checking, failure = null }) {
  if (!on) return { kind: 'off' };
  const words = result ? resultWords(result) : null;
  if (words) return { kind: 'result', words, recheck: checking === true };
  if (checking) return { kind: 'checking' };
  if (failure) return { kind: 'failure', failure };
  return lineText({ on, offerSeen, offerGone, prompt }) === OFFER_TEXT ? { kind: 'offer' } : { kind: 'empty' };
}

/** The name of a row's Add (and of its field's Add): "Add: who is it for". */
export function addName(label) {
  return `${ADD_TEXT}: ${String(label).toLowerCase()}`;
}

/** The question a gap row shows: '' for a covered check, and for a question that is empty or a default one of either
 *  register (a default only restates its label). */
export function shownQuestion(check) {
  if (!check || check.covered === true) return '';
  const q = typeof check.question === 'string' ? check.question : '';
  if (!q || q === GUIDE_DEFAULT_QUESTIONS.plain[check.id] || q === GUIDE_DEFAULT_QUESTIONS.technical[check.id]) return '';
  return q;
}

/** What Add writes: "<head>: <answer>", the answer trimmed and its whitespace runs collapsed to one space. */
export function addLine(head, answer) {
  return `${head}: ${String(answer).trim().replace(/\s+/g, ' ')}`;
}

/** The prompt with `line` appended: nothing in front of an empty prompt or after a line break, else one line break. */
export function appendAnswer(value, line) {
  if (value === '' || value.endsWith('\n')) return `${value}${line}`;
  return `${value}\n${line}`;
}

/** A copy of a check body where every id in `ids` is covered, without a question. The input is never changed. */
export function withAnswered(check, ids) {
  return { ...check, checks: check.checks.map((c) => (c && ids.has(c.id) ? { ...c, covered: true, question: '' } : c)) };
}

/** The head Add writes for a gap: the question the row shows, without its closing question mark, else the label. */
function addHead(c) {
  const q = shownQuestion(c).trim().replace(/\?$/, '').trim();
  return q || c.label;
}

/**
 * The five rows of a check body, built by buildCheckRows. A gap: the hollow mark named "open", its shown question, and
 * its quiet Add, or (for `open`) the Add field. A covered check: the tick named "covered" and its label.
 * @param {{ open: string|null, onAdd(id: string): void, onCommit(id: string, answer: string): void, onCancel(): void }} opts
 */
export function guideRows(doc, check, { open = null, onAdd, onCommit, onCancel }) {
  const items = check.checks.map((c) => {
    const base = { label: c.label, textWrap: true, markRole: 'img', data: { check: c.id } };
    if (c.covered === true) return { ...base, pass: true, ariaLabel: 'covered' };
    const name = addName(c.label);
    let action;
    if (c.id === open) {
      action = doc.createElement('span');
      action.className = 'ask-guide-ans';
      const input = doc.createElement('input');
      input.type = 'text';
      input.className = 'input input-sm';
      input.placeholder = ADD_PLACEHOLDER;
      input.setAttribute('aria-label', (typeof c.question === 'string' && c.question) || c.label);
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-sm';
      b.textContent = ADD_TEXT;
      b.setAttribute('aria-label', name);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); onCommit(c.id, input.value); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); }
      });
      b.addEventListener('click', () => onCommit(c.id, input.value));
      action.append(input, b);
    } else {
      action = doc.createElement('button');
      action.type = 'button';
      action.className = 'btn btn-sm btn-quiet';
      action.textContent = ADD_TEXT;
      action.setAttribute('aria-label', name);
      action.addEventListener('click', () => onAdd(c.id));
    }
    return { ...base, pass: false, mark: 'wait', ariaLabel: 'open', detail: shownQuestion(c) || undefined, action };
  });
  return buildCheckRows(doc, { items });
}

/** POST /api/shape/guide/check with `{ prompt, role }`. Never rejects: `{ ok: true, check }` or `{ ok: false, code }`
 *  (the route's error code, 'ABORTED', 'NETWORK', or 'BAD_REPLY' for a body that does not parse). */
export async function checkGuide({ prompt, role = null }, { signal, fetchFn = (...a) => globalThis.fetch(...a) } = {}) {
  let res;
  try {
    res = await fetchFn('/api/shape/guide/check', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, role: role ?? null }), signal,
    });
  } catch (err) {
    return { ok: false, code: err && err.name === 'AbortError' ? 'ABORTED' : 'NETWORK' };
  }
  let body;
  try { body = await res.json(); } catch (err) {
    return { ok: false, code: err && err.name === 'AbortError' ? 'ABORTED' : 'BAD_REPLY' };
  }
  if (res.ok) return { ok: true, check: body };
  const code = body && body.error && typeof body.error.code === 'string' ? body.error.code : 'BAD_REPLY';
  return { ok: false, code };
}

async function json(res) {
  if (!res || !res.ok) throw new Error(`HTTP ${res ? res.status : 0}`);
  return res.json();
}

/** GET /api/shape/guide: `{ model: { id, label } | null, on, offerSeen, rowsOpen }`; rejects on a non-200. */
export async function loadGuide(fetchFn = (...a) => globalThis.fetch(...a)) {
  return json(await fetchFn('/api/shape/guide'));
}

/** PUT /api/shape/guide/prefs with `{ on?, offerSeen?, rowsOpen? }`; rejects on a non-200. */
export async function saveGuidePrefs(patch, fetchFn = (...a) => globalThis.fetch(...a)) {
  return json(await fetchFn('/api/shape/guide/prefs', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }));
}

/**
 * @param {{ intent: { current(): string|null, onChange(fn): () => void, onSend?(fn): () => void },
 *   flagOn?: (key: string) => boolean, onFlagChange?: (key: string, fn: Function) => () => void,
 *   load?: () => Promise<object>, save?: (patch: object) => Promise<object>,
 *   timers?: { setTimeout: Function, clearTimeout: Function },
 *   check?: (body: { prompt: string, role: string|null }, opts: { signal: AbortSignal }) => Promise<object>,
 *   role?: () => string|null }} deps
 * @returns {{ addon: { id: string, mount(leadEl, ctx) }, refresh(): void, prefs(): object|null }}
 */
export function createGuideLine({
  intent,
  flagOn = (k) => liveFlagOn(k),
  onFlagChange = liveOnFlagChange,
  load = () => loadGuide(),
  save = (patch) => saveGuidePrefs(patch),
  timers = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id) },
  check = (body, opts) => checkGuide(body, opts),
  role = () => null,
} = {}) {
  const mounts = new Set();
  let last = null;   // the prefs the latest landed read (or switch use) holds
  const wanted = () => flagOn(FLAG) === true && intent.current() === 'shape';

  function mount(leadEl, ctx = {}) {
    const doc = ctx.doc || leadEl.ownerDocument;
    const box = leadEl.parentElement;
    const field = box ? box.querySelector('.ask-input') : null;
    let destroyed = false;
    let shown = false;
    let landed = false;     // a read has come back: kept for the mount
    let reading = false;
    let gens = 0;           // only the latest-started read's answer is applied
    let prefs = { on: true, offerSeen: false, rowsOpen: false, model: null };
    let savedOn = true;     // the on the profile holds, as loaded or last saved
    let changes = 0;        // switch uses so far: a refused save restores only the latest
    let offerOnScreen = false;
    let offerGone = false;  // within one mount a dismissed offer never returns
    let chain = Promise.resolve();   // saves run one after another
    let asked = null;       // the trimmed text the latest check was made for (null: the next input checks)
    let pending = null;     // the pause's timer id
    let inflight = null;    // { ctl, text } of the one check out
    let result = null;      // { text, check } of the shown result
    let dropped = null;     // the trimmed text a superseded or aborted answer was for: the repaint does not ask for it again
    let failure = null;     // null | 'failed' | 'no-model': the shown failure
    let said = null;        // the result words last announced
    const answered = new Set();   // check ids the person answered with Add, for the shown result
    let addOpen = null;     // the check id whose Add field is open
    let held = null;        // { req, out } of a landing held while an Add field is open
    let selfWrite = false;  // Add is writing the prompt: its input event is not the person's typing
    let rowsSig = null;     // what the rows were last built from: rebuilt only when it changes

    const sw = makeSwitch(doc, { label: 'Guide', rowClass: 'ask-guide-sw', inputClass: 'ask-guide-sw-input' });
    const line = doc.createElement('div');
    line.className = 'ask-guide';
    line.title = LINE_TITLE;
    const words = doc.createElement('span');
    words.className = 'ask-guide-t';
    line.append(words);
    // The result: one fold built once per mount and updated in place (its open state survives a new result). Its region
    // stays out of the DOM until the rows exist.
    const head = doc.createElement('b');
    head.className = 'ask-guide-head';
    const rest = doc.createElement('span');
    rest.className = 'ask-guide-rest';
    const foldText = doc.createElement('span');
    foldText.className = 'plan-fold-text';
    foldText.append(head, rest);
    const foldBtn = doc.createElement('button');
    foldBtn.type = 'button';
    foldBtn.className = 'btn plan-fold ask-guide-fold';
    foldBtn.append(foldText, icon(doc, 'chevron-down', 12, 'ic ask-guide-chev'));
    const rows = doc.createElement('div');
    rows.className = 'ask-guide-rows srows';
    rows.hidden = true;
    const checksEl = doc.createElement('div');
    checksEl.className = 'plan-checks';
    rows.append(checksEl);
    fold(foldBtn, rows);
    // The person's open choice: kept for the mount and saved; a refused save keeps it here, like offerSeen.
    foldBtn.addEventListener('click', () => {
      prefs = { ...prefs, rowsOpen: !rows.hidden };
      last = { ...prefs };
      queue({ rowsOpen: prefs.rowsOpen }).catch(() => { /* kept for this mount */ });
      if (!prefs.rowsOpen && addOpen !== null) closeField();
    });
    const sumHead = doc.createElement('b');
    sumHead.className = 'ask-guide-head';
    const sumRest = doc.createElement('span');
    sumRest.className = 'ask-guide-rest';
    const sum = doc.createElement('span');
    sum.className = 'ask-guide-sum';
    sum.append(sumHead, sumRest);
    const quiet = doc.createElement('span');
    quiet.className = 'ask-guide-q';
    quiet.textContent = RECHECK_TEXT;
    // The failure's one action, built once per mount: the app's quiet small button.
    const action = (label, onClick) => {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-sm btn-quiet ask-guide-act';
      b.textContent = label;
      b.addEventListener('click', onClick);
      return b;
    };
    const retryBtn = action(TRY_AGAIN, () => retry());
    const modelsBtn = action(OPEN_MODELS, () => { const win = doc.defaultView; if (win) win.location.hash = MODELS_HREF; });

    const queue = (patch) => {
      const p = chain.then(() => save(patch));
      chain = p.catch(() => {});
      return p;
    };

    const focusPrompt = () => { if (typeof ctx.focus === 'function') ctx.focus(); };
    /** Where the focus is before a repaint: the fold, or a row (its check id), else null (elsewhere: never moved). */
    function noteFocus() {
      const a = doc.activeElement;
      if (!a) return null;
      if (a === foldBtn) return { fold: true };
      if (rows.contains(a)) { const r = a.closest('[data-check]'); return { check: r ? r.dataset.check : null }; }
      return null;
    }
    const controlOf = (row) => row.querySelector('.ask-guide-ans input') || row.querySelector(':scope > button');
    /** After a repaint: the same check's control, the next row's, the fold, else the prompt. */
    function restoreFocus(n) {
      if (!n) return;
      const a = doc.activeElement;
      if (a && a !== doc.body && a.isConnected && !a.closest('[hidden]')) return;
      if (rows.isConnected && !rows.hidden) {
        const list = [...checksEl.querySelectorAll('[data-check]')];
        const at = n.check ? list.findIndex((r) => r.dataset.check === n.check) : -1;
        for (const r of at < 0 ? [] : list.slice(at)) { const c = controlOf(r); if (c) { c.focus(); return; } }
      }
      if (foldBtn.parentNode === line && line.isConnected) { foldBtn.focus(); return; }
      focusPrompt();
    }
    function removeRows() {
      if (rows.parentNode) rows.remove();
      addOpen = null;
      held = null;
    }
    /** The rows under a fold result: rebuilt only when the result, the answered ids or the open field change. */
    function paintRows(shownCheck) {
      const sig = `${[...answered].sort().join(',')}|${addOpen ?? ''}`;
      if (!rowsSig || rowsSig.check !== result.check || rowsSig.key !== sig) {
        rowsSig = { check: result.check, key: sig };
        checksEl.replaceChildren(...guideRows(doc, shownCheck, { open: addOpen, onAdd: openField, onCommit: commit, onCancel: cancelField }));
      }
      rows.hidden = !prefs.rowsOpen;
      foldBtn.setAttribute('aria-expanded', String(prefs.rowsOpen));
    }
    function paintLine() {
      if (!shown) return;
      const had = noteFocus();
      paintLineNow();
      restoreFocus(had);
    }
    function paintLineNow() {
      // A shown result for text the field no longer holds (a recall, a code write: no input event) is checked again.
      // Not for text whose answer was just superseded or aborted: only a real input asks for that again.
      if (result && field && pending === null && inflight === null) {
        const now = field.value.trim();
        if (now !== result.text && now !== dropped) onInput();
      }
      const prompt = field ? field.value : '';
      const shownCheck = result ? withAnswered(result.check, answered) : null;
      const state = lineState({
        on: prefs.on, offerSeen: prefs.offerSeen, offerGone, prompt, result: shownCheck, checking: inflight !== null, failure,
      });
      const bar = box ? box.querySelector(':scope > .ask-composer-row') : null;
      if (state.kind === 'off' || !bar) {
        line.remove();
        removeRows();
        offerOnScreen = false;
        return;
      }
      if (state.kind === 'result' && state.words.fold) {
        if (line.parentNode !== box || line.nextElementSibling !== rows || rows.nextElementSibling !== bar) { bar.before(line); line.after(rows); }
        paintRows(shownCheck);
      } else {
        removeRows();
        if (line.nextElementSibling !== bar || line.parentNode !== box) bar.before(line);
      }
      if (state.kind === 'result') {
        const { fold: folds, head: h, rest: r } = state.words;
        const shownEl = folds ? foldBtn : sum;
        (folds ? head : sumHead).textContent = h;
        (folds ? rest : sumRest).textContent = r;
        const want = state.recheck ? [shownEl, quiet] : [shownEl];
        if (line.children.length !== want.length || want.some((el, i) => line.children[i] !== el)) line.replaceChildren(...want);
        words.removeAttribute('title');
      } else if (state.kind === 'failure') {
        const noModel = state.failure === 'no-model';
        const want = [words, noModel ? modelsBtn : retryBtn];
        if (line.children.length !== 2 || want.some((el, i) => line.children[i] !== el)) line.replaceChildren(...want);
        words.textContent = noModel ? NO_MODEL_TEXT : FAIL_TEXT;
        words.title = words.textContent;   // a sentence cut on a narrow screen can still be read in full
      } else {
        if (line.children.length !== 1 || line.firstChild !== words) line.replaceChildren(words);
        words.textContent = state.kind === 'checking' ? CHECKING_TEXT : state.kind === 'offer' ? OFFER_TEXT : '';
        words.removeAttribute('title');
      }
      if (state.kind === 'offer') { offerOnScreen = true; return; }
      if (offerOnScreen) {
        offerOnScreen = false;
        if (prompt !== '' && !offerGone) {
          offerGone = true;
          queue({ offerSeen: true }).catch(() => { /* the offer stays dismissed in this mount */ });
        }
      }
    }
    function paint() {
      if (!shown) return;
      if (sw.row.parentNode !== leadEl) {
        const anchor = leadEl.querySelector(':scope > .ask-asker-pick') || leadEl.querySelector(':scope > .chat-intent');
        if (anchor) anchor.after(sw.row); else leadEl.prepend(sw.row);
      }
      sw.input.checked = prefs.on;
      const tip = guideTip(prefs.model ? prefs.model.label : null);
      sw.row.title = tip;
      sw.input.title = tip;
      paintLine();
    }
    function clearPending() {
      if (pending !== null) { timers.clearTimeout(pending); pending = null; }
    }
    function abortFlight() {
      if (inflight) { inflight.ctl.abort(); inflight = null; }
    }
    /** Nothing of a check is left: no pause, no request, no result, and the next input checks. */
    function reset() {
      clearPending();
      abortFlight();
      addOpen = null;
      held = null;
      answered.clear();
      result = null;
      asked = null;
      dropped = null;
      failure = null;
      said = null;
    }
    const checkable = (text) => text.length >= CHECK_MIN_CHARS && text.length <= GUIDE_PROMPT_MAX;
    /** The field's input event: the only thing that arms the pause. */
    function onInput() {
      if (!shown || !prefs.on || !field) return;
      const text = field.value.trim();
      if (!checkable(text)) { reset(); return; }
      if (text === asked) { clearPending(); return; }
      if (inflight) { abortFlight(); asked = null; }
      clearPending();
      pending = timers.setTimeout(fire, CHECK_DELAY_MS);
    }
    function fire() {
      pending = null;
      if (destroyed || !shown || !prefs.on || !field) return;
      const text = field.value.trim();
      if (!checkable(text) || text === asked) return;
      abortFlight();
      const req = { ctl: new AbortController(), text };
      inflight = req;
      asked = text;
      let out;
      try { out = Promise.resolve(check({ prompt: text, role: role() ?? null }, { signal: req.ctl.signal })); } catch { out = Promise.resolve({ ok: false, code: 'NETWORK' }); }
      out.then((o) => land(req, o), () => land(req, { ok: false, code: 'NETWORK' }));
      paintLine();
    }
    /** Try again: one check of the field's text at once, then focus back in the prompt. Never while one is out. */
    function retry() {
      if (destroyed || !shown || !prefs.on || !field || inflight) return;
      clearPending();
      asked = null;
      failure = null;
      fire();
      if (typeof ctx.focus === 'function') ctx.focus();
    }
    /** An ended request: held while an Add field is open (a later landing replaces it), else applied. */
    function land(req, out) {
      if (inflight !== req) return;
      inflight = null;
      if (addOpen !== null) { held = { req, out }; paintLine(); return; }
      applyLanding(req, out);
    }
    /** Applied only while the field still holds the text it was asked for. */
    function applyLanding(req, out) {
      let speak = null;
      if (!field || field.value.trim() !== req.text) {
        asked = null;
      } else if (out && out.ok === true && resultWords(out.check)) {
        result = { text: req.text, check: out.check };
        answered.clear();
        failure = null;
        speak = resultSpeech(out.check);
      } else if (out && out.ok !== true && (out.code === 'ABORTED' || out.code === 'GUIDE_SUPERSEDED')) {
        asked = null;    // what was shown before the check stays; the next input asks again
        dropped = req.text;
      } else {
        // A failure (a 200 that is no result counts as one): the older result was for other text, so it goes.
        result = null;
        answered.clear();
        failure = out && out.ok !== true ? failureKind(out.code) : 'failed';
        said = null;
      }
      paintLine();
      if (speak && speak !== said) {
        said = speak;
        if (typeof ctx.announce === 'function') ctx.announce(speak);
      }
    }
    /** Close the Add field (its draft is dropped) and apply a landing held while it was open. */
    function closeField() {
      addOpen = null;
      if (held) { const h = held; held = null; applyLanding(h.req, h.out); } else paintLine();
    }
    /** A gap's quiet Add: its field opens in place of the button (one at a time) and takes the focus. */
    function openField(id) {
      if (!result) return;
      addOpen = id;
      paintLine();
      const input = rows.querySelector('.ask-guide-ans input');
      if (input) input.focus();
    }
    function cancelField() {
      closeField();
      focusPrompt();
    }
    /** Enter or the field's Add: the answer joins the prompt, the point is covered, and the next open gap's field opens
     *  (after this row, else before it); with none left the field closes and the prompt takes the focus. */
    function commit(id, answerText) {
      if (!result || !field || String(answerText).trim() === '') return;
      const c = result.check.checks.find((x) => x && x.id === id);
      if (!c) return;
      const text = addLine(addHead(c), answerText);
      answered.add(id);
      const open = withAnswered(result.check, answered).checks.filter((x) => x && x.covered !== true).map((x) => x.id);
      const at = GUIDE_CHECK_IDS.indexOf(id);
      addOpen = open.find((x) => GUIDE_CHECK_IDS.indexOf(x) > at) ?? open[0] ?? null;
      selfWrite = true;
      try {
        field.value = appendAnswer(field.value, text);
        field.dispatchEvent(new (doc.defaultView || globalThis).Event('input', { bubbles: true }));
      } finally {
        selfWrite = false;
      }
      if (!result) { focusPrompt(); return; }   // the append went over the limit: the result was cleared
      if (addOpen === null) { closeField(); focusPrompt(); return; }
      paintLine();
      const input = rows.querySelector('.ask-guide-ans input');
      if (input) input.focus();
    }
    function detach() {
      reset();
      shown = false;
      offerOnScreen = false;
      sw.row.remove();
      line.remove();
      rows.remove();
    }
    function apply(p) {
      const model = p && p.model && typeof p.model.label === 'string' && p.model.label ? { id: p.model.id, label: p.model.label } : null;
      prefs = { on: p?.on !== false, offerSeen: p?.offerSeen === true, rowsOpen: p?.rowsOpen === true, model };
      savedOn = prefs.on;
      last = { ...prefs };
    }
    function start() {
      const gen = ++gens;
      reading = true;
      Promise.resolve()
        .then(() => load())
        .then((p) => {
          if (gen !== gens) return;
          reading = false;
          apply(p);
          // A Models save that brings a model: the no-model line goes, and the next input checks again.
          if (failure === 'no-model' && prefs.model) { failure = null; asked = null; }
          landed = true;
          decide();
        }, () => {
          if (gen !== gens) return;
          reading = false;   // no switch and no line; the next pin set reads again
        });
    }
    function decide() {
      if (destroyed || !wanted()) { detach(); return; }
      if (!landed) { if (!reading) start(); return; }
      shown = true;
      paint();
    }

    sw.input.addEventListener('change', () => {
      const next = sw.input.checked;
      const offerWasOn = offerOnScreen;
      if (offerWasOn) { offerOnScreen = false; offerGone = true; }
      prefs = { ...prefs, on: next };
      last = { ...prefs };
      if (!next) reset();
      changes += 1;
      const mine = changes;
      paint();
      queue(offerWasOn ? { on: next, offerSeen: true } : { on: next }).then(
        () => { savedOn = next; },
        () => { if (mine === changes) { prefs = { ...prefs, on: savedOn }; last = { ...prefs }; paint(); } },
      );
      if (typeof ctx.focus === 'function') ctx.focus();
    });

    const onField = () => paintLine();
    const FIELD_EVENTS = ['input', 'keyup', 'focus'];
    // The person's own typing in the prompt closes an open Add field; Add's own write does not.
    const onFieldInput = () => { if (addOpen !== null && !selfWrite) closeField(); onInput(); };
    if (field) field.addEventListener('input', onFieldInput);   // before the repaint, so it paints what onInput decided
    if (field) for (const type of FIELD_EVENTS) field.addEventListener(type, onField);
    // Never on send: Enter and a click on Send clear the pause before the send runs; the intent's send signal for this
    // field then drops everything.
    const onKey = (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) clearPending(); };
    if (field) field.addEventListener('keydown', onKey);
    const onClick = (e) => { const t = e.target; if (t && typeof t.closest === 'function' && t.closest('.ask-send')) clearPending(); };
    if (box) box.addEventListener('click', onClick, true);
    const offSend = typeof intent.onSend === 'function'
      ? intent.onSend((e) => { if (e && e.field === field) { reset(); paintLine(); } })
      : () => {};
    const offIntent = intent.onChange(decide);
    const offFlag = onFlagChange(FLAG, decide);

    const handle = {
      /** Read once more and repaint (a Models save); a mount not showing drops its kept read instead. */
      refresh() {
        if (destroyed) return;
        if (wanted()) start();
        else if (landed) landed = false;
      },
      update() {
        if (field && field.value.trim().length < CHECK_MIN_CHARS) reset();   // the send's clear of the field
        paintLine();
      },
      destroy() {
        destroyed = true;
        gens += 1;
        offIntent();
        offFlag();
        offSend();
        if (field) {
          for (const type of FIELD_EVENTS) field.removeEventListener(type, onField);
          field.removeEventListener('input', onFieldInput);
          field.removeEventListener('keydown', onKey);
        }
        if (box) box.removeEventListener('click', onClick, true);
        detach();
        mounts.delete(handle);
      },
    };
    mounts.add(handle);
    decide();   // a composer built while the Shaper pin is set reads at once
    return { update: handle.update, destroy: handle.destroy };
  }

  return {
    addon: Object.freeze({ id: GUIDE_ADDON_ID, mount }),
    refresh() { for (const m of [...mounts]) m.refresh(); },
    prefs: () => (last ? { ...last } : null),
  };
}

const installed = new Set();

/** Create the add-on and register it (CONTRACT §2). app.js calls this right after installRolePicker. */
export function installGuideLine(deps) {
  const ctl = createGuideLine(deps);
  installed.add(ctl);
  registerComposerAddon(ctl.addon);
  return ctl;
}

/** A Models save: every installed Guide reads its model again. Does nothing when none is installed. */
export function refreshGuideLine() {
  for (const ctl of installed) ctl.refresh();
}
