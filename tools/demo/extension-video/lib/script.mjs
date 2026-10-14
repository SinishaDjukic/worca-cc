// tools/demo/extension-video/lib/script.mjs — the scripted demo. Selectors follow e2e/extension/*.spec.mjs.
// scenario.json answers the exact PROMPTS typed here. Pacing: no dead stretch over ~1.5 s except while a caption is
// read; captions hide by themselves (captionHoldMs) while the actions go on. The camera (lib/camera.mjs) zooms in on
// what is being read or clicked, and back out to the whole stage when the page and the sidebar both matter.
import { pause } from './human.mjs';
import { unionBox } from './camera.mjs';

export const INTRO = Object.freeze({ title: 'Worca browser extension', sub: 'Ask your own Worca about any page, with the page in context.',
  chips: ['Chrome', 'Edge', 'Firefox'], instant: true });
export const OUTRO = Object.freeze({ title: 'Install it from Settings › Browser extension', sub: 'or run <code>worca extension</code>', chips: [] });

export const STEPS = Object.freeze([
  { id: 'ask', kicker: 'Step 1 of 4', title: 'Ask about any page', sub: 'The page you’re reading comes along as context.' },
  { id: 'pinpoint', kicker: 'Step 2 of 4', title: 'Pinpoint any passage', sub: 'Select text, press ⌥⇧W, ask in place.' },
  { id: 'capture', kicker: 'Step 3 of 4', title: 'Point at the problem', sub: 'Press ⌥⇧S and drag around what looks wrong.' },
  { id: 'composer', kicker: 'Step 4 of 4', title: 'Runs on your own Worca', sub: 'Pinned to the project whose dev server you’re on.' },
]);
export const PROMPTS = Object.freeze({ ask: 'What would you fix first on this pricing page?', pinpoint: 'Fix the annual price', capture: 'fix this' });

/** Zoom levels. The sidebar's body text is 13.5 px: 1.45× reads like ~19.5 px at 1080p. */
export const ZOOM = Object.freeze({ sidebar: 1.45, chip: 1.7, controls: 1.7, meter: 2 });
/** The beat after an answer has rendered, and after a caption appears, before the next action. */
const AFTER_ANSWER_MS = 1100;
const CAPTION_LEAD_MS = 700;

/** How long a caption stays up: about reading time, 250 ms a word + 1 s, at least 2 s. */
export function captionHoldMs({ title = '', sub = '' }) {
  const words = `${title} ${sub}`.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(2000, words * 250 + 1000);
}

/** Show a step's caption (it hides itself after captionHoldMs) and let the step start under it. */
export async function caption(stage, step) {
  await stage.caption(step, captionHoldMs(step));
  await pause(CAPTION_LEAD_MS);
}

/** Keep the camera on a growing box (a streaming answer) until `done()`: refit when it moved, then once at the end. */
async function follow(camera, box, opts, done) {
  let last = null;
  const refit = async () => {
    const b = await box();
    if (!b) return;
    const moved = !last || Math.abs(b.y + b.height / 2 - (last.y + last.height / 2)) > 24 || Math.abs(b.height - last.height) > 48;
    if (moved) { await camera.to(b, opts); last = b; }
  };
  while (!(await done())) { await refit(); await pause(700); }
  await refit();
}

async function sendAndWait(side, human, camera, text) {
  const input = side.locator('textarea.ask-input');
  await camera.to(await input.boundingBox(), { zoom: ZOOM.sidebar });
  await human.click(input);
  await human.type(input, text);
  await pause(250);
  await human.click(side.getByRole('button', { name: 'Send' }));
  await side.getByRole('button', { name: 'Stop' }).waitFor({ timeout: 10_000 }).catch(() => {});
  const answer = side.locator('.ask-msg-assistant').last();
  const send = side.getByRole('button', { name: 'Send' });
  await follow(camera, () => answer.boundingBox(), { zoom: ZOOM.sidebar }, () => send.isVisible());
  await send.waitFor({ timeout: 45_000 });
  await pause(AFTER_ANSWER_MS);
}

export async function intro({ stage }) {
  await pause(3000);
  await stage.hideCard();
  await pause(500);
}

export async function appBeat({ page, human }) {
  await human.move(620, 420, { steps: 30 });
  await pause(250);
  await human.move(760, 520, { steps: 24 });
  await page.evaluate(() => {
    const top = document.getElementById('pricing').getBoundingClientRect().top + window.scrollY - 70;
    window.scrollTo({ top, behavior: 'smooth' });
  });
  await pause(1100);
}

export async function stepAsk({ side, stage, human, camera }) {
  await caption(stage, STEPS[0]);
  await stage.slideSidebarIn();
  await side.locator('textarea.ask-input').waitFor();
  await pause(800);
  const chip = side.locator('.wx-page-chip');
  await camera.to(await chip.boundingBox(), { zoom: ZOOM.sidebar });
  await human.click(chip);
  await pause(700);
  await sendAndWait(side, human, camera, PROMPTS.ask);
}

