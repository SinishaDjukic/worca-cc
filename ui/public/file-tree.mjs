// Deterministic, project-scoped model and renderer for changed-file navigation.

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgNode(doc, tag, attrs = {}) {
  const node = doc.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
  return node;
}

function treeIcon(doc, kind) {
  const svg = svgNode(doc, 'svg', {
    viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor',
    'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    'aria-hidden': 'true', focusable: 'false',
  });

  if (kind === 'folder') {
    svg.classList.add('hd-tree-folder-icon');
    svg.appendChild(svgNode(doc, 'path', {
      d: 'M2.5 5.25h5l1.7 2h8.3v7.5a1.5 1.5 0 0 1-1.5 1.5H4a1.5 1.5 0 0 1-1.5-1.5z',
    }));
    return svg;
  }

  svg.classList.add('hd-tree-file-icon');
  svg.setAttribute('stroke-width', '1.45');
  svg.append(
    svgNode(doc, 'path', { d: 'M5 2.5h6.5l3.5 3.5v11.5H5z' }),
    svgNode(doc, 'path', { d: 'M11.5 2.5V6H15' }),
  );
  if (kind === 'add') {
    svg.appendChild(svgNode(doc, 'path', { d: 'M7.5 12h5M10 9.5v5' }));
  } else if (kind === 'del') {
    svg.appendChild(svgNode(doc, 'path', { d: 'M7.5 12h5' }));
  } else {
    svg.append(
      svgNode(doc, 'path', { d: 'M7.5 10h5' }),
      svgNode(doc, 'path', { d: 'M7.5 13h5' }),
    );
  }
  return svg;
}

function chevronIcon(doc) {
  const svg = svgNode(doc, 'svg', {
    viewBox: '0 0 18 20', fill: 'none', stroke: 'currentColor',
    'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    'aria-hidden': 'true', focusable: 'false',
  });
  svg.classList.add('hd-tree-chevron');
  svg.appendChild(svgNode(doc, 'path', { d: 'M6.5 5.5 11 10l-4.5 4.5' }));
  return svg;
}

const nodeKey = (project, type, fullPath) =>
  JSON.stringify([project ?? null, type, fullPath]);

const cmpText = (a, b) => {
  const af = a.toLowerCase();
  const bf = b.toLowerCase();
  return af < bf ? -1 : af > bf ? 1 : a < b ? -1 : a > b ? 1 : 0;
};

const sortNodes = (nodes) => nodes.sort((a, b) => {
  if (a.type !== b.type) {
    if (a.type === 'project') return -1;
    if (b.type === 'project') return 1;
    return a.type === 'dir' ? -1 : 1;
  }
  return cmpText(a.name, b.name);
});

function compactDir(node) {
  let current = node;
  const names = [current.name];
  while (current.children.length === 1 && current.children[0].type === 'dir') {
    current = current.children[0];
    names.push(current.name);
  }
  return {
    ...current,
    name: names.join('/'),
    children: current.children.map((child) =>
      child.type === 'dir' ? compactDir(child) : child),
  };
}

function makeChildren(rows, project) {
  const root = new Map();
  const seenFiles = new Set();
  for (const entry of rows) {
    const path = String(entry?.f?.path || '');
    if (!path) continue;
    const parts = path.split('/').filter(Boolean);
    if (!parts.length) continue;
    const fileKey = nodeKey(project, 'file', path);
    if (seenFiles.has(fileKey)) continue;
    seenFiles.add(fileKey);
    let children = root;
    let dirPath = '';
    for (const segment of parts.slice(0, -1)) {
      dirPath = dirPath ? `${dirPath}/${segment}` : segment;
      const childKey = JSON.stringify(['dir', segment]);
      let dir = children.get(childKey);
      if (!dir) {
        dir = {
          type: 'dir', key: nodeKey(project, 'dir', dirPath), name: segment,
          path: dirPath, project, childMap: new Map(),
        };
        children.set(childKey, dir);
      }
      children = dir.childMap;
    }
    const name = parts[parts.length - 1];
    children.set(JSON.stringify(['file', name]), {
      type: 'file', key: fileKey, name, path, project, entry,
    });
  }

  const materialize = (children) => sortNodes([...children.values()].map((node) => {
    if (node.type === 'file') return node;
    const { childMap, ...dir } = node;
    return compactDir({ ...dir, children: materialize(childMap) });
  }));
  return materialize(root);
}

export function buildFileTree(rows) {
  const input = Array.isArray(rows) ? rows : [];
  const projectRows = new Map();
  const plainRows = [];
  for (const entry of input) {
    if (!entry?.f?.path) continue;
    if (entry.project == null) {
      plainRows.push(entry);
      continue;
    }
    const project = String(entry.project);
    if (!projectRows.has(project)) projectRows.set(project, []);
    projectRows.get(project).push(entry);
  }
  const nodes = makeChildren(plainRows, null);
  for (const project of [...projectRows.keys()].sort(cmpText)) {
    nodes.push({
      type: 'project',
      key: nodeKey(project, 'project', project),
      name: project,
      project,
      children: makeChildren(projectRows.get(project), project),
    });
  }
  return sortNodes(nodes);
}

export function firstFile(nodes) {
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (node?.type === 'file') return node;
    if (node?.children) {
      const found = firstFile(node.children);
      if (found) return found;
    }
  }
  return null;
}

