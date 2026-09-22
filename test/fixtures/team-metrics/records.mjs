export function makeRecord({
  id, startedAt = '2026-09-10T10:00:00Z', usd = 1, result = 'done', wallMs = 1000, activeMs = 800, pausedMs = undefined,
  workflow = { id: 'wf_auto', name: 'Auto', version: 2 }, review = null, questions = 0, pauses = 0,
  pr = null, actor = 'Siniša Đukić', source = null, kind = 'project', project = 'acme/billing-api',
  workspace = 'IoT SP Platform', workspaceId = null, touched = [], touchedFiles = undefined, files = null, title = `run ${id}`, models = ['claude-opus-5'],
}) {
  return {
    v: 1, id, worca: '1.2.0', recordedAt: startedAt, startedAt, endedAt: startedAt, wallMs, activeMs,
    ...(pausedMs === undefined ? {} : { pausedMs }),   // absent = a record pushed before the field existed
    result, failure: result === 'failed' ? { kind: 'error', message: 'x' } : null, workflow,
    target: kind === 'workspace' ? { kind, workspace, workspaceId, projects: ['acme/gateway', 'acme/console'], touched, ...(touchedFiles === undefined ? {} : { touchedFiles }) } : { kind, project },
    title, source, cost: { usd, byPhase: {} }, agents: { count: 1, keys: ['planner'], models },
    steps: 1, cycles: review == null ? {} : { review }, interventions: { questions, pauses, resumes: pauses },
    pr, git: { branch: null, head: null, base: null, filesChanged: files, insertions: null, deletions: null }, actor,
  };
}
