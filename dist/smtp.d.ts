/**
 * dsh-junjun-transit / 骏骏通知中转
 * src/smtp.ts —— 零依赖 SMTP 客户端（纯文本邮件）
 *
 * 为什么自己实现：
 *   插件坚持「零运行时依赖」，不能引入 nodemailer；这里只实现推送需要的
 *   最小 SMTP 子集：EHLO / STARTTLS / AUTH PLAIN|LOGIN / MAIL / RCPT / DATA。
 *
 * 支持：
 *   - 465 隐式 TLS（encryption = 'tls'）
 *   - 587 STARTTLS（encryption = 'starttls'，默认）
 *   - 25 明文（encryption = 'none'，仅内网/本机中继建议）
 *
 * 邮件正文固定 UTF-8 纯文本（base64 传输），主题用 RFC 2047 编码。
 */
export type SmtpEncryption = 'tls' | 'starttls' | 'none';
export interface SmtpConfig {
    host: string;
    port: number;
    encryption: SmtpEncryption;
    username: string;
    password: string;
    fromEmail: string;
    fromName: string;
    toEmail: string;
}
export interface SmtpMessage {
    subject: string;
    text: string;
}
export interface SmtpResult {
    ok: boolean;
    /** 面向用户的错误信息（成功时为空） */
    error?: string;
    /** 实际使用的服务器，便于提示 */
    server?: string;
}
/** 构造纯文本 MIME 邮件；不拼接用户输入以外的头部，避免头注入 */
export declare function buildSmtpMessage(config: SmtpConfig, message: SmtpMessage): string;
/** 校验设置；密码允许为空（有些内网中继不需要认证） */
export declare function validateSmtpConfig(input: unknown): {
    ok: true;
    config: SmtpConfig;
} | {
    ok: false;
    error: string;
};
/** 给前端看的配置：永远不返回密码，只返回 hasPassword */
export declare function publicSmtpConfig(config: SmtpConfig): Record<string, unknown>;
/**
 * 发送一封纯文本邮件。
 * 不抛错：所有失败都转成 `{ ok:false, error }`，方便工具/自动推送统一处理。
 */
export declare function sendSmtpMail(config: SmtpConfig, message: SmtpMessage, timeoutMs?: number): Promise<SmtpResult>;
//# sourceMappingURL=smtp.d.ts.map