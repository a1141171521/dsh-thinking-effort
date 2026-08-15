/**
 * dsh-refdir — 引用目录（附加文件夹）模块
 *
 * 为用户显式添加的文件夹提供白名单式读写能力，类似 Claude Desktop 的
 * "附加文件夹/副工作区"：
 *
 * - 每个会话维护一份引用目录列表；持久化到该会话日志目录下的
 *   `refdirs.json`（与动态插件版相同的布局，进程重启后重新加载即恢复）。
 * - 注册 5 个动态工具（refdir_list/read/write/edit/grep），工具只能访问
 *   某个引用目录内的路径（fs.contains 白名单校验）。
 * - 注册 3 个管理命令（refdir-list / refdir-add / refdir-remove），返回
 *   JSON 文本；浏览器半区（client.js）用标准命令通道
 *   （ctx.remote.commands.execute）读写列表，不依赖自定义 RPC，也不
 *   import 任何第三方包（保持插件纯 JS 零依赖，符号链接安装可直接加载）。
 *
 * 本模块只依赖标准 Cordis 服务（tools / commands / fs / sessionPersistence /
 * sessions），可独立于 thinking-effort 模块运行。
 */

/** settings 之外的持久化文件名（写在会话日志目录旁）。 */
const STORE_FILE = 'refdirs.json'

// 会话级状态（进程内缓存 + 文件持久化）
const dirsBySession = new Map()      // sessionId -> [{ id, path, title, addedAt }]
const storeDirBySession = new Map()  // sessionId -> 持久化目录（缓存）

export const inject = ['tools', 'commands', 'fs', 'sessionPersistence', 'sessions']

