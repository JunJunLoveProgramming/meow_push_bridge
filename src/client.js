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
      nickname: 'MeoW 昵称',
      nicknameHint: '必填。对应推送地址 https://api.chuckfang.com/{昵称}/… 的第一段。官方文档：昵称不允许包含斜杠。留空则不会注册推送工具。',
      memberTitle: '主题设置',
      memberIntro: '登录会员可把主题同步到云端；不登录也可以在本机设置并使用主题。',
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
      themeTitleHint: '主题。留空时使用默认标题「MeoW Push Bridge」。',
      themeIcon: '自定义图标 URL',
      themeIconHint: '主题。官方建议 216×216 PNG；留空则使用默认图标。',
      themeCategory: '自定义分类',
      themeCategoryHint: '主题。默认「dsh插件」，最多 10 个字。',
      syncUpload: '同步到云端',
      syncDownload: '从云端导入',
      syncing: '同步中…',
      syncUploaded: '主题已同步到云端。',
      syncImported: '已从云端导入主题。',
      syncEmpty: '云端还没有保存过主题。',
      memberOnly: '未登录也可在本机使用主题；云端同步需要登录会员。',
      authFailed: '会员登录失败：',
      pushChannel: '推送方式',
      statusConfigured: '已配置',
      statusUnconfigured: '未配置',
      channelMeow: 'MeoW 推送',
      meowIntro: '填写 MeoW 昵称后即可通过手机通知接收消息；主题会随通知生效。',
      meowSave: '保存 MeoW 设置',
      meowTest: '发送测试消息',
      channelSmtp: '邮件推送（SMTP）',
      channelBark: 'Bark 推送',
      barkTitle: 'Bark 推送设置',
      barkIntro: '在 Bark App 中复制 token；title/msg/url/token 按文档发送，issecure 固定为 0。',
      barkToken: 'Bark token',
      barkTitleField: '通知标题',
      barkIcon: '通知图标 URL',
      barkSender: '发送者名称',
      barkTokenKeep: 'Bark token 以明文显示，保存在本机安全存储。',
      barkSave: '保存 Bark 设置',
      barkTest: '发送测试消息',
      barkSaved: 'Bark 设置已保存。',
      barkTestOk: 'Bark 测试消息已发送，请查收。',
      channelSaved: '推送方式已切换。',
      channelFailed: '切换失败：',
      smtpTitle: 'SMTP 邮件设置',
      smtpIntro: '邮件正文使用与 MeoW 相同的中文摘要，纯文本发送。密码保存在宿主安全存储，不写入 profile。',
      smtpHost: 'SMTP 服务器',
      smtpPort: '端口',
      smtpEncryption: '加密方式',
      smtpEncryptionTls: 'SSL/TLS（465）',
      smtpEncryptionStarttls: 'STARTTLS（587，推荐）',
      smtpEncryptionNone: '不加密（25）',
      smtpUsername: '用户名',
      smtpPassword: '密码',
      smtpPasswordKeep: '留空表示保持已保存的密码',
      smtpFromEmail: '发件人邮箱',
      smtpFromName: '发件人名称',
      smtpToEmail: '收件人邮箱',
      smtpSave: '保存邮件设置',
      smtpTest: '发送测试邮件',
      smtpSaved: '邮件设置已保存。',
      smtpTestOk: '测试邮件已发送，请查收。',
      smtpMissing: '请先填写 SMTP 服务器和收件人邮箱。',
      fixedNote: '其余请求细节（HTTPS 地址、POST 方法、10 秒超时、纯文本格式、每轮自动推送）已按官方推荐值固化，无需配置。',
      save: '保存',
      clearing: '清空中…',
      clear: '清空配置',
      cleared: '已清空，状态已变为未配置。',
      saving: '保存中…',
      saved: '已保存，插件已热应用。',
      failed: '保存失败：',
      loading: '正在读取插件配置…',
      missing: '宿主未提供本插件的配置命名空间，请确认插件已启用。',
      openDocument: '打开配置文件',
      copyright: '© 2026 骏骏爱编程 · MIT 开源许可',
      qqGroup: 'QQ用户沟通群：1026696694',
      sponsor: '赞助方案',
    }
    const en = {
      tab: 'MeoW Bridge',
      title: 'MeoW Push Bridge',
      nickname: 'MeoW nickname',
      nicknameHint: 'Required. The first path segment of https://api.chuckfang.com/{nickname}/… The spec forbids slashes in a nickname. Leave it empty and the tool is not registered.',
      memberTitle: 'Theme settings',
      memberIntro: 'Sign in to sync the theme to the cloud; the theme can also be set and used locally without signing in.',
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
      themeTitleHint: 'Theme. Empty uses the default title "MeoW Push Bridge".',
      themeIcon: 'Custom icon URL',
      themeIconHint: 'Theme. 216×216 PNG recommended; empty uses the default icon.',
      themeCategory: 'Custom category',
      themeCategoryHint: 'Theme. Defaults to “dsh插件”, max 10 characters.',
      syncUpload: 'Sync to cloud',
      syncDownload: 'Import from cloud',
      syncing: 'Syncing…',
      syncUploaded: 'Theme synced to the cloud.',
      syncImported: 'Theme imported from the cloud.',
      syncEmpty: 'No theme saved in the cloud yet.',
      memberOnly: 'The theme works locally without signing in; cloud sync requires a member account.',
      authFailed: 'Member sign-in failed: ',
      pushChannel: 'Delivery method',
      statusConfigured: 'Configured',
      statusUnconfigured: 'Not configured',
      channelMeow: 'MeoW push',
      meowIntro: 'Fill in the MeoW nickname to receive phone notifications; the theme applies to them.',
      meowSave: 'Save MeoW settings',
      meowTest: 'Send test message',
      channelSmtp: 'Email (SMTP)',
      channelBark: 'Bark push',
      barkTitle: 'Bark push settings',
      barkIntro: 'Copy the token from the Bark app. title/msg/url/token follow the API; issecure is fixed to 0.',
      barkToken: 'Bark token',
      barkTitleField: 'Notification title',
      barkIcon: 'Notification icon URL',
      barkSender: 'Sender name',
      barkTokenKeep: 'The Bark token is shown in plain text and kept in local secure storage.',
      barkSave: 'Save Bark settings',
      barkTest: 'Send test message',
      barkSaved: 'Bark settings saved.',
      barkTestOk: 'Bark test message sent.',
      channelSaved: 'Delivery method updated.',
      channelFailed: 'Switch failed: ',
      smtpTitle: 'SMTP email settings',
      smtpIntro: 'The email body uses the same Chinese summary as MeoW, sent as plain text. The password stays in host secure storage, never in the profile.',
      smtpHost: 'SMTP server',
      smtpPort: 'Port',
      smtpEncryption: 'Encryption',
      smtpEncryptionTls: 'SSL/TLS (465)',
      smtpEncryptionStarttls: 'STARTTLS (587, recommended)',
      smtpEncryptionNone: 'None (25)',
      smtpUsername: 'Username',
      smtpPassword: 'Password',
      smtpPasswordKeep: 'Leave empty to keep the saved password',
      smtpFromEmail: 'From email',
      smtpFromName: 'From name',
      smtpToEmail: 'To email',
      smtpSave: 'Save email settings',
      smtpTest: 'Send test email',
      smtpSaved: 'Email settings saved.',
      smtpTestOk: 'Test email sent; please check your inbox.',
      smtpMissing: 'Fill in the SMTP server and recipient first.',
      fixedNote: 'All other request details (HTTPS base, POST, 10s timeout, plain text, auto-push every reply) are fixed to the spec-recommended values.',
      save: 'Save',
      clearing: 'Clearing…',
      clear: 'Clear config',
      cleared: 'Cleared; status is now unconfigured.',
      saving: 'Saving…',
      saved: 'Saved; the plugin is applied live.',
      failed: 'Save failed: ',
      loading: 'Reading plugin configuration…',
      missing: 'The host serves no configuration namespace for this plugin; make sure it is enabled.',
      openDocument: 'Open config file',
      copyright: '© 2026 JunJunLoveProgramming · MIT licensed',
      qqGroup: 'QQ user group: 1026696694',
      sponsor: 'Sponsorship',
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
      const [tab, setTab] = React.useState('meow')
      const [pushConfig, setPushConfig] = React.useState({
        meow: { configured: false, detail: '未填写 MeoW 昵称' },
        smtp: {
          host: '',
          port: 587,
          encryption: 'starttls',
          username: '',
          fromEmail: '',
          fromName: 'MeoW Push Bridge',
          toEmail: '',
          hasPassword: false,
          status: { configured: false, detail: '未填写 SMTP 服务器或收件人' },
        },
        bark: {
          sender: 'MeoW Push Bridge',
          title: '',
          icon: '',
          status: { configured: false, detail: '未填写 Bark token' },
        },
      })
      const [barkDraft, setBarkDraft] = React.useState({
        token: '',
        sender: 'MeoW Push Bridge',
        title: '',
        icon: '',
      })
      const [smtpDraft, setSmtpDraft] = React.useState({
        host: '',
        port: 587,
        encryption: 'starttls',
        username: '',
        password: '',
        fromEmail: '',
        fromName: 'MeoW Push Bridge',
        toEmail: '',
      })
      const [smtpBusy, setSmtpBusy] = React.useState(false)
      const [smtpNote, setSmtpNote] = React.useState('')
      const [smtpError, setSmtpError] = React.useState('')
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
        fetch('/meow-push-bridge-api/push/config', { headers: { 'X-MPB-Client': '1' } })
          .then((response) => readJson(response, '推送设置'))
          .then((data) => {
            if (!data || data.ok !== true) return
            setPushConfig(data)
            if (data.smtp) {
              const smtpData = { ...data.smtp }
              delete smtpData.status
              setSmtpDraft((previous) => ({
                ...previous,
                ...smtpData,
                password: '',
              }))
            }
            if (data.bark) {
              const barkData = { ...data.bark }
              delete barkData.status
              setBarkDraft((previous) => ({
                ...previous,
                ...barkData,
              }))
            }
          })
          .catch(() => {})
      }, [])

      React.useEffect(() => {
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
          setMemberNote('已取消授权，本机主题继续保留')
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
          {
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

      /** 统一的字段行：标题 + 说明 + 输入框（compact 用于通道面板，隐藏说明以保持三栏一致） */
      const renderField = (field, compact) => {
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
          compact === true
            ? null
            : React.createElement(
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

      const updateSmtp = (key, value) => {
        setSmtpDraft((previous) => ({ ...previous, [key]: value }))
      }

      const applyPushConfig = (data) => {
        if (!data || data.ok !== true) return
        setPushConfig(data)
        if (data.smtp) {
          const smtpData = { ...data.smtp }
          delete smtpData.status
          setSmtpDraft((previous) => ({ ...previous, ...smtpData, password: '' }))
        }
        if (data.bark) {
          const barkData = { ...data.bark }
          delete barkData.status
          setBarkDraft((previous) => ({
            ...previous,
            ...barkData,
          }))
        }
      }

      const saveSmtp = async () => {
        setSmtpBusy(true)
        setSmtpNote('')
        setSmtpError('')
        try {
          const response = await fetch('/meow-push-bridge-api/push/config', {
            method: 'POST',
            headers: { 'X-MPB-Client': '1', 'Content-Type': 'application/json' },
            body: JSON.stringify({ smtp: smtpDraft }),
          })
          const data = await readJson(response, '推送设置')
          if (!data || data.ok !== true) {
            setSmtpError((data && data.error) || '保存失败')
            return
          }
          applyPushConfig(data)
          setSmtpNote(t('smtpSaved'))
        } catch (error) {
          setSmtpError(String((error && error.message) || error))
        } finally {
          setSmtpBusy(false)
        }
      }

      const saveBark = async () => {
        setSmtpBusy(true)
        setSmtpNote('')
        setSmtpError('')
        try {
          const response = await fetch('/meow-push-bridge-api/push/config', {
            method: 'POST',
            headers: { 'X-MPB-Client': '1', 'Content-Type': 'application/json' },
            body: JSON.stringify({ bark: barkDraft }),
          })
          const data = await readJson(response, '推送设置')
          if (!data || data.ok !== true) {
            setSmtpError((data && data.error) || '保存失败')
            return
          }
          applyPushConfig(data)
          setSmtpNote(t('barkSaved'))
        } catch (error) {
          setSmtpError(String((error && error.message) || error))
        } finally {
          setSmtpBusy(false)
        }
      }

      const clearSmtp = async () => {
        setSmtpBusy(true)
        setSmtpNote('')
        setSmtpError('')
        try {
          const response = await fetch('/meow-push-bridge-api/push/config', {
            method: 'POST',
            headers: { 'X-MPB-Client': '1', 'Content-Type': 'application/json' },
            body: JSON.stringify({ smtp: { clear: true } }),
          })
          const data = await readJson(response, '推送设置')
          if (!data || data.ok !== true) {
            setSmtpError((data && data.error) || '清空失败')
            return
          }
          applyPushConfig(data)
          setSmtpNote(t('cleared'))
        } catch (error) {
          setSmtpError(String((error && error.message) || error))
        } finally {
          setSmtpBusy(false)
        }
      }

      const clearBark = async () => {
        setSmtpBusy(true)
        setSmtpNote('')
        setSmtpError('')
        try {
          const response = await fetch('/meow-push-bridge-api/push/config', {
            method: 'POST',
            headers: { 'X-MPB-Client': '1', 'Content-Type': 'application/json' },
            body: JSON.stringify({ bark: { clear: true } }),
          })
          const data = await readJson(response, '推送设置')
          if (!data || data.ok !== true) {
            setSmtpError((data && data.error) || '清空失败')
            return
          }
          applyPushConfig(data)
          setSmtpNote(t('cleared'))
        } catch (error) {
          setSmtpError(String((error && error.message) || error))
        } finally {
          setSmtpBusy(false)
        }
      }

      const clearMeow = async () => {
        setBusy(true)
        setState({ phase: 'saving', message: '' })
        try {
          const result = await updateSettings({ nickname: '' }, revision)
          if (!result || result.ok !== true) {
            setState({
              phase: 'error',
              message: result && result.error ? `${result.error.code}: ${result.error.message}` : '清空失败',
            })
            return
          }
          const view = result.value
          if (view !== undefined && view.revision !== undefined) setRevision(view.revision)
          setDraft((previous) => ({ ...previous, nickname: '' }))
          setPushConfig((previous) => ({
            ...previous,
            meow: { configured: false, detail: '未填写 MeoW 昵称' },
          }))
          setState({ phase: 'saved', message: '' })
          setSmtpNote(t('cleared'))
        } catch (error) {
          setState({ phase: 'error', message: String((error && error.message) || error) })
        } finally {
          setBusy(false)
        }
      }

      const openSponsor = async () => {
        try {
          const response = await fetch('/meow-push-bridge-api/sponsor', {
            method: 'POST',
            headers: { 'X-MPB-Client': '1' },
          })
          const data = await readJson(response, '赞助方案')
          if (!data || data.ok !== true) {
            setSmtpError((data && data.error) || '打开赞助方案失败')
          }
        } catch (error) {
          setSmtpError(String((error && error.message) || error))
        }
      }

      const testChannel = async (channel) => {
        setSmtpBusy(true)
        setSmtpNote('')
        setSmtpError('')
        try {
          const response = await fetch('/meow-push-bridge-api/push/test', {
            method: 'POST',
            headers: { 'X-MPB-Client': '1', 'Content-Type': 'application/json' },
            body: JSON.stringify({ channel }),
          })
          const data = await readJson(response, '推送设置')
          if (!data || data.ok !== true) {
            setSmtpError((data && data.error) || '发送失败')
            return
          }
          setSmtpNote(channel === 'bark' ? t('barkTestOk') : t('smtpTestOk'))
        } catch (error) {
          setSmtpError(String((error && error.message) || error))
        } finally {
          setSmtpBusy(false)
        }
      }

      const smtpInputStyle = {
        padding: '6px 10px',
        fontSize: '13px',
        borderRadius: '6px',
        border: '1px solid var(--dsw-alias-border-l2, #d9d9d9)',
        background: 'var(--dsw-alias-bg-primary, #fff)',
        color: 'var(--dsw-alias-label-primary, #1f1f1f)',
        width: '100%',
      }

      const smtpField = (key, labelKey, type, placeholder) =>
        React.createElement(
          'label',
          { key, style: { display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 } },
          React.createElement('span', { style: { fontSize: '12px', fontWeight: 600 } }, t(labelKey)),
          React.createElement('input', {
            type: type || 'text',
            value: smtpDraft[key] ?? '',
            placeholder: placeholder || '',
            disabled: smtpBusy,
            style: smtpInputStyle,
            onChange: (event) => updateSmtp(key, event.target.value),
          }),
        )

      const renderChannelTabs = () => {
        const items = [
          { id: 'meow', label: t('channelMeow'), status: pushConfig.meow },
          { id: 'smtp', label: t('channelSmtp'), status: pushConfig.smtp && pushConfig.smtp.status },
          { id: 'bark', label: t('channelBark'), status: pushConfig.bark && pushConfig.bark.status },
        ]
        return React.createElement(
          'div',
          { key: 'push-channel', style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
          React.createElement('span', { style: { fontSize: '13px', fontWeight: 600 } }, t('pushChannel')),
          React.createElement(
            'div',
            { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
            items.map((item) => {
              const configured = item.status && item.status.configured === true
              return React.createElement(
                'button',
                {
                  key: item.id,
                  type: 'button',
                  onClick: () => setTab(item.id),
                  title: (item.status && item.status.detail) || '',
                  style: {
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '7px',
                    padding: '6px 12px',
                    fontSize: '13px',
                    borderRadius: '6px',
                    border: `1px solid ${item.id === tab ? 'var(--dsw-alias-state-info-primary, #1677ff)' : 'var(--dsw-alias-border-l2, #d9d9d9)'}`,
                    background:
                      item.id === tab
                        ? 'var(--dsw-alias-state-info-primary, #1677ff)'
                        : 'var(--dsw-alias-bg-primary, #fff)',
                    color: item.id === tab ? '#fff' : 'var(--dsw-alias-label-primary, #1f1f1f)',
                    cursor: 'pointer',
                  },
                },
                React.createElement('span', {
                  style: {
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    display: 'inline-block',
                    background: configured
                      ? 'var(--dsw-alias-state-success-primary, #389e0d)'
                      : 'var(--dsw-alias-state-error-primary, #d4380d)',
                    boxShadow: configured
                      ? '0 0 6px rgba(56, 158, 13, 0.6)'
                      : '0 0 6px rgba(212, 56, 13, 0.55)',
                  },
                }),
                item.label,
                React.createElement(
                  'span',
                  { style: { fontSize: '11px', opacity: 0.85 } },
                  configured ? t('statusConfigured') : t('statusUnconfigured'),
                ),
              )
            }),
          ),
        )
      }

      const renderSmtpPanel = () =>
        React.createElement(
          'div',
          {
            key: 'smtp-panel',
            style: {
              border: '1px dashed var(--dsw-alias-border-l2, #d9d9d9)',
              borderRadius: '8px',
              padding: '12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              maxWidth: '620px',
            },
          },
          React.createElement('h3', { style: { margin: 0, fontSize: '15px' } }, t('smtpTitle')),
          React.createElement(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: '7px', fontSize: '12px' } },
            React.createElement('span', {
              style: {
                width: '9px',
                height: '9px',
                borderRadius: '50%',
                display: 'inline-block',
                background:
                  pushConfig.smtp && pushConfig.smtp.status && pushConfig.smtp.status.configured
                    ? 'var(--dsw-alias-state-success-primary, #389e0d)'
                    : 'var(--dsw-alias-state-error-primary, #d4380d)',
              },
            }),
            React.createElement(
              'span',
              { style: { color: 'var(--dsw-alias-label-secondary, #595959)' } },
              pushConfig.smtp && pushConfig.smtp.status
                ? pushConfig.smtp.status.detail
                : t('statusUnconfigured'),
            ),
          ),
          React.createElement(
            'p',
            { style: { margin: 0, fontSize: '12px', color: 'var(--dsw-alias-label-tertiary, #8c8c8c)' } },
            t('smtpIntro'),
          ),
          React.createElement(
            'div',
            { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' } },
            smtpField('host', 'smtpHost', 'text', 'smtp.example.com'),
            smtpField('port', 'smtpPort', 'number', '587'),
            React.createElement(
              'label',
              { key: 'encryption', style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
              React.createElement('span', { style: { fontSize: '12px', fontWeight: 600 } }, t('smtpEncryption')),
              React.createElement(
                'select',
                {
                  value: smtpDraft.encryption || 'starttls',
                  disabled: smtpBusy,
                  style: smtpInputStyle,
                  onChange: (event) => updateSmtp('encryption', event.target.value),
                },
                React.createElement('option', { value: 'starttls' }, t('smtpEncryptionStarttls')),
                React.createElement('option', { value: 'tls' }, t('smtpEncryptionTls')),
                React.createElement('option', { value: 'none' }, t('smtpEncryptionNone')),
              ),
            ),
            smtpField('username', 'smtpUsername', 'text', ''),
            smtpField(
              'password',
              'smtpPassword',
              'password',
              pushConfig.smtp && pushConfig.smtp.hasPassword ? '••••••••' : '',
            ),
            smtpField('fromEmail', 'smtpFromEmail', 'email', 'noreply@example.com'),
            smtpField('fromName', 'smtpFromName', 'text', 'MeoW Push Bridge'),
            smtpField('toEmail', 'smtpToEmail', 'email', 'you@example.com'),
          ),
          React.createElement(
            'span',
            { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary, #8c8c8c)' } },
            t('smtpPasswordKeep'),
          ),
          React.createElement(
            'div',
            { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
            React.createElement(
              'button',
              {
                type: 'button',
                disabled: smtpBusy,
                onClick: saveSmtp,
                style: { padding: '6px 14px', fontSize: '13px', borderRadius: '6px', cursor: smtpBusy ? 'default' : 'pointer' },
              },
              smtpBusy ? t('saving') : t('smtpSave'),
            ),
            React.createElement(
              'button',
              {
                type: 'button',
                disabled: smtpBusy,
                onClick: () => testChannel('smtp'),
                style: { padding: '6px 14px', fontSize: '13px', borderRadius: '6px', cursor: smtpBusy ? 'default' : 'pointer' },
              },
              t('smtpTest'),
            ),
          ),
          smtpNote !== ''
            ? React.createElement(
                'span',
                { style: { fontSize: '12px', color: 'var(--dsw-alias-state-success-primary, #389e0d)' } },
                smtpNote,
              )
            : null,
          smtpError !== ''
            ? React.createElement(
                'span',
                { style: { fontSize: '12px', color: 'var(--dsw-alias-state-error-primary, #d4380d)' } },
                smtpError,
              )
            : null,
        )

      const barkField = (key, labelKey, type, placeholder) =>
        React.createElement(
          'label',
          { key, style: { display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 } },
          React.createElement('span', { style: { fontSize: '12px', fontWeight: 600 } }, t(labelKey)),
          React.createElement('input', {
            type: type || 'text',
            value: barkDraft[key] ?? '',
            placeholder: placeholder || '',
            disabled: smtpBusy,
            style: smtpInputStyle,
            onChange: (event) => {
              const value = event.target.value
              setBarkDraft((previous) => ({ ...previous, [key]: value }))
            },
          }),
        )

      const panelStyle = {
        border: '1px dashed var(--dsw-alias-border-l2, #d9d9d9)',
        borderRadius: '8px',
        padding: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        maxWidth: '620px',
      }
      const panelButtonStyle = {
        padding: '6px 14px',
        fontSize: '13px',
        borderRadius: '6px',
        border: '1px solid var(--dsw-alias-border-l2, #d9d9d9)',
        background: 'var(--dsw-alias-bg-primary, #fff)',
        color: 'var(--dsw-alias-label-primary, #1f1f1f)',
        cursor: 'pointer',
      }
      const panelStatusRow = (status) => {
        const configured = status && status.configured === true
        return React.createElement(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '7px', fontSize: '12px' } },
          React.createElement('span', {
            style: {
              width: '9px',
              height: '9px',
              borderRadius: '50%',
              display: 'inline-block',
              background: configured
                ? 'var(--dsw-alias-state-success-primary, #389e0d)'
                : 'var(--dsw-alias-state-error-primary, #d4380d)',
              boxShadow: configured
                ? '0 0 6px rgba(56, 158, 13, 0.6)'
                : '0 0 6px rgba(212, 56, 13, 0.55)',
            },
          }),
          React.createElement(
            'span',
            { style: { color: 'var(--dsw-alias-label-secondary, #595959)' } },
            status && status.detail ? status.detail : t('statusUnconfigured'),
          ),
        )
      }
      const renderUnifiedPanel = ({
        key,
        title,
        intro,
        status,
        fields,
        onSave,
        saveLabel,
        onTest,
        testLabel,
        onClear,
        clearLabel,
        saving,
        note,
        error,
      }) =>
        React.createElement(
          'div',
          { key, style: panelStyle },
          React.createElement('h3', { style: { margin: 0, fontSize: '15px' } }, title),
          panelStatusRow(status),
          React.createElement(
            'p',
            { style: { margin: 0, fontSize: '12px', color: 'var(--dsw-alias-label-tertiary, #8c8c8c)' } },
            intro,
          ),
          React.createElement(
            'div',
            { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' } },
            fields,
          ),
          React.createElement(
            'div',
            { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
            React.createElement(
              'button',
              {
                type: 'button',
                disabled: saving === true,
                onClick: onSave,
                style: { ...panelButtonStyle, cursor: saving === true ? 'default' : 'pointer' },
              },
              saving === true ? t('saving') : saveLabel,
            ),
            React.createElement(
              'button',
              {
                type: 'button',
                disabled: saving === true,
                onClick: onTest,
                style: { ...panelButtonStyle, cursor: saving === true ? 'default' : 'pointer' },
              },
              testLabel,
            ),
            React.createElement(
              'button',
              {
                type: 'button',
                disabled: saving === true,
                onClick: onClear,
                style: {
                  ...panelButtonStyle,
                  color: 'var(--dsw-alias-state-error-primary, #d4380d)',
                  borderColor: 'var(--dsw-alias-state-error-primary, #d4380d)',
                  cursor: saving === true ? 'default' : 'pointer',
                },
              },
              clearLabel,
            ),
          ),
          note !== '' && note !== undefined
            ? React.createElement(
                'span',
                { style: { fontSize: '12px', color: 'var(--dsw-alias-state-success-primary, #389e0d)' } },
                note,
              )
            : null,
          error !== '' && error !== undefined
            ? React.createElement(
                'span',
                { style: { fontSize: '12px', color: 'var(--dsw-alias-state-error-primary, #d4380d)' } },
                error,
              )
            : null,
        )

      const renderMeowPanel = () => {
        const meowNote = state.phase === 'saved' ? t('saved') : smtpNote
        const meowError =
          state.phase === 'error' ? `${t('failed')} ${state.message}` : smtpError
        return renderUnifiedPanel({
          key: 'meow-panel',
          title: t('channelMeow'),
          intro: t('meowIntro'),
          status: pushConfig.meow,
          fields: [
            ...FIELDS.map((field) => renderField(field, true)),
            ...THEME_FIELDS.map((field) => renderField(field, true)),
          ],
          onSave: save,
          saveLabel: t('meowSave'),
          onTest: () => testChannel('meow'),
          testLabel: t('meowTest'),
          onClear: clearMeow,
          clearLabel: t('clear'),
          saving: busy || smtpBusy,
          note: meowNote,
          error: meowError,
        })
      }

      const renderSmtpPanelUnified = () =>
        renderUnifiedPanel({
          key: 'smtp-panel',
          title: t('smtpTitle'),
          intro: t('smtpIntro'),
          status: pushConfig.smtp && pushConfig.smtp.status,
          fields: [
            smtpField('host', 'smtpHost', 'text', 'smtp.example.com'),
            smtpField('port', 'smtpPort', 'number', '587'),
            React.createElement(
              'label',
              { key: 'encryption', style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
              React.createElement('span', { style: { fontSize: '12px', fontWeight: 600 } }, t('smtpEncryption')),
              React.createElement(
                'select',
                {
                  value: smtpDraft.encryption || 'starttls',
                  disabled: smtpBusy,
                  style: smtpInputStyle,
                  onChange: (event) => updateSmtp('encryption', event.target.value),
                },
                React.createElement('option', { value: 'starttls' }, t('smtpEncryptionStarttls')),
                React.createElement('option', { value: 'tls' }, t('smtpEncryptionTls')),
                React.createElement('option', { value: 'none' }, t('smtpEncryptionNone')),
              ),
            ),
            smtpField('username', 'smtpUsername', 'text', ''),
            smtpField(
              'password',
              'smtpPassword',
              'password',
              pushConfig.smtp && pushConfig.smtp.hasPassword ? '••••••••' : '',
            ),
            smtpField('fromEmail', 'smtpFromEmail', 'email', 'noreply@example.com'),
            smtpField('fromName', 'smtpFromName', 'text', 'MeoW Push Bridge'),
            smtpField('toEmail', 'smtpToEmail', 'email', 'you@example.com'),
          ],
          onSave: saveSmtp,
          saveLabel: t('smtpSave'),
          onTest: () => testChannel('smtp'),
          testLabel: t('smtpTest'),
          onClear: clearSmtp,
          clearLabel: t('clear'),
          saving: smtpBusy,
          note: smtpNote,
          error: smtpError,
        })

      const renderBarkPanelUnified = () =>
        renderUnifiedPanel({
          key: 'bark-panel',
          title: t('barkTitle'),
          intro: t('barkIntro'),
          status: pushConfig.bark && pushConfig.bark.status,
          fields: [
            barkField('token', 'barkToken', 'text', ''),
            barkField('title', 'barkTitleField', 'text', draft.title || 'MeoW Push Bridge'),
            barkField('icon', 'barkIcon', 'url', draft.imgUrl || ''),
            barkField('sender', 'barkSender', 'text', 'MeoW Push Bridge'),
          ],
          onSave: saveBark,
          saveLabel: t('barkSave'),
          onTest: () => testChannel('bark'),
          testLabel: t('barkTest'),
          onClear: clearBark,
          clearLabel: t('clear'),
          saving: smtpBusy,
          note: smtpNote,
          error: smtpError,
        })

      const renderBarkPanel = () => {
        const configured = pushConfig.bark && pushConfig.bark.status && pushConfig.bark.status.configured
        return React.createElement(
          'div',
          {
            key: 'bark-panel',
            style: {
              border: '1px dashed var(--dsw-alias-border-l2, #d9d9d9)',
              borderRadius: '8px',
              padding: '12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              maxWidth: '620px',
            },
          },
          React.createElement('h3', { style: { margin: 0, fontSize: '15px' } }, t('barkTitle')),
          React.createElement(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: '7px', fontSize: '12px' } },
            React.createElement('span', {
              style: {
                width: '9px',
                height: '9px',
                borderRadius: '50%',
                display: 'inline-block',
                background: configured
                  ? 'var(--dsw-alias-state-success-primary, #389e0d)'
                  : 'var(--dsw-alias-state-error-primary, #d4380d)',
              },
            }),
            React.createElement(
              'span',
              { style: { color: 'var(--dsw-alias-label-secondary, #595959)' } },
              pushConfig.bark && pushConfig.bark.status
                ? pushConfig.bark.status.detail
                : t('statusUnconfigured'),
            ),
          ),
          React.createElement(
            'p',
            { style: { margin: 0, fontSize: '12px', color: 'var(--dsw-alias-label-tertiary, #8c8c8c)' } },
            t('barkIntro'),
          ),
          barkField('token', 'barkToken', 'text', ''),
          barkField('sender', 'barkSender', 'text', 'MeoW Push Bridge'),
          React.createElement(
            'span',
            { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary, #8c8c8c)' } },
            t('barkTokenKeep'),
          ),
          React.createElement(
            'div',
            { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
            React.createElement(
              'button',
              {
                type: 'button',
                disabled: smtpBusy,
                onClick: saveBark,
                style: { padding: '6px 14px', fontSize: '13px', borderRadius: '6px', cursor: smtpBusy ? 'default' : 'pointer' },
              },
              smtpBusy ? t('saving') : t('barkSave'),
            ),
            React.createElement(
              'button',
              {
                type: 'button',
                disabled: smtpBusy,
                onClick: () => testChannel('bark'),
                style: { padding: '6px 14px', fontSize: '13px', borderRadius: '6px', cursor: smtpBusy ? 'default' : 'pointer' },
              },
              t('barkTest'),
            ),
          ),
          smtpNote !== ''
            ? React.createElement(
                'span',
                { style: { fontSize: '12px', color: 'var(--dsw-alias-state-success-primary, #389e0d)' } },
                smtpNote,
              )
            : null,
          smtpError !== ''
            ? React.createElement(
                'span',
                { style: { fontSize: '12px', color: 'var(--dsw-alias-state-error-primary, #d4380d)' } },
                smtpError,
              )
            : null,
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
        children.push(renderChannelTabs())

        if (tab === 'smtp') {
          children.push(renderSmtpPanelUnified())
        } else if (tab === 'bark') {
          children.push(renderBarkPanelUnified())
        } else {
          children.push(renderMeowPanel())
        }

        // ── 页脚：版权 + QQ用户沟通群（用户要求放在保存按钮下方）──────────
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
            React.createElement(
              'button',
              {
                type: 'button',
                onClick: openSponsor,
                style: {
                  padding: '4px 10px',
                  fontSize: '12px',
                  borderRadius: '6px',
                  border: '1px solid var(--dsw-alias-border-l2, #d9d9d9)',
                  background: 'transparent',
                  color: 'var(--dsw-alias-state-info-primary, #1677ff)',
                  cursor: 'pointer',
                },
              },
              t('sponsor'),
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
