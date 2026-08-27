#!/usr/bin/env node
/* build-standalone.mjs — headless "bundle a deck into one file", for agents.
 * ─────────────────────────────────────────────────────────────────────────
 * The deck-export.js bundler runs in the BROWSER and needs the deck served
 * over http(s). This is the same job done HEADLESSLY from disk — no browser,
 * no server — so an agent can run it wherever the deck's files sit together
 * on a filesystem (the Claude web app's code sandbox, a local checkout, CI).
 * It inlines every local <script>, the baked narration audio, same-origin
 * stylesheets + their url() assets, <img> sources, and the Google fonts into
 * ONE self-contained .html.
 *
 * TWO MODES (the only difference is whether authoring stays on):
 *   • publish (default) → final share-ready file: Studio removed, audio baked.
 *   • preview (--preview / --keep-studio) → keeps the Studio live, so it's the
 *     file to open while you're still tuning the deck — and the right
 *     deliverable in single-file environments (e.g. the Claude web app), where
 *     the multi-file deck can't load its companion scripts and shows blank.
 *
 * USAGE:
 *   node build-standalone.mjs [deck.html] [--preview] [--out FILE]
 *
 *   deck.html   the deck to bundle. Optional — if omitted, the only *.html in
 *               the current folder that mounts a <deck-stage> is used.
 *   --preview   keep the Studio (a "preview" build). Alias: --keep-studio.
 *   --out FILE  output path. Default: <deck>.standalone.html (publish) or
 *               <deck>.preview.html (preview).
 *
 * Requires Node 18+ (global fetch, for embedding the Google fonts; if the
 * network is unavailable the fonts stay as a CDN <link> and the build still
 * succeeds). Zero npm dependencies.
 */
import { readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve, basename, extname, join } from "node:path";

const AUDIO_SRC = "narration-audio.js";

function log(s) { process.stderr.write("[build] " + s + "\n"); }
function isRemote(u) { return /^(https?:)?\/\//.test(u) || /^data:/i.test(u); }

function mimeFor(url) {
  const ext = (url.split("?")[0].split("#")[0].split(".").pop() || "").toLowerCase();
  return ({
    woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", otf: "font/otf",
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
    webp: "image/webp", avif: "image/avif", svg: "image/svg+xml",
  })[ext] || "application/octet-stream";
}

// Resolve a local href against the deck's folder; return its absolute path.
function localPath(baseDir, href) { return resolve(baseDir, href.split("?")[0].split("#")[0]); }

async function readMaybe(p) { try { return await readFile(p); } catch { return null; } }
async function dataUrl(baseDir, href) {
  const buf = await readFile(localPath(baseDir, href));
  return "data:" + mimeFor(href) + ";base64," + buf.toString("base64");
}

// Mark the output as a published standalone, BEFORE deck-narration.js runs, so
// it hides the authoring Studio (and Narrate/Auto-play when no audio is baked).
function markExported(html) {
  const flag = "<script>window.__DECK_EXPORTED=true;<\/script>\n";
  const narrTag = '<script src="deck-narration.js"></script>';
  if (html.includes(narrTag)) return html.split(narrTag).join(flag + narrTag);
  return html.replace(/<\/head>/i, flag + "</head>");
}

// Activate the baked-audio include if narration-audio.js is present next to the deck.
async function bakeAudio(html, baseDir) {
  const audio = await readMaybe(join(baseDir, AUDIO_SRC));
  if (!audio || !audio.toString("utf8").includes("__NARRATION_AUDIO")) {
    log("• " + AUDIO_SRC + " not found → bundling without baked audio");
    return html;
  }
  log("• " + AUDIO_SRC + " found → baking voiceover in");
  return html
    .split('<!-- <script src="' + AUDIO_SRC + '"></script> -->')
    .join('<script src="' + AUDIO_SRC + '"></script>');
}

// Inline every LOCAL <script src="…">; neutralize any </script in the code so
// the inline block isn't closed early.
async function inlineScripts(html, baseDir) {
  const re = /<script src="([^"]+)"><\/script>/g;
  const hits = [];
  let m;
  while ((m = re.exec(html)) !== null) hits.push({ full: m[0], src: m[1] });
  for (const hit of hits) {
    if (isRemote(hit.src)) continue;
    const buf = await readMaybe(localPath(baseDir, hit.src));
    if (!buf) { log("  ! skipped " + hit.src + " (not found)"); continue; }
    const code = buf.toString("utf8").replace(/<\/script/gi, "<\\/script");
    html = html.split(hit.full).join("<script>\n" + code + "\n<\/script>");
    log("  + inlined " + hit.src);
  }
  return html;
}

// Embed same-origin url(...) assets inside a CSS string as data URLs.
async function embedCssUrls(css, baseDir) {
  const refs = [];
  css.replace(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g, (_, u) => { refs.push(u); return _; });
  const seen = new Set();
  for (const u of refs) {
    if (seen.has(u) || isRemote(u) || u.charAt(0) === "#") continue;
    seen.add(u);
    try { css = css.split(u).join(await dataUrl(baseDir, u)); } catch { /* leave as-is */ }
  }
  return css;
}

