import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createHljsLoader, HLJS_SUB_LANGUAGES, HLJS_GRAMMAR_IDS, MAX_RESOURCE_FAILURES, _testing,
} from '../ui/public/hljs-loader.mjs';
import { SUPPORTED_LANGUAGE_IDS, rowsFromHtml } from '../ui/public/syntax-highlight.mjs';

const ASSETS = '@highlightjs/cdn-assets/es';
const realAssets = {
  loadCore: () => import(`${ASSETS}/core.min.js`),
  loadGrammar: (lang) => import(`${ASSETS}/languages/${lang}.min.js`),
};

function fakeFactory(log = []) {
  return {
    newInstance() {
      const languages = new Map();
      const instance = {
        registerLanguage(lang, grammar) {
          languages.set(lang, grammar);
          log.push(['register', lang, instance]);
        },
        getLanguage(lang) { return languages.get(lang); },
        highlight(text, options) {
          log.push(['highlight', text, options, instance]);
          return { value: `${options.language}:${text}` };
        },
        languages,
      };
      log.push(['instance', instance]);
      return instance;
    },
  };
}

const grammar = () => ({});

test('invalid and unmapped language IDs never call resource loaders', async () => {
  let calls = 0;
  const loader = createHljsLoader({
    loadCore: async () => { calls += 1; return { default: fakeFactory() }; },
    loadGrammar: async () => { calls += 1; return { default: grammar }; },
  });
  for (const id of ['', '../javascript', 'javascript/x', 'brainfuck', 'JavaScript',
    { toString() { throw new Error('no'); } }]) {
    assert.equal(await loader.forLanguage(id), null);
  }
  assert.equal(calls, 0);
});

test('concurrent languages share core and grammar loading but receive isolated instances', async () => {
  const log = [];
  let coreCalls = 0;
  const grammarCalls = [];
  const loader = createHljsLoader({
    loadCore: async () => { coreCalls += 1; return { default: fakeFactory(log) }; },
    loadGrammar: async (lang) => { grammarCalls.push(lang); return { default: grammar }; },
  });
  const [js, xml] = await Promise.all([
    loader.forLanguage('javascript'), loader.forLanguage('xml'),
  ]);
  assert.equal(coreCalls, 1);
  // css/graphql/javascript/xml are each fetched ONCE even though both closures need them.
  assert.deepEqual(grammarCalls.sort(), ['css', 'graphql', 'javascript', 'xml']);
  assert.notEqual(js, xml);
  const instances = log.filter(([kind]) => kind === 'instance').map(([, instance]) => instance);
  assert.equal(instances.length, 2);
  const registeredOn = (instance) => log
    .filter(([kind, , target]) => kind === 'register' && target === instance)
    .map((entry) => entry[1]).sort();
  assert.deepEqual(instances.map(registeredOn).sort((a, b) => a.length - b.length), [
    ['css', 'graphql', 'javascript', 'xml'],
    ['css', 'graphql', 'javascript', 'xml'],
  ]);
  assert.deepEqual([...instances[0].languages.keys()].length, 4);
});

test('a language without sub-languages registers exactly its own grammar', async () => {
  const log = [];
  const grammarCalls = [];
  const loader = createHljsLoader({
    loadCore: async () => ({ default: fakeFactory(log) }),
    loadGrammar: async (lang) => { grammarCalls.push(lang); return { default: grammar }; },
  });
  assert.ok(await loader.forLanguage('python'));
  assert.deepEqual(grammarCalls, ['python']);
  assert.deepEqual(log.filter(([kind]) => kind === 'register').map((entry) => entry[1]), ['python']);
});

