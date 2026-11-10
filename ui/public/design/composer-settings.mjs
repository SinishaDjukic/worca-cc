// ui/public/design/composer-settings.mjs
// The one settings button of a Design composer (the start composer and the chat dock): a quiet cog (the account menu's Settings icon) that opens a small
// popup holding the Lead and Builders model pickers (model-pills.mjs) and the Build fast switch, so the composer row
// keeps to Attach, the project or Point, this button and Send. The popup is a side-flyout popup; each picker's menu
// opens beside it as its submenu (create the pickers with `parent: settings.panel`). No state of its own: the pickers
// and the switch stay the caller's.
import { createFlyout } from '../side-flyout.mjs';
import { icon } from '../icons.mjs';

export const SETTINGS_LABEL = 'Models and Build fast';

let seq = 0;

/**
 * @param {{doc: Document, win?: Window, mode?: 'up'|'down'}} o  `mode`: where the popup opens from the button.
 * @returns {{el: HTMLElement, btn: HTMLButtonElement, panel: HTMLElement, fill: (...rows: Node[]) => void,
 *   divider: () => HTMLElement, close: () => void, destroy: () => void}}
 *   `el` goes in the composer row; `fill` puts the rows in the popup.
 */
export function createComposerSettings({ doc, win = doc.defaultView || globalThis, mode = 'up' }) {
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
  const fly = createFlyout({ doc, win, trigger: btn, menu: panel, mode });
  return {
    el, btn, panel,
    fill: (...rows) => panel.replaceChildren(...rows),
    divider() {
      const d = doc.createElement('div');
      d.className = 'ask-pop-divider';
      return d;
    },
    close: () => { if (fly.isOpen()) fly.close(); },
    destroy() { fly.destroy(); el.remove(); },
  };
}
