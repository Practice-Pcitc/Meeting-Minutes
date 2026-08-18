import { Module } from '@nestjs/common';
import { RecordingController } from './recording.controller';
import { RecordingService } from './recording.service';
import { AuthModule } from '../auth/auth.module';
import { StateModule } from '../state/state.module';

@Module({ imports: [AuthModule, StateModule], controllers: [RecordingController], providers: [RecordingService] })
export class RecordingModule {}
