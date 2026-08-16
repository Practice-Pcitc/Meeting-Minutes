<script setup>
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useStore } from '../composables/useStore'
import { useAuth } from '../composables/useAuth'

const props = defineProps({
  recordingStatus: { type: String, default: 'idle' },
})
const emit = defineEmits(['new-meeting', 'open-archive', 'open-meeting', 'logout'])
const store = useStore()
const route = useRoute()
const { auth } = useAuth()
const showUserMenu = ref(false)
const userInitial = computed(() => (auth.user?.displayName || auth.user?.username || '用').charAt(0))

const TAG_COLORS = ['#4f6df5', '#2bb673', '#f5a623', '#e8503a', '#8b5cf6', '#0ea5e9']
const activeMeeting = computed(() => store.meetings.value.find(meeting => meeting.id === store.activeMeetingId.value))
const recentMeetings = computed(() => store.meetings.value.filter(meeting => meeting.id !== store.activeMeetingId.value).slice(0, 4))
const isArchive = computed(() => route.meta.tab === 'archive')
const recordingLabel = computed(() => props.recordingStatus === 'recording' ? '正在录音' : props.recordingStatus === 'paused' ? '录音暂停' : '')

function newMeeting() {
  emit('new-meeting')
}

async function openMeeting(id) {
  await store.selectMeeting(id)
  emit('open-meeting')
}

