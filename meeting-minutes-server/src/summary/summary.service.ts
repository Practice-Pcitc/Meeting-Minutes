import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Subject } from 'rxjs';
import { v4 as uuid } from 'uuid';
import { AuthService } from '../auth/auth.service';
import { StateService } from '../state/state.service';
import {
  AiMeetingSummary, AiSummarySnapshot, MeetingAiState, MeetingDocument,
} from '../state/types';
import { RecordingService } from '../recording/recording.service';
import { setCurrentUserId } from '../auth/request-context';

/** 增量总结调度参数（统一配置，便于后续做成可配置项） */
const SUMMARY_INTERVAL_MS = 30_000;      // 每 30 秒检查一次
const MIN_TRANSCRIPT_CHARS = 50;         // 新增有效转写不足 50 字不调用 AI
const SNAPSHOT_LIMIT = 50;               // 快照保留上限
const LIVE_TRANSCRIPT_LIMIT = 60_000;    // 实时转写单次上报上限

/** SSE 事件类型 */
export const SSE_EVENT_STATUS = 'summary_status';
export const SSE_EVENT_UPDATE = 'summary_update';
export const SSE_EVENT_ERROR = 'summary_error';
export const SSE_EVENT_FINAL = 'summary_final';

@Injectable()
export class SummaryService {
  private readonly logger = new Logger('SummaryService');
  /** meetingId -> 实时总结调度定时器 */
  private jobs = new Map<string, NodeJS.Timeout>();
  /** meetingId -> 是否正在执行总结（同一会议同一时间只允许一个任务） */
  private locks = new Map<string, boolean>();
  /** meetingId -> SSE 事件总线 */
  private subjects = new Map<string, Subject<any>>();

  constructor(
    private readonly auth: AuthService,
    private readonly state: StateService,
    private readonly recordings: RecordingService,
  ) {}

  // ==================== 实时调度 ====================

  /** 前端通知：开启 / 关闭实时总结 */
  async setRealtime(userId: string, meetingId: string, active: boolean, final = true) {
    if (active) {
      this.startRealtime(userId, meetingId);
      return { ok: true, status: 'started' };
    }
    await this.stopRealtime(userId, meetingId, { final });
    return { ok: true, status: 'stopped' };
  }

  startRealtime(userId: string, meetingId: string) {
    setCurrentUserId(userId);
    if (this.jobs.has(meetingId)) return;
    this.state.updateMeetingAi(meetingId, { aiStatus: 'waiting', aiLastError: '' });
    this.broadcast(meetingId, SSE_EVENT_STATUS, { status: 'waiting' });
    this.logger.log(`[AI Summary] realtime started meeting=${meetingId}`);
    const timer = setInterval(() => void this.tick(userId, meetingId), SUMMARY_INTERVAL_MS);
    timer.unref?.();
    this.jobs.set(meetingId, timer);
    // 立即做一次首轮检查（录音刚开始，内容通常不足，会进入 waiting）
    void this.tick(userId, meetingId);
  }

  async stopRealtime(userId: string, meetingId: string, options: { final?: boolean } = {}) {
    setCurrentUserId(userId);
    const timer = this.jobs.get(meetingId);
    if (timer) {
      clearInterval(timer);
      this.jobs.delete(meetingId);
    }
    this.logger.log(`[AI Summary] realtime stopped meeting=${meetingId} final=${options.final !== false}`);
    if (options.final !== false) {
      await this.waitForLock(meetingId);
      try {
        const document = this.state.getMeetingDocument(meetingId);
        await this.generateFinal(userId, meetingId, document?.meeting.aiLiveTranscript || '');
      } catch (error: any) {
        this.logger.error(`[AI Summary] final failed meeting=${meetingId}: ${error?.message}`);
      }
    }
  }

