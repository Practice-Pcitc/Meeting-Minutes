<script setup>
import { computed, reactive, ref } from 'vue'
import AppSelect from './AppSelect.vue'
import { useAuth } from '../composables/useAuth'
import { useNotify } from '../composables/useNotify'

const props = defineProps({
  initialSection: { type: String, default: 'providers' },
})
const emit = defineEmits(['close'])
const {
  auth,
  updatePreferences,
  createAiProvider,
  updateAiProvider,
  deleteAiProvider,
  setDefaultAiProvider,
} = useAuth()
const notify = useNotify()
const section = ref(props.initialSection === 'speech' ? 'speech' : 'providers')
const speechProvider = ref(auth.user?.preferences?.transcriptionProvider || 'funasr')
const funasrEndpoint = ref(auth.user?.preferences?.funasrEndpoint || 'http://127.0.0.1:10095/v1/audio/transcriptions')
const savingSpeech = ref(false)
const savingProvider = ref(false)
const changingDefault = ref('')
const showProviderForm = ref(false)
const editingId = ref('')
const template = ref('qwen')
const providerForm = reactive({ name: '', baseUrl: '', model: '', apiKey: '' })

const engines = [
  { value: 'funasr', label: 'FunASR（本地）', description: '音频保留在本机，适合中文会议' },
  { value: 'openai', label: 'OpenAI（云端）', description: '使用服务器环境变量配置的 OpenAI API' },
]
const providerTemplates = [
  { value: 'qwen', label: '阿里云百炼（千问）', name: '阿里云百炼', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { value: 'deepseek', label: 'DeepSeek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash' },
  { value: 'openai', label: 'OpenAI', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5-mini' },
  { value: 'custom', label: '其他 OpenAI 兼容服务', name: '自定义供应商', baseUrl: '', model: '' },
]

const providers = computed(() => auth.user?.preferences?.aiProviders || [])
const defaultProviderId = computed(() => auth.user?.preferences?.defaultAiProviderId || '')

function applyTemplate(value = template.value) {
  const preset = providerTemplates.find(item => item.value === value)
  if (!preset || editingId.value) return
  providerForm.name = preset.name
  providerForm.baseUrl = preset.baseUrl
  providerForm.model = preset.model
}

function openCreateForm() {
  editingId.value = ''
  template.value = 'qwen'
  providerForm.apiKey = ''
  showProviderForm.value = true
  applyTemplate()
}

function openEditForm(provider) {
  editingId.value = provider.id
  template.value = 'custom'
  Object.assign(providerForm, {
    name: provider.name,
    baseUrl: provider.baseUrl,
    model: provider.model,
    apiKey: '',
  })
  showProviderForm.value = true
}

function closeProviderForm() {
  showProviderForm.value = false
  editingId.value = ''
}

async function saveProvider() {
  if (!providerForm.name || !providerForm.baseUrl || !providerForm.model) {
    notify.error('请填写供应商名称、接口地址和模型名称')
    return
  }
  savingProvider.value = true
  try {
    const payload = { ...providerForm }
    const hadProviders = providers.value.length > 0
    if (editingId.value) {
      await updateAiProvider(editingId.value, payload)
      notify.success('AI 供应商已更新')
    } else {
      await createAiProvider(payload)
      notify.success(hadProviders ? 'AI 供应商已添加' : 'AI 供应商已添加并设为默认')
    }
    closeProviderForm()
  } catch (error) { notify.error(error.message) }
  finally { savingProvider.value = false }
}

async function makeDefault(provider) {
  changingDefault.value = provider.id
  try {
    await setDefaultAiProvider(provider.id)
    notify.success(`已将「${provider.name}」设为默认供应商`)
  } catch (error) { notify.error(error.message) }
  finally { changingDefault.value = '' }
}

async function removeProvider(provider) {
  const confirmed = await notify.confirm({
    title: '删除 AI 供应商',
    message: `确定删除「${provider.name}」吗？保存的 API 密钥也会一并删除。`,
    confirmText: '删除',
    danger: true,
  })
  if (!confirmed) return
  try {
    await deleteAiProvider(provider.id)
    notify.success('AI 供应商已删除')
    if (editingId.value === provider.id) closeProviderForm()
  } catch (error) { notify.error(error.message) }
}

async function saveSpeech() {
  savingSpeech.value = true
  try {
    await updatePreferences({ transcriptionProvider: speechProvider.value, funasrEndpoint: funasrEndpoint.value })
    notify.success('默认语音引擎已更新')
  } catch (error) { notify.error(error.message) }
  finally { savingSpeech.value = false }
}
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal" role="dialog" aria-modal="true" aria-label="用户设置">
      <div class="modal-header">
        <div><h3><SvgIcon name="settings" :size="18" /> 用户设置</h3><p>管理 AI 总结供应商与录音转写引擎</p></div>
        <button class="close-button" aria-label="关闭" @click="emit('close')">×</button>
      </div>
      <div class="setting-tabs">
        <button :class="{ active: section === 'providers' }" @click="section = 'providers'"><SvgIcon name="sparkles" :size="15" /> AI 供应商</button>
        <button :class="{ active: section === 'speech' }" @click="section = 'speech'"><SvgIcon name="microphone" :size="15" /> 语音转写</button>
      </div>

      <div v-if="section === 'providers'" class="modal-body provider-body">
        <div class="section-heading">
          <div><strong>AI 总结供应商</strong><span>生成总结时使用下方标记为“默认”的服务</span></div>
          <button v-if="!showProviderForm" class="btn btn-primary btn-sm" @click="openCreateForm">＋ 添加供应商</button>
        </div>

        <div v-if="showProviderForm" class="provider-form">
          <div class="form-title"><strong>{{ editingId ? '编辑供应商' : '添加供应商' }}</strong><button @click="closeProviderForm">取消</button></div>
          <div v-if="!editingId" class="form-row"><label>供应商模板</label><AppSelect v-model="template" :options="providerTemplates" :clearable="false" @update:model-value="applyTemplate" /></div>
          <div class="form-grid">
            <div class="form-row"><label>显示名称</label><input v-model.trim="providerForm.name" class="input" placeholder="例如：公司百炼账号" /></div>
            <div class="form-row"><label>模型名称</label><input v-model.trim="providerForm.model" class="input" placeholder="例如：qwen-plus" /></div>
          </div>
          <div class="form-row"><label>OpenAI 兼容接口地址</label><input v-model.trim="providerForm.baseUrl" class="input" placeholder="https://example.com/v1" /><small>填写 Base URL；系统会自动追加 /chat/completions。也可直接填写完整地址。</small></div>
          <div class="form-row"><label>API Key</label><input v-model.trim="providerForm.apiKey" class="input" type="password" autocomplete="new-password" :placeholder="editingId ? '留空则保留原密钥' : '输入供应商 API Key'" /><small>密钥只保存在后端，不会返回到浏览器。</small></div>
          <button class="btn btn-primary form-save" :disabled="savingProvider" @click="saveProvider">{{ savingProvider ? '保存中…' : '保存供应商' }}</button>
        </div>

        <div v-if="providers.length" class="provider-list">
          <article v-for="item in providers" :key="item.id" class="provider-card" :class="{ default: item.id === defaultProviderId }">
            <div class="provider-main">
              <div class="provider-name"><strong>{{ item.name }}</strong><span v-if="item.id === defaultProviderId" class="default-badge">默认</span></div>
              <span class="provider-model">{{ item.model }}</span>
              <small>{{ item.baseUrl }}</small>
              <span class="key-status" :class="{ configured: item.hasApiKey }">{{ item.hasApiKey ? '密钥已配置' : '未配置密钥' }}</span>
            </div>
            <div class="provider-actions">
              <button v-if="item.id !== defaultProviderId" :disabled="changingDefault === item.id" @click="makeDefault(item)">设为默认</button>
              <button @click="openEditForm(item)">编辑</button>
              <button class="danger" @click="removeProvider(item)">删除</button>
            </div>
          </article>
        </div>
        <div v-else-if="!showProviderForm" class="empty-providers"><SvgIcon name="sparkles" :size="26" /><strong>还没有 AI 供应商</strong><p>添加一个 OpenAI 兼容服务后，就可以为会议生成并保存 AI 总结。</p><button class="btn btn-primary" @click="openCreateForm">添加第一个供应商</button></div>
      </div>

      <div v-else class="modal-body">
        <div class="form-row"><label>默认语音引擎</label><AppSelect v-model="speechProvider" :options="engines" :clearable="false" /></div>
        <div v-if="speechProvider === 'funasr'" class="form-row"><label>FunASR 转写接口</label><input v-model.trim="funasrEndpoint" class="input" placeholder="http://127.0.0.1:10095/v1/audio/transcriptions" /><small>填写 OpenAI 兼容的完整转写接口地址。本机服务请保持 FunASR 正在运行。</small></div>
        <div class="engine-note" :class="speechProvider"><SvgIcon name="lightbulb" :size="16" /><span>{{ speechProvider === 'funasr' ? '录音将发送到你配置的本地服务，不经过 OpenAI。' : '录音将上传到 OpenAI；API 密钥仍由服务器环境变量统一管理。' }}</span></div>
        <button class="btn btn-primary speech-save" :disabled="savingSpeech || (speechProvider === 'funasr' && !funasrEndpoint)" @click="saveSpeech">{{ savingSpeech ? '保存中…' : '保存语音设置' }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay { position: fixed; inset: 0; z-index: 800; display: flex; align-items: center; justify-content: center; padding: 20px; background: rgba(15,23,42,.52); }
.modal { width: min(720px,100%); max-height: min(820px,calc(100vh - 40px)); display: flex; flex-direction: column; overflow: visible; border-radius: var(--radius-lg); background: var(--surface); box-shadow: var(--shadow-lg); }
.modal-header { display: flex; align-items: flex-start; justify-content: space-between; padding: 18px 20px 15px; border-bottom: 1px solid var(--border); }
.modal-header h3 { display: flex; align-items: center; gap: 7px; font-size: 1rem; }.modal-header p { margin-top: 4px; color: var(--text-muted); font-size: .75rem; }
.close-button { width: 28px; height: 28px; color: var(--text-muted); border-radius: 6px; font-size: 1.25rem; }.close-button:hover { background: var(--bg-secondary); }
.setting-tabs { display: flex; gap: 6px; padding: 10px 20px 0; border-bottom: 1px solid var(--border); }.setting-tabs button { display: flex; align-items: center; gap: 6px; padding: 9px 12px 10px; border-bottom: 2px solid transparent; color: var(--text-muted); font-size: .8rem; }.setting-tabs button.active { border-color: var(--primary); color: var(--primary); font-weight: 700; }
.modal-body { display: flex; flex-direction: column; gap: 18px; min-height: 0; overflow-y: auto; padding: 20px; }.provider-body { gap: 14px; }
.section-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; }.section-heading div { display: flex; flex-direction: column; gap: 3px; }.section-heading strong { font-size: .9rem; }.section-heading span { color: var(--text-muted); font-size: .73rem; }.btn-sm { padding: 7px 10px; font-size: .76rem; }
.provider-form { display: flex; flex-direction: column; gap: 13px; padding: 15px; border: 1px solid #cdd8ff; border-radius: 10px; background: #f8faff; }.form-title { display: flex; align-items: center; justify-content: space-between; }.form-title button { color: var(--text-muted); font-size: .74rem; }.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.form-row { display: flex; flex-direction: column; gap: 7px; }.form-row label { color: var(--text-secondary); font-size: .78rem; font-weight: 650; }.form-row small { overflow-wrap: anywhere; color: var(--text-muted); font-size: .7rem; line-height: 1.5; }.form-save,.speech-save { align-self: flex-end; }
.provider-list { display: flex; flex-direction: column; gap: 9px; }.provider-card { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 13px 14px; border: 1px solid var(--border); border-radius: 9px; }.provider-card.default { border-color: #aebfff; background: #f8faff; }.provider-main { min-width: 0; display: grid; grid-template-columns: auto auto; align-items: center; gap: 4px 8px; }.provider-name { display: flex; align-items: center; gap: 6px; }.provider-name strong { font-size: .84rem; }.default-badge { padding: 2px 6px; border-radius: 999px; color: var(--primary); background: #e8edff; font-size: .65rem; font-weight: 700; }.provider-model { color: var(--text-secondary); font-size: .75rem; }.provider-main small { grid-column: 1 / -1; max-width: 420px; overflow: hidden; color: var(--text-muted); font-size: .69rem; text-overflow: ellipsis; white-space: nowrap; }.key-status { grid-column: 1 / -1; color: #b45309; font-size: .68rem; }.key-status.configured { color: #168457; }.provider-actions { display: flex; flex-shrink: 0; gap: 5px; }.provider-actions button { padding: 5px 7px; border-radius: 5px; color: var(--primary); font-size: .7rem; }.provider-actions button:hover { background: #eef2ff; }.provider-actions .danger { color: var(--danger); }.provider-actions .danger:hover { background: #fff0ee; }
.empty-providers { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 32px 20px; border: 1px dashed var(--border); border-radius: 10px; color: var(--text-muted); text-align: center; }.empty-providers strong { color: var(--text-secondary); font-size: .88rem; }.empty-providers p { max-width: 420px; font-size: .74rem; line-height: 1.6; }
.engine-note { display: flex; align-items: flex-start; gap: 8px; padding: 11px 12px; border-radius: 8px; color: #3158a8; background: #eef4ff; font-size: .76rem; line-height: 1.55; }.engine-note.funasr { color: #16734a; background: #ecf9f2; }
@media (max-width: 620px) { .form-grid { grid-template-columns: 1fr; }.provider-card { align-items: flex-start; flex-direction: column; }.provider-actions { align-self: stretch; }.provider-actions button { flex: 1; }.section-heading { align-items: flex-start; flex-direction: column; } }
</style>
