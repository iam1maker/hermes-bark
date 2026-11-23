/**
 * 渲染冒烟：不启动桌面端，直接以宿主语义（bundles 解析 = 当前语言 → en → 键）
 * 渲染 Bark 页面，抓出可视文本，用来验证「非中文 → 英文」以及版式结构。
 *
 * 用法：node tests/render_page.mjs [--locale=en|zh|ja] [--dump]
 */

import { pathToFileURL } from 'node:url'
import path from 'node:path'

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k, v === undefined ? true : v]
  })
)

const LOCALE = args.locale || 'en'
const PLUGIN = path.resolve(process.env.BARK_PLUGIN || path.join(import.meta.dirname, '..', 'desktop', 'plugin.js'))

/* ── 宿主桩 ─────────────────────────────────────────────────────────── */

const iso = ms => new Date(Date.now() + ms).toISOString()
let BUNDLES = {}
const STATE = { contributions: [], rest: [], snapshot: null }

const snapshot = {
  ok: true,
  plugin: { id: 'hermes-bark', label: 'Bark', version: '0.2.0', router_version: '1.0.0', dir: '/tmp/x', config_path: '/tmp/x/config.yaml', env_files: ['/tmp/x/.env'], config_exists: true },
  server: { url: 'https://api.day.app', host: 'api.day.app', proxy: '', ping: { ok: true, status: 200, ms: 210, version: '2.2.5', body: 'pong' } },
  devices: [{ alias: 'default', masked: '••••voyF', is_default: true, env: 'BARK_KEY_DEFAULT', source: 'env', where: '.env', from_extra: false }],
  default_device: 'default',
  configured: true,
  settings: {
    values: {
      server: 'https://api.day.app', proxy: '', title: 'Hermes', default_device: 'default',
      level: 'timeSensitive', group: 'Hermes', sound: 'bell', icon: '', ttl: 0,
      notify_turn_end: true, notify_turn_end_min_duration_s: 90, notify_turn_end_statuses: 'failed,interrupted',
      notify_subagent_stop: false, notify_subagent_stop_min_duration_ms: 30000,
      notify_quiet_hours: '23:30-08:00', dedupe: true, allow_private_image_urls: false
    },
    provenance: Object.fromEntries(
      ['server', 'proxy', 'title', 'default_device', 'level', 'group', 'sound', 'icon', 'ttl', 'dedupe',
        'allow_private_image_urls', 'notify_turn_end', 'notify_turn_end_min_duration_s', 'notify_turn_end_statuses',
        'notify_subagent_stop', 'notify_subagent_stop_min_duration_ms', 'notify_quiet_hours']
        .map(k => [k, 'settings'])
    ),
    schema: { level: { choices: ['active', 'timeSensitive', 'critical', 'passive'] } }
  },
  warnings: [],
  events: [
    { ts: iso(-42_000), epoch: Date.now() / 1000 - 42, source: 'test', ok: true, alias: 'default', status: 200, latency_ms: 312.4, message_id: '1795', title: 'Hermes', body: 'test push ok', error: '' },
    { ts: iso(-3 * 3_600_000), epoch: Date.now() / 1000 - 10800, source: 'hook', ok: false, alias: 'default', status: 500, latency_ms: 51.2, message_id: '', title: 'Hermes', body: 'hook failed', error: 'boom' }
  ],
  stats: { today: 2, total: 2, sent: 1, failed: 1 },
  last: { ts: iso(-42_000), ok: true, status: 200, source: 'test', alias: 'default' },
  notify: { turn_end: { enabled: true }, subagent_stop: { enabled: false } }
}

const rest = async url => {
  STATE.rest.push(url)
  if (url.includes('/status')) return JSON.parse(JSON.stringify(snapshot))
  if (url.includes('/preview')) return { payload: {}, note: 'preview' }
  return snapshot
}

const sdk = {
  host: { notify() {}, navigate() {} },
  usePluginI18n: () => {
    const t = key => BUNDLES[LOCALE]?.[key] ?? BUNDLES.en?.[key] ?? key
    return t
  },
  __setBundles: () => {}
}

const react = {
  useEffect: fn => {
    STATE.effects = (STATE.effects || [])
    STATE.effects.push(fn)
  },
  useState: init => [typeof init === 'function' ? init() : init, () => {}]
}

const jsxRuntime = {
  jsx: (type, props) => ({ type, props: props || {} }),
  jsxs: (type, props) => ({ type, props: props || {} })
}

/* ── 模块加载（把 import 说明符指向桩） ─────────────────────────────── */

const { register } = await import('node:module')

