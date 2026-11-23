/**
 * dsh-junjun-transit / 骏骏通知中转
 * src/condense.ts —— 推送用的「本地总结器」
 *
 * 目标：不依赖 LLM，把一轮对话压缩成适合手机通知的中文纯文本。
 * 处理两类噪声：
 *   1. DSH 附在用户消息末尾的英文运行时上下文（Time sampled / Current runtime context …）
 *   2. 模型回复里的 Markdown、HTML、代码块、链接、工具输出
 *
 * 输出保证：纯文字、无 HTML 标签、长度受控、优先保留结论句。
 */
/** 用户消息里一旦出现这些标记，后面都是 DSH 追加的运行时上下文，应截掉 */
const RUNTIME_MARKERS = [
    /Time sampled while preparing turn/i,
    /Current runtime context/i,
    /Current working directory:/i,
    /Current DSH file policy:/i,
    /Current DeepSeek Harness implementation checkout:/i,
    /Current DeepSeek Harness Web GUI URL:/i,
    /Approval prompts are enabled/i,
    /Browser time zone for this request:/i,
    /Elapsed since the preceding/i,
    /The browser provides no implicit DOM/i,
    /You are an AI agent powered by DeepSeek Harness/i,
];
/** 去掉运行时上下文：从最早出现的标记处截断 */
export function stripRuntimeContext(text) {
    let cut = text.length;
    for (const marker of RUNTIME_MARKERS) {
        const match = marker.exec(text);
        if (match !== null && match.index < cut)
            cut = match.index;
    }
    return text.slice(0, cut);
}
/** 解码常见 HTML 实体 */
function decodeEntities(text) {
    return text
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'");
}
/** 去掉 Markdown / HTML / 代码块，只留可读文字 */
export function toPlainText(text) {
    return decodeEntities(text
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/~~~[\s\S]*?~~~/g, ' ')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/^#{1,6}\s*/gm, '')
        .replace(/^>\s?/gm, '')
        .replace(/^[-*+]\s+/gm, '')
        .replace(/^(\d+)[.、)]\s+/gm, '$1. ')
        .replace(/[*_`~]{1,3}/g, '')
        .replace(/[ \t]+/g, ' ')
        .replace(/\s*\n\s*/g, ' ')
        .trim());
}
/** 句子切分：中文标点为主，兼容英文句号 */
export function splitSentences(text) {
    return text
        .split(/(?<=[。！？!?；;])/)
        .flatMap((part) => part.split(/(?<=[.!?])\s+/))
        .map((part) => part.trim())
        .filter((part) => part !== '');
}
/** 明显不适合进通知的行：URL、路径、代码/命令、表格 */
function isNoiseSentence(sentence) {
    if (/https?:\/\//i.test(sentence))
        return true;
    if (/^[A-Za-z]:\\|^\/[^\s]+\.\w+/.test(sentence))
        return true;
    if (/^[|`]|[{}<>]/.test(sentence))
        return true;
    if (/\b(?:npm|pnpm|node|php|git|composer)\b.*(?:--|\.exe|install|publish)/i.test(sentence))
        return true;
    return false;
}
/** 去掉「好的，」「当然可以。」这类开场白，节省通知空间 */
function stripOpeningFiller(sentence) {
    return sentence.replace(/^(?:好的|好|当然|没问题|可以)[，,。！!、]\s*/u, '');
}
function truncateAt(text, limit) {
    if (text.length <= limit)
        return text;
    return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}
/**
 * 浓缩一段文字：按句子取前面最重要的几句，直到达到字数上限。
 * 不用关键词打分，避免把「然后/因此」之类虚词句选进来；开头通常就是结论。
 */
export function condenseText(text, maxChars, maxSentences = 3) {
    const plain = toPlainText(text);
    if (plain === '')
        return '';
    const sentences = splitSentences(plain)
        .map((sentence) => stripOpeningFiller(sentence))
        .filter((sentence) => sentence.length >= 4 && !isNoiseSentence(sentence));
    const picked = [];
    let length = 0;
    for (const sentence of sentences) {
        if (picked.length >= maxSentences)
            break;
        if (length + sentence.length > maxChars && picked.length > 0)
            break;
        picked.push(sentence);
        length += sentence.length;
        if (length >= maxChars)
            break;
    }
    const joined = picked.join('');
    if (joined === '')
        return truncateAt(plain, maxChars);
    return truncateAt(joined, maxChars);
}
/** 浓缩用户提问：截掉 DSH 运行时上下文，取前 1–2 句 */
export function condenseQuestion(question, maxChars = 100) {
    const userPart = stripRuntimeContext(question);
    return condenseText(userPart, maxChars, 2);
}
/** 浓缩模型回复：去掉代码/HTML/Markdown，取结论句 */
export function condenseAnswer(answer, maxChars = 260) {
    return condenseText(answer, maxChars, 3);
}
//# sourceMappingURL=condense.js.map