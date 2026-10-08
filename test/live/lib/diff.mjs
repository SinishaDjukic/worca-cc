// test/live/lib/diff.mjs
// Build-vs-build wire comparison: the same scenario ran on the baseline build
// and on the build under test; every harness spawn is grouped by call site and
// its argv / env keys / system prompt compared after masking what legitimately
// differs per run (paths, ids, pids, dates).

export function makeMask(sb) {
  const pairs = [[sb.base, '<SB>'], [sb.repo, '<REPO>'], [process.execPath, '<NODE>']].filter(([p]) => p).sort((a, b) => b[0].length - a[0].length);
  return (s) => {
    let x = String(s);
    for (const [p, r] of pairs) x = x.split(p).join(r).split(p.replace(/^\/private/, '')).join(r);
    return x
      .replace(/\/(?:private\/)?(?:var\/folders\/[^/]+\/[^/]+\/T|tmp)\/([a-z][\w]*(?:-[a-z][\w]*)*)-[A-Za-z0-9]{6}(?=\/|$|["'\s])/gi, '<TMP>/$1-<RND>')
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<UUID>')
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<TS>')
      .replace(/\b\d{2}-\d{2}-\d{2}-/g, '<DATE>-')
      .replace(/PID \d+/g, 'PID <PID>')
      .replace(/\b(?=[0-9a-f]*[a-f])[0-9a-f]{8}\b/g, '<ID>')
      .replace(/(askm_|ask_|msg)[0-9a-z]{6,}/gi, '$1<ID>')
      .replace(/(?<=-)\d{8}(?=[/"'\s:]|$)/g, '<ID>')            // an all-digit 8-char id suffix (project keys)
      .replace(/(127\.0\.0\.1|localhost):\d{2,5}/g, '$1:<PORT>');
  };
}

const ENV_VOLATILE = /^(WORCA_HOST_PID|PWD|OLDPWD|SHLVL|_|TMPDIR|TERM_SESSION_ID|SECURITYSESSIONID|__CF.*|XPC_.*|LaunchInstanceID|Apple_PubSub_Socket_Render|SSH_AUTH_SOCK|COMMAND_MODE|LOGNAME|USER|MallocNanoZone|ITERM.*|TERM_PROGRAM.*|COLORTERM|LC_.*|LANG|NVM_.*|MANPATH|INFOPATH|HOMEBREW_.*|GHOSTTY.*|VSCODE.*|GIT_ASKPASS|OTEL_.*|CLAUDECODE|CLAUDE_CODE_ENTRYPOINT|CLAUDE_CODE_MESSAGING_SOCKET|COREPACK.*|ZSH|ZDOTDIR|PAGER|LESS|LSCOLORS|LS_COLORS|EDITOR|VISUAL|OLLAMA.*)$/;

function envView(rec, mask) {
  const out = {};
  for (const [k, v] of Object.entries(rec.env || {})) {
    if (ENV_VOLATILE.test(k)) continue;
    out[k] = /^(WORCA_|CLAUDE_|ANTHROPIC_|API_TIMEOUT|BASH_|MCP_|ENABLE_|DISABLE_|MAX_)/.test(k) ? mask(v) : '<present>';
  }
  return out;
}

function systemPrompt(rec) {
  const a = rec.args;
  for (const f of ['--append-system-prompt', '--system-prompt']) { const i = a.indexOf(f); if (i >= 0) return a[i + 1]; }
  return rec.files?.['--append-system-prompt-file'] ?? '';
}

function group(profile, taps, mask) {
  const m = new Map();
  for (const t of taps) {
    if (t.probe) continue;
    const site = mask(t.site);
    if (!m.has(site)) m.set(site, []);
    m.get(site).push({
      argv: JSON.stringify(profile.argvShape(t, mask)),
      env: envView(t, mask),
      sys: mask(systemPrompt(t)),
      files: Object.fromEntries(Object.entries(t.files || {}).map(([k, v]) => [k, mask(v)])),
      stdin: t.stdin ? `<${t.stdin.length}ch>` : '',
    });
  }
  return m;
}

function lineDiff(a, b, max = 12) {
  const A = a.split('\n'); const B = b.split('\n');
  const setB = new Set(B); const setA = new Set(A);
  const out = [];
  for (const l of A) if (!setB.has(l)) out.push(`- ${l.slice(0, 220)}`);
  for (const l of B) if (!setA.has(l)) out.push(`+ ${l.slice(0, 220)}`);
  return out.slice(0, max);
}

/**
 * @returns {{sites: Array<{site:string, status:'same'|'differs'|'only-base'|'only-test', details:string[]}>}}
 */
export function diffBuilds(profile, base, test) {
  const gA = group(profile, base.taps, makeMask(base.sb));
  const gB = group(profile, test.taps, makeMask(test.sb));
  const sites = [];
  for (const site of new Set([...gA.keys(), ...gB.keys()])) {
    const A = gA.get(site); const B = gB.get(site);
    if (!A) { sites.push({ site, status: 'only-test', details: [`${B.length} spawn(s) only on the build under test`] }); continue; }
    if (!B) { sites.push({ site, status: 'only-base', details: [`${A.length} spawn(s) only on the baseline`] }); continue; }
    const details = [];
    const argvA = [...new Set(A.map((x) => x.argv))]; const argvB = [...new Set(B.map((x) => x.argv))];
    if (JSON.stringify(argvA.sort()) !== JSON.stringify(argvB.sort())) {
      details.push('argv differs:');
      details.push(...lineDiff(argvA.map((s) => JSON.parse(s).join('\n')).join('\n'), argvB.map((s) => JSON.parse(s).join('\n')).join('\n')));
    }
    const eA = A[0].env; const eB = B[0].env;
    for (const k of new Set([...Object.keys(eA), ...Object.keys(eB)])) {
      if (eA[k] !== eB[k]) details.push(`env ${k}: base=${JSON.stringify(eA[k] ?? null)?.slice(0, 120)} test=${JSON.stringify(eB[k] ?? null)?.slice(0, 120)}`);
    }
    if (A[0].sys !== B[0].sys) { details.push('system prompt differs:'); details.push(...lineDiff(A[0].sys, B[0].sys)); }
    for (const f of new Set([...Object.keys(A[0].files), ...Object.keys(B[0].files)])) {
      if (A[0].files[f] !== B[0].files[f]) { details.push(`staged file ${f} differs:`); details.push(...lineDiff(String(A[0].files[f] ?? ''), String(B[0].files[f] ?? ''), 6)); }
    }
    if (A[0].stdin !== B[0].stdin && (!A[0].stdin || !B[0].stdin)) details.push(`stdin: base=${A[0].stdin || 'none'} test=${B[0].stdin || 'none'}`);
    sites.push({ site, status: details.length ? 'differs' : 'same', details, counts: [A.length, B.length] });
  }
  return { sites: sites.sort((a, b) => a.site.localeCompare(b.site)) };
}
