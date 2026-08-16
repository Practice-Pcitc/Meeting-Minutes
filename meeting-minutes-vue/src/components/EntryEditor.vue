<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useStore } from '../composables/useStore'
import DateTimePicker from './DateTimePicker.vue'
import AppSelect from './AppSelect.vue'

const store = useStore()

function nowDateTimeLocal() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const content = ref('')
const time = ref(nowDateTimeLocal())
const isTimeManual = ref(false)
const speakerId = ref('')
const topic = ref('')
const isExpanded = ref(false)
const submitting = ref(false)
const errorMsg = ref('')

const topicNames = computed(() => store.topics.value.map(t => t.name))
const speakerOptions = computed(() => store.persons.value.map((person) => ({ value: person.id, label: person.name, description: person.role })))
const topicOptions = computed(() => topicNames.value.map((name) => ({ value: name, label: name })))

let clockTimer = null

function updateCurrentTime() {
  if (!isTimeManual.value) time.value = nowDateTimeLocal()
}

function setNow() {
  isTimeManual.value = false
  time.value = nowDateTimeLocal()
}

function handleSpeakerShortcut(e) {
  if (!e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return
  const shortcutNumber = Number(e.key)
  if (shortcutNumber < 1 || shortcutNumber > 9) return
  const person = store.persons.value[shortcutNumber - 1]
  if (!person) return
  e.preventDefault()
  speakerId.value = person.id
}

onMounted(() => {
  updateCurrentTime()
  clockTimer = window.setInterval(updateCurrentTime, 1000)
  window.addEventListener('keydown', handleSpeakerShortcut)
})

onBeforeUnmount(() => {
  if (clockTimer) window.clearInterval(clockTimer)
  window.removeEventListener('keydown', handleSpeakerShortcut)
})

async function handleSubmit() {
  const text = content.value.trim()
  if (!text || submitting.value) return
  submitting.value = true
  errorMsg.value = ''
  try {
    // time 是 datetime-local 格式 "YYYY-MM-DDTHH:mm"，存到后端时换成 "YYYY-MM-DD HH:mm"
    const formattedTime = time.value.replace('T', ' ')
    await store.addEntry({
      content: text,
      time: formattedTime,
      speakerId: speakerId.value || null,
      topic: topic.value.trim(),
      attendees: [],
    })
    content.value = ''
    topic.value = ''
    setNow()
    // speakerId 保持选中，方便连续记录
  } catch (e) {
    errorMsg.value = e.message
  } finally {
    submitting.value = false
  }
}

function handleKeydown(e) {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault()
    handleSubmit()
  }
}

function focusEditor() { isExpanded.value = true }
</script>

<template>
  <div class="entry-editor" :class="{ expanded: isExpanded }">
    <div class="editor-row">
      <div class="speaker-select-wrap"><AppSelect v-model="speakerId" :options="speakerOptions" :disabled="!speakerOptions.length" :placeholder="speakerOptions.length ? '选择发言人' : '请先添加人员'" /></div>

      <div class="time-input"><DateTimePicker v-model="time" mode="datetime" @update:model-value="isTimeManual = true" /></div>

      <div class="topic-input"><AppSelect v-model="topic" :options="topicOptions" allow-custom placeholder="选择或输入主题" /></div>

      <button class="btn-icon" title="使用当前时间" @click="setNow">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      </button>
    </div>

    <div class="editor-main">
      <textarea
        v-model="content"
        class="editor-textarea"
        :placeholder="store.persons.value.length === 0
          ? '请先在左侧添加参会人员，然后开始记录内容...'
          : (isExpanded ? '输入会议内容... (Ctrl+Enter 提交)' : '记录会议内容...')"
        rows="1"
        @focus="focusEditor"
        @keydown="handleKeydown"
      ></textarea>
      <button
        class="btn btn-primary submit-btn"
        :disabled="!content.trim() || submitting"
        @click="handleSubmit"
      >
        ＋ 添加
      </button>
    </div>

    <div v-if="errorMsg" class="error-msg">{{ errorMsg }}</div>

    <div v-if="isExpanded" class="editor-hint">
      <span class="hint-text">
        <SvgIcon name="lightbulb" :size="13" />
        Ctrl + Enter 快速提交 · 发言人选中后会保持，便于连续记录
      </span>
    </div>
  </div>
</template>

<style scoped>
.entry-editor {
  flex-shrink: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px 14px;
  margin-bottom: 14px;
  transition: var(--transition);
}
.entry-editor.expanded { box-shadow: 0 -4px 12px rgba(0,0,0,.04); }

.editor-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.speaker-select-wrap { flex-shrink: 0; }
.speaker-select-wrap { width: 170px; }
.time-input {
  width: 310px;
  flex-shrink: 0;
}
.topic-input {
  min-width: 180px;
  flex: 1;
}

.editor-main { display: flex; gap: 8px; align-items: flex-end; }
.editor-textarea {
  flex: 1;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 10px 14px;
  font-size: .9rem;
  line-height: 1.6;
  resize: none;
  min-height: 42px;
  max-height: 200px;
  transition: var(--transition);
}
.editor-textarea:focus { outline: none; border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-light); }
.entry-editor.expanded .editor-textarea { min-height: 80px; resize: vertical; }
.submit-btn { flex-shrink: 0; height: 42px; }
.submit-btn:disabled { opacity: .4; cursor: not-allowed; }

.error-msg {
  margin-top: 6px;
  font-size: .78rem;
  color: var(--danger);
}

.editor-hint { margin-top: 8px; font-size: .75rem; color: var(--text-muted); }
.hint-text { display: inline-flex; align-items: center; gap: 4px; }
</style>
