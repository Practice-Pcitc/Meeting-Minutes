<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Timeline } from 'vis-timeline/standalone'
import 'vis-timeline/styles/vis-timeline-graph2d.min.css'
import { authFetch, authRequest } from '../composables/useAuth'
import { useNotify } from '../composables/useNotify'
import { useStore } from '../composables/useStore'
import AppSelect from './AppSelect.vue'

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
const store = useStore()
const container = ref(null)
const activeId = ref('')
const playing = ref(false)
const currentTime = ref(0)
const cursorTimestamp = ref(0)
const loading = ref(false)
const zoomLevel = ref(0)
const transcribing = ref(false)
const speakerSaving = ref('')
const visibleStart = ref(0)
const visibleEnd = ref(0)
const transcriptView = ref('segments')
const focusedSegmentId = ref('')
const showManualEntries = ref(true)
const hoveredEntryId = ref('')
const selectedEntryId = ref('')
const urls = new Map()
const mergedSegmentElements = new Map()
const transcriptItemElements = new Map()
const audio = new Audio()
let timeline = null
let suppressRangeSync = false

const sorted = computed(() => [...props.recordings].sort((a, b) => a.createdAt - b.createdAt))
function itemDuration(item) { return item.duration ?? Math.max(0, Math.round((item.updatedAt - item.createdAt) / 1000)) }
function itemEnd(item) { return item.createdAt + Math.max(itemDuration(item), 1) * 1000 }
function entryTimestamp(entry) {
  const parsed = new Date(String(entry.time || '').replace(' ', 'T')).getTime()
  if (!Number.isFinite(parsed)) return Number(entry.createdAt) || Date.now()
  const created = new Date(Number(entry.createdAt) || parsed)
  const chosen = new Date(parsed)
  const sameMinute = created.getFullYear() === chosen.getFullYear()
    && created.getMonth() === chosen.getMonth()
    && created.getDate() === chosen.getDate()
    && created.getHours() === chosen.getHours()
    && created.getMinutes() === chosen.getMinutes()
  return sameMinute ? created.getTime() : parsed
}
const manualEntries = computed(() => [...store.entries.value]
  .map(entry => ({ ...entry, timestamp: entryTimestamp(entry) }))
  .sort((a, b) => a.timestamp - b.timestamp))
