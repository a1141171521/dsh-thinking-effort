/**
 * dsh-thinking-effort — browser half.
 *
 * Remembers the last reasoning effort chosen per (provider, model) and
 * replays it when the model is re-selected, so switching away and back does
 * not silently reset the effort to the provider default.
 *
 * Why this exists: the built-in model selector sends the model's
 * `defaultEffort` (or nothing) whenever a model row is picked
 * (ModelSelect.choose), which overwrites the session's current selection.
 * Third-party models usually declare no default, so re-picking a model
 * clears the effort the user chose earlier. This plugin wraps
 * `session.selectModel`: a pick that carries no explicit effort is filled
 * from the per-model memory, and every explicit effort choice is recorded.
 *
 * Format: a standard client bundle — `window.__ModuleLoader__.load` with a
 * closure factory returning a Cordis plugin ({name, inject, apply}). Only
 * platform seed words and the shell module table are requireable; this half
 * needs none, so the bundle is a plain script.
 */

window.__ModuleLoader__.load({
  id: 'dsh-thinking-effort',
  factory: () => {
    const name = 'dsh-thinking-effort'
    const inject = ['connection']

    const STORAGE_KEY = 'dsh-thinking-effort:efforts'

    /** Read the per-model effort memory (plain object; corrupt/absent → {}). */
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

    /** Write the memory back; storage failure is non-fatal. */
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

    /**
     * Wrap `session.selectModel` on the shared api client.
     * @param ctx - client cordis context (provides `connection`).
     */
    function apply(ctx) {
      const connection = ctx.connection
      if (connection === undefined || connection.api === undefined) return
      const sessions = connection.api.sessions
      if (sessions === undefined || typeof sessions.selectModel !== 'function') return

      const original = sessions.selectModel.bind(sessions)
      sessions.selectModel = async (payload) => {
        // Shape guard: only selections carrying provider+model participate.
        const provider = payload?.provider
        const model = payload?.model
        if (typeof provider !== 'string' || typeof model !== 'string') {
          return original(payload)
        }
        const key = keyOf(provider, model)
        const memory = readMemory()
        const effort = payload.reasoningEffort

        // A pick with an explicit effort is the user choosing — remember it.
        if (effort !== undefined) {
          if (memory[key] !== effort) {
            memory[key] = effort
            writeMemory(memory)
          }
          return original(payload)
        }

        // A pick with no effort (model row re-selected) replays the memory.
        const remembered = memory[key]
        if (remembered === undefined) return original(payload)
        return original({ ...payload, reasoningEffort: remembered })
      }
    }

    return { name, inject, apply }
  },
})
