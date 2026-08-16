<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

defineOptions({ name: 'DateTimePicker' })

const props = defineProps({
  modelValue: { type: String, default: '' },
  mode: { type: String, default: 'date', validator: (value) => ['date', 'time', 'datetime'].includes(value) },
  placeholder: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue'])
const trigger = ref(null)
const popover = ref(null)
const open = ref(false)
const yearPanel = ref(false)
const position = ref({ top: '0px', left: '0px' })

function parseDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : new Date()
}
const initialDate = parseDate(props.modelValue)
const cursorYear = ref(initialDate.getFullYear())
const cursorMonth = ref(initialDate.getMonth())
const yearPageStart = ref(Math.floor(cursorYear.value / 12) * 12)

const selectedHour = computed(() => /^\d{2}:\d{2}$/.test(props.modelValue) ? Number(props.modelValue.slice(0, 2)) : null)
const selectedMinute = computed(() => /^\d{2}:\d{2}$/.test(props.modelValue) ? Number(props.modelValue.slice(3, 5)) : null)
const hours = Array.from({ length: 24 }, (_, index) => index)
const minutes = Array.from({ length: 60 }, (_, index) => index)
const weekDays = ['一', '二', '三', '四', '五', '六', '日']
const datePart = computed(() => props.modelValue.split('T')[0] || '')
const timePart = computed(() => props.modelValue.split('T')[1] || '')

const displayValue = computed(() => {
  if (!props.modelValue) return props.placeholder || (props.mode === 'date' ? '选择日期' : '选择时间')
  if (props.mode === 'time') return props.modelValue
  const date = parseDate(props.modelValue)
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
})

const calendarDays = computed(() => {
  const first = new Date(cursorYear.value, cursorMonth.value, 1)
  const startOffset = (first.getDay() + 6) % 7
  const start = new Date(cursorYear.value, cursorMonth.value, 1 - startOffset)
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index)
    return { date, current: date.getMonth() === cursorMonth.value, value: formatDate(date) }
  })
})
const visibleYears = computed(() => Array.from({ length: 12 }, (_, index) => yearPageStart.value + index))

function formatDate(date) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
function isToday(value) { return value === formatDate(new Date()) }

async function toggle() {
  if (open.value) return close()
  open.value = true
  yearPanel.value = false
  const date = parseDate(props.modelValue)
  cursorYear.value = date.getFullYear()
  cursorMonth.value = date.getMonth()
  yearPageStart.value = Math.floor(cursorYear.value / 12) * 12
  await nextTick()
  updatePosition()
  await nextTick()
  updatePosition()
  window.addEventListener('resize', updatePosition)
  window.addEventListener('scroll', updatePosition, true)
}
function close() {
  open.value = false
  window.removeEventListener('resize', updatePosition)
  window.removeEventListener('scroll', updatePosition, true)
}
function updatePosition() {
  const rect = trigger.value?.getBoundingClientRect()
  if (!rect) return
  const width = props.mode === 'date' ? 320 : 280
  const height = popover.value?.offsetHeight || (props.mode === 'date' ? 366 : 341)
  const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))
  const top = window.innerHeight - rect.bottom >= height + 8 || rect.top < height + 8 ? rect.bottom + 8 : rect.top - height - 8
  position.value = { left: `${left}px`, top: `${Math.max(12, top)}px` }
}
function changeMonth(delta) {
  const date = new Date(cursorYear.value, cursorMonth.value + delta, 1)
  cursorYear.value = date.getFullYear()
  cursorMonth.value = date.getMonth()
}
function chooseYear(year) {
  cursorYear.value = year
  yearPanel.value = false
}
function chooseDate(value) { emit('update:modelValue', value); close() }
function setTime(part, value) {
  const now = new Date()
  const hour = part === 'hour' ? value : (selectedHour.value ?? now.getHours())
  const minute = part === 'minute' ? value : (selectedMinute.value ?? 0)
  emit('update:modelValue', `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`)
}
function chooseNow() {
  if (props.mode === 'date') emit('update:modelValue', formatDate(new Date()))
  else {
    const now = new Date()
    emit('update:modelValue', `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`)
  }
  close()
}
function clear() { emit('update:modelValue', ''); close() }
function updateDatePart(value) {
  const time = timePart.value || '00:00'
  emit('update:modelValue', value ? `${value}T${time}` : '')
}
function updateTimePart(value) {
  const date = datePart.value || formatDate(new Date())
  emit('update:modelValue', value ? `${date}T${value}` : '')
}
onBeforeUnmount(close)
watch(yearPanel, async () => { if (open.value) { await nextTick(); updatePosition() } })
</script>

