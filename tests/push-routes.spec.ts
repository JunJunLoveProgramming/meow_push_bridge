/**
 * 推送设置路由：请求体解析、保存、GET 脱敏。
 */

import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'

import {
  registerPushRoutes,
  resetPushPreferencesState,
  type PushHost,
} from '../dist/push-settings.ts'

function makeHost(): { host: PushHost; handlers: Map<string, Function> } {
  const handlers = new Map<string, Function>()
  const store = new Map<string, string>()
  const host: PushHost = {
    get(key: string) {
      if (key === 'webServer') {
        return {
          register(route: { path: string; handler: Function }) {
            handlers.set(route.path, route.handler)
            return () => {}
          },
        }
      }
      if (key === 'credentials') {
        return {
          async resolve(ref: string) {
            const value = store.get(ref)
            return value === undefined ? undefined : { value }
          },
          async set(ref: string, value: string) {
            store.set(ref, value)
          },
        }
      }
      return undefined
    },
  }
  return { host, handlers }
}

function fakeRequest(
  method: string,
  body?: string,
): EventEmitter & { method: string; headers: Record<string, string> } {
  const req = new EventEmitter() as EventEmitter & { method: string; headers: Record<string, string> }
  req.method = method
  req.headers = { 'x-mpb-client': '1' }
  if (body !== undefined) {
    setImmediate(() => {
      req.emit('data', Buffer.from(body, 'utf8'))
      req.emit('end')
    })
  }
  return req
}

function fakeResponse(): {
  res: Record<string, unknown>
  status: () => number
  payload: () => unknown
} {
  let status = 0
  let payload: unknown = null
  const res = {
    headersSent: false,
    writeHead(code: number) {
      status = code
      this.headersSent = true
      return this
    },
    end(body: string) {
      payload = JSON.parse(body)
    },
  }
  return { res, status: () => status, payload: () => payload }
}

test('POST /push/config：解析 JSON、保存并返回脱敏配置', async () => {
  resetPushPreferencesState()
  const { host, handlers } = makeHost()
  registerPushRoutes(host, () => {})
  const handler = handlers.get('/dsh-junjun-transit-api/push/config')
  assert.ok(handler !== undefined)
  if (handler === undefined) throw new Error('route not registered')

  const { res, status, payload } = fakeResponse()
  await handler(
    fakeRequest(
      'POST',
      JSON.stringify({
        channel: 'smtp',
        smtp: {
          host: 'smtp.example.com',
          port: 587,
          encryption: 'starttls',
          username: 'bot',
          password: 'secret',
          fromEmail: 'bot@example.com',
          fromName: '骏骏通知中转',
          toEmail: 'user@example.com',
        },
      }),
    ),
    res,
  )

  assert.equal(status(), 200)
  const body = payload() as {
    ok: boolean
    meow: { configured: boolean }
    smtp: Record<string, unknown> & { status: { configured: boolean } }
  }
  assert.equal(body.ok, true)
  assert.equal(body.meow.configured, false)
  assert.equal(body.smtp['hasPassword'], true)
  assert.equal('password' in body.smtp, false)
  assert.equal(body.smtp.status.configured, true)

  const { res: getRes, status: getStatus, payload: getPayload } = fakeResponse()
  await handler(fakeRequest('GET'), getRes)
  assert.equal(getStatus(), 200)
  const getBody = getPayload() as { smtp: { status: { configured: boolean } } }
  assert.equal(getBody.smtp.status.configured, true)
})

test('POST /push/test（meow）：不抛错，返回 JSON', async () => {
  const { host, handlers } = makeHost()
  host.config = { nickname: 'chuck' }
  registerPushRoutes(host, () => {})
  const handler = handlers.get('/dsh-junjun-transit-api/push/test')
  assert.ok(handler !== undefined)
  if (handler === undefined) throw new Error('route not registered')

  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ status: 200, msg: 'Success' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch
  try {
    const { res, status, payload } = fakeResponse()
    await handler(fakeRequest('POST', JSON.stringify({ channel: 'meow' })), res)
    assert.equal(status(), 200)
    assert.equal((payload() as { channel: string }).channel, 'meow')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('POST /push/config：缺少 X-MPB-Client 返回 403', async () => {
  const { host, handlers } = makeHost()
  registerPushRoutes(host, () => {})
  const handler = handlers.get('/dsh-junjun-transit-api/push/config')
  assert.ok(handler !== undefined)
  if (handler === undefined) throw new Error('route not registered')
  const req = fakeRequest('GET')
  req.headers = {}
  const { res, status } = fakeResponse()
  await handler(req, res)
  assert.equal(status(), 403)
})
