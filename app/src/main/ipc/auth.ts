/**
 * 认证 IPC 处理器
 */
import { ipcMain, BrowserWindow } from 'electron';
import { AUTH_CHANNELS } from '@shared/ipc-channels';
import { authService } from '../services/auth';
import config from '../services/config';

export default function registerAuthHandlers(mainWindow: BrowserWindow | null): void {
  ipcMain.handle(AUTH_CHANNELS.LOGIN, async (_, params: { username: string; password: string; baseUrl?: string }) => {
    // 如果提供了 baseUrl，保存到配置
    if (params.baseUrl) {
      await config.set('auth', { baseUrl: params.baseUrl });
    }

    const result = await authService.login(params.username, params.password, params.baseUrl);
    if (result.success) {
      mainWindow?.webContents.send(AUTH_CHANNELS.STATE_CHANGED, { isLoggedIn: true, username: result.username });
    }
    return result;
  });

  ipcMain.handle(AUTH_CHANNELS.LOGOUT, async () => {
    await authService.logout();
    mainWindow?.webContents.send(AUTH_CHANNELS.STATE_CHANGED, { isLoggedIn: false });
    return { success: true };
  });

  ipcMain.handle(AUTH_CHANNELS.GET_STATE, async () => {
    return authService.getState();
  });
}
