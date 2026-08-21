import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHljsLoader, _testing } from '../ui/public/hljs-loader.mjs';

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

test('concurrent languages share core loading but receive isolated primary-only instances', async () => {
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
  assert.deepEqual(grammarCalls.sort(), ['javascript', 'xml']);
  assert.notEqual(js, xml);
  assert.equal(log.filter(([kind]) => kind === 'instance').length, 2);
  const registered = log.filter(([kind]) => kind === 'register');
  assert.deepEqual(registered.map((entry) => entry[1]).sort(), ['javascript', 'xml']);
  assert.notEqual(registered[0][2], registered[1][2]);
});

test('same-language concurrency and successful caches reuse one complete binding', async () => {
  let coreCalls = 0;
  let grammarCalls = 0;
  const log = [];
  const loader = createHljsLoader({
    loadCore: async () => { coreCalls += 1; return { default: fakeFactory(log) }; },
    loadGrammar: async () => { grammarCalls += 1; return { default: grammar }; },
  });
  const [a, b] = await Promise.all([
    loader.forLanguage('javascript'), loader.forLanguage('javascript'),
  ]);
  const c = await loader.forLanguage('javascript');
  assert.equal(a, b);
  assert.equal(a, c);
  assert.equal(coreCalls, 1);
  assert.equal(grammarCalls, 1);
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
  assert.deepEqual(grammarAttempts, [['javascript', 0]], 'successful grammar stays cached');

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
  assert.equal(grammarCalls, 1);
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
    assert.equal(grammarCalls, 1, `${failure} reuses the grammar function`);
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
  const core = await import('@highlightjs/cdn-assets/es/core.min.js');
  const loader = createHljsLoader({
    loadCore: async () => core,
    loadGrammar: async (lang) => import(`@highlightjs/cdn-assets/es/languages/${lang}.min.js`),
  });
  const xml = await loader.forLanguage('xml');
  const source = '<script>const x = 1;</script>';
  const before = xml.highlight(source);
  await loader.forLanguage('javascript');
  assert.equal(xml.highlight(source), before);

  const reverse = createHljsLoader({
    loadCore: async () => core,
    loadGrammar: async (lang) => import(`@highlightjs/cdn-assets/es/languages/${lang}.min.js`),
  });
  await reverse.forLanguage('javascript');
  const after = (await reverse.forLanguage('xml')).highlight(source);
  assert.equal(after, before);
});