function meetingStatus(meeting) {
  return meeting.id === store.activeMeetingId.value ? '当前会议' : (meeting.date || '未设置日期')
}
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar-logo">
      <span class="logo-mark"><SvgIcon name="clipboard" :size="18" /></span>
      <span class="logo-text">会议纪要</span>
    </div>

    <button class="new-meeting-btn" @click="newMeeting">
      <span>＋</span> 新建会议
    </button>

    <nav class="sidebar-nav">
      <button class="nav-item" :class="{ active: isArchive }" @click="emit('open-archive')">
        <span class="nav-icon-box"><SvgIcon name="calendar" :size="18" /></span>
        <span class="nav-copy"><strong>会议中心</strong><small>查找和管理全部会议</small></span>
        <span class="nav-badge">{{ store.meetings.value.length }}</span>
      </button>
    </nav>

    <div v-if="activeMeeting" class="sidebar-section current-section">
      <div class="section-label">
        <span>当前会议</span>
        <span class="live-indicator" :class="{ recording: recordingStatus === 'recording', paused: recordingStatus === 'paused' }">
          <i></i>{{ recordingLabel || '工作区' }}
        </span>
      </div>
      <button class="current-meeting" :class="{ active: !isArchive }" @click="emit('open-meeting')">
        <span class="current-icon"><SvgIcon name="file-text" :size="17" /></span>
        <span class="current-info">
          <strong>{{ activeMeeting.title || '未命名会议' }}</strong>
          <small>{{ activeMeeting.date || '未设置日期' }} · {{ activeMeeting.entryCount || 0 }} 条记录</small>
          <span v-if="recordingLabel" class="current-recording" :class="{ paused: recordingStatus === 'paused' }">
            <SvgIcon name="microphone" :size="11" />{{ recordingLabel }}
          </span>
        </span>
        <span class="current-arrow">›</span>
      </button>
    </div>

    <div class="sidebar-section recent-section">
      <div class="section-label">
        <span>最近会议</span>
        <button v-if="store.meetings.value.length" class="section-action" @click="emit('open-archive')">查看全部</button>
      </div>
      <div class="recent-list">
        <button v-for="(meeting, index) in recentMeetings" :key="meeting.id" class="recent-item" :class="{ active: meeting.id === store.activeMeetingId.value }" @click="openMeeting(meeting.id)">
          <span class="meeting-dot" :style="{ background: TAG_COLORS[index % TAG_COLORS.length] }"></span>
          <span class="recent-info"><strong>{{ meeting.title || '未命名会议' }}</strong><small>{{ meetingStatus(meeting) }}</small></span>
        </button>
        <div v-if="!recentMeetings.length" class="empty-hint">其他会议会显示在这里</div>
      </div>
    </div>

    <div class="sidebar-footer-wrap">
      <div v-if="showUserMenu" class="user-menu">
        <div class="user-menu-account">
          <strong>{{ auth.user?.displayName }}</strong>
          <span>@{{ auth.user?.username }}</span>
        </div>
        <button @click="emit('logout')"><SvgIcon name="log-out" :size="15" /> 退出登录</button>
      </div>
      <button class="sidebar-footer" @click="showUserMenu = !showUserMenu">
        <div class="avatar user-avatar">{{ userInitial }}</div>
        <div class="user-info">
          <div class="user-name">{{ auth.user?.displayName }}</div>
          <div class="user-plan">@{{ auth.user?.username }}</div>
        </div>
        <SvgIcon name="chevron-up" :size="15" class="user-chevron" />
      </button>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  width: var(--sidebar-w);
  background: var(--sidebar-bg);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  overflow-y: auto;
  color: var(--sidebar-text-main);
}
.sidebar-logo { display: flex; align-items: center; gap: 10px; padding: 22px 22px 18px; flex-shrink: 0; }
.logo-mark { width: 30px; height: 30px; display: grid; place-items: center; color: #fff; border-radius: 10px; background: linear-gradient(145deg,#4b8aff,#2258eb); box-shadow: 0 6px 18px rgba(37,100,240,.35); }
.logo-icon { color: #fff; }
.logo-text { font-size: 1.05rem; font-weight: 750; color: #fff; letter-spacing: .04em; }

.new-meeting-btn {
  margin: 2px 20px 20px;
  padding: 11px 14px;
  border-radius: var(--radius-sm);
  background: var(--primary);
  color: #fff;
  font-size: .85rem;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 6px;
  justify-content: center;
  transition: var(--transition);
}
.new-meeting-btn:hover { background: var(--primary-hover); }

.sidebar-nav { padding: 0 12px 4px; display: flex; flex-direction: column; gap: 4px; }
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 10px;
  border-radius: var(--radius-sm);
  font-size: .85rem;
  color: var(--sidebar-text);
  transition: var(--transition);
  text-align: left;
}
.nav-item:hover { background: var(--sidebar-hover); color: #fff; }
.nav-item.active { background: var(--sidebar-active); color: #fff; box-shadow: inset 2px 0 #4f8cff; }
.nav-icon-box { width: 28px; height: 28px; display: grid; place-items: center; color: #b8c9e3; }
.nav-copy { min-width: 0; flex: 1; display: flex; flex-direction: column; }
.nav-copy strong { font-size: .84rem; font-weight: 600; color: #fff; }
.nav-copy small { color: #8097ba; font-size: .67rem; font-weight: 400; }
.nav-icon { color: var(--sidebar-text); flex-shrink: 0; }
.nav-item.active .nav-icon { color: #fff; }
.nav-item:hover .nav-icon { color: #fff; }
.nav-label { flex: 1; }
.nav-badge {
  font-size: .7rem;
  background: rgba(255,255,255,.15);
  padding: 1px 7px;
  border-radius: var(--radius-full);
}

.sidebar-section { padding: 18px 12px 4px; margin-top: 8px; border-top: 1px solid rgba(255,255,255,.06); }
.section-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px 10px;
  font-size: .75rem;
  color: var(--sidebar-text);
  text-transform: uppercase;
  letter-spacing: .3px;
}
.section-label-left { display: inline-flex; align-items: center; gap: 4px; }
.section-action { font-size: .72rem; color: var(--primary); opacity: .8; }
.section-action:hover { opacity: 1; }
.live-indicator { display: inline-flex; align-items: center; gap: 5px; color: #7394c3; font-size: .65rem; letter-spacing: 0; text-transform: none; }
.live-indicator i { width: 5px; height: 5px; border-radius: 50%; background: #48cf8b; box-shadow: 0 0 0 3px rgba(72,207,139,.1); }
.live-indicator.recording { color: #ff8d8d; }
.live-indicator.recording i { background: #ff6464; animation: sidebar-pulse 1.4s ease-out infinite; }
.live-indicator.paused { color: #f3c66f; }
.live-indicator.paused i { background: #eab44f; }
.current-meeting { width: 100%; min-height: 64px; display: flex; align-items: center; gap: 10px; padding: 10px; border: 1px solid rgba(106,155,237,.16); border-radius: 10px; color: #dce8fa; text-align: left; background: rgba(255,255,255,.035); transition: var(--transition); }
.current-meeting:hover,.current-meeting.active { border-color: rgba(94,146,239,.36); background: linear-gradient(110deg,rgba(42,101,220,.2),rgba(255,255,255,.045)); }
.current-icon { width: 32px; height: 32px; display: grid; place-items: center; flex: none; border-radius: 8px; color: #79a4ff; background: rgba(44,102,230,.18); }
.current-info { min-width: 0; flex: 1; display: flex; flex-direction: column; }
.current-info strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .82rem; color: #fff; }
.current-info small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px; color: #849abd; font-size: .67rem; }
.current-recording { display: inline-flex; align-items: center; gap: 3px; width: fit-content; margin-top: 4px; color: #ff9292; font-size: .66rem; font-weight: 650; }
.current-recording.paused { color: #f3c66f; }
.current-arrow { color: #7491bd; font-size: 1.2rem; }
@keyframes sidebar-pulse { 0% { box-shadow: 0 0 0 0 rgba(255,100,100,.45); } 70%,100% { box-shadow: 0 0 0 5px rgba(255,100,100,0); } }

.recent-list { display: flex; flex-direction: column; gap: 4px; }
.recent-item { width: 100%; display: flex; align-items: flex-start; gap: 10px; padding: 10px; border-radius: 9px; text-align: left; color: var(--sidebar-text); }
.recent-item:hover,.recent-item.active { background: rgba(255,255,255,.07); }
.recent-item.active { color: #fff; }
.meeting-dot { width: 7px; height: 7px; margin-top: 6px; border-radius: 50%; flex: none; }
.recent-info { min-width: 0; display: flex; flex-direction: column; }
.recent-info strong { max-width: 166px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .82rem; font-weight: 600; color: inherit; }
.recent-info small { margin-top: 2px; font-size: .7rem; color: #8298bb; }
.recent-item.active small { color: #69a0ff; }
.view-all { padding: 9px 10px; color: #91a6c7; font-size: .76rem; text-align: left; }
.view-all:hover { color: #fff; }
.tag-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: var(--radius-sm);
  font-size: .82rem;
  color: var(--sidebar-text);
  transition: var(--transition);
  text-align: left;
}
.tag-item:hover { background: var(--sidebar-hover); color: #fff; }
.tag-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }

.personnel-mini-list { display: flex; flex-direction: column; gap: 2px; padding: 0 4px; }
.personnel-mini {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-radius: var(--radius-sm);
  transition: var(--transition);
  cursor: pointer;
}
.personnel-mini:hover { background: var(--sidebar-hover); }
.mini-avatar { width: 22px; height: 22px; font-size: .65rem; }
.personnel-mini-name { font-size: .8rem; color: var(--sidebar-text); }
.empty-hint {
  padding: 8px 12px;
  font-size: .8rem;
  color: var(--sidebar-text);
  opacity: .6;
  cursor: pointer;
}
.empty-hint:hover { opacity: 1; }

.sidebar-footer-wrap { position: relative; margin-top: auto; }
.sidebar-footer {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-top: 1px solid var(--border-dark);
  flex-shrink: 0;
}
.sidebar-footer:hover { background: var(--sidebar-hover); }
.user-avatar { width: 32px; height: 32px; font-size: .8rem; background: var(--primary); }
.user-info { flex: 1; min-width: 0; }
.user-name { font-size: .85rem; font-weight: 500; color: #fff; }
.user-plan { font-size: .72rem; color: var(--sidebar-text); }
.user-chevron { color: var(--sidebar-text); }
.user-menu {
  position: absolute; left: 12px; right: 12px; bottom: calc(100% + 8px); padding: 7px;
  border: 1px solid var(--border-dark); border-radius: 9px; background: #292e36;
  box-shadow: 0 12px 32px rgba(0,0,0,.28);
}
.user-menu-account { display: flex; flex-direction: column; padding: 7px 9px 9px; border-bottom: 1px solid var(--border-dark); }
.user-menu-account strong { color: #fff; font-size: .82rem; }
.user-menu-account span { color: var(--sidebar-text); font-size: .7rem; }
.user-menu button { width: 100%; display: flex; align-items: center; gap: 8px; margin-top: 5px; padding: 7px 9px; border-radius: 5px; color: #f3a69b; font-size: .78rem; }
.user-menu button:hover { background: rgba(232,80,58,.12); }
</style>
