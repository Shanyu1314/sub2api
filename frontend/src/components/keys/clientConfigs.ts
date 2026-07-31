import type { GroupPlatform } from '@/types'

export type ClientId = 'claude' | 'codex' | 'kimi' | 'pi' | 'opencode' | 'gemini'
export type ClientProtocol = 'responses' | 'chat'
export type ClientOS = 'unix' | 'windows'
export type ClaudeModelMode = 'single' | 'family'

export interface ClaudeModelMappings {
  opus?: string
  sonnet?: string
  haiku?: string
}

export interface ClientConfigFile {
  path: string
  content: string
  hintKey?: string
}

export interface ClientConfigOptions {
  client: ClientId
  platform: GroupPlatform
  baseUrl: string
  apiKey: string
  model: string
  protocol: ClientProtocol
  os: ClientOS
  claudeModelMode?: ClaudeModelMode
  claudeModels?: ClaudeModelMappings
}

export interface NormalizedClientUrls {
  root: string
  openai: string
  anthropicRoot: string
  anthropic: string
  geminiRoot: string
  gemini: string
}

const trimVersionSuffix = (value: string) =>
  value
    .replace(/\/(?:v1|v1beta)\/?$/i, '')
    .replace(/\/+$/, '')

const appendPath = (base: string, path: string) =>
  `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`

const tomlString = (value: string) => JSON.stringify(value)

export const normalizeClientUrls = (
  baseUrl: string,
  platform: GroupPlatform
): NormalizedClientUrls => {
  const root = trimVersionSuffix(baseUrl)
  const isAntigravity = platform === 'antigravity'
  const protocolRoot = isAntigravity ? appendPath(root, 'antigravity') : root

  return {
    root,
    openai: appendPath(root, 'v1'),
    anthropicRoot: protocolRoot,
    anthropic: appendPath(protocolRoot, 'v1'),
    geminiRoot: protocolRoot,
    gemini: appendPath(protocolRoot, 'v1beta')
  }
}

const configPath = (os: ClientOS, unixPath: string, windowsPath: string) =>
  os === 'windows' ? windowsPath : unixPath

const generateClaudeConfig = (
  options: ClientConfigOptions,
  urls: NormalizedClientUrls
): ClientConfigFile[] => {
  const environment: Record<string, string> = {
    ANTHROPIC_BASE_URL: urls.anthropicRoot,
    ANTHROPIC_AUTH_TOKEN: options.apiKey,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    CLAUDE_CODE_ATTRIBUTION_HEADER: '0'
  }

  const useFamilyMappings = options.claudeModelMode === 'family'
  if (useFamilyMappings) {
    const mappings: Array<[string, string | undefined]> = [
      ['ANTHROPIC_DEFAULT_OPUS_MODEL', options.claudeModels?.opus],
      ['ANTHROPIC_DEFAULT_SONNET_MODEL', options.claudeModels?.sonnet],
      ['ANTHROPIC_DEFAULT_HAIKU_MODEL', options.claudeModels?.haiku]
    ]
    for (const [key, model] of mappings) {
      const value = model?.trim()
      if (value) environment[key] = value
    }
  } else {
    environment.ANTHROPIC_MODEL = options.model
    environment.ANTHROPIC_DEFAULT_OPUS_MODEL = options.model
    environment.ANTHROPIC_DEFAULT_SONNET_MODEL = options.model
    environment.ANTHROPIC_DEFAULT_HAIKU_MODEL = options.model
  }

  const settings = {
    $schema: 'https://json.schemastore.org/claude-code-settings.json',
    env: environment,
    ...(!useFamilyMappings ? { model: options.model } : {})
  }

  return [
    {
      path: configPath(
        options.os,
        '~/.claude/settings.json',
        '%USERPROFILE%\\.claude\\settings.json'
      ),
      content: JSON.stringify(settings, null, 2),
      hintKey: 'keys.useKeyModal.quickSetup.mergeJson'
    }
  ]
}

const generateCodexConfig = (
  options: ClientConfigOptions,
  urls: NormalizedClientUrls
): ClientConfigFile[] => {
  const config = `model_provider = "boostapi"
model = ${tomlString(options.model)}

[model_providers.boostapi]
name = "BoostAPI"
base_url = ${tomlString(urls.openai)}
wire_api = "responses"
env_key = "BOOSTAPI_API_KEY"`

  const environment =
    options.os === 'windows'
      ? `$env:BOOSTAPI_API_KEY=${tomlString(options.apiKey)}`
      : `export BOOSTAPI_API_KEY=${tomlString(options.apiKey)}`

  return [
    {
      path: configPath(options.os, '~/.codex/config.toml', '%USERPROFILE%\\.codex\\config.toml'),
      content: config,
      hintKey: 'keys.useKeyModal.quickSetup.mergeToml'
    },
    {
      path: options.os === 'windows' ? 'PowerShell' : 'Terminal',
      content: environment,
      hintKey: 'keys.useKeyModal.quickSetup.codexEnv'
    }
  ]
}

const kimiProvider = (options: ClientConfigOptions, urls: NormalizedClientUrls) => {
  if (options.platform === 'anthropic' || options.platform === 'antigravity') {
    return { type: 'anthropic', baseUrl: urls.anthropicRoot }
  }
  if (options.platform === 'gemini') {
    return { type: 'google-genai', baseUrl: urls.geminiRoot }
  }
  return {
    type: options.protocol === 'responses' ? 'openai_responses' : 'openai',
    baseUrl: urls.openai
  }
}

