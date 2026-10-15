# meow-push-bridge · 喵桥

> 让 DSH Agent 在完成任务后，通过 [MeoW](https://api.chuckfang.com) API 向你的鸿蒙手机推送通知。

[![npm](https://img.shields.io/npm/v/meow-push-bridge)](https://www.npmjs.com/package/meow-push-bridge)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20.6-339933)](https://nodejs.org)
[![tests](https://img.shields.io/badge/tests-128%20passing-brightgreen)](#开发与测试)

`meow-push-bridge` 是一个 DSH / Cordis 双半体插件：

- **宿主半体**注册工具 `meow_push_bridge`，让 Agent 能主动推送通知；
- **浏览器半体**在 DSH 设置页提供配置表单，填昵称即可，无需手写 YAML；
- **宿主侧自动推送**在每轮对话结束时由插件直接发通知，**不依赖模型自觉调用**。

| | |
|---|---|
| npm 包名 | `meow-push-bridge` |
| 插件 ID | `meow-push-bridge` |
| 工具名 | `meow_push_bridge` |
| 运行时依赖 | **零**（只用 Node 内置 `fetch` / `AbortSignal`） |

---

## 目录

- [特性](#特性)
- [环境要求](#环境要求)
- [安装](#安装)
- [配置](#配置)
- [使用](#使用)
- [工作方式](#工作方式)
- [MeoW API 行为](#meow-api-行为)
- [错误排查](#错误排查)
- [开发与测试](#开发与测试)
- [设计说明](#设计说明)
- [安全建议](#安全建议)
- [作者](#作者)
- [反馈](#反馈)
- [许可](#许可)

---

## 特性

- **配置极简**：DSH 设置 →「内置插件」→「喵桥」，**只需填一个 MeoW 昵称**
- **自动推送保证触发**：每轮回答结束都由宿主推送，不受模型是否遵守提示词影响
- **加载期强校验**：`nickname` 未配置时拒绝注册工具并给出明确指引，避免误推到他人账号
- **符合官方 API 规范**：按 [MeoW Push API 文档](https://www.chuckfang.com/MeoW/api_doc.html) 解析业务状态码（200/400/403/404/429/500），提示精确可操作
- **完整 URL 编码**：路径段先做全角替换再编码，中文、空格、`/`、`?`、`#`、`&` 都不会破坏请求
- **遵守官方限流**：客户端强制 3 秒最小发送间隔，并识别 `429` 给出降频建议
- **错误分类清晰**：区分 `invalid` / `timeout` / `aborted` / `network` / `http` / `forbidden` / `nickname` / `ratelimit` / `server`，每类给出可操作提示
- **双重超时保护**：请求超时（固化 10s）与上游取消信号，任一触发都能干净退出
- **节流防刷屏**：工具调用 5 秒内不重复推送；自动推送按轮次去重
- **零运行时依赖**：不引入任何 `@deepseek-ai/*`，避免版本漂移与私有 registry 解析问题

---

## 环境要求

| 项 | 要求 |
|---|---|
| Node.js | ≥ 20.6（需要内置 `fetch`、`AbortSignal.timeout`、`AbortSignal.any`） |
| DSH | 已安装，profile 使用 Cordis 配置 |
| MeoW | 鸿蒙手机已安装 MeoW App，且已设置用户昵称 |
| 网络 | 能访问 `https://api.chuckfang.com`（HTTP 亦可） |

---

## 安装

### 从 npm 安装（推荐）

```bash
dsh plugin --profile <你的profile> add meow-push-bridge
```

包页面：https://www.npmjs.com/package/meow-push-bridge

### 从本地 tarball 安装

```bash
pnpm install
pnpm pack
dsh plugin --profile <你的profile> add ./meow-push-bridge-0.1.0.tgz
```

安装成功后，`dsh plugin` 会把包写入 profile 的 `package.json` 并自动登记为 bundle：

```jsonc
{
  "dependencies": {
    "meow-push-bridge": "file:.../meow-push-bridge-0.1.0.tgz"
  },
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "meow-push-bridge"]
    }
  }
}
```

用 `dsh --profile <name> --dump-config` 可确认挂载结果：

```yaml
# == meow-push-bridge
- id: meow-push-bridge
  name: meow-push-bridge
  config:
    nickname: ''
```

> **装完必须重启 DSH**：已加载的模块不会因为重装而热更新。
> 部分 profile（如桌面应用的 profile）由应用独占管理，不能用 CLI 启动，只能通过应用重启加载。

### 源码调试（不安装）

把 [cordis.debug.patch.yml](cordis.debug.patch.yml) 作为叠加层挂进 profile：

```bash
dsh --profile <name> --patch ./cordis.debug.patch.yml
```

该文件的 `name` 指向 `./src/index.ts`，Loader 会直接加载 TypeScript 源码。

> 仓库内两个 patch 文件的区别只在 `name`：
> `cordis.patch.yml` → `meow-push-bridge`（发布用，解析到 `dist/index.js`）；
> `cordis.debug.patch.yml` → `./src/index.ts`（调试用）。
> npm 包的 `files` 白名单只含 `dist/` 与 `lib/`，发布配置里不能写 `./src/index.ts`。

---

## 配置

**只需填写一个 MeoW 昵称**，其余请求细节全部按官方推荐值固化在代码里，不对外暴露。

### 在 DSH 设置页配置（推荐）

**设置 → 内置插件 →「喵桥」**：

| 字段 | 控件 | 说明 | 默认值 |
|---|---|---|---|
| `nickname` | 文本框 | **必填**：你的 MeoW 用户昵称（官方文档：不允许包含斜杠） | — |

保存后，DSH 的 `settings` 服务会把值写入该 profile 的 `cordis.patch.yml` 并热应用：

```yaml
- id: meow-push-bridge
  name: meow-push-bridge
  config:
    nickname: 你的昵称
```

### 直接编辑配置文件

在 profile 的 `cordis.patch.yml` 中加入：

```yaml
- id: meow-push-bridge
  config:
    nickname: "你的MeoW昵称"     # 必填
```

### 字段说明

| 字段 | 类型 | 必填 | 默认值 | 非法时 |
|---|---|---|---|---|
| `nickname` | string | ✅ | — | 拒绝注册工具 + error 日志 |

归一化规则：`nickname` 去掉首尾空格。配置文件**不会**展开 `${ENV_VAR}`，请填写字面量昵称。

> 若 `nickname` 为空，插件会在日志中提示：
> `❌ 插件未启用：MeoW 昵称未配置，请在设置页的「喵桥」里填写昵称，或修改 cordis.patch.yml 后重载插件。`

### 固化的请求细节

以下参数**不再是配置项**（旧配置文件里若仍有这些字段，会被忽略并给出一次 warn 提示）：

| 参数 | 固化值 | 依据 |
|---|---|---|
| API 地址 | `https://api.chuckfang.com` | 官方推荐 HTTPS |
| 请求方法 | `GET` | 官方支持 GET / POST，GET 即可满足文本推送 |
| 请求超时 | `10000` ms | 兼顾慢网络与体验 |
| 消息格式 | `text`（纯文本） | 通知场景以纯文本为主 |
| HTML 显示高度 | `200` | 仅 `html` 格式使用，当前固定为 text |
| 同会话节流窗口 | `5000` ms | 工具被连续误调用时的保护 |
| 自动推送模式 | `every-turn`（每轮都推） | 避免「有时不推」 |
| 最小发送间隔 | `3000` ms | 遵守官方「3 秒 1 条」限流 |

> 需要极长消息或 HTML 渲染时，`src/meow-api.ts` 仍完整支持 `POST`、`msgType`、`htmlHeight`、
> `imgUrl` 等参数（有对应单元测试），只是没有把它们做成配置项，保持界面极简。

---

## 使用

### 工具参数

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `title` | string | — | 消息标题，缺省 `MeoW Push Bridge`（官方默认值 `MeoW`） |
| `message` | string | ✅ | 消息内容 |
| `url` | string | — | 点击通知后跳转的链接 |
| `imgUrl` | string | — | 本条消息的通知图标 URL，覆盖配置里的 `imgUrl` |

昵称不是工具参数 —— 推送目标由配置决定，模型无法在调用时改写。

### 自动推送（每轮对话总结）

**固定为「每轮都推」**：宿主监听轮次结束事件后直接推送，**不依赖模型**。

正文是**本轮对话总结** —— 你的提问 + 模型的最终回复 + 统计尾巴：

```text
【你问】帮我把验证按钮改成 POST
【回复】已把验证请求改成 POST，正文走 JSON Body；路径段只保留昵称与标题，因此不再有斜杠编码问题。
（调用 2 次工具：read、edit，耗时 12s）
```

内容来源：宿主通过 `ctx.sessions.get(agentId)` 取到 `Session` 对象，
再从 `session.snapshotEvents()` 读取本轮事件：

| 事件 | 用途 |
|---|---|
| `user/message` | 你的提问 |
| `assistant/message` | 模型的最终回复（只取 `text` 块，**推理块不会推送**） |
| `tool/call` | 工具调用次数与名字 |

> 为什么不用 LLM 生成总结：宿主层没有可调用的模型。直接取「提问 + 最终回复」
> 既准确又不额外消耗 token，也不需要第二次请求。

**截断策略**：提问超过 160 字、回复超过 600 字会被截断并加省略号（手机锁屏不宜过长）。

**降级行为**：拿不到会话（例如宿主未提供 `sessions` 服务）时，正文退化为纯统计
`本轮已完成：调用 3 次工具（pwsh、read），耗时 12s` —— **推送始终会发出**。

### 手动推送

直接对 Agent 说：

```text
把这次的结果推送到我手机上
```

插件同时向系统提示注册了使用约定，因此 Agent 也会在完成实质任务后主动推送一条**带语义总结**的通知。
模型那条在轮内发出，宿主那条（本轮对话总结）在轮末补位，所以总结总是排在最后。

### 命令行验证昵称

排障时可绕过插件直接确认昵称与网络：

```bash
# Linux / macOS
curl -sS "https://api.chuckfang.com/你的昵称/测试/hi"

# Windows PowerShell
curl.exe -sS "https://api.chuckfang.com/你的昵称/测试/hi"
```

---

## 工作方式

```
┌─ 宿主半体 dist/（Node，DSH 主进程）
│    apply(ctx, config)
│      ├─ 校验配置：nickname 缺失 → 记 error 并 return，不注册任何工具
│      ├─ 注册工具 meow_push_bridge
│      ├─ 注册提示词区段 tool:meow-push-bridge
│      └─ 注册自动推送（固定 every-turn，监听 agent/turn-stopping）
│
└─ 浏览器半体 lib/client.js（Web 前端）
     apply(ctx)
       └─ 注册设置页签「喵桥」
```

配置从设置页到生效的路径：

| 步骤 | 执行者 |
|---|---|
| 1. 用户在设置页填值并保存 | 浏览器半体 |
| 2. `ctx.remote.settings.update(ns, patch, revision)` | Remote RPC |
| 3. 定位并改写 profile 的 `cordis.patch.yml` | `@deepseek-ai/dsh-settings` |
| 4. 走正常 Loader 路径热应用 | Cordis Loader |
| 5. `Config['~standard'].validate()` 校验并补默认值 | 宿主半体 |

### 两个半体的构建

| 命令 | 产出 | 说明 |
|---|---|---|
| `pnpm build:node` | `dist/*.js` + `*.d.ts` | 宿主半体（tsc 生成） |
| `pnpm build:client` | `lib/client.js` | 浏览器半体（预构建 bundle → 复制并自检格式） |

浏览器半体必须是 `window.__ModuleLoader__.load({ id, factory })` 格式的**预构建文件**
（`package.json` 的 `exports["./client"]` 指向它，宿主直接读取该文件字节）；
缺失时 DSH 会报 `MissingClientBundleError`。本插件的表单较简单，因此手写该 bundle、不引入打包器。

### 事件与服务依赖

| 依赖 | 用途 |
|---|---|
| 事件 `agent/turn-stopping` | 轮次即将结束 → 触发自动推送 |
| 事件 `session/event`（`turn/start`、`tool/call`） | 记录本轮开始时间与工具调用统计 |
| 服务 `ctx.sessions` | 取 `Session` 对象 → `snapshotEvents()` 读取对话内容 |
| 服务 `ctx.systemPrompt` | 注册模型侧使用约定（缺失则跳过） |

降级链（**推送始终会发出**）：

| 缺失的能力 | 正文形态 |
|---|---|
| 全部可用 | `【你问】…【回复】…（调用 2 次工具…）` |
| 缺 `ctx.sessions` | `本轮已完成：调用 2 次工具（read、edit），耗时 12s` |
| 连 `session/event` 也拿不到 | `本轮已完成（纯问答，未使用工具，耗时 2s）` |

---

## MeoW API 行为

> 本节内容依据官方文档：**[MeoW Push API 消息推送接口文档](https://www.chuckfang.com/MeoW/api_doc.html)**（REST · v1）。
> 基础地址：`https://api.chuckfang.com/`（官方推荐 HTTPS）或 `http://api.chuckfang.com/`；协议 HTTP / HTTPS，方法 GET · POST。

### 请求形状

**GET**（默认，内容放在路径）

```
https://api.chuckfang.com/{昵称}/{title}/{msg}?url={url}&imgUrl={imgUrl}&msgType={msgType}&htmlHeight={htmlHeight}
# title 可省略
https://api.chuckfang.com/{昵称}/{msg}?...
```

**POST**（内容放在 Body，更适合长文本或 HTML）

```
POST /{昵称}/[title]
Content-Type: application/json
{ "title": "标题", "msg": "内容", "url": "https://…", "imgUrl": "https://…" }
```

### 参数

| 参数 | 位置 | 必填 | 说明 | 本插件使用方式 |
|---|---|---|---|---|
| 昵称 | 路径 | ✅ | 用户昵称，**不允许包含斜杠** | 配置 `nickname` |
| `title` | 路径 / Body | — | 省略时服务端使用 `MeoW` | 工具参数 `title`，缺省 `MeoW Push Bridge` |
| `msg` | 路径 / Body | ✅ | 消息内容 | 工具参数 `message` |
| `url` | 查询 / Body | — | 跳转链接（需 URL 编码） | 工具参数 `url` |
| `imgUrl` | 查询 / Body | — | 通知图标 URL，建议 **216×216 PNG**；Body 优先 | 工具参数 `imgUrl`（可选） |
| `msgType` | 请求参数 | — | `text`（默认，纯文本）或 `html`（App 内渲染） | 固定 `text` |
| `htmlHeight` | 请求参数 | — | 仅 `msgType=html` 生效，像素，默认 `200` | 固定 `200`（当前不发送） |

`msgType` 与 `htmlHeight` 是**请求参数**（查询串），不属于 JSON 参数。

### 响应

```jsonc
// 文档形状
{ "status": 200, "message": "推送成功" }

// 实测形状（字段名是 msg，本插件两者都兼容）
{ "status": 200, "data": true, "msg": "发送成功" }
```

**HTTP 状态码恒为 200** —— 成败以 JSON 的 `status` 字段为准：

| `status` | 含义 | 插件分类 | 提示要点 |
|---|---|---|---|
| `200` | 操作成功 | — | 返回 `✅` |
| `400` | 标题或消息参数错误 | `http` | 检查标题/内容是否符合要求 |
| `403` | 内容策略禁止发送 | `forbidden` | 内容被策略拦截 |
| `404` | 昵称未注册 | `nickname` | 检查 `nickname` 是否与 App 内昵称完全一致 |
| `429` | 发送或 IP 频率超限 | `ratelimit` | 见下方限流说明 |
| `500` | 服务器错误 | `server` | 稍后重试 |

### 限流（重要）

官方「通用说明」规定，非会员的发送上限为：

| 窗口 | 上限 |
|---|---|
| 3 秒 | 1 条 |
| 1 分钟 | 15 条 |
| 1 小时 | 60 条 |
| 1 天 | 1000 条 |

超出任一限制返回业务状态码 `429`。本插件的应对：

- **客户端最小间隔保护**：两次成功推送之间强制间隔 **3 秒**（`MIN_SEND_INTERVAL_MS`），避免每轮自动推送把 3 秒窗口打满
- **`429` 单独分类**，提示里直接给出上述阈值与降低频率的建议
- 仍可能触达分钟/小时上限 —— 高频长会话下请留意手机通知数量，必要时临时禁用插件

> 官方另提示：**尽量不要通过多人共享的公共出口 IP** 请求推送接口，可能被判定为攻击行为；
> 可信 IP 可联系开发者申请白名单。

### 路径段中的斜杠

官方文档明确「昵称不允许包含斜杠」；实测 URL **路径段**里的 `/` 编码后是 `%2F`，
而 MeoW 前置的 Tomcat 默认拒绝它（`ALLOW_ENCODED_SLASH=false`），
会在请求到达应用前返回 `HTTP 400`：

| 请求形状 | 结果 |
|---|---|
| 路径段含 `%2F`（内容里有 `/`） | ❌ 400 |
| `/` 换成全角 `／` 或 `_` | ✅ 200 |
| 查询串含 `%2F`（`?url=a%2Fb`） | ✅ 200 |

因此三个路径段（`nickname` / `title` / `message`）会先做全角替换再编码：
`/`→`／`、`\`→`＼`、`"`→`＂`、`'`→`＇`、`<`→`＜`、`>`→`＞`、`%`→`％`。
选全角而非删除是为了保留可读性：`72 通过 ／ 0 失败` 仍能看懂。

> 用 POST 时路径段只剩 `nickname` 与可选 `title`，正文放 Body，可完全避开这个问题。

### 工具返回值

成功：

```
✅ 通知已推送到 MeoW：{title} - {message}
```

失败时返回 `❌` 开头的中文说明，按分类给出建议（分类与官方 `status` 语义一一对应）：

| 分类 | 触发条件 | 示例 |
|---|---|---|
| `invalid` | `message` 为空，或昵称为空 | `⚠️ 推送失败：message 不能为空。` |
| 被取消 | 调用被上游中止 | `⚠️ 推送已取消：调用在开始前被中止。` |
| 被节流 | 同会话 5 秒内重复调用工具 | `⚠️ 推送已节流：同一会话在 5000ms 内只能推送一次，请 3214ms 后重试。` |
| `timeout` | 超时未响应 | `❌ 推送超时：MeoW 在 10000ms 内未响应…` |
| `aborted` | 取消信号触发 | `❌ 推送已取消：调用方中止了操作。` |
| `network` | DNS / 连接失败 / 代理问题 | `❌ 推送失败：无法连接 MeoW（fetch failed）…` |
| `http` | HTTP 非 2xx，或官方 `status: 400` | `❌ 推送失败：MeoW 判定标题或消息参数错误（status 400）…` |
| `forbidden` | 官方 `status: 403` | `❌ 推送被拒绝：内容策略禁止发送（status 403）` |
| `nickname` | 官方 `status: 404` | `❌ 推送失败：MeoW 昵称未注册（status 404）…` |
| `ratelimit` | 官方 `status: 429` | `❌ 推送被限流（status 429）… 非会员上限为 3 秒 1 条、每分钟 15 条、每小时 60 条…` |
| `server` | 官方 `status: 500` 或其他业务码 | `❌ 推送失败：MeoW 服务器错误（status 500）…` |
| `unknown` | 其他未预期错误 | 回显原始错误消息 |

其他保证：

- **会话级节流**：仅成功推送才计入；按会话独立，不同会话互不影响（窗口固化 5 秒）
- **全局最小间隔**：两次成功发送之间至少间隔 3 秒（遵守官方限流）
- **工具级超时**比请求超时多留 2 秒，避免被调度层先掐断
- 服务端返回体超过 300 字符会截断，避免污染上下文

---

## 错误排查

### 启动阶段

| 现象 | 原因 | 解决 |
|---|---|---|
| 日志出现 `❌ 插件未启用：MeoW 昵称未配置…` | `config.nickname` 为空 | 在设置页填写字面量昵称并重启 |
| 日志出现 `❌ 插件未启用：tools 服务不可用…` | 宿主未提供 tools 服务 | 确认 DSH 版本包含 `@deepseek-ai/dsh-tools`，并检查该 entry 是否被禁用 |
| 日志出现 `❌ 不变式不满足（meow-push-bridge/…）` | 插件契约被改动 | 按日志中的 `id` 对照 [src/invariant.ts](src/invariant.ts) 还原 |
| 日志出现 `warn`：`配置中的 apiBase / timeout / … 已不再是可配置项` | 旧版本留下的配置字段 | 属正常提示，可从 `cordis.patch.yml` 删除这些字段 |
| 工具列表里没有 `meow_push_bridge` | 插件未加载或配置未通过校验 | 先看启动日志的 `❌` 行；再确认 profile 的 patch 含该 entry |
| 设置页里没有「喵桥」页签 | ① 插件装在其他 profile；② 发行版缺少 `lib/client.js` | ① 用 `dsh plugin --profile <名> add …` 装到同一 profile；② 确认 `node_modules/meow-push-bridge/lib/client.js` 存在 |
| 重装插件后行为没变 | 已加载的模块不会热更新 | **重启 DSH** |

### 运行阶段

| 现象 | 原因 | 解决 |
|---|---|---|
| `status 400`（标题或消息参数错误） | 标题/内容不符合 MeoW 要求，或路径段编码异常 | 检查 `title` / `message` 是否为空或含非法字符 |
| `HTTP 400 Bad Request` + Tomcat 页面 | 路径段出现 `%2F` | 使用未做全角替换的旧版本；升级并重启 DSH |
| `status 403`（内容策略禁止发送） | 内容被 MeoW 的内容策略拦截 | 调整消息内容后重试 |
| `status 404`（昵称未注册） | 昵称错误或未在 MeoW 注册 | 用 `curl` 或 MeoW App 核对昵称；注意大小写与特殊字符 |
| `status 429`（频率超限） | 触达非会员限流（3 秒 1 条 / 分 15 / 时 60 / 天 1000） | 减少连续任务数量，或临时禁用插件的自动推送 |
| `status 500` | MeoW 服务端异常 | 稍后重试 |
| `无法连接 MeoW（fetch failed）` | 断网 / DNS / 代理 / 防火墙 | 确认能访问 `api.chuckfang.com`；如走代理，为 DSH 进程配置 `HTTP_PROXY` / `HTTPS_PROXY` |
| `推送超时` | 网络或 MeoW 响应慢 | 检查网络；超时时间已固化为 10 秒 |
| `推送已节流` | 同一会话 5 秒内重复调用**工具** | 等待提示的毫秒数。自动推送不受此限制 |
| 通知图标没变 | 传入的 `imgUrl` 不是可公开访问的图片 | 使用公网可访问的 URL，建议 216×216 PNG |
| 自动推送正文只有「本轮已完成…」 | 拿不到 `ctx.sessions`，或会话里没有对话事件 | 属预期降级：推送照常发出，只是没有对话正文 |
| 自动推送的回复内容被截断 | 超过 600 字（提问 160 字）触发截断 | 属预期设计：手机锁屏不宜过长 |
| 推送成功但手机没收到 | MeoW App 未登录 / 通知权限被关 / 免打扰 | 先看 MeoW 的**消息列表**：列表有记录说明投递成功，只是通知未弹出 |

---

## 开发与测试

```bash
pnpm install      # 只装 typescript + @types/node
pnpm typecheck    # 严格模式类型检查（src）
pnpm build        # build:node（tsc → dist/）+ build:client（→ lib/client.js）
pnpm test         # pretest: build + build:tests，随后跑 tests-dist/*.spec.js
pnpm pack         # 打 tarball（prepack 自动 build）
```

测试覆盖 **128 个用例**：

| 文件 | 用例数 | 覆盖内容 |
|---|---|---|
| [tests/register.spec.ts](tests/register.spec.ts) | 18 | 注册契约、配置校验、旧字段忽略、不变式、节流判定、**Cordis 服务访问纪律**（未注入属性不得直读） |
| [tests/impl.spec.ts](tests/impl.spec.ts) | 36 | URL 构造与编码、全角替换、业务状态码分类、POST、超时/取消、`execute` 端到端、固化请求细节 |
| [tests/schema.spec.ts](tests/schema.spec.ts) | 22 | Standard Schema 契约、schemastery 形状与**品牌标记**、设置页表单闸门 |
| [tests/client.spec.ts](tests/client.spec.ts) | 8 | 浏览器半体格式、页签注册、设置页仅含昵称、页脚、`dsh.client` 声明 |
| [tests/prompt.spec.ts](tests/prompt.spec.ts) | 8 | 提示词区段注册契约、排序区间、文案完整性 |
| [tests/summary.spec.ts](tests/summary.spec.ts) | 14 | 文本提取、轮次过滤、推理块排除、截断、文案渲染、降级 |
| [tests/auto-push.spec.ts](tests/auto-push.spec.ts) | 17 | 模式归一化、轮次去重、对话总结、统计兜底、降级行为 |

### 目录结构

```text
meow-push-bridge/
├── package.json            # dsh.bundle.patch + dsh.client 双声明
├── cordis.patch.yml        # 发布用挂载与配置
├── cordis.debug.patch.yml  # 源码调试用
├── tsconfig.json           # src → dist
├── tsconfig.tests.json     # tests → tests-dist
├── src/
│   ├── index.ts            # 宿主半体入口：配置校验 → 不变式 → 注册工具与自动推送
│   ├── auto-push.ts        # 轮次结束时的宿主侧自动推送
│   ├── summary.ts          # 从会话事件提取「提问 + 回复」总结
│   ├── client.js           # 浏览器半体（预构建 bundle）
│   ├── config.ts           # 配置归一化与校验
│   ├── meow-api.ts         # URL 构造、超时与错误分类
│   ├── invariant.ts        # 包自有不变式
│   ├── prompt.ts           # 系统提示区段（提示词层）
│   ├── schema.ts           # 零依赖 Config schema
│   └── tool.ts             # ToolDefinition 的结构化契约
├── lib/client.js           # 构建产物（浏览器半体）
├── dist/                   # 构建产物（宿主半体）
├── tests/                  # 6 个 spec 文件
└── scripts/
    ├── copy-client.mjs     # src/client.js → lib/client.js（带格式自检）
    └── run-tests.mjs       # 显式列文件跑 node --test
```

### 发布

```bash
npm login
pnpm pack                 # 先验证 tarball 内容
npm publish --access public

git tag v0.1.0
git push origin v0.1.0    # 随后在 GitHub 创建 Release 并上传 .tgz
```

---

## 设计说明

面向二次开发者的取舍说明。

1. **配置不合法时记日志并返回，而不是抛异常**
   抛异常会让 Loader 显示加载失败并打出堆栈，还可能影响同一 patch 中的其他 entry。
   返回则得到「插件在册但零工具」的干净状态，日志仍然明确。

2. **`nickname` 不进工具入参**
   推送目标是安全边界，只能由使用者通过配置决定，不能让模型在调用时改写。
   该约束由不变式 `schema-no-nickname` 强制保证。

3. **不 import `@deepseek-ai/*`**
   插件安装位置不保证能解析宿主的私有包。`src/tool.ts` 手写了与 DSH `ToolDefinition`
   对齐的结构化类型，运行时只使用全局 `fetch` / `AbortSignal`。

4. **自动推送采用「提示词 + 宿主事件」两层**
   仅靠提示词让模型自觉调用工具是概率性合规，不同环境表现不一致；
   仅靠宿主事件则触发可靠但需要自己取正文。因此两者并存：宿主层保证**每轮必发**，
   并从 `Session.snapshotEvents()` 取「提问 + 最终回复」组成总结；提示词层负责让模型
   在轮内额外发一条带语义标题的通知。宿主层刻意绕过工具级节流，改为按 `(会话, 轮次)` 去重。

5. **业务结果以官方 `status` 字段为准**
   依据 [官方文档](https://www.chuckfang.com/MeoW/api_doc.html)，HTTP 状态码恒为 200，
   成败在 JSON 的 `status` 里。插件按 `200/400/403/404/429/500` 分类，
   不再使用关键词启发式判定（那是文档未公开时的临时办法）。
   响应字段名兼容文档的 `message` 与实测的 `msg`。

6. **对话总结不调用 LLM**
   宿主层没有可用的模型，也没有必要为一个通知再跑一次推理。
   直接取本轮 `user/message` 与最后一条有文本的 `assistant/message`，
   推理块（`reasoning`）刻意排除 —— 那是内部思考，不该出现在手机锁屏上。

7. **测试针对编译产物**
   DSH 实际加载的是 `dist/*.js`，测试对准它才有意义。

8. **同时发布宿主半体与浏览器半体**
   DSH 没有「第三方插件自动生成配置表单」的机制，内置插件的配置页也都是各自手写的客户端包，
   因此本插件必须自带浏览器半体，否则用户只能手写 YAML。

9. **`Config` 需同时满足两套契约**

   | 读取方 | 需要的形状 |
   |---|---|
   | Cordis `resolveConfig` | 字符串键 `'~standard'`（Standard Schema，必须同步） |
   | `dsh-settings` 的 `volatileForm()` | schemastery 内部形状：`type` 为数据类型、字段带 `meta.volatile`、`dict`、`toJSON()` |

   注意 `type` 字段不能被挪作标识用途，否则设置页表单会失效。

---

## 安全建议

- **`cordis.patch.yml` 通常会被提交到 Git**：昵称本身不是密钥，但仍建议不要把它提交到公开仓库
- **默认走 HTTPS**：请求使用官方推荐的 `https://api.chuckfang.com`，传输已加密；若改为自建 `http://` 反代，请自行评估中间人风险
- **不要在通知正文里放密钥**：通知会经第三方服务传输，并在手机锁屏上可见
- **昵称会明文存在 profile 配置中**：分享该文件前请先抹掉

---

## 作者

| 角色 | 姓名 |
|---|---|
| 作者 | **骏骏爱编程** |
| 技术支持 | **方程 chuckfang**（MeoW API 与 MeoW App） |

---

## 反馈

| 类型 | 联系方式 |
|---|---|
| 项目反馈（插件本身的问题、建议、使用疑问） | [junjunloveprogramming@junjunloveprogramming.cn](mailto:junjunloveprogramming@junjunloveprogramming.cn) |
| MeoW App 反馈（推送未送达、账号问题、App 功能建议） | [chuckfang@qq.com](mailto:chuckfang@qq.com) |
| QQ 用户交流群（群号 **1051489523**） | [点击加入](https://qun.qq.com/universal-share/share?ac=1&authKey=2GwMnSDppys%2B%2FAwUgDKCcL6kV08o6VXdOlGLrTQCtHaUAakc%2FTb0nYrCRcpKQUh%2B&busi_data=eyJncm91cENvZGUiOiIxMDUxNDg5NTIzIiwidG9rZW4iOiJGRk11d1E1cVlFRU5teklhTTdIbzBCVzYyL2RORU9WNXFoNysvQ3dWRnRPQVhQVTlGbXFld1ZDRmF6Y0VlSkloIiwidWluIjoiMzEwMTUwNTU4NyJ9&data=lsWZ6DsKO3cpHWWQsuyLbIvgfrAucCFRsUxUfV6etyo2-SxHjn5W25_eg6epnhwpXLHn5fj0KS0SwXgIRHdL4w&svctype=4&tempid=h5_group_info) |

上文表格里的「点击加入」直接进群；也可以在 QQ 里搜索群号 **1051489523** 手动申请加入。
群里可以直接提问、反馈问题、交流用法。

提交项目问题时，建议附上以下信息以便快速定位：

- DSH 版本与操作系统
- profile 中该 entry 的 `config` 段（**请先抹掉昵称**）
- 启动日志里与 `meow-push-bridge` 相关的行
- 推送失败时的完整返回文案（例如 `❌ 推送失败：MeoW 返回 HTTP 400…`）

> 若「推送成功但手机没收到」，请先查看 **MeoW App 内的消息列表**：
> 列表中有记录说明已投递成功，问题在手机通知权限或免打扰设置；
> 列表中没有记录再联系 MeoW App 反馈邮箱。

---

## 许可

[MIT](LICENSE) © 2026 骏骏爱编程
