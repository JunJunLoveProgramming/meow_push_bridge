/**
 * tests/client.spec.ts —— 浏览器半体（设置页表单）契约测试
 *
 * 依据 @deepseek-ai/dsh-client-modules 的真实实现（从 asar 读出）：
 *   - `exports["./client"]` 必须解析到一个**预构建文件**，格式为
 *     `window.__ModuleLoader__.load({ id, factory })`；
 *   - 文件缺失时 DSH 抛 MissingClientBundleError（"run `pnpm run build` before launch"）；
 *   - `dsh.client` 声明必须是对象且带 string 类型的 `platform`，
 *     `inject` / `external` 为字符串数组。
 *
 * 本测试在 Node 里假装一个 __ModuleLoader__，执行真实 bundle，验证模块契约。
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const CLIENT_PATH = new URL('../lib/client.js', import.meta.url)
const PKG_PATH = new URL('../package.json', import.meta.url)

const source = readFileSync(CLIENT_PATH, 'utf8')
const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf8')) as {
  exports: Record<string, unknown>
  dsh: { bundle: { patch: string }; client?: { platform?: unknown; inject?: unknown } }
  files: string[]
}

/** 执行 bundle，返回它注册的模块导出 */
function loadBundle(): Record<string, unknown> {
  return loadBundleWithReact({
    createElement: () => null,
    useState: () => [undefined, () => {}],
    useEffect: () => {},
    useCallback: (fn: unknown) => fn,
    useRef: () => ({ current: undefined }),
  })
}

/** 用指定的 React 替身执行 bundle */
function loadBundleWithReact(reactShim: Record<string, unknown>): Record<string, unknown> {
  let registered: Record<string, unknown> | undefined
  const scope = globalThis as unknown as { window?: unknown }
  const previous = scope.window
  scope.window = {
    __ModuleLoader__: {
      load(registration: { id: string; factory: (require: (spec: string) => unknown) => unknown }) {
        registered = registration.factory((spec: string) => {
          if (spec === 'react') return reactShim
          throw new Error(`unexpected require: ${spec}`)
        }) as Record<string, unknown>
      },
    },
  }
  try {
    // eslint-disable-next-line no-new-func -- 故意执行 bundle 源码以验证其契约
    new Function(source)()
  } finally {
    scope.window = previous
  }
  assert.ok(registered !== undefined, 'bundle 必须调用 window.__ModuleLoader__.load(...)')
  return registered
}

