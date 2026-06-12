import { html, nothing } from 'lit-html';
import { unsafeHTML } from 'lit-html/directives/unsafe-html.js';
import { helpFor } from '../utils/help-links.js';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  iconSvg,
} from '../utils/icons.js';

// Module-level state for collapse/expand (mirrors run-timeline.js zoom state pattern)
const _collapsedStages = new Map(); // stage → boolean
const _collapsedDirs = new Set(); // dir path

// Module-level state for interactive controls
let _heatmap = true;
let _showReads = true;
let _showWrites = true;
let _pathFilter = '';
let _sortMode = 'tree'; // 'tree' | 'most-read' | 'most-written' | 'churn'
let _groupSearchesByStage = false;
let _groupGraphByStage = false;

// File-column width persistence. The drag handle on the File column header
// rewrites this and saves to localStorage so the chosen width survives
// reloads and re-renders. ``null`` means "use the CSS default" (220px).
const FILE_COL_WIDTH_STORAGE_KEY = 'worca:access:fileColWidth';
const FILE_COL_WIDTH_MIN = 160;
const FILE_COL_WIDTH_MAX = 800;

function _readSavedFileColWidth() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(FILE_COL_WIDTH_STORAGE_KEY);
    if (!raw) return null;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n)) return null;
    return _clampFileColWidth(n);
  } catch {
    return null;
  }
}

function _clampFileColWidth(n) {
  return Math.max(FILE_COL_WIDTH_MIN, Math.min(FILE_COL_WIDTH_MAX, n));
}

let _fileColWidth = _readSavedFileColWidth();

// Drawer state — null = closed; { type: 'file'|'cell', filePath, colKey } = open
let _openDrawer = null; // { type, filePath, colKey? }

// Rerender callback — set from options on each render call so click handlers
// can trigger a re-render without main.js coupling.
let _rerenderFn = () => {};

function _rerender() {
  _rerenderFn();
}

export function _resetAccessStateForTests() {
  _collapsedStages.clear();
  _collapsedDirs.clear();
  _heatmap = true;
  _showReads = true;
  _showWrites = true;
  _pathFilter = '';
  _sortMode = 'tree';
  _groupSearchesByStage = false;
  _groupGraphByStage = false;
  _openDrawer = null;
  _fileColWidth = null;
  _rerenderFn = () => {};
}

export function _setFileColWidthForTests(width) {
  _fileColWidth = width == null ? null : _clampFileColWidth(width);
}

