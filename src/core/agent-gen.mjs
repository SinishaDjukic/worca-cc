// src/core/agent-gen.mjs
// The agent-creation wizard's builder engine. An AgentGen is an EventEmitter the
// server wires onto the WS bus exactly like wireScan wires a WorkspaceScan:
//   agentgen-progress { genId, phase, message }                       (many)
//   agentgen-done     { genId, draft: { meta, markdown } }            (terminal)
//   agentgen-error    { genId, message }                              (terminal)
// run() NEVER throws. The draft is NOT saved — saving is the wizard's explicit
// POST /api/agents. Mode A (no userMarkdown): one runClaude writes BOTH the .md
// body and the meta JSON draft. Mode B (userMarkdown given): the body is the
// user's verbatim; the LLM writes ONLY the meta JSON, inferred from the body +
// the neighbors' typed PORTS. Files are read back as authoritative
// (phases.mjs runWorkspaceScan pattern) then normalized via normalizeMeta — the
// meta v2 gate, so a draft that breaks a port rule never reaches the store.

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { worcaHome } from './projects.mjs';
import { runClaude } from './claude-runner.mjs';
import { normalizeMeta } from './agent-registry.mjs';

const SYSTEM_PROMPT =
  'You are an expert at writing agent system prompts and machine-readable agent metadata ' +
  'for worca-cc, a deterministic multi-agent pipeline. Write files exactly where asked. ' +
  'Metadata must be a single valid JSON object.';

export function createAgentGen(opts = {}) { return new AgentGen(opts); }

