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
import { FIXED_REQUEST } from './config.js';
import { SCHEMASTERY_BRAND } from './schema.js';
/** 工具名常量在此重复声明，避免与 index.ts 形成循环依赖 */
export const EXPECTED_TOOL_NAME = 'meow_push_bridge';
export const EXPECTED_PLUGIN_ID = 'meow-push-bridge';
export const EXPECTED_INJECT = 'tools';
/** 从任意工具定义里安全读出 parameters（不存在则返回 undefined） */
function readParameters(definition) {
    if (definition === null || typeof definition !== 'object')
        return undefined;
    const parameters = definition.parameters;
    if (parameters === null || typeof parameters !== 'object' || Array.isArray(parameters)) {
        return undefined;
    }
    return parameters;
}
/**
 * 构建包自有不变式集合。
 *
 * @param input 加载期快照（插件名 / inject / 工具定义 / 已解析配置）
 */
export function createInvariants(input) {
    return [
        {
            id: 'meow-push-bridge/plugin-id',
            description: '插件 ID / Cordis 插件名必须与仓库名、npm 包名统一为 meow-push-bridge',
            check: () => input.pluginName === EXPECTED_PLUGIN_ID
                ? []
                : [
                    {
                        id: 'meow-push-bridge/plugin-id',
                        message: `插件名应为 "${EXPECTED_PLUGIN_ID}"，实际为 "${input.pluginName}"。`,
                    },
                ],
        },
        {
            id: 'meow-push-bridge/inject-tools',
            description: "插件必须声明 inject: ['tools']，否则 ctx.tools 不可用",
            check: () => input.inject.includes(EXPECTED_INJECT)
                ? []
                : [
                    {
                        id: 'meow-push-bridge/inject-tools',
                        message: `inject 必须包含 "${EXPECTED_INJECT}"，实际为 [${input.inject.join(', ')}]。`,
                    },
                ],
        },
        {
            id: 'meow-push-bridge/tool-name',
            description: `工具名必须是 ${EXPECTED_TOOL_NAME}`,
            check: () => {
                const actual = input.definition !== null && typeof input.definition === 'object'
                    ? input.definition.name
                    : undefined;
                return actual === EXPECTED_TOOL_NAME
                    ? []
                    : [
                        {
                            id: 'meow-push-bridge/tool-name',
                            message: `工具名应为 "${EXPECTED_TOOL_NAME}"，实际为 "${String(actual)}"。`,
                        },
                    ];
            },
        },
        {
            id: 'meow-push-bridge/schema-required-message',
            description: '工具 schema 必须把 message 标为 required，且 title/url 保持可选',
            check: () => {
                const parameters = readParameters(input.definition);
                if (parameters === undefined) {
                    return [
                        {
                            id: 'meow-push-bridge/schema-required-message',
                            message: '工具定义缺少 parameters 对象。',
                        },
                    ];
                }
                const required = parameters['required'];
                const requiredList = Array.isArray(required) ? required : [];
                if (!requiredList.includes('message')) {
                    return [
                        {
                            id: 'meow-push-bridge/schema-required-message',
                            message: 'parameters.required 必须包含 "message"。',
                        },
                    ];
                }
                for (const optionalField of ['title', 'url']) {
                    if (requiredList.includes(optionalField)) {
                        return [
                            {
                                id: 'meow-push-bridge/schema-required-message',
                                message: `parameters.required 不应包含可选字段 "${optionalField}"。`,
                            },
                        ];
                    }
                }
                return [];
            },
        },
        {
            id: 'meow-push-bridge/schema-no-nickname',
            description: 'nickname 必须来自插件配置，绝不能出现在工具入参 schema 里',
            check: () => {
                const parameters = readParameters(input.definition);
                if (parameters === undefined)
                    return []; // 由上一条不变式负责报错
                const properties = parameters['properties'];
                const hasNickname = properties !== null &&
                    typeof properties === 'object' &&
                    Object.prototype.hasOwnProperty.call(properties, 'nickname');
                return hasNickname
                    ? [
                        {
                            id: 'meow-push-bridge/schema-no-nickname',
                            message: '工具入参 schema 中出现 nickname：昵称必须来自插件配置而非工具参数。',
                        },
                    ]
                    : [];
            },
        },
        {
            id: 'meow-push-bridge/runtime-config',
            description: '运行时配置必须已被归一化：昵称非空，且固化的请求参数合法',
            check: () => {
                const violations = [];
                if (input.config.nickname.trim() === '') {
                    violations.push({
                        id: 'meow-push-bridge/runtime-config',
                        message: '运行时配置 nickname 为空。',
                    });
                }
                // 请求参数已固化（见 config.ts 的 FIXED_REQUEST），这里校验常量本身没被改坏
                if (!/^https?:\/\/[^/\s]+/i.test(FIXED_REQUEST.apiBase)) {
                    violations.push({
                        id: 'meow-push-bridge/runtime-config',
                        message: `固化的 apiBase 非法："${FIXED_REQUEST.apiBase}"。`,
                    });
                }
                if (!(FIXED_REQUEST.timeout > 0)) {
                    violations.push({
                        id: 'meow-push-bridge/runtime-config',
                        message: `固化的 timeout 必须为正数，实际为 ${FIXED_REQUEST.timeout}。`,
                    });
                }
                if (FIXED_REQUEST.method !== 'GET' && FIXED_REQUEST.method !== 'POST') {
                    violations.push({
                        id: 'meow-push-bridge/runtime-config',
                        message: `固化的 method 非法："${String(FIXED_REQUEST.method)}"。`,
                    });
                }
                return violations;
            },
        },
        {
            id: 'meow-push-bridge/config-schema-native',
            description: 'Config 必须能被宿主识别为原生 schemastery（否则设置页报「宿主未提供本插件的配置命名空间」）',
            check: () => {
                const schema = input.configSchema;
                if (schema === undefined)
                    return []; // 未提供则不检查（测试可省略）
                // 复刻 @deepseek-ai/dsh-app-boot 的 isNativeConfigSchema。
                // schema 是 unknown，先窄化成对象再反射读字段。
                if (schema === null || (typeof schema !== 'object' && typeof schema !== 'function')) {
                    return [
                        {
                            id: 'meow-push-bridge/config-schema-native',
                            message: 'Config 必须是对象。',
                        },
                    ];
                }
                const target = schema;
                const meta = Reflect.get(target, 'meta');
                const native = Reflect.get(target, SCHEMASTERY_BRAND) === true &&
                    typeof Reflect.get(target, 'type') === 'string' &&
                    meta !== null &&
                    typeof meta === 'object';
                if (native)
                    return [];
                return [
                    {
                        id: 'meow-push-bridge/config-schema-native',
                        message: 'Config 缺少 schemastery 品牌标记（Symbol.for("schemastery")）：' +
                            '宿主会把它判为 unsupported，设置页将显示「宿主未提供本插件的配置命名空间」。',
                    },
                ];
            },
        },
    ];
}
/**
 * 运行一组不变式。
 *
 * @returns 违规列表（空数组 = 全部通过）
 */