  /** 每轮检查：有新内容且达到最少字数才触发增量总结 */
  private async tick(userId: string, meetingId: string) {
    setCurrentUserId(userId);
    if (this.locks.get(meetingId)) return; // 上一个总结还在执行
    let document: MeetingDocument | null = null;
    try {
      document = this.state.getMeetingDocument(meetingId);
      if (!document || document.meeting.status !== 'active') return;
      const newTranscript = await this.collectNewContent(document, meetingId);
      if (newTranscript.trim().length < MIN_TRANSCRIPT_CHARS) {
        // 内容不足：继续积累，保持 waiting
        this.state.updateMeetingAi(meetingId, { aiStatus: 'waiting' });
        return;
      }
      this.logger.log(`[AI Summary] trigger meeting=${meetingId} newChars=${newTranscript.trim().length}`);
      await this.runIncremental(userId, meetingId, document, newTranscript);
    } catch (error: any) {
      this.logger.error(`[AI Summary] tick failed meeting=${meetingId}: ${error?.message}`);
      this.safeStatus(meetingId, 'error', error?.message);
    }
  }

  /** 收集自上次总结以来的新增内容：手动记录 + 已转写录音 + 实时转写尾部 */
  private async collectNewContent(document: MeetingDocument, meetingId: string): Promise<string> {
    const meeting = document.meeting;
    const processedUntil = Number(meeting.aiProcessedUntil) || 0;
    const people = new Map(document.persons.map((person) => [person.id, person.name]));

    const newEntries = document.entries
      .filter((entry) => entry.createdAt > processedUntil)
      .map((entry) => {
        const speaker = entry.speakerId ? people.get(entry.speakerId) || '未知人员' : '会议记录';
        return `[${entry.time}] ${speaker}：${entry.content.slice(0, 800)}`;
      })
      .join('\n');

    let newRecordings = '';
    try {
      const recordings = await this.recordings.list(meetingId);
      newRecordings = recordings
        .filter((recording) => recording.transcript?.trim()
          && (recording.transcribedAt || recording.updatedAt || 0) > processedUntil)
        .map((recording) => {
          const time = new Date(recording.createdAt).toLocaleTimeString('zh-CN', { hour12: false });
          return `[录音 ${time}] ${recording.transcript.trim().slice(0, 4000)}`;
        })
        .join('\n');
    } catch { /* 录音列表异常不阻塞增量总结 */ }

    const live = String(meeting.aiLiveTranscript || '');
    const prevLiveLen = Number(meeting.aiLiveProcessedLen) || 0;
    const newLive = live.slice(prevLiveLen).trim();

    return [newEntries, newRecordings, newLive].filter(Boolean).join('\n');
  }

  /** 增量总结：Previous State + New Transcript -> Updated State */
  private async runIncremental(userId: string, meetingId: string, document: MeetingDocument, newTranscript: string) {
    if (this.locks.get(meetingId)) return;
    this.locks.set(meetingId, true);
    const started = Date.now();
    try {
      this.state.updateMeetingAi(meetingId, { aiStatus: 'summarizing', aiLastError: '' });
      this.broadcast(meetingId, SSE_EVENT_STATUS, { status: 'summarizing' });

      const provider = this.auth.getDefaultAiProvider(userId);
      if (!provider) throw new ServiceUnavailableException('请先配置并设置默认 AI 供应商');
      const previous = this.normalizeState(document.meeting.aiState);
      const messages = [
        { role: 'system', content: this.incrementalSystemPrompt() },
        { role: 'user', content: this.buildIncrementalPrompt(document, previous, newTranscript) },
      ];
      this.logger.log(`[AI Summary] calling DeepSeek meeting=${meetingId} newChars=${newTranscript.trim().length}`);
      const content = await this.callDeepSeek(provider, messages);
      const updated = this.mergeState(previous, this.parseMeetingState(content));

      const now = Date.now();
      const snapshot: AiSummarySnapshot = {
        id: uuid(),
        meeting_id: meetingId,
        current_topic: updated.current_topic,
        latest_summary: updated.latest_summary,
        key_points: updated.key_points,
        decisions: updated.decisions,
        todos: updated.todos,
        open_questions: updated.open_questions,
        participants_views: updated.participants_views,
        created_at: now,
      };
      const snapshots = [...(document.meeting.aiSnapshots || []), snapshot].slice(-SNAPSHOT_LIMIT);
      this.state.updateMeetingAi(meetingId, {
        aiStatus: 'success',
        aiLastError: '',
        aiState: { ...updated, updated_at: now },
        aiSnapshots: snapshots,
        aiProcessedUntil: now,
        aiLiveProcessedLen: String(document.meeting.aiLiveTranscript || '').length,
      });
      this.logger.log(`[AI Summary] success meeting=${meetingId} ms=${Date.now() - started}`);
      this.broadcast(meetingId, SSE_EVENT_UPDATE, {
        status: 'success',
        data: { ...updated, updated_at: now },
        snapshot,
      });
    } catch (error: any) {
      const message = String(error?.message || '未知错误').slice(0, 200);
      this.state.updateMeetingAi(meetingId, { aiStatus: 'error', aiLastError: message });
      this.broadcast(meetingId, SSE_EVENT_ERROR, { status: 'error', message: '本次总结失败，将在下一轮自动重试' });
      this.logger.warn(`[AI Summary] failed meeting=${meetingId} ms=${Date.now() - started} reason=${message}`);
    } finally {
      this.locks.delete(meetingId);
    }
  }

