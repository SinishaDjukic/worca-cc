// src/core/naming.mjs — Smart run naming (flag smartRunNaming, docs/feature-flags.md): the one branch-name
// entry point for starts that got no explicit name, and the single cheap model call behind the New run form.
import { flagEnabled } from './flags.mjs';
import { smartNaming } from './settings.mjs';
import { auxTextCall, sanitizeTitle, isRefusalTitle, resolveTitleModel } from './title.mjs';
import { sanitizeBranchName, suggestBranchName, deriveBranchSlug, listLocalBranches } from './worktree.mjs';
import { renderBranch, normalizeType } from '../shared/naming/pattern.mjs';
import { modelFacts } from './model-tiers.mjs';

const shortOf = (id) => String(id || '').slice(0, 8) || 'run';

/** The one branch-name entry point for every start that did not get an explicit name.
 *  Flag off: exactly suggestBranchName. Flag on: the pattern, the first (fallback) type, no model. */
export function deriveBranchName({ prompt, title, pipelineId, ticket = '', projectDir } = {}, deps = {}) {
  if (!(deps.flagEnabled || flagEnabled)('smartRunNaming')) return suggestBranchName({ prompt, title, pipelineId });
  const cfg = (deps.settings || smartNaming)(projectDir ? { projectDir } : undefined);
  const slug = deriveBranchSlug({ prompt, title }) || 'feature';
  return sanitizeBranchName(renderBranch(cfg, { type: cfg.types[0], slug, ticket, id: shortOf(pipelineId) }));
}

/** An existing local branch is never silently reused for a name WE derived: append -shortId. */
export async function uniqueBranch(projectDir, name, pipelineId, list = listLocalBranches) {
  const have = new Set(await list(projectDir));
  return have.has(name) ? sanitizeBranchName(`${name}-${shortOf(pipelineId)}`) : name;
}

/** Cheapest ready Claude model at its lowest listed effort; null when the catalog offers none. Pure. */
export function pickNamingModel(rows, costOf) {
  const facts = modelFacts(rows, { costOf }).filter((f) => f.ready && (f.engines || []).includes('claude') && !f.free);
  facts.sort((a, b) => (a.price?.output ?? Infinity) - (b.price?.output ?? Infinity) || (b.tierRank ?? 0) - (a.tierRank ?? 0));
  const best = facts[0];
  return best ? { model: best.id, effort: best.efforts?.[0] || null } : null;
}

/**
 * Which model (and effort) Smart run naming runs on: the stored Models-page pair (settings.mjs#namingModel)
 * while the catalog still carries it, else pickNamingModel's cheapest ready Claude model at its lowest effort,
 * else nothing (suggestNames then falls back to resolveTitleModel). Mirrors agent-gen.mjs#resolveAgentGenModel:
 * an effort the model does not offer is dropped, and `stale` names a stored id the catalog no longer carries.
 * @param {{model:string|null, effort:string|null}} stored
 * @param {Array<object>} rows the effective catalog (listModels)
 * @param {Function} [costOf] the cost config pickNamingModel prices with
 * @returns {{model:string|null, effort:string|null, source:'settings'|'auto'|'default', stale:string|null}}
 */
export function resolveNamingModel(stored, rows, costOf) {
  const list = Array.isArray(rows) ? rows : [];
  const want = stored && typeof stored.model === 'string' ? stored.model.trim() : '';
  if (want) {
    const hit = list.find((m) => m && typeof m.id === 'string' && m.id.toLowerCase() === want.toLowerCase());
    if (hit) {
      const effort = stored.effort && Array.isArray(hit.efforts) && hit.efforts.includes(stored.effort) ? stored.effort : null;
      return { model: hit.id, effort, source: 'settings', stale: null };
    }
  }
  const auto = pickNamingModel(list, costOf);
  const stale = want || null;
  return auto ? { ...auto, source: 'auto', stale } : { model: null, effort: null, source: 'default', stale };
}

const SYSTEM = (types) => [
  'You name a software task. Reply with ONE JSON object and nothing else:',
  '{"title": 3-8 words, no trailing period, "type": exactly one of ' + JSON.stringify(types) + ',',
  '"slug": 2-5 lowercase words joined by hyphens, "reason": under 15 words saying why that type}.',
  'If you are unsure of the type use ' + JSON.stringify(types[0]) + '. Never ask questions or add commentary.',
].join(' ');

