// node plans/rail/prototype/gates/handover-check.mjs
// The handover gate (docs/rail/philosophy.md › rail.hand-to-chat): every way a place sends a thing to Chat must land on Chat
// with that thing as a chip in the composer. Pages may not pre-write text through start() either.
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright-core');
import { indexUrl } from './target.mjs';
const URL_ = indexUrl();
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const bad = [];
for (const dir of readdirSync(ROOT, { withFileTypes: true }).filter((d) => d.isDirectory() && !['chat', 'gates', 'node_modules'].includes(d.name))) {
  for (const f of readdirSync(ROOT + dir.name).filter((n) => n.endsWith('.js'))) {
    if (/RailConversation\?*\.start\(\s*'[a-z]+'\s*,\s*[^)\s]/.test(readFileSync(`${ROOT}${dir.name}/${f}`, 'utf8'))) bad.push(`${dir.name}/${f}: hands text through start(); use handOver`);
  }
}
const CASES = [
  ['Workflow · Default', 'workflows/workflow:default', '[data-wf-chat]'],
  ['Workflow · Default', 'workflows/workflow:default', '[data-wf-use]'],
  ['Project · billing-api', 'projects/billing-api', '[data-pj-more-task]', ['[data-menu="pj-more"]', '.menu [data-menu-pick$="task"]:not([data-menu-pick$="tasks"])']],
  ['Workspace · Web shop', 'projects/ws:web-shop', '[data-ws="task"]'],
  ['Workspace · Web shop', 'projects/ws:web-shop', '[data-ws="chat"]'],
  ['Project · web-app', 'insights/why', '[data-in-try]'],
];
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
for (const [want, hash, sel, steps] of CASES) {
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  await p.addInitScript(() => localStorage.setItem('worca-rail.mode', 'expert'));
  await p.goto(`${URL_}#${hash}`); await p.waitForTimeout(700);
  try {
    if (steps) for (const s of steps) { await p.locator(s).first().click({ timeout: 2000 }); await p.waitForTimeout(150); }
    else await p.locator(sel).first().click({ timeout: 2000 });
    await p.waitForTimeout(400);
    const h = await p.evaluate(() => location.hash), chips = await p.locator('.composer-chips').first().innerText({ timeout: 1000 }).catch(() => '');
    if (!h.startsWith('#chat') || !chips.includes(want)) bad.push(`${hash} ${steps ? steps.at(-1) : sel}: landed ${h}, chips "${chips}", wanted "${want}"`);
    else console.log(`ok   ${hash} ${steps ? steps.at(-1) : sel} → ${want}`);
  } catch (e) { bad.push(`${hash} ${sel}: ${e.message.split('\n')[0]}`); }
  await p.close();
}
await b.close();
for (const x of bad) console.log(`FAIL ${x}`);
process.exit(bad.length ? 1 : 0);
