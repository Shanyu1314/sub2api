<template>
  <div class="space-y-5">
    <div
      class="rounded-xl border border-primary-100 bg-primary-50/60 p-4 dark:border-primary-900/50 dark:bg-primary-900/10"
    >
      <p class="text-sm leading-6 text-primary-800 dark:text-primary-200">
        {{ t('keys.useKeyModal.quickSetup.description') }}
      </p>
    </div>

    <div class="grid gap-4 md:grid-cols-2">
      <label class="block">
        <span class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
          {{ t('keys.useKeyModal.quickSetup.client') }}
        </span>
        <select v-model="client" class="input w-full">
          <option v-for="option in clientOptions" :key="option.id" :value="option.id">
            {{ option.label }}
          </option>
        </select>
      </label>

      <label class="block">
        <span class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
          {{ t('keys.useKeyModal.quickSetup.model') }}
        </span>
        <div class="relative">
          <input
            v-model.trim="model"
            :list="modelListId"
            type="text"
            class="input w-full pr-10"
            :placeholder="t('keys.useKeyModal.quickSetup.modelPlaceholder')"
          />
          <button
            type="button"
            class="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-gray-400 hover:text-primary-500 disabled:cursor-wait"
            :title="t('keys.useKeyModal.quickSetup.refreshModels')"
            :disabled="modelsLoading"
            @click="loadModels"
          >
            <Icon
              name="refresh"
              size="sm"
              :class="{ 'animate-spin': modelsLoading }"
            />
          </button>
        </div>
        <datalist :id="modelListId">
          <option v-for="item in availableModels" :key="item" :value="item" />
        </datalist>
        <p v-if="modelsLoading" class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
          {{ t('keys.useKeyModal.quickSetup.modelLoading') }}
        </p>
        <p v-else-if="modelsError" class="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
          {{ t('keys.useKeyModal.quickSetup.modelLoadFailed') }}
        </p>
        <p v-else class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
          {{ t('keys.useKeyModal.quickSetup.modelLoaded', { count: availableModels.length }) }}
        </p>
      </label>
    </div>

    <div class="grid gap-4 md:grid-cols-2">
      <div>
        <span class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
          {{ t('keys.useKeyModal.quickSetup.protocol') }}
        </span>
        <select v-if="canSelectProtocol" v-model="protocol" class="input w-full">
          <option value="responses">{{ t('keys.useKeyModal.quickSetup.responses') }}</option>
          <option value="chat">{{ t('keys.useKeyModal.quickSetup.chat') }}</option>
        </select>
        <div
          v-else
          class="flex min-h-[42px] items-center rounded-lg border border-gray-200 bg-gray-50 px-3 text-sm text-gray-600 dark:border-dark-700 dark:bg-dark-800 dark:text-gray-300"
        >
          {{ fixedProtocolLabel }}
        </div>
      </div>

      <div>
        <span class="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
          {{ t('keys.useKeyModal.quickSetup.operatingSystem') }}
        </span>
        <div class="grid grid-cols-2 gap-1 rounded-lg bg-gray-100 p-1 dark:bg-dark-700">
          <button
            type="button"
            class="rounded-md px-3 py-2 text-sm font-medium transition-colors"
            :class="os === 'unix' ? selectedButtonClass : idleButtonClass"
            @click="os = 'unix'"
          >
            {{ t('keys.useKeyModal.quickSetup.unix') }}
          </button>
          <button
            type="button"
            class="rounded-md px-3 py-2 text-sm font-medium transition-colors"
            :class="os === 'windows' ? selectedButtonClass : idleButtonClass"
            @click="os = 'windows'"
          >
            {{ t('keys.useKeyModal.quickSetup.windows') }}
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="client === 'claude'"
      class="rounded-xl border border-gray-200 p-4 dark:border-dark-700"
    >
      <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p class="text-sm font-semibold text-gray-800 dark:text-gray-100">
            {{ t('keys.useKeyModal.quickSetup.claudeMode') }}
          </p>
          <p class="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
            {{
              claudeMode === 'single'
                ? t('keys.useKeyModal.quickSetup.claudeSingleHint')
                : t('keys.useKeyModal.quickSetup.claudeFamilyHint')
            }}
          </p>
        </div>
        <div class="inline-flex w-fit rounded-lg bg-gray-100 p-1 dark:bg-dark-700">
          <button
            type="button"
            class="rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
            :class="claudeMode === 'single' ? selectedButtonClass : idleButtonClass"
            @click="claudeMode = 'single'"
          >
            {{ t('keys.useKeyModal.quickSetup.claudeSingle') }}
          </button>
          <button
            type="button"
            class="rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
            :class="claudeMode === 'family' ? selectedButtonClass : idleButtonClass"
            @click="claudeMode = 'family'"
          >
            {{ t('keys.useKeyModal.quickSetup.claudeFamily') }}
          </button>
        </div>
      </div>

      <div v-if="claudeMode === 'family'" class="mt-4 grid gap-4 md:grid-cols-3">
        <label v-for="field in claudeFields" :key="field.id" class="block">
          <span class="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300">
            {{ field.label }}
          </span>
          <input
            v-model.trim="claudeModels[field.id]"
            :list="modelListId"
            class="input w-full"
            :placeholder="t('keys.useKeyModal.quickSetup.optionalModel')"
          />
        </label>
      </div>
    </div>

    <div>
      <p class="mb-3 text-sm font-semibold text-gray-800 dark:text-gray-100">
        {{ t('keys.useKeyModal.quickSetup.generatedConfig') }}
      </p>
      <div class="space-y-4">
        <div v-for="(file, index) in generatedFiles" :key="`${file.path}-${index}`">
          <p
            v-if="file.hintKey"
            class="mb-1.5 flex items-start gap-1.5 text-xs leading-5 text-amber-600 dark:text-amber-400"
          >
            <Icon name="exclamationCircle" size="sm" class="mt-0.5 flex-shrink-0" />
            {{ t(file.hintKey) }}
          </p>
          <div class="overflow-hidden rounded-xl bg-gray-900 dark:bg-dark-900">
            <div
              class="flex items-center justify-between border-b border-gray-700 bg-gray-800 px-4 py-2 dark:bg-dark-800"
            >
              <span class="min-w-0 truncate font-mono text-xs text-gray-400">{{ file.path }}</span>
              <button
                type="button"
                class="rounded-lg bg-gray-700 px-2.5 py-1 text-xs font-medium text-gray-200 hover:bg-gray-600"
                @click="copyConfig(file.content)"
              >
                {{ t('keys.useKeyModal.copy') }}
              </button>
            </div>
            <pre class="max-h-80 overflow-auto p-4 text-sm text-gray-100"><code>{{ file.content }}</code></pre>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '@/components/icons/Icon.vue'
