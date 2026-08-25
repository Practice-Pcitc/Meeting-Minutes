import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { promises as fs, createReadStream } from 'fs';
import * as path from 'path';
import { v4 as uuid } from 'uuid';
import { getCurrentUserId } from '../auth/request-context';
import { AuthService } from '../auth/auth.service';
import { StateService } from '../state/state.service';

export interface TranscriptSegment {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  timingSource: 'estimated' | 'asr';
  speakerClusterId?: string;
}

export interface SpeakerAssignment {
  id: string;
  targetType: 'segment' | 'cluster';
  targetId: string;
  personId: string;
  source: 'manual-anchor' | 'diarization' | 'propagated' | 'user-confirmed';
  confidence?: number;
  createdAt: number;
  updatedAt: number;
}

export interface RecordingInfo {
  id: string;
  meetingId: string;
  mimeType: string;
  extension: string;
  size: number;
  createdAt: number;
  updatedAt: number;
  completed: boolean;
  duration?: number;
  transcript?: string;
  transcriptSegments?: TranscriptSegment[];
  speakerAssignments?: SpeakerAssignment[];
  transcribedAt?: number;
}

@Injectable()
export class RecordingService {
  constructor(
    private readonly auth: AuthService,
    private readonly state: StateService,
  ) {}
  private readonly root = path.join(process.cwd(), 'data', 'recordings');
  private queues = new Map<string, Promise<void>>();
  private transcriptionQueues = new Map<string, Promise<RecordingInfo>>();
  private metadataQueues = new Map<string, Promise<void>>();

  private safe(value: string, label: string) {
    if (!value || !/^[a-zA-Z0-9_-]+$/.test(value)) throw new BadRequestException(`${label}无效`);
    return value;
  }
  private directory(meetingId: string) {
    const userId = this.safe(getCurrentUserId(), '用户');
    return path.join(this.root, userId, this.safe(meetingId, '会议 ID'));
  }
  private metadataPath(meetingId: string, id: string) {
    return path.join(this.directory(meetingId), `${this.safe(id, '录音 ID')}.json`);
  }
  private splitTranscript(text: string) {
    const normalized = String(text || '').trim();
    if (!normalized) return [];
    return (normalized.match(/[^。！？!?；;，,\n]+(?:[。！？!?；;，,]+|$)/g) || [normalized])
      .map((part) => part.trim())
      .filter(Boolean);
  }
  private estimatedSegments(info: Pick<RecordingInfo, 'id' | 'duration'>, text: string): TranscriptSegment[] {
    const sentences = this.splitTranscript(text);
    const totalUnits = Math.max(1, sentences.reduce((sum, sentence) => sum + sentence.length, 0));
    const durationMs = Math.max(0, Number(info.duration) || 0) * 1000;
    let consumedUnits = 0;
    return sentences.map((sentence, index) => {
      const startMs = Math.round(durationMs * consumedUnits / totalUnits);
      consumedUnits += sentence.length;
      return {
        id: `${info.id}:estimated:${index}`,
        text: sentence,
        startMs,
        endMs: Math.round(durationMs * consumedUnits / totalUnits),
        timingSource: 'estimated',
      };
    });
  }
  private resultSegments(info: RecordingInfo, text: string, result?: any): TranscriptSegment[] {
    const sentenceInfo = Array.isArray(result?.sentence_info) ? result.sentence_info : [];
    const fromFunAsr = sentenceInfo
      .map((segment: any, index: number) => ({
        id: `${info.id}:asr:${index}`,
        text: String(segment?.text || '').trim(),
        startMs: Math.max(0, Math.round(Number(segment?.start) || 0)),
        endMs: Math.max(0, Math.round(Number(segment?.end) || 0)),
        timingSource: 'asr' as const,
        ...(segment?.spk !== undefined && segment?.spk !== null ? { speakerClusterId: String(segment.spk) } : {}),
      }))
      .filter((segment: TranscriptSegment) => segment.text && segment.endMs >= segment.startMs);
    if (fromFunAsr.length) return fromFunAsr;

    const verboseSegments = Array.isArray(result?.segments) ? result.segments : [];
    const fromVerboseResult = verboseSegments
      .map((segment: any, index: number) => ({
        id: `${info.id}:asr:${index}`,
        text: String(segment?.text || '').trim(),
        startMs: Math.max(0, Math.round((Number(segment?.start) || 0) * 1000)),
        endMs: Math.max(0, Math.round((Number(segment?.end) || 0) * 1000)),
        timingSource: 'asr' as const,
        ...(segment?.speaker !== undefined && segment?.speaker !== null ? { speakerClusterId: String(segment.speaker) } : {}),
      }))
      .filter((segment: TranscriptSegment) => segment.text && segment.endMs >= segment.startMs);
    return fromVerboseResult.length ? fromVerboseResult : this.estimatedSegments(info, text);
  }
  private normalizeInfo(raw: RecordingInfo): RecordingInfo {
    const info = { ...raw };
    info.speakerAssignments = Array.isArray(info.speakerAssignments) ? info.speakerAssignments : [];
    if ((!Array.isArray(info.transcriptSegments) || !info.transcriptSegments.length) && info.transcript) {
      info.transcriptSegments = this.estimatedSegments(info, info.transcript);
    }
    return info;
  }
  private async readInfo(meetingId: string, id: string): Promise<RecordingInfo> {
    try { return this.normalizeInfo(JSON.parse(await fs.readFile(this.metadataPath(meetingId, id), 'utf8'))); }
    catch { throw new NotFoundException('录音不存在'); }
  }

