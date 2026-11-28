// ui/public/chat/role-picker.mjs — who is asking, picked in the Chat composer (a CONTRACT §2 composer add-on, registered
// right after the intent chip). With the shaperSmallRuns flag on and the Shaper pin set, one small quiet button sits
// right after the pin and names the person's role; the app's menu (workflows/menu.mjs) picks one of the leads or
// "No role". A pick is saved to the answerer profile (PUT /api/answerer) and rides the sent Shaper message as one
// paragraph after the lead (`shapeRoleLine`), for the model only. It never takes or holds a send: no beforeSend, and
// a send before the profile lands simply carries no role. With the flag off or no Shaper pin it is not in the DOM and
// asks for nothing. When the lead row would wrap, it folds to its icon and arrow; its name stays in aria-label and title.
import { registerComposerAddon } from './extensions.mjs';
import { icon } from '../icons.mjs';
import { toggleMenu } from '../workflows/menu.mjs';
import { loadAnswerer, saveAnswerer, leadLabel } from '../answerer.mjs';
import { flagOn as liveFlagOn, onFlagChange as liveOnFlagChange } from '../flags.mjs';
import { answererLeadKeys } from '../../../src/shared/answerer.mjs';
import { INTENT_LEADS, shapeRoleLine } from '../../../src/shared/intent-leads.mjs';

export const ROLE_PICKER_ADDON_ID = 'role-picker';
/** One icon per lead, in the order of the leads. None is a Chat home pin's. */
export const ROLE_ICONS = Object.freeze({
  product: 'briefcase', architect: 'terminal', ux: 'design', qa: 'eye', security: 'shield', devops: 'cloud', compliance: 'scale',
});
export const NO_ROLE_ICON = 'person';

const FLAG = 'shaperSmallRuns';
const NAME_NONE = 'Your role';
const TITLE = 'Who is asking: Worca words its questions for you. Remembered; change it in Settings › Chat.';
const LAST_TIME = 'you, last time';

/** Does the picker sit on a later line of the lead row than the pin (the row wraps)? */
function layoutWraps(leadEl, pickerEl) {
  const pin = leadEl.querySelector(':scope > .chat-intent');
  if (!pin) return false;
  const a = pin.getBoundingClientRect();
  const b = pickerEl.getBoundingClientRect();
  return b.top > a.top + a.height / 2;
}

/**
 * @param {{ intent: { current(): string|null, onChange(fn): () => void },
 *   flagOn?: (key: string) => boolean, onFlagChange?: (key: string, fn: Function) => () => void,
 *   load?: () => Promise<{ lead: string|null }>, save?: (lead: string|null) => Promise<{ lead: string|null }>,
 *   measureWraps?: (leadEl: HTMLElement, pickerEl: HTMLElement) => boolean }} deps
 * @returns {{ addon: { id: string, mount(leadEl, ctx) }, role(): string|null, choose(lead: string|null): void,
 *   openMenu(o: { doc: Document, anchor: HTMLElement, returnFocus?: HTMLElement|null }): { close(): void },
 *   refresh(): void, onChange(fn: () => void): () => void }}
 */
