import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import {
  buildFileTree, renderFileTree, firstFile, fileStatus,
} from '../ui/public/file-tree.mjs';

const entry = (path, over = {}) => ({
  project: null,
  isNew: false,
  f: { path, status: 'M', added: 1, removed: 2 },
  ...over,
});

function flatten(nodes, out = []) {
  for (const node of nodes) {
    out.push(node);
    if (node.children) flatten(node.children, out);
  }
  return out;
}

function render(nodes, options = {}) {
  const dom = new JSDOM('<!doctype html><body></body>');
  const { document } = dom.window;
  const nav = renderFileTree(nodes, {
    doc: document,
    counts(item) {
      const span = document.createElement('span');
      span.className = 'counts';
      span.textContent = item.f.binary ? 'binary' : `+${item.f.added} −${item.f.removed}`;
      return span;
    },
    ...options,
  });
  document.body.appendChild(nav);
  return { dom, document, nav };
}

test('model order is deterministic, directories first, and numeric names lexical', () => {
  const nodes = buildFileTree([
    entry('z.js'), entry('a2.js'), entry('a10.js'), entry('B.js'), entry('b.js'),
    entry('dir/z.js'), entry('Dir/a.js'), entry('é.js'), entry('E.js'),
  ]);
  assert.deepEqual(nodes.map((node) => node.name), [
    'Dir', 'dir', 'a10.js', 'a2.js', 'B.js', 'b.js', 'E.js', 'z.js', 'é.js',
  ]);
});

test('directory chains compact but never absorb a file basename', () => {
  const compact = buildFileTree([entry('ui/public/src/x.js')]);
  assert.equal(compact[0].name, 'ui/public/src');
  assert.equal(compact[0].path, 'ui/public/src');
  assert.equal(compact[0].children[0].name, 'x.js');

  const branching = buildFileTree([entry('ui/public/a.js'), entry('ui/test/b.js')]);
  assert.equal(branching[0].name, 'ui');
  assert.deepEqual(branching[0].children.map((node) => node.name), ['public', 'test']);
});

test('compacted labels determine nested project order, first file, and rendered order', () => {
  const rows = [
    entry('p/a/z/f.js', { project: 'alpha' }),
    entry('p/a-b/f.js', { project: 'alpha' }),
  ];
  const nodes = buildFileTree(rows);
  const project = nodes[0];
  const parent = project.children[0];
  assert.equal(parent.name, 'p');
  assert.deepEqual(parent.children.map((node) => node.name), ['a-b', 'a/z']);
  assert.equal(firstFile(nodes).path, 'p/a-b/f.js');

  const { nav } = render(nodes);
  assert.deepEqual([...nav.querySelectorAll('.hd-tree-file')].map((button) => button.dataset.path), [
    'p/a-b/f.js',
    'p/a/z/f.js',
  ]);
});

test('file and directory with the same segment both survive directory-first', () => {
  const deleted = entry('a', { f: { path: 'a', status: 'D', added: 0, removed: 1 } });
  const added = entry('a/b', { isNew: true, f: { path: 'a/b', status: 'A', added: 1, removed: 0 } });
  const nodes = buildFileTree([deleted, added]);
  assert.deepEqual(nodes.map((node) => [node.type, node.name]), [['dir', 'a'], ['file', 'a']]);
});

test('project identity scopes duplicate paths and exact duplicates keep the first entry', () => {
  const alpha = entry('src/x.js', { project: 'alpha' });
  const duplicate = entry('src/x.js', { project: 'alpha', f: { path: 'src/x.js', status: 'D' } });
  const beta = entry('src/x.js', { project: 'beta' });
  const nodes = buildFileTree([duplicate, alpha, beta]);
  assert.deepEqual(nodes.map((node) => node.name), ['alpha', 'beta']);
  const files = flatten(nodes).filter((node) => node.type === 'file');
  assert.equal(files.length, 2);
  assert.notEqual(files[0].key, files[1].key);
  assert.equal(files[0].entry, duplicate, 'first exact duplicate wins');
});

test('Map-backed tries tolerate hostile and selector-sensitive segments', () => {
  const paths = [
    '__proto__/x.js', 'constructor/y.js', 'a"b/q.js', 'a\\b/r.js',
    'a[b]/s.js', 'a#b/t.js',
  ];
  const nodes = buildFileTree(paths.map((path) => entry(path)));
  assert.deepEqual(flatten(nodes).filter((node) => node.type === 'file').map((node) => node.path).sort(),
    [...paths].sort());
  assert.equal(buildFileTree([{}, entry(''), null]).length, 0);
});

test('firstFile follows rendered order and statuses cover additions, copies and deletions', () => {
  const nodes = buildFileTree([entry('z.js'), entry('a/x.js')]);
  assert.equal(firstFile(nodes).path, 'a/x.js');
  assert.equal(firstFile([]), null);
  assert.equal(fileStatus(entry('a', { isNew: true })), 'add');
  assert.equal(fileStatus(entry('a', { f: { path: 'a', status: 'A' } })), 'add');
  assert.equal(fileStatus(entry('a', { f: { path: 'a', status: 'C' } })), 'add');
  assert.equal(fileStatus(entry('a', { f: { path: 'a', status: 'D' } })), 'del');
  assert.equal(fileStatus(entry('a', { f: { path: 'a', status: 'R' } })), 'mod');
});

