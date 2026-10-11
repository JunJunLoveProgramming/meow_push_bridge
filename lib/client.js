/**
 * meow-push-bridge / MeoW Push Bridge (喵桥)
 * src/client.js —— 浏览器半体：DSH 设置页里的「喵桥」配置页签
 *
 * ⚠️ 本文件是**预构建产物**，不是普通模块，也不是 TypeScript 源码：
 *    DSH 的客户端模块系统（@deepseek-ai/dsh-client-modules）要求
 *    package.json 的 `exports["./client"]` 指向一个**已打包**的文件，
 *    其格式必须是 `window.__ModuleLoader__.load({ id, factory })`，
 *    由 factory 内的 `require(...)` 取用宿主提供的共享模块（react 等）。
 *    若该文件缺失，DSH 启动会报 MissingClientBundleError
 *    （"run `pnpm run build` before launch"）。
 *
 *    因为我们的配置表单很简单，这里**手写**这份 bundle，不引入 esbuild/vite 等
 *    构建链。scripts/copy-client.mjs 会在 build 时把它复制到 lib/client.js。
 *
 * 依赖（宿主提供，通过 require 取用）：
 *   - react                  → React（hooks）
 *
 * 注入的服务（见 package.json 的 dsh.client.inject）：
 *   - slots  → 注册设置页签
 *   - locale → 中英文字典
 *   - remote → remote.settings.describe() / update()（宿主已编入目录的权威契约）
 */

