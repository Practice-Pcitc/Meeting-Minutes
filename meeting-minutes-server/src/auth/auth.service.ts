import { BadRequestException, Injectable, Logger, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'crypto';
import { promisify } from 'util';
import { v4 as uuid } from 'uuid';
import {
  AiProviderPublic, AuthStore, AuthUser, StoredAiProvider, StoredUser,
  StoredUserPreferences, UserPreferences,
} from './auth.types';

const scrypt = promisify(scryptCallback);
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger('AuthService');
  private readonly dataFile = path.join(process.cwd(), 'data', 'auth.json');
  private store: AuthStore = { users: [], sessions: [] };
  private writeQueue: Promise<void> = Promise.resolve();

  async onModuleInit() {
    try {
      const raw = JSON.parse(await fs.readFile(this.dataFile, 'utf-8'));
      this.store.users = Array.isArray(raw?.users) ? raw.users.map((user: StoredUser) => ({
        ...user,
        preferences: this.normalizeStoredPreferences(user.preferences),
      })) : [];
      this.store.sessions = Array.isArray(raw?.sessions) ? raw.sessions : [];
      this.removeExpiredSessions();
      this.logger.log(`Loaded ${this.store.users.length} users`);
    } catch (error: any) {
      if (error.code !== 'ENOENT') this.logger.error(`Failed to load auth data: ${error.message}`);
      await this.persist();
    }
  }

  async register(usernameInput: string, password: string, displayNameInput?: string) {
    const username = this.normalizeUsername(usernameInput);
    const displayName = (displayNameInput || username).trim();
    this.validateRegistration(username, password, displayName);
    if (this.store.users.some((user) => user.username === username)) {
      throw new BadRequestException('该用户名已被使用');
    }

    const passwordSalt = randomBytes(16).toString('hex');
    const passwordHash = await this.hashPassword(password, passwordSalt);
    if (this.store.users.some((user) => user.username === username)) {
      throw new BadRequestException('该用户名已被使用');
    }
    const user: StoredUser = {
      id: uuid(), username, displayName, passwordHash, passwordSalt, createdAt: Date.now(), preferences: this.defaultStoredPreferences(),
    };
    this.store.users.push(user);
    const token = this.createSession(user.id);
    await this.persist();
    return { token, user: this.toPublicUser(user) };
  }

  async login(usernameInput: string, password: string) {
    const username = this.normalizeUsername(usernameInput);
    const user = this.store.users.find((item) => item.username === username);
    if (!user || !(await this.passwordMatches(password || '', user))) {
      throw new UnauthorizedException('用户名或密码错误');
    }
    const token = this.createSession(user.id);
    await this.persist();
    return { token, user: this.toPublicUser(user) };
  }

  authenticate(token: string): AuthUser | null {
    if (!token) return null;
    this.removeExpiredSessions();
    const tokenHash = this.hashToken(token);
    const session = this.store.sessions.find((item) => item.tokenHash === tokenHash);
    if (!session) return null;
    const user = this.store.users.find((item) => item.id === session.userId);
    return user ? this.toPublicUser(user) : null;
  }

  async logout(token: string) {
    const tokenHash = this.hashToken(token);
    this.store.sessions = this.store.sessions.filter((item) => item.tokenHash !== tokenHash);
    await this.persist();
  }

  getUser(userId: string): AuthUser | null {
    const user = this.store.users.find((item) => item.id === userId);
    return user ? this.toPublicUser(user) : null;
  }

  async updatePreferences(userId: string, input: Partial<UserPreferences>) {
    const user = this.store.users.find((item) => item.id === userId);
    if (!user) throw new UnauthorizedException('用户不存在或登录已失效');
    const provider = input?.transcriptionProvider;
    if (provider !== undefined && provider !== 'funasr' && provider !== 'openai') throw new BadRequestException('不支持该语音转写引擎');
    let funasrEndpoint = input?.funasrEndpoint?.trim();
    if (funasrEndpoint !== undefined) {
      if (!funasrEndpoint) throw new BadRequestException('请填写 FunASR 服务地址');
      try {
        const url = new URL(funasrEndpoint);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
        funasrEndpoint = url.toString();
      } catch { throw new BadRequestException('FunASR 服务地址格式不正确'); }
    }
    user.preferences = {
      ...this.normalizeStoredPreferences(user.preferences),
      ...(provider !== undefined ? { transcriptionProvider: provider } : {}),
      ...(funasrEndpoint !== undefined ? { funasrEndpoint } : {}),
    };
    await this.persist();
    return this.toPublicUser(user);
  }

  async createAiProvider(userId: string, input: { name?: string; baseUrl?: string; model?: string; apiKey?: string }) {
    const user = this.requireUser(userId);
    const now = Date.now();
    const provider: StoredAiProvider = {
      id: uuid(),
      ...this.validateAiProvider(input),
      apiKey: String(input.apiKey || '').trim(),
      createdAt: now,
      updatedAt: now,
    };
    user.preferences = this.normalizeStoredPreferences(user.preferences);
    user.preferences.aiProviders.push(provider);
    if (!user.preferences.defaultAiProviderId) user.preferences.defaultAiProviderId = provider.id;
    await this.persist();
    return this.toPublicUser(user);
  }

  async updateAiProvider(userId: string, id: string, input: { name?: string; baseUrl?: string; model?: string; apiKey?: string }) {
    const user = this.requireUser(userId);
    user.preferences = this.normalizeStoredPreferences(user.preferences);
    const provider = user.preferences.aiProviders.find((item) => item.id === id);
    if (!provider) throw new BadRequestException('AI 供应商不存在');
    const validated = this.validateAiProvider({
      name: input.name ?? provider.name,
      baseUrl: input.baseUrl ?? provider.baseUrl,
      model: input.model ?? provider.model,
    });
    Object.assign(provider, validated, { updatedAt: Date.now() });
    if (typeof input.apiKey === 'string' && input.apiKey.trim()) provider.apiKey = input.apiKey.trim();
    await this.persist();
    return this.toPublicUser(user);
  }

  async deleteAiProvider(userId: string, id: string) {
    const user = this.requireUser(userId);
    user.preferences = this.normalizeStoredPreferences(user.preferences);
    const before = user.preferences.aiProviders.length;
    user.preferences.aiProviders = user.preferences.aiProviders.filter((item) => item.id !== id);
    if (before === user.preferences.aiProviders.length) throw new BadRequestException('AI 供应商不存在');
    if (user.preferences.defaultAiProviderId === id) {
      user.preferences.defaultAiProviderId = user.preferences.aiProviders[0]?.id || '';
    }
    await this.persist();
    return this.toPublicUser(user);
  }

  async setDefaultAiProvider(userId: string, id: string) {
    const user = this.requireUser(userId);
    user.preferences = this.normalizeStoredPreferences(user.preferences);
    if (!user.preferences.aiProviders.some((item) => item.id === id)) throw new BadRequestException('AI 供应商不存在');
    user.preferences.defaultAiProviderId = id;
    await this.persist();
    return this.toPublicUser(user);
  }

  getDefaultAiProvider(userId: string): StoredAiProvider | null {
    const user = this.store.users.find((item) => item.id === userId);
    if (!user) return null;
    user.preferences = this.normalizeStoredPreferences(user.preferences);
    return user.preferences.aiProviders.find((item) => item.id === user.preferences.defaultAiProviderId) || null;
  }

  private validateRegistration(username: string, password: string, displayName: string) {
    if (!/^[a-z0-9_.-]{3,32}$/.test(username)) {
      throw new BadRequestException('用户名需为 3-32 位字母、数字、点、下划线或短横线');
    }
    if (!password || password.length < 8 || password.length > 128) {
      throw new BadRequestException('密码长度需为 8-128 位');
    }
    if (!displayName || displayName.length > 30) {
      throw new BadRequestException('显示名称需为 1-30 个字符');
    }
  }

  private normalizeUsername(value: string) {
    return (value || '').trim().toLocaleLowerCase();
  }

  private async passwordMatches(password: string, user: StoredUser) {
    const actual = Buffer.from(await this.hashPassword(password, user.passwordSalt), 'hex');
    const expected = Buffer.from(user.passwordHash, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  private async hashPassword(password: string, salt: string) {
    const result = await scrypt(password, salt, 64) as Buffer;
    return result.toString('hex');
  }

  private createSession(userId: string) {
    const token = randomBytes(32).toString('base64url');
    this.store.sessions.push({
      tokenHash: this.hashToken(token), userId, createdAt: Date.now(), expiresAt: Date.now() + SESSION_TTL,
    });
    return token;
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private removeExpiredSessions() {
    const now = Date.now();
    this.store.sessions = this.store.sessions.filter((item) => item.expiresAt > now);
  }

  private requireUser(userId: string): StoredUser {
    const user = this.store.users.find((item) => item.id === userId);
    if (!user) throw new UnauthorizedException('用户不存在或登录已失效');
    return user;
  }

  private validateAiProvider(input: { name?: string; baseUrl?: string; model?: string }) {
    const name = String(input.name || '').trim();
    const model = String(input.model || '').trim();
    if (!name || name.length > 40) throw new BadRequestException('供应商名称需为 1-40 个字符');
    if (!model || model.length > 100) throw new BadRequestException('请填写模型名称');
    let baseUrl = String(input.baseUrl || '').trim().replace(/\/+$/, '');
    try {
      const url = new URL(baseUrl);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error();
      baseUrl = url.toString().replace(/\/+$/, '');
    } catch { throw new BadRequestException('供应商接口地址格式不正确'); }
    return { name, baseUrl, model };
  }

  private toPublicProvider(provider: StoredAiProvider): AiProviderPublic {
    const { apiKey, ...safe } = provider;
    return { ...safe, hasApiKey: Boolean(apiKey) };
  }

  private toPublicUser(user: StoredUser): AuthUser {
    const preferences = this.normalizeStoredPreferences(user.preferences);
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      createdAt: user.createdAt,
      preferences: {
        transcriptionProvider: preferences.transcriptionProvider,
        funasrEndpoint: preferences.funasrEndpoint,
        defaultAiProviderId: preferences.defaultAiProviderId,
        aiProviders: preferences.aiProviders.map((provider) => this.toPublicProvider(provider)),
      },
    };
  }

  private defaultStoredPreferences(): StoredUserPreferences {
    return {
      transcriptionProvider: 'funasr',
      funasrEndpoint: process.env.FUNASR_TRANSCRIBE_ENDPOINT || 'http://127.0.0.1:10095/v1/audio/transcriptions',
      defaultAiProviderId: '',
      aiProviders: [],
    };
  }

  private normalizeStoredPreferences(input?: Partial<StoredUserPreferences>): StoredUserPreferences {
    const defaults = this.defaultStoredPreferences();
    const aiProviders = Array.isArray(input?.aiProviders)
      ? input.aiProviders.filter((item): item is StoredAiProvider => Boolean(item?.id && item?.name && item?.baseUrl && item?.model))
      : [];
    const defaultAiProviderId = aiProviders.some((item) => item.id === input?.defaultAiProviderId)
      ? String(input?.defaultAiProviderId)
      : (aiProviders[0]?.id || '');
    return {
      transcriptionProvider: input?.transcriptionProvider === 'openai' ? 'openai' : 'funasr',
      funasrEndpoint: input?.funasrEndpoint || defaults.funasrEndpoint,
      defaultAiProviderId,
      aiProviders: aiProviders.map((item) => ({ ...item, apiKey: String(item.apiKey || '') })),
    };
  }

  private async persist() {
    const data = JSON.stringify(this.store, null, 2);
    this.writeQueue = this.writeQueue.then(async () => {
      await fs.mkdir(path.dirname(this.dataFile), { recursive: true });
      const temporaryFile = `${this.dataFile}.tmp`;
      await fs.writeFile(temporaryFile, data, { encoding: 'utf-8', mode: 0o600 });
      await fs.rename(temporaryFile, this.dataFile);
    }).catch((error) => this.logger.error(`Persist failed: ${error.message}`));
    await this.writeQueue;
  }
}
