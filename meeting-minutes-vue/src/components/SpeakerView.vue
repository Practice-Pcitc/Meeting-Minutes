<script setup>
import { computed } from 'vue'
import { useStore } from '../composables/useStore'

const store = useStore()

const groups = computed(() => {
  const by = new Map()
  store.entries.value.forEach((e) => {
    const key = e.speakerId || '__none__'
    if (!by.has(key)) by.set(key, [])
    by.get(key).push(e)
  })
  // 按记录数倒序
  const ordered = [...by.entries()].sort((a, b) => b[1].length - a[1].length)

  return ordered.map(([key, entries]) => {
    const isNone = key === '__none__'
    const person = isNone
      ? { id: null, name: '未指定发言人', role: '', color: '#8f959e' }
      : store.getPerson(key)
    return {
      person: person || { id: null, name: '未知', role: '', color: '#8f959e' },
      entries: entries.sort((a, b) => a.time.localeCompare(b.time)),
    }
  })
})

function fmtTime(t) {
  if (!t) return ''
  return t.split(' ')[1] || t.split('T')[1] || t
}
</script>

<template>
  <div class="speaker-view">
    <div v-for="group in groups" :key="group.person.id || 'none'" class="speaker-group">
      <div class="group-header">
        <div class="avatar group-avatar" :style="{ background: group.person.color }">
          {{ group.person.name.charAt(0) }}
        </div>
        <div class="group-info">
          <span class="group-name">{{ group.person.name }}</span>
          <span v-if="group.person.role" class="group-role">{{ group.person.role }}</span>
        </div>
        <span class="badge badge-gray">{{ group.entries.length }} 条</span>
      </div>
      <div class="group-entries">
        <div v-for="e in group.entries" :key="e.id" class="group-entry">
          <span class="entry-time">{{ fmtTime(e.time) }}</span>
          <span v-if="e.topic" class="badge badge-purple">{{ e.topic }}</span>
          <p class="entry-text">{{ e.content }}</p>
        </div>
      </div>
    </div>

    <div v-if="groups.length === 0" class="empty-state">
      <div class="empty-icon"><SvgIcon name="users" :size="48" /></div>
      <p>暂无记录</p>
      <span>添加记录并指定发言人后，会自动按发言人分组</span>
    </div>
  </div>
</template>

<style scoped>
.speaker-view { max-width: 800px; margin: 0 auto; }
.speaker-group {
  background: var(--surface);
  border: 1px solid var(--border-light);
  border-radius: var(--radius);
  margin-bottom: 16px;
  overflow: hidden;
}
.group-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-light);
}
.group-avatar { width: 32px; height: 32px; font-size: .8rem; }
.group-info { display: flex; flex-direction: column; flex: 1; }
.group-name { font-size: .9rem; font-weight: 600; }
.group-role { font-size: .75rem; color: var(--text-muted); }
.group-entries { padding: 4px 0; }
.group-entry {
  padding: 10px 16px;
  border-bottom: 1px solid var(--border-light);
  display: flex;
  align-items: flex-start;
  gap: 8px;
  flex-wrap: wrap;
}
.group-entry:last-child { border-bottom: none; }
.entry-time {
  font-size: .75rem;
  font-weight: 600;
  color: var(--text-muted);
  flex-shrink: 0;
  margin-top: 2px;
}
.entry-text {
  font-size: .88rem;
  line-height: 1.6;
  color: var(--text);
  flex: 1;
  min-width: 0;
  word-break: break-word;
}
.empty-state { text-align: center; padding: 60px 20px; color: var(--text-muted); }
.empty-state .empty-icon { margin-bottom: 12px; color: var(--text-muted); }
.empty-state p { font-size: 1rem; font-weight: 500; color: var(--text-secondary); }
.empty-state span { font-size: .82rem; }
</style>
