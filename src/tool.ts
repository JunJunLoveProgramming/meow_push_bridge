/**
 * meow-push-bridge / MeoW Push Bridge (喵桥)
 * src/tool.ts —— DSH 工具注册契约的本地声明 + defineTool 辅助函数
 *
 * 为什么本地声明而不是 `import type { ToolDefinition } from '@deepseek-ai/dsh-tools'`：
 * 实测当前 DSH 的 @deepseek-ai/* 包位于 asar / pnpm 隔离的 node_modules 中，
 * 插件侧无法保证能解析到它们。声明为结构化类型后：
 *   1. 运行时零依赖（本文件不产生任何 import）；
 *   2. 结构完全对齐 DSH 的 ToolDefinition（见下），ctx.tools.register 可直接接受；
 *   3. 若将来能解析到官方类型，只需断言一次即可对齐。
 *
 * 对齐依据（DSH Inspect / host / Service / tools）：
 *   register(definition: ToolDefinition): () => void
 *   ToolDefinition extends ToolSchema {
 *     output: ToolOutputDefinition
 *     execute(args: unknown, exec: ToolRunContext): Promise<unknown>
 *     projectContent?(...): ContentBlock[] | undefined
 *     timeoutMs?: number
 *     isConcurrencySafe?(args: unknown): boolean
 *   }
 *   ToolSchema { name: string; description: string; parameters: Record<string, unknown> }
 *   ToolOutputDefinition { schema: JsonSchemaNode; render(args, value): ContentBlock[] }
 */

/** 与 DSH 的 JsonSchemaNode 对齐 */
export interface JsonSchemaNode {
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null'
  properties?: Record<string, JsonSchemaNode>
  required?: string[]
  additionalProperties?: boolean
  items?: JsonSchemaNode
  enum?: (string | number | boolean | null)[]
  description?: string
  default?: unknown
}

/** 与 DSH 的 ContentBlock 对齐（本插件只用到 text） */
export interface TextContentBlock {
  type: 'text'
  text: string
}

/** 与 DSH 的 ToolOutputDefinition 对齐 */
export interface ToolOutputDefinition<Args, Value> {
  schema: JsonSchemaNode
  render(args: Args, value: Value): TextContentBlock[]
}

/** 与 DSH 的 ToolRunContext 对齐（exec 中本插件只用到 signal 与 agent） */
export interface ToolExecContext {
  readonly signal: AbortSignal
  /** 发起本次调用的会话/Agent；节流按键依赖它 */
  readonly agent?: { readonly id?: string }
  /** 工具调用 id，作为节流的兜底键 */
  readonly callId?: string
}

/** 与 DSH 的 ToolDefinition 对齐 */
export interface ToolDefinition<Args, Value> {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: ToolOutputDefinition<Args, Value>
  timeoutMs?: number
  execute(args: Args, exec: ToolExecContext): Promise<Value>
  isConcurrencySafe?(args: unknown): boolean
  /** 可选：DSH 允许工具接管自己的 content 投影，本插件不需要，故不声明 */
}

/**
 * `defineTool`：与用户约定的注册入口同名，保持调用点写法为
 * `ctx.tools.register(defineTool({ ... }))`。
 *
 * 它做的事只有一件：不加任何运行时包装，仅提供 Args/Value 泛型推断，
 * 让 execute 的入参、output.render 的返回值都获得严格类型检查。
 */
export function defineTool<Args, Value>(
  definition: ToolDefinition<Args, Value>,
): ToolDefinition<Args, Value> {
  return definition
}

/** 构造一个文本 content block 的小工具 */
export function text(value: string): TextContentBlock[] {
  return [{ type: 'text', text: value }]
}
