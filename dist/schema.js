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
export const SCHEMASTERY_BRAND = Symbol.for('schemastery');
/**
 * Standard Schema 的符号键。
 *
 * Cordis 的读取方式是：`runtime.Config['~standard'].validate(config)`
 * （见 @deepseek-ai/cordis/lib/index.js 的 resolveConfig）。注意它用的是
 * 字符串键 `'~standard'`，而不是 `Symbol.for('~standard')`，因此这里必须
 * 提供「字符串键」的 getter，用 Symbol 键是取不到的。
 */
export const STANDARD_KEY = '~standard';
/** 判断是否「缺省」（Standard Schema 里 null 与 undefined 都视为未提供） */
function isAbsent(value) {
    return value === undefined || value === null;
}
/**
 * 按字段表规范化并校验一个配置对象。
 * 返回 `{ value }`（已补默认值）或 `{ issues }`。
 */
function validateAgainstFields(fields, raw) {
    if (isAbsent(raw)) {
        const value = {};
        for (const [key, field] of Object.entries(fields)) {
            if (field.hasDefaultValue)
                value[key] = field.defaultValue;
        }
        return { value };
    }
    if (typeof raw !== 'object' || Array.isArray(raw)) {
        return { issues: [{ message: 'expect object' }] };
    }
    const table = raw;
    const issues = [];
    const value = {};
    for (const [key, field] of Object.entries(fields)) {
        const present = table[key];
        if (isAbsent(present)) {
            // 缺省：用默认值补齐（没有默认值就不写入，交给运行期兜底）
            if (field.hasDefaultValue)
                value[key] = field.defaultValue;
            continue;
        }
        // 缺省包装后的 schema 在分支里带 type，这里用字段自身的类型校验。
        // 报错文案优先用 check() 给出的具体原因（例如枚举越界的 "expect one of …"），
        // 而不是笼统的 "expected string" —— 用户在设置页填错时需要知道可选值。
        const result = field.check(present);
        if (result !== true) {
            issues.push({ message: result, path: [key] });
            continue;
        }
        value[key] = present;
    }
    // 携带未知字段：运行期 resolveConfig 会忽略它们，不阻断加载
    for (const key of Object.keys(table)) {
        if (!(key in fields))
            value[key] = table[key];
    }
    return issues.length > 0 ? { issues } : { value };
}
/**
 * DSH 的 Loader 表达式标记（YAML `!!js` 标量的惰性表示）。
 * 与 DSH `--dump-config-schema` 中 `$defs.loaderExpression` 完全一致。
 */
export const LOADER_EXPRESSION_DEF = {
    type: 'object',
    properties: { __jsExpr: { type: 'string' } },
    required: ['__jsExpr'],
    description: 'Inert representation of a YAML !!js scalar from the Cordis entry-list parser. Its result is evaluated and validated only at runtime. Extra marker-object fields are ignored by interpolation.',
};
/**
 * 一个 schema 节点。调用链与 Cordis 一致：
 *   Schema.string().required().description('...').default('x')
 *
 * 它同时满足两套契约：
 *   1. **Standard Schema**（字符串键 `~standard`）—— Cordis 用它解析/校验配置；
 *   2. **schemastery 内部形状**（`type` / `dict` / `inner` / `meta` / `volatile()` / `toJSON()`）
 *      —— dsh-settings 用它生成设置页表单（`volatileForm` 硬性检查 `meta.volatile`）。
 * 两套都满足，插件才能「既加载成功、又出现在设置页」。
 */
