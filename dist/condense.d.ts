/**
 * meow-push-bridge / MeoW Push Bridge (喵桥)
 * src/condense.ts —— 推送用的「本地总结器」
 *
 * 目标：不依赖 LLM，把一轮对话压缩成适合手机通知的中文纯文本。
 * 处理两类噪声：
 *   1. DSH 附在用户消息末尾的英文运行时上下文（Time sampled / Current runtime context …）
 *   2. 模型回复里的 Markdown、HTML、代码块、链接、工具输出
 *
 * 输出保证：纯文字、无 HTML 标签、长度受控、优先保留结论句。
 */
/** 去掉运行时上下文：从最早出现的标记处截断 */
export declare function stripRuntimeContext(text: string): string;
/** 去掉 Markdown / HTML / 代码块，只留可读文字 */
export declare function toPlainText(text: string): string;
/** 句子切分：中文标点为主，兼容英文句号 */
export declare function splitSentences(text: string): string[];
/**
 * 浓缩一段文字：按句子取前面最重要的几句，直到达到字数上限。
 * 不用关键词打分，避免把「然后/因此」之类虚词句选进来；开头通常就是结论。
 */
export declare function condenseText(text: string, maxChars: number, maxSentences?: number): string;
/** 浓缩用户提问：截掉 DSH 运行时上下文，取前 1–2 句 */
export declare function condenseQuestion(question: string, maxChars?: number): string;
/** 浓缩模型回复：去掉代码/HTML/Markdown，取结论句 */
export declare function condenseAnswer(answer: string, maxChars?: number): string;
//# sourceMappingURL=condense.d.ts.map