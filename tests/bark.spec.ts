/**
 * Bark 通道：配置校验、请求体、成功/错误码。
 */

import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'

import { sendBark, validateBarkConfig } from '../dist/bark.ts'

const BASE = {
  token: 'tok',
  sender: '',
  title: '',
  icon: '',
}

test('validateBarkConfig：token 必填且不能含空格', () => {
  assert.equal(validateBarkConfig({ token: '' }).ok, false)
  assert.equal(validateBarkConfig({ token: 'a b' }).ok, false)
  assert.equal(validateBarkConfig({ token: 'abc' }).ok, true)
})

test('sendBark：发送 JSON 并在 80000000 时成功', async () => {
  let body: Record<string, unknown> | null = null
  const server = http.createServer((req, res) => {
    let raw = ''
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => {
      raw += chunk
    })
    req.on('end', () => {
      body = JSON.parse(raw) as Record<string, unknown>
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ code: '80000000', msg: 'Success' }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address !== null && typeof address === 'object')
  const port = (address as { port: number }).port

  try {
    const result = await sendBark(
      { ...BASE, token: 'tok_123', sender: '喵桥' },
      {
        title: '测试标题',
        text: '测试内容',
        url: 'https://example.com',
        icon: 'https://example.com/icon.png',
      },
      { endpoint: `http://127.0.0.1:${port}/send`, timeoutMs: 5_000 },
    )
    assert.equal(result.ok, true, result.error)
    assert.equal(body?.['token'], 'tok_123')
    assert.equal(body?.['title'], '测试标题')
    assert.equal(body?.['msg'], '测试内容')
    assert.equal(body?.['issecure'], 0)
    assert.equal(body?.['msgType'], 1)
    assert.equal(body?.['sender'], '喵桥')
    assert.equal(body?.['icon'], 'https://example.com/icon.png')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('sendBark：业务错误码转换为中文提示', async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ code: '300', msg: 'frequent' }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = (address as { port: number }).port

  try {
    const result = await sendBark(
      { ...BASE },
      { title: 't', text: 'm' },
      { endpoint: `http://127.0.0.1:${port}/send`, timeoutMs: 5_000 },
    )
    assert.equal(result.ok, false)
    assert.ok(result.error?.includes('过于频繁'))
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
