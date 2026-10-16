// ui/public/chat/shape-gate.mjs — the ONE client gate for Shape it first (spec D12). Reads the experimental feature
// flag (ui/public/flags.mjs keeps it live from the hello and `flags` frames), so every UI call site asks shapeFirstOn().
import { flagOn, onFlagChange } from '../flags.mjs';

export function shapeFirstOn(doc) {
  return !!(doc || globalThis.document) && flagOn('shapeFirst', doc);   // no document (a module loaded outside a page): off
}

/** Call `fn(on)` whenever the flag flips. Returns an unsubscribe function. */
export function onShapeFirstChange(fn) {
  return onFlagChange('shapeFirst', fn);
}
