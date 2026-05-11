import { net } from 'electron';
import appConfig from './config';
import { keyStore } from './key-store';

export interface KeychainSettings {
  baseUrl: string;
  channelId: string;
  runtimeToken: string;
}

export interface HostedUser {
  id: string;
  channelId?: string;
  channelName?: string;
  externalUserId: string;
  name: string;
  isEnabled: boolean;
}

export interface RuntimeProvider {
  id: string;
  name: string;
}

export interface RuntimeModel {
  id: string;
  providerId: string;
  name: string;
}

export interface RuntimeModelInfo {
  id: string;
  name: string;
  provider: string;
  endpoint: string;
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  capabilities: Array<'image' | 'text'>;
}

export interface DispatchResult {
  dispatchLogId: string;
  providerName: string;
  modelName: string;
  keyId: string;
  keyAlias: string;
  key: string;
}

interface RuntimeErrorBody {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
  message?: string;
}

const DEFAULT_BASE_URL = 'https://keychain.liangz77.cn';
const DEFAULT_CHANNEL_ID = 'ai_video_maker';
const DEFAULT_MODEL_CAPABILITIES: Array<'image' | 'text'> = ['image', 'text'];

export function encodeRuntimeModelId(providerId: string, modelId: string): string {
  return `keychain:${encodeURIComponent(providerId)}:${encodeURIComponent(modelId)}`;
}

export function decodeRuntimeModelId(modelEndpoint: string): { providerId: string; modelId: string } {
  const parts = modelEndpoint.split(':');
  if (parts.length === 3 && parts[0] === 'keychain') {
    return {
      providerId: decodeURIComponent(parts[1]),
      modelId: decodeURIComponent(parts[2]),
    };
  }
  throw new Error(`模型ID格式错误: ${modelEndpoint}`);
}

function normalizeProviderName(providerName: string): string {
  const name = providerName.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (name.includes('openrouter')) return 'openrouter';
  if (name.includes('gemini_proxy') || name.includes('gemini中转') || name.includes('中转')) return 'gemini_proxy';
  if (name.includes('gemini') || name.includes('google')) return 'gemini';
  if (name.includes('doubao') || name.includes('豆包') || name.includes('volc')) return 'doubao';
  if (name.includes('runninghub')) return 'runninghub';
  return name;
}

export function providerKeyEnvName(providerName: string): string {
  const provider = normalizeProviderName(providerName);
  switch (provider) {
    case 'gemini':
      return 'GEMINI_API_KEY';
    case 'gemini_proxy':
      return 'GEMINI_PROXY_API_KEY';
    case 'openrouter':
      return 'OPENROUTER_API_KEY';
    case 'doubao':
      return 'DOUBAO_API_KEY';
    case 'runninghub':
      return 'RUNNINGHUB_API_KEY';
    default:
      return `${provider.toUpperCase()}_API_KEY`;
  }
}

export function runtimeModelString(providerName: string, modelName: string): string {
  return `${normalizeProviderName(providerName)}:${modelName}`;
}

export function isProviderFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  if (!message) return false;
  if (/请先选择模型|提示词内容不能为空|文件路径不能为空|DRAFT_NOT_FOUND|资源未找到|Prompt content/i.test(message)) {
    return false;
  }
  if (/队列已满|TASK_QUEUE_MAXED|TASK_INSTANCE_MAXED|PERSONAL_QUEUE_COUNT_LIMIT|APIKEY_TASK_IS_QUEUED|APIKEY_TASK_IS_RUNNING|Resources are busy|Concurrency Limit|Dedicated Instances Exhausted|System is currently busy|Service unavailable/i.test(message)) {
    return false;
  }
  return true;
}

export function errorCodeFrom(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || '');
  if (/416|812|NOT_ENOUGH_WALLET|INSUFFICIENT_FUNDS|insufficient.?funds|insufficient.?balance|余额不足|额度不足|wallet/i.test(message)) return 'insufficient_quota';
  if (/429|rate.?limit|quota/i.test(message)) return 'rate_limit';
  if (/401|unauthorized|invalid.?key|API Key/i.test(message)) return 'unauthorized';
  if (/403|forbidden|permission/i.test(message)) return 'forbidden';
  if (/timeout|超时|ECONNABORTED/i.test(message)) return 'timeout';
  if (/network|ENOTFOUND|ECONNREFUSED|连接失败/i.test(message)) return 'network_error';
  return 'provider_error';
}

