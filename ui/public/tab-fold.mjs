// ui/public/tab-fold.mjs — which tabs of a detail screen's row go under "More" at the width the row has (app.js
// initDetailTabs `overflow`). Pure: measured widths in, the fold out.

const px = (n) => (Number.isFinite(n) ? n : 0);

/**
 * @param {object} o
 * @param {{key:string, width:number}[]} o.row   the shown tabs of the default row, in drawn order
 * @param {{key:string, width:number}[]} o.rest  the other shown tabs, in table order
 * @param {?string} o.active  the open tab: drawn wherever it sits
 * @param {number} o.avail    the bar's inner width; not above 0 means unmeasured, which keeps the default split
 * @param {number} o.gap      the flex gap
 * @param {number} o.more     the More button's width
 * @returns {{rest:boolean, extra:string[]}}  `rest`: every `rest` tab goes under More. `extra`: the `row` keys folded
 *   for width, right to left. A narrower bar only ever adds to what a wider one folds.
 */
export function foldTabs({ row, rest, active, avail, gap, more }) {
  // By default two or more other tabs sit under More; a lone one keeps its place in the row.
  const base = rest.length >= 2;
  const fold = { rest: base, extra: [] };
  if (!(avail > 0)) return fold;
  const fits = () => {
    const folded = new Set([...(fold.rest ? rest.map((t) => t.key) : []), ...fold.extra]);
    const widths = [...row, ...rest].filter((t) => t.key === active || !folded.has(t.key)).map((t) => px(t.width));
    if (folded.size) widths.push(px(more));
    const drawn = widths.reduce((sum, w) => sum + w, 0) + px(gap) * (widths.length - 1);
    return drawn <= avail + 0.5;   // sub-pixel rounding
  };
  // What gives way, in order: a lone other tab, then the row from the right. Overview and the open tab stay.
  const queue = [
    ...(!base && rest.length === 1 && rest[0].key !== active ? [() => { fold.rest = true; }] : []),
    ...row.filter((t) => t.key !== 'overview' && t.key !== active).reverse().map((t) => () => { fold.extra.push(t.key); }),
  ];
  for (const next of queue) {
    if (fits()) break;
    next();
  }
  return fold;
}
