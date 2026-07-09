"""Pytest fixtures for integration tests: pipeline_env and webhook_server."""
import json
import os
import signal
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest

from worca.utils.proc_registry import _HAS_PROC_GROUPS, kill_all_tracked

from tests.integration.helpers import (
    ParallelResult,
    PipelineEnv,
    PipelineResult,
    WebhookCapture,
    WorktreeResult,
    _find_latest_status,
    _read_events_jsonl,
)

MOCK_CLAUDE_BIN = Path(__file__).parent.parent / "mock_claude" / "mock_claude.py"
STUBS_DIR = Path(__file__).parent / "stubs"

# Repo root — used to locate .coveragerc and the project source dir for
# coverage-tracked subprocess runs.
REPO_ROOT = Path(__file__).resolve().parent.parent.parent


def _coverage_enabled() -> bool:
    return os.environ.get("WORCA_COVERAGE") == "1"


def _wrap_with_coverage(cmd: list) -> list:
    """If WORCA_COVERAGE=1, wrap a `python -m <module>` command with coverage.

    Turns `[python, -m, worca.scripts.run_pipeline, ...]` into
    `[python, -m, coverage, run, --rcfile=.coveragerc, --parallel-mode,
      -m, worca.scripts.run_pipeline, ...]`. Coverage data files land in
    REPO_ROOT/.coverage.<host>.<pid>.<rand> and are merged with `coverage combine`.
    """
    if not _coverage_enabled() or len(cmd) < 3 or cmd[1] != "-m":
        return cmd
    rcfile = REPO_ROOT / ".coveragerc"
    return [
        cmd[0], "-m", "coverage", "run",
        f"--rcfile={rcfile}", "--parallel-mode",
    ] + cmd[1:]


def _stop_beads_daemons(project: Path, worktree_paths: list[str]) -> None:
    """Best-effort stop of beads daemons for the main project and worktrees."""
    from worca.utils.beads import bd_daemon_stop

    targets = []
    main_beads = project / ".beads"
    if main_beads.is_dir():
        targets.append(str(main_beads))
    for wt in worktree_paths:
        wt_beads = Path(wt) / ".beads"
        if wt_beads.is_dir():
            targets.append(str(wt_beads))
    for beads_dir in targets:
        try:
            bd_daemon_stop(beads_dir)
        except Exception:
            pass


_SIGTERM_GRACE = 3.0


def _kill_pgroup(pid: int) -> None:
    """SIGTERM then SIGKILL a process group. No-op on non-POSIX or if already dead."""
    if not _HAS_PROC_GROUPS:
        return
    try:
        pgid = os.getpgid(pid)
    except (ProcessLookupError, OSError):
        return
    try:
        os.killpg(pgid, signal.SIGTERM)
    except (ProcessLookupError, OSError):
        return
    deadline = time.monotonic() + _SIGTERM_GRACE
    while time.monotonic() < deadline:
        try:
            os.killpg(pgid, 0)
        except (ProcessLookupError, OSError):
            return
        time.sleep(0.1)
    try:
        os.killpg(pgid, signal.SIGKILL)
    except (ProcessLookupError, OSError):
        pass


def _read_pipeline_pid(run_dir: Path) -> int | None:
    """Read the pipeline PID from <run_dir>/pipeline.pid, or None."""
    pid_path = run_dir / "pipeline.pid"
    try:
        return int(pid_path.read_text().strip())
    except (OSError, ValueError):
        return None


def _reap_all_processes(
    background_procs: list[subprocess.Popen],
    created_worktrees: list[str],
    worca_dir: Path,
) -> None:
    """Kill all spawned process groups before worktree removal.

    Order: background Popens → worktree pipeline groups → procs/ registries
    → main project run registries. This ensures the procs/ directories are
    still intact when kill_all_tracked reads them.
    """
    # 1. Kill background Popen process groups (run_background launches)
    for proc in background_procs:
        _kill_pgroup(proc.pid)

    # 2. For each worktree, discover the pipeline PID and kill its group,
    #    then kill_all_tracked on the run's procs/ directory.
    for wt_path in created_worktrees:
        wt = Path(wt_path)
        runs_dir = wt / ".worca" / "runs"
        if not runs_dir.is_dir():
            continue
        for run_dir in runs_dir.iterdir():
            if not run_dir.is_dir():
                continue
            pid = _read_pipeline_pid(run_dir)
            if pid is not None:
                _kill_pgroup(pid)
            procs_dir = run_dir / "procs"
            if procs_dir.is_dir():
                kill_all_tracked(str(procs_dir))

    # 3. Scan main project worca_dir runs
    runs_dir = worca_dir / "runs"
    if runs_dir.is_dir():
        for run_dir in runs_dir.iterdir():
            if not run_dir.is_dir():
                continue
            pid = _read_pipeline_pid(run_dir)
            if pid is not None:
                _kill_pgroup(pid)
            procs_dir = run_dir / "procs"
            if procs_dir.is_dir():
                kill_all_tracked(str(procs_dir))


