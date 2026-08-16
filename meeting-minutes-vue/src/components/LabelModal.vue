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

async function removeLabel(label) {
  const confirmed = await notify.confirm({ title: '删除标签', message: `确定删除标签「${label.name}」吗？`, confirmText: '删除', danger: true })
  if (!confirmed) return
  try {
    await store.removeLabel(label.id)
    notify.success(`已删除标签「${label.name}」`)
  } catch (e) { notify.error(e.message) }
}
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal">
      <div class="modal-header">
        <h3><SvgIcon name="tag" :size="18" /> 标签管理</h3>
        <button class="btn-icon" aria-label="关闭" @click="emit('close')">✕</button>
      </div>
      <div class="modal-body">
        <div class="create-section"><label for="label-name">标签名称</label><input id="label-name" v-model="name" class="input" placeholder="输入标签名称" maxlength="20" autofocus @keydown.enter="addLabel" /></div>
        <section class="existing-section">
          <div class="list-heading"><strong>已有标签</strong><span>{{ store.labels.value.length }} 个</span></div>
          <div v-if="store.labels.value.length" class="label-list">
            <div v-for="label in store.labels.value" :key="label.id" class="label-item">
              <span class="label-color" :style="{ background: label.color }"></span>
              <span class="label-name">{{ label.name }}</span>
              <button class="remove-button" title="删除标签" @click="removeLabel(label)">删除</button>
            </div>
          </div>
          <div v-else class="empty-list"><SvgIcon name="tag" :size="22" /><span>还没有标签</span></div>
        </section>
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
.modal { width: 440px; max-width: 90vw; max-height: min(680px,90vh); overflow: hidden; display: flex; flex-direction: column; border-radius: var(--radius-lg); background: var(--surface); box-shadow: var(--shadow-lg); }
.modal-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid var(--border); }
.modal-header h3 { display: flex; align-items: center; gap: 7px; font-size: 1rem; }
.modal-body { min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 20px; padding: 20px; }
.create-section { display: flex; flex-direction: column; gap: 7px; }
.create-section label { color: var(--text-secondary); font-size: .82rem; font-weight: 600; }
.existing-section { padding-top: 16px; border-top: 1px solid var(--border); }
.list-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.list-heading strong { font-size: .83rem; }
.list-heading span { padding: 2px 8px; border-radius: 999px; color: var(--text-muted); background: var(--bg-secondary); font-size: .7rem; }
.label-list { display: flex; flex-direction: column; gap: 4px; max-height: 260px; overflow-y: auto; }
.label-item { display: flex; align-items: center; gap: 10px; min-height: 42px; padding: 7px 10px; border-radius: 8px; transition: var(--transition); }
.label-item:hover { background: var(--bg-secondary); }
.label-color { width: 10px; height: 10px; border-radius: 50%; flex: none; }
.label-name { flex: 1; font-size: .82rem; }
.remove-button { opacity: .55; padding: 4px 8px; border-radius: 5px; color: var(--danger); font-size: .72rem; transition: var(--transition); }
.label-item:hover .remove-button,.remove-button:focus-visible { opacity: 1; }
.remove-button:hover { background: var(--danger-light); }
.empty-list { display: flex; flex-direction: column; align-items: center; gap: 5px; padding: 22px; border: 1px dashed var(--border); border-radius: 8px; color: var(--text-muted); font-size: .76rem; }
.modal-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 14px 20px; border-top: 1px solid var(--border); }
</style>
