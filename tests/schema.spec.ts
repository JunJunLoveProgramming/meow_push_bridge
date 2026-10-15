/**
 * tests/schema.spec.ts —— Config schema（设置页表单）契约测试
 *
 * 背景：DSH 的 settings 服务要把插件配置渲染成可视化表单，前提是插件入口
 * 导出 `Config`；而 Cordis 读取它的方式是（来自 @deepseek-ai/cordis 实现）：
 *
 *   function resolveConfig(runtime, config) {
 *     if (!runtime.Config) return config
 *     const result = runtime.Config['~standard'].validate(config)
 *     if ('then' in result) throw new TypeError('Async config validation is not supported')
 *     if (result.issues) throw new ValidationError(result.issues)
 *     else return result.value
 *   }
 *
 * 因此本文件的断言直接锁死这份契约：字符串键 `~standard`、同步、issues 形状、
 * 以及「缺省字段用默认值补齐」的行为。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { Config } from '../dist/index.ts'
import { LOADER_EXPRESSION_DEF, SCHEMASTERY_BRAND, SchemaBuilder, toRootSchema } from '../dist/schema.ts'

/** 复刻 Cordis 的 ValidationError 文案构造 */
function cordisValidationMessage(issues: { message: string; path?: readonly unknown[] }[]): string {
  return (
    'invalid config:\n' +
    issues
      .map((issue) =>
        issue.path ? `  - ${issue.message} (at ${issue.path.join('.')})` : `  - ${issue.message}`,
      )
      .join('\n')
  )
}

/** 复刻 Cordis 的 resolveConfig（正常返回解析后的 config，失败抛出） */
function cordisResolveConfig(runtime: { Config?: unknown }, config: unknown): unknown {
  const schema = runtime.Config as
    | { '~standard'?: { validate(value: unknown): unknown } }
    | undefined
  if (schema === undefined) return config
  const standard = schema['~standard']
  assert.ok(standard !== undefined, "Config 必须提供 '~standard' 键（字符串键，不是 Symbol）")
  const result = standard.validate(config) as
    | { value?: unknown; issues?: { message: string; path?: readonly unknown[] }[] }
    | Promise<unknown>
  assert.ok(!(result instanceof Promise), '校验必须同步：Cordis 会拒绝 thenable')
  assert.ok(!('then' in (result as object)), '校验必须同步：Cordis 会拒绝 thenable')
  const typed = result as { value?: unknown; issues?: { message: string; path?: readonly unknown[] }[] }
  if (typed.issues !== undefined) throw new TypeError(cordisValidationMessage(typed.issues))
  return typed.value
}

// ─────────────── 1. Standard Schema 契约 ───────────────

test('Config 提供字符串键 ~standard，且 version/vendor 正确', () => {
  const standard = (Config as unknown as Record<string, unknown>)['~standard'] as
    | { version: number; vendor: string }
    | undefined
  assert.ok(standard !== undefined, "缺少 '~standard' 键 —— 设置页表单会失效且插件加载报错")
  assert.equal(standard.version, 1)
  assert.equal(typeof standard.vendor, 'string')
  assert.ok(standard.vendor.length > 0)
})

test('校验是同步的（Cordis 明确拒绝 Async config validation）', () => {
  const standard = (Config as unknown as Record<string, unknown>)['~standard'] as {
    validate(value: unknown): unknown
  }
  const result = standard.validate({ nickname: 'chuck' }) as Record<string, unknown>
  assert.equal(typeof (result as { then?: unknown }).then, 'undefined')
  assert.ok('value' in result)
})

test('配置只有昵称一个字段（其余请求细节已固化，不再暴露）', () => {
  const resolved = cordisResolveConfig({ Config }, { nickname: 'chuck' }) as Record<string, unknown>
  assert.equal(resolved['nickname'], 'chuck')
  assert.deepEqual(Object.keys(resolved), ['nickname'], '不应再有其他配置字段')
})

