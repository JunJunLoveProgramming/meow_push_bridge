/**
 * meow-push-bridge / 0.3.0
 * src/member-auth.ts —— 会员登录、主题同步、云端导入导出
 *
 * 流程（loopback + PKCE）：
 *   1. 设置页点「登录会员」→ POST /meow-push-bridge-api/auth/start
 *   2. 宿主生成 state + PKCE，返回站点授权 URL；浏览器打开
 *   3. 会员在站点登录并授权 → 站点重定向回 /meow-push-bridge-api/auth/callback?code&state
 *   4. 宿主用 code + verifier 调 /plugin/token.php 换令牌，存入 credentials
 *   5. 设置页轮询 /auth/status 直到已授权
 *
 * 令牌只存在宿主安全存储（credentials），不会返回给浏览器端。
 */
var __rewriteRelativeImportExtension = (this && this.__rewriteRelativeImportExtension) || function (path, preserveJsx) {
    if (typeof path === "string" && /^\.\.?\//.test(path)) {
        return path.replace(/\.(tsx)$|((?:\.d)?)((?:\.[^./]+?)?)\.([cm]?)ts$/i, function (m, tsx, d, ext, cm) {
            return tsx ? preserveJsx ? ".jsx" : ".js" : d && (!ext || !cm) ? m : (d + ext + "." + cm.toLowerCase() + "js");
        });
    }
    return path;
};
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
/** 会员站点 */
export const SITE_BASE = 'https://meowpushbridge.junjunloveprogramming.cn';
/** 插件在本机 DSH Web 服务上注册的路由前缀 */
export const ROUTE_PREFIX = '/meow-push-bridge-api';
/** 云端主题数据的 key */
export const THEME_KEY = 'meow.theme';
/** credentials 引用名（存储会话 JSON） */
export const CREDENTIAL_REF = 'MEOW_PUSH_BRIDGE_MEMBER_TOKEN';
/** credentials 引用名（存储会员主题 JSON，避免写入 profile） */
export const THEME_CREDENTIAL_REF = 'MEOW_PUSH_BRIDGE_MEMBER_THEME';
/** 默认自定义分类（非会员固定；会员默认值） */
export const DEFAULT_CATEGORY = 'dsh插件';
/** 默认通知图标：未设置自定义图标时使用 */
export const DEFAULT_ICON_URL = 'https://www.junjunloveprogramming.cn/upload/meow_push_bridge_logo.png';
/** 旧默认图标（已失效）；读取到旧值时自动迁移到新地址 */
const LEGACY_ICON_URLS = [
    'https://www.junjunloveprogramming.cn/images/meow_push_bridge_logo.png',
    'https://meowpushbridge.junjunloveprogramming.cn/uploads/mpb_20261116_d680dc09cfa3ec17.png',
];
/** 归一化主题图标：空值/旧默认值 → 新默认图标 */
function normalizeThemeIcon(value) {
    const text = value.trim();
    if (text === '' || LEGACY_ICON_URLS.includes(text))
        return DEFAULT_ICON_URL;
    return text;
}
/** 分类最大长度（MeoW 文档：10 个字） */
export const MAX_CATEGORY_LENGTH = 10;
const CALLBACK_PATH = `${ROUTE_PREFIX}/auth/callback`;
const PENDING_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;
// 凭证服务不可用时的内存回退（重启后需重新登录）
let memorySession = null;
/** 会员主题只存宿主内存/credentials，绝不写入 profile 配置 */
let memoryTheme = null;
const pending = new Map();
/** 最近事件（诊断用；也可在 /auth/debug 查看） */
const events = [];
export const MEMBER_LOG_PATH = join(tmpdir(), 'meow-push-bridge-member.log');
function trace(message) {
    const line = `${new Date().toISOString()} ${message}`;
    events.push(line);
    if (events.length > 60)
        events.shift();
    try {
        appendFileSync(MEMBER_LOG_PATH, `${line}\n`);
    }
    catch {
        // 日志写不了不影响流程
    }
}
/** 仅测试使用 */
export function resetMemberAuthState() {
    memorySession = null;
    memoryTheme = null;
    pending.clear();
}
function readService(ctx, key) {
    if (typeof ctx.get === 'function') {
        try {
            return ctx.get(key);
        }
        catch {
            return undefined;
        }
    }
    return undefined;
}
function base64url(input) {
    return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}
