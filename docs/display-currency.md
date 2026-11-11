# Display currency

Worca shows AI costs in US dollars by default. In Settings you can pick another currency to show them in: USD, BRL, EUR, GBP, CAD, AUD, JPY, MXN, INR or CHF.

Only the display changes. Costs, budgets, limits and caps are stored and computed in USD, budget and limit inputs still take USD, and exports and API payloads stay in USD.

## When Worca calls the network

Only when you pick a currency other than USD. The server then asks for one rate (units per 1 USD):

1. `api.frankfurter.dev` (European Central Bank data), then, if that fails,
2. `open.er-api.com`.

Each gets 5 seconds, so a change takes at most about 10 seconds. Neither needs a key. Worca never fetches a rate at start, on a page load, or in the background. The rate you got stays until you pick a currency again. Picking the same currency again fetches a fresh rate.

If every provider fails, nothing changes: the previous currency stays and Settings shows an error. Going back to USD never calls the network.

The fetch goes through the proxy Worca is configured with. With an egress allowlist (`WORCA_EGRESS_ALLOW`, see [remote-access.md](remote-access.md)), allow both hosts: `api.frankfurter.dev` and `open.er-api.com`.

## Stored value

`settings.json` holds one `displayCurrency` object; USD is the absent key:

```json
"displayCurrency": { "currency": "BRL", "rate": 5.42, "rateDate": "2026-11-10", "rateAt": "2026-11-11T13:05:00.000Z", "source": "frankfurter" }
```

`rateDate` is the date the provider gives for the rate (the ECB publishes none on weekends, so Saturday shows Friday's). `rateAt` is when Worca fetched it. A value Worca cannot read in full counts as USD, with one warning in the server log.

The shell is served with `<html data-currency="BRL" data-currency-rate="5.42">`, so costs paint in the right currency from the first frame.

## API

| Route | What it does |
|---|---|
| `GET /api/settings/display-currency` | The stored object. Never calls the network. `GET /api/settings` carries the same object as `displayCurrency`. |
| `POST /api/settings/display-currency` `{ "currency": "BRL" }` | Fetches the rate (not for USD), stores it and answers the new object. Other open tabs get a `settings-changed` frame. |

Errors are `{ error, code }`, and the message never includes a provider URL:

| Status | `code` | When |
|---|---|---|
| 400 | `BAD_CURRENCY` (with `field: "currency"`) | Not one of the codes above (exact, upper case). |
| 403 | `ACTIONS_AGENT_BLOCKED` | A caller on this machine without the instance token while agent isolation is on. |
| 429 | `RATE_LIMITED` | More than 10 changes to a non-USD currency in a minute. |
| 502 | `RATE_UNAVAILABLE` | No provider gave a valid rate. Nothing was changed. |
| 500 | `SAVE_FAILED` | `settings.json` could not be written. Nothing was changed. |

POSTs are served one at a time, in the order they arrive. `POST /api/settings` refuses a `displayCurrency` key with a 400.

## Testing

`WORCA_FX_URLS` replaces the providers, for tests and manual review only: comma-separated `http(s)` URLs, with `{code}` for the currency. The first is labelled `frankfurter`, the rest `open-er-api`. A fake can answer in either shape: `{"date":"2026-11-10","rates":{"BRL":5.42}}` or `{"result":"success","time_last_update_unix":1762732800,"rates":{"BRL":5.42}}`.

Under `WORCA_MOCK=1` or `node:test`, without `WORCA_FX_URLS`, Worca never calls the network: a non-USD change answers 502. Server tests can also swap the fetcher with `_testing.setFxFetcher(fn)` and refill the rate bucket with `_testing.resetFxBucket(perMinute)`.
