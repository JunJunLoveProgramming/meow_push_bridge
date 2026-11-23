/**
 * 推送总结器：运行时上下文清理、Markdown/HTML 清理、长度压缩。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { condenseAnswer, condenseQuestion, condenseText, stripRuntimeContext } from '../dist/condense.ts'
import { formatSummary, summarizeTurn } from '../dist/summary.ts'

test('stripRuntimeContext：截掉 DSH 追加的英文运行时上下文', () => {
  const input = [
    '帮我把会员中心适配手机端',
    '',
    'Time sampled while preparing turn 112, step 39: 2026-11-16T21:22:39+08:00[Asia/Shanghai]',
    'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.',
    'Current working directory: "D:\\dsh_junjun_transit"',
    'Approval prompts are enabled in this session.',
  ].join('\n')

  assert.equal(stripRuntimeContext(input), '帮我把会员中心适配手机端\n\n')
  assert.equal(condenseQuestion(input), '帮我把会员中心适配手机端')
})

test('condenseQuestion：只有运行时上下文时不产出提问', () => {
  assert.equal(
    condenseQuestion('Time sampled while preparing turn 112, step 39: 2026-11-16T21:22:39+08:00'),
    '',
  )
})

test('condenseAnswer：去掉代码块/Markdown/HTML，只留结论句', () => {
  const answer = [
    '好的，已完成手机端适配。',
    '主要调整了顶栏换行、表格横向滚动和输入框字号。',
    '```css',
    '.topbar { flex-wrap: wrap; }',
    '```',
    '<p>需要注意 iOS 输入框聚焦不再放大。</p>',
    '详细改动见 <a href="https://example.com">文档</a>。',
  ].join('\n')

  const text = condenseAnswer(answer, 120)
  assert.ok(text.includes('已完成手机端适配'))
  assert.ok(text.includes('顶栏换行'))
  assert.ok(!text.includes('<'))
  assert.ok(!text.includes('```'))
  assert.ok(!text.includes('https://'))
  assert.ok(text.length <= 120, `实际长度 ${text.length}`)
})

test('condenseText：超长文本压缩到上限内', () => {
  const raw = '第一句结论。第二句补充说明。第三句继续展开。第四句是无关内容。'.repeat(3)
  const text = condenseText(raw, 40, 2)
  assert.ok(text.length <= 40)
  assert.ok(text.endsWith('…') || text.length < 40)
})

test('formatSummary：推送正文为中文纯文本，不含运行时英文元数据', () => {
  const session = {
    snapshotEvents: () => [
      {
        type: 'user/message',
        data: {
          turn: 1,
          content: '把推送内容总结一下\n\nTime sampled while preparing turn 1: 2026-11-16T21:00:00+08:00',
        },
      },
      {
        type: 'assistant/message',
        data: {
          turn: 1,
          message: {
            content: [
              {
                type: 'text',
                text: '已完成总结器：会去掉英文运行时上下文，并压缩成中文纯文本。',
              },
            ],
          },
        },
      },
    ],
  }

  const text = formatSummary(summarizeTurn(session, 1), 3)
  assert.ok(text.startsWith('【你问】把推送内容总结一下'))
  assert.ok(text.includes('【摘要】'))
  assert.ok(!text.includes('Time sampled'))
  assert.ok(!text.includes('Current runtime context'))
  assert.ok(!text.includes('<'))
})
