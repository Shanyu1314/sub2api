<template>
  <AppLayout>
    <div class="mx-auto max-w-2xl space-y-6">
      <!-- Page header -->
      <div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ t('redeem.title') }}</h1>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">{{ t('redeem.description') }}</p>
      </div>

      <!-- Buy card entry -->
      <div class="card">
        <div class="p-6">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('redeem.buyCard') }}</h2>
          <ol class="mt-3 list-inside list-decimal space-y-1 text-sm text-gray-600 dark:text-gray-300">
            <li>{{ t('redeem.buyCardStep1') }}</li>
            <li>{{ t('redeem.buyCardStep2') }}</li>
            <li>{{ t('redeem.buyCardStep3') }}</li>
          </ol>
          <div class="mt-4">
            <a
              v-if="cardShopURL"
              :href="cardShopURL"
              target="_blank"
              rel="noopener noreferrer"
              class="btn btn-primary w-full py-3 text-center"
            >
              {{ t('redeem.buyCard') }}
            </a>
            <div v-else class="flex flex-wrap items-center gap-3">
              <p class="text-sm text-gray-500 dark:text-gray-400">
                {{ settingsLoading ? t('redeem.buyCardLoading') : t('redeem.buyCardUnavailable') }}
              </p>
              <button
                type="button"
                class="text-sm font-medium text-primary-600 hover:underline disabled:cursor-not-allowed disabled:opacity-60 dark:text-primary-400"
                :disabled="settingsLoading"
                @click="loadPublicSettings"
              >
                {{ t('redeem.buyCardRetry') }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Current Balance Card -->
      <div class="card overflow-hidden">
        <div class="bg-gradient-to-br from-primary-500 to-primary-600 px-6 py-8 text-center">
          <div
            class="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-white/20 backdrop-blur-sm"
          >
            <Icon name="creditCard" size="xl" class="text-white" />
          </div>
          <p class="text-sm font-medium text-primary-100">{{ t('redeem.currentBalance') }}</p>
          <p class="mt-2 text-4xl font-bold text-white">${{ displayBalance.toFixed(2) }}</p>
          <p class="mt-2 text-sm text-primary-100">
            {{ t('redeem.concurrency') }}: {{ displayConcurrency }} {{ t('redeem.requests') }}
          </p>
        </div>
      </div>

      <!-- Redeem Form -->
      <div class="card">
        <div class="p-6">
          <form @submit.prevent="handleRedeem" class="space-y-5">
            <div>
              <label for="code" class="input-label">
                {{ t('redeem.redeemCodeLabel') }}
              </label>
              <div class="relative mt-1">
                <div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
                  <Icon name="gift" size="md" class="text-gray-400 dark:text-dark-500" />
                </div>
                <input
                  id="code"
                  v-model="redeemCode"
                  :type="showCode ? 'text' : 'password'"
                  required
                  autocomplete="off"
                  autocapitalize="off"
                  spellcheck="false"
                  :placeholder="t('redeem.redeemCodePlaceholder')"
                  :disabled="submitting"
                  class="input py-3 pl-12 pr-12 text-lg"
                />
                <button
                  type="button"
                  class="absolute inset-y-0 right-0 flex items-center pr-4 text-gray-400 hover:text-gray-600 dark:text-dark-400 dark:hover:text-gray-300"
                  :aria-label="showCode ? t('redeem.hideCode') : t('redeem.showCode')"
                  @click="showCode = !showCode"
                >
                  <Icon :name="showCode ? 'eyeOff' : 'eye'" size="md" />
                </button>
              </div>
              <p class="input-hint">
                {{ t('redeem.redeemCodeHint') }}
              </p>
            </div>

            <button
              type="submit"
              :disabled="!redeemCode || submitting"
              class="btn btn-primary w-full py-3"
            >
              <svg
                v-if="submitting"
                class="-ml-1 mr-2 h-5 w-5 animate-spin"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  class="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  stroke-width="4"
                ></circle>
                <path
                  class="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
              <Icon v-else name="checkCircle" size="md" class="mr-2" />
              {{ submitting ? t('redeem.redeeming') : t('redeem.redeemButton') }}
            </button>
          </form>
        </div>
      </div>

      <!-- Success Message -->
      <transition name="fade">
        <div
          v-if="redeemResult"
          class="card border-emerald-200 bg-emerald-50 dark:border-emerald-800/50 dark:bg-emerald-900/20"
          aria-live="polite"
          role="status"
        >
          <div class="p-6">
            <div class="flex items-start gap-4">
              <div
                class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-100 dark:bg-emerald-900/30"
              >
                <Icon name="checkCircle" size="md" class="text-emerald-600 dark:text-emerald-400" />
              </div>
              <div class="flex-1">
                <h3 class="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
                  {{ t('redeem.redeemSuccess') }}
                </h3>
                <div class="mt-2 text-sm text-emerald-700 dark:text-emerald-400">
                  <p>{{ redeemResult.message }}</p>
                  <div class="mt-3 space-y-1">
                    <p v-if="redeemResult.type === 'balance'" class="font-medium">
                      {{ t('redeem.added') }}: ${{ redeemResult.value.toFixed(2) }}
                    </p>
                    <p v-else-if="redeemResult.type === 'concurrency'" class="font-medium">
                      {{ t('redeem.added') }}: {{ redeemResult.value }}
                      {{ t('redeem.concurrentRequests') }}
                    </p>
                    <p v-else-if="redeemResult.type === 'subscription'" class="font-medium">
                      {{ t('redeem.subscriptionAssigned') }}
                      <span v-if="redeemResult.group_name"> - {{ redeemResult.group_name }}</span>
                      <span v-if="redeemResult.validity_days">
                        ({{
                          t('redeem.subscriptionDays', { days: redeemResult.validity_days })
                        }})</span
                      >
                    </p>
                    <p v-if="redeemResult.new_balance !== undefined">
                      {{ t('redeem.newBalance') }}:
                      <span class="font-semibold">${{ redeemResult.new_balance.toFixed(2) }}</span>
                    </p>
                    <p v-if="redeemResult.new_concurrency !== undefined">
                      {{ t('redeem.newConcurrency') }}:
                      <span class="font-semibold"
                        >{{ redeemResult.new_concurrency }} {{ t('redeem.requests') }}</span
                      >
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </transition>

      <!-- Error / unknown-outcome Message -->
      <transition name="fade">
        <div
          v-if="errorMessage"
          class="card"
          :class="
            errorIsUnknown
              ? 'border-amber-200 bg-amber-50 dark:border-amber-800/50 dark:bg-amber-900/20'
              : 'border-red-200 bg-red-50 dark:border-red-800/50 dark:bg-red-900/20'
          "
          aria-live="polite"
          role="alert"
        >
          <div class="p-6">
            <div class="flex items-start gap-4">
              <div
                class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl"
                :class="
                  errorIsUnknown
                    ? 'bg-amber-100 dark:bg-amber-900/30'
                    : 'bg-red-100 dark:bg-red-900/30'
                "
              >
                <Icon
                  name="exclamationCircle"
                  size="md"
                  :class="
                    errorIsUnknown
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-red-600 dark:text-red-400'
                  "
                />
              </div>
              <div class="flex-1">
                <h3
                  class="text-sm font-semibold"
                  :class="
                    errorIsUnknown
                      ? 'text-amber-800 dark:text-amber-300'
                      : 'text-red-800 dark:text-red-300'
                  "
                >
                  {{ errorIsUnknown ? t('redeem.redeemUnknownTitle') : t('redeem.redeemFailed') }}
                </h3>
                <p
                  class="mt-2 text-sm"
                  :class="
                    errorIsUnknown
                      ? 'text-amber-700 dark:text-amber-400'
                      : 'text-red-700 dark:text-red-400'
                  "
                >
                  {{ errorMessage }}
                </p>
              </div>
            </div>
          </div>
        </div>
      </transition>

      <!-- Information Card -->
      <div
        class="card border-primary-200 bg-primary-50 dark:border-primary-800/50 dark:bg-primary-900/20"
      >
        <div class="p-6">
          <div class="flex items-start gap-4">
            <div
              class="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary-100 dark:bg-primary-900/30"
            >
              <Icon name="infoCircle" size="md" class="text-primary-600 dark:text-primary-400" />
            </div>
            <div class="flex-1">
              <h3 class="text-sm font-semibold text-primary-800 dark:text-primary-300">
                {{ t('redeem.aboutCodes') }}
              </h3>
              <ul
                class="mt-2 list-inside list-disc space-y-1 text-sm text-primary-700 dark:text-primary-400"
              >
                <li>{{ t('redeem.codeRule1') }}</li>
                <li>{{ t('redeem.codeRule2') }}</li>
                <li>
                  {{ t('redeem.codeRule3') }}
                  <span
                    v-if="contactInfo"
                    class="ml-1.5 inline-flex items-center rounded-md bg-primary-200/50 px-2 py-0.5 text-xs font-medium text-primary-800 dark:bg-primary-800/40 dark:text-primary-200"
                  >
                    {{ contactInfo }}
                  </span>
                </li>
                <li>{{ t('redeem.codeRule4') }}</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <!-- Recent Activity -->
      <div class="card">
        <div class="border-b border-gray-100 px-6 py-4 dark:border-dark-700">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">
            {{ t('redeem.recentActivity') }}
          </h2>
        </div>
        <div class="p-6">
          <!-- Loading State -->
          <div v-if="loadingHistory" class="flex items-center justify-center py-8">
            <svg class="h-6 w-6 animate-spin text-primary-500" fill="none" viewBox="0 0 24 24">
              <circle
                class="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                stroke-width="4"
              ></circle>
              <path
                class="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              ></path>
            </svg>
          </div>

          <!-- History List -->
          <div v-else-if="history.length > 0" class="space-y-3">
            <div
              v-for="item in history"
              :key="item.id"
              class="flex items-center justify-between rounded-xl bg-gray-50 p-4 dark:bg-dark-800"
            >
              <div class="flex items-center gap-4">
                <div
                  :class="[
                    'flex h-10 w-10 items-center justify-center rounded-xl',
                    isBalanceType(item.type)
                      ? item.value >= 0
                        ? 'bg-emerald-100 dark:bg-emerald-900/30'
                        : 'bg-red-100 dark:bg-red-900/30'
                      : isSubscriptionType(item.type)
                        ? 'bg-purple-100 dark:bg-purple-900/30'
                        : item.value >= 0
                          ? 'bg-blue-100 dark:bg-blue-900/30'
                          : 'bg-orange-100 dark:bg-orange-900/30'
                  ]"
                >
                  <!-- 余额类型图标 -->
                  <Icon
                    v-if="isBalanceType(item.type)"
                    name="dollar"
                    size="md"
                    :class="
                      item.value >= 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-red-600 dark:text-red-400'
                    "
                  />
                  <!-- 订阅类型图标 -->
                  <Icon
                    v-else-if="isSubscriptionType(item.type)"
                    name="badge"
                    size="md"
                    class="text-purple-600 dark:text-purple-400"
                  />
                  <!-- 并发类型图标 -->
                  <Icon
                    v-else
                    name="bolt"
                    size="md"
                    :class="
                      item.value >= 0
                        ? 'text-blue-600 dark:text-blue-400'
                        : 'text-orange-600 dark:text-orange-400'
                    "
                  />
                </div>
                <div>
                  <p class="text-sm font-medium text-gray-900 dark:text-white">
                    {{ getHistoryItemTitle(item) }}
                  </p>
                  <p class="text-xs text-gray-500 dark:text-dark-400">
                    {{ formatDateTime(item.used_at) }}
                  </p>
                </div>
              </div>
              <div class="text-right">
                <p
                  :class="[
                    'text-sm font-semibold',
                    isBalanceType(item.type)
                      ? item.value >= 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-red-600 dark:text-red-400'
                      : isSubscriptionType(item.type)
                        ? 'text-purple-600 dark:text-purple-400'
                        : item.value >= 0
                          ? 'text-blue-600 dark:text-blue-400'
                          : 'text-orange-600 dark:text-orange-400'
                  ]"
                >
                  {{ formatHistoryValue(item) }}
                </p>
                <p
                  v-if="!isAdminAdjustment(item.type)"
                  class="font-mono text-xs text-gray-400 dark:text-dark-500"
                >
                  {{ item.code.slice(0, 8) }}...
                </p>
                <p v-else class="text-xs text-gray-400 dark:text-dark-500">
                  {{ t('redeem.adminAdjustment') }}
                </p>
                <!-- Display notes for admin adjustments -->
                <p
                  v-if="item.notes"
                  class="mt-1 text-xs text-gray-500 dark:text-dark-400 italic max-w-[200px] truncate"
                  :title="item.notes"
                >
                  {{ item.notes }}
                </p>
              </div>
            </div>
          </div>

          <!-- Empty State -->
          <div v-else class="empty-state py-8">
            <div
              class="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-100 dark:bg-dark-800"
            >
              <Icon name="clock" size="xl" class="text-gray-400 dark:text-dark-500" />
            </div>
            <p class="text-sm text-gray-500 dark:text-dark-400">
              {{ t('redeem.historyWillAppear') }}
            </p>
          </div>
          <div class="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
            <span>{{ t('common.total') }}: {{ historyTotal }} {{ t('pagination.results') }}</span>
            <label>
              {{ t('pagination.perPage') }}
              <select
                v-model="historyPageSize"
                class="input w-20"
                :disabled="loadingHistory || submitting"
                @change="fetchHistory(1)"
              >
                <option v-for="size in [20, 50, 100]" :key="size" :value="size">{{ size }}</option>
              </select>
            </label>
            <button
              class="btn btn-secondary"
              :disabled="loadingHistory || submitting || historyPage <= 1"
              @click="fetchHistory(historyPage - 1)"
            >{{ t('pagination.previous') }}</button>
            <button
              class="btn btn-secondary"
              :disabled="loadingHistory || submitting || historyPage * historyPageSize >= historyTotal"
              @click="fetchHistory(historyPage + 1)"
            >{{ t('pagination.next') }}</button>
          </div>
        </div>
      </div>
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { useAppStore } from '@/stores/app'
import { useSubscriptionStore } from '@/stores/subscriptions'
import { redeemAPI, type RedeemHistoryItem } from '@/api'
import AppLayout from '@/components/layout/AppLayout.vue'
import Icon from '@/components/icons/Icon.vue'
import { formatDateTime } from '@/utils/format'
import { sanitizeCardShopUrl } from '@/utils/url'
import { extractI18nErrorMessage } from '@/utils/apiError'

