/**
 * hermes-bark — Bark 通知的桌面设置页。
 *
 * 后端在 profiles/<profile>/plugins/hermes-bark/dashboard/plugin_api.py，
 * 本文件只做渲染与交互；所有数据经 ctx.rest 走 /api/plugins/hermes-bark/*。
 *
 * 两条硬约束（来自 hermes-desktop-plugin-ui）：
 *   - 文件不编译，不能写 JSX；统一用 h/hs 薄封装调 jsx/jsxs。
 *   - Tailwind 任意值类名静默失效；布局/字号/颜色一律 inline style + 主题变量。
 *
 * 设计取向：密钥只显示掩码，写密钥走 .env 凭据通道；试推是「预填 ≠ 发送」，
 * 必须先看 payload 再点发送；删除设备要二次确认。
 */

import { useEffect, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import * as SDK from '@hermes/plugin-sdk'

const { host } = SDK
const usePluginI18n = typeof SDK.usePluginI18n === 'function' ? SDK.usePluginI18n : null

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

/* ── 多语言 ──────────────────────────────────────────────────────────────
 * 中文原文即键，英文在 EN 里；宿主语言不是中文时回落英文（ctx.i18n 的
 * 解析顺序：当前语言 → 插件 en → 键本身）。宿主没有 ctx.i18n 时用本地转移表。
 */

const EN = {
  '插件后端未就绪':
    'Plugin backend not ready',
  '从未':
    'never',
  ' 秒前':
    's ago',
  ' 分钟前':
    'm ago',
  ' 小时前':
    'h ago',
  ' 天前':
    'd ago',
  '开':
    'On',
  '关':
    'Off',
  '已保存 · 写入 plugins.entries.':
    'Saved · wrote plugins.entries.',
  '后端不可达':
    'Backend unreachable',
  '服务器异常':
    'Server error',
  '已配置':
    'Configured',
  '未配置设备':
    'No device',
  'Bark 通知':
    'Bark notifications',
  ' 台设备　·　单向下行（无回执）':
    ' device(s) · outbound only, no receipt',
  '已重新探测服务器':
    'Server re-probed',
  '刷新':
    'Refresh',
  '去试推':
    'Test push',
  '通道':
    'Channel',
  '探测结果缓存 ≤60s':
    'cached ≤60s',
  '本次实测':
    'live probe',
  '服务器':
    'Server',
  '不可达':
    'unreachable',
  '设备':
    'Devices',
  '默认 ':
    'Default ',
  '尚无默认设备':
    'no default device',
  '台':
    'devices',
  '今日推送':
    'Delivered today',
  '共 ':
    'Total ',
  ' 条记录 · 失败 ':
    ' records · failed ',
  '条':
    'records',
  '最近一次':
    'Last delivery',
  '还没有投递记录':
    'none yet',
  '成功':
    'ok',
  '失败':
    'failed',
  '通知规则':
    'Notification rules',
  '自动推送只在 Hermes 进程里生效；cron 与 hermes send 不受这里影响。':
    'Automatic push runs inside the Hermes process only; cron and hermes send are unaffected.',
  '放弃':
    'Discard',
  '保存':
    'Save',
  '已保存':
    'Saved',
  '回合结束推送':
    'Push when a turn ends',
  '一轮对话收工时推送；短于门槛的成功回合不推。':
    'Fires when a turn wraps up; successful turns shorter than the threshold are skipped.',
  '关着时只有 cron / hermes send 会推送。':
    'When off, only cron and hermes send push.',
  '推送哪些状态':
    'Statuses',
  '逗号分隔：completed / failed / interrupted':
    'Comma-separated: completed / failed / interrupted',
  '回合最短时长':
    'Min turn length',
  '只约束成功回合；失败与中断始终推送。':
    'Only gates successful turns; failures and interruptions always push.',
  '秒':
    's',
  '静默时段':
    'Quiet hours',
  '如 23:30-08:00，可逗号分隔多段；留空 = 不静默。':
    'e.g. 23:30-08:00, comma-separate several ranges; empty = never quiet.',
  '子代理结束推送':
    'Push when a subagent stops',
  'delegate_task 的子代理收工后推摘要。':
    'Pushes a summary when a delegate_task subagent finishes.',
  '并行派活时会刷屏，默认关。':
    'Fan-outs make this noisy; off by default.',
  '子代理最短时长':
    'Min subagent length',
  '短任务不推。':
    'Short tasks are skipped.',
  '别名只能用字母、数字、点、下划线、连字符':
    'Alias allows letters, digits, dot, underscore and hyphen only',
  '已写入 ':
    'Wrote ',
  '已删除 ':
    'Removed ',
  '设备映射':
    'Devices',
  '密钥只写 .env：BARK_KEY_<别名>。页面与 Hermes 都只读掩码，明文永远不进渲染层。':
    'Keys live in .env only: BARK_KEY_<alias>. Both this page and Hermes read the mask; plaintext never reaches the renderer.',
  ' 台':
    ' device(s)',
  '（无密钥）':
    '(no key)',
  '默认':
    'default',
  '密钥写在 config.yaml 明文里':
    'Key sits in config.yaml as plaintext',
  '明文':
    'plaintext',
  '确认删除':
    'Confirm',
  '删除':
    'Delete',
  '还没有设备。把 Bark App 里的 device key 粘到下面，就会写进当前 profile 的 .env。':
    'No devices yet. Paste a device key from the Bark app below and it lands in this profile .env.',
  '别名（如 iphone）':
    'alias (e.g. iphone)',
  '写入中…':
    'Writing…',
  '添加':
    'Add',
  '来自插件设置':
    'from plugin settings',
  '来自 platforms.bark.extra':
    'from platforms.bark.extra',
  '默认值':
    'default',
  '跟随环境变量':
    'follow env',
  '未保存':
    'unsaved',
  '高级':
    'Advanced',
  '保存参数':
    'Save',
  '这些值会写进 plugins.entries.':
    'These values land in plugins.entries.',
  '.settings；同样的字段也能在 设置 → 插件 里改。':
    '.settings; the same fields are editable under Settings → Plugins.',
  ' · 改完点刷新重测':
    ' · hit Refresh to re-probe after editing',
  '代理':
    'Proxy',
  ' · 留空跟随环境变量，direct 强制直连':
    ' · empty = follow env vars; direct = bypass proxies',
  '中断级别':
    'Interruption level',
  ' · critical 需 App 内授权':
    ' · critical needs in-app permission',
  '通知分组':
    'Group',
  '提示音':
    'Sound',
  ' · 留空 = 系统默认':
    ' · empty = system default',
  '默认标题':
    'Default title',
  '图标 URL':
    'Icon URL',
  '有效期':
    'TTL',
  ' · 0 = 不过期':
    ' · 0 = never expires',
  '5 秒去重':
    '5s dedupe',
  ' · 同一目标 5 秒内相同内容只推一次':
    ' · one push per target per 5s for identical content',
  '允许私网图片':
    'Allow private images',
  '来自 Hermes 的测试推送':
    'Test push from Hermes',
  '已投递到 ':
    'Delivered to ',
  '推送失败':
    'Push failed',
  '预览（未发送）':
    'Preview (not sent)',
  '只有点了「发送测试」才会真的到手机':
    'nothing reaches the phone until you hit Send test',
  '试推':
    'Test push',
  '先看清楚 Bark 会收到什么，再决定发不发。device_key 不会显示在页面上。':
    'See exactly what Bark receives before sending. device_key never appears on this page.',
  '目标设备':
    'Target device',
  '（默认）':
    ' (default)',
  '先在上面添加一台设备':
    'Add a device above first',
  '标题':
    'Title',
  '留空用默认标题':
    'empty = default title',
  '正文':
    'Body',
  '支持中文与符号；超过约 3800 字会被 Bark 截断':
    'Chinese and symbols are fine; Bark truncates past ~3800 chars',
  '覆盖级别':
    'Override level',
  '留空 = 用上面的默认级别':
    'empty = use the default level',
  '活跃':
    'active',
  '时效':
    'time-sensitive',
  '紧急':
    'critical',
  '静默':
    'passive',
  '图片 URL':
    'Image URL',
  'Bark 服务端抓取，只收 http(s)':
    'Fetched by the Bark server; http(s) only',
  '预览 JSON':
    'Preview JSON',
  '发送中…':
    'Sending…',
  '发送测试':
    'Send test',
  '预填 ≠ 发送：只有点了「发送测试」才会真的到手机':
    'Filled in is not sent: only Send test reaches your phone',
  '已入队 APNs':
    'Queued at APNs',
  'HTTP 200 只代表 bark-server 已提交给 APNs；手机是否显示取决于系统通知权限。':
    'HTTP 200 only means bark-server handed it to APNs; whether the phone shows it depends on notification permission.',
  '通知':
    'notify',
  '发送':
    'send',
  '测试':
    'test',
  '已清空投递记录':
    'Delivery log cleared',
  '最近投递':
    'Recent deliveries',
  '来自通知钩子、cron、hermes send 与试推的合并记录（本机 plugin-data）。':
    'Merged log from notify hooks, cron, hermes send and test pushes (local plugin-data).',
  '成功 ':
    'ok ',
  ' · 失败 ':
    ' · failed ',
  '清空':
    'Clear',
  '还没有投递记录。点上面的「发送测试」会产生第一条。':
    'No deliveries yet. Send a test above to create the first entry.',
  '后端不可达：':
    'Backend unreachable: ',
  '插件版本':
    'Plugin version',
  '插件目录':
    'Plugin dir',
  '配置与诊断':
    'Config & diagnostics',
  '密钥只显示在 .env 里的落点，不显示值。':
    'Keys are shown as a .env location only, never as a value.',
  '没有发现配置问题。':
    'No configuration problems found.',
  '正在读取配置…':
    'Reading configuration…',
  'Bark iOS 推送：通道状态、设备映射、行为规则、试推与投递记录':
    'Bark iOS push: channel status, device mapping, notify rules, test push and delivery log',
}

const zhBundle = () => Object.fromEntries(Object.keys(EN).map(key => [key, key]))

let T = key => (Object.prototype.hasOwnProperty.call(EN, key) ? EN[key] : key)

/** 取词。所有用户可见文案都经此；参数为拼接片段时保持原样。 */
function t(key) {
  return T(key)
}

const useBarkT = () => {
  const translate = usePluginI18n ? usePluginI18n(ID) : null
  return translate || (key => (isChinese() ? key : Object.prototype.hasOwnProperty.call(EN, key) ? EN[key] : key))
}

/** 没有插件 i18n 时的兜底：看宿主 <html lang>。 */
function isChinese() {
  try {
    return /^zh/i.test(document.documentElement.lang || '')
  } catch {
    return true
  }
}

/* ── 主题色：只引用桌面端的 CSS 变量，不写死颜色 ────────────────────── */

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

/* ── 模块级状态：热重载/切页不丢草稿 ─────────────────────────────────── */

let REST = null
let CTX = null

const store = {
  snap: null,
  error: null,
  busy: '',
  flash: null,
  draft: {},       // 待保存的设置项
  device: { alias: '', key: '' },
  confirm: '',     // 正在二次确认删除的别名
  test: { body: '', title: '', device: '', level: '', image: '' },
  testResult: null,
  testBusy: false,
  eventsLimit: 8
}

const subs = new Set()
function publish() {
  subs.forEach(fn => {
    try {
      fn()
    } catch {
      /* 订阅者异常不能拖垮页面 */
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
    /* 通知不可用不算失败 */
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

/* ── 后端门面 ────────────────────────────────────────────────────────── */

async function api(path, options) {
  if (!REST) throw new Error(t('插件后端未就绪'))
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

/* ── 小工具 ──────────────────────────────────────────────────────────── */

const pad = n => String(n).padStart(2, '0')

function clock(ts) {
  if (!ts) return '—'
  const when = new Date(ts)
  if (Number.isNaN(when.getTime())) return '—'
  return pad(when.getHours()) + ':' + pad(when.getMinutes()) + ':' + pad(when.getSeconds())
}

function ago(ts) {
  if (!ts) return t('从未')
  const when = new Date(ts).getTime()
  if (Number.isNaN(when)) return '—'
  const s = Math.max(0, Math.round((Date.now() - when) / 1000))
  if (s < 60) return s + t(' 秒前')
  if (s < 3600) return Math.round(s / 60) + t(' 分钟前')
  if (s < 86400) return Math.round(s / 3600) + t(' 小时前')
  return Math.round(s / 86400) + t(' 天前')
}

function titleCase(value) {
  return String(value || '').replace(/(^|[^A-Za-z])([a-z])/g, (m, a, b) => a + b.toUpperCase())
}

/* ── 视觉基元 ────────────────────────────────────────────────────────── */

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
    options: [{ value: 1, label: t('开') }, { value: 0, label: t('关') }],
    onChange: value => onChange(value === 1)
  })
}

/* ── 设置草稿 ────────────────────────────────────────────────────────── */

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
  flash(t('已保存 · 写入 plugins.entries.') + ID + '.settings')
  publish()
}

/* ── 组件：页头 ──────────────────────────────────────────────────────── */

function Header({ snap }) {
  const ping = (snap && snap.server && snap.server.ping) || null
  const configured = Boolean(snap && snap.configured)
  const bad = Boolean(store.error) || Boolean(ping && !ping.ok)
  const tone = store.error ? C.red : bad ? C.red : configured ? C.green : C.orange
  const label = store.error ? t('后端不可达') : bad ? t('服务器异常') : configured ? t('已配置') : t('未配置设备')
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
        h('h1', { style: { margin: 0, fontSize: FS.title, fontWeight: 650, letterSpacing: '-0.015em', lineHeight: '24px' } }, t('Bark 通知')),
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
      }, hostText + '　·　' + deviceCount + t(' 台设备　·　单向下行（无回执）') + (version ? '　·　v' + version : ''))
    ] }),
    h('span', { key: 'sp', style: { flex: 1 } }),
    hs('div', { key: 'act', style: { display: 'flex', gap: 8 }, children: [
      h(Btn, {
        key: 'r',
        onClick: () => run('refresh', async () => {
          const snap2 = await api('/status?fresh=1', { timeoutMs: 15000 })
          store.snap = snap2
          flash(t('已重新探测服务器'))
        }),
        disabled: Boolean(store.busy)
      }, t('刷新')),
      h(Btn, {
        key: 't',
        active: true,
        onClick: () => {
          const el = document.querySelector('[data-bark-test]')
          if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
          const input = document.querySelector('[data-bark-test-body]')
          if (input && input.focus) input.focus()
        }
      }, t('去试推'))
    ] })
  ])
}

