// src/core/chat/renderers.mjs
// 1.0 orchestrator events -> NormalizedMessage (chat-connectivity-design.md
// §4.5). Style/helpers ported from the pre-1.0 integrations/renderers.js
// (markdown segments so each platform worker converts to its native format);
// the event vocabulary is 1.0's: done {status: done|stopped|paused, reason},
// error {message}, question {id, kind, questions, issues, recovery, agent}.
//
// The question renderer is the load-bearing one: it enumerates options with
// ordinals and embeds the exact reply commands (/approve, /retry, /answer n…)
// using the run-id wildcard-suffix convention the command router resolves.

const md = (value) => ({ kind: 'markdown', value });

export function fmtMs(ms) {
  if (ms == null || !Number.isFinite(ms)) return null;
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m${String(s).padStart(2, '0')}s` : `${s}s`;
}

export function fmtUsd(usd) {
  if (usd == null || !Number.isFinite(Number(usd))) return null;
  return `$${Number(usd).toFixed(2)}`;
}

function mdMsg(text, severity) {
  return { title: null, body: [md(text)], severity };
}

/** Short wildcard reference the command router resolves: last 4 id chars. */
export function runRef(runId) {
  const id = String(runId || '');
  return id.length > 4 ? `*${id.slice(-4)}` : id || 'run';
}

function head(icon, meta) {
  const parts = [`${icon} **Run:** \`${runRef(meta.runId)}\``];
  const title = String(meta.title || '').trim();
  if (title) parts.push(`   **Title:** ${title.length > 60 ? `${title.slice(0, 60)}…` : title}`);
  return parts;
}

const PAUSE_REASONS = {
  cost_pipeline: 'pipeline cost limit reached',
  cost_total: 'total cost limit reached',
};

/**
 * done event: status done|stopped|paused (+reason for limit pauses).
 * meta may carry {title, totalCostUsd, totalActiveMs} for the summary line.
 */
export function renderDone(meta, payload = {}) {
  const status = payload.status || 'done';
  if (status === 'paused') {
    const reason = payload.reason ? (PAUSE_REASONS[payload.reason] || payload.reason) : null;
    const parts = head('⏸', meta);
    parts.push(`   **Status:** paused${reason ? ` — ${reason}` : ''}`);
    parts.push(`   Resume from the worca-cc UI, or reply: /resume ${runRef(meta.runId)}`);
    return mdMsg(parts.join('\n'), 'warning');
  }
  if (status === 'stopped') {
    const parts = head('⏹', meta);
    parts.push('   **Status:** stopped');
    return mdMsg(parts.join('\n'), 'warning');
  }
  const parts = head('✅', meta);
  parts.push('   **Status:** completed');
  const dur = fmtMs(meta.totalActiveMs);
  if (dur) parts.push(`   **Duration:** ${dur}`);
  const cost = fmtUsd(meta.totalCostUsd);
  if (cost) parts.push(`   **Cost:** ${cost}`);
  return mdMsg(parts.join('\n'), 'success');
}

/** error event: {message}. A separate done{status:'error'} follows; the
 *  notifier sends only this one (richer) for the failure. */
export function renderError(meta, payload = {}) {
  const parts = head('\u{1F534}', meta);
  parts.push('   **Status:** failed');
  const msg = String(payload.message || 'unknown error');
  parts.push(`   **Error:** ${msg.length > 300 ? `${msg.slice(0, 300)}…` : msg}`);
  return mdMsg(parts.join('\n'), 'error');
}

/**
 * question event: {id, kind: clarify|questions|gate|recovery, questions,
 * issues, recovery, agent}. The reply instructions match the command router:
 *   gate/recovery -> /approve <ref> | /retry <ref>
 *   clarify/questions -> /answer <ref> <n|text> [| …] (one answer per question:
 *     an option number, or free text for questions without options)
 */
export function renderQuestion(meta, payload = {}) {
  const ref = runRef(meta.runId);
  const kind = payload.kind || 'questions';
  const parts = head('❓', meta);

  if (kind === 'gate' || kind === 'recovery') {
    parts.push(`   **Status:** waiting for ${kind === 'gate' ? 'approval' : 'a recovery decision'}${payload.agent ? ` (${payload.agent})` : ''}`);
    const issues = Array.isArray(payload.issues) ? payload.issues : [];
    for (const i of issues.slice(0, 5)) {
      const sev = i?.severity ? `[${i.severity}] ` : '';
      const text = String(i?.summary || i?.message || i?.title || '').trim();
      if (text) parts.push(`   • ${sev}${text.length > 120 ? `${text.slice(0, 120)}…` : text}`);
    }
    if (issues.length > 5) parts.push(`   • …and ${issues.length - 5} more`);
    if (kind === 'recovery' && payload.recovery?.message) {
      parts.push(`   **Cause:** ${String(payload.recovery.message).slice(0, 200)}`);
    }
    parts.push(kind === 'gate'
      ? `   Reply: /approve ${ref} to continue · /retry ${ref} for another cycle`
      : `   Reply: /approve ${ref} to retry · /abort ${ref} to abort`);
    return mdMsg(parts.join('\n'), 'warning');
  }

  parts.push(`   **Status:** has questions${payload.agent ? ` from ${payload.agent}` : ''}`);
  const questions = Array.isArray(payload.questions) ? payload.questions : [];
  questions.forEach((q, qi) => {
    parts.push(`   **Q${qi + 1}.** ${String(q?.question || q?.id || '').trim()}`);
    (Array.isArray(q?.options) ? q.options : []).forEach((opt, oi) => {
      parts.push(`      ${oi + 1}. ${String(opt).trim()}`);
    });
  });
  const example = questions.map((q) => ((Array.isArray(q.options) && q.options.length) ? '1' : '<your answer>')).join(' | ') || '1';
  parts.push(`   Reply: /answer ${ref} ${example}${questions.length > 1 ? '  (one answer per question, in order, separated by |)' : ''}`);
  return mdMsg(parts.join('\n'), 'warning');
}

/** Canned message for the "Test" button / `worca plugin channel` smoke. */
export function renderTest() {
  return {
    title: 'worca-cc test message',
    body: [md('✅ Chat channel connectivity works. Notifications will appear here.')],
    severity: 'info',
  };
}
