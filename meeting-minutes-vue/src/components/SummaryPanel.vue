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
})
const emit = defineEmits(['toggle', 'open-provider-settings'])
const store = useStore()
const { auth } = useAuth()
const notify = useNotify()
const generating = ref(false)
const autoEnabled = ref(false)
const autoError = ref('')
const nextRefreshIn = ref(60)
const lastSubmittedFingerprint = ref('')
let autoClock = null
let finalRefreshTimer = null

const aiSummary = computed(() => store.meeting.value.aiSummary || null)
const defaultProvider = computed(() => {
  const preferences = auth.user?.preferences
  return (preferences?.aiProviders || []).find(item => item.id === preferences?.defaultAiProviderId) || null
})
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
const liveCharacters = computed(() => props.liveTranscript.trim().length)
const liveStatus = computed(() => {
  if (generating.value) return '正在整理最新内容…'
  if (!autoEnabled.value) return '实时总结未开启'
  if (autoError.value) return autoError.value
  if (!props.recordingActive) return '等待开始录音'
  return `${nextRefreshIn.value} 秒后检查新增内容`
})

function summaryFingerprint() {
  const entryPart = store.entries.value.map(entry => `${entry.id}:${entry.content}`).join('|')
  return `${entryPart}::${props.liveTranscript.trim()}`
}

async function generateSummary({ live = false, silent = false, force = true } = {}) {
  if (!defaultProvider.value) {
    if (!silent) {
      notify.warning('请先配置并设置默认 AI 供应商')
      emit('open-provider-settings')
    }
    return
  }
  const fingerprint = summaryFingerprint()
  if (!force && fingerprint === lastSubmittedFingerprint.value) return
  generating.value = true
  autoError.value = ''
  try {
    await authRequest('POST', `/meetings/${store.activeMeetingId.value}/ai-summary`, {
      liveTranscript: props.recordingMode ? props.liveTranscript.trim() : '',
      mode: live ? 'live' : 'final',
    })
    lastSubmittedFingerprint.value = fingerprint
    await store.refetch()
    if (!silent) notify.success(live ? '阶段性总结已更新' : 'AI 总结已生成并保存到当前会议')
  } catch (error) {
    autoError.value = error.message
    if (!silent) notify.error(error.message)
  }
  finally { generating.value = false }
}

async function toggleAutoSummary() {
  if (autoEnabled.value) {
    autoEnabled.value = false
    autoError.value = ''
    return
  }
  if (!defaultProvider.value) {
    notify.warning('请先配置并设置默认 AI 供应商')
    emit('open-provider-settings')
    return
  }
  autoEnabled.value = true
  nextRefreshIn.value = 60
  await generateSummary({ live: true, silent: true, force: true })
}

function tickAutoSummary() {
  if (!props.recordingMode || !autoEnabled.value || !props.recordingActive || generating.value) return
  nextRefreshIn.value -= 1
  if (nextRefreshIn.value > 0) return
  nextRefreshIn.value = 60
  generateSummary({ live: true, silent: true, force: false })
}

