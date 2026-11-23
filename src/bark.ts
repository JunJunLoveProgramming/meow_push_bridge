/**
 * meow-push-bridge / MeoW Push Bridge (喵桥)
 * src/bark.ts —— 全能消息推送 Bark 通道（零依赖）
 *
 * 文档：https://www.ggsuper.com.cn/push/api.html
 * 端点：POST https://www.ggsuper.com.cn/push/api/v1/sendMsg3_New.php
 * 必填：title / msg / token / issecure=0
 * 成功：{ "code": "80000000", "msg": "Success" }
 */

export const BARK_ENDPOINT = 'https://www.ggsuper.com.cn/push/api/v1/sendMsg3_New.php'

export interface BarkConfig {
  /** 客户端注册的 token */
  token: string
  /** 发送者名称，可选 */
  sender: string
  /** 默认通知标题；留空使用主题标题 */
  title: string
  /** 默认通知图标（必须 https） */
  icon: string
}

export interface BarkMessage {
  title: string
  text: string
  url?: string
  icon?: string
}

export interface BarkResult {
  ok: boolean
  error?: string
  code?: string
}

const DEFAULT_TIMEOUT_MS = 15_000

/** 校验 Bark 配置；token 不允许包含空白 */
export function validateBarkConfig(
  input: unknown,
): { ok: true; config: BarkConfig } | { ok: false; error: string } {
  if (input === null || typeof input !== 'object') return { ok: false, error: 'Bark 配置格式错误' }
  const table = input as Record<string, unknown>
  const token = typeof table['token'] === 'string' ? table['token'].trim() : ''
  const sender = typeof table['sender'] === 'string' ? table['sender'].trim().slice(0, 30) : ''
  const title = typeof table['title'] === 'string' ? table['title'].trim().slice(0, 60) : ''
  const icon = typeof table['icon'] === 'string' ? table['icon'].trim() : ''

  if (token === '') return { ok: false, error: 'Bark token 不能为空' }
  if (/\s/.test(token)) return { ok: false, error: 'Bark token 不能包含空格' }
  if (token.length > 512) return { ok: false, error: 'Bark token 过长' }
  if (icon !== '' && !/^https:\/\/\S+$/iu.test(icon)) return { ok: false, error: 'Bark 图标必须是 https 图片地址' }
  if (icon.length > 2048) return { ok: false, error: 'Bark 图标 URL 过长' }

  return { ok: true, config: { token, sender, title, icon } }
}

export function isBarkConfigured(config: BarkConfig): boolean {
  return config.token.trim() !== ''
}

/** 前端可见配置：Bark token 按用户要求明文返回 */
export function publicBarkConfig(config: BarkConfig): Record<string, unknown> {
  return {
    token: config.token,
    sender: config.sender,
    title: config.title,
    icon: config.icon,
  }
}

/** Bark 业务错误码 → 中文提示 */
function mapBarkError(code: string, message: string): string {
  switch (code) {
    case '200':
      return 'Bark token 错误或已失效'
    case '300':
      return 'Bark 请求过于频繁（普通用户 1 小时最多 3 条）'
    case '400':
      return 'Bark 接收对象今天的次数已用完'
    case '500':
      return 'Bark 消息被对方拉黑，无法发送'
    case '1000':
      return 'Bark 风控检测异常，账号可能已被限制'
    case '0':
      return 'Bark 发送失败：网络原因或无效数据'
    default:
      return `Bark 发送失败（${code}）：${message || '未知错误'}`
  }
}

/**
 * 发送 Bark 通知。
 * 不抛错：所有失败都转成 `{ ok:false, error }`。
 */
export async function sendBark(
  config: BarkConfig,
  message: BarkMessage,
  options: { endpoint?: string; timeoutMs?: number } = {},
): Promise<BarkResult> {
  const endpoint = options.endpoint ?? BARK_ENDPOINT
  const timeoutMs = Math.max(3_000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const title = config.title !== '' ? config.title : message.title.trim() !== '' ? message.title.trim() : 'MeoW Push Bridge'
  const icon = config.icon !== '' ? config.icon : message.icon
  const url = message.url

  const payload: Record<string, unknown> = {
    title,
    msg: message.text,
    token: config.token,
    issecure: 0,
    msgType: 1,
  }
  if (config.sender !== '') payload['sender'] = config.sender
  if (url !== undefined && url !== '') payload['url'] = url
  if (icon !== undefined && /^https:\/\//i.test(icon)) payload['icon'] = icon

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const raw = await response.text()
    let parsed: unknown = null
    try {
      parsed = JSON.parse(raw)
    } catch {
      return { ok: false, error: `Bark 返回非 JSON（HTTP ${response.status}）：${raw.slice(0, 120)}` }
    }
    if (parsed === null || typeof parsed !== 'object') {
      return { ok: false, error: 'Bark 返回格式异常' }
    }
    const table = parsed as Record<string, unknown>
    const code = String(table['code'] ?? '')
    const text = typeof table['msg'] === 'string' ? table['msg'] : ''
    if (code === '80000000') return { ok: true, code }
    return { ok: false, code, error: mapBarkError(code, text) }
  } catch (error) {
    const name = error instanceof Error ? error.name : ''
    if (name === 'TimeoutError' || name === 'AbortError') {
      return { ok: false, error: 'Bark 请求超时' }
    }
    const text = error instanceof Error ? error.message : String(error)
    return { ok: false, error: `Bark 网络错误：${text}` }
  }
}
