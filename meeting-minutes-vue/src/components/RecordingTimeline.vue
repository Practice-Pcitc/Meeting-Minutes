<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Timeline } from 'vis-timeline/standalone'
import 'vis-timeline/styles/vis-timeline-graph2d.min.css'
import { authFetch, authRequest } from '../composables/useAuth'
import { useNotify } from '../composables/useNotify'

const props = defineProps({ recordings: { type: Array, default: () => [] }, meetingId: { type: String, required: true }, meetingTitle: { type: String, default: '' } })
const emit = defineEmits(['changed'])
const notify = useNotify()
const container = ref(null)
const activeId = ref('')
const playing = ref(false)
const currentTime = ref(0)
const cursorTimestamp = ref(0)
const loading = ref(false)
const zoomLevel = ref(0)
const transcribing = ref(false)
const urls = new Map()
const audio = new Audio()
let timeline = null
let suppressRangeSync = false

const sorted = computed(() => [...props.recordings].sort((a, b) => a.createdAt - b.createdAt))
function itemDuration(item) { return item.duration ?? Math.max(0, Math.round((item.updatedAt - item.createdAt) / 1000)) }
function itemEnd(item) { return item.createdAt + Math.max(itemDuration(item), 1) * 1000 }
const timelineStart = computed(() => sorted.value[0]?.createdAt || Date.now())
const timelineEnd = computed(() => sorted.value.length ? Math.max(...sorted.value.map(itemEnd)) : timelineStart.value)
const timelineSpan = computed(() => Math.max(1000, timelineEnd.value - timelineStart.value))
const activeItem = computed(() => sorted.value.find(item => item.id === activeId.value))
const totalDuration = computed(() => sorted.value.reduce((sum, item) => sum + itemDuration(item), 0))

audio.ontimeupdate = () => {
  currentTime.value = audio.currentTime || 0
  if (!activeItem.value) return
  cursorTimestamp.value = activeItem.value.createdAt + currentTime.value * 1000
  try { timeline?.setCustomTime(new Date(cursorTimestamp.value), 'playhead') } catch { /* 时间轴可能正在重建 */ }
}
audio.onplay = () => { playing.value = true }
audio.onpause = () => { playing.value = false }
audio.onended = () => playNext()

