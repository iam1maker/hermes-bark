/**
 * hermes-bark — the desktop settings page for Bark notifications.
 *
 * The backend lives in profiles/<profile>/plugins/hermes-bark/dashboard/plugin_api.py;
 * this file only renders and handles input; all data goes through ctx.rest to
 * /api/plugins/hermes-bark/*.
 *
 * Two hard constraints (from hermes-desktop-plugin-ui):
 *   - The file is not compiled: no JSX. Everything goes through the thin h/hs
 *     wrappers over jsx/jsxs.
 *   - Tailwind arbitrary-value classes silently do nothing; layout, type sizes
 *     and colours are inline styles over theme variables.
 *
 * Design intent: keys are shown masked only and are written through Hermes'
 * credential surface (the plugin never reads .env); a test push is
 * preview-then-send, never a blind send; removing a device asks twice.
 */

import { useEffect, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import * as SDK from '@hermes/plugin-sdk'

const { host } = SDK

const h = (type, props, ...kids) => {
  const p = props || {}
  if (!kids.length) return jsx(type, p)
  return jsx(type, { ...p, children: kids.length === 1 ? kids[0] : kids })
}
const hs = (type, props, ...kids) => {
  const p = props || {}
  if (!kids.length) return jsxs(type, p)
  return jsxs(type, { ...p, children: kids.length === 1 ? kids[0] : kids })
}

const ID = 'hermes-bark'
const ROUTE = '/bark'

/* UI copy: English is the source language. ``STR`` holds the bundle the backend
   ships in ``/status.strings`` (English source -> host language); a key it does
   not carry renders exactly as written. Contribution labels (nav, palette, page
   title) are registered before the first snapshot arrives, so they stay English. */
let STR = {}
let T = key => (Object.prototype.hasOwnProperty.call(STR, key) ? STR[key] : key)

/** Translate one UI string; every user-visible label goes through this. */
function t(key) {
  return T(key)
}

const useBarkT = () => T

/** Language probe for the ``?lang=`` parameter: read the host's <html lang>. */
function isChinese() {
  try {
    return /^zh/i.test(document.documentElement.lang || '')
  } catch {
    return true
  }
}

/* ── Theme colours: desktop CSS variables only, never hard-coded ───────── */

const C = {
  fg: 'var(--ui-text-primary)',
  fg2: 'var(--ui-text-secondary)',
  fg3: 'var(--ui-text-tertiary)',
  fg4: 'var(--ui-text-quaternary)',
  accent: 'var(--ui-accent)',
  green: 'var(--ui-green)',
  orange: 'var(--ui-orange)',
  red: 'var(--ui-red)',
  blue: 'var(--ui-blue)',
  purple: 'var(--ui-purple)',
  yellow: 'var(--ui-yellow)'
}
const LINE = 'var(--ui-stroke-secondary)'
const BORDER = '1px solid ' + LINE
const TINT = (c, p) => 'color-mix(in oklab, ' + c + ' ' + p + '%, transparent)'
const MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace'
const FS = { micro: 10.5, tiny: 11, small: 11.5, body: 12.5, lead: 13.5, metric: 16, title: 19 }

/* ── Module state: drafts survive hot reloads and page switches ────────── */

let REST = null
let CTX = null

const store = {
  snap: null,
  error: null,
  busy: '',
  flash: null,
  draft: {},       // pending setting edits
  device: { alias: '', key: '' },
  confirm: '',     // alias awaiting delete confirmation
  test: { body: '', title: '', device: '', level: '', image: '' },
  testResult: null,
  testBusy: false,
  eventsLimit: 8
}

const subs = new Set()
function publish() {
  if (store.snap && store.snap.strings && typeof store.snap.strings === 'object') {
    STR = store.snap.strings
  }
  subs.forEach(fn => {
    try {
      fn()
    } catch {
      /* a throwing subscriber must not take the page down */
    }
  })
}

function useStore() {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const fn = value => setTick(value)
    subs.add(fn)
    return () => subs.delete(fn)
  }, [])
  return tick
}

function toast(message, kind) {
  try {
    host.notify({ kind: kind || 'info', message })
  } catch {
    /* notifications unavailable is not a failure */
  }
}

function flash(text, kind) {
  store.flash = { text, kind: kind || 'ok', at: Date.now() }
  publish()
  setTimeout(() => {
    if (store.flash && Date.now() - store.flash.at >= 2500) {
      store.flash = null
      publish()
    }
  }, 2600)
}

/* ── Backend facade ──────────────────────────────────────────────────── */

async function api(path, options) {
  if (!REST) throw new Error(t('Plugin backend not ready'))
  return REST(path, options)
}
const post = (path, body, opts) => api(path, { method: 'POST', body: body || {}, ...(opts || {}) })

async function refresh(quiet) {
  try {
    const snap = await api('/status', { timeoutMs: 15000 })
    store.snap = snap
    store.error = null
    if (!store.test.device && snap.default_device) store.test.device = snap.default_device
  } catch (error) {
    store.error = String((error && error.message) || error)
    if (!quiet) toast(store.error, 'error')
  }
  publish()
}

async function run(label, fn) {
  store.busy = label
  publish()
  try {
    return await fn()
  } catch (error) {
    const message = String((error && error.message) || error)
    toast(message, 'error')
    return null
  } finally {
    store.busy = ''
    publish()
  }
}

/* ── Helpers ─────────────────────────────────────────────────────────── */

const pad = n => String(n).padStart(2, '0')

function clock(ts) {
  if (!ts) return '—'
  const when = new Date(ts)
  if (Number.isNaN(when.getTime())) return '—'
  return pad(when.getHours()) + ':' + pad(when.getMinutes()) + ':' + pad(when.getSeconds())
}

function ago(ts) {
  if (!ts) return t('never')
  const when = new Date(ts).getTime()
  if (Number.isNaN(when)) return '—'
  const s = Math.max(0, Math.round((Date.now() - when) / 1000))
  if (s < 60) return s + t('s ago')
  if (s < 3600) return Math.round(s / 60) + t('m ago')
  if (s < 86400) return Math.round(s / 3600) + t('h ago')
  return Math.round(s / 86400) + t('d ago')
}

function titleCase(value) {
  return String(value || '').replace(/(^|[^A-Za-z])([a-z])/g, (m, a, b) => a + b.toUpperCase())
}