  /** 会议结束后生成最终总结：完整转写 + 会议状态 + 阶段快照 */
  async generateFinal(userId: string, meetingId: string, liveTranscript = ''): Promise<AiMeetingSummary> {
    setCurrentUserId(userId);
    const provider = this.auth.getDefaultAiProvider(userId);
    if (!provider) throw new ServiceUnavailableException('请先配置并设置默认 AI 供应商');
    const document = this.state.getMeetingDocument(meetingId);
    if (!document) throw new NotFoundException('会议不存在');
    const aiState = this.normalizeState(document.meeting.aiState);
    const snapshots = document.meeting.aiSnapshots || [];
    const fullContent = await this.collectFullContent(document, meetingId, liveTranscript);

    this.state.updateMeetingAi(meetingId, { aiStatus: 'summarizing' });
    this.broadcast(meetingId, SSE_EVENT_STATUS, { status: 'summarizing' });
    this.logger.log(`[AI Summary] calling DeepSeek(final) meeting=${meetingId}`);
    const content = await this.callDeepSeek(provider, [
      { role: 'system', content: this.finalSystemPrompt() },
      { role: 'user', content: this.buildFinalPrompt(document, aiState, snapshots, fullContent) },
    ]);
    const final = this.parseFinalSummary(content);
    const now = Date.now();
    const summary: AiMeetingSummary = {
      summary: final.overview,
      keyPoints: final.key_points,
      decisions: final.decisions,
      risks: final.risks,
      nextSteps: final.todos.map((todo) =>
        [todo.owner ? `${todo.owner}：` : '', todo.task, todo.deadline ? `（截止：${todo.deadline}）` : ''].join(''),
      ),
      provider: { id: provider.id, name: provider.name, model: provider.model },
      generatedAt: now,
    };
    this.state.saveAiSummary(meetingId, summary);
    const snapshot: AiSummarySnapshot = {
      id: uuid(),
      meeting_id: meetingId,
      current_topic: '',
      latest_summary: final.overview,
      key_points: final.key_points,
      decisions: final.decisions,
      todos: final.todos,
      open_questions: final.open_questions,
      participants_views: final.participants_views,
      created_at: now,
    };
    this.state.updateMeetingAi(meetingId, {
      aiStatus: 'ended',
      aiLastError: '',
      aiState: { ...aiState, latest_summary: final.overview, updated_at: now },
      aiSnapshots: [...snapshots, snapshot].slice(-SNAPSHOT_LIMIT),
      aiProcessedUntil: now,
      aiLiveProcessedLen: String(document.meeting.aiLiveTranscript || liveTranscript || '').length,
    });
    this.logger.log(`[AI Summary] final success meeting=${meetingId}`);
    this.broadcast(meetingId, SSE_EVENT_FINAL, { status: 'ended', data: final, summary });
    return summary;
  }

