/**
 * Keychain 托管用户认证状态
 */
import { create } from 'zustand';

interface RuntimeSettings {
  baseUrl?: string;
  channelId?: string;
  runtimeToken?: string;
}

interface AuthState {
  isLoggedIn: boolean;
  userId: string | null;
  username: string | null;
  name: string | null;
  isLoading: boolean;
  error: string | null;

  init: () => Promise<void>;
  register: (params: { username: string; name?: string; password: string } & RuntimeSettings) => Promise<boolean>;
  login: (params: { username: string; password: string } & RuntimeSettings) => Promise<boolean>;
  logout: () => Promise<void>;
  resetPassword: (password: string) => Promise<boolean>;
  deleteAccount: () => Promise<boolean>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  isLoggedIn: false,
  userId: null,
  username: null,
  name: null,
  isLoading: true,
  error: null,

  init: async () => {
    try {
      const state = await window.api.auth.getState();
      set({
        isLoggedIn: state.isLoggedIn,
        userId: state.userId || null,
        username: state.username || null,
        name: state.name || state.username || null,
        isLoading: false,
      });
    } catch {
      set({ isLoggedIn: false, userId: null, username: null, name: null, isLoading: false });
    }

    window.api.on('auth:stateChanged', (_event: any, data: { isLoggedIn: boolean; userId?: string; username?: string; name?: string }) => {
      set({
        isLoggedIn: data.isLoggedIn,
        userId: data.userId || null,
        username: data.username || null,
        name: data.name || data.username || null,
      });
    });
  },

  register: async (params) => {
    set({ isLoading: true, error: null });
    try {
      const result = await window.api.auth.register(params);
      if (result.success) {
        set({
          isLoggedIn: true,
          userId: result.userId || null,
          username: result.username || params.username,
          name: (result as any).name || params.name || params.username,
          isLoading: false,
        });
        return true;
      }
      set({ error: result.error || '注册失败', isLoading: false });
      return false;
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
      return false;
    }
  },

  login: async (params) => {
    set({ isLoading: true, error: null });
    try {
      const result = await window.api.auth.login(params);
      if (result.success) {
        set({
          isLoggedIn: true,
          userId: result.userId || null,
          username: result.username || params.username,
          name: (result as any).name || result.username || params.username,
          isLoading: false,
        });
        return true;
      }
      set({ error: result.error || '登录失败', isLoading: false });
      return false;
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
      return false;
    }
  },

  logout: async () => {
    await window.api.auth.logout();
    set({ isLoggedIn: false, userId: null, username: null, name: null });
  },

  resetPassword: async (password) => {
    set({ isLoading: true, error: null });
    try {
      const result = await window.api.auth.resetPassword({ password });
      set({ isLoading: false });
      if (!result.success) {
        set({ error: result.error || '重置密码失败' });
        return false;
      }
      return true;
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
      return false;
    }
  },

  deleteAccount: async () => {
    set({ isLoading: true, error: null });
    try {
      const result = await window.api.auth.deleteAccount();
      if (result.success) {
        set({ isLoggedIn: false, userId: null, username: null, name: null, isLoading: false });
        return true;
      }
      set({ error: result.error || '注销账号失败', isLoading: false });
      return false;
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
      return false;
    }
  },

  clearError: () => set({ error: null }),
}));
