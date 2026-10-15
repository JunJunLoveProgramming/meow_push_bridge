/**
 * meow-push-bridge / MeoW Push Bridge (喵桥)
 * src/auto-push.ts —— 宿主侧「每轮必推」的确定性自动推送
 *
 * 为什么需要它（这是本项目最重要的一次设计修正）：
 *   只靠 `systemPrompt` 里的约定让**模型自觉调用**工具，是概率性合规 ——
 *   实测同一个模型在不同上下文/任务/会话里会忽略它，于是「部分环境不推」。
 *   本模块改为在宿主侧监听轮次结束事件后**直接推送**，不依赖模型。
 *
 * 推送内容：**本轮对话总结**（用户提问 + 模型最终回复 + 工具统计尾巴）。
 *   正文由 src/summary.ts 从 `Session.snapshotEvents()` 提取 —— 宿主层因此
 *   不需要 LLM 就能给出「说了什么」，而不是只报「调了几次工具」。
 *
 * DSH 契约（来自运行时的服务/事件目录，非推断）：
 *   - 事件 `'agent/turn-stopping'(this: Scoped<Agent>, payload: { agent, turn, signal })`
 *     —— 「本轮即将结束」的串行事件，全局注册的插件可以收到。
 *   - 事件 `'session/event'(this: Scoped<Session>, session, event)`
 *     —— 会话事件的提交后观察流，用于记录本轮开始时间与工具调用次数。
 *     注意它带 carrier（作用域过滤），所以统计是**尽力而为**：
 *     拿不到统计时退化为简洁文案，但**轮次结束的推送照常发出**。
 *
 * 设计取舍：
 *   - 推送**不经过工具**，因此不受工具级 5 秒节流限制（否则每轮必推做不到）；
 *     改为按 (会话, 轮次) 去重，保证同一轮只推一条。
 *   - 模型自己推的那条排在前面（它在轮内调用），宿主这条在轮末补位，符合
 *     「总结放在最后」的预期。
 */

import { DEFAULT_TITLE, type PushOutcome } from './meow-api.js'
import { formatSummary, summarizeTurn, type SessionLike } from './summary.js'

/** 自动推送模式 */
export type PushMode = 'every-turn' | 'substantial' | 'off'

/** 所有合法模式（供配置归一化与测试引用） */
export const PUSH_MODES: readonly PushMode[] = ['every-turn', 'substantial', 'off']

/** 默认模式：每轮必推 */
export const DEFAULT_PUSH_MODE: PushMode = 'every-turn'

/** 与 index.ts 的 PluginContext 对齐的最小上下文（避免循环依赖） */
export interface AutoPushContext {
  readonly logger?: {
    error?(...args: unknown[]): void
    warn?(...args: unknown[]): void
    info?(...args: unknown[]): void
  }
  /** 事件订阅：Cordis 上下文成员 */
  on?(
    event: string,
    listener: (...args: unknown[]) => void,
    options?: Record<string, unknown>,
  ): unknown
}

/** 一轮的统计 */
export interface TurnStats {
  turn: number
  startedAt: number
  toolCalls: number
  /** 工具名 → 调用次数 */
  tools: Map<string, number>
}

/** 自动推送的注入项 */
export interface AutoPushOptions {
  mode: PushMode
  /** 实际执行推送（由 index.ts 注入，内部含节流与最小发送间隔保护） */
  send: (title: string, message: string) => Promise<PushOutcome>
  /**
   * 按会话 id 取会话对象（用于提取对话总结）。
   * 拿不到会话时自动降级为纯统计文案。
   */
  lookupSession?: (sessionId: string) => SessionLike | undefined
}

/** 注册结果 */
export interface AutoPushRegistration {
  registered: boolean
  reason?: string
}

/** 读取事件对象里的轮次号（不同版本字段可能是 number 或 branded number） */
function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * 安全读取 `ctx.on`。
 *
 * ⚠️ 必须 try/catch：Cordis 对**未列入 inject 的服务属性**读取会直接抛错
 * （`Error: cannot get property "on" without inject`），而不是返回 undefined。
 * 本插件只 inject 了 `tools`，所以 `ctx.on` 属于未注入；
 * 直接读会让整个插件激活失败（fixture 显示「1 entry did not activate」）。
 * 拿不到事件通道时静默降级：不注册自动推送，但工具照常可用。
 */
function readOn(ctx: AutoPushContext): AutoPushContext['on'] {
  try {
    const on = ctx.on
    return typeof on === 'function' ? on : undefined
  } catch {
    return undefined
  }
}

/** 读取会话 id（session.id 或 agent.id 都可作为去重键） */
function readSessionId(source: unknown): string | undefined {
  if (source === null || typeof source !== 'object') return undefined
  const id = (source as { id?: unknown }).id
  return typeof id === 'string' && id !== '' ? id : undefined
}

/** 把统计渲染成中文文案（无对话内容时的降级形态） */
export function renderTurnStats(stats: TurnStats, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - stats.startedAt) / 1000))
  if (stats.toolCalls === 0) {
    return `本轮已完成（纯问答，未使用工具，耗时 ${seconds}s）`
  }
  const names = [...stats.tools.keys()]
  const shown = names.slice(0, 4).join('、')
  const more = names.length > 4 ? ` 等 ${names.length} 种` : ''
  return `本轮已完成：调用 ${stats.toolCalls} 次工具（${shown}${more}），耗时 ${seconds}s`
}

/**
 * 组装一条推送正文：优先用对话总结，拿不到会话时退化为统计。
 *
 * 导出以便单元测试直接覆盖，不必搭完整事件流。
 */