export function _setControlsForTests({
  heatmap,
  showReads,
  showWrites,
  pathFilter,
  sortMode,
  groupByStage,
} = {}) {
  if (heatmap !== undefined) _heatmap = heatmap;
  if (showReads !== undefined) _showReads = showReads;
  if (showWrites !== undefined) _showWrites = showWrites;
  if (pathFilter !== undefined) _pathFilter = pathFilter;
  if (sortMode !== undefined) _sortMode = sortMode;
  if (groupByStage !== undefined) _groupSearchesByStage = groupByStage;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function runFileAccessView(_run, _settings, options = {}) {
  const { model, onOpenTimeline, onRerender } = options;
  _rerenderFn = onRerender || (() => {});

  if (!model) {
    return html`<div class="run-file-access">
      <div class="access-loading">Loading file access data…</div>
    </div>`;
  }

  if (!model.enabled) {
    // The server returns { enabled: false } purely when no
    // pipeline.iteration.access events were found for this run — it does NOT
    // inspect the worca version or the config flag. So the message must not
    // assert a version/config cause (it was misdiagnosing runs that simply
    // recorded nothing). State the fact, then give neutral hints.
    return html`<div class="run-file-access">
      <div class="access-empty-state">
        <p>No file access was recorded for this run.</p>
        <p class="access-empty-hint">File-access telemetry must be enabled
          (<code>worca.telemetry.file_access.enabled</code>, on by default) and
          the run must have started after it was wired up — older or in-flight
          runs aren't backfilled.</p>
      </div>
    </div>`;
  }

  const {
    columns = [],
    tree = [],
    searches = [],
    graphQueries = [],
    summary = {},
  } = model;

  // Group columns by stage
  const stageGroups = _buildStageGroups(columns);

  // Saved column width carries through as an inline CSS var on the root so
  // the grid template (var(--fa-file-col-width)) and the sticky cells (also
  // var(--fa-file-col-width)) read the user's chosen value in lockstep. The
  // resize handle's pointer events also rewrite this var directly, but the
  // inline style here guarantees the value survives any re-render.
  const rootStyle =
    _fileColWidth != null ? `--fa-file-col-width:${_fileColWidth}px` : nothing;

  return html`<div class="run-file-access help-host" style=${rootStyle}>
    ${helpFor('access-map')}
    ${_kpiStrip(summary)}
    ${_controlsBar()}
    ${_treetable(tree, columns, stageGroups, searches)}
    ${_searchesLane(searches)}
    ${_graphQueriesLane(graphQueries)}
    ${_captureStrip(summary)}
    ${_drawerOverlay(model, columns, onOpenTimeline)}
  </div>`;
}

// ---------------------------------------------------------------------------
// Controls bar
// ---------------------------------------------------------------------------

function _controlsBar() {
  return html`<div class="access-controls">
    <button
      class="access-heatmap-toggle${_heatmap ? ' access-heatmap-toggle--active' : ''}"
      type="button"
      title="Toggle heatmap shading by op-count density"
      @click=${() => {
        _heatmap = !_heatmap;
        _rerender();
      }}
    >⊞ Heatmap</button>

    <div class="access-chips">
      <button
        class="access-chip access-chip--reads${_showReads ? ' access-chip--active' : ''}"
        type="button"
        @click=${() => {
          _showReads = !_showReads;
          _rerender();
        }}
      ><span aria-hidden="true">▣</span> Reads</button>
      <button
        class="access-chip access-chip--writes${_showWrites ? ' access-chip--active' : ''}"
        type="button"
        @click=${() => {
          _showWrites = !_showWrites;
          _rerender();
        }}
      ><span aria-hidden="true">▣</span> Writes</button>
    </div>

    <input
      class="access-path-filter"
      type="text"
      aria-label="Filter paths by glob"
      placeholder="Filter paths (glob)…"
      .value=${_pathFilter}
      @input=${(e) => {
        _pathFilter = e.target.value;
        _rerender();
      }}
    />

    <select
      class="access-sort-select"
      aria-label="Sort files"
      .value=${_sortMode}
      @change=${(e) => {
        _sortMode = e.target.value;
        _rerender();
      }}
    >
      <option value="tree">Tree</option>
      <option value="most-read">Most read</option>
      <option value="most-written">Most written</option>
      <option value="churn">Most touched</option>
    </select>
  </div>`;
}

// ---------------------------------------------------------------------------
// File-column drag-resize handler
// ---------------------------------------------------------------------------

// Pointer-driven resize for the File column. We bypass a re-render during the
// drag — writing the CSS var directly on the .run-file-access root is cheap,
// avoids template work per pointermove, and keeps the visual response 1:1
// with the cursor. On pointerup we persist the final width to localStorage
// and update the module-level value so subsequent re-renders match.
function _startFileColResize(e) {
  // Only respond to the primary button / single-finger touch.
  if (e.button != null && e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();

  const handleEl = e.currentTarget;
  const rootEl = handleEl.closest('.run-file-access');
  const headerEl = handleEl.closest('.access-col-file-header');
  if (!rootEl || !headerEl) return;

  // The header's left edge is the anchor we measure from. We capture it
  // once at drag start instead of re-querying per move — the header sits
  // sticky at left:0 of the scroll container so its left edge does not
  // shift while the user is dragging.
  const leftEdge = headerEl.getBoundingClientRect().left;

  // Visual + UX dressing for the drag duration. The body-level class keeps
  // the col-resize cursor showing even when the pointer leaves the 7px
  // handle hit area, which is otherwise easy at faster drag speeds.
  handleEl.classList.add('access-col-file-resizer--active');
  document.body.classList.add('access-col-file-resizing');

  const apply = (clientX) => {
    const w = _clampFileColWidth(clientX - leftEdge);
    rootEl.style.setProperty('--fa-file-col-width', `${w}px`);
    return w;
  };

  const onMove = (ev) => {
    apply(ev.clientX);
  };

  const onUp = (ev) => {
    const finalW = apply(ev.clientX);
    _fileColWidth = finalW;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(FILE_COL_WIDTH_STORAGE_KEY, String(finalW));
      }
    } catch {
      // Best-effort persistence — a localStorage write failure (quota,
      // privacy mode) should not break the in-session resize.
    }
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    handleEl.classList.remove('access-col-file-resizer--active');
    document.body.classList.remove('access-col-file-resizing');
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}

// ---------------------------------------------------------------------------
// KPI strip
// ---------------------------------------------------------------------------

function _kpiStrip(summary) {
  const broadAmber = (summary.root_scoped || 0) > 0;
  const zeroAmber = (summary.zero_result || 0) > 0;
  const leakAmber = (summary.leakage_pct_max || 0) > 0;
  const oracleAmber = summary.oracle === 'degraded';
  const captureAmber = leakAmber || oracleAmber;

  return html`<div class="access-kpi-strip">
    ${_kpiCard('Files touched', summary.files_touched ?? 0, false, {
      tooltip:
        'Distinct files read or written by any agent across every stage of this run.',
    })}
    ${_kpiCard(
      'Read',
      html`${summary.distinct_read ?? 0} files · ${summary.total_read ?? 0} ops`,
      false,
      {
        kind: 'read',
        tooltip:
          'Files the agents read (Read tool), and the total number of read operations across all stages.',
      },
    )}
    ${_kpiCard(
      'Written',
      html`${summary.distinct_write ?? 0} files · ${summary.total_write ?? 0} ops`,
      false,
      {
        kind: 'write',
        tooltip:
          'Files the agents wrote (Write/Edit), and the total number of write operations across all stages.',
      },
    )}
    ${_kpiCard(
      'Searches',
      html`${summary.searches ?? 0} (${summary.zero_result ?? 0} zero-hit)`,
      zeroAmber,
      {
        tooltip:
          'Grep/Glob searches the agents ran. “zero-hit” searches returned no matches — often a sign of a wrong guess or missing context.',
      },
    )}
    ${_kpiCard('Broad scans', summary.root_scoped ?? 0, broadAmber, {
      tooltip:
        'Searches scoped to the repo root (“.”) instead of a specific subdirectory. Broad scans read far more of the tree and can indicate the agent was unsure where to look.',
    })}
    ${_kpiCard(
      'Capture',
      html`${(summary.leakage_pct_max ?? 0).toFixed(1)}% leak`,
      captureAmber,
      {
        tooltip:
          'Capture integrity — how reliably worca’s telemetry attributed this run’s file access. “leak” is the share of writes it could not tie to a tracked tool call (e.g. writes made outside Write/Edit, like a shell redirect), measured as the cumulative hook-recorded writes vs git’s uncommitted set. Lower is better. An amber border can also mean a “degraded” oracle (path canonicalization failed, counts approximate) — the Capture integrity strip below shows the oracle status explicitly.',
      },
    )}
    ${
      // Graph queries sits with Capture as the trailing "telemetry-quality"
      // pair, sharing the amber style. Only shown when a graph engine was used.
      (summary.graph_queries ?? 0) > 0
        ? _kpiCard(
            'Graph queries',
            html`${summary.graph_queries} (${summary.graphify ?? 0} graphify · ${summary.crg ?? 0} CRG)`,
            true,
            {
              tooltip:
                'Structural/semantic queries the agents ran against a code knowledge graph (graphify or the code-review-graph engine) — e.g. “what depends on X?”, call paths, impact of a change. Complements the lexical Grep/Glob searches above. Only shown when a graph engine was used.',
            },
          )
        : nothing
    }
  </div>`;
}

function _kpiCard(label, value, amber, { kind, tooltip } = {}) {
  const card = html`<div class="access-kpi-card${amber ? ' access-kpi-card--amber' : ''}${kind ? ` access-kpi-card--${kind}` : ''}">
    <span class="access-kpi-label">${label}</span>
    <span class="access-kpi-value">${value}</span>
  </div>`;
  return tooltip
    ? html`<sl-tooltip class="access-kpi-tooltip" content=${tooltip} hoist>${card}</sl-tooltip>`
    : card;
}

// ---------------------------------------------------------------------------
// Treetable
// ---------------------------------------------------------------------------

function _buildStageGroups(columns) {
  const groups = new Map();
  for (const col of columns) {
    if (!groups.has(col.stage)) groups.set(col.stage, []);
    groups.get(col.stage).push(col);
  }
  return groups;
}

function _computeMaxOps(tree) {
  let max = 1;
  function visit(node) {
    if (node.type === 'file' && node.cells) {
      for (const cell of Object.values(node.cells)) {
        const ops = (cell.read || 0) + (cell.write || 0);
        if (ops > max) max = ops;
      }
    }
    if (node.children) node.children.forEach(visit);
  }
  tree.forEach(visit);
  return max;
}

function _matchGlob(path, pattern) {
  if (!pattern) return true;
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  try {
    return new RegExp(regexStr).test(path);
  } catch {
    return path.includes(pattern);
  }
}

function _shouldShowFile(node) {
  if (node.category === 'read' && !_showReads) return false;
  if ((node.category === 'write' || node.category === 'leaked') && !_showWrites)
    return false;
  if (_pathFilter && !_matchGlob(node.path, _pathFilter)) return false;
  return true;
}

function _filterTree(nodes) {
  const result = [];
  for (const node of nodes) {
    if (node.type === 'file') {
      if (_shouldShowFile(node)) result.push(node);
    } else {
      const children = _filterTree(node.children || []);
      if (children.length > 0) result.push({ ...node, children });
    }
  }
  return result;
}

function _collectFiles(nodes) {
  const files = [];
  for (const node of nodes) {
    if (node.type === 'file') {
      if (_shouldShowFile(node)) files.push(node);
    } else if (node.children) {
      files.push(..._collectFiles(node.children));
    }
  }
  return files;
}

function _sortFiles(files) {
  const sorted = [...files];
  if (_sortMode === 'most-read') {
    sorted.sort((a, b) => (b.totals?.read || 0) - (a.totals?.read || 0));
  } else if (_sortMode === 'most-written') {
    sorted.sort((a, b) => (b.totals?.write || 0) - (a.totals?.write || 0));
  } else if (_sortMode === 'churn') {
    sorted.sort((a, b) => {
      const aOps = (a.totals?.read || 0) + (a.totals?.write || 0);
      const bOps = (b.totals?.read || 0) + (b.totals?.write || 0);
      return bOps - aOps;
    });
  }
  return sorted;
}

// A "visible column" is what the grid actually renders per data column, in
// order. An expanded stage contributes one {type:'col'} per iteration column
// (labelled "Iter N" by position within the stage, matching the stages UI). A
// collapsed stage contributes a single {type:'sigma'} aggregate column.
function _buildVisibleColumns(stageGroups) {
  const visible = [];
  for (const [stage, cols] of stageGroups) {
    if (_collapsedStages.get(stage)) {
      visible.push({ type: 'sigma', stage, cols });
    } else {
      cols.forEach((col, i) => {
        visible.push({ type: 'col', stage, col, iterLabel: `Iter ${i + 1}` });
      });
    }
  }
  return visible;
}

// Shared CSS grid track list — file column + one track per visible data column
// + the trailing Σ total column. Header rows and every body row use the same
// template (set as --fa-grid on the table) so all columns line up exactly.
function _gridTemplate(visible) {
  return `var(--fa-file-col-width, 220px) repeat(${visible.length}, var(--fa-cell-width, 80px)) var(--fa-cell-width, 80px)`;
}

function _treetable(tree, _columns, stageGroups, searches) {
  const maxOps = _heatmap ? _computeMaxOps(tree) : 0;
  const scopePaths = _buildScopePaths(searches);
  const visible = _buildVisibleColumns(stageGroups);

  let bodyContent;
  if (_sortMode === 'tree') {
    const filtered = _filterTree(tree);
    bodyContent = filtered.flatMap((node) =>
      _treeRows(node, visible, 0, maxOps, scopePaths),
    );
  } else {
    const files = _sortFiles(_collectFiles(tree));
    bodyContent = files.map((node) => _fileRow(node, visible, 0, maxOps));
  }

  return html`<div
    class="access-treetable${_heatmap ? ' access-treetable--heatmap' : ''}"
    role="treegrid"
    aria-label="File access map"
    style="--fa-grid:${_gridTemplate(visible)}"
  >
    ${_tableHeader(stageGroups, visible)}
    <div class="access-table-body">${bodyContent}</div>
  </div>`;
}

function _buildScopePaths(searches) {
  const paths = new Set();
  for (const s of searches || []) {
    if (s.scope && s.scope !== '.' && s.scope !== '') paths.add(s.scope);
  }
  return paths;
}

function _tableHeader(stageGroups, visible) {
  // Row 1 — stage labels, each spanning its visible columns. A collapsed stage
  // spans a single column (its Σ). Empty spacers hold the file and Σ tracks.
  const stageGroupCells = [
    html`<div class="access-stage-spacer access-col-file-header" role="presentation"></div>`,
  ];
  for (const [stage, cols] of stageGroups) {
    const collapsed = _collapsedStages.get(stage) || false;
    const span = collapsed ? 1 : cols.length;
    stageGroupCells.push(html`<button
      class="access-stage-group-header${collapsed ? ' access-stage-group-header--collapsed' : ''}"
      type="button"
      style="grid-column:span ${span}"
      title=${stage}
      aria-expanded=${!collapsed}
      aria-label="${collapsed ? 'Expand' : 'Collapse'} ${stage}"
      @click=${() => {
        _collapsedStages.set(stage, !collapsed);
        _rerender();
      }}
    >
      <span aria-hidden="true">${unsafeHTML(iconSvg(collapsed ? ChevronRight : ChevronDown, 12))}</span>
      <span class="access-stage-name">${stage}</span>
    </button>`);
  }
  stageGroupCells.push(
    html`<div class="access-stage-spacer access-sigma-header" role="presentation"></div>`,
  );

  // Row 2 — per-column headers ("Iter N" over agent), or Σ for collapsed stage.
  // The File header carries the drag handle (pinned to its right edge) that
  // resizes the column by rewriting --fa-file-col-width on the .run-file-access
  // root. The handle is a child of the sticky header so it scrolls correctly
  // (stays attached to the column edge) and so its hit area follows the column
  // when the user resizes during horizontal scroll.
  const colHeaderCells = [
    html`<div class="access-col-header access-col-file-header" role="columnheader">
      File
      <span
        class="access-col-file-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize file column"
        title="Drag to resize"
        @pointerdown=${_startFileColResize}
      ></span>
    </div>`,
  ];
  for (const v of visible) {
    if (v.type === 'sigma') {
      colHeaderCells.push(
        html`<div class="access-col-header access-col-header--collapsed" role="columnheader" data-stage=${v.stage}>
          <span class="access-col-iter">Σ</span>
          <span class="access-col-agent">${v.cols.length} iter${v.cols.length === 1 ? '' : 's'}</span>
        </div>`,
      );
    } else {
      colHeaderCells.push(
        html`<div
          class="access-col-header"
          role="columnheader"
          data-col-key=${v.col.key}
          title=${v.col.bead_id ? `bead ${v.col.bead_id}` : nothing}
        >
          <span class="access-col-iter">${v.iterLabel}</span>
          <span class="access-col-agent">${v.col.agent}</span>
        </div>`,
      );
    }
  }
  colHeaderCells.push(
    html`<div class="access-col-header access-sigma-header" role="columnheader">Σ</div>`,
  );

  return html`<div class="access-table-header">
    <div class="access-stage-groups">${stageGroupCells}</div>
    <div class="access-col-headers">${colHeaderCells}</div>
  </div>`;
}

// Flatten a tree node into an ordered array of row templates. Folding is done
// here in JS (a collapsed dir simply omits its descendants) rather than with a
// CSS display hack — the collapsed dir row keeps the server-side rollup totals.
function _treeRows(node, visible, depth, maxOps, scopePaths) {
  if (node.type === 'file') {
    return [_fileRow(node, visible, depth, maxOps)];
  }
  const collapsed = _collapsedDirs.has(node.path);
  const rows = [_dirRow(node, visible, depth, maxOps, scopePaths, collapsed)];
  if (!collapsed) {
    for (const child of node.children || []) {
      rows.push(..._treeRows(child, visible, depth + 1, maxOps, scopePaths));
    }
  }
  return rows;
}

function _dirRow(node, visible, depth, maxOps, scopePaths, collapsed) {
  const isScope = scopePaths?.has(node.path);

  return html`<div
    class="access-row access-row--dir${collapsed ? ' access-row--dir-collapsed' : ''}"
    role="row"
    data-path=${node.path}
    style="--depth:${depth}"
  >
    <div class="access-cell access-cell--file" role="rowheader">
      <button
        class="access-dir-toggle"
        type="button"
        aria-expanded=${!collapsed}
        aria-label="${collapsed ? 'Expand' : 'Collapse'} ${node.name}"
        @click=${() => {
          if (collapsed) _collapsedDirs.delete(node.path);
          else _collapsedDirs.add(node.path);
          _rerender();
        }}
      >
        <span aria-hidden="true">${unsafeHTML(iconSvg(collapsed ? ChevronRight : ChevronDown, 12))}</span>
      </button>
      <span aria-hidden="true">${unsafeHTML(iconSvg(FolderOpen, 14))}</span>
      <span class="access-file-name">${node.name}</span>
      ${isScope ? html`<span class="access-scope-dot" title="search scope" aria-label="search scope"></span>` : nothing}
    </div>
    ${_rowCells(node.cells, visible, maxOps)}
    ${_sigmaCell(node.totals)}
  </div>`;
}

function _fileRow(node, visible, depth, maxOps) {
  const categoryClass = `access-file-name--${node.category}`;
  const showTracked = node.tracked && (node.totals?.write || 0) > 0;

  return html`<div
    class="access-row access-row--file"
    role="row"
    data-path=${node.path}
    style="--depth:${depth}"
  >
    <div class="access-cell access-cell--file" role="rowheader">
      <button
        class="access-file-name-btn access-file-name ${categoryClass}"
        type="button"
        title="Show file access history"
        @click=${() => {
          _openDrawer =
            _openDrawer?.type === 'file' && _openDrawer.filePath === node.path
              ? null
              : { type: 'file', filePath: node.path };
          _rerender();
        }}
      >${node.name}</button>
      ${
        showTracked
          ? html`<span class="access-tracked-icon" title="git-tracked" aria-label="git-tracked">✎</span>`
          : nothing
      }
    </div>
    ${_rowCells(node.cells, visible, maxOps, node.path)}
    ${_sigmaCell(node.totals)}
  </div>`;
}

function _rowCells(cells, visible, maxOps, filePath) {
  return visible.map((v) => {
    // Collapsed stage → a single aggregated Σ cell over the stage's columns.
    if (v.type === 'sigma') {
      let r = 0;
      let w = 0;
      for (const col of v.cols) {
        const c = cells?.[col.key];
        if (c) {
          r += c.read || 0;
          w += c.write || 0;
        }
      }
      if (r === 0 && w === 0) {
        return html`<div class="access-cell access-cell--empty access-cell--stage-agg" role="gridcell" data-stage=${v.stage}>·</div>`;
      }
      return html`<div class="access-cell access-cell--stage-agg" role="gridcell" data-stage=${v.stage}>
        ${_opPills(r, w)}
      </div>`;
    }

    const col = v.col;
    const cell = cells?.[col.key];
    if (!cell || (!cell.read && !cell.write)) {
      return html`<div class="access-cell access-cell--empty" role="gridcell" data-col-key=${col.key}>·</div>`;
    }
    const ops = (cell.read || 0) + (cell.write || 0);
    const heatStyle =
      maxOps > 0 ? `--heat:${(ops / maxOps).toFixed(3)}` : nothing;
    const clickable = filePath != null;
    const _openCellDrawer = clickable
      ? () => {
          _openDrawer =
            _openDrawer?.type === 'cell' &&
            _openDrawer.filePath === filePath &&
            _openDrawer.colKey === col.key
              ? null
              : { type: 'cell', filePath, colKey: col.key, col, cell };
          _rerender();
        }
      : nothing;
    return html`<div
      class="access-cell${clickable ? ' access-cell--clickable' : ''}"
      role="gridcell"
      data-col-key=${col.key}
      style=${heatStyle}
      tabindex=${clickable ? '0' : nothing}
      aria-label=${clickable ? `${col.agent || col.stage} — ${col.key}` : nothing}
      @click=${_openCellDrawer}
      @keydown=${
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                _openCellDrawer();
              }
            }
          : nothing
      }
    >${_opPills(cell.read || 0, cell.write || 0)}</div>`;
  });
}

// A single op pill: just the bold count, coloured by op kind (green=read,
// blue=write). The letter is dropped — colour carries read-vs-write — but a
// title/aria-label keeps it accessible (not colour-only).
function _opPill(count, kind, label) {
  return html`<span
    class="access-badge access-badge--${kind}"
    title="${count} ${label}"
    aria-label="${count} ${label}"
  >${count}</span>`;
}

// Read and/or write pills for a cell or rollup. Shared by data cells, the Σ
// total column, and collapsed-stage Σ cells so every indicator looks the same.
function _opPills(r, w) {
  if (r <= 0 && w <= 0) return nothing;
  return html`${r > 0 ? _opPill(r, 'read', 'reads') : nothing}${w > 0 ? _opPill(w, 'write', 'writes') : nothing}`;
}

function _sigmaCell(totals) {
  const r = totals?.read ?? 0;
  const w = totals?.write ?? 0;
  return html`<div class="access-cell access-cell--sigma" role="gridcell">
    ${r === 0 && w === 0 ? html`<span class="access-cell--empty">·</span>` : _opPills(r, w)}
  </div>`;
}

// ---------------------------------------------------------------------------
// Searches lane
// ---------------------------------------------------------------------------

function _searchesLane(searches) {
  return html`<div class="access-searches">
    <div class="access-searches-header">
      <h3 class="access-searches-title">Searches</h3>
      <button
        class="access-searches-group-toggle${_groupSearchesByStage ? ' access-searches-group-toggle--active' : ''}"
        type="button"
        title="Group searches by stage"
        @click=${() => {
          _groupSearchesByStage = !_groupSearchesByStage;
          _rerender();
        }}
      >Group by stage</button>
    </div>
    ${
      searches.length === 0
        ? html`<p class="access-searches-empty">No searches recorded.</p>`
        : _groupSearchesByStage
          ? _searchesGrouped(searches)
          : _searchesTable(searches)
    }
  </div>`;
}

function _searchesTable(searches) {
  return html`<table class="access-searches-table">
    <thead>
      <tr>
        <th>Stage</th>
        <th>Tool</th>
        <th>Pattern</th>
        <th>Scope</th>
        <th>Hits</th>
        <th>Flags</th>
      </tr>
    </thead>
    <tbody>
      ${searches.map(_searchRow)}
    </tbody>
  </table>`;
}

function _searchesGrouped(searches) {
  // Group by stage, preserving encounter order
  const groups = new Map();
  for (const s of searches) {
    if (!groups.has(s.stage)) groups.set(s.stage, []);
    groups.get(s.stage).push(s);
  }
  return html`<div class="access-searches-groups">
    ${[...groups.entries()].map(
      ([stage, rows]) => html`<div class="access-searches-stage-group">
        <div class="access-searches-stage-header">${stage}</div>
        <table class="access-searches-table">
          <thead>
            <tr>
              <th>Stage</th>
              <th>Tool</th>
              <th>Pattern</th>
              <th>Scope</th>
              <th>Hits</th>
              <th>Flags</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(_searchRow)}
          </tbody>
        </table>
      </div>`,
    )}
  </div>`;
}

