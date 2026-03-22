import { html, nothing } from 'lit-html';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
import { iconSvg, ArrowDown, Pause, Search, Star, Clock, ClipboardCopy } from '../utils/icons.js';
import { copyTerminalToClipboard } from '../utils/terminal-clipboard.js';
import { scrollOnExpand } from '../utils/scroll.js';

// ANSI color palette for stage tags
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

// Terminal state (module-level singleton)
let terminal = null;
let fitAddon = null;
let searchAddon = null;
let lastRunId = null;
let resizeObserver = null;
let pendingInit = null;

async function ensureTerminal(container) {
  if (terminal && container.querySelector('.xterm')) {
    fitAddon.fit();
    return;
  }

  // Guard against concurrent creation (multiple rerender() calls)
  if (pendingInit) { await pendingInit; return; }

  pendingInit = (async () => {
    // Lazy-load xterm to keep initial bundle light when not in run view
    const [{ Terminal }, { FitAddon }, { SearchAddon }] = await Promise.all([
      import('@xterm/xterm'),
      import('@xterm/addon-fit'),
      import('@xterm/addon-search'),
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
      scrollback: 50000,
      convertEol: true,
      cursorBlink: false,
      disableStdin: true,
    });

    fitAddon = new FitAddon();
    searchAddon = new SearchAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(searchAddon);

    terminal.open(container);
    fitAddon.fit();

    // Observe container resize
    resizeObserver = new ResizeObserver(() => {
      if (fitAddon) fitAddon.fit();
    });
    resizeObserver.observe(container);
  })();

  await pendingInit;
  pendingInit = null;
}

export function writeLogLine(entry) {
  if (!terminal) return;
  const ts = entry.timestamp ? `${DIM}${formatTimestamp(entry.timestamp)}${RESET} ` : '';
  const stage = entry.stage ? `${stageColor(entry.stage)}[${entry.stage.toUpperCase()}]${RESET} ` : '';
  const msg = entry.line || entry;
  terminal.writeln(`${ts}${stage}${msg}`);
}

export function clearTerminal() {
  if (resizeObserver) resizeObserver.disconnect();
  if (terminal) terminal.dispose();
  terminal = null;
  fitAddon = null;
  searchAddon = null;
  resizeObserver = null;
  pendingInit = null;
  stageColorCache.clear();
  colorIdx = 0;
}

export function disposeTerminal() {
  if (resizeObserver) resizeObserver.disconnect();
  if (terminal) terminal.dispose();
  terminal = null;
  fitAddon = null;
  searchAddon = null;
  resizeObserver = null;
  pendingInit = null;
  lastRunId = null;
}

export function searchTerminal(term) {
  if (searchAddon && term) {
    searchAddon.findNext(term, { incremental: true });
  }
}

export function getTerminalInstance() {
  return terminal;
}

/**
 * Mount the terminal into the container after lit-html renders.
 * Call this from main.js after rerender().
 */
export async function mountTerminal(runId) {
  const container = document.getElementById('log-terminal');
  if (!container) return;

  if (runId !== lastRunId) {
    clearTerminal();
    lastRunId = runId;
  }

  await ensureTerminal(container);
}

export function writeIterationSeparator(iterNum) {
  if (!terminal) return;
  terminal.writeln(`\n${DIM}${'─'.repeat(40)} Iteration ${iterNum} ${'─'.repeat(40)}${RESET}\n`);
}

export function logViewerView(state, { onStageFilter, onIterationFilter, onSearch, onToggleAutoScroll, autoScroll, stageIterations, runStages }) {
  // Build stage list: orchestrator first, then pipeline stages from status.json
  const configStages = runStages ? ['orchestrator', ...Object.keys(runStages)] : null;
  const logStages = [...new Set(['orchestrator', ...state.logLines.map(l => l.stage).filter(Boolean)])];
  const stages = configStages || logStages;
  const currentStage = state.currentLogStage;
  const iterCount = stageIterations?.[currentStage] || 0;
  const showIterationSelector = currentStage && currentStage !== '*' && iterCount > 0;

  // When no specific stage is selected, show a prompt instead of concatenated logs
  const hasStageSelected = currentStage && currentStage !== '*';

  return html`
    <div class="log-history-container">
      <sl-details class="log-history-panel" @sl-after-show=${scrollOnExpand}>
        <div slot="summary" class="log-history-header">
          <span class="log-history-icon">${unsafeHTML(iconSvg(Clock, 16))}</span>
          <span class="log-history-title">Log History</span>
        </div>
        <div class="log-history-body">
          <div class="log-controls">
            <sl-select
              .value=${currentStage || ''}
              placeholder="Select a stage\u2026"
              size="small"
              clearable
              @sl-change=${(e) => onStageFilter(e.target.value || '*')}
            >
              ${stages.map(s => html`<sl-option value="${s}">${s === 'orchestrator' ? html`<span style="display:inline-flex;align-items:center;gap:4px">${unsafeHTML(iconSvg(Star, 12))} ORCHESTRATOR</span>` : s.toUpperCase()}</sl-option>`)}
            </sl-select>
            ${showIterationSelector ? html`
              <sl-select
                .value=${String(state.currentLogIteration || iterCount)}
                size="small"
                @sl-change=${(e) => onIterationFilter(e.target.value ? parseInt(e.target.value) : null)}
              >
                ${Array.from({length: iterCount}, (_, i) =>
                  html`<sl-option value="${i + 1}">Iteration ${i + 1}</sl-option>`
                )}
              </sl-select>
            ` : nothing}
            <sl-input
              class="log-search"
              type="text"
              placeholder="Search logs\u2026"
              size="small"
              clearable
              @sl-input=${(e) => onSearch(e.target.value)}
            >
              <span slot="prefix">${unsafeHTML(iconSvg(Search, 14))}</span>
            </sl-input>
            <sl-button
              size="small"
              variant="${autoScroll ? 'primary' : 'default'}"
              @click=${onToggleAutoScroll}
            >
              ${unsafeHTML(iconSvg(autoScroll ? ArrowDown : Pause, 14))}
              ${autoScroll ? 'Auto' : 'Paused'}
            </sl-button>
            ${hasStageSelected ? html`
              <button class="terminal-copy-btn" @click=${(e) => copyTerminalToClipboard(terminal, e.currentTarget)}>
                ${unsafeHTML(iconSvg(ClipboardCopy, 14))}
                Copy
              </button>
            ` : nothing}
          </div>
          ${hasStageSelected ? html`
            <div class="log-terminal-wrapper">
              <div id="log-terminal" class="log-terminal"></div>
            </div>
          ` : html`
            <div class="log-history-empty">
              <span class="log-history-empty-icon">${unsafeHTML(iconSvg(Clock, 32))}</span>
              <p>Select a stage from the dropdown to review past output.</p>
            </div>
          `}
        </div>
      </sl-details>
    </div>
  `;
}