const visibleManualEntries = computed(() => showManualEntries.value ? manualEntries.value : [])
const timelinePoints = computed(() => [
  ...sorted.value.map(item => item.createdAt),
  ...sorted.value.map(itemEnd),
  ...visibleManualEntries.value.map(entry => entry.timestamp),
])
const timelineStart = computed(() => timelinePoints.value.length ? Math.min(...timelinePoints.value) : Date.now())
const timelineEnd = computed(() => timelinePoints.value.length ? Math.max(...timelinePoints.value) : timelineStart.value)
const timelineSpan = computed(() => Math.max(1000, timelineEnd.value - timelineStart.value))
const hasTimelineItems = computed(() => sorted.value.length || visibleManualEntries.value.length)
const activeItem = computed(() => sorted.value.find(item => item.id === activeId.value))
const totalDuration = computed(() => sorted.value.reduce((sum, item) => sum + itemDuration(item), 0))
const transcriptCount = computed(() => sorted.value.filter(item => item.transcript).length)
const speakerOptions = computed(() => [
  { value: '', label: '未指定' },
  ...store.persons.value.map(person => ({ value: person.id, label: person.name, description: person.role || '参会人员' })),
])
function clusterColor(recordingId, clusterId) {
  const palette = ['#526fe8', '#8b5cf6', '#0f9f7a', '#e07a32', '#d84f74', '#2087b8', '#7b8b28', '#a855a0']
  const text = `${recordingId}:${clusterId}`
  let hash = 0
  for (let index = 0; index < text.length; index += 1) hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0
  return palette[Math.abs(hash) % palette.length]
}
function clusterOrder(item, clusterId) {
  const ids = [...new Set((item.transcriptSegments || [])
    .filter(segment => segment.speakerClusterId != null)
    .map(segment => String(segment.speakerClusterId)))]
  return Math.max(0, ids.indexOf(String(clusterId))) + 1
}
const speakerClusters = computed(() => sorted.value.flatMap((item, itemIndex) => {
  const segments = Array.isArray(item.transcriptSegments) ? item.transcriptSegments : []
  const ids = [...new Set(segments
    .filter(segment => segment.speakerClusterId != null)
    .map(segment => String(segment.speakerClusterId)))]
  return ids.map((clusterId, clusterIndex) => {
    const matches = segments.filter(segment => String(segment.speakerClusterId) === clusterId)
    const assignment = (item.speakerAssignments || [])
      .filter(candidate => candidate.targetType === 'cluster' && candidate.targetId === clusterId)
      .sort((a, b) => (a.source === 'user-confirmed' ? 1 : 0) - (b.source === 'user-confirmed' ? 1 : 0))
      .at(-1)
    return {
      key: `${item.id}:${clusterId}`,
      item,
      clusterId,
      personId: assignment?.personId || '',
      label: `录音 ${itemIndex + 1} · 说话人 ${clusterIndex + 1}`,
      count: matches.length,
      sample: matches[0]?.text || '',
      color: clusterColor(item.id, clusterId),
    }
  })
}))
function splitTranscript(value) {
  const text = String(value || '').trim()
  if (!text) return []
  return (text.match(/[^。！？!?；;，,\n]+(?:[。！？!?；;，,]+|$)/g) || [text]).map(part => part.trim()).filter(Boolean)
}
const mergedTranscriptSegments = computed(() => sorted.value.flatMap((item, itemIndex) => {
  const baseSegments = Array.isArray(item.transcriptSegments) && item.transcriptSegments.length
    ? item.transcriptSegments
    : [{ id: `${item.id}:legacy`, text: item.transcript, startMs: 0, endMs: itemDuration(item) * 1000, timingSource: 'estimated' }]
  let displayIndex = 0
  return baseSegments.flatMap(baseSegment => {
    const sentences = splitTranscript(baseSegment.text)
    const totalUnits = Math.max(1, sentences.reduce((sum, sentence) => sum + sentence.length, 0))
    const baseStartMs = Math.max(0, Number(baseSegment.startMs) || 0)
    const baseEndMs = Math.max(baseStartMs, Number(baseSegment.endMs) || baseStartMs)
    let consumedUnits = 0
    return sentences.map((text, partIndex) => {
      const startMs = baseStartMs + (baseEndMs - baseStartMs) * consumedUnits / totalUnits
      consumedUnits += text.length
      const endMs = baseStartMs + (baseEndMs - baseStartMs) * consumedUnits / totalUnits
      const sentenceIndex = displayIndex
      displayIndex += 1
      return {
        id: `${baseSegment.id || `${item.id}:segment`}:${partIndex}`,
        baseSegmentId: baseSegment.id || `${item.id}:segment`,
        item,
        itemIndex,
        sentenceIndex,
        text,
        offset: startMs / 1000,
        endOffset: endMs / 1000,
        timestamp: item.createdAt + startMs,
        endTimestamp: item.createdAt + endMs,
        timingSource: baseSegment.timingSource || 'estimated',
        speakerClusterId: baseSegment.speakerClusterId,
      }
    })
  })
}))
const playbackSegmentId = computed(() => {
  if (!activeId.value) return ''
  const candidates = mergedTranscriptSegments.value.filter(segment => segment.item.id === activeId.value)
  const match = candidates.find((segment, index) => currentTime.value >= segment.offset && (currentTime.value < segment.endOffset || index === candidates.length - 1))
  return match?.id || ''
})
const highlightedSegmentId = computed(() => focusedSegmentId.value || playbackSegmentId.value)
const playbackEntryId = computed(() => {
  if (!playing.value || !cursorTimestamp.value) return ''
  const nearest = manualEntries.value.reduce((best, entry) => {
    const distance = Math.abs(entry.timestamp - cursorTimestamp.value)
    return !best || distance < best.distance ? { id: entry.id, distance } : best
  }, null)
  return nearest && nearest.distance <= 8000 ? nearest.id : ''
})
const highlightedEntryId = computed(() => hoveredEntryId.value || selectedEntryId.value || playbackEntryId.value)
const manualSegmentAnchors = computed(() => {
  const matches = new Map()
  const candidates = mergedTranscriptSegments.value
  for (const entry of manualEntries.value) {
    if (!entry.speakerId || !store.getPerson(entry.speakerId)) continue
    let best = null
    for (const segment of candidates) {
      const recordingStart = segment.item.createdAt - 30000
      const recordingEnd = itemEnd(segment.item) + 30000
      if (entry.timestamp < recordingStart || entry.timestamp > recordingEnd) continue
      const distance = entry.timestamp < segment.timestamp
        ? segment.timestamp - entry.timestamp
        : entry.timestamp > segment.endTimestamp ? entry.timestamp - segment.endTimestamp : 0
      if (distance <= 30000 && (!best || distance < best.distance)) best = { segment, distance }
    }
    if (!best) continue
    const existing = matches.get(best.segment.id)
    if (!existing || best.distance < existing.distance) {
      matches.set(best.segment.id, { entry, person: store.getPerson(entry.speakerId), distance: best.distance })
    }
  }
  return matches
})
function storedSpeakerPerson(segment) {
  const priorities = { diarization: 1, 'manual-anchor': 2, 'user-confirmed': 3 }
  const assignments = Array.isArray(segment.item.speakerAssignments) ? segment.item.speakerAssignments : []
  const match = assignments
    .filter(assignment => (assignment.targetType === 'segment' && assignment.targetId === segment.baseSegmentId)
      || (assignment.targetType === 'cluster' && segment.speakerClusterId != null && assignment.targetId === String(segment.speakerClusterId)))
    .sort((a, b) => (priorities[b.source] || 0) - (priorities[a.source] || 0))[0]
  const person = match?.personId ? store.getPerson(match.personId) : null
  return person ? { person, assignment: match } : null
}
const mergedDisplaySegments = computed(() => {
  let previousSpeakerKey = ''
  return mergedTranscriptSegments.value.map(segment => {
    const anchor = manualSegmentAnchors.value.get(segment.id)
    const stored = storedSpeakerPerson(segment)
    const preferStored = stored?.assignment?.source === 'user-confirmed'
    const person = preferStored ? stored.person : (anchor?.person || stored?.person || null)
    const source = preferStored || (!anchor && stored) ? stored?.assignment?.source : (anchor ? 'manual-anchor' : '')
    const anonymous = !person && segment.speakerClusterId != null
    const anonymousNumber = anonymous ? clusterOrder(segment.item, segment.speakerClusterId) : 0
    const speakerKey = person ? `person:${person.id}` : anonymous ? `cluster:${segment.item.id}:${segment.speakerClusterId}` : ''
    const showAvatar = Boolean(speakerKey) && (speakerKey !== previousSpeakerKey || segment.sentenceIndex === 0)
    previousSpeakerKey = speakerKey
    return {
      ...segment,
      person,
      showAvatar,
      avatarText: person?.name?.charAt(0) || (anonymous ? `S${anonymousNumber}` : ''),
      avatarTitle: person
        ? `${source === 'user-confirmed' ? '已确认发言人' : source === 'diarization' ? '说话人识别关联' : '手动记录关联'} · ${person.name}`
        : anonymous ? `匿名说话人 ${anonymousNumber}，可在上方确认身份` : '',
      avatarColor: person?.color || (anonymous ? clusterColor(segment.item.id, segment.speakerClusterId) : '#6f7f99'),
    }
  })
})
function entrySpeaker(entry) { return entry.speakerId ? store.getPerson(entry.speakerId) : null }
function entrySpeakerName(entry) { return entrySpeaker(entry)?.name || '会议记录' }
function entryColor(entry) {
  const value = entrySpeaker(entry)?.color || '#6f7f99'
  return /^#[0-9a-f]{3,8}$/i.test(value) ? value : '#6f7f99'
}
function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])
}
const overviewSegments = computed(() => sorted.value.map(item => ({
  id: item.id,
  active: item.id === activeId.value,
  left: `${Math.max(0, ((item.createdAt - timelineStart.value) / timelineSpan.value) * 100)}%`,
  width: `${Math.max(.35, ((itemEnd(item) - item.createdAt) / timelineSpan.value) * 100)}%`,
})))
const overviewEntries = computed(() => visibleManualEntries.value.map(entry => ({
  id: entry.id,
  active: highlightedEntryId.value === entry.id,
  left: `${Math.max(0, Math.min(100, ((entry.timestamp - timelineStart.value) / timelineSpan.value) * 100))}%`,
  color: entryColor(entry),
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
  if (focusedSegmentId.value) return
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
    focusedSegmentId.value = ''
    selectedEntryId.value = ''
    if (activeId.value !== item.id) { audio.pause(); audio.src = await sourceFor(item); activeId.value = item.id }
    audio.currentTime = Math.max(0, Math.min(offset, itemDuration(item)))
    cursorTimestamp.value = item.createdAt + audio.currentTime * 1000
    timeline?.setSelection([item.id], { focus: false })
    timeline?.setCustomTime(new Date(cursorTimestamp.value), 'playhead')
    timeline?.moveTo(new Date(cursorTimestamp.value), { animation: { duration: 300, easingFunction: 'easeInOutQuad' } })
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
  focusedSegmentId.value = ''
  selectedEntryId.value = ''
  const item = itemId ? sorted.value.find(entry => entry.id === itemId) : sorted.value.find(entry => timestamp >= entry.createdAt && timestamp <= itemEnd(entry))
  if (item) playItem(item, (timestamp - item.createdAt) / 1000)
  else {
    audio.pause(); activeId.value = ''; currentTime.value = 0; cursorTimestamp.value = timestamp
    timeline?.setSelection([]); timeline?.setCustomTime(new Date(timestamp), 'playhead')
  }
}
function buildItems() {
  const recordingItems = sorted.value.map((item, index) => ({
    id: item.id, group: 'recordings', content: `<span>录音 ${index + 1}</span>`, start: new Date(item.createdAt), end: new Date(itemEnd(item)), type: 'range',
    className: activeId.value === item.id ? 'recording-range active-recording' : 'recording-range',
    title: `${formatTime(item.createdAt, true)} – ${formatTime(itemEnd(item), true)}（${formatDuration(itemDuration(item))}）`,
  }))
  const entryItems = visibleManualEntries.value.map(entry => ({
    id: `entry:${entry.id}`,
    group: 'manual-entries',
    content: '<span class="manual-entry-symbol">◆</span>',
    start: new Date(entry.timestamp),
    type: 'point',
    className: highlightedEntryId.value === entry.id ? 'manual-entry-point active-entry' : 'manual-entry-point',
    style: `--entry-color:${entryColor(entry)}`,
    title: escapeHtml(`${formatTime(entry.timestamp, true)} · ${entrySpeakerName(entry)}${entry.topic ? ` · ${entry.topic}` : ''}\n${entry.content}`),
  }))
  return [...recordingItems, ...entryItems]
}
function buildGroups() {
  const groups = []
  if (sorted.value.length) groups.push({ id: 'recordings', content: '录音', order: 1 })
  if (visibleManualEntries.value.length) groups.push({ id: 'manual-entries', content: '手动记录', order: 2 })
  return groups
}
async function renderTimeline() {
  await nextTick()
  if (!container.value || !hasTimelineItems.value) { timeline?.destroy(); timeline = null; return }
  const padding = Math.max(30000, timelineSpan.value * .04)
  const options = {
    stack: false, selectable: true, multiselect: false, showCurrentTime: false, showMajorLabels: true, showMinorLabels: true,
    horizontalScroll: true, zoomable: true, moveable: true, zoomKey: '', orientation: { axis: 'bottom', item: 'top' },
    min: new Date(timelineStart.value - padding), max: new Date(timelineEnd.value + padding), zoomMin: 1000, zoomMax: timelineSpan.value + padding * 2,
    start: new Date(timelineStart.value - padding / 2), end: new Date(timelineEnd.value + padding / 2), margin: { item: 12, axis: 10 },
    format: { minorLabels: axisMinorLabel, majorLabels: axisMajorLabel }, tooltip: { followMouse: true, overflowMethod: 'cap' },
  }
  timeline?.destroy()
  timeline = new Timeline(container.value, buildItems(), buildGroups(), options)
  timeline.addCustomTime(new Date(cursorTimestamp.value || timelineStart.value), 'playhead')
  timeline.setCustomTimeTitle('播放位置', 'playhead')
  timeline.on('click', handleTimelineClick)
  timeline.on('itemover', properties => {
    const id = String(properties.item || '')
    if (id.startsWith('entry:')) hoveredEntryId.value = id.slice(6)
  })
  timeline.on('itemout', properties => {
    const id = String(properties.item || '')
    if (id === `entry:${hoveredEntryId.value}`) hoveredEntryId.value = ''
  })
  timeline.on('rangechange', syncVisibleRange)
  timeline.on('rangechanged', () => { syncVisibleRange(); syncZoomLevel() })
  syncVisibleRange()
}
function handleTimelineClick(properties) {
  if (!properties.time) return
  const id = String(properties.item || '')
  if (id.startsWith('entry:')) {
    const entry = manualEntries.value.find(item => item.id === id.slice(6))
    if (entry) locateManualEntry(entry)
    return
  }
  seekTo(properties.time.getTime(), id)
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
function focusTranscriptSegment(segment) {
  focusedSegmentId.value = segment.id
  cursorTimestamp.value = segment.timestamp
  timeline?.setSelection([segment.item.id], { focus: false })
  try { timeline?.setCustomTime(new Date(segment.timestamp), 'playhead') } catch { /* 时间轴可能正在重建 */ }
  timeline?.moveTo(new Date(segment.timestamp), { animation: { duration: 260, easingFunction: 'easeInOutQuad' } })
}
function clearTranscriptFocus() {
  if (!focusedSegmentId.value) return
  focusedSegmentId.value = ''
  if (!activeItem.value) return
  cursorTimestamp.value = activeItem.value.createdAt + currentTime.value * 1000
  try { timeline?.setCustomTime(new Date(cursorTimestamp.value), 'playhead') } catch { /* 时间轴可能正在重建 */ }
}
function clearMergedHover() {
  clearTranscriptFocus()
}
function setMergedSegmentElement(id, element) {
  if (element) mergedSegmentElements.set(id, element)
  else mergedSegmentElements.delete(id)
}
function setTranscriptItemElement(id, element) {
  if (element) transcriptItemElements.set(id, element)
  else transcriptItemElements.delete(id)
}
async function locateManualEntry(entry) {
  selectedEntryId.value = entry.id
  hoveredEntryId.value = ''
  focusedSegmentId.value = ''
  cursorTimestamp.value = entry.timestamp
  audio.pause()
  timeline?.setSelection([`entry:${entry.id}`], { focus: false })
  try { timeline?.setCustomTime(new Date(entry.timestamp), 'playhead') } catch { /* 时间轴可能正在重建 */ }
  timeline?.moveTo(new Date(entry.timestamp), { animation: { duration: 320, easingFunction: 'easeInOutQuad' } })

  const recordingItem = sorted.value.find(item => entry.timestamp >= item.createdAt && entry.timestamp <= itemEnd(item))
  if (!recordingItem) {
    activeId.value = ''
    currentTime.value = 0
    return
  }
  try {
    loading.value = true
    if (activeId.value !== recordingItem.id) {
      audio.src = await sourceFor(recordingItem)
      activeId.value = recordingItem.id
    }
    const offset = Math.max(0, Math.min(itemDuration(recordingItem), (entry.timestamp - recordingItem.createdAt) / 1000))
    audio.currentTime = offset
    currentTime.value = offset
  } catch (error) { notify.error(`录音定位失败：${error.message}`) }
  finally { loading.value = false }
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
async function assignSpeaker(cluster, personId) {
  speakerSaving.value = cluster.key
  try {
    await authRequest(
      'PATCH',
      `/meetings/${props.meetingId}/recordings/${cluster.item.id}/speaker-assignments/${encodeURIComponent(cluster.clusterId)}`,
      { personId: personId || null },
    )
    emit('changed')
    notify.success(personId ? '说话人身份已确认' : '说话人身份已清除')
  } catch (error) { notify.error(error.message) }
  finally { speakerSaving.value = '' }
}

watch([() => props.recordings, () => store.entries.value, showManualEntries], renderTimeline, { deep: true })
watch([activeId, selectedEntryId, playbackEntryId], () => { if (timeline) timeline.setItems(buildItems()) })
watch(highlightedSegmentId, async id => {
  if (!id || transcriptView.value !== 'merged') return
  await nextTick()
  mergedSegmentElements.get(id)?.scrollIntoView({ block: 'nearest', behavior: playing.value ? 'smooth' : 'auto' })
})
watch([activeId, transcriptView], async ([id, view]) => {
  if (!id || view !== 'segments') return
  await nextTick()
  transcriptItemElements.get(id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
})
onMounted(renderTimeline)
onBeforeUnmount(() => { audio.pause(); timeline?.destroy(); urls.forEach(url => URL.revokeObjectURL(url)) })
</script>

<template>
  <section class="recording-timeline">
    <div class="timeline-section">
      <div class="timeline-heading">
        <div>
          <h3>会议时间轴</h3>
          <p>{{ hasTimelineItems ? `${sorted.length} 段录音 · ${manualEntries.length} 条手动记录 · 会议跨度 ${formatDuration(timelineSpan / 1000)}` : '录音和手动记录将按实际时间显示在这里' }}</p>
        </div>
        <button v-if="manualEntries.length" class="manual-toggle" :class="{ active: showManualEntries }" @click="showManualEntries = !showManualEntries"><span></span>手动记录 {{ manualEntries.length }}</button>
      </div>

      <div v-if="hasTimelineItems" class="transport-bar">
        <button class="master-play" :disabled="loading || !sorted.length" :title="sorted.length ? (playing ? '暂停' : '播放') : '暂无可播放录音'" @click="togglePlayback"><SvgIcon :name="playing ? 'pause' : 'play'" :size="16" /></button>
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

      <template v-if="hasTimelineItems">
        <div ref="container" class="vis-timeline-host"></div>
        <div class="overview-wrap">
          <time>{{ formatTime(timelineStart) }}</time>
          <button class="overview-track" title="点击移动详细时间轴" @click="moveOverview">
            <span v-for="segment in overviewSegments" :key="segment.id" class="overview-segment" :class="{ active: segment.active }" :style="{ left: segment.left, width: segment.width }"></span>
            <span v-for="entry in overviewEntries" :key="`entry-${entry.id}`" class="overview-entry" :class="{ active: entry.active }" :style="{ left: entry.left, '--entry-color': entry.color }"></span>
            <span class="overview-window" :style="overviewWindowStyle"></span>
            <span class="overview-cursor" :style="overviewCursorStyle"></span>
          </button>
          <time>{{ formatTime(timelineEnd) }}</time>
        </div>
        <div class="timeline-hint"><span>滚轮缩放 · 拖动平移 · 点击精准跳转</span><span>蓝色为录音 · 菱形为手动记录</span></div>
      </template>
      <div v-else class="timeline-empty"><span class="empty-icon"><SvgIcon name="microphone" :size="20" /></span><div><strong>还没有会议事件</strong><span>开始录音或添加手动记录后，时间轴将自动生成</span></div></div>
    </div>

    <section v-if="sorted.length || liveActive || visibleManualEntries.length" class="transcript-panel">
      <div class="transcript-heading">
        <div><h4>转写记录</h4><span>{{ transcriptCount ? `已生成 ${transcriptCount} 段文字，点击段落即可播放` : '实时文字和历史转写将统一显示在这里' }}</span></div>
        <div class="transcript-toolbar">
          <div class="transcript-view-switcher" role="tablist" aria-label="转写视图">
            <button :class="{ active: transcriptView === 'segments' }" role="tab" :aria-selected="transcriptView === 'segments'" @click="transcriptView = 'segments'">时间分段</button>
            <button :class="{ active: transcriptView === 'merged' }" role="tab" :aria-selected="transcriptView === 'merged'" @click="transcriptView = 'merged'">合并文本</button>
          </div>
          <div class="transcript-actions">
            <button v-if="sorted.some(item => !item.transcript)" :disabled="transcribing" @click="transcribeAll(false)"><SvgIcon name="file-text" :size="14" />{{ transcribing ? '转写中…' : '转写未完成片段' }}</button>
            <button v-else-if="sorted.some(item => item.transcript)" :disabled="transcribing" @click="transcribeAll(true)">重新转写</button>
          </div>
        </div>
      </div>
      <div v-if="transcriptView === 'segments'" class="transcript-list">
        <button v-for="(item, index) in sorted" :key="item.id" :ref="element => setTranscriptItemElement(item.id, element)" class="transcript-item" :class="{ active: activeId === item.id }" @click="playItem(item)">
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
      <div v-else class="merged-view">
        <div v-if="speakerClusters.length" class="speaker-mapping-panel">
          <div class="speaker-mapping-heading">
            <div><strong>确认说话人</strong><span>系统先区分匿名声音，请将编号关联到本次会议的参会人员。</span></div>
            <span>{{ speakerClusters.length }} 位匿名说话人</span>
          </div>
          <div class="speaker-mapping-grid">
            <div v-for="cluster in speakerClusters" :key="cluster.key" class="speaker-mapping-item">
              <span class="speaker-cluster-avatar" :style="{ '--speaker-color': cluster.color }">S{{ cluster.label.split('说话人 ')[1] }}</span>
              <div class="speaker-cluster-copy"><strong>{{ cluster.label }}</strong><span>{{ cluster.count }} 段 · {{ cluster.sample }}</span></div>
              <div class="speaker-person-select">
                <AppSelect
                  :model-value="cluster.personId"
                  :options="speakerOptions"
                  :disabled="speakerSaving === cluster.key"
                  :clearable="false"
                  placeholder="选择参会人员"
                  @update:model-value="assignSpeaker(cluster, $event)"
                />
              </div>
            </div>
          </div>
        </div>
        <div v-else-if="transcriptCount" class="speaker-unavailable-note">
          <span>S</span>
          <div><strong>当前转写没有说话人编号</strong><small>使用启用了 CAM++ 的 FunASR 服务后点击“重新转写”，即可区分匿名说话人并在这里确认身份。</small></div>
        </div>
        <div class="merged-transcript" @mouseleave="clearMergedHover">
        <div v-if="mergedDisplaySegments.length" class="merged-copy">
          <template v-for="segment in mergedDisplaySegments" :key="segment.id">
            <span v-if="segment.showAvatar" class="merged-avatar" :style="{ '--avatar-color': segment.avatarColor }" :title="segment.avatarTitle">{{ segment.avatarText }}</span>
            <button
              :ref="element => setMergedSegmentElement(segment.id, element)"
              class="merged-sentence"
              :class="{ highlighted: highlightedSegmentId === segment.id, 'new-recording': segment.sentenceIndex === 0 }"
              :title="`${formatTime(segment.timestamp, true)}，点击播放`"
              @mouseenter="focusTranscriptSegment(segment)"
              @focus="focusTranscriptSegment(segment)"
              @click="playItem(segment.item, segment.offset)"
            >
              <small v-if="segment.sentenceIndex === 0">{{ formatTime(segment.item.createdAt) }}</small>{{ segment.text }}
            </button>
          </template>
          <span v-if="liveActive" class="merged-live" :class="{ active: liveTranscribing }"><i></i>{{ liveTranscript || (liveError || '实时转写等待语音…') }}</span>
        </div>
        <div v-else class="merged-empty">
          <SvgIcon name="file-text" :size="20" />
          <span>{{ liveActive ? (liveTranscript || '实时转写等待语音…') : '暂无可合并的转写文本' }}</span>
        </div>
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
.manual-toggle { display: inline-flex; align-items: center; gap: 6px; padding: 6px 9px; border: 1px solid var(--border); border-radius: 7px; color: var(--text-muted); background: var(--surface); font-size: .69rem; white-space: nowrap; }
.manual-toggle span { width: 7px; height: 7px; border-radius: 2px; background: #aeb7c6; transform: rotate(45deg); }
.manual-toggle.active { border-color: var(--primary-soft); color: var(--primary); background: var(--primary-light); }
.manual-toggle.active span { background: var(--primary); }
.transport-bar { min-height: 54px; display: flex; align-items: center; gap: 11px; margin-bottom: 10px; padding: 7px 9px; border: 1px solid var(--border-light); border-radius: 10px; background: #fafbfc; }
.master-play { width: 36px; height: 36px; display: grid; place-items: center; flex: none; border-radius: 50%; color: #fff; background: var(--primary); box-shadow: 0 4px 10px rgba(40,100,240,.2); }
.master-play:hover { background: var(--primary-hover); }
.master-play:disabled { opacity: .42; cursor: not-allowed; box-shadow: none; }
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
.vis-timeline-host { height: 158px; border: 1px solid #dfe5ee; border-radius: 9px; overflow: hidden; background: #fbfcfe; }
.vis-timeline-host :deep(.vis-timeline) { border: 0; font-family: inherit; }
.vis-timeline-host :deep(.vis-panel.vis-center),.vis-timeline-host :deep(.vis-panel.vis-bottom) { border-color: #e5e9f1; }
.vis-timeline-host :deep(.vis-labelset .vis-label) { color: #778197; border-bottom-color: #edf0f5; background: #f7f9fc; font-size: 10px; font-weight: 600; }
.vis-timeline-host :deep(.vis-labelset .vis-label .vis-inner) { padding: 8px 9px; }
.vis-timeline-host :deep(.vis-foreground .vis-group) { border-bottom-color: #edf0f5; }
.vis-timeline-host :deep(.vis-time-axis .vis-text) { color: #748096; font-size: 10px; }
.vis-timeline-host :deep(.vis-time-axis .vis-grid.vis-minor) { border-color: #edf0f5; }
.vis-timeline-host :deep(.vis-time-axis .vis-grid.vis-major) { border-color: #dfe4ed; }
.vis-timeline-host :deep(.vis-item.recording-range) { min-width: 3px; overflow: hidden; border: 0; border-radius: 4px; color: #fff; background: linear-gradient(90deg,#5b84f5,#2864f0); box-shadow: 0 2px 5px rgba(43,88,194,.22); cursor: pointer; }
.vis-timeline-host :deep(.vis-item.recording-range.vis-selected),.vis-timeline-host :deep(.vis-item.active-recording) { background: linear-gradient(90deg,#7c56e8,#4d63eb); box-shadow: 0 0 0 2px rgba(100,83,221,.2); }
.vis-timeline-host :deep(.vis-item.manual-entry-point) { border: 0; color: var(--entry-color); background: transparent; cursor: pointer; }
.vis-timeline-host :deep(.vis-item.manual-entry-point .vis-item-content) { padding: 1px 4px; font-size: 15px; line-height: 1; transform: translateX(-7px); }
.vis-timeline-host :deep(.vis-item.manual-entry-point.vis-selected),.vis-timeline-host :deep(.vis-item.manual-entry-point.active-entry) { color: var(--entry-color); background: transparent; box-shadow: none; filter: drop-shadow(0 0 4px color-mix(in srgb,var(--entry-color) 48%,transparent)); }
.vis-timeline-host :deep(.vis-item.manual-entry-point.vis-selected .manual-entry-symbol),.vis-timeline-host :deep(.vis-item.manual-entry-point.active-entry .manual-entry-symbol),.vis-timeline-host :deep(.vis-item.manual-entry-point:hover .manual-entry-symbol) { display: inline-block; transform: scale(1.35); }
.vis-timeline-host :deep(.vis-item .vis-item-content) { padding: 5px 7px; font-size: 10px; }
.vis-timeline-host :deep(.vis-custom-time.playhead) { z-index: 20; width: 2px; background: #ef4760; pointer-events: none; }
.overview-wrap { display: grid; grid-template-columns: 48px minmax(0,1fr) 48px; align-items: center; gap: 8px; margin-top: 9px; }
.overview-wrap time { color: var(--text-muted); font-size: .64rem; font-variant-numeric: tabular-nums; }
.overview-wrap time:last-child { text-align: right; }
.overview-track { position: relative; height: 18px; overflow: hidden; border-radius: 5px; background: #edf1f7; }
.overview-segment { position: absolute; top: 5px; height: 8px; min-width: 2px; border-radius: 2px; background: #7e9df2; pointer-events: none; }
.overview-segment.active { background: #7057df; }
.overview-entry { position: absolute; z-index: 2; top: 5px; width: 7px; height: 7px; margin-left: -3px; border: 1px solid #fff; border-radius: 2px; background: var(--entry-color); transform: rotate(45deg); pointer-events: none; }
.overview-entry.active { box-shadow: 0 0 0 2px color-mix(in srgb,var(--entry-color) 28%,transparent); transform: rotate(45deg) scale(1.25); }
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
.transcript-toolbar { display: flex; align-items: center; gap: 10px; }
.transcript-view-switcher { display: flex; align-items: center; padding: 3px; border: 1px solid var(--border); border-radius: 8px; background: #f5f7fa; }
.transcript-view-switcher button { padding: 4px 9px; border-radius: 5px; color: var(--text-muted); font-size: .68rem; transition: var(--transition); }
.transcript-view-switcher button:hover { color: var(--text-secondary); }
.transcript-view-switcher button.active { color: var(--primary); background: var(--surface); box-shadow: 0 1px 3px rgba(31,35,41,.1); font-weight: 650; }
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
.merged-transcript { max-height: 350px; overflow-y: auto; padding: 18px 20px; border: 1px solid #e4e8ef; border-radius: 10px; background: #fcfcfd; scroll-behavior: smooth; }
.merged-view { display: flex; flex-direction: column; gap: 10px; }
.speaker-mapping-panel { padding: 13px; border: 1px solid #dfe5f4; border-radius: 10px; background: #f8faff; }
.speaker-mapping-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; margin-bottom: 10px; }
.speaker-mapping-heading>div { min-width: 0; display: flex; flex-direction: column; }
.speaker-mapping-heading strong { color: #27344c; font-size: .76rem; }
.speaker-mapping-heading span { overflow: hidden; color: var(--text-muted); font-size: .66rem; text-overflow: ellipsis; white-space: nowrap; }
.speaker-mapping-heading>span { flex: none; padding: 3px 7px; border-radius: 999px; color: var(--primary); background: var(--primary-light); }
.speaker-mapping-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 8px; }
.speaker-mapping-item { min-width: 0; display: grid; grid-template-columns: 30px minmax(0,1fr) 170px; align-items: center; gap: 9px; padding: 8px; border: 1px solid #e7eaf1; border-radius: 8px; background: #fff; }
.speaker-cluster-avatar { width: 28px; height: 28px; display: grid; place-items: center; border-radius: 50%; color: #fff; background: var(--speaker-color); font-size: .62rem; font-weight: 750; }
.speaker-cluster-copy { min-width: 0; display: flex; flex-direction: column; }
.speaker-cluster-copy strong { color: var(--text-secondary); font-size: .7rem; }
.speaker-cluster-copy span { overflow: hidden; color: var(--text-muted); font-size: .64rem; text-overflow: ellipsis; white-space: nowrap; }
.speaker-person-select { min-width: 0; }
.speaker-person-select :deep(.select-trigger) { height: 32px; padding: 0 10px; }
.speaker-unavailable-note { display: flex; align-items: center; gap: 9px; padding: 9px 11px; border: 1px dashed #d9dfeb; border-radius: 9px; color: var(--text-muted); background: #fafbfc; }
.speaker-unavailable-note>span { width: 25px; height: 25px; display: grid; place-items: center; flex: none; border-radius: 50%; color: #fff; background: #a7b0bf; font-size: .65rem; font-weight: 750; }
.speaker-unavailable-note>div { min-width: 0; display: flex; flex-direction: column; }
.speaker-unavailable-note strong { color: var(--text-secondary); font-size: .7rem; }
.speaker-unavailable-note small { font-size: .64rem; }
.merged-copy { color: #273247; font-size: .86rem; line-height: 2.05; text-align: justify; }
.merged-sentence { display: inline; padding: 3px 2px; border-radius: 4px; text-align: left; line-height: inherit; transition: color .14s ease,background .14s ease,box-shadow .14s ease; }
.merged-sentence.new-recording { margin-left: 8px; }
.merged-sentence.new-recording:first-child { margin-left: 0; }
.merged-sentence small { margin-right: 5px; padding: 2px 5px; border-radius: 4px; color: var(--text-muted); background: #eef1f5; font-size: .6rem; font-variant-numeric: tabular-nums; vertical-align: 1px; }
.merged-sentence:hover,.merged-sentence:focus-visible,.merged-sentence.highlighted { outline: none; color: #174bbf; background: #dfeaff; box-shadow: 0 0 0 2px #dfeaff; }
.merged-sentence.highlighted small { color: var(--primary); background: #fff; }
.merged-live { display: inline; margin-left: 8px; padding: 3px 5px; border-radius: 4px; color: var(--text-muted); background: #f1f4f9; }
.merged-live.active { color: #174bbf; background: var(--primary-light); }
.merged-live i { display: inline-block; width: 6px; height: 6px; margin-right: 6px; border-radius: 50%; background: #ef4760; vertical-align: 1px; }
.merged-live.active i { animation: livePulse 1.4s ease-out infinite; }
.merged-avatar { width: 22px; height: 22px; display: inline-grid; place-items: center; margin: 0 5px 0 8px; border: 2px solid #fff; border-radius: 50%; color: #fff; background: var(--avatar-color); box-shadow: 0 0 0 1px color-mix(in srgb,var(--avatar-color) 24%,transparent); font-size: .65rem; font-weight: 700; line-height: 1; vertical-align: -6px; }
.merged-avatar:first-child { margin-left: 0; }
.merged-empty { min-height: 86px; display: flex; align-items: center; justify-content: center; gap: 8px; color: var(--text-muted); font-size: .76rem; }
@keyframes livePulse { 0% { box-shadow: 0 0 0 0 rgba(239,71,96,.4); } 70%,100% { box-shadow: 0 0 0 5px rgba(239,71,96,0); } }
@media (max-width: 980px) { .speaker-mapping-grid { grid-template-columns: 1fr; } }
@media (max-width: 860px) { .transport-bar { flex-wrap: wrap; }.zoom-controls { order: 3; width: 100%; margin-left: 47px; }.zoom-controls input { flex: 1; }.active-actions { margin-left: auto; } }
@media (max-width: 620px) { .timeline-section,.transcript-panel { padding: 16px; }.transport-bar { align-items: flex-start; }.playback-copy { min-width: 0; flex: 1; }.zoom-controls { margin-left: 0; }.active-actions { padding-left: 0; border-left: 0; }.timeline-hint { flex-direction: column; gap: 2px; }.transcript-heading { align-items: flex-start; flex-direction: column; gap: 8px; }.transcript-toolbar { width: 100%; justify-content: space-between; }.transcript-list::before { left: 68px; }.transcript-item { grid-template-columns: 52px 10px minmax(0,1fr); gap: 7px; }.overview-wrap { grid-template-columns: 40px minmax(0,1fr) 40px; }.speaker-mapping-heading { flex-direction: column; gap: 6px; }.speaker-mapping-item { grid-template-columns: 30px minmax(0,1fr); }.speaker-person-select { grid-column: 1 / -1; }.merged-transcript { padding: 14px; }.merged-copy { font-size: .82rem; line-height: 1.95; } }
</style>
