import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { raw } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn'],
  });
  app.use('/api/meetings/:meetingId/recordings/:id/chunks', raw({ type: 'application/octet-stream', limit: '5mb' }));
  // 允许前端跨域访问
  app.enableCors({
    origin: true,
    credentials: true,
  });

  const port = Number(process.env.PORT) || 3000;
  await app.listen(port, '0.0.0.0');
  Logger.log(`Meeting Minutes API listening on http://localhost:${port}`, 'Bootstrap');
}

bootstrap();
