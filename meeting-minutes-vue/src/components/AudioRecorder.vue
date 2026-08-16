<script setup>
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useNotify } from '../composables/useNotify'
import { authFetch, authRequest, useAuth } from '../composables/useAuth'
import AppSelect from './AppSelect.vue'
const RecordingTimeline = defineAsyncComponent(() => import('./RecordingTimeline.vue'))

const props = defineProps({
  meetingTitle: { type: String, default: '' },
  meetingId: { type: String, required: true },
  meetingEnded: Boolean,
})
const emit = defineEmits(['status-change'])
const notify = useNotify()
const { auth } = useAuth()
const status = ref('idle')
const seconds = ref(0)
const audioUrl = ref('')
const audioBlob = ref(null)
const mimeType = ref('')
const audioInputs = ref([])
const selectedDeviceId = ref(localStorage.getItem('meeting-minutes-audio-input') || '')
const activeDeviceLabel = ref('')
const waveformBars = ref(Array(52).fill(4))
const recordings = ref([])
const liveTranscript = ref('')
const liveTranscribing = ref(false)
const liveError = ref('')
const audioInputOptions = computed(() => [
  { value: '', label: '系统默认麦克风' },
  ...audioInputs.value.map(device => ({ value: device.id, label: device.label })),
])
let recorder = null
let stream = null
let timer = null
let audioContext = null
let analyser = null
let analyserSource = null
let animationFrame = null
let stopPromise = null
let resolveStop = null
let chunks = []
let saveQueue = Promise.resolve()
let serverRecordingId = ''
let realtimeSocket = null
let realtimeWorklet = null
let realtimeMute = null
let realtimeWorkletUrl = ''
let committedTranscript = ''
let realtimeFinishPromise = null

const DB_NAME = 'meeting-minutes-audio'
const STORE_NAME = 'recordings'

watch(selectedDeviceId, value => {
  if (value) localStorage.setItem('meeting-minutes-audio-input', value)
  else localStorage.removeItem('meeting-minutes-audio-input')
})

async function refreshAudioInputs() {
  if (!navigator.mediaDevices?.enumerateDevices) return
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    audioInputs.value = devices
      .filter(device => device.kind === 'audioinput')
      .map((device, index) => ({
        id: device.deviceId,
        label: device.label || `麦克风 ${index + 1}`,
      }))
    if (selectedDeviceId.value && !audioInputs.value.some(device => device.id === selectedDeviceId.value)) {
      selectedDeviceId.value = ''
    }
  } catch { /* 设备枚举失败时仍可使用系统默认麦克风 */ }
}

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

