import { BadRequestException, Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';
import { v4 as uuid } from 'uuid';
import {
  AiMeetingSummary, AiStatus, AiSummarySnapshot, AppState, emptyState, emptyMeetingDocument, LibraryPerson, Meeting, MeetingAiState,
  MeetingDocument, MeetingSummary, Person, Entry, TopicTag, Todo, Label, StatePayload, WorkspaceState,
} from './types';
import { getCurrentUserId } from '../auth/request-context';

/**
 * 状态服务 - 单例，进程内数组存储 + 异步落盘
 * 接口幂等、错误可恢复：每次写都同步更新内存 + 排队写盘
 */
@Injectable()
export class StateService implements OnModuleInit {
  private readonly logger = new Logger('StateService');
  private readonly dataFile = path.join(process.cwd(), 'data', 'state.json');
  private workspaces: Record<string, WorkspaceState> = {};
  private legacyWorkspace: WorkspaceState | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  async onModuleInit() {
    try {
      const raw = await fs.readFile(this.dataFile, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed?.version === 2 && parsed.workspaces && typeof parsed.workspaces === 'object') {
        for (const [userId, workspace] of Object.entries(parsed.workspaces)) {
          if (userId === '__legacy__') this.legacyWorkspace = this.migrate(workspace);
          else this.workspaces[userId] = this.migrate(workspace);
        }
      } else {
        this.legacyWorkspace = this.migrate(parsed);
      }
      this.logger.log(`Loaded state from ${this.dataFile}`);
    } catch (e: any) {
      if (e.code === 'ENOENT') {
        this.logger.log('No existing state file, starting fresh');
      } else {
        this.logger.error(`Failed to load state: ${e.message}, using empty state`);
      }
      await this.persistAll();
    }
  }

  /** 兼容前端老格式（meetingTitle 直接平铺） */
  private migrate(raw: any): WorkspaceState {
    const empty = emptyState();
    if (!raw || typeof raw !== 'object') return this.newWorkspace();
    if (Array.isArray(raw.meetings)) {
      const meetings = raw.meetings
        .filter((item: any) => item && typeof item === 'object')
        .map((item: any) => this.normalizeDocument(item));
      if (!meetings.length) return this.newWorkspace();
      const activeMeetingId = meetings.some((item) => item.meeting.id === raw.activeMeetingId)
        ? raw.activeMeetingId
        : meetings[0].meeting.id;
      return { activeMeetingId, meetings, personLibrary: this.normalizeLibrary(raw.personLibrary) };
    }

    let legacyState: AppState;
    if (raw.meetingTitle !== undefined || raw.meetingDate !== undefined) {
      // 老格式
      legacyState = {
        meeting: {
          ...empty.meeting,
          title: raw.meetingTitle || '',
          date: raw.meetingDate || empty.meeting.date,
        },
        persons: (raw.personnel || []).map((p: any) => ({
          id: p.id || uuid(),
          name: p.name,
          role: p.role || '',
          color: p.color || '#3b82f6',
        })),
        entries: (raw.entries || []).map((e: any) => ({
          id: e.id || uuid(),
          content: e.content || '',
          time: e.time || new Date().toISOString().slice(0, 16).replace('T', ' '),
          speakerId: (e.personnel && e.personnel[0]) || null,
          topic: e.topic || '',
          attendees: e.personnel || [],
          createdAt: e.createdAt || Date.now(),
        })),
        topics: (raw.topics || []).map((t: any) =>
          typeof t === 'string' ? { id: uuid(), name: t } : t,
        ),
        todos: [],
        labels: [],
        seats: [],
      };
    } else {
      legacyState = {
        meeting: { ...empty.meeting, ...(raw.meeting || {}) },
        persons: Array.isArray(raw.persons) ? raw.persons : [],
        entries: Array.isArray(raw.entries) ? raw.entries : [],
        topics: Array.isArray(raw.topics) ? raw.topics : [],
        todos: Array.isArray(raw.todos) ? raw.todos : [],
        labels: Array.isArray(raw.labels) ? raw.labels : [],
        seats: Array.isArray(raw.seats) ? raw.seats : [],
      };
    }
    const id = legacyState.meeting.id && legacyState.meeting.id !== 'default' ? legacyState.meeting.id : uuid();
    legacyState.meeting.id = id;
    const now = Date.now();
    return { activeMeetingId: id, meetings: [{ ...legacyState, createdAt: now, updatedAt: now }], personLibrary: this.normalizeLibrary(raw.personLibrary) };
  }

  private persist() {
    const current = this.workspace.meetings.find((item) => item.meeting.id === this.workspace.activeMeetingId);
    if (current) current.updatedAt = Date.now();
    const data = JSON.stringify({ version: 2, workspaces: this.workspaces }, null, 2);
    this.writeQueue = this.writeQueue.then(async () => {
      await fs.mkdir(path.dirname(this.dataFile), { recursive: true });
      const tmp = this.dataFile + '.tmp';
      await fs.writeFile(tmp, data, 'utf-8');
      await fs.rename(tmp, this.dataFile);
    }).catch((e) => this.logger.error(`Persist failed: ${e.message}`));
  }

  private async persistAll() {
    const data = JSON.stringify({ version: 2, workspaces: this.workspaces }, null, 2);
    await fs.mkdir(path.dirname(this.dataFile), { recursive: true });
    await fs.writeFile(this.dataFile, data, 'utf-8');
  }

  private get workspace(): WorkspaceState {
    const userId = getCurrentUserId();
    if (!userId) throw new Error('Missing authenticated user context');
    if (!this.workspaces[userId]) {
      this.workspaces[userId] = this.legacyWorkspace || this.newWorkspace();
      this.legacyWorkspace = null;
      this.persist();
    }
    return this.workspaces[userId];
  }

  private set workspace(value: WorkspaceState) {
    const userId = getCurrentUserId();
    if (!userId) throw new Error('Missing authenticated user context');
    this.workspaces[userId] = value;
  }

  private get state(): MeetingDocument {
    const current = this.workspace.meetings.find((item) => item.meeting.id === this.workspace.activeMeetingId);
    if (current) return current;
    return emptyMeetingDocument('');
  }

  private newWorkspace(): WorkspaceState {
    return { activeMeetingId: '', meetings: [], personLibrary: [] };
  }

  /** 兼容 / 兜底：人员库字段（旧数据没有 personLibrary） */
  private normalizeLibrary(raw: any): LibraryPerson[] {
    if (!Array.isArray(raw)) return [];
    const now = Date.now();
    return raw
      .filter((item: any) => item && typeof item === 'object' && typeof item.name === 'string' && item.name.trim())
      .map((item: any) => ({
        id: typeof item.id === 'string' && item.id ? item.id : uuid(),
        name: String(item.name).trim(),
        role: typeof item.role === 'string' ? item.role : '',
        color: typeof item.color === 'string' && item.color ? item.color : this.randomColor(),
        createdAt: Number(item.createdAt) || now,
        updatedAt: Number(item.updatedAt) || now,
      }));
  }

  private normalizeDocument(raw: any): MeetingDocument {
    const id = raw?.meeting?.id || uuid();
    const empty = emptyMeetingDocument(id);
    const meeting = { ...empty.meeting, ...(raw.meeting || {}), id } as any;
    // 兼容 / 兜底：实时 AI 总结相关字段
    if (typeof meeting.aiStatus !== 'string') meeting.aiStatus = 'idle';
    if (!Array.isArray(meeting.aiSnapshots)) meeting.aiSnapshots = [];
    if (meeting.aiState && typeof meeting.aiState !== 'object') delete meeting.aiState;
    if (meeting.aiSummary && typeof meeting.aiSummary !== 'object') delete meeting.aiSummary;
    return {
      meeting,
      persons: Array.isArray(raw.persons) ? raw.persons : [],
      entries: Array.isArray(raw.entries) ? raw.entries : [],
      topics: Array.isArray(raw.topics) ? raw.topics : [],
      todos: Array.isArray(raw.todos) ? raw.todos : [],
      labels: Array.isArray(raw.labels) ? raw.labels : [],
      seats: Array.isArray(raw.seats) ? raw.seats.filter((seat: any) =>
        Number.isInteger(seat?.row) && Number.isInteger(seat?.col) && typeof seat?.personId === 'string',
      ) : [],
      createdAt: Number(raw.createdAt) || Date.now(),
      updatedAt: Number(raw.updatedAt) || Number(raw.createdAt) || Date.now(),
    };
  }

  // ========== 整体查询 ==========

  getState(): StatePayload {
    const current = this.state;
    return JSON.parse(JSON.stringify({
      meeting: current.meeting,
      persons: current.persons,
      entries: current.entries,
      topics: current.topics,
      todos: current.todos,
      labels: current.labels,
      seats: current.seats,
      activeMeetingId: this.workspace.activeMeetingId,
      meetings: this.listMeetings(),
      personLibrary: this.listLibrary(),
    }));
  }

  getMeetingDocument(id: string): MeetingDocument | null {
    const document = this.workspace.meetings.find((item) => item.meeting.id === id);
    return document ? JSON.parse(JSON.stringify(document)) : null;
  }

  saveAiSummary(id: string, summary: AiMeetingSummary): AiMeetingSummary {
    const document = this.workspace.meetings.find((item) => item.meeting.id === id);
    if (!document) throw new BadRequestException('会议不存在');
    document.meeting.aiSummary = summary;
    document.updatedAt = Date.now();
    this.persist();
    return JSON.parse(JSON.stringify(summary));
  }

  /** 实时 AI 总结运行数据（状态 / 会议状态 / 快照 / 转写指针）增量更新 */
  updateMeetingAi(
    id: string,
    patch: Partial<{
      aiStatus: AiStatus;
      aiState: MeetingAiState | null;
      aiSnapshots: AiSummarySnapshot[];
      aiProcessedUntil: number;
      aiLiveProcessedLen: number;
      aiLiveTranscript: string;
      aiLastError: string;
    }>,
  ) {
    const document = this.workspace.meetings.find((item) => item.meeting.id === id);
    if (!document) throw new BadRequestException('会议不存在');
    const meeting = document.meeting as any;
    for (const key of ['aiStatus', 'aiProcessedUntil', 'aiLiveProcessedLen', 'aiLiveTranscript', 'aiLastError'] as const) {
      if (patch[key] !== undefined) meeting[key] = patch[key];
    }
    if (patch.aiSnapshots !== undefined) meeting.aiSnapshots = patch.aiSnapshots;
    if (patch.aiState === null || patch.aiState === undefined) delete meeting.aiState;
    else if (typeof patch.aiState === 'object') meeting.aiState = patch.aiState;
    document.updatedAt = Date.now();
    this.persist();
    return {
      aiStatus: meeting.aiStatus,
      aiState: meeting.aiState || null,
      aiSnapshots: meeting.aiSnapshots || [],
      aiProcessedUntil: meeting.aiProcessedUntil || 0,
      aiLiveProcessedLen: meeting.aiLiveProcessedLen || 0,
      aiLiveTranscript: meeting.aiLiveTranscript || '',
    };
  }

  reset(): StatePayload {
    const id = this.workspace.activeMeetingId;
    const current = this.state;
    const replacement = emptyMeetingDocument(id);
    replacement.createdAt = current.createdAt;
    this.workspace.meetings = this.workspace.meetings.map((item) => item.meeting.id === id ? replacement : item);
    this.persist();
    return this.getState();
  }

  listMeetings(): MeetingSummary[] {
    return [...this.workspace.meetings]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((item) => ({
        id: item.meeting.id,
        title: item.meeting.title,
        date: item.meeting.date,
        startTime: item.meeting.startTime,
        endTime: item.meeting.endTime,
        location: item.meeting.location,
        status: item.meeting.status,
        entryCount: item.entries.length,
        personCount: item.persons.length,
        todoCount: item.todos.length,
        labels: item.labels.map((label) => ({ ...label })),
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      }));
  }

  createMeeting(input: { title?: string; date?: string; startTime?: string; endTime?: string; location?: string; copyPersons?: boolean; copySeats?: boolean; libraryPersonIds?: string[] } = {}): StatePayload {
    const previous = this.state;
    const id = uuid();
    const document = emptyMeetingDocument(id, input.title || '');
    for (const key of ['date', 'startTime', 'endTime', 'location'] as const) {
      if (typeof input[key] === 'string') document.meeting[key] = input[key]!.trim();
    }
    if (input.copyPersons || input.copySeats) {
      const personIdMap = new Map<string, string>();
      document.persons = previous.persons.map((person) => {
        const id = uuid();
        personIdMap.set(person.id, id);
        return { ...person, id };
      });
      if (input.copySeats) {
        document.seats = previous.seats
          .filter((seat) => personIdMap.has(seat.personId))
          .map((seat) => ({ ...seat, personId: personIdMap.get(seat.personId)! }));
      }
    }
    // 从系统人员库直接带入人员
    if (Array.isArray(input.libraryPersonIds) && input.libraryPersonIds.length) {
      const existing = new Set(document.persons.map((p) => p.name.toLocaleLowerCase()));
      for (const libId of input.libraryPersonIds) {
        const lib = this.workspace.personLibrary.find((item) => item.id === libId);
        if (!lib) continue;
        if (existing.has(lib.name.toLocaleLowerCase())) continue;
        existing.add(lib.name.toLocaleLowerCase());
        document.persons.push({ id: uuid(), name: lib.name, role: lib.role, color: lib.color });
      }
    }
    this.workspace.meetings.push(document);
    this.workspace.activeMeetingId = id;
    this.persist();
    return this.getState();
  }

  selectMeeting(id: string): StatePayload | null {
    if (!this.workspace.meetings.some((item) => item.meeting.id === id)) return null;
    this.workspace.activeMeetingId = id;
    this.persist();
    return this.getState();
  }

  deleteMeeting(id: string): StatePayload | null {
    const index = this.workspace.meetings.findIndex((item) => item.meeting.id === id);
    if (index < 0) return null;
    this.workspace.meetings.splice(index, 1);
    if (!this.workspace.meetings.length) {
      // 保留系统级人员库，只清空会议列表
      this.workspace.meetings = [];
      this.workspace.activeMeetingId = '';
    } else if (this.workspace.activeMeetingId === id) {
      this.workspace.activeMeetingId = [...this.workspace.meetings].sort((a, b) => b.updatedAt - a.updatedAt)[0].meeting.id;
    }
    this.persist();
    return this.getState();
  }

  // ========== 会议 ==========

  updateMeeting(updates: Partial<Meeting>, meetingId = this.workspace.activeMeetingId): Meeting | null {
    const document = this.workspace.meetings.find((item) => item.meeting.id === meetingId);
    if (!document) return null;
    const allowed: (keyof Omit<Meeting, 'id'>)[] = ['title', 'date', 'startTime', 'endTime', 'location'];
    for (const key of allowed) {
      const value = updates[key];
      if (typeof value === 'string') (document.meeting as unknown as Record<string, string>)[key] = value.trim();
    }
    if (updates.status !== undefined) {
      if (!['active', 'ended'].includes(updates.status)) throw new BadRequestException('会议状态无效');
      document.meeting.status = updates.status;
    }
    document.updatedAt = Date.now();
    this.persist();
    return { ...document.meeting };
  }

  updateSeat(row: number, col: number, personId: string | null) {
    if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0 || row > 19 || col > 29) {
      throw new BadRequestException('座位坐标无效');
    }
    this.assertPerson(personId);
    this.state.seats = this.state.seats.filter((seat) =>
      !(seat.row === row && seat.col === col) && (!personId || seat.personId !== personId),
    );
    if (personId) this.state.seats.push({ row, col, personId });
    this.persist();
    return [...this.state.seats];
  }

  clearSeats() {
    this.state.seats = [];
    this.persist();
    return [];
  }

  // ========== 人员 ==========

  listPersons(): Person[] {
    return [...this.state.persons];
  }

  addPerson(input: Omit<Person, 'id'>): Person {
    const name = (input.name || '').trim();
    if (!name) throw new BadRequestException('姓名不能为空');
    if (this.state.persons.some((p) => p.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      throw new BadRequestException('该人员已存在');
    }
    const person: Person = {
      id: uuid(),
      name,
      role: (input.role || '').trim(),
      color: input.color || this.randomColor(),
    };
    this.state.persons.push(person);
    this.syncPersonToLibrary(person);
    this.persist();
    return person;
  }

  updatePerson(id: string, updates: Partial<Person>): Person | null {
    const p = this.state.persons.find((x) => x.id === id);
    if (!p) return null;
    if (updates.name !== undefined) {
      const name = updates.name.trim();
      if (!name) throw new BadRequestException('姓名不能为空');
      if (this.state.persons.some((x) => x.id !== id && x.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
        throw new BadRequestException('该人员已存在');
      }
      p.name = name;
    }
    if (updates.role !== undefined) p.role = updates.role.trim();
    if (updates.color !== undefined) p.color = updates.color;
    this.syncPersonToLibrary(p);
    this.persist();
    return { ...p };
  }

  removePerson(id: string): boolean {
    const before = this.state.persons.length;
    this.state.persons = this.state.persons.filter((p) => p.id !== id);
    // 清理关联引用
    this.state.entries.forEach((e) => {
      if (e.speakerId === id) e.speakerId = null;
      e.attendees = e.attendees.filter((x) => x !== id);
    });
    this.state.todos.forEach((t) => {
      if (t.assigneeId === id) t.assigneeId = null;
    });
    this.state.seats = this.state.seats.filter((seat) => seat.personId !== id);
    if (this.state.persons.length !== before) {
      this.persist();
      return true;
    }
    return false;
  }

  // ========== 系统级人员库 ==========

  listLibrary(): LibraryPerson[] {
    return [...this.workspace.personLibrary];
  }

  /** 会议内人员变动时同步进人员库（同名则更新，否则新增） */
  private syncPersonToLibrary(person: Person) {
    const library = this.workspace.personLibrary;
    const index = library.findIndex((item) => item.name.toLocaleLowerCase() === person.name.toLocaleLowerCase());
    const now = Date.now();
    if (index >= 0) {
      library[index] = {
        ...library[index],
        name: person.name,
        role: person.role || library[index].role,
        color: person.color || library[index].color,
        updatedAt: now,
      };
    } else {
      library.push({
        id: uuid(),
        name: person.name,
        role: person.role,
        color: person.color,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  /** 直接向人员库新增条目（不自动加入当前会议） */
  addLibraryPerson(input: Omit<LibraryPerson, 'id' | 'createdAt' | 'updatedAt'>): LibraryPerson {
    const name = (input.name || '').trim();
    if (!name) throw new BadRequestException('姓名不能为空');
    if (this.workspace.personLibrary.some((item) => item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      throw new BadRequestException('该人员已在人员库中');
    }
    const now = Date.now();
    const item: LibraryPerson = {
      id: uuid(),
      name,
      role: (input.role || '').trim(),
      color: input.color || this.randomColor(),
      createdAt: now,
      updatedAt: now,
    };
    this.workspace.personLibrary.push(item);
    this.persist();
    return { ...item };
  }

  updateLibraryPerson(id: string, updates: Partial<Omit<LibraryPerson, 'id' | 'createdAt'>>): LibraryPerson | null {
    const item = this.workspace.personLibrary.find((x) => x.id === id);
    if (!item) return null;
    if (updates.name !== undefined) {
      const name = updates.name.trim();
      if (!name) throw new BadRequestException('姓名不能为空');
      if (this.workspace.personLibrary.some((x) => x.id !== id && x.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
        throw new BadRequestException('该人员已在人员库中');
      }
      item.name = name;
    }
    if (updates.role !== undefined) item.role = updates.role.trim();
    if (updates.color !== undefined) item.color = updates.color;
    item.updatedAt = Date.now();
    this.persist();
    return { ...item };
  }

  removeLibraryPerson(id: string): boolean {
    const before = this.workspace.personLibrary.length;
    this.workspace.personLibrary = this.workspace.personLibrary.filter((item) => item.id !== id);
    if (this.workspace.personLibrary.length !== before) {
      this.persist();
      return true;
    }
    return false;
  }

  // ========== 记录 ==========

  listEntries(): Entry[] {
    return [...this.state.entries];
  }

  addEntry(input: Omit<Entry, 'id' | 'createdAt'>): Entry {
    if (!input.content || !input.content.trim()) throw new BadRequestException('记录内容不能为空');
    this.assertPerson(input.speakerId);
    const entry: Entry = {
      id: uuid(),
      content: input.content.trim(),
      time: this.normalizeDateTime(input.time) || this.localDateTime(),
      speakerId: input.speakerId || null,
      topic: (input.topic || '').trim(),
      attendees: input.attendees || [],
      createdAt: Date.now(),
    };
    this.state.entries.push(entry);
    if (entry.topic) this.ensureTopic(entry.topic);
    this.persist();
    return entry;
  }

  updateEntry(id: string, updates: Partial<Entry>): Entry | null {
    const e = this.state.entries.find((x) => x.id === id);
    if (!e) return null;
    if (updates.content !== undefined) {
      const content = updates.content.trim();
      if (!content) throw new BadRequestException('记录内容不能为空');
      e.content = content;
    }
    if (updates.time !== undefined) e.time = this.normalizeDateTime(updates.time);
    if (updates.speakerId !== undefined) {
      this.assertPerson(updates.speakerId);
      e.speakerId = updates.speakerId;
    }
    if (updates.topic !== undefined) e.topic = updates.topic.trim();
    if (updates.attendees !== undefined) e.attendees = updates.attendees;
    if (e.topic) this.ensureTopic(e.topic);
    this.persist();
    return { ...e };
  }

  removeEntry(id: string): boolean {
    const before = this.state.entries.length;
    this.state.entries = this.state.entries.filter((e) => e.id !== id);
    if (this.state.entries.length !== before) {
      this.persist();
      return true;
    }
    return false;
  }

  // ========== 主题 ==========

  listTopics(): TopicTag[] {
    return [...this.state.topics];
  }

  addTopic(input: Omit<TopicTag, 'id'>): TopicTag {
    const name = (input.name || '').trim();
    if (!name) throw new BadRequestException('主题名不能为空');
    if (this.state.topics.some((t) => t.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      throw new BadRequestException('该主题已存在');
    }
    const topic: TopicTag = { id: uuid(), name };
    this.state.topics.push(topic);
    this.persist();
    return topic;
  }

  removeTopic(id: string): boolean {
    const before = this.state.topics.length;
    const target = this.state.topics.find((t) => t.id === id);
    this.state.topics = this.state.topics.filter((t) => t.id !== id);
    // 清空引用了该主题的记录
    if (target) {
      this.state.entries.forEach((e) => {
        if (e.topic === target.name) e.topic = '';
      });
    }
    if (this.state.topics.length !== before) {
      this.persist();
      return true;
    }
    return false;
  }

  private ensureTopic(name: string) {
    if (!this.state.topics.some((t) => t.name === name)) {
      this.state.topics.push({ id: uuid(), name });
    }
  }

  // ========== 待办 ==========

  listTodos(): Todo[] {
    return [...this.state.todos];
  }

  addTodo(input: Omit<Todo, 'id' | 'createdAt' | 'done'>): Todo {
    if (!input.content || !input.content.trim()) throw new BadRequestException('待办内容不能为空');
    this.assertPerson(input.assigneeId);
    const todo: Todo = {
      id: uuid(),
      content: input.content.trim(),
      assigneeId: input.assigneeId || null,
      done: false,
      createdAt: Date.now(),
    };
    this.state.todos.push(todo);
    this.persist();
    return todo;
  }

  updateTodo(id: string, updates: Partial<Todo>): Todo | null {
    const t = this.state.todos.find((x) => x.id === id);
    if (!t) return null;
    if (updates.content !== undefined) {
      const content = updates.content.trim();
      if (!content) throw new BadRequestException('待办内容不能为空');
      t.content = content;
    }
    if (updates.assigneeId !== undefined) {
      this.assertPerson(updates.assigneeId);
      t.assigneeId = updates.assigneeId;
    }
    if (updates.done !== undefined) t.done = Boolean(updates.done);
    this.persist();
    return { ...t };
  }

  removeTodo(id: string): boolean {
    const before = this.state.todos.length;
    this.state.todos = this.state.todos.filter((t) => t.id !== id);
    if (this.state.todos.length !== before) {
      this.persist();
      return true;
    }
    return false;
  }

  // ========== 标签 ==========

  listLabels(): Label[] {
    return [...this.state.labels];
  }

  addLabel(input: Omit<Label, 'id'>): Label {
    const name = (input.name || '').trim();
    if (!name) throw new BadRequestException('标签名不能为空');
    if (this.state.labels.some((l) => l.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      throw new BadRequestException('该标签已存在');
    }
    const label: Label = { id: uuid(), name, color: input.color || this.randomColor() };
    this.state.labels.push(label);
    this.persist();
    return label;
  }

  removeLabel(id: string): boolean {
    const before = this.state.labels.length;
    this.state.labels = this.state.labels.filter((l) => l.id !== id);
    if (this.state.labels.length !== before) {
      this.persist();
      return true;
    }
    return false;
  }

  private randomColor(): string {
    const palette = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];
    return palette[Math.floor(Math.random() * palette.length)];
  }

  private assertPerson(id: string | null | undefined) {
    if (id && !this.state.persons.some((person) => person.id === id)) {
      throw new BadRequestException('指定的人员不存在');
    }
  }

  private normalizeDateTime(value: string | undefined): string {
    return (value || '').trim().replace('T', ' ');
  }

  private localDateTime(): string {
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  }
}