test('renderer uses native accessible controls, safe IDs, and visual-only initialization', () => {
  const rows = [
    entry('src/x.js', { project: 'alpha' }),
    entry('src/y.js', { project: 'alpha', f: { path: 'src/y.js', status: 'R', from: 'old/y.ts', added: 2, removed: 3 } }),
  ];
  const nodes = buildFileTree(rows);
  const first = firstFile(nodes);
  const picks = [];
  const { document, nav } = render(nodes, { initialKey: first.key, onPick: (...args) => picks.push(args) });
  assert.equal(nav.tagName, 'NAV');
  assert.equal(nav.getAttribute('aria-label'), 'Changed files');
  const heading = nav.querySelector('.hd-tree-project');
  assert.equal(heading.getAttribute('role'), 'heading');
  assert.equal(heading.getAttribute('aria-level'), '3');
  for (const button of nav.querySelectorAll('button')) assert.equal(button.type, 'button');
  const dir = nav.querySelector('.hd-tree-dir');
  const group = document.getElementById(dir.getAttribute('aria-controls'));
  assert.ok(group);
  assert.equal(dir.nextElementSibling, group);
  assert.equal(dir.getAttribute('aria-expanded'), 'true');
  assert.equal(group.hidden, false);
  assert.equal(nav.querySelectorAll('[aria-current="true"]').length, 1);
  assert.equal(picks.length, 0, 'initialization is visual only');

  const rename = [...nav.querySelectorAll('.hd-tree-file')].find((button) => button.dataset.path === 'src/y.js');
  assert.equal(rename.querySelector('.hd-diff-path').textContent, 'y.js');
  assert.match(rename.getAttribute('aria-label'), /Renamed from old\/y\.ts to src\/y\.js in project alpha/);
  assert.match(rename.getAttribute('aria-label'), /2 lines added, 3 lines removed/);
  assert.match(rename.title, /old\/y\.ts/);
  assert.ok([...rename.querySelectorAll('.hd-tree-status')].every((node) => node.getAttribute('aria-hidden') === 'true'));
});

test('deleted-file marker uses an ASCII hyphen outside the count chip', () => {
  const deleted = entry('gone.js', {
    f: { path: 'gone.js', status: 'D', added: 0, removed: 3 },
  });
  const { nav } = render(buildFileTree([deleted]));
  const button = nav.querySelector('.hd-tree-file.deleted');
  assert.equal(button.querySelector('.hd-tree-status').textContent, '-');
  assert.equal(button.querySelector('.counts').textContent, '+0 −3');
});

test('directory toggles preserve children and selection without invoking onPick', () => {
  const rows = [entry('src/a.js'), entry('src/b.js')];
  const nodes = buildFileTree(rows);
  const picks = [];
  const { dom, nav } = render(nodes, {
    initialKey: firstFile(nodes).key,
    onPick: (...args) => picks.push(args),
  });
  const dir = nav.querySelector('.hd-tree-dir');
  const group = nav.querySelector(`#${dir.getAttribute('aria-controls')}`);
  const children = [...group.childNodes];
  dir.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(group.hidden, true);
  assert.equal(dir.getAttribute('aria-expanded'), 'false');
  assert.match(dir.getAttribute('aria-label'), /^Expand directory/);
  assert.deepEqual([...group.childNodes], children);
  assert.equal(nav.querySelectorAll('[aria-current="true"]').length, 1);
  assert.equal(picks.length, 0);
});

test('duplicate project paths activate exactly one captured entry', () => {
  const alpha = entry('src/x.js', { project: 'alpha' });
  const beta = entry('src/x.js', { project: 'beta' });
  const picks = [];
  const { dom, nav } = render(buildFileTree([alpha, beta]), { onPick: (...args) => picks.push(args) });
  const buttons = [...nav.querySelectorAll('.hd-tree-file')];
  buttons[0].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  buttons[1].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(nav.querySelectorAll('[aria-current="true"]').length, 1);
  assert.equal(nav.querySelector('[aria-current="true"]').dataset.project, 'beta');
  assert.equal(picks.at(-1)[0], beta);
});

test('separately rendered trees have disjoint control IDs and unknown initialization is inert', () => {
  const nodes = buildFileTree([entry('src/x.js')]);
  const a = render(nodes, { initialKey: 'missing' });
  const b = render(nodes);
  a.document.body.appendChild(b.nav);
  const aIds = new Set([...a.nav.querySelectorAll('[id]')].map((node) => node.id));
  const bIds = new Set([...b.nav.querySelectorAll('[id]')].map((node) => node.id));
  assert.ok([...aIds].every((id) => !bIds.has(id)));
  assert.equal(a.nav.querySelector('[aria-current]'), null);
  for (const nav of [a.nav, b.nav]) {
    for (const control of nav.querySelectorAll('[aria-controls]')) {
      assert.ok(nav.querySelector(`#${control.getAttribute('aria-controls')}`));
    }
  }
});
