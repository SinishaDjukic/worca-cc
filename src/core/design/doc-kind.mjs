// src/core/design/doc-kind.mjs
// The `document` kind's own pieces: its page sizes (worca sets the canvas from `page`), the print CSS worca puts in a
// document's head outside `build`, and the contents list it makes from the sections' headings. Pure: it reads no disk.

import { boundedParser } from './html-scan.mjs';

/** A document's printed page: the column width in CSS px at 96 dpi, and the `@page` size keyword. */
export const PAGE_SIZES = Object.freeze({
  A4: Object.freeze({ w: 794, css: 'A4' }),
  Letter: Object.freeze({ w: 816, css: 'letter' }),
});

/**
 * The column width of `page` in CSS px, A4's for anything that is not a page size.
 * @param {unknown} page
 * @returns {number}
 */
export function pageWidth(page) {
  return (typeof page === 'string' && Object.hasOwn(PAGE_SIZES, page) ? PAGE_SIZES[page] : PAGE_SIZES.A4).w;
}

/** What a CSS string may hold as itself; anything else is a hex escape, so model text never ends the string, the
 *  comment or the style it sits in. */
const CSS_SAFE = /[A-Za-z0-9 .,:;!?'()&+\-_/]/;
const MAX_TITLE = 120;

/**
 * `s` as a double-quoted CSS string: every character outside a small safe set becomes `\HHHHHH ` (six hex digits and
 * the space that ends the escape), so the result never holds `<`, a `"` of its own, a newline or `*` + `/`. At most
 * 120 characters of `s` (the plan's title cap) are read.
 * @param {unknown} s
 * @returns {string}
 */
export function cssString(s) {
  let out = '';
  for (const ch of [...String(s ?? '')].slice(0, MAX_TITLE)) {
    out += CSS_SAFE.test(ch) ? ch : `\\${ch.codePointAt(0).toString(16).toUpperCase().padStart(6, '0')} `;
  }
  return `"${out}"`;
}

/**
 * worca's print CSS for a document, which `kindHead` puts first in its head outside `build`: the page size and
 * margins, the page number and (after the first page) the title in the margin, the break rules, a light print, the
 * contents list's structure, and with `numbered` the heading counters the contents list's numbers match. Margin boxes
 * and the list inherit the document's font and colour: this CSS holds no colour, so any look applies.
 * @param {{ page?: unknown, numbered?: boolean, title?: unknown }} opts
 * @returns {string}
 */
export function documentCss({ page, numbered = false, title = '' } = {}) {
  const size = (typeof page === 'string' && Object.hasOwn(PAGE_SIZES, page) ? PAGE_SIZES[page] : PAGE_SIZES.A4).css;
  const hasTitle = typeof title === 'string' && title.trim() !== '';
  const rules = [
    `@page{size:${size};margin:18mm 16mm 20mm;@bottom-right{content:counter(page);font-size:9pt}${hasTitle ? `@top-left{content:${cssString(title.trim())};font-size:9pt}` : ''}}`,
    hasTitle ? '@page:first{@top-left{content:none}}' : '',
    '@media print{:root{color-scheme:light!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}'
      + 'h1,h2,h3,h4{break-after:avoid;page-break-after:avoid}'
      + 'figure,tr,.callout,pre,svg,blockquote{break-inside:avoid;page-break-inside:avoid}'
      + 'p,li{orphans:3;widows:3}'
      + '.doc-toc{break-after:page}}',
    '.doc-toc ol{list-style:none;margin:0;padding:0}',
    '.doc-toc ol ol{padding-left:1.5em}',
    '.doc-toc li{margin:.25em 0}',
    '.doc-toc-num{display:inline-block;min-width:2.5em;font-variant-numeric:tabular-nums}',
  ];
  if (numbered === true) {
    rules.push(
      'body{counter-reset:worca-h2 worca-h3}',
      '[data-section] h2{counter-increment:worca-h2;counter-set:worca-h3 0}',
      '[data-section] h3{counter-increment:worca-h3}',
      '[data-section] h2::before{content:counter(worca-h2) ". "}',
      '[data-section] h3::before{content:counter(worca-h2) "." counter(worca-h3) " "}',
    );
  }
  return rules.filter(Boolean).join('\n');
}

const HEADINGS = new Map([['h2', 2], ['h3', 3]]);
/** Elements whose content is another context, where a heading is no part of the document's outline. */
const SKIP = new Set(['svg', 'template', 'math']);
const MAX_HEADING_TEXT = 160;
const MAX_ENTRIES = 200;
const HTML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => HTML_ESC[c]);

