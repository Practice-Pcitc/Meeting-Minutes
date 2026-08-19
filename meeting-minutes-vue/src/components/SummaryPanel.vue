<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useStore } from '../composables/useStore'
import { authRequest, useAuth } from '../composables/useAuth'
import { useNotify } from '../composables/useNotify'

const props = defineProps({
  fullpage: { type: Boolean, default: false },
  recordingMode: Boolean,
  recordingActive: Boolean,
  liveTranscript: { type: String, default: '' },
  meetingEnded: Boolean,
})
const emit = defineEmits(['toggle', 'open-provider-settings'])
const store = useStore()
const { auth } = useAuth()
const notify = useNotify()

const API_BASE = import.meta.env.VITE_API_BASE || '/api'
const LIVE_KEEPALIVE_MS = 8000 // 实时转写上报周期

// ==================== 录音模式：实时 AI 状态 ====================
const aiStatus = ref('idle')      // idle|waiting|summarizing|success|error|ended
const aiState = ref(null)         // 后端增量总结维护的会议状态
const snapshots = ref([])         // 阶段快照历史（新的在前）
const aiError = ref('')
const finalSummary = ref(null)    // 最终会议总结
const lastUpdatedAt = ref(0)
const showHistory = ref(false)
const summaryFlash = ref(false)
let flashTimer = null

// ==================== 非录音模式：手动总结 ====================
const generating = ref(false)
const summaryFlashLegacy = ref(false)
let legacyFlashTimer = null

// ==================== SSE / 定时器 ====================
let eventSource = null
let liveKeepAliveTimer = null
let fallbackPollTimer = null
let sseFailed = false
let pollUntilEndedTimer = null

const meetingId = computed(() => store.activeMeetingId.value)
const defaultProvider = computed(() => {
  const preferences = auth.user?.preferences
  return (preferences?.aiProviders || []).find(item => item.id === preferences?.defaultAiProviderId) || null
})

// 展示用状态：优先 aiState，老会议只有 aiSummary 时做兼容映射
const displayState = computed(() => {
  if (aiState.value) return aiState.value
  const legacy = store.meeting.value.aiSummary
  if (legacy) {
    return {
      current_topic: '',
      latest_summary: legacy.summary,
      key_points: legacy.keyPoints || [],
      decisions: legacy.decisions || [],
      todos: (legacy.nextSteps || []).map(text => ({ owner: '', task: text, deadline: '', status: 'pending' })),
      open_questions: [],
      participants_views: [],
      updated_at: legacy.generatedAt,
    }
  }
  return null
})
const latestSummary = computed(() => displayState.value?.latest_summary || '')

const statusText = computed(() => {
  if (!defaultProvider.value) return '尚未配置 AI 供应商'
  switch (aiStatus.value) {
    case 'summarizing': return 'AI 正在理解最新讨论…'
    case 'waiting': return '正在等待会议内容…'
    case 'success': {
      const ts = aiState.value?.updated_at || lastUpdatedAt.value || 0
      return ts ? `已更新 · ${formatClock(ts)}` : '已更新'
    }
    case 'error': return '本次总结失败，将在下一轮自动重试'
    case 'ended': return '会议总结已完成'
    default: return props.recordingActive ? '等待会议内容…' : '等待开始录音'
  }
})
const statusClass = computed(() => {
  if (!defaultProvider.value) return 'status-off'
  return `status-${aiStatus.value}`
})
const statusIcon = computed(() => {
  if (aiStatus.value === 'success' || aiStatus.value === 'ended') return '✓'
  if (aiStatus.value === 'error') return '⚠'
  if (aiStatus.value === 'summarizing' || aiStatus.value === 'waiting') return '●'
  return '○'
})
const latestTimeLabel = computed(() => {
  const ts = aiState.value?.updated_at || store.meeting.value.aiSummary?.generatedAt || 0
  return formatTime(ts)
})