/* ── Visual primitives ───────────────────────────────────────────────── */

function Dot({ tone, size }) {
  return h('span', {
    style: {
      width: size || 7,
      height: size || 7,
      borderRadius: 999,
      background: tone || C.green,
      boxShadow: '0 0 0 3px ' + TINT(tone || C.green, 16),
      flexShrink: 0
    }
  })
}

function Bell({ size }) {
  return h('svg', {
    width: size || 20,
    height: size || 20,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true'
  }, [
    h('path', { key: 'p', d: 'M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9' }),
    h('path', { key: 'q', d: 'M13.7 21a2 2 0 0 1-3.4 0' })
  ])
}

function Btn({ children, onClick, active, disabled, tone, title, wide, ghost }) {
  const accent = tone || C.accent
  return h('button', {
    type: 'button',
    title,
    disabled,
    onClick: disabled ? undefined : onClick,
    style: {
      padding: wide ? '6px 14px' : '4px 11px',
      minHeight: 26,
      borderRadius: 7,
      border: '1px solid ' + (active ? TINT(accent, 55) : ghost ? 'transparent' : LINE),
      background: active ? TINT(accent, 14) : 'transparent',
      color: active ? (tone ? accent : C.fg) : C.fg2,
      fontSize: FS.body,
      fontFamily: 'inherit',
      lineHeight: '18px',
      cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? 0.45 : 1,
      whiteSpace: 'nowrap'
    }
  }, children)
}

function Segmented({ value, options, onChange, tone, disabled }) {
  const list = (options || []).map(o => (typeof o === 'string' ? { value: o, label: o } : o))
  return h('div', {
    style: {
      display: 'inline-flex',
      alignItems: 'stretch',
      padding: 2,
      gap: 2,
      border: BORDER,
      borderRadius: 8,
      background: 'var(--ui-bg-elevated, transparent)'
    }
  }, list.map(o => {
    const on = String(o.value) === String(value)
    return h('button', {
      key: String(o.value),
      type: 'button',
      disabled,
      title: o.title,
      onClick: disabled ? undefined : () => onChange(o.value),
      style: {
        padding: '2px 9px',
        minHeight: 22,
        borderRadius: 6,
        border: '1px solid ' + (on ? TINT(tone || C.accent, 88) : 'transparent'),
        background: on ? TINT(tone || C.accent, 36) : 'transparent',
        color: on ? C.fg : C.fg3,
        fontWeight: on ? 600 : 400,
        fontSize: FS.small,
        fontFamily: 'inherit',
        cursor: disabled ? 'default' : 'pointer',
        whiteSpace: 'nowrap'
      }
    }, o.label)
  }))
}

function Card({ title, hint, action, children, tone, dense }) {
  const header = hs('header', {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: dense ? '10px 14px' : '11px 16px',
      borderBottom: hint ? 'none' : BORDER,
      minHeight: 40,
      flexWrap: 'wrap'
    },
    children: [
      h('h2', {
        style: { margin: 0, fontSize: FS.tiny, fontWeight: 600, letterSpacing: '0.08em', color: C.fg3 }
      }, title),
      h('span', { style: { flex: 1 } }),
      action || null
    ]
  })
  return hs('section', {
    style: {
      border: '1px solid ' + (tone ? TINT(tone, 26) : LINE),
      borderRadius: 12,
      background: 'var(--ui-bg-card, transparent)',
      display: 'flex',
      flexDirection: 'column',
      minWidth: 0
    }
  }, [
    header,
    hint ? h('p', { style: { margin: 0, padding: '0 16px', fontSize: FS.small, color: C.fg4, lineHeight: '17px' } }, hint) : null,
    h('div', {
      style: { padding: dense ? '10px 14px 12px' : '12px 16px 14px', display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0, flex: 1 }
    }, children)
  ])
}

function Disclosure({ title, summary, action, children, tone, defaultOpen }) {
  const [open, setOpen] = useState(Boolean(defaultOpen))
  const header = hs('div', {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '4px 10px 4px 6px',
      borderBottom: open ? BORDER : 'none',
      minHeight: 40
    },
    children: [
      hs('button', {
        type: 'button',
        onClick: () => setOpen(v => !v),
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          flex: 1,
          minWidth: 0,
          padding: '6px 6px',
          border: 0,
          borderRadius: 7,
          background: 'transparent',
          color: 'inherit',
          fontFamily: 'inherit',
          textAlign: 'left',
          cursor: 'pointer'
        },
        children: [
          h('span', {
            key: 'c',
            style: {
              fontSize: 9,
              color: C.fg4,
              width: 8,
              transform: open ? 'rotate(90deg)' : 'none',
              transition: 'transform 120ms'
            }
          }, '▶'),
          h('h2', {
            key: 't',
            style: { margin: 0, fontSize: FS.tiny, fontWeight: 600, letterSpacing: '0.08em', color: C.fg3 }
          }, title),
          summary
            ? h('span', {
                key: 's',
                style: { fontSize: FS.small, color: C.fg4, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
              }, summary)
            : null
        ]
      }),
      action || null
    ]
  })
  return hs('section', {
    style: {
      border: '1px solid ' + (tone ? TINT(tone, 26) : LINE),
      borderRadius: 12,
      background: 'var(--ui-bg-card, transparent)',
      display: 'flex',
      flexDirection: 'column',
      minWidth: 0
    }
  }, [
    header,
    open
      ? h('div', {
          style: { padding: '12px 16px 14px', display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }
        }, children)
      : null
  ])
}

function Field({ label, hint, children }) {
  return hs('div', {
    style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 30 },
    children: [
      hs('div', {
        style: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 },
        children: [
          h('span', { style: { fontSize: FS.body, color: C.fg2 } }, label),
          hint ? h('span', { style: { fontSize: FS.tiny, color: C.fg4, lineHeight: '15px' } }, hint) : null
        ]
      }),
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 } }, children)
    ]
  })
}

function Tile({ label, children, sub, divider }) {
  return hs('div', {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
      minWidth: 0,
      paddingLeft: divider ? 18 : 0,
      borderLeft: divider ? BORDER : 'none'
    },
    children: [
      h('span', { style: { fontSize: FS.micro, color: C.fg4, letterSpacing: '0.09em', fontWeight: 500 } }, label),
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 7, minHeight: 24 } }, children),
      sub
        ? h('span', {
            style: { fontSize: FS.tiny, color: C.fg4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
          }, sub)
        : null
    ]
  })
}

