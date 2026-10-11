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
/**
 * `defineTool`：与用户约定的注册入口同名，保持调用点写法为
 * `ctx.tools.register(defineTool({ ... }))`。
 *
 * 它做的事只有一件：不加任何运行时包装，仅提供 Args/Value 泛型推断，
 * 让 execute 的入参、output.render 的返回值都获得严格类型检查。
 */
export function defineTool(definition) {
    return definition;
}
/** 构造一个文本 content block 的小工具 */
export function text(value) {
    return [{ type: 'text', text: value }];
}
//# sourceMappingURL=tool.js.map