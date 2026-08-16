<script setup>
import { computed, defineAsyncComponent, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useStore } from './composables/useStore'
import { useAuth } from './composables/useAuth'
import LoginView from './views/LoginView.vue'
import TheSidebar from './components/TheSidebar.vue'
import TheHeader from './components/TheHeader.vue'
import TimelineView from './views/TimelineView.vue'
import SpeakerView from './views/SpeakerView.vue'
import TopicView from './views/TopicView.vue'
import SummaryPanel from './components/SummaryPanel.vue'
import TodoView from './views/TodoView.vue'
import EntryEditor from './components/EntryEditor.vue'
import PersonnelModal from './components/PersonnelModal.vue'
import LabelModal from './components/LabelModal.vue'
import NotificationCenter from './components/NotificationCenter.vue'
import ArchiveView from './views/ArchiveView.vue'
import SeatingView from './views/SeatingView.vue'
import AppBreadcrumb from './components/AppBreadcrumb.vue'
import NewMeetingModal from './components/NewMeetingModal.vue'
import DateTimePicker from './components/DateTimePicker.vue'
import AudioRecorder from './components/AudioRecorder.vue'
import UserSettingsModal from './components/UserSettingsModal.vue'
import { useNotify } from './composables/useNotify'

const store = useStore()
const MindMapView = defineAsyncComponent(() => import('./views/MindMapView.vue'))
const { auth, isAuthenticated, logout } = useAuth()
const notify = useNotify()
const route = useRoute()
const router = useRouter()
const minuteViews = new Set(['timeline', 'speaker', 'topic', 'mindmap'])
const activeTab = computed(() => route.meta.tab || 'minutes')
const activeView = computed(() => minuteViews.has(route.query.view) ? route.query.view : 'timeline')
const showPersonnelModal = ref(false)
const showLabelModal = ref(false)
const showNewMeetingModal = ref(false)
const showUserSettingsModal = ref(false)
const showSummaryPanel = ref(true)
const meetingDraft = ref(null)
const recordingStatus = ref('idle')
const recorderRef = ref(null)
const currentTime = ref(Date.now())
let meetingSaveTimer = null
let statusClockTimer = window.setInterval(() => { currentTime.value = Date.now() }, 30000)

onBeforeUnmount(() => window.clearInterval(statusClockTimer))

watch(() => store.activeMeetingId.value, () => { recordingStatus.value = 'idle' })

function handleRecordingStatusChange(event) {
  if (!event || event.meetingId !== store.activeMeetingId.value) return
  const previousStatus = recordingStatus.value
  recordingStatus.value = event.status
  const wasCapturing = previousStatus === 'recording' || previousStatus === 'paused'
  const captureEnded = event.status !== 'recording' && event.status !== 'paused'
  if (wasCapturing && captureEnded) {
    store.touchMeetingEnd().catch(error => notify.error(`自动更新会议结束时间失败：${error.message}`))
  }
}

const meetingInProgress = computed(() => {
  const meeting = store.meeting.value
  if (meeting.status === 'ended') return false
  if (!meeting.date || (!meeting.startTime && !meeting.endTime)) return false
  const now = new Date(currentTime.value)
  const pad = value => String(value).padStart(2, '0')
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  if (meeting.date !== today) return false
  const currentMinutes = now.getHours() * 60 + now.getMinutes()
  const toMinutes = value => {
    const [hours, minutes] = value.split(':').map(Number)
    return hours * 60 + minutes
  }
  if (meeting.startTime && currentMinutes < toMinutes(meeting.startTime)) return false
  if (meeting.endTime && currentMinutes > toMinutes(meeting.endTime)) return false
  return true
})
const meetingEnded = computed(() => store.meeting.value.status === 'ended')

const isCapturing = computed(() => recordingStatus.value === 'recording' || recordingStatus.value === 'paused')

async function confirmAndStopRecording({ title, message, confirmText }) {
  if (!isCapturing.value) return true
  const confirmed = await notify.confirm({ title, message, confirmText, danger: true })
  if (!confirmed) return false
  await recorderRef.value?.stop()
  return true
}

