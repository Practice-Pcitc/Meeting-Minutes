<script setup>
import { computed, ref } from 'vue'
import { useStore } from '../composables/useStore'
import { useNotify } from '../composables/useNotify'

const store = useStore()
const notify = useNotify()
const rows = 9
const cols = 13
const selected = ref(null)
const saving = ref(false)

const seatMap = computed(() => {
  const map = new Map()
  store.seats.value.forEach((seat) => map.set(`${seat.row}-${seat.col}`, seat))
  return map
})

const assignedIds = computed(() => new Set(store.seats.value.map((seat) => seat.personId)))
const assignedCount = computed(() => assignedIds.value.size)

function seatAt(row, col) { return seatMap.value.get(`${row}-${col}`) }
function personAt(row, col) {
  const seat = seatAt(row, col)
  return seat ? store.getPerson(seat.personId) : null
}
function personColor(name) {
  let hash = 2166136261
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  const hue = Math.abs(hash) % 360
  return `hsl(${hue} 62% 48%)`
}
function selectSeat(row, col) { selected.value = { row, col } }

async function assign(personId) {
  if (!selected.value || saving.value) return
  saving.value = true
  try {
    await store.updateSeat(selected.value.row, selected.value.col, personId)
    selected.value = null
    notify.success(personId ? '座位已分配' : '座位已清空')
  } catch (e) { notify.error(e.message) }
  finally { saving.value = false }
}

async function clearAll() {
  if (!store.seats.value.length) return
  const confirmed = await notify.confirm({ title: '清空座位图', message: '确定清空当前会议的全部座位安排吗？', confirmText: '清空', danger: true })
  if (!confirmed) return
  try { await store.clearSeats(); notify.success('座位图已清空') }
  catch (e) { notify.error(e.message) }
}
</script>

<template>
  <div class="seating-page">
    <div class="seating-header">
      <div><h2>会议座位图</h2><p>点击棋盘交叉点，为参会人员安排座位</p></div>
      <div class="seating-stats"><span>{{ assignedCount }}/{{ store.persons.value.length }} 人已安排</span><button class="btn btn-ghost btn-sm" :disabled="!store.seats.value.length" @click="clearAll">清空座位</button></div>
    </div>

    <div v-if="store.persons.value.length" class="seating-layout">
      <div class="board-wrap">
        <div class="room-front"><span>主讲区 / 屏幕</span></div>
        <div class="seat-grid" :style="{ '--rows': rows, '--cols': cols }">
          <button
            v-for="index in rows * cols" :key="index"
            class="seat-cell" :class="{ occupied: personAt(Math.floor((index - 1) / cols), (index - 1) % cols) }"
            :style="personAt(Math.floor((index - 1) / cols), (index - 1) % cols) ? { background: personColor(personAt(Math.floor((index - 1) / cols), (index - 1) % cols).name) } : null"
            :aria-label="personAt(Math.floor((index - 1) / cols), (index - 1) % cols)?.name || `空座位 ${Math.floor((index - 1) / cols) + 1}-${(index - 1) % cols + 1}`"
            @click="selectSeat(Math.floor((index - 1) / cols), (index - 1) % cols)"
          >
            <template v-if="personAt(Math.floor((index - 1) / cols), (index - 1) % cols)">
              <span class="cell-avatar">{{ personAt(Math.floor((index - 1) / cols), (index - 1) % cols).name.charAt(0) }}</span>
              <span class="cell-name">{{ personAt(Math.floor((index - 1) / cols), (index - 1) % cols).name }}</span>
            </template>
            <span v-else class="empty-label">空</span>
          </button>
        </div>
      </div>
      <aside class="seat-legend"><h3>参会人员</h3><div v-for="p in store.persons.value" :key="p.id" class="legend-person"><span class="legend-avatar" :style="{ background: personColor(p.name) }">{{ p.name.charAt(0) }}</span><div><strong>{{ p.name }}</strong><small>{{ assignedIds.has(p.id) ? '已安排' : '未安排' }}{{ p.role ? ` · ${p.role}` : '' }}</small></div></div></aside>
    </div>
    <div v-else class="seating-empty"><SvgIcon name="users" :size="48" /><h3>还没有参会人员</h3><p>请先在“管理人员”中添加参会人员，再进行座位安排。</p></div>

    <div v-if="selected" class="picker-overlay" @click.self="selected = null">
      <div class="seat-picker" role="dialog" aria-modal="true" aria-label="选择座位人员">
        <div class="picker-header"><div><h3>选择参会人员</h3><p>第 {{ selected.row + 1 }} 行 · 第 {{ selected.col + 1 }} 列</p></div><button class="btn-icon" aria-label="关闭" @click="selected = null"><SvgIcon name="close" :size="18" /></button></div>
        <div class="picker-list">
          <button v-for="p in store.persons.value" :key="p.id" class="picker-person" :class="{ current: personAt(selected.row, selected.col)?.id === p.id }" @click="assign(p.id)"><span class="picker-avatar" :style="{ background: personColor(p.name) }">{{ p.name.charAt(0) }}</span><span><strong>{{ p.name }}</strong><small>{{ p.role || '参会人员' }}{{ assignedIds.has(p.id) && personAt(selected.row, selected.col)?.id !== p.id ? ' · 将从原座位移动' : '' }}</small></span></button>
        </div>
        <button v-if="personAt(selected.row, selected.col)" class="btn btn-danger clear-seat" @click="assign(null)">清空这个座位</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.seating-page { flex: 1; overflow: auto; padding: 24px; background: var(--bg-secondary); }.seating-header { max-width: 1120px; margin: 0 auto 18px; display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; }.seating-header h2 { font-size: 1.2rem; }.seating-header p { color: var(--text-muted); font-size: .82rem; margin-top: 3px; }.seating-stats { display: flex; align-items: center; gap: 12px; color: var(--text-secondary); font-size: .8rem; }
