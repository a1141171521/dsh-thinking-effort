/**
 * dsh-thinking-effort — browser half.
 *
 * 多功能插件浏览器半区，两个功能：
 *
 *   1. thinking-effort：记住每个 (provider, model) 上次选择的推理档位，
 *      在重新点选模型时回放，避免档位被清空。
 *   2. refdir：引用目录 UI —— 输入栏 📁 芯片、会话头部按钮、管理面板，
 *      + 按钮命令菜单项。目录列表通过标准 settings 通道
 *      （api.settings.describe / mutate，namespace `refdir`）读写，
 *      不依赖自定义 RPC。
 *
 * Format: a standard client bundle — `window.__ModuleLoader__.load` with a
 * closure factory returning a Cordis plugin ({name, inject, apply}). Only
 * platform seed words and the shell module table are requireable; this bundle
 * needs `react` for the refdir UI, and everything else goes through ctx.
 */

window.__ModuleLoader__.load({
  id: 'dsh-thinking-effort',
  factory: (require) => {
    const name = 'dsh-thinking-effort'
    // 标准客户端 bundle 的 inject 是服务名声明：ctx.get() 只允许访问已注入
    // 的服务（未声明会抛 "cannot get property X without inject"）。
    // 'remote'/'remote.commands' 是命令通道（dsh-api-remotes 提供），
    // 'slots'/'commandUi'/'workspaces' 是 UI 服务，'connection' 供档位记忆。
    const inject = ['connection', 'remote', 'remote.commands', 'slots', 'commandUi', 'workspaces']

    // ---------------- 档位记忆（原功能，保持不变） ----------------

    const STORAGE_KEY = 'dsh-thinking-effort:efforts'

    function readMemory() {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        if (raw === null) return {}
        const parsed = JSON.parse(raw)
        return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
          ? parsed
          : {}
      } catch {
        return {}
      }
    }

    function writeMemory(memory) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(memory))
      } catch {
        /* quota/private mode — memory just does not persist */
      }
    }

    function keyOf(provider, model) {
      return `${provider}/${model}`
    }

    function installEffortMemory(ctx) {
      const connection = ctx.get('connection')
      if (connection === undefined || connection.api === undefined) return
      const sessions = connection.api.sessions
      if (sessions === undefined || typeof sessions.selectModel !== 'function') return

      const original = sessions.selectModel.bind(sessions)
      sessions.selectModel = async (payload) => {
        const provider = payload?.provider
        const model = payload?.model
        if (typeof provider !== 'string' || typeof model !== 'string') {
          return original(payload)
        }
        const key = keyOf(provider, model)
        const memory = readMemory()
        const effort = payload.reasoningEffort

        if (effort !== undefined) {
          if (memory[key] !== effort) {
            memory[key] = effort
            writeMemory(memory)
          }
          return original(payload)
        }

        const remembered = memory[key]
        if (remembered === undefined) return original(payload)
        return original({ ...payload, reasoningEffort: remembered })
      }
    }

    // ---------------- 引用目录 UI（新功能） ----------------

    // 共享状态（闭包级 store，与动态版一致）
    const state = { open: false, dirs: [], workspaceCwd: '', loading: false, error: null }
    const listeners = new Set()
    function subscribe(fn) {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    }
    function setState(patch) {
      Object.assign(state, patch)
      for (const fn of listeners) fn()
    }

    // 命令通道（Host 注册 refdir-list/add/remove 命令，返回 JSON 文本）
    async function cmd(ctx, sessionId, line) {
      const remote = ctx.get('remote')
      if (remote === undefined || !remote.commands || typeof remote.commands.execute !== 'function') {
        throw new Error('命令通道不可用')
      }
      // commands/execute 的远程契约是 execute(agent, line, images, signal)：
      // 3 个业务参数（sessionId、命令行、图片附件数组）+ 可选 AbortSignal。
      // 少传 images 会被网关以 "expected 3 business argument(s)" 拒绝。
      const envelope = await remote.commands.execute(sessionId, line, [])
      if (!envelope || !envelope.ok) {
        const err = envelope && envelope.error
        throw new Error('命令执行失败: ' + (err ? err.code + ': ' + err.message : line))
      }
      const result = envelope.value && envelope.value.result
      if (!result) throw new Error('命令无返回: ' + line)
      if (result.kind === 'error') throw new Error(result.text)
      return JSON.parse(result.text)
    }

    async function refresh(ctx, sessionId) {
      try {
        const data = await cmd(ctx, sessionId, '/refdir-list')
        setState({
          dirs: data && Array.isArray(data.dirs) ? data.dirs : [],
          workspaceCwd: data && typeof data.workspaceCwd === 'string' ? data.workspaceCwd : '',
          loading: false,
          error: null,
        })
      } catch (error) {
        setState({ loading: false, error: error && error.message ? error.message : String(error) })
      }
    }

    async function addDir(ctx, sessionId) {
      const workspaces = ctx.get('workspaces')
      if (workspaces === undefined || typeof workspaces.pickDirectory !== 'function') {
        setState({ error: '目录选择器不可用（需要桌面端原生目录选择器）' })
        return
      }
      setState({ loading: true, error: null })
      try {
        const path = await workspaces.pickDirectory()
        if (path === null) {
          setState({ loading: false })
          return
        }
        await cmd(ctx, sessionId, '/refdir-add ' + JSON.stringify(path))
        await refresh(ctx, sessionId)
      } catch (error) {
        setState({ loading: false, error: error && error.message ? error.message : String(error) })
      }
    }

    async function removeDir(ctx, sessionId, id) {
      try {
        await cmd(ctx, sessionId, '/refdir-remove ' + String(id))
        await refresh(ctx, sessionId)
      } catch (error) {
        setState({ error: error && error.message ? error.message : String(error) })
      }
    }

    function toggle(ctx, sessionId) {
      if (state.open) {
        setState({ open: false })
      } else {
        setState({ open: true })
        refresh(ctx, sessionId)
      }
    }

    function installRefdirUi(ctx, React) {
      const slots = ctx.get('slots')
      if (slots === undefined || React === undefined) return

      // 样式（原生注入，随插件卸载清理）
      const style = document.createElement('style')
      style.textContent = `
        .refdir-chip {
          flex: none;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 3px;
          height: 28px;
          min-width: 28px;
          padding: 0 7px;
          border: none;
          border-radius: 8px;
          background: transparent;
          color: var(--dsw-alias-label-secondary);
          cursor: pointer;
          font-size: 13px;
          line-height: 1;
        }
        .refdir-chip:hover { background: var(--dsw-alias-border-l1); }
        .refdir-chip-count {
          font-size: 11px;
          font-weight: 600;
          color: var(--dsw-alias-label-primary);
          background: var(--dsw-alias-border-l1);
          border-radius: 8px;
          padding: 1px 5px;
        }
        .refdir-header {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          height: 26px;
          padding: 0 10px;
          border: 1px solid var(--dsw-alias-border-l2);
          border-radius: 8px;
          background: transparent;
          color: var(--dsw-alias-label-secondary);
          font-size: 12px;
          cursor: pointer;
        }
        .refdir-header:hover { background: var(--dsw-alias-border-l1); }
        .refdir-panel {
          position: absolute;
          bottom: calc(100% + 8px);
          left: 0;
          width: 340px;
          max-height: 420px;
          overflow-y: auto;
          box-sizing: border-box;
          padding: 12px;
          border-radius: 12px;
          background: var(--dsw-alias-bg-overlay);
          border: 1px solid var(--dsw-alias-border-l2);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
          font-size: 13px;
          color: var(--dsw-alias-label-primary);
          z-index: 300;
        }
        .refdir-panel-title { font-size: 14px; font-weight: 600; margin-bottom: 8px; }
        .refdir-panel-workspace {
          display: flex; flex-direction: column; gap: 2px;
          padding: 6px 8px; margin-bottom: 8px; border-radius: 8px;
          background: var(--dsw-alias-border-l1);
        }
        .refdir-panel-ws-label { font-size: 11px; color: var(--dsw-alias-label-secondary); }
        .refdir-panel-ws-path { font-size: 12px; word-break: break-all; }
        .refdir-panel-empty {
          padding: 10px 4px; color: var(--dsw-alias-label-secondary); line-height: 1.6;
        }
        .refdir-panel-list { display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; }
        .refdir-panel-row {
          display: flex; align-items: center; gap: 8px;
          padding: 6px 8px; border-radius: 8px; background: var(--dsw-alias-border-l1);
        }
        .refdir-panel-row-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
        .refdir-panel-row-title { font-weight: 600; font-size: 13px; }
        .refdir-panel-row-path {
          font-size: 11px; color: var(--dsw-alias-label-secondary);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .refdir-panel-remove {
          flex: none; width: 22px; height: 22px; border: none; border-radius: 6px;
          background: transparent; color: var(--dsw-alias-label-secondary);
          cursor: pointer; font-size: 12px; line-height: 1;
        }
        .refdir-panel-remove:hover {
          color: var(--dsw-alias-state-error-primary); background: var(--dsw-alias-border-l1);
        }
        .refdir-panel-error {
          margin-bottom: 8px; padding: 6px 8px; border-radius: 8px;
          color: var(--dsw-alias-state-error-primary);
          background: var(--dsw-alias-border-l1); font-size: 12px;
        }
        .refdir-panel-add {
          width: 100%; height: 32px; border: none; border-radius: 8px;
          background: var(--dsw-alias-brand-primary); color: #fff;
          font-size: 13px; font-weight: 600; cursor: pointer;
        }
        .refdir-panel-add:disabled { opacity: 0.6; cursor: default; }
        .refdir-panel-hint {
          margin-top: 8px; font-size: 11px; color: var(--dsw-alias-label-secondary); line-height: 1.5;
        }
      `
      document.head.appendChild(style)
      ctx.effect(() => () => { style.remove() })

      function useSharedState() {
        const [, setTick] = React.useState(0)
        React.useEffect(() => subscribe(() => setTick((x) => x + 1)), [])
        return state
      }

      const Chip = (props) => {
        const s = useSharedState()
        const sessionId = props.sessionId
        const count = s.dirs.length
        return React.createElement('button', {
          type: 'button',
          className: 'refdir-chip',
          'data-refdir-chip': true,
          title: count > 0 ? '引用目录（' + count + '）' : '引用目录：点击添加',
          'aria-label': '引用目录',
          'aria-expanded': s.open,
          onClick: () => toggle(ctx, sessionId),
        },
          React.createElement('span', { className: 'refdir-chip-icon', 'aria-hidden': true }, '📁'),
          count > 0 ? React.createElement('span', { className: 'refdir-chip-count' }, String(count)) : null,
        )
      }

      const HeaderAction = (props) => {
        const s = useSharedState()
        const sessionId = props.sessionId
        const count = s.dirs.length
        return React.createElement('button', {
          type: 'button',
          className: 'refdir-header',
          'data-refdir-header': true,
          title: '引用目录（点击管理）',
          onClick: () => toggle(ctx, sessionId),
        }, '📁 引用目录' + (count > 0 ? ' · ' + count : ''))
      }

      const Panel = (props) => {
        const s = useSharedState()
        const sessionId = props.sessionId
        React.useEffect(() => {
          if (state.open) refresh(ctx, sessionId)
        }, [state.open, sessionId])
        React.useEffect(() => {
          if (!state.open) return
          const onDown = (e) => {
            if (e.target instanceof Node && e.target.closest
              && e.target.closest('[data-refdir-panel], [data-refdir-chip], [data-refdir-header]')) return
            setState({ open: false })
          }
          document.addEventListener('pointerdown', onDown, true)
          return () => document.removeEventListener('pointerdown', onDown, true)
        }, [state.open])
        if (!s.open) return null
        return React.createElement('div', { className: 'refdir-panel', 'data-refdir-panel': true, role: 'dialog', 'aria-label': '引用目录' },
          React.createElement('div', { className: 'refdir-panel-title' }, '引用目录'),
          React.createElement('div', { className: 'refdir-panel-workspace', title: s.workspaceCwd },
            React.createElement('span', { className: 'refdir-panel-ws-label' }, '主工作区'),
            React.createElement('span', { className: 'refdir-panel-ws-path' }, s.workspaceCwd || '未知'),
          ),
          s.dirs.length === 0 && !s.loading
            ? React.createElement('div', { className: 'refdir-panel-empty' }, '还没有引用目录。添加后，对话即可读取并操作这些文件夹中的文件（类似 Claude Desktop 的附加文件夹）。')
            : React.createElement('div', { className: 'refdir-panel-list' },
                s.dirs.map((d) => React.createElement('div', { key: d.id, className: 'refdir-panel-row' },
                  React.createElement('span', { className: 'refdir-panel-row-main', title: d.path },
                    React.createElement('span', { className: 'refdir-panel-row-title' }, d.title),
                    React.createElement('span', { className: 'refdir-panel-row-path' }, d.path),
                  ),
                  React.createElement('button', {
                    type: 'button',
                    className: 'refdir-panel-remove',
                    title: '移除引用',
                    'aria-label': '移除 ' + d.title,
                    onClick: () => removeDir(ctx, sessionId, d.id),
                  }, '✕'),
                )),
              ),
          s.error ? React.createElement('div', { className: 'refdir-panel-error' }, s.error) : null,
          React.createElement('button', {
            type: 'button',
            className: 'refdir-panel-add',
            disabled: s.loading,
            onClick: () => addDir(ctx, sessionId),
          }, s.loading ? '处理中…' : '＋ 添加引用目录'),
          React.createElement('div', { className: 'refdir-panel-hint' }, '也可以点击输入框左侧的 + 按钮，在「引用目录」命令中添加。'),
        )
      }

      slots.inject('conversation.input.left', () => slots.register(
        { name: 'conversation.input.left', id: 'refdir-chip', order: 50, label: '引用目录' },
        (props) => React.createElement(Chip, props),
      ))
      slots.inject('conversation.session.header.actions', () => slots.register(
        { name: 'conversation.session.header.actions', id: 'refdir-header', order: 0, label: '引用目录' },
        (props) => React.createElement(HeaderAction, props),
      ))
      slots.inject('conversation.input.overlay', () => slots.register(
        { name: 'conversation.input.overlay', id: 'refdir-panel', order: 200, label: '引用目录面板' },
        (props) => React.createElement(Panel, props),
      ))

      // 命令菜单（点击输入框 + 按钮后可见）
      const commandUi = ctx.get('commandUi')
      if (commandUi !== undefined && typeof commandUi.register === 'function') {
        ctx.effect(() => commandUi.register({
          name: 'refdir',
          description: '管理引用目录：添加/移除可供对话读取的文件夹',
          available: () => true,
          ui: {
            kind: 'popupSelect',
            options: async (session) => {
              let dirs = []
              try {
                const data = await cmd(ctx, String(session.sessionId), '/refdir-list')
                dirs = data && Array.isArray(data.dirs) ? data.dirs : []
              } catch (error) {
                dirs = []
              }
              return [
                { id: 'add', label: '＋ 添加引用目录', detail: '从磁盘选择文件夹' },
                ...dirs.map((d) => ({ id: 'dir:' + d.id, label: d.title, detail: d.path, active: true })),
              ]
            },
            onSelect: async (option, session) => {
              const sessionId = String(session.sessionId)
              if (option.id === 'add') {
                await addDir(ctx, sessionId)
              } else if (typeof option.id === 'string' && option.id.indexOf('dir:') === 0) {
                await removeDir(ctx, sessionId, option.id.slice(4))
              }
              await refresh(ctx, sessionId)
            },
          },
        }))
      }
    }

    function apply(ctx) {
      installEffortMemory(ctx)

      let React
      try {
        React = require ? require('react') : undefined
      } catch (error) {
        React = undefined
      }
      installRefdirUi(ctx, React)
    }

    return { name, inject, apply }
  },
})