import { useClipboard } from '@/composables/useClipboard'
import type { GroupPlatform } from '@/types'
import {
  generateClientConfigFiles,
  normalizeClientUrls,
  type ClaudeModelMappings,
  type ClaudeModelMode,
  type ClientId,
  type ClientOS,
  type ClientProtocol
} from './clientConfigs'

interface Props {
  apiKey: string
  baseUrl: string
  platform: GroupPlatform
  allowMessagesDispatch?: boolean
}

const props = defineProps<Props>()
const { t } = useI18n()
const { copyToClipboard } = useClipboard()

const client = ref<ClientId>('claude')
const protocol = ref<ClientProtocol>('responses')
const os = ref<ClientOS>('unix')
const model = ref('')
const availableModels = ref<string[]>([])
const modelsLoading = ref(false)
const modelsError = ref(false)
const claudeMode = ref<ClaudeModelMode>('single')
const claudeModels = ref<ClaudeModelMappings>({ opus: '', sonnet: '', haiku: '' })
let modelRequest: AbortController | null = null

const modelListId = `client-model-options-${Math.random().toString(36).slice(2)}`
const selectedButtonClass =
  'bg-white text-primary-700 shadow-sm dark:bg-dark-800 dark:text-primary-300'
const idleButtonClass =
  'text-gray-600 hover:text-gray-900 dark:text-dark-300 dark:hover:text-white'

const allClientOptions: Array<{ id: ClientId; label: string }> = [
  { id: 'claude', label: 'Claude Code' },
  { id: 'codex', label: 'Codex CLI' },
  { id: 'kimi', label: 'Kimi Code' },
  { id: 'pi', label: 'Pi' },
  { id: 'opencode', label: 'OpenCode' },
  { id: 'gemini', label: 'Gemini CLI' }
]

