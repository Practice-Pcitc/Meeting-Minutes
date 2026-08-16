<script setup>
import { computed } from 'vue'
import { useStore } from '../composables/useStore'

const store = useStore()

const topicNameList = computed(() => store.topics.value.map(t => t.name))

const groups = computed(() => {
  const byTopic = new Map()
  store.entries.value.forEach((e) => {
    const key = e.topic || '__未分类__'
    if (!byTopic.has(key)) byTopic.set(key, [])
    byTopic.get(key).push(e)
  })

  const result = []
  // 有主题的优先
  topicNameList.value.forEach((name) => {
    const entries = byTopic.get(name)
    if (entries && entries.length) {
      result.push({ topic: name, entries: [...entries].sort((a, b) => a.time.localeCompare(b.time)) })
    }
  })
  // 兼容历史数据：记录里存在、但主题列表中缺失的主题也要显示。
  byTopic.forEach((entries, name) => {
    if (name !== '__未分类__' && !topicNameList.value.includes(name)) {
      result.push({ topic: name, entries: [...entries].sort((a, b) => a.time.localeCompare(b.time)) })
    }
  })
  // 未分类最后
  const uncat = byTopic.get('__未分类__')
  if (uncat && uncat.length) {
    result.push({ topic: null, entries: [...uncat].sort((a, b) => a.time.localeCompare(b.time)) })
  }
  return result
})

const TOPIC_COLORS = ['#4f6df5', '#2bb673', '#f5a623', '#e8503a', '#8b5cf6', '#0ea5e9', '#ec4899', '#14b8a6']
function topicColor(topic) {
  if (!topic) return '#8f959e'
  const idx = topicNameList.value.indexOf(topic)
  return TOPIC_COLORS[idx % TOPIC_COLORS.length] || '#4f6df5'
}

function fmtTime(t) {
  if (!t) return ''
  return t.split(' ')[1] || t.split('T')[1] || t
}
function speaker(e) {
  return e.speakerId ? store.getPerson(e.speakerId) : null
}
function speakerName(e) {
  const p = speaker(e)
  return p ? p.name : ''
}
function speakerColor(e) {
  const p = speaker(e)
  return p ? p.color : '#8f959e'
}
</script>

<template>
  <div class="topic-view">
    <div v-for="(group, idx) in groups" :key="idx" class="topic-group">
      <div class="group-header" :style="{ borderLeftColor: topicColor(group.topic) }">
        <span class="group-icon" :style="{ background: topicColor(group.topic) }"></span>
        <span class="group-title">{{ group.topic || '未分类' }}</span>
        <span class="badge badge-gray">{{ group.entries.length }} 条</span>
      </div>
      <div class="group-entries">
        <div v-for="e in group.entries" :key="e.id" class="topic-entry">
          <span class="entry-time">{{ fmtTime(e.time) }}</span>
          <span v-if="speakerName(e)" class="entry-speaker">
            <span class="speaker-dot" :style="{ background: speakerColor(e) }"></span>
            {{ speakerName(e) }}
          </span>
          <p class="entry-text">{{ e.content }}</p>
        </div>
      </div>
    </div>

    <div v-if="groups.length === 0" class="empty-state">
      <div class="empty-icon"><SvgIcon name="tag" :size="48" /></div>
      <p>暂无记录</p>
      <span>为记录打上主题后，会按主题自动分组</span>
    </div>
  </div>
</template>

<style scoped>
.topic-view { max-width: 800px; margin: 0 auto; }
.topic-group {
  background: var(--surface);
  border: 1px solid var(--border-light);
  border-left: 4px solid var(--primary);
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
  border-left: 4px solid;
}
.group-icon { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.group-title { font-size: .9rem; font-weight: 600; flex: 1; }
.group-entries { padding: 4px 0; }
.topic-entry {
  padding: 10px 16px;
  border-bottom: 1px solid var(--border-light);
  display: flex;
  align-items: flex-start;
  gap: 8px;
  flex-wrap: wrap;
}
.topic-entry:last-child { border-bottom: none; }
.entry-time { font-size: .75rem; font-weight: 600; color: var(--text-muted); flex-shrink: 0; margin-top: 2px; }
.entry-speaker {
  display: flex; align-items: center; gap: 4px;
  font-size: .75rem; color: var(--text-secondary);
  background: var(--bg-secondary);
  padding: 1px 8px; border-radius: var(--radius-full);
}
.speaker-dot { width: 6px; height: 6px; border-radius: 50%; }
.entry-text { font-size: .88rem; line-height: 1.6; color: var(--text); flex: 1; min-width: 0; word-break: break-word; }
.empty-state { text-align: center; padding: 60px 20px; color: var(--text-muted); }
.empty-state .empty-icon { margin-bottom: 12px; color: var(--text-muted); }
.empty-state p { font-size: 1rem; font-weight: 500; color: var(--text-secondary); }
.empty-state span { font-size: .82rem; }
</style>
