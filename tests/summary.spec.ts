/**
 * tests/summary.spec.ts —— 对话总结提取测试
 *
 * 契约来源：DSH 运行时 Inspect 暴露的 `SessionEventMap` 与 `ContentBlockMap`：
 *   'user/message'      → data.content（或 data.message.content）是块数组
 *   'assistant/message' → data.message.content 是块数组，text 块带 text
 *   'tool/call'         → data.name
 *   SessionEvent        → { type, seq, time, data }
 *
 * 这些用例锁定「宿主层不需要 LLM 也能说出对话内容」这条能力。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ANSWER_LIMIT,
  QUESTION_LIMIT,
  collapseWhitespace,
  extractTextFromContent,
  formatSummary,
  renderTail,
  summarizeTurn,
  truncateText,
  type SessionLike,
} from '../dist/summary.ts'

/** 造一个只提供 snapshotEvents 的假会话 */
function fakeSession(events: unknown[]): SessionLike {
  return { snapshotEvents: () => events }
}

/** 造一条 assistant/message 事件 */
function assistantEvent(turn: number, texts: string[], step = 1): unknown {
  return {
    type: 'assistant/message',
    seq: 1,
    time: 0,
    data: {
      turn,
      step,
      message: {
        role: 'assistant',
        content: [
          ...texts.map((text) => ({ type: 'text', text })),
          // 混入推理块，验证不会被推到手机上
          { type: 'reasoning', text: '这是一段内部推理，不该出现在通知里' },
        ],
      },
    },
  }
}

function userEvent(turn: number, text: string): unknown {
  return { type: 'user/message', seq: 1, time: 0, data: { turn, content: [{ type: 'text', text }] } }
}

function toolCallEvent(turn: number, name: string): unknown {
  return { type: 'tool/call', seq: 1, time: 0, data: { turn, step: 1, callId: 'c1', name, arguments: '{}' } }
}

// ─────────────────── 文本提取 ───────────────────

test('extractTextFromContent：只取 text 块，忽略 reasoning / tool-call', () => {
  const content = [
    { type: 'reasoning', text: '内部思考' },
    { type: 'text', text: '第一段' },
    { type: 'tool-call', id: 'c1', name: 'pwsh', arguments: '{}' },
    { type: 'text', text: '第二段' },
  ]
  assert.equal(extractTextFromContent(content), '第一段 第二段')
})

test('extractTextFromContent：兼容 content 直接是字符串（退化投影）', () => {
  assert.equal(extractTextFromContent('  纯字符串内容  '), '纯字符串内容')
  assert.equal(extractTextFromContent(undefined), '')
  assert.equal(extractTextFromContent(42), '')
  assert.equal(extractTextFromContent([]), '')
})

test('collapseWhitespace：换行与多空格折叠为单空格', () => {
  assert.equal(collapseWhitespace('a\n\nb   c\t d '), 'a b c d')
})

test('truncateText：超长才截断并加省略号', () => {
  assert.deepEqual(truncateText('abc', 5), { text: 'abc', truncated: false })
  assert.deepEqual(truncateText('abcdef', 3), { text: 'abc…', truncated: true })
})

// ─────────────────── 单轮总结 ───────────────────

test('summarizeTurn：取出提问、最终回复与工具统计', () => {
  const session = fakeSession([
    userEvent(7, '帮我修一下登录按钮'),
    assistantEvent(7, ['我先看看代码'], 1),
    toolCallEvent(7, 'read'),
    toolCallEvent(7, 'pwsh'),
    assistantEvent(7, ['已经修好了，是事件绑定写错了'], 2),
  ])
  const summary = summarizeTurn(session, 7)
  assert.equal(summary.question, '帮我修一下登录按钮')
  assert.equal(summary.answer, '已经修好了，是事件绑定写错了', '应取最后一条非空回复')
  assert.equal(summary.toolCalls, 2)
  assert.deepEqual([...summary.tools.keys()].sort(), ['pwsh', 'read'])
  assert.equal(summary.answerTruncated, false)
})

test('summarizeTurn：只统计目标轮次，其他轮次被过滤掉', () => {
  const session = fakeSession([
    userEvent(1, '第一轮的问题'),
    assistantEvent(1, ['第一轮的回答']),
    toolCallEvent(1, 'read'),
    userEvent(2, '第二轮的问题'),
    assistantEvent(2, ['第二轮的回答']),
    toolCallEvent(2, 'grep'),
  ])
  const summary = summarizeTurn(session, 2)
  assert.equal(summary.question, '第二轮的问题')
  assert.equal(summary.answer, '第二轮的回答')
  assert.equal(summary.toolCalls, 1)
  assert.deepEqual([...summary.tools.keys()], ['grep'])
})

