import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { promises as fs, createReadStream } from 'fs';
import * as path from 'path';
import { v4 as uuid } from 'uuid';
import { getCurrentUserId } from '../auth/request-context';
import { AuthService } from '../auth/auth.service';

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
  transcribedAt?: number;
}

@Injectable()
export class RecordingService {
  constructor(private readonly auth: AuthService) {}
  private readonly root = path.join(process.cwd(), 'data', 'recordings');
  private queues = new Map<string, Promise<void>>();
  private transcriptionQueues = new Map<string, Promise<RecordingInfo>>();

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
  private async readInfo(meetingId: string, id: string): Promise<RecordingInfo> {
    try { return JSON.parse(await fs.readFile(this.metadataPath(meetingId, id), 'utf8')); }
    catch { throw new NotFoundException('录音不存在'); }
  }

  async start(meetingId: string, mimeType = 'audio/webm') {
    const id = uuid();
    const extension = mimeType.includes('mp4') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : 'webm';
    const dir = this.directory(meetingId);
    await fs.mkdir(dir, { recursive: true });
    const now = Date.now();
    const info: RecordingInfo = { id, meetingId, mimeType, extension, size: 0, createdAt: now, updatedAt: now, completed: false };
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
      return (infos as RecordingInfo[]).filter(item => item.completed).sort((a, b) => b.updatedAt - a.updatedAt)[0] || null;
    } catch { return null; }
  }

  async list(meetingId: string) {
    const dir = this.directory(meetingId);
    try {
      const files = (await fs.readdir(dir)).filter(name => name.endsWith('.json'));
      const infos = await Promise.all(files.map(name => fs.readFile(path.join(dir, name), 'utf8').then(JSON.parse)));
      return (infos as RecordingInfo[])
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
    form.append('response_format', 'json');
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
    info.transcript = String(result?.text || '').trim();
    info.transcribedAt = Date.now();
    await fs.writeFile(this.metadataPath(meetingId, id), JSON.stringify(info, null, 2));
    return info;
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
