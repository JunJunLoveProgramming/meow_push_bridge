/**
 * 推送通道设置：保存、脱敏、密码保留/清除。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  loadPushPreferences,
  publicPreferences,
  resetPushPreferencesState,
  savePushPreferences,
  type PushHost,
} from '../dist/push-settings.ts'

function fakeHost(): PushHost {
  const store = new Map<string, string>()
  return {
    get(key: string) {
      if (key !== 'credentials') return undefined
      return {
        async resolve(ref: string) {
          const value = store.get(ref)
          return value === undefined ? undefined : { value }
        },
        async set(ref: string, value: string) {
          store.set(ref, value)
        },
      }
    },
  }
}

const SMTP = {
  host: 'smtp.example.com',
  port: 587,
  encryption: 'starttls',
  username: 'bot',
  password: 'secret',
  fromEmail: 'bot@example.com',
  fromName: '喵桥',
  toEmail: 'user@example.com',
}

test('savePushPreferences：保存 SMTP 后从 credentials 重新读取', async () => {
  resetPushPreferencesState()
  const ctx = fakeHost()
  const saved = await savePushPreferences(ctx, { smtp: SMTP })
  assert.equal(saved.ok, true, saved.error)

  resetPushPreferencesState()
  const loaded = await loadPushPreferences(ctx)
  assert.equal(loaded.smtp.password, 'secret')

  const pub = publicPreferences(loaded, { configured: true, detail: '' }) as { smtp: Record<string, unknown> }
  assert.equal('password' in pub.smtp, false, '公开配置不得包含密码')
  assert.equal(pub.smtp['hasPassword'], true)
})

test('savePushPreferences：空密码保持原密码', async () => {
  resetPushPreferencesState()
  const ctx = fakeHost()
  await savePushPreferences(ctx, { smtp: SMTP })

  await savePushPreferences(ctx, {
    smtp: { ...SMTP, password: '' },
  })
  resetPushPreferencesState()
  assert.equal((await loadPushPreferences(ctx)).smtp.password, 'secret')
})

test('savePushPreferences：clearPassword 清空密码', async () => {
  resetPushPreferencesState()
  const ctx = fakeHost()
  await savePushPreferences(ctx, { smtp: SMTP })
  await savePushPreferences(ctx, {
    smtp: { ...SMTP, username: '', password: '', clearPassword: true },
  })
  resetPushPreferencesState()
  assert.equal((await loadPushPreferences(ctx)).smtp.password, '')
})
