import { SUPPORTED_LANGUAGE_IDS } from './syntax-highlight.mjs';

const LANGUAGE_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ALLOWED_LANGUAGES = new Set(SUPPORTED_LANGUAGE_IDS);
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
  const grammarPending = new Map();
  const grammarFunctions = new Map();
  const nextGrammarAttempt = new Map();
  const languagePending = new Map();
  const languageReady = new Map();

  const validInstance = (value) => value
    && typeof value.getLanguage === 'function'
    && typeof value.registerLanguage === 'function'
    && typeof value.highlight === 'function';

  function getCoreFactory() {
    if (coreFactory) return Promise.resolve(coreFactory);
    if (corePending) return corePending;
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
      .catch(() => null)
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
    const attempt = nextGrammarAttempt.get(lang) || 0;
    nextGrammarAttempt.set(lang, attempt + 1);
    const pending = Promise.resolve()
      .then(() => loadGrammar(lang, attempt))
      .then((mod) => {
        if (typeof mod?.default !== 'function') throw new TypeError('invalid grammar module');
        grammarFunctions.set(lang, mod.default);
        return mod.default;
      })
      .catch(() => null)
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
    const pending = Promise.all([getCoreFactory(), getGrammar(lang)])
      .then(([factory, grammar]) => {
        if (!factory || !grammar) return null;
        const hljs = factory.newInstance();
        if (!validInstance(hljs)) throw new TypeError('invalid highlight.js instance');
        hljs.registerLanguage(lang, grammar);
        if (!hljs.getLanguage(lang)) throw new TypeError('grammar did not register');
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