/** Parse the model's reply; null when it is not a usable object. */
export function parseSuggestion(raw, types) {
  const m = /\{[\s\S]*\}/.exec(String(raw || ''));
  if (!m) return null;
  let o; try { o = JSON.parse(m[0]); } catch { return null; }
  if (!o || typeof o !== 'object') return null;
  const title = sanitizeTitle(String(o.title || ''));
  if (title && isRefusalTitle(title)) return null;
  const slug = sanitizeBranchName(String(o.slug || '')).replace(/\//g, '-');
  if (!title && !slug) return null;
  return {
    title,
    type: normalizeType(o.type, types),
    slug,
    reason: String(o.reason || '').replace(/\s+/g, ' ').trim().slice(0, 140),
  };
}

/**
 * One model call -> { source:'model', title, type, slug, reason, branch, types, pattern, model } or
 * { source:'fallback', error }. Never throws. `deps.run` / `deps.onCost` inject the spawn and the cost sink;
 * `deps.pickModel` returns the resolved `{ model, effort }` (resolveNamingModel), or null.
 */
export async function suggestNames({ prompt, title = '', projectDir, signal, mock = false }, deps = {}) {
  const cfg = (deps.settings || smartNaming)(projectDir ? { projectDir } : undefined);
  const text = String(prompt || '').trim();
  if (!text) return { source: 'fallback', error: 'empty task' };
  // The server resolves the pair per suggestion (resolveNamingModel: the Models page's Run naming, else the
  // cheapest ready Claude model); with neither, the title model, as before the setting existed.
  const chosen = deps.pickModel?.() || null;
  const model = chosen?.model || resolveTitleModel({}).model || undefined;
  try {
    const out = await auxTextCall({
      systemPrompt: SYSTEM(cfg.types),
      prompt: `Task:\n${text.slice(0, 2000)}${title ? `\n\nTitle the person wrote: ${title}` : ''}`,
      model,
    }, { cwd: projectDir, signal, mock, run: deps.run, onCost: deps.onCost, effortOverride: chosen?.effort || undefined });
    const s = parseSuggestion(out, cfg.types);
    if (!s) return { source: 'fallback', error: 'the model did not return a usable name' };
    const slug = s.slug || deriveBranchSlug({ prompt: text, title: s.title }) || 'feature';
    return {
      source: 'model', ...s, slug, model: model || null, types: cfg.types, pattern: cfg.pattern, addRunId: cfg.addRunId,
      branch: sanitizeBranchName(renderBranch({ ...cfg, addRunId: false }, { type: s.type, slug, id: '' })),
    };
  } catch (err) {
    return { source: 'fallback', error: err?.name === 'AbortError' ? 'cancelled' : String(err?.message || err).slice(0, 200) };
  }
}

// #948 s3: a name for a topic group of chats, on the Run naming helper model. The prompt carries each chat's title
// and its first message, nothing else.
export const GROUP_NAME_CHATS = 20;
export const GROUP_NAME_CHARS = 300;
const groupSystem = (of = 'chats') => [
  `You name a group of ${of === 'runs' ? 'runs' : 'chats'} by the topic they share. Reply with ONE JSON object and nothing else:`,
  '{"name": 2-5 words, no trailing period}. Never ask questions or add commentary.',
].join(' ');

/** The user prompt: one numbered entry per item (title, then its first message, or a run's prompt), at most GROUP_NAME_CHATS. */
export function groupNamePrompt(chats, { of = 'chats' } = {}) {
  const runs = of === 'runs';
  const one = (c, i) => {
    const title = String(c.title || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const first = String(c.firstMessage || '').replace(/\s+/g, ' ').trim().slice(0, GROUP_NAME_CHARS);
    return `${i + 1}. Title: ${title || '(none)'}${first ? `\n   ${runs ? 'Prompt' : 'First message'}: ${first}` : ''}`;
  };
  return [runs ? 'Runs:' : 'Chats:', ...(chats || []).slice(0, GROUP_NAME_CHATS).map(one)].join('\n');
}

/** The name in the model's reply ('' when unusable). */
export function parseGroupName(raw) {
  const m = /\{[\s\S]*\}/.exec(String(raw || ''));
  if (!m) return '';
  let o; try { o = JSON.parse(m[0]); } catch { return ''; }
  const name = sanitizeTitle(String((o && o.name) || '')).slice(0, 60).trim();
  return name && !isRefusalTitle(name) ? name : '';
}

/** One model call -> { source: 'model', name, model } or { source: 'fallback', error }. Never throws. */
export async function suggestGroupName({ chats, of = 'chats', signal }, deps = {}) {
  if (!Array.isArray(chats) || !chats.length) return { source: 'fallback', error: 'no chats' };
  const chosen = deps.pickModel?.() || null;
  const model = chosen?.model || resolveTitleModel({}).model || undefined;
  try {
    const out = await auxTextCall({ systemPrompt: groupSystem(of), prompt: groupNamePrompt(chats, { of }), model },
      { signal, run: deps.run, onCost: deps.onCost, effortOverride: chosen?.effort || undefined });
    const name = parseGroupName(out);
    return name ? { source: 'model', name, model: model || null } : { source: 'fallback', error: 'the model did not return a usable name' };
  } catch (err) {
    return { source: 'fallback', error: err?.name === 'AbortError' ? 'cancelled' : String(err?.message || err).slice(0, 200) };
  }
}

/** Today's name without its id: what the form shows when the model is unavailable (D10). */
export function legacyBranchHint(prompt, title) {
  return suggestBranchName({ prompt, title }).replace(/-run$/, '');
}

/** A deterministic suggestion that spawns nothing (mock mode: tests and CDP proofs). */
export function mockSuggestion(prompt, cfg) {
  const slug = deriveBranchSlug({ prompt }) || 'feature';
  const type = cfg.types[0];
  return {
    source: 'model', title: 'Mock title', type, slug, reason: 'mock', model: null, types: cfg.types, pattern: cfg.pattern, addRunId: cfg.addRunId,
    branch: sanitizeBranchName(renderBranch({ ...cfg, addRunId: false }, { type, slug, id: '' })),
  };
}

const EST_IN = 300;
const EST_OUT = 30;
/** About 300 input and 30 output tokens at the picked model's per-million price; null when unpriced. */
export function estimateNamingUsd(picked, rows = [], costOf = () => null) {
  if (!picked?.model) return null;
  const f = modelFacts(rows, { costOf }).find((x) => x.id === picked.model);
  if (!f?.price) return null;
  return (EST_IN * f.price.input + EST_OUT * f.price.output) / 1e6;
}