const { t } = useI18n()
const authStore = useAuthStore()
const appStore = useAppStore()
const subscriptionStore = useSubscriptionStore()

const user = computed(() => authStore.user)

const redeemCode = ref('')
const showCode = ref(false)
const submitting = ref(false)
const redeemResult = ref<{
  message: string
  type: string
  value: number
  new_balance?: number
  new_concurrency?: number
  group_name?: string
  validity_days?: number
} | null>(null)
const errorMessage = ref('')
// 服务端可能已经处理、但客户端拿不到确定结果（超时/断网/5xx）时，
// 用独立的未知状态文案，不能断言失败或未到账。
const errorIsUnknown = ref(false)

// 兑换成功后服务端返回的最新余额/并发数；刷新资料失败时仍优先展示该值。
const localBalance = ref<number | null>(null)
const localConcurrency = ref<number | null>(null)
const displayBalance = computed(() => localBalance.value ?? user.value?.balance ?? 0)
const displayConcurrency = computed(() => localConcurrency.value ?? user.value?.concurrency ?? 0)

// 卡密店铺地址（来自公共设置，独立于在线支付）
const cardShopURL = ref('')
const contactInfo = ref('')
const settingsStatus = ref<'idle' | 'loading' | 'success' | 'failed'>('idle')
const settingsLoading = computed(() => settingsStatus.value === 'loading')

