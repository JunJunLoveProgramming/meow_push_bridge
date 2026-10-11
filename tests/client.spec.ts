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
  let registered: Record<string, unknown> | undefined
  const scope = globalThis as unknown as { window?: unknown }
  const previous = scope.window
  scope.window = {
    __ModuleLoader__: {
      load(registration: { id: string; factory: (require: (spec: string) => unknown) => unknown }) {
        registered = registration.factory((spec: string) => {
          if (spec === 'react') {
            return {
              createElement: () => null,
              useState: () => [undefined, () => {}],
              useEffect: () => {},
              useCallback: (fn: unknown) => fn,
              useRef: () => ({ current: undefined }),
            }
          }
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