autoClock = window.setInterval(tickAutoSummary, 1000)
watch(() => props.recordingActive, (active, previous) => {
  if (active) {
    nextRefreshIn.value = 60
    return
  }
  if (previous && autoEnabled.value) {
    window.clearTimeout(finalRefreshTimer)
    finalRefreshTimer = window.setTimeout(async () => {
      await generateSummary({ live: false, silent: true, force: true })
      autoEnabled.value = false
    }, 1800)
  }
})
watch(() => store.activeMeetingId.value, () => {
  autoEnabled.value = false
  autoError.value = ''
  lastSubmittedFingerprint.value = ''
  nextRefreshIn.value = 60
})
onBeforeUnmount(() => {
  window.clearInterval(autoClock)
  window.clearTimeout(finalRefreshTimer)
})

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
  <div class="summary-panel" :class="{ fullpage, recording: recordingMode }">
    <div v-if="!fullpage" class="panel-header">
      <div><h3><SvgIcon name="sparkles" :size="16" /> {{ recordingMode ? '实时 AI 总结' : 'AI 总结' }}</h3><small v-if="recordingMode">随录音内容持续更新</small></div>
      <button v-if="!recordingMode" class="btn-icon" title="收起" @click="emit('toggle')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
    </div>

    <div class="panel-body">
      <div class="assistant-status" :class="{ ready: defaultProvider }">
        <span><SvgIcon name="sparkles" :size="15" /> {{ defaultProvider ? `默认：${defaultProvider.name}` : '尚未配置 AI 供应商' }}</span><i></i>
      </div>

      <div v-if="recordingMode" class="live-summary-control" :class="{ active: autoEnabled }">
        <div class="live-summary-state">
          <span class="live-summary-dot"></span>
          <div><strong>{{ autoEnabled ? '实时总结运行中' : '开启会议实时总结' }}</strong><p>{{ liveStatus }}</p></div>
        </div>
        <div v-if="defaultProvider" class="live-summary-actions">
          <button class="btn" :class="autoEnabled ? 'btn-ghost' : 'btn-primary'" :disabled="generating" @click="toggleAutoSummary">{{ autoEnabled ? '停止' : '开始' }}</button>
          <button class="btn btn-ghost" :disabled="generating" @click="generateSummary({ live: recordingActive, force: true })">立即更新</button>
        </div>
        <button v-else class="btn btn-primary" @click="emit('open-provider-settings')">配置供应商</button>
        <small class="cost-hint">开启后约每 60 秒在内容有变化时调用一次默认供应商；每次调用可能产生费用。</small>
      </div>

      <div v-else class="generate-card">
        <div>
          <strong>{{ aiSummary ? '重新整理当前会议' : '生成结构化 AI 总结' }}</strong>
          <p>{{ defaultProvider ? `使用 ${defaultProvider.model}，仅在你点击时发起请求。` : '先配置供应商和 API Key，再生成总结。' }}</p>
        </div>
        <button v-if="defaultProvider" class="btn btn-primary" :disabled="generating" @click="generateSummary()">
          <SvgIcon name="sparkles" :size="14" /> {{ generating ? '生成中…' : (aiSummary ? '重新生成' : '生成总结') }}
        </button>
        <button v-else class="btn btn-primary" @click="emit('open-provider-settings')">配置供应商</button>
      </div>

      <div class="summary-section">
        <div class="section-title"><SvgIcon name="clipboard" :size="14" /> AI 摘要</div>
        <div v-if="!recordingMode" class="overview-stats">
          <div class="stat-item"><div class="stat-value">{{ store.entries.value.length }}</div><div class="stat-label">记录条数</div></div>
          <div class="stat-item"><div class="stat-value">{{ store.persons.value.length }}</div><div class="stat-label">参会人员</div></div>
          <div class="stat-item"><div class="stat-value">{{ store.topics.value.length }}</div><div class="stat-label">主题数</div></div>
        </div>
        <div v-else class="live-overview">
          <span><strong>{{ liveCharacters }}</strong>实时文字</span>
          <span><strong>{{ store.entries.value.length }}</strong>手动记录</span>
          <span><strong>{{ aiSummary ? '已更新' : '等待中' }}</strong>总结状态</span>
        </div>
        <p v-if="aiSummary" class="summary-text">{{ aiSummary.summary }}</p>
        <div v-else class="empty-hint">{{ recordingMode ? '开始录音后开启实时总结，阶段性结论会显示在这里。' : '尚未生成。点击上方按钮后才会调用 AI 供应商。' }}</div>
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

      <div v-if="!recordingMode" class="summary-section">
        <div class="section-title"><SvgIcon name="list-checks" :size="14" /> 待办事项 <span class="badge badge-gray">{{ pendingTodos.length }}/{{ store.todos.value.length }}</span></div>
        <div v-if="store.todos.value.length" class="todo-list">
          <div v-for="todo in store.todos.value" :key="todo.id" class="todo-item" :class="{ done: todo.done }">
            <label class="todo-check"><input type="checkbox" :checked="todo.done" @change="toggleTodo(todo)" /><span class="checkmark"></span></label>
            <div class="todo-content"><span class="todo-text">{{ todo.content }}</span><span v-if="assigneeName(todo.assigneeId)" class="todo-assignee">@{{ assigneeName(todo.assigneeId) }}</span></div>
          </div>
        </div>
        <div v-else class="empty-hint">暂无待办</div>
      </div>

      <div v-if="!recordingMode" class="summary-section">
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
    </div>
  </div>
