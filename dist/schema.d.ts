/**
 * meow-push-bridge / MeoW Push Bridge (喵桥)
 * src/schema.ts —— 零依赖的 Config schema 声明
 *
 * 目的：让 DSH 的 settings 服务能把本插件的配置投影成「设置页表单」，
 *      用户不用手写 YAML 就能填 MeoW 昵称。
 *
 * 为什么不 `import { Schema } from '@deepseek-ai/cordis'`：
 *   实测 profile 的 node_modules 里只有 .pnpm 与本插件，插件安装位置
 *   `import('@deepseek-ai/cordis')` 直接 ERR_MODULE_NOT_FOUND（该包在 DSH
 *   的 app.asar 内部，既不可解析、也读不到源码）。
 *
 * 因此这里自建一个「结构同构」的最小实现：
 *   - 链式 API：required / description / default / min / max
 *   - 校验：check(value)（DSH 校验用）
 *   - 投影：toJSONSchema()，输出形状刻意对齐 DSH 投影出来的样子，例如
 *       dsh-goal 的 defaultMaxGoalRounds 投影为：
 *         { default: 256, anyOf: [ { type: ['number','null'] },
 *                                  { $ref: '#/$defs/loaderExpression' } ] }
 *     注意 Cordis 的规则是「接受 null 即代表字段缺省」。
 *
 * ⚠️ 本文件的正确性只能靠实测（本文档无法从 DSH 源码中验证）。
 *    若 DSH 不认这份 schema 导出，插件仍能正常工作 —— 只是没有表单，
 *    运行期校验（src/config.ts 的 resolveConfig）始终是唯一权威。
 */
/** JSON Schema 片段（仅本插件用到的子集） */
export interface SchemaNode {
    type?: string | string[];
    properties?: Record<string, SchemaNode>;
    required?: string[];
    additionalProperties?: boolean;
    items?: SchemaNode;
    enum?: unknown[];
    const?: unknown;
    default?: unknown;
    description?: string;
    title?: string;
    minimum?: number;
    maximum?: number;
    anyOf?: SchemaNode[];
    allOf?: SchemaNode[];
    $ref?: string;
    $defs?: Record<string, SchemaNode>;
}
/** 校验结果：true 或错误信息 */
export type CheckResult = true | string;
/** Standard Schema 的 issue 形状（Cordis 用它拼 ValidationError 文案） */
export interface StandardIssue {
    message: string;
    path?: readonly (string | number)[];
}
/**
 * schemastery 的品牌符号（`Symbol.for('schemastery')`）。
 *
 * 这是**宿主识别「这是原生 Config schema」的唯一标识**，来自
 * `@deepseek-ai/dsh-app-boot` 的 `isNativeConfigSchema`：
 *
 * ```js
 * function isNativeConfigSchema(value) {
 *   const meta = Reflect.get(value, 'meta')
 *   return Reflect.get(value, Symbol.for('schemastery')) === true
 *     && typeof Reflect.get(value, 'type') === 'string'
 *     && meta !== null && typeof meta === 'object'
 * }
 * ```
 *
 * 它被 `dsh-tool-cordis` 的 `liveConfig(entry)` 用来决定配置条目的状态：
 * 不满足时返回 `status: 'unsupported'`，于是该条目的 Config **不会**进入
 * `settings.describe()` 的命名空间列表 —— 症状就是设置页显示
 * 「宿主未提供本插件的配置命名空间」。
 *
 * 注意用 `Symbol.for`（全局注册表）而不是 `Symbol()`：宿主的 schemastery
 * 与我们的零依赖实现是**两份不同的代码**，只有全局注册表的同名符号才能对上。
 */
export declare const SCHEMASTERY_BRAND: unique symbol;
/** Standard Schema 的校验结果 */
export type StandardResult<T> = {
    value: T;
    issues?: undefined;
} | {
    issues: StandardIssue[];
};
/** Standard Schema 规范要求暴露在 `~standard` 上的接口 */
export interface StandardSchemaV1<T> {
    version: 1;
    vendor: string;
    validate(value: unknown): StandardResult<T>;
}
/**
 * Standard Schema 的符号键。
 *
 * Cordis 的读取方式是：`runtime.Config['~standard'].validate(config)`
 * （见 @deepseek-ai/cordis/lib/index.js 的 resolveConfig）。注意它用的是
 * 字符串键 `'~standard'`，而不是 `Symbol.for('~standard')`，因此这里必须
 * 提供「字符串键」的 getter，用 Symbol 键是取不到的。
 */
export declare const STANDARD_KEY = "~standard";
/**
 * DSH 的 Loader 表达式标记（YAML `!!js` 标量的惰性表示）。
 * 与 DSH `--dump-config-schema` 中 `$defs.loaderExpression` 完全一致。
 */
