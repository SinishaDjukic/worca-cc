# Task: Promo: setup

Project directory (your cwd): <PROJECT_DIR>
Pipeline directory (shared artifacts): <PIPELINE_DIR>

Project and personal skills (.claude/skills in this project and ~/.claude/skills) are available via the Skill tool — invoke any that fit (e.g. design, framework-pattern, or knowledge-graph skills) rather than guessing conventions.

## Upstream input

Your input is the output of the preceding step(s); the file paths to read are named below.

## What to do

Identify the decisions you cannot safely resolve from the task text or the real codebase — including things a downstream agent would otherwise silently assume. For each, produce one conceptual question with 2 to 4 options and a free-text fallback. Ask only what materially changes the plan (up to 8 questions); never pad, and never split one decision. For low-impact details, pick a sensible default rather than asking. If you have no material open questions, write { "questions": [] } to that same path.

## Forms you may ask with

A `file` value is a path relative to your working directory or the pipeline dir. You will be resumed with {"form","version","values"}.

### `promo-setup` — Promo video: tone, length and sound (version 1)

data you must supply:
```json
{
  "type": "object",
  "properties": {
    "images": {
      "type": "array",
      "maxItems": 12,
      "items": {
        "type": "object",
        "required": [
          "id",
          "file"
        ],
        "properties": {
          "id": {
            "type": "string",
            "maxLength": 300
          },
          "file": {
            "type": "file",
            "accept": [
              "image/*"
            ]
          },
          "name": {
            "type": "string",
            "maxLength": 200
          }
        }
      }
    },
    "defaultImage": {
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
    "tone",
    "length",
    "pace",
    "audio"
  ],
  "properties": {
    "tone": {
      "type": "string",
      "enum": [
        "Playful",
        "Professional",
        "Bold",
        "Calm"
      ],
      "default": "Playful"
    },
    "length": {
      "type": "string",
      "enum": [
        "30 s",
        "60 s",
        "90 s",
        "2.5 min"
      ],
      "default": "60 s"
    },
    "pace": {
      "type": "string",
      "enum": [
        "Relaxed",
        "Lively",
        "Fast"
      ],
      "default": "Lively"
    },
    "mascots": {
      "type": "boolean",
      "default": true
    },
    "mascotSource": {
      "type": "string",
      "enum": [
        "Design one for me",
        "Use my attached image"
      ],
      "default": "Design one for me"
    },
    "mascotImage": {
      "type": "string",
      "maxLength": 300,
      "enumFrom": "data.images[].id",
      "defaultFrom": "data.defaultImage"
    },
    "mascotAmount": {
      "type": "integer",
      "minimum": 0,
      "maximum": 100,
      "default": 40
    },
    "audio": {
      "type": "string",
      "enum": [
        "Narrated (ElevenLabs)",
        "Silent video"
      ],
      "default": "Silent video"
    },
    "apiKey": {
      "type": "string",
      "maxLength": 256
    },
    "voiceGender": {
      "type": "string",
      "enum": [
        "Female",
        "Male",
        "Either"
      ],
      "default": "Either"
    },
    "music": {
      "type": "boolean",
      "default": true
    }
  }
}
```

example data:
```json
{
  "images": [
    {
      "id": "extras/mascot.png",
      "file": "extras/mascot.png",
      "name": "mascot.png"
    }
  ],
  "defaultImage": "extras/mascot.png"
}
```


List the image attachments from the task's "## Attached files" section as data.images (id and file "extras/<file name>", relative to the pipeline directory), write {"form":"promo-setup","data":{"images":[…]}} to the answers path and stop. Never ask for, read or write the ElevenLabs key: the engine resolves it.

## Ports (this run)

### Inputs

- **task** (md) -> /abs/task.md

### Outputs

- Write **answers** to: <PIPELINE_DIR>/promo-setup.json

MOCK_ROLE: clarify
MOCK_CYCLE: 2
MOCK_BASE: feature
MOCK_OUT: <PIPELINE_DIR>/promo-setup.json
MOCK_PRIOR: 0
MOCK_IN: /abs/task.md
