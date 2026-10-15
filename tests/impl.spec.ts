/**
 * tests/impl.spec.ts —— 推送实现测试（mock fetch）
 *
 * 契约来源：官方文档 https://www.chuckfang.com/MeoW/api_doc.html
 *   - GET /{昵称}/{title}/{msg}?url=&imgUrl=&msgType=&htmlHeight=
 *   - POST /{昵称}/[title]，body 支持 application/json
 *   - 响应：HTTP 恒为 200，业务结果在 JSON 的 `status` 字段
 *     200 成功 / 400 参数错误 / 403 内容策略 / 404 昵称未注册 /
 *     429 频率超限 / 500 服务器错误
 *
 * 覆盖：URL 构造与编码、路径段全角替换、msgType/htmlHeight/imgUrl、
 *       GET 与 POST 两种方法、业务状态码分类、超时/取消/网络错误、
 *       execute 端到端与会话级节流。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_API_BASE,
  DEFAULT_TITLE,
  buildMeowBody,
  buildMeowPostUrl,
  buildMeowUrl,
  classifyBusinessStatus,
  normalizeHtmlHeight,
  normalizeMsgType,
  parseServerResult,
  pushToMeow,
} from '../dist/meow-api.ts'
import { TOOL_NAME, apply, remainingGlobalWindow, resetThrottleState } from '../dist/index.ts'
import type { ToolDefinition } from '../dist/tool.ts'

const API_BASE = 'http://api.chuckfang.com'

/** 记录 fetch 调用的替身 */
interface FetchCall {
  url: string
  init: RequestInit | undefined
}

function mockFetch(
  responder: (url: string, init: RequestInit | undefined) => Promise<Response>,
): { calls: FetchCall[]; restore: () => void } {
  const original = globalThis.fetch
  const calls: FetchCall[] = []
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input)
    calls.push({ url, init })
    return responder(url, init)
  }) as typeof fetch
  return {
    calls,
    restore: () => {
      globalThis.fetch = original
    },
  }
}

/** 一个永不 resolve、只在 signal 中止时 reject 的 fetch */
function hangingFetch(signalAware = true): { calls: FetchCall[]; restore: () => void } {
  return mockFetch(
    (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        if (!signalAware || init?.signal === undefined || init.signal === null) return
        const signal = init.signal
        if (signal.aborted) {
          reject(signal.reason ?? new Error('aborted'))
          return
        }
        signal.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')), {
          once: true,
        })
      }),
  )
}

/** 从 fetch 调用里取出 URL */
function urlOf(call: FetchCall | undefined): string {
  assert.ok(call !== undefined, '应当发起了一次 fetch')
  return call.url
}

/** MeoW 成功响应（实测形状：字段名是 msg） */
function successResponse(): Response {
  return new Response('{"status":200,"data":true,"msg":"发送成功"}', { status: 200 })
}

// ─────────────────────── URL 构造 ───────────────────────

test('buildMeowUrl：基础形状与顺序正确，并附带 msgType 请求参数', () => {
  const url = buildMeowUrl(
    { nickname: 'chuck', title: 'MeoW Push Bridge', message: 'hello world' },
    API_BASE,
  )
  assert.equal(url, `${API_BASE}/chuck/MeoW%20Push%20Bridge/hello%20world?msgType=text`)
})

test('buildMeowUrl：title 为空/缺省时回退默认标题', () => {
  const fallback = `${API_BASE}/n/MeoW%20Push%20Bridge/m?msgType=text`
  assert.equal(buildMeowUrl({ nickname: 'n', title: '', message: 'm' }, API_BASE), fallback)
  assert.equal(buildMeowUrl({ nickname: 'n', message: 'm' }, API_BASE), fallback)
  assert.equal(buildMeowUrl({ nickname: 'n', title: '   ', message: 'm' }, API_BASE), fallback)
})

