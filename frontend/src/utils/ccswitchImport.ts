import type { GroupPlatform } from '@/types'

export const OPENAI_CC_SWITCH_CODEX_MODEL = 'gpt-5.5'
export const GROK_CC_SWITCH_MODEL = 'grok-4.5'

// Group-specific default model overrides for openai-compatible groups.
// Keys are matched against the group name (case-insensitive); the override is
// only used when the model is present in the key's available model list.
const OPENAI_CC_SWITCH_GROUP_DEFAULT_MODELS: Record<string, string> = {
  k12: 'gpt-5.6-sol',
  'k12-gpt': 'gpt-5.6-sol'
}

export type CcSwitchClientType = 'claude' | 'gemini'

export interface CcSwitchImportConfig {
  app: string
  endpoint: string
  model?: string
}

export interface CcSwitchImportDeeplinkInput {
  baseUrl: string
  platform?: GroupPlatform | null
  clientType: CcSwitchClientType
  providerName: string
  apiKey: string
  usageScript: string
  availableModels?: string[]
  groupName?: string
}

/**
 * Balance query CC Switch runs against the imported provider. CC Switch fills
 * `{{baseUrl}}` with the provider's base URL as stored — Codex and Grok imports
 * carry a trailing `/v1` (see `withV1Endpoint`), Claude ones do not, and users
 * may edit it either way afterwards — then evaluates the script, so the URL
 * strips an existing `/v1` instead of blindly appending one (`/v1/v1/usage`
 * is a 404 and CC Switch shows "query failed").
 */
export const CC_SWITCH_USAGE_SCRIPT = `({
    request: {
      url: "{{baseUrl}}".replace(/\\/+$/, "").replace(/\\/v1$/, "") + "/v1/usage",
      method: "GET",
      headers: { "Authorization": "Bearer {{apiKey}}" }
    },
    extractor: function(response) {
      const remaining = response?.remaining ?? response?.quota?.remaining ?? response?.balance;
      const unit = response?.unit ?? response?.quota?.unit ?? "USD";
      return {
        isValid: response?.is_active ?? response?.isValid ?? true,
        remaining,
        unit
      };
    }
  })`

function withV1Endpoint(baseUrl: string): string {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '')
  return normalizedBaseUrl.endsWith('/v1') ? normalizedBaseUrl : `${normalizedBaseUrl}/v1`
}

function withoutTrailingSlashes(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

// Query the model list this API key can actually use, so the CC Switch default
// model matches what the key's group can serve instead of a global default.
export async function fetchCcSwitchAvailableModels(
  baseUrl: string,
  apiKey: string
): Promise<string[]> {
  try {
    const root = withoutTrailingSlashes(baseUrl).replace(/\/v1$/, '')
    const resp = await fetch(`${root}/v1/models`, {
      headers: { Authorization: `Bearer ${apiKey}` }
    })
    if (!resp.ok) return []
    const body = (await resp.json()) as { data?: Array<{ id: string }> }
    return (body.data || []).map((m) => m.id)
  } catch {
    return []
  }
}

export function resolveDefaultModel(
  platform: GroupPlatform | undefined | null,
  availableModels?: string[],
  groupName?: string
): string | undefined {
  const fallback: Record<string, string> = {
    openai: OPENAI_CC_SWITCH_CODEX_MODEL,
    grok: GROK_CC_SWITCH_MODEL
  }
  const model = fallback[platform || '']
  if (!model) return undefined
  if (!availableModels?.length) return model
  if (platform === 'openai' && groupName) {
    const override = OPENAI_CC_SWITCH_GROUP_DEFAULT_MODELS[groupName.trim().toLowerCase()]
    if (override && availableModels.includes(override)) return override
  }
  return availableModels.includes(model) ? model : availableModels[0]
}

export function resolveCcSwitchImportConfig(
  platform: GroupPlatform | undefined | null,
  clientType: CcSwitchClientType,
  baseUrl: string,
  availableModels?: string[],
  groupName?: string
): CcSwitchImportConfig {
  switch (platform || 'anthropic') {
    case 'antigravity':
      return {
        app: clientType === 'gemini' ? 'gemini' : 'claude',
        endpoint: `${baseUrl.replace(/\/+$/, '')}/antigravity`
      }
    case 'openai':
      return {
        app: 'codex',
        // CC Switch's Codex provider appends the OpenAI-compatible path itself.
        // Passing /v1 here can make the client request /v1/v1/....
        endpoint: withoutTrailingSlashes(baseUrl),
        model: resolveDefaultModel(platform, availableModels, groupName)
      }
    case 'gemini':
      return {
        app: 'gemini',
        endpoint: baseUrl
      }
    case 'grok':
      return {
        app: 'grokbuild',
        endpoint: withV1Endpoint(baseUrl),
        model: resolveDefaultModel(platform, availableModels, groupName)
      }
    default:
      return {
        app: 'claude',
        endpoint: baseUrl
      }
  }
}

export function buildCcSwitchImportDeeplink(input: CcSwitchImportDeeplinkInput): string {
  const config = resolveCcSwitchImportConfig(
    input.platform,
    input.clientType,
    input.baseUrl,
    input.availableModels,
    input.groupName
  )
  const entries: [string, string][] = [
    ['resource', 'provider'],
    ['app', config.app],
    ['name', input.providerName],
    ['homepage', input.baseUrl],
    ['endpoint', config.endpoint],
    ['apiKey', input.apiKey],
    ['configFormat', 'json'],
    ['usageEnabled', 'true'],
    ['usageScript', btoa(input.usageScript)],
    ['usageAutoInterval', '30']
  ]

  if (config.model) {
    entries.splice(2, 0, ['model', config.model])
  }

  return `ccswitch://v1/import?${new URLSearchParams(entries).toString()}`
}
