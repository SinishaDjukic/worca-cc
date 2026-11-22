// test/fixtures/secrets/door-breaker.mjs — a module that opens the saved proxy login itself instead of going through
// src/core/proxy-credentials.mjs. Never imported: test/secrets-doors.test.mjs scans its text and must report it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function readLoginBehindTheDoor(home) {
  return JSON.parse(readFileSync(join(home, 'proxy-login.json'), 'utf8'));
}