// History data
const history = ref<RedeemHistoryItem[]>([])
const loadingHistory = ref(false)
const historyPage = ref(1)
const historyPageSize = ref(20)
const historyTotal = ref(0)
let historyRequest = 0
let loadedHistoryPageSize = 20

// Helper functions for history display
const isBalanceType = (type: string) => {
  return type === 'balance' || type === 'admin_balance'
}

const isSubscriptionType = (type: string) => {
  return type === 'subscription'
}

const isAdminAdjustment = (type: string) => {
  return type === 'admin_balance' || type === 'admin_concurrency'
}

const getHistoryItemTitle = (item: RedeemHistoryItem) => {
  if (item.type === 'balance') {
    return t('redeem.balanceAddedRedeem')
  } else if (item.type === 'admin_balance') {
    return item.value >= 0 ? t('redeem.balanceAddedAdmin') : t('redeem.balanceDeductedAdmin')
  } else if (item.type === 'concurrency') {
    return t('redeem.concurrencyAddedRedeem')
  } else if (item.type === 'admin_concurrency') {
    return item.value >= 0 ? t('redeem.concurrencyAddedAdmin') : t('redeem.concurrencyReducedAdmin')
  } else if (item.type === 'subscription') {
    return t('redeem.subscriptionAssigned')
  }
  return t('common.unknown')
}

