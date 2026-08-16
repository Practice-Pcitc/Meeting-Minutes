<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { useStore } from '../composables/useStore'
import { useNotify } from '../composables/useNotify'

const props = defineProps({ recordingStatus: { type: String, default: 'idle' } })
const emit = defineEmits(['open-meeting', 'select-meeting'])
const store = useStore()
const notify = useNotify()
const query = ref('')
const activeLabel = ref('')
const now = ref(Date.now())
const durationTimer = window.setInterval(() => { now.value = Date.now() }, 30000)
onBeforeUnmount(() => window.clearInterval(durationTimer))

function parseLocalDateTime(date, time) {
  if (!date || !time) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const clock = /^(\d{2}):(\d{2})$/.exec(time)
  if (!match || !clock) return null
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(clock[1]), Number(clock[2]))
}

function statusMeta(item) {
  if (item.status === 'ended') return { label: '已结束', className: 'status-ended' }
  if (item.id === store.activeMeetingId.value && ['recording', 'paused'].includes(props.recordingStatus)) {
    return { label: props.recordingStatus === 'paused' ? '录音暂停' : '录音中', className: props.recordingStatus === 'paused' ? 'status-paused' : 'status-recording' }
  }
  const startsAt = parseLocalDateTime(item.date, item.startTime)
  if (startsAt && startsAt.getTime() > now.value) return { label: '未开始', className: 'status-pending' }
  return { label: '进行中', className: 'status-active' }
}

