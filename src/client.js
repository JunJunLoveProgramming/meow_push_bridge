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
      nicknameHint: '必填。对应推送地址 https://api.chuckfang.com/{昵称}/… 的第一段。官方文档：昵称不允许包含斜杠。留空则不会注册推送工具。',
      memberTitle: '会员主题',
      memberIntro: '主题设置是会员功能：登录后可自定义 MeoW 通知标题与图标 URL，并同步到云端。',
      loginMember: '登录会员',
      loggingIn: '等待浏览器授权…',
      openingBrowser: '正在打开浏览器…',
      loginHint: '将打开浏览器，请登录会员账号并授权；完成后本页会自动更新。',
      loginTimeout: '等待授权超时，请重新点击「登录会员」。',
      popupBlocked: '浏览器拦截了授权窗口：请允许本站弹窗后重试，或直接在浏览器打开会员站点登录。',
      manualOpenHint: '未能自动打开浏览器，请点击下方「手动打开授权页」。',
      openAuthPage: '手动打开授权页',
      logout: '取消授权',
      loggedInAs: '已登录',
      notMember: '未登录会员',
      themeTitle: 'MeoW 通知标题',
      themeTitleHint: '会员主题。留空时使用默认标题「MeoW Push Bridge」。',
      themeIcon: '自定义图标 URL',
      themeIconHint: '会员主题。官方建议 216×216 PNG；留空则不附加图标。',
      themeCategory: '自定义分类',
      themeCategoryHint: '会员主题。默认「dsh插件」，最多 10 个字；非会员固定为 dsh插件。',
      syncUpload: '同步到云端',
      syncDownload: '从云端导入',
      syncing: '同步中…',
      syncUploaded: '主题已同步到云端。',
      syncImported: '已从云端导入主题。',
      syncEmpty: '云端还没有保存过主题。',
      memberOnly: '登录会员后才能显示主题设置。',
      authFailed: '会员登录失败：',
      fixedNote: '其余请求细节（HTTPS 地址、POST 方法、10 秒超时、纯文本格式、每轮自动推送）已按官方推荐值固化，无需配置。',
      save: '保存',
      saving: '保存中…',
      saved: '已保存，插件已热应用。',
      failed: '保存失败：',
      loading: '正在读取插件配置…',
      missing: '宿主未提供本插件的配置命名空间，请确认插件已启用。',
      openDocument: '打开配置文件',
      copyright: '© 2026 骏骏爱编程 · MIT 开源许可',
      qqGroup: 'QQ 交流群：1051489523',
    }
    const en = {
      tab: 'MeoW Bridge',
      title: 'MeoW Push Bridge',
      intro: 'Once configured, the Agent can push notifications to your HarmonyOS phone via meow_push_bridge.',
      nickname: 'MeoW nickname',
      nicknameHint: 'Required. The first path segment of https://api.chuckfang.com/{nickname}/… The spec forbids slashes in a nickname. Leave it empty and the tool is not registered.',
      memberTitle: 'Member theme',
      memberIntro: 'Theme settings are a member feature: sign in to set a notification title and icon URL, and sync them to the cloud.',
      loginMember: 'Sign in as member',
      loggingIn: 'Waiting for browser authorization…',
      openingBrowser: 'Opening the browser…',
      loginHint: 'A browser tab will open; sign in and authorize, then this page updates automatically.',
      loginTimeout: 'Timed out waiting for authorization. Click “Sign in as member” again.',
      popupBlocked: 'The browser blocked the authorization tab. Allow pop-ups for this site and retry.',
      manualOpenHint: 'The browser could not be opened automatically; use “Open authorization page”.',
      openAuthPage: 'Open authorization page',
      logout: 'Revoke authorization',
      loggedInAs: 'Signed in as',
      notMember: 'Not signed in',
      themeTitle: 'MeoW notification title',
      themeTitleHint: 'Member theme. Empty uses the default title "MeoW Push Bridge".',
      themeIcon: 'Custom icon URL',
      themeIconHint: 'Member theme. 216×216 PNG recommended; empty adds no icon.',
      themeCategory: 'Custom category',
      themeCategoryHint: 'Member theme. Defaults to “dsh插件”, max 10 characters; fixed for non-members.',
      syncUpload: 'Sync to cloud',
      syncDownload: 'Import from cloud',
      syncing: 'Syncing…',
      syncUploaded: 'Theme synced to the cloud.',
      syncImported: 'Theme imported from the cloud.',
      syncEmpty: 'No theme saved in the cloud yet.',
      memberOnly: 'Theme settings appear after you sign in as a member.',
      authFailed: 'Member sign-in failed: ',
      fixedNote: 'All other request details (HTTPS base, POST, 10s timeout, plain text, auto-push every reply) are fixed to the spec-recommended values.',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved; the plugin is applied live.',
      failed: 'Save failed: ',
      loading: 'Reading plugin configuration…',
      missing: 'The host serves no configuration namespace for this plugin; make sure it is enabled.',
      openDocument: 'Open config file',
      copyright: '© 2026 JunJunLoveProgramming · MIT licensed',
      qqGroup: 'QQ group: 1051489523',
    }

    /** 配置字段：只有昵称写入 profile */
    const FIELDS = [{ key: 'nickname', kind: 'string', label: 'nickname', hint: 'nicknameHint' }]

    /** 会员主题字段：不写入 profile，登录后由宿主存储/云端提供 */
    const THEME_FIELDS = [
      { key: 'title', kind: 'string', label: 'themeTitle', hint: 'themeTitleHint' },
      { key: 'imgUrl', kind: 'string', label: 'themeIcon', hint: 'themeIconHint' },
      { key: 'category', kind: 'string', label: 'themeCategory', hint: 'themeCategoryHint' },
    ]

    /** 判断某个命名空间是否属于本插件（容忍 id 命名风格差异） */
    function isMeoWNamespace(ns) {
      const value = String(ns ?? '')
      return value === 'meow-push-bridge' || value === 'meow_push_bridge' || value.indexOf('meow') >= 0
    }

    /**
     * 读取 JSON 响应。
     * 路由未注册时宿主会返回空 404/405，直接 response.json() 会抛
     * "Unexpected end of JSON input"，这里换成可理解的错误。
     */
    async function readJson(response, label) {
      const text = await response.text()
      if (text === '') {
        throw new Error(label + '接口无响应（HTTP ' + response.status + '）：插件可能尚未加载，请重启 DSH 后重试')
      }
      try {
        return JSON.parse(text)
      } catch (error) {
        throw new Error(label + '接口返回了非 JSON（HTTP ' + response.status + '）：' + text.slice(0, 80))
      }
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
      const [member, setMember] = React.useState({ phase: 'loading', authorized: false, account: null, message: '' })
      const [syncBusy, setSyncBusy] = React.useState('')
      const [memberNote, setMemberNote] = React.useState('')
      const [memberError, setMemberError] = React.useState('')

      const refreshMember = React.useCallback(async () => {
        try {
          const response = await fetch('/meow-push-bridge-api/auth/status', { headers: { 'X-MPB-Client': '1' } })
          const data = await readJson(response, '会员')
          if (data && data.authorized) {
            setMember({ phase: 'authorized', authorized: true, account: data.account || null, message: '' })
          } else {
            // 轮询期间保持「等待授权」状态，不要一刷新就把提示抹掉
            setMember((previous) =>
              previous.phase === 'pending' || previous.phase === 'starting'
                ? previous
                : { phase: 'anonymous', authorized: false, account: null, message: '' },
            )
          }
        } catch (error) {
          setMember({ phase: 'error', authorized: false, account: null, message: String((error && error.message) || error) })
        }
      }, [])

      React.useEffect(() => {
        refreshMember()
      }, [refreshMember])

      React.useEffect(() => {
        if (!member.authorized) return undefined
        let cancelled = false
        fetch('/meow-push-bridge-api/theme', { headers: { 'X-MPB-Client': '1' } })
          .then((response) => readJson(response, '会员'))
          .then((data) => {
            if (cancelled) return
            const theme = data && data.theme
            if (theme === undefined || theme === null) return
            setDraft((previous) => ({
              ...previous,
              title: typeof theme.title === 'string' ? theme.title : '',
              imgUrl: typeof theme.imgUrl === 'string' ? theme.imgUrl : '',
              category:
                typeof theme.category === 'string' && theme.category !== ''
                  ? theme.category
                  : 'dsh插件',
            }))
          })
          .catch(() => {})
        return () => {
          cancelled = true
        }
      }, [member.authorized])

      React.useEffect(() => {
        if (member.phase !== 'pending') return undefined
        let tries = 0
        const timer = setInterval(() => {
          tries += 1
          if (tries > 200) {
            clearInterval(timer)
            setMember((previous) => ({ ...previous, phase: 'error', message: t('loginTimeout') }))
            return
          }
          refreshMember()
        }, 1500)
        return () => clearInterval(timer)
      }, [member.phase, refreshMember])

      // 由宿主拉起系统浏览器；若宿主失败或 8 秒无响应，自动跳转兜底。
      const startLogin = async () => {
        setMemberNote('')
        setMember({ phase: 'starting', authorized: false, account: null, message: '', loginUrl: null })
        const back = encodeURIComponent(window.location.href)
        const fallback = '/meow-push-bridge-api/auth/start?sameTab=1&return=' + back
        try {
          const response = await fetch('/meow-push-bridge-api/auth/start', {
            method: 'POST',
            headers: { 'X-MPB-Client': '1' },
            signal: AbortSignal.timeout(8000),
          })
          const data = await readJson(response, '会员')
          if (data && data.authorized) {
            setMember({ phase: 'authorized', authorized: true, account: data.account || null, message: '', loginUrl: null })
            return
          }
          if (!data || typeof data.url !== 'string' || data.opened === false) {
            window.location.href = fallback
            return
          }
          setMember({
            phase: 'pending',
            authorized: false,
            account: null,
            message: t('loginHint'),
            loginUrl: data.url,
          })
        } catch (error) {
          window.location.href = fallback
          setMember({
            phase: 'error',
            authorized: false,
            account: null,
            message: String((error && error.message) || error),
            loginUrl: null,
          })
        }
      }

      const logoutMember = async () => {
        setSyncBusy('logout')
        setMemberNote('')
        try {
          await fetch('/meow-push-bridge-api/auth/logout', {
            method: 'POST',
            headers: { 'X-MPB-Client': '1' },
          })
          setMember({ phase: 'anonymous', authorized: false, account: null, message: '' })
          setDraft((previous) => ({ ...previous, title: '', imgUrl: '', category: 'dsh插件' }))
          setMemberNote('已取消授权，主题恢复默认')
        } catch (error) {
          setState({ phase: 'error', message: String((error && error.message) || error) })
        } finally {
          setSyncBusy('')
        }
      }

      const syncUpload = async () => {
        setSyncBusy('upload')
        setMemberNote('')
        setMemberError('')
        if (typeof draft.nickname !== 'string' || draft.nickname.trim() === '') {
          setSyncBusy('')
          setMemberError('请先填写「MeoW 昵称」再同步到云端')
          return
        }
        try {
          const response = await fetch('/meow-push-bridge-api/sync/upload', {
            method: 'POST',
            headers: { 'X-MPB-Client': '1', 'Content-Type': 'application/json' },
            body: JSON.stringify({
              nickname: draft.nickname || '',
              title: draft.title || '',
              imgUrl: draft.imgUrl || '',
              category: draft.category || '',
            }),
          })
          const data = await readJson(response, '会员')
          if (data && data.ok) setMemberNote(t('syncUploaded'))
          else setMemberError((data && data.error) || '同步失败')
        } catch (error) {
          setMemberError(String((error && error.message) || error))
        } finally {
          setSyncBusy('')
        }
      }

      const syncDownload = async () => {
        setSyncBusy('download')
        setMemberNote('')
        setMemberError('')
        try {
          const response = await fetch('/meow-push-bridge-api/sync/download', {
            headers: { 'X-MPB-Client': '1' },
          })
          const data = await readJson(response, '会员')
          if (!data || !data.ok || !data.theme) {
            setMemberError((data && data.error) || t('syncEmpty'))
            return
          }
          const theme = data.theme
          setDraft((previous) => ({
            ...previous,
            nickname: theme.nickname || previous.nickname,
            title: theme.title || '',
            imgUrl: theme.imgUrl || '',
            category:
              typeof theme.category === 'string' && theme.category !== ''
                ? theme.category
                : 'dsh插件',
          }))

          // 昵称属于 profile 配置；主题只存宿主/云端，不写 profile
          if (typeof theme.nickname === 'string' && theme.nickname !== '' && revision !== undefined) {
            await updateSettings({ nickname: theme.nickname }, revision)
          }
          setMemberNote(t('syncImported'))
        } catch (error) {
          setMemberError(String((error && error.message) || error))
        } finally {
          setSyncBusy('')
        }
      }

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

      /**
       * 保存配置；遇到 revision 冲突时自动重新读取版本并重试一次。
       * （多个设置页/热重载会推进 revision，旧 revision 会被宿主拒绝）
       */
      const updateSettings = React.useCallback(
        async (patch, expectedRevision) => {
          let result = await actions.update(patch, expectedRevision)

          const failed = !result || result.ok !== true
          const code = failed && result && result.error ? String(result.error.code || '') : ''
          const message = failed && result && result.error ? String(result.error.message || '') : ''
          const conflict =
            code.indexOf('conflict') >= 0 || message.indexOf('changed since it was read') >= 0

          if (!failed || !conflict) return result

          const described = await actions.describe()
          if (!described || described.ok !== true) return result
          const view = ((described.value && described.value.namespaces) || []).find((row) =>
            isMeoWNamespace(row.ns),
          )
          if (view === undefined || view.revision === undefined) return result

          setRevision(view.revision)
          result = await actions.update(patch, view.revision)
          return result
        },
        [actions],
      )

      const save = async () => {
        setBusy(true)
        setState({ phase: 'saving', message: '' })
        try {
          // 主题写入宿主存储（不写 profile），昵称仍写配置
          if (member.authorized) {
            const themeResponse = await fetch('/meow-push-bridge-api/theme', {
              method: 'POST',
              headers: { 'X-MPB-Client': '1', 'Content-Type': 'application/json' },
              body: JSON.stringify({
                title: draft.title || '',
                imgUrl: draft.imgUrl || '',
                category: draft.category || '',
              }),
            })
            const themeData = await readJson(themeResponse, '会员')
            if (!themeData || themeData.ok !== true) {
              setState({ phase: 'error', message: (themeData && themeData.error) || '主题保存失败' })
              return
            }
          }

          const patch = {}
          if (typeof draft.nickname === 'string' && draft.nickname.length > 0) {
            patch.nickname = draft.nickname
          }

          if (Object.keys(patch).length > 0) {
            const result = await updateSettings(patch, revision)
            if (!result || result.ok !== true) {
              setState({
                phase: 'error',
                message: result && result.error ? `${result.error.code}: ${result.error.message}` : 'update failed',
              })
              return
            }
            const view = result.value
            if (view !== undefined && view.revision !== undefined) setRevision(view.revision)
          }

          setState({ phase: 'saved', message: '' })
        } catch (error) {
          setState({ phase: 'error', message: String((error && error.message) || error) })
        } finally {
          setBusy(false)
        }
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
                    // 只显示中文标签；value 仍是英文枚举值（宿主据此校验）
                    t(option.labelKey),
                  ),
                ),
              )
            : React.createElement('input', {
                id: `meow-${field.key}`,
                type: field.kind === 'number' ? 'number' : 'text',
                value: draft[field.key] ?? '',
                maxLength: field.key === 'category' ? 10 : undefined,
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

      const memberButton = (id, label, onClick, disabled) =>
        React.createElement(
          'button',
          {
            key: id,
            type: 'button',
            disabled: disabled === true,
            onClick,
            style: {
              padding: '5px 12px',
              fontSize: '12px',
              borderRadius: '6px',
              border: '1px solid var(--dsw-alias-border-l2, #d9d9d9)',
              background: 'var(--dsw-alias-bg-primary, #fff)',
              color: 'var(--dsw-alias-label-primary, #1f1f1f)',
              cursor: disabled === true ? 'default' : 'pointer',
            },
          },
          label,
        )

      // 普通链接：新标签打开，宿主 302 到站点，不触发弹窗拦截
      const memberLink = (label, href, onClick) =>
        React.createElement(
          'a',
          {
            key: label,
            href,
            target: '_blank',
            rel: 'noopener noreferrer',
            onClick,
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              padding: '5px 12px',
              fontSize: '12px',
              borderRadius: '6px',
              border: '1px solid var(--dsw-alias-border-l2, #d9d9d9)',
              background: 'var(--dsw-alias-bg-primary, #fff)',
              color: 'var(--dsw-alias-label-primary, #1f1f1f)',
              textDecoration: 'none',
              cursor: 'pointer',
            },
          },
          label,
        )

      // 同页跳转链接：即使 JS 事件失效，浏览器默认导航也会生效
      const memberNavLink = (label, href) =>
        React.createElement(
          'a',
          {
            key: label,
            href,
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              padding: '5px 12px',
              fontSize: '12px',
              borderRadius: '6px',
              border: '1px solid var(--dsw-alias-border-l2, #d9d9d9)',
              background: 'var(--dsw-alias-bg-primary, #fff)',
              color: 'var(--dsw-alias-label-primary, #1f1f1f)',
              textDecoration: 'none',
              cursor: 'pointer',
            },
          },
          label,
        )

      const renderMemberBlock = () => {
        const rowStyle = { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }
        const hintStyle = {
          fontSize: '12px',
          color: 'var(--dsw-alias-label-tertiary, #8c8c8c)',
          margin: 0,
          lineHeight: 1.6,
        }
        const accountName =
          member.account !== null && member.account !== undefined && typeof member.account.username === 'string'
            ? member.account.username
            : ''

        const parts = [
          React.createElement(
            'div',
            { key: 'head', style: rowStyle },
            React.createElement('strong', { style: { fontSize: '13px' } }, t('memberTitle')),
            React.createElement(
              'span',
              { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary, #8c8c8c)' } },
              member.authorized ? `${t('loggedInAs')} ${accountName}` : t('notMember'),
            ),
          ),
        ]

        if (!member.authorized) {
          parts.push(React.createElement('p', { key: 'intro', style: hintStyle }, t('memberIntro')))
        }
        if (member.phase === 'starting') {
          parts.push(
            React.createElement(
              'p',
              { key: 'starting', style: { ...hintStyle, color: 'var(--dsw-alias-state-info-primary, #1677ff)' } },
              t('openingBrowser'),
            ),
          )
        }
        if (member.phase === 'pending') {
          parts.push(
            React.createElement(
              'p',
              { key: 'pending', style: { ...hintStyle, color: 'var(--dsw-alias-state-info-primary, #1677ff)' } },
              t('loggingIn'),
            ),
          )
        }
        if (member.phase === 'error') {
          parts.push(
            React.createElement(
              'p',
              { key: 'error', style: { ...hintStyle, color: 'var(--dsw-alias-state-error-primary, #d4380d)' } },
              `${t('authFailed')}${member.message}`,
            ),
          )
        }
        if (memberNote !== '') {
          parts.push(
            React.createElement(
              'p',
              { key: 'note', style: { ...hintStyle, color: 'var(--dsw-alias-state-success-primary, #389e0d)' } },
              memberNote,
            ),
          )
        }
        if (memberError !== '') {
          parts.push(
            React.createElement(
              'p',
              { key: 'member-error', style: { ...hintStyle, color: 'var(--dsw-alias-state-error-primary, #d4380d)' } },
              memberError,
            ),
          )
        }

        const buttons = []
        if (!member.authorized) {
          buttons.push(
            memberButton(
              'login',
              t('loginMember'),
              startLogin,
              member.phase === 'starting' || member.phase === 'pending',
            ),
          )
          if (typeof member.loginUrl === 'string' && member.loginUrl !== '') {
            buttons.push(memberLink(t('openAuthPage'), member.loginUrl))
          }
        } else {
          buttons.push(
            memberButton(
              'sync-upload',
              syncBusy === 'upload' ? t('syncing') : t('syncUpload'),
              syncUpload,
              syncBusy !== '',
            ),
          )
          buttons.push(
            memberButton(
              'sync-download',
              syncBusy === 'download' ? t('syncing') : t('syncDownload'),
              syncDownload,
              syncBusy !== '',
            ),
          )
          buttons.push(
            memberButton(
              'logout',
              syncBusy === 'logout' ? t('syncing') : t('logout'),
              logoutMember,
              syncBusy !== '',
            ),
          )
        }
        parts.push(React.createElement('div', { key: 'buttons', style: rowStyle }, buttons))

        return React.createElement(
          'div',
          {
            key: 'member',
            style: {
              border: '1px dashed var(--dsw-alias-border-l2, #d9d9d9)',
              borderRadius: '8px',
              padding: '12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              maxWidth: '620px',
            },
          },
          parts,
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
        children.push(renderMemberBlock())
        if (member.authorized) {
          children.push(
            React.createElement(
              'div',
              { key: 'theme-fields', style: { display: 'flex', flexDirection: 'column', gap: '14px' } },
              THEME_FIELDS.map(renderField),
            ),
          )
        }
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

        // ── 页脚：版权 + QQ 交流群（用户要求放在保存按钮下方）──────────
        const divider = { borderTop: '1px solid var(--dsw-alias-border-l2, #d9d9d9)', margin: '10px 0 0' }
        children.push(React.createElement('hr', { key: 'footer-divider', style: divider }))
        children.push(
          React.createElement(
            'div',
            {
              key: 'footer',
              style: {
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: '6px 14px',
                fontSize: '12px',
                color: 'var(--dsw-alias-label-tertiary, #8c8c8c)',
              },
            },
            React.createElement('span', null, t('copyright')),
            React.createElement('span', { style: { color: 'var(--dsw-alias-border-l2, #d9d9d9)' } }, '·'),
            React.createElement('span', null, t('qqGroup')),
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
