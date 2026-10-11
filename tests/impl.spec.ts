/**
 * tests/impl.spec.ts —— 推送实现测试（mock fetch）
 *
 * 覆盖：URL 构造与编码、查询串、请求头、超时、取消、HTTP 错误、
 *       业务错误、网络错误、返回体截断、execute 的节流与校验。
 *
 * 运行：pnpm test
 *   导入写 '../dist/xxx.ts'：测试针对的是 DSH 实际加载的编译产物 dist/；
 *   tsc 会把它输出为 '../dist/xxx.js'。详见 register.spec.ts 顶部说明。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { buildMeowUrl, pushToMeow } from '../dist/meow-api.ts'
import { TOOL_NAME, apply, resetThrottleState } from '../dist/index.ts'
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

/** 从 execute 的返回值里取出 URL */
function urlOf(call: FetchCall | undefined): string {
  assert.ok(call !== undefined, '应当发起了一次 fetch')
  return call.url
}

// ─────────────────────── URL 构造 ───────────────────────

test('buildMeowUrl：路径段里的斜杠被换成全角 ／（否则 MeoW 回 HTTP 400）', () => {
  // 实测：路径段里的 %2F 会被 Tomcat 拒绝（ALLOW_ENCODED_SLASH 默认关闭）
  const url = buildMeowUrl({ nickname: 'n', title: 'T', message: '72 通过 / 0 失败' }, API_BASE)
  assert.ok(!url.includes('%2F'), '路径段里不能出现 %2F')
  assert.ok(url.includes('%EF%BC%8F'), '斜杠应被替换为全角 ／（UTF-8: EF BC 8F）')
  // 查询串不受影响：url 参数里的 / 仍是普通编码（实测 ?url=a%2Fb 返回 200）
  const withQuery = buildMeowUrl(
    { nickname: 'n', message: 'm', url: 'https://github.com/a/b' },
    API_BASE,
  )
  assert.ok(
    withQuery.endsWith('?url=https%3A%2F%2Fgithub.com%2Fa%2Fb'),
    '查询串里的斜杠保持普通编码',
  )
})

test('buildMeowUrl：反斜杠 / 引号 / 尖括号 / 百分号也换成全角', () => {
  const url = buildMeowUrl({ nickname: 'n', message: 'a\\b "c" <d> 100%' }, API_BASE)
  for (const encoded of ['%5C', '%22', '%3C', '%3E', '%25']) {
    assert.ok(!url.includes(encoded), `路径段里不应出现 ${encoded}`)
  }
})

test('buildMeowUrl：nickname 与 title 里的斜杠同样被替换', () => {
  const url = buildMeowUrl({ nickname: 'a/b', title: 'x/y', message: 'm' }, API_BASE)
  assert.ok(!url.includes('%2F'), 'nickname / title 里的斜杠也必须替换，否则同样 400')
  assert.equal((url.match(/%EF%BC%8F/g) ?? []).length, 2)
})

test('buildMeowUrl：基础形状与顺序正确', () => {
  assert.equal(
    buildMeowUrl({ nickname: 'chuck', title: 'MeoW Push Bridge', message: 'hello world' }, API_BASE),
    `${API_BASE}/chuck/MeoW%20Push%20Bridge/hello%20world`,
  )
})

test('buildMeowUrl：title 为空/缺省时回退默认标题', () => {
  // DEFAULT_TITLE = 'MeoW Push Bridge'（空格编码为 %20，路径段里不含裸空格）
  const fallback = `${API_BASE}/n/MeoW%20Push%20Bridge/m`
  assert.equal(buildMeowUrl({ nickname: 'n', title: '', message: 'm' }, API_BASE), fallback)
  assert.equal(buildMeowUrl({ nickname: 'n', message: 'm' }, API_BASE), fallback)
  assert.equal(buildMeowUrl({ nickname: 'n', title: '   ', message: 'm' }, API_BASE), fallback)
})

