"""Tests for bd create --external-ref auto-injection hook."""
import os
import sys
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".claude"))

from hooks.pre_tool_use import _fix_bd_create_external_ref


class TestFixBdCreateExternalRef:
    """Test _fix_bd_create_external_ref auto-injection."""

    def setup_method(self):
        os.environ.pop("WORCA_RUN_ID", None)

    def teardown_method(self):
        os.environ.pop("WORCA_RUN_ID", None)

    def test_no_fix_when_no_run_id(self):
        result = _fix_bd_create_external_ref("Bash", {"command": 'bd create --title="test" --type=task'})
        assert result is None

    def test_no_fix_for_non_bash_tool(self):
        os.environ["WORCA_RUN_ID"] = "20260310-211756"
        result = _fix_bd_create_external_ref("Write", {"command": 'bd create --title="test"'})
        assert result is None

    def test_no_fix_when_no_bd_create(self):
        os.environ["WORCA_RUN_ID"] = "20260310-211756"
        result = _fix_bd_create_external_ref("Bash", {"command": "bd list"})
        assert result is None

    def test_no_fix_when_external_ref_already_present(self):
        os.environ["WORCA_RUN_ID"] = "20260310-211756"
        cmd = 'bd create --title="test" --type=task --external-ref="worca:20260310-211756"'
        result = _fix_bd_create_external_ref("Bash", {"command": cmd})
        assert result is None

    def test_injects_external_ref(self):
        os.environ["WORCA_RUN_ID"] = "20260310-211756"
        cmd = 'bd create --title="test" --type=task'
        result = _fix_bd_create_external_ref("Bash", {"command": cmd})
        assert result is not None
        assert '--external-ref="worca:20260310-211756"' in result
        assert '--title="test"' in result

    def test_injects_into_multiple_bd_create_in_chain(self):
        os.environ["WORCA_RUN_ID"] = "run-123"
        cmd = 'bd create --title="A" --type=task && bd create --title="B" --type=task'
        result = _fix_bd_create_external_ref("Bash", {"command": cmd})
        assert result is not None
        assert result.count('--external-ref="worca:run-123"') == 2

    def test_preserves_other_flags(self):
        os.environ["WORCA_RUN_ID"] = "run-456"
        cmd = 'bd create --title="Fix bug" --type=bug --priority=1 --description="details"'
        result = _fix_bd_create_external_ref("Bash", {"command": cmd})
        assert "--priority=1" in result
        assert '--description="details"' in result
        assert '--external-ref="worca:run-456"' in result

    def test_no_fix_for_empty_command(self):
        os.environ["WORCA_RUN_ID"] = "run-789"
        result = _fix_bd_create_external_ref("Bash", {"command": ""})
        assert result is None

    def test_works_with_cd_prefix(self):
        os.environ["WORCA_RUN_ID"] = "run-abc"
        cmd = 'cd /project && bd create --title="test" --type=task'
        result = _fix_bd_create_external_ref("Bash", {"command": cmd})
        assert result is not None
        assert "cd /project &&" in result
        assert '--external-ref="worca:run-abc"' in result
