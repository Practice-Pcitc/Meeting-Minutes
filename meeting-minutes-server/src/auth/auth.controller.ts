import { Body, Controller, Get, Post, Req } from '@nestjs/common';
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

  @Post('logout')
  async logout(@Req() request: any) {
    await this.auth.logout(request.authToken);
    return { success: true };
  }
}
