import { create } from 'zustand';
import type { ImageResolution } from '@shared/types';
import { useDraftStore } from './draft';
import { useSectionsStore } from './sections';
import { useNotificationStore } from './notification';

// ============================================
// Types
// ============================================

export type TaskType = 'image' | 'text' | 'video';
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface ImageTaskParams {
  sourceImageIds: string[];
  modelEndpoint: string;
  resolution: ImageResolution;
  aspectRatio?: string;
  targetSectionId?: string;
  promptResourceId?: string;
}

export interface TextTaskParams {
  modelEndpoint: string;
  systemPrompt?: string;
  targetSectionId?: string;
}

export interface VideoTaskParams {
  imageResourceIds: string[];
  videoResourceIds: string[];
  duration: number;
  ratio: string;
  targetSectionId?: string;
}

export interface GenerationTask {
  id: string;
  type: TaskType;
  status: TaskStatus;
  draftId: string;
  prompt: string;
  label: string;
  params: ImageTaskParams | TextTaskParams | VideoTaskParams;
  error?: string;
  resultText?: string;
  resultResourceId?: string;
  progressMessage?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

interface GenerationStore {
  tasks: GenerationTask[];
  threadCounts: { image: number; text: number; video: number };

  addTasks: (tasks: Omit<GenerationTask, 'id' | 'status' | 'createdAt'>[]) => void;
  cancelTask: (taskId: string) => void;
  cancelPendingByType: (type: TaskType) => void;
  clearFinished: () => void;
  setThreadCount: (type: TaskType, count: number) => void;
  processQueue: (type: TaskType) => void;
}

// ============================================
// Helpers
// ============================================

let taskIdCounter = 0;
function generateTaskId(): string {
  return `gen_${Date.now()}_${++taskIdCounter}`;
}

// Per-draftId debounce timers for resource refresh
const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>();

function debouncedRefreshResources(draftId: string) {
  const existing = refreshTimers.get(draftId);
  if (existing) clearTimeout(existing);
  refreshTimers.set(
    draftId,
    setTimeout(() => {
      refreshTimers.delete(draftId);
      const { selectedDraftId, loadResources } = useDraftStore.getState();
      // Only refresh if the draft is still selected
      if (selectedDraftId === draftId) {
        loadResources(draftId);
      }
    }, 300),
  );
}

// ============================================
// Task Execution
// ============================================

async function executeImageTask(task: GenerationTask): Promise<string | undefined> {
  const params = task.params as ImageTaskParams;
  const result = await window.api.task.generateImageDirect({
    draftId: task.draftId,
    sourceImageIds: params.sourceImageIds,
    promptResourceId: params.promptResourceId,
    prompt: task.prompt,
    modelEndpoint: params.modelEndpoint,
    resolution: params.resolution,
    aspectRatio: params.aspectRatio,
    targetSectionId: params.targetSectionId,
  });
  if (!result.success) {
    throw new Error(result.error || '图片生成失败');
  }
  return result.data?.resourceId;
}

async function executeTextTask(task: GenerationTask): Promise<{ text: string; resourceId?: string }> {
  const params = task.params as TextTaskParams;
  const result = await window.api.task.generateText({
    draftId: task.draftId,
    prompt: task.prompt,
    systemPrompt: params.systemPrompt,
    modelEndpoint: params.modelEndpoint,
  });
  if (!result.success) {
    throw new Error(result.error || '文本生成失败');
  }
  const text = result.data.text;

  // Create text resource card
  let resourceId: string | undefined;
  let sectionId = params.targetSectionId;

  // 没有目标卡片栏时，自动创建一个提示词栏
  if (!sectionId) {
    const section = await useSectionsStore.getState().createSection(task.draftId, '提示词', '生成文本');
    sectionId = section?.id;
  }

  if (sectionId) {
    const resource = await useDraftStore.getState().addTextResource(task.draftId, sectionId, text);
    resourceId = resource?.id;
  }

  return { text, resourceId };
}

async function executeVideoTask(task: GenerationTask): Promise<string | undefined> {
  const params = task.params as VideoTaskParams;
  const result = await window.api.task.generateVideo({
    draftId: task.draftId,
    imageResourceIds: params.imageResourceIds,
    videoResourceIds: params.videoResourceIds,
    prompt: task.prompt,
    duration: params.duration,
    ratio: params.ratio,
    targetSectionId: params.targetSectionId,
    taskId: task.id,
  });
  if (!result.success) {
    throw new Error(result.error || '视频生成失败');
  }
  return result.data?.resourceId;
}

// ============================================
// Video Progress Listener
// ============================================

function setupVideoProgressListener() {
  window.api.on('task:videoProgress', (_event: any, data: { taskId: string; message: string }) => {
    const { tasks } = useGenerationStore.getState();
    const task = tasks.find((t) => t.id === data.taskId);
    if (task && task.status === 'running') {
      useGenerationStore.setState((state) => ({
        tasks: state.tasks.map((t) =>
          t.id === data.taskId ? { ...t, progressMessage: data.message } : t,
        ),
      }));
    }
  });
}

// 延迟初始化，确保 window.api 可用
if (typeof window !== 'undefined' && window.api) {
  setupVideoProgressListener();
} else if (typeof window !== 'undefined') {
  // window.api 可能在 preload 加载后才可用
  const checkApi = setInterval(() => {
    if (window.api) {
      clearInterval(checkApi);
      setupVideoProgressListener();
    }
  }, 100);
  setTimeout(() => clearInterval(checkApi), 5000);
}

// ============================================
// Store
// ============================================

// Load thread counts from localStorage
const THREAD_COUNTS_KEY = 'generation-thread-counts';
function loadThreadCounts(): { image: number; text: number; video: number } {
  try {
    const saved = localStorage.getItem(THREAD_COUNTS_KEY);
    if (saved) return JSON.parse(saved);
  } catch { /* ignore */ }
  return { image: 2, text: 2, video: 1 };
}

function saveThreadCounts(counts: { image: number; text: number; video: number }) {
  localStorage.setItem(THREAD_COUNTS_KEY, JSON.stringify(counts));
}

export const useGenerationStore = create<GenerationStore>((set, get) => ({
  tasks: [],
  threadCounts: loadThreadCounts(),

  addTasks: (newTasks) => {
    const now = Date.now();
    const created: GenerationTask[] = newTasks.map((t) => ({
      ...t,
      id: generateTaskId(),
      status: 'pending' as TaskStatus,
      createdAt: now,
    }));

    set((state) => ({ tasks: [...state.tasks, ...created] }));

    // Trigger processing for each unique task type
    const types = new Set(created.map((t) => t.type));
    for (const type of types) {
      // Use setTimeout to ensure state is updated before processing
      setTimeout(() => get().processQueue(type), 0);
    }
  },

  cancelTask: (taskId) => {
    const task = get().tasks.find((t) => t.id === taskId);
    if (!task) return;

    if (task.status === 'pending') {
      // 等待中的任务直接移除
      set((state) => ({
        tasks: state.tasks.filter((t) => t.id !== taskId),
      }));
    } else if (task.status === 'running') {
      // 运行中的任务标记取消（IPC 返回时会检查此状态并丢弃结果）
      set((state) => ({
        tasks: state.tasks.map((t) =>
          t.id === taskId
            ? { ...t, status: 'cancelled' as TaskStatus, completedAt: Date.now() }
            : t,
        ),
      }));
    }
    // 释放槽位，尝试启动下一个任务
    get().processQueue(task.type);
  },

  cancelPendingByType: (type) => {
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.type === type && t.status === 'pending'
          ? { ...t, status: 'cancelled' as TaskStatus, completedAt: Date.now() }
          : t,
      ),
    }));
  },

  clearFinished: () => {
    set((state) => ({
      tasks: state.tasks.filter(
        (t) => t.status === 'pending' || t.status === 'running',
      ),
    }));
  },

  setThreadCount: (type, count) => {
    const newCounts = { ...get().threadCounts, [type]: count };
    set({ threadCounts: newCounts });
    saveThreadCounts(newCounts);
    // Increasing thread count may allow more tasks to run
    get().processQueue(type);
  },

  processQueue: (type) => {
    const state = get();
    const maxThreads = state.threadCounts[type];
    const running = state.tasks.filter((t) => t.type === type && t.status === 'running').length;
    const available = maxThreads - running;

    if (available <= 0) return;

    const pending = state.tasks.filter((t) => t.type === type && t.status === 'pending');
    const toStart = pending.slice(0, available);

    if (toStart.length === 0) return;

    // Mark tasks as running
    set((s) => ({
      tasks: s.tasks.map((t) =>
        toStart.some((ts) => ts.id === t.id)
          ? { ...t, status: 'running' as TaskStatus, startedAt: Date.now() }
          : t,
      ),
    }));

    // Execute each task
    for (const task of toStart) {
      const execute = async () => {
        try {
          let resultText: string | undefined;
          let resultResourceId: string | undefined;
          if (task.type === 'image') {
            resultResourceId = await executeImageTask(task);
          } else if (task.type === 'text') {
            const textResult = await executeTextTask(task);
            resultText = textResult.text;
            resultResourceId = textResult.resourceId;
          } else {
            resultResourceId = await executeVideoTask(task);
          }

          // Check if task was cancelled while running — remove it
          const current = get().tasks.find((t) => t.id === task.id);
          if (current?.status === 'cancelled') {
            set((s) => ({ tasks: s.tasks.filter((t) => t.id !== task.id) }));
            return;
          }

          // Mark completed
          set((s) => ({
            tasks: s.tasks.map((t) =>
              t.id === task.id && t.status === 'running'
                ? { ...t, status: 'completed' as TaskStatus, completedAt: Date.now(), resultText, resultResourceId }
                : t,
            ),
          }));
        } catch (err) {
          // Check if task was cancelled while running — remove it
          const current = get().tasks.find((t) => t.id === task.id);
          if (current?.status === 'cancelled') {
            set((s) => ({ tasks: s.tasks.filter((t) => t.id !== task.id) }));
            return;
          }

          // Mark failed
          const errorMessage = err instanceof Error ? err.message : String(err);
          set((s) => ({
            tasks: s.tasks.map((t) =>
              t.id === task.id && t.status === 'running'
                ? {
                    ...t,
                    status: 'failed' as TaskStatus,
                    completedAt: Date.now(),
                    error: errorMessage,
                  }
                : t,
            ),
          }));

          // 显示持久化错误通知（可复制、需手动关闭）
          const typeLabel = task.type === 'video' ? '视频' : task.type === 'image' ? '图片' : '文本';
          useNotificationStore.getState().showError(
            `${typeLabel}生成失败 [${task.label}]: ${errorMessage}`,
          );
        }

        // Refresh resources
        debouncedRefreshResources(task.draftId);
        // Process next tasks in queue
        get().processQueue(type);
      };

      execute();
    }
  },
}));
