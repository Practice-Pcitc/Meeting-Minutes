<script setup>
import { ref } from 'vue'
import { useStore } from '../composables/useStore'
import { useNotify } from '../composables/useNotify'

const emit = defineEmits(['close'])
const store = useStore()
const notify = useNotify()
const newName = ref('')
const newRole = ref('')
const submitting = ref(false)
const editingRoleId = ref('')
const roleDraft = ref('')
const savingRole = ref(false)

async function addPerson() {
  const name = newName.value.trim()
  if (!name || submitting.value) return
  submitting.value = true
  try {
    await store.addPerson({ name, role: newRole.value.trim() })
    newName.value = ''
    newRole.value = ''
    notify.success(`已添加参会人员「${name}」`)
  } catch (e) {
    notify.error(e.message)
  } finally {
    submitting.value = false
  }
}

async function removePerson(person) {
  const confirmed = await notify.confirm({ title: '移除参会人员', message: `确定从当前会议移除「${person.name}」吗？相关记录会保留，但不再关联该人员。`, confirmText: '移除', danger: true })
  if (!confirmed) return
  try {
    await store.removePerson(person.id)
    notify.success(`已移除「${person.name}」`)
  } catch (e) { notify.error(e.message) }
}

function editRole(person) {
  editingRoleId.value = person.id
  roleDraft.value = person.role || ''
}

function cancelRoleEdit() {
  editingRoleId.value = ''
  roleDraft.value = ''
}

async function saveRole(person) {
  if (savingRole.value) return
  savingRole.value = true
  try {
    await store.updatePerson(person.id, { role: roleDraft.value.trim() })
    notify.success(`已更新「${person.name}」的职务`)
    cancelRoleEdit()
  } catch (e) { notify.error(e.message) }
  finally { savingRole.value = false }
}
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal">
      <div class="modal-header">
        <h3><SvgIcon name="users" :size="18" /> 参会人员</h3>
        <button class="btn-icon" aria-label="关闭" @click="emit('close')">✕</button>
      </div>
      <div class="modal-body">
        <div class="create-section">
          <div class="form-row">
            <label>姓名</label>
            <input v-model="newName" class="input" placeholder="输入参会人员姓名" maxlength="20" autofocus @keydown.enter="addPerson" />
          </div>
          <div class="form-row">
            <label>职务（可选）</label>
            <input v-model="newRole" class="input" placeholder="输入职务或角色" maxlength="30" @keydown.enter="addPerson" />
          </div>
        </div>
        <section class="existing-section">
          <div class="list-heading"><strong>已有人员</strong><span>{{ store.persons.value.length }} 人</span></div>
          <div v-if="store.persons.value.length" class="person-list">
            <div v-for="person in store.persons.value" :key="person.id" class="person-item">
              <span class="avatar person-avatar" :style="{ background: person.color }">{{ person.name.charAt(0) }}</span>
              <span v-if="editingRoleId !== person.id" class="person-info"><strong>{{ person.name }}</strong><small>{{ person.role || '未设置职务' }}</small></span>
              <span v-else class="role-editor"><strong>{{ person.name }}</strong><input v-model="roleDraft" class="role-input" placeholder="输入职务，留空则清除" maxlength="30" autofocus @keydown.enter="saveRole(person)" @keydown.esc="cancelRoleEdit" /></span>
              <template v-if="editingRoleId === person.id">
                <button class="role-action save" :disabled="savingRole" @click="saveRole(person)">保存</button>
                <button class="role-action" @click="cancelRoleEdit">取消</button>
              </template>
              <template v-else>
                <button class="role-action" @click="editRole(person)">编辑职务</button>
                <button class="remove-button" title="移除人员" @click="removePerson(person)">移除</button>
              </template>
            </div>
          </div>
          <div v-else class="empty-list"><SvgIcon name="users" :size="22" /><span>还没有参会人员</span></div>
        </section>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" @click="emit('close')">取消</button>
        <button class="btn btn-primary" :disabled="!newName.trim() || submitting" @click="addPerson">
          {{ submitting ? '添加中…' : '添加人员' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay { position: fixed; inset: 0; z-index: 100; display: flex; align-items: center; justify-content: center; background: rgba(15,23,42,.5); }
.modal { width: 480px; max-width: 90vw; max-height: min(720px,90vh); overflow: hidden; display: flex; flex-direction: column; border-radius: var(--radius-lg); background: var(--surface); box-shadow: var(--shadow-lg); }
.modal-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid var(--border); }
.modal-header h3 { display: flex; align-items: center; gap: 7px; font-size: 1rem; }
.modal-body { min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 20px; padding: 20px; }
.create-section { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.form-row { display: flex; flex-direction: column; gap: 6px; }
.form-row label { color: var(--text-secondary); font-size: .82rem; font-weight: 600; }
.existing-section { padding-top: 16px; border-top: 1px solid var(--border); }
.list-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.list-heading strong { font-size: .83rem; }
.list-heading span { padding: 2px 8px; border-radius: 999px; color: var(--text-muted); background: var(--bg-secondary); font-size: .7rem; }
.person-list { display: flex; flex-direction: column; gap: 4px; max-height: 270px; overflow-y: auto; }
.person-item { display: flex; align-items: center; gap: 10px; padding: 8px 9px; border-radius: 8px; transition: var(--transition); }
.person-item:hover { background: var(--bg-secondary); }
.person-avatar { width: 32px; height: 32px; font-size: .74rem; }
.person-info { min-width: 0; flex: 1; display: flex; flex-direction: column; }
.person-info strong { font-size: .82rem; }
.person-info small { color: var(--text-muted); font-size: .7rem; }
.role-editor { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 4px; }
.role-editor strong { font-size: .78rem; }
.role-input { width: 100%; height: 30px; padding: 0 8px; border: 1px solid var(--primary); border-radius: 5px; outline: none; box-shadow: 0 0 0 2px var(--primary-light); font-size: .75rem; }
.role-action { padding: 4px 7px; border-radius: 5px; color: var(--text-secondary); font-size: .7rem; white-space: nowrap; }
.role-action:hover { color: var(--primary); background: var(--primary-light); }
.role-action.save { color: var(--primary); font-weight: 600; }
.remove-button { opacity: .55; padding: 4px 8px; border-radius: 5px; color: var(--danger); font-size: .72rem; transition: var(--transition); }
.person-item:hover .remove-button,.remove-button:focus-visible { opacity: 1; }
.remove-button:hover { background: var(--danger-light); }
.empty-list { display: flex; flex-direction: column; align-items: center; gap: 5px; padding: 22px; border: 1px dashed var(--border); border-radius: 8px; color: var(--text-muted); font-size: .76rem; }
.modal-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 14px 20px; border-top: 1px solid var(--border); }
@media (max-width: 540px) { .create-section { grid-template-columns: 1fr; } }
</style>
