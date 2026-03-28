export function parseHash(hash) {
  const clean = (hash || '').replace(/^#\/?/, '');
  const [path, query] = clean.split('?');
  const section = path || 'active';
  const params = new URLSearchParams(query || '');
  return {
    section,
    runId: params.get('run') || null,
    projectId: params.get('project') || null,
  };
}

export function buildHash(section, runId, projectId) {
  const base = `#/${section}`;
  const params = new URLSearchParams();
  if (runId) params.set('run', runId);
  if (projectId) params.set('project', projectId);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

export function onHashChange(callback) {
  const handler = () => callback(parseHash(location.hash));
  window.addEventListener('hashchange', handler);
  return () => window.removeEventListener('hashchange', handler);
}

export function navigate(section, runId, projectId) {
  location.hash = buildHash(section, runId, projectId);
}