export function createPkce() {
    const verifier = base64url(randomBytes(32));
    const challenge = base64url(createHash('sha256').update(verifier).digest());
    return { verifier, challenge };
}
export function buildAuthorizeUrl(origin, state, challenge) {
    const params = new URLSearchParams({
        client: 'meow_push_bridge',
        redirect_uri: `${origin}${CALLBACK_PATH}`,
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
    });
    return `${SITE_BASE}/plugin/authorize.php?${params.toString()}`;
}
/** 打开后尝试把浏览器切到前台，避免用户以为“没反应” */
function focusBrowser() {
    if (process.platform !== 'win32')
        return;
    try {
        const script = "Start-Sleep -Milliseconds 1200; " +
            "$w = New-Object -ComObject WScript.Shell; " +
            "foreach ($n in @('Microsoft Edge','Google Chrome','Mozilla Firefox')) { if ($w.AppActivate($n)) { break } }";
        spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
        }).unref();
    }
    catch {
        // 聚焦失败不影响已经打开的浏览器
    }
}
/**
 * 用系统默认浏览器打开授权页。
 *
 * DSH 桌面壳里 <a target="_blank"> / window.open 都可能被拦。
 * 优先走 DSH 的 subprocess 服务执行 Windows ShellExecute（rundll32），
 * 它和终端工具共用一个可用的执行环境；失败再退回 Node spawn。
 */
