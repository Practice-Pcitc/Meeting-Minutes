<script setup>
import { reactive, ref } from 'vue'
import DateTimePicker from './DateTimePicker.vue'

const props = defineProps({ hasPersons: Boolean, onCreate: { type: Function, required: true } })
const emit = defineEmits(['close'])
const submitting = ref(false)
const now = new Date()
const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
const form = reactive({
  title: '',
  date: new Date().toLocaleDateString('en-CA'),
  startTime: currentTime,
  endTime: '',
  location: '',
  copyPersons: false,
})

async function submit() {
  if (!form.title.trim() || submitting.value) return
  submitting.value = true
  const created = await props.onCreate({ ...form, title: form.title.trim(), location: form.location.trim() })
  if (!created) submitting.value = false
}
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <form class="modal" @submit.prevent="submit">
      <div class="modal-header"><h3><SvgIcon name="file-text" :size="18" /> 新建会议纪要</h3><button type="button" class="btn-icon" aria-label="关闭" @click="emit('close')">✕</button></div>
      <div class="modal-body">
        <div class="form-row"><label>会议标题</label><input v-model="form.title" class="input" placeholder="例如：产品周会" maxlength="80" autofocus /></div>
        <div class="form-row"><label>日期</label><DateTimePicker v-model="form.date" /></div>
        <div class="form-row-inline">
          <div class="form-row"><label>开始时间</label><DateTimePicker v-model="form.startTime" mode="time" /></div>
          <div class="form-row"><label>结束时间</label><DateTimePicker v-model="form.endTime" mode="time" /></div>
        </div>
        <div class="form-row"><label>地点（可选）</label><input v-model="form.location" class="input" placeholder="会议室或线上会议" maxlength="80" /></div>
        <label v-if="hasPersons" class="copy-option"><input v-model="form.copyPersons" type="checkbox" /><span><strong>沿用当前参会人员</strong><small>复制人员姓名、角色和颜色，不复制会议记录</small></span></label>
      </div>
      <div class="modal-footer"><button type="button" class="btn btn-ghost" @click="emit('close')">取消</button><button type="submit" class="btn btn-primary" :disabled="!form.title.trim() || submitting">{{ submitting ? '创建中…' : '创建并进入' }}</button></div>
    </form>
  </div>
</template>

<style scoped>
.modal-overlay { position: fixed; inset: 0; z-index: 600; display: flex; align-items: center; justify-content: center; padding: 20px; background: rgba(15,23,42,.5); }.modal { width: 500px; max-width: 100%; overflow: hidden; border-radius: var(--radius-lg); background: var(--surface); box-shadow: var(--shadow-lg); }.modal-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid var(--border); }.modal-header h3 { display: flex; align-items: center; gap: 7px; font-size: 1rem; }.modal-body { display: flex; flex-direction: column; gap: 16px; padding: 20px; }.form-row { display: flex; flex: 1; flex-direction: column; gap: 6px; }.form-row label { color: var(--text-secondary); font-size: .82rem; font-weight: 600; }.form-row-inline { display: flex; gap: 14px; }.copy-option { display: flex; align-items: flex-start; gap: 9px; padding: 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); cursor: pointer; }.copy-option input { margin-top: 3px; }.copy-option span { display: flex; flex-direction: column; gap: 2px; }.copy-option strong { font-size: .82rem; }.copy-option small { color: var(--text-muted); font-size: .73rem; }.modal-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 14px 20px; border-top: 1px solid var(--border); }
</style>
