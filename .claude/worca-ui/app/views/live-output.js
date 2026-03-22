import { html, nothing } from 'lit-html';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
import { iconSvg, Activity, ClipboardCopy } from '../utils/icons.js';
import { copyTerminalToClipboard } from '../utils/terminal-clipboard.js';
import { scrollOnExpand } from '../utils/scroll.js';

// ANSI color palette (matches log-viewer.js)
const STAGE_COLORS = [
  '\x1b[36m',  // cyan
  '\x1b[33m',  // yellow
  '\x1b[35m',  // magenta
  '\x1b[32m',  // green
  '\x1b[34m',  // blue
  '\x1b[91m',  // bright red
  '\x1b[96m',  // bright cyan
  '\x1b[93m',  // bright yellow
];
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';

const stageColorCache = new Map();
let colorIdx = 0;

/**
 * Convert an ISO timestamp to local HH:MM:SS.
 * @param {string|null|undefined} iso
 * @returns {string}
 */
export function formatTimestamp(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function stageColor(stage) {
  if (!stageColorCache.has(stage)) {
    stageColorCache.set(stage, STAGE_COLORS[colorIdx % STAGE_COLORS.length]);
    colorIdx++;
  }
  return stageColorCache.get(stage);
}

// Terminal state (module-level singleton, separate from the main log viewer)
let terminal = null;
let fitAddon = null;
let resizeObserver = null;
let lastRunId = null;
let pendingInit = null;

/** The stage key currently being tracked (e.g. 'implement', 'test') */
let activeStage = null;

async function ensureTerminal(container) {
  if (terminal && container.querySelector('.xterm')) {
    fitAddon.fit();
    return;
  }

  // Guard against concurrent creation (multiple rerender() calls)
  if (pendingInit) { await pendingInit; return; }

  pendingInit = (async () => {
    const [{ Terminal }, { FitAddon }] = await Promise.all([
      import('@xterm/xterm'),
      import('@xterm/addon-fit'),
    ]);

    terminal = new Terminal({
      theme: {
        background: '#0f172a',
        foreground: '#e2e8f0',
        cursor: '#60a5fa',
        selectionBackground: 'rgba(96, 165, 250, 0.3)',
      },
      fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",
      fontSize: 13,
      lineHeight: 1.4,
      scrollback: 10000,
      convertEol: true,
      cursorBlink: false,
      disableStdin: true,
    });

    fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    terminal.open(container);
    fitAddon.fit();

    resizeObserver = new ResizeObserver(() => {
      if (fitAddon) fitAddon.fit();
    });
    resizeObserver.observe(container);
  })();

  await pendingInit;
  pendingInit = null;
}

/**
 * Write a log entry to the live output terminal, if it matches the active stage.
 * @param {{ stage?: string, line?: string, iteration?: number }} entry
 */
export function writeLiveLogLine(entry) {
  if (!terminal) return;
  if (!activeStage) return;
  if (entry.stage !== activeStage) return;

  const ts = entry.timestamp ? `${DIM}${formatTimestamp(entry.timestamp)}${RESET} ` : '';
  const stage = entry.stage ? `${stageColor(entry.stage)}[${entry.stage.toUpperCase()}]${RESET} ` : '';
  const msg = entry.line || entry;
  terminal.writeln(`${ts}${stage}${msg}`);
}

/**
 * Write an iteration separator to the live output terminal.
 */
export function writeLiveIterationSeparator(iterNum) {
  if (!terminal) return;
  terminal.writeln(`\n${DIM}${'─'.repeat(40)} Iteration ${iterNum} ${'─'.repeat(40)}${RESET}\n`);
}

export function clearLiveTerminal() {
  if (terminal) terminal.clear();
}

export function disposeLiveTerminal() {
  if (resizeObserver) resizeObserver.disconnect();
  if (terminal) terminal.dispose();
  terminal = null;
  fitAddon = null;
  resizeObserver = null;
  pendingInit = null;
  lastRunId = null;
  activeStage = null;
}

/**
 * Determine the active stage from run data.
 * Priority: stage with status 'in_progress', else the most recently started stage.
 * @param {Object} stages - The run.stages object
 * @returns {string|null} stage key
 */
function findActiveStage(stages) {
  if (!stages) return null;

  // First, look for an in_progress stage
  for (const [key, stage] of Object.entries(stages)) {
    if (stage.status === 'in_progress') return key;
  }

  // Fallback: most recently started stage (by started_at)
  let latestKey = null;
  let latestTime = null;
  for (const [key, stage] of Object.entries(stages)) {
    if (stage.started_at && (!latestTime || stage.started_at > latestTime)) {
      latestTime = stage.started_at;
      latestKey = key;
    }
  }
  return latestKey;
}

/**
 * Update the active stage tracked by the live output.
 * If the stage changed, clear the terminal.
 * @param {Object} run - The run object from state
 * @returns {{ changed: boolean, activeStage: string|null }}
 */
export function updateActiveStage(run) {
  const stages = run?.stages;
  const newActive = findActiveStage(stages);

  if (newActive !== activeStage) {
    const prev = activeStage;
    activeStage = newActive;
    if (terminal && prev !== null) {
      terminal.clear();
      if (newActive) {
        terminal.writeln(`${DIM}--- Switched to stage: ${newActive.toUpperCase()} ---${RESET}\n`);
      }
    }
    return { changed: true, activeStage: newActive };
  }
  return { changed: false, activeStage };
}

/** Get the currently tracked active stage key */
export function getActiveStage() {
  return activeStage;
}

/** Get the live terminal instance (for clipboard access) */
export function getLiveTerminalInstance() {
  return terminal;
}

/**
 * Mount the live output terminal into its container after lit-html renders.
 * @param {string} runId
 */
export async function mountLiveTerminal(runId) {
  const container = document.getElementById('live-output-terminal');
  if (!container) return;

  if (runId !== lastRunId) {
    clearLiveTerminal();
    lastRunId = runId;
  }

  await ensureTerminal(container);
}

/**
 * Render the Live Output collapsible section.
 * @param {string|null} stageName - The active stage key
 * @param {boolean} isRunning - Whether the run is active
 */
export function liveOutputView(stageName, isRunning) {
  if (!isRunning) return nothing;

  const label = stageName ? stageName.replace(/_/g, ' ').toUpperCase() : 'WAITING';

  return html`
    <div class="live-output-container">
      <sl-details open class="live-output-panel" @sl-after-show=${scrollOnExpand}>
        <div slot="summary" class="live-output-header">
          <span class="live-output-icon">${unsafeHTML(iconSvg(Activity, 16))}</span>
          <span class="live-output-title">Live Output</span>
          ${stageName ? html`<sl-badge variant="warning" pill>${label}</sl-badge>` : nothing}
        </div>
        <div class="live-output-controls">
          <button class="terminal-copy-btn" @click=${(e) => copyTerminalToClipboard(terminal, e.currentTarget)}>
            ${unsafeHTML(iconSvg(ClipboardCopy, 14))}
            Copy
          </button>
        </div>
        <div class="live-output-terminal-wrapper">
          <div id="live-output-terminal" class="live-output-terminal"></div>
        </div>
      </sl-details>
    </div>
  `;
}