/* ── 组件：总览 ──────────────────────────────────────────────────────── */

function Overview({ snap }) {
  const ping = (snap && snap.server && snap.server.ping) || {}
  const stats = (snap && snap.stats) || {}
  const last = stats.last || null
  const tone = ping.ok ? C.green : C.red
  return h(Card, {
    title: t('通道'),
    dense: true,
    tone: snap && snap.configured ? null : C.orange,
    action: h('span', { style: { fontSize: FS.tiny, color: C.fg4 } },
      ping.cached ? t('探测结果缓存 ≤60s') : t('本次实测'))
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
        h(Tile, { key: 'a', label: t('服务器'), sub: snap && snap.server ? snap.server.host : '' }, [
          h(Dot, { key: 'd', tone }),
          h('span', { key: 'v', style: { fontSize: FS.metric, fontWeight: 600 } },
            ping.ok ? 'pong' : t('不可达')),
          h('span', { key: 'x', style: { fontSize: FS.tiny, color: C.fg4 } },
            ping.version ? 'v' + ping.version : (ping.status ? 'HTTP ' + ping.status : ''))
        ]),
        h(Tile, { key: 'b', label: t('设备'), divider: true, sub: snap && snap.default_device ? t('默认 ') + snap.default_device : t('尚无默认设备') }, [
          h('span', { key: 'v', style: { fontSize: FS.metric, fontWeight: 600 } }, String((snap.devices || []).length)),
          h('span', { key: 'x', style: { fontSize: FS.tiny, color: C.fg4 } }, t('台'))
        ]),
        h(Tile, { key: 'c', label: t('今日推送'), divider: true, sub: t('共 ') + String(stats.total || 0) + t(' 条记录 · 失败 ') + String(stats.failed || 0) }, [
          h('span', { key: 'v', style: { fontSize: FS.metric, fontWeight: 600 } }, String(stats.today || 0)),
          h('span', { key: 'x', style: { fontSize: FS.tiny, color: C.fg4 } }, t('条'))
        ]),
        h(Tile, { key: 'd', label: t('最近一次'), divider: true, sub: last ? (last.alias || '') + ' · ' + (last.source || '') : t('还没有投递记录') }, [
          h('span', { key: 'v', style: { fontSize: FS.metric, fontWeight: 600, color: last && !last.ok ? C.red : C.fg } },
            last ? (last.ok ? t('成功') : t('失败')) : '—'),
          h('span', { key: 'x', style: { fontSize: FS.tiny, color: C.fg4 } }, last ? ago(last.ts) : '')
        ])
      ]
    })
  ])
}