export async function stepPinpoint({ page, side, stage, human, command, camera }) {
  await camera.full();   // the page and the sidebar both matter while the text is selected
  await caption(stage, STEPS[1]);
  const box = await page.locator('#team-billed').boundingBox();
  await human.drag(box.x + 2, box.y + box.height / 2, box.x + box.width - 2, box.y + box.height / 2);
  await pause(300);
  await stage.keys(['⌥ Alt', '⇧ Shift', 'W']);
  await command('worca-pinpoint');
  const bar = page.locator('[data-worca-pinpoint] .pp-bar');
  await bar.waitFor();
  await camera.to(unionBox(box, await bar.boundingBox()), { maxZoom: 1.6, pad: 60 });
  await pause(700);
  await human.click(bar.locator('[data-k="explain"]'));
  const pop = page.locator('[data-worca-pinpoint] .pp-pop');
  await pop.waitFor();
  const stop = page.locator('[data-worca-pinpoint] .pp-stop');
  await follow(camera, () => pop.boundingBox(), { maxZoom: 1.6, pad: 40 }, async () => (await stop.count()) === 0);
  await pause(AFTER_ANSWER_MS + 600);   // the explanation is longer than the other answers
  // The Explain popover replaces the bar; its "Go deeper in chat →" sends the quote to the sidebar as a chip (and
  // drafts a follow-up, which the scripted prompt replaces: scenario.json matches the typed first line).
  await human.click(page.locator('[data-worca-pinpoint] [data-deeper]'));
  await side.locator('.ask-chip-quote').waitFor();
  await side.locator('textarea.ask-input').fill('');
  await sendAndWait(side, human, camera, PROMPTS.pinpoint);
}

export async function stepCapture({ page, side, stage, human, command, setCapture, camera }) {
  await camera.full();   // the drag happens on the page; the chip lands in the sidebar
  await caption(stage, STEPS[2]);
  await stage.keys(['⌥ Alt', '⇧ Shift', 'S']);
  await setCapture();
  await command('worca-capture');
  await page.locator('[data-worca-capture] .wx-cap').waitFor();
  await pause(400);
  const b = await page.locator('.plan--team .plan-cta').boundingBox();
  const pad = 24;
  const area = { x: b.x - pad, y: b.y - pad, width: b.width + 2 * pad, height: b.height + 2 * pad };
  await human.drag(area.x, area.y, area.x + area.width, area.y + area.height, { steps: 36 });
  await camera.to(area, { maxZoom: 1.8, pad: 80 });   // the captured rectangle
  const thumb = side.locator('.ask-chip img.ask-chip-thumb');
  await thumb.waitFor({ timeout: 15_000 });
  await pause(1000);
  await camera.to(await side.locator('.ask-chip:has(img.ask-chip-thumb)').boundingBox(), { zoom: ZOOM.chip });   // then the attachment chip
  await human.hover(thumb, 1100);
  await sendAndWait(side, human, camera, PROMPTS.capture);
}

export async function stepComposer({ page, side, stage, human, host, camera }) {
  await caption(stage, STEPS[3]);
  const scopeBtn = side.locator('.ask-scope-btn');
  const modelBtn = side.locator('.ask-model-btn');
  const cost = side.locator('.ask-meter-cost');
  const ring = side.locator('.ask-ctx-ring');
  await camera.to(unionBox(await scopeBtn.boundingBox(), await modelBtn.boundingBox(), await cost.boundingBox()), { zoom: ZOOM.controls });
  if (!host.actionStarted) {
    // D9: no running Action to auto-pin the scope, so pick the project by hand.
    await human.click(scopeBtn);
    await pause(500);
    await human.click(side.locator('.ask-pop-scope .ask-scope-item', { hasText: 'Acme Pulse' }));
    await pause(500);
  }
  await stage.spot(await scopeBtn.boundingBox());
  await human.hover(scopeBtn, 1500);
  await stage.spot(null);
  await human.click(modelBtn);
  const items = side.locator('.ask-pop-model .ask-model-item');
  await items.first().waitFor();
  await pause(400);
  const n = await items.count();
  for (const i of [0, Math.min(1, n - 1)]) await human.hover(items.nth(i), 600);
  await page.keyboard.press('Escape');
  await side.locator('.ask-pop-model').waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
  // The cost and context meter, zoomed in. Its context popover would be clipped at the sidebar's left edge, so the
  // camera shows the meter itself instead of opening it.
  const meter = unionBox(await cost.boundingBox(), await ring.boundingBox());
  await camera.to(meter, { zoom: ZOOM.meter });
  await stage.spot(meter);
  await human.hover(cost, 900);
  await human.hover(ring, 900);
  await stage.spot(null);
}

export async function outro({ stage, camera }) {
  await stage.hideCaption();
  await camera.full();
  await pause(300);
  await stage.card(OUTRO);
  await pause(3200);
}

export async function run(env) {
  await intro(env);
  await appBeat(env);
  await stepAsk(env);
  await stepPinpoint(env);
  await stepCapture(env);
  await stepComposer(env);
  await outro(env);
}
