import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import {
  evaluateEngines, DECLARED_ENGINES,
} from '../src/core/repo-readiness/engines.mjs';
import { collectFacts } from '../src/core/repo-readiness/facts.mjs';

function gitDir() {
  const dir = mkdtempSync(join(tmpdir(), 'eng-'));
  execSync('git init -q && git config user.email "t@t" && git config user.name "T" && git commit --allow-empty -m "init" -q', { cwd: dir, stdio: 'ignore' });
  return dir;
}

function commitAll(dir) {
  execSync('git add -A && git commit -m "x" -q', { cwd: dir, stdio: 'ignore' });
}

function withRepo(setup, fn) {
  const dir = gitDir();
  try {
    setup?.(dir);
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const NO_LOCKS = {};
const perEngineRows = (checks) => checks.filter((r) => r.engine !== undefined);
const row = (checks, id, engine) => checks.find((r) => r.id === id && r.engine === engine);

describe('engines module', () => {
  it('exports DECLARED_ENGINES as a frozen array', () => {
    assert.ok(Array.isArray(DECLARED_ENGINES));
    for (const n of ['claude', 'codex', 'copilot', 'cursor']) assert.ok(DECLARED_ENGINES.includes(n));
    assert.ok(!DECLARED_ENGINES.includes('mock'));
    assert.throws(() => { DECLARED_ENGINES.push('x'); }, TypeError);
  });

  describe('evaluateEngines', () => {
    it('returns {engines, checks} with a level per declared engine', () => {
      withRepo(null, (dir) => {
        const result = evaluateEngines(collectFacts(dir), { env: NO_LOCKS });
        assert.ok(Array.isArray(result.checks));
        assert.deepEqual(Object.keys(result.engines).sort(), [...DECLARED_ENGINES].sort());
        for (const name of DECLARED_ENGINES) {
          assert.ok(['ready', 'partial', 'not-ready', 'unknown'].includes(result.engines[name].level));
          assert.ok(Array.isArray(result.engines[name].failing));
        }
      });
    });

    it('is ready when every applicable check passes or skips', () => {
      withRepo((dir) => {
        writeFileSync(join(dir, 'package.json'), '{"scripts":{"test":"jest","build":"x","lint":"x"}}');
        writeFileSync(join(dir, 'package-lock.json'), '{}');
        writeFileSync(join(dir, 'CLAUDE.md'), '# c');
        writeFileSync(join(dir, 'AGENTS.md'), '# a');
        mkdirSync(join(dir, '.github'));
        writeFileSync(join(dir, '.github', 'copilot-instructions.md'), '# g');
        commitAll(dir);
      }, (dir) => {
        const { engines } = evaluateEngines(collectFacts(dir), { env: NO_LOCKS });
        assert.equal(engines.claude.level, 'ready');
        assert.equal(engines.codex.level, 'ready');
        assert.equal(engines.copilot.level, 'ready');
        assert.equal(engines.cursor.level, 'ready');
      });
    });

    it('is not-ready for an engine whose instructions are missing (blocker)', () => {
      withRepo((dir) => {
        writeFileSync(join(dir, 'CLAUDE.md'), '# c');
        commitAll(dir);
      }, (dir) => {
        const { engines, checks } = evaluateEngines(collectFacts(dir), { env: NO_LOCKS });
        assert.equal(engines.claude.level === 'not-ready', false);
        assert.equal(engines.codex.level, 'not-ready');
        assert.ok(engines.codex.failing.includes('instructions.present'));
        assert.equal(row(checks, 'instructions.present', 'codex').status, 'fail');
        assert.equal(row(checks, 'instructions.present', 'claude').status, 'pass');
      });
    });

    it('is partial when only a warn check fails', () => {
      withRepo((dir) => {
        writeFileSync(join(dir, 'AGENTS.md'), '# a');
        writeFileSync(join(dir, 'package.json'), '{}');
        writeFileSync(join(dir, 'package-lock.json'), '{}');
        commitAll(dir);
      }, (dir) => {
        const { engines } = evaluateEngines(collectFacts(dir), { env: NO_LOCKS });
        assert.equal(engines.codex.level, 'partial');
        assert.ok(engines.codex.failing.includes('commands.test'));
      });
    });

    it('is unknown for every engine when the folder is not a git repo', () => {
      withRepo(null, (dir) => {
        const facts = collectFacts(dir);
        facts.isRepo = false;
        const { engines } = evaluateEngines(facts, { env: NO_LOCKS });
        for (const name of DECLARED_ENGINES) assert.equal(engines[name].level, 'unknown');
      });
    });

    it('is unknown for every engine when facts carry an error', () => {
      withRepo(null, (dir) => {
        const facts = collectFacts(dir);
        facts.error = 'boom';
        const { engines } = evaluateEngines(facts, { env: NO_LOCKS });
        for (const name of DECLARED_ENGINES) assert.equal(engines[name].level, 'unknown');
      });
    });

    it('applies the ignore list: an ignored check is never failing and its row is ignored', () => {
      withRepo((dir) => {
        writeFileSync(join(dir, 'AGENTS.md'), '# a');
        writeFileSync(join(dir, 'package.json'), '{}');
        writeFileSync(join(dir, 'package-lock.json'), '{}');
        commitAll(dir);
      }, (dir) => {
        const facts = collectFacts(dir);
        const r1 = evaluateEngines(facts, { ignore: [], env: NO_LOCKS });
        assert.ok(r1.engines.codex.failing.includes('commands.test'));
        const r2 = evaluateEngines(facts, { ignore: ['commands.test'], env: NO_LOCKS });
        assert.ok(!r2.engines.codex.failing.includes('commands.test'));
        assert.equal(r2.engines.codex.level, 'ready'); // the remaining failures are info-only
        assert.equal(r2.checks.find((r) => r.id === 'commands.test').status, 'ignored');
      });
    });

    it('ignores a perEngine check id for every engine', () => {
      withRepo((dir) => {
        writeFileSync(join(dir, 'CLAUDE.md'), '# c');
        commitAll(dir);
      }, (dir) => {
        const { engines, checks } = evaluateEngines(collectFacts(dir), { ignore: ['instructions.present'], env: NO_LOCKS });
        assert.ok(!engines.codex.failing.includes('instructions.present'));
        assert.equal(row(checks, 'instructions.present', 'codex').status, 'ignored');
      });
    });

    it('marks broker-locked engines unknown with the lock reason', () => {
      withRepo((dir) => {
        writeFileSync(join(dir, 'AGENTS.md'), '# a');
        commitAll(dir);
      }, (dir) => {
        const env = { WORCA_BROKER_URL: 'http://broker:8080' };
        const { engines } = evaluateEngines(collectFacts(dir), { env });
        assert.equal(engines.claude.locked, undefined);
        for (const name of ['codex', 'copilot', 'cursor']) {
          assert.equal(engines[name].level, 'unknown');
          assert.deepEqual(engines[name].failing, []);
          assert.match(engines[name].locked, /credential broker/);
        }
      });
    });

    it('emits one row per declared engine per perEngine check, scoped to that engine', () => {
      withRepo(null, (dir) => {
        const { checks } = evaluateEngines(collectFacts(dir), { env: NO_LOCKS });
        const rows = perEngineRows(checks);
        assert.equal(rows.length, 2 * DECLARED_ENGINES.length);
        for (const id of ['instructions.present', 'instructions.committed']) {
          for (const name of DECLARED_ENGINES) {
            const r = row(checks, id, name);
            assert.ok(r, `${id} for ${name}`);
            assert.deepEqual(r.engines, [name]);
          }
        }
      });
    });

    it('shared rows carry the applicable engine list and no engine field', () => {
      withRepo(null, (dir) => {
        const { checks } = evaluateEngines(collectFacts(dir), { env: NO_LOCKS });
        const shared = checks.find((r) => r.id === 'git.repo');
        assert.equal(shared.engine, undefined);
        assert.deepEqual(shared.engines, [...DECLARED_ENGINES]);
      });
    });

    it('skips every cursor perEngine row (no verified instruction sources)', () => {
      withRepo((dir) => {
        writeFileSync(join(dir, 'AGENTS.md'), '# a');
        commitAll(dir);
      }, (dir) => {
        const { checks, engines } = evaluateEngines(collectFacts(dir), { env: NO_LOCKS });
        const rows = perEngineRows(checks).filter((r) => r.engine === 'cursor');
        assert.equal(rows.length, 2);
        for (const r of rows) assert.equal(r.status, 'skip');
        assert.ok(!engines.cursor.failing.includes('instructions.present'));
      });
    });

    it('instructions.present matches a glob entry against tracked files', () => {
      withRepo((dir) => {
        mkdirSync(join(dir, '.claude', 'rules'), { recursive: true });
        writeFileSync(join(dir, '.claude', 'rules', 'style.md'), '# r');
        commitAll(dir);
      }, (dir) => {
        const { checks } = evaluateEngines(collectFacts(dir), { env: NO_LOCKS });
        assert.equal(row(checks, 'instructions.present', 'claude').status, 'pass');
      });
    });

    it('instructions.committed is skipped for Claude even when CLAUDE.md is untracked', () => {
      withRepo((dir) => {
        writeFileSync(join(dir, 'CLAUDE.md'), '# c');
      }, (dir) => {
        const { checks } = evaluateEngines(collectFacts(dir), { env: NO_LOCKS });
        assert.equal(row(checks, 'instructions.present', 'claude').status, 'pass');
        assert.equal(row(checks, 'instructions.committed', 'claude').status, 'skip');
      });
    });

    it('instructions.committed fails for an engine whose instruction file is untracked', () => {
      withRepo((dir) => {
        writeFileSync(join(dir, 'AGENTS.md'), '# a');
      }, (dir) => {
        const { checks, engines } = evaluateEngines(collectFacts(dir), { env: NO_LOCKS });
        const r = row(checks, 'instructions.committed', 'codex');
        assert.equal(r.status, 'fail');
        assert.match(r.detail, /AGENTS\.md/);
        assert.equal(row(checks, 'instructions.present', 'codex').status, 'pass');
        assert.equal(engines.codex.level, 'partial');
      });
    });

    it('instructions.committed passes when the engine files are tracked and skips when none exist', () => {
      withRepo((dir) => {
        writeFileSync(join(dir, 'AGENTS.md'), '# a');
        commitAll(dir);
      }, (dir) => {
        const { checks } = evaluateEngines(collectFacts(dir), { env: NO_LOCKS });
        assert.equal(row(checks, 'instructions.committed', 'codex').status, 'pass');
        assert.equal(row(checks, 'instructions.committed', 'copilot').status, 'pass');
      });
      withRepo(null, (dir) => {
        const { checks } = evaluateEngines(collectFacts(dir), { env: NO_LOCKS });
        assert.equal(row(checks, 'instructions.committed', 'codex').status, 'skip');
      });
    });

    it('instructions.committed fails for a tracked instruction file with uncommitted edits', () => {
      withRepo((dir) => {
        writeFileSync(join(dir, 'AGENTS.md'), '# a');
        commitAll(dir);
        writeFileSync(join(dir, 'AGENTS.md'), '# a edited');
      }, (dir) => {
        const { checks, engines } = evaluateEngines(collectFacts(dir), { env: NO_LOCKS });
        const r = row(checks, 'instructions.committed', 'codex');
        assert.equal(r.status, 'fail');
        assert.match(r.detail, /AGENTS\.md/);
        assert.equal(engines.codex.level, 'partial');
      });
    });

    it('instructions.committed fails for a staged-but-uncommitted edit and stays pass once committed', () => {
      withRepo((dir) => {
        writeFileSync(join(dir, 'AGENTS.md'), '# a');
        commitAll(dir);
        writeFileSync(join(dir, 'AGENTS.md'), '# a staged');
        execSync('git add AGENTS.md', { cwd: dir, stdio: 'ignore' });
      }, (dir) => {
        const { checks } = evaluateEngines(collectFacts(dir), { env: NO_LOCKS });
        assert.equal(row(checks, 'instructions.committed', 'codex').status, 'fail');
        commitAll(dir);
        const after = evaluateEngines(collectFacts(dir), { env: NO_LOCKS }).checks;
        assert.equal(row(after, 'instructions.committed', 'codex').status, 'pass');
      });
    });

    it('lists each failing check id once per engine', () => {
      withRepo(null, (dir) => {
        const { engines } = evaluateEngines(collectFacts(dir), { env: NO_LOCKS });
        for (const e of Object.values(engines)) assert.equal(new Set(e.failing).size, e.failing.length);
      });
    });

    it('a throwing check becomes an error row and never counts as failing', () => {
      withRepo((dir) => {
        writeFileSync(join(dir, 'AGENTS.md'), '# a');
        commitAll(dir);
      }, (dir) => {
        const facts = collectFacts(dir);
        facts.manifests = { get 'package.json'() { throw new Error('bad'); } };
        const { checks, engines } = evaluateEngines(facts, { env: NO_LOCKS });
        const r = checks.find((c) => c.id === 'commands.test');
        assert.equal(r.status, 'error');
        assert.ok(!engines.codex.failing.includes('commands.test'));
      });
    });
  });
});