# ---------------------------------------------------------------------------
# pipeline_env fixture
# ---------------------------------------------------------------------------

@pytest.fixture
def pipeline_env(tmp_path):
    """Create a minimal project directory with full worca runtime and mock claude."""
    project = tmp_path / "project"
    project.mkdir()

    # 1. Initialize a git repo with an initial commit (preflight requires it)
    subprocess.run(["git", "init"], cwd=str(project), check=True, capture_output=True)
    subprocess.run(["git", "config", "user.email", "test@test.com"],
                   cwd=str(project), check=True, capture_output=True)
    subprocess.run(["git", "config", "user.name", "Test"],
                   cwd=str(project), check=True, capture_output=True)
    (project / "README.md").write_text("test")
    subprocess.run(["git", "add", "."], cwd=str(project), check=True, capture_output=True)
    subprocess.run(["git", "commit", "-m", "init"], cwd=str(project),
                   check=True, capture_output=True)

    # 2. Run worca init to copy full runtime (agents, schemas, hooks, scripts).
    #    PYTHONPATH ensures init copies from the worktree source tree (not a
    #    stale site-packages install) — mirrors pyproject.toml pythonpath=["src"].
    #    WORCA_HOME is isolated per-test so pkg store and project config do not
    #    collide across tests in the same session (each test gets its own
    #    ~/.worca/ equivalent under tmp_path/worca_home/).
    _worca_home = tmp_path / "worca_home"
    _init_env = {
        **os.environ,
        "PYTHONPATH": str(REPO_ROOT / "src"),
        "WORCA_HOME": str(_worca_home),
    }
    subprocess.run(
        [sys.executable, "-m", "worca.cli.main", "init"],
        cwd=str(project), check=True, capture_output=True, env=_init_env,
    )

    # 3. Override settings for fast test execution.
    #    Worca config (worca.*) now lives in ~/.worca/projects/<slug>/config.json
    #    (W-077). Write overrides there so pipeline runs pick them up via
    #    WORCA_CONFIG_PATH, which runner.py resolves from the project slug.
    from worca.utils.paths import project_config_dir as _project_config_dir  # noqa: PLC0415
    from worca.utils.project_registry import slugify as _slugify  # noqa: PLC0415

    _slug = _slugify(project.name)
    _config_path = Path(_project_config_dir(_slug))
    # _project_config_dir uses WORCA_HOME — set it temporarily for the resolution
    import os as _os  # noqa: PLC0415
    _prev_worca_home = _os.environ.get("WORCA_HOME")
    _os.environ["WORCA_HOME"] = str(_worca_home)
    _config_path = Path(_project_config_dir(_slug)) / "config.json"
    if _prev_worca_home is not None:
        _os.environ["WORCA_HOME"] = _prev_worca_home
    else:
        _os.environ.pop("WORCA_HOME", None)

    worca_config: dict = {}
    if _config_path.exists():
        worca_config = json.loads(_config_path.read_text())
    worca_config.setdefault("worca", {})
    worca_config["worca"]["stages"] = {
        "preflight": {"enabled": False},
        "plan_review": {"enabled": False},
        "learn": {"enabled": False},
    }
    worca_config["worca"]["agents"] = {
        "planner": {"max_turns": 5},
        "coordinator": {"max_turns": 5},
        "implementer": {"max_turns": 5},
        "tester": {"max_turns": 5},
        "reviewer": {"max_turns": 5},
        "guardian": {"max_turns": 5},
    }
    worca_config["worca"]["effort"] = {"auto_mode": "disabled"}
    _config_path.write_text(json.dumps(worca_config, indent=2))

    worca_dir = project / ".worca"
    _scenario_counter = [0]

    # Mutable per-test overrides that next run() / run_background() will pick
    # up. Setters below mutate this dict — see set_governance_agent / enable_beads.
    # Keys absent from _overrides keep the documented defaults (WORCA_AGENT="",
    # WORCA_SKIP_BEADS="1") so existing tests are unaffected.
    _overrides: dict = {}

    # Stub log path is fixed per-fixture; tests read it via read_stub_log.
    _stub_log_path = tmp_path / "stub_invocations.jsonl"
    _stub_response_files: dict = {}

    def _base_env_common() -> dict:
        """Scenario-independent env shared by pipeline runs and hook subprocesses.

        Sets the mock-claude binary, governance defaults, beads skip, and (under
        WORCA_COVERAGE=1) COVERAGE_FILE so coverage fragments land in REPO_ROOT
        instead of the per-test tmpdir. Per-test ``_overrides`` are applied last
        so they always win.
        """
        env = {
            **os.environ,
            "WORCA_CLAUDE_BIN": f"{sys.executable} {MOCK_CLAUDE_BIN}",
            "WORCA_AGENT": "",  # not in agent mode — hooks should not enforce agent guards
            "WORCA_SKIP_BEADS": "1",  # bd binary may not work in CI
            "PYTHONPATH": str(REPO_ROOT / "src"),
            # W-077: propagate per-test WORCA_HOME so runner.py's _pin_worca_config_path
            # resolves to the isolated ~/.worca/projects/<slug>/config.json for this test.
            "WORCA_HOME": str(_worca_home),
        }
        # Strip pipeline-specific WORCA_* vars that leak from the parent shell.
        # WORCA_PLAN_FILE and WORCA_PROJECT_ROOT in particular cause plan_check
        # to resolve against the parent pipeline's plan file (which exists),
        # making governance block tests pass when they should block.
        env.pop("WORCA_PLAN_FILE", None)
        env.pop("WORCA_PROJECT_ROOT", None)
        env.pop("WORCA_RUN_ID", None)
        env.pop("WORCA_RUN_DIR", None)
        env.pop("GRAPHIFY_OUT", None)
        # Do not inherit parent's WORCA_CONFIG_PATH — runner.py re-derives it from
        # the project slug + WORCA_HOME for each child pipeline.
        env.pop("WORCA_CONFIG_PATH", None)
        if _coverage_enabled():
            # Coverage subprocesses write .coverage.<host>.<pid>.<rand> next to
            # CWD by default. Force them into REPO_ROOT so `coverage combine`
            # finds every fragment regardless of which tmpdir the test ran in.
            env["COVERAGE_FILE"] = str(REPO_ROOT / ".coverage")

        env.update(_overrides)
        return env

    def _base_env(scenario_path: Path) -> dict:
        env = _base_env_common()
        env["MOCK_CLAUDE_SCENARIO"] = str(scenario_path)
        return env

    def run(scenario: dict, prompt: str = "test task",
            timeout: int = 60, extra_args=None) -> PipelineResult:
        _scenario_counter[0] += 1
        scenario_path = tmp_path / f"scenario_{_scenario_counter[0]}.json"
        scenario_path.write_text(json.dumps(scenario))

        cmd = [sys.executable, "-m", "worca.scripts.run_pipeline",
               "--prompt", prompt]
        if extra_args:
            cmd.extend(extra_args)
        cmd = _wrap_with_coverage(cmd)

        result = subprocess.run(
            cmd, cwd=str(project), env=_base_env(scenario_path),
            capture_output=True, text=True, timeout=timeout,
        )

        status = _find_latest_status(worca_dir)
        events = _read_events_jsonl(worca_dir)
        return PipelineResult(
            returncode=result.returncode,
            status=status,
            events=events,
            stdout=result.stdout,
            stderr=result.stderr,
        )

    def run_background(scenario: dict, prompt: str = "test task",
                       extra_args=None) -> subprocess.Popen:
        """Start the pipeline as a background Popen — caller controls lifecycle."""
        _scenario_counter[0] += 1
        scenario_path = tmp_path / f"scenario_{_scenario_counter[0]}.json"
        scenario_path.write_text(json.dumps(scenario))

        cmd = [sys.executable, "-m", "worca.scripts.run_pipeline",
               "--prompt", prompt]
        if extra_args:
            cmd.extend(extra_args)
        cmd = _wrap_with_coverage(cmd)

        proc = subprocess.Popen(
            cmd, cwd=str(project), env=_base_env(scenario_path),
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            start_new_session=True,  # own process group so signals target full tree
        )
        _background_procs.append(proc)
        return proc

    _background_procs: list[subprocess.Popen] = []

    # W-050 Phase 3: track worktrees created via run_worktree / run_parallel
    # so the fixture finalizer can `git worktree remove --force` them on
    # teardown — even on test failure (plan rule #15).
    _created_worktrees: list[str] = []

    def run_worktree(
        scenario: dict,
        prompt: str = "test task",
        branch: str | None = None,
        guide: list[str] | None = None,
        timeout: int = 60,
        wait: bool = True,
        wait_timeout: int = 60,
    ) -> WorktreeResult:
        """Spawn ``run_worktree.py`` and (optionally) wait for the detached
        pipeline to reach a terminal state.

        ``run_worktree.py`` is fire-and-forget: it creates the worktree,
        spawns the pipeline subprocess detached (stdin/stdout/stderr=DEVNULL,
        start_new_session=True), and exits as soon as it has printed the
        run_id and worktree path. So the returned ``returncode`` reflects
        only the launch step. With ``wait=True`` (default) the helper polls
        ``<worktree>/.worca/runs/<run_id>/status.json`` until ``pipeline_status``
        is ``completed`` / ``failed`` so subsequent assertions can read the
        run dir without race conditions.

        Worktrees are auto-tracked for fixture-teardown cleanup (plan rule #15).
        """
        _scenario_counter[0] += 1
        scenario_path = tmp_path / f"scenario_{_scenario_counter[0]}.json"
        scenario_path.write_text(json.dumps(scenario))

        cmd = [sys.executable, "-m", "worca.scripts.run_worktree",
               "--prompt", prompt]
        if branch:
            cmd.extend(["--branch", branch])
        if guide:
            for g in guide:
                cmd.extend(["--guide", g])
        cmd = _wrap_with_coverage(cmd)

        env = _base_env_common()
        env["MOCK_CLAUDE_SCENARIO"] = str(scenario_path)

        result = subprocess.run(
            cmd, cwd=str(project), env=env,
            capture_output=True, text=True, timeout=timeout,
        )

        # stdout: "<run_id>\n<worktree_path>\n"
        lines = (result.stdout or "").strip().splitlines()
        run_id = lines[0] if lines else ""
        worktree_path = lines[1] if len(lines) > 1 else ""

        if worktree_path:
            _created_worktrees.append(worktree_path)

        status: dict = {}
        events: list = []
        if wait and worktree_path and run_id:
            run_dir = Path(worktree_path) / ".worca" / "runs" / run_id
            status_path = run_dir / "status.json"
            deadline = time.time() + wait_timeout
            while time.time() < deadline:
                if status_path.exists():
                    try:
                        data = json.loads(status_path.read_text())
                        if data.get("pipeline_status") in ("completed", "failed"):
                            status = data
                            break
                    except (json.JSONDecodeError, OSError):
                        pass
                time.sleep(0.3)
            events_path = run_dir / "events.jsonl"
            if events_path.exists():
                events = [
                    json.loads(line) for line in events_path.read_text().splitlines()
                    if line.strip()
                ]

        return WorktreeResult(
            returncode=result.returncode,
            run_id=run_id,
            worktree_path=worktree_path,
            status=status,
            events=events,
            stdout=result.stdout or "",
            stderr=result.stderr or "",
        )

    def run_parallel(
        scenario: dict,
        prompts: list[str],
        timeout: int = 180,
    ) -> ParallelResult:
        """Spawn ``run_parallel.py`` with the given prompts. All concurrent
        pipelines read the same MOCK_CLAUDE_SCENARIO (mock_claude is keyed
        on agent role, not on prompt), so the scenario applies uniformly.

        The helper waits for ``run_parallel.py`` to finish — it is synchronous
        from the caller's perspective (uses ProcessPoolExecutor with as_completed).
        """
        _scenario_counter[0] += 1
        scenario_path = tmp_path / f"scenario_{_scenario_counter[0]}.json"
        scenario_path.write_text(json.dumps(scenario))

        cmd = [sys.executable, "-m", "worca.scripts.run_parallel",
               "--prompts", *prompts]
        cmd = _wrap_with_coverage(cmd)

        env = _base_env_common()
        env["MOCK_CLAUDE_SCENARIO"] = str(scenario_path)

        result = subprocess.run(
            cmd, cwd=str(project), env=env,
            capture_output=True, text=True, timeout=timeout,
        )

        # run_parallel writes a parallel-results.json into worktree-dir.
        # Default worktree dir is .worktrees/ inside the project.
        summary: list = []
        summary_path = project / ".worktrees" / "parallel-results.json"
        if summary_path.exists():
            try:
                summary = json.loads(summary_path.read_text())
            except json.JSONDecodeError:
                pass

        # Track every worktree run_parallel created so the fixture finalizer
        # cleans them up (the slug-based dirs that run_parallel writes to).
        for entry in summary:
            wt = entry.get("worktree")
            if wt and wt not in _created_worktrees:
                _created_worktrees.append(wt)

        return ParallelResult(
            returncode=result.returncode,
            summary=summary,
            stdout=result.stdout or "",
            stderr=result.stderr or "",
        )

    def run_hook(
        name: str,
        payload: dict,
        env_overrides: dict | None = None,
        timeout: int = 10,
    ) -> subprocess.CompletedProcess:
        """Invoke a claude_hooks entry-point as a subprocess (W-050 Phase 2).

        Spawns ``python -m worca.claude_hooks.<name>`` with ``payload`` piped as
        JSON on stdin — matching how Claude Code invokes hooks at runtime — and
        returns the CompletedProcess so tests can assert on returncode / stderr.

        The command is wrapped via ``_wrap_with_coverage`` and the env carries
        ``COVERAGE_FILE`` under WORCA_COVERAGE=1, so hook subprocesses produce
        coverage fragments alongside pipeline runs. ``set_governance_agent`` /
        ``enable_beads`` overrides apply just like for ``run()``.

        Args:
            name: hook module suffix, e.g. ``"pre_tool_use"`` or ``"post_tool_use"``.
            payload: dict serialized to stdin JSON (the hook's ``data`` input).
            env_overrides: per-call env additions, applied after fixture overrides.
            timeout: subprocess timeout in seconds.
        """
        cmd = [sys.executable, "-m", f"worca.claude_hooks.{name}"]
        cmd = _wrap_with_coverage(cmd)
        env = _base_env_common()
        if env_overrides:
            env.update(env_overrides)
        return subprocess.run(
            cmd, cwd=str(project), env=env,
            input=json.dumps(payload), text=True,
            capture_output=True, timeout=timeout,
        )

    def run_cli(
        name: str,
        *args: str,
        env_overrides: dict | None = None,
        timeout: int = 30,
    ) -> subprocess.CompletedProcess:
        """Invoke a worca CLI subcommand as a coverage-tracked subprocess.

        Spawns ``python -m worca.cli.main <name> <args>`` via
        ``_wrap_with_coverage`` with ``COVERAGE_FILE`` pointing to
        ``REPO_ROOT/.coverage`` so fragments land where ``coverage combine``
        can find them (not in the per-test tmpdir). Mirrors ``run_hook``.

        Args:
            name: CLI subcommand name, e.g. ``"cleanup"``.
            *args: Additional arguments forwarded to the subcommand.
            env_overrides: per-call env additions, applied after fixture overrides.
            timeout: subprocess timeout in seconds.
        """
        cmd = [sys.executable, "-m", "worca.cli.main", name, *args]
        cmd = _wrap_with_coverage(cmd)
        env = _base_env_common()
        if env_overrides:
            env.update(env_overrides)
        return subprocess.run(
            cmd, cwd=str(project), env=env,
            capture_output=True, text=True, timeout=timeout,
        )

    def add_webhook(url: str) -> None:
        """Add a webhook URL to worca config for event dispatch testing.

        emitter.py _validate_webhook only accepts https:// or http://localhost
        prefixes — so the webhook_server fixture must bind to localhost.
        Writes to config.json (W-077: worca.* lives in the project config dir).
        """
        s = json.loads(_config_path.read_text())
        s.setdefault("worca", {})
        s["worca"]["webhooks"] = [{"url": url}]
        _config_path.write_text(json.dumps(s, indent=2))

    def enable_stages(*names: str) -> None:
        """Flip ``worca.stages.<name>.enabled`` to True for each stage name.

        Tests that need preflight, plan_review, or learn to actually run call
        this *after* fixture setup (which disables them by default for speed).
        Writes to config.json (W-077: worca.* lives in the project config dir).
        """
        s = json.loads(_config_path.read_text())
        s.setdefault("worca", {}).setdefault("stages", {})
        for name in names:
            s["worca"]["stages"].setdefault(name, {})["enabled"] = True
        _config_path.write_text(json.dumps(s, indent=2))

    def set_governance_agent(name: str) -> None:
        """Set ``WORCA_AGENT`` for the next run so live hooks see a real agent.

        The fixture default empty string short-circuits guardian-only / dispatch
        / plan_check enforcement. Phase 2 governance tests need a real agent
        identity. Replaces, does not append (per W-050 plan Considerations).
        """
        _overrides["WORCA_AGENT"] = name

    def enable_beads(
        response_file: Path | None = None, beads_file: Path | None = None
    ) -> None:
        """Activate the bd stub and clear ``WORCA_SKIP_BEADS`` for the next run.

        The stubs directory is prepended to ``PATH`` only inside the next
        run subprocess — global PATH is never mutated (W-050 plan rule #16).

        Args:
            response_file: Optional path to a JSON file with canned bd
                responses. See ``tests/integration/stubs/_stub_lib.py`` for
                the schema.
            beads_file: Optional path to a JSON file describing a stateful bead
                pool (``{"beads": [{"id", "title", "effort", ...}]}``). When
                set, the stub serves ``bd ready``/``show``/``close`` from the
                pool, tracking closures across calls — exercising multi-bead
                Phase-1 fan-out. See ``stubs/_stub_lib.py``.
        """
        existing_path = _overrides.get("PATH", os.environ.get("PATH", ""))
        if str(STUBS_DIR) not in existing_path.split(os.pathsep):
            _overrides["PATH"] = f"{STUBS_DIR}{os.pathsep}{existing_path}"
        _overrides["WORCA_SKIP_BEADS"] = ""
        _overrides["WORCA_STUB_LOG"] = str(_stub_log_path)
        if response_file is not None:
            _overrides["WORCA_STUB_BD_RESPONSE_FILE"] = str(response_file)
            _stub_response_files["bd"] = Path(response_file)
        if beads_file is not None:
            _overrides["WORCA_STUB_BEADS_FILE"] = str(beads_file)

    yield PipelineEnv(
        project=project,
        worca_dir=worca_dir,
        run=run,
        run_background=run_background,
        run_hook=run_hook,
        run_worktree=run_worktree,
        run_parallel=run_parallel,
        run_cli=run_cli,
        tmp_path=tmp_path,
        add_webhook=add_webhook,
        enable_stages=enable_stages,
        set_governance_agent=set_governance_agent,
        enable_beads=enable_beads,
        stubs_dir=STUBS_DIR,
        stub_log_path=_stub_log_path,
        stub_response_files=_stub_response_files,
        worca_config_path=_config_path,
    )

    _stop_beads_daemons(project, _created_worktrees)

    # Reap all spawned process groups BEFORE removing worktrees — the
    # procs/ registry must still be on disk for kill_all_tracked to read.
    _reap_all_processes(_background_procs, _created_worktrees, worca_dir)

    # W-050 Phase 3 — fixture finalizer (plan rule #15): always remove
    # worktrees we created, even on test failure, so the parent repo isn't
    # littered with locked worktree refs across the suite.
    for wt_path in _created_worktrees:
        if not Path(wt_path).exists():
            continue
        try:
            subprocess.run(
                ["git", "worktree", "remove", "--force", wt_path],
                cwd=str(project), capture_output=True, timeout=10,
            )
        except (subprocess.TimeoutExpired, OSError):
            pass