  /** 兼容旧调用：POST /ai-summary（非录音页 / 手动生成） */
  async generate(
    userId: string,
    meetingId: string,
    liveTranscriptInput = '',
    mode: 'live' | 'final' = 'final',
  ): Promise<AiMeetingSummary | MeetingAiState> {
    setCurrentUserId(userId);
    if (mode === 'live') {
      await this.updateLiveTranscript(userId, meetingId, liveTranscriptInput);
      const document = this.state.getMeetingDocument(meetingId);
      if (!document) throw new NotFoundException('会议不存在');
      const newTranscript = await this.collectNewContent(document, meetingId);
      if (!newTranscript.trim()) throw new BadRequestException('当前会议还没有新增内容');
      await this.runIncremental(userId, meetingId, document, newTranscript);
      const updated = this.state.getMeetingDocument(meetingId);
      return this.normalizeState(updated?.meeting.aiState);
    }
    return this.generateFinal(userId, meetingId, liveTranscriptInput);
  }

  /** 前端上报最新实时转写 */
  async updateLiveTranscript(userId: string, meetingId: string, transcript: string) {
    setCurrentUserId(userId);
    this.state.updateMeetingAi(meetingId, {
      aiLiveTranscript: String(transcript || '').trim().slice(0, LIVE_TRANSCRIPT_LIMIT),
    });
  }

  /** 获取当前 AI 状态（供前端初始渲染与轮询兜底） */
  getState(userId: string, meetingId: string) {
    setCurrentUserId(userId);
    const document = this.state.getMeetingDocument(meetingId);
    if (!document) throw new NotFoundException('会议不存在');
    const provider = this.auth.getDefaultAiProvider(userId);
    return {
      status: document.meeting.aiStatus || 'idle',
      aiState: document.meeting.aiState || null,
      snapshots: document.meeting.aiSnapshots || [],
      aiSummary: document.meeting.aiSummary || null,
      aiLastError: document.meeting.aiLastError || '',
      provider: provider ? { id: provider.id, name: provider.name, model: provider.model } : null,
    };
  }

  // ==================== SSE ====================

  /** 订阅指定会议的 SSE 事件流（连接建立时调用） */
  subscribe(userId: string, meetingId: string): Subject<any> {
    setCurrentUserId(userId);
    if (!this.state.getMeetingDocument(meetingId)) throw new NotFoundException('会议不存在');
    let subject = this.subjects.get(meetingId);
    if (!subject) {
      subject = new Subject();
      this.subjects.set(meetingId, subject);
    }
    return subject;
  }

  /** 取消订阅（连接断开时调用） */
  unsubscribe(meetingId: string) {
    const subject = this.subjects.get(meetingId);
    if (subject && !subject.observed) this.subjects.delete(meetingId);
  }

  private broadcast(meetingId: string, type: string, data: Record<string, unknown>) {
    const subject = this.subjects.get(meetingId);
    if (subject && subject.observed) subject.next({ type, data });
  }

  // ==================== DeepSeek 调用 ====================

