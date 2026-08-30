/* deck-narration.js
 * Adds voiceover narration on top of <deck-stage> + deck-enhance.js.
 *
 * Three playback modes (all from the on-screen control bar):
 *   • Auto-play  — press Play; it reveals each step, plays its clip, and
 *                  advances automatically when the clip ends.
 *   • Manual + narration — step with ←/→ or clicks; each step plays its clip.
 *   • Manual, silent — narration toggled off; behaves exactly like before.
 *
 * Audio sources, in priority order:
 *   1. window.__NARRATION_AUDIO  — a baked { "si:step": "data:audio/…" } map
 *      (used by the standalone/offline export; plays with no key, anywhere).
 *   2. IndexedDB cache            — clips generated in-browser via ElevenLabs
 *      from the Audio panel; persist across reloads on this machine.
 *
 * Generation never leaves the browser: the ElevenLabs key is entered into the
 * page, used for direct API calls, and (optionally) kept only in sessionStorage.
 */
(function () {
  "use strict";

  var SCRIPT = window.__NARRATION || { slides: [] };
  var BAKED = window.__NARRATION_AUDIO || null;
  var GAP_MS = Math.round((SCRIPT.gapSeconds != null ? SCRIPT.gapSeconds : 0.5) * 1000);
  var MODEL_ID = SCRIPT.modelId || "eleven_multilingual_v2";

  var LS_NARR = "deck-narration.on";
  var SS_KEY = "deck-narration.elevenKey";
  var SS_VOICE = "deck-narration.voiceId";

  // ---- small helpers ----------------------------------------------------
  function $(tag, attrs, kids) {
    var el = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === "style") el.style.cssText = attrs[k];
      else if (k === "html") el.innerHTML = attrs[k];
      else if (k === "text") el.textContent = attrs[k];
      else el.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c) el.appendChild(c); });
    return el;
  }
  function cueKey(si, step) { return si + ":" + step; }
  function lineFor(si, step) {
    var s = SCRIPT.slides[si];
    if (!s || !s.lines) return "";
    return (s.lines[step] || "").trim();
  }

  // ---- IndexedDB clip store --------------------------------------------
  // cacheBlocked = true when this browser won't persist clips between reloads
  // (notably Safari, and Firefox with cookies off, when opened from file://).
  // Generation still works; the clips just live only in memory for the session,
  // so the user must Download audio before reloading or they'll regenerate.
  var DB = null, cacheBlocked = false;
  function openDB() {
    return new Promise(function (res) {
      try {
        var rq = indexedDB.open("deckNarration", 1);
        rq.onupgradeneeded = function () {
          var db = rq.result;
          if (!db.objectStoreNames.contains("clips")) db.createObjectStore("clips");
        };
        rq.onsuccess = function () { DB = rq.result; res(DB); };
        rq.onerror = function () { cacheBlocked = true; res(null); };
      } catch (e) { cacheBlocked = true; res(null); }
    });
  }
  function idbPut(key, val) {
    return new Promise(function (res) {
      if (!DB) return res(false);
      try {
        var tx = DB.transaction("clips", "readwrite");
        tx.objectStore("clips").put(val, key);
        tx.oncomplete = function () { res(true); };
        tx.onerror = function () { res(false); };
      } catch (e) { res(false); }
    });
  }
  function idbGetAll() {
    return new Promise(function (res) {
      if (!DB) return res({});
      try {
        var tx = DB.transaction("clips", "readonly");
        var store = tx.objectStore("clips");
        var out = {};
        var ck = store.openCursor();
        ck.onsuccess = function (e) {
          var cur = e.target.result;
          if (cur) { out[cur.key] = cur.value; cur.continue(); }
          else res(out);
        };
        ck.onerror = function () { res({}); };
      } catch (e) { res({}); }
    });
  }
  function idbClear() {
    return new Promise(function (res) {
      if (!DB) return res();
      try {
        var tx = DB.transaction("clips", "readwrite");
        tx.objectStore("clips").clear();
        tx.oncomplete = function () { res(); };
        tx.onerror = function () { res(); };
      } catch (e) { res(); }
    });
  }

  // clips[cue] = { url, voiceId } ; built from baked map + IndexedDB
  var clips = {};
  function hasClip(cue) { return !!clips[cue]; }
  function clipUrl(cue) { return clips[cue] && clips[cue].url; }

  function loadBaked() {
    if (!BAKED) return;
    Object.keys(BAKED).forEach(function (cue) {
      clips[cue] = { url: BAKED[cue], voiceId: "baked", baked: true };
    });
  }
  function loadCache() {
    return idbGetAll().then(function (all) {
      Object.keys(all).forEach(function (key) {
        // key format: "voiceId|si:step"
        var bar = key.indexOf("|");
        if (bar < 0) return;
        var cue = key.slice(bar + 1);
        var rec = all[key];
        if (!rec || !rec.blob) return;
        if (clips[cue] && clips[cue].baked) return; // baked wins
        // Only use if the cached text still matches the current script
        var si = parseInt(cue.split(":")[0], 10);
        var step = parseInt(cue.split(":")[1], 10);
        if (rec.text != null && rec.text !== lineFor(si, step)) return;
        clips[cue] = { url: URL.createObjectURL(rec.blob), voiceId: key.slice(0, bar) };
      });
    });
  }

  // ---- enumerate every cue that has a script line ----------------------
  function allCues() {
    var out = [];
    (SCRIPT.slides || []).forEach(function (s, si) {
      (s.lines || []).forEach(function (txt, step) {
        if ((txt || "").trim()) out.push({ si: si, step: step, text: txt.trim() });
      });
    });
    return out;
  }

  // =====================================================================
  function run(stage) {
    if (window.__deckNarrationRan) return;
    window.__deckNarrationRan = true;

    function slides() {
      return Array.prototype.filter.call(stage.children, function (c) { return c.tagName === "SECTION"; });
    }
    var curIdx = 0;
    stage.addEventListener("slidechange", function (e) {
      if (e.detail && typeof e.detail.index === "number") curIdx = e.detail.index;
    });
    window.addEventListener("message", function (e) {
      if (e.data && typeof e.data.slideIndexChanged === "number") curIdx = e.data.slideIndexChanged;
    });

    function curStep() {
      var s = slides()[curIdx];
      if (!s) return 0;
      var on = s.querySelectorAll(".step-dots .dot.on").length;
      return on;
    }
    function curMax() {
      var s = slides()[curIdx];
      if (!s) return 0;
      return s.querySelectorAll(".step-dots .dot").length;
    }
    function currentCue() { return { si: curIdx, step: curStep(), max: curMax() }; }

    // ---- state ----------------------------------------------------------
    var narrationOn = false;
    try { narrationOn = localStorage.getItem(LS_NARR) === "1"; } catch (e) {}
    var autoplay = false;
    var advanceTimer = null;
    var lastCueKey = null;
    var audio = new Audio();
    audio.preload = "auto";

    function stopAudio() {
      try { audio.pause(); } catch (e) {}
      audio.onended = null;
      audio.currentTime = 0;
    }
    function clearAdvance() { if (advanceTimer) { clearTimeout(advanceTimer); advanceTimer = null; } }

    function blurInputs() {
      var ae = document.activeElement;
      if (ae && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(ae.tagName)) try { ae.blur(); } catch (e) {}
    }
    function advanceForward() {
      blurInputs();
      // Dispatch on document.body (NOT window) so the event travels through the
      // real capture phase where deck-enhance's stepping handler lives — that
      // handler steps within the slide and only falls through to a slide change
      // when no steps remain. Dispatching on window bypasses it and always
      // jumps slides.
      (document.body || document).dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true })
      );
    }

    // ---- playback core (SINGLE driver) ----------------------------------
    // speak() is the one and only entry point for audio. It is called every
    // time the current step changes, no matter the cause (auto-advance, the
    // > arrow, arrow keys, clicking the slide, a thumbnail jump). It always:
    //   1. cancels any clip still playing + any pending auto-advance timer
    //      (so a manual jump instantly re-syncs and never double-advances),
    //   2. plays the clip for the step you are NOW on (if narration is on),
    //   3. re-arms the auto-advance from THIS clip's end (only if auto-play).
    function speak(c) {
      stopAudio();
      clearAdvance();
      var cue = cueKey(c.si, c.step);
      lastCueKey = cue;
      if (!narrationOn) { setBarState(); return; }
      var url = clipUrl(cue);
      if (!url) {
        // No clip for this step. In auto-play, move on after a short beat.
        if (autoplay) advanceTimer = setTimeout(autoNext, Math.max(GAP_MS, 400));
        setBarState();
        return;
      }
      audio.src = url;
      audio.onended = function () {
        if (autoplay) advanceTimer = setTimeout(autoNext, GAP_MS);
        setBarState();
      };
      var p = audio.play();
      if (p && p.catch) p.catch(function () {});
      setBarState();
    }

    // Auto-play's ONLY job: advance one step. It does not play audio itself —
    // the resulting step change is picked up by the watcher, which calls
    // speak(). One driver, no double playback.
    function autoNext() {
      if (!autoplay) return;
      var before = currentCueKey();
      advanceForward();
      setTimeout(function () {
        if (currentCueKey() === before) stopAutoplay(true); // end of deck
        // otherwise the watcher will speak() the new step
      }, 220);
    }

    function currentCueKey() { var c = currentCue(); return cueKey(c.si, c.step); }

    // ---- mode controls --------------------------------------------------
    // Narrate = master audio switch. Auto-play = hands-free advance (implies
    // Narrate on). Pausing auto-play keeps Narrate on, so you can keep
    // clicking through and still hear each step.
    function setNarration(on) {
      narrationOn = on;
      try { localStorage.setItem(LS_NARR, on ? "1" : "0"); } catch (e) {}
      if (!on) {
        autoplay = false;
        clearAdvance();
        stopAudio();
      } else {
        speak(currentCue()); // user gesture — speak the step we're on now
      }
      setBarState();
    }
    function startAutoplay() {
      autoplay = true;
      if (!narrationOn) { narrationOn = true; try { localStorage.setItem(LS_NARR, "1"); } catch (e) {} }
      speak(currentCue()); // plays current step + arms advance on its end
      setBarState();
    }
    function stopAutoplay(reachedEnd) {
      autoplay = false;       // narrationOn stays true — manual stepping still talks
      clearAdvance();
      try { audio.pause(); } catch (e) {}
      setBarState();
    }

    // ---- watcher: the single place a step change triggers playback ------
    // A step change inside a slide ([data-step] reveals) does NOT fire a
    // deck 'slidechange', so we detect every cue change (slide OR step) by
    // polling, plus an immediate re-check after user input for snappy sync.
    // Whatever caused the change — manual nav or autoNext's advance — it lands
    // here and calls speak(), which handles narration + re-arming auto-play.
    function checkCue() {
      var k = currentCueKey();
      if (k === lastCueKey) return;
      lastCueKey = k;
      speak(currentCue());
    }
    // Seed the watcher with the current step so it does NOT fire on load
    // (no audio before a user gesture). It fires on the first real nav.
    lastCueKey = currentCueKey();
    setInterval(checkCue, 120);
    // Immediate re-check after a click/tap/key that may have stepped the slide.
    function soonCheck() { setTimeout(checkCue, 30); setTimeout(checkCue, 110); }
    document.addEventListener("click", soonCheck, true);
    document.addEventListener("keydown", function (e) {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft" || e.key === "ArrowUp" ||
          e.key === "ArrowDown" || e.key === "PageUp" || e.key === "PageDown" ||
          e.key === " " || e.key === "Spacebar" || e.key === "Backspace") soonCheck();
    }, true);

    // =====================================================================
    // UI — merged into deck-stage's own control overlay (shadow DOM)
    // =====================================================================
    var SVG_PLAY = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4 2.5v11l9-5.5z"/></svg>';
    var SVG_PAUSE = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="3.5" y="2.5" width="3" height="11" rx="1"/><rect x="9.5" y="2.5" width="3" height="11" rx="1"/></svg>';
    var SVG_REPLAY = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.5-3.5"/><path d="M13 2.5V5h-2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    var SVG_SOUND = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M3 6v4h2.5L9 13V3L5.5 6z"/><path d="M11 5.5a3.2 3.2 0 0 1 0 5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
    var SVG_MUTE = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M3 6v4h2.5L9 13V3L5.5 6z"/><path d="M11 6l3 4M14 6l-3 4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
    var SVG_STARS = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M7 1.5l1.1 2.9L11 5.5 8.1 6.6 7 9.5 5.9 6.6 3 5.5l2.9-1.1z"/><path d="M12 9l.6 1.6L14.2 11l-1.6.6L12 13.2l-.6-1.6L9.8 11l1.6-.4z"/></svg>';

    var btnPlay = null, btnNarr = null, btnStudio = null, controlsReady = false;

    function mkOverlayBtn(cls, html, title) {
      var b = document.createElement("button");
      b.className = "btn reset narr " + cls;
      b.type = "button";
      b.setAttribute("aria-label", title);
      b.setAttribute("title", title);
      b.innerHTML = html;
      return b;
    }

    function injectControls() {
      if (controlsReady) return true;
      var sr = stage.shadowRoot;
      if (!sr) return false;
      var overlayEl = sr.querySelector(".overlay");
      if (!overlayEl) return false;

      // Visibility model:
      //   exported  = this is a bundled standalone (deck-export sets the flag).
      //   Studio button  → authoring only (always hidden after export).
      //   Narrate/Auto-play → shown while authoring, and in an export only if
      //                       audio was actually baked in. So an export with
      //                       no audio is a clean silent deck (no controls).
      var exported = !!window.__DECK_EXPORTED;
      var hasBaked = !!(BAKED && Object.keys(BAKED).length);
      var showStudio = !exported;
      var showNarr = !exported || hasBaked;
      if (!showStudio && !showNarr) { controlsReady = true; return true; }

      // narration-specific styling inside the shadow overlay
      if (!sr.querySelector("#narr-overlay-style")) {
        var st = document.createElement("style");
        st.id = "narr-overlay-style";
        st.textContent =
          ".btn.narr{gap:6px;white-space:nowrap;}" +
          ".btn.narr svg{width:13px;height:13px;}" +
          ".btn.narr.on{color:#5bb4ec !important;}" +          /* narration enabled */
          ".btn.narr.playing{color:#fff !important;}" +        /* autoplay running */
          ".btn.narr.dim{opacity:.38;pointer-events:none;}" +
          ".btn.narr.studio{color:#36a3f7 !important;}" +      /* authoring accent */
          ".btn.narr.studio.menu-open{background:rgba(54,163,247,.18) !important;color:#5bb4ec !important;}";
        sr.appendChild(st);
      }

      // Mark the start of the narration group so deck-stage can fold it onto
      // a second control-bar row on narrow screens (see _updateOverlayStack /
      // the .overlay[data-stack] rules). The break collapses to nothing until
      // stacking is active; the divider is hidden at the head of row 2.
      var brk = document.createElement("span");
      brk.className = "row-break";
      overlayEl.appendChild(brk);

      var div = document.createElement("span");
      div.className = "divider narr-divider";
      overlayEl.appendChild(div);

      if (showNarr) {
        // Narrate first (master switch), then Auto-play.
        btnNarr = mkOverlayBtn("narr-toggle", SVG_SOUND + "<span>Narrate</span>", "Narration on / off — speak each step as you reach it");
        btnPlay = mkOverlayBtn("narr-play", SVG_PLAY + "<span>Auto-play</span>", "Auto-play — advance hands-free as each clip ends");
        btnNarr.addEventListener("click", function () {
          if (!narrationOn && !Object.keys(clips).length) { openStudio(); return; }
          setNarration(!narrationOn);
        });
        btnPlay.addEventListener("click", function () {
          if (autoplay) { stopAutoplay(false); return; }
          if (!Object.keys(clips).length) { openStudio(); return; }
          startAutoplay();
        });
        overlayEl.appendChild(btnNarr);
        overlayEl.appendChild(btnPlay);
      }

      if (showStudio) {
        btnStudio = mkOverlayBtn("narr-studio studio", SVG_STARS + "<span>Studio</span>", "Authoring tools — generate audio, edit narration, export (hidden after export)");
        btnStudio.addEventListener("click", function (e) { e.stopPropagation(); toggleStudioMenu(); });
        overlayEl.appendChild(btnStudio);
      }

      controlsReady = true;
      setBarState();
      return true;
    }
    // deck-stage mounts its overlay asynchronously; poll until present.
    (function waitOverlay() {
      var n = 0;
      (function tick() {
        if (injectControls()) return;
        if (++n < 200) setTimeout(tick, 50);
      })();
    })();

    // While autoplay runs, keep the (auto-hiding) overlay visible so Pause
    // stays reachable without moving the mouse.
    setInterval(function () {
      if (!autoplay) return;
      var ov = stage.shadowRoot && stage.shadowRoot.querySelector(".overlay");
      if (ov) ov.setAttribute("data-visible", "");
    }, 700);

    function setBarState() {
      if (!controlsReady || !btnNarr) return;   // controls suppressed (no-audio export)
      // Narrate (master switch)
      btnNarr.innerHTML = (narrationOn ? SVG_SOUND : SVG_MUTE) + "<span>" + (narrationOn ? "Narrating" : "Narrate") + "</span>";
      btnNarr.classList.toggle("on", narrationOn);
      // Auto-play / Pause — dimmed when narration is off (it implies narration)
      btnPlay.innerHTML = (autoplay ? SVG_PAUSE + "<span>Pause</span>" : SVG_PLAY + "<span>Auto-play</span>");
      btnPlay.classList.toggle("playing", autoplay);
    }

    // =====================================================================
    // Studio menu — the colored authoring button's pop-up (design mode only)
    // =====================================================================
    var studioMenuEl = null;
    function studioMenuKey(e) { if (e.key === "Escape") { e.stopPropagation(); closeStudioMenu(); } }
    function closeStudioMenu() {
      if (studioMenuEl) { studioMenuEl.remove(); studioMenuEl = null; }
      if (btnStudio) btnStudio.classList.remove("menu-open");
      document.removeEventListener("keydown", studioMenuKey, true);
    }
    function toggleStudioMenu() {
      if (studioMenuEl) { closeStudioMenu(); return; }
      if (btnStudio) btnStudio.classList.add("menu-open");
      var back = $("div", { "data-omelette-chrome": "", class: "export-hidden",
        style: "position:fixed;inset:0;z-index:9400;font-family:" + FONT + ";" });
      back.addEventListener("click", function (e) { if (e.target === back) closeStudioMenu(); });
      // Anchor near the Studio button (bottom-right) so the menu reads as its pop-up.
      var card = $("div", { style:
        "position:fixed;right:24px;bottom:92px;min-width:312px;max-width:calc(100vw - 32px);" +
        "background:#fff;border-radius:12px;box-shadow:0 18px 60px rgba(0,0,0,.34);padding:8px;" });
      card.appendChild($("div", { style: "font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:" + GREY + ";font-weight:700;padding:8px 12px 6px;", text: "Studio · authoring tools" }));
      function item(title, sub, fn) {
        var b = $("button", { type: "button", style:
          "display:block;width:100%;text-align:left;border:0;background:transparent;cursor:pointer;font-family:" + FONT + ";padding:10px 12px;border-radius:8px;" },
          [ $("div", { style: "font-size:14px;font-weight:650;color:" + INK + ";", text: title }),
            $("div", { style: "font-size:11.5px;color:" + GREY + ";margin-top:2px;line-height:1.35;", text: sub }) ]);
        b.addEventListener("mouseenter", function () { b.style.background = "#F2F6FA"; });
        b.addEventListener("mouseleave", function () { b.style.background = "transparent"; });
        b.addEventListener("click", function () { closeStudioMenu(); fn(); });
        return b;
      }
      card.appendChild(item("Audio studio", "Generate, re-generate or download voiceover", openStudio));
      card.appendChild(item("Cue overview", "See which steps have text and which have audio", openCueOverview));
      card.appendChild(item("Build preview", "One self-contained file that keeps the Studio — open it anywhere", function () { runBundle("preview"); }));
      card.appendChild(item("Publish standalone", "Bake audio + lock everything into one offline file to share", function () { runBundle("publish"); }));
      back.appendChild(card);
      document.body.appendChild(back);
      studioMenuEl = back;
      document.addEventListener("keydown", studioMenuKey, true);
    }

    // ---- shared modal shell + button helper ----------------------------
    function modal(width) {
      var back = $("div", { "data-omelette-chrome": "", class: "export-hidden",
        style: "position:fixed;inset:0;z-index:9600;display:flex;align-items:center;justify-content:center;background:rgba(20,22,24,.45);font-family:" + FONT + ";" });
      var panel = $("div", { style: "width:" + (width || 440) + "px;max-width:calc(100vw - 40px);max-height:calc(100vh - 48px);overflow:auto;background:#fff;border-radius:14px;box-shadow:0 24px 70px rgba(0,0,0,.35);padding:22px 24px;" });
      back.addEventListener("click", function (e) { if (e.target === back) back.remove(); });
      back.appendChild(panel); document.body.appendChild(back);
      return { back: back, panel: panel };
    }
    function btn(label, kind) {
      var c = kind === "primary"
        ? "border:0;background:" + BLUE + ";color:#fff;"
        : "border:1px solid " + LINE + ";background:#fff;color:" + INK + ";";
      return $("button", { type: "button", text: label,
        style: c + "cursor:pointer;font-family:" + FONT + ";font-size:13px;font-weight:600;padding:9px 14px;border-radius:8px;" });
    }

    // ---- Bundle action (no console needed) -----------------------------
    // mode = "preview" → single file that keeps the Studio; "publish" → final
    // share-ready file (Studio removed, audio baked).
    function runBundle(mode) {
      var isPreview = mode === "preview";
      var verb = isPreview ? "preview" : "publish";
      var Verb = isPreview ? "Build preview" : "Publish standalone";
      var m = modal(404);
      m.panel.appendChild($("div", { style: "font-size:16px;font-weight:700;color:" + INK + ";margin-bottom:10px;", text: Verb }));
      var msg = $("div", { style: "font-size:13.5px;color:" + INK + ";line-height:1.5;" });
      var row = $("div", { style: "margin-top:16px;text-align:right;" });
      var close = btn("Close"); close.addEventListener("click", function () { m.back.remove(); });
      row.appendChild(close);
      m.panel.appendChild(msg); m.panel.appendChild(row);

      // Friendly fallback: when the browser can't bundle on its own (deck opened
      // straight from a file, helper unavailable, or any fetch error), point the
      // presenter to the no-setup path — just ask the AI agent.
      function askAgent(lead) {
        var ask = isPreview
          ? "“Build a preview of this presentation”"
          : "“Publish this presentation as a standalone file”";
        msg.innerHTML = "";
        msg.appendChild($("div", { style: "color:" + INK + ";", text: lead }));
        msg.appendChild($("div", { style: "margin:12px 0 6px;color:" + GREY + ";font-size:12.5px;", text: "Just tell your AI agent:" }));
        msg.appendChild($("div", { style: "background:#F2F6FA;border:1px solid " + LINE + ";border-radius:8px;padding:12px 14px;font-size:14px;font-weight:600;color:" + INK + ";", text: ask }));
        msg.appendChild($("div", { style: "margin-top:10px;color:" + GREY + ";font-size:12px;line-height:1.45;",
          text: isPreview
            ? "It bundles the slides, narration and fonts into one file that still has the Studio — no setup needed."
            : "It bakes the audio and locks everything into one shareable file — no setup needed." }));
      }

      var fn = window.deckExport && window.deckExport[verb];
      var canRun = typeof fn === "function" && location.protocol !== "file:";
      if (!canRun) {
        askAgent(location.protocol === "file:"
          ? "This presentation is open straight from a file, so the browser can’t bundle it here."
          : "The in-browser bundler isn’t available here.");
        return;
      }
      msg.textContent = "Building… inlining the slides, narration and fonts. The download starts automatically.";
      Promise.resolve().then(function () { return fn(); })
        .then(function (r) { msg.textContent = "Done — saved " + ((r && r.name) || "the file") + ((r && r.bytes) ? " (" + (r.bytes / 1048576).toFixed(1) + " MB)" : "") + "."; })
        .catch(function () { askAgent("The browser couldn’t finish here."); });
    }

    // ---- helpers for the cue overview ----------------------------------
    function slideLabel(si) { var s = slides()[si]; return (s && s.getAttribute("data-label")) || ("Slide " + (si + 1)); }
    function slideStepCount(si) {
      var lines = (SCRIPT.slides[si] && SCRIPT.slides[si].lines) || [];
      var sec = slides()[si], maxStep = 0;
      if (sec) Array.prototype.forEach.call(sec.querySelectorAll("[data-step]"), function (el) {
        var n = parseInt(el.getAttribute("data-step"), 10); if (n > maxStep) maxStep = n;
      });
      return Math.max(lines.length, maxStep + 1, 1);
    }
    function slideCount() { return Math.max((SCRIPT.slides || []).length, slides().length); }
    function getLine(si, k) { return (SCRIPT.slides[si] && SCRIPT.slides[si].lines && SCRIPT.slides[si].lines[k]) || ""; }

    // ---- Cue overview ---------------------------------------------------
    function openCueOverview() {
      var m = modal(560);
      m.panel.appendChild($("div", { style: "font-size:16px;font-weight:700;color:" + INK + ";", text: "Cue overview" }));
      var withText = 0, withClip = 0, totalSteps = 0;
      var body = $("div", { style: "margin-top:12px;" });
      for (var si = 0; si < slideCount(); si++) {
        var grp = $("div", { style: "margin-bottom:12px;" });
        grp.appendChild($("div", { style: "font-size:13px;font-weight:700;color:" + INK + ";margin-bottom:2px;", text: (si + 1) + " · " + slideLabel(si) }));
        var n = slideStepCount(si);
        for (var k = 0; k < n; k++) {
          totalSteps++;
          var txt = (getLine(si, k) || "").trim();
          var clip = hasClip(cueKey(si, k));
          if (txt) withText++;
          if (clip) withClip++;
          var color = !txt ? "#B7BCC2" : (clip ? "#1a7f37" : "#B9770A");
          var mark = !txt ? "— silent" : (clip ? "● audio ready" : "○ text, no audio");
          var line = $("div", { style: "display:flex;gap:10px;font-size:12px;padding:3px 0;border-top:1px solid #F0F1F3;" });
          line.appendChild($("div", { style: "flex:0 0 78px;color:" + GREY + ";", text: (k === 0 ? "On entry" : "Step " + k) }));
          line.appendChild($("div", { style: "flex:0 0 124px;color:" + color + ";font-weight:600;", text: mark }));
          line.appendChild($("div", { style: "flex:1;color:" + INK + ";white-space:nowrap;overflow:hidden;text-overflow:ellipsis;", text: txt }));
          grp.appendChild(line);
        }
        body.appendChild(grp);
      }
      m.panel.appendChild($("div", { style: "font-size:12px;color:" + GREY + ";margin:4px 0 2px;", text: withText + " of " + totalSteps + " steps have narration · " + withClip + " have audio generated" }));
      m.panel.appendChild(body);
      var row = $("div", { style: "text-align:right;margin-top:8px;position:sticky;bottom:0;background:#fff;padding-top:10px;" });
      var closeB = btn("Close"); closeB.addEventListener("click", function () { m.back.remove(); });
      row.appendChild(closeB); m.panel.appendChild(row);
    }

    // =====================================================================
    // Studio (generation) panel
    // =====================================================================
    var BLUE = "#007BC0", BLUE_D = "#00629A", INK = "#2E3033", GREY = "#71767C", LINE = "#E0E2E5";
    var FONT = 'system-ui,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif';

    // Hosted Audio Studio — for generating audio when THIS page can't reach
    // ElevenLabs (e.g. the Claude web app preview's CSP refuses it), or simply
    // from a phone. We build a link to open-deck.org/studio with this deck's
    // narration encoded in the URL #fragment (never sent to the server),
    // mirroring make-studio-link.mjs's encoding so it decodes there identically.
    var WEB_STUDIO = "https://open-deck.org/studio/";
    function webStudioLink() {
      var payload = {
        voiceId: SCRIPT.voiceId || "",
        modelId: SCRIPT.modelId || "eleven_multilingual_v2",
        slides: (SCRIPT.slides || []).map(function (s) {
          return { lines: (s.lines || []).map(function (l) { return l == null ? "" : String(l); }) };
        })
      };
      var b64 = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
      return WEB_STUDIO + "#" + b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    }
    function selectCopy(input, onDone) {
      try { input.focus(); input.select(); if (document.execCommand("copy")) { onDone(); return; } } catch (e) {}
    }
    // Open a URL in a new tab, detecting when it's blocked. A sandboxed iframe
    // without allow-popups (e.g. the Claude web app preview) returns null from
    // window.open — so target="_blank" silently does nothing. We avoid the
    // "noopener" feature string (which makes some browsers return null even on
    // success) and null the opener manually instead. Returns true if it opened.
    function openLink(url, onBlocked) {
      var w = null;
      try { w = window.open(url, "_blank"); } catch (e) { w = null; }
      if (w) { try { w.opener = null; } catch (e) {} return true; }
      if (onBlocked) onBlocked();
      return false;
    }
    function openWebStudio() {
      var link = webStudioLink();
      var m = modal(456);
      m.panel.appendChild($("div", { style: "font-size:16px;font-weight:700;color:" + INK + ";margin-bottom:8px;", text: "Generate on the web" }));
      m.panel.appendChild($("div", { style: "font-size:13px;color:" + INK + ";line-height:1.5;",
        text: "Opens the OpenDeck Audio Studio with this deck’s narration loaded. Enter your ElevenLabs key there, generate, and download narration-audio.js — then bring it back to bake in. Handy on a phone, or when this page can’t reach ElevenLabs." }));
      var input = $("input", { type: "text", readonly: "readonly", value: link,
        style: "width:100%;box-sizing:border-box;margin-top:14px;padding:9px 11px;border:1px solid " + LINE + ";border-radius:8px;font-family:" + FONT + ";font-size:12px;color:" + INK + ";background:#F7F9FB;" });
      input.addEventListener("focus", function () { this.select(); });
      m.panel.appendChild(input);
      var row = $("div", { style: "display:flex;gap:8px;margin-top:14px;justify-content:flex-end;align-items:center;flex-wrap:wrap;" });
      var close = btn("Close"); close.addEventListener("click", function () { m.back.remove(); });
      var copy = btn("Copy link");
      copy.addEventListener("click", function () {
        var done = function () { copy.textContent = "Copied"; setTimeout(function () { copy.textContent = "Copy link"; }, 1600); };
        if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(link).then(done, function () { selectCopy(input, done); }); }
        else selectCopy(input, done);
      });
      var openA = $("a", { href: link, target: "_blank", rel: "noopener", text: "Open ↗",
        style: "border:0;background:" + BLUE + ";color:#fff;text-decoration:none;cursor:pointer;font-family:" + FONT + ";font-size:13px;font-weight:600;padding:9px 14px;border-radius:8px;" });
      openA.addEventListener("click", function (e) {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
        e.preventDefault();
        openLink(link, function () {
          var done = function () { copy.textContent = "Link copied"; setTimeout(function () { copy.textContent = "Copy link"; }, 2000); };
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(done, function () { selectCopy(input, done); });
          else selectCopy(input, done);
        });
      });
      row.appendChild(close); row.appendChild(copy); row.appendChild(openA);
      m.panel.appendChild(row);
    }

    var overlay = null;
    // Set when the wizard is built; lets a blocked ElevenLabs call switch the
    // live wizard into the web-handoff path (falls back to the modal if unset).
    var switchToWebHandoff = null;
    function openStudio() {
      if (overlay) { overlay.style.display = "flex"; refreshStudio(); return; }
      overlay = $("div", {
        "data-omelette-chrome": "",
        class: "export-hidden",
        style: "position:fixed;inset:0;z-index:9500;display:flex;align-items:center;justify-content:center;" +
          "background:rgba(20,22,24,.45);font-family:" + FONT + ";"
      });
      overlay.addEventListener("click", function (e) { if (e.target === overlay) overlay.style.display = "none"; });

      var panel = $("div", {
        style: "width:460px;max-width:calc(100vw - 40px);max-height:calc(100vh - 48px);overflow:auto;" +
          "background:#fff;border-radius:14px;box-shadow:0 24px 70px rgba(0,0,0,.35);padding:24px 26px 20px;"
      });
      panel.addEventListener("click", function (e) { e.stopPropagation(); });

      // ---- header ----
      panel.appendChild($("div", { style: "display:flex;align-items:baseline;justify-content:space-between;margin-bottom:14px;" }, [
        $("h2", { text: "Narration audio", style: "margin:0;font-size:21px;font-weight:700;color:" + INK + ";" }),
        (function () { var x = $("button", { type: "button", title: "Close", text: "✕", style: "border:0;background:transparent;font-size:18px;cursor:pointer;color:" + GREY + ";padding:4px 6px;" }); x.addEventListener("click", function () { overlay.style.display = "none"; }); return x; })()
      ]));

      // ---- stepper (numbered dots + a caption, so it stays compact) ----
      // Two modes. The default "local" path generates in this browser. When the
      // user hands off to the hosted Studio — they click the web link, or the
      // ElevenLabs call is blocked here (e.g. the Claude web app preview) — the
      // wizard switches to the "web" path: generate on open-deck.org/studio,
      // bring the file back to the chat, and let the agent publish.
      var STEPS_LOCAL = ["Connect", "Generate", "Download", "Place", "Publish"];
      var STEPS_WEB = ["Generate on the web", "Bring it back", "Publish"];
      var activeSteps = STEPS_LOCAL;
      var stepper = $("div", { style: "margin-bottom:18px;" });
      var dotsRow = $("div", { style: "display:flex;align-items:center;gap:4px;" });
      var stepCaption = $("div", { style: "font-size:12px;color:" + GREY + ";margin-top:9px;" });
      stepper.appendChild(dotsRow); stepper.appendChild(stepCaption);
      panel.appendChild(stepper);
      function renderStepper(n) {
        dotsRow.innerHTML = "";
        activeSteps.forEach(function (label, idx) {
          var num = idx + 1, state = num < n ? "done" : (num === n ? "current" : "todo");
          dotsRow.appendChild($("div", { text: state === "done" ? "✓" : String(num),
            style: "flex:0 0 auto;width:22px;height:22px;border-radius:50%;background:" + (state === "todo" ? "#EAECEF" : BLUE) + ";color:" + (state === "todo" ? GREY : "#fff") + ";font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;" }));
          if (idx < activeSteps.length - 1) dotsRow.appendChild($("div", { style: "flex:1;height:2px;border-radius:2px;background:" + (num < n ? BLUE : LINE) + ";" }));
        });
        stepCaption.innerHTML = "<b style='color:" + INK + ";'>" + activeSteps[n - 1] + "</b> · step " + n + " of " + activeSteps.length;
      }

      // ---- shared field helpers ----
      var inStyle = "width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid " + LINE + ";border-radius:8px;font-family:" + FONT + ";font-size:14px;color:" + INK + ";outline:none;";
      function field(labelTxt, input, hint) {
        var wrap = $("div", { style: "margin-bottom:14px;" });
        wrap.appendChild($("label", { text: labelTxt, style: "display:block;font-size:12.5px;font-weight:700;letter-spacing:.02em;text-transform:uppercase;color:" + INK + ";margin-bottom:6px;" }));
        wrap.appendChild(input);
        if (hint) wrap.appendChild($("div", { html: hint, style: "font-size:12px;color:" + GREY + ";margin-top:5px;line-height:1.45;" }));
        return wrap;
      }
      function cacheWarnEl() {
        return $("div", { class: "narr-cachewarn",
          style: "display:none;font-size:11.5px;color:#9A1B1B;background:#FCEDEC;border:1px solid #F3C9C6;border-radius:8px;padding:8px 10px;margin-top:14px;line-height:1.45;",
          html: "⚠ This browser isn’t saving clips between reloads (e.g. Safari, or Firefox, opened from a <code>file://</code> page). <b>Download the audio before you reload</b>, or you’ll have to generate again. Tip: use Chrome or Edge, or serve the deck over http." });
      }

      // ========== STEP 1 — Connect ==========
      var step1 = $("div");
      step1.appendChild($("p", { style: "margin:0 0 16px;font-size:13.5px;line-height:1.5;color:" + GREY + ";",
        html: "Generate a voiceover for your deck with ElevenLabs. Your API key is used <b>only in this browser</b> and is never uploaded." }));
      var keyInput = $("input", { type: "password", placeholder: "sk_…", autocomplete: "off", spellcheck: "false", style: inStyle });
      var voiceInput = $("input", { type: "text", placeholder: "ElevenLabs voice ID", autocomplete: "off", spellcheck: "false", style: inStyle });
      try { keyInput.value = sessionStorage.getItem(SS_KEY) || ""; } catch (e) {}
      try { voiceInput.value = sessionStorage.getItem(SS_VOICE) || SCRIPT.voiceId || ""; } catch (e) { voiceInput.value = SCRIPT.voiceId || ""; }
      [keyInput, voiceInput].forEach(function (el) {
        el.addEventListener("focus", function () { el.style.borderColor = BLUE; });
        el.addEventListener("blur", function () { el.style.borderColor = LINE; });
      });
      var remember = $("input", { type: "checkbox", style: "margin:0 8px 0 0;vertical-align:-1px;" });
      remember.checked = true;
      step1.appendChild(field("ElevenLabs API key", keyInput, "Create one at elevenlabs.io → your profile → API keys."));
      step1.appendChild(field("Voice ID", voiceInput, "Find this in ElevenLabs → Voices → (voice) → ID."));
      step1.appendChild($("label", { style: "display:flex;align-items:center;font-size:12.5px;color:" + GREY + ";margin:-2px 0 0;cursor:pointer;" }, [
        remember, $("span", { text: "Remember key for this tab (session only)" })
      ]));
      var step1err = $("div", { style: "font-size:12.5px;color:#9A1B1B;margin-top:10px;min-height:1px;" });
      step1.appendChild(step1err);

      // ========== STEP 2 — Generate ==========
      var step2 = $("div", { style: "display:none;" });
      var totalCues = allCues().length;
      step2.appendChild($("p", { style: "margin:0 0 14px;font-size:13.5px;line-height:1.5;color:" + GREY + ";",
        text: "Create one audio clip per narrated step. Existing clips are reused; tick the box below to redo them." }));
      step2.appendChild($("div", { style: "display:flex;align-items:center;justify-content:space-between;font-size:13px;color:" + INK + ";margin-bottom:8px;" }, [
        $("span", { id: "narr-status", text: "" }), $("span", { id: "narr-count", text: "" })
      ]));
      var track = $("div", { style: "height:6px;border-radius:6px;background:#EEF0F2;overflow:hidden;margin-bottom:18px;" });
      track.appendChild($("div", { id: "narr-fill", style: "height:100%;width:0;background:" + BLUE + ";transition:width 160ms ease;" }));
      step2.appendChild(track);
      var genBtn = $("button", { type: "button", text: "Generate narration",
        style: "width:100%;border:0;cursor:pointer;background:" + BLUE + ";color:#fff;font-family:" + FONT + ";font-size:15px;font-weight:700;padding:13px;border-radius:9px;transition:background 140ms ease;" });
      genBtn.addEventListener("mouseenter", function () { if (!genBtn.disabled) genBtn.style.background = BLUE_D; });
      genBtn.addEventListener("mouseleave", function () { if (!genBtn.disabled) genBtn.style.background = BLUE; });
      step2.appendChild(genBtn);
      var forceChk = $("input", { type: "checkbox", style: "margin:0 8px 0 0;vertical-align:-1px;" });
      step2.appendChild($("label", { style: "display:flex;align-items:center;font-size:12.5px;color:" + GREY + ";margin:12px 0 0;cursor:pointer;" }, [
        forceChk, $("span", { text: "Re-generate clips that already exist" })
      ]));
      step2.appendChild(cacheWarnEl());
      // Escape hatch: generate on the hosted Studio instead (a phone, or when
      // this page's environment blocks the ElevenLabs call).
      var webLink = $("button", { type: "button", text: "On a phone, or blocked here? Generate on the web ↗",
        style: "margin:14px 0 0;border:0;background:transparent;cursor:pointer;font-family:" + FONT + ";font-size:12px;color:" + BLUE + ";text-decoration:underline;padding:2px 0;" });
      webLink.addEventListener("click", function () { enterWebHandoff("manual"); });
      step2.appendChild(webLink);

      // ========== STEP 3 — Download ==========
      var step3 = $("div", { style: "display:none;" });
      step3.appendChild($("p", { style: "margin:0 0 14px;font-size:13.5px;line-height:1.5;color:" + INK + ";",
        text: "Save your narration as a file so it plays on any machine, offline." }));
      var dlBtn = $("button", { type: "button", text: "Download audio",
        style: "width:100%;border:0;cursor:pointer;background:" + BLUE + ";color:#fff;font-family:" + FONT + ";font-size:15px;font-weight:700;padding:13px;border-radius:9px;transition:background 140ms ease;" });
      dlBtn.addEventListener("mouseenter", function () { dlBtn.style.background = BLUE_D; });
      dlBtn.addEventListener("mouseleave", function () { dlBtn.style.background = BLUE; });
      step3.appendChild(dlBtn);
      var dlStatus = $("div", { style: "font-size:12.5px;color:" + GREY + ";margin-top:10px;min-height:1px;" });
      step3.appendChild(dlStatus);
      step3.appendChild($("div", { style: "font-size:12px;color:" + GREY + ";margin-top:8px;line-height:1.45;",
        html: "Saves <code>narration-audio.js</code> — your whole voiceover in one file." }));
      step3.appendChild(cacheWarnEl());
      var clrBtn = $("button", { type: "button", text: "Clear cached clips",
        style: "margin-top:14px;border:0;background:transparent;cursor:pointer;font-family:" + FONT + ";font-size:12px;font-weight:600;color:#9A1B1B;padding:2px 0;text-decoration:underline;" });
      step3.appendChild(clrBtn);

      // ========== STEP 4 — Place the file ==========
      var step4 = $("div", { style: "display:none;" });
      step4.appendChild($("p", { style: "margin:0 0 14px;font-size:13.5px;line-height:1.5;color:" + INK + ";",
        text: "Put the downloaded file where your deck can find it." }));
      step4.appendChild($("div", { style: "padding:16px;background:#F2F6FA;border:1px solid " + LINE + ";border-radius:10px;font-size:13.5px;line-height:1.55;color:" + INK + ";",
        html: "Move <code>narration-audio.js</code> into the <b>same folder as your deck</b> — next to the deck’s <code>.html</code> file." }));

      // ========== STEP 5 — Publish (ask the agent) ==========
      var step5 = $("div", { style: "display:none;" });
      step5.appendChild($("p", { style: "margin:0 0 14px;font-size:13.5px;line-height:1.5;color:" + INK + ";",
        text: "Last step — publish everything into one shareable file." }));
      step5.appendChild($("div", { style: "margin:0 0 6px;color:" + GREY + ";font-size:12.5px;", text: "Tell your AI agent:" }));
      step5.appendChild($("div", { style: "background:#F2F6FA;border:1px solid " + LINE + ";border-radius:8px;padding:12px 14px;font-size:14px;font-weight:600;color:" + INK + ";",
        text: "“Publish this presentation as a standalone file”" }));
      step5.appendChild($("div", { style: "margin-top:10px;color:" + GREY + ";font-size:12px;line-height:1.45;",
        text: "It bakes the audio and locks everything into one offline file — no setup needed. (To preview while you tune it, ask for a preview instead — that keeps the Studio.)" }));

      // ===== WEB-HANDOFF STEPS (shown only after the hand-off) =====
      // ① Generate on the web — launch the hosted Studio, narration pre-loaded.
      var webStep1 = $("div", { style: "display:none;" });
      // Shown only when we auto-route here because the environment is blocked
      // (the preflight probe, or a failed generate) — not when the user chose it.
      var webBanner = $("div", { style: "display:none;font-size:12.5px;color:#8A5A00;background:#FFF6E5;border:1px solid #F2DCA8;border-radius:8px;padding:8px 10px;margin:0 0 14px;line-height:1.45;",
        text: "This environment can’t reach the audio service (e.g. the Claude web app preview), so we’ve set you up to generate on the web instead." });
      webStep1.appendChild(webBanner);
      webStep1.appendChild($("p", { style: "margin:0 0 14px;font-size:13.5px;line-height:1.5;color:" + GREY + ";",
        html: "Your deck’s narration is loaded into the <b>OpenDeck Audio Studio</b> on the web. Open it, enter your ElevenLabs key, generate, then download <code>narration-audio.js</code>. Your key stays in that browser — it’s never sent to us." }));
      var webLinkInput = $("input", { type: "text", readonly: "readonly", value: webStudioLink(),
        style: "width:100%;box-sizing:border-box;padding:9px 11px;border:1px solid " + LINE + ";border-radius:8px;font-family:" + FONT + ";font-size:12px;color:" + INK + ";background:#F7F9FB;" });
      webLinkInput.addEventListener("focus", function () { this.select(); });
      webStep1.appendChild(webLinkInput);
      var webRow = $("div", { style: "display:flex;gap:8px;margin-top:12px;align-items:center;" });
      var webCopy = btn("Copy link");
      webCopy.addEventListener("click", function () {
        var link = webLinkInput.value;
        var done = function () { webCopy.textContent = "Copied"; setTimeout(function () { webCopy.textContent = "Copy link"; }, 1600); };
        if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(link).then(done, function () { selectCopy(webLinkInput, done); }); }
        else selectCopy(webLinkInput, done);
      });
      var webOpen = $("a", { href: webLinkInput.value, target: "_blank", rel: "noopener", text: "Open Studio ↗",
        style: "border:0;background:" + BLUE + ";color:#fff;text-decoration:none;cursor:pointer;font-family:" + FONT + ";font-size:13px;font-weight:600;padding:9px 14px;border-radius:8px;" });
      var webOpenHint = $("div", { style: "display:none;font-size:12px;color:" + GREY + ";margin-top:10px;line-height:1.45;" });
      webOpen.addEventListener("click", function (e) {
        // Leave modified clicks (⌘/Ctrl/middle) to the browser's own new-tab.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
        e.preventDefault();
        openLink(webLinkInput.value, function () {
          // New tabs are blocked here — copy the link so the user can paste it.
          var done = function () { webOpenHint.textContent = "New tabs are blocked here — link copied. Paste it into a browser tab to open the Studio."; webOpenHint.style.display = "block"; };
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(webLinkInput.value).then(done, function () { selectCopy(webLinkInput, done); });
          else selectCopy(webLinkInput, done);
        });
      });
      webRow.appendChild(webCopy); webRow.appendChild(webOpen);
      webStep1.appendChild(webRow);
      webStep1.appendChild(webOpenHint);
      var webBack = $("button", { type: "button", text: "← Generate in this browser instead",
        style: "margin:16px 0 0;border:0;background:transparent;cursor:pointer;font-family:" + FONT + ";font-size:12px;color:" + GREY + ";text-decoration:underline;padding:2px 0;" });
      webStep1.appendChild(webBack);

      // ② Bring it back — hand the downloaded file to the agent (no folder here).
      var webStep2 = $("div", { style: "display:none;" });
      webStep2.appendChild($("p", { style: "margin:0 0 14px;font-size:13.5px;line-height:1.5;color:" + INK + ";",
        text: "Got narration-audio.js from the web Studio? Bring it back to your agent." }));
      webStep2.appendChild($("div", { style: "padding:16px;background:#F2F6FA;border:1px solid " + LINE + ";border-radius:10px;font-size:13.5px;line-height:1.55;color:" + INK + ";",
        html: "Drag <code>narration-audio.js</code> into your <b>chat with the agent</b> (it’s in your device’s Downloads). No need to place it yourself — the agent puts it next to the deck." }));

      // ③ Publish — same ask as local, framed as a hand-over.
      var webStep3 = $("div", { style: "display:none;" });
      webStep3.appendChild($("p", { style: "margin:0 0 14px;font-size:13.5px;line-height:1.5;color:" + INK + ";",
        text: "Last step — let your agent bake the audio in." }));
      webStep3.appendChild($("div", { style: "margin:0 0 6px;color:" + GREY + ";font-size:12.5px;", text: "Tell your AI agent:" }));
      webStep3.appendChild($("div", { style: "background:#F2F6FA;border:1px solid " + LINE + ";border-radius:8px;padding:12px 14px;font-size:14px;font-weight:600;color:" + INK + ";",
        text: "“Integrate this narration audio and publish the deck as a standalone file”" }));
      webStep3.appendChild($("div", { style: "margin-top:10px;color:" + GREY + ";font-size:12px;line-height:1.45;",
        text: "It places the file, bakes the audio, and locks everything into one offline file you can share — no setup needed." }));

      var stepBody = $("div");
      stepBody.appendChild(step1); stepBody.appendChild(step2); stepBody.appendChild(step3);
      stepBody.appendChild(step4); stepBody.appendChild(step5);
      stepBody.appendChild(webStep1); stepBody.appendChild(webStep2); stepBody.appendChild(webStep3);
      panel.appendChild(stepBody);

      // ---- footer nav ----
      var footer = $("div", { style: "display:flex;align-items:center;justify-content:space-between;margin-top:20px;padding-top:16px;border-top:1px solid " + LINE + ";" });
      var backBtn = $("button", { type: "button", text: "← Back",
        style: "border:0;background:transparent;cursor:pointer;font-family:" + FONT + ";font-size:13px;font-weight:600;color:" + GREY + ";padding:8px 4px;" });
      var nextBtn = btn("Next →", "primary");
      footer.appendChild(backBtn); footer.appendChild(nextBtn);
      panel.appendChild(footer);

      overlay.appendChild(panel);
      document.body.appendChild(overlay);

      // ---- wiring ----
      function setStatus(txt) { var s = panel.querySelector("#narr-status"); if (s) s.textContent = txt; }
      function setCount() {
        var have = clipsCount();
        var c = panel.querySelector("#narr-count"); if (c) c.textContent = have + " / " + totalCues + " clips";
        var f = panel.querySelector("#narr-fill"); if (f) f.style.width = (totalCues ? (have / totalCues * 100) : 0) + "%";
      }
      function clipsCount() { var n = 0; allCues().forEach(function (c) { if (hasClip(cueKey(c.si, c.step))) n++; }); return n; }
      panel.__refresh = function () {
        setCount();
        Array.prototype.forEach.call(panel.querySelectorAll(".narr-cachewarn"), function (w) { w.style.display = cacheBlocked ? "block" : "none"; });
      };

      var localEls = [step1, step2, step3, step4, step5];
      var webEls = [webStep1, webStep2, webStep3];
      var activeEls = localEls;
      var step = 1;
      function goStep(n) {
        step = n;
        localEls.concat(webEls).forEach(function (el) { el.style.display = "none"; });
        activeEls[n - 1].style.display = "block";
        renderStepper(n);
        backBtn.style.visibility = n === 1 ? "hidden" : "visible";
        nextBtn.textContent = n === activeSteps.length ? "Done" : "Next →";
        panel.__refresh();
      }
      function enterWebHandoff(reason) {
        webBanner.style.display = reason === "blocked" ? "block" : "none";
        activeSteps = STEPS_WEB; activeEls = webEls; goStep(1);
      }
      function exitWebHandoff() { activeSteps = STEPS_LOCAL; activeEls = localEls; goStep(1); }
      // Expose the switch so a blocked connection (the preflight probe, or a
      // failed generate) can flip the live wizard into web mode.
      switchToWebHandoff = function () { enterWebHandoff("blocked"); };
      webBack.addEventListener("click", exitWebHandoff);

      backBtn.addEventListener("click", function () { if (step > 1) goStep(step - 1); });
      nextBtn.addEventListener("click", function () {
        if (activeSteps === STEPS_LOCAL && step === 1) {
          var key = keyInput.value.trim(), voice = voiceInput.value.trim();
          if (!key) { step1err.textContent = "Enter your ElevenLabs API key."; keyInput.focus(); return; }
          if (!voice) { step1err.textContent = "Enter a voice ID."; voiceInput.focus(); return; }
          step1err.textContent = "";
          try { if (remember.checked) { sessionStorage.setItem(SS_KEY, key); sessionStorage.setItem(SS_VOICE, voice); } else { sessionStorage.removeItem(SS_KEY); } } catch (e) {}
          goStep(2);
        } else if (step < activeSteps.length) { goStep(step + 1); }
        else { overlay.style.display = "none"; }
      });

      genBtn.addEventListener("click", function () {
        var key = (keyInput.value || "").trim(), voice = (voiceInput.value || "").trim();
        if (!key || !voice) { goStep(1); step1err.textContent = "Enter your API key and voice ID first."; return; }
        generateAll(key, voice, forceChk.checked, setStatus, setCount, genBtn, function (failed) { if (!failed) goStep(3); });
      });
      dlBtn.addEventListener("click", function () { downloadAudioJs(function (t) { dlStatus.textContent = t; }); });
      clrBtn.addEventListener("click", function () {
        if (!confirm("Delete all cached narration clips from this browser?")) return;
        idbClear().then(function () {
          Object.keys(clips).forEach(function (cue) { if (!clips[cue].baked) { try { URL.revokeObjectURL(clips[cue].url); } catch (e) {} delete clips[cue]; } });
          setCount(); setBarState(); dlStatus.textContent = "Cache cleared.";
        });
      });

      // Open on the most useful step: all clips done → Download; some → Generate; none → Connect.
      var have = clipsCount();
      goStep(have > 0 && have >= totalCues ? 3 : (have > 0 ? 2 : 1));

      // Preflight: detect a blocked environment up front so the user lands on
      // the right path instead of switching mid-run. A CSP block fails fast
      // (no network round-trip), so this resolves near-instantly when blocked
      // and the wizard opens straight into the web path; when reachable it stays
      // local. Only when nothing's been generated yet and they're still on the
      // local path (haven't navigated or chosen the web route themselves).
      if (have === 0) {
        probeConnectivity().then(function (r) {
          if (r === "blocked" && activeSteps === STEPS_LOCAL && clipsCount() === 0) enterWebHandoff("blocked");
        });
      }
    }
    function refreshStudio() { if (overlay && overlay.firstChild && overlay.firstChild.__refresh) overlay.firstChild.__refresh(); }

    // ---- ElevenLabs generation -----------------------------------------
    function ttsURL(voice) {
      return "https://api.elevenlabs.io/v1/text-to-speech/" + encodeURIComponent(voice) + "?output_format=mp3_44100_128";
    }
    // Keyless reachability probe. A no-cors request rejects only when the
    // connection itself is refused (a CSP block, or offline) — never on auth or
    // CORS, since an opaque response resolves regardless. So a rejection means
    // "can't reach ElevenLabs from here." A CSP block fails fast (no network),
    // so the blocked case resolves almost immediately; the reachable case costs
    // one cheap GET and sends no key. Resolves "ok" | "blocked" | "unknown".
    function probeConnectivity() {
      return new Promise(function (resolve) {
        var settled = false, finish = function (v) { if (!settled) { settled = true; resolve(v); } };
        var t = setTimeout(function () { finish("unknown"); }, 2500);
        try {
          fetch("https://api.elevenlabs.io/v1/models", { method: "GET", mode: "no-cors", cache: "no-store" })
            .then(function () { clearTimeout(t); finish("ok"); }, function () { clearTimeout(t); finish("blocked"); });
        } catch (e) { clearTimeout(t); finish("blocked"); }
      });
    }
    function generateAll(key, voice, force, setStatus, setCount, genBtn, onDone) {
      var cues = allCues();
      var todo = cues.filter(function (c) { return force || !hasClip(cueKey(c.si, c.step)); });
      if (!todo.length) { setStatus("All clips already generated."); if (onDone) onDone(0); return; }
      genBtn.disabled = true; genBtn.style.opacity = "0.6"; genBtn.textContent = "Generating…";
      var i = 0, failed = 0;
      function next() {
        if (i >= todo.length) {
          genBtn.disabled = false; genBtn.style.opacity = "1"; genBtn.textContent = "Generate narration";
          setStatus(failed ? (failed + " clip(s) failed — check key/voice and retry.") : "Done. Narration ready.");
          setNarration(true);
          setBarState();
          if (onDone) onDone(failed);
          return;
        }
        var c = todo[i];
        setStatus("Generating " + (i + 1) + " of " + todo.length + " — slide " + (c.si + 1) + (c.step ? (", step " + c.step) : ""));
        fetch(ttsURL(voice), {
          method: "POST",
          headers: { "xi-api-key": key, "Content-Type": "application/json", "Accept": "audio/mpeg" },
          body: JSON.stringify({
            text: c.text, model_id: MODEL_ID,
            voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.0, use_speaker_boost: true }
          })
        }).then(function (r) {
          if (!r.ok) return r.text().then(function (t) { throw new Error("HTTP " + r.status + " " + t.slice(0, 120)); });
          return r.blob();
        }).then(function (blob) {
          var cue = cueKey(c.si, c.step);
          var old = clips[cue]; if (old && !old.baked) { try { URL.revokeObjectURL(old.url); } catch (e) {} }
          clips[cue] = { url: URL.createObjectURL(blob), voiceId: voice };
          return idbPut(voice + "|" + cue, { blob: blob, text: c.text, voiceId: voice });
        }).then(function () {
          i++; setCount(); setBarState(); next();
        }).catch(function (err) {
          var msg = err && err.message ? err.message : "failed";
          // An HTTP error (we threw "HTTP 401 …") means we reached ElevenLabs —
          // bad key/voice, fixable. A bare fetch rejection means the connection
          // itself was refused (CSP/offline/DNS). If that happens on the very
          // first clip it's almost always the environment, not the deck — most
          // notably the Claude web app preview, whose CSP blocks the request.
          // Stop and say so plainly rather than failing every clip identically.
          if (!/^HTTP \d/.test(msg) && i === 0) {
            genBtn.disabled = false; genBtn.style.opacity = "1"; genBtn.textContent = "Generate narration";
            setStatus("Can’t reach the audio service from here — this environment blocks it (e.g. the Claude web app preview). Switching to the web hand-off, where it works…");
            if (onDone) onDone(todo.length);
            if (switchToWebHandoff) switchToWebHandoff(); else openWebStudio();
            return;
          }
          failed++; i++; setCount();
          setStatus("Error on slide " + (c.si + 1) + ": " + msg);
          // brief pause then continue so one failure doesn't abort everything
          setTimeout(next, 400);
        });
      }
      next();
    }

    // ---- download baked audio JS ---------------------------------------
    function blobToDataURL(blob) {
      return new Promise(function (res) { var fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.readAsDataURL(blob); });
    }
    function downloadAudioJs(setStatus) {
      var present = allCues().filter(function (c) { return hasClip(cueKey(c.si, c.step)); });
      if (!present.length) { setStatus("Nothing to download yet — generate first."); return; }
      setStatus("Packaging " + present.length + " clips…");
      // Build cue → (lazy) data-URL resolver. Prefer IndexedDB blobs, then fall
      // back to the in-memory clips. The fallback matters: where the cache is
      // blocked (a sandboxed iframe, or Safari/Firefox from file://) IndexedDB
      // is empty, so without this a browser could generate clips yet never save
      // them — the in-memory object URLs are the only copy.
      idbGetAll().then(function (all) {
        var byCue = {}, voice = null;
        Object.keys(all).forEach(function (k) {
          var bar = k.indexOf("|"); if (bar < 0) return;
          var cue = k.slice(bar + 1); var rec = all[k];
          if (!rec || !rec.blob) return;
          var si = parseInt(cue.split(":")[0], 10), step = parseInt(cue.split(":")[1], 10);
          if (rec.text != null && rec.text !== lineFor(si, step)) return;
          byCue[cue] = (function (blob) { return function () { return blobToDataURL(blob); }; })(rec.blob);
          voice = voice || k.slice(0, bar);
        });
        // Fill any gaps from memory (freshly generated, not yet/never cached).
        present.forEach(function (c) {
          var cue = cueKey(c.si, c.step);
          if (byCue[cue]) return;
          var clip = clips[cue];
          if (!clip || !clip.url) return;
          if (clip.baked || clip.url.indexOf("data:") === 0) {
            byCue[cue] = (function (durl) { return function () { return Promise.resolve(durl); }; })(clip.url);
            return;
          }
          voice = voice || clip.voiceId;
          byCue[cue] = (function (url) { return function () {
            return fetch(url).then(function (r) { return r.blob(); }).then(blobToDataURL);
          }; })(clip.url);
        });
        var keys = Object.keys(byCue);
        if (!keys.length) { setStatus("No downloadable clips found."); return; }
        var out = {}; var j = 0;
        (function step() {
          if (j >= keys.length) {
            var js = "/* Generated narration audio. voice=" + voice + " */\nwindow.__NARRATION_AUDIO = " + JSON.stringify(out) + ";\n";
            var blob = new Blob([js], { type: "text/javascript" });
            var a = document.createElement("a");
            a.href = URL.createObjectURL(blob); a.download = "narration-audio.js";
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            setTimeout(function () { try { URL.revokeObjectURL(a.href); } catch (e) {} }, 2000);
            setStatus("Downloaded narration-audio.js (" + Object.keys(out).length + " clips).");
            return;
          }
          byCue[keys[j]]()
            .then(function (durl) { if (durl) out[keys[j]] = durl; j++; step(); })
            .catch(function () { j++; step(); }); // skip a clip we couldn't read
        })();
      });
    }

    // ---- boot data ------------------------------------------------------
    loadBaked();
    openDB().then(loadCache).then(function () { setBarState(); });
    setBarState();

    // ---- console command to open the generation studio ------------------
    // Hidden from the deck UI so presenters aren't confused by it. Open with
    // deckNarration.studio() from the browser dev console.
    window.deckNarration = {
      studio: openStudio,
      play: function () { startAutoplay(); },
      stop: function () { stopAutoplay(false); },
      narration: function (on) { setNarration(on !== false); },
      status: function () {
        var have = 0, total = allCues().length;
        allCues().forEach(function (c) { if (hasClip(cueKey(c.si, c.step))) have++; });
        return { clips: have + "/" + total, narrationOn: narrationOn, autoplay: autoplay };
      }
    };
    try {
      console.log(
        "%c🎙 Narration audio studio%c\n\n" +
        "While authoring, use the blue Studio button in the control bar —\n" +
        "Audio Studio, Cue overview, Build preview, and Publish. (It's hidden\n" +
        "in the published standalone.) Or from the console:\n\n" +
        "%c    deckNarration.studio()    %c\n\n" +
        "Other commands:\n" +
        "  deckNarration.play()            – start auto-play with narration\n" +
        "  deckNarration.stop()            – stop auto-play\n" +
        "  deckNarration.narration(true)   – turn narration on (false = off)\n" +
        "  deckNarration.status()          – how many clips are generated\n\n" +
        "Tip: generate in Chrome or Edge (or over a local http server). Click\n" +
        "“Download audio” before reloading — until baked, the clips live only\n" +
        "in this browser. Once baked, the deck plays offline in every browser.\n",
        "background:#007BC0;color:#fff;padding:4px 10px;border-radius:5px;font-weight:700;font-size:13px",
        "color:#2E3033;font-size:12px",
        "background:#EAF3FB;color:#00629A;padding:3px 8px;border-radius:4px;font-weight:700;font-family:monospace;font-size:13px",
        "color:#71767C;font-size:12px"
      );
    } catch (e) {}

    // print: hide chrome
    var st = document.createElement("style");
    st.textContent = "@media print{.deck-narr-bar,.export-hidden{display:none !important;}}";
    document.head.appendChild(st);
  }

  // ---- deferred boot ----------------------------------------------------
  var tries = 0;
  function tryRun() {
    var stage = document.querySelector("deck-stage");
    if (stage && stage.querySelectorAll("section").length > 0) { run(stage); return true; }
    return false;
  }
  function boot() { if (tryRun()) return; if (++tries < 600) setTimeout(boot, 50); }
  if (window.customElements && customElements.whenDefined) {
    customElements.whenDefined("deck-stage").then(function () { setTimeout(tryRun, 0); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
