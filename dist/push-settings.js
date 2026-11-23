/**
 * dsh-junjun-transit / 骏骏通知中转
 * src/push-settings.ts —— 推送通道状态与 SMTP 设置的宿主存储/路由
 *
 * 设计：
 *   - MeoW / SMTP 各自独立启用：配好一个就跑一个，两个都配好就同时发；
 *   - 状态由配置推断：MeoW 看昵称，SMTP 看服务器/发件人/收件人；
 *   - SMTP 凭据存 credentials，不写 profile；GET 永不回传密码。
 */
import { isBarkConfigured, publicBarkConfig, sendBark, validateBarkConfig, } from './bark.js';
import { CREDENTIAL_REF, DEFAULT_CATEGORY, DEFAULT_ICON_URL, THEME_CREDENTIAL_REF, getEffectiveTheme, openExternal, readStoredTheme, resetMemberAuthState, saveTheme, } from './member-auth.js';
import { DEFAULT_TITLE, pushToMeow } from './meow-api.js';
import { FIXED_REQUEST } from './config.js';
import { publicSmtpConfig, sendSmtpMail, validateSmtpConfig, } from './smtp.js';
const PUSH_CREDENTIAL_REF = 'DSH_JUNJUN_TRANSIT_PUSH_SETTINGS';
const LEGACY_PUSH_CREDENTIAL_REF = 'MEOW_PUSH_BRIDGE_PUSH_SETTINGS';
const ROUTE_PREFIX = '/dsh-junjun-transit-api';
const SPONSOR_URL = 'https://www.junjunloveprogramming.cn/1794977129986';
const MAX_BODY_BYTES = 32 * 1024;
const DEFAULT_SMTP = {
    host: '',
    port: 587,
    encryption: 'starttls',
    username: '',
    password: '',
    fromEmail: '',
    fromName: '骏骏通知中转',
    toEmail: '',
};
const DEFAULT_BARK = {
    token: '',
    sender: '骏骏通知中转',
    title: '',
    icon: '',
};
// 凭证服务不可用时的内存回退
let memory = null;
/** 仅测试使用：清空内存缓存，强制从 credentials 重新读取 */
export function resetPushPreferencesState() {
    memory = null;
}
function readService(ctx, key) {
    if (typeof ctx.get !== 'function')
        return undefined;
    try {
        return ctx.get(key);
    }
    catch {
        return undefined;
    }
}
function isRecord(value) {
    return value !== null && typeof value === 'object';
}
/** SMTP 是否已配置到可发送状态 */
export function isSmtpConfigured(smtp) {
    return smtp.host.trim() !== '' && smtp.fromEmail.trim() !== '' && smtp.toEmail.trim() !== '';
}
/** MeoW 是否已配置（昵称非空） */
export function meowStatusFromNickname(nickname) {
    const value = nickname.trim();
    return value === ''
        ? { configured: false, detail: '未填写 MeoW 昵称' }
        : { configured: true, detail: `已填写昵称「${value}」` };
}
/** 从宿主 config 读取 MeoW 状态（路由的默认实现） */
export function getMeowStatus(ctx) {
    const table = isRecord(ctx.config) ? ctx.config : {};
    const raw = table['nickname'];
    return meowStatusFromNickname(typeof raw === 'string' ? raw : '');
}
/** SMTP 状态（不包含密码） */
export function getSmtpStatus(smtp) {
    return isSmtpConfigured(smtp)
        ? { configured: true, detail: `已配置：${smtp.host} → ${smtp.toEmail}` }
        : { configured: false, detail: '未填写 SMTP 服务器或收件人' };
}
/** Bark 状态（不包含 token） */
export function getBarkStatus(bark) {
    return isBarkConfigured(bark)
        ? { configured: true, detail: '已填写 Bark token' }
        : { configured: false, detail: '未填写 Bark token' };
}
/** 读取推送设置；损坏/缺失时回退默认值 */
export async function loadPushPreferences(ctx) {
    if (memory !== null)
        return memory;
    const credentials = readService(ctx, 'credentials');
    if (credentials !== undefined) {
        for (const ref of [PUSH_CREDENTIAL_REF, LEGACY_PUSH_CREDENTIAL_REF]) {
            try {
                const resolved = await credentials.resolve(ref);
                if (resolved !== undefined && resolved.value !== '') {
                    const parsed = JSON.parse(resolved.value);
                    if (isRecord(parsed)) {
                        const checked = validateSmtpConfig(parsed['smtp']);
                        const bark = validateBarkConfig(parsed['bark']);
                        const smtp = checked.ok ? checked.config : { ...DEFAULT_SMTP };
                        const barkConfig = bark.ok ? bark.config : { ...DEFAULT_BARK };
                        // 旧品牌名迁移
                        if (smtp.fromName === 'MeoW Push Bridge')
                            smtp.fromName = '骏骏通知中转';
                        if (barkConfig.sender === 'MeoW Push Bridge')
                            barkConfig.sender = '骏骏通知中转';
                        memory = { smtp, bark: barkConfig };
                        if (ref === LEGACY_PUSH_CREDENTIAL_REF) {
                            try {
                                await credentials.set(PUSH_CREDENTIAL_REF, JSON.stringify(memory));
                                if (typeof credentials.unset === 'function') {
                                    await credentials.unset(LEGACY_PUSH_CREDENTIAL_REF);
                                }
                            }
                            catch {
                                // 迁移失败仍返回旧设置
                            }
                        }
                        return memory;
                    }
                }
            }
            catch {
                // 继续尝试下一个引用
            }
        }
    }
    memory = { smtp: { ...DEFAULT_SMTP }, bark: { ...DEFAULT_BARK } };
    return memory;
}
/** 供发送端读取 SMTP 配置（含密码，仅内存使用） */
export async function getSmtpConfig(ctx) {
    return (await loadPushPreferences(ctx)).smtp;
}
/** 供发送端读取 Bark 配置（含 token，仅内存使用） */
export async function getBarkConfig(ctx) {
    return (await loadPushPreferences(ctx)).bark;
}
/**
 * 保存设置。
 * - 只保存 SMTP；MeoW 由昵称是否填写自动判定；
 * - 密码字段为空表示「保持原密码」，`clearPassword: true` 才会清空。
 */