function Panel({ children, style }) {
  return h('div', {
    style: {
      border: BORDER,
      borderRadius: 9,
      background: 'var(--ui-bg-elevated, transparent)',
      padding: '10px 12px',
      minWidth: 0,
      ...(style || {})
    }
  }, children)
}

function Empty({ children }) {
  return h('p', { style: { margin: 0, fontSize: FS.small, color: C.fg4, lineHeight: '18px' } }, children)
}

function Input({ value, onChange, placeholder, width, mono, password, type, onEnter, disabled }) {
  return h('input', {
    type: type || (password ? 'password' : 'text'),
    value: value === undefined || value === null ? '' : String(value),
    placeholder,
    disabled,
    onChange: event => onChange(event.currentTarget.value),
    onKeyDown: onEnter
      ? event => {
          if (event.key === 'Enter') onEnter()
        }
      : undefined,
    style: {
      width: width || 150,
      minHeight: 26,
      padding: '3px 8px',
      borderRadius: 7,
      border: BORDER,
      background: 'var(--ui-bg-elevated, transparent)',
      color: C.fg,
      fontSize: FS.body,
      fontFamily: mono ? MONO : 'inherit',
      outline: 'none'
    }
  })
}

function Toggle({ on, onChange, disabled }) {
  return h(Segmented, {
    value: on ? 1 : 0,
    disabled,
    options: [{ value: 1, label: t('On') }, { value: 0, label: t('Off') }],
    onChange: value => onChange(value === 1)
  })
}

/* ── Settings drafts ─────────────────────────────────────────────────── */

const NOTIFY_KEYS = [
  'notify_turn_end',
  'notify_turn_end_min_duration_s',
  'notify_turn_end_statuses',
  'notify_subagent_stop',
  'notify_subagent_stop_min_duration_ms',
  'notify_quiet_hours'
]
const PARAM_KEYS = ['level', 'group', 'sound', 'ttl', 'icon', 'server', 'proxy', 'title', 'dedupe', 'allow_private_image_urls']


function values() {
  return (store.snap && store.snap.settings && store.snap.settings.values) || {}
}

function valueOf(key) {
  if (Object.prototype.hasOwnProperty.call(store.draft, key)) return store.draft[key]
  const v = values()[key]
  return v === undefined || v === null ? '' : v
}

function flag(key) {
  const v = valueOf(key)
  return v === true || v === 'true'
}

function setDraft(key, value) {
  const base = values()[key]
  if (String(base === undefined || base === null ? '' : base) === String(value === undefined || value === null ? '' : value)) {
    delete store.draft[key]
  } else {
    store.draft[key] = value
  }
  publish()
}

function dirtyKeys(keys) {
  return keys.filter(key => Object.prototype.hasOwnProperty.call(store.draft, key))
}

async function save(keys) {
  const patch = {}
  dirtyKeys(keys).forEach(key => {
    patch[key] = store.draft[key]
  })
  if (!Object.keys(patch).length) return
  const snap = await run('save', () => post('/settings', { patch }, { timeoutMs: 20000 }))
  if (!snap) return
  store.snap = snap
  Object.keys(patch).forEach(key => delete store.draft[key])
  flash(t('Saved · wrote plugins.entries.') + ID + '.settings')
  publish()
}

/* ── Component: header ───────────────────────────────────────────────── */

function Header({ snap }) {
  const ping = (snap && snap.server && snap.server.ping) || null
  const configured = Boolean(snap && snap.configured)
  const bad = Boolean(store.error) || Boolean(ping && !ping.ok)
  const tone = store.error ? C.red : bad ? C.red : configured ? C.green : C.orange
  const label = store.error ? t('Backend unreachable') : bad ? t('Server error') : configured ? t('Configured') : t('No device')
  const hostText = snap && snap.server ? snap.server.host : '…'
  const deviceCount = (snap && snap.devices ? snap.devices.length : 0)
  const version = (snap && snap.plugin && snap.plugin.version) || ''
  return hs('header', { style: { display: 'flex', alignItems: 'center', gap: 13, flexWrap: 'wrap', paddingBottom: 4 } }, [
    h('div', {
      key: 'ic',
      style: {
        width: 38,
        height: 38,
        borderRadius: 11,
        border: '1px solid ' + TINT(tone, 30),
        background: TINT(tone, 10),
        color: tone,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0
      }
    }, h(Bell, { size: 19 })),
    hs('div', { key: 't', style: { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }, children: [
      hs('div', { key: 'l1', style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }, children: [
        h('h1', { style: { margin: 0, fontSize: FS.title, fontWeight: 650, letterSpacing: '-0.015em', lineHeight: '24px' } }, t('Bark notifications')),
        hs('span', {
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '2px 9px',
            borderRadius: 999,
            border: '1px solid ' + TINT(tone, 32),
            background: TINT(tone, 12),
            fontSize: FS.tiny,
            color: C.fg2,
            lineHeight: '16px'
          }
        }, [h(Dot, { key: 'd', tone }), h('span', { key: 's' }, label)])
      ] }),
      h('span', {
        key: 'l2',
        style: { fontSize: FS.small, color: C.fg3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
      }, hostText + '　·　' + deviceCount + t(' device(s) · outbound only, no receipt') + (version ? '　·　v' + version : ''))
    ] }),
    h('span', { key: 'sp', style: { flex: 1 } }),
    hs('div', { key: 'act', style: { display: 'flex', gap: 8 }, children: [
      h(Btn, {
        key: 'r',
        onClick: () => run('refresh', async () => {
          const snap2 = await api('/status?fresh=1', { timeoutMs: 15000 })
          store.snap = snap2
          flash(t('Server re-probed'))
        }),
        disabled: Boolean(store.busy)
      }, t('Refresh')),
      h(Btn, {
        key: 't',
        active: true,
        onClick: () => {
          const el = document.querySelector('[data-bark-test]')
          if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
          const input = document.querySelector('[data-bark-test-body]')
          if (input && input.focus) input.focus()
        }
      }, t('Test a push'))
    ] })
  ])
}

/* ── Component: overview ─────────────────────────────────────────────── */

