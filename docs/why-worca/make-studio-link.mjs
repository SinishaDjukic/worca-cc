#!/usr/bin/env node
/* make-studio-link.mjs — build a hosted Audio Studio link from a deck's script.
 * ─────────────────────────────────────────────────────────────────────────
 * Narration audio can't be generated inside the Claude web app's deck preview
 * (its CSP blocks the ElevenLabs call). The hosted Studio at open-deck.org/studio
 * can — its page allows that one connection. This prints a link to that page
 * with the deck's narration pre-loaded in the URL #fragment (which never hits
 * the server). The user opens it in a normal browser, enters their ElevenLabs
 * key, generates, and downloads narration-audio.js to hand back for publishing.
 *
 * USAGE:
 *   node make-studio-link.mjs [narration-script.js]
 *
 *   Reads narration-script.js (default) or a .json file holding the __NARRATION
 *   object. Prints the link to stdout; a one-line summary + the raw JSON (for a
 *   paste fallback) go to stderr.
 *
 * Requires Node 18+. Zero dependencies.
 */
import { readFile } from "node:fs/promises";
import { createContext, runInContext } from "node:vm";
import { basename } from "node:path";

const BASE = "https://open-deck.org/studio/";

const file = process.argv[2] || "narration-script.js";

function err(msg) { process.stderr.write("[studio-link] " + msg + "\n"); }

async function loadScript(path) {
  const text = await readFile(path, "utf8");
  if (path.endsWith(".json")) return JSON.parse(text);
  // narration-script.js sets window.__NARRATION — run it with a window shim.
  // Safe here: it's the deck's own script, run in an isolated VM context with
  // no Node globals exposed.
  const ctx = { window: {} };
  createContext(ctx);
  runInContext(text, ctx, { timeout: 1000 });
  return ctx.window.__NARRATION;
}

const script = await loadScript(file).catch((e) => { err("✗ couldn't read " + file + " — " + e.message); process.exit(1); });
if (!script || !Array.isArray(script.slides)) {
  err("✗ no __NARRATION.slides found in " + basename(file));
  process.exit(1);
}

// Keep only what the Studio needs (text + keying + optional voice/model).
const payload = {
  voiceId: script.voiceId || "",
  modelId: script.modelId || "eleven_multilingual_v2",
  slides: script.slides.map((s) => ({ lines: (s.lines || []).map((l) => l == null ? "" : String(l)) })),
};

const json = JSON.stringify(payload);
const frag = Buffer.from(json, "utf8").toString("base64url");
const url = BASE + "#" + frag;

const cues = payload.slides.reduce((n, s) => n + s.lines.filter((l) => l.trim()).length, 0);
err(payload.slides.length + " slides, " + cues + " narrated lines · link is " + url.length + " chars");
if (url.length > 60000) err("⚠ link is long; if the browser rejects it, have the user paste the JSON below instead.");
err("paste-fallback JSON: " + json);

process.stdout.write(url + "\n");