test('null / undefined / 空对象都视为「缺省」，不报错', () => {
  for (const input of [null, undefined, {}]) {
    const resolved = cordisResolveConfig({ Config }, input) as Record<string, unknown>
    // nickname 无默认值 → 不写入，交由运行期判定「未配置」
    assert.ok(!('nickname' in resolved) || resolved['nickname'] === undefined)
    assert.deepEqual(Object.keys(resolved), [], `输入 ${String(input)} 不应产生额外字段`)
  }
})

test('类型错误 → issues 带 path，且能拼出 Cordis 的报错文案', () => {
  assert.throws(
    () => cordisResolveConfig({ Config }, { nickname: 42 }),
    (error: unknown) => {
      assert.ok(error instanceof TypeError)
      assert.match((error as Error).message, /invalid config:/)
      assert.match((error as Error).message, /expect string \(at nickname\)/)
      return true
    },
  )
})

test('非对象输入 → issues', () => {
  assert.throws(() => cordisResolveConfig({ Config }, [1, 2, 3]), /expect object/)
})

test('未知字段被保留（运行期 resolveConfig 会忽略，不阻断加载）', () => {
  const resolved = cordisResolveConfig({ Config }, { nickname: 'a', futureField: 42 }) as Record<
    string,
    unknown
  >
  assert.equal(resolved['futureField'], 42)
})

test('设置页用户清空昵称 → 不报校验错（昵称判定交给运行期）', () => {
  const resolved = cordisResolveConfig({ Config }, { nickname: '' }) as Record<string, unknown>
  assert.equal(resolved['nickname'], '')
})

// ─────────────── 2. 表单字段元数据 ───────────────

test('JSON Schema 投影只含 nickname 一个可编辑字段与中文说明', () => {
  const shape = toRootSchema(Config)
  const branch = shape.anyOf?.[0]
  assert.ok(branch !== undefined, '顶层应是 anyOf[id-targeted, loaderExpression] 形状')
  assert.deepEqual(branch.type, ['object', 'null'])

  const properties = branch.properties ?? {}
  assert.deepEqual(Object.keys(properties).sort(), ['nickname'])

  for (const [key, node] of Object.entries(properties)) {
    const inner = node.anyOf?.[0]
    assert.ok(inner !== undefined, `${key} 应有 anyOf 分支`)
    assert.equal(typeof inner.description, 'string', `${key} 需要有说明文案（表单标签）`)
    assert.ok((inner.description ?? '').length > 0)
    assert.deepEqual(node.anyOf?.[1], { $ref: '#/$defs/loaderExpression' })
  }
})

test('nickname 无默认值（缺失必须由运行期拒绝注册，而不是被默认值掩盖）', () => {
  const branch = toRootSchema(Config).anyOf?.[0]
  const nickname = branch?.properties?.['nickname']?.anyOf?.[0]
  assert.ok(!('default' in (nickname ?? {})), 'nickname 不应有默认值')
})

test('$defs.loaderExpression 只在被引用时出现，且与 DSH 的定义一致', () => {
  const shape = toRootSchema(Config)
  assert.equal(shape.$defs?.['loaderExpression']?.['$ref'], undefined)
  assert.ok(shape.$defs?.loaderExpression !== undefined)
  assert.equal(shape.$defs.loaderExpression.type, 'object')
  assert.deepEqual(shape.$defs.loaderExpression.required, ['__jsExpr'])
  assert.deepEqual(
    Object.keys(shape.$defs.loaderExpression.properties ?? {}),
    Object.keys(LOADER_EXPRESSION_DEF.properties ?? {}),
  )
})

// ─────────────── 4. schemastery 内部形状（设置页表单的硬性要求） ───────────────
//
// 依据 dsh-settings/lib/types/schema.js 的真实实现：
//   function volatileForm(schema) {
//     if (schema.meta.volatile) return plainSchema(schema)
//     if (schema.type === 'object') { 对 dict 每个 child 递归，全被剪掉则返回 undefined }
//   }
//   describe(): const form = volatileForm(schema); if (form === void 0) return []   ← 被跳过
// 以及 redact.js 的 walk(node)：switch (node.type) { case 'object' … }
// 所以：type 必须是 'object'/'string'/'number'，且字段必须带 meta.volatile。

