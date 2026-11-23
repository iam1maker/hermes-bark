---
name: bark-notify
description: Use when the user asks to be pinged on their phone, or a long task finishes while they are away. Sends Bark iOS push notifications.
---

# Bark notifications

Use the `bark_notify` tool. Do not shell out to `curl` — the tool resolves the
device alias, applies configured defaults, retries transport failures, and keeps
the device key out of the transcript.

## When to send

- The user explicitly asked to be notified ("ping my phone", "tell me when it's done").
- A job you started ran for a long time and the user is away. Send **once**, at the end.
- Something needs attention and the user is not watching this session.

Do **not** send a notification per turn, for routine confirmations, or to
summarize a conversation the user is actively reading.

## Parameters

| field | notes |
|---|---|
| `body` | required, under 3800 characters |
| `title` | short; defaults to the configured title |
| `device` | alias from config (`iphone`, `ipad`); omit for the default |
| `level` | `active` (default), `timeSensitive` (pierces Focus), `critical` (needs app permission), `passive` |
| `sound` | sound name |
| `group` | iOS notification threading |
| `image` | **public http(s) URL only** — Bark fetches it server-side; local files cannot be uploaded |
| `url` | opened when the notification is tapped |
| `ttl` | seconds the notification stays deliverable; `0` = no expiry |

## What the result means

`{"ok": true, "queued": true}` means the Bark server accepted the payload and
handed it to APNs. It does **not** mean the phone displayed it: the device may be
offline, the app may be killed, or Focus may have suppressed it. Say "sent" or
"queued", never "the user has seen it".

A failure returns `{"ok": false, "error": ..., "error_kind": ...}`. `error_kind`
is one of `bad_format`, `forbidden` (wrong/rotated key), `rate_limited`,
`transient`, `server`. Do not retry `forbidden` — the key is wrong.

## Images

Local files cannot ride along. If the user wants a screenshot on their phone,
either give it a public URL (`media.public_base_url` in config) or say so plainly
instead of pretending it was attached.
