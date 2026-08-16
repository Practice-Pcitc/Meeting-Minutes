<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useNotify } from '../composables/useNotify'
import { authFetch, authRequest } from '../composables/useAuth'

const props = defineProps({
  meetingTitle: { type: String, default: '' },
  meetingId: { type: String, required: true },
})
const notify = useNotify()
const status = ref('idle')
const seconds = ref(0)
const audioUrl = ref('')
const audioBlob = ref(null)
const mimeType = ref('')
let recorder = null
let stream = null
let timer = null
let chunks = []
let saveQueue = Promise.resolve()
let serverRecordingId = ''

const DB_NAME = 'meeting-minutes-audio'
const STORE_NAME = 'recordings'

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: 'meetingId' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
async function withStore(mode, operation) {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode)
    const request = operation(transaction.objectStore(STORE_NAME))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    transaction.oncomplete = () => db.close()
  })
}
function persist(recordingNow = false) {
  const snapshot = {
    meetingId: props.meetingId,
    chunks: [...chunks],
    mimeType: recorder?.mimeType || mimeType.value || 'audio/webm',
    seconds: seconds.value,
    recording: recordingNow,
    updatedAt: Date.now(),
  }
  saveQueue = saveQueue.then(() => withStore('readwrite', store => store.put(snapshot)))
    .catch(() => notify.error('录音本地保存失败，请检查浏览器存储空间'))
  return saveQueue
}
async function removeLocal() {
  await saveQueue
  return withStore('readwrite', store => store.delete(props.meetingId))
}
async function restoreLocal() {
  try {
    const saved = await withStore('readonly', store => store.get(props.meetingId))
    if (!saved?.chunks?.length) return
    chunks = saved.chunks
    seconds.value = saved.seconds || 0
    mimeType.value = saved.mimeType || 'audio/webm'
    audioBlob.value = new Blob(chunks, { type: mimeType.value })
    audioUrl.value = URL.createObjectURL(audioBlob.value)
    status.value = 'stopped'
    if (saved.recording) notify.success('已恢复上次意外中断前保存的录音')
  } catch {
    notify.error('无法读取本地录音')
  }
}

async function restoreServerRecording() {
  try {
    const info = await authRequest('GET', `/meetings/${props.meetingId}/recordings/latest`)
    if (!info) return
    const response = await authFetch(`/meetings/${props.meetingId}/recordings/${info.id}/audio`)
    const blob = await response.blob()
    if (audioUrl.value) URL.revokeObjectURL(audioUrl.value)
    audioBlob.value = blob
    mimeType.value = info.mimeType
    audioUrl.value = URL.createObjectURL(blob)
    serverRecordingId = info.id
    status.value = 'stopped'
  } catch { /* 没有后端录音时仍可使用本地恢复结果 */ }
}

function uploadChunk(chunk) {
  if (!serverRecordingId) return
  saveQueue = saveQueue.then(() => authFetch(
    `/meetings/${props.meetingId}/recordings/${serverRecordingId}/chunks`,
    { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: chunk },
  )).catch((error) => {
    notify.error(`录音上传失败：${error.message}`)
    throw error
  })
}

const recording = computed(() => status.value === 'recording')
const paused = computed(() => status.value === 'paused')
const duration = computed(() => {
  const h = Math.floor(seconds.value / 3600)
  const m = Math.floor((seconds.value % 3600) / 60)
  const s = seconds.value % 60
  return [h, m, s].slice(h ? 0 : 1).map(v => String(v).padStart(2, '0')).join(':')
})

function releaseStream() {
  stream?.getTracks().forEach(track => track.stop())
  stream = null
}
function stopClock() { clearInterval(timer); timer = null }
function startClock() {
  stopClock()
  timer = setInterval(() => { seconds.value += 1 }, 1000)
}
async function reset() {
  if (audioUrl.value) URL.revokeObjectURL(audioUrl.value)
  audioUrl.value = ''
  audioBlob.value = null
  mimeType.value = ''
  seconds.value = 0
  status.value = 'idle'
  chunks = []
  if (serverRecordingId) {
    try { await authRequest('DELETE', `/meetings/${props.meetingId}/recordings/${serverRecordingId}`) } catch { notify.error('删除服务器录音失败') }
    serverRecordingId = ''
  }
  try { await removeLocal() } catch { notify.error('删除本地录音失败') }
}
function supportedType() {
  return ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm']
    .find(type => MediaRecorder.isTypeSupported(type)) || ''
}

