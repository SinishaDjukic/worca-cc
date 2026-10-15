// src/core/repo-readiness/used.mjs
// Which engines a project uses, and why (spec 4.6). Pure: the caller passes settings, the run
// engine, run-history counts and the facts' tool files. AGENTS.md alone marks no engine.
export const HISTORY_DAYS = 90;
const SETTINGS = new Set(['used', 'unused']);

/** Tool-specific instruction files in the tracked set → { engine: text shown after "in repo" }. */
export function toolFiles(facts) {
  const t = facts?.trackedSet;
  if (!t) return {};
  const any = (prefix) => [...t].some((p) => p.startsWith(prefix));
  const out = {};
  if (t.has('CLAUDE.md')) out.claude = 'CLAUDE.md';
  else if (t.has('.claude/CLAUDE.md')) out.claude = '.claude/CLAUDE.md';
  if (t.has('.github/copilot-instructions.md')) out.copilot = 'copilot-instructions.md';
  else if (any('.github/instructions/')) out.copilot = '.github/instructions';
  if (any('.cursor/rules/')) out.cursor = '.cursor/rules';
  return out;
}

export function usedEngines({ engines, runEngine, history = {}, files = {}, settings = {} }) {
  const out = {};
  for (const name of engines) {
    const setting = SETTINGS.has(settings[name]) ? settings[name] : 'detect';
    const signals = [];
    if (name === runEngine) signals.push({ kind: 'run-engine', text: 'runs use it' });
    const n = Number(history[name]) || 0;
    if (n > 0) signals.push({ kind: 'history', text: `used in ${n} run${n === 1 ? '' : 's'}` });
    if (files[name]) signals.push({ kind: 'file', text: `${files[name]} in repo` });
    const detected = signals.length > 0;
    const isRun = name === runEngine;
    const used = isRun || setting === 'used' || (setting === 'detect' && detected);
    const reasons = isRun ? signals.slice(0, 1)
      : setting === 'used' ? [{ kind: 'setting', text: 'set by you' }]
      : setting === 'detect' ? signals.slice(0, 1) : [];
    out[name] = { used, setting, detected, reasons, signals };
  }
  return out;
}
