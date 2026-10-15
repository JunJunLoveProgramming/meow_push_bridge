/**
 * meow-push-bridge / MeoW Push Bridge (喵桥)
 * src/config.ts —— 插件配置定义、归一化与校验
 *
 * 配置面刻意保持最小：**只有昵称需要用户填写**。
 * 其余请求细节（API 地址、方法、超时、消息格式、HTML 高度、节流窗口、推送模式）
 * 都按官方文档的推荐值固化在代码里，不作为配置项暴露：
 *   - API 地址 → https://api.chuckfang.com（官方推荐 HTTPS）
 *   - 请求方法 → GET
 *   - 超时     → 10000 ms
 *   - 消息格式 → text（纯文本）
 *   - 节流窗口 → 5000 ms
 *   - 推送模式 → every-turn（每轮都推）
 * 用户只需在设置页填一个昵称即可使用。
 *
 * 本文件只使用「可擦除 TypeScript 语法」，便于 Node 直接运行。
 */
import { DEFAULT_API_BASE, DEFAULT_TIMEOUT_MS, type MeoWMethod, type MeoWMsgType } from './meow-api.js';
export type { MeoWMethod, MeoWMsgType };
export { DEFAULT_API_BASE, DEFAULT_TIMEOUT_MS };
/** MeoW 昵称缺失时使用的错误码（供测试与用户排查引用） */
export declare const MEOW_NICKNAME_REQUIRED = "MEOW_NICKNAME_REQUIRED";
/** 面向用户的中文错误提示：说明哪里填、填完怎么生效 */
export declare const MEOW_NICKNAME_REQUIRED_MESSAGE = "MeoW \u6635\u79F0\u672A\u914D\u7F6E\uFF0C\u8BF7\u5728\u8BBE\u7F6E\u9875\u7684\u300C\u55B5\u6865\u300D\u91CC\u586B\u5199\u6635\u79F0\uFF0C\u6216\u4FEE\u6539 cordis.patch.yml \u540E\u91CD\u8F7D\u63D2\u4EF6\u3002";
/**
 * 插件配置接口（对应 cordis.patch.yml 中该 entry 的 config 段）。
 * 只有一个必填字段。
 */
export interface MeoWConfig {
    /** 必填：MeoW 用户昵称（官方文档：不允许包含斜杠），空值会导致插件拒绝注册工具 */
    nickname: string;
}
/** 归一化后的运行时配置 */
export interface ResolvedMeoWConfig {
    nickname: string;
}
/** 固化在代码里的请求参数（不作为配置项暴露） */
export declare const FIXED_REQUEST: {
    /** 官方推荐的 HTTPS 地址 */
    readonly apiBase: "https://api.chuckfang.com";
    /**
     * 请求方法固定为 POST。
     * 原因：推送正文是**对话总结**（用户提问 + 模型回复），长度可达数百字；
     * 用 GET 会把内容塞进 URL 路径，既受长度限制、编码也更脆。
     * POST 把内容放 JSON Body，是官方文档明确支持的形式。
     */
    readonly method: MeoWMethod;
    /** 请求超时（毫秒） */
    readonly timeout: 10000;
    /** 消息显示类型 */
    readonly msgType: MeoWMsgType;
    /** HTML 显示高度（仅 msgType=html 时才有意义，此处保留常量备用） */
    readonly htmlHeight: 200;
};
/** 固化的同会话节流窗口（毫秒） */
export declare const FIXED_THROTTLE_MS = 5000;
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
 * - 旧配置里残留的已移除字段会被忽略，并给出一次 warn（方便平滑升级）
 *
 * @param raw   Loader 传入的原始配置（可能为 undefined 或任意类型）
 * @param warn  可选的非致命问题回调
 */
export declare function resolveConfig(raw: unknown, warn?: WarnSink): ResolvedMeoWConfig;
//# sourceMappingURL=config.d.ts.map