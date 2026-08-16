<script setup>
import { computed } from 'vue'
import { useStore } from '../composables/useStore'
import { useNotify } from '../composables/useNotify'

defineProps({
  activeTab: String,
  tabs: Array
})
const emit = defineEmits(['switch-tab', 'toggle-summary', 'open-personnel', 'open-label'])
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
    <div class="meeting-heading">
      <div class="heading-copy">
        <div class="title-line">
          <h1>{{ store.meeting.value.title || '未命名会议' }}</h1>
          <span v-if="activeTab === 'minutes' || activeTab === 'recording'" class="live-chip"><i></i> 会议进行中</span>
        </div>
        <div class="meeting-meta">
          <span><SvgIcon name="calendar" :size="13" />{{ store.meeting.value.date || '未设置日期' }}</span>
          <span v-if="store.meeting.value.startTime || store.meeting.value.endTime"><SvgIcon name="clock" :size="13" />{{ store.meeting.value.startTime || '?' }} - {{ store.meeting.value.endTime || '?' }}</span>
          <span v-if="store.meeting.value.location"><SvgIcon name="map-pin" :size="13" />{{ store.meeting.value.location }}</span>
          <span v-if="store.persons.value.length" class="mini-attendees">
            <b v-for="p in store.persons.value.slice(0, 4)" :key="p.id" :style="{ background: p.color }" :title="p.name">{{ p.name.charAt(0) }}</b>
            <em v-if="store.persons.value.length > 4">+{{ store.persons.value.length - 4 }}</em>
          </span>
        </div>
      </div>
      <div class="header-actions">
        <button class="btn btn-ghost" @click="emit('open-label')"><SvgIcon name="tag" :size="15" /> 标签</button>
        <button class="btn btn-ghost" @click="emit('open-personnel')"><SvgIcon name="users" :size="15" /> 参会人员</button>
        <button class="btn btn-ghost" @click="handleExport" :disabled="!store.entries.value.length" title="导出为 Markdown">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>导出
        </button>
        <button class="btn-icon panel-toggle" title="收起/展开会议助手" @click="emit('toggle-summary')"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18"/></svg></button>
      </div>
    </div>
    <nav class="header-tabs">
      <button v-for="tab in tabs" :key="tab.key" class="header-tab" :class="{ active: activeTab === tab.key }" @click="emit('switch-tab', tab.key)">
        <SvgIcon :name="tab.icon" :size="17" class="tab-icon" />
        {{ tab.label }}
      </button>
    </nav>
  </header>
</template>

<style scoped>
.app-header {
  min-height: 112px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  z-index: 10;
}
.meeting-heading { width: 100%; min-height: 70px; display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 12px 24px 8px; }
.heading-copy { min-width: 0; }
.title-line { display: flex; align-items: center; gap: 10px; }
.title-line h1 { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 1.25rem; line-height: 1.4; font-weight: 750; color: #14213a; }
.live-chip { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; color: #e34444; background: #fff0f0; border-radius: 999px; font-size: .7rem; font-weight: 650; white-space: nowrap; }
.live-chip i { width: 6px; height: 6px; border-radius: 50%; background: #ef4444; }
.meeting-meta { display: flex; align-items: center; gap: 16px; margin-top: 5px; color: var(--text-secondary); font-size: .76rem; }
.meeting-meta > span { display: inline-flex; align-items: center; gap: 5px; }
.mini-attendees { margin-left: 3px; }
.mini-attendees b,.mini-attendees em { width: 24px; height: 24px; display: inline-grid; place-items: center; margin-left: -5px; border: 2px solid #fff; border-radius: 50%; color: #fff; font-size: .65rem; font-style: normal; }
.mini-attendees em { background: #eef2f8; color: var(--text-secondary); }

.header-tabs {
  width: 100%;
  display: flex;
  align-items: center;
  height: 42px;
  padding: 0 24px;
}
.header-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 100%;
  padding: 0 18px;
  font-size: .88rem;
  color: var(--text-secondary);
  transition: var(--transition);
  position: relative;
  border-bottom: 2px solid transparent;
}
.header-tab:hover { color: var(--primary); }
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
.header-actions .btn { height: 36px; }
.panel-toggle { width: 36px; height: 36px; border: 1px solid var(--border); }
@media (max-width: 900px) { .meeting-meta span:nth-child(3),.mini-attendees { display: none; } .header-actions .btn:nth-child(-n+2) { display: none; } }
</style>