function _searchRow(s) {
  return html`<tr class="access-search-row" data-col-key=${s.colKey}>
    <td>${s.stage}:${s.iteration}</td>
    <td>${s.tool}</td>
    <td class="access-search-pattern">${s.pattern}</td>
    <td>${s.scope || '—'}</td>
    <td>${s.result_count}</td>
    <td>
      ${
        s.broad
          ? html`<span class="access-badge access-badge--broad">broad</span>`
          : nothing
      }
      ${
        s.zero_hit
          ? html`<span class="access-badge access-badge--zero-hit">0 hits</span>`
          : nothing
      }
    </td>
  </tr>`;
}

// ---------------------------------------------------------------------------
// Graph-queries lane (graphify / CRG) — structural/semantic lookups
// ---------------------------------------------------------------------------

function _graphQueriesLane(graphQueries) {
  if (!graphQueries || graphQueries.length === 0) return nothing;
  return html`<div class="access-searches access-graph-lane">
    <div class="access-searches-header">
      <h3 class="access-searches-title">Graph queries</h3>
      <button
        class="access-searches-group-toggle${_groupGraphByStage ? ' access-searches-group-toggle--active' : ''}"
        type="button"
        title="Group graph queries by stage"
        @click=${() => {
          _groupGraphByStage = !_groupGraphByStage;
          _rerender();
        }}
      >Group by stage</button>
    </div>
    ${_groupGraphByStage ? _graphGrouped(graphQueries) : _graphTable(graphQueries)}
  </div>`;
}

