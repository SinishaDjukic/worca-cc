// ui/public/chat/guide-line.mjs — the composer's Guide switch and Guide line (a CONTRACT §2 composer add-on, registered
// right after the role picker). With the shaperSmallRuns flag on and the Shaper pin set, the lead row gains a "Guide"
// switch after the role picker, and one line of fixed height sits between the field and the bar: the first-time offer
// while the prompt is empty, else nothing. The prefs and the Guide model's name are read once per mount
// (GET /api/shape/guide); nothing shows before that read lands. With the flag off or no Shaper pin there is no switch,
// no line and no request. It never takes, holds or rewords a send: no beforeSend, no transformSend. No check runs yet.
import { registerComposerAddon } from './extensions.mjs';
import { makeSwitch } from '../switch.mjs';
import { flagOn as liveFlagOn, onFlagChange as liveOnFlagChange } from '../flags.mjs';

export const GUIDE_ADDON_ID = 'guide';
export const LINE_TITLE = 'Sending works as it is.';
export const OFFER_TEXT = 'New: Guide checks your idea for gaps before you send. Switch it off any time.';
export const TIP_HEAD = 'Guide: a quick model check of your prompt for gaps, before you send. It can write the prompt out. Runs on';

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
 * @param {{ intent: { current(): string|null, onChange(fn): () => void },
 *   flagOn?: (key: string) => boolean, onFlagChange?: (key: string, fn: Function) => () => void,
 *   load?: () => Promise<object>, save?: (patch: object) => Promise<object> }} deps
 * @returns {{ addon: { id: string, mount(leadEl, ctx) }, refresh(): void, prefs(): object|null }}
 */
export function createGuideLine({
  intent,
  flagOn = (k) => liveFlagOn(k),
  onFlagChange = liveOnFlagChange,
  load = () => loadGuide(),
  save = (patch) => saveGuidePrefs(patch),
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

    const sw = makeSwitch(doc, { label: 'Guide', rowClass: 'ask-guide-sw', inputClass: 'ask-guide-sw-input' });
    const line = doc.createElement('div');
    line.className = 'ask-guide';
    line.title = LINE_TITLE;
    const words = doc.createElement('span');
    words.className = 'ask-guide-t';
    line.append(words);

    const queue = (patch) => {
      const p = chain.then(() => save(patch));
      chain = p.catch(() => {});
      return p;
    };

    function paintLine() {
      if (!shown) return;
      const prompt = field ? field.value : '';
      const text = lineText({ on: prefs.on, offerSeen: prefs.offerSeen, offerGone, prompt });
      const bar = box ? box.querySelector(':scope > .ask-composer-row') : null;
      if (text === null || !bar) {
        line.remove();
        offerOnScreen = false;
        return;
      }
      if (line.nextElementSibling !== bar || line.parentNode !== box) bar.before(line);
      words.textContent = text;
      if (text === OFFER_TEXT) { offerOnScreen = true; return; }
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
    function detach() {
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
    if (field) for (const type of FIELD_EVENTS) field.addEventListener(type, onField);
    const offIntent = intent.onChange(decide);
    const offFlag = onFlagChange(FLAG, decide);

    const handle = {
      /** Read once more and repaint (a Models save); a mount not showing drops its kept read instead. */
      refresh() {
        if (destroyed) return;
        if (wanted()) start();
        else if (landed) landed = false;
      },
      update() { paintLine(); },
      destroy() {
        destroyed = true;
        gens += 1;
        offIntent();
        offFlag();
        if (field) for (const type of FIELD_EVENTS) field.removeEventListener(type, onField);
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