window.__ModuleLoader__.load({
  id: 'meow-push-bridge',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')

    // ── 插件自己的字典命名空间 ──────────────────────────────────
    const NS = 'meow-push-bridge'

    // ── locale 字典（与 DSH 内置插件同样的 zh/en 结构）───────────
    const zh = {
      tab: '喵桥',
      title: '喵桥 · MeoW 推送',
      intro: '配置完成后，Agent 可以调用 meow_push_bridge 工具把通知推送到你的鸿蒙手机。',
      nickname: 'MeoW 昵称',
      nicknameHint: '必填。对应推送地址 http://api.chuckfang.com/{昵称}/… 的第一段。留空则不会注册推送工具。',
      apiBase: 'API 地址',
      apiBaseHint: '可选。默认 http://api.chuckfang.com；如需自建反代可改这里。',
      timeout: '请求超时（毫秒）',
      timeoutHint: '可选。默认 10000，允许 100–120000。',
      throttleMs: '节流窗口（毫秒）',
      throttleHint: '可选。同一会话在此窗口内只推送一次，默认 5000；填 0 关闭节流。',
      save: '保存',
      saving: '保存中…',
      saved: '已保存，插件已热应用。',
      failed: '保存失败：',
      loading: '正在读取插件配置…',
      missing: '宿主未提供本插件的配置命名空间，请确认插件已启用。',
      openDocument: '打开配置文件',
    }
    const en = {
      tab: 'MeoW Bridge',
      title: 'MeoW Push Bridge',
      intro: 'Once configured, the Agent can push notifications to your HarmonyOS phone via meow_push_bridge.',
      nickname: 'MeoW nickname',
      nicknameHint: 'Required. It is the first path segment of http://api.chuckfang.com/{nickname}/… Leave it empty and the tool is not registered.',
      apiBase: 'API base URL',
      apiBaseHint: 'Optional. Defaults to http://api.chuckfang.com.',
      timeout: 'Request timeout (ms)',
      timeoutHint: 'Optional. Defaults to 10000, allowed 100–120000.',
      throttleMs: 'Throttle window (ms)',
      throttleHint: 'Optional. One push per session inside this window, default 5000; 0 disables throttling.',
      pushMode: 'Auto-push mode',
      pushModeHint:
        'every-turn = push after every reply (host-driven, never depends on the model); substantial = only when tools ran; off = manual only.',
      pushModeEveryTurn: 'Every reply',
      pushModeSubstantial: 'Only when work was done',
      pushModeOff: 'Off (manual only)',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved; the plugin is applied live.',
      failed: 'Save failed: ',
      loading: 'Reading plugin configuration…',
      missing: 'The host serves no configuration namespace for this plugin; make sure it is enabled.',
      openDocument: 'Open config file',
    }

    /** 字段元数据：面板上按这个顺序渲染 */
    const FIELDS = [
      { key: 'nickname', kind: 'string', label: 'nickname', hint: 'nicknameHint' },
      { key: 'apiBase', kind: 'string', label: 'apiBase', hint: 'apiBaseHint' },
      { key: 'timeout', kind: 'number', label: 'timeout', hint: 'timeoutHint' },
      { key: 'throttleMs', kind: 'number', label: 'throttleMs', hint: 'throttleHint' },
      {
        key: 'pushMode',
        kind: 'select',
        label: 'pushMode',
        hint: 'pushModeHint',
        // 必须与宿主半体的枚举完全一致（src/auto-push.ts 的 PUSH_MODES），
        // 否则用户在下拉里选的值会被 {@link validate} 判为非法。
        options: [
          { value: 'every-turn', labelKey: 'pushModeEveryTurn' },
          { value: 'substantial', labelKey: 'pushModeSubstantial' },
          { value: 'off', labelKey: 'pushModeOff' },
        ],
      },
    ]

    /** 判断某个命名空间是否属于本插件（容忍 id 命名风格差异） */
    function isMeoWNamespace(ns) {
      const value = String(ns ?? '')
      return value === 'meow-push-bridge' || value === 'meow_push_bridge' || value.indexOf('meow') >= 0
    }

    /**
     * 配置页签组件。
     *
     * 由 slots 注册表注入的 props：
     *   t        —— 本插件字典的取词函数
     *   actions  —— { describe, update } 两个宿主操作（见下方 inject）
     */
    function MeoWConfigTab(props) {
      const t = props.t
      const actions = props.actions
      const [state, setState] = React.useState({ phase: 'loading', message: '' })
      const [draft, setDraft] = React.useState({})
      const [revision, setRevision] = React.useState(undefined)
      const [busy, setBusy] = React.useState(false)

      const load = React.useCallback(() => {
        let cancelled = false
        setState({ phase: 'loading', message: '' })
        actions
          .describe()
          .then((result) => {
            if (cancelled) return
            if (!result || result.ok !== true) {
              setState({ phase: 'error', message: result && result.error ? String(result.error.message) : 'describe failed' })
              return
            }
            const view = ((result.value && result.value.namespaces) || []).find((row) => isMeoWNamespace(row.ns))
            if (view === undefined) {
              setState({ phase: 'missing', message: '' })
              return
            }
            setRevision(view.revision)
            const next = {}
            const source = view.user !== undefined ? view.user : view.value
            for (const field of FIELDS) {
              const raw = source === null || source === undefined ? undefined : source[field.key]
              next[field.key] = raw === undefined || raw === null ? '' : String(raw)
            }
            setDraft(next)
            setState({ phase: 'ready', message: '' })
          })
          .catch((error) => {
            if (!cancelled) setState({ phase: 'error', message: String((error && error.message) || error) })
          })
        return () => {
          cancelled = true
        }
      }, [actions])

      React.useEffect(load, [load])

      const dirty = FIELDS.some((field) => {
        const current = draft[field.key]
        return typeof current === 'string' && current.length > 0
      })

      const save = () => {
        setBusy(true)
        setState({ phase: 'saving', message: '' })
        const patch = {}
        // 只提交非空字段：空字符串表示「不改这一项」，避免把默认值覆盖成空
        for (const field of FIELDS) {
          const raw = draft[field.key]
          if (typeof raw !== 'string' || raw.length === 0) continue
          patch[field.key] = field.kind === 'number' ? Number(raw) : raw
        }
        actions
          .update(patch, revision)
          .then((result) => {
            setBusy(false)
            if (!result || result.ok !== true) {
              setState({
                phase: 'error',
                message: result && result.error ? `${result.error.code}: ${result.error.message}` : 'update failed',
              })
              return
            }
            const view = result.value
            if (view !== undefined && view.revision !== undefined) setRevision(view.revision)
            setState({ phase: 'saved', message: '' })
          })
          .catch((error) => {
            setBusy(false)
            setState({ phase: 'error', message: String((error && error.message) || error) })
          })
      }

      /** 统一的字段行：标题 + 说明 + 输入框 */
      const renderField = (field) => {
        const invalid =
          field.kind === 'number' &&
          typeof draft[field.key] === 'string' &&
          draft[field.key] !== '' &&
          !Number.isFinite(Number(draft[field.key]))
        return React.createElement(
          'div',
          { key: field.key, style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
          React.createElement(
            'label',
            { htmlFor: `meow-${field.key}`, style: { fontSize: '13px', fontWeight: 600 } },
            t(field.label),
            field.key === 'nickname' ? React.createElement('span', { style: { color: 'var(--dsw-alias-state-error-primary, #d4380d)' } }, ' *') : null,
          ),
          React.createElement(
            'span',
            { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary, #8c8c8c)' } },
            t(field.hint),
          ),
          field.kind === 'select'
            ? React.createElement(
                'select',
                {
                  id: `meow-${field.key}`,
                  value: draft[field.key] ?? '',
                  disabled: busy,
                  style: {
                    padding: '6px 10px',
                    fontSize: '13px',
                    borderRadius: '6px',
                    border: '1px solid var(--dsw-alias-border-l2, #d9d9d9)',
                    background: 'var(--dsw-alias-bg-primary, #fff)',
                    color: 'var(--dsw-alias-label-primary, #1f1f1f)',
                    maxWidth: '420px',
                  },
                  onChange: (event) => {
                    const value = event.target.value
                    setDraft((previous) => ({ ...previous, [field.key]: value }))
                  },
                },
                (field.options ?? []).map((option) =>
                  React.createElement(
                    'option',
                    { key: option.value, value: option.value },
                    `${t(option.labelKey)}（${option.value}）`,
                  ),
                ),
              )
            : React.createElement('input', {
                id: `meow-${field.key}`,
                type: field.kind === 'number' ? 'number' : 'text',
                value: draft[field.key] ?? '',
                disabled: busy,
                style: {
                  padding: '6px 10px',
                  fontSize: '13px',
                  borderRadius: '6px',
                  border: `1px solid ${invalid ? 'var(--dsw-alias-state-error-primary, #d4380d)' : 'var(--dsw-alias-border-l2, #d9d9d9)'}`,
                  background: 'var(--dsw-alias-bg-primary, #fff)',
                  color: 'var(--dsw-alias-label-primary, #1f1f1f)',
                  maxWidth: '420px',
                },
                onChange: (event) => {
                  const value = event.target.value
                  setDraft((previous) => ({ ...previous, [field.key]: value }))
                },
              }),
        )
      }

      const children = [React.createElement('h2', { key: 'title', style: { margin: 0, fontSize: '18px', fontWeight: 600 } }, t('title'))]

      if (state.phase === 'loading') {
        children.push(React.createElement('p', { key: 'loading', style: { fontSize: '13px' } }, t('loading')))
      } else if (state.phase === 'missing') {
        children.push(
          React.createElement('p', { key: 'missing', style: { fontSize: '13px', color: 'var(--dsw-alias-label-tertiary, #8c8c8c)' } }, t('missing')),
        )
      } else {
        children.push(
          React.createElement('p', { key: 'intro', style: { fontSize: '13px', color: 'var(--dsw-alias-label-tertiary, #8c8c8c)', margin: 0 } }, t('intro')),
        )
        children.push(
          React.createElement(
            'div',
            { key: 'fields', style: { display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '6px' } },
            FIELDS.map(renderField),
          ),
        )
        children.push(
          React.createElement(
            'div',
            { key: 'actions', style: { display: 'flex', alignItems: 'center', gap: '12px', marginTop: '4px' } },
            React.createElement(
              'button',
              {
                type: 'button',
                disabled: busy || !dirty,
                onClick: save,
                style: {
                  padding: '6px 16px',
                  fontSize: '13px',
                  borderRadius: '6px',
                  border: '1px solid var(--dsw-alias-border-l2, #d9d9d9)',
                  cursor: busy ? 'default' : 'pointer',
                  background: 'var(--dsw-alias-bg-primary, #fff)',
                  color: 'var(--dsw-alias-label-primary, #1f1f1f)',
                },
              },
              busy ? t('saving') : t('save'),
            ),
            state.phase === 'saved'
              ? React.createElement('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-state-success-primary, #389e0d)' } }, t('saved'))
              : null,
            state.phase === 'error'
              ? React.createElement('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-state-error-primary, #d4380d)' } }, `${t('failed')} ${state.message}`)
              : null,
            React.createElement(
              'button',
              {
                type: 'button',
                onClick: load,
                style: {
                  padding: '6px 12px',
                  fontSize: '12px',
                  borderRadius: '6px',
                  border: '1px solid var(--dsw-alias-border-l2, #d9d9d9)',
                  cursor: 'pointer',
                  background: 'transparent',
                  color: 'var(--dsw-alias-label-secondary, #595959)',
                },
              },
              '↻',
            ),
          ),
        )
      }

      return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '760px' } }, children)
    }

    /** 宿主操作：把 remote.settings 的 RPC 结果形态收敛成 { ok, value | error } */
    async function describeSettings(ctx) {
      return ctx.remote.settings.describe()
    }

    async function updateSettings(ctx, patch, revision) {
      return ctx.remote.settings.update(NS, patch, revision)
    }

    /** 必需服务（cordis 纤维 inject） */
    const inject = ['slots', 'locale', 'remote', 'remote.settings']

    /**
     * 挂载设置页签。
     * @param ctx 浏览器插件上下文
     */
    function apply(ctx) {
      const t = ctx.locale.bind(NS)
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'meow-push-bridge: dictionaries')

      ctx.slots.inject('settings.plugins.tab', () =>
        ctx.slots.register(
          {
            name: 'settings.plugins.tab',
            id: 'meow-push-bridge',
            order: 30,
            label: () => t('tab'),
            locale: NS,
            inject: () => ({
              // 字典取词交给 slot 的 t 注入；这里补上两个宿主操作
              actions: {
                describe: () => describeSettings(ctx),
                update: (patch, revision) => updateSettings(ctx, patch, revision),
              },
            }),
          },
          MeoWConfigTab,
        ),
      )
    }

    exports.NS = NS
    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})
