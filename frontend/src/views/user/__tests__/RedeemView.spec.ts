import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import RedeemView from '../RedeemView.vue'

const { redeem, getHistory, refreshUser, fetchActiveSubscriptions, showError, showWarning, showSuccess, fetchPublicSettings } =
  vi.hoisted(() => ({
    redeem: vi.fn(),
    getHistory: vi.fn(),
    refreshUser: vi.fn(),
    fetchActiveSubscriptions: vi.fn(),
    showError: vi.fn(),
    showWarning: vi.fn(),
    showSuccess: vi.fn(),
    fetchPublicSettings: vi.fn(),
  }))

// 只映射本页断言用到的错误码，未知 key 原样返回（与真实 i18n 缺失时的兜底一致）。
const tMessages = vi.hoisted(
  (): Record<string, string> => ({
    'redeem.errors.REDEEM_CODE_NOT_FOUND': '卡密无效或不存在',
    'redeem.errors.REDEEM_CODE_USED': '该卡密已被使用',
    'redeem.errors.REDEEM_CODE_EXPIRED': '该卡密已过期',
    'redeem.errors.REDEEM_RATE_LIMITED': '尝试次数过多，请稍后再试',
  })
)

vi.mock('@/api', () => ({
  redeemAPI: { redeem, getHistory },
}))
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({ user: { balance: 10, concurrency: 2 }, refreshUser }),
}))
vi.mock('@/stores/subscriptions', () => ({
  useSubscriptionStore: () => ({ fetchActiveSubscriptions }),
}))
vi.mock('@/stores/app', () => ({
  useAppStore: () => ({
    showError,
    showWarning,
    showSuccess,
    // 真实 store 契约：失败返回 null，不抛异常。
    fetchPublicSettings,
    cachedPublicSettings: null,
  }),
}))
vi.mock('vue-i18n', async () => {
  const actual = await vi.importActual<typeof import('vue-i18n')>('vue-i18n')
  return {
    ...actual,
    useI18n: () => ({ t: (key: string) => tMessages[key] ?? key }),
  }
})

const globalStubs = {
  stubs: { AppLayout: { template: '<div><slot /></div>' }, Icon: true },
}

async function mountView() {
  const wrapper = mount(RedeemView, { global: globalStubs })
  await flushPromises()
  return wrapper
}

async function submitCode(code = ' REDEEM-CODE ') {
  const wrapper = await mountView()
  await wrapper.get('input#code').setValue(code)
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  return wrapper
}

const findRetry = (wrapper: ReturnType<typeof mount>) =>
  wrapper.findAll('button').find((b) => b.text() === 'redeem.buyCardRetry')

