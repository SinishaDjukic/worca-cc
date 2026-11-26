// src/core/ask/security-tools.mjs
// The chat's security and sandbox tools (docs/chat.md "Security and sandboxes"), a tool family tools.mjs adds to its
// own (deps.toolFamilies): three readers and two cards.
//   get_security_posture        the rows of Settings › General › Security (security-posture.mjs)
//   get_execution_environments  each backend: ready or why not, slots in use / cap, the wait limit, the default
//   get_project_environment     a project's sandbox settings, its environment spec, its builds and whether they are current
//   propose_environment_spec_change / propose_environment_build   cards the user applies (env-proposal.mjs)
// Pure: every reader and validator comes in through deps (security-deps.mjs binds the real ones). Nothing here returns
// a login, a hash, a token, a key or a secret's value, and nothing changes the broker, agent users, the allow-list or the
// base image: those are the operator's.

/**
 * @param {{deps: object, SCHEMA: object, str: (v:any) => string, AskToolError: typeof Error,
 *   scopeError: (target: object) => Promise<string|null>, pinnedScope: () => object|null}} h  tools.mjs's helpers
 * @returns {{defs: object[], handlers: Record<string, Function>}}
 */
export function securityToolFamily({ deps, SCHEMA, str, AskToolError, scopeError, pinnedScope }) {
  const sec = deps.security && typeof deps.security === 'object' ? deps.security : null;
  const env = deps.envProposals && typeof deps.envProposals === 'object' ? deps.envProposals : null;
  if (!sec) return { defs: [], handlers: {} };
  const securityOf = (tool) => { if (!sec) throw new AskToolError(`${tool}: the security tools are unavailable`); return sec; };
  const proposalsOf = (tool) => { if (!env) throw new AskToolError(`${tool}: environment changes are unavailable`); return env; };
  /** The project a tool acts on: the one named, else the chat's pinned project; refused outside the chat's scope. */
  async function projectKeyOf(input, tool) {
    const named = str(input.projectKey);
    const pin = (() => { try { return pinnedScope(); } catch { return null; } })();
    const key = named || (pin && pin.projectKey) || '';
    if (!key) throw new AskToolError(`${tool}: projectKey is required (list_projects gives it), or pin the project as the chat's scope`);
    const err = await scopeError({ projectKey: key });
    if (err) throw new AskToolError(`${tool}: ${err}`);
    return key;
  }
  const PROJECT = SCHEMA.s('project key (default: the chat\'s pinned project)');
  const NOTE = SCHEMA.s('one line shown on the card: why (≤ 200 chars)');
  const TOOL = { type: 'object', additionalProperties: false, required: ['name', 'version'],
    properties: { name: SCHEMA.s('a mise tool name: node, python, go, npm:prettier, pipx:black, github:cli/cli'), version: SCHEMA.s('a pinned version such as 24.21.0, never "latest"') } };

  const defs = [
    { name: 'get_security_posture',
      description: 'Read this Worca\'s security setup: the rows of Settings › General › Security — where Worca runs (Native install, Container, Hardened box, Hosted), the credential broker, agent users, the outbound network (open, allow-list), where the proxy login lives (this machine, the egress sidecar, managed by the operator, none) and the default execution environment (sandboxed or not) — each with its value and one sentence, plus the box image\'s state in a box. Read-only. Never a login, hash, token or key. changeFromChat says what the chat cannot change.',
      inputSchema: SCHEMA.obj({}) },
    { name: 'get_execution_environments',
      description: 'Read where runs can execute: Local and each sandbox backend (Local sandbox (Docker), E2B sandbox) with ready true or why not (Docker not running, E2B not configured, a missing key), the server it reaches, slots {inUse, cap, waiting}, maxWaitMin (how long a parked sandbox waits for an answer), whether it builds per-project environments, and the default (Settings › Runs › Execution environment). limits says which runs a sandbox takes. Read-only; the backend is asked, never changed.',
      inputSchema: SCHEMA.obj({}) },
    { name: 'get_project_environment',
      description: 'Read one project\'s sandbox environment: per backend its network mode (open | allow), its template or image field, what a run uses and from where, the build (name, builtAt, current or staleBecause) and the latest build job; plus the project\'s environment spec (pinned tools and apt packages). Read-only.',
      inputSchema: SCHEMA.obj({ projectKey: PROJECT }) },
    ...(env ? [
      { name: 'propose_environment_spec_change',
        description: 'Propose setting or clearing a project\'s environment spec (docs/environment-spec.md): the pinned tools (mise names with exact versions) and Debian apt packages its sandbox template or image is built with. Give the WHOLE new list of tools and/or apt (an omitted list stays as it is), or clear: true. Validated as the project page saves it. It never changes anything itself: the user sees a card with each list before → after and applies or declines it. A saved spec changes nothing until the template or image is built again (propose_environment_build). Returns {ok:true, card} or {ok:false, errors} to fix and retry. Never claim it was applied — the card says so.',
        inputSchema: SCHEMA.obj({ projectKey: PROJECT,
          tools: { type: 'array', maxItems: 100, items: TOOL, description: 'the whole new tool list' },
          apt: { type: 'array', maxItems: 200, items: { type: 'string' }, description: 'the whole new apt package list (Debian names)' },
          clear: SCHEMA.b('true = remove the spec'), note: NOTE }) },
      { name: 'propose_environment_build',
        description: 'Propose building a project\'s sandbox template (E2B) or image (Docker) from its environment spec, as the project page\'s Build does. backend: e2b | docker (default: the first that builds). The card shows the backend and what will build. It never starts anything itself: the build starts only when the user applies the card, runs on this Worca server in the background, and runs keep the previous build until it succeeds. Returns {ok:true, card} or {ok:false, errors}.',
        inputSchema: SCHEMA.obj({ projectKey: PROJECT, backend: SCHEMA.s('e2b | docker'), note: NOTE }) },
    ] : []),
  ];

  const handlers = {
    async get_security_posture() {
      const s = securityOf('get_security_posture');
      const proxyStatus = deps.proxy && typeof deps.proxy.status === 'function' ? deps.proxy.status : null;
      try { return await s.posture({ proxyStatus }); }
      catch (err) { throw new AskToolError(`get_security_posture: ${err && err.message ? err.message : err}`); }
    },
    async get_execution_environments() {
      const s = securityOf('get_execution_environments');
      try { return await s.execEnvs(); }
      catch (err) { throw new AskToolError(`get_execution_environments: ${err && err.message ? err.message : err}`); }
    },
    async get_project_environment(input) {
      const s = securityOf('get_project_environment');
      const key = await projectKeyOf(input, 'get_project_environment');
      try { return await s.projectEnv(key); }
      catch (err) { throw new AskToolError(`get_project_environment: ${err && err.message ? err.message : err}`); }
    },
    async propose_environment_spec_change(input) {
      const v = proposalsOf('propose_environment_spec_change');
      const key = await projectKeyOf(input, 'propose_environment_spec_change');
      return v.validateSpecChange({ ...input, projectKey: key });
    },
    async propose_environment_build(input) {
      const v = proposalsOf('propose_environment_build');
      const key = await projectKeyOf(input, 'propose_environment_build');
      return v.validateBuild({ ...input, projectKey: key });
    },
  };
  return { defs, handlers };
}