function _graphTable(rows) {
  return html`<table class="access-searches-table access-graph-table">
    <thead>
      <tr>
        <th>Stage</th>
        <th>Engine</th>
        <th>Op</th>
        <th>Query</th>
      </tr>
    </thead>
    <tbody>
      ${rows.map(_graphRow)}
    </tbody>
  </table>`;
}

function _graphGrouped(rows) {
  const groups = new Map();
  for (const g of rows) {
    if (!groups.has(g.stage)) groups.set(g.stage, []);
    groups.get(g.stage).push(g);
  }
  return html`<div class="access-searches-groups">
    ${[...groups.entries()].map(
      ([stage, stageRows]) => html`<div class="access-searches-stage-group">
        <div class="access-searches-stage-header">${stage}</div>
        ${_graphTable(stageRows)}
      </div>`,
    )}
  </div>`;
}

function _graphRow(g) {
  return html`<tr class="access-search-row" data-col-key=${g.colKey}>
    <td>${g.stage}:${g.iteration}</td>
    <td><span class="access-engine-badge access-engine-badge--${g.engine}">${g.engine === 'crg' ? 'CRG' : g.engine}</span></td>
    <td>${g.op}</td>
    <td class="access-search-pattern">${g.query}</td>
  </tr>`;
}

// ---------------------------------------------------------------------------
// Drawers — file-history drawer and cell-scoped drawer
// ---------------------------------------------------------------------------

