// tools/readiness/gh.mjs — #919 slice 3: the one outward action. Repo and issue are fixed; the body is scanned first.
import { writeFileSync } from 'node:fs';
import { scanSecrets, describeFindings } from '../../src/core/secret-scan.mjs';
import { parseRemoteUrl, sameRepo } from '../../src/core/forge.mjs';

export const REPO = 'SinishaDjukic/worca-cc';
export const ISSUE = 919;

/** gh's own output can name the account and a masked token: only the account line goes to evidence. */
export function authStatus(run) {
  const r = run('gh', ['auth', 'status', '--hostname', 'github.com']);
  const account = `${r.stdout}\n${r.stderr}`.match(/Logged in to github\.com account (\S+)/)?.[1] ?? null;
  return r.code === 0 ? { ok: true, detail: `gh is signed in to github.com as ${account ?? 'an account'}` }
    : { ok: false, detail: 'gh auth status failed: run gh auth login' };
}

export function originMatches(run, root) {
  return sameRepo(parseRemoteUrl(run('git', ['-C', root, 'remote', 'get-url', 'origin']).stdout.trim()), { host: 'github.com', owner: 'SinishaDjukic', repo: 'worca-cc' });
}

/** Scan, comment, then prove gh issue view 919 --comments shows the marker line. Throws on any refusal, before any
 *  gh issue comment call. Every scan kind refuses: secret, machine (home path), personal (email), internal (host/IP).
 *  The body is written before the scan, so a refusal's line number can be read in the file. */
export function postReport({ run, root, body, marker, file }) {
  if (!authStatus(run).ok) throw new Error('refusing to post: gh is not signed in (gh auth status failed)');
  if (!originMatches(run, root)) throw new Error(`refusing to post: origin is not github.com/${REPO}`);
  writeFileSync(file, body);
  const hits = scanSecrets(body);
  if (hits.length) throw new Error(`refusing to post: ${describeFindings(hits)}`);
  const p = run('gh', ['issue', 'comment', String(ISSUE), '--repo', REPO, '--body-file', file]);
  if (p.code !== 0) throw new Error(`gh issue comment failed: ${p.stderr.trim()}`);
  const v = run('gh', ['issue', 'view', String(ISSUE), '--repo', REPO, '--comments']);
  if (v.code !== 0 || !v.stdout.includes(marker)) throw new Error(`posted (${p.stdout.trim()}), but gh issue view ${ISSUE} --comments does not show the report`);
  return { url: p.stdout.trim() };
}
