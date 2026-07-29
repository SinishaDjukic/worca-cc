// test/fixtures/plugins/mock-source/connector/index.mjs
// Deterministic offline task source used across the plugin test suite and
// scripts/smoke-plugin.mjs. No network, no deps. Its observables mirror the
// WORCA_MOCK canned frames (plugin-shim.mjs): two tasks, markdown bodies,
// and reportResult recorded under state key 'lastReport' — so assertions hold
// whether the real child ran (shim tests) or the canned frame served (smoke).
const TASKS = [
  { id: 'MOCK-1', title: 'Mock task one', url: 'https://example.invalid/mock/1', state: 'open', labels: ['mock'], updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'MOCK-2', title: 'Mock task two', url: 'https://example.invalid/mock/2', state: 'open', labels: [], updatedAt: '2026-01-02T00:00:00.000Z' },
];

export default function createTaskSource(ctx) {
  return {
    async validateConfig() {
      return { ok: true, identity: 'mock-user' };
    },
    async listTasks({ search } = {}) {
      const needle = String(search || '').trim().toLowerCase();
      const tasks = needle ? TASKS.filter((t) => t.title.toLowerCase().includes(needle)) : TASKS;
      return { tasks };
    },
    async getTask(id) {
      const t = TASKS.find((x) => x.id === id);
      if (!t) return null;
      return {
        ...t,
        body: `## Goal\n\nDeterministic body for ${id}.\n\n- offline\n- no tokens\n`,
        meta: { source: 'mock', echoedId: id },
      };
    },
    async reportResult(id, { status, summary, links = [] }) {
      // Recorded via ctx.state -> the host applies the stateDelta to
      // data/state.json (NOT into this fixture dir), giving tests a
      // file-backed observable that write-back ran.
      await ctx.state.set('lastReport', JSON.stringify({ id, status, summary, links }));
      ctx.log('info', `mock-source: recorded reportResult for ${id} (${status})`);
    },
    capabilities() {
      return { writeBack: true, incrementalSync: false };
    },
  };
}