function Overview({ snap }) {
  const ping = (snap && snap.server && snap.server.ping) || {}
  const stats = (snap && snap.stats) || {}
  const last = stats.last || null
  const tone = ping.ok ? C.green : C.red
  return h(Card, {
    title: t('Channel'),
    dense: true,
    tone: snap && snap.configured ? null : C.orange,
    action: h('span', { style: { fontSize: FS.tiny, color: C.fg4 } },
      ping.cached ? t('cached ≤60s') : t('live probe'))
  }, [
    hs('div', {
      key: 'tiles',
      style: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: 18,
        alignItems: 'stretch'
      },
      children: [
        h(Tile, { key: 'a', label: t('Server'), sub: snap && snap.server ? snap.server.host : '' }, [
          h(Dot, { key: 'd', tone }),
          h('span', { key: 'v', style: { fontSize: FS.metric, fontWeight: 600 } },
            ping.ok ? 'pong' : t('unreachable')),
          h('span', { key: 'x', style: { fontSize: FS.tiny, color: C.fg4 } },
            ping.version ? 'v' + ping.version : (ping.status ? 'HTTP ' + ping.status : ''))
        ]),
        h(Tile, { key: 'b', label: t('Devices'), divider: true, sub: snap && snap.default_device ? t('Default ') + snap.default_device : t('no default device') }, [
          h('span', { key: 'v', style: { fontSize: FS.metric, fontWeight: 600 } }, String((snap.devices || []).length)),
          h('span', { key: 'x', style: { fontSize: FS.tiny, color: C.fg4 } }, t('devices'))
        ]),
        h(Tile, { key: 'c', label: t('Delivered today'), divider: true, sub: t('Total ') + String(stats.total || 0) + t(' records · failed ') + String(stats.failed || 0) }, [
          h('span', { key: 'v', style: { fontSize: FS.metric, fontWeight: 600 } }, String(stats.today || 0)),
          h('span', { key: 'x', style: { fontSize: FS.tiny, color: C.fg4 } }, t('records'))
        ]),
        h(Tile, { key: 'd', label: t('Last delivery'), divider: true, sub: last ? (last.alias || '') + ' · ' + (last.source || '') : t('none yet') }, [
          h('span', { key: 'v', style: { fontSize: FS.metric, fontWeight: 600, color: last && !last.ok ? C.red : C.fg } },
            last ? (last.ok ? t('ok') : t('failed')) : '—'),
          h('span', { key: 'x', style: { fontSize: FS.tiny, color: C.fg4 } }, last ? ago(last.ts) : '')
        ])
      ]
    })
  ])
}

/* ── Component: behaviour ────────────────────────────────────────────── */

function BehaviourCard() {
  const dirty = dirtyKeys(NOTIFY_KEYS).length > 0
  const turnOn = flag('notify_turn_end')
  const subOn = flag('notify_subagent_stop')
  const statuses = String(valueOf('notify_turn_end_statuses') || '').trim()
  // empty = backend default (failed + interrupted); the duration gate only
  // matters when the whitelist contains completed
  const gatesSuccess = !statuses || statuses.split(',').map(s => s.trim()).includes('completed')
  return h(Card, {
    title: t('Notification rules'),
    hint: t('Automatic push runs inside the Hermes process only; cron and hermes send are unaffected.'),
    action: hs('div', { style: { display: 'flex', gap: 6 }, children: [
      dirty ? h(Btn, { key: 'x', ghost: true, onClick: () => { store.draft = {}; publish() } }, t('Discard')) : null,
      h(Btn, { key: 's', active: dirty, disabled: !dirty || Boolean(store.busy), onClick: () => save(NOTIFY_KEYS) }, dirty ? t('Save') : t('Saved'))
    ] })
  }, [
    h(Field, {
      key: 'te',
      label: t('Push when a turn ends'),
      hint: turnOn ? t('Fires when a turn wraps up; successful turns shorter than the threshold are skipped.') : t('When off, only cron and hermes send push.')
    }, h(Toggle, { on: turnOn, onChange: v => setDraft('notify_turn_end', v) })),
    turnOn
      ? h(Field, {
          key: 'tes',
          label: t('Statuses'),
          hint: t('Comma-separated: completed / failed / interrupted')
        }, h(Input, {
          value: valueOf('notify_turn_end_statuses'),
          onChange: v => setDraft('notify_turn_end_statuses', v),
          width: 190,
          mono: true
        }))
      : null,
    turnOn && gatesSuccess
      ? h(Field, {
          key: 'ted',
          label: t('Min turn length'),
          hint: t('Only gates successful turns; failures and interruptions always push.')
        }, hs('div', { style: { display: 'flex', alignItems: 'center', gap: 6 }, children: [
          h(Input, {
            key: 'i',
            value: valueOf('notify_turn_end_min_duration_s'),
            onChange: v => setDraft('notify_turn_end_min_duration_s', v),
            width: 72,
            type: 'number'
          }),
          h('span', { key: 'u', style: { fontSize: FS.tiny, color: C.fg4, width: 18 } }, t('s'))
        ] }))
      : null,
    h(Field, {
      key: 'q',
      label: t('Quiet hours'),
      hint: t('e.g. 23:30-08:00, comma-separate several ranges; empty = never quiet.')
    }, h(Input, {
      value: valueOf('notify_quiet_hours'),
      onChange: v => setDraft('notify_quiet_hours', v),
      width: 170,
      mono: true,
      placeholder: '23:30-08:00'
    })),
    h('div', { key: 'sep', style: { height: 1, background: LINE, margin: '2px 0' } }),
    h(Field, {
      key: 'ss',
      label: t('Push when a subagent stops'),
      hint: subOn ? t('Pushes a summary when a delegate_task subagent finishes.') : t('Fan-outs make this noisy; off by default.')
    }, h(Toggle, { on: subOn, onChange: v => setDraft('notify_subagent_stop', v) })),
    subOn
      ? h(Field, {
          key: 'ssd',
          label: t('Min subagent length'),
          hint: t('Short tasks are skipped.')
        }, hs('div', { style: { display: 'flex', alignItems: 'center', gap: 6 }, children: [
          h(Input, {
            key: 'i',
            value: valueOf('notify_subagent_stop_min_duration_ms'),
            onChange: v => setDraft('notify_subagent_stop_min_duration_ms', v),
            width: 86,
            type: 'number'
          }),
          h('span', { key: 'u', style: { fontSize: FS.tiny, color: C.fg4, width: 26 } }, 'ms')
        ] }))
      : null
  ])
}

