// src/core/git-free/skills.mjs — the skill import's fetchGit seam over HTTPS, for GitHub sources on a machine without
// git (P6 Task 6). Same contract as import.mjs gitFetch: list the tree, pick the folder, check the limits from the
// tree's sizes before anything is downloaded, then extract the folder from the commit's archive into `dest`.
import { mkdirSync } from 'node:fs';
import { sep } from 'node:path';
import { GIT_MISSING } from '../git-available.mjs';
import { SKILL_LIMITS, SKILL_LINKS_AND_FOLDERS_MAX } from '../skills-registry/inspect.mjs';
import { SkillLibraryError } from '../skills-registry/library.mjs';
import { pickSkillFolder, skillTreeProblems } from '../skills-registry/git-tree.mjs';
import { githubRepoOf, createGithubClient, resolveCommit, GithubError } from './github.mjs';
import { extractTarGz, ARCHIVE_LIMITS } from './archive.mjs';

const TOO_LARGE = `too large for a skill (at most ${SKILL_LIMITS.files} files, ${SKILL_LINKS_AND_FOLDERS_MAX} links and folders and 8 MB)`;
// Another host, or a tree GitHub cannot list whole: only git can fetch it.
const gitMissing = () => new SkillLibraryError(409, GIT_MISSING.message, { code: GIT_MISSING.code });

/** @returns {Promise<{ sha: string, subdir: string|null, candidates: string[] }>} subdir null: nothing extracted */
export async function fetchGitHttps({ url, ref, subdir, dest }) {
  const repo = githubRepoOf(url);
  if (!repo) throw gitMissing();
  const client = createGithubClient({ ...repo, role: 'read' });
  const sha = await resolveCommit(client, ref || null);
  // GitHub resolves an abbreviated commit; git fetch does not.
  if (ref && /^[0-9a-f]{4,39}$/i.test(ref) && sha.startsWith(ref.toLowerCase())) throw new SkillLibraryError(400, `git: could not fetch ${ref} from ${url}: use the full 40-character commit`);
  const tree = await client.json('GET', `/git/trees/${sha}?recursive=1`);
  if (tree.truncated) throw gitMissing();
  const rows = tree.tree.filter((e) => e.type !== 'tree').map((e) => ({ mode: e.mode, type: e.type, size: e.size ?? 0, path: e.path }));
  const { offered, pick } = pickSkillFolder(rows.map((r) => r.path), subdir);
  if (pick === null) return { sha, subdir: null, candidates: offered };
  const prefix = pick ? `${pick}/` : '';
  const problems = skillTreeProblems(rows.filter((r) => r.path.startsWith(prefix)).map((r) => ({ ...r, path: r.path.slice(prefix.length) })));
  if (problems.length) throw new SkillLibraryError(400, `${TOO_LARGE}: ${problems.join('; ')}`, { problems });
  mkdirSync(dest, { recursive: true, mode: 0o700 });
  let skipped;
  try {
    ({ skipped } = await extractTarGz(await client.archive(sha), dest, {
      include: (p) => pick === '' || p === pick || p.startsWith(`${pick}/`),
      stripPrefix: pick,
      links: true,
      // The tree's own sizes were checked above; these stop only an archive holding more than the tree lists (export-subst,
      // a lying server). A file over 1 MB is not one: git stages it too and the stage's inspection names it. entries: the
      // picked folder's own entry counts too.
      limits: { downloadBytes: ARCHIVE_LIMITS.downloadBytes, extractBytes: SKILL_LIMITS.totalBytes, entries: SKILL_LIMITS.files + SKILL_LINKS_AND_FOLDERS_MAX + 1, fileBytes: SKILL_LIMITS.totalBytes },
    }));
  } catch (e) {
    // The skill's own caps (the tree listed less than the archive holds), or GitHub's whole-repository archive past 512 MiB.
    if (e?.code === 'TOO_LARGE') throw new SkillLibraryError(400, e.limit === 'downloadBytes' ? 'the repository is too large to read without git' : `${TOO_LARGE}: the archive holds more than the tree lists`);
    // A write the disk refused (a name too long, a case collision): the stage folder's host path stays out of the answer.
    if (!(e instanceof GithubError) && String(e?.message).includes(dest)) throw new SkillLibraryError(400, `could not write the skill's files: ${e.message.replaceAll(dest + sep, '').replaceAll(dest, '.')}`);
    throw e;
  }
  // Names git writes but extractTarGz never does (a backslash, a drive letter): refused, never staged without them.
  const unsafe = skipped.filter((s) => s.why === 'unsafe').map((s) => s.path.slice(s.path.indexOf('/') + 1).replace(/\/$/, ''))
    .filter((p) => p.startsWith(prefix)).map((p) => p.slice(prefix.length));
  if (unsafe.length) throw new SkillLibraryError(400, `names Worca cannot write without git: ${unsafe.join(', ')}`);
  return { sha, subdir: pick, candidates: offered };
}
