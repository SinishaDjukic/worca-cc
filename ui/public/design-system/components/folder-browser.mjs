// FolderBrowser (docs/rail/components.md): picking one folder, or several, on this computer. A Dialog that lists the
// folders under one path (GET /api/fs/dirs); its helpers: a folder's name (folderName), the probe line under a typed
// path (folderProbe, classic's detectModel rules) and the review list of picked folders (folderReview).
import { attrs, esc } from './html.mjs';
import { dialog } from './dialog.mjs';
import { button } from './button.mjs';
import { checkbox } from './checkbox.mjs';
import { field } from './field.mjs';
import { chip } from './chip.mjs';
import { textLink } from './text-link.mjs';
import { confirmActions, confirmStrip } from './confirm-strip.mjs';
import { switchButton } from './settings-row.mjs';
import { listState } from './list-parts.mjs';
import { icon } from './icons.mjs';

/** The last segment of a path, without a trailing slash ('/a/b/' → 'b'; '' → ''). */
export const folderName = (path) => String(path || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The folder browser, in a Dialog: one folder (`Select this folder`) or several (checkboxes, `Add N selected`).
 * @param {object} o
 * @param {boolean} [o.multiple]
 * @param {string} [o.path]       the folder it lists
 * @param {string|null} [o.parent] Up's folder; null at a root
 * @param {{name:string, path:string}[]} [o.dirs]
 * @param {string[]} [o.picked]   multi: the ticked paths
 * @param {'ready'|'loading'|'failed'} [o.state]
 * @param {string} [o.error]      the status line: why the last load failed (the listing stays)
 * @param {string} [o.note]       the limited-scope note
 * @param {string[]} [o.roots]    the folders it may open, when limited
 * @param {boolean} [o.ask]      multi: Escape with picks asks first, in a ConfirmStrip at the top of the body
 * @param {string} [o.id]
 */
export function folderBrowser({ multiple = false, path = '', parent = null, dirs = [], picked = [], state = 'ready', error = '', note = '', roots = [], ask = false, id = 'fb-t' } = {}) {
  const n = picked.length;
  const nav = `<div class="fb-nav">${button({ label: 'Up', kind: 'quiet', attrs: { 'data-fb-go': parent || null, disabled: parent == null, title: parent ? `Opens ${parent}` : 'This is the top' } })}${button({ label: 'Home', kind: 'quiet', attrs: { 'data-fb-home': '', title: 'Opens your home folder' } })}<span class="fb-path"${attrs({ title: path || null })}>${esc(path)}</span></div>`;
  const scope = note ? `<p class="fb-note">${esc(note)}${roots.length > 1 ? ` ${roots.map((r) => button({ label: folderName(r) || r, kind: 'quiet', attrs: { 'data-fb-go': r, title: r } })).join('')}` : ''}</p>` : '';
  const row = (d) => `<li class="fb-row">${multiple ? checkbox({ checked: picked.includes(d.path), attrs: { 'aria-label': `Select ${d.name}`, 'data-fb-pick': d.path, 'data-keep': `fb:${d.path}` } }) : ''}${button({ label: d.name, kind: 'quiet', icon: icon('folder', 14), attrs: { 'data-fb-go': d.path, title: `Opens ${d.path}` } })}</li>`;
  const list = state === 'loading' ? listState({ state: 'loading', noun: 'folders' }) : dirs.length ? `<ul class="fb-list">${dirs.map(row).join('')}</ul>` : '<p class="fb-none">No subfolders.</p>';
  const asking = ask && n ? confirmStrip({ text: `Drop ${plural(n, 'picked folder')}?`, yes: 'Drop them', no: 'Keep picking', id: `${id}-ask` }) : '';
  return dialog({
    title: multiple ? 'Select folders' : 'Select a folder',
    id,
    cls: 'fb',
    body: `${asking}${nav}${scope}${list}`,
    yes: multiple ? `Add ${n} selected` : 'Select this folder',
    status: esc(error || (multiple ? `${plural(n, 'folder')} selected` : '')),
    hooks: { yes: { disabled: (multiple && !n) || !path || state === 'loading' } },
  });
}

const filesWord = (n, capped) => (typeof n !== 'number' || !Number.isFinite(n) ? '' : capped ? `${n}+ files` : plural(n, 'file'));
const rootAction = (probe) => (probe.partOf ? { kind: 'open', name: probe.partOf } : probe.repoRoot ? { kind: 'add', path: probe.repoRoot } : null);

/**
 * The probe line under a typed folder (GET /api/projects/probe), by classic's detectModel rules.
 * @param {object} probe   the probe's answer
 * @param {{git?:boolean}} [o]  git is installed: a plain folder says No git and offers Use git
 * @returns {{html:string, refused:boolean, useGit:boolean, note?:string, action?:object|null}}
 */
export function folderProbe(probe, { git = true } = {}) {
  if (!probe || typeof probe !== 'object' || typeof probe.exists !== 'boolean') return { html: '', refused: false, useGit: false };
  let chips, refused = false, useGit = false, note = '', action = null;
  if (!probe.exists) { chips = [['Not found', 'warn']]; refused = true; }
  else if (!probe.isDir) { chips = [['Not a folder', 'warn']]; refused = true; }
  else if (probe.insideRepo) { chips = [['Git'], [probe.partOf ? `Part of ${probe.partOf}` : 'Inside a git repository', 'warn']]; refused = true; action = rootAction(probe); }
  else if (probe.nestedHint) { chips = [['Git'], ['Nested repository', 'warn']]; note = String(probe.nestedHint); action = rootAction(probe); }
  else if (probe.vcs === 'git') chips = [['Git']];
  else { chips = [['Folder'], ...(git ? [['No git']] : []), ...(filesWord(probe.files, probe.filesCapped) ? [[filesWord(probe.files, probe.filesCapped)]] : [])]; useGit = !!git; }
  const chipHtml = chips.map(([text, tone]) => (tone === 'warn' ? `<span class="fb-warn">${icon('alert', 12)}${chip({ text })}</span>` : chip({ text }))).join(' ');
  const link = action ? textLink({ label: action.kind === 'open' ? `Open ${action.name}` : `Add ${folderName(action.path)}`, attrs: { 'data-fb-root': action.kind === 'open' ? action.name : action.path, title: action.kind === 'open' ? `Opens ${action.name}` : `Adds ${action.path}` } }) : '';
  const html = `<div class="fb-probe" role="status">${chipHtml}${link ? ` ${link}` : ''}${note ? `<span class="fb-probe-note">${esc(note)}</span>` : ''}</div>`;
  return { html, refused, useGit, ...(note ? { note } : {}), action };
}

/**
 * One way's controls on the add form's row: a folder button (Choose folder…, Browse folders…) and/or the Use git switch.
 * @param {{pick?:{label:string, hook:string, title:string}, git?:{on:boolean, hook:string, why:string}}} o  hook: a data- attribute
 */
export function folderWay({ pick = null, git = null } = {}) {
  const p = pick ? button({ label: pick.label, kind: 'quiet', icon: icon('folder', 14), attrs: { [pick.hook]: '', title: pick.title } }) : '';
  const g = git ? `${switchButton({ on: !!git.on, label: 'Use git', why: git.why, attrs: { [git.hook]: '' } })}<span>Use git</span>` : '';
  return `<span class="fb-way">${p}${g}</span>`;
}

/** Words of the review list: nothing ticked, and what a bulk add did. */
export const REVIEW_EMPTY = 'Tick at least one folder to add.';
/**
 * What a bulk add did, in one line (classic bulkAddSummary): `Added 3 projects. Skipped 1: beta (REASON).`
 * @param {{added:string[], skipped:{name?:string, path?:string, reason:string}[]}} o  added: the names
 */
export function reviewSummary({ added = [], skipped = [] } = {}) {
  const parts = [];
  if (added.length === 1) parts.push(`Added “${added[0]}”.`);
  else if (added.length > 1) parts.push(`Added ${added.length} projects.`);
  if (skipped.length) parts.push(`Skipped ${skipped.length}: ${skipped.map((r) => `${String(r.name || '').trim() || folderName(r.path)} (${r.reason})`).join('; ')}.`);
  return parts.join(' ');
}

/**
 * The review list of picked folders: each ticked one gets a name; an added one locks, a skipped one keeps its reason.
 * @param {object} o
 * @param {{path:string, name:string, include:boolean, status?:''|'added'|'skipped', reason?:string}[]} o.rows
 * @param {boolean} [o.saving]
 * @param {string} [o.error]   why nothing was sent (REVIEW_EMPTY, a refusal), above the list
 */
export function folderReview({ rows = [], saving = false, error = '' } = {}) {
  const pending = rows.filter((r) => r.include && r.status !== 'added').length;
  const row = (r, i) => {
    const added = r.status === 'added';
    const status = added ? `<span class="fb-st is-ok">${icon('check', 12)} Added</span>` : r.reason ? `<span class="fb-st is-fail">${esc(r.reason)}</span>` : '';
    return `<li class="fb-rev"${attrs({ 'data-fr-row': String(i) })}>${checkbox({ checked: !!r.include, disabled: added || saving, attrs: { 'aria-label': `Add ${r.name || folderName(r.path)}`, 'data-fr-pick': String(i), 'data-keep': `frp:${i}` } })}${field({ id: `fr-name-${i}`, label: 'Its name', value: r.name, quietLabel: true, attrs: { maxlength: 80, 'data-fr-name': String(i), 'data-keep': `fr:${i}`, disabled: added || saving } })}<span class="fb-rev-path"${attrs({ title: r.path })}>${esc(r.path)}</span>${status}</li>`;
  };
  const acts = confirmActions({ yes: saving ? 'Adding…' : `Add ${plural(pending, 'project')}`, busy: saving || !pending });
  return `${error ? `<p class="fb-err" role="alert">${esc(error)}</p>` : ''}<ul class="fb-review">${rows.map(row).join('')}</ul>${acts}`;
}
