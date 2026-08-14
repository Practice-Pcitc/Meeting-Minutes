export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  createdAt: number;
}

export interface StoredUser extends AuthUser {
  passwordHash: string;
  passwordSalt: string;
}

export interface StoredSession {
  tokenHash: string;
  userId: string;
  expiresAt: number;
  createdAt: number;
}

export interface AuthStore {
  users: StoredUser[];
  sessions: StoredSession[];
}