/* ── Component: devices ──────────────────────────────────────────────── */

const ALIAS_OK = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/

function DevicesCard({ snap }) {
  const list = (snap && snap.devices) || []
  const alias = store.device.alias
  const aliasProblem = alias && !ALIAS_OK.test(alias) ? t('Alias allows letters, digits, dot, underscore and hyphen only') : ''
  const canAdd = Boolean(alias) && Boolean(store.device.key) && !aliasProblem
  const busy = Boolean(store.busy)

  const add = async () => {
    const result = await run('device', () => post('/device', { alias, key: store.device.key }, { timeoutMs: 20000 }))
    if (!result) return
    store.snap = result
    store.device = { alias: '', key: '' }
    flash(t('Wrote ') + (result.written || []).join(', '))
    publish()
  }

  const remove = async name => {
    if (store.confirm !== name) {
      store.confirm = name
      publish()
      setTimeout(() => {
        if (store.confirm === name) {
          store.confirm = ''
          publish()
        }
      }, 4000)
      return
    }
    const result = await run('device', () => api('/device/' + encodeURIComponent(name), { method: 'DELETE', timeoutMs: 20000 }))
    store.confirm = ''
    if (!result) return
    store.snap = result
    flash(t('Removed ') + (result.written || []).join(', '))
    publish()
  }

  return h(Card, {
    title: t('Device mapping'),
    hint: t('Keys are routed by Hermes: add one here or as BARK_KEY_<alias>. Only the mask is returned to this page; plaintext never reaches the renderer.'),
    action: h('span', { style: { fontSize: FS.tiny, color: C.fg4 } }, list.length + t(' device(s)'))
  }, [
    list.length
      ? hs('div', {
          key: 'list',
          style: {
            border: BORDER,
            borderRadius: 9,
            background: 'var(--ui-bg-elevated, transparent)',
            overflow: 'hidden',
            flex: '0 1 auto'
          },
          children: list.map((row, index) => hs('div', {
            key: row.alias,
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '7px 11px',
              borderTop: index ? BORDER : 'none',
              minHeight: 34
            },
            children: [
              h('span', { key: 'a', style: { fontSize: FS.body, fontWeight: row.is_default ? 600 : 400, minWidth: 82 } }, row.alias),
              h('span', { key: 'k', style: { fontSize: FS.small, color: C.fg3, fontFamily: MONO, flex: 1, minWidth: 0 } }, row.masked || t('(no key)')),
              row.is_default ? h('span', {
                key: 'd',
                style: {
                  fontSize: FS.micro,
                  color: C.accent,
                  border: '1px solid ' + TINT(C.accent, 45),
                  background: TINT(C.accent, 12),
                  borderRadius: 5,
                  padding: '1px 6px'
                }
              }, t('default')) : null,
              row.source === 'inline' ? h('span', {
                key: 'i',
                title: t('Key sits in config.yaml as plaintext'),
                style: { fontSize: FS.micro, color: C.orange, border: '1px solid ' + TINT(C.orange, 45), borderRadius: 5, padding: '1px 6px' }
              }, t('plaintext')) : null,
              h('button', {
                key: 'x',
                type: 'button',
                disabled: busy,
                onClick: () => remove(row.alias),
                style: {
                  padding: '0 8px',
                  minHeight: 24,
                  borderRadius: 6,
                  border: '1px solid ' + (store.confirm === row.alias ? TINT(C.red, 60) : LINE),
                  background: store.confirm === row.alias ? TINT(C.red, 16) : 'transparent',
                  color: store.confirm === row.alias ? C.red : C.fg4,
                  fontSize: FS.tiny,
                  fontFamily: 'inherit',
                  cursor: busy ? 'default' : 'pointer',
                  whiteSpace: 'nowrap'
                }
              }, store.confirm === row.alias ? t('Confirm') : t('Delete'))
            ]
          }))
        })
      : h(Empty, { key: 'empty' }, t('No devices yet. Paste a device key from the Bark app below; it is stored as a credential for this profile.')),

    hs('div', {
      key: 'add',
      style: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 'auto', paddingTop: 4, flexWrap: 'wrap' },
      children: [
        h(Input, {
          key: 'a',
          value: alias,
          placeholder: t('alias (e.g. iphone)'),
          width: 150,
          onChange: v => {
            store.device.alias = v
            publish()
          }
        }),
        h(Input, {
          key: 'k',
          value: store.device.key,
          placeholder: 'device key',
          password: true,
          width: 230,
          onChange: v => {
            store.device.key = v
            publish()
          },
          onEnter: canAdd ? add : undefined
        }),
        h(Btn, { key: 'b', active: canAdd, disabled: !canAdd || busy, onClick: add }, busy === 'device' ? t('Writing…') : t('Add')),
        aliasProblem ? h('span', { key: 'p', style: { fontSize: FS.tiny, color: C.orange } }, aliasProblem) : null
      ]
    })
  ])
}

/* ── Component: parameters ───────────────────────────────────────────── */

const LEVEL_LABEL = {
  active: 'active',
  timeSensitive: 'time-sensitive',
  critical: 'critical',
  passive: 'passive'
}