test('buildMeowUrl：路径段里的斜杠被换成全角 ／（否则 MeoW 回 HTTP 400）', () => {
  // 文档明确要求「昵称不允许包含斜杠」；路径段里的 %2F 会被 Tomcat 拒绝
  const url = buildMeowUrl({ nickname: 'n', title: 'T', message: '72 通过 / 0 失败' }, API_BASE)
  const path = url.split('?')[0] ?? ''
  assert.ok(!path.includes('%2F'), '路径段里不能出现 %2F')
  assert.ok(path.includes('%EF%BC%8F'), '斜杠应被替换为全角 ／（UTF-8: EF BC 8F）')
  // 查询串里的 url 参数仍按普通编码（实测 ?url=a%2Fb 返回 200）
  const withQuery = buildMeowUrl(
    { nickname: 'n', message: 'm', url: 'https://github.com/a/b' },
    API_BASE,
  )
  assert.ok(withQuery.includes('url=https%3A%2F%2Fgithub.com%2Fa%2Fb'))
})

test('buildMeowUrl：反斜杠 / 引号 / 尖括号 / 百分号也换成全角（路径段内）', () => {
  const url = buildMeowUrl({ nickname: 'n', message: 'a\\b "c" <d> 100%' }, API_BASE)
  const path = url.split('?')[0] ?? ''
  for (const encoded of ['%5C', '%22', '%3C', '%3E', '%25']) {
    assert.ok(!path.includes(encoded), `路径段里不应出现 ${encoded}`)
  }
})

test('buildMeowUrl：nickname 与 title 里的斜杠同样被替换', () => {
  const url = buildMeowUrl({ nickname: 'a/b', title: 'x/y', message: 'm' }, API_BASE)
  const path = url.split('?')[0] ?? ''
  assert.ok(!path.includes('%2F'))
  assert.equal((path.match(/%EF%BC%8F/g) ?? []).length, 2)
})

test('buildMeowUrl：url / imgUrl 放进查询串并编码', () => {
  const url = buildMeowUrl(
    {
      nickname: 'n',
      message: 'm',
      url: 'https://example.com/p?a=1&b=2',
      imgUrl: 'https://example.com/icon_216x216.png',
    },
    API_BASE,
  )
  assert.ok(url.includes('url=https%3A%2F%2Fexample.com%2Fp%3Fa%3D1%26b%3D2'))
  assert.ok(url.includes('imgUrl=https%3A%2F%2Fexample.com%2Ficon_216x216.png'))
})

test('buildMeowUrl：未提供 url / imgUrl 时不追加对应参数', () => {
  const url = buildMeowUrl({ nickname: 'n', message: 'm' }, API_BASE)
  assert.ok(!url.includes('url='))
  assert.ok(!url.includes('imgUrl='))
})

// ─────────────── msgType / htmlHeight（文档参数）───────────────

test('msgType=html 时才带 htmlHeight，且夹取到合理范围', () => {
  const text = buildMeowUrl(
    { nickname: 'n', message: 'm', msgType: 'text', htmlHeight: 400 },
    API_BASE,
  )
  assert.ok(text.includes('msgType=text'))
  assert.ok(!text.includes('htmlHeight'), 'text 模式下不应带 htmlHeight')

  const html = buildMeowUrl(
    { nickname: 'n', message: 'm', msgType: 'html', htmlHeight: 400 },
    API_BASE,
  )
  assert.ok(html.includes('msgType=html'))
  assert.ok(html.includes('htmlHeight=400'))

  const clamped = buildMeowUrl(
    { nickname: 'n', message: 'm', msgType: 'html', htmlHeight: 99_999 },
    API_BASE,
  )
  assert.ok(clamped.includes('htmlHeight=2000'), '超上限应夹到 2000')
})

test('normalizeMsgType / normalizeHtmlHeight：非法值回退默认', () => {
  assert.equal(normalizeMsgType('html'), 'html')
  assert.equal(normalizeMsgType('HTML'), 'text', '取值大小写敏感，非 html 一律视为 text')
  assert.equal(normalizeMsgType('bogus'), 'text')
  assert.equal(normalizeMsgType(undefined), 'text')

  assert.equal(normalizeHtmlHeight(400), 400)
  assert.equal(normalizeHtmlHeight('300'), 300)
  assert.equal(normalizeHtmlHeight('abc'), 200)
  assert.equal(normalizeHtmlHeight(1), 50)
  assert.equal(normalizeHtmlHeight(99_999), 2_000)
})

// ─────────────────────── POST 形式 ───────────────────────

test('buildMeowPostUrl：/{昵称}/[title] 且 title 可省略', () => {
  assert.equal(
    buildMeowPostUrl({ nickname: 'n', title: 'T', message: 'm' }, API_BASE),
    `${API_BASE}/n/T?msgType=text`,
  )
  assert.equal(
    buildMeowPostUrl({ nickname: 'n', message: 'm' }, API_BASE),
    `${API_BASE}/n?msgType=text`,
  )
})

