// src/core/house-brief.mjs — the per-project house brief: a deterministic digest of the project's worca memory
// (trap/defect-class files as the known-bug list), CLAUDE.md, the design tokens in style.css, a one-line index of
// components, card types, endpoints and workflows, and the open specs in plans/, kept within a word budget. Pinned
// lines are stored apart and merged into every build; a build happens only when the source hash or the pins change.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeJsonAtomic } from './json-atomic.mjs';
import { projectStorePath } from './store.mjs';
import { listMemory, readMemory, memoryRoot, projectScope } from './memory-store.mjs';
import { listMemberFiles, readText, isTestPath } from './workspace-map/files.mjs';
import { proseWords } from '../shared/human-estimate.mjs';

export const HOUSE_BRIEF_WORD_BUDGET = 2000;
export const HOUSE_BRIEF_FILE = 'house-brief.json';
export const HOUSE_BRIEF_PINS_FILE = 'house-brief-pins.json';
export const PIN_MAX_LINES = 20;
export const PIN_MAX_CHARS = 240;
const LINE_MAX_CHARS = 240;
const SOURCE_MAX_BYTES = 4 * 1024 * 1024; // ui/public/app.js is ~1.9 MB

// Brief order, highest priority first. The budget trims from the LAST section upward: the index
// (endpoints, components, card types, workflows, tokens) goes before specs, memory, CLAUDE.md and
// known bugs. Pinned lines are never trimmed.
export const SECTIONS = Object.freeze([
  { kind: 'pinned', title: 'Pinned', trim: false },
  { kind: 'known-bugs', title: 'Known bugs (memory traps)', trim: true },
  { kind: 'claude-md', title: 'Project instructions (CLAUDE.md)', trim: true },
  { kind: 'memory', title: 'Memory', trim: true },
  { kind: 'plans', title: 'Open specs (plans/)', trim: true },
  { kind: 'tokens', title: 'Design tokens (style.css)', trim: true },
  { kind: 'workflows', title: 'Workflows', trim: true },
  { kind: 'card-types', title: 'Card types', trim: true },
  { kind: 'components', title: 'Components', trim: true },
  { kind: 'endpoints', title: 'Endpoints', trim: true },
]);
// The sources Settings lists: one row per kind that had at least one file, in this order.
export const SOURCE_LABELS = Object.freeze({
  memory: 'Memory', 'claude-md': 'CLAUDE.md', tokens: 'Design tokens', components: 'Components and card types',
  endpoints: 'Endpoints', workflows: 'Workflows', plans: 'Specs in plans/',
});

const sha1 = (s) => createHash('sha1').update(String(s), 'utf8').digest('hex');
const depth = (rel) => rel.split('/').length;

