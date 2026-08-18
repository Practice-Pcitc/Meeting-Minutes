import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Public } from './public.decorator';
import { UserPreferences } from './auth.types';

@Controller('api/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  register(@Body() body: { username?: string; password?: string; displayName?: string }) {
    return this.auth.register(body?.username || '', body?.password || '', body?.displayName);
  }

  @Public()
  @Post('login')
  login(@Body() body: { username?: string; password?: string }) {
    return this.auth.login(body?.username || '', body?.password || '');
  }

  @Get('me')
  me(@Req() request: any) {
    return request.user;
  }

  @Post('preferences')
  preferences(@Req() request: any, @Body() body: Partial<UserPreferences>) {
    return this.auth.updatePreferences(request.user.id, body || {});
  }

  @Post('ai-providers')
  createAiProvider(@Req() request: any, @Body() body: { name?: string; baseUrl?: string; model?: string; apiKey?: string }) {
    return this.auth.createAiProvider(request.user.id, body || {});
  }

  @Patch('ai-providers/:id')
  updateAiProvider(
    @Req() request: any,
    @Param('id') id: string,
    @Body() body: { name?: string; baseUrl?: string; model?: string; apiKey?: string },
  ) {
    return this.auth.updateAiProvider(request.user.id, id, body || {});
  }

  @Delete('ai-providers/:id')
  deleteAiProvider(@Req() request: any, @Param('id') id: string) {
    return this.auth.deleteAiProvider(request.user.id, id);
  }

  @Post('ai-providers/:id/default')
  setDefaultAiProvider(@Req() request: any, @Param('id') id: string) {
    return this.auth.setDefaultAiProvider(request.user.id, id);
  }

  @Post('logout')
  async logout(@Req() request: any) {
    await this.auth.logout(request.authToken);
    return { success: true };
  }
}