export function buildAutoPushBody(
  stats: TurnStats,
  session: SessionLike | undefined,
  now: number = Date.now(),
): string {
  const seconds = Math.max(0, Math.round((now - stats.startedAt) / 1000))
  if (session === undefined) return renderTurnStats(stats, now)
  try {
    const summary = summarizeTurn(session, stats.turn)
    // 总结里拿不到工具数时，用事件流统计到的数字兜底（更准）
    if (summary.toolCalls === 0 && stats.toolCalls > 0) {
      summary.toolCalls = stats.toolCalls
      summary.tools = stats.tools
    }
    return formatSummary(summary, seconds)
  } catch {
    return renderTurnStats(stats, now)
  }
}

/**
 * 注册宿主侧自动推送。
 *
 * 行为：
 *   - `off`：不注册任何监听（只保留模型主动调用）
 *   - `every-turn`：每轮回答结束都推
 *   - `substantial`：仅当本轮调用过工具才推
 *
 * 失败**不抛错** —— 自动推送是增强项，工具本身必须始终可用。
 */
export function registerAutoPush(
  ctx: AutoPushContext,
  options: AutoPushOptions,
): AutoPushRegistration {
  if (options.mode === 'off') {
    return { registered: false, reason: 'pushMode=off' }
  }
  // 安全读取：ctx.on 未被 inject，直接读会抛错（见 readOn 的说明）
  const on = readOn(ctx)
  if (typeof on !== 'function') {
    return { registered: false, reason: 'ctx.on unavailable' }
  }

  /** 每个会话的当前轮次统计 */
  const turns = new Map<string, TurnStats>()
  /** 已推送过的 (会话, 轮次) 键，保证同一轮只推一条 */
  const pushed = new Set<string>()

  const log = (level: 'warn' | 'info', message: string): void => {
    const sink = ctx.logger?.[level]
    if (typeof sink === 'function') sink.call(ctx.logger, `[meow-push-bridge] ${message}`)
  }

  // ── 会话事件：维护统计（尽力而为） ────────────────────────────
  try {
    on.call(
      ctx,
      'session/event',
      (...args: unknown[]) => {
        try {
          const [session, event] = args
          const sessionId = readSessionId(session)
          if (sessionId === undefined || event === null || typeof event !== 'object') return
          const record = event as { type?: unknown; data?: unknown }
          const data =
            record.data !== null && typeof record.data === 'object'
              ? (record.data as Record<string, unknown>)
              : {}
          const turn = readNumber(data['turn'])

          if (record.type === 'turn/start' && turn !== undefined) {
            turns.set(sessionId, {
              turn,
              startedAt: Date.now(),
              toolCalls: 0,
              tools: new Map(),
            })
            return
          }
          if (record.type === 'tool/call') {
            const current = turns.get(sessionId)
            if (current === undefined) return
            current.toolCalls += 1
            const name = typeof data['name'] === 'string' ? data['name'] : 'unknown'
            current.tools.set(name, (current.tools.get(name) ?? 0) + 1)
          }
        } catch {
          // 统计失败不影响推送
        }
      },
      { global: true },
    )
  } catch (error) {
    log('warn', `session/event 监听注册失败（统计将退化为简洁文案）：${String(error)}`)
  }

  // ── 轮次结束：执行推送（确定性的那一半） ──────────────────────
  try {
    on.call(
      ctx,
      'agent/turn-stopping',
      (...args: unknown[]) => {
        void (async () => {
          try {
            const payload = args[0] as { agent?: unknown; turn?: unknown } | undefined
            const agent = payload?.agent
            const sessionId = readSessionId(agent)
            const turn = readNumber(payload?.turn)
            if (sessionId === undefined || turn === undefined) return

            const stats = turns.get(sessionId) ?? {
              turn,
              startedAt: Date.now(),
              toolCalls: 0,
              tools: new Map<string, number>(),
            }
            if (options.mode === 'substantial' && stats.toolCalls === 0) return

            const key = `${sessionId}#${turn}`
            if (pushed.has(key)) return
            pushed.add(key)
            // 去重集合只保留最近 200 条，避免长会话内存增长
            if (pushed.size > 200) {
              const oldest = pushed.values().next().value
              if (oldest !== undefined) pushed.delete(oldest)
            }

            // 取会话对象以提取对话总结（拿不到则降级为统计文案）
            let session: SessionLike | undefined
            try {
              session = options.lookupSession?.(sessionId)
            } catch (error) {
              log('warn', `读取会话失败，本轮退化为统计文案：${String(error)}`)
            }

            const body = buildAutoPushBody(stats, session, Date.now())
            const outcome = await options.send(DEFAULT_TITLE, body)
            if (outcome.ok) {
              log('info', `第 ${turn} 轮自动推送成功（${session === undefined ? '统计' : '总结'}）。`)
            } else {
              log('warn', `第 ${turn} 轮自动推送失败（${outcome.kind}）：${outcome.message}`)
            }
            turns.delete(sessionId)
          } catch (error) {
            log('warn', `自动推送执行失败：${String(error)}`)
          }
        })()
      },
      { global: true },
    )
  } catch (error) {
    return { registered: false, reason: `turn-stopping listener failed: ${String(error)}` }
  }

  return { registered: true }
}

/** 便捷函数：归一化 pushMode 配置（非法值回退默认） */
export function normalizePushMode(value: unknown): PushMode {
  if (typeof value === 'string' && (PUSH_MODES as readonly string[]).includes(value)) {
    return value as PushMode
  }
  return DEFAULT_PUSH_MODE
}