function durationText(item) {
  const startsAt = parseLocalDateTime(item.date, item.startTime)
  if (!startsAt) return '时长待定'
  let endsAt = null
  if (item.status === 'ended') endsAt = parseLocalDateTime(item.date, item.endTime)
  else {
    const today = new Date(now.value)
    const sameDay = startsAt.getFullYear() === today.getFullYear() && startsAt.getMonth() === today.getMonth() && startsAt.getDate() === today.getDate()
    if (sameDay && now.value >= startsAt.getTime()) endsAt = new Date(now.value)
    else if (item.endTime) endsAt = parseLocalDateTime(item.date, item.endTime)
  }
  if (!endsAt) return now.value < startsAt.getTime() ? '尚未开始' : '时长待定'
  if (endsAt.getTime() < startsAt.getTime()) endsAt.setDate(endsAt.getDate() + 1)
  const totalMinutes = Math.max(0, Math.floor((endsAt.getTime() - startsAt.getTime()) / 60000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours ? `${hours}小时${minutes ? `${minutes}分钟` : ''}` : `${minutes}分钟`
}

const availableLabels = computed(() => {
  const labels = new Map()
  store.meetings.value.forEach((meeting) => (meeting.labels || []).forEach((label) => {
    if (!labels.has(label.name)) labels.set(label.name, label)
  }))
  return [...labels.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
})

const filtered = computed(() => {
  const keyword = query.value.trim().toLocaleLowerCase()
  return store.meetings.value.filter((item) => {
    const matchesLabel = !activeLabel.value || (item.labels || []).some((label) => label.name === activeLabel.value)
    if (!matchesLabel) return false
    if (!keyword) return true
    return [item.title, item.date, item.location, ...(item.labels || []).map((label) => label.name)].some((value) => String(value || '').toLocaleLowerCase().includes(keyword))
  })
})

async function openMeeting(id) {
  if (id === store.activeMeetingId.value) return emit('open-meeting')
  emit('select-meeting', id)
}

async function removeMeeting(item) {
  const confirmed = await notify.confirm({
    title: '删除会议纪要',
    message: `确定删除「${item.title || '未命名会议'}」吗？\n删除后无法恢复。`,
    confirmText: '删除',
    danger: true,
  })
  if (!confirmed) return
  try {
    await store.deleteMeeting(item.id)
    notify.success('会议纪要已删除')
  } catch (e) { notify.error(e.message) }
}
</script>

<template>
  <div class="archive-page">
    <div class="archive-header">
      <div><h2>历史会议纪要</h2><p>共保存 {{ store.meetings.value.length }} 份会议</p></div>
      <div class="search-box"><SvgIcon name="search" :size="15" /><input v-model="query" placeholder="搜索标题、日期或地点" /></div>
    </div>
    <div v-if="availableLabels.length" class="label-filters">
      <button type="button" :class="{ active: !activeLabel }" @click="activeLabel = ''">全部</button>
      <button v-for="label in availableLabels" :key="label.name" type="button" :class="{ active: activeLabel === label.name }" @click="activeLabel = activeLabel === label.name ? '' : label.name"><span class="label-dot" :style="{ background: label.color }"></span>{{ label.name }}</button>
    </div>
    <div v-if="filtered.length" class="meeting-grid">
      <article v-for="item in filtered" :key="item.id" class="meeting-card" :class="{ active: item.id === store.activeMeetingId.value, ended: item.status === 'ended' }">
        <button class="card-main" @click="openMeeting(item.id)">
          <div class="card-top"><span class="meeting-date">{{ item.date || '未设置日期' }}</span><span class="meeting-status" :class="statusMeta(item).className"><i></i>{{ statusMeta(item).label }}</span><span v-if="item.id === store.activeMeetingId.value" class="current-badge">当前</span></div>
          <h3>{{ item.title || '未命名会议' }}</h3>
          <div class="meeting-schedule">
            <span><SvgIcon name="clock" :size="13" />开始：{{ item.startTime || '未设置' }}</span>
            <span><SvgIcon name="square" :size="12" />结束：{{ item.endTime || (item.status === 'ended' ? '未记录' : '进行中') }}</span>
            <span class="meeting-duration"><SvgIcon name="timer" :size="13" />持续：{{ durationText(item) }}</span>
          </div>
          <p v-if="item.location" class="location"><SvgIcon name="map-pin" :size="13" /> {{ item.location }}</p>
          <div v-if="item.labels?.length" class="meeting-labels"><span v-for="label in item.labels" :key="label.id" :style="{ '--label-color': label.color }"><i></i>{{ label.name }}</span></div>
          <div class="card-stats"><span>{{ item.entryCount }} 条记录</span><span>{{ item.personCount }} 人</span><span>{{ item.todoCount }} 项待办</span></div>
        </button>
        <button class="delete-meeting" title="删除会议" @click="removeMeeting(item)"><SvgIcon name="trash" :size="15" /></button>
      </article>
    </div>
    <div v-else class="archive-empty"><SvgIcon :name="query ? 'search' : 'file-text'" :size="42" /><p>{{ query ? '没有找到匹配的会议纪要' : '还没有会议纪要，请点击左侧“新建纪要”开始' }}</p></div>
  </div>
</template>

<style scoped>
.archive-page { flex: 1; overflow-y: auto; padding: 28px; background: var(--bg-secondary); }.archive-header { max-width: 980px; margin: 0 auto 22px; display: flex; justify-content: space-between; align-items: flex-end; gap: 20px; }.archive-header h2 { font-size: 1.25rem; }.archive-header p { margin-top: 5px; color: var(--text-muted); font-size: .82rem; }
.label-filters { max-width: 980px; display: flex; flex-wrap: wrap; gap: 7px; margin: -8px auto 18px; }.label-filters button { display: inline-flex; align-items: center; gap: 5px; padding: 5px 10px; border: 1px solid var(--border); border-radius: var(--radius-full); background: var(--surface); color: var(--text-secondary); font-size: .76rem; }.label-filters button:hover { border-color: var(--primary-soft); color: var(--primary); }.label-filters button.active { border-color: var(--primary); background: var(--primary-light); color: var(--primary); font-weight: 600; }.label-dot { width: 7px; height: 7px; border-radius: 50%; }
.search-box { width: 300px; display: flex; align-items: center; gap: 8px; padding: 9px 12px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--text-muted); }.search-box input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--text); }
.meeting-grid { max-width: 980px; margin: 0 auto; display: grid; grid-template-columns: repeat(auto-fill,minmax(280px,1fr)); gap: 16px; }.meeting-card { position: relative; background: var(--surface); border: 1px solid var(--border-light); border-radius: var(--radius); box-shadow: var(--shadow-sm); transition: var(--transition); overflow: hidden; }.meeting-card:hover { transform: translateY(-2px); box-shadow: var(--shadow-md); }.meeting-card.active { border-color: var(--primary); box-shadow: 0 0 0 2px var(--primary-light); }
.meeting-card.ended:not(.active) { border-color: #dfe3e9; background: #fbfcfd; }
.card-main { width: 100%; text-align: left; padding: 18px; }.card-top { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }.meeting-date { color: var(--text-muted); font-size: .76rem; }.current-badge { color: var(--primary); background: var(--primary-light); font-size: .7rem; padding: 2px 7px; border-radius: var(--radius-full); }.card-main h3 { font-size: 1rem; padding-right: 25px; }.location { display: flex; align-items: center; gap: 4px; margin-top: 8px; color: var(--text-secondary); font-size: .8rem; }.meeting-labels { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 11px; }.meeting-labels span { display: inline-flex; align-items: center; gap: 5px; padding: 3px 8px; border-radius: var(--radius-full); background: color-mix(in srgb,var(--label-color) 10%,white); color: var(--text-secondary); font-size: .7rem; }.meeting-labels i { width: 6px; height: 6px; border-radius: 50%; background: var(--label-color); }.card-stats { display: flex; gap: 12px; margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--border-light); color: var(--text-muted); font-size: .75rem; }.delete-meeting { position: absolute; top: 13px; right: 12px; padding: 5px; color: var(--text-muted); border-radius: 5px; }.delete-meeting:hover { color: var(--danger); background: #fee2e2; }
.archive-empty { max-width: 980px; margin: 80px auto; text-align: center; color: var(--text-muted); }.archive-empty p { margin-top: 12px; }
.meeting-status { display: inline-flex; align-items: center; gap: 4px; padding: 2px 7px; border-radius: var(--radius-full); font-size: .68rem; font-weight: 650; }
.meeting-status i { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
.meeting-status.status-active { color: #23845e; background: #e9f8f1; }
.meeting-status.status-ended { color: #667085; background: #eef1f5; }
.meeting-status.status-recording { color: #d93636; background: #fff0f0; }
.meeting-status.status-recording i { animation: archive-pulse 1.4s ease-out infinite; }
.meeting-status.status-paused { color: #ad731a; background: #fff7e4; }
.meeting-status.status-pending { color: #45658d; background: #edf3fa; }
.meeting-schedule { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 6px 12px; margin-top: 11px; padding: 9px 10px; border-radius: 7px; color: var(--text-secondary); background: var(--bg-secondary); font-size: .75rem; }
.meeting-schedule span { display: inline-flex; align-items: center; gap: 5px; min-width: 0; white-space: nowrap; }
.meeting-schedule .meeting-duration { grid-column: 1 / -1; color: var(--text); font-weight: 600; }
@keyframes archive-pulse { 0% { box-shadow: 0 0 0 0 rgba(217,54,54,.4); } 70%,100% { box-shadow: 0 0 0 5px rgba(217,54,54,0); } }
</style>
