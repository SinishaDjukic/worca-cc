# Task: C4: setup

Project directory (your cwd): <PROJECT_DIR>
Pipeline directory (shared artifacts): <PIPELINE_DIR>

Project and personal skills (.claude/skills in this project and ~/.claude/skills) are available via the Skill tool — invoke any that fit (e.g. design, framework-pattern, or knowledge-graph skills) rather than guessing conventions.

## Upstream input

Your input is the output of the preceding step(s); the file paths to read are named below.

## What to do

Identify the decisions you cannot safely resolve from the task text or the real codebase — including things a downstream agent would otherwise silently assume. For each, produce one conceptual question with 2 to 4 options and a free-text fallback. Ask only what materially changes the plan (up to 8 questions); never pad, and never split one decision. For low-impact details, pick a sensible default rather than asking. If you have no material open questions, write { "questions": [] } to that same path.

## Forms you may ask with

A `file` value is a path relative to your working directory or the pipeline dir. You will be resumed with {"form","version","values"}.

### `c4-setup` — Architecture (C4): which file, which bands? (version 1)

data you must supply:
```json
{
  "type": "object",
  "properties": {
    "files": {
      "type": "array",
      "maxItems": 40,
      "items": {
        "type": "object",
        "required": [
          "id",
          "path"
        ],
        "properties": {
          "id": {
            "type": "string",
            "maxLength": 300
          },
          "path": {
            "type": "string",
            "maxLength": 300
          },
          "project": {
            "type": "string",
            "maxLength": 120
          },
          "views": {
            "type": "string",
            "maxLength": 400
          },
          "bands": {
            "type": "string",
            "maxLength": 400
          },
          "status": {
            "type": "string",
            "maxLength": 120
          }
        }
      }
    },
    "summary": {
      "type": "string",
      "maxLength": 2000
    },
    "defaultTarget": {
      "type": "string",
      "enum": [
        "Update a found file",
        "Create a new file"
      ]
    },
    "projects": {
      "type": "array",
      "maxItems": 40,
      "items": {
        "type": "object",
        "required": [
          "id"
        ],
        "properties": {
          "id": {
            "type": "string",
            "maxLength": 120
          },
          "name": {
            "type": "string",
            "maxLength": 120
          }
        }
      }
    },
    "defaultProject": {
      "type": "string",
      "maxLength": 120
    },
    "defaultFile": {
      "type": "string",
      "maxLength": 300
    }
  }
}
```

answer you will receive:
```json
{
  "type": "object",
  "required": [
    "target"
  ],
  "properties": {
    "target": {
      "type": "string",
      "enum": [
        "Update a found file",
        "Create a new file"
      ],
      "defaultFrom": "data.defaultTarget",
      "default": "Create a new file"
    },
    "file": {
      "type": "string",
      "maxLength": 300,
      "defaultFrom": "data.defaultFile"
    },
    "newPath": {
      "type": "string",
      "maxLength": 300,
      "default": "docs/architecture/architecture.c4"
    },
    "scope": {
      "type": "string",
      "enum": [
        "Whole project",
        "Only what the task names"
      ],
      "default": "Whole project"
    },
    "bandsPreset": {
      "type": "string",
      "enum": [
        "Standard: People · Clients · Host · External",
        "Deployment: You · Host · Services · Data · Models",
        "No bands (element views only)",
        "My own (below)"
      ],
      "default": "Standard: People · Clients · Host · External"
    },
    "bands": {
      "type": "string",
      "maxLength": 6000
    },
    "notes": {
      "type": "string",
      "maxLength": 2000
    },
    "exports": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": [
          "SVG",
          "JPEG",
          "PNG"
        ]
      },
      "default": [
        "SVG",
        "JPEG"
      ]
    },
    "exportViews": {
      "type": "string",
      "enum": [
        "All views",
        "Deployment sheet only"
      ],
      "default": "All views"
    },
    "imagesTo": {
      "type": "string",
      "enum": [
        "Beside the file (committed)",
        "Run artifacts only"
      ],
      "default": "Beside the file (committed)"
    },
    "newProject": {
      "type": "string",
      "enumFrom": "data.projects[].id",
      "defaultFrom": "data.defaultProject"
    }
  }
}
```

example data:
```json
{
  "summary": "Two C4 files found. Pick one to update, or create a new one.",
  "files": [
    {
      "id": "docs/architecture.c4",
      "path": "docs/architecture.c4",
      "project": "worca-cc",
      "views": "14 views",
      "bands": "You · Worca host · Models",
      "status": "parses"
    }
  ],
  "defaultTarget": "Update a found file",
  "projects": [
    {
      "id": "worca-cc",
      "name": "worca-cc"
    }
  ],
  "defaultProject": "worca-cc",
  "defaultFile": "docs/architecture.c4"
}
```


Copy the formData object from the discovery JSON (the found input) verbatim into {"form":"c4-setup","data":<formData>}, write it to the answers path and stop.

## Ports (this run)

### Inputs

- **task** (md) -> /abs/task.md
- **found** (json) -> /abs/found.json

### Outputs

- Write **answers** to: <PIPELINE_DIR>/c4-setup.json

MOCK_ROLE: clarify
MOCK_CYCLE: 2
MOCK_BASE: feature
MOCK_OUT: <PIPELINE_DIR>/c4-setup.json
MOCK_PRIOR: 0
MOCK_IN: /abs/task.md