test('buildMeowBody：msg 必填，其余字段按存在与否带上', () => {
  assert.deepEqual(buildMeowBody({ nickname: 'n', message: 'hello' }), { msg: 'hello' })
  assert.deepEqual(
    buildMeowBody({
      nickname: 'n',
      title: 'T',
      message: 'hello',
      url: 'https://e.com',
      imgUrl: 'https://e.com/i.png',
    }),
    { msg: 'hello', title: 'T', url: 'https://e.com', imgUrl: 'https://e.com/i.png' },
  )
})

test('pushToMeow：method=POST 时用 JSON body 发送', async () => {
  const mock = mockFetch(async () => successResponse())
  try {
    const outcome = await pushToMeow(
      { nickname: 'chuck', title: 'T', message: 'M', url: 'https://e.com' },
      { apiBase: API_BASE, method: 'POST' },
    )
    assert.equal(outcome.ok, true)

    const call = mock.calls[0]
    assert.equal(call?.init?.method, 'POST')
    const headers = call?.init?.headers as Record<string, string> | undefined
    assert.equal(headers?.['content-type'], 'application/json')
    assert.deepEqual(JSON.parse(String(call?.init?.body)), {
      msg: 'M',
      title: 'T',
      url: 'https://e.com',
    })
    assert.ok(urlOf(call).startsWith(`${API_BASE}/chuck/T?`), `实际 ${urlOf(call)}`)
  } finally {
    mock.restore()
  }
})

test('pushToMeow：默认方法为 GET', async () => {
  const mock = mockFetch(async () => successResponse())
  try {
    await pushToMeow({ nickname: 'n', message: 'm' }, { apiBase: API_BASE })
    assert.equal(mock.calls[0]?.init?.method, 'GET')
    assert.equal(mock.calls[0]?.init?.body, undefined)
  } finally {
    mock.restore()
  }
})

// ─────────────────── 响应解析与业务状态码 ───────────────────

test('parseServerResult：兼容文档的 message 与实测的 msg', () => {
  const documented = parseServerResult('{"status":200,"message":"推送成功"}')
  assert.equal(documented.status, 200)
  assert.equal(documented.text, '推送成功')

  const actual = parseServerResult('{"status":200,"data":true,"msg":"发送成功"}')
  assert.equal(actual.status, 200)
  assert.equal(actual.text, '发送成功')

  const notJson = parseServerResult('<html>500</html>')
  assert.equal(notJson.parsed, false)
  assert.equal(notJson.status, undefined)
  assert.equal(notJson.text, '<html>500</html>')

  const empty = parseServerResult('')
  assert.equal(empty.text, '')
})

test('classifyBusinessStatus：按文档语义分类（400/403/404/429/500）', () => {
  assert.equal(classifyBusinessStatus(400, '参数错误').kind, 'http')
  assert.equal(classifyBusinessStatus(403, '内容策略禁止发送').kind, 'forbidden')
  assert.equal(classifyBusinessStatus(404, '昵称未注册').kind, 'nickname')
  assert.equal(classifyBusinessStatus(429, '频率超限').kind, 'ratelimit')
  assert.equal(classifyBusinessStatus(500, '服务器错误').kind, 'server')
  assert.equal(classifyBusinessStatus(418, '未知').kind, 'server')

  assert.match(classifyBusinessStatus(404, '').message, /昵称未注册/)
  assert.match(classifyBusinessStatus(429, '').message, /3 秒 1 条/)
})

test('业务状态码在 HTTP 200 里也要被识别为失败', async () => {
  const mock = mockFetch(
    async () => new Response('{"status":404,"message":"昵称未注册"}', { status: 200 }),
  )
  try {
    const result = await pushToMeow({ nickname: 'n', message: 'm' }, { apiBase: API_BASE })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.kind, 'nickname')
    assert.equal(result.status, 404)
    assert.match(result.message, /昵称未注册/)
  } finally {
    mock.restore()
  }
})

