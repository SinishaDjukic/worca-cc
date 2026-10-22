// test/ask-spawn-skills.test.mjs — skills registry §4.4 + probes 6/9/12 and the dontAsk allow probes: an Ask turn that
// mounts ≥1 set skill gets the Skill tool, one `Skill(<plugin>:<skill>)` allow per mounted skill (never a bare `Skill`
// allow: under dontAsk it would let every skill that needs approval through) and one --plugin-dir per generated plugin,
// and loses --disable-slash-commands (it hides the Skill tool AND every plugin skill); without a mount the recipe is
// unchanged. Always: skill shell blocks off through the --settings seam, and the skill library Read-denied; with a
// mount, Claude Code's bundled skills stay out (disableBundledSkills, same seam).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import {
  buildAskSpawnOptions, sandboxNote, askWorktreeAllowRules, askSkillsAllowRules,
  ASK_DENY_RULES, ASK_SKILL_SETTINGS, ASK_SKILL_MOUNT_SETTINGS, SANDBOX_NOTE,
} from '../src/core/ask/spawn.mjs';
import { buildClaudeArgs } from '../src/core/claude-runner.mjs';

const FAKE_HOME = '/Users/zed/.worca-cc';
const DIRS = [join(FAKE_HOME, 'ask', 'ask_00000001', 'skills', 'askm_00000001', 'billing'), join(FAKE_HOME, 'ask', 'ask_00000001', 'skills', 'askm_00000001', 'general')];
const SKILLS = { pluginDirs: DIRS, names: ['billing:deploy-checklist', 'general:graphify'] };
const base = (over = {}) => ({
  thread: { id: 'ask_00000001', sessionId: null },
  turn: { prompt: 'hello', systemPrompt: 'SYS', model: 'claude-opus-5-5', effort: 'high' },
  limits: { maxTurns: 40, maxBudgetUsd: 2 },
  mcpConfigPath: join(FAKE_HOME, 'tmp', 'ask', 'mcp-askm_00000001.json'),
  scratchDir: join(FAKE_HOME, 'tmp', 'ask'),
  ...over,
});
const REG = { servers: { jira: { type: 'http', url: 'https://j/mcp' } }, env: {}, secretValues: [], grants: ['mcp__jira'], disallowedTools: [],
  copies: [{ name: 'jira', setId: 'general', setName: 'General' }], skipped: [], skippedTools: [], sets: [] };

test('always: the library is Read-denied (//-anchored, the home never interpolated) and skill shell blocks are off through --settings; bundled skills off only with a mount', () => {
  assert.ok(ASK_DENY_RULES.includes('Read(//**/.worca-cc/skills/**)'));
  assert.deepEqual(ASK_SKILL_SETTINGS, { disableSkillShellExecution: true });
  assert.ok(Object.isFrozen(ASK_SKILL_SETTINGS));
  assert.deepEqual(ASK_SKILL_MOUNT_SETTINGS, { disableBundledSkills: true });
  assert.ok(Object.isFrozen(ASK_SKILL_MOUNT_SETTINGS));
  for (const [o, extra] of [[buildAskSpawnOptions(base()), {}], [buildAskSpawnOptions(base({ skills: SKILLS })), { disableBundledSkills: true }]]) {
    assert.deepEqual(o.extraSettings, { disableSkillShellExecution: true, ...extra }, 'without a mount the one always-on key only');
    assert.notEqual(o.extraSettings, ASK_SKILL_SETTINGS, 'a copy, never the frozen constant');
    const settings = JSON.parse(buildClaudeArgs(o)[buildClaudeArgs(o).indexOf('--settings') + 1]);
    assert.equal(settings.disableSkillShellExecution, true, 'one --settings payload carries the rules and the setting');
    assert.equal(settings.disableBundledSkills, extra.disableBundledSkills, 'the bundled skills: off in the payload with a mount, absent without');
    assert.ok(settings.permissions.deny.includes('Read(//**/.worca-cc/skills/**)'));
  }
});

test('no mount: the Skill tool stays denied, slash commands stay off, no --plugin-dir — an empty mount counts as none', () => {
  for (const skills of [undefined, null, { pluginDirs: [], names: [] }]) {
    const o = buildAskSpawnOptions(base({ skills }));
    assert.deepEqual(o.tools, ['Task', 'Read', 'Grep', 'Glob']);
    assert.deepEqual(o.allowedTools, ['Task', 'Read', 'Grep', 'Glob']);
    assert.equal(o.disableSlashCommands, true);
    assert.ok(o.permissionRules.deny.includes('Skill'));
    assert.deepEqual(o.permissionRules.allow, askWorktreeAllowRules('ask_00000001'));
    assert.ok(!Object.hasOwn(o, 'pluginDirs'));
    assert.equal(o.appendSubagentSystemPrompt, SANDBOX_NOTE);
    const args = buildClaudeArgs(o);
    assert.ok(args.includes('--disable-slash-commands'));
    assert.ok(!args.includes('--plugin-dir'));
  }
});