test('节点形状：type 是数据类型（不是自定义标识），dict/meta 就位', () => {
  const config = Config as unknown as {
    type: string
    meta: { volatile?: boolean; default?: unknown }
    dict: Record<string, { type: string; meta: { volatile?: boolean } }>
  }
  assert.equal(config.type, 'object', "type 必须是 'object'：占用它会让 volatileForm 与 redact 都失效")
  assert.equal(config.meta.volatile, true, '根节点需标记 volatile')
  assert.deepEqual(Object.keys(config.dict).sort(), ['nickname'])
  assert.equal(config.dict['nickname']?.type, 'string')
  for (const [key, child] of Object.entries(config.dict)) {
    assert.equal(child.meta.volatile, true, `${key} 必须标记 volatile，否则设置页整棵剪掉`)
  }
})

// ─────── 宿主识别：schemastery 品牌标记（设置页命名空间的前提） ───────
//
// 依据 @deepseek-ai/dsh-app-boot 的 isNativeConfigSchema：
//   Reflect.get(value, Symbol.for('schemastery')) === true
//   && typeof Reflect.get(value, 'type') === 'string'
//   && meta !== null && typeof meta === 'object'
// 不满足时 dsh-tool-cordis 的 liveConfig() 返回 status:'unsupported'，
// 该条目就不会出现在 settings.describe() 的命名空间里 ——
// 症状是设置页显示「宿主未提供本插件的配置命名空间」。

/** 逐字复刻宿主的 isNativeConfigSchema */
function hostIsNativeConfigSchema(value: unknown): boolean {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return false
  const target = value as object
  const meta = Reflect.get(target, 'meta')
  return (
    Reflect.get(target, Symbol.for('schemastery')) === true &&
    typeof Reflect.get(target, 'type') === 'string' &&
    meta !== null &&
    typeof meta === 'object'
  )
}

test('Config 带 schemastery 品牌标记，能被宿主识别为原生 schema', () => {
  assert.equal(Reflect.get(Config as object, SCHEMASTERY_BRAND), true)
  assert.equal(
    Reflect.get(Config as object, Symbol.for('schemastery')),
    true,
    '必须用全局注册表的 Symbol.for("schemastery")，否则宿主的另一份实现认不出来',
  )
  assert.equal(hostIsNativeConfigSchema(Config), true, '不通过则设置页拿不到配置命名空间')
})

test('所有子节点同样带品牌标记（宿主可能逐节点检查）', () => {
  const dict = (Config as unknown as { dict: Record<string, unknown> }).dict
  for (const [key, child] of Object.entries(dict)) {
    assert.equal(hostIsNativeConfigSchema(child), true, `字段 ${key} 缺品牌标记或形状不对`)
  }
})

test('去掉品牌标记后会被宿主判为 unsupported（反向验证检查有效）', () => {
  const decoy = Object.create(null) as Record<string | symbol, unknown>
  Reflect.set(decoy, 'type', 'object')
  Reflect.set(decoy, 'meta', {})
  assert.equal(hostIsNativeConfigSchema(decoy), false, '没有品牌标记就不该通过')

  // 缺 meta 也不通过
  const noMeta = Object.create(null) as Record<string | symbol, unknown>
  Reflect.set(noMeta, Symbol.for('schemastery'), true)
  Reflect.set(noMeta, 'type', 'object')
  assert.equal(hostIsNativeConfigSchema(noMeta), false, '缺 meta 不该通过')
})

test('复刻 volatileForm：我们的 Config 能通过设置页的筛选闸门', () => {  /** 逐行照抄 dsh-settings 的 volatileForm 判定（plainSchema 部分用等价检查代替） */
  function hasForm(schema: unknown): boolean {
    const node = schema as { meta?: { volatile?: boolean }; type?: string; dict?: Record<string, unknown> }
    if (node.meta?.volatile === true) return true
    if (node.type === 'object') {
      return Object.values(node.dict ?? {}).some((child) => hasForm(child))
    }
    return false
  }
  assert.equal(hasForm(Config), true, 'volatileForm 返回 undefined 会导致设置页看不到本插件')
})

