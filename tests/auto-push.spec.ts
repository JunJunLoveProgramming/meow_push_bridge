/**
 * tests/auto-push.spec.ts —— 宿主侧「每轮必推」自动推送契约测试
 *
 * 背景：只靠 systemPrompt 让模型自觉调用工具是**概率性合规**，实测会「部分环境不推」。
 * 因此改为宿主侧监听 `agent/turn-stopping` 直接推送。本文件锁定该行为：
 *   - 三种模式：every-turn（每轮必推）/ substantial（用过工具才推）/ off
 *   - 去重：同一 (会话, 轮次) 只推一条
 *   - 统计：从 `session/event` 的 tool/call 累计工具名与次数
 *   - 降级：拿不到统计也必须推（只是文案变简洁），注册失败不抛错
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_PUSH_MODE,
  PUSH_MODES,
  normalizePushMode,
  registerAutoPush,
  renderTurnStats,
  type PushMode,
} from '../dist/auto-push.ts'

/** 一个可手动触发事件的假 ctx */
function createAutoPushContext(): {
  ctx: Record<string, unknown>
  fire: (event: string, ...args: unknown[]) => void
  listeners: Map<string, ((...args: unknown[]) => void)[]>
} {
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>()
  const ctx = {
    logger: { warn: () => {}, info: () => {}, error: () => {} },
    on(event: string, listener: (...args: unknown[]) => void) {
      const list = listeners.get(event) ?? []
      list.push(listener)
      listeners.set(event, list)
      return () => {}
    },
  }
  const fire = (event: string, ...args: unknown[]): void => {
    for (const listener of listeners.get(event) ?? []) listener(...args)
  }
  return { ctx, fire, listeners }
}

/** 等待微任务队列，让自动推送里的 async 流程跑完 */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/** 收集推送调用 */
function createSender(): {
  send: (title: string, message: string) => Promise<{ ok: true; status: number; url: string; body: string }>
  pushes: { title: string; message: string }[]
} {
  const pushes: { title: string; message: string }[] = []
  return {
    pushes,
    send: async (title, message) => {
      pushes.push({ title, message })
      return { ok: true as const, status: 200, url: 'http://example.com', body: '{"status":200}' }
    },
  }
}

const AGENT = { id: 'session-1' }

// ─────────────────── 模式归一化 ───────────────────

test('pushMode 归一化：合法值保留，非法值回退默认', () => {
  assert.deepEqual([...PUSH_MODES], ['every-turn', 'substantial', 'off'])
  assert.equal(DEFAULT_PUSH_MODE, 'every-turn')
  for (const mode of PUSH_MODES) assert.equal(normalizePushMode(mode), mode)
  assert.equal(normalizePushMode('bogus'), DEFAULT_PUSH_MODE)
  assert.equal(normalizePushMode(undefined), DEFAULT_PUSH_MODE)
  assert.equal(normalizePushMode(42), DEFAULT_PUSH_MODE)
})

// ─────────────────── 统计文案 ───────────────────

test('renderTurnStats：纯问答与用过工具分别产出可读文案', () => {
  const quiet = renderTurnStats(
    { turn: 1, startedAt: 0, toolCalls: 0, tools: new Map() },
    3_000,
  )
  assert.match(quiet, /纯问答/)
  assert.match(quiet, /3s/)

  const busy = renderTurnStats(
    {
      turn: 2,
      startedAt: 0,
      toolCalls: 3,
      tools: new Map([
        ['pwsh', 2],
        ['read', 1],
      ]),
    },
    5_000,
  )
  assert.match(busy, /调用 3 次工具/)
  assert.match(busy, /pwsh/)
  assert.match(busy, /read/)
  assert.match(busy, /5s/)
})

test('renderTurnStats：工具种类过多时截断并给出总数', () => {
  const tools = new Map([['a', 1], ['b', 1], ['c', 1], ['d', 1], ['e', 1], ['f', 1]])
  const text = renderTurnStats({ turn: 1, startedAt: 0, toolCalls: 6, tools }, 1_000)
  assert.match(text, /等 6 种/)
})

// ─────────────────── 每轮必推 ───────────────────

test('every-turn：轮次结束即推送，且统计本轮工具调用', async () => {
  const { ctx, fire } = createAutoPushContext()
  const { send, pushes } = createSender()
  const result = registerAutoPush(ctx, { mode: 'every-turn', send })
  assert.equal(result.registered, true)

  // 会话事件：开轮 + 三次工具调用
  fire('session/event', { id: 'session-1' }, { type: 'turn/start', data: { turn: 7 } })
  fire('session/event', { id: 'session-1' }, { type: 'tool/call', data: { turn: 7, name: 'pwsh' } })
  fire('session/event', { id: 'session-1' }, { type: 'tool/call', data: { turn: 7, name: 'read' } })
  fire('session/event', { id: 'session-1' }, { type: 'tool/call', data: { turn: 7, name: 'pwsh' } })

  fire('agent/turn-stopping', { agent: AGENT, turn: 7 })
  await flush()

  assert.equal(pushes.length, 1, '应推送一条')
  assert.equal(pushes[0]?.title, 'MeoW Push Bridge', '自动推送使用统一的默认标题')
  assert.match(pushes[0]?.message ?? '', /调用 3 次工具/)
  assert.match(pushes[0]?.message ?? '', /pwsh/)
})

