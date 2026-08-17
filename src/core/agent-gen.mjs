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
// the neighbors' produces/consumes. Files are read back as authoritative
// (phases.mjs runWorkspaceScan pattern) then normalized via normalizeMeta.

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { worcaHome } from './projects.mjs';
import { runClaude } from './claude-runner.mjs';
import { resolveModelEnv } from './config.mjs';
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
    this.channels = Array.isArray(opts.channels) ? opts.channels : [];
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
        modelEnv: resolveModelEnv(this.claude.model), // catalog routing env (design §4.8)
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
      key: m.key, displayName: m.displayName, produces: m.produces || [],
      consumes: m.consumes || [], optionalConsumes: m.optionalConsumes || [],
    })), null, 2);
    return (
      `## Pipeline neighbors\n\n` +
      `Agents expected to run BEFORE this one (their produces are this agent's likely consumes):\n${j(this.expectedBefore)}\n\n` +
      `Agents expected to run AFTER this one (their consumes are this agent's likely produces):\n${j(this.expectedAfter)}\n\n` +
      `## Channel vocabulary\n\nconsumes/optionalConsumes/produces MUST use ONLY these ids: ` +
      `${this.channels.join(', ') || '(see neighbors)'}\n\n`
    );
  }

  _metaSchemaBlock() {
    return (
      `Write the metadata JSON to: ${this.metaPath}\n` +
      'EXACT shape (one JSON object): { "key": "<lowerCamel>", "displayName", "description", ' +
      '"color": "green|peach|red|blue|violet|amber", "runnerType": "producer|verifier", ' +
      '"loopSource": bool, "fanOut": bool, "asksQuestions": bool, "questionsLocked": bool, ' +
      '"questionsDefault": bool, "consumes": [..], "optionalConsumes": [..], ' +
      '"produces": [..], "connectsTo": "*"|["key",..], "order": number }\n' +
      '"description" is the palette blurb: 1-2 plain sentences, max 160 chars total and the ' +
      'FIRST sentence max 75 chars (the palette card clamps at 1-2 short lines). It is shown under ' +
      'the agent name in the composer palette — say what the agent does and what it reads/produces.\n' +
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
  // NAME only, matching orchestrator.isAbort (kept local: importing it would
  // create an import cycle). _checkAbort stamps name='AbortError'; a message
  // sniff also matched real failures mentioning "aborted"/"stopped" and would
  // end agent generation silently.
  return !!err && err.name === 'AbortError';
}
