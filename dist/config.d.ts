/**
 * meow-push-bridge / MeoW Push Bridge (喵桥)
 * src/config.ts —— 插件配置定义、归一化与校验
 *
 * 设计约束：本文件只使用「可擦除 TypeScript 语法」（无 enum / 无构造器参数属性 /
 * 无 namespace），因此 Node 22+ 可以直接 `--experimental-strip-types` 运行，
 * 测试无需引入 vitest、tsx 等额外依赖。
 */
import { type PushMode } from './auto-push.js';
export type { PushMode };
/** MeoW 昵称缺失时使用的错误码（供测试与用户排查引用） */
export declare const MEOW_NICKNAME_REQUIRED = "MEOW_NICKNAME_REQUIRED";
/** 面向用户的中文错误提示：说明哪里填、填完怎么生效 */
export declare const MEOW_NICKNAME_REQUIRED_MESSAGE = "MeoW \u6635\u79F0\u672A\u914D\u7F6E\uFF0C\u8BF7\u5728 cordis.patch.yml \u4E2D\u586B\u5199 nickname \u5B57\u6BB5\u540E\u91CD\u8F7D\u63D2\u4EF6\u3002";
/** MeoW API 默认基础地址 */
export declare const DEFAULT_API_BASE = "http://api.chuckfang.com";
/** 默认请求超时（毫秒） */
export declare const DEFAULT_TIMEOUT_MS = 10000;
/** 默认同一会话推送节流窗口（毫秒） */
export declare const DEFAULT_THROTTLE_MS = 5000;
/** 允许的超时上下界，避免误配导致插件永久挂起或立刻超时 */
export declare const MIN_TIMEOUT_MS = 100;
export declare const MAX_TIMEOUT_MS = 120000;
/**
 * 插件配置接口（对应 cordis.patch.yml 中该 entry 的 config 段）
 */
export interface MeoWConfig {
    /** 必填：MeoW 用户昵称，空值会导致插件拒绝注册工具 */
    nickname: string;
    /** 可选：MeoW API 基础地址，默认 http://api.chuckfang.com */
    apiBase?: string;
    /** 可选：请求超时毫秒数，默认 10000 */
    timeout?: number;
    /** 可选：同一会话内的推送节流窗口毫秒数，默认 5000 */
    throttleMs?: number;
    /** 可选：自动推送模式，默认 every-turn（每轮必推，宿主侧确定性触发） */
    pushMode?: PushMode;
}
/** 归一化后的运行时配置：所有可选字段都有确定值 */
export interface ResolvedMeoWConfig {
    nickname: string;
    apiBase: string;
    timeout: number;
    throttleMs: number;
    pushMode: PushMode;
}
/**
 * 配置校验失败。带有稳定 code 与中文 message，插件据此拒绝注册工具。
 */
export declare class ConfigError extends Error {
    readonly code: string;
    readonly field: string;
    constructor(code: string, field: string, message: string);
}
/** 收集非致命配置问题的回调（由 index.ts 接到 ctx.logger.warn） */
export type WarnSink = (message: string) => void;
/**
 * 校验并归一化插件配置。
 *
 * - nickname 缺失 / 空白 → 抛 ConfigError(MEOW_NICKNAME_REQUIRED)
 * - apiBase / timeout / throttleMs 非法 → 回退默认值，并通过 warn 提示（不阻断加载）
 *
 * @param raw   Loader 传入的原始配置（可能为 undefined 或任意类型）
 * @param warn  可选的非致命问题回调
 */
export declare function resolveConfig(raw: unknown, warn?: WarnSink): ResolvedMeoWConfig;
//# sourceMappingURL=config.d.ts.map