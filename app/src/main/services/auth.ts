/**
 * 认证服务
 * 处理登录/登出、JWT token 持久化、从云端拉取 API 密钥
 */
import axios from 'axios';
import { app, safeStorage } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { keyStore } from './key-store';

const AUTH_FILE = 'auth-token.dat';

/** 各 Provider 所需的 API Key（用于登录后检查缺失） */
const REQUIRED_API_KEYS: Record<string, string> = {
  GEMINI_API_KEY: 'Gemini',
  GEMINI_PROXY_API_KEY: 'Gemini中转',
  OPENROUTER_API_KEY: 'OpenRouter',
  DOUBAO_API_KEY: '豆包',
};

interface PersistedAuth {
  token: string;
  username: string;
  baseUrl: string;
  expiresAt: number; // Unix timestamp (ms)
}

class AuthService {
  private token: string | null = null;
  private username: string | null = null;
  private baseUrl: string = '';

  /**
   * 初始化：加载持久化的 token，若有效则自动拉取密钥
   */
  async init(defaultBaseUrl: string): Promise<{ isLoggedIn: boolean; username?: string }> {
    this.baseUrl = defaultBaseUrl;

    const saved = await this.loadPersistedToken();
    if (saved && saved.expiresAt > Date.now()) {
      this.token = saved.token;
      this.username = saved.username;
      this.baseUrl = saved.baseUrl || defaultBaseUrl;
      try {
        await this.fetchAndStoreKeys();
        console.log(`[Auth] Auto-login successful: ${this.username}`);
        return { isLoggedIn: true, username: this.username };
      } catch (err) {
        console.log('[Auth] Auto-login failed, token may be expired:', (err as Error).message);
        this.token = null;
        this.username = null;
        await this.clearPersistedToken();
        return { isLoggedIn: false };
      }
    }
    return { isLoggedIn: false };
  }

  /**
   * 登录
   */
  async login(username: string, password: string, baseUrl?: string): Promise<{
    success: boolean;
    error?: string;
    username?: string;
    fetchedKeys?: string[];
    missingKeys?: { name: string; label: string }[];
  }> {
    if (baseUrl) {
      this.baseUrl = baseUrl;
    }

    if (!this.baseUrl) {
      return { success: false, error: '服务器地址未配置' };
    }

    try {
      const resp = await axios.post(`${this.baseUrl}/api/auth/login`, { username, password }, { timeout: 15000 });
      const { token, user } = resp.data;

      this.token = token;
      this.username = user?.username || username;

      // 持久化 token
      await this.persistToken({
        token,
        username: this.username!,
        baseUrl: this.baseUrl,
        expiresAt: Date.now() + 7 * 24 * 3600 * 1000, // 7 天
      });

      // 拉取密钥
      const fetchedKeys = await this.fetchAndStoreKeys();
      const missingKeys = this.getMissingKeys();

      return { success: true, username: this.username!, fetchedKeys, missingKeys };
    } catch (err: any) {
      const raw = err?.response?.data?.error || err?.response?.data?.message || err?.message || '登录失败';
      // 后端可能返回 {code, message} 对象，提取 message 字符串
      const msg = typeof raw === 'object' && raw !== null ? (raw.message || JSON.stringify(raw)) : String(raw);
      return { success: false, error: msg };
    }
  }

  /**
   * 退出登录
   */
  async logout(): Promise<void> {
    this.token = null;
    this.username = null;
    // 恢复到内置默认值（保留模型列表等非密钥配置，清除云端密钥）
    keyStore.reloadDefaults();
    await this.clearPersistedToken();
    console.log('[Auth] Logged out');
  }

  /**
   * 获取当前登录状态
   */
  getState(): { isLoggedIn: boolean; username?: string; missingKeys?: { name: string; label: string }[] } {
    if (this.token && this.username) {
      return { isLoggedIn: true, username: this.username, missingKeys: this.getMissingKeys() };
    }
    return { isLoggedIn: false };
  }

  /**
   * 从云端拉取所有密钥，写入 keyStore
   * 流程：GET /api/keys 获取名称列表 → POST /api/keys 批量获取值
   * 返回实际拿到的密钥名列表
   */
  private async fetchAndStoreKeys(): Promise<string[]> {
    if (!this.token) throw new Error('Not logged in');

    const headers = { Authorization: `Bearer ${this.token}` };

    // 1. 获取可用密钥名称列表
    const listResp = await axios.get(`${this.baseUrl}/api/keys`, { headers, timeout: 15000 });
    const keyList: Array<{ id: number; keyName: string }> = listResp.data?.keys || [];

    if (keyList.length === 0) {
      console.log('[Auth] No keys available for this user');
      return [];
    }

    const keyNames = keyList.map(k => k.keyName);
    console.log(`[Auth] Found ${keyNames.length} available keys, fetching values...`);

    // 2. 批量获取密钥值
    const batchResp = await axios.post(
      `${this.baseUrl}/api/keys`,
      { keyNames },
      { headers, timeout: 15000 }
    );

    const keys: Record<string, string> = batchResp.data?.keys || {};
    // 合并到已有配置上（不清空内置默认值和 .env.local 的值）
    keyStore.merge(keys);
    const fetchedNames = Object.keys(keys);
    console.log(`[Auth] Merged ${fetchedNames.length} cloud keys: [${fetchedNames.join(', ')}]`);
    return fetchedNames;
  }

  /**
   * 检查哪些 API Key 缺失
   */
  getMissingKeys(): { name: string; label: string }[] {
    const missing: { name: string; label: string }[] = [];
    for (const [keyName, label] of Object.entries(REQUIRED_API_KEYS)) {
      if (!keyStore.get(keyName)) {
        missing.push({ name: keyName, label });
      }
    }
    return missing;
  }

  // ============================================
  // Token 持久化（使用 Electron safeStorage 加密）
  // ============================================

  private getTokenPath(): string {
    return path.join(app.getPath('userData'), AUTH_FILE);
  }

  private async persistToken(state: PersistedAuth): Promise<void> {
    try {
      const json = JSON.stringify(state);
      if (safeStorage.isEncryptionAvailable()) {
        const encrypted = safeStorage.encryptString(json);
        await fs.writeFile(this.getTokenPath(), encrypted);
      } else {
        await fs.writeFile(this.getTokenPath(), json, 'utf-8');
      }
    } catch (err) {
      console.error('[Auth] Failed to persist token:', (err as Error).message);
    }
  }

  private async loadPersistedToken(): Promise<PersistedAuth | null> {
    try {
      const data = await fs.readFile(this.getTokenPath());
      let json: string;
      if (safeStorage.isEncryptionAvailable()) {
        json = safeStorage.decryptString(data);
      } else {
        json = data.toString('utf-8');
      }
      return JSON.parse(json);
    } catch {
      return null;
    }
  }

  private async clearPersistedToken(): Promise<void> {
    try {
      await fs.unlink(this.getTokenPath());
    } catch {
      // 文件可能不存在
    }
  }
}

export const authService = new AuthService();