export function apply(ctx) {
  const fs = ctx.fs

  // ---------- 持久化 ----------

  function dirname(p) {
    const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'))
    return i < 0 ? p : p.slice(0, i)
  }
  function basename(p) {
    const t = String(p).replace(/[/\\]+$/, '')
    const i = Math.max(t.lastIndexOf('\\'), t.lastIndexOf('/'))
    return i < 0 ? t : t.slice(i + 1)
  }
  function listDirs(sessionId) {
    return dirsBySession.get(sessionId) ?? []
  }

  async function sessionDir(sessionId) {
    const cached = storeDirBySession.get(sessionId)
    if (cached !== undefined) return cached
    const session = ctx.sessions.get(sessionId)
    if (session === undefined) return undefined
    const loc = ctx.sessionPersistence.locate(session.header)
    if (loc === undefined) return undefined
    const dir = dirname(loc.path)
    storeDirBySession.set(sessionId, dir)
    return dir
  }

  async function loadStore(sessionId) {
    try {
      const dir = await sessionDir(sessionId)
      if (dir === undefined) return
      const target = await fs.resolve(dir + '/' + STORE_FILE)
      const text = await fs.readText(target)
      const parsed = JSON.parse(text)
      if (parsed && Array.isArray(parsed.dirs)) {
        dirsBySession.set(sessionId, parsed.dirs.filter((d) => d && typeof d.id === 'string' && typeof d.path === 'string'))
      }
    } catch (error) {
      /* 首次运行或文件损坏：忽略 */
    }
  }

  async function persist(sessionId) {
    try {
      const dir = await sessionDir(sessionId)
      if (dir === undefined) return
      const target = await fs.resolve(dir + '/' + STORE_FILE)
      await fs.writeText(target, JSON.stringify({ dirs: listDirs(sessionId) }, null, 2), undefined, undefined, { mode: 'danger-full-access', workspaceRoot: dir })
    } catch (error) {
      console.error('[dsh-refdir] 持久化引用目录失败（仅保留内存态）', error instanceof Error ? error.message : String(error))
    }
  }

  async function refDirs(sessionId) {
    if (!dirsBySession.has(sessionId)) await loadStore(sessionId)
    return listDirs(sessionId)
  }

  async function setDirs(sessionId, dirs) {
    dirsBySession.set(sessionId, dirs)
    await persist(sessionId)
  }

  /** 校验目标路径位于某个引用目录内；返回 { dir, target }。 */
  async function resolveUnderRefDir(sessionId, rawPath) {
    const dirs = await refDirs(sessionId)
    if (dirs.length === 0) {
      throw new Error('当前会话尚未添加引用目录。请先在界面中点击“＋ 添加引用目录”选择文件夹。')
    }
    let target
    try {
      target = await fs.resolve(String(rawPath))
    } catch (error) {
      throw new Error('无法解析路径: ' + String(rawPath))
    }
    for (const dir of dirs) {
      let root
      try {
        root = await fs.resolve(dir.path)
      } catch (error) {
        continue
      }
      if (fs.contains(root, target)) return { dir, target, root }
    }
    throw new Error('路径不在任何引用目录内（引用目录: ' + dirs.map((d) => d.path).join('; ') + '）: ' + String(rawPath))
  }

  function sessionOf(exec) {
    const sessionId = exec && exec.agent ? exec.agent.id : undefined
    if (!sessionId) throw new Error('无法确定当前会话')
    return sessionId
  }

  function safeEntry(child) {
    const entry = { path: child.target.displayPath, name: child.name, type: child.type }
    if (child.size !== undefined) entry.size = child.size
    return entry
  }

  async function scanRootOf(r) {
    if (r.target !== undefined) return r.target
    return await fs.resolve(r.dir.path)
  }

  // ---------- 工具注册 ----------

  const output = {
    schema: { type: 'object', additionalProperties: true },
    render: (args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
  }

  const disposers = []

  disposers.push(ctx.tools.register({
    name: 'refdir_list',
    description: '列出当前会话的引用目录及其中的文件。不传 path 时返回所有引用目录根及每个根的直接子项；传入 path（引用目录内文件的绝对路径或相对路径）可查看子目录；depth 控制递归深度（1-4，默认 1）。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '引用目录内要列出的目录路径；省略则列出所有引用目录根' },
        depth: { type: 'integer', description: '递归深度 1-4，默认 1' },
      },
    },
    output,
    async execute(args, exec) {
      const sessionId = sessionOf(exec)
      const dirs = await refDirs(sessionId)
      if (dirs.length === 0) {
        return { dirs: [], entries: [], note: '当前会话还没有引用目录，请先添加' }
      }
      const depth = Math.max(1, Math.min(4, args && args.depth === undefined ? 1 : Number(args.depth)))
      const hasPath = args && typeof args.path === 'string' && args.path.trim() !== ''
      const roots = hasPath ? [await resolveUnderRefDir(sessionId, args.path)] : dirs.map((d) => ({ dir: d }))
      const entries = []
      async function walk(target, level) {
        let children
        try {
          children = await fs.listDir(target)
        } catch (error) {
          return
        }
        for (const child of children) {
          entries.push(safeEntry(child))
          if (child.type === 'directory' && level < depth) {
            await walk(child.target, level + 1)
          }
        }
      }
      for (const r of roots) {
        await walk(await scanRootOf(r), 0)
      }
      return { dirs: dirs.map((d) => ({ id: d.id, path: d.path, title: d.title })), entries, total: entries.length }
    },
  }))

  disposers.push(ctx.tools.register({
    name: 'refdir_read',
    description: '读取引用目录下一个文本文件的内容（UTF-8）。path 必须是某个引用目录内文件的绝对路径或相对路径。maxBytes 上限默认 100000，最大 1000000。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '引用目录内文件的路径' },
        maxBytes: { type: 'integer', description: '读取上限（字节），默认 100000' },
      },
      required: ['path'],
    },
    output,
    async execute(args, exec) {
      const sessionId = sessionOf(exec)
      if (!args || typeof args.path !== 'string' || args.path.trim() === '') throw new Error('refdir_read: 需要 path 参数')
      const cap = Math.max(1, Math.min(1000000, args.maxBytes === undefined ? 100000 : Number(args.maxBytes)))
      const { target } = await resolveUnderRefDir(sessionId, args.path)
      const info = await fs.stat(target)
      if (info === undefined) throw new Error('文件不存在: ' + args.path)
      if (info.type !== 'file') throw new Error('不是文件: ' + args.path)
      const bytes = await fs.readBytes(target, undefined, cap)
      return { path: target.displayPath, size: bytes.length, content: new TextDecoder('utf-8').decode(bytes) }
    },
  }))

  disposers.push(ctx.tools.register({
    name: 'refdir_write',
    description: '在引用目录下创建或覆盖写入一个 UTF-8 文本文件。父目录必须已存在（不支持自动创建目录）。返回写入结果。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '引用目录内目标文件的路径' },
        content: { type: 'string', description: '要写入的完整文本内容' },
      },
      required: ['path', 'content'],
    },
    output,
    async execute(args, exec) {
      const sessionId = sessionOf(exec)
      if (!args || typeof args.path !== 'string' || args.path.trim() === '') throw new Error('refdir_write: 需要 path 参数')
      if (typeof args.content !== 'string') throw new Error('refdir_write: 需要 content 参数')
      const { target, dir } = await resolveUnderRefDir(sessionId, args.path)
      // 写操作逐调用授权到引用目录根（用户显式添加即授权；白名单已由 resolveUnderRefDir 校验）
      const outcome = await fs.writeText(target, args.content, undefined, undefined, { mode: 'danger-full-access', workspaceRoot: dir.path })
      return { ok: true, path: target.displayPath, operation: outcome.operation }
    },
  }))

  disposers.push(ctx.tools.register({
    name: 'refdir_edit',
    description: '在引用目录下的一个文本文件中做字面量替换编辑。oldString 必须精确匹配文件内容中的一段文本；replaceAll 为 true 时替换所有匹配，否则要求恰好匹配一次。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '引用目录内目标文件的路径' },
        oldString: { type: 'string', description: '要替换的原文' },
        newString: { type: 'string', description: '替换后的文本' },
        replaceAll: { type: 'boolean', description: '是否替换所有匹配，默认 false' },
      },
      required: ['path', 'oldString', 'newString'],
    },
    output,
    async execute(args, exec) {
      const sessionId = sessionOf(exec)
      if (!args || typeof args.path !== 'string' || args.path.trim() === '') throw new Error('refdir_edit: 需要 path 参数')
      if (typeof args.oldString !== 'string' || args.oldString === '') throw new Error('refdir_edit: 需要非空 oldString 参数')
      if (typeof args.newString !== 'string') throw new Error('refdir_edit: 需要 newString 参数')
      const { target, dir } = await resolveUnderRefDir(sessionId, args.path)
      await fs.editText(target, {
        oldString: args.oldString,
        newString: args.newString,
        replaceAll: args.replaceAll === true,
      }, undefined, undefined, { mode: 'danger-full-access', workspaceRoot: dir.path })
      return { ok: true, path: target.displayPath }
    },
  }))

  disposers.push(ctx.tools.register({
    name: 'refdir_grep',
    description: '在当前会话的引用目录内按正则表达式搜索文件内容，返回命中的文件与行。默认在所有引用目录下搜索（深度不超过 6，最多扫描 800 个文件，单文件不超过 512KB）；path 可限定在某个引用目录或其子目录内搜索。',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: '正则表达式（JavaScript 语法）' },
        path: { type: 'string', description: '限定搜索的引用目录内路径；省略则搜索全部引用目录' },
        maxMatches: { type: 'integer', description: '最大命中行数，默认 50，上限 200' },
      },
      required: ['pattern'],
    },
    output,
    async execute(args, exec) {
      const sessionId = sessionOf(exec)
      if (!args || typeof args.pattern !== 'string' || args.pattern === '') throw new Error('refdir_grep: 需要 pattern 参数')
      let pattern
      try {
        pattern = new RegExp(args.pattern)
      } catch (error) {
        throw new Error('无效的正则表达式: ' + args.pattern)
      }
      const dirs = await refDirs(sessionId)
      if (dirs.length === 0) return { matches: [], note: '当前会话还没有引用目录' }
      const maxMatches = Math.max(1, Math.min(200, args.maxMatches === undefined ? 50 : Number(args.maxMatches)))
      const hasPath = typeof args.path === 'string' && args.path.trim() !== ''
      const roots = hasPath ? [await resolveUnderRefDir(sessionId, args.path)] : dirs.map((d) => ({ dir: d }))
      const matches = []
      const budget = { files: 0, maxFiles: 800 }
      const decoder = new TextDecoder('utf-8')
      let truncated = false
      // 广度优先：先扫浅层文件，避免深目录（如 skills 仓库）耗尽文件预算
      // 而让浅层的目标文件永远轮不到。
      async function scanRoot(startTarget) {
        const queue = [{ target: startTarget, level: 0 }]
        while (queue.length > 0 && matches.length < maxMatches && budget.files < budget.maxFiles) {
          const { target, level } = queue.shift()
          let children
          try {
            children = await fs.listDir(target)
          } catch (error) {
            continue
          }
          for (const child of children) {
            if (matches.length >= maxMatches || budget.files >= budget.maxFiles) {
              truncated = true
              return
            }
            if (child.type === 'directory') {
              if (level < 6) queue.push({ target: child.target, level: level + 1 })
            } else if (child.type === 'file') {
              budget.files += 1
              if (child.size !== undefined && child.size > 524288) continue
              let text
              try {
                const bytes = await fs.readBytes(child.target, undefined, 524288)
                text = decoder.decode(bytes)
              } catch (error) {
                continue
              }
              const lines = text.split('\n')
              for (let i = 0; i < lines.length; i++) {
                if (matches.length >= maxMatches) {
                  truncated = true
                  return
                }
                pattern.lastIndex = 0
                if (pattern.test(lines[i])) {
                  matches.push({ file: child.name, path: child.target.displayPath, line: i + 1, text: lines[i].slice(0, 500) })
                }
              }
            }
          }
        }
        if (queue.length > 0) truncated = true
      }
      for (const r of roots) {
        await scanRoot(await scanRootOf(r))
      }
      const result = { dirs: dirs.map((d) => d.title), matches, count: matches.length }
      if (truncated) result.note = '扫描达到上限（文件数 800 或命中数 ' + maxMatches + '），结果可能不完整；可用 path 参数限定搜索范围'
      return result
    },
  }))

  // ---------- 管理命令（浏览器 UI 通过 ctx.remote.commands.execute 调用） ----------

  /** 命令 handler 统一包装：成功返回 {kind:'success', text:JSON}，异常 → error 文本。 */
  function command(handler) {
    return async (invocation) => {
      try {
        const value = await handler(invocation)
        return { kind: 'success', text: JSON.stringify(value) }
      } catch (error) {
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
      }
    }
  }

  disposers.push(ctx.commands.register({
    name: 'refdir-list',
    description: '列出当前会话的引用目录（JSON 文本；浏览器 UI 内部使用）',
    handler: command(async (invocation) => {
      const sessionId = invocation.agent && invocation.agent.id
      if (!sessionId) throw new Error('无法确定当前会话')
      const dirs = await refDirs(sessionId)
      const session = ctx.sessions.get(sessionId)
      return {
        ok: true,
        dirs: dirs.map((d) => ({ id: d.id, path: d.path, title: d.title, addedAt: d.addedAt })),
        workspaceCwd: session === undefined ? '' : String(session.header.cwd ?? ''),
      }
    }),
  }))

  disposers.push(ctx.commands.register({
    name: 'refdir-add',
    description: '添加引用目录（参数：JSON 字符串形式的路径）',
    handler: command(async (invocation) => {
      const sessionId = invocation.agent && invocation.agent.id
      if (!sessionId) throw new Error('无法确定当前会话')
      let path
      try {
        path = JSON.parse(invocation.rawInput.trim())
      } catch (error) {
        throw new Error('refdir-add 参数必须是 JSON 字符串路径，例如 /refdir-add "D:\\\\folder"')
      }
      if (typeof path !== 'string' || path === '') throw new Error('目录路径不能为空')
      const dirs = await refDirs(sessionId)
      if (dirs.some((d) => d.path === path)) return { ok: true, added: false, message: '该目录已在引用目录中', dirs }
      let target
      try {
        target = await fs.resolve(path)
      } catch (error) {
        throw new Error('目录不存在或无法访问: ' + path)
      }
      try {
        await fs.listDir(target)
      } catch (error) {
        throw new Error('不是可读取的目录: ' + path)
      }
      const entry = {
        id: 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        path,
        title: basename(path),
        addedAt: Date.now(),
      }
      const next = dirs.concat([entry])
      await setDirs(sessionId, next)
      return { ok: true, added: true, message: '已添加引用目录: ' + path, dirs: next }
    }),
  }))

  disposers.push(ctx.commands.register({
    name: 'refdir-remove',
    description: '移除引用目录（参数：目录 id）',
    handler: command(async (invocation) => {
      const sessionId = invocation.agent && invocation.agent.id
      if (!sessionId) throw new Error('无法确定当前会话')
      const id = invocation.rawInput.trim()
      if (id === '') throw new Error('refdir-remove 需要目录 id 参数')
      const dirs = await refDirs(sessionId)
      const next = dirs.filter((d) => d.id !== id)
      await setDirs(sessionId, next)
      return { ok: true, dirs: next }
    }),
  }))

  // 插件停止时注销全部工具与命令
  ctx.effect(() => () => {
    for (const dispose of disposers) {
      try {
        dispose()
      } catch (error) {
        /* 注销失败不阻塞清理 */
      }
    }
  })
}
