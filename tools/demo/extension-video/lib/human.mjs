// tools/demo/extension-video/lib/human.mjs — readable, human-paced input for the recording. Every pointer move goes
// through `move` so the stage's fake cursor follows (headless video has no cursor).
export const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** Deterministic jitter (mulberry32) so two recordings pace identically. */
export function rng(seed = 7) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Per-key delays in [min,max] ms (brisk, still readable); a short beat after spaces and punctuation. */
export function keyDelays(text, { min = 35, max = 45, seed = 7 } = {}) {
  const r = rng(seed);
  return [...text].map((ch) => Math.round(min + r() * (max - min)) + (/[ ,.?!]/.test(ch) ? 20 : 0));
}

export function createHuman(page, stage) {
  let pos = { x: 960, y: 540 };
  async function move(x, y, { steps = 24 } = {}) {
    const from = pos;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps; const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;   // ease-in-out
      const p = { x: from.x + (x - from.x) * e, y: from.y + (y - from.y) * e };
      await page.mouse.move(p.x, p.y); await stage.cursor(p.x, p.y, false); await pause(12);
    }
    pos = { x, y };
  }
  return {
    move,
    async click(locator) {
      const b = await locator.boundingBox();
      await move(b.x + b.width / 2, b.y + b.height / 2);
      await stage.cursor(pos.x, pos.y, true); await pause(120);
      await locator.click();
      await stage.cursor(pos.x, pos.y, false);
    },
    async hover(locator, ms = 0) { const b = await locator.boundingBox(); await move(b.x + b.width / 2, b.y + b.height / 2); await locator.hover(); await pause(ms); },
    async type(locator, text, opts) {
      await locator.focus();
      for (const [i, d] of keyDelays(text, opts).entries()) { await locator.pressSequentially(text[i]); await pause(d); }
    },
    async drag(x1, y1, x2, y2, { steps = 30 } = {}) {
      await move(x1, y1); await page.mouse.down(); await stage.cursor(x1, y1, true);
      for (let i = 1; i <= steps; i++) {
        const x = x1 + (x2 - x1) * i / steps; const y = y1 + (y2 - y1) * i / steps;
        await page.mouse.move(x, y); await stage.cursor(x, y, true); await pause(16);
      }
      await page.mouse.up(); await stage.cursor(x2, y2, false); pos = { x: x2, y: y2 };
    },
  };
}