# ---------------------------------------------------------------------------
# webhook_server fixture
# ---------------------------------------------------------------------------

def _start_webhook_server(received: list, port: int = 0) -> HTTPServer:
    """Start an HTTP server that captures webhook POST bodies."""

    class _Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            try:
                received.append(json.loads(body))
            except json.JSONDecodeError:
                received.append({"_raw": body.decode()})
            self.send_response(200)
            self.end_headers()

        def log_message(self, *args):
            pass  # suppress default request logging

    # Bind to the literal IP (no getaddrinfo call) to avoid a 30s+ cold-resolver
    # hang on the GitHub macOS CI runner — reliably reproduced as a fixture-setup
    # timeout on `HTTPServer(("localhost", 0), _Handler)`. The advertised URL
    # below still uses "localhost" so the webhook allowlist's "http://localhost/"
    # prefix check continues to apply (it also accepts "http://127.0.0.1/", but
    # keeping the URL as "localhost" preserves the test's documented intent).
    server = HTTPServer(("127.0.0.1", port), _Handler)
    server.port = server.server_address[1]  # type: ignore[attr-defined]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


@pytest.fixture
def webhook_server():
    """Start a local HTTP server that records received webhook POSTs."""
    received: list = []
    server = _start_webhook_server(received, port=0)
    yield WebhookCapture(url=f"http://localhost:{server.port}/hook", received=received)
    server.shutdown()
