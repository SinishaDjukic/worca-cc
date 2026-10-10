# Voice mode: languages — where we are and how to expand

Status and plan for languages other than English in Ask Worca's voice mode
([speech.md](speech.md)). **Nothing in the "Plan" section is implemented yet.**
Bulgarian is the intended first test language, but it is explicitly out of scope
for now.

## Today

| | Built-in engine (browser, the default) | Your own server |
|---|---|---|
| Speech-to-text | Whisper base, multilingual (~99 languages). **Language** (`auto` or an ISO 639 code) is passed to Whisper. | Whatever the server supports (e.g. whisper.cpp with a large multilingual model). |
| Text-to-speech | Kokoro with worca's own English phonemizer (misaki's dictionaries): **English only** (American `a…` and British `b…` voices). Other languages come out as English-sounding gibberish. | Whatever the server's voices support (Kokoro-FastAPI: also es, fr, it, pt, ja, zh, hi; Piper-based servers: ~55 languages). |

Practical consequences:

- English works end to end in the browser.
- Another language can be **spoken to** worca (set **Language** explicitly — `auto`
  misdetects short phrases), but with the built-in voice, set text-to-speech to
  *Off* or point it at a server that has the language.
- Whisper **base** is accurate for English and large European languages and
  noticeably weaker for smaller ones (Bulgarian, for example).
- The **Voice** setting is one fixed voice; it does not follow the language.
- Sentence splitting (`createSpeechChunker`, `src/shared/speech.mjs`) only ends a
  sentence at `. ! ? …` followed by whitespace. Languages that end sentences with
  `。！？` or `।` and put no space after them are only split by the 280-character
  fallback, and that fallback cuts at the last space — text with no spaces at all
  (Chinese, Japanese) comes out as single-character pieces (checked: a Chinese
  reply split into "今", "天", "的", …). Must be fixed before any of those
  languages is voiced. Cyrillic and other space-separated scripts split correctly.

## Plan

Four independent pieces; each can ship alone. The order below is the suggested one.

### 1. Sentence splitting for every script

`src/shared/speech.mjs`

- Add `。！？｡` and `।॥` to the sentence-end set, with the trailing whitespace made
  optional for them (CJK sentences are not followed by a space).
- The long-text fallback: when there is no space to cut at, cut at a hard
  `maxChars` boundary instead of emitting one character (fixes the current bug for
  space-less scripts on its own).
- The abbreviation list (`ABBREV_RE`) is English; keep it, it is harmless elsewhere.
- Tests: `test/speech-text.test.mjs` with Chinese, Japanese, Hindi and Cyrillic samples.

### 2. A better listening model (optional size setting)

Add **Model** to the built-in speech-to-text engine: *base* (today), *small*,
*large-v3-turbo*. All three are ONNX repos under `onnx-community/` that
transformers.js loads the same way; only the allow-list and the worker's model id
change.

| Model | Download (WebGPU: fp32 or fp16 encoder + q4 decoder) | Download (WASM: q8) | Notes |
|---|---|---|---|
| whisper-base (today) | ~200 MB | ~75 MB | fast; weak on smaller languages |
| whisper-small | ~410–590 MB | ~250 MB | clearly better multilingual accuracy |
| whisper-large-v3-turbo | ~1.6 GB+ | ~1.1 GB | best accuracy; WebGPU only in practice |

Sizes are from the Hugging Face file listings; speed has **not** been measured and
must be before choosing defaults (the fp16 encoder in particular — fp16 Kokoro was
garbled on WebGPU, see speech.md, so fp16 Whisper needs the same round-trip check).

Touches: `SPEECH_MODELS` / `SPEECH_ENGINE_MODELS` in `src/core/speech-assets.mjs`
(pin each repo to a commit), `ui/public/speech-worker.mjs` (model id and dtype per
choice), the settings field (`src/core/settings.mjs`, `ui/public/bridge-view.mjs`),
`downloaded()` per chosen model.

