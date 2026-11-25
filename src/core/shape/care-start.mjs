// src/core/shape/care-start.mjs — Shaper small runs B2: the Start step's ask. It composes the feature's size, Worca's Care
// pick and its reason, an estimate and a description per position, the project's History per position, the install's
// model names and the line naming the models a person set; and it validates the answer, keeping only the position.
import { CARE_LABELS, CARE_POSITIONS, careDescription, careFactsOf, worcaCarePick } from '../../shared/shape/feature-record.mjs';
import { GRAPH_SHAPE_WORKFLOW } from '../graph/builtin-workflows.mjs';
import { careEstimates, estimateGraph, stepHistory } from './estimate.mjs';
import { figuresByCare, NOT_ENOUGH_HISTORY } from './measure.mjs';
import { resolveRoleModel } from '../model-roles.mjs';
import { utilityModelFor } from '../settings-cascade.mjs';
import { listModels } from '../config.mjs';

const CARE_REFUSED = Object.freeze([{ field: 'care', message: 'Care must be Lean, Balanced or Thorough.' }]);
const KEPT_TEXT = Object.freeze({ run: 'your picks for this run are kept for', project: "your project's picks are kept for", slot: 'your step models are kept for' });
const andList = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
const agentsText = (n) => `${n} agent${n === 1 ? '' : 's'}`;

/** The install's model for a name in the Care table (`everyday`, `deep`, `second`), as its catalog label; null when unset. */
async function installModelName(engine, role, projectDir) {
  const model = role === 'second'
    ? utilityModelFor(engine, 'secondOpinion', projectDir ? { projectDir } : null).model
    : resolveRoleModel(engine, role)?.model;
  if (!model) return null;
  const rows = await listModels(projectDir || '').catch(() => []);
  return rows.find((m) => m.id === model)?.label || model;
}

/** "Models: …" naming the layers a person set that Care keeps (resolveGraph's fillNotes.kept), or null when none. */
function modelsLineOf(fillNotes) {
  const kept = fillNotes && typeof fillNotes.kept === 'object' ? fillNotes.kept : {};
  const parts = Object.keys(KEPT_TEXT).map((k) => [k, Array.isArray(kept[k]) ? kept[k].length : 0]).filter(([, n]) => n > 0)
    .map(([k, n]) => `${KEPT_TEXT[k]} ${agentsText(n)}`);
  return parts.length ? `Models: ${parts.join(' · ')}` : null;
}

/** The cap shown when two or more positions' figures are equal: what recorded step costs cannot price yet. */
function estimateCapOf(estimates) {
  const priced = CARE_POSITIONS.filter((p) => estimates[p]);
  const same = priced.filter((p) => priced.some((q) => q !== p && estimates[q].costUsd === estimates[p].costUsd));
  return same.length >= 2 ? `${andList(same.map((p) => CARE_LABELS[p]))} differ in fix cycles and models, which recorded step costs do not show yet` : null;
}

function historyOf(entry, position) {
  const features = Number.isInteger(entry?.features) ? entry.features : 0;
  if (!entry?.enough || !entry.figures) return { enough: false, features, line: `${CARE_LABELS[position]}: ${NOT_ENOUGH_HISTORY}` };
  const f = entry.figures;
  return { enough: true, features, line: `${CARE_LABELS[position]} · ${f.changesAfterShip} changes after ship per feature · ≈ $${f.costPerFeature} each · ${features} features` };
}

/**
 * The Start step's ask body (`{ kind: 'care', care }`). Never throws: a failing estimate or figures read gives null /
 * "not enough history yet" and one warn. `fillNotes` is the orchestrator's own resolveGraph probe (its registry and
 * agents dir). Seams: `deps.history`, `deps.figures`, `deps.roleModel(engine, 'everyday'|'deep'|'second')`, `deps.warn`.
 */
export async function careStartAsk({ prompt, size, projectDir = null, engine = 'claude', fillNotes = null, deps = {} } = {}) {
  const facts = careFactsOf({ prompt, size });
  const pick = worcaCarePick(facts);
  const failed = [];
  let perRun = null;
  try { perRun = estimateGraph(GRAPH_SHAPE_WORKFLOW, (deps.history || stepHistory)()); } catch (err) { failed.push(`estimate: ${err?.message || err}`); }
  let figures = {};
  try { figures = (deps.figures || figuresByCare)({ projectDir }) || {}; } catch (err) { failed.push(`history: ${err?.message || err}`); }
  if (failed.length) (deps.warn || ((m) => console.warn(`[worca] ${m}`)))(`Care: ${failed.join('; ')}`);
  const nameOf = async (role) => {
    try { return (await (deps.roleModel || ((e, r) => installModelName(e, r, projectDir)))(engine, role)) || null; } catch { return null; }
  };
  const names = { everyday: await nameOf('everyday'), strong: await nameOf('deep'), second: await nameOf('second') };
  const estimates = careEstimates({ requirements: facts.requirements, perRun });
  return {
    size: facts.size,
    facts,
    pick,
    positions: Object.fromEntries(CARE_POSITIONS.map((p) => [p, { description: careDescription(p, names), estimate: estimates[p] }])),
    estimateCap: estimateCapOf(estimates),
    history: Object.fromEntries(CARE_POSITIONS.map((p) => [p, historyOf(figures[p], p)])),
    names,
    modelsLine: modelsLineOf(fillNotes),
  };
}

/** The `validate` of a Care ask: only `payload.care.position` is read from the client; who chose it, Worca's pick, the
 *  reason and the facts come from the ask the server raised. `now` is a test seam. */
export function careAnswerValidator(start, { now = () => new Date() } = {}) {
  return (payload) => {
    const position = payload && typeof payload === 'object' && payload.care && typeof payload.care === 'object' ? payload.care.position : null;
    if (!CARE_POSITIONS.includes(position)) return { ok: false, errors: CARE_REFUSED.map((e) => ({ ...e })) };
    const worcaPick = start?.pick?.position ?? null;
    return { ok: true, payload: {
      position, chosenBy: position === worcaPick ? 'default' : 'person', worcaPick,
      reason: String(start?.pick?.reason || '').slice(0, 200), facts: start?.facts, at: now().toISOString(),
    } };
  };
}