class KeychainRuntimeService {
  private settingsOverride: Partial<KeychainSettings> = {};

  setSettingsOverride(settings: Partial<KeychainSettings>): void {
    this.settingsOverride = { ...this.settingsOverride, ...settings };
  }

  async getSettings(): Promise<KeychainSettings> {
    const cfg = await appConfig.load();
    const keychain = cfg.keychain || {};
    const baseUrl = this.settingsOverride.baseUrl
      || keychain.baseUrl
      || keyStore.get('KEYCHAIN_BASE_URL')
      || DEFAULT_BASE_URL;
    const channelId = this.settingsOverride.channelId
      || keychain.channelId
      || keyStore.get('KEYCHAIN_CHANNEL_ID')
      || DEFAULT_CHANNEL_ID;
    const runtimeToken = this.settingsOverride.runtimeToken
      || keychain.runtimeToken
      || keyStore.get('KEYCHAIN_RUNTIME_TOKEN')
      || '';

    return {
      baseUrl: baseUrl.replace(/\/+$/, ''),
      channelId,
      runtimeToken,
    };
  }

  async saveSettings(settings: Partial<KeychainSettings>): Promise<void> {
    const cfg = await appConfig.load();
    const current = cfg.keychain || {};
    const next = {
      baseUrl: settings.baseUrl || current.baseUrl || DEFAULT_BASE_URL,
      channelId: settings.channelId || current.channelId || DEFAULT_CHANNEL_ID,
      runtimeToken: settings.runtimeToken || current.runtimeToken || '',
    };
    await appConfig.set('keychain', {
      ...current,
      ...next,
    });
    this.setSettingsOverride(settings);
  }

  async registerHostedUser(params: {
    username: string;
    name?: string;
    password: string;
    settings?: Partial<KeychainSettings>;
  }): Promise<HostedUser> {
    if (params.settings) this.setSettingsOverride(params.settings);
    const settings = await this.getSettings();
    const username = params.username.trim();
    return this.request<HostedUser>(
      `/api/runtime/channels/${encodeURIComponent(settings.channelId)}/hosted-users/register`,
      {
        method: 'POST',
        body: JSON.stringify({
          username,
          name: params.name?.trim() || username,
          password: params.password,
        }),
      },
      settings,
    );
  }

  async loginHostedUser(params: {
    username: string;
    password: string;
    settings?: Partial<KeychainSettings>;
  }): Promise<HostedUser> {
    if (params.settings) this.setSettingsOverride(params.settings);
    const settings = await this.getSettings();
    return this.request<HostedUser>(
      `/api/runtime/channels/${encodeURIComponent(settings.channelId)}/hosted-users/login`,
      {
        method: 'POST',
        body: JSON.stringify({
          username: params.username.trim(),
          password: params.password,
        }),
      },
      settings,
    );
  }

  async resetHostedPassword(userId: string, password: string): Promise<HostedUser> {
    const settings = await this.getSettings();
    return this.request<HostedUser>(
      `/api/runtime/channels/${encodeURIComponent(settings.channelId)}/hosted-users/${encodeURIComponent(userId)}/reset-password`,
      {
        method: 'POST',
        body: JSON.stringify({ password }),
      },
      settings,
    );
  }

  async deleteHostedUser(userId: string): Promise<{ deleted: boolean }> {
    const settings = await this.getSettings();
    return this.request<{ deleted: boolean }>(
      `/api/runtime/channels/${encodeURIComponent(settings.channelId)}/hosted-users/${encodeURIComponent(userId)}`,
      { method: 'DELETE' },
      settings,
    );
  }

  async listProviders(): Promise<RuntimeProvider[]> {
    return this.request<RuntimeProvider[]>('/api/runtime/providers');
  }

