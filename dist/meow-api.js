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
export const DEFAULT_API_BASE = 'https://api.chuckfang.com';
/** 工具/自动推送未指定标题时的缺省标题 */
export const DEFAULT_TITLE = 'MeoW Push Bridge';
/** 文档规定的省略 title 时服务端使用的标题 */
export const SPEC_DEFAULT_TITLE = 'MeoW';
/** htmlHeight 的默认值与合理范围（文档默认 200） */
export const DEFAULT_HTML_HEIGHT = 200;
export const MIN_HTML_HEIGHT = 50;
export const MAX_HTML_HEIGHT = 2000;
/** 默认请求超时（毫秒） */
export const DEFAULT_TIMEOUT_MS = 10_000;
/** HTTP 非 2xx 时抛出的内部错误，用于在 catch 中分类 */
class PushHttpError extends Error {
    status;
    body;
    constructor(status, body) {
        super(`HTTP ${status}`);
        this.name = 'PushHttpError';
        this.status = status;
        this.body = body;
    }
}
/** 响应体截断上限，避免超长返回体污染日志与模型上下文 */
const BODY_LIMIT = 300;
/** 截断文本 */
function truncate(value, limit = BODY_LIMIT) {
    return value.length > limit ? `${value.slice(0, limit)}…` : value;
}
/**
 * 路径段里必须替换掉的字符 → 视觉等价的全角字符。
 *
 * 为什么必须替换（实测于 api.chuckfang.com）：URL **路径段**里的 `/` 编码后是 `%2F`，
 * 而 MeoW 前置的 Tomcat 默认拒绝它（ALLOW_ENCODED_SLASH=false），
 * 会在请求到达应用前返回 HTTP 400。文档也明确要求「昵称不允许包含斜杠」。
 * 查询串不受影响，所以 url / imgUrl 无需处理。
 */
const PATH_SEGMENT_REPLACEMENTS = [
    [/[/]/g, '／'], // U+FF0F 全角斜杠
    [/\\/g, '＼'], // U+FF3C 全角反斜杠
    [/"/g, '＂'],
    [/'/g, '＇'],
    [/</g, '＜'],
    [/>/g, '＞'],
    [/%/g, '％'],
];
/** 把一段文本转成安全的 URL 路径段（先替换危险字符，再整体编码） */
function toPathSegment(value) {
    let safe = value;
    for (const [pattern, replacement] of PATH_SEGMENT_REPLACEMENTS) {
        safe = safe.replace(pattern, replacement);
    }
    return encodeURIComponent(safe);
}
/** 是否提供了非空字符串 */
function isFilled(value) {
    return typeof value === 'string' && value.trim().length > 0;
}
/** 归一化 msgType（非法值回退 text） */
export function normalizeMsgType(value) {
    return value === 'html' ? 'html' : 'text';
}
/** 夹取 htmlHeight；非法值回退默认 */
export function normalizeHtmlHeight(value) {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed))
        return DEFAULT_HTML_HEIGHT;
    return Math.min(MAX_HTML_HEIGHT, Math.max(MIN_HTML_HEIGHT, Math.trunc(parsed)));
}
/** 构造 GET 查询串：msgType / htmlHeight 属请求参数（文档「通用说明」） */
function buildParamQuery(request) {
    const query = [];
    if (isFilled(request.url))
        query.push(`url=${encodeURIComponent(request.url.trim())}`);
    if (isFilled(request.imgUrl))
        query.push(`imgUrl=${encodeURIComponent(request.imgUrl.trim())}`);
    const msgType = normalizeMsgType(request.msgType);
    query.push(`msgType=${msgType}`);
    if (msgType === 'html')
        query.push(`htmlHeight=${normalizeHtmlHeight(request.htmlHeight)}`);
    return query.join('&');
}
/**
 * 拼接 MeoW 推送 URL（GET 形式）。
 *
 * 三个路径段（nickname / title / message）经 toPathSegment 处理；
 * 查询参数 url / imgUrl 只做普通 encodeURIComponent（查询串允许 %2F）。
 */
export function buildMeowUrl(request, apiBase = DEFAULT_API_BASE) {
    const base = apiBase.trim().replace(/\/+$/, '');
    const title = isFilled(request.title) ? request.title.trim() : DEFAULT_TITLE;
    const nick = toPathSegment(request.nickname);
    const t = toPathSegment(title);
    const m = toPathSegment(request.message);
    return `${base}/${nick}/${t}/${m}?${buildParamQuery(request)}`;
}
/** 拼接 POST 目标 URL：/{昵称}/[title]，其余字段走 Body */
export function buildMeowPostUrl(request, apiBase = DEFAULT_API_BASE) {
    const base = apiBase.trim().replace(/\/+$/, '');
    const nick = toPathSegment(request.nickname);
    const path = isFilled(request.title)
        ? `${base}/${nick}/${toPathSegment(request.title.trim())}`
        : `${base}/${nick}`;
    return `${path}?${buildParamQuery(request)}`;
}
/** 构造 POST JSON 请求体（文档：title/msg/url/imgUrl 可放 Body，Body 优先） */
export function buildMeowBody(request) {
    const body = { msg: request.message };
    if (isFilled(request.title))
        body['title'] = request.title.trim();
    if (isFilled(request.url))
        body['url'] = request.url.trim();
    if (isFilled(request.imgUrl))
        body['imgUrl'] = request.imgUrl.trim();
    return body;
}
/**
 * 解析 MeoW 响应体。
 *
 * 文档形状：`{ "status": 200, "message": "推送成功" }`
 * 实测形状：`{ "status": 200, "data": true, "msg": "发送成功" }`
 * 因此同时接受 `message` 与 `msg`。
 */
