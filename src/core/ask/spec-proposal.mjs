// src/core/ask/spec-proposal.mjs
// propose_spec's validator (plans/spec-builder D8, §3.5), the metrics-proposal pattern: a pure factory over
// injected readers; the MCP child runs it for the model's self-correction, the parent turn re-runs it
// authoritatively and mints the card. It never writes — the card's Save button does (POST /api/spec-builder/save).
// The call carries EITHER questions (a `spec-questions` card) OR the whole spec (a `spec` card with its
// shape and grounding verdicts); the child rejects a shape failure a few times per turn, the parent never does (R2).
import { parseWorcaFrontMatter } from '../../shared/spec-builder/front-matter.mjs';
import { missingSections } from '../../shared/spec-builder/roles.mjs';
import { checkShape } from '../../shared/spec-builder/shape.mjs';

export const SPEC_MAX_BYTES = 64 * 1024;
export const SPEC_QUESTIONS_MAX = 3;
/** Shape-failing calls the MCP child rejects per turn before it lets the spec through, failures on the card (R2). */
export const SHAPE_RETRY_BUDGET = 2;
/** `plans/<name>.md`, one level, no dot-segments (the save route re-checks on disk). */
export const SPEC_PATH_RE = /^plans\/[A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*\.md$/;
const Q_ID_RE = /^[a-z][a-z0-9-]{0,40}$/;
const clipStr = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n) : '');

export const SPEC_ERRORS = Object.freeze({
  markdown: 'give either questions (to ask the user) or markdown (the whole spec, starting with its worca: front-matter block)',
  both: 'give questions OR markdown, never both',
  questions: `questions must be 1–${SPEC_QUESTIONS_MAX} items`,
  size: `markdown is over ${SPEC_MAX_BYTES} bytes`,
  path: 'path must be plans/<name>.md',
  frontMatter: 'the spec must start with a ---\\nworca: … --- front-matter block',
  section: (title) => `missing section: ## ${title}`,
  shape: (it) => `shape check ${it.id} failed: ${it.detail}`,
  project: 'this chat has no pinned project — Spec Builder threads are pinned to one',
});

export function validateQuestions(raw) {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > SPEC_QUESTIONS_MAX) return { ok: false, errors: [SPEC_ERRORS.questions] };
  const errors = [];
  const seen = new Set();
  const questions = raw.map((q, i) => {
    const o = q && typeof q === 'object' ? q : {};
    const at = `questions[${i}]`;
    const id = clipStr(o.id, 41);
    if (!Q_ID_RE.test(id) || seen.has(id)) errors.push(`${at}.id must be a unique kebab-case id`);
    seen.add(id);
    const text = clipStr(o.text, 300);
    if (!text) errors.push(`${at}.text is required`);
    const why = clipStr(o.why, 300);
    if (!why) errors.push(`${at}.why is required: what in the repo prompted the question`);
    const options = Array.isArray(o.options) ? o.options.map((x) => clipStr(x, 120)).filter(Boolean) : [];
    if (options.length < 2 || options.length > 4 || new Set(options).size !== options.length) errors.push(`${at}.options must be 2–4 distinct short answers`);
    return { id, text, why, options };
  });
  return errors.length ? { ok: false, errors } : { ok: true, questions };
}

/**
 * @param {{projectOf?:(key:string)=>Promise<{key:string,name?:string,path?:string}|null>, estimate?:((fm:object)=>object)|null,
 *   checkPaths?:((markdown:string, projectDir:string)=>Promise<Array<{path:string,line?:number,found:boolean}>>)|null,
 *   enforceShape?:boolean, shapeBudget?:number}} [readers]
 *   enforceShape: the MCP child's mode (R2) — reject a shape failure until `shapeBudget` rejections were spent.
 */
export function createSpecValidator({ projectOf = async () => null, estimate = null, checkPaths = null, enforceShape = false, shapeBudget = SHAPE_RETRY_BUDGET } = {}) {
  let shapeRejects = 0;
  return async function validateSpec(input, { projectKey = null } = {}) {
    const raw = input && typeof input === 'object' ? input : {};
    const hasQ = raw.questions !== undefined && raw.questions !== null;
    const markdown = typeof raw.markdown === 'string' ? raw.markdown : '';
    const hasM = !!markdown.trim();
    if (hasQ && hasM) return { ok: false, errors: [SPEC_ERRORS.both] };
    if (!hasQ && !hasM) return { ok: false, errors: [SPEC_ERRORS.markdown] };
    const project = projectKey ? await projectOf(projectKey) : null;
    const where = { projectKey, projectName: project?.name || null, projectDir: project?.path || null };
    if (hasQ) {
      const q = validateQuestions(raw.questions);
      const errors = [...(q.ok ? [] : q.errors), ...(projectKey ? [] : [SPEC_ERRORS.project])];
      if (errors.length) return { ok: false, errors };
      return { ok: true, card: { type: 'spec-questions', title: 'Questions about the spec', summary: `Spec questions (${q.questions.length})`, questions: q.questions, ...where } };
    }
    const errors = [];
    if (new TextEncoder().encode(markdown).length > SPEC_MAX_BYTES) errors.push(SPEC_ERRORS.size);
    const path = typeof raw.path === 'string' ? raw.path.trim() : '';
    if (path && !SPEC_PATH_RE.test(path)) errors.push(SPEC_ERRORS.path);
    const parsed = parseWorcaFrontMatter(markdown);
    if (!parsed) errors.push(SPEC_ERRORS.frontMatter);
    else if (!parsed.ok) errors.push(...parsed.errors);
    // hard floor: every heading present (fence-blind on purpose; the `sections` shape check below skips fences, §15)
    else for (const t of missingSections(parsed.body, parsed.fm.roles)) errors.push(SPEC_ERRORS.section(t));
    if (!projectKey) errors.push(SPEC_ERRORS.project);
    if (errors.length) return { ok: false, errors };
    // null = not checked (no reader, or the project did not resolve): `paths`/`grounded` then skip, never fail (R21)
    const grounding = typeof checkPaths === 'function' && project?.path ? await checkPaths(markdown, project.path) : null;
    const shape = checkShape(markdown, { grounding });
    if (enforceShape && !shape.ok && shapeRejects < shapeBudget) {
      shapeRejects += 1;
      return { ok: false, errors: shape.items.filter((i) => !i.pass && !i.waived).map(SPEC_ERRORS.shape) };
    }
    const title = (/^#[ \t]+(.+?)[ \t]*$/m.exec(parsed.body)?.[1] || 'Untitled spec').slice(0, 200);
    return { ok: true, card: {
      type: 'spec', title, summary: `Spec: ${title}`, markdown, path: path || null,
      frontMatter: parsed.fm, estimate: typeof estimate === 'function' ? estimate(parsed.fm) : null,
      grounding, shape, ...where,                 // grounding stays null when not checked: the pane and Ask card pass it through as is
    } };
  };
}
