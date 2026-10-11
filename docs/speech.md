# Voice mode for Ask Worca

Ask Worca can listen and talk back — hands-free. Out of the box it needs no
setup: **Whisper** (speech-to-text) and **Kokoro** (text-to-speech) run inside
your browser, and audio never leaves this computer. If you would rather use
speech servers **you run** (whisper.cpp, Kokoro-FastAPI, a hosted OpenAI-compatible
API), switch either side to *Your server*.

Worca never uses the browser's own Web Speech API (Chrome sends that audio to Google).

## Using it

- **Click the mic** in the Ask composer: speak once; the text lands in the box (not sent).
- **▾ menu → *Talk, read the replies*** (voice in, text out): worca listens, sends
  when you stop talking, shows the reply as text, then listens again — a
  conversation without typing and without the reply read aloud. No voice model is
  loaded for it.
- **Hold the mic** (or the ▾ menu → *Hands-free conversation*): worca listens,
  sends when you stop talking, reads the reply aloud sentence by sentence, then
  listens again. Talk over the reply to interrupt — playback and the running
  answer stop, and what you said becomes the next question.
- A slow answer is acknowledged so you know worca heard you: when it starts
  researching (a tool call) before saying anything, or after 4 s with nothing to
  say, it says a short phrase (*"Okay, let me look into that."*, *"Hmm, let me
  think."*, …). If worca writes a line before the tool call ("I'll check the
  runs."), that line is read instead. Quick answers are just read. The
  acknowledgement itself cannot be interrupted.
- An utterance ends after **1.2 s of silence**. Speak slowly or pause to think?
  Raise **Pause before sending** (Providers › Speech, 0.3–5 s) so you are
  not cut off mid-sentence; lower it for snappier turns.
- While worca is thinking or running tools, speech is ignored.
- Only prose is read: code blocks, tables, links and cards are skipped.
- The chip beside the mic shows the state: *Listening…*, *Transcribing…*,
  *Thinking…*, *Speaking…* or *Voice error*.
- Voice turns off when you close the panel, switch or start a chat, or on an error.
- The page must be a secure context: `https://…` or `http://localhost`. Over plain
  http on a LAN IP the browser refuses the microphone and worca says so.
- Text-to-speech *Off*? Hands-free still works; replies stay text only. If the
  voice fails mid-conversation, worca says so once and carries on text only.

## Built in: Whisper and Kokoro in the browser (the default)

Nothing to install. The first time you use the mic, worca downloads the speech
engine and models once (about 500 MB with WebGPU, 200 MB without) — the chip shows
*Downloading speech model… NN MB* — into `~/.worca-cc/speech-cache`. That is the only
copy: the browser keeps none, and later sessions load from worca in a few seconds.

- **Memory.** Loaded models take several hundred MB in the browser tab. They stay
  loaded between voice sessions and are released after 30 minutes with voice off
  (or when the page closes). Loading them again from disk takes a few seconds —
  the chip says *Starting voice…* (only a real first download says *Downloading*).
  Once you have used voice, opening the Ask panel preloads them in the background,
  so the mic is usually ready when you click it.
- **Disk.** Providers › Speech shows how much is downloaded and has
  *Remove speech models*. Voice keeps working — the next mic use downloads again.

| | Speech-to-text | Text-to-speech |
|---|---|---|
| Model | Whisper base (multilingual), `onnx-community/whisper-base` | Kokoro 82M, `onnx-community/Kokoro-82M-v1.0-ONNX` |
| With WebGPU (Chrome, Edge, Safari 26+) | ~150 MB, well under a second per sentence | ~325 MB, several times faster than real time |
| Without WebGPU (WASM) | ~80 MB, a few seconds per sentence | ~90 MB, about real time — expect pauses between sentences |

- The engines run in a Web Worker, so the page stays responsive.
- **Language** (Providers › Speech) steers Whisper; `auto` detects it.
- **Voice** picks a Kokoro voice: `af_heart` (default), `af_bella`, `bf_emma`,
  `am_michael`, … — American (`a…`) and British (`b…`) English only. Anything else
  (e.g. OpenAI's `alloy`) falls back to `af_heart`. **Speed** applies too.
- How Kokoro is driven: text → our English phonemizer (`src/shared/speech-g2p.mjs`:
  misaki's pronunciation dictionaries, its -s/-ed/-ing rules, number reading, and a
  rough letter-to-sound guess for words no dictionary knows, such as "worca") →
  Kokoro on transformers.js → 24 kHz audio. British voices use misaki's British
  dictionary, then the American one. We do **not** use kokoro-js: its bundle carries
  eSpeak NG, which is GPL-3.0 (see *Licences* below).
- Where the files come from: the transformers.js bundle and its onnxruntime-web
  runtime (jsDelivr, pinned npm version) and misaki's dictionaries (jsDelivr, pinned
  GitHub commit, ~12 MB for both accents) are checked against SHA-256 hashes; the
  models are pinned to a Hugging Face commit. Worca's server fetches them and the
  page loads them only from worca — never from a CDN. Nothing outside that
  allow-list is fetched. They are not npm dependencies on purpose: transformers.js's
  Node build would add hundreds of MB of native packages to every install for a
  browser-only feature.
- Offline, or behind a proxy that blocks those hosts? Point worca at a server instead.

## Languages

Listening works in ~99 languages (Whisper; set **Language** for anything but
English). The built-in voice speaks **English only** — for other languages set
text-to-speech to *Off* or use your own server. Details, known gaps and the plan
for more languages: [speech-languages.md](speech-languages.md).

## Your own server (optional)

### Speech-to-text: whisper.cpp

    git clone https://github.com/ggml-org/whisper.cpp && cd whisper.cpp
    cmake -B build && cmake --build build -j --config Release
    sh ./models/download-ggml-model.sh base      # or small / medium / large-v3-turbo
    ./build/bin/whisper-server -m models/ggml-base.bin --host 127.0.0.1 --port 8080 \
      --inference-path /v1/audio/transcriptions

`--inference-path` gives whisper-server the OpenAI path worca calls. Worca sends
16 kHz mono WAV, so `--convert`/ffmpeg are not needed. Multilingual models
(not `*.en`) are needed for languages other than English.

Any other server that answers `POST {baseUrl}/audio/transcriptions` the way
OpenAI does (multipart `file` + `model`, JSON `{ "text": … }` back) works too.

### Text-to-speech: Kokoro-FastAPI (or any OpenAI-compatible /audio/speech)

    docker run -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:latest

Base URL `http://127.0.0.1:8880/v1`, model `kokoro` or `tts-1`, voice e.g. `af_heart`.
Piper works through an OpenAI-compatible wrapper (e.g. openedai-speech).
Worca asks for `response_format: "wav"`.

### Pointing worca at them

Providers › **Speech (Ask Worca voice)** — set **Engine** to *Your server*
(the server fields show then; they stay saved when you switch back):

| Field | Speech-to-text | Text-to-speech |
|---|---|---|
| Engine | *In the browser* (default) or *Your server* | *In the browser* (default), *Your server* or *Off* |
| Base URL | default `http://127.0.0.1:8080/v1` | e.g. `http://127.0.0.1:8880/v1` |
| API key | optional — literal or `${VAR}`, stored masked | optional — literal or `${VAR}`, stored masked |
| Model | default `whisper-1` (whisper.cpp ignores it) | default `tts-1` |
| Language | `auto`, or an ISO 639 code such as `bg` | — |
| Pause before sending | seconds of silence that end what you said (any engine), default 1.2 | — |
| Voice | — | default `af_heart` (Kokoro-FastAPI); OpenAI wants e.g. `alloy` |
| Speed | — | 0.25–4, default 1 |

*Test speech-to-text* and *Test text-to-speech* try what is on screen, saved or
not. A test aimed at a different server than the saved one never sends the saved
key — type the key again to test it there. *Save* stores the card in
`~/.worca-cc/settings.json` under `providers.speech`; clearing a field puts its
default back.

## Licences

Everything the built-in engines download is under a permissive licence:

| Component | Licence |
|---|---|
| Whisper base (OpenAI weights, `onnx-community` conversion) | Apache-2.0 |
| Kokoro 82M v1.0 (hexgrad weights, `onnx-community` conversion) | Apache-2.0 |
| misaki pronunciation dictionaries (hexgrad/misaki) | Apache-2.0 (repository licence) |
| transformers.js 3.8.1 | Apache-2.0 |
| onnxruntime-web | MIT |
| Silero VAD v5, @ricky0123/vad-web (installed with worca) | MIT, ISC |

`src/shared/speech-g2p.mjs` follows misaki's English G2P (Apache-2.0) and says so.
No GPL code is downloaded: kokoro-js was dropped because its `phonemizer` package
bundles eSpeak NG (GPL-3.0) while being labelled Apache-2.0. Keep it that way —
anything added to `SPEECH_LIBS` / `SPEECH_MODELS` (src/core/speech-assets.mjs) needs
its licence checked, including what it bundles.

## How it works / privacy

Browser: Silero VAD (@ricky0123/vad-web + onnxruntime-web, served by worca from its
own install — no CDN, loaded only when you first use the mic) finds each utterance.

- Built in: utterance → Whisper in a Web Worker → text. Reply text → sentences →
  Kokoro in the worker → audio. Nothing leaves the browser; worca only serves the
  files (`/vendor/speech/*`).
- Your server: utterance → WAV → `POST /api/speech/transcribe` → your STT. Reply
  text → sentences → `POST /api/speech/synthesize` → your TTS → audio. Keys never
  reach the browser. With the credential broker on, worca stores no speech keys
  (use keyless local servers).

The speech routes sit behind the same loopback and identity checks as every other
Ask route. An utterance may be up to 25 MB (about 13 minutes of audio).
