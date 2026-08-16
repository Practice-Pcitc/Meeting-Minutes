<script setup>
import { ref, computed } from 'vue'
import { useStore } from '../composables/useStore'
import EntryEditModal from '../components/EntryEditModal.vue'

const store = useStore()
const editingEntry = ref(null)

// 倒序按时间排
const sortedEntries = computed(() =>
  [...store.entries.value].sort((a, b) => a.time.localeCompare(b.time))
)

function fmtTime(t) {
  if (!t) return ''
  // "2024-05-20 14:30" -> "14:30"
  return t.split(' ')[1] || t.split('T')[1] || t
}
function fmtDate(t) {
  if (!t) return ''
  return t.split(' ')[0] || t.split('T')[0] || ''
}

const groupedByDate = computed(() => {
  const groups = new Map()
  sortedEntries.value.forEach((e) => {
    const d = fmtDate(e.time)
    if (!groups.has(d)) groups.set(d, [])
    groups.get(d).push(e)
  })
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
})

function speaker(e) {
  return e.speakerId ? store.getPerson(e.speakerId) : null
}
function speakerName(e) {
  const p = speaker(e)
  return p ? p.name : '会议记录'
}
function speakerColor(e) {
  const p = speaker(e)
  return p ? p.color : '#8f959e'
}
function speakerRole(e) {
  const p = speaker(e)
  return p && p.role ? p.role : ''
}
</script>

<template>
  <div class="timeline-view">
    <template v-for="[date, entries] in groupedByDate" :key="date">
      <div class="date-divider">
        <span>{{ date }}</span>
      </div>

      <div class="timeline-list">
        <div
          v-for="entry in entries"
          :key="entry.id"
          class="timeline-item"
          @click="editingEntry = entry"
        >
          <div class="timeline-left">
            <div class="timeline-time">{{ fmtTime(entry.time) }}</div>
            <div class="timeline-line"></div>
          </div>

          <div class="timeline-card">
            <div class="card-header">
              <div class="avatar card-avatar" :style="{ background: speakerColor(entry) }">
                {{ speakerName(entry).charAt(0) }}
              </div>
              <div class="card-speaker">
                <span class="speaker-name">{{ speakerName(entry) }}</span>
                <span v-if="speakerRole(entry)" class="speaker-role">{{ speakerRole(entry) }}</span>
              </div>
              <div class="card-content">{{ entry.content }}</div>
              <span v-if="entry.topic" class="badge badge-purple topic-badge">
                <SvgIcon name="tag" :size="11" /> {{ entry.topic }}
              </span>
              <span v-else class="badge badge-gray topic-badge-empty">未设主题</span>
            </div>
          </div>
        </div>
      </div>
    </template>

    <div v-if="sortedEntries.length === 0" class="empty-state">
      <div class="empty-icon"><SvgIcon name="file-text" :size="48" /></div>
      <p>还没有会议记录</p>
      <span v-if="store.persons.value.length === 0">先在左侧「管理人员」中添加参会人员</span>
      <span v-else>在下方输入框中添加第一条记录</span>
    </div>

    <EntryEditModal v-if="editingEntry" :entry="editingEntry" @close="editingEntry = null" />
  </div>
</template>

<style scoped>
.timeline-view { max-width: 800px; margin: 0 auto; }

.date-divider {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 8px 0 16px;
  color: var(--text-muted);
  font-size: .82rem;
  font-weight: 600;
}
.date-divider::before, .date-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--border);
}

.timeline-list { display: flex; flex-direction: column; }

.timeline-item { display: flex; gap: 12px; cursor: pointer; }
.timeline-left {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 48px;
  flex-shrink: 0;
}
.timeline-time { font-size: .75rem; font-weight: 600; color: var(--text-muted); white-space: nowrap; }
.timeline-line {
  width: 2px;
  flex: 1;
  background: var(--border);
  margin-top: 4px;
  min-height: 20px;
}
.timeline-item:last-child .timeline-line { display: none; }

.timeline-card {
  flex: 1;
  background: var(--surface);
  border: 1px solid var(--border-light);
  border-radius: var(--radius);
  padding: 10px 14px;
  margin-bottom: 8px;
  box-shadow: var(--shadow-sm);
  transition: var(--transition);
}
.timeline-card:hover {
  box-shadow: var(--shadow-md);
  border-color: var(--border);
}

.card-header {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 32px;
}
.card-avatar { width: 28px; height: 28px; font-size: .72rem; }
.card-speaker { display: flex; flex-direction: column; flex: 0 0 auto; min-width: 72px; max-width: 140px; }
.speaker-name { font-size: .85rem; font-weight: 600; }
.speaker-role { font-size: .72rem; color: var(--text-muted); }
.topic-badge { margin-left: auto; flex-shrink: 0; }
.topic-badge-empty {
  margin-left: auto;
  border: 1px dashed var(--border);
  background: transparent;
}

.card-content {
  font-size: .88rem;
  line-height: 1.55;
  color: var(--text);
  word-break: break-word;
  min-width: 120px;
  flex: 1;
}

@media (max-width: 760px) {
  .card-header { align-items: flex-start; flex-wrap: wrap; }
  .card-content { flex-basis: calc(100% - 118px); }
  .topic-badge,.topic-badge-empty { margin-left: 38px; }
}

.empty-state { text-align: center; padding: 60px 20px; color: var(--text-muted); }
.empty-state .empty-icon { margin-bottom: 12px; color: var(--text-muted); }
.empty-state p { font-size: 1rem; font-weight: 500; color: var(--text-secondary); }
.empty-state span { font-size: .82rem; }
</style>
