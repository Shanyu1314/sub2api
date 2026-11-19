<template>
  <div class="relative flex min-h-screen items-center justify-center overflow-hidden p-4" :class="{ 'starfield-login': starfield }">
    <!-- Background -->
    <div
      v-if="!starfield"
      class="absolute inset-0 bg-gradient-to-br from-gray-50 via-primary-50/30 to-gray-100 dark:from-dark-950 dark:via-dark-900 dark:to-dark-950"
    ></div>

    <!-- Decorative Elements -->
    <div v-if="!starfield" class="pointer-events-none absolute inset-0 overflow-hidden">
      <!-- Gradient Orbs -->
      <div
        class="absolute -right-40 -top-40 h-80 w-80 rounded-full bg-primary-400/20 blur-3xl"
      ></div>
      <div
        class="absolute -bottom-40 -left-40 h-80 w-80 rounded-full bg-primary-500/15 blur-3xl"
      ></div>
      <div
        class="absolute left-1/2 top-1/2 h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary-300/10 blur-3xl"
      ></div>

      <!-- Grid Pattern -->
      <div
        class="absolute inset-0 bg-[linear-gradient(rgba(20,184,166,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(20,184,166,0.03)_1px,transparent_1px)] bg-[size:64px_64px]"
      ></div>
    </div>

    <!-- Content Container -->
    <div class="relative z-10 w-full max-w-md">
      <!-- Logo/Brand -->
      <header v-if="starfield" class="night-brand">
        <div class="night-wordmark">
          <img :src="siteLogo || '/logo.svg'" alt="" width="36" height="36" />
          <h1>{{ siteName }}</h1>
        </div>
        <p class="night-motto" :lang="showAstra ? 'la' : undefined">{{ showAstra ? astra : siteSubtitle }}</p>
        <p v-if="showAstra" lang="zh-CN" class="night-translation">穿越艰险，终抵群星。</p>
      </header>
      <div v-else class="mb-8 text-center">
        <!-- Custom Logo or Default Logo -->
        <template v-if="settingsLoaded">
          <div
            class="mb-4 inline-flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl shadow-lg shadow-primary-500/30"
          >
            <img :src="siteLogo || '/logo.svg'" alt="Logo" class="h-full w-full object-contain" />
          </div>
          <h1 class="text-gradient mb-2 text-3xl font-bold">
            {{ siteName }}
          </h1>
          <p class="text-sm text-gray-500 dark:text-dark-400">
            {{ siteSubtitle }}
          </p>
        </template>
      </div>

      <!-- Card Container -->
      <div :class="starfield ? 'night-form rounded-lg bg-white p-5 shadow-lg sm:p-8 dark:bg-dark-900' : 'card-glass rounded-2xl p-8 shadow-glass'">
        <slot />
      </div>

      <!-- Footer Links -->
      <div class="mt-6 text-center text-sm" :class="{ 'night-footer': starfield }">
        <slot name="footer" />
      </div>

      <!-- Copyright -->
      <div class="mt-8 text-center text-xs" :class="starfield ? 'text-gray-200' : 'text-gray-400 dark:text-dark-500'">
        &copy; {{ currentYear }} {{ siteName }}. All rights reserved.
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useAppStore } from '@/stores'
import { sanitizeUrl } from '@/utils/url'

defineProps<{ starfield?: boolean }>()
const appStore = useAppStore()
const defaultSubtitle = 'Subscription to API Conversion Platform'
const astra = 'Astra, ad astra. Per aspera ad astra.'

const siteName = computed(() => appStore.siteName || 'Sub2API')
const siteLogo = computed(() => sanitizeUrl(appStore.siteLogo || '', { allowRelative: true, allowDataUrl: true }))
const siteSubtitle = computed(() => appStore.cachedPublicSettings?.site_subtitle?.trim() || defaultSubtitle)
const showAstra = computed(() => siteSubtitle.value === defaultSubtitle || siteSubtitle.value.replace(/\s+/g, ' ') === astra)
const settingsLoaded = computed(() => appStore.publicSettingsLoaded)

const currentYear = computed(() => new Date().getFullYear())

onMounted(() => {
  appStore.fetchPublicSettings()
})
</script>

<style scoped>
.starfield-login {
  min-height: 100svh;
  background: #09121f url('@/assets/login-starfield.webp') 65% center / cover no-repeat;
  padding-block: 2rem;
}
.night-brand { margin-bottom: 1.5rem; text-align: center; color: #fffdf6; overflow-wrap: anywhere; }
.night-wordmark { display: flex; align-items: center; justify-content: center; gap: .65rem; }
.night-wordmark img { width: 36px; height: 36px; object-fit: contain; border-radius: 8px; }
.night-wordmark h1 { font: 600 1.5rem/1.2 system-ui, sans-serif; }
.night-motto { margin-top: .875rem; color: #f0d5a4; font: italic 1.5rem/1.25 Georgia, serif; }
.night-translation { margin-top: .4rem; color: #dce2e1; font-size: .875rem; }
.night-footer :deep(p) { color: #e3e6e5; }
.night-footer :deep(a) { color: #f4dfb2; text-decoration: underline; text-underline-offset: .2em; }
@media (max-width: 640px) {
  .starfield-login { padding-block: 1.25rem; background-position: 53% center; }
  .night-brand { margin-bottom: 1rem; }
  .night-motto { font-size: 1.2rem; }
}
.text-gradient {
  @apply bg-gradient-to-r from-primary-600 to-primary-500 bg-clip-text text-transparent;
}
</style>
