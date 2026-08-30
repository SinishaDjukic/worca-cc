/* deck-export.js — in-browser "Save as standalone HTML" for a OpenDeck.
 * ─────────────────────────────────────────────────────────────────────────
 * Runs entirely in the browser — no build step, no Python, no install. It
 * fetches the deck's own source file and inlines everything into ONE
 * self-contained .html that opens offline, on any machine, with no companion
 * files and no API key:
 *
 *   • every local <script src="…">   → inlined <script>…</script>
 *   • every local stylesheet <link>  → inlined <style>, with its url() fonts
 *                                       and images embedded as base64
 *   • every local <img src="…">      → embedded as a base64 data URL
 *   • the baked narration audio       → inlined (auto-detected, see below)
 *   • the Google Fonts <link>         → fetched + embedded as base64 @font-face
 *
 * USAGE (from the browser dev console, after the deck has loaded):
 *   deckExport.preview()      → builds a single self-contained file that KEEPS
 *                               the Studio (open/preview it anywhere, keep
 *                               authoring) and downloads it
 *   deckExport.publish()      → builds the final share-ready file (Studio
 *                               removed, audio baked) and downloads it
 *   deckExport.standalone()   → alias of publish() (back-compat)
 *   deckExport.build(opts)    → returns the bundled HTML string (no download);
 *                               pass { preview: true } to keep the Studio
 *
 * PREVIEW vs PUBLISH: both inline everything into ONE file. A *preview* leaves
 * the authoring Studio live, so it's the file to look at while you're still
 * tuning the deck (and the right deliverable in single-file environments like
 * the Claude web app, where the multi-file deck can't load its siblings). A
 * *publish* sets window.__DECK_EXPORTED, hiding the Studio button — and, when
 * no audio was baked, the Narrate + Auto-play buttons too — for the final
 * file you share.
 *
 * AUDIO: generate narration in the Studio (deckNarration.studio()), click
 * "Download audio" to get narration-audio.js, and drop that file next to the
 * deck. The bundler auto-detects it — present → bakes the voiceover in;
 * absent → bundles without it. You do NOT need to uncomment the audio
 * <script> tag first; the bundler activates it for you.
 *
 * NOTE: this fetches same-origin files, so the deck must be served over
 * http(s) (e.g. a local server), not opened via file://. Inside a Claude
 * design project, the project's native "Save as standalone HTML" does the
 * same job — use whichever fits where you're building.
 */
