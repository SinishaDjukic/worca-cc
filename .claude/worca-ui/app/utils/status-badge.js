import { iconSvg, Circle, Loader, CircleCheck, CircleAlert, Pause, RotateCw, CircleSlash } from './icons.js';

const CLASS_MAP = {
  pending: 'status-pending',
  running: 'status-running',
  paused: 'status-paused',
  completed: 'status-completed',
  failed: 'status-failed',
  resuming: 'status-resuming',
  skipped: 'status-skipped',
  // legacy aliases
  in_progress: 'status-in-progress',
  error: 'status-error',
  interrupted: 'status-interrupted'
};

const ICON_DATA = {
  pending: Circle,
  running: Loader,
  paused: Pause,
  completed: CircleCheck,
  failed: CircleAlert,
  resuming: RotateCw,
  skipped: CircleSlash,
  // legacy aliases
  in_progress: Loader,
  error: CircleAlert,
  interrupted: Pause
};

/**
 * Resolve display status: if run is not active, in_progress becomes interrupted.
 */
export function resolveStatus(status, isActive) {
  if (status === 'in_progress' && isActive === false) return 'interrupted';
  return status;
}

export function statusClass(status) {
  return CLASS_MAP[status] || 'status-unknown';
}

export function statusIcon(status, size = 14) {
  const data = ICON_DATA[status];
  if (!data) return '?';
  const className = (status === 'in_progress' || status === 'running' || status === 'resuming') ? 'icon-spin' : '';
  return iconSvg(data, size, className);
}