export async function openExternal(ctx, url) {
    // DSH 桌面版宿主若运行在 Electron 主进程，直接用 shell.openExternal 最稳
    try {
        const specifier = 'electron';
        const electron = (await import(__rewriteRelativeImportExtension(specifier)));
        if (electron.shell?.openExternal !== undefined) {
            await electron.shell.openExternal(url);
            focusBrowser();
            return true;
        }
    }
    catch {
        // 非 Electron 环境，继续下面的系统命令
    }
    const subprocess = readService(ctx, 'subprocess');
    if (subprocess !== undefined && process.platform === 'win32') {
        try {
            const handle = subprocess.spawn({
                argv: ['rundll32.exe', 'url.dll,FileProtocolHandler', url],
                cwd: process.cwd(),
                stdio: { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' },
                graceMs: 2000,
            });
            const outcome = await Promise.race([
                handle.done,
                new Promise((resolve) => {
                    setTimeout(() => resolve({ exitCode: 0 }), 1200);
                }),
            ]);
            if (outcome.exitCode === 0 || outcome.exitCode === null) {
                focusBrowser();
                return true;
            }
        }
        catch {
            // 继续尝试 Node spawn
        }
    }
    try {
        const child = process.platform === 'win32'
            ? spawn('cmd.exe', ['/c', 'start', '', `"${url.replace(/"/g, '')}"`], {
                detached: true,
                stdio: 'ignore',
                windowsHide: true,
                windowsVerbatimArguments: true,
            })
            : process.platform === 'darwin'
                ? spawn('open', [url], { detached: true, stdio: 'ignore' })
                : spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
        child.on('error', () => {
            // 打不开时由调用方回退到页面内导航
        });
        child.unref();
        focusBrowser();
        return true;
    }
    catch {
        return false;
    }
}
/** 允许跳回的 DSH 地址：loopback、同端口、http(s) */
function isSafeReturn(value, origin) {
    if (value.length > 512)
        return false;
    try {
        const target = new URL(value);
        const base = new URL(origin);
        const loopback = ['127.0.0.1', 'localhost', '[::1]', '::1'];
        return ((target.protocol === 'http:' || target.protocol === 'https:') &&
            loopback.includes(target.hostname) &&
            target.port === base.port);
    }
    catch {
        return false;
    }
}
function prunePending(now = Date.now()) {
    for (const [state, item] of pending) {
        if (now - item.createdAt > PENDING_TTL_MS)
            pending.delete(state);
    }
}
function isMemberSession(value) {
    if (value === null || typeof value !== 'object')
        return false;
    const table = value;
    return typeof table['token'] === 'string' && table['token'].length > 0;
}
async function readSession(ctx) {
    const credentials = readService(ctx, 'credentials');
    if (credentials !== undefined) {
        try {
            const resolved = await credentials.resolve(CREDENTIAL_REF);
            if (resolved !== undefined && typeof resolved.value === 'string' && resolved.value !== '') {
                const parsed = JSON.parse(resolved.value);
                if (isMemberSession(parsed))
                    return parsed;
            }
        }
        catch {
            // 读取失败时退回内存
        }
    }
    return memorySession;
}
async function saveSession(ctx, session) {
    memorySession = session;
    const credentials = readService(ctx, 'credentials');
    if (credentials !== undefined) {
        try {
            await credentials.set(CREDENTIAL_REF, JSON.stringify(session));
        }
        catch {
            // 内存已有，忽略持久化失败
        }
    }
}
async function clearSession(ctx) {
    memorySession = null;
    const credentials = readService(ctx, 'credentials');
    if (credentials !== undefined) {
        try {
            await credentials.unset(CREDENTIAL_REF);
        }
        catch {
            // ignore
        }
    }
}
/** 分类规范化：去空白；空 → 默认 dsh插件；最多 10 字且不含控制字符 */
export function normalizeCategory(value) {
    if (value === undefined || value === null)
        return DEFAULT_CATEGORY;
    if (typeof value !== 'string')
        return null;
    const text = value.trim();
    if (text === '')
        return DEFAULT_CATEGORY;
    if ([...text].length > MAX_CATEGORY_LENGTH)
        return null;
    if (/[\u0000-\u001F\u007F]/u.test(text))
        return null;
    return text;
}
function isThemeSettings(value) {
    if (value === null || typeof value !== 'object')
        return false;
    const table = value;
    return typeof table['title'] === 'string' && typeof table['imgUrl'] === 'string';
}
export async function readStoredTheme(ctx) {
    if (memoryTheme !== null)
        return memoryTheme;
    const credentials = readService(ctx, 'credentials');
    if (credentials !== undefined) {
        try {
            const resolved = await credentials.resolve(THEME_CREDENTIAL_REF);
            if (resolved !== undefined && typeof resolved.value === 'string' && resolved.value !== '') {
                const parsed = JSON.parse(resolved.value);
                if (isThemeSettings(parsed)) {
                    const theme = parsed;
                    memoryTheme = {
                        nickname: typeof theme.nickname === 'string' ? theme.nickname : '',
                        title: theme.title,
                        imgUrl: normalizeThemeIcon(theme.imgUrl),
                        category: normalizeCategory(theme.category) ?? DEFAULT_CATEGORY,
                    };
                    return memoryTheme;
                }
            }
        }
        catch {
            // ignore
        }
    }
    return null;
}
async function writeStoredTheme(ctx, theme) {
    memoryTheme = theme;
    const credentials = readService(ctx, 'credentials');
    if (credentials !== undefined) {
        try {
            await credentials.set(THEME_CREDENTIAL_REF, JSON.stringify(theme));
        }
        catch {
            // 内存已有
        }
    }
}
async function clearStoredTheme(ctx) {
    memoryTheme = null;
    const credentials = readService(ctx, 'credentials');
    if (credentials !== undefined) {
        try {
            await credentials.unset(THEME_CREDENTIAL_REF);
        }
        catch {
            // ignore
        }
    }
}
/**
 * 推送实际使用的主题：
 * - 未登录 → 固定默认（category = dsh插件）
 * - 已登录但没保存过 → 默认
 * 绝不读取 profile 配置，避免非会员手改配置绕过会员限制。
 */
export async function getEffectiveTheme(ctx) {
    // 主题属于本机设置：即使取消会员授权也继续生效
    const theme = await readStoredTheme(ctx);
    if (theme === null) {
        return { title: '', imgUrl: DEFAULT_ICON_URL, category: DEFAULT_CATEGORY };
    }
    return {
        title: theme.title,
        imgUrl: normalizeThemeIcon(theme.imgUrl),
        category: normalizeCategory(theme.category) ?? DEFAULT_CATEGORY,
    };
}
/** 保存主题（本机始终可用；云端同步另需会员登录） */
export async function saveTheme(ctx, input) {
    const checked = validateTheme(input, false);
    if (!checked.ok)
        return { ok: false, error: checked.error };
    const theme = checked.theme;
    await writeStoredTheme(ctx, theme);
    const session = await readSession(ctx);
    trace(`theme saved user=${session?.username ?? 'local'} category=${theme.category}`);
    return { ok: true, theme };
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
function html(res, status, title, message) {
    if (res.headersSent)
        return;
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${title}</title>` +
        '<body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f5f7fb;color:#1f2430;' +
        'display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0">' +
        `<div style="max-width:520px;padding:32px;background:#fff;border-radius:14px;box-shadow:0 12px 40px rgba(20,30,60,.12);text-align:center">` +
        `<h1 style="font-size:20px;margin:0 0 10px">${title}</h1>` +
        `<p style="font-size:14px;line-height:1.7;color:#5a6273;margin:0 0 16px">${message}</p>` +
        '<p style="font-size:12px;color:#8a93a6;margin:0">可以关闭此页面，回到 DSH 设置页。</p>' +
        '</div><script>setTimeout(function(){window.close()},1500)</script></body></html>');
}
function readBody(req, limit = 65536) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > limit) {
                reject(new Error('请求体过大'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}
async function callSite(path, init) {
    const response = await fetch(`${SITE_BASE}${path}`, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    let data = {};
    try {
        const parsed = await response.json();
        if (parsed !== null && typeof parsed === 'object')
            data = parsed;
    }
    catch {
        data = {};
    }
    return { status: response.status, data };
}
async function exchangeCode(code, verifier) {
    const { status, data } = await callSite('/plugin/token.php', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, verifier, client: 'meow_push_bridge' }),
    });
    if (status !== 200 || data['ok'] !== true) {
        const error = data['error'];
        const message = error !== null && typeof error === 'object' && typeof error['message'] === 'string'
            ? String(error['message'])
            : '令牌兑换失败';
        return { ok: false, error: message };
    }
    const account = (data['account'] ?? {});
    return {
        ok: true,
        session: {
            token: String(data['token'] ?? ''),
            username: typeof account['username'] === 'string' ? account['username'] : '',
            emailMasked: typeof account['email_masked'] === 'string' ? account['email_masked'] : null,
            scopes: Array.isArray(data['scopes']) ? data['scopes'].map(String) : [],
            authorizedAt: new Date().toISOString(),
        },
    };
}
function validateTheme(input, requireNickname = true) {
    if (input === null || typeof input !== 'object') {
        return { ok: false, error: '请求格式错误' };
    }
    const table = input;
    const nickname = typeof table['nickname'] === 'string' ? table['nickname'].trim() : '';
    const title = typeof table['title'] === 'string' ? table['title'].trim() : '';
    const imgUrl = typeof table['imgUrl'] === 'string' ? table['imgUrl'].trim() : '';
    const category = normalizeCategory(table['category']);
    if (requireNickname && nickname === '')
        return { ok: false, error: '请先填写「MeoW 昵称」再同步' };
    if (nickname.length > 64)
        return { ok: false, error: 'MeoW 昵称不能超过 64 个字符' };
    if (title.length > 64)
        return { ok: false, error: '通知标题不能超过 64 个字符' };
    if (imgUrl !== '' && (imgUrl.length > 2048 || !/^https?:\/\/\S+$/iu.test(imgUrl))) {
        return { ok: false, error: '图标 URL 必须是 http/https 开头的图片地址' };
    }
    if (category === null) {
        return { ok: false, error: `分类名最多 ${MAX_CATEGORY_LENGTH} 个字，且不能包含换行/控制字符` };
    }
    return { ok: true, theme: { nickname, title, imgUrl, category } };
}
export async function uploadTheme(ctx, input) {
    const session = await readSession(ctx);
    if (session === null)
        return { ok: false, error: '尚未登录会员，请先完成授权登录' };
    const checked = validateTheme(input);
    if (!checked.ok)
        return { ok: false, error: checked.error };
    const theme = checked.theme;
    const { status, data } = await callSite('/api/v1/data.php', {
        method: 'POST',
        headers: {
            authorization: `Bearer ${session.token}`,
            'content-type': 'application/json',
        },
        body: JSON.stringify({
            key: THEME_KEY,
            value: { ...theme, updatedAt: new Date().toISOString() },
        }),
    });
    if (status !== 200 || data['ok'] !== true) {
        const error = data['error'];
        const message = error !== null && typeof error === 'object' && typeof error['message'] === 'string'
            ? String(error['message'])
            : '上传失败';
        return { ok: false, error: message };
    }
    await writeStoredTheme(ctx, theme);
    return { ok: true };
}
export async function downloadTheme(ctx) {
    const session = await readSession(ctx);
    if (session === null)
        return { ok: false, error: '尚未登录会员' };
    const { status, data } = await callSite(`/api/v1/data.php?key=${encodeURIComponent(THEME_KEY)}`, {
        method: 'GET',
        headers: { authorization: `Bearer ${session.token}` },
    });
    if (status === 404)
        return { ok: false, error: '云端还没有保存过主题' };
    if (status !== 200 || data['ok'] !== true) {
        return { ok: false, error: '读取云端主题失败' };
    }
    // data.php 的返回形状是 { ok: true, data: { key, value } }
    const payload = data['data'];
    if (payload === null || typeof payload !== 'object') {
        return { ok: false, error: '读取云端主题失败' };
    }
    const value = payload['value'];
    if (value === null || typeof value !== 'object')
        return { ok: false, error: '云端主题为空' };
    const table = value;
    const rawImg = typeof table['imgUrl'] === 'string' ? table['imgUrl'].trim() : '';
    const theme = {
        nickname: typeof table['nickname'] === 'string' ? table['nickname'] : '',
        title: typeof table['title'] === 'string' ? table['title'] : '',
        imgUrl: normalizeThemeIcon(rawImg),
        category: normalizeCategory(table['category']) ?? DEFAULT_CATEGORY,
    };
    await writeStoredTheme(ctx, theme);
    return { ok: true, theme };
}
export async function clearTheme(ctx) {
    const session = await readSession(ctx);
    if (session === null)
        return { ok: false, error: '尚未登录会员' };
    const { status, data } = await callSite(`/api/v1/data.php?key=${encodeURIComponent(THEME_KEY)}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${session.token}` },
    });
    if (status === 404 || (status === 200 && data['ok'] === true)) {
        await clearStoredTheme(ctx);
        return { ok: true };
    }
    return { ok: false, error: '清除云端主题失败' };
}
async function revokeRemote(session) {
    try {
        await callSite('/api/v1/revoke.php', {
            method: 'POST',
            headers: { authorization: `Bearer ${session.token}` },
        });
    }
    catch {
        // 本地仍会清除，远端失败不影响取消授权
    }
}
/**
 * 注册本机 HTTP 路由。webServer 不可用时返回 false（非 Web 运行环境）。
 */
export function registerMemberRoutes(ctx, log, retried = false) {
    const web = readService(ctx, 'webServer');
    if (web === undefined || typeof web.register !== 'function') {
        if (retried) {
            log('info', '未提供 webServer 服务，会员登录与主题同步仅在 Web 设置页可用。');
            return false;
        }
        // 冷启动时插件可能先于 webServer 激活：轮询等待，直到服务就绪再注册
        log('info', 'webServer 尚未就绪，等待后注册会员授权路由…');
        let attempts = 0;
        const timer = setInterval(() => {
            attempts += 1;
            const ready = readService(ctx, 'webServer');
            if (ready !== undefined && typeof ready.register === 'function') {
                clearInterval(timer);
                registerMemberRoutes(ctx, log, true);
                return;
            }
            if (attempts >= 150) {
                clearInterval(timer);
                log('warn', '等待 webServer 超时：会员登录与主题同步不可用。');
            }
        }, 200);
        timer.unref?.();
        if (typeof ctx.effect === 'function') {
            try {
                ctx.effect(() => () => clearInterval(timer), 'meow-push-bridge:member-route-wait');
            }
            catch {
                // effect 不可用时忽略，定时器已 unref，不会阻塞退出
            }
        }
        return true;
    }
    const route = {
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: async (req, res) => {
            const origin = web.getOrigin();
            const url = new URL(req.url ?? '/', origin);
            const path = url.pathname.slice(ROUTE_PREFIX.length) || '/';
            const method = req.method ?? 'GET';
            try {
                if (method === 'POST') {
                    if (req.headers['x-mpb-client'] !== '1') {
                        json(res, 403, { ok: false, error: 'forbidden' });
                        return;
                    }
                    // 不再要求 Origin 与 webServer 地址逐字相同：
                    // 页面可能通过 localhost 打开而绑定地址是 127.0.0.1，
                    // 自定义头 X-MPB-Client 已足以阻止跨站简单请求。
                    const site = req.headers['sec-fetch-site'];
                    if (typeof site === 'string' && site !== 'same-origin' && site !== 'same-site' && site !== 'none') {
                        json(res, 403, { ok: false, error: 'cross-site request rejected' });
                        return;
                    }
                }
                if (path === '/auth/status' && method === 'GET') {
                    const session = await readSession(ctx);
                    json(res, 200, {
                        ok: true,
                        authorized: session !== null,
                        account: session === null
                            ? null
                            : {
                                username: session.username,
                                emailMasked: session.emailMasked,
                                authorizedAt: session.authorizedAt,
                            },
                        routesAvailable: true,
                    });
                    return;
                }
                if (path === '/theme' && (method === 'GET' || method === 'POST')) {
                    if (method === 'GET') {
                        const session = await readSession(ctx);
                        let theme = await readStoredTheme(ctx);
                        // 已登录且本机还没有主题时，从云端恢复
                        if (session !== null && theme === null) {
                            const cloud = await downloadTheme(ctx);
                            if (cloud.ok && cloud.theme !== undefined)
                                theme = cloud.theme;
                        }
                        json(res, 200, {
                            ok: true,
                            authorized: session !== null,
                            theme: theme === null
                                ? { nickname: '', title: '', imgUrl: DEFAULT_ICON_URL, category: DEFAULT_CATEGORY }
                                : { ...theme, imgUrl: normalizeThemeIcon(theme.imgUrl) },
                        });
                        return;
                    }
                    const body = await readBody(req);
                    let parsed = null;
                    try {
                        parsed = JSON.parse(body);
                    }
                    catch {
                        json(res, 422, { ok: false, error: 'JSON 解析失败' });
                        return;
                    }
                    const saved = await saveTheme(ctx, parsed);
                    json(res, saved.ok ? 200 : 403, saved);
                    return;
                }
                if (path === '/auth/debug' && method === 'GET') {
                    const session = await readSession(ctx);
                    json(res, 200, {
                        ok: true,
                        authorized: session !== null,
                        username: session?.username ?? null,
                        pending: [...pending.keys()],
                        events,
                        logPath: MEMBER_LOG_PATH,
                    });
                    return;
                }
                if (path === '/auth/start' && (method === 'POST' || method === 'GET')) {
                    const existing = await readSession(ctx);
                    if (existing !== null) {
                        if (method === 'GET') {
                            res.writeHead(302, { location: `${SITE_BASE}/dashboard.php` });
                            res.end();
                            return;
                        }
                        json(res, 200, {
                            ok: true,
                            authorized: true,
                            account: { username: existing.username, emailMasked: existing.emailMasked },
                        });
                        return;
                    }
                    prunePending();
                    const { verifier, challenge } = createPkce();
                    const state = base64url(randomBytes(24));
                    const returnParam = url.searchParams.get('return') ?? '';
                    const sameTab = url.searchParams.get('sameTab') === '1';
                    const returnTo = sameTab && isSafeReturn(returnParam, origin) ? returnParam : undefined;
                    const pendingItem = { verifier, createdAt: Date.now() };
                    if (returnTo !== undefined)
                        pendingItem.returnTo = returnTo;
                    pending.set(state, pendingItem);
                    const authorizeUrl = buildAuthorizeUrl(origin, state, challenge);
                    trace(`start method=${method} state=${state} origin=${origin} returnTo=${returnTo ?? '-'}`);
                    // 设置页用普通 <a target="_blank"> 打开，GET 直接 302 到站点，浏览器不会拦截
                    if (method === 'GET') {
                        res.writeHead(302, { location: authorizeUrl, 'cache-control': 'no-store' });
                        res.end();
                        return;
                    }
                    json(res, 200, {
                        ok: true,
                        authorized: false,
                        url: authorizeUrl,
                        opened: await openExternal(ctx, authorizeUrl),
                    });
                    return;
                }
                if (path === '/auth/callback' && method === 'GET') {
                    const state = url.searchParams.get('state') ?? '';
                    const code = url.searchParams.get('code') ?? '';
                    const error = url.searchParams.get('error') ?? '';
                    trace(`callback url=${req.url ?? ''} state=${state} codeLen=${code.length} error=${error || '-'} pending=${pending.has(state)}`);
                    let item = pending.get(state);
                    if (item === undefined && state === '' && code !== '' && pending.size === 1) {
                        // 站点如果丢了 state（少数重定向场景），只要还有唯一的待授权记录，
                        // 仍可用 code + 对应 verifier 完成兑换；code 本身不可猜测且一次性。
                        const only = [...pending.entries()][0];
                        if (only !== undefined) {
                            item = only[1];
                            pending.delete(only[0]);
                            trace('callback recovered pending without state');
                        }
                    }
                    if (item === undefined) {
                        trace('callback rejected: unknown state');
                        html(res, 400, '授权失败', 'state 校验失败或授权已超时，请回到 DSH 重新发起登录。');
                        return;
                    }
                    pending.delete(state);
                    if (error !== '') {
                        trace(`callback cancelled: ${error}`);
                        html(res, 200, '已取消授权', '你取消了本次授权，插件仍保持未登录状态。');
                        return;
                    }
                    const result = await exchangeCode(code, item.verifier);
                    if (!result.ok) {
                        trace(`exchange failed: ${result.error}`);
                        html(res, 400, '授权失败', result.error);
                        return;
                    }
                    await saveSession(ctx, result.session);
                    trace(`session saved user=${result.session.username}`);
                    log('info', `会员已授权：${result.session.username}`);
                    if (item.returnTo !== undefined) {
                        const target = JSON.stringify(item.returnTo).replace(/</g, '\\u003c');
                        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
                        res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>授权成功</title>' +
                            '<body style="font-family:system-ui,sans-serif;background:#f5f7fb;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0">' +
                            '<div style="background:#fff;padding:32px;border-radius:14px;box-shadow:0 12px 40px rgba(20,30,60,.12);text-align:center">' +
                            '<h1 style="font-size:20px;margin:0 0 10px">授权成功</h1>' +
                            `<p style="font-size:14px;color:#5a6273;margin:0 0 16px">已登录会员 <strong>${result.session.username}</strong>，正在返回 DSH…</p>` +
                            `<p style="font-size:12px;color:#8a93a6;margin:0">如果没有自动返回，<a href="${item.returnTo}">点这里</a></p>` +
                            '</div>' +
                            `<script>setTimeout(function(){location.replace(${target})},900)</script></body></html>`);
                        return;
                    }
                    html(res, 200, '授权成功', `已登录会员 <strong>${result.session.username}</strong>，可以回到 DSH 设置页同步主题。`);
                    return;
                }
                if (path === '/auth/logout' && method === 'POST') {
                    const session = await readSession(ctx);
                    if (session !== null)
                        await revokeRemote(session);
                    await clearSession(ctx);
                    // 只清授权，不清主题：取消会员后本机主题仍可继续使用
                    log('info', '已取消会员授权并清除本地令牌（本机主题保留）。');
                    json(res, 200, { ok: true });
                    return;
                }
                if (path === '/sync/upload' && method === 'POST') {
                    const body = await readBody(req);
                    let parsed = null;
                    try {
                        parsed = JSON.parse(body);
                    }
                    catch {
                        json(res, 422, { ok: false, error: 'JSON 解析失败' });
                        return;
                    }
                    const result = await uploadTheme(ctx, parsed);
                    json(res, result.ok ? 200 : 422, result);
                    return;
                }
                if (path === '/sync/download' && method === 'GET') {
                    const result = await downloadTheme(ctx);
                    json(res, result.ok ? 200 : 404, result);
                    return;
                }
                if (path === '/sync/clear' && method === 'POST') {
                    const result = await clearTheme(ctx);
                    json(res, result.ok ? 200 : 422, result);
                    return;
                }
                json(res, 404, { ok: false, error: 'not found' });
            }
            catch (error) {
                log('warn', `会员路由失败：${String(error)}`);
                json(res, 500, { ok: false, error: 'internal error' });
            }
        },
    };
    let registered = false;
    if (typeof ctx.effect === 'function') {
        try {
            ctx.effect(() => web.register(route), 'meow-push-bridge:member-routes');
            registered = true;
        }
        catch (error) {
            log('warn', `ctx.effect 注册路由失败：${String(error)}`);
        }
    }
    if (!registered) {
        web.register(route);
    }
    log('info', `会员授权路由已注册：${ROUTE_PREFIX}`);
    return true;
}
//# sourceMappingURL=member-auth.js.map