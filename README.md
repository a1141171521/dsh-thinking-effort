# dsh-thinking-effort

Declare Codex-style reasoning effort levels (Off / Low / Medium / High) for
OpenAI-compatible **third-party models** in DeepSeek Harness, so the built-in
model selector shows its **Effort** row for those models — the same shape
built-in deepseek models have.

## 这是什么

DSH 的 llm 服务只为**适配器声明了档位**的模型接受 `reasoningEffort`。第三方
（自定义）模型通常没有声明，导致模型选择器隐藏 Effort 行，显式选择档位时
还会报 `UNSUPPORTED_REASONING_EFFORT`。本插件在激活时（以及
`llm-pi-ai` 配置每次变化时）自动为 `llm-pi-ai` 下所有 OpenAI 兼容模型补上
Codex 风格档位声明：

```yaml
reasoningEfforts:
  off: null      # 支持关闭思考，不发送参数
  low: low       # 发送 reasoning_effort: "low"
  medium: medium
  high: high
```

声明后，内置模型选择器的模型下方会出现 Effort 行，可逐档选择；选中的档位
通过官方 `selectModel` 通道保存，请求时以 `reasoning_effort` 参数发送。

## 安装

### 从 GitHub（本仓库）

```sh
dsh plugin --profile demo add github:<your-org>/dsh-thinking-effort
```

> git 安装的是**源码**。本项目是纯 JavaScript（无构建步骤），因此无需
> `prepare` 脚本，加载即可用。

### 本地路径

```sh
dsh plugin --profile demo add ./dsh-thinking-effort
```

### 构建产物（可选）

发布到 npm 或打包 tarball 同样受支持：

```sh
pnpm pack            # 生成 tarball
dsh plugin add ./dsh-thinking-effort-0.1.0.tgz
```

## 使用

1. 启动 DSH（Web UI），模型选择器中选中第三方模型（如 zjpai 下的模型）
2. 打开模型下拉 → 根菜单出现 **Model / Effort** 两行 → 进入 Effort
3. 选择 Off / Low / Medium / High
4. 触发请求，观察 wire 上的 `reasoning_effort` 参数

## 说明与限制

- 只处理 `api: openai-completions` 的 provider；`modelOverrides` 与
  `models` 列表均会处理（当前实现对 `models` 列表生效）。
- 档位声明是**幂等**的：已声明的模型不会被重复写入。
- 若某个厂商端点实际不识别 `reasoning_effort`，请求可能被**厂商**拒绝
  （与 Codex 行为一致——直接发送，不预先探测）。此时可在
  `settings.yaml` 中手动删除该模型的 `reasoningEfforts` 块。
- 卸载本插件（`dsh plugin --profile demo remove dsh-thinking-effort`）
  不会回滚已写入的声明；如需移除请手动编辑 `settings.yaml`。

## 开发

```sh
# 本地验证 patch 层
dsh --profile demo --dump-config
dsh --profile demo
```
