// Agent-readiness chip — a small status pill (dot + label) for a project's
// readiness summary. Returns null when there is nothing to show.
export function renderReadinessChip(
  summary,
  { doc = globalThis.document } = {},
) {
  if (!summary || summary.level === 'unknown') return null;

  const span = doc.createElement('span');
  span.className = `pl-rd rd-${summary.level}`;

  const dot = doc.createElement('span');
  dot.className = 'rd-dot';
  span.appendChild(dot);

  const label = doc.createElement('span');
  label.textContent =
    summary.level === 'partial'
      ? `Partly ready · ${summary.failingCount}`
      : summary.level === 'not-ready'
        ? 'Not agent-ready'
        : 'Agent-ready';
  span.appendChild(label);

  span.title = `For ${summary.primaryEngine}`;
  return span;
}

// The one-time "missing agent instructions" toast for a freshly added project (a `readiness-added` frame).
// `storage` keeps the once-per-project guard; returns notify() options, or null when there is nothing to
// say or it was said already. A storage that throws only costs the guard.
export function readinessAddedToast(msg, { storage = globalThis.localStorage, run } = {}) {
  const key = msg && msg.projectKey;
  if (!key) return null;
  const seenKey = `readiness-toast-seen:${key}`;
  try {
    if (storage && storage.getItem(seenKey)) return null;
    if (storage) storage.setItem(seenKey, '1');
  } catch { /* no guard without storage */ }
  return {
    tone: 'warn',
    title: `${msg.name || key} is missing agent instructions for ${msg.engine}`,
    action: { label: 'See what to add', run },
    key: `readiness-${key}`,
  };
}