async function loadRecordings() {
  try {
    recordings.value = await authRequest('GET', `/meetings/${props.meetingId}/recordings`)
    if (recordings.value.length && status.value === 'idle') status.value = 'stopped'
  } catch { recordings.value = [] }
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
const localTranscription = computed(() => (auth.user?.preferences?.transcriptionProvider || 'funasr') === 'funasr')
watch(status, value => emit('status-change', { meetingId: props.meetingId, status: value }), { immediate: true })
const duration = computed(() => {
  const h = Math.floor(seconds.value / 3600)
  const m = Math.floor((seconds.value % 3600) / 60)
  const s = seconds.value % 60
  return [h, m, s].slice(h ? 0 : 1).map(v => String(v).padStart(2, '0')).join(':')
})

function releaseStream() {
  stopAnalyser()
  stream?.getTracks().forEach(track => track.stop())
  stream = null
  activeDeviceLabel.value = ''
}
function stopAnalyser() {
  if (animationFrame) cancelAnimationFrame(animationFrame)
  animationFrame = null
  analyserSource?.disconnect()
  analyserSource = null
  analyser = null
  if (audioContext && audioContext.state !== 'closed') audioContext.close().catch(() => {})
  audioContext = null
  waveformBars.value = Array(52).fill(4)
}
function startAnalyser(mediaStream) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext
  if (!AudioContextClass) return
  try {
    audioContext = new AudioContextClass()
    audioContext.resume().catch(() => {})
    analyser = audioContext.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = .72
    analyserSource = audioContext.createMediaStreamSource(mediaStream)
    analyserSource.connect(analyser)
    const frequencyData = new Uint8Array(analyser.frequencyBinCount)
    const render = () => {
      if (!analyser) return
      analyser.getByteFrequencyData(frequencyData)
      const usefulBins = Math.floor(frequencyData.length * .72)
      waveformBars.value = waveformBars.value.map((_, index) => {
        const start = Math.floor(index * usefulBins / waveformBars.value.length)
        const end = Math.max(start + 1, Math.floor((index + 1) * usefulBins / waveformBars.value.length))
        let peak = 0
        for (let bin = start; bin < end; bin += 1) peak = Math.max(peak, frequencyData[bin])
        return Math.max(4, Math.round((peak / 255) * 40))
      })
      animationFrame = requestAnimationFrame(render)
    }
    render()
  } catch {
    stopAnalyser()
  }
}
function stopClock() { clearInterval(timer); timer = null }
function startClock() {
  stopClock()
  timer = setInterval(() => { seconds.value += 1 }, 1000)
}
function mergeLiveTranscript(existingValue, incomingValue) {
  const existing = String(existingValue || '').trim()
  const incoming = String(incomingValue || '').trim()
  if (!incoming || incoming === existing) return existing
  if (!existing || incoming.includes(existing)) return incoming
  if (existing.includes(incoming)) return existing

  // 累计识别可能会校正前文：前缀大体一致时，保留信息更多的版本。
  let commonPrefix = 0
  const prefixLimit = Math.min(existing.length, incoming.length)
  while (commonPrefix < prefixLimit && existing[commonPrefix] === incoming[commonPrefix]) commonPrefix += 1
  if (commonPrefix >= Math.min(8, Math.floor(existing.length * .6))) {
    return incoming.length >= existing.length ? incoming : existing
  }

  // 分段识别只返回停顿后的新句时，寻找首尾重叠并仅追加新增文字。
  const overlapLimit = Math.min(existing.length, incoming.length, 120)
  for (let length = overlapLimit; length >= 2; length -= 1) {
    if (existing.slice(-length) === incoming.slice(0, length)) return existing + incoming.slice(length)
  }
  const separator = /[。！？；，、,.!?;:]$/.test(existing) || /^[。！？；，、,.!?;:]/.test(incoming) ? '' : '，'
  return `${existing}${separator}${incoming}`
}
function realtimeUrl() {
  const configured = auth.user?.preferences?.funasrEndpoint || 'http://127.0.0.1:10095/v1/audio/transcriptions'
  const url = new URL(configured)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = '/v1/audio/realtime'
  url.search = ''
  return url.toString()
}
async function startRealtimeTranscription() {
  if (!localTranscription.value || !audioContext?.audioWorklet || !analyserSource) return
  stopRealtimeTranscription(false)
  committedTranscript = ''
  liveTranscript.value = ''
  liveError.value = ''
  liveTranscribing.value = true
  const processorCode = `class PcmCapture extends AudioWorkletProcessor { process(inputs) { const input = inputs[0] && inputs[0][0]; if (input) { const copy = input.slice(); this.port.postMessage(copy.buffer, [copy.buffer]) } return true } } registerProcessor('pcm-capture', PcmCapture)`
  realtimeWorkletUrl = URL.createObjectURL(new Blob([processorCode], { type: 'text/javascript' }))
  await audioContext.audioWorklet.addModule(realtimeWorkletUrl)
  realtimeWorklet = new AudioWorkletNode(audioContext, 'pcm-capture')
  realtimeMute = audioContext.createGain()
  realtimeMute.gain.value = 0
  analyserSource.connect(realtimeWorklet)
  realtimeWorklet.connect(realtimeMute).connect(audioContext.destination)
  realtimeSocket = new WebSocket(realtimeUrl())
  realtimeSocket.binaryType = 'arraybuffer'
  realtimeSocket.onopen = () => {
    liveTranscribing.value = false
    realtimeSocket.send(JSON.stringify({ type: 'start', sampleRate: audioContext.sampleRate }))
  }
  realtimeSocket.onmessage = event => {
    const result = JSON.parse(event.data)
    if (result.type === 'partial') {
      liveTranscript.value = mergeLiveTranscript(committedTranscript, result.text)
      liveTranscribing.value = true
    } else if (result.type === 'final') {
      committedTranscript = mergeLiveTranscript(committedTranscript, result.text)
      liveTranscript.value = committedTranscript
      liveTranscribing.value = false
    } else if (result.type === 'error') liveError.value = result.message || '实时转写失败'
  }
  realtimeSocket.onerror = () => { liveError.value = '无法连接 FunASR 实时转写服务'; liveTranscribing.value = false }
  realtimeWorklet.port.onmessage = event => {
    if (realtimeSocket?.readyState !== WebSocket.OPEN || status.value !== 'recording') return
    const floats = new Float32Array(event.data)
    const pcm = new Int16Array(floats.length)
    for (let index = 0; index < floats.length; index += 1) pcm[index] = Math.max(-32768, Math.min(32767, Math.round(floats[index] * 32767)))
    realtimeSocket.send(pcm.buffer)
  }
}
function stopRealtimeTranscription(sendEnd = true) {
  if (sendEnd && realtimeSocket?.readyState === WebSocket.OPEN) realtimeSocket.send(JSON.stringify({ type: 'end' }))
  realtimeWorklet?.disconnect(); realtimeMute?.disconnect()
  realtimeWorklet = null; realtimeMute = null
  if (realtimeWorkletUrl) URL.revokeObjectURL(realtimeWorkletUrl)
  realtimeWorkletUrl = ''
  const socket = realtimeSocket
  realtimeSocket = null
  if (socket) setTimeout(() => { if (socket.readyState < WebSocket.CLOSING) socket.close() }, sendEnd ? 1200 : 0)
  liveTranscribing.value = false
}
function finishRealtimeTranscription() {
  if (!realtimeSocket || realtimeSocket.readyState > WebSocket.OPEN) {
    stopRealtimeTranscription(false)
    return Promise.resolve()
  }
  if (realtimeFinishPromise) return realtimeFinishPromise
  realtimeFinishPromise = new Promise(resolve => {
    const socket = realtimeSocket
    const finish = () => {
      clearTimeout(timeout)
      stopRealtimeTranscription(false)
      realtimeFinishPromise = null
      resolve()
    }
    const timeout = setTimeout(finish, 2500)
    socket.addEventListener('close', finish, { once: true })
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'end' }))
    else socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'end' })), { once: true })
  })
  return realtimeFinishPromise
}
async function prepareNewSegment() {
  if (audioUrl.value) URL.revokeObjectURL(audioUrl.value)
  audioUrl.value = ''
  audioBlob.value = null
  mimeType.value = ''
  seconds.value = 0
  status.value = 'idle'
  chunks = []
  serverRecordingId = ''
  liveTranscript.value = ''
  liveError.value = ''
  stopRealtimeTranscription(false)
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
    await prepareNewSegment()
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(selectedDeviceId.value ? { deviceId: { exact: selectedDeviceId.value } } : {}),
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })
    const audioTrack = stream.getAudioTracks()[0]
    activeDeviceLabel.value = audioTrack?.label || '当前麦克风'
    await refreshAudioInputs()
    startAnalyser(stream)
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
      await finishRealtimeTranscription()
      mimeType.value = recorder.mimeType || type || 'audio/webm'
      audioBlob.value = new Blob(chunks, { type: mimeType.value })
      audioUrl.value = URL.createObjectURL(audioBlob.value)
      status.value = 'stopped'
      resolveStop?.()
      resolveStop = null
      stopPromise = null
      releaseStream()
      persist(false)
      try {
        const completedRecordingId = serverRecordingId
        await saveQueue
        const realtimeText = liveTranscript.value.trim()
        await authRequest('POST', `/meetings/${props.meetingId}/recordings/${completedRecordingId}/finish`, { duration: seconds.value, transcript: realtimeText })
        await removeLocal().catch(() => {})
        serverRecordingId = ''
        await loadRecordings()
        notify.success('录音已保存到服务器')
        if (realtimeText) {
          notify.success('实时转写文本已保存')
        } else try {
          notify.info('正在自动将录音转为文字…')
          await authRequest('POST', `/meetings/${props.meetingId}/recordings/${completedRecordingId}/transcribe`, {})
          await loadRecordings()
          notify.success('录音转写已完成')
        } catch (error) { notify.warning(`录音已保存，但自动转写未完成：${error.message}`) }
      } catch (error) { notify.error(`服务器录音保存未完成：${error.message}`) }
    }
    recorder.onerror = () => {
      stopClock(); stopRealtimeTranscription(false); releaseStream(); status.value = 'idle'
      resolveStop?.()
      resolveStop = null
      stopPromise = null
      notify.error('录音过程中发生错误，请重新开始')
    }
    recorder.start(1000)
    status.value = 'recording'
    startClock()
    startRealtimeTranscription().catch(error => { liveError.value = error.message; liveTranscribing.value = false })
  } catch (error) {
    releaseStream()
    if (['NotAllowedError', 'SecurityError'].includes(error?.name)) notify.error('无法使用麦克风，请允许浏览器访问麦克风')
    else if (error?.name === 'NotFoundError') notify.error('没有检测到可用的麦克风')
    else if (error?.name === 'OverconstrainedError') { selectedDeviceId.value = ''; notify.error('所选麦克风当前不可用，请重新选择') }
    else notify.error(`录音启动失败：${error?.message || '未知错误'}`)
  }
}
function togglePause() {
  if (!recorder) return
  if (recording.value) {
    recorder.pause(); status.value = 'paused'; stopClock()
    if (realtimeSocket?.readyState === WebSocket.OPEN) realtimeSocket.send(JSON.stringify({ type: 'flush' }))
    audioContext?.suspend().catch(() => {})
    waveformBars.value = Array(52).fill(4)
  } else if (paused.value) {
    recorder.resume(); status.value = 'recording'; startClock()
    audioContext?.resume().catch(() => {})
  }
}
function stop() {
  if (!recorder || recorder.state === 'inactive') return Promise.resolve()
  if (stopPromise) return stopPromise
  stopPromise = new Promise(resolve => { resolveStop = resolve })
  stopClock()
  recorder.stop()
  return stopPromise
}
defineExpose({ stop })
onBeforeUnmount(() => {
  stopClock()
  stopRealtimeTranscription(false)
  if (recorder?.state !== 'inactive') recorder?.stop()
  releaseStream()
  if (audioUrl.value) URL.revokeObjectURL(audioUrl.value)
  navigator.mediaDevices?.removeEventListener?.('devicechange', refreshAudioInputs)
})

