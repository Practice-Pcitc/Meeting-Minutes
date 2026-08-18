export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  createdAt: number;
  preferences: UserPreferences;
}

export type TranscriptionProvider = 'funasr' | 'openai';

export interface AiProviderPublic {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface StoredAiProvider extends Omit<AiProviderPublic, 'hasApiKey'> {
  apiKey: string;
}

export interface UserPreferences {
  transcriptionProvider: TranscriptionProvider;
  funasrEndpoint: string;
  defaultAiProviderId: string;
  aiProviders: AiProviderPublic[];
}

export interface StoredUserPreferences {
  transcriptionProvider: TranscriptionProvider;
  funasrEndpoint: string;
  defaultAiProviderId: string;
  aiProviders: StoredAiProvider[];
}

export interface StoredUser {
  id: string;
  username: string;
  displayName: string;
  createdAt: number;
  preferences: StoredUserPreferences;
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
