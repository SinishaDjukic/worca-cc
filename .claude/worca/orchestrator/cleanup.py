"""Worktree cleanup policy enforcement.

Policies:
  - on-success: Remove worktrees for pipelines that completed successfully
  - always: Remove all worktrees regardless of outcome
  - never: Keep all worktrees
"""

from worca.utils.git import remove_pipeline_worktree


VALID_POLICIES = ("on-success", "always", "never")


def apply_cleanup(results: list[dict], policy: str = "on-success") -> list[str]:
    """Apply the cleanup policy to pipeline results.

    Args:
        results: List of dicts with keys: worktree_path, returncode
        policy: One of "on-success", "always", "never"

    Returns list of worktree paths that were removed.
    """
    if policy not in VALID_POLICIES:
        raise ValueError(
            f"Invalid cleanup policy {policy!r}; must be one of {VALID_POLICIES}"
        )

    if policy == "never":
        return []

    removed: list[str] = []
    for entry in results:
        wt_path = entry.get("worktree_path", "")
        rc = entry.get("returncode")

        if not wt_path:
            continue

        should_remove = policy == "always" or (policy == "on-success" and rc == 0)
        if not should_remove:
            continue

        try:
            ok = remove_pipeline_worktree(wt_path)
            if ok:
                removed.append(wt_path)
        except Exception:
            # Graceful handling — removal failure should not crash the caller
            pass

    return removed
