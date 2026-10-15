/**
 * meow-push-bridge / MeoW Push Bridge (喵桥)
 * src/index.ts —— 插件入口：加载期配置校验 + 工具注册 + 推送执行
 *
 * 加载期行为：
 *   - 从 ctx.config（或 apply 的第二参数 config）读取插件配置；
 *   - nickname 缺失/空白 → 记录 error 日志并直接 return，绝不注册工具；
 *   - 校验通过 → 注册 meow_push_bridge 工具，向系统提示注册「任务完成自动推送」约定
 *     （见 src/prompt.ts），并按 pushMode 注册宿主侧自动推送（见 src/auto-push.ts）。
 *
 * 执行期行为：
 *   - 绑定「配置 + 会话键」的 5 秒节流，避免同一会话重复推送；
 *   - 调用 src/meow-api.ts 的 pushToMeow 完成 URL 构造、超时与错误分类。
 */

import { registerAutoPush, type AutoPushContext } from './auto-push.js'
import {
  ConfigError,
  DEFAULT_API_BASE,
  FIXED_REQUEST,
  FIXED_THROTTLE_MS,
  MEOW_NICKNAME_REQUIRED_MESSAGE,
  resolveConfig,
  type ResolvedMeoWConfig,
  type WarnSink,
} from './config.js'
import { DEFAULT_TITLE, formatOutcome, pushToMeow, type PushOutcome } from './meow-api.js'
import { assertInvariants, createInvariants, registerInvariants } from './invariant.js'
import { registerPromptSection } from './prompt.js'
import { SchemaBuilder } from './schema.js'
import { defineTool, text, type ToolDefinition } from './tool.js'

/**
 * 文档规定的发送间隔下限（毫秒）。
 * 依据官方文档「通用说明」：非会员上限为 3 秒 1 条、每分钟 15 条、每小时 60 条，
 * 超出返回业务状态码 429。这里对**自动推送**做同样的最小间隔保护，
 * 避免每轮必推时把 3 秒内连续的多轮打到 429。
 */
export const MIN_SEND_INTERVAL_MS = 3_000

/**
 * Config schema 声明（Cordis 约定：插件模块导出 `Config`）。
 *
 * 作用：让 DSH 的 settings 服务把本插件配置投影成「设置页表单」，
 * 用户无需手写 YAML 即可填写 MeoW 昵称。
 *
 * 为什么这里能生效（来自 @deepseek-ai/cordis 的真实实现）：
 *   function resolveConfig(runtime, config) {
 *     if (!runtime.Config) return config
 *     const result = runtime.Config['~standard'].validate(config)
 *     if ('then' in result) throw new TypeError('Async config validation is not supported')
 *     if (result.issues) throw new ValidationError(result.issues)
 *     else return result.value
 *   }
 * 即：必须提供「字符串键 `~standard`」上的 Standard Schema 接口（同步）。
 * 本插件用零依赖的 src/schema.ts 实现该契约。
 *
 * ⚠️ nickname 刻意不标 required：schema 只决定「设置页有哪些字段」，
 *    「昵称缺失则不注册工具」由运行期校验（src/config.ts）强制执行 ——
 *    用户随时可能在表单里把输入框清空，运行期才是权威。
 */
export const Config = SchemaBuilder.object({
  nickname: SchemaBuilder.string()
    .description(
      '必填：你的 MeoW 用户昵称（对应推送地址第一段；官方文档：昵称不允许包含斜杠）',
    )
    // .volatile() 是设置页出现表单的硬性要求：dsh-settings 的 volatileForm()
    // 会剪掉所有未标 volatile 的字段，全被剪掉就等于设置页里看不到本插件。
    .volatile(),
}).volatile()

/** 插件 ID / Cordis 插件名（与 npm 包名、仓库名保持全局统一） */
export const name = 'meow-push-bridge'

/** 依赖 tools 服务：缺少时 Cordis 不会激活本插件（而非半激活） */
export const inject = ['tools']

/** 工具名 */
export const TOOL_NAME = 'meow_push_bridge'

/**
 * Cordis 上下文的最小结构声明（只声明本插件真正用到的成员）。
 *
 * 说明：这里不 `import type { Context } from '@deepseek-ai/cordis'`，原因同 tool.ts：
 * 当前 DSH 的 @deepseek-ai/* 包不保证可被插件侧解析。若将来官方类型可解析，
 * 可改为 `import type { Context } from '@deepseek-ai/cordis'` 并删除本接口。
 */
