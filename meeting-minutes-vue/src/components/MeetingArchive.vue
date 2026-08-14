<script setup>
import { computed, ref } from 'vue'
import { useStore } from '../composables/useStore'
import { useNotify } from '../composables/useNotify'

const emit = defineEmits(['open-meeting'])
const store = useStore()
const notify = useNotify()
const query = ref('')

const filtered = computed(() => {
  const keyword = query.value.trim().toLocaleLowerCase()
  return store.meetings.value.filter((item) => {
    if (!keyword) return true
    return [item.title, item.date, item.location].some((value) => String(value || '').toLocaleLowerCase().includes(keyword))
  })
})

async function openMeeting(id) {
  if (id === store.activeMeetingId.value) return emit('open-meeting')
  try {
    await store.selectMeeting(id)
    emit('open-meeting')
    notify.success('已切换会议纪要')
  } catch (e) { notify.error(e.message) }
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
    <div v-if="filtered.length" class="meeting-grid">
      <article v-for="item in filtered" :key="item.id" class="meeting-card" :class="{ active: item.id === store.activeMeetingId.value }">
        <button class="card-main" @click="openMeeting(item.id)">
          <div class="card-top"><span class="meeting-date">{{ item.date || '未设置日期' }}</span><span v-if="item.id === store.activeMeetingId.value" class="current-badge">当前</span></div>
          <h3>{{ item.title || '未命名会议' }}</h3>
          <p v-if="item.location" class="location"><SvgIcon name="map-pin" :size="13" /> {{ item.location }}</p>
          <div class="card-stats"><span>{{ item.entryCount }} 条记录</span><span>{{ item.personCount }} 人</span><span>{{ item.todoCount }} 项待办</span></div>
        </button>
        <button class="delete-meeting" title="删除会议" @click="removeMeeting(item)"><SvgIcon name="trash" :size="15" /></button>
      </article>
    </div>
    <div v-else class="archive-empty"><SvgIcon name="search" :size="42" /><p>没有找到匹配的会议纪要</p></div>
  </div>
</template>

<style scoped>
.archive-page { flex: 1; overflow-y: auto; padding: 28px; background: var(--bg-secondary); }.archive-header { max-width: 980px; margin: 0 auto 22px; display: flex; justify-content: space-between; align-items: flex-end; gap: 20px; }.archive-header h2 { font-size: 1.25rem; }.archive-header p { margin-top: 5px; color: var(--text-muted); font-size: .82rem; }
.search-box { width: 300px; display: flex; align-items: center; gap: 8px; padding: 9px 12px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--text-muted); }.search-box input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--text); }
.meeting-grid { max-width: 980px; margin: 0 auto; display: grid; grid-template-columns: repeat(auto-fill,minmax(280px,1fr)); gap: 16px; }.meeting-card { position: relative; background: var(--surface); border: 1px solid var(--border-light); border-radius: var(--radius); box-shadow: var(--shadow-sm); transition: var(--transition); overflow: hidden; }.meeting-card:hover { transform: translateY(-2px); box-shadow: var(--shadow-md); }.meeting-card.active { border-color: var(--primary); box-shadow: 0 0 0 2px var(--primary-light); }
.card-main { width: 100%; text-align: left; padding: 18px; }.card-top { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }.meeting-date { color: var(--text-muted); font-size: .76rem; }.current-badge { color: var(--primary); background: var(--primary-light); font-size: .7rem; padding: 2px 7px; border-radius: var(--radius-full); }.card-main h3 { font-size: 1rem; padding-right: 25px; }.location { display: flex; align-items: center; gap: 4px; margin-top: 8px; color: var(--text-secondary); font-size: .8rem; }.card-stats { display: flex; gap: 12px; margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--border-light); color: var(--text-muted); font-size: .75rem; }.delete-meeting { position: absolute; top: 13px; right: 12px; padding: 5px; color: var(--text-muted); border-radius: 5px; }.delete-meeting:hover { color: var(--danger); background: #fee2e2; }
.archive-empty { max-width: 980px; margin: 80px auto; text-align: center; color: var(--text-muted); }.archive-empty p { margin-top: 12px; }
</style>