<template>
  <div v-if="mode === 'datetime'" class="datetime-picker">
    <DateTimePicker :model-value="datePart" mode="date" @update:model-value="updateDatePart" />
    <DateTimePicker :model-value="timePart" mode="time" @update:model-value="updateTimePart" />
  </div>
  <template v-else>
    <button ref="trigger" type="button" class="picker-trigger" :class="{ active: open, empty: !modelValue }" @click="toggle">
      <SvgIcon :name="mode === 'date' ? 'calendar' : 'clock'" :size="15" />
      <span>{{ displayValue }}</span><span class="picker-chevron" aria-hidden="true"></span>
    </button>
    <Teleport to="body">
    <div v-if="open" class="picker-dismiss" @click="close"></div>
    <div v-if="open" ref="popover" class="picker-popover" :class="`picker-${mode}`" :style="position">
      <template v-if="mode === 'date'">
        <div class="calendar-header">
          <button type="button" aria-label="上个月" @click="changeMonth(-1)">‹</button>
          <button type="button" class="month-title" @click="yearPanel = !yearPanel">{{ cursorYear }}年 {{ cursorMonth + 1 }}月</button>
          <button type="button" aria-label="下个月" @click="changeMonth(1)">›</button>
        </div>
        <div v-if="yearPanel" class="year-panel">
          <div class="year-nav"><button type="button" @click="yearPageStart -= 12">‹</button><span>{{ yearPageStart }}—{{ yearPageStart + 11 }}</span><button type="button" @click="yearPageStart += 12">›</button></div>
          <div class="year-grid"><button v-for="year in visibleYears" :key="year" type="button" :class="{ selected: year === cursorYear }" @click="chooseYear(year)">{{ year }}</button></div>
        </div>
        <template v-else>
          <div class="week-row"><span v-for="day in weekDays" :key="day">{{ day }}</span></div>
          <div class="day-grid"><button v-for="day in calendarDays" :key="day.value" type="button" :class="{ muted: !day.current, today: isToday(day.value), selected: day.value === modelValue }" @click="chooseDate(day.value)">{{ day.date.getDate() }}</button></div>
        </template>
      </template>
      <template v-else>
        <div class="time-title">选择时间</div>
        <div class="time-columns">
          <div><span>小时</span><div class="time-list"><button v-for="hour in hours" :key="hour" type="button" :class="{ selected: hour === selectedHour }" @click="setTime('hour', hour)">{{ String(hour).padStart(2, '0') }}</button></div></div>
          <div><span>分钟</span><div class="time-list"><button v-for="minute in minutes" :key="minute" type="button" :class="{ selected: minute === selectedMinute }" @click="setTime('minute', minute)">{{ String(minute).padStart(2, '0') }}</button></div></div>
        </div>
      </template>
      <div class="picker-footer"><button type="button" @click="clear">清除</button><button type="button" class="now-button" @click="chooseNow">{{ mode === 'date' ? '今天' : '现在' }}</button></div>
    </div>
    </Teleport>
  </template>
</template>

<style scoped>
.datetime-picker { width: 100%; display: grid; grid-template-columns: minmax(170px,1.35fr) minmax(110px,.8fr); gap: 8px; }.picker-trigger { width: 100%; height: 38px; display: flex; align-items: center; gap: 8px; padding: 0 13px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); text-align: left; transition: var(--transition); }.picker-trigger:hover { border-color: #c7cbd3; }.picker-trigger.active { border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-light); }.picker-trigger.empty { color: var(--text-muted); }.picker-trigger span:nth-child(2) { flex: 1; }.picker-chevron { width: 7px; height: 7px; flex: 0 0 7px; align-self: center; border-right: 1.5px solid var(--text-muted); border-bottom: 1.5px solid var(--text-muted); transform: translateY(-2px) rotate(45deg); }.picker-dismiss { position: fixed; inset: 0; z-index: 750; }.picker-popover { position: fixed; z-index: 760; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); box-shadow: 0 16px 40px rgba(31,35,41,.16); overflow: hidden; }.picker-date { width: 320px; }.picker-time { width: 280px; }.calendar-header,.year-nav { height: 48px; display: flex; align-items: center; justify-content: space-between; padding: 0 12px; border-bottom: 1px solid var(--border-light); }.calendar-header button:not(.month-title),.year-nav button { width: 30px; height: 30px; border-radius: 7px; color: var(--text-secondary); font-size: 22px; }.calendar-header button:hover,.year-nav button:hover { background: var(--bg-secondary); color: var(--primary); }.month-title { padding: 5px 10px; border-radius: 7px; font-weight: 650; }.month-title:hover { background: var(--primary-light); color: var(--primary); }.week-row,.day-grid { display: grid; grid-template-columns: repeat(7,1fr); padding: 0 12px; }.week-row { padding-top: 10px; }.week-row span { text-align: center; color: var(--text-muted); font-size: .72rem; }.day-grid { gap: 3px; padding-top: 5px; padding-bottom: 10px; }.day-grid button { height: 34px; border-radius: 8px; font-size: .8rem; }.day-grid button:hover,.year-grid button:hover { background: var(--primary-light); color: var(--primary); }.day-grid button.muted { color: var(--text-disabled); }.day-grid button.today { box-shadow: inset 0 0 0 1px var(--primary); color: var(--primary); }.day-grid button.selected,.year-grid button.selected { background: var(--primary); color: #fff; box-shadow: none; }.year-panel { min-height: 276px; }.year-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 7px; padding: 16px; }.year-grid button { height: 44px; border-radius: 8px; }.time-title { height: 48px; display: flex; align-items: center; padding: 0 16px; border-bottom: 1px solid var(--border-light); font-weight: 650; }.time-columns { height: 245px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 10px 12px; }.time-columns>div { min-height: 0; display: flex; flex-direction: column; }.time-columns>div>span { padding: 0 0 6px; color: var(--text-muted); text-align: center; font-size: .72rem; }.time-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; padding: 0 5px; }.time-list button { flex-shrink: 0; height: 32px; border-radius: 7px; }.time-list button:hover { background: var(--bg-secondary); }.time-list button.selected { background: var(--primary-light); color: var(--primary); font-weight: 700; }.picker-footer { height: 48px; display: flex; align-items: center; justify-content: space-between; padding: 0 14px; border-top: 1px solid var(--border-light); }.picker-footer button { padding: 5px 8px; border-radius: 6px; color: var(--text-muted); font-size: .78rem; }.picker-footer button:hover { background: var(--bg-secondary); color: var(--text); }.picker-footer .now-button { color: var(--primary); font-weight: 650; }
</style>
