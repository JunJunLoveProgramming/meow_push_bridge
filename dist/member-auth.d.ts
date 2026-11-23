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
/** 会员站点 */
export declare const SITE_BASE = "https://meowpushbridge.junjunloveprogramming.cn";
/** 插件在本机 DSH Web 服务上注册的路由前缀 */
export declare const ROUTE_PREFIX = "/meow-push-bridge-api";
/** 云端主题数据的 key */
export declare const THEME_KEY = "meow.theme";
/** credentials 引用名（存储会话 JSON） */
export declare const CREDENTIAL_REF = "MEOW_PUSH_BRIDGE_MEMBER_TOKEN";
/** credentials 引用名（存储会员主题 JSON，避免写入 profile） */
export declare const THEME_CREDENTIAL_REF = "MEOW_PUSH_BRIDGE_MEMBER_THEME";
/** 默认自定义分类（非会员固定；会员默认值） */
export declare const DEFAULT_CATEGORY = "dsh\u63D2\u4EF6";
/** 默认通知图标：未设置自定义图标时使用 */
export declare const DEFAULT_ICON_URL = "https://www.junjunloveprogramming.cn/upload/meow_push_bridge_logo.png";
/** 分类最大长度（MeoW 文档：10 个字） */
export declare const MAX_CATEGORY_LENGTH = 10;
export interface MemberSession {
    token: string;
    username: string;
    emailMasked: string | null;
    scopes: string[];
    authorizedAt: string;
}
export interface ThemeSettings {
    nickname: string;
    title: string;
    imgUrl: string;
    category: string;
}
export interface MemberAuthHost {
    get?(key: string): unknown;
    inject?(deps: string[], callback: (ctx: MemberAuthHost) => void): unknown;
    effect?(callback: () => (() => void) | void, label?: string): unknown;
    logger?: {
        info?(...args: unknown[]): void;
        warn?(...args: unknown[]): void;
        error?(...args: unknown[]): void;
    };
}
type LogFn = (level: 'info' | 'warn' | 'error', message: string) => void;
export declare const MEMBER_LOG_PATH: string;
/** 仅测试使用 */
export declare function resetMemberAuthState(): void;
export declare function createPkce(): {
    verifier: string;
    challenge: string;
};
export declare function buildAuthorizeUrl(origin: string, state: string, challenge: string): string;
/**
 * 用系统默认浏览器打开授权页。
 *
 * DSH 桌面壳里 <a target="_blank"> / window.open 都可能被拦。
 * 优先走 DSH 的 subprocess 服务执行 Windows ShellExecute（rundll32），
 * 它和终端工具共用一个可用的执行环境；失败再退回 Node spawn。
 */
export declare function openExternal(ctx: MemberAuthHost, url: string): Promise<boolean>;
/** 分类规范化：去空白；空 → 默认 dsh插件；最多 10 字且不含控制字符 */
export declare function normalizeCategory(value: unknown): string | null;
export declare function readStoredTheme(ctx: MemberAuthHost): Promise<ThemeSettings | null>;
/**
 * 推送实际使用的主题：
 * - 未登录 → 固定默认（category = dsh插件）
 * - 已登录但没保存过 → 默认
 * 绝不读取 profile 配置，避免非会员手改配置绕过会员限制。
 */
export declare function getEffectiveTheme(ctx: MemberAuthHost): Promise<{
    title: string;
    imgUrl: string;
    category: string;
}>;
/** 保存主题（本机始终可用；云端同步另需会员登录） */
export declare function saveTheme(ctx: MemberAuthHost, input: unknown): Promise<{
    ok: boolean;
    theme?: ThemeSettings;
    error?: string;
}>;
export interface ThemeUploadResult {
    ok: boolean;
    error?: string;
}
export declare function uploadTheme(ctx: MemberAuthHost, input: unknown): Promise<ThemeUploadResult>;
export declare function downloadTheme(ctx: MemberAuthHost): Promise<{
    ok: boolean;
    theme?: ThemeSettings;
    error?: string;
}>;
export declare function clearTheme(ctx: MemberAuthHost): Promise<{
    ok: boolean;
    error?: string;
}>;
/**
 * 注册本机 HTTP 路由。webServer 不可用时返回 false（非 Web 运行环境）。
 */
export declare function registerMemberRoutes(ctx: MemberAuthHost, log: LogFn, retried?: boolean): boolean;
export {};
//# sourceMappingURL=member-auth.d.ts.map