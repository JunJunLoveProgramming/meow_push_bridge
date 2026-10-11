/**
 * meow-push-bridge / MeoW Push Bridge (喵桥)
 * src/meow-api.ts —— MeoW HTTP 推送接口封装
 *
 * 接口形状：
 *   http://api.chuckfang.com/{nickname}/{title}/{message}?url={url}
 *
 * 本文件特性：
 *   - 运行时零依赖，只用全局 fetch / AbortSignal（Node 20.6+ 内置）；
 *   - 纯逻辑、无模块级副作用，便于 tests/impl.spec.ts 直接 mock fetch 测试；
 *   - fetch 在「调用时」从 globalThis 读取，因此测试可替换 globalThis.fetch。
 *
 * 同样只使用可擦除 TypeScript 语法（无 enum / 无构造器参数属性）。
 */
/** 通知标题缺省值：宿主侧自动推送与工具调用都用它 */
export declare const DEFAULT_TITLE = "MeoW Push Bridge";
/** 一次推送请求 */
export interface PushRequest {
    /** MeoW 昵称，来自插件配置（不是工具入参） */
    nickname: string;
    /** 通知标题，缺省 DEFAULT_TITLE */
    title?: string;
    /** 通知正文，必填 */
    message: string;
    /** 点击通知跳转链接，可选 */
    url?: string;
}
/** 失败分类 */
export type PushErrorKind = 
/** 本地参数非法（例如 message 为空），未发出请求 */
'invalid'
/** 请求超时 */
 | 'timeout'
/** 被上层取消（exec.signal） */
 | 'aborted'
/** 网络层失败（DNS / 连接被拒 / TLS / fetch 本身抛错） */
 | 'network'
/** HTTP 状态码非 2xx */
 | 'http'
/** HTTP 2xx 但 MeoW 返回的业务错误 */
 | 'business'
/** 其他未预期错误 */
 | 'unknown';
export interface PushSuccess {
    ok: true;
    /** HTTP 状态码 */
    status: number;
    /** 最终请求的完整 URL（便于排查） */
    url: string;
    /** 服务端返回体（已截断），可能为空字符串 */
    body: string;
}
export interface PushFailure {
    ok: false;
    kind: PushErrorKind;
    /** 面向用户/模型的中文可读消息 */
    message: string;
    /** HTTP 状态码（仅 http / business 分类有值） */
    status?: number;
    /** 最终请求的完整 URL（便于排查） */
    url?: string;
    /** 服务端返回体（已截断），可能为空字符串 */
    body?: string;
}
export type PushOutcome = PushSuccess | PushFailure;
/** pushToMeow 的可选参数 */
export interface PushOptions {
    /** 上层（工具调度）的取消信号 */
    signal?: AbortSignal;
    /** 请求超时毫秒数，默认 10000 */
    timeout?: number;
    /** 自定义 fetch（默认取 globalThis.fetch），便于测试与将来替换实现 */
    fetchImpl?: typeof fetch;
}
/**
 * 拼接 MeoW 推送 URL。
 *
 * 三个路径段（nickname / title / message）都经 toPathSegment 处理：
 * 先做全角替换（见 PATH_SEGMENT_REPLACEMENTS），再 encodeURIComponent ——
 * 这样中文、空格、`?`、`#`、`&` 都不会破坏 URL 结构，也不会触发 400。
 * `url` 放在查询串里，普通编码即可（查询串允许 `%2F`）。
 * 三个路径段一定都会出现：title 为空时用 DEFAULT_TITLE 兜底。
 */
export declare function buildMeowUrl(request: PushRequest, apiBase: string): string;
/**
 * 向 MeoW 推送一条通知。
 *
 * 分类规则（catch 顺序很重要）：
 *   1. signal.aborted 且是上层信号 → aborted
 *   2. 超时信号触发 → timeout
 *   3. PushHttpError → http
 *   4. fetch 抛出的 TypeError → network
 *   5. 其他 → unknown
 */
export declare function pushToMeow(request: PushRequest, apiBase: string, options?: PushOptions): Promise<PushOutcome>;
/** 把推送结果格式化为给模型看的一行文本（含 emoji，便于一眼分辨成败） */
export declare function formatOutcome(outcome: PushOutcome, title: string, message: string): string;
//# sourceMappingURL=meow-api.d.ts.map