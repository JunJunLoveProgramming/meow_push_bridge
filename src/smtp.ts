/**
 * dsh-junjun-transit / 骏骏通知中转
 * src/smtp.ts —— 零依赖 SMTP 客户端（纯文本邮件）
 *
 * 为什么自己实现：
 *   插件坚持「零运行时依赖」，不能引入 nodemailer；这里只实现推送需要的
 *   最小 SMTP 子集：EHLO / STARTTLS / AUTH PLAIN|LOGIN / MAIL / RCPT / DATA。
 *
 * 支持：
 *   - 465 隐式 TLS（encryption = 'tls'）
 *   - 587 STARTTLS（encryption = 'starttls'，默认）
 *   - 25 明文（encryption = 'none'，仅内网/本机中继建议）
 *
 * 邮件正文固定 UTF-8 纯文本（base64 传输），主题用 RFC 2047 编码。
 */

import { randomUUID } from 'node:crypto'
import net from 'node:net'
import tls from 'node:tls'

export type SmtpEncryption = 'tls' | 'starttls' | 'none'

export interface SmtpConfig {
  host: string
  port: number
  encryption: SmtpEncryption
  username: string
  password: string
  fromEmail: string
  fromName: string
  toEmail: string
}

export interface SmtpMessage {
  subject: string
  text: string
}

export interface SmtpResult {
  ok: boolean
  /** 面向用户的错误信息（成功时为空） */
  error?: string
  /** 实际使用的服务器，便于提示 */
  server?: string
}

const DEFAULT_TIMEOUT_MS = 20_000
const MAX_MESSAGE_BYTES = 2 * 1024 * 1024

class SmtpProtocolError extends Error {}

/** 读取一行（CRLF 结尾）；超时/断开时拒绝 */
class LineReader {
  private buffer = ''
  private lines: string[] = []
  private waiters: Array<{ resolve: (line: string) => void; reject: (error: Error) => void }> = []

  feed(chunk: string): void {
    this.buffer += chunk
    let index = this.buffer.indexOf('\r\n')
    while (index >= 0) {
      const line = this.buffer.slice(0, index)
      this.buffer = this.buffer.slice(index + 2)
      const waiter = this.waiters.shift()
      if (waiter !== undefined) waiter.resolve(line)
      else this.lines.push(line)
      index = this.buffer.indexOf('\r\n')
    }
  }

  fail(error: Error): void {
    for (const waiter of this.waiters.splice(0)) waiter.reject(error)
  }

  read(timeoutMs: number): Promise<string> {
    if (this.lines.length > 0) return Promise.resolve(this.lines.shift() as string)
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.findIndex((item) => item.resolve === wrappedResolve)
        if (index >= 0) this.waiters.splice(index, 1)
        reject(new Error('SMTP 响应超时'))
      }, timeoutMs)
      const wrappedResolve = (line: string): void => {
        clearTimeout(timer)
        resolve(line)
      }
      const wrappedReject = (error: Error): void => {
        clearTimeout(timer)
        reject(error)
      }
      this.waiters.push({ resolve: wrappedResolve, reject: wrappedReject })
    })
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}超时`)), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function encodeHeader(value: string): string {
  const clean = value.replace(/[\r\n]+/g, ' ').trim()
  if (clean === '') return ''
  // 纯 ASCII 直接放；含中文/特殊字符时按 RFC 2047 编码
  if (/^[\x20-\x7E]*$/.test(clean)) return clean
  return `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`
}

function wrapBase64(text: string): string {
  return Buffer.from(text, 'utf8')
    .toString('base64')
    .replace(/(.{76})/g, '$1\r\n')
}

/** 构造纯文本 MIME 邮件；不拼接用户输入以外的头部，避免头注入 */
export function buildSmtpMessage(config: SmtpConfig, message: SmtpMessage): string {
  const fromName = encodeHeader(config.fromName)
  const from = fromName === '' ? config.fromEmail : `${fromName} <${config.fromEmail}>`
  const subject = encodeHeader(message.subject.trim() === '' ? '骏骏消息中转' : message.subject)
  const body = wrapBase64(message.text)
  const domain = config.fromEmail.split('@')[1] ?? 'localhost'

  return [
    `From: ${from}`,
    `To: ${config.toEmail}`,
    `Subject: ${subject}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@${domain}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    body,
  ].join('\r\n')
}

