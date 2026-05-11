import { create } from 'zustand';
import type { ImageResolution } from '@shared/types';
import { useDraftStore } from './draft';
import { useSectionsStore } from './sections';
import { useNotificationStore } from './notification';

// ============================================
// Types
// ============================================

export type TaskType = 'image' | 'text' | 'video';
export type TaskStatus = 'pending' | 'waiting' | 'running' | 'completed' | 'failed' | 'cancelled';

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
  audioResourceIds: string[];
  duration: number;
  ratio: string;
  targetSectionId?: string;
  method?: 'jimeng' | 'runninghub' | 'infinitetalk';
  // RunningHub 专属参数
  rhWidth?: number;
  rhHeight?: number;
  rhFps?: number;
  rhRunningFrames?: number;
  rhSkipFrames?: number;
  // Infinitetalk 专属参数
  itImageResourceId?: string;
  itAudioResourceId?: string;
  itMaxSize?: number;
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
  remoteTaskId?: string;
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
  loadTasksForDraft: (draftId: string) => Promise<void>;
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

function isUnfinishedTask(task: GenerationTask): boolean {
  return task.status === 'pending' || task.status === 'waiting' || task.status === 'running';
}

const aiTaskPersistChains = new Map<string, Promise<void>>();
const loadedAiTaskDrafts = new Set<string>();

function persistDraftTasks(draftId: string, tasks: GenerationTask[]): void {
  if (typeof window === 'undefined' || !window.api?.task?.saveAiTasks) return;
  const draftTasks = tasks.filter((task) => task.draftId === draftId);
  const previous = aiTaskPersistChains.get(draftId) || Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(() => window.api.task.saveAiTasks({ draftId, tasks: draftTasks }))
    .then((result) => {
      if (result && result.success === false) {
        console.error('[Generation] Failed to save ai_tasks.json:', result.error);
      }
    })
    .catch((error) => {
      console.error('[Generation] Failed to save ai_tasks.json:', error);
    });
  aiTaskPersistChains.set(draftId, next);
}

