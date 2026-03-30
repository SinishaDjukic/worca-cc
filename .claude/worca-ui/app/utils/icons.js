/**
 * Lucide icon SVG renderer for lit-html templates.
 * Converts lucide icon node data into SVG HTML strings.
 * Use with unsafeHTML directive from lit-html.
 */

import Activity from 'lucide/dist/esm/icons/activity';
import Archive from 'lucide/dist/esm/icons/archive';
import ArrowDown from 'lucide/dist/esm/icons/arrow-down';
import ArrowLeft from 'lucide/dist/esm/icons/arrow-left';
import ArrowRight from 'lucide/dist/esm/icons/arrow-right';
import Bell from 'lucide/dist/esm/icons/bell';
import ChevronRight from 'lucide/dist/esm/icons/chevron-right';
import Circle from 'lucide/dist/esm/icons/circle';
import CircleAlert from 'lucide/dist/esm/icons/circle-alert';
import CircleCheck from 'lucide/dist/esm/icons/circle-check';
import CircleSlash from 'lucide/dist/esm/icons/circle-slash';
import ClipboardCopy from 'lucide/dist/esm/icons/clipboard-copy';
import Clock from 'lucide/dist/esm/icons/clock';
import Coins from 'lucide/dist/esm/icons/coins';
import Cpu from 'lucide/dist/esm/icons/cpu';
import Database from 'lucide/dist/esm/icons/database';
import FileText from 'lucide/dist/esm/icons/file-text';
import Flag from 'lucide/dist/esm/icons/flag';
import FolderOpen from 'lucide/dist/esm/icons/folder-open';
import GitBranch from 'lucide/dist/esm/icons/git-branch';
import Hash from 'lucide/dist/esm/icons/hash';
import Lightbulb from 'lucide/dist/esm/icons/lightbulb';
import List from 'lucide/dist/esm/icons/list';
import Loader from 'lucide/dist/esm/icons/loader';
import Lock from 'lucide/dist/esm/icons/lock';
import Moon from 'lucide/dist/esm/icons/moon';
import Pause from 'lucide/dist/esm/icons/pause';
import Play from 'lucide/dist/esm/icons/play';
import Plus from 'lucide/dist/esm/icons/plus';
import RefreshCw from 'lucide/dist/esm/icons/refresh-cw';
import RotateCcw from 'lucide/dist/esm/icons/rotate-ccw';
import RotateCw from 'lucide/dist/esm/icons/rotate-cw';
import Save from 'lucide/dist/esm/icons/save';
import Search from 'lucide/dist/esm/icons/search';
import Settings from 'lucide/dist/esm/icons/settings';
import SlidersHorizontal from 'lucide/dist/esm/icons/sliders-horizontal';
import Shield from 'lucide/dist/esm/icons/shield';
import Square from 'lucide/dist/esm/icons/square';
import Star from 'lucide/dist/esm/icons/star';
import Sun from 'lucide/dist/esm/icons/sun';
import Timer from 'lucide/dist/esm/icons/timer';
import Trash2 from 'lucide/dist/esm/icons/trash-2';
import AlertTriangle from 'lucide/dist/esm/icons/triangle-alert';
import Users from 'lucide/dist/esm/icons/users';
import X from 'lucide/dist/esm/icons/x';
import Zap from 'lucide/dist/esm/icons/zap';

function renderChildren(nodes) {
  return nodes
    .map(([tag, attrs]) => {
      const attrStr = Object.entries(attrs)
        .map(([k, v]) => `${k}="${v}"`)
        .join(' ');
      return `<${tag} ${attrStr}/>`;
    })
    .join('');
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
  Circle,
  CircleCheck,
  CircleAlert,
  Loader,
  Sun,
  Moon,
  Flag,
  RefreshCw,
  ArrowDown,
  Pause,
  Zap,
  Clock,
  AlertTriangle,
  Activity,
  Archive,
  Search,
  ArrowLeft,
  Square,
  Play,
  Users,
  Shield,
  GitBranch,
  ChevronRight,
  Save,
  Settings,
  SlidersHorizontal,
  Timer,
  Cpu,
  Star,
  FileText,
  ClipboardCopy,
  Coins,
  Bell,
  Plus,
  RotateCcw,
  List,
  Lock,
  ArrowRight,
  Database,
  X,
  Lightbulb,
  Trash2,
  RotateCw,
  CircleSlash,
  Hash,
  FolderOpen,
};
