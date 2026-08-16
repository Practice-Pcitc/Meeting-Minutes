<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Timeline } from 'vis-timeline/standalone'
import 'vis-timeline/styles/vis-timeline-graph2d.min.css'
import { authFetch, authRequest } from '../composables/useAuth'
import { useNotify } from '../composables/useNotify'

const props = defineProps({
  recordings: { type: Array, default: () => [] },
  meetingId: { type: String, required: true },
  meetingTitle: { type: String, default: '' },
  liveTranscript: { type: String, default: '' },
  liveActive: Boolean,
  liveTranscribing: Boolean,
  liveError: { type: String, default: '' },
  localTranscription: Boolean,
})
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
const visibleStart = ref(0)
const visibleEnd = ref(0)
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
const transcriptCount = computed(() => sorted.value.filter(item => item.transcript).length)
const overviewSegments = computed(() => sorted.value.map(item => ({
  id: item.id,
  active: item.id === activeId.value,
  left: `${Math.max(0, ((item.createdAt - timelineStart.value) / timelineSpan.value) * 100)}%`,
  width: `${Math.max(.35, ((itemEnd(item) - item.createdAt) / timelineSpan.value) * 100)}%`,
})))
const overviewWindowStyle = computed(() => {
  if (!visibleStart.value || !visibleEnd.value) return { left: '0%', width: '100%' }
  const start = Math.max(timelineStart.value, visibleStart.value)
  const end = Math.min(timelineEnd.value, visibleEnd.value)
  return {
    left: `${Math.max(0, ((start - timelineStart.value) / timelineSpan.value) * 100)}%`,
    width: `${Math.max(1.2, ((Math.max(start, end) - start) / timelineSpan.value) * 100)}%`,
  }
})
const overviewCursorStyle = computed(() => ({
  left: `${Math.max(0, Math.min(100, (((cursorTimestamp.value || timelineStart.value) - timelineStart.value) / timelineSpan.value) * 100))}%`,
}))

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
  timeline.on('rangechange', syncVisibleRange)
  timeline.on('rangechanged', () => { syncVisibleRange(); syncZoomLevel() })
  syncVisibleRange()
}
function syncVisibleRange() {
  if (!timeline) return
  const windowRange = timeline.getWindow()
  visibleStart.value = windowRange.start.getTime()
  visibleEnd.value = windowRange.end.getTime()
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
function fitTimeline() {
  zoomLevel.value = 0
  timeline?.fit({ animation: true })
  setTimeout(syncVisibleRange, 550)
}
function moveOverview(event) {
  if (!timeline) return
  const bounds = event.currentTarget.getBoundingClientRect()
  const center = timelineStart.value + Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)) * timelineSpan.value
  const windowRange = timeline.getWindow()
  const visible = windowRange.end - windowRange.start
  timeline.setWindow(new Date(center - visible / 2), new Date(center + visible / 2), { animation: true })
}
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
    <div class="timeline-section">
      <div class="timeline-heading">
        <div>
          <h3>录音时间轴</h3>
          <p>{{ sorted.length ? `${sorted.length} 段录音 · 有效时长 ${formatDuration(totalDuration)} · 会议跨度 ${formatDuration(timelineSpan / 1000)}` : '录制后将在这里生成可缩放时间轴' }}</p>
        </div>
      </div>

      <div v-if="sorted.length" class="transport-bar">
        <button class="master-play" :disabled="loading" :title="playing ? '暂停' : '播放'" @click="togglePlayback"><SvgIcon :name="playing ? 'pause' : 'play'" :size="16" /></button>
        <div class="playback-copy">
          <strong>{{ activeItem ? `录音 ${sorted.findIndex(item => item.id === activeId) + 1}` : '从时间轴选择播放位置' }}</strong>
          <span>{{ cursorTimestamp ? formatTime(cursorTimestamp, true) : formatTime(timelineStart, true) }}<template v-if="activeItem"> · {{ formatDuration(currentTime) }} / {{ formatDuration(itemDuration(activeItem)) }}</template></span>
        </div>
        <div class="zoom-controls" aria-label="时间轴缩放">
          <button title="缩小" @click="zoomBy(-1)"><SvgIcon name="minus" :size="14" /></button>
          <input v-model.number="zoomLevel" type="range" min="0" max="100" step="1" title="时间轴缩放" @input="applyZoom" />
          <button title="放大" @click="zoomBy(1)"><SvgIcon name="plus" :size="14" /></button>
          <button class="fit-button" @click="fitTimeline">适应全部</button>
        </div>
        <div v-if="activeItem" class="active-actions">
          <button title="下载当前片段" @click="downloadActive"><SvgIcon name="download" :size="15" /></button>
          <button class="danger" title="删除当前片段" @click="removeActive"><SvgIcon name="trash" :size="15" /></button>
        </div>
      </div>

      <template v-if="sorted.length">
        <div ref="container" class="vis-timeline-host"></div>
        <div class="overview-wrap">
          <time>{{ formatTime(timelineStart) }}</time>
          <button class="overview-track" title="点击移动详细时间轴" @click="moveOverview">
            <span v-for="segment in overviewSegments" :key="segment.id" class="overview-segment" :class="{ active: segment.active }" :style="{ left: segment.left, width: segment.width }"></span>
            <span class="overview-window" :style="overviewWindowStyle"></span>
            <span class="overview-cursor" :style="overviewCursorStyle"></span>
          </button>
          <time>{{ formatTime(timelineEnd) }}</time>
        </div>
        <div class="timeline-hint"><span>滚轮缩放 · 拖动平移 · 点击精准跳转</span><span>蓝色为录音，空白为未录音时间</span></div>
      </template>
      <div v-else class="timeline-empty"><span class="empty-icon"><SvgIcon name="microphone" :size="20" /></span><div><strong>还没有录音片段</strong><span>开始录音后，会议时间轴将自动生成</span></div></div>
    </div>

    <section v-if="sorted.length || liveActive" class="transcript-panel">
      <div class="transcript-heading">
        <div><h4>转写记录</h4><span>{{ transcriptCount ? `已生成 ${transcriptCount} 段文字，点击段落即可播放` : '实时文字和历史转写将统一显示在这里' }}</span></div>
        <div class="transcript-actions">
          <button v-if="sorted.some(item => !item.transcript)" :disabled="transcribing" @click="transcribeAll(false)"><SvgIcon name="file-text" :size="14" />{{ transcribing ? '转写中…' : '转写未完成片段' }}</button>
          <button v-else-if="sorted.some(item => item.transcript)" :disabled="transcribing" @click="transcribeAll(true)">重新转写</button>
        </div>
      </div>
      <div class="transcript-list">
        <button v-for="(item, index) in sorted" :key="item.id" class="transcript-item" :class="{ active: activeId === item.id }" @click="playItem(item)">
          <span class="transcript-time"><time>{{ formatTime(item.createdAt) }}</time><small>{{ formatDuration(itemDuration(item)) }}</small></span>
          <span class="transcript-marker"></span>
          <span class="transcript-copy"><strong>录音 {{ index + 1 }}</strong><span v-if="item.transcript">{{ item.transcript }}</span><em v-else>尚未生成文字</em></span>
        </button>
        <div v-if="liveActive" class="transcript-item live-item">
          <span class="transcript-time"><time>现在</time><small>{{ liveTranscribing ? '识别中' : '实时' }}</small></span>
          <span class="transcript-marker"></span>
          <span class="transcript-copy">
            <strong><i></i>实时转写</strong>
            <span v-if="liveTranscript">{{ liveTranscript }}</span>
            <em v-else-if="!localTranscription">云端引擎不进行滚动转写，避免产生重复费用。</em>
            <em v-else-if="liveError" class="live-error">{{ liveError }}</em>
            <em v-else>开始说话后，文字会在这里持续出现…</em>
          </span>
        </div>
      </div>
    </section>
  </section>
