import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StateModule } from '../state/state.module';
import { SummaryController } from './summary.controller';
import { SummaryService } from './summary.service';

@Module({
  imports: [AuthModule, StateModule],
  controllers: [SummaryController],
  providers: [SummaryService],
})
export class SummaryModule {}
