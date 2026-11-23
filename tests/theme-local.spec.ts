/**
 * 主题本机可用：即使没有会员会话，也能保存并生效。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_CATEGORY,
  DEFAULT_ICON_URL,
  getEffectiveTheme,
  resetMemberAuthState,
  saveTheme,
  type MemberAuthHost,
} from '../dist/member-auth.ts'

function host(): MemberAuthHost {
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
        async unset(ref: string) {
          store.delete(ref)
        },
      }
    },
  }
}

test('未登录会员时仍可保存并读取本机主题', async () => {
  resetMemberAuthState()
  const ctx = host()
  const saved = await saveTheme(ctx, { title: '本地标题', imgUrl: '', category: '' })
  assert.equal(saved.ok, true, saved.error)

  const theme = await getEffectiveTheme(ctx)
  assert.equal(theme.title, '本地标题')
  assert.equal(theme.imgUrl, DEFAULT_ICON_URL)
  assert.equal(theme.category, DEFAULT_CATEGORY)
})
