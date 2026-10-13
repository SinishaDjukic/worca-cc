// extension/src/ext-api.mjs — one name for the WebExtension API: Firefox's promise-based `browser`, else Chrome's `chrome`
// (MV3 Chrome APIs return promises too).
// A page element id="browser" could clobber the global in a content script; require a real runtime first.
export const api = globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome;
export { BROWSER, TEST_BUILD } from './build-flags.mjs';   // re-export only; see build-flags.mjs
export const STORAGE_KEYS = Object.freeze({ baseUrl: 'worca.baseUrl', token: 'worca.token', pairedId: 'worca.pairedId', theme: 'worca.theme' });