export function assertInvariants(invariants) {
    const violations = [];
    for (const invariant of invariants) {
        try {
            violations.push(...invariant.check());
        }
        catch (error) {
            violations.push({
                id: invariant.id,
                message: `不变式检查自身抛出异常：${error instanceof Error ? error.message : String(error)}`,
            });
        }
    }
    return violations;
}
/**
 * 便捷入口：按加载期快照构建并运行全部包自有不变式。
 */
export function assertInvariantsFor(input) {
    return assertInvariants(createInvariants(input));
}
/**
 * 安全读取宿主上下文上的一个可选成员。
 *
 * ⚠️ 必须用 try/catch：Cordis 的上下文对**未 inject 的服务属性**会直接抛错
 * （`Error: cannot get property "invariant" without inject`），
 * 而不是返回 undefined。曾经因为直接 `ctx.invariant` 探测，导致插件在
 * 用户填好昵称后整个加载失败（空昵称时提前 return，反而掩盖了这个 bug）。
 */
function safeGet(target, key) {
    if (target === null || typeof target !== 'object')
        return undefined;
    try {
        return target[key];
    }
    catch {
        return undefined;
    }
}
/**
 * 尽力把包自有不变式注册到宿主（多通道兼容，绝不抛错）。
 *
 * 说明：本文档无法确认 DSH 是否真的提供不变式注册入口（服务目录里没有它），
 * 因此这里只做「无害探测」：任一步失败都静默跳过。
 * 真正生效的是加载期显式调用的 `assertInvariants`。
 */
export function registerInvariants(ctx, invariants, log = () => { }) {
    if (ctx === null || typeof ctx !== 'object')
        return { registered: false, channel: 'none' };
    // 通道 1：ctx.invariant(invariants)
    const invariant = safeGet(ctx, 'invariant');
    if (typeof invariant === 'function') {
        try {
            ;
            invariant.call(ctx, invariants);
            log('info', `已通过 ctx.invariant 注册 ${invariants.length} 条不变式。`);
            return { registered: true, channel: 'ctx.invariant' };
        }
        catch {
            // 静默跳过：注册通道不可用不应影响插件加载
        }
    }
    // 通道 2 / 3：ctx.invariants.register / ctx.invariant.register
    for (const [key, channel] of [
        ['invariants', 'ctx.invariants.register'],
        ['invariant', 'ctx.invariant.register'],
    ]) {
        const candidate = safeGet(ctx, key);
        if (candidate !== null && typeof candidate === 'object') {
            const register = safeGet(candidate, 'register');
            if (typeof register === 'function') {
                try {
                    ;
                    register.call(candidate, invariants);
                    log('info', `已通过 ${channel} 注册 ${invariants.length} 条不变式。`);
                    return { registered: true, channel };
                }
                catch {
                    // 同上，静默跳过
                }
            }
        }
    }
    // 全部通道不可用：正常情况，不算错误 —— assertInvariants 已在加载期执行
    log('info', '宿主未提供不变式注册通道，已跳过注册（加载期检查仍会执行）。');
    return { registered: false, channel: 'none' };
}
//# sourceMappingURL=invariant.js.map