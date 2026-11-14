// Run: node plans/rail/prototype/gates/align-proof.mjs
// Proves the alignment check catches each fault: inject one CSS fault at a time and count what it reports.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { ALIGN } from './align-check.mjs';
const dir = fileURLToPath(new URL('../', import.meta.url));   // the prototype's root
const FAULTS = { none: '', baseline: '.set-text{position:relative;top:3px}', buttonBase: '.set-end > .btn{position:relative;top:3px}', leftName: '.set-name{padding-left:6px}', quietPadding: '.set-end > .btn-quiet:last-child{margin-right:0}', headAction: '.set-sec-head > .btn-quiet,.set-sec-head > .tip-wrap > .btn-quiet{margin-right:0}', sentenceEdge: '.set-row:nth-child(2) .set-text{padding-left:10px}', row: '.set-row:nth-child(2){margin-left:-12px}', sectionLine: '.set-sec + .set-sec{padding-left:10px}', stackedEnd: '@container (max-width:560px){.set-end{padding-left:8px}}', recordTitle: '.list-rows{margin-left:0}' };
const b = await chromium.launch({ channel: 'chrome' }); const failed = [];
for (const [k, css] of Object.entries(FAULTS)) {
  const p = await b.newPage({ viewport: { width: k === 'stackedEnd' ? 400 : 1280, height: 900 } });
  await p.goto('file://' + dir + 'pulse.html'); await p.evaluate(() => { document.querySelector('[data-acct]').click(); document.querySelector('[data-go="settings"]').click(); });
  await p.evaluate((k) => document.querySelector(`[data-sset="${k === 'recordTitle' ? 'plugins' : 'notifications'}"]`).click(), k);
  if (css) await p.addStyleTag({ content: css });
  const r = await p.evaluate(ALIGN); console.log(k.padEnd(13), r.length, r[0] || ''); await p.close();
  if ((k === 'none') !== (r.length === 0)) failed.push(k);
}
await b.close();
console.log(failed.length ? 'the check missed: ' + failed.join(', ') : 'the check catches every fault, and passes the clean page');
process.exitCode = failed.length ? 1 : 0;
