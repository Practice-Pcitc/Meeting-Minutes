<script setup>
import { computed, ref } from 'vue'
import { useStore } from '../composables/useStore'
import { useAuth } from '../composables/useAuth'

const emit = defineEmits(['open-personnel', 'new-meeting', 'open-settings', 'open-archive', 'logout'])
const store = useStore()
const { auth } = useAuth()
const showUserMenu = ref(false)
const userInitial = computed(() => (auth.user?.displayName || auth.user?.username || '用').charAt(0))

const TAG_COLORS = ['#4f6df5', '#2bb673', '#f5a623', '#e8503a', '#8b5cf6', '#0ea5e9']
function tagColor(name) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h)
  return TAG_COLORS[Math.abs(h) % TAG_COLORS.length]
}

// 只保留一个真正能用的导航项：我的纪要
const navItems = computed(() => [
  { key: 'mine', label: '我的纪要', icon: 'file', badge: store.meetings.value.length },
])

function newMeeting() {
  emit('new-meeting')
}

function addLabel() {
  emit('open-settings')
}
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar-logo">
      <SvgIcon name="clipboard" :size="20" class="logo-icon" />
      <span class="logo-text">会议纪要</span>
    </div>

    <button class="new-meeting-btn" @click="newMeeting">
      <span>＋</span> 新建纪要
    </button>

    <nav class="sidebar-nav">
      <button
        v-for="item in navItems"
        :key="item.key"
        class="nav-item active"
        @click="emit('open-archive')"
      >
        <SvgIcon :name="item.icon" :size="18" class="nav-icon" />
        <span class="nav-label">{{ item.label }}</span>
        <span v-if="item.badge" class="nav-badge">{{ item.badge }}</span>
      </button>
    </nav>

    <div class="sidebar-section">
      <div class="section-label">
        <span class="section-label-left"><SvgIcon name="tag" :size="14" /> 标签</span>
        <button class="section-action" @click="addLabel">管理</button>
      </div>
      <div class="tag-list">
        <button v-for="l in store.labels.value" :key="l.id" class="tag-item">
          <span class="tag-dot" :style="{ background: l.color || tagColor(l.name) }"></span>
          {{ l.name }}
        </button>
        <div v-if="store.labels.value.length === 0" class="empty-hint" @click="addLabel">
          去设置页添加标签
        </div>
      </div>
    </div>

    <div class="sidebar-section">
      <div class="section-label">
        <span class="section-label-left"><SvgIcon name="users" :size="14" /> 参会人员</span>
        <button class="section-action" @click="emit('open-personnel')">管理</button>
      </div>
      <div class="personnel-mini-list">
        <div v-for="p in store.persons.value.slice(0, 6)" :key="p.id" class="personnel-mini">
          <div class="avatar mini-avatar" :style="{ background: p.color }">{{ p.name.charAt(0) }}</div>
          <span class="personnel-mini-name">{{ p.name }}</span>
        </div>
        <div v-if="store.persons.value.length === 0" class="empty-hint" @click="emit('open-personnel')">
          点击添加人员
        </div>
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
.sidebar-logo { display: flex; align-items: center; gap: 8px; padding: 16px 18px; flex-shrink: 0; }
.logo-icon { color: #fff; }
.logo-text { font-size: .95rem; font-weight: 700; color: #fff; }

.new-meeting-btn {
  margin: 4px 14px 12px;
  padding: 8px 14px;
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

.sidebar-nav { padding: 0 8px; display: flex; flex-direction: column; gap: 2px; }
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  font-size: .85rem;
  color: var(--sidebar-text);
  transition: var(--transition);
  text-align: left;
}
.nav-item:hover { background: var(--sidebar-hover); color: #fff; }
.nav-item.active { background: var(--sidebar-active); color: #fff; font-weight: 500; }
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

.sidebar-section { padding: 12px 8px 4px; margin-top: 8px; }
.section-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px 8px;
  font-size: .75rem;
  color: var(--sidebar-text);
  text-transform: uppercase;
  letter-spacing: .3px;
}
.section-label-left { display: inline-flex; align-items: center; gap: 4px; }
.section-action { font-size: .72rem; color: var(--primary); opacity: .8; }
.section-action:hover { opacity: 1; }

.tag-list { display: flex; flex-direction: column; gap: 2px; }
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
