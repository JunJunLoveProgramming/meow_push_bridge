/**
 * meow-push-bridge / MeoW Push Bridge (喵桥)
 * src/config.ts —— 插件配置定义、归一化与校验
 *
 * 设计约束：本文件只使用「可擦除 TypeScript 语法」（无 enum / 无构造器参数属性 /
 * 无 namespace），因此 Node 22+ 可以直接 `--experimental-strip-types` 运行，
 * 测试无需引入 vitest、tsx 等额外依赖。
 */
import { DEFAULT_PUSH_MODE, normalizePushMode } from './auto-push.js';
/** MeoW 昵称缺失时使用的错误码（供测试与用户排查引用） */
export const MEOW_NICKNAME_REQUIRED = 'MEOW_NICKNAME_REQUIRED';
/** 面向用户的中文错误提示：说明哪里填、填完怎么生效 */
export const MEOW_NICKNAME_REQUIRED_MESSAGE = 'MeoW 昵称未配置，请在 cordis.patch.yml 中填写 nickname 字段后重载插件。';
/** MeoW API 默认基础地址 */
export const DEFAULT_API_BASE = 'http://api.chuckfang.com';
/** 默认请求超时（毫秒） */
export const DEFAULT_TIMEOUT_MS = 10_000;
/** 默认同一会话推送节流窗口（毫秒） */
export const DEFAULT_THROTTLE_MS = 5_000;
/** 允许的超时上下界，避免误配导致插件永久挂起或立刻超时 */
export const MIN_TIMEOUT_MS = 100;
export const MAX_TIMEOUT_MS = 120_000;
/**
 * 配置校验失败。带有稳定 code 与中文 message，插件据此拒绝注册工具。
 */
export class ConfigError extends Error {
    code;
    field;
    constructor(code, field, message) {
        super(message);
        this.name = 'ConfigError';
        this.code = code;
        this.field = field;
    }
}
/** 判断一个未知值是否为「非空字符串」 */
function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}
/** 配置中出现 ${...} 占位符时提示（YAML 不会展开环境变量） */
function looksLikeTemplate(value) {
    return /\$\{[^}]*\}/.test(value);
}
/**
 * 校验并归一化插件配置。
 *
 * - nickname 缺失 / 空白 → 抛 ConfigError(MEOW_NICKNAME_REQUIRED)
 * - apiBase / timeout / throttleMs 非法 → 回退默认值，并通过 warn 提示（不阻断加载）
 *
 * @param raw   Loader 传入的原始配置（可能为 undefined 或任意类型）
 * @param warn  可选的非致命问题回调
 */
export function resolveConfig(raw, warn) {
    const table = raw !== null && typeof raw === 'object' ? raw : {};
    // ── 1. nickname：必填，缺失即拒绝加载 ──────────────────────────────
    const nicknameRaw = table['nickname'];
    if (!isNonEmptyString(nicknameRaw)) {
        throw new ConfigError(MEOW_NICKNAME_REQUIRED, 'nickname', MEOW_NICKNAME_REQUIRED_MESSAGE);
    }
    const nickname = nicknameRaw.trim();
    if (looksLikeTemplate(nickname)) {
        // 常见误区：以为 YAML 会自动展开环境变量。这里给出明确警告。
        warn?.(`nickname 看起来包含未展开的占位符 "${nickname}"：cordis.patch.yml 不会展开环境变量，请填写字面量昵称。`);
    }
    // ── 2. apiBase：可选，非法值回退默认 ──────────────────────────────
    let apiBase = DEFAULT_API_BASE;
    const apiBaseRaw = table['apiBase'];
    if (apiBaseRaw !== undefined && apiBaseRaw !== null && apiBaseRaw !== '') {
        if (!isNonEmptyString(apiBaseRaw)) {
            warn?.(`apiBase 不是有效字符串，已回退默认值 ${DEFAULT_API_BASE}。`);
        }
        else {
            const candidate = apiBaseRaw.trim().replace(/\/+$/, ''); // 去掉尾部斜杠，避免拼出双斜杠
            if (!/^https?:\/\/[^/\s]+/i.test(candidate)) {
                warn?.(`apiBase "${candidate}" 不是合法的 http(s) 地址，已回退默认值 ${DEFAULT_API_BASE}。`);
            }
            else {
                apiBase = candidate;
            }
        }
    }
    // ── 3. timeout / throttleMs：可选数字，非法值回退默认 ──────────────
    const timeout = readNumber(table['timeout'], 'timeout', DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS, warn);
    const throttleMs = readNumber(table['throttleMs'], 'throttleMs', DEFAULT_THROTTLE_MS, 0, MAX_TIMEOUT_MS, warn);
    // ── 4. pushMode：可选枚举，非法值回退默认并提示 ──────────────────
    const pushModeRaw = table['pushMode'];
    let pushMode = DEFAULT_PUSH_MODE;
    if (pushModeRaw !== undefined && pushModeRaw !== null && pushModeRaw !== '') {
        const normalized = normalizePushMode(pushModeRaw);
        if (normalized !== pushModeRaw) {
            warn?.(`pushMode "${String(pushModeRaw)}" 不是有效取值（可选 every-turn / substantial / off），已回退默认值 ${DEFAULT_PUSH_MODE}。`);
        }
        pushMode = normalized;
    }
    return { nickname, apiBase, timeout, throttleMs, pushMode };
}
/** 读取并夹取数字配置项 */
function readNumber(value, field, fallback, min, max, warn) {
    if (value === undefined || value === null || value === '')
        return fallback;
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed)) {
        warn?.(`${field} "${String(value)}" 不是有效数字，已回退默认值 ${fallback}。`);
        return fallback;
    }
    if (parsed < min || parsed > max) {
        warn?.(`${field} ${parsed} 超出允许范围 [${min}, ${max}]，已回退默认值 ${fallback}。`);
        return fallback;
    }
    return Math.trunc(parsed);
}
//# sourceMappingURL=config.js.map