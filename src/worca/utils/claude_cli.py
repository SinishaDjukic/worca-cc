"""Wrapper for the claude -p CLI with stream-json support.

Uses --output-format stream-json --verbose to get real-time NDJSON events
from the claude CLI. Each event is written to a log file for UI streaming.
The final 'result' event contains the structured output (same as --output-format json).

Windows: process-group reaping (``os.killpg`` via ``_HAS_PROC_GROUPS``) is
unavailable. ``terminate_current`` falls back to ``proc.terminate()``
(``TerminateProcess`` — no graceful SIGTERM handler runs) and
``_reap_returncode`` falls back to ``proc.kill()``.  Group tracking in
``run_agent`` is skipped entirely.  This is best-effort single-child
termination; orphaned grandchildren are not reaped.
"""

import json
import os
import re
import shlex
import signal
import subprocess
import sys
import tempfile
import threading
import time
from typing import Optional, Callable

from worca.utils.log_lines import write_log_line

from worca.hooks.agent_role import role_from_worca_agent
from worca.hooks.tracking import (
    _load_dispatch_section,
    is_lockdown,
    resolve_per_agent_entry,
)
from worca.utils.env import get_env, filter_model_env
from worca.utils.proc_registry import (
    _HAS_PROC_GROUPS,
    kill_all_tracked,
    record_spawn,
    remove_spawn,
)

# Linux ARG_MAX is typically 2 MiB but total argv+envp must fit.
# Use a conservative 128 KiB threshold for the prompt argument.
_ARG_INLINE_LIMIT = 128 * 1024  # bytes

# Track the currently running subprocess so it can be terminated on signal.
_current_proc = None
_proc_lock = threading.Lock()

# Serializes writes to the shared per-iteration log file. The process_stream
# loop (main thread, stdout-derived "out" lines) and the _tee_stderr daemon
# thread ("err" lines) both write the same handle, so every write_log_line call
# touching that handle MUST hold this lock to avoid interleaved/torn records.
_LOG_WRITE_LOCK = threading.Lock()

# Bounded wait when reaping the agent subprocess after a stream-side
# exception. Long enough for a signaled subprocess to finish dying, short
# enough to keep the failure path snappy.
_REAP_WAIT_TIMEOUT = 2.0

# Matches the Claude CLI's 429/529/503 throttling + backoff diagnostics on
# stderr. Two branches, both case-insensitive:
#   1. Retry/overload *vocabulary* — sufficient signal on its own.
#   2. A bare 4xx/5xx HTTP status, but ONLY when it sits next to an HTTP/error
#      context word. This is the precision guard: a stray "503"/"529" in tool
#      output (e.g. "529 assertions", "tests passed: 503") no longer inflates
#      the count, while every realistic CLI throttling line still matches.
# Anchored on vocabulary so a CLI wording tweak degrades to "we still persisted
# the raw err line" rather than silently zeroing the count (the matcher only
# drives the count/event, never what is written). Unit-tested against captured
# samples in test_claude_cli.py and intentionally trivial to extend.
_RETRY_VOCAB = (
    r"overloaded|rate.?limit|too many requests|retr(?:y|ying)|"
    r"backing off|service unavailable"
)
_RETRY_STATUS_CONTEXT = (
    r"(?:http|https|error|status|code|response|upstream|api|got|received|"
    r"request)\b[^\n]{0,24}?\b(?:429|529|503|500|502|504)\b"
)
_RETRY_RE = re.compile(rf"(?i)(?:{_RETRY_VOCAB}|{_RETRY_STATUS_CONTEXT})")

# Pulls the numeric HTTP status out of a matched throttling line so the
# api_error_status signal has a producer (the last status seen in an iteration
# wins, mirroring the "last API status N" UI tooltip). None when a retry line
# carries vocabulary but no status (e.g. "Overloaded, backing off").
_STATUS_RE = re.compile(r"\b(429|529|503|500|502|504)\b")


