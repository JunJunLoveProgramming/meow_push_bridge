/**
 * meow-push-bridge / MeoW Push Bridge (喵桥)
 * src/invariant.ts —— 包自有不变式（package-owned invariants）
 *
 * 设计原则：不变式是「纯函数 + 结构化结果」，因此
 *   - 可在 Node 的测试进程里直接调用（tests/register.spec.ts）；
 *   - 不依赖任何 DSH 内部 API，避免版本差异导致插件加载失败。
 *
 * 关于「注册」：不同 DSH/Cordis 版本对不变式注册的入口命名不一致。
 * 本模块提供 registerInvariants(ctx)，它会在以下通道中尽力注册，全部失败也不抛错：
 *   1. ctx.invariant(...) → 若返回 disposer，则透传（Cordis effect 风格）
 *   2. ctx.invariants.register(...) / ctx.invariant.register(...)
 *   3. 都不存在 → 仅记 debug 日志（本模块的 assertInvariants 仍然在加载期被显式调用，
 *      所以即使注册通道不可用，不变式检查依然生效）
 *
 * 只使用可擦除 TypeScript 语法。
 */

import type { ResolvedMeoWConfig } from './config.js'

/** 工具名常量在此重复声明，避免与 index.ts 形成循环依赖 */
export const EXPECTED_TOOL_NAME = 'meow_push_bridge'
export const EXPECTED_PLUGIN_ID = 'meow-push-bridge'
export const EXPECTED_INJECT = 'tools'

/** 一条不变式的检查结果 */
export interface InvariantViolation {
  /** 稳定标识，便于测试与日志检索 */
  id: string
  /** 人类可读说明 */
  message: string
}

/** 不变式检查函数：返回违规列表（空数组 = 通过） */
export type InvariantCheck = () => InvariantViolation[]

/** 一条不变式的定义 */
export interface InvariantDefinition {
  id: string
  description: string
  check: InvariantCheck
}

/** 检查所需的最小上下文形态（由 index.ts 传入真实值） */
export interface InvariantInput {
  /** 插件导出的 name */
  pluginName: string
  /** 插件导出的 inject */
  inject: readonly string[]
  /** 已注册（或即将注册）的工具定义 */
  definition: unknown
  /** 模块作用域内解析出的配置 */
  config: ResolvedMeoWConfig
}

/** 从任意工具定义里安全读出 parameters（不存在则返回 undefined） */
function readParameters(definition: unknown): Record<string, unknown> | undefined {
  if (definition === null || typeof definition !== 'object') return undefined
  const parameters = (definition as { parameters?: unknown }).parameters
  if (parameters === null || typeof parameters !== 'object' || Array.isArray(parameters)) {
    return undefined
  }
  return parameters as Record<string, unknown>
}

/**
 * 构建包自有不变式集合。
 *
 * @param input 加载期快照（插件名 / inject / 工具定义 / 已解析配置）
 */
export function createInvariants(input: InvariantInput): InvariantDefinition[] {
  return [
    {
      id: 'meow-push-bridge/plugin-id',
      description: '插件 ID / Cordis 插件名必须与仓库名、npm 包名统一为 meow-push-bridge',
      check: () =>
        input.pluginName === EXPECTED_PLUGIN_ID
          ? []
          : [
              {
                id: 'meow-push-bridge/plugin-id',
                message: `插件名应为 "${EXPECTED_PLUGIN_ID}"，实际为 "${input.pluginName}"。`,
              },
            ],
    },
    {
      id: 'meow-push-bridge/inject-tools',
      description: "插件必须声明 inject: ['tools']，否则 ctx.tools 不可用",
      check: () =>
        input.inject.includes(EXPECTED_INJECT)
          ? []
          : [
              {
                id: 'meow-push-bridge/inject-tools',
                message: `inject 必须包含 "${EXPECTED_INJECT}"，实际为 [${input.inject.join(', ')}]。`,
              },
            ],
    },
    {
      id: 'meow-push-bridge/tool-name',
      description: `工具名必须是 ${EXPECTED_TOOL_NAME}`,
      check: () => {
        const actual =
          input.definition !== null && typeof input.definition === 'object'
            ? (input.definition as { name?: unknown }).name
            : undefined
        return actual === EXPECTED_TOOL_NAME
          ? []
          : [
              {
                id: 'meow-push-bridge/tool-name',
                message: `工具名应为 "${EXPECTED_TOOL_NAME}"，实际为 "${String(actual)}"。`,
              },
            ]
      },
    },
    {
      id: 'meow-push-bridge/schema-required-message',
      description: '工具 schema 必须把 message 标为 required，且 title/url 保持可选',
      check: () => {
        const parameters = readParameters(input.definition)
        if (parameters === undefined) {
          return [
            {
              id: 'meow-push-bridge/schema-required-message',
              message: '工具定义缺少 parameters 对象。',
            },
          ]
        }
        const required = parameters['required']
        const requiredList = Array.isArray(required) ? required : []
        if (!requiredList.includes('message')) {
          return [
            {
              id: 'meow-push-bridge/schema-required-message',
              message: 'parameters.required 必须包含 "message"。',
            },
          ]
        }
        for (const optionalField of ['title', 'url'] as const) {
          if (requiredList.includes(optionalField)) {
            return [
              {
                id: 'meow-push-bridge/schema-required-message',
                message: `parameters.required 不应包含可选字段 "${optionalField}"。`,
              },
            ]
          }
        }
        return []
      },
    },
    {
      id: 'meow-push-bridge/schema-no-nickname',
      description: 'nickname 必须来自插件配置，绝不能出现在工具入参 schema 里',
      check: () => {
        const parameters = readParameters(input.definition)
        if (parameters === undefined) return [] // 由上一条不变式负责报错
        const properties = parameters['properties']
        const hasNickname =
          properties !== null &&
          typeof properties === 'object' &&
          Object.prototype.hasOwnProperty.call(properties, 'nickname')
        return hasNickname
          ? [
              {
                id: 'meow-push-bridge/schema-no-nickname',
                message: '工具入参 schema 中出现 nickname：昵称必须来自插件配置而非工具参数。',
              },
            ]
          : []
      },
    },
    {
      id: 'meow-push-bridge/runtime-config',
      description: '运行时配置必须已被归一化：昵称非空、地址合法、超时为正数',
      check: () => {
        const violations: InvariantViolation[] = []
        if (input.config.nickname.trim() === '') {
          violations.push({
            id: 'meow-push-bridge/runtime-config',
            message: '运行时配置 nickname 为空。',
          })
        }
        if (!/^https?:\/\/[^/\s]+/i.test(input.config.apiBase)) {
          violations.push({
            id: 'meow-push-bridge/runtime-config',
            message: `apiBase 非法："${input.config.apiBase}"。`,
          })
        }
        if (!(input.config.timeout > 0)) {
          violations.push({
            id: 'meow-push-bridge/runtime-config',
            message: `timeout 必须为正数，实际为 ${input.config.timeout}。`,
          })
        }
        return violations
      },
    },
  ]
}