class AgentGen extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.name = (typeof opts.name === 'string' && opts.name.trim()) || 'Custom Agent';
    this.purpose = String(opts.purpose || '');
    this.details = String(opts.details || '');
    this.expectedBefore = Array.isArray(opts.expectedBefore) ? opts.expectedBefore : [];
    this.expectedAfter = Array.isArray(opts.expectedAfter) ? opts.expectedAfter : [];
    this.userMarkdown = typeof opts.userMarkdown === 'string' && opts.userMarkdown.trim() ? opts.userMarkdown : '';
    this.claude = opts.claude || {};
    this.genId = `agen_${randomUUID()}`;
    this.scratchDir = join(worcaHome(), 'tmp', 'agent-gen', this.genId.slice(5, 13));
    this.mdPath = join(this.scratchDir, 'agent.md');
    this.metaPath = join(this.scratchDir, 'agent.meta.json');
    this.abort = new AbortController();
    this.phase = 'draft';
    this.message = 'preparing…';
    this.status = 'created';
    this._terminal = false;
  }

  getState() {
    return { genId: this.genId, phase: this.phase, message: this.message, status: this.status };
  }

  stop() {
    if (this.status === 'done' || this.status === 'stopped' || this.status === 'error') return;
    this.status = 'stopped';
    try { this.abort.abort(); } catch { /* ignore */ }
  }

  async run() {
    try {
      this.status = 'running';
      this._checkAbort();
      await mkdir(this.scratchDir, { recursive: true });
      const metaOnly = !!this.userMarkdown;
      this._setPhase('draft', metaOnly
        ? `inferring metadata for "${this.name}" from your markdown…`
        : `drafting agent + metadata for "${this.name}"…`);
      if (metaOnly) await writeFile(this.mdPath, this.userMarkdown, 'utf8'); // the LLM reads it
      await runClaude({
        cwd: this.scratchDir,
        systemPrompt: SYSTEM_PROMPT,
        prompt: metaOnly ? this._metaPrompt() : this._fullPrompt(),
        allowedTools: ['Read', 'Write'],
        permissionMode: this.claude.permissionMode || 'acceptEdits',
        model: this.claude.model,
        bin: this.claude.bin,
        mock: this.claude.mock,
        signal: this.abort.signal,
        onEvent: (e) => this._onAgentEvent(e),
      });
      this._checkAbort();
      this._setPhase('finalize', 'validating the draft…');
      // Authoritative read-back (runWorkspaceScan pattern, phases.mjs:803-809).
      const markdown = metaOnly ? this.userMarkdown : await readFile(this.mdPath, 'utf8');
      const rawMeta = JSON.parse(await readFile(this.metaPath, 'utf8'));
      if (!Number.isFinite(Number(rawMeta?.order))) rawMeta.order = 99;
      const meta = normalizeMeta(rawMeta);
      if (!meta) throw new Error('the generator produced unusable metadata');
      if (!String(markdown || '').trim()) throw new Error('the generator produced an empty agent body');
      this.status = 'done';
      const draft = { meta, markdown };
      this._emitTerminal('agentgen-done', { draft });
      return { status: 'done', draft };
    } catch (err) {
      if (isAbort(err) || this.status === 'stopped') {
        this.status = 'stopped';
        this._emitTerminal('agentgen-error', { message: 'stopped' });
        return { status: 'stopped' };
      }
      this.status = 'error';
      const message = (err && err.message) || String(err);
      this._emitTerminal('agentgen-error', { message });
      return { status: 'error', message };
    } finally {
      await rm(this.scratchDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  _neighborBlock() {
    const j = (list) => JSON.stringify(list.map((m) => ({
      key: m.key,
      displayName: m.displayName,
      inputs: (m.inputs || []).map((p) => ({ id: p.id, type: p.type })),
      outputs: (m.outputs || []).map((p) => ({ id: p.id, type: p.type, when: p.when || 'always' })),
    })), null, 2);
    return (
      `## Pipeline neighbors\n\n` +
      `Agents expected to run BEFORE this one (their OUTPUT ports are what this agent's inputs get wired to):\n${j(this.expectedBefore)}\n\n` +
      `Agents expected to run AFTER this one (their INPUT ports are what this agent's outputs feed):\n${j(this.expectedAfter)}\n\n` +
      'Wires are drawn in the composer and only require matching port TYPES, so port ids are yours ' +
      'to choose: declare the ports this agent actually needs, and reuse a neighbor\'s id only when ' +
      'it genuinely names the same payload.\n\n'
    );
  }

  _metaSchemaBlock() {
    return (
      `Write the metadata JSON to: ${this.metaPath}\n` +
      'One JSON object, sidecar meta v2 (typed ports — there is no channel vocabulary). ' +
      'REQUIRED: { "metaVersion": 2, "key": "<lowerCamel>", "displayName", "description", ' +
      '"runnerType": "producer"|"verifier"|"clarifier", "inputs": [..], "outputs": [..] } — ' +
      'at least one output port, at most 8 ports per side.\n' +
      'An INPUT port: { "id", "type": "md"|"json"|"void", "label", "required" (default true; a ' +
      'required input is a barrier the agent waits on), "loop" (true = loop receiver, which forces ' +
      'required:false), "expands" (json only — run once per element of the array it carries), ' +
      '"as": "file"|"answers"|"fix-review"|"worktree" (how the payload is rendered into the prompt; ' +
      'default "file", and "worktree" is the only renderer a void input takes), "directive" (extra ' +
      'prompt text injected when this port fires) }.\n' +
      'An OUTPUT port: { "id", "type": "md"|"json"|"void", "when": "always"|"blocking"|"clean" ' +
      '(default "always"; anything else requires "verdict"), "filename" (plain basename, required on ' +
      'md/json ports, may interpolate {cycle} {vsuffix} {base}), "store": "run"|"project" (default ' +
      '"run"), "artifactKind" (defaults to the port id) }. A void port carries no payload — it is a ' +
      'pure signal, so it takes neither filename nor store.\n' +
      'Port ids are lowerCamel, max 32 chars, unique per side. The id "await" is RESERVED: the engine ' +
      'synthesizes an await gate port on every node, so never declare it on either side.\n' +
      'Runner obligations: "verifier" MUST declare "verdict": { "filename": "<basename>" } (the JSON ' +
      'verdict it writes; conditional "blocking"/"clean" outputs branch on it). "clarifier" MUST ' +
      'declare at least one json output port (the answers it writes back). "producer" just writes its ' +
      'outputs.\n' +
      'Optional agent-level fields: "color": "green|peach|red|blue|violet|amber", "icon" (an inline ' +
      'SVG path), "sideEffect": "code" (the agent edits the working tree), "scope": "project" (default) ' +
      'or "workspace-only", "domain" (palette group, e.g. "coding"), "order" (UI sort only), ' +
      '"fanOut" (may spawn parallel sub-agents), "asksQuestions"/"questionsLocked"/"questionsDefault" ' +
      '(see below), "requiresSkills": ["skill-name", ..], "promptHints" (extra system-prompt text), ' +
      '"wantsRequest" (inject the user request + its attachments), "workspaceFanOut" (run once per ' +
      'workspace member), "workspaceStrategy": "explore"|"task"|"review", "workspaceVariantOf": ' +
      '"<agentKey>" (this agent substitutes for that one in a workspace; requires scope ' +
      '"workspace-only"), "placeable": false (never placeable as a graph node), "mockRole" (omit ' +
      'unless the agent mimics a built-in writer; an unknown value is dropped).\n' +
      '"description" is the palette blurb: 1-2 plain sentences, max 160 chars total and the ' +
      'FIRST sentence max 75 chars (the palette card clamps at 1-2 short lines). It is shown under ' +
      'the agent name in the composer palette — say what the agent does and what it reads/writes.\n' +
      'Questions flags: asksQuestions=true if the agent may need a user decision mid-task ' +
      '(the orchestrator pauses it and resumes it with the answers). questionsLocked=true ONLY if ' +
      "asking the user is the agent's whole purpose (the user then cannot toggle it in the " +
      'pipeline menu). questionsDefault=true only for locked-on agents; every other agent ' +
      'starts OFF and the user opts in per pipeline.\n\n'
    );
  }

  _fullPrompt() {
    return (
      `# Task: Build a worca-cc agent — ${this.name}\n\n` +
      `## Purpose\n${this.purpose}\n\n## Detailed description\n${this.details}\n\n` +
      this._neighborBlock() +
      '## What to write\n\n' +
      `1. The agent's system-prompt markdown (role, inputs, outputs, method, output contract) to: ${this.mdPath}\n` +
      `2. ${this._metaSchemaBlock()}` +
      'Announce progress with lines starting `DRAFTING `.\n\n' +
      `MOCK_ROLE: agent-gen\nMOCK_OUT: ${this.mdPath}\nMOCK_JSON: ${this.metaPath}\nMOCK_BASE: ${this.name}\n`
    );
  }

  _metaPrompt() {
    return (
      `# Task: Infer worca-cc agent metadata — ${this.name}\n\n` +
      `The user wrote the agent system prompt themselves. Read it at: ${this.mdPath}\n` +
      'Do NOT modify that file. Derive the metadata from its content and the neighbors below.\n\n' +
      this._neighborBlock() +
      `## What to write\n\n${this._metaSchemaBlock()}` +
      'Announce progress with lines starting `DRAFTING `.\n\n' +
      `MOCK_ROLE: agent-gen\nMOCK_JSON: ${this.metaPath}\nMOCK_BASE: ${this.name}\n`
    );
  }

  _onAgentEvent(e) {
    const text = typeof e?.text === 'string' ? e.text : '';
    const m = text.match(/DRAFTING\s+(.{0,80})/i);
    if (m) this._progress(`drafting ${m[1].trim()}…`);
  }

  _setPhase(phase, message) { this.phase = phase; this._progress(message); }

  _progress(message) {
    if (this._terminal) return;
    if (message) this.message = message;
    this.emit('agentgen-progress', { genId: this.genId, phase: this.phase, message: this.message });
  }

  _emitTerminal(type, payload) {
    if (this._terminal) return;
    this._terminal = true;
    this.emit(type, { genId: this.genId, ...payload });
  }

  _checkAbort() {
    if (this.abort.signal.aborted || this.status === 'stopped') {
      const err = new Error('stopped');
      err.name = 'AbortError';
      throw err;
    }
  }
}

function isAbort(err) {
  return err && (err.name === 'AbortError' || /aborted|stopped/i.test(err.message || ''));
}
