import { create } from 'zustand';

// ============================================
// Types
// ============================================

export type NotificationType = 'error' | 'warning' | 'info' | 'success';

export interface Notification {
  id: string;
  type: NotificationType;
  message: string;
  timestamp: number;
}

interface NotificationState {
  // State
  notifications: Notification[];

  // Actions
  addNotification: (type: NotificationType, message: string) => string;
  removeNotification: (id: string) => void;
  clearAll: () => void;

  // Shortcuts
  showError: (message: string) => string;
  showWarning: (message: string) => string;
  showInfo: (message: string) => string;
  showSuccess: (message: string) => string;
}

// ============================================
// Store Implementation
// ============================================

let notificationId = 0;

export const useNotificationStore = create<NotificationState>((set) => ({
  // Initial State
  notifications: [],

  // Actions
  addNotification: (type: NotificationType, message: string) => {
    const id = `notification-${++notificationId}`;
    const notification: Notification = {
      id,
      type,
      message,
      timestamp: Date.now(),
    };

    set((state) => ({
      notifications: [...state.notifications, notification],
    }));

    return id;
  },

  removeNotification: (id: string) => {
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    }));
  },

  clearAll: () => {
    set({ notifications: [] });
  },

  // Shortcuts
  showError: (message: string) => {
    const id = `notification-${++notificationId}`;
    const notification: Notification = {
      id,
      type: 'error',
      message,
      timestamp: Date.now(),
    };

    set((state) => ({
      notifications: [...state.notifications, notification],
    }));

    return id;
  },

  showWarning: (message: string) => {
    const id = `notification-${++notificationId}`;
    const notification: Notification = {
      id,
      type: 'warning',
      message,
      timestamp: Date.now(),
    };

    set((state) => ({
      notifications: [...state.notifications, notification],
    }));

    return id;
  },

  showInfo: (message: string) => {
    const id = `notification-${++notificationId}`;
    const notification: Notification = {
      id,
      type: 'info',
      message,
      timestamp: Date.now(),
    };

    set((state) => ({
      notifications: [...state.notifications, notification],
    }));

    return id;
  },

  showSuccess: (message: string) => {
    const id = `notification-${++notificationId}`;
    const notification: Notification = {
      id,
      type: 'success',
      message,
      timestamp: Date.now(),
    };

    set((state) => ({
      notifications: [...state.notifications, notification],
    }));

    return id;
  },
}));

export default useNotificationStore;
