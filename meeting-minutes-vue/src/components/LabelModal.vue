<script setup>
import { ref } from 'vue'
import { useStore } from '../composables/useStore'
import { useNotify } from '../composables/useNotify'

const emit = defineEmits(['close'])
const store = useStore()
const notify = useNotify()
const name = ref('')
const submitting = ref(false)

async function addLabel() {
  const labelName = name.value.trim()
  if (!labelName || submitting.value) return
  submitting.value = true
  try {
    await store.addLabel({ name: labelName })
    name.value = ''
    notify.success(`已添加标签「${labelName}」`)
  } catch (e) {
    notify.error(e.message)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal">
      <div class="modal-header">
        <h3><SvgIcon name="tag" :size="18" /> 添加标签</h3>
        <button class="btn-icon" aria-label="关闭" @click="emit('close')">✕</button>
      </div>
      <div class="modal-body">
        <label for="label-name">标签名称</label>
        <input id="label-name" v-model="name" class="input" placeholder="输入标签名称" maxlength="20" autofocus @keydown.enter="addLabel" />
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" @click="emit('close')">取消</button>
        <button class="btn btn-primary" :disabled="!name.trim() || submitting" @click="addLabel">
          {{ submitting ? '添加中…' : '添加标签' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay { position: fixed; inset: 0; z-index: 100; display: flex; align-items: center; justify-content: center; background: rgba(15,23,42,.5); }
.modal { width: 420px; max-width: 90vw; overflow: hidden; border-radius: var(--radius-lg); background: var(--surface); box-shadow: var(--shadow-lg); }
.modal-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid var(--border); }
.modal-header h3 { display: flex; align-items: center; gap: 7px; font-size: 1rem; }
.modal-body { display: flex; flex-direction: column; gap: 7px; padding: 20px; }
.modal-body label { color: var(--text-secondary); font-size: .82rem; font-weight: 600; }
.modal-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 14px 20px; border-top: 1px solid var(--border); }
</style>