register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(specifier, context, next) {
  if (specifier === '@hermes/plugin-sdk') return { url: 'stub:sdk', shortCircuit: true }
  if (specifier === 'react') return { url: 'stub:react', shortCircuit: true }
  if (specifier === 'react/jsx-runtime') return { url: 'stub:jsx', shortCircuit: true }
  return next(specifier, context)
}
export async function load(url, context, next) {
  if (url === 'stub:sdk') return { format: 'module', shortCircuit: true, source: 'export const host = globalThis.__SDK__.host; export const usePluginI18n = globalThis.__SDK__.usePluginI18n' }
  if (url === 'stub:react') return { format: 'module', shortCircuit: true, source: 'export const useEffect = globalThis.__REACT__.useEffect; export const useState = globalThis.__REACT__.useState' }
  if (url === 'stub:jsx') return { format: 'module', shortCircuit: true, source: 'export const jsx = globalThis.__JSX__.jsx; export const jsxs = globalThis.__JSX__.jsxs' }
  return next(url, context)
}
`), 'file:///stub-loader.mjs')

globalThis.window = { addEventListener() {}, removeEventListener() {} }
globalThis.setInterval = () => 0
globalThis.clearInterval = () => {}
globalThis.document = { documentElement: { lang: LOCALE } }
globalThis.__SDK__ = sdk
globalThis.__REACT__ = react
globalThis.__JSX__ = jsxRuntime

const plugin = (await import(pathToFileURL(PLUGIN).href)).default

/* ── 注册插件，拿路由渲染函数 ───────────────────────────────────────── */

const ctx = {
  rest,
  register(contribution) {
    STATE.contributions.push(contribution)
  },
  i18n: {
    register(bundles) {
      BUNDLES = { ...bundles }
      return () => {}
    },
    get t() {
      return key => BUNDLES[LOCALE]?.[key] ?? BUNDLES.en?.[key] ?? key
    },
    onLocaleChange: () => () => {}
  }
}

plugin.register(ctx)

const route = STATE.contributions.find(c => c.area === 'routes')
const nav = STATE.contributions.find(c => c.area === 'sidebar.nav')
const palette = STATE.contributions.find(c => c.area === 'palette')

if (!route) throw new Error('no route contribution registered')
if (!nav || !palette) throw new Error('missing nav/palette contributions')

/* ── 渲染 ───────────────────────────────────────────────────────────── */

const renderPass = () => {
  STATE.effects = []
  const out = collect(route.render(), [])
  return { out, effects: STATE.effects }
}

// 第一遍：调用组件树，收集 useEffect（refresh 在里面）；跑完再渲染一遍拿真实内容。
const first = renderPass()
for (const fn of first.effects) fn()
await new Promise(r => setTimeout(r, 120))
const second = renderPass()
for (const fn of second.effects) fn()
await new Promise(r => setTimeout(r, 30))

function collect(node, out, opts = {}) {
  if (node === null || node === undefined || node === false || node === true) return out
  if (typeof node === 'string' || typeof node === 'number') {
    const text = String(node).trim()
    if (text) out.push(text)
    return out
  }
  if (Array.isArray(node)) {
    for (const child of node) collect(child, out, opts)
    return out
  }
  if (typeof node === 'object') {
    const { type, props = {} } = node
    if (props.placeholder) out.push('[placeholder] ' + props.placeholder)
    if (props.title && typeof props.title === 'string') out.push('[title] ' + props.title)
    if (typeof type === 'function') {
      // 函数组件：按宿主语义调用（hooks 由桩提供）
      return collect(type(props), out, opts)
    }
    if (props.children !== undefined) collect(props.children, out, opts)
  }
  return out
}

const texts = second.out
const cjk = /[\u4e00-\u9fff]/

if (args.dump) {
  for (const line of texts) console.log(line)
} else {
  console.log('locale        :', LOCALE)
  console.log('nav label     :', nav.data.label)
  console.log('route title   :', route.title)
  console.log('text nodes    :', texts.length)
  const leaking = texts.filter(line => cjk.test(line))
  console.log('CJK in render :', leaking.length)
  if (leaking.length) {
    console.log('--- leaking ---')
    for (const line of leaking) console.log('  ' + line)
  }
  console.log('samples       :', texts.slice(0, 8).join(' | '))
}

const expects = String(args.expect || '')
  .split('|')
  .map(s => s.trim())
  .filter(Boolean)
for (const want of expects) {
  const hit = texts.some(line => line.includes(want)) || JSON.stringify(route.title || '').includes(want)
  if (!hit) {
    console.error('MISSING expected text:', want)
    process.exitCode = 1
  }
}

if (LOCALE === 'en' || LOCALE === 'ja') {
  const leaking = texts.filter(line => cjk.test(line))
  if (leaking.length) {
    console.error('FAIL: CJK leaked while locale=' + LOCALE + ' (' + leaking.length + ')')
    process.exitCode = 1
  } else {
    console.log('OK: no CJK while locale=' + LOCALE)
  }
}
process.exit(process.exitCode || 0)
