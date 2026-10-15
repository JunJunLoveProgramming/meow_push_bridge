/**
 * meow-push-bridge / MeoW Push Bridge (喵桥)
 * src/index.ts —— 插件入口：加载期配置校验 + 工具注册 + 推送执行
 *
 * 加载期行为：
 *   - 从 ctx.config（或 apply 的第二参数 config）读取插件配置；
 *   - nickname 缺失/空白 → 记录 error 日志并直接 return，绝不注册工具；
 *   - 校验通过 → 注册 meow_push_bridge 工具，向系统提示注册「任务完成自动推送」约定
 *     （见 src/prompt.ts），并按 pushMode 注册宿主侧自动推送（见 src/auto-push.ts）。
 *
 * 执行期行为：
 *   - 绑定「配置 + 会话键」的 5 秒节流，避免同一会话重复推送；
 *   - 调用 src/meow-api.ts 的 pushToMeow 完成 URL 构造、超时与错误分类。
 */
import { type ToolDefinition } from './tool.js';
/**
 * 文档规定的发送间隔下限（毫秒）。
 * 依据官方文档「通用说明」：非会员上限为 3 秒 1 条、每分钟 15 条、每小时 60 条，
 * 超出返回业务状态码 429。这里对**自动推送**做同样的最小间隔保护，
 * 避免每轮必推时把 3 秒内连续的多轮打到 429。
 */
export declare const MIN_SEND_INTERVAL_MS = 3000;
/**
 * Config schema 声明（Cordis 约定：插件模块导出 `Config`）。
 *
 * 作用：让 DSH 的 settings 服务把本插件配置投影成「设置页表单」，
 * 用户无需手写 YAML 即可填写 MeoW 昵称。
 *
 * 为什么这里能生效（来自 @deepseek-ai/cordis 的真实实现）：
 *   function resolveConfig(runtime, config) {
 *     if (!runtime.Config) return config
 *     const result = runtime.Config['~standard'].validate(config)
 *     if ('then' in result) throw new TypeError('Async config validation is not supported')
 *     if (result.issues) throw new ValidationError(result.issues)
 *     else return result.value
 *   }
 * 即：必须提供「字符串键 `~standard`」上的 Standard Schema 接口（同步）。
 * 本插件用零依赖的 src/schema.ts 实现该契约。
 *
 * ⚠️ nickname 刻意不标 required：schema 只决定「设置页有哪些字段」，
 *    「昵称缺失则不注册工具」由运行期校验（src/config.ts）强制执行 ——
 *    用户随时可能在表单里把输入框清空，运行期才是权威。
 */
export declare const Config: import("./schema.js").Schema<Record<string, unknown>>;
/** 插件 ID / Cordis 插件名（与 npm 包名、仓库名保持全局统一） */
export declare const name = "meow-push-bridge";
/** 依赖 tools 服务：缺少时 Cordis 不会激活本插件（而非半激活） */
export declare const inject: string[];
/** 工具名 */
export declare const TOOL_NAME = "meow_push_bridge";
/**
 * Cordis 上下文的最小结构声明（只声明本插件真正用到的成员）。
 *
 * 说明：这里不 `import type { Context } from '@deepseek-ai/cordis'`，原因同 tool.ts：
 * 当前 DSH 的 @deepseek-ai/* 包不保证可被插件侧解析。若将来官方类型可解析，
 * 可改为 `import type { Context } from '@deepseek-ai/cordis'` 并删除本接口。
 */
interface PluginContext {
    /** loader 注入的 config 段 */
    readonly config?: unknown;
    /** 日志（Cordis 提供 error/warn/info；此处按可选处理以兼容不同版本） */
    readonly logger?: {
        error?(...args: unknown[]): void;
        warn?(...args: unknown[]): void;
        info?(...args: unknown[]): void;
    };
    /** tools 服务；Cordis 会因 inject 声明而注入 */
    readonly tools?: {
        register(definition: ToolDefinition<MeowToolArgs, string>): () => void;
    };
    /** 生命周期副作用登记，Dispose 时自动清理（HMR 卸载时注销工具） */
    effect?(callback: () => (() => void) | void, label?: string): unknown;
    /** 系统提示服务；缺省时跳过「任务完成自动推送」提示词注册（不影响工具） */
    readonly systemPrompt?: unknown;
    /**
     * 可选服务查询。
     *
     * ⚠️ 可选服务（如 sessions）**必须**走这个方法读取，不能直接写 `ctx.sessions`：
     * Cordis 对未列入 `inject` 的服务属性读取会抛
     * `Error: cannot get property "sessions" without inject`，
     * 导致整个插件激活失败。
     */
    get?(key: string): unknown;
}
/** 清空节流簿（仅测试使用） */
export declare function resetThrottleState(): void;
/** 距离下一次可发送还需等待多少毫秒（<=0 表示可以立刻发） */
export declare function remainingGlobalWindow(lastAt: number, minIntervalMs: number, now?: number): number;
/** 节流判定结果 */
export interface ThrottleDecision {
    blocked: boolean;
    retryInMs: number;
}
/**
 * 同一会话的推送节流判定。
 *
 * 规则：键相同且距上次「成功推送」不足 windowMs → 拦截。
 * windowMs <= 0 表示关闭节流。
 */
export declare function checkThrottle(book: Map<string, number>, key: string, windowMs: number, now?: number): ThrottleDecision;
/**
 * 插件入口。
 *
 * @param ctx      Cordis 上下文（已声明 inject: ['tools']）
 * @param injected Loader 直接传入的 config（部分 Cordis 版本走此通道）
 */
export declare function apply(ctx: PluginContext, injected?: unknown): void;
/** 工具入参：nickname 不在这里，它来自插件配置 */
export interface MeowToolArgs {
    /** 可选，缺省 DEFAULT_TITLE（"MeoW Push Bridge"） */
    title?: string;
    /** 必填，消息内容 */
    message: string;
    /** 可选，点击跳转链接 */
    url?: string;
    /** 可选，本条消息的通知图标 URL（覆盖插件配置里的 imgUrl） */
    imgUrl?: string;
}
export type { ResolvedMeoWConfig, MeoWConfig } from './config.js';
export { ConfigError, resolveConfig } from './config.js';
//# sourceMappingURL=index.d.ts.map