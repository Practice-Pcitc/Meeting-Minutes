import { Controller, Param, Post, Req } from '@nestjs/common';
import { SummaryService } from './summary.service';

@Controller('api/meetings/:meetingId/ai-summary')
export class SummaryController {
  constructor(private readonly summary: SummaryService) {}

  @Post()
  generate(@Req() request: any, @Param('meetingId') meetingId: string) {
    return this.summary.generate(request.user.id, meetingId);
  }
}
