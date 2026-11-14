// test/ui-brand-marks.test.mjs — the brand mark registry (#1104): cleared artwork, the generic fallback, and the maps
// from an engine, a model and a plugin to a mark.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { BRAND_MARKS, hasBrandMark, brandMark, engineMark, modelMark } from '../ui/public/brand-marks.mjs';
import { pluginTile } from '../ui/public/marketplace/kinds.mjs';
import { prChip } from '../ui/public/runs-list.mjs';
import { vendorOf } from '../src/shared/model-vendor.mjs';
import { forgeOfPrUrl, FORGE_LABEL } from '../src/shared/pr-forge.mjs';

const doc = new JSDOM('<!doctype html>').window.document;

test('only the marks cleared for use carry artwork', () => {
  assert.deepEqual(Object.keys(BRAND_MARKS).sort(), ['copilot', 'github', 'goose']);
});

test('a cleared mark is filled artwork in the theme colour, decorative beside its name', () => {
  const m = brandMark(doc, 'github');
  assert.equal(m.dataset.brand, 'github');
  assert.equal(m.getAttribute('aria-hidden'), 'true');
  const svg = m.querySelector('svg');
  assert.equal(svg.getAttribute('fill'), 'currentColor');
  assert.equal(svg.getAttribute('viewBox'), '0 0 24 24');
  assert.ok(svg.querySelector('path').getAttribute('d').length > 100);
});

test('Goose keeps its own artwork box', () => {
  assert.equal(brandMark(doc, 'goose').querySelector('svg').getAttribute('viewBox'), '0 0 600 600');
});

test('an unknown, uncleared or inherited id gets the generic icon, or nothing when asked', () => {
  for (const id of ['openai', 'constructor', '', null, undefined, 7]) {
    assert.equal(hasBrandMark(id), false);
    assert.equal(brandMark(doc, id).dataset.brand, 'generic');
    assert.equal(brandMark(doc, id, { fallback: false }), null);
  }
});

test('a label names a mark that stands without visible text', () => {
  const m = brandMark(doc, 'github', { label: 'GitHub' });
  assert.equal(m.getAttribute('role'), 'img');
  assert.equal(m.getAttribute('aria-label'), 'GitHub');
  assert.equal(m.title, 'GitHub');
  assert.equal(m.hasAttribute('aria-hidden'), false);
});

test('engines map to their marks; a mark adds no text to the name beside it', () => {
  assert.equal(engineMark(doc, 'copilot').dataset.brand, 'copilot');
  assert.equal(engineMark(doc, 'goose').dataset.brand, 'goose');
  for (const e of ['claude', 'codex', 'cursor', 'gemini', 'opencode', 'qwen', 'mock', 'toString']) {
    const m = engineMark(doc, e);
    assert.equal(m.dataset.brand, 'generic', e);
    assert.equal(m.textContent, '');
  }
});

test('a model wears its maker, not the engine or provider that serves it', () => {
  assert.equal(vendorOf({ id: 'claude-opus-5-5' }), 'anthropic');
  assert.equal(vendorOf({ id: 'alias', upstream: { model: 'gpt-5' } }), 'openai');
  assert.equal(vendorOf({ id: 'sonnet-fast', upstream: { model: 'glm-4' } }), 'other');
  assert.equal(vendorOf({ id: 'raw', upstreamModel: 'claude-haiku' }), 'anthropic');
  assert.equal(vendorOf({ id: 'raw', connection: { kind: 'signin', engine: 'codex' } }), 'openai');
  assert.equal(vendorOf({}), 'other');
});

test('a model row wears no icon while no maker is cleared, and appending the result adds nothing', () => {
  for (const row of [{ id: 'claude-opus-5-5' }, { id: 'gpt-5' }, { id: 'local-llama' }]) {
    const host = doc.createElement('div');
    host.append(modelMark(doc, row), 'name');
    assert.equal(host.querySelector('[data-brand]'), null);
    assert.equal(host.textContent, 'name');
  }
});

test('a plugin icon names a cleared mark, else the kind tile stays', () => {
  const brand = pluginTile(doc, { icon: 'github', iconKind: 'taskSources' }, { size: 'sm' });
  assert.match(brand.className, /mk-mt-sm/);
  assert.match(brand.className, /mk-t-none/);
  assert.equal(brand.querySelector('[data-brand]').dataset.brand, 'github');
  for (const icon of ['openai', 'constructor', null, undefined]) {
    const t = pluginTile(doc, { icon, iconKind: 'taskSources' });
    assert.match(t.className, /mk-t-src/);
    assert.equal(t.querySelector('[data-brand]'), null);
  }
});

test('the forge of a PR url comes from the real host, never a look-alike', () => {
  assert.equal(forgeOfPrUrl('https://github.com/a/b/pull/1'), 'github');
  assert.equal(forgeOfPrUrl('https://dev.azure.com/o/p/_git/r/pullrequest/2'), 'azure');
  assert.equal(forgeOfPrUrl('https://bitbucket.org/w/r/pull-requests/3'), 'bitbucket');
  assert.equal(forgeOfPrUrl('https://evil.example/github.com/a/b/pull/1'), null);
  assert.equal(forgeOfPrUrl(null), null);
  assert.equal(FORGE_LABEL.azure, 'Azure DevOps');
});

const PR = (url) => ({ id: 'open', icon: 'pr', word: 'Ready', number: 4, url, title: 't' });

test('a dense PR chip wears only a cleared host mark, named for screen readers', () => {
  const gh = prChip(doc, PR('https://github.com/a/b/pull/4'));
  const m = gh.querySelector('[data-brand="github"]');
  assert.equal(m.getAttribute('aria-label'), 'GitHub');
  assert.equal(gh.textContent, 'Ready');
  const az = prChip(doc, PR('https://dev.azure.com/o/p/_git/r/pullrequest/4'));
  assert.equal(az.querySelector('[data-brand]'), null);
  assert.equal(az.textContent, 'Ready');
  assert.equal(prChip(doc, PR(null)).querySelector('[data-brand]'), null);
});

test('the run page PR bar names its host beside the mark', () => {
  const gh = prChip(doc, PR('https://github.com/a/b/pull/4'), { number: true });
  assert.equal(gh.querySelector('[data-brand="github"]').getAttribute('aria-hidden'), 'true');
  assert.equal(gh.querySelector('.runs-pr-host').textContent, 'GitHub');
  const az = prChip(doc, PR('https://dev.azure.com/o/p/_git/r/pullrequest/4'), { number: true });
  assert.equal(az.querySelector('[data-brand]').dataset.brand, 'generic');
  assert.equal(az.querySelector('.runs-pr-host').textContent, 'Azure DevOps');
  const none = prChip(doc, PR('https://git.example/a/4'), { number: true });
  assert.equal(none.querySelector('.runs-pr-host'), null);
});
