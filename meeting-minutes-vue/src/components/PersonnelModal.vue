<script setup>
import { ref } from 'vue'
import { useStore } from '../composables/useStore'
import { useNotify } from '../composables/useNotify'

const emit = defineEmits(['close'])
const store = useStore()
const notify = useNotify()

const newName = ref('')
const newRole = ref('')
const newTopic = ref('')

function countEntries(personId) {
  return store.entries.value.filter(e => e.speakerId === personId).length
}

async function addPerson() {
  const name = newName.value.trim()
  if (!name) return
  try {
    await store.addPerson({ name, role: newRole.value })
    newName.value = ''
    newRole.value = ''
  } catch (e) {
    notify.error(e.message)
  }
}

async function removePerson(id) {
  const p = store.getPerson(id)
  if (!p) return
  const confirmed = await notify.confirm({ title: '删除参会人员', message: `确定删除「${p.name}」吗？关联记录中的发言人和待办指派将被清除。`, confirmText: '删除', danger: true })
  if (!confirmed) return
  await store.removePerson(id)
}

async function addTopic() {
  const name = newTopic.value.trim()
  if (!name) return
  try {
    await store.addTopic(name)
    newTopic.value = ''
  } catch (e) {
    notify.error(e.message)
  }
}

async function removeTopic(id) {
  await store.removeTopic(id)
}
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal modal-lg">
      <div class="modal-header">
        <h3><SvgIcon name="users" :size="18" /> 人员与主题管理</h3>
        <button class="btn-icon" @click="emit('close')">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="modal-body">
        <!-- 人员管理 -->
        <div class="manage-section">
          <h4>参会人员 <span class="badge badge-gray">{{ store.persons.value.length }}</span></h4>
          <div class="add-row">
            <input v-model="newName" class="input" placeholder="姓名" maxlength="20"
              @keydown.enter="addPerson" />
            <input v-model="newRole" class="input" placeholder="职务（可选）" maxlength="30"
              @keydown.enter="addPerson" />
            <button class="btn btn-primary" @click="addPerson" :disabled="!newName.trim()">添加</button>
          </div>
          <div class="person-list">
            <div v-for="p in store.persons.value" :key="p.id" class="person-row">
              <div class="avatar" :style="{ background: p.color }">{{ p.name.charAt(0) }}</div>
              <div class="person-info">
                <span class="person-name">{{ p.name }}</span>
                <span v-if="p.role" class="person-role">{{ p.role }}</span>
              </div>
              <span class="entry-count">{{ countEntries(p.id) }} 条发言</span>
              <button class="btn-icon person-remove" @click="removePerson(p.id)" title="删除">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
            </div>
            <div v-if="store.persons.value.length === 0" class="empty-hint">
              还没有参会人员，请在上方添加
            </div>
          </div>
        </div>

        <!-- 主题管理 -->
        <div class="manage-section">
          <h4>主题标签 <span class="badge badge-gray">{{ store.topics.value.length }}</span></h4>
          <div class="add-row">
            <input v-model="newTopic" class="input" placeholder="输入主题名称" maxlength="20" @keydown.enter="addTopic" />
            <button class="btn btn-primary" @click="addTopic" :disabled="!newTopic.trim()">添加</button>
          </div>
          <div class="topic-chips">
            <span v-for="t in store.topics.value" :key="t.id" class="topic-chip">
              {{ t.name }}
              <button class="chip-remove" @click="removeTopic(t.id)">✕</button>
            </span>
            <span v-if="store.topics.value.length === 0" class="empty-hint">暂无主题</span>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-primary" @click="emit('close')">完成</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 关键修复：overlay 不再单独做模糊，模糊也只渲染在 modal 容器外；modal 容器必须有 opaque 背景 */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, .5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  animation: modal-fade-in .15s ease;
}
@keyframes modal-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

.modal {
  background: var(--surface); /* 必须不透明 */
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  animation: modal-pop-in .2s ease;
}
@keyframes modal-pop-in {
  from { opacity: 0; transform: scale(.96); }
  to { opacity: 1; transform: scale(1); }
}

.modal-lg { width: 580px; max-width: 90vw; max-height: 85vh; }

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  background: var(--surface); /* 显式 opaque */
}
.modal-header h3 { font-size: 1rem; display: flex; align-items: center; gap: 6px; }
.modal-body {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 24px;
  overflow-y: auto;
}
.modal-footer {
  display: flex;
  justify-content: flex-end;
  padding: 14px 20px;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
  background: var(--surface);
}

.manage-section h4 {
  font-size: .9rem;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.add-row { display: flex; gap: 8px; margin-bottom: 12px; }
.add-row .input { flex: 1; }

.person-list { display: flex; flex-direction: column; gap: 4px; }
.person-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-light);
  transition: var(--transition);
  background: var(--surface); /* 显式 opaque */
}
.person-row:hover { background: var(--bg-secondary); }
.person-row .avatar { width: 32px; height: 32px; font-size: .78rem; }
.person-info { flex: 1; display: flex; flex-direction: column; }
.person-name { font-size: .85rem; font-weight: 500; }
.person-role { font-size: .75rem; color: var(--text-muted); }
.entry-count { font-size: .75rem; color: var(--text-muted); }
.person-remove { opacity: 0; transition: var(--transition); }
.person-row:hover .person-remove { opacity: 1; }
.person-remove:hover { color: var(--danger); }

.topic-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.topic-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 12px;
  border-radius: var(--radius-full);
  background: var(--primary-light);
  color: var(--primary);
  font-size: .82rem;
  font-weight: 500;
}
.chip-remove { font-size: .72rem; opacity: .5; transition: var(--transition); }
.chip-remove:hover { opacity: 1; color: var(--danger); }

.empty-hint { font-size: .82rem; color: var(--text-muted); padding: 8px 0; }
</style>