(function () {
  "use strict";

  var AUDIO_SRC = "narration-audio.js";

  function abs(u) { return new URL(u, location.href).href; }

  async function fetchText(url) {
    var r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(r.status + " " + url);
    return r.text();
  }

  // Chunked base64 so large font blobs don't overflow the call stack.
  function bytesToB64(bytes) {
    var bin = "", chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }

  function mimeFor(url) {
    var ext = (url.split("?")[0].split("#")[0].split(".").pop() || "").toLowerCase();
    return ({
      woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", otf: "font/otf",
      jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
      webp: "image/webp", avif: "image/avif", svg: "image/svg+xml"
    })[ext] || "application/octet-stream";
  }

  function isRemote(u) { return /^(https?:)?\/\//.test(u) || /^data:/i.test(u); }

  // Fetch a same-origin asset → "data:<mime>;base64,…".
  async function toDataUrl(url) {
    var buf = await (await fetch(url, { cache: "no-store" })).arrayBuffer();
    return "data:" + mimeFor(url) + ";base64," + bytesToB64(new Uint8Array(buf));
  }

  // Mark the output as an exported standalone, BEFORE deck-narration.js runs.
  // deck-narration reads window.__DECK_EXPORTED to hide the authoring Studio
  // button, and (when no audio was baked) the Narrate + Auto-play controls too.
  function markExported(html) {
    var flag = "<script>window.__DECK_EXPORTED=true;<\/script>\n";
    var narrTag = "<script src=\"deck-narration.js\"></script>";
    if (html.indexOf(narrTag) !== -1) return html.split(narrTag).join(flag + narrTag);
    return html.replace(/<\/head>/i, flag + "</head>");
  }

  // 1) Activate + inline the baked-audio file if it's reachable next to the deck.
  async function bakeAudio(html, log) {
    var found = false;
    try {
      var probe = await fetch(abs(AUDIO_SRC), { cache: "no-store" });
      found = probe.ok && (await probe.text()).indexOf("__NARRATION_AUDIO") !== -1;
    } catch (e) { found = false; }

    if (!found) {
      log("• " + AUDIO_SRC + " not found → bundling without baked audio (Narrate + Auto-play hidden)");
      return html;
    }
    log("• " + AUDIO_SRC + " found → baking voiceover in");
    // Un-comment the optional include so the script-inliner picks it up.
    return html
      .split("<!-- <script src=\"" + AUDIO_SRC + "\"></script> -->")
      .join("<script src=\"" + AUDIO_SRC + "\"></script>");
  }

  // 2) Inline every LOCAL <script src="…"></script> (skip absolute / CDN URLs).
  async function inlineScripts(html, log) {
    var re = /<script src="([^"]+)"><\/script>/g, m, hits = [];
    while ((m = re.exec(html)) !== null) hits.push({ full: m[0], src: m[1] });
    for (var i = 0; i < hits.length; i++) {
      var src = hits[i].src;
      if (/^(https?:)?\/\//.test(src)) continue; // leave CDN scripts as links
      try {
        var code = await fetchText(abs(src));
        // Neutralize any literal </script> inside the code (e.g. in doc-comments),
        // which would otherwise close the inline block early and corrupt the file.
        code = code.replace(/<\/script/gi, "<\\/script");
        html = html.split(hits[i].full).join("<script>\n" + code + "\n<\/script>");
        log("  + inlined " + src);
      } catch (e) {
        log("  ! skipped " + src + " (" + e.message + ")");
      }
    }
    return html;
  }

  // 3) Embed the Google Fonts CSS + woff2 files as base64 (best-effort).
  async function embedFonts(html, log) {
    var linkRe = /<link[^>]+href="(https:\/\/fonts\.googleapis\.com\/css2[^"]+)"[^>]*>/;
    var m = html.match(linkRe);
    if (!m) return html;
    try {
      var css = await fetchText(m[1]); // a browser UA → Google serves woff2
      var urls = (css.match(/https:\/\/[^)"']+\.woff2/g) || []);
      for (var i = 0; i < urls.length; i++) {
        var buf = await (await fetch(urls[i])).arrayBuffer();
        var b64 = bytesToB64(new Uint8Array(buf));
        css = css.split(urls[i]).join("data:font/woff2;base64," + b64);
      }
      html = html.replace(/<link rel="preconnect"[^>]*>\s*/g, "");
      html = html.replace(linkRe, "<style>\n" + css + "\n</style>");
      log("• fonts embedded (" + urls.length + " files)");
    } catch (e) {
      log("• font embed skipped (" + e.message + ") — keeps the CDN link + system fallback");
    }
    return html;
  }

  // 4) Embed same-origin url(...) assets (fonts, images) inside a CSS string.
  async function embedCssUrls(css, baseUrl) {
    var refs = [];
    css.replace(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g, function (_, u) { refs.push(u); return _; });
    var seen = {};
    for (var i = 0; i < refs.length; i++) {
      var u = refs[i];
      if (seen[u] || isRemote(u) || u.charAt(0) === "#") continue;
      seen[u] = 1;
      try { css = css.split(u).join(await toDataUrl(new URL(u, baseUrl).href)); }
      catch (e) { /* leave the reference as-is */ }
    }
    return css;
  }

  // 5) Inline same-origin stylesheet <link>s as <style>, embedding their url()
  //    fonts/images. CDN / Google-Fonts links are left for embedFonts.
  async function inlineStylesheets(html, log) {
    var re = /<link\b[^>]*>/gi, m, tags = [];
    while ((m = re.exec(html)) !== null) tags.push(m[0]);
    for (var i = 0; i < tags.length; i++) {
      var tag = tags[i];
      if (!/rel=["']?stylesheet/i.test(tag)) continue;
      var hm = tag.match(/href="([^"]+)"/i);
      if (!hm || isRemote(hm[1])) continue;
      try {
        var css = await embedCssUrls(await fetchText(abs(hm[1])), abs(hm[1]));
        html = html.split(tag).join("<style>\n" + css + "\n</style>");
        log("• inlined stylesheet " + hm[1]);
      } catch (e) { log("• stylesheet skipped " + hm[1] + " (" + e.message + ")"); }
    }
    return html;
  }

  // 6) Inline same-origin <img src="…"> as base64 data URLs.
  async function inlineImages(html, log) {
    var re = /<img\b[^>]*\bsrc="([^"]+)"[^>]*>/gi, m, srcs = [], seen = {}, n = 0;
    while ((m = re.exec(html)) !== null) srcs.push(m[1]);
    for (var i = 0; i < srcs.length; i++) {
      var src = srcs[i];
      if (seen[src] || isRemote(src)) continue;
      seen[src] = 1;
      try {
        html = html.split('src="' + src + '"').join('src="' + (await toDataUrl(abs(src))) + '"');
        n++;
      } catch (e) { log("• image skipped " + src + " (" + e.message + ")"); }
    }
    if (n) log("• embedded " + n + " image" + (n === 1 ? "" : "s"));
    return html;
  }

  async function build(opts) {
    opts = opts || {};
    var log = opts.quiet ? function () {} : function (s) { console.log("%c[deckExport]%c " + s, "color:#c75b39;font-weight:700", ""); };
    var html = await fetchText(location.href);   // the deck's pristine source
    html = await bakeAudio(html, log);
    if (opts.preview) log("• preview build — Studio kept (not marked as published)");
    else html = markExported(html);              // publish: hide authoring controls
    html = await inlineScripts(html, log);
    html = await inlineStylesheets(html, log);   // same-origin <link> + its url() assets
    html = await embedFonts(html, log);          // remote Google-Fonts <link>
    html = await inlineImages(html, log);        // same-origin <img>
    return html;
  }

  function outName(suffix) {
    var file = (location.pathname.split("/").pop() || "deck.html");
    return file.replace(/\.html?$/i, "") + "." + suffix + ".html";
  }

  function downloadHtml(html, name) {
    var blob = new Blob([html], { type: "text/html" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    return { name: name, bytes: blob.size };
  }

  // Final share-ready file: Studio removed, audio baked.
  async function publish() {
    var html = await build();
    var r = downloadHtml(html, outName("standalone"));
    var mb = (r.bytes / 1048576).toFixed(1);
    console.log("%c[deckExport]%c ✓ published " + r.name + " (" + mb + " MB) — ready to share", "color:#c75b39;font-weight:700", "");
    return r;
  }

  // Single self-contained file that KEEPS the Studio — for previewing while
  // you author, and the right deliverable in single-file environments.
  async function preview() {
    var html = await build({ preview: true });
    var r = downloadHtml(html, outName("preview"));
    var mb = (r.bytes / 1048576).toFixed(1);
    console.log("%c[deckExport]%c ✓ preview built " + r.name + " (" + mb + " MB) — Studio kept", "color:#c75b39;font-weight:700", "");
    return r;
  }

  // Back-compat alias — publish() is the final file.
  var standalone = publish;

  // ── .deck packaging ───────────────────────────────────────────────────────
  // A .deck is a Zip whose root holds deck.json (manifest) + index.html (the
  // standalone export above). It opens in a compatible deck player app.
  // Packaged with a tiny store-only (no-compression) Zip writer so the kit
  // stays zero-dependency — the player unzips it with fflate.

  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  // entries: [{ name, data: Uint8Array }] → Uint8Array of a valid .zip
  function zipStore(entries) {
    var enc = new TextEncoder();
    var body = [], central = [], offset = 0;

    entries.forEach(function (e) {
      var name = enc.encode(e.name), data = e.data, crc = crc32(data), len = data.length;

      var lh = new Uint8Array(30 + name.length);
      var lv = new DataView(lh.buffer);
      lv.setUint32(0, 0x04034b50, true);    // local file header sig
      lv.setUint16(4, 20, true);            // version needed
      lv.setUint16(8, 0, true);             // method: 0 = store
      lv.setUint16(12, 0x21, true);         // mod date = 1980-01-01
      lv.setUint32(14, crc, true);
      lv.setUint32(18, len, true);          // compressed size
      lv.setUint32(22, len, true);          // uncompressed size
      lv.setUint16(26, name.length, true);  // file name length
      lh.set(name, 30);
      body.push(lh, data);

      var ch = new Uint8Array(46 + name.length);
      var cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true);    // central dir header sig
      cv.setUint16(4, 20, true);            // version made by
      cv.setUint16(6, 20, true);            // version needed
      cv.setUint16(14, 0x21, true);         // mod date
      cv.setUint32(16, crc, true);
      cv.setUint32(20, len, true);
      cv.setUint32(24, len, true);
      cv.setUint16(28, name.length, true);
      cv.setUint32(42, offset, true);       // offset of local header
      ch.set(name, 46);
      central.push(ch);

      offset += lh.length + data.length;
    });

    var centralSize = central.reduce(function (a, c) { return a + c.length; }, 0);
    var eocd = new Uint8Array(22);
    var ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);      // end of central dir sig
    ev.setUint16(8, entries.length, true);  // entries on this disk
    ev.setUint16(10, entries.length, true); // total entries
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);         // central dir offset

    var all = body.concat(central, [eocd]);
    var total = all.reduce(function (a, c) { return a + c.length; }, 0);
    var out = new Uint8Array(total), p = 0;
    all.forEach(function (c) { out.set(c, p); p += c.length; });
    return out;
  }

  function slug(s) {
    return (s || "deck").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "deck";
  }

  function deckManifest() {
    var labelEl = document.querySelector("[data-label]");
    var title = ((document.title || "").trim())
      || (labelEl && labelEl.getAttribute("data-label"))
      || "Untitled Deck";
    var file = (location.pathname.split("/").pop() || "deck").replace(/\.(dc\.)?html?$/i, "");
    return {
      schema: 1,
      id: slug(file) || slug(title),
      title: title,
      entry: "index.html",
      orientation: "landscape",   // deck-stage renders 1920×1080
      author: "",
      version: "1.0.0"
    };
  }

  // Optional preview thumbnail, baked into the .deck and recorded as
  // manifest.thumbnail so player libraries can show a preview. Two sources,
  // checked in order:
  //   1) opts.thumbnail — a "data:" URL string, or { name, data: Uint8Array }.
  //   2) a conventional file sitting next to the deck (mirrors the audio flow):
  //      thumbnail.png / .jpg / .jpeg / .webp / .svg.
  // Absent → the .deck simply ships without one (the field is optional).
  var THUMB_CANDIDATES = ["thumbnail.png", "thumbnail.jpg", "thumbnail.jpeg", "thumbnail.webp", "thumbnail.svg"];

  function extForMime(mime) {
    if (/png/i.test(mime)) return "png";
    if (/jpe?g/i.test(mime)) return "jpg";
    if (/webp/i.test(mime)) return "webp";
    if (/svg/i.test(mime)) return "svg";
    return "png";
  }

  function dataUrlToBytes(url) {
    var comma = url.indexOf(",");
    var head = url.slice(0, comma);
    var raw = url.slice(comma + 1);
    if (/;base64/i.test(head)) {
      var bin = atob(raw);
      var out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    return new TextEncoder().encode(decodeURIComponent(raw));
  }

  async function collectThumbnail(opts, log) {
    var t = opts.thumbnail;
    if (typeof t === "string" && /^data:/i.test(t)) {
      var mime = t.slice(5, t.indexOf(","));
      var name = "thumbnail." + extForMime(mime);
      log("• thumbnail from opts (data URL) → " + name);
      return { name: name, data: dataUrlToBytes(t) };
    }
    if (t && t.data) {
      log("• thumbnail from opts → " + (t.name || "thumbnail.png"));
      return { name: t.name || "thumbnail.png", data: t.data };
    }
    for (var i = 0; i < THUMB_CANDIDATES.length; i++) {
      try {
        var r = await fetch(abs(THUMB_CANDIDATES[i]), { cache: "no-store" });
        if (r.ok) {
          log("• " + THUMB_CANDIDATES[i] + " found → adding to package");
          return { name: THUMB_CANDIDATES[i], data: new Uint8Array(await r.arrayBuffer()) };
        }
      } catch (e) { /* keep probing */ }
    }
    log("• no thumbnail found (drop a thumbnail.png next to the deck to add one)");
    return null;
  }

  // Build the standalone HTML, wrap it as a .deck package, and download it.
  async function deck(opts) {
    opts = opts || {};
    var log = opts.quiet ? function () {} : function (s) { console.log("%c[deckExport]%c " + s, "color:#c75b39;font-weight:700", ""); };
    var html = await build({ quiet: opts.quiet });
    var manifest = Object.assign(deckManifest(), opts.manifest || {});
    var thumb = await collectThumbnail(opts, log);
    if (thumb) manifest.thumbnail = thumb.name;
    var enc = new TextEncoder();
    var entries = [
      { name: "deck.json", data: enc.encode(JSON.stringify(manifest, null, 2)) },
      { name: "index.html", data: enc.encode(html) }
    ];
    if (thumb) entries.push({ name: thumb.name, data: thumb.data });
    var zip = zipStore(entries);
    var blob = new Blob([zip], { type: "application/x-deck" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = manifest.id + ".deck";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    var mb = (blob.size / 1048576).toFixed(1);
    log("✓ downloaded " + a.download + " (" + mb + " MB) — open it in a compatible deck player app");
    return { name: a.download, bytes: blob.size, manifest: manifest };
  }

  window.deckExport = { preview: preview, publish: publish, standalone: standalone, build: build, deck: deck };

  // Print the hint once, alongside the narration Studio hint.
  try {
    console.log("%c[deckExport]%c run %cdeckExport.preview()%c for a single file that keeps the Studio, %cdeckExport.publish()%c for the final share-ready .html, or %cdeckExport.deck()%c to package a portable .deck file",
      "color:#c75b39;font-weight:700", "", "font-weight:700", "", "font-weight:700", "", "font-weight:700", "");
  } catch (e) {}
})();
