/**
 * meow-push-bridge / MeoW Push Bridge (喵桥)
 * src/bark.ts —— 全能消息推送 Bark 通道（零依赖）
 *
 * 文档：https://www.ggsuper.com.cn/push/api.html
 * 端点：POST https://www.ggsuper.com.cn/push/api/v1/sendMsg3_New.php
 * 必填：title / msg / token / issecure=0
 * 成功：{ "code": "80000000", "msg": "Success" }
 */
export declare const BARK_ENDPOINT = "https://www.ggsuper.com.cn/push/api/v1/sendMsg3_New.php";
export interface BarkConfig {
    /** 客户端注册的 token */
    token: string;
    /** 发送者名称，可选 */
    sender: string;
    /** 默认通知标题；留空使用主题标题 */
    title: string;
    /** 默认通知图标（必须 https） */
    icon: string;
}
export interface BarkMessage {
    title: string;
    text: string;
    url?: string;
    icon?: string;
}
export interface BarkResult {
    ok: boolean;
    error?: string;
    code?: string;
}
/** 校验 Bark 配置；token 不允许包含空白 */
export declare function validateBarkConfig(input: unknown): {
    ok: true;
    config: BarkConfig;
} | {
    ok: false;
    error: string;
};
export declare function isBarkConfigured(config: BarkConfig): boolean;
/** 前端可见配置：Bark token 按用户要求明文返回 */
export declare function publicBarkConfig(config: BarkConfig): Record<string, unknown>;
/**
 * 发送 Bark 通知。
 * 不抛错：所有失败都转成 `{ ok:false, error }`。
 */
export declare function sendBark(config: BarkConfig, message: BarkMessage, options?: {
    endpoint?: string;
    timeoutMs?: number;
}): Promise<BarkResult>;
//# sourceMappingURL=bark.d.ts.map