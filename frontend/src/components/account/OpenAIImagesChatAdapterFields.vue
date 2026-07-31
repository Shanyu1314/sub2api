<template>
  <div class="border-t border-gray-200 pt-4 dark:border-dark-600">
    <div class="flex items-center justify-between gap-4">
      <div>
        <label class="input-label mb-0">{{ t('admin.accounts.openai.imagesViaChat') }}</label>
        <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {{ t('admin.accounts.openai.imagesViaChatDesc') }}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        :aria-checked="enabled"
        data-testid="openai-images-via-chat-toggle"
        :class="[
          'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2',
          enabled ? 'bg-primary-600' : 'bg-gray-200 dark:bg-dark-600'
        ]"
        @click="enabled = !enabled"
      >
        <span
          :class="[
            'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
            enabled ? 'translate-x-5' : 'translate-x-0'
          ]"
        />
      </button>
    </div>

    <div v-if="enabled" class="mt-4">
      <label class="input-label">{{ t('admin.accounts.openai.imagesChatPath') }}</label>
      <input
        v-model.trim="chatPath"
        type="text"
        class="input"
        placeholder="/v1/chat/completions"
        data-testid="openai-images-chat-path"
      />
      <p class="input-hint">{{ t('admin.accounts.openai.imagesChatPathDesc') }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const enabled = defineModel<boolean>('enabled', { required: true })
const chatPath = defineModel<string>('chatPath', { required: true })
const { t } = useI18n()
</script>
