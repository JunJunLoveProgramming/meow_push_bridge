/**
 * meow-push-bridge / MeoW Push Bridge (喵桥)
 * src/meow-api.ts —— MeoW HTTP 推送接口封装
 *
 * 接口形状：
 *   http://api.chuckfang.com/{nickname}/{title}/{message}?url={url}
 *
 * 本文件特性：
 *   - 运行时零依赖，只用全局 fetch / AbortSignal（Node 20.6+ 内置）；
 *   - 纯逻辑、无模块级副作用，便于 tests/impl.spec.ts 直接 mock fetch 测试；
 *   - fetch 在「调用时」从 globalThis 读取，因此测试可替换 globalThis.fetch。
 *
 * 同样只使用可擦除 TypeScript 语法（无 enum / 无构造器参数属性）。
 */

/** 通知标题缺省值：宿主侧自动推送与工具调用都用它 */
export const DEFAULT_TITLE = 'MeoW Push Bridge'

/** 一次推送请求 */
export interface PushRequest {
  /** MeoW 昵称，来自插件配置（不是工具入参） */
  nickname: string
  /** 通知标题，缺省 DEFAULT_TITLE */
  title?: string
  /** 通知正文，必填 */
  message: string
  /** 点击通知跳转链接，可选 */
  url?: string
}

/** 失败分类 */
export type PushErrorKind =
  /** 本地参数非法（例如 message 为空），未发出请求 */
  | 'invalid'
  /** 请求超时 */
  | 'timeout'
  /** 被上层取消（exec.signal） */
  | 'aborted'
  /** 网络层失败（DNS / 连接被拒 / TLS / fetch 本身抛错） */
  | 'network'
  /** HTTP 状态码非 2xx */
  | 'http'
  /** HTTP 2xx 但 MeoW 返回的业务错误 */
  | 'business'
  /** 其他未预期错误 */
  | 'unknown'

export interface PushSuccess {
  ok: true
  /** HTTP 状态码 */
  status: number
  /** 最终请求的完整 URL（便于排查） */
  url: string
  /** 服务端返回体（已截断），可能为空字符串 */
  body: string
}

export interface PushFailure {
  ok: false
  kind: PushErrorKind
  /** 面向用户/模型的中文可读消息 */
  message: string
  /** HTTP 状态码（仅 http / business 分类有值） */
  status?: number
  /** 最终请求的完整 URL（便于排查） */
  url?: string
  /** 服务端返回体（已截断），可能为空字符串 */
  body?: string
}

export type PushOutcome = PushSuccess | PushFailure

/** pushToMeow 的可选参数 */
export interface PushOptions {
  /** 上层（工具调度）的取消信号 */
  signal?: AbortSignal
  /** 请求超时毫秒数，默认 10000 */
  timeout?: number
  /** 自定义 fetch（默认取 globalThis.fetch），便于测试与将来替换实现 */
  fetchImpl?: typeof fetch
}

/** 读取「上层信号是否已取消」。
 *
 * 为什么必须包一层函数：`AbortSignal.aborted` 是 getter，运行时可变，
 * 但 TS 的控制流分析会把它当普通只读属性窄化。若在前面判断过一次
 * `outer?.aborted === true` 为假，TS 就会认为之后该值恒为 false，
 * 于是 catch 里的重检被报 TS2367（'false | undefined' 与 'true' 无重叠），
 * 而这恰恰是「取消 vs 超时」的生命线判断，绝不能删。函数调用可阻断窄化。 */
function isAborted(signal: AbortSignal | undefined): boolean {
  return signal !== undefined && signal.aborted === true
}

/** HTTP 非 2xx 时抛出的内部错误，用于在 catch 中分类 */
class PushHttpError extends Error {
  readonly status: number
  readonly body: string
  constructor(status: number, body: string) {
    super(`HTTP ${status}`)
    this.name = 'PushHttpError'
    this.status = status
    this.body = body
  }
}

/** 响应体截断上限，避免超长返回体污染日志与模型上下文 */
const BODY_LIMIT = 300

/** 截断文本 */
function truncate(value: string, limit = BODY_LIMIT): string {
  return value.length > limit ? `${value.slice(0, limit)}…` : value
}

/**
 * 路径段里必须替换掉的字符 → 视觉等价的全角字符。
 *
 * 为什么必须替换（实测于 api.chuckfang.com）：
 *   URL **路径段**里的 `/` 会被编码成 `%2F`，而 Tomcat 默认 `ALLOW_ENCODED_SLASH=false`，
 *   请求会在到达应用之前就收到 `HTTP 400 Bad Request`。
 *   实测对照：正文含 `/` → 400；把 `/` 换成全角 `／` 或 `_` → 200。
 *   注意**查询串不受影响**（`?url=a%2Fb` 实测 200），所以 `url` 参数无需处理。
 *
 * 换成全角而非删除：保留可读性（`72 通过 ／ 0 失败` 仍看得懂），
 * 同时保证路径段里除 `%XX` 外不出现 ASCII 斜杠、引号、尖括号。
 */
