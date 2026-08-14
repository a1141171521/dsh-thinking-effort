/**
 * dsh-thinking-effort
 *
 * Declares Codex-style reasoning effort levels (Off / Low / Medium / High) for
 * OpenAI-compatible third-party models configured under `llm-pi-ai`, so the
 * built-in model selector shows its Effort row for those models — the same
 * shape built-in deepseek models have.
 *
 * Background: DSH's llm service only accepts a reasoning effort for a model
 * whose adapter reports it. The pi-ai adapter reports efforts only when the
 * model profile declares `reasoningEfforts`. Third-party (custom) models
 * usually omit that declaration, so the selector hides the Effort row and any
 * explicit effort is rejected with `UNSUPPORTED_REASONING_EFFORT`. This plugin
 * fills the gap: on activation (and whenever the `llm-pi-ai` settings section
 * changes) it patches each OpenAI-compatible model that declares no efforts
 * with the Codex-style set, writing through the settings service. Once
 * declared, the effort is sent on the wire as `reasoning_effort`.
 */

export const name = 'dsh-thinking-effort'

export const inject = ['settings']

/** Codex-style effort set; `off: null` means "supported, send nothing". */
const EFFORTS = { off: null, low: 'low', medium: 'medium', high: 'high' }

export function apply(ctx) {
  const declare = async () => {
    try {
      const section = ctx.settings.get('llm-pi-ai')
      if (section === undefined || section === null || typeof section !== 'object') return
      const providers = section.providers
      if (providers === undefined || providers === null || typeof providers !== 'object') return
      const patch = {}
      let touched = false
      for (const provider of Object.keys(providers)) {
        const profile = providers[provider]
        if (profile === undefined || profile === null || typeof profile !== 'object') continue
        if (profile.api !== 'openai-completions') continue
        const models = Array.isArray(profile.models) ? profile.models : undefined
        if (models === undefined) continue
        const next = models.map((entry) => {
          if (entry === undefined || entry === null || typeof entry !== 'object') return entry
          if (entry.reasoningEfforts !== undefined) return entry
          return Object.assign({}, entry, { reasoningEfforts: EFFORTS })
        })
        const changed = next.some((entry, index) => entry !== models[index])
        if (!changed) continue
        patch[provider] = { models: next }
        touched = true
      }
      if (!touched) return
      await ctx.settings.update('llm-pi-ai', { providers: patch })
    } catch (error) {
      console.error('[dsh-thinking-effort] failed to declare reasoning efforts', error instanceof Error ? error.message : String(error))
    }
  }

  // Declare on activation, and again whenever the section changes (a model
  // added later, or the user hand-editing settings.yaml). Idempotent: models
  // that already declare efforts are left untouched.
  void declare()
  ctx.on('settings/updated', (ns) => {
    if (String(ns) !== 'llm-pi-ai') return
    void declare()
  })
}
