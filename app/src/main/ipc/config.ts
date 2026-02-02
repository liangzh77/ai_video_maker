import { ipcMain, dialog, BrowserWindow } from 'electron';
import { CONFIG_CHANNELS } from '@shared/ipc-channels';
import storage from '../services/storage';
import { loadConfig, saveConfig } from '../services/config';
import type { AppConfig, OperationResult } from '@shared/types';

// ============================================
// Request Types
// ============================================

interface SetConfigRequest {
  key: string;
  value: unknown;
}

// ============================================
// Workspace Info Response
// ============================================

interface WorkspaceInfo {
  path: string;
  isDefault: boolean;
}

// ============================================
// IPC Handlers
// ============================================

export function registerConfigHandlers(): void {
  // Get full config
  ipcMain.handle(
    CONFIG_CHANNELS.GET,
    async (): Promise<AppConfig> => {
      return loadConfig();
    }
  );

  // Set config value
  ipcMain.handle(
    CONFIG_CHANNELS.SET,
    async (_, request: SetConfigRequest): Promise<OperationResult> => {
      try {
        const config = await loadConfig();
        (config as Record<string, unknown>)[request.key] = request.value;
        await saveConfig(config);
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to save config',
        };
      }
    }
  );

  // Get workspace path
  ipcMain.handle(
    CONFIG_CHANNELS.GET_WORKSPACE,
    async (): Promise<WorkspaceInfo> => {
      const currentPath = storage.getStorageRoot();
      const defaultPath = storage.getDefaultStorageRoot();
      return {
        path: currentPath,
        isDefault: currentPath === defaultPath,
      };
    }
  );

  // Set workspace path
  ipcMain.handle(
    CONFIG_CHANNELS.SET_WORKSPACE,
    async (_, request: { path: string }): Promise<OperationResult> => {
      try {
        await storage.saveStorageRootToConfig(request.path);
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to set workspace',
        };
      }
    }
  );

  // Select workspace folder via dialog
  ipcMain.handle(
    CONFIG_CHANNELS.SELECT_WORKSPACE,
    async (event): Promise<OperationResult<string>> => {
      try {
        const win = BrowserWindow.fromWebContents(event.sender);
        const result = await dialog.showOpenDialog(win!, {
          title: '选择工作目录',
          properties: ['openDirectory', 'createDirectory'],
          buttonLabel: '选择此目录',
        });

        if (result.canceled || result.filePaths.length === 0) {
          return { success: false, error: 'CANCELED' };
        }

        const selectedPath = result.filePaths[0];

        // Save to config and update storage root
        await storage.saveStorageRootToConfig(selectedPath);

        return { success: true, data: selectedPath };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to select workspace',
        };
      }
    }
  );
}

export default registerConfigHandlers;