/**
 * 运行一组不变式。
 *
 * @returns 违规列表（空数组 = 全部通过）
 */
export function assertInvariants(invariants: readonly InvariantDefinition[]): InvariantViolation[] {
  const violations: InvariantViolation[] = []
  for (const invariant of invariants) {
    try {
      violations.push(...invariant.check())
    } catch (error) {
      violations.push({
        id: invariant.id,
        message: `不变式检查自身抛出异常：${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }
  return violations
}

/**
 * 便捷入口：按加载期快照构建并运行全部包自有不变式。
 */
export function assertInvariantsFor(input: InvariantInput): InvariantViolation[] {
  return assertInvariants(createInvariants(input))
}

/** 注册结果，便于测试与日志 */
export interface InvariantRegistration {
  registered: boolean
  channel: 'ctx.invariant' | 'ctx.invariants.register' | 'ctx.invariant.register' | 'none'
}

/**
 * 安全读取宿主上下文上的一个可选成员。
 *
 * ⚠️ 必须用 try/catch：Cordis 的上下文对**未 inject 的服务属性**会直接抛错
 * （`Error: cannot get property "invariant" without inject`），
 * 而不是返回 undefined。曾经因为直接 `ctx.invariant` 探测，导致插件在
 * 用户填好昵称后整个加载失败（空昵称时提前 return，反而掩盖了这个 bug）。
 */
function safeGet(target: unknown, key: string): unknown {
  if (target === null || typeof target !== 'object') return undefined
  try {
    return (target as Record<string, unknown>)[key]
  } catch {
    return undefined
  }
}

/**
 * 尽力把包自有不变式注册到宿主（多通道兼容，绝不抛错）。
 *
 * 说明：本文档无法确认 DSH 是否真的提供不变式注册入口（服务目录里没有它），
 * 因此这里只做「无害探测」：任一步失败都静默跳过。
 * 真正生效的是加载期显式调用的 `assertInvariants`。
 */
export function registerInvariants(
  ctx: unknown,
  invariants: InvariantDefinition[],
  log: (level: 'info' | 'warn', message: string) => void = () => {},
): InvariantRegistration {
  if (ctx === null || typeof ctx !== 'object') return { registered: false, channel: 'none' }

  // 通道 1：ctx.invariant(invariants)
  const invariant = safeGet(ctx, 'invariant')
  if (typeof invariant === 'function') {
    try {
      ;(invariant as (value: unknown) => unknown).call(ctx, invariants)
      log('info', `已通过 ctx.invariant 注册 ${invariants.length} 条不变式。`)
      return { registered: true, channel: 'ctx.invariant' }
    } catch {
      // 静默跳过：注册通道不可用不应影响插件加载
    }
  }

  // 通道 2 / 3：ctx.invariants.register / ctx.invariant.register
  for (const [key, channel] of [
    ['invariants', 'ctx.invariants.register'],
    ['invariant', 'ctx.invariant.register'],
  ] as const) {
    const candidate = safeGet(ctx, key)
    if (candidate !== null && typeof candidate === 'object') {
      const register = safeGet(candidate, 'register')
      if (typeof register === 'function') {
        try {
          ;(register as (value: unknown) => unknown).call(candidate, invariants)
          log('info', `已通过 ${channel} 注册 ${invariants.length} 条不变式。`)
          return { registered: true, channel }
        } catch {
          // 同上，静默跳过
        }
      }
    }
  }

  // 全部通道不可用：正常情况，不算错误 —— assertInvariants 已在加载期执行
  log('info', '宿主未提供不变式注册通道，已跳过注册（加载期检查仍会执行）。')
  return { registered: false, channel: 'none' }
}
