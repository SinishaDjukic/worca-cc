// The Design preview bridge: contract C-6 over postMessage between the stage (the parent) and one
// preview frame. A classic script, inlined first in <head> of the build doc and the run doc. It is only
// ever read as text, never imported or required. Under the docs' CSP it uses no eval, no Function and
// no string timers. It stays inert unless the URL carries `#n=<nonce>` and a `/build/` or `/run/` path.
(function () {
  'use strict';

  var NS = 'worca-design';
  var VERSION = 1;
  // P1's section id rule and section cap (src/core/design/ids.mjs); a classic script cannot import them.
  var SECTION_ID_RE = /^[a-z][a-z0-9-]{0,31}$/;
  var MAX_SECTIONS = 40;
  var ERR_MESSAGE_MAX = 300;
  var NONCE_RE = /^#n=([^&#]{1,256})/;
  var MODE_RE = /\/(build|run)\/[^/]*$/;
  var PARENT_TYPES = ['hello', 'plan', 'section', 'css', 'scroll', 'pick', 'goto'];
  // Types each doc drops silently: the build doc has no deck to drive and nothing to pick, and the run
  // doc is the finished artifact, never merged into.
  var IGNORED = { build: ['pick', 'goto'], run: ['plan', 'section', 'css'] };

  function isSectionId(v) { return typeof v === 'string' && SECTION_ID_RE.test(v); }
  function isRev(v) { return Number.isSafeInteger(v) && v >= 0; }
  function isFiniteNumber(v) { return typeof v === 'number' && isFinite(v); }

  // The C-6 body check: '' for a good body, else what is wrong with it. Message data is not of this
  // realm, so arrays are tested with Array.isArray, never instanceof.
  function bodyProblem(d) {
    switch (d.t) {
      case 'hello':
        return d.mode === 'build' || d.mode === 'run' ? '' : 'hello.mode must be "build" or "run"';
      case 'plan':
        if (!Array.isArray(d.sections)) return 'plan.sections must be an array';
        if (d.sections.length > MAX_SECTIONS) return 'plan.sections holds more than ' + MAX_SECTIONS + ' sections';
        for (var i = 0; i < d.sections.length; i++) {
          var s = d.sections[i];
          if (!s || typeof s !== 'object' || !isSectionId(s.id)) return 'plan.sections[' + i + '].id is not a section id';
        }
        return '';
      case 'section':
        if (!isSectionId(d.id)) return 'section.id is not a section id';
        if (!isRev(d.rev)) return 'section.rev must be a non-negative integer';
        if (typeof d.html !== 'string') return 'section.html must be a string';
        return typeof d.final === 'boolean' ? '' : 'section.final must be a boolean';
      case 'css':
        // `tokens` and `global` match the section id rule too; P1 refuses them as section ids.
        if (!isSectionId(d.file)) return 'css.file must be tokens, global or a section id';
        if (!isRev(d.rev)) return 'css.rev must be a non-negative integer';
        if (typeof d.text !== 'string') return 'css.text must be a string';
        return typeof d.final === 'boolean' ? '' : 'css.final must be a boolean';
      case 'scroll':
        // A section id (P3, for decks) or a numeric top (the camera); `ms` is optional.
        if (!isSectionId(d.id) && !isFiniteNumber(d.y)) return 'scroll needs a section id or a finite y';
        return d.ms === undefined || (isFiniteNumber(d.ms) && d.ms >= 0) ? '' : 'scroll.ms must be a finite number of at least 0';
      case 'pick':
        return typeof d.on === 'boolean' ? '' : 'pick.on must be a boolean';
      case 'goto':
        return isRev(d.index) ? '' : 'goto.index must be a non-negative integer';
    }
    return '';
  }

  // A canvas without a finite positive width is no canvas, so nothing can overflow it.
  function canvasOf(c) {
    if (!c || typeof c !== 'object' || typeof c.w !== 'number' || !isFinite(c.w) || c.w <= 0) return null;
    return { w: c.w, h: typeof c.h === 'number' && isFinite(c.h) && c.h > 0 ? c.h : 0 };
  }

  // Elements whose content runs to their own close tag. Until that arrives, the cut is at the start tag.
  var RAW_TEXT = ['script', 'style', 'textarea', 'title', 'xmp', 'noembed', 'noframes', 'iframe'];
  var RAW_NAME_MAX = 8;
  // The longest run of `[#0-9A-Za-z]` after a trailing `&` that is still cut as an unfinished reference.
  var ENTITY_MAX = 40;

  function isLetter(c) { return (c >= 65 && c <= 90) || (c >= 97 && c <= 122); }
  function isTagSpace(c) { return c === 9 || c === 10 || c === 12 || c === 13 || c === 32; }
  function isEntityChar(c) { return c === 35 || (c >= 48 && c <= 57) || isLetter(c); }
  function asciiLower(s) { return s.replace(/[A-Z]/g, function (m) { return m.toLowerCase(); }); }

  // Past the end of the tag name that starts at `j`: a name runs to a space, `/` or `>`.
  function nameEnd(s, j) {
    var n = s.length;
    for (; j < n; j++) {
      var c = s.charCodeAt(j);
      if (isTagSpace(c) || c === 47 || c === 62) break;
    }
    return j;
  }

  // Past the `>` that closes a tag whose attributes start at `j`, or -1 while it is unfinished. As in
  // the tokenizer, a quote opens a value only right after `=`, so `<p "a>` is closed and `<p a="b>` is not.
  function attrsEnd(s, j) {
    var n = s.length;
    while (j < n) {
      var c = s.charCodeAt(j++);
      if (c === 62) return j;
      if (c !== 61) continue;
      while (j < n && isTagSpace(s.charCodeAt(j))) j++;
      c = s.charCodeAt(j);
      if (c === 34 || c === 39) {
        j = s.indexOf(s.charAt(j), j + 1);
        if (j === -1) return -1;
        j++;
      }
    }
    return -1;
  }

  // Past the first `>` at or after `j`, or -1: a doctype, `<?...>` and other bogus comments end there.
  function gtEnd(s, j) {
    var k = s.indexOf('>', j);
    return k === -1 ? -1 : k + 1;
  }

  // Past the end of a comment whose opening dashes are at `j`, or -1. Like the tokenizer, a `-` `-` `>`
  // may reuse the opening dashes (an empty comment closes at once); `-` `-` `!` `>` needs dashes of its own.
  function commentEnd(s, j) {
    for (var k = j; (k = s.indexOf('--', k)) !== -1; k++) {
      var c = s.charCodeAt(k + 2);
      if (c === 62) return k + 3;
      if (c === 33 && k >= j + 2 && s.charCodeAt(k + 3) === 62) return k + 4;
    }
    return -1;
  }

  // Past the close tag of the raw-text element `name` whose content starts at `j`, or -1 until the whole
  // close tag has arrived.
  function rawTextEnd(s, j, name) {
    var n = s.length;
    for (var k = j; (k = s.indexOf('</', k)) !== -1; k += 2) {
      var after = k + 2 + name.length;
      if (after >= n) return -1;
      var c = s.charCodeAt(after);
      if ((isTagSpace(c) || c === 47 || c === 62) && asciiLower(s.slice(k + 2, after)) === name) return attrsEnd(s, after);
    }
    return -1;
  }

  // A streamed HTML prefix, minus a trailing unfinished construct: a tag (quote-aware), a comment or
  // other markup declaration, a raw-text element without its close tag, a lone `<`, a character
  // reference or half a surrogate pair. One forward scan: every position is read a bounded number of times.
  function safePrefix(html) {
    var s = String(html);
    var n = s.length;
    var i = 0;
    for (var lt; (lt = s.indexOf('<', i)) !== -1;) {
      if (lt === n - 1) return s.slice(0, lt);
      var c = s.charCodeAt(lt + 1);
      var end;
      if (isLetter(c)) {
        var ne = nameEnd(s, lt + 1);
        end = attrsEnd(s, ne);
        if (end !== -1 && ne - lt - 1 <= RAW_NAME_MAX) {
          var name = asciiLower(s.slice(lt + 1, ne));
          if (RAW_TEXT.indexOf(name) !== -1) end = rawTextEnd(s, end, name);
        }
      } else if (c === 47) {
        end = isLetter(s.charCodeAt(lt + 2)) ? attrsEnd(s, nameEnd(s, lt + 2)) : gtEnd(s, lt + 2);
      } else if (c === 33) {
        end = s.startsWith('--', lt + 2) ? commentEnd(s, lt + 2) : gtEnd(s, lt + 2);
      } else if (c === 63) {
        end = gtEnd(s, lt + 2);
      } else {
        // `<` before anything else is text.
        i = lt + 1;
        continue;
      }
      if (end === -1) return s.slice(0, lt);
      i = end;
    }
    var last = n ? s.charCodeAt(n - 1) : 0;
    if (last >= 0xd800 && last <= 0xdbff) return s.slice(0, n - 1);
    var j = n;
    while (j > 0 && n - j < ENTITY_MAX && isEntityChar(s.charCodeAt(j - 1))) j--;
    return j > 0 && s.charCodeAt(j - 1) === 38 ? s.slice(0, j - 1) : s;
  }

  // Streamed CSS up to its last brace that closes back to depth 0. One scan that skips comments, strings
  // and escapes; an unfinished comment or string ends it.
  function cutCss(text) {
    var s = String(text);
    var n = s.length;
    var depth = 0;
    var cut = 0;
    scan: for (var i = 0; i < n; i++) {
      var c = s.charCodeAt(i);
      if (c === 47 && s.charCodeAt(i + 1) === 42) {
        i = s.indexOf('*/', i + 2);
        if (i === -1) break;
        i++;
      } else if (c === 34 || c === 39) {
        // A string ends at its own quote, or (a bad string) before a newline.
        for (i++; ; i++) {
          if (i >= n) break scan;
          var d = s.charCodeAt(i);
          if (d === c) break;
          if (d === 10 || d === 12 || d === 13) { i--; break; }
          if (d === 92) i++;
        }
      } else if (c === 92) {
        i++;
      } else if (c === 123) {
        depth++;
      } else if (c === 125 && depth > 0 && --depth === 0) {
        cut = i + 1;
      }
    }
    return s.slice(0, cut);
  }

  // What a section's markup may not bring into the build doc: elements that run code, load another page
  // or navigate the frame (a `<meta http-equiv>` refresh needs no script). The doc's CSP is the real
  // guard; this strip is what an offline test can prove.
  var STRIP_SELECTOR = 'script,iframe,frame,frameset,object,embed,applet,base,meta[http-equiv]';
  // SVG animations, which go when they animate a link's `href`: the browser follows the animated value, and
  // no attribute shows it.
  var ANIMATIONS = 'set,animate';
  // `href`, `xlink:href` or any other prefix, as `attributeName` names it.
  var HREF_NAME_RE = /(^|:)href$/;
  var URL_ATTRS = ['href', 'xlink:href', 'src', 'action', 'formaction', 'data'];
  // The URL parser trims control characters and spaces and drops tabs and newlines inside a scheme, so
  // all of them go before the scheme test: code points 0 to 32.
  var URL_JUNK_RE = /[\x00-\x20]/g;
  var SCRIPT_URL_RE = /^(javascript|vbscript):/i;
  var EST_HEIGHT_MAX = 20000;

  // One beat shared by every section and CSS file (M5, M6): at most one write of each per beat, about
  // 8 Hz. A flush does all its writes and then all its reads, so 12 live sections force one layout per
  // beat rather than one each. If a real browser stutters, a longer beat is the knob.
  var BEAT_MS = 125;
  // The settle: an opacity-only fade (so rects stay true while it plays) on the top-most elements an
  // apply added, at most SETTLE_MAX of them. The keyframes are the one value the mockup lane may retune (M4).
  var SETTLE_MS = 250;
  var SETTLE_MAX = 24;
  var SETTLE_KEYFRAMES = [{ opacity: 0.35 }, { opacity: 1 }];
  var REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
  // The ghost (P4 L4.28), the mockup's `drawLayer`: the element holding a build doc section's text tail is held
  // doubled and dimmed while it is written, then settles to crisp when the tail moves on or the text is final.
  // text-shadow and opacity only, so rects stay true. Its own animation, by id; the settle above is untouched.
  var GHOST_ID = 'worca-ghost';
  var GHOST_HOLD_MS = 600000;
  var GHOST_SETTLE_MS = 550;
  var GHOST_A = 'calc(.05em + 2.2px)';
  var GHOST_ON = { textShadow: GHOST_A + ' calc(' + GHOST_A + ' * -.8) 0 rgb(255 159 10 / .5), calc(' + GHOST_A + ' * -1.25) calc(' + GHOST_A + ' * .7) 0 rgb(255 255 255 / .34)', opacity: 0.72 };
  var GHOST_OFF = { textShadow: '0 0 0 rgb(255 159 10 / 0), 0 0 0 rgb(255 255 255 / 0)', opacity: 1 };
  // `scroll {y, ms}` (P4 L4.27): the camera's tween, by animation frames, at most this long; a timer this much
  // after its end lands it where frames do not run.
  var SCROLL_TWEEN_MAX_MS = 400;
  var SCROLL_LAND_SLACK_MS = 60;
  // What the person does in the frame that takes the scroll back from a tween.
  var PERSON_EVENTS = ['wheel', 'touchstart', 'keydown', 'pointerdown'];

  // Geometry (C-6): every rect value is finite and within ±RECT_MAX. An apply reports its newest
  // MARKS_MAX added elements, minus those that draw no box; MEDIA ones are marked `media`.
  var RECT_MAX = 2e5;
  var MARKS_MAX = 24;
  var NO_MARK = ['style', 'link', 'title', 'template'];
  var MEDIA = ['img', 'svg', 'canvas', 'video', 'picture'];
  // Text inside these is never a section's tail.
  var NO_TAIL_TEXT = ['style', 'script', 'noscript', 'template'];

  // A pick (C-6 `picked`): its selector path, collapsed text and markup, each cut to its cap.
  var PICK_PATH_MAX = 512;
  var PICK_TEXT_MAX = 200;
  var PICK_HTML_MAX = 2048;
  // `scroll.behavior` values scrollIntoView takes; anything else scrolls as `auto`.
  var SCROLL_BEHAVIORS = ['auto', 'instant', 'smooth'];

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var MATHML_NS = 'http://www.w3.org/1998/Math/MathML';

  // The descriptor of `name` on `proto` or the first prototype above it that has one.
  function descriptorOf(proto, name) {
    for (var p = proto; p; p = Object.getPrototypeOf(p)) {
      var desc = Object.getOwnPropertyDescriptor(p, name);
      if (desc) return desc;
    }
    return undefined;
  }

  // The getter, else the value, of `name` on `proto` or the first prototype above it that has one.
  function member(proto, name) {
    var desc = descriptorOf(proto, name);
    return desc && (desc.get || desc.value);
  }

  // The Node and Element members the bridge uses on nodes a section's markup can own, taken from Element.prototype at
  // boot. A form's named controls override its own members ([LegacyOverrideBuiltIns]): `<input name="getAttribute">`
  // inside a form, or anywhere with `form=` naming it, makes `form.getAttribute` that input. So none is ever read off
  // such a node: `nodeCall('getAttribute', el, name)` runs the real method and `nodeCall('parentElement', el)` the real
  // getter. `animate` is missing where the doc has no WAAPI.
  var NODE_MEMBERS = ['nodeType', 'parentNode', 'parentElement', 'firstChild', 'nextSibling', 'isConnected', 'textContent',
    'appendChild', 'insertBefore', 'isEqualNode', 'localName', 'namespaceURI', 'attributes', 'lastElementChild',
    'previousElementSibling', 'outerHTML', 'scrollWidth', 'scrollHeight', 'clientWidth', 'clientHeight', 'hasAttribute',
    'getAttribute', 'setAttribute', 'removeAttributeNode', 'querySelectorAll', 'closest', 'getBoundingClientRect', 'remove',
    'replaceWith', 'animate'];
  var NODE_API = {};
  function nodeCall(name, node) {
    return NODE_API[name].apply(node, Array.prototype.slice.call(arguments, 2));
  }

  // The members morphdom (2.7.8, morphdom-umd.js) reads or calls on the elements it merges from a node, but `id`,
  // which the bridge's `getNodeKey` reads instead (its other reads are of attributes, text, or a string it parses).
  // A form's named controls override them too, and morphdom then throws part way, walks a control as if it were the
  // form's child (for ever, when a form and a `form=` control name each other `nextSibling`), or merges stale
  // attributes and children with no error at all.
  var MORPH_MEMBERS = ['nodeName', 'nodeType', 'attributes', 'firstChild', 'nextSibling', 'parentNode', 'actualize', 'isSameNode',
    'getAttribute', 'getAttributeNS', 'hasAttribute', 'hasAttributeNS', 'setAttribute', 'setAttributeNS', 'removeAttribute',
    'removeAttributeNS', 'appendChild', 'insertBefore', 'removeChild', 'replaceChild'];

  function isScriptUrl(value) { return SCRIPT_URL_RE.test(value.replace(URL_JUNK_RE, '')); }

  // The first `max` code units of `s`, minus a high surrogate the cut would leave alone at the end.
  function cut(s, max) {
    if (s.length <= max) return s;
    var c = s.charCodeAt(max - 1);
    return s.slice(0, c >= 0xd800 && c <= 0xdbff ? max - 1 : max);
  }

  // `[data-section="<id>"]`, then `> tag:nth-of-type(n)` for each step from `root` down to `el`.
  function pickPath(id, root, el) {
    var steps = [];
    for (var node = el; node && node !== root; node = nodeCall('parentElement', node)) {
      var n = 1;
      var tag = nodeCall('localName', node);
      for (var sib = nodeCall('previousElementSibling', node); sib; sib = nodeCall('previousElementSibling', sib)) {
        if (nodeCall('localName', sib) === tag) n++;
      }
      steps.push(tag + ':nth-of-type(' + n + ')');
    }
    steps.push('[data-section="' + id + '"]');
    return cut(steps.reverse().join(' > '), PICK_PATH_MAX);
  }

  // One rect value: finite (else 0), clamped to ±RECT_MAX, rounded to 0.1 px, never -0.
  function coord(v) {
    v = Number(v);
    if (!isFinite(v)) return 0;
    return Math.round(Math.max(-RECT_MAX, Math.min(RECT_MAX, v)) * 10) / 10 || 0;
  }

  // The index of the last character of `s` that is not HTML whitespace, or -1.
  function lastInk(s) {
    for (var i = s.length - 1; i >= 0; i--) if (!isTagSpace(s.charCodeAt(i))) return i;
    return -1;
  }

  // Whether an SVG `set` or `animate` animates `href`, by any `attributeName` attribute (any case).
  function animatesHref(el) {
    var attrs = nodeCall('attributes', el);
    for (var k = 0; k < attrs.length; k++) {
      var a = attrs[k];
      if (asciiLower(a.name) === 'attributename' && HREF_NAME_RE.test(asciiLower(a.value.trim()))) return true;
    }
    return false;
  }

  // Under `root` (a template's inert content, a fragment: no named properties of its own): removes every
  // STRIP_SELECTOR element, every `set` or `animate` of `href`, every `on*` attribute, every `form` attribute and
  // every URL attribute holding a script URL; the rest of each element stays. `form` joins a control to a form
  // anywhere in the doc, which no check before a merge can see coming: a form morphdom adds, or gives an id, would
  // take a control from elsewhere, and walk it as its own member. Without it a control joins only its ancestor form.
  // Attributes go by node, so SVG's namespaced `xlink:href` goes as surely as `href`, and are read through Element's
  // own getter, so a form's `<input name="attributes">` cannot hide the form's.
  function strip(root) {
    var bad = root.querySelectorAll(STRIP_SELECTOR);
    for (var i = 0; i < bad.length; i++) nodeCall('remove', bad[i]);
    var anims = root.querySelectorAll(ANIMATIONS);
    for (var m = 0; m < anims.length; m++) if (animatesHref(anims[m])) nodeCall('remove', anims[m]);
    var all = root.querySelectorAll('*');
    for (var j = 0; j < all.length; j++) {
      var el = all[j];
      var attrs = Array.prototype.slice.call(nodeCall('attributes', el));
      for (var k = 0; k < attrs.length; k++) {
        var name = asciiLower(attrs[k].name);
        if (name.slice(0, 2) === 'on' || name === 'form' || (URL_ATTRS.indexOf(name) !== -1 && isScriptUrl(attrs[k].value))) {
          nodeCall('removeAttributeNode', el, attrs[k]);
        }
      }
    }
  }

  // Whether following `link` could leave the doc: it stays only when every URL it holds is a same-doc
  // `#<name>`. `href` and `xlink:href` by attribute, never a `[href]` selector (which misses an SVG link with
  // only `xlink:href`), present even when empty: `href=""` and a bare `href` reload the frame without its
  // `#n=`. An SVG link also follows its animated href (a SMIL `set` or `animate`), which no attribute shows.
  function navigates(link) {
    var urls = [];
    if (nodeCall('hasAttribute', link, 'href')) urls.push(nodeCall('getAttribute', link, 'href'));
    if (nodeCall('hasAttribute', link, 'xlink:href')) urls.push(nodeCall('getAttribute', link, 'xlink:href'));
    var animated = link.href;
    if (animated && typeof animated === 'object' && typeof animated.animVal === 'string' && (urls.length || animated.animVal)) urls.push(animated.animVal);
    for (var i = 0; i < urls.length; i++) if (urls[i].length < 2 || urls[i].charAt(0) !== '#') return true;
    return false;
  }

  function boot(win) {
    var doc = win.document;
    // Read once, now: a run doc's deck-stage rewrites the hash to `#<slide>` later.
    var nonceMatch = NONCE_RE.exec(win.location.hash);
    var modeMatch = MODE_RE.exec(win.location.pathname);
    if (!nonceMatch || !modeMatch) return;
    var nonce = nonceMatch[1];
    var mode = modeMatch[1];

    // Document's own methods and getters, taken now from its prototype chain: Document's named properties
    // override its built-ins, so a section's `<img name="querySelector">` makes `document.querySelector`
    // that img, in this doc and in every reload of it, and shell markup before an explicit `<head>` is in
    // the doc before this script runs. The bridge never reads one off `doc`; `docCall('body')` and
    // `docCall('querySelector', sel)` call the real one.
    var DOC_API = {};
    ['createElement', 'createElementNS', 'querySelector', 'querySelectorAll', 'createTreeWalker', 'createRange', 'head', 'body', 'documentElement',
      'addEventListener', 'readyState'].forEach(function (name) {
      DOC_API[name] = member(Object.getPrototypeOf(doc), name);
    });
    function docCall(name) {
      return DOC_API[name].apply(doc, Array.prototype.slice.call(arguments, 1));
    }
    // The same for every node a section's markup can own (NODE_MEMBERS, nodeCall).
    NODE_MEMBERS.forEach(function (name) { NODE_API[name] = member(win.Element.prototype, name); });
    // What an element reads under each of MORPH_MEMBERS when no control overrides it (`actualize`: nothing).
    var MORPH_REAL = MORPH_MEMBERS.map(function (name) { return { name: name, desc: descriptorOf(win.Element.prototype, name) }; });

    var greeted = false;
    var kind = null;
    var canvas = null;
    // Section id -> element count of its root (the root included). `layers` is their sum: the
    // doc-wide count now, so it drops when a section shrinks.
    var counts = new Map();

    function post(t, fields) {
      win.parent.postMessage(Object.assign({ ns: NS, v: VERSION, n: nonce, t: t }, fields), '*');
    }

    function fail(code, message) {
      post('err', { code: code, message: String(message).slice(0, ERR_MESSAGE_MAX) });
    }

    function layers() {
      var sum = 0;
      counts.forEach(function (c) { sum += c; });
      return sum;
    }

    // A viewport rect as C-6's [x, y, w, h] in document coordinates.
    function docRect(r) {
      return [coord(r.x + win.scrollX), coord(r.y + win.scrollY), coord(r.width), coord(r.height)];
    }

    // Element and whitespace-only text are skipped (walked through or past); the NO_TAIL_TEXT elements
    // are rejected with everything inside them.
    var TAIL_FILTER = {
      acceptNode: function (node) {
        if (nodeCall('nodeType', node) === 1) {
          return NO_TAIL_TEXT.indexOf(nodeCall('localName', node)) !== -1 ? win.NodeFilter.FILTER_REJECT : win.NodeFilter.FILTER_SKIP;
        }
        return lastInk(node.data) === -1 ? win.NodeFilter.FILTER_SKIP : win.NodeFilter.FILTER_ACCEPT;
      },
    };

    // Where a section's content ends: a Range over the last character of its last text with ink (a
    // whole surrogate pair), tagged with that text's element, when the doc has Range rects and this one
    // is not empty; `box` is that element's rect. Else the deepest last element, following lastElementChild
    // past style elements, with `box` equal to `rect`. `el` and `isText` stay in the bridge (the ghost): `isText`
    // whenever such a text exists, even with an empty Range rect, and `el` is then its element.
    function tailOf(root) {
      var text = docCall('createTreeWalker', root, win.NodeFilter.SHOW_ELEMENT | win.NodeFilter.SHOW_TEXT, TAIL_FILTER).lastChild();
      var holder = text ? nodeCall('parentElement', text) : null;
      if (text && win.Range && typeof win.Range.prototype.getBoundingClientRect === 'function') {
        var s = text.data;
        var end = lastInk(s) + 1;
        var start = end - 1;
        var lo = s.charCodeAt(start);
        if (start > 0 && lo >= 0xdc00 && lo <= 0xdfff) {
          var hi = s.charCodeAt(start - 1);
          if (hi >= 0xd800 && hi <= 0xdbff) start--;
        }
        var range = docCall('createRange');
        range.setStart(text, start);
        range.setEnd(text, end);
        var r = range.getBoundingClientRect();
        if (r.width > 0 || r.height > 0) {
          return { rect: docRect(r), tag: nodeCall('localName', holder), box: docRect(nodeCall('getBoundingClientRect', holder)), el: holder, isText: true };
        }
      }
      var el = root;
      for (var c = nodeCall('lastElementChild', el); c; c = nodeCall('lastElementChild', el)) {
        while (c && nodeCall('localName', c) === 'style') c = nodeCall('previousElementSibling', c);
        if (!c) break;
        el = c;
      }
      var rect = docRect(nodeCall('getBoundingClientRect', el));
      return { rect: rect, tag: nodeCall('localName', el), box: rect, el: holder || el, isText: !!text };
    }

    // The newest MARKS_MAX elements an apply added (it lists them in doc order), in doc order.
    function marksOf(added) {
      var marks = [];
      for (var i = added.length - 1; i >= 0 && marks.length < MARKS_MAX; i--) {
        var el = added[i];
        var tag = nodeCall('localName', el);
        if (NO_MARK.indexOf(tag) !== -1) continue;
        marks.push({ rect: docRect(nodeCall('getBoundingClientRect', el)), tag: tag, kind: MEDIA.indexOf(tag) !== -1 ? 'media' : 'el' });
      }
      return marks.reverse();
    }

    // No canvas from hello: never. A deck or video tile (the canvas has a height) against its own box,
    // so a board scale cannot hide it (M9). A web section by its doc-coordinate edges and scroll width
    // against the canvas width, so one narrower than the canvas still trips it when it pokes past (M5).
    function overflows(root, rect) {
      if (!canvas) return false;
      if (canvas.h) {
        return nodeCall('scrollWidth', root) > nodeCall('clientWidth', root) + 1
          || nodeCall('scrollHeight', root) > nodeCall('clientHeight', root) + 1;
      }
      return rect[0] + rect[2] > canvas.w + 1 || rect[0] < -1 || nodeCall('scrollWidth', root) > canvas.w + 1;
    }

    // One `applied` for `root`, its geometry read now: a flush calls it only after all its writes. Returns the
    // tail (tailOf), whose `el` and `isText` it does not post.
    function postApplied(id, rev, added, root, marks) {
      var rect = docRect(nodeCall('getBoundingClientRect', root));
      var tail = tailOf(root);
      post('applied', { id: id, rev: rev, added: added, layers: layers(), rect: rect, tail: { rect: tail.rect, tag: tail.tag, box: tail.box },
        marks: marks, overflow: overflows(root, rect) });
      return tail;
    }

    // The next animation frame; a 16 ms timer where requestAnimationFrame is missing (jsdom without
    // pretendToBeVisual).
    function onFrame(fn) {
      return typeof win.requestAnimationFrame === 'function' ? win.requestAnimationFrame(fn) : win.setTimeout(fn, 16);
    }

    // The one place of each section, which applies, rects, hello and plans all use: `{id, el, root}` for every valid
    // id that has one, in doc order, `root` false for a slot. One read of the doc, linear in its size.
    //
    // A section is guarded once it is planned (before the first plan: once it has a slot or its text has arrived). The
    // nodes of a section with a root this bridge applied are that root alone, planned or not; a guarded section's are
    // otherwise every element marking its id (`data-section` or a slot) but its links and parts inside another guarded
    // section's element. A `[data-section]` is a root unless it is the doc's own html, head or body (a merge would
    // replace the page), sits inside another root, or holds every node of such a section: only then would a merge into
    // it wipe that section (a shell's `<main data-section="price">` or band around the sections). So a nav, a table of
    // contents or a footer whose links carry other sections' ids stays a root while those sections have a node of their
    // own, and every marked element inside a root is that section's own markup, standing for no section. Each id takes
    // its applied root, else its first root (a root before a slot, wherever the slot stands), else its first slot
    // outside every root.
    function sectionPlaces() {
      var all = docCall('querySelectorAll', '[data-section],[data-worca-slot]');
      var n = all.length;
      var i, j, p, id, el;
      var at = new Map();
      var ids = [];
      var marked = [];
      for (i = 0; i < n; i++) {
        at.set(all[i], i);
        marked.push(nodeCall('hasAttribute', all[i], 'data-section'));
        ids.push(nodeCall('getAttribute', all[i], marked[i] ? 'data-section' : 'data-worca-slot'));
      }
      // The nearest marked ancestor of each, as a position in `all` (-1: none). An unmarked ancestor keeps its answer
      // for every later walk through it, so each element is walked once.
      var above = new Map();
      var parent = [];
      for (i = 0; i < n; i++) {
        var walked = [];
        var a = nodeCall('parentElement', all[i]);
        while (a && !at.has(a) && !above.has(a)) {
          walked.push(a);
          a = nodeCall('parentElement', a);
        }
        p = !a ? -1 : at.has(a) ? at.get(a) : above.get(a);
        for (j = 0; j < walked.length; j++) above.set(walked[j], p);
        parent.push(p);
      }
      // Each root this bridge applied that is still in the doc (it always carries its own `data-section`).
      var applied = new Map();
      roots.forEach(function (root, rid) {
        var k = at.get(root);
        if (k !== undefined) applied.set(rid, k);
      });
      var guarded = new Set();
      if (plannedIds) {
        plannedIds.forEach(function (pid) { guarded.add(pid); });
      } else {
        for (i = 0; i < n; i++) if (!marked[i] && isSectionId(ids[i])) guarded.add(ids[i]);
        revs.forEach(function (_, key) { if (key.slice(0, 8) === 'section:') guarded.add(key.slice(8)); });
      }
      // The first and last node of each guarded section, in doc order. They leave out its links and parts: a
      // `[data-section]` of it inside an element that marks a guarded section (a nav's `<a data-section="price">`), never
      // a slot. When nothing else marks it, every element does. (One of its own inside its own outer element is left out
      // too, which changes nothing: that outer element counts.) `under` is whether such an element is at or above each.
      var shell = [docCall('documentElement'), docCall('head'), docCall('body')];
      var under = [];
      var first = new Map();
      var last = new Map();
      var firstAny = new Map();
      var lastAny = new Map();
      for (i = 0; i < n; i++) {
        p = parent[i];
        id = ids[i];
        var inside = p >= 0 && under[p];
        under.push(inside || (marked[i] && guarded.has(id) && shell.indexOf(all[i]) === -1));
        if (!guarded.has(id) || applied.has(id)) continue;
        if (!firstAny.has(id)) firstAny.set(id, i);
        lastAny.set(id, i);
        if (marked[i] && inside) continue;
        if (!first.has(id)) first.set(id, i);
        last.set(id, i);
      }
      firstAny.forEach(function (k, fid) {
        if (first.has(fid)) return;
        first.set(fid, k);
        last.set(fid, lastAny.get(fid));
      });
      applied.forEach(function (k, rid) { first.set(rid, k); last.set(rid, k); });
      // A marked element's marked descendants are the positions after it up to `end`. It holds every node of a guarded
      // section when that section's first node is one of them and its last is at or before `end`: `low` is the smallest
      // last node of a section whose first node is a descendant.
      var lastOf = [];
      var end = [];
      var low = [];
      for (i = 0; i < n; i++) {
        lastOf.push(Infinity);
        end.push(i);
        low.push(Infinity);
      }
      first.forEach(function (k, fid) { lastOf[k] = last.get(fid); });
      for (i = n - 1; i >= 0; i--) {
        p = parent[i];
        if (p < 0) continue;
        if (end[i] > end[p]) end[p] = end[i];
        low[p] = Math.min(low[p], low[i], lastOf[i]);
      }
      var inRoot = [];
      var isRoot = [];
      var rootAt = new Map();
      var slotAt = new Map();
      for (i = 0; i < n; i++) {
        p = parent[i];
        el = all[i];
        id = ids[i];
        inRoot.push(p >= 0 && (isRoot[p] || inRoot[p]));
        isRoot.push(!inRoot[i] && marked[i] && low[i] > end[i] && shell.indexOf(el) === -1);
        if (inRoot[i] || !isSectionId(id)) continue;
        if (isRoot[i]) {
          if (!rootAt.has(id)) rootAt.set(id, i);
        } else if (!marked[i] && !slotAt.has(id)) {
          slotAt.set(id, i);
        }
      }
      var places = [];
      for (i = 0; i < n; i++) {
        id = ids[i];
        j = applied.has(id) ? applied.get(id) : rootAt.has(id) ? rootAt.get(id) : slotAt.get(id);
        if (j === i) places.push({ id: id, el: all[i], root: marked[i] });
      }
      return places;
    }

    // Section id -> its place (sectionPlaces).
    function placesById() {
      var byId = new Map();
      sectionPlaces().forEach(function (s) { byId.set(s.id, s); });
      return byId;
    }

    // Every section's root or slot (sectionPlaces), at most MAX_SECTIONS.
    function sectionNodes() {
      return sectionPlaces().slice(0, MAX_SECTIONS);
    }

    // Section id -> the root or slot the ResizeObserver watches for it. With documentElement that is at
    // most MAX_SECTIONS + 1 targets: a side-by-side neighbour can change size while the doc does not.
    var observer = null;
    var watching = false;
    var watched = new Map();

    function watch(id, el) {
      if (!observer) return;
      var prev = watched.get(id);
      if (prev === el) return;
      if (prev) observer.unobserve(prev);
      else if (watched.size >= MAX_SECTIONS) return;
      observer.observe(el);
      watched.set(id, el);
    }

    function unwatch(id) {
      var prev = watched.get(id);
      if (!observer || !prev) return;
      observer.unobserve(prev);
      watched.delete(id);
    }

    // Starts with the first rects request rather than at boot: the parent's hello follows `ready` at
    // once, and a frame nobody talks to watches nothing. From then on it watches documentElement and every
    // root and slot; applies and plans keep it current.
    function startWatching() {
      if (watching) return;
      watching = true;
      if (typeof win.ResizeObserver !== 'function') return;
      observer = new win.ResizeObserver(onLayoutChange);
      observer.observe(docCall('documentElement'));
      sectionNodes().forEach(function (s) { watch(s.id, s.el); });
    }

    // `rects` at most once per animation frame, however many scrolls, resizes, observations, hellos,
    // plans and flushes ask for it before then.
    var rectsQueued = false;
    function requestRects() {
      startWatching();
      if (rectsQueued) return;
      onFrame(sendRects);
      rectsQueued = true;
    }

    function sendRects() {
      rectsQueued = false;
      attempt(function () {
        var sections = sectionNodes().map(function (s) { return { id: s.id, rect: docRect(nodeCall('getBoundingClientRect', s.el)) }; });
        post('rects', {
          scrollX: coord(win.scrollX), scrollY: coord(win.scrollY), vw: coord(win.innerWidth), vh: coord(win.innerHeight),
          docH: coord(docCall('documentElement').scrollHeight), sections: sections,
        });
      });
    }

    function onLayoutChange() { attempt(requestRects); }

    // Every section whose place is a root (sectionPlaces), in doc order.
    function sectionRoots() {
      return sectionPlaces().filter(function (s) { return s.root; });
    }

    // The first matching hello reports what the doc already holds, at once and outside any pacing, so a
    // late join does not show 0 layers beside a finished page: one `applied` rev 0 per root, with the
    // same geometry as any other and no marks. A later one only updates kind and canvas. Each asks for rects.
    function onHello(d) {
      if (d.mode !== mode) {
        fail('mode-mismatch', 'hello.mode is "' + d.mode + '" but this frame holds the ' + mode + ' doc');
        return;
      }
      kind = typeof d.kind === 'string' ? d.kind : null;
      canvas = canvasOf(d.canvas);
      if (!greeted) {
        greeted = true;
        var roots = sectionRoots();
        roots.forEach(function (r) { counts.set(r.id, 1 + nodeCall('querySelectorAll', r.el, '*').length); });
        roots.forEach(function (r) { attempt(function () { postApplied(r.id, 0, counts.get(r.id), r.el, []); }); });
      }
      requestRects();
    }

    // The last rev seen per key (`css:<file>`, `section:<id>`): a rev at or below it is stale and dropped
    // on arrival.
    var revs = new Map();
    function isFresh(key, rev) {
      if (revs.has(key) && rev <= revs.get(key)) return false;
      revs.set(key, rev);
      return true;
    }

    // The file's `<style data-worca-css>`, reused where it stands, else made in head order: `tokens`
    // before every other one, `global` before the first section's, a section's at the end of `<head>`.
    function cssStyle(file) {
      var all = docCall('querySelectorAll', 'style[data-worca-css]');
      var before = null;
      for (var i = 0; i < all.length; i++) {
        var name = nodeCall('getAttribute', all[i], 'data-worca-css');
        if (name === file) return all[i];
        if (!before && (file === 'tokens' || (file === 'global' && name !== 'tokens'))) before = all[i];
      }
      var style = docCall('createElement', 'style');
      style.setAttribute('data-worca-css', file);
      // A section's own `<style data-worca-css>` can sit in a form.
      if (before) nodeCall('insertBefore', nodeCall('parentNode', before), style, before);
      else docCall('head').appendChild(style);
      return style;
    }

    function writeCss(d) {
      cssStyle(d.file).textContent = d.final ? d.text : cutCss(d.text);
    }

    // Section id -> its root as last applied. morphdom hands back a new node when the root tag changes,
    // and this keeps that node.
    var roots = new Map();

    // The section's place (sectionPlaces), else null: at once its root as last applied while that is in the doc, the
    // choice sectionPlaces makes first.
    function placeOf(id) {
      var root = roots.get(id);
      if (root && nodeCall('isConnected', root)) return { id: id, el: root, root: true };
      return placesById().get(id) || null;
    }

    // The root or the slot of a section (placeOf), else null.
    function nodeOf(id) {
      var place = placeOf(id);
      return place ? place.el : null;
    }

    var MORPH_SKIP_EQUAL = function (from, to) { return !nodeCall('isEqualNode', from, to); };
    // morphdom's key for a node: its real `id` attribute. morphdom's own reads `node.id`, which a form's control
    // named `id` overrides, giving every such form the same key.
    var MORPH_KEY = function (node) { return node && nodeCall('nodeType', node) === 1 ? nodeCall('getAttribute', node, 'id') : undefined; };

    // Whether a form inside `tree` (or `tree` itself, with `self`) reads anything under one of MORPH_MEMBERS but
    // what the member itself gives: morphdom must then not merge that tree.
    function formOverridden(tree, self) {
      var forms = Array.prototype.slice.call(nodeCall('querySelectorAll', tree, 'form'));
      if (self && nodeCall('localName', tree) === 'form') forms.push(tree);
      for (var i = 0; i < forms.length; i++) {
        for (var k = 0; k < MORPH_REAL.length; k++) {
          var desc = MORPH_REAL[k].desc;
          var real = !desc ? undefined : desc.get ? desc.get.call(forms[i]) : desc.value;
          if (forms[i][MORPH_REAL[k].name] !== real) return true;
        }
      }
      return false;
    }

    // `el` in place of `old` (a slot, or a root put in whole): every element it holds is new.
    function putWhole(old, el) {
      var added = [el].concat(Array.prototype.slice.call(nodeCall('querySelectorAll', el, '*')));
      nodeCall('replaceWith', old, el);
      return added;
    }

    // A section prefix as the doc takes it: an inert parse (of the text up to its last complete construct
    // unless final), the strip, then its first element, carrying the section id; null while it holds none.
    function parseSection(id, html, final) {
      var tpl = docCall('createElement', 'template');
      tpl.innerHTML = final ? html : safePrefix(html);
      strip(tpl.content);
      var next = tpl.content.firstElementChild;
      if (next) nodeCall('setAttribute', next, 'data-section', id);
      return next;
    }

    // One section prefix into the doc: its parse merged into the root where it stands, or put in place of
    // the section's slot wherever that sits (placeOf). Re-counts this root only. Returns the elements the apply
    // added (a new root first), or null when nothing was applied.
    function applySection(id, html, final) {
      var next = parseSection(id, html, final);
      if (!next) return null;
      var added = [];
      var place = placeOf(id);
      if (!place) {
        fail('no-slot', 'section "' + id + '" has no root and no slot in this doc');
        return null;
      }
      var root = place.el;
      if (place.root) {
        if (typeof win.morphdom !== 'function') throw new Error('morphdom is not loaded in this doc');
        var ns = nodeCall('namespaceURI', next);
        var tag = nodeCall('localName', next);
        var sameTag = nodeCall('namespaceURI', root) === ns && nodeCall('localName', root) === tag;
        // A form whose controls override what morphdom reads (MORPH_MEMBERS), in the parse or in the doc
        // (the root itself only when morphdom merges into it, not into a new root): the parse goes in whole.
        if (formOverridden(next, true) || formOverridden(root, sameTag)) {
          added = putWhole(root, next);
          root = next;
        } else {
          try {
            if (!sameTag) {
              // A new root tag. morphdom would make the new root with `document.createElement`, which a
              // section's markup can clobber; it is made here instead, holding the old root's children, as
              // morphdom's would, and morphdom then merges into it. It carries the id at once, so the
              // section still has its root if the merge throws.
              var swap = docCall('createElementNS', ns, tag);
              nodeCall('setAttribute', swap, 'data-section', id);
              for (var child; (child = nodeCall('firstChild', root));) nodeCall('appendChild', swap, child);
              nodeCall('replaceWith', root, swap);
              root = swap;
            }
            if (!sameTag && formOverridden(root, true)) {
              // The new root is a form, and the old root's controls it now holds override what morphdom reads.
              added = putWhole(root, next);
              root = next;
            } else {
              root = win.morphdom(root, next, {
                getNodeKey: MORPH_KEY,
                onBeforeElUpdated: MORPH_SKIP_EQUAL,
                onNodeAdded: function (node) { if (nodeCall('nodeType', node) === 1) added.push(node); },
              });
            }
          } catch {
            // The swap or the merge threw part way (a tag name the parser takes but createElementNS refuses,
            // or a read that the check above does not cover), leaving a half-merged root that every later merge
            // could meet again. The section is parsed again and put in the root's place whole.
            var whole = parseSection(id, html, final);
            added = putWhole(root, whole);
            root = whole;
          }
        }
      } else {
        added = putWhole(root, next);
        root = next;
      }
      roots.set(id, root);
      watch(id, root);
      counts.set(id, 1 + nodeCall('querySelectorAll', root, '*').length);
      return added;
    }

    // The settle on what each apply added: its top-most elements only (an element whose parent the same
    // apply added fades with that parent), the first SETTLE_MAX of them. Skipped under reduced motion,
    // and where the doc has no WAAPI.
    function settle(applied) {
      if (reducedMotion() || typeof NODE_API.animate !== 'function') return;
      applied.forEach(function (a) {
        var mine = new Set(a.added);
        for (var i = 0, n = 0; i < a.added.length && n < SETTLE_MAX; i++) {
          var el = a.added[i];
          if (mine.has(nodeCall('parentNode', el))) continue;
          n++;
          nodeCall('animate', el, SETTLE_KEYFRAMES, { duration: SETTLE_MS, easing: 'ease-out' });
        }
      });
    }

    function reducedMotion() { return !!win.matchMedia?.(REDUCED_MOTION)?.matches; }

    // Section id -> its ghost: `{el, anim}`, the element held and that hold's Animation.
    var ghosts = new Map();

    // A held ghost's end: the hold cancelled and, while its element is in the doc, the settle to crisp.
    function settleGhost(g) {
      if (g.anim && typeof g.anim.cancel === 'function') g.anim.cancel();
      if (nodeCall('isConnected', g.el)) nodeCall('animate', g.el, [GHOST_ON, GHOST_OFF], { id: GHOST_ID, duration: GHOST_SETTLE_MS, easing: 'ease-out' });
    }

    // The ghost after one build doc apply, once its geometry is read (`tail`: tailOf). A text tail in an element
    // other than the one held settles that one and holds its own. A final apply then settles what is held, so a
    // first apply that is also final still settles. Skipped under reduced motion, and where the doc has no WAAPI.
    function ghost(id, tail, final) {
      if (reducedMotion() || typeof NODE_API.animate !== 'function') return;
      var cur = ghosts.get(id);
      if (tail.isText && (!cur || tail.el !== cur.el)) {
        if (cur) settleGhost(cur);
        cur = { el: tail.el, anim: nodeCall('animate', tail.el, [GHOST_ON, GHOST_ON], { id: GHOST_ID, duration: GHOST_HOLD_MS, fill: 'both' }) };
        ghosts.set(id, cur);
      }
      if (final && cur) {
        settleGhost(cur);
        ghosts.delete(id);
      }
    }

    // The beat's state. `pending` holds the newest unwritten message per key (`css:<file>`,
    // `section:<id>`); `cooling` is true while the beat runs; `finals` holds the keys whose final text
    // skips the rest of the wait.
    var pending = new Map();
    var cooling = false;
    var finals = new Set();
    var finalsQueued = false;

    // Writes the pending messages of `keys` (a key already written is skipped): all CSS, then all
    // sections, then the settle; only then reads, one `applied` with its geometry per section written,
    // so a flush forces one layout; then, in the build doc, the ghost of each (no layout change). Each write
    // and each read is guarded on its own, so a bad one costs only its own `apply-failed`. Then asks for
    // rects. Returns whether anything was written.
    function flush(keys) {
      var css = [];
      var sections = [];
      keys.forEach(function (key) {
        var d = pending.get(key);
        if (!d) return;
        pending.delete(key);
        (d.t === 'css' ? css : sections).push(d);
      });
      var wrote = false;
      css.forEach(function (d) {
        if (attempt(function () { writeCss(d); return true; })) wrote = true;
      });
      var applied = [];
      sections.forEach(function (d) {
        var added = attempt(function () { return applySection(d.id, d.html, d.final); });
        if (added) applied.push({ d: d, added: added });
      });
      if (applied.length) attempt(function () { settle(applied); });
      var tails = [];
      applied.forEach(function (a) {
        var tail = attempt(function () { return postApplied(a.d.id, a.d.rev, a.added.length, roots.get(a.d.id), marksOf(a.added)); });
        if (tail) tails.push({ d: a.d, tail: tail });
      });
      if (mode === 'build') tails.forEach(function (t) { attempt(function () { ghost(t.d.id, t.tail, t.d.final); }); });
      attempt(requestRects);
      return wrote || applied.length > 0;
    }

    function flushAll() {
      return flush(Array.from(pending.keys()));
    }

    // Timers only, never animation frames: a hidden tab keeps landing text.
    function onBeat() {
      if (!pending.size) {
        cooling = false;
        return;
      }
      flushAll();
      win.setTimeout(onBeat, BEAT_MS);
    }

    function onFinals() {
      finalsQueued = false;
      var keys = Array.from(finals);
      finals.clear();
      flush(keys);
    }

    // A section or CSS message: a stale rev is dropped before it is stored. Idle, it is written at once,
    // and it starts the beat only when it wrote something and is not final: a prefix with no element yet
    // cost nothing, and a final is a section's last text, which may add one apply beyond the 8 Hz. While
    // the beat runs a message waits for it, except that a final text skips the wait on one zero-delay
    // timer that writes only the final keys.
    function receive(key, d) {
      if (!isFresh(key, d.rev)) return;
      pending.set(key, d);
      if (!cooling) {
        if (flushAll() && !d.final) {
          cooling = true;
          win.setTimeout(onBeat, BEAT_MS);
        }
        return;
      }
      if (!d.final) return;
      finals.add(key);
      if (finalsQueued) return;
      finalsQueued = true;
      win.setTimeout(onFinals, 0);
    }

    function onCss(d) { receive('css:' + d.file, d); }
    function onSection(d) { receive('section:' + d.id, d); }

    // The ids of this frame's previous plan; null until the first one.
    var plannedIds = null;

    // The first comment whose data is `worca:sections`: board docs carry it, web build docs do not.
    function sectionsMarker() {
      var walker = docCall('createTreeWalker', doc, win.NodeFilter.SHOW_COMMENT);
      for (var c; (c = walker.nextNode());) if (c.data === 'worca:sections') return c;
      return null;
    }

    // A finite estHeight, clamped to 0..20000, becomes the slot's min-height, written only when it changes. The style is
    // read through the slot's own prototype: a shell slot can be a form, whose control named `style` overrides it.
    function sizeSlot(slot, h) {
      if (typeof h !== 'number' || !isFinite(h)) return;
      var px = Math.min(EST_HEIGHT_MAX, Math.max(0, h)) + 'px';
      var style = member(Object.getPrototypeOf(slot), 'style').call(slot);
      if (style.minHeight !== px) style.minHeight = px;
    }

    // Removes the ids of the previous plan that left this one (a first plan removes nothing, so a shell
    // slot the plan omits stays for lint to report): each one's place under that plan, all read before any
    // goes. Then creates a slot for each id with no place (sectionPlaces, under this plan), in the sections
    // container: right after the nearest earlier id placed there, else right before the nearest later one,
    // else before the marker, else at the end of <body>. Never moves or duplicates a node, and sizes every
    // slot from its estHeight. Then asks for rects, so a plan that only adds slots is reported too.
    function onPlan(d) {
      var ids = d.sections.map(function (s) { return s.id; });
      if (plannedIds) {
        var was = placesById();
        plannedIds.forEach(function (id) {
          if (ids.indexOf(id) !== -1) return;
          var gone = was.get(id);
          if (gone) nodeCall('remove', gone.el);
          unwatch(id);
          roots.delete(id);
          counts.delete(id);
        });
      }
      plannedIds = ids;
      var marker = sectionsMarker();
      var container = marker ? marker.parentNode : docCall('body');
      var nodes = placesById();
      function placed(id) {
        var place = nodes.get(id);
        return place && nodeCall('parentNode', place.el) === container ? place.el : null;
      }
      d.sections.forEach(function (s, i) {
        var place = nodes.get(s.id);
        if (place) {
          if (!place.root) sizeSlot(place.el, s.estHeight);
          return;
        }
        var slot = docCall('createElement', 'div');
        slot.setAttribute('data-worca-slot', s.id);
        sizeSlot(slot, s.estHeight);
        var after = null;
        var before = null;
        for (var j = i - 1; j >= 0 && !after; j--) after = placed(ids[j]);
        for (var k = i + 1; k < ids.length && !after && !before; k++) before = placed(ids[k]);
        if (after) nodeCall('insertBefore', container, slot, nodeCall('nextSibling', after));
        else if (before) nodeCall('insertBefore', container, slot, before);
        else if (marker) nodeCall('insertBefore', container, slot, marker);
        else docCall('body').appendChild(slot);
        nodes.set(s.id, { id: s.id, el: slot, root: false });
        watch(s.id, slot);
      });
      requestRects();
    }

    // Whether a click is a pick. Only the run doc takes `pick`.
    var picking = false;
    function onPick(d) { picking = d.on; }

    // The camera's tween (`scroll {y, ms}`): `{frame, timer}` while it runs, else null.
    var tween = null;
    // The top of a jump made before the doc was complete, repeated once at load (unsized images above it would
    // leave the doc short of it), else null. What the person does in the frame, or a newer scroll, drops it.
    var jumpAgain = null;

    // `win.scrollTo`, read at each call.
    function jumpTo(y) { win.scrollTo({ top: y, behavior: 'instant' }); }

    function cancelFrame(id) {
      if (typeof win.requestAnimationFrame === 'function') {
        if (typeof win.cancelAnimationFrame === 'function') win.cancelAnimationFrame(id);
      } else {
        win.clearTimeout(id);
      }
    }

    function stopTween() {
      if (!tween) return;
      cancelFrame(tween.frame);
      win.clearTimeout(tween.timer);
      tween = null;
    }

    // To `y` over at most SCROLL_TWEEN_MAX_MS, easing out (1-(1-t)^3), one instant scroll per animation frame
    // by time from performance.now(). A timer lands the end where frames stop (a hidden tab); whichever ends it
    // first clears the other.
    function tweenTo(y, ms) {
      var d = Math.min(ms, SCROLL_TWEEN_MAX_MS);
      var from = win.scrollY;
      var start = win.performance.now();
      var mine = { frame: 0, timer: 0 };
      function step() {
        if (tween !== mine) return;
        attempt(function () {
          var t = d > 0 ? Math.min(1, (win.performance.now() - start) / d) : 1;
          if (t >= 1) {
            stopTween();
            jumpTo(y);
            return;
          }
          jumpTo(from + (y - from) * (1 - Math.pow(1 - t, 3)));
          mine.frame = onFrame(step);
        });
      }
      tween = mine;
      mine.frame = onFrame(step);
      mine.timer = win.setTimeout(function () {
        if (tween !== mine) return;
        stopTween();
        attempt(function () { jumpTo(y); });
      }, d + SCROLL_LAND_SLACK_MS);
    }

    // The person took the scroll: no tween goes on, and no jump is repeated at load.
    function onPerson() {
      stopTween();
      jumpAgain = null;
    }

    function onLoad() {
      if (jumpAgain === null) return;
      var y = jumpAgain;
      jumpAgain = null;
      attempt(function () { jumpTo(y); });
    }

    // Both docs. A finite `y` (the camera): a tween with `ms` and `behavior: 'smooth'` unless the person asked
    // for reduced motion, else a jump. Otherwise the section's root, or its slot, aligned with the top of the
    // viewport (P3, for decks). Each one ends any tween, and the newest jump is the one repeated at load.
    // scrollIntoView is Element's own (a form's controls can override it), looked up here as the feature check
    // it is.
    function onScroll(d) {
      stopTween();
      jumpAgain = null;
      if (isFiniteNumber(d.y)) {
        if (d.ms === undefined || d.behavior !== 'smooth' || reducedMotion()) {
          jumpTo(d.y);
          if (docCall('readyState') !== 'complete') jumpAgain = d.y;
        } else {
          tweenTo(d.y, d.ms);
        }
        return;
      }
      var el = nodeOf(d.id);
      var into = win.Element.prototype.scrollIntoView;
      if (!el || typeof into !== 'function') return;
      into.call(el, { behavior: SCROLL_BEHAVIORS.indexOf(d.behavior) !== -1 ? d.behavior : 'auto', block: 'start' });
    }

    // Run doc only (M9: no deck navigation before round end): deck-stage's own goTo, 0-based, which clamps.
    function onGoto(d) {
      var stage = docCall('querySelector', 'deck-stage');
      if (stage && typeof stage.goTo === 'function') stage.goTo(d.index);
    }

    // Run doc only: the slide deck-stage shows now, when that slide is a section.
    function onSlideChange(e) {
      attempt(function () {
        var slide = e.detail && e.detail.slide;
        var id = slide instanceof win.Element ? nodeCall('getAttribute', slide, 'data-section') : null;
        if (isSectionId(id)) post('visible', { id: id });
      });
    }

    // A picked element inside a section: where it is, what it says, its markup and its rect.
    function reportPick(el) {
      var root = nodeCall('closest', el, '[data-section]');
      var id = root && nodeCall('getAttribute', root, 'data-section');
      if (!isSectionId(id)) return;
      post('picked', {
        id: id, path: pickPath(id, root, el), tag: nodeCall('localName', el),
        text: cut((nodeCall('textContent', el) || '').replace(/\s+/g, ' ').trim(), PICK_TEXT_MAX),
        html: cut(nodeCall('outerHTML', el), PICK_HTML_MAX), rect: docRect(nodeCall('getBoundingClientRect', el)),
      });
    }

    // Whether a click with this composed path could take the build doc away from a live stage. The whole
    // path counts, not its first link: an `a` with no href inside a link is no link, and the browser follows
    // the outer one; at the window a click in an open shadow root targets its host, and the path still holds
    // the link. Any SVG `use` counts, since its copy of a link lives in a closed shadow tree the path never
    // shows, and so does a MathML element with an `href`, which Firefox and WebKit follow.
    function leaves(path) {
      for (var i = 0; i < path.length; i++) {
        var node = path[i];
        if (!(node instanceof win.Element)) continue;
        var name = nodeCall('localName', node);
        var ns = nodeCall('namespaceURI', node);
        if ((name === 'a' || name === 'area') && navigates(node)) return true;
        if ((name === 'use' && ns === SVG_NS) || (ns === MATHML_NS && nodeCall('hasAttribute', node, 'href'))) return true;
      }
      return false;
    }

    // Captured on the window at boot, so it runs before any listener the doc's own code adds. The build
    // doc cancels a click, or a middle click's `auxclick`, that would navigate the frame away from a live
    // stage (leaves, navigates); a same-doc `#<name>` link stays. The run doc is the artifact itself: its
    // clicks pass, except that with pick on each one is swallowed and, inside a section, reported.
    function onClick(e) {
      if (mode === 'build') {
        if (leaves(e.composedPath())) e.preventDefault();
        return;
      }
      if (!picking) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      var target = e.target;
      var el = target instanceof win.Element ? target : target instanceof win.Node ? nodeCall('parentElement', target) : null;
      if (el) attempt(function () { reportPick(el); });
    }

    // Build doc only: a ctrl or meta wheel zooms the stage, never this page.
    function onZoomWheel(e) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      post('zoom', { dy: e.deltaY, y: e.clientY });
    }

    var handlers = { hello: onHello, css: onCss, plan: onPlan, section: onSection, scroll: onScroll, pick: onPick, goto: onGoto };

    // Every handler and every paced write runs inside this: a throw becomes `err {code:'apply-failed'}`
    // and a null result, never a frame error.
    function attempt(fn) {
      try {
        return fn();
      } catch (x) {
        fail('apply-failed', x && typeof x.message === 'string' ? x.message : 'apply failed');
        return null;
      }
    }

    function onMessage(e) {
      if (e.source !== win.parent) return;
      var d = e.data;
      if (!d || typeof d !== 'object' || d.ns !== NS || d.v !== VERSION || d.n !== nonce) return;
      if (PARENT_TYPES.indexOf(d.t) === -1 || IGNORED[mode].indexOf(d.t) !== -1) return;
      var problem = bodyProblem(d);
      if (problem) {
        fail('bad-message', problem);
        return;
      }
      var handler = handlers[d.t];
      if (handler) attempt(function () { handler(d); });
    }

    function ready() {
      post('ready', { mode: mode, vw: win.innerWidth, vh: win.innerHeight, dpr: win.devicePixelRatio });
    }

    // The doc's own window `load` (R16, P4): the parent counts a frame `load` as this doc's only once this report came,
    // so a page this doc navigated to, even after its `ready`, is never taken for it. Once per doc, and never for a
    // script's own `load` event: a second report would pay for the load of a page it went to later (P4 review cycle 3).
    // The boot call for a doc already complete passes no event.
    var loadedSent = false;
    function loaded(e) {
      if (loadedSent || (e && e.isTrusted === false)) return;
      loadedSent = true;
      post('loaded', { mode: mode });
    }

    win.addEventListener('message', onMessage);
    win.addEventListener('click', onClick, true);
    // A middle click fires `auxclick`, never `click`, and a browser can follow the link in the frame itself
    // (WebKit does). The run doc's clicks pass and its picks are clicks, so only the build doc listens.
    if (mode === 'build') win.addEventListener('auxclick', onClick, true);
    // deck-stage dispatches it on itself, bubbling and composed; captured here so the deck's own code
    // cannot stop it first.
    if (mode === 'run') docCall('addEventListener', 'slidechange', onSlideChange, true);
    // Captured on the document, so a scroll inside any element counts too.
    docCall('addEventListener', 'scroll', onLayoutChange, true);
    win.addEventListener('resize', onLayoutChange);
    PERSON_EVENTS.forEach(function (name) { docCall('addEventListener', name, onPerson, { capture: true, passive: true }); });
    win.addEventListener('load', onLoad);
    win.addEventListener('load', loaded);
    // Zoom (P4 L4.21): a wheel over the frame never reaches the stage, so the build doc takes a ctrl or meta one
    // and reports it. The run doc is the artifact, and keeps its own.
    if (mode === 'build') docCall('addEventListener', 'wheel', onZoomWheel, { capture: true, passive: false });
    if (docCall('readyState') === 'loading') docCall('addEventListener', 'DOMContentLoaded', ready);
    else ready();
    // A doc already complete at boot had its `load` before this listened.
    if (docCall('readyState') === 'complete') loaded();
  }

  // Tests run this file with only `module` defined, to reach the pure helpers.
  if (typeof module === 'object' && module !== null && typeof window === 'undefined') module.exports = { safePrefix: safePrefix, cutCss: cutCss };
  else if (typeof window === 'object') boot(window);
})();