test('a mount: Skill joins --tools, one Skill(<plugin>:<skill>) allow per mounted skill (after ToolSearch with copies), Skill leaves the deny list, slash commands come back, one --plugin-dir per plugin', () => {
  const o = buildAskSpawnOptions(base({ skills: SKILLS }));
  assert.deepEqual(o.tools, ['Task', 'Read', 'Grep', 'Glob', 'Skill']);
  assert.deepEqual(o.allowedTools, ['Task', 'Read', 'Grep', 'Glob', 'Skill(billing:deploy-checklist)', 'Skill(general:graphify)']);
  assert.ok(!o.allowedTools.includes('Skill'), 'never a bare Skill allow');
  assert.deepEqual(o.permissionRules.deny, ASK_DENY_RULES.filter((r) => r !== 'Skill'));
  assert.ok(!Object.hasOwn(o, 'disableSlashCommands'), 'probe 6: --disable-slash-commands hides the Skill tool and every plugin skill');
  assert.deepEqual(o.pluginDirs, DIRS);
  assert.notEqual(o.pluginDirs, SKILLS.pluginDirs, 'a copy');
  assert.deepEqual(o.permissionRules.allow, [...askWorktreeAllowRules('ask_00000001'), ...askSkillsAllowRules('ask_00000001')]);
  for (const t of ['Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch']) assert.ok(o.permissionRules.deny.includes(t), `${t} still denied`);
  const withReg = buildAskSpawnOptions(base({ skills: SKILLS, registry: REG }));
  assert.deepEqual(withReg.tools, ['Task', 'Read', 'Grep', 'Glob', 'ToolSearch', 'Skill']);
  assert.deepEqual(withReg.allowedTools, ['Task', 'Read', 'Grep', 'Glob', 'ToolSearch', 'Skill(billing:deploy-checklist)', 'Skill(general:graphify)']);
  const args = buildClaudeArgs(o);
  assert.equal(args[args.indexOf('--tools') + 1], 'Task,Read,Grep,Glob,Skill');
  assert.equal(args[args.indexOf('--allowedTools') + 1], 'Task,Read,Grep,Glob,Skill(billing:deploy-checklist),Skill(general:graphify),mcp__worca');
  assert.ok(!args.includes('--disable-slash-commands'));
  assert.ok(args.includes('--setting-sources') && args[args.indexOf('--setting-sources') + 1] === 'project', 'personal ~/.claude skills stay out');
  const flags = args.flatMap((a, i) => (a === '--plugin-dir' ? [args[i + 1]] : []));
  assert.deepEqual(flags, DIRS);
  const settings = JSON.parse(args[args.indexOf('--settings') + 1]);
  assert.ok(!settings.permissions.deny.includes('Skill'));
});

test('only a <plugin>:<skill> name becomes an allow rule — a comma or a parenthesis never reaches the comma-joined --allowedTools', () => {
  const o = buildAskSpawnOptions(base({ skills: { pluginDirs: DIRS, names: ['billing:deploy-checklist', 'x,Bash', 'a:b)', 'Skill', 'general:', 'Billing:x', 'billing:-x', 'billing:a--b', 7] } }));
  assert.deepEqual(o.allowedTools, ['Task', 'Read', 'Grep', 'Glob', 'Skill(billing:deploy-checklist)']);
  assert.deepEqual(o.tools, ['Task', 'Read', 'Grep', 'Glob', 'Skill'], 'the mount still loads (skills without allowed-tools need no rule)');
  // The longest names P1 allows (a 32-character plugin, a 64-character skill) keep their rule; one character more does not.
  const edge = [`${'p'.repeat(32)}:x`, `a:${'b'.repeat(64)}`, `${'p'.repeat(33)}:x`, `a:${'b'.repeat(65)}`];
  assert.deepEqual(buildAskSpawnOptions(base({ skills: { pluginDirs: DIRS, names: edge } })).allowedTools.slice(4), edge.slice(0, 2).map((n) => `Skill(${n})`));
});

test('askSkillsAllowRules: the turn\'s own mount under the thread, shape-checked, the home never interpolated', () => {
  assert.deepEqual(askSkillsAllowRules('ask_00000001'), ['Read(//**/.worca-cc/ask/ask_00000001/skills/**)']);
  assert.deepEqual(askSkillsAllowRules('../etc'), []);
  assert.deepEqual(askSkillsAllowRules('ask_00000001/../x'), [], 'the whole id, never a prefix');
  assert.deepEqual(askSkillsAllowRules(undefined), []);
});

test('sandboxNote: byte-identical without skills; with a mount it names the skills and keeps scripts and other skills out', () => {
  const sha = (s) => createHash('sha256').update(s).digest('hex');
  assert.equal(sandboxNote({ skills: [] }), SANDBOX_NOTE);
  assert.equal(sha(sandboxNote()), '655b1ddb591fcc66fb4b25af1e58c78d1e0968bb10653e0fb6bd0c4f24c3d66d', 'SANDBOX_NOTE unchanged');
  const note = buildAskSpawnOptions(base({ skills: SKILLS })).appendSubagentSystemPrompt;
  assert.equal(note, sandboxNote({ skills: SKILLS.names }));
  assert.match(note, /the Skill tool, for the skills from the user's sets only \(billing:deploy-checklist, general:graphify\)/);
  assert.match(note, /never invoke any other skill/);
  assert.match(note, /never run a skill's scripts or shell blocks/);
  assert.match(note, /Read may also open the files under the base directory the Skill tool gives for one of these skills;/, 'a skill\'s references and templates stay readable');
  assert.ok(note.startsWith(SANDBOX_NOTE.slice(0, 60)), 'the head is unchanged');
});
