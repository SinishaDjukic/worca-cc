// ui/public/results-view.mjs
// Pure shaping helpers for the run Results view. ESM so both the browser (app.js)
// and node:test can import them. DOM only via the explicit doc param — keep it
// unit-testable.

/** Human-readable summary chips from a Layer-1 results object. */
export function summaryChips(results) {
  const s = (results && results.summary) || {};
  const chips = [];
  if (s.filesNew) chips.push(`${s.filesNew} new`);
  if (s.filesChanged) chips.push(`${s.filesChanged} changed`);
  if (s.filesDeleted) chips.push(`${s.filesDeleted} deleted`);
  chips.push(`+${s.linesAdded || 0} / −${s.linesRemoved || 0}`);
  chips.push(s.blockingIssues ? `${s.blockingIssues} to check` : 'Clean');
  return chips;
}

/**
 * Merge Layer-1 review checks with Layer-2 agent diffFindings. Review checks come
 * first and are never dropped; agent findings are tagged origin:'agent' (+ isNew).
 */
export function mergeFindings(checks, diffFindings) {
  const reviewSide = (checks || []).map((c) => ({ ...c, origin: c.origin || 'review' }));
  const agentSide = (diffFindings || []).map((f) => ({
    severity: f.severity, title: f.title, detail: f.detail,
    location: f.file ? `${f.file}${f.line != null ? ':' + f.line : ''}` : '',
    origin: 'agent', isNew: f.newVsReview === true,
  }));
  return [...reviewSide, ...agentSide];
}

/** The single status chip kept in the results header: "Clean" or "N to check". */
export function statusChip(results) {
  const s = (results && results.summary) || {};
  return s.blockingIssues ? `${s.blockingIssues} to check` : 'Clean';
}

/**
 * Always-on header badges for the Diff dropdown: "N changed" + "N removed".
 * Rendered even when zero (product spec). `changed` = modified files
 * (summary.filesChanged); `removed` = deleted files (summary.filesDeleted).
 * NOTE: filesChanged already includes deleted rows (bucketFiles routes 'D' into
 * changedFiles); we intentionally preserve today's counting. `n` lets the caller
 * grey a zero badge.
 */
export function diffBadges(results) {
  const s = (results && results.summary) || {};
  const changed = s.filesChanged || 0;
  const removed = s.filesDeleted || 0;
  return [
    { kind: 'changed', n: changed, text: `${changed} changed` },
    { kind: 'removed', n: removed, text: `${removed} removed` },
  ];
}

// ── Plugin provenance (spec §7.5, §9.3, §11) ───────────────────────────────────

function _el(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/** Badge for a plugin-sourced pipeline row; null for prompt/markdown or a
 *  corrupt source_ref (old rows render statically, never throw — §11). */
export function sourceBadge(row, { doc = globalThis.document } = {}) {
  if ((row?.source_type || 'prompt') !== 'plugin' || !row.source_ref) return null;
  let ref;
  try { ref = JSON.parse(row.source_ref); } catch { return null; }
  if (!ref || !ref.plugin) return null;
  const badge = _el(doc, 'span', 'src-badge');
  badge.appendChild(_el(doc, 'span', 'src-badge-plugin', ref.plugin));
  if (ref.url) {
    const a = _el(doc, 'a', 'src-badge-task', ref.taskId || ref.title || ref.url);
    a.href = ref.url;
    a.target = '_blank';
    a.rel = 'noreferrer';
    badge.appendChild(a);
  } else {
    badge.appendChild(_el(doc, 'span', 'src-badge-task', ref.taskId || ref.title || ''));
  }
  return badge;
}

/** "Report result" retry (§7.5): posts to the report-result endpoint, shows the
 *  outcome. `post(url)` is injected (app.js wraps fetch); the in-flight promise
 *  is kept on el._pending for deterministic tests. */
export function reportResultControl(pipelineId, { doc = globalThis.document, post } = {}) {
  const wrap = _el(doc, 'span', 'src-report-wrap');
  const btn = _el(doc, 'button', 'btn btn-ghost btn-mini src-report', 'Report result');
  btn.type = 'button';
  const status = _el(doc, 'span', 'src-report-status hint', '');
  btn.addEventListener('click', () => {
    btn.disabled = true;
    status.textContent = 'reporting…';
    wrap._pending = (async () => {
      try {
        const out = await post(`/api/pipelines/${encodeURIComponent(pipelineId)}/report-result`);
        status.textContent = out && out.ok ? (out.skipped ? 'nothing to report' : 'reported ✓') : `failed: ${out?.error || 'unknown'}`;
      } catch (e) {
        status.textContent = `failed: ${e.message}`;
      } finally {
        btn.disabled = false;
      }
    })();
  });
  wrap.append(btn, status);
  return wrap;
}

/** Workflow-picker label (§9.3 badge, §6.5 disabled flag). enabledPluginNames =
 *  names of ENABLED installed plugins (from GET /api/plugins client-side); null
 *  = plugin list not known yet — show the plugin badge but skip the disabled flag. */
export function workflowPickerLabel(wf, enabledPluginNames = []) {
  const origin = String(wf?.origin || '');
  if (!origin.startsWith('plugin:')) return wf?.name || '';
  const plugin = origin.slice('plugin:'.length);
  const disabled = Array.isArray(enabledPluginNames) && !enabledPluginNames.includes(plugin);
  return `${wf.name} [plugin: ${plugin}${disabled ? ' — disabled' : ''}]`;
}
