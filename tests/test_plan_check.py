"""Tests for plan_check.py - Block source file writes without MASTER_PLAN.md."""
import os
import pytest
from worca.hooks.plan_check import check_plan


@pytest.fixture
def in_tmp(tmp_path, monkeypatch):
    """Change to a temp directory for plan file detection."""
    monkeypatch.chdir(tmp_path)
    return tmp_path


# --- Block writes without plan ---

class TestBlockWithoutPlan:
    def test_blocks_write_py_without_plan(self, in_tmp):
        code, reason = check_plan("Write", {"file_path": "/project/app.py"})
        assert code == 2
        assert "MASTER_PLAN" in reason

    def test_blocks_edit_js_without_plan(self, in_tmp):
        code, reason = check_plan("Edit", {"file_path": "/project/index.js"})
        assert code == 2

    def test_blocks_write_ts_without_plan(self, in_tmp):
        code, reason = check_plan("Write", {"file_path": "/project/main.ts"})
        assert code == 2

    def test_blocks_write_go_without_plan(self, in_tmp):
        code, reason = check_plan("Write", {"file_path": "/project/main.go"})
        assert code == 2

    def test_blocks_write_rs_without_plan(self, in_tmp):
        code, reason = check_plan("Write", {"file_path": "/project/lib.rs"})
        assert code == 2

    def test_blocks_write_java_without_plan(self, in_tmp):
        code, reason = check_plan("Write", {"file_path": "/project/App.java"})
        assert code == 2

    def test_blocks_write_jsx_without_plan(self, in_tmp):
        code, reason = check_plan("Write", {"file_path": "/project/App.jsx"})
        assert code == 2

    def test_blocks_write_tsx_without_plan(self, in_tmp):
        code, reason = check_plan("Write", {"file_path": "/project/App.tsx"})
        assert code == 2

    def test_blocks_write_c_without_plan(self, in_tmp):
        code, reason = check_plan("Write", {"file_path": "/project/main.c"})
        assert code == 2

    def test_blocks_write_cpp_without_plan(self, in_tmp):
        code, reason = check_plan("Write", {"file_path": "/project/main.cpp"})
        assert code == 2

    def test_blocks_write_rb_without_plan(self, in_tmp):
        code, reason = check_plan("Write", {"file_path": "/project/app.rb"})
        assert code == 2

    def test_blocks_write_h_without_plan(self, in_tmp):
        code, reason = check_plan("Write", {"file_path": "/project/header.h"})
        assert code == 2


# --- Allow writes with plan ---

class TestAllowWithPlan:
    def test_allows_write_py_with_plan(self, in_tmp):
        (in_tmp / "MASTER_PLAN.md").write_text("# Plan")
        code, reason = check_plan("Write", {"file_path": "/project/app.py"})
        assert code == 0

    def test_allows_edit_js_with_plan(self, in_tmp):
        (in_tmp / "MASTER_PLAN.md").write_text("# Plan")
        code, reason = check_plan("Edit", {"file_path": "/project/index.js"})
        assert code == 0


# --- Always allow non-source files ---

class TestAllowNonSource:
    def test_allows_write_json(self, in_tmp):
        code, reason = check_plan("Write", {"file_path": "/project/config.json"})
        assert code == 0

    def test_allows_write_md(self, in_tmp):
        code, reason = check_plan("Write", {"file_path": "/project/README.md"})
        assert code == 0

    def test_allows_write_toml(self, in_tmp):
        code, reason = check_plan("Write", {"file_path": "/project/pyproject.toml"})
        assert code == 0

    def test_allows_write_yaml(self, in_tmp):
        code, reason = check_plan("Write", {"file_path": "/project/config.yaml"})
        assert code == 0

    def test_allows_write_gitignore(self, in_tmp):
        code, reason = check_plan("Write", {"file_path": "/project/.gitignore"})
        assert code == 0


# --- Always allow test files ---

class TestAllowTestFiles:
    def test_allows_test_prefix(self, in_tmp):
        code, reason = check_plan("Write", {"file_path": "/project/test_app.py"})
        assert code == 0

    def test_allows_test_suffix(self, in_tmp):
        code, reason = check_plan("Write", {"file_path": "/project/app_test.py"})
        assert code == 0

    def test_allows_dot_test_file(self, in_tmp):
        code, reason = check_plan("Write", {"file_path": "/project/app.test.js"})
        assert code == 0

    def test_allows_spec_prefix(self, in_tmp):
        code, reason = check_plan("Write", {"file_path": "/project/spec_app.py"})
        assert code == 0

    def test_allows_spec_suffix(self, in_tmp):
        code, reason = check_plan("Write", {"file_path": "/project/app_spec.rb"})
        assert code == 0


# --- Allow non-write tools ---

class TestAllowNonWriteTools:
    def test_allows_read(self, in_tmp):
        code, reason = check_plan("Read", {"file_path": "/project/app.py"})
        assert code == 0

    def test_allows_bash(self, in_tmp):
        code, reason = check_plan("Bash", {"command": "python app.py"})
        assert code == 0

    def test_allows_glob(self, in_tmp):
        code, reason = check_plan("Glob", {"pattern": "**/*.py"})
        assert code == 0

    def test_allows_grep(self, in_tmp):
        code, reason = check_plan("Grep", {"pattern": "def main"})
        assert code == 0
