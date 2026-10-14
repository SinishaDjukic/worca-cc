// extension/src/ext-api.mjs — one name for the WebExtension API: Firefox's promise-based `browser`, else Chrome's `chrome`
// (MV3 Chrome APIs return promises too).
// A page element id="browser" could clobber the global in a content script; require a real runtime first.
export const api = globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome;
export { BROWSER, DEMO_BUILD, TEST_BUILD } from './build-flags.mjs';   // re-export only; see build-flags.mjs
// pinpointOnSelect: "Show Pinpoint when I select text" (D11, absent = off); askPick: the composer's {model, effort} (D12).
export const STORAGE_KEYS = Object.freeze({ baseUrl: 'worca.baseUrl', token: 'worca.token', pairedId: 'worca.pairedId', pinpointOnSelect: 'worca.pinpointOnSelect', askPick: 'worca.askPick' });
// Keys an older build stored and nothing reads any more; the sidebar removes them at startup (the theme choice: the
// sidebar and Pinpoint now always follow the browser's colour scheme).
export const LEGACY_STORAGE_KEYS = Object.freeze(['worca.theme']);
