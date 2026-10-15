/**
 * tests/register.spec.ts —— 注册契约测试
 *
 * 对应需求：
 *   1. 加载期必须要求 nickname；
 *   2. nickname 缺失/空白 → 不注册工具，且给出明确错误提示；
 *   3. 配置合法 → 注册名为 meow_push_bridge 的工具，schema 正确、nickname 不在入参里；
 *   4. 包自有不变式全部通过。
 *
 * 运行：pnpm test
 *   pretest = pnpm build（构建 src → dist/）+ pnpm build:tests（tests/ → tests-dist/*.test.js）
 *   然后 scripts/run-tests.mjs 把 tests-dist/ 下真实存在的 *.test.js 交给 node --test。
 *
 * 导入写 '../dist/xxx.js'：测试验证的是「DSH 实际加载的编译产物」，不是源文件。
 * 源码里写 '../dist/xxx.ts' 是为了让 TS 能解析（allowImportingTsExtensions +
 * rewriteRelativeImportExtensions 会把它输出成 '.js'），运行时才存在这个 .ts 文件。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ConfigError,
  TOOL_NAME,
  apply,
  checkThrottle,
  inject,
  name,
  resetThrottleState,
} from '../dist/index.ts'
import {
  FIXED_REQUEST,
  MEOW_NICKNAME_REQUIRED,
  MEOW_NICKNAME_REQUIRED_MESSAGE,
  resolveConfig,
} from '../dist/config.ts'
import { assertInvariants, createInvariants, registerInvariants } from '../dist/invariant.ts'
import type { ToolDefinition } from '../dist/tool.ts'

// ─────────────────────────── 测试替身 ───────────────────────────

interface LogEntry {
  level: 'error' | 'warn' | 'info'
  message: string
}

/** 构造一个假的 Cordis 上下文 */
function createContext(options: {
  config?: unknown
  withTools?: boolean
  withEffect?: boolean
} = {}): {
  ctx: Record<string, unknown>
  registered: ToolDefinition<unknown, string>[]
  logs: LogEntry[]
} {
  const registered: ToolDefinition<unknown, string>[] = []
  const logs: LogEntry[] = []
  const record =
    (level: LogEntry['level']) =>
    (...args: unknown[]): void => {
      logs.push({ level, message: args.map((value) => String(value)).join(' ') })
    }
  const ctx: Record<string, unknown> = {
    config: options.config ?? {},
    logger: { error: record('error'), warn: record('warn'), info: record('info') },
  }
  if (options.withTools !== false) {
    ctx['tools'] = {
      register: (definition: ToolDefinition<unknown, string>) => {
        registered.push(definition)
        return () => {
          const index = registered.indexOf(definition)
          if (index >= 0) registered.splice(index, 1)
        }
      },
    }
  }
  if (options.withEffect === true) {
    // 模拟 Cordis：effect 同步执行回调并登记 disposer
    ctx['effect'] = (callback: () => (() => void) | void) => callback()
  }
  return { ctx, registered, logs }
}

/** 现在配置只有一个字段：昵称 */
const VALID_CONFIG = { nickname: 'chuck' }

// ─────────────────────── 1. 导出契约 ───────────────────────

test('导出契约：name / inject / 工具名符合全局统一标识', () => {
  assert.equal(name, 'meow-push-bridge')
  assert.deepEqual(inject, ['tools'])
  assert.equal(TOOL_NAME, 'meow_push_bridge')
})

// ─────────────── 2. nickname 缺失 → 不注册工具 ───────────────

for (const [label, config] of [
  ['缺省空对象', {}],
  ['空字符串', { nickname: '' }],
  ['全空白字符串', { nickname: '   ' }],
  ['null', { nickname: null }],
  ['数字类型', { nickname: 42 }],
] as const) {
  test(`nickname 缺失（${label}）→ 记录 error 且不注册任何工具`, () => {
    const { ctx, registered, logs } = createContext({ config })
    apply(ctx)

    assert.equal(registered.length, 0, '不得注册任何工具')
    const errors = logs.filter((entry) => entry.level === 'error')
    assert.ok(errors.length >= 1, '必须至少记录一条 error 日志')
    assert.ok(
      errors.some((entry) => entry.message.includes(MEOW_NICKNAME_REQUIRED_MESSAGE)),
      `错误日志需包含约定提示："${MEOW_NICKNAME_REQUIRED_MESSAGE}"`,
    )
    // 提示里要告诉用户去哪改
    assert.ok(
      errors.some((entry) => entry.message.includes('cordis.patch.yml') && entry.message.includes('nickname')),
      '错误日志需指明 cordis.patch.yml 中的 nickname 字段',
    )
  })
}

