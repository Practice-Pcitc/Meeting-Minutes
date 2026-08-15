<script setup>
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import { useStore } from './composables/useStore'
import { useAuth } from './composables/useAuth'
import LoginPage from './components/LoginPage.vue'
import TheSidebar from './components/TheSidebar.vue'
import TheHeader from './components/TheHeader.vue'
import TimelineView from './components/TimelineView.vue'
import SpeakerView from './components/SpeakerView.vue'
import TopicView from './components/TopicView.vue'
import SummaryPanel from './components/SummaryPanel.vue'
import TodoPanel from './components/TodoPanel.vue'
import EntryEditor from './components/EntryEditor.vue'
import PersonnelModal from './components/PersonnelModal.vue'
import LabelModal from './components/LabelModal.vue'
import NotificationCenter from './components/NotificationCenter.vue'
import MeetingArchive from './components/MeetingArchive.vue'
import SeatingChart from './components/SeatingChart.vue'
import AppBreadcrumb from './components/AppBreadcrumb.vue'
import { useNotify } from './composables/useNotify'

const store = useStore()
const MindMapView = defineAsyncComponent(() => import('./components/MindMapView.vue'))
const { auth, isAuthenticated, logout } = useAuth()
const notify = useNotify()
const activeTab = ref('minutes')
const activeView = ref('timeline')
const showPersonnelModal = ref(false)
const showLabelModal = ref(false)
const showSummaryPanel = ref(true)
const meetingDraft = ref(null)
let meetingSaveTimer = null

watch(isAuthenticated, async (loggedIn) => {
  if (loggedIn) await store.loadAll()
  else store.clearState()
}, { immediate: true })

async function handleLogout() {
  await logout()
  store.clearState()
}

const tabs = [
  { key: 'minutes', label: '纪要', icon: 'file-text' },
  { key: 'summary', label: '智能摘要', icon: 'sparkles' },
  { key: 'todos', label: '待办事项', icon: 'check-square' },
  { key: 'seating', label: '座位图', icon: 'users' },
  { key: 'settings', label: '设置', icon: 'settings' }
]

const viewTabs = [
  { key: 'timeline', label: '时间轴视图', icon: 'clock' },
  { key: 'speaker', label: '发言人视图', icon: 'users' },
  { key: 'topic', label: '主题视图', icon: 'tag' },
  { key: 'mindmap', label: '思维导图视图', icon: 'git-branch' }
]

