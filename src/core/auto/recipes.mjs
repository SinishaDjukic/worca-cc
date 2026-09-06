// The ONE Auto-path module where agent keys may appear (spec D23): prompt
// guidance for the classifier and the canned shapes the offline mock answers
// with. The assembler and the orchestrator never read these keys — they read
// port meta.

export const RECIPE_GUIDE = [
  '## Recipes (starting points — adapt them to the task)',
  'Task kinds:',
  '- prompt (an idea, request or bug report; no plan): clarify → planner → refiner (selfLoop) → implementer ⇄ reviewer',
  '- plan-partial (a sketch, or a plan with gaps): planner → refiner (selfLoop) → implementer ⇄ reviewer',
  '- plan-complete-detailed (a complete, detailed plan): implementer ⇄ reviewer — the task document IS the plan',
  '- plan-complete-small (a complete but small plan): implementer only',
  'Modifiers:',
  '- web / UI feature (pages, components, CSS, browser behaviour, or the fingerprint says "web-ui likely"): append manualTestsChecklist → manualWebUiTesting after the reviewer; its review loops back into the implementer automatically',
  '- large task (many files or subsystems): insert decomposer between the refiner and the implementer and set the implementer\'s fanOut to true',
  '- risky or large plan: add planReviewer right after the planner (it loops back into the planner)',
  '- trivial (a typo, a one-liner, a rename): planner → implementer ⇄ reviewer — no clarify, no refiner',
  'Rules: only a clarifier stage asks the user up front; a verifier loops automatically to the nearest earlier stage that can take its verdict (declare "loops" only to override, "loop": false to suppress); give "selfLoop": true to every stage whose card says it can loop on itself; use "parallel" only for stages that do not depend on each other; a stage after a parallel group waits for the whole group on every cycle; a verifier after a group loops back to a stage BEFORE the group unless it reads a member\'s output directly (the assembler enforces this — never loop into a member the verifier does not read); plugin and user agents (the card\'s origin field: plugin:<name> or user) fit wherever their ports match.',
].join('\n');

const S = (agent, extra = {}) => ({ agent, ...extra });
const REFINER = () => S('refiner', { selfLoop: true });

/** Every base × modifier the classifier is taught, as shapes the tests run offline. */
export const RECIPE_SHAPES = Object.freeze([
  { id: 'prompt', shape: { name: 'Clarify, plan, refine, implement + review', taskKind: 'prompt', stages: [S('clarify'), S('planner'), REFINER(), S('implementer'), S('reviewer')] } },
  { id: 'plan-partial', shape: { name: 'Plan, refine, implement + review', taskKind: 'plan-partial', stages: [S('planner'), REFINER(), S('implementer'), S('reviewer')] } },
  { id: 'plan-complete-detailed', shape: { name: 'Implement + review the plan', taskKind: 'plan-complete-detailed', stages: [S('implementer'), S('reviewer')] } },
  { id: 'plan-complete-small', shape: { name: 'Implement the plan', taskKind: 'plan-complete-small', stages: [S('implementer')] } },
  { id: 'trivial', shape: { name: 'Quick fix', taskKind: 'prompt', stages: [S('planner'), S('implementer'), S('reviewer')] } },
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
