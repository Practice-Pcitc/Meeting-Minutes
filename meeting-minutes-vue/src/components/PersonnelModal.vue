<script setup>
import { ref, computed } from 'vue'
import { useStore } from '../composables/useStore'
import { useNotify } from '../composables/useNotify'

const emit = defineEmits(['close'])
const store = useStore()
const notify = useNotify()

// ===== 双 Tab =====
const activeTab = ref('meeting') // 'meeting' | 'library'

// ===== 本会议人员 =====
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

// 从人员库快速加入当前会议（只显示尚未加入的）
const libraryNotInMeeting = computed(() => {
  const existing = new Set(store.persons.value.map(p => p.name.toLocaleLowerCase()))
  return store.personLibrary.value.filter(p => !existing.has(p.name.toLocaleLowerCase()))
})

async function addLibraryToMeeting(person) {
  try {
    await store.addPerson({ name: person.name, role: person.role, color: person.color })
    notify.success(`已加入「${person.name}」`)
  } catch (e) { notify.error(e.message) }
}

// ===== 人员库管理 =====
const libNewName = ref('')
const libNewRole = ref('')
const libSubmitting = ref(false)
const libEditingId = ref('')
const libRoleDraft = ref('')
const libSavingRole = ref(false)

async function addLibraryPerson() {
  const name = libNewName.value.trim()
  if (!name || libSubmitting.value) return
  libSubmitting.value = true
  try {
    await store.addLibraryPerson({ name, role: libNewRole.value.trim() })
    libNewName.value = ''
    libNewRole.value = ''
    notify.success(`已添加至人员库「${name}」`)
  } catch (e) { notify.error(e.message) }
  finally { libSubmitting.value = false }
}

function editLibraryRole(person) {
  libEditingId.value = person.id
  libRoleDraft.value = person.role || ''
}

function cancelLibraryRoleEdit() {
  libEditingId.value = ''
  libRoleDraft.value = ''
}

async function saveLibraryRole(person) {
  if (libSavingRole.value) return
  libSavingRole.value = true
  try {
    await store.updateLibraryPerson(person.id, { role: libRoleDraft.value.trim() })
    notify.success(`已更新「${person.name}」的职务`)
    cancelLibraryRoleEdit()
  } catch (e) { notify.error(e.message) }
  finally { libSavingRole.value = false }
}

