// src/core/ask/spec-proposal.mjs
// propose_spec's validator (plans/spec-builder D8, §3.5), the metrics-proposal pattern: a pure factory over
// injected readers; the MCP child runs it for the model's self-correction, the parent turn re-runs it
// authoritatively and mints the card. It never writes — the card's Save button does (POST /api/spec-builder/save).
import { parseWorcaFrontMatter } from '../../shared/spec-builder/front-matter.mjs';
import { missingSections } from '../../shared/spec-builder/roles.mjs';

export const SPEC_MAX_BYTES = 64 * 1024;
/** `plans/<name>.md`, one level, no dot-segments (the save route re-checks on disk). */
export const SPEC_PATH_RE = /^plans\/[A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*\.md$/;
export const SPEC_ERRORS = Object.freeze({
  markdown: 'markdown is required: the whole spec, starting with its worca: front-matter block',
  size: `markdown is over ${SPEC_MAX_BYTES} bytes`,
  path: 'path must be plans/<name>.md',
  frontMatter: 'the spec must start with a ---\\nworca: … --- front-matter block',
  section: (title) => `missing section: ## ${title}`,
  project: 'this chat has no pinned project — Spec Builder threads are pinned to one',
});

/**
 * @param {{projectOf?:(key:string)=>Promise<{key:string,name?:string,path?:string}|null>, estimate?:((fm:object)=>object)|null}} [readers]
 */
export function createSpecValidator({ projectOf = async () => null, estimate = null } = {}) {
  return async function validateSpec(input, { projectKey = null } = {}) {
    const raw = input && typeof input === 'object' ? input : {};
    const markdown = typeof raw.markdown === 'string' ? raw.markdown : '';
    if (!markdown.trim()) return { ok: false, errors: [SPEC_ERRORS.markdown] };
    const errors = [];
    if (new TextEncoder().encode(markdown).length > SPEC_MAX_BYTES) errors.push(SPEC_ERRORS.size);
    const path = typeof raw.path === 'string' ? raw.path.trim() : '';
    if (path && !SPEC_PATH_RE.test(path)) errors.push(SPEC_ERRORS.path);
    const parsed = parseWorcaFrontMatter(markdown);
    if (!parsed) errors.push(SPEC_ERRORS.frontMatter);
    else if (!parsed.ok) errors.push(...parsed.errors);
    else for (const t of missingSections(parsed.body, parsed.fm.roles)) errors.push(SPEC_ERRORS.section(t));
    const project = projectKey ? await projectOf(projectKey) : null;
    if (!projectKey) errors.push(SPEC_ERRORS.project);
    if (errors.length) return { ok: false, errors };
    const title = (/^#[ \t]+(.+?)[ \t]*$/m.exec(parsed.body)?.[1] || 'Untitled spec').slice(0, 200);
    return { ok: true, card: {
      type: 'spec', title, summary: `Spec: ${title}`, markdown, path: path || null,
      frontMatter: parsed.fm, estimate: typeof estimate === 'function' ? estimate(parsed.fm) : null,
      projectKey, projectName: project?.name || null, projectDir: project?.path || null,
    } };
  };
}
