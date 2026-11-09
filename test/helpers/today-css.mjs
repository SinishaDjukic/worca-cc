// test/helpers/today-css.mjs — today's design system: the app's assembled stylesheet without the Stillhet (Rail) parts.
// The seven Rail parts are the last entries of ui/public/parts.json (test/rail-parts-scope.test.mjs pins it) and each rule
// in them scopes on :root[data-rail] or names a library-only class, so the lint tests of today's look (tokens, radii,
// heights, rule order) read everything before the first Rail part. Rail's own rules are held by its gates (docs/rail/gate.md).
import { readStyleCss } from '../../src/core/read-style-css.mjs';

export const RAIL_FIRST = '/* ---------- Rail: look ---------- */';
export function readTodayCss() {
  const css = readStyleCss();
  const at = css.indexOf(RAIL_FIRST);
  return at === -1 ? css : css.slice(0, at);
}