test('业务状态 429 → ratelimit，并提示限流阈值', async () => {
  const mock = mockFetch(
    async () => new Response('{"status":429,"message":"发送频率超限"}', { status: 200 }),
  )
  try {
    const result = await pushToMeow({ nickname: 'n', message: 'm' }, { apiBase: API_BASE })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.kind, 'ratelimit')
    assert.match(result.message, /每分钟 15 条/)
  } finally {
    mock.restore()
  }
})

test('业务 status=200 视为成功，并回传服务端描述', async () => {
  const mock = mockFetch(async () => successResponse())
  try {
    const result = await pushToMeow({ nickname: 'n', message: 'm' }, { apiBase: API_BASE })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.status, 200)
    assert.equal(result.message, '发送成功')
  } finally {
    mock.restore()
  }
})

test('响应体非 JSON 但 HTTP 200 时按成功处理（不误判）', async () => {
  const mock = mockFetch(async () => new Response('ok', { status: 200 }))
  try {
    const result = await pushToMeow({ nickname: 'n', message: 'm' }, { apiBase: API_BASE })
    assert.equal(result.ok, true)
  } finally {
    mock.restore()
  }
})

// ─────────────────────── 基本请求行为 ───────────────────────

test('pushToMeow：成功 → ok:true，携带信号与 accept 头', async () => {
  const mock = mockFetch(async () => successResponse())
  try {
    const outcome = await pushToMeow(
      { nickname: 'chuck', title: 'T', message: 'M' },
      { apiBase: API_BASE, timeout: 1_000 },
    )
    assert.equal(outcome.ok, true)
    if (!outcome.ok) return
    assert.equal(outcome.status, 200)
    assert.equal(outcome.url, `${API_BASE}/chuck/T/M?msgType=text`)

    const call = mock.calls[0]
    assert.equal(call?.init?.method, 'GET')
    assert.equal(call?.init?.redirect, 'follow')
    assert.ok((call?.init?.signal ?? null) !== null, '必须传入 abort signal')
    const headers = call?.init?.headers as Record<string, string> | undefined
    assert.ok((headers?.['accept'] ?? '').includes('application/json'))
  } finally {
    mock.restore()
  }
})

test('pushToMeow：imgUrl 透传进查询串', async () => {
  const mock = mockFetch(async () => successResponse())
  try {
    await pushToMeow(
      { nickname: 'n', message: 'm', imgUrl: 'https://e.com/i.png' },
      { apiBase: API_BASE },
    )
    assert.ok(urlOf(mock.calls[0]).includes('imgUrl=https%3A%2F%2Fe.com%2Fi.png'))
  } finally {
    mock.restore()
  }
})

// ─────────────────────── 错误分类 ───────────────────────

test('分类：message 为空 → invalid，且不发起请求', async () => {
  const mock = mockFetch(async () => successResponse())
  try {
    const outcome = await pushToMeow({ nickname: 'n', message: '   ' }, { apiBase: API_BASE })
    assert.equal(outcome.ok, false)
    if (outcome.ok) return
    assert.equal(outcome.kind, 'invalid')
    assert.equal(mock.calls.length, 0, '参数不合法不应发请求')
  } finally {
    mock.restore()
  }
})

test('分类：HTTP 非 2xx → http（含 400/503）', async () => {
  const bad = mockFetch(
    async () => new Response('<!doctype html><html>Bad Request</html>', { status: 400 }),
  )
  try {
    const result = await pushToMeow({ nickname: 'n', message: 'm' }, { apiBase: API_BASE })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.kind, 'http')
    assert.equal(result.status, 400)
    assert.match(result.message, /HTTP 400/)
  } finally {
    bad.restore()
  }

  const serverError = mockFetch(async () => new Response('oops', { status: 503 }))
  try {
    const result = await pushToMeow({ nickname: 'n', message: 'm' }, { apiBase: API_BASE })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.kind, 'http')
    assert.match(result.message, /服务端异常/)
  } finally {
    serverError.restore()
  }
})

test('分类：fetch 抛 TypeError → network', async () => {
  const mock = mockFetch(async () => {
    throw new TypeError('fetch failed')
  })
  try {
    const result = await pushToMeow({ nickname: 'n', message: 'm' }, { apiBase: API_BASE })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.kind, 'network')
    assert.ok(result.message.includes('fetch failed'))
  } finally {
    mock.restore()
  }
})

