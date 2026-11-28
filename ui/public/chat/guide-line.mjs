// ui/public/chat/guide-line.mjs — the composer's Guide switch and Guide line (a CONTRACT §2 composer add-on, registered
// right after the role picker). With the shaperSmallRuns flag on and the Shaper pin set, the lead row gains a "Guide"
// switch after the role picker, and one line of fixed height sits between the field and the bar: the first-time offer
// while the prompt is empty, else nothing. The prefs and the Guide model's name are read once per mount
// (GET /api/shape/guide); nothing shows before that read lands. With the flag off or no Shaper pin there is no switch,
// no line and no request. It never takes, holds or rewords a send: no beforeSend, no transformSend.
// The check: 2 seconds after the person types a changed prompt of 12 or more characters, one POST
// /api/shape/guide/check with the role the composer carries. Never on send, at most one in flight, and an answer for
// text that has since changed is dropped. The line reads "Checking your prompt…", then the result: a fold
// "Prompt 2/5 · 3 gaps", or with no gap the size in words. A failed check leaves the line empty.
import { registerComposerAddon } from './extensions.mjs';
import { makeSwitch } from '../switch.mjs';
import { flagOn as liveFlagOn, onFlagChange as liveOnFlagChange } from '../flags.mjs';
import { fold } from '../shape/check-row.mjs';
import { icon } from '../icons.mjs';
import { GUIDE_CHECK_IDS, GUIDE_PROMPT_MAX, GUIDE_SIZES } from '../../../src/shared/prompt-check/assessment.mjs';

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

/** What the line shows, first match: off, a result (with "checking…" on a re-check), the first check, the offer, empty. */
export function lineState({ on, offerSeen, offerGone, prompt, result, checking }) {
  if (!on) return { kind: 'off' };
  const words = result ? resultWords(result) : null;
  if (words) return { kind: 'result', words, recheck: checking === true };
  if (checking) return { kind: 'checking' };
  return lineText({ on, offerSeen, offerGone, prompt }) === OFFER_TEXT ? { kind: 'offer' } : { kind: 'empty' };
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
    rows.className = 'ask-guide-rows';
    rows.hidden = true;
    fold(foldBtn, rows);
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

    const queue = (patch) => {
      const p = chain.then(() => save(patch));
      chain = p.catch(() => {});
      return p;
    };

    function paintLine() {
      if (!shown) return;
      // A shown result for text the field no longer holds (a recall, a code write: no input event) is checked again.
      // Not for text whose answer was just superseded or aborted: only a real input asks for that again.
      if (result && field && pending === null && inflight === null) {
        const now = field.value.trim();
        if (now !== result.text && now !== dropped) onInput();
      }
      const prompt = field ? field.value : '';
      const state = lineState({
        on: prefs.on, offerSeen: prefs.offerSeen, offerGone, prompt, result: result ? result.check : null, checking: inflight !== null,
      });
      const bar = box ? box.querySelector(':scope > .ask-composer-row') : null;
      if (state.kind === 'off' || !bar) {
        line.remove();
        offerOnScreen = false;
        return;
      }
      if (line.nextElementSibling !== bar || line.parentNode !== box) bar.before(line);
      if (state.kind === 'result') {
        const { fold: folds, head: h, rest: r } = state.words;
        const shownEl = folds ? foldBtn : sum;
        (folds ? head : sumHead).textContent = h;
        (folds ? rest : sumRest).textContent = r;
        const want = state.recheck ? [shownEl, quiet] : [shownEl];
        if (line.children.length !== want.length || want.some((el, i) => line.children[i] !== el)) line.replaceChildren(...want);
      } else {
        if (line.children.length !== 1 || line.firstChild !== words) line.replaceChildren(words);
        words.textContent = state.kind === 'checking' ? CHECKING_TEXT : state.kind === 'offer' ? OFFER_TEXT : '';
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
      result = null;
      asked = null;
      dropped = null;
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
    /** An ended request: applied only while it is the latest and the field still holds the text it was asked for. */
    function land(req, out) {
      if (inflight !== req) return;
      inflight = null;
      if (!field || field.value.trim() !== req.text) {
        asked = null;
      } else if (out && out.ok === true) {
        result = resultWords(out.check) ? { text: req.text, check: out.check } : null;
      } else if (out && (out.code === 'ABORTED' || out.code === 'GUIDE_SUPERSEDED')) {
        asked = null;    // what was shown before the check stays; the next input asks again
        dropped = req.text;
      } else {
        result = null;   // a failure: the line is empty
      }
      paintLine();
    }
    function detach() {
      reset();
      shown = false;
      offerOnScreen = false;
      sw.row.remove();
      line.remove();
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
    if (field) field.addEventListener('input', onInput);   // before the repaint, so it paints what onInput decided
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
          field.removeEventListener('input', onInput);
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