  async listModels(providerId: string): Promise<RuntimeModel[]> {
    return this.request<RuntimeModel[]>(`/api/runtime/models?providerId=${encodeURIComponent(providerId)}`);
  }

  async listRuntimeModels(): Promise<RuntimeModelInfo[]> {
    const providers = await this.listProviders();
    const models: RuntimeModelInfo[] = [];
    for (const provider of providers) {
      const providerModels = await this.listModels(provider.id);
      for (const model of providerModels) {
        models.push({
          id: encodeRuntimeModelId(provider.id, model.id),
          name: `[${provider.name}] ${model.name}`,
          provider: normalizeProviderName(provider.name),
          endpoint: model.name,
          providerId: provider.id,
          providerName: provider.name,
          modelId: model.id,
          modelName: model.name,
          capabilities: DEFAULT_MODEL_CAPABILITIES,
        });
      }
    }
    return models;
  }

  async findFirstModelByProvider(providerName: string): Promise<RuntimeModelInfo | null> {
    const target = normalizeProviderName(providerName);
    const models = await this.listRuntimeModels();
    return models.find((model) => normalizeProviderName(model.providerName) === target || model.provider === target) || null;
  }

  async dispatchKey(modelEndpoint: string, userId: string): Promise<DispatchResult> {
    const { providerId, modelId } = decodeRuntimeModelId(modelEndpoint);
    const settings = await this.getSettings();
    return this.request<DispatchResult>(
      '/api/runtime/dispatches',
      {
        method: 'POST',
        body: JSON.stringify({
          channelName: settings.channelId,
          userId,
          providerId,
          modelId,
        }),
      },
      settings,
    );
  }

  async reportFailure(dispatchLogId: string, error: unknown): Promise<void> {
    try {
      await this.request(
        `/api/runtime/dispatches/${encodeURIComponent(dispatchLogId)}/failure`,
        {
          method: 'POST',
          body: JSON.stringify({
            errorCode: errorCodeFrom(error),
            errorMessage: error instanceof Error ? error.message : String(error || 'unknown error'),
          }),
        },
      );
    } catch (reportError) {
      console.warn('[Keychain] Failed to report dispatch failure:', reportError instanceof Error ? reportError.message : reportError);
    }
  }

  async withDispatch<T>(
    modelEndpoint: string,
    userId: string,
    callback: (dispatch: DispatchResult) => Promise<T>,
  ): Promise<T> {
    const dispatch = await this.dispatchKey(modelEndpoint, userId);
    try {
      return await callback(dispatch);
    } catch (error) {
      if (isProviderFailure(error)) {
        await this.reportFailure(dispatch.dispatchLogId, error);
      }
      throw error;
    }
  }

  private async request<T = unknown>(path: string, init: RequestInit = {}, settingsArg?: KeychainSettings): Promise<T> {
    const settings = settingsArg || await this.getSettings();
    if (!settings.baseUrl) throw new Error('Keychain 地址未配置');
    if (!settings.channelId && path.includes('/channels/')) throw new Error('Keychain 渠道 ID 未配置');
    if (!settings.runtimeToken) throw new Error('Keychain Runtime Token 未配置');

    const response = await this.fetchWithTimeout(`${settings.baseUrl}${path}`, {
      ...init,
      headers: {
        'Authorization': `Bearer ${settings.runtimeToken}`,
        'Content-Type': 'application/json',
        ...(init.headers || {}),
      },
    });

    const data = await response.json().catch(() => ({})) as T & RuntimeErrorBody;
    if (!response.ok) {
      const apiError = data?.error;
      const message = apiError?.message || data?.message || `HTTP ${response.status}`;
      const code = apiError?.code ? ` (${apiError.code})` : '';
      throw new Error(`${message}${code}`);
    }
    return data as T;
  }

  private async fetchWithTimeout(url: string, init?: RequestInit, timeoutMs = 15000): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await net.fetch(url, { ...init, signal: controller.signal });
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        throw new Error(`请求超时 (${timeoutMs / 1000}s)`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

export const keychainRuntime = new KeychainRuntimeService();
export default keychainRuntime;
