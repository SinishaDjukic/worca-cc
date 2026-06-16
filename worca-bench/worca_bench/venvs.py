"""worca version/ref provisioning (requirement 1).

The runner is version-agnostic: it never imports worca. For each requested ref it
resolves a ``WorcaEnv`` describing how to invoke that worca — either the current
environment (``local``, for tests/dev) or an isolated venv with a pinned install.
Venvs are cached by ref-hash under ``<target>/cache/venvs/`` and reused across reps.
"""

from __future__ import annotations

import hashlib
import os
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

from .config import WorcaRef

WORCA_REPO_SLUG = "SinishaDjukic/worca-cc"
GIT_BASE = f"git+https://github.com/{WORCA_REPO_SLUG}"


class VenvError(RuntimeError):
    pass


def find_worca_repo() -> Path | None:
    """Locate the worca-cc source repo (needed for ``local`` ref + the mock Claude).

    Order: ``WORCA_BENCH_WORCA_REPO`` env → the repo this package lives in →
    ``None`` (caller must then require a non-local ref)."""
    env = os.environ.get("WORCA_BENCH_WORCA_REPO")
    if env:
        p = Path(env).expanduser().resolve()
        if (p / "src" / "worca").is_dir():
            return p
    # worca-bench/worca_bench/venvs.py -> parents[2] == repo root (in-tree layout)
    here = Path(__file__).resolve()
    for cand in here.parents:
        if (cand / "src" / "worca").is_dir() and (cand / "worca-bench").is_dir():
            return cand
    return None


@dataclass
class WorcaEnv:
    """How to invoke a resolved worca install."""

    ref: str
    python: str  # interpreter that has worca importable
    env_overrides: dict[str, str] = field(default_factory=dict)
    repo: Path | None = None  # worca-cc source repo, when known
    resolved_sha: str | None = None
    version: str | None = None  # resolved worca package version (e.g. "0.58.0")

    def base_env(self) -> dict[str, str]:
        env = dict(os.environ)
        env.update(self.env_overrides)
        return env

    def describe(self) -> str:
        if self.resolved_sha:
            return f"{self.ref}@{self.resolved_sha[:12]}"
        return self.ref


def _ref_hash(ref: WorcaRef) -> str:
    key = f"{ref.source or ''}::{ref.ref}"
    return hashlib.sha256(key.encode()).hexdigest()[:16]


def _pip_target(ref: WorcaRef) -> str:
    """Map a ref to a pip install target."""
    source = ref.source
    if source and source.startswith("path:"):
        return source[len("path:"):]
    if source and (source.startswith("git+") or source.startswith("http")):
        # explicit source with the ref as the @<ref> suffix
        base = source.rstrip("@")
        return f"{base}@{ref.ref}"
    # Released version like "0.58.0" => PyPI pin; otherwise treat as a git ref.
    if ref.ref and ref.ref[0].isdigit():
        return f"worca-cc=={ref.ref}"
    return f"{GIT_BASE}@{ref.ref}"


def _git_sha(repo: Path, ref: str) -> str | None:
    try:
        out = subprocess.run(
            ["git", "rev-parse", ref],
            cwd=repo, capture_output=True, text=True, check=True,
        )
        return out.stdout.strip()
    except (subprocess.CalledProcessError, OSError):
        return None


def _worca_version(python: str, env_overrides: dict[str, str] | None = None) -> str | None:
    """Query the resolved worca package version (best-effort; None on failure)."""
    try:
        env = dict(os.environ)
        if env_overrides:
            env.update(env_overrides)
        out = subprocess.run(
            [python, "-c",
             "import worca,sys; sys.stdout.write(getattr(worca,'__version__','') or '')"],
            capture_output=True, text=True, env=env, timeout=30, check=False,
        )
        return out.stdout.strip() or None
    except Exception:  # noqa: BLE001 - version is advisory metadata
        return None


def resolve_worca_env(
    ref: WorcaRef,
    target_dir: Path,
    *,
    build: bool = True,
) -> WorcaEnv:
    """Resolve (and, for non-local refs, build+cache) a venv for ``ref``.

    ``build=False`` returns the env description without creating the venv — used by
    tests and ``--dry-run`` to avoid network/pip.
    """
    repo = find_worca_repo()

    if ref.is_local:
        if repo is None:
            raise VenvError(
                "worca ref 'local' requires the worca-cc source repo; set "
                "WORCA_BENCH_WORCA_REPO or use a pip-installable ref"
            )
        # Use the current interpreter; make worca importable from source.
        overrides = {"PYTHONPATH": _prepend_pythonpath(str(repo / "src"))}
        return WorcaEnv(
            ref="local",
            python=sys.executable,
            env_overrides=overrides,
            repo=repo,
            resolved_sha=_git_sha(repo, "HEAD"),
            version=_worca_version(sys.executable, overrides) if build else None,
        )

    venv_dir = target_dir / "cache" / "venvs" / _ref_hash(ref)
    py = venv_dir / ("Scripts" if os.name == "nt" else "bin") / (
        "python.exe" if os.name == "nt" else "python"
    )
    resolved_sha = _git_sha(repo, ref.ref) if repo else None

    if not build:
        return WorcaEnv(ref=ref.ref, python=str(py), repo=repo, resolved_sha=resolved_sha)

    if not py.exists():
        _build_venv(venv_dir, _pip_target(ref))
    elif not _worca_importable(py):
        # Stale/broken cache — rebuild.
        _build_venv(venv_dir, _pip_target(ref))

    return WorcaEnv(
        ref=ref.ref, python=str(py), repo=repo, resolved_sha=resolved_sha,
        version=_worca_version(str(py)),
    )


def _prepend_pythonpath(path: str) -> str:
    existing = os.environ.get("PYTHONPATH", "")
    return f"{path}{os.pathsep}{existing}" if existing else path


def _worca_importable(py: Path) -> bool:
    try:
        r = subprocess.run(
            [str(py), "-c", "import worca"],
            capture_output=True, timeout=60,
        )
        return r.returncode == 0
    except (subprocess.SubprocessError, OSError):
        return False


def _build_venv(venv_dir: Path, pip_target: str) -> None:
    venv_dir.parent.mkdir(parents=True, exist_ok=True)
    try:
        subprocess.run(
            [sys.executable, "-m", "venv", str(venv_dir)],
            check=True, capture_output=True, text=True,
        )
        py = venv_dir / ("Scripts" if os.name == "nt" else "bin") / (
            "python.exe" if os.name == "nt" else "python"
        )
        subprocess.run(
            [str(py), "-m", "pip", "install", "--upgrade", "pip"],
            check=True, capture_output=True, text=True,
        )
        subprocess.run(
            [str(py), "-m", "pip", "install", pip_target],
            check=True, capture_output=True, text=True,
        )
    except subprocess.CalledProcessError as e:  # pragma: no cover - network path
        raise VenvError(
            f"failed to provision worca venv for {pip_target!r}: "
            f"{(e.stderr or '').strip()[:500]}"
        ) from e
