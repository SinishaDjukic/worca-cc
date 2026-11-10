// src/core/ask/design-deps.mjs
// The Design chat's tool bundle (P5): get_design, start_design_build, change_design and design_questions over the ONE
// design that owns the thread (design/chat-thread.mjs), in the MCP child or the relay. Nothing here writes: start and
// change only check the request against the design as it is now and hand it back as `requested`, and the parent
// (turn.mjs _onDesignAction) starts the round; design_questions' result becomes the parent's clarifying card. Every read
// goes through P1's design store, its paths and its plan check. Also the [design chat] block each turn starts with.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getThread, listAttachments } from './store.mjs';
import { designIdForThread } from '../design/chat-thread.mjs';
import { getDesign, latestBuild, OPEN_BUILD_STATUSES } from '../design/store.mjs';
import { designWorkDir } from '../design/paths.mjs';
import { validatePlan } from '../design/plan.mjs';
import { listProjects } from '../projects.mjs';
import { renderDesignBlock, validateDesignQuestions, validateDesignRequest, DESIGN_BLOCK_END } from './design-payload.mjs';

/** What the model may say after the parent acts on its call (rule 7 of DESIGN_SYSTEM_RULES). */
const NOTE_ACT = 'worca starts it right after this call and puts a receipt in the chat, or a notice says why not: never say it started or finished. Your reply after this call is at most TWO short sentences, 40 words in all (rule 7).';
const NOTE_ASK = 'The user sees these as a card. END YOUR TURN: the answers arrive as a [worca event] message.';
const NO_DESIGN = 'this chat has no design';

/** The design's plan on disk when valid, else null (as design/routes.mjs planOf reads it). */
function readPlanFile(design) {
  try {
    const check = validatePlan(readFileSync(join(designWorkDir(design.id), 'plan.json'), 'utf8'), { kind: design.kind });
    return check.ok ? check.plan : null;
  } catch {
    return null;
  }
}

const DEFAULT_IO = {
  getThread,
  listAttachments,
  designIdForThread,
  getDesign,
  latestBuild,
  workDir: designWorkDir,
  readPlan: readPlanFile,
  projectPath: async (key) => (await listProjects()).find((p) => p.key === key)?.path ?? null,
};

const fail = (error) => ({ ok: false, error });
/** The build that holds the design, else null. Paused counts: P2 refuses a new round while one is open. */
const openBuild = (b) => (b && OPEN_BUILD_STATUSES.includes(b.status) ? b : null);
const running = (b) => `a build is running (round ${b.round})${b.status === 'paused'
  ? ', paused: the user can press Resume or Stop' : ': one build at a time, say what you will do when it ends'}`;

/** The kit the four tools call. Each call reads the design afresh: a round or a restore can land mid-turn. */
function designKit({ io, threadId }) {
  const now = () => {
    const id = io.designIdForThread(threadId);
    const design = id ? io.getDesign(id) : null;
    return design ? { design, plan: io.readPlan(design), build: openBuild(io.latestBuild(design.id)) } : null;
  };
  return {
    async get() {
      const s = now();
      if (!s) return fail(NO_DESIGN);
      const { design: d, plan, build } = s;
      return {
        ok: true,
        design: { id: d.id, title: d.title, kind: d.kind, status: d.status, version: d.version, fast: d.fast === true, projectKey: d.projectKey ?? null },
        plan,
        build: build ? { id: build.id, round: build.round, kind: build.kind ?? null, status: build.status } : null,
        // Only files the user sent with a message: a show_files copy (no message) is not theirs to build with.
        attachments: (io.listAttachments(threadId) || []).filter((a) => a && a.messageId != null)
          .map((a) => ({ id: a.id, name: a.name, kind: a.kind, bytes: a.bytes })),
        paths: { work: io.workDir(d.id), project: d.projectKey ? await io.projectPath(d.projectKey) : null },
      };
    },
    async start(input) {
      const r = validateDesignRequest({ kind: 'design-start', brief: input?.brief });
      if (!r.ok) return r;
      const s = now();
      if (!s) return fail(NO_DESIGN);
      if (s.build) return fail(running(s.build));
      if (s.plan) return fail('this design already has a plan: use change_design');
      return { ok: true, requested: r.value, note: NOTE_ACT };
    },
    async change(input) {
      const r = validateDesignRequest({ kind: 'design-change', instruction: input?.instruction, sections: input?.sections, needsLead: input?.needsLead });
      if (!r.ok) return r;
      const s = now();
      if (!s) return fail(NO_DESIGN);
      if (s.build) return fail(running(s.build));
      if (!s.plan) return fail('nothing built yet: use start_design_build');
      const ids = new Set((Array.isArray(s.plan.sections) ? s.plan.sections : []).map((x) => x?.id));
      const unknown = r.value.sections.find((id) => !ids.has(id));
      if (unknown !== undefined) return fail(`unknown section ${JSON.stringify(unknown)}: name sections from the plan`);
      return { ok: true, requested: r.value, note: NOTE_ACT };
    },
    async questions(input) {
      const r = validateDesignQuestions(input);
      if (!r.ok) return r;
      if (!now()) return fail(NO_DESIGN);
      return r.value.form
        ? { ok: true, heading: r.value.heading, form: r.value.form, note: NOTE_ASK }
        : { ok: true, heading: r.value.heading, questions: r.value.questions, note: NOTE_ASK };
    },
  };
}

/**
 * The design tools for a design thread, else nothing: an Ask, composer or unreadable thread gets `{}` (composer-deps.mjs
 * already fails an unreadable row closed to the Workflows allowlist, which holds no design tool).
 * @param {{ threadId?: string|null, io?: object }} [opts]
 * @returns {{ design: object } | {}}
 */
export function defaultDesignDeps({ threadId, io = DEFAULT_IO } = {}) {
  let thread = null;
  try { thread = threadId ? io.getThread(threadId) : null; } catch { return {}; }
  if (!thread || thread.mode !== 'design') return {};
  return { design: designKit({ io, threadId }) };
}

/** The [design chat] block for a design thread (the server puts it in the turn prompt): the design as it is now, its
 *  plan's sections, the open build and the message's pins (the messages route stores them on the thread's composer). */
export async function designPromptBlock(thread, io = DEFAULT_IO) {
  const id = thread && typeof thread.id === 'string' ? io.designIdForThread(thread.id) : null;
  const design = id ? io.getDesign(id) : null;
  if (!design) return `[design chat]\n(${NO_DESIGN})\n${DESIGN_BLOCK_END}`;
  return renderDesignBlock({ design, plan: io.readPlan(design), build: openBuild(io.latestBuild(design.id)), pins: thread.composer?.pins || [] });
}