async function selectMeetingWithGuard(id) {
  if (!id || id === store.activeMeetingId.value) {
    await switchTab('minutes')
    return
  }
  const target = store.meetings.value.find(meeting => meeting.id === id)
  const allowed = await confirmAndStopRecording({
    title: '切换会议',
    message: `当前会议正在录音。切换到「${target?.title || '未命名会议'}」前将先结束并保存当前录音，是否继续？`,
    confirmText: '结束录音并切换',
  })
  if (!allowed) return
  try {
    await store.selectMeeting(id)
    await switchTab('minutes')
    notify.success('已切换会议纪要')
  } catch (error) { notify.error(error.message) }
}

async function toggleMeetingStatus() {
  if (meetingEnded.value) {
    try {
      await store.updateMeeting({ status: 'active', endTime: '' })
      notify.success('会议已重新开启')
    } catch (error) { notify.error(error.message) }
    return
  }
  const hadRecording = isCapturing.value
  const allowed = await confirmAndStopRecording({
    title: '结束会议',
    message: '结束会议后将停止当前录音，并暂停新增记录。之后仍可重新开启会议。',
    confirmText: '结束会议',
  })
  if (!allowed) return
  if (!hadRecording) {
    const confirmed = await notify.confirm({
      title: '结束会议',
      message: '结束后将暂停新增记录，之后仍可重新开启会议。',
      confirmText: '结束会议',
    })
    if (!confirmed) return
  }
  try {
    const now = new Date()
    const pad = value => String(value).padStart(2, '0')
    const endTime = `${pad(now.getHours())}:${pad(now.getMinutes())}`
    await store.updateMeeting({ status: 'ended', endTime })
    notify.success('会议已结束')
  } catch (error) { notify.error(error.message) }
}

watch(isAuthenticated, async (loggedIn) => {
  if (loggedIn) {
    await store.loadAll()
    if (route.name === 'login') {
      const redirect = store.meetings.value.length && typeof route.query.redirect === 'string' ? route.query.redirect : '/archive'
      await router.replace(redirect)
    } else if (!store.meetings.value.length && route.name !== 'archive') {
      await router.replace({ name: 'archive' })
    }
  } else {
    store.clearState()
    if (auth.ready && route.name !== 'login') {
      await router.replace({ name: 'login', query: { redirect: route.fullPath } })
    }
  }
}, { immediate: true })

watch(() => auth.ready, (ready) => {
  if (ready && !isAuthenticated.value && route.name !== 'login') {
    router.replace({ name: 'login', query: { redirect: route.fullPath } })
  }
}, { immediate: true })

async function handleLogout() {
  await logout()
  store.clearState()
  await router.replace({ name: 'login' })
}

const tabs = [
  { key: 'minutes', label: '手动记录', icon: 'edit-3' },
  { key: 'recording', label: '自动录音', icon: 'microphone' },
  { key: 'summary', label: '会议纪要', icon: 'sparkles' },
  { key: 'todos', label: '待办事项', icon: 'check-square' },
  { key: 'seating', label: '座位图', icon: 'users' },
  { key: 'settings', label: '设置', icon: 'settings' }
]

const viewTabs = [
  { key: 'timeline', label: '时间轴', icon: 'clock' },
  { key: 'speaker', label: '发言人', icon: 'users' },
  { key: 'topic', label: '主题', icon: 'tag' },
  { key: 'mindmap', label: '思维导图', icon: 'git-branch' }
]

const pageLabels = {
  minutes: '手动记录',
  recording: '自动录音',
  summary: '智能摘要',
  todos: '待办事项',
  seating: '座位图',
  settings: '设置',
}

const breadcrumbs = computed(() => {
  if (activeTab.value === 'archive') return [
    { key: 'root', label: '我的纪要' },
    { key: 'archive', label: '历史会议' },
  ]
  return [
    { key: 'root', label: '我的纪要', action: 'archive' },
    { key: 'meeting', label: store.meeting.value.title || '未命名会议', action: 'minutes' },
    { key: activeTab.value, label: pageLabels[activeTab.value] || '纪要' },
  ]
})

function switchTab(key) {
  if (key !== 'archive' && !store.meetings.value.length) {
    notify.error('请先新建一份会议纪要')
    return
  }
  router.push(key === 'minutes' ? { name: 'minutes' } : { name: key })
}
function switchView(key) {
  router.push({ name: 'minutes', query: key === 'timeline' ? {} : { view: key } })
}
function toggleSummary() { showSummaryPanel.value = !showSummaryPanel.value }
function navigateBreadcrumb(action) { switchTab(action) }

