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
import { registerAutoPush } from './auto-push.js';
import { ConfigError, DEFAULT_API_BASE, MEOW_NICKNAME_REQUIRED_MESSAGE, resolveConfig, } from './config.js';
import { DEFAULT_TITLE, formatOutcome, pushToMeow } from './meow-api.js';
import { assertInvariants, createInvariants, registerInvariants } from './invariant.js';
import { registerPromptSection } from './prompt.js';
import { SchemaBuilder } from './schema.js';
import { defineTool, text } from './tool.js';
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
export const Config = SchemaBuilder.object({
    nickname: SchemaBuilder.string()
        .description('必填：你的 MeoW 用户昵称（对应推送地址 http://api.chuckfang.com/{nickname}/... 的第一段）')
        // .volatile() 是设置页出现表单的硬性要求：dsh-settings 的 volatileForm()
        // 会剪掉所有未标 volatile 的字段，全被剪掉就等于设置页里看不到本插件。
        .volatile(),
    apiBase: SchemaBuilder.string()
        .description('可选：MeoW API 基础地址，默认 http://api.chuckfang.com')
        .default('http://api.chuckfang.com')
        .volatile(),
    timeout: SchemaBuilder.number()
        .description('可选：单次请求超时毫秒数，默认 10000，允许范围 100–120000')
        .default(10_000)
        .min(100)
        .max(120_000)
        .volatile(),
    throttleMs: SchemaBuilder.number()
        .description('可选：同一会话推送节流窗口毫秒数，默认 5000，设为 0 关闭节流')
        .default(5_000)
        .min(0)
        .max(120_000)
        .volatile(),
    pushMode: SchemaBuilder.string()
        .description('自动推送模式：every-turn = 每轮回答结束都推（宿主必推，不依赖模型）；'
        + 'substantial = 仅当本轮用过工具才推；off = 只保留手动')
        .default('every-turn')
        .enum(['every-turn', 'substantial', 'off'])
        .volatile(),
}).volatile();
/** 插件 ID / Cordis 插件名（与 npm 包名、仓库名保持全局统一） */
export const name = 'meow-push-bridge';
/** 依赖 tools 服务：缺少时 Cordis 不会激活本插件（而非半激活） */
export const inject = ['tools'];
/** 工具名 */
export const TOOL_NAME = 'meow_push_bridge';
/** 兜底日志：logger 不可用时回落到 console，保证「拒绝加载」绝不会静默 */
function log(ctx, level, message) {
    const sink = ctx.logger?.[level];
    if (typeof sink === 'function') {
        sink.call(ctx.logger, `[${name}] ${message}`);
        return;
    }
    const fallback = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
    fallback(`[${name}] ${message}`);
}
/** 判断是否为「无有效字段的普通对象」（用于 config 通道回退） */
function isEmptyTable(value) {
    return (value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Object.keys(value).length === 0);
}
/**
 * 节流簿键：优先会话/Agent id，其次工具调用 id，最后退化到全局键。
 *
 * 参数用 unknown 并在内部收窄，原因：DSH 的 ToolRunContext 是结构化类型，
 * exec 上一定有 signal，但 agent/callId 未必存在。若把形参声明为
 * `{ agent?; callId? }`，TS 会对传入的对象字面量做「多余属性检查」（TS2559），
 * 报 `{ signal } has no properties in common with ...`。
 */
function throttleKeyOf(exec) {
    if (exec === null || typeof exec !== 'object')
        return 'global';
    const table = exec;
    const agent = table.agent;
    if (agent !== null && typeof agent === 'object') {
        const id = agent.id;
        if (typeof id === 'string' && id !== '')
            return `agent:${id}`;
    }
    if (typeof table.callId === 'string' && table.callId !== '')
        return `call:${table.callId}`;
    return 'global';
}
// 节流簿放在模块作用域（而非 apply 闭包内），便于测试直接观察与重置。
const lastPushAt = new Map();
/** 清空节流簿（仅测试使用） */
export function resetThrottleState() {
    lastPushAt.clear();
}
/**
 * 同一会话的推送节流判定。
 *
 * 规则：键相同且距上次「成功推送」不足 windowMs → 拦截。
 * windowMs <= 0 表示关闭节流。
 */