  private async callDeepSeek(
    provider: { name: string; baseUrl: string; model: string; apiKey: string },
    messages: Array<{ role: string; content: string }>,
  ): Promise<string> {
    const endpoint = provider.baseUrl.endsWith('/chat/completions')
      ? provider.baseUrl
      : `${provider.baseUrl}/chat/completions`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: provider.model,
          temperature: 0.2,
          messages,
        }),
        signal: controller.signal,
      });
    } catch (error: any) {
      const reason = error?.name === 'AbortError' ? '请求超时' : '连接失败';
      throw new ServiceUnavailableException(`无法连接默认 AI 供应商「${provider.name}」：${reason}`);
    } finally {
      clearTimeout(timeout);
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const rawDetail = String(payload?.error?.message || payload?.message || `HTTP ${response.status}`);
      const detail = (provider.apiKey ? rawDetail.replaceAll(provider.apiKey, '[redacted]') : rawDetail).slice(0, 240);
      throw new BadGatewayException(`AI 供应商「${provider.name}」请求失败：${detail}`);
    }
    return this.extractContent(payload?.choices?.[0]?.message?.content);
  }

  // ==================== Prompt 构建 ====================

  private incrementalSystemPrompt(): string {
    return `你是一名企业会议 AI 助手。
你的任务不是简单总结会议文本，而是持续理解一场正在进行中的会议。
系统每次会向你提供：
1. Previous Meeting State（上一次更新后的完整会议状态 JSON）
2. New Transcript（自上次总结以来新增的会议内容）

请根据新增会议内容，更新 Previous Meeting State，并输出更新后的完整会议状态 JSON。

重点识别：
- current_topic：当前阶段正在讨论的主题
- latest_summary：最近一段时间发生了什么（只总结新增内容，不是整个会议总结）
- key_points：对整个会议有价值的关键事实（合并重复信息）
- decisions：已经明确确认的会议结论
- todos：行动项（负责人、任务、截止时间）
- open_questions：尚未解决的问题
- participants_views：有实际价值的重要成员观点

规则：
- 不要记录无意义闲聊。
- 不要把普通建议误认为结论；只有明确确认的才放入 decisions。
- 不要把猜测当成事实。
- 不要编造负责人或截止时间；没有明确说出的，owner / deadline 返回空字符串。
- 新内容如果推翻了之前的信息，必须更新旧状态（例如上线时间从周三改为周五，只保留周五，不能同时存在）。
- 相同或近似信息必须合并，不要重复生成。
- 已存在且没有变化的信息尽量保持不变。
- latest_summary 为空时返回空字符串。
- key_points / decisions / open_questions / participants_views 无内容时返回空数组 []。

输出必须严格是合法 JSON，不要输出任何解释文字或 Markdown，结构如下：
{
  "current_topic": "",
  "latest_summary": "",
  "key_points": [],
  "decisions": [],
  "todos": [{"owner": "", "task": "", "deadline": "", "status": "pending"}],
  "open_questions": [],
  "participants_views": []
}`;
  }

  private buildIncrementalPrompt(
    document: MeetingDocument,
    previous: MeetingAiState,
    newTranscript: string,
  ): string {
    return [
      `会议：${document.meeting.title || '未命名会议'}`,
      '',
      'Previous Meeting State:',
      JSON.stringify(previous, null, 2),
      '',
      'New Transcript:',
      newTranscript,
      '',
      '请根据新增会议内容更新 Meeting State。只输出更新后的完整 JSON，不要输出其他内容。',
    ].join('\n');
  }

  private finalSystemPrompt(): string {
    return `你是一名企业会议 AI 助手。会议已经结束，请基于完整的会议材料生成一份高质量的最终会议纪要。
系统会提供：完整会议转写、最后一次实时会议状态、阶段总结快照。
请综合提炼：
- overview：会议概览（2-4 句话，说明会议目标、整体进展与结果）
- core_discussion：核心讨论内容（一段话）
- key_points：关键要点（数组）
- decisions：已确认结论（数组，只保留明确确认的）
- todos：待办事项（负责人、任务、截止时间；未明确的字段用空字符串）
- open_questions：未解决问题（数组）
- risks：风险与阻塞（数组）
- timeline：重要时间节点（数组，形如 "14:00 会议开始，讨论登录功能"）

规则：
- 不要编造未出现的内容；负责人、时间未明确时返回空字符串。
- 输出严格合法 JSON，不要输出解释文字或 Markdown。`;
  }

  private buildFinalPrompt(
    document: MeetingDocument,
    aiState: MeetingAiState,
    snapshots: AiSummarySnapshot[],
    fullContent: string,
  ): string {
    return [
      `会议：${document.meeting.title || '未命名会议'}`,
      `日期：${document.meeting.date || '未设置'}，时间：${document.meeting.startTime || '未设置'} - ${document.meeting.endTime || '未设置'}`,
      `地点：${document.meeting.location || '未设置'}`,
      '',
      '完整会议内容：',
      fullContent,
      '',
      '最后一次实时会议状态：',
      JSON.stringify(aiState, null, 2),
      '',
      '阶段总结快照：',
      JSON.stringify(snapshots.slice(-10), null, 2),
      '',
      '请生成最终会议纪要 JSON。',
    ].join('\n');
  }

  private async collectFullContent(
    document: MeetingDocument,
    meetingId: string,
    liveTranscript: string,
  ): Promise<string> {
    const people = new Map(document.persons.map((person) => [person.id, person.name]));
    const records = document.entries.slice(-200).map((entry, index) => {
      const speaker = entry.speakerId ? people.get(entry.speakerId) || '未知人员' : '会议记录';
      const topic = entry.topic ? `；主题：${entry.topic}` : '';
      return `${index + 1}. [${entry.time}] ${speaker}${topic}：${entry.content.slice(0, 800)}`;
    }).join('\n').slice(-24_000);
    let audioRecords = '';
    try {
      const recordings = await this.recordings.list(meetingId);
      audioRecords = recordings
        .filter((recording) => recording.transcript?.trim())
        .map((recording) => {
          const time = new Date(recording.createdAt).toLocaleString('zh-CN', { hour12: false });
          return `- [${time}] ${recording.transcript.trim().slice(0, 8000)}`;
        })
        .join('\n')
        .slice(-30_000);
    } catch { /* 忽略 */ }
    const live = String(liveTranscript || document.meeting.aiLiveTranscript || '').trim();
    return [
      '会议记录：',
      records || '无',
      '',
      '录音转写：',
      audioRecords || '无',
      live ? `\n实时转写：\n${live.slice(0, 30_000)}` : '',
    ].join('\n');
  }

  // ==================== 解析 / 去重 ====================

  private extractContent(content: unknown): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content.map((part) => typeof part === 'string' ? part : String(part?.text || '')).join('');
    }
    throw new BadGatewayException('AI 供应商返回了无法识别的内容');
  }

  private extractJson(content: string): any {
    const cleaned = String(content || '').trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '');
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end < start) throw new BadGatewayException('AI 返回内容不是有效的 JSON');
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      throw new BadGatewayException('AI 返回的 JSON 无法解析');
    }
  }

  private parseMeetingState(content: string): MeetingAiState {
    const parsed = this.extractJson(content);
    const strings = (value: unknown) => Array.isArray(value)
      ? value.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 20)
      : [];
    const todos = Array.isArray(parsed.todos)
      ? parsed.todos.map((item: any) => ({
        owner: String(item?.owner || '').trim().slice(0, 30),
        task: String(item?.task || '').trim().slice(0, 200),
        deadline: String(item?.deadline || '').trim().slice(0, 50),
        status: item?.status === 'done' ? 'done' as const : 'pending' as const,
      })).filter((todo: { task: string }) => todo.task).slice(0, 30)
      : [];
    return {
      current_topic: String(parsed.current_topic || '').trim().slice(0, 120),
      latest_summary: String(parsed.latest_summary || '').trim().slice(0, 2000),
      key_points: strings(parsed.key_points),
      decisions: strings(parsed.decisions),
      todos,
      open_questions: strings(parsed.open_questions),
      participants_views: strings(parsed.participants_views),
      updated_at: Date.now(),
    };
  }

  private parseFinalSummary(content: string) {
    const parsed = this.extractJson(content);
    const strings = (value: unknown) => Array.isArray(value)
      ? value.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 20)
      : [];
    const todos = Array.isArray(parsed.todos)
      ? parsed.todos.map((item: any) => ({
        owner: String(item?.owner || '').trim().slice(0, 30),
        task: String(item?.task || '').trim().slice(0, 200),
        deadline: String(item?.deadline || '').trim().slice(0, 50),
        status: item?.status === 'done' ? 'done' as const : 'pending' as const,
      })).filter((todo: { task: string }) => todo.task).slice(0, 30)
      : [];
    return {
      overview: String(parsed.overview || '').trim().slice(0, 4000),
      core_discussion: String(parsed.core_discussion || '').trim().slice(0, 4000),
      key_points: strings(parsed.key_points),
      decisions: strings(parsed.decisions),
      todos,
      open_questions: strings(parsed.open_questions),
      participants_views: strings(parsed.participants_views),
      risks: strings(parsed.risks),
      timeline: strings(parsed.timeline),
    };
  }

  private normalizeState(input?: MeetingAiState | null): MeetingAiState {
    if (!input || typeof input !== 'object') {
      return {
        current_topic: '',
        latest_summary: '',
        key_points: [],
        decisions: [],
        todos: [],
        open_questions: [],
        participants_views: [],
        updated_at: 0,
      };
    }
    return {
      current_topic: String(input.current_topic || ''),
      latest_summary: String(input.latest_summary || ''),
      key_points: this.dedupStrings(input.key_points),
      decisions: this.dedupStrings(input.decisions),
      todos: this.dedupTodos(input.todos),
      open_questions: this.dedupStrings(input.open_questions),
      participants_views: this.dedupStrings(input.participants_views),
      updated_at: Number(input.updated_at) || 0,
    };
  }

  /** 基础去重 + 防止模型误删已有信息：列表为空时保留上一次的值 */
  private mergeState(previous: MeetingAiState, updated: MeetingAiState): MeetingAiState {
    const keepIfEmpty = (value: string[], fallback: string[]) => value.length ? this.dedupStrings(value) : this.dedupStrings(fallback);
    const todos = updated.todos.length ? this.dedupTodos(updated.todos) : this.dedupTodos(previous.todos);
    return {
      current_topic: updated.current_topic || previous.current_topic,
      latest_summary: updated.latest_summary || previous.latest_summary,
      key_points: keepIfEmpty(updated.key_points, previous.key_points),
      decisions: keepIfEmpty(updated.decisions, previous.decisions),
      todos,
      // 问题被解决 / 观点变化允许清空，尊重模型输出
      open_questions: this.dedupStrings(updated.open_questions),
      participants_views: this.dedupStrings(updated.participants_views),
      updated_at: Date.now(),
    };
  }

  private dedupStrings(value: unknown): string[] {
    const seen = new Set<string>();
    return (Array.isArray(value) ? value : [])
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .filter((item) => {
        const key = item.toLocaleLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 20);
  }

  private dedupTodos(value: unknown): MeetingAiState['todos'] {
    const seen = new Set<string>();
    return (Array.isArray(value) ? value : [])
      .map((item: any) => ({
        owner: String(item?.owner || '').trim().slice(0, 30),
        task: String(item?.task || '').trim().slice(0, 200),
        deadline: String(item?.deadline || '').trim().slice(0, 50),
        status: item?.status === 'done' ? 'done' as const : 'pending' as const,
      }))
      .filter((todo) => todo.task)
      .filter((todo) => {
        const key = `${todo.owner}|${todo.task.toLocaleLowerCase()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 30);
  }

  /** 等待正在执行的总结任务结束（最多等 120 秒） */
  private async waitForLock(meetingId: string) {
    const deadline = Date.now() + 120_000;
    while (this.locks.get(meetingId) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  private safeStatus(meetingId: string, status: string, error?: string) {
    try {
      this.state.updateMeetingAi(meetingId, { aiStatus: status as any, aiLastError: String(error || '').slice(0, 200) });
    } catch { /* 会议可能已被删除 */ }
  }
}
