// ui/public/chat/shape-gate.mjs — the ONE client gate for Shape it first (spec D12). Reads the experimental feature
// flag (ui/public/flags.mjs keeps it live from the hello and `flags` frames), so every UI call site asks shapeFirstOn().
import { flagOn } from '../flags.mjs';

export function shapeFirstOn(doc) {
  return flagOn('shapeFirst', doc);
}
