// src/core/engines/cli-specs.mjs — per-engine facts the shared CLI resolver
// (src/core/cli-resolve.mjs) needs on Windows. Pure data: where an npm install
// keeps the package's native .exe relative to its `.cmd` shim, and the texts for
// the cases it cannot resolve. The candidate paths are an optimisation — a shim
// that names a node entry script still resolves to `node <script>` without them.
import { join, dirname } from 'node:path';

/** npm's global layout for Claude Code: the postinstall copies the platform
 *  binary over a ~500-byte text placeholder at this path, next to the shim. */
export const NPM_CLAUDE_EXE_SEGMENTS = Object.freeze(['node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe']);

const seg = (path) => Object.freeze(path.split('/'));

export const CLAUDE_CLI = Object.freeze({
  id: 'claude', label: 'Claude Code', envVar: 'WORCA_CLAUDE_BIN',
  candidates: Object.freeze([NPM_CLAUDE_EXE_SEGMENTS]),
  // Supported Claude (>= 2.1) is always native; a node-launched shim is not a layout we know.
  allowNode: false,
  placeholderHint: (p) => `Worca would run the package's native binary instead, but ${p} is still npm's placeholder — ` +
    `the package's postinstall did not run (--ignore-scripts / --omit=optional). Run: node ${join(dirname(dirname(p)), 'install.cjs')}, ` +
    'or reinstall Claude Code without those flags.',
  noNativeHint: 'Install the native Windows build (irm https://claude.ai/install.ps1 | iex), or set WORCA_CLAUDE_BIN to the full path of claude.exe.',
});

export const COPILOT_CLI = Object.freeze({
  id: 'copilot', label: 'GitHub Copilot CLI', envVar: 'WORCA_COPILOT_BIN',
  candidates: Object.freeze([
    seg('node_modules/@github/copilot/node_modules/@github/copilot-win32-{arch}/copilot.exe'),
    seg('node_modules/@github/copilot-win32-{arch}/copilot.exe'),
  ]),
  allowNode: true,
});

export const CODEX_CLI = Object.freeze({
  id: 'codex', label: 'Codex CLI', envVar: 'WORCA_CODEX_BIN',
  candidates: Object.freeze([
    seg('node_modules/@openai/codex/node_modules/@openai/codex-win32-{arch}/vendor/{triple}/codex/codex.exe'),
    seg('node_modules/@openai/codex-win32-{arch}/vendor/{triple}/codex/codex.exe'),
    seg('node_modules/@openai/codex/vendor/{triple}/codex/codex.exe'),
  ]),
  allowNode: true,
});

export const OPENCODE_CLI = Object.freeze({
  id: 'opencode', label: 'OpenCode', envVar: 'WORCA_OPENCODE_BIN',
  candidates: Object.freeze([
    seg('node_modules/opencode-ai/node_modules/opencode-windows-{arch}/bin/opencode.exe'),
    seg('node_modules/opencode-windows-{arch}/bin/opencode.exe'),
  ]),
  allowNode: true,
});

export const GEMINI_CLI = Object.freeze({ id: 'gemini', label: 'Gemini CLI', envVar: 'WORCA_GEMINI_BIN', candidates: Object.freeze([]), allowNode: true });
export const QWEN_CLI = Object.freeze({ id: 'qwen', label: 'Qwen Code', envVar: 'WORCA_QWEN_BIN', candidates: Object.freeze([]), allowNode: true });
export const GOOSE_CLI = Object.freeze({ id: 'goose', label: 'Goose CLI', envVar: 'WORCA_GOOSE_BIN', candidates: Object.freeze([]), allowNode: true });
export const CURSOR_CLI = Object.freeze({ id: 'cursor', label: 'Cursor CLI', envVar: 'WORCA_CURSOR_BIN', candidates: Object.freeze([]), allowNode: true });

export const ENGINE_CLIS = Object.freeze({
  claude: CLAUDE_CLI, codex: CODEX_CLI, copilot: COPILOT_CLI, cursor: CURSOR_CLI,
  gemini: GEMINI_CLI, qwen: QWEN_CLI, goose: GOOSE_CLI, opencode: OPENCODE_CLI,
});

/** The binary each engine's adapter spawns when nothing overrides it (a worker reports which of
 *  these it has; the spawn seam refuses an engine binary a worker lacks before trying it). */
export const DEFAULT_ENGINE_BINS = Object.freeze({
  claude: 'claude', codex: 'codex', copilot: 'copilot', cursor: 'cursor-agent',
  gemini: 'gemini', qwen: 'qwen', goose: 'goose', opencode: 'opencode',
});
