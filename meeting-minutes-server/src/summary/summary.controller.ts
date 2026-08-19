import {
  Body, Controller, Get, Param, Post, Query, Req, Sse, UnauthorizedException,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { SummaryService } from './summary.service';
import { AuthService } from '../auth/auth.service';
import { Public } from '../auth/public.decorator';
import { setCurrentUserId } from '../auth/request-context';

@Controller('api/meetings/:meetingId/ai-summary')
export class SummaryController {
  constructor(
    private readonly summary: SummaryService,
    private readonly auth: AuthService,
  ) {}

  /** 手动生成总结（非录音页兼容入口；mode=live 走增量，mode=final 走最终总结） */
  @Post()
  generate(
    @Req() request: any,
    @Param('meetingId') meetingId: string,
    @Body() body: { liveTranscript?: string; mode?: 'live' | 'final' },
  ) {
    return this.summary.generate(request.user.id, meetingId, body?.liveTranscript, body?.mode);
  }

  /** 获取当前 AI 会议状态 + 快照历史（初始渲染 / 轮询兜底） */
  @Get('state')
  getState(@Req() request: any, @Param('meetingId') meetingId: string) {
    return this.summary.getState(request.user.id, meetingId);
  }

  /** 前端通知实时总结开启 / 关闭（录音开始 / 停止 / 会议结束） */
  @Post('realtime')
  setRealtime(
    @Req() request: any,
    @Param('meetingId') meetingId: string,
    @Body() body: { active?: boolean; final?: boolean },
  ) {
    return this.summary.setRealtime(request.user.id, meetingId, Boolean(body?.active), body?.final !== false);
  }

  /** 前端周期性上报最新实时转写（增量总结的输入之一） */
  @Post('live')
  updateLive(
    @Req() request: any,
    @Param('meetingId') meetingId: string,
    @Body() body: { liveTranscript?: string },
  ) {
    return this.summary.updateLiveTranscript(request.user.id, meetingId, body?.liveTranscript || '');
  }

  /**
   * SSE 实时推送流（EventSource 无法携带 Header，鉴权走 query token）
   * 事件：summary_status / summary_update / summary_error / summary_final
   */
  @Public()
  @Sse('stream')
  stream(
    @Param('meetingId') meetingId: string,
    @Query('token') token: string,
  ): Observable<any> {
    const user = this.auth.authenticate(String(token || ''));
    if (!user) throw new UnauthorizedException('登录已失效，请重新登录');
    setCurrentUserId(user.id);
    const subject = this.summary.subscribe(user.id, meetingId);
    return new Observable((subscriber) => {
      const subscription = subject.subscribe(subscriber);
      return () => {
        subscription.unsubscribe();
        this.summary.unsubscribe(meetingId);
      };
    });
  }
}
