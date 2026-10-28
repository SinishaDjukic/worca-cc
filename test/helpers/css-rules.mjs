// test/helpers/css-rules.mjs — every style rule of a stylesheet as { sel, body, line, media }. Comments are blanked
// with their newlines kept, so `line` is the real line; @media/@container wrappers are walked through (their heads,
// joined, are `media`), @keyframes are skipped. Shared by ui-design-language and dialog-layout tests.
export function cssRules(text) {
  const src = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const out = []; const stack = []; let start = 0; let line = 1;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '\n') line += 1;
    else if (ch === '{') { stack.push({ head: src.slice(start, i).trim(), at: i + 1, line }); start = i + 1; }
    else if (ch === '}') {
      const open = stack.pop();
      const inKeyframes = stack.some((s) => /^@(-webkit-)?keyframes/.test(s.head));
      if (open && !open.head.startsWith('@') && !inKeyframes) {
        out.push({ sel: open.head.replace(/\s+/g, ' '), body: src.slice(open.at, i), line: open.line, media: stack.map((s) => s.head).join(' ') });
      }
      start = i + 1;
    } else if (ch === ';' && (!stack.length || stack.at(-1).head.startsWith('@'))) start = i + 1;
  }
  return out;
}