test('分类：超时 → timeout 且能快速返回', async () => {
  const mock = hangingFetch()
  try {
    const startedAt = Date.now()
    const result = await pushToMeow(
      { nickname: 'n', message: 'm' },
      { apiBase: API_BASE, timeout: 80 },
    )
    const elapsed = Date.now() - startedAt

    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.kind, 'timeout')
    assert.ok(result.message.includes('80ms'))
    assert.ok(elapsed < 3_000, `应快速超时，实际 ${elapsed}ms`)
  } finally {
    mock.restore()
  }
})

test('分类：上层取消 → aborted（请求中取消）', async () => {
  const mock = hangingFetch()
  try {
    const controller = new AbortController()
    const pending = pushToMeow(
      { nickname: 'n', message: 'm' },
      { apiBase: API_BASE, timeout: 30_000, signal: controller.signal },
    )
    setTimeout(() => controller.abort(), 20)
    const result = await pending

    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.kind, 'aborted')
  } finally {
    mock.restore()
  }
})

test('分类：进入前已取消 → aborted，且不发请求', async () => {
  const mock = mockFetch(async () => successResponse())
  try {
    const controller = new AbortController()
    controller.abort()
    const result = await pushToMeow(
      { nickname: 'n', message: 'm' },
      { apiBase: API_BASE, signal: controller.signal },
    )
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.kind, 'aborted')
    assert.equal(mock.calls.length, 0)
  } finally {
    mock.restore()
  }
})

test('分类：非 TypeError 的异常 → unknown（兜底）', async () => {
  const mock = mockFetch(async () => {
    throw new Error('weird failure')
  })
  try {
    const result = await pushToMeow({ nickname: 'n', message: 'm' }, { apiBase: API_BASE })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.kind, 'unknown')
    assert.ok(result.message.includes('weird failure'))
  } finally {
    mock.restore()
  }
})

// ─────────────────────── 发送间隔保护 ───────────────────────

test('remainingGlobalWindow：遵守文档的 3 秒最小间隔', () => {
  assert.equal(remainingGlobalWindow(0, 3_000, 10_000), 0, '从未发送过 → 无需等待')
  assert.equal(remainingGlobalWindow(10_000, 3_000, 11_000), 2_000, '距上次 1s → 还需 2s')
  assert.equal(remainingGlobalWindow(10_000, 3_000, 13_000), 0, '已过 3s → 可以发')
  assert.equal(remainingGlobalWindow(10_000, 0, 10_100), 0, '间隔为 0 → 关闭保护')
})

// ─────────────────────── execute 端到端 ───────────────────────

/** 现在配置只有一个字段：昵称 */
const VALID_CONFIG = { nickname: 'chuck' }

function createContext(config: unknown): {
  ctx: Record<string, unknown>
  registered: ToolDefinition<unknown, string>[]
} {
  const registered: ToolDefinition<unknown, string>[] = []
  const ctx: Record<string, unknown> = {
    config,
    logger: { error: () => {}, warn: () => {}, info: () => {} },
    tools: {
      register: (definition: ToolDefinition<unknown, string>) => {
        registered.push(definition)
        return () => {}
      },
    },
  }
  return { ctx, registered }
}

test('execute：成功时返回 ✅ 文本，POST body 带标题与昵称路径', async () => {
  resetThrottleState()
  const mock = mockFetch(async () => successResponse())
  try {
    const { ctx, registered } = createContext(VALID_CONFIG)
    apply(ctx)
    const tool = registered[0]
    assert.ok(tool !== undefined)
    assert.equal(tool.name, TOOL_NAME)
    const text = await tool.execute(
      { title: '构建', message: '完成' },
      { signal: new AbortController().signal },
    )
    assert.equal(text, '✅ 通知已推送到 MeoW：构建 - 完成')

    const call = mock.calls[0]
    // 方法固化为 POST：昵称与标题走路径，正文走 JSON Body
    assert.equal(call?.init?.method, 'POST')
    assert.ok(
      urlOf(call).startsWith(`${DEFAULT_API_BASE}/chuck/%E6%9E%84%E5%BB%BA?`),
      `URL 应使用配置中的昵称并编码标题，实际 ${urlOf(call)}`,
    )
    const body = JSON.parse(String(call?.init?.body)) as Record<string, string>
    assert.equal(body['msg'], '完成')
    assert.equal(body['title'], '构建')
  } finally {
    mock.restore()
  }
})