.seating-layout { max-width: 1120px; margin: auto; display: grid; grid-template-columns: minmax(600px,1fr) 230px; gap: 18px; align-items: start; }.board-wrap,.seat-legend { background: var(--surface); border: 1px solid var(--border-light); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); }.board-wrap { padding: 22px; }.room-front { display: flex; justify-content: center; margin-bottom: 18px; }.room-front span { min-width: 260px; text-align: center; padding: 7px 20px; color: var(--text-secondary); background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 4px; font-size: .78rem; }
.seat-grid { width: min(100%,820px); margin: auto; display: grid; grid-template-columns: repeat(var(--cols),minmax(44px,1fr)); gap: 7px; padding: 12px; background: #e5e7eb; border: 1px solid #d1d5db; border-radius: 10px; overflow-x: auto; }.seat-cell { aspect-ratio: 1; min-width: 44px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; padding: 3px; color: #6b7280; background: #f3f4f6; border: 1px solid #d1d5db; border-radius: 7px; transition: transform .15s ease,box-shadow .15s ease,background .15s ease; }.seat-cell:hover { transform: translateY(-2px); color: var(--primary); background: #e5e7eb; box-shadow: 0 4px 9px rgba(15,23,42,.12); }.seat-cell.occupied { color: #fff; border-color: rgba(0,0,0,.08); box-shadow: inset 0 -3px 7px rgba(0,0,0,.16); }.seat-cell.occupied:hover { color: #fff; filter: brightness(1.06); }.empty-label { font-size: .68rem; opacity: .72; }.cell-avatar { width: 22px; height: 22px; display: grid; place-items: center; border-radius: 50%; background: rgba(255,255,255,.2); font-size: .74rem; font-weight: 800; }.cell-name { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .65rem; font-weight: 600; }
.seat-legend { padding: 16px; }.seat-legend h3 { font-size: .9rem; margin-bottom: 12px; }.legend-person { display: flex; gap: 9px; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--border-light); }.legend-person:last-child { border: 0; }.legend-avatar,.picker-avatar { width: 30px; height: 30px; display: grid; place-items: center; flex-shrink: 0; color: #fff; border-radius: 50%; font-weight: 600; }.legend-person div,.picker-person>span:last-child { min-width: 0; display: flex; flex-direction: column; }.legend-person strong,.picker-person strong { font-size: .82rem; }.legend-person small,.picker-person small { color: var(--text-muted); font-size: .7rem; }
.seating-empty { margin: 90px auto; text-align: center; color: var(--text-muted); }.seating-empty h3 { margin: 12px 0 4px; color: var(--text-secondary); }.picker-overlay { position: fixed; inset: 0; z-index: 500; display: grid; place-items: center; padding: 20px; background: rgba(15,23,42,.52); }.seat-picker { width: min(420px,100%); max-height: 80vh; display: flex; flex-direction: column; background: var(--surface); border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); overflow: hidden; }.picker-header { display: flex; justify-content: space-between; padding: 17px 18px; border-bottom: 1px solid var(--border); }.picker-header h3 { font-size: 1rem; }.picker-header p { color: var(--text-muted); font-size: .75rem; }.picker-list { overflow-y: auto; padding: 8px; }.picker-person { width: 100%; display: flex; align-items: center; gap: 10px; padding: 10px; text-align: left; border-radius: var(--radius-sm); }.picker-person:hover,.picker-person.current { background: var(--primary-light); }.clear-seat { margin: 8px 18px 18px; justify-content: center; }
@media (max-width: 900px) { .seating-layout { grid-template-columns: 1fr; }.seat-legend { display: grid; grid-template-columns: repeat(auto-fill,minmax(160px,1fr)); gap: 0 16px; }.seat-legend h3 { grid-column: 1/-1; } }
</style>
