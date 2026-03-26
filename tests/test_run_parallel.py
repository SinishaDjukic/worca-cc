"""Tests for run_parallel.py helper functions."""

import os
import re
import sys
from unittest.mock import patch, MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".claude", "scripts"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".claude"))

# Import the helper functions directly from the script module
import importlib.util
spec = importlib.util.spec_from_file_location(
    "run_parallel",
    os.path.join(os.path.dirname(__file__), "..", ".claude", "scripts", "run_parallel.py"),
)
run_parallel = importlib.util.module_from_spec(spec)
spec.loader.exec_module(run_parallel)

_slugify = run_parallel._slugify
_run_pipeline_in_worktree = run_parallel._run_pipeline_in_worktree

# _ARG_INLINE_LIMIT is now imported from claude_cli by run_parallel
from worca.utils.claude_cli import _ARG_INLINE_LIMIT  # noqa: E402


# --- _slugify ---

def test_slugify_basic():
    assert _slugify("Add user auth") == "add-user-auth"


def test_slugify_special_chars():
    assert _slugify("Fix bug #42!") == "fix-bug-42"


def test_slugify_collapses_dashes():
    assert _slugify("too   many   spaces") == "too-many-spaces"


def test_slugify_strips_leading_trailing():
    assert _slugify("  --hello--  ") == "hello"


def test_slugify_truncates_to_30():
    long_title = "a" * 50
    result = _slugify(long_title)
    assert len(result) <= 30


def test_slugify_only_alphanumeric_and_dash():
    result = _slugify("Hello@World#2024!")
    assert re.match(r'^[a-z0-9\-]+$', result)


# --- _run_pipeline_in_worktree large prompt offloading ---

class TestRunPipelineLargePrompt:
    @patch("run_parallel.subprocess.run")
    def test_small_prompt_uses_inline_arg(self, mock_run):
        mock_run.return_value = MagicMock(returncode=0, stdout="ok", stderr="")
        _run_pipeline_in_worktree("/tmp/wt", "small prompt", 1, 1, "settings.json")
        cmd = mock_run.call_args[0][0]
        assert "--prompt" in cmd
        assert "--prompt-file" not in cmd
        idx = cmd.index("--prompt")
        assert cmd[idx + 1] == "small prompt"

    @patch("run_parallel.subprocess.run")
    def test_large_prompt_uses_prompt_file(self, mock_run):
        mock_run.return_value = MagicMock(returncode=0, stdout="ok", stderr="")
        large_prompt = "x" * (_ARG_INLINE_LIMIT + 1)
        _run_pipeline_in_worktree("/tmp/wt", large_prompt, 1, 1, "settings.json")
        cmd = mock_run.call_args[0][0]
        assert "--prompt-file" in cmd
        assert "--prompt" not in cmd
        # The temp file should have been cleaned up
        idx = cmd.index("--prompt-file")
        prompt_file = cmd[idx + 1]
        assert not os.path.exists(prompt_file)

    @patch("run_parallel.subprocess.run")
    def test_large_prompt_file_contains_full_content(self, mock_run):
        """Verify the temp file contains the full prompt before subprocess runs."""
        large_prompt = "y" * (_ARG_INLINE_LIMIT + 100)
        written_content = None

        def capture_run(cmd, **kwargs):
            nonlocal written_content
            idx = cmd.index("--prompt-file")
            path = cmd[idx + 1]
            if os.path.exists(path):
                with open(path) as f:
                    written_content = f.read()
            return MagicMock(returncode=0, stdout="", stderr="")

        mock_run.side_effect = capture_run
        _run_pipeline_in_worktree("/tmp/wt", large_prompt, 1, 1, "settings.json")
        assert written_content == large_prompt
