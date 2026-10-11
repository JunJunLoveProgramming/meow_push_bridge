# meow-push-bridge · 喵桥

> 让 DSH Agent 在完成任务后，通过 [MeoW](http://api.chuckfang.com) API 向你的鸿蒙手机推送通知。

[![npm](https://img.shields.io/npm/v/meow-push-bridge)](https://www.npmjs.com/package/meow-push-bridge)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20.6-339933)](https://nodejs.org)
[![tests](https://img.shields.io/badge/tests-91%20passing-brightgreen)](#开发与测试)

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

- **设置页可视化配置**：DSH 设置 →「内置插件」→「喵桥」，填昵称、选自动推送模式
- **自动推送保证触发**：`pushMode: every-turn` 时每轮回答结束都由宿主推送，不受模型是否遵守提示词影响
- **加载期强校验**：`nickname` 未配置时拒绝注册工具并给出明确指引，避免误推到他人账号
- **完整 URL 编码**：路径段先做全角替换再编码，中文、空格、`/`、`?`、`#`、`&` 都不会破坏请求
- **错误分类清晰**：区分 `invalid` / `timeout` / `aborted` / `network` / `http` / `business`，每类给出可操作提示
- **双重超时保护**：请求超时（默认 10s）与上游取消信号，任一触发都能干净退出
- **节流防刷屏**：工具调用默认 5 秒内不重复推送；自动推送按轮次去重
- **零运行时依赖**：不引入任何 `@deepseek-ai/*`，避免版本漂移与私有 registry 解析问题

---

## 环境要求

| 项 | 要求 |
|---|---|
| Node.js | ≥ 20.6（需要内置 `fetch`、`AbortSignal.timeout`、`AbortSignal.any`） |
| DSH | 已安装，profile 使用 Cordis 配置 |
| MeoW | 鸿蒙手机已安装 MeoW App，且已设置用户昵称 |
| 网络 | 能访问 `http://api.chuckfang.com` |

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
    pushMode: every-turn
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

### 在 DSH 设置页配置（推荐）

**设置 → 内置插件 →「喵桥」**：

| 字段 | 控件 | 说明 | 默认值 |
|---|---|---|---|
| `nickname` | 文本框 | **必填**：你的 MeoW 用户昵称 | — |
| `apiBase` | 文本框 | MeoW API 基础地址（可指向自建反代） | `http://api.chuckfang.com` |
| `timeout` | 数字框 | 单次请求超时毫秒数，范围 100–120000 | `10000` |
| `throttleMs` | 数字框 | 工具调用的同会话节流窗口，`0` 关闭 | `5000` |
| `pushMode` | 下拉框 | 自动推送模式，见下 | `every-turn` |

保存后，DSH 的 `settings` 服务会把值写入该 profile 的 `cordis.patch.yml` 并热应用：

```yaml
- id: meow-push-bridge
  name: meow-push-bridge
  config:
    nickname: 你的昵称
    apiBase: http://api.chuckfang.com
    timeout: 10000
    throttleMs: 5000
    pushMode: every-turn
```

### 直接编辑配置文件

在 profile 的 `cordis.patch.yml` 中加入：

```yaml
- id: meow-push-bridge
  config:
    nickname: "你的MeoW昵称"     # 必填
    apiBase: "http://api.chuckfang.com"
    timeout: 10000
    throttleMs: 5000
    pushMode: every-turn
```

### 字段说明

| 字段 | 类型 | 必填 | 默认值 | 非法时 |
|---|---|---|---|---|
| `nickname` | string | ✅ | — | 拒绝注册工具 + error 日志 |
| `apiBase` | string | — | `http://api.chuckfang.com` | 回退默认值 + warn 日志 |
| `timeout` | number | — | `10000` | 回退默认值 + warn 日志 |
| `throttleMs` | number | — | `5000` | 回退默认值 + warn 日志 |
| `pushMode` | string | — | `every-turn` | 回退默认值 + warn 日志 |

归一化规则：`nickname` 与 `apiBase` 去掉首尾空格，`apiBase` 末尾多余的 `/` 会被清理。
配置文件**不会**展开 `${ENV_VAR}`，请填写字面量昵称。

> 若 `nickname` 为空，插件会在日志中提示：
> `❌ 插件未启用：MeoW 昵称未配置，请在 cordis.patch.yml 中填写 nickname 字段后重载插件。`

---

## 使用

### 工具参数

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `title` | string | — | 通知标题，缺省 `MeoW Push Bridge` |
| `message` | string | ✅ | 通知正文 |
| `url` | string | — | 点击通知后跳转的链接 |

昵称不是工具参数 —— 推送目标由配置决定，模型无法在调用时改写。

### 自动推送

由 `pushMode` 控制，宿主监听轮次结束事件后直接推送，**不依赖模型**：

| 值 | 行为 |
|---|---|
| `every-turn` | 每轮回答结束都推 |
| `substantial` | 仅当本轮调用过工具才推 |
| `off` | 关闭自动推送，只保留手动 |

正文为统计式描述：

```text
本轮已完成：调用 3 次工具（pwsh、read、grep），耗时 12s
本轮已完成（纯问答，未使用工具，耗时 2s）
```

### 手动推送

直接对 Agent 说：

```text
把这次的结果推送到我手机上
```

插件同时向系统提示注册了使用约定，因此 Agent 也会在完成实质任务后主动推送一条**带语义总结**的通知。
模型那条在轮内发出，宿主那条在轮末补位，所以统计式描述总是排在最后。

### 命令行验证昵称

排障时可绕过插件直接确认昵称与网络：

```bash
# Linux / macOS
curl -sS "http://api.chuckfang.com/你的昵称/测试/hi"

# Windows PowerShell
curl.exe -sS "http://api.chuckfang.com/你的昵称/测试/hi"
```

---

## 工作方式

```
┌─ 宿主半体 dist/（Node，DSH 主进程）
│    apply(ctx, config)
│      ├─ 校验配置：nickname 缺失 → 记 error 并 return，不注册任何工具
│      ├─ 注册工具 meow_push_bridge
│      ├─ 注册提示词区段 tool:meow-push-bridge
│      └─ 按 pushMode 注册自动推送（监听 agent/turn-stopping）
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

### 事件依赖

| 事件 | 用途 |
|---|---|
| `agent/turn-stopping` | 轮次即将结束 → 触发自动推送 |
| `session/event`（`turn/start`、`tool/call`） | 统计本轮使用了哪些工具，用于生成通知正文 |

统计是尽力而为：若某环境拿不到 `session/event`，正文退化为「本轮已完成」，推送照常发出。

---

## MeoW API 行为

### 请求形状

```
http://api.chuckfang.com/{nickname}/{title}/{message}?url={url}
```

### 响应

```jsonc
// 成功
{ "status": 200, "data": true, "msg": "发送成功" }

// 昵称不存在（HTTP 状态码仍然为 200）
{ "status": 404, "data": false, "msg": "发送失败，该昵称没有注册，一天之内累计3次输错对方昵称您的IP将被封禁" }
```

- **HTTP 状态码恒为 200**，真正的结果在 JSON 的 `status` / `data` 里，不能只看 HTTP 状态判断成败
- MeoW 提示：**一天内累计 3 次输错昵称会封 IP**，调试时不要反复试错昵称

### 路径段中的斜杠

URL **路径段**里的 `/` 编码后是 `%2F`，而 MeoW 前置的 Tomcat 默认拒绝它
（`ALLOW_ENCODED_SLASH=false`），会在请求到达应用前返回 `HTTP 400`：

| 请求形状 | 结果 |
|---|---|
| 路径段含 `%2F`（正文里有 `/`） | ❌ 400 |
| `/` 换成全角 `／` 或 `_` | ✅ 200 |
| 查询串含 `%2F`（`?url=a%2Fb`） | ✅ 200 |
| 路径段含空格 / `:` / `#` / `&` / `?`（编码后） | ✅ 200 |

因此三个路径段（`nickname` / `title` / `message`）会先做全角替换再编码：
`/`→`／`、`\`→`＼`、`"`→`＂`、`'`→`＇`、`<`→`＜`、`>`→`＞`、`%`→`％`。
选全角而非删除是为了保留可读性：`72 通过 ／ 0 失败` 仍能看懂。

### 工具返回值

成功：

```
✅ 通知已推送到 MeoW：{title} - {message}
```

失败时返回 `❌` 开头的中文说明，按分类给出建议：

| 分类 | 触发条件 | 示例 |
|---|---|---|
| `invalid` | `message` 为空 | `⚠️ 推送失败：message 不能为空。` |
| 被取消 | 调用被上游中止 | `⚠️ 推送已取消：调用在开始前被中止。` |
| 被节流 | 同会话 `throttleMs` 内重复调用工具 | `⚠️ 推送已节流：同一会话在 5000ms 内只能推送一次，请 3214ms 后重试。` |
| `timeout` | 超时未响应 | `❌ 推送超时：MeoW 在 10000ms 内未响应…` |
| `aborted` | 取消信号触发 | `❌ 推送已取消：调用方中止了操作。` |
| `network` | DNS / 连接失败 / 代理问题 | `❌ 推送失败：无法连接 MeoW（fetch failed）…` |
| `http` | HTTP 状态码非 2xx | `❌ 推送失败：MeoW 返回 HTTP 400…` |
| `business` | HTTP 2xx 但返回体表示失败 | `❌ 推送被 MeoW 拒绝（HTTP 200）：发送失败，该昵称没有注册…` |

其他保证：仅成功推送才计入节流；节流按会话独立；工具级超时比请求超时多留 2 秒；
服务端返回体超过 300 字符会截断。

---

## 错误排查

### 启动阶段

| 现象 | 原因 | 解决 |
|---|---|---|
| 日志出现 `❌ 插件未启用：MeoW 昵称未配置…` | `config.nickname` 为空 | 在设置页或 `cordis.patch.yml` 填写字面量昵称并重启 |
| 日志出现 `❌ 插件未启用：tools 服务不可用…` | 宿主未提供 tools 服务 | 确认 DSH 版本包含 `@deepseek-ai/dsh-tools`，并检查该 entry 是否被禁用 |
| 日志出现 `❌ 不变式不满足（meow-push-bridge/…）` | 插件契约被改动 | 按日志中的 `id` 对照 [src/invariant.ts](src/invariant.ts) 还原 |
| 日志出现 `warn`：`apiBase "…" 不是合法的 http(s) 地址` | `apiBase` 写法有误 | 改为 `http://…` 或 `https://…`，或删除该字段用默认值 |
| 工具列表里没有 `meow_push_bridge` | 插件未加载或配置未通过校验 | 先看启动日志的 `❌` 行；再确认 profile 的 patch 含该 entry |
| 设置页里没有「喵桥」页签 | ① 插件装在其他 profile；② 发行版缺少 `lib/client.js` | ① 用 `dsh plugin --profile <名> add …` 装到同一 profile；② 确认 `node_modules/meow-push-bridge/lib/client.js` 存在 |
| 重装插件后行为没变 | 已加载的模块不会热更新 | **重启 DSH** |

### 运行阶段

| 现象 | 原因 | 解决 |
|---|---|---|
| `HTTP 400 Bad Request` + Tomcat 页面 | 路径段出现 `%2F` | 使用未做全角替换的旧版本；升级并重启 DSH |
| `HTTP 404` / 返回体含「该昵称没有注册」 | 昵称错误或未在 MeoW 注册 | 用 `curl` 验证昵称；注意大小写与特殊字符，并留意「输错 3 次封 IP」 |
| `HTTP 5xx` | MeoW 服务端异常 | 稍后重试 |
| `无法连接 MeoW（fetch failed）` | 断网 / DNS / 代理 / 防火墙 | 确认能访问 `api.chuckfang.com`；如走代理，为 DSH 进程配置 `HTTP_PROXY` / `HTTPS_PROXY` |
| `推送超时` | 网络或 MeoW 响应慢 | 调大 `timeout` |
| `推送已节流` | 同一会话 5 秒内重复调用**工具** | 等待提示的毫秒数，或调小 `throttleMs`。自动推送不受此限制 |
| 某些回合没有自动推送 | `pushMode` 为 `substantial` 且本轮未用工具，或为 `off` | 设为 `every-turn` |
| 自动推送正文只有「本轮已完成」 | 该环境拿不到会话事件，统计为空 | 属预期降级：推送照常发出，只是没有工具明细 |
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

测试覆盖 **91 个用例**：

| 文件 | 用例数 | 覆盖内容 |
|---|---|---|
| [tests/register.spec.ts](tests/register.spec.ts) | 14 | 注册契约、配置校验、不变式、节流判定、服务探测异常 |
| [tests/impl.spec.ts](tests/impl.spec.ts) | 24 | URL 构造与编码、全角替换、超时/取消/错误分类、`execute` 端到端 |
| [tests/schema.spec.ts](tests/schema.spec.ts) | 21 | Standard Schema 契约、schemastery 形状、设置页表单闸门、枚举字段 |
| [tests/client.spec.ts](tests/client.spec.ts) | 5 | 浏览器半体格式、页签注册形状、RPC 参数透传、`dsh.client` 声明 |
| [tests/prompt.spec.ts](tests/prompt.spec.ts) | 8 | 提示词区段注册契约、排序区间、文案完整性 |
| [tests/auto-push.spec.ts](tests/auto-push.spec.ts) | 13 | 三种 `pushMode`、轮次去重、统计累计、降级行为 |

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
   仅靠宿主事件则拿不到有语义的正文。因此两者并存：宿主层保证触发（统计式正文），
   提示词层负责语义总结。宿主层刻意绕过工具级节流，改为按 `(会话, 轮次)` 去重。

5. **业务错误的判定是启发式的**
   MeoW 未公开完整返回契约。插件只在 HTTP 2xx 且返回体包含
   `fail` / `error` / `失败` / `不存在` 等关键词时判为 `business`。
   如需更严格的判定，可改为按 `data === false` 处理。

6. **测试针对编译产物**
   DSH 实际加载的是 `dist/*.js`，测试对准它才有意义。

7. **同时发布宿主半体与浏览器半体**
   DSH 没有「第三方插件自动生成配置表单」的机制，内置插件的配置页也都是各自手写的客户端包，
   因此本插件必须自带浏览器半体，否则用户只能手写 YAML。

8. **`Config` 需同时满足两套契约**

   | 读取方 | 需要的形状 |
   |---|---|
   | Cordis `resolveConfig` | 字符串键 `'~standard'`（Standard Schema，必须同步） |
   | `dsh-settings` 的 `volatileForm()` | schemastery 内部形状：`type` 为数据类型、字段带 `meta.volatile`、`dict`、`toJSON()` |

   注意 `type` 字段不能被挪作标识用途，否则设置页表单会失效。

---

## 安全建议

- **`cordis.patch.yml` 通常会被提交到 Git**：昵称本身不是密钥，但若 `apiBase` 指向含 token 的自建网关，请改用环境变量注入或将该文件加入 `.gitignore`
- **MeoW API 使用 HTTP**：不可信网络下通知内容可能被中间人看到，敏感信息建议自建 HTTPS 反代并把 `apiBase` 指向它
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