### 3. Piper: a voice for ~55 languages in the browser

Kokoro stays the English voice (best quality). Every other language uses **Piper**
(VITS models from `rhasspy/piper-voices`: 177 voices; e.g. Bulgarian has one,
`bg_BG-dimitar-medium`, 63 MB — the median voice is about the same size).

Why Piper: broad language coverage, one small model per voice downloaded only when
that language is used, and fast enough on plain WASM (no WebGPU needed).

What it takes:

- **Licensing — the blocker to solve first.** Piper voices are trained on eSpeak NG
  phonemes, and every Piper runtime (piper-phonemize, the `phonemizer` package, the
  browser ports) turns text into phonemes with eSpeak NG, which is **GPL-3.0**.
  Worca deliberately downloads no GPL code (speech.md, *Licences*; the reason
  kokoro-js was dropped). So Piper in the browser needs one of: a legal review that
  clears downloading eSpeak NG on the user's machine; a non-GPL phonemizer per
  language that reproduces eSpeak's phoneme output well enough (dictionary +
  rules, as done for English — a real effort per language); or leaving other
  languages to *Your server* and the OS voices (see below).
- **Runtime.** Past that: the ONNX part runs on the onnxruntime-web build already
  served for Whisper/Kokoro; the phonemizer comes from whichever option above wins.
  Decide by a spike, not up front.
- **Assets.** Allow-list `rhasspy/piper-voices` pinned to a commit in
  `SPEECH_MODELS`; the per-voice `.onnx` and `.onnx.json` (phoneme map, sample rate)
  come through the same `/vendor/speech/hf/…` cache.
- **Worker.** A third engine in `speech-worker.mjs` (`?kind=piper`): load one voice,
  `speak(text)` → Float32 audio + rate, same protocol as Kokoro, so `ask-voice.mjs`
  plays it unchanged.
- **Voice catalogue.** A small table (language code → default Piper voice), generated
  from the pinned repo listing, shipped with the UI.
- **Verify every language added** with the Kokoro → Whisper round trip used for
  English (speak known sentences, transcribe, compare), not by ear alone.

### Alternative to Piper: the operating system's voices

The browser's `speechSynthesis`, restricted to on-device voices (`localService`),
needs no download and no licence decision, and speaks many languages (macOS ships
a Bulgarian voice, for one). Unknowns to test first: quality varies by OS (Linux
often has only robotic voices), and the audio plays through the OS rather than the
page, so the voice detector might hear the reply and treat it as barge-in (the
browser's echo cancellation may not cover it). A sensible shape: OS voice for a
language Kokoro cannot speak, Kokoro for English.

### 4. Pick the voice from the language

- **Language** set (e.g. `bg`): replies are spoken with that language's voice —
  Kokoro for `en`, Piper otherwise; no voice for the language → text only, with a
  one-time notice (the existing text-only fallback).
- **Language** `auto`: use the language Whisper detected for the question (the
  model answers in the language it was asked in). transformers.js can return it
  with the transcript; the worker passes it back and the controller keeps it per turn.
- The **Voice** setting becomes "voice per language" (a select grouped by
  language), with sensible defaults so it can be left alone.
- Preload (`preload()` in `ask-voice.mjs`) warms the voice for the configured
  language only; other languages load on first use.

## Cost to keep in mind

- Disk: each extra language adds one Piper voice (~20–60 MB); a larger Whisper adds
  hundreds of MB to over a GB. Everything stays in `~/.worca-cc/speech-cache`, shown
  and removable in Providers › Speech.
- Memory: a Piper voice is far smaller than Kokoro fp32; a larger Whisper is the
  main memory cost.
- Nothing changes for users who do not use voice: all of it downloads on first use.

## Out of scope for now

- Implementing any of the above, Bulgarian included.
- Cloud speech APIs as built-ins (a hosted OpenAI-compatible endpoint already works
  through *Your server*).