function formatDuration(value) {
  const seconds = Math.max(0, Math.round(Number(value) || 0)); const h = Math.floor(seconds / 3600); const m = Math.floor((seconds % 3600) / 60); const s = seconds % 60
  return [h, m, s].slice(h ? 0 : 1).map(part => String(part).padStart(2, '0')).join(':')
}
function formatTime(timestamp, withDate = false) {
  return new Date(timestamp).toLocaleString('zh-CN', withDate
    ? { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }
    : { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
function axisDate(value) { return typeof value?.toDate === 'function' ? value.toDate() : new Date(value) }
function axisMinorLabel(value, scale) {
  const date = axisDate(value); const pad = part => String(part).padStart(2, '0')
  if (scale === 'millisecond') return String(date.getMilliseconds()).padStart(3, '0')
  if (scale === 'second') return pad(date.getSeconds())
  if (scale === 'minute' || scale === 'hour') return `${pad(date.getHours())}:${pad(date.getMinutes())}`
  if (scale === 'weekday' || scale === 'day' || scale === 'week') return `${date.getMonth() + 1}月${date.getDate()}日`
  if (scale === 'month') return `${date.getMonth() + 1}月`
  return `${date.getFullYear()}年`
}
function axisMajorLabel(value, scale) {
  const date = axisDate(value); const pad = part => String(part).padStart(2, '0')
  if (['millisecond', 'second', 'minute', 'hour'].includes(scale)) return `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`
  if (['weekday', 'day', 'week'].includes(scale)) return `${date.getFullYear()}年${date.getMonth() + 1}月`
  if (scale === 'month') return `${date.getFullYear()}年`
  return ''
}
async function sourceFor(item) {
  if (urls.has(item.id)) return urls.get(item.id)
  const response = await authFetch(`/meetings/${props.meetingId}/recordings/${item.id}/audio`)
  const url = URL.createObjectURL(await response.blob()); urls.set(item.id, url); return url
}
async function playItem(item, offset = 0) {
  try {
    loading.value = true
    if (activeId.value !== item.id) { audio.pause(); audio.src = await sourceFor(item); activeId.value = item.id }
    audio.currentTime = Math.max(0, Math.min(offset, itemDuration(item)))
    cursorTimestamp.value = item.createdAt + audio.currentTime * 1000
    timeline?.setSelection([item.id], { focus: false })
    timeline?.setCustomTime(new Date(cursorTimestamp.value), 'playhead')
    await audio.play()
  } catch (error) { notify.error(`录音播放失败：${error.message}`) }
  finally { loading.value = false }
}
async function togglePlayback() {
  if (!sorted.value.length) return
  if (!activeItem.value) return playItem(sorted.value[0])
  if (audio.paused) await audio.play(); else audio.pause()
}
function playNext() {
  const next = sorted.value[sorted.value.findIndex(item => item.id === activeId.value) + 1]
  if (next) playItem(next)
  else { playing.value = false; cursorTimestamp.value = timelineEnd.value; timeline?.setCustomTime(new Date(cursorTimestamp.value), 'playhead') }
}
function seekTo(timestamp, itemId = '') {
  const item = itemId ? sorted.value.find(entry => entry.id === itemId) : sorted.value.find(entry => timestamp >= entry.createdAt && timestamp <= itemEnd(entry))
  if (item) playItem(item, (timestamp - item.createdAt) / 1000)
  else {
    audio.pause(); activeId.value = ''; currentTime.value = 0; cursorTimestamp.value = timestamp
    timeline?.setSelection([]); timeline?.setCustomTime(new Date(timestamp), 'playhead')
  }
}
function buildItems() {
  return sorted.value.map((item, index) => ({
    id: item.id, content: `<span>录音 ${index + 1}</span>`, start: new Date(item.createdAt), end: new Date(itemEnd(item)), type: 'range',
    className: activeId.value === item.id ? 'recording-range active-recording' : 'recording-range',
    title: `${formatTime(item.createdAt, true)} – ${formatTime(itemEnd(item), true)}（${formatDuration(itemDuration(item))}）`,
  }))
}
async function renderTimeline() {
  await nextTick()
  if (!container.value || !sorted.value.length) { timeline?.destroy(); timeline = null; return }
  const padding = Math.max(30000, timelineSpan.value * .04)
  const options = {
    stack: false, selectable: true, multiselect: false, showCurrentTime: false, showMajorLabels: true, showMinorLabels: true,
    horizontalScroll: true, zoomable: true, moveable: true, zoomKey: '', orientation: { axis: 'bottom', item: 'top' },
    min: new Date(timelineStart.value - padding), max: new Date(timelineEnd.value + padding), zoomMin: 1000, zoomMax: timelineSpan.value + padding * 2,
    start: new Date(timelineStart.value - padding / 2), end: new Date(timelineEnd.value + padding / 2), margin: { item: 12, axis: 10 },
    format: { minorLabels: axisMinorLabel, majorLabels: axisMajorLabel }, tooltip: { followMouse: true, overflowMethod: 'cap' },
  }
  timeline?.destroy()
  timeline = new Timeline(container.value, buildItems(), options)
  timeline.addCustomTime(new Date(cursorTimestamp.value || timelineStart.value), 'playhead')
  timeline.setCustomTimeTitle('播放位置', 'playhead')
  timeline.on('click', properties => { if (properties.time) seekTo(properties.time.getTime(), properties.item || '') })
  timeline.on('rangechanged', syncZoomLevel)
}
function syncZoomLevel() {
  if (!timeline || suppressRangeSync) return
  const windowRange = timeline.getWindow(); const visible = windowRange.end - windowRange.start
  zoomLevel.value = Math.max(0, Math.min(100, Math.round(Math.log2(Math.max(1, timelineSpan.value / visible)) * 18)))
}
function applyZoom() {
  if (!timeline) return
  const visible = Math.max(1000, timelineSpan.value / Math.pow(2, zoomLevel.value / 18))
  const windowRange = timeline.getWindow(); const center = cursorTimestamp.value || (windowRange.start.getTime() + windowRange.end.getTime()) / 2
  suppressRangeSync = true
  timeline.setWindow(new Date(center - visible / 2), new Date(center + visible / 2), { animation: false })
  requestAnimationFrame(() => { suppressRangeSync = false })
}
function zoomBy(direction) { zoomLevel.value = Math.max(0, Math.min(100, zoomLevel.value + direction * 12)); applyZoom() }
function fitTimeline() { zoomLevel.value = 0; timeline?.fit({ animation: true }) }
async function downloadActive() {
  const item = activeItem.value; if (!item) return
  try {
    const url = await sourceFor(item); const link = document.createElement('a'); const title = (props.meetingTitle || '会议录音').replace(/[\\/:*?"<>|]/g, '_')
    link.href = url; link.download = `${title}_${new Date(item.createdAt).toLocaleString('sv-SE').replace(/[ :]/g, '-')}.${item.extension}`; link.click()
  } catch (error) { notify.error(`录音下载失败：${error.message}`) }
}
async function removeActive() {
  const item = activeItem.value; if (!item) return
  const confirmed = await notify.confirm({ title: '删除录音片段', message: `确定删除 ${formatTime(item.createdAt, true)} 的录音吗？删除后无法恢复。`, confirmText: '删除', danger: true })
  if (!confirmed) return
  try {
    audio.pause(); audio.removeAttribute('src'); activeId.value = ''
    await authRequest('DELETE', `/meetings/${props.meetingId}/recordings/${item.id}`)
    if (urls.has(item.id)) URL.revokeObjectURL(urls.get(item.id)); urls.delete(item.id); emit('changed'); notify.success('录音片段已删除')
  } catch (error) { notify.error(error.message) }
}
async function transcribeAll(force = false) {
  const targets = force ? sorted.value : sorted.value.filter(item => !item.transcript)
  if (!targets.length) return notify.info('所有录音片段都已完成转写')
  transcribing.value = true
  try {
    for (const item of targets) await authRequest('POST', `/meetings/${props.meetingId}/recordings/${item.id}/transcribe`, { force })
    emit('changed')
    notify.success('语音转文字已完成')
  } catch (error) { notify.error(error.message) }
  finally { transcribing.value = false }
}

watch(() => props.recordings, renderTimeline, { deep: true })
watch(activeId, () => { if (timeline) timeline.setItems(buildItems()) })
onMounted(renderTimeline)
onBeforeUnmount(() => { audio.pause(); timeline?.destroy(); urls.forEach(url => URL.revokeObjectURL(url)) })
</script>

<template>
  <section class="recording-timeline">
    <div class="timeline-heading">
      <div><h3>录音时间轴</h3><p>{{ sorted.length ? `${sorted.length} 段 · 录音 ${formatDuration(totalDuration)} · 时间跨度 ${formatDuration(timelineSpan / 1000)}` : '录制完成后会显示在这里' }}</p></div>
      <div v-if="sorted.length" class="timeline-actions">
        <button class="transcribe-button" :disabled="transcribing" @click="transcribeAll(false)"><SvgIcon name="file-text" :size="14" />{{ transcribing ? '转写中…' : '自动转文字' }}</button>
        <button title="缩小" @click="zoomBy(-1)"><SvgIcon name="minus" :size="15" /></button>
        <input v-model.number="zoomLevel" type="range" min="0" max="100" step="1" title="时间轴缩放" @input="applyZoom" />
        <button title="放大" @click="zoomBy(1)"><SvgIcon name="plus" :size="15" /></button>
        <button class="fit-button" @click="fitTimeline">适应全部</button>
      </div>
    </div>
    <div v-if="sorted.length" class="player-row">
      <button class="master-play" :disabled="loading" :title="playing ? '暂停' : '播放'" @click="togglePlayback"><SvgIcon :name="playing ? 'pause' : 'play'" :size="16" /></button>
      <div class="playback-copy"><strong>{{ activeItem ? `录音 ${sorted.findIndex(item => item.id === activeId) + 1}` : '点击时间轴精准定位' }}</strong><span>{{ cursorTimestamp ? formatTime(cursorTimestamp, true) : formatTime(timelineStart, true) }}<template v-if="activeItem"> · {{ formatDuration(currentTime) }} / {{ formatDuration(itemDuration(activeItem)) }}</template></span></div>
      <div v-if="activeItem" class="active-actions"><button title="下载当前片段" @click="downloadActive"><SvgIcon name="download" :size="15" /></button><button class="danger" title="删除当前片段" @click="removeActive"><SvgIcon name="trash" :size="15" /></button></div>
    </div>
    <div v-if="sorted.length" ref="container" class="vis-timeline-host"></div>
    <div v-else class="timeline-empty"><SvgIcon name="microphone" :size="24" /><span>暂无录音片段</span></div>
    <div v-if="sorted.length" class="timeline-hint"><span>滚轮缩放 · 拖动平移 · 点击任意位置精准跳转</span><span>蓝色为录音，空白为未录音时间</span></div>
    <section v-if="sorted.length" class="transcript-panel">
      <div class="transcript-heading"><div><h4>语音转写</h4><span>按录音时间排列，点击文字可播放对应片段</span></div><button v-if="sorted.some(item => item.transcript)" :disabled="transcribing" @click="transcribeAll(true)">重新转写全部</button></div>
      <div class="transcript-list">
        <button v-for="(item, index) in sorted" :key="item.id" class="transcript-item" :class="{ active: activeId === item.id }" @click="playItem(item)">
          <time>{{ formatTime(item.createdAt) }}</time>
          <div><strong>录音 {{ index + 1 }}</strong><p v-if="item.transcript">{{ item.transcript }}</p><p v-else class="pending-text">尚未生成文字，点击上方“自动转文字”</p></div>
          <span>{{ formatDuration(itemDuration(item)) }}</span>
        </button>
      </div>
    </section>
  </section>
</template>

<style scoped>
.recording-timeline { max-width: 1080px; margin: 18px auto 0; padding: 18px 20px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); box-shadow: var(--shadow-sm); }.timeline-heading { display: flex; align-items: center; justify-content: space-between; gap: 18px; margin-bottom: 13px; }.timeline-heading h3 { font-size: .95rem; color: #17233b; }.timeline-heading p { margin-top: 2px; color: var(--text-muted); font-size: .72rem; }.timeline-actions { display: flex; align-items: center; gap: 5px; }.timeline-actions button,.active-actions button { width: 30px; height: 30px; display: grid; place-items: center; border: 1px solid var(--border); border-radius: 6px; color: var(--text-secondary); }.timeline-actions button:hover,.active-actions button:hover { color: var(--primary); background: var(--primary-light); }.timeline-actions input { width: 110px; accent-color: var(--primary); }.timeline-actions .fit-button { width: auto; padding: 0 9px; font-size: .7rem; }.player-row { display: flex; align-items: center; gap: 11px; margin-bottom: 10px; padding: 9px 11px; border-radius: 9px; background: #f7f9fd; }.master-play { width: 36px; height: 36px; display: grid; place-items: center; flex: none; border-radius: 50%; color: #fff; background: var(--primary); }.playback-copy { min-width: 0; display: flex; flex-direction: column; }.playback-copy strong { font-size: .76rem; }.playback-copy span { color: var(--text-muted); font-size: .68rem; font-variant-numeric: tabular-nums; }.active-actions { display: flex; gap: 5px; margin-left: auto; }.active-actions button.danger:hover { color: var(--danger); background: var(--danger-light); }.vis-timeline-host { height: 150px; border: 1px solid #e1e6ef; border-radius: 8px; overflow: hidden; background: #fafbfe; }.vis-timeline-host :deep(.vis-timeline) { border: 0; font-family: inherit; }.vis-timeline-host :deep(.vis-panel.vis-center),.vis-timeline-host :deep(.vis-panel.vis-bottom) { border-color: #e5e9f1; }.vis-timeline-host :deep(.vis-time-axis .vis-text) { color: #748096; font-size: 10px; }.vis-timeline-host :deep(.vis-time-axis .vis-grid.vis-minor) { border-color: #edf0f5; }.vis-timeline-host :deep(.vis-time-axis .vis-grid.vis-major) { border-color: #dfe4ed; }.vis-timeline-host :deep(.vis-item.recording-range) { overflow: hidden; border: 0; border-radius: 5px; color: #fff; background: linear-gradient(90deg,#6387f2,#3165e9); box-shadow: 0 2px 5px rgba(43,88,194,.22); cursor: pointer; }.vis-timeline-host :deep(.vis-item.recording-range.vis-selected),.vis-timeline-host :deep(.vis-item.active-recording) { background: linear-gradient(90deg,#895cf1,#5361e8); box-shadow: 0 0 0 2px rgba(100,83,221,.2); }.vis-timeline-host :deep(.vis-item .vis-item-content) { padding: 5px 7px; font-size: 10px; }.vis-timeline-host :deep(.vis-custom-time.playhead) { z-index: 20; width: 2px; background: #ea4051; pointer-events: none; }.timeline-hint { display: flex; justify-content: space-between; margin-top: 7px; color: var(--text-muted); font-size: .65rem; }.timeline-empty { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 30px; color: var(--text-muted); font-size: .8rem; }
.vis-timeline-host { height: 104px; }
.timeline-actions .transcribe-button { width: auto; display: inline-flex; padding: 0 9px; gap: 5px; color: var(--primary); font-size: .7rem; }
.transcript-panel { margin-top: 17px; padding-top: 15px; border-top: 1px solid var(--border-light); }.transcript-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 9px; }.transcript-heading h4 { font-size: .86rem; }.transcript-heading span { color: var(--text-muted); font-size: .68rem; }.transcript-heading button { padding: 5px 8px; border-radius: 5px; color: var(--primary); font-size: .68rem; }.transcript-heading button:hover { background: var(--primary-light); }.transcript-list { display: flex; flex-direction: column; gap: 5px; max-height: 300px; overflow-y: auto; }.transcript-item { width: 100%; display: grid; grid-template-columns: 72px minmax(0,1fr) 45px; align-items: start; gap: 10px; padding: 9px 10px; border-radius: 7px; text-align: left; background: #fafbfe; }.transcript-item:hover,.transcript-item.active { background: #f1f5ff; }.transcript-item time,.transcript-item>span { color: var(--text-muted); font-size: .68rem; font-variant-numeric: tabular-nums; }.transcript-item>span { text-align: right; }.transcript-item strong { display: block; margin-bottom: 2px; color: var(--text-secondary); font-size: .7rem; }.transcript-item p { color: var(--text); font-size: .78rem; line-height: 1.55; }.transcript-item .pending-text { color: var(--text-muted); font-style: italic; }
@media (max-width: 760px) { .timeline-heading { align-items: flex-start; flex-direction: column; }.timeline-actions { width: 100%; }.timeline-actions input { flex: 1; }.timeline-hint { flex-direction: column; gap: 2px; } }
</style>
