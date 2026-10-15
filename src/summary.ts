/**
 * meow-push-bridge / MeoW Push Bridge (喵桥)
 * src/summary.ts —— 从会话事件里提取「本轮对话总结」
 *
 * 为什么这么做：
 *   宿主层（`agent/turn-stopping` 的 payload）只给了 `{ agent, turn, signal }`，
 *   拿不到对话内容。但 `ctx.sessions.get(agentId)` 能拿到 `Session` 对象，
 *   而 `Session` 暴露 `snapshotEvents()` —— 里面就包含完整的事件流：
 *     - `'user/message'`      → 这一轮用户说了什么
 *     - `'assistant/message'` → 模型的回复（`data.message.content` 是块数组）
 *     - `'tool/call'`         → 本轮调用了哪些工具
 *   于是「对话内容」在轮次结束时是**可读的**，不需要 LLM 也不需要额外请求。
 *
 * DSH 契约（来自运行时 Inspect 的服务/事件目录，非推断）：
 *   `SessionEventMap['assistant/message'] = { turn, step, message: AssistantMessage, stream, usage?, interrupted? }`
 *   `ContentBlockMap['text'] = TextBlock`（带 `text: string`）
 *   `SessionEvent = { type, seq, time, data }`
 *
 * 本模块刻意只依赖「像 Session 的对象」（鸭子类型）：
 *   只要提供 `snapshotEvents()` 即可，便于单元测试注入假会话。
 */

/** 与 Session 对齐的最小结构（只用到快照方法） */
export interface SessionLike {
  snapshotEvents(): readonly unknown[]
}

/** 一轮对话的总结 */
export interface TurnSummary {
  /** 本轮用户提问（可能为空 —— 例如自动续跑的一轮） */
  question: string
  /** 模型本轮最终回复的纯文本 */
  answer: string
  /** 本轮工具调用次数 */
  toolCalls: number
  /** 工具名 → 次数 */
  tools: Map<string, number>
  /** 提问是否被截断 */
  questionTruncated: boolean
  /** 回复是否被截断 */
  answerTruncated: boolean
}

/** 截断上限（字符数） */
export const QUESTION_LIMIT = 160
export const ANSWER_LIMIT = 600

/** 读出对象字段 */
function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

/** 读取数字字段（兼容 branded number） */
function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** 压缩空白：把换行/多空格折叠成单个空格，去掉首尾空白 */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** 截断到上限，超长时追加省略号 */
export function truncateText(text: string, limit: number): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false }
  return { text: `${text.slice(0, limit)}…`, truncated: true }
}

/**
 * 从 `AssistantMessage.content` 提取纯文本。
 *
 * content 是块数组（`ContentBlockMap`），只取 `type === 'text'` 的块；
 * 同时兼容「content 直接是字符串」的退化情况（某些投影实现）。
 * 推理块（reasoning）刻意**不取** —— 那是内部思考，不该推到手机上。
 */
export function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') return collapseWhitespace(content)
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const raw of content) {
    const block = asRecord(raw)
    if (block['type'] !== 'text') continue
    const text = block['text']
    if (typeof text === 'string' && text.trim() !== '') parts.push(text)
  }
  return collapseWhitespace(parts.join(' '))
}

/**
 * 提取指定轮次的对话总结。
 *
 * @param session 类似 Session 的对象（提供 snapshotEvents）
 * @param turn    目标轮次号；给出时只取该轮事件
 */
export function summarizeTurn(session: SessionLike, turn?: number): TurnSummary {
  let events: readonly unknown[] = []
  try {
    events = session.snapshotEvents()
  } catch {
    events = []
  }

  let question = ''
  let answer = ''
  let toolCalls = 0
  const tools = new Map<string, number>()

  for (const raw of events) {
    const event = asRecord(raw)
    const type = event['type']
    const data = asRecord(event['data'])
    const eventTurn = readNumber(data['turn'])
    // 指定了轮次就只看该轮（turn 字段缺失的事件视为无关）
    if (turn !== undefined && eventTurn !== undefined && eventTurn !== turn) continue

    if (type === 'user/message') {
      // 用户消息可能直接把 message 放在 data 上，也可能包一层
      const direct = extractTextFromContent(data['content'])
      const nested = extractTextFromContent(asRecord(data['message'])['content'])
      const text = direct !== '' ? direct : nested
      if (text !== '') question = text
      continue
    }

    if (type === 'assistant/message') {
      const text = extractTextFromContent(asRecord(data['message'])['content'])
      // 只保留最后一条非空回复 —— 中间步骤可能只有工具调用
      if (text !== '') answer = text
      continue
    }

    if (type === 'tool/call') {
      toolCalls += 1
      const name = typeof data['name'] === 'string' ? data['name'] : 'unknown'
      tools.set(name, (tools.get(name) ?? 0) + 1)
    }
  }

  const q = truncateText(question, QUESTION_LIMIT)
  const a = truncateText(answer, ANSWER_LIMIT)
  return {
    question: q.text,
    answer: a.text,
    toolCalls,
    tools,
    questionTruncated: q.truncated,
    answerTruncated: a.truncated,
  }
}

/** 统计尾巴（工具调用与耗时），保持简短 */
export function renderTail(toolCalls: number, tools: Map<string, number>, seconds: number): string {
  if (toolCalls === 0) return `（未使用工具，耗时 ${seconds}s）`
  const names = [...tools.keys()]
  const shown = names.slice(0, 3).join('、')
  const more = names.length > 3 ? ` 等 ${names.length} 种` : ''
  return `（调用 ${toolCalls} 次工具：${shown}${more}，耗时 ${seconds}s）`
}

/**
 * 把总结渲染成推送正文。
 *
 * 结构（手机锁屏上也要能一眼看懂）：
 *   【你问】…
 *   【回复】…
 *   （调用 3 次工具：pwsh、read，耗时 12s）
 *
 * 拿不到对话内容时退化为纯统计文案 —— 推送**始终会发出**，只是内容简略。
 */
export function formatSummary(summary: TurnSummary, seconds: number): string {
  const tail = renderTail(summary.toolCalls, summary.tools, seconds)
  const hasQuestion = summary.question !== ''
  const hasAnswer = summary.answer !== ''

  if (!hasQuestion && !hasAnswer) {
    // 降级：没有对话内容（例如事件不可读）
    if (summary.toolCalls === 0) return `本轮已完成（无对话内容，耗时 ${seconds}s）`
    const names = [...summary.tools.keys()].slice(0, 4).join('、')
    return `本轮已完成：调用 ${summary.toolCalls} 次工具（${names}），耗时 ${seconds}s`
  }

  const lines: string[] = []
  if (hasQuestion) lines.push(`【你问】${summary.question}`)
  if (hasAnswer) lines.push(`【回复】${summary.answer}`)
  lines.push(tail)
  return lines.join('\n')
}