function persistChangedDrafts(tasks: GenerationTask[], draftIds?: Iterable<string>): void {
  const ids = draftIds ? [...draftIds] : [...new Set(tasks.map((task) => task.draftId))];
  for (const draftId of ids) {
    persistDraftTasks(draftId, tasks);
  }
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

// ============================================
// RunningHub API 提交排队机制
// 同一时间只有一个任务在尝试 API 提交，提交成功后放行下一个
// ============================================
let rhApiSubmitting = false;
const rhApiQueue: Array<{ resolve: () => void }> = [];

function acquireRhApiSlot(): Promise<void> {
  if (!rhApiSubmitting) {
    rhApiSubmitting = true;
    return Promise.resolve();
  }
  return new Promise((resolve) => rhApiQueue.push({ resolve }));
}

function releaseRhApiSlot() {
  const next = rhApiQueue.shift();
  if (next) {
    next.resolve();
  } else {
    rhApiSubmitting = false;
  }
}

// 等待 API 提交成功的回调注册表（taskId → resolve）
const rhSubmittedCallbacks = new Map<string, () => void>();

function waitForApiSubmitted(taskId: string): Promise<void> {
  return new Promise((resolve) => {
    rhSubmittedCallbacks.set(taskId, resolve);
  });
}

function notifyApiSubmitted(taskId: string) {
  const cb = rhSubmittedCallbacks.get(taskId);
  if (cb) {
    rhSubmittedCallbacks.delete(taskId);
    cb();
  }
}

const RH_RETRY_DELAY = 30_000; // 临时容量满重试间隔 30 秒

function isQueueFullError(error: string): boolean {
  return /队列已满|稍后重试|TASK_QUEUE_MAXED|TASK_INSTANCE_MAXED|PERSONAL_QUEUE_COUNT_LIMIT|APIKEY_TASK_IS_QUEUED|APIKEY_TASK_IS_RUNNING|QUEUE|MAXED|Resources are busy|Concurrency Limit|Dedicated Instances Exhausted|System is currently busy|Service unavailable/i.test(error);
}

function queueRetryMessage(): string {
  return 'RunningHub 队列已满，30秒后重试...';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function markTaskWaiting(taskId: string, message: string): void {
  useGenerationStore.setState((state) => ({
    tasks: state.tasks.map((t) =>
      t.id === taskId
        ? { ...t, status: 'waiting' as TaskStatus, progressMessage: message }
        : t,
    ),
  }));
  persistChangedDrafts(useGenerationStore.getState().tasks);
}

function markTaskRunning(taskId: string): void {
  useGenerationStore.setState((state) => ({
    tasks: state.tasks.map((t) =>
      t.id === taskId && t.status === 'waiting'
        ? { ...t, status: 'running' as TaskStatus, startedAt: t.startedAt || Date.now() }
        : t,
    ),
  }));
  persistChangedDrafts(useGenerationStore.getState().tasks);
}

async function executeVideoTask(task: GenerationTask): Promise<string | undefined> {
  const params = task.params as VideoTaskParams;

  if (params.method === 'runninghub') {
    // 等待轮到自己提交 API
    await acquireRhApiSlot();
    let slotReleased = false;
    try {
      // 循环重试直到 API 提交成功
      while (true) {
        // 检查任务是否被取消
        const current = useGenerationStore.getState().tasks.find((t) => t.id === task.id);
        if (current?.status === 'cancelled') {
          releaseRhApiSlot();
          slotReleased = true;
          throw new Error('任务已取消');
        }

        // 注册 API 提交成功回调，收到 API_SUBMITTED 消息后释放槽位
        const submittedPromise = waitForApiSubmitted(task.id);

        const resultPromise = window.api.task.generateVideoRunningHub({
          draftId: task.draftId,
          imageResourceId: params.imageResourceIds[0],
          videoResourceId: params.videoResourceIds[0],
          prompt: task.prompt,
          width: params.rhWidth || 576,
          height: params.rhHeight || 1024,
          fps: params.rhFps || 24,
          runningFrames: params.rhRunningFrames || 120,
          skipFrames: params.rhSkipFrames || 0,
          targetSectionId: params.targetSectionId,
          taskId: task.id,
          remoteTaskId: task.remoteTaskId,
        });

        // 等待 API 提交成功或整个任务完成（取先到达的）
        // API 提交成功 → 释放槽位让下一个任务开始
        submittedPromise.then(() => {
          if (!slotReleased) {
            releaseRhApiSlot();
            slotReleased = true;
          }
        });

        const result = await resultPromise;

        // 清理未触发的回调
        rhSubmittedCallbacks.delete(task.id);

        if (result.success) {
          if (!slotReleased) {
            releaseRhApiSlot();
            slotReleased = true;
          }
          return result.data?.resourceId;
        }

        // 临时容量满 → 等待后重试，不进入失败列表
        if (isQueueFullError(result.error || '')) {
          markTaskWaiting(task.id, queueRetryMessage());
          await sleep(RH_RETRY_DELAY);
          markTaskRunning(task.id);
          continue;
        }

        // 其他错误直接失败
        if (!slotReleased) {
          releaseRhApiSlot();
          slotReleased = true;
        }
        throw new Error(result.error || 'RunningHub 视频生成失败');
      }
    } catch (err) {
      rhSubmittedCallbacks.delete(task.id);
      if (!slotReleased) releaseRhApiSlot();
      throw err;
    }
  }

  if (params.method === 'infinitetalk') {
    await acquireRhApiSlot();
    let slotReleased = false;
    try {
      while (true) {
        const current = useGenerationStore.getState().tasks.find((t) => t.id === task.id);
        if (current?.status === 'cancelled') {
          releaseRhApiSlot();
          slotReleased = true;
          throw new Error('任务已取消');
        }

        const submittedPromise = waitForApiSubmitted(task.id);

        const resultPromise = window.api.task.generateVideoInfinitetalk({
          draftId: task.draftId,
          imageResourceId: params.itImageResourceId || params.imageResourceIds[0],
          audioResourceId: params.itAudioResourceId || params.audioResourceIds[0],
          prompt: task.prompt || undefined,
          maxSize: params.itMaxSize,
          targetSectionId: params.targetSectionId,
          taskId: task.id,
          remoteTaskId: task.remoteTaskId,
        });

        submittedPromise.then(() => {
          if (!slotReleased) {
            releaseRhApiSlot();
            slotReleased = true;
          }
        });

        const result = await resultPromise;
        rhSubmittedCallbacks.delete(task.id);

        if (result.success) {
          if (!slotReleased) {
            releaseRhApiSlot();
            slotReleased = true;
          }
          return result.data?.resourceId;
        }

        if (isQueueFullError(result.error || '')) {
          markTaskWaiting(task.id, queueRetryMessage());
          await sleep(RH_RETRY_DELAY);
          markTaskRunning(task.id);
          continue;
        }

        if (!slotReleased) {
          releaseRhApiSlot();
          slotReleased = true;
        }
        throw new Error(result.error || 'Infinitetalk 视频生成失败');
      }
    } catch (err) {
      rhSubmittedCallbacks.delete(task.id);
      if (!slotReleased) releaseRhApiSlot();
      throw err;
    }
  }

  const result = await window.api.task.generateVideo({
    draftId: task.draftId,
    imageResourceIds: params.imageResourceIds,
    videoResourceIds: params.videoResourceIds,
    audioResourceIds: params.audioResourceIds,
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
      // 检测 API 提交成功标记，释放排队槽位
      if (data.message.includes('API_SUBMITTED')) {
        const remoteTaskId = data.message.match(/API_SUBMITTED\s+(\S+)/)?.[1];
        if (remoteTaskId) {
          useGenerationStore.setState((state) => ({
            tasks: state.tasks.map((t) =>
              t.id === data.taskId ? { ...t, remoteTaskId, progressMessage: '已提交，等待生成结果...' } : t,
            ),
          }));
          persistChangedDrafts(useGenerationStore.getState().tasks);
        }
        notifyApiSubmitted(data.taskId);
        return; // 不显示这个内部标记
      }
      useGenerationStore.setState((state) => ({
        tasks: state.tasks.map((t) =>
          t.id === data.taskId ? { ...t, progressMessage: data.message } : t,
        ),
      }));
      persistChangedDrafts(useGenerationStore.getState().tasks);
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
    persistChangedDrafts(get().tasks, new Set(created.map((task) => task.draftId)));

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

    if (task.status === 'pending' || task.status === 'waiting') {
      // 等待中的任务直接移除
      set((state) => ({
        tasks: state.tasks.filter((t) => t.id !== taskId),
      }));
      persistChangedDrafts(get().tasks, [task.draftId]);
    } else if (task.status === 'running') {
      // 运行中的任务标记取消（IPC 返回时会检查此状态并丢弃结果）
      set((state) => ({
        tasks: state.tasks.map((t) =>
          t.id === taskId
            ? { ...t, status: 'cancelled' as TaskStatus, completedAt: Date.now() }
            : t,
        ),
      }));
      persistChangedDrafts(get().tasks, [task.draftId]);
    }
    // 释放槽位，尝试启动下一个任务
    get().processQueue(task.type);
  },

  cancelPendingByType: (type) => {
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.type === type && (t.status === 'pending' || t.status === 'waiting')
          ? { ...t, status: 'cancelled' as TaskStatus, completedAt: Date.now() }
          : t,
      ),
    }));
    persistChangedDrafts(get().tasks);
  },

  clearFinished: () => {
    const beforeDraftIds = new Set(get().tasks.map((task) => task.draftId));
    set((state) => ({
      tasks: state.tasks.filter(
        (t) => t.status === 'pending' || t.status === 'waiting' || t.status === 'running',
      ),
    }));
    persistChangedDrafts(get().tasks, beforeDraftIds);
  },

  loadTasksForDraft: async (draftId: string) => {
    if (loadedAiTaskDrafts.has(draftId)) return;
    if (!window.api?.task?.loadAiTasks) return;
    const result = await window.api.task.loadAiTasks({ draftId });
    if (!result.success) {
      console.error('[Generation] Failed to load ai_tasks.json:', result.error);
      return;
    }
    loadedAiTaskDrafts.add(draftId);
    const loaded = ((result.data || []) as GenerationTask[]).map((task) => {
      if (isUnfinishedTask(task)) {
        return {
          ...task,
          status: 'pending' as TaskStatus,
          progressMessage: task.remoteTaskId ? '恢复任务，继续查询结果...' : '恢复任务，等待重新提交...',
          completedAt: undefined,
          error: undefined,
        };
      }
      return task;
    });
    set((state) => ({
      tasks: [
        ...state.tasks.filter((task) => task.draftId !== draftId),
        ...loaded,
      ],
    }));
    persistChangedDrafts(get().tasks, [draftId]);
    for (const type of new Set(loaded.filter(isUnfinishedTask).map((task) => task.type))) {
      setTimeout(() => get().processQueue(type), 0);
    }
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
    const pending = state.tasks.filter((t) => t.type === type && t.status === 'pending');

    // RunningHub 视频任务不受并发限制，全部立即启动
    let rhToStart: typeof pending = [];
    let regularToStart: typeof pending = [];
    if (type === 'video') {
      rhToStart = pending.filter((t) => {
        const m = (t.params as VideoTaskParams).method;
        return m === 'runninghub' || m === 'infinitetalk';
      });
      const regularPending = pending.filter((t) => {
        const m = (t.params as VideoTaskParams).method;
        return m !== 'runninghub' && m !== 'infinitetalk';
      });
      const regularRunning = state.tasks.filter(
        (t) => {
          const m = (t.params as VideoTaskParams).method;
          return t.type === 'video' && t.status === 'running' && m !== 'runninghub' && m !== 'infinitetalk';
        },
      ).length;
      const regularAvailable = maxThreads - regularRunning;
      regularToStart = regularAvailable > 0 ? regularPending.slice(0, regularAvailable) : [];
    } else {
      const available = maxThreads - running;
      regularToStart = available > 0 ? pending.slice(0, available) : [];
    }

    const toStart = [...rhToStart, ...regularToStart];

    if (toStart.length === 0) return;

    // Mark tasks as running
    set((s) => ({
      tasks: s.tasks.map((t) =>
        toStart.some((ts) => ts.id === t.id)
          ? { ...t, status: 'running' as TaskStatus, startedAt: Date.now() }
          : t,
      ),
    }));
    persistChangedDrafts(get().tasks);

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
            persistChangedDrafts(get().tasks, [task.draftId]);
            return;
          }

          // Mark completed
          set((s) => ({
            tasks: s.tasks.map((t) =>
              t.id === task.id && (t.status === 'running' || t.status === 'waiting')
                ? { ...t, status: 'completed' as TaskStatus, completedAt: Date.now(), resultText, resultResourceId }
                : t,
            ),
          }));
          persistChangedDrafts(get().tasks, [task.draftId]);

          // 持久化生成元数据（后端会自动计算源文件哈希）
          if (resultResourceId) {
            try {
              await window.api.resource.saveMetadata({
                draftId: task.draftId,
                resourceId: resultResourceId,
                generation: {
                  type: task.type,
                  prompt: task.prompt,
                  params: task.params,
                  generatedAt: new Date().toISOString(),
                },
              });
            } catch (metaErr) {
              console.error('[Generation] Failed to save metadata:', metaErr);
            }
          }
        } catch (err) {
          // Check if task was cancelled while running — remove it
          const current = get().tasks.find((t) => t.id === task.id);
          if (current?.status === 'cancelled') {
            set((s) => ({ tasks: s.tasks.filter((t) => t.id !== task.id) }));
            persistChangedDrafts(get().tasks, [task.draftId]);
            return;
          }

          // Mark failed
          const errorMessage = err instanceof Error ? err.message : String(err);
          set((s) => ({
            tasks: s.tasks.map((t) =>
              t.id === task.id && (t.status === 'running' || t.status === 'waiting')
                ? {
                    ...t,
                    status: 'failed' as TaskStatus,
                    completedAt: Date.now(),
                    error: errorMessage,
                  }
                : t,
            ),
          }));
          persistChangedDrafts(get().tasks, [task.draftId]);

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
