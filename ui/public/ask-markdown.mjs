// ui/public/ask-markdown.mjs — sandboxed markdown for Ask Worca answers
// (spec §10.7). marked + DOMPurify are lazy-loaded through the injected
// `load()` (the app wires it to the P2 vendor routes; tests import the same
// pinned packages directly). Failure latches to plain text after three
// attempts — the MAX_RESOURCE_FAILURES precedent of hljs-loader.mjs — never an
// endless retry. Code blocks are highlighted only on ask-done, with the same
// detached-staging commit rules as hdApplyHighlights (app.js:11235-11260):
// text must round-trip byte-for-byte and only class-carrying SPANs may appear.
import { SUPPORTED_LANGUAGE_IDS } from './syntax-highlight.mjs';

const ALLOWED_TAGS = ['p', 'br', 'strong', 'em', 'del', 'code', 'pre', 'ul', 'ol', 'li', 'a',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'input'];
const ALLOWED_ATTR = ['href', 'class', 'type', 'checked', 'disabled', 'align'];
const ALLOWED_URI_REGEXP = /^(?:https?:|mailto:|#)/i;
// DOMPurify tests EVERY non-URI-safe attribute VALUE against ALLOWED_URI_REGEXP;
// with the strict regexp above, type="checkbox" and align="right" would be
// dropped (only `class` is URI-safe by default) — the post-pass would then
// remove every checkbox. These two carry no URL, so marking them URI-safe
// restores them without loosening the href guard.
const ADD_URI_SAFE_ATTR = ['type', 'align'];
const CODE_CLASS_RE = /^language-[A-Za-z0-9_+-]{1,64}$/;
// hljs primary tokens plus the secondary `word_` scope tokens it appends — a
// per-token variant of the attribute-level regex at syntax-highlight.mjs:49
// (that one requires an hljs-* first token per attribute; this one is checked
// per classList ENTRY, so a `word_` token may stand alone — a deliberate,
// harmless superset: spans still carry classes only).
const HLJS_CLASS_RE = /^(?:hljs-[A-Za-z0-9_-]+|[A-Za-z0-9-]+_+)$/;
const PLAIN_LIMIT = 200_000;
const MAX_ATTEMPTS = 3;

export const LANGUAGE_ALIASES = Object.freeze({
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', node: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash',
  yml: 'yaml', html: 'xml', htm: 'xml', svg: 'xml', vue: 'xml',
  py: 'python', rb: 'ruby', md: 'markdown', golang: 'go', 'c++': 'cpp', cs: 'csharp', patch: 'diff', toml: 'ini',
});

const SUPPORTED = new Set(SUPPORTED_LANGUAGE_IDS);

export function createMarkdownRenderer({ doc, load, hljsLoader }) {
  let mods = null;
  let loading = null;
  let attempts = 0;
  let failed = false;

  function ensure() {
    if (mods) return Promise.resolve(true);
    if (failed) return Promise.resolve(false);
    if (!loading) {
      loading = Promise.resolve()
        .then(() => load())
        .then((loaded) => {
          const marked = loaded && loaded.marked;
          const createDOMPurify = loaded && loaded.createDOMPurify;
          const purifier = typeof createDOMPurify === 'function' ? createDOMPurify(doc.defaultView) : null;
          if (!marked || typeof marked.parse !== 'function' || !purifier || typeof purifier.sanitize !== 'function') {
            throw new Error('markdown modules have an unexpected shape');
          }
          mods = { marked, purifier };
          return true;
        })
        .catch(() => {
          attempts += 1;
          loading = null;
          if (attempts >= MAX_ATTEMPTS) failed = true;
          return false;
        });
    }
    return loading;
  }

  function render(text) {
    const s = String(text ?? '');
    if (!mods || failed || s.length > PLAIN_LIMIT) return { kind: 'plain' };
    let html;
    try {
      html = mods.marked.parse(s, { gfm: true, breaks: true, async: false });
    } catch {
      return { kind: 'plain' };
    }
    let frag;
    try {
      frag = mods.purifier.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR, ALLOWED_URI_REGEXP, ADD_URI_SAFE_ATTR, RETURN_DOM_FRAGMENT: true });
    } catch {
      return { kind: 'plain' };
    }
    for (const node of [...frag.querySelectorAll('[class]')]) {
      const tag = node.tagName;
      const keep = [...node.classList].filter((c) => (
        tag === 'CODE' ? CODE_CLASS_RE.test(c) : tag === 'SPAN' ? HLJS_CLASS_RE.test(c) : false
      ));
      if (keep.length) node.setAttribute('class', keep.join(' '));
      else node.removeAttribute('class');
    }
    for (const a of [...frag.querySelectorAll('a[href]')]) {
      const href = a.getAttribute('href') || '';
      if (/^(?:https?:|mailto:)/i.test(href)) {
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
      }
    }
    for (const input of [...frag.querySelectorAll('input')]) {
      if ((input.getAttribute('type') || '').toLowerCase() !== 'checkbox') { input.remove(); continue; }
      input.setAttribute('disabled', '');
    }
    return { kind: 'md', frag };
  }

  async function highlight(container) {
    if (!container || !hljsLoader || failed) return;
    for (const code of [...container.querySelectorAll('pre > code')]) {
      const cls = [...code.classList].find((c) => c.startsWith('language-'));
      if (!cls) continue;
      const raw = cls.slice('language-'.length).toLowerCase();
      const lang = SUPPORTED.has(raw) ? raw : LANGUAGE_ALIASES[raw];
      if (!lang || !SUPPORTED.has(lang)) continue;
      let binding = null;
      try { binding = await hljsLoader.forLanguage(lang); } catch { binding = null; }
      if (!binding) continue;
      const source = code.textContent;
      let html = '';
      try { html = binding.highlight(source); } catch { continue; }
      // hdApplyHighlights staging rules, verbatim: detached holder, byte-exact
      // text, SPAN-only markup whose only attribute is a valid class.
      const holder = doc.createElement('span');
      holder.innerHTML = html;
      if (holder.textContent !== source) continue;
      const els = [...holder.querySelectorAll('*')];
      const bad = els.some((el) => el.tagName !== 'SPAN'
        || [...el.attributes].some((attr) => attr.name !== 'class')
        || [...el.classList].some((c) => !HLJS_CLASS_RE.test(c)));
      if (bad) continue;
      code.replaceChildren(...holder.childNodes);
    }
  }

  return Object.freeze({
    ensure,
    isReady: () => !!mods,
    isFailed: () => failed,
    render,
    highlight,
  });
}
