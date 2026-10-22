// src/core/skills-registry/git-tree.mjs — pure helpers over a repository's file listing, shared by the git fetch
// (import.mjs gitFetch) and the HTTPS one (git-free/skills.mjs fetchGitHttps). Moved verbatim out of import.mjs (P6).
import { SKILL_LIMITS, SKILL_LINKS_AND_FOLDERS_MAX } from './inspect.mjs';

// A repository folder: '/'-joined segments, none empty, `.` or `..`, none starting with `-` (an option) or `:`
// (pathspec magic), none holding a glob character, a backslash or a control character. Spaces and letters are fine.
export const PATH_SEGMENT_RE = /^(?![-:])[^\x00-\x1f\x7f*?[\]\\]+$/;
export const isRepoFolder = (p) => p.split('/').every((seg) => PATH_SEGMENT_RE.test(seg) && seg !== '.' && seg !== '..');

/**
 * The folders holding a SKILL.md among `paths` (every non-folder entry of the tree, sorted), the ones a user could type
 * (`offered`), and the pick: `subdir` when given, else the root when it holds a SKILL.md, else the only candidate.
 * `pick` null: nothing to export (no candidate, several, or `subdir` holds no SKILL.md).
 */
export function pickSkillFolder(paths, subdir) {
  const candidates = paths
    .filter((p) => p === 'SKILL.md' || p.endsWith('/SKILL.md'))
    .map((p) => p.slice(0, -'SKILL.md'.length).replace(/\/$/, ''))
    .sort();
  const offered = candidates.filter((p) => p === '' || isRepoFolder(p));
  const pick = subdir ?? (offered.includes('') ? '' : candidates.length === 1 && offered.length === 1 ? offered[0] : null);
  return { candidates, offered, pick: pick === null || !candidates.includes(pick) ? null : pick };
}

/**
 * The limits before anything is extracted, from one row `{ mode, type, size, path }` per entry of the picked folder
 * (paths relative to it, in ls-tree order): its blobs (links included) are its files; its links, its submodules
 * (archived as empty folders) and the folders above every entry count toward SKILL_LINKS_AND_FOLDERS_MAX, as the walk
 * counts them — 300 files can each sit 400 folders deep, and one shared tree object keeps such a repository tiny.
 * ls-tree lists a folder's entries together, so a folder is new where an entry's folder path leaves the previous entry's.
 * @returns {string[]} the problems (empty: within the limits)
 */
export function skillTreeProblems(rows) {
  const blobs = rows.filter((r) => r.type === 'blob');
  const bytes = blobs.reduce((n, r) => n + r.size, 0);
  let others = 0;
  let prev = '';
  for (const r of rows) {
    if (r.mode === '120000') others++;
    const dir = r.type === 'commit' ? `${r.path}/` : r.path.slice(0, r.path.lastIndexOf('/') + 1);
    let same = 0;
    for (let i = 0; i < dir.length && dir[i] === prev[i]; i++) if (dir[i] === '/') same = i + 1;
    for (let i = same; i < dir.length; i++) if (dir[i] === '/') others++;
    prev = dir;
  }
  const problems = [
    ...(blobs.length > SKILL_LIMITS.files ? [`more than ${SKILL_LIMITS.files} files`] : []),
    ...(others > SKILL_LINKS_AND_FOLDERS_MAX ? [`more than ${SKILL_LINKS_AND_FOLDERS_MAX} links and folders`] : []),
    ...(bytes > SKILL_LIMITS.totalBytes ? ['larger than 8 MB in total'] : []),
  ];
  return problems;
}
