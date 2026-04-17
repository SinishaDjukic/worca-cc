export function createRestClient({ host, port }) {
  const base = `http://${host}:${port}`;
  return {
    async get(path) {
      const r = await fetch(`${base}${path}`);
      return { status: r.status, data: r.ok ? await r.json() : null };
    },
    async post(path, body) {
      const r = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
      return { status: r.status, data: r.ok ? await r.json() : null };
    },
  };
}
