import { create } from 'zustand';
import type { ProcessingTask, TaskStatus, OperationResult } from '@shared/types';

// ============================================
// Types
// ============================================

interface TaskProgressEvent {
  taskId: string;
  progress: number;
  status: TaskStatus;
  error?: string;
}

interface TaskCompletedEvent {
  taskId: string;
  outputResourceIds: string[];
}

interface TaskState {
  // State
  tasks: ProcessingTask[];
  currentTaskId: string | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  loadTasks: (draftId: string) => Promise<void>;
  splitVideo: (draftId: string, sourceVideoId: string, config?: object) => Promise<ProcessingTask | null>;
  upscaleVideo: (draftId: string, sourceVideoIds: string[], config: object) => Promise<ProcessingTask | null>;
  generateImage: (draftId: string, sourceImageId: string, promptResourceId: string) => Promise<ProcessingTask | null>;
  synthesizeVideo: (draftId: string, videoResourceIds: string[], config?: object) => Promise<ProcessingTask | null>;
  cancelTask: (taskId: string) => Promise<boolean>;

  // Event Handlers
  handleProgress: (event: TaskProgressEvent) => void;
  handleCompleted: (event: TaskCompletedEvent, onCompleted?: (outputResourceIds: string[]) => void) => void;

  // Computed
  getCurrentTask: () => ProcessingTask | null;
  getPendingTasks: () => ProcessingTask[];
  getCompletedTasks: () => ProcessingTask[];
}

// ============================================
// Store Implementation
// ============================================

export const useTaskStore = create<TaskState>((set, get) => ({
  // Initial State
  tasks: [],
  currentTaskId: null,
  isLoading: false,
  error: null,

  // Actions
  loadTasks: async (draftId: string) => {
    set({ isLoading: true, error: null });
    try {
      const tasks = await window.api.task.list({ draftId });
      set({ tasks: tasks || [], isLoading: false });

      // Find current processing task
      const processingTask = tasks?.find((t: ProcessingTask) => t.status === 'processing');
      set({ currentTaskId: processingTask?.id || null });
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false });
    }
  },

  splitVideo: async (draftId: string, sourceVideoId: string, config?: object) => {
    try {
      const result: OperationResult<ProcessingTask> = await window.api.task.splitVideo({
        draftId,
        sourceVideoId,
        config,
      });
      if (result.success && result.data) {
        set((state) => ({
          tasks: [...state.tasks, result.data!],
          currentTaskId: result.data!.id,
        }));
        return result.data;
      }
      return null;
    } catch {
      return null;
    }
  },

  upscaleVideo: async (draftId: string, sourceVideoIds: string[], config: object) => {
    try {
      const result: OperationResult<ProcessingTask> = await window.api.task.upscaleVideo({
        draftId,
        sourceVideoIds,
        config,
      });
      if (result.success && result.data) {
        set((state) => ({
          tasks: [...state.tasks, result.data!],
          currentTaskId: result.data!.id,
        }));
        return result.data;
      }
      return null;
    } catch {
      return null;
    }
  },

  generateImage: async (draftId: string, sourceImageId: string, promptResourceId: string) => {
    try {
      const result: OperationResult<ProcessingTask> = await window.api.task.generateImage({
        draftId,
        sourceImageId,
        promptResourceId,
      });
      if (result.success && result.data) {
        set((state) => ({
          tasks: [...state.tasks, result.data!],
          currentTaskId: result.data!.id,
        }));
        return result.data;
      }
      return null;
    } catch {
      return null;
    }
  },

  synthesizeVideo: async (draftId: string, videoResourceIds: string[], config?: object) => {
    try {
      const result: OperationResult<ProcessingTask> = await window.api.task.synthesizeVideo({
        draftId,
        videoResourceIds,
        config,
      });
      if (result.success && result.data) {
        set((state) => ({
          tasks: [...state.tasks, result.data!],
          currentTaskId: result.data!.id,
        }));
        return result.data;
      }
      return null;
    } catch {
      return null;
    }
  },

  cancelTask: async (taskId: string) => {
    try {
      const result: OperationResult = await window.api.task.cancel({ id: taskId });
      if (result.success) {
        set((state) => ({
          tasks: state.tasks.map((t) =>
            t.id === taskId ? { ...t, status: 'failed' as TaskStatus, error: 'Cancelled' } : t
          ),
          currentTaskId: state.currentTaskId === taskId ? null : state.currentTaskId,
        }));
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  // Event Handlers
  handleProgress: (event: TaskProgressEvent) => {
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === event.taskId
          ? {
              ...t,
              progress: event.progress,
              status: event.status,
              error: event.error,
            }
          : t
      ),
    }));
  },

  handleCompleted: (event: TaskCompletedEvent, onCompleted?: (outputResourceIds: string[]) => void) => {
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === event.taskId
          ? {
              ...t,
              status: 'completed' as TaskStatus,
              progress: 100,
              outputResourceIds: event.outputResourceIds,
            }
          : t
      ),
      currentTaskId: state.currentTaskId === event.taskId ? null : state.currentTaskId,
    }));

    if (onCompleted) {
      onCompleted(event.outputResourceIds);
    }
  },

  // Computed
  getCurrentTask: () => {
    const { tasks, currentTaskId } = get();
    return tasks.find((t) => t.id === currentTaskId) || null;
  },

  getPendingTasks: () => {
    const { tasks } = get();
    return tasks.filter((t) => t.status === 'pending' || t.status === 'processing');
  },

  getCompletedTasks: () => {
    const { tasks } = get();
    return tasks.filter((t) => t.status === 'completed');
  },
}));

export default useTaskStore;