test('the sub-language map is the transitive closure declared by the pinned grammars', async () => {
  const core = (await realAssets.loadCore()).default;
  const collect = (def, seen = new Set(), out = new Set()) => {
    if (!def || typeof def !== 'object' || seen.has(def)) return out;
    seen.add(def);
    if (def.subLanguage !== undefined) {
      for (const sub of [].concat(def.subLanguage)) out.add(sub);
    }
    for (const key of ['contains', 'starts', 'variants']) {
      const value = def[key];
      if (Array.isArray(value)) value.forEach((child) => collect(child, seen, out));
      else if (value && typeof value === 'object') collect(value, seen, out);
    }
    return out;
  };
  const direct = new Map();
  const directOf = async (lang) => {
    if (!direct.has(lang)) {
      const definition = (await realAssets.loadGrammar(lang)).default(core.newInstance());
      direct.set(lang, [...collect(definition)]);
    }
    return direct.get(lang);
  };
  const expected = {};
  for (const lang of SUPPORTED_LANGUAGE_IDS) {
    const closure = new Set();
    const queue = [lang];
    while (queue.length) {
      for (const sub of await directOf(queue.shift())) {
        assert.equal(typeof sub, 'string', `${lang}: array sub-languages would autodetect`);
        if (sub === lang || closure.has(sub)) continue;
        closure.add(sub);
        queue.push(sub);
      }
    }
    if (closure.size) expected[lang] = [...closure].sort();
  }
  assert.deepEqual(JSON.parse(JSON.stringify(HLJS_SUB_LANGUAGES)), expected);
  assert.ok(Object.isFrozen(HLJS_SUB_LANGUAGES));
  for (const subs of Object.values(HLJS_SUB_LANGUAGES)) assert.ok(Object.isFrozen(subs));
  const union = new Set([...SUPPORTED_LANGUAGE_IDS, ...Object.values(expected).flat()]);
  assert.deepEqual([...HLJS_GRAMMAR_IDS], [...union].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  assert.ok(HLJS_GRAMMAR_IDS.includes('mojolicious'), 'perl delegates its __DATA__ templates');
  assert.ok(!SUPPORTED_LANGUAGE_IDS.includes('mojolicious'), 'sub-languages are not primaries');
});

test('production-shaped bindings highlight embedded sub-languages', async () => {
  const loader = createHljsLoader(realAssets);
  const jsx = [
    'export default function App({ items }) {',
    '  return <ul className="list">{items.map((item) => <li key={item.id}>{item.label}</li>)}</ul>;',
    '}',
  ].join('\n');
  const js = (await loader.forLanguage('javascript')).highlight(jsx);
  assert.match(js, /<span class="language-xml"><span class="hljs-tag">/);
  assert.match(js, /<span class="hljs-attr">className<\/span>/);
  assert.equal(rowsFromHtml(js)?.length, 3, 'the strict row parser accepts sub-language wrappers');

  const xml = (await loader.forLanguage('xml'))
    .highlight('<style>.a{color:red}</style><script>const x = 1;</script>');
  assert.match(xml, /<span class="language-css">.*hljs-selector-class/);
  assert.match(xml, /<span class="language-javascript">.*hljs-keyword/);

  const dockerfile = (await loader.forLanguage('dockerfile')).highlight('RUN apt-get install -y curl');
  assert.match(dockerfile, /<span class="language-bash">/);

  const typescript = (await loader.forLanguage('typescript')).highlight('const el = <div id="x" />;');
  assert.match(typescript, /<span class="language-xml">/);
});

test('a failed sub-language grammar yields no binding, then retries only that grammar', async () => {
  const attempts = [];
  const loader = createHljsLoader({
    loadCore: async () => ({ default: fakeFactory() }),
    loadGrammar: async (lang, attempt) => {
      attempts.push([lang, attempt]);
      if (lang === 'graphql' && attempt === 0) throw new Error('graphql 404');
      return { default: grammar };
    },
  });
  assert.equal(await loader.forLanguage('javascript'), null);
  assert.ok(await loader.forLanguage('javascript'));
  assert.deepEqual(attempts.sort(), [
    ['css', 0], ['graphql', 0], ['graphql', 1], ['javascript', 0], ['xml', 0],
  ]);
});

test('same-language concurrency and successful caches reuse one complete binding', async () => {
  let coreCalls = 0;
  const grammarCalls = [];
  const log = [];
  const loader = createHljsLoader({
    loadCore: async () => { coreCalls += 1; return { default: fakeFactory(log) }; },
    loadGrammar: async (lang) => { grammarCalls.push(lang); return { default: grammar }; },
  });
  const [a, b] = await Promise.all([
    loader.forLanguage('javascript'), loader.forLanguage('javascript'),
  ]);
  const c = await loader.forLanguage('javascript');
  assert.equal(a, b);
  assert.equal(a, c);
  assert.equal(coreCalls, 1);
  assert.deepEqual(grammarCalls.sort(), ['css', 'graphql', 'javascript', 'xml']);
  assert.equal(log.filter(([kind]) => kind === 'instance').length, 1);
});

test('failed core and grammar resources retry with monotonically increasing attempts', async () => {
  const coreAttempts = [];
  const grammarAttempts = [];
  const loader = createHljsLoader({
    loadCore: async (attempt) => {
      coreAttempts.push(attempt);
      if (attempt === 0) throw new Error('first core');
      return { default: fakeFactory() };
    },
    loadGrammar: async (lang, attempt) => {
      grammarAttempts.push([lang, attempt]);
      return { default: grammar };
    },
  });
  assert.equal(await loader.forLanguage('javascript'), null);
  assert.ok(await loader.forLanguage('javascript'));
  assert.deepEqual(coreAttempts, [0, 1]);
  assert.deepEqual(grammarAttempts.sort(), [
    ['css', 0], ['graphql', 0], ['javascript', 0], ['xml', 0],
  ], 'successful grammars stay cached');

  const grammarRetry = [];
  const second = createHljsLoader({
    loadCore: async () => ({ default: fakeFactory() }),
    loadGrammar: async (lang, attempt) => {
      grammarRetry.push([lang, attempt]);
      if (attempt === 0) throw new Error('first grammar');
      return { default: grammar };
    },
  });
  assert.equal(await second.forLanguage('python'), null);
  assert.ok(await second.forLanguage('python'));
  assert.deepEqual(grammarRetry, [['python', 0], ['python', 1]]);
});

test('a resource that keeps failing is abandoned after MAX_RESOURCE_FAILURES loads', async () => {
  let coreCalls = 0;
  const grammarCalls = [];
  const loader = createHljsLoader({
    loadCore: async () => { coreCalls += 1; throw new Error('core 404'); },
    loadGrammar: async (lang) => { grammarCalls.push(lang); return { default: grammar }; },
  });
  for (let i = 0; i < MAX_RESOURCE_FAILURES + 5; i += 1) {
    assert.equal(await loader.forLanguage('python'), null);
  }
  assert.equal(coreCalls, MAX_RESOURCE_FAILURES, 'no further core imports after the ceiling');
  assert.deepEqual(grammarCalls, ['python'], 'the successful grammar was fetched once and cached');

  const grammarAttempts = [];
  const perGrammar = createHljsLoader({
    loadCore: async () => ({ default: fakeFactory() }),
    loadGrammar: async (lang, attempt) => {
      grammarAttempts.push([lang, attempt]);
      if (lang === 'graphql') throw new Error('graphql 404');
      return { default: grammar };
    },
  });
  for (let i = 0; i < MAX_RESOURCE_FAILURES + 5; i += 1) {
    assert.equal(await perGrammar.forLanguage('javascript'), null);
  }
  assert.deepEqual(grammarAttempts.filter(([lang]) => lang === 'graphql').map(([, a]) => a),
    [...Array(MAX_RESOURCE_FAILURES).keys()], 'only the failing grammar retried, then abandoned');
  assert.ok(await perGrammar.forLanguage('python'), 'other languages are unaffected');
});

test('retry URLs use distinct query strings', () => {
  assert.equal(_testing.coreUrl(0), '/vendor/hljs/core.min.js?retry=0');
  assert.equal(_testing.coreUrl(1), '/vendor/hljs/core.min.js?retry=1');
  assert.equal(_testing.grammarUrl('javascript', 0),
    '/vendor/hljs/languages/javascript.min.js?retry=0');
  assert.equal(_testing.grammarUrl('javascript', 1),
    '/vendor/hljs/languages/javascript.min.js?retry=1');
});

test('binding failures do not refetch successful resources and retry with a fresh instance', async () => {
  let coreCalls = 0;
  let grammarCalls = 0;
  let instances = 0;
  const factory = {
    newInstance() {
      instances += 1;
      if (instances === 1) throw new Error('fail once');
      return fakeFactory().newInstance();
    },
  };
  const loader = createHljsLoader({
    loadCore: async () => { coreCalls += 1; return { default: factory }; },
    loadGrammar: async () => { grammarCalls += 1; return { default: grammar }; },
  });
  assert.equal(await loader.forLanguage('javascript'), null);
  assert.ok(await loader.forLanguage('javascript'));
  assert.equal(instances, 2);
  assert.equal(coreCalls, 1);
  assert.equal(grammarCalls, 4, 'javascript + its 3 sub-language grammars, none refetched');
});

test('throwing registration and lookup failures retry from cached resources with fresh instances', async () => {
  for (const failure of ['register throws', 'lookup throws', 'lookup false']) {
    let coreCalls = 0;
    let grammarCalls = 0;
    let instances = 0;
    const factory = {
      newInstance() {
        instances += 1;
        const fail = instances === 1;
        let registered = false;
        return {
          registerLanguage() {
            if (fail && failure === 'register throws') throw new Error(failure);
            registered = true;
          },
          getLanguage() {
            if (fail && failure === 'lookup throws') throw new Error(failure);
            if (fail && failure === 'lookup false') return false;
            return registered;
          },
          highlight(text) { return { value: String(text) }; },
        };
      },
    };
    const loader = createHljsLoader({
      loadCore: async () => { coreCalls += 1; return { default: factory }; },
      loadGrammar: async () => { grammarCalls += 1; return { default: grammar }; },
    });
    assert.equal(await loader.forLanguage('javascript'), null, failure);
    assert.ok(await loader.forLanguage('javascript'), `${failure} retry succeeds`);
    assert.equal(instances, 2, `${failure} builds a fresh instance`);
    assert.equal(coreCalls, 1, `${failure} reuses the core factory`);
    assert.equal(grammarCalls, 4, `${failure} reuses every cached grammar function`);
  }
});

test('bad module and instance shapes degrade to null', async () => {
  const badCore = createHljsLoader({
    loadCore: async () => ({ default: {} }), loadGrammar: async () => ({ default: grammar }),
  });
  assert.equal(await badCore.forLanguage('javascript'), null);

  const badGrammar = createHljsLoader({
    loadCore: async () => ({ default: fakeFactory() }), loadGrammar: async () => ({ default: {} }),
  });
  assert.equal(await badGrammar.forLanguage('javascript'), null);

  const badInstance = createHljsLoader({
    loadCore: async () => ({ default: { newInstance: () => ({}) } }),
    loadGrammar: async () => ({ default: grammar }),
  });
  assert.equal(await badInstance.forLanguage('javascript'), null);
});

test('bound highlighter returns value and pins the primary language options', async () => {
  const log = [];
  const loader = createHljsLoader({
    loadCore: async () => ({ default: fakeFactory(log) }),
    loadGrammar: async () => ({ default: grammar }),
  });
  const bound = await loader.forLanguage('javascript');
  assert.equal(bound.highlight('const x = 1;'), 'javascript:const x = 1;');
  const call = log.find(([kind]) => kind === 'highlight');
  assert.deepEqual(call[2], { language: 'javascript', ignoreIllegals: true });
  assert.throws(() => bound.highlight('x', 'python'), /language mismatch/);
});

test('throwing highlighters and invalid highlight results fail synchronously', async () => {
  for (const result of [null, {}, { value: 1 }]) {
    const loader = createHljsLoader({
      loadCore: async () => ({
        default: {
          newInstance: () => ({
            registerLanguage() {},
            getLanguage() { return true; },
            highlight() { return result; },
          }),
        },
      }),
      loadGrammar: async () => ({ default: grammar }),
    });
    const bound = await loader.forLanguage('javascript');
    assert.ok(bound);
    assert.throws(() => bound.highlight('x'), /invalid highlight result/);
  }

  const throwing = createHljsLoader({
    loadCore: async () => ({
      default: {
        newInstance: () => ({
          registerLanguage() {},
          getLanguage() { return true; },
          highlight() { throw new Error('highlight failed'); },
        }),
      },
    }),
    loadGrammar: async () => ({ default: grammar }),
  });
  const bound = await throwing.forLanguage('javascript');
  assert.throws(() => bound.highlight('x'), /highlight failed/);
});

test('async loader and binding failures produce no unhandled rejection', async () => {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    const importFailure = createHljsLoader({
      loadCore: async () => { throw new Error('core failed'); },
      loadGrammar: async () => { throw new Error('grammar failed'); },
    });
    assert.equal(await importFailure.forLanguage('javascript'), null);

    const registrationFailure = createHljsLoader({
      loadCore: async () => ({
        default: {
          newInstance: () => ({
            registerLanguage() { throw new Error('register failed'); },
            getLanguage() { throw new Error('lookup should not run'); },
            highlight() { return { value: '' }; },
          }),
        },
      }),
      loadGrammar: async () => ({ default: grammar }),
    });
    assert.equal(await registrationFailure.forLanguage('javascript'), null);
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
  assert.deepEqual(unhandled, []);
});

test('real isolated instances keep XML output independent of JavaScript load order', async () => {
  const loader = createHljsLoader(realAssets);
  const xml = await loader.forLanguage('xml');
  const source = '<script>const x = 1;</script>';
  const before = xml.highlight(source);
  assert.match(before, /language-javascript/, 'the script body is highlighted, not plain');
  await loader.forLanguage('javascript');
  assert.equal(xml.highlight(source), before);

  const reverse = createHljsLoader(realAssets);
  await reverse.forLanguage('javascript');
  const after = (await reverse.forLanguage('xml')).highlight(source);
  assert.equal(after, before);
});
