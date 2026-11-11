// ui/public/brand-marks.mjs — third-party product marks in small mono form (#1104). A mark names a product worca works
// with; it is never worca branding and implies no endorsement, so it stands beside the product's name. An id is here
// only once its brand's rules are checked: docs/brand-marks.md records each one's status, source and licence, and an
// id not in BRAND_MARKS gets the generic icon. Artwork is unaltered, filled with currentColor; .brand-mark sets the
// neutral ink colour, so a coloured chip never tints a logo. Built from this module's own literals, never from data.
//
// GitHub mark and Copilot icon: Primer Octicons, Copyright (c) 2026 GitHub Inc., MIT; GitHub's logo rules apply
// (https://brand.github.com/foundations/logo). Goose glyph: aaif-goose/goose, Apache-2.0.
import { icon } from './icons.mjs';
import { vendorOf } from '../../src/shared/model-vendor.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';
const GENERIC = 'cube';

export const BRAND_MARKS = Object.freeze({
  github: Object.freeze({ paths: ['M10.226 17.284c-2.965-.36-5.054-2.493-5.054-5.256 0-1.123.404-2.336 1.078-3.144-.292-.741-.247-2.314.09-2.965.898-.112 2.111.36 2.83 1.01.853-.269 1.752-.404 2.853-.404 1.1 0 1.999.135 2.807.382.696-.629 1.932-1.1 2.83-.988.315.606.36 2.179.067 2.942.72.854 1.101 2 1.101 3.167 0 2.763-2.089 4.852-5.098 5.234.763.494 1.28 1.572 1.28 2.807v2.336c0 .674.561 1.056 1.235.786 4.066-1.55 7.255-5.615 7.255-10.646C23.5 6.188 18.334 1 11.978 1 5.62 1 .5 6.188.5 12.545c0 4.986 3.167 9.12 7.435 10.669.606.225 1.19-.18 1.19-.786V20.63a2.9 2.9 0 0 1-1.078.224c-1.483 0-2.359-.808-2.987-2.313-.247-.607-.517-.966-1.034-1.033-.27-.023-.359-.135-.359-.27 0-.27.45-.471.898-.471.652 0 1.213.404 1.797 1.235.45.651.921.943 1.483.943.561 0 .92-.202 1.437-.719.382-.381.674-.718.944-.943'] }),
  copilot: Object.freeze({ paths: ['M23.922 16.992c-.861 1.495-5.859 5.023-11.922 5.023-6.063 0-11.061-3.528-11.922-5.023A.641.641 0 0 1 0 16.736v-2.869a.841.841 0 0 1 .053-.22c.372-.935 1.347-2.292 2.605-2.656.167-.429.414-1.055.644-1.517a10.195 10.195 0 0 1-.052-1.086c0-1.331.282-2.499 1.132-3.368.397-.406.89-.717 1.474-.952 1.399-1.136 3.392-2.093 6.122-2.093 2.731 0 4.767.957 6.166 2.093.584.235 1.077.546 1.474.952.85.869 1.132 2.037 1.132 3.368 0 .368-.014.733-.052 1.086.23.462.477 1.088.644 1.517 1.258.364 2.233 1.721 2.605 2.656a.832.832 0 0 1 .053.22v2.869a.641.641 0 0 1-.078.256ZM12.172 11h-.344a4.323 4.323 0 0 1-.355.508C10.703 12.455 9.555 13 7.965 13c-1.725 0-2.989-.359-3.782-1.259a2.005 2.005 0 0 1-.085-.104L4 11.741v6.585c1.435.779 4.514 2.179 8 2.179 3.486 0 6.565-1.4 8-2.179v-6.585l-.098-.104s-.033.045-.085.104c-.793.9-2.057 1.259-3.782 1.259-1.59 0-2.738-.545-3.508-1.492a4.323 4.323 0 0 1-.355-.508h-.016.016Zm.641-2.935c.136 1.057.403 1.913.878 2.497.442.544 1.134.938 2.344.938 1.573 0 2.292-.337 2.657-.751.384-.435.558-1.15.558-2.361 0-1.14-.243-1.847-.705-2.319-.477-.488-1.319-.862-2.824-1.025-1.487-.161-2.192.138-2.533.529-.269.307-.437.808-.438 1.578v.021c0 .265.021.562.063.893Zm-1.626 0c.042-.331.063-.628.063-.894v-.02c-.001-.77-.169-1.271-.438-1.578-.341-.391-1.046-.69-2.533-.529-1.505.163-2.347.537-2.824 1.025-.462.472-.705 1.179-.705 2.319 0 1.211.175 1.926.558 2.361.365.414 1.084.751 2.657.751 1.21 0 1.902-.394 2.344-.938.475-.584.742-1.44.878-2.497Z', 'M14.5 14.25a1 1 0 0 1 1 1v2a1 1 0 0 1-2 0v-2a1 1 0 0 1 1-1Zm-5 0a1 1 0 0 1 1 1v2a1 1 0 0 1-2 0v-2a1 1 0 0 1 1-1Z'] }),
  goose: Object.freeze({ viewBox: '0 0 600 600', paths: ['M455.145 485.687C473.786 481.639 493.559 470.622 493.559 470.622L458.952 442.115C441.844 428.034 427.282 411.116 415.898 392.108C400.167 365.845 378.431 343.683 352.485 327.445L339.813 320.066C335.471 317.048 332.444 312.344 332.013 307.037C331.737 303.615 332.557 300.556 334.47 297.864C341.068 288.564 375.172 248.097 381.422 242.926C389.471 236.273 398.44 230.739 406.761 224.403C407.944 223.501 409.131 222.604 410.3 221.689C410.341 221.648 410.4 221.616 410.436 221.58C413.106 219.472 415.626 217.233 417.629 214.578C424.862 206.202 426.62 198.797 427.051 195.52C426.072 192.366 423.153 185.314 415.018 177.179C420.117 177.492 426.29 181.525 431.887 186.27C435.644 180.265 439.578 173.92 443.507 167.562C446.131 163.315 442.238 160.138 442.129 160.039L442.107 160.034C442.107 160.034 442.107 160.016 442.102 160.012C442.002 159.903 438.825 156.01 434.588 158.634C425.528 164.24 416.473 169.851 408.42 174.949C408.42 174.949 398.875 174.75 387.572 184.512C384.912 186.52 382.673 189.039 380.57 191.704C380.529 191.745 380.493 191.799 380.461 191.84C379.541 193.005 378.644 194.192 377.747 195.38C371.406 203.705 365.877 212.67 359.224 220.719C354.057 226.973 313.586 261.072 304.286 267.671C301.594 269.584 298.539 270.408 295.113 270.127C289.811 269.701 285.102 266.669 282.083 262.328L274.705 249.656C258.467 223.701 236.305 201.974 210.042 186.243C191.034 174.859 174.12 160.292 160.035 143.188L131.519 108.581C131.519 108.581 120.497 128.35 116.454 146.995C122.078 153.834 136.749 170.807 153.826 183.769C135.466 175.135 121.893 168.459 111.188 162.876C109.538 175.085 110.182 193.549 111.881 207.848C123.47 212.919 143.202 220.732 163.289 224.884C147.222 228.641 129.597 229.325 115.987 229.058C118.385 237.909 121.72 246.937 126.207 256.019C128.115 260.22 130.204 264.322 132.461 268.337C139.663 270.318 167.939 274.437 182.985 271.056C168.016 276.4 142.885 285.378 142.885 285.378C162.187 309.393 183.52 328.931 183.52 328.931C215.969 311.483 223.366 309.099 247.703 293.182C208.292 325.251 198.063 338.344 187 351.8L179.291 362.618C175.285 368.238 171.809 374.207 168.904 380.465C159.183 401.381 145.423 445.949 145.423 445.949C142.967 453.717 148.659 459.41 156.2 456.727C156.2 456.727 200.76 442.967 221.684 433.246C227.939 430.336 233.917 426.86 239.532 422.858L250.35 415.149C253.98 412.163 257.588 409.235 261.549 405.782C261.549 405.782 288.782 438.045 316.776 459.269C316.776 459.269 325.755 434.139 331.098 419.169C327.712 434.22 331.832 462.496 333.817 469.693C337.823 471.95 341.934 474.039 346.135 475.947C355.222 480.438 364.245 483.77 373.097 486.167C372.834 472.553 373.514 454.932 377.271 438.866C381.422 458.952 389.231 478.689 394.307 490.273C408.605 491.973 427.069 492.616 439.279 490.966C433.695 480.262 427.019 466.679 418.386 448.329C431.347 465.406 448.32 480.076 455.159 485.7L455.145 485.687Z'] }),
});

