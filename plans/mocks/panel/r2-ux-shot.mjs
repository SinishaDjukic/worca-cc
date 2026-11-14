import { chromium } from 'playwright';
const [,, src, out] = process.argv;
const b = await chromium.launch({ channel: "chrome" });
const p = await b.newPage({ viewport: { width: 1440, height: 600 }, deviceScaleFactor: 2 });
await p.goto('file://' + src); await p.evaluate(() => document.fonts.ready);
await p.screenshot({ path: out, fullPage: true }); await b.close();
