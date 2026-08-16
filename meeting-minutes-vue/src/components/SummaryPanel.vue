<script setup>
import { computed } from 'vue'
import { useStore } from '../composables/useStore'

const props = defineProps({
  fullpage: { type: Boolean, default: false }
})
const emit = defineEmits(['toggle'])
const store = useStore()

// 记录按时间排序
const sortedEntries = computed(() => {
  return [...store.entries.value].sort((a, b) => a.time.localeCompare(b.time))
})

// 智能摘要 - 完全基于真实数据动态生成，不写死文字
const summary = computed(() => {
  const list = sortedEntries.value
  if (!list.length) return '暂无会议记录，添加记录后将自动生成摘要。'

  const total = list.length
  const speakers = new Set(list.map(e => e.speakerId).filter(Boolean))
  const topics = new Set(list.map(e => e.topic).filter(Boolean))
  const t1 = list[0]?.time?.slice(11, 16) || ''  // HH:mm
  const t2 = list[list.length - 1]?.time?.slice(11, 16) || ''

  // 找出说话最多的发言人
  const speakerCount = new Map()
  list.forEach(e => {
    if (e.speakerId) speakerCount.set(e.speakerId, (speakerCount.get(e.speakerId) || 0) + 1)
  })
  let topSpeaker = null
  let topCount = 0
  speakerCount.forEach((c, id) => { if (c > topCount) { topCount = c; topSpeaker = id } })

  const topName = topSpeaker ? store.getPerson(topSpeaker)?.name : null

  const parts = []
  parts.push(`本次会议共记录 ${total} 条内容`)
  if (speakers.size) parts.push(`，涉及 ${speakers.size} 位发言人`)
  if (topics.size) parts.push(`，覆盖 ${topics.size} 个主题`)
  parts.push('。')
  if (t1 && t2) parts.push(`发言时段 ${t1} - ${t2}。`)
  if (topName) parts.push(`其中「${topName}」发言最频繁，共 ${topCount} 次。`)

  return parts.join('')
})

// 关键要点 - 取前 5 条最早记录
const keyPoints = computed(() => {
  return sortedEntries.value.slice(0, 5).map(e => ({
    id: e.id,
    text: e.content.length > 60 ? e.content.slice(0, 60) + '…' : e.content,
    topic: e.topic
  }))
})

const pendingTodos = computed(() => store.todos.value.filter(t => !t.done))

function assigneeName(id) {
  if (!id) return ''
  const p = store.getPerson(id)
  return p ? p.name : ''
}

async function toggleTodo(todo) {
  await store.updateTodo(todo.id, { done: !todo.done })
}
</script>

