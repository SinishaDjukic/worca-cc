// ui/public/log-line.mjs

// Pure, DOM-free: the className for one log line, given its level and whether it
// belongs to a fanned-out sub-agent. Extracted so the sub-agent styling decision
// is unit-testable without booting app.js (mirrors composer-core.mjs).
export function logLineClass(level, sub) {
  return 'log-line lvl-' + (level || 'info') + (sub ? ' sub-agent' : '');
}