</template>

<style scoped>
.summary-panel { width: 340px; flex-shrink: 0; display: flex; flex-direction: column; overflow-y: auto; border-left: 1px solid var(--border); background: var(--surface); }
.summary-panel.fullpage { width: 100%; max-width: 760px; margin: 24px auto; overflow: visible; border-left: none; border-radius: var(--radius); box-shadow: var(--shadow); }
.summary-panel.recording { width: 100%; max-height: calc(100vh - 205px); align-self: start; position: sticky; top: 0; overflow-y: auto; border: 1px solid #dfe4ec; border-radius: 14px; box-shadow: 0 8px 28px rgba(32,52,89,.055); }
.panel-header { display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; padding: 16px 20px; border-bottom: 1px solid var(--border); }.panel-header>div { min-width: 0; }.panel-header h3 { display: flex; align-items: center; gap: 6px; font-size: .95rem; font-weight: 700; }.panel-header small { display: block; margin-top: 2px; color: var(--text-muted); font-size: .66rem; }
.panel-body { display: flex; flex-direction: column; gap: 10px; padding: 14px; background: #fbfcff; }
.assistant-status { display: flex; align-items: center; justify-content: space-between; padding: 11px 13px; border: 1px solid #ead5d2; border-radius: 9px; color: #a84032; background: #fff8f7; font-size: .78rem; font-weight: 650; }.assistant-status.ready { border-color: #dbe5fb; color: var(--primary); background: #f7f9ff; }.assistant-status span { display: flex; align-items: center; gap: 7px; min-width: 0; }.assistant-status i { width: 7px; height: 7px; flex-shrink: 0; border-radius: 50%; background: #d36757; box-shadow: 0 0 0 3px #fae9e6; }.assistant-status.ready i { background: #36ad75; box-shadow: 0 0 0 3px #e4f6ed; }
.generate-card { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 13px 14px; border: 1px solid #dbe5fb; border-radius: 9px; background: linear-gradient(135deg,#f7f9ff,#f4f8ff); }.generate-card div { min-width: 0; }.generate-card strong { display: block; font-size: .82rem; }.generate-card p { margin-top: 3px; color: var(--text-muted); font-size: .69rem; line-height: 1.45; }.generate-card .btn { flex-shrink: 0; padding: 7px 9px; font-size: .72rem; }
.live-summary-control { display: flex; flex-direction: column; gap: 10px; padding: 13px; border: 1px solid #dbe5fb; border-radius: 10px; background: linear-gradient(135deg,#f7f9ff,#f4f8ff); }.live-summary-control.active { border-color: #bdccfa; box-shadow: inset 0 0 0 1px rgba(40,100,240,.06); }.live-summary-state { display: flex; align-items: center; gap: 9px; }.live-summary-state>div { min-width: 0; }.live-summary-state strong { display: block; color: #213250; font-size: .78rem; }.live-summary-state p { margin-top: 2px; overflow: hidden; color: var(--text-muted); font-size: .67rem; text-overflow: ellipsis; white-space: nowrap; }.live-summary-dot { width: 9px; height: 9px; flex: none; border-radius: 50%; background: #aeb8c8; }.live-summary-control.active .live-summary-dot { background: #37ad76; box-shadow: 0 0 0 4px rgba(55,173,118,.12); animation: summaryPulse 1.8s ease-out infinite; }.live-summary-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }.live-summary-actions .btn,.live-summary-control>.btn { min-height: 34px; justify-content: center; font-size: .7rem; }.cost-hint { color: var(--text-muted); font-size: .62rem; line-height: 1.45; }
.summary-section { display: flex; flex-direction: column; gap: 10px; padding: 14px; border: 1px solid var(--border); border-radius: 9px; background: #fff; }.section-title { display: flex; align-items: center; gap: 8px; color: var(--text-secondary); font-size: .82rem; font-weight: 700; }.section-title .badge { margin-left: auto; text-transform: none; }
.overview-stats { display: flex; gap: 10px; }.stat-item { flex: 1; padding: 9px 4px; border-radius: var(--radius-sm); background: var(--bg-secondary); text-align: center; }.stat-value { color: var(--primary); font-size: 1.2rem; font-weight: 700; }.stat-label { color: var(--text-muted); font-size: .69rem; }
.live-overview { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 6px; }.live-overview span { min-width: 0; display: flex; flex-direction: column; padding: 8px 5px; border-radius: 7px; color: var(--text-muted); background: var(--bg-secondary); text-align: center; font-size: .61rem; }.live-overview strong { overflow: hidden; color: var(--primary); font-size: .76rem; text-overflow: ellipsis; white-space: nowrap; }
.summary-text { padding: 11px 12px; border-left: 3px solid var(--primary); border-radius: var(--radius-sm); color: var(--text); background: #f7f9ff; font-size: .83rem; line-height: 1.75; white-space: pre-wrap; }.generated-meta { display: flex; justify-content: space-between; gap: 8px; color: var(--text-muted); font-size: .65rem; }
.key-points { display: flex; flex-direction: column; gap: 8px; }.key-point { display: flex; align-items: flex-start; gap: 8px; }.point-bullet { width: 6px; height: 6px; flex-shrink: 0; margin-top: 7px; border-radius: 50%; background: var(--primary); }.point-text { color: var(--text); font-size: .81rem; line-height: 1.55; }.detail-list { display: flex; flex-direction: column; gap: 7px; padding-left: 17px; }.detail-list li { color: var(--text); font-size: .81rem; line-height: 1.55; }
.todo-list { display: flex; flex-direction: column; gap: 4px; }.todo-item { display: flex; align-items: flex-start; gap: 8px; padding: 6px 0; }.todo-check { position: relative; flex-shrink: 0; margin-top: 2px; cursor: pointer; }.todo-check input { position: absolute; width: 16px; height: 16px; opacity: 0; cursor: pointer; }.checkmark { display: block; width: 16px; height: 16px; border: 2px solid var(--border); border-radius: 4px; transition: var(--transition); }.todo-check input:checked ~ .checkmark { border-color: var(--success); background: var(--success); }.todo-check input:checked ~ .checkmark::after { content: '✓'; display: block; color: #fff; font-size: 10px; font-weight: 700; line-height: 12px; text-align: center; }.todo-content { flex: 1; display: flex; flex-direction: column; }.todo-text { font-size: .81rem; line-height: 1.5; }.todo-item.done .todo-text { color: var(--text-muted); text-decoration: line-through; }.todo-assignee { color: var(--primary); font-size: .7rem; font-weight: 500; }
.attendee-list { display: flex; flex-direction: column; gap: 6px; }.attendee-item { display: flex; align-items: center; gap: 8px; padding: 4px 0; }.attendee-avatar-sm { width: 24px; height: 24px; font-size: .68rem; }.attendee-info { display: flex; flex-direction: column; }.attendee-name { font-size: .8rem; font-weight: 500; }.attendee-role { color: var(--text-muted); font-size: .68rem; }.attendee-shortcut { margin-left: auto; padding: 2px 6px; border: 1px solid var(--border); border-bottom-width: 2px; border-radius: 4px; color: var(--text-muted); background: var(--bg-secondary); font-family: inherit; font-size: .65rem; white-space: nowrap; }
.empty-hint { padding: 7px 0; color: var(--text-muted); font-size: .78rem; line-height: 1.55; }
@keyframes summaryPulse { 0% { box-shadow: 0 0 0 0 rgba(55,173,118,.28); } 70%,100% { box-shadow: 0 0 0 6px rgba(55,173,118,0); } }
@media (max-width: 700px) { .generated-meta,.generate-card { align-items: flex-start; flex-direction: column; }.generate-card .btn { width: 100%; } }
</style>