function ParamsCard() {
  const dirty = dirtyKeys(PARAM_KEYS).length > 0
  const schema = (store.snap && store.snap.settings && store.snap.settings.schema) || {}
  const levels = (schema.level && (schema.level.choices || schema.level.enum)) || ['active', 'timeSensitive', 'critical', 'passive']
  const prov = (store.snap && store.snap.settings && store.snap.settings.provenance) || {}
  const hintFor = key => (prov[key] === 'settings' ? t('from plugin settings') : prov[key] === 'extra' ? t('from platforms.bark.extra') : t('Default value'))
  const server = String(valueOf('server') || '')
  const proxy = String(valueOf('proxy') || '')
  const summary = [
    server.replace(/^https?:\/\//, '').replace(/\/+$/, ''),
    t(LEVEL_LABEL[String(valueOf('level') || '')] || ''),
    proxy ? (proxy === 'direct' ? 'direct' : proxy) : t('follow env'),
    dirty ? t('unsaved') : ''
  ].filter(Boolean).join(' · ')
  return h(Disclosure, {
    title: t('Advanced'),
    summary,
    action: hs('div', { style: { display: 'flex', gap: 6 }, children: [
      dirty ? h(Btn, { key: 'x', ghost: true, onClick: () => { store.draft = {}; publish() } }, t('Discard')) : null,
      h(Btn, { key: 's', active: dirty, disabled: !dirty || Boolean(store.busy), onClick: () => save(PARAM_KEYS) }, dirty ? t('Save settings') : t('Saved'))
    ] })
  }, [
    h('p', { key: 'note', style: { margin: 0, fontSize: FS.small, color: C.fg4, lineHeight: '17px' } },
      t('These values land in plugins.entries.') + ID + t('.settings; the same fields are editable under Settings → Plugins.')),
    hs('div', {
      key: 'grid',
      style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', columnGap: 26, rowGap: 8 },
      children: [
        h(Field, { key: 'server', label: t('Server'), hint: hintFor('server') + t(' · hit Refresh to re-probe after editing') },
          h(Input, { value: valueOf('server'), onChange: v => setDraft('server', v), width: 250, mono: true })),
        h(Field, { key: 'proxy', label: t('Proxy'), hint: hintFor('proxy') + t(' · empty = follow env vars; direct = bypass proxies') },
          h(Input, { value: valueOf('proxy'), onChange: v => setDraft('proxy', v), width: 250, mono: true, placeholder: 'direct / http://127.0.0.1:7897' })),
        h(Field, { key: 'level', label: t('Interruption level'), hint: hintFor('level') + t(' · critical needs in-app permission') },
          h(Segmented, {
            value: valueOf('level'),
            options: levels.map(v => ({ value: v, label: t(LEVEL_LABEL[v] || v), title: v })),
            onChange: v => setDraft('level', v)
          })),
        h(Field, { key: 'group', label: t('Group'), hint: hintFor('group') },
          h(Input, { value: valueOf('group'), onChange: v => setDraft('group', v), width: 140, placeholder: 'Hermes' })),
        h(Field, { key: 'sound', label: t('Sound'), hint: hintFor('sound') + t(' · empty = system default') },
          h(Input, { value: valueOf('sound'), onChange: v => setDraft('sound', v), width: 120, mono: true, placeholder: 'bell' })),
        h(Field, { key: 'title', label: t('Default title'), hint: hintFor('title') },
          h(Input, { value: valueOf('title'), onChange: v => setDraft('title', v), width: 140, placeholder: 'Hermes' })),
        h(Field, { key: 'icon', label: t('Icon URL'), hint: hintFor('icon') },
          h(Input, { value: valueOf('icon'), onChange: v => setDraft('icon', v), width: 210, mono: true, placeholder: 'https://…' })),
        h(Field, { key: 'ttl', label: t('TTL'), hint: hintFor('ttl') + t(' · 0 = never expires') },
          hs('div', { style: { display: 'flex', alignItems: 'center', gap: 6 }, children: [
            h(Input, { key: 'i', value: valueOf('ttl'), onChange: v => setDraft('ttl', v), width: 80, type: 'number' }),
            h('span', { key: 'u', style: { fontSize: FS.tiny, color: C.fg4, width: 18 } }, t('s'))
          ] })),
        h(Field, { key: 'dd', label: t('5s dedupe'), hint: hintFor('dedupe') + t(' · one push per target per 5s for identical content') },
          h(Toggle, { on: flag('dedupe'), onChange: v => setDraft('dedupe', v) })),
        h(Field, { key: 'priv', label: t('Allow private images'), hint: hintFor('allow_private_image_urls') },
          h(Toggle, { on: flag('allow_private_image_urls'), onChange: v => setDraft('allow_private_image_urls', v) }))
      ]
    })
  ])
}

/* ── Component: test push ────────────────────────────────────────────── */

function TestCard({ snap }) {
  const devices = (snap && snap.devices) || []
  const result = store.testResult
  const set = (key, value) => {
    store.test[key] = value
    publish()
  }
  const body = store.test
  /** An empty body falls back to a localized default, never a stale placeholder. */
  const payload = () => ({ ...body, body: body.body || t('Test push from Hermes') })

  const preview = async () => {
    const data = await run('preview', () => post('/preview', payload(), { timeoutMs: 15000 }))
    if (!data) return
    store.testResult = { kind: 'preview', data, at: Date.now() }
    publish()
  }
  const send = async () => {
    store.testBusy = true
    publish()
    try {
      const data = await post('/test', payload(), { timeoutMs: 25000 })
      store.testResult = { kind: 'send', data, at: Date.now() }
      if (data.ok) {
        store.snap = store.snap ? { ...store.snap, events: data.events || store.snap.events } : store.snap
        flash(t('Delivered to ') + data.alias + ' · HTTP ' + data.status + ' · ' + data.latency_ms + ' ms')
      } else {
        toast(data.error || t('Push failed'), 'error')
      }
    } catch (error) {
      store.testResult = { kind: 'send', data: { ok: false, error: String((error && error.message) || error) }, at: Date.now() }
      toast(store.testResult.data.error, 'error')
    } finally {
      store.testBusy = false
      publish()
      refresh(true)
    }
  }

  const last = result && result.data
  const summary = result
    ? result.kind === 'preview'
      ? t('Preview (not sent)')
      : last && last.ok
        ? 'HTTP ' + last.status + ' · ' + ago(result.at)
        : t('Push failed')
    : t('nothing reaches the phone until you hit Send test')

  return h(Disclosure, {
    title: t('Test push'),
    summary,
    tone: C.accent
  }, [
    h('p', { key: 'note', style: { margin: 0, fontSize: FS.small, color: C.fg4, lineHeight: '17px' } },
      t('See exactly what Bark receives before sending. device_key never appears on this page.')),
    h(Field, { key: 'dev', label: t('Target device') },
      devices.length
        ? h(Segmented, {
            value: body.device || (snap && snap.default_device) || '',
            options: devices.map(row => ({ value: row.alias, label: row.alias + (row.is_default ? t(' (default)') : '') })),
            onChange: v => set('device', v)
          })
        : h('span', { style: { fontSize: FS.tiny, color: C.orange } }, t('Add a device above first'))),
    h(Field, { key: 'title', label: t('Title'), hint: t('empty = default title') },
      h(Input, { value: body.title, onChange: v => set('title', v), width: 200, placeholder: 'Hermes' })),
    h(Field, { key: 'body', label: t('Body'), hint: t('Chinese and symbols are fine; Bark truncates past ~3800 chars') },
      h(Input, { value: body.body, onChange: v => set('body', v), width: 320, placeholder: t('Test push from Hermes'), onEnter: send })),
    h(Field, { key: 'level', label: t('Override level'), hint: t('empty = use the default level') },
      h(Segmented, {
        value: body.level,
        options: [{ value: '', label: t('default') }, { value: 'active', label: t('active') }, { value: 'timeSensitive', label: t('time-sensitive') }, { value: 'critical', label: t('critical') }],
        onChange: v => set('level', v)
      })),
    h(Field, { key: 'image', label: t('Image URL'), hint: t('Fetched by the Bark server; http(s) only') },
      h(Input, { value: body.image, onChange: v => set('image', v), width: 300, mono: true, placeholder: 'https://…/x.png' })),
    hs('div', { key: 'act', style: { display: 'flex', gap: 8, marginTop: 'auto', paddingTop: 4, flexWrap: 'wrap' }, children: [
      h(Btn, { key: 'p', onClick: preview, disabled: store.testBusy || Boolean(store.busy) }, t('Preview JSON')),
      h(Btn, { key: 's', active: true, onClick: send, disabled: store.testBusy || !devices.length }, store.testBusy ? t('Sending…') : t('Send test')),
      h('span', { key: 'h', style: { fontSize: FS.tiny, color: C.fg4, alignSelf: 'center' } },
        t('Filled in is not sent: only Send test reaches your phone'))
    ] }),
    result
      ? h(Panel, {
          key: 'res',
          style: {
            border: '1px solid ' + TINT(result.data && result.data.ok ? C.green : C.red, 32),
            background: TINT(result.data && result.data.ok ? C.green : C.red, 8)
          }
        }, hs('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 }, children: [
          hs('div', { key: 'l', style: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }, children: [
            h(Dot, { key: 'd', tone: result.data && result.data.ok ? C.green : C.red }),
            h('span', { key: 's', style: { fontSize: FS.body, fontWeight: 600 } },
              result.kind === 'preview' ? t('Preview (not sent)') : result.data.ok ? t('Queued at APNs') : t('failed')),
            h('span', { key: 't', style: { fontSize: FS.tiny, color: C.fg4 } }, clock(result.at)),
            result.data && result.data.status ? h('span', { key: 'h', style: { fontSize: FS.tiny, color: C.fg4, fontFamily: MONO } },
              'HTTP ' + result.data.status + (result.data.latency_ms !== undefined ? ' · ' + result.data.latency_ms + ' ms' : '')) : null,
            result.data && result.data.alias ? h('span', { key: 'a', style: { fontSize: FS.tiny, color: C.fg4 } }, '→ ' + result.data.alias) : null
          ] }),
          result.data && result.data.error
            ? h('span', { key: 'e', style: { fontSize: FS.small, color: C.red, lineHeight: '17px' } }, result.data.error)
            : null,
          result.data && result.data.payload
            ? h('pre', {
                key: 'p',
                style: {
                  margin: 0,
                  padding: '8px 10px',
                  borderRadius: 7,
                  background: 'var(--ui-bg-editor, var(--ui-bg-quaternary, transparent))',
                  color: C.fg2,
                  fontFamily: MONO,
                  fontSize: FS.tiny,
                  lineHeight: '16px',
                  overflowX: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word'
                }
              }, JSON.stringify(result.data.payload, null, 2))
            : null,
          result.kind === 'send' && result.data && result.data.ok
            ? h('span', { key: 'n', style: { fontSize: FS.tiny, color: C.fg4 } },
                t('HTTP 200 only means bark-server handed it to APNs; whether the phone shows it depends on notification permission.'))
            : null
        ] }))
      : null
  ])
}

