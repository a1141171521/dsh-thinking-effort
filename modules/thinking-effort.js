/**
 * dsh-thinking-effort — 推理档位模块
 *
 * Declares reasoning effort levels for OpenAI-compatible third-party models
 * configured under `llm-pi-ai`, so the built-in model selector shows its
 * Effort row for those models — the same shape built-in deepseek models
 * have — and pins a route-level default effort so re-selecting a model keeps
 * your chosen level instead of falling back to the provider default.
 *
 * Background: DSH's llm service only accepts a reasoning effort for a model
 * whose adapter reports it. The pi-ai adapter reports efforts only when the
 * model profile declares `reasoningEfforts`. Third-party (custom) models
 * usually omit that declaration, so the selector hides the Effort row and any
 * explicit effort is rejected with `UNSUPPORTED_REASONING_EFFORT`. This module
 * fills the gap: on activation (and whenever the `llm-pi-ai` settings section
 * changes) it patches each OpenAI-compatible model's efforts (adding missing
 * levels without touching existing ones), and pins the route-level `reasoning`
 * default to {@link DEFAULT_EFFORT} (config `defaultEffort`, default `high`),
 * writing through the settings service. Once declared, the effort is sent on
 * the wire as `reasoning_effort`.
 *
 * The route-level `reasoning` value is what the adapter reports as each
 * model's `defaultEffort`; the built-in model selector sends that value when
 * a model row is picked, so switching away and back keeps your choice rather
 * than clearing it.
 *
 * Timing: the `llm-pi-ai` settings namespace is registered by the pi-ai
 * adapter plugin, which may activate after this plugin. `settings.get` on an
 * unregistered namespace returns undefined, so activation polls briefly for
 * the namespace before declaring; the `settings/updated` listener then keeps
 * declarations in sync with later configuration changes.
 */

/** Effort set declared for models that declare none. The wire spelling equals
 * the level id (DeepSeek-protocol gateways accept these). `off: null` means
 * "supported, send nothing". Levels the deployment endpoint rejects (e.g.
 * `minimal`) are left out; see README.
 */
const EFFORTS = { off: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' }

/** Route-level default effort pinned when the provider declares none of its own. */
const DEFAULT_EFFORT = 'high'

/** How long to keep polling for the `llm-pi-ai` namespace at activation. */
const NAMESPACE_POLL_MS = 250
const NAMESPACE_POLL_ATTEMPTS = 24

export const inject = ['settings']

export function apply(ctx, config) {
  const defaultEffort = config?.defaultEffort ?? DEFAULT_EFFORT

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
        const providerPatch = {}
        // Pin the route-level default effort so re-selecting a model keeps
        // the level. Only when the deployment left it unset.
        if (profile.reasoning === undefined && defaultEffort !== undefined) {
          providerPatch.reasoning = defaultEffort
        }
        const models = Array.isArray(profile.models) ? profile.models : undefined
        if (models !== undefined) {
          const next = models.map((entry) => {
            if (entry === undefined || entry === null || typeof entry !== 'object') return entry
            const existing = entry.reasoningEfforts
            // Explicitly disabled reasoning: leave the model alone.
            if (existing === false) return entry
            if (existing === undefined || existing === null) {
              return Object.assign({}, entry, { reasoningEfforts: EFFORTS })
            }
            // Already declared: add missing levels only, preserving the
            // deployment's own values (including `null` pins).
            let missing = false
            const merged = Object.assign({}, existing)
            for (const level of Object.keys(EFFORTS)) {
              if (!(level in merged)) {
                merged[level] = EFFORTS[level]
                missing = true
              }
            }
            if (!missing) return entry
            return Object.assign({}, entry, { reasoningEfforts: merged })
          })
          const changed = next.some((entry, index) => entry !== models[index])
          if (changed) providerPatch.models = next
        }
        if (Object.keys(providerPatch).length === 0) continue
        patch[provider] = providerPatch
        touched = true
      }
      if (!touched) return
      await ctx.settings.update('llm-pi-ai', { providers: patch })
    } catch (error) {
      console.error('[dsh-thinking-effort] failed to declare reasoning efforts', error instanceof Error ? error.message : String(error))
    }
  }

  // The pi-ai adapter registers the `llm-pi-ai` namespace during activation;
  // poll briefly for it before the first declaration attempt.
  let attempts = NAMESPACE_POLL_ATTEMPTS
  let timer = null
  const poll = () => {
    const section = ctx.settings.get('llm-pi-ai')
    if (section !== undefined && section !== null && typeof section === 'object') {
      void declare()
      return
    }
    attempts -= 1
    if (attempts <= 0) {
      console.warn('[dsh-thinking-effort] llm-pi-ai settings namespace never appeared; declarations deferred to settings/updated')
      return
    }
    timer = setTimeout(poll, NAMESPACE_POLL_MS)
  }
  poll()

  // Re-declare whenever the section changes (a model added later, or the user
  // hand-editing settings.yaml). Idempotent: models that already declare all
  // levels and providers that already pin a default are left untouched.
  ctx.on('settings/updated', (ns) => {
    if (String(ns) !== 'llm-pi-ai') return
    void declare()
  })

  // Stop the poll timer on teardown.
  ctx.effect(() => () => {
    if (timer !== null) clearTimeout(timer)
  })
}