export async function savePushPreferences(ctx, input) {
    if (!isRecord(input))
        return { ok: false, error: '请求格式错误' };
    const current = await loadPushPreferences(ctx);
    let smtp = current.smtp;
    if (input['smtp'] !== undefined) {
        if (!isRecord(input['smtp']))
            return { ok: false, error: 'SMTP 配置格式错误' };
        if (input['smtp']['clear'] === true) {
            smtp = { ...DEFAULT_SMTP };
        }
        else {
            const smtpInput = { ...input['smtp'] };
            const password = smtpInput['password'];
            if (smtpInput['clearPassword'] === true) {
                smtpInput['password'] = '';
            }
            else if (typeof password !== 'string' || password === '') {
                smtpInput['password'] = current.smtp.password;
            }
            delete smtpInput['clearPassword'];
            const checked = validateSmtpConfig(smtpInput);
            if (!checked.ok)
                return { ok: false, error: checked.error };
            smtp = checked.config;
        }
    }
    let bark = current.bark;
    if (input['bark'] !== undefined) {
        if (!isRecord(input['bark']))
            return { ok: false, error: 'Bark 配置格式错误' };
        if (input['bark']['clear'] === true) {
            bark = { ...DEFAULT_BARK };
        }
        else {
            const barkInput = { ...input['bark'] };
            const token = barkInput['token'];
            if (barkInput['clearToken'] === true) {
                barkInput['token'] = '';
            }
            else if (typeof token !== 'string' || token === '') {
                barkInput['token'] = current.bark.token;
            }
            delete barkInput['clearToken'];
            const checked = validateBarkConfig(barkInput);
            if (!checked.ok)
                return { ok: false, error: checked.error };
            bark = checked.config;
        }
    }
    memory = { smtp, bark };
    const credentials = readService(ctx, 'credentials');
    if (credentials !== undefined) {
        try {
            await credentials.set(PUSH_CREDENTIAL_REF, JSON.stringify(memory));
        }
        catch {
            // 内存已更新
        }
    }
    return { ok: true, preferences: memory };
}
/** 前端可见的公开形态（无密码，含红绿灯状态） */
export function publicPreferences(preferences, meow) {
    return {
        ok: true,
        meow,
        smtp: {
            ...publicSmtpConfig(preferences.smtp),
            status: getSmtpStatus(preferences.smtp),
        },
        bark: {
            ...publicBarkConfig(preferences.bark),
            status: getBarkStatus(preferences.bark),
        },
    };
}
function json(res, status, payload) {
    if (res.headersSent)
        return;
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
    });
    res.end(JSON.stringify(payload));
}
async function readBody(req) {
    const request = req;
    // 有些宿主版本把请求体解析好后以普通对象传给 handler，而不是 IncomingMessage
    for (const key of ['body', 'payload', 'data', 'rawBody']) {
        const value = request[key];
        if (value === undefined || value === null)
            continue;
        if (typeof value === 'string')
            return value;
        if (Buffer.isBuffer(value))
            return value.toString('utf8');
        if (value instanceof Uint8Array)
            return Buffer.from(value).toString('utf8');
        if (typeof value === 'object')
            return JSON.stringify(value);
        return String(value);
    }
    if (typeof request.json === 'function') {
        try {
            return JSON.stringify(await request.json());
        }
        catch {
            return '';
        }
    }
    if (typeof request.text === 'function') {
        try {
            return await request.text();
        }
        catch {
            return '';
        }
    }
    if (typeof request.on !== 'function')
        return '';
    const on = request.on.bind(request);
    return new Promise((resolve, reject) => {
        let size = 0;
        let body = '';
        on('data', (chunk) => {
            size += Buffer.byteLength(String(chunk));
            if (size > MAX_BODY_BYTES) {
                reject(new Error('请求体过大'));
                return;
            }
            body += String(chunk);
        });
        on('end', () => resolve(body));
        on('error', (error) => reject(error instanceof Error ? error : new Error(String(error))));
    });
}
function registerRoutes(ctx, log, meowProvider, nicknameProvider, disposers) {
    const web = readService(ctx, 'webServer');
    if (web === undefined || typeof web.register !== 'function')
        return false;
    const meowStatus = () => (meowProvider === undefined ? getMeowStatus(ctx) : meowProvider());
    const meowNickname = () => {
        if (nicknameProvider !== undefined)
            return nicknameProvider().trim();
        const table = isRecord(ctx.config) ? ctx.config : {};
        return typeof table['nickname'] === 'string' ? table['nickname'].trim() : '';
    };
    const track = (route) => {
        const wrapped = {
            ...route,
            handler: async (req, res) => {
                try {
                    await route.handler(req, res);
                }
                catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    log('error', `推送路由 ${route.path} 异常：${message}`);
                    if (res.headersSent) {
                        res.destroy();
                        return;
                    }
                    json(res, 500, { ok: false, error: `推送接口内部错误：${message}` });
                }
            },
        };
        const dispose = web.register(wrapped);
        if (typeof dispose === 'function')
            disposers.push(dispose);
    };
    track({
        kind: 'exact',
        path: `${ROUTE_PREFIX}/push/config`,
        handler: async (req, res) => {
            const method = String(req.method ?? 'GET').toUpperCase();
            const headers = req.headers ?? {};
            if (String(headers['x-mpb-client'] ?? '') !== '1') {
                json(res, 403, { ok: false, error: 'forbidden' });
                return;
            }
            if (method === 'GET') {
                json(res, 200, publicPreferences(await loadPushPreferences(ctx), meowStatus()));
                return;
            }
            if (method === 'POST') {
                let parsed;
                try {
                    parsed = JSON.parse(await readBody(req));
                }
                catch {
                    json(res, 422, { ok: false, error: 'JSON 解析失败' });
                    return;
                }
                const saved = await savePushPreferences(ctx, parsed);
                if (!saved.ok || saved.preferences === undefined) {
                    json(res, 422, { ok: false, error: saved.error ?? '保存失败' });
                    return;
                }
                log('info', '推送通道设置已更新。');
                json(res, 200, publicPreferences(saved.preferences, meowStatus()));
                return;
            }
            json(res, 405, { ok: false, error: 'method not allowed' });
        },
    });
    track({
        kind: 'exact',
        path: `${ROUTE_PREFIX}/push/test`,
        handler: async (req, res) => {
            const method = String(req.method ?? 'GET').toUpperCase();
            const headers = req.headers ?? {};
            if (method !== 'POST' || String(headers['x-mpb-client'] ?? '') !== '1') {
                json(res, 403, { ok: false, error: 'forbidden' });
                return;
            }
            let channel = 'smtp';
            try {
                const raw = await readBody(req);
                if (raw !== '') {
                    const parsed = JSON.parse(raw);
                    if (isRecord(parsed)) {
                        if (parsed['channel'] === 'bark')
                            channel = 'bark';
                        else if (parsed['channel'] === 'meow')
                            channel = 'meow';
                    }
                }
            }
            catch {
                // 测试接口不因请求体异常而失败，按默认 SMTP 处理
            }
            const preferences = await loadPushPreferences(ctx);
            if (channel === 'meow') {
                try {
                    const nickname = meowNickname();
                    if (nickname === '') {
                        json(res, 422, { ok: false, error: '请先填写并保存 MeoW 昵称' });
                        return;
                    }
                    const theme = await getEffectiveTheme(ctx);
                    const result = await pushToMeow({
                        nickname,
                        title: theme.title === '' ? DEFAULT_TITLE : theme.title,
                        message: `这是一条来自骏骏通知中转的 MeoW 测试消息。\n时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`,
                        imgUrl: theme.imgUrl,
                        category: theme.category,
                        msgType: FIXED_REQUEST.msgType,
                        htmlHeight: FIXED_REQUEST.htmlHeight,
                    }, {
                        apiBase: FIXED_REQUEST.apiBase,
                        method: FIXED_REQUEST.method,
                        timeout: FIXED_REQUEST.timeout,
                    });
                    if (!result.ok) {
                        json(res, 502, { ok: false, error: result.message });
                        return;
                    }
                }
                catch (error) {
                    json(res, 500, { ok: false, error: `MeoW 测试异常：${String(error)}` });
                    return;
                }
                log('info', 'MeoW 测试消息已发送。');
                json(res, 200, { ok: true, channel: 'meow' });
                return;
            }
            if (channel === 'bark') {
                if (!isBarkConfigured(preferences.bark)) {
                    json(res, 422, { ok: false, error: '请先填写并保存 Bark token' });
                    return;
                }
                const theme = await getEffectiveTheme(ctx);
                const result = await sendBark(preferences.bark, {
                    title: theme.title,
                    text: `这是一条来自骏骏通知中转的 Bark 测试消息。\n时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`,
                    icon: theme.imgUrl,
                });
                if (!result.ok) {
                    json(res, 502, { ok: false, error: result.error ?? '发送失败' });
                    return;
                }
                log('info', 'Bark 测试消息已发送。');
                json(res, 200, { ok: true, channel: 'bark' });
                return;
            }
            if (!isSmtpConfigured(preferences.smtp)) {
                json(res, 422, { ok: false, error: '请先填写并保存 SMTP 服务器与收件人邮箱' });
                return;
            }
            const result = await sendSmtpMail(preferences.smtp, {
                subject: '骏骏通知中转 · SMTP 测试',
                text: [
                    '这是一封来自骏骏通知中转的测试邮件。',
                    '',
                    '如果你收到它，说明 SMTP 推送通道已经配置成功。',
                    `时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`,
                ].join('\n'),
            });
            if (!result.ok) {
                json(res, 502, { ok: false, error: result.error ?? '发送失败' });
                return;
            }
            log('info', `SMTP 测试邮件已发送：${result.server ?? ''}`);
            json(res, 200, { ok: true, channel: 'smtp', server: result.server ?? '' });
        },
    });
    track({
        kind: 'exact',
        path: `${ROUTE_PREFIX}/theme`,
        handler: async (req, res) => {
            const method = String(req.method ?? 'GET').toUpperCase();
            const headers = req.headers ?? {};
            if (String(headers['x-mpb-client'] ?? '') !== '1') {
                json(res, 403, { ok: false, error: 'forbidden' });
                return;
            }
            if (method === 'GET') {
                const theme = await readStoredTheme(ctx);
                json(res, 200, {
                    ok: true,
                    theme: theme === null
                        ? { nickname: '', title: '', imgUrl: DEFAULT_ICON_URL, category: DEFAULT_CATEGORY }
                        : theme,
                });
                return;
            }
            if (method === 'POST') {
                let parsed;
                try {
                    parsed = JSON.parse(await readBody(req));
                }
                catch {
                    json(res, 422, { ok: false, error: 'JSON 解析失败' });
                    return;
                }
                const saved = await saveTheme(ctx, parsed);
                json(res, saved.ok ? 200 : 422, saved);
                return;
            }
            json(res, 405, { ok: false, error: 'method not allowed' });
        },
    });
    track({
        kind: 'exact',
        path: `${ROUTE_PREFIX}/sponsor`,
        handler: async (req, res) => {
            const method = String(req.method ?? 'GET').toUpperCase();
            const headers = req.headers ?? {};
            if (method !== 'POST' || String(headers['x-mpb-client'] ?? '') !== '1') {
                json(res, 403, { ok: false, error: 'forbidden' });
                return;
            }
            const opened = await openExternal(ctx, SPONSOR_URL);
            if (!opened) {
                json(res, 502, { ok: false, error: '未能打开默认浏览器，请手动访问：' + SPONSOR_URL });
                return;
            }
            json(res, 200, { ok: true, url: SPONSOR_URL });
        },
    });
    track({
        kind: 'exact',
        path: `${ROUTE_PREFIX}/push/cleanup`,
        handler: async (req, res) => {
            const method = String(req.method ?? 'GET').toUpperCase();
            const headers = req.headers ?? {};
            if (method !== 'POST' || String(headers['x-mpb-client'] ?? '') !== '1') {
                json(res, 403, { ok: false, error: 'forbidden' });
                return;
            }
            const credentials = readService(ctx, 'credentials');
            if (credentials !== undefined && typeof credentials.unset === 'function') {
                for (const ref of [CREDENTIAL_REF, THEME_CREDENTIAL_REF, PUSH_CREDENTIAL_REF]) {
                    try {
                        await credentials.unset(ref);
                    }
                    catch {
                        // ignore
                    }
                }
            }
            resetMemberAuthState();
            resetPushPreferencesState();
            log('info', '已清理旧会员令牌、会员主题与旧推送设置凭据。');
            json(res, 200, { ok: true });
        },
    });
    return true;
}
/** 当前进程内已注册的路由释放器；插件热重载时先释放，避免旧 handler 抢占请求 */
let activeDisposers = [];
function disposeRoutes(list) {
    for (const dispose of list.splice(0)) {
        try {
            dispose();
        }
        catch {
            // ignore
        }
    }
}
function bindCleanup(ctx, disposers) {
    try {
        ctx.effect?.(() => () => disposeRoutes(disposers));
    }
    catch {
        // ignore
    }
}
/** 注册推送设置路由；webServer 未就绪时短暂重试 */
export function registerPushRoutes(ctx, log, meowProvider, nicknameProvider) {
    // 先释放上一代路由：否则热重载后旧 handler 仍在，新的注册会因重复路径失败
    disposeRoutes(activeDisposers);
    const disposers = [];
    try {
        if (registerRoutes(ctx, log, meowProvider, nicknameProvider, disposers)) {
            activeDisposers = disposers;
            bindCleanup(ctx, disposers);
            return;
        }
    }
    catch (error) {
        disposeRoutes(disposers);
        log('warn', `推送设置路由注册失败：${String(error)}`);
        return;
    }
    let attempts = 0;
    const timer = setInterval(() => {
        attempts += 1;
        const pending = [];
        try {
            if (registerRoutes(ctx, log, meowProvider, nicknameProvider, pending)) {
                clearInterval(timer);
                activeDisposers = pending;
                bindCleanup(ctx, pending);
            }
            else if (attempts > 150) {
                clearInterval(timer);
            }
        }
        catch (error) {
            disposeRoutes(pending);
            clearInterval(timer);
            log('warn', `推送设置路由注册失败：${String(error)}`);
        }
    }, 200);
    timer.unref?.();
    try {
        ctx.effect?.(() => () => clearInterval(timer));
    }
    catch {
        // ignore
    }
}
//# sourceMappingURL=push-settings.js.map