import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import AppSidebar from '../AppSidebar.vue'

const h = vi.hoisted(() => {
  const state = {
    isSimpleMode: false,
    isAdmin: false,
    cachedPublicSettings: {} as Record<string, unknown> | null,
  }
  const makeAppStore = () => ({
    sidebarCollapsed: false,
    mobileOpen: false,
    siteName: 'Test Site',
    siteLogo: '',
    siteVersion: '1.0.0',
    publicSettingsLoaded: true,
    cachedPublicSettings: state.cachedPublicSettings,
    backendModeEnabled: false,
    sidebarScrollTop: 0,
    toggleSidebar: () => {},
    setMobileOpen: () => {},
  })
  return { state, makeAppStore }
})

vi.mock('vue-router', () => ({
  useRoute: () => ({ path: '/dashboard' }),
  useRouter: () => ({ push: () => {} }),
}))

// featureFlags.ts reads the app store from '@/stores/app' directly; the sidebar
// reads it from the '@/stores' barrel. Both must resolve to the same fake.
vi.mock('@/stores/app', () => ({ useAppStore: h.makeAppStore }))

vi.mock('@/stores', () => ({
  useAppStore: h.makeAppStore,
  useAuthStore: () => ({
    isAdmin: h.state.isAdmin,
    isSimpleMode: h.state.isSimpleMode,
  }),
  useOnboardingStore: () => ({ isCurrentStep: () => false, nextStep: () => {} }),
  useAdminSettingsStore: () => ({
    opsMonitoringEnabled: false,
    paymentEnabled: false,
    customMenuItems: [],
    fetch: () => {},
  }),
}))

vi.mock('@/composables/useBatchImageAccess', () => ({
  useBatchImageAccess: () => ({ canUseBatchImage: ref(false), refreshBatchImageAccess: () => {} }),
}))

vi.mock('vue-i18n', async () => {
  const actual = await vi.importActual<typeof import('vue-i18n')>('vue-i18n')
  return { ...actual, useI18n: () => ({ t: (key: string) => key }) }
})

const globalStubs = {
  stubs: {
    VersionBadge: true,
    Icon: true,
    'router-link': { template: '<a :href="to"><slot /></a>', props: ['to'] },
  },
}

async function mountSidebar() {
  const wrapper = mount(AppSidebar, { global: globalStubs })
  await flushPromises()
  return wrapper
}

const redeemLink = (wrapper: ReturnType<typeof mount>) =>
  wrapper.findAll('a').find((a) => a.attributes('href') === '/redeem')

const hasLink = (wrapper: ReturnType<typeof mount>, href: string) =>
  wrapper.findAll('a').some((a) => a.attributes('href') === href)

describe('AppSidebar card recharge entry', () => {
  beforeEach(() => {
    h.state.isSimpleMode = false
    h.state.isAdmin = false
    h.state.cachedPublicSettings = {}
  })

  it('shows the card recharge entry for a normal user', async () => {
    const wrapper = await mountSidebar()
    expect(redeemLink(wrapper)).toBeTruthy()
    expect(redeemLink(wrapper)!.text()).toBe('nav.cardRecharge')
    wrapper.unmount()
  })

  it('keeps the card recharge entry when payment is disabled', async () => {
    h.state.cachedPublicSettings = { payment_enabled: false }
    const wrapper = await mountSidebar()

    expect(redeemLink(wrapper)).toBeTruthy()
    // 在线充值与订单入口仍然受支付开关控制
    expect(hasLink(wrapper, '/purchase')).toBe(false)
    expect(hasLink(wrapper, '/orders')).toBe(false)
    wrapper.unmount()
  })

  it('keeps the card recharge entry when balance recharge and subscription are both closed', async () => {
    h.state.cachedPublicSettings = {
      payment_enabled: false,
      payment_balance_disabled: true,
      subscription_enabled: false,
    }
    const wrapper = await mountSidebar()

    expect(redeemLink(wrapper)).toBeTruthy()
    expect(hasLink(wrapper, '/subscriptions')).toBe(false)
    wrapper.unmount()
  })

  it('keeps the card recharge entry visible in simple mode', async () => {
    h.state.isSimpleMode = true
    h.state.cachedPublicSettings = { payment_enabled: false }
    const wrapper = await mountSidebar()

    expect(redeemLink(wrapper)).toBeTruthy()
    wrapper.unmount()
  })

  it('does not expose the admin redeem management entry to a normal user', async () => {
    const wrapper = await mountSidebar()
    expect(hasLink(wrapper, '/admin/redeem')).toBe(false)
    wrapper.unmount()
  })
})