const pageLabels = {
  minutes: '纪要',
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

function switchTab(key) { activeTab.value = key }
function switchView(key) { activeView.value = key }
function toggleSummary() { showSummaryPanel.value = !showSummaryPanel.value }
function navigateBreadcrumb(action) { activeTab.value = action }

async function handleReset() {
  const confirmed = await notify.confirm({ title: '清空当前会议', message: '将清空当前会议的人员、记录、主题、待办和标签，其他历史会议不受影响。', confirmText: '清空', danger: true })
  if (!confirmed) return
  try {
    await store.resetAll()
    notify.success('当前会议已清空')
  } catch (e) { notify.error(e.message) }
}

async function createMeeting() {
  try {
    await store.createMeeting('')
    activeTab.value = 'minutes'
    notify.success('已创建一份新纪要，原会议已保存到历史记录')
  } catch (e) { notify.error(e.message) }
}

function setMeeting(patch) {
  store.state.data.meeting = { ...store.meeting.value, ...patch }
  meetingDraft.value = { ...(meetingDraft.value || {}), ...patch }
  clearTimeout(meetingSaveTimer)
  meetingSaveTimer = setTimeout(async () => {
    const pending = meetingDraft.value
    meetingDraft.value = null
    if (!pending) return
    try {
      await store.updateMeeting(pending)
    } catch (e) {
      store.state.error = e.message
    }
  }, 500)
}
</script>

<template>
  <div v-if="!auth.ready" class="app-loading">
    <div class="loading-mark"><SvgIcon name="clipboard" :size="26" /></div>
    <span>正在加载…</span>
  </div>
  <LoginPage v-else-if="!isAuthenticated" />
  <div v-else class="app-layout">
    <TheSidebar
      @open-personnel="showPersonnelModal = true"
      @open-label="showLabelModal = true"
      @new-meeting="createMeeting"
      @open-settings="activeTab = 'settings'"
      @open-archive="activeTab = 'archive'"
      @logout="handleLogout"
    />
    <div class="app-main">
      <AppBreadcrumb :items="breadcrumbs" @navigate="navigateBreadcrumb" />
      <TheHeader
        :active-tab="activeTab"
        :tabs="tabs"
        @switch-tab="switchTab"
        @toggle-summary="toggleSummary"
        @open-personnel="showPersonnelModal = true"
      />
      <div v-if="store.state.error" class="connection-error">
        {{ store.state.error }}
        <button @click="store.loadAll()">重试</button>
      </div>
      <div v-if="store.state.loading && !store.state.ready" class="content-loading">正在加载你的纪要…</div>
      <div class="content-area">
        <!-- 纪要 Tab -->
        <template v-if="activeTab === 'minutes'">
          <div class="minutes-layout">
            <div class="minutes-center">
              <!-- 会议信息卡 -->
              <div class="meeting-info-card">
                <div class="meeting-info-left">
                  <div class="meeting-title-row">
                    <input
                      class="meeting-title-input"
                      :value="store.meeting.value.title"
                      @input="setMeeting({ title: $event.target.value })"
                      placeholder="点击填写会议标题"
                    />
                  </div>
                  <div class="meeting-meta-row">
                    <span class="meta-item"><SvgIcon name="calendar" :size="13" /> {{ store.meeting.value.date || '未设置日期' }}</span>
                    <span v-if="store.meeting.value.startTime || store.meeting.value.endTime" class="meta-item">
                      <SvgIcon name="clock" :size="13" /> {{ store.meeting.value.startTime || '?' }} - {{ store.meeting.value.endTime || '?' }}
                    </span>
                    <span v-if="store.meeting.value.location" class="meta-item">
                      <SvgIcon name="map-pin" :size="13" /> {{ store.meeting.value.location }}
                    </span>
                  </div>
                </div>
                <div class="meeting-info-right">
                  <div v-if="store.persons.value.length" class="attendee-avatars">
                    <div
                      v-for="p in store.persons.value.slice(0, 5)"
                      :key="p.id"
                      class="avatar attendee-avatar"
                      :style="{ background: p.color }"
                      :title="p.name + (p.role ? ' · ' + p.role : '')"
                    >{{ p.name.charAt(0) }}</div>
                    <div v-if="store.persons.value.length > 5" class="avatar attendee-avatar attendee-more">
                      +{{ store.persons.value.length - 5 }}
                    </div>
                  </div>
                  <button class="btn btn-ghost btn-sm" @click="showPersonnelModal = true">
                    <SvgIcon name="users" :size="14" /> 管理人员
                  </button>
                </div>
              </div>

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
              <EntryEditor />
            </div>

            <!-- 右侧摘要面板 -->
            <transition name="slide-right">
              <SummaryPanel v-if="showSummaryPanel" @toggle="toggleSummary" />
            </transition>
          </div>
        </template>

        <!-- 待办事项 Tab -->
        <TodoPanel v-else-if="activeTab === 'todos'" />

        <MeetingArchive v-else-if="activeTab === 'archive'" @open-meeting="activeTab = 'minutes'" />

        <SeatingChart v-else-if="activeTab === 'seating'" />

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
              <input type="date" class="input" :value="store.meeting.value.date" @input="setMeeting({ date: $event.target.value })" />
            </div>
            <div class="form-row-inline">
              <div class="form-row">
                <label>开始时间</label>
                <input type="time" class="input" :value="store.meeting.value.startTime" @input="setMeeting({ startTime: $event.target.value })" />
              </div>
              <div class="form-row">
                <label>结束时间</label>
                <input type="time" class="input" :value="store.meeting.value.endTime" @input="setMeeting({ endTime: $event.target.value })" />
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
  padding: 8px 24px;
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
  padding: 16px 24px;
}

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
</style>