const formatHistoryValue = (item: RedeemHistoryItem) => {
  if (isBalanceType(item.type)) {
    const sign = item.value >= 0 ? '+' : ''
    return `${sign}$${item.value.toFixed(2)}`
  } else if (isSubscriptionType(item.type)) {
    // 订阅类型显示有效天数和分组名称
    const days = item.validity_days || Math.round(item.value)
    const groupName = item.group?.name || ''
    return groupName ? `${days}${t('redeem.days')} - ${groupName}` : `${days}${t('redeem.days')}`
  } else {
    const sign = item.value >= 0 ? '+' : ''
    return `${sign}${item.value} ${t('redeem.requests')}`
  }
}

const fetchHistory = async (page = 1) => {
  const request = ++historyRequest
  const pageSize = historyPageSize.value
  loadingHistory.value = true
  try {
    const result = await redeemAPI.getHistory(page, pageSize)
    if (request !== historyRequest) return
    history.value = result.items
    historyTotal.value = result.total
    historyPage.value = page
    historyPageSize.value = pageSize
    loadedHistoryPageSize = pageSize
  } catch (error) {
    if (request !== historyRequest) return
    historyPageSize.value = loadedHistoryPageSize
    appStore.showError(t('redeem.historyLoadFailed'))
    console.error('Failed to fetch history:', error)
  } finally {
    if (request === historyRequest) loadingHistory.value = false
  }
}

