<script setup>
import { ref } from 'vue'
import AppSelect from './AppSelect.vue'
import { useAuth } from '../composables/useAuth'
import { useNotify } from '../composables/useNotify'

const emit = defineEmits(['close'])
const { auth, updatePreferences } = useAuth()
const notify = useNotify()
const provider = ref(auth.user?.preferences?.transcriptionProvider || 'funasr')
const funasrEndpoint = ref(auth.user?.preferences?.funasrEndpoint || 'http://127.0.0.1:10095/v1/audio/transcriptions')
const saving = ref(false)
const engines = [
  { value: 'funasr', label: 'FunASR（本地）', description: '音频保留在本机，适合中文会议' },
  { value: 'openai', label: 'OpenAI（云端）', description: '使用服务器配置的 OpenAI API' },
]

async function save() {
  saving.value = true
  try {
    await updatePreferences({ transcriptionProvider: provider.value, funasrEndpoint: funasrEndpoint.value })
    notify.success('默认语音引擎已更新')
    emit('close')
  } catch (error) { notify.error(error.message) }
  finally { saving.value = false }
}
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal" role="dialog" aria-modal="true" aria-label="语音转写设置">
      <div class="modal-header"><div><h3><SvgIcon name="microphone" :size="18" /> 语音转写设置</h3><p>设置录音完成后默认使用的转写引擎</p></div><button class="close-button" aria-label="关闭" @click="emit('close')">×</button></div>
      <div class="modal-body">
        <div class="form-row"><label>默认语音引擎</label><AppSelect v-model="provider" :options="engines" :clearable="false" /></div>
        <div v-if="provider === 'funasr'" class="form-row"><label>FunASR 转写接口</label><input v-model.trim="funasrEndpoint" class="input" placeholder="http://127.0.0.1:10095/v1/audio/transcriptions" /><small>填写 OpenAI 兼容的完整接口地址。本机服务请保持 FunASR 正在运行。</small></div>
        <div class="engine-note" :class="provider"><SvgIcon name="lightbulb" :size="16" /><span>{{ provider === 'funasr' ? '录音将发送到你配置的本地服务，不经过 OpenAI。' : '录音将上传到 OpenAI；API 密钥仍由服务器环境变量统一管理。' }}</span></div>
      </div>
      <div class="modal-footer"><button class="btn btn-ghost" @click="emit('close')">取消</button><button class="btn btn-primary" :disabled="saving || (provider === 'funasr' && !funasrEndpoint)" @click="save">{{ saving ? '保存中…' : '保存设置' }}</button></div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay { position: fixed; inset: 0; z-index: 800; display: flex; align-items: center; justify-content: center; padding: 20px; background: rgba(15,23,42,.52); }
.modal { width: min(520px,100%); overflow: visible; border-radius: var(--radius-lg); background: var(--surface); box-shadow: var(--shadow-lg); }
.modal-header { display: flex; align-items: flex-start; justify-content: space-between; padding: 18px 20px; border-bottom: 1px solid var(--border); }
.modal-header h3 { display: flex; align-items: center; gap: 7px; font-size: 1rem; }.modal-header p { margin-top: 4px; color: var(--text-muted); font-size: .75rem; }
.close-button { width: 28px; height: 28px; color: var(--text-muted); border-radius: 6px; font-size: 1.25rem; }.close-button:hover { background: var(--bg-secondary); }
.modal-body { display: flex; flex-direction: column; gap: 18px; padding: 20px; }.form-row { display: flex; flex-direction: column; gap: 7px; }.form-row label { color: var(--text-secondary); font-size: .82rem; font-weight: 600; }.form-row small { color: var(--text-muted); font-size: .72rem; line-height: 1.5; }
.engine-note { display: flex; align-items: flex-start; gap: 8px; padding: 11px 12px; border-radius: 8px; color: #3158a8; background: #eef4ff; font-size: .76rem; line-height: 1.55; }.engine-note.funasr { color: #16734a; background: #ecf9f2; }
.modal-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 14px 20px; border-top: 1px solid var(--border); }
</style>