test('every-turn：纯问答（无工具）也要推', async () => {
  const { ctx, fire } = createAutoPushContext()
  const { send, pushes } = createSender()
  registerAutoPush(ctx, { mode: 'every-turn', send })

  fire('session/event', { id: 's' }, { type: 'turn/start', data: { turn: 1 } })
  fire('agent/turn-stopping', { agent: { id: 's' }, turn: 1 })
  await flush()

  assert.equal(pushes.length, 1)
  assert.match(pushes[0]?.message ?? '', /纯问答/)
})

test('same turn 只推一次（去重）', async () => {
  const { ctx, fire } = createAutoPushContext()
  const { send, pushes } = createSender()
  registerAutoPush(ctx, { mode: 'every-turn', send })

  fire('agent/turn-stopping', { agent: AGENT, turn: 5 })
  await flush()
  fire('agent/turn-stopping', { agent: AGENT, turn: 5 })
  await flush()

  assert.equal(pushes.length, 1, '同一轮重复触发只应推一条')
})

test('不同轮次各自推送', async () => {
  const { ctx, fire } = createAutoPushContext()
  const { send, pushes } = createSender()
  registerAutoPush(ctx, { mode: 'every-turn', send })

  fire('agent/turn-stopping', { agent: AGENT, turn: 1 })
  await flush()
  fire('agent/turn-stopping', { agent: AGENT, turn: 2 })
  await flush()

  assert.equal(pushes.length, 2)
})

// ─────────────────── substantial 模式 ───────────────────

test('substantial：用过工具才推，纯问答不推', async () => {
  const { ctx, fire } = createAutoPushContext()
  const { send, pushes } = createSender()
  registerAutoPush(ctx, { mode: 'substantial', send })

  // 第 1 轮：无工具 → 不推
  fire('session/event', { id: 's' }, { type: 'turn/start', data: { turn: 1 } })
  fire('agent/turn-stopping', { agent: { id: 's' }, turn: 1 })
  await flush()
  assert.equal(pushes.length, 0)

  // 第 2 轮：有工具 → 推
  fire('session/event', { id: 's' }, { type: 'turn/start', data: { turn: 2 } })
  fire('session/event', { id: 's' }, { type: 'tool/call', data: { turn: 2, name: 'pwsh' } })
  fire('agent/turn-stopping', { agent: { id: 's' }, turn: 2 })
  await flush()
  assert.equal(pushes.length, 1)
})

// ─────────────────── off 模式与降级 ───────────────────

test('off：不注册任何监听', () => {
  const { ctx, listeners } = createAutoPushContext()
  const { send } = createSender()
  const result = registerAutoPush(ctx, { mode: 'off' as PushMode, send })
  assert.equal(result.registered, false)
  assert.equal(result.reason, 'pushMode=off')
  assert.equal(listeners.size, 0, 'off 模式不应注册任何监听')
})

test('ctx.on 不可用时不抛错、安全降级', () => {
  const { send } = createSender()
  const result = registerAutoPush({ logger: {} }, { mode: 'every-turn', send })
  assert.equal(result.registered, false)
  assert.match(result.reason ?? '', /ctx\.on/)
})

test('拿不到会话统计时仍然推送（退化为简洁文案）', async () => {
  const { ctx, fire } = createAutoPushContext()
  const { send, pushes } = createSender()
  registerAutoPush(ctx, { mode: 'every-turn', send })

  // 完全不给 session/event，直接轮次结束
  fire('agent/turn-stopping', { agent: AGENT, turn: 9 })
  await flush()

  assert.equal(pushes.length, 1, '统计缺失不能让推送消失')
  assert.match(pushes[0]?.message ?? '', /本轮已完成/)
  assert.match(pushes[0]?.message ?? '', /纯问答/, '没有工具记录时按纯问答渲染')
})

test('事件负载畸形时不抛错', async () => {
  const { ctx, fire } = createAutoPushContext()
  const { send } = createSender()
  registerAutoPush(ctx, { mode: 'every-turn', send })

  assert.doesNotThrow(() => {
    fire('session/event', null, null)
    fire('session/event', { id: 's' }, { type: 'tool/call' })
    fire('agent/turn-stopping', undefined)
    fire('agent/turn-stopping', {})
    fire('agent/turn-stopping', { agent: {}, turn: 'x' })
  })
  await flush()
})

test('注册了 turn-stopping 与 session/event 两个监听', () => {
  const { ctx, listeners } = createAutoPushContext()
  const { send } = createSender()
  registerAutoPush(ctx, { mode: 'every-turn', send })
  assert.ok(listeners.has('agent/turn-stopping'))
  assert.ok(listeners.has('session/event'))
})