onMounted(async () => {
  await refreshAudioInputs()
  navigator.mediaDevices?.addEventListener?.('devicechange', refreshAudioInputs)
  await restoreLocal()
  await loadRecordings()
})
</script>

<template>
  <section class="audio-recorder" :class="{ active: recording || paused }" aria-label="会议录音">
    <div class="recorder-main">
      <div class="recorder-state">
        <div class="status-label"><span class="record-dot" :class="{ pulse: recording }"></span>{{ recording ? '录音中' : paused ? '已暂停' : recordings.length ? '可继续录制' : '准备录音' }}</div>
        <strong class="record-time" aria-live="polite">{{ duration }}</strong>
      </div>
      <div class="wave-area" :class="{ moving: recording }" aria-hidden="true">
        <i v-for="(height, index) in waveformBars" :key="index" :style="{ height: `${height}px` }"></i>
      </div>
      <div class="recorder-actions">
        <button v-if="status === 'idle' || status === 'stopped'" class="btn btn-primary record-start" :disabled="meetingEnded" :title="meetingEnded ? '请先重新开启会议' : ''" @click="start"><span class="button-dot"></span>{{ meetingEnded ? '会议已结束' : recordings.length ? '继续录制' : '开始录音' }}</button>
        <button v-if="recording || paused" class="btn btn-ghost" @click="togglePause"><span class="pause-icon">{{ paused ? '▶' : 'Ⅱ' }}</span>{{ paused ? '继续' : '暂停' }}</button>
        <button v-if="recording || paused" class="btn stop-button" @click="stop"><span class="stop-icon"></span>结束录音</button>
      </div>
    </div>
    <div class="save-row">
      <label class="input-source">
        <SvgIcon name="microphone" :size="13" />
        <span>输入源</span>
        <AppSelect v-model="selectedDeviceId" :options="audioInputOptions" :clearable="false" :disabled="recording || paused" placeholder="选择录音输入源" />
      </label>
      <span v-if="recording || paused" class="active-source" :title="activeDeviceLabel">当前：{{ activeDeviceLabel }}</span>
      <span class="save-status"><b>✓</b>{{ recording ? '正在实时保存到服务器' : recordings.length ? `已保存 ${recordings.length} 段录音` : '录音将实时保存到服务器' }}</span>
    </div>
    <section v-if="recording || paused || liveTranscript" class="live-transcript" aria-live="polite">
      <div class="live-transcript-heading">
        <span><i :class="{ active: recording }"></i>实时转写</span>
        <small v-if="!localTranscription">请在用户设置中切换到 FunASR</small>
        <small v-else>{{ liveTranscribing ? '正在识别…' : paused ? '已暂停' : '持续更新' }}</small>
      </div>
      <p v-if="liveTranscript">{{ liveTranscript }}</p>
      <p v-else-if="!localTranscription" class="live-placeholder">云端引擎不会进行滚动转写，避免产生重复费用。</p>
      <p v-else-if="liveError" class="live-error">{{ liveError }}</p>
      <p v-else class="live-placeholder">开始说话后，文字会在这里持续出现…</p>
    </section>
  </section>
  <RecordingTimeline :recordings="recordings" :meeting-id="meetingId" :meeting-title="meetingTitle" @changed="loadRecordings" />
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
.wave-area i { width: 3px; max-height: 40px; flex: 0 0 3px; border-radius: 4px; background: linear-gradient(#7449f4,#2466f1); transition: height 70ms linear; }
.wave-area.moving { opacity: 1; }
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
.input-source { display: inline-flex; align-items: center; gap: 5px; color: var(--text-secondary); white-space: nowrap; }
.input-source :deep(.select-trigger) { width: 190px; height: 30px; }
.active-source { max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-secondary); }
.save-status { display: inline-flex; align-items: center; gap: 5px; color: var(--text-secondary); }
.save-status b { width: 16px; height: 16px; display: inline-grid; place-items: center; border: 1px solid #54b888; border-radius: 50%; color: #2aa46c; font-size: .65rem; }
.live-transcript { margin-top: 12px; padding: 12px 14px; border: 1px solid #e1e9f8; border-radius: 9px; background: #f8faff; }
.live-transcript-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 7px; color: #294b91; font-size: .76rem; font-weight: 650; }
.live-transcript-heading span { display: inline-flex; align-items: center; gap: 7px; }.live-transcript-heading i { width: 7px; height: 7px; border-radius: 50%; background: #aeb9ca; }.live-transcript-heading i.active { background: #ef4444; animation: pulse 1.4s ease-out infinite; }.live-transcript-heading small { color: var(--text-muted); font-size: .67rem; font-weight: 400; }
.live-transcript p { color: var(--text); font-size: .84rem; line-height: 1.7; white-space: pre-wrap; }.live-transcript .live-placeholder { color: var(--text-muted); }.live-transcript .live-error { color: var(--danger); }
@keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(239,68,68,.45); } 70%,100% { box-shadow: 0 0 0 7px rgba(239,68,68,0); } }
@media (max-width: 980px) { .wave-area { display: none; } }
@media (max-width: 760px) { .audio-recorder { padding: 16px; } .recorder-main { flex-wrap: wrap; gap: 14px; } .recorder-actions { margin-left: auto; } .save-row { flex-wrap: wrap; gap: 8px 16px; } }
</style>
