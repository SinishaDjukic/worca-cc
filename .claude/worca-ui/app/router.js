export function parseHash(hash) {
  const clean = (hash || '').replace(/^#\/?/, '');
  const [path, query] = clean.split('?');
  const parts = path.split('/').filter(Boolean);

  // New path-segment format: project/{slug}/{section}[/{runId}]
  if (parts[0] === 'project' && parts.length >= 3) {
    return {
      section: parts[2],
      runId: parts[3] || null,
      projectId: parts[1],
    };
  }

  // Short format: {section}[/{runId}] (single-project / no project in URL)
  const section = parts[0] || 'active';
  const runId = parts[1] || null;

  // Backward compat: fall back to query params if present
  const params = new URLSearchParams(query || '');
  return {
    section,
    runId: runId || params.get('run') || null,
    projectId: params.get('project') || null,
  };
}

export function buildHash(section, runId, projectId) {
  if (projectId) {
    const base = `#/project/${projectId}/${section}`;
    return runId ? `${base}/${runId}` : base;
  }
  const base = `#/${section}`;
  return runId ? `${base}/${runId}` : base;
}

export function onHashChange(callback) {
  const handler = () => callback(parseHash(location.hash));
  window.addEventListener('hashchange', handler);
  return () => window.removeEventListener('hashchange', handler);
}

export function navigate(section, runId, projectId) {
  location.hash = buildHash(section, runId, projectId);
}