export function checkThrottle(book, key, windowMs, now = Date.now()) {
    if (windowMs <= 0)
        return { blocked: false, retryInMs: 0 };
    const previous = book.get(key);
    if (previous === undefined)
        return { blocked: false, retryInMs: 0 };
    const elapsed = now - previous;
    if (elapsed >= windowMs)
        return { blocked: false, retryInMs: 0 };
    return { blocked: true, retryInMs: windowMs - elapsed };
}
/**
 * 插件入口。
 *
 * @param ctx      Cordis 上下文（已声明 inject: ['tools']）
 * @param injected Loader 直接传入的 config（部分 Cordis 版本走此通道）
 */
export function apply(ctx, injected) {
    // ── 1. 校验配置：nickname 必填 ───────────────────────────────────
    // 兼容两种传参形态：Cordis 约定 apply(ctx, config)，同时 config 会镜像到 ctx.config。
    // 显式传入的 config 优先；它是空对象时回退 ctx.config（避免空 patch 覆盖已挂载配置）。
    const rawConfig = injected !== undefined && !isEmptyTable(injected) ? injected : ctx.config;
    let config;
    try {
        const warn = (message) => log(ctx, 'warn', message);
        config = resolveConfig(rawConfig, warn);
    }
    catch (error) {
        if (error instanceof ConfigError) {
            // 刻意「不抛出」而是 return：
            //   抛出会让 Loader 显示插件加载失败（栈信息吓人且可能中断 profile 其余补丁）；
            //   return 让插件处于已加载但未注册任何工具的状态，错误提示清晰可读。
            log(ctx, 'error', `❌ 插件未启用：${MEOW_NICKNAME_REQUIRED_MESSAGE}`);
            log(ctx, 'error', `   配置位置：profile 的 cordis.patch.yml → insert → id: ${name} → config.nickname；修改后保存即可热重载。`);
            log(ctx, 'error', `   默认 API 地址：${DEFAULT_API_BASE}/{nickname}/{title}/{message}`);
            return;
        }
        // 非预期错误（探针本身出错）：同样拒绝注册，避免带病运行
        log(ctx, 'error', `❌ 插件未启用：配置解析失败：${String(error)}`);
        return;
    }
    // ── 2. 校验 tools 服务可用 ───────────────────────────────────────
    const tools = ctx.tools;
    if (tools === undefined || typeof tools.register !== 'function') {
        log(ctx, 'error', `❌ 插件未启用：tools 服务不可用（请检查 inject: ['tools'] 是否生效）。`);
        return;
    }
    // ── 4. 统一的发送函数（工具与自动推送共用）────────────────────────
    const sendPush = (title, message, url, signal) => pushToMeow({
        nickname: config.nickname,
        title,
        message,
        ...(url === undefined || url === '' ? {} : { url }),
    }, config.apiBase, signal === undefined ? { timeout: config.timeout } : { timeout: config.timeout, signal });
    // ── 5. 注册工具 ─────────────────────────────────────────────────
    const meowTool = defineTool({
        name: TOOL_NAME,
        description: `通过 MeoW API 向已配置的鸿蒙手机推送一条通知。message 必填；title 缺省为 "${DEFAULT_TITLE}"。`,
        parameters: {
            type: 'object',
            properties: {
                title: {
                    type: 'string',
                    description: `通知标题，可选，缺省为 "${DEFAULT_TITLE}"`,
                },
                message: {
                    type: 'string',
                    description: '通知正文（必填），例如「构建已完成，用时 42s」',
                },
                url: {
                    type: 'string',
                    description: '可选，点击通知后跳转的链接',
                },
            },
            required: ['message'],
            additionalProperties: false,
        },
        // 与 meow-api 的请求超时对齐，再留 2s 余量，避免被工具调度层先超时掐断
        timeoutMs: config.timeout + 2_000,
        isConcurrencySafe: () => true,
        output: {
            schema: { type: 'string', description: '推送结果的可读文本' },
            render: (_args, value) => text(value),
        },
        async execute(args, exec) {
            // (1) 调用前检查取消：DSH 可能已中止本次工具调用
            if (exec.signal.aborted) {
                return '⚠️ 推送已取消：调用在开始前被中止。';
            }
            // (2) 参数归一化与校验（message 必填）
            const message = typeof args?.message === 'string' ? args.message.trim() : '';
            if (message === '') {
                return '⚠️ 推送失败：message 不能为空。';
            }
            const title = typeof args?.title === 'string' && args.title.trim() !== ''
                ? args.title.trim()
                : DEFAULT_TITLE;
            const url = typeof args?.url === 'string' && args.url.trim() !== '' ? args.url.trim() : undefined;
            // (3) 节流：同一会话 throttleMs 内不重复推送
            const throttle = checkThrottle(lastPushAt, throttleKeyOf(exec), config.throttleMs);
            if (throttle.blocked) {
                return `⚠️ 推送已节流：同一会话在 ${config.throttleMs}ms 内只能推送一次，请 ${throttle.retryInMs}ms 后重试。`;
            }
            // (4) 发出请求：URL 构造 / 编码 / 超时 / 错误分类都在 meow-api.ts
            const outcome = await sendPush(title, message, url, exec.signal);
            // (5) 仅成功时记账，失败允许立即重试
            if (outcome.ok) {
                lastPushAt.set(throttleKeyOf(exec), Date.now());
            }
            else {
                log(ctx, 'warn', `推送未成功（${outcome.kind}）：${outcome.message}`);
            }
            return formatOutcome(outcome, title, message);
        },
    });
    // ── 4. 运行包自有不变式 + 尽力注册到宿主 ─────────────────────────
    // 说明：assertInvariants 是纯函数，无论宿主是否提供注册通道都会在加载期执行。
    const invariants = createInvariants({ pluginName: name, inject, definition: meowTool, config });
    const violations = assertInvariants(invariants);
    if (violations.length > 0) {
        for (const violation of violations) {
            log(ctx, 'error', `❌ 不变式不满足（${violation.id}）：${violation.message}`);
        }
        // 契约被破坏时不注册：宁可没有工具，也不要注册一个行为未知的工具
        log(ctx, 'error', `❌ 插件未启用：${violations.length} 条不变式未通过。`);
        return;
    }
    registerInvariants(ctx, invariants, (level, message) => log(ctx, level, message));
    // ── 5. 注册工具 ─────────────────────────────────────────────────
    // 注册工具。
    // 优先用 ctx.effect 包裹：Dispose / HMR 时自动注销，避免重载后重复注册。
    // 前提假设：Cordis 的 effect 会「同步执行」回调（其返回值即 Disposer）；
    // 若某版本行为不同（延迟执行或签名不符），回退为直接注册并显式保存 disposer。
    let registered = false;
    if (typeof ctx.effect === 'function') {
        try {
            ctx.effect(() => {
                const dispose = tools.register(meowTool);
                return dispose;
            }, `${name}:register`);
            registered = true;
        }
        catch (error) {
            log(ctx, 'warn', `ctx.effect 不可用（${String(error)}），改为直接注册工具。`);
        }
    }
    if (!registered) {
        tools.register(meowTool);
    }
    // ── 6. 注册「任务完成自动推送」提示词区段 ────────────────────────
    // 工具是被动的：模型必须主动调用才会推送。这里向系统提示注入使用约定。
    // 但**不能只靠它** —— 实测模型会忽略提示词，于是「部分环境不推」。
    registerPromptSection(ctx, (level, message) => log(ctx, level, message));
    // ── 7. 注册宿主侧自动推送（确定性，不依赖模型）────────────────────
    // 监听 agent/turn-stopping：轮次结束时由宿主直接推送，保证每轮都有。
    // 刻意**绕过工具级 5 秒节流**（否则「每轮必推」做不到），改为按轮次去重。
    const autoPush = registerAutoPush(ctx, {
        mode: config.pushMode,
        send: async (title, message) => {
            const outcome = await sendPush(title, message);
            if (outcome.ok)
                lastPushAt.set('global', Date.now());
            return outcome;
        },
    });
    if (autoPush.registered) {
        log(ctx, 'info', `自动推送已启用：模式 ${config.pushMode}。`);
    }
    else {
        log(ctx, 'info', `自动推送未启用（${autoPush.reason ?? 'unknown'}）；仍可让 Agent 主动调用工具。`);
    }
    log(ctx, 'info', `✅ 已启用：昵称 "${config.nickname}"，API ${config.apiBase}，超时 ${config.timeout}ms。`);
    log(ctx, 'info', `   已注册工具：${TOOL_NAME}（title / message 必填项见 schema）`);
}
export { ConfigError, resolveConfig } from './config.js';
//# sourceMappingURL=index.js.map