/* ── 组件：行为 ──────────────────────────────────────────────────────── */

function BehaviourCard() {
  const dirty = dirtyKeys(NOTIFY_KEYS).length > 0
  const turnOn = flag('notify_turn_end')
  const subOn = flag('notify_subagent_stop')
  const statuses = String(valueOf('notify_turn_end_statuses') || '').trim()
  // 空 = 后端默认（failed + interrupted）；只有白名单里含 completed 时，时长门槛才有意义
  const gatesSuccess = !statuses || statuses.split(',').map(s => s.trim()).includes('completed')
  return h(Card, {
    title: t('通知规则'),
    hint: t('自动推送只在 Hermes 进程里生效；cron 与 hermes send 不受这里影响。'),
    action: hs('div', { style: { display: 'flex', gap: 6 }, children: [
      dirty ? h(Btn, { key: 'x', ghost: true, onClick: () => { store.draft = {}; publish() } }, t('放弃')) : null,
      h(Btn, { key: 's', active: dirty, disabled: !dirty || Boolean(store.busy), onClick: () => save(NOTIFY_KEYS) }, dirty ? t('保存') : t('已保存'))
    ] })
  }, [
    h(Field, {
      key: 'te',
      label: t('回合结束推送'),
      hint: turnOn ? t('一轮对话收工时推送；短于门槛的成功回合不推。') : t('关着时只有 cron / hermes send 会推送。')
    }, h(Toggle, { on: turnOn, onChange: v => setDraft('notify_turn_end', v) })),
    turnOn
      ? h(Field, {
          key: 'tes',
          label: t('推送哪些状态'),
          hint: t('逗号分隔：completed / failed / interrupted')
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
          label: t('回合最短时长'),
          hint: t('只约束成功回合；失败与中断始终推送。')
        }, hs('div', { style: { display: 'flex', alignItems: 'center', gap: 6 }, children: [
          h(Input, {
            key: 'i',
            value: valueOf('notify_turn_end_min_duration_s'),
            onChange: v => setDraft('notify_turn_end_min_duration_s', v),
            width: 72,
            type: 'number'
          }),
          h('span', { key: 'u', style: { fontSize: FS.tiny, color: C.fg4, width: 18 } }, t('秒'))
        ] }))
      : null,
    h(Field, {
      key: 'q',
      label: t('静默时段'),
      hint: t('如 23:30-08:00，可逗号分隔多段；留空 = 不静默。')
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
      label: t('子代理结束推送'),
      hint: subOn ? t('delegate_task 的子代理收工后推摘要。') : t('并行派活时会刷屏，默认关。')
    }, h(Toggle, { on: subOn, onChange: v => setDraft('notify_subagent_stop', v) })),
    subOn
      ? h(Field, {
          key: 'ssd',
          label: t('子代理最短时长'),
          hint: t('短任务不推。')
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

/* ── 组件：设备 ──────────────────────────────────────────────────────── */

const ALIAS_OK = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/

function DevicesCard({ snap }) {
  const list = (snap && snap.devices) || []
  const alias = store.device.alias
  const aliasProblem = alias && !ALIAS_OK.test(alias) ? t('别名只能用字母、数字、点、下划线、连字符') : ''
  const canAdd = Boolean(alias) && Boolean(store.device.key) && !aliasProblem
  const busy = Boolean(store.busy)

  const add = async () => {
    const result = await run('device', () => post('/device', { alias, key: store.device.key }, { timeoutMs: 20000 }))
    if (!result) return
    store.snap = result
    store.device = { alias: '', key: '' }
    flash(t('已写入 ') + (result.written || []).join(', '))
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
    flash(t('已删除 ') + (result.written || []).join(', '))
    publish()
  }

  return h(Card, {
    title: t('设备映射'),
    hint: t('密钥只写 .env：BARK_KEY_<别名>。页面与 Hermes 都只读掩码，明文永远不进渲染层。'),
    action: h('span', { style: { fontSize: FS.tiny, color: C.fg4 } }, list.length + t(' 台'))
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
              h('span', { key: 'k', style: { fontSize: FS.small, color: C.fg3, fontFamily: MONO, flex: 1, minWidth: 0 } }, row.masked || t('（无密钥）')),
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
              }, t('默认')) : null,
              row.source === 'inline' ? h('span', {
                key: 'i',
                title: t('密钥写在 config.yaml 明文里'),
                style: { fontSize: FS.micro, color: C.orange, border: '1px solid ' + TINT(C.orange, 45), borderRadius: 5, padding: '1px 6px' }
              }, t('明文')) : null,
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
              }, store.confirm === row.alias ? t('确认删除') : t('删除'))
            ]
          }))
        })
      : h(Empty, { key: 'empty' }, t('还没有设备。把 Bark App 里的 device key 粘到下面，就会写进当前 profile 的 .env。')),

    hs('div', {
      key: 'add',
      style: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 'auto', paddingTop: 4, flexWrap: 'wrap' },
      children: [
        h(Input, {
          key: 'a',
          value: alias,
          placeholder: t('别名（如 iphone）'),
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
        h(Btn, { key: 'b', active: canAdd, disabled: !canAdd || busy, onClick: add }, busy === 'device' ? t('写入中…') : t('添加')),
        aliasProblem ? h('span', { key: 'p', style: { fontSize: FS.tiny, color: C.orange } }, aliasProblem) : null
      ]
    })
  ])
}

