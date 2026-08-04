import type { GroupPlatform } from '@/types'

export const OPENAI_CC_SWITCH_CODEX_MODEL = 'gpt-5.5'
export const GROK_CC_SWITCH_MODEL = 'grok-4.5'

// Group-specific default model overrides for openai-compatible groups.
// The key is matched against the group name (case-insensitive); the value is
// used only when it appears in the key's available model list.
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

function withV1Endpoint(baseUrl: string): string {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '')
  return normalizedBaseUrl.endsWith('/v1') ? normalizedBaseUrl : `${normalizedBaseUrl}/v1`
}

function withoutV1Endpoint(baseUrl: string): string {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '')
  return normalizedBaseUrl.endsWith('/v1') ? normalizedBaseUrl.slice(0, -'/v1'.length) : normalizedBaseUrl
}

// Query the real upstream model list for this API key so the CCS default model
// matches what the key's group can actually serve, instead of always defaulting
// to gpt-5.5 for every openai-compatible group.
export async function fetchCcSwitchAvailableModels(
  baseUrl: string,
  apiKey: string
): Promise<string[]> {
  try {
    const url = `${withoutV1Endpoint(baseUrl)}/v1/models`
    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    })
    if (!resp.ok) {
      return []
    }
    const body = (await resp.json()) as { data?: Array<{ id: string }> }
    return (body.data || []).map((m) => m.id)
  } catch {
    return []
  }
}

export function resolveDefaultModel(
  platform: GroupPlatform | undefined | null,
  availableModels: string[] | undefined,
  groupName?: string
): string | undefined {
  const fallback: Record<string, string> = {
    openai: OPENAI_CC_SWITCH_CODEX_MODEL,
    grok: GROK_CC_SWITCH_MODEL
  }
  const model = fallback[platform || '']
  if (!model) return undefined
  if (!availableModels?.length) return model
  if (groupName) {
    const normalized = groupName.trim().toLowerCase()
    const override = OPENAI_CC_SWITCH_GROUP_DEFAULT_MODELS[normalized]
    if (override && availableModels.includes(override)) return override
  }
  return availableModels.includes(model) ? model : availableModels[0]
}

// Claude Code and Gemini CLI append their own versioned path (/v1/messages,
// /v1beta/...), so their base URL must NOT carry a /v1 suffix. Codex and
// Grok Build treat the configured URL as the API root and require /v1.
// Normalize per app so imports work regardless of whether the configured
// api_base_url ends with /v1.
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
        endpoint: `${withoutV1Endpoint(baseUrl)}/antigravity`
      }
    case 'openai':
      return {
        app: 'codex',
        endpoint: withV1Endpoint(baseUrl),
        model: resolveDefaultModel(platform, availableModels, groupName)
      }
    case 'gemini':
      return {
        app: 'gemini',
        endpoint: withoutV1Endpoint(baseUrl)
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
        endpoint: withoutV1Endpoint(baseUrl)
      }
  }
}

// Usage queries always hit the gateway usage endpoint on the bare origin.
// Hardcode the normalized URL instead of relying on the client's {{baseUrl}}
// substitution, which would double the /v1 prefix for Codex-style endpoints.
export function resolveCcSwitchUsageUrl(baseUrl: string): string {
  return `${withoutV1Endpoint(baseUrl)}/v1/usage`
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