interface PluginContext {
  /** loader 注入的 config 段 */
  readonly config?: unknown
  /** 日志（Cordis 提供 error/warn/info；此处按可选处理以兼容不同版本） */
  readonly logger?: {
    error?(...args: unknown[]): void
    warn?(...args: unknown[]): void
    info?(...args: unknown[]): void
  }
  /** tools 服务；Cordis 会因 inject 声明而注入 */
  readonly tools?: {
    register(
      definition: ToolDefinition<MeowToolArgs, string>,
    ): () => void
  }
  /** 生命周期副作用登记，Dispose 时自动清理（HMR 卸载时注销工具） */
  effect?(callback: () => (() => void) | void, label?: string): unknown
  /** 系统提示服务；缺省时跳过「任务完成自动推送」提示词注册（不影响工具） */
  readonly systemPrompt?: unknown
  /**
   * 可选服务查询。
   *
   * ⚠️ 可选服务（如 sessions）**必须**走这个方法读取，不能直接写 `ctx.sessions`：
   * Cordis 对未列入 `inject` 的服务属性读取会抛
   * `Error: cannot get property "sessions" without inject`，
   * 导致整个插件激活失败。
   */
  get?(key: string): unknown
}

/**
 * 安全读取一个**可选**宿主服务。
 *
 * 优先用官方推荐的 `ctx.get(key)`；不可用时退化为带 try/catch 的属性读取
 * （老版本 Cordis 可能没有 `get`）。两条路径都不会抛出。
 */
function readOptionalService(ctx: PluginContext, key: string): unknown {
  if (typeof ctx.get === 'function') {
    try {
      return ctx.get(key)
    } catch {
      return undefined
    }
  }
  try {
    return (ctx as unknown as Record<string, unknown>)[key]
  } catch {
    return undefined
  }
}

/** 兜底日志：logger 不可用时回落到 console，保证「拒绝加载」绝不会静默 */
function log(
  ctx: PluginContext,
  level: 'error' | 'warn' | 'info',
  message: string,
): void {
  const sink = ctx.logger?.[level]
  if (typeof sink === 'function') {
    sink.call(ctx.logger, `[${name}] ${message}`)
    return
  }
  const fallback = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info
  fallback(`[${name}] ${message}`)
}

/** 判断是否为「无有效字段的普通对象」（用于 config 通道回退） */
function isEmptyTable(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value as Record<string, unknown>).length === 0
  )
}

/**
 * 节流簿键：优先会话/Agent id，其次工具调用 id，最后退化到全局键。
 *
 * 参数用 unknown 并在内部收窄，原因：DSH 的 ToolRunContext 是结构化类型，
 * exec 上一定有 signal，但 agent/callId 未必存在。若把形参声明为
 * `{ agent?; callId? }`，TS 会对传入的对象字面量做「多余属性检查」（TS2559），
 * 报 `{ signal } has no properties in common with ...`。
 */
function throttleKeyOf(exec: unknown): string {
  if (exec === null || typeof exec !== 'object') return 'global'
  const table = exec as { agent?: unknown; callId?: unknown }
  const agent = table.agent
  if (agent !== null && typeof agent === 'object') {
    const id = (agent as { id?: unknown }).id
    if (typeof id === 'string' && id !== '') return `agent:${id}`
  }
  if (typeof table.callId === 'string' && table.callId !== '') return `call:${table.callId}`
  return 'global'
}

// 节流簿放在模块作用域（而非 apply 闭包内），便于测试直接观察与重置。
const lastPushAt = new Map<string, number>()

/**
 * 最近一次「成功发出请求」的时间戳（毫秒）。
 *
 * 与 lastPushAt 的区别：lastPushAt 是**按会话**的节流簿，
 * 这个是**全局发送间隔**，用于遵守 MeoW 文档里的限流（非会员 3 秒 1 条）。
 * 自动推送每轮都会触发，多条消息在 3 秒内连发会被 MeoW 判 429，
 * 因此这里做客户端侧的间隔保护。
 */
let lastSendAt = 0

/** 清空节流簿（仅测试使用） */
export function resetThrottleState(): void {
  lastPushAt.clear()
  lastSendAt = 0
}

/** 距离下一次可发送还需等待多少毫秒（<=0 表示可以立刻发） */
export function remainingGlobalWindow(
  lastAt: number,
  minIntervalMs: number,
  now: number = Date.now(),
): number {
  if (minIntervalMs <= 0 || lastAt <= 0) return 0
  const elapsed = now - lastAt
  return elapsed >= minIntervalMs ? 0 : minIntervalMs - elapsed
}

