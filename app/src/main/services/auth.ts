/**
 * 认证服务
 * 处理登录/登出、JWT token 持久化、从云端拉取 API 密钥
 * 使用 Electron net.fetch() 以自动支持系统代理
 */
import { app, safeStorage, net } from 'electron';
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

/** Provider 到 API Key 名称的映射 */
const PROVIDER_KEY_MAP: Record<string, string> = {
  gemini: 'GEMINI_API_KEY',
  gemini_proxy: 'GEMINI_PROXY_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  doubao: 'DOUBAO_API_KEY',
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
      const resp = await this.fetchWithTimeout(`${this.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await resp.json();
      if (!resp.ok) {
        const raw = data?.error || data?.message || `HTTP ${resp.status}`;
        const msg = typeof raw === 'object' && raw !== null ? (raw.message || JSON.stringify(raw)) : String(raw);
        return { success: false, error: msg };
      }

      const { token, user } = data;
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
      return { success: false, error: err?.message || '登录失败' };
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

    const headers = {
      'Authorization': `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };

    // 1. 获取可用密钥名称列表
    const listResp = await this.fetchWithTimeout(`${this.baseUrl}/api/keys`, { headers });
    const listData = await listResp.json();
    if (!listResp.ok) throw new Error(listData?.message || `HTTP ${listResp.status}`);
    const keyList: Array<{ id: number; keyName: string }> = listData?.keys || [];

    if (keyList.length === 0) {
      console.log('[Auth] No keys available for this user');
      return [];
    }

    const keyNames = keyList.map(k => k.keyName);
    console.log(`[Auth] Found ${keyNames.length} available keys, fetching values...`);

    // 2. 批量获取密钥值
    const batchResp = await this.fetchWithTimeout(`${this.baseUrl}/api/keys`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ keyNames }),
    });
    const batchData = await batchResp.json();
    if (!batchResp.ok) throw new Error(batchData?.message || `HTTP ${batchResp.status}`);

    const keys: Record<string, string> = batchData?.keys || {};
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

  /**
   * 上报 API 使用记录（fire-and-forget，失败只打日志不影响业务）
   * @param modelId 模型 ID，格式 provider:endpoint（如 gemini:gemini-3.1-flash）
   * @param description 使用描述
   */
  reportUsage(modelId: string, description: string): void {
    if (!this.token || !this.baseUrl) return;

    const provider = modelId.split(':')[0];
    const keyName = PROVIDER_KEY_MAP[provider];
    if (!keyName) return;

    this.fetchWithTimeout(`${this.baseUrl}/api/keys/${keyName}/usage`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ description }),
    }).then(() => {
      console.log(`[Auth] Usage reported: ${keyName}`);
    }).catch((err) => {
      console.warn(`[Auth] Failed to report usage for ${keyName}:`, err?.message || err);
    });
  }

  // ============================================
  // 网络请求（使用 Electron net.fetch 支持系统代理）
  // ============================================

  private async fetchWithTimeout(url: string, init?: RequestInit, timeoutMs = 15000): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await net.fetch(url, { ...init, signal: controller.signal });
      return resp;
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        throw new Error(`请求超时 (${timeoutMs / 1000}s)`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
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