test('summarizeTurn：不传轮次时取整份快照的最后状态', () => {
  const session = fakeSession([
    userEvent(1, '问题一'),
    assistantEvent(1, ['回答一']),
    userEvent(2, '问题二'),
    assistantEvent(2, ['回答二']),
  ])
  const summary = summarizeTurn(session)
  assert.equal(summary.question, '问题二')
  assert.equal(summary.answer, '回答二')
})

test('summarizeTurn：中间步骤只有工具调用时，回复取最后一条有文本的', () => {
  const session = fakeSession([
    userEvent(3, '跑个构建'),
    // 这些 assistant 消息没有 text 块（只有工具调用），不应覆盖 answer
    { type: 'assistant/message', seq: 1, time: 0, data: { turn: 3, step: 1, message: { role: 'assistant', content: [{ type: 'tool-call', id: 'c', name: 'pwsh', arguments: '{}' }] } } },
    { type: 'assistant/message', seq: 2, time: 0, data: { turn: 3, step: 2, message: { role: 'assistant', content: [{ type: 'text', text: '构建通过' }] } } },
  ])
  const summary = summarizeTurn(session, 3)
  assert.equal(summary.answer, '构建通过')
})

test('summarizeTurn：超长提问与回复被截断并标记', () => {
  const session = fakeSession([
    userEvent(1, 'Q'.repeat(QUESTION_LIMIT + 50)),
    assistantEvent(1, ['A'.repeat(ANSWER_LIMIT + 50)]),
  ])
  const summary = summarizeTurn(session, 1)
  assert.equal(summary.questionTruncated, true)
  assert.equal(summary.answerTruncated, true)
  assert.equal(summary.question.length, QUESTION_LIMIT + 1, '截断后含省略号')
  assert.ok(summary.question.endsWith('…'))
  assert.ok(summary.answer.endsWith('…'))
})

test('summarizeTurn：快照抛错或事件畸形时安全返回空总结', () => {
  const broken: SessionLike = {
    snapshotEvents: () => {
      throw new Error('boom')
    },
  }
  const summary = summarizeTurn(broken, 1)
  assert.equal(summary.answer, '')
  assert.equal(summary.toolCalls, 0)

  const weird = fakeSession([null, 42, 'string', { type: 'assistant/message' }, { type: 'tool/call' }])
  const second = summarizeTurn(weird, 1)
  assert.equal(second.answer, '')
  assert.equal(second.toolCalls, 1, 'tool/call 缺 name 时计为 unknown')
  assert.deepEqual([...second.tools.keys()], ['unknown'])
})

// ─────────────────── 文案渲染 ───────────────────

test('renderTail：有工具与无工具两种形态', () => {
  assert.equal(renderTail(0, new Map(), 2), '（未使用工具，耗时 2s）')
  assert.equal(renderTail(2, new Map([['pwsh', 2]]), 12), '（调用 2 次工具：pwsh，耗时 12s）')
  assert.match(renderTail(9, new Map([['a', 1], ['b', 1], ['c', 1], ['d', 1]]), 5), /等 4 种/)
})

test('formatSummary：输出「你问 / 回复 / 统计」三段，统计在最后', () => {
  const session = fakeSession([
    userEvent(1, '登录按钮点不动'),
    toolCallEvent(1, 'read'),
    assistantEvent(1, ['是事件绑定漏了，已修好']),
  ])
  const text = formatSummary(summarizeTurn(session, 1), 9)
  const lines = text.split('\n')
  assert.equal(lines[0], '【你问】登录按钮点不动')
  assert.equal(lines[1], '【回复】是事件绑定漏了，已修好')
  assert.match(lines[2] ?? '', /^（调用 1 次工具：read，耗时 9s）$/)
  assert.ok(text.includes('不该出现') === false, '推理块内容不得进入推送')
})

test('formatSummary：缺少提问时只渲染回复', () => {
  const session = fakeSession([assistantEvent(1, ['只有回复，没有提问'])])
  const text = formatSummary(summarizeTurn(session, 1), 3)
  assert.ok(!text.includes('【你问】'))
  assert.ok(text.includes('【回复】只有回复，没有提问'))
})

test('formatSummary：完全拿不到对话内容时降级为统计文案', () => {
  const empty = summarizeTurn(fakeSession([]), 1)
  assert.match(formatSummary(empty, 4), /本轮已完成（无对话内容，耗时 4s）/)

  const withTools = summarizeTurn(fakeSession([toolCallEvent(1, 'pwsh')]), 1)
  assert.match(formatSummary(withTools, 4), /本轮已完成：调用 1 次工具（pwsh），耗时 4s/)
})
