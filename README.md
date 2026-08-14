# dsh-thinking-effort

Declare Codex-style reasoning effort levels (Off / Low / Medium / High) for
OpenAI-compatible **third-party models** in DeepSeek Harness, so the built-in
model selector shows its **Effort** row for those models — and pin the
route-level default effort so switching away and back keeps your choice.

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

- 只处理 `api: openai-completions` 的 provider；档位声明对 `models` 列表生效。
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