/**
 * The `<h2>` and `<h3>` headings of one section's index.html, in document order: their decoded text (whitespace
 * collapsed, at most 160 chars; an empty heading is skipped) and their id when it is `<sectionId>-<1 to 64 of
 * A-Za-z0-9_->`, else null. Headings inside `<svg>`, `<template>` or `<math>` are no part of the outline.
 * @param {string} html
 * @param {string} sectionId
 * @returns {{ level: 2|3, text: string, id: string|null }[]}
 */
export function scanHeadings(html, sectionId) {
  const idRe = new RegExp(`^${String(sectionId).replace(/[.*+?^${}()|[\]\\]/g, (c) => `\\${c}`)}-[A-Za-z0-9_-]{1,64}$`);
  const out = [];
  let skip = 0;
  let open = null;
  const { read } = boundedParser(String(html ?? ''), {
    onopentag(name, attrs) {
      if (SKIP.has(name)) { skip += 1; return; }
      if (skip > 0 || open || !HEADINGS.has(name)) return;
      open = { name, level: HEADINGS.get(name), id: typeof attrs.id === 'string' && idRe.test(attrs.id) ? attrs.id : null, text: '' };
    },
    ontext(text) {
      if (open && skip === 0 && open.text.length <= MAX_HEADING_TEXT * 4) open.text += text;
    },
    onclosetag(name) {
      if (SKIP.has(name)) { skip = Math.max(0, skip - 1); return; }
      if (!open || name !== open.name) return;
      const text = open.text.replace(/\s+/g, ' ').trim().slice(0, MAX_HEADING_TEXT).trim();
      if (text !== '') out.push({ level: open.level, text, id: open.id });
      open = null;
    },
  });
  read();
  return out;
}

/** One contents entry: a link when the heading has a valid id, plain text otherwise, its number first. */
function tocEntry({ text, id }, num) {
  const label = id ? `<a href="#${escapeHtml(id)}">${escapeHtml(text)}</a>` : `<span>${escapeHtml(text)}</span>`;
  return `${num ? `<span class="doc-toc-num">${num}</span>` : ''}${label}`;
}

/**
 * The contents list worca puts first in a document's sections: every section's `<h2>`, in plan order, with its
 * `<h3>`s nested under it; an `<h3>` before its section's first `<h2>` is left out. All text is escaped, at most 200
 * entries are listed, and with `numbered` each entry starts with the number the heading counters show.
 * @param {{ sections: { id: string, html: string }[], numbered?: boolean }} opts
 * @returns {string} '' when no section has an `<h2>`
 */
export function tocHtml({ sections, numbered = false } = {}) {
  const items = [];
  let entries = 0;
  let h2 = 0;
  for (const { id, html } of Array.isArray(sections) ? sections : []) {
    let current = null;
    for (const head of scanHeadings(html, id)) {
      if (entries >= MAX_ENTRIES) break;
      if (head.level === 2) {
        h2 += 1;
        current = { head, num: String(h2), children: [] };
        items.push(current);
        entries += 1;
      } else if (current) {
        current.children.push(tocEntry(head, numbered ? `${current.num}.${current.children.length + 1}` : ''));
        entries += 1;
      }
    }
  }
  if (items.length === 0) return '';
  const lis = items.map(({ head, num, children }) => {
    const sub = children.length ? `<ol>${children.map((c) => `<li>${c}</li>`).join('')}</ol>` : '';
    return `<li>${tocEntry(head, numbered ? num : '')}${sub}</li>`;
  }).join('');
  return `<nav class="doc-toc" data-worca-toc aria-label="Contents"><h2 class="doc-toc-title">Contents</h2><ol>${lis}</ol></nav>\n`;
}
