// src/shared/shape/shape.mjs — the shape check (spec D6): deterministic text rules on a plan, no model call.
// Ported from Spec Builder without front matter: a plan carries none, so perspectives/size/waivers come
// through opts only. Browser-safe.
import { SECTIONS, sectionsFor, perspectiveByKey, splitSections } from './perspectives.mjs';
import { scanChecklists } from './checklist.mjs';

/** The check ids, in display order (was front-matter.mjs SHAPE_IDS). */
export const SHAPE_IDS = Object.freeze(['sections', 'testable', 'decisions', 'paths', 'tests', 'placeholders', 'checklists', 'grounded']);
export const UNWAIVABLE_SHAPE_IDS = Object.freeze(['checklists']);

export const SHAPE_LABELS = Object.freeze({
  sections: 'Every section its perspectives need is present',
  testable: 'Success criteria must be testable',
  decisions: 'Every decision states one choice',
  paths: 'Every repo path exists or is marked (new)',
  tests: 'Testing covers the new code',
  placeholders: 'No placeholders left',
  checklists: 'Every perspective ends with a checklist',
  grounded: 'Decisions are grounded in the repo',
});
export const CHECKLIST_MAX = 8;
export const GROUNDED_MIN_PATHS = 3;

/** A backticked repo path, optional :line (V9). */
export const REPO_PATH_RE = /`((?:src|ui|test|docs)\/[^`\s:]+)(?::(\d+))?`/g;
const NEW_RE = /\(new\)/i;
const ITEM_LINE_RE = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(.*)$/;
const VAGUE_RE = /\b(?:works|is fast|is good|should handle|properly|as expected)\b/i;
const MEASURABLE_RE = /\d|`[^`]+`|"[^"]+"|\b(?:returns?|shows?|rejects?|lists?|names?|within|under|at (?:most|least)|equals?|contains?|exits?)\b/i;
/** The shape check's `testable` rule on one line (V8): vague only when it uses a vague phrase AND nothing
 *  measurable is left once that phrase is removed. Shared with checkSlices' `acceptance`. */
export function isTestable(text) {
  const t = String(text || '');
  return !(VAGUE_RE.test(t) && !MEASURABLE_RE.test(t.replace(VAGUE_RE, '')));
}
const UNDECIDED_RE = /^(?:tbd|maybe|consider)\b/i;
// `<…>` placeholders, but not Markdown autolinks (`<https://…>`, `<mailto:…>`)
const PLACEHOLDER_RES = [/\bTODO\b/, /\bTBD\b/, /\blorem\b/i, /\[(?:…|\.\.\.)\]/, /<(?:…|\.\.\.|(?!https?:|mailto:)[A-Za-z][^<>\n]*)>/];
const TEST_PATH_RE = /^test\/|\.test\.|\.spec\./;
const CODE_PATH_RE = /\.(?:mjs|cjs|js|jsx|ts|tsx)$/;

/** The one key for a cited path and its grounding entry: `path:line` (`path:` without a line). R21. */
export const groundKey = (p) => `${p.path}:${p.line ?? ''}`;

/** Every backticked repo path in the body: `{ path, line?, isNew, section }` (fenced code ignored). */
export function repoPaths(markdown) {
  const out = [];
  for (const s of splitSections(markdown)) {
    for (const text of s.text.split('\n')) {
      const isNew = NEW_RE.test(text);
      for (const m of text.matchAll(REPO_PATH_RE)) out.push({ path: m[1], ...(m[2] ? { line: Number(m[2]) } : {}), isNew, section: s.key });
    }
  }
  return out;
}

const listItems = (text) => text.split('\n').map((l) => ITEM_LINE_RE.exec(l)?.[1]).filter(Boolean)
  .map((t) => t.replace(/^\[[ xX]\][ \t]+(?:R-[a-z]+-\d+[ \t]+)?/, ''));