// Inline same-origin stylesheet <link>s as <style> (embedding their url() assets).
async function inlineStylesheets(html, baseDir) {
  const tags = html.match(/<link\b[^>]*>/gi) || [];
  for (const tag of tags) {
    if (!/rel=["']?stylesheet/i.test(tag)) continue;
    const hm = tag.match(/href="([^"]+)"/i);
    if (!hm || isRemote(hm[1])) continue;
    const buf = await readMaybe(localPath(baseDir, hm[1]));
    if (!buf) { log("• stylesheet skipped " + hm[1] + " (not found)"); continue; }
    const css = await embedCssUrls(buf.toString("utf8"), baseDir);
    html = html.split(tag).join("<style>\n" + css + "\n</style>");
    log("• inlined stylesheet " + hm[1]);
  }
  return html;
}

// Embed the Google Fonts CSS + its woff2 files as base64 (best-effort, needs net).
async function embedFonts(html) {
  const linkRe = /<link[^>]+href="(https:\/\/fonts\.googleapis\.com\/css2[^"]+)"[^>]*>/;
  const m = html.match(linkRe);
  if (!m) return html;
  try {
    // A browser UA makes Google serve woff2 (vs ttf).
    const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
    let css = await (await fetch(m[1], { headers: { "User-Agent": ua } })).text();
    const urls = css.match(/https:\/\/[^)"']+\.woff2/g) || [];
    for (const u of urls) {
      const buf = Buffer.from(await (await fetch(u)).arrayBuffer());
      css = css.split(u).join("data:font/woff2;base64," + buf.toString("base64"));
    }
    html = html.replace(/<link rel="preconnect"[^>]*>\s*/g, "");
    html = html.replace(linkRe, "<style>\n" + css + "\n</style>");
    log("• fonts embedded (" + urls.length + " files)");
  } catch (e) {
    log("• font embed skipped (" + e.message + ") — keeps the CDN link + system fallback");
  }
  return html;
}

// Inline same-origin <img src="…"> as base64 data URLs.
async function inlineImages(html, baseDir) {
  const re = /<img\b[^>]*\bsrc="([^"]+)"[^>]*>/gi;
  const srcs = [];
  let m;
  while ((m = re.exec(html)) !== null) srcs.push(m[1]);
  const seen = new Set();
  let n = 0;
  for (const src of srcs) {
    if (seen.has(src) || isRemote(src)) continue;
    seen.add(src);
    try { html = html.split('src="' + src + '"').join('src="' + (await dataUrl(baseDir, src)) + '"'); n++; }
    catch { log("• image skipped " + src + " (not found)"); }
  }
  if (n) log("• embedded " + n + " image" + (n === 1 ? "" : "s"));
  return html;
}

// Find the deck .html in a folder: the only one mounting a <deck-stage>.
async function autodetectDeck(dir) {
  const files = (await readdir(dir)).filter((f) => /\.html?$/i.test(f));
  const matches = [];
  for (const f of files) {
    const txt = (await readFile(join(dir, f), "utf8"));
    if (/<deck-stage\b/.test(txt) || /component-from-global-scope="deck-stage"/.test(txt)) matches.push(f);
  }
  if (matches.length === 1) return join(dir, matches[0]);
  if (matches.length === 0) throw new Error("no deck (.html with <deck-stage>) found in " + dir);
  throw new Error("multiple decks found (" + matches.join(", ") + ") — pass one explicitly");
}

async function main() {
  const argv = process.argv.slice(2);
  const preview = argv.includes("--preview") || argv.includes("--keep-studio");
  const outIdx = argv.indexOf("--out");
  const outArg = outIdx !== -1 ? argv[outIdx + 1] : null;
  const deckArg = argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--out");

  const deckPath = deckArg ? resolve(deckArg) : await autodetectDeck(process.cwd());
  const baseDir = dirname(deckPath);
  log((preview ? "preview" : "publish") + " build of " + basename(deckPath));

  let html = await readFile(deckPath, "utf8");
  html = await bakeAudio(html, baseDir);
  if (preview) log("• preview build — Studio kept (not marked as published)");
  else html = markExported(html);
  html = await inlineScripts(html, baseDir);
  html = await inlineStylesheets(html, baseDir);
  html = await embedFonts(html);
  html = await inlineImages(html, baseDir);

  const stem = basename(deckPath).replace(/\.html?$/i, "");
  const out = outArg ? resolve(outArg) : join(baseDir, stem + (preview ? ".preview" : ".standalone") + ".html");
  await writeFile(out, html);
  const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
  log("✓ wrote " + out + " (" + kb + " KB)" + (preview ? " — Studio kept" : " — ready to share"));
  process.stdout.write(out + "\n");
}

main().catch((e) => { log("✗ " + e.message); process.exit(1); });
