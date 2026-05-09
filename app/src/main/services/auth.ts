/**
 * Keychain 托管用户登录态服务。
 *
 * 本地只保存用户身份和 Keychain Runtime 配置，不保存任何模型密钥。
 * 模型密钥由调用入口在每次请求前通过 dispatch 临时获取。
 */
import { app, safeStorage } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import keychainRuntime, { type KeychainSettings, type HostedUser } from './keychain-runtime';

const AUTH_FILE = 'auth-token.dat';
const LOCAL_SESSION_TTL_MS = 7 * 24 * 3600 * 1000;

interface PersistedAuth {
  userId: string;
  username: string;
  name: string;
  channelId: string;
  baseUrl: string;
  expiresAt: number;
}

export interface AuthState {
  isLoggedIn: boolean;
  userId?: string;
  username?: string;
  name?: string;
  channelId?: string;
}

interface AuthResult extends AuthState {
  success: boolean;
  error?: string;
}

class AuthService {
  private userId: string | null = null;
  private username: string | null = null;
  private name: string | null = null;
  private channelId: string | null = null;
  private baseUrl: string | null = null;

  async init(defaultBaseUrl: string): Promise<AuthState> {
    keychainRuntime.setSettingsOverride({ baseUrl: defaultBaseUrl });
    const saved = await this.loadPersistedAuth();
    if (saved && saved.expiresAt > Date.now()) {
      this.applyPersistedAuth(saved);
      keychainRuntime.setSettingsOverride({
        baseUrl: saved.baseUrl,
        channelId: saved.channelId,
      });
      console.log(`[Auth] Restored local session: ${this.username}`);
      return this.getState();
    }
    await this.clearPersistedAuth();
    return { isLoggedIn: false };
  }

  async register(params: {
    username: string;
    name?: string;
    password: string;
    settings?: Partial<KeychainSettings>;
  }): Promise<AuthResult> {
    try {
      const user = await keychainRuntime.registerHostedUser(params);
      await this.useHostedUser(user, params.settings?.baseUrl);
      return { success: true, ...this.getState() };
    } catch (error) {
      return { success: false, isLoggedIn: false, error: this.toMessage(error) };
    }
  }

  async login(params: {
    username: string;
    password: string;
    settings?: Partial<KeychainSettings>;
  }): Promise<AuthResult> {
    try {
      const user = await keychainRuntime.loginHostedUser(params);
      await this.useHostedUser(user, params.settings?.baseUrl);
      return { success: true, ...this.getState() };
    } catch (error) {
      return { success: false, isLoggedIn: false, error: this.toMessage(error) };
    }
  }

  async resetPassword(password: string): Promise<AuthResult> {
    if (!this.userId) {
      return { success: false, isLoggedIn: false, error: '请先登录' };
    }
    try {
      const user = await keychainRuntime.resetHostedPassword(this.userId, password);
      await this.useHostedUser(user);
      return { success: true, ...this.getState() };
    } catch (error) {
      return { success: false, ...this.getState(), error: this.toMessage(error) };
    }
  }

  async logout(): Promise<void> {
    this.clearMemory();
    await this.clearPersistedAuth();
    console.log('[Auth] Logged out');
  }

  async deleteAccount(): Promise<AuthResult> {
    if (!this.userId) {
      return { success: false, isLoggedIn: false, error: '请先登录' };
    }
    try {
      await keychainRuntime.deleteHostedUser(this.userId);
      await this.logout();
      return { success: true, isLoggedIn: false };
    } catch (error) {
      return { success: false, ...this.getState(), error: this.toMessage(error) };
    }
  }

  getState(): AuthState {
    if (this.userId && this.username) {
      return {
        isLoggedIn: true,
        userId: this.userId,
        username: this.username,
        name: this.name || this.username,
        channelId: this.channelId || undefined,
      };
    }
    return { isLoggedIn: false };
  }

  requireUserId(): string {
    if (!this.userId) {
      throw new Error('请先登录');
    }
    return this.userId;
  }

  private async useHostedUser(user: HostedUser, baseUrl?: string): Promise<void> {
    const settings = await keychainRuntime.getSettings();
    this.userId = user.id;
    this.username = user.externalUserId;
    this.name = user.name || user.externalUserId;
    this.channelId = user.channelId || user.channelName || settings.channelId;
    this.baseUrl = baseUrl || settings.baseUrl;

    await this.persistAuth({
      userId: this.userId,
      username: this.username,
      name: this.name,
      channelId: this.channelId,
      baseUrl: this.baseUrl,
      expiresAt: Date.now() + LOCAL_SESSION_TTL_MS,
    });
  }

  private applyPersistedAuth(saved: PersistedAuth): void {
    this.userId = saved.userId;
    this.username = saved.username;
    this.name = saved.name;
    this.channelId = saved.channelId;
    this.baseUrl = saved.baseUrl;
  }

  private clearMemory(): void {
    this.userId = null;
    this.username = null;
    this.name = null;
    this.channelId = null;
    this.baseUrl = null;
  }

  private toMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error || '操作失败');
  }

  private getAuthPath(): string {
    return path.join(app.getPath('userData'), AUTH_FILE);
  }

  private async persistAuth(state: PersistedAuth): Promise<void> {
    try {
      const json = JSON.stringify(state);
      if (safeStorage.isEncryptionAvailable()) {
        await fs.writeFile(this.getAuthPath(), safeStorage.encryptString(json));
      } else {
        await fs.writeFile(this.getAuthPath(), json, 'utf-8');
      }
    } catch (error) {
      console.error('[Auth] Failed to persist local session:', this.toMessage(error));
    }
  }

  private async loadPersistedAuth(): Promise<PersistedAuth | null> {
    try {
      const data = await fs.readFile(this.getAuthPath());
      const json = safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(data)
        : data.toString('utf-8');
      return JSON.parse(json) as PersistedAuth;
    } catch {
      return null;
    }
  }

  private async clearPersistedAuth(): Promise<void> {
    try {
      await fs.unlink(this.getAuthPath());
    } catch {
      // 文件可能不存在
    }
  }
}

export const authService = new AuthService();
export default authService;
