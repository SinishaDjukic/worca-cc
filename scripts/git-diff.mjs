// scripts/git-diff.mjs — the `gitDiff` card (spec §12.3): `git diff <ref>` in the
// run's checkout, or per member under ctx.repos on a workspace run (one `## <key>`
// section each, against that member's OWN diff base), written as fenced markdown for
// a downstream reader. No verdict.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export default async function ({ outputs, params, ctx, log }) {
  const explicit = typeof params.ref === 'string' && params.ref.trim() ? params.ref.trim() : '';
  const stat = params.stat === true;
  const repos = Array.isArray(ctx.repos) && ctx.repos.length ? ctx.repos : null;
  // P3: a run without a project (or a Folder run) has no repository. git is never run there: from a work folder under a
  // worcaHome that sits inside a repository it would diff THAT repository into the run's artifacts.
  if (!repos && ctx.workMode && ctx.workMode !== 'git') {
    const out = outputs.diff?.path;
    if (!out) throw new Error('the diff output has no path');
    // A Folder run has a diff all the same: P1 writes its copy's changes to <pipelineDir>/changes.patch.
    writeFileSync(out, ctx.workMode === 'folder' && ctx.pipelineDir
      ? `# Diff\n\nThis run works on a copy of the project's folder, with no git: its changes are in \`${join(ctx.pipelineDir, 'changes.patch')}\`.\n`
      : '# Diff\n\nThis run has no repository, so there is no diff.\n', 'utf8');
    return { summary: 'no repository' };
  }
  // An explicit ref applies to every member; otherwise each member diffs from its own base —
  // ctx.checkpointRef is the primary's and means nothing in another member's repository.
  // A member with no base of its own diffs its working tree (no ref): falling back to the primary's
  // ctx.checkpointRef there would diff it against another repository's commit again.
  const own = (r) => (typeof r?.checkpointRef === 'string' ? r.checkpointRef.trim() : '');
  const refs = repos ? repos.map((r) => explicit || own(r)) : [explicit || ctx.checkpointRef || ''];
  // A param is argv, not a shell word — but `--output=<path>` is still a git OPTION, and git runs with worca's privileges.
  for (const ref of refs) if (ref.startsWith('-')) throw new Error(`a ref must not start with "-": ${ref}`);
  const section = (dir, label, ref) => {
    const args = ['diff', ...(stat ? ['--stat'] : []), ...(ref ? [ref] : [])];
    const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) log('warn', `git ${args.join(' ')} in ${dir}: ${(r.stderr || '').trim() || `exit ${r.status}`}`);
    const body = (r.stdout || '').trimEnd();
    const head = label ? `## ${label}\n\n${ref ? `Base: \`${ref}\`\n\n` : ''}` : '';
    return `${head}\`\`\`${stat ? 'text' : 'diff'}\n${body || '(no changes)'}\n\`\`\`\n`;
  };
  // P5: a Folder member of a workspace run is a copy with no git (git there would diff an enclosing repository).
  const folderSection = (r) => `## ${r.key}\n\nFolder project (no git): its changes are in \`${r.changesPatch}\`.\n`;
  const md = repos
    ? repos.map((r, i) => (r.workMode === 'folder' ? folderSection(r) : section(r.dir, r.key, refs[i]))).join('\n')
    : section(ctx.cwd, '', refs[0]);
  const out = outputs.diff?.path;
  if (!out) throw new Error('the diff output has no path');
  const against = explicit || (repos ? 'each project\'s diff base' : refs[0]) || 'the working tree';
  writeFileSync(out, `# Diff against ${against}\n\n${md}`, 'utf8');
  return { summary: `diff written (${md.length} chars${repos ? `, ${repos.length} repos` : ''})` };
}