async function removeLibraryPerson(person) {
  const confirmed = await notify.confirm({ title: '从人员库移除', message: `确定从人员库移除「${person.name}」吗？不影响已在会议中的记录。`, confirmText: '移除', danger: true })
  if (!confirmed) return
  try {
    await store.removeLibraryPerson(person.id)
    notify.success(`已从人员库移除「${person.name}」`)
  } catch (e) { notify.error(e.message) }
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
        <div class="tab-bar">
          <button type="button" class="tab-btn" :class="{ active: activeTab === 'meeting' }" @click="activeTab = 'meeting'">本会议人员</button>
          <button type="button" class="tab-btn" :class="{ active: activeTab === 'library' }" @click="activeTab = 'library'">系统人员库</button>
        </div>

        <!-- ===== Tab 1：本会议人员 ===== -->
        <template v-if="activeTab === 'meeting'">
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

          <!-- 从人员库快速添加 -->
          <section v-if="libraryNotInMeeting.length" class="quick-library">
            <div class="quick-library-head"><strong>从人员库快速添加</strong><span>{{ libraryNotInMeeting.length }} 人可选</span></div>
            <div class="quick-library-grid">
              <button v-for="p in libraryNotInMeeting" :key="p.id" type="button" class="quick-chip" @click="addLibraryToMeeting(p)">
                <span class="library-dot" :style="{ background: p.color }"></span>{{ p.name }}<small v-if="p.role">{{ p.role }}</small>
              </button>
            </div>
          </section>

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
        </template>

        <!-- ===== Tab 2：系统人员库 ===== -->
        <template v-else>
          <div class="create-section">
            <div class="form-row">
              <label>姓名</label>
              <input v-model="libNewName" class="input" placeholder="输入人员姓名" maxlength="20" autofocus @keydown.enter="addLibraryPerson" />
            </div>
            <div class="form-row">
              <label>职务（可选）</label>
              <input v-model="libNewRole" class="input" placeholder="输入职务或角色" maxlength="30" @keydown.enter="addLibraryPerson" />
            </div>
          </div>

          <section class="existing-section">
            <div class="list-heading"><strong>人员库</strong><span>{{ store.personLibrary.value.length }} 人</span></div>
            <p class="library-tip">人员库在所有会议间共享，新建会议时可直接选择带入；本会议添加的人员会自动同步进来。</p>
            <div v-if="store.personLibrary.value.length" class="person-list">
              <div v-for="person in store.personLibrary.value" :key="person.id" class="person-item">
                <span class="avatar person-avatar" :style="{ background: person.color }">{{ person.name.charAt(0) }}</span>
                <span v-if="libEditingId !== person.id" class="person-info"><strong>{{ person.name }}</strong><small>{{ person.role || '未设置职务' }}</small></span>
                <span v-else class="role-editor"><strong>{{ person.name }}</strong><input v-model="libRoleDraft" class="role-input" placeholder="输入职务，留空则清除" maxlength="30" autofocus @keydown.enter="saveLibraryRole(person)" @keydown.esc="cancelLibraryRoleEdit" /></span>
                <template v-if="libEditingId === person.id">
                  <button class="role-action save" :disabled="libSavingRole" @click="saveLibraryRole(person)">保存</button>
                  <button class="role-action" @click="cancelLibraryRoleEdit">取消</button>
                </template>
                <template v-else>
                  <button class="role-action add-to-meeting" title="加入当前会议" @click="addLibraryToMeeting(person)">加入会议</button>
                  <button class="role-action" @click="editLibraryRole(person)">编辑职务</button>
                  <button class="remove-button" title="从人员库移除" @click="removeLibraryPerson(person)">移除</button>
                </template>
              </div>
            </div>
            <div v-else class="empty-list"><SvgIcon name="users" :size="22" /><span>人员库为空，添加后可在新建会议时直接选择</span></div>
          </section>
        </template>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" @click="emit('close')">取消</button>
        <button class="btn btn-primary" :disabled="(activeTab === 'meeting' ? !newName.trim() : !libNewName.trim()) || (activeTab === 'meeting' ? submitting : libSubmitting)" @click="activeTab === 'meeting' ? addPerson() : addLibraryPerson()">
          {{ (activeTab === 'meeting' ? submitting : libSubmitting) ? '添加中…' : '添加人员' }}
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
.tab-bar { display: flex; gap: 4px; padding: 3px; border-radius: 10px; background: var(--bg-secondary); }
.tab-btn { flex: 1; padding: 7px 0; border-radius: 8px; color: var(--text-secondary); font-size: .8rem; font-weight: 600; transition: var(--transition); }
.tab-btn:hover { color: var(--text-primary); }
.tab-btn.active { background: var(--surface); color: var(--primary); box-shadow: 0 1px 4px rgba(15,23,42,.08); }
.quick-library { padding-top: 14px; border-top: 1px solid var(--border); }
.quick-library-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 9px; }
.quick-library-head strong { font-size: .83rem; }
.quick-library-head span { padding: 2px 8px; border-radius: 999px; color: var(--text-muted); background: var(--bg-secondary); font-size: .7rem; }
.quick-library-grid { display: flex; flex-wrap: wrap; gap: 6px; max-height: 84px; overflow-y: auto; }
.quick-chip { display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; border: 1px dashed var(--border); border-radius: 999px; background: var(--surface); font-size: .76rem; cursor: pointer; transition: all .15s ease; }
.quick-chip small { color: var(--text-muted); font-size: .66rem; }
.quick-chip:hover { border-color: var(--primary); border-style: solid; color: var(--primary); background: var(--primary-light); }
.library-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.library-tip { padding: 8px 10px; border-radius: 8px; color: var(--text-muted); background: var(--bg-secondary); font-size: .72rem; line-height: 1.5; }
.role-action.add-to-meeting { color: var(--primary); font-weight: 600; }
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