/* ── 组件：参数 ──────────────────────────────────────────────────────── */

const LEVEL_LABEL = { active: '活跃', timeSensitive: '时效', critical: '紧急', passive: '静默' }

function ParamsCard() {
  const dirty = dirtyKeys(PARAM_KEYS).length > 0
  const schema = (store.snap && store.snap.settings && store.snap.settings.schema) || {}
  const levels = (schema.level && (schema.level.choices || schema.level.enum)) || ['active', 'timeSensitive', 'critical', 'passive']
  const prov = (store.snap && store.snap.settings && store.snap.settings.provenance) || {}
  const hintFor = key => (prov[key] === 'settings' ? t('来自插件设置') : prov[key] === 'extra' ? t('来自 platforms.bark.extra') : t('默认值'))
  const server = String(valueOf('server') || '')
  const proxy = String(valueOf('proxy') || '')
  const summary = [
    server.replace(/^https?:\/\//, '').replace(/\/+$/, ''),
    t(LEVEL_LABEL[String(valueOf('level') || '')] || ''),
    proxy ? (proxy === 'direct' ? 'direct' : proxy) : t('跟随环境变量'),
    dirty ? t('未保存') : ''
  ].filter(Boolean).join(' · ')
  return h(Disclosure, {
    title: t('高级'),
    summary,
    action: hs('div', { style: { display: 'flex', gap: 6 }, children: [
      dirty ? h(Btn, { key: 'x', ghost: true, onClick: () => { store.draft = {}; publish() } }, t('放弃')) : null,
      h(Btn, { key: 's', active: dirty, disabled: !dirty || Boolean(store.busy), onClick: () => save(PARAM_KEYS) }, dirty ? t('保存参数') : t('已保存'))
    ] })
  }, [
    h('p', { key: 'note', style: { margin: 0, fontSize: FS.small, color: C.fg4, lineHeight: '17px' } },
      t('这些值会写进 plugins.entries.') + ID + t('.settings；同样的字段也能在 设置 → 插件 里改。')),
    hs('div', {
      key: 'grid',
      style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', columnGap: 26, rowGap: 8 },
      children: [
        h(Field, { key: 'server', label: t('服务器'), hint: hintFor('server') + t(' · 改完点刷新重测') },
          h(Input, { value: valueOf('server'), onChange: v => setDraft('server', v), width: 250, mono: true })),
        h(Field, { key: 'proxy', label: t('代理'), hint: hintFor('proxy') + t(' · 留空跟随环境变量，direct 强制直连') },
          h(Input, { value: valueOf('proxy'), onChange: v => setDraft('proxy', v), width: 250, mono: true, placeholder: 'direct / http://127.0.0.1:7897' })),
        h(Field, { key: 'level', label: t('中断级别'), hint: hintFor('level') + t(' · critical 需 App 内授权') },
          h(Segmented, {
            value: valueOf('level'),
            options: levels.map(v => ({ value: v, label: t(LEVEL_LABEL[v] || v), title: v })),
            onChange: v => setDraft('level', v)
          })),
        h(Field, { key: 'group', label: t('通知分组'), hint: hintFor('group') },
          h(Input, { value: valueOf('group'), onChange: v => setDraft('group', v), width: 140, placeholder: 'Hermes' })),
        h(Field, { key: 'sound', label: t('提示音'), hint: hintFor('sound') + t(' · 留空 = 系统默认') },
          h(Input, { value: valueOf('sound'), onChange: v => setDraft('sound', v), width: 120, mono: true, placeholder: 'bell' })),
        h(Field, { key: 'title', label: t('默认标题'), hint: hintFor('title') },
          h(Input, { value: valueOf('title'), onChange: v => setDraft('title', v), width: 140, placeholder: 'Hermes' })),
        h(Field, { key: 'icon', label: t('图标 URL'), hint: hintFor('icon') },
          h(Input, { value: valueOf('icon'), onChange: v => setDraft('icon', v), width: 210, mono: true, placeholder: 'https://…' })),
        h(Field, { key: 'ttl', label: t('有效期'), hint: hintFor('ttl') + t(' · 0 = 不过期') },
          hs('div', { style: { display: 'flex', alignItems: 'center', gap: 6 }, children: [
            h(Input, { key: 'i', value: valueOf('ttl'), onChange: v => setDraft('ttl', v), width: 80, type: 'number' }),
            h('span', { key: 'u', style: { fontSize: FS.tiny, color: C.fg4, width: 18 } }, t('秒'))
          ] })),
        h(Field, { key: 'dd', label: t('5 秒去重'), hint: hintFor('dedupe') + t(' · 同一目标 5 秒内相同内容只推一次') },
          h(Toggle, { on: flag('dedupe'), onChange: v => setDraft('dedupe', v) })),
        h(Field, { key: 'priv', label: t('允许私网图片'), hint: hintFor('allow_private_image_urls') },
          h(Toggle, { on: flag('allow_private_image_urls'), onChange: v => setDraft('allow_private_image_urls', v) }))
      ]
    })
  ])
}

/* ── 组件：试推 ──────────────────────────────────────────────────────── */

function TestCard({ snap }) {
  const devices = (snap && snap.devices) || []
  const result = store.testResult
  const set = (key, value) => {
    store.test[key] = value
    publish()
  }
  const body = store.test
  /** 正文留空时用本地化的默认文案，避免英文用户收到中文占位文本。 */
  const payload = () => ({ ...body, body: body.body || t('来自 Hermes 的测试推送') })

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
        flash(t('已投递到 ') + data.alias + ' · HTTP ' + data.status + ' · ' + data.latency_ms + ' ms')
      } else {
        toast(data.error || t('推送失败'), 'error')
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
      ? t('预览（未发送）')
      : last && last.ok
        ? 'HTTP ' + last.status + ' · ' + ago(result.at)
        : t('推送失败')
    : t('只有点了「发送测试」才会真的到手机')

  return h(Disclosure, {
    title: t('试推'),
    summary,
    tone: C.accent
  }, [
    h('p', { key: 'note', style: { margin: 0, fontSize: FS.small, color: C.fg4, lineHeight: '17px' } },
      t('先看清楚 Bark 会收到什么，再决定发不发。device_key 不会显示在页面上。')),
    h(Field, { key: 'dev', label: t('目标设备') },
      devices.length
        ? h(Segmented, {
            value: body.device || (snap && snap.default_device) || '',
            options: devices.map(row => ({ value: row.alias, label: row.alias + (row.is_default ? t('（默认）') : '') })),
            onChange: v => set('device', v)
          })
        : h('span', { style: { fontSize: FS.tiny, color: C.orange } }, t('先在上面添加一台设备'))),
    h(Field, { key: 'title', label: t('标题'), hint: t('留空用默认标题') },
      h(Input, { value: body.title, onChange: v => set('title', v), width: 200, placeholder: 'Hermes' })),
    h(Field, { key: 'body', label: t('正文'), hint: t('支持中文与符号；超过约 3800 字会被 Bark 截断') },
      h(Input, { value: body.body, onChange: v => set('body', v), width: 320, placeholder: t('来自 Hermes 的测试推送'), onEnter: send })),
    h(Field, { key: 'level', label: t('覆盖级别'), hint: t('留空 = 用上面的默认级别') },
      h(Segmented, {
        value: body.level,
        options: [{ value: '', label: t('默认') }, { value: 'active', label: t('活跃') }, { value: 'timeSensitive', label: t('时效') }, { value: 'critical', label: t('紧急') }],
        onChange: v => set('level', v)
      })),
    h(Field, { key: 'image', label: t('图片 URL'), hint: t('Bark 服务端抓取，只收 http(s)') },
      h(Input, { value: body.image, onChange: v => set('image', v), width: 300, mono: true, placeholder: 'https://…/x.png' })),
    hs('div', { key: 'act', style: { display: 'flex', gap: 8, marginTop: 'auto', paddingTop: 4, flexWrap: 'wrap' }, children: [
      h(Btn, { key: 'p', onClick: preview, disabled: store.testBusy || Boolean(store.busy) }, t('预览 JSON')),
      h(Btn, { key: 's', active: true, onClick: send, disabled: store.testBusy || !devices.length }, store.testBusy ? t('发送中…') : t('发送测试')),
      h('span', { key: 'h', style: { fontSize: FS.tiny, color: C.fg4, alignSelf: 'center' } },
        t('预填 ≠ 发送：只有点了「发送测试」才会真的到手机'))
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
              result.kind === 'preview' ? t('预览（未发送）') : result.data.ok ? t('已入队 APNs') : t('失败')),
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
                t('HTTP 200 只代表 bark-server 已提交给 APNs；手机是否显示取决于系统通知权限。'))
            : null
        ] }))
      : null
  ])
}