/** 校验设置；密码允许为空（有些内网中继不需要认证） */
export function validateSmtpConfig(
  input: unknown,
): { ok: true; config: SmtpConfig } | { ok: false; error: string } {
  if (input === null || typeof input !== 'object') return { ok: false, error: 'SMTP 配置格式错误' }
  const table = input as Record<string, unknown>
  const host = typeof table['host'] === 'string' ? table['host'].trim() : ''
  const portRaw = table['port']
  const port = typeof portRaw === 'number' ? portRaw : Number(portRaw)
  const encryptionRaw = typeof table['encryption'] === 'string' ? table['encryption'] : 'starttls'
  const encryption: SmtpEncryption =
    encryptionRaw === 'tls' || encryptionRaw === 'none' ? encryptionRaw : 'starttls'
  const username = typeof table['username'] === 'string' ? table['username'].trim() : ''
  const password = typeof table['password'] === 'string' ? table['password'] : ''
  const fromEmail = typeof table['fromEmail'] === 'string' ? table['fromEmail'].trim() : ''
  const fromName = typeof table['fromName'] === 'string' ? table['fromName'].trim().slice(0, 60) : ''
  const toEmail = typeof table['toEmail'] === 'string' ? table['toEmail'].trim() : ''

  if (host === '' || /\s/.test(host)) return { ok: false, error: 'SMTP 服务器地址不能为空，且不能包含空格' }
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, error: 'SMTP 端口必须是 1–65535' }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromEmail)) return { ok: false, error: '发件人邮箱格式不正确' }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) return { ok: false, error: '收件人邮箱格式不正确' }
  if (username !== '' && password === '') return { ok: false, error: '填写了 SMTP 用户名时，密码不能为空' }

  return {
    ok: true,
    config: { host, port, encryption, username, password, fromEmail, fromName, toEmail },
  }
}

/** 给前端看的配置：永远不返回密码，只返回 hasPassword */
export function publicSmtpConfig(config: SmtpConfig): Record<string, unknown> {
  return {
    host: config.host,
    port: config.port,
    encryption: config.encryption,
    username: config.username,
    fromEmail: config.fromEmail,
    fromName: config.fromName,
    toEmail: config.toEmail,
    hasPassword: config.password !== '',
  }
}

/** 一条 SMTP 连接 */
class SmtpSession {
  private socket: net.Socket | tls.TLSSocket | null = null
  private reader = new LineReader()
  private readonly timeoutMs: number
  private capabilities: string[] = []

  constructor(
    private readonly config: SmtpConfig,
    timeoutMs: number,
  ) {
    this.timeoutMs = timeoutMs
  }

