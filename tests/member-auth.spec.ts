/**
 * 0.3.0 会员授权：纯函数测试（不联网）。
 */

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import { buildAuthorizeUrl, createPkce, SITE_BASE } from '../dist/member-auth.ts'

function base64url(input: Buffer): string {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '')
}

test('createPkce：verifier/challenge 长度合法，challenge = S256(verifier)', () => {
  const { verifier, challenge } = createPkce()
  assert.ok(verifier.length >= 43 && verifier.length <= 128)
  assert.match(verifier, /^[A-Za-z0-9_-]+$/)
  assert.match(challenge, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(challenge, base64url(createHash('sha256').update(verifier).digest()))
})

test('buildAuthorizeUrl：包含固定站点、回调、state 与 PKCE 参数', () => {
  const url = new URL(buildAuthorizeUrl('http://127.0.0.1:7234', 'state-1', 'c'.repeat(43)))
  assert.equal(`${url.origin}${url.pathname}`, `${SITE_BASE}/plugin/authorize.php`)
  assert.equal(url.searchParams.get('client'), 'dsh_junjun_transit')
  assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:7234/dsh-junjun-transit-api/auth/callback')
  assert.equal(url.searchParams.get('state'), 'state-1')
  assert.equal(url.searchParams.get('code_challenge'), 'c'.repeat(43))
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
})

test('createPkce：两次生成不重复', () => {
  assert.notEqual(createPkce().verifier, createPkce().verifier)
})