async function start() {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    notify.error('当前浏览器不支持录音，请使用最新版 Chrome、Edge 或 Safari')
    return
  }
  try {
    await reset()
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const type = supportedType()
    recorder = type ? new MediaRecorder(stream, { mimeType: type }) : new MediaRecorder(stream)
    const serverInfo = await authRequest('POST', `/meetings/${props.meetingId}/recordings/start`, { mimeType: recorder.mimeType || type })
    serverRecordingId = serverInfo.id
    chunks = []
    recorder.ondataavailable = event => {
      if (!event.data.size) return
      chunks.push(event.data)
      persist(recorder?.state !== 'inactive')
      uploadChunk(event.data)
    }
    recorder.onstop = async () => {
      mimeType.value = recorder.mimeType || type || 'audio/webm'
      audioBlob.value = new Blob(chunks, { type: mimeType.value })
      audioUrl.value = URL.createObjectURL(audioBlob.value)
      status.value = 'stopped'
      releaseStream()
      persist(false)
      try {
        await saveQueue
        await authRequest('POST', `/meetings/${props.meetingId}/recordings/${serverRecordingId}/finish`)
        notify.success('录音已保存到服务器')
      } catch (error) { notify.error(`服务器录音保存未完成：${error.message}`) }
    }
    recorder.onerror = () => {
      stopClock(); releaseStream(); status.value = 'idle'
      notify.error('录音过程中发生错误，请重新开始')
    }
    recorder.start(1000)
    status.value = 'recording'
    startClock()
  } catch (error) {
    releaseStream()
    if (['NotAllowedError', 'SecurityError'].includes(error?.name)) notify.error('无法使用麦克风，请允许浏览器访问麦克风')
    else if (error?.name === 'NotFoundError') notify.error('没有检测到可用的麦克风')
    else notify.error(`录音启动失败：${error?.message || '未知错误'}`)
  }
}
function togglePause() {
  if (!recorder) return
  if (recording.value) { recorder.pause(); status.value = 'paused'; stopClock() }
  else if (paused.value) { recorder.resume(); status.value = 'recording'; startClock() }
}
function stop() {
  if (!recorder || recorder.state === 'inactive') return
  stopClock()
  recorder.stop()
}
function download() {
  const extension = mimeType.value.includes('mp4') ? 'm4a' : mimeType.value.includes('ogg') ? 'ogg' : 'webm'
  const title = (props.meetingTitle || '会议录音').replace(/[\\/:*?"<>|]/g, '_')
  const stamp = new Date().toLocaleString('sv-SE').replace(/[ :]/g, '-')
  const link = document.createElement('a')
  link.href = audioUrl.value
  link.download = `${title}_${stamp}.${extension}`
  link.click()
}

onBeforeUnmount(() => {
  stopClock()
  if (recorder?.state !== 'inactive') recorder?.stop()
  releaseStream()
  if (audioUrl.value) URL.revokeObjectURL(audioUrl.value)
})

onMounted(async () => { await restoreLocal(); await restoreServerRecording() })
</script>

<template>
  <section class="audio-recorder" :class="{ active: recording || paused }" aria-label="会议录音">
    <div class="recorder-main">
      <div class="recorder-state">
        <div class="status-label"><span class="record-dot" :class="{ pulse: recording }"></span>{{ recording ? '录音中' : paused ? '已暂停' : audioUrl ? '录音已完成' : '准备录音' }}</div>
        <strong class="record-time" aria-live="polite">{{ duration }}</strong>
      </div>
      <div class="wave-area" :class="{ moving: recording }" aria-hidden="true">
        <i v-for="n in 52" :key="n" :style="{ height: `${8 + ((n * 17) % 30)}px`, animationDelay: `${(n % 9) * -0.08}s` }"></i>
      </div>
      <div class="recorder-actions">
        <button v-if="status === 'idle' || status === 'stopped'" class="btn btn-primary record-start" @click="start"><span class="button-dot"></span>{{ audioUrl ? '重新录音' : '开始录音' }}</button>
        <button v-if="recording || paused" class="btn btn-ghost" @click="togglePause"><span class="pause-icon">{{ paused ? '▶' : 'Ⅱ' }}</span>{{ paused ? '继续' : '暂停' }}</button>
        <button v-if="recording || paused" class="btn stop-button" @click="stop"><span class="stop-icon"></span>结束录音</button>
      </div>
    </div>
    <div class="save-row">
      <span>输入源：默认麦克风</span><span class="save-status"><b>✓</b>{{ recording ? '正在实时保存到服务器' : audioUrl ? '已保存到服务器' : '录音将实时保存到服务器' }}</span>
      <div v-if="audioUrl" class="playback"><audio :src="audioUrl" controls preload="metadata" /><button class="btn btn-ghost btn-sm" @click="download">下载录音</button><button class="btn-icon delete-recording" title="删除服务器录音" @click="reset">×</button></div>
    </div>
  </section>
</template>

<style scoped>
.audio-recorder { padding: 20px 24px 13px; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow-sm); flex-shrink: 0; }
.audio-recorder.active { border-color: #dce6fb; }
.recorder-main { display: flex; align-items: center; gap: 28px; }
.recorder-state { min-width: 150px; display: flex; flex-direction: column; gap: 4px; }
.status-label { display: flex; align-items: center; gap: 8px; font-size: .86rem; font-weight: 650; }
.record-time { color: #101b32; font-size: 2.05rem; line-height: 1.15; font-variant-numeric: tabular-nums; letter-spacing: .02em; }
.record-dot { width: 10px; height: 10px; border-radius: 50%; background: #aeb9ca; flex: none; }
.active .record-dot { background: #ef4444; }
.record-dot.pulse { animation: pulse 1.4s ease-out infinite; }
.wave-area { height: 48px; flex: 1; min-width: 160px; display: flex; align-items: center; justify-content: center; gap: 3px; overflow: hidden; opacity: .55; }
.wave-area i { width: 3px; max-height: 40px; flex: 0 0 3px; border-radius: 4px; background: linear-gradient(#7449f4,#2466f1); transform: scaleY(.62); }
.wave-area.moving { opacity: 1; }
.wave-area.moving i { animation: wave .75s ease-in-out infinite alternate; }
.recorder-actions { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.recorder-actions .btn { height: 42px; padding: 0 16px; }
.record-start { min-width: 112px; justify-content: center; }
.stop-button { color: #e33e3e; background: #fff; border-color: #ff8c8c; }
.stop-button:hover { background: #fff4f4; }
.stop-icon { width: 13px; height: 13px; border: 2px solid currentColor; border-radius: 50%; position: relative; }
.stop-icon::after { content: ''; position: absolute; inset: 3px; border-radius: 50%; background: currentColor; }
.pause-icon { width: 14px; color: #31405b; font-weight: 800; }
.button-dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
.save-row { min-height: 38px; display: flex; align-items: center; gap: 26px; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border-light); color: var(--text-muted); font-size: .75rem; }
.save-status { display: inline-flex; align-items: center; gap: 5px; color: var(--text-secondary); }
.save-status b { width: 16px; height: 16px; display: inline-grid; place-items: center; border: 1px solid #54b888; border-radius: 50%; color: #2aa46c; font-size: .65rem; }
.playback { margin-left: auto; display: flex; align-items: center; gap: 7px; }
.playback audio { width: 230px; height: 30px; }
.delete-recording { width: 30px; height: 30px; color: var(--text-muted); font-size: 20px; }
@keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(239,68,68,.45); } 70%,100% { box-shadow: 0 0 0 7px rgba(239,68,68,0); } }
@keyframes wave { from { transform: scaleY(.35); } to { transform: scaleY(1); } }
@media (max-width: 980px) { .wave-area { display: none; } .playback audio { width: 180px; } }
@media (max-width: 760px) { .audio-recorder { padding: 16px; } .recorder-main { flex-wrap: wrap; gap: 14px; } .recorder-actions { margin-left: auto; } .save-row { flex-wrap: wrap; gap: 8px 16px; } .playback { flex-basis: 100%; margin-left: 0; } }
</style>
