import { iconSvg, Circle, Loader, CircleCheck, CircleAlert } from './icons.js';

const CLASS_MAP = {
  pending: 'status-pending',
  in_progress: 'status-in-progress',
  completed: 'status-completed',
  error: 'status-error'
};

const ICON_DATA = {
  pending: Circle,
  in_progress: Loader,
  completed: CircleCheck,
  error: CircleAlert
};

export function statusClass(status) {
  return CLASS_MAP[status] || 'status-unknown';
}

export function statusIcon(status, size = 14) {
  const data = ICON_DATA[status];
  if (!data) return '?';
  const className = status === 'in_progress' ? 'icon-spin' : '';
  return iconSvg(data, size, className);
}
