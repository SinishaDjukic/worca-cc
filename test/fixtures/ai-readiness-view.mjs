// test/fixtures/ai-readiness-view.mjs — a readiness view as the host hands it to plugin scripts
// (`api.readiness`), with the eight real engines' sources copied from src/core/engines/*_INSTRUCTION_FILES
// and *_INSTRUCTION_GLOBS at the time of writing, and the default context limits.
export const SOURCES = {
  claude: { files: ['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md'], globs: ['.claude/rules/*.md'], firstNonEmpty: false },
  codex: { files: ['AGENTS.override.md', 'AGENTS.md'], globs: [], firstNonEmpty: true },
  copilot: { files: ['.github/copilot-instructions.md', 'AGENTS.md', 'CLAUDE.md', '.claude/CLAUDE.md', 'GEMINI.md'], globs: ['.github/instructions/**/*.instructions.md'], firstNonEmpty: false },
  cursor: { files: ['AGENTS.md', 'CLAUDE.md'], globs: ['.cursor/rules/**/*.mdc'], firstNonEmpty: false },
  gemini: { files: ['GEMINI.md'], globs: [], firstNonEmpty: false },
  qwen: { files: ['QWEN.md', 'AGENTS.md'], globs: [], firstNonEmpty: false },
  goose: { files: ['AGENTS.md', '.goosehints'], globs: [], firstNonEmpty: false },
  opencode: { files: ['AGENTS.md', 'CLAUDE.md'], globs: [], firstNonEmpty: false },
};
export const ENGINES = Object.keys(SOURCES);
export const LIMITS = { perFile: 20480, total: 65536 };

/** A fresh view (tests may tweak it). */
export function makeView(over = {}) {
  return {
    engines: [...ENGINES],
    labels: Object.fromEntries(ENGINES.map((e) => [e, e])),
    sources: JSON.parse(JSON.stringify(SOURCES)),
    limits: { ...LIMITS },
    judged: [...ENGINES],
    report: null,
    ...over,
  };
}