export declare const LOADER_EXPRESSION_DEF: SchemaNode;
export declare class Schema<T = unknown> {
    /** 内部分支类型，仅用于内部推导 */
    private readonly kind;
    private isRequired;
    private desc?;
    private classTitle?;
    private def?;
    private hasDefault;
    private minimum?;
    private maximum?;
    /** 值域约束（枚举） */
    private enumValues?;
    /** 内部：object 字段表（标记 @internal，仅供本模块的构建器写入） */
    /** @internal */
    fields?: Record<string, Schema>;
    /** 内部：object 的兜底元素 schema（对应 additionalProperties） */
    /** @internal */
    placeholder?: Schema;
    constructor(kind: 'string' | 'number' | 'boolean' | 'object' | 'any');
    /**
     * schemastery 的节点类型。dsh-settings 依据它分派：
     *   volatileForm(): schema.type === 'object' 时递归 dict
     *   redact walk():  switch (node.type) { case 'object' / 'dict' / ... }
     */
    /** @internal */
    get type(): string;
    /**
     * schemastery 的元信息。`meta.volatile` 是设置页渲染表单的**硬性条件**：
     *   dsh-settings 的 volatileForm(schema)：
     *     if (schema.meta.volatile) return plainSchema(schema)
     *     if (schema.type === 'object') { 对 dict 里每个 child 递归 … }
     * 没有 volatile 的叶子字段会被整棵剪掉，表单就是空的 → 设置页看不到本插件。
     */
    /** @internal */
    meta: {
        default?: unknown;
        volatile?: boolean;
        /** schemastery 用 locale 字典承载描述（mergeDesc/i18n 都按字典处理） */
        description?: Record<string, string>;
        role?: string;
    };
    /** @internal 标识自身，schemastery 用全局递增整数 */
    uid: number;
    /** @internal 是否被标记为可热编辑 */
    get volatileFlag(): boolean;
    /**
     * 把本节点（含其后代）标记为 volatile。
     * 与 schemastery 的 `.volatile()` 语义一致：字段级可热编辑。
     */
    volatile(): this;
    /** schemastery 的 `dict`（object 的字段表） */
    /** @internal */
    get dict(): Record<string, Schema> | undefined;
    /** schemastery 的 `inner`（dict/array 的元素 schema） */
    /** @internal */
    get inner(): Schema | undefined;
    /**
     * 与 schemastery 的 `toJSON()` 对齐：返回 `{ uid, refs }`，
     * refs 是「uid → 该节点可枚举属性的浅快照」的映射（跨节点共享）。
     * dsh-settings 会用 `new z(schema.toJSON())` 重建并遍历，因此 refs 里
     * 必须带 meta / dict 等字段。
     */
    toJSON(): {
        uid: number;
        refs: Record<number, unknown>;
    };
    /** 与 schemastery 一致：Schema<type> 形式的可读描述 */
    toString(): string;
    required(): this;
    description(text: string): this;
    /** 标题（部分表单实现会用它做字段标签） */
    title(text: string): this;
    default(value: T): this;
    min(value: number): this;
    max(value: number): this;
    /**
     * 约束为若干字面量之一（设置页会渲染成下拉选项）。
     * schemastery 里通常写作 `Schema.union([...])`，这里简化为值域约束：
     * 校验只接受列出的取值，投影输出 `enum`。
     */
    enum(values: readonly string[]): this;
    /** 内部：JSON Schema 类型名（@internal） */
    get typeName(): string;
    /** 内部：是否设置了默认值（@internal） */
    get hasDefaultValue(): boolean;
    /** 内部：默认值（@internal） */
    get defaultValue(): unknown;
    /**
     * Standard Schema v1 接口 —— Cordis 读的正是这个键。
     * 参考 @deepseek-ai/cordis/lib/index.js:
     *   const result = runtime.Config['~standard'].validate(config)
     *   if ('then' in result) throw ...   // 必须同步
     *   if (result.issues) throw new ValidationError(result.issues)
     *   else return result.value
     */
    get ['~standard'](): StandardSchemaV1<unknown>;
    /**
     * 校验一个值。
     * 规则与 Cordis 的「null 表示缺省」一致：null 视为可通过（由 default 或运行期兜底）。
     */
    check(value: unknown): CheckResult;
    /** 校验字面量字符串是否落在 enum 值域内 */
    private checkEnum;
    private checkObject;
    /**
     * 投影为 DSH 能读取的 JSON Schema。
     *
     * 形状刻意对齐 DSH `--dump-config-schema` 里 `dsh-goal` 的实际输出：
     *   可选字段（非 required）的字段级包装是
     *     { default?, anyOf: [ { type: ['string'|'number'|'object', 'null'], …完整定义 },
     *                          { $ref: '#/$defs/loaderExpression' } ] }
     *   而「对象本身可选」时，整个对象定义进分支，根级不留 properties：
     *     { anyOf: [ { type: ['object','null'], properties: {…} },
     *                 { $ref: '#/$defs/loaderExpression' } ] }
     *
     * Cordis 的约定：`type: [X, 'null']` 中的 null 即表示「字段可缺省」。
     */
    toJSONSchema(): SchemaNode;
    /**
     * 把构建好的节点包装成 anyOf 的「有效值」分支。
     * 与 DSH 投影一致：分支内带 `type: [X, 'null']`（null 表示可缺省），
     * description / default 等只出现在分支内，不在 anyOf 外层重复。
     */
    private asBranch;
    /** 构建不含「可选包装」的节点 */
    private buildNode;
    private baseType;
    /** 供构建器使用：读取是否 required */
    get requiredFlag(): boolean;
}
/** 构建器：与 Cordis 的 `Schema` 静态方法同名 */
export declare const SchemaBuilder: {
    string(): Schema<string>;
    number(): Schema<number>;
    boolean(): Schema<boolean>;
    object<T extends Record<string, Schema>>(fields: T): Schema<Record<string, unknown>>;
    /** 与 Cordis 的 Schema.object(...).additionalProperties(schema) 等价 */
    dict(value: Schema): Schema<Record<string, unknown>>;
    any(): Schema<unknown>;
    /** 投影为 JSON Schema */
    toJSONSchema(schema: Schema): SchemaNode;
};
/** 把投影结果补齐根级 `$defs`（有 loaderExpression 引用时才加） */
export declare function toRootSchema(schema: Schema): SchemaNode;
//# sourceMappingURL=schema.d.ts.map