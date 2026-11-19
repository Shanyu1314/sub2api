import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import AuthLayout from '../AuthLayout.vue'

const store = vi.hoisted(() => ({
  siteName: 'BoostAPI', siteLogo: '/logo.svg', publicSettingsLoaded: true,
  cachedPublicSettings: { site_subtitle: '' }, fetchPublicSettings: vi.fn(),
}))
vi.mock('@/stores', () => ({ useAppStore: () => store }))

describe('authentication branding', () => {
  it('keeps the standard layout unless the login theme is requested', () => {
    const view = mount(AuthLayout)
    expect(view.find('.starfield-login').exists()).toBe(false)
    expect(view.text()).toContain('Subscription to API Conversion Platform')
  })

  it.each([
    ['Subscription to API Conversion Platform', 'Astra, ad astra. Per aspera ad astra.', true],
    ['Astra, ad astra.\nPer aspera ad astra.', 'Astra, ad astra. Per aspera ad astra.', true],
    ['Custom subtitle', 'Custom subtitle', false],
  ] as const)('honors the configured subtitle %s', (subtitle, expected, translated) => {
    store.cachedPublicSettings.site_subtitle = subtitle
    const view = mount(AuthLayout, { props: { starfield: true }, slots: { default: '<form />', footer: 'Register' } })
    expect(view.get('.night-motto').text()).toBe(expected)
    expect(view.find('.night-translation').exists()).toBe(translated)
    expect(view.get('.night-wordmark img').attributes('src')).toBe('/logo.svg')
    expect(view.find('form').exists()).toBe(true)
    expect(view.get('.night-footer').text()).toBe('Register')
  })
})
