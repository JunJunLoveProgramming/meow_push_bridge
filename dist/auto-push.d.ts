/**
 * meow-push-bridge / MeoW Push Bridge (喵桥)
 * src/auto-push.ts —— 宿主侧「每轮必推」的确定性自动推送
 *
 * 为什么需要它（这是本项目最重要的一次设计修正）：
 *   只靠 `systemPrompt` 里的约定让**模型自觉调用**工具，是概率性合规 ——
 *   实测同一个模型在不同上下文/任务/会话里会忽略它，于是「部分环境不推」。
 *   本模块改为在宿主侧监听轮次结束事件后**直接推送**，不依赖模型。
 *
 * DSH 契约（来自运行时的服务/事件目录，非推断）：
 *   - 事件 `'agent/turn-stopping'(this: Scoped<Agent>, payload: { agent, turn, signal })`
 *     —— 「本轮即将结束」的串行事件，全局注册的插件可以收到。
 *   - 事件 `'session/event'(this: Scoped<Session>, session, event)`
 *     —— 会话事件的提交后观察流，用于统计「本轮用了哪些工具」。
 *     注意它带 carrier（作用域过滤），所以统计是**尽力而为**：
 *     拿不到统计时退化为简洁文案，但**轮次结束的推送照常发出**。
 *
 * 设计取舍：
 *   - 推送**不经过工具**，因此不受工具级 5 秒节流限制（否则每轮必推做不到）；
 *     改为按 (会话, 轮次) 去重，保证同一轮只推一条。
 *   - 模型自己推的那条排在前面（它在轮内调用），宿主这条在轮末补位，符合
 *     「统计式描述放在最后」的预期。
 */
import { type PushOutcome } from './meow-api.js';
/** 自动推送模式 */
export type PushMode = 'every-turn' | 'substantial' | 'off';
/** 所有合法模式（供配置归一化与测试引用） */
export declare const PUSH_MODES: readonly PushMode[];
/** 默认模式：每轮必推 */
export declare const DEFAULT_PUSH_MODE: PushMode;
/** 与 index.ts 的 PluginContext 对齐的最小上下文（避免循环依赖） */
export interface AutoPushContext {
    readonly logger?: {
        error?(...args: unknown[]): void;
        warn?(...args: unknown[]): void;
        info?(...args: unknown[]): void;
    };
    /** 事件订阅：Cordis 上下文成员 */
    on?(event: string, listener: (...args: unknown[]) => void, options?: Record<string, unknown>): unknown;
}
/** 一轮的统计 */
export interface TurnStats {
    turn: number;
    startedAt: number;
    toolCalls: number;
    /** 工具名 → 调用次数 */
    tools: Map<string, number>;
}
/** 自动推送的注入项 */
export interface AutoPushOptions {
    mode: PushMode;
    /** 实际执行推送（由 index.ts 注入，内部会复用工具级节流） */
    send: (title: string, message: string) => Promise<PushOutcome>;
}
/** 注册结果 */
export interface AutoPushRegistration {
    registered: boolean;
    reason?: string;
}
/** 把统计渲染成中文文案（用户要求：统计式描述，放在最后） */
export declare function renderTurnStats(stats: TurnStats, now?: number): string;
/**
 * 注册宿主侧自动推送。
 *
 * 行为：
 *   - `off`：不注册任何监听（只保留模型主动调用）
 *   - `every-turn`：每轮回答结束都推
 *   - `substantial`：仅当本轮调用过工具才推
 *
 * 失败**不抛错** —— 自动推送是增强项，工具本身必须始终可用。
 */
export declare function registerAutoPush(ctx: AutoPushContext, options: AutoPushOptions): AutoPushRegistration;
/** 便捷函数：归一化 pushMode 配置（非法值回退默认） */
export declare function normalizePushMode(value: unknown): PushMode;
//# sourceMappingURL=auto-push.d.ts.map