export function parseServerResult(raw) {
    const trimmed = raw.trim();
    if (trimmed === '')
        return { text: '', parsed: false, raw: '' };
    try {
        const parsed = JSON.parse(trimmed);
        if (parsed === null || typeof parsed !== 'object') {
            return { text: truncate(trimmed), parsed: false, raw: truncate(trimmed) };
        }
        const table = parsed;
        const status = typeof table['status'] === 'number' ? table['status'] : undefined;
        let text = '';
        for (const key of ['message', 'msg']) {
            const candidate = table[key];
            if (typeof candidate === 'string' && candidate.trim() !== '') {
                text = candidate.trim();
                break;
            }
        }
        if (text === '' && typeof table['data'] === 'string')
            text = String(table['data']);
        return {
            // exactOptionalPropertyTypes 下不能把 undefined 赋给可选属性
            ...(status === undefined ? {} : { status }),
            text: truncate(text),
            parsed: true,
            raw: truncate(trimmed),
        };
    }
    catch {
        return { text: truncate(trimmed), parsed: false, raw: truncate(trimmed) };
    }
}
/** 把 MeoW 业务状态码翻译成分类与中文提示（状态码语义见文档「响应格式」） */
export function classifyBusinessStatus(status, text) {
    const detail = text === '' ? '' : `：${text}`;
    switch (status) {
        case 400:
            return {
                kind: 'http',
                message: `推送失败：MeoW 判定标题或消息参数错误（status 400）${detail}`,
            };
        case 403:
            return { kind: 'forbidden', message: `推送被拒绝：内容策略禁止发送（status 403）${detail}` };
        case 404:
            return {
                kind: 'nickname',
                message: `推送失败：MeoW 昵称未注册（status 404）${detail}。` +
                    `请检查配置中的 nickname 是否与 MeoW App 里的昵称完全一致。`,
            };
        case 429:
            return {
                kind: 'ratelimit',
                message: `推送被限流（status 429）${detail}。` +
                    `MeoW 对非会员的发送上限为 3 秒 1 条、每分钟 15 条、每小时 60 条（每天 1000 条）；` +
                    `请降低推送频率，或把 pushMode 改为 substantial / off。`,
            };
        case 500:
            return {
                kind: 'server',
                message: `推送失败：MeoW 服务器错误（status 500）${detail}，请稍后重试。`,
            };
        default:
            return { kind: 'server', message: `推送失败：MeoW 返回未知业务状态 ${status}${detail}` };
    }
}
/** 读取「上层信号是否已取消」。
 *
 * 必须包一层函数：`AbortSignal.aborted` 是 getter，运行时可变，
 * 但 TS 的控制流分析会把它当普通只读属性窄化，导致 catch 里的重检被报 TS2367。 */
function isAborted(signal) {
    return signal !== undefined && signal.aborted === true;
}
/**
 * 组合「上层取消信号」与「内部超时信号」。
 * 优先 AbortSignal.any（Node 20.3+）；不可用时退化为手工桥接。
 */
