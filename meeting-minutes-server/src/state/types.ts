/**
 * 数据模型类型定义
 */

export interface Meeting {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  location: string;
  status: 'active' | 'ended';
}

export interface Person {
  id: string;
  name: string;
  role: string;
  color: string;
}

export interface Entry {
  id: string;
  content: string;
  time: string; // ISO-like "YYYY-MM-DD HH:mm"
  speakerId: string | null; // 主发言人
  topic: string; // 主题（可空字符串，由记录人后补）
  attendees: string[]; // 关联人员 id 列表
  createdAt: number;
}

export interface TopicTag {
  id: string;
  name: string;
}

export interface Todo {
  id: string;
  content: string;
  assigneeId: string | null;
  done: boolean;
  createdAt: number;
}

export interface Label {
  id: string;
  name: string;
  color: string;
}

export interface SeatAssignment {
  row: number;
  col: number;
  personId: string;
}

/** 完整应用状态 */
export interface AppState {
  meeting: Meeting;
  persons: Person[];
  entries: Entry[];
  topics: TopicTag[];
  todos: Todo[];
  labels: Label[];
  seats: SeatAssignment[];
}

export interface MeetingDocument extends AppState {
  createdAt: number;
  updatedAt: number;
}

export interface MeetingSummary {
  id: string;
  title: string;
  date: string;
  location: string;
  status: 'active' | 'ended';
  entryCount: number;
  personCount: number;
  todoCount: number;
  labels: Label[];
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceState {
  activeMeetingId: string;
  meetings: MeetingDocument[];
}

export interface StatePayload extends AppState {
  activeMeetingId: string;
  meetings: MeetingSummary[];
}

export const emptyState = (id = 'default'): AppState => ({
  meeting: {
    id,
    title: '',
    date: localDate(),
    startTime: '',
    endTime: '',
    location: '',
    status: 'active',
  },
  persons: [],
  entries: [],
  topics: [],
  todos: [],
  labels: [],
  seats: [],
});

export const emptyMeetingDocument = (id: string, title = ''): MeetingDocument => {
  const now = Date.now();
  const state = emptyState(id);
  state.meeting.title = title.trim();
  return { ...state, createdAt: now, updatedAt: now };
};

function localDate(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
