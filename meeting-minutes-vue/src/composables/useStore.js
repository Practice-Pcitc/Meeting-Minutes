/**
 * 全局状态管理 - 通过 HTTP 与 NestJS 后端通信
 * - 启动时一次性 GET /api/state 拉取全量
 * - 写操作走对应 POST/PATCH/DELETE
 * - 写完本地更新 state（乐观更新）+ 自动 refetch 同步
 */
import { reactive, computed } from 'vue';
import { authRequest } from './useAuth';

async function http(method, path, body) {
  return authRequest(method, path, body);
}

// ===== 空状态（与后端 types.ts 保持一致） =====
function emptyState() {
  return {
    meeting: { id: 'default', title: '', date: '', startTime: '', endTime: '', location: '' },
    persons: [],
    entries: [],
    topics: [],
    todos: [],
    labels: [],
    seats: [],
    activeMeetingId: '',
    meetings: [],
  };
}

const state = reactive({
  data: emptyState(),
  loading: false,
  error: null,
  ready: false, // 首屏数据是否已就绪
});
let mutationQueue = Promise.resolve();

async function loadAll() {
  state.loading = true;
  state.error = null;
  try {
    state.data = await http('GET', '/state');
    state.ready = true;
  } catch (e) {
    state.error = e.message;
    state.data = emptyState();
  } finally {
    state.loading = false;
  }
}

async function refetch() {
  try {
    state.data = await http('GET', '/state');
    state.error = null;
  } catch (e) {
    state.error = e.message;
    throw e;
  }
}

async function mutate(method, path, body) {
  const operation = mutationQueue.then(async () => {
    const result = await http(method, path, body);
    await refetch();
    return result;
  });
  // 后续写操作继续排队，但单次失败不会让整条队列永久失效。
  mutationQueue = operation.catch(() => undefined);
  return operation;
}

// ===== 写操作 =====
async function updateMeeting(patch) {
  return mutate('PATCH', '/meeting', patch);
}

function localDateAndTime(date = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  };
}

async function touchMeetingEnd(date = new Date()) {
  const currentMeeting = meeting.value;
  const activity = localDateAndTime(date);
  // 历史/未来会议的记录编辑不应改写其结束时间；自动更新只作用于当天会议。
  if (!currentMeeting?.id || currentMeeting.date !== activity.date) return null;
  // 用户手动设置了更晚的结束时间时予以保留，自动事件只向后推进。
  if (currentMeeting.endTime && currentMeeting.endTime >= activity.time) return currentMeeting;
  return updateMeeting({ endTime: activity.time });
}

async function addPerson({ name, role, color }) {
  return mutate('POST', '/persons', { name, role, color });
}

async function updatePerson(id, patch) {
  return mutate('PATCH', `/persons/${id}`, patch);
}

async function removePerson(id) {
  return mutate('DELETE', `/persons/${id}`);
}

async function addEntry(input) {
  const result = await mutate('POST', '/entries', input);
  await touchMeetingEnd();
  return result;
}

async function updateEntry(id, patch) {
  const result = await mutate('PATCH', `/entries/${id}`, patch);
  await touchMeetingEnd();
  return result;
}

async function removeEntry(id) {
  const result = await mutate('DELETE', `/entries/${id}`);
  await touchMeetingEnd();
  return result;
}

async function addTopic(name) {
  const topicName = typeof name === 'string' ? name : name?.name;
  return mutate('POST', '/topics', { name: topicName });
}

async function removeTopic(id) {
  return mutate('DELETE', `/topics/${id}`);
}

async function addTodo(input) {
  return mutate('POST', '/todos', input);
}

async function updateTodo(id, patch) {
  return mutate('PATCH', `/todos/${id}`, patch);
}

async function removeTodo(id) {
  return mutate('DELETE', `/todos/${id}`);
}

async function addLabel(input) {
  return mutate('POST', '/labels', input);
}

async function removeLabel(id) {
  return mutate('DELETE', `/labels/${id}`);
}

async function resetAll() {
  return mutate('POST', '/reset');
}

async function createMeeting(input = {}) {
  return mutate('POST', '/meetings', input);
}

async function selectMeeting(id) {
  return mutate('POST', `/meetings/${id}/select`);
}

async function deleteMeeting(id) {
  return mutate('DELETE', `/meetings/${id}`);
}

async function updateSeat(row, col, personId) {
  return mutate('PATCH', `/seats/${row}/${col}`, { personId });
}

async function clearSeats() {
  return mutate('DELETE', '/seats');
}

// ===== 计算属性 =====
const personMap = computed(() => {
  const m = new Map();
  state.data.persons.forEach((p) => m.set(p.id, p));
  return m;
});

const entries = computed(() => state.data.entries);
const persons = computed(() => state.data.persons);
const topics = computed(() => state.data.topics);
const todos = computed(() => state.data.todos);
const labels = computed(() => state.data.labels);
const seats = computed(() => state.data.seats || []);
const meeting = computed(() => state.data.meeting);
const meetings = computed(() => state.data.meetings || []);
const activeMeetingId = computed(() => state.data.activeMeetingId || state.data.meeting.id);

function getPerson(id) {
  return personMap.value.get(id) || null;
}

function clearState() {
  state.data = emptyState();
  state.error = null;
  state.ready = false;
}

export function useStore() {
  return {
    state,
    meeting,
    meetings,
    activeMeetingId,
    persons,
    entries,
    topics,
    todos,
    labels,
    seats,
    personMap,
    getPerson,
    loadAll,
    clearState,
    refetch,
    updateMeeting,
    touchMeetingEnd,
    addPerson,
    updatePerson,
    removePerson,
    addEntry,
    updateEntry,
    removeEntry,
    addTopic,
    removeTopic,
    addTodo,
    updateTodo,
    removeTodo,
    addLabel,
    removeLabel,
    resetAll,
    createMeeting,
    selectMeeting,
    deleteMeeting,
    updateSeat,
    clearSeats,
  };
}
