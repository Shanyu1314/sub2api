import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import OpenAIImagesChatAdapterFields from '../OpenAIImagesChatAdapterFields.vue'

vi.mock('vue-i18n', async () => {
  const actual = await vi.importActual<typeof import('vue-i18n')>('vue-i18n')
  return {
    ...actual,
    useI18n: () => ({
      t: (key: string) => key
    })
  }
})

describe('OpenAIImagesChatAdapterFields', () => {
  it('is disabled by default and emits an explicit opt-in', async () => {
    const wrapper = mount(OpenAIImagesChatAdapterFields, {
      props: {
        enabled: false,
        chatPath: '/v1/chat/completions'
      }
    })

    expect(wrapper.find('[data-testid="openai-images-chat-path"]').exists()).toBe(false)
    await wrapper.get('[data-testid="openai-images-via-chat-toggle"]').trigger('click')
    expect(wrapper.emitted('update:enabled')).toEqual([[true]])
  })

  it('shows and updates the custom upstream path only when enabled', async () => {
    const wrapper = mount(OpenAIImagesChatAdapterFields, {
      props: {
        enabled: true,
        chatPath: '/v1/chat/completions'
      }
    })

    const input = wrapper.get('[data-testid="openai-images-chat-path"]')
    await input.setValue('/api/image/chat')
    expect(wrapper.emitted('update:chatPath')).toEqual([['/api/image/chat']])
  })
})