class AgentSubprocessError(RuntimeError):
    """Raised when the agent subprocess exits abnormally.

    Subclasses RuntimeError so existing `except RuntimeError` and `except
    Exception` callers in the runner continue to work. Exposes the raw
    subprocess returncode so callers can distinguish a real agent failure
    (positive exit code) from a signal-induced death (negative exit code,
    e.g. -SIGTERM = -15).
    """

    def __init__(self, message: str, returncode):
        super().__init__(message)
        self.returncode = returncode


def _reap_returncode(proc):
    """Best-effort reap of `proc` to obtain a definitive returncode.

    Used when an exception escapes the streaming loop before `proc.wait()`
    runs naturally — without this, `proc.returncode` may be `None` and the
    caller cannot tell whether the subprocess died from a signal or a real
    failure. Bounded by `_REAP_WAIT_TIMEOUT`; if the subprocess is wedged,
    we kill it so the caller is not blocked indefinitely.
    """
    try:
        proc.wait(timeout=_REAP_WAIT_TIMEOUT)
    except subprocess.TimeoutExpired:
        _killed = False
        if _HAS_PROC_GROUPS:
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
                _killed = True
            except (ProcessLookupError, OSError):
                pass
        if not _killed:
            try:
                proc.kill()
            except (ProcessLookupError, OSError):
                pass
        try:
            proc.wait(timeout=_REAP_WAIT_TIMEOUT)
        except subprocess.TimeoutExpired:
            pass
    except Exception:
        pass
    return proc.returncode


def terminate_current():
    """Terminate the currently running claude subprocess, if any.

    On POSIX, sends SIGTERM to the process group so child processes are also
    killed. On platforms without process groups (Windows), falls back to
    terminating the direct child only.
    """
    with _proc_lock:
        proc = _current_proc
    if proc is None:
        return
    if _HAS_PROC_GROUPS:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        except (ProcessLookupError, OSError):
            pass
    else:
        # Windows fallback: proc.terminate() calls TerminateProcess — no graceful handler runs.
        try:
            proc.terminate()
        except (ProcessLookupError, OSError):
            pass


def terminate_all(run_dir: str) -> int:
    """Kill all tracked process groups for a run, plus the current proc.

    Returns the number of tracked groups killed (excludes _current_proc).
    """
    terminate_current()
    procs_dir = os.path.join(run_dir, "procs")
    return kill_all_tracked(procs_dir)


def _resolve_tool_args(
    agent_name: str, settings: dict | None = None,
) -> tuple[list[str], str]:
    """Resolve --tools and --disallowedTools args for an agent (W-054 PR C).

    Returns ``(disallowed_tools, tools_arg)``:

      * ``disallowed_tools`` — the ``always_disallowed`` list minus the meta
        tools that worca governs through its own hooks (``Skill`` is
        delegated to ``skill_use.py``; ``Agent`` is delegated to
        ``subagent_start.py``).
      * ``tools_arg`` is one of:
          - ``"default"`` — all built-in tools allowed (wildcard or no per-agent
            entry). Passed to ``--tools default``.
          - ``""`` — full lockdown. Emitted only when the per-agent entry is
            the explicit lockdown sentinel ``["none"]``. An empty list ``[]``
            falls through to ``_defaults`` instead — clearing the chip list
            in the UI must not silently brick an agent.
          - ``"A,B,C"`` — explicit list. Always auto-includes ``Skill`` and
            ``Agent`` so worca's skill/subagent governance hooks still fire.

    Notes:
      * MCP tools (``mcp_*``) are not covered by ``--tools`` per the Claude
        CLI ("from the built-in set"). MCP governance flows through other
        channels.
      * ``Skill`` and ``Agent`` are meta-tools — if they're excluded from
        ``--tools``, the worca skill_use.py / subagent_start.py hooks never
        fire and dispatch governance is silently disabled. Auto-inclusion
        keeps the hooks in the loop.
    """
    cfg = _load_dispatch_section("tools", settings)
    # Filter both meta-tools symmetrically: if either lands in
    # --disallowedTools, the corresponding governance hook never fires
    # and dispatch is silently bypassed at the CLI layer.
    disallows = [t for t in cfg["always_disallowed"] if t not in ("Skill", "Agent")]

    # agent_name arrives as the resolved-prompt basename (e.g.
    # "implement-implementer-iter-3"); per_agent_allow is keyed by bare role
    # (e.g. "implementer"). Normalize via role_from_worca_agent so per-agent
    # entries actually match in production.
    role = role_from_worca_agent(agent_name) or agent_name
    entry = resolve_per_agent_entry(cfg, role)

    if is_lockdown(entry):
        return disallows, ""

    if "*" in entry:
        return disallows, "default"

    tools = {t for t in entry if t != "*"}
    tools.add("Skill")  # so skill_use.py hook fires
    tools.add("Agent")  # so subagent_start.py hook fires
    return disallows, ",".join(sorted(tools))