const generateKimiConfig = (
  options: ClientConfigOptions,
  urls: NormalizedClientUrls
): ClientConfigFile[] => {
  const provider = kimiProvider(options, urls)
  const alias = `boostapi/${options.model}`
  const content = `default_model = ${tomlString(alias)}

[providers.boostapi]
type = ${tomlString(provider.type)}
base_url = ${tomlString(provider.baseUrl)}
api_key = ${tomlString(options.apiKey)}

[models.${tomlString(alias)}]
provider = "boostapi"
model = ${tomlString(options.model)}
max_context_size = 128000
capabilities = ["thinking", "tool_use"]`

  return [
    {
      path: configPath(
        options.os,
        '~/.kimi-code/config.toml',
        '%USERPROFILE%\\.kimi-code\\config.toml'
      ),
      content,
      hintKey: 'keys.useKeyModal.quickSetup.mergeToml'
    }
  ]
}

const piProvider = (options: ClientConfigOptions, urls: NormalizedClientUrls) => {
  if (options.platform === 'anthropic' || options.platform === 'antigravity') {
    return { api: 'anthropic-messages', baseUrl: urls.anthropic, authHeader: false }
  }
  if (options.platform === 'gemini') {
    return { api: 'google-generative-ai', baseUrl: urls.gemini, authHeader: false }
  }
  return {
    api: options.protocol === 'responses' ? 'openai-responses' : 'openai-completions',
    baseUrl: urls.openai,
    authHeader: true
  }
}

const generatePiConfig = (
  options: ClientConfigOptions,
  urls: NormalizedClientUrls
): ClientConfigFile[] => {
  const provider = piProvider(options, urls)
  const content = JSON.stringify(
    {
      providers: {
        boostapi: {
          baseUrl: provider.baseUrl,
          api: provider.api,
          apiKey: options.apiKey,
          ...(provider.authHeader ? { authHeader: true } : {}),
          models: [
            {
              id: options.model,
              name: options.model,
              reasoning: options.protocol === 'responses',
              input: ['text'],
              contextWindow: 128000,
              maxTokens: 32768
            }
          ]
        }
      }
    },
    null,
    2
  )

  return [
    {
      path: configPath(
        options.os,
        '~/.pi/agent/models.json',
        '%USERPROFILE%\\.pi\\agent\\models.json'
      ),
      content,
      hintKey: 'keys.useKeyModal.quickSetup.mergeJson'
    }
  ]
}

const openCodeProvider = (options: ClientConfigOptions, urls: NormalizedClientUrls) => {
  if (options.platform === 'anthropic' || options.platform === 'antigravity') {
    return { npm: '@ai-sdk/anthropic', baseUrl: urls.anthropic }
  }
  if (options.platform === 'gemini') {
    return { npm: '@ai-sdk/google', baseUrl: urls.gemini }
  }
  return {
    npm: options.protocol === 'responses' ? '@ai-sdk/openai' : '@ai-sdk/openai-compatible',
    baseUrl: urls.openai
  }
}

const generateOpenCodeConfig = (
  options: ClientConfigOptions,
  urls: NormalizedClientUrls
): ClientConfigFile[] => {
  const provider = openCodeProvider(options, urls)
  const content = JSON.stringify(
    {
      $schema: 'https://opencode.ai/config.json',
      model: `boostapi/${options.model}`,
      provider: {
        boostapi: {
          name: 'BoostAPI',
          npm: provider.npm,
          options: {
            baseURL: provider.baseUrl,
            apiKey: options.apiKey
          },
          models: {
            [options.model]: {
              name: options.model,
              limit: {
                context: 128000,
                output: 32768
              }
            }
          }
        }
      }
    },
    null,
    2
  )

  return [
    {
      path: configPath(
        options.os,
        '~/.config/opencode/opencode.json',
        '%USERPROFILE%\\.config\\opencode\\opencode.json'
      ),
      content,
      hintKey: 'keys.useKeyModal.quickSetup.mergeJson'
    }
  ]
}

const generateGeminiConfig = (
  options: ClientConfigOptions,
  urls: NormalizedClientUrls
): ClientConfigFile[] => {
  const content =
    options.os === 'windows'
      ? `$env:GOOGLE_GEMINI_BASE_URL=${tomlString(urls.geminiRoot)}
$env:GEMINI_API_KEY=${tomlString(options.apiKey)}
$env:GEMINI_MODEL=${tomlString(options.model)}`
      : `export GOOGLE_GEMINI_BASE_URL=${tomlString(urls.geminiRoot)}
export GEMINI_API_KEY=${tomlString(options.apiKey)}
export GEMINI_MODEL=${tomlString(options.model)}`

  return [
    {
      path: options.os === 'windows' ? 'PowerShell' : 'Terminal',
      content
    }
  ]
}

export const generateClientConfigFiles = (options: ClientConfigOptions): ClientConfigFile[] => {
  const normalizedOptions = {
    ...options,
    model: options.model.trim() || 'YOUR_MODEL_ID'
  }
  const urls = normalizeClientUrls(options.baseUrl, options.platform)

  switch (options.client) {
    case 'claude':
      return generateClaudeConfig(normalizedOptions, urls)
    case 'codex':
      return generateCodexConfig(normalizedOptions, urls)
    case 'kimi':
      return generateKimiConfig(normalizedOptions, urls)
    case 'pi':
      return generatePiConfig(normalizedOptions, urls)
    case 'opencode':
      return generateOpenCodeConfig(normalizedOptions, urls)
    case 'gemini':
      return generateGeminiConfig(normalizedOptions, urls)
  }
}
