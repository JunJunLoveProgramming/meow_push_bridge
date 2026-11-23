/**
 * MeoW API category（自定义分类）测试。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { buildMeowBody, buildMeowUrl, normalizePushCategory } from '../dist/meow-api.ts'
import { DEFAULT_ICON_URL } from '../dist/member-auth.ts'

test('默认通知图标固定为会员站点上传的 PNG', () => {
  assert.equal(
    DEFAULT_ICON_URL,
    'https://www.junjunloveprogramming.cn/upload/meow_push_bridge_logo.png',
  )
})

test('normalizePushCategory：去空白、空值不发送、最多 10 字', () => {
  assert.equal(normalizePushCategory('  dsh插件  '), 'dsh插件')
  assert.equal(normalizePushCategory(''), undefined)
  assert.equal(normalizePushCategory('   '), undefined)
  assert.equal(normalizePushCategory(undefined), undefined)
  assert.equal(normalizePushCategory('1234567890'), '1234567890')
  assert.equal(normalizePushCategory('12345678901'), undefined)
  assert.equal(normalizePushCategory('a\nb'), undefined)
})

test('buildMeowBody：POST 时携带 category', () => {
  const body = buildMeowBody({ nickname: 'n', message: 'm', category: 'dsh插件' })
  assert.equal(body['category'], 'dsh插件')
  assert.equal(buildMeowBody({ nickname: 'n', message: 'm' })['category'], undefined)
})

test('buildMeowUrl：GET 时 category 进入查询串并编码', () => {
  const url = buildMeowUrl({ nickname: 'n', message: 'm', category: '服务器告警' }, 'https://api.example.com')
  assert.ok(url.includes('category=%E6%9C%8D%E5%8A%A1%E5%99%A8%E5%91%8A%E8%AD%A6'))
})

test('超长 category 不会发送（避免 MeoW 返回 400）', () => {
  const body = buildMeowBody({ nickname: 'n', message: 'm', category: '12345678901' })
  assert.equal('category' in body, false)
})
