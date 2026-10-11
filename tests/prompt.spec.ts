/**
 * tests/prompt.spec.ts —— 「任务完成自动推送」提示词区段契约测试
 *
 * 依据 @deepseek-ai/dsh-system-prompt 的真实契约：
 *   systemPrompt.section({ name, order, text, interpolate? }) → 返回 disposer
 *   - order 越小越靠前；官方工具说明区间为 1000–3100
 *     （TOOL_GOAL: 2400、TOOL_WORKFLOW: 2600 之间是我们取的 2500）
 *   - interpolate: false 时文本原样保留，不做 {{变量}} 插值
 *
 * 重点：这一段决定「任务完成后是否自动推送」，所以既要验注册，也要验文案覆盖了
 * 「做什么时推」「什么时候不推」「节流」三件事 —— 否则模型可能刷屏或干脆不推。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PROMPT_SECTION_NAME,
  PROMPT_SECTION_ORDER,
  PUSH_INSTRUCTION_TEXT,
  registerPromptSection,
} from '../dist/prompt.ts'

interface RegisteredSection {
  name?: unknown
  order?: unknown
  text?: unknown
  interpolate?: unknown
}

/** 造一个假 ctx，记录被注册的区段 */
function createPromptContext(): {
  ctx: { systemPrompt: { section: (section: RegisteredSection) => () => void } }
  sections: RegisteredSection[]
} {
  const sections: RegisteredSection[] = []
  return {
    ctx: {
      systemPrompt: {
        section: (section: RegisteredSection) => {
          sections.push(section)
          return () => {}
        },
      },
    },
    sections,
  }
}

test('注册一个提示词区段，字段与顺序符合宿主契约', () => {
  const { ctx, sections } = createPromptContext()
  const logs: string[] = []

  const result = registerPromptSection(ctx, (_level, message) => logs.push(message))

  assert.equal(result.registered, true)
  assert.equal(sections.length, 1)
  const section = sections[0]
  assert.ok(section !== undefined)
  assert.equal(section.name, PROMPT_SECTION_NAME)
  assert.equal(section.order, PROMPT_SECTION_ORDER)
  assert.equal(section.interpolate, false, '必须关掉插值：正文含 markdown，不应被当作变量解析')
  assert.equal(typeof section.text, 'string')
  assert.ok((section.text as string).length > 0)
  assert.ok(logs.some((line) => line.includes('提示词区段')), '应记录注册成功日志')
})

test('区段名唯一且排序落在工具说明区间内', () => {
  assert.equal(PROMPT_SECTION_NAME, 'tool:meow-push-bridge')
  // 官方区间：TOOL_GOAL 2400 … TOOL_WORKFLOW 2600。落在其间可与其他工具说明并列。
  assert.ok(PROMPT_SECTION_ORDER > 2400, '应排在 TOOL_GOAL 之后')
  assert.ok(PROMPT_SECTION_ORDER < 2600, '应排在 TOOL_WORKFLOW 之前')
})

test('文案覆盖三件关键事：何时推 / 何时不推 / 节流', () => {
  // 何时推：完成实质任务
  assert.match(PUSH_INSTRUCTION_TEXT, /完成实质任务后/)
  assert.match(PUSH_INSTRUCTION_TEXT, /meow_push_bridge/)
  // 何时不推：纯问答、寒暄、澄清
  assert.match(PUSH_INSTRUCTION_TEXT, /不要推送/)
  assert.match(PUSH_INSTRUCTION_TEXT, /纯问答|解释/)
  // 字段用法
  assert.match(PUSH_INSTRUCTION_TEXT, /title/)
  assert.match(PUSH_INSTRUCTION_TEXT, /message/)
  assert.match(PUSH_INSTRUCTION_TEXT, /url/)
  // 节流提醒（与插件实际的 throttleMs 默认值一致）
  assert.match(PUSH_INSTRUCTION_TEXT, /5 秒节流/)
})

test('文案里不出现会被误当作插值的 {{...}} 变量引用', () => {
  assert.ok(!/\{\{/.test(PUSH_INSTRUCTION_TEXT), '出现 {{ 会被宿主按变量解析（我们关掉了插值，但保持干净更好）')
})

test('宿主未提供 systemPrompt 服务时不抛错、只记 info', () => {
  const logs: { level: string; message: string }[] = []
  const result = registerPromptSection({}, (level, message) => logs.push({ level, message }))
  assert.equal(result.registered, false)
  assert.ok(result.reason !== undefined)
  assert.ok(logs.every((entry) => entry.level === 'info'), '服务缺失属正常情况，不应报 warn/error')
})

test('服务属性抛错（Cordis 未 inject）时不抛出异常', () => {
  const throwing = new Proxy(
    {},
    {
      get() {
        throw new Error('cannot get property "systemPrompt" without inject')
      },
    },
  )
  assert.doesNotThrow(() => registerPromptSection(throwing as never))
  assert.equal(registerPromptSection(throwing as never).registered, false)
})

test('section() 自身抛错（如同名重复注册）时不抛出异常', () => {
  const ctx = {
    systemPrompt: {
      section: () => {
        throw new Error('a section named "tool:meow-push-bridge" already exists')
      },
    },
  }
  const logs: { level: string; message: string }[] = []
  const result = registerPromptSection(ctx, (level, message) => logs.push({ level, message }))
  assert.equal(result.registered, false)
  assert.ok(logs.some((entry) => entry.level === 'warn'))
})

test('systemPrompt 存在但缺少 section 方法时不抛错', () => {
  const result = registerPromptSection({ systemPrompt: {} })
  assert.equal(result.registered, false)
})
