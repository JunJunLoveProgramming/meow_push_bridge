/**
 * SMTP 通道：配置校验 + 本地假服务器协议测试。
 */

import assert from 'node:assert/strict'
import net from 'node:net'
import test from 'node:test'

import { buildSmtpMessage, sendSmtpMail, validateSmtpConfig } from '../dist/smtp.ts'

const BASE = {
  host: '127.0.0.1',
  port: 587,
  encryption: 'none' as const,
  username: '',
  password: '',
  fromEmail: 'bot@example.com',
  fromName: '骏骏通知中转',
  toEmail: 'user@example.com',
}

test('validateSmtpConfig：必填与格式校验', () => {
  assert.equal(validateSmtpConfig({ ...BASE, host: '' }).ok, false)
  assert.equal(validateSmtpConfig({ ...BASE, port: 0 }).ok, false)
  assert.equal(validateSmtpConfig({ ...BASE, fromEmail: 'not-mail' }).ok, false)
  assert.equal(validateSmtpConfig({ ...BASE, toEmail: 'not-mail' }).ok, false)
  assert.equal(validateSmtpConfig({ ...BASE, username: 'u' }).ok, false, '有用户名必须有密码')
  assert.equal(validateSmtpConfig(BASE).ok, true)
})

test('buildSmtpMessage：UTF-8 主题编码、纯文本 base64 正文', () => {
  const message = buildSmtpMessage(BASE, { subject: '任务完成', text: '第一行\n第二行' })
  assert.ok(message.includes('Subject: =?UTF-8?B?'))
  assert.ok(message.includes('Content-Type: text/plain; charset=UTF-8'))
  const body = message.split('\r\n\r\n')[1] ?? ''
  const decoded = Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8')
  assert.ok(decoded.includes('第一行'))
  assert.ok(decoded.includes('第二行'))
  assert.ok(!message.includes('<html'))
})

test('sendSmtpMail：与假 SMTP 服务器完成 EHLO/AUTH/MAIL/RCPT/DATA', async () => {
  let received = ''
  const server = net.createServer((socket) => {
    socket.setEncoding('utf8')
    socket.write('220 test ESMTP\r\n')
    let buffer = ''
    let inData = false
    let dataBuffer = ''

    socket.on('data', (chunk: string) => {
      buffer += chunk
      for (;;) {
        if (inData) {
          const end = buffer.indexOf('\r\n.\r\n')
          if (end < 0) return
          dataBuffer += buffer.slice(0, end)
          buffer = buffer.slice(end + 5)
          received = dataBuffer
          inData = false
          socket.write('250 queued\r\n')
          continue
        }
        const index = buffer.indexOf('\r\n')
        if (index < 0) return
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)
        if (line.startsWith('EHLO')) {
          socket.write('250-test\r\n250-AUTH PLAIN LOGIN\r\n250 OK\r\n')
        } else if (line.startsWith('AUTH PLAIN')) {
          socket.write('235 authenticated\r\n')
        } else if (line.startsWith('MAIL FROM')) {
          socket.write('250 ok\r\n')
        } else if (line.startsWith('RCPT TO')) {
          socket.write('250 ok\r\n')
        } else if (line === 'DATA') {
          socket.write('354 go ahead\r\n')
          inData = true
          dataBuffer = ''
        } else if (line === 'QUIT') {
          socket.write('221 bye\r\n')
          socket.end()
        }
      }
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address !== null && typeof address === 'object')
  const port = (address as net.AddressInfo).port

  try {
    const result = await sendSmtpMail(
      { ...BASE, port, username: 'bot', password: 'secret' },
      { subject: '测试主题', text: '这是正文' },
      5_000,
    )
    assert.equal(result.ok, true, result.error)
    assert.ok(received.includes('Subject: =?UTF-8?B?'), '主题应按 RFC 2047 编码')
    const body = received.split('\r\n\r\n')[1] ?? ''
    const decoded = Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8')
    assert.ok(decoded.includes('这是正文'))
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