  async start(meetingId: string, mimeType = 'audio/webm') {
    const id = uuid();
    const extension = mimeType.includes('mp4') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : 'webm';
    const dir = this.directory(meetingId);
    await fs.mkdir(dir, { recursive: true });
    const now = Date.now();
    const info: RecordingInfo = { id, meetingId, mimeType, extension, size: 0, createdAt: now, updatedAt: now, completed: false, transcriptSegments: [], speakerAssignments: [] };
    await fs.writeFile(path.join(dir, `${id}.${extension}.part`), Buffer.alloc(0));
    await fs.writeFile(this.metadataPath(meetingId, id), JSON.stringify(info, null, 2));
    return info;
  }

  async append(meetingId: string, id: string, chunk: Buffer) {
    if (!Buffer.isBuffer(chunk) || !chunk.length) throw new BadRequestException('录音分片为空');
    if (chunk.length > 5 * 1024 * 1024) throw new BadRequestException('录音分片过大');
    const key = `${getCurrentUserId()}:${meetingId}:${id}`;
    const operation = (this.queues.get(key) || Promise.resolve()).then(async () => {
      const info = await this.readInfo(meetingId, id);
      if (info.completed) throw new BadRequestException('录音已经结束');
      await fs.appendFile(path.join(this.directory(meetingId), `${id}.${info.extension}.part`), chunk);
      info.size += chunk.length;
      info.updatedAt = Date.now();
      await fs.writeFile(this.metadataPath(meetingId, id), JSON.stringify(info, null, 2));
    });
    this.queues.set(key, operation.finally(() => this.queues.delete(key)));
    await operation;
    return { saved: true };
  }

  async finish(meetingId: string, id: string, duration?: number, transcriptInput?: string) {
    const key = `${getCurrentUserId()}:${meetingId}:${id}`;
    await this.queues.get(key);
    const info = await this.readInfo(meetingId, id);
    if (!info.completed) {
      const dir = this.directory(meetingId);
      await fs.rename(path.join(dir, `${id}.${info.extension}.part`), path.join(dir, `${id}.${info.extension}`));
      info.completed = true;
      if (Number.isFinite(duration) && Number(duration) >= 0) info.duration = Math.round(Number(duration));
      const transcript = String(transcriptInput || '').trim();
      if (transcript) {
        info.transcript = transcript;
        info.transcriptSegments = this.resultSegments(info, transcript);
        info.transcribedAt = Date.now();
      }
      info.updatedAt = Date.now();
      await fs.writeFile(this.metadataPath(meetingId, id), JSON.stringify(info, null, 2));
    }
    return info;
  }

