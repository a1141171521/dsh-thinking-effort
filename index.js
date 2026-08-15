/**
 * dsh-thinking-effort — 多功能插件入口
 *
 * 单一插件，安装一次，按模块组合多个扩展功能：
 *
 *   1. thinking-effort（modules/thinking-effort.js）
 *      为 OpenAI 兼容第三方模型声明推理档位并钉住默认档位。
 *   2. refdir（modules/refdir.js）
 *      引用目录（附加文件夹）：为会话添加可读写的白名单文件夹，
 *      注册 refdir_list/read/write/edit/grep 五个动态工具。
 *
 * 以后新增功能 = 在 modules/ 下新增一个模块文件，在这里 import 并在
 * inject / apply 中挂上即可，安装方式不变（cordis.patch.yml 无需改动）。
 */
import * as thinkingEffort from './modules/thinking-effort.js'
import * as refdir from './modules/refdir.js'

export const name = 'dsh-thinking-effort'

/** 合并所有子模块的硬依赖；注入由 Cordis 按需等待。 */
export const inject = [...new Set([...thinkingEffort.inject, ...refdir.inject])]

export function apply(ctx, config) {
  // 子模块按序激活；各自持有独立的 ctx 生命周期（effect/on 等自动清理）。
  thinkingEffort.apply(ctx, config)
  refdir.apply(ctx, config)
}
