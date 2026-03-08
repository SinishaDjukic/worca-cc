const CLASS_MAP = {
  pending: 'status-pending',
  in_progress: 'status-in-progress',
  completed: 'status-completed',
  error: 'status-error'
};

const ICON_MAP = {
  pending: '\u25CB',
  in_progress: '\u25CF',
  completed: '\u2713',
  error: '\u2717'
};

export function statusClass(status) {
  return CLASS_MAP[status] || 'status-unknown';
}

export function statusIcon(status) {
  return ICON_MAP[status] || '?';
}