  async latest(meetingId: string) {
    const dir = this.directory(meetingId);
    try {
      const files = (await fs.readdir(dir)).filter(name => name.endsWith('.json'));
      const infos = await Promise.all(files.map(name => fs.readFile(path.join(dir, name), 'utf8').then(JSON.parse)));
      return (infos as RecordingInfo[]).map(info => this.normalizeInfo(info)).filter(item => item.completed).sort((a, b) => b.updatedAt - a.updatedAt)[0] || null;
    } catch { return null; }
  }

  async list(meetingId: string) {
    const dir = this.directory(meetingId);
    try {
      const files = (await fs.readdir(dir)).filter(name => name.endsWith('.json'));
      const infos = await Promise.all(files.map(name => fs.readFile(path.join(dir, name), 'utf8').then(JSON.parse)));
      return (infos as RecordingInfo[]).map(info => this.normalizeInfo(info))
        .filter(item => item.completed)
        .sort((a, b) => a.createdAt - b.createdAt);
    } catch { return []; }
  }

  async open(meetingId: string, id: string) {
    const info = await this.readInfo(meetingId, id);
    if (!info.completed) throw new BadRequestException('录音尚未结束');
    return { info, stream: createReadStream(path.join(this.directory(meetingId), `${id}.${info.extension}`)) };
  }

  async transcribe(meetingId: string, id: string, force = false) {
    const key = `${getCurrentUserId()}:${meetingId}:${id}`;
    const existing = this.transcriptionQueues.get(key);
    if (existing) return existing;
    const operation = this.performTranscription(meetingId, id, force).finally(() => this.transcriptionQueues.delete(key));
    this.transcriptionQueues.set(key, operation);
    return operation;
  }

  async assignSpeaker(meetingId: string, id: string, clusterIdInput: string, personId: string | null, manual = true) {
    return this.withMetadataQueue(meetingId, id, () => (
      this.performSpeakerAssignment(meetingId, id, clusterIdInput, personId, manual)
    ));
  }

  private async withMetadataQueue<T>(meetingId: string, id: string, action: () => Promise<T>) {
    const key = `${getCurrentUserId()}:${meetingId}:${id}`;
    const previous = this.metadataQueues.get(key) || Promise.resolve();
    const operation = previous
      .catch(() => undefined)
      .then(action);
    const tail = operation.then(() => undefined, () => undefined);
    this.metadataQueues.set(key, tail);
    try {
      return await operation;
    } finally {
      if (this.metadataQueues.get(key) === tail) this.metadataQueues.delete(key);
    }
  }

  private async performSpeakerAssignment(meetingId: string, id: string, clusterIdInput: string, personId: string | null, manual: boolean) {
    const info = await this.readInfo(meetingId, id);
    const clusterId = String(clusterIdInput || '').trim();
    if (!clusterId || clusterId.length > 100) throw new BadRequestException('说话人编号无效');
    const hasCluster = (info.transcriptSegments || [])
      .some(segment => segment.speakerClusterId != null && String(segment.speakerClusterId) === clusterId);
    if (!hasCluster) throw new BadRequestException('录音中不存在该说话人编号');

    if (personId) {
      const meeting = this.state.getMeetingDocument(meetingId);
      if (!meeting) throw new NotFoundException('会议不存在');
      if (!meeting.persons.some(person => person.id === personId)) {
        throw new BadRequestException('参会人员不存在');
      }
    }

    const now = Date.now();
    const hasManualAssignment = (info.speakerAssignments || []).some(assignment => (
      assignment.targetType === 'cluster'
      && assignment.targetId === clusterId
      && assignment.source === 'user-confirmed'
    ));
    if (!manual && hasManualAssignment) return info;

    const assignments = (info.speakerAssignments || []).filter(assignment => !(
      assignment.targetType === 'cluster'
      && assignment.targetId === clusterId
      && (assignment.source === 'user-confirmed' || assignment.source === 'propagated')
    ));
    if (personId || manual) {
      assignments.push({
        id: uuid(),
        targetType: 'cluster',
        targetId: clusterId,
        personId: personId || '',
        source: manual ? 'user-confirmed' : 'propagated',
        createdAt: now,
        updatedAt: now,
      });
    }
    info.speakerAssignments = assignments;
    info.updatedAt = now;
    await fs.writeFile(this.metadataPath(meetingId, id), JSON.stringify(info, null, 2));
    return info;
  }