/* ── Component: recent deliveries ────────────────────────────────────── */

const SOURCE_CN = { notify: t('notify'), send: t('send'), cron: 'cron', dashboard: t('test') }

function EventsCard({ snap }) {
  const events = (snap && snap.events) || []
  const stats = (snap && snap.stats) || {}
  const clear = async () => {
    const result = await run('events', () => api('/events', { method: 'DELETE', timeoutMs: 10000 }))
    if (result) {
      flash(t('Delivery log cleared'))
      refresh(true)
    }
  }
  return h(Card, {
    title: t('Recent deliveries'),
    hint: t('Merged log from notify hooks, cron, hermes send and test pushes (local plugin-data).'),
    action: hs('div', { style: { display: 'flex', gap: 6, alignItems: 'center' }, children: [
      h('span', { key: 'c', style: { fontSize: FS.tiny, color: C.fg4 } },
        t('ok ') + String(stats.sent || 0) + t(' · failed ') + String(stats.failed || 0)),
      events.length ? h(Btn, { key: 'x', ghost: true, onClick: clear, disabled: Boolean(store.busy) }, t('Clear')) : null
    ] })
  }, [
    events.length
      ? hs('div', {
          key: 'list',
          style: { border: BORDER, borderRadius: 9, background: 'var(--ui-bg-elevated, transparent)', overflow: 'hidden' },
          children: events.map((row, index) => hs('div', {
            key: index,
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              padding: '6px 10px',
              borderTop: index ? BORDER : 'none',
              minHeight: 30
            },
            children: [
              h(Dot, { key: 'd', tone: row.ok ? C.green : C.red, size: 6 }),
              h('span', { key: 't', style: { fontSize: FS.tiny, color: C.fg4, fontFamily: MONO, width: 58 } }, clock(row.ts)),
              h('span', { key: 's', style: { fontSize: FS.tiny, color: C.fg3, width: 40 } }, SOURCE_CN[row.source] || row.source || '—'),
              h('span', { key: 'a', style: { fontSize: FS.tiny, color: C.fg3, width: 70, overflow: 'hidden', textOverflow: 'ellipsis' } }, row.alias || '—'),
              h('span', {
                key: 'b',
                style: { fontSize: FS.small, color: row.ok ? C.fg2 : C.red, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
              }, row.ok ? (row.title ? row.title + ' · ' : '') + (row.body || '') : (row.error || t('failed'))),
              row.latency_ms !== null && row.latency_ms !== undefined
                ? h('span', { key: 'l', style: { fontSize: FS.micro, color: C.fg4, fontFamily: MONO, width: 52, textAlign: 'right' } }, row.latency_ms + 'ms')
                : null
            ]
          }))
        })
      : h('div', { key: 'empty', style: { display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, minHeight: 90 } },
          h(Empty, {}, t('No deliveries yet. Send a test above to create the first entry.')))
  ])
}