async function handleReset() {
  const confirmed = await notify.confirm({ title: '清空当前会议', message: '将清空当前会议的人员、记录、主题、待办和标签，其他历史会议不受影响。', confirmText: '清空', danger: true })
  if (!confirmed) return
  try {
    await store.resetAll()
    notify.success('当前会议已清空')
  } catch (e) { notify.error(e.message) }
}

async function flushMeetingDraft() {
  clearTimeout(meetingSaveTimer)
  const pending = meetingDraft.value
  meetingDraft.value = null
  if (pending) await store.updateMeeting(pending)
}

async function openNewMeetingModal() {
  try {
    const allowed = await confirmAndStopRecording({
      title: '新建会议',
      message: '当前会议正在录音。新建会议前将先结束并保存当前录音，是否继续？',
      confirmText: '结束录音并继续',
    })
    if (!allowed) return
    await flushMeetingDraft()
    showNewMeetingModal.value = true
  } catch (e) { notify.error(`当前会议保存失败：${e.message}`) }
}

async function createMeeting(input) {
  try {
    await store.createMeeting(input)
    showNewMeetingModal.value = false
    await router.push({ name: 'minutes' })
    notify.success('会议纪要已创建')
    return true
  } catch (e) {
    notify.error(e.message)
    return false
  }
}

function setMeeting(patch) {
  store.state.data.meeting = { ...store.meeting.value, ...patch }
  meetingDraft.value = { ...(meetingDraft.value || {}), ...patch }
  clearTimeout(meetingSaveTimer)
  meetingSaveTimer = setTimeout(() => flushMeetingDraft().catch((e) => { store.state.error = e.message }), 500)
}
</script>