/* ── 组件：最近投递 ──────────────────────────────────────────────────── */

const SOURCE_CN = { notify: t('通知'), send: t('发送'), cron: 'cron', dashboard: t('测试') }

function EventsCard({ snap }) {
  const events = (snap && snap.events) || []
  const stats = (snap && snap.stats) || {}
  const clear = async () => {
    const result = await run('events', () => api('/events', { method: 'DELETE', timeoutMs: 10000 }))
    if (result) {
      flash(t('已清空投递记录'))
      refresh(true)
    }
  }
  return h(Card, {
    title: t('最近投递'),
    hint: t('来自通知钩子、cron、hermes send 与试推的合并记录（本机 plugin-data）。'),
    action: hs('div', { style: { display: 'flex', gap: 6, alignItems: 'center' }, children: [
      h('span', { key: 'c', style: { fontSize: FS.tiny, color: C.fg4 } },
        t('成功 ') + String(stats.sent || 0) + t(' · 失败 ') + String(stats.failed || 0)),
      events.length ? h(Btn, { key: 'x', ghost: true, onClick: clear, disabled: Boolean(store.busy) }, t('清空')) : null
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
              }, row.ok ? (row.title ? row.title + ' · ' : '') + (row.body || '') : (row.error || t('失败'))),
              row.latency_ms !== null && row.latency_ms !== undefined
                ? h('span', { key: 'l', style: { fontSize: FS.micro, color: C.fg4, fontFamily: MONO, width: 52, textAlign: 'right' } }, row.latency_ms + 'ms')
                : null
            ]
          }))
        })
      : h('div', { key: 'empty', style: { display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, minHeight: 90 } },
          h(Empty, {}, t('还没有投递记录。点上面的「发送测试」会产生第一条。')))
  ])
}