function formatClock(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const pad = value => String(value).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
function formatTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const pad = value => String(value).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ==================== SSE 连接 ====================
function connectSSE() {
  disconnectSSE()
  if (!meetingId.value || !auth.token) return
  sseFailed = false
  const url = `${API_BASE}/meetings/${meetingId.value}/ai-summary/stream?token=${encodeURIComponent(auth.token)}`
  eventSource = new EventSource(url)
  eventSource.onopen = () => {
    if (sseFailed) { sseFailed = false; stopFallbackPolling() }
  }
  eventSource.addEventListener('summary_status', (event) => {
    try { aiStatus.value = JSON.parse(event.data).status } catch { /* ignore */ }
  })
  eventSource.addEventListener('summary_update', (event) => {
    try { applyUpdate(JSON.parse(event.data)) } catch { /* ignore */ }
  })
  eventSource.addEventListener('summary_error', (event) => {
    try {
      const data = JSON.parse(event.data)
      aiStatus.value = 'error'
      aiError.value = data.message || '本次总结失败，将在下一轮自动重试'
    } catch { /* ignore */ }
  })
  eventSource.addEventListener('summary_final', (event) => {
    try { applyFinal(JSON.parse(event.data)) } catch { /* ignore */ }
  })
  eventSource.onerror = () => {
    // EventSource 会自动重连；连续失败时启用轮询兜底
    if (!sseFailed) { sseFailed = true; startFallbackPolling() }
  }
}
function disconnectSSE() {
  if (eventSource) { eventSource.close(); eventSource = null }
}

function applyUpdate(data) {
  aiStatus.value = 'success'
  aiError.value = ''
  aiState.value = data.data || null
  lastUpdatedAt.value = Date.now()
  if (data.snapshot) {
    snapshots.value = [data.snapshot, ...snapshots.value.filter(item => item.id !== data.snapshot.id)].slice(0, 5)
  }
  summaryFlash.value = true
  window.clearTimeout(flashTimer)
  flashTimer = window.setTimeout(() => { summaryFlash.value = false }, 1500)
}

function applyFinal(data) {
  aiStatus.value = 'ended'
  aiError.value = ''
  finalSummary.value = data.data || null
  if (data.summary) {
    aiState.value = { ...(aiState.value || {}), latest_summary: data.summary.summary, updated_at: Date.now() }
  }
}

// ==================== 状态拉取 ====================
async function fetchState() {
  if (!meetingId.value) return
  try {
    const data = await authRequest('GET', `/meetings/${meetingId.value}/ai-summary/state`)
    aiStatus.value = data.status || 'idle'
    aiState.value = data.aiState || null
    snapshots.value = (data.snapshots || []).slice(-5).reverse()
    aiError.value = data.aiLastError || ''
    if (data.aiState?.updated_at) lastUpdatedAt.value = data.aiState.updated_at
    if (data.status === 'ended' && !finalSummary.value) {
      const legacy = data.aiSummary
      const st = data.aiState
      finalSummary.value = {
        overview: legacy?.summary || st?.latest_summary || '',
        core_discussion: '',
        key_points: legacy?.keyPoints || st?.key_points || [],
        decisions: legacy?.decisions || st?.decisions || [],
        todos: legacy ? (legacy.nextSteps || []).map(text => ({ owner: '', task: text, deadline: '', status: 'pending' })) : (st?.todos || []),
        open_questions: st?.open_questions || [],
        risks: legacy?.risks || [],
        timeline: [],
      }
    }
  } catch { /* 忽略：SSE/下一次轮询会继续 */ }
}

function startFallbackPolling() {
  stopFallbackPolling()
  fallbackPollTimer = window.setInterval(fetchState, 10000)
}
function stopFallbackPolling() {
  if (fallbackPollTimer) { window.clearInterval(fallbackPollTimer); fallbackPollTimer = null }
}
/** 录音停止后轮询等待最终总结完成 */
function pollUntilEnded(timeout = 90000) {
  stopFallbackPolling()
  const started = Date.now()
  if (pollUntilEndedTimer) window.clearInterval(pollUntilEndedTimer)
  pollUntilEndedTimer = window.setInterval(async () => {
    await fetchState()
    if (aiStatus.value === 'ended' || Date.now() - started > timeout) {
      window.clearInterval(pollUntilEndedTimer)
      pollUntilEndedTimer = null
    }
  }, 4000)
}

// ==================== 录音生命周期 ====================
function startKeepAlive() {
  stopKeepAlive()
  liveKeepAliveTimer = window.setInterval(async () => {
    if (!props.recordingActive || !meetingId.value) return
    try {
      await authRequest('POST', `/meetings/${meetingId.value}/ai-summary/live`, { liveTranscript: props.liveTranscript })
    } catch { /* 网络抖动忽略，下一轮继续 */ }
  }, LIVE_KEEPALIVE_MS)
}
function stopKeepAlive() {
  if (liveKeepAliveTimer) { window.clearInterval(liveKeepAliveTimer); liveKeepAliveTimer = null }
}

watch(() => props.recordingActive, async (active, previous) => {
  if (!props.recordingMode || !meetingId.value) return
  if (active) {
    // 开录：通知后端启动 30s 增量调度
    try { await authRequest('POST', `/meetings/${meetingId.value}/ai-summary/realtime`, { active: true }) } catch { /* 后端未就绪时继续 */ }
    startKeepAlive()
    fetchState()
  } else if (previous) {
    // 停录：通知后端停止调度并生成最终总结
    stopKeepAlive()
    try { await authRequest('POST', `/meetings/${meetingId.value}/ai-summary/realtime`, { active: false, final: true }) } catch { /* ignore */ }
    fetchState()
    pollUntilEnded()
  }
}, { immediate: true })

watch(meetingId, () => {
  aiStatus.value = 'idle'
  aiState.value = null
  snapshots.value = []
  aiError.value = ''
  finalSummary.value = null
  lastUpdatedAt.value = 0
  showHistory.value = false
  stopKeepAlive()
  stopFallbackPolling()
  if (pollUntilEndedTimer) { window.clearInterval(pollUntilEndedTimer); pollUntilEndedTimer = null }
  if (props.recordingMode) {
    connectSSE()
    fetchState()
    if (props.recordingActive) {
      authRequest('POST', `/meetings/${meetingId.value}/ai-summary/realtime`, { active: true }).catch(() => {})
      startKeepAlive()
    }
  }
}, { immediate: true })

watch(() => props.meetingEnded, (ended) => {
  if (ended && props.recordingMode && meetingId.value) fetchState()
})

onBeforeUnmount(() => {
  disconnectSSE()
  stopKeepAlive()
  stopFallbackPolling()
  window.clearTimeout(flashTimer)
  window.clearTimeout(legacyFlashTimer)
  if (pollUntilEndedTimer) { window.clearInterval(pollUntilEndedTimer); pollUntilEndedTimer = null }
  // 面板关闭时仅停止实时调度；是否生成最终总结由录音停止流程决定
  if (props.recordingMode && props.recordingActive && meetingId.value) {
    authRequest('POST', `/meetings/${meetingId.value}/ai-summary/realtime`, { active: false }).catch(() => {})
  }
})

// ==================== 非录音模式：手动总结 ====================
const aiSummary = computed(() => store.meeting.value.aiSummary || null)
const keyPoints = computed(() => (aiSummary.value?.keyPoints || []).map((text, index) => ({ id: `point-${index}`, text })))
const detailSections = computed(() => [
  { key: 'decisions', title: '明确决策', icon: 'check-circle', items: aiSummary.value?.decisions || [] },
  { key: 'risks', title: '风险与阻塞', icon: 'lightbulb', items: aiSummary.value?.risks || [] },
  { key: 'nextSteps', title: '下一步行动', icon: 'chevron-right', items: aiSummary.value?.nextSteps || [] },
].filter(section => section.items.length))
const pendingTodos = computed(() => store.todos.value.filter(todo => !todo.done))
const generatedTime = computed(() => aiSummary.value?.generatedAt
  ? new Date(aiSummary.value.generatedAt).toLocaleString('zh-CN', { hour12: false })
  : '')

watch(() => aiSummary.value?.summary, (value, previous) => {
  if (!value || value === previous) return
  summaryFlashLegacy.value = true
  window.clearTimeout(legacyFlashTimer)
  legacyFlashTimer = window.setTimeout(() => { summaryFlashLegacy.value = false }, 1500)
})

async function generateSummary() {
  if (!defaultProvider.value) {
    notify.warning('请先配置并设置默认 AI 供应商')
    emit('open-provider-settings')
    return
  }
  generating.value = true
  try {
    await authRequest('POST', `/meetings/${meetingId.value}/ai-summary`, {
      liveTranscript: '',
      mode: 'final',
    })
    await store.refetch()
    notify.success('AI 总结已生成并保存到当前会议')
  } catch (error) {
    notify.error(error.message)
  } finally { generating.value = false }
}

function assigneeName(id) {
  if (!id) return ''
  return store.getPerson(id)?.name || ''
}

async function toggleTodo(todo) {
  try { await store.updateTodo(todo.id, { done: !todo.done }) }
  catch (error) { notify.error(error.message) }
}
</script>

<template>
  <div
    class="summary-panel"
    :class="{ fullpage, recording: recordingMode }"
  >
    <div v-if="!fullpage" class="panel-header">
      <div><h3><SvgIcon name="sparkles" :size="16" /> {{ recordingMode ? '实时 AI 总结' : 'AI 总结' }}</h3><small v-if="recordingMode">AI 正在跟随会议自动记录与提炼</small></div>
      <div class="header-actions">
        <button v-if="!recordingMode" class="btn-icon" title="收起" @click="emit('toggle')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>
    </div>

    <div class="panel-body">
      <div class="assistant-status" :class="{ ready: defaultProvider }">
        <span><SvgIcon name="sparkles" :size="15" /> {{ defaultProvider ? `默认：${defaultProvider.name}` : '尚未配置 AI 供应商' }}</span><i></i>
      </div>

      <!-- ========== 录音模式：AI 会议实时状态面板 ========== -->
      <template v-if="recordingMode">
        <div class="live-status-bar" :class="statusClass">
          <span class="live-status-icon" :class="{ spin: aiStatus === 'summarizing' }">{{ statusIcon }}</span>
          <div class="live-status-main">
            <strong>{{ statusText }}</strong>
            <small v-if="defaultProvider">{{ defaultProvider.name }} · {{ defaultProvider.model }}</small>
            <small v-else>配置供应商后，录音时将自动实时总结</small>
          </div>
          <button v-if="defaultProvider" class="btn btn-ghost live-refresh" @click="fetchState">手动刷新</button>
        </div>
        <button v-if="!defaultProvider" class="btn btn-primary live-config-btn" @click="emit('open-provider-settings')">配置 AI 供应商</button>

        <!-- 最新 AI 小结 + 历史阶段小结 -->
        <section class="ai-card" :class="{ flash: summaryFlash }">
          <div class="ai-card-title">
            <span>✨ {{ latestTimeLabel }} AI 小结</span>
            <button v-if="snapshots.length" class="ai-link" @click="showHistory = !showHistory">{{ showHistory ? '收起历史' : `查看历史小结(${snapshots.length})` }}</button>
          </div>
          <p class="ai-summary-text">{{ latestSummary || 'AI 将随着会议进行自动提炼当前话题、重要结论和待办事项。' }}</p>
          <div v-if="showHistory && snapshots.length" class="ai-history">
            <div v-for="snap in snapshots" :key="snap.id" class="ai-history-item">
              <span class="ai-history-time">{{ formatTime(snap.created_at) }}</span>
              <p>{{ snap.latest_summary || '（无小结）' }}</p>
            </div>
          </div>
        </section>

        <!-- 最终会议总结 -->
        <section v-if="finalSummary" class="ai-card ai-final">
          <div class="ai-card-title">📋 最终会议总结</div>
          <p class="ai-summary-text">{{ finalSummary.overview }}</p>
          <template v-if="finalSummary.core_discussion">
            <div class="ai-final-label">核心讨论</div>
            <p class="ai-summary-text">{{ finalSummary.core_discussion }}</p>
          </template>
          <template v-if="finalSummary.key_points && finalSummary.key_points.length">
            <div class="ai-final-label">关键要点</div>
            <ul class="ai-list"><li v-for="(item, index) in finalSummary.key_points" :key="index">{{ item }}</li></ul>
          </template>
          <template v-if="finalSummary.decisions && finalSummary.decisions.length">
            <div class="ai-final-label">关键结论</div>
            <ul class="ai-list"><li v-for="(item, index) in finalSummary.decisions" :key="index">{{ item }}</li></ul>
          </template>
          <template v-if="finalSummary.timeline && finalSummary.timeline.length">
            <div class="ai-final-label">重要时间节点</div>
            <ul class="ai-list"><li v-for="(item, index) in finalSummary.timeline" :key="index">{{ item }}</li></ul>
          </template>
        </section>
      </template>

      <!-- ========== 非录音模式：原手动总结面板 ========== -->
      <template v-else>
        <div class="generate-card">
          <div>
            <strong>{{ aiSummary ? '重新整理当前会议' : '生成结构化 AI 总结' }}</strong>
            <p>{{ defaultProvider ? `使用 ${defaultProvider.model}，仅在你点击时发起请求。` : '先配置供应商和 API Key，再生成总结。' }}</p>
          </div>
          <button v-if="defaultProvider" class="btn btn-primary" :disabled="generating" @click="generateSummary">
            <SvgIcon name="sparkles" :size="14" /> {{ generating ? '生成中…' : (aiSummary ? '重新生成' : '生成总结') }}
          </button>
          <button v-else class="btn btn-primary" @click="emit('open-provider-settings')">配置供应商</button>
        </div>

        <div class="summary-section">
          <div class="section-title"><SvgIcon name="clipboard" :size="14" /> AI 摘要</div>
          <div class="overview-stats">
            <div class="stat-item"><div class="stat-value">{{ store.entries.value.length }}</div><div class="stat-label">记录条数</div></div>
            <div class="stat-item"><div class="stat-value">{{ store.persons.value.length }}</div><div class="stat-label">参会人员</div></div>
            <div class="stat-item"><div class="stat-value">{{ store.topics.value.length }}</div><div class="stat-label">主题数</div></div>
          </div>
          <p v-if="aiSummary" class="summary-text" :class="{ flash: summaryFlashLegacy }">{{ aiSummary.summary }}</p>
          <div v-else class="empty-hint">尚未生成。点击上方按钮后才会调用 AI 供应商。</div>
          <div v-if="aiSummary" class="generated-meta">
            <span>{{ aiSummary.provider.name }} · {{ aiSummary.provider.model }}</span><span>{{ generatedTime }}</span>
          </div>
        </div>

        <div class="summary-section">
          <div class="section-title"><SvgIcon name="key" :size="14" /> 关键要点</div>
          <div v-if="keyPoints.length" class="key-points">
            <div v-for="point in keyPoints" :key="point.id" class="key-point"><span class="point-bullet"></span><p class="point-text">{{ point.text }}</p></div>
          </div>
          <div v-else class="empty-hint">生成总结后显示关键要点</div>
        </div>

        <div v-for="sectionItem in detailSections" :key="sectionItem.key" class="summary-section">
          <div class="section-title"><SvgIcon :name="sectionItem.icon" :size="14" /> {{ sectionItem.title }}</div>
          <ul class="detail-list"><li v-for="(item, index) in sectionItem.items" :key="index">{{ item }}</li></ul>
        </div>

        <div class="summary-section">
          <div class="section-title"><SvgIcon name="list-checks" :size="14" /> 待办事项 <span class="badge badge-gray">{{ pendingTodos.length }}/{{ store.todos.value.length }}</span></div>
          <div v-if="store.todos.value.length" class="todo-list">
            <div v-for="todo in store.todos.value" :key="todo.id" class="todo-item" :class="{ done: todo.done }">
              <label class="todo-check"><input type="checkbox" :checked="todo.done" @change="toggleTodo(todo)" /><span class="checkmark"></span></label>
              <div class="todo-content"><span class="todo-text">{{ todo.content }}</span><span v-if="assigneeName(todo.assigneeId)" class="todo-assignee">@{{ assigneeName(todo.assigneeId) }}</span></div>
            </div>
          </div>
          <div v-else class="empty-hint">暂无待办</div>
        </div>

        <div class="summary-section">
          <div class="section-title"><SvgIcon name="users" :size="14" /> 参会人员</div>
          <div v-if="store.persons.value.length" class="attendee-list">
            <div v-for="(person, index) in store.persons.value" :key="person.id" class="attendee-item">
              <div class="avatar attendee-avatar-sm" :style="{ background: person.color }">{{ person.name.charAt(0) }}</div>
              <div class="attendee-info"><span class="attendee-name">{{ person.name }}</span><span v-if="person.role" class="attendee-role">{{ person.role }}</span></div>
              <kbd v-if="index < 9" class="attendee-shortcut">Ctrl+{{ index + 1 }}</kbd>
            </div>
          </div>
          <div v-else class="empty-hint">暂无参会人员</div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.summary-panel { width: 340px; flex-shrink: 0; display: flex; flex-direction: column; overflow-y: auto; border-left: 1px solid var(--border); background: var(--surface); }
.summary-panel.fullpage { width: 100%; max-width: 760px; margin: 24px auto; overflow: visible; border-left: none; border-radius: var(--radius); box-shadow: var(--shadow); }
.summary-panel.recording { width: 100%; max-height: calc(100vh - 205px); align-self: start; position: sticky; top: 0; overflow-y: auto; border: 1px solid #dfe4ec; border-radius: 14px; box-shadow: 0 8px 28px rgba(32,52,89,.055); }

.header-actions { display: flex; align-items: center; gap: 2px; }
.panel-header { display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; padding: 16px 20px; border-bottom: 1px solid var(--border); }.panel-header>div { min-width: 0; }.panel-header h3 { display: flex; align-items: center; gap: 6px; font-size: .95rem; font-weight: 700; }.panel-header small { display: block; margin-top: 2px; color: var(--text-muted); font-size: .66rem; }
.panel-body { display: flex; flex-direction: column; gap: 10px; padding: 14px; background: #fbfcff; }
.assistant-status { display: flex; align-items: center; justify-content: space-between; padding: 11px 13px; border: 1px solid #ead5d2; border-radius: 9px; color: #a84032; background: #fff8f7; font-size: .78rem; font-weight: 650; }.assistant-status.ready { border-color: #dbe5fb; color: var(--primary); background: #f7f9ff; }.assistant-status span { display: flex; align-items: center; gap: 7px; min-width: 0; }.assistant-status i { width: 7px; height: 7px; flex-shrink: 0; border-radius: 50%; background: #d36757; box-shadow: 0 0 0 3px #fae9e6; }.assistant-status.ready i { background: #36ad75; box-shadow: 0 0 0 3px #e4f6ed; }
.generate-card { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 13px 14px; border: 1px solid #dbe5fb; border-radius: 9px; background: linear-gradient(135deg,#f7f9ff,#f4f8ff); }.generate-card div { min-width: 0; }.generate-card strong { display: block; font-size: .82rem; }.generate-card p { margin-top: 3px; color: var(--text-muted); font-size: .69rem; line-height: 1.45; }.generate-card .btn { flex-shrink: 0; padding: 7px 9px; font-size: .72rem; }

/* ===== 实时状态条 ===== */
.live-status-bar { display: flex; align-items: center; gap: 10px; padding: 12px 13px; border: 1px solid #dbe5fb; border-radius: 10px; background: linear-gradient(135deg,#f7f9ff,#f4f8ff); }
.live-status-bar .live-status-main { flex: 1; min-width: 0; }
.live-status-bar strong { display: block; color: #213250; font-size: .8rem; line-height: 1.35; }
.live-status-bar small { display: block; margin-top: 2px; overflow: hidden; color: var(--text-muted); font-size: .66rem; text-overflow: ellipsis; white-space: nowrap; }
.live-status-icon { width: 18px; height: 18px; flex: none; display: grid; place-items: center; border-radius: 50%; color: #fff; font-size: .68rem; font-weight: 700; background: #aeb8c8; }
.live-status-bar.status-waiting .live-status-icon { background: #9aa6ba; animation: statusPulse 1.8s ease-out infinite; }
.live-status-bar.status-summarizing { border-color: #c3d4fb; background: linear-gradient(135deg,#eef4ff,#eaf1ff); }
.live-status-bar.status-summarizing .live-status-icon { background: var(--primary); }
.live-status-icon.spin { animation: spin 1.2s linear infinite; }
.live-status-bar.status-success .live-status-icon { background: #36ad75; }
.live-status-bar.status-success { border-color: #d3ecdf; background: linear-gradient(135deg,#f2fbf6,#effaf4); }
.live-status-bar.status-error .live-status-icon { background: #d97757; }
.live-status-bar.status-error { border-color: #f3d9d0; background: #fff7f3; }
.live-status-bar.status-ended .live-status-icon { background: #4b8bf5; }
.live-status-bar.status-off .live-status-icon { background: #c3cbd8; }
.live-refresh { flex-shrink: 0; padding: 5px 9px; font-size: .68rem; }
.live-config-btn { width: 100%; }

/* ===== AI 卡片 ===== */
.ai-card { display: flex; flex-direction: column; gap: 9px; padding: 13px 14px; border: 1px solid var(--border); border-radius: 10px; background: #fff; transition: border-color .3s ease; }
.ai-card.flash { border-color: #b8ccf8; box-shadow: 0 0 0 1px rgba(40,100,240,.1); animation: cardFlash 1.5s ease; }
.ai-card-title { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--text-secondary); font-size: .8rem; font-weight: 700; }
.ai-link { padding: 0; border: none; color: var(--primary); background: transparent; font-size: .68rem; cursor: pointer; white-space: nowrap; }
.ai-topic { color: #14213a; font-size: .9rem; font-weight: 650; line-height: 1.55; }
.ai-topic.placeholder { color: var(--text-muted); font-weight: 400; }
.ai-summary-text { color: var(--text); font-size: .82rem; line-height: 1.7; white-space: pre-wrap; }
.ai-list { display: flex; flex-direction: column; gap: 6px; padding-left: 16px; }.ai-list li { color: var(--text); font-size: .81rem; line-height: 1.55; }
.ai-empty { color: var(--text-muted); font-size: .78rem; }
.ai-history { display: flex; flex-direction: column; gap: 8px; padding-top: 7px; border-top: 1px dashed var(--border); }
.ai-history-item { display: flex; gap: 8px; align-items: flex-start; }
.ai-history-time { flex: none; padding: 1px 6px; border-radius: 4px; color: var(--primary); background: #eef3ff; font-size: .66rem; font-weight: 600; white-space: nowrap; }
.ai-history-item p { color: var(--text-muted); font-size: .74rem; line-height: 1.55; }
.ai-todo-list { display: flex; flex-direction: column; gap: 7px; }
.ai-todo-item { padding: 8px 10px; border: 1px solid #e7ebf2; border-radius: 8px; background: #fbfcfe; }
.ai-todo-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.ai-todo-owner { padding: 1px 7px; border-radius: 999px; color: var(--primary); background: #eef3ff; font-size: .68rem; font-weight: 650; }
.ai-todo-deadline { color: var(--text-muted); font-size: .68rem; }
.ai-todo-task { margin-top: 4px; color: var(--text); font-size: .81rem; line-height: 1.5; }
.ai-final { border-color: #cdd9f2; background: linear-gradient(180deg,#f7f9ff,#fff); }
.ai-final-label { color: var(--text-secondary); font-size: .72rem; font-weight: 700; }

/* ===== 非录音模式样式 ===== */
.summary-section { display: flex; flex-direction: column; gap: 10px; padding: 14px; border: 1px solid var(--border); border-radius: 9px; background: #fff; }.section-title { display: flex; align-items: center; gap: 8px; color: var(--text-secondary); font-size: .82rem; font-weight: 700; }.section-title .badge { margin-left: auto; text-transform: none; }
.overview-stats { display: flex; gap: 10px; }.stat-item { flex: 1; padding: 9px 4px; border-radius: var(--radius-sm); background: var(--bg-secondary); text-align: center; }.stat-value { color: var(--primary); font-size: 1.2rem; font-weight: 700; }.stat-label { color: var(--text-muted); font-size: .69rem; }
.summary-text { padding: 11px 12px; border-left: 3px solid var(--primary); border-radius: var(--radius-sm); color: var(--text); background: #f7f9ff; font-size: .83rem; line-height: 1.75; white-space: pre-wrap; }.summary-text.flash { animation: summaryFlash 1.5s ease; }.generated-meta { display: flex; justify-content: space-between; gap: 8px; color: var(--text-muted); font-size: .65rem; }
.key-points { display: flex; flex-direction: column; gap: 8px; }.key-point { display: flex; align-items: flex-start; gap: 8px; }.point-bullet { width: 6px; height: 6px; flex-shrink: 0; margin-top: 7px; border-radius: 50%; background: var(--primary); }.point-text { color: var(--text); font-size: .81rem; line-height: 1.55; }.detail-list { display: flex; flex-direction: column; gap: 7px; padding-left: 17px; }.detail-list li { color: var(--text); font-size: .81rem; line-height: 1.55; }
.todo-list { display: flex; flex-direction: column; gap: 4px; }.todo-item { display: flex; align-items: flex-start; gap: 8px; padding: 6px 0; }.todo-check { position: relative; flex-shrink: 0; margin-top: 2px; cursor: pointer; }.todo-check input { position: absolute; width: 16px; height: 16px; opacity: 0; cursor: pointer; }.checkmark { display: block; width: 16px; height: 16px; border: 2px solid var(--border); border-radius: 4px; transition: var(--transition); }.todo-check input:checked ~ .checkmark { border-color: var(--success); background: var(--success); }.todo-check input:checked ~ .checkmark::after { content: '✓'; display: block; color: #fff; font-size: 10px; font-weight: 700; line-height: 12px; text-align: center; }.todo-content { flex: 1; display: flex; flex-direction: column; }.todo-text { font-size: .81rem; line-height: 1.5; }.todo-item.done .todo-text { color: var(--text-muted); text-decoration: line-through; }.todo-assignee { color: var(--primary); font-size: .7rem; font-weight: 500; }
.attendee-list { display: flex; flex-direction: column; gap: 6px; }.attendee-item { display: flex; align-items: center; gap: 8px; padding: 4px 0; }.attendee-avatar-sm { width: 24px; height: 24px; font-size: .68rem; }.attendee-info { display: flex; flex-direction: column; }.attendee-name { font-size: .8rem; font-weight: 500; }.attendee-role { color: var(--text-muted); font-size: .68rem; }.attendee-shortcut { margin-left: auto; padding: 2px 6px; border: 1px solid var(--border); border-bottom-width: 2px; border-radius: 4px; color: var(--text-muted); background: var(--bg-secondary); font-family: inherit; font-size: .65rem; white-space: nowrap; }
.empty-hint { padding: 7px 0; color: var(--text-muted); font-size: .78rem; line-height: 1.55; }
@keyframes statusPulse { 0% { box-shadow: 0 0 0 0 rgba(120,140,170,.35); } 70%,100% { box-shadow: 0 0 0 6px rgba(120,140,170,0); } }
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
@keyframes cardFlash { 0% { background: #eef4ff; } 100% { background: #fff; } }
@keyframes summaryFlash { 0% { background: #e8f3ff; border-left-color: #2563eb; } 100% { background: #f7f9ff; border-left-color: var(--primary); } }
@media (max-width: 700px) { .generated-meta,.generate-card { align-items: flex-start; flex-direction: column; }.generate-card .btn { width: 100%; } }
</style>
