"""Commit0 plugin (W-075 §3) — greenfield library build with contamination handling.

Decision: **hide the gold tests during the run, grade on a pristine tree.** Before
launch we stash the held-out test paths out of the agent's worktree (its TDD tester
writes its own throwaway tests). We extract a source-only diff (gold tests excluded),
then grade by applying it onto a fresh skeleton that carries the gold tests. A leakage
guard (in the runner, using ``Prepared.gold_test_paths``) fails any rep whose diff
touches a gold-test path.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

from ..config import Profile
from .base import (
    BenchmarkPlugin,
    GradeResult,
    Instance,
    Prepared,
    _git,
    _git_head,
    grade_env,
    init_repo_from_local,
    stub_grade,
)

# Per-library spec files Commit0 ships in every repo root. They are not source and
# (notably spec.pdf, which is binary) must never leak into the graded prediction diff.
_SPEC_ARTIFACTS = ("spec.pdf", "spec.pdf.bz2")


def _coerce_pos_int(raw):
    """A positive int (seconds), else None. Mirrors the build-timeout coercion."""
    try:
        v = int(raw)
    except (TypeError, ValueError):
        return None
    return v if v > 0 else None


def _docker_running() -> bool:
    """True if the local Docker daemon answers — needed for local-docker grading."""
    try:
        return subprocess.run(
            ["docker", "info"], capture_output=True, timeout=15,
        ).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def _image_published(image: str) -> bool | None:
    """Registry existence of a grade image without pulling it.

    ``True`` if the manifest exists, ``False`` only when the registry *definitively*
    reports it missing, ``None`` when the check can't run (docker absent) or is
    inconclusive (auth/network) — a preflight must never block on an inconclusive
    signal.
    """
    try:
        p = subprocess.run(
            ["docker", "manifest", "inspect", image],
            capture_output=True, text=True, timeout=30,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if p.returncode == 0:
        return True
    err = (p.stderr or "").lower()
    if any(s in err for s in (
        "no such manifest", "not found", "manifest unknown", "manifest for",
    )):
        return False
    return None  # auth / network / unknown — inconclusive, don't block


class Commit0Plugin(BenchmarkPlugin):
    name = "commit0"

    def load_instances(self, profile: Profile) -> list[Instance]:
        sel = profile.selection
        if not sel.instances_file:
            raise RuntimeError(
                "commit0 currently requires selection.instances_file (a list of "
                "libraries with skeleton path + gold_test_paths). Run `commit0 setup "
                "lite` and generate the file, or use the offline fixture form."
            )
        raw = Path(sel.instances_file).read_text(encoding="utf-8")
        records = json.loads(raw)
        want = set(sel.instance_ids)
        out: list[Instance] = []
        for r in records:
            if want and r["instance_id"] not in want:
                continue
            out.append(Instance(
                id=r["instance_id"],
                prompt=r.get("spec", r.get("prompt", "")),
                local_repo=r.get("local_repo"),
                base_commit=r.get("base_commit"),
                extra={
                    "gold_test_paths": tuple(r.get("gold_test_paths", [])),
                    # The Commit0 library name `commit0 test` expects (e.g. "tinydb").
                    # Defaults to the instance id, but real Commit0 instance ids and
                    # library names can differ, so the generator sets it explicitly.
                    "lib": r.get("lib", r["instance_id"]),
                    "reference_commit": r.get("reference_commit"),
                    # Config the grader reconstructs `commit0 test` from (base_dir,
                    # dot-file path, skeleton branch). Written by `commit0-gen`.
                    "commit0": r.get("commit0") or {},
                },
            ))
        return out

    def materialize(self, instance: Instance, dest: Path) -> str:
        if not instance.local_repo:
            raise ValueError(f"commit0 instance {instance.id} needs a local_repo skeleton")
        return init_repo_from_local(instance.local_repo, dest, instance.base_commit)

    def prepare(self, instance: Instance, tree: Path) -> Prepared:
        """Stash the gold tests out of the tree so the agent can't see them."""
        base = _git_head(tree)
        gold = tuple(instance.extra.get("gold_test_paths", ()))
        stash_dir = tree.parent / f"{tree.name}__gold_tests"
        stash_dir.mkdir(parents=True, exist_ok=True)
        moved: list[tuple[Path, Path]] = []
        for rel in gold:
            src = tree / rel
            if src.exists():
                dst = stash_dir / rel
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(src), str(dst))
                moved.append((src, dst))

        def restore() -> None:
            for src, dst in moved:
                src.parent.mkdir(parents=True, exist_ok=True)
                if dst.exists():
                    shutil.move(str(dst), str(src))
            if stash_dir.exists():
                shutil.rmtree(stash_dir, ignore_errors=True)

        return Prepared(
            base_commit=base,
            # Exclude the gold tests AND the spec artifacts every Commit0 repo ships in
            # its root: spec.pdf is binary, so if it materializes in the tree it lands in
            # the prediction patch as an incomplete binary diff that `git apply` rejects
            # at grade time ("cannot apply binary patch ... without full index line").
            extra_excludes=gold + _SPEC_ARTIFACTS,
            restore=restore,
            gold_test_paths=gold,
        )

    # worca-bench grade.mode → Commit0's ``commit0 test --backend`` value. Commit0
    # runs its own tests in Docker (``local``) or on Modal serverless x86 (``modal``,
    # which is actually Commit0's default backend). ``sb-cli`` is SWE-bench-only and
    # has no Commit0 equivalent. ``stub`` is handled before this map (no real run).
    BACKENDS = {"local-docker": "local", "modal": "modal"}

    def grade(self, instance, diff, tree, target_dir, grade, *, prepared,
              secret_env=None) -> GradeResult:
        if grade.mode == "stub":
            return stub_grade(diff, instance)
        backend = self.BACKENDS.get(grade.mode)
        if backend is None:
            return GradeResult(
                status="error",
                detail=f"unsupported grade mode {grade.mode!r} for commit0; "
                       "use 'stub', 'local-docker', or 'modal'")
        # Modal authenticates from MODAL_TOKEN_ID/SECRET — fail fast with an
        # actionable message rather than dying deep in the commit0/modal client.
        if backend == "modal":
            env = grade_env(secret_env)
            if not (env.get("MODAL_TOKEN_ID") and env.get("MODAL_TOKEN_SECRET")):
                return GradeResult(
                    status="error",
                    detail="modal grading needs MODAL_TOKEN_ID + MODAL_TOKEN_SECRET "
                           "(set them in the dashboard Settings, pass "
                           "--modal-token-id/--modal-token-secret, or export them)")
        # Optional per-grade timeout (seconds) → `commit0 test --timeout`. This is
        # the test-run cap AND the Modal sandbox timeout (modal.Sandbox.create
        # timeout=); commit0's default is 1800s, which large suites exceed (a
        # SandboxTimeout surfaces as "no test results parsed"). Raise it via the
        # profile's `grade.options.timeout`.
        grade_timeout = _coerce_pos_int((grade.options or {}).get("timeout"))
        # Optional `grade.options.rebuild` → `commit0 test --rebuild`. commit0 pulls a
        # prebuilt per-library image (`wentingzhao/<lib>:v0`); some libraries have no
        # published image (404 on Docker Hub, or the Modal pull hangs). --rebuild
        # builds the image locally from the repo instead — the only way to grade a
        # library whose prebuilt image is missing.
        rebuild = bool((grade.options or {}).get("rebuild"))
        # Real grading: apply the source-only diff onto the live Commit0 setup
        # checkout (which carries the held-out tests + the .commit0.yaml config that
        # `commit0 test` resolves repo/dataset/image state from) on a throwaway
        # branch, then `commit0 test <lib> --branch <scratch>`. Best-effort (needs
        # commit0 + Docker for local; Modal credentials for modal).
        return self._grade_on_pristine(
            instance, diff, target_dir, prepared, secret_env, backend, grade_timeout,
            rebuild,
        )  # pragma: no cover

    def _grade_image_name(self, instance) -> str:
        """The Docker Hub image `commit0 test` pulls for this library (see commit0
        harness/spec.py: ``wentingzhao/<repo>:v0``)."""
        lib = instance.extra.get("lib", instance.id)
        return f"wentingzhao/{lib}:v0".lower()

    def grade_preflight(self, instance, grade, *, secret_env=None) -> tuple[bool, str]:
        """Pre-build check that this library can be graded later — so a real (token-
        burning) pipeline build isn't wasted on something commit0 can't grade.

        Catches the deterministic blockers: missing Modal creds, an unreachable
        Docker daemon (local-docker), and a grade image that the registry reports as
        genuinely unpublished. Environmental/transient failures (disk space mid-run,
        a test suite that hangs the sandbox) are NOT predictable here and fall back
        to the build/grade timeouts.
        """
        if grade.mode == "stub":
            return True, ""
        backend = self.BACKENDS.get(grade.mode)
        if backend is None:
            return True, ""  # unknown mode — grade() reports it
        if backend == "modal":
            env = grade_env(secret_env)
            if not (env.get("MODAL_TOKEN_ID") and env.get("MODAL_TOKEN_SECRET")):
                return False, (
                    "modal grading needs MODAL_TOKEN_ID + MODAL_TOKEN_SECRET — set "
                    "them before launching, or the build can't be graded"
                )
        if backend == "local" and not _docker_running():
            return False, "docker daemon not reachable (needed for local-docker grading)"
        img = self._grade_image_name(instance)
        if _image_published(img) is False:
            return False, (
                f"commit0 grade image {img} is not published — this library cannot "
                "be graded by this commit0 release"
            )
        return True, ""

    def _grade_on_pristine(self, instance, diff, target_dir, prepared, secret_env,
                           backend, grade_timeout=None, rebuild=False) -> GradeResult:  # pragma: no cover
        lib = instance.extra.get("lib", instance.id)
        cfg = instance.extra.get("commit0") or {}
        base_dir = cfg.get("base_dir")
        config_file = cfg.get("config_file")
        base_branch = cfg.get("base_branch", "commit0")
        if not base_dir or not config_file:
            return GradeResult(
                status="error",
                detail="commit0 grading needs the 'commit0' config block (base_dir + "
                       "config_file) in the instances file — regenerate it with "
                       "`worca-bench commit0-gen`")
        repo_dir = Path(base_dir) / lib
        # Unique, path-safe scratch branch so concurrent grades of distinct libs in
        # the same setup never collide.
        scratch = f"wb-grade-{instance.id}".replace("/", "_")
        try:
            # Apply the candidate source diff onto a fresh checkout of the skeleton.
            _git(["checkout", "-f", "-B", scratch, base_branch], repo_dir)
            patch = Path(target_dir) / "predictions" / f"{instance.id}.patch"
            patch.parent.mkdir(parents=True, exist_ok=True)
            patch.write_text(diff, encoding="utf-8")
            subprocess.run(["git", "-C", str(repo_dir), "apply", "--whitespace=nowarn",
                            str(patch)], check=True, capture_output=True, text=True)
            _git(["add", "-A"], repo_dir)
            _git(["-c", "user.email=bench@worca.dev", "-c", "user.name=bench",
                  "commit", "-m", "worca-bench candidate"], repo_dir)
            # `commit0 test` requires TEST_IDS (a pytest selection string). The
            # held-out suite is the gold test dir(s) — exactly what the harness hides
            # during the run and grades against here.
            test_ids = " ".join(instance.extra.get("gold_test_paths", ())) or "tests/"
            cmd = ["commit0", "test", lib, test_ids, "--branch", scratch,
                   "--backend", backend, "--commit0-config-file", str(config_file)]
            if grade_timeout:
                cmd += ["--timeout", str(grade_timeout)]
            if rebuild:
                cmd += ["--rebuild"]
            proc = subprocess.run(
                cmd, cwd=str(Path(config_file).parent), capture_output=True, text=True,
                env=grade_env(secret_env),
            )
            passed, total = _parse_pytest_counts(proc.stdout + proc.stderr)
            if total == 0:
                tail = (proc.stderr or proc.stdout or "").strip()[-600:]
                return GradeResult(
                    status="error",
                    detail=f"commit0 {backend}: no test results parsed (rc={proc.returncode}): {tail}")
            score = passed / total
            return GradeResult(status="graded", resolved=(passed == total),
                               score=score, detail=f"commit0 {backend} {passed}/{total}",
                               tests_passed=passed, tests_total=total)
        except (subprocess.CalledProcessError, OSError) as e:
            tail = getattr(e, "stderr", "") or ""
            return GradeResult(status="error", detail=f"commit0 grade failed: {e} {tail}".strip())
        finally:
            # Leave the setup back on its skeleton branch and drop the scratch branch.
            try:
                _git(["checkout", "-f", base_branch], repo_dir)
                _git(["branch", "-D", scratch], repo_dir)
            except subprocess.CalledProcessError:
                pass


def _parse_pytest_counts(text: str) -> tuple[int, int]:  # pragma: no cover
    import re

    passed = failed = 0
    m = re.search(r"(\d+) passed", text)
    if m:
        passed = int(m.group(1))
    m = re.search(r"(\d+) failed", text)
    if m:
        failed = int(m.group(1))
    return passed, passed + failed
