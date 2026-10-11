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
import { LOADER_EXPRESSION_DEF, SchemaBuilder, toRootSchema } from '../dist/schema.ts'

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

test('缺省字段被默认值补齐（这是 Cordis 会把结果交给 apply 的 config）', () => {
  const resolved = cordisResolveConfig({ Config }, { nickname: 'chuck' }) as Record<string, unknown>
  assert.equal(resolved['nickname'], 'chuck')
  assert.equal(resolved['apiBase'], 'http://api.chuckfang.com')
  assert.equal(resolved['timeout'], 10_000)
  assert.equal(resolved['throttleMs'], 5_000)
})

test('null / undefined / 空对象都视为「缺省」，只补默认值不报错', () => {
  for (const input of [null, undefined, {}]) {
    const resolved = cordisResolveConfig({ Config }, input) as Record<string, unknown>
    assert.equal(resolved['apiBase'], 'http://api.chuckfang.com', `输入 ${String(input)} 应补默认值`)
    assert.equal(resolved['timeout'], 10_000)
    // nickname 无默认值 → 不写入，交由运行期判定「未配置」
    assert.ok(!('nickname' in resolved) || resolved['nickname'] === undefined)
  }
})

test('类型错误 → issues 带 path，且能拼出 Cordis 的报错文案', () => {
  assert.throws(
    () => cordisResolveConfig({ Config }, { nickname: 'chuck', timeout: 'oops' }),
    (error: unknown) => {
      assert.ok(error instanceof TypeError)
      assert.match((error as Error).message, /invalid config:/)
      assert.match((error as Error).message, /expect number \(at timeout\)/)
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

test('JSON Schema 投影包含全部 5 个可编辑字段与中文说明', () => {
  const shape = toRootSchema(Config)
  const branch = shape.anyOf?.[0]
  assert.ok(branch !== undefined, '顶层应是 anyOf[id-targeted, loaderExpression] 形状')
  assert.deepEqual(branch.type, ['object', 'null'])

  const properties = branch.properties ?? {}
  assert.deepEqual(
    Object.keys(properties).sort(),
    ['apiBase', 'nickname', 'pushMode', 'throttleMs', 'timeout'],
  )

  for (const [key, node] of Object.entries(properties)) {
    const inner = node.anyOf?.[0]
    assert.ok(inner !== undefined, `${key} 应有 anyOf 分支`)
    assert.equal(typeof inner.description, 'string', `${key} 需要有说明文案（表单标签）`)
    assert.ok((inner.description ?? '').length > 0)
    assert.deepEqual(node.anyOf?.[1], { $ref: '#/$defs/loaderExpression' })
  }
})

test('数字字段带默认值与范围约束', () => {
  const branch = toRootSchema(Config).anyOf?.[0]
  const timeout = branch?.properties?.['timeout']?.anyOf?.[0]
  assert.equal(timeout?.default, 10_000)
  assert.equal(timeout?.minimum, 100)
  assert.equal(timeout?.maximum, 120_000)

  const throttle = branch?.properties?.['throttleMs']?.anyOf?.[0]
  assert.equal(throttle?.default, 5_000)
  assert.equal(throttle?.minimum, 0)
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
  assert.deepEqual(
    Object.keys(config.dict).sort(),
    ['apiBase', 'nickname', 'pushMode', 'throttleMs', 'timeout'],
  )
  assert.equal(config.dict['nickname']?.type, 'string')
  assert.equal(config.dict['timeout']?.type, 'number')
  assert.equal(config.dict['pushMode']?.type, 'string', 'pushMode 是枚举字符串（设置页下拉）')
  for (const [key, child] of Object.entries(config.dict)) {
    assert.equal(child.meta.volatile, true, `${key} 必须标记 volatile，否则设置页整棵剪掉`)
  }
})

test('复刻 volatileForm：我们的 Config 能通过设置页的筛选闸门', () => {
  /** 逐行照抄 dsh-settings 的 volatileForm 判定（plainSchema 部分用等价检查代替） */
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
  // 每个字段也应在 refs 里（通过 uid 引用）：根 + 5 个字段
  assert.equal(Object.keys(json.refs).length, 6, '根 + 5 个字段')
})

test('pushMode 投影出 enum，供设置页渲染下拉', () => {
  const branch = toRootSchema(Config).anyOf?.[0]
  const inner = branch?.properties?.['pushMode']?.anyOf?.[0]
  assert.deepEqual(inner?.enum, ['every-turn', 'substantial', 'off'])
  assert.equal(inner?.default, 'every-turn')
})

test('pushMode 校验拒绝非法取值', () => {
  const standard = (Config as unknown as {
    '~standard': { validate(value: unknown): { issues?: { message: string }[]; value?: unknown } }
  })['~standard']
  const bad = standard.validate({ nickname: 'n', pushMode: 'bogus' })
  assert.ok(bad.issues !== undefined, '非法 pushMode 应产生 issue')
  assert.match(bad.issues?.[0]?.message ?? '', /every-turn/)
  const good = standard.validate({ nickname: 'n', pushMode: 'substantial' })
  assert.equal((good.value as { pushMode?: string }).pushMode, 'substantial')
})

test('meta 形状对齐 schemastery：default 放 meta.default，description 是 locale 字典', () => {
  const dict = (Config as unknown as {
    dict: Record<string, { meta: { default?: unknown; description?: Record<string, string> } }>
  }).dict
  assert.equal(dict['apiBase']?.meta.default, 'http://api.chuckfang.com')
  assert.equal(dict['timeout']?.meta.default, 10_000)
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