/** One brief line: no fence markers (proseWords drops text between them), one line, capped. */
export function flat(s, max = LINE_MAX_CHARS) {
  const t = String(s ?? '').replace(/`{3,}/g, '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}
const firstSentence = (s) => { const t = flat(s); const m = /^(.+?[.;])(\s|$)/.exec(t); return m ? m[1] : t; };

// ── Memory: the known-bug list (clarify answer: trap/defect-class files only) ──
const BUG_KINDS = new Set(['trap', 'defect-class']);
const BUG_NAME_RE = /(^|[-_.])(traps?|defects?|defect-class(es)?)($|[-_.])/i;
const BUG_TEXT_RE = /\b(traps?|defect class(es)?)\b/i;
/** Known bug: frontmatter `kind: trap|defect-class`, a trap/defect name segment, or a description naming one. */
export function isKnownBugMemory({ name = '', description = '', extra = {} } = {}) {
  if (BUG_KINDS.has(String(extra?.kind || '').toLowerCase())) return true;
  return BUG_NAME_RE.test(name) || BUG_TEXT_RE.test(description || '');
}

// ── CLAUDE.md: prose lines; code fences and worca's own run block (src/core/run-manifest.mjs) dropped ──
const WORCA_BLOCK_RE = /<!-- worca-cc:context:begin[^>]*-->[\s\S]*?<!-- worca-cc:context:end -->/g;
export function claudeMdLines(text) {
  const out = [];
  let fenced = false;
  for (const raw of String(text || '').replace(WORCA_BLOCK_RE, '').split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(raw)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const line = flat(raw.replace(/^\s*(#+|[-*+]|\d+\.)\s+/, ''));
    if (line && !/^<!--.*-->$/.test(line)) out.push(line);
  }
  return out;
}

// ── Design tokens: custom properties of bare :root blocks only (not :root[data-theme=…]) ──
export function tokenLines(css) {
  const src = String(css || '').replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  const seen = new Set();
  for (const block of src.matchAll(/(?:^|\})\s*:root\s*\{([^{}]*)\}/gm)) {
    for (const d of block[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      if (seen.has(d[1])) continue;
      seen.add(d[1]);
      out.push(flat(`${d[1]}: ${d[2]}`));
    }
  }
  return out;
}

// ── Components: path + the first sentence of the file's leading // comment ──
export const COMPONENT_RE = /(^|\/)(components|ui\/public)\/.+\.(mjs|js|jsx|tsx|vue|svelte)$/;
export const VENDOR_RE = /(^|\/)(vendor|vendored|third[-_]party)\//;
export function componentLine(rel, text) {
  const head = /^(?:[ \t]*\/\/[^\n]*\n)+/.exec(String(text || ''));
  if (!head) return rel;
  const joined = head[0].split('\n').map((l) => l.replace(/^\s*\/\/\s?/, '')).filter(Boolean).join(' ')
    .replace(/^[\w./-]+\.(mjs|jsx?|tsx|vue|svelte)\s*([—–-]\s*)?/, '');
  const desc = firstSentence(joined);
  return desc ? flat(`${rel} — ${desc}`) : rel;
}

// ── Card types: registerXCard('t'), card.type === 't', X_CARD_TYPE(S) = 't' | ['t', …] ──
const CARD_RES = [
  /\bregister\w*Card\(\s*['"]([\w-]+)['"]/g,
  /\bcard\.type\s*===?\s*['"]([\w-]+)['"]/g,
  /\b[A-Z_]*CARD_TYPES?\s*=\s*(?:Object\.freeze\()?\s*(\[[^\]]*\]|['"][\w-]+['"])/g,
];
export function cardTypeNames(text) {
  const out = new Set();
  for (const re of CARD_RES) {
    for (const m of String(text || '').matchAll(re)) {
      if (/^[\['"]/.test(m[1])) for (const q of m[1].matchAll(/['"]([\w-]+)['"]/g)) out.add(q[1]);
      else out.add(m[1]);
    }
  }
  return [...out];
}

// ── Endpoints: Express-style literal routes; the `// METHOD /path — text` line above is the one-liner ──
export const ENDPOINT_FILE_RE = /(^|\/)((server|app|index|api|router|routes)\.(mjs|cjs|js|ts)|routes?\/[^/]+\.(mjs|cjs|js|ts))$/;
const ROUTE_RE = /^[ \t]*(?:app|router|server)\.(get|post|put|patch|delete)\(\s*(['"`])(\/[^'"`$]*)\2\s*,\s*([\w.]+)?/gm;
const ROUTE_NOTE_RE = /^\s*\/\/\s*(?:GET|POST|PUT|PATCH|DELETE)\s+\S+\s*(?:—|->|-)\s*(.+)$/;
export function endpointLines(text) {
  const src = String(text || '');
  const lines = src.split('\n');
  const seen = new Set();
  const out = [];
  let pos = 0;
  let lineNo = 0;
  for (const m of src.matchAll(ROUTE_RE)) {
    for (; pos < m.index; pos++) if (src.charCodeAt(pos) === 10) lineNo++;
    if (m[4]?.startsWith('express.')) continue; // a body parser mounted on the route's path, not the route
    const key = `${m[1].toUpperCase()} ${m[3]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const note = ROUTE_NOTE_RE.exec(lines[lineNo - 1] || '');
    out.push(flat(note ? `${key} — ${firstSentence(note[1])}` : key));
  }
  return out;
}

// ── Workflows: wf_ ids (literal or *_WORKFLOW_ID constants) with their names; JSON workflow files ──
export const WORKFLOW_FILE_RE = /workflows?/i;
export function workflowLines(rel, text) {
  const src = String(text || '');
  const out = [];
  if (rel.endsWith('.json')) {
    try {
      const w = JSON.parse(src);
      if (w && typeof w.id === 'string' && (w.nodes || w.steps)) out.push(flat(`${w.id} — ${w.name || w.id} (${rel})`));
    } catch { /* not a workflow file */ }
    return out;
  }
  const names = new Map([...src.matchAll(/\b([A-Z][A-Z_]*)_WORKFLOW_NAME\s*=\s*['"]([^'"]+)['"]/g)].map((m) => [m[1], m[2]]));
  for (const m of src.matchAll(/\b([A-Z][A-Z_]*)_WORKFLOW_ID\s*=\s*['"](wf_[\w-]+)['"]/g)) {
    out.push(flat(`${m[2]} — ${names.get(m[1]) || m[2]} (${rel})`));
  }
  for (const m of src.matchAll(/\bid:\s*['"](wf_[\w-]+)['"]/g)) {
    const name = /\bname:\s*['"]([^'"]+)['"]/.exec(src.slice(m.index, m.index + 200));
    out.push(flat(`${m[1]} — ${name ? name[1] : m[1]} (${rel})`));
  }
  return out;
}

// ── Specs: plans/*.md that are still open; "Title — first sentence (path)" ──
const DONE_RE = /\b(implemented|shipped|done|merged|superseded|closed)\b/i;
export function planLine(rel, text) {
  const lines = String(text || '').split(/\r?\n/);
  const title = lines.map((l) => /^#\s+(.+)$/.exec(l)).find(Boolean)?.[1];
  if (!title) return null;
  const status = lines.slice(0, 15).find((l) => /^\W*status\b/i.test(l)) || '';
  if (DONE_RE.test(status) && !/not yet/i.test(status)) return null;
  const goal = lines.map((l) => /^\*\*(?:Goal|Scope)[^*]*\*\*:?\s*(.+)$/.exec(l)).find(Boolean)?.[1];
  const prose = lines.find((l) => l.trim() && !/^\s*(#|>|```|[-*|]|date:|branch:)/i.test(l) && !/^\W*status\b/i.test(l));
  const one = firstSentence(goal || prose || '');
  return flat(one ? `${flat(title, 120)} — ${one} (${rel})` : `${flat(title, 120)} (${rel})`);
}

/** Read every source. No clock: the caller stamps readAt.
 *  → { lines: { [kind]: string[] }, groups: [{ kind, label, files, hash }], sourceHash } */
export async function collectHouseBriefSources({ projectKey, projectDir, root = memoryRoot() }) {
  const lines = Object.fromEntries(SECTIONS.map((s) => [s.kind, []]));
  const groups = new Map();
  const note = (kind, path, hash) => { if (!groups.has(kind)) groups.set(kind, []); groups.get(kind).push(`${path}\t${hash}`); };

  if (projectKey) {
    const scope = projectScope(projectKey);
    for (const entry of await listMemory(root, scope)) {
      const file = await readMemory(root, scope, entry.name);
      const line = flat(entry.description ? `${entry.name} — ${entry.description}` : entry.name);
      lines[isKnownBugMemory({ ...entry, extra: file?.meta?.extra }) ? 'known-bugs' : 'memory'].push(line);
      note('memory', `memory/${entry.name}.md`, entry.hash);
    }
  }

  const dir = typeof projectDir === 'string' && projectDir && existsSync(projectDir) ? projectDir : null;
  if (dir) {
    const read = (rel) => readText(dir, rel, { maxBytes: SOURCE_MAX_BYTES });
    for (const rel of ['CLAUDE.md', '.claude/CLAUDE.md']) {
      const text = await read(rel);
      if (text == null) continue;
      lines['claude-md'].push(...claudeMdLines(text));
      note('claude-md', rel, sha1(text));
    }
    const { files } = await listMemberFiles(dir);
    const code = files.filter((f) => !isTestPath(f) && !VENDOR_RE.test(f) && !f.startsWith('.github/'));

    const css = code.filter((f) => /(^|\/)style\.css$/.test(f)).sort((a, b) => depth(a) - depth(b) || (a < b ? -1 : 1))[0];
    if (css) { const text = await read(css); if (text != null) { lines.tokens.push(...tokenLines(text)); note('tokens', css, sha1(text)); } }

    const cards = new Set();
    for (const f of code.filter((x) => COMPONENT_RE.test(x))) {
      const text = await read(f);
      if (text == null) continue;
      lines.components.push(componentLine(f, text));
      for (const t of cardTypeNames(text)) if (!cards.has(t)) { cards.add(t); lines['card-types'].push(`${t} (${f})`); }
      note('components', f, sha1(text));
    }
    for (const f of code.filter((x) => ENDPOINT_FILE_RE.test(x))) {
      const text = await read(f);
      if (text == null) continue;
      const found = endpointLines(text);
      if (!found.length) continue;
      lines.endpoints.push(...found);
      note('endpoints', f, sha1(text));
    }
    const wfIds = new Set();
    for (const f of code.filter((x) => WORKFLOW_FILE_RE.test(x) && /\.(mjs|cjs|js|ts|json)$/.test(x))) {
      const text = await read(f);
      if (text == null) continue;
      const found = workflowLines(f, text).filter((l) => { const id = l.split(' ')[0]; return wfIds.has(id) ? false : wfIds.add(id); });
      if (!found.length) continue;
      lines.workflows.push(...found);
      note('workflows', f, sha1(text));
    }
    for (const f of files.filter((x) => /^plans\/[^/]+\.md$/.test(x))) {
      const text = await read(f);
      if (text == null) continue;
      const line = planLine(f, text);
      if (line) lines.plans.push(line);
      note('plans', f, sha1(text)); // a closed spec still counts: re-opening it must rebuild
    }
  }

  const out = Object.keys(SOURCE_LABELS).filter((k) => groups.has(k)).map((kind) => ({
    kind, label: SOURCE_LABELS[kind], files: groups.get(kind).length, hash: sha1(groups.get(kind).sort().join('\n')),
  }));
  return { lines, groups: out, sourceHash: sha1(out.map((g) => `${g.kind}:${g.hash}`).join('\n')) };
}

/** Pure: the markdown brief within `budget` words. Trims whole lines from the last trimmable section up.
 *  → { text, words, trimmed: { lines, bySection } } */
export function renderHouseBrief(lines, pinned = [], { budget = HOUSE_BRIEF_WORD_BUDGET } = {}) {
  const HEAD = '# House brief';
  const kept = Object.fromEntries(SECTIONS.map((s) => [s.kind, s.kind === 'pinned' ? pinned.map((l) => flat(l)).filter(Boolean) : [...(lines?.[s.kind] || [])]]));
  const lineWords = (l) => proseWords(`- ${l}`);
  let total = 0;
  for (const s of SECTIONS) if (kept[s.kind].length) total += proseWords(`## ${s.title}`) + kept[s.kind].reduce((n, l) => n + lineWords(l), 0);
  if (total) total += proseWords(HEAD);
  const bySection = {};
  for (const s of [...SECTIONS].reverse()) {
    if (!s.trim) continue;
    while (total > budget && kept[s.kind].length) {
      total -= lineWords(kept[s.kind].pop());
      if (!kept[s.kind].length) total -= proseWords(`## ${s.title}`);
      bySection[s.kind] = (bySection[s.kind] || 0) + 1;
    }
  }
  const parts = SECTIONS.filter((s) => kept[s.kind].length).map((s) => [`## ${s.title}`, ...kept[s.kind].map((l) => `- ${l}`)].join('\n'));
  const text = parts.length ? `${[HEAD, ...parts].join('\n\n')}\n` : '';
  return { text, words: proseWords(text), trimmed: { lines: Object.values(bySection).reduce((n, k) => n + k, 0), bySection } };
}

const briefPath = (projectKey) => join(projectStorePath(projectKey), HOUSE_BRIEF_FILE);
const pinsPath = (projectKey) => join(projectStorePath(projectKey), HOUSE_BRIEF_PINS_FILE);
const readJson = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };

/** → { pins } or { error } (the route answers 400 with it). Blank lines dropped, duplicates collapsed. */
export function normalisePins(input) {
  if (!Array.isArray(input)) return { error: 'pinned must be a list of lines' };
  const pins = [];
  for (const item of input) {
    if (typeof item !== 'string') return { error: 'each pinned line must be text' };
    const line = item.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    if (line.length > PIN_MAX_CHARS) return { error: `a pinned line is longer than ${PIN_MAX_CHARS} characters` };
    if (!pins.includes(line)) pins.push(line);
  }
  if (pins.length > PIN_MAX_LINES) return { error: `at most ${PIN_MAX_LINES} pinned lines` };
  return { pins };
}
export function readHouseBriefPins(projectKey) {
  const v = readJson(pinsPath(projectKey));
  return Array.isArray(v?.pinned) ? v.pinned.filter((l) => typeof l === 'string') : [];
}
export function writeHouseBriefPins(projectKey, input) {
  const { pins, error } = normalisePins(input);
  if (error) throw Object.assign(new Error(error), { code: 'EPINS' });
  writeJsonAtomic(pinsPath(projectKey), { version: 1, pinned: pins });
  return pins;
}
export function readHouseBrief(projectKey) { return readJson(briefPath(projectKey)); }

/** The stored brief; rebuilt first when the source hash, the pins or the budget changed, or on `force`.
 *  → { version, builtAt, sourceHash, pinsHash, budget, brief, words, trimmed, sources, pinned, rebuilt } */
export async function ensureHouseBrief({ projectKey, projectDir, force = false, now = () => new Date(), root = memoryRoot(), budget = HOUSE_BRIEF_WORD_BUDGET }) {
  const pinned = readHouseBriefPins(projectKey);
  const pinsHash = sha1(pinned.join('\n'));
  const { lines, groups, sourceHash } = await collectHouseBriefSources({ projectKey, projectDir, root });
  const stored = readHouseBrief(projectKey);
  if (!force && stored?.version === 1 && stored.sourceHash === sourceHash && stored.pinsHash === pinsHash && stored.budget === budget) {
    return { ...stored, pinned, rebuilt: false };
  }
  const readAt = now().toISOString();
  const { text, words, trimmed } = renderHouseBrief(lines, pinned, { budget });
  const record = { version: 1, builtAt: readAt, sourceHash, pinsHash, budget, brief: text, words, trimmed, sources: groups.map((g) => ({ ...g, readAt })) };
  writeJsonAtomic(briefPath(projectKey), record);
  return { ...record, pinned, rebuilt: true };
}
