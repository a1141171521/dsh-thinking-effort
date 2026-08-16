# dsh-thinking-effort

Declare Codex-style reasoning effort levels (Off / Low / Medium / High) for
OpenAI-compatible **third-party models** in DeepSeek Harness, so the built-in
model selector shows its **Effort** row for those models — and pin the
route-level default effort so switching away and back keeps your choice.

## 💬 DeepSeek Harness 插件交流群

欢迎加入 **DeepSeek Harness 插件交流 QQ 群**——插件开发、模型接入、推理档位、
第三方厂商配置等话题都可以在这里交流，本插件的问题与建议也欢迎直接进群反馈：

> ## 🐧 QQ 群号：`1105449571`
>
> 打开 QQ → 搜索群号 **1105449571** 即可加入（进群请备注「dsh 插件」）

群内可交流：插件开发经验、模型接入与档位配置、DSH 使用技巧、新功能需求投票等。

## 多功能插件（v0.5.0+）

本插件按**模块**组合多个扩展功能，安装一次全部生效，后续功能持续加入：

| 模块 | 功能 |
| --- | --- |
| `modules/thinking-effort.js` | 推理档位：为第三方模型声明档位并钉住默认档位 |
| `modules/refdir.js` | **引用目录（附加文件夹）**：为会话添加可读写的白名单文件夹，对话可用 `refdir_list/read/write/edit/grep` 工具操作，类似 Claude Desktop 的附加文件夹/副工作区 |

新增功能 = 在 `modules/` 下加一个模块文件并在 `index.js` 挂上，安装方式不变。

## 引用目录（refdir 模块）

### 入口

- 点击输入框左侧 **+ 按钮** → 命令菜单选择 **`refdir` 引用目录** → 「＋ 添加引用目录」→ 系统文件夹选择器选中即添加（再点已添加的目录行 = 移除）
- 输入框工具行新增 **📁 芯片**（显示引用目录数量）、会话标题栏新增 **「📁 引用目录」按钮** → 打开管理面板：显示主工作区路径、目录列表（可一键移除）、添加按钮

### 对话获得的能力（添加引用目录后）

- 5 个专属动态工具：`refdir_list`（列文件）、`refdir_read`（读文件）、`refdir_write`（写文件）、`refdir_edit`（编辑）、`refdir_grep`（搜索）
- 工具只能访问**你显式添加的引用目录**内的路径（白名单校验，`fs.contains` 围栏），引用目录之外的路径一律拒绝
- 每个会话一份独立列表；持久化到该会话日志目录旁的 `refdirs.json`（重启 DSH 后重新加载插件即可恢复）
- 浏览器 UI 通过标准命令通道（Host 注册 `refdir-list/add/remove` 命令，客户端 `ctx.remote.commands.execute` 调用）读写列表，不依赖自定义 RPC；插件本身保持纯 JS 零第三方依赖

## 这是什么

DSH 的 llm 服务只为**适配器声明了档位**的模型接受 `reasoningEffort`。第三方
（自定义）模型通常没有声明，导致模型选择器隐藏 Effort 行，显式选择档位时
还会报 `UNSUPPORTED_REASONING_EFFORT`。本插件在激活时（以及
`llm-pi-ai` 配置每次变化时）自动为 `llm-pi-ai` 下所有 OpenAI 兼容模型补上
档位声明：

```yaml
reasoningEfforts:
  off: null      # 支持关闭思考，不发送参数
  low: low       # 发送 reasoning_effort: "low"
  medium: medium
  high: high
  xhigh: xhigh
  max: max
```

> 档位集合与 DeepSeek 协议网关一致（该协议只接受 low / medium / high /
> xhigh / max，拒绝 minimal）。已声明的模型会**补齐缺失档位**，已有值
> （包括手动钉为 `null` 的）保持不动；`reasoningEfforts: false` 的模型
> 不触碰。

本模块**同时处理** `api: openai-completions` 与 `api: openai-responses`
两类 provider；新接入的 Responses API 运营商也会在接入时自动补齐档位声明，
无需手动配置。

声明后，内置模型选择器的模型下方会出现 Effort 行，可逐档选择；选中的档位
通过官方 `selectModel` 通道保存，请求时以 `reasoning_effort` 参数发送。