/* ── 组件：配置与诊断 ────────────────────────────────────────────────── */

function ConfigCard({ snap }) {
  const plugin = (snap && snap.plugin) || {}
  const warnings = (store.error
    ? [{ level: 'error', text: t('后端不可达：') + store.error }]
    : (snap && snap.warnings) || [])
  const toneOf = level => (level === 'error' ? C.red : level === 'warn' ? C.orange : C.fg4)
  const rows = [
    [t('插件版本'), (plugin.version || '—') + (plugin.router_version ? ' · api ' + plugin.router_version : '')],
    ['config.yaml', plugin.config_path || '—'],
    ['.env', (plugin.env_files || []).join('  ·  ') || '—'],
    [t('插件目录'), plugin.dir || '—'],
    [t('服务器'), (snap && snap.server && snap.server.url) || '—'],
    [t('通知规则'), snap && snap.notify ? JSON.stringify(snap.notify) : '—']
  ]
  return h(Card, { title: t('配置与诊断'), hint: t('密钥只显示在 .env 里的落点，不显示值。') }, [
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
      : h('span', { key: 'ok', style: { fontSize: FS.small, color: C.fg4 } }, t('没有发现配置问题。'))
  ])
}

/* ── 页面 ────────────────────────────────────────────────────────────── */

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
        : h(Card, { key: 'loading', title: t('通道') },
            h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 90 } },
              h(Empty, {}, store.error ? t('后端不可达：') + store.error : t('正在读取配置…')))),
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