// An engine with a maker's mark rather than its own id. Every other engine's id is its brand id.
const ENGINE_BRAND = Object.freeze({ codex: 'openai' });

export const hasBrandMark = (id) => typeof id === 'string' && Object.hasOwn(BRAND_MARKS, id);

/** span.brand-mark[data-brand] > svg: the mark of `id`, else the generic icon (data-brand "generic"), else null with
 *  `fallback: false`. Decorative beside the visible name; `label` names a mark that stands without one. */
export function brandMark(doc, id, { size = 14, fallback = true, label = '' } = {}) {
  const known = hasBrandMark(id);
  if (!known && !fallback) return null;
  const span = doc.createElement('span');
  span.className = 'brand-mark';
  span.dataset.brand = known ? id : 'generic';
  if (label) { span.setAttribute('role', 'img'); span.setAttribute('aria-label', label); span.title = label; }
  else span.setAttribute('aria-hidden', 'true');
  if (!known) { span.append(icon(doc, GENERIC, size)); return span; }
  const svg = doc.createElementNS(SVG_NS, 'svg');
  const mark = BRAND_MARKS[id];
  for (const [k, v] of Object.entries({ viewBox: mark.viewBox ?? '0 0 24 24', width: String(size), height: String(size), fill: 'currentColor', 'aria-hidden': 'true', focusable: 'false' })) svg.setAttribute(k, v);
  for (const d of mark.paths) {
    const p = doc.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  span.append(svg);
  return span;
}

/** The mark of an engine id (src/shared/engine-switch.mjs). */
export function engineMark(doc, engine, opts) {
  return brandMark(doc, typeof engine === 'string' && Object.hasOwn(ENGINE_BRAND, engine) ? ENGINE_BRAND[engine] : engine, opts);
}

/** The mark of a model's maker, whichever engine or provider serves it. The generic icon tells rows apart only once some
 *  maker's mark is cleared; until then a row wears nothing (an empty fragment, so callers can always append the result). */
export function modelMark(doc, row, opts) {
  const fallback = hasBrandMark('anthropic') || hasBrandMark('openai');
  return brandMark(doc, vendorOf(row), { ...opts, fallback }) ?? doc.createDocumentFragment();
}
