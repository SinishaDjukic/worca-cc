// plugins/jira-source/connector/markup.mjs
// Jira's rendered HTML (renderedFields: description, comments) → plain markdown, and the host's result summary
// (markdown) → Jira wiki markup for a comment. Small and dependency-free: headings, paragraphs, line breaks,
// lists, bold/italic, code, links; every other tag is dropped.
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
// Named, decimal (&#39;) and hex (&#x27;) entities; fromCodePoint so astral characters (emoji) survive.
const entity = (m, e) => {
  if (e[0] !== '#') return ENT[e.toLowerCase()] ?? m;
  const n = /^#x/i.test(e) ? parseInt(e.slice(2), 16) : Number(e.slice(1));
  return Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
};
/** The URL itself when it is http(s), else null: no javascript:/data: links in either direction. */
export const safeHref = (u) => (/^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim() : null);

export function htmlToMarkdown(html) {
  let s = String(html || '');
  s = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    // Code panels first, so the tag rules below do not touch their content (it is unescaped at the end).
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, code) => `\n\n\`\`\`\n${code.replace(/<[^>]+>/g, '')}\n\`\`\`\n\n`)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n, t) => `\n\n${'#'.repeat(Number(n))} ${t}\n\n`)
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1')
    .replace(/<\/(ul|ol)>/gi, '\n\n')
    .replace(/<(b|strong)(?=[\s>])[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**')
    .replace(/<(i|em)(?=[\s>])[^>]*>([\s\S]*?)<\/\1>/gi, '_$2_')
    .replace(/<(code|tt)(?=[\s>])[^>]*>([\s\S]*?)<\/\1>/gi, '`$2`')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => {
      const h = safeHref(href.replace(/&amp;/g, '&'));
      return h ? `[${text}](${h})` : text;
    })
    .replace(/<\/(p|div)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, entity);
  return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Characters wiki markup reads as syntax inside plain text: links [..], macros {..}, table cells |.
const escapeWiki = (s) => String(s).replace(/[[\]{}|\\]/g, (ch) => `\\${ch}`);
/** A link as wiki markup; any scheme but http(s) is shown as escaped text, never as a link. */
export const wikiLink = (title, url) => {
  const h = safeHref(url);
  const t = String(title || url || '').replace(/[[\]|]/g, ' ').trim();
  return h ? `[${t || h}|${h.replace(/[\]|]/g, encodeURIComponent)}]` : escapeWiki(title || url || '');
};

/**
 * The host's result summary (multi-line markdown: a ### heading, **bold**, `code`, "- " lists; sources.mjs
 * buildResultSummary) → Jira wiki markup, which a v2 comment body renders on Cloud and Data Center alike.
 * Text is escaped first, so "[major]" stays text instead of becoming a broken link.
 */
export function markdownToWiki(md) {
  const inline = (s) => String(s).split(/(`[^`]+`)/).map((part) => {
    if (/^`[^`]+`$/.test(part)) return `{{${part.slice(1, -1).replace(/[{}]/g, (ch) => `\\${ch}`)}}}`;
    return escapeWiki(part).replace(/\*\*([^*]+)\*\*/g, '*$1*');
  }).join('');
  const out = [];
  for (const line of String(md || '').split(/\r?\n/)) {
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    const li = /^\s*(?:([-*])|\d+[.)])\s+(.*)$/.exec(line);
    if (h) out.push(`h${h[1].length}. ${inline(h[2])}`);
    else if (li) out.push(`${li[1] ? '*' : '#'} ${inline(li[2])}`);
    else out.push(inline(line));
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
