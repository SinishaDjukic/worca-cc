// ui/public/design/composer-settings.mjs
// The one settings button of a Design composer (the start composer and the chat dock): a quiet cog (the account menu's Settings icon) that opens a small
// popup holding the Lead and Builders model pickers (model-pills.mjs), the Build fast switch, the Pictures row and, in
// the chat dock, the Sound row, so the
// composer row keeps to Attach, the project or Point, this button and Send. The popup is a side-flyout popup; each
// picker's menu opens beside it as its submenu (create the pickers with `parent: settings.panel`). No state of its own:
// the pickers and the switches stay the caller's. The Pictures row (createPicturesRow) keeps one state, the last good
// answer of GET /api/images; the chat dock's Sound row (createSoundRow) the last good answer of the design's sound.
import { createFlyout } from '../side-flyout.mjs';
import { icon } from '../icons.mjs';
import { makeSwitch } from '../switch.mjs';
import { DESIGN_PICTURES_DEFAULT } from '../../../src/shared/design-names.mjs';
import { soundSummary } from '../../../src/shared/sound-services.mjs';

export const SETTINGS_LABEL = 'Models and Build fast';

/** The image service's state (Part A's `imagesState`): `configured` is false unless it can make a picture. */
const IMAGES_URL = '/api/images';
/** The Providers page's Image generation row. */
const SETUP_HREF = '#providers/images';

let seq = 0;

/**
 * @param {{doc: Document, win?: Window, mode?: 'up'|'down', onOpen?: () => void}} o  `mode`: where the popup opens from
 *   the button; `onOpen`: called once per open, after the popup is placed.
 * @returns {{el: HTMLElement, btn: HTMLButtonElement, panel: HTMLElement, fill: (...rows: Node[]) => void,
 *   divider: () => HTMLElement, close: () => void, reposition: () => void, destroy: () => void}}
 *   `el` goes in the composer row; `fill` puts the rows in the popup; `reposition` places an open popup again after
 *   its rows changed.
 */
export function createComposerSettings({ doc, win = doc.defaultView || globalThis, mode = 'up', onOpen = () => {} }) {
  const el = doc.createElement('span');
  el.className = 'dz-set';
  const btn = doc.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-quiet btn-icon dz-set-btn';
  btn.title = SETTINGS_LABEL;
  btn.setAttribute('aria-label', SETTINGS_LABEL);
  btn.setAttribute('aria-haspopup', 'true');
  btn.setAttribute('aria-expanded', 'false');
  btn.append(icon(doc, 'settings', 16));
  const panel = doc.createElement('div');
  panel.className = 'menu dz-set-pop';
  panel.id = `dz-set-pop-${++seq}`;
  panel.setAttribute('role', 'group');
  panel.setAttribute('aria-label', SETTINGS_LABEL);
  panel.hidden = true;
  btn.setAttribute('aria-controls', panel.id);
  el.append(btn, panel);
  const fly = createFlyout({ doc, win, trigger: btn, menu: panel, mode, onOpen });
  return {
    el, btn, panel,
    fill: (...rows) => panel.replaceChildren(...rows),
    divider() {
      const d = doc.createElement('div');
      d.className = 'ask-pop-divider';
      return d;
    },
    close: () => { if (fly.isOpen()) fly.close(); },
    reposition: () => fly.reposition(),
    destroy() { fly.destroy(); el.remove(); },
  };
}

/**
 * Reads a GET /api/images answer: null unless `configured` is a boolean (no answer, or not one). `ready` is
 * `configured`, which is already false when the key does not resolve, so a missing key reads Set up.
 * @param {unknown} body
 * @returns {{ready: boolean, model: string} | null}
 */
export function readImages(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.configured !== 'boolean') return null;
  return { ready: body.configured, model: typeof body.model === 'string' ? body.model : '' };
}

/**
 * The gear's Pictures row (SPEC D7): `Pictures`, the model's id and a switch while the image service is ready, else
 * `Pictures` and `Set up`, which leads to the Providers row. Hidden until GET /api/images gives a good answer. The
 * caller owns what the switch means (a new design's field, or the design's PATCH) and calls `load()` when the composer
 * is made and at each open of the gear.
 * @param {{doc: Document, fetch: Function, checked?: boolean}} o
 * @returns {{el: HTMLElement, input: HTMLInputElement, ready: () => boolean, load: () => Promise<boolean>}}
 *   `ready()`: the switch is shown. `load()` asks again and resolves true exactly when what the row shows changed.
 */