<template>
  <div v-if="!auth.ready" class="app-loading">
    <div class="loading-mark"><SvgIcon name="clipboard" :size="26" /></div>
    <span>正在加载…</span>
  </div>
  <LoginView v-else-if="!isAuthenticated" />
  <div v-else class="app-layout">
    <TheSidebar
      :recording-status="recordingStatus"
      :meeting-ended="meetingEnded"
      @open-personnel="showPersonnelModal = true"
      @open-label="showLabelModal = true"
      @new-meeting="openNewMeetingModal"
      @open-settings="switchTab('settings')"
      @open-archive="switchTab('archive')"
      @open-meeting="switchTab('minutes')"
      @select-meeting="selectMeetingWithGuard"
      @open-user-settings="showUserSettingsModal = true"
      @logout="handleLogout"
    />
    <div class="app-main">
      <AppBreadcrumb :items="breadcrumbs" @navigate="navigateBreadcrumb" />
      <TheHeader
        v-if="activeTab !== 'archive'"
        :active-tab="activeTab"
        :tabs="tabs"
        :recording-status="recordingStatus"
        :meeting-in-progress="meetingInProgress"
        :meeting-ended="meetingEnded"
        @switch-tab="switchTab"
        @toggle-summary="toggleSummary"
        @open-personnel="showPersonnelModal = true"
        @open-label="showLabelModal = true"
        @toggle-meeting-status="toggleMeetingStatus"
      />
      <div v-if="store.state.error" class="connection-error">
        {{ store.state.error }}
        <button @click="store.loadAll()">重试</button>
      </div>
      <div v-if="store.state.loading && !store.state.ready" class="content-loading">正在加载你的纪要…</div>
      <div class="content-area">
        <!-- 录音组件保持挂载，切换到其他功能后仍在后台继续录音。 -->
        <div
          v-if="store.meetings.value.length"
          v-show="activeTab === 'recording'"
          class="recording-tab"
        >
          <div class="recording-intro">
            <div>
              <h2>录音工作台</h2>
              <p>录音、播放、时间轴与转写集中在一个工作区。</p>
            </div>
            <span class="background-chip" :class="{ active: isCapturing }"><SvgIcon :name="isCapturing ? 'microphone' : 'check-circle'" :size="14" /> {{ recordingStatus === 'recording' ? '后台录音中' : recordingStatus === 'paused' ? '录音已暂停' : '可后台运行' }}</span>
          </div>
          <AudioRecorder
            ref="recorderRef"
            :key="store.activeMeetingId.value"
            :meeting-id="store.activeMeetingId.value"
            :meeting-title="store.meeting.value.title"
            :meeting-ended="meetingEnded"
            @status-change="handleRecordingStatusChange"
          />
        </div>

        <!-- 纪要 Tab -->
        <template v-if="activeTab === 'minutes'">
          <div class="minutes-layout">
            <div class="minutes-center">
              <!-- 视图切换 -->
              <div class="view-switcher">
                <button
                  v-for="v in viewTabs"
                  :key="v.key"
                  class="view-tab"
                  :class="{ active: activeView === v.key }"
                  @click="switchView(v.key)"
                >
                  <SvgIcon :name="v.icon" :size="14" />
                  {{ v.label }}
                </button>
              </div>

              <!-- 视图内容 -->
              <div class="view-content">
                <TimelineView v-if="activeView === 'timeline'" />
                <SpeakerView v-else-if="activeView === 'speaker'" />
                <TopicView v-else-if="activeView === 'topic'" />
                <MindMapView v-else-if="activeView === 'mindmap'" />
              </div>

              <!-- 底部录入 -->
              <EntryEditor :disabled="meetingEnded" />
            </div>

            <!-- 右侧摘要面板 -->
            <transition name="slide-right">
              <SummaryPanel v-if="showSummaryPanel" @toggle="toggleSummary" />
            </transition>
          </div>
        </template>

        <!-- 待办事项 Tab -->
        <TodoView v-else-if="activeTab === 'todos'" />

        <ArchiveView v-else-if="activeTab === 'archive'" :recording-status="recordingStatus" @open-meeting="switchTab('minutes')" @select-meeting="selectMeetingWithGuard" />

        <SeatingView v-else-if="activeTab === 'seating'" />

        <!-- 智能摘要 Tab -->
        <div v-else-if="activeTab === 'summary'" class="summary-tab">
          <SummaryPanel :fullpage="true" @toggle="toggleSummary" />
        </div>

        <!-- 设置 Tab -->
        <div v-else-if="activeTab === 'settings'" class="settings-tab">
          <div class="settings-content">
            <h3>会议设置</h3>
            <div class="settings-form">
            <div class="form-row">
              <label>会议标题</label>
              <input class="input" :value="store.meeting.value.title" @input="setMeeting({ title: $event.target.value })" />
            </div>
            <div class="form-row">
              <label>日期</label>
              <DateTimePicker :model-value="store.meeting.value.date" @update:model-value="setMeeting({ date: $event })" />
            </div>
            <div class="form-row-inline">
              <div class="form-row">
                <label>开始时间</label>
                <DateTimePicker mode="time" :model-value="store.meeting.value.startTime" @update:model-value="setMeeting({ startTime: $event })" />
              </div>
              <div class="form-row">
                <label>结束时间</label>
                <DateTimePicker mode="time" :model-value="store.meeting.value.endTime" @update:model-value="setMeeting({ endTime: $event })" />
              </div>
            </div>
            <div class="form-row">
              <label>地点</label>
              <input class="input" :value="store.meeting.value.location" @input="setMeeting({ location: $event.target.value })" />
            </div>
              <div class="form-row danger-row">
                <button class="btn btn-danger" @click="handleReset">
                  <SvgIcon name="trash" :size="14" /> 清空所有数据
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 人员管理弹窗 -->
    <PersonnelModal v-if="showPersonnelModal" @close="showPersonnelModal = false" />
    <LabelModal v-if="showLabelModal" @close="showLabelModal = false" />
    <NewMeetingModal v-if="showNewMeetingModal" :has-persons="Boolean(store.persons.value.length)" :has-seats="Boolean(store.seats.value.length)" :on-create="createMeeting" @close="showNewMeetingModal = false" />
    <UserSettingsModal v-if="showUserSettingsModal" @close="showUserSettingsModal = false" />
    <NotificationCenter />
  </div>
</template>