/** The first table in `text`: its data rows (header and separator dropped) and the index of its Decision column
 *  (the header cell naming a decision or choice; else the cell after a leading `#`). null when there is no table. R25. */
function decisionTable(text) {
  const rows = text.split('\n').filter((l) => /^\s*\|/.test(l))
    .map((l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()));
  const sep = rows.findIndex((cells) => cells.every((c) => /^:?-{3,}:?$/.test(c)));
  if (sep < 0) return null;
  const head = sep > 0 ? rows[sep - 1] : [];
  const named = head.findIndex((c) => /decision|choice/i.test(c));
  return { rows: rows.slice(sep + 1), col: named >= 0 ? named : (/^#?$/.test(head[0] || '') && head.length > 1 ? 1 : 0) };
}

/**
 * @param {string} markdown the whole plan
 * @param {{perspectives?:string[], size?:'small'|'medium'|'large', grounding?:Array<{path:string, line?:number, found:boolean, isNew?:boolean}>|null,
 *          waived?:Array<{id:string}>}} [opts]
 * @returns {{ok:boolean, items:Array<{id,label,pass,detail,section?,waived?,waivable}>, passed:number, total:number, found:string[]}}
 */
export function checkShape(markdown, opts = {}) {
  const body = String(markdown || '');
  const perspectives = [...new Set(['product', ...(Array.isArray(opts.perspectives) ? opts.perspectives : [])])];
  const size = opts.size || 'medium';
  const grounding = Array.isArray(opts.grounding) ? opts.grounding : null;
  const waivedIds = new Set((opts.waived || []).map((w) => w.id));
  const secs = splitSections(body);
  const sec = (key) => secs.find((s) => s.key === key) || null;
  const paths = repoPaths(body);
  const items = [];
  const add = (id, pass, detail, section) => items.push({ id, label: SHAPE_LABELS[id], pass, detail: pass ? '' : detail, ...(section ? { section } : {}) });

  // sections: the same fence-blind headings as every other check (perspectives.mjs missingSections would count a
  // `## Testing` quoted inside a code fence)
  const missing = sectionsFor(perspectives).filter((s) => !secs.some((x) => x.key === s.key)).map((s) => s.title);
  add('sections', !missing.length, `Missing: ${missing.join(', ')}`);

  // testable: success criteria (Problem and goal) and QA checks (Testing)
  const vague = ['problem', 'testing'].flatMap((key) => listItems(sec(key)?.text || '').map((t) => ({ t, key })))
    .find(({ t }) => !isTestable(t));
  add('testable', !vague, vague ? `"${vague.t}" has no measurable condition` : '', vague?.key);

  // decisions + grounded share the Decisions table (only when a perspective owns it). A Why or Notes column is allowed (R25):
  // `decisions` reads the Decision column, `grounded` accepts a path or (new) anywhere in the row but the # cell.
  const wantsDecisions = sectionsFor(perspectives).some((s) => s.key === 'decisions');
  const table = wantsDecisions ? decisionTable(sec('decisions')?.text || '') : { rows: [], col: 0 };
  const rows = table ? table.rows : null;
  const choice = (cells) => (cells[table.col] || '').replace(/\*\*/g, '').trim();
  const undecided = rows && rows.find((c) => !choice(c) || UNDECIDED_RE.test(choice(c)));
  add('decisions', !wantsDecisions || (rows !== null && rows.length > 0 && !undecided),
    rows === null || !rows.length ? 'The Decisions section has no table rows' : `Row "${undecided && choice(undecided)}" does not state one choice`, 'decisions');

  // paths (V9): every backticked path is found, or its line says (new). Keyed by path:line, as checkPaths dedupes (R21).
  const gByKey = new Map((grounding || []).map((g) => [groundKey(g), g]));
  const lost = grounding ? paths.find((p) => !p.isNew && !gByKey.get(groundKey(p))?.found) : null;
  const lostName = lost ? `${lost.path}${lost.line != null ? `:${lost.line}` : ''}` : '';
  add('paths', !lost, lost ? `\`${lostName}\` is not in the repo; mark it (new) or fix it` : '', lost?.section);

  // tests: Testing names a test file, and each new code file in Code layout has a test whose name carries its stem
  const testPaths = paths.filter((p) => p.section === 'testing' && TEST_PATH_RE.test(p.path)).map((p) => p.path.toLowerCase());
  const stem = (p) => p.split('/').pop().split('.')[0].toLowerCase();
  const uncovered = paths.find((p) => p.section === 'layout' && p.isNew && CODE_PATH_RE.test(p.path) && !TEST_PATH_RE.test(p.path)
    && !testPaths.some((t) => t.includes(stem(p.path))));
  add('tests', testPaths.length > 0 && !uncovered,
    !testPaths.length ? 'Testing names no test file' : `No test entry covers \`${uncovered?.path}\``, 'testing');

  // placeholders: anywhere but Open questions; inline code ignored
  let hit = null;
  for (const s of secs) {
    if (s.key === 'openQuestions' || hit) continue;
    const text = s.text.replace(/`[^`\n]*`/g, '');
    const re = PLACEHOLDER_RES.find((r) => r.test(text));
    if (re) hit = { section: s.key, what: re.exec(text)[0] };
  }
  add('placeholders', !hit, hit ? `Placeholder "${hit.what}" left in the plan` : '', hit?.section);

  // checklists (V14): every picked perspective except Product has 1–8 well-formed items in its own sections
  const { items: cl, malformed } = scanChecklists(body);
  let clProblem = malformed[0] ? { why: malformed[0].why, section: malformed[0].section } : null;
  for (const key of perspectives) {
    const p = perspectiveByKey(key);
    if (clProblem || !p?.checklist) continue;
    const n = cl.filter((i) => i.perspective === key && p.sections.includes(i.section)).length;
    if (n < 1 || n > CHECKLIST_MAX) clProblem = { why: `${p.label} needs 1–${CHECKLIST_MAX} checklist items (has ${n})`, section: p.sections[p.sections.length - 1] };
  }
  const stray = !clProblem && cl.find((i) => !perspectives.includes(i.perspective));
  if (stray) clProblem = { why: `${stray.id} names a perspective this plan does not have`, section: stray.section };
  add('checklists', !clProblem, clProblem?.why || '', clProblem?.section);

  // grounded (V17): each Architect decision cites a path or says (new); medium/large has ≥3 found paths
  const found = [...new Set((grounding || []).filter((g) => g.found).map((g) => g.path))];
  const rowText = (cells) => cells.filter((c, i) => !(i === 0 && /^\d*$/.test(c))).join(' | ');
  const ungrounded = perspectives.includes('architect') && Array.isArray(rows)
    ? rows.find((c) => !new RegExp(REPO_PATH_RE.source).test(rowText(c)) && !NEW_RE.test(rowText(c))) : null;
  const thin = grounding && (size === 'medium' || size === 'large') && found.length < GROUNDED_MIN_PATHS;
  add('grounded', !ungrounded && !thin,
    ungrounded ? `Decision "${choice(ungrounded)}" cites no repo path and is not marked (new)` : `Only ${found.length} repo paths found; a ${size} plan needs ${GROUNDED_MIN_PATHS}`, 'decisions');

  for (const it of items) {
    it.waivable = !UNWAIVABLE_SHAPE_IDS.includes(it.id);
    if (!it.pass && it.waivable && waivedIds.has(it.id)) it.waived = true;
  }
  items.sort((a, b) => SHAPE_IDS.indexOf(a.id) - SHAPE_IDS.indexOf(b.id));
  return { ok: items.every((i) => i.pass || i.waived), items, passed: items.filter((i) => i.pass).length, total: items.length, found };
}

export { SECTIONS };
