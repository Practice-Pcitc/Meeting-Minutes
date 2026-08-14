<script setup>
import { computed } from 'vue'
import { useStore } from '../composables/useStore'
import { useNotify } from '../composables/useNotify'

defineProps({
  activeTab: String,
  tabs: Array
})
const emit = defineEmits(['switch-tab', 'toggle-summary', 'open-personnel'])
const store = useStore()
const notify = useNotify()

const sortedEntries = computed(() =>
  [...store.entries.value].sort((a, b) => a.time.localeCompare(b.time))
)

function speakerName(e) {
  const p = e.speakerId ? store.getPerson(e.speakerId) : null
  return p ? p.name : '未指定'
}

function fmtTime(t) {
  if (!t) return ''
  return t.split(' ')[1] || t.split('T')[1] || t
}

function buildMarkdown() {
  const m = store.meeting.value
  const lines = []
  lines.push(`# ${m.title || '未命名会议'}`)
  lines.push('')
  const meta = []
  if (m.date) meta.push(`📅 ${m.date}`)
  if (m.startTime || m.endTime) meta.push(`🕐 ${m.startTime || '?'} - ${m.endTime || '?'}`)
  if (m.location) meta.push(`📍 ${m.location}`)
  if (meta.length) lines.push(meta.join('  ·  '))
  lines.push('')
  if (store.persons.value.length) {
    lines.push(`## 参会人员 (${store.persons.value.length})`)
    store.persons.value.forEach((p) => {
      lines.push(`- ${p.name}${p.role ? `（${p.role}）` : ''}`)
    })
    lines.push('')
  }
  const todos = store.todos.value
  if (todos.length) {
    lines.push('## 待办事项')
    todos.forEach((t) => {
      lines.push(`- ${t.done ? '[x]' : '[ ]'} ${t.content}${t.assigneeId ? ` @${speakerName({ speakerId: t.assigneeId })}` : ''}`)
    })
    lines.push('')
  }
  lines.push('## 会议记录')
  sortedEntries.value.forEach((e) => {
    const topicPrefix = e.topic ? `**[${e.topic}]** ` : ''
    lines.push(`- ${fmtTime(e.time)} · ${speakerName(e)}：${topicPrefix}${e.content}`)
  })
  lines.push('')
  lines.push(`_导出时间：${new Date().toLocaleString()}_`)
  return lines.join('\n')
}

function handleExport() {
  const md = buildMarkdown()
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const safeTitle = (store.meeting.value.title || '会议纪要').replace(/[\\/:*?"<>|]/g, '_')
  a.download = `${safeTitle}_${store.meeting.value.date || ''}.md`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

async function handleShare() {
  const md = buildMarkdown()
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(md)
      notify.success('会议纪要已复制到剪贴板')
    } else {
      // 回退方案
      const ta = document.createElement('textarea')
      ta.value = md
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      notify.success('会议纪要已复制到剪贴板')
    }
  } catch (e) {
    notify.error('复制失败：' + e.message + '，可改用“导出”按钮保存为文件。')
  }
}
</script>

<template>
  <header class="app-header">
    <nav class="header-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="header-tab"
        :class="{ active: activeTab === tab.key }"
        @click="emit('switch-tab', tab.key)"
      >
        <SvgIcon :name="tab.icon" :size="15" class="tab-icon" />
        {{ tab.label }}
      </button>
    </nav>

    <div class="header-actions">
      <button class="btn-icon" title="收起/展开摘要面板" @click="emit('toggle-summary')">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18"/></svg>
      </button>
      <button class="btn btn-ghost btn-sm" @click="handleExport" :disabled="!store.entries.value.length" title="导出为 Markdown">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        导出
      </button>
      <button class="btn btn-ghost btn-sm" @click="handleShare" :disabled="!store.entries.value.length" title="复制 Markdown 到剪贴板">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
        分享
      </button>
    </div>
  </header>
</template>

<style scoped>
.app-header {
  height: var(--header-h);
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  flex-shrink: 0;
  z-index: 10;
}

.header-tabs {
  display: flex;
  align-items: center;
  height: 100%;
  margin-left: -20px;
}
.header-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 100%;
  padding: 0 20px;
  font-size: .88rem;
  color: var(--text-secondary);
  transition: var(--transition);
  position: relative;
  border-bottom: 2px solid transparent;
}
.header-tab:hover { color: var(--text); background: var(--bg-secondary); }
.header-tab.active {
  color: var(--primary);
  font-weight: 600;
  border-bottom-color: var(--primary);
  background: transparent;
}
.header-tab.active:hover { background: transparent; }
.tab-icon { color: currentColor; }

.header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
</style>