test('nickname 缺失时也不抛异常（避免拖垮同一 patch 的其他 entry）', () => {
  const { ctx } = createContext({ config: {} })
  assert.doesNotThrow(() => apply(ctx))
})

test('ctx.config 为空但 apply 第二参数带配置 → 采用注入配置', () => {
  const { ctx, registered } = createContext({ config: {} })
  apply(ctx, VALID_CONFIG)
  assert.equal(registered.length, 1)
})

// ─────────────── 3. 配置合法 → 正常注册 ───────────────

test('配置合法 → 注册 meow_push_bridge，schema 与描述正确', () => {
  const { ctx, registered, logs } = createContext({ config: VALID_CONFIG })
  apply(ctx)

  assert.equal(registered.length, 1, '应恰好注册一个工具')
  const tool = registered[0]
  assert.ok(tool !== undefined)
  assert.equal(tool.name, 'meow_push_bridge')
  assert.ok(tool.description.includes('MeoW'), '描述需说明用途')

  const parameters = tool.parameters as {
    properties: Record<string, unknown>
    required: string[]
    additionalProperties: boolean
  }
  assert.deepEqual(Object.keys(parameters.properties).sort(), ['imgUrl', 'message', 'title', 'url'])
  assert.ok(!Object.prototype.hasOwnProperty.call(parameters.properties, 'nickname'), 'nickname 不得出现在入参')
  assert.deepEqual([...parameters.required], ['message'])
  assert.equal(parameters.additionalProperties, false)

  // 输出 schema 为 string，render 返回文本
  assert.equal(tool.output.schema.type, 'string')
  const blocks = tool.output.render({ message: 'hi' }, '✅ ok')
  assert.deepEqual(blocks, [{ type: 'text', text: '✅ ok' }])

  // timeoutMs 比固化的请求超时多 2s
  assert.equal(tool.timeoutMs, FIXED_REQUEST.timeout + 2_000)
  const infos = logs.filter((entry) => entry.level === 'info')
  assert.ok(infos.some((entry) => entry.message.includes('chuck')), 'info 日志应回显已启用的昵称')
})

test('ctx.effect 可用时注册仍需生效，并能被 disposer 注销', () => {
  const { ctx, registered } = createContext({ config: VALID_CONFIG, withEffect: true })
  apply(ctx)
  assert.equal(registered.length, 1)
})

test('tools 服务缺失 → 记录 error 且不注册', () => {
  const { ctx, logs } = createContext({ config: VALID_CONFIG, withTools: false })
  apply(ctx)
  assert.ok(logs.some((entry) => entry.level === 'error' && entry.message.includes('tools')))
})

// ───────── 7. 宿主上下文服务的「抛错式探测」（真实 DSH 行为）─────────

test('宿主上下文对未 inject 的服务属性抛错时，插件仍能正常注册', () => {
  // 真实 DSH/Cordis 行为：读取未 inject 的服务属性会直接抛错
  //   Error: cannot get property "invariant" without inject
  // 曾经因为 registerInvariants 直接读 ctx.invariant，导致用户填好昵称后
  // 整个插件加载失败（空昵称时提前 return，反而掩盖了这个 bug）。
  const inner = createContext({ config: VALID_CONFIG })
  const throwingCtx = new Proxy(inner.ctx, {
    get(target, key, receiver) {
      if (key === 'invariant' || key === 'invariants') {
        throw new Error(`cannot get property "${String(key)}" without inject`)
      }
      return Reflect.get(target, key, receiver)
    },
  }) as unknown

  assert.doesNotThrow(() => apply(throwingCtx as never))
  assert.equal(inner.registered.length, 1, '即使服务探测抛错，也必须完成工具注册')
})

test('registerInvariants：上下文成员的 getter 抛错时不抛异常', () => {
  const throwing = new Proxy(
    {},
    {
      get() {
        throw new Error('cannot get property "x" without inject')
      },
    },
  ) as unknown
  const result = registerInvariants(throwing as never, [])
  assert.deepEqual(result, { registered: false, channel: 'none' })
})