# Back-compat shim: some external callers and older tests still import the
# original name. The new function is the source of truth.
def _resolve_tool_disallows(
    agent_name: str, settings: dict | None = None,
) -> list[str]:
    """Deprecated: use _resolve_tool_args. Returns only the disallows tuple element."""
    disallows, _ = _resolve_tool_args(agent_name, settings)
    return disallows


def build_command(
    prompt: str,
    agent: str,
    output_format: str = "stream-json",
    json_schema: Optional[str] = None,
    model: Optional[str] = None,
    settings: Optional[dict] = None,
    mcp_config: Optional[str] = None,
    claude_md_overlay_path: Optional[str] = None,
    **kwargs,
) -> tuple[list[str], Optional[str]]:
    """Build the claude CLI command list without executing.

    When the prompt exceeds 128 KiB it is written to a temporary file and
    the CLI argument becomes a short instruction to read that file.  This
    avoids ``[Errno 7] Argument list too long`` (E2BIG) errors.

    Args:
        prompt: The prompt to send to the agent.
        agent: Path to the rendered agent .md file (e.g.
            ".claude/agents/core/planner.md"). Delivered to the CLI as the
            system prompt via --append-system-prompt-file (GH #343), and its
            filename stem is used to resolve per-agent tool grants.
        output_format: Output format ("text", "json", "stream-json").
        json_schema: Inline JSON schema string for structured output, or path
                     to a .json file (will be read and inlined).
        model: Model shorthand or full ID (e.g. "sonnet", "opus", "claude-sonnet-4-6").

    Returns:
        A (cmd, prompt_file) tuple. ``prompt_file`` is the path to a temp
        file containing the full prompt when offloaded, or None when the
        prompt is passed inline. The caller must delete the temp file after
        the subprocess finishes.
    """
    prompt_file = None
    if len(prompt.encode("utf-8", errors="replace")) > _ARG_INLINE_LIMIT:
        fd, prompt_file = tempfile.mkstemp(prefix="worca_prompt_", suffix=".md")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(prompt)
        cli_prompt = (
            f"Read the file at {prompt_file} and follow ALL instructions in it. "
            f"That file IS your full prompt — process it exactly as written."
        )
    else:
        cli_prompt = prompt

    _claude_bin_override = os.environ.get("WORCA_CLAUDE_BIN")
    _claude_bin = shlex.split(_claude_bin_override or "claude")
    if _claude_bin_override:
        print(f"[worca] WORCA_CLAUDE_BIN override active: {_claude_bin_override}", file=sys.stderr)
    agent_name = os.path.splitext(os.path.basename(agent))[0]
    disallowed_tools, tools_arg = _resolve_tool_args(agent_name, settings)
    cmd = [
        *_claude_bin,
        "-p",
        cli_prompt,
        # The rendered agent .md is the agent's system prompt. We deliver it via
        # --append-system-prompt-file (a path-taking flag), NOT --agent: as of
        # Claude Code 2.1.190/2.1.191 the --agent flag resolves a *registered
        # agent name* only (from .claude/agents/, plugins, builtins) and rejects
        # a filesystem path with "not found", exiting without a result event.
        # Older versions silently ignored the path and ran the DEFAULT agent, so
        # --agent <path> never actually loaded these prompts on any tested CLI.
        # See GH #343. The role is appended on top of Claude Code's base harness
        # prompt; --model/--tools/--disallowedTools/effort are passed explicitly
        # below, so no agent-frontmatter capabilities are lost by dropping --agent.
        "--append-system-prompt-file",
        agent,
        "--output-format",
        output_format,
        "--no-session-persistence",
        "--dangerously-skip-permissions",
        "--tools", tools_arg,
    ]
    if disallowed_tools:
        cmd.extend(["--disallowedTools", ",".join(disallowed_tools)])
    if model:
        cmd.extend(["--model", model])
    if output_format == "stream-json":
        cmd.append("--verbose")
    if json_schema is not None:
        # If it looks like a file path, read its contents
        schema_str = json_schema
        if json_schema.endswith(".json"):
            try:
                with open(json_schema, encoding="utf-8") as f:
                    schema_str = f.read().strip()
            except FileNotFoundError:
                pass  # Use the raw string as-is
        cmd.extend(["--json-schema", schema_str])
    if mcp_config:
        cmd.extend(["--mcp-config", mcp_config, "--strict-mcp-config"])
    if claude_md_overlay_path:
        cmd.extend(["--settings", claude_md_overlay_path])
    return cmd, prompt_file


