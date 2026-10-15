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
import { DEFAULT_API_BASE, DEFAULT_TIMEOUT_MS, } from './meow-api.js';
export { DEFAULT_API_BASE, DEFAULT_TIMEOUT_MS };
/** MeoW 昵称缺失时使用的错误码（供测试与用户排查引用） */
export const MEOW_NICKNAME_REQUIRED = 'MEOW_NICKNAME_REQUIRED';
/** 面向用户的中文错误提示：说明哪里填、填完怎么生效 */
export const MEOW_NICKNAME_REQUIRED_MESSAGE = 'MeoW 昵称未配置，请在设置页的「喵桥」里填写昵称，或修改 cordis.patch.yml 后重载插件。';
/** 固化在代码里的请求参数（不作为配置项暴露） */
export const FIXED_REQUEST = {
    /** 官方推荐的 HTTPS 地址 */
    apiBase: DEFAULT_API_BASE,
    /**
     * 请求方法固定为 POST。
     * 原因：推送正文是**对话总结**（用户提问 + 模型回复），长度可达数百字；
     * 用 GET 会把内容塞进 URL 路径，既受长度限制、编码也更脆。
     * POST 把内容放 JSON Body，是官方文档明确支持的形式。
     */
    method: 'POST',
    /** 请求超时（毫秒） */
    timeout: DEFAULT_TIMEOUT_MS,
    /** 消息显示类型 */
    msgType: 'text',
    /** HTML 显示高度（仅 msgType=html 时才有意义，此处保留常量备用） */
    htmlHeight: 200,
};
/** 固化的同会话节流窗口（毫秒） */
export const FIXED_THROTTLE_MS = 5_000;
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
/** 曾经可配置、现已固化的字段名（用于给旧配置一次提示） */
const REMOVED_KEYS = [
    'apiBase',
    'method',
    'timeout',
    'throttleMs',
    'pushMode',
    'msgType',
    'htmlHeight',
    'imgUrl',
];
/**
 * 校验并归一化插件配置。
 *
 * - nickname 缺失 / 空白 → 抛 ConfigError(MEOW_NICKNAME_REQUIRED)
 * - 旧配置里残留的已移除字段会被忽略，并给出一次 warn（方便平滑升级）
 *
 * @param raw   Loader 传入的原始配置（可能为 undefined 或任意类型）
 * @param warn  可选的非致命问题回调
 */
export function resolveConfig(raw, warn) {
    const table = raw !== null && typeof raw === 'object' ? raw : {};
    const nicknameRaw = table['nickname'];
    if (!isNonEmptyString(nicknameRaw)) {
        throw new ConfigError(MEOW_NICKNAME_REQUIRED, 'nickname', MEOW_NICKNAME_REQUIRED_MESSAGE);
    }
    const nickname = nicknameRaw.trim();
    if (looksLikeTemplate(nickname)) {
        warn?.(`nickname 看起来包含未展开的占位符 "${nickname}"：cordis.patch.yml 不会展开环境变量，请填写字面量昵称。`);
    }
    // 官方文档明确要求昵称不允许包含斜杠（否则会触发路径编码 400）
    if (nickname.includes('/')) {
        warn?.('nickname 含斜杠：MeoW 文档要求昵称不允许包含斜杠，推送时斜杠会被替换为全角 ／。');
    }
    // 旧配置里的已移除字段：提示一次，避免用户以为它们还有效
    const stillPresent = REMOVED_KEYS.filter((key) => table[key] !== undefined);
    if (stillPresent.length > 0) {
        warn?.(`配置中的 ${stillPresent.join(' / ')} 已不再是可配置项（插件已按官方推荐值固化）：` +
            '这些值会被忽略，可以从配置文件中删除。');
    }
    return { nickname };
}
//# sourceMappingURL=config.js.map