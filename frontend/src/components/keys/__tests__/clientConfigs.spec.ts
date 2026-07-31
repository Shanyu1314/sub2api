import { describe, expect, it } from 'vitest'
import { generateClientConfigFiles, normalizeClientUrls } from '../clientConfigs'

const baseOptions = {
  platform: 'openai' as const,
  baseUrl: 'https://boost.example/v1',
  apiKey: 'sk-test',
  model: 'model-live',
  protocol: 'responses' as const,
  os: 'windows' as const
}

describe('clientConfigs', () => {
  it('normalizes versioned base URLs without duplicating /v1', () => {
    expect(normalizeClientUrls('https://boost.example/v1/', 'openai')).toEqual({
      root: 'https://boost.example',
      openai: 'https://boost.example/v1',
      anthropicRoot: 'https://boost.example',
      anthropic: 'https://boost.example/v1',
      geminiRoot: 'https://boost.example',
      gemini: 'https://boost.example/v1beta'
    })
  })

  it('lets Claude Code append /v1/messages to the root URL', () => {
    const [file] = generateClientConfigFiles({ ...baseOptions, client: 'claude' })
    const config = JSON.parse(file.content)

    expect(file.path).toBe('%USERPROFILE%\\.claude\\settings.json')
    expect(config.env.ANTHROPIC_BASE_URL).toBe('https://boost.example')
    expect(config.env.ANTHROPIC_MODEL).toBe('model-live')
  })

  it('maps Claude model tiers independently without forcing a global model', () => {
    const [file] = generateClientConfigFiles({
      ...baseOptions,
      client: 'claude',
      claudeModelMode: 'family',
      claudeModels: {
        opus: 'gpt-opus',
        sonnet: 'gpt-sonnet',
        haiku: 'gpt-haiku'
      }
    })
    const config = JSON.parse(file.content)

    expect(config.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('gpt-opus')
    expect(config.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('gpt-sonnet')
    expect(config.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('gpt-haiku')
    expect(config.env).not.toHaveProperty('ANTHROPIC_MODEL')
    expect(config).not.toHaveProperty('model')
  })

  it('omits empty Claude tier mappings so server-side defaults can handle them', () => {
    const [file] = generateClientConfigFiles({
      ...baseOptions,
      client: 'claude',
      claudeModelMode: 'family',
      claudeModels: { opus: 'gpt-opus', sonnet: ' ', haiku: '' }
    })
    const config = JSON.parse(file.content)

    expect(config.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('gpt-opus')
    expect(config.env).not.toHaveProperty('ANTHROPIC_DEFAULT_SONNET_MODEL')
    expect(config.env).not.toHaveProperty('ANTHROPIC_DEFAULT_HAIKU_MODEL')
  })

  it('generates Kimi Code providers for both OpenAI protocols', () => {
    const responses = generateClientConfigFiles({ ...baseOptions, client: 'kimi' })[0].content
    const chat = generateClientConfigFiles({
      ...baseOptions,
      client: 'kimi',
      protocol: 'chat'
    })[0].content

    expect(responses).toContain('type = "openai_responses"')
    expect(chat).toContain('type = "openai"')
    expect(responses).toContain('[models."boostapi/model-live"]')
  })

  it('generates Pi native models.json with the selected protocol', () => {
    const file = generateClientConfigFiles({
      ...baseOptions,
      client: 'pi',
      protocol: 'chat'
    })[0]
    const config = JSON.parse(file.content)

    expect(file.path).toBe('%USERPROFILE%\\.pi\\agent\\models.json')
    expect(config.providers.boostapi.api).toBe('openai-completions')
    expect(config.providers.boostapi.models[0].id).toBe('model-live')
  })

  it('selects the correct OpenCode package for Responses and Chat Completions', () => {
    const responses = JSON.parse(
      generateClientConfigFiles({ ...baseOptions, client: 'opencode' })[0].content
    )
    const chat = JSON.parse(
      generateClientConfigFiles({
        ...baseOptions,
        client: 'opencode',
        protocol: 'chat'
      })[0].content
    )

    expect(responses.provider.boostapi.npm).toBe('@ai-sdk/openai')
    expect(chat.provider.boostapi.npm).toBe('@ai-sdk/openai-compatible')
    expect(responses.model).toBe('boostapi/model-live')
  })

  it('uses native Anthropic and Gemini adapters for non-OpenAI groups', () => {
    const kimiAnthropic = generateClientConfigFiles({
      ...baseOptions,
      client: 'kimi',
      platform: 'anthropic'
    })[0].content
    const piGemini = JSON.parse(
      generateClientConfigFiles({
        ...baseOptions,
        client: 'pi',
        platform: 'gemini'
      })[0].content
    )

    expect(kimiAnthropic).toContain('type = "anthropic"')
    expect(kimiAnthropic).toContain('base_url = "https://boost.example"')
    expect(piGemini.providers.boostapi.api).toBe('google-generative-ai')
    expect(piGemini.providers.boostapi.baseUrl).toBe('https://boost.example/v1beta')
  })
})