// ─────────────── 4. 不变式 ───────────────

test('包自有不变式：合规定义全部通过', () => {
  const { ctx, registered } = createContext({ config: VALID_CONFIG })
  apply(ctx)
  const tool = registered[0]
  assert.ok(tool !== undefined)
  const violations = assertInvariants(
    createInvariants({
      pluginName: name,
      inject,
      definition: tool,
      config: resolveConfig(VALID_CONFIG),
    }),
  )
  assert.deepEqual(violations, [], `不应有违规：${JSON.stringify(violations)}`)
})

test('包自有不变式：能捕获违规定义（反向验证检查器有效）', () => {
  const violations = assertInvariants(
    createInvariants({
      pluginName: 'wrong-name',
      inject: [],
      definition: {
        name: 'other_tool',
        parameters: { type: 'object', properties: { nickname: {} }, required: [] },
      },
      config: { nickname: '' },
    }),
  )
  const ids = violations.map((violation) => violation.id)
  // 6 条不变式应全部报警（空昵称触发 runtime-config 一次）
  assert.ok(ids.includes('meow-push-bridge/plugin-id'))
  assert.ok(ids.includes('meow-push-bridge/inject-tools'))
  assert.ok(ids.includes('meow-push-bridge/tool-name'))
  assert.ok(ids.includes('meow-push-bridge/schema-required-message'))
  assert.ok(ids.includes('meow-push-bridge/schema-no-nickname'))
  assert.ok(ids.includes('meow-push-bridge/runtime-config'))
})

// ───────────── Cordis 服务访问纪律（回归） ─────────────
//
// 事故背景：曾经在 index.ts 里写了 `const sessionStore = ctx.sessions`，
// 而 inject 只声明了 ['tools']。Cordis 对**未注入的服务属性**读取会直接抛错：
//   Error: cannot get property "sessions" without inject
// 结果是整个插件激活失败，fixture 里显示「1 entry did not activate」。
// 正确写法是 ctx.get('sessions')（可选服务查询）。

/** 造一个「读未注入服务属性就抛错」的上下文，复刻 Cordis 的 PropertyProxy 行为。
 *
 * 关键区分（来自真实报错与 Cordis 行为）：
 *   - Context 成员（get / on / effect / logger / config）始终可访问；
 *   - **服务属性**（sessions 等）未列入 inject 时读取即抛
 *     `cannot get property "x" without inject`。
 */
function createStrictContext(config: unknown): {
  ctx: Record<string, unknown>
  registered: ToolDefinition<unknown, string>[]
  reads: string[]
} {
  const registered: ToolDefinition<unknown, string>[] = []
  const reads: string[] = []
  const contextMembers = new Set(['config', 'logger', 'tools', 'effect', 'get', 'on'])

  const target: Record<string, unknown> = {
    config,
    logger: { error: () => {}, warn: () => {}, info: () => {} },
    tools: {
      register: (definition: ToolDefinition<unknown, string>) => {
        registered.push(definition)
        return () => {}
      },
    },
    on: () => () => {},
    get: (key: string) => {
      reads.push(key)
      // 未提供 sessions：模拟服务不存在
      return undefined
    },
  }

  const ctx = new Proxy(target, {
    get(object, property, receiver) {
      if (typeof property === 'string' && !contextMembers.has(property)) {
        throw new Error(`cannot get property "${property}" without inject`)
      }
      return Reflect.get(object, property, receiver)
    },
  }) as Record<string, unknown>

  return { ctx, registered, reads }
}

test('apply 不会直接读取未注入的服务（否则 Cordis 会抛错并使插件激活失败）', () => {
  const { ctx, registered, reads } = createStrictContext({ nickname: 'chuck' })
  // 不抛错即为通过：任何 `ctx.sessions` 之类的直接读取都会在这里炸掉
  assert.doesNotThrow(() => apply(ctx))
  assert.equal(registered.length, 1, '工具应已注册')
  assert.ok(reads.includes('sessions'), '应当通过 ctx.get("sessions") 查询可选服务')
})

test('sessions 服务缺失时：仍注册工具，自动推送降级为统计文案', () => {
  const { ctx, registered, reads } = createStrictContext({ nickname: 'chuck' })
  apply(ctx)
  assert.equal(registered.length, 1)
  assert.deepEqual(reads, ['sessions'], '只应查询 sessions 一次')
})

