<script setup>
import { ref, computed } from 'vue'
import { useStore } from '../composables/useStore'
import { useNotify } from '../composables/useNotify'
import AppSelect from '../components/AppSelect.vue'

const store = useStore()
const notify = useNotify()
const newTodo = ref('')
const newAssignee = ref('')

const pendingTodos = computed(() => store.todos.value.filter(t => !t.done))
const doneTodos = computed(() => store.todos.value.filter(t => t.done))
const assigneeOptions = computed(() => store.persons.value.map(person => ({ value: person.id, label: person.name, description: person.role })))

async function addTodo() {
  const text = newTodo.value.trim()
  if (!text) return
  try {
    await store.addTodo({ content: text, assigneeId: newAssignee.value || null })
    newTodo.value = ''
    newAssignee.value = ''
  } catch (e) {
    notify.error(e.message)
  }
}

async function toggle(todo) {
  await store.updateTodo(todo.id, { done: !todo.done })
}

async function remove(todo) {
  await store.removeTodo(todo.id)
}

function assigneeName(id) {
  if (!id) return ''
  const p = store.getPerson(id)
  return p ? p.name : ''
}
</script>

<template>
  <div class="todo-panel">
    <div class="todo-container">
      <div class="todo-header">
        <h2><SvgIcon name="check-square" :size="18" /> 待办事项</h2>
        <div class="todo-stats">
          <span class="badge badge-warning">{{ pendingTodos.length }} 待办</span>
          <span class="badge badge-success">{{ doneTodos.length }} 已完成</span>
        </div>
      </div>

      <div class="add-todo-row">
        <input
          v-model="newTodo"
          class="input"
          :placeholder="store.persons.value.length === 0 ? '输入待办事项...' : '输入待办事项后回车...'"
          @keydown.enter="addTodo"
        />
        <div class="assignee-select"><AppSelect v-model="newAssignee" :options="assigneeOptions" :disabled="store.persons.value.length === 0" :placeholder="store.persons.value.length === 0 ? '暂无人员' : '指派给（可选）'" /></div>
        <button class="btn btn-primary" @click="addTodo" :disabled="!newTodo.trim()">＋ 添加</button>
      </div>

      <div v-if="pendingTodos.length" class="todo-section">
        <div class="section-label">待办 ({{ pendingTodos.length }})</div>
        <div class="todo-list">
          <div v-for="todo in pendingTodos" :key="todo.id" class="todo-item">
            <label class="todo-check">
              <input type="checkbox" :checked="todo.done" @change="toggle(todo)" />
              <span class="checkmark"></span>
            </label>
            <div class="todo-content">
              <span class="todo-text">{{ todo.content }}</span>
              <span v-if="assigneeName(todo.assigneeId)" class="todo-assignee">@{{ assigneeName(todo.assigneeId) }}</span>
            </div>
            <button class="btn-icon todo-delete" @click="remove(todo)" title="删除">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </div>
      </div>

      <div v-if="doneTodos.length" class="todo-section">
        <div class="section-label">已完成 ({{ doneTodos.length }})</div>
        <div class="todo-list">
          <div v-for="todo in doneTodos" :key="todo.id" class="todo-item done">
            <label class="todo-check">
              <input type="checkbox" :checked="todo.done" @change="toggle(todo)" />
              <span class="checkmark"></span>
            </label>
            <div class="todo-content">
              <span class="todo-text">{{ todo.content }}</span>
              <span v-if="assigneeName(todo.assigneeId)" class="todo-assignee">@{{ assigneeName(todo.assigneeId) }}</span>
            </div>
            <button class="btn-icon todo-delete" @click="remove(todo)" title="删除">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </div>
      </div>

      <div v-if="store.todos.value.length === 0" class="empty-state">
        <div class="empty-icon"><SvgIcon name="check-square" :size="48" /></div>
        <p>暂无待办事项</p>
        <span>在上方添加第一个待办</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.todo-panel { flex: 1; overflow-y: auto; padding: 24px; }
.todo-container { max-width: 720px; margin: 0 auto; }
.todo-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
.todo-header h2 { font-size: 1.2rem; display: flex; align-items: center; gap: 6px; }
.todo-stats { display: flex; gap: 8px; }
.add-todo-row { display: flex; gap: 8px; margin-bottom: 24px; }
.add-todo-row .input { flex: 1; }
.assignee-select {
  width: 190px;
  flex-shrink: 0;
}
.todo-section { margin-bottom: 20px; }
.section-label {
  font-size: .8rem;
  font-weight: 600;
  color: var(--text-muted);
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: .3px;
}
.todo-list {
  background: var(--surface);
  border: 1px solid var(--border-light);
  border-radius: var(--radius);
  overflow: hidden;
}
.todo-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border-light);
  transition: var(--transition);
}
.todo-item:hover { background: var(--bg-secondary); }
.todo-item:last-child { border-bottom: none; }
.todo-item.done .todo-text { text-decoration: line-through; color: var(--text-muted); }
.todo-check { position: relative; cursor: pointer; flex-shrink: 0; }
.todo-check input { position: absolute; opacity: 0; width: 18px; height: 18px; cursor: pointer; }
.checkmark {
  display: block;
  width: 18px; height: 18px;
  border: 2px solid var(--border);
  border-radius: 5px;
  transition: var(--transition);
}
.todo-check input:checked ~ .checkmark {
  background: var(--success);
  border-color: var(--success);
}
.todo-check input:checked ~ .checkmark::after {
  content: '✓';
  display: block;
  color: #fff;
  font-size: 12px;
  text-align: center;
  line-height: 14px;
  font-weight: 700;
}
.todo-content { flex: 1; display: flex; align-items: center; gap: 8px; }
.todo-text { font-size: .88rem; }
.todo-assignee { font-size: .75rem; color: var(--primary); font-weight: 500; background: var(--primary-light); padding: 1px 8px; border-radius: var(--radius-full); }
.todo-delete { opacity: 0; transition: var(--transition); }
.todo-item:hover .todo-delete { opacity: 1; }
.empty-state { text-align: center; padding: 60px 20px; color: var(--text-muted); }
.empty-state .empty-icon { margin-bottom: 12px; color: var(--text-muted); }
.empty-state p { font-size: 1rem; font-weight: 500; color: var(--text-secondary); }
.empty-state span { font-size: .82rem; }
</style>