function _drawerOverlay(model, columns, onOpenTimeline) {
  if (!_openDrawer) return nothing;

  if (_openDrawer.type === 'file') {
    return _fileDrawer(_openDrawer.filePath, model, columns, onOpenTimeline);
  }
  if (_openDrawer.type === 'cell') {
    return _cellDrawer(_openDrawer, model, columns, onOpenTimeline);
  }
  return nothing;
}

function _findFileNode(tree, filePath) {
  for (const node of tree) {
    if (node.type === 'file' && node.path === filePath) return node;
    if (node.children) {
      const found = _findFileNode(node.children, filePath);
      if (found) return found;
    }
  }
  return null;
}

function _timelineLink(colKey, onOpenTimeline) {
  if (!onOpenTimeline) return nothing;
  return html`<button
    class="access-timeline-link"
    type="button"
    title="Open this iteration in Timeline"
    @click=${() => onOpenTimeline({ colKey })}
  >Open in Timeline ↗</button>`;
}

function _fileDrawer(filePath, model, columns, onOpenTimeline) {
  const fileNode = _findFileNode(model.tree || [], filePath);
  const cells = fileNode?.cells || {};

  // Build chronological history: one entry per column that has a non-empty cell
  const history = columns
    .filter((col) => {
      const c = cells[col.key];
      return c && (c.read || c.write);
    })
    .map((col) => ({ col, cell: cells[col.key] }));

  const _closeDrawer = () => {
    _openDrawer = null;
    _rerender();
  };
  return html`<div class="access-file-drawer" open
    @keydown=${(e) => {
      if (e.key === 'Escape') _closeDrawer();
    }}
  >
    <div class="access-drawer-header">
      <span class="access-drawer-title">${filePath}</span>
      <button
        class="access-drawer-close"
        type="button"
        aria-label="Close"
        autofocus
        @click=${_closeDrawer}
      >✕</button>
    </div>
    <div class="access-drawer-body">
      <p class="access-drawer-section-label">File access history</p>
      ${
        history.length === 0
          ? html`<p class="access-drawer-empty">No access recorded.</p>`
          : html`<ul class="access-file-history-list">
            ${history.map(
              ({ col, cell }) => html`<li class="access-file-history-item">
              <span class="access-history-stage">${col.stage}</span>
              <span class="access-history-iter">iter ${col.iteration}</span>
              ${col.bead_id ? html`<span class="access-history-bead">${col.bead_id}</span>` : nothing}
              <span class="access-history-agent">${col.agent}</span>
              ${cell.read ? html`<span class="access-history-read">${cell.read}R</span>` : nothing}
              ${cell.write ? html`<span class="access-history-write">${cell.write}W</span>` : nothing}
              ${_timelineLink(col.key, onOpenTimeline)}
            </li>`,
            )}
          </ul>`
      }
    </div>
  </div>`;
}

