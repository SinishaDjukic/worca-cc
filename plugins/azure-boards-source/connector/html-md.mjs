// plugins/azure-boards-source/connector/html-md.mjs
// Azure work item HTML (description, repro steps, comments) → plain markdown. Small and dependency-free:
// headings, paragraphs, line breaks, lists, bold/italic, code, links; every other tag is dropped.
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
// Named, decimal (&#39;) and hex (&#x27;) entities; fromCodePoint so astral characters (emoji) survive (s1).
const entity = (m, e) => {
  if (e[0] !== '#') return ENT[e.toLowerCase()] ?? m;
  const n = /^#x/i.test(e) ? parseInt(e.slice(2), 16) : Number(e.slice(1));
  return Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
};
/** The URL itself when it is http(s), else null: no javascript:/data: links in either direction (s2). */
export const safeHref = (u) => (/^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim() : null);
export function htmlToMarkdown(html) {
  let s = String(html || '');
  s = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n, t) => `\n\n${'#'.repeat(Number(n))} ${t}\n\n`)
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1')
    .replace(/<\/(ul|ol)>/gi, '\n\n')
    .replace(/<(b|strong)(?=[\s>])[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**')
    .replace(/<(i|em)(?=[\s>])[^>]*>([\s\S]*?)<\/\1>/gi, '_$2_')
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => (safeHref(href) ? `[${text}](${href})` : text))
    .replace(/<\/(p|div)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, entity);
  return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

/**
 * The host's result summary (multi-line markdown: a ### heading, **bold**, `code`, "- " lists; sources.mjs
 * buildResultSummary) → the small HTML subset an Azure DevOps comment renders. Everything is escaped first.
 * "- "/"* " lines become <ul>, "1. "/"1) " lines <ol> (s2); a change of list kind closes the open list.
 */
export function markdownToHtml(md) {
  const inline = (s) => escapeHtml(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  const out = [];
  let para = [];
  let list = null;                                   // { tag: 'ul'|'ol', items: string[] }
  const endPara = () => { if (para.length) out.push(`<p>${para.join('<br>')}</p>`); para = []; };
  const endList = () => { if (list) out.push(`<${list.tag}>${list.items.join('')}</${list.tag}>`); list = null; };
  for (const line of String(md || '').split(/\r?\n/)) {
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    const li = /^\s*(?:([-*])|\d+[.)])\s+(.*)$/.exec(line);
    if (!line.trim()) { endPara(); endList(); }
    else if (h) { endPara(); endList(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); }
    else if (li) {
      endPara();
      const tag = li[1] ? 'ul' : 'ol';
      if (list && list.tag !== tag) endList();
      (list ||= { tag, items: [] }).items.push(`<li>${inline(li[2])}</li>`);
    }
    else { endList(); para.push(inline(line)); }
  }
  endPara(); endList();
  return out.join('');
}
