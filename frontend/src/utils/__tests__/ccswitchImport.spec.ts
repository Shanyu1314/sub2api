import { describe, expect, it, vi } from 'vitest'
import {
  GROK_CC_SWITCH_MODEL,
  OPENAI_CC_SWITCH_CODEX_MODEL,
  buildCcSwitchImportDeeplink,
  fetchCcSwitchAvailableModels,
  resolveDefaultModel,
  resolveCcSwitchUsageUrl
} from '@/utils/ccswitchImport'
import type { GroupPlatform } from '@/types'

function paramsFromDeeplink(deeplink: string): URLSearchParams {
  const query = deeplink.split('?')[1] || ''
  return new URLSearchParams(query)
}

describe('ccswitchImport utils', () => {
  it('defaults OpenAI CC Switch imports to the current Codex model', () => {
    expect(OPENAI_CC_SWITCH_CODEX_MODEL).toBe('gpt-5.5')
  })

  it('defaults Grok Build imports to the current Grok model', () => {
    expect(GROK_CC_SWITCH_MODEL).toBe('grok-4.5')
  })

  it('resolves the default OpenAI model from the available models list', () => {
    expect(resolveDefaultModel('openai', ['k3', 'kimi-for-coding'])).toBe('k3')
    expect(
      resolveDefaultModel('openai', ['gpt-5.6-sol', 'gpt-5.5', 'gpt-5.6-terra'])
    ).toBe('gpt-5.5')
    expect(resolveDefaultModel('openai', [])).toBe(OPENAI_CC_SWITCH_CODEX_MODEL)
  })

  it('resolves the default Grok model from the available models list', () => {
    expect(resolveDefaultModel('grok', ['grok-4.5', 'grok-3'])).toBe(GROK_CC_SWITCH_MODEL)
    expect(resolveDefaultModel('grok', ['grok-3'])).toBe('grok-3')
    expect(resolveDefaultModel('grok', [])).toBe(GROK_CC_SWITCH_MODEL)
  })

  it('does not return a default model for non-model platforms', () => {
    expect(resolveDefaultModel('anthropic', ['claude-test'])).toBeUndefined()
    expect(resolveDefaultModel('gemini', [])).toBeUndefined()
  })

  it('fetches the available models list from the gateway', async () => {
    const data = { data: [{ id: 'k3' }, { id: 'kimi-for-coding' }] }
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(data)
    } as Response)

    const models = await fetchCcSwitchAvailableModels('https://api.example.com/v1/', 'sk-test')

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.example.com/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer sk-test' })
      })
    )
    expect(models).toEqual(['k3', 'kimi-for-coding'])
  })

  it('returns an empty model list when the gateway request fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false } as Response)
    const models = await fetchCcSwitchAvailableModels('https://api.example.com', 'sk-test')
    expect(models).toEqual([])
  })

  const baseInput = {
    baseUrl: 'https://api.example.com',
    providerName: 'Sub2API',
    apiKey: 'sk-test',
    usageScript: 'return true',
    availableModels: []
  }

  it.each([
    'https://api.example.com',
    'https://api.example.com/',
    'https://api.example.com/v1',
    'https://api.example.com/v1/'
  ])('imports Codex with exactly one /v1 suffix for base URL %s', (baseUrl) => {
    const params = paramsFromDeeplink(
      buildCcSwitchImportDeeplink({
        ...baseInput,
        baseUrl,
        platform: 'openai',
        clientType: 'claude'
      })
    )

    expect(params.get('resource')).toBe('provider')
    expect(params.get('app')).toBe('codex')
    expect(params.get('endpoint')).toBe('https://api.example.com/v1')
    expect(params.get('model')).toBe(OPENAI_CC_SWITCH_CODEX_MODEL)
    expect(atob(params.get('usageScript') || '')).toBe(baseInput.usageScript)
  })

  it('uses the first available model for OpenAI imports when the default is not available', () => {
    const params = paramsFromDeeplink(
      buildCcSwitchImportDeeplink({
        ...baseInput,
        baseUrl: 'https://api.example.com',
        platform: 'openai',
        clientType: 'claude',
        availableModels: ['k3', 'kimi-for-coding']
      })
    )

    expect(params.get('app')).toBe('codex')
    expect(params.get('endpoint')).toBe('https://api.example.com/v1')
    expect(params.get('model')).toBe('k3')
  })

  it.each([
    'https://api.example.com',
    'https://api.example.com/',
    'https://api.example.com/v1',
    'https://api.example.com/v1/'
  ])('imports Grok Build with one /v1 suffix for base URL %s', (baseUrl) => {
    const params = paramsFromDeeplink(
      buildCcSwitchImportDeeplink({
        ...baseInput,
        baseUrl,
        platform: 'grok',
        clientType: 'claude'
      })
    )

    expect(params.get('app')).toBe('grokbuild')
    expect(params.get('endpoint')).toBe('https://api.example.com/v1')
    expect(params.get('model')).toBe(GROK_CC_SWITCH_MODEL)
  })

  it.each([
    { platform: 'anthropic' as GroupPlatform, clientType: 'claude' as const, app: 'claude' },
    { platform: 'gemini' as GroupPlatform, clientType: 'gemini' as const, app: 'gemini' }
  ])(
    'strips the /v1 suffix and adds no model parameter for $platform imports',
    ({ platform, clientType, app }) => {
      const params = paramsFromDeeplink(
        buildCcSwitchImportDeeplink({
          ...baseInput,
          baseUrl: 'https://api.example.com/v1',
          platform,
          clientType
        })
      )

      expect(params.get('app')).toBe(app)
      expect(params.get('endpoint')).toBe('https://api.example.com')
      expect(params.has('model')).toBe(false)
    }
  )

  it.each(['https://api.example.com', 'https://api.example.com/v1'])(
    'keeps the bare origin for Claude imports with base URL %s',
    (baseUrl) => {
      const params = paramsFromDeeplink(
        buildCcSwitchImportDeeplink({
          ...baseInput,
          baseUrl,
          platform: 'anthropic',
          clientType: 'claude'
        })
      )

      expect(params.get('endpoint')).toBe('https://api.example.com')
    }
  )

  it.each(['https://api.example.com', 'https://api.example.com/v1'])(
    'builds the Antigravity endpoint from the bare origin for base URL %s',
    (baseUrl) => {
      const params = paramsFromDeeplink(
        buildCcSwitchImportDeeplink({
          ...baseInput,
          baseUrl,
          platform: 'antigravity',
          clientType: 'gemini'
        })
      )

      expect(params.get('app')).toBe('gemini')
      expect(params.get('endpoint')).toBe('https://api.example.com/antigravity')
      expect(params.has('model')).toBe(false)
    }
  )

  it.each([
    { baseUrl: 'https://api.example.com', expected: 'https://api.example.com/v1/usage' },
    { baseUrl: 'https://api.example.com/', expected: 'https://api.example.com/v1/usage' },
    { baseUrl: 'https://api.example.com/v1', expected: 'https://api.example.com/v1/usage' },
    { baseUrl: 'https://api.example.com/v1/', expected: 'https://api.example.com/v1/usage' }
  ])('resolves the usage URL for base URL $baseUrl', ({ baseUrl, expected }) => {
    expect(resolveCcSwitchUsageUrl(baseUrl)).toBe(expected)
  })
})