test('客户端 bundle 是预构建的 __ModuleLoader__ 格式', () => {
  assert.match(source, /window\.__ModuleLoader__\.load\(/)
  assert.match(source, /id: 'meow-push-bridge'/)
  // 不能依赖任何构建期注入的变量
  assert.ok(!source.includes('import.meta'), 'bundle 不应使用 import.meta（宿主按脚本执行）')
})

test('bundle 导出 apply / inject，且 apply 是函数', () => {
  const mod = loadBundle()
  assert.equal(typeof mod['apply'], 'function')
  assert.ok(Array.isArray(mod['inject']))
  const inject = mod['inject'] as string[]
  assert.ok(inject.includes('slots'), '必须注入 slots 才能注册设置页签')
  assert.ok(inject.includes('locale'), '必须注入 locale 才能提供中文标签')
  assert.ok(inject.includes('remote.settings'), '必须注入 remote.settings 才能读写配置')
})

test('apply 注册一个 settings.plugins.tab 页签（真实 ctx 形状）', () => {
  const mod = loadBundle()
  const registrations: { options: Record<string, unknown>; component: unknown }[] = []
  const dictionaries: string[] = []
  const ctx = {
    effect: (fn: () => unknown) => fn(),
    locale: {
      bind: () => (key: string) => key,
      register: (ns: string) => dictionaries.push(ns),
    },
    slots: {
      inject: (_slot: string, fn: () => unknown) => fn(),
      register: (options: Record<string, unknown>, component: unknown) => {
        registrations.push({ options, component })
        return () => {}
      },
    },
    remote: {
      settings: {
        describe: async () => ({ ok: true, value: { namespaces: [] } }),
        update: async () => ({ ok: true, value: {} }),
      },
    },
  }

  ;(mod['apply'] as (ctx: unknown) => void)(ctx)

  assert.equal(registrations.length, 1, '应恰好注册一个设置页签')
  const { options, component } = registrations[0] ?? {}
  assert.equal(options?.['name'], 'settings.plugins.tab')
  assert.equal(options?.['id'], 'meow-push-bridge')
  assert.equal(typeof options?.['order'], 'number')
  assert.equal(typeof options?.['label'], 'function')
  assert.equal(typeof component, 'function', '组件必须是函数（React 组件）')
  assert.ok(dictionaries.includes('meow-push-bridge'), '必须注册自己的字典命名空间')

  // inject() 必须提供宿主操作给组件
  const injected = (options?.['inject'] as () => Record<string, unknown>)()
  assert.ok('actions' in injected, 'inject() 必须提供 actions')
  const actions = injected['actions'] as Record<string, unknown>
  assert.equal(typeof actions['describe'], 'function')
  assert.equal(typeof actions['update'], 'function')
})

test('宿主操作把 remote.settings 的调用参数透传正确', async () => {
  const mod = loadBundle()
  const calls: unknown[][] = []
  let options: Record<string, unknown> | undefined
  const ctx = {
    effect: (fn: () => unknown) => fn(),
    locale: { bind: () => (key: string) => key, register: () => {} },
    slots: {
      inject: (_slot: string, fn: () => unknown) => fn(),
      register: (o: Record<string, unknown>) => {
        options = o
        return () => {}
      },
    },
    remote: {
      settings: {
        describe: async () => {
          calls.push(['describe'])
          return { ok: true, value: { namespaces: [{ ns: 'meow-push-bridge', revision: 3, user: { nickname: 'a' } }] } }
        },
        update: async (ns: string, patch: unknown, revision: unknown) => {
          calls.push(['update', ns, patch, revision])
          return { ok: true, value: { ns, revision: 4 } }
        },
      },
    },
  }

  ;(mod['apply'] as (ctx: unknown) => void)(ctx)
  const actions = (options?.['inject'] as () => { actions: Record<string, (...args: unknown[]) => Promise<unknown>> })().actions

  const described = (await actions['describe']!()) as { ok: boolean }
  assert.equal(described.ok, true)
  const updated = (await actions['update']!({ nickname: 'chuck' }, 3)) as { ok: boolean }
  assert.equal(updated.ok, true)
  assert.deepEqual(calls, [
    ['describe'],
    ['update', 'meow-push-bridge', { nickname: 'chuck' }, 3],
  ])
})

test('package.json 的客户端声明与产物齐备', () => {
  // exports["./client"] 必须存在且指向真实文件（DSH 会直接读这个文件的字节）
  const clientExport = pkg.exports['./client'] as Record<string, string> | undefined
  assert.ok(clientExport !== undefined, 'exports 必须包含 "./client"')
  assert.equal(clientExport['default'], './lib/client.js')

  const dshClient = pkg.dsh.client
  assert.ok(dshClient !== undefined, 'package.json 必须声明 dsh.client')
  assert.equal(typeof dshClient.platform, 'string')
  assert.ok(Array.isArray(dshClient.inject))

  // files 白名单必须同时包含宿主半体与浏览器半体
  assert.ok(pkg.files.includes('dist'), 'files 必须包含 dist（宿主半体）')
  assert.ok(pkg.files.includes('lib'), 'files 必须包含 lib（浏览器半体）')
  assert.ok(pkg.files.includes('cordis.patch.yml'), 'files 必须包含 patch 文件')
})

// ─────────────── 渲染：中文标签与页脚 ───────────────

interface FakeElement {
  type: unknown
  props: Record<string, unknown> & { children?: unknown }
}

/** 把 createElement 产出的虚拟树摊平成文本，便于断言界面上会出现哪些字 */
function renderText(element: unknown, collected: string[] = []): string[] {
  if (element === null || element === undefined || typeof element === 'boolean') return collected
  if (typeof element === 'string' || typeof element === 'number') {
    collected.push(String(element))
    return collected
  }
  if (Array.isArray(element)) {
    for (const child of element) renderText(child, collected)
    return collected
  }
  const node = element as FakeElement
  const children = node.props?.children
  renderText(children, collected)
  return collected
}

/** 渲染配置页签组件，返回界面文本（模拟 React 的重渲染，直到异步 describe 落地） */
async function renderTab(): Promise<string[]> {
  /**
   * 极简 React 替身：支持 useState 的重渲染。
   * 关键点：组件的首帧处于 loading 分支，字段与页脚在 describe() 完成后的 ready 分支，
   * 因此必须让 setState 触发重渲染，否则只测到 loading 文案。
   */
  let element: unknown = null
  let render: (() => void) | undefined
  const slots: unknown[] = []
  const effectDeps: unknown[][] = []
  const effectsDone = new Set<number>()
  /**
   * 每次渲染收集到的 effect。
   * 用对象数组持有（而不是闭包里的可变变量），否则 TS 会把变量窄化成 undefined。
   */
  const pending: { index: number; fn: () => unknown }[] = []
  let index = 0
  let scheduled = false

  const reactShim: Record<string, unknown> = {
    createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({
      type,
      props: {
        ...(props as Record<string, unknown> | null),
        children: children.length === 1 ? children[0] : children,
      },
    }),
    useState: (initial: unknown) => {
      const slot = index++
      if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? (initial as () => unknown)() : initial
      return [
        slots[slot],
        (next: unknown) => {
          const value = typeof next === 'function' ? (next as (prev: unknown) => unknown)(slots[slot]) : next
          if (Object.is(value, slots[slot])) return
          slots[slot] = value
          scheduled = true
        },
      ]
    },
    useEffect: (fn: () => unknown, deps?: unknown[]) => {
      const slot = index++
      if (effectsDone.has(slot)) {
        // 已执行过：仅在依赖变化时重新排队（避免每次渲染都跑，形成死循环）
        const previous = effectDeps[slot]
        const changed =
          deps === undefined ||
          previous === undefined ||
          deps.length !== previous.length ||
          deps.some((value, i) => !Object.is(value, previous[i]))
        if (!changed) return
      }
      effectDeps[slot] = deps === undefined ? [] : [...deps]
      pending.push({ index: slot, fn })
    },
    useCallback: (fn: unknown) => fn,
    useRef: () => ({ current: undefined }),
  }

  const mod = loadBundleWithReact(reactShim)
  const registrations: { options: Record<string, unknown>; component: unknown }[] = []
  const dictionaries: { ns: string; zh: Record<string, string> }[] = []

  const ctx = {
    effect: (fn: () => unknown) => fn(),
    locale: {
      // 真实行为：按当前语言取词。这里固定取 zh，验证「界面全中文」
      bind: (ns: string) => (key: string) => {
        const dict = dictionaries.find((entry) => entry.ns === ns)
        return dict?.zh?.[key] ?? key
      },
      register: (ns: string, dict: { zh: Record<string, string> }) => dictionaries.push({ ns, zh: dict.zh }),
    },
    slots: {
      inject: (_slot: string, fn: () => unknown) => fn(),
      register: (options: Record<string, unknown>, component: unknown) => {
        registrations.push({ options, component })
        return () => {}
      },
    },
    remote: {
      settings: {
        // 返回一个可渲染的命名空间，让组件进入 ready 分支（字段与页脚都在该分支）
        describe: async () => ({
          ok: true,
          value: {
            namespaces: [
              {
                ns: 'meow-push-bridge',
                revision: 1,
                user: { nickname: 'n', pushMode: 'every-turn' },
                value: { nickname: 'n', pushMode: 'every-turn' },
              },
            ],
          },
        }),
        update: async () => ({ ok: true, value: {} }),
      },
    },
  }

  ;(mod['apply'] as (ctx: unknown) => void)(ctx)
  const component = registrations[0]?.component as ((props: unknown) => unknown) | undefined
  assert.equal(typeof component, 'function')

  const injected = (registrations[0]?.options?.['inject'] as () => Record<string, unknown>)()
  const t = ctx.locale.bind('meow-push-bridge')
  render = () => {
    element = component?.({ t, ...injected })
  }

  // 驱动：渲染 → 执行本轮收集到的 effect → 等待异步 describe 落地 → 若状态变了再渲染
  for (let pass = 0; pass < 10; pass += 1) {
    scheduled = false
    pending.length = 0
    index = 0
    render?.()

    let ranEffect = false
    for (const effect of pending) {
      if (effectsDone.has(effect.index)) continue
      effectsDone.add(effect.index)
      effect.fn()
      ranEffect = true
    }

    // 让 describe() 的 promise 与随后可能的 setState 都完成
    for (let tick = 0; tick < 4; tick += 1) await new Promise((resolve) => setTimeout(resolve, 0))
    if (!scheduled && !ranEffect) break
  }

  return renderText(element)
}

test('设置页只保留「昵称」一个字段，且不再出现已移除的配置项', async () => {
  const text = (await renderTab()).join('')
  assert.ok(text.includes('MeoW 昵称'), `缺少中文标签：MeoW 昵称（实际渲染：${text}）`)

  // 已移除的配置项不得再出现在界面上（按用户要求只保留昵称）
  const removed = [
    'API 地址',
    '请求方法',
    '请求超时',
    '节流窗口',
    '自动推送模式',
    '消息格式',
    'HTML 显示高度',
    '通知图标',
    'apiBase',
    'method',
    'timeout',
    'throttleMs',
    'pushMode',
    'msgType',
    'htmlHeight',
    'imgUrl',
    'every-turn',
    'substantial',
  ]
  for (const needle of removed) {
    assert.ok(!text.includes(needle), `界面不应再出现已移除的配置项：${needle}`)
  }
})

test('设置页页脚包含版权与 QQ 交流群', async () => {
  const text = (await renderTab()).join('')
  assert.ok(text.includes('2026'), '页脚应含版权年份')
  assert.ok(text.includes('骏骏爱编程'), '页脚应含作者')
  assert.ok(text.includes('1051489523'), '页脚应含 QQ 群号')
})

test('字典只保留昵称相关的键，已移除字段的死键已清理', () => {
  const mod = loadBundle()
  assert.equal(typeof mod['apply'], 'function')
  // 仍需要的键
  for (const key of ['nickname', 'nicknameHint', 'save', 'copyright', 'qqGroup']) {
    assert.ok(new RegExp(`${key}: '([^']*)'`).test(source), `缺少字典键：${key}`)
  }
  // 已移除字段的键不应再存在
  for (const key of ['apiBase', 'pushMode', 'msgType', 'htmlHeight', 'method', 'timeout']) {
    assert.ok(!new RegExp(`^\\s+${key}: '`, 'm').test(source), `字典里仍有死键：${key}`)
  }
  assert.ok(source.includes('QQ 交流群：1051489523'))
})
