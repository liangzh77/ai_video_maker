/**
 * Keychain 托管用户认证 IPC 处理器
 */
import { ipcMain, BrowserWindow } from 'electron';
import { AUTH_CHANNELS } from '@shared/ipc-channels';
import { authService } from '../services/auth';
import keychainRuntime, { type KeychainSettings } from '../services/keychain-runtime';

type AuthSettingsParams = Partial<KeychainSettings>;

function getSettings(params: AuthSettingsParams | undefined): Partial<KeychainSettings> | undefined {
  if (!params) return undefined;
  const settings: Partial<KeychainSettings> = {};
  if (params.baseUrl?.trim()) settings.baseUrl = params.baseUrl.trim();
  if (params.channelId?.trim()) settings.channelId = params.channelId.trim();
  if (params.runtimeToken?.trim()) settings.runtimeToken = params.runtimeToken.trim();
  return Object.keys(settings).length > 0 ? settings : undefined;
}

async function saveSettingsIfNeeded(settings: Partial<KeychainSettings> | undefined): Promise<{ success: true } | { success: false; isLoggedIn: false; error: string }> {
  if (!settings) return { success: true };
  try {
    await keychainRuntime.saveSettings(settings);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      isLoggedIn: false,
      error: error instanceof Error ? error.message : String(error || '保存 Keychain 配置失败'),
    };
  }
}

export default function registerAuthHandlers(mainWindow: BrowserWindow | null): void {
  ipcMain.handle(AUTH_CHANNELS.REGISTER, async (_, params: {
    username: string;
    name?: string;
    password: string;
    baseUrl?: string;
    channelId?: string;
    runtimeToken?: string;
  }) => {
    const settings = getSettings(params);
    const saveResult = await saveSettingsIfNeeded(settings);
    if (!saveResult.success) return saveResult;
    const result = await authService.register({
      username: params.username,
      name: params.name,
      password: params.password,
      settings,
    });
    if (result.success) {
      mainWindow?.webContents.send(AUTH_CHANNELS.STATE_CHANGED, result);
    }
    return result;
  });

  ipcMain.handle(AUTH_CHANNELS.LOGIN, async (_, params: {
    username: string;
    password: string;
    baseUrl?: string;
    channelId?: string;
    runtimeToken?: string;
  }) => {
    const settings = getSettings(params);
    const saveResult = await saveSettingsIfNeeded(settings);
    if (!saveResult.success) return saveResult;
    const result = await authService.login({
      username: params.username,
      password: params.password,
      settings,
    });
    if (result.success) {
      mainWindow?.webContents.send(AUTH_CHANNELS.STATE_CHANGED, result);
    }
    return result;
  });

  ipcMain.handle(AUTH_CHANNELS.LOGOUT, async () => {
    await authService.logout();
    mainWindow?.webContents.send(AUTH_CHANNELS.STATE_CHANGED, { isLoggedIn: false });
    return { success: true };
  });

  ipcMain.handle(AUTH_CHANNELS.RESET_PASSWORD, async (_, params: { password: string }) => {
    const result = await authService.resetPassword(params.password);
    if (result.success) {
      mainWindow?.webContents.send(AUTH_CHANNELS.STATE_CHANGED, result);
    }
    return result;
  });

  ipcMain.handle(AUTH_CHANNELS.DELETE_ACCOUNT, async () => {
    const result = await authService.deleteAccount();
    if (result.success) {
      mainWindow?.webContents.send(AUTH_CHANNELS.STATE_CHANGED, { isLoggedIn: false });
    }
    return result;
  });

  ipcMain.handle(AUTH_CHANNELS.GET_STATE, async () => {
    return authService.getState();
  });
}