/** 等待若干毫秒（用于遵守发送间隔） */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    ;(timer as { unref?: () => void }).unref?.()
  })
}

/** 节流判定结果 */
export interface ThrottleDecision {
  blocked: boolean
  retryInMs: number
}

/**
 * 同一会话的推送节流判定。
 *
 * 规则：键相同且距上次「成功推送」不足 windowMs → 拦截。
 * windowMs <= 0 表示关闭节流。
 */
export function checkThrottle(
  book: Map<string, number>,
  key: string,
  windowMs: number,
  now: number = Date.now(),
): ThrottleDecision {
  if (windowMs <= 0) return { blocked: false, retryInMs: 0 }
  const previous = book.get(key)
  if (previous === undefined) return { blocked: false, retryInMs: 0 }
  const elapsed = now - previous
  if (elapsed >= windowMs) return { blocked: false, retryInMs: 0 }
  return { blocked: true, retryInMs: windowMs - elapsed }
}

/**
 * 插件入口。
 *
 * @param ctx      Cordis 上下文（已声明 inject: ['tools']）
 * @param injected Loader 直接传入的 config（部分 Cordis 版本走此通道）
 */
export function apply(ctx: PluginContext, injected?: unknown): void {
  // ── 1. 校验配置：nickname 必填 ───────────────────────────────────
  // 兼容两种传参形态：Cordis 约定 apply(ctx, config)，同时 config 会镜像到 ctx.config。
  // 显式传入的 config 优先；它是空对象时回退 ctx.config（避免空 patch 覆盖已挂载配置）。
  const rawConfig =
    injected !== undefined && !isEmptyTable(injected) ? injected : ctx.config
  let config: ResolvedMeoWConfig
  try {
    const warn: WarnSink = (message) => log(ctx, 'warn', message)
    config = resolveConfig(rawConfig, warn)
  } catch (error) {
    if (error instanceof ConfigError) {
      // 刻意「不抛出」而是 return：
      //   抛出会让 Loader 显示插件加载失败（栈信息吓人且可能中断 profile 其余补丁）；
      //   return 让插件处于已加载但未注册任何工具的状态，错误提示清晰可读。
      log(ctx, 'error', `❌ 插件未启用：${MEOW_NICKNAME_REQUIRED_MESSAGE}`)
      log(
        ctx,
        'error',
        `   配置位置：profile 的 cordis.patch.yml → insert → id: ${name} → config.nickname；修改后保存即可热重载。`,
      )
      log(ctx, 'error', `   默认 API 地址：${DEFAULT_API_BASE}/{nickname}/{title}/{message}`)
      return
    }
    // 非预期错误（探针本身出错）：同样拒绝注册，避免带病运行
    log(ctx, 'error', `❌ 插件未启用：配置解析失败：${String(error)}`)
    return
  }

  // ── 2. 校验 tools 服务可用 ───────────────────────────────────────
  const tools = ctx.tools
  if (tools === undefined || typeof tools.register !== 'function') {
    log(ctx, 'error', `❌ 插件未启用：tools 服务不可用（请检查 inject: ['tools'] 是否生效）。`)
    return
  }

  // ── 4. 统一的发送函数（工具与自动推送共用）────────────────────────
  // 请求细节全部固化：GET + text + HTTPS + 10s 超时（见 config.ts 的 FIXED_REQUEST）。
  // 用户只需要配置昵称。
  const sendPush = (
    title: string,
    message: string,
    url?: string,
    signal?: AbortSignal,
  ): Promise<PushOutcome> => {
    // 文档限流保护：与上次成功发送保持至少 MIN_SEND_INTERVAL_MS 间隔
    const wait = remainingGlobalWindow(lastSendAt, MIN_SEND_INTERVAL_MS)
    return (wait > 0 ? sleep(wait) : Promise.resolve()).then(() =>
      pushToMeow(
        {
          nickname: config.nickname,
          title,
          message,
          ...(url === undefined || url === '' ? {} : { url }),
          msgType: FIXED_REQUEST.msgType,
          htmlHeight: FIXED_REQUEST.htmlHeight,
        },
        {
          apiBase: FIXED_REQUEST.apiBase,
          method: FIXED_REQUEST.method,
          timeout: FIXED_REQUEST.timeout,
          ...(signal === undefined ? {} : { signal }),
        },
      ),
    ).then((outcome) => {
      if (outcome.ok) lastSendAt = Date.now()
      return outcome
    })
  }

  // ── 5. 注册工具 ─────────────────────────────────────────────────
  const meowTool = defineTool<MeowToolArgs, string>({
    name: TOOL_NAME,
    description:
      `通过 MeoW API 向已配置的鸿蒙手机推送一条通知。message 必填；title 缺省为 "${DEFAULT_TITLE}"。`
      + '支持纯文本与 HTML（由插件配置 msgType 决定）。',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: `消息标题，可选，缺省为 "${DEFAULT_TITLE}"`,
        },
        message: {
          type: 'string',
          description: '消息内容（必填），例如「构建已完成，用时 42s」',
        },
        url: {
          type: 'string',
          description: '可选，点击通知后跳转的链接',
        },
        imgUrl: {
          type: 'string',
          description: '可选，本条消息的通知图标 URL（官方建议 216×216、PNG）',
        },
      },
      required: ['message'],
      additionalProperties: false,
    },
    // 与 meow-api 的请求超时对齐，再留 2s 余量，避免被工具调度层先超时掐断
    timeoutMs: FIXED_REQUEST.timeout + 2_000,
    isConcurrencySafe: () => true,
    output: {
      schema: { type: 'string', description: '推送结果的可读文本' },
      render: (_args, value) => text(value),
    },
    async execute(args: MeowToolArgs | undefined, exec): Promise<string> {
      // (1) 调用前检查取消：DSH 可能已中止本次工具调用
      if (exec.signal.aborted) {
        return '⚠️ 推送已取消：调用在开始前被中止。'
      }

      // (2) 参数归一化与校验（message 必填）
      const message = typeof args?.message === 'string' ? args.message.trim() : ''
      if (message === '') {
        return '⚠️ 推送失败：message 不能为空。'
      }
      const title =
        typeof args?.title === 'string' && args.title.trim() !== ''
          ? args.title.trim()
          : DEFAULT_TITLE
      const url = typeof args?.url === 'string' && args.url.trim() !== '' ? args.url.trim() : undefined
      const argImgUrl =
        typeof args?.imgUrl === 'string' && args.imgUrl.trim() !== '' ? args.imgUrl.trim() : undefined

      // (3) 节流：同一会话在固化窗口内不重复推送（间隔不可配置）
      const throttle = checkThrottle(lastPushAt, throttleKeyOf(exec), FIXED_THROTTLE_MS)
      if (throttle.blocked) {
        return `⚠️ 推送已节流：同一会话在 ${FIXED_THROTTLE_MS}ms 内只能推送一次，请 ${throttle.retryInMs}ms 后重试。`
      }

      // (4) 发出请求（sendPush 内部已做文档限流的最小间隔保护）
      const outcome =
        argImgUrl === undefined
          ? await sendPush(title, message, url, exec.signal)
          : await pushToMeow(
              {
                nickname: config.nickname,
                title,
                message,
                ...(url === undefined ? {} : { url }),
                imgUrl: argImgUrl,
                msgType: FIXED_REQUEST.msgType,
                htmlHeight: FIXED_REQUEST.htmlHeight,
              },
              {
                apiBase: FIXED_REQUEST.apiBase,
                method: FIXED_REQUEST.method,
                timeout: FIXED_REQUEST.timeout,
                signal: exec.signal,
              },
            )

      // (5) 仅成功时记账，失败允许立即重试
      if (outcome.ok) {
        lastPushAt.set(throttleKeyOf(exec), Date.now())
        lastSendAt = Date.now()
      } else {
        log(ctx, 'warn', `推送未成功（${outcome.kind}）：${outcome.message}`)
      }

      return formatOutcome(outcome, title, message)
    },
  })

  // ── 4. 运行包自有不变式 + 尽力注册到宿主 ─────────────────────────
  // 说明：assertInvariants 是纯函数，无论宿主是否提供注册通道都会在加载期执行。
  const invariants = createInvariants({
    pluginName: name,
    inject,
    definition: meowTool,
    config,
    configSchema: Config,
  })
  const violations = assertInvariants(invariants)
  if (violations.length > 0) {
    for (const violation of violations) {
      log(ctx, 'error', `❌ 不变式不满足（${violation.id}）：${violation.message}`)
    }
    // 契约被破坏时不注册：宁可没有工具，也不要注册一个行为未知的工具
    log(ctx, 'error', `❌ 插件未启用：${violations.length} 条不变式未通过。`)
    return
  }
  registerInvariants(ctx, invariants, (level, message) => log(ctx, level, message))

  // ── 5. 注册工具 ─────────────────────────────────────────────────
  // 注册工具。
  // 优先用 ctx.effect 包裹：Dispose / HMR 时自动注销，避免重载后重复注册。
  // 前提假设：Cordis 的 effect 会「同步执行」回调（其返回值即 Disposer）；
  // 若某版本行为不同（延迟执行或签名不符），回退为直接注册并显式保存 disposer。
  let registered = false
  if (typeof ctx.effect === 'function') {
    try {
      ctx.effect(() => {
        const dispose = tools.register(meowTool)
        return dispose
      }, `${name}:register`)
      registered = true
    } catch (error) {
      log(ctx, 'warn', `ctx.effect 不可用（${String(error)}），改为直接注册工具。`)
    }
  }
  if (!registered) {
    tools.register(meowTool)
  }

  // ── 6. 注册「任务完成自动推送」提示词区段 ────────────────────────
  // 工具是被动的：模型必须主动调用才会推送。这里向系统提示注入使用约定。
  // 但**不能只靠它** —— 实测模型会忽略提示词，于是「部分环境不推」。
  registerPromptSection(ctx, (level, message) => log(ctx, level, message))

  // ── 7. 注册宿主侧自动推送（确定性，不依赖模型）────────────────────
  // 监听 agent/turn-stopping：轮次结束时由宿主直接推送，保证每轮都有。
  // 正文是**本轮对话总结**（用户提问 + 模型最终回复 + 工具统计尾巴），
  // 内容来自 sessions 服务的 Session.snapshotEvents()（见 src/summary.ts）。
  // 模式固定为 every-turn（不再可配）；按轮次去重，并遵守文档的 3 秒最小发送间隔。
  //
  // ⚠️ sessions 是**可选**服务，必须用 ctx.get('sessions') 查询，不能写 ctx.sessions：
  //    Cordis 对「未出现在 inject 里的服务属性」读取会直接抛错
  //    （Error: cannot get property "sessions" without inject），
  //    那会让整个插件激活失败（fixture 里显示「1 entry did not activate」）。
  //    官方对该服务的可选访问写法就是 ctx.get("sessions") + undefined 检查。
  const sessionStore = readOptionalService(ctx, 'sessions')
  const autoPush = registerAutoPush(ctx as unknown as AutoPushContext, {
    mode: 'every-turn',
    lookupSession: (sessionId) => {
      const store = sessionStore as { get?: unknown } | undefined
      if (store === undefined || typeof store.get !== 'function') return undefined
      const live = (store.get as (id: string) => unknown).call(store, sessionId)
      if (live === null || live === undefined) return undefined
      const candidate = live as { snapshotEvents?: unknown }
      if (typeof candidate.snapshotEvents !== 'function') return undefined
      return {
        snapshotEvents: () =>
          (candidate.snapshotEvents as () => readonly unknown[]).call(live),
      }
    },
    send: async (title, message) => {
      const outcome = await sendPush(title, message)
      if (outcome.ok) lastPushAt.set('global', Date.now())
      return outcome
    },
  })
  if (autoPush.registered) {
    log(
      ctx,
      'info',
      sessionStore === undefined
        ? '自动推送已启用：每轮回答结束都推送（未提供 sessions 服务，正文为统计式）。'
        : '自动推送已启用：每轮回答结束都推送「提问 + 回复」总结。',
    )
  } else {
    log(ctx, 'info', `自动推送未启用（${autoPush.reason ?? 'unknown'}）；仍可让 Agent 主动调用工具。`)
  }

  log(
    ctx,
    'info',
    `✅ 已启用：昵称 "${config.nickname}"，API ${FIXED_REQUEST.apiBase}（${FIXED_REQUEST.method}，超时 ${FIXED_REQUEST.timeout}ms）。`,
  )
  log(ctx, 'info', `   已注册工具：${TOOL_NAME}（message 必填，title / url / imgUrl 可选）`)
}

/** 工具入参：nickname 不在这里，它来自插件配置 */
export interface MeowToolArgs {
  /** 可选，缺省 DEFAULT_TITLE（"MeoW Push Bridge"） */
  title?: string
  /** 必填，消息内容 */
  message: string
  /** 可选，点击跳转链接 */
  url?: string
  /** 可选，本条消息的通知图标 URL（覆盖插件配置里的 imgUrl） */
  imgUrl?: string
}

// 便于测试与外部复用
export type { ResolvedMeoWConfig, MeoWConfig } from './config.js'
export { ConfigError, resolveConfig } from './config.js'