/* ── 注册 ────────────────────────────────────────────────────────────── */

export default {
  id: ID,
  name: t('Bark 通知'),
  description: t('Bark iOS 推送：通道状态、设备映射、行为规则、试推与投递记录'),
  register(ctx) {
    CTX = ctx
    // 后端文案也跟语言走：插件 API 用 ?lang=zh|en（其它语言一律 en）。
    const withLang = path => path + (path.includes('?') ? '&' : '?') + 'lang=' + (isChinese() ? 'zh' : 'en')
    REST = (path, options) => ctx.rest(withLang(path), options)

    // 语言包：中文原文即键，宿主语言非中文时回落 en（其它语言也会落到 en）。
    try {
      ctx.i18n.register({ en: EN, zh: zhBundle(), 'zh-hant': zhBundle() })
      T = ctx.i18n.t
    } catch {
      /* 老宿主没有插件 i18n：保持本地兜底 */
    }

    ctx.register({ id: 'nav', area: 'sidebar.nav', data: { codicon: 'bell', label: t('Bark 通知'), path: ROUTE } })

    ctx.register({
      id: 'page',
      area: 'routes',
      title: t('Bark 通知'),
      data: { path: ROUTE },
      render: () => h(BarkPage, {})
    })

    ctx.register({
      id: 'palette',
      area: 'palette',
      order: 236,
      data: {
        id: 'hermes-bark.open',
        label: t('Bark 通知'),
        keywords: ['bark', 'push', 'notification', 'ios', '推送', '通知'],
        run: () => host.navigate(ROUTE)
      }
    })

    try {
      console.info('[hermes-bark] desktop plugin loaded')
    } catch {
      /* 控制台不可用不算失败 */
    }
  }
}
