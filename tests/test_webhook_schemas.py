"""
Tests for docs/spec/webhooks/schemas/ — validates JSON Schema (Draft 2020-12)
files that define the webhook event envelope and all event payloads.
"""
import json
from pathlib import Path

SCHEMAS_DIR = Path(__file__).parent.parent / "docs/spec/webhooks/schemas"

# All 15 required schema files (16 total - 1 envelope + 14 category + 1 control)
REQUIRED_SCHEMAS = [
    "envelope.schema.json",
    "pipeline.run.schema.json",
    "pipeline.stage.schema.json",
    "pipeline.agent.schema.json",
    "pipeline.bead.schema.json",
    "pipeline.git.schema.json",
    "pipeline.test.schema.json",
    "pipeline.review.schema.json",
    "pipeline.circuit_breaker.schema.json",
    "pipeline.cost.schema.json",
    "pipeline.milestone.schema.json",
    "pipeline.loop.schema.json",
    "pipeline.hook.schema.json",
    "pipeline.preflight.schema.json",
    "pipeline.learn.schema.json",
    "control-response.schema.json",
]

# Event types per category schema (for discriminator validation)
CATEGORY_EVENT_TYPES = {
    "pipeline.run.schema.json": [
        "pipeline.run.started",
        "pipeline.run.completed",
        "pipeline.run.failed",
        "pipeline.run.interrupted",
        "pipeline.run.resumed",
    ],
    "pipeline.stage.schema.json": [
        "pipeline.stage.started",
        "pipeline.stage.completed",
        "pipeline.stage.failed",
        "pipeline.stage.interrupted",
    ],
    "pipeline.agent.schema.json": [
        "pipeline.agent.spawned",
        "pipeline.agent.tool_use",
        "pipeline.agent.tool_result",
        "pipeline.agent.text",
        "pipeline.agent.completed",
    ],
    "pipeline.bead.schema.json": [
        "pipeline.bead.created",
        "pipeline.bead.assigned",
        "pipeline.bead.completed",
        "pipeline.bead.failed",
        "pipeline.bead.labeled",
        "pipeline.bead.next",
    ],
    "pipeline.git.schema.json": [
        "pipeline.git.branch_created",
        "pipeline.git.commit",
        "pipeline.git.pr_created",
        "pipeline.git.pr_merged",
    ],
    "pipeline.test.schema.json": [
        "pipeline.test.suite_started",
        "pipeline.test.suite_passed",
        "pipeline.test.suite_failed",
        "pipeline.test.fix_attempt",
    ],
    "pipeline.review.schema.json": [
        "pipeline.review.started",
        "pipeline.review.verdict",
        "pipeline.review.fix_attempt",
    ],
    "pipeline.circuit_breaker.schema.json": [
        "pipeline.circuit_breaker.failure_recorded",
        "pipeline.circuit_breaker.retry",
        "pipeline.circuit_breaker.tripped",
        "pipeline.circuit_breaker.reset",
    ],
    "pipeline.cost.schema.json": [
        "pipeline.cost.stage_total",
        "pipeline.cost.running_total",
        "pipeline.cost.budget_warning",
    ],
    "pipeline.milestone.schema.json": [
        "pipeline.milestone.set",
    ],
    "pipeline.loop.schema.json": [
        "pipeline.loop.triggered",
        "pipeline.loop.exhausted",
    ],
    "pipeline.hook.schema.json": [
        "pipeline.hook.blocked",
        "pipeline.hook.test_gate",
        "pipeline.hook.dispatch_blocked",
    ],
    "pipeline.preflight.schema.json": [
        "pipeline.preflight.completed",
        "pipeline.preflight.skipped",
    ],
    "pipeline.learn.schema.json": [
        "pipeline.learn.completed",
        "pipeline.learn.failed",
    ],
}

# Category schemas (all except envelope and control-response)
CATEGORY_SCHEMAS = [s for s in REQUIRED_SCHEMAS
                    if s not in ("envelope.schema.json", "control-response.schema.json")]


def load_schema(filename: str) -> dict:
    path = SCHEMAS_DIR / filename
    assert path.exists(), f"Schema file not found: {path}"
    return json.loads(path.read_text(encoding="utf-8"))


def test_schemas_directory_exists():
    """The schemas directory must exist."""
    assert SCHEMAS_DIR.exists(), f"Missing schemas directory: {SCHEMAS_DIR}"


def test_all_schema_files_exist():
    """All 16 required schema files must exist."""
    missing = [s for s in REQUIRED_SCHEMAS if not (SCHEMAS_DIR / s).exists()]
    assert not missing, f"Missing schema files: {missing}"


def test_all_schemas_are_valid_json():
    """Every schema file must be valid JSON."""
    for filename in REQUIRED_SCHEMAS:
        path = SCHEMAS_DIR / filename
        if not path.exists():
            continue
        try:
            json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            raise AssertionError(f"Invalid JSON in {filename}: {e}")