<style scoped>
.app-layout {
  display: flex;
  height: 100vh;
  overflow: hidden;
}
.app-loading {
  height: 100vh; display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 12px; color: var(--text-muted); background: var(--bg-secondary);
}
.loading-mark {
  width: 52px; height: 52px; display: grid; place-items: center; color: #fff;
  border-radius: 14px; background: var(--primary);
}
.app-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}
.content-area {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.connection-error {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 7px 16px;
  color: #991b1b;
  background: #fee2e2;
  border-bottom: 1px solid #fecaca;
  font-size: .8rem;
}
.connection-error button { color: #b91c1c; font-weight: 700; text-decoration: underline; }
.content-loading { padding: 9px 16px; text-align: center; color: var(--text-muted); background: var(--surface); border-bottom: 1px solid var(--border); }

.minutes-layout {
  display: flex;
  flex: 1;
  overflow: hidden;
}
.minutes-center {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
  background: var(--bg-secondary);
  padding: 18px 20px 0;
  gap: 12px;
}

.meeting-info-card {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 24px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.meeting-title-input {
  border: none;
  font-size: 1.15rem;
  font-weight: 700;
  padding: 4px 6px;
  border-radius: 4px;
  transition: var(--transition);
  background: transparent;
  width: 100%;
  color: var(--text);
}
.meeting-title-input::placeholder { color: var(--text-muted); font-weight: 400; }
.meeting-title-input:hover { background: var(--bg-secondary); }
.meeting-title-input:focus { outline: none; background: var(--bg-secondary); box-shadow: 0 0 0 2px var(--primary-light); }
.meeting-meta-row {
  display: flex;
  gap: 20px;
  margin-top: 6px;
  flex-wrap: wrap;
}
.meta-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: .8rem;
  color: var(--text-secondary);
}
.meeting-info-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}
.attendee-avatars { display: flex; }
.attendee-avatar {
  width: 32px; height: 32px;
  font-size: .75rem;
  margin-left: -8px;
  border: 2px solid var(--surface);
}
.attendee-avatar:first-child { margin-left: 0; }
.attendee-more {
  background: var(--bg-secondary) !important;
  color: var(--text-secondary) !important;
  font-size: .7rem;
}

.view-switcher {
  display: flex;
  gap: 2px;
  padding: 0 4px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.view-tab {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 14px;
  border-radius: var(--radius-sm);
  font-size: .82rem;
  color: var(--text-secondary);
  transition: var(--transition);
}
.view-tab:hover { background: var(--bg-secondary); color: var(--text); }
.view-tab.active { background: var(--primary-light); color: var(--primary); font-weight: 600; }

.view-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px 4px;
}
.recording-tab {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 22px 28px 30px;
  background: var(--bg-secondary);
}
.recording-intro {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  max-width: 1080px;
  margin: 0 auto 14px;
}
.recording-intro h2 { color: #14213a; font-size: 1.16rem; }
.recording-intro p { margin-top: 2px; color: var(--text-muted); font-size: .78rem; }
.recording-tab :deep(.audio-recorder) { max-width: 1080px; margin: 0 auto; }
.background-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border-radius: var(--radius-full);
  color: var(--text-secondary);
  background: #edf0f5;
  font-size: .75rem;
  font-weight: 600;
  white-space: nowrap;
}
.background-chip.active { color: #d83b3b; background: #fff0ee; }

.slide-right-enter-active, .slide-right-leave-active { transition: all .25s ease; }
.slide-right-enter-from, .slide-right-leave-to { opacity: 0; transform: translateX(20px); }

.empty-tab {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
}
.empty-tab .empty-icon { margin-bottom: 12px; color: var(--text-muted); }

.summary-tab,
.settings-tab {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}
.summary-tab {
  background: var(--bg-secondary);
}
.settings-content {
  padding: 24px;
  max-width: 680px;
}
.settings-content h3 {
  font-size: 1.1rem;
  margin-bottom: 20px;
}
.settings-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.form-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.form-row label {
  font-size: .82rem;
  font-weight: 600;
  color: var(--text-secondary);
}
.form-row-inline {
  display: flex;
  gap: 16px;
}
.form-row-inline .form-row { flex: 1; }
.danger-row {
  margin-top: 12px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}
@media (max-width: 760px) {
  .recording-tab { padding: 16px; }
  .recording-intro { align-items: flex-start; }
  .recording-intro p { max-width: 260px; }
  .background-chip { padding: 4px 8px; font-size: .68rem; }
}
</style>
