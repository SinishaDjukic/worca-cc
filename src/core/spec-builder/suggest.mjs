// src/core/spec-builder/suggest.mjs — V2/V3: roles, kind and size for an idea, on the utility model (the titles
// setting, title.mjs resolveTitleModel). Strict JSON reply, clamped to known values; a timeout, a bad reply, a failure
// or no utility model gives the static defaults. Mock mode answers before any spawn (R14).
import { tmpdir } from 'node:os';
import { runClaude, mockEnabled } from '../claude-runner.mjs';
import { resolveTitleModel } from '../title.mjs';
import { resolveModelEnv } from '../config.mjs';
import { AUX_EFFORT } from '../model-env.mjs';
import { safeParseJson } from '../protocol.mjs';
import { ROLES, ROLE_KEYS } from '../../shared/spec-builder/roles.mjs';
import { SPEC_KINDS, SPEC_SIZES } from '../../shared/spec-builder/front-matter.mjs';

export const SUGGEST_TIMEOUT_MS = 5_000;
export const SUGGEST_IDEA_MAX = 4_000;
export const REASON_MAX = 80;
export const DEFAULT_SUGGESTION = Object.freeze({ roles: Object.freeze(['product', 'architect', 'qa']), kind: 'feature', size: 'medium', reasons: Object.freeze({}) });

const SYSTEM = [
  'You read a software change idea and decide who should shape its spec. Reply with ONLY one JSON object, no prose:',
  '{"roles": [...], "kind": "...", "size": "...", "reasons": {"<role>": "<at most 8 words: what in the idea needs this role>"}}',
  `roles: any of ${ROLES.filter((r) => r.key !== 'product').map((r) => `${r.key} (${r.help})`).join('; ')}. Product is always included; do not list it.`,
  `kind: one of ${SPEC_KINDS.join(', ')}. size: one of ${SPEC_SIZES.join(', ')} (small: one file or a fix; large: several subsystems).`,
].join('\n');

const defaults = (source) => ({ roles: [...DEFAULT_SUGGESTION.roles], kind: DEFAULT_SUGGESTION.kind, size: DEFAULT_SUGGESTION.size, reasons: {}, source });

/** Known values only; Product always first; a reason only for a suggested role, one line, clipped. */
export function clampSuggestion(raw) {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  if (!o || !Array.isArray(o.roles)) return null;
  const roles = ROLE_KEYS.filter((k) => k === 'product' || o.roles.includes(k));
  const reasons = {};
  for (const k of roles) {
    const r = o.reasons && typeof o.reasons[k] === 'string' ? o.reasons[k].replace(/\s+/g, ' ').trim().slice(0, REASON_MAX) : '';
    if (r && k !== 'product') reasons[k] = r;
  }
  return {
    roles,
    kind: SPEC_KINDS.includes(o.kind) ? o.kind : DEFAULT_SUGGESTION.kind,
    size: SPEC_SIZES.includes(o.size) ? o.size : DEFAULT_SUGGESTION.size,
    reasons,
  };
}

/** @returns {Promise<{roles:string[], kind:string, size:string, reasons:Record<string,string>, source:'model'|'default'|'mock'}>} */
export async function suggestRoles(idea, { run = runClaude, resolveModel = resolveTitleModel, timeoutMs = SUGGEST_TIMEOUT_MS, mock, cwd = tmpdir() } = {}) {
  const text = String(idea || '').trim().slice(0, SUGGEST_IDEA_MAX);
  if (!text) return defaults('default');
  if (mockEnabled({ mock })) return defaults('mock');
  const { model } = resolveModel();
  if (!model) return defaults('default');                    // no utility model: static defaults (open question 2)
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);    // cleared in finally (classify.mjs pattern: not unref'd)
  try {
    const { text: out } = await run({
      cwd, systemPrompt: SYSTEM, prompt: `The idea:\n\n${text}`, model, modelEnv: resolveModelEnv(model),
      effort: AUX_EFFORT, permissionMode: 'acceptEdits', allowedTools: [], tools: [], strictMcpConfig: true,
      spawnKind: 'aux', signal: ctrl.signal, mock,
    });
    const s = clampSuggestion(safeParseJson(out));
    return s ? { ...s, source: 'model' } : defaults('default');
  } catch {
    return defaults('default');
  } finally {
    clearTimeout(timer);
  }
}
