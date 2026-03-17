/**
 * Lucide icon SVG renderer for lit-html templates.
 * Converts lucide icon node data into SVG HTML strings.
 * Use with unsafeHTML directive from lit-html.
 */

import Circle from 'lucide/dist/esm/icons/circle';
import CircleCheck from 'lucide/dist/esm/icons/circle-check';
import CircleAlert from 'lucide/dist/esm/icons/circle-alert';
import Loader from 'lucide/dist/esm/icons/loader';
import Sun from 'lucide/dist/esm/icons/sun';
import Moon from 'lucide/dist/esm/icons/moon';
import Flag from 'lucide/dist/esm/icons/flag';
import RefreshCw from 'lucide/dist/esm/icons/refresh-cw';
import ArrowDown from 'lucide/dist/esm/icons/arrow-down';
import Pause from 'lucide/dist/esm/icons/pause';
import Zap from 'lucide/dist/esm/icons/zap';
import Clock from 'lucide/dist/esm/icons/clock';
import AlertTriangle from 'lucide/dist/esm/icons/triangle-alert';
import Activity from 'lucide/dist/esm/icons/activity';
import Archive from 'lucide/dist/esm/icons/archive';
import Search from 'lucide/dist/esm/icons/search';
import ArrowLeft from 'lucide/dist/esm/icons/arrow-left';
import Square from 'lucide/dist/esm/icons/square';
import Play from 'lucide/dist/esm/icons/play';
import Users from 'lucide/dist/esm/icons/users';
import Shield from 'lucide/dist/esm/icons/shield';
import GitBranch from 'lucide/dist/esm/icons/git-branch';
import ChevronRight from 'lucide/dist/esm/icons/chevron-right';
import Save from 'lucide/dist/esm/icons/save';
import Settings from 'lucide/dist/esm/icons/settings';
import Timer from 'lucide/dist/esm/icons/timer';
import Cpu from 'lucide/dist/esm/icons/cpu';
import Star from 'lucide/dist/esm/icons/star';
import FileText from 'lucide/dist/esm/icons/file-text';
import ClipboardCopy from 'lucide/dist/esm/icons/clipboard-copy';
import Coins from 'lucide/dist/esm/icons/coins';
import Bell from 'lucide/dist/esm/icons/bell';
import Plus from 'lucide/dist/esm/icons/plus';
import RotateCcw from 'lucide/dist/esm/icons/rotate-ccw';
import List from 'lucide/dist/esm/icons/list';
import Lock from 'lucide/dist/esm/icons/lock';
import ArrowRight from 'lucide/dist/esm/icons/arrow-right';
import Database from 'lucide/dist/esm/icons/database';
import X from 'lucide/dist/esm/icons/x';

function renderChildren(nodes) {
  return nodes.map(([tag, attrs]) => {
    const attrStr = Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ');
    return `<${tag} ${attrStr}/>`;
  }).join('');
}

/**
 * Convert a lucide icon node array to an SVG string.
 * @param {Array} iconData - Lucide icon node array
 * @param {number} [size=16] - Width/height in px
 * @param {string} [className=''] - Optional CSS class
 * @returns {string} SVG HTML string
 */
export function iconSvg(iconData, size = 16, className = '') {
  const cls = className ? ` class="${className}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${cls}>${renderChildren(iconData)}</svg>`;
}

// Pre-exported icon data for convenience
export {
  Circle, CircleCheck, CircleAlert, Loader,
  Sun, Moon, Flag, RefreshCw, ArrowDown, Pause,
  Zap, Clock, AlertTriangle,
  Activity, Archive, Search, ArrowLeft,
  Square, Play, Users, Shield, GitBranch, ChevronRight, Save, Settings, Timer, Cpu, Star, FileText, ClipboardCopy, Coins, Bell, Plus, RotateCcw,
  List, Lock, ArrowRight, Database,
  X
};