export function fileStatus(entry) {
  if (entry?.isNew || entry?.f?.status === 'A' || entry?.f?.status === 'C') return 'add';
  if (entry?.f?.status === 'D') return 'del';
  return 'mod';
}

let nextTreeInstance = 0;

export function renderFileTree(nodes, options = {}) {
  // `collapsed` is a Set of DIRECTORY keys the caller owns across re-renders; this
  // function reads it for the initial state and writes it on every toggle. The
  // default is a throwaway Set, so a caller that does not pass one keeps the old
  // always-expanded behaviour.
  const { doc = document, onPick, counts = () => doc.createTextNode(''), initialKey,
    collapsed = new Set() } = options;
  const idPrefix = `hd-tree-${nextTreeInstance++}`;
  let nextGroup = 0;
  const nav = doc.createElement('nav');
  nav.className = 'hd-tree';
  nav.setAttribute('aria-label', 'Changed files');
  const fileButtons = new Map();
  let activeButton = null;

  function activate(button) {
    if (!button) return;
    if (activeButton && activeButton !== button) {
      activeButton.classList.remove('active');
      activeButton.removeAttribute('aria-current');
    }
    activeButton = button;
    button.classList.add('active');
    button.setAttribute('aria-current', 'true');
  }

  function renderFile(node, depth) {
    const button = doc.createElement('button');
    button.type = 'button';
    const state = fileStatus(node.entry);
    button.className = `hd-diff-file hd-tree-file ${state}`;
    if (state === 'add') button.classList.add('new');
    if (state === 'del') button.classList.add('deleted');
    button.dataset.fileKey = node.key;
    button.dataset.project = node.project ?? '';
    button.dataset.path = node.path;
    button.style.setProperty('--tree-indent', `${10 + depth * 14}px`);

    const f = node.entry?.f || {};
    const status = ({ A: 'Added', C: 'Copied', D: 'Deleted', R: 'Renamed', M: 'Modified' })[f.status]
      || (node.entry?.isNew ? 'Added' : 'Changed');
    const scope = node.project ? ` in project ${node.project}` : '';
    const identity = f.from
      ? `from ${String(f.from)} to ${node.path}`
      : `file ${node.path}`;
    const amount = f.binary
      ? 'binary file'
      : `${Number(f.added) || 0} lines added, ${Number(f.removed) || 0} lines removed`;
    const label = `${status} ${identity}${scope}, ${amount}`;
    button.setAttribute('aria-label', label);
    button.title = label;

    const marker = doc.createElement('span');
    marker.className = 'hd-tree-status';
    marker.setAttribute('aria-hidden', 'true');
    marker.appendChild(treeIcon(doc, state));
    const path = doc.createElement('span');
    path.className = 'hd-diff-path mono';
    path.textContent = node.name;
    const countNode = counts(node.entry);
    button.append(marker, path);
    if (countNode) button.appendChild(countNode);
    button.addEventListener('click', () => {
      activate(button);
      onPick?.(node.entry, node.key);
    });
    fileButtons.set(node.key, button);
    return button;
  }

  function renderDir(node, depth) {
    const fragment = doc.createDocumentFragment();
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'hd-tree-dir';
    button.style.setProperty('--tree-indent', `${10 + depth * 14}px`);
    button.dataset.dirKey = node.key;
    const open = !collapsed.has(node.key);
    button.setAttribute('aria-expanded', String(open));
    const fullLabel = node.project ? `${node.project}/${node.path}` : node.path;
    button.setAttribute('aria-label', `${open ? 'Collapse' : 'Expand'} directory ${fullLabel}`);
    const group = doc.createElement('div');
    group.className = 'hd-tree-group';
    group.id = `${idPrefix}-group-${nextGroup++}`;
    group.hidden = !open;
    button.setAttribute('aria-controls', group.id);
    const chevron = chevronIcon(doc);
    const folder = treeIcon(doc, 'folder');
    const label = doc.createElement('span');
    label.className = 'hd-tree-dir-label mono';
    label.textContent = node.name;
    button.append(chevron, folder, label);
    renderNodes(node.children, group, depth + 1);
    button.addEventListener('click', () => {
      const expanded = button.getAttribute('aria-expanded') === 'true';
      button.setAttribute('aria-expanded', String(!expanded));
      group.hidden = expanded;
      if (expanded) collapsed.add(node.key); else collapsed.delete(node.key);
      button.setAttribute('aria-label',
        `${expanded ? 'Expand' : 'Collapse'} directory ${fullLabel}`);
    });
    fragment.append(button, group);
    return fragment;
  }

  function renderNodes(items, host, depth) {
    for (const node of items || []) {
      if (node.type === 'file') {
        host.appendChild(renderFile(node, depth));
      } else if (node.type === 'dir') {
        host.appendChild(renderDir(node, depth));
      } else if (node.type === 'project') {
        const heading = doc.createElement('div');
        heading.className = 'hd-tree-project';
        heading.setAttribute('role', 'heading');
        heading.setAttribute('aria-level', '3');
        heading.textContent = node.name;
        const group = doc.createElement('div');
        group.className = 'hd-tree-group';
        group.id = `${idPrefix}-group-${nextGroup++}`;
        renderNodes(node.children, group, depth);
        host.append(heading, group);
      }
    }
  }

  renderNodes(nodes, nav, 0);
  const initial = fileButtons.get(initialKey);
  if (initial) activate(initial);
  return nav;
}
