import { Body, Controller, Delete, Get, Param, Post, Req, Res, StreamableFile } from '@nestjs/common';
import type { Request, Response } from 'express';
import { RecordingService } from './recording.service';

@Controller('api/meetings/:meetingId/recordings')
export class RecordingController {
  constructor(private readonly recordings: RecordingService) {}

  @Post('start')
  start(@Param('meetingId') meetingId: string, @Body() body: { mimeType?: string }) {
    return this.recordings.start(meetingId, body?.mimeType);
  }

  @Post(':id/chunks')
  append(@Param('meetingId') meetingId: string, @Param('id') id: string, @Req() request: Request) {
    return this.recordings.append(meetingId, id, request.body as unknown as Buffer);
  }

  @Post(':id/finish')
  finish(@Param('meetingId') meetingId: string, @Param('id') id: string, @Body() body: { duration?: number; transcript?: string }) {
    return this.recordings.finish(meetingId, id, body?.duration, body?.transcript);
  }

  @Get('latest')
  latest(@Param('meetingId') meetingId: string) { return this.recordings.latest(meetingId); }

  @Get()
  list(@Param('meetingId') meetingId: string) { return this.recordings.list(meetingId); }

  @Post(':id/transcribe')
  transcribe(@Param('meetingId') meetingId: string, @Param('id') id: string, @Body() body: { force?: boolean }) {
    return this.recordings.transcribe(meetingId, id, Boolean(body?.force));
  }

  @Get(':id/audio')
  async audio(@Param('meetingId') meetingId: string, @Param('id') id: string, @Res({ passthrough: true }) response: Response) {
    const result = await this.recordings.open(meetingId, id);
    response.set({ 'Content-Type': result.info.mimeType, 'Content-Length': String(result.info.size), 'Content-Disposition': `inline; filename="${id}.${result.info.extension}"` });
    return new StreamableFile(result.stream);
  }

  @Delete(':id')
  remove(@Param('meetingId') meetingId: string, @Param('id') id: string) { return this.recordings.remove(meetingId, id); }
}
