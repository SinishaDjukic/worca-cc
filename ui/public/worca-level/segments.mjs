// ui/public/worca-level/segments.mjs — the segment bar: one span per step toward the next level.
// Pure DOM building, no styling. Used by the hover card, the menu card, the Profile page and the
// existing-user welcome. The bar is a progressbar; a `sm` bar of more than DENSE_SEGMENTS segments
// carries data-gap="2" so the stylesheet can tighten the gap.

const DENSE_SEGMENTS = 10;
const DENSE_GAP_PX = '2';

const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);

export function renderSegments(doc, { done, total }, { size = 'sm' } = {}) {
  const count = Math.max(0, Math.floor(Number(total) || 0));
  const filled = clamp(Math.floor(Number(done) || 0), 0, count);
  const bar = doc.createElement('div');
  bar.className = 'wl-seg';
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-valuenow', filled);
  bar.setAttribute('aria-valuemax', count);
  bar.setAttribute('data-size', size);
  if (size === 'sm' && count > DENSE_SEGMENTS) bar.setAttribute('data-gap', DENSE_GAP_PX);
  for (let i = 0; i < count; i += 1) {
    const seg = doc.createElement('span');
    seg.className = 'wl-seg-i';
    if (i < filled) seg.setAttribute('data-done', 'true');
    bar.appendChild(seg);
  }
  return bar;
}
