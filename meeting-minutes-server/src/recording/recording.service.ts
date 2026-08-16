import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { promises as fs, createReadStream } from 'fs';
import * as path from 'path';
import { v4 as uuid } from 'uuid';
import { getCurrentUserId } from '../auth/request-context';

export interface RecordingInfo {
  id: string;
  meetingId: string;
  mimeType: string;
  extension: string;
  size: number;
  createdAt: number;
  updatedAt: number;
  completed: boolean;
}

@Injectable()
export class RecordingService {
  private readonly root = path.join(process.cwd(), 'data', 'recordings');
  private queues = new Map<string, Promise<void>>();

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

  async finish(meetingId: string, id: string) {
    const key = `${getCurrentUserId()}:${meetingId}:${id}`;
    await this.queues.get(key);
    const info = await this.readInfo(meetingId, id);
    if (!info.completed) {
      const dir = this.directory(meetingId);
      await fs.rename(path.join(dir, `${id}.${info.extension}.part`), path.join(dir, `${id}.${info.extension}`));
      info.completed = true;
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

  async open(meetingId: string, id: string) {
    const info = await this.readInfo(meetingId, id);
    if (!info.completed) throw new BadRequestException('录音尚未结束');
    return { info, stream: createReadStream(path.join(this.directory(meetingId), `${id}.${info.extension}`)) };
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