def _format_log_line(event: dict) -> Optional[str]:
    """Convert a stream-json event into a human-readable log line.

    Returns None for events that shouldn't be logged (system hooks, etc.).
    """
    etype = event.get("type", "")
    subtype = event.get("subtype", "")

    if etype == "system":
        if subtype == "init":
            model = event.get("model", "?")
            return f"[init] model={model}"
        # Skip hook events — noisy
        return None

    if etype == "assistant":
        msg = event.get("message", {})
        content_blocks = msg.get("content", [])
        parts = []
        for block in content_blocks:
            if block.get("type") == "text":
                text = block.get("text", "").strip()
                if text:
                    parts.append(text)
            elif block.get("type") == "tool_use":
                tool = block.get("name", "?")
                inp = block.get("input", {})
                # Summarize tool input
                if tool == "Read":
                    detail = inp.get("file_path", "")
                elif tool == "Write":
                    detail = inp.get("file_path", "")
                elif tool == "Edit":
                    detail = inp.get("file_path", "")
                elif tool == "Bash":
                    detail = inp.get("command", "")[:120]
                elif tool == "Grep":
                    detail = inp.get("pattern", "")
                elif tool == "Glob":
                    detail = inp.get("pattern", "")
                elif tool == "Agent":
                    detail = inp.get("description", "")
                else:
                    detail = ""
                parts.append(f"[tool:{tool}] {detail}")
            elif block.get("type") == "tool_result":
                # Tool results in assistant messages — skip detail
                pass
        if parts:
            return " | ".join(parts)
        return None

    if etype == "user":
        # User messages contain tool results
        content = event.get("content", [])
        if isinstance(content, list):
            for block in content:
                if isinstance(block, dict) and block.get("type") == "tool_result":
                    tool_id = block.get("tool_use_id", "")[:8]
                    is_error = block.get("is_error", False)
                    status = "ERROR" if is_error else "ok"
                    return f"[result:{status}] {tool_id}"
        return None

    if etype == "result":
        cost = event.get("total_cost_usd", 0)
        turns = event.get("num_turns", 0)
        duration = event.get("duration_ms", 0)
        line = f"[done] turns={turns} cost=${cost:.3f} duration={duration / 1000:.1f}s"
        ctx_pct = event.get("_final_context_pct")
        if ctx_pct is not None:
            line += f" ctx_final={ctx_pct}%"
        return line

    return None


_USAGE_NUMERIC_KEYS = (
    "input_tokens",
    "output_tokens",
    "cache_creation_input_tokens",
    "cache_read_input_tokens",
)

_USAGE_SUB_DICTS = ("server_tool_use", "cache_creation")


def _accumulate_usage(acc: dict, usage: dict) -> None:
    """Sum numeric token fields from *usage* into *acc* in place.

    Top-level numeric fields (input_tokens, output_tokens, etc.) are summed
    directly.  Nested sub-dicts (server_tool_use, cache_creation) are merged
    key-by-key, summing every numeric value found.
    """
    for key in _USAGE_NUMERIC_KEYS:
        val = usage.get(key)
        if isinstance(val, (int, float)):
            acc[key] = acc.get(key, 0) + val

    for sub_key in _USAGE_SUB_DICTS:
        sub = usage.get(sub_key)
        if not isinstance(sub, dict):
            continue
        acc_sub = acc.setdefault(sub_key, {})
        for k, v in sub.items():
            if isinstance(v, (int, float)):
                acc_sub[k] = acc_sub.get(k, 0) + v