test('execute：同一会话 5 秒内第二次被节流拦截', async () => {
  resetThrottleState()
  const mock = mockFetch(async () => successResponse())
  try {
    const { ctx, registered } = createContext(VALID_CONFIG)
    apply(ctx)
    const tool = registered[0]
    assert.ok(tool !== undefined)
    const exec = { signal: new AbortController().signal, agent: { id: 'session-1' } }

    const first = await tool.execute({ message: '第一次' }, exec)
    assert.ok(first.startsWith('✅'), `首次应成功，实际：${first}`)
    assert.equal(mock.calls.length, 1)

    const second = await tool.execute({ message: '第二次' }, exec)
    assert.ok(second.startsWith('⚠️ 推送已节流'), `第二次应被节流，实际：${second}`)
    assert.equal(mock.calls.length, 1, '被节流时不得再发请求')
  } finally {
    mock.restore()
  }
})

test('execute：message 为空时直接拒绝且不发请求', async () => {
  resetThrottleState()
  const mock = mockFetch(async () => successResponse())
  try {
    const { ctx, registered } = createContext(VALID_CONFIG)
    apply(ctx)
    const tool = registered[0]
    assert.ok(tool !== undefined)
    const result = await tool.execute({ message: '   ' }, { signal: new AbortController().signal })
    assert.ok(result.startsWith('⚠️ 推送失败：message 不能为空'))
    assert.equal(mock.calls.length, 0)
  } finally {
    mock.restore()
  }
})

test('execute：调用前已被取消 → 直接返回取消提示', async () => {
  resetThrottleState()
  const mock = mockFetch(async () => successResponse())
  try {
    const { ctx, registered } = createContext(VALID_CONFIG)
    apply(ctx)
    const tool = registered[0]
    assert.ok(tool !== undefined)
    const controller = new AbortController()
    controller.abort()
    const result = await tool.execute({ message: 'hi' }, { signal: controller.signal })
    assert.ok(result.startsWith('⚠️ 推送已取消'))
    assert.equal(mock.calls.length, 0)
  } finally {
    mock.restore()
  }
})

test('execute：请求细节已固化（HTTPS + POST + text），配置文件无法改变', async () => {
  resetThrottleState()
  const mock = mockFetch(async () => successResponse())
  try {
    // 故意塞入旧的可配置字段：这些都不应再生效
    const { ctx, registered } = createContext({
      nickname: 'chuck',
      apiBase: 'http://127.0.0.1:8080/meow',
      method: 'GET',
      msgType: 'html',
      timeout: 1,
    })
    apply(ctx)
    const tool = registered[0]
    assert.ok(tool !== undefined)
    await tool.execute({ message: 'm' }, { signal: new AbortController().signal })

    const call = mock.calls[0]
    assert.equal(call?.init?.method, 'POST', '方法固定为 POST')
    const url = urlOf(call)
    // 未传 title 时插件会填入默认标题，POST 路径是 /{昵称}/{默认标题}
    assert.ok(
      url.startsWith(`${DEFAULT_API_BASE}/chuck/${encodeURIComponent(DEFAULT_TITLE)}?`),
      `应使用固化的 HTTPS 地址与默认标题，实际 ${url}`,
    )
    assert.ok(!url.includes('127.0.0.1'), '配置里的 apiBase 不应再生效')
    assert.ok(url.includes('msgType=text'), '格式固定为 text')
    assert.ok(!url.includes('msgType=html'))
  } finally {
    mock.restore()
  }
})

test('execute：工具入参 imgUrl 走 JSON Body 透传', async () => {
  resetThrottleState()
  const mock = mockFetch(async () => successResponse())
  try {
    const { ctx, registered } = createContext(VALID_CONFIG)
    apply(ctx)
    const tool = registered[0]
    assert.ok(tool !== undefined)
    await tool.execute(
      { message: 'm', imgUrl: 'https://e.com/icon.png' },
      { signal: new AbortController().signal },
    )
    const body = JSON.parse(String(mock.calls[0]?.init?.body)) as Record<string, string>
    assert.equal(body['imgUrl'], 'https://e.com/icon.png')
    assert.equal(body['msg'], 'm')
  } finally {
    mock.restore()
  }
})

test('DEFAULT_API_BASE 默认使用官方推荐的 HTTPS', () => {
  assert.equal(DEFAULT_API_BASE, 'https://api.chuckfang.com')
})
