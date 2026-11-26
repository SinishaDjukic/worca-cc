// The waiting question's answers keep a readable column at every pane width. Real Chrome lays out the real
// stylesheet in a 1200px window while the page's own width varies, as it does beside the Runs list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFindTools } from '../src/core/graph/media-preflight.mjs';
import { readStyleCss } from '../src/core/read-style-css.mjs';

const chrome = (await loadFindTools()).findChrome({ env: process.env });

const LONG = 'Fail fast with a clear error that names the offending field, the received value and the accepted range';
const opt = (label, rec) => `<button type="button" class="qopt"><span class="qopt-txt">${label}</span>${
  rec ? '<span class="qrec">Recommended</span>' : ''}<span class="qconf">70%</span></button>`;
const block = `<div class="qblock"><div class="qtext"><span class="qn">1</span>How should the feature handle invalid input?</div>
  <div class="qopts">${opt(LONG, true)}${opt('src/shared/validation/normalizeIncomingPayloadOrThrowDetailedError.mjs', false)}</div>
  <input class="qfree" type="text"></div>`;
const runPage = (width) => `<div class="rd" style="width:${width}px"><section class="rd-details"><div class="rd-questions">
  <div class="qpanel" data-kind="clarify">${block}</div>
  <div class="qpanel" data-kind="gate"><div class="gate-intro">Another cycle?</div>
    <div class="issues"><div class="issue"><div class="issue-title">${LONG}</div></div></div></div>
</div></section></div>`;
const chatCard = (width) => `<section class="chat-rc-q chat-q" style="width:${width}px"><div class="chat-rc-qbody">
  <div class="qpanel" data-kind="clarify">${block.replace(/<span class="qconf">70%<\/span>/g, '')}</div></div></section>`;   // no figures in Chat

test('real Chrome: answer labels stay readable and inside their card, on the run page and the Chat card', { skip: !chrome, timeout: 90_000 }, async () => {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: chrome });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const measure = async (html) => {
      await page.setContent(`<!doctype html><style>${readStyleCss()}</style>${html}`);
      return page.evaluate(() => {
        const box = (sel) => document.querySelector(sel)?.getBoundingClientRect();
        const card = box('.qblock');
        return {
          sideBySide: box('.qopts').left >= box('.qtext').right,
          labels: [...document.querySelectorAll('.qopt-txt')].map((n) => n.getBoundingClientRect().width),
          inside: [...document.querySelectorAll('.qopt > span')].every((n) => n.getBoundingClientRect().right <= card.right + 0.5),
          issues: box('.issues')?.width,
        };
      });
    };
    const check = (m, where) => {
      assert.ok(Math.min(...m.labels) >= 150, `${where}: narrowest label ${Math.min(...m.labels)}px`);
      assert.ok(m.inside, `${where}: a label or tag is drawn past its card`);
    };
    // 636px is the run page at a 1200px window with the Runs list open; 960px is where two columns begin.
    for (const width of [390, 636, 857, 959, 960, 1356]) {
      const m = await measure(runPage(width));
      check(m, `run page ${width}px`);
      assert.equal(m.sideBySide, width >= 960, `run page ${width}px: question beside its answers`);
      assert.ok(m.issues >= 250, `run page ${width}px: the gate's issues are ${m.issues}px wide`);
    }
    for (const width of [360, 639, 640, 900]) check(await measure(chatCard(width)), `Chat card ${width}px`);
  } finally {
    await browser.close();
  }
});
