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
  aiSummary?: AiMeetingSummary;
  /** 实时 AI 总结运行状态：idle | waiting | summarizing | success | error | ended */
  aiStatus?: AiStatus;
  /** 增量总结维护的会议 AI 状态 */
  aiState?: MeetingAiState;
  /** 阶段总结快照历史 */
  aiSnapshots?: AiSummarySnapshot[];
  /** 已处理的转写/记录时间指针（createdAt 晚于该值视为新增） */
  aiProcessedUntil?: number;
  /** 已纳入总结的实时转写字符数 */
  aiLiveProcessedLen?: number;
  /** 前端最近一次上报的实时转写 */
  aiLiveTranscript?: string;
  /** 最近一次总结失败原因（仅用于诊断） */
  aiLastError?: string;
}

export interface AiMeetingSummary {
  summary: string;
  keyPoints: string[];
  decisions: string[];
  risks: string[];
  nextSteps: string[];
  provider: {
    id: string;
    name: string;
    model: string;
  };
  generatedAt: number;
}

/** AI 识别出的行动项 */
export interface AiTodoItem {
  owner: string;   // 负责人，未明确时为空字符串
  task: string;    // 任务内容
  deadline: string; // 截止时间，未明确时为空字符串
  status: 'pending' | 'done';
}

/** 增量总结维护的会议 AI 状态（结构字段名与 DeepSeek 输出 JSON 对齐） */
export interface MeetingAiState {
  current_topic: string;
  latest_summary: string;
  key_points: string[];
  decisions: string[];
  todos: AiTodoItem[];
  open_questions: string[];
  participants_views: string[];
  updated_at: number; // 时间戳（ms）
}

/** 每次 AI 成功更新后保存的阶段快照 */
export interface AiSummarySnapshot {
  id: string;
  meeting_id: string;
  current_topic: string;
  latest_summary: string;
  key_points: string[];
  decisions: string[];
  todos: AiTodoItem[];
  open_questions: string[];
  participants_views: string[];
  created_at: number;
}

export type AiStatus = 'idle' | 'waiting' | 'summarizing' | 'success' | 'error' | 'ended';

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
  startTime: string;
  endTime: string;
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