// 网络错误码（拦截器把断网映射成 status:0 + code）
const NETWORK_ERROR_CODES = new Set(['ECONNABORTED', 'ERR_NETWORK', 'ETIMEDOUT', 'ERR_CANCELED'])

type RedeemErrorShape = { status?: number; code?: number | string }

function redeemErrorShape(error: unknown): RedeemErrorShape {
  return error && typeof error === 'object' ? (error as RedeemErrorShape) : {}
}

/**
 * 判断「结果未知」：请求可能已到达服务端并完成兑换，只是客户端没拿到确定响应。
 * - status === 0 或网络错误码：断网/超时
 * - status >= 500：服务端故障可能发生在提交之后
 */
function isUnknownRedeemOutcome(error: unknown): boolean {
  const { status, code } = redeemErrorShape(error)
  if (status === 0) return true
  if (typeof status === 'number' && status >= 500) return true
  return typeof code === 'string' && NETWORK_ERROR_CODES.has(code)
}

// 复用统一错误码提取，把 reason（如 REDEEM_CODE_USED）映射到本地化文案；
// 无映射时回退服务端可公开的 message。
function redeemErrorMessage(error: unknown): string {
  return extractI18nErrorMessage(error, t, 'redeem.errors', t('redeem.failedToRedeem'))
}

