/**
 * 认证状态管理
 */
import { create } from 'zustand';

interface MissingKey {
  name: string;
  label: string;
}

interface AuthState {
  isLoggedIn: boolean;
  username: string | null;
  isLoading: boolean;
  error: string | null;
  missingKeys: MissingKey[];

  init: () => Promise<void>;
  login: (username: string, password: string, baseUrl?: string) => Promise<boolean>;
  logout: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  isLoggedIn: false,
  username: null,
  isLoading: true, // 启动时为 true，等待初始化完成
  error: null,
  missingKeys: [],

  init: async () => {
    try {
      const state = await window.api.auth.getState();
      set({
        isLoggedIn: state.isLoggedIn,
        username: state.username || null,
        isLoading: false,
        missingKeys: state.missingKeys || [],
      });
    } catch {
      set({ isLoggedIn: false, username: null, isLoading: false });
    }

    // 监听主进程推送的状态变化
    window.api.on('auth:stateChanged', (_event: any, data: { isLoggedIn: boolean; username?: string }) => {
      set({ isLoggedIn: data.isLoggedIn, username: data.username || null });
    });
  },

  login: async (username, password, baseUrl?) => {
    set({ isLoading: true, error: null });
    try {
      const result = await window.api.auth.login({ username, password, baseUrl });
      if (result.success) {
        set({
          isLoggedIn: true,
          username: result.username || username,
          isLoading: false,
          missingKeys: result.missingKeys || [],
        });
        return true;
      }
      const errMsg = typeof result.error === 'string' ? result.error
        : (result.error as any)?.message || '登录失败';
      set({ error: errMsg, isLoading: false });
      return false;
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false });
      return false;
    }
  },

  logout: async () => {
    await window.api.auth.logout();
    set({ isLoggedIn: false, username: null, missingKeys: [] });
  },

  clearError: () => set({ error: null }),
}));
