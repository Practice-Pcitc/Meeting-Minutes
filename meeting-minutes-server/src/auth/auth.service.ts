import { BadRequestException, Injectable, Logger, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'crypto';
import { promisify } from 'util';
import { v4 as uuid } from 'uuid';
import { AuthStore, AuthUser, StoredUser } from './auth.types';

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
      this.store.users = Array.isArray(raw?.users) ? raw.users : [];
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
      id: uuid(), username, displayName, passwordHash, passwordSalt, createdAt: Date.now(),
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

  private toPublicUser(user: StoredUser): AuthUser {
    return { id: user.id, username: user.username, displayName: user.displayName, createdAt: user.createdAt };
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
