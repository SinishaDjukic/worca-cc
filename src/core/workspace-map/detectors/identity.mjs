// src/core/workspace-map/detectors/identity.mjs
// Who a member is: its names (checkout dir, projectKey, project dir) as aliases, and its role
// from the README's first paragraph. The origin-remote alias is extract.mjs's (it needs git).

import { basename } from 'node:path';

import { LIMITS } from '../../../shared/workspace-map/limits.mjs';

const README_RE = /^readme(\.(md|markdown|rst|txt|adoc))?$/i;
const SKIP_LINE_RE = /^(#|\[!\[|!\[|<|\||>|\.\. |[-*+]\s|\d+\.\s)/;
const UNDERLINE_RE = /^[=\-~^*]{3,}$/;

function clipRole(text) {
  if (text.length <= LIMITS.ROLE_MAX) return text;
  const cut = text.slice(0, LIMITS.ROLE_MAX - 1);
  const sp = cut.lastIndexOf(' ');
  return (sp > 40 ? cut.slice(0, sp) : cut).trimEnd() + '…';
}

/** The README's first prose paragraph, markdown stripped, one line. '' when there is none. */
export function readmeRole(text) {
  const lines = String(text).split(/\r?\n/);
  const para = [];
  let fence = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (/^(```|~~~)/.test(line)) { fence = !fence; if (para.length) break; continue; }
    if (fence) continue;
    if (!line) { if (para.length) break; continue; }
    if (UNDERLINE_RE.test((lines[i + 1] || '').trim())) { if (para.length) break; i += 1; continue; }
    if (SKIP_LINE_RE.test(line) || UNDERLINE_RE.test(line)) { if (para.length) break; continue; }
    para.push(line);
  }
  // Only the first ROLE_MAX characters survive: never run the link regexes over a 1 MiB paragraph.
  const flat = para.join(' ').slice(0, 4096)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return flat ? clipRole(flat) : '';
}

export default {
  id: 'identity',
  claims: (rel) => !rel.includes('/') && README_RE.test(rel),
  detect(file) {
    const text = readmeRole(file.text);
    return text ? { role: { text, source: 'readme' } } : {};
  },
  finish(ctx) {
    const m = ctx.member;
    const values = [m.dir && basename(m.dir), m.key, m.projectDir && basename(m.projectDir)]
      .filter((v) => typeof v === 'string' && v.trim())
      .map((v) => v.trim().toLowerCase());
    return { aliases: [...new Set(values)].map((value) => ({ value, source: 'identity' })) };
  },
};