  private attach(socket: net.Socket | tls.TLSSocket): void {
    this.socket = socket
    this.reader = new LineReader()
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => this.reader.feed(chunk))
    socket.on('error', (error: Error) => this.reader.fail(error))
    socket.on('close', () => this.reader.fail(new Error('SMTP 连接已关闭')))
    socket.setTimeout(this.timeoutMs, () => {
      this.reader.fail(new Error('SMTP 连接超时'))
      socket.destroy()
    })
  }

  private async readResponse(): Promise<{ code: number; text: string }> {
    const first = await this.reader.read(this.timeoutMs)
    const match = /^(\d{3})([ -])(.*)$/.exec(first)
    if (match === null) throw new SmtpProtocolError(`无法解析 SMTP 响应：${first.slice(0, 120)}`)
    const code = Number(match[1])
    const lines = [match[3]]
    if (match[2] === '-') {
      for (;;) {
        const line = await this.reader.read(this.timeoutMs)
        const next = /^(\d{3})([ -])(.*)$/.exec(line)
        if (next === null) {
          lines.push(line)
          continue
        }
        lines.push(next[3])
        if (next[2] === ' ') break
      }
    }
    return { code, text: lines.join('\n') }
  }

  private async command(command: string, expected: number[], label: string): Promise<string> {
    if (this.socket === null) throw new Error('SMTP 未连接')
    this.socket.write(`${command}\r\n`)
    const response = await this.readResponse()
    if (!expected.includes(response.code)) {
      throw new SmtpProtocolError(`${label}失败（SMTP ${response.code}）：${response.text}`)
    }
    return response.text
  }

  private async ehlo(): Promise<void> {
    const text = await this.command(`EHLO ${this.config.host}`, [250], 'EHLO')
    this.capabilities = text.split('\n').map((line) => line.toUpperCase())
  }

  private async startTls(): Promise<void> {
    await this.command('STARTTLS', [220], 'STARTTLS')
    const plain = this.socket
    if (plain === null) throw new Error('SMTP 未连接')
    plain.removeAllListeners('data')
    plain.removeAllListeners('error')
    plain.removeAllListeners('close')
    plain.removeAllListeners('timeout')

    const secure = await new Promise<tls.TLSSocket>((resolve, reject) => {
      const socket = tls.connect(
        { socket: plain, servername: this.config.host, rejectUnauthorized: true },
        () => resolve(socket),
      )
      socket.once('error', reject)
    })
    this.attach(secure)
    await this.ehlo()
  }

  private async authenticate(): Promise<void> {
    if (this.config.username === '') return
    const authLine = this.capabilities.find((line) => line.startsWith('AUTH')) ?? ''
    const mechanisms = authLine.split(/\s+/).slice(1)

    if (mechanisms.length === 0 || mechanisms.includes('PLAIN')) {
      const token = Buffer.from(`\u0000${this.config.username}\u0000${this.config.password}`, 'utf8').toString('base64')
      try {
        await this.command(`AUTH PLAIN ${token}`, [235], 'SMTP 认证')
        return
      } catch (error) {
        if (mechanisms.length === 0) throw error
      }
    }

    if (mechanisms.includes('LOGIN')) {
      await this.command('AUTH LOGIN', [334], 'SMTP 认证')
      await this.command(Buffer.from(this.config.username, 'utf8').toString('base64'), [334], 'SMTP 用户名')
      await this.command(Buffer.from(this.config.password, 'utf8').toString('base64'), [235], 'SMTP 密码')
      return
    }

    throw new SmtpProtocolError(`服务器不支持可用的认证方式（${authLine || '未声明 AUTH'}）`)
  }

  async connect(): Promise<void> {
    const options = { host: this.config.host, port: this.config.port }
    const socket =
      this.config.encryption === 'tls'
        ? await new Promise<tls.TLSSocket>((resolve, reject) => {
            const secure = tls.connect({ ...options, servername: this.config.host }, () => resolve(secure))
            secure.once('error', reject)
          })
        : await new Promise<net.Socket>((resolve, reject) => {
            const plain = net.connect(options, () => resolve(plain))
            plain.once('error', reject)
          })

    this.attach(socket)
    const greeting = await this.readResponse()
    if (greeting.code !== 220) throw new SmtpProtocolError(`服务器拒绝连接（SMTP ${greeting.code}）：${greeting.text}`)

    await this.ehlo()
    if (this.config.encryption === 'starttls') await this.startTls()
    await this.authenticate()
  }

  async send(message: SmtpMessage): Promise<void> {
    await this.command(`MAIL FROM:<${this.config.fromEmail}>`, [250], 'MAIL FROM')
    await this.command(`RCPT TO:<${this.config.toEmail}>`, [250, 251], 'RCPT TO')
    await this.command('DATA', [354], 'DATA')
    const payload = buildSmtpMessage(this.config, message)
    if (Buffer.byteLength(payload, 'utf8') > MAX_MESSAGE_BYTES) throw new Error('邮件内容超过 2 MB')
    await this.command(`${payload}\r\n.`, [250], '发送邮件正文')
  }

  async quit(): Promise<void> {
    try {
      if (this.socket !== null) await this.command('QUIT', [221], 'QUIT')
    } catch {
      // 退出失败不影响已发送结果
    } finally {
      this.destroy()
    }
  }

  destroy(): void {
    this.socket?.destroy()
    this.socket = null
  }
}

/**
 * 发送一封纯文本邮件。
 * 不抛错：所有失败都转成 `{ ok:false, error }`，方便工具/自动推送统一处理。
 */
export async function sendSmtpMail(
  config: SmtpConfig,
  message: SmtpMessage,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<SmtpResult> {
  const session = new SmtpSession(config, Math.max(5_000, timeoutMs))
  try {
    await withTimeout(session.connect(), timeoutMs, 'SMTP 连接')
    await withTimeout(session.send(message), timeoutMs, 'SMTP 发送')
    await session.quit()
    return { ok: true, server: `${config.host}:${config.port}` }
  } catch (error) {
    session.destroy()
    const messageText = error instanceof Error ? error.message : String(error)
    return { ok: false, error: messageText, server: `${config.host}:${config.port}` }
  }
}
