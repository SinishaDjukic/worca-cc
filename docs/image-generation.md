# Image generation (Design pictures)

A Design lead can have a picture made when no real one fits: a scene, a mood, a
texture. worca's server makes the call to the image service you set up; agents
never see the key. Pictures are off until the service is set up.

## Set it up

Providers › **Image generation (Design)**. Pick a **Service**: it fills
**Base URL**, **Model** and **Price per picture ($)**. Add the **API key**, then
*Save*.

| Service | Base URL | Path | Model | Shape sent as | Also sent | Price filled in ($) |
|---|---|---|---|---|---|---|
| OpenAI | `https://api.openai.com/v1` | `/images/generations` | `gpt-image-2.6-flare` | `size` | `quality: "medium"` | 0.04 |
| xAI | `https://api.x.ai/v1` | `/images/generations` | `grok-imagine-image-2.0` | `aspect_ratio` | `response_format: "b64_json"` | 0.04 |
| OpenRouter | `https://openrouter.ai/api/v1` | `/images` | none: type one | `size` | — | 0.05 |
| Other (OpenAI-compatible) | none: type one | `/images/generations` | none: type one | `size` | — | none: type one |

- A shape goes out as `size` `1536x1024` (wide), `1024x1536` (tall) or
  `1024x1024` (square), or as `aspect_ratio` `3:2`, `2:3` or `1:1`.
- The path and what is sent follow the Service you pick, not the address.
- *Other (OpenAI-compatible)* takes any server that answers
  `POST <base URL>/images/generations` the way OpenAI does.
- Azure's `api-key` header is not supported: worca sends
  `Authorization: Bearer <key>`, so reach Azure through a gateway.

## Price per picture

Required: *Save* refuses the row without one (*Enter a price; 0 for a free
server*). Enter `0` for a free server. When the service's answer states its own
cost (`usage.cost`, as OpenRouter's does), worca books that instead. OpenAI
bills by token, so there the booked figure is the price you typed, not the exact
bill. Each picture is booked to its round and counts toward worca's limits as an
agent's dollars do.

## The key

*Save* stores the row in `~/.worca-cc/settings.json` under `providers.images`.
The key is a literal, shown masked, or a `${VAR}` that worca reads from its own
environment, shown as written. It is sent only to the saved address's origin
(scheme, host and port): saving an address on another origin without a new key
drops the old one. A server on this machine or a private network needs no key:
leave the field empty.

A *Test picture* aimed at an address on another origin never carries the saved
key. A `${VAR}` typed for a Test is read only for the picked service's own
address, for this machine's own (`localhost`, `127.x`, `[::1]`), or when it is
the saved `${VAR}` itself at the saved address; anywhere else, and always with
the credential broker on, the Test answers *Save the row before testing a key
kept in a variable*. Saving an address without a key opens nothing. A `${VAR}`
you save is read for the saved address, as every provider's saved key is:
whoever saves the row decides where that variable's value is sent.

worca never hands the key to an agent: not in its task, its environment or its
files. On your own machine an agent's shell can still read the settings file, as
it can for every provider key today.

With the [credential broker](credential-broker.md) on, worca stores no image
key: *Save* refuses one, the key field is hidden, worca will not start while an
old `providers.images.apiKey` is left in the settings file, and the broker has no
image key slot in this version, so only a server that needs no key works.

## Test picture

*Test picture* makes one real picture (a square one) from what is on the row,
saved or not, so it costs one picture. worca books that cost nowhere.

## Mock mode

With `WORCA_MOCK=1` no call is made: the picture is one flat colour, 384×256
(wide), 256×384 (tall) or 256×256 (square).