export function createPicturesRow({ doc, fetch: fetchFn, checked = DESIGN_PICTURES_DEFAULT }) {
  const el = doc.createElement('div');
  el.className = 'dz-pics';
  el.hidden = true;
  const sw = makeSwitch(doc, { label: 'Pictures', ariaLabel: 'Pictures', checked, rowClass: 'dz-fast dz-pics-on', inputClass: 'dz-pics-input' });
  const modelEl = doc.createElement('span');
  modelEl.className = 'dz-fast-n dz-pics-model';
  sw.row.append(modelEl);
  const off = doc.createElement('div');
  off.className = 'dz-fast dz-pics-off';
  const offLabel = doc.createElement('span');
  offLabel.className = 'switch-label';
  offLabel.textContent = 'Pictures';
  const setup = doc.createElement('a');
  setup.className = 'dz-pics-setup';
  setup.setAttribute('href', SETUP_HREF);
  setup.setAttribute('data-nav', '');                  // a click closes the gear's popup on its way to the page
  setup.textContent = 'Set up';
  off.append(offLabel, setup);
  el.append(sw.row, off);

  let shown = null;    // the last good answer, as painted: {ready, model}
  let asked = 0;       // numbers the asks: only the newest answer is painted

  function paint() {
    el.hidden = !shown;
    sw.row.hidden = !shown || !shown.ready;
    off.hidden = !shown || shown.ready;
    modelEl.textContent = shown && shown.ready ? shown.model : '';
    modelEl.title = modelEl.textContent;
  }
  async function load() {
    const my = ++asked;
    let got = null;
    try {
      const res = await fetchFn(IMAGES_URL);
      got = res.ok ? readImages(await res.json()) : null;
    } catch {
      got = null;
    }
    if (my !== asked || !got) return false;
    const changed = !shown || shown.ready !== got.ready || (got.ready && shown.model !== got.model);
    shown = got;
    if (changed) paint();
    return changed;
  }

  paint();
  return { el, input: sw.input, ready: () => !!shown && shown.ready, load };
}

/**
 * The chat dock's Sound row (SPEC U6, §7): `Sound`, the design's sound in one line (`Off`, or the voice and the music)
 * and a quiet `Change`, which puts the sound card in the design's chat. Only a video has it, and only once
 * GET /api/design/:id/sound says sound is available here: until then, for another kind (which asks nothing) and after
 * an answer saying it is not, the row and its own divider stay hidden. The caller calls `load()` when the dock is made
 * and at each open of the gear; the newest answer wins and a failed request keeps the last good one. `Change` posts
 * once, held while out, and hands the caller `{close, note}`: close the popup (the card is in the chat, or one already
 * is), and what to say in the composer's note ('' for nothing).
 * @param {{doc: Document, fetch: Function, designId: string, kind?: string,
 *   onResult?: (r: {close: boolean, note: string}) => void}} o
 * @returns {{el: HTMLElement, divider: HTMLElement, load: () => Promise<boolean>}}  `load()` resolves true exactly when
 *   what the row shows changed.
 */
export function createSoundRow({ doc, fetch: fetchFn, designId, kind, onResult = () => {} }) {
  const url = `/api/design/${encodeURIComponent(designId)}/sound`;
  const divider = doc.createElement('div');
  divider.className = 'ask-pop-divider';
  const el = doc.createElement('div');
  el.className = 'dz-fast dz-sound-row';
  const label = doc.createElement('span');
  label.className = 'switch-label';
  label.textContent = 'Sound';
  const sum = doc.createElement('span');
  sum.className = 'dz-sound-sum';
  const change = doc.createElement('button');
  change.type = 'button';
  change.className = 'btn btn-sm btn-quiet dz-sound-change';
  change.textContent = 'Change';
  el.append(label, sum, change);

  const own = kind === 'video' && typeof designId === 'string' && designId !== '';
  let shown = null;    // the last good answer, as painted: {available, summary}
  let asked = 0;       // numbers the asks: only the newest answer is painted
  let busy = false;

  function paint() {
    el.hidden = !shown || !shown.available;
    divider.hidden = el.hidden;
    sum.textContent = shown && shown.available ? shown.summary : '';
    sum.title = sum.textContent;
  }
  async function load() {
    if (!own) return false;
    const my = ++asked;
    let got = null;
    try {
      const res = await fetchFn(url);
      const body = res.ok ? await res.json() : null;
      got = body && typeof body === 'object' && typeof body.available === 'boolean' ? { available: body.available, summary: soundSummary(body.sound) } : null;
    } catch {
      got = null;
    }
    if (my !== asked || !got) return false;
    const changed = !shown || shown.available !== got.available || shown.summary !== got.summary;
    shown = got;
    if (changed) paint();
    return changed;
  }
  change.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    change.disabled = true;
    let status = 0;
    let body = null;
    try {
      const res = await fetchFn(`${url}/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      status = Number.isSafeInteger(res.status) ? res.status : 0;
      if (status === 409) body = await res.json().catch(() => null);
    } catch {
      status = 0;
    }
    busy = false;
    change.disabled = false;
    const said = body && typeof body.error === 'string' ? body.error.trim() : '';
    if (status === 201) onResult({ close: true, note: '' });
    else if (said) onResult({ close: true, note: said });
    else onResult({ close: status === 409, note: `Sound was not opened (HTTP ${status}).` });
  });

  paint();
  return { el, divider, load };
}