test('buildMeowUrl：路径段与查询串全部编码（空格、中文、&、#，斜杠转全角）', () => {
  const url = buildMeowUrl(
    {
      nickname: '喵桥/user',
      title: 'A B',
      message: 'a/b?c#d&e=中 文',
      url: 'https://example.com/p?a=1&b=2',
    },
    `${API_BASE}/`,
  )
  // 昵称中的 / 转成全角后不会多出一层路径
  assert.ok(!url.includes('/喵桥/user/'), '昵称里的斜杠必须被替换')
  assert.ok(url.includes('A%20B'))
  // 'a/b?c#d&e=中 文' → 斜杠转全角 ／(EF BC 8F)，其余照常编码
  assert.ok(
    url.includes('a%EF%BC%8Fb%3Fc%23d%26e%3D%E4%B8%AD%20%E6%96%87'),
    `路径段编码不符，实际 URL：${url}`,
  )
  assert.ok(url.endsWith('?url=https%3A%2F%2Fexample.com%2Fp%3Fa%3D1%26b%3D2'))
  // base 尾部多余斜杠被规范化
  assert.ok(!url.includes('com//'))
})

test('buildMeowUrl：未提供 url 时不追加查询串', () => {
  assert.ok(!buildMeowUrl({ nickname: 'n', message: 'm' }, API_BASE).includes('?'))
})

// ─────────────────────── 请求行为 ───────────────────────

test('pushToMeow：成功 → ok:true，GET、携带信号与 accept 头', async () => {
  const mock = mockFetch(async () => new Response('{"code":0,"msg":"ok"}', { status: 200 }))
  try {
    const outcome = await pushToMeow(
      { nickname: 'chuck', title: 'T', message: 'M' },
      API_BASE,
      { timeout: 1_000 },
    )
    assert.equal(outcome.ok, true)
    if (!outcome.ok) return
    assert.equal(outcome.status, 200)
    assert.equal(outcome.url, `${API_BASE}/chuck/T/M`)

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

test('pushToMeow：失败类请求同样要发出（分类交给调用方）', async () => {
  const mock = mockFetch(async () => new Response('boom', { status: 500 }))
  try {
    const outcome = await pushToMeow({ nickname: 'n', message: 'm' }, API_BASE)
    assert.equal(outcome.ok, false)
    assert.equal(mock.calls.length, 1)
  } finally {
    mock.restore()
  }
})

// ─────────────────────── 错误分类 ───────────────────────

test('分类：message 为空 → invalid，且不发起请求', async () => {
  const mock = mockFetch(async () => new Response('', { status: 200 }))
  try {
    const outcome = await pushToMeow({ nickname: 'n', message: '   ' }, API_BASE)
    assert.equal(outcome.ok, false)
    if (outcome.ok) return
    assert.equal(outcome.kind, 'invalid')
    assert.equal(mock.calls.length, 0, '参数不合法不应发请求')
  } finally {
    mock.restore()
  }
})

test('分类：HTTP 404 → http，并提示昵称可能未注册', async () => {
  const mock = mockFetch(async () => new Response('not found', { status: 404 }))
  try {
    const result = await pushToMeow({ nickname: 'n', message: 'm' }, API_BASE)
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.kind, 'http')
    assert.equal(result.status, 404)
    assert.ok(result.message.includes('404'))
    assert.ok(result.message.includes('昵称'), '404 需给出昵称提示')
  } finally {
    mock.restore()
  }
})

test('分类：HTTP 500 → http，并提示服务端异常', async () => {
  const mock = mockFetch(async () => new Response('oops', { status: 500 }))
  try {
    const result = await pushToMeow({ nickname: 'n', message: 'm' }, API_BASE)
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.kind, 'http')
    assert.equal(result.status, 500)
    assert.ok(result.message.includes('服务端异常'))
  } finally {
    mock.restore()
  }
})

test('分类：2xx 但业务失败 → business，回显服务端原因', async () => {
  const mock = mockFetch(
    async () => new Response(JSON.stringify({ code: 1, message: 'nickname not found' }), { status: 200 }),
  )
  try {
    const result = await pushToMeow({ nickname: 'n', message: 'm' }, API_BASE)
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.kind, 'business')
    assert.equal(result.status, 200)
    assert.ok(result.message.includes('nickname not found'))
  } finally {
    mock.restore()
  }
})

test('分类：fetch 抛 TypeError → network', async () => {
  const mock = mockFetch(async () => {
    throw new TypeError('fetch failed')
  })
  try {
    const result = await pushToMeow({ nickname: 'n', message: 'm' }, API_BASE)
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
    const result = await pushToMeow({ nickname: 'n', message: 'm' }, API_BASE, { timeout: 80 })
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
    const pending = pushToMeow({ nickname: 'n', message: 'm' }, API_BASE, {
      timeout: 30_000,
      signal: controller.signal,
    })
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
  const mock = mockFetch(async () => new Response('', { status: 200 }))
  try {
    const controller = new AbortController()
    controller.abort()
    const result = await pushToMeow({ nickname: 'n', message: 'm' }, API_BASE, {
      signal: controller.signal,
    })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.kind, 'aborted')
    assert.equal(mock.calls.length, 0)
  } finally {
    mock.restore()
  }
})

