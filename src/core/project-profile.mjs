// src/core/project-profile.mjs — what a readiness run learned about a project, stored per project
// (project_config.extra.projectProfile) for worca's chat and agent wizard. Written from an agent's
// artifact, so every field is copied from a fixed list and clipped; nothing else is kept.
import { readProjectProfileRaw, writeProjectProfileRaw } from './config.mjs';
import { DECLARED_ENGINES as TOOLS } from './repo-readiness/engines.mjs';
import { redactAskText } from './ask/redact.mjs';

export const PROFILE_MAX_BYTES = 64 * 1024;
const LIST_MAX = 24;
// Every stored string is agent-written: redact secrets before clipping, so nothing a run printed lands in the store.
const str = (v, n) => (typeof v === 'string' ? redactAskText(v).slice(0, n) : '');
const list = (v, n) => (Array.isArray(v) ? v.slice(0, LIST_MAX).map((x) => str(x, n)).filter(Boolean) : []);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : null);

export function sanitizeProfile(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { profile: null, error: 'profile is not an object' };
  if (raw.version !== 1) return { profile: null, error: `unsupported profile version ${String(raw.version).slice(0, 20)}` };
  const stack = raw.stack && typeof raw.stack === 'object' ? raw.stack : {};
  const score = raw.score && typeof raw.score === 'object' ? raw.score : {};
  const tools = {};
  for (const t of TOOLS) if (num(score.tools?.[t]) !== null) tools[t] = num(score.tools[t]);
  const profile = {
    version: 1,
    source: str(raw.source, 40) || 'ai-readiness',
    phase: raw.phase === 'final' ? 'final' : 'baseline',
    summary: str(raw.summary, 1500),
    architecture: str(raw.architecture, 3000),
    stack: { language: str(stack.language, 80), framework: str(stack.framework, 80), packageManager: str(stack.packageManager, 40), testRunner: str(stack.testRunner, 80) },
    conventions: list(raw.conventions, 400),
    entryPoints: list(raw.entryPoints, 200),
    commands: (Array.isArray(raw.commands) ? raw.commands : []).slice(0, LIST_MAX)
      .map((c) => ({ kind: str(c?.kind, 20), command: str(c?.command, 300) })).filter((c) => c.command),
    gotchas: list(raw.gotchas, 400),
    recurringTasks: (Array.isArray(raw.recurringTasks) ? raw.recurringTasks : []).slice(0, LIST_MAX)
      .map((t) => ({ id: str(t?.id, 80), name: str(t?.name, 160) })).filter((t) => t.id),
    tools: list(raw.tools, 20).filter((t) => TOOLS.includes(t)),
    score: { overall: num(score.overall), core: num(score.core), tools },
  };
  if (Buffer.byteLength(JSON.stringify(profile)) > PROFILE_MAX_BYTES) return { profile: null, error: 'profile is larger than 64 KiB' };
  return { profile, error: null };
}

export function writeProjectProfile(key, raw, { runId = '', source = '' } = {}) {
  const { profile, error } = sanitizeProfile(raw);
  if (!profile) throw new Error(error);
  const record = { ...profile, ...(source ? { source: str(source, 40) } : {}), runId: str(runId, 64), updatedAt: new Date().toISOString() };
  writeProjectProfileRaw(key, record);
  return record;
}

export function readProjectProfile(key) {
  return readProjectProfileRaw(key);
}

/** A short markdown block for a prompt; '' when there is no profile. */
export function profileSummary(p, { maxChars = 2000 } = {}) {
  if (!p) return '';
  const L = ['## Project profile', '', p.summary];
  const s = p.stack || {};
  const stack = [s.language, s.framework, s.packageManager, s.testRunner].filter(Boolean).join(', ');
  if (stack) L.push('', `Stack: ${stack}`);
  if (p.commands?.length) L.push('', 'Commands:', ...p.commands.map((c) => `- ${c.kind}: \`${c.command}\``));
  if (p.conventions?.length) L.push('', 'Conventions:', ...p.conventions.map((c) => `- ${c}`));
  if (p.gotchas?.length) L.push('', 'Gotchas:', ...p.gotchas.map((g) => `- ${g}`));
  if (p.recurringTasks?.length) L.push('', `Recurring tasks: ${p.recurringTasks.map((t) => t.name || t.id).join('; ')}`);
  if (p.score?.overall !== null && p.score?.overall !== undefined) L.push('', `AI-readiness: ${p.score.overall}/100 (${p.phase}, ${p.updatedAt || 'unknown date'})`);
  const out = L.join('\n');
  return out.length > maxChars ? `${out.slice(0, maxChars - 1)}…` : out;
}
