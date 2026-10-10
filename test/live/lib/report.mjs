// test/live/lib/report.mjs
// report.json (machine) + report.md (human) + junit.xml for one suite run.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

export function writeReports(outDir, { opt, preflight, caps, results, diffs }) {
  const test = results.filter((r) => r.build === 'test');
  const n = (st) => test.filter((r) => r.status === st).length;
  const cost = results.reduce((a, r) => a + (r.wireCostUsd || 0), 0);
  writeFileSync(join(outDir, 'report.json'), JSON.stringify({ engine: opt.engine, preflight, caps, opt, results, diffs }, null, 1));

  const md = [];
  md.push(`# Live suite — ${opt.engine} (${preflight.version}, ${preflight.auth})`, '');
  md.push(`tier **${opt.tier}** · ${test.length} jobs · **${n('pass')} pass · ${n('fail')} fail · ${n('skip')} skip** · notional cost $${cost.toFixed(2)}`, '');
  md.push('| scenario | model | rep | status | checks | spawns | $ | time |', '|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    const failed = r.checks.filter((c) => !c.ok && c.severity === 'fail').length;
    md.push(`| ${r.id}${r.build === 'baseline' ? ' (baseline)' : ''} | ${r.model} | ${r.rep} | ${r.status}${r.warnings ? ` (${r.warnings} warn)` : ''} | ${r.checks.length - failed}/${r.checks.length} | ${r.spawns} | ${(r.wireCostUsd || 0).toFixed(3)} | ${Math.round((r.ms || 0) / 1000)}s |`);
  }
  const bad = results.filter((r) => r.checks.some((c) => !c.ok) || r.skipped || r.notes.length);
  if (bad.length) {
    md.push('', '## Details');
    for (const r of bad) {
      md.push('', `### ${r.id} · ${r.model} · r${r.rep}${r.build === 'baseline' ? ' · baseline' : ''} — ${r.status}`);
      if (r.sandbox) md.push(`sandbox: \`${r.sandbox}\``);
      if (r.skipped) md.push(`skipped: ${r.skipped}`);
      for (const c of r.checks.filter((x) => !x.ok)) md.push(`- ${c.severity === 'warn' ? '⚠' : '✗'} **${c.name}** — ${c.detail.replace(/\n/g, ' ').slice(0, 600)}`);
      for (const x of r.notes) md.push(`- note: ${x}`);
    }
  }
  if (diffs.length) {
    md.push('', '## Baseline vs build under test (wire)');
    for (const d of diffs) {
      md.push('', `### ${d.id} · ${d.model}`);
      for (const s of d.sites) {
        md.push(`- **${s.status}** \`${s.site}\`${s.counts ? ` (${s.counts[0]} vs ${s.counts[1]} spawns)` : ''}`);
        if (s.status !== 'same') for (const l of s.details) md.push(`    - \`${l.replace(/`/g, "'")}\``);
      }
    }
  }
  writeFileSync(join(outDir, 'report.md'), md.join('\n') + '\n');

  const x = ['<?xml version="1.0" encoding="UTF-8"?>', `<testsuite name="live-${esc(opt.engine)}" tests="${test.length}" failures="${n('fail')}" skipped="${n('skip')}">`];
  for (const r of test) {
    x.push(`  <testcase classname="${esc(r.id)}" name="${esc(`${r.model} r${r.rep}`)}" time="${((r.ms || 0) / 1000).toFixed(1)}">`);
    if (r.status === 'skip') x.push(`    <skipped message="${esc(r.skipped || '')}"/>`);
    for (const c of r.checks.filter((y) => !y.ok && y.severity === 'fail')) x.push(`    <failure message="${esc(c.name)}">${esc(c.detail)}</failure>`);
    x.push('  </testcase>');
  }
  x.push('</testsuite>');
  writeFileSync(join(outDir, 'junit.xml'), x.join('\n') + '\n');
  return md.slice(0, 4 + test.length + 2).join('\n') + `\n\nreport: ${join(outDir, 'report.md')}`;
}