def process_stream(
    stdout,
    log_file=None,
    on_event: Optional[Callable[[dict], None]] = None,
    retry_state: Optional[dict] = None,
) -> dict:
    """Read NDJSON events from stdout and return the result event.

    Args:
        stdout: File-like object yielding lines of NDJSON.
        log_file: Open file to write human-readable log lines to.
        on_event: Optional callback invoked for each parsed event.
        retry_state: Optional shared dict (mutated by ``_tee_stderr``) carrying
            the API-throttling/backoff signal. When the stderr tee stamps
            ``pending_since`` on the first retry line of a burst, the first
            stdout event seen here closes that backoff window —
            ``wait_ms += now − pending_since`` — measuring the wall span the CLI
            spent silently backing off. Guarded by ``_LOG_WRITE_LOCK`` because
            the tee daemon mutates the same dict concurrently.

    Returns the parsed result event dict, or raises RuntimeError if not found.
    The result event will have ``_resolved_model`` set from the system.init
    event if the result event does not already contain a ``model`` field.
    """
    result_event = None
    resolved_model = None
    sticky_structured_output = None
    _accum_duration_ms = 0
    _accum_duration_api_ms = 0
    _accum_num_turns = 0
    _accum_usage: dict = {}
    _result_count = 0
    _last_assistant_usage = None

    for raw_line in stdout:
        line = raw_line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            # Not valid JSON — write raw to log
            if log_file:
                raw = raw_line if isinstance(raw_line, str) else raw_line.decode()
                with _LOG_WRITE_LOCK:
                    write_log_line(log_file, raw.rstrip("\n"), stream="out")
            continue

        # A real stdout event arrived — if the stderr tee opened a backoff
        # window (stamped pending_since on a retry line), close it now and fold
        # the wall span into wait_ms. Under _LOG_WRITE_LOCK so it can't race the
        # tee daemon's concurrent mutation of the same dict.
        if retry_state is not None:
            with _LOG_WRITE_LOCK:
                pending_since = retry_state.get("pending_since")
                if pending_since is not None:
                    retry_state["wait_ms"] += int(
                        (time.monotonic() - pending_since) * 1000
                    )
                    retry_state["pending_since"] = None

        if on_event:
            on_event(event)

        # Capture model from system.init event
        if event.get("type") == "system" and event.get("subtype") == "init":
            resolved_model = event.get("model")

        # Track last assistant turn's token usage for context-window percentage
        if event.get("type") == "assistant":
            msg_usage = event.get("message", {}).get("usage")
            if isinstance(msg_usage, dict):
                _last_assistant_usage = msg_usage

        # Enrich result event with _final_context_pct before formatting
        if event.get("type") == "result" and _last_assistant_usage is not None:
            model_usage = event.get("modelUsage", {})
            ctx_win = None
            if resolved_model and isinstance(model_usage.get(resolved_model), dict):
                ctx_win = model_usage[resolved_model].get("contextWindow")
            elif model_usage:
                first = next(iter(model_usage.values()))
                if isinstance(first, dict):
                    ctx_win = first.get("contextWindow")
            if ctx_win:
                _final_used = (
                    (_last_assistant_usage.get("input_tokens") or 0)
                    + (_last_assistant_usage.get("cache_read_input_tokens") or 0)
                    + (_last_assistant_usage.get("cache_creation_input_tokens") or 0)
                )
                event["_final_context_pct"] = round(_final_used / ctx_win * 100, 1)

        # Write human-readable summary to log
        if log_file:
            log_line = _format_log_line(event)
            if log_line:
                with _LOG_WRITE_LOCK:
                    write_log_line(log_file, log_line, stream="out")

        if event.get("type") == "result":
            # Task-notification auto-resumes (e.g. long pytest run dispatched
            # as `run_in_background` Bash) emit extra `result` events with no
            # structured_output. Keep the last one we saw so the silent
            # resume can't clobber the real agent output (issue #163).
            so = event.get("structured_output")
            if so:
                sticky_structured_output = so
            _result_count += 1
            _accum_duration_ms += event.get("duration_ms") or 0
            _accum_duration_api_ms += event.get("duration_api_ms") or 0
            _accum_num_turns += event.get("num_turns") or 0
            usage = event.get("usage")
            if isinstance(usage, dict):
                _accumulate_usage(_accum_usage, usage)
            result_event = event

    if result_event is None:
        raise RuntimeError("No result event found in stream-json output")

    if _result_count > 1:
        result_event["duration_ms"] = _accum_duration_ms
        result_event["duration_api_ms"] = _accum_duration_api_ms
        result_event["num_turns"] = _accum_num_turns
        if _accum_usage:
            # Merge summed totals over the last event's full usage block so
            # non-numeric / unrecognized keys (e.g. service_tier) survive
            # instead of being dropped when accumulation rebuilds usage. Nested
            # sub-dicts are likewise overlaid, preserving any non-numeric keys.
            merged = dict(result_event.get("usage") or {})
            for key, val in _accum_usage.items():
                if isinstance(val, dict):
                    sub = dict(merged.get(key) or {})
                    sub.update(val)
                    merged[key] = sub
                else:
                    merged[key] = val
            result_event["usage"] = merged

    if sticky_structured_output and not result_event.get("structured_output"):
        result_event["structured_output"] = sticky_structured_output

    # Attach resolved model to result event if not already present
    if resolved_model and "model" not in result_event:
        result_event["_resolved_model"] = resolved_model

    return result_event


