"""Install worca into a cloned benchmark repo + seed a minimal, version-portable config.

This is the "install into the cloned git repo" step (W-075 §2 step 3, §5). The design
goal is to inject the *least* version-specific surface:

  1. Base   — the pinned worca version self-seeds via ``worca init`` (schema-correct).
  2. Overlay — only cross-template keys (model aliases) + a version-keyed overlay.
  3. Template — carries the experiment (passed as ``--template`` at launch, not here).

Secrets (ANTHROPIC_API_KEY / per-model env) go to ``settings.local.json`` (gitignored),
never into ``settings.json``.
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any

from .venvs import WorcaEnv

OVERLAY_DIR = Path(__file__).parent / "overlays"
# Env vars worca's own integration suite strips to avoid leaking parent run state.
LEAKY_ENV = (
    "WORCA_PLAN_FILE", "WORCA_PROJECT_ROOT", "WORCA_RUN_ID", "WORCA_RUN_DIR",
    "GRAPHIFY_OUT",
)
# Secrets to materialize into settings.local.json env when present in the environment.
SECRET_ENV_KEYS = (
    # Pipeline (worca / Claude) credentials.
    "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN",
    # Grader credentials: sb-cli (hosted SWE-bench eval) and Modal (serverless
    # x86 harness). Collected so they reach plugin.grade() via secret_env.
    "SWEBENCH_API_KEY", "MODAL_TOKEN_ID", "MODAL_TOKEN_SECRET",
)


class InstallError(RuntimeError):
    pass


def deep_merge(base: dict[str, Any], overlay: dict[str, Any]) -> dict[str, Any]:
    """Recursively merge ``overlay`` into ``base`` (overlay wins on scalars)."""
    out = dict(base)
    for k, v in overlay.items():
        if k.startswith("_"):
            continue
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def load_overlay(resolved_sha: str | None) -> dict[str, Any]:
    """Pick the version-keyed overlay. Today only ``default.json`` exists; add
    ``<range>.json`` siblings when a schema break needs a targeted override."""
    default = OVERLAY_DIR / "default.json"
    data = json.loads(default.read_text(encoding="utf-8")) if default.exists() else {}
    return data.get("worca", {}) or {}


def worca_init(tree: Path, wenv: WorcaEnv, *, timeout: int = 300) -> None:
    """Run ``worca init`` in the tree using the pinned worca (self-seeds settings)."""
    env = wenv.base_env()
    for k in LEAKY_ENV:
        env.pop(k, None)
    try:
        subprocess.run(
            [wenv.python, "-m", "worca.cli.main", "init"],
            cwd=str(tree), env=env, check=True, capture_output=True, text=True,
            timeout=timeout,
        )
    except subprocess.CalledProcessError as e:
        raise InstallError(
            f"worca init failed in {tree}: {(e.stderr or e.stdout or '').strip()[:800]}"
        ) from e


def seed_settings(
    tree: Path,
    *,
    overlay: dict[str, Any],
    extra_settings: dict[str, Any] | None = None,
    pr_defer: bool = True,
    secret_env: dict[str, str] | None = None,
) -> None:
    """Apply the minimal cross-template overlay + secrets to the version-seeded config.

    ``settings.json`` gets only model aliases / pricing-style keys + ``pr.defer``;
    ``settings.local.json`` gets secret env. Both are deep-merged over whatever
    ``worca init`` already wrote so we never clobber the version's own defaults.
    """
    claude = tree / ".claude"
    claude.mkdir(parents=True, exist_ok=True)

    worca_overlay = deep_merge(overlay, extra_settings or {})
    if pr_defer:
        worca_overlay = deep_merge(worca_overlay, {"stages": {"pr": {"defer": True}}})

    if worca_overlay:
        _merge_json_file(claude / "settings.json", {"worca": worca_overlay})

    secret_env = secret_env or {}
    if secret_env:
        # Stored under worca.models._bench_env so it merges into the subprocess env
        # without inlining secrets into the shared settings.json.
        _merge_json_file(
            claude / "settings.local.json",
            {"worca": {"_bench_secret_env": secret_env}},
        )


def collect_secret_env(
    environ: dict[str, str] | None = None,
    *,
    extra: dict[str, str] | None = None,
) -> dict[str, str]:
    """Pull known secret keys from the environment for settings.local.json.

    ``extra`` overlays explicitly-supplied secrets (e.g. CLI flags or values
    passed down from the browser) *on top of* the environment-collected set.
    Both are filtered through ``SECRET_ENV_KEYS`` so an unknown key can never be
    injected into the subprocess env, and empty values never shadow a real one.
    """
    environ = environ if environ is not None else dict(os.environ)
    out = {k: environ[k] for k in SECRET_ENV_KEYS if environ.get(k)}
    for k, v in (extra or {}).items():
        if k in SECRET_ENV_KEYS and v:
            out[k] = v
    return out


def _merge_json_file(path: Path, patch: dict[str, Any]) -> None:
    existing: dict[str, Any] = {}
    if path.exists():
        try:
            existing = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            existing = {}
    merged = deep_merge(existing, patch)
    path.write_text(json.dumps(merged, indent=2) + "\n", encoding="utf-8")
