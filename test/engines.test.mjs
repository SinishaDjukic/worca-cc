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
import { DEFAULT_CONTEXT_MAX_BYTES_PER_FILE } from '../src/core/settings.mjs';

function gitDir() {
  const dir = mkdtempSync(join(tmpdir(), 'eng-'));
  execSync('git init -q && git config user.email "t@t" && git config user.name "T" && git commit --allow-empty -m "init" -q', { cwd: dir, stdio: 'ignore' });
  return dir;
}

function commitAll(dir) {
  execSync('git add -A && git commit -m "x" -q', { cwd: dir, stdio: 'ignore' });
}

async function withRepo(setup, fn) {
  const dir = gitDir();
  try {
    await setup?.(dir);
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const NO_LOCKS = {};
const perEngineRows = (checks) => checks.filter((r) => r.engine !== undefined);
const row = (checks, id, engine) => checks.find((r) => r.id === id && r.engine === engine);

describe('engines module', () => {
  it('exports DECLARED_ENGINES as a frozen array', async () => {
    assert.ok(Array.isArray(DECLARED_ENGINES));
    for (const n of ['claude', 'codex', 'copilot', 'cursor']) assert.ok(DECLARED_ENGINES.includes(n));
    assert.ok(!DECLARED_ENGINES.includes('mock'));
    assert.throws(() => { DECLARED_ENGINES.push('x'); }, TypeError);
  });

  describe('evaluateEngines', () => {
    it('returns {engines, checks} with a level per declared engine', async () => {
      await withRepo(null, async (dir) => {
        const result = evaluateEngines(await collectFacts(dir), { env: NO_LOCKS });
        assert.ok(Array.isArray(result.checks));
        assert.deepEqual(Object.keys(result.engines).sort(), [...DECLARED_ENGINES].sort());
        for (const name of DECLARED_ENGINES) {
          assert.ok(['ready', 'partial', 'not-ready', 'unknown'].includes(result.engines[name].level));
          assert.ok(Array.isArray(result.engines[name].failing));
        }
      });
    });

    it('is ready when every applicable check passes or skips', async () => {
      await withRepo(async (dir) => {
        writeFileSync(join(dir, 'package.json'), '{"scripts":{"test":"jest","build":"x","lint":"x"}}');
        writeFileSync(join(dir, 'package-lock.json'), '{}');
        writeFileSync(join(dir, 'CLAUDE.md'), '# c');
        writeFileSync(join(dir, 'AGENTS.md'), '# a');
        mkdirSync(join(dir, '.github'));
        writeFileSync(join(dir, '.github', 'copilot-instructions.md'), '# g');
        commitAll(dir);
      }, async (dir) => {
        const { engines } = evaluateEngines(await collectFacts(dir), { env: NO_LOCKS });
        assert.equal(engines.claude.level, 'ready');
        assert.equal(engines.codex.level, 'ready');
        assert.equal(engines.copilot.level, 'ready');
        assert.equal(engines.cursor.level, 'ready');
      });
    });

    it('is not-ready for an engine whose instructions are missing (blocker)', async () => {
      await withRepo(async (dir) => {
        writeFileSync(join(dir, 'CLAUDE.md'), '# c');
        commitAll(dir);
      }, async (dir) => {
        const { engines, checks } = evaluateEngines(await collectFacts(dir), { env: NO_LOCKS });
        assert.equal(engines.claude.level === 'not-ready', false);
        assert.equal(engines.codex.level, 'not-ready');
        assert.ok(engines.codex.failing.includes('instructions.present'));
        assert.equal(row(checks, 'instructions.present', 'codex').status, 'fail');
        assert.equal(row(checks, 'instructions.present', 'claude').status, 'pass');
      });
    });

    // A Worca run writes <runRoot>/CLAUDE.md above the checkout, and Claude Code reads AGENTS.md only when no CLAUDE.md is in
    // its working folder or above it (code.claude.com/docs/en/memory#agents-md): in a run it never reads AGENTS.md by itself.
    it('AGENTS.md alone does not reach Claude Code in a Worca run, so it fails for Claude Code', async () => {
      await withRepo(async (dir) => {
        writeFileSync(join(dir, 'AGENTS.md'), '# a');
        commitAll(dir);
      }, async (dir) => {
        const { checks, engines } = evaluateEngines(await collectFacts(dir), { env: NO_LOCKS });
        assert.equal(row(checks, 'instructions.present', 'claude').status, 'fail');
        assert.ok(engines.claude.failing.includes('instructions.present'));
        assert.equal(row(checks, 'instructions.present', 'codex').status, 'pass');
      });
    });

    it('.claude/AGENTS.md alone does not reach Claude Code either', async () => {
      await withRepo(async (dir) => {
        mkdirSync(join(dir, '.claude'), { recursive: true });
        writeFileSync(join(dir, '.claude', 'AGENTS.md'), '# a');
        commitAll(dir);
      }, async (dir) => {
        const { checks } = evaluateEngines(await collectFacts(dir), { env: NO_LOCKS });
        assert.equal(row(checks, 'instructions.present', 'claude').status, 'fail');
      });
    });

    it('with a CLAUDE.md, Claude Code skips AGENTS.md, so its size does not count for Claude Code', async () => {
      await withRepo(async (dir) => {
        writeFileSync(join(dir, 'CLAUDE.md'), '# c');
        writeFileSync(join(dir, 'AGENTS.md'), 'x'.repeat(DEFAULT_CONTEXT_MAX_BYTES_PER_FILE + 1));
        commitAll(dir);
      }, async (dir) => {
        const { checks } = evaluateEngines(await collectFacts(dir), { env: NO_LOCKS });
        assert.equal(row(checks, 'instructions.present', 'claude').detail, 'CLAUDE.md found');
        assert.equal(row(checks, 'instructions.size', 'claude').status, 'pass');
        assert.equal(row(checks, 'instructions.size', 'codex').status, 'fail');
      });
    });

    it('the Claude Code miss lists only the files a run gives Claude Code', async () => {
      await withRepo(null, async (dir) => {
        const { checks } = evaluateEngines(await collectFacts(dir), { env: NO_LOCKS });
        assert.equal(row(checks, 'instructions.present', 'claude').detail, 'none of CLAUDE.md, .claude/CLAUDE.md, CLAUDE.local.md, .claude/rules/*.md found');
      });
    });

    it('instructions.present gives each engine its own fix', async () => {
      await withRepo(null, async (dir) => {
        const { checks } = evaluateEngines(await collectFacts(dir), { env: NO_LOCKS });
        assert.equal(row(checks, 'instructions.present', 'claude').fix,
          'Add CLAUDE.md. If the project already has an AGENTS.md, a line @AGENTS.md in CLAUDE.md pulls it in.');
        assert.equal(row(checks, 'instructions.present', 'codex').fix, 'Add AGENTS.md.');
        assert.equal(row(checks, 'instructions.present', 'copilot').fix, 'Add AGENTS.md or .github/copilot-instructions.md.');
        for (const r of perEngineRows(checks).filter((c) => c.id === 'instructions.present')) {
          if (r.engine !== 'claude') assert.doesNotMatch(r.fix, /CLAUDE\.md/);
        }
      });
    });

    it('a failing warn repository check makes the repository partial, not the engine', async () => {
      await withRepo(async (dir) => {
        writeFileSync(join(dir, 'AGENTS.md'), '# a');
        writeFileSync(join(dir, 'package.json'), '{}');
        writeFileSync(join(dir, 'package-lock.json'), '{}');
        commitAll(dir);
      }, async (dir) => {
        const { engines, repository } = evaluateEngines(await collectFacts(dir), { env: NO_LOCKS });
        assert.equal(repository.level, 'partial');
        assert.ok(repository.failing.includes('commands.test'));
        assert.equal(engines.codex.level, 'ready');
      });
    });

    it('is not-ready for every engine when the folder is not a git repo', async () => {
      await withRepo(null, async (dir) => {
        const facts = await collectFacts(dir);
        facts.isRepo = false;
        const { engines } = evaluateEngines(facts, { env: NO_LOCKS });
        for (const name of DECLARED_ENGINES) assert.deepEqual(engines[name], { level: 'not-ready', failing: [] });
      });
    });

    it('is unknown for every engine when facts carry an error', async () => {
      await withRepo(null, async (dir) => {
        const facts = await collectFacts(dir);
        facts.error = 'boom';
        const { engines } = evaluateEngines(facts, { env: NO_LOCKS });
        for (const name of DECLARED_ENGINES) assert.equal(engines[name].level, 'unknown');
      });
    });

    it('applies the ignore list: an ignored check is never failing and its row is ignored', async () => {
      await withRepo(async (dir) => {
        writeFileSync(join(dir, 'AGENTS.md'), '# a');
        writeFileSync(join(dir, 'package.json'), '{}');
        writeFileSync(join(dir, 'package-lock.json'), '{}');
        commitAll(dir);
      }, async (dir) => {
        const facts = await collectFacts(dir);
        const r1 = evaluateEngines(facts, { ignore: [], env: NO_LOCKS });
        assert.ok(r1.repository.failing.includes('commands.test'));
        const r2 = evaluateEngines(facts, { ignore: ['commands.test'], env: NO_LOCKS });
        assert.ok(!r2.repository.failing.includes('commands.test'));
        assert.equal(r2.repository.level, 'ready'); // the remaining failures are info-only
        assert.equal(r2.checks.find((r) => r.id === 'commands.test').status, 'ignored');
      });
    });

    it('ignores a perEngine check id for every engine', async () => {
      await withRepo(async (dir) => {
        writeFileSync(join(dir, 'CLAUDE.md'), '# c');
        commitAll(dir);
      }, async (dir) => {
        const { engines, checks } = evaluateEngines(await collectFacts(dir), { ignore: ['instructions.present'], env: NO_LOCKS });
        assert.ok(!engines.codex.failing.includes('instructions.present'));
        assert.equal(row(checks, 'instructions.present', 'codex').status, 'ignored');
      });
    });

    it('marks broker-locked engines unknown with the lock reason', async () => {
      await withRepo(async (dir) => {
        writeFileSync(join(dir, 'AGENTS.md'), '# a');
        commitAll(dir);
      }, async (dir) => {
        const env = { WORCA_BROKER_URL: 'http://broker:8080' };
        const { engines } = evaluateEngines(await collectFacts(dir), { env });
        assert.equal(engines.claude.locked, undefined);
        for (const name of ['codex', 'copilot', 'cursor']) {
          assert.equal(engines[name].level, 'unknown');
          assert.deepEqual(engines[name].failing, []);
          assert.match(engines[name].locked, /credential broker/);
        }
      });
    });

    it('emits one row per declared engine per tool check, scoped to that engine', async () => {
      await withRepo(null, async (dir) => {
        const { checks } = evaluateEngines(await collectFacts(dir), { env: NO_LOCKS });
        const rows = perEngineRows(checks);
        assert.equal(rows.length, 3 * DECLARED_ENGINES.length);
        for (const id of ['instructions.present', 'instructions.committed', 'instructions.size']) {
          for (const name of DECLARED_ENGINES) {
            const r = row(checks, id, name);
            assert.ok(r, `${id} for ${name}`);
            assert.equal(r.scope, 'tool');
          }
        }
      });
    });

    it('repository rows appear once, with no engine field', async () => {
      await withRepo(null, async (dir) => {
        const { checks } = evaluateEngines(await collectFacts(dir), { env: NO_LOCKS });
        const shared = checks.filter((r) => r.id === 'git.repo');
        assert.equal(shared.length, 1);
        assert.equal(shared[0].engine, undefined);
        assert.equal(shared[0].scope, 'repository');
      });
    });

    for (const [what, files] of [
      ['only a CLAUDE.md', { 'CLAUDE.md': '# c' }],
      ['only a .claude/CLAUDE.md', { '.claude/CLAUDE.md': '# c' }],
      ['only a GEMINI.md', { 'GEMINI.md': '# g' }],
      ['only path instructions', { '.github/instructions/web/ui.instructions.md': '# i' }],
    ]) {
      it(`Copilot reads ${what}`, async () => {
        await withRepo(async (dir) => {
          for (const [p, body] of Object.entries(files)) {
            mkdirSync(join(dir, p, '..'), { recursive: true });
            writeFileSync(join(dir, p), body);
          }
          commitAll(dir);
        }, async (dir) => {
          const { checks, engines } = evaluateEngines(await collectFacts(dir), { env: NO_LOCKS });
          assert.equal(row(checks, 'instructions.present', 'copilot').status, 'pass');
          assert.ok(!engines.copilot.failing.includes('instructions.present'));
        });
      });
    }

    it('Codex reads only AGENTS.override.md when it has content, so AGENTS.md does not count for Codex', async () => {
      await withRepo(async (dir) => {
        writeFileSync(join(dir, 'AGENTS.override.md'), '# o');
        writeFileSync(join(dir, 'AGENTS.md'), 'x'.repeat(DEFAULT_CONTEXT_MAX_BYTES_PER_FILE + 1));
        commitAll(dir);
      }, async (dir) => {
        const { checks } = evaluateEngines(await collectFacts(dir), { env: NO_LOCKS });
        assert.equal(row(checks, 'instructions.present', 'codex').detail, 'AGENTS.override.md found');
        assert.equal(row(checks, 'instructions.size', 'codex').status, 'pass');
      });
    });

    it('Codex skips an empty AGENTS.override.md and reads AGENTS.md', async () => {
      await withRepo(async (dir) => {
        writeFileSync(join(dir, 'AGENTS.override.md'), '');
        writeFileSync(join(dir, 'AGENTS.md'), '# a');
        commitAll(dir);
      }, async (dir) => {
        const { checks } = evaluateEngines(await collectFacts(dir), { env: NO_LOCKS });
        assert.equal(row(checks, 'instructions.present', 'codex').detail, 'AGENTS.md found');
      });
    });

    it('Codex skips an empty AGENTS.md, so it is missing for Codex', async () => {
      await withRepo(async (dir) => {
        writeFileSync(join(dir, 'AGENTS.md'), '');
        commitAll(dir);
      }, async (dir) => {
        const { checks, engines } = evaluateEngines(await collectFacts(dir), { env: NO_LOCKS });
        const r = row(checks, 'instructions.present', 'codex');
        assert.equal(r.status, 'fail');
        assert.equal(r.detail, 'AGENTS.md is empty');
        assert.equal(engines.codex.level, 'not-ready');
      });
    });

    it('Codex reads an untracked AGENTS.override.md locally only, so instructions.committed flags it', async () => {
      await withRepo(async (dir) => {
        writeFileSync(join(dir, 'AGENTS.md'), '# a');
        commitAll(dir);
        writeFileSync(join(dir, 'AGENTS.override.md'), '# o');
      }, async (dir) => {
        const { checks } = evaluateEngines(await collectFacts(dir), { env: NO_LOCKS });
        const r = row(checks, 'instructions.committed', 'codex');
        assert.equal(r.status, 'fail');
        assert.match(r.detail, /^AGENTS\.override\.md not committed/);
      });
    });

    it('Copilot combines its files, so their total counts against the size budget', async () => {
      const big = 'x'.repeat(DEFAULT_CONTEXT_MAX_BYTES_PER_FILE - 100);
      await withRepo(async (dir) => {
        mkdirSync(join(dir, '.github'));
        for (const p of ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md', '.github/copilot-instructions.md']) writeFileSync(join(dir, p), big);
        commitAll(dir);
      }, async (dir) => {
        const { checks } = evaluateEngines(await collectFacts(dir), { env: NO_LOCKS });
        assert.equal(row(checks, 'instructions.size', 'copilot').status, 'fail');
        assert.match(row(checks, 'instructions.size', 'copilot').detail, /total/);
        assert.equal(row(checks, 'instructions.size', 'codex').status, 'pass');
      });
    });

    for (const [what, files] of [
      ['an AGENTS.md', { 'AGENTS.md': '# a' }],
      ['a CLAUDE.md', { 'CLAUDE.md': '# c' }],
      ['a project rule', { '.cursor/rules/style.mdc': '---\nalwaysApply: true\n---\n# r' }],
      ['a nested project rule', { '.cursor/rules/web/ui.mdc': '# r' }],
    ]) {
      it(`Cursor reads ${what}`, async () => {
        await withRepo(async (dir) => {
          for (const [p, body] of Object.entries(files)) {
            mkdirSync(join(dir, p, '..'), { recursive: true });
            writeFileSync(join(dir, p), body);
          }
          commitAll(dir);
        }, async (dir) => {
          const { checks, engines } = evaluateEngines(await collectFacts(dir), { env: NO_LOCKS });
          assert.equal(row(checks, 'instructions.present', 'cursor').status, 'pass');
          assert.equal(engines.cursor.level, 'ready');
        });
      });
    }

    for (const [engine, file] of [
      ['gemini', 'GEMINI.md'], ['qwen', 'QWEN.md'], ['qwen', 'AGENTS.md'],
      ['goose', 'AGENTS.md'], ['goose', '.goosehints'], ['opencode', 'AGENTS.md'], ['opencode', 'CLAUDE.md'],
    ]) {
      it(`${engine} reads ${file}`, async () => {
        await withRepo(async (dir) => { writeFileSync(join(dir, file), '# i'); commitAll(dir); }, async (dir) => {
          const { checks, engines } = evaluateEngines(await collectFacts(dir), { env: NO_LOCKS });
          assert.equal(row(checks, 'instructions.present', engine).status, 'pass');
          assert.equal(engines[engine].level, 'ready');
        });
      });
    }

    it('the newer engines are checked, never ready without their instruction files', async () => {
      await withRepo(async (dir) => { writeFileSync(join(dir, 'README.md'), '# r'); commitAll(dir); }, async (dir) => {
        const { checks, engines } = evaluateEngines(await collectFacts(dir), { env: NO_LOCKS });
        const fixes = { gemini: 'Add GEMINI.md.', qwen: 'Add QWEN.md or AGENTS.md.', goose: 'Add AGENTS.md or .goosehints.', opencode: 'Add AGENTS.md.' };
        for (const [engine, fix] of Object.entries(fixes)) {
          const r = row(checks, 'instructions.present', engine);
          assert.equal(r.status, 'fail', engine);
          assert.equal(r.fix, fix, engine);
          assert.equal(engines[engine].level, 'not-ready', engine);
        }
      });
    });

    it('a personal .qwen/QWEN.local.md never reaches a run checkout, so it does not count for Qwen Code', async () => {
      await withRepo(async (dir) => {
        mkdirSync(join(dir, '.qwen'), { recursive: true });
        writeFileSync(join(dir, '.qwen', 'QWEN.local.md'), '# mine');
      }, async (dir) => {
        const { checks } = evaluateEngines(await collectFacts(dir), { env: NO_LOCKS });
        assert.equal(row(checks, 'instructions.present', 'qwen').status, 'fail');
      });
    });

    it('Gemini CLI does not read AGENTS.md by default', async () => {
      await withRepo(async (dir) => { writeFileSync(join(dir, 'AGENTS.md'), '# a'); commitAll(dir); }, async (dir) => {
        const { checks } = evaluateEngines(await collectFacts(dir), { env: NO_LOCKS });
        assert.equal(row(checks, 'instructions.present', 'gemini').status, 'fail');
      });
    });

    it('a Folder project: Git repository is skipped with its reason, and its CLAUDE.md makes Claude Code ready', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'eng-folder-'));
      try {
        writeFileSync(join(dir, 'CLAUDE.md'), '# c');
        const { checks, engines, repository } = evaluateEngines(await collectFacts(dir, { folder: true }), { env: NO_LOCKS });
        const g = checks.find((c) => c.id === 'git.repo');
        assert.equal(g.status, 'skip');
        assert.match(g.detail, /Folder project/);
        assert.notEqual(repository.level, 'unknown');
        assert.equal(engines.claude.level, 'ready');
        assert.equal(row(checks, 'instructions.committed', 'codex').status, 'skip');
      } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it('Cursor ignores a plain .md file in .cursor/rules and says how to fix it', async () => {
      await withRepo(async (dir) => {
        mkdirSync(join(dir, '.cursor', 'rules'), { recursive: true });
        writeFileSync(join(dir, '.cursor', 'rules', 'style.md'), '# r');
        commitAll(dir);
      }, async (dir) => {
        const { checks, engines } = evaluateEngines(await collectFacts(dir), { env: NO_LOCKS });
        const r = row(checks, 'instructions.present', 'cursor');
        assert.equal(r.status, 'fail');
        assert.equal(r.fix, 'Add AGENTS.md or a rule in .cursor/rules (a .mdc file).');
        assert.equal(engines.cursor.level, 'not-ready');
      });
    });

    it('Cursor runs see only committed files, so an untracked AGENTS.md fails instructions.committed', async () => {
      await withRepo(async (dir) => {
        writeFileSync(join(dir, 'AGENTS.md'), '# a');
      }, async (dir) => {
        const { checks } = evaluateEngines(await collectFacts(dir), { env: NO_LOCKS });
        assert.equal(row(checks, 'instructions.committed', 'cursor').status, 'fail');
      });
    });

    it('instructions.present matches a glob entry against tracked files', async () => {
      await withRepo(async (dir) => {
        mkdirSync(join(dir, '.claude', 'rules'), { recursive: true });
        writeFileSync(join(dir, '.claude', 'rules', 'style.md'), '# r');
        commitAll(dir);
      }, async (dir) => {
        const { checks } = evaluateEngines(await collectFacts(dir), { env: NO_LOCKS });
        assert.equal(row(checks, 'instructions.present', 'claude').status, 'pass');
      });
    });

    it('instructions.committed is skipped for Claude even when CLAUDE.md is untracked', async () => {
      await withRepo(async (dir) => {
        writeFileSync(join(dir, 'CLAUDE.md'), '# c');
      }, async (dir) => {
        const { checks } = evaluateEngines(await collectFacts(dir), { env: NO_LOCKS });
        assert.equal(row(checks, 'instructions.present', 'claude').status, 'pass');
        assert.equal(row(checks, 'instructions.committed', 'claude').status, 'skip');
      });
    });

    it('instructions.committed fails for an engine whose instruction file is untracked', async () => {
      await withRepo(async (dir) => {
        writeFileSync(join(dir, 'AGENTS.md'), '# a');
      }, async (dir) => {
        const { checks, engines } = evaluateEngines(await collectFacts(dir), { env: NO_LOCKS });
        const r = row(checks, 'instructions.committed', 'codex');
        assert.equal(r.status, 'fail');
        assert.match(r.detail, /AGENTS\.md/);
        assert.equal(row(checks, 'instructions.present', 'codex').status, 'pass');
        assert.equal(engines.codex.level, 'partial');
      });
    });

    it('instructions.committed passes when the engine files are tracked and skips when none exist', async () => {
      await withRepo(async (dir) => {
        writeFileSync(join(dir, 'AGENTS.md'), '# a');
        commitAll(dir);
      }, async (dir) => {
        const { checks } = evaluateEngines(await collectFacts(dir), { env: NO_LOCKS });
        assert.equal(row(checks, 'instructions.committed', 'codex').status, 'pass');
        assert.equal(row(checks, 'instructions.committed', 'copilot').status, 'pass');
      });
      await withRepo(null, async (dir) => {
        const { checks } = evaluateEngines(await collectFacts(dir), { env: NO_LOCKS });
        assert.equal(row(checks, 'instructions.committed', 'codex').status, 'skip');
      });
    });

    it('instructions.committed fails for a tracked instruction file with uncommitted edits', async () => {
      await withRepo(async (dir) => {
        writeFileSync(join(dir, 'AGENTS.md'), '# a');
        commitAll(dir);
        writeFileSync(join(dir, 'AGENTS.md'), '# a edited');
      }, async (dir) => {
        const { checks, engines } = evaluateEngines(await collectFacts(dir), { env: NO_LOCKS });
        const r = row(checks, 'instructions.committed', 'codex');
        assert.equal(r.status, 'fail');
        assert.match(r.detail, /AGENTS\.md/);
        assert.equal(engines.codex.level, 'partial');
      });
    });

    it('instructions.committed fails for a staged-but-uncommitted edit and stays pass once committed', async () => {
      await withRepo(async (dir) => {
        writeFileSync(join(dir, 'AGENTS.md'), '# a');
        commitAll(dir);
        writeFileSync(join(dir, 'AGENTS.md'), '# a staged');
        execSync('git add AGENTS.md', { cwd: dir, stdio: 'ignore' });
      }, async (dir) => {
        const { checks } = evaluateEngines(await collectFacts(dir), { env: NO_LOCKS });
        assert.equal(row(checks, 'instructions.committed', 'codex').status, 'fail');
        commitAll(dir);
        const after = evaluateEngines(await collectFacts(dir), { env: NO_LOCKS }).checks;
        assert.equal(row(after, 'instructions.committed', 'codex').status, 'pass');
      });
    });

    it('lists each failing check id once per engine', async () => {
      await withRepo(null, async (dir) => {
        const { engines } = evaluateEngines(await collectFacts(dir), { env: NO_LOCKS });
        for (const e of Object.values(engines)) assert.equal(new Set(e.failing).size, e.failing.length);
      });
    });

    it('a throwing check becomes an error row and never counts as failing', async () => {
      await withRepo(async (dir) => {
        writeFileSync(join(dir, 'AGENTS.md'), '# a');
        commitAll(dir);
      }, async (dir) => {
        const facts = await collectFacts(dir);
        facts.manifests = { get 'package.json'() { throw new Error('bad'); } };
        const { checks, engines } = evaluateEngines(facts, { env: NO_LOCKS });
        const r = checks.find((c) => c.id === 'commands.test');
        assert.equal(r.status, 'error');
        assert.ok(!engines.codex.failing.includes('commands.test'));
      });
    });
  });
});

describe('evaluateEngines v2', () => {
  it('returns repository and per-engine tool levels separately', async () => {
    await withRepo(async (dir) => { writeFileSync(join(dir, 'CLAUDE.md'), '# x\n'); commitAll(dir); }, async (dir) => {
      const r = evaluateEngines(await collectFacts(dir), { env: {} });
      assert.equal(r.engines.claude.level, 'ready');
      assert.equal(r.engines.codex.level, 'not-ready');            // no AGENTS.md
      assert.deepEqual(r.engines.codex.failing, ['instructions.present']);
      assert.ok(['ready', 'partial'].includes(r.repository.level));
      assert.ok(r.checks.every((c) => c.scope === 'repository' ? c.engine === undefined : typeof c.engine === 'string'));
    });
  });

  it('instructions.size is judged per engine on that engine\'s own files', async () => {
    await withRepo(async (dir) => {
      writeFileSync(join(dir, 'CLAUDE.md'), '# small\n');
      writeFileSync(join(dir, 'AGENTS.md'), 'x'.repeat(60 * 1024));
      commitAll(dir);
    }, async (dir) => {
      const r = evaluateEngines(await collectFacts(dir), { env: {} });
      const size = (e) => r.checks.find((c) => c.id === 'instructions.size' && c.engine === e);
      assert.equal(size('claude').status, 'pass');
      assert.equal(size('codex').status, 'fail');
      assert.match(size('codex').detail, /AGENTS\.md/);
    });
  });

  it('a passing tool check carries a detail', async () => {
    await withRepo(async (dir) => { writeFileSync(join(dir, 'CLAUDE.md'), '# x\n'); commitAll(dir); }, async (dir) => {
      const r = evaluateEngines(await collectFacts(dir), { env: {} });
      const present = r.checks.find((c) => c.id === 'instructions.present' && c.engine === 'claude');
      assert.deepEqual([present.status, present.detail], ['pass', 'CLAUDE.md found']);
    });
  });

  it('git.repo failing makes the repository and every judged tool not-ready', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'norepo-'));
    try {
      const r = evaluateEngines(await collectFacts(dir), { env: {} });
      assert.equal(r.repository.level, 'not-ready');
      assert.deepEqual(r.repository.failing, ['git.repo']);
      for (const e of Object.values(r.engines)) assert.deepEqual(e, { level: 'not-ready', failing: [] });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('a refused config (facts.error) still reads unknown', () => {
    const r = evaluateEngines({ isRepo: false, error: 'git refused this config', sizes: {}, instructionStatus: {} }, { env: {} });
    assert.equal(r.repository.level, 'unknown');
    for (const e of Object.values(r.engines)) assert.equal(e.level, 'unknown');
  });

  it('a timed-out first git call reads unknown, never "not a git work tree"', () => {
    const r = evaluateEngines({ isRepo: false, timedOut: true, error: null, sizes: {}, instructionStatus: {} }, { env: {} });
    assert.equal(r.repository.level, 'unknown');
    for (const e of Object.values(r.engines)) assert.equal(e.level, 'unknown');
    for (const c of r.checks) assert.notEqual(c.detail, 'not a git work tree', c.id);
    assert.equal(r.checks.find((c) => c.id === 'git.repo').status, 'error');
  });

  it('git.repo ignored: the engines read unknown', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'norepo-'));
    try {
      const r = evaluateEngines(await collectFacts(dir), { env: {}, ignore: ['git.repo'] });
      assert.notEqual(r.repository.level, 'unknown');
      for (const e of Object.values(r.engines)) assert.equal(e.level, 'unknown');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('an empty repository passes git.repo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'emptyrepo-'));
    try {
      execSync('git init -q', { cwd: dir, stdio: 'ignore' });
      const r = evaluateEngines(await collectFacts(dir), { env: {} });
      assert.equal(row(r.checks, 'git.repo').status, 'pass');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("Folder project: Cursor's instructions check passes on an on-disk .mdc", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'folder-'));
    try {
      mkdirSync(join(dir, '.cursor/rules'), { recursive: true });
      writeFileSync(join(dir, '.cursor/rules/x.mdc'), '# x');
      const r = evaluateEngines(await collectFacts(dir, { folder: true }), { env: {} });
      assert.equal(row(r.checks, 'instructions.present', 'cursor').status, 'pass');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