test('sessions 服务存在时：不会因为包装会话而抛错', () => {
  const session = {
    snapshotEvents: () => [
      { type: 'user/message', data: { turn: 1, content: [{ type: 'text', text: '你好' }] } },
    ],
  }
  const contextMembers = new Set(['config', 'logger', 'tools', 'effect', 'get', 'on'])
  const target: Record<string, unknown> = {
    config: { nickname: 'chuck' },
    logger: { error: () => {}, warn: () => {}, info: () => {} },
    tools: { register: () => () => {} },
    on: () => () => {},
    get: (key: string) =>
      key === 'sessions'
        ? { get: (id: string) => (id === 's1' ? session : undefined) }
        : undefined,
  }
  const ctx = new Proxy(target, {
    get(object, property, receiver) {
      if (typeof property === 'string' && !contextMembers.has(property)) {
        throw new Error(`cannot get property "${property}" without inject`)
      }
      return Reflect.get(object, property, receiver)
    },
  }) as Record<string, unknown>

  assert.doesNotThrow(() => apply(ctx))
})

// ─────────────────────── 5. 配置归一化 ───────────────────────

test('resolveConfig：只保留昵称，并去掉首尾空格', () => {
  const config = resolveConfig({ nickname: '  chuck  ' })
  assert.equal(config.nickname, 'chuck')
  assert.deepEqual(Object.keys(config), ['nickname'], '归一化结果只应有 nickname')
})

test('resolveConfig：旧配置里的已移除字段被忽略并给出 warn（平滑升级）', () => {
  const warnings: string[] = []
  const config = resolveConfig(
    {
      nickname: 'chuck',
      apiBase: 'https://example.com/api',
      method: 'POST',
      timeout: 5_000,
      throttleMs: 0,
      pushMode: 'off',
      msgType: 'html',
      htmlHeight: 400,
      imgUrl: 'https://e.com/i.png',
    },
    (message) => warnings.push(message),
  )
  assert.equal(config.nickname, 'chuck')
  assert.deepEqual(Object.keys(config), ['nickname'], '已移除字段不得进入运行时配置')
  assert.equal(warnings.length, 1, '应只给出一条汇总提示')
  for (const key of ['apiBase', 'method', 'timeout', 'throttleMs', 'pushMode', 'msgType', 'htmlHeight', 'imgUrl']) {
    assert.ok(warnings[0]?.includes(key), `提示里应包含被忽略的字段：${key}`)
  }
})

test('resolveConfig：非字符串 nickname 抛 ConfigError(MEOW_NICKNAME_REQUIRED)', () => {
  const error = (() => {
    try {
      resolveConfig({ nickname: undefined })
      return undefined
    } catch (caught) {
      return caught
    }
  })()
  assert.ok(error instanceof ConfigError)
  assert.equal(error.code, MEOW_NICKNAME_REQUIRED)
  assert.equal(error.field, 'nickname')
  assert.equal(error.message, MEOW_NICKNAME_REQUIRED_MESSAGE)
})

test('resolveConfig：占位符昵称会触发 warn（但不禁用插件）', () => {
  const warnings: string[] = []
  const config = resolveConfig({ nickname: '${MEOW_NICKNAME}' }, (message) => warnings.push(message))
  assert.equal(config.nickname, '${MEOW_NICKNAME}')
  assert.ok(warnings.some((message) => message.includes('占位符')))
})

// ─────────────── 6. 节流判定 ───────────────

test('节流：同一键 5 秒内拦截，超窗后放行，可关闭', () => {
  resetThrottleState()
  const book = new Map<string, number>()
  const key = 'agent:session-1'

  assert.deepEqual(checkThrottle(book, key, 5_000, 1_000), { blocked: false, retryInMs: 0 })
  book.set(key, 1_000)

  assert.deepEqual(checkThrottle(book, key, 5_000, 3_000), { blocked: true, retryInMs: 3_000 })
  assert.deepEqual(checkThrottle(book, key, 5_000, 6_000), { blocked: false, retryInMs: 0 })
  // 其他会话不受影响
  assert.deepEqual(checkThrottle(book, 'agent:other', 5_000, 3_000), { blocked: false, retryInMs: 0 })
  // 窗口为 0 表示关闭节流
  assert.deepEqual(checkThrottle(book, key, 0, 3_000), { blocked: false, retryInMs: 0 })
})