describe('RedeemView refresh after redemption', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    redeem.mockResolvedValue({ type: 'balance', value: 20, message: 'Code applied' })
    getHistory.mockResolvedValue({ items: [], total: 0 })
    refreshUser.mockResolvedValue({ balance: 30, concurrency: 2 })
    fetchActiveSubscriptions.mockResolvedValue([])
    fetchPublicSettings.mockResolvedValue({})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each(['balance', 'concurrency', 'subscription'])(
    'keeps a successful %s redemption when profile refresh fails',
    async (type) => {
      redeem.mockResolvedValue({ type, value: 20, message: 'Code applied' })
      refreshUser.mockRejectedValue({ status: 503, message: 'Service unavailable' })
      getHistory.mockResolvedValueOnce({ items: [], total: 0 }).mockResolvedValueOnce({
        total: 1,
        items: [{ id: 1, code: 'REDEEM-CODE', type, value: 20, used_at: '2026-03-08T00:00:00Z' }],
      })

      const wrapper = await submitCode()

      expect(redeem).toHaveBeenCalledWith('REDEEM-CODE')
      expect(showError).not.toHaveBeenCalled()
      expect(showWarning).toHaveBeenCalledWith('redeem.userRefreshFailed')
      expect(showSuccess).toHaveBeenCalledWith('redeem.codeRedeemSuccess')
      expect(wrapper.text()).toContain('Code applied')
      expect(wrapper.text()).not.toContain('redeem.failedToRedeem')
      expect((wrapper.get('input#code').element as HTMLInputElement).value).toBe('')
      expect((wrapper.get('input#code').element as HTMLInputElement).disabled).toBe(false)
      expect(getHistory).toHaveBeenCalledTimes(2)
      expect(wrapper.text()).toContain('REDEEM-C...')
      if (type === 'subscription') {
        expect(fetchActiveSubscriptions).toHaveBeenCalledWith(true)
      } else {
        expect(fetchActiveSubscriptions).not.toHaveBeenCalled()
      }
      wrapper.unmount()
    }
  )

  it('pages on the server, changes size, and resets page and total after redeeming', async () => {
    getHistory.mockResolvedValue({ items: [], total: 101 })
    const wrapper = await mountView()
    const button = (text: string) => wrapper.findAll('button').find((b) => b.text() === text)!
    expect(getHistory).toHaveBeenLastCalledWith(1, 20)
    expect(button('pagination.previous').attributes('disabled')).toBeDefined()
    await button('pagination.next').trigger('click')
    await flushPromises()
    expect(getHistory).toHaveBeenLastCalledWith(2, 20)
    await button('pagination.previous').trigger('click')
    await flushPromises()
    expect(getHistory).toHaveBeenLastCalledWith(1, 20)
    expect(wrapper.findAll('select option').map((o) => o.text())).toEqual(['20', '50', '100'])
    await wrapper.get('select').setValue('50')
    await flushPromises()
    expect(getHistory).toHaveBeenLastCalledWith(1, 50)
    await wrapper.get('select').setValue('100')
    await flushPromises()
    await button('pagination.next').trigger('click')
    await flushPromises()
    expect(getHistory).toHaveBeenLastCalledWith(2, 100)
    expect(button('pagination.next').attributes('disabled')).toBeDefined()
    getHistory.mockResolvedValue({ items: [], total: 102 })
    await wrapper.get('input#code').setValue('NEW-CODE')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(getHistory).toHaveBeenLastCalledWith(1, 100)
    expect(wrapper.text()).toContain('102')
    expect(button('pagination.previous').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('restores the loaded size and keeps rows and navigation usable after a size request fails', async () => {
    const item = { id: 1, code: 'OLD-ROWS', type: 'balance', value: 20, used_at: '2026-03-08T00:00:00Z' }
    getHistory.mockResolvedValue({ items: [item], total: 61 })
    const wrapper = await mountView()
    const button = (text: string) => wrapper.findAll('button').find((b) => b.text() === text)!
    await button('pagination.next').trigger('click')
    await flushPromises()
    let rejectRequest!: (error: Error) => void
    getHistory.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectRequest = reject
        })
    )
    await wrapper.get('select').setValue('50')
    expect(getHistory).toHaveBeenLastCalledWith(1, 50)
    expect(button('pagination.next').attributes('disabled')).toBeDefined()
    rejectRequest(new Error('Network error'))
    await flushPromises()
    expect(wrapper.get('select').element.value).toBe('20')
    expect(wrapper.text()).toContain('OLD-ROWS')
    expect(wrapper.text()).toContain('61')
    expect(button('pagination.previous').attributes('disabled')).toBeUndefined()
    expect(button('pagination.next').attributes('disabled')).toBeUndefined()
    expect(showError).toHaveBeenCalledWith('redeem.historyLoadFailed')
    await button('pagination.next').trigger('click')
    await flushPromises()
    expect(getHistory).toHaveBeenLastCalledWith(3, 20)
    await wrapper.get('select').setValue('50')
    await flushPromises()
    expect(getHistory).toHaveBeenLastCalledWith(1, 50)
    expect(wrapper.get('select').element.value).toBe('50')
    expect(button('pagination.previous').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it.each(['success', 'failure'])(
    'ignores a stale history %s after a newer size request succeeds',
    async (outcome) => {
      let resolveOld!: (value: unknown) => void
      let rejectOld!: (error: Error) => void
      getHistory.mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            resolveOld = resolve
            rejectOld = reject
          })
      )
      const wrapper = mount(RedeemView, { global: globalStubs })
      getHistory.mockResolvedValue({
        items: [{ id: 2, code: 'NEW-ROWS', type: 'balance', value: 30, used_at: '2026-03-08T00:00:00Z' }],
        total: 61,
      })
      await wrapper.get('select').setValue('50')
      await flushPromises()
      const button = (text: string) => wrapper.findAll('button').find((b) => b.text() === text)!
      await button('pagination.next').trigger('click')
      await flushPromises()
      expect(getHistory).toHaveBeenLastCalledWith(2, 50)
      if (outcome === 'success') {
        resolveOld({ items: [], total: 0 })
      } else {
        rejectOld(new Error('Stale network error'))
      }
      await flushPromises()
      expect(wrapper.get('select').element.value).toBe('50')
      expect(wrapper.text()).toContain('NEW-ROWS')
      expect(wrapper.text()).toContain('61')
      expect(button('pagination.previous').attributes('disabled')).toBeUndefined()
      expect(button('pagination.next').attributes('disabled')).toBeDefined()
      expect(wrapper.get('select').attributes('disabled')).toBeUndefined()
      expect(showError).not.toHaveBeenCalled()
      await button('pagination.previous').trigger('click')
      await flushPromises()
      expect(getHistory).toHaveBeenLastCalledWith(1, 50)
      wrapper.unmount()
    }
  )

  it('disables both paging buttons for empty history', async () => {
    const wrapper = await submitCode()
    for (const button of wrapper.findAll('button').filter((b) => b.text().startsWith('pagination.'))) {
      expect(button.attributes('disabled')).toBeDefined()
    }
    wrapper.unmount()
  })

  it('finishes normally without a warning when profile refresh succeeds', async () => {
    const wrapper = await submitCode()

    expect(refreshUser).toHaveBeenCalledOnce()
    expect(showWarning).not.toHaveBeenCalled()
    expect(showError).not.toHaveBeenCalled()
    expect(showSuccess).toHaveBeenCalledWith('redeem.codeRedeemSuccess')
    expect((wrapper.get('input#code').element as HTMLInputElement).value).toBe('')
    wrapper.unmount()
  })

  it('preserves the existing subscription refresh warning after successful redemption', async () => {
    redeem.mockResolvedValue({ type: 'subscription', value: 20, message: 'Code applied' })
    fetchActiveSubscriptions.mockRejectedValue(new Error('Network Error'))
    const wrapper = await submitCode()

    expect(showWarning).toHaveBeenCalledWith('redeem.subscriptionRefreshFailed')
    expect(showError).not.toHaveBeenCalled()
    expect(showSuccess).toHaveBeenCalledWith('redeem.codeRedeemSuccess')
    expect(getHistory).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })
})