<template>
  <div class="summary-panel" :class="{ fullpage }">
    <div v-if="!fullpage" class="panel-header">
      <h3><SvgIcon name="sparkles" :size="16" /> 会议助手</h3>
      <button class="btn-icon" @click="emit('toggle')" title="收起">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
    </div>

    <div class="panel-body">
      <div class="assistant-status"><span><SvgIcon name="sparkles" :size="15" /> AI 正在整理</span><i></i></div>
      <!-- 会议概览 -->
      <div class="summary-section">
        <div class="section-title"><SvgIcon name="clipboard" :size="14" /> 实时摘要</div>
        <div class="overview-stats">
          <div class="stat-item">
            <div class="stat-value">{{ store.entries.value.length }}</div>
            <div class="stat-label">记录条数</div>
          </div>
          <div class="stat-item">
            <div class="stat-value">{{ store.persons.value.length }}</div>
            <div class="stat-label">参会人员</div>
          </div>
          <div class="stat-item">
            <div class="stat-value">{{ store.topics.value.length }}</div>
            <div class="stat-label">主题数</div>
          </div>
        </div>
        <p class="summary-text">{{ summary }}</p>
      </div>

      <!-- 关键要点 -->
      <div class="summary-section">
        <div class="section-title"><SvgIcon name="key" :size="14" /> 关键要点</div>
        <div v-if="keyPoints.length" class="key-points">
          <div v-for="point in keyPoints" :key="point.id" class="key-point">
            <span class="point-bullet"></span>
            <div class="point-content">
              <p class="point-text">{{ point.text }}</p>
              <span v-if="point.topic" class="badge badge-purple">{{ point.topic }}</span>
            </div>
          </div>
        </div>
        <div v-else class="empty-hint">暂无要点</div>
      </div>

      <!-- 待办事项 -->
      <div class="summary-section">
        <div class="section-title">
          <SvgIcon name="list-checks" :size="14" /> 待办事项
          <span class="badge badge-gray">{{ pendingTodos.length }}/{{ store.todos.value.length }}</span>
        </div>
        <div v-if="store.todos.value.length" class="todo-list">
          <div v-for="todo in store.todos.value" :key="todo.id" class="todo-item" :class="{ done: todo.done }">
            <label class="todo-check">
              <input type="checkbox" :checked="todo.done" @change="toggleTodo(todo)" />
              <span class="checkmark"></span>
            </label>
            <div class="todo-content">
              <span class="todo-text">{{ todo.content }}</span>
              <span v-if="assigneeName(todo.assigneeId)" class="todo-assignee">@{{ assigneeName(todo.assigneeId) }}</span>
            </div>
          </div>
        </div>
        <div v-else class="empty-hint">暂无待办</div>
      </div>

      <!-- 参会人员 -->
      <div class="summary-section">
        <div class="section-title"><SvgIcon name="users" :size="14" /> 参会人员</div>
        <div class="attendee-list">
          <div v-for="(p, index) in store.persons.value" :key="p.id" class="attendee-item">
            <div class="avatar attendee-avatar-sm" :style="{ background: p.color }">{{ p.name.charAt(0) }}</div>
            <div class="attendee-info">
              <span class="attendee-name">{{ p.name }}</span>
              <span v-if="p.role" class="attendee-role">{{ p.role }}</span>
            </div>
            <kbd v-if="index < 9" class="attendee-shortcut">Ctrl+{{ index + 1 }}</kbd>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.summary-panel {
  width: 340px;
  flex-shrink: 0;
  background: var(--surface);
  border-left: 1px solid var(--border);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
.summary-panel.fullpage {
  width: 100%;
  max-width: 720px;
  margin: 24px auto;
  border-left: none;
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  overflow: visible;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.panel-header h3 { font-size: .95rem; font-weight: 700; display: flex; align-items: center; gap: 6px; }

.panel-body { padding: 14px; display: flex; flex-direction: column; gap: 10px; background: #fbfcff; }
.assistant-status { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border: 1px solid #dbe5fb; border-radius: 9px; background: #f7f9ff; color: var(--primary); font-size: .82rem; font-weight: 650; }
.assistant-status span { display: flex; align-items: center; gap: 7px; }
.assistant-status i { width: 7px; height: 7px; border-radius: 50%; background: #65c31d; box-shadow: 0 0 0 3px #eff9e7; }

.summary-section { display: flex; flex-direction: column; gap: 10px; padding: 14px; border: 1px solid var(--border); border-radius: 9px; background: #fff; }
.section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: .82rem;
  font-weight: 700;
  color: var(--text-secondary);
  letter-spacing: .1px;
}
.section-title .badge { margin-left: auto; text-transform: none; }

.overview-stats {
  display: flex;
  gap: 12px;
}
.stat-item {
  flex: 1;
  text-align: center;
  background: var(--bg-secondary);
  border-radius: var(--radius-sm);
  padding: 10px 4px;
}
.stat-value { font-size: 1.3rem; font-weight: 700; color: var(--primary); }
.stat-label { font-size: .72rem; color: var(--text-muted); }

.summary-text {
  font-size: .85rem;
  line-height: 1.7;
  color: var(--text);
  background: #f7f9ff;
  padding: 11px 12px;
  border-radius: var(--radius-sm);
  border-left: 3px solid var(--primary);
}

.key-points { display: flex; flex-direction: column; gap: 8px; }
.key-point { display: flex; gap: 8px; align-items: flex-start; }
.point-bullet {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--primary);
  margin-top: 7px;
  flex-shrink: 0;
}
.point-content { flex: 1; display: flex; flex-direction: column; gap: 3px; }
.point-text { font-size: .83rem; line-height: 1.5; color: var(--text); }

.todo-list { display: flex; flex-direction: column; gap: 4px; }
.todo-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 0;
}
.todo-check { position: relative; cursor: pointer; flex-shrink: 0; margin-top: 2px; }
.todo-check input { position: absolute; opacity: 0; width: 16px; height: 16px; cursor: pointer; }
.checkmark {
  display: block;
  width: 16px; height: 16px;
  border: 2px solid var(--border);
  border-radius: 4px;
  transition: var(--transition);
}
.todo-check input:checked ~ .checkmark {
  background: var(--success);
  border-color: var(--success);
}
.todo-check input:checked ~ .checkmark::after {
  content: '✓';
  display: block;
  color: #fff;
  font-size: 10px;
  text-align: center;
  line-height: 12px;
  font-weight: 700;
}
.todo-content { flex: 1; display: flex; flex-direction: column; }
.todo-text { font-size: .83rem; line-height: 1.5; }
.todo-item.done .todo-text { text-decoration: line-through; color: var(--text-muted); }
.todo-assignee { font-size: .72rem; color: var(--primary); font-weight: 500; }

.attendee-list { display: flex; flex-direction: column; gap: 6px; }
.attendee-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}
.attendee-avatar-sm { width: 24px; height: 24px; font-size: .68rem; }
.attendee-info { display: flex; flex-direction: column; }
.attendee-name { font-size: .82rem; font-weight: 500; }
.attendee-role { font-size: .7rem; color: var(--text-muted); }
.attendee-shortcut {
  margin-left: auto;
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-bottom-width: 2px;
  border-radius: 4px;
  color: var(--text-muted);
  background: var(--bg-secondary);
  font-family: inherit;
  font-size: .68rem;
  line-height: 1.25;
  white-space: nowrap;
}

.empty-hint { font-size: .82rem; color: var(--text-muted); padding: 8px 0; }
</style>
