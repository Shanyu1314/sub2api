<template>
  <AppLayout>
    <div class="mx-auto max-w-4xl space-y-6">
      <section class="card p-6">
        <h2 class="text-sm font-medium text-gray-500 dark:text-gray-400">{{ t('rechargeGuide.account') }}</h2>
        <p class="mt-2 font-semibold text-gray-900 dark:text-white">{{ authStore.user?.username || authStore.user?.email }}</p>
        <p class="mt-2 font-medium text-green-600 dark:text-green-400">
          {{ t('redeem.currentBalance') }}: ${{ (authStore.user?.balance ?? 0).toFixed(2) }}
        </p>
      </section>

      <section class="card space-y-6 p-6 md:p-8">
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white">{{ t('rechargeGuide.instructions') }}</h2>
        <div class="rounded-xl border border-amber-200 bg-amber-50 p-5 leading-7 text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
          <p>{{ t('rechargeGuide.notice') }}</p>
          <a v-if="shopURL" :href="shopURL" target="_blank" rel="noopener noreferrer"
            class="mt-3 inline-block font-semibold underline underline-offset-4">
            {{ t('rechargeGuide.buy') }}
          </a>
          <div v-else class="mt-3 flex items-center gap-3 text-sm" role="status">
            <span>{{ loading ? t('redeem.buyCardLoading') : t('redeem.buyCardUnavailable') }}</span>
            <button v-if="!loading" class="font-medium underline" type="button" @click="loadShop">{{ t('redeem.buyCardRetry') }}</button>
          </div>
        </div>
        <ol class="list-inside list-decimal space-y-3 text-sm leading-6 text-gray-600 dark:text-gray-300">
          <li>{{ t('rechargeGuide.step1') }}</li>
          <li>{{ t('rechargeGuide.step2') }}</li>
          <li>{{ t('rechargeGuide.step3') }}</li>
        </ol>
        <router-link to="/redeem" class="btn btn-primary inline-flex">{{ t('rechargeGuide.redeem') }}</router-link>
      </section>
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AppLayout from '@/components/layout/AppLayout.vue'
import { useAuthStore } from '@/stores/auth'
import { useAppStore } from '@/stores/app'
import { sanitizeCardShopUrl } from '@/utils/url'

const { t } = useI18n()
const authStore = useAuthStore()
const appStore = useAppStore()
const shopURL = ref('')
const loading = ref(false)

async function loadShop() {
  if (loading.value) return
  loading.value = true
  shopURL.value = ''
  try {
    const settings = await appStore.fetchPublicSettings(true)
    shopURL.value = sanitizeCardShopUrl(settings?.payment_card_shop_url || '')
  } catch {
    // Keep the redemption link usable when settings cannot be loaded.
  } finally {
    loading.value = false
  }
}

onMounted(loadShop)
</script>
