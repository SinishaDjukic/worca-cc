// src/core/workflow-tests/guard-calls.mjs — board 37 (D68): what a try tried to send that the outward guard stopped. One row
// per attempt, in connectors.mjs sentCall's shape (server, tool, noun, preview, full) plus `guard`, the caption of its full
// text and the command itself. `forgeOf(remote)` names the forge of the real project's remote (P9), or null.
const VALUE_OPTS = new Set(['--title', '-t', '--body', '-b', '--base', '-B', '--head', '-H', '--repo', '-R', '--label', '-l',
  '--assignee', '-a', '--reviewer', '-r', '--milestone', '-m', '--body-file', '-F', '--description', '-d', '--target-branch',
  '--source-branch', '--push-option', '-o', '--prefix', '-P']);
const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };
function opt(argv, ...names) {
  for (let i = 0; i < argv.length; i += 1) {
    for (const n of names) {
      if (argv[i] === n) return argv[i + 1] ?? null;
      if (argv[i].startsWith(`${n}=`)) return argv[i].slice(n.length + 1);
    }
  }
  return null;
}
function positional(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('-')) { if (!a.includes('=') && VALUE_OPTS.has(a)) i += 1; continue; }
    out.push(a);
  }
  return out;
}
const STOPPED = 'Not sent · stopped by Worca';

export function guardCall(e, { forgeOf = () => null } = {}) {
  const argv = Array.isArray(e && e.arguments && e.arguments.argv) ? e.arguments.argv.map(String) : [];
  const cmd = String((e && e.arguments && e.arguments.command) || '');
  const server = String((e && e.server) || '');
  const tool = String((e && e.tool) || '');
  const row = (fields) => ({ guard: true, server, cmd, to: null, ...fields });
  const pos = positional(argv);
  if (server === 'git' && /(^| )push$/.test(tool)) {
    const remote = pos[0] || null;
    const branch = pos.length > 1 ? pos[pos.length - 1].replace(/^\+/, '').split(':').pop().replace(/^refs\/heads\//, '') || null : null;
    const forge = remote ? forgeOf(remote) : null;
    const where = branch ? `the branch ${branch}` : 'its branch';
    return row({ tool: 'push', noun: 'push', preview: `Send the changes to ${where}`, cap: STOPPED,
      full: `This try tried to send its changes to ${where}${forge ? ` on ${forge}` : ''}.` });
  }
  const sub = pos.slice(0, 2).join(' ');
  const mr = server === 'GitLab CLI' && sub === 'mr create';
  if ((server === 'GitHub CLI' && sub === 'pr create') || mr || (server === 'Azure CLI' && pos.slice(0, 3).join(' ') === 'repos pr create')) {
    const title = opt(argv, '--title', '-t') || '';
    const body = opt(argv, '--body', '-b', '--description', '-d') || '';
    const head = opt(argv, '--head', '-H', '--source-branch');
    const into = opt(argv, '--base', '-B', '--target-branch');
    const what = mr ? 'merge request' : 'pull request';
    return row({ tool: `open a ${what}`, noun: what, preview: `Open a ${what}: ${clip(title, 80)}`,
      cap: head && into ? `Full text · from ${head} into ${into}` : 'Full text', full: `Title: ${title}${body ? `\n${body}` : ''}` });
  }
  if (server === 'GitHub CLI' && sub === 'issue comment') {
    const n = pos[2] || '';
    const body = opt(argv, '--body', '-b') || '';
    return row({ tool: 'comment on an issue', noun: 'issue comment', preview: `on issue ${n}: "${clip(body, 40)}"`, cap: `Full text · on issue ${n}`, full: body });
  }
  if ((server === 'GitHub CLI' || server === 'GitLab CLI') && sub === 'issue create') {
    const title = opt(argv, '--title', '-t') || '';
    const body = opt(argv, '--body', '-b', '--description', '-d') || '';
    return row({ tool: 'open an issue', noun: 'issue', preview: `Open an issue: ${clip(title, 80)}`, cap: 'Full text', full: `Title: ${title}${body ? `\n${body}` : ''}` });
  }
  if (server === 'git' && tool.startsWith('remote ')) return row({ tool: 'change a remote', noun: 'remote change', preview: clip(cmd, 80), cap: STOPPED, full: cmd });
  if (['npm', 'yarn', 'pnpm'].includes(server)) return row({ tool: 'publish a package', noun: 'package', preview: clip(cmd, 80), cap: STOPPED, full: cmd });
  if (server === 'web') {
    const url = argv.find((a) => /^https?:\/\//i.test(a)) || '';
    return row({ tool: 'send a web request', noun: 'web request', preview: clip(url || cmd, 80), cap: STOPPED, full: cmd });
  }
  return row({ tool: tool || 'call', noun: 'call', preview: clip(cmd, 80), cap: STOPPED, full: cmd });
}