let schemaUidCounter = 0;
function nextSchemaUid() {
    schemaUidCounter += 1;
    return schemaUidCounter;
}
export class Schema {
    // 注意：这里**不能**用 `readonly type = 'schema'` 之类的标识字段！
    // schemastery 的节点用 `type` 表示数据类型（'object' / 'string' / 'number' …），
    // dsh-settings 的 volatileForm 与 redact 都靠它分派；占用该字段会让表单取不到字段。
    // Cordis 识别 schema 靠的是 '~standard' 键，不需要额外标识。
    /** 内部分支类型，仅用于内部推导 */
    kind;
    isRequired = false;
    desc;
    classTitle;
    def;
    hasDefault = false;
    minimum;
    maximum;
    /** 值域约束（枚举） */
    enumValues;
    /** 内部：object 字段表（标记 @internal，仅供本模块的构建器写入） */
    /** @internal */
    fields;
    /** 内部：object 的兜底元素 schema（对应 additionalProperties） */
    /** @internal */
    placeholder;
    constructor(kind) {
        this.kind = kind;
        // schemastery 的 object 类型默认 meta.default = {}
        this.meta = kind === 'object' ? { default: {} } : {};
        // 打上宿主识别的品牌标记。缺了它，dsh-tool-cordis 会把本插件的配置条目
        // 判为 'unsupported'，设置页就会报「宿主未提供本插件的配置命名空间」。
        // 用 Reflect.set 写入：计算属性名里的符号在类型层面不好标注。
        Reflect.set(this, SCHEMASTERY_BRAND, true);
    }
    // ── 对齐 schemastery 的内部形状（设置页表单靠这些字段工作） ──────
    /**
     * schemastery 的节点类型。dsh-settings 依据它分派：
     *   volatileForm(): schema.type === 'object' 时递归 dict
     *   redact walk():  switch (node.type) { case 'object' / 'dict' / ... }
     */
    /** @internal */
    get type() {
        return this.baseType();
    }
    /**
     * schemastery 的元信息。`meta.volatile` 是设置页渲染表单的**硬性条件**：
     *   dsh-settings 的 volatileForm(schema)：
     *     if (schema.meta.volatile) return plainSchema(schema)
     *     if (schema.type === 'object') { 对 dict 里每个 child 递归 … }
     * 没有 volatile 的叶子字段会被整棵剪掉，表单就是空的 → 设置页看不到本插件。
     */
    /** @internal */
    meta = {};
    /** @internal 标识自身，schemastery 用全局递增整数 */
    uid = nextSchemaUid();
    /** @internal 是否被标记为可热编辑 */
    get volatileFlag() {
        return this.meta.volatile === true;
    }
    /**
     * 把本节点（含其后代）标记为 volatile。
     * 与 schemastery 的 `.volatile()` 语义一致：字段级可热编辑。
     */
    volatile() {
        this.meta.volatile = true;
        for (const child of Object.values(this.fields ?? {}))
            child.volatile();
        if (this.placeholder !== undefined)
            this.placeholder.volatile();
        return this;
    }
    /** schemastery 的 `dict`（object 的字段表） */
    /** @internal */
    get dict() {
        return this.fields;
    }
    /** schemastery 的 `inner`（dict/array 的元素 schema） */
    /** @internal */
    get inner() {
        return this.placeholder;
    }
    /**
     * 与 schemastery 的 `toJSON()` 对齐：返回 `{ uid, refs }`，
     * refs 是「uid → 该节点可枚举属性的浅快照」的映射（跨节点共享）。
     * dsh-settings 会用 `new z(schema.toJSON())` 重建并遍历，因此 refs 里
     * 必须带 meta / dict 等字段。
     */
    toJSON() {
        const refs = {};
        const collect = (node) => {
            if (refs[node.uid] !== undefined)
                return;
            const plain = {
                type: node.baseType(),
                meta: { ...node.meta },
            };
            if (node.desc !== undefined)
                plain['description'] = node.desc;
            if (node.classTitle !== undefined)
                plain['title'] = node.classTitle;
            if (node.minimum !== undefined)
                plain['min'] = node.minimum;
            if (node.maximum !== undefined)
                plain['max'] = node.maximum;
            if (node.fields !== undefined) {
                const dict = {};
                for (const [key, child] of Object.entries(node.fields)) {
                    collect(child);
                    dict[key] = child.uid;
                }
                plain['dict'] = dict;
            }
            if (node.placeholder !== undefined) {
                collect(node.placeholder);
                plain['inner'] = node.placeholder.uid;
            }
            refs[node.uid] = plain;
        };
        collect(this);
        return { uid: this.uid, refs };
    }
    /** 与 schemastery 一致：Schema<type> 形式的可读描述 */
    toString() {
        return `Schema<${this.baseType()}>`;
    }
    // ── 链式 API ────────────────────────────────────────────────
    required() {
        this.isRequired = true;
        return this;
    }
    description(text) {
        this.desc = text;
        // schemastery 的 meta.description 是 locale 字典；'' 是默认语言键（见 mergeDesc）
        this.meta.description = { '': text };
        return this;
    }
    /** 标题（部分表单实现会用它做字段标签） */
    title(text) {
        this.classTitle = text;
        return this;
    }
    default(value) {
        this.def = value;
        this.hasDefault = true;
        // schemastery 把默认值放在 meta.default（simplify / property 都读它）
        this.meta.default = value;
        return this;
    }
    min(value) {
        this.minimum = value;
        return this;
    }
    max(value) {
        this.maximum = value;
        return this;
    }
    /**
     * 约束为若干字面量之一（设置页会渲染成下拉选项）。
     * schemastery 里通常写作 `Schema.union([...])`，这里简化为值域约束：
     * 校验只接受列出的取值，投影输出 `enum`。
     */
    enum(values) {
        this.enumValues = [...values];
        return this;
    }
    // ── 校验 ────────────────────────────────────────────────────
    /** 内部：JSON Schema 类型名（@internal） */
    get typeName() {
        return this.baseType();
    }
    /** 内部：是否设置了默认值（@internal） */
    get hasDefaultValue() {
        return this.hasDefault;
    }
    /** 内部：默认值（@internal） */
    get defaultValue() {
        return this.def;
    }
    /**
     * Standard Schema v1 接口 —— Cordis 读的正是这个键。
     * 参考 @deepseek-ai/cordis/lib/index.js:
     *   const result = runtime.Config['~standard'].validate(config)
     *   if ('then' in result) throw ...   // 必须同步
     *   if (result.issues) throw new ValidationError(result.issues)
     *   else return result.value
     */
    get ['~standard']() {
        return {
            version: 1,
            vendor: 'meow-push-bridge',
            validate: (value) => {
                if (this.kind !== 'object') {
                    const result = this.check(value);
                    return result === true
                        ? { value }
                        : { issues: [{ message: `expected ${this.baseType()}` }] };
                }
                const fields = this.fields ?? {};
                const result = validateAgainstFields(fields, value);
                if ('issues' in result && result.issues !== undefined)
                    return result;
                return result;
            },
        };
    }
    /**
     * 校验一个值。
     * 规则与 Cordis 的「null 表示缺省」一致：null 视为可通过（由 default 或运行期兜底）。
     */
    check(value) {
        if (value === undefined || value === null)
            return true;
        switch (this.kind) {
            case 'object':
                return this.checkObject(value);
            case 'string':
                return typeof value === 'string' ? this.checkEnum(value) : 'expect string';
            case 'number':
                return typeof value === 'number' && Number.isFinite(value) ? true : 'expect number';
            case 'boolean':
                return typeof value === 'boolean' ? true : 'expect boolean';
            default:
                return true;
        }
    }
    /** 校验字面量字符串是否落在 enum 值域内 */
    checkEnum(value) {
        const allowed = this.enumValues;
        if (allowed === undefined || allowed.length === 0)
            return true;
        return allowed.includes(value) ? true : `expect one of ${allowed.join(' | ')}`;
    }
    checkObject(value) {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
            return 'expect object';
        }
        const table = value;
        const fields = this.fields;
        if (fields !== undefined) {
            if (typeof table['__jsExpr'] === 'string')
                return true; // loader 表达式，运行期再校验
            for (const key of Object.keys(table)) {
                const field = fields[key];
                if (field === undefined)
                    continue; // 额外字段由运行期 resolveConfig 忽略，不阻断
                const result = field.check(table[key]);
                if (result !== true)
                    return `$.${key} ${result}`;
            }
        }
        const placeholder = this.placeholder;
        if (placeholder !== undefined) {
            for (const key of Object.keys(table)) {
                const result = placeholder.check(table[key]);
                if (result !== true)
                    return `$.${key} ${result}`;
            }
        }
        return true;
    }
    // ── JSON Schema 投影 ────────────────────────────────────────
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
    toJSONSchema() {
        const node = this.buildNode();
        if (this.isRequired)
            return node;
        return { anyOf: [this.asBranch(node), { $ref: '#/$defs/loaderExpression' }] };
    }
    /**
     * 把构建好的节点包装成 anyOf 的「有效值」分支。
     * 与 DSH 投影一致：分支内带 `type: [X, 'null']`（null 表示可缺省），
     * description / default 等只出现在分支内，不在 anyOf 外层重复。
     */
    asBranch(node) {
        const branch = { ...node };
        delete branch.anyOf;
        branch.type = [this.baseType(), 'null'];
        return branch;
    }
    /** 构建不含「可选包装」的节点 */
    buildNode() {
        const node = {};
        if (this.kind === 'object') {
            const properties = {};
            for (const key of Object.keys(this.fields ?? {})) {
                const field = this.fields?.[key];
                if (field !== undefined)
                    properties[key] = field.toJSONSchema();
            }
            if (Object.keys(properties).length > 0)
                node.properties = properties;
            node.additionalProperties = true;
            const requiredKeys = Object.keys(this.fields ?? {}).filter((key) => this.fields?.[key]?.isRequired === true);
            if (requiredKeys.length > 0)
                node.required = requiredKeys;
        }
        else if (this.kind !== 'any') {
            node.type = this.baseType();
        }
        if (this.desc !== undefined)
            node.description = this.desc;
        if (this.classTitle !== undefined)
            node.title = this.classTitle;
        if (this.hasDefault)
            node.default = this.def;
        if (this.minimum !== undefined)
            node.minimum = this.minimum;
        if (this.maximum !== undefined)
            node.maximum = this.maximum;
        if (this.enumValues !== undefined)
            node.enum = [...this.enumValues];
        if (this.placeholder !== undefined) {
            node.additionalProperties = this.placeholder.toJSONSchema();
        }
        return node;
    }
    baseType() {
        switch (this.kind) {
            case 'string':
                return 'string';
            case 'number':
                return 'number';
            case 'boolean':
                return 'boolean';
            case 'object':
                return 'object';
            default:
                // 'any'：JSON Schema 没有 unknown 类型，退化为不校验的具体类型
                return 'object';
        }
    }
    /** 供构建器使用：读取是否 required */
    get requiredFlag() {
        return this.isRequired;
    }
}
/** 构建器：与 Cordis 的 `Schema` 静态方法同名 */
export const SchemaBuilder = {
    string() {
        return new Schema('string');
    },
    number() {
        return new Schema('number');
    },
    boolean() {
        return new Schema('boolean');
    },
    object(fields) {
        const schema = new Schema('object');
        schema.fields = fields;
        return schema;
    },
    /** 与 Cordis 的 Schema.object(...).additionalProperties(schema) 等价 */
    dict(value) {
        const schema = new Schema('object');
        schema.placeholder = value;
        return schema;
    },
    any() {
        return new Schema('any');
    },
    /** 投影为 JSON Schema */
    toJSONSchema(schema) {
        return schema.toJSONSchema();
    },
};
/**
 * 本模块**不**导出 `Config`。
 *
 * 原因：Cordis 的约定是「从插件入口模块导出 `Config`」，而 `src/index.ts` 就是
 * 那个入口。若这里也导出 `Config`，一旦有人从 index 里 `export * from './schema.js'`，
 * 就会出现两个同名的 `Config` 导出（DSH 属于 ESM 严格模式，重复导出会直接报错）。
 * 因此 schema 的声明唯一放在 `src/index.ts`，本模块只提供构造器与投影工具。
 */
/** 提取 schema 中出现的 `$ref`，用于按需输出根级 `$defs` */
function collectRefs(node, refs) {
    if (node.$ref !== undefined)
        refs.add(node.$ref);
    for (const branch of node.anyOf ?? [])
        collectRefs(branch, refs);
    for (const branch of node.allOf ?? [])
        collectRefs(branch, refs);
    for (const child of Object.values(node.properties ?? {}))
        collectRefs(child, refs);
    if (node.items !== undefined)
        collectRefs(node.items, refs);
}
/** 把投影结果补齐根级 `$defs`（有 loaderExpression 引用时才加） */
export function toRootSchema(schema) {
    const node = schema.toJSONSchema();
    const refs = new Set();
    collectRefs(node, refs);
    if (refs.has('#/$defs/loaderExpression')) {
        node.$defs = { loaderExpression: LOADER_EXPRESSION_DEF };
    }
    return node;
}
//# sourceMappingURL=schema.js.map