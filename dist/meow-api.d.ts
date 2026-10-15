/**
 * meow-push-bridge / MeoW Push Bridge (喵桥)
 * src/meow-api.ts —— MeoW 推送接口封装
 *
 * 契约来源：官方文档 https://www.chuckfang.com/MeoW/api_doc.html （MeoW Push API v1）
 *
 * 请求（GET）：
 *   http://api.chuckfang.com/{昵称}/{title}/{msg}?url=&imgUrl=&msgType=&htmlHeight=
 *   也支持省略 title：/{昵称}/{msg}
 * 请求（POST）：
 *   POST /{昵称}/[title]，body 支持 application/json 等格式
 *
 * 响应：**HTTP 状态码恒为 200**，业务结果在 JSON 的 `status` 字段里：
 *   { "status": 200, "message": "推送成功" }
 *   200 成功 / 400 标题或消息参数错误 / 403 内容策略禁止发送 /
 *   404 昵称未注册 / 429 发送或 IP 频率超限 / 500 服务器错误
 *   实测服务器返回的字段名是 `msg`（文档写 `message`），两者都取。
 *
 * 限流（文档「通用说明」）：非会员 3 秒 1 条、每分钟 15 条、每小时 60 条、
 *   每天 1000 条；超出返回业务状态码 429。
 *
 * 本文件运行时零依赖，只用全局 fetch / AbortSignal，且无模块级副作用。
 */
/**
 * 默认 API 基础地址。
 * 官方推荐 HTTPS 以保证传输安全；HTTP 同样可用（见文档 BASE 行）。
 */
export declare const DEFAULT_API_BASE = "https://api.chuckfang.com";
/** 工具/自动推送未指定标题时的缺省标题 */
export declare const DEFAULT_TITLE = "MeoW Push Bridge";
/** 文档规定的省略 title 时服务端使用的标题 */
export declare const SPEC_DEFAULT_TITLE = "MeoW";
/** 消息显示类型（文档 msgType 参数） */
export type MeoWMsgType = 'text' | 'html';
/** 请求方法（文档支持 GET 与 POST） */
export type MeoWMethod = 'GET' | 'POST';
/** htmlHeight 的默认值与合理范围（文档默认 200） */
export declare const DEFAULT_HTML_HEIGHT = 200;
export declare const MIN_HTML_HEIGHT = 50;
export declare const MAX_HTML_HEIGHT = 2000;
/** 默认请求超时（毫秒） */
export declare const DEFAULT_TIMEOUT_MS = 10000;
/** 一次推送请求 */
export interface PushRequest {
    /** MeoW 昵称，来自插件配置（不是工具入参）；文档：不允许包含斜杠 */
    nickname: string;
    /** 消息标题，缺省 DEFAULT_TITLE（文档：省略时服务端用 “MeoW”） */
    title?: string;
    /** 消息内容，必填 */
    message: string;
    /** 跳转链接，可选（查询参数） */
    url?: string;
    /** 通知图标 URL，可选（查询参数）；文档建议 216×216 PNG */
    imgUrl?: string;
    /** 消息显示类型：text（默认，纯文本）或 html（App 内渲染） */
    msgType?: MeoWMsgType;
    /** 仅 msgType=html 时生效，HTML 显示高度（像素），默认 200 */
    htmlHeight?: number;
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
/** HTTP 层非 2xx，或业务状态 400（标题/消息参数错误） */
 | 'http'
/** 业务状态 403：内容策略禁止发送 */
 | 'forbidden'
/** 业务状态 404：昵称未注册 */
 | 'nickname'
/** 业务状态 429：频率超限 */
 | 'ratelimit'
/** 业务状态 500 或其他未预期业务码 */
 | 'server'
/** 其他未预期错误 */
 | 'unknown';
export interface PushSuccess {
    ok: true;
    /** MeoW 业务状态码（通常 200） */
    status: number;
    /** 最终请求的 URL（便于排查） */
    url: string;
    /** 服务端返回的结果描述 */
    message: string;
}
export interface PushFailure {
    ok: false;
    kind: PushErrorKind;
    /** 面向用户/模型的中文可读消息 */
    message: string;
    /** MeoW 业务状态码（能拿到时） */
    status?: number;
    /** 最终请求的 URL（便于排查） */
    url?: string;
    /** 服务端返回的原始描述（截断后） */
    body?: string;
}
export type PushOutcome = PushSuccess | PushFailure;
/** 解析后的服务端结果 */
export interface ServerResult {
    /** 业务状态码；缺失时为 undefined */
    status?: number;
    /** 结果描述（兼容 msg 与 message 两个字段） */
    text: string;
    /** 响应体是否可解析为 JSON */
    parsed: boolean;
    /** 原始响应体（已截断） */
    raw: string;
}
/** pushToMeow 的可选参数 */
export interface PushOptions {
    /** API 基础地址，默认 DEFAULT_API_BASE */
    apiBase?: string;
    /** 请求方法，默认 GET */
    method?: MeoWMethod;
    /** 上层（工具调度）的取消信号 */
    signal?: AbortSignal;
    /** 请求超时毫秒数，默认 10000 */
    timeout?: number;
    /** 自定义 fetch（默认取 globalThis.fetch），便于测试与将来替换实现 */
    fetchImpl?: typeof fetch;
}
/** 归一化 msgType（非法值回退 text） */
export declare function normalizeMsgType(value: unknown): MeoWMsgType;
/** 夹取 htmlHeight；非法值回退默认 */
export declare function normalizeHtmlHeight(value: unknown): number;
/**
 * 拼接 MeoW 推送 URL（GET 形式）。
 *
 * 三个路径段（nickname / title / message）经 toPathSegment 处理；
 * 查询参数 url / imgUrl 只做普通 encodeURIComponent（查询串允许 %2F）。
 */
export declare function buildMeowUrl(request: PushRequest, apiBase?: string): string;
/** 拼接 POST 目标 URL：/{昵称}/[title]，其余字段走 Body */
export declare function buildMeowPostUrl(request: PushRequest, apiBase?: string): string;
/** 构造 POST JSON 请求体（文档：title/msg/url/imgUrl 可放 Body，Body 优先） */
export declare function buildMeowBody(request: PushRequest): Record<string, unknown>;
/**
 * 解析 MeoW 响应体。
 *
 * 文档形状：`{ "status": 200, "message": "推送成功" }`
 * 实测形状：`{ "status": 200, "data": true, "msg": "发送成功" }`
 * 因此同时接受 `message` 与 `msg`。
 */
export declare function parseServerResult(raw: string): ServerResult;
/** 把 MeoW 业务状态码翻译成分类与中文提示（状态码语义见文档「响应格式」） */
export declare function classifyBusinessStatus(status: number, text: string): {
    kind: PushErrorKind;
    message: string;
};
/**
 * 向 MeoW 推送一条消息（GET 或 POST，见 options.method）。
 *
 * 分类规则：
 *   1. outer.aborted                → aborted
 *   2. 超时信号触发 / TimeoutError   → timeout
 *   3. HTTP 非 2xx                   → http
 *   4. 业务 status ≠ 200             → 按 400/403/404/429/500 细分
 *   5. fetch 抛 TypeError            → network
 *   6. 其他                          → unknown
 */
export declare function pushToMeow(request: PushRequest, options?: PushOptions): Promise<PushOutcome>;
/** 把推送结果格式化为给模型看的一行文本（含 emoji，便于一眼分辨成败） */
export declare function formatOutcome(outcome: PushOutcome, title: string, message: string): string;
//# sourceMappingURL=meow-api.d.ts.map