def test_all_schemas_declare_draft_2020_12():
    """Every schema must declare $schema as JSON Schema Draft 2020-12."""
    draft_uri = "https://json-schema.org/draft/2020-12/schema"
    for filename in REQUIRED_SCHEMAS:
        schema = load_schema(filename)
        assert "$schema" in schema, f"{filename}: missing $schema declaration"
        assert schema["$schema"] == draft_uri, (
            f"{filename}: expected $schema={draft_uri!r}, got {schema['$schema']!r}"
        )


def test_envelope_schema_has_required_fields():
    """The envelope schema must define all common envelope fields."""
    schema = load_schema("envelope.schema.json")
    required_fields = {"schema_version", "event_id", "event_type", "timestamp", "run_id", "pipeline", "payload"}
    props = set(schema.get("properties", {}).keys())
    missing = required_fields - props
    assert not missing, f"envelope.schema.json missing properties: {missing}"


def test_envelope_schema_has_required_constraint():
    """The envelope schema must list all required fields."""
    schema = load_schema("envelope.schema.json")
    required = set(schema.get("required", []))
    expected = {"schema_version", "event_id", "event_type", "timestamp", "run_id", "pipeline", "payload"}
    missing = expected - required
    assert not missing, f"envelope.schema.json missing from 'required': {missing}"


def test_category_schemas_use_oneof():
    """Every category schema must use oneOf for event type discrimination."""
    for filename in CATEGORY_SCHEMAS:
        schema = load_schema(filename)
        assert "oneOf" in schema or any(
            "oneOf" in v for v in schema.get("definitions", {}).values()
        ) or any(
            "oneOf" in v for v in schema.get("$defs", {}).values()
        ), f"{filename}: missing 'oneOf' discriminator"


def test_category_schemas_discriminate_on_event_type():
    """Each oneOf variant must use a const on event_type for discrimination."""
    for filename in CATEGORY_SCHEMAS:
        schema = load_schema(filename)
        one_of = schema.get("oneOf", [])
        if not one_of:
            continue
        for i, variant in enumerate(one_of):
            props = variant.get("properties", {})
            et = props.get("event_type", {})
            has_const = "const" in et or "enum" in et
            assert has_const, (
                f"{filename}: oneOf[{i}] missing const/enum discriminator on event_type"
            )


def test_category_schemas_cover_all_event_types():
    """Each category schema must cover all event types for that category."""
    for filename, expected_types in CATEGORY_EVENT_TYPES.items():
        schema = load_schema(filename)
        schema_str = json.dumps(schema)
        for event_type in expected_types:
            assert event_type in schema_str, (
                f"{filename}: missing event type '{event_type}'"
            )


def test_payload_objects_allow_additional_properties():
    """All payload object definitions must use additionalProperties: true."""
    for filename in REQUIRED_SCHEMAS:
        schema = load_schema(filename)
        one_of = schema.get("oneOf", [])
        for i, variant in enumerate(one_of):
            props = variant.get("properties", {})
            payload = props.get("payload", {})
            if payload.get("type") == "object" or "properties" in payload:
                ap = payload.get("additionalProperties", None)
                assert ap is True, (
                    f"{filename}: oneOf[{i}].properties.payload must have "
                    f"additionalProperties: true, got {ap!r}"
                )


def test_control_response_schema_has_control_field():
    """The control-response schema must define a 'control' field with action."""
    schema = load_schema("control-response.schema.json")
    props = schema.get("properties", {})
    assert "control" in props, "control-response.schema.json: missing 'control' property"
    control_props = props["control"].get("properties", {})
    assert "action" in control_props, (
        "control-response.schema.json: control object missing 'action' property"
    )


def test_control_response_schema_defines_all_actions():
    """The control-response schema must define all valid control actions."""
    schema = load_schema("control-response.schema.json")
    schema_str = json.dumps(schema)
    expected_actions = ["approve", "reject", "pause", "resume", "abort", "continue"]
    for action in expected_actions:
        assert action in schema_str, (
            f"control-response.schema.json: missing action '{action}'"
        )


def test_envelope_schema_has_schema_version_const():
    """The envelope schema must constrain schema_version to '1'."""
    schema = load_schema("envelope.schema.json")
    props = schema.get("properties", {})
    sv = props.get("schema_version", {})
    has_const = sv.get("const") == "1" or "1" in sv.get("enum", [])
    assert has_const, (
        "envelope.schema.json: schema_version must have const='1' or enum=['1']"
    )


def test_all_schemas_have_title():
    """Every schema should have a title for documentation clarity."""
    for filename in REQUIRED_SCHEMAS:
        schema = load_schema(filename)
        assert "title" in schema, f"{filename}: missing 'title' field"


def test_envelope_pipeline_object_has_branch():
    """The envelope pipeline object must define a 'branch' field."""
    schema = load_schema("envelope.schema.json")
    props = schema.get("properties", {})
    pipeline = props.get("pipeline", {})
    pipeline_props = pipeline.get("properties", {})
    assert "branch" in pipeline_props, (
        "envelope.schema.json: pipeline object missing 'branch' property"
    )