describe('RedeemView error classification (real client shapes)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getHistory.mockResolvedValue({ items: [], total: 0 })
    refreshUser.mockResolvedValue({ balance: 30, concurrency: 2 })
    fetchActiveSubscriptions.mockResolvedValue([])
    fetchPublicSettings.mockResolvedValue({})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the server business message for an invalid code (status 400), not the unknown state', async () => {
    redeem.mockRejectedValue({ status: 400, code: 400, message: '卡密无效' })
    const wrapper = await submitCode()

    expect(showError).toHaveBeenCalledWith('redeem.redeemFailed')
    expect(showWarning).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('卡密无效')
    expect(wrapper.text()).not.toContain('redeem.redeemResultUnknown')
    expect(wrapper.text()).toContain('redeem.redeemFailed')
    expect(redeem).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('maps a used-code conflict (status 409 + reason) to the localized business message', async () => {
    redeem.mockRejectedValue({
      status: 409,
      code: 409,
      reason: 'REDEEM_CODE_USED',
      message: 'redeem code already used',
    })
    const wrapper = await submitCode()

    expect(wrapper.text()).toContain('该卡密已被使用')
    expect(wrapper.text()).not.toContain('redeem.redeemResultUnknown')
    expect(redeem).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('shows a rate-limit rejection (status 429) as a business error', async () => {
    redeem.mockRejectedValue({
      status: 429,
      code: 429,
      reason: 'REDEEM_RATE_LIMITED',
      message: '请求过于频繁',
    })
    const wrapper = await submitCode()

    expect(wrapper.text()).toContain('尝试次数过多')
    expect(wrapper.text()).not.toContain('redeem.redeemResultUnknown')
    expect(showError).toHaveBeenCalledWith('redeem.redeemFailed')
    wrapper.unmount()
  })

  it('reports the unknown state for a network timeout (status 0) without retrying', async () => {
    redeem.mockRejectedValue({
      status: 0,
      code: 'ECONNABORTED',
      message: 'Network error. Please check your connection.',
    })
    const wrapper = await submitCode()

    expect(wrapper.text()).toContain('redeem.redeemResultUnknown')
    expect(wrapper.text()).toContain('redeem.redeemUnknownTitle')
    expect(wrapper.text()).not.toContain('redeem.redeemFailed')
    expect(showWarning).toHaveBeenCalledWith('redeem.redeemUnknownToast')
    expect(showError).not.toHaveBeenCalled()
    expect(redeem).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it.each([
    ['ECONNABORTED', { status: 0, code: 'ECONNABORTED' }],
    ['ERR_NETWORK', { status: 0, code: 'ERR_NETWORK' }],
    ['ETIMEDOUT', { status: 0, code: 'ETIMEDOUT' }],
  ])('treats %s as an unknown outcome', async (_name, error) => {
    redeem.mockRejectedValue(error)
    const wrapper = await submitCode()

    expect(wrapper.text()).toContain('redeem.redeemResultUnknown')
    expect(showError).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('treats a post-submit server fault (status 500) as a conservative unknown outcome', async () => {
    redeem.mockRejectedValue({ status: 500, message: 'internal error' })
    const wrapper = await submitCode()

    expect(wrapper.text()).toContain('redeem.redeemResultUnknown')
    expect(showWarning).toHaveBeenCalledWith('redeem.redeemUnknownToast')
    expect(redeem).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('does not POST for blank input and warns the user', async () => {
    const wrapper = await submitCode('   ')

    expect(redeem).not.toHaveBeenCalled()
    expect(showError).toHaveBeenCalledWith('redeem.pleaseEnterCode')
    wrapper.unmount()
  })

  it('submits only once when the form is submitted twice quickly', async () => {
    let resolveRedeem!: (value: unknown) => void
    redeem.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRedeem = resolve
        })
    )
    const wrapper = await mountView()
    await wrapper.get('input#code').setValue('REDEEM-CODE')
    await wrapper.get('form').trigger('submit')
    await wrapper.get('form').trigger('submit')
    expect(redeem).toHaveBeenCalledTimes(1)
    resolveRedeem({ type: 'balance', value: 20, message: 'ok' })
    await flushPromises()
    wrapper.unmount()
  })
})

describe('RedeemView success flow clears input immediately', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getHistory.mockResolvedValue({ items: [], total: 0 })
    fetchActiveSubscriptions.mockResolvedValue([])
    fetchPublicSettings.mockResolvedValue({})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps the returned new_balance visible when profile refresh fails', async () => {
    redeem.mockResolvedValue({ type: 'balance', value: 20, message: 'ok', new_balance: 88.5 })
    refreshUser.mockRejectedValue({ status: 503, message: 'unavailable' })
    const wrapper = await submitCode()

    expect(wrapper.text()).toContain('$88.50')
    expect(wrapper.text()).toContain('ok')
    expect(showWarning).toHaveBeenCalledWith('redeem.userRefreshFailed')
    expect(showError).not.toHaveBeenCalled()
    expect((wrapper.get('input#code').element as HTMLInputElement).value).toBe('')
    wrapper.unmount()
  })

  it('clears and re-masks the input while the profile refresh is still pending', async () => {
    redeem.mockResolvedValue({ type: 'balance', value: 20, message: 'ok', new_balance: 55 })
    let resolveRefresh!: (value: unknown) => void
    refreshUser.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRefresh = resolve
        })
    )
    const wrapper = await mountView()
    await wrapper.get('button[aria-label="redeem.showCode"]').trigger('click')
    expect((wrapper.get('input#code').element as HTMLInputElement).type).toBe('text')
    await wrapper.get('input#code').setValue('REDEEM-CODE')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect((wrapper.get('input#code').element as HTMLInputElement).value).toBe('')
    expect((wrapper.get('input#code').element as HTMLInputElement).type).toBe('password')
    expect(wrapper.text()).toContain('$55.00')

    resolveRefresh({ balance: 55, concurrency: 2 })
    await flushPromises()
    expect((wrapper.get('input#code').element as HTMLInputElement).value).toBe('')
    wrapper.unmount()
  })

  it('toggles the redeem code visibility with a labelled button', async () => {
    const wrapper = await mountView()

    const input = wrapper.get('input#code').element as HTMLInputElement
    expect(input.type).toBe('password')
    await wrapper.get('button[aria-label="redeem.showCode"]').trigger('click')
    expect((wrapper.get('input#code').element as HTMLInputElement).type).toBe('text')
    expect(wrapper.get('button[aria-label="redeem.hideCode"]').exists()).toBe(true)
    wrapper.unmount()
  })
})

