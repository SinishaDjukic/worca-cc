"""Tests for the plan_review JSON schema (.claude/worca/schemas/plan_review.json)."""
import json
import os

import jsonschema
import pytest

SCHEMA_PATH = os.path.join(
    os.path.dirname(__file__), os.pardir,
    ".claude", "worca", "schemas", "plan_review.json",
)


@pytest.fixture
def schema():
    with open(SCHEMA_PATH) as f:
        return json.load(f)


def _valid_plan_review():
    """Return a minimal valid plan_review document."""
    return {
        "outcome": "approve",
        "issues": [
            {
                "category": "completeness",
                "severity": "minor",
                "description": "Missing edge case for empty input",
                "suggestion": "Add handling for empty input in step 3",
                "evidence": "Work request mentions edge cases but plan omits them",
            }
        ],
        "summary": "Plan is mostly complete with one minor gap.",
    }


class TestSchemaFileExists:
    def test_schema_file_exists(self):
        assert os.path.isfile(SCHEMA_PATH), f"Schema file not found at {SCHEMA_PATH}"

    def test_schema_is_valid_json(self, schema):
        assert isinstance(schema, dict)

    def test_schema_has_draft07_meta(self, schema):
        assert schema.get("$schema") == "http://json-schema.org/draft-07/schema#"

    def test_schema_title_is_plan_review(self, schema):
        assert schema.get("title") == "plan_review"

    def test_schema_type_is_object(self, schema):
        assert schema.get("type") == "object"

    def test_schema_additional_properties_false(self, schema):
        assert schema.get("additionalProperties") is False

    def test_schema_required_fields(self, schema):
        required = schema.get("required", [])
        assert set(required) == {"outcome", "issues", "summary"}


class TestOutcomeProperty:
    def test_outcome_approve_valid(self, schema):
        doc = _valid_plan_review()
        doc["outcome"] = "approve"
        jsonschema.validate(doc, schema)

    def test_outcome_revise_valid(self, schema):
        doc = _valid_plan_review()
        doc["outcome"] = "revise"
        jsonschema.validate(doc, schema)

    def test_outcome_invalid_value(self, schema):
        doc = _valid_plan_review()
        doc["outcome"] = "reject"
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(doc, schema)

    def test_outcome_missing(self, schema):
        doc = _valid_plan_review()
        del doc["outcome"]
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(doc, schema)


class TestIssuesProperty:
    def test_issues_empty_array_valid(self, schema):
        doc = _valid_plan_review()
        doc["issues"] = []
        jsonschema.validate(doc, schema)

    def test_issues_missing(self, schema):
        doc = _valid_plan_review()
        del doc["issues"]
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(doc, schema)

    def test_issue_missing_category(self, schema):
        doc = _valid_plan_review()
        del doc["issues"][0]["category"]
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(doc, schema)

    def test_issue_missing_severity(self, schema):
        doc = _valid_plan_review()
        del doc["issues"][0]["severity"]
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(doc, schema)

    def test_issue_missing_description(self, schema):
        doc = _valid_plan_review()
        del doc["issues"][0]["description"]
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(doc, schema)

    def test_issue_without_optional_suggestion(self, schema):
        doc = _valid_plan_review()
        del doc["issues"][0]["suggestion"]
        jsonschema.validate(doc, schema)

    def test_issue_without_optional_evidence(self, schema):
        doc = _valid_plan_review()
        del doc["issues"][0]["evidence"]
        jsonschema.validate(doc, schema)

    def test_issue_invalid_category(self, schema):
        doc = _valid_plan_review()
        doc["issues"][0]["category"] = "unknown_category"
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(doc, schema)

    def test_issue_invalid_severity(self, schema):
        doc = _valid_plan_review()
        doc["issues"][0]["severity"] = "blocker"
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(doc, schema)

    def test_issue_extra_property_rejected(self, schema):
        doc = _valid_plan_review()
        doc["issues"][0]["extra_field"] = "not allowed"
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(doc, schema)


class TestSummaryProperty:
    def test_summary_missing(self, schema):
        doc = _valid_plan_review()
        del doc["summary"]
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(doc, schema)

    def test_summary_string_valid(self, schema):
        doc = _valid_plan_review()
        doc["summary"] = "All checks passed."
        jsonschema.validate(doc, schema)


class TestTopLevelAdditionalProperties:
    def test_extra_top_level_property_rejected(self, schema):
        doc = _valid_plan_review()
        doc["unexpected_field"] = "not allowed"
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(doc, schema)


class TestAllCategoriesAccepted:
    """Each valid category enum value should pass validation."""

    VALID_CATEGORIES = [
        "completeness", "feasibility", "test_strategy", "architecture",
        "decomposition", "risk", "security", "performance", "api_assumption",
    ]

    @pytest.mark.parametrize("category", VALID_CATEGORIES)
    def test_valid_category(self, schema, category):
        doc = _valid_plan_review()
        doc["issues"][0]["category"] = category
        jsonschema.validate(doc, schema)


class TestAllSeveritiesAccepted:
    """Each valid severity enum value should pass validation."""

    VALID_SEVERITIES = ["critical", "major", "minor", "suggestion"]

    @pytest.mark.parametrize("severity", VALID_SEVERITIES)
    def test_valid_severity(self, schema, severity):
        doc = _valid_plan_review()
        doc["issues"][0]["severity"] = severity
        jsonschema.validate(doc, schema)


class TestFullValidDocuments:
    def test_approve_with_minor_issues(self, schema):
        doc = {
            "outcome": "approve",
            "issues": [
                {
                    "category": "decomposition",
                    "severity": "suggestion",
                    "description": "Tasks could be split further",
                    "suggestion": "Split step 4 into two sub-tasks",
                    "evidence": "Step 4 touches both DB and API layer",
                },
                {
                    "category": "test_strategy",
                    "severity": "minor",
                    "description": "No mention of integration tests",
                },
            ],
            "summary": "Plan approved with minor suggestions.",
        }
        jsonschema.validate(doc, schema)

    def test_revise_with_critical_issue(self, schema):
        doc = {
            "outcome": "revise",
            "issues": [
                {
                    "category": "api_assumption",
                    "severity": "critical",
                    "description": "Uses deprecated API endpoint",
                    "suggestion": "Use v2 endpoint instead",
                    "evidence": "context7 docs show v1 is deprecated since 2024",
                },
                {
                    "category": "risk",
                    "severity": "major",
                    "description": "No rollback strategy for DB migration",
                },
            ],
            "summary": "Critical API assumption error must be addressed.",
        }
        jsonschema.validate(doc, schema)

    def test_approve_with_empty_issues(self, schema):
        doc = {
            "outcome": "approve",
            "issues": [],
            "summary": "Plan is complete and correct.",
        }
        jsonschema.validate(doc, schema)