const allowedClients = computed<ClientId[]>(() => {
  switch (props.platform) {
    case 'anthropic':
      return ['claude', 'kimi', 'pi', 'opencode']
    case 'openai':
      return props.allowMessagesDispatch
        ? ['codex', 'claude', 'kimi', 'pi', 'opencode']
        : ['codex', 'kimi', 'pi', 'opencode']
    case 'gemini':
      return ['gemini', 'kimi', 'pi', 'opencode']
    case 'antigravity':
      return ['claude', 'gemini', 'kimi', 'pi', 'opencode']
    case 'grok':
      return ['codex', 'claude', 'kimi', 'pi', 'opencode']
    case 'composite':
      return ['codex', 'kimi', 'pi', 'opencode']
    default:
      return ['claude', 'kimi', 'pi', 'opencode']
  }
})

const clientOptions = computed(() =>
  allClientOptions.filter((option) => allowedClients.value.includes(option.id))
)

const canSelectProtocol = computed(
  () =>
    ['openai', 'grok', 'composite'].includes(props.platform) &&
    ['kimi', 'pi', 'opencode'].includes(client.value)
)

const fixedProtocolLabel = computed(() => {
  if (client.value === 'codex') return t('keys.useKeyModal.quickSetup.responses')
  if (props.platform === 'gemini') return 'Gemini GenerateContent API'
  if (props.platform === 'anthropic' || props.platform === 'antigravity') {
    return 'Anthropic Messages API'
  }
  return t('keys.useKeyModal.quickSetup.protocolFixed')
})

const claudeFields = computed(
  (): Array<{ id: keyof ClaudeModelMappings; label: string }> => [
    { id: 'opus', label: t('keys.useKeyModal.quickSetup.opus') },
    { id: 'sonnet', label: t('keys.useKeyModal.quickSetup.sonnet') },
    { id: 'haiku', label: t('keys.useKeyModal.quickSetup.haiku') }
  ]
)

const effectiveProtocol = computed<ClientProtocol>(() =>
  client.value === 'codex' ? 'responses' : protocol.value
)

const effectiveBaseUrl = computed(() => props.baseUrl || window.location.origin)

const generatedFiles = computed(() =>
  generateClientConfigFiles({
    client: client.value,
    platform: props.platform,
    baseUrl: effectiveBaseUrl.value,
    apiKey: props.apiKey,
    model: model.value,
    protocol: effectiveProtocol.value,
    os: os.value,
    claudeModelMode: claudeMode.value,
    claudeModels: claudeModels.value
  })
)

function fallbackModel(): string {
  switch (props.platform) {
    case 'openai':
    case 'composite':
      return 'gpt-5.5'
    case 'grok':
      return 'grok-4.5'
    case 'gemini':
      return 'gemini-2.0-flash'
    default:
      return 'claude-sonnet-4-6'
  }
}

function extractModelIds(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return []
  const root = payload as Record<string, unknown>
  const nested = root.data
  const list = Array.isArray(nested)
    ? nested
    : nested && typeof nested === 'object' && Array.isArray((nested as Record<string, unknown>).data)
      ? ((nested as Record<string, unknown>).data as unknown[])
      : []

  const ids = list
    .map((item) =>
      item && typeof item === 'object' && typeof (item as Record<string, unknown>).id === 'string'
        ? ((item as Record<string, unknown>).id as string).trim()
        : ''
    )
    .filter(Boolean)

  return [...new Set(ids)]
}

async function loadModels() {
  modelRequest?.abort()
  modelRequest = new AbortController()
  modelsLoading.value = true
  modelsError.value = false

  try {
    const urls = normalizeClientUrls(effectiveBaseUrl.value, props.platform)
    const response = await fetch(`${urls.openai}/models`, {
      headers: {
        Authorization: `Bearer ${props.apiKey}`,
        Accept: 'application/json'
      },
      signal: modelRequest.signal
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    const ids = extractModelIds(await response.json())
    availableModels.value = ids
    if (!model.value || (ids.length > 0 && !ids.includes(model.value))) {
      model.value = ids[0] || fallbackModel()
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return
    modelsError.value = true
    availableModels.value = []
    if (!model.value) model.value = fallbackModel()
  } finally {
    modelsLoading.value = false
  }
}

async function copyConfig(content: string) {
  await copyToClipboard(content, t('keys.useKeyModal.copied'))
}

watch(
  () => props.platform,
  () => {
    const nextClient = clientOptions.value[0]?.id
    if (nextClient && !allowedClients.value.includes(client.value)) client.value = nextClient
    model.value = ''
  },
  { immediate: true }
)

watch(
  () => [props.apiKey, props.baseUrl, props.platform] as const,
  () => {
    void loadModels()
  },
  { immediate: true }
)

onBeforeUnmount(() => modelRequest?.abort())
</script>