const handleRedeem = async () => {
  // 防重复提交：函数开头检查 submitting
  if (submitting.value) return

  const code = redeemCode.value.trim()
  if (!code) {
    appStore.showError(t('redeem.pleaseEnterCode'))
    return
  }

  submitting.value = true
  errorMessage.value = ''
  errorIsUnknown.value = false
  redeemResult.value = null

  let result: Awaited<ReturnType<typeof redeemAPI.redeem>>
  try {
    result = await redeemAPI.redeem(code)
  } catch (error) {
    submitting.value = false
    if (isUnknownRedeemOutcome(error)) {
      errorIsUnknown.value = true
      errorMessage.value = t('redeem.redeemResultUnknown')
      appStore.showWarning(t('redeem.redeemUnknownToast'))
    } else {
      errorIsUnknown.value = false
      errorMessage.value = redeemErrorMessage(error)
      appStore.showError(t('redeem.redeemFailed'))
    }
    // 不自动重试，保留用户输入以便核对
    return
  }

  // 服务器已确认成功：立即清空输入并保持遮蔽，锁定已知余额，避免后续刷新阻塞成功展示。
  redeemResult.value = result
  redeemCode.value = ''
  showCode.value = false
  if (typeof result.new_balance === 'number') localBalance.value = result.new_balance
  if (typeof result.new_concurrency === 'number') localConcurrency.value = result.new_concurrency
  appStore.showSuccess(t('redeem.codeRedeemSuccess'))

  // 以下刷新失败只提示刷新失败，不能把已成功兑换改成失败，也不能重复提交卡密。
  try {
    await authStore.refreshUser()
    // 资料刷新成功后以服务端用户资料为准
    localBalance.value = null
    localConcurrency.value = null
  } catch (error) {
    console.error('Failed to refresh user after redeem:', error)
    appStore.showWarning(t('redeem.userRefreshFailed'))
  }

  // If subscription type, immediately refresh subscription status
  if (result.type === 'subscription') {
    try {
      await subscriptionStore.fetchActiveSubscriptions(true) // force refresh
    } catch (error) {
      console.error('Failed to refresh subscriptions after redeem:', error)
      appStore.showWarning(t('redeem.subscriptionRefreshFailed'))
    }
  }

  try {
    await fetchHistory()
  } catch (error) {
    console.error('Failed to refresh history after redeem:', error)
  }

  submitting.value = false
}

/**
 * 统一的公共设置加载入口：首次加载与重试共用。
 * 依据 appStore.fetchPublicSettings 的返回值判定成功（失败返回 null，不抛异常），
 * 避免把失败后残留的旧缓存当成本次响应。
 */
const loadPublicSettings = async () => {
  if (settingsStatus.value === 'loading') return
  settingsStatus.value = 'loading'

  let settings: Awaited<ReturnType<typeof appStore.fetchPublicSettings>> | null = null
  try {
    settings = await appStore.fetchPublicSettings(true)
  } catch (error) {
    console.error('Failed to load public settings:', error)
    settings = null
  }

  if (!settings) {
    settingsStatus.value = 'failed'
    return
  }

  contactInfo.value = settings.contact_info || ''
  cardShopURL.value = sanitizeCardShopUrl(settings.payment_card_shop_url || '')
  settingsStatus.value = 'success'
}

onMounted(() => {
  fetchHistory()
  void loadPublicSettings()
})
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: all 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
