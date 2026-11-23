# hermes-bark

Bark iOS push notifications as a **send-only** delivery platform for
[Hermes Agent](https://hermes-agent.nousresearch.com). One-way by design: Bark
has no inbound stream, no reply channel, and a server `200` means *queued to
APNs*, not *seen on the phone*.

Plugin id: `hermes-bark` · kind: `platform` · requires Hermes `>=0.23.0`

## What you get

| Surface | Use |
|---|---|
| `cron` → `--deliver bark` | job results land on your phone, no model call spent |
| `hermes send --to bark[:device]` | shell / scripts / agent CLI |
| `bark_notify` tool | the agent pushes a link, image URL or delivery notice mid-turn |
| hooks `on_session_end` / `subagent_stop` | optional, off by default — failure/interruption alerts only |
| Desktop page (`Bark notifications`) | channel status, device map, notification rules, test push, delivery log |

Multi-device aliases, Bark fields `level / sound / group / ttl / url / image /
icon / autoCopy / isArchive / id`, retry with never-left-the-process-only
semantics, and profile-scoped secret reads.

## Install

```bash
hermes plugins install hermes-bark     # once listed in the catalog
# or, from a checkout:
cp -R . ~/.hermes/profiles/<profile>/plugins/hermes-bark
hermes plugins enable hermes-bark
```

Set the device key through Hermes — Dashboard → Secret on the plugin page, or
`hermes config set`:

```dotenv
BARK_TOKEN=<device key from the Bark app>     # alias "default"
BARK_KEY_IPHONE=<key>                          # extra device, alias "iphone"
BARK_SERVER=https://api.day.app                # optional, self-hosted is fine
BARK_HOME_CHANNEL=default                      # cron / `--to bark` target
```

Device keys are **routed by Hermes**, never read from disk by this plugin: a read
goes through `agent.secret_scope.get_secret`, i.e. the profile's
secret scope (with a process-env fallback in CLI contexts). That is also why a
key saved on the page is usable immediately. `config.yaml` never holds a key;
non-secret defaults (`server`, `level`, `group`, `ttl`, notification rules, …)
live in `plugins.entries.hermes-bark.settings` and are editable both in the
native Settings form and on the plugin page.

**Desktop half.** This package ships `desktop/plugin.js`. A package-managed
desktop half is opt-in: after install, enable the *Desktop* switch for the
plugin under Settings → Capabilities → Plugins (the renderer trusts plugin code
with the app's authority, so it asks once). The page then appears in the sidebar
and at `hermes://open/bark`.

## Behaviour notes

- **One-way.** Nothing is ever received. `send_image()` accepts an `http(s)`
  URL only — Bark fetches the image server-side, so a local file cannot be
  delivered (it is reported as `media_skipped`, not as a failure).
- **3800-character body cap**; longer text is reported, not silently dropped.
- **Retries** cover "the request never left" (connect/DNS/proxy), `429` and
  `5xx`. A read timeout is *not* retried — the payload may already be queued.
- **Automatic pushes are off by default.** When enabled they fire only for the
  statuses you list (default `failed,interrupted`), never for a short successful
  turn, at most once per session per 60 s, and never inside your quiet hours.
  Hooks are for incidents; delivery receipts belong to explicit sends.
- **Proxy.** `proxy: ""` follows `HTTPS_PROXY`; `direct` forces a direct
  connection; a URL pins the proxy. A dead environment proxy that points at
  loopback is retried once directly (`proxy_fallback: true`).
- **Dedupe** sets Bark's `id` field for a 5 s window so a retry or a hook racing
  `hermes send` does not double-buzz. Bark needs app ≥ 1.5.2 for `id`.

## Disclosure

- Outbound HTTPS to your Bark server only: `https://api.day.app` by default, or
  whatever `BARK_SERVER` points at. Notification titles/bodies, plus any `url`
  and `image` URL you pass, are sent there and reach APNs through it. If you
  self-host, that server sees them.
- No telemetry, no analytics, no self-updater, no outbound calls anywhere else.
- Secrets are read via Hermes (`agent.secret_scope.get_secret` →
  `agent.secret_scope`); the plugin never parses `.env` itself, and a routed
  profile never borrows another profile's key.
- Delivery records (last 400 attempts, 250 kept) are written locally to
  `<hermes home>/plugin-data/hermes-bark/deliveries.jsonl`.
- The desktop page calls only the plugin's own routes under
  `/api/plugins/hermes-bark/`.
- UI copy: English is the source language; the Chinese bundle is a data file
  (`dashboard/locales/zh.json`) the backend ships to the page, so the same
  strings serve the API messages and the rendered page. Contribution labels
  (sidebar, palette) are English — the host registers them before the first
  snapshot arrives.

## Development

```bash
python tests/test_bark.py             # 36 client/settings/notify tests, no network
python tests/test_dashboard_api.py    # 14 router tests against a fake bark-server
node  tests/render_page.mjs --locale=en   # renders plugin.js headless, asserts no CJK leak
node  tests/render_page.mjs --locale=zh   # same page with the Chinese bundle
HERMES_SRC=~/path/to/hermes-agent python tests/e2e_adapter_contract.py
python scripts/serve-local.py --port 18123   # same router, own process, no gateway restart
```

`tests/fake_bark.py` is a bark-server stand-in that records JSON payloads and can
return `500`/`429`/slow responses on demand.

## License

MIT — see `LICENSE`.