## 默认档位直接加载到 High（v0.3.0+）

内置选择器在**重新点选模型**时会发送模型的默认档位（`defaultEffort`）。第三方
模型通常没有默认档位，等于把档位清空——所以"选 High → 切到别的模型 → 切回"
会变回 Default。本插件在激活时给每个 OpenAI 兼容 provider **钉上 route 级
默认档位**（`reasoning: high`），这样：

- 每个模型的 `defaultEffort` 变成 `high`，模型选择器默认就显示 **High**
- 切到别的模型再切回，选择器发送 `reasoningEffort: high`，档位保持 **High**

配置写法（插件自动写入，无需手改）：

```yaml
llm-pi-ai:
  providers:
    zjpai:
      reasoning: high        # ← 默认档位，插件自动钉上
      models: [...]
```

默认档位可通过插件配置调整（`cordis.patch.yml` 的 config 或 profile 覆盖）：

```yaml
- insert:
    - id: thinking-effort
      name: dsh-thinking-effort
      config:
        defaultEffort: medium   # 不写默认 high
```

### 浏览器档位记忆（v0.2.0，可选增强）

此外，浏览器半（`dsh.client`）会在你**显式选档**时记录每个
`provider/model` 的档位（localStorage），并在重新点选模型时回放——即使你
在 Effort 面板选了别的档位，切走再切回也保持你上次的选择。

## 安装

### 从 GitHub（本仓库）

```sh
dsh plugin --profile demo add github:a1141171521/dsh-thinking-effort
```

> git 安装的是**源码**。本项目是纯 JavaScript（无构建步骤），因此无需
> `prepare` 脚本，加载即可用。浏览器半是手写的标准 client bundle，同样
> 无需构建。

### 本地路径

```sh
dsh plugin --profile demo add ./dsh-thinking-effort
```

### 构建产物（可选）

发布到 npm 或打包 tarball 同样受支持：

```sh
pnpm pack            # 生成 tarball
dsh plugin add ./dsh-thinking-effort-0.3.0.tgz
```

## 使用

1. 启动 DSH（Web UI），模型选择器中选中第三方模型（如 zjpai 下的模型）
2. 打开模型下拉 → 根菜单出现 **Model / Effort** 两行 → 进入 Effort
3. 默认档位是 **High**；可切换 Off / Low / Medium / High
4. 切到别的模型再切回，档位保持你上次的选择
5. 触发请求，观察 wire 上的 `reasoning_effort` 参数

> 插件（含浏览器半）需要**重启 DSH 进程**后加载：`dsh.client` 行在启动时
> 扫描，负向判定会缓存，刷新浏览器不会重新扫描。

## 说明与限制

- 同时处理 `api: openai-completions` 与 `api: openai-responses` 的
  provider；档位声明对 `models` 列表生效。
- 档位声明与默认档位写入都是**幂等**的：已声明的模型、已钉默认档位的
  provider 不会被重复写入。
- 若某个厂商端点实际不识别 `reasoning_effort`，请求可能被**厂商**拒绝
  （与 Codex 行为一致——直接发送，不预先探测）。此时可在
  `settings.yaml` 中手动删除该模型的 `reasoningEfforts` 块与 provider 的
  `reasoning` 行。
- 卸载本插件（`dsh plugin --profile demo remove dsh-thinking-effort`）
  不会回滚已写入的声明；如需移除请手动编辑 `settings.yaml`。
- 本地档位记忆存在浏览器 localStorage，卸载插件后记忆仍在（键
  `dsh-thinking-effort:efforts`），可在浏览器开发者工具里清除。

## 开发

```sh
# 本地验证 patch 层
dsh --profile demo --dump-config
dsh --profile demo
```

---

## 📣 加入交流

对 DeepSeek Harness 插件开发感兴趣？欢迎加入交流群一起讨论：

**QQ 群：`1105449571`**（QQ 内搜索群号即可加入）

群内分享：插件开发经验、模型接入配置、档位与推理调优、DSH 使用技巧。
如果这个插件帮到了你，也欢迎进群点个赞、提个建议 🌟
