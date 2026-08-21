import { SUPPORTED_LANGUAGE_IDS } from './syntax-highlight.mjs';

const LANGUAGE_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ALLOWED_LANGUAGES = new Set(SUPPORTED_LANGUAGE_IDS);
const codeUnitCompare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Grammars the pinned highlight.js build delegates to through `subLanguage`
// regions (JSX markup inside javascript/typescript, <script>/<style> bodies
// inside xml, RUN arguments in dockerfile, …), closed transitively: xml's
// <style> body needs css even when xml itself is only reached from javascript.
// Core emits a region as PLAIN TEXT when its grammar is missing from the
// instance, so every primary language registers its whole closure up front.
// The set is fixed per primary language, which keeps the output a pure
// function of (language, text) rather than of which files were opened first.
// Every declared sub-language is a string (never an autodetect list), so the
// extra grammars can only fill those regions, never change the primary parse.
// test/hljs-loader.test.mjs derives this table from the installed package and
// fails on drift after an upgrade.
export const HLJS_SUB_LANGUAGES = Object.freeze({
  dart: Object.freeze(['css', 'graphql', 'javascript', 'markdown', 'xml']),
  dockerfile: Object.freeze(['bash']),
  javascript: Object.freeze(['css', 'graphql', 'xml']),
  markdown: Object.freeze(['css', 'graphql', 'javascript', 'xml']),
  nix: Object.freeze(['css', 'graphql', 'javascript', 'markdown', 'xml']),
  perl: Object.freeze(['css', 'graphql', 'javascript', 'mojolicious', 'xml']),
  typescript: Object.freeze(['css', 'graphql', 'javascript', 'xml']),
  xml: Object.freeze(['css', 'graphql', 'javascript']),
  yaml: Object.freeze(['ruby']),
});

const subLanguagesOf = (lang) => (
  Object.hasOwn(HLJS_SUB_LANGUAGES, lang) ? HLJS_SUB_LANGUAGES[lang] : []
);

// Every grammar file the loader may request: the reviewed primaries plus their
// sub-languages. ui/server.mjs serves exactly this set under /vendor/hljs.
export const HLJS_GRAMMAR_IDS = Object.freeze(
  [...new Set([...SUPPORTED_LANGUAGE_IDS, ...Object.values(HLJS_SUB_LANGUAGES).flat()])]
    .sort(codeUnitCompare),
);
// Retry-on-next-call exists for a blip (a server restart mid-session), not for
// a /vendor that fails forever: without a ceiling every selection costs one
// doomed import per missing resource, one console error each, and a new
// `?retry=N` entry in the module map. After this many failed loads of a
// resource the loader answers null for the rest of the page's life.
export const MAX_RESOURCE_FAILURES = 3;
const coreUrl = (attempt) => `/vendor/hljs/core.min.js?retry=${attempt}`;
const grammarUrl = (lang, attempt) =>
  `/vendor/hljs/languages/${lang}.min.js?retry=${attempt}`;

export function createHljsLoader(options = {}) {
  const loadCore = options.loadCore || ((attempt) => import(coreUrl(attempt)));
  const loadGrammar = options.loadGrammar
    || ((lang, attempt) => import(grammarUrl(lang, attempt)));

  let coreFactory = null;
  let corePending = null;
  let nextCoreAttempt = 0;
  let coreFailures = 0;
  const grammarPending = new Map();
  const grammarFunctions = new Map();
  const nextGrammarAttempt = new Map();
  const grammarFailures = new Map();
  const languagePending = new Map();
  const languageReady = new Map();

  const validInstance = (value) => value
    && typeof value.getLanguage === 'function'
    && typeof value.registerLanguage === 'function'
    && typeof value.highlight === 'function';

  function getCoreFactory() {
    if (coreFactory) return Promise.resolve(coreFactory);
    if (corePending) return corePending;
    if (coreFailures >= MAX_RESOURCE_FAILURES) return Promise.resolve(null);
    const attempt = nextCoreAttempt++;
    const pending = Promise.resolve()
      .then(() => loadCore(attempt))
      .then((mod) => {
        const exported = mod?.default;
        if (typeof exported?.newInstance !== 'function') {
          throw new TypeError('core module has no newInstance factory');
        }
        coreFactory = exported;
        return coreFactory;
      })
      .catch(() => {
        coreFailures += 1;
        return null;
      })
      .finally(() => {
        if (corePending === pending) corePending = null;
      });
    corePending = pending;
    return pending;
  }

  function getGrammar(lang) {
    if (grammarFunctions.has(lang)) return Promise.resolve(grammarFunctions.get(lang));
    const existing = grammarPending.get(lang);
    if (existing) return existing;
    if ((grammarFailures.get(lang) || 0) >= MAX_RESOURCE_FAILURES) return Promise.resolve(null);
    const attempt = nextGrammarAttempt.get(lang) || 0;
    nextGrammarAttempt.set(lang, attempt + 1);
    const pending = Promise.resolve()
      .then(() => loadGrammar(lang, attempt))
      .then((mod) => {
        if (typeof mod?.default !== 'function') throw new TypeError('invalid grammar module');
        grammarFunctions.set(lang, mod.default);
        return mod.default;
      })
      .catch(() => {
        grammarFailures.set(lang, (grammarFailures.get(lang) || 0) + 1);
        return null;
      })
      .finally(() => {
        if (grammarPending.get(lang) === pending) grammarPending.delete(lang);
      });
    grammarPending.set(lang, pending);
    return pending;
  }

  function buildLanguage(lang) {
    if (languageReady.has(lang)) return Promise.resolve(languageReady.get(lang));
    const existing = languagePending.get(lang);
    if (existing) return existing;
    const subs = subLanguagesOf(lang);
    const pending = Promise.all([getCoreFactory(), getGrammar(lang), ...subs.map(getGrammar)])
      .then(([factory, grammar, ...subGrammars]) => {
        // All-or-nothing: a binding is cached only when its whole closure
        // loaded, so a transient grammar failure degrades to plain rows now
        // and retries just that grammar on the next selection — it never
        // yields a cached binding whose output depends on what happened to load.
        if (!factory || !grammar || subGrammars.some((sub) => !sub)) return null;
        const hljs = factory.newInstance();
        if (!validInstance(hljs)) throw new TypeError('invalid highlight.js instance');
        hljs.registerLanguage(lang, grammar);
        subs.forEach((sub, index) => hljs.registerLanguage(sub, subGrammars[index]));
        if (![lang, ...subs].every((id) => hljs.getLanguage(id))) {
          throw new TypeError('grammar did not register');
        }
        const bound = Object.freeze({
          lang,
          highlight(text, requested = lang) {
            if (requested !== lang) throw new TypeError('language mismatch');
            const result = hljs.highlight(String(text), {
              language: lang,
              ignoreIllegals: true,
            });
            if (typeof result?.value !== 'string') {
              throw new TypeError('invalid highlight result');
            }
            return result.value;
          },
        });
        languageReady.set(lang, bound);
        return bound;
      })
      .catch(() => null)
      .finally(() => {
        if (languagePending.get(lang) === pending) languagePending.delete(lang);
      });
    languagePending.set(lang, pending);
    return pending;
  }

  return Object.freeze({
    async forLanguage(input) {
      try {
        const lang = String(input ?? '');
        if (!LANGUAGE_ID_RE.test(lang) || !ALLOWED_LANGUAGES.has(lang)) return null;
        return await buildLanguage(lang);
      } catch {
        return null;
      }
    },
  });
}

export const _testing = Object.freeze({ coreUrl, grammarUrl });
