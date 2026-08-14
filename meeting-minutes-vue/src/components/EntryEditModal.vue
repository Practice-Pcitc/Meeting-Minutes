<script setup>
import { ref, watch } from 'vue'
import { useStore } from '../composables/useStore'
import { useNotify } from '../composables/useNotify'

const props = defineProps({ entry: Object })
const emit = defineEmits(['close'])
const store = useStore()
const notify = useNotify()

const form = ref({
  time: (props.entry.time || '').replace(' ', 'T'),
  content: props.entry.content,
  speakerId: props.entry.speakerId || '',
  topic: props.entry.topic || ''
})
const saving = ref(false)
const errorMsg = ref('')

async function save() {
  if (!form.value.content.trim() || saving.value) return
  saving.value = true
  errorMsg.value = ''
  try {
    await store.updateEntry(props.entry.id, {
      time: form.value.time.replace('T', ' '),
      content: form.value.content,
      speakerId: form.value.speakerId || null,
      topic: form.value.topic.trim()
    })
    emit('close')
  } catch (e) {
    errorMsg.value = e.message
  } finally {
    saving.value = false
  }
}

async function remove() {
  const confirmed = await notify.confirm({ title: '删除会议记录', message: '确定删除这条会议记录吗？删除后无法恢复。', confirmText: '删除', danger: true })
  if (!confirmed) return
  try {
    await store.removeEntry(props.entry.id)
    notify.success('记录已删除')
    emit('close')
  } catch (e) {
    errorMsg.value = e.message
  }
}

const topicNames = ref([])
watch(
  () => store.topics.value,
  (v) => { topicNames.value = v.map(t => t.name) },
  { immediate: true }
)
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal">
      <div class="modal-header">
        <h3>编辑记录</h3>
        <button class="btn-icon" @click="emit('close')">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="modal-body">
        <div class="form-row">
          <label>时间</label>
          <input type="datetime-local" v-model="form.time" class="input" />
        </div>
        <div class="form-row">
          <label>内容</label>
          <textarea v-model="form.content" class="textarea" rows="4" placeholder="会议内容..."></textarea>
        </div>
        <div class="form-row">
          <label>发言人</label>
          <select v-model="form.speakerId" class="input">
            <option value="">未指定</option>
            <option v-for="p in store.persons.value" :key="p.id" :value="p.id">
              {{ p.name }}{{ p.role ? ' · ' + p.role : '' }}
            </option>
          </select>
        </div>
        <div class="form-row">
          <label>主题</label>
          <input v-model="form.topic" class="input" list="edit-topics" placeholder="选择或输入主题" />
          <datalist id="edit-topics">
            <option v-for="t in topicNames" :key="t" :value="t"></option>
          </datalist>
        </div>
      </div>
      <div v-if="errorMsg" class="modal-error">{{ errorMsg }}</div>
      <div class="modal-footer">
        <button class="btn btn-danger" @click="remove">删除</button>
        <div class="footer-right">
          <button class="btn btn-ghost" @click="emit('close')">取消</button>
          <button class="btn btn-primary" :disabled="!form.content.trim() || saving" @click="save">
            {{ saving ? '保存中…' : '保存' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, .5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  animation: modal-fade-in .15s ease;
}
@keyframes modal-fade-in { from { opacity: 0; } to { opacity: 1; } }

.modal {
  background: var(--surface);
  border-radius: var(--radius-lg);
  width: 520px;
  max-width: 90vw;
  max-height: 85vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-lg);
  animation: modal-pop-in .2s ease;
}
@keyframes modal-pop-in { from { opacity: 0; transform: scale(.96); } to { opacity: 1; transform: scale(1); } }

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.modal-header h3 { font-size: 1rem; }
.modal-body { padding: 20px; display: flex; flex-direction: column; gap: 14px; overflow-y: auto; }
.form-row { display: flex; flex-direction: column; gap: 6px; }
.form-row label { font-size: .8rem; font-weight: 600; color: var(--text-secondary); }
.modal-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}
.footer-right { display: flex; gap: 8px; }
.modal-error { padding: 0 20px 10px; color: var(--danger); font-size: .8rem; }
</style>
