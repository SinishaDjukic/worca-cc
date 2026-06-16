// app/utils/format.js — display formatters for benchmark stats.

/**
 * Format a USD cost. Sub-cent values get 4 decimals so tiny runs stay legible;
 * everything else gets 2. Null/zero returns null so callers can hide the row.
 *
 * @param {number|null|undefined} usd
 * @returns {string|null}
 */
export function formatCost(usd) {
  if (usd === null || usd === undefined || Number.isNaN(usd)) return null;
  if (usd === 0) return '$0.00';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

/**
 * Format a wall-clock duration given in seconds as "1h 2m 3s" / "2m 3s" / "3s".
 *
 * @param {number|null|undefined} seconds
 * @returns {string}
 */
export function formatDuration(seconds) {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) {
    return 'N/A';
  }
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/**
 * Format a 0..1 fraction as a whole-number percentage, e.g. 0.6667 -> "67%".
 *
 * @param {number|null|undefined} fraction
 * @returns {string}
 */
export function pct(fraction) {
  if (fraction === null || fraction === undefined || Number.isNaN(fraction)) {
    return 'N/A';
  }
  return `${Math.round(fraction * 100)}%`;
}

/**
 * Format an ISO timestamp as "YYYY.MM.DD HH:MM" (local). N/A when absent.
 *
 * @param {string|null|undefined} iso
 * @returns {string}
 */
export function formatTimestamp(iso) {
  if (!iso) return 'N/A';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'N/A';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

/**
 * Round a number to at most `digits` decimals, returning a string. N/A for
 * null/undefined so callers can hide the row.
 *
 * @param {number|null|undefined} n
 * @param {number} [digits=2]
 * @returns {string}
 */
export function num(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return 'N/A';
  return Number(n.toFixed(digits)).toString();
}
