// scripts/git-diff.mjs — the `gitDiff` card (spec §12.3): `git diff <ref>` in the
// run's checkout, or per member under ctx.repos on a workspace run (one `## <key>`
// section each), written as fenced markdown for a downstream reader. No verdict.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

export default async function ({ outputs, params, ctx, log }) {
  const ref = typeof params.ref === 'string' && params.ref.trim() ? params.ref.trim() : (ctx.checkpointRef || '');
  const stat = params.stat === true;
  const args = ['diff', ...(stat ? ['--stat'] : []), ...(ref ? [ref] : [])];
  const section = (dir, label) => {
    const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) log('warn', `git ${args.join(' ')} in ${dir}: ${(r.stderr || '').trim() || `exit ${r.status}`}`);
    const body = (r.stdout || '').trimEnd();
    return `${label ? `## ${label}\n\n` : ''}\`\`\`${stat ? 'text' : 'diff'}\n${body || '(no changes)'}\n\`\`\`\n`;
  };
  const repos = Array.isArray(ctx.repos) && ctx.repos.length ? ctx.repos : null;
  const md = repos ? repos.map((r) => section(r.dir, r.key)).join('\n') : section(ctx.cwd, '');
  const out = outputs.diff?.path;
  if (!out) throw new Error('the diff output has no path');
  writeFileSync(out, `# Diff against ${ref || 'the working tree'}\n\n${md}`, 'utf8');
  return { summary: `diff written (${md.length} chars${repos ? `, ${repos.length} repos` : ''})` };
}