def run_agent(
    prompt: str,
    agent: str,
    max_turns: int = 0,
    output_format: str = "stream-json",
    json_schema: Optional[str] = None,
    model: Optional[str] = None,
    model_env: Optional[dict] = None,
    log_path: Optional[str] = None,
    on_event: Optional[Callable[[dict], None]] = None,
    settings: Optional[dict] = None,
    graphify_out: Optional[str] = None,
    model_alias: Optional[str] = None,
    mcp_config: Optional[str] = None,
    claude_md_overlay_path: Optional[str] = None,
    run_dir: Optional[str] = None,
    stage: Optional[str] = None,
    iteration: Optional[int] = None,
    bead_id: Optional[str] = None,
    on_retry: Optional[Callable[[str, int], None]] = None,
) -> dict:
    """Run a claude agent via the CLI and return parsed JSON output.

    Uses stream-json format to get real-time events. The final result event
    is returned (same structure as --output-format json).

    Note: max_turns is accepted for API compatibility but not passed to the CLI
    (claude -p does not support --max-turns). Use --max-budget-usd for cost control.

    Args:
        model: Model shorthand or full ID to pass via --model flag.
        log_path: If provided, write human-readable event summaries to this file.
        on_event: Optional callback invoked for each stream-json event.
        graphify_out: When set, exported as ``GRAPHIFY_OUT`` in the agent
            subprocess so a bare ``graphify query`` reads the per-commit cache
            snapshot (graphify >=0.8.16 honors it for reads). The runner passes
            the resolved ``<snapshot>/graphify`` dir when the preflight graph is
            ready; None leaves the env untouched.
        stage: When set, exported as ``WORCA_STAGE`` in the agent subprocess.
        iteration: When set, exported as ``WORCA_ITERATION`` in the agent subprocess.
        bead_id: When set, exported as ``WORCA_BEAD_ID`` in the agent subprocess.
        on_retry: Optional callback ``(detail_text, count)`` invoked from the
            stderr tee thread each time a line matches ``_RETRY_RE`` (429/529/503
            throttling / backoff). The runner uses it to emit a
            ``pipeline.agent.api_retry`` event. Must be cheap and exception-safe;
            it runs on the daemon tee thread (exceptions are swallowed).

    Returns the parsed result event with ``api_retries`` (matched retry-line
    count), ``api_retry_wait_ms`` (Σ measured backoff-window wall spans), and
    ``api_error_status`` (last HTTP status parsed from a retry line, or None) set.

    Raises RuntimeError on subprocess failure or missing result.
    """
    cmd, prompt_file = build_command(
        prompt,
        agent=agent,
        output_format=output_format,
        json_schema=json_schema,
        model=model,
        settings=settings,
        mcp_config=mcp_config,
        claude_md_overlay_path=claude_md_overlay_path,
    )

    global _current_proc

    # Extract agent name from path so hooks can enforce role-based restrictions
    agent_name = os.path.splitext(os.path.basename(agent))[0]

    safe_env, dropped = filter_model_env(model_env or {})
    if dropped:
        print(
            f"[worca] model env keys dropped (reserved): {sorted(dropped)}",
            file=sys.stderr,
        )

    agent_env = get_env(WORCA_AGENT=agent_name, **safe_env)
    if stage is not None:
        agent_env["WORCA_STAGE"] = stage
    else:
        # Explicitly remove to avoid inheriting from os.environ.copy()
        agent_env.pop("WORCA_STAGE", None)
    if iteration is not None:
        agent_env["WORCA_ITERATION"] = str(iteration)
    else:
        # Explicitly remove to avoid inheriting from os.environ.copy()
        agent_env.pop("WORCA_ITERATION", None)
    if bead_id is not None:
        agent_env["WORCA_BEAD_ID"] = bead_id
    if graphify_out:
        # Set outside filter_model_env so it's never stripped (GRAPHIFY_OUT is
        # not a reserved key). graphify honors it for reads, so the agent's
        # bare `graphify query` hits the per-commit cache, not ./graphify-out/.
        agent_env["GRAPHIFY_OUT"] = graphify_out

    proc = subprocess.Popen(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        # Windows: start_new_session silently ignored — detach not guaranteed (use WSL2).
        text=True, env=agent_env, start_new_session=True,
    )

    with _proc_lock:
        _current_proc = proc

    procs_dir = None
    pgid = None
    agent_pid_path = None
    # Process-group tracking is POSIX-only; on Windows (_HAS_PROC_GROUPS False)
    # os.getpgid doesn't exist, so fall through to the agent.pid path instead of
    # raising AttributeError on the spawn hot path.
    if run_dir and stage is not None and iteration is not None and _HAS_PROC_GROUPS:
        procs_dir = os.path.join(run_dir, "procs")
        try:
            pgid = os.getpgid(proc.pid)
            record_spawn(procs_dir, pgid=pgid, pid=proc.pid, stage=stage, iteration=iteration)
        except (ProcessLookupError, OSError, AttributeError):
            procs_dir = None
            pgid = None
    elif log_path:
        _run_dir = os.path.dirname(log_path)
        agent_pid_path = os.path.join(_run_dir, "agent.pid")
        try:
            os.makedirs(_run_dir, exist_ok=True)
            with open(agent_pid_path, "w", encoding="utf-8") as f:
                f.write(str(proc.pid))
        except OSError:
            agent_pid_path = None

    log_file = None
    result_event = None
    # Shared throttling/backoff signal mutated by the stderr tee daemon and read
    # by process_stream (which closes each backoff window) — all access guarded
    # by _LOG_WRITE_LOCK. count: matched retry lines; wait_ms: Σ backoff-window
    # wall spans; pending_since: monotonic start of the currently-open window;
    # error_status: last HTTP status parsed from a retry line (None if none).
    retry_state = {
        "count": 0, "wait_ms": 0, "pending_since": None, "error_status": None,
    }
    try:
        if log_path:
            os.makedirs(os.path.dirname(log_path), exist_ok=True)
            log_file = open(log_path, "w", encoding="utf-8")

        # Tee stderr to console AND persist it tagged "err" in the shared log.
        # The CLI prints its 429/529 backoff diagnostics here; persisting them
        # makes throttling visible in the UI instead of console-only. Each raw
        # line carries no timestamp of its own, so stamp it with worca's
        # receive-time (stamp=True). Writes share log_file with the main
        # process_stream loop, so they go under _LOG_WRITE_LOCK. Each line is
        # also run through _RETRY_RE: a match bumps the count, opens a backoff
        # window (pending_since) if none is open, and fires on_retry.
        def _tee_stderr():
            for line in proc.stderr:
                sys.stderr.write(line)
                sys.stderr.flush()
                text = line.rstrip("\n")
                fire_count = None
                with _LOG_WRITE_LOCK:
                    if log_file:
                        try:
                            write_log_line(
                                log_file, text, stream="err", stamp=True,
                            )
                        except ValueError:
                            # log_file closed after join(timeout) while this
                            # daemon thread was still draining — drop the line
                            # rather than crash the thread.
                            pass
                    if _RETRY_RE.search(text):
                        retry_state["count"] += 1
                        if retry_state["pending_since"] is None:
                            retry_state["pending_since"] = time.monotonic()
                        status_match = _STATUS_RE.search(text)
                        if status_match:
                            retry_state["error_status"] = int(status_match.group(1))
                        fire_count = retry_state["count"]
                # Fire the callback outside the lock so a slow handler can't
                # stall the stdout reader closing the next backoff window.
                if fire_count is not None and on_retry is not None:
                    try:
                        on_retry(text, fire_count)
                    except Exception:
                        # Telemetry must never crash the tee daemon.
                        pass

        stderr_thread = threading.Thread(target=_tee_stderr, daemon=True)
        stderr_thread.start()

        try:
            # Process stdout stream events. May raise RuntimeError when the
            # subprocess dies before emitting a result event (signal kill,
            # crash, or a real agent failure that aborts mid-stream).
            result_event = process_stream(
                proc.stdout,
                log_file=log_file,
                on_event=on_event,
                retry_state=retry_state,
            )
            stderr_thread.join(timeout=5)
            proc.wait()
            # join() has a timeout, so the tee daemon *may* still be draining a
            # trailing stderr burst — read retry_state under the lock rather than
            # assuming it is quiescent. A backoff window can also still be open
            # here: retry lines that arrive on stderr after the final stdout
            # event was processed are never closed by process_stream, so close
            # that trailing window now (span = stream end − pending_since) before
            # stamping the aggregate throttling signal onto the result event
            # (additive; all default 0/None on a clean run).
            if result_event is not None:
                with _LOG_WRITE_LOCK:
                    pending_since = retry_state["pending_since"]
                    if pending_since is not None:
                        retry_state["wait_ms"] += int(
                            (time.monotonic() - pending_since) * 1000
                        )
                        retry_state["pending_since"] = None
                    result_event["api_retries"] = retry_state["count"]
                    result_event["api_retry_wait_ms"] = retry_state["wait_ms"]
                    result_event["api_error_status"] = retry_state["error_status"]
        except Exception as stream_exc:
            # The streaming layer cannot tell why the subprocess stopped
            # producing output. Reap it (with a bounded wait) so the
            # returncode is definitive, then route on the actual exit
            # signal: negative -> signal kill (interruption), otherwise
            # surface as AgentSubprocessError carrying the returncode.
            stderr_thread.join(timeout=5)
            rc = _reap_returncode(proc)
            if rc is not None and rc < 0:
                raise InterruptedError(
                    f"claude agent killed by signal {-rc}"
                ) from stream_exc
            raise AgentSubprocessError(
                f"claude agent stream failed: {stream_exc}",
                returncode=rc,
            ) from stream_exc

        if log_file:
            log_file.close()
            log_file = None

    finally:
        with _proc_lock:
            _current_proc = None
        if procs_dir and pgid is not None:
            remove_spawn(procs_dir, pgid=pgid)
        if agent_pid_path:
            try:
                os.unlink(agent_pid_path)
            except OSError:
                pass
        if log_file:
            log_file.close()
        # Clean up the temporary prompt file if one was created
        if prompt_file:
            try:
                os.unlink(prompt_file)
            except OSError:
                pass

    if proc.returncode < 0:
        raise InterruptedError(f"claude agent killed by signal {-proc.returncode}")
    if proc.returncode != 0:
        error_msg = result_event.get("result", "") if result_event else ""
        raise AgentSubprocessError(
            f"claude agent failed (exit code {proc.returncode})"
            + (f": {error_msg[:500]}" if error_msg else ""),
            returncode=proc.returncode,
        )

    if model_alias and result_event:
        result_event["_model_alias"] = model_alias

    return result_event