/* ── Component: config & diagnostics ─────────────────────────────────── */

function ConfigCard({ snap }) {
  const plugin = (snap && snap.plugin) || {}
  const warnings = (store.error
    ? [{ level: 'error', text: t('Backend unreachable: ') + store.error }]
    : (snap && snap.warnings) || [])
  const toneOf = level => (level === 'error' ? C.red : level === 'warn' ? C.orange : C.fg4)
  const rows = [
    [t('Plugin version'), (plugin.version || '—') + (plugin.router_version ? ' · api ' + plugin.router_version : '')],
    ['config.yaml', plugin.config_path || '—'],
    [t('Credentials'), plugin.secret_source === 'scope' ? t('profile secret scope')
      : plugin.secret_source === 'env' ? t('process environment') : '—'],
    [t('Plugin dir'), plugin.dir || '—'],
    [t('Server'), (snap && snap.server && snap.server.url) || '—'],
    [t('Notification rules'), snap && snap.notify ? JSON.stringify(snap.notify) : '—']
  ]
  return h(Card, { title: t('Config & diagnostics'), hint: t('Keys are routed by Hermes (the plugin never reads .env); only the source is shown, never a value.') }, [
    hs('div', {
      key: 'kv',
      style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', columnGap: 24, rowGap: 6 },
      children: rows.map(([label, value], index) => hs('div', {
        key: index,
        style: { display: 'flex', gap: 10, alignItems: 'baseline', minWidth: 0 },
        children: [
          h('span', { key: 'l', style: { fontSize: FS.tiny, color: C.fg4, flexShrink: 0, width: 74 } }, label),
          h('span', {
            key: 'v',
            style: { fontSize: FS.small, color: C.fg3, fontFamily: MONO, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
          }, String(value))
        ]
      }))
    }),
    warnings.length
      ? hs('div', { key: 'w', style: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }, children: warnings.map((row, index) => hs('div', {
          key: index,
          style: { display: 'flex', gap: 8, alignItems: 'flex-start' },
          children: [
            h('span', { key: 'd', style: { marginTop: 5 } }, h(Dot, { tone: toneOf(row.level), size: 6 })),
            h('span', { key: 't', style: { fontSize: FS.small, color: row.level === 'info' ? C.fg3 : C.fg2, lineHeight: '17px' } }, row.text)
          ]
        })) })
      : h('span', { key: 'ok', style: { fontSize: FS.small, color: C.fg4 } }, t('No configuration problems found.'))
  ])
}

/* ── Page ────────────────────────────────────────────────────────────── */

function BarkPage() {
  useStore()
  T = useBarkT()
  useEffect(() => {
    refresh(true)
    const id = setInterval(() => refresh(true), 12000)
    const onFocus = () => refresh(true)
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(id)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  const snap = store.snap
  const flashRow = store.flash
    ? h('div', {
        key: 'flash',
        style: {
          border: '1px solid ' + TINT(store.flash.kind === 'bad' ? C.red : C.green, 34),
          background: TINT(store.flash.kind === 'bad' ? C.red : C.green, 9),
          borderRadius: 9,
          padding: '7px 11px',
          fontSize: FS.small,
          color: C.fg2
        }
      }, store.flash.text)
    : null

  return h('div', {
    className: 'bark-page',
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
      padding: '22px 26px 56px',
      color: C.fg,
      fontSize: FS.lead,
      overflowY: 'auto',
      height: '100%',
      width: '100%',
      minWidth: 0,
      boxSizing: 'border-box',
      flex: '1 1 auto'
    }
  }, [
    hs('div', { key: 'wrap', style: { display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 1240, width: '100%', margin: '0 auto' } }, [
      h(Header, { key: 'head', snap }),
      flashRow,
      snap
        ? h(Overview, { key: 'ov', snap })
        : h(Card, { key: 'loading', title: t('Channel') },
            h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 90 } },
              h(Empty, {}, store.error ? t('Backend unreachable: ') + store.error : t('Reading configuration…')))),
      hs('div', {
        key: 'row1',
        style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(370px, 1fr))', gap: 14, alignItems: 'stretch' },
        children: [
          h(BehaviourCard, { key: 'b' }),
          h(DevicesCard, { key: 'd', snap })
        ]
      }),
      h('div', { key: 'test', 'data-bark-test': 1 }, h(TestCard, { snap })),
      h(ParamsCard, { key: 'p' }),
      hs('div', {
        key: 'row2',
        style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(370px, 1fr))', gap: 14, alignItems: 'stretch' },
        children: [
          h(EventsCard, { key: 'e', snap }),
          h(ConfigCard, { key: 'c', snap })
        ]
      })
    ])
  ])
}

/* ── Registration ────────────────────────────────────────────────────── */

export default {
  id: ID,
  name: t('Bark notifications'),
  description: t('Bark iOS push: channel status, device mapping, notify rules, test push and delivery log'),
  register(ctx) {
    CTX = ctx
    // Backend messages follow the same language: the plugin API takes
    // ?lang=zh|en (anything else is English).
    const withLang = path => path + (path.includes('?') ? '&' : '?') + 'lang=' + (isChinese() ? 'zh' : 'en')
    REST = (path, options) => ctx.rest(withLang(path), options)

    ctx.register({ id: 'nav', area: 'sidebar.nav', data: { codicon: 'bell', label: t('Bark notifications'), path: ROUTE } })

    ctx.register({
      id: 'page',
      area: 'routes',
      title: t('Bark notifications'),
      data: { path: ROUTE },
      render: () => h(BarkPage, {})
    })

    ctx.register({
      id: 'palette',
      area: 'palette',
      order: 236,
      data: {
        id: 'hermes-bark.open',
        label: t('Bark notifications'),
        keywords: ['bark', 'push', 'notification', 'ios'],
        run: () => host.navigate(ROUTE)
      }
    })

    try {
      console.info('[hermes-bark] desktop plugin loaded')
    } catch {
      /* an unavailable console is not a failure */
    }
  }
}
