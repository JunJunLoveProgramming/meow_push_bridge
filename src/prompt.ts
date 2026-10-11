/**
 * meow-push-bridge / MeoW Push Bridge (喵桥)
 * src/prompt.ts —— 向 Agent 的系统提示注册「任务完成后推送通知」的约定
 *
 * 为什么需要它：
 *   本插件注册的 `meow_push_bridge` 是**被动工具** —— 模型必须主动调用才会推送。
 *   若不在系统提示里说明，Agent 不会知道「任务做完应该通知用户」。
 *
 * 实现依据（@deepseek-ai/dsh-system-prompt 的真实契约）：
 *   systemPrompt.section({ name, order, text, interpolate? })  → 返回 disposer
 *   - order 越小越靠前。官方区段示例：
 *       HARNESS_IDENTITY: -1000 → PERSONA_PREFIX: 0 → PLAN_POLICY: 500
 *       → FILE_REFERENCE: 900 → 各工具说明 1000..3000 → MCP_SERVERS: 3100
 *     本插件取 2500，位于工具说明区间内（TOOL_GOAL: 2400 与 TOOL_WORKFLOW: 2600 之间）。
 *   - interpolate: false 时区段文本原样保留，不做 `{{变量}}` 插值
 *     （原文：Sections with `interpolate: false` retain literal text）。
 *     我们用 false，避免正文里的花括号被解析、也避免未知变量导致组装抛错。
 *   - 同名区段重复注册会抛错，因此 name 保持全局唯一。
 */

/** 本插件注册的提示词区段名（全局唯一） */
export const PROMPT_SECTION_NAME = 'tool:meow-push-bridge'

/** 区段排序值：位于其他工具说明之间 */
export const PROMPT_SECTION_ORDER = 2500

/**
 * 提示词正文 —— 这就是「任务完成自动推送」的开关所在。
 *
 * 措辞刻意克制：只在**完成实质任务**时推送，纯问答/澄清不推，
 * 且提醒模型沿用工具级节流窗口，避免刷屏。
 * 想调整行为只需改这段文字（改完 `pnpm build` 并重载插件即可）。
 */
export const PUSH_INSTRUCTION_TEXT = [
  '## 任务完成通知（MeoW 推送）',
  '',
  '本部署配置了 `meow_push_bridge` 工具，可把通知推送到用户的鸿蒙手机。使用约定：',
  '',
  '- **完成实质任务后**调用一次：修改或创建文件、运行测试/构建、排查并修复问题、'
    + '完成多步操作、给出需要用户后续处理的重要结论。',
  '- **不要推送**的情形：纯问答或解释、寒暄、追问澄清、只读几行代码就给出的一句话回答、'
    + '尚未完成的中途状态。',
  '- `title` 用任务名（如「构建」「测试修复」），`message` 一句话说清结果并带上关键数字'
    + '（文件数、用例数、耗时、错误数等），`url` 填相关链接（有则填）。',
  '- 不要为了「通知」而额外做无意义的工具调用；每个会话的推送有 5 秒节流窗口，'
    + '连续调用只有第一条会成功。',
].join('\n')

/** 注册结果，便于测试与日志 */
export interface PromptSectionRegistration {
  registered: boolean
  /** 失败原因（仅 registered=false 时有值） */
  reason?: string
}

/** 与 index.ts 的 PluginContext 对齐的最小结构（避免循环依赖） */
interface PromptContext {
  readonly systemPrompt?: unknown
}

/**
 * 注册「任务完成推送」提示词区段。
 *
 * 失败**不抛错**：提示词是增强项 —— 即使宿主没提供 systemPrompt 服务，
 * 工具本身仍应正常注册可用。
 *
 * @param ctx 插件上下文
 * @param log 可选日志回调
 */
export function registerPromptSection(
  ctx: PromptContext,
  log: (level: 'warn' | 'info', message: string) => void = () => {},
): PromptSectionRegistration {
  let service: unknown
  try {
    // ⚠️ 必须 try/catch：Cordis 对未 inject 的服务属性会抛错
    service = ctx.systemPrompt
  } catch {
    service = undefined
  }
  if (service === null || typeof service !== 'object') {
    log('info', '宿主未提供 systemPrompt 服务，已跳过「任务完成自动推送」提示词注册。')
    return { registered: false, reason: 'systemPrompt service unavailable' }
  }

  const register = (service as { section?: unknown }).section
  if (typeof register !== 'function') {
    log('warn', 'systemPrompt.section 不可用，已跳过提示词注册。')
    return { registered: false, reason: 'systemPrompt.section unavailable' }
  }

  try {
    ;(register as (section: unknown) => unknown).call(service, {
      name: PROMPT_SECTION_NAME,
      order: PROMPT_SECTION_ORDER,
      text: PUSH_INSTRUCTION_TEXT,
      interpolate: false,
    })
    log('info', `已注册「任务完成自动推送」提示词区段（order ${PROMPT_SECTION_ORDER}）。`)
    return { registered: true }
  } catch (error) {
    log('warn', `提示词区段注册失败（不影响推送工具本身）：${String(error)}`)
    return { registered: false, reason: String(error) }
  }
}