describe('RedeemView card shop entry and public settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getHistory.mockResolvedValue({ items: [], total: 0 })
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the buy entry from the public settings shop URL', async () => {
    fetchPublicSettings.mockResolvedValue({
      payment_card_shop_url: 'https://wzyp.cn/shop/CCZ33PW7',
      contact_info: 'QQ: 123',
    })
    const wrapper = await mountView()

    const buyLink = wrapper.findAll('a').find((a) => a.attributes('href') === 'https://wzyp.cn/shop/CCZ33PW7')
    expect(buyLink).toBeTruthy()
    expect(buyLink!.attributes('target')).toBe('_blank')
    expect(buyLink!.attributes('rel')).toBe('noopener noreferrer')
    expect(wrapper.text()).toContain('redeem.buyCardStep1')
    expect(wrapper.text()).toContain('QQ: 123')
    wrapper.unmount()
  })

  it('shows unavailable + retry when the first settings load fails, then succeeds on retry', async () => {
    fetchPublicSettings
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ payment_card_shop_url: 'https://wzyp.cn/shop/RETRY', contact_info: 'TG: @x' })
    const wrapper = await mountView()

    expect(wrapper.text()).toContain('redeem.buyCardUnavailable')
    expect(fetchPublicSettings).toHaveBeenCalledTimes(1)

    await findRetry(wrapper)!.trigger('click')
    await flushPromises()

    expect(fetchPublicSettings).toHaveBeenCalledTimes(2)
    const buyLink = wrapper.findAll('a').find((a) => a.attributes('href') === 'https://wzyp.cn/shop/RETRY')
    expect(buyLink).toBeTruthy()
    expect(wrapper.text()).toContain('TG: @x')
    wrapper.unmount()
  })

  it('keeps showing retry when the retry also fails and does not reuse stale cache', async () => {
    fetchPublicSettings.mockResolvedValue(null)
    const wrapper = await mountView()

    expect(wrapper.text()).toContain('redeem.buyCardUnavailable')
    await findRetry(wrapper)!.trigger('click')
    await flushPromises()

    expect(fetchPublicSettings).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('redeem.buyCardUnavailable')
    expect(wrapper.findAll('a').some((a) => a.attributes('href') === 'https://wzyp.cn/shop/RETRY')).toBe(false)
    // 设置失败不阻断兑换
    expect(wrapper.find('form').exists()).toBe(true)
    wrapper.unmount()
  })

  it('does not fire duplicate settings requests while a retry is in flight', async () => {
    let resolveRetry!: (value: unknown) => void
    fetchPublicSettings.mockResolvedValueOnce(null).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRetry = resolve
        })
    )
    const wrapper = await mountView()
    const retry = findRetry(wrapper)!
    await retry.trigger('click')
    await retry.trigger('click')
    await retry.trigger('click')

    expect(fetchPublicSettings).toHaveBeenCalledTimes(2)
    expect(retry.attributes('disabled')).toBeDefined()

    resolveRetry({ payment_card_shop_url: 'https://wzyp.cn/shop/OK' })
    await flushPromises()
    wrapper.unmount()
  })

  it.each([
    ['plain http', 'http://wzyp.cn/shop/CCZ33PW7'],
    ['userinfo', 'https://user:pass@wzyp.cn/shop'],
    ['relative path', '/shop/CCZ33PW7'],
    ['javascript:', 'javascript:alert(1)'],
    ['data:', 'data:text/html,hi'],
    ['invalid hostname', 'https://-bad-.com/shop'],
    ['single-label host', 'https://localhost/shop'],
  ])('does not render a buy link for an invalid shop URL (%s)', async (_name, url) => {
    fetchPublicSettings.mockResolvedValue({ payment_card_shop_url: url })
    const wrapper = await mountView()

    expect(wrapper.text()).toContain('redeem.buyCardUnavailable')
    expect(wrapper.findAll('a').some((a) => (a.attributes('href') ?? '').startsWith('http'))).toBe(false)
    // 兑换仍可用
    expect(wrapper.find('form').exists()).toBe(true)
    wrapper.unmount()
  })

  it('falls back to unavailable for an empty shop URL', async () => {
    fetchPublicSettings.mockResolvedValue({ payment_card_shop_url: '' })
    const wrapper = await mountView()

    expect(wrapper.text()).toContain('redeem.buyCardUnavailable')
    wrapper.unmount()
  })
})