</template>

<style scoped>
.recording-timeline { border-top: 1px solid var(--border-light); }
.timeline-section { padding: 20px 24px 18px; }
.timeline-heading { display: flex; align-items: center; justify-content: space-between; gap: 18px; margin-bottom: 12px; }
.timeline-heading h3,.transcript-heading h4 { color: #14213a; font-size: .94rem; }
.timeline-heading p,.transcript-heading span { margin-top: 2px; color: var(--text-muted); font-size: .71rem; }
.transport-bar { min-height: 54px; display: flex; align-items: center; gap: 11px; margin-bottom: 10px; padding: 7px 9px; border: 1px solid var(--border-light); border-radius: 10px; background: #fafbfc; }
.master-play { width: 36px; height: 36px; display: grid; place-items: center; flex: none; border-radius: 50%; color: #fff; background: var(--primary); box-shadow: 0 4px 10px rgba(40,100,240,.2); }
.master-play:hover { background: var(--primary-hover); }
.playback-copy { min-width: 185px; display: flex; flex-direction: column; }
.playback-copy strong { font-size: .76rem; font-weight: 650; }
.playback-copy span { color: var(--text-muted); font-size: .68rem; font-variant-numeric: tabular-nums; }
.zoom-controls { display: flex; align-items: center; gap: 5px; margin-left: auto; }
.zoom-controls button,.active-actions button { height: 30px; min-width: 30px; display: grid; place-items: center; padding: 0 8px; border: 1px solid var(--border); border-radius: 7px; color: var(--text-secondary); background: var(--surface); }
.zoom-controls button:hover,.active-actions button:hover { border-color: var(--primary-soft); color: var(--primary); background: var(--primary-light); }
.zoom-controls input { width: 116px; accent-color: var(--primary); }
.zoom-controls .fit-button { font-size: .7rem; white-space: nowrap; }
.active-actions { display: flex; gap: 5px; padding-left: 7px; border-left: 1px solid var(--border); }
.active-actions button.danger:hover { border-color: #ffd5ce; color: var(--danger); background: var(--danger-light); }
.vis-timeline-host { height: 112px; border: 1px solid #dfe5ee; border-radius: 9px; overflow: hidden; background: #fbfcfe; }
.vis-timeline-host :deep(.vis-timeline) { border: 0; font-family: inherit; }
.vis-timeline-host :deep(.vis-panel.vis-center),.vis-timeline-host :deep(.vis-panel.vis-bottom) { border-color: #e5e9f1; }
.vis-timeline-host :deep(.vis-time-axis .vis-text) { color: #748096; font-size: 10px; }
.vis-timeline-host :deep(.vis-time-axis .vis-grid.vis-minor) { border-color: #edf0f5; }
.vis-timeline-host :deep(.vis-time-axis .vis-grid.vis-major) { border-color: #dfe4ed; }
.vis-timeline-host :deep(.vis-item.recording-range) { min-width: 3px; overflow: hidden; border: 0; border-radius: 4px; color: #fff; background: linear-gradient(90deg,#5b84f5,#2864f0); box-shadow: 0 2px 5px rgba(43,88,194,.22); cursor: pointer; }
.vis-timeline-host :deep(.vis-item.recording-range.vis-selected),.vis-timeline-host :deep(.vis-item.active-recording) { background: linear-gradient(90deg,#7c56e8,#4d63eb); box-shadow: 0 0 0 2px rgba(100,83,221,.2); }
.vis-timeline-host :deep(.vis-item .vis-item-content) { padding: 5px 7px; font-size: 10px; }
.vis-timeline-host :deep(.vis-custom-time.playhead) { z-index: 20; width: 2px; background: #ef4760; pointer-events: none; }
.overview-wrap { display: grid; grid-template-columns: 48px minmax(0,1fr) 48px; align-items: center; gap: 8px; margin-top: 9px; }
.overview-wrap time { color: var(--text-muted); font-size: .64rem; font-variant-numeric: tabular-nums; }
.overview-wrap time:last-child { text-align: right; }
.overview-track { position: relative; height: 18px; overflow: hidden; border-radius: 5px; background: #edf1f7; }
.overview-segment { position: absolute; top: 5px; height: 8px; min-width: 2px; border-radius: 2px; background: #7e9df2; pointer-events: none; }
.overview-segment.active { background: #7057df; }
.overview-window { position: absolute; top: 1px; bottom: 1px; min-width: 9px; border: 1.5px solid var(--primary); border-radius: 4px; background: rgba(40,100,240,.08); pointer-events: none; }
.overview-cursor { position: absolute; top: 2px; bottom: 2px; width: 1px; background: #ef4760; pointer-events: none; }
.timeline-hint { display: flex; justify-content: space-between; margin-top: 6px; color: var(--text-muted); font-size: .64rem; }
.timeline-empty { min-height: 96px; display: flex; align-items: center; justify-content: center; gap: 12px; border: 1px dashed #dce2ec; border-radius: 10px; color: var(--text-muted); background: #fbfcfe; }
.empty-icon { width: 38px; height: 38px; display: grid; place-items: center; border-radius: 10px; color: var(--primary); background: var(--primary-light); }
.timeline-empty div { display: flex; flex-direction: column; }
.timeline-empty strong { color: var(--text-secondary); font-size: .8rem; }
.timeline-empty div span { font-size: .7rem; }
.transcript-panel { padding: 18px 24px 22px; border-top: 1px solid var(--border-light); }
.transcript-heading { display: flex; align-items: center; justify-content: space-between; gap: 18px; margin-bottom: 12px; }
.transcript-actions { display: flex; gap: 6px; }
.transcript-actions button { display: inline-flex; align-items: center; gap: 5px; padding: 6px 9px; border-radius: 7px; color: var(--primary); font-size: .7rem; font-weight: 550; }
.transcript-actions button:hover { background: var(--primary-light); }
.transcript-actions button:disabled { opacity: .55; cursor: wait; }
.transcript-list { position: relative; max-height: 330px; overflow-y: auto; padding-right: 5px; }
.transcript-list::before { content: ''; position: absolute; top: 15px; bottom: 15px; left: 84px; width: 1px; background: #e5e9f0; }
.transcript-item { position: relative; width: 100%; display: grid; grid-template-columns: 68px 12px minmax(0,1fr); align-items: start; gap: 10px; padding: 11px 10px 11px 0; border-radius: 8px; text-align: left; transition: background .16s ease; }
button.transcript-item:hover,button.transcript-item.active { background: #f5f7fb; }
button.transcript-item.active { box-shadow: inset 3px 0 0 var(--primary); }
.transcript-time { display: flex; flex-direction: column; padding-top: 1px; text-align: right; font-variant-numeric: tabular-nums; }
.transcript-time time { color: var(--text-secondary); font-size: .69rem; }
.transcript-time small { color: var(--text-muted); font-size: .62rem; }
.transcript-marker { z-index: 1; width: 8px; height: 8px; margin-top: 5px; border: 2px solid var(--surface); border-radius: 50%; background: #aeb8c8; box-shadow: 0 0 0 1px #d8dee8; }
.transcript-item.active .transcript-marker { background: var(--primary); box-shadow: 0 0 0 2px var(--primary-soft); }
.transcript-copy { min-width: 0; display: flex; flex-direction: column; color: var(--text); font-size: .8rem; line-height: 1.65; }
.transcript-copy strong { display: flex; align-items: center; gap: 6px; margin-bottom: 2px; color: var(--text-secondary); font-size: .68rem; font-weight: 600; }
.transcript-copy em { color: var(--text-muted); font-style: normal; }
.live-item { background: linear-gradient(90deg,rgba(40,100,240,.045),transparent); }
.live-item .transcript-marker { background: #ef4760; box-shadow: 0 0 0 3px rgba(239,71,96,.12); }
.live-item .transcript-copy strong { color: var(--primary); }
.live-item .transcript-copy strong i { width: 6px; height: 6px; border-radius: 50%; background: #ef4760; animation: livePulse 1.4s ease-out infinite; }
.live-item .live-error { color: var(--danger); }
@keyframes livePulse { 0% { box-shadow: 0 0 0 0 rgba(239,71,96,.4); } 70%,100% { box-shadow: 0 0 0 5px rgba(239,71,96,0); } }
@media (max-width: 860px) { .transport-bar { flex-wrap: wrap; }.zoom-controls { order: 3; width: 100%; margin-left: 47px; }.zoom-controls input { flex: 1; }.active-actions { margin-left: auto; } }
@media (max-width: 620px) { .timeline-section,.transcript-panel { padding: 16px; }.transport-bar { align-items: flex-start; }.playback-copy { min-width: 0; flex: 1; }.zoom-controls { margin-left: 0; }.active-actions { padding-left: 0; border-left: 0; }.timeline-hint { flex-direction: column; gap: 2px; }.transcript-heading { align-items: flex-start; flex-direction: column; gap: 8px; }.transcript-list::before { left: 68px; }.transcript-item { grid-template-columns: 52px 10px minmax(0,1fr); gap: 7px; }.overview-wrap { grid-template-columns: 40px minmax(0,1fr) 40px; } }
</style>
