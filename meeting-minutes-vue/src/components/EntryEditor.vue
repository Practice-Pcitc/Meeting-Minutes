<script setup>
import { ref, computed } from 'vue'
import { useStore } from '../composables/useStore'

const store = useStore()

function nowDateTimeLocal() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const content = ref('')
const time = ref(nowDateTimeLocal())
const speakerId = ref('')
const topic = ref('')
const isExpanded = ref(false)
const submitting = ref(false)
const errorMsg = ref('')

const topicNames = computed(() => store.topics.value.map(t => t.name))

function setNow() { time.value = nowDateTimeLocal() }

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
    time.value = nowDateTimeLocal()
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
      <div class="speaker-select-wrap">
        <select v-model="speakerId" class="speaker-select" :disabled="store.persons.value.length === 0">
          <option value="">{{ store.persons.value.length === 0 ? '请先添加人员' : '选择发言人' }}</option>
          <option v-for="p in store.persons.value" :key="p.id" :value="p.id">
            {{ p.name }}{{ p.role ? ' · ' + p.role : '' }}
          </option>
        </select>
      </div>

      <input type="datetime-local" v-model="time" class="time-input" />

      <input
        v-model="topic"
        class="topic-input"
        list="editor-topics"
        placeholder="主题（可后补）"
      />
      <datalist id="editor-topics">
        <option v-for="t in topicNames" :key="t" :value="t"></option>
      </datalist>

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
  border-top: 1px solid var(--border);
  padding: 12px 24px;
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
.speaker-select {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 6px 10px;
  font-size: .82rem;
  background: var(--surface);
  color: var(--text-secondary);
  cursor: pointer;
  max-width: 180px;
}
.speaker-select:focus { outline: none; border-color: var(--primary); }
.speaker-select:disabled { opacity: .5; cursor: not-allowed; }
.time-input {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 6px 10px;
  font-size: .8rem;
  color: var(--text-secondary);
}
.topic-input {
  flex: 1;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 6px 10px;
  font-size: .82rem;
  min-width: 0;
}
.topic-input:focus { outline: none; border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-light); }

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
