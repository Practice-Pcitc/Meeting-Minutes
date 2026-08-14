import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { StateModule } from './state/state.module';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './auth/auth.guard';

@Module({
  imports: [AuthModule, StateModule],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