const PATH_SEGMENT_REPLACEMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/[/]/g, '／'], // U+FF0F 全角斜杠
  [/\\/g, '＼'], // U+FF3C 全角反斜杠
  [/"/g, '＂'],
  [/'/g, '＇'],
  [/</g, '＜'],
  [/>/g, '＞'],
  [/%/g, '％'],
]

/** 把一段文本转成安全的 URL 路径段（先替换危险字符，再整体编码） */
function toPathSegment(value: string): string {
  let safe = value
  for (const [pattern, replacement] of PATH_SEGMENT_REPLACEMENTS) {
    safe = safe.replace(pattern, replacement)
  }
  return encodeURIComponent(safe)
}

/**
 * 拼接 MeoW 推送 URL。
 *
 * 三个路径段（nickname / title / message）都经 toPathSegment 处理：
 * 先做全角替换（见 PATH_SEGMENT_REPLACEMENTS），再 encodeURIComponent ——
 * 这样中文、空格、`?`、`#`、`&` 都不会破坏 URL 结构，也不会触发 400。
 * `url` 放在查询串里，普通编码即可（查询串允许 `%2F`）。
 * 三个路径段一定都会出现：title 为空时用 DEFAULT_TITLE 兜底。
 */
export function buildMeowUrl(request: PushRequest, apiBase: string): string {
  const base = apiBase.trim().replace(/\/+$/, '')
  const title =
    typeof request.title === 'string' && request.title.trim().length > 0
      ? request.title.trim()
      : DEFAULT_TITLE
  const nick = toPathSegment(request.nickname)
  const t = toPathSegment(title)
  const m = toPathSegment(request.message)
  const query =
    typeof request.url === 'string' && request.url.trim().length > 0
      ? `?url=${encodeURIComponent(request.url.trim())}`
      : ''
  return `${base}/${nick}/${t}/${m}${query}`
}

/** 解析响应体：优先 JSON 里的 message/msg/error 字段，否则取原文 */
async function decodeBody(response: Response): Promise<string> {
  let raw = ''
  try {
    raw = await response.text()
  } catch {
    return ''
  }
  const trimmed = raw.trim()
  if (trimmed === '') return ''
  if (!/^[[{]/.test(trimmed)) return truncate(trimmed)
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (parsed !== null && typeof parsed === 'object') {
      const table = parsed as Record<string, unknown>
      // 只认「明显表示状态/错误」的字段；刻意不读 data/result，
      // 因为成功响应里 data 可能恰好包含 "error" 之类的字面量而误判。
      for (const key of ['message', 'msg', 'error']) {
        const candidate = table[key]
        if (typeof candidate === 'string' && candidate.trim().length > 0) {
          return truncate(candidate.trim())
        }
      }
    }
    return truncate(trimmed)
  } catch {
    // 不是合法 JSON，按原文处理
    return truncate(trimmed)
  }
}

/** 判断 MeoW 返回体是否表达了「失败」语义 */
function looksLikeBusinessError(body: string): boolean {
  if (body === '') return false
  const lower = body.toLowerCase()
  const failureWords = [
    'fail', 'failed', 'failure', 'error', 'invalid', 'not found',
    'denied', 'forbidden', 'unauthorized', 'no such', '不存在',
    '失败', '错误', '未找到', '无效', '未注册', '禁止',
  ]
  return failureWords.some((word) => lower.includes(word))
}

/**
 * 组合「上层取消信号」与「内部超时信号」。
 *
 * 优先 AbortSignal.any（Node 20.3+）；不可用时退化为手工桥接，
 * 保证插件在更老的 Node 上仍然可用。
 */
function mergeSignals(
  outer: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; timedOut: () => boolean } {
  const timeoutController = new AbortController()
  const timer = setTimeout(() => timeoutController.abort(new Error('meow push timeout')), timeoutMs)
  const timeoutSignal = timeoutController.signal
  // 让 setTimeout 不阻塞进程退出
  ;(timer as { unref?: () => void }).unref?.()

  if (outer === undefined) {
    return { signal: timeoutSignal, timedOut: () => timeoutSignal.aborted }
  }

  const anyFn = (AbortSignal as unknown as {
    any?: (signals: AbortSignal[]) => AbortSignal
  }).any

  if (typeof anyFn === 'function') {
    return {
      signal: anyFn.call(AbortSignal, [outer, timeoutSignal]),
      timedOut: () => timeoutSignal.aborted && !outer.aborted,
    }
  }

  const controller = new AbortController()
  const onOuterAbort = () => controller.abort(outer.reason)
  const onTimeoutAbort = () => controller.abort(timeoutSignal.reason)
  if (outer.aborted) controller.abort(outer.reason)
  else outer.addEventListener('abort', onOuterAbort, { once: true })
  if (timeoutSignal.aborted) controller.abort(timeoutSignal.reason)
  else timeoutSignal.addEventListener('abort', onTimeoutAbort, { once: true })
  return {
    signal: controller.signal,
    timedOut: () => timeoutSignal.aborted && !outer.aborted,
  }
}

/**
 * 向 MeoW 推送一条通知。
 *
 * 分类规则（catch 顺序很重要）：
 *   1. signal.aborted 且是上层信号 → aborted
 *   2. 超时信号触发 → timeout
 *   3. PushHttpError → http
 *   4. fetch 抛出的 TypeError → network
 *   5. 其他 → unknown
 */
export async function pushToMeow(
  request: PushRequest,
  apiBase: string,
  options: PushOptions = {},
): Promise<PushOutcome> {
  const timeoutMs = options.timeout ?? 10_000
  const outer = options.signal

  // ── 0. 本地参数校验：不满足就不发请求 ──────────────────────────
  const message = typeof request.message === 'string' ? request.message.trim() : ''
  if (message === '') {
    return { ok: false, kind: 'invalid', message: '推送失败：message 不能为空。' }
  }
  if (typeof request.nickname !== 'string' || request.nickname.trim() === '') {
    return {
      ok: false,
      kind: 'invalid',
      message: '推送失败：MeoW 昵称为空，请检查插件配置 nickname。',
    }
  }

  const url = buildMeowUrl({ ...request, message }, apiBase)

  // ── 1. 进入前就被取消 ─────────────────────────────────────────
  if (isAborted(outer)) {
    return { ok: false, kind: 'aborted', message: '推送已取消：调用方在请求前中止了操作。', url }
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') {
    return {
      ok: false,
      kind: 'network',
      message: '推送失败：当前运行环境没有可用的 fetch（需要 Node 20.6+ 或提供 fetchImpl）。',
      url,
    }
  }

  const { signal, timedOut } = mergeSignals(outer, timeoutMs)

  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      signal,
      redirect: 'follow',
      headers: { accept: 'application/json, text/plain, */*' },
    })

    const body = await decodeBody(response)

    // ── 2. HTTP 状态分类 ────────────────────────────────────────
    if (!response.ok) {
      throw new PushHttpError(response.status, body)
    }

    // ── 3. 业务错误分类：2xx 但返回体表达了失败 ──────────────────
    if (looksLikeBusinessError(body)) {
      return {
        ok: false,
        kind: 'business',
        message: `推送被 MeoW 拒绝（HTTP ${response.status}）：${body || '服务端未提供原因'}`,
        status: response.status,
        url,
        body,
      }
    }

    return { ok: true, status: response.status, url, body }
  } catch (error) {
    // ── 4. 取消 / 超时 ──────────────────────────────────────────
    // 用 isAborted() 而非直接读 outer.aborted：绕开 TS 对 getter 的错误窄化（见上方注释）
    if (isAborted(outer)) {
      return { ok: false, kind: 'aborted', message: '推送已取消：调用方中止了操作。', url }
    }
    if (timedOut() || (error instanceof Error && error.name === 'TimeoutError')) {
      return {
        ok: false,
        kind: 'timeout',
        message: `推送超时：MeoW 在 ${timeoutMs}ms 内未响应，请检查网络或调大配置 timeout。`,
        url,
      }
    }
    if (error instanceof Error && error.name === 'AbortError' && !timedOut()) {
      return { ok: false, kind: 'aborted', message: '推送已取消。', url }
    }

    // ── 5. HTTP 错误 ────────────────────────────────────────────
    if (error instanceof PushHttpError) {
      const detail = error.body === '' ? '' : `，返回：${error.body}`
      const hint =
        error.status === 404
          ? '（404 通常表示昵称错误或该昵称未在 MeoW 注册）'
          : error.status >= 500
            ? '（MeoW 服务端异常，可稍后重试）'
            : ''
      return {
        ok: false,
        kind: 'http',
        message: `推送失败：MeoW 返回 HTTP ${error.status}${hint}${detail}`,
        status: error.status,
        url,
        body: error.body,
      }
    }

    // ── 6. 网络错误 ─────────────────────────────────────────────
    if (error instanceof TypeError) {
      return {
        ok: false,
        kind: 'network',
        message: `推送失败：无法连接 MeoW（${error.message}）。请检查网络、代理或 apiBase 配置。`,
        url,
      }
    }

    // ── 7. 兜底 ─────────────────────────────────────────────────
    return {
      ok: false,
      kind: 'unknown',
      message: `推送失败：发生未预期错误：${error instanceof Error ? error.message : String(error)}`,
      url,
    }
  }
}

/** 把推送结果格式化为给模型看的一行文本（含 emoji，便于一眼分辨成败） */
export function formatOutcome(outcome: PushOutcome, title: string, message: string): string {
  return outcome.ok
    ? `✅ 通知已推送到 MeoW：${title} - ${message}`
    : `❌ ${outcome.message}`
}
