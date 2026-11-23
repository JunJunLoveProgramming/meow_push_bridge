/**
 * meow-push-bridge / MeoW Push Bridge (喵桥)
 * src/push-settings.ts —— 推送通道状态与 SMTP 设置的宿主存储/路由
 *
 * 设计：
 *   - MeoW / SMTP 各自独立启用：配好一个就跑一个，两个都配好就同时发；
 *   - 状态由配置推断：MeoW 看昵称，SMTP 看服务器/发件人/收件人；
 *   - SMTP 凭据存 credentials，不写 profile；GET 永不回传密码。
 */
import { type BarkConfig } from './bark.js';
import { type SmtpConfig } from './smtp.js';
export interface PushPreferences {
    smtp: SmtpConfig;
    bark: BarkConfig;
}
export interface ChannelStatus {
    configured: boolean;
    detail: string;
}
/** 仅测试使用：清空内存缓存，强制从 credentials 重新读取 */
export declare function resetPushPreferencesState(): void;
export interface PushHost {
    get?(key: string): unknown;
    config?: unknown;
    effect?(callback: () => (() => void) | void, label?: string): unknown;
    logger?: {
        info?(...args: unknown[]): void;
        warn?(...args: unknown[]): void;
        error?(...args: unknown[]): void;
    };
}
type LogFn = (level: 'info' | 'warn' | 'error', message: string) => void;
/** SMTP 是否已配置到可发送状态 */
export declare function isSmtpConfigured(smtp: SmtpConfig): boolean;
/** MeoW 是否已配置（昵称非空） */
export declare function meowStatusFromNickname(nickname: string): ChannelStatus;
/** 从宿主 config 读取 MeoW 状态（路由的默认实现） */
export declare function getMeowStatus(ctx: PushHost): ChannelStatus;
/** SMTP 状态（不包含密码） */
export declare function getSmtpStatus(smtp: SmtpConfig): ChannelStatus;
/** Bark 状态（不包含 token） */
export declare function getBarkStatus(bark: BarkConfig): ChannelStatus;
/** 读取推送设置；损坏/缺失时回退默认值 */
export declare function loadPushPreferences(ctx: PushHost): Promise<PushPreferences>;
/** 供发送端读取 SMTP 配置（含密码，仅内存使用） */
export declare function getSmtpConfig(ctx: PushHost): Promise<SmtpConfig>;
/** 供发送端读取 Bark 配置（含 token，仅内存使用） */
export declare function getBarkConfig(ctx: PushHost): Promise<BarkConfig>;
/**
 * 保存设置。
 * - 只保存 SMTP；MeoW 由昵称是否填写自动判定；
 * - 密码字段为空表示「保持原密码」，`clearPassword: true` 才会清空。
 */
export declare function savePushPreferences(ctx: PushHost, input: unknown): Promise<{
    ok: boolean;
    preferences?: PushPreferences;
    error?: string;
}>;
/** 前端可见的公开形态（无密码，含红绿灯状态） */
export declare function publicPreferences(preferences: PushPreferences, meow: ChannelStatus): Record<string, unknown>;
/** 注册推送设置路由；webServer 未就绪时短暂重试 */
export declare function registerPushRoutes(ctx: PushHost, log: LogFn, meowProvider?: () => ChannelStatus, nicknameProvider?: () => string): void;
export {};
//# sourceMappingURL=push-settings.d.ts.map