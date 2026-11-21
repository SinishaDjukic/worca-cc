// ui/public/chat/extensions.mjs — the Chat page's extension points (worca Chat CONTRACT §2). Card builders by card
// type and composer add-ons, in registration order. Pure: module state only, nothing touched at import. app.js (or
// a module it imports) registers BEFORE createAskPanel runs; ui/public/ask-panel.mjs reads the registry at render.

const cards = new Map();
const addons = [];

/** A builder for card `type`: build(block, ctx) -> { el, handle?, dispose?, animate? }. A registered type wins over
 *  ask-panel's built-in builder of the same type; registering a type again replaces its builder. */
export function registerChatCard(type, build) {
  if (typeof type !== 'string' || !type) throw new TypeError('registerChatCard: type must be a non-empty string');
  if (typeof build !== 'function') throw new TypeError('registerChatCard: build must be a function');
  cards.set(type, build);
}

/** The registered builder for `type`, or null. */
export function chatCardBuilder(type) {
  return typeof type === 'string' && cards.has(type) ? cards.get(type) : null;
}

/** A composer add-on: { id, mount(leadEl, ctx) -> { update(thread), beforeSend(text) -> boolean | Promise<boolean>,
 *  destroy() } }. Ids are unique: registering an id again replaces that add-on where it stood. */
export function registerComposerAddon(addon) {
  if (!addon || typeof addon !== 'object' || typeof addon.id !== 'string' || !addon.id) {
    throw new TypeError('registerComposerAddon: addon.id must be a non-empty string');
  }
  if (typeof addon.mount !== 'function') throw new TypeError('registerComposerAddon: addon.mount must be a function');
  const at = addons.findIndex((a) => a.id === addon.id);
  if (at >= 0) addons[at] = addon;
  else addons.push(addon);
}

/** Every add-on in registration order (a copy). */
export function composerAddons() {
  return addons.slice();
}

/** Tests only: forget every registration. */
export function _resetChatExtensions() {
  cards.clear();
  addons.length = 0;
}
