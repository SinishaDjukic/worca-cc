import { createServer } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';

describe('POST /api/projects/inbox', () => {
  let httpServer;
  let port;
  let scheduleRefresh;
  let resolveRunProject;

  beforeEach(async () => {
    scheduleRefresh = vi.fn().mockReturnValue(true);
    resolveRunProject = vi.fn().mockReturnValue(null);

    const app = createApp({});
    app.locals.scheduleRefresh = scheduleRefresh;
    app.locals.resolveRunProject = resolveRunProject;

    httpServer = createServer(app);
    await new Promise((resolve) => httpServer.listen(0, resolve));
    port = httpServer.address().port;
  });

  afterEach(async () => {
    await new Promise((resolve) => httpServer.close(resolve));
  });

  function post(body, headers = {}) {
    return fetch(`http://localhost:${port}/api/projects/inbox`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  }

  it('returns 200 and triggers refresh when project_id provided in body', async () => {
    const res = await post({ project_id: 'test-project' });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true, project: 'test-project' });
    expect(scheduleRefresh).toHaveBeenCalledWith('test-project');
  });

  it('returns 200 when project identified via X-Worca-Project header', async () => {
    const res = await post({}, { 'X-Worca-Project': 'my-proj' });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true, project: 'my-proj' });
    expect(scheduleRefresh).toHaveBeenCalledWith('my-proj');
  });

  it('resolves project from run_id via resolveRunProject fallback', async () => {
    resolveRunProject.mockReturnValue('resolved-proj');
    const res = await post({ run_id: 'abc123' });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true, project: 'resolved-proj' });
    expect(resolveRunProject).toHaveBeenCalledWith('abc123');
    expect(scheduleRefresh).toHaveBeenCalledWith('resolved-proj');
  });

  it('returns 400 when no project can be identified', async () => {
    const res = await post({});
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/project_id/);
  });

  it('returns 400 when run_id provided but resolveRunProject returns null', async () => {
    resolveRunProject.mockReturnValue(null);
    const res = await post({ run_id: 'unknown' });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.ok).toBe(false);
  });

  it('returns 200 for unknown project (graceful)', async () => {
    scheduleRefresh.mockReturnValue(false);
    const res = await post({ project_id: 'nonexistent' });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true, project: 'nonexistent' });
  });

  it('priority: body.project_id wins over header and run_id', async () => {
    resolveRunProject.mockReturnValue('from-run');
    const res = await post(
      { project_id: 'from-body', run_id: 'xyz' },
      { 'X-Worca-Project': 'from-header' },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.project).toBe('from-body');
    expect(scheduleRefresh).toHaveBeenCalledWith('from-body');
  });
});
