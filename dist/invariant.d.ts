/**
 * meow-push-bridge / MeoW Push Bridge (喵桥)
 * src/invariant.ts —— 包自有不变式（package-owned invariants）
 *
 * 设计原则：不变式是「纯函数 + 结构化结果」，因此
 *   - 可在 Node 的测试进程里直接调用（tests/register.spec.ts）；
 *   - 不依赖任何 DSH 内部 API，避免版本差异导致插件加载失败。
 *
 * 关于「注册」：不同 DSH/Cordis 版本对不变式注册的入口命名不一致。
 * 本模块提供 registerInvariants(ctx)，它会在以下通道中尽力注册，全部失败也不抛错：
 *   1. ctx.invariant(...) → 若返回 disposer，则透传（Cordis effect 风格）
 *   2. ctx.invariants.register(...) / ctx.invariant.register(...)
 *   3. 都不存在 → 仅记 debug 日志（本模块的 assertInvariants 仍然在加载期被显式调用，
 *      所以即使注册通道不可用，不变式检查依然生效）
 *
 * 只使用可擦除 TypeScript 语法。
 */
import { type ResolvedMeoWConfig } from './config.js';
/** 工具名常量在此重复声明，避免与 index.ts 形成循环依赖 */
export declare const EXPECTED_TOOL_NAME = "meow_push_bridge";
export declare const EXPECTED_PLUGIN_ID = "meow-push-bridge";
export declare const EXPECTED_INJECT = "tools";
/** 一条不变式的检查结果 */
export interface InvariantViolation {
    /** 稳定标识，便于测试与日志检索 */
    id: string;
    /** 人类可读说明 */
    message: string;
}
/** 不变式检查函数：返回违规列表（空数组 = 通过） */
export type InvariantCheck = () => InvariantViolation[];
/** 一条不变式的定义 */
export interface InvariantDefinition {
    id: string;
    description: string;
    check: InvariantCheck;
}
/** 检查所需的最小上下文形态（由 index.ts 传入真实值） */
export interface InvariantInput {
    /** 插件导出的 name */
    pluginName: string;
    /** 插件导出的 inject */
    inject: readonly string[];
    /** 已注册（或即将注册）的工具定义 */
    definition: unknown;
    /** 模块作用域内解析出的配置 */
    config: ResolvedMeoWConfig;
    /** 插件导出的 Config schema（用于校验宿主能识别它） */
    configSchema?: unknown;
}
/**
 * 构建包自有不变式集合。
 *
 * @param input 加载期快照（插件名 / inject / 工具定义 / 已解析配置）
 */
export declare function createInvariants(input: InvariantInput): InvariantDefinition[];
/**
 * 运行一组不变式。
 *
 * @returns 违规列表（空数组 = 全部通过）
 */
export declare function assertInvariants(invariants: readonly InvariantDefinition[]): InvariantViolation[];
/**
 * 便捷入口：按加载期快照构建并运行全部包自有不变式。
 */
export declare function assertInvariantsFor(input: InvariantInput): InvariantViolation[];
/** 注册结果，便于测试与日志 */
export interface InvariantRegistration {
    registered: boolean;
    channel: 'ctx.invariant' | 'ctx.invariants.register' | 'ctx.invariant.register' | 'none';
}
/**
 * 尽力把包自有不变式注册到宿主（多通道兼容，绝不抛错）。
 *
 * 说明：本文档无法确认 DSH 是否真的提供不变式注册入口（服务目录里没有它），
 * 因此这里只做「无害探测」：任一步失败都静默跳过。
 * 真正生效的是加载期显式调用的 `assertInvariants`。
 */
export declare function registerInvariants(ctx: unknown, invariants: InvariantDefinition[], log?: (level: 'info' | 'warn', message: string) => void): InvariantRegistration;
//# sourceMappingURL=invariant.d.ts.map