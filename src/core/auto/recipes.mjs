// The ONE Auto-path module where agent keys may appear (spec D23): prompt
// guidance for the classifier and the canned shapes the offline mock answers
// with. The assembler and the orchestrator never read these keys — they read
// port meta.

// Rendered into BOTH selection paths — the Ask system prompt (prompt.mjs renderCatalog)
// and the classifier system prompt (classify.mjs) — so the sizing principle is stated
// here once: build UP from the implementer, one rung per concrete signal (2026-09-07 ladder).
export const RECIPE_GUIDE = [
  '## Recipes (starting points — adapt them to the task)',
  'Sizing: build the workflow UP from the implementer and add a stage only when a concrete signal in the task itself demands it — every extra stage must earn its cost in time and money; when unsure between two shapes, take the lighter one. Never inflate "size" or "signals" to justify a stage.',
  'taskKind names what the user GAVE, never how big the work is: prompt = an idea, request or bug report with no plan; plan-partial = a sketch or a plan with gaps; plan-complete-detailed = a complete, detailed plan; plan-complete-small = a complete but small plan. Only plan-complete-* makes the task document the plan of record, so never label a prompt as a plan to reach a lighter rung — the ladder below reaches it directly.',
  'The ladder (each rung adds ONE stage to the rung before it; take the first rung that fits):',
  '- trivial — implementer only: a well-specified small change whose result the tests can check (a dependency bump, a config or copy change, a one-file fix, a rename, a complete small plan)',
  '- small — implementer ⇄ reviewer: the change is bigger than one bounded edit (several files, a new code path, a public interface, anything a second pair of eyes should check) but the text already says precisely what to build — a complete, detailed plan lands here',
  '- needs a plan — clarify → planner → implementer ⇄ reviewer: the text says WHAT but not HOW, so the implementer would have to explore the codebase and design before writing (a plain prompt whose change is more than trivial)',
  '- big plan — clarify → planner → refiner (selfLoop) → implementer ⇄ reviewer: the plan to be written is large or subtle enough that a second pass on it pays off (many files or subsystems, cross-cutting behaviour, unclear edge cases)',
  '- given plan, large — refiner (selfLoop) → implementer ⇄ reviewer: the user GAVE a complete plan that is large or has gaps worth tightening before implementation; a partial plan (plan-partial) gets a planner in front: planner → refiner (selfLoop) → implementer ⇄ reviewer',
  'Clarify: it goes only directly in front of a planner (its answers feed the planner), only on a plain prompt (taskKind prompt), and only when a human is in the loop — the trivial and small rungs, a given plan and a run without a human never get it.',
  'Modifiers (exceptions, never a default — each needs a real signal in the task itself):',
  '- web / UI feature — ONLY for a very big user-facing UI feature (many screens or flows, a new page with complex interaction): append manualTestsChecklist → manualWebUiTesting after the reviewer; its review loops back into the implementer automatically. A CSS tweak, a single component change or any small or medium UI change stays with the reviewer only, and the fingerprint\'s "web-ui likely" hint is context about the repository, never a trigger',
  '- large task — only when the task really spans many files or subsystems: insert decomposer between the last planning stage and the implementer and set the implementer\'s fanOut to true',
  '- risky or large plan — only for an irreversible or high-blast-radius change (data migrations, auth, billing, public APIs) or a plan too big to check by eye: add planReviewer right after the planner (it loops back into the planner)',
  'Rules: only a clarifier stage asks the user up front; a verifier loops automatically to the nearest earlier stage that can take its verdict (declare "loops" only to override, "loop": false to suppress); give "selfLoop": true to every stage whose card says it can loop on itself; use "parallel" only for stages that do not depend on each other; a stage after a parallel group waits for the whole group on every cycle; a verifier after a group loops back to a stage BEFORE the group unless it reads a member\'s output directly (the assembler enforces this — never loop into a member the verifier does not read); plugin and user agents (the card\'s origin field: plugin:<name> or user) fit wherever their ports match.',
].join('\n');

const S = (agent, extra = {}) => ({ agent, ...extra });
const REFINER = () => S('refiner', { selfLoop: true });