  private async performTranscription(meetingId: string, id: string, force: boolean) {
    const info = await this.readInfo(meetingId, id);
    if (!info.completed) throw new BadRequestException('录音尚未结束');
    if (info.transcript && !force) return info;
    const preferences = this.auth.getUser(getCurrentUserId())?.preferences;
    const provider = preferences?.transcriptionProvider || 'funasr';
    const file = await fs.readFile(path.join(this.directory(meetingId), `${id}.${info.extension}`));
    const form = new FormData();
    form.append('file', new Blob([file], { type: info.mimeType }), `${id}.${info.extension}`);
    form.append('model', provider === 'funasr' ? (process.env.FUNASR_TRANSCRIBE_MODEL || 'paraformer-zh') : (process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe'));
    form.append('response_format', provider === 'funasr' ? 'verbose_json' : 'json');
    if (provider === 'funasr') {
      form.append('spk', 'true');
      form.append('timestamp_granularities', 'segment');
    }
    if (provider === 'openai' && process.env.OPENAI_TRANSCRIBE_LANGUAGE) form.append('language', process.env.OPENAI_TRANSCRIBE_LANGUAGE);
    const apiKey = process.env.OPENAI_API_KEY;
    if (provider === 'openai' && !apiKey) throw new ServiceUnavailableException('服务器尚未配置 OPENAI_API_KEY');
    const endpoint = provider === 'funasr' ? (preferences?.funasrEndpoint || process.env.FUNASR_TRANSCRIBE_ENDPOINT || 'http://127.0.0.1:10095/v1/audio/transcriptions') : 'https://api.openai.com/v1/audio/transcriptions';
    let response: Response;
    try {
      response = await fetch(endpoint, { method: 'POST', headers: provider === 'openai' ? { Authorization: `Bearer ${apiKey}` } : {}, body: form });
    } catch {
      throw new ServiceUnavailableException(provider === 'funasr' ? '无法连接本地 FunASR 服务，请检查服务地址和运行状态' : '无法连接 OpenAI 转写服务');
    }
    const result: any = await response.json().catch(() => null);
    if (!response.ok) throw new ServiceUnavailableException(result?.error?.message || result?.message || `语音转写失败（${response.status}）`);
    return this.withMetadataQueue(meetingId, id, async () => {
      const latest = await this.readInfo(meetingId, id);
      latest.transcript = String(result?.text || '').trim();
      latest.transcriptSegments = this.resultSegments(latest, latest.transcript, result);
      latest.transcribedAt = Date.now();
      latest.updatedAt = Date.now();
      await fs.writeFile(this.metadataPath(meetingId, id), JSON.stringify(latest, null, 2));
      return latest;
    });
  }

  async remove(meetingId: string, id: string) {
    const info = await this.readInfo(meetingId, id);
    const dir = this.directory(meetingId);
    await Promise.all([
      fs.rm(path.join(dir, `${id}.${info.extension}`), { force: true }),
      fs.rm(path.join(dir, `${id}.${info.extension}.part`), { force: true }),
      fs.rm(this.metadataPath(meetingId, id), { force: true }),
    ]);
    return { deleted: true };
  }
}