function mergeSignals(outer, timeoutMs) {
    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(new Error('meow push timeout')), timeoutMs);
    const timeoutSignal = timeoutController.signal;
    timer.unref?.();
    if (outer === undefined) {
        return { signal: timeoutSignal, timedOut: () => timeoutSignal.aborted };
    }
    const anyFn = AbortSignal.any;
    if (typeof anyFn === 'function') {
        return {
            signal: anyFn.call(AbortSignal, [outer, timeoutSignal]),
            timedOut: () => timeoutSignal.aborted && !outer.aborted,
        };
    }
    const controller = new AbortController();
    const onOuterAbort = () => controller.abort(outer.reason);
    const onTimeoutAbort = () => controller.abort(timeoutSignal.reason);
    if (outer.aborted)
        controller.abort(outer.reason);
    else
        outer.addEventListener('abort', onOuterAbort, { once: true });
    if (timeoutSignal.aborted)
        controller.abort(timeoutSignal.reason);
    else
        timeoutSignal.addEventListener('abort', onTimeoutAbort, { once: true });
    return { signal: controller.signal, timedOut: () => timeoutSignal.aborted && !outer.aborted };
}
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
export async function pushToMeow(request, options = {}) {
    const apiBase = options.apiBase ?? DEFAULT_API_BASE;
    const method = options.method === 'POST' ? 'POST' : 'GET';
    const timeoutMs = options.timeout ?? DEFAULT_TIMEOUT_MS;
    const outer = options.signal;
    // ── 0. 本地参数校验：不满足就不发请求 ──────────────────────────
    const message = typeof request.message === 'string' ? request.message.trim() : '';
    if (message === '') {
        return { ok: false, kind: 'invalid', message: '推送失败：message 不能为空。' };
    }
    if (!isFilled(request.nickname)) {
        return { ok: false, kind: 'invalid', message: '推送失败：MeoW 昵称为空，请检查插件配置 nickname。' };
    }
    const normalized = {
        ...request,
        message,
        msgType: normalizeMsgType(request.msgType),
        htmlHeight: normalizeHtmlHeight(request.htmlHeight),
    };
    const url = method === 'POST' ? buildMeowPostUrl(normalized, apiBase) : buildMeowUrl(normalized, apiBase);
    // ── 1. 进入前就被取消 ─────────────────────────────────────────
    if (isAborted(outer)) {
        return { ok: false, kind: 'aborted', message: '推送已取消：调用方在请求前中止了操作。', url };
    }
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
        return {
            ok: false,
            kind: 'network',
            message: '推送失败：当前运行环境没有可用的 fetch（需要 Node 20.6+ 或提供 fetchImpl）。',
            url,
        };
    }
    const { signal, timedOut } = mergeSignals(outer, timeoutMs);
    const init = method === 'POST'
        ? {
            method,
            signal,
            redirect: 'follow',
            headers: { accept: 'application/json', 'content-type': 'application/json' },
            body: JSON.stringify(buildMeowBody(normalized)),
        }
        : {
            method,
            signal,
            redirect: 'follow',
            headers: { accept: 'application/json, text/plain, */*' },
        };
    try {
        const response = await fetchImpl(url, init);
        const raw = await response.text().catch(() => '');
        const result = parseServerResult(raw);
        // ── 2. HTTP 层：文档规定 HTTP 状态统一为 200，非 2xx 属异常 ────
        if (!response.ok)
            throw new PushHttpError(response.status, result.text || result.raw);
        // ── 3. 业务层：以 JSON 的 status 为准 ────────────────────────
        if (result.status !== undefined && result.status !== 200) {
            const classified = classifyBusinessStatus(result.status, result.text);
            return {
                ok: false,
                kind: classified.kind,
                message: classified.message,
                status: result.status,
                url,
                body: result.raw,
            };
        }
        return {
            ok: true,
            status: result.status ?? response.status,
            url,
            message: result.text === '' ? '推送成功' : result.text,
        };
    }
    catch (error) {
        // ── 4. 取消 / 超时 ──────────────────────────────────────────
        if (isAborted(outer)) {
            return { ok: false, kind: 'aborted', message: '推送已取消：调用方中止了操作。', url };
        }
        if (timedOut() || (error instanceof Error && error.name === 'TimeoutError')) {
            return {
                ok: false,
                kind: 'timeout',
                message: `推送超时：MeoW 在 ${timeoutMs}ms 内未响应，请检查网络或调大配置 timeout。`,
                url,
            };
        }
        if (error instanceof Error && error.name === 'AbortError' && !timedOut()) {
            return { ok: false, kind: 'aborted', message: '推送已取消。', url };
        }
        // ── 5. HTTP 错误 ────────────────────────────────────────────
        if (error instanceof PushHttpError) {
            const detail = error.body === '' ? '' : `，返回：${error.body}`;
            const hint = error.status === 404
                ? '（404 通常表示昵称错误或该昵称未在 MeoW 注册）'
                : error.status >= 500
                    ? '（MeoW 服务端异常，可稍后重试）'
                    : '';
            return {
                ok: false,
                kind: 'http',
                message: `推送失败：MeoW 返回 HTTP ${error.status}${hint}${detail}`,
                status: error.status,
                url,
                body: error.body,
            };
        }
        // ── 6. 网络错误 ─────────────────────────────────────────────
        if (error instanceof TypeError) {
            return {
                ok: false,
                kind: 'network',
                message: `推送失败：无法连接 MeoW（${error.message}）。请检查网络、代理或 apiBase 配置。`,
                url,
            };
        }
        // ── 7. 兜底 ─────────────────────────────────────────────────
        return {
            ok: false,
            kind: 'unknown',
            message: `推送失败：发生未预期错误：${error instanceof Error ? error.message : String(error)}`,
            url,
        };
    }
}
/** 把推送结果格式化为给模型看的一行文本（含 emoji，便于一眼分辨成败） */
export function formatOutcome(outcome, title, message) {
    return outcome.ok ? `✅ 通知已推送到 MeoW：${title} - ${message}` : `❌ ${outcome.message}`;
}
//# sourceMappingURL=meow-api.js.map