/** Every rung × modifier the classifier is taught, as shapes the tests run offline. */
export const RECIPE_SHAPES = Object.freeze([
  // the ladder
  { id: 'trivial', shape: { name: 'Quick fix', taskKind: 'prompt', stages: [S('implementer')] } },
  { id: 'small', shape: { name: 'Implement + review', taskKind: 'prompt', stages: [S('implementer'), S('reviewer')] } },
  { id: 'needs-plan', shape: { name: 'Clarify, plan, implement + review', taskKind: 'prompt', stages: [S('clarify'), S('planner'), S('implementer'), S('reviewer')] } },
  { id: 'prompt', shape: { name: 'Clarify, plan, refine, implement + review', taskKind: 'prompt', stages: [S('clarify'), S('planner'), REFINER(), S('implementer'), S('reviewer')] } },
  { id: 'plan-partial', shape: { name: 'Plan, refine, implement + review', taskKind: 'plan-partial', stages: [S('planner'), REFINER(), S('implementer'), S('reviewer')] } },
  { id: 'plan-complete-detailed', shape: { name: 'Implement + review the plan', taskKind: 'plan-complete-detailed', stages: [S('implementer'), S('reviewer')] } },
  { id: 'plan-complete-large', shape: { name: 'Refine, implement + review the plan', taskKind: 'plan-complete-detailed', stages: [REFINER(), S('implementer'), S('reviewer')] } },
  { id: 'plan-complete-small', shape: { name: 'Implement the plan', taskKind: 'plan-complete-small', stages: [S('implementer')] } },
  // modifiers
  { id: 'prompt+web', shape: { name: 'Clarify, plan, refine, implement + web tests', taskKind: 'prompt', stages: [S('clarify'), S('planner'), REFINER(), S('implementer'), S('reviewer'), S('manualTestsChecklist'), S('manualWebUiTesting')] } },
  { id: 'prompt+large', shape: { name: 'Clarify, plan, refine, decompose, implement + review', taskKind: 'prompt', stages: [S('clarify'), S('planner'), REFINER(), S('decomposer'), S('implementer', { fanOut: true }), S('reviewer')] } },
  { id: 'prompt+risky', shape: { name: 'Clarify, plan + plan review, refine, implement + review', taskKind: 'prompt', stages: [S('clarify'), S('planner'), S('planReviewer'), REFINER(), S('implementer'), S('reviewer')] } },
  { id: 'plan-partial+web+large', shape: { name: 'Plan, refine, decompose, implement + web tests', taskKind: 'plan-partial', stages: [S('planner'), REFINER(), S('decomposer'), S('implementer', { fanOut: true }), S('reviewer'), S('manualTestsChecklist'), S('manualWebUiTesting')] } },
  { id: 'plan-complete-detailed+web', shape: { name: 'Implement, review + web tests', taskKind: 'plan-complete-detailed', stages: [S('implementer'), S('reviewer'), S('manualTestsChecklist'), S('manualWebUiTesting')] } },
  // A group may sit anywhere; a verifier after it loops to a stage the whole group
  // depends on (or to a member it reads) — the assembler refuses anything else.
  { id: 'parallel-end', shape: { name: 'Plan, refine, implement, review ∥ checklist', taskKind: 'plan-partial', stages: [S('planner'), REFINER(), S('implementer'), { parallel: [S('reviewer'), S('manualTestsChecklist')] }] } },
  { id: 'parallel-mid', shape: { name: 'Plan, refine, implement, review ∥ checklist, web tests', taskKind: 'plan-partial', stages: [S('planner'), REFINER(), S('implementer'), { parallel: [S('reviewer'), S('manualTestsChecklist')] }, S('manualWebUiTesting')] } },
]);

const WEB_RE = /\b(web|ui|page|button|css|react|vue|svelte|browser|frontend|front-end|html|component|modal|dropdown|theme)\b/i;
const clone = (v) => JSON.parse(JSON.stringify(v));
const byId = (id) => clone(RECIPE_SHAPES.find((r) => r.id === id).shape);

/**
 * The offline classifier: cheap, deterministic heuristics over the task text.
 * Never spawns anything — `npm run smoke`-style runs and the test suite depend on it.
 */
export function mockShapeFor(taskText, { humanInLoop = true } = {}) {
  const text = String(taskText || '').trim();
  const hasHeading = /^#{1,3}\s+\S/m.test(text);
  let shape;
  if (hasHeading) shape = text.length >= 1200 ? byId('plan-complete-detailed') : byId('plan-complete-small');
  else if (text.length < 80) shape = byId('trivial');
  else if (WEB_RE.test(text)) shape = byId('prompt+web');
  else shape = byId('prompt');
  if (!humanInLoop) shape.stages = shape.stages.filter((s) => s.agent !== 'clarify');
  shape.reasoning = `mock classifier: ${hasHeading ? 'the task is a plan' : text.length < 80 ? 'a trivial prompt' : 'a free-form prompt'}${WEB_RE.test(text) && !hasHeading && text.length >= 80 ? ' for a web feature' : ''}`;
  const web = WEB_RE.test(text) && !hasHeading && text.length >= 80;
  shape.size = hasHeading ? (text.length >= 1200 ? 'large' : 'small') : (text.length < 80 ? 'small' : 'medium');
  shape.signals = hasHeading ? ['plan', text.length >= 1200 ? 'large' : 'trivial'] : (text.length < 80 ? ['trivial'] : (web ? ['web UI'] : []));
  return shape;
}