test('默认标题统一为 MeoW Push Bridge（空格在路径段里编码为 %20）', () => {
  const url = buildMeowUrl({ nickname: 'n', message: 'm' }, API_BASE)
  assert.ok(url.startsWith(`${API_BASE}/n/MeoW%20Push%20Bridge/`), `默认标题不符：${url}`)
  // 默认标题里没有需要全角替换的字符，但空格必须被编码
  assert.ok(!url.includes(' '), 'URL 中不能出现裸空格')
})

test('分类：非 TypeError 的异常 → unknown（兜底）', async () => {
  const mock = mockFetch(async () => {
    throw new Error('weird failure')
  })
  try {
    const result = await pushToMeow({ nickname: 'n', message: 'm' }, API_BASE)
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.kind, 'unknown')
    assert.ok(result.message.includes('weird failure'))
  } finally {
    mock.restore()
  }
})

test('返回体超过 300 字符时被截断', async () => {
  const long = 'a'.repeat(600)
  const mock = mockFetch(async () => new Response(long, { status: 500 }))
  try {
    const result = await pushToMeow({ nickname: 'n', message: 'm' }, API_BASE)
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.ok(result.body !== undefined)
    assert.ok(result.body.length <= 302, `返回体应被截断，实际 ${result.body.length}`)
    assert.ok(result.body.endsWith('…'))
  } finally {
    mock.restore()
  }
})

// ─────────────────────── execute 端到端 ───────────────────────

const VALID_CONFIG = {
  nickname: 'chuck',
  apiBase: API_BASE,
  timeout: 1_000,
  throttleMs: 5_000,
}

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

test('execute：成功时返回 ✅ 文本，且 URL 使用配置里的 nickname', async () => {
  resetThrottleState()
  const mock = mockFetch(async () => new Response('ok', { status: 200 }))
  try {
    const { ctx, registered } = createContext(VALID_CONFIG)
    apply(ctx)
    const tool = registered[0]
    assert.ok(tool !== undefined)
    assert.equal(tool.name, TOOL_NAME)
    // 工具定义声明为 <unknown, string>，execute 的入参由 DSH 校验，这里直接给合法值
    const text = await tool.execute(
      { title: '构建', message: '完成' },
      { signal: new AbortController().signal },
    )
    assert.equal(text, `✅ 通知已推送到 MeoW：构建 - 完成`)
    assert.ok(
      urlOf(mock.calls[0]).startsWith(`${API_BASE}/chuck/%E6%9E%84%E5%BB%BA/`),
      `URL 应使用配置中的昵称并编码标题，实际 ${urlOf(mock.calls[0])}`,
    )
  } finally {
    mock.restore()
  }
})

test('execute：同一会话 5 秒内第二次被节流拦截', async () => {
  resetThrottleState()
  const mock = mockFetch(async () => new Response('ok', { status: 200 }))
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

    // 不同会话不受影响
    const other = await tool.execute(
      { message: '另一个会话' },
      { signal: new AbortController().signal, agent: { id: 'session-2' } },
    )
    assert.ok(other.startsWith('✅'))
    assert.equal(mock.calls.length, 2)
  } finally {
    mock.restore()
  }
})

test('execute：message 为空时直接拒绝且不发请求', async () => {
  resetThrottleState()
  const mock = mockFetch(async () => new Response('ok', { status: 200 }))
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
  const mock = mockFetch(async () => new Response('ok', { status: 200 }))
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

test('execute：配置中的 apiBase 生效（可指向自建/代理地址）', async () => {
  resetThrottleState()
  const mock = mockFetch(async () => new Response('ok', { status: 200 }))
  try {
    const { ctx, registered } = createContext({
      ...VALID_CONFIG,
      apiBase: 'http://127.0.0.1:8080/meow',
    })
    apply(ctx)
    const tool = registered[0]
    assert.ok(tool !== undefined)
    await tool.execute({ message: 'm' }, { signal: new AbortController().signal })
    assert.ok(urlOf(mock.calls[0]).startsWith('http://127.0.0.1:8080/meow/chuck/'))
  } finally {
    mock.restore()
  }
})