function _cellDrawer(drawerState, _model, _columns, onOpenTimeline) {
  const { filePath, col, cell } = drawerState;
  const r = cell?.read || 0;
  const w = cell?.write || 0;

  const _closeDrawer = () => {
    _openDrawer = null;
    _rerender();
  };
  return html`<div class="access-cell-drawer" open
    @keydown=${(e) => {
      if (e.key === 'Escape') _closeDrawer();
    }}
  >
    <div class="access-drawer-header">
      <span class="access-drawer-title">${filePath} — ${col.stage}</span>
      <button
        class="access-drawer-close"
        type="button"
        aria-label="Close"
        autofocus
        @click=${_closeDrawer}
      >✕</button>
    </div>
    <div class="access-drawer-body">
      <dl class="access-cell-detail">
        <dt>File</dt><dd>${filePath}</dd>
        <dt>Stage</dt><dd>${col.stage}</dd>
        <dt>Iteration</dt><dd>${col.iteration}</dd>
        ${col.bead_id ? html`<dt>Bead</dt><dd>${col.bead_id}</dd>` : nothing}
        <dt>Agent</dt><dd>${col.agent}</dd>
        ${r > 0 ? html`<dt>Reads</dt><dd>${r}</dd>` : nothing}
        ${w > 0 ? html`<dt>Writes</dt><dd>${w}</dd>` : nothing}
      </dl>
      ${_timelineLink(col.key, onOpenTimeline)}
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Capture-integrity strip
// ---------------------------------------------------------------------------

function _captureStrip(summary) {
  const degraded = summary.oracle === 'degraded';
  const leakage = summary.leakage_pct_max ?? 0;

  return html`<div class="access-capture-strip${degraded ? ' access-capture-strip--degraded' : ''}">
    <span class="access-capture-label">Capture integrity</span>
    <span class="access-capture-leakage">Leakage: ${leakage.toFixed(1)}%</span>
    ${
      degraded
        ? html`<span class="access-capture-oracle">
          ${unsafeHTML(iconSvg(AlertTriangle, 14))}
          Path canonicalization degraded — counts approximate
        </span>`
        : html`<span class="access-capture-oracle">Oracle: ok</span>`
    }
  </div>`;
}