export function createRolePicker({
  intent,
  flagOn = (k) => liveFlagOn(k),
  onFlagChange = liveOnFlagChange,
  load = () => loadAnswerer(),
  save = (lead) => saveAnswerer(lead),
  measureWraps = layoutWraps,
} = {}) {
  let role = null;        // the role a send carries now
  let saved = null;       // the role the profile holds ("you, last time"): as loaded, then as last saved
  let reading = false;    // a profile read is out
  let landed = false;     // a read has come back
  let touched = false;    // a pick before the first read came back wins over it
  let savedBySave = false; // a save has landed: an older read must not put the old role back as "last time"
  let pending = 0;        // saves still out
  let picks = 0;          // picks so far: a read that a pick or a landed save overtook is stale
  let stored = 0;         // saves landed so far
  let chain = Promise.resolve(); // saves run one after another, in the order they were picked
  const mounts = new Set();
  const listeners = new Set();
  const repaint = () => {
    for (const m of mounts) m.paint();
    for (const fn of [...listeners]) fn();
  };
  const wanted = () => flagOn(FLAG) === true && intent.current() === 'shape';

  /** Read the profile each time the picker shows. The app's loader answers from its cache (no request) once a read
   *  succeeded, asks again after a failure or a timeout, and follows a role saved elsewhere (the Shaper card). */
  function read() {
    if (reading) return;
    reading = true;
    const gen = picks;
    const gotSaves = stored;
    Promise.resolve()
      .then(() => load())
      .then((p) => {
        reading = false;
        const lead = typeof p?.lead === 'string' ? p.lead : null;
        const stale = gen !== picks || gotSaves !== stored;
        if (stale || pending > 0 || (touched && !landed)) {
          if (!landed && !savedBySave) saved = lead;
        } else {
          saved = lead;
          role = lead;
        }
        landed = true;
        repaint();
      })
      .catch(() => { reading = false; /* no profile: the picker reads "Your role", and the next show asks again */ });
  }

  /** A pick paints at once. Saves are chained, so the profile ends on the last pick; a refused save puts the stored
   *  role back when it was the latest pick, with nothing said. */
  function choose(next) {
    // Before the first read lands, the role shown is not yet the profile's: a pick of it still saves, and wins.
    if (next === role && landed) return;
    role = next;
    touched = true;
    picks += 1;
    pending += 1;
    repaint();
    chain = chain
      .then(() => save(next))
      .then(
        () => { saved = next; savedBySave = true; stored += 1; },
        () => { if (role === next) { role = saved; if (!landed) touched = false; } },
      )
      .finally(() => { pending -= 1; repaint(); });
  }

  /** The role menu, one builder for every opener (the composer's button, the Settings › Chat row). */
  function openMenu({ doc, anchor, returnFocus = null }) {
    const items = [
      ...answererLeadKeys({ smallRuns: true }).map((k) => ({
        label: leadLabel(k), icon: ROLE_ICONS[k], checked: k === role,
        ...(k === saved ? { hint: LAST_TIME } : {}),
        onSelect: () => choose(k),
      })),
      { sep: true },
      { label: 'No role', icon: NO_ROLE_ICON, checked: role === null, onSelect: () => choose(null) },
    ];
    return toggleMenu({ doc, anchor, items, label: NAME_NONE, returnFocus });
  }

  function mount(leadEl, ctx = {}) {
    const doc = ctx.doc || leadEl.ownerDocument;
    const composer = typeof leadEl.closest === 'function' ? leadEl.closest('.ask-composer') : null;
    const input = (composer && composer.querySelector('.ask-input')) || null;
    let destroyed = false;
    let menu = null;
    let observer = null;

    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-sm btn-quiet shape-lead-pick ask-asker-pick';
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', 'false');
    const label = doc.createElement('span');
    label.className = 'ask-asker-l';
    let glyph = icon(doc, NO_ROLE_ICON, 14);
    btn.append(glyph, label, icon(doc, 'chevron-down', 12, 'ic ask-asker-arrow'));

    function fold() {
      if (!btn.isConnected) return;
      btn.classList.remove('is-folded');
      if (measureWraps(leadEl, btn)) btn.classList.add('is-folded');
    }
    function paint() {
      const name = role ? leadLabel(role) : null;
      const next = icon(doc, role ? ROLE_ICONS[role] || NO_ROLE_ICON : NO_ROLE_ICON, 14);
      glyph.replaceWith(next);
      glyph = next;
      label.textContent = name || NAME_NONE;
      btn.setAttribute('aria-label', `Your role: ${name || 'not picked'}`);
      btn.title = name ? `${name}. ${TITLE}` : TITLE;
      fold();
    }
    function detach() {
      if (menu) { menu.close(); menu = null; }
      if (observer) { observer.disconnect(); observer = null; }
      btn.classList.remove('is-folded');
      btn.remove();
    }
    function decide() {
      if (destroyed || !wanted()) { detach(); return; }
      if (btn.parentNode !== leadEl) {
        const pin = leadEl.querySelector(':scope > .chat-intent');
        if (pin) pin.after(btn); else leadEl.prepend(btn);
        const RO = (doc.defaultView && doc.defaultView.ResizeObserver) || globalThis.ResizeObserver;
        if (typeof RO === 'function') {
          observer = new RO(() => fold());
          observer.observe(leadEl);
        }
        paint();
      }
      read();
    }

    btn.addEventListener('click', () => { menu = openMenu({ doc, anchor: btn, returnFocus: input }); });

    const offIntent = intent.onChange(decide);
    const offFlag = onFlagChange(FLAG, decide);
    const handle = {
      paint() { if (btn.isConnected) paint(); },
      update() {},
      /** With a role, one role paragraph goes right after the Shaper lead; anything else is left as it came. */
      transformSend(text) {
        if (!role || !wanted()) return text;
        const lead = INTENT_LEADS.shape;
        if (text === lead) return `${lead}\n\n${shapeRoleLine(role)}`;
        if (text.startsWith(`${lead}\n\n`)) return `${lead}\n\n${shapeRoleLine(role)}\n\n${text.slice(lead.length + 2)}`;
        return text;
      },
      destroy() {
        destroyed = true;
        offIntent();
        offFlag();
        detach();
        mounts.delete(handle);
      },
    };
    mounts.add(handle);
    decide();    // a composer built while the Shaper pin is set shows the picker at once
    return handle;
  }

  return {
    addon: Object.freeze({ id: ROLE_PICKER_ADDON_ID, mount }),
    role: () => role,
    choose,
    openMenu,
    /** Read the profile again (Settings › Chat on each open); nothing with the flag off. */
    refresh() { if (flagOn(FLAG) === true) read(); },
    onChange(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
  };
}

/** Create the picker and register its add-on (CONTRACT §2). app.js calls this right after installIntentAddon. */
export function installRolePicker(deps) {
  const ctl = createRolePicker(deps);
  registerComposerAddon(ctl.addon);
  return ctl;
}
