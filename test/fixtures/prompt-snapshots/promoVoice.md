# Task: Promo: voice

Project directory (your cwd): <PROJECT_DIR>
Pipeline directory (shared artifacts): <PIPELINE_DIR>

Project and personal skills (.claude/skills in this project and ~/.claude/skills) are available via the Skill tool — invoke any that fit (e.g. design, framework-pattern, or knowledge-graph skills) rather than guessing conventions.

## Upstream input

Your input is the output of the preceding step(s); the file paths to read are named below.

## What to do

Identify the decisions you cannot safely resolve from the task text or the real codebase — including things a downstream agent would otherwise silently assume. For each, produce one conceptual question with 2 to 4 options and a free-text fallback. Ask only what materially changes the plan (up to 8 questions); never pad, and never split one decision. For low-impact details, pick a sensible default rather than asking. If you have no material open questions, write { "questions": [] } to that same path.

## Forms you may ask with

A `file` value is a path relative to your working directory or the pipeline dir. You will be resumed with {"form","version","values"}.

### `promo-voice` — Pick the narrator’s voice (version 1)

data you must supply:
```json
{
  "type": "object",
  "required": [
    "voices"
  ],
  "properties": {
    "headline": {
      "type": "string",
      "maxLength": 240
    },
    "voices": {
      "type": "array",
      "minItems": 1,
      "maxItems": 6,
      "items": {
        "type": "object",
        "required": [
          "id",
          "name"
        ],
        "properties": {
          "id": {
            "type": "string",
            "maxLength": 128
          },
          "name": {
            "type": "string",
            "maxLength": 120
          },
          "label": {
            "type": "string",
            "maxLength": 160
          },
          "gender": {
            "type": "string",
            "maxLength": 40
          },
          "accent": {
            "type": "string",
            "maxLength": 80
          },
          "description": {
            "type": "string",
            "maxLength": 400
          },
          "about": {
            "type": "string",
            "maxLength": 480
          },
          "preview": {
            "type": "file",
            "accept": [
              "audio/*"
            ]
          }
        }
      }
    },
    "defaultVoice": {
      "type": "string",
      "maxLength": 128
    },
    "preview1": {
      "type": "file",
      "accept": [
        "audio/*"
      ]
    },
    "preview2": {
      "type": "file",
      "accept": [
        "audio/*"
      ]
    },
    "preview3": {
      "type": "file",
      "accept": [
        "audio/*"
      ]
    },
    "preview4": {
      "type": "file",
      "accept": [
        "audio/*"
      ]
    },
    "preview5": {
      "type": "file",
      "accept": [
        "audio/*"
      ]
    },
    "preview6": {
      "type": "file",
      "accept": [
        "audio/*"
      ]
    }
  }
}
```

answer you will receive:
```json
{
  "type": "object",
  "required": [
    "voiceId"
  ],
  "properties": {
    "voiceId": {
      "type": "string",
      "maxLength": 128,
      "enumFrom": "data.voices[].id",
      "defaultFrom": "data.defaultVoice"
    }
  }
}
```

example data:
```json
{
  "headline": "2 female voices for narration. Play each one, then pick.",
  "voices": [
    {
      "id": "voice-a1",
      "name": "Ava",
      "label": "1 · Ava",
      "gender": "female",
      "accent": "american",
      "description": "warm, confident narrator",
      "about": "female · american — warm, confident narrator",
      "preview": "promo/voices/voice-a1.mp3"
    },
    {
      "id": "voice-b2",
      "name": "Bea",
      "label": "2 · Bea",
      "gender": "female",
      "accent": "british",
      "description": "bright and quick",
      "about": "female · british — bright and quick",
      "preview": "promo/voices/voice-b2.mp3"
    }
  ],
  "defaultVoice": "voice-a1",
  "preview1": "promo/voices/voice-a1.mp3",
  "preview2": "promo/voices/voice-b2.mp3"
}
```


Read the voices JSON. No voices: write {"questions":[]} to the answers path and stop (the video stays silent). Otherwise write {"form":"promo-voice","data":{…}} built from its rows, in order, with each preview in its slot (preview1…preview6), and stop.

## Ports (this run)

### Inputs

- **voices** (json) -> /abs/voices.json

### Outputs

- Write **answers** to: <PIPELINE_DIR>/promo-voice.json

MOCK_ROLE: clarify
MOCK_CYCLE: 2
MOCK_BASE: feature
MOCK_OUT: <PIPELINE_DIR>/promo-voice.json
MOCK_PRIOR: 0
MOCK_IN: /abs/voices.json
