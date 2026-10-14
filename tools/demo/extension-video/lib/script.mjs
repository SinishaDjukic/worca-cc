// tools/demo/extension-video/lib/script.mjs — the scripted demo. Selectors follow e2e/extension/*.spec.mjs.
// scenario.json answers the exact PROMPTS typed here; timings are the targets in the plan's table (~2 min).
import { pause } from './human.mjs';

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

export async function caption(stage, step, holdMs = 3800) { await pause(1200); await stage.caption(step); await pause(holdMs); await stage.hideCaption(); await pause(600); }

async function sendAndWait(side, human, text) {
  const input = side.locator('textarea.ask-input');
  await human.click(input);
  await human.type(input, text);
  await pause(500);
  await human.click(side.getByRole('button', { name: 'Send' }));
  await side.getByRole('button', { name: 'Stop' }).waitFor({ timeout: 10_000 }).catch(() => {});
  await side.getByRole('button', { name: 'Send' }).waitFor({ timeout: 45_000 });
}

export async function intro({ stage }) {
  await pause(5200);
  await stage.hideCard();
  await pause(1000);
}

export async function appBeat({ page, human }) {
  await human.move(620, 420, { steps: 40 });
  await pause(900);
  await human.move(760, 520, { steps: 30 });
  await page.evaluate(() => {
    const top = document.getElementById('pricing').getBoundingClientRect().top + window.scrollY - 70;
    window.scrollTo({ top, behavior: 'smooth' });
  });
  await pause(2200);
}

export async function stepAsk({ side, stage, human }) {
  await caption(stage, STEPS[0]);
  await stage.slideSidebarIn();
  await side.locator('textarea.ask-input').waitFor();
  await pause(1200);
  await human.click(side.locator('.wx-page-chip'));
  await pause(1500);
  await sendAndWait(side, human, PROMPTS.ask);
  await pause(3000);
}

export async function stepPinpoint({ page, side, stage, human, command }) {
  await caption(stage, STEPS[1]);
  const box = await page.locator('#team-billed').boundingBox();
  await human.drag(box.x + 2, box.y + box.height / 2, box.x + box.width - 2, box.y + box.height / 2);
  await pause(700);
  await stage.keys(['⌥ Alt', '⇧ Shift', 'W']);
  await command('worca-pinpoint');
  const bar = page.locator('[data-worca-pinpoint] .pp-bar');
  await bar.waitFor();
  await pause(900);
  await human.click(bar.locator('[data-k="explain"]'));
  await page.locator('[data-worca-pinpoint] .pp-pop').waitFor();
  await page.locator('[data-worca-pinpoint] .pp-stop').waitFor({ state: 'detached', timeout: 30_000 }).catch(() => {});
  await pause(3000);
  // The Explain popover replaces the bar; its "Go deeper in chat →" sends the quote to the sidebar as a chip (and
  // drafts a follow-up, which the scripted prompt replaces: scenario.json matches the typed first line).
  await human.click(page.locator('[data-worca-pinpoint] [data-deeper]'));
  await side.locator('.ask-chip-quote').waitFor();
  await pause(1200);
  await side.locator('textarea.ask-input').fill('');
  await sendAndWait(side, human, PROMPTS.pinpoint);
  await pause(3000);
}

export async function stepCapture({ page, side, stage, human, command, setCapture }) {
  await caption(stage, STEPS[2]);
  await stage.keys(['⌥ Alt', '⇧ Shift', 'S']);
  await setCapture();
  await command('worca-capture');
  await page.locator('[data-worca-capture] .wx-cap').waitFor();
  await pause(900);
  const b = await page.locator('.plan--team .plan-cta').boundingBox();
  const pad = 24;
  await human.drag(b.x - pad, b.y - pad, b.x + b.width + pad, b.y + b.height + pad, { steps: 40 });
  const thumb = side.locator('.ask-chip img.ask-chip-thumb');
  await thumb.waitFor({ timeout: 15_000 });
  await pause(600);
  await human.hover(thumb, 1500);
  await sendAndWait(side, human, PROMPTS.capture);
  await pause(3500);
}

export async function stepComposer({ page, side, stage, human, host }) {
  await caption(stage, STEPS[3]);
  const scopeBtn = side.locator('.ask-scope-btn');
  if (!host.actionStarted) {
    // D9: no running Action to auto-pin the scope, so pick the project by hand.
    await human.click(scopeBtn);
    await pause(700);
    await human.click(side.locator('.ask-pop-scope .ask-scope-item', { hasText: 'Acme Pulse' }));
    await pause(700);
  }
  await stage.spot(await scopeBtn.boundingBox());
  await human.hover(scopeBtn, 2500);
  await stage.spot(null);
  await pause(500);
  await human.click(side.locator('.ask-model-btn'));
  const items = side.locator('.ask-pop-model .ask-model-item');
  await items.first().waitFor();
  await pause(600);
  const n = await items.count();
  for (const i of [0, Math.min(1, n - 1)]) await human.hover(items.nth(i), 700);
  await page.keyboard.press('Escape');
  await side.locator('.ask-pop-model').waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
  await pause(600);
  const cost = side.locator('.ask-meter-cost');
  await stage.spot(await cost.boundingBox());
  await human.hover(cost, 1200);
  await stage.spot(null);
  await human.click(side.locator('.ask-ctx-ring'));
  await side.locator('.ask-pop-ctx').waitFor();
  await pause(2500);
  // Neither Esc nor the ring closes this popover: an outside click in the thread does.
  const thread = await side.locator('.ask-msg-assistant').last().boundingBox();
  await human.move(thread.x + thread.width / 2, thread.y + 12);
  await page.mouse.click(thread.x + thread.width / 2, thread.y + 12);
  await side.locator('.ask-pop-ctx').waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
  await pause(1000);
}

export async function outro({ stage }) {
  await stage.hideCaption();
  await stage.card(OUTRO);
  await pause(6000);
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