test('toJSON() 返回 schemastery 的 { uid, refs }，且 refs 内含 type/meta/dict', () => {
  const json = (Config as unknown as { toJSON(): { uid: number; refs: Record<number, unknown> } }).toJSON()
  assert.equal(typeof json.uid, 'number')
  assert.ok(json.uid > 0)
  const root = json.refs[json.uid] as { type?: string; meta?: unknown; dict?: unknown } | undefined
  assert.ok(root !== undefined, 'refs 必须包含根节点，否则 describe() 的 revision 计算会拿到 undefined')
  assert.equal(root.type, 'object')
  assert.ok('meta' in root)
  assert.ok('dict' in root)
  // 每个字段也应在 refs 里（通过 uid 引用）：根 + 1 个字段
  assert.equal(Object.keys(json.refs).length, 2, '根 + 1 个字段')
})

test('配置只有 nickname 时校验通过；多余字段被忽略', () => {
  const standard = (Config as unknown as {
    '~standard': { validate(value: unknown): { issues?: { message: string }[]; value?: unknown } }
  })['~standard']
  const good = standard.validate({ nickname: '骏骏爱编程' })
  assert.equal(good.issues, undefined)
  assert.equal((good.value as { nickname?: string }).nickname, '骏骏爱编程')

  // 旧的已移除字段不应导致校验失败（平滑升级）
  const legacy = standard.validate({ nickname: 'n', apiBase: 'http://x', pushMode: 'off' })
  assert.equal(legacy.issues, undefined, '旧的已移除字段应被容忍')
})

test('meta 形状对齐 schemastery：description 是 locale 字典，nickname 无默认值', () => {
  const dict = (Config as unknown as {
    dict: Record<string, { meta: { default?: unknown; description?: Record<string, string> } }>
  }).dict
  assert.ok(!('default' in (dict['nickname']?.meta ?? {})), 'nickname 不应有默认值')
  // schemastery 的 mergeDesc/i18n 按 locale 字典处理 description
  assert.equal(typeof dict['nickname']?.meta.description, 'object')
  assert.match(dict['nickname']?.meta.description?.[''] ?? '', /必填/)
})

test('volatile() 可递归标记后代，且 type 不受影响', () => {
  const built = SchemaBuilder.object({
    child: SchemaBuilder.string().default('x'),
  }).volatile()
  const node = built as unknown as {
    meta: { volatile?: boolean }
    dict: Record<string, { meta: { volatile?: boolean; default?: unknown } }>
  }
  assert.equal(node.meta.volatile, true)
  assert.equal(node.dict['child']?.meta.volatile, true, 'volatile() 应递归到后代')
  assert.equal(node.dict['child']?.meta.default, 'x')
})


// ─────────────── 5. 构造器行为 ───────────────

test('SchemaBuilder 基本类型校验', () => {
  assert.equal(SchemaBuilder.string().check('a'), true)
  assert.equal(SchemaBuilder.string().check(1), 'expect string')
  assert.equal(SchemaBuilder.number().check(1), true)
  assert.equal(SchemaBuilder.number().check(Number.NaN), 'expect number')
  assert.equal(SchemaBuilder.boolean().check(true), true)
  assert.equal(SchemaBuilder.boolean().check('true'), 'expect boolean')
  // null/undefined 一律视为缺省，交由 default 或运行期兜底
  assert.equal(SchemaBuilder.string().check(null), true)
  assert.equal(SchemaBuilder.number().check(undefined), true)
})

test('required 字段不带 loaderExpression 分支', () => {
  const projected = SchemaBuilder.object({
    token: SchemaBuilder.string().required(),
  }).toJSONSchema()
  // 对象自身可选 → 走 anyOf 包装；字段表位于第一个分支内
  const branch = projected.anyOf?.[0]
  assert.deepEqual(branch?.required, ['token'])
  const token = branch?.properties?.['token']
  assert.deepEqual(token?.type, 'string')
  assert.equal(token?.anyOf, undefined, 'required 字段不应带 loaderExpression 分支